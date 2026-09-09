import {
  approveSettlementSchema,
  cashierCommandSchema,
  cashierQuerySchema,
  collectionManageCommandSchema,
  collectionsQuerySchema,
  recordCollectionSchema,
  voidReceiptSchema,
  type ApproveSettlementCommand,
  type CashierCommand,
  type CashierQuery,
  type CashierWorkspace,
  type CollectionManageCommand,
  type CollectionsQuery,
  type CollectionsWorkspace,
  type RecordCollectionCommand,
  type VerifiedTenantId,
  type VoidReceiptCommand,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

type Signed = { readonly authorization: SignedOperationsDatabaseContext };

async function runCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  fn: string,
  command: unknown,
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: Record<string, unknown> }>(
      sql`SELECT ${sql.raw(fn)}(${JSON.stringify(command)}::jsonb) AS result`,
    );
    if (!row) throw new Error(`${fn} returned no result.`);
    return row.result;
  });
}

/** Drawer control and receipts (permission tenant.payment.post, action tenant.cashier.manage). */
export async function executeCashierCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: CashierCommand },
): Promise<Record<string, unknown>> {
  const command = cashierCommandSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_cashier_command', command);
}

/** Linked reversal of a receipt (permission tenant.payment.reverse, action tenant.cashier.manage). */
export async function voidReceipt(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: VoidReceiptCommand },
): Promise<Record<string, unknown>> {
  const command = voidReceiptSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_cashier_command', command);
}

export async function readCashierWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly query?: Partial<CashierQuery> },
): Promise<CashierWorkspace> {
  const query = cashierQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: CashierWorkspace }>(
      sql`SELECT read_cashier_workspace(${query.search ?? null}) AS result`,
    );
    if (!row) throw new Error('Cashier workspace returned no result.');
    return row.result;
  });
}

/** Route collectors, assignments and settlements (permission tenant.collection.reconcile). */
export async function executeCollectionCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: CollectionManageCommand | ApproveSettlementCommand },
): Promise<Record<string, unknown>> {
  const command =
    input.command.action === 'approve_settlement'
      ? approveSettlementSchema.parse(input.command)
      : collectionManageCommandSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_collection_command', command);
}

/** Office posting of a collector's cash for an assignment (permission tenant.payment.post). */
export async function recordCollection(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: RecordCollectionCommand },
): Promise<Record<string, unknown>> {
  const command = recordCollectionSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_collection_command', command);
}

export async function readCollectionsWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly query?: Partial<CollectionsQuery> },
): Promise<CollectionsWorkspace> {
  const query = collectionsQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: CollectionsWorkspace }>(
      sql`SELECT read_collections_workspace(${query.day ?? null}::date) AS result`,
    );
    if (!row) throw new Error('Collections workspace returned no result.');
    return row.result;
  });
}
