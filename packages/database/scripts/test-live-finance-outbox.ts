import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SessionClaims, VerifiedTenantId } from '@isp/contracts';
import postgres from 'postgres';
import { buildApp } from '../../../apps/api/src/app.js';
import { MemoryAuditWriter } from '../../../apps/api/src/audit.js';
import { PostgresFinanceWriter } from '../../../apps/api/src/postgres-adapters.js';
import {
  createDatabase,
  deliverFinanceAuditEvent,
  drainFinanceAuditOutbox,
  listFinanceAuditRelayTenants,
  postInvoice,
  readFinanceAuditBacklog,
  readPendingFinanceAuditOutbox,
} from '../src/index.js';
import { assertTenantDatabaseReady } from '../../../apps/api/src/readiness.js';
import { migrate } from './migrate.mjs';

const controlMigrationUrl = process.env.DATABASE_MIGRATION_URL;
const tenantMigrationUrl = process.env.TENANT_FINANCE_AUDIT_MIGRATION_DATABASE_URL;
const runtimeUrl = process.env.TENANT_FINANCE_AUDIT_RUNTIME_DATABASE_URL;
const tenantRelayUrl = process.env.TENANT_FINANCE_AUDIT_RELAY_DATABASE_URL;
const controlRelayUrl = process.env.CONTROL_FINANCE_AUDIT_RELAY_DATABASE_URL;
if (
  !controlMigrationUrl ||
  !tenantMigrationUrl ||
  !runtimeUrl ||
  !tenantRelayUrl ||
  !controlRelayUrl
) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Finance outbox integration requires migration and runtime database URLs.');
  }
  console.log('Finance outbox integration skipped: live PostgreSQL URLs are not configured.');
  process.exit(0);
}

assert.notEqual(
  controlMigrationUrl,
  tenantMigrationUrl,
  'control and tenant planes need distinct DSNs',
);
assert.notEqual(
  controlRelayUrl,
  tenantRelayUrl,
  'control and tenant relay DSNs need distinct databases',
);
await migrate(controlMigrationUrl);
await migrate(tenantMigrationUrl);
const controlAdmin = postgres(controlMigrationUrl, { max: 1, prepare: false });
const tenantAdmin = postgres(tenantMigrationUrl, { max: 1, prepare: false });
const tenantStore = createDatabase(runtimeUrl);
const tenantRelayStore = createDatabase(tenantRelayUrl);
const controlStore = createDatabase(controlRelayUrl);
const tenantId = randomUUID() as VerifiedTenantId;
const actorId = randomUUID();
const now = new Date('2026-08-11T12:00:00.000Z');

