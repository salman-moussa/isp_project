import type { VerifiedTenantId } from '@isp/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type {
  BillingRunResult,
  BillingPolicyVersionInput,
  CollectorAssignmentInput,
  CollectorEvidenceInput,
  CollectorReconciliationInput,
  CreateIssueInput,
  CreateSubscriberRecord,
  ExportJobInput,
  InstallationTransitionInput,
  IssueTransitionInput,
  NetworkActionInput,
  OfficePaymentRequestInput,
  OperationsConfigurationInput,
  PaymentCorrectionInput,
  PlanVersionInput,
  PrepareBillingRunInput,
  ServiceInstallationInput,
  SubscriberRecord,
} from './types.js';

type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function uuidArray(values: readonly string[] | undefined): SQL {
  if (values === undefined) return sql`NULL::uuid[]`;
  return values.length === 0
    ? sql`ARRAY[]::uuid[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}::uuid`),
        sql`,`,
      )}]::uuid[]`;
}

export class OperationsIdempotencyConflictError extends Error {
  public readonly code = 'OPERATIONS_IDEMPOTENCY_CONFLICT';
  public constructor() {
    super('The idempotency key was already used for different operations data.');
    this.name = 'OperationsIdempotencyConflictError';
  }
}

export class PlatformSubscriptionNetworkRestrictionError extends Error {
  public readonly code = 'PLATFORM_SUBSCRIPTION_NETWORK_RESTRICTION';
  public constructor() {
    super('The platform subscription does not permit new subscriber network work.');
    this.name = 'PlatformSubscriptionNetworkRestrictionError';
  }
}

interface SubscriberRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly tenant_id: string;
  readonly subscriber_number: string;
  readonly display_name: string;
  readonly status: SubscriberRecord['status'];
  readonly household_id: string;
  readonly primary_location_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
}

export async function createSubscriber(
  database: Database,
  tenantId: VerifiedTenantId,
  input: CreateSubscriberRecord,
): Promise<SubscriberRecord> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.idempotencyKey}`}, 0))
    `);
    const [existing] = await transaction.execute<SubscriberRow>(sql`
      SELECT * FROM operations_subscribers
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (existing) return assertSubscriberReplay(existing, input);

    const [insertedHousehold] = await transaction.execute<{
      readonly id: string;
      readonly branch_id: string;
      readonly display_name: string;
    }>(sql`
      INSERT INTO operations_households(tenant_id, branch_id, reference_code, display_name)
      VALUES (${tenantId}, ${input.branchId}, ${input.householdReference}, ${input.householdName})
      ON CONFLICT (tenant_id, reference_code) DO NOTHING
      RETURNING id, branch_id, display_name
    `);
    const household =
      insertedHousehold ??
      (
        await transaction.execute<{
          readonly id: string;
          readonly branch_id: string;
          readonly display_name: string;
        }>(sql`
      SELECT id, branch_id, display_name FROM operations_households
      WHERE tenant_id = ${tenantId} AND reference_code = ${input.householdReference}
      FOR SHARE
    `)
      )[0];
    if (!household) throw new Error('Unable to create the subscriber household.');
    if (
      household.branch_id !== undefined &&
      (household.branch_id !== input.branchId || household.display_name !== input.householdName)
    )
      throw new OperationsIdempotencyConflictError();
    const [location] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_locations
        (tenant_id, household_id, branch_id, area_id, route_id, label, area_code, address_line)
      VALUES
        (${tenantId}, ${household.id}, ${input.branchId}, ${input.areaId}, ${input.routeId},
         ${input.locationLabel}, ${input.areaCode ?? null}, ${input.addressLine})
      RETURNING id
    `);
    if (!location) throw new Error('Unable to create the subscriber location.');
    const [subscriber] = await transaction.execute<SubscriberRow>(sql`
      INSERT INTO operations_subscribers
        (tenant_id, subscriber_number, idempotency_key, request_fingerprint, household_id, primary_location_id,
         display_name, branch_id, area_id, route_id)
      VALUES
        (${tenantId}, ${input.subscriberNumber}, ${input.idempotencyKey}, ${subscriberFingerprint(input)}, ${household.id},
         ${location.id}, ${input.displayName}, ${input.branchId}, ${input.areaId}, ${input.routeId})
      RETURNING *
    `);
    if (!subscriber) throw new Error('Unable to create the subscriber.');
    if (input.primaryPhone) {
      await transaction.execute(sql`
        INSERT INTO operations_contacts
          (tenant_id, subscriber_id, contact_kind, contact_value, label, is_primary)
        VALUES (${tenantId}, ${subscriber.id}, 'phone', ${input.primaryPhone}, 'primary', true)
      `);
    }
    return mapSubscriber(subscriber);
  });
}

export async function prepareRecurringInvoices(
  database: Database,
  tenantId: VerifiedTenantId,
  input: PrepareBillingRunInput,
): Promise<BillingRunResult> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    if (input.retryOfRunId) {
      await assertBillingRetrySource(transaction, tenantId, input);
    }
    const [run] = await transaction.execute<{
      readonly id: string;
      readonly tenant_id: string;
      readonly status: BillingRunResult['status'];
      readonly idempotency_key: string;
      readonly period_start: string | Date;
      readonly period_end: string | Date;
      readonly requested_by: string;
    }>(sql`
      INSERT INTO operations_billing_runs
        (tenant_id, idempotency_key, period_start, period_end, requested_by,
         scope_branch_ids, scope_area_ids, scope_route_ids, retry_of_run_id, status)
      VALUES
        (${tenantId}, ${input.idempotencyKey}, ${input.periodStart}::date, ${input.periodEnd}::date,
         ${input.requestedBy}, ${uuidArray(input.branchIds)}, ${uuidArray(input.areaIds)},
         ${uuidArray(input.routeIds)}, ${input.retryOfRunId ?? null}, 'running')
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING *
    `);
    if (!run) return replayBillingRun(transaction, tenantId, input);
    await transaction.execute(sql`
      WITH source AS (
        SELECT s.tenant_id,s.id AS service_id,s.branch_id,s.area_id,s.route_id,due.billing_date,
          pv.id AS plan_version_id,pv.version AS plan_version,pv.recurring_amount_minor,
          pv.currency,pv.billing_interval_months,pv.access_technology,pv.downstream_mbps,
          pv.upstream_mbps,pv.quota_gb,pv.billing_mode,pv.proration_mode,pv.fup_policy,
          pv.included_addons,pv.overage_per_gb_minor,
          bp.id AS billing_policy_id,bp.vat_rate_basis_points,bp.rounding_mode,
          bp.stamp_duty_usd_minor,bp.stamp_duty_lbp_minor,
          greatest(1,${input.periodEnd}::date-${input.periodStart}::date)::bigint AS period_days,
          greatest(0,
            least(${input.periodEnd}::date,coalesce(s.terminated_at::date+1,${input.periodEnd}::date))
            - greatest(${input.periodStart}::date,coalesce(s.activated_at::date,${input.periodStart}::date))
          )::bigint AS eligible_days,
          coalesce(addons.addon_amount_minor,0)::bigint AS addon_amount_minor,
          coalesce(addons.topup_quota_gb,0)::bigint AS topup_quota_gb,
          coalesce(addons.purchases,'[]'::jsonb) AS addon_purchases,
          coalesce(usage.used_bytes,0)::bigint AS used_bytes
        FROM operations_services s
        JOIN operations_plans p ON p.tenant_id=s.tenant_id AND p.id=s.plan_id
        CROSS JOIN LATERAL(
          SELECT day_value::date AS billing_date
          FROM generate_series(${input.periodStart}::date,${input.periodEnd}::date-1,interval '1 day') day_value
          WHERE extract(day FROM day_value)::integer=s.billing_anchor_day
          ORDER BY day_value LIMIT 1
        ) due
        JOIN LATERAL(
          SELECT version.* FROM operations_plan_versions version
          WHERE version.tenant_id=s.tenant_id AND version.plan_id=s.plan_id
            AND version.effective_from<=due.billing_date
            AND (version.effective_to IS NULL OR version.effective_to>due.billing_date)
          ORDER BY version.version DESC LIMIT 1
        ) pv ON true
        JOIN LATERAL(
          SELECT policy.* FROM operations_billing_policies policy
          WHERE policy.tenant_id=s.tenant_id
            AND (policy.branch_id=s.branch_id OR policy.branch_id IS NULL)
            AND policy.effective_from<=due.billing_date
            AND (policy.effective_to IS NULL OR policy.effective_to>due.billing_date)
            AND policy.supplier_tax_registration_number IS NOT NULL
            AND policy.retention_years IS NOT NULL
          ORDER BY (policy.branch_id IS NOT NULL) DESC,policy.version DESC LIMIT 1
        ) bp ON true
        LEFT JOIN LATERAL(
          SELECT coalesce(sum(purchase.total_amount_minor),0)::bigint AS addon_amount_minor,
            coalesce(sum(purchase.total_quota_gb),0)::bigint AS topup_quota_gb,
            coalesce(jsonb_agg(jsonb_build_object(
              'purchaseId',purchase.id,'addonVersionId',purchase.addon_version_id,
              'code',purchase.addon_code,'kind',purchase.addon_kind,'quantity',purchase.quantity,
              'amountMinor',purchase.total_amount_minor,'quotaGb',purchase.total_quota_gb
            ) ORDER BY purchase.purchased_at,purchase.id),'[]'::jsonb) AS purchases
          FROM operations_service_addon_purchases purchase
          WHERE purchase.tenant_id=s.tenant_id AND purchase.service_id=s.id
            AND purchase.applies_from<${input.periodEnd}::date
            AND purchase.applies_to>${input.periodStart}::date
            AND purchase.currency=pv.currency
        ) addons ON true
        LEFT JOIN LATERAL(
          SELECT coalesce(sum(event.total_bytes),0)::bigint AS used_bytes
          FROM operations_usage_events event
          WHERE event.tenant_id=s.tenant_id AND event.service_id=s.id
            AND event.occurred_at>=${input.periodStart}::date::timestamptz
            AND event.occurred_at<${input.periodEnd}::date::timestamptz
        ) usage ON true
        WHERE s.tenant_id=${tenantId} AND s.status='active' AND p.active
          AND (s.activated_at IS NULL OR s.activated_at::date<=due.billing_date)
          AND (s.terminated_at IS NULL OR s.terminated_at::date>due.billing_date)
          AND ((extract(year FROM age(due.billing_date,s.activated_at::date))::integer*12
            + extract(month FROM age(due.billing_date,s.activated_at::date))::integer)
            % pv.billing_interval_months=0)
          AND (${uuidArray(input.branchIds)} IS NULL OR s.branch_id=ANY(${uuidArray(input.branchIds)}))
          AND (${uuidArray(input.areaIds)} IS NULL OR s.area_id=ANY(${uuidArray(input.areaIds)}))
          AND (${uuidArray(input.routeIds)} IS NULL OR s.route_id=ANY(${uuidArray(input.routeIds)}))
          AND (${input.retryOfRunId ?? null}::uuid IS NULL OR EXISTS(
            SELECT 1 FROM operations_billing_run_items failed_item
            WHERE failed_item.tenant_id=s.tenant_id
              AND failed_item.billing_run_id=${input.retryOfRunId ?? null}::uuid
              AND failed_item.service_id=s.id AND failed_item.status='failed'
          ))
      ), rated AS (
        SELECT source.*,
          CASE source.proration_mode WHEN 'daily' THEN
            (source.recurring_amount_minor*source.eligible_days+source.period_days-1)/source.period_days
            ELSE source.recurring_amount_minor END::bigint AS base_amount_minor,
          CASE WHEN source.quota_gb IS NULL THEN 0 ELSE greatest(
            source.used_bytes-(source.quota_gb+source.topup_quota_gb)*1000000000,0)
          END::bigint AS excess_bytes,
          CASE WHEN source.quota_gb IS NULL THEN 0 ELSE
            (greatest(source.used_bytes-(source.quota_gb+source.topup_quota_gb)*1000000000,0)
              +999999999)/1000000000 END::bigint AS overage_gb
        FROM source
      ), amounts AS (
        SELECT rated.*,
          CASE WHEN rated.fup_policy->>'mode'='bill'
            THEN rated.overage_gb*rated.overage_per_gb_minor ELSE 0 END::bigint
            AS overage_amount_minor
        FROM rated
      )
      INSERT INTO operations_invoice_preparations(
        tenant_id,billing_run_id,service_id,gross_amount_minor,discount_basis_points,
        discount_amount_minor,subtotal_minor,vat_rate_basis_points,vat_minor,stamp_duty_minor,
        currency,branch_id,area_id,route_id,billing_date,period_start,period_end,
        plan_version_id,billing_policy_id,base_amount_minor,addon_amount_minor,
        overage_amount_minor,rating_snapshot)
      SELECT amounts.tenant_id,${run.id},amounts.service_id,
        amounts.base_amount_minor+amounts.addon_amount_minor+amounts.overage_amount_minor,0,0,
        amounts.base_amount_minor+amounts.addon_amount_minor+amounts.overage_amount_minor,
        amounts.vat_rate_basis_points,
        CASE amounts.rounding_mode
          WHEN 'down' THEN ((amounts.base_amount_minor+amounts.addon_amount_minor
            +amounts.overage_amount_minor)*amounts.vat_rate_basis_points)/10000
          WHEN 'up' THEN ((amounts.base_amount_minor+amounts.addon_amount_minor
            +amounts.overage_amount_minor)*amounts.vat_rate_basis_points+9999)/10000
          ELSE ((amounts.base_amount_minor+amounts.addon_amount_minor
            +amounts.overage_amount_minor)*amounts.vat_rate_basis_points+5000)/10000 END,
        CASE amounts.currency WHEN 'USD' THEN amounts.stamp_duty_usd_minor
          ELSE amounts.stamp_duty_lbp_minor END,
        amounts.currency,amounts.branch_id,amounts.area_id,amounts.route_id,amounts.billing_date,
        ${input.periodStart}::date,${input.periodEnd}::date,amounts.plan_version_id,amounts.billing_policy_id,
        amounts.base_amount_minor,amounts.addon_amount_minor,amounts.overage_amount_minor,
        jsonb_build_object(
          'planVersionId',amounts.plan_version_id,'planVersion',amounts.plan_version,
          'accessTechnology',amounts.access_technology,'downstreamMbps',amounts.downstream_mbps,
          'upstreamMbps',amounts.upstream_mbps,'quotaGb',amounts.quota_gb,
          'billingMode',amounts.billing_mode,'prorationMode',amounts.proration_mode,
          'proration',jsonb_build_object('periodDays',amounts.period_days,
            'eligibleDays',amounts.eligible_days),
          'fupPolicy',amounts.fup_policy,'includedAddons',amounts.included_addons,
          'purchasedAddons',amounts.addon_purchases,
          'usage',jsonb_build_object('usedBytes',amounts.used_bytes,
            'baseQuotaGb',amounts.quota_gb,'topupQuotaGb',amounts.topup_quota_gb,
            'excessBytes',amounts.excess_bytes,'overageGb',amounts.overage_gb),
          'baseAmountMinor',amounts.base_amount_minor,
          'addonAmountMinor',amounts.addon_amount_minor,
          'overageAmountMinor',amounts.overage_amount_minor,
          'grossAmountMinor',amounts.base_amount_minor+amounts.addon_amount_minor
            +amounts.overage_amount_minor,
          'discountBasisPoints',0,'discountAmountMinor',0,
          'stampDutyMinor',CASE amounts.currency WHEN 'USD' THEN amounts.stamp_duty_usd_minor
            ELSE amounts.stamp_duty_lbp_minor END,
          'currency',amounts.currency,'billingDate',amounts.billing_date
        )
      FROM amounts
      ON CONFLICT ON CONSTRAINT operations_invoice_preparations_service_period_key DO NOTHING
    `);
    await transaction.execute(sql`
      WITH candidates AS (
        SELECT s.tenant_id,s.id AS service_id,s.branch_id,s.area_id,s.route_id,
          s.plan_id,p.active AS plan_active,due.billing_date,pv.id AS plan_version_id
        FROM operations_services s
        JOIN operations_plans p ON p.tenant_id=s.tenant_id AND p.id=s.plan_id
        CROSS JOIN LATERAL(
          SELECT day_value::date AS billing_date
          FROM generate_series(${input.periodStart}::date,${input.periodEnd}::date-1,interval '1 day') day_value
          WHERE extract(day FROM day_value)::integer=s.billing_anchor_day
          ORDER BY day_value LIMIT 1
        ) due
        LEFT JOIN LATERAL(
          SELECT version.id,version.billing_interval_months
          FROM operations_plan_versions version
          WHERE version.tenant_id=s.tenant_id AND version.plan_id=s.plan_id
            AND version.effective_from<=due.billing_date
            AND (version.effective_to IS NULL OR version.effective_to>due.billing_date)
          ORDER BY version.version DESC LIMIT 1
        ) pv ON true
        WHERE s.tenant_id=${tenantId} AND s.status='active'
          AND (s.activated_at IS NULL OR s.activated_at::date<=due.billing_date)
          AND (s.terminated_at IS NULL OR s.terminated_at::date>due.billing_date)
          AND (pv.id IS NULL OR ((extract(year FROM age(due.billing_date,s.activated_at::date))::integer*12
            +extract(month FROM age(due.billing_date,s.activated_at::date))::integer)
            % pv.billing_interval_months=0))
          AND (${uuidArray(input.branchIds)} IS NULL OR s.branch_id=ANY(${uuidArray(input.branchIds)}))
          AND (${uuidArray(input.areaIds)} IS NULL OR s.area_id=ANY(${uuidArray(input.areaIds)}))
          AND (${uuidArray(input.routeIds)} IS NULL OR s.route_id=ANY(${uuidArray(input.routeIds)}))
          AND (${input.retryOfRunId ?? null}::uuid IS NULL OR EXISTS(
            SELECT 1 FROM operations_billing_run_items failed_item
            WHERE failed_item.tenant_id=s.tenant_id
              AND failed_item.billing_run_id=${input.retryOfRunId ?? null}::uuid
              AND failed_item.service_id=s.id AND failed_item.status='failed'
          ))
      )
      INSERT INTO operations_billing_run_items(
        tenant_id,billing_run_id,service_id,source_item_id,status,failure_code,
        explanation_en,explanation_ar,attempt_number)
      SELECT candidate.tenant_id,${run.id},candidate.service_id,source_item.id,
        CASE
          WHEN current_preparation.id IS NOT NULL THEN 'prepared'
          WHEN existing_preparation.id IS NOT NULL THEN 'skipped'
          ELSE 'failed'
        END,
        CASE
          WHEN current_preparation.id IS NOT NULL OR existing_preparation.id IS NOT NULL THEN NULL
          WHEN candidate.plan_version_id IS NULL THEN 'missing_plan_version'
          WHEN NOT candidate.plan_active THEN 'inactive_plan'
          WHEN NOT EXISTS(
            SELECT 1 FROM operations_billing_policies policy
            WHERE policy.tenant_id=candidate.tenant_id
              AND (policy.branch_id=candidate.branch_id OR policy.branch_id IS NULL)
              AND policy.effective_from<=candidate.billing_date
              AND (policy.effective_to IS NULL OR policy.effective_to>candidate.billing_date)
              AND policy.supplier_tax_registration_number IS NOT NULL
              AND policy.retention_years IS NOT NULL
          ) THEN 'missing_billing_policy'
          ELSE 'rating_unavailable'
        END,
        CASE
          WHEN current_preparation.id IS NOT NULL THEN 'Invoice draft prepared from effective plan and billing policy.'
          WHEN existing_preparation.id IS NOT NULL THEN 'The service period already has an invoice preparation; no duplicate was created.'
          WHEN candidate.plan_version_id IS NULL THEN 'No effective plan version covers the service billing date.'
          WHEN NOT candidate.plan_active THEN 'The service plan is inactive and cannot produce a recurring draft.'
          WHEN NOT EXISTS(
            SELECT 1 FROM operations_billing_policies policy
            WHERE policy.tenant_id=candidate.tenant_id
              AND (policy.branch_id=candidate.branch_id OR policy.branch_id IS NULL)
              AND policy.effective_from<=candidate.billing_date
              AND (policy.effective_to IS NULL OR policy.effective_to>candidate.billing_date)
              AND policy.supplier_tax_registration_number IS NOT NULL
              AND policy.retention_years IS NOT NULL
          ) THEN 'No effective legal billing policy covers the service billing date.'
          ELSE 'The service could not be rated from the available effective configuration.'
        END,
        CASE
          WHEN current_preparation.id IS NOT NULL THEN 'تم تحضير مسودة الفاتورة من نسخة الباقة وسياسة الفوترة النافذتين.'
          WHEN existing_preparation.id IS NOT NULL THEN 'توجد مسودة فاتورة لهذه الخدمة والفترة، لذلك لم يتم إنشاء نسخة مكررة.'
          WHEN candidate.plan_version_id IS NULL THEN 'لا توجد نسخة باقة نافذة تغطي تاريخ فوترة الخدمة.'
          WHEN NOT candidate.plan_active THEN 'الباقة غير نشطة ولا يمكنها إنشاء مسودة فوترة دورية.'
          WHEN NOT EXISTS(
            SELECT 1 FROM operations_billing_policies policy
            WHERE policy.tenant_id=candidate.tenant_id
              AND (policy.branch_id=candidate.branch_id OR policy.branch_id IS NULL)
              AND policy.effective_from<=candidate.billing_date
              AND (policy.effective_to IS NULL OR policy.effective_to>candidate.billing_date)
              AND policy.supplier_tax_registration_number IS NOT NULL
              AND policy.retention_years IS NOT NULL
          ) THEN 'لا توجد سياسة فوترة قانونية نافذة تغطي تاريخ فوترة الخدمة.'
          ELSE 'تعذّر احتساب الخدمة باستخدام الإعدادات النافذة المتاحة.'
        END,
        coalesce(source_item.attempt_number+1,1)
      FROM candidates candidate
      LEFT JOIN operations_billing_run_items source_item
        ON source_item.tenant_id=candidate.tenant_id
        AND source_item.billing_run_id=${input.retryOfRunId ?? null}::uuid
        AND source_item.service_id=candidate.service_id AND source_item.status='failed'
      LEFT JOIN operations_invoice_preparations current_preparation
        ON current_preparation.tenant_id=candidate.tenant_id
        AND current_preparation.billing_run_id=${run.id}
        AND current_preparation.service_id=candidate.service_id
      LEFT JOIN operations_invoice_preparations existing_preparation
        ON existing_preparation.tenant_id=candidate.tenant_id
        AND existing_preparation.service_id=candidate.service_id
        AND existing_preparation.period_start=${input.periodStart}::date
        AND existing_preparation.period_end=${input.periodEnd}::date
        AND existing_preparation.billing_run_id<>${run.id}
    `);
    const [completed] = await transaction.execute<{
      readonly status: BillingRunResult['status'];
    }>(sql`
      UPDATE operations_billing_runs
      SET status=CASE WHEN EXISTS(
          SELECT 1 FROM operations_billing_run_items item
          WHERE item.tenant_id=${tenantId} AND item.billing_run_id=${run.id}
            AND item.status='failed'
        ) THEN 'failed'::operations_job_status ELSE 'succeeded'::operations_job_status END,
        error_summary=CASE WHEN EXISTS(
          SELECT 1 FROM operations_billing_run_items item
          WHERE item.tenant_id=${tenantId} AND item.billing_run_id=${run.id}
            AND item.status='failed'
        ) THEN 'One or more services require corrected effective billing configuration.' ELSE NULL END,
        completed_at=now()
      WHERE tenant_id = ${tenantId} AND id = ${run.id}
      RETURNING status
    `);
    if (!completed) throw new Error('Unable to complete the billing run.');
    return billingResult(transaction, tenantId, run.id, input.idempotencyKey, completed.status);
  });
}

export async function enqueueSubscriberNetworkAction(
  database: Database,
  tenantId: VerifiedTenantId,
  input: NetworkActionInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  try {
    return await inOperationsTransaction(
      database,
      tenantId,
      input.authorization,
      async (transaction) => {
        const [inserted] = await transaction.execute<{
          readonly id: string;
          readonly service_id: string;
          readonly action: NetworkActionInput['action'];
          readonly payload: unknown;
          readonly requested_by: string;
        }>(sql`
        INSERT INTO operations_network_action_outbox
          (tenant_id, service_id, branch_id, area_id, route_id, action, payload,
           idempotency_key, requested_by)
        SELECT
          s.tenant_id, s.id, s.branch_id, s.area_id, s.route_id, ${input.action},
          ${JSON.stringify(input.payload)}::jsonb, ${input.idempotencyKey}, ${input.requestedBy}
        FROM operations_services s
        WHERE s.tenant_id = ${tenantId} AND s.id = ${input.serviceId}
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING id, service_id, action, payload, requested_by
      `);
        if (inserted) return { id: inserted.id, replayed: false };
        const [existing] = await transaction.execute<{
          readonly id: string;
          readonly service_id: string;
          readonly action: NetworkActionInput['action'];
          readonly payload: unknown;
          readonly requested_by: string;
        }>(sql`
        SELECT id, service_id, action, payload, requested_by
        FROM operations_network_action_outbox
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
      `);
        if (
          !existing ||
          existing.service_id !== input.serviceId ||
          existing.action !== input.action ||
          existing.requested_by !== input.requestedBy ||
          stableJson(existing.payload) !== stableJson(input.payload)
        ) {
          throw new OperationsIdempotencyConflictError();
        }
        return { id: existing.id, replayed: true };
      },
    );
  } catch (error) {
    if (databaseCode(error) === 'P4032') throw new PlatformSubscriptionNetworkRestrictionError();
    throw error;
  }
}

export async function reconcileCollector(
  database: Database,
  tenantId: VerifiedTenantId,
  input: CollectorReconciliationInput,
): Promise<{ readonly id: string; readonly differenceMinor: number }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{
      readonly id: string;
      readonly difference_minor: string;
    }>(sql`
      INSERT INTO operations_collector_reconciliations
        (tenant_id, collector_user_id, route_id, business_date, currency,
         expected_minor, declared_minor, previous_reconciliation_id, reason, approved_by,
         idempotency_key, reconciled_by)
      VALUES
        (${tenantId}, ${input.collectorUserId}, ${input.routeId}, ${input.businessDate}::date,
         ${input.currency}, 0, 0, ${input.previousReconciliationId ?? null},
         ${input.reason ?? null}, ${input.approvedBy ?? null}, ${input.idempotencyKey},
         ${input.reconciledBy})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id, difference_minor
    `);
    if (inserted) {
      return { id: inserted.id, differenceMinor: safeInteger(inserted.difference_minor) };
    }
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly collector_user_id: string;
      readonly route_id: string;
      readonly business_date: Date | string;
      readonly currency: string;
      readonly expected_minor: string;
      readonly declared_minor: string;
      readonly difference_minor: string;
      readonly previous_reconciliation_id: string | null;
      readonly reason: string | null;
      readonly approved_by: string | null;
      readonly reconciled_by: string;
    }>(sql`
      SELECT id, collector_user_id, route_id, business_date, currency, expected_minor,
             declared_minor, difference_minor, previous_reconciliation_id, reason,
             approved_by, reconciled_by
      FROM operations_collector_reconciliations
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.collector_user_id !== input.collectorUserId ||
      existing.route_id !== input.routeId ||
      day(existing.business_date) !== input.businessDate ||
      existing.currency !== input.currency ||
      (existing.previous_reconciliation_id ?? undefined) !== input.previousReconciliationId ||
      (existing.reason ?? undefined) !== input.reason ||
      (existing.approved_by ?? undefined) !== input.approvedBy ||
      existing.reconciled_by !== input.reconciledBy
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, differenceMinor: safeInteger(existing.difference_minor) };
  });
}

