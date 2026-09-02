import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsConflictError } from './context.js';
import type {
  DunningEvaluationInput,
  DunningEvaluationResult,
  DunningPolicyVersionInput,
  InvoiceDocumentCompleteInput,
  InvoiceDocumentReadInput,
  InvoiceDocumentRequestInput,
  SignedOperationsDatabaseContext,
} from './types.js';

type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface BillingWorkspaceRunItem {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly status: 'prepared' | 'failed' | 'skipped';
  readonly failureCode?: string;
  readonly explanationEn: string;
  readonly explanationAr: string;
  readonly attemptNumber: number;
}

export interface BillingWorkspaceRun {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly retryOfRunId?: string;
  readonly preparedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly requestedAt: string;
  readonly completedAt?: string;
  readonly items: readonly BillingWorkspaceRunItem[];
}

export interface BillingWorkspaceDunningPolicy {
  readonly id: string;
  readonly branchId?: string;
  readonly version: number;
  readonly paymentTermsDays: number;
  readonly reminderAfterDays: number;
  readonly finalNoticeAfterDays: number;
  readonly suspensionReviewAfterDays: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface BillingWorkspaceDunningEvent {
  readonly id: string;
  readonly fromStage?: string;
  readonly toStage: 'reminder' | 'final_notice' | 'suspension_review' | 'resolved';
  readonly daysOverdue: number;
  readonly outstandingMinor: number;
  readonly explanationEn: string;
  readonly explanationAr: string;
  readonly occurredAt: string;
}

export interface BillingWorkspaceDunningCase {
  readonly id: string;
  readonly documentNumber: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly currentStage: 'reminder' | 'final_notice' | 'suspension_review' | 'resolved';
  readonly status: 'open' | 'resolved';
  readonly dueOn: string;
  readonly outstandingMinor: number;
  readonly currency: SupportedCurrency;
  readonly version: number;
  readonly events: readonly BillingWorkspaceDunningEvent[];
}

export interface BillingWorkspaceData {
  readonly runs: readonly BillingWorkspaceRun[];
  readonly dunningPolicies: readonly BillingWorkspaceDunningPolicy[];
  readonly dunningCases: readonly BillingWorkspaceDunningCase[];
  readonly invoiceDocuments: readonly InvoiceDocumentArchive[];
  readonly documentInvoices: readonly { readonly id: string; readonly documentNumber: string }[];
}

export interface InvoiceDocumentArchive {
  readonly id: string;
  readonly invoiceId: string;
  readonly documentNumber: string;
  readonly status: 'pending' | 'ready';
  readonly rendererVersion: string;
  readonly retentionUntil: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly completedAt?: string;
}

export interface InvoiceDocumentRenderSource extends InvoiceDocumentArchive {
  readonly storageKey?: string;
  readonly legalInvoiceSnapshot: unknown;
}

interface AuthorizedBillingRead {
  readonly authorization: SignedOperationsDatabaseContext;
}

export async function readBillingWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedBillingRead,
): Promise<BillingWorkspaceData> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [runs, items, policies, cases, events, documents, invoices] = await Promise.all([
      transaction.execute<RunRow>(sql`
        SELECT run.id,run.period_start,run.period_end,run.status,run.retry_of_run_id,
          run.requested_at,run.completed_at,
          count(item.id) FILTER(WHERE item.status='prepared')::text AS prepared_count,
          count(item.id) FILTER(WHERE item.status='failed')::text AS failed_count,
          count(item.id) FILTER(WHERE item.status='skipped')::text AS skipped_count
        FROM operations_billing_runs run
        LEFT JOIN operations_billing_run_items item
          ON item.tenant_id=run.tenant_id AND item.billing_run_id=run.id
        WHERE run.tenant_id=${tenantId}
        GROUP BY run.id ORDER BY run.requested_at DESC,run.id DESC LIMIT 40
      `),
      transaction.execute<RunItemRow>(sql`
        SELECT item.id,item.billing_run_id,item.service_id,service.service_number,
          subscriber.display_name AS subscriber_name,item.status,item.failure_code,
          item.explanation_en,item.explanation_ar,item.attempt_number
        FROM operations_billing_run_items item
        JOIN operations_services service ON service.tenant_id=item.tenant_id
          AND service.id=item.service_id
        JOIN operations_subscribers subscriber ON subscriber.tenant_id=service.tenant_id
          AND subscriber.id=service.subscriber_id
        WHERE item.tenant_id=${tenantId}
          AND item.billing_run_id IN (
            SELECT id FROM operations_billing_runs WHERE tenant_id=${tenantId}
            ORDER BY requested_at DESC,id DESC LIMIT 40
          )
        ORDER BY item.created_at,item.id
      `),
      transaction.execute<DunningPolicyRow>(sql`
        SELECT id,branch_id,version,payment_terms_days,reminder_after_days,
          final_notice_after_days,suspension_review_after_days,effective_from,effective_to
        FROM operations_dunning_policy_versions
        WHERE tenant_id=${tenantId}
        ORDER BY effective_from DESC,version DESC LIMIT 80
      `),
      transaction.execute<DunningCaseRow>(sql`
        SELECT dunning_case.id,invoice.document_number,service.service_number,
          subscriber.display_name AS subscriber_name,dunning_case.current_stage,
          dunning_case.status,dunning_case.due_on,dunning_case.outstanding_minor::text,
          dunning_case.currency,dunning_case.version
        FROM operations_dunning_cases dunning_case
        JOIN finance_invoices invoice ON invoice.tenant_id=dunning_case.tenant_id
          AND invoice.id=dunning_case.finance_invoice_id
        JOIN operations_services service ON service.tenant_id=dunning_case.tenant_id
          AND service.id=dunning_case.service_id
        JOIN operations_subscribers subscriber ON subscriber.tenant_id=dunning_case.tenant_id
          AND subscriber.id=dunning_case.subscriber_id
        WHERE dunning_case.tenant_id=${tenantId}
        ORDER BY (dunning_case.status='open') DESC,dunning_case.due_on,dunning_case.id LIMIT 250
      `),
      transaction.execute<DunningEventRow>(sql`
        SELECT event.id,event.dunning_case_id,event.from_stage,event.to_stage,event.days_overdue,
          event.outstanding_minor::text,event.explanation_en,event.explanation_ar,event.occurred_at
        FROM operations_dunning_events event
        WHERE event.tenant_id=${tenantId}
          AND event.dunning_case_id IN (
            SELECT id FROM operations_dunning_cases WHERE tenant_id=${tenantId}
            ORDER BY (status='open') DESC,due_on,id LIMIT 250
          )
        ORDER BY event.occurred_at,event.id
      `),
      transaction.execute<InvoiceDocumentRow>(sql`
        SELECT document.id,document.finance_invoice_id,invoice.document_number,document.status,
          document.renderer_version,document.retention_until,document.sha256,
          document.size_bytes::text,document.completed_at
        FROM operations_invoice_documents document
        JOIN finance_invoices invoice ON invoice.tenant_id=document.tenant_id
          AND invoice.id=document.finance_invoice_id
        WHERE document.tenant_id=${tenantId}
        ORDER BY document.created_at DESC,document.id DESC LIMIT 250
      `),
      transaction.execute<{ id: string; document_number: string }>(sql`
        SELECT invoice.id,invoice.document_number FROM operations_invoice_preparations preparation
        JOIN finance_invoices invoice ON invoice.tenant_id=preparation.tenant_id
          AND invoice.id=preparation.finance_invoice_id
        WHERE preparation.tenant_id=${tenantId} AND preparation.posting_status='posted'
          AND preparation.legal_invoice_snapshot IS NOT NULL AND invoice.entry_kind='posted'
        ORDER BY invoice.posted_at DESC,invoice.id DESC LIMIT 250
      `),
    ]);

    const itemsByRun = groupBy(items, (item) => item.billing_run_id);
    const eventsByCase = groupBy(events, (event) => event.dunning_case_id);
    return {
      runs: runs.map((run) => ({
        id: run.id,
        periodStart: date(run.period_start),
        periodEnd: date(run.period_end),
        status: run.status,
        ...(run.retry_of_run_id ? { retryOfRunId: run.retry_of_run_id } : {}),
        preparedCount: count(run.prepared_count),
        failedCount: count(run.failed_count),
        skippedCount: count(run.skipped_count),
        requestedAt: timestamp(run.requested_at),
        ...(run.completed_at ? { completedAt: timestamp(run.completed_at) } : {}),
        items: (itemsByRun.get(run.id) ?? []).map(mapRunItem),
      })),
      dunningPolicies: policies.map((policy) => ({
        id: policy.id,
        ...(policy.branch_id ? { branchId: policy.branch_id } : {}),
        version: policy.version,
        paymentTermsDays: policy.payment_terms_days,
        reminderAfterDays: policy.reminder_after_days,
        finalNoticeAfterDays: policy.final_notice_after_days,
        suspensionReviewAfterDays: policy.suspension_review_after_days,
        effectiveFrom: date(policy.effective_from),
        ...(policy.effective_to ? { effectiveTo: date(policy.effective_to) } : {}),
      })),
      dunningCases: cases.map((dunningCase) => ({
        id: dunningCase.id,
        documentNumber: dunningCase.document_number,
        serviceNumber: dunningCase.service_number,
        subscriberName: dunningCase.subscriber_name,
        currentStage: dunningCase.current_stage,
        status: dunningCase.status,
        dueOn: date(dunningCase.due_on),
        outstandingMinor: minor(dunningCase.outstanding_minor),
        currency: dunningCase.currency,
        version: dunningCase.version,
        events: (eventsByCase.get(dunningCase.id) ?? []).map(mapDunningEvent),
      })),
      invoiceDocuments: documents.map(mapInvoiceDocument),
      documentInvoices: invoices.map((invoice) => ({
        id: invoice.id,
        documentNumber: invoice.document_number,
      })),
    };
  });
}

