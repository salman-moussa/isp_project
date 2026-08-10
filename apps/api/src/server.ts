import { createDatabase } from '@isp/database';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import {
  PostgresAuditWriter,
  PostgresSessionStatusReader,
  PostgresSecurityAuditWriter,
  PostgresSupportGrantStatusReader,
  PostgresTenantSummaryReader,
} from './postgres-adapters.js';

const config = readConfig(process.env);
const controlDatabase = createDatabase(config.CONTROL_DATABASE_URL);
const tenantDatabase = createDatabase(config.TENANT_DATABASE_URL);
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(controlDatabase.db),
  securityAudit: new PostgresSecurityAuditWriter(controlDatabase.db),
  sessions: new PostgresSessionStatusReader(controlDatabase.db),
  supportGrants: new PostgresSupportGrantStatusReader(controlDatabase.db),
  summaries: new PostgresTenantSummaryReader(tenantDatabase.db),
  readiness: async () => {
    await Promise.all([
      assertDatabaseReady(controlDatabase.client, 'security_events'),
      assertDatabaseReady(tenantDatabase.client, 'tenant_dashboard_snapshots'),
    ]);
  },
});

async function assertDatabaseReady(
  client: typeof controlDatabase.client,
  requiredRelation: string,
): Promise<void> {
  const [state] = await client.unsafe(
    `SELECT
       to_regclass($1) IS NOT NULL AS relation_ready,
       EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608100030_control_security_audit.sql'
       ) AS migrations_ready`,
    [requiredRelation],
  );
  if (!state?.relation_ready || !state.migrations_ready) {
    throw new Error(`Database schema is not ready for ${requiredRelation}.`);
  }
}

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.all([
    controlDatabase.client.end({ timeout: 5 }),
    tenantDatabase.client.end({ timeout: 5 }),
  ]);
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
