import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  assignControlSubscription,
  approveControlSubscriptionTransition,
  createControlClient,
  createControlPackageVersion,
  createDatabase,
  drainControlSubscriptionStateOutbox,
  drainOperationsAuditOutbox,
  inOperationsTransaction,
  readControlSubscriptionStateBacklog,
  readOperationsRelayBacklog,
  signControlContext,
  signOperationsAttestation,
  transitionControlSubscription,
} from '../src/index.js';

const requiredEnvironment = {
  controlAdminUrl: process.env.OPERATIONS_RELAY_TEST_CONTROL_ADMIN_DATABASE_URL,
  tenantAdminUrl: process.env.OPERATIONS_RELAY_TEST_TENANT_ADMIN_DATABASE_URL,
  controlApiUrl: process.env.OPERATIONS_RELAY_TEST_CONTROL_API_DATABASE_URL,
  tenantRuntimeUrl: process.env.OPERATIONS_RELAY_TEST_TENANT_RUNTIME_DATABASE_URL,
  controlRelayUrl: process.env.OPERATIONS_RELAY_TEST_CONTROL_RELAY_DATABASE_URL,
  tenantRelayUrl: process.env.OPERATIONS_RELAY_TEST_TENANT_RELAY_DATABASE_URL,
};

if (Object.values(requiredEnvironment).some((value) => !value)) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Operations relay integration requires separate control and tenant DSNs.');
  }
  console.log('Operations relay integration skipped: separate-plane DSNs are not configured.');
  process.exit(0);
}

const environment = requiredEnvironment as Record<keyof typeof requiredEnvironment, string>;
const controlAdmin = postgres(environment.controlAdminUrl, { max: 2, prepare: false });
const tenantAdmin = postgres(environment.tenantAdminUrl, { max: 2, prepare: false });
const controlApi = createDatabase(environment.controlApiUrl);
const tenantRuntime = createDatabase(environment.tenantRuntimeUrl);
const controlRelay = createDatabase(environment.controlRelayUrl);
const tenantRelay = createDatabase(environment.tenantRelayUrl);