try {
  for (const admin of [controlAdmin, tenantAdmin]) {
    await admin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`
        INSERT INTO tenants (id, code, brand_name, legal_name)
        VALUES (${tenantId}, ${`outbox-${tenantId}`}, 'Outbox ISP', 'Outbox ISP SAL')
      `;
    });
  }

  await assertTenantDatabaseReady(tenantStore.client);
  const invoice = await postInvoice(tenantStore.db, tenantId, {
    number: 'OUTBOX-001',
    amountMinor: 100,
    currency: 'USD',
    idempotencyKey: 'outbox-atomic-001',
    actorId,
    audit: auditContext('tenant.invoice.post', 'tenant.invoice.post'),
    postedAt: now,
  });
  await assert.rejects(
    tenantStore.client`SELECT event_id FROM finance_audit_outbox LIMIT 1`,
    /permission denied/i,
  );
  await assert.rejects(
    tenantStore.client`SELECT mark_finance_audit_outbox_delivered(${randomUUID()}, now())`,
    /permission denied/i,
  );
  const pending = await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId);
  assert.equal(pending.length, 1, 'journal insert and outbox insert must commit together');
  assert.equal(pending[0]?.sourceEntryId, invoice.id);
  assert.equal(pending[0]?.actorId, actorId);

  const rolledBackId = randomUUID();
  await assert.rejects(
    tenantStore.client.begin(async (transaction) => {
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await transaction`SELECT set_config('app.finance_actor_id', ${actorId}, true)`;
      await transaction`SELECT set_config('app.finance_session_id', 'rollback-session', true)`;
      await transaction`SELECT set_config('app.finance_support_grant_id', '', true)`;
      await transaction`SELECT set_config('app.finance_request_id', 'rollback-request', true)`;
      await transaction`SELECT set_config('app.finance_ip_address', '127.0.0.1', true)`;
      await transaction`SELECT set_config('app.finance_user_agent', 'rollback-test', true)`;
      await transaction`SELECT set_config('app.finance_permission', 'tenant.invoice.post', true)`;
      await transaction`SELECT set_config('app.finance_reason', 'Atomic rollback integration test.', true)`;
      await transaction`SELECT set_config('app.finance_action', 'tenant.invoice.post', true)`;
      await transaction`
        INSERT INTO finance_invoices
          (id, tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
        VALUES (${rolledBackId}, ${tenantId}, 'ROLLBACK-001', 50, 'USD',
          'outbox-rollback-001', ${actorId}, ${now.toISOString()})
      `;
      throw new Error('force transaction rollback');
    }),
    /force transaction rollback/,
  );
  const [financeRollbackState] = await tenantAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return transaction`
      SELECT EXISTS (SELECT 1 FROM finance_invoices WHERE id = ${rolledBackId}) AS finance_exists
    `;
  });
  const [outboxRollbackState] = await tenantRelayStore.client.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return transaction`
      SELECT EXISTS (
        SELECT 1 FROM finance_audit_outbox WHERE source_entry_id = ${rolledBackId}
      ) AS outbox_exists
    `;
  });
  assert.deepEqual(
    {
      finance: financeRollbackState?.finance_exists,
      outbox: outboxRollbackState?.outbox_exists,
    },
    { finance: false, outbox: false },
    'rollback must remove both finance row and its trigger-created outbox evidence',
  );

  // Simulate a relay crash after the control insert but before the tenant delivery marker commits.
  assert.ok((await listFinanceAuditRelayTenants(tenantRelayStore.db)).includes(tenantId));
  const backlog = await readFinanceAuditBacklog(tenantRelayStore.db, tenantId);
  assert.equal(backlog.pendingCount, 1);
  assert.equal(backlog.oldestOccurredAt, pending[0]!.occurredAt);
  await deliverFinanceAuditEvent(controlStore.db, pending[0]!);
  assert.equal((await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId)).length, 1);
  assert.equal(
    await drainFinanceAuditOutbox(tenantRelayStore.db, controlStore.db, tenantId, now),
    1,
  );
  assert.equal((await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId)).length, 0);
  assert.equal(
    await drainFinanceAuditOutbox(tenantRelayStore.db, controlStore.db, tenantId, now),
    0,
  );
  const [{ delivery_count: deliveryCount }] = await controlAdmin.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return transaction`
      SELECT count(*)::integer AS delivery_count
      FROM audit_events
      WHERE request_id = ${pending[0]!.eventId} AND action = ${pending[0]!.action}
    `;
  });
  assert.equal(deliveryCount, 1, 'relay retry must not duplicate control audit evidence');
  await assert.rejects(
    tenantRelayStore.client.begin(async (transaction) => {
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await transaction`
        INSERT INTO finance_invoices
          (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
        VALUES (${tenantId}, 'RELAY-MUST-NOT-WRITE', 1, 'USD', 'relay-mutation-denied',
          ${actorId}, ${now.toISOString()})
      `;
    }),
    /permission denied/i,
  );

  const apiAudit = new MemoryAuditWriter();
  const claims: SessionClaims = {
    sub: actorId,
    sessionId: randomUUID(),
    audience: 'tenant',
    tenantId,
    authorizationVersion: 1,
    permissions: [
      'tenant.invoice.post',
      'tenant.invoice.reverse',
      'tenant.payment.post',
      'tenant.payment.reverse',
    ],
  };
  const app = await buildApp(
    {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3000,
      JWT_SECRET: 'test-only-secret-that-is-at-least-thirty-two-characters',
      SUPPORT_TOKEN_ISSUER: 'orvex-isp-test',
      SUPPORT_TOKEN_AUDIENCE: 'orvex-isp-api-test',
      CONTROL_DATABASE_URL: controlRelayUrl,
      TENANT_DATABASE_URL: runtimeUrl,
      CORS_ORIGINS: 'http://localhost:5173',
    },
    {
      audit: apiAudit,
      finance: new PostgresFinanceWriter(tenantStore.db),
      now: () => now,
      sessions: { isActive: async () => true },
      tenantMemberships: {
        readActive: async () => ({
          tenantId,
          userId: actorId,
          permissions: claims.permissions,
          authorizationVersion: 1,
        }),
      },
      supportGrants: {
        readApproved: async (grantId, approvedTenantId, requesterId) => ({
          id: grantId,
          tenantId: approvedTenantId,
          requesterId,
          ticketId: 'ticket-finance-live',
          approverId: 'support-manager-live',
          reason: 'Approved correction of the live billing incident',
          permissions: ['tenant.invoice.post'],
          expiresAt: '2026-08-11T13:00:00.000Z',
          authorizationVersion: 1,
        }),
      },
    },
  );
  await app.ready();
  try {
    const token = app.jwt.sign(claims);
    const request = async (amountMinor: number) =>
      app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/finance/invoices`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': 'real-api-conflict-001',
          'user-agent': 'orvex-tenant-live/1.0',
        },
        payload: {
          number: 'API-CONFLICT-001',
          amountMinor,
          currency: 'USD',
          postedAt: now.toISOString(),
        },
      });
    const postedInvoice = await request(100);
    assert.equal(postedInvoice.statusCode, 201, postedInvoice.body);
    const idempotencyConflict = await request(101);
    assert.equal(idempotencyConflict.statusCode, 409);
    assert.equal(idempotencyConflict.json().error.code, 'IDEMPOTENCY_CONFLICT');

    const postedPayment = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/payments`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'real-api-payment-001',
      },
      payload: {
        number: 'API-PAYMENT-001',
        amountMinor: 50,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    assert.equal(postedPayment.statusCode, 201);
    const businessConflict = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/allocations`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'real-api-allocation-001',
      },
      payload: {
        invoiceId: postedInvoice.json().id,
        paymentId: postedPayment.json().id,
        amountMinor: 51,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    assert.equal(businessConflict.statusCode, 409);
    assert.equal(businessConflict.json().error.code, 'FINANCE_CONFLICT');

    const directConflict = await tenantStore.client
      .begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await transaction`SELECT set_config('app.finance_actor_id', ${actorId}, true)`;
        await transaction`SELECT set_config('app.finance_session_id', ${claims.sessionId}, true)`;
        await transaction`SELECT set_config('app.finance_support_grant_id', '', true)`;
        await transaction`SELECT set_config('app.finance_request_id', 'direct-conflict-request', true)`;
        await transaction`SELECT set_config('app.finance_ip_address', '127.0.0.1', true)`;
        await transaction`SELECT set_config('app.finance_user_agent', 'direct-conflict-test', true)`;
        await transaction`SELECT set_config('app.finance_permission', 'tenant.invoice.post', true)`;
        await transaction`SELECT set_config('app.finance_reason', 'Direct conflict integration test.', true)`;
        await transaction`SELECT set_config('app.finance_action', 'tenant.invoice.post', true)`;
        return transaction`
          INSERT INTO finance_invoices
            (tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
          VALUES (${tenantId}, 'API-CONFLICT-001', 102, 'USD', 'real-api-conflict-001',
            ${actorId}, ${now.toISOString()})
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        `;
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    assert.equal(databaseCode(directConflict), 'P4090');

    const supportClaims: SessionClaims = {
      sub: 'support-agent-live',
      sessionId: 'support-session-live',
      audience: 'platform',
      permissions: ['platform.support.request'],
      supportGrant: {
        grantId: 'support-grant-live',
        tenantId,
        ticketId: 'ticket-finance-live',
        approverId: 'support-manager-live',
        reason: 'Approved correction of the live billing incident',
        permissions: ['tenant.invoice.post'],
        expiresAt: '2026-08-11T13:00:00.000Z',
        authorizationVersion: 1,
      },
    };
    const supportPosted = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: {
        authorization: `Bearer ${app.jwt.sign(supportClaims)}`,
        'idempotency-key': 'support-api-invoice-001',
        'user-agent': 'orvex-support-live/1.0',
      },
      payload: {
        number: 'SUPPORT-API-INV-001',
        amountMinor: 75,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    assert.equal(supportPosted.statusCode, 201, supportPosted.body);
    const supportEvent = (await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId)).find(
      (event) => event.idempotencyKey === 'support-api-invoice-001',
    );
    assert.ok(supportEvent);
    assert.equal(supportEvent.actorId, 'support-agent-live');
    assert.equal(supportEvent.sessionId, 'support-session-live');
    assert.equal(supportEvent.supportGrantId, 'support-grant-live');
    assert.equal(supportEvent.action, 'support.tenant.invoice.post');
    assert.equal(supportEvent.permission, 'tenant.invoice.post');
    assert.equal(supportEvent.reason, 'Approved correction of the live billing incident');
    assert.equal(supportEvent.userAgent, 'orvex-support-live/1.0');
    assert.notEqual(supportEvent.occurredAt, supportEvent.clientPostedAt);
    await deliverFinanceAuditEvent(controlStore.db, supportEvent);
    const [relayedSupport] = await controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return transaction`
        SELECT actor_reference, session_reference, support_grant_reference, request_reference,
               permission, reason, request_id, ip_address, user_agent, occurred_at, metadata
        FROM audit_events
        WHERE request_id = ${supportEvent.eventId} AND action = ${supportEvent.action}
      `;
    });
    assert.equal(relayedSupport?.actor_reference, supportEvent.actorId);
    assert.equal(relayedSupport?.session_reference, supportEvent.sessionId);
    assert.equal(relayedSupport?.support_grant_reference, supportEvent.supportGrantId);
    assert.equal(relayedSupport?.permission, supportEvent.permission);
    assert.equal(relayedSupport?.reason, supportEvent.reason);
    assert.equal(relayedSupport?.request_id, supportEvent.eventId);
    assert.equal(relayedSupport?.request_reference, supportEvent.requestId);
    assert.equal(relayedSupport?.ip_address, supportEvent.ipAddress);
    assert.equal(relayedSupport?.user_agent, supportEvent.userAgent);
    assert.equal(new Date(relayedSupport!.occurred_at).toISOString(), supportEvent.occurredAt);

    const uncertainInvoice = await postInvoice(tenantStore.db, tenantId, {
      number: 'UNCERTAIN-COMMIT-001',
      amountMinor: 30,
      currency: 'USD',
      idempotencyKey: 'uncertain-commit-001',
      actorId,
      audit: auditContext('tenant.invoice.post', 'tenant.invoice.post'),
      postedAt: now,
    });
    const laterInvoice = await postInvoice(tenantStore.db, tenantId, {
      number: 'UNCERTAIN-LATER-001',
      amountMinor: 31,
      currency: 'USD',
      idempotencyKey: 'uncertain-later-001',
      actorId,
      audit: auditContext('tenant.invoice.post', 'tenant.invoice.post'),
      postedAt: now,
    });
    const uncertainPending = await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId);
    const uncertainEvent = uncertainPending.find(
      (event) => event.sourceEntryId === uncertainInvoice.id,
    );
    const laterEvent = uncertainPending.find((event) => event.sourceEntryId === laterInvoice.id);
    assert.ok(uncertainEvent);
    assert.ok(laterEvent);
    await controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await transaction`
        INSERT INTO audit_events (
          tenant_id, action, resource_type, resource_id, reason, request_id, ip_address,
          user_agent, result, metadata, occurred_at
        ) VALUES (
          ${tenantId}, ${uncertainEvent.action}, ${uncertainEvent.resourceType},
          ${uncertainEvent.sourceEntryId}, 'commit acknowledgement was lost',
          ${uncertainEvent.requestId}, ${uncertainEvent.ipAddress},
          ${uncertainEvent.userAgent ?? null}, 'failed', '{}'::jsonb, now()
        )
      `;
    });
    await drainFinanceAuditOutbox(tenantRelayStore.db, controlStore.db, tenantId, now, 100);
    const remainingAfterUncertain = await readPendingFinanceAuditOutbox(
      tenantRelayStore.db,
      tenantId,
    );
    assert.ok(!remainingAfterUncertain.some((event) => event.eventId === uncertainEvent.eventId));
    assert.ok(!remainingAfterUncertain.some((event) => event.eventId === laterEvent.eventId));
    const [uncertainDeliveryState] = await controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return transaction`
        SELECT
          count(*) FILTER (WHERE request_id = ${uncertainEvent.requestId})::integer AS failed_count,
          count(*) FILTER (WHERE request_id = ${uncertainEvent.eventId})::integer AS allowed_count
        FROM audit_events
        WHERE action = ${uncertainEvent.action}
          AND request_id IN (${uncertainEvent.requestId}, ${uncertainEvent.eventId})
      `;
    });
    assert.deepEqual(
      uncertainDeliveryState,
      { failed_count: 1, allowed_count: 1 },
      'ambiguous commit evidence and the committed allowed outbox event must coexist',
    );

    const conflictInvoice = await postInvoice(tenantStore.db, tenantId, {
      number: 'CONFLICT-ENVELOPE-001',
      amountMinor: 25,
      currency: 'USD',
      idempotencyKey: 'conflict-envelope-001',
      actorId,
      audit: auditContext('tenant.invoice.post', 'tenant.invoice.post'),
      postedAt: now,
    });
    const conflictEvent = (await readPendingFinanceAuditOutbox(tenantRelayStore.db, tenantId)).find(
      (event) => event.sourceEntryId === conflictInvoice.id,
    );
    assert.ok(conflictEvent);
    await controlAdmin.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await transaction`
        INSERT INTO audit_events (
          tenant_id, action, resource_type, resource_id, reason, request_id, ip_address,
          user_agent, result, metadata, occurred_at, actor_reference, session_reference,
          support_grant_reference, request_reference, permission
        ) VALUES (
          ${tenantId}, ${conflictEvent.action}, ${conflictEvent.resourceType},
          ${conflictEvent.sourceEntryId}, 'wrong reason', ${conflictEvent.eventId},
          ${conflictEvent.ipAddress}, ${conflictEvent.userAgent ?? null}, 'allowed',
          '{}'::jsonb, ${conflictEvent.occurredAt}, ${conflictEvent.actorId},
          ${conflictEvent.sessionId}, null, ${conflictEvent.requestId}, ${conflictEvent.permission}
        )
      `;
    });
    await assert.rejects(
      deliverFinanceAuditEvent(controlStore.db, conflictEvent),
      /Control audit conflict/,
      'a partial or mismatched preseed must never be accepted as delivered evidence',
    );
  } finally {
    await app.close();
  }

  console.log(
    'Finance outbox integration passed: atomicity, retry dedupe, readiness, SQLSTATE, and API mapping.',
  );
} finally {
  await Promise.all([
    controlAdmin.end({ timeout: 5 }),
    tenantAdmin.end({ timeout: 5 }),
    tenantStore.client.end({ timeout: 5 }),
    tenantRelayStore.client.end({ timeout: 5 }),
    controlStore.client.end({ timeout: 5 }),
  ]);
}

function auditContext(action: string, permission: string) {
  return {
    sessionId: 'finance-outbox-session',
    action,
    requestId: `finance-outbox-${randomUUID()}`,
    ipAddress: '127.0.0.1',
    userAgent: 'orvex-finance-outbox-integration/1.0',
    permission,
    reason: 'Authorized finance outbox integration mutation.',
  };
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
