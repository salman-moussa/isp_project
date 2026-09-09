import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import {
  adjustDealerBalance,
  confirmVoucherCredit,
  createDatabase,
  executeDealerChannelCommand,
  generateVoucherBatch,
  inOperationsTransaction,
  postCustomerAccountEntry,
  readDealerWorkspace,
  readPendingVoucherRedemption,
  redeemVoucherForSubscriber,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for the dealer channel on PostgreSQL 18: dealer registry with scope, a
 * per-currency float ledger (deposit, issue net of commission, cancel, approved adjustment),
 * PIN batches generated in the database with one-time PIN exposure, guarded redemption with
 * attempt lockout, the subscriber credit saga and immutability.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Dealer acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Dealer acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Dealer acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `dealer-test-${randomUUID()}`;
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
const reasons = {
  reasonEn: 'Dealer channel acceptance run',
  reasonAr: 'تشغيل قبول قناة الوكلاء',
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
      reason: 'Synthetic dealer acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const channel = (
  command: Parameters<typeof executeDealerChannelCommand>[2]['command'],
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeDealerChannelCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.dealer.channel.manage',
      options.permission ?? 'tenant.payment.post',
      options.key,
      options.overrides,
    ),
  });
const read = (overrides: Record<string, unknown> = {}) =>
  readDealerWorkspace(runtime.db, tenantId, {
    authorization: sign(
      'tenant.dealer.workspace.read',
      'tenant.payment.view',
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Dealer proof','Dealer proof','active')",
      [tenantId, `DLR-${tenantId}`],
    );
    await transaction.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Channel cashier','not-a-login')",
      [actorId, `${actorId}@dealer.invalid`],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'cashier',ARRAY['tenant.payment.view','tenant.payment.post','tenant.collection.reconcile'],'{}'::jsonb)",
      [tenantId, actorId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'DLR-B','Dealer branch','فرع الوكلاء'),($3,$2,'DLR-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'DLR-A','Dealer area','منطقة الوكلاء')",
      [areaId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'DLR-R','Dealer route','مسار الوكلاء')",
      [routeId, tenantId, branchId, areaId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'DLR-H','Dealer household',$3)",
      [householdId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','3 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'DLR-SUB','dealer-subscriber-1','fixture',$3,$4,'Voucher customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Dealer registry ---------------------------------------------------------------------
  const registerKey = randomUUID();
  const register = {
    action: 'register_dealer' as const,
    dealerCode: 'ham-01',
    dealerName: 'Hamra Mobile Shop',
    contactPhone: '+961 1 000000',
    branchId,
    creditLimitMinorUsd: 20000,
    commissionRateBps: 400,
    ...reasons,
  };
  const dealer = await channel(register, { key: registerKey });
  assert.equal(dealer.dealerCode, 'HAM-01');
  assert.equal((await channel(register, { key: registerKey })).replayed, true);
  await assert.rejects(
    channel({ ...register, dealerName: 'Changed' }, { key: registerKey }),
    /different content/u,
  );
  await assert.rejects(channel(register), /already registered/u);
  await assert.rejects(channel(register, { permission: 'tenant.payment.view' }));
  await assert.rejects(channel(register, { overrides: { supportGrantId: randomUUID() } }));
  await assert.rejects(
    channel(
      { ...register, dealerCode: 'OTHER-01', branchId: otherBranchId },
      { overrides: { branchIds: [branchId] } },
    ),
    /outside current scope/u,
  );
  const dealerId = dealer.dealerId as string;
  await assert.rejects(
    channel({
      action: 'update_dealer',
      dealerId,
      expectedVersion: 9,
      commissionRateBps: 500,
      ...reasons,
    }),
    /changed/u,
  );
  const updated = await channel({
    action: 'update_dealer',
    dealerId,
    expectedVersion: 1,
    commissionRateBps: 500,
    ...reasons,
  });
  assert.equal(updated.version, 2);

  // --- Float ledger ------------------------------------------------------------------------
  await assert.rejects(
    channel({
      action: 'record_deposit',
      dealerId,
      currency: 'USD',
      amountMinor: 0,
      reference: 'RCPT-1',
      ...reasons,
    }),
  );
  const deposit = await channel({
    action: 'record_deposit',
    dealerId,
    currency: 'USD',
    amountMinor: 50000,
    reference: 'RCPT-2026-0001',
    ...reasons,
  });
  assert.equal(deposit.balanceAfterMinor, 50000);
  await assert.rejects(
    channel({
      action: 'record_deposit',
      dealerId,
      currency: 'USD',
      amountMinor: 100,
      reference: 'RCPT-2026-0001',
      ...reasons,
    }),
    /already recorded/u,
  );
  // Adjustments need the reconciliation permission even through the channel function.
  await assert.rejects(
    channel({
      action: 'record_deposit',
      dealerId,
      currency: 'LBP',
      amountMinor: 1,
      reference: 'X',
      ...reasons,
    }),
  );
  await assert.rejects(
    adjustDealerBalance(runtime.db, tenantId, {
      command: {
        action: 'adjust_balance',
        dealerId,
        currency: 'USD',
        amountMinor: -1000,
        ...reasons,
      },
      authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post'),
    }),
    /reconciliation authority/u,
  );
  const adjusted = await adjustDealerBalance(runtime.db, tenantId, {
    command: {
      action: 'adjust_balance',
      dealerId,
      currency: 'USD',
      amountMinor: -1000,
      reference: 'Count variance',
      ...reasons,
    },
    authorization: sign('tenant.dealer.channel.manage', 'tenant.collection.reconcile'),
  });
  assert.equal(adjusted.balanceAfterMinor, 49000);

  // --- Batches: generated in the database, PINs shown once -------------------------------
  const generateKey = randomUUID();
  const generated = await generateVoucherBatch(runtime.db, tenantId, {
    command: {
      action: 'generate_batch',
      batchNumber: 'B-2026-001',
      faceValueMinor: 1000,
      currency: 'USD',
      quantity: 60,
      ...reasons,
    },
    authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post', generateKey),
  });
  assert.equal(generated.pins.length, 60);
  assert.match(generated.pins[0]?.pin ?? '', /^[0-9]{12}$/u);
  assert.equal(new Set(generated.pins.map((p) => p.pin)).size, 60, 'PINs are unique');
  assert.equal(generated.pins[0]?.serialNumber, 'B-2026-001-00001');
  const replay = await generateVoucherBatch(runtime.db, tenantId, {
    command: {
      action: 'generate_batch',
      batchNumber: 'B-2026-001',
      faceValueMinor: 1000,
      currency: 'USD',
      quantity: 60,
      ...reasons,
    },
    authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post', generateKey),
  });
  assert.equal(replay.pins.length, 0, 'a replay never repeats PINs');
  assert.equal(replay.batchId, generated.batchId);
  await assert.rejects(
    channel({
      action: 'generate_batch',
      batchNumber: 'B-2026-001',
      faceValueMinor: 1000,
      currency: 'USD',
      quantity: 1,
      ...reasons,
    }),
    /already exists/u,
  );
  const [pinRow] = await admin.unsafe(
    'SELECT pin_hash FROM operations_vouchers WHERE tenant_id=$1 AND serial_number=$2',
    [tenantId, 'B-2026-001-00001'],
  );
  assert.notEqual(pinRow?.pin_hash, generated.pins[0]?.pin, 'PINs are stored hashed');
  await assert.rejects(
    runtime.client.unsafe('SELECT pin_hash FROM operations_vouchers LIMIT 1'),
    /permission denied/u,
  );
  const [eventRow] = await admin.unsafe(
    "SELECT result ? 'pins' AS has_pins FROM operations_dealer_events WHERE tenant_id=$1 AND action='generate_batch'",
    [tenantId],
  );
  assert.equal(eventRow?.has_pins, false, 'the ledger never stores PINs');
  const batchId = generated.batchId;

  // Issue: 60 × 1000 = 60,000 face, commission 5% = 3,000, net 57,000 against 49,000 + 20,000 limit.
  await assert.rejects(
    channel(
      { action: 'issue_batch', batchId, expectedVersion: 1, dealerId, ...reasons },
      { overrides: { branchIds: [otherBranchId] } },
    ),
    /not found in scope|outside/u,
  );
  const issued = await channel({
    action: 'issue_batch',
    batchId,
    expectedVersion: 1,
    dealerId,
    ...reasons,
  });
  assert.equal(issued.faceTotalMinor, 60000);
  assert.equal(issued.commissionMinor, 3000);
  assert.equal(issued.netChargedMinor, 57000);
  assert.equal(issued.balanceAfterMinor, 49000 - 57000);
  await assert.rejects(
    channel({ action: 'issue_batch', batchId, expectedVersion: 2, dealerId, ...reasons }),
    /only a generated/u,
  );
  // A second batch would exceed float plus credit limit.
  const second = await channel({
    action: 'generate_batch',
    batchNumber: 'B-2026-002',
    faceValueMinor: 1000,
    currency: 'USD',
    quantity: 20,
    ...reasons,
  });
  await assert.rejects(
    channel({
      action: 'issue_batch',
      batchId: second.batchId as string,
      expectedVersion: 1,
      dealerId,
      ...reasons,
    }),
    /credit limit/u,
  );
  // Suspended dealers cannot receive vouchers.
  await channel({
    action: 'update_dealer',
    dealerId,
    expectedVersion: 2,
    status: 'suspended',
    ...reasons,
  });
  await assert.rejects(
    channel({
      action: 'issue_batch',
      batchId: second.batchId as string,
      expectedVersion: 1,
      dealerId,
      ...reasons,
    }),
    /suspended/u,
  );
  await channel({
    action: 'update_dealer',
    dealerId,
    expectedVersion: 3,
    status: 'active',
    ...reasons,
  });

  // --- Redemption with PIN guard and the subscriber credit saga ---------------------------
  const first = generated.pins[0];
  assert(first);
  const redeem = (
    pin: string,
    serial = first.serialNumber,
    overrides: Record<string, unknown> = {},
  ) =>
    redeemVoucherForSubscriber(runtime.db, tenantId, {
      command: { serialNumber: serial, pin, subscriberId, ...reasons },
      authorization: sign(
        'tenant.dealer.channel.manage',
        'tenant.payment.post',
        randomUUID(),
        overrides,
      ),
    });
  await assert.rejects(redeem('000000000000'), /Wrong PIN. 4 attempt/u);
  await assert.rejects(redeem('000000000001'), /Wrong PIN. 3 attempt/u);
  const redeemed = await redeem(first.pin);
  assert.equal(redeemed.status, 'redeemed');
  assert.equal(redeemed.creditStatus, 'credit_pending');
  assert.equal(redeemed.amountMinor, 1000);
  await assert.rejects(redeem(first.pin), /already redeemed/u);
  // Lock the second voucher with five wrong PINs, then the right PIN is refused too.
  const secondVoucher = generated.pins[1];
  assert(secondVoucher);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(redeem('111111111111', secondVoucher.serialNumber));
  }
  await assert.rejects(redeem(secondVoucher.pin, secondVoucher.serialNumber), /locked/u);
  // Scope: a cashier limited to the other branch cannot redeem for this subscriber.
  await assert.rejects(
    redeem(generated.pins[2]?.pin ?? '', generated.pins[2]?.serialNumber, {
      branchIds: [otherBranchId],
    }),
    /outside scope/u,
  );

  // Credit saga: post the subscriber deposit, then confirm; both idempotent by redemption id.
  const pending = await readPendingVoucherRedemption(runtime.db, tenantId, {
    authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post'),
    redemptionId: redeemed.redemptionId,
  });
  assert.equal(pending.status, 'credit_pending');
  const creditKey = `voucher-credit:${redeemed.redemptionId}`;
  const postDeposit = () =>
    postCustomerAccountEntry(runtime.db, tenantId, {
      command: {
        kind: 'deposit_received',
        subscriberId,
        currency: 'USD',
        amountMinor: 1000,
        documentNumber: `VCH-${first.serialNumber}`,
        sourceReference: `VOUCHER:${first.serialNumber}`,
        reasonEn: reasons.reasonEn,
        reasonAr: reasons.reasonAr,
      },
      authorization: sign(
        'tenant.customer_account.deposit_received',
        'tenant.payment.post',
        creditKey,
      ),
    });
  const entry = await postDeposit();
  assert.equal((await postDeposit()).id, entry.id, 'the deposit replays exactly');
  await assert.rejects(
    confirmVoucherCredit(runtime.db, tenantId, {
      command: { redemptionId: redeemed.redemptionId, accountEntryId: randomUUID(), ...reasons },
      authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post'),
    }),
    /does not match/u,
  );
  const confirmKey = `voucher-confirm:${redeemed.redemptionId}`;
  const confirmed = await confirmVoucherCredit(runtime.db, tenantId, {
    command: { redemptionId: redeemed.redemptionId, accountEntryId: entry.id, ...reasons },
    authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post', confirmKey),
  });
  assert.equal(confirmed.creditStatus, 'credited');
  assert.equal(
    (
      await confirmVoucherCredit(runtime.db, tenantId, {
        command: { redemptionId: redeemed.redemptionId, accountEntryId: entry.id, ...reasons },
        authorization: sign('tenant.dealer.channel.manage', 'tenant.payment.post', confirmKey),
      })
    ).replayed,
    true,
  );

  // --- Cancel the remainder: float credited back net of commission -----------------------
  const cancelled = await channel({
    action: 'cancel_batch',
    batchId,
    expectedVersion: 2,
    ...reasons,
  });
  assert.equal(cancelled.cancelledVouchers, 59, 'the redeemed voucher stays redeemed');
  assert.equal(cancelled.refundedMinor, 59000 - 2950);
  await assert.rejects(
    channel({ action: 'cancel_batch', batchId, expectedVersion: 3, ...reasons }),
    /already cancelled/u,
  );
  await assert.rejects(
    redeem(generated.pins[3]?.pin ?? '', generated.pins[3]?.serialNumber),
    /cancelled/u,
  );

  // --- Workspace read and scope --------------------------------------------------------------
  const workspace = await read();
  const row = workspace.dealers.find((d) => d.id === dealerId);
  assert(row);
  assert.equal(row.balances[0]?.currency, 'USD');
  assert.equal(row.balances[0]?.balanceMinor, 49000 - 57000 + 59000 - 2950);
  assert.equal(row.balances[1]?.currency, 'LBP');
  assert.equal(row.balances[1]?.balanceMinor, 0);
  assert.equal(row.redeemedVouchers, 1);
  assert.equal(workspace.batches.find((b) => b.id === batchId)?.redeemedCount, 1);
  assert.equal(workspace.batches.find((b) => b.id === batchId)?.cancelledCount, 59);
  assert.equal(workspace.redemptions[0]?.status, 'credited');
  assert.equal(workspace.summary.pendingCredits, 0);
  assert.equal(workspace.summary.activeDealers, 1);
  assert(workspace.ledger.some((l) => l.entryKind === 'commission' && l.amountMinor === 3000));
  assert.equal(
    workspace.ledger.filter((l) => l.currency === 'LBP').length,
    0,
    'currencies never mix',
  );
  const elsewhere = await read({ branchIds: [otherBranchId] });
  assert.equal(elsewhere.dealers.length, 0);
  assert.equal(elsewhere.batches.filter((b) => b.dealerId === dealerId).length, 0);
  await assert.rejects(read({ supportGrantId: randomUUID() }));
  await assert.rejects(read({ permission: 'tenant.network.view' }));

  // --- Immutability ----------------------------------------------------------------------------
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.dealer.channel.manage', 'tenant.payment.post'),
      (tx) =>
        tx.execute(
          sql`UPDATE operations_dealer_ledger SET amount_minor=0 WHERE tenant_id=${tenantId}`,
        ),
    ),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_vouchers WHERE tenant_id=$1', [tenantId]),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_dealer_events WHERE tenant_id=$1', [tenantId]),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action='tenant.dealer.channel.manage'",
    [tenantId],
  );
  assert(audit && audit.count >= 16, `audit rows ${String(audit?.count)}`);
  console.log('Dealer channel acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