export async function requestOperationsExport(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ExportJobInput,
): Promise<{ readonly id: string; readonly status: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{
      readonly id: string;
      readonly status: string;
    }>(sql`
      INSERT INTO operations_export_jobs
        (tenant_id, report_key, filters, format, scope_branch_ids, scope_area_ids,
         scope_route_ids, scope_record_ids, idempotency_key, requested_by)
      VALUES
        (${tenantId}, ${input.reportKey}, ${JSON.stringify(input.filters)}::jsonb, ${input.format},
         ${uuidArray(input.branchIds)}, ${uuidArray(input.areaIds)},
         ${uuidArray(input.routeIds)}, ${uuidArray(input.recordIds)},
         ${input.idempotencyKey}, ${input.requestedBy})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id, status
    `);
    if (inserted) return inserted;
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly status: string;
      readonly report_key: string;
      readonly filters: unknown;
      readonly format: string;
      readonly requested_by: string;
      readonly scope_branch_ids: readonly string[] | null;
      readonly scope_area_ids: readonly string[] | null;
      readonly scope_route_ids: readonly string[] | null;
      readonly scope_record_ids: readonly string[] | null;
    }>(sql`
      SELECT id, status, report_key, filters, format, requested_by,
             scope_branch_ids, scope_area_ids, scope_route_ids, scope_record_ids
      FROM operations_export_jobs
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.report_key !== input.reportKey ||
      stableJson(existing.filters) !== stableJson(input.filters) ||
      existing.format !== input.format ||
      existing.requested_by !== input.requestedBy ||
      stableJson(existing.scope_branch_ids ?? undefined) !== stableJson(input.branchIds) ||
      stableJson(existing.scope_area_ids ?? undefined) !== stableJson(input.areaIds) ||
      stableJson(existing.scope_route_ids ?? undefined) !== stableJson(input.routeIds) ||
      stableJson(existing.scope_record_ids ?? undefined) !== stableJson(input.recordIds)
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, status: existing.status };
  });
}

export async function recordOfficePaymentCorrection(
  database: Database,
  tenantId: VerifiedTenantId,
  input: PaymentCorrectionInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_office_payment_corrections
        (tenant_id, payment_request_id, previous_correction_id, finance_allocation_id,
         correction_kind, reason, idempotency_key, actor_id)
      VALUES
        (${tenantId}, ${input.paymentRequestId}, ${input.previousCorrectionId ?? null},
         ${input.financeAllocationId ?? null}, ${input.correctionKind}, ${input.reason},
         ${input.idempotencyKey}, ${input.actorId})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (inserted) return { id: inserted.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly payment_request_id: string;
      readonly previous_correction_id: string | null;
      readonly finance_allocation_id: string | null;
      readonly correction_kind: PaymentCorrectionInput['correctionKind'];
      readonly reason: string;
      readonly actor_id: string;
    }>(sql`
      SELECT id, payment_request_id, previous_correction_id, finance_allocation_id,
             correction_kind, reason, actor_id
      FROM operations_office_payment_corrections
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.payment_request_id !== input.paymentRequestId ||
      (existing.previous_correction_id ?? undefined) !== input.previousCorrectionId ||
      (existing.finance_allocation_id ?? undefined) !== input.financeAllocationId ||
      existing.correction_kind !== input.correctionKind ||
      existing.reason !== input.reason ||
      existing.actor_id !== input.actorId
    ) {
      throw new OperationsIdempotencyConflictError();
    }
    return { id: existing.id, replayed: true };
  });
}

