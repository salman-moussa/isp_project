import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import {
  createDatabase,
  readDashboardSnapshot,
  readReportDataset,
  readReportsWorkspace,
  recordReportExport,
  renderCsv,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for the operations dashboard and governed reports on PostgreSQL 18: figures
 * computed from real records with currencies kept apart, drilldown rows, report datasets with
 * validated windows, recorded CSV exports with exact replay, authority refusals and scope.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Analytics acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Analytics acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Analytics acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `analytics-test-${randomUUID()}`;
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
const invoiceId = randomUUID();
const oldInvoiceId = randomUUID();
const paymentUsdId = randomUUID();
const paymentLbpId = randomUUID();
const officeRequestId = randomUUID();
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
      reason: 'Synthetic analytics acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const dashboard = (overrides: Record<string, unknown> = {}) =>
  readDashboardSnapshot(runtime.db, tenantId, {
    authorization: sign('tenant.dashboard.read', 'tenant.dashboard.view', randomUUID(), overrides),
  });
const report = (
  key: Parameters<typeof readReportDataset>[2]['key'],
  query: Record<string, string> = {},
  overrides: Record<string, unknown> = {},
) =>
  readReportDataset(runtime.db, tenantId, {
    key,
    query,
    authorization: sign('tenant.report.read', 'tenant.report.view', randomUUID(), overrides),
  });

try {
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Analytics proof','Analytics proof','active')",
      [tenantId, `ANL-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Branch manager','not-a-login')",
      [actorId, `${actorId}@analytics.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'branch_manager',ARRAY['tenant.dashboard.view','tenant.report.view','tenant.report.export'],'{}'::jsonb)",
      [tenantId, actorId],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'ANL-B','Analytics branch','فرع التحليلات'),($3,$2,'ANL-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'ANL-A','Analytics area','منطقة التحليلات')",
      [areaId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'ANL-R','Analytics route','مسار التحليلات')",
      [routeId, tenantId, branchId, areaId],
    );
    await tx.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'ANL-H','Analytics household',$3)",
      [householdId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','6 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'ANL-SUB','analytics-subscriber-1','fixture',$3,$4,'Analytics customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'ANL-P','Analytics plan','خطة التحليلات',3000,'USD',$3,'analytics-plan-0001')",
      [planId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'ANL-SVC','active',clock_timestamp()-interval '10 days',1,$6,$7,$8,'analytics-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    // One invoice posted today (unpaid 2,000 of 3,000) and one 80 days old (unpaid), both USD.
    await tx.unsafe(
      "INSERT INTO finance_invoices(id,tenant_id,document_number,amount_minor,currency,idempotency_key,actor_id,posted_at) VALUES($1,$2,'ANL-INV-0001',3000,'USD','analytics-invoice-0001',$3,clock_timestamp()),($4,$2,'ANL-INV-0000',5000,'USD','analytics-invoice-0000',$3,clock_timestamp()-interval '80 days')",
      [invoiceId, tenantId, actorId, oldInvoiceId],
    );
    await tx.unsafe(
      "INSERT INTO finance_document_guards(tenant_id,document_type,document_id,allocated_minor) VALUES($1,'invoice',$2,1000),($1,'invoice',$3,0) ON CONFLICT (tenant_id,document_type,document_id) DO UPDATE SET allocated_minor=excluded.allocated_minor",
      [tenantId, invoiceId, oldInvoiceId],
    );
    // Two receipts today: USD 1,000 through the office cashier and LBP 900,000 with no channel link.
    await tx.unsafe(
      "INSERT INTO finance_payments(id,tenant_id,receipt_number,amount_minor,currency,idempotency_key,actor_id,posted_at) VALUES($1,$2,'ANL-RCPT-0001',1000,'USD','analytics-payment-0001',$3,clock_timestamp()),($4,$2,'ANL-RCPT-0002',900000,'LBP','analytics-payment-0002',$3,clock_timestamp())",
      [paymentUsdId, tenantId, actorId, paymentLbpId],
    );
    await tx.unsafe(
      "INSERT INTO finance_document_guards(tenant_id,document_type,document_id,allocated_minor) VALUES($1,'payment',$2,1000),($1,'payment',$3,0) ON CONFLICT (tenant_id,document_type,document_id) DO UPDATE SET allocated_minor=excluded.allocated_minor",
      [tenantId, paymentUsdId, paymentLbpId],
    );
    await tx.unsafe(
      "INSERT INTO operations_office_payment_requests(id,tenant_id,subscriber_id,receipt_number,amount_minor,currency,finance_payment_id,idempotency_key,requested_by,branch_id,area_id,route_id) VALUES($1,$2,$3,'ANL-RCPT-0001',1000,'USD',$4,'analytics-office-0001',$5,$6,$7,$8)",
      [officeRequestId, tenantId, subscriberId, paymentUsdId, actorId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Dashboard ------------------------------------------------------------------------------
  await assert.rejects(dashboard({ permission: 'tenant.report.view' }));
  await assert.rejects(dashboard({ supportGrantId: randomUUID() }));
  const snapshot = await dashboard();
  assert.equal(snapshot.collections.usdMinor, 1000);
  assert.equal(snapshot.collections.lbpMinor, 900000, 'currencies are reported apart');
  assert.equal(snapshot.collections.receipts, 2);
  assert.deepEqual(
    snapshot.collections.byChannel.map((c) => `${c.channel}:${c.currency}:${c.amountMinor}`),
    ['office:USD:1000', 'other:LBP:900000'],
  );
  assert.equal(
    snapshot.collections.recent[0]?.subscriberName ??
      snapshot.collections.recent[1]?.subscriberName,
    'Analytics customer',
  );
  assert.equal(snapshot.receivables.unpaidInvoices, 2);
  assert.equal(snapshot.receivables.overdue30, 1);
  assert.equal(snapshot.receivables.usdMinor, 2000 + 5000);
  assert.equal(snapshot.receivables.oldest[0]?.documentNumber, 'ANL-INV-0000');
  assert.equal(snapshot.services.active, 1);
  assert.equal(snapshot.services.liveSessions, 0);
  assert.equal(snapshot.work.failedJobs, 0);
  assert.equal(snapshot.work.openTickets, 0);
  assert(Array.isArray(snapshot.activity));

  // --- Reports ---------------------------------------------------------------------------------
  const aging = await report('ar_aging');
  assert.deepEqual(
    aging.rows.map((r) => `${String(r.currency)}:${String(r.bucket)}:${String(r.remainingMinor)}`),
    ['USD:0-30:2000', 'USD:61-90:5000'],
  );
  const collections = await report('collections_daily');
  assert.equal(collections.rows.length, 2);
  assert(
    collections.rows.some(
      (r) => r.channel === 'office' && r.currency === 'USD' && r.amountMinor === 1000,
    ),
  );
  await assert.rejects(
    report('collections_daily', { from: '2026-01-01', to: '2025-01-01' }),
    /end after it starts/u,
  );
  await assert.rejects(
    report('collections_daily', { from: '2020-01-01', to: '2026-01-01' }),
    /one year/u,
  );
  const empty = await report('collections_daily', { from: '2025-01-01', to: '2025-01-31' });
  assert.equal(empty.rows.length, 0);
  const plans = await report('plan_mix');
  assert.equal(plans.rows[0]?.planCode, 'ANL-P');
  assert.equal(plans.rows[0]?.monthlyMinor, 3000);
  const statuses = await report('subscriber_status');
  assert.equal(statuses.rows[0]?.subscribers, 1);
  await assert.rejects(report('ar_aging', {}, { permission: 'tenant.dashboard.view' }));
  await assert.rejects(report('ar_aging', {}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    readReportDataset(runtime.db, tenantId, {
      key: 'not_a_report' as never,
      authorization: sign('tenant.report.read', 'tenant.report.view'),
    }),
  );

  // --- CSV rendering and recorded export ------------------------------------------------------
  const csv = renderCsv(aging.rows);
  const header = csv.split('\r\n')[0] ?? '';
  assert.deepEqual(header.split(',').sort(), [
    'bucket',
    'bucketOrder',
    'currency',
    'invoices',
    'remainingMinor',
  ]);
  assert.match(csv, /0-30,USD,1,1,2000\r\n/u);
  assert.equal(renderCsv([{ note: 'a,"b"' }]), 'note\r\n"a,""b"""\r\n');
  const exportKey = randomUUID();
  const record = () =>
    recordReportExport(runtime.db, tenantId, {
      command: { key: 'ar_aging', format: 'csv' },
      rows: aging.rows.length,
      authorization: sign('tenant.report.export', 'tenant.report.export', exportKey),
    });
  await assert.rejects(
    recordReportExport(runtime.db, tenantId, {
      command: { key: 'ar_aging', format: 'csv' },
      rows: 2,
      authorization: sign('tenant.report.export', 'tenant.report.view'),
    }),
  );
  const job = await record();
  assert.equal(job.status, 'succeeded');
  assert.equal((await record()).replayed, true);
  const workspace = await readReportsWorkspace(runtime.db, tenantId, {
    authorization: sign('tenant.report.workspace.read', 'tenant.report.view'),
  });
  assert.equal(workspace.catalogue.length, 9);
  assert.equal(workspace.exports[0]?.rows, 2);
  assert.equal(workspace.exports[0]?.requestedBy, 'Branch manager');
  assert.equal(workspace.exports[0]?.status, 'succeeded');
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action='tenant.report.export'",
    [tenantId],
  );
  assert.equal(audit?.count, 1);

  // --- Scope: another branch sees no subscriber-bound rows ---------------------------------------
  const elsewhere = await report('subscriber_status', {}, { branchIds: [otherBranchId] });
  assert.equal(elsewhere.rows.length, 0);
  const elsewhereDashboard = await dashboard({ branchIds: [otherBranchId] });
  assert.equal(elsewhereDashboard.services.active, 0);
  console.log('Analytics acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
