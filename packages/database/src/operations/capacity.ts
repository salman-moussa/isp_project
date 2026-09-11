import {
  capacityCommandSchema,
  capacityQuerySchema,
  type CapacityCommand,
  type CapacityQuery,
  type CapacityWorkspace,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

/** Upstream circuits and utilisation samples (permission tenant.network.job.create). */
export async function executeCapacityCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: CapacityCommand;
  },
): Promise<Record<string, unknown>> {
  const command = capacityCommandSchema.parse(input.command);
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: Record<string, unknown> }>(
      sql`SELECT execute_capacity_command(${JSON.stringify(command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Capacity command returned no result.');
    return row.result;
  });
}

export async function readCapacityWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<CapacityQuery>;
  },
): Promise<CapacityWorkspace> {
  const query = capacityQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: CapacityWorkspace }>(
      sql`SELECT read_capacity_workspace(${query.days ?? null}::integer) AS result`,
    );
    if (!row) throw new Error('Capacity workspace returned no result.');
    return row.result;
  });
}