export async function transitionInstallation(
  database: Database,
  tenantId: VerifiedTenantId,
  input: InstallationTransitionInput,
): Promise<{
  readonly id: string;
  readonly status: string;
  readonly version: number;
  readonly replayed: boolean;
}> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [priorEvent] = await transaction.execute<{
      readonly installation_id: string;
      readonly to_status: string;
      readonly note: string | null;
      readonly evidence: unknown;
      readonly expected_version: number;
      readonly actor_id: string;
    }>(sql`
      SELECT installation_id, to_status, note, evidence, expected_version, actor_id
      FROM operations_installation_events
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (priorEvent) {
      if (
        priorEvent.installation_id !== input.installationId ||
        priorEvent.to_status !== input.toStatus ||
        (priorEvent.note ?? undefined) !== input.note ||
        stableJson(priorEvent.evidence) !== stableJson(input.evidence) ||
        priorEvent.expected_version !== input.expectedVersion ||
        priorEvent.actor_id !== input.actorId
      )
        throw new OperationsIdempotencyConflictError();
      const [current] = await transaction.execute<{
        readonly status: string;
        readonly version: number;
      }>(sql`
        SELECT status, version FROM operations_installations
        WHERE tenant_id = ${tenantId} AND id = ${input.installationId}
      `);
      if (!current) throw new Error('Installation no longer exists.');
      return { id: input.installationId, ...current, replayed: true };
    }

    const [current] = await transaction.execute<{
      readonly status: string;
      readonly version: number;
    }>(sql`
      SELECT status, version FROM operations_installations
      WHERE tenant_id = ${tenantId} AND id = ${input.installationId}
    `);
    if (
      !current ||
      current.version !== input.expectedVersion ||
      !installationAllowed(current.status, input.toStatus)
    ) {
      throw new Error('The installation transition conflicts with its current state.');
    }
    await transaction.execute(sql`
      INSERT INTO operations_installation_events
        (tenant_id, installation_id, from_status, to_status, note, evidence,
         expected_version, actor_id, idempotency_key)
      VALUES
        (${tenantId}, ${input.installationId}, ${current.status}, ${input.toStatus},
         ${input.note ?? null}, ${JSON.stringify(input.evidence)}::jsonb, ${input.expectedVersion},
         ${input.actorId}, ${input.idempotencyKey})
    `);
    const [updated] = await transaction.execute<{
      readonly status: string;
      readonly version: number;
    }>(sql`
      SELECT status, version FROM operations_installations
      WHERE tenant_id = ${tenantId} AND id = ${input.installationId}
    `);
    if (!updated) throw new Error('Unable to update the installation.');
    return { id: input.installationId, ...updated, replayed: false };
  });
}

export async function createSupportIssue(
  database: Database,
  tenantId: VerifiedTenantId,
  input: CreateIssueInput,
): Promise<{ readonly id: string; readonly issueNumber: string; readonly status: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      readonly id: string;
      readonly issue_number: string;
      readonly status: string;
      readonly subject: string;
      readonly description: string;
      readonly priority: string;
      readonly subscriber_id: string | null;
      readonly service_id: string | null;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
    }>(sql`
      INSERT INTO operations_support_issues
        (tenant_id, issue_number, idempotency_key, subscriber_id, service_id,
         branch_id, area_id, route_id, subject, description, priority)
      VALUES
        (${tenantId}, ${input.issueNumber}, ${input.idempotencyKey}, ${input.subscriberId ?? null},
         ${input.serviceId ?? null}, ${input.branchId}, ${input.areaId}, ${input.routeId},
         ${input.subject}, ${input.description}, ${input.priority})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id, issue_number, status, subject, description, priority, subscriber_id,
        service_id, branch_id, area_id, route_id
    `);
    const actual =
      row ??
      (
        await transaction.execute<NonNullable<typeof row>>(sql`
      SELECT id, issue_number, status, subject, description, priority, subscriber_id,
        service_id, branch_id, area_id, route_id
      FROM operations_support_issues
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `)
      )[0];
    if (
      !actual ||
      actual.issue_number !== input.issueNumber ||
      actual.subject !== input.subject ||
      actual.description !== input.description ||
      actual.priority !== input.priority ||
      (actual.subscriber_id ?? undefined) !== input.subscriberId ||
      (actual.service_id ?? undefined) !== input.serviceId ||
      actual.branch_id !== input.branchId ||
      actual.area_id !== input.areaId ||
      actual.route_id !== input.routeId
    )
      throw new OperationsIdempotencyConflictError();
    return { id: actual.id, issueNumber: actual.issue_number, status: actual.status };
  });
}

export async function recordOfficePaymentRequest(
  database: Database,
  tenantId: VerifiedTenantId,
  input: OfficePaymentRequestInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_office_payment_requests (
        tenant_id, subscriber_id, finance_payment_id, branch_id, area_id, route_id,
        idempotency_key, receipt_number, amount_minor, currency, requested_by
      ) VALUES (
        ${tenantId}, ${input.subscriberId}, ${input.financePaymentId}, ${input.branchId},
        ${input.areaId}, ${input.routeId}, ${input.idempotencyKey}, ${input.receiptNumber},
        ${input.amountMinor}, ${input.currency}, ${input.requestedBy}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (inserted) return { id: inserted.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly subscriber_id: string;
      readonly finance_payment_id: string;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly receipt_number: string;
      readonly amount_minor: string;
      readonly currency: string;
      readonly requested_by: string;
    }>(sql`
      SELECT id, subscriber_id, finance_payment_id, branch_id, area_id, route_id,
        receipt_number, amount_minor, currency, requested_by
      FROM operations_office_payment_requests
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.subscriber_id !== input.subscriberId ||
      existing.finance_payment_id !== input.financePaymentId ||
      existing.branch_id !== input.branchId ||
      existing.area_id !== input.areaId ||
      existing.route_id !== input.routeId ||
      existing.receipt_number !== input.receiptNumber ||
      safeInteger(existing.amount_minor) !== input.amountMinor ||
      existing.currency !== input.currency ||
      existing.requested_by !== input.requestedBy
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, replayed: true };
  });
}

