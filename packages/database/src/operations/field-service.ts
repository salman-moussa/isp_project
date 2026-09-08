import {
  fieldServiceQuerySchema,
  type FieldDispatchCommand,
  type FieldExecutionCommand,
  type FieldServiceQuery,
  type FieldServiceWorkspace,
  type FieldTechnicianRecord,
  type TechnicianSkill,
  type VerifiedTenantId,
  type WorkOrderChecklistItem,
  type WorkOrderEventRecord,
  type WorkOrderOutcome,
  type WorkOrderRecord,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface FieldServiceCommandResult extends Record<string, unknown> {
  readonly replayed: boolean;
}

export async function executeFieldServiceCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: FieldDispatchCommand | FieldExecutionCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<FieldServiceCommandResult> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly result: FieldServiceCommandResult;
    }>(
      sql`SELECT execute_field_service_command(${JSON.stringify(input.command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Field service command returned no result.');
    return row.result;
  });
}

interface TechnicianRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly user_id: string;
  readonly display_name: string;
  readonly phone: string | null;
  readonly skills: readonly TechnicianSkill[];
  readonly branch_id: string | null;
  readonly area_ids: readonly string[];
  readonly active: boolean;
  readonly version: number;
  readonly open_work_orders: number | string;
}

interface WorkOrderRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly work_order_number: string;
  readonly kind: WorkOrderRecord['kind'];
  readonly priority: WorkOrderRecord['priority'];
  readonly status: WorkOrderRecord['status'];
  readonly subscriber_id: string | null;
  readonly subscriber_name: string | null;
  readonly subscriber_number: string | null;
  readonly service_id: string | null;
  readonly service_number: string | null;
  readonly installation_id: string | null;
  readonly installation_status: string | null;
  readonly location_id: string | null;
  readonly address: string | null;
  readonly branch_id: string | null;
  readonly area_id: string | null;
  readonly route_id: string | null;
  readonly technician_id: string | null;
  readonly technician_name: string | null;
  readonly window_start: Date | string | null;
  readonly window_end: Date | string | null;
  readonly sla_due_at: Date | string | null;
  readonly overdue: boolean;
  readonly title_en: string;
  readonly title_ar: string;
  readonly instructions: string | null;
  readonly required_skills: readonly TechnicianSkill[];
  readonly checklist: readonly WorkOrderChecklistItem[];
  readonly outcome: WorkOrderOutcome;
  readonly failure_reason: string | null;
  readonly revisit_of: string | null;
  readonly version: number;
  readonly created_at: Date | string;
  readonly dispatched_at: Date | string | null;
  readonly started_at: Date | string | null;
  readonly closed_at: Date | string | null;
}

interface EventRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly work_order_id: string | null;
  readonly technician_id: string | null;
  readonly action: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly actor_id: string;
  readonly reason_en: string;
  readonly reason_ar: string;
  readonly evidence: string;
  readonly occurred_at: Date | string;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export async function readFieldServiceWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<FieldServiceQuery>;
  },
): Promise<FieldServiceWorkspace> {
  const query = fieldServiceQuerySchema.parse(input.query ?? {});
  const day = query.day ?? new Date().toISOString().slice(0, 10);
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      readonly [key: string]: unknown;
      readonly valid: boolean;
    }>(
      sql`SELECT true AS valid FROM operations_current_context()
          WHERE tenant_id=${tenantId} AND permission IN ('tenant.installation.view','tenant.installation.manage')
            AND action='tenant.field.workspace.read' AND support_grant_id IS NULL`,
    );
    if (!authority) throw new OperationsAuthorizationError('Installation view authority required.');

    const technicians = await tx.execute<TechnicianRow>(sql`
      SELECT t.id, t.user_id, t.display_name, t.phone, t.skills, t.branch_id, t.area_ids, t.active, t.version,
        (SELECT count(*) FROM operations_work_orders w
          WHERE w.tenant_id=t.tenant_id AND w.technician_id=t.id AND w.status IN ('dispatched','on_site')) AS open_work_orders
      FROM operations_field_technicians t WHERE t.tenant_id=${tenantId}
      ORDER BY t.active DESC, t.display_name, t.id`);

    const statusFilter =
      query.status === 'active'
        ? sql`w.status IN ('open','scheduled','dispatched','on_site')`
        : query.status === 'closed'
          ? sql`w.status IN ('completed','failed','cancelled')`
          : sql`true`;
    const technicianFilter = query.technicianId
      ? sql`w.technician_id=${query.technicianId}::uuid`
      : sql`true`;
    // The board shows everything unscheduled plus everything whose window touches the chosen day.
    const dayFilter = sql`(w.window_start IS NULL OR (w.window_start < (${day}::date + 1)::timestamptz AND w.window_end >= ${day}::date::timestamptz))`;
    const where = sql`w.tenant_id=${tenantId} AND ${statusFilter} AND ${technicianFilter} AND ${dayFilter}`;
    const [count] = await tx.execute<{ readonly [key: string]: unknown; readonly total: string }>(
      sql`SELECT count(*)::text AS total FROM operations_work_orders w WHERE ${where}`,
    );
    const workOrders = await tx.execute<WorkOrderRow>(sql`
      SELECT w.id, w.work_order_number, w.kind, w.priority, w.status, w.subscriber_id,
        s.display_name AS subscriber_name, s.subscriber_number, w.service_id, sv.service_number,
        w.installation_id, i.status::text AS installation_status, w.location_id,
        CASE WHEN l.id IS NULL THEN NULL ELSE concat_ws(', ', l.address_line, l.building, l.floor) END AS address,
        w.branch_id, w.area_id, w.route_id, w.technician_id, t.display_name AS technician_name,
        w.window_start, w.window_end, w.sla_due_at,
        (w.status IN ('open','scheduled','dispatched','on_site') AND w.sla_due_at IS NOT NULL AND w.sla_due_at < clock_timestamp()) AS overdue,
        w.title_en, w.title_ar, w.instructions, w.required_skills, w.checklist, w.outcome, w.failure_reason,
        w.revisit_of, w.version, w.created_at, w.dispatched_at, w.started_at, w.closed_at
      FROM operations_work_orders w
      LEFT JOIN operations_subscribers s ON s.tenant_id=w.tenant_id AND s.id=w.subscriber_id
      LEFT JOIN operations_services sv ON sv.tenant_id=w.tenant_id AND sv.id=w.service_id
      LEFT JOIN operations_installations i ON i.tenant_id=w.tenant_id AND i.id=w.installation_id
      LEFT JOIN operations_locations l ON l.tenant_id=w.tenant_id AND l.id=w.location_id
      LEFT JOIN operations_field_technicians t ON t.tenant_id=w.tenant_id AND t.id=w.technician_id
      WHERE ${where}
      ORDER BY CASE w.status WHEN 'on_site' THEN 0 WHEN 'dispatched' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'open' THEN 3 ELSE 4 END,
        CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        w.window_start NULLS LAST, w.created_at DESC, w.id
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    const ids = workOrders.map((row) => row.id);
    const events =
      ids.length === 0
        ? []
        : await tx.execute<EventRow>(sql`
      SELECT e.id, e.work_order_id, e.technician_id, e.action, e.from_status, e.to_status, e.actor_id,
        e.reason_en, e.reason_ar, e.evidence, e.occurred_at
      FROM operations_work_order_events e
      WHERE e.tenant_id=${tenantId} AND e.work_order_id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})
      ORDER BY e.occurred_at DESC, e.id LIMIT 500`);
    const staff = await tx.execute<{
      readonly [key: string]: unknown;
      readonly user_id: string;
      readonly display_name: string;
      readonly email: string;
      readonly role_key: string;
    }>(sql`
      SELECT m.user_id, u.display_name, u.email, m.role_key
      FROM tenant_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=${tenantId} AND m.active AND u.disabled_at IS NULL
      ORDER BY u.display_name, m.user_id LIMIT 500`);
    const openInstallations = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly service_id: string;
      readonly service_number: string;
      readonly subscriber_name: string;
      readonly status: string;
    }>(sql`
      SELECT i.id, i.service_id, sv.service_number, s.display_name AS subscriber_name, i.status::text AS status
      FROM operations_installations i
      JOIN operations_services sv ON sv.tenant_id=i.tenant_id AND sv.id=i.service_id
      JOIN operations_subscribers s ON s.tenant_id=i.tenant_id AND s.id=sv.subscriber_id
      WHERE i.tenant_id=${tenantId} AND i.status NOT IN ('ready_for_activation','completed','cancelled')
        AND NOT EXISTS (SELECT 1 FROM operations_work_orders w WHERE w.tenant_id=i.tenant_id
          AND w.installation_id=i.id AND w.status NOT IN ('completed','failed','cancelled'))
      ORDER BY i.created_at DESC, i.id LIMIT 200`);
    const branches = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly name_en: string;
      readonly name_ar: string;
    }>(
      sql`SELECT id, name_en, name_ar FROM operations_branches WHERE tenant_id=${tenantId} AND active ORDER BY code`,
    );
    const areas = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly branch_id: string;
      readonly name_en: string;
      readonly name_ar: string;
    }>(
      sql`SELECT id, branch_id, name_en, name_ar FROM operations_areas WHERE tenant_id=${tenantId} AND active ORDER BY code`,
    );

    return {
      day,
      technicians: technicians.map(
        (row): FieldTechnicianRecord => ({
          id: row.id,
          userId: row.user_id,
          displayName: row.display_name,
          ...(row.phone ? { phone: row.phone } : {}),
          skills: row.skills,
          ...(row.branch_id ? { branchId: row.branch_id } : {}),
          areaIds: row.area_ids,
          active: row.active,
          version: Number(row.version),
          openWorkOrders: Number(row.open_work_orders),
        }),
      ),
      workOrders: workOrders.map(mapWorkOrder),
      events: events.map(
        (row): WorkOrderEventRecord => ({
          id: row.id,
          ...(row.work_order_id ? { workOrderId: row.work_order_id } : {}),
          ...(row.technician_id ? { technicianId: row.technician_id } : {}),
          action: row.action,
          ...(row.from_status ? { fromStatus: row.from_status } : {}),
          ...(row.to_status ? { toStatus: row.to_status } : {}),
          actorId: row.actor_id,
          reasonEn: row.reason_en,
          reasonAr: row.reason_ar,
          evidence: row.evidence,
          occurredAt: iso(row.occurred_at),
        }),
      ),
      staff: staff.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        roleKey: row.role_key,
      })),
      openInstallations: openInstallations.map((row) => ({
        id: row.id,
        serviceId: row.service_id,
        serviceNumber: row.service_number,
        subscriberName: row.subscriber_name,
        status: row.status,
      })),
      scopes: {
        branches: branches.map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar })),
        areas: areas.map((row) => ({
          id: row.id,
          branchId: row.branch_id,
          nameEn: row.name_en,
          nameAr: row.name_ar,
        })),
      },
      page: query.page,
      pageSize: query.pageSize,
      totalCount: Number(count?.total ?? 0),
    };
  });
}

