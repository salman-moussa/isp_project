import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import {
  createDatabase,
  executeCashierCommand,
  executeCollectionCommand,
  readCashierWorkspace,
  readCollectionsWorkspace,
  recordCollection,
  signOperationsAttestation,
  voidReceipt,
} from '../src/index.js';

/**
 * Live acceptance for the office cashier and field collections on PostgreSQL 18: drawers per
 * cashier and currency, receipts posted atomically with allocations to the subscriber's open
 * invoices, voids as linked reversals, route collectors, assignments derived from the open
 * balance, office-recorded collections with real amounts, settlements with a kept difference
 * that a different manager approves, exact idempotent replay and scope enforcement.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Cashier acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Cashier acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Cashier acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `cashier-test-${randomUUID()}`;
const secret = randomBytes(32);
const collectorId = randomUUID();
const managerId = randomUUID();
const cashierId = randomUUID();
const today = new Date().toISOString().slice(0, 10);

try {
  const [source] = await admin.unsafe(
    'SELECT i.tenant_id,i.id AS invoice_id,i.document_number,p.id AS preparation_id,p.billing_run_id,i.amount_minor ' +
      'FROM tenants t JOIN operations_invoice_preparations p ON p.tenant_id=t.id ' +
      'JOIN finance_invoices i ON i.tenant_id=p.tenant_id AND i.id=p.finance_invoice_id ' +
      "WHERE t.code LIKE 'SALES-%' AND i.entry_kind='posted' AND i.currency='USD' AND p.posting_status='posted' " +
      'AND NOT EXISTS(SELECT 1 FROM operations_accounting_periods ap WHERE ap.tenant_id=t.id ' +
      "AND ap.status<>'open' AND (clock_timestamp() AT TIME ZONE 'UTC')::date BETWEEN ap.start_date AND ap.end_date) " +
      'ORDER BY i.created_at DESC,i.id LIMIT 1',
  );
  assert(source, 'Run the sales live fixture first; need a posted synthetic sales invoice.');
  // Clone the governed invoice (run, invoice, guard, preparation) into a fresh unpaid, unassigned one.
  const newInvoiceId = randomUUID();
  const newRunId = randomUUID();
  const newPreparationId = randomUUID();
  const now = new Date().toISOString();
  // A unique billing period keeps the clone clear of the service/period uniqueness rule.
  const shift = 400 + Math.floor(Math.random() * 20000);
  const periodStart = new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.now() + (shift + 30) * 86_400_000).toISOString().slice(0, 10);
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    const clone = async (
      table: string,
      where: string,
      params: unknown[],
      overrides: Record<string, unknown>,
    ) => {
      const columns = await tx.unsafe(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position",
        [table],
      );
      const list = columns.map((c) => '"' + String(c.column_name) + '"').join(',');
      await tx.unsafe(
        `INSERT INTO ${table} (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::${table}, (SELECT to_jsonb(r) || $${params.length + 1}::jsonb FROM ${table} r WHERE ${where}))`,
        [...params, overrides],
      );
    };
    await clone(
      'operations_billing_runs',
      'r.tenant_id=$1 AND r.id=$2',
      [source.tenant_id, source.billing_run_id],
      {
        id: newRunId,
        idempotency_key: 'cashier-run-' + newRunId,
        period_start: periodStart,
        period_end: periodEnd,
      },
    );
    await clone(
      'finance_invoices',
      'r.tenant_id=$1 AND r.id=$2',
      [source.tenant_id, source.invoice_id],
      {
        id: newInvoiceId,
        document_number: String(source.document_number) + '-CASH-' + newInvoiceId.slice(0, 8),
        idempotency_key: 'cashier-invoice-' + newInvoiceId,
        posted_at: now,
        created_at: now,
      },
    );
    await clone(
      'finance_document_guards',
      "r.tenant_id=$1 AND r.document_type='invoice' AND r.document_id=$2",
      [source.tenant_id, source.invoice_id],
      {
        document_id: newInvoiceId,
        allocated_minor: 0,
        credited_net_minor: 0,
        credited_vat_minor: 0,
        credited_stamp_minor: 0,
        reversed_at: null,
      },
    );
    await clone(
      'operations_invoice_preparations',
      'r.tenant_id=$1 AND r.id=$2',
      [source.tenant_id, source.preparation_id],
      {
        id: newPreparationId,
        billing_run_id: newRunId,
        finance_invoice_id: newInvoiceId,
        period_start: periodStart,
        period_end: periodEnd,
        billing_date: periodStart,
        created_at: now,
      },
    );
  });
  const [fixture] = await admin.unsafe(
    'SELECT i.tenant_id,i.id AS invoice_id,i.document_number,s.subscriber_id,i.actor_id,s.branch_id,s.area_id,s.route_id,' +
      'i.amount_minor-g.allocated_minor-g.credited_minor AS outstanding,sub.display_name ' +
      'FROM finance_invoices i JOIN operations_invoice_preparations p ON p.tenant_id=i.tenant_id AND p.finance_invoice_id=i.id ' +
      'JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id ' +
      'JOIN operations_subscribers sub ON sub.tenant_id=s.tenant_id AND sub.id=s.subscriber_id ' +
      "JOIN finance_document_guards g ON g.tenant_id=i.tenant_id AND g.document_id=i.id AND g.document_type='invoice' " +
      'WHERE i.tenant_id=$1 AND i.id=$2',
    [source.tenant_id, newInvoiceId],
  );
  assert(fixture, 'cloned invoice fixture is readable');
  const tenantId = fixture.tenant_id as VerifiedTenantId;
  const invoiceId = fixture.invoice_id as string;
  const subscriberId = fixture.subscriber_id as string;
  const actorId = fixture.actor_id as string;
  const branchId = fixture.branch_id as string;
  const routeId = fixture.route_id as string;
  const outstanding = Number(fixture.outstanding);
  const p1 = Math.floor(outstanding / 4);
  const p2 = Math.floor(outstanding / 5);
  const p3 = Math.max(1, Math.floor(outstanding / 10));
  assert(p1 > 0 && p2 > 0, 'fixture balance large enough');
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Route collector','not-a-login'),($3,'tenant',$4,'Second manager','not-a-login'),($5,'tenant',$6,'Counter cashier','not-a-login')",
      [
        collectorId,
        `${collectorId}@cashier.invalid`,
        managerId,
        `${managerId}@cashier.invalid`,
        cashierId,
        `${cashierId}@cashier.invalid`,
      ],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'collector',ARRAY['tenant.collection.view','tenant.payment.post'],'{}'::jsonb),($1,$3,'manager',ARRAY['tenant.collection.view','tenant.collection.reconcile'],'{}'::jsonb),($1,$4,'cashier',ARRAY['tenant.payment.view','tenant.payment.post','tenant.payment.reverse'],'{}'::jsonb)",
      [tenantId, collectorId, managerId, cashierId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });
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
        reason: 'Synthetic cashier acceptance',
        ipAddress: '127.0.0.1',
        branchIds: [fixture.branch_id],
        areaIds: [fixture.area_id],
        routeIds: [fixture.route_id],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      secret,
    );
  // Cashiers are branch-scoped; the drawer and branch lists carry no area or route identity.
  const branchOnly = { areaIds: undefined, routeIds: undefined, actorId: cashierId };
  const cashier = (
    command: Parameters<typeof executeCashierCommand>[2]['command'],
    options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
  ) =>
    executeCashierCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        'tenant.cashier.manage',
        options.permission ?? 'tenant.payment.post',
        options.key,
        { ...branchOnly, ...options.overrides },
      ),
    });
  const cashierRead = (search?: string, overrides: Record<string, unknown> = {}) =>
    readCashierWorkspace(runtime.db, tenantId, {
      ...(search ? { query: { search } } : {}),
      authorization: sign('tenant.cashier.workspace.read', 'tenant.payment.view', randomUUID(), {
        ...branchOnly,
        ...overrides,
      }),
    });
  const collections = (
    command: Parameters<typeof executeCollectionCommand>[2]['command'],
    options: { key?: string; overrides?: Record<string, unknown> } = {},
  ) =>
    executeCollectionCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        'tenant.collection.manage',
        'tenant.collection.reconcile',
        options.key,
        options.overrides,
      ),
    });
  const collectionsRead = (overrides: Record<string, unknown> = {}) =>
    readCollectionsWorkspace(runtime.db, tenantId, {
      authorization: sign(
        'tenant.collections.workspace.read',
        'tenant.collection.view',
        randomUUID(),
        overrides,
      ),
    });
  const openBalance = async () => {
    const ws = await cashierRead(String(fixture.display_name));
    const sub = ws.subscribers.find((s) => s.id === subscriberId);
    assert(sub, 'subscriber found by name');
    return sub.openInvoices.find((i) => i.id === invoiceId)?.remainingMinor ?? 0;
  };

  // --- Cashier: authority, drawer and a partial cash receipt ---
  await assert.rejects(cashierRead(undefined, { permission: 'tenant.subscriber.view' }));
  assert.equal(await openBalance(), outstanding);
  const drawer = await cashier({
    action: 'open_drawer',
    branchId,
    currency: 'USD',
    openingFloatMinor: 10_000,
  });
  assert.equal(drawer.status, 'open');
  await assert.rejects(
    cashier({ action: 'open_drawer', branchId, currency: 'USD', openingFloatMinor: 0 }),
  );
  await assert.rejects(
    cashier({
      action: 'open_drawer',
      branchId: randomUUID(),
      currency: 'LBP',
      openingFloatMinor: 0,
    }),
  );
  const receiptKey = randomUUID();
  const receipt1 = await cashier(
    {
      action: 'record_receipt',
      subscriberId,
      invoiceId,
      amountMinor: p1,
      currency: 'USD',
      method: 'cash',
    },
    { key: receiptKey },
  );
  assert.equal(receipt1.allocatedMinor, p1);
  assert.equal(receipt1.unallocatedMinor, 0);
  assert.equal(receipt1.drawerId, drawer.drawerId);
  assert.match(String(receipt1.receiptNumber), /^RC-\d{6}$/u);
  const replay = await cashier(
    {
      action: 'record_receipt',
      subscriberId,
      invoiceId,
      amountMinor: p1,
      currency: 'USD',
      method: 'cash',
    },
    { key: receiptKey },
  );
  assert.equal(replay.receiptId, receipt1.receiptId);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    cashier(
      {
        action: 'record_receipt',
        subscriberId,
        invoiceId,
        amountMinor: p1 + 1,
        currency: 'USD',
        method: 'cash',
      },
      { key: receiptKey },
    ),
    /different content/u,
  );
  assert.equal(await openBalance(), outstanding - p1);
  await assert.rejects(
    cashier(
      { action: 'record_receipt', subscriberId, amountMinor: 1, currency: 'USD', method: 'cash' },
      { permission: 'tenant.payment.view' },
    ),
  );
  await assert.rejects(
    cashier(
      { action: 'record_receipt', subscriberId, amountMinor: 1, currency: 'USD', method: 'cash' },
      { overrides: { branchIds: [randomUUID()] } },
    ),
  );
  await assert.rejects(
    cashier({
      action: 'record_receipt',
      subscriberId,
      amountMinor: 1,
      currency: 'USD',
      method: 'card',
    }),
    /reference/u,
  );
  await assert.rejects(
    cashier({
      action: 'record_receipt',
      subscriberId,
      invoiceId,
      amountMinor: 1,
      currency: 'LBP',
      method: 'cash',
    }),
    /not open/u,
  );

  // --- Collections: route collector, assignment from the open balance, evidence, settlement ---
  await collections({ action: 'assign_route_collector', routeId, collectorUserId: null });
  await assert.rejects(
    collections({ action: 'assign_invoice', invoiceId, dueOn: today }),
    /no default collector/u,
  );
  await assert.rejects(
    collections({ action: 'assign_route_collector', routeId, collectorUserId: randomUUID() }),
  );
  const routeCollector = await collections({
    action: 'assign_route_collector',
    routeId,
    collectorUserId: collectorId,
  });
  assert.equal(routeCollector.collectorUserId, collectorId);
  const assigned = await collections({ action: 'assign_invoice', invoiceId, dueOn: today });
  assert.equal(assigned.assigned, 1);
  const assignment = (
    assigned.assignments as { assignmentId: string; expectedMinor: number }[]
  )[0]!;
  assert.equal(Number(assignment.expectedMinor), outstanding - p1);
  await assert.rejects(
    collections({ action: 'assign_invoice', invoiceId, dueOn: today }),
    /already assigned/u,
  );
  let ws = await collectionsRead();
  const route = ws.routes.find((r) => r.id === routeId);
  assert.equal(route?.collectorUserId, collectorId);
  assert.ok((route?.openAssignments ?? 0) >= 1);
  let row = ws.assignments.find((a) => a.id === assignment.assignmentId);
  assert.equal(row?.status, 'assigned');
  assert.equal(row?.openMinor, outstanding - p1);
  assert.equal(row?.collectorName, 'Route collector');
  assert.ok(
    ws.collectors.some((c) => c.userId === collectorId && c.routes === 1 && c.openAssignments >= 1),
  );
  assert.equal((await collectionsRead({ branchIds: [randomUUID()] })).assignments.length, 0);
  await collections({ action: 'mark_visited', assignmentId: assignment.assignmentId });
  await assert.rejects(
    recordCollection(runtime.db, tenantId, {
      command: {
        action: 'record_collection',
        assignmentId: assignment.assignmentId,
        amountMinor: outstanding,
      },
      authorization: sign('tenant.collection.manage', 'tenant.payment.post'),
    }),
    /at most the open balance/u,
  );
  await assert.rejects(
    recordCollection(runtime.db, tenantId, {
      command: {
        action: 'record_collection',
        assignmentId: assignment.assignmentId,
        amountMinor: p2,
      },
      authorization: sign('tenant.collection.manage', 'tenant.collection.reconcile'),
    }),
  );
  const collected = await recordCollection(runtime.db, tenantId, {
    command: {
      action: 'record_collection',
      assignmentId: assignment.assignmentId,
      amountMinor: p2,
    },
    authorization: sign('tenant.collection.manage', 'tenant.payment.post'),
  });
  assert.match(String(collected.receiptNumber), /^CR-\d{6}$/u);
  assert.equal(collected.remainingMinor, outstanding - p1 - p2);
  await assert.rejects(
    recordCollection(runtime.db, tenantId, {
      command: { action: 'record_collection', assignmentId: assignment.assignmentId },
      authorization: sign('tenant.collection.manage', 'tenant.payment.post'),
    }),
    /not payable/u,
  );
  await assert.rejects(
    collections({
      action: 'reassign',
      assignmentId: assignment.assignmentId,
      collectorUserId: managerId,
    }),
    /collected/u,
  );
  ws = await collectionsRead();
  row = ws.assignments.find((a) => a.id === assignment.assignmentId);
  assert.equal(row?.status, 'collected');
  assert.equal(row?.collectedMinor, p2);
  assert.equal(await openBalance(), outstanding - p1 - p2);
  const accepted = await collections({
    action: 'settle_route',
    routeId,
    collectorUserId: collectorId,
    businessDate: today,
    currency: 'USD',
    declaredMinor: p2,
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.expectedMinor, p2);
  await assert.rejects(
    collections({
      action: 'settle_route',
      routeId,
      collectorUserId: collectorId,
      businessDate: today,
      currency: 'USD',
      declaredMinor: p2,
    }),
    /already settled/u,
  );
  await assert.rejects(
    collections({
      action: 'settle_route',
      routeId,
      collectorUserId: collectorId,
      businessDate: today,
      currency: 'LBP',
      declaredMinor: 100,
    }),
    /needs a reason/u,
  );
  const pending = await collections({
    action: 'settle_route',
    routeId,
    collectorUserId: collectorId,
    businessDate: today,
    currency: 'LBP',
    declaredMinor: 100,
    reason: 'Collector handed in 100 LBP found in the bag with no matching receipt.',
  });
  assert.equal(pending.status, 'pending_approval');
  assert.equal(pending.differenceMinor, 100);
  await assert.rejects(
    collections({
      action: 'approve_settlement',
      settlementId: String(pending.settlementId),
      expectedVersion: 1,
      reason: 'Approving my own settlement.',
    }),
    /different manager/u,
  );
  await assert.rejects(
    collections(
      {
        action: 'approve_settlement',
        settlementId: String(pending.settlementId),
        expectedVersion: 2,
        reason: 'Stale version approval attempt.',
      },
      { overrides: { actorId: managerId } },
    ),
    /changed since/u,
  );
  const approved = await collections(
    {
      action: 'approve_settlement',
      settlementId: String(pending.settlementId),
      expectedVersion: 1,
      reason: 'Counted twice with the collector; surplus posted to suspense.',
    },
    { overrides: { actorId: managerId } },
  );
  assert.equal(approved.status, 'approved');
  assert.equal(approved.version, 2);
  ws = await collectionsRead();
  const settlement = ws.settlements.find((s) => s.id === pending.settlementId);
  assert.equal(settlement?.status, 'approved');
  assert.equal(settlement?.approvedBy, 'Second manager');
  assert.equal(settlement?.source, 'office');

  // --- Cashier: pay the rest by card, void the cash receipt, close the drawer ---
  const receipt2 = await cashier({
    action: 'record_receipt',
    subscriberId,
    invoiceId,
    amountMinor: outstanding - p1 - p2 + p3,
    currency: 'USD',
    method: 'card',
    reference: 'POS-7781',
  });
  assert.equal(receipt2.allocatedMinor, outstanding - p1 - p2);
  assert.equal(receipt2.unallocatedMinor, p3);
  assert.equal(receipt2.drawerId, null);
  assert.equal(await openBalance(), 0);
  await assert.rejects(
    voidReceipt(runtime.db, tenantId, {
      command: {
        action: 'void_receipt',
        receiptId: String(receipt1.receiptId),
        reason: 'Wrong subscriber selected at the counter.',
      },
      authorization: sign('tenant.cashier.manage', 'tenant.payment.post', randomUUID(), branchOnly),
    }),
  );
  const voided = await voidReceipt(runtime.db, tenantId, {
    command: {
      action: 'void_receipt',
      receiptId: String(receipt1.receiptId),
      reason: 'Wrong subscriber selected at the counter.',
    },
    authorization: sign(
      'tenant.cashier.manage',
      'tenant.payment.reverse',
      randomUUID(),
      branchOnly,
    ),
  });
  assert.equal(voided.reversedAllocations, 1);
  assert.ok(voided.reversalPaymentId);
  await assert.rejects(
    voidReceipt(runtime.db, tenantId, {
      command: {
        action: 'void_receipt',
        receiptId: String(receipt1.receiptId),
        reason: 'Voiding the same receipt a second time.',
      },
      authorization: sign(
        'tenant.cashier.manage',
        'tenant.payment.reverse',
        randomUUID(),
        branchOnly,
      ),
    }),
    /already voided/u,
  );
  assert.equal(await openBalance(), p1);
  await assert.rejects(
    cashier({
      action: 'close_drawer',
      drawerId: String(drawer.drawerId),
      expectedVersion: 5,
      countedMinor: 10_000 + p1,
    }),
    /changed since/u,
  );
  const closed = await cashier({
    action: 'close_drawer',
    drawerId: String(drawer.drawerId),
    expectedVersion: 1,
    countedMinor: 10_000 + p1,
    note: 'Extra 500 in the till',
  });
  assert.equal(closed.expectedMinor, 10_000);
  assert.equal(closed.varianceMinor, p1);
  await assert.rejects(
    cashier({
      action: 'close_drawer',
      drawerId: String(drawer.drawerId),
      expectedVersion: 2,
      countedMinor: 0,
    }),
    /already closed/u,
  );
  const cashierWs = await cashierRead();
  const drawerRow = cashierWs.drawers.find((d) => d.id === drawer.drawerId);
  assert.equal(drawerRow?.status, 'closed');
  assert.equal(drawerRow?.varianceMinor, p1);
  assert.equal(drawerRow?.mine, true);
  const r1 = cashierWs.receipts.find((r) => r.id === receipt1.receiptId);
  const r2 = cashierWs.receipts.find((r) => r.id === receipt2.receiptId);
  assert.ok(r1?.voidedAt, 'void is visible');
  assert.equal(r1?.allocatedMinor, 0);
  assert.equal(r2?.allocatedMinor, outstanding - p1 - p2);
  assert.equal(r2?.method, 'card');
  const cardToday = cashierWs.today.find((t) => t.currency === 'USD' && t.method === 'card');
  assert.ok(cardToday && cardToday.amountMinor >= outstanding - p1 - p2);
  assert.equal(
    (await cashierRead(String(fixture.display_name), { branchIds: [randomUUID()] })).subscribers
      .length,
    0,
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::integer AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND resource_type IN ('operations_cash_drawers','operations_route_settlements','operations_route_collectors','operations_collector_assignments','operations_office_payment_requests') AND action IN ('tenant.cashier.manage','tenant.collection.manage')",
    [tenantId],
  );
  assert.ok(audit.count >= 10, `audit rows recorded (${audit.count})`);
  await assert.rejects(
    admin.unsafe('UPDATE operations_cashier_events SET action=$1 WHERE tenant_id=$2', [
      'tampered',
      tenantId,
    ]),
    'cashier events are append-only',
  );
  process.stdout.write('Cashier and collections acceptance passed.\n');
} finally {
  await Promise.all([admin.end({ timeout: 5 }), runtime.client.end({ timeout: 5 })]);
}
