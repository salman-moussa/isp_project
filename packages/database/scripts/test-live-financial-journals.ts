import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import {
  createDatabase,
  signOperationsAttestation,
  postInvoice,
  postPayment,
  allocatePayment,
  reverseInvoice,
  reversePayment,
  reverseAllocation,
  closeAccountingPeriod,
  readTrialBalance,
  postJournalEntry,
  readChartOfAccounts,
  readJournalEntries,
  assignCollectorInvoice,
  authorizeCollectDevice,
  syncCollectOperations,
  readCollectBootstrap,
} from '../src/index.js';

const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error('Set the local SALES_TEST database URLs.');
for (const url of [adminUrl, runtimeUrl]) {
  const target = new URL(url);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Only local isp_test may be used.',
  );
}
const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = 'financial-journal-' + randomUUID(),
  secret = randomBytes(32),
  run = randomUUID();
try {
  const [fixture] = await admin.unsafe(
    'SELECT i.tenant_id,i.actor_id FROM finance_invoices i JOIN tenants t ON t.id=i.tenant_id ' +
      'JOIN operations_journal_entries j ON j.tenant_id=i.tenant_id AND j.finance_source_id=i.id ' +
      "WHERE t.code LIKE 'SALES-%' AND NOT j.classification_required ORDER BY i.created_at DESC LIMIT 1",
  );
  assert(fixture, 'Run the governed sales fixture after the financial-source migration first.');
  const tenantId = fixture.tenant_id as VerifiedTenantId,
    actorId = fixture.actor_id as string;
  await admin.unsafe(
    "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
    [keyId, secret.toString('hex')],
  );
  const sign = (action: string, permission: Permission, key: string, scope = {}) =>
    signOperationsAttestation(
      {
        keyId,
        tenantId,
        actorId,
        sessionId: randomUUID(),
        action,
        permission,
        idempotencyKey: key,
        requestId: randomUUID(),
        ipAddress: '127.0.0.1',
        reason: 'Synthetic financial journal proof',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        ...scope,
      },
      secret,
    );
  const request = (action: string, permission: Permission, key = randomUUID(), scope = {}) => {
    const audit = {
      sessionId: randomUUID(),
      action,
      permission,
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      reason: 'Synthetic financial source proof',
    };
    return {
      actorId,
      idempotencyKey: key,
      postedAt: new Date('2001-01-02T12:00:00Z'),
      audit,
      authorization: sign(action, permission, key, {
        ...scope,
        sessionId: audit.sessionId,
        requestId: audit.requestId,
      }),
    };
  };
  const journal = async (table: string, id: string) => {
    const rows = await admin.unsafe(
      'SELECT j.id,j.classification_required,a.account_code,l.currency,l.debit_minor,l.credit_minor ' +
        'FROM operations_journal_entries j JOIN operations_journal_lines l ON l.journal_entry_id=j.id ' +
        'JOIN operations_chart_of_accounts a ON a.id=l.account_id WHERE j.tenant_id=$1 AND j.finance_source_table=$2 AND j.finance_source_id=$3',
      [tenantId, table, id],
    );
    assert(rows.length >= 2, 'source must have a real journal');
    return rows;
  };
  const governed = await admin.unsafe(
    'SELECT j.id,p.subtotal_minor,p.vat_minor,p.stamp_duty_minor,i.amount_minor ' +
      'FROM operations_journal_entries j JOIN finance_invoices i ON i.tenant_id=j.tenant_id AND i.id=j.finance_source_id ' +
      'JOIN operations_invoice_preparations p ON p.tenant_id=i.tenant_id AND p.finance_invoice_id=i.id ' +
      "WHERE j.tenant_id=$1 AND j.finance_source_table='finance_invoices'",
    [tenantId],
  );
  assert(governed.length > 0);
  for (const source of governed) {
    const [totals] = await admin.unsafe(
      'SELECT sum(debit_minor)::text AS debit,sum(credit_minor)::text AS credit FROM operations_journal_lines WHERE journal_entry_id=$1',
      [source.id],
    );
    assert.equal(Number(totals.debit), Number(source.amount_minor));
    assert.equal(totals.debit, totals.credit);
    const tax = await admin.unsafe(
      'SELECT a.account_code,l.credit_minor FROM operations_journal_lines l JOIN operations_chart_of_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1',
      [source.id],
    );
    assert.equal(
      Number(tax.find((l) => l.account_code === '2200')?.credit_minor ?? 0),
      Number(source.vat_minor),
    );
    assert.equal(
      Number(tax.find((l) => l.account_code === '2220')?.credit_minor ?? 0),
      Number(source.stamp_duty_minor),
    );
  }
  for (const currency of ['USD', 'LBP'] as const) {
    const amount = currency === 'USD' ? 150 : 150000;
    const invoiceInput = {
      ...request('tenant.invoice.post', 'tenant.invoice.post'),
      number: run + '-invoice-' + currency,
      amountMinor: amount,
      currency,
    };
    await assert.rejects(
      postInvoice(runtime.db, tenantId, { ...invoiceInput, authorization: undefined } as never),
      'unsigned legacy writes must not evade journals or close guards',
    );
    await assert.rejects(
      postInvoice(runtime.db, tenantId, {
        ...invoiceInput,
        authorization: sign(
          'tenant.invoice.post',
          'tenant.invoice.post',
          invoiceInput.idempotencyKey,
          {
            branchIds: [],
            sessionId: invoiceInput.audit.sessionId,
            requestId: invoiceInput.audit.requestId,
          },
        ),
      }),
    );
    const invoice = await postInvoice(runtime.db, tenantId, invoiceInput);
    assert.equal((await postInvoice(runtime.db, tenantId, invoiceInput)).id, invoice.id);
    const invJournal = await journal('finance_invoices', invoice.id);
    assert(invJournal.every((l) => l.currency === currency && l.classification_required));
    assert(
      invJournal.some((l) => l.account_code === (currency === 'USD' ? '2490' : '2491')),
      'unclassified invoices go to explicit clearing, never fabricated tax/revenue',
    );
    const paymentInput = {
      ...request('tenant.payment.post', 'tenant.payment.post'),
      number: run + '-payment-' + currency,
      amountMinor: amount,
      currency,
    };
    const payment = await postPayment(runtime.db, tenantId, paymentInput);
    assert.equal((await postPayment(runtime.db, tenantId, paymentInput)).id, payment.id);
    const receiptJournal = await journal('finance_payments', payment.id);
    assert(receiptJournal.every((l) => l.currency === currency && l.classification_required));
    const allocationInput = {
      ...request('tenant.payment.allocate', 'tenant.payment.post'),
      invoiceId: invoice.id,
      paymentId: payment.id,
      amountMinor: amount,
      currency,
    };
    const allocation = await allocatePayment(runtime.db, tenantId, allocationInput);
    assert.equal((await allocatePayment(runtime.db, tenantId, allocationInput)).id, allocation.id);
    const lines = await journal('finance_payment_allocations', allocation.id);
    assert(
      lines.some(
        (l) =>
          l.account_code === (currency === 'USD' ? '2400' : '2410') &&
          Number(l.debit_minor) === amount,
      ),
    );
    assert(
      lines.some(
        (l) =>
          l.account_code === (currency === 'USD' ? '1100' : '1110') &&
          Number(l.credit_minor) === amount,
      ),
    );
    const undoAllocation = await reverseAllocation(runtime.db, tenantId, {
      ...request('tenant.payment.allocation.reverse', 'tenant.payment.reverse'),
      originalId: allocation.id,
    });
    const undoPayment = await reversePayment(runtime.db, tenantId, {
      ...request('tenant.payment.reverse', 'tenant.payment.reverse'),
      originalId: payment.id,
      reversalNumber: run + '-undo-payment-' + currency,
    });
    const undoInvoice = await reverseInvoice(runtime.db, tenantId, {
      ...request('tenant.invoice.reverse', 'tenant.invoice.reverse'),
      originalId: invoice.id,
      reversalNumber: run + '-undo-invoice-' + currency,
    });
    for (const [table, original, reversal] of [
      ['finance_invoices', invoice.id, undoInvoice.id],
      ['finance_payments', payment.id, undoPayment.id],
      ['finance_payment_allocations', allocation.id, undoAllocation.id],
    ]) {
      const originalLines = await journal(table!, original!),
        reversalLines = await journal(table!, reversal!);
      for (const l of originalLines)
        assert(
          reversalLines.some(
            (r) =>
              r.account_code === l.account_code &&
              r.currency === l.currency &&
              Number(r.debit_minor) === Number(l.credit_minor) &&
              Number(r.credit_minor) === Number(l.debit_minor),
          ),
        );
    }
  }
  const baselineClassification = (
    await readTrialBalance(
      runtime.db,
      tenantId,
      sign('tenant.accounting.trial_balance.read', 'tenant.accounting.view', randomUUID()),
      '2001-01-03',
    )
  ).coverage?.hasUnclassifiedEntries;
  const classifiedSource = await postInvoice(runtime.db, tenantId, {
    ...request('tenant.invoice.post', 'tenant.invoice.post'),
    number: run + '-classify-source',
    amountMinor: 100,
    currency: 'USD',
  });
  await assert.rejects(
    closeAccountingPeriod(runtime.db, tenantId, {
      request: {
        periodName: run + '-unclassified',
        startDate: '2001-01-02',
        endDate: '2001-01-02',
        closeType: 'hard',
        notesEn: 'Must reject unclassified source',
        notesAr: 'يجب رفض المصدر غير المصنف',
      },
      authorization: sign(
        'tenant.accounting.period.close',
        'tenant.accounting.close',
        randomUUID(),
      ),
    }),
    'period close must reject unresolved clearing sources',
  );
  const originalJournal = (await journal('finance_invoices', classifiedSource.id))[0]!;
  const accounts = await readChartOfAccounts(
    runtime.db,
    tenantId,
    sign('tenant.accounting.coa.read', 'tenant.accounting.view', randomUUID()),
  );
  const classifyCommand = {
    entryNumber: run + '-classify',
    entryDate: '2001-01-03',
    sourceType: 'manual' as const,
    classifiesJournalId: originalJournal.id,
    descriptionEn: 'Classify synthetic invoice as revenue',
    descriptionAr: 'تصنيف فاتورة تجريبية كإيراد',
    lines: [
      {
        accountId: accounts.find((a) => a.accountCode === '2490')!.id,
        debitMinor: 100,
        creditMinor: 0,
        currency: 'USD' as const,
      },
      {
        accountId: accounts.find((a) => a.accountCode === '4000')!.id,
        debitMinor: 0,
        creditMinor: 100,
        currency: 'USD' as const,
      },
    ],
  };
  const classificationKey = randomUUID();
  const classify = (command = classifyCommand, key = classificationKey) =>
    postJournalEntry(runtime.db, tenantId, {
      command,
      authorization: sign('tenant.accounting.journal.post', 'tenant.accounting.post', key),
    });
  await assert.rejects(
    classify(
      {
        ...classifyCommand,
        lines: classifyCommand.lines.map((l) => ({
          ...l,
          debitMinor: l.debitMinor ? 99 : 0,
          creditMinor: l.creditMinor ? 99 : 0,
        })),
      },
      randomUUID(),
    ),
  );
  const correction = await classify();
  assert.equal((await classify()).id, correction.id);
  assert.equal(
    (
      await readTrialBalance(
        runtime.db,
        tenantId,
        sign('tenant.accounting.trial_balance.read', 'tenant.accounting.view', randomUUID()),
        '2001-01-02',
      )
    ).coverage?.hasUnclassifiedEntries,
    true,
  );
  assert.equal(
    (
      await readTrialBalance(
        runtime.db,
        tenantId,
        sign('tenant.accounting.trial_balance.read', 'tenant.accounting.view', randomUUID()),
        '2001-01-03',
      )
    ).coverage?.hasUnclassifiedEntries,
    baselineClassification,
  );
  assert.equal(
    (
      await readJournalEntries(
        runtime.db,
        tenantId,
        sign('tenant.accounting.journal.read', 'tenant.accounting.view', randomUUID()),
      )
    ).find((j) => j.id === originalJournal.id)?.classificationRequired,
    false,
  );
  await assert.rejects(
    reverseInvoice(runtime.db, tenantId, {
      ...request('tenant.invoice.reverse', 'tenant.invoice.reverse'),
      originalId: classifiedSource.id,
      reversalNumber: run + '-backdated-undo-classified',
    }),
    'reversal cannot predate classification',
  );
  const classifiedReversal = await reverseInvoice(runtime.db, tenantId, {
    ...request('tenant.invoice.reverse', 'tenant.invoice.reverse'),
    postedAt: new Date('2001-01-04T12:00:00Z'),
    originalId: classifiedSource.id,
    reversalNumber: run + '-undo-classified',
  });
  const reversedClassifiedLines = await journal('finance_invoices', classifiedReversal.id);
  assert(
    reversedClassifiedLines.some((l) => l.account_code === '4000' && Number(l.debit_minor) === 100),
  );
  assert(
    reversedClassifiedLines.some(
      (l) => l.account_code === '1100' && Number(l.credit_minor) === 100,
    ),
  );
  assert(!reversedClassifiedLines.some((l) => l.account_code === '2490'));
  const cutoff = await readTrialBalance(
    runtime.db,
    tenantId,
    sign('tenant.accounting.trial_balance.read', 'tenant.accounting.view', randomUUID()),
    '2001-01-02',
  );
  assert.equal(cutoff.totalDebitUsd, cutoff.totalCreditUsd);
  assert.equal(cutoff.totalDebitLbp, cutoff.totalCreditLbp);
  assert.equal(cutoff.coverage?.hasUnjournaledSources, false);
  const [unused] = await admin.unsafe(
    'SELECT y FROM generate_series(1800,1900) y WHERE NOT EXISTS(' +
      'SELECT 1 FROM operations_accounting_periods WHERE tenant_id=$1 AND start_date<=make_date(y,12,31) AND end_date>=make_date(y,1,1)) ORDER BY y LIMIT 1',
    [tenantId],
  );
  const closeRequest = {
    periodName: run,
    startDate: unused.y + '-01-01',
    endDate: unused.y + '-12-31',
    closeType: 'hard' as const,
    notesEn: 'Synthetic empty-year close',
    notesAr: 'إغلاق سنة فارغة للاختبار',
  };
  await closeAccountingPeriod(runtime.db, tenantId, {
    request: closeRequest,
    authorization: sign('tenant.accounting.period.close', 'tenant.accounting.close', randomUUID()),
  });
  for (const [action, permission, post] of [
    ['tenant.invoice.post', 'tenant.invoice.post', postInvoice],
    ['tenant.payment.post', 'tenant.payment.post', postPayment],
  ] as const) {
    await assert.rejects(
      post(runtime.db, tenantId, {
        ...request(action, permission),
        number: run + '-closed-' + action,
        postedAt: new Date(unused.y + '-02-01T12:00:00Z'),
        amountMinor: 10,
        currency: 'USD',
      }),
      'legacy finance API cannot post into closed periods',
    );
  }
  const [collectSource] = await admin.unsafe(
    'SELECT i.id,i.amount_minor-g.allocated_minor-g.credited_minor AS outstanding,i.currency,s.subscriber_id,s.route_id ' +
      "FROM finance_invoices i JOIN finance_document_guards g ON g.tenant_id=i.tenant_id AND g.document_id=i.id AND g.document_type='invoice' " +
      'JOIN operations_invoice_preparations p ON p.tenant_id=i.tenant_id AND p.finance_invoice_id=i.id ' +
      'JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id ' +
      'WHERE i.tenant_id=$1 AND g.reversed_at IS NULL AND i.amount_minor-g.allocated_minor-g.credited_minor>0 ' +
      'AND NOT EXISTS(SELECT 1 FROM operations_collector_assignments a WHERE a.tenant_id=i.tenant_id AND a.finance_invoice_id=i.id) LIMIT 1',
    [tenantId],
  );
  assert(
    collectSource,
    'Need an unassigned governed invoice for real Collect sync proof; use fresh sales fixture.',
  );
  const collectorId = randomUUID(),
    collectorSession = randomUUID();
  await admin.unsafe(
    "INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required) VALUES($1,'tenant',$2,'Journal test collector','disabled-test-hash',true)",
    [collectorId, collectorId + '@example.test'],
  );
  await admin.unsafe(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'collector',ARRAY['tenant.collection.view','tenant.payment.post','tenant.collection.reconcile'],'{}'::jsonb)",
    [tenantId, collectorId],
  );
  const assignment = await assignCollectorInvoice(runtime.db, tenantId, {
    authorization: sign('tenant.collection.assign', 'tenant.collection.reconcile', run + '-assign'),
    collectorUserId: collectorId,
    subscriberId: collectSource.subscriber_id,
    routeId: collectSource.route_id,
    financeInvoiceId: collectSource.id,
    dueOn: new Date().toISOString().slice(0, 10),
    idempotencyKey: run + '-assign',
  });
  const now = new Date(),
    scope = { actorId: collectorId, sessionId: collectorSession };
  const device = await authorizeCollectDevice(runtime.db, tenantId, {
    authorization: sign(
      'tenant.collect.device.authorize',
      'tenant.collection.view',
      run + '-device',
      scope,
    ),
    collectorUserId: collectorId,
    sourceSessionId: collectorSession,
    deviceLabel: 'Accounting acceptance',
    devicePublicKeyThumbprint: 'sha256:' + randomUUID(),
    mfaVerifiedAt: now,
    accessTokenDigest: randomBytes(32),
    refreshTokenDigest: randomBytes(32),
    accessExpiresAt: new Date(now.getTime() + 600000),
    refreshExpiresAt: new Date(now.getTime() + 86400000),
    scopes: [
      'assignments:read',
      'payments:create',
      'receipts:print:audit',
      'reconciliations:submit',
    ],
  });
  const bootstrap = await readCollectBootstrap(
    runtime.db,
    device,
    sign('tenant.collect.bootstrap', 'tenant.collection.view', run + '-bootstrap', scope),
  );
  assert.equal(
    bootstrap.assignments.find((a) => a.assignmentId === assignment.id)?.outstandingAmountMinor,
    Number(collectSource.outstanding),
  );
  const operationId = randomUUID();
  const envelope = {
    authorization: sign(
      'tenant.collection.evidence.record',
      'tenant.payment.post',
      run + '-collect',
      scope,
    ),
    device,
    operations: [
      {
        operationId,
        sequence: 1,
        type: 'payment.create' as const,
        payload: {
          assignmentId: assignment.id,
          amountMinor: Number(collectSource.outstanding),
          currency: collectSource.currency,
          clientRecordedAt: now.toISOString(),
        },
      },
    ],
    payloadHashes: { [operationId]: 'a'.repeat(64) },
    requestId: randomUUID(),
    ipAddress: '127.0.0.1',
    serverReceivedAt: now,
  };
  await assert.rejects(
    syncCollectOperations(runtime.db, {
      ...envelope,
      authorization: sign(
        'tenant.collection.evidence.record',
        'tenant.payment.post',
        run + '-wrong-session',
        { ...scope, sessionId: randomUUID() },
      ),
    }),
    'device cannot be used through a different signed source session',
  );
  const synced = await syncCollectOperations(runtime.db, envelope);
  assert.equal((await syncCollectOperations(runtime.db, envelope))[0]?.replayed, true);
  await assert.rejects(
    syncCollectOperations(runtime.db, {
      ...envelope,
      payloadHashes: { [operationId]: 'b'.repeat(64) },
    }),
    'changed-content replay must fail',
  );
  const afterPayment = await readCollectBootstrap(
    runtime.db,
    device,
    sign('tenant.collect.bootstrap', 'tenant.collection.view', run + '-after-payment', scope),
  );
  assert(
    !afterPayment.assignments.some((a) => a.assignmentId === assignment.id),
    'paid assignment is no longer collectible',
  );
  const receipt = await journal('finance_payments', synced[0]!.result.paymentId as string);
  assert(
    receipt.some(
      (l) =>
        l.account_code === (collectSource.currency === 'USD' ? '1010' : '1020') &&
        Number(l.debit_minor) === Number(collectSource.outstanding),
    ),
  );
  assert(receipt.every((l) => !l.classification_required));
  await journal('finance_payment_allocations', synced[0]!.result.allocationId as string);
  const [counts] = await admin.unsafe(
    'SELECT count(*)::int AS journals,(SELECT count(*) FROM operations_audit_outbox a ' +
      "WHERE a.tenant_id=$1 AND a.resource_type='operations_journal_entries' AND a.resource_id IN " +
      '(SELECT id::text FROM operations_journal_entries WHERE tenant_id=$1 AND finance_source_id IN ' +
      '(SELECT id FROM finance_invoices WHERE document_number LIKE $2 UNION ALL SELECT id FROM finance_payments WHERE receipt_number LIKE $2)))::int AS audits ' +
      'FROM operations_journal_entries WHERE tenant_id=$1 AND finance_source_id IN ' +
      '(SELECT id FROM finance_invoices WHERE document_number LIKE $2 UNION ALL SELECT id FROM finance_payments WHERE receipt_number LIKE $2)',
    [tenantId, run + '%'],
  );
  assert.equal(counts.journals, 10);
  assert.equal(counts.audits, 10);
  console.log(
    'Financial source journals passed: governed invoice net/tax/stamp, signed legacy API, USD/LBP receipt/allocation/reversal, exact retries, atomic audit, classification clearing, all-writer period denial, real Collect bootstrap/payment/allocation/replay and source-session binding.',
  );
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
