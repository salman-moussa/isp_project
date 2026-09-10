import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Permission } from '@isp/contracts';
import {
  allocatePlatformPayment,
  assignControlSubscription,
  createControlClient,
  createControlPackageVersion,
  createDatabase,
  postPlatformInvoice,
  postPlatformPayment,
  readControlAudit,
  readControlBilling,
  readControlClientDetail,
  readControlPackages,
  readControlPortfolio,
  readControlSubscriptions,
  signControlContext,
} from '../src/index.js';

/**
 * Live acceptance for the Control Center reads: the portfolio snapshot, a client file, package
 * versions, subscriptions, the platform billing ledger and the audit trail are computed from the
 * control plane's own records under the signed control context, and refused under the wrong
 * permission or action.
 */
const adminUrl = process.env.TENANT_STAFF_TEST_ADMIN_DATABASE_URL;
const apiUrl = process.env.TENANT_STAFF_TEST_API_DATABASE_URL;
if (!adminUrl || !apiUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Control portfolio acceptance requires the TENANT_STAFF_TEST database URLs.');
  }
  console.log('Control portfolio acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, apiUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Control portfolio acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const api = createDatabase(apiUrl);
const tenantId = randomUUID();
const actorId = randomUUID();
const keyId = `control-portfolio-${randomUUID()}`;
const secret = randomBytes(32);
const stamp = tenantId.slice(0, 8);

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function control(
  permission: Permission,
  action: string,
  idempotencyKey = randomUUID(),
  overrides: Record<string, unknown> = {},
) {
  const hash = requestHash({ permission, action, idempotencyKey });
  return {
    idempotencyKey,
    requestHash: hash,
    reason: 'Control portfolio acceptance run',
    authorization: signControlContext(
      {
        keyId,
        actorId,
        sessionId: randomUUID(),
        permission,
        action,
        requestId: randomUUID(),
        requestHash: hash,
        idempotencyKey,
        ipAddress: '127.0.0.1',
        reason: 'Control portfolio acceptance run',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      secret,
    ),
  };
}
const read = (permission: Permission, action: string) => control(permission, action).authorization;

try {
  await admin.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE orvex_owner');
    await tx`INSERT INTO tenants(id,code,brand_name,legal_name,status)
      VALUES(${tenantId},${`PORTFOLIO-${tenantId}`},'Portfolio proof','Portfolio proof','active')`;
    await tx`INSERT INTO users(id,account_kind,email,display_name,password_hash)
      VALUES(${actorId},'platform',${`${actorId}@portfolio.invalid`},'Portfolio operator','not-a-login')`;
    await tx`INSERT INTO control_center_context_keys(key_id,secret,active_from)
      VALUES(${keyId},${secret},clock_timestamp())`;
  });

  await createControlClient(api.db, {
    tenantId,
    legalName: 'Portfolio Proof ISP SAL',
    tradingName: `Portfolio Proof ${stamp}`,
    ...control('platform.client.manage', 'client.create', `portfolio-client-${stamp}`),
  });
  const pkg = (await createControlPackageVersion(api.db, {
    packageKey: `portfolio-${stamp}`,
    version: 1,
    nameEn: 'Portfolio package',
    nameAr: 'باقة المحفظة',
    entitlements: ['operations'],
    priceMinor: 25_000,
    currency: 'USD',
    effectiveFrom: new Date(Date.now() - 60_000),
    ...control('platform.subscription.manage', 'package.create', `portfolio-package-${stamp}`),
  })) as { id: string };
  await assignControlSubscription(api.db, {
    tenantId,
    packageVersionId: pkg.id,
    state: 'active',
    startsAt: new Date(),
    ...control('platform.subscription.manage', 'subscription.assign', `portfolio-sub-${stamp}`),
  });
  const invoice = await postPlatformInvoice(api.db, {
    tenantId,
    number: `PF-INV-${stamp}`,
    amountMinor: 25_000,
    currency: 'USD',
    dueAt: new Date(Date.now() + 14 * 86_400_000),
    ...control('platform.billing.post', 'invoice.post', `portfolio-invoice-${stamp}`),
  });
  const payment = await postPlatformPayment(api.db, {
    tenantId,
    number: `PF-RCPT-${stamp}`,
    amountMinor: 10_000,
    currency: 'USD',
    ...control('platform.payment.post', 'payment.post', `portfolio-payment-${stamp}`),
  });
  await allocatePlatformPayment(api.db, {
    tenantId,
    invoiceId: invoice.id,
    paymentId: payment.id,
    amountMinor: 10_000,
    currency: 'USD',
    ...control('platform.payment.post', 'allocation.post', `portfolio-alloc-${stamp}`),
  });

  // --- Portfolio snapshot ---
  await assert.rejects(
    readControlPortfolio(api.db, read('platform.billing.view', 'portfolio.read')),
  );
  await assert.rejects(readControlPortfolio(api.db, read('platform.client.view', 'client.list')));
  const portfolio = await readControlPortfolio(
    api.db,
    read('platform.client.view', 'portfolio.read'),
  );
  assert.ok(portfolio.clients.total >= 1);
  assert.ok(portfolio.clients.byState.some((s) => s.state === 'active' && s.count >= 1));
  const mrr = portfolio.subscriptions.mrr.find((m) => m.currency === 'USD');
  assert.ok(mrr && mrr.amountMinor >= 25_000, 'active subscriptions count towards USD MRR');
  const outstanding = portfolio.billing.outstanding.find((o) => o.currency === 'USD');
  assert.ok(
    outstanding && outstanding.amountMinor >= 15_000,
    'unallocated invoice balance is outstanding',
  );
  const received = portfolio.billing.receivedThisMonth.find((r) => r.currency === 'USD');
  assert.ok(received && received.amountMinor >= 10_000);
  assert.ok(
    portfolio.activity.some((a) => a.tenantId === tenantId && a.actor === 'Portfolio operator'),
  );

  // --- Client file ---
  const detail = (await readControlClientDetail(
    api.db,
    read('platform.client.view', 'client.detail'),
    tenantId,
  )) as {
    client: { tradingName: string; tenantCode: string };
    subscription: { packageKey: string; state: string; priceMinor: number };
    invoices: { id: string; allocatedMinor: number; amountMinor: number }[];
    payments: { id: string; allocatedMinor: number }[];
    outstanding: { currency: string; amountMinor: number }[];
    audit: { operation: string }[];
  };
  assert.equal(detail.client.tradingName, `Portfolio Proof ${stamp}`);
  assert.equal(detail.client.tenantCode, `PORTFOLIO-${tenantId}`);
  assert.equal(detail.subscription.packageKey, `portfolio-${stamp}`);
  assert.equal(detail.subscription.state, 'active');
  assert.equal(detail.invoices[0]?.allocatedMinor, 10_000);
  assert.equal(detail.payments[0]?.allocatedMinor, 10_000);
  assert.deepEqual(detail.outstanding, [{ currency: 'USD', amountMinor: 15_000, invoices: 1 }]);
  assert.ok(detail.audit.length >= 4, 'client file carries its audit trail');
  await assert.rejects(
    readControlClientDetail(api.db, read('platform.client.view', 'client.detail'), randomUUID()),
  );

  // --- Packages, subscriptions, billing, audit ---
  const packages = (await readControlPackages(
    api.db,
    read('platform.client.view', 'package.list'),
  )) as {
    packageKey: string;
    activeSubscriptions: number;
    current: boolean;
  }[];
  const listed = packages.find((p) => p.packageKey === `portfolio-${stamp}`);
  assert.ok(listed && listed.activeSubscriptions === 1 && listed.current);
  const subscriptions = (await readControlSubscriptions(
    api.db,
    read('platform.client.view', 'subscription.list'),
  )) as {
    tenantId: string;
    state: string;
    packageKey: string;
    pendingRequest: unknown;
  }[];
  const mine = subscriptions.find((s) => s.tenantId === tenantId);
  assert.ok(
    mine &&
      mine.state === 'active' &&
      mine.packageKey === `portfolio-${stamp}` &&
      mine.pendingRequest === null,
  );
  await assert.rejects(readControlBilling(api.db, read('platform.client.view', 'billing.list')));
  const billing = (await readControlBilling(
    api.db,
    read('platform.billing.view', 'billing.list'),
    50,
  )) as {
    invoices: { tenantId: string; invoiceNumber: string; allocatedMinor: number }[];
    payments: { tenantId: string; receiptNumber: string }[];
    outstandingByClient: { tenantId: string }[];
  };
  assert.ok(
    billing.invoices.some(
      (i) =>
        i.tenantId === tenantId &&
        i.invoiceNumber === `PF-INV-${stamp}` &&
        i.allocatedMinor === 10_000,
    ),
  );
  assert.ok(
    billing.payments.some((p) => p.tenantId === tenantId && p.receiptNumber === `PF-RCPT-${stamp}`),
  );
  assert.ok(billing.outstandingByClient.some((o) => o.tenantId === tenantId));
  await assert.rejects(readControlAudit(api.db, read('platform.client.view', 'audit.list')));
  const audit = (await readControlAudit(api.db, read('platform.audit.view', 'audit.list'), {
    limit: 50,
  })) as {
    tenantId: string | null;
    operation: string;
    actor: string;
  }[];
  assert.ok(
    audit.some(
      (a) =>
        a.tenantId === tenantId &&
        a.operation === 'client.create' &&
        a.actor === 'Portfolio operator',
    ),
  );
  process.stdout.write('Control portfolio acceptance passed.\n');
} finally {
  await Promise.all([admin.end({ timeout: 5 }), api.client.end({ timeout: 5 })]);
}
