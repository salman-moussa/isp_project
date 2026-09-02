import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { inTenantTransaction } from './tenant-transaction.js';
import { inOperationsTransaction } from './operations/context.js';
import type { SignedOperationsDatabaseContext } from './operations/types.js';

export class IdempotencyConflictError extends Error {
  public readonly code = 'IDEMPOTENCY_CONFLICT';

  public constructor() {
    super('The idempotency key was already used with a different finance operation.');
    this.name = 'IdempotencyConflictError';
  }
}

export class FinanceConflictError extends Error {
  public readonly code = 'FINANCE_CONFLICT';

  public constructor() {
    super('The finance operation conflicts with the current posted balance or reversal state.');
    this.name = 'FinanceConflictError';
  }
}

export interface PostedFinanceDocument {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly entryKind: 'posted' | 'reversal';
  readonly number: string;
  readonly reversesId?: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly postedAt: string;
}

export interface PostedAllocation {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly entryKind: 'allocation' | 'reversal';
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly reversesId?: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly postedAt: string;
}

export interface PostDocumentInput {
  readonly number: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceRequestAuditContext;
  readonly authorization?: SignedOperationsDatabaseContext;
}

export interface FinanceRequestAuditContext {
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly permission: string;
  readonly reason: string;
}

export interface ReverseDocumentInput {
  readonly originalId: string;
  readonly reversalNumber: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceRequestAuditContext;
  readonly authorization?: SignedOperationsDatabaseContext;
}

export interface AllocatePaymentInput {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceRequestAuditContext;
  readonly authorization?: SignedOperationsDatabaseContext;
}

export interface ReverseAllocationInput {
  readonly originalId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceRequestAuditContext;
  readonly authorization?: SignedOperationsDatabaseContext;
}

interface DocumentRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly tenant_id: string;
  readonly entry_kind: 'posted' | 'reversal';
  readonly document_number?: string;
  readonly receipt_number?: string;
  readonly reverses_invoice_id?: string | null;
  readonly reverses_payment_id?: string | null;
  readonly amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly idempotency_key: string;
  readonly actor_id: string;
  readonly posted_at: Date | string;
}

interface AllocationRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly tenant_id: string;
  readonly entry_kind: 'allocation' | 'reversal';
  readonly payment_id: string;
  readonly invoice_id: string;
  readonly reverses_allocation_id: string | null;
  readonly amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly idempotency_key: string;
  readonly actor_id: string;
  readonly posted_at: Date | string;
}

export async function postInvoice(
  database: Database,
  tenantId: VerifiedTenantId,
  input: PostDocumentInput,
): Promise<PostedFinanceDocument> {
  return translateFinanceErrors(() =>
    writeDocument(database, tenantId, 'invoice', 'posted', input),
  );
}

export async function postPayment(
  database: Database,
  tenantId: VerifiedTenantId,
  input: PostDocumentInput,
): Promise<PostedFinanceDocument> {
  return translateFinanceErrors(() =>
    writeDocument(database, tenantId, 'payment', 'posted', input),
  );
}

export async function reverseInvoice(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ReverseDocumentInput,
): Promise<PostedFinanceDocument> {
  return translateFinanceErrors(() => reverseDocument(database, tenantId, 'invoice', input));
}

export async function reversePayment(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ReverseDocumentInput,
): Promise<PostedFinanceDocument> {
  return translateFinanceErrors(() => reverseDocument(database, tenantId, 'payment', input));
}

async function reverseDocument(
  database: Database,
  tenantId: VerifiedTenantId,
  type: 'invoice' | 'payment',
  input: ReverseDocumentInput,
): Promise<PostedFinanceDocument> {
  return inFinanceTransaction(database, tenantId, input.authorization, async (transaction) => {
    const table = type === 'invoice' ? 'finance_invoices' : 'finance_payments';
    const [original] = await transaction.execute<DocumentRow>(sql`
      SELECT * FROM ${sql.identifier(table)}
      WHERE tenant_id = ${tenantId} AND id = ${input.originalId}
    `);
    if (!original || original.entry_kind !== 'posted') {
      throw new FinanceConflictError();
    }
    return writeDocumentInTransaction(transaction, tenantId, type, 'reversal', {
      number: input.reversalNumber,
      amountMinor: safeMinor(original.amount_minor),
      currency: original.currency,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      postedAt: input.postedAt,
      audit: input.audit,
      ...(input.authorization ? { authorization: input.authorization } : {}),
      reversesId: original.id,
    });
  });
}

