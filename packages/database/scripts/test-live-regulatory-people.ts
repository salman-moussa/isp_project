import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  PeopleCommand,
  Permission,
  RegulatoryCommand,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  executePeopleCommand,
  executeRegulatoryCommand,
  readPeopleWorkspace,
  readRegulatoryWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for Regulatory & QoS and People operations on PostgreSQL 18: KPI evidence
 * computed from retained outages, alarms, tickets and services; licences with renewal notice;
 * obligations advanced by submission; submissions with traceable evidence, references and
 * decisions; teams, employees linked to staff identities, shifts with overlap and leave
 * conflicts, leave decided by a different person, training expiry; replay and authority.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Regulatory acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Regulatory acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Regulatory acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `regulatory-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const adminUserId = randomUUID();
const agentId = randomUUID();
const branchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const serviceId = randomUUID();
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = day(0);

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
      actorId: adminUserId,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      permission,
      action,
      idempotencyKey,
      reason: 'Synthetic regulatory and people acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const regulatory = (
  command: RegulatoryCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeRegulatoryCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.regulatory.manage',
      options.permission ?? 'tenant.user.administer',
      options.key,
      options.overrides,
    ),
  });
const people = (
  command: PeopleCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executePeopleCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.people.manage',
      options.permission ?? 'tenant.user.administer',
      options.key,
      options.overrides,
    ),
  });
const readRegulatory = (
  query: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) =>
  readRegulatoryWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.regulatory.workspace.read',
      'tenant.report.view',
      randomUUID(),
      overrides,
    ),
  });
const readPeople = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readPeopleWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.people.workspace.read',
      'tenant.user.administer',
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Regulatory proof','Regulatory proof','active')",
      [tenantId, `REG-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Compliance manager','not-a-login'),($3,'tenant',$4,'Field agent','not-a-login')",
      [adminUserId, `${adminUserId}@regulatory.invalid`, agentId, `${agentId}@regulatory.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'isp_administrator',ARRAY['tenant.user.administer','tenant.report.view'],'{}'::jsonb),($1,$3,'technician',ARRAY['tenant.installation.view'],'{}'::jsonb)",
      [tenantId, adminUserId, agentId],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'REG-B','Regulatory branch','فرع التنظيم')",
      [branchId, tenantId],
    );
    await tx.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'REG-A','Regulatory area','منطقة التنظيم')",
      [areaId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'REG-R','Regulatory route','مسار التنظيم')",
      [routeId, tenantId, branchId, areaId],
    );
    await tx.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'REG-H','Regulatory household',$3)",
      [householdId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','9 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'REG-SUB','regulatory-subscriber-1','fixture',$3,$4,'Regulatory customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'REG-P','Regulatory plan','خطة التنظيم',2500,'USD',$3,'regulatory-plan-0001')",
      [planId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'REG-SVC','active',clock_timestamp(),1,$6,$7,$8,'regulatory-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    // Retained source evidence: one resolved outage of 60 minutes, one critical alarm, one complaint answered in time.
    await tx.unsafe(
      "INSERT INTO operations_outages(tenant_id,outage_title_en,outage_title_ar,affected_region,impacted_subscribers_count,started_at,resolved_at,status,route_id) VALUES($1,'Fiber cut','انقطاع ألياف','REG-A',1,clock_timestamp()-interval '3 hours',clock_timestamp()-interval '2 hours','resolved',$2)",
      [tenantId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_network_alarms(tenant_id,device_name,severity,alarm_code,message_en,message_ar,raised_at,cleared_at,status) VALUES($1,'core-1','critical','LINK_DOWN','Uplink down','انقطاع الوصلة',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '2 hours','cleared')",
      [tenantId],
    );
    await tx.unsafe(
      "INSERT INTO operations_support_issues(tenant_id,subscriber_id,branch_id,area_id,route_id,issue_number,idempotency_key,subject,description,priority,status,category,created_at,first_response_at,sla_respond_due_at,sla_resolve_due_at,closed_at) VALUES($1,$2,$3,$4,$5,'REG-TKT-1','regulatory-ticket-1','Slow speed','Complaint about speed','normal','closed','complaint',clock_timestamp()-interval '12 hours',clock_timestamp()-interval '12 hours'+interval '30 minutes',clock_timestamp()-interval '12 hours'+interval '60 minutes',clock_timestamp()-interval '6 hours',clock_timestamp()-interval '12 hours'+interval '3 hours')",
      [tenantId, subscriberId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Regulatory ----------------------------------------------------------------------------
  await assert.rejects(
    regulatory({ action: 'seed_standard_kpis' }, { permission: 'tenant.report.view' }),
  );
  const seedKey = randomUUID();
  const seeded = await regulatory({ action: 'seed_standard_kpis' }, { key: seedKey });
  assert.equal(seeded.created, 9);
  assert.equal(
    (await regulatory({ action: 'seed_standard_kpis' }, { key: seedKey })).replayed,
    true,
  );
  assert.equal(
    (await regulatory({ action: 'seed_standard_kpis' })).created,
    0,
    'standard set is idempotent',
  );
  const licence = await regulatory({
    action: 'upsert_licence',
    kind: 'isp_licence',
    reference: 'ISP-2026-001',
    authority: 'TRA',
    titleEn: 'ISP licence',
    titleAr: 'رخصة مزود الإنترنت',
    issuedOn: day(-700),
    expiresOn: day(30),
    renewalNoticeDays: 90,
  });
  assert.equal(licence.version, 1);
  await assert.rejects(
    regulatory({
      action: 'upsert_licence',
      licenceId: String(licence.licenceId),
      expectedVersion: 5,
      status: 'renewal_pending',
    }),
    /changed since/u,
  );
  await regulatory({
    action: 'upsert_licence',
    licenceId: String(licence.licenceId),
    expectedVersion: 1,
    status: 'renewal_pending',
  });
  await assert.rejects(
    regulatory({
      action: 'upsert_obligation',
      code: 'QOS-M',
      titleEn: 'Monthly QoS',
      titleAr: 'جودة شهرية',
      authority: 'TRA',
      frequency: 'monthly',
      nextDueOn: today,
      ownerUserId: randomUUID(),
    }),
  );
  const obligation = await regulatory({
    action: 'upsert_obligation',
    code: 'QOS-M',
    titleEn: 'Monthly QoS report',
    titleAr: 'تقرير الجودة الشهري',
    authority: 'TRA',
    frequency: 'monthly',
    nextDueOn: today,
    ownerUserId: adminUserId,
  });
  await assert.rejects(readRegulatory({}, { permission: 'tenant.subscriber.view' }));
  let ws = await readRegulatory({ from: day(-1), to: today });
  const lic = ws.licences.find((l) => l.id === licence.licenceId);
  assert.ok(
    lic &&
      lic.renewalDue &&
      lic.status === 'renewal_pending' &&
      lic.daysToExpiry !== null &&
      lic.daysToExpiry <= 30,
  );
  const ob = ws.obligations.find((o) => o.id === obligation.obligationId);
  assert.ok(
    ob && ob.ownerName === 'Compliance manager' && ob.overdue === false && ob.daysToDue === 0,
  );
  assert.equal(ws.kpis.length, 9);
  const k = ws.current.kpis;
  assert.equal(ws.current.activeServices, 1);
  assert.equal(ws.current.outagesResolved, 1);
  assert.equal(Number(k.MTTR?.value), 60, 'mean time to restore from the retained outage');
  assert.equal(k.MTTR?.met, true);
  assert.ok(
    Number(k.AVAILABILITY?.value) < 100 && Number(k.AVAILABILITY?.value) > 90,
    'availability discounts the outage minutes',
  );
  assert.equal(Number(k.CRITICAL_ALARMS?.value), 1);
  assert.equal(Number(k.COMPLAINTS?.value), 100, 'one complaint per one active subscriber');
  assert.equal(k.COMPLAINTS?.met, false);
  assert.equal(Number(k.FIRST_RESPONSE?.value), 30);
  assert.equal(Number(k.SLA_RESPONSE?.value), 100);
  assert.equal(k.FAULT_RATE?.numerator, 1);
  assert.equal(k.FAULT_RATE?.denominator, 1);
  await assert.rejects(
    regulatory({ action: 'prepare_submission', periodStart: today, periodEnd: day(-1) }),
  );
  const prepared = await regulatory({
    action: 'prepare_submission',
    obligationId: String(obligation.obligationId),
    periodStart: day(-1),
    periodEnd: today,
    notes: 'March evidence',
  });
  assert.equal(prepared.status, 'draft');
  assert.match(String(prepared.submissionNumber), /^REG-\d{6}$/u);
  const evidence = prepared.evidence as { kpis: Record<string, { value: number }> };
  assert.equal(
    Number(evidence.kpis.MTTR?.value),
    60,
    'the submission retains the computed snapshot',
  );
  await assert.rejects(
    regulatory({
      action: 'record_decision',
      submissionId: String(prepared.submissionId),
      expectedVersion: 1,
      status: 'accepted',
    }),
    /only a submitted/u,
  );
  await assert.rejects(
    regulatory({
      action: 'submit',
      submissionId: String(prepared.submissionId),
      expectedVersion: 1,
      reference: '',
    }),
  );
  const submitted = await regulatory({
    action: 'submit',
    submissionId: String(prepared.submissionId),
    expectedVersion: 1,
    reference: 'TRA-2026-0042',
  });
  assert.equal(submitted.status, 'submitted');
  ws = await readRegulatory();
  const advanced = ws.obligations.find((o) => o.id === obligation.obligationId);
  assert.ok(
    advanced && advanced.nextDueOn > today,
    'a submitted obligation moves to its next due date',
  );
  assert.equal(advanced?.lastSubmission?.status, 'submitted');
  await assert.rejects(
    regulatory({
      action: 'record_decision',
      submissionId: String(prepared.submissionId),
      expectedVersion: 1,
      status: 'accepted',
    }),
    /changed since/u,
  );
  const decided = await regulatory({
    action: 'record_decision',
    submissionId: String(prepared.submissionId),
    expectedVersion: 2,
    status: 'accepted',
    note: 'Accepted by the regulator',
  });
  assert.equal(decided.status, 'accepted');
  const sub = (await readRegulatory()).submissions.find((s) => s.id === prepared.submissionId);
  assert.ok(
    sub &&
      sub.submissionReference === 'TRA-2026-0042' &&
      sub.preparedBy === 'Compliance manager' &&
      sub.decisionNote === 'Accepted by the regulator',
  );

  // --- People ----------------------------------------------------------------------------------
  await assert.rejects(
    people(
      { action: 'upsert_team', code: 'FIELD', nameEn: 'Field team', nameAr: 'فريق الميدان' },
      { permission: 'tenant.report.view' },
    ),
  );
  const team = await people({
    action: 'upsert_team',
    code: 'FIELD',
    nameEn: 'Field team',
    nameAr: 'فريق الميدان',
    branchId,
  });
  await assert.rejects(
    people({
      action: 'upsert_employee',
      employeeNumber: 'E-2',
      userId: randomUUID(),
      displayName: 'Ghost',
      roleTitle: 'Nobody',
    }),
    /member/u,
  );
  const employee = await people({
    action: 'upsert_employee',
    employeeNumber: 'E-1',
    userId: agentId,
    displayName: 'Field agent',
    roleTitle: 'Technician',
    teamId: String(team.teamId),
    branchId,
    phone: '+96170123456',
    hiredOn: day(-400),
    skills: ['fiber', 'cpe'],
  });
  await assert.rejects(
    people({
      action: 'upsert_employee',
      employeeNumber: 'E-1-DUP',
      userId: agentId,
      displayName: 'Twin',
      roleTitle: 'Technician',
    }),
    'one employee per staff identity',
  );
  await people({
    action: 'upsert_team',
    teamId: String(team.teamId),
    expectedVersion: 1,
    leadEmployeeId: String(employee.employeeId),
  });
  const shiftStart = new Date(Date.now() + 2 * 86_400_000);
  shiftStart.setUTCHours(6, 0, 0, 0);
  const shiftEnd = new Date(shiftStart.getTime() + 8 * 3_600_000);
  const shift = await people({
    action: 'schedule_shift',
    employeeId: String(employee.employeeId),
    kind: 'shift',
    startsAt: shiftStart.toISOString(),
    endsAt: shiftEnd.toISOString(),
    locationNote: 'Hamra',
  });
  await assert.rejects(
    people({
      action: 'schedule_shift',
      employeeId: String(employee.employeeId),
      kind: 'shift',
      startsAt: new Date(shiftStart.getTime() + 3_600_000).toISOString(),
      endsAt: new Date(shiftEnd.getTime() + 3_600_000).toISOString(),
    }),
    /already has a shift/u,
  );
  await people({
    action: 'schedule_shift',
    employeeId: String(employee.employeeId),
    kind: 'on_call',
    startsAt: shiftStart.toISOString(),
    endsAt: shiftEnd.toISOString(),
  });
  const leave = await people(
    {
      action: 'request_leave',
      employeeId: String(employee.employeeId),
      kind: 'annual',
      startsOn: day(2),
      endsOn: day(3),
      reason: 'Family',
    },
    { overrides: { actorId: agentId } },
  );
  await assert.rejects(
    people({
      action: 'request_leave',
      employeeId: String(employee.employeeId),
      startsOn: day(3),
      endsOn: day(4),
    }),
    /already covers/u,
  );
  await assert.rejects(
    people(
      {
        action: 'decide_leave',
        leaveId: String(leave.leaveId),
        expectedVersion: 1,
        status: 'approved',
      },
      { overrides: { actorId: agentId } },
    ),
    /different person/u,
  );
  const approved = await people({
    action: 'decide_leave',
    leaveId: String(leave.leaveId),
    expectedVersion: 1,
    status: 'approved',
    note: 'Enjoy',
  });
  assert.equal(approved.status, 'approved');
  await assert.rejects(
    people({
      action: 'schedule_shift',
      employeeId: String(employee.employeeId),
      kind: 'shift',
      startsAt: shiftStart.toISOString(),
      endsAt: shiftEnd.toISOString(),
    }),
    /approved leave/u,
  );
  await people({
    action: 'record_training',
    employeeId: String(employee.employeeId),
    title: 'Working at height',
    kind: 'safety',
    completedOn: day(-300),
    expiresOn: day(30),
    reference: 'WAH-77',
  });
  await assert.rejects(readPeople({}, { permission: 'tenant.subscriber.view' }));
  const pw = await readPeople({ from: day(0), to: day(6) });
  const emp = pw.employees.find((e) => e.id === employee.employeeId);
  assert.ok(
    emp &&
      emp.userName === 'Field agent' &&
      emp.teamCode === 'FIELD' &&
      emp.expiringTraining === 1 &&
      emp.skills.includes('fiber'),
  );
  const cancelled = pw.shifts.filter(
    (s) => s.employeeId === employee.employeeId && s.cancelledAt !== null,
  );
  assert.equal(cancelled.length, 2, 'approved leave cancels the shifts it covers');
  assert.ok(
    pw.shifts.some((s) => s.id === shift.shiftId && s.cancelReason?.startsWith('Approved leave')),
  );
  assert.ok(
    pw.leave.some(
      (l) =>
        l.id === leave.leaveId &&
        l.status === 'approved' &&
        l.decidedBy === 'Compliance manager' &&
        l.requestedBy === 'Field agent',
    ),
  );
  assert.ok(
    pw.training.some((t) => t.employeeId === employee.employeeId && t.expiringSoon && !t.expired),
  );
  assert.ok(
    pw.members.some((m) => m.userId === agentId && m.linked) &&
      pw.members.some((m) => m.userId === adminUserId && !m.linked),
  );
  assert.equal(pw.teams.find((t) => t.id === team.teamId)?.leadName, 'Field agent');
  await assert.rejects(
    admin.unsafe('UPDATE operations_training_records SET title=$1 WHERE tenant_id=$2', [
      'tampered',
      tenantId,
    ]),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::integer AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action IN ('tenant.regulatory.manage','tenant.people.manage')",
    [tenantId],
  );
  assert.ok(audit.count >= 12, `audit rows recorded (${audit.count})`);
  process.stdout.write('Regulatory and people acceptance passed.\n');
} finally {
  await Promise.all([admin.end({ timeout: 5 }), runtime.client.end({ timeout: 5 })]);
}