export const invoiceDocumentRendererVersion = 'orvex-invoice-pdf-v1';

export async function prepareInvoiceDocument(
  database: Database,
  tenantId: VerifiedTenantId,
  input: InvoiceDocumentRequestInput,
): Promise<InvoiceDocumentRenderSource> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const fingerprint = createHash('sha256')
      .update(
        stableJson({ invoiceId: input.invoiceId, rendererVersion: invoiceDocumentRendererVersion }),
      )
      .digest('hex');
    await transaction.execute(sql`
      INSERT INTO operations_invoice_documents(
        tenant_id,finance_invoice_id,invoice_preparation_id,renderer_version,retention_until,
        requested_by,idempotency_key,request_fingerprint)
      SELECT preparation.tenant_id,invoice.id,preparation.id,${invoiceDocumentRendererVersion},
        invoice.posted_at::date+make_interval(years=>(preparation.legal_invoice_snapshot->>'retentionYears')::integer),
        ${input.requestedBy},${input.idempotencyKey},${fingerprint}
      FROM operations_invoice_preparations preparation
      JOIN finance_invoices invoice ON invoice.tenant_id=preparation.tenant_id
        AND invoice.id=preparation.finance_invoice_id AND invoice.entry_kind='posted'
      WHERE preparation.tenant_id=${tenantId} AND invoice.id=${input.invoiceId}
        AND preparation.posting_status='posted' AND preparation.legal_invoice_snapshot IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    const [document] = await transaction.execute<InvoiceDocumentSourceRow>(sql`
      SELECT document.id,document.finance_invoice_id,invoice.document_number,document.status,
        document.renderer_version,document.retention_until,document.sha256,
        document.size_bytes::text,document.completed_at,document.storage_key,
        preparation.legal_invoice_snapshot
      FROM operations_invoice_documents document
      JOIN operations_invoice_preparations preparation ON preparation.tenant_id=document.tenant_id
        AND preparation.id=document.invoice_preparation_id
      JOIN finance_invoices invoice ON invoice.tenant_id=document.tenant_id
        AND invoice.id=document.finance_invoice_id
      WHERE document.tenant_id=${tenantId} AND (
        document.idempotency_key=${input.idempotencyKey}
        OR (document.finance_invoice_id=${input.invoiceId}
          AND document.renderer_version=${invoiceDocumentRendererVersion})
      )
      ORDER BY (document.idempotency_key=${input.idempotencyKey}) DESC LIMIT 1
    `);
    if (!document || document.finance_invoice_id !== input.invoiceId) {
      throw new OperationsConflictError(
        'The invoice is unavailable, lacks a legal snapshot, or the idempotency key belongs elsewhere.',
      );
    }
    return mapInvoiceDocumentSource(document);
  });
}

export async function completeInvoiceDocument(
  database: Database,
  tenantId: VerifiedTenantId,
  input: InvoiceDocumentCompleteInput,
): Promise<InvoiceDocumentArchive> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      UPDATE operations_invoice_documents SET status='ready',storage_key=${input.storageKey},
        sha256=${input.sha256},size_bytes=${input.sizeBytes},content_type='application/pdf',
        completed_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${input.artifactId} AND status='pending'
    `);
    const [document] = await transaction.execute<InvoiceDocumentSourceRow>(sql`
      SELECT document.id,document.finance_invoice_id,invoice.document_number,document.status,
        document.renderer_version,document.retention_until,document.sha256,
        document.size_bytes::text,document.completed_at,document.storage_key
      FROM operations_invoice_documents document
      JOIN finance_invoices invoice ON invoice.tenant_id=document.tenant_id
        AND invoice.id=document.finance_invoice_id
      WHERE document.tenant_id=${tenantId} AND document.id=${input.artifactId}
    `);
    if (
      !document ||
      document.status !== 'ready' ||
      document.sha256 !== input.sha256 ||
      document.storage_key !== input.storageKey ||
      Number(document.size_bytes) !== input.sizeBytes
    ) {
      throw new OperationsConflictError(
        'The invoice document could not be finalized exactly once.',
      );
    }
    return mapInvoiceDocument(document);
  });
}

