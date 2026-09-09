import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { AssuranceCommand, Permission, VerifiedTenantId } from '@isp/contracts';
import {
  createDatabase,
  executeAssuranceCommand,
  inOperationsTransaction,
  readAssuranceWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for revenue assurance on PostgreSQL 18: controls evaluated from backdated
 * fixture records, findings that persist, clear and reopen across runs, acknowledgement, cases
 * with ownership and closure evidence, scope, authority refusals and immutability.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Revenue assurance acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Revenue assurance acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Revenue assurance acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `assurance-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const actorId = randomUUID();
const analystId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const staleServiceId = randomUUID();
const terminatedServiceId = randomUUID();
const runId = randomUUID();
const overdueInvoiceId = randomUUID();
const lateInvoiceId = randomUUID();
const paymentId = randomUUID();
const reasons = {
  reasonEn: 'Revenue assurance acceptance run',
  reasonAr: 'تشغيل قبول ضمان الإيرادات',
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
      reason: 'Synthetic revenue assurance acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const command = (
  body: AssuranceCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeAssuranceCommand(runtime.db, tenantId, {
    command: body,
    authorization: sign(
      'tenant.assurance.manage',
      options.permission ?? 'tenant.collection.reconcile',
      options.key,
      options.overrides,
    ),
  });
const read = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readAssuranceWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.assurance.workspace.read',
      'tenant.billing.view',
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Assurance proof','Assurance proof','active')",
      [tenantId, `RA-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Finance lead','not-a-login'),($3,'tenant',$4,'Rana Analyst','not-a-login')",
      [actorId, `${actorId}@assurance.invalid`, analystId, `${analystId}@assurance.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'finance_billing',ARRAY['tenant.billing.view','tenant.collection.reconcile'],'{}'::jsonb),($1,$3,'finance_billing',ARRAY['tenant.billing.view'],'{}'::jsonb)",
      [tenantId, actorId, analystId],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'RA-B','Assurance branch','فرع الضمان'),($3,$2,'RA-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'RA-A','Assurance area','منطقة الضمان')",
      [areaId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'RA-R','Assurance route','مسار الضمان')",
      [routeId, tenantId, branchId, areaId],
    );
    await tx.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'RA-H','Assurance household',$3)",
      [householdId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','4 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'RA-SUB','assurance-subscriber-1','fixture',$3,$4,'Assurance customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'RA-P','Assurance plan','خطة الضمان',2500,'USD',$3,'assurance-plan-0001')",
      [planId, tenantId, branchId],
    );
    // A service active for 90 days with no invoice, and one terminated 40 days ago but invoiced afterwards.
    await tx.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,terminated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'RA-SVC-STALE','active',clock_timestamp()-interval '90 days',NULL,1,$6,$7,$8,'assurance-service-1'),($9,$2,$3,$4,$5,'RA-SVC-TERM','terminated',clock_timestamp()-interval '120 days',clock_timestamp()-interval '40 days',1,$6,$7,$8,'assurance-service-2')",
      [
        staleServiceId,
        tenantId,
        subscriberId,
        locationId,
        planId,
        branchId,
        areaId,
        routeId,
        terminatedServiceId,
      ],
    );
    await tx.unsafe(
      "UPDATE operations_services SET terminated_at=clock_timestamp()-interval '40 days' WHERE id=$1",
      [terminatedServiceId],
    );
    await tx.unsafe(
      "INSERT INTO operations_billing_runs(id,tenant_id,idempotency_key,period_start,period_end,status,requested_by) VALUES($1,$2,'assurance-run-0001',(clock_timestamp() AT TIME ZONE 'UTC')::date-100,(clock_timestamp() AT TIME ZONE 'UTC')::date-70,'succeeded',$3)",
      [runId, tenantId, actorId],
    );
    // Two posted invoices: one 75 days old and unpaid, one raised 30 days ago for the terminated service.
    await tx.unsafe(
      "INSERT INTO finance_invoices(id,tenant_id,document_number,amount_minor,currency,idempotency_key,actor_id,posted_at) VALUES($1,$2,'RA-INV-0001',3000,'USD','assurance-invoice-0001',$3,clock_timestamp()-interval '75 days'),($4,$2,'RA-INV-0002',2500,'USD','assurance-invoice-0002',$3,clock_timestamp()-interval '30 days')",
      [overdueInvoiceId, tenantId, actorId, lateInvoiceId],
    );
    await tx.unsafe(
      "INSERT INTO finance_document_guards(tenant_id,document_type,document_id,allocated_minor) VALUES($1,'invoice',$2,1000),($1,'invoice',$3,0) ON CONFLICT (tenant_id,document_type,document_id) DO UPDATE SET allocated_minor=excluded.allocated_minor",
      [tenantId, overdueInvoiceId, lateInvoiceId],
    );
    // A payment 10 days old with 1000 of 1500 allocated.
    await tx.unsafe(
      "INSERT INTO finance_payments(id,tenant_id,receipt_number,amount_minor,currency,idempotency_key,actor_id,posted_at) VALUES($1,$2,'RA-RCPT-0001',1500,'USD','assurance-payment-0001',$3,clock_timestamp()-interval '10 days')",
      [paymentId, tenantId, actorId],
    );
    await tx.unsafe(
      "INSERT INTO finance_document_guards(tenant_id,document_type,document_id,allocated_minor) VALUES($1,'payment',$2,1000) ON CONFLICT (tenant_id,document_type,document_id) DO UPDATE SET allocated_minor=excluded.allocated_minor",
      [tenantId, paymentId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Authority --------------------------------------------------------------------------------
  await assert.rejects(
    command({ action: 'run_controls', ...reasons }, { permission: 'tenant.billing.view' }),
  );
  await assert.rejects(
    command(
      { action: 'run_controls', ...reasons },
      { overrides: { supportGrantId: randomUUID() } },
    ),
  );
  await assert.rejects(read({}, { permission: 'tenant.network.view' }));

  // --- First run: four controls fire ------------------------------------------------------------
  const runKey = randomUUID();
  const first = await command({ action: 'run_controls', ...reasons }, { key: runKey });
  const summary = first.summary as {
    controlCode: string;
    openFindings: number;
    exposureUsdMinor: number;
  }[];
  const of = (code: string) => summary.find((s) => s.controlCode === code);
  assert.equal(of('ACTIVE_NOT_BILLED')?.openFindings, 1);
  assert.equal(of('ACTIVE_NOT_BILLED')?.exposureUsdMinor, 2500);
  assert.equal(
    of('BILLED_AFTER_TERMINATION')?.openFindings,
    0,
    'no posted preparation after termination in this fixture',
  );
  assert.equal(of('INVOICE_OVERDUE_60')?.openFindings, 1);
  assert.equal(of('INVOICE_OVERDUE_60')?.exposureUsdMinor, 2000, 'remaining after 1000 allocated');
  assert.equal(of('PAYMENT_UNALLOCATED_7')?.openFindings, 1);
  assert.equal(of('PAYMENT_UNALLOCATED_7')?.exposureUsdMinor, 500);
  assert.equal(of('DEALER_OVER_LIMIT')?.openFindings, 0);
  assert.equal(
    (await command({ action: 'run_controls', ...reasons }, { key: runKey })).replayed,
    true,
  );

  let workspace = await read();
  assert.equal(workspace.summary.openFindings, 3);
  assert.equal(workspace.summary.exposureUsdMinor, 2500 + 2000 + 500);
  assert.equal(workspace.summary.exposureLbpMinor, 0);
  const overdue = workspace.findings.find((f) => f.controlCode === 'INVOICE_OVERDUE_60');
  const stale = workspace.findings.find((f) => f.controlCode === 'ACTIVE_NOT_BILLED');
  const unallocated = workspace.findings.find((f) => f.controlCode === 'PAYMENT_UNALLOCATED_7');
  assert(overdue && stale && unallocated);
  assert.equal(overdue.subjectReference, 'RA-INV-0001');
  assert.equal(
    overdue.subscriberName,
    null,
    'an invoice without a preparation has no subscriber link',
  );
  assert.equal(stale.subjectReference, 'RA-SVC-STALE');
  assert.equal(unallocated.branchId, null, 'payments are tenant-wide');

  // --- Second run: nothing changed, findings persist with the same version --------------------
  await command({ action: 'run_controls', ...reasons });
  workspace = await read();
  assert.equal(
    workspace.findings.find((f) => f.id === overdue.id)?.version,
    2,
    'refreshed, not duplicated',
  );
  assert.equal(workspace.summary.openFindings, 3);
  assert.equal(workspace.runs.length, 2);

  // --- Acknowledge with version guard -------------------------------------------------------------
  await assert.rejects(
    command({
      action: 'acknowledge_finding',
      findingId: overdue.id,
      expectedVersion: 1,
      ...reasons,
    }),
    /changed/u,
  );
  const acknowledged = await command({
    action: 'acknowledge_finding',
    findingId: overdue.id,
    expectedVersion: 2,
    note: 'Customer promised payment this week',
    ...reasons,
  });
  assert.equal(acknowledged.status, 'acknowledged');
  await assert.rejects(
    command({
      action: 'acknowledge_finding',
      findingId: overdue.id,
      expectedVersion: 3,
      ...reasons,
    }),
    /only an open/u,
  );

  // --- The payment gets allocated: its finding clears on the next run, then reopens ----------
  await admin.unsafe(
    "UPDATE finance_document_guards SET allocated_minor=1500 WHERE tenant_id=$1 AND document_type='payment' AND document_id=$2",
    [tenantId, paymentId],
  );
  await command({ action: 'run_controls', ...reasons });
  workspace = await read({ findings: 'all' });
  const cleared = workspace.findings.find((f) => f.id === unallocated.id);
  assert.equal(cleared?.status, 'cleared');
  assert(cleared?.clearedAt);
  assert.equal(
    workspace.summary.openFindings,
    1,
    'stale service stays open; overdue is acknowledged',
  );
  assert.equal(workspace.summary.acknowledgedFindings, 1);
  await admin.unsafe(
    "UPDATE finance_document_guards SET allocated_minor=1000 WHERE tenant_id=$1 AND document_type='payment' AND document_id=$2",
    [tenantId, paymentId],
  );
  await command({ action: 'run_controls', ...reasons });
  workspace = await read();
  assert.equal(workspace.findings.find((f) => f.id === unallocated.id)?.status, 'open', 'reopened');
  assert.equal(workspace.findings.find((f) => f.id === overdue.id)?.status, 'acknowledged', 'kept');

  // --- Cases: open with findings, assign, investigate, resolve with evidence --------------------
  await assert.rejects(
    command({
      action: 'open_case',
      titleEn: 'Overdue invoices',
      titleAr: 'فواتير متأخرة',
      findingIds: [randomUUID()],
      ...reasons,
    }),
    /live, in scope/u,
  );
  await assert.rejects(
    command({
      action: 'open_case',
      titleEn: 'Overdue invoices',
      titleAr: 'فواتير متأخرة',
      findingIds: [overdue.id],
      ownerUserId: randomUUID(),
      ...reasons,
    }),
    /workspace member/u,
  );
  const opened = await command({
    action: 'open_case',
    titleEn: 'Overdue invoices and stale services',
    titleAr: 'فواتير متأخرة وخدمات غير مفوترة',
    findingIds: [overdue.id, stale.id],
    ...reasons,
  });
  assert.match(String(opened.caseNumber), /^RA-\d{8}-[0-9A-F]{6}$/u);
  const caseId = opened.caseId as string;
  await assert.rejects(
    command({
      action: 'open_case',
      titleEn: 'Duplicate case',
      titleAr: 'حالة مكررة',
      findingIds: [overdue.id],
      ...reasons,
    }),
    /already in a case/u,
  );
  const assigned = await command({
    action: 'assign_case',
    caseId,
    expectedVersion: 1,
    ownerUserId: analystId,
    ...reasons,
  });
  assert.equal(assigned.ownerUserId, analystId);
  await assert.rejects(
    command({
      action: 'transition_case',
      caseId,
      expectedVersion: 2,
      status: 'resolved',
      resolutionEn: 'Collected',
      resolutionAr: 'تم التحصيل',
      resolutionEvidence: 'short',
      ...reasons,
    }),
  );
  const investigating = await command({
    action: 'transition_case',
    caseId,
    expectedVersion: 2,
    status: 'investigating',
    ...reasons,
  });
  assert.equal(investigating.status, 'investigating');
  await assert.rejects(
    command({
      action: 'transition_case',
      caseId,
      expectedVersion: 3,
      status: 'investigating',
      ...reasons,
    }),
    /transition/u,
  );
  const linked = await command({
    action: 'link_findings',
    caseId,
    expectedVersion: 3,
    findingIds: [unallocated.id],
    ...reasons,
  });
  assert.equal(linked.version, 4);
  const resolved = await command({
    action: 'transition_case',
    caseId,
    expectedVersion: 4,
    status: 'resolved',
    resolutionEn: 'Invoices collected, payment allocated and stale service billed',
    resolutionAr: 'تم تحصيل الفواتير وتخصيص الدفعة وفوترة الخدمة',
    resolutionEvidence: 'Receipts RCPT-2026-0201 to 0203 and billing run BR-2026-09',
    ...reasons,
  });
  assert.equal(resolved.status, 'resolved');
  await assert.rejects(
    command({
      action: 'assign_case',
      caseId,
      expectedVersion: 5,
      ownerUserId: analystId,
      ...reasons,
    }),
    /closed/u,
  );
  workspace = await read({ findings: 'all' });
  const closedCase = workspace.cases.find((c) => c.id === caseId);
  assert.equal(closedCase?.findings, 3);
  assert.equal(closedCase?.ownerName, 'Rana Analyst');
  assert(closedCase?.closedAt);
  assert.equal(
    workspace.findings.filter((f) => f.caseId === caseId && f.status === 'resolved').length,
    3,
  );
  assert.equal(workspace.summary.openCases, 0);
  // Resolved findings stay resolved on the next run even though the conditions persist.
  await command({ action: 'run_controls', ...reasons });
  workspace = await read({ findings: 'all' });
  assert.equal(workspace.findings.find((f) => f.id === overdue.id)?.status, 'resolved');
  assert.equal(workspace.summary.openFindings, 0, 'every finding sits in the resolved case');

  // --- Scope and immutability ---------------------------------------------------------------------
  const elsewhere = await read({ findings: 'all' }, { branchIds: [otherBranchId] });
  assert.equal(elsewhere.findings.filter((f) => f.branchId !== null).length, 0);
  assert.equal(
    elsewhere.findings.filter((f) => f.branchId === null).length,
    2,
    'tenant-wide payment and unlinked invoice findings stay visible',
  );
  await assert.rejects(read({}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.assurance.manage', 'tenant.collection.reconcile'),
      (tx) =>
        tx.execute(
          sql`UPDATE operations_assurance_findings SET exposure_minor=0 WHERE tenant_id=${tenantId}`,
        ),
    ),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_assurance_events WHERE tenant_id=$1', [tenantId]),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_assurance_findings WHERE tenant_id=$1', [tenantId]),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action='tenant.assurance.manage'",
    [tenantId],
  );
  assert.equal(audit?.count, 11);
  console.log('Revenue assurance acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