export async function createOperationsPlanVersion(
  database: Database,
  tenantId: VerifiedTenantId,
  input: PlanVersionInput,
): Promise<{ readonly planId: string; readonly versionId: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:plan:${input.idempotencyKey}`}, 0)
    )`);
    const [replay] = await transaction.execute<{
      readonly id: string;
      readonly plan_id: string;
      readonly version: number;
      readonly recurring_amount_minor: string;
      readonly currency: string;
      readonly billing_interval_months: number;
      readonly effective_from: Date | string;
      readonly effective_to: Date | string | null;
      readonly created_by: string;
      readonly branch_id: string | null;
      readonly code: string;
      readonly name_en: string;
      readonly name_ar: string;
      readonly network_profile_reference: string | null;
      readonly access_technology: string;
      readonly downstream_mbps: number;
      readonly upstream_mbps: number;
      readonly quota_gb: string | null;
      readonly billing_mode: 'prepaid' | 'postpaid';
      readonly proration_mode: 'none' | 'daily';
      readonly fup_policy: unknown;
      readonly included_addons: unknown;
      readonly overage_per_gb_minor: string | null;
    }>(sql`
      SELECT v.id, v.plan_id, v.version, v.recurring_amount_minor, v.currency,
        v.billing_interval_months, v.effective_from, v.effective_to, v.created_by,
        p.branch_id, p.code, p.name_en, p.name_ar, p.network_profile_reference,
        v.access_technology,v.downstream_mbps,v.upstream_mbps,v.quota_gb,
        v.billing_mode,v.proration_mode,v.fup_policy,v.included_addons,v.overage_per_gb_minor
      FROM operations_plan_versions v
      JOIN operations_plans p ON p.tenant_id = v.tenant_id AND p.id = v.plan_id
      WHERE v.tenant_id = ${tenantId} AND v.idempotency_key = ${input.idempotencyKey}
    `);
    if (replay) {
      if (
        (input.planId !== undefined && replay.plan_id !== input.planId) ||
        replay.version !== input.version ||
        safeInteger(replay.recurring_amount_minor) !== input.recurringAmountMinor ||
        replay.currency !== input.currency ||
        replay.billing_interval_months !== input.billingIntervalMonths ||
        day(replay.effective_from) !== input.effectiveFrom ||
        (replay.effective_to === null ? undefined : day(replay.effective_to)) !==
          input.effectiveTo ||
        replay.created_by !== input.createdBy ||
        (replay.branch_id ?? undefined) !== input.branchId ||
        replay.code !== input.code ||
        replay.name_en !== input.nameEn ||
        replay.name_ar !== input.nameAr ||
        (replay.network_profile_reference ?? undefined) !== input.networkProfileReference ||
        replay.access_technology !== input.accessTechnology ||
        replay.downstream_mbps !== input.downstreamMbps ||
        replay.upstream_mbps !== input.upstreamMbps ||
        (replay.quota_gb === null ? undefined : safeInteger(replay.quota_gb)) !== input.quotaGb ||
        replay.billing_mode !== input.billingMode ||
        replay.proration_mode !== input.prorationMode ||
        stableJson(replay.fup_policy) !== stableJson(input.fupPolicy) ||
        stableJson(replay.included_addons) !== stableJson(input.includedAddons) ||
        (replay.overage_per_gb_minor === null
          ? undefined
          : safeInteger(replay.overage_per_gb_minor)) !== input.overagePerGbMinor
      )
        throw new OperationsIdempotencyConflictError();
      return { planId: replay.plan_id, versionId: replay.id, replayed: true };
    }

    let planId = input.planId;
    if (!planId) {
      const [plan] = await transaction.execute<{ readonly id: string }>(sql`
        INSERT INTO operations_plans (
          tenant_id, branch_id, code, name_en, name_ar, recurring_amount_minor, currency,
          billing_interval_months, network_profile_reference, idempotency_key
        ) VALUES (
          ${tenantId}, ${input.branchId ?? null}, ${input.code}, ${input.nameEn}, ${input.nameAr},
          ${input.recurringAmountMinor}, ${input.currency}, ${input.billingIntervalMonths},
          ${input.networkProfileReference ?? null},
          ${input.idempotencyKey}
        )
        RETURNING id
      `);
      if (!plan) throw new Error('Unable to create the operations plan.');
      planId = plan.id;
    }
    const [version] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_plan_versions (
        tenant_id, plan_id, version, recurring_amount_minor, currency, billing_interval_months,
        effective_from, effective_to, created_by, idempotency_key,access_technology,
        downstream_mbps,upstream_mbps,quota_gb,billing_mode,proration_mode,fup_policy,
        included_addons,overage_per_gb_minor
      ) VALUES (
        ${tenantId}, ${planId}, ${input.version}, ${input.recurringAmountMinor}, ${input.currency},
        ${input.billingIntervalMonths}, ${input.effectiveFrom}::date, ${input.effectiveTo ?? null}::date,
        ${input.createdBy}, ${input.idempotencyKey},${input.accessTechnology},${input.downstreamMbps},
        ${input.upstreamMbps},${input.quotaGb ?? null},${input.billingMode},${input.prorationMode},
        ${JSON.stringify(input.fupPolicy)}::jsonb,${JSON.stringify(input.includedAddons)}::jsonb,
        ${input.overagePerGbMinor ?? null}
      )
      RETURNING id
    `);
    if (!version) throw new Error('Unable to create the plan version.');
    return { planId, versionId: version.id, replayed: false };
  });
}

export async function createBillingPolicyVersion(
  database: Database,
  tenantId: VerifiedTenantId,
  input: BillingPolicyVersionInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_billing_policies (
        tenant_id, branch_id, version, vat_rate_basis_points, rounding_mode,
        supplier_name_en,supplier_name_ar,supplier_address_en,supplier_address_ar,
        supplier_tax_registration_number,stamp_duty_usd_minor,stamp_duty_lbp_minor,retention_years,
        effective_from, effective_to, created_by, idempotency_key
      ) VALUES (
        ${tenantId}, ${input.branchId ?? null}, ${input.version}, ${input.vatRateBasisPoints},
        ${input.roundingMode},${input.supplierNameEn},${input.supplierNameAr},
        ${input.supplierAddressEn},${input.supplierAddressAr},
        ${input.supplierTaxRegistrationNumber},${input.stampDutyUsdMinor},
        ${input.stampDutyLbpMinor},${input.retentionYears},
        ${input.effectiveFrom}::date, ${input.effectiveTo ?? null}::date,
        ${input.createdBy}, ${input.idempotencyKey}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (inserted) return { id: inserted.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly branch_id: string | null;
      readonly version: number;
      readonly vat_rate_basis_points: number;
      readonly rounding_mode: string;
      readonly supplier_name_en: string | null;
      readonly supplier_name_ar: string | null;
      readonly supplier_address_en: string | null;
      readonly supplier_address_ar: string | null;
      readonly supplier_tax_registration_number: string | null;
      readonly stamp_duty_usd_minor: string;
      readonly stamp_duty_lbp_minor: string;
      readonly retention_years: number | null;
      readonly effective_from: Date | string;
      readonly effective_to: Date | string | null;
      readonly created_by: string;
    }>(sql`
      SELECT id, branch_id, version, vat_rate_basis_points, rounding_mode,
        supplier_name_en,supplier_name_ar,supplier_address_en,supplier_address_ar,
        supplier_tax_registration_number,stamp_duty_usd_minor::text,stamp_duty_lbp_minor::text,
        retention_years,
        effective_from, effective_to, created_by
      FROM operations_billing_policies
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      (existing.branch_id ?? undefined) !== input.branchId ||
      existing.version !== input.version ||
      existing.vat_rate_basis_points !== input.vatRateBasisPoints ||
      existing.rounding_mode !== input.roundingMode ||
      existing.supplier_name_en !== input.supplierNameEn ||
      existing.supplier_name_ar !== input.supplierNameAr ||
      existing.supplier_address_en !== input.supplierAddressEn ||
      existing.supplier_address_ar !== input.supplierAddressAr ||
      existing.supplier_tax_registration_number !== input.supplierTaxRegistrationNumber ||
      safeInteger(existing.stamp_duty_usd_minor) !== input.stampDutyUsdMinor ||
      safeInteger(existing.stamp_duty_lbp_minor) !== input.stampDutyLbpMinor ||
      existing.retention_years !== input.retentionYears ||
      day(existing.effective_from) !== input.effectiveFrom ||
      (existing.effective_to === null ? undefined : day(existing.effective_to)) !==
        input.effectiveTo ||
      existing.created_by !== input.createdBy
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, replayed: true };
  });
}

