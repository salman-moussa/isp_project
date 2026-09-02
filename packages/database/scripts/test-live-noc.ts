import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { Permission, VerifiedTenantId, TransitionOutageCommand } from '@isp/contracts';
import {
  createDatabase,
  signOperationsAttestation,
  inOperationsTransaction,
  createOutageIncident,
  transitionOutageIncident,
  readNocWorkspace,
} from '../src/index.js';
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL,
  runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error('Set local SALES_TEST database URLs.');
for (const value of [adminUrl, runtimeUrl]) {
  const u = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(u.hostname) && u.pathname === '/isp_test',
    'Local isp_test only.',
  );
}
const admin = postgres(adminUrl, { max: 2, prepare: false }),
  runtime = createDatabase(runtimeUrl);
const keyId = 'noc-test-' + randomUUID(),
  secret = randomBytes(32),
  run = randomUUID();
try {
  const [source] = await admin.unsafe(
    "SELECT s.tenant_id,s.id,s.route_id,s.branch_id,s.area_id,i.actor_id FROM operations_services s JOIN tenants t ON t.id=s.tenant_id JOIN operations_invoice_preparations p ON p.tenant_id=s.tenant_id AND p.service_id=s.id JOIN finance_invoices i ON i.tenant_id=p.tenant_id AND i.id=p.finance_invoice_id WHERE t.code LIKE 'SALES-%' AND s.status<>'terminated' ORDER BY i.created_at DESC LIMIT 1",
  );
  assert(source, 'Run local sales fixture first.');
  const tenantId = source.tenant_id as VerifiedTenantId;
  await admin.unsafe(
    "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
    [keyId, secret.toString('hex')],
  );
  function sign(action: string, key = randomUUID(), overrides: Record<string, unknown> = {}) {
    return signOperationsAttestation(
      {
        keyId,
        tenantId,
        actorId: source.actor_id,
        sessionId: randomUUID(),
        requestId: randomUUID(),
        permission: (action === 'tenant.noc.workspace.read'
          ? 'tenant.network.view'
          : 'tenant.network.job.create') as Permission,
        action,
        idempotencyKey: key,
        reason: 'Synthetic NOC incident acceptance',
        ipAddress: '127.0.0.1',
        branchIds: [source.branch_id],
        areaIds: [source.area_id],
        routeIds: [source.route_id],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        ...overrides,
      },
      secret,
    );
  }
  const command = {
    titleEn: 'Synthetic circuit interruption ' + run,
    titleAr: 'انقطاع دارة تجريبي موثق',
    routeId: source.route_id,
    severity: 'major' as const,
    serviceIds: [source.id],
    reasonEn: 'Operator confirmed loss of service',
    reasonAr: 'أكد المشغل انقطاع الخدمة بعد التحقق',
  };
  const key = randomUUID();
  const create = (body = command, id = key, overrides = {}) =>
    createOutageIncident(runtime.db, tenantId, {
      command: body,
      authorization: sign('tenant.noc.incident.create', id, overrides),
    });
  await assert.rejects(create(command, randomUUID(), { permission: 'tenant.network.view' }));
  await assert.rejects(create(command, randomUUID(), { routeIds: [] }));
  await assert.rejects(create(command, randomUUID(), { recordIds: [] }));
  await assert.rejects(create({ ...command, serviceIds: [randomUUID()] }, randomUUID()));
  await assert.rejects(create({ ...command, serviceIds: [source.id, source.id] }, randomUUID()));
  const [other] = await admin.unsafe(
    'SELECT id FROM operations_services WHERE tenant_id<>$1 LIMIT 1',
    [tenantId],
  );
  assert(other);
  await assert.rejects(create({ ...command, serviceIds: [other.id] }, randomUUID()));
  const [opened, replay] = await Promise.all([create(), create()]);
  assert.equal(opened.id, replay.id);
  assert.equal(opened.version, 1);
  await assert.rejects(create({ ...command, titleEn: 'Changed retry payload' }));
  const read = async (overrides = {}, query = {}) =>
    readNocWorkspace(runtime.db, tenantId, {
      authorization: sign('tenant.noc.workspace.read', randomUUID(), overrides),
      query,
    });
  const workspace = await read();
  const recorded = workspace.incidents.find((i) => i.id === opened.id);
  assert(recorded);
  assert.equal(recorded.impactedSubscribersCount, 1);
  assert.deepEqual(recorded.serviceIds, [source.id]);
  assert.equal(recorded.events.length, 1);
  assert(workspace.services.some((s) => s.id === source.id));
  assert.equal((await read({ routeIds: [] })).incidents.length, 0);
  await assert.rejects(read({ permission: 'tenant.subscriber.view' }));
  async function move(
    status: TransitionOutageCommand['status'],
    version: number,
    extras = {},
    id = randomUUID(),
  ) {
    return transitionOutageIncident(runtime.db, tenantId, {
      authorization: sign('tenant.noc.incident.transition', id),
      command: {
        outageId: opened.id,
        expectedVersion: version,
        status,
        reasonEn: 'Confirmed change with operational evidence',
        reasonAr: 'تم تأكيد الانتقال بناء على دليل تشغيلي',
        ...extras,
      },
    });
  }
  await assert.rejects(move('resolved', 1));
  const race = await Promise.allSettled([move('identified', 1), move('identified', 1)]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
  const monitored = await move('monitoring', 2);
  assert.equal(monitored.version, 3);
  await assert.rejects(move('resolved', 3));
  const resolveKey = randomUUID(),
    evidence = {
      rootCauseEn: 'Power loss at the upstream cabinet',
      rootCauseAr: 'انقطاع الطاقة في خزانة الشبكة الرئيسية',
      resolutionEvidence: 'Technician verified service at cabinet and customer.',
    };
  const resolved = await move('resolved', 3, evidence, resolveKey);
  assert.equal(resolved.version, 4);
  assert.equal((await move('resolved', 3, evidence, resolveKey)).id, resolved.id);
  const closed = (await read({}, { status: 'resolved' as const })).incidents.find(
    (i) => i.id === opened.id,
  );
  assert(closed?.resolvedAt);
  assert.equal(closed.events[3]?.resolutionEvidence, evidence.resolutionEvidence);
  assert(!(await read()).incidents.some((i) => i.id === opened.id));
  await move('investigating', 4);
  const reopened = (await read()).incidents.find((i) => i.id === opened.id);
  assert.equal(reopened?.version, 5);
  assert.equal(reopened?.resolvedAt, null);
  assert.equal(reopened?.events.length, 5);
  await assert.rejects(
    inOperationsTransaction(runtime.db, tenantId, sign('tenant.noc.incident.transition'), (tx) =>
      tx.execute(sql`UPDATE operations_outages SET status='resolved' WHERE id=${opened.id}::uuid`),
    ),
  );
  await assert.rejects(
    inOperationsTransaction(runtime.db, tenantId, sign('tenant.noc.incident.transition'), (tx) =>
      tx.execute(sql`DELETE FROM operations_outage_events WHERE outage_id=${opened.id}::uuid`),
    ),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND resource_type='operations_outages' AND resource_id=$2",
    [tenantId, opened.id],
  );
  assert.equal(audit.count, 5);
  const page = await read({}, { status: 'all' as const, page: 1, pageSize: 1 });
  assert.equal(page.incidents.length, 1);
  const [row] = await admin.unsafe('SELECT status FROM operations_services WHERE id=$1', [
    source.id,
  ]);
  assert(row, 'incident does not delete or replace service');
  console.log(
    'NOC live proof passed: scoped impact/counts, signed permission and tenant denials, create replay/conflict, concurrent transitions, RCA/evidence, resolve/reopen history, paging, immutable runtime writes and atomic audit. No network command executed.',
  );
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