const tenantId = randomUUID() as VerifiedTenantId;
const actorId = randomUUID();
const controlSecret = randomBytes(32);
const operationsSecret = randomBytes(32);
const controlKeyId = `control-relay-${randomUUID()}`;
const operationsKeyId = `operations-relay-${randomUUID()}`;

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function controlRequest(
  permission: Permission,
  action: string,
  idempotencyKey: string,
  options: { actorId?: string; mfa?: boolean } = {},
) {
  const requestActorId = options.actorId ?? actorId;
  const hash = requestHash({ tenantId, permission, action, idempotencyKey, requestActorId });
  return {
    idempotencyKey,
    requestHash: hash,
    reason: 'Separate-plane Operations relay integration verification',
    authorization: signControlContext(
      {
        keyId: controlKeyId,
        actorId: requestActorId,
        sessionId: randomUUID(),
        permission,
        action,
        requestId: randomUUID(),
        requestHash: hash,
        idempotencyKey,
        ipAddress: '127.0.0.1',
        reason: 'Separate-plane Operations relay integration verification',
        ...(options.mfa ? { mfaVerifiedAt: new Date().toISOString() } : {}),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      controlSecret,
    ),
  };
}

try {
  await Promise.all([
    controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`INSERT INTO tenants(id,code,brand_name,legal_name,status)
        VALUES(${tenantId},${`CONTROL-${tenantId}`},'Relay test','Relay test','active')`;
    }),
    tenantAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`INSERT INTO tenants(id,code,brand_name,legal_name,status)
        VALUES(${tenantId},${`TENANT-${tenantId}`},'Relay test','Relay test','active')`;
    }),
  ]);
  await Promise.all([
    controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`INSERT INTO control_center_context_keys(key_id,secret,active_from)
        VALUES(${controlKeyId},${controlSecret},clock_timestamp())`;
    }),
    tenantAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`INSERT INTO operations_context_keys(key_id,secret,active_from)
        VALUES(${operationsKeyId},${operationsSecret},clock_timestamp())`;
    }),
  ]);

  await createControlClient(controlApi.db, {
    tenantId,
    legalName: 'Relay Test ISP SAL',
    tradingName: 'Relay Test ISP',
    ...controlRequest('platform.client.manage', 'client.create', 'relay-client-0001'),
  });
  const packageResult = (await createControlPackageVersion(controlApi.db, {
    packageKey: `relay-${tenantId.slice(0, 8)}`,
    version: 1,
    nameEn: 'Relay test package',
    nameAr: 'باقة اختبار الترحيل',
    entitlements: ['operations'],
    priceMinor: 100,
    currency: 'USD',
    effectiveFrom: new Date(Date.now() - 60_000),
    ...controlRequest('platform.subscription.manage', 'package.create', 'relay-package-0001'),
  })) as { id: string };
  await assignControlSubscription(controlApi.db, {
    tenantId,
    packageVersionId: packageResult.id,
    state: 'active',
    startsAt: new Date(),
    ...controlRequest(
      'platform.subscription.manage',
      'subscription.assign',
      'relay-subscription-0001',
    ),
  });
  const transitionRequest = await transitionControlSubscription(controlApi.db, {
    tenantId,
    expectedState: 'active',
    expectedRevision: 1,
    toState: 'restricted',
    ...controlRequest(
      'platform.subscription.manage',
      'transition.request',
      'relay-transition-request-0001',
    ),
  });
  assert.equal(transitionRequest.status, 'pending');
  assert(transitionRequest.approvalRequestId);
  const approvalOutcomes = await Promise.allSettled([
    approveControlSubscriptionTransition(controlApi.db, {
      approvalRequestId: transitionRequest.approvalRequestId,
      ...controlRequest(
        'platform.subscription.manage',
        'transition.approve',
        'relay-transition-approval-0001',
        { actorId: randomUUID(), mfa: true },
      ),
    }),
    approveControlSubscriptionTransition(controlApi.db, {
      approvalRequestId: transitionRequest.approvalRequestId,
      ...controlRequest(
        'platform.subscription.manage',
        'transition.approve',
        'relay-transition-approval-0002',
        { actorId: randomUUID(), mfa: true },
      ),
    }),
  ]);
  assert.equal(
    approvalOutcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
    'exactly one separate approver must execute a restrictive transition',
  );
  assert.equal(
    approvalOutcomes.filter((outcome) => outcome.status === 'rejected').length,
    1,
    'the competing approval must fail after the request is decided',
  );

  const operationsContext = signOperationsAttestation(
    {
      keyId: operationsKeyId,
      tenantId,
      actorId,
      sessionId: randomUUID(),
      permission: 'tenant.user.administer',
      action: 'tenant.operations.configure',
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      reason: 'Separate-plane Operations relay integration verification',
      idempotencyKey: 'relay-operations-0001',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    operationsSecret,
  );
  await inOperationsTransaction(tenantRuntime.db, tenantId, operationsContext, async (tx) => {
    await tx.execute(sql`
      INSERT INTO operations_branches(tenant_id,code,name_en,name_ar)
      VALUES(${tenantId},'RELAY','Relay branch','فرع الترحيل')
    `);
  });

  assert.equal((await readControlSubscriptionStateBacklog(controlRelay.db, tenantId)).count, 2);
  assert.equal((await readOperationsRelayBacklog(tenantRelay.db, tenantId)).count, 1);

  assert.equal(
    await drainControlSubscriptionStateOutbox(
      controlRelay.db,
      tenantRelay.db,
      tenantId,
      new Date(),
    ),
    2,
  );
  assert.equal(
    await drainOperationsAuditOutbox(tenantRelay.db, controlRelay.db, tenantId, new Date()),
    1,
  );

  const [subscriptionState] = await tenantAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    return transaction`
      SELECT status,revision FROM operations_platform_subscription_events
      WHERE tenant_id=${tenantId} ORDER BY revision DESC LIMIT 1
    `;
  });
  assert.equal(subscriptionState?.status, 'restricted');
  assert.equal(Number(subscriptionState?.revision), 2);
  const [latestSource] = await tenantAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    return transaction`
      SELECT source_event_id,recorded_at FROM operations_platform_subscription_events
      WHERE tenant_id=${tenantId} ORDER BY revision DESC LIMIT 1
    `;
  });
  await assert.rejects(
    tenantAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      return transaction`SELECT record_operations_platform_subscription_state(
        ${latestSource.source_event_id}::uuid,${tenantId}::uuid,'active',2,
        ${new Date(latestSource.recorded_at as Date | string).toISOString()}::timestamptz
      )`;
    }),
    /event identity conflicts/u,
  );
  const [audit] = await controlAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return transaction`
      SELECT result,actor_reference,request_reference,permission,metadata
      FROM audit_events WHERE tenant_id=${tenantId} AND action='tenant.operations.configure'
    `;
  });
  assert.equal(audit?.result, 'allowed');
  assert.equal(audit?.actor_reference, actorId);
  assert.equal(audit?.permission, 'tenant.user.administer');
  assert.equal(
    (audit?.metadata as { tenantPlaneEventId?: string }).tenantPlaneEventId !== undefined,
    true,
  );
  assert.equal((await readControlSubscriptionStateBacklog(controlRelay.db, tenantId)).count, 0);
  assert.equal((await readOperationsRelayBacklog(tenantRelay.db, tenantId)).count, 0);

  console.log('Operations relay integration passed: state and audit crossed separate planes.');
} finally {
  await Promise.allSettled([
    controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`
        UPDATE control_center_context_keys SET active_until=clock_timestamp()
        WHERE key_id=${controlKeyId}
      `;
    }),
    tenantAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`
        UPDATE operations_context_keys SET active_until=clock_timestamp()
        WHERE key_id=${operationsKeyId}
      `;
    }),
  ]);
  await Promise.allSettled([
    controlAdmin.end(),
    tenantAdmin.end(),
    controlApi.client.end(),
    tenantRuntime.client.end(),
    controlRelay.client.end(),
    tenantRelay.client.end(),
  ]);
}