export async function createServiceInstallation(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ServiceInstallationInput,
): Promise<{
  readonly serviceId: string;
  readonly installationId: string;
  readonly replayed: boolean;
}> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:service:${input.idempotencyKey}`}, 0)
    )`);
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly subscriber_id: string;
      readonly location_id: string;
      readonly plan_id: string;
      readonly service_number: string;
      readonly billing_anchor_day: number;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
    }>(sql`
      SELECT id, subscriber_id, location_id, plan_id, service_number, billing_anchor_day,
        branch_id, area_id, route_id
      FROM operations_services
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (existing) {
      if (
        existing.subscriber_id !== input.subscriberId ||
        existing.location_id !== input.locationId ||
        existing.plan_id !== input.planId ||
        existing.service_number !== input.serviceNumber ||
        existing.billing_anchor_day !== input.billingAnchorDay ||
        existing.branch_id !== input.branchId ||
        existing.area_id !== input.areaId ||
        existing.route_id !== input.routeId
      )
        throw new OperationsIdempotencyConflictError();
      const [installation] = await transaction.execute<{
        readonly id: string;
        readonly scheduled_for: string | Date | null;
        readonly installer_user_id: string | null;
      }>(sql`
        SELECT id, scheduled_for, installer_user_id FROM operations_installations
        WHERE tenant_id = ${tenantId} AND service_id = ${existing.id}
      `);
      if (!installation) throw new Error('The replayed service is missing its installation.');
      if (
        (installation.installer_user_id ?? undefined) !== input.installerUserId ||
        (installation.scheduled_for === null
          ? undefined
          : new Date(installation.scheduled_for).toISOString()) !==
          (input.scheduledFor === undefined
            ? undefined
            : new Date(input.scheduledFor).toISOString())
      )
        throw new OperationsIdempotencyConflictError();
      return { serviceId: existing.id, installationId: installation.id, replayed: true };
    }
    const [service] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_services (
        tenant_id, subscriber_id, location_id, plan_id, service_number, status,
        billing_anchor_day, branch_id, area_id, route_id, idempotency_key
      )
      SELECT s.tenant_id, s.id, l.id, p.id, ${input.serviceNumber}, 'pending_installation',
        ${input.billingAnchorDay}, ${input.branchId}, ${input.areaId}, ${input.routeId},
        ${input.idempotencyKey}
      FROM operations_subscribers s
      JOIN operations_locations l ON l.tenant_id = s.tenant_id AND l.id = ${input.locationId}
      JOIN operations_plans p ON p.tenant_id = s.tenant_id AND p.id = ${input.planId} AND p.active
      WHERE s.tenant_id = ${tenantId} AND s.id = ${input.subscriberId}
        AND s.branch_id = ${input.branchId} AND s.area_id = ${input.areaId}
        AND s.route_id = ${input.routeId} AND l.household_id = s.household_id
        AND l.branch_id = s.branch_id AND l.area_id = s.area_id AND l.route_id = s.route_id
        AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
      RETURNING id
    `);
    if (!service) throw new Error('The subscriber, location, plan, and scope are not eligible.');
    const [installation] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_installations (
        tenant_id, service_id, status, scheduled_for, installer_user_id,
        branch_id, area_id, route_id, idempotency_key
      ) VALUES (
        ${tenantId}, ${service.id}, 'requested', ${input.scheduledFor ?? null}::timestamptz,
        ${input.installerUserId ?? null}, ${input.branchId}, ${input.areaId}, ${input.routeId},
        ${input.idempotencyKey}
      ) RETURNING id
    `);
    if (!installation) throw new Error('Unable to create the installation.');
    return { serviceId: service.id, installationId: installation.id, replayed: false };
  });
}

export async function assignCollectorInvoice(
  database: Database,
  tenantId: VerifiedTenantId,
  input: CollectorAssignmentInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_collector_assignments (
        tenant_id, collector_user_id, subscriber_id, route_id, route_reference,
        finance_invoice_id, due_on, expected_amount_minor, currency, idempotency_key
      )
      SELECT ${tenantId}, ${input.collectorUserId}, ${input.subscriberId}, r.id, r.code,
        ${input.financeInvoiceId}, ${input.dueOn}::date, 1, invoice.currency, ${input.idempotencyKey}
      FROM operations_routes r
      JOIN finance_invoices invoice ON invoice.tenant_id = r.tenant_id
        AND invoice.id = ${input.financeInvoiceId}
      JOIN operations_invoice_preparations preparation
        ON preparation.tenant_id = invoice.tenant_id
        AND preparation.finance_invoice_id = invoice.id
        AND preparation.posting_status = 'posted'
      JOIN operations_services service
        ON service.tenant_id = preparation.tenant_id AND service.id = preparation.service_id
      WHERE r.tenant_id = ${tenantId} AND r.id = ${input.routeId}
        AND service.subscriber_id = ${input.subscriberId} AND service.route_id = r.id
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (inserted) return { id: inserted.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly collector_user_id: string;
      readonly subscriber_id: string;
      readonly route_id: string;
      readonly finance_invoice_id: string;
      readonly due_on: Date | string;
    }>(sql`
      SELECT id, collector_user_id, subscriber_id, route_id, finance_invoice_id, due_on
      FROM operations_collector_assignments
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.collector_user_id !== input.collectorUserId ||
      existing.subscriber_id !== input.subscriberId ||
      existing.route_id !== input.routeId ||
      existing.finance_invoice_id !== input.financeInvoiceId ||
      day(existing.due_on) !== input.dueOn
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, replayed: true };
  });
}

