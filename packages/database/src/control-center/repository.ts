import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client.js';
import type { ControlRepositoryRequest, SignedControlDatabaseContext } from './types.js';

export type ControlClientState =
  | 'lead'
  | 'trial'
  | 'active'
  | 'grace'
  | 'restricted'
  | 'terminated'
  | 'archived';
export type ControlCurrency = 'USD' | 'LBP';

abstract class ControlCenterRepositoryError extends Error {
  public abstract readonly code: string;
}
export class ControlCenterConflictError extends ControlCenterRepositoryError {
  public readonly code = 'CONTROL_CENTER_CONFLICT';
  public constructor(message = 'The Control Center record conflicts with this request.') {
    super(message);
    this.name = 'ControlCenterConflictError';
  }
}
export class ControlCenterPreconditionError extends ControlCenterRepositoryError {
  public readonly code = 'CONTROL_CENTER_PRECONDITION_FAILED';
  public constructor(message = 'The Control Center record changed before this request completed.') {
    super(message);
    this.name = 'ControlCenterPreconditionError';
  }
}
export class ControlCenterNotFoundError extends ControlCenterRepositoryError {
  public readonly code = 'CONTROL_CENTER_NOT_FOUND';
  public constructor(message = 'The requested Control Center record was not found.') {
    super(message);
    this.name = 'ControlCenterNotFoundError';
  }
}
export class ControlCenterIdempotencyError extends ControlCenterRepositoryError {
  public readonly code = 'IDEMPOTENCY_CONFLICT';
  public constructor() {
    super('The idempotency key was used with a different Control Center request.');
    this.name = 'ControlCenterIdempotencyError';
  }
}
export class ControlCenterAuthorizationError extends ControlCenterRepositoryError {
  public readonly code = 'CONTROL_CENTER_AUTHORIZATION_DENIED';
  public constructor(message = 'The authenticated platform context cannot perform this task.') {
    super(message);
    this.name = 'ControlCenterAuthorizationError';
  }
}
export class ControlCenterValidationError extends ControlCenterRepositoryError {
  public readonly code = 'CONTROL_CENTER_VALIDATION_FAILED';
  public constructor(message = 'The Control Center request violates a business rule.') {
    super(message);
    this.name = 'ControlCenterValidationError';
  }
}

interface IdempotentMutation extends ControlRepositoryRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly reason: string;
}

export interface ControlClientRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradingName: string;
  readonly state: ControlClientState;
  readonly accountOwnerId?: string;
  readonly createdAt: string;
  readonly replay?: boolean;
}
export interface ClientDrilldownRecord extends ControlClientRecord {
  readonly packageKey?: string;
  readonly deploymentHealth?: 'healthy' | 'attention' | 'blocked';
  readonly supportStatus?: 'clear' | 'open' | 'escalated';
  readonly openTicketCount: number;
}
export interface CreateControlClientInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradingName: string;
  readonly registrationNumber?: string;
  readonly accountOwnerId?: string;
  readonly notes?: string;
}
export interface CreateContactInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly role: 'primary' | 'billing' | 'technical' | 'legal';
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly preferredLocale: 'en' | 'ar';
  readonly isPrimary: boolean;
}
export interface CreatePackageVersionInput extends IdempotentMutation {
  readonly packageKey: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly entitlements: readonly string[];
  readonly priceMinor: number;
  readonly currency: ControlCurrency;
  readonly effectiveFrom: Date;
  readonly effectiveUntil?: Date;
}
export interface AssignSubscriptionInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly packageVersionId: string;
  readonly state: ControlClientState;
  readonly startsAt: Date;
  readonly expectedRevision?: number;
}
export interface TransitionSubscriptionInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly expectedState: ControlClientState;
  readonly expectedRevision: number;
  readonly toState: ControlClientState;
}
export interface ApproveTransitionInput extends IdempotentMutation {
  readonly approvalRequestId: string;
}
export interface PostPlatformDocumentInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly number: string;
  readonly amountMinor: number;
  readonly currency: ControlCurrency;
  readonly dueAt?: Date;
}
export interface ReversePlatformDocumentInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly originalId: string;
  readonly number: string;
}
export interface AllocatePlatformPaymentInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: ControlCurrency;
}
export interface ReversePlatformAllocationInput extends IdempotentMutation {
  readonly tenantId: string;
  readonly originalId: string;
}
export interface PlatformDocumentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly entryKind: 'posted' | 'reversal';
  readonly number: string;
  readonly amountMinor: number;
  readonly currency: ControlCurrency;
  readonly postedAt: string;
  readonly replay?: boolean;
}
export interface DrilldownQuery {
  readonly states?: readonly ControlClientState[];
  readonly packageKeys?: readonly string[];
  readonly deploymentHealth?: readonly string[];
  readonly supportStatus?: readonly string[];
  readonly query?: string;
  readonly limit: number;
  readonly cursor?: string;
}

type ControlTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
interface ResultRow<T> {
  readonly [key: string]: unknown;
  readonly result: T;
}

async function inControlTransaction<T>(
  database: Database,
  authorization: SignedControlDatabaseContext,
  work: (tx: ControlTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
      await tx.execute(
        sql`SELECT begin_control_request_context(${authorization.attestationText},${authorization.signatureHex})`,
      );
      const [context] = await tx.execute<{ readonly actor_id: string }>(
        sql`SELECT actor_id FROM control_current_context()`,
      );
      if (!context)
        throw new ControlCenterAuthorizationError(
          'Signed Control Center context was not installed.',
        );
      return work(tx);
    });
  } catch (error) {
    throw mapControlCenterDatabaseError(error);
  }
}

export function mapControlCenterDatabaseError(error: unknown): Error {
  const details =
    typeof error === 'object' && error !== null
      ? (error as { code?: string; message?: string })
      : {};
  if (details.code === 'CI409') return new ControlCenterIdempotencyError();
  if (details.code === 'CC409') return new ControlCenterConflictError(details.message);
  if (details.code === 'CC404') return new ControlCenterNotFoundError(details.message);
  if (details.code === 'CC412' || details.code === '40001')
    return new ControlCenterPreconditionError(details.message);
  if (details.code === 'CA403' || details.code === '42501')
    return new ControlCenterAuthorizationError(details.message);
  if (['23514', '23P01', '23502', '22023'].includes(details.code ?? ''))
    return new ControlCenterValidationError(details.message);
  if (details.code === '23505') return new ControlCenterConflictError(details.message);
  return error instanceof Error ? error : new Error('Unknown Control Center database error.');
}

async function selectResult<T>(tx: ControlTransaction, statement: SQL): Promise<T> {
  const [row] = await tx.execute<ResultRow<T>>(statement);
  if (!row) throw new Error('Control Center function returned no result.');
  return row.result;
}

