import {
  createOutageSchema,
  transitionOutageSchema,
  nocQuerySchema,
  type CreateOutageCommand,
  type TransitionOutageCommand,
  type NocQuery,
  type NocWorkspace,
  type AlarmRecord,
  type OutageRecord,
  type QosReportRecord,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readNetworkAlarms(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly AlarmRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      device_name: string;
      severity: AlarmRecord['severity'];
      alarm_code: string;
      message_en: string;
      message_ar: string;
      raised_at: Date | string;
      cleared_at: Date | string | null;
      status: AlarmRecord['status'];
    }>(sql`
      SELECT id, device_name, severity, alarm_code, message_en, message_ar, raised_at, cleared_at, status
      FROM operations_network_alarms
      WHERE tenant_id = ${tenantId}
      ORDER BY raised_at DESC
      LIMIT 100
    `);

    return rows.map((r) => ({
      id: r.id,
      deviceName: r.device_name,
      severity: r.severity,
      alarmCode: r.alarm_code,
      messageEn: r.message_en,
      messageAr: r.message_ar,
      raisedAt: typeof r.raised_at === 'string' ? r.raised_at : r.raised_at.toISOString(),
      clearedAt: r.cleared_at
        ? typeof r.cleared_at === 'string'
          ? r.cleared_at
          : r.cleared_at.toISOString()
        : null,
      status: r.status,
    }));
  });
}

export async function readOutages(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly OutageRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      outage_title_en: string;
      outage_title_ar: string;
      affected_region: string;
      impacted_subscribers_count: number;
      started_at: Date | string;
      resolved_at: Date | string | null;
      root_cause_en: string | null;
      root_cause_ar: string | null;
      status: OutageRecord['status'];
    }>(sql`
      SELECT id, outage_title_en, outage_title_ar, affected_region, impacted_subscribers_count,
             started_at, resolved_at, root_cause_en, root_cause_ar, status
      FROM operations_outages
      WHERE tenant_id = ${tenantId}
      ORDER BY started_at DESC
      LIMIT 100
    `);

    return rows.map((r) => ({
      id: r.id,
      outageTitleEn: r.outage_title_en,
      outageTitleAr: r.outage_title_ar,
      affectedRegion: r.affected_region,
      impactedSubscribersCount: r.impacted_subscribers_count,
      startedAt: typeof r.started_at === 'string' ? r.started_at : r.started_at.toISOString(),
      resolvedAt: r.resolved_at
        ? typeof r.resolved_at === 'string'
          ? r.resolved_at
          : r.resolved_at.toISOString()
        : null,
      rootCauseEn: r.root_cause_en,
      rootCauseAr: r.root_cause_ar,
      status: r.status,
    }));
  });
}

