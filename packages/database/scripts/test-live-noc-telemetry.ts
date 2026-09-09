import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type {
  NetworkInfrastructureCommand,
  NetworkResourceCommand,
  NocAlarmCommand,
  Permission,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  createOutageIncident,
  executeNetworkCommand,
  executeNocAlarmCommand,
  inOperationsTransaction,
  readNocWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for NOC telemetry on PostgreSQL 18: alarms raised from real worker outcomes
 * (deduplicated, escalated, cleared on success), operator alarms with acknowledge/clear/link,
 * maintenance windows that suppress alarms inside them, incident SLA, scope and immutability.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
const workerUrl = process.env.SALES_TEST_NETWORK_WORKER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !workerUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('NOC telemetry acceptance requires the SALES_TEST database URLs.');
  }
  console.log('NOC telemetry acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl, workerUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'NOC telemetry acceptance is restricted to local isp_test.',
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
const keyId = `noc-telemetry-${randomUUID()}`;
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
const reasons = {
  reasonEn: 'NOC telemetry acceptance run',
  reasonAr: 'تشغيل قبول قياس مركز المراقبة',
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
      reason: 'Synthetic NOC telemetry acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const alarm = (
  command: NocAlarmCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeNocAlarmCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.noc.alarm.manage',
      options.permission ?? 'tenant.network.job.create',
      options.key,
      options.overrides,
    ),
  });
const read = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readNocWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.noc.workspace.read',
      'tenant.network.view',
      randomUUID(),
      overrides,
    ),
  });
const enqueue = (action: 'suspend' | 'restore', key: string) =>
  runtime.db.transaction(async (tx) => {
    const authorization = sign('tenant.network.job.create', 'tenant.network.job.create');
    await tx.execute(
      sql`SELECT begin_operations_request_context(${authorization.attestationText}, ${authorization.signatureHex})`,
    );
    await tx.execute(sql`INSERT INTO operations_network_action_outbox(tenant_id,service_id,branch_id,area_id,route_id,action,payload,idempotency_key,requested_by)
      VALUES(${tenantId},${serviceId},${branchId},${areaId},${routeId},${action},${action === 'suspend' ? '{"reasonCode":"nonpayment"}' : '{}'}::jsonb,${key},${actorId})`);
  });
/** Drive one attempt the way the worker does: claim the job, then persist the outcome. */
async function attempt(
  state: 'retry_scheduled' | 'dead_lettered' | 'succeeded' | 'failed',
  errorClass?: string,
) {
  const [claimed] = await worker.unsafe(
    "SELECT job, lease_token FROM network_worker.claim_job('noc-acceptance', clock_timestamp(), 30000)",
  );
  assert(claimed, 'worker could not claim a job');
  const job = claimed.job as Record<string, unknown>;
  const attempts = Array.isArray(job.attempts) ? (job.attempts as unknown[]) : [];
  const outcome = errorClass
    ? {
        classification: 'definite_failure',
        requestId: randomUUID(),
        errorClass,
        retryable: state === 'retry_scheduled',
        safeMessage: 'synthetic',
      }
    : { classification: 'definite_success', requestId: randomUUID(), latencyMs: 12 };
  const saved = {
    ...job,
    state,
    availableAt: new Date().toISOString(),
    attempts: [...attempts, { attempt: attempts.length + 1, outcome }],
    ...(errorClass ? { lastErrorClass: errorClass } : {}),
  };
  const [result] = await worker.unsafe(
    'SELECT network_worker.save_job($1, $2::uuid, $3::jsonb) AS ok',
    ['noc-acceptance', claimed.lease_token as string, saved],
  );
  assert.equal(result?.ok, true);
}
const liveAlarms = async (overrides: Record<string, unknown> = {}) =>
  (await read({}, overrides)).alarms;

