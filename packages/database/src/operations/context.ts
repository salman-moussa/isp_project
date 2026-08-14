import type { VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import type { SignedOperationsDatabaseContext } from './types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class OperationsAuthorizationError extends Error {
  public readonly code = 'OPERATIONS_AUTHORIZATION_DENIED';
}
export class OperationsConflictError extends Error {
  public readonly code = 'OPERATIONS_CONFLICT';
}
export class OperationsValidationError extends Error {
  public readonly code = 'OPERATIONS_VALIDATION_FAILED';
}

/**
 * Installs a short-lived, signed authorization context in an owner-protected row. Operations RLS
 * deliberately ignores arbitrary runtime GUCs; all repository work must use this wrapper.
 */
export async function inOperationsTransaction<T>(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.transaction(async (transaction) => {
      await transaction.execute(sql`
      SELECT begin_operations_request_context(
        ${authorization.attestationText},
        ${authorization.signatureHex}
      )
    `);
      const [context] = await transaction.execute<{ readonly tenant_id: string }>(sql`
      SELECT tenant_id FROM operations_current_context()
    `);
      if (!context || context.tenant_id !== tenantId) {
        throw new Error('The signed Operations context does not match the requested tenant.');
      }
      // Finance tables still use the legacy tenant GUC. Set it only after the signed Operations
      // tenant has been verified; Operations RLS itself never trusts this value.
      await transaction.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return work(transaction);
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

function mapOperationsDatabaseError(error: unknown): Error {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') break;
    const details = current as { code?: string; message?: string; cause?: unknown };
    if (['P4032', 'P4033', '42501'].includes(details.code ?? '')) {
      return new OperationsAuthorizationError(details.message);
    }
    if (['P4091', 'P4092', '23505', '40001'].includes(details.code ?? '')) {
      return new OperationsConflictError(details.message);
    }
    if (['P4001', '23514', '23502', '22023', '22P02'].includes(details.code ?? '')) {
      return new OperationsValidationError(details.message);
    }
    current = details.cause;
  }
  return error instanceof Error ? error : new Error('Unknown Operations database error.');
}