export async function readInvoiceDocument(
  database: Database,
  tenantId: VerifiedTenantId,
  input: InvoiceDocumentReadInput,
): Promise<{ readonly archive: InvoiceDocumentArchive; readonly storageKey: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [document] = await transaction.execute<InvoiceDocumentSourceRow>(sql`
      SELECT document.id,document.finance_invoice_id,invoice.document_number,document.status,
        document.renderer_version,document.retention_until,document.sha256,
        document.size_bytes::text,document.completed_at,document.storage_key,
        preparation.legal_invoice_snapshot
      FROM operations_invoice_documents document
      JOIN operations_invoice_preparations preparation ON preparation.tenant_id=document.tenant_id
        AND preparation.id=document.invoice_preparation_id
      JOIN finance_invoices invoice ON invoice.tenant_id=document.tenant_id
        AND invoice.id=document.finance_invoice_id
      WHERE document.tenant_id=${tenantId} AND document.id=${input.artifactId}
        AND document.status='ready'
    `);
    if (!document?.storage_key) throw new OperationsConflictError('Invoice document not found.');
    return { archive: mapInvoiceDocument(document), storageKey: document.storage_key };
  });
}

export async function createDunningPolicyVersion(
  database: Database,
  tenantId: VerifiedTenantId,
  input: DunningPolicyVersionInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const fingerprint = policyFingerprint(input);
    const [created] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_dunning_policy_versions(
        tenant_id,branch_id,version,payment_terms_days,reminder_after_days,
        final_notice_after_days,suspension_review_after_days,effective_from,effective_to,
        reason,request_fingerprint,created_by,idempotency_key)
      VALUES(${tenantId},${input.branchId ?? null},${input.version},${input.paymentTermsDays},
        ${input.reminderAfterDays},${input.finalNoticeAfterDays},${input.suspensionReviewAfterDays},
        ${input.effectiveFrom}::date,${input.effectiveTo ?? null}::date,${input.reason},
        ${fingerprint},${input.createdBy},${input.idempotencyKey})
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id
    `);
    if (created) return { id: created.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly request_fingerprint: string;
    }>(sql`
      SELECT id,request_fingerprint FROM operations_dunning_policy_versions
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (!existing || existing.request_fingerprint !== fingerprint) {
      throw new OperationsConflictError('The idempotency key belongs to another dunning policy.');
    }
    return { id: existing.id, replayed: true };
  });
}