async function writeDocument(
  database: Database,
  tenantId: VerifiedTenantId,
  type: 'invoice' | 'payment',
  entryKind: 'posted' | 'reversal',
  input: PostDocumentInput & { readonly reversesId?: string },
): Promise<PostedFinanceDocument> {
  return inFinanceTransaction(database, tenantId, input.authorization, (transaction) =>
    writeDocumentInTransaction(transaction, tenantId, type, entryKind, input),
  );
}

function inFinanceTransaction<T>(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext | undefined,
  work: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  return authorization
    ? inOperationsTransaction(database, tenantId, authorization, work)
    : inTenantTransaction(database, tenantId, work);
}

type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function writeDocumentInTransaction(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  type: 'invoice' | 'payment',
  entryKind: 'posted' | 'reversal',
  input: PostDocumentInput & { readonly reversesId?: string },
): Promise<PostedFinanceDocument> {
  await setFinanceAuditContext(transaction, input.actorId, input.audit);
  const table = type === 'invoice' ? 'finance_invoices' : 'finance_payments';
  const numberColumn = type === 'invoice' ? 'document_number' : 'receipt_number';
  const reversalColumn = type === 'invoice' ? 'reverses_invoice_id' : 'reverses_payment_id';
  const rows = await transaction.execute<DocumentRow>(sql`
    INSERT INTO ${sql.identifier(table)}
      (tenant_id, ${sql.identifier(numberColumn)}, entry_kind, ${sql.identifier(reversalColumn)},
       amount_minor, currency, idempotency_key, actor_id, posted_at)
    VALUES
      (${tenantId}, ${input.number}, ${entryKind}, ${input.reversesId ?? null},
       ${input.amountMinor}, ${input.currency}, ${input.idempotencyKey}, ${input.actorId},
       ${input.postedAt.toISOString()}::text::timestamptz)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING *
  `);
  const [row] = rows.length
    ? rows
    : await transaction.execute<DocumentRow>(sql`
        SELECT * FROM ${sql.identifier(table)}
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
      `);
  if (!row) throw new Error(`Unable to persist the ${type}.`);
  const actualNumber = type === 'invoice' ? row.document_number : row.receipt_number;
  const actualReverses = type === 'invoice' ? row.reverses_invoice_id : row.reverses_payment_id;
  if (
    row.entry_kind !== entryKind ||
    actualNumber !== input.number ||
    (actualReverses ?? undefined) !== input.reversesId ||
    safeMinor(row.amount_minor) !== input.amountMinor ||
    row.currency !== input.currency ||
    row.actor_id !== input.actorId ||
    instant(row.posted_at) !== input.postedAt.getTime()
  ) {
    throw new IdempotencyConflictError();
  }
  return mapDocument(row, actualNumber ?? '', actualReverses);
}

export async function allocatePayment(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AllocatePaymentInput,
): Promise<PostedAllocation> {
  return translateFinanceErrors(() =>
    inFinanceTransaction(database, tenantId, input.authorization, (transaction) =>
      writeAllocationInTransaction(transaction, tenantId, 'allocation', input),
    ),
  );
}

export async function reverseAllocation(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ReverseAllocationInput,
): Promise<PostedAllocation> {
  return translateFinanceErrors(() =>
    inFinanceTransaction(database, tenantId, input.authorization, async (transaction) => {
      const [original] = await transaction.execute<AllocationRow>(sql`
      SELECT * FROM finance_payment_allocations
      WHERE tenant_id = ${tenantId} AND id = ${input.originalId}
    `);
      if (!original || original.entry_kind !== 'allocation') {
        throw new FinanceConflictError();
      }
      return writeAllocationInTransaction(transaction, tenantId, 'reversal', {
        paymentId: original.payment_id,
        invoiceId: original.invoice_id,
        amountMinor: safeMinor(original.amount_minor),
        currency: original.currency,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        postedAt: input.postedAt,
        audit: input.audit,
        reversesId: original.id,
      });
    }),
  );
}

