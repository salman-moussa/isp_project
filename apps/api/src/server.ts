import { createDatabase } from '@isp/database';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import {
  PostgresAuditWriter,
  PostgresSessionStatusReader,
  PostgresSupportGrantStatusReader,
  PostgresTenantSummaryReader,
} from './postgres-adapters.js';

const config = readConfig(process.env);
const controlDatabase = createDatabase(config.CONTROL_DATABASE_URL);
const tenantDatabase = createDatabase(config.TENANT_DATABASE_URL);
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(tenantDatabase.db),
  sessions: new PostgresSessionStatusReader(controlDatabase.db),
  supportGrants: new PostgresSupportGrantStatusReader(controlDatabase.db),
  summaries: new PostgresTenantSummaryReader(tenantDatabase.db),
  readiness: async () => {
    await Promise.all([
      controlDatabase.client.unsafe('select 1'),
      tenantDatabase.client.unsafe('select 1'),
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