export async function evaluateDunning(
  database: Database,
  tenantId: VerifiedTenantId,
  input: DunningEvaluationInput,
): Promise<DunningEvaluationResult> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [run] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_dunning_evaluation_runs(
        tenant_id,as_of_date,scope_branch_ids,scope_area_ids,scope_route_ids,
        requested_by,idempotency_key)
      VALUES(${tenantId},${input.asOfDate}::date,${uuidArray(input.branchIds)},
        ${uuidArray(input.areaIds)},${uuidArray(input.routeIds)},${input.requestedBy},
        ${input.idempotencyKey})
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id
    `);
    if (!run) return replayDunningEvaluation(transaction, tenantId, input);

    const candidates = await transaction.execute<DunningCandidateRow>(sql`
      SELECT invoice.id AS finance_invoice_id,preparation.id AS invoice_preparation_id,
        service.id AS service_id,service.subscriber_id,service.branch_id,service.area_id,
        service.route_id,invoice.document_number,invoice.currency,
        CASE WHEN EXISTS(
          SELECT 1 FROM finance_invoices reversal
          WHERE reversal.tenant_id=invoice.tenant_id
            AND reversal.reverses_invoice_id=invoice.id AND reversal.entry_kind='reversal'
        ) THEN 0 ELSE greatest(invoice.amount_minor-balance.allocated_minor,0) END::text
          AS outstanding_minor,
        dunning_case.id AS dunning_case_id,dunning_case.current_stage,dunning_case.status,
        dunning_case.version AS case_version,
        policy.id AS policy_version_id,policy.version AS policy_version,
        policy.payment_terms_days,policy.reminder_after_days,policy.final_notice_after_days,
        policy.suspension_review_after_days,
        (invoice.posted_at::date+policy.payment_terms_days)::date AS due_on,
        (${input.asOfDate}::date-(invoice.posted_at::date+policy.payment_terms_days))::integer
          AS days_overdue
      FROM operations_invoice_preparations preparation
      JOIN finance_invoices invoice ON invoice.tenant_id=preparation.tenant_id
        AND invoice.id=preparation.finance_invoice_id AND invoice.entry_kind='posted'
      LEFT JOIN LATERAL(
        SELECT coalesce(sum(CASE allocation.entry_kind
          WHEN 'allocation' THEN allocation.amount_minor ELSE -allocation.amount_minor END),0)::bigint
          AS allocated_minor
        FROM finance_payment_allocations allocation
        WHERE allocation.tenant_id=invoice.tenant_id AND allocation.invoice_id=invoice.id
      ) balance ON true
      JOIN operations_services service ON service.tenant_id=preparation.tenant_id
        AND service.id=preparation.service_id
      LEFT JOIN operations_dunning_cases dunning_case ON dunning_case.tenant_id=invoice.tenant_id
        AND dunning_case.finance_invoice_id=invoice.id
      JOIN LATERAL(
        SELECT policy_version.* FROM operations_dunning_policy_versions policy_version
        WHERE policy_version.tenant_id=service.tenant_id
          AND (policy_version.branch_id=service.branch_id OR policy_version.branch_id IS NULL)
          AND policy_version.effective_from<=invoice.posted_at::date
          AND (policy_version.effective_to IS NULL
            OR policy_version.effective_to>invoice.posted_at::date)
          AND (dunning_case.policy_version_id IS NULL
            OR policy_version.id=dunning_case.policy_version_id)
        ORDER BY (policy_version.branch_id IS NOT NULL) DESC,policy_version.version DESC LIMIT 1
      ) policy ON true
      WHERE preparation.tenant_id=${tenantId} AND preparation.posting_status='posted'
        AND (${uuidArray(input.branchIds)} IS NULL OR service.branch_id=ANY(${uuidArray(input.branchIds)}))
        AND (${uuidArray(input.areaIds)} IS NULL OR service.area_id=ANY(${uuidArray(input.areaIds)}))
        AND (${uuidArray(input.routeIds)} IS NULL OR service.route_id=ANY(${uuidArray(input.routeIds)}))
        AND (dunning_case.status='open' OR (
          NOT EXISTS(
            SELECT 1 FROM finance_invoices reversal
            WHERE reversal.tenant_id=invoice.tenant_id
              AND reversal.reverses_invoice_id=invoice.id AND reversal.entry_kind='reversal'
          )
          AND invoice.amount_minor>balance.allocated_minor
          AND ${input.asOfDate}::date>=(invoice.posted_at::date+policy.payment_terms_days
            +policy.reminder_after_days)
        ))
      ORDER BY invoice.posted_at,invoice.id
    `);

    let advancedCount = 0;
    let resolvedCount = 0;
    for (const candidate of candidates) {
      const outstandingMinor = minor(candidate.outstanding_minor);
      if (candidate.dunning_case_id && outstandingMinor === 0 && candidate.status === 'open') {
        await resolveDunningCase(transaction, tenantId, run.id, input, candidate);
        resolvedCount += 1;
        continue;
      }
      if (outstandingMinor === 0) continue;
      const targetStage = dunningStage(candidate);
      if (!candidate.dunning_case_id) {
        await openDunningCase(transaction, tenantId, run.id, input, candidate, targetStage);
        advancedCount += 1;
      } else if (stageRank(targetStage) > stageRank(candidate.current_stage ?? 'reminder')) {
        await advanceDunningCase(transaction, tenantId, run.id, input, candidate, targetStage);
        advancedCount += 1;
      } else {
        await transaction.execute(sql`
          UPDATE operations_dunning_cases SET outstanding_minor=${outstandingMinor},
            last_evaluated_at=clock_timestamp()
          WHERE tenant_id=${tenantId} AND id=${candidate.dunning_case_id}
        `);
      }
    }
    const [completed] = await transaction.execute<EvaluationRunRow>(sql`
      UPDATE operations_dunning_evaluation_runs SET status='succeeded',
        evaluated_count=${candidates.length},advanced_count=${advancedCount},
        resolved_count=${resolvedCount},completed_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${run.id}
      RETURNING id,status,evaluated_count,advanced_count,resolved_count
    `);
    if (!completed) throw new Error('Unable to complete the dunning evaluation.');
    return mapEvaluationRun(completed, false);
  });
}

async function openDunningCase(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  evaluationRunId: string,
  input: DunningEvaluationInput,
  candidate: DunningCandidateRow,
  stage: DunningStage,
): Promise<void> {
  const [created] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO operations_dunning_cases(
      tenant_id,finance_invoice_id,invoice_preparation_id,service_id,subscriber_id,
      policy_version_id,branch_id,area_id,route_id,due_on,current_stage,status,
      outstanding_minor,currency)
    VALUES(${tenantId},${candidate.finance_invoice_id},${candidate.invoice_preparation_id},
      ${candidate.service_id},${candidate.subscriber_id},${candidate.policy_version_id},
      ${candidate.branch_id},${candidate.area_id},${candidate.route_id},${date(candidate.due_on)},
      ${stage},'open',${minor(candidate.outstanding_minor)},${candidate.currency})
    RETURNING id
  `);
  if (!created) throw new Error('Unable to open the dunning case.');
  await insertDunningEvent(
    transaction,
    tenantId,
    evaluationRunId,
    input,
    candidate,
    created.id,
    null,
    stage,
  );
}

