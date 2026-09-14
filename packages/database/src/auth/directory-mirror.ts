import type { TenantDirectorySnapshot, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';

/**
 * Staff are authoritative in the control database. These readers expose one tenant's directory
 * (tenant row, member identities without secrets, memberships) through SECURITY DEFINER functions
 * so the tenant database can keep an equal mirror for operational references.
 */
async function asControlRuntime<T>(
  database: Database,
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
    return work(transaction);
  });
}

/** Tenant ids known to the control database (active and archived alike). */
export async function listControlTenantIds(database: Database): Promise<readonly string[]> {
  return asControlRuntime(database, async (transaction) => {
    const rows = await transaction.execute<{ id: string }>(
      sql`SELECT id FROM list_tenant_ids() AS id`,
    );
    return rows.map((row) => row.id);
  });
}

/** One tenant's directory as the control database holds it, or null when the tenant is unknown. */
export async function readTenantDirectory(
  database: Database,
  tenantId: VerifiedTenantId,
): Promise<TenantDirectorySnapshot | null> {
  return asControlRuntime(database, async (transaction) => {
    const [row] = await transaction.execute<{ result: TenantDirectorySnapshot | null }>(
      sql`SELECT read_tenant_directory(${tenantId}::uuid) AS result`,
    );
    return row?.result ?? null;
  });
}

export interface TenantDirectoryMirrorOutcome {
  readonly tenantId: string;
  readonly insertedUsers: number;
  readonly updatedUsers: number;
  readonly insertedMembers: number;
  readonly updatedMembers: number;
  readonly deactivatedMembers: number;
  readonly members: number;
}

/** Apply a directory snapshot to the tenant database through `mirror_tenant_directory`. */
export async function applyTenantDirectoryMirror(
  database: Database,
  snapshot: TenantDirectorySnapshot,
): Promise<TenantDirectoryMirrorOutcome> {
  const [row] = await database.execute<{ result: TenantDirectoryMirrorOutcome }>(
    sql`SELECT mirror_tenant_directory(${JSON.stringify(snapshot)}::jsonb) AS result`,
  );
  if (!row) throw new Error('Directory mirror returned no result.');
  return row.result;
}
