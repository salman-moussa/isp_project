import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { CapacityCommand, Permission, VerifiedTenantId } from '@isp/contracts';
import {
  createDatabase,
  executeCapacityCommand,
  readCapacityWorkspace,
  signOperationsAttestation,
} from '../src/index.js';

/**
 * Live acceptance for capacity and upstream management on PostgreSQL 18: an upstream circuit
 * register with committed and burst capacity, cost per currency and renewal notice; append-only
 * utilisation samples; derived utilisation, headroom, saturation risk and a linear forecast;
 * optimistic versions, exact idempotent replay, authority and branch scope.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Capacity acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Capacity acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Capacity acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `capacity-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const engineerId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();

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
      actorId: engineerId,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      permission,
      action,
      idempotencyKey,
      reason: 'Synthetic capacity acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const capacity = (
  command: CapacityCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeCapacityCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.capacity.manage',
      options.permission ?? 'tenant.network.job.create',
      options.key,
      options.overrides,
    ),
  });
const read = (query: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
  readCapacityWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.capacity.workspace.read',
      'tenant.network.view',
      randomUUID(),
      overrides,
    ),
  });
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

try {
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Capacity proof','Capacity proof','active')",
      [tenantId, `CAP-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Network engineer','not-a-login')",
      [engineerId, `${engineerId}@capacity.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'network_engineer',ARRAY['tenant.network.job.create','tenant.network.view'],'{}'::jsonb)",
      [tenantId, engineerId],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'CAP-B','Capacity branch','فرع السعة'),($3,$2,'CAP-O','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // Authority: the read permission alone cannot register circuits.
  await assert.rejects(
    capacity(
      {
        action: 'upsert_circuit',
        code: 'DENIED-1',
        provider: 'Upstream',
        kind: 'transit',
        pop: 'Beirut',
        committedMbps: 100,
        currency: 'USD',
      },
      { permission: 'tenant.network.view' },
    ),
  );

  // Register a transit circuit, replay the same key exactly, refuse the key with other content.
  const transitKey = randomUUID();
  const transitCommand: CapacityCommand = {
    action: 'upsert_circuit',
    code: 'transit-bey-1',
    provider: 'Upstream provider',
    kind: 'transit',
    pop: 'Beirut',
    branchId,
    committedMbps: 1000,
    burstMbps: 1200,
    monthlyCostMinor: 450_000,
    currency: 'USD',
    contractStart: day(-300),
    contractEnd: day(30),
    renewalNoticeDays: 60,
    slaAvailabilityPct: 99.9,
  };
  const transit = await capacity(transitCommand, { key: transitKey });
  assert.equal(transit.code, 'TRANSIT-BEY-1');
  assert.equal(transit.version, 1);
  assert.equal(transit.replayed, false);
  const replay = await capacity(transitCommand, { key: transitKey });
  assert.equal(replay.circuitId, transit.circuitId);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    capacity({ ...transitCommand, committedMbps: 2000 }, { key: transitKey }),
    /different content/u,
  );
  // Unique code per tenant.
  await assert.rejects(capacity({ ...transitCommand, code: 'TRANSIT-BEY-1' }));

  // A second circuit in LBP; the two currencies never combine in the cost summary.
  const ogero = await capacity({
    action: 'upsert_circuit',
    code: 'OGERO-TRP-2',
    provider: 'Ogero',
    kind: 'ogero_fiber',
    pop: 'Tripoli',
    committedMbps: 500,
    monthlyCostMinor: 90_000_000,
    currency: 'LBP',
  });
  // A planned circuit without samples carries no risk.
  await capacity({
    action: 'upsert_circuit',
    code: 'PEER-BEY-3',
    provider: 'Exchange',
    kind: 'peering',
    pop: 'Beirut',
    committedMbps: 2000,
    monthlyCostMinor: 0,
    currency: 'USD',
    status: 'planned',
  });

  // Samples: rising peaks over ten days on the transit circuit; duplicates are ignored.
  const transitId = transit.circuitId as string;
  const samples = Array.from({ length: 10 }, (_, i) => ({
    sampledAt: at(9 - i),
    peakInMbps: 700 + i * 25,
    peakOutMbps: 200 + i * 5,
    avgInMbps: 500 + i * 20,
  }));
  const recorded = await capacity({ action: 'record_samples', circuitId: transitId, samples });
  assert.equal(recorded.recorded, 10);
  const again = await capacity({
    action: 'record_samples',
    circuitId: transitId,
    samples: samples.slice(0, 3),
  });
  assert.equal(again.recorded, 0, 'duplicate sample timestamps are ignored');
  await assert.rejects(
    capacity({ action: 'record_samples', circuitId: randomUUID(), samples: samples.slice(0, 1) }),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_capacity_samples WHERE tenant_id=$1', [tenantId]),
    'samples are append-only',
  );

  // Workspace: utilisation, headroom, risk, forecast, renewals, cost per currency.
  const ws = await read({ days: 30 });
  assert.equal(ws.windowDays, 30);
  assert.equal(ws.circuits.length, 3);
  const t = ws.circuits.find((c) => c.id === transitId);
  assert.ok(t);
  assert.equal(t.peakMbps, 925);
  assert.equal(t.utilisationPct, 92.5);
  assert.equal(t.headroomMbps, 75);
  assert.equal(t.risk, 'critical');
  assert.equal(t.samples, 10);
  assert.equal(t.trend.length, 10);
  assert.ok(t.growthMbpsPerMonth !== null && t.growthMbpsPerMonth > 700, 'growth ≈ 25 Mbps/day');
  assert.ok(
    t.monthsToSaturation !== null && t.monthsToSaturation > 0 && t.monthsToSaturation < 1,
    'saturates within a month at this growth',
  );
  assert.equal(t.renewalDue, true);
  assert.equal(t.branchName, 'Capacity branch');
  assert.equal(ws.circuits[0]?.id, transitId, 'critical circuits sort first');
  const o = ws.circuits.find((c) => c.id === ogero.circuitId);
  assert.equal(o?.risk, 'unknown');
  assert.equal(o?.utilisationPct, null);
  assert.equal(ws.circuits.find((c) => c.code === 'PEER-BEY-3')?.risk, 'none');
  assert.deepEqual(
    ws.cost.map((c) => [c.currency, c.monthlyMinor, c.circuits]),
    [
      ['LBP', 90_000_000, 1],
      ['USD', 450_000, 1],
    ],
    'active circuits only, one row per currency',
  );
  assert.equal(ws.totals.committedMbps, 3500);
  assert.equal(ws.totals.planned, 1);

  // Committed capacity above the burst figure is refused by the register itself.
  await assert.rejects(
    capacity({
      action: 'upsert_circuit',
      circuitId: transitId,
      expectedVersion: 1,
      committedMbps: 1500,
    }),
  );
  // Update with a stale version fails; the right version advances and audits before/after.
  await assert.rejects(
    capacity({
      action: 'upsert_circuit',
      circuitId: transitId,
      expectedVersion: 5,
      committedMbps: 1500,
    }),
    /changed since/u,
  );
  const upgraded = await capacity({
    action: 'upsert_circuit',
    circuitId: transitId,
    expectedVersion: 1,
    committedMbps: 1500,
    burstMbps: 1800,
    contractEnd: day(200),
  });
  assert.equal(upgraded.version, 2);
  const after = (await read()).circuits.find((c) => c.id === transitId);
  assert.equal(after?.utilisationPct, 61.7);
  assert.equal(after?.risk, 'ok');
  assert.equal(after?.renewalDue, false);

  // Decommissioned circuits take no samples and carry no risk.
  await capacity({
    action: 'upsert_circuit',
    circuitId: ogero.circuitId as string,
    expectedVersion: 1,
    status: 'decommissioned',
  });
  await assert.rejects(
    capacity({
      action: 'record_samples',
      circuitId: ogero.circuitId as string,
      samples: samples.slice(0, 1),
    }),
    /decommissioned/u,
  );
  assert.equal((await read()).circuits.find((c) => c.id === ogero.circuitId)?.risk, 'none');

  // Branch scope: a context scoped to another branch cannot attach a circuit to this branch.
  await assert.rejects(
    capacity(
      {
        action: 'upsert_circuit',
        code: 'SCOPED-1',
        provider: 'Upstream',
        kind: 'leased_line',
        pop: 'Beirut',
        branchId,
        committedMbps: 100,
        currency: 'USD',
      },
      { overrides: { branchIds: [otherBranchId] } },
    ),
  );

  const [audit] = await admin.unsafe(
    "SELECT count(*)::integer AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action='tenant.capacity.manage'",
    [tenantId],
  );
  assert.ok(audit.count >= 7, `audit rows recorded (${audit.count})`);
  const [events] = await admin.unsafe(
    'SELECT count(*)::integer AS count FROM operations_capacity_events WHERE tenant_id=$1',
    [tenantId],
  );
  assert.ok(events.count >= 7, `capacity events recorded (${events.count})`);
  process.stdout.write('Capacity acceptance passed.\n');
} finally {
  await Promise.all([admin.end({ timeout: 5 }), runtime.client.end({ timeout: 5 })]);
}
