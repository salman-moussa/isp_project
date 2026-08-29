import { createDatabase, PostgresAuthRepository } from '@isp/database';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import {
  decodeControlContextSecret,
  PostgresControlCenterService,
} from './control-center-service.js';
import {
  assertControlDatabaseReady,
  assertHttpDependencyReady,
  assertTenantDatabaseReady,
} from './readiness.js';
import { decodeOperationsContextSecret, PostgresOperationsService } from './operations-service.js';
import { CollectApiService, PostgresCollectBackendRepository } from './collect-service.js';
import { AuthService } from './auth-service.js';
import { DevelopmentAuthDeliveryAdapter, RemoteAuthDeliveryAdapter } from './auth-delivery.js';
import {
  PostgresAuditWriter,
  PostgresFinanceWriter,
  PostgresSessionStatusReader,
  PostgresSecurityAuditWriter,
  PostgresSupportGrantStatusReader,
  PostgresTenantMembershipStatusReader,
  PostgresTenantSummaryReader,
  PostgresTenantStaffRepository,
} from './postgres-adapters.js';
import { TenantStaffService } from './staff.js';
import { PostgresTenantStaffScopeService } from './staff-scope-service.js';

const config = readConfig(process.env);
const authControlDatabase = createDatabase(config.AUTH_CONTROL_DATABASE_URL);
const controlDatabase = createDatabase(config.CONTROL_DATABASE_URL);
const tenantDatabase = createDatabase(config.TENANT_DATABASE_URL);
const operationsAuthority = {
  keyId: config.OPERATIONS_CONTEXT_KEY_ID,
  secret: decodeOperationsContextSecret(config.OPERATIONS_CONTEXT_SECRET_BASE64),
};
const sessionStatus = new PostgresSessionStatusReader(authControlDatabase.db);
const authDelivery =
  config.NODE_ENV === 'production'
    ? new RemoteAuthDeliveryAdapter(
        new URL(required(config.AUTH_DELIVERY_BASE_URL, 'AUTH_DELIVERY_BASE_URL')),
        required(config.AUTH_DELIVERY_TOKEN, 'AUTH_DELIVERY_TOKEN'),
      )
    : new DevelopmentAuthDeliveryAdapter();
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(authControlDatabase.db),
  finance: new PostgresFinanceWriter(tenantDatabase.db),
  securityAudit: new PostgresSecurityAuditWriter(authControlDatabase.db),
  sessions: sessionStatus,
  tenantMemberships: new PostgresTenantMembershipStatusReader(authControlDatabase.db),
  supportGrants: new PostgresSupportGrantStatusReader(authControlDatabase.db),
  summaries: new PostgresTenantSummaryReader(tenantDatabase.db),
  staff: new TenantStaffService(
    new PostgresTenantStaffRepository(authControlDatabase.db),
    authDelivery,
    decodeSecret(
      required(config.AUTH_TOKEN_DIGEST_SECRET_BASE64, 'AUTH_TOKEN_DIGEST_SECRET_BASE64'),
      'AUTH_TOKEN_DIGEST_SECRET_BASE64',
    ),
  ),
  staffScopes: new PostgresTenantStaffScopeService(tenantDatabase.db, operationsAuthority),
  controlCenter: new PostgresControlCenterService(controlDatabase.db, {
    keyId: config.CONTROL_CONTEXT_KEY_ID,
    secret: decodeControlContextSecret(config.CONTROL_CONTEXT_SECRET_BASE64),
  }),
  operations: new PostgresOperationsService(tenantDatabase.db, operationsAuthority),
  collect: new CollectApiService(
    new PostgresCollectBackendRepository(tenantDatabase.db),
    sessionStatus,
    {
      operationsKeyId: operationsAuthority.keyId,
      operationsSecret: operationsAuthority.secret,
    },
  ),
  auth: (instance) =>
    new AuthService(
      new PostgresAuthRepository(controlDatabase.db),
      {
        issue: async (claims, expiresAt) =>
          instance.jwt.sign({ ...claims, exp: Math.floor(expiresAt.getTime() / 1000) }),
      },
      authDelivery,
      authDelivery,
      {
        tokenDigestSecret: decodeSecret(
          required(config.AUTH_TOKEN_DIGEST_SECRET_BASE64, 'AUTH_TOKEN_DIGEST_SECRET_BASE64'),
          'AUTH_TOKEN_DIGEST_SECRET_BASE64',
        ),
      },
    ),
  readiness: async () => {
    await Promise.all([
      assertControlDatabaseReady(controlDatabase.client),
      assertTenantDatabaseReady(tenantDatabase.client),
      assertHttpDependencyReady(
        required(config.FINANCE_AUDIT_READINESS_URL, 'FINANCE_AUDIT_READINESS_URL'),
      ),
      assertHttpDependencyReady(
        required(config.NETWORK_WORKER_READINESS_URL, 'NETWORK_WORKER_READINESS_URL'),
      ),
    ]);
  },
});

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.all([
    controlDatabase.client.end({ timeout: 5 }),
    authControlDatabase.client.end({ timeout: 5 }),
    tenantDatabase.client.end({ timeout: 5 }),
  ]);
  process.exit(0);
};

process.on('SIGINT', () => void close('SIGINT'));
process.on('SIGTERM', () => void close('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });

function decodeSecret(value: string, name: string): Uint8Array {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength < 32) throw new Error(`${name} must decode to at least 32 bytes.`);
  return decoded;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}
