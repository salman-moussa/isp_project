import {
  type AlarmRecord,
  type OutageRecord,
  type QosReportRecord,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
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
    readonly titleEn: string;
    readonly titleAr: string;
    readonly affectedRegion: string;
    readonly impactedSubscribersCount: number;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [outage] = await transaction.execute<{ id: string }>(sql`
      INSERT INTO operations_outages (
        tenant_id, outage_title_en, outage_title_ar, affected_region,
        impacted_subscribers_count, started_at, status
      ) VALUES (
        ${tenantId}, ${input.titleEn}, ${input.titleAr}, ${input.affectedRegion},
        ${input.impactedSubscribersCount}, clock_timestamp(), 'investigating'
      )
      RETURNING id
    `);

    if (!outage) throw new Error('Failed to create outage incident.');
    return { id: outage.id, status: 'investigating' };
  });
}

export async function resolveOutageIncident(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly outageId: string;
    readonly rootCauseEn: string;
    readonly rootCauseAr: string;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      UPDATE operations_outages
      SET status = 'resolved', resolved_at = clock_timestamp(),
          root_cause_en = ${input.rootCauseEn}, root_cause_ar = ${input.rootCauseAr}
      WHERE tenant_id = ${tenantId} AND id = ${input.outageId}
    `);

    return { id: input.outageId, status: 'resolved' };
  });
}
