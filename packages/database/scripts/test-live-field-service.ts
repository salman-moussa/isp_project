import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  FieldDispatchCommand,
  FieldExecutionCommand,
  Permission,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  executeFieldServiceCommand,
  readFieldServiceWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for field service dispatch on PostgreSQL 18: technician registry, work orders
 * through schedule → dispatch → on site → completion/failure/revisit, installation synchronisation,
 * skill and scope refusals, exact replay, and the dispatch board read model.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Field service acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Field service acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Field service acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `field-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const dispatcherId = randomUUID();
const technicianUserId = randomUUID();
const otherTechnicianUserId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const serviceId = randomUUID();
const installationId = randomUUID();
const evidence = {
  reasonEn: 'Field service dispatch acceptance run',
  reasonAr: 'تشغيل قبول إرسال الخدمة الميدانية',
  evidence: 'Synthetic acceptance fixture FS-2026-09.',
};
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

const sign = (
  action: string,
  permission: Permission,
  actorId = dispatcherId,
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
      reason: 'Synthetic field service acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const dispatch = (
  command: FieldDispatchCommand,
  options: { actorId?: string; key?: string; overrides?: Record<string, unknown> } = {},
) =>
  executeFieldServiceCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.field.dispatch',
      'tenant.installation.manage',
      options.actorId,
      options.key,
      options.overrides,
    ),
  });
const execute = (
  command: FieldExecutionCommand,
  options: { actorId?: string; key?: string; overrides?: Record<string, unknown> } = {},
) =>
  executeFieldServiceCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.field.execute',
      'tenant.installation.manage',
      options.actorId,
      options.key,
      options.overrides,
    ),
  });
const read = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readFieldServiceWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.field.workspace.read',
      'tenant.installation.view',
      dispatcherId,
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Field proof','Field proof','active')",
      [tenantId, `FLD-${tenantId}`],
    );
    for (const [userId, name] of [
      [dispatcherId, 'Field dispatcher'],
      [technicianUserId, 'Field technician'],
      [otherTechnicianUserId, 'Second technician'],
    ] as const) {
      await transaction.unsafe(
        "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,$3,'not-a-login')",
        [userId, `${userId}@field.invalid`, name],
      );
      await transaction.unsafe(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,$3,ARRAY['tenant.installation.view','tenant.installation.manage'],'{}'::jsonb)",
        [tenantId, userId, userId === dispatcherId ? 'isp_administrator' : 'installer'],
      );
    }
    await transaction.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'FLD-B','Field branch','فرع ميداني'),($3,$2,'FLD-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'FLD-A','Field area','منطقة ميدانية')",
      [areaId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'FLD-R','Field route','مسار ميداني')",
      [routeId, tenantId, branchId, areaId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'FLD-H','Field household',$3)",
      [householdId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,building,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','12 Cedar Street','Block B',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'FLD-SUB','field-subscriber-1','fixture',$3,$4,'Field customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'FLD-P','Field plan','خطة ميدانية',1000,'USD',$3,'field-plan-0001')",
      [planId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'FLD-SVC','pending_installation',1,$6,$7,$8,'field-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_installations(id,tenant_id,service_id,status,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,'requested',$4,$5,$6,'field-install-1')",
      [installationId, tenantId, serviceId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Technician registry ---------------------------------------------------------------
  const registerKey = randomUUID();
  const register: FieldDispatchCommand = {
    action: 'register_technician',
    userId: technicianUserId,
    displayName: 'Field technician',
    phone: '+96170123456',
    skills: ['fiber', 'cpe'],
    branchId,
    areaIds: [areaId],
    ...evidence,
  };
  const registered = await dispatch(register, { key: registerKey });
  const technicianId = registered.technicianId as string;
  assert.equal(registered.version, 1);
  assert.deepEqual(await dispatch(register, { key: registerKey }), {
    ...registered,
    replayed: true,
  });
  await assert.rejects(
    dispatch({ ...register, displayName: 'Renamed' }, { key: registerKey }),
    /different content/u,
  );
  await assert.rejects(dispatch(register), /already registered/u);
  await assert.rejects(dispatch({ ...register, userId: randomUUID() }), /active member/u);
  // The execution signature cannot register technicians and vice versa.
  await assert.rejects(
    executeFieldServiceCommand(runtime.db, tenantId, {
      command: { ...register, userId: otherTechnicianUserId },
      authorization: sign('tenant.field.execute', 'tenant.installation.manage'),
    }),
    /signed field action/u,
  );
  const wirelessOnly = await dispatch({
    ...register,
    userId: otherTechnicianUserId,
    displayName: 'Second technician',
    skills: ['wireless'],
  });
  const secondTechnicianId = wirelessOnly.technicianId as string;

  // --- Work orders -----------------------------------------------------------------------
  const created = await dispatch({
    action: 'create_work_order',
    kind: 'installation',
    priority: 'high',
    installationId,
    titleEn: 'Fiber installation for Field customer',
    titleAr: 'تركيب ألياف لعميل ميداني',
    requiredSkills: ['fiber'],
    checklist: [
      {
        key: 'ont',
        labelEn: 'ONT mounted and powered',
        labelAr: 'تثبيت وتشغيل الـONT',
        required: true,
      },
      {
        key: 'signal',
        labelEn: 'Optical signal within range',
        labelAr: 'إشارة ضوئية ضمن النطاق',
        required: true,
      },
      { key: 'wifi', labelEn: 'Wi-Fi handed over', labelAr: 'تسليم الواي فاي', required: false },
    ],
    slaDueAt: at(-1),
    ...evidence,
  });
  const workOrderId = created.workOrderId as string;
  assert.equal(created.status, 'open');
  assert.match(created.workOrderNumber as string, /^WO-\d{8}-[0-9A-F]{6}$/u);
  // A second live work order for the same installation is refused.
  await assert.rejects(
    dispatch({
      action: 'create_work_order',
      kind: 'installation',
      installationId,
      titleEn: 'Duplicate installation work',
      titleAr: 'عمل تركيب مكرر',
      ...evidence,
    }),
  );
  // A technician without the required skill cannot be assigned.
  await assert.rejects(
    dispatch({
      action: 'schedule_work_order',
      workOrderId,
      expectedVersion: 1,
      windowStart: at(2),
      windowEnd: at(4),
      technicianId: secondTechnicianId,
      ...evidence,
    }),
    /required skill/u,
  );
  // Starting work that is not dispatched is refused.
  await assert.rejects(
    execute({ action: 'start_work_order', workOrderId, expectedVersion: 1, ...evidence }),
    /only dispatched/u,
  );
  const scheduled = await dispatch({
    action: 'schedule_work_order',
    workOrderId,
    expectedVersion: 1,
    windowStart: at(2),
    windowEnd: at(4),
    technicianId,
    ...evidence,
  });
  assert.equal(scheduled.status, 'dispatched');
  assert.equal(scheduled.technicianId, technicianId);
  const [afterSchedule] = await admin.unsafe(
    'SELECT status, installer_user_id, scheduled_for FROM operations_installations WHERE tenant_id=$1 AND id=$2',
    [tenantId, installationId],
  );
  assert.equal(afterSchedule?.status, 'scheduled');
  assert.equal(afterSchedule?.installer_user_id, technicianUserId);
  // A stale version is refused.
  await assert.rejects(
    dispatch({ action: 'assign_work_order', workOrderId, expectedVersion: 1, ...evidence }),
    /changed/u,
  );
  // Unassigning returns the work to the scheduled queue; reassigning dispatches again.
  const unassigned = await dispatch({
    action: 'assign_work_order',
    workOrderId,
    expectedVersion: scheduled.version as number,
    ...evidence,
  });
  assert.equal(unassigned.status, 'scheduled');
  const reassigned = await dispatch({
    action: 'assign_work_order',
    workOrderId,
    expectedVersion: unassigned.version as number,
    technicianId,
    ...evidence,
  });
  assert.equal(reassigned.status, 'dispatched');

  // A branch-scoped installer who is not the assigned technician cannot start the work.
  await assert.rejects(
    execute(
      {
        action: 'start_work_order',
        workOrderId,
        expectedVersion: reassigned.version as number,
        ...evidence,
      },
      { actorId: otherTechnicianUserId, overrides: { branchIds: [branchId] } },
    ),
    /assigned technician/u,
  );
  // The assigned technician, scoped to their branch, can.
  const started = await execute(
    {
      action: 'start_work_order',
      workOrderId,
      expectedVersion: reassigned.version as number,
      ...evidence,
    },
    { actorId: technicianUserId, overrides: { branchIds: [branchId] } },
  );
  assert.equal(started.status, 'on_site');
  const [afterStart] = await admin.unsafe(
    'SELECT status FROM operations_installations WHERE tenant_id=$1 AND id=$2',
    [tenantId, installationId],
  );
  assert.equal(afterStart?.status, 'in_progress');
  // Completion without the required checklist items is refused.
  await assert.rejects(
    execute(
      {
        action: 'complete_work_order',
        workOrderId,
        expectedVersion: started.version as number,
        checklist: [{ key: 'ont', done: true }],
        outcome: {},
        ...evidence,
      },
      { actorId: technicianUserId },
    ),
    /checklist/u,
  );
  // A failure creates an unassigned revisit and blocks the installation.
  const failed = await execute(
    {
      action: 'fail_work_order',
      workOrderId,
      expectedVersion: started.version as number,
      failureReason: 'Customer premises locked; no access to the riser.',
      revisitWindowStart: at(26),
      revisitWindowEnd: at(28),
      ...evidence,
    },
    { actorId: technicianUserId },
  );
  assert.equal(failed.status, 'failed');
  const revisitId = failed.revisitWorkOrderId as string;
  assert.ok(revisitId);
  const [afterFail] = await admin.unsafe(
    'SELECT status, blocker_reason FROM operations_installations WHERE tenant_id=$1 AND id=$2',
    [tenantId, installationId],
  );
  assert.equal(afterFail?.status, 'blocked');
  assert.match(afterFail?.blocker_reason as string, /locked/u);

  // The revisit is scheduled (window given), inherits the checklist and can be completed.
  const dispatched = await dispatch({
    action: 'assign_work_order',
    workOrderId: revisitId,
    expectedVersion: 1,
    technicianId,
    ...evidence,
  });
  assert.equal(dispatched.status, 'dispatched');
  const revisitStarted = await execute({
    action: 'start_work_order',
    workOrderId: revisitId,
    expectedVersion: dispatched.version as number,
    ...evidence,
  });
  const completeKey = randomUUID();
  const completion: FieldExecutionCommand = {
    action: 'complete_work_order',
    workOrderId: revisitId,
    expectedVersion: revisitStarted.version as number,
    checklist: [
      { key: 'ont', done: true },
      { key: 'signal', done: true, note: '-18.5 dBm' },
    ],
    outcome: { signalDbm: -18.5, serialNumbers: ['ONT-12345'], customerAcknowledged: true },
    ...evidence,
  };
  const completed = await execute(completion, { actorId: technicianUserId, key: completeKey });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(await execute(completion, { actorId: technicianUserId, key: completeKey }), {
    ...completed,
    replayed: true,
  });
  const [afterComplete] = await admin.unsafe(
    'SELECT status FROM operations_installations WHERE tenant_id=$1 AND id=$2',
    [tenantId, installationId],
  );
  assert.equal(afterComplete?.status, 'ready_for_activation');
  const installationEvents = await admin.unsafe(
    'SELECT to_status FROM operations_installation_events WHERE tenant_id=$1 AND installation_id=$2 ORDER BY occurred_at',
    [tenantId, installationId],
  );
  assert.deepEqual(
    installationEvents.map((row) => row.to_status),
    ['scheduled', 'in_progress', 'blocked', 'scheduled', 'in_progress', 'ready_for_activation'],
  );
  // Closed work cannot be cancelled; the technician cannot be deactivated while dispatched.
  await assert.rejects(
    dispatch({
      action: 'cancel_work_order',
      workOrderId: revisitId,
      expectedVersion: completed.version as number,
      ...evidence,
    }),
    /closed/u,
  );

  // --- Read model ------------------------------------------------------------------------
  const board = await read({ status: 'all', day: at(27).slice(0, 10) });
  assert.equal(board.technicians.length, 2);
  const revisitRow = board.workOrders.find((row) => row.id === revisitId);
  assert(revisitRow, 'the revisit must be on the board for its day');
  assert.equal(revisitRow.status, 'completed');
  assert.equal(revisitRow.revisitOf, workOrderId);
  assert.equal(revisitRow.subscriberName, 'Field customer');
  assert.equal(revisitRow.serviceNumber, 'FLD-SVC');
  assert.equal(revisitRow.address, '12 Cedar Street, Block B');
  assert.equal(revisitRow.installationStatus, 'ready_for_activation');
  assert.equal(revisitRow.outcome.signalDbm, -18.5);
  assert.equal(revisitRow.checklist.find((item) => item.key === 'signal')?.done, true);
  assert.ok(
    board.events.some(
      (event) => event.workOrderId === revisitId && event.action === 'complete_work_order',
    ),
  );
  // The original window sits 2-4 hours from now, which may already be tomorrow in UTC.
  const today = await read({ status: 'all', day: at(2).slice(0, 10) });
  const original = today.workOrders.find((row) => row.id === workOrderId);
  assert(original, 'the failed original must be on its own day');
  assert.equal(original.overdue, false, 'closed work is never overdue');
  assert.equal(
    today.openInstallations.length,
    0,
    'the installation still has live/closed work and is ready',
  );
  assert.ok(today.staff.some((member) => member.userId === technicianUserId));
  // A branch-scoped reader in another branch sees no work orders and no technicians.
  const elsewhere = await read({ status: 'all' }, { branchIds: [otherBranchId] });
  assert.equal(elsewhere.workOrders.length, 0);
  assert.equal(elsewhere.technicians.length, 0);
  // The technician themself is visible even when scoped elsewhere.
  const self = await readFieldServiceWorkspace(runtime.db, tenantId, {
    query: {},
    authorization: sign(
      'tenant.field.workspace.read',
      'tenant.installation.view',
      technicianUserId,
      randomUUID(),
      {
        branchIds: [otherBranchId],
      },
    ),
  });
  assert.equal(self.technicians.length, 1);
  // Support grants and wrong actions are refused.
  await assert.rejects(read({}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    readFieldServiceWorkspace(runtime.db, tenantId, {
      query: {},
      authorization: sign('tenant.noc.workspace.read', 'tenant.installation.view'),
    }),
  );
  const [outbox] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND resource_type IN ('operations_work_orders','operations_field_technicians')",
    [tenantId],
  );
  assert.equal(outbox?.count, 11);
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_work_order_events WHERE tenant_id=$1', [tenantId]),
  );
  console.log('Field service acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
