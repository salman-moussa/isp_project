import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  NetworkInfrastructureCommand,
  NetworkResourceCommand,
  Permission,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  executeNetworkCommand,
  readNetworkWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for network resources on PostgreSQL 18: router registry under the approval
 * authority, IPAM pools with conflict-safe allocation, service bindings that feed the RouterOS
 * worker, NAS clients, CPE registry, durable job cancel/retry, RADIUS accounting ingest and the
 * scoped workspace read.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
const workerUrl = process.env.SALES_TEST_NETWORK_WORKER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !workerUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Network resources acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Network resources acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl, workerUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Network resources acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const worker = postgres(workerUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const asOwner = (query: string, params: unknown[]) =>
  admin.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE orvex_owner');
    return tx.unsafe(query, params as never);
  });
const keyId = `network-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const actorId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const serviceId = randomUUID();
const evidence = {
  reasonEn: 'Network resources acceptance run',
  reasonAr: 'تشغيل قبول موارد الشبكة',
  evidence: 'Synthetic acceptance fixture NET-2026-09.',
};

const sign = (
  action: string,
  permission: Permission,
  idempotencyKey = randomUUID(),
  overrides: Record<string, unknown> = {},
) =>
  signOperationsAttestation(
    {
      keyId,
      tenantId,
      actorId,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      permission,
      action,
      idempotencyKey,
      reason: 'Synthetic network acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const infrastructure = (
  command: NetworkInfrastructureCommand,
  options: { key?: string; permission?: Permission; action?: string } = {},
) =>
  executeNetworkCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      options.action ?? 'tenant.network.infrastructure.manage',
      options.permission ?? 'tenant.network.bulk.approve',
      options.key,
    ),
  });
const resource = (
  command: NetworkResourceCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeNetworkCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.network.resource.manage',
      options.permission ?? 'tenant.network.job.create',
      options.key,
      options.overrides,
    ),
  });
const read = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readNetworkWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.network.workspace.read',
      'tenant.network.view',
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Network proof','Network proof','active')",
      [tenantId, `NET-${tenantId}`],
    );
    await transaction.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Network operator','not-a-login')",
      [actorId, `${actorId}@network.invalid`],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'network_operator',ARRAY['tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve'],'{}'::jsonb)",
      [tenantId, actorId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'NET-B','Network branch','فرع الشبكة'),($3,$2,'NET-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'NET-A','Network area','منطقة الشبكة')",
      [areaId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'NET-R','Network route','مسار الشبكة')",
      [routeId, tenantId, branchId, areaId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'NET-H','Network household',$3)",
      [householdId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','1 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'NET-SUB','network-subscriber-1','fixture',$3,$4,'Network customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key,network_profile_reference) VALUES($1,$2,'NET-P','Network plan','خطة الشبكة',1000,'USD',$3,'network-plan-0001','profile-50m')",
      [planId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'NET-SVC','active',clock_timestamp(),1,$6,$7,$8,'network-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_platform_subscription_events(source_event_id,tenant_id,status,revision,source) VALUES($1,$2,'active',1,'network-acceptance')",
      [randomUUID(), tenantId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Routers and NAS need the approval authority and the infrastructure action -----------
  const routerKey = randomUUID();
  const registerRouter: NetworkInfrastructureCommand = {
    action: 'register_router',
    routerId: 'core-1',
    endpoint: 'https://core-1.network.invalid/rest',
    routerAccessReference: 'secret://routers/core-1',
    connector: 'routeros-rest',
    enabled: true,
    ...evidence,
  };
  const router = await infrastructure(registerRouter, { key: routerKey });
  assert.equal(router.routerId, 'core-1');
  assert.deepEqual(await infrastructure(registerRouter, { key: routerKey }), {
    ...router,
    replayed: true,
  });
  await assert.rejects(infrastructure(registerRouter), /already registered/u);
  await assert.rejects(
    infrastructure(registerRouter, { permission: 'tenant.network.job.create' }),
    /approval authority|signed network authority/u,
  );
  // The resource signature cannot carry an infrastructure command.
  await assert.rejects(
    executeNetworkCommand(runtime.db, tenantId, {
      command: { ...registerRouter, routerId: 'core-2' },
      authorization: sign('tenant.network.resource.manage', 'tenant.network.bulk.approve'),
    }),
    /approval authority|signed network action/u,
  );
  const nas = await infrastructure({
    action: 'upsert_nas_client',
    nasName: 'core-1-nas',
    ipAddress: '10.255.0.1',
    nasKeyReference: 'secret://nas/core-1',
    nasType: 'mikrotik',
    ...evidence,
  });
  assert.equal(nas.version, 1);
  await assert.rejects(
    infrastructure({
      action: 'upsert_nas_client',
      nasClientId: nas.nasClientId as string,
      expectedVersion: 5,
      nasName: 'core-1-nas',
      ipAddress: '10.255.0.1',
      nasKeyReference: 'secret://nas/core-1',
      ...evidence,
    }),
    /changed/u,
  );

  // --- IPAM ---------------------------------------------------------------------------------
  const pool = await resource({
    action: 'create_ip_pool',
    poolName: 'static-public',
    subnetCidr: '203.0.113.0/29',
    gateway: '203.0.113.1',
    purpose: 'static_public',
    ...evidence,
  });
  const poolId = pool.poolId as string;
  assert.equal(pool.usable, 6);
  await assert.rejects(
    resource({
      action: 'create_ip_pool',
      poolName: 'overlap',
      subnetCidr: '203.0.113.0/28',
      ...evidence,
    }),
    /overlaps/u,
  );
  await assert.rejects(
    resource({
      action: 'create_ip_pool',
      poolName: 'bad-gateway',
      subnetCidr: '10.9.0.0/24',
      gateway: '10.8.0.1',
      ...evidence,
    }),
    /inside the pool/u,
  );
  const allocation = await resource({
    action: 'allocate_service_address',
    poolId,
    serviceId,
    ...evidence,
  });
  // .1 is the gateway, so the first free host is .2.
  assert.equal(allocation.address, '203.0.113.2');
  assert.equal(allocation.allocated, 1);
  await assert.rejects(
    resource({ action: 'allocate_service_address', poolId, serviceId, ...evidence }),
    /already holds/u,
  );
  const reserved = await resource({
    action: 'reserve_address',
    poolId,
    address: '203.0.113.3',
    kind: 'infrastructure',
    label: 'monitoring probe',
    ...evidence,
  });
  assert.equal(reserved.allocated, 2);
  await assert.rejects(
    resource({ action: 'reserve_address', poolId, address: '203.0.113.3', ...evidence }),
  );
  await assert.rejects(
    resource({ action: 'reserve_address', poolId, address: '198.51.100.9', ...evidence }),
    /outside the pool/u,
  );

  // --- Bindings feed the worker; a static binding needs an allocated address ---------------
  await assert.rejects(
    resource({
      action: 'bind_service',
      serviceId,
      routerId: 'core-1',
      accountName: 'net-sub',
      pppAccessReference: 'secret://ppp/net-sub',
      staticAddress: '203.0.113.9',
      ...evidence,
    }),
    /allocated to this service/u,
  );
  const bound = await resource({
    action: 'bind_service',
    serviceId,
    routerId: 'core-1',
    accountName: 'net-sub',
    pppAccessReference: 'secret://ppp/net-sub',
    staticAddress: '203.0.113.2',
    vlanId: '120',
    ...evidence,
  });
  assert.equal(bound.enabled, true);
  // The allocated address cannot be released while an enabled binding uses it.
  await assert.rejects(
    resource({
      action: 'release_address',
      allocationId: allocation.allocationId as string,
      ...evidence,
    }),
    /enabled binding/u,
  );
  const released = await resource({
    action: 'release_address',
    allocationId: reserved.allocationId as string,
    ...evidence,
  });
  assert.equal(released.status, 'released');

  // --- Jobs: a real outbox action becomes a worker job through the binding ------------------
  await runtime.db.transaction(async (tx) => {
    const { sql } = await import('drizzle-orm');
    const authorization = sign('tenant.network.job.create', 'tenant.network.job.create');
    await tx.execute(
      sql`SELECT begin_operations_request_context(${authorization.attestationText}, ${authorization.signatureHex})`,
    );
    await tx.execute(sql`INSERT INTO operations_network_action_outbox(tenant_id,service_id,branch_id,area_id,route_id,action,payload,idempotency_key,requested_by)
      VALUES(${tenantId},${serviceId},${branchId},${areaId},${routeId},'suspend','{"reasonCode":"nonpayment"}'::jsonb,${`net-suspend-${tenantId}`},${actorId})`);
  });
  const [queued] = await asOwner(
    'SELECT job_id, state FROM network_worker.jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1',
    [tenantId],
  );
  assert.equal(queued?.state, 'queued');
  const jobId = queued?.job_id as string;
  const cancelled = await resource({ action: 'cancel_job', jobId, ...evidence });
  assert.equal(cancelled.state, 'canceled');
  await assert.rejects(resource({ action: 'cancel_job', jobId, ...evidence }), /only queued/u);
  // Force a dead letter the way the worker would, then prove retry needs the approval authority.
  await asOwner(
    `UPDATE network_worker.jobs SET state='dead_lettered', job=jsonb_set(jsonb_set(job,'{state}','"dead_lettered"'),'{attempts}','[{"attempt":1},{"attempt":2}]'::jsonb) WHERE job_id=$1`,
    [jobId],
  );
  await assert.rejects(
    resource({ action: 'retry_job', jobId, ...evidence }),
    /approval authority/u,
  );
  const retried = await resource(
    { action: 'retry_job', jobId, ...evidence },
    { permission: 'tenant.network.bulk.approve' },
  );
  assert.equal(retried.state, 'queued');
  const [afterRetry] = await asOwner(
    "SELECT state, jsonb_array_length(job->'attempts') AS attempts, jsonb_array_length(job->'previousAttempts') AS previous, (job->>'manualRetries')::int AS retries FROM network_worker.jobs WHERE job_id=$1",
    [jobId],
  );
  assert.equal(afterRetry?.state, 'queued');
  assert.equal(afterRetry?.attempts, 0);
  assert.equal(afterRetry?.previous, 2);
  assert.equal(afterRetry?.retries, 1);

  // --- CPE registry ------------------------------------------------------------------------
  const cpe = await resource({
    action: 'register_cpe',
    serialNumber: 'ONT-NET-0001',
    model: 'HG8145',
    serviceId,
    ...evidence,
  });
  assert.equal(cpe.serviceId, serviceId);
  await assert.rejects(
    resource({ action: 'register_cpe', serialNumber: 'ONT-NET-0002', serviceId, ...evidence }),
  );
  const updatedCpe = await resource({
    action: 'update_cpe',
    cpeId: cpe.cpeId as string,
    expectedVersion: 1,
    model: 'HG8145V5',
    ...evidence,
  });
  assert.equal(updatedCpe.version, 2);

  // --- RADIUS accounting from the worker identity --------------------------------------------
  const startRecord = {
    statusType: 'start',
    acctSessionId: 'acct-1',
    username: 'net-sub',
    nasIpAddress: '10.255.0.1',
    framedIpAddress: '203.0.113.2',
  };
  const [started] = await worker.unsafe(
    'SELECT network_worker.record_accounting($1::uuid,$2::jsonb) AS result',
    [tenantId, startRecord],
  );
  assert.equal((started?.result as { serviceId: string }).serviceId, serviceId);
  await worker.unsafe('SELECT network_worker.record_accounting($1::uuid,$2::jsonb)', [
    tenantId,
    {
      ...startRecord,
      statusType: 'interim',
      inputOctets: 1000,
      outputOctets: 5000,
    },
  ]);
  await assert.rejects(
    worker.unsafe('SELECT network_worker.record_accounting($1::uuid,$2::jsonb)', [
      tenantId,
      { ...startRecord, nasIpAddress: '10.255.0.99' },
    ]),
    /unregistered NAS/u,
  );
  await assert.rejects(
    admin.unsafe('SELECT public.record_radius_accounting($1::uuid,$2::jsonb)', [
      tenantId,
      startRecord,
    ]),
    /worker identity/u,
  );

  // --- Read model --------------------------------------------------------------------------
  const workspace = await read({ jobs: 'all' });
  assert.equal(workspace.routers.length, 1);
  assert.equal(workspace.routers[0]?.boundServices, 1);
  assert.equal(workspace.routers[0]?.openJobs, 1);
  assert.equal(workspace.bindings[0]?.accountName, 'net-sub');
  assert.equal(workspace.bindings[0]?.staticAddress, '203.0.113.2');
  assert.equal(workspace.jobs.length, 1);
  assert.equal(workspace.jobs[0]?.previousAttempts, 2);
  assert.equal(workspace.pools[0]?.allocated, 1);
  assert.equal(workspace.allocations.filter((a) => a.status === 'allocated').length, 1);
  assert.equal(workspace.nasClients[0]?.activeSessions, 1);
  assert.equal(workspace.sessions[0]?.outputOctets, 5000);
  assert.equal(workspace.cpeDevices[0]?.serviceNumber, 'NET-SVC');
  assert.ok(workspace.events.length >= 9);
  assert.equal(workspace.services.length, 1);
  // A branch-scoped reader elsewhere sees no bindings or jobs for this service.
  const elsewhere = await read({ jobs: 'all' }, { branchIds: [otherBranchId] });
  assert.equal(elsewhere.bindings.length, 0);
  assert.equal(elsewhere.jobs.length, 0);
  await assert.rejects(read({}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_network_events WHERE tenant_id=$1', [tenantId]),
  );
  console.log('Network resources acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), worker.end(), runtime.client.end()]);
}
