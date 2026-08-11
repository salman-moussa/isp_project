import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { inTenantTransaction } from './tenant-transaction.js';

export interface FinanceAuditOutboxEvent {
  readonly eventId: string;
  readonly tenantId: VerifiedTenantId;
  readonly sourceTable: 'finance_invoices' | 'finance_payments' | 'finance_payment_allocations';
  readonly sourceEntryId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly permission: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly clientPostedAt: string;
}

interface OutboxRow extends Record<string, unknown> {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly source_table: FinanceAuditOutboxEvent['sourceTable'];
  readonly source_entry_id: string;
  readonly action: string;
  readonly resource_type: string;
  readonly actor_id: string;
  readonly session_id: string;
  readonly support_grant_id: string | null;
  readonly request_id: string;
  readonly ip_address: string;
  readonly user_agent: string | null;
  readonly permission: string;
  readonly reason: string;
  readonly idempotency_key: string;
  readonly amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly metadata: Record<string, unknown>;
  readonly occurred_at: Date | string;
  readonly client_posted_at: Date | string;
}

export async function drainFinanceAuditOutbox(
  tenantDatabase: Database,
  controlDatabase: Database,
  tenantId: VerifiedTenantId,
  deliveredAt: Date,
  batchSize = 100,
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('Finance audit relay batch size must be between 1 and 500.');
  }

  return inTenantTransaction(tenantDatabase, tenantId, async (transaction) => {
    const rows = await transaction.execute<OutboxRow>(sql`
      SELECT event_id, tenant_id, source_table, source_entry_id, action, resource_type,
             actor_id, session_id, support_grant_id, request_id, ip_address, user_agent,
             permission, reason, idempotency_key, amount_minor, currency, metadata,
             occurred_at, client_posted_at
      FROM finance_audit_outbox
      WHERE tenant_id = ${tenantId} AND delivered_at IS NULL
      ORDER BY created_at, event_id
      LIMIT ${batchSize}
    `);

    for (const row of rows) {
      const event = mapOutboxRow(row);
      await deliverFinanceAuditEvent(controlDatabase, event);
      await transaction.execute<{ marked: boolean } & Record<string, unknown>>(sql`
        SELECT mark_finance_audit_outbox_delivered(
          ${event.eventId}::uuid,
          ${deliveredAt.toISOString()}::text::timestamptz
        ) AS marked
      `);
      // Concurrent relays may both deliver the same event; the control uniqueness key deduplicates
      // the insert and the first marker wins. A later false marker is therefore already complete.
    }
    return rows.length;
  });
}

export async function deliverFinanceAuditEvent(
  controlDatabase: Database,
  event: FinanceAuditOutboxEvent,
): Promise<void> {
  await inTenantTransaction(controlDatabase, event.tenantId, async (transaction) => {
    await transaction.execute(sql`
      INSERT INTO audit_events (
        tenant_id, action, resource_type, resource_id, reason, request_id, ip_address,
        user_agent, result, metadata, occurred_at, actor_reference, session_reference,
        support_grant_reference, request_reference, permission
      ) VALUES (
        ${event.tenantId}, ${event.action}, ${event.resourceType}, ${event.sourceEntryId},
        ${event.reason}, ${event.eventId}, ${event.ipAddress}, ${event.userAgent ?? null},
        'allowed', ${JSON.stringify(controlMetadata(event))}::jsonb,
        ${event.occurredAt}::text::timestamptz
        , ${event.actorId}, ${event.sessionId}, ${event.supportGrantId ?? null},
        ${event.requestId},
        ${event.permission}
      )
      ON CONFLICT (request_id, action) DO NOTHING
    `);
    const [delivered] = await transaction.execute<
      {
        tenant_id: string;
        resource_type: string;
        resource_id: string;
        reason: string;
        ip_address: string;
        user_agent: string | null;
        result: string;
        metadata: Record<string, unknown>;
        occurred_at: Date | string;
        actor_reference: string;
        session_reference: string;
        support_grant_reference: string | null;
        request_reference: string;
        permission: string;
      } & Record<string, unknown>
    >(sql`
      SELECT tenant_id, resource_type, resource_id, reason, ip_address, user_agent,
             result, metadata, occurred_at, actor_reference, session_reference,
             support_grant_reference, request_reference, permission
      FROM audit_events
      WHERE request_id = ${event.eventId} AND action = ${event.action}
    `);
    if (
      !delivered ||
      delivered.tenant_id !== event.tenantId ||
      delivered.resource_type !== event.resourceType ||
      delivered.resource_id !== event.sourceEntryId ||
      delivered.reason !== event.reason ||
      delivered.ip_address !== event.ipAddress ||
      delivered.user_agent !== (event.userAgent ?? null) ||
      delivered.result !== 'allowed' ||
      new Date(delivered.occurred_at).toISOString() !== event.occurredAt ||
      delivered.actor_reference !== event.actorId ||
      delivered.session_reference !== event.sessionId ||
      delivered.support_grant_reference !== (event.supportGrantId ?? null) ||
      delivered.request_reference !== event.requestId ||
      delivered.permission !== event.permission ||
      stableJson(delivered.metadata) !== stableJson(controlMetadata(event))
    ) {
      throw new Error(`Control audit conflict for tenant-plane event ${event.eventId}.`);
    }
  });
}