export async function readQosReports(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly QosReportRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      report_period: string;
      uptime_percentage: string;
      avg_latency_ms: number;
      billing_accuracy_pct: string;
      mttr_hours: string;
      submitted_to_tra: boolean;
    }>(sql`
      SELECT id, report_period, uptime_percentage::text, avg_latency_ms,
             billing_accuracy_pct::text, mttr_hours::text, submitted_to_tra
      FROM operations_qos_reports
      WHERE tenant_id = ${tenantId}
      ORDER BY report_period DESC
    `);

    return rows.map((r) => ({
      id: r.id,
      reportPeriod: r.report_period,
      uptimePercentage: parseFloat(r.uptime_percentage),
      avgLatencyMs: r.avg_latency_ms,
      billingAccuracyPct: parseFloat(r.billing_accuracy_pct),
      mttrHours: parseFloat(r.mttr_hours),
      submittedToTra: r.submitted_to_tra,
    }));
  });
}
export async function createOutageIncident(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: CreateOutageCommand;
  },
): Promise<{ id: string; status: string; version: number }> {
  return mutateIncident(
    database,
    tenantId,
    input.authorization,
    createOutageSchema.parse(input.command),
  );
}
export async function transitionOutageIncident(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: TransitionOutageCommand;
  },
): Promise<{ id: string; status: string; version: number }> {
  return mutateIncident(
    database,
    tenantId,
    input.authorization,
    transitionOutageSchema.parse(input.command),
  );
}
export async function resolveOutageIncident(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: TransitionOutageCommand;
  },
) {
  return transitionOutageIncident(database, tenantId, {
    ...input,
    command: { ...input.command, status: 'resolved' },
  });
}
async function mutateIncident(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  command: unknown,
) {
  return inOperationsTransaction(database, tenantId, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: { id: string; status: string; version: number } }>(
      sql`SELECT execute_noc_incident(${JSON.stringify(command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Incident write returned no result.');
    return row.result;
  });
}
export async function readNocWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<NocQuery>;
  },
): Promise<NocWorkspace> {
  const query = nocQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      valid: boolean;
    }>(sql`SELECT true AS valid FROM operations_current_context()
   WHERE tenant_id=${tenantId} AND permission='tenant.network.view' AND action='tenant.noc.workspace.read' AND support_grant_id IS NULL`);
    if (!authority) throw new OperationsAuthorizationError('Network view authority required.');
    const routes = await tx.execute<
      NocWorkspace['routes'][number]
    >(sql`SELECT id,name_en AS "nameEn",name_ar AS "nameAr"
    FROM operations_routes WHERE tenant_id=${tenantId} AND active ORDER BY name_en,id`);
    const directory = await tx.execute<
      NocWorkspace['services'][number]
    >(sql`SELECT s.id,s.route_id AS "routeId",
    s.service_number AS "serviceNumber",u.display_name AS "subscriberName"
    FROM operations_services s JOIN operations_subscribers u ON u.tenant_id=s.tenant_id AND u.id=s.subscriber_id
    WHERE s.tenant_id=${tenantId} AND s.status<>'terminated'
    ORDER BY s.service_number,s.id LIMIT 1001`);
    const where = sql`o.tenant_id=${tenantId} AND (${query.status}='all' OR
    (${query.status}='open' AND o.status<>'resolved') OR (${query.status}='resolved' AND o.status='resolved'))`;
    const [count] = await tx.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM operations_outages o WHERE ${where}`,
    );
    const rows = await tx.execute<{
      record: NocWorkspace['incidents'][number];
    }>(sql`SELECT jsonb_build_object(
    'id',o.id,'outageTitleEn',o.outage_title_en,'outageTitleAr',o.outage_title_ar,
    'affectedRegion',o.affected_region,'impactedSubscribersCount',o.impacted_subscribers_count,
    'startedAt',o.started_at,'resolvedAt',o.resolved_at,'rootCauseEn',o.root_cause_en,'rootCauseAr',o.root_cause_ar,
    'status',o.status,'routeId',o.route_id,'severity',o.severity,'version',o.version,
    'serviceIds',coalesce((SELECT jsonb_agg(i.service_id ORDER BY i.service_id) FROM operations_outage_impacts i WHERE i.tenant_id=o.tenant_id AND i.outage_id=o.id),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'status',e.status,
      'reasonEn',e.reason_en,'reasonAr',e.reason_ar,'occurredAt',e.occurred_at,'resolutionEvidence',e.resolution_evidence) ORDER BY e.version)
      FROM operations_outage_events e WHERE e.tenant_id=o.tenant_id AND e.outage_id=o.id),'[]'::jsonb)
    ) AS record FROM operations_outages o WHERE ${where}
    ORDER BY o.started_at DESC,o.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    return {
      routes,
      services: directory.slice(0, 1000),
      serviceDirectoryTruncated: directory.length > 1000,
      incidents: rows.map((r) => r.record),
      page: query.page,
      pageSize: query.pageSize,
      totalCount: Number(count?.total ?? 0),
    };
  });
}
