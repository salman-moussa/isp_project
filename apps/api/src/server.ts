import {
  createDatabase,
  PostgresAuthRepository,
  PostgresPlatformIntegrationStore,
} from '@isp/database';
import { S3Client } from '@aws-sdk/client-s3';
import { S3InvoiceDocumentStore } from './documents/invoice-store.js';
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
import { DatabaseAuthDeliveryAdapter } from './integrations/auth-delivery.js';
import { createIntegrationTransports } from './integrations/runtime.js';
import { AesGcmSecretBox, decodeIntegrationSecretKey } from './integrations/secret-box.js';
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
const documentStore = config.DOCUMENT_S3_BUCKET
  ? new S3InvoiceDocumentStore(
      new S3Client({
        region: config.DOCUMENT_S3_REGION ?? 'us-east-1',
        ...(config.DOCUMENT_S3_ENDPOINT ? { endpoint: config.DOCUMENT_S3_ENDPOINT } : {}),
        forcePathStyle: config.DOCUMENT_S3_FORCE_PATH_STYLE === 'true',
        maxAttempts: 2,
      }),
      config.DOCUMENT_S3_BUCKET,
    )
  : undefined;
const authControlDatabase = createDatabase(config.AUTH_CONTROL_DATABASE_URL);
const controlDatabase = createDatabase(config.CONTROL_DATABASE_URL);
const tenantDatabase = createDatabase(config.TENANT_DATABASE_URL);
const operationsAuthority = {
  keyId: config.OPERATIONS_CONTEXT_KEY_ID,
  secret: decodeOperationsContextSecret(config.OPERATIONS_CONTEXT_SECRET_BASE64),
};
const sessionStatus = new PostgresSessionStatusReader(authControlDatabase.db);
const tokenDigestSecret = decodeSecret(
  required(config.AUTH_TOKEN_DIGEST_SECRET_BASE64, 'AUTH_TOKEN_DIGEST_SECRET_BASE64'),
  'AUTH_TOKEN_DIGEST_SECRET_BASE64',
);
// Provider credentials configured in the product are sealed with this key. Without it the
// integration screens stay unavailable and authentication mail uses the remote adapter
// (production) or the inert development adapter.
const integrationRuntime = config.INTEGRATION_SECRET_KEY_BASE64
  ? {
      secretBox: new AesGcmSecretBox(
        decodeIntegrationSecretKey(config.INTEGRATION_SECRET_KEY_BASE64),
        config.INTEGRATION_SECRET_KEY_ID,
      ),
      transports: createIntegrationTransports(),
      production: config.NODE_ENV === 'production',
    }
  : undefined;
const integrationStore = new PostgresPlatformIntegrationStore(controlDatabase.db);
const remoteAuthDelivery =
  config.AUTH_DELIVERY_BASE_URL && config.AUTH_DELIVERY_TOKEN
    ? new RemoteAuthDeliveryAdapter(
        new URL(config.AUTH_DELIVERY_BASE_URL),
        config.AUTH_DELIVERY_TOKEN,
      )
    : undefined;
const webOrigins = config.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const trimSlash = (value: string) => value.replace(/\/$/u, '');
const authDelivery = integrationRuntime
  ? new DatabaseAuthDeliveryAdapter(integrationStore, {
      runtime: integrationRuntime,
      digestSecret: tokenDigestSecret,
      webUrls: {
        tenant: trimSlash(config.PUBLIC_TENANT_WEB_URL ?? webOrigins[0] ?? 'http://localhost:5173'),
        platform: trimSlash(
          config.PUBLIC_PLATFORM_WEB_URL ??
            webOrigins[1] ??
            `${webOrigins[0] ?? 'http://localhost:5173'}/control`,
        ),
      },
      ...(remoteAuthDelivery
        ? { fallback: remoteAuthDelivery }
        : config.NODE_ENV === 'production'
          ? {}
          : { fallback: new DevelopmentAuthDeliveryAdapter() }),
    })
  : config.NODE_ENV === 'production'
    ? (remoteAuthDelivery ?? unavailableAuthDelivery())
    : new DevelopmentAuthDeliveryAdapter();

function unavailableAuthDelivery(): never {
  throw new Error(
    'Production requires INTEGRATION_SECRET_KEY_BASE64 (product-managed SMTP) or AUTH_DELIVERY_BASE_URL.',
  );
}
const app = await buildApp(config, {
  audit: new PostgresAuditWriter(authControlDatabase.db),
  finance: new PostgresFinanceWriter(tenantDatabase.db, operationsAuthority),
  securityAudit: new PostgresSecurityAuditWriter(authControlDatabase.db),
  sessions: sessionStatus,
  tenantMemberships: new PostgresTenantMembershipStatusReader(authControlDatabase.db),
  supportGrants: new PostgresSupportGrantStatusReader(authControlDatabase.db),
  summaries: new PostgresTenantSummaryReader(tenantDatabase.db),
  staff: new TenantStaffService(
    new PostgresTenantStaffRepository(authControlDatabase.db),
    authDelivery,
    tokenDigestSecret,
  ),
  staffScopes: new PostgresTenantStaffScopeService(tenantDatabase.db, operationsAuthority),
  controlCenter: new PostgresControlCenterService(
    controlDatabase.db,
    {
      keyId: config.CONTROL_CONTEXT_KEY_ID,
      secret: decodeControlContextSecret(config.CONTROL_CONTEXT_SECRET_BASE64),
    },
    undefined,
    integrationRuntime ? { runtime: integrationRuntime, store: integrationStore } : undefined,
  ),
  operations: new PostgresOperationsService(
    tenantDatabase.db,
    operationsAuthority,
    undefined,
    undefined,
    documentStore,
    integrationRuntime,
  ),
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
      { tokenDigestSecret },
    ),
  readiness: async () => {
    await Promise.all([
      assertControlDatabaseReady(controlDatabase.client),
      assertTenantDatabaseReady(tenantDatabase.client),
      ...(documentStore ? [documentStore.ready()] : []),
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