async function writeAllocationInTransaction(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  entryKind: 'allocation' | 'reversal',
  input: AllocatePaymentInput & { readonly reversesId?: string },
): Promise<PostedAllocation> {
  await setFinanceAuditContext(transaction, input.actorId, input.audit);
  const rows = await transaction.execute<AllocationRow>(sql`
    INSERT INTO finance_payment_allocations
      (tenant_id, payment_id, invoice_id, entry_kind, reverses_allocation_id,
       amount_minor, currency, idempotency_key, actor_id, posted_at)
    VALUES
      (${tenantId}, ${input.paymentId}, ${input.invoiceId}, ${entryKind},
       ${input.reversesId ?? null}, ${input.amountMinor}, ${input.currency},
       ${input.idempotencyKey}, ${input.actorId},
       ${input.postedAt.toISOString()}::text::timestamptz)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING *
  `);
  const [row] = rows.length
    ? rows
    : await transaction.execute<AllocationRow>(sql`
        SELECT * FROM finance_payment_allocations
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
      `);
  if (!row) throw new Error('Unable to persist the allocation.');
  if (
    row.entry_kind !== entryKind ||
    row.payment_id !== input.paymentId ||
    row.invoice_id !== input.invoiceId ||
    (row.reverses_allocation_id ?? undefined) !== input.reversesId ||
    safeMinor(row.amount_minor) !== input.amountMinor ||
    row.currency !== input.currency ||
    row.actor_id !== input.actorId ||
    instant(row.posted_at) !== input.postedAt.getTime()
  ) {
    throw new IdempotencyConflictError();
  }
  return mapAllocation(row);
}

function mapDocument(
  row: DocumentRow,
  number: string,
  reversesId: string | null | undefined,
): PostedFinanceDocument {
  return {
    id: row.id,
    tenantId: row.tenant_id as VerifiedTenantId,
    entryKind: row.entry_kind,
    number,
    ...(reversesId ? { reversesId } : {}),
    amountMinor: safeMinor(row.amount_minor),
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    postedAt: new Date(row.posted_at).toISOString(),
  };
}

function mapAllocation(row: AllocationRow): PostedAllocation {
  return {
    id: row.id,
    tenantId: row.tenant_id as VerifiedTenantId,
    entryKind: row.entry_kind,
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    ...(row.reverses_allocation_id ? { reversesId: row.reverses_allocation_id } : {}),
    amountMinor: safeMinor(row.amount_minor),
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    postedAt: new Date(row.posted_at).toISOString(),
  };
}

function safeMinor(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new RangeError('Finance amount exceeds the safe API integer range.');
  }
  return converted;
}

async function setFinanceAuditContext(
  transaction: TenantTransaction,
  actorId: string,
  context: FinanceRequestAuditContext,
): Promise<void> {
  const settings: readonly [string, string][] = [
    ['app.finance_actor_id', actorId],
    ['app.finance_session_id', context.sessionId],
    ['app.finance_support_grant_id', context.supportGrantId ?? ''],
    ['app.finance_action', context.action],
    ['app.finance_request_id', context.requestId],
    ['app.finance_ip_address', context.ipAddress],
    ['app.finance_user_agent', context.userAgent ?? ''],
    ['app.finance_permission', context.permission],
    ['app.finance_reason', context.reason],
  ];
  for (const [name, value] of settings) {
    await transaction.execute(sql`SELECT set_config(${name}, ${value}, true)`);
  }
}

function instant(value: Date | string): number {
  const converted = new Date(value).getTime();
  if (!Number.isFinite(converted)) throw new Error('Finance timestamp is invalid.');
  return converted;
}

async function translateFinanceErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IdempotencyConflictError || error instanceof FinanceConflictError) {
      throw error;
    }
    const databaseError = asDatabaseError(error);
    if (databaseError?.code === 'P4090') throw new IdempotencyConflictError();
    if (
      databaseError?.code === 'OPERATIONS_CONFLICT' ||
      databaseError?.code === 'P4091' ||
      (databaseError?.code === '23505' && databaseError.constraint?.startsWith('finance_'))
    ) {
      throw new FinanceConflictError();
    }
    throw error;
  }
}

function asDatabaseError(
  error: unknown,
): { readonly code?: string; readonly constraint?: string } | null {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const code = 'code' in current && typeof current.code === 'string' ? current.code : undefined;
    const constraint =
      'constraint_name' in current && typeof current.constraint_name === 'string'
        ? current.constraint_name
        : 'constraint' in current && typeof current.constraint === 'string'
          ? current.constraint
          : undefined;
    if (code) return { code, ...(constraint ? { constraint } : {}) };
    current = 'cause' in current ? current.cause : undefined;
  }
  return null;
}
