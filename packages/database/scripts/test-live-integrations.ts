import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import {
  configurePlatformIntegration,
  createDatabase,
  executeIntegrationSettingsCommand,
  PostgresPlatformIntegrationStore,
  readPlatformIntegrationSettings,
  readTenantIntegrationDelivery,
  readTenantIntegrationSettings,
  recordPlatformIntegrationTest,
  signControlContext,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for product-managed integration settings on PostgreSQL 18:
 * platform settings under the signed Control Center context, runtime-role delivery reads and
 * OTP digests, and tenant settings under the signed Operations context with RLS scoping.
 */
const controlAdminUrl = process.env.TENANT_STAFF_TEST_ADMIN_DATABASE_URL;
const controlApiUrl = process.env.TENANT_STAFF_TEST_API_DATABASE_URL;
const tenantAdminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const tenantRuntimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!controlAdminUrl || !controlApiUrl || !tenantAdminUrl || !tenantRuntimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Integration settings acceptance requires the control and tenant test DSNs.');
  }
  console.log('Integration settings acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [controlAdminUrl, controlApiUrl, tenantAdminUrl, tenantRuntimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Integration settings acceptance is restricted to local isp_test.',
  );
}

const controlAdmin = postgres(controlAdminUrl, { max: 2, prepare: false });
const controlApi = createDatabase(controlApiUrl);
const tenantAdmin = postgres(tenantAdminUrl, { max: 2, prepare: false });
const tenantRuntime = createDatabase(tenantRuntimeUrl);
const controlKeyId = `integration-control-${randomUUID()}`;
const controlSecret = randomBytes(32);
const operationsKeyId = `integration-operations-${randomUUID()}`;
const operationsSecret = randomBytes(32);
const actorId = randomUUID();
const platformUserId = randomUUID();
const tenantId = randomUUID() as VerifiedTenantId;
const tenantActorId = randomUUID();
const ciphertext = (label: string) => Buffer.from(`sealed:${label}:${randomUUID()}`);

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function controlMutation(
  action: string,
  idempotencyKey: string,
  requestHash: string,
  reason: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    idempotencyKey,
    requestHash,
    reason,
    authorization: signControlContext(
      {
        keyId: controlKeyId,
        actorId,
        sessionId: `session-${actorId}`,
        permission: 'platform.integration.manage',
        action,
        requestId: randomUUID(),
        requestHash,
        idempotencyKey,
        ipAddress: '127.0.0.1',
        reason,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      controlSecret,
    ),
  };
}

