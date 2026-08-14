import type { VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { inTenantTransaction } from './tenant-transaction.js';

interface OperationsAuditRow extends Record<string, unknown> {
  event_id: string;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  actor_id: string;
  session_id: string;
  support_grant_id: string | null;
  permission: string;
  request_id: string;
  idempotency_key: string;
  ip_address: string;
  user_agent: string | null;
  reason: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  occurred_at: Date | string;
}

interface SubscriptionStateRow extends Record<string, unknown> {
  event_id: string;
  tenant_id: string;
  status: string;
  revision: string;
  occurred_at: Date | string;
}

export async function drainOperationsAuditOutbox(
  tenantDatabase: Database,
  controlDatabase: Database,
  tenantId: VerifiedTenantId,
  deliveredAt: Date,
  batchSize = 100,
): Promise<number> {
  assertBatchSize(batchSize);
  return inTenantTransaction(tenantDatabase, tenantId, async (transaction) => {
    const rows = await transaction.execute<OperationsAuditRow>(sql`
      SELECT * FROM read_operations_audit_outbox(${tenantId}::uuid,${batchSize})
    `);
    for (const event of rows) {
      await deliverOperationsAuditEvent(controlDatabase, event);
      await transaction.execute(sql`
        SELECT mark_operations_audit_outbox_delivered(
          ${event.event_id}::uuid,${deliveredAt.toISOString()}::text::timestamptz
        )
      `);
    }
    return rows.length;
  });
}

export async function drainControlSubscriptionStateOutbox(
  controlDatabase: Database,
  tenantDatabase: Database,
  tenantId: VerifiedTenantId,
  deliveredAt: Date,
  batchSize = 100,
): Promise<number> {
  assertBatchSize(batchSize);
  const rows = await controlDatabase.execute<SubscriptionStateRow>(sql`
    SELECT * FROM read_control_subscription_state_outbox(${tenantId}::uuid,${batchSize})
  `);
  for (const event of rows) {
    await tenantDatabase.execute(sql`
      SELECT record_operations_platform_subscription_state(
        ${event.event_id}::uuid,${event.tenant_id}::uuid,${event.status},${event.revision}::bigint,
        ${new Date(event.occurred_at).toISOString()}::text::timestamptz
      )
    `);
    await controlDatabase.execute(sql`
      SELECT mark_control_subscription_state_delivered(
        ${event.event_id}::uuid,${deliveredAt.toISOString()}::text::timestamptz
      )
    `);
  }
  return rows.length;
}

export async function listOperationsAuditRelayTenants(
  tenantDatabase: Database,
): Promise<readonly VerifiedTenantId[]> {
  const rows = await tenantDatabase.execute<{ id: string } & Record<string, unknown>>(
    sql`SELECT list_operations_audit_relay_tenants() AS id`,
  );
  return rows.map((row) => row.id as VerifiedTenantId);
}

export async function listPendingControlSubscriptionStateTenants(
  controlDatabase: Database,
): Promise<readonly VerifiedTenantId[]> {
  const rows = await controlDatabase.execute<{ id: string } & Record<string, unknown>>(
    sql`SELECT list_control_subscription_state_relay_tenants() AS id`,
  );
  return rows.map((row) => row.id as VerifiedTenantId);
}

export async function readOperationsRelayBacklog(
  tenantDatabase: Database,
  tenantId: VerifiedTenantId,
): Promise<{ count: number; oldestOccurredAt?: string }> {
  const [row] = await tenantDatabase.execute<
    { pending_count: string; oldest_at: Date | string | null } & Record<string, unknown>
  >(sql`
    SELECT pending_count::text,oldest_at
    FROM read_operations_audit_backlog(${tenantId}::uuid)
  `);
  const count = Number(row?.pending_count ?? 0);
  if (!Number.isSafeInteger(count)) throw new RangeError('Operations relay backlog is unsafe.');
  return {
    count,
    ...(row?.oldest_at ? { oldestOccurredAt: new Date(row.oldest_at).toISOString() } : {}),
  };
}

export async function readControlSubscriptionStateBacklog(
  controlDatabase: Database,
  tenantId: VerifiedTenantId,
): Promise<{ count: number; oldestOccurredAt?: string }> {
  const [row] = await controlDatabase.execute<
    { pending_count: string; oldest_at: Date | string | null } & Record<string, unknown>
  >(sql`
    SELECT pending_count::text,oldest_at
    FROM read_control_subscription_state_backlog(${tenantId}::uuid)
  `);
  const count = Number(row?.pending_count ?? 0);
  if (!Number.isSafeInteger(count)) throw new RangeError('Subscription state backlog is unsafe.');
  return {
    count,
    ...(row?.oldest_at ? { oldestOccurredAt: new Date(row.oldest_at).toISOString() } : {}),
  };
}

async function deliverOperationsAuditEvent(
  controlDatabase: Database,
  event: OperationsAuditRow,
): Promise<void> {
  const metadata = operationsControlMetadata(event);
  const occurredAt = new Date(event.occurred_at).toISOString();
  await inTenantTransaction(
    controlDatabase,
    event.tenant_id as VerifiedTenantId,
    async (control) => {
      await control.execute(sql`
      INSERT INTO audit_events(
        tenant_id,action,resource_type,resource_id,reason,request_id,ip_address,user_agent,
        result,metadata,occurred_at,actor_reference,session_reference,support_grant_reference,
        request_reference,permission
      ) VALUES(
        ${event.tenant_id},${event.action},${event.resource_type},${event.resource_id},${event.reason},
        ${event.event_id},${event.ip_address},${event.user_agent},'allowed',
        ${JSON.stringify(metadata)}::jsonb,${occurredAt}::text::timestamptz,
        ${event.actor_id},${event.session_id},${event.support_grant_id},${event.request_id},
        ${event.permission}
      ) ON CONFLICT(request_id,action) DO NOTHING
    `);
      const [delivered] = await control.execute<
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
      SELECT tenant_id,resource_type,resource_id,reason,ip_address,user_agent,result,metadata,
             occurred_at,actor_reference,session_reference,support_grant_reference,
             request_reference,permission
      FROM audit_events WHERE request_id=${event.event_id} AND action=${event.action}
    `);
      if (
        !delivered ||
        delivered.tenant_id !== event.tenant_id ||
        delivered.resource_type !== event.resource_type ||
        delivered.resource_id !== event.resource_id ||
        delivered.reason !== event.reason ||
        delivered.ip_address !== event.ip_address ||
        delivered.user_agent !== event.user_agent ||
        delivered.result !== 'allowed' ||
        new Date(delivered.occurred_at).toISOString() !== occurredAt ||
        delivered.actor_reference !== event.actor_id ||
        delivered.session_reference !== event.session_id ||
        delivered.support_grant_reference !== event.support_grant_id ||
        delivered.request_reference !== event.request_id ||
        delivered.permission !== event.permission ||
        stableJson(delivered.metadata) !== stableJson(metadata)
      ) {
        throw new Error(`Control audit conflict for Operations event ${event.event_id}.`);
      }
    },
  );
}

function operationsControlMetadata(event: OperationsAuditRow): Record<string, unknown> {
  return {
    tenantPlaneEventId: event.event_id,
    requestId: event.request_id,
    idempotencyKey: event.idempotency_key,
    before: event.before_value,
    after: event.after_value,
  };
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('Operations relay batch size must be between 1 and 500.');
  }
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