async function advanceDunningCase(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  evaluationRunId: string,
  input: DunningEvaluationInput,
  candidate: DunningCandidateRow,
  stage: DunningStage,
): Promise<void> {
  await transaction.execute(sql`
    UPDATE operations_dunning_cases SET current_stage=${stage},
      outstanding_minor=${minor(candidate.outstanding_minor)},version=version+1,
      last_evaluated_at=clock_timestamp()
    WHERE tenant_id=${tenantId} AND id=${candidate.dunning_case_id}
  `);
  await insertDunningEvent(
    transaction,
    tenantId,
    evaluationRunId,
    input,
    candidate,
    candidate.dunning_case_id ?? '',
    candidate.current_stage,
    stage,
  );
}

async function resolveDunningCase(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  evaluationRunId: string,
  input: DunningEvaluationInput,
  candidate: DunningCandidateRow,
): Promise<void> {
  await transaction.execute(sql`
    UPDATE operations_dunning_cases SET current_stage='resolved',status='resolved',
      outstanding_minor=0,version=version+1,last_evaluated_at=clock_timestamp(),
      resolved_at=clock_timestamp()
    WHERE tenant_id=${tenantId} AND id=${candidate.dunning_case_id}
  `);
  await insertDunningEvent(
    transaction,
    tenantId,
    evaluationRunId,
    input,
    candidate,
    candidate.dunning_case_id ?? '',
    candidate.current_stage,
    'resolved',
  );
}

