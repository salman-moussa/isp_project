import { createHash } from 'node:crypto';
import type { VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsConflictError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export type ServiceChangeAction = 'plan_change' | 'suspend' | 'restore' | 'terminate';

export interface ServiceChangeOrderInput {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly serviceId: string;
  readonly action: ServiceChangeAction;
  readonly targetPlanId?: string;
  readonly reason: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
}

export interface ServiceChangeOrderResult {
  readonly id: string;
  readonly serviceId: string;
  readonly action: ServiceChangeAction;
  readonly serviceStatus: ServiceStatus;
  readonly planId: string;
  readonly networkActionId: string;
  readonly effectiveAt: string;
  readonly replayed: boolean;
}

type ServiceStatus = 'draft' | 'pending_installation' | 'active' | 'suspended' | 'terminated';

export async function applyServiceChangeOrder(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ServiceChangeOrderInput,
): Promise<ServiceChangeOrderResult> {
  const fingerprint = changeFingerprint(input);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:service-change:${input.serviceId}`},0)
    )`);
    const [replay] = await transaction.execute<ChangeOrderRow>(sql`
      SELECT id,service_id,action,to_status,to_plan_id,network_action_id,effective_at,
        request_fingerprint
      FROM operations_service_change_orders
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (
        replay.service_id !== input.serviceId ||
        replay.action !== input.action ||
        replay.request_fingerprint !== fingerprint
      )
        throw new OperationsConflictError('The service change idempotency key has different input.');
      return changeResult(replay, true);
    }

    const [service] = await transaction.execute<ServiceRow>(sql`
      SELECT service.id,service.subscriber_id,service.status,service.plan_id,service.branch_id,
        service.area_id,service.route_id,plan.network_profile_reference
      FROM operations_services service
      JOIN operations_plans plan ON plan.tenant_id=service.tenant_id AND plan.id=service.plan_id
      WHERE service.tenant_id=${tenantId} AND service.id=${input.serviceId}
      FOR UPDATE OF service
    `);
    if (!service) throw new OperationsConflictError('The subscriber service was not found.');

    let toStatus: ServiceStatus = service.status;
    let toPlanId = service.plan_id;
    let networkAction: 'change_profile' | 'suspend' | 'restore' | 'terminate';
    let networkPayload: Readonly<Record<string, string>> | Readonly<Record<string, never>>;

    if (input.action === 'plan_change') {
      if (service.status !== 'active')
        throw new OperationsConflictError('Only an active service can change plan.');
      if (!input.targetPlanId || input.targetPlanId === service.plan_id)
        throw new OperationsConflictError('Select a different active plan.');
      const [target] = await transaction.execute<{
        readonly id: string;
        readonly network_profile_reference: string | null;
      }>(sql`
        SELECT id,network_profile_reference FROM operations_plans
        WHERE tenant_id=${tenantId} AND id=${input.targetPlanId} AND active
          AND archived_at IS NULL AND (branch_id IS NULL OR branch_id=${service.branch_id})
      `);
      if (!target || !target.network_profile_reference?.trim())
        throw new OperationsConflictError('The selected plan is unavailable or has no network profile.');
      toPlanId = target.id;
      networkAction = 'change_profile';
      networkPayload = { profileReference: target.network_profile_reference };
      await transaction.execute(sql`
        UPDATE operations_services SET plan_id=${toPlanId},updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.serviceId}
      `);
    } else if (input.action === 'suspend') {
      if (service.status !== 'active')
        throw new OperationsConflictError('Only an active service can be suspended.');
      toStatus = 'suspended';
      networkAction = 'suspend';
      networkPayload = { reasonCode: input.reason };
    } else if (input.action === 'restore') {
      if (service.status !== 'suspended')
        throw new OperationsConflictError('Only a suspended service can be restored.');
      toStatus = 'active';
      networkAction = 'restore';
      networkPayload = {};
      await transaction.execute(sql`
        UPDATE operations_services SET status='active',terminated_at=NULL,updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.serviceId}
      `);
      await transaction.execute(sql`
        UPDATE operations_subscribers SET status='active',closed_at=NULL,updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${service.subscriber_id}
      `);
    } else {
      if (!['active', 'suspended'].includes(service.status))
        throw new OperationsConflictError('Only an active or suspended service can be terminated.');
      toStatus = 'terminated';
      networkAction = 'terminate';
      networkPayload = { reasonCode: input.reason };
    }

    const networkIdempotencyKey = `${input.idempotencyKey}:network`;
    const [network] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_network_action_outbox(
        tenant_id,service_id,branch_id,area_id,route_id,action,payload,idempotency_key,requested_by
      ) VALUES(
        ${tenantId},${input.serviceId},${service.branch_id},${service.area_id},${service.route_id},
        ${networkAction},${JSON.stringify(networkPayload)}::jsonb,${networkIdempotencyKey},
        ${input.requestedBy}
      ) RETURNING id
    `);
    if (!network) throw new OperationsConflictError('The network action could not be created.');

    if (input.action === 'suspend') {
      await transaction.execute(sql`
        UPDATE operations_services SET status='suspended',updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.serviceId}
      `);
      await transaction.execute(sql`
        UPDATE operations_subscribers SET
          status=CASE WHEN EXISTS(
            SELECT 1 FROM operations_services other
            WHERE other.tenant_id=${tenantId} AND other.subscriber_id=${service.subscriber_id}
              AND other.id<>${input.serviceId} AND other.status='active'
          ) THEN 'active'::operations_subscriber_status ELSE 'suspended'::operations_subscriber_status END,
          closed_at=NULL,updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${service.subscriber_id}
      `);
    } else if (input.action === 'terminate') {
      await transaction.execute(sql`
        UPDATE operations_services SET status='terminated',terminated_at=clock_timestamp(),
          updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.serviceId}
      `);
      await transaction.execute(sql`
        UPDATE operations_subscribers SET
          status=CASE
            WHEN EXISTS(SELECT 1 FROM operations_services other
              WHERE other.tenant_id=${tenantId} AND other.subscriber_id=${service.subscriber_id}
                AND other.status='active') THEN 'active'::operations_subscriber_status
            WHEN EXISTS(SELECT 1 FROM operations_services other
              WHERE other.tenant_id=${tenantId} AND other.subscriber_id=${service.subscriber_id}
                AND other.status<>'terminated') THEN 'suspended'::operations_subscriber_status
            ELSE 'closed'::operations_subscriber_status END,
          closed_at=CASE WHEN EXISTS(SELECT 1 FROM operations_services other
            WHERE other.tenant_id=${tenantId} AND other.subscriber_id=${service.subscriber_id}
              AND other.status<>'terminated') THEN NULL ELSE clock_timestamp() END,
          updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${service.subscriber_id}
      `);
    }

    const [created] = await transaction.execute<ChangeOrderRow>(sql`
      INSERT INTO operations_service_change_orders(
        tenant_id,service_id,action,from_status,to_status,from_plan_id,to_plan_id,reason,
        request_fingerprint,network_action_id,requested_by,idempotency_key
      ) VALUES(
        ${tenantId},${input.serviceId},${input.action},${service.status},${toStatus},
        ${service.plan_id},${toPlanId},${input.reason},${fingerprint},${network.id},
        ${input.requestedBy},${input.idempotencyKey}
      ) RETURNING id,service_id,action,to_status,to_plan_id,network_action_id,effective_at,
        request_fingerprint
    `);
    if (!created) throw new OperationsConflictError('The service change history was not created.');
    return changeResult(created, false);
  });
}