function tenantAuthorization(
  action: string,
  permission: Permission,
  idempotencyKey = randomUUID(),
  overrides: Record<string, unknown> = {},
) {
  return signOperationsAttestation(
    {
      keyId: operationsKeyId,
      tenantId,
      actorId: tenantActorId,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      permission,
      action,
      idempotencyKey,
      reason: 'Synthetic integration settings acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    operationsSecret,
  );
}

try {
  await controlAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`INSERT INTO control_center_context_keys(key_id,secret,active_from)
      VALUES(${controlKeyId},${controlSecret},clock_timestamp()-interval '1 minute')`;
  });
  await controlAdmin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction`INSERT INTO users(id,account_kind,email,display_name,password_hash)
      VALUES(${platformUserId},'platform',${`${platformUserId}@integration.invalid`},'Integration Admin','not-a-login')`;
    await transaction`INSERT INTO tenants(id,code,brand_name,legal_name,status)
      VALUES(${tenantId},${`INTG-${tenantId}`},'Integration proof','Integration proof','active')`;
    await transaction`INSERT INTO users(id,account_kind,email,display_name,password_hash)
      VALUES(${tenantActorId},'tenant',${`${tenantActorId}@integration.invalid`},'Integration Owner','not-a-login')`;
  });
  await tenantAdmin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [operationsKeyId, operationsSecret.toString('hex')],
    );
  });

  // --- Platform settings under the signed Control Center context -------------------------
  const smtpConfig = {
    host: 'smtp.example.test',
    port: 587,
    security: 'starttls',
    username: 'mailer',
    fromAddress: 'noreply@example.test',
  };
  const configureKey = `configure-${randomUUID()}`;
  // The platform SMTP row is a singleton, so a rerun on the same database continues from its
  // current version instead of assuming an empty table.
  const baseline = await readPlatformIntegrationSettings(
    controlApi.db,
    controlMutation(
      'integration.read',
      `read-${randomUUID()}`,
      hash({}),
      'Read platform integration settings.',
    ).authorization,
  );
  const baseVersion = baseline.settings.find((setting) => setting.kind === 'smtp')?.version;
  const expectedFirst = (baseVersion ?? 0) + 1;
  const configureHash = hash({ kind: 'smtp', smtpConfig, fingerprint: 'fp-1' });
  const first = await configurePlatformIntegration(controlApi.db, {
    ...controlMutation(
      'integration.configure',
      configureKey,
      configureHash,
      'Configure platform SMTP',
    ),
    kind: 'smtp',
    config: smtpConfig,
    active: true,
    secretCiphertext: ciphertext('smtp'),
    cipherKeyId: 'integration-1',
    protectedFields: ['password'],
    keepSecrets: false,
    ...(baseVersion !== undefined ? { expectedVersion: baseVersion } : {}),
  });
  assert.equal(first.version, expectedFirst);
  assert.equal(first.secretConfigured, true);
  assert.deepEqual(first.protectedFields, ['password']);
  assert.equal(first.replay, false);
  assert.ok(!('secretCiphertext' in first), 'ciphertext must never be part of a result');
  // Same key + same hash replays the committed result instead of writing a second version.
  const replay = await configurePlatformIntegration(controlApi.db, {
    ...controlMutation(
      'integration.configure',
      configureKey,
      configureHash,
      'Configure platform SMTP',
    ),
    kind: 'smtp',
    config: smtpConfig,
    active: true,
    secretCiphertext: ciphertext('smtp-retry'),
    cipherKeyId: 'integration-1',
    protectedFields: ['password'],
    keepSecrets: false,
  });
  assert.equal(replay.version, expectedFirst);
  assert.equal(replay.replay, true);
  // Same key with a different credential fingerprint is a different request.
  await assert.rejects(
    configurePlatformIntegration(controlApi.db, {
      ...controlMutation(
        'integration.configure',
        configureKey,
        hash({ fingerprint: 'fp-2' }),
        'Configure platform SMTP',
      ),
      kind: 'smtp',
      config: smtpConfig,
      active: true,
      secretCiphertext: ciphertext('smtp-other'),
      cipherKeyId: 'integration-1',
      protectedFields: ['password'],
      keepSecrets: false,
    }),
    /idempotency/iu,
  );
  // Stale version is refused; keeping the secret preserves the stored ciphertext.
  await assert.rejects(
    configurePlatformIntegration(controlApi.db, {
      ...controlMutation(
        'integration.configure',
        `configure-${randomUUID()}`,
        hash({ stale: true }),
        'Stale update',
      ),
      kind: 'smtp',
      config: { ...smtpConfig, port: 465, security: 'tls' },
      active: true,
      protectedFields: [],
      keepSecrets: true,
      expectedVersion: expectedFirst + 6,
    }),
    /changed/iu,
  );
  const second = await configurePlatformIntegration(controlApi.db, {
    ...controlMutation(
      'integration.configure',
      `configure-${randomUUID()}`,
      hash({ keep: true }),
      'Switch to implicit TLS',
    ),
    kind: 'smtp',
    config: { ...smtpConfig, port: 465, security: 'tls' },
    active: true,
    protectedFields: [],
    keepSecrets: true,
    expectedVersion: expectedFirst,
  });
  assert.equal(second.version, expectedFirst + 1);
  assert.equal(second.secretConfigured, true);
  // A wrong permission/action pairing is refused by the database, not just the API.
  await assert.rejects(
    configurePlatformIntegration(controlApi.db, {
      ...controlMutation(
        'integration.configure',
        `configure-${randomUUID()}`,
        hash({ wrong: true }),
        'Wrong authority',
        {
          permission: 'platform.client.manage',
        },
      ),
      kind: 'smtp',
      config: smtpConfig,
      active: true,
      protectedFields: [],
      keepSecrets: true,
      expectedVersion: expectedFirst + 1,
    }),
  );

  const tested = await recordPlatformIntegrationTest(controlApi.db, {
    ...controlMutation(
      'integration.test',
      `test-${randomUUID()}`,
      hash({ test: 1 }),
      'Verify platform SMTP',
    ),
    kind: 'smtp',
    status: 'passed',
    message: 'Test email accepted by smtp.example.test: 250 queued',
    recipientMasked: 'o***@example.test',
    providerReference: '<abc@example.test>',
  });
  assert.equal(tested.lastTestStatus, 'passed');
  assert.equal(tested.status, undefined);

  const readKey = `read-${randomUUID()}`;
  const workspace = await readPlatformIntegrationSettings(
    controlApi.db,
    controlMutation('integration.read', readKey, hash({}), 'Read platform integration settings.')
      .authorization,
  );
  assert.equal(workspace.settings.length, 1);
  assert.equal(workspace.settings[0]?.version, expectedFirst + 1);
  assert.equal(
    workspace.recentEvents.filter(
      (event) => event.action === 'configure' && event.version >= expectedFirst,
    ).length,
    2,
  );
  assert.equal(
    workspace.recentEvents.filter(
      (event) => event.action === 'test' && event.version >= expectedFirst,
    ).length,
    1,
  );
  assert.equal(workspace.recentDeliveries[0]?.purpose, 'integration_test');
  assert.equal(workspace.recentDeliveries[0]?.recipient, 'o***@example.test');
  assert.ok(!JSON.stringify(workspace).includes('sealed:'), 'reads must never expose ciphertext');

  // --- Runtime-role delivery reads and OTP digests (no request context) -------------------
  const store = new PostgresPlatformIntegrationStore(controlApi.db);
  const delivery = await store.readIntegration('smtp');
  assert(delivery, 'active SMTP settings must be readable by the delivery runtime');
  assert.equal(delivery.version, expectedFirst + 1);
  assert.equal(delivery.cipherKeyId, 'integration-1');
  assert.ok(
    delivery.secretCiphertext &&
      Buffer.from(delivery.secretCiphertext).toString('utf8').startsWith('sealed:smtp:'),
  );
  assert.equal(await store.readIntegration('sms'), null);
  const target = await store.readTarget(platformUserId);
  assert.deepEqual(target, {
    userId: platformUserId,
    email: `${platformUserId}@integration.invalid`,
    displayName: 'Integration Admin',
    accountKind: 'platform',
  });
  const challengeId = randomUUID();
  const now = new Date();
  await store.storeOtp(challengeId, 'digest-correct', new Date(now.getTime() + 60_000));
  assert.equal(await store.verifyOtp(challengeId, 'digest-wrong', now, 3), false);
  assert.equal(await store.verifyOtp(challengeId, 'digest-wrong', now, 3), false);
  assert.equal(await store.verifyOtp(challengeId, 'digest-wrong', now, 3), false);
  // Attempts exhausted: even the right digest no longer verifies.
  assert.equal(await store.verifyOtp(challengeId, 'digest-correct', now, 3), false);
  const freshChallenge = randomUUID();
  await store.storeOtp(freshChallenge, 'digest-correct', new Date(now.getTime() + 60_000));
  assert.equal(await store.verifyOtp(freshChallenge, 'digest-correct', now, 3), true);
  assert.equal(await store.verifyOtp(freshChallenge, 'digest-correct', now, 3), false);
  assert.equal(
    await store.verifyOtp(freshChallenge, 'digest-correct', new Date(now.getTime() + 120_000), 3),
    false,
  );
  await store.recordDelivery({
    purpose: 'otp',
    channel: 'smtp',
    recipientMasked: 'm***@example.test',
    status: 'sent',
    providerReference: '<otp@example.test>',
    userId: platformUserId,
  });
  const [deliveryRow] = await controlAdmin.unsafe(
    "SELECT purpose,status,recipient_masked FROM platform_message_deliveries WHERE user_id=$1 AND purpose='otp'",
    [platformUserId],
  );
  assert.equal(deliveryRow?.status, 'sent');
  await assert.rejects(
    controlAdmin.unsafe('DELETE FROM platform_message_deliveries WHERE user_id=$1', [
      platformUserId,
    ]),
    /append-only|audit/iu,
  );

  // --- Tenant settings under the signed Operations context --------------------------------
  const tenantEvidence = {
    reasonEn: 'Configure the customer SMS provider',
    reasonAr: 'تهيئة مزوّد الرسائل النصية للعملاء',
    evidence: 'Provider contract SMS-2026-01 signed by the ISP owner.',
  };
  const smsPayload = {
    action: 'configure',
    kind: 'sms',
    config: { provider: 'twilio', accountSid: `AC${'a'.repeat(32)}`, fromNumber: '+96170000000' },
    active: true,
    keepProtected: false,
    protectedFields: ['authToken'],
    cipherKeyId: 'integration-1',
    cipherFingerprint: 'fp-sms-1',
    ...tenantEvidence,
  };
  const smsKey = randomUUID();
  const created = await executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
    payload: smsPayload,
    secretCiphertext: ciphertext('sms'),
    authorization: tenantAuthorization(
      'tenant.integration.configure',
      'tenant.secret.manage',
      smsKey,
    ),
  });
  assert.equal(created.version, 1);
  assert.equal(created.secretConfigured, true);
  assert.equal(created.replayed, false);
  const replayed = await executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
    payload: smsPayload,
    secretCiphertext: ciphertext('sms-retry'),
    authorization: tenantAuthorization(
      'tenant.integration.configure',
      'tenant.secret.manage',
      smsKey,
    ),
  });
  assert.equal(replayed.version, 1);
  assert.equal(replayed.replayed, true);
  await assert.rejects(
    executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
      payload: { ...smsPayload, cipherFingerprint: 'fp-sms-2' },
      secretCiphertext: ciphertext('sms-other'),
      authorization: tenantAuthorization(
        'tenant.integration.configure',
        'tenant.secret.manage',
        smsKey,
      ),
    }),
  );
  // Secrets inside the payload itself are refused before anything is written.
  await assert.rejects(
    executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
      payload: { ...smsPayload, config: { ...smsPayload.config, authToken: 'leak' } },
      authorization: tenantAuthorization('tenant.integration.configure', 'tenant.secret.manage'),
    }),
  );
  // Branch-scoped and support-grant signatures are outside tenant-wide secret authority.
  await assert.rejects(
    executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
      payload: { ...smsPayload, expectedVersion: 1 },
      authorization: tenantAuthorization(
        'tenant.integration.configure',
        'tenant.secret.manage',
        randomUUID(),
        {
          branchIds: [randomUUID()],
        },
      ),
    }),
  );
  await assert.rejects(
    executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
      payload: { ...smsPayload, expectedVersion: 1 },
      authorization: tenantAuthorization(
        'tenant.integration.configure',
        'tenant.user.administer',
        randomUUID(),
      ),
    }),
  );
  const kept = await executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
    payload: {
      ...smsPayload,
      expectedVersion: 1,
      keepProtected: true,
      protectedFields: [],
      cipherKeyId: undefined,
      cipherFingerprint: undefined,
      active: false,
    },
    authorization: tenantAuthorization('tenant.integration.configure', 'tenant.secret.manage'),
  });
  assert.equal(kept.version, 2);
  assert.equal(kept.active, false);
  assert.equal(kept.secretConfigured, true);
  // Inactive settings are invisible to delivery; reactivating restores them.
  assert.equal(
    await readTenantIntegrationDelivery(
      tenantRuntime.db,
      tenantId,
      tenantAuthorization('tenant.integration.test', 'tenant.secret.manage'),
      'sms',
    ),
    null,
  );
  const reactivated = await executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
    payload: {
      ...smsPayload,
      expectedVersion: 2,
      keepProtected: true,
      protectedFields: [],
      cipherKeyId: undefined,
      cipherFingerprint: undefined,
      active: true,
    },
    authorization: tenantAuthorization('tenant.integration.configure', 'tenant.secret.manage'),
  });
  assert.equal(reactivated.version, 3);
  const stored = await readTenantIntegrationDelivery(
    tenantRuntime.db,
    tenantId,
    tenantAuthorization('tenant.integration.test', 'tenant.secret.manage'),
    'sms',
  );
  assert(stored, 'active tenant settings must be readable for a provider test');
  assert.equal(stored.cipherKeyId, 'integration-1');
  assert.ok(
    Buffer.from(stored.secretCiphertext ?? [])
      .toString('utf8')
      .startsWith('sealed:sms:'),
  );
  const recorded = await executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
    payload: {
      action: 'record_test',
      kind: 'sms',
      status: 'failed',
      message: 'Twilio rejected the message (401: Authenticate).',
      recipientMasked: '+961****111',
      errorCode: 'PROVIDER_REJECTED',
      ...tenantEvidence,
    },
    authorization: tenantAuthorization('tenant.integration.test', 'tenant.secret.manage'),
  });
  assert.equal(recorded.lastTestStatus, 'failed');
  assert.equal(recorded.status, 'failed');
  // The configure action cannot be replayed through the test signature and vice versa.
  await assert.rejects(
    executeIntegrationSettingsCommand(tenantRuntime.db, tenantId, {
      payload: {
        action: 'record_test',
        kind: 'sms',
        status: 'passed',
        message: 'x',
        ...tenantEvidence,
      },
      authorization: tenantAuthorization('tenant.integration.configure', 'tenant.secret.manage'),
    }),
  );

  const tenantWorkspace = await readTenantIntegrationSettings(
    tenantRuntime.db,
    tenantId,
    tenantAuthorization('tenant.integration.read', 'tenant.user.administer'),
  );
  assert.equal(tenantWorkspace.settings.length, 1);
  assert.equal(tenantWorkspace.settings[0]?.version, 3);
  assert.equal(tenantWorkspace.events.length, 4);
  assert.equal(tenantWorkspace.events[0]?.action, 'test');
  assert.equal(tenantWorkspace.events[0]?.reasonAr, tenantEvidence.reasonAr);
  assert.ok(
    !JSON.stringify(tenantWorkspace).includes('sealed:'),
    'tenant reads must never expose ciphertext',
  );
  // A branch-scoped reader sees nothing: provider settings are tenant-wide by construction.
  const scoped = await readTenantIntegrationSettings(
    tenantRuntime.db,
    tenantId,
    tenantAuthorization('tenant.integration.read', 'tenant.user.administer', randomUUID(), {
      branchIds: [randomUUID()],
    }),
  );
  assert.equal(scoped.settings.length, 0);
  assert.equal(scoped.events.length, 0);
  const [outbox] = await tenantAdmin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND resource_type='operations_integration_settings'",
    [tenantId],
  );
  assert.equal(outbox?.count, 4);
  await assert.rejects(
    tenantAdmin.unsafe('DELETE FROM operations_integration_setting_events WHERE tenant_id=$1', [
      tenantId,
    ]),
  );

  console.log('Integration settings acceptance passed.');
} finally {
  await controlAdmin
    .begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`UPDATE control_center_context_keys SET active_until=clock_timestamp() WHERE key_id=${controlKeyId}`;
    })
    .catch(() => {});
  await tenantAdmin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      operationsKeyId,
    ])
    .catch(() => {});
  await Promise.allSettled([
    controlAdmin.end(),
    tenantAdmin.end(),
    controlApi.client.end(),
    tenantRuntime.client.end(),
  ]);
}
