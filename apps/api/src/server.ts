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
const { client, db } = createDatabase(config.DATABASE_URL);
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(db),
  sessions: new PostgresSessionStatusReader(db),
  supportGrants: new PostgresSupportGrantStatusReader(db),
  summaries: new PostgresTenantSummaryReader(db),
});

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await client.end({ timeout: 5 });
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
