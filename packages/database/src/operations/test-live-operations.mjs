import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const adminUrl = process.env.OPERATIONS_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.OPERATIONS_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error(
      'Operations integration requires OPERATIONS_TEST_ADMIN_DATABASE_URL and OPERATIONS_TEST_RUNTIME_DATABASE_URL.',
    );
  }
  console.log('Operations integration skipped: live tenant database URLs are not configured.');
  process.exit(0);
}

const admin = postgres(adminUrl, { max: 4 });
const runtime = postgres(runtimeUrl, { max: 4 });
const tenantId = randomUUID();
const actorId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();
const keyId = `operations-live-${randomUUID()}`;
const key = randomBytes(32);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function authorization(idempotencyKey, overrides = {}) {
  const text = stableJson({
    keyId,
    tenantId,
    actorId,
    sessionId: randomUUID(),
    permission: 'tenant.invoice.create',
    action: 'tenant.billing.prepare',
    requestId: randomUUID(),
    ipAddress: '127.0.0.1',
    reason: 'Operations live migration and concurrency verification',
    idempotencyKey,
    branchIds: [branchId],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  });
  return { text, signature: createHmac('sha256', key).update(text).digest('hex') };
}

async function withContext(connection, context, work) {
  return connection.begin(async (transaction) => {
    await transaction`SELECT begin_operations_request_context(${context.text}, ${context.signature})`;
    return work(transaction);
  });
}

try {
  await admin`INSERT INTO tenants(id, code, brand_name, legal_name, status)
    VALUES (${tenantId}, ${`OPS-${tenantId}`}, 'Operations live test', 'Operations live test', 'active')`;
  await admin`INSERT INTO users(id, account_kind, email, display_name, password_hash)
    VALUES (${actorId}, 'tenant', ${`${actorId}@operations.invalid`}, 'Operations test', 'not-a-login')`;
  await admin`INSERT INTO tenant_memberships(tenant_id, user_id, role_key, permissions, scope)
    VALUES (${tenantId}, ${actorId}, 'isp_administrator',
      ARRAY['tenant.invoice.create', 'tenant.user.administer'],
      ${JSON.stringify({ branchIds: [branchId] })}::jsonb)`;
  await admin`INSERT INTO operations_context_keys(key_id, secret, active_from)
    VALUES (${keyId}, decode(${key.toString('hex')}, 'hex'), clock_timestamp())`;

  const seed = authorization('operations-live-seed-0001', {
    permission: 'tenant.user.administer',
    action: 'tenant.operations.configure',
  });
  await withContext(runtime, seed, async (transaction) => {
    await transaction`INSERT INTO operations_branches(id, tenant_id, code, name_en, name_ar)
      VALUES (${branchId}, ${tenantId}, 'LIVE-A', 'Live A', 'اختبار أ')`;
  });

  const spoof = authorization('operations-live-spoof-001');
  await assert.rejects(
    withContext(runtime, spoof, async (transaction) => {
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await transaction`INSERT INTO operations_branches(id, tenant_id, code, name_en, name_ar)
        VALUES (${otherBranchId}, ${tenantId}, 'LIVE-B', 'Live B', 'اختبار ب')`;
    }),
    /row-level security|policy/i,
  );

  const invalid = authorization('operations-live-signature-001');
  invalid.signature = '00'.repeat(32);
  await assert.rejects(
    runtime.begin(
      (transaction) =>
        transaction`SELECT begin_operations_request_context(${invalid.text}, ${invalid.signature})`,
    ),
    /invalid operations context attestation/i,
  );

  const periodStart = '2037-01-01';
  const periodEnd = '2037-02-01';
  const run = (keyValue) =>
    withContext(
      runtime,
      authorization(keyValue),
      (transaction) =>
        transaction`INSERT INTO operations_billing_runs(
      tenant_id, idempotency_key, period_start, period_end, status, requested_by, scope_branch_ids
    ) VALUES (${tenantId}, ${keyValue}, ${periodStart}, ${periodEnd}, 'running', ${actorId},
      ARRAY[${branchId}]::uuid[]) RETURNING id`,
    );
  const outcomes = await Promise.allSettled([
    run('operations-live-billing-a'),
    run('operations-live-billing-b'),
  ]);
  assert.equal(
    outcomes.filter(({ status }) => status === 'fulfilled').length,
    1,
    'exactly one overlapping billing run must commit',
  );
  assert.equal(
    outcomes.filter(({ status }) => status === 'rejected').length,
    1,
    'the competing overlapping run must fail',
  );

  const [audit] = await admin`SELECT actor_id, session_id, permission, request_id, idempotency_key,
    result, reason, before_value, after_value
    FROM operations_audit_outbox
    WHERE tenant_id = ${tenantId} AND resource_type = 'operations_billing_runs'
    ORDER BY occurred_at DESC LIMIT 1`;
  assert(audit, 'the committed billing mutation must atomically create audit evidence');
  assert.equal(audit.result, 'allowed');
  assert.equal(audit.actor_id, actorId);
  assert(
    audit.session_id && audit.permission && audit.request_id && audit.reason && audit.after_value,
    'the audit envelope must be complete',
  );

  const sourceEventId = randomUUID();
  await admin`SELECT record_operations_platform_subscription_state(
    ${sourceEventId}::uuid, ${tenantId}::uuid, 'active', 1, clock_timestamp()
  )`;
  const [snapshot] = await admin`SELECT status FROM operations_platform_subscription_events
    WHERE tenant_id = ${tenantId} ORDER BY recorded_at DESC, id DESC LIMIT 1`;
  assert.equal(
    snapshot?.status,
    'active',
    'relayed platform subscription state must be captured immutably',
  );

  console.log('Operations live migration/concurrency checks passed');
} finally {
  await Promise.allSettled([admin.end(), runtime.end()]);
}
