import { createDatabase } from '@isp/database';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { assertControlDatabaseReady, assertTenantDatabaseReady } from './readiness.js';
import {
  PostgresAuditWriter,
  PostgresFinanceWriter,
  PostgresSessionStatusReader,
  PostgresSecurityAuditWriter,
  PostgresSupportGrantStatusReader,
  PostgresTenantMembershipStatusReader,
  PostgresTenantSummaryReader,
} from './postgres-adapters.js';

const config = readConfig(process.env);
const controlDatabase = createDatabase(config.CONTROL_DATABASE_URL);
const tenantDatabase = createDatabase(config.TENANT_DATABASE_URL);
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(controlDatabase.db),
  finance: new PostgresFinanceWriter(tenantDatabase.db),
  securityAudit: new PostgresSecurityAuditWriter(controlDatabase.db),
  sessions: new PostgresSessionStatusReader(controlDatabase.db),
  tenantMemberships: new PostgresTenantMembershipStatusReader(controlDatabase.db),
  supportGrants: new PostgresSupportGrantStatusReader(controlDatabase.db),
  summaries: new PostgresTenantSummaryReader(tenantDatabase.db),
  readiness: async () => {
    await Promise.all([
      assertControlDatabaseReady(controlDatabase.client),
      assertTenantDatabaseReady(tenantDatabase.client),
    ]);
  },
});

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