export async function readPendingFinanceAuditOutbox(
  tenantDatabase: Database,
  tenantId: VerifiedTenantId,
  limit = 100,
): Promise<readonly FinanceAuditOutboxEvent[]> {
  return inTenantTransaction(tenantDatabase, tenantId, async (transaction) => {
    const rows = await transaction.execute<OutboxRow>(sql`
      SELECT event_id, tenant_id, source_table, source_entry_id, action, resource_type,
             actor_id, session_id, support_grant_id, request_id, ip_address, user_agent,
             permission, reason, idempotency_key, amount_minor, currency, metadata,
             occurred_at, client_posted_at
      FROM finance_audit_outbox
      WHERE tenant_id = ${tenantId} AND delivered_at IS NULL
      ORDER BY created_at, event_id
      LIMIT ${limit}
    `);
    return rows.map(mapOutboxRow);
  });
}

function mapOutboxRow(row: OutboxRow): FinanceAuditOutboxEvent {
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Finance audit amount exceeds the safe API integer range.');
  }
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id as VerifiedTenantId,
    sourceTable: row.source_table,
    sourceEntryId: row.source_entry_id,
    action: row.action,
    resourceType: row.resource_type,
    actorId: row.actor_id,
    sessionId: row.session_id,
    ...(row.support_grant_id ? { supportGrantId: row.support_grant_id } : {}),
    requestId: row.request_id,
    ipAddress: row.ip_address,
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    permission: row.permission,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    amountMinor,
    currency: row.currency,
    metadata: row.metadata,
    occurredAt: new Date(row.occurred_at).toISOString(),
    clientPostedAt: new Date(row.client_posted_at).toISOString(),
  };
}

export interface FinanceAuditBacklog {
  readonly pendingCount: number;
  readonly oldestOccurredAt?: string;
}

export async function listFinanceAuditRelayTenants(
  tenantDatabase: Database,
): Promise<readonly VerifiedTenantId[]> {
  const rows = await tenantDatabase.execute<{ id: string } & Record<string, unknown>>(
    sql`SELECT list_finance_audit_relay_tenants() AS id`,
  );
  return rows.map((row) => row.id as VerifiedTenantId);
}

export async function readFinanceAuditBacklog(
  tenantDatabase: Database,
  tenantId: VerifiedTenantId,
): Promise<FinanceAuditBacklog> {
  return inTenantTransaction(tenantDatabase, tenantId, async (transaction) => {
    const [row] = await transaction.execute<
      { pending_count: string; oldest_occurred_at: Date | string | null } & Record<string, unknown>
    >(sql`
      SELECT count(*)::bigint AS pending_count, min(occurred_at) AS oldest_occurred_at
      FROM finance_audit_outbox
      WHERE tenant_id = ${tenantId} AND delivered_at IS NULL
    `);
    const pendingCount = Number(row?.pending_count ?? 0);
    if (!Number.isSafeInteger(pendingCount))
      throw new RangeError('Finance audit backlog is unsafe.');
    return {
      pendingCount,
      ...(row?.oldest_occurred_at
        ? { oldestOccurredAt: new Date(row.oldest_occurred_at).toISOString() }
        : {}),
    };
  });
}

function controlMetadata(event: FinanceAuditOutboxEvent): Record<string, unknown> {
  return {
    ...event.metadata,
    actorId: event.actorId,
    sessionId: event.sessionId,
    ...(event.supportGrantId ? { supportGrantId: event.supportGrantId } : {}),
    idempotencyKey: event.idempotencyKey,
    amountMinor: event.amountMinor,
    currency: event.currency,
    sourceTable: event.sourceTable,
    tenantPlaneEventId: event.eventId,
    clientPostedAt: event.clientPostedAt,
    requestId: event.requestId,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