function mapWorkOrder(row: WorkOrderRow): WorkOrderRecord {
  return {
    id: row.id,
    workOrderNumber: row.work_order_number,
    kind: row.kind,
    priority: row.priority,
    status: row.status,
    ...(row.subscriber_id ? { subscriberId: row.subscriber_id } : {}),
    ...(row.subscriber_name ? { subscriberName: row.subscriber_name } : {}),
    ...(row.subscriber_number ? { subscriberNumber: row.subscriber_number } : {}),
    ...(row.service_id ? { serviceId: row.service_id } : {}),
    ...(row.service_number ? { serviceNumber: row.service_number } : {}),
    ...(row.installation_id ? { installationId: row.installation_id } : {}),
    ...(row.installation_status ? { installationStatus: row.installation_status } : {}),
    ...(row.location_id ? { locationId: row.location_id } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    ...(row.area_id ? { areaId: row.area_id } : {}),
    ...(row.route_id ? { routeId: row.route_id } : {}),
    ...(row.technician_id ? { technicianId: row.technician_id } : {}),
    ...(row.technician_name ? { technicianName: row.technician_name } : {}),
    ...(row.window_start ? { windowStart: iso(row.window_start) } : {}),
    ...(row.window_end ? { windowEnd: iso(row.window_end) } : {}),
    ...(row.sla_due_at ? { slaDueAt: iso(row.sla_due_at) } : {}),
    overdue: row.overdue,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    requiredSkills: row.required_skills,
    checklist: row.checklist,
    outcome: row.outcome,
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    ...(row.revisit_of ? { revisitOf: row.revisit_of } : {}),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    ...(row.dispatched_at ? { dispatchedAt: iso(row.dispatched_at) } : {}),
    ...(row.started_at ? { startedAt: iso(row.started_at) } : {}),
    ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
  };
}
