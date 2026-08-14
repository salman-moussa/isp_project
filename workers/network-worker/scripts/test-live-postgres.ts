import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { PostgresDurableNetworkStore } from '../src/production/postgres-store.js';
import type { NetworkJobRequest } from '../src/domain.js';

const owner = postgres(required('NETWORK_TEST_MIGRATION_URL'), { max: 1, prepare: false });
const workerClient = postgres(required('NETWORK_TEST_DATABASE_URL'), { max: 2, prepare: true });
const tenantId = randomUUID();
const routerId = `router-${randomUUID()}`;
const actorId = randomUUID();
const branchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const serviceId = randomUUID();
const installationId = randomUUID();
const contextKey = randomBytes(32);
const contextKeyId = `network-live-${randomUUID()}`;

try {
  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`INSERT INTO tenants(id,code,brand_name,legal_name,status)
      VALUES (${tenantId}::uuid,${`network-${tenantId}`},'Network Live','Network Live LLC','active')`;
    await transaction`SELECT network_worker.register_router(
      ${tenantId},${routerId},'https://router.example/','secret://router/live','routeros-rest',true
    )`;
    await transaction`INSERT INTO users(id,account_kind,email,display_name,password_hash)
      VALUES(${actorId}::uuid,'tenant',${`${actorId}@network.invalid`},'Network operator','not-a-login')`;
    await transaction`SELECT set_config('app.tenant_id',${tenantId},true)`;
    await transaction`INSERT INTO tenant_memberships(
      tenant_id,user_id,role_key,permissions,scope,active
    ) VALUES(
      ${tenantId}::uuid,${actorId}::uuid,'isp_administrator',
      ARRAY['tenant.user.administer','tenant.subscriber.create','tenant.invoice.create',
        'tenant.installation.manage','tenant.network.job.create']::text[],'{}'::jsonb,true
    )`;
    await transaction`INSERT INTO operations_context_keys(key_id,secret,active_from)
      VALUES(${contextKeyId},${contextKey},clock_timestamp())`;
    let [attestation, signature] = signedContext(
      'tenant.user.administer',
      'tenant.operations.configure',
      'network-config-live-0001',
    );
    await transaction`SELECT begin_operations_request_context(${attestation},${signature})`;
    await transaction`INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar)
      VALUES(${branchId}::uuid,${tenantId}::uuid,'BEI','Beirut','بيروت')`;
    await transaction`INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar)
      VALUES(${areaId}::uuid,${tenantId}::uuid,${branchId}::uuid,'HAM','Hamra','الحمرا')`;
    await transaction`INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar)
      VALUES(${routeId}::uuid,${tenantId}::uuid,${branchId}::uuid,${areaId}::uuid,'R1','Route 1','المسار ١')`;
    [attestation, signature] = signedContext(
      'tenant.subscriber.create',
      'tenant.subscriber.create',
      'network-subscriber-live-0001',
    );
    await transaction`SELECT begin_operations_request_context(${attestation},${signature})`;
    await transaction`INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id)
      VALUES(${householdId}::uuid,${tenantId}::uuid,'HH-1','Network household',${branchId}::uuid)`;
    await transaction`INSERT INTO operations_locations(
      id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id
    ) VALUES(
      ${locationId}::uuid,${tenantId}::uuid,${householdId}::uuid,'Primary','Beirut',
      ${branchId}::uuid,${areaId}::uuid,${routeId}::uuid
    )`;
    await transaction`INSERT INTO operations_subscribers(
      id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,
      primary_location_id,display_name,status,branch_id,area_id,route_id
    ) VALUES(
      ${subscriberId}::uuid,${tenantId}::uuid,'SUB-1','network-subscriber-0001','network-live',
      ${householdId}::uuid,${locationId}::uuid,'Network subscriber','active',
      ${branchId}::uuid,${areaId}::uuid,${routeId}::uuid
    )`;
    [attestation, signature] = signedContext(
      'tenant.invoice.create',
      'tenant.plan.version.create',
      'network-plan-live-0001',
    );
    await transaction`SELECT begin_operations_request_context(${attestation},${signature})`;
    await transaction`INSERT INTO operations_plans(
      id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,
      network_profile_reference,branch_id,idempotency_key
    ) VALUES(
      ${planId}::uuid,${tenantId}::uuid,'PLAN-1','Plan 1','الخطة ١',1000,'USD',
      'standard',${branchId}::uuid,'network-plan-0001'
    )`;
    [attestation, signature] = signedContext(
      'tenant.installation.manage',
      'tenant.service.installation.create',
      'network-service-live-0001',
    );
    await transaction`SELECT begin_operations_request_context(${attestation},${signature})`;
    await transaction`INSERT INTO operations_services(
      id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,
      billing_anchor_day,activated_at,branch_id,area_id,route_id,idempotency_key
    ) VALUES(
      ${serviceId}::uuid,${tenantId}::uuid,${subscriberId}::uuid,${locationId}::uuid,
      ${planId}::uuid,'SERVICE-1','active',1,clock_timestamp(),${branchId}::uuid,
      ${areaId}::uuid,${routeId}::uuid,'network-service-0001'
    )`;
    await transaction`INSERT INTO operations_installations(
      id,tenant_id,service_id,status,branch_id,area_id,route_id,idempotency_key
    ) VALUES(
      ${installationId}::uuid,${tenantId}::uuid,${serviceId}::uuid,'completed',
      ${branchId}::uuid,${areaId}::uuid,${routeId}::uuid,'network-install-0001'
    )`;
    await transaction`INSERT INTO operations_platform_subscription_events(
      source_event_id,tenant_id,status,revision,source,recorded_at
    ) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,'active',1,'control-center-relay',clock_timestamp())`;
    await transaction`SELECT network_worker.register_service_binding(
      ${tenantId}::uuid,${serviceId}::uuid,${routerId},'subscriber-live',
      'secret://subscriber/live','default',NULL,NULL,true
    )`;
  });
  const sql = {
    query: async <Row>(text: string, parameters: readonly unknown[]) => ({
      rows: (await workerClient.unsafe(text, parameters as never[])) as unknown as readonly Row[],
    }),
  };
  const firstStore = new PostgresDurableNetworkStore(sql, 'worker-live-a', 30_000);
  const secondStore = new PostgresDurableNetworkStore(sql, 'worker-live-b', 30_000);
  const request: NetworkJobRequest = {
    requestId: randomUUID(),
    idempotencyKey: `network-${randomUUID()}`,
    tenantId,
    routerId,
    subscriberServiceId: randomUUID(),
    action: {
      kind: 'pppoe.restore',
      desired: {
        accountName: 'subscriber-live',
        enabled: true,
        profileId: 'standard',
        ipAssignment: { mode: 'dynamic', poolId: 'default' },
      },
    },
    origin: 'tenant-network-operation',
    actorId: randomUUID(),
    permission: 'tenant.network.job.create',
    reason: 'Live durable queue verification.',
  };
  const [validation] = await workerClient.unsafe<
    {
      kind: string;
      tenant_valid: boolean;
      key_valid: boolean;
      request_valid: boolean;
      router_valid: boolean;
      service_valid: boolean;
      action_kind: string;
    }[]
  >(
    `SELECT jsonb_typeof($1::jsonb) AS kind,
      coalesce($1::jsonb->>'tenantId','') ~ '^[0-9a-f-]{36}$' AS tenant_valid,
      length(btrim(coalesce($1::jsonb->>'idempotencyKey',''))) BETWEEN 8 AND 200 AS key_valid,
      length(btrim(coalesce($1::jsonb->>'requestId',''))) >= 8 AS request_valid,
      length(btrim(coalesce($1::jsonb->>'routerId',''))) >= 1 AS router_valid,
      length(btrim(coalesce($1::jsonb->>'subscriberServiceId',''))) >= 1 AS service_valid,
      jsonb_typeof($1::jsonb->'action') AS action_kind`,
    [request],
  );
  assert.deepEqual(validation, {
    kind: 'object',
    tenant_valid: true,
    key_valid: true,
    request_valid: true,
    router_valid: true,
    service_valid: true,
    action_kind: 'object',
  });
  const queued = await firstStore.enqueue(request, new Date());
  assert.equal((await firstStore.enqueue(request, new Date())).jobId, queued.jobId);
  const claimed = await firstStore.claimNext(new Date());
  assert.equal(claimed?.jobId, queued.jobId);
  assert.equal(await secondStore.claimNext(new Date()), undefined);
  await firstStore.save({ ...claimed!, state: 'succeeded' });
  assert.equal((await firstStore.get(queued.jobId))?.state, 'succeeded');
  assert.equal(
    (await firstStore.getRouter(tenantId, routerId))?.credentialReference,
    'secret://router/live',
  );
  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    const [attestation, signature] = signedContext(
      'tenant.network.job.create',
      'tenant.network.job.create',
      'network-bridge-live-0002',
    );
    await transaction`SELECT begin_operations_request_context(${attestation},${signature})`;
    await transaction`INSERT INTO operations_network_action_outbox(
      tenant_id,service_id,action,payload,idempotency_key,requested_by,branch_id,area_id,route_id
    ) VALUES(
      ${tenantId}::uuid,${serviceId}::uuid,'restore','{}'::jsonb,
      'network-bridge-live-0002',${actorId},${branchId}::uuid,${areaId}::uuid,${routeId}::uuid
    )`;
  });
  const bridged = await firstStore.claimNext(new Date());
  assert.equal(bridged?.request.subscriberServiceId, serviceId);
  assert.equal(bridged?.request.action.kind, 'pppoe.restore');
  assert.equal(bridged?.request.routerId, routerId);
  process.stdout.write(
    'Network store integration passed: idempotency, lease claim, save, router lookup, atomic Operations bridge.\n',
  );
} finally {
  await Promise.all([owner.end({ timeout: 5 }), workerClient.end({ timeout: 5 })]);
}

function signedContext(permission: string, action: string, idempotencyKey: string) {
  const attestation = stableJson({
    keyId: contextKeyId,
    tenantId,
    actorId,
    sessionId: randomUUID(),
    permission,
    action,
    requestId: randomUUID(),
    ipAddress: '127.0.0.1',
    reason: 'Live atomic Operations to Network Worker bridge verification.',
    idempotencyKey,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return [attestation, createHmac('sha256', contextKey).update(attestation).digest('hex')] as const;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
