import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** Sets transaction-local policy context. The application role must not have BYPASSRLS. */
export async function inTenantTransaction<T>(
  database: Database,
  tenantId: string,
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return work(transaction);
  });
}