async function insertDunningEvent(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  evaluationRunId: string,
  input: DunningEvaluationInput,
  candidate: DunningCandidateRow,
  dunningCaseId: string,
  fromStage: string | null,
  toStage: DunningStage | 'resolved',
): Promise<void> {
  const resolved = toStage === 'resolved';
  const explanationEn = resolved
    ? `Invoice ${candidate.document_number} is fully allocated; the dunning case is resolved.`
    : `Invoice ${candidate.document_number} reached ${toStage.replaceAll('_', ' ')} after ${candidate.days_overdue} overdue days.`;
  const explanationAr = resolved
    ? `تم تخصيص كامل قيمة الفاتورة ${candidate.document_number} وإغلاق حالة المتابعة.`
    : `بلغت الفاتورة ${candidate.document_number} مرحلة ${arabicStage(toStage)} بعد ${candidate.days_overdue} يوماً من التأخر.`;
  await transaction.execute(sql`
    INSERT INTO operations_dunning_events(
      tenant_id,dunning_case_id,evaluation_run_id,from_stage,to_stage,days_overdue,
      outstanding_minor,currency,explanation_en,explanation_ar,policy_snapshot,actor_id)
    VALUES(${tenantId},${dunningCaseId},${evaluationRunId},${fromStage},${toStage},
      ${candidate.days_overdue},${resolved ? 0 : minor(candidate.outstanding_minor)},
      ${candidate.currency},${explanationEn},${explanationAr},${JSON.stringify({
        policyVersionId: candidate.policy_version_id,
        version: candidate.policy_version,
        paymentTermsDays: candidate.payment_terms_days,
        reminderAfterDays: candidate.reminder_after_days,
        finalNoticeAfterDays: candidate.final_notice_after_days,
        suspensionReviewAfterDays: candidate.suspension_review_after_days,
        asOfDate: input.asOfDate,
        dueOn: date(candidate.due_on),
      })}::jsonb,${input.requestedBy})
  `);
}

