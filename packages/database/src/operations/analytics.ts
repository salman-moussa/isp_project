import {
  reportExportSchema,
  reportKeys,
  reportQuerySchema,
  type DashboardSnapshot,
  type ReportDataset,
  type ReportExportCommand,
  type ReportExportJob,
  type ReportKey,
  type ReportQuery,
  type ReportsWorkspace,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

const timestamp = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.toISOString();

const windowedReports = new Set<ReportKey>([
  'collections_daily',
  'ticket_sla',
  'incidents',
  'notification_delivery',
]);

export async function readDashboardSnapshot(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<DashboardSnapshot> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: DashboardSnapshot }>(
      sql`SELECT read_dashboard_snapshot() AS result`,
    );
    if (!row) throw new Error('Dashboard snapshot returned no result.');
    return row.result;
  });
}

export async function readReportDataset(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly key: ReportKey;
    readonly query?: Partial<ReportQuery>;
  },
): Promise<ReportDataset> {
  if (!reportKeys.includes(input.key)) throw new OperationsAuthorizationError('Unknown report.');
  const query = reportQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: ReportDataset }>(
      sql`SELECT read_report_dataset(${input.key}, ${JSON.stringify(query)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Report dataset returned no result.');
    return row.result;
  });
}

/** Records a completed export (the CSV itself is rendered by the caller from the dataset). */
export async function recordReportExport(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: ReportExportCommand;
    readonly rows: number;
  },
): Promise<{ jobId: string; status: string; replayed?: boolean }> {
  const command = reportExportSchema.parse(input.command);
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const filters = {
      ...(command.from ? { from: command.from } : {}),
      ...(command.to ? { to: command.to } : {}),
    };
    const [row] = await tx.execute<{
      result: { jobId: string; status: string; replayed?: boolean };
    }>(
      sql`SELECT record_report_export(${command.key}, ${JSON.stringify(filters)}::jsonb, ${command.format}, ${input.rows}) AS result`,
    );
    if (!row) throw new Error('Report export returned no result.');
    return row.result;
  });
}

export async function readReportsWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<ReportsWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      valid: boolean;
    }>(sql`SELECT true AS valid FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND action='tenant.report.workspace.read' AND support_grant_id IS NULL
        AND permission IN ('tenant.report.view','tenant.report.export')`);
    if (!authority) throw new OperationsAuthorizationError('Report view authority required.');
    const exports = await tx.execute<{
      id: string;
      report_key: string;
      format: string;
      status: string;
      storage_reference: string | null;
      requested_by: string;
      requested_at: Date | string;
      completed_at: Date | string | null;
    }>(sql`SELECT e.id, e.report_key, e.format, e.status::text AS status, e.storage_reference,
        coalesce(u.display_name, e.requested_by) AS requested_by, e.requested_at, e.completed_at
      FROM operations_export_jobs e LEFT JOIN users u ON u.id::text = e.requested_by
      WHERE e.tenant_id=${tenantId} ORDER BY e.requested_at DESC, e.id LIMIT 50`);
    return {
      catalogue: reportKeys.map((key) => ({ key, windowed: windowedReports.has(key) })),
      exports: exports.map((row): ReportExportJob => {
        const match = /^inline:(\d+) rows$/u.exec(row.storage_reference ?? '');
        return {
          id: row.id,
          reportKey: row.report_key,
          format: row.format,
          status: row.status,
          rows: match ? Number(match[1]) : null,
          requestedBy: row.requested_by,
          requestedAt: timestamp(row.requested_at) ?? '',
          completedAt: timestamp(row.completed_at),
        };
      }),
    };
  });
}

/** Deterministic CSV rendering: union of row keys in first-seen order, RFC 4180 quoting. */
export function renderCsv(rows: readonly Record<string, unknown>[]): string {
  const columns: string[] = [];
  for (const row of rows)
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const cell = (value: unknown) => {
    const text =
      value === null || value === undefined
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
            ? String(value)
            : JSON.stringify(value);
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return (
    [
      columns.join(','),
      ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
    ].join('\r\n') + '\r\n'
  );
}
