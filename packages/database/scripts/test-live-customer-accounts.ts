// Run after test-live-sales.ts against the disposable local test database.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type {
  CustomerAccountCommand,
  CustomerAccountKind,
  Permission,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  inOperationsTransaction,
  postCustomerAccountEntry,
  readCustomerAccounts,
  readBillingWorkspace,
  readSubscriberWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl)
  throw new Error('Set SALES_TEST_ADMIN_DATABASE_URL and SALES_TEST_RUNTIME_DATABASE_URL.');
for (const url of [adminUrl, runtimeUrl]) {
  const parsed = new URL(url);
  assert(
    ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.pathname === '/isp_test',
    'This fixture test may run only against local isp_test.',
  );
}
const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = 'account-test-' + randomUUID();
const secret = randomBytes(32);
const run = randomUUID();
const permissions: Record<CustomerAccountKind, Permission> = {
  credit_note: 'tenant.invoice.reverse',
  credit_reversal: 'tenant.invoice.reverse',
  deposit_received: 'tenant.payment.post',
  deposit_applied: 'tenant.payment.post',
  deposit_application_reversal: 'tenant.payment.reverse',
  deposit_reversal: 'tenant.payment.reverse',
};
try {
  const [fixture] = await admin.unsafe(
    'SELECT i.tenant_id,i.id AS invoice_id,s.subscriber_id,i.currency,i.actor_id,s.branch_id,s.area_id,s.route_id,' +
      'i.amount_minor-g.allocated_minor-g.credited_minor AS outstanding,p.subtotal_minor-g.credited_net_minor AS net ' +
      'FROM tenants t JOIN operations_invoice_preparations p ON p.tenant_id=t.id ' +
      'JOIN finance_invoices i ON i.tenant_id=p.tenant_id AND i.id=p.finance_invoice_id ' +
      'JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id ' +
      "JOIN finance_document_guards g ON g.tenant_id=i.tenant_id AND g.document_id=i.id AND g.document_type='invoice' " +
      "WHERE t.code LIKE 'SALES-%' AND g.reversed_at IS NULL AND i.currency='USD' " +
      'AND i.amount_minor-g.allocated_minor-g.credited_minor>1000 AND p.subtotal_minor-g.credited_net_minor>1000 ' +
      'ORDER BY i.posted_at DESC LIMIT 1',
  );
  assert(fixture, 'Run the sales live fixture first; need an unpaid synthetic sales invoice.');
  const tenantId = fixture.tenant_id as VerifiedTenantId;
  const invoiceId = fixture.invoice_id as string;
  const subscriberId = fixture.subscriber_id as string;
  await admin.unsafe(
    "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
    [keyId, secret.toString('hex')],
  );
  function auth(
    permission: Permission,
    action: string,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) {
    return signOperationsAttestation(
      {
        keyId,
        tenantId,
        actorId: fixture!.actor_id,
        sessionId: randomUUID(),
        permission,
        action,
        requestId: randomUUID(),
        ipAddress: '127.0.0.1',
        userAgent: 'customer-account-live-proof',
        reason: 'Synthetic customer account financial proof',
        idempotencyKey: key,
        branchIds: [fixture!.branch_id],
        areaIds: [fixture!.area_id],
        routeIds: [fixture!.route_id],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      secret,
    );
  }
  const common = (name: string) => ({
    documentNumber: run + '-' + name,
    reasonEn: 'Synthetic billing correction',
    reasonAr: 'تصحيح فوترة تجريبي موثق',
  });
  const post = (
    command: CustomerAccountCommand,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    postCustomerAccountEntry(runtime.db, tenantId, {
      command,
      authorization: auth(
        permissions[command.kind],
        'tenant.customer_account.' + command.kind,
        key,
        overrides,
      ),
    });
  const read = () =>
    readCustomerAccounts(runtime.db, tenantId, {
      authorization: auth('tenant.billing.view', 'tenant.customer_account.read'),
    });
  const balance = async () =>
    Number((await read()).invoices.find((i) => i.id === invoiceId)?.outstandingMinor);
  await readBillingWorkspace(runtime.db, tenantId, {
    authorization: auth('tenant.invoice.create', 'tenant.billing.workspace.read'),
  });
  const start = await balance();
  assert.equal(start, Number(fixture.outstanding));
  const credit: CustomerAccountCommand = {
    ...common('credit'),
    kind: 'credit_note',
    subscriberId,
    invoiceId,
    currency: 'USD',
    netMinor: 100,
    vatMinor: 0,
    stampMinor: 0,
  };
  await assert.rejects(post(credit, randomUUID(), { permission: 'tenant.billing.view' }));
  await assert.rejects(post(credit, randomUUID(), { branchIds: [] }));
  await assert.rejects(post(credit, randomUUID(), { recordIds: [] }));
  await assert.rejects(post({ ...credit, subscriberId: randomUUID() }));
  await assert.rejects(post({ ...credit, invoiceId: randomUUID() }));
  await assert.rejects(post({ ...credit, currency: 'LBP' }));
  await assert.rejects(post({ ...credit, netMinor: start + 1 }));
  await assert.rejects(post({ ...credit, vatMinor: start + 1 }));
  const replayKey = randomUUID();
  const [creditEntry, replay] = await Promise.all([
    post(credit, replayKey),
    post(credit, replayKey),
  ]);
  assert.equal(creditEntry.id, replay.id);
  assert.equal(await balance(), start - 100);
  await assert.rejects(post({ ...credit, netMinor: 101 }, replayKey));
  const largeDeposit = await post({
    ...common('credit-ceiling-deposit'),
    kind: 'deposit_received',
    subscriberId,
    currency: 'USD',
    amountMinor: start,
    sourceReference: run + '-ceiling-receipt',
  });
  await assert.rejects(
    post({
      ...common('over-credited-ceiling'),
      kind: 'deposit_applied',
      sourceEntryId: largeDeposit.id,
      invoiceId,
      amountMinor: start - 50,
    }),
    'legacy face amount must not bypass the credited invoice ceiling',
  );
  await post({
    ...common('undo-ceiling-deposit'),
    kind: 'deposit_reversal',
    sourceEntryId: largeDeposit.id,
  });
  assert.equal(await balance(), start - 100);
  const subscriberView = await readSubscriberWorkspace(runtime.db, tenantId, {
    authorization: auth('tenant.subscriber.view', 'tenant.subscriber.workspace.read'),
  });
  const adjusted = subscriberView.invoices.find((i) => i.id === invoiceId);
  assert.equal(adjusted?.outstandingMinor, start - 100);
  assert.equal(adjusted?.creditedMinor, 100);
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      auth('tenant.invoice.reverse', 'tenant.customer_account.credit_reversal'),
      (tx) =>
        tx.execute(sql.raw("UPDATE operations_customer_account_entries SET reason_en='tampered'")),
    ),
  );
  // Signed context + raw tenant GUC cannot reveal another tenant.
  const deniedRead = await readCustomerAccounts(runtime.db, tenantId, {
    authorization: auth('tenant.billing.view', 'tenant.customer_account.read', randomUUID(), {
      branchIds: [],
    }),
  });
  assert.equal(deniedRead.entries.length, 0);
  assert.equal(deniedRead.invoices.length, 0);
  const receipt: CustomerAccountCommand = {
    ...common('deposit'),
    kind: 'deposit_received',
    subscriberId,
    currency: 'USD',
    amountMinor: 300,
    sourceReference: run + '-actual-receipt',
  };
  const receiptKey = randomUUID();
  const deposit = await post(receipt, receiptKey);
  assert.equal((await post(receipt, receiptKey)).id, deposit.id);
  await assert.rejects(post({ ...receipt, documentNumber: run + '-duplicate-reference' }));
  assert.equal(await balance(), start - 100);
  const applied = await post({
    ...common('apply'),
    kind: 'deposit_applied',
    sourceEntryId: deposit.id,
    invoiceId,
    amountMinor: 200,
  });
  assert.equal(await balance(), start - 300);
  await assert.rejects(
    post({
      ...common('overspend'),
      kind: 'deposit_applied',
      sourceEntryId: deposit.id,
      invoiceId,
      amountMinor: 101,
    }),
  );
  await assert.rejects(
    post({ ...common('used-receipt'), kind: 'deposit_reversal', sourceEntryId: deposit.id }),
  );
  const applications = await Promise.allSettled(
    [1, 2].map((n) =>
      post({
        ...common('race-' + n),
        kind: 'deposit_applied',
        sourceEntryId: deposit.id,
        invoiceId,
        amountMinor: 100,
      }),
    ),
  );
  assert.equal(
    applications.filter((r) => r.status === 'fulfilled').length,
    1,
    'only one concurrent spender succeeds',
  );
  const winner = applications.find((r) => r.status === 'fulfilled');
  assert(winner?.status === 'fulfilled');
  assert.equal(await balance(), start - 400);
  await post({
    ...common('undo-race'),
    kind: 'deposit_application_reversal',
    sourceEntryId: winner.value.id,
  });
  const undo = await post({
    ...common('undo-apply'),
    kind: 'deposit_application_reversal',
    sourceEntryId: applied.id,
  });
  assert(undo.id);
  await assert.rejects(
    post({
      ...common('undo-twice'),
      kind: 'deposit_application_reversal',
      sourceEntryId: applied.id,
    }),
  );
  await post({ ...common('undo-receipt'), kind: 'deposit_reversal', sourceEntryId: deposit.id });
  await assert.rejects(
    post({
      ...common('use-reversed'),
      kind: 'deposit_applied',
      sourceEntryId: deposit.id,
      invoiceId,
      amountMinor: 1,
    }),
  );
  await post({ ...common('undo-credit'), kind: 'credit_reversal', sourceEntryId: creditEntry.id });
  await assert.rejects(
    post({
      ...common('undo-credit-twice'),
      kind: 'credit_reversal',
      sourceEntryId: creditEntry.id,
    }),
  );
  assert.equal(await balance(), start);
  const lbp = await post({
    ...common('lbp'),
    kind: 'deposit_received',
    subscriberId,
    currency: 'LBP',
    amountMinor: 100000,
    sourceReference: run + '-lbp-receipt',
  });
  await assert.rejects(
    post({
      ...common('cross-currency'),
      kind: 'deposit_applied',
      sourceEntryId: lbp.id,
      invoiceId,
      amountMinor: 1,
    }),
  );
  await post({ ...common('undo-lbp'), kind: 'deposit_reversal', sourceEntryId: lbp.id });
  const [audit] = await admin.unsafe(
    'SELECT count(*)::integer AS count FROM operations_audit_outbox ' +
      "WHERE tenant_id=$1 AND resource_type='operations_customer_account_entries' AND after_value->>'document_number' LIKE $2",
    [tenantId, run + '%'],
  );
  assert.equal(audit.count, 12, 'each successful append emits exactly one atomic audit record');
  assert.equal(await balance(), start);
  console.log(
    'Customer accounts live proof passed: credits, deposits, reversals, retry/concurrency, scopes, currency, audit, balance consumers.',
  );
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