export async function recordCollectorEvidence(
  database: Database,
  tenantId: VerifiedTenantId,
  input: CollectorEvidenceInput,
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_collector_collection_evidence (
        tenant_id, assignment_id, finance_payment_id, amount_minor, currency,
        recorded_by, idempotency_key
      ) VALUES (
        ${tenantId}, ${input.assignmentId}, ${input.financePaymentId}, 1, 'USD',
        ${input.recordedBy}, ${input.idempotencyKey}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `);
    if (inserted) return { id: inserted.id, replayed: false };
    const [existing] = await transaction.execute<{
      readonly id: string;
      readonly assignment_id: string;
      readonly finance_payment_id: string;
      readonly recorded_by: string;
    }>(sql`
      SELECT id, assignment_id, finance_payment_id, recorded_by
      FROM operations_collector_collection_evidence
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      !existing ||
      existing.assignment_id !== input.assignmentId ||
      existing.finance_payment_id !== input.financePaymentId ||
      existing.recorded_by !== input.recordedBy
    )
      throw new OperationsIdempotencyConflictError();
    return { id: existing.id, replayed: true };
  });
}

export async function transitionSupportIssue(
  database: Database,
  tenantId: VerifiedTenantId,
  input: IssueTransitionInput,
): Promise<{
  readonly id: string;
  readonly status: string;
  readonly version: number;
  readonly replayed: boolean;
}> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [prior] = await transaction.execute<{
      readonly issue_id: string;
      readonly to_status: string;
      readonly note: string | null;
      readonly evidence: unknown;
      readonly expected_version: number;
      readonly actor_id: string;
    }>(sql`
      SELECT issue_id, to_status, note, evidence, expected_version, actor_id
      FROM operations_issue_events
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (
      prior &&
      (prior.issue_id !== input.issueId ||
        prior.to_status !== input.toStatus ||
        (prior.note ?? undefined) !== input.note ||
        stableJson(prior.evidence) !== stableJson(input.evidence) ||
        prior.expected_version !== input.expectedVersion ||
        prior.actor_id !== input.actorId)
    )
      throw new OperationsIdempotencyConflictError();
    if (!prior) {
      const [issue] = await transaction.execute<{
        readonly status: string;
        readonly version: number;
      }>(sql`
        SELECT status, version FROM operations_support_issues
        WHERE tenant_id = ${tenantId} AND id = ${input.issueId} FOR UPDATE
      `);
      if (!issue || issue.version !== input.expectedVersion) {
        throw new Error('The support issue changed before this transition.');
      }
      await transaction.execute(sql`
        INSERT INTO operations_issue_events (
          tenant_id, issue_id, from_status, to_status, note, evidence, expected_version,
          actor_id, idempotency_key
        ) VALUES (
          ${tenantId}, ${input.issueId}, ${issue.status}, ${input.toStatus}, ${input.note ?? null},
          ${JSON.stringify(input.evidence)}::jsonb, ${input.expectedVersion}, ${input.actorId},
          ${input.idempotencyKey}
        )
      `);
    }
    const [current] = await transaction.execute<{
      readonly status: string;
      readonly version: number;
    }>(sql`
      SELECT status, version FROM operations_support_issues
      WHERE tenant_id = ${tenantId} AND id = ${input.issueId}
    `);
    if (!current) throw new Error('Support issue no longer exists.');
    return { id: input.issueId, ...current, replayed: prior !== undefined };
  });
}

export async function configureOperations(
  database: Database,
  tenantId: VerifiedTenantId,
  input: OperationsConfigurationInput,
): Promise<{ readonly key: string; readonly version: number; readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:configuration:${input.key}`}, 0)
    )`);
    const fingerprint = stableJson({
      key: input.key,
      value: input.value,
      branchId: input.branchId,
      expectedVersion: input.expectedVersion,
      updatedBy: input.updatedBy,
    });
    const [replay] = await transaction.execute<{
      readonly version: number;
      readonly request_fingerprint: string;
    }>(sql`
      SELECT version, request_fingerprint FROM operations_configuration_changes
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        throw new OperationsIdempotencyConflictError();
      return { key: input.key, version: replay.version, replayed: true };
    }
    const [existing] = await transaction.execute<{
      readonly version: number;
      readonly idempotency_key: string;
      readonly request_fingerprint: string;
      readonly value: unknown;
      readonly branch_id: string | null;
    }>(sql`
      SELECT version, idempotency_key, request_fingerprint, value, branch_id
      FROM operations_configuration
      WHERE tenant_id = ${tenantId} AND config_key = ${input.key} FOR UPDATE
    `);
    if (
      existing &&
      (input.expectedVersion === undefined || existing.version !== input.expectedVersion)
    ) {
      throw new Error('Operations configuration version changed.');
    }
    const [saved] = await transaction.execute<{ readonly version: number }>(sql`
      INSERT INTO operations_configuration (
        tenant_id, config_key, value, branch_id, version, updated_by,
        idempotency_key, request_fingerprint
      ) VALUES (
        ${tenantId}, ${input.key}, ${JSON.stringify(input.value)}::jsonb, ${input.branchId ?? null},
        1, ${input.updatedBy}, ${input.idempotencyKey}, ${fingerprint}
      )
      ON CONFLICT (tenant_id, config_key) DO UPDATE SET
        value = EXCLUDED.value, branch_id = EXCLUDED.branch_id,
        version = operations_configuration.version + 1, updated_by = EXCLUDED.updated_by,
        updated_at = clock_timestamp(), idempotency_key = EXCLUDED.idempotency_key,
        request_fingerprint = EXCLUDED.request_fingerprint
      RETURNING version
    `);
    if (!saved) throw new Error('Unable to save Operations configuration.');
    await transaction.execute(sql`
      INSERT INTO operations_configuration_changes (
        tenant_id, config_key, branch_id, version, before_value, after_value,
        idempotency_key, request_fingerprint, actor_id
      ) VALUES (
        ${tenantId}, ${input.key}, ${input.branchId ?? null}, ${saved.version},
        ${existing ? JSON.stringify(existing.value) : null}::jsonb,
        ${JSON.stringify(input.value)}::jsonb, ${input.idempotencyKey}, ${fingerprint},
        ${input.updatedBy}
      )
    `);
    return { key: input.key, version: saved.version, replayed: false };
  });
}

