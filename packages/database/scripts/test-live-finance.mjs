import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { migrate } from './migrate.mjs';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!migrationUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error(
      'Finance integration requires DATABASE_MIGRATION_URL and DATABASE_RUNTIME_URL when ORVEX_REQUIRE_LIVE_POSTGRES=1.',
    );
  }
  console.log(
    'Finance integration skipped: DATABASE_MIGRATION_URL and DATABASE_RUNTIME_URL required.',
  );
  process.exit(0);
}

await migrate(migrationUrl, { databaseScope: 'tenant' });
const admin = postgres(migrationUrl, { max: 1, prepare: false });
const runtimeOne = postgres(runtimeUrl, {
  max: 1,
  prepare: false,
  connection: { application_name: 'orvex_finance_race_one' },
});
const runtimeTwo = postgres(runtimeUrl, {
  max: 1,
  prepare: false,
  connection: { application_name: 'orvex_finance_race_two' },
});
const tenantA = randomUUID();
const tenantB = randomUUID();
const at = new Date('2026-08-11T10:00:00.000Z');

try {
  await admin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`
      INSERT INTO tenants (id, code, brand_name, legal_name)
      VALUES
        (${tenantA}, ${`finance-a-${tenantA}`}, 'Finance A', 'Finance A SAL'),
        (${tenantB}, ${`finance-b-${tenantB}`}, 'Finance B', 'Finance B SAL')
    `;
  });

  const invoice = await postInvoice(runtimeOne, tenantA, 'INV-100', 100n, 'USD', 'invoice-key-100');
  const payment = await postPayment(runtimeOne, tenantA, 'PAY-100', 100n, 'USD', 'payment-key-100');

  await assert.rejects(
    tenantTransaction(
      runtimeOne,
      tenantB,
      (transaction) => transaction`
      INSERT INTO finance_invoices
        (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${tenantA}, 'CROSS-TENANT', 1, 'USD', 'cross-tenant-key', 'actor-b', ${at})
    `,
    ),
  );
  const hidden = await tenantTransaction(
    runtimeOne,
    tenantB,
    (transaction) => transaction`
    SELECT id FROM finance_invoices WHERE id = ${invoice.id}
  `,
  );
  assert.equal(hidden.length, 0, 'RLS must hide another tenant finance row');

  await assert.rejects(
    tenantTransaction(
      runtimeOne,
      tenantA,
      (transaction) =>
        transaction`UPDATE finance_invoices SET amount_minor = 1 WHERE id = ${invoice.id}`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    tenantTransaction(
      runtimeOne,
      tenantA,
      (transaction) => transaction`DELETE FROM finance_invoices WHERE id = ${invoice.id}`,
    ),
    /permission denied/,
  );
  await assert.rejects(runtimeOne`TRUNCATE finance_invoices`);
  await assert.rejects(
    admin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      await transaction`UPDATE finance_invoices SET amount_minor = 1 WHERE id = ${invoice.id}`;
    }),
    /posted finance records are append-only/,
  );
  await assert.rejects(
    admin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      await transaction`DELETE FROM finance_invoices WHERE id = ${invoice.id}`;
    }),
    /posted finance records are append-only/,
  );

  const lbpPayment = await postPayment(
    runtimeOne,
    tenantA,
    'PAY-LBP',
    100n,
    'LBP',
    'payment-key-lbp',
  );
  await assert.rejects(
    allocate(runtimeOne, tenantA, invoice.id, lbpPayment.id, 10n, 'USD', 'currency-mismatch-key'),
    /currency must match/,
  );

  await assert.rejects(
    postInvoice(runtimeOne, tenantA, 'INV-CHANGED', 101n, 'USD', 'invoice-key-100'),
    /idempotency key belongs to a different invoice operation/,
  );
  await assert.rejects(
    tenantTransaction(
      runtimeOne,
      tenantA,
      (transaction) => transaction`
      INSERT INTO finance_invoices
        (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${tenantA}, 'INV-100', 100, 'USD', 'invoice-key-100', 'changed-actor', ${at})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    `,
    ),
    /idempotency key belongs to a different invoice operation/,
  );
  await assert.rejects(
    tenantTransaction(
      runtimeOne,
      tenantA,
      (transaction) => transaction`
      INSERT INTO finance_invoices
        (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${tenantA}, 'INV-100', 100, 'USD', 'invoice-key-100', 'actor-a',
        ${new Date('2026-08-11T10:00:01.000Z')})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    `,
    ),
    /idempotency key belongs to a different invoice operation/,
  );

  // Hold the first allocation transaction after its insert. The second connection must visibly
  // wait on the same document guard; after release, one 80 succeeds and the other is rejected.
  let releaseFirst;
  const releaseGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstInserted;
  const firstInsertedGate = new Promise((resolve) => {
    firstInserted = resolve;
  });
  const allocationOne = tenantTransaction(
    runtimeOne,
    tenantA,
    async (transaction) => {
      const rows = await insertAllocation(
        transaction,
        tenantA,
        invoice.id,
        payment.id,
        80n,
        'USD',
        'allocation-race-one',
      );
      firstInserted();
      await releaseGate;
      return rows;
    },
    'tenant.payment.allocate',
  );
  await firstInsertedGate;
  const allocationTwo = allocate(
    runtimeTwo,
    tenantA,
    invoice.id,
    payment.id,
    80n,
    'USD',
    'allocation-race-two',
  );
  let allocationTwoSettled = false;
  const watchedAllocationTwo = allocationTwo.finally(() => {
    allocationTwoSettled = true;
  });
  const raceSettled = Promise.allSettled([allocationOne, watchedAllocationTwo]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(allocationTwoSettled, false, 'second allocation must wait on the held guard');
  releaseFirst();
  const raceResults = await raceSettled;
  assert.equal(raceResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(raceResults.filter((result) => result.status === 'rejected').length, 1);

  const sequenceInvoice = await postInvoice(
    runtimeOne,
    tenantA,
    'INV-SEQ',
    100n,
    'USD',
    'invoice-sequence',
  );
  const sequencePayment = await postPayment(
    runtimeOne,
    tenantA,
    'PAY-SEQ',
    100n,
    'USD',
    'payment-sequence',
  );
  const sequenceAllocation = await allocate(
    runtimeOne,
    tenantA,
    sequenceInvoice.id,
    sequencePayment.id,
    20n,
    'USD',
    'allocation-sequence',
  );
  await assert.rejects(
    reverseInvoice(
      runtimeOne,
      tenantA,
      sequenceInvoice.id,
      'INV-SEQ-R',
      100n,
      'invoice-reverse-early',
    ),
    /allocations must be reversed/,
  );
  await reverseAllocation(
    runtimeOne,
    tenantA,
    sequenceAllocation.id,
    sequenceInvoice.id,
    sequencePayment.id,
    20n,
    'USD',
    'allocation-reverse-sequence',
  );
  await reverseInvoice(
    runtimeOne,
    tenantA,
    sequenceInvoice.id,
    'INV-SEQ-R',
    100n,
    'invoice-reverse-after-allocation',
  );

  // Reversal wins the guard lock; an allocation that started before commit must still observe the
  // committed reversal after waiting and fail closed.
  const raceInvoice = await postInvoice(
    runtimeOne,
    tenantA,
    'INV-REV-RACE',
    100n,
    'USD',
    'invoice-reversal-race',
  );
  const racePayment = await postPayment(
    runtimeOne,
    tenantA,
    'PAY-REV-RACE',
    100n,
    'USD',
    'payment-reversal-race',
  );
  let releaseReversal;
  const releaseReversalGate = new Promise((resolve) => {
    releaseReversal = resolve;
  });
  let reversalInserted;
  const reversalInsertedGate = new Promise((resolve) => {
    reversalInserted = resolve;
  });
  const reversal = tenantTransaction(
    runtimeOne,
    tenantA,
    async (transaction) => {
      const rows = await insertInvoiceReversal(
        transaction,
        tenantA,
        raceInvoice.id,
        'INV-REV-RACE-R',
        100n,
        'invoice-reversal-race-action',
      );
      reversalInserted();
      await releaseReversalGate;
      return rows;
    },
    'tenant.invoice.reverse',
  );
  await reversalInsertedGate;
  const lateAllocation = allocate(
    runtimeTwo,
    tenantA,
    raceInvoice.id,
    racePayment.id,
    10n,
    'USD',
    'allocation-after-reversal',
  );
  let lateAllocationSettled = false;
  const lateAllocationOutcome = lateAllocation.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  void lateAllocationOutcome.finally(() => {
    lateAllocationSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(lateAllocationSettled, false, 'allocation must wait on the held reversal guard');
  releaseReversal();
  await reversal;
  const lateResult = await lateAllocationOutcome;
  assert.equal(lateResult.status, 'rejected');
  assert.match(String(lateResult.reason), /active posted invoice/);

  console.log('Finance integration passed: RLS, immutability, currency, idempotency, and races.');
} finally {
  await Promise.all([
    admin.end({ timeout: 5 }),
    runtimeOne.end({ timeout: 5 }),
    runtimeTwo.end({ timeout: 5 }),
  ]);
}

async function tenantTransaction(client, tenantId, work, action = 'tenant.invoice.post') {
  return client.begin(async (transaction) => {
    await transaction`
      SELECT
        set_config('app.tenant_id', ${tenantId}, true),
        set_config('app.finance_actor_id', 'actor-a', true),
        set_config('app.finance_session_id', ${randomUUID()}, true),
        set_config('app.finance_request_id', ${randomUUID()}, true),
        set_config('app.finance_ip_address', '127.0.0.1', true),
        set_config('app.finance_user_agent', 'orvex-finance-live-test/1.0', true),
        set_config('app.finance_permission', ${action}, true),
        set_config('app.finance_reason', 'Deterministic live finance integration test', true),
        set_config('app.finance_action', ${action}, true)
    `;
    return work(transaction);
  });
}

async function postInvoice(client, tenantId, number, amount, currency, key) {
  return tenantTransaction(client, tenantId, async (transaction) => {
    const [row] = await transaction`
      INSERT INTO finance_invoices
        (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${tenantId}, ${number}, ${amount}, ${currency}, ${key}, 'actor-a', ${at})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *
    `;
    return row;
  });
}

async function postPayment(client, tenantId, number, amount, currency, key) {
  return tenantTransaction(
    client,
    tenantId,
    async (transaction) => {
      const [row] = await transaction`
      INSERT INTO finance_payments
        (tenant_id, receipt_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${tenantId}, ${number}, ${amount}, ${currency}, ${key}, 'actor-a', ${at})
      RETURNING *
    `;
      return row;
    },
    'tenant.payment.post',
  );
}

async function allocate(client, tenantId, invoiceId, paymentId, amount, currency, key) {
  return tenantTransaction(
    client,
    tenantId,
    async (transaction) => {
      const [row] = await insertAllocation(
        transaction,
        tenantId,
        invoiceId,
        paymentId,
        amount,
        currency,
        key,
      );
      return row;
    },
    'tenant.payment.allocate',
  );
}

async function insertAllocation(
  transaction,
  tenantId,
  invoiceId,
  paymentId,
  amount,
  currency,
  key,
) {
  return transaction`
    INSERT INTO finance_payment_allocations
      (tenant_id, invoice_id, payment_id, amount_minor, currency, idempotency_key, actor_id, posted_at)
    VALUES (${tenantId}, ${invoiceId}, ${paymentId}, ${amount}, ${currency}, ${key}, 'actor-a', ${at})
    RETURNING *
  `;
}

async function reverseInvoice(client, tenantId, invoiceId, number, amount, key) {
  return tenantTransaction(
    client,
    tenantId,
    (transaction) => insertInvoiceReversal(transaction, tenantId, invoiceId, number, amount, key),
    'tenant.invoice.reverse',
  );
}

async function insertInvoiceReversal(transaction, tenantId, invoiceId, number, amount, key) {
  return transaction`
    INSERT INTO finance_invoices
      (tenant_id, document_number, entry_kind, reverses_invoice_id, amount_minor, currency,
       idempotency_key, actor_id, posted_at)
    VALUES (${tenantId}, ${number}, 'reversal', ${invoiceId}, ${amount}, 'USD', ${key}, 'actor-a', ${at})
    RETURNING *
  `;
}

async function reverseAllocation(
  client,
  tenantId,
  allocationId,
  invoiceId,
  paymentId,
  amount,
  currency,
  key,
) {
  return tenantTransaction(
    client,
    tenantId,
    (transaction) => transaction`
    INSERT INTO finance_payment_allocations
      (tenant_id, invoice_id, payment_id, entry_kind, reverses_allocation_id, amount_minor,
       currency, idempotency_key, actor_id, posted_at)
    VALUES (${tenantId}, ${invoiceId}, ${paymentId}, 'reversal', ${allocationId}, ${amount},
      ${currency}, ${key}, 'actor-a', ${at})
    RETURNING *
  `,
    'tenant.payment.allocation.reverse',
  );
}
