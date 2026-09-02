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
  readChartOfAccounts,
  readJournalEntries,
  readCustomerStatement,
  readTrialBalance,
  readAccountingPeriods,
  postJournalEntry,
  closeAccountingPeriod,
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
      'AND NOT EXISTS(SELECT 1 FROM operations_accounting_periods ap WHERE ap.tenant_id=t.id ' +
      "AND ap.status<>'open' AND (clock_timestamp() AT TIME ZONE 'UTC')::date BETWEEN ap.start_date AND ap.end_date) " +
      'AND EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=i.tenant_id AND j.finance_source_id=i.id) ' +
      'ORDER BY i.created_at DESC,i.id LIMIT 1',
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

  // REQ-FIN-001/002: verify journal effects with the real restricted runtime role.
  const unrestricted = { branchIds: undefined, areaIds: undefined, routeIds: undefined };
  const accountingAuth = (
    action: string,
    permission: Permission = 'tenant.accounting.view',
    key = randomUUID(),
  ) => auth(permission, action, key, unrestricted);
  const chart = await readChartOfAccounts(
    runtime.db,
    tenantId,
    accountingAuth('tenant.accounting.coa.read'),
  );
  assert(chart.length >= 17);
  await assert.rejects(
    readChartOfAccounts(
      runtime.db,
      tenantId,
      auth('tenant.accounting.view', 'tenant.accounting.coa.read'),
    ),
  );
  await assert.rejects(
    readChartOfAccounts(
      runtime.db,
      tenantId,
      accountingAuth('tenant.accounting.coa.read', 'tenant.billing.view'),
    ),
  );
  const journals = await admin.unsafe(
    'SELECT j.id,j.customer_entry_id,j.reverses_journal_id,j.posting_version,c.kind,c.currency ' +
      'FROM operations_journal_entries j JOIN operations_customer_account_entries c ' +
      'ON c.tenant_id=j.tenant_id AND c.id=j.customer_entry_id WHERE c.document_number LIKE $1',
    [run + '%'],
  );
  assert.equal(journals.length, 12, 'one journal per actual append; retries never double-post');
  for (const j of journals) {
    assert.equal(j.posting_version, 'v2');
    const lines = await admin.unsafe(
      'SELECT debit_minor,credit_minor,currency FROM operations_journal_lines WHERE journal_entry_id=$1',
      [j.id],
    );
    assert(
      lines.every((l) => l.currency === j.currency),
      'journal currency comes from persisted source, including LBP reversal',
    );
    assert.equal(
      lines.reduce((n, l) => n + Number(l.debit_minor) - Number(l.credit_minor), 0),
      0,
    );
    if (j.reverses_journal_id) {
      const [difference] = await admin.unsafe(
        'SELECT count(*)::int AS count FROM (' +
          '(SELECT account_id,currency,debit_minor,credit_minor FROM operations_journal_lines WHERE journal_entry_id=$1 EXCEPT ALL ' +
          'SELECT account_id,currency,credit_minor,debit_minor FROM operations_journal_lines WHERE journal_entry_id=$2)' +
          ' UNION ALL (SELECT account_id,currency,credit_minor,debit_minor FROM operations_journal_lines WHERE journal_entry_id=$2 EXCEPT ALL ' +
          'SELECT account_id,currency,debit_minor,credit_minor FROM operations_journal_lines WHERE journal_entry_id=$1)) d',
        [j.id, j.reverses_journal_id],
      );
      assert.equal(difference.count, 0, 'reversal swaps the exact original lines');
    }
  }
  const statement = (startDate = '0001-01-01', endDate = '9999-12-31', page = 1, pageSize = 200) =>
    readCustomerStatement(
      runtime.db,
      tenantId,
      auth('tenant.accounting.view', 'tenant.accounting.statement.read'),
      { subscriberId, currency: 'USD', startDate, endDate, page, pageSize },
    );
  const fullStatement = await statement();
  const secondPage = await statement('0001-01-01', '9999-12-31', 2, 1);
  assert.equal(secondPage.entries[0]?.id, fullStatement.entries[1]?.id);
  assert.equal(
    secondPage.entries[0]?.runningBalanceMinor,
    fullStatement.entries[1]?.runningBalanceMinor,
  );
  assert.equal(secondPage.totalCount, fullStatement.totalCount);
  const futureStatement = await statement('9999-01-01');
  assert.equal(futureStatement.entries.length, 0);
  assert.equal(futureStatement.openingBalanceMinor, fullStatement.closingBalanceMinor);
  assert.equal(futureStatement.closingBalanceMinor, fullStatement.closingBalanceMinor);
  const checkDeposit = await post({
    ...common('statement-deposit'),
    kind: 'deposit_received',
    subscriberId,
    currency: 'USD',
    amountMinor: 20,
    sourceReference: run + '-statement',
  });
  const receivedStatement = await statement();
  assert.equal(receivedStatement.closingBalanceMinor, fullStatement.closingBalanceMinor - 20);
  const checkApplied = await post({
    ...common('statement-apply'),
    kind: 'deposit_applied',
    sourceEntryId: checkDeposit.id,
    invoiceId,
    amountMinor: 20,
  });
  assert.equal(
    (await statement()).closingBalanceMinor,
    receivedStatement.closingBalanceMinor,
    'deposit allocation is a transfer, not a second customer credit',
  );
  await post({
    ...common('statement-undo-apply'),
    kind: 'deposit_application_reversal',
    sourceEntryId: checkApplied.id,
  });
  await post({
    ...common('statement-undo-deposit'),
    kind: 'deposit_reversal',
    sourceEntryId: checkDeposit.id,
  });
  assert.equal((await statement()).closingBalanceMinor, fullStatement.closingBalanceMinor);
  const [tax] = await admin.unsafe(
    "SELECT (p.legal_invoice_snapshot#>>'{tax,amountMinor}')::bigint-g.credited_vat_minor AS vat," +
      "(p.legal_invoice_snapshot#>>'{amounts,stampDutyMinor}')::bigint-g.credited_stamp_minor AS stamp " +
      'FROM operations_invoice_preparations p JOIN finance_document_guards g ON g.tenant_id=p.tenant_id ' +
      "AND g.document_id=p.finance_invoice_id AND g.document_type='invoice' WHERE p.finance_invoice_id=$1",
    [invoiceId],
  );
  const taxed = await post({
    ...common('tax-credit'),
    kind: 'credit_note',
    subscriberId,
    invoiceId,
    currency: 'USD',
    netMinor: 10,
    vatMinor: Number(tax.vat) > 0 ? 1 : 0,
    stampMinor: Number(tax.stamp) > 0 ? 1 : 0,
  });
  const components = await admin.unsafe(
    'SELECT a.account_code,l.debit_minor,l.credit_minor FROM operations_journal_lines l ' +
      'JOIN operations_chart_of_accounts a ON a.id=l.account_id JOIN operations_journal_entries j ON j.id=l.journal_entry_id ' +
      'WHERE j.customer_entry_id=$1',
    [taxed.id],
  );
  assert.equal(Number(components.find((c) => c.account_code === '4000')?.debit_minor), 10);
  if (Number(tax.vat) > 0)
    assert.equal(Number(components.find((c) => c.account_code === '2200')?.debit_minor), 1);
  if (Number(tax.stamp) > 0)
    assert.equal(Number(components.find((c) => c.account_code === '2220')?.debit_minor), 1);
  await post({ ...common('tax-credit-reverse'), kind: 'credit_reversal', sourceEntryId: taxed.id });

  const cash = chart.find((a) => a.accountCode === '1010')!;
  const receivable = chart.find((a) => a.accountCode === '1100')!;
  const [yearRow] = await admin.unsafe(
    'SELECT y FROM generate_series(1000,1900) y WHERE NOT EXISTS(SELECT 1 FROM operations_accounting_periods ' +
      'WHERE tenant_id=$1 AND start_date<=make_date(y,12,31) AND end_date>=make_date(y,1,1)) ORDER BY y LIMIT 1',
    [tenantId],
  );
  const oldDate = yearRow.y + '-01-01',
    newDate = yearRow.y + '-12-31';
  const tbBefore = await readTrialBalance(
    runtime.db,
    tenantId,
    accountingAuth('tenant.accounting.trial_balance.read'),
    oldDate,
  );
  const manualKey = randomUUID();
  const command = {
    entryNumber: run + '-manual',
    entryDate: newDate,
    descriptionEn: 'Synthetic manual journal',
    descriptionAr: 'قيد يومية تجريبي موثق',
    sourceType: 'manual' as const,
    lines: [
      { accountId: cash.id, debitMinor: 30, creditMinor: 0, currency: 'USD' as const },
      { accountId: receivable.id, debitMinor: 0, creditMinor: 30, currency: 'USD' as const },
    ],
  };
  const postManual = (key = manualKey, change = {}) =>
    postJournalEntry(runtime.db, tenantId, {
      command: { ...command, ...change },
      authorization: accountingAuth(
        'tenant.accounting.journal.post',
        'tenant.accounting.post',
        key,
      ),
    });
  const posted = await postManual();
  assert.equal((await postManual()).id, posted.id);
  await assert.rejects(postManual(manualKey, { descriptionEn: 'Changed retry payload' }));
  const tbOld = await readTrialBalance(
    runtime.db,
    tenantId,
    accountingAuth('tenant.accounting.trial_balance.read'),
    oldDate,
  );
  assert.equal(tbOld.totalDebitUsd, tbBefore.totalDebitUsd, 'future journal lines excluded');
  const tbNew = await readTrialBalance(
    runtime.db,
    tenantId,
    accountingAuth('tenant.accounting.trial_balance.read'),
    newDate,
  );
  assert.equal(tbNew.totalDebitUsd, tbBefore.totalDebitUsd + 30);
  assert.equal(tbNew.totalDebitUsd, tbNew.totalCreditUsd);
  assert.equal(tbNew.totalDebitLbp, tbNew.totalCreditLbp);
  const rawPost = (payload: unknown) =>
    inOperationsTransaction(
      runtime.db,
      tenantId,
      accountingAuth('tenant.accounting.journal.post', 'tenant.accounting.post'),
      async (tx) => {
        await tx.execute(
          sql`SELECT post_manual_accounting_journal(${JSON.stringify(payload)}::jsonb)`,
        );
      },
    );
  await assert.rejects(
    rawPost({
      ...command,
      entryNumber: run + '-unbalanced',
      lines: [command.lines[0], { ...command.lines[1], creditMinor: 29 }],
    }),
    'database must reject imbalance without relying on Zod',
  );
  await assert.rejects(
    rawPost({
      ...command,
      entryNumber: run + '-currency',
      lines: [command.lines[0], { ...command.lines[1], currency: 'LBP' }],
    }),
  );
  const [otherTenant] = await admin.unsafe('SELECT id FROM tenants WHERE id<>$1 LIMIT 1', [
    tenantId,
  ]);
  assert(otherTenant);
  const [otherAccount] = await admin.unsafe(
    'INSERT INTO operations_chart_of_accounts(tenant_id,account_code,account_name_en,account_name_ar,account_type,currency) ' +
      "VALUES($1,$2,'Foreign test account','حساب اختبار آخر','asset','USD') RETURNING id",
    [otherTenant.id, run],
  );
  await assert.rejects(
    rawPost({
      ...command,
      entryNumber: run + '-foreign',
      lines: [command.lines[0], { ...command.lines[1], accountId: otherAccount.id }],
    }),
  );
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      accountingAuth('tenant.accounting.journal.post', 'tenant.accounting.post'),
      (tx) => tx.execute(sql`DELETE FROM operations_journal_entries WHERE id=${posted.id}`),
    ),
  );
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      accountingAuth('tenant.accounting.coa.read'),
      (tx) => tx.execute(sql`SELECT seed_tenant_default_chart_of_accounts(${otherTenant.id})`),
    ),
  );
  const closeKey = randomUUID();
  const request = {
    periodName: run,
    startDate: oldDate,
    endDate: newDate,
    closeType: 'hard' as const,
    notesEn: 'Synthetic close proof',
    notesAr: 'اختبار إغلاق موثق',
  };
  const close = () =>
    closeAccountingPeriod(runtime.db, tenantId, {
      request,
      authorization: accountingAuth(
        'tenant.accounting.period.close',
        'tenant.accounting.close',
        closeKey,
      ),
    });
  const closed = await close();
  assert.equal((await close()).id, closed.id);
  assert(
    (
      await readAccountingPeriods(
        runtime.db,
        tenantId,
        accountingAuth('tenant.accounting.periods.read'),
      )
    ).some((p) => p.id === closed.id),
  );
  await assert.rejects(
    postManual(randomUUID(), { entryNumber: run + '-closed' }),
    'closed-period posting denied',
  );
  const currentCoverage = await readTrialBalance(
    runtime.db,
    tenantId,
    accountingAuth('tenant.accounting.trial_balance.read'),
    new Date().toISOString().slice(0, 10),
  );
  assert.equal(
    currentCoverage.coverage?.hasUnjournaledInvoices,
    false,
    'governed invoices now have source journals; the prior missing-coverage assertion is obsolete',
  );
  assert.equal(currentCoverage.coverage?.hasUnjournaledSources, false);
  assert(
    (
      await readJournalEntries(
        runtime.db,
        tenantId,
        accountingAuth('tenant.accounting.journal.read'),
      )
    ).length > 0,
  );
  const [journalAudits] = await admin.unsafe(
    'SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 ' +
      "AND resource_type='operations_journal_entries' AND after_value->>'entry_number'=$2",
    [tenantId, command.entryNumber],
  );
  assert.equal(journalAudits.count, 1);
  assert.equal(await balance(), start);
  console.log(
    'Accounting live proof passed: atomic journals, exact reversals, currencies/taxes, statement paging/date opening/deposit transfers, scoped RLS, safe manual posting/replay, trial cutoff, period close and audit.',
  );

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