async function replayBillingRun(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  input: PrepareBillingRunInput,
): Promise<BillingRunResult> {
  const [row] = await transaction.execute<{
    readonly id: string;
    readonly status: BillingRunResult['status'];
    readonly period_start: Date | string;
    readonly period_end: Date | string;
    readonly requested_by: string;
    readonly scope_branch_ids: readonly string[] | null;
    readonly scope_area_ids: readonly string[] | null;
    readonly scope_route_ids: readonly string[] | null;
    readonly retry_of_run_id: string | null;
  }>(sql`
    SELECT id, status, period_start, period_end, requested_by,
      scope_branch_ids, scope_area_ids, scope_route_ids,retry_of_run_id
    FROM operations_billing_runs
    WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
  `);
  if (
    !row ||
    day(row.period_start) !== input.periodStart ||
    day(row.period_end) !== input.periodEnd ||
    row.requested_by !== input.requestedBy ||
    stableJson(row.scope_branch_ids ?? undefined) !== stableJson(input.branchIds) ||
    stableJson(row.scope_area_ids ?? undefined) !== stableJson(input.areaIds) ||
    stableJson(row.scope_route_ids ?? undefined) !== stableJson(input.routeIds) ||
    (row.retry_of_run_id ?? undefined) !== input.retryOfRunId
  ) {
    throw new OperationsIdempotencyConflictError();
  }
  return billingResult(transaction, tenantId, row.id, input.idempotencyKey, row.status);
}

