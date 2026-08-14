import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase } from '../src/client.js';
import {
  authenticateCollectAccessToken,
  authorizeCollectDevice,
  rotateCollectTokens,
} from '../src/collect/index.js';
import { signOperationsAttestation } from '../src/operations/index.js';
import type { VerifiedTenantId } from '@isp/contracts';

const migrationUrl = required('COLLECT_TEST_MIGRATION_URL');
const runtimeUrl = required('COLLECT_TEST_RUNTIME_URL');
const owner = postgres(migrationUrl, { max: 1, prepare: false });
const runtime = createDatabase(runtimeUrl);
const tenantId = randomUUID() as VerifiedTenantId;
const userId = randomUUID();
const sessionId = randomUUID();
const keyId = `collect-live-${randomUUID()}`;
const secret = new Uint8Array(32).fill(9);
const now = new Date();

try {
  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`INSERT INTO tenants(id,code,brand_name,legal_name,status)
      VALUES (${tenantId}::uuid,${`collect-${tenantId}`},'Collect Live','Collect Live LLC','active')`;
    await transaction`INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required)
      VALUES (${userId}::uuid,'tenant',${`collector-${userId}@example.test`},'Collector Live','disabled-live-hash',true)`;
    await transaction.unsafe(`SELECT set_config('app.tenant_id','${tenantId}',true)`);
    await transaction`INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope)
      VALUES (${tenantId}::uuid,${userId}::uuid,'collector',
        ARRAY['tenant.collection.view','tenant.payment.post','tenant.collection.reconcile'],
        '{}'::jsonb)`;
    await transaction`INSERT INTO operations_context_keys(key_id,secret,active_from)
      VALUES (${keyId},decode(${Buffer.from(secret).toString('hex')},'hex'),clock_timestamp()-interval '1 minute')`;
  });

  const authorization = signOperationsAttestation(
    {
      keyId,
      tenantId,
      actorId: userId,
      sessionId,
      permission: 'tenant.collection.view',
      action: 'tenant.collect.device.authorize',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      reason: 'Live integration authorization for a collector-owned device.',
      idempotencyKey: `collect-device-${randomUUID()}`,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
    secret,
  );
  const access = digest(`access-${randomUUID()}`);
  const refresh = digest(`refresh-${randomUUID()}`);
  const device = await authorizeCollectDevice(runtime.db, tenantId, {
    authorization,
    collectorUserId: userId,
    sourceSessionId: sessionId,
    deviceLabel: 'Live collector test device',
    devicePublicKeyThumbprint: `sha256:${randomUUID()}`,
    mfaVerifiedAt: now,
    accessTokenDigest: access,
    refreshTokenDigest: refresh,
    accessExpiresAt: new Date(now.getTime() + 10 * 60_000),
    refreshExpiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
    scopes: [
      'assignments:read',
      'payments:create',
      'reconciliations:submit',
      'receipts:print:audit',
    ],
  });
  assert.equal(device.tenantId, tenantId);
  assert.equal(
    (await authenticateCollectAccessToken(runtime.db, access))?.deviceId,
    device.deviceId,
  );

  const nextAccess = digest(`next-access-${randomUUID()}`);
  const nextRefresh = digest(`next-refresh-${randomUUID()}`);
  const rotated = await rotateCollectTokens(runtime.db, {
    presentedRefreshTokenDigest: refresh,
    accessTokenDigest: nextAccess,
    refreshTokenDigest: nextRefresh,
    accessExpiresAt: new Date(Date.now() + 10 * 60_000),
    refreshExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
  });
  assert.equal(rotated?.deviceId, device.deviceId);
  assert.equal(await authenticateCollectAccessToken(runtime.db, access), null);

  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction.unsafe(`SELECT set_config('app.tenant_id','${tenantId}',true)`);
    await transaction`UPDATE tenant_memberships SET active=false
      WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
  });
  assert.equal(await authenticateCollectAccessToken(runtime.db, nextAccess), null);
  process.stdout.write(
    'Collect integration passed: signed authorization, digest rotation, membership revocation.\n',
  );
} finally {
  await Promise.all([owner.end({ timeout: 5 }), runtime.client.end({ timeout: 5 })]);
}

function digest(value: string): Uint8Array {
  return createHash('sha256').update(value, 'utf8').digest();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