interface ServiceRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscriber_id: string;
  readonly status: ServiceStatus;
  readonly plan_id: string;
  readonly branch_id: string;
  readonly area_id: string;
  readonly route_id: string;
  readonly network_profile_reference: string | null;
}
interface ChangeOrderRow extends Record<string, unknown> {
  readonly id: string;
  readonly service_id: string;
  readonly action: ServiceChangeAction;
  readonly to_status: ServiceStatus;
  readonly to_plan_id: string;
  readonly network_action_id: string;
  readonly effective_at: Date | string;
  readonly request_fingerprint: string;
}
function changeResult(row: ChangeOrderRow, replayed: boolean): ServiceChangeOrderResult {
  return {
    id: row.id,
    serviceId: row.service_id,
    action: row.action,
    serviceStatus: row.to_status,
    planId: row.to_plan_id,
    networkActionId: row.network_action_id,
    effectiveAt:
      row.effective_at instanceof Date
        ? row.effective_at.toISOString()
        : new Date(row.effective_at).toISOString(),
    replayed,
  };
}
function changeFingerprint(input: ServiceChangeOrderInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        serviceId: input.serviceId,
        action: input.action,
        targetPlanId: input.targetPlanId ?? null,
        reason: input.reason,
        requestedBy: input.requestedBy,
      }),
    )
    .digest('hex');
}