async function assertBillingRetrySource(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  input: PrepareBillingRunInput,
): Promise<void> {
  const [source] = await transaction.execute<{
    readonly status: BillingRunResult['status'];
    readonly period_start: Date | string;
    readonly period_end: Date | string;
    readonly scope_branch_ids: readonly string[] | null;
    readonly scope_area_ids: readonly string[] | null;
    readonly scope_route_ids: readonly string[] | null;
    readonly failed_count: string;
  }>(sql`
    SELECT run.status,run.period_start,run.period_end,run.scope_branch_ids,
      run.scope_area_ids,run.scope_route_ids,
      count(item.id) FILTER(WHERE item.status='failed')::text AS failed_count
    FROM operations_billing_runs run
    LEFT JOIN operations_billing_run_items item
      ON item.tenant_id=run.tenant_id AND item.billing_run_id=run.id
    WHERE run.tenant_id=${tenantId} AND run.id=${input.retryOfRunId ?? null}
    GROUP BY run.id
  `);
  if (
    !source ||
    source.status !== 'failed' ||
    safeInteger(source.failed_count) === 0 ||
    day(source.period_start) !== input.periodStart ||
    day(source.period_end) !== input.periodEnd ||
    stableJson(source.scope_branch_ids ?? undefined) !== stableJson(input.branchIds) ||
    stableJson(source.scope_area_ids ?? undefined) !== stableJson(input.areaIds) ||
    stableJson(source.scope_route_ids ?? undefined) !== stableJson(input.routeIds)
  ) {
    throw new OperationsIdempotencyConflictError();
  }
}

async function billingResult(
  transaction: TenantTransaction,
  tenantId: VerifiedTenantId,
  id: string,
  idempotencyKey: string,
  status: BillingRunResult['status'],
): Promise<BillingRunResult> {
  const [count] = await transaction.execute<{
    readonly prepared_count: string;
    readonly failed_count: string;
    readonly skipped_count: string;
    readonly retry_of_run_id: string | null;
  }>(sql`
    SELECT
      (SELECT count(*) FROM operations_invoice_preparations preparation
        WHERE preparation.tenant_id=run.tenant_id AND preparation.billing_run_id=run.id)::text
        AS prepared_count,
      count(item.id) FILTER(WHERE item.status='failed')::text AS failed_count,
      count(item.id) FILTER(WHERE item.status='skipped')::text AS skipped_count,
      run.retry_of_run_id
    FROM operations_billing_runs run
    LEFT JOIN operations_billing_run_items item
      ON item.tenant_id=run.tenant_id AND item.billing_run_id=run.id
    WHERE run.tenant_id=${tenantId} AND run.id=${id}
    GROUP BY run.id
  `);
  const failures = await transaction.execute<{
    readonly id: string;
    readonly service_id: string;
    readonly failure_code: string;
    readonly explanation_en: string;
    readonly explanation_ar: string;
    readonly attempt_number: number;
  }>(sql`
    SELECT id,service_id,failure_code,explanation_en,explanation_ar,attempt_number
    FROM operations_billing_run_items
    WHERE tenant_id=${tenantId} AND billing_run_id=${id} AND status='failed'
    ORDER BY service_id
  `);
  const failedCount = safeInteger(count?.failed_count ?? '0');
  return {
    id,
    tenantId,
    status,
    preparedCount: safeInteger(count?.prepared_count ?? '0'),
    failedCount,
    skippedCount: safeInteger(count?.skipped_count ?? '0'),
    retryableCount: failedCount,
    ...(count?.retry_of_run_id ? { retryOfRunId: count.retry_of_run_id } : {}),
    failures: failures.map((failure) => ({
      itemId: failure.id,
      serviceId: failure.service_id,
      failureCode: failure.failure_code,
      explanationEn: failure.explanation_en,
      explanationAr: failure.explanation_ar,
      attemptNumber: failure.attempt_number,
    })),
    idempotencyKey,
  };
}

function assertSubscriberReplay(
  row: SubscriberRow,
  input: CreateSubscriberRecord,
): SubscriberRecord {
  if (row.request_fingerprint !== subscriberFingerprint(input)) {
    throw new OperationsIdempotencyConflictError();
  }
  return mapSubscriber(row);
}

function subscriberFingerprint(input: CreateSubscriberRecord): string {
  return stableJson({
    subscriberNumber: input.subscriberNumber,
    displayName: input.displayName,
    householdReference: input.householdReference,
    householdName: input.householdName,
    locationLabel: input.locationLabel,
    addressLine: input.addressLine,
    branchId: input.branchId,
    areaId: input.areaId,
    routeId: input.routeId,
    areaCode: input.areaCode,
    primaryPhone: input.primaryPhone,
    idempotencyKey: input.idempotencyKey,
  });
}

function mapSubscriber(row: SubscriberRow): SubscriberRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id as VerifiedTenantId,
    subscriberNumber: row.subscriber_number,
    displayName: row.display_name,
    status: row.status,
    householdId: row.household_id,
    locationId: row.primary_location_id,
    idempotencyKey: row.idempotency_key,
  };
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

function safeInteger(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError('Operations count exceeds safe range.');
  return result;
}

function day(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function databaseCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object') return undefined;
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function installationAllowed(from: string, to: string): boolean {
  const transitions: Readonly<Record<string, readonly string[]>> = {
    requested: ['scheduled', 'cancelled'],
    scheduled: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['blocked', 'ready_for_activation', 'cancelled'],
    blocked: ['scheduled', 'in_progress', 'cancelled'],
    ready_for_activation: ['completed', 'blocked'],
    completed: [],
    cancelled: [],
  };
  return transitions[from]?.includes(to) ?? false;
}