async function replayDunningEvaluation(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  input: DunningEvaluationInput,
): Promise<DunningEvaluationResult> {
  const [run] = await transaction.execute<EvaluationReplayRow>(sql`
    SELECT id,status,evaluated_count,advanced_count,resolved_count,as_of_date,
      requested_by,scope_branch_ids,scope_area_ids,scope_route_ids
    FROM operations_dunning_evaluation_runs
    WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
  `);
  if (
    !run ||
    run.status !== 'succeeded' ||
    date(run.as_of_date) !== input.asOfDate ||
    run.requested_by !== input.requestedBy ||
    stableJson(run.scope_branch_ids ?? undefined) !== stableJson(input.branchIds) ||
    stableJson(run.scope_area_ids ?? undefined) !== stableJson(input.areaIds) ||
    stableJson(run.scope_route_ids ?? undefined) !== stableJson(input.routeIds)
  ) {
    throw new OperationsConflictError('The idempotency key belongs to another dunning evaluation.');
  }
  return mapEvaluationRun(run, true);
}

function dunningStage(candidate: DunningCandidateRow): DunningStage {
  if (candidate.days_overdue >= candidate.suspension_review_after_days) return 'suspension_review';
  if (candidate.days_overdue >= candidate.final_notice_after_days) return 'final_notice';
  return 'reminder';
}

function stageRank(stage: string): number {
  return { reminder: 1, final_notice: 2, suspension_review: 3, resolved: 4 }[stage] ?? 0;
}

function arabicStage(stage: DunningStage): string {
  return {
    reminder: 'التذكير',
    final_notice: 'الإنذار النهائي',
    suspension_review: 'مراجعة التعليق',
  }[stage];
}

function policyFingerprint(input: DunningPolicyVersionInput): string {
  return createHash('sha256')
    .update(
      stableJson({
        branchId: input.branchId,
        version: input.version,
        paymentTermsDays: input.paymentTermsDays,
        reminderAfterDays: input.reminderAfterDays,
        finalNoticeAfterDays: input.finalNoticeAfterDays,
        suspensionReviewAfterDays: input.suspensionReviewAfterDays,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        reason: input.reason,
      }),
    )
    .digest('hex');
}