try {
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'NOC proof','NOC proof','active')",
      [tenantId, `NOC-${tenantId}`],
    );
    await transaction.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'NOC operator','not-a-login')",
      [actorId, `${actorId}@noc.invalid`],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'network_operator',ARRAY['tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve'],'{}'::jsonb)",
      [tenantId, actorId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'NOC-B','NOC branch','فرع المراقبة'),($3,$2,'NOC-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'NOC-A','NOC area','منطقة المراقبة')",
      [areaId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'NOC-R','NOC route','مسار المراقبة')",
      [routeId, tenantId, branchId, areaId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'NOC-H','NOC household',$3)",
      [householdId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','2 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'NOC-SUB','noc-subscriber-1','fixture',$3,$4,'NOC customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key,network_profile_reference) VALUES($1,$2,'NOC-P','NOC plan','خطة المراقبة',1000,'USD',$3,'noc-plan-0001','profile-50m')",
      [planId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'NOC-SVC','active',clock_timestamp(),1,$6,$7,$8,'noc-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_platform_subscription_events(source_event_id,tenant_id,status,revision,source) VALUES($1,$2,'active',1,'noc-acceptance')",
      [randomUUID(), tenantId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Router and binding so real worker jobs exist for this service ------------------------
  const registerRouter: NetworkInfrastructureCommand = {
    action: 'register_router',
    routerId: 'edge-noc',
    endpoint: 'https://edge-noc.network.invalid/rest',
    routerAccessReference: 'secret://routers/edge-noc',
    connector: 'routeros-rest',
    enabled: true,
    ...reasons,
    evidence: 'Synthetic acceptance fixture NOC-2026-09.',
  };
  await executeNetworkCommand(runtime.db, tenantId, {
    command: registerRouter,
    authorization: sign('tenant.network.infrastructure.manage', 'tenant.network.bulk.approve'),
  });
  const resource = (command: NetworkResourceCommand) =>
    executeNetworkCommand(runtime.db, tenantId, {
      command,
      authorization: sign('tenant.network.resource.manage', 'tenant.network.job.create'),
    });
  const pool = await resource({
    action: 'create_ip_pool',
    poolName: 'noc-static',
    subnetCidr: '198.51.100.0/29',
    gateway: '198.51.100.1',
    purpose: 'static_public',
    ...reasons,
    evidence: 'Synthetic acceptance fixture NOC-2026-09.',
  });
  const allocation = await resource({
    action: 'allocate_service_address',
    poolId: pool.poolId as string,
    serviceId,
    ...reasons,
    evidence: 'Synthetic acceptance fixture NOC-2026-09.',
  });
  const bind: NetworkResourceCommand = {
    action: 'bind_service',
    serviceId,
    routerId: 'edge-noc',
    accountName: 'noc-sub',
    pppAccessReference: 'secret://ppp/noc-sub',
    staticAddress: allocation.address as string,
    ...reasons,
    evidence: 'Synthetic acceptance fixture NOC-2026-09.',
  };
  await resource(bind);

  // --- Worker outcomes become deduplicated router alarms ------------------------------------
  // Other fixtures may have left open jobs behind; park them so the claim below is ours.
  await asOwner(
    "UPDATE network_worker.jobs SET available_at = clock_timestamp() + interval '1 day' WHERE tenant_id <> $1 AND state IN ('queued','retry_scheduled','reconciling')",
    [tenantId],
  );
  await enqueue('suspend', `noc-suspend-${tenantId}`);
  await attempt('retry_scheduled', 'offline');
  let alarms = await liveAlarms();
  assert.equal(alarms.length, 1);
  const routerAlarm = alarms[0];
  assert(routerAlarm);
  assert.equal(routerAlarm.alarmCode, 'ROUTER_UNREACHABLE');
  assert.equal(routerAlarm.source, 'worker');
  assert.equal(routerAlarm.severity, 'major');
  assert.equal(routerAlarm.routerId, 'edge-noc');
  assert.equal(routerAlarm.routeId, routeId);
  assert.equal(routerAlarm.serviceNumber, 'NOC-SVC');
  assert.equal(routerAlarm.occurrenceCount, 1);
  await attempt('retry_scheduled', 'timeout');
  alarms = await liveAlarms();
  assert.equal(alarms.length, 1, 'a repeated failure refreshes the same alarm');
  assert.equal(alarms[0]?.occurrenceCount, 2);
  assert.equal(alarms[0]?.version, 2);
  // Acknowledge with a note; the version guard refuses a stale acknowledgement.
  await assert.rejects(
    alarm({ action: 'acknowledge_alarm', alarmId: routerAlarm.id, expectedVersion: 1, ...reasons }),
    /changed/u,
  );
  const ackKey = randomUUID();
  const acknowledged = await alarm(
    {
      action: 'acknowledge_alarm',
      alarmId: routerAlarm.id,
      expectedVersion: 2,
      note: 'Field team sent to the edge cabinet',
      ...reasons,
    },
    { key: ackKey },
  );
  assert.equal(acknowledged.status, 'acknowledged');
  assert.deepEqual(
    await alarm(
      {
        action: 'acknowledge_alarm',
        alarmId: routerAlarm.id,
        expectedVersion: 2,
        note: 'Field team sent to the edge cabinet',
        ...reasons,
      },
      { key: ackKey },
    ),
    acknowledged,
    'exact replay returns the same answer',
  );
  await assert.rejects(
    alarm(
      { action: 'acknowledge_alarm', alarmId: routerAlarm.id, expectedVersion: 3, ...reasons },
      { key: ackKey },
    ),
    /different content|acknowledged/u,
  );
  assert.equal((await liveAlarms())[0]?.acknowledgedBy, 'NOC operator');
  // A viewer cannot acknowledge; a support grant cannot act.
  await assert.rejects(
    alarm(
      { action: 'clear_alarm', alarmId: routerAlarm.id, expectedVersion: 3, ...reasons },
      { permission: 'tenant.network.view' },
    ),
  );
  await assert.rejects(
    alarm(
      { action: 'clear_alarm', alarmId: routerAlarm.id, expectedVersion: 3, ...reasons },
      { overrides: { supportGrantId: randomUUID() } },
    ),
  );
  // A worker success clears the router alarm without operator action.
  await attempt('succeeded');
  alarms = await liveAlarms();
  assert.equal(alarms.length, 0);
  const history = (await read({ alarms: 'all' })).alarms;
  assert.equal(history[0]?.status, 'cleared');
  assert(history[0]?.clearedAt);
  assert.equal(history[0]?.version, 4);

  // --- Maintenance windows suppress alarms raised inside them --------------------------------
  await assert.rejects(
    alarm({
      action: 'create_maintenance',
      titleEn: 'Edge cabinet power work',
      titleAr: 'أعمال طاقة خزانة الطرف',
      routerId: 'edge-noc',
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 1_800_000).toISOString(),
      expectedImpact: 'outage',
      ...reasons,
    }),
    /future/u,
  );
  const maintenance = await alarm({
    action: 'create_maintenance',
    titleEn: 'Edge cabinet power work',
    titleAr: 'أعمال طاقة خزانة الطرف',
    routerId: 'edge-noc',
    startsAt: new Date(Date.now() - 600_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    expectedImpact: 'outage',
    notesEn: 'Generator swap at the cabinet',
    ...reasons,
  });
  assert.equal(maintenance.status, 'planned');
  const maintenanceId = maintenance.maintenanceId as string;
  await enqueue('restore', `noc-restore-${tenantId}`);
  await attempt('dead_lettered', 'offline');
  alarms = await liveAlarms();
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0]?.severity, 'critical', 'a dead letter escalates the alarm');
  assert.equal(alarms[0]?.maintenanceId, maintenanceId, 'raised inside the window');
  let workspace = await read();
  assert.equal(workspace.alarmSummary.active, 1);
  assert.equal(workspace.alarmSummary.critical, 1);
  assert.equal(workspace.alarmSummary.suppressed, 1);
  assert.equal(workspace.maintenanceWindows[0]?.suppressedAlarms, 1);
  assert.deepEqual(workspace.routerIds, ['edge-noc']);
  const started = await alarm({
    action: 'update_maintenance',
    maintenanceId,
    expectedVersion: 1,
    status: 'in_progress',
    ...reasons,
  });
  assert.equal(started.status, 'in_progress');
  await assert.rejects(
    alarm({
      action: 'update_maintenance',
      maintenanceId,
      expectedVersion: 2,
      status: 'planned',
      ...reasons,
    }),
    /transition/u,
  );
  const completed = await alarm({
    action: 'update_maintenance',
    maintenanceId,
    expectedVersion: 2,
    status: 'completed',
    notesEn: 'Generator replaced and verified',
    ...reasons,
  });
  assert.equal(completed.status, 'completed');
  await assert.rejects(
    alarm({
      action: 'update_maintenance',
      maintenanceId,
      expectedVersion: 3,
      status: 'cancelled',
      ...reasons,
    }),
    /closed|transition/u,
  );

  // --- Operator alarms: raise, duplicate refused, link to an incident, clear -----------------
  const incident = await createOutageIncident(runtime.db, tenantId, {
    command: {
      titleEn: 'Edge cabinet down',
      titleAr: 'تعطل خزانة الطرف',
      routeId,
      severity: 'critical',
      serviceIds: [serviceId],
      reasonEn: 'Customers on the edge cabinet lost service',
      reasonAr: 'فقد عملاء خزانة الطرف الخدمة',
    },
    authorization: sign('tenant.noc.incident.create', 'tenant.network.job.create'),
  });
  const manual = await alarm({
    action: 'raise_alarm',
    deviceName: 'olt-noc-1',
    severity: 'major',
    alarmCode: 'PON_LOS',
    messageEn: 'Loss of signal on PON port 3',
    messageAr: 'فقدان الإشارة على منفذ PON رقم 3',
    routeId,
    ...reasons,
  });
  assert.equal(manual.status, 'active');
  await assert.rejects(
    alarm({
      action: 'raise_alarm',
      deviceName: 'olt-noc-1',
      severity: 'minor',
      alarmCode: 'PON_LOS',
      messageEn: 'Loss of signal on PON port 3',
      messageAr: 'فقدان الإشارة على منفذ PON رقم 3',
      ...reasons,
    }),
    /already open/u,
  );
  await assert.rejects(
    alarm({
      action: 'raise_alarm',
      deviceName: 'olt-noc-1',
      severity: 'minor',
      alarmCode: 'lowercase',
      messageEn: 'bad code',
      messageAr: 'رمز غير صالح',
      ...reasons,
    }),
  );
  const linked = await alarm({
    action: 'link_alarm_incident',
    alarmId: manual.alarmId as string,
    expectedVersion: 1,
    outageId: incident.id,
    ...reasons,
  });
  assert.equal(linked.outageId, incident.id);
  workspace = await read();
  const recorded = workspace.incidents.find((i) => i.id === incident.id);
  assert.equal(recorded?.linkedAlarms, 1);
  assert.equal(recorded?.slaBreached, false);
  assert.equal(
    Date.parse(recorded?.slaDueAt ?? '') - Date.parse(recorded?.startedAt ?? ''),
    3_600_000,
    'critical incidents carry a one hour target',
  );
  const cleared = await alarm({
    action: 'clear_alarm',
    alarmId: manual.alarmId as string,
    expectedVersion: 2,
    ...reasons,
  });
  assert.equal(cleared.status, 'cleared');
  await assert.rejects(
    alarm({
      action: 'link_alarm_incident',
      alarmId: manual.alarmId as string,
      expectedVersion: 3,
      outageId: incident.id,
      ...reasons,
    }),
    /cleared/u,
  );

  // --- Scope, support grants and immutability ------------------------------------------------
  const elsewhere = await read({ alarms: 'all' }, { branchIds: [otherBranchId] });
  assert.equal(elsewhere.alarms.length, 0, 'route-bound alarms stay inside the route scope');
  assert.equal(elsewhere.maintenanceWindows.length, 1, 'a router-only window is tenant-wide');
  await assert.rejects(read({}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.noc.alarm.manage', 'tenant.network.job.create'),
      (tx) =>
        tx.execute(
          sql`UPDATE operations_noc_events SET reason_en='tampered' WHERE tenant_id=${tenantId}`,
        ),
    ),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_network_alarms WHERE tenant_id=$1', [tenantId]),
  );
  const [events] = await admin.unsafe(
    'SELECT count(*)::int AS count FROM operations_noc_events WHERE tenant_id=$1',
    [tenantId],
  );
  assert.equal(events?.count, 7);
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action='tenant.noc.alarm.manage'",
    [tenantId],
  );
  assert.equal(audit?.count, 7);
  // The API runtime identity cannot write alarms directly; only signed commands and the worker can.
  await assert.rejects(
    runtime.client.unsafe(
      "INSERT INTO operations_network_alarms(tenant_id,device_name,severity,alarm_code,message_en,message_ar,source) VALUES($1,'forged','critical','FORGED','x','x','worker')",
      [tenantId],
    ),
  );
  console.log('NOC telemetry acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), worker.end(), runtime.client.end()]);
}