function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`,`,
      )}]::text[]`;
}

export function createControlClient(
  database: Database,
  input: CreateControlClientInput,
): Promise<ControlClientRecord> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT create_control_client(${input.tenantId}::uuid,${input.legalName},${input.tradingName},${input.registrationNumber ?? null},${input.accountOwnerId ?? null},${input.notes ?? null},${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function createControlClientContact(
  database: Database,
  input: CreateContactInput,
): Promise<{ readonly id: string; readonly tenantId: string; readonly replay: boolean }> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT create_control_contact(${input.tenantId}::uuid,${input.role},${input.name},${input.email ?? null},${input.phone ?? null},${input.preferredLocale},${input.isPrimary},${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function createControlPackageVersion(
  database: Database,
  input: CreatePackageVersionInput,
): Promise<unknown> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT create_control_package_version(${input.packageKey},${input.version},${input.nameEn},${input.nameAr},${textArray(input.entitlements)},${input.priceMinor},${input.currency}::control_currency,${input.effectiveFrom.toISOString()}::timestamptz,${input.effectiveUntil?.toISOString() ?? null}::timestamptz,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function assignControlSubscription(
  database: Database,
  input: AssignSubscriptionInput,
): Promise<unknown> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT assign_control_subscription(${input.tenantId}::uuid,${input.packageVersionId}::uuid,${input.state}::control_client_state,${input.startsAt.toISOString()}::timestamptz,${input.expectedRevision ?? null},${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function transitionControlSubscription(
  database: Database,
  input: TransitionSubscriptionInput,
): Promise<{
  readonly transitionId?: string;
  readonly approvalRequestId?: string;
  readonly state: ControlClientState;
  readonly status: 'pending' | 'executed';
  readonly replay: boolean;
}> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT request_control_transition(${input.tenantId}::uuid,${input.expectedState}::control_client_state,${input.expectedRevision},${input.toState}::control_client_state,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function approveControlSubscriptionTransition(
  database: Database,
  input: ApproveTransitionInput,
): Promise<unknown> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT approve_control_transition(${input.approvalRequestId}::uuid,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function postPlatformInvoice(
  database: Database,
  input: PostPlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  if (!input.dueAt) throw new ControlCenterValidationError('Platform invoice dueAt is required.');
  return postDocument(database, 'invoice', input);
}
export function postPlatformPayment(
  database: Database,
  input: PostPlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  return postDocument(database, 'payment', input);
}
function postDocument(
  database: Database,
  kind: 'invoice' | 'payment',
  input: PostPlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT post_control_document(${kind},${input.tenantId}::uuid,${input.number},${input.amountMinor},${input.currency}::control_currency,${input.dueAt?.toISOString() ?? null}::timestamptz,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function reversePlatformInvoice(
  database: Database,
  input: ReversePlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  return reverseDocument(database, 'invoice', input);
}
export function reversePlatformPayment(
  database: Database,
  input: ReversePlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  return reverseDocument(database, 'payment', input);
}
function reverseDocument(
  database: Database,
  kind: 'invoice' | 'payment',
  input: ReversePlatformDocumentInput,
): Promise<PlatformDocumentRecord> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT reverse_control_document(${kind},${input.tenantId}::uuid,${input.originalId}::uuid,${input.number},${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function allocatePlatformPayment(
  database: Database,
  input: AllocatePlatformPaymentInput,
): Promise<unknown> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT allocate_control_payment(${input.tenantId}::uuid,${input.invoiceId}::uuid,${input.paymentId}::uuid,${input.amountMinor},${input.currency}::control_currency,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}
export function reversePlatformAllocation(
  database: Database,
  input: ReversePlatformAllocationInput,
): Promise<unknown> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT reverse_control_allocation(${input.tenantId}::uuid,${input.originalId}::uuid,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}

export async function listControlClients(
  database: Database,
  authorization: SignedControlDatabaseContext,
  query: DrilldownQuery,
): Promise<readonly ClientDrilldownRecord[]> {
  const conditions: SQL[] = [];
  if (query.states?.length)
    conditions.push(sql`state=ANY(${query.states}::control_client_state[])`);
  if (query.packageKeys?.length)
    conditions.push(sql`package_key=ANY(${textArray(query.packageKeys)})`);
  if (query.deploymentHealth?.length)
    conditions.push(sql`deployment_health=ANY(${textArray(query.deploymentHealth)})`);
  if (query.supportStatus?.length)
    conditions.push(sql`support_status=ANY(${textArray(query.supportStatus)})`);
  if (query.query)
    conditions.push(
      sql`(legal_name ILIKE ${`%${query.query}%`} OR trading_name ILIKE ${`%${query.query}%`})`,
    );
  if (query.cursor) conditions.push(sql`id>${query.cursor}::uuid`);
  const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
  return inControlTransaction(database, authorization, async (tx) => {
    const rows = await tx.execute<{
      [key: string]: unknown;
      id: string;
      tenant_id: string;
      legal_name: string;
      trading_name: string;
      state: ControlClientState;
      account_owner_id: string | null;
      created_at: Date | string;
      package_key: string | null;
      deployment_health: 'healthy' | 'attention' | 'blocked' | null;
      support_status: 'clear' | 'open' | 'escalated' | null;
      open_ticket_count: number | string;
    }>(
      sql`SELECT * FROM control_center_client_drilldown ${where} ORDER BY id LIMIT ${query.limit}`,
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      legalName: row.legal_name,
      tradingName: row.trading_name,
      state: row.state,
      ...(row.account_owner_id ? { accountOwnerId: row.account_owner_id } : {}),
      createdAt: new Date(row.created_at).toISOString(),
      ...(row.package_key ? { packageKey: row.package_key } : {}),
      ...(row.deployment_health ? { deploymentHealth: row.deployment_health } : {}),
      ...(row.support_status ? { supportStatus: row.support_status } : {}),
      openTicketCount: Number(row.open_ticket_count),
    }));
  });
}