function uuidArray(values: readonly string[] | undefined): SQL {
  if (values === undefined) return sql`NULL::uuid[]`;
  if (values.length === 0) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`,`,
  )}]::uuid[]`;
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function mapRunItem(item: RunItemRow): BillingWorkspaceRunItem {
  return {
    id: item.id,
    serviceId: item.service_id,
    serviceNumber: item.service_number,
    subscriberName: item.subscriber_name,
    status: item.status,
    ...(item.failure_code ? { failureCode: item.failure_code } : {}),
    explanationEn: item.explanation_en,
    explanationAr: item.explanation_ar,
    attemptNumber: item.attempt_number,
  };
}

function mapDunningEvent(event: DunningEventRow): BillingWorkspaceDunningEvent {
  return {
    id: event.id,
    ...(event.from_stage ? { fromStage: event.from_stage } : {}),
    toStage: event.to_stage,
    daysOverdue: event.days_overdue,
    outstandingMinor: minor(event.outstanding_minor),
    explanationEn: event.explanation_en,
    explanationAr: event.explanation_ar,
    occurredAt: timestamp(event.occurred_at),
  };
}

function mapInvoiceDocument(document: InvoiceDocumentRow): InvoiceDocumentArchive {
  return {
    id: document.id,
    invoiceId: document.finance_invoice_id,
    documentNumber: document.document_number,
    status: document.status,
    rendererVersion: document.renderer_version,
    retentionUntil: date(document.retention_until),
    ...(document.sha256 ? { sha256: document.sha256 } : {}),
    ...(document.size_bytes ? { sizeBytes: count(document.size_bytes) } : {}),
    ...(document.completed_at ? { completedAt: timestamp(document.completed_at) } : {}),
  };
}

function mapInvoiceDocumentSource(document: InvoiceDocumentSourceRow): InvoiceDocumentRenderSource {
  return {
    ...mapInvoiceDocument(document),
    ...(document.storage_key ? { storageKey: document.storage_key } : {}),
    legalInvoiceSnapshot: document.legal_invoice_snapshot,
  };
}

function mapEvaluationRun(run: EvaluationRunRow, replayed: boolean): DunningEvaluationResult {
  return {
    id: run.id,
    status: 'succeeded',
    evaluatedCount: run.evaluated_count,
    advancedCount: run.advanced_count,
    resolvedCount: run.resolved_count,
    replayed,
  };
}

function count(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new RangeError('Count exceeds safe range.');
  return parsed;
}

function minor(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new RangeError('Money exceeds safe range.');
  return parsed;
}

function date(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function timestamp(value: Date | string): string {
  return new Date(value).toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

type DunningStage = 'reminder' | 'final_notice' | 'suspension_review';

interface RunRow extends Record<string, unknown> {
  readonly id: string;
  readonly period_start: Date | string;
  readonly period_end: Date | string;
  readonly status: BillingWorkspaceRun['status'];
  readonly retry_of_run_id: string | null;
  readonly prepared_count: string;
  readonly failed_count: string;
  readonly skipped_count: string;
  readonly requested_at: Date | string;
  readonly completed_at: Date | string | null;
}

interface RunItemRow extends Record<string, unknown> {
  readonly id: string;
  readonly billing_run_id: string;
  readonly service_id: string;
  readonly service_number: string;
  readonly subscriber_name: string;
  readonly status: BillingWorkspaceRunItem['status'];
  readonly failure_code: string | null;
  readonly explanation_en: string;
  readonly explanation_ar: string;
  readonly attempt_number: number;
}

interface DunningPolicyRow extends Record<string, unknown> {
  readonly id: string;
  readonly branch_id: string | null;
  readonly version: number;
  readonly payment_terms_days: number;
  readonly reminder_after_days: number;
  readonly final_notice_after_days: number;
  readonly suspension_review_after_days: number;
  readonly effective_from: Date | string;
  readonly effective_to: Date | string | null;
}

interface InvoiceDocumentRow extends Record<string, unknown> {
  readonly id: string;
  readonly finance_invoice_id: string;
  readonly document_number: string;
  readonly status: InvoiceDocumentArchive['status'];
  readonly renderer_version: string;
  readonly retention_until: Date | string;
  readonly sha256: string | null;
  readonly size_bytes: string | null;
  readonly completed_at: Date | string | null;
}

interface InvoiceDocumentSourceRow extends InvoiceDocumentRow {
  readonly storage_key: string | null;
  readonly legal_invoice_snapshot: unknown;
}

interface DunningCaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly document_number: string;
  readonly service_number: string;
  readonly subscriber_name: string;
  readonly current_stage: BillingWorkspaceDunningCase['currentStage'];
  readonly status: BillingWorkspaceDunningCase['status'];
  readonly due_on: Date | string;
  readonly outstanding_minor: string;
  readonly currency: SupportedCurrency;
  readonly version: number;
}

interface DunningEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly dunning_case_id: string;
  readonly from_stage: string | null;
  readonly to_stage: BillingWorkspaceDunningEvent['toStage'];
  readonly days_overdue: number;
  readonly outstanding_minor: string;
  readonly explanation_en: string;
  readonly explanation_ar: string;
  readonly occurred_at: Date | string;
}

interface DunningCandidateRow extends Record<string, unknown> {
  readonly finance_invoice_id: string;
  readonly invoice_preparation_id: string;
  readonly service_id: string;
  readonly subscriber_id: string;
  readonly branch_id: string;
  readonly area_id: string;
  readonly route_id: string;
  readonly document_number: string;
  readonly currency: SupportedCurrency;
  readonly outstanding_minor: string;
  readonly dunning_case_id: string | null;
  readonly current_stage: DunningStage | null;
  readonly status: 'open' | 'resolved' | null;
  readonly case_version: number | null;
  readonly policy_version_id: string;
  readonly policy_version: number;
  readonly payment_terms_days: number;
  readonly reminder_after_days: number;
  readonly final_notice_after_days: number;
  readonly suspension_review_after_days: number;
  readonly due_on: Date | string;
  readonly days_overdue: number;
}

interface EvaluationRunRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: 'succeeded';
  readonly evaluated_count: number;
  readonly advanced_count: number;
  readonly resolved_count: number;
}

interface EvaluationReplayRow extends EvaluationRunRow {
  readonly as_of_date: Date | string;
  readonly requested_by: string;
  readonly scope_branch_ids: readonly string[] | null;
  readonly scope_area_ids: readonly string[] | null;
  readonly scope_route_ids: readonly string[] | null;
}
