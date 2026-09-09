import {
  assuranceCommandSchema,
  assuranceQuerySchema,
  type AssuranceCase,
  type AssuranceCommand,
  type AssuranceFinding,
  type AssuranceQuery,
  type AssuranceRun,
  type AssuranceWorkspace,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

const timestamp = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.toISOString();

export async function executeAssuranceCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: AssuranceCommand;
  },
): Promise<Record<string, unknown>> {
  const command = assuranceCommandSchema.parse(input.command);
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: Record<string, unknown> }>(
      sql`SELECT execute_assurance_command(${JSON.stringify(command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Revenue assurance command returned no result.');
    return row.result;
  });
}

export async function readAssuranceWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<AssuranceQuery>;
  },
): Promise<AssuranceWorkspace> {
  const query = assuranceQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    // Verifies the read authority and enables the finance row policies for this transaction.
    await tx.execute(sql`SELECT assurance_prepare_read()`);
    const runs = await tx.execute<{
      id: string;
      requested_by: string;
      started_at: Date | string;
      completed_at: Date | string | null;
      summary: AssuranceRun['summary'];
    }>(sql`SELECT r.id, coalesce(u.display_name, r.requested_by::text) AS requested_by, r.started_at, r.completed_at, r.summary
      FROM operations_assurance_runs r LEFT JOIN users u ON u.id=r.requested_by
      WHERE r.tenant_id=${tenantId} ORDER BY r.started_at DESC, r.id LIMIT 20`);
    const findings = await tx.execute<{
      id: string;
      control_code: AssuranceFinding['controlCode'];
      subject_type: AssuranceFinding['subjectType'];
      subject_id: string;
      subject_reference: string;
      subscriber_id: string | null;
      subscriber_name: string | null;
      branch_id: string | null;
      currency: 'USD' | 'LBP' | null;
      exposure_minor: string;
      details: Record<string, unknown>;
      status: AssuranceFinding['status'];
      acknowledgement_note: string | null;
      acknowledged_by: string | null;
      case_id: string | null;
      case_number: string | null;
      first_seen_at: Date | string;
      last_seen_at: Date | string;
      cleared_at: Date | string | null;
      resolved_at: Date | string | null;
      version: number;
    }>(sql`SELECT f.id, f.control_code, f.subject_type, f.subject_id, f.subject_reference, f.subscriber_id, s.display_name AS subscriber_name,
        f.branch_id, f.currency, f.exposure_minor::text, f.details, f.status, f.acknowledgement_note, u.display_name AS acknowledged_by,
        f.case_id, c.case_number, f.first_seen_at, f.last_seen_at, f.cleared_at, f.resolved_at, f.version
      FROM operations_assurance_findings f
      LEFT JOIN operations_subscribers s ON s.tenant_id=f.tenant_id AND s.id=f.subscriber_id
      LEFT JOIN users u ON u.id=f.acknowledged_by
      LEFT JOIN operations_assurance_cases c ON c.tenant_id=f.tenant_id AND c.id=f.case_id
      WHERE f.tenant_id=${tenantId}
        AND (${query.findings}='all' OR f.status IN ('open','acknowledged'))
        AND (${query.control ?? null}::text IS NULL OR f.control_code=${query.control ?? null})
      ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
        f.exposure_minor DESC, f.last_seen_at DESC, f.id LIMIT 500`);
    const cases = await tx.execute<{
      id: string;
      case_number: string;
      title_en: string;
      title_ar: string;
      status: AssuranceCase['status'];
      owner_user_id: string | null;
      owner_name: string | null;
      opened_by: string;
      opened_at: Date | string;
      closed_at: Date | string | null;
      resolution_en: string | null;
      resolution_ar: string | null;
      resolution_evidence: string | null;
      findings: string;
      exposure_usd: string;
      exposure_lbp: string;
      version: number;
    }>(sql`SELECT c.id, c.case_number, c.title_en, c.title_ar, c.status, c.owner_user_id, o.display_name AS owner_name,
        coalesce(b.display_name, c.opened_by::text) AS opened_by, c.opened_at, c.closed_at, c.resolution_en, c.resolution_ar,
        c.resolution_evidence, c.version,
        (SELECT count(*) FROM operations_assurance_findings f WHERE f.tenant_id=c.tenant_id AND f.case_id=c.id)::text AS findings,
        (SELECT coalesce(sum(f.exposure_minor),0) FROM operations_assurance_findings f WHERE f.tenant_id=c.tenant_id AND f.case_id=c.id AND f.currency='USD')::text AS exposure_usd,
        (SELECT coalesce(sum(f.exposure_minor),0) FROM operations_assurance_findings f WHERE f.tenant_id=c.tenant_id AND f.case_id=c.id AND f.currency='LBP')::text AS exposure_lbp
      FROM operations_assurance_cases c LEFT JOIN users o ON o.id=c.owner_user_id LEFT JOIN users b ON b.id=c.opened_by
      WHERE c.tenant_id=${tenantId}
      ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, c.opened_at DESC, c.id LIMIT 200`);
    const members = await tx.execute<{ userId: string; name: string }>(
      sql`SELECT m.user_id AS "userId", u.display_name AS name FROM tenant_memberships m JOIN users u ON u.id=m.user_id
          WHERE m.tenant_id=${tenantId} ORDER BY u.display_name, m.user_id LIMIT 500`,
    );
    const [summary] = await tx.execute<{
      open_findings: string;
      acknowledged_findings: string;
      open_cases: string;
      exposure_usd: string;
      exposure_lbp: string;
    }>(sql`SELECT
      (SELECT count(*) FROM operations_assurance_findings f WHERE f.tenant_id=${tenantId} AND f.status='open')::text AS open_findings,
      (SELECT count(*) FROM operations_assurance_findings f WHERE f.tenant_id=${tenantId} AND f.status='acknowledged')::text AS acknowledged_findings,
      (SELECT count(*) FROM operations_assurance_cases c WHERE c.tenant_id=${tenantId} AND c.status IN ('open','investigating'))::text AS open_cases,
      (SELECT coalesce(sum(f.exposure_minor),0) FROM operations_assurance_findings f WHERE f.tenant_id=${tenantId} AND f.status IN ('open','acknowledged') AND f.currency='USD')::text AS exposure_usd,
      (SELECT coalesce(sum(f.exposure_minor),0) FROM operations_assurance_findings f WHERE f.tenant_id=${tenantId} AND f.status IN ('open','acknowledged') AND f.currency='LBP')::text AS exposure_lbp`);
    const mappedRuns = runs.map(
      (row): AssuranceRun => ({
        id: row.id,
        requestedBy: row.requested_by,
        startedAt: timestamp(row.started_at) ?? '',
        completedAt: timestamp(row.completed_at),
        summary: row.summary,
      }),
    );
    return {
      latestRun: mappedRuns[0] ?? null,
      runs: mappedRuns,
      findings: findings.map(
        (row): AssuranceFinding => ({
          id: row.id,
          controlCode: row.control_code,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          subjectReference: row.subject_reference,
          subscriberId: row.subscriber_id,
          subscriberName: row.subscriber_name,
          branchId: row.branch_id,
          currency: row.currency,
          exposureMinor: Number(row.exposure_minor),
          details: row.details,
          status: row.status,
          acknowledgementNote: row.acknowledgement_note,
          acknowledgedBy: row.acknowledged_by,
          caseId: row.case_id,
          caseNumber: row.case_number,
          firstSeenAt: timestamp(row.first_seen_at) ?? '',
          lastSeenAt: timestamp(row.last_seen_at) ?? '',
          clearedAt: timestamp(row.cleared_at),
          resolvedAt: timestamp(row.resolved_at),
          version: Number(row.version),
        }),
      ),
      cases: cases.map(
        (row): AssuranceCase => ({
          id: row.id,
          caseNumber: row.case_number,
          titleEn: row.title_en,
          titleAr: row.title_ar,
          status: row.status,
          ownerUserId: row.owner_user_id,
          ownerName: row.owner_name,
          openedBy: row.opened_by,
          openedAt: timestamp(row.opened_at) ?? '',
          closedAt: timestamp(row.closed_at),
          resolutionEn: row.resolution_en,
          resolutionAr: row.resolution_ar,
          resolutionEvidence: row.resolution_evidence,
          findings: Number(row.findings),
          exposureUsdMinor: Number(row.exposure_usd),
          exposureLbpMinor: Number(row.exposure_lbp),
          version: Number(row.version),
        }),
      ),
      members: [...members],
      summary: {
        openFindings: Number(summary?.open_findings ?? 0),
        acknowledgedFindings: Number(summary?.acknowledged_findings ?? 0),
        openCases: Number(summary?.open_cases ?? 0),
        exposureUsdMinor: Number(summary?.exposure_usd ?? 0),
        exposureLbpMinor: Number(summary?.exposure_lbp ?? 0),
      },
    };
  });
}
