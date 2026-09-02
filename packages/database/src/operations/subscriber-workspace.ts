import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface SubscriberWorkspaceContact {
  readonly kind: 'phone' | 'email' | 'whatsapp' | 'other';
  readonly value: string;
  readonly label?: string;
  readonly primary: boolean;
}

export interface SubscriberWorkspaceSubscriber {
  readonly id: string;
  readonly subscriberNumber: string;
  readonly displayName: string;
  readonly status: 'lead' | 'active' | 'suspended' | 'closed';
  readonly householdReference: string;
  readonly householdName: string;
  readonly locationId: string;
  readonly locationLabel: string;
  readonly addressLine: string;
  readonly branchCode: string;
  readonly areaCode: string;
  readonly routeCode: string;
  readonly createdAt: string;
  readonly contacts: readonly SubscriberWorkspaceContact[];
}

export interface SubscriberWorkspaceService {
  readonly id: string;
  readonly subscriberId: string;
  readonly serviceNumber: string;
  readonly status: 'draft' | 'pending_installation' | 'active' | 'suspended' | 'terminated';
  readonly planId: string;
  readonly planCode: string;
  readonly planNameEn: string;
  readonly planNameAr: string;
  readonly recurringAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly billingAnchorDay: number;
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly billingMode: 'prepaid' | 'postpaid';
  readonly fupMode: 'none' | 'throttle' | 'cap' | 'bill';
  readonly installationStatus?: string;
  readonly activatedAt?: string;
  readonly terminatedAt?: string;
}

export interface SubscriberWorkspaceInvoice {
  readonly id: string;
  readonly subscriberId: string;
  readonly serviceId: string;
  readonly documentNumber: string;
  readonly amountMinor: number;
  readonly allocatedMinor: number;
  readonly creditedMinor: number;
  readonly reversed: boolean;
  readonly outstandingMinor: number;
  readonly currency: SupportedCurrency;
  readonly postedAt: string;
  readonly baseAmountMinor: number;
  readonly addonAmountMinor: number;
  readonly overageAmountMinor: number;
  readonly grossAmountMinor: number;
  readonly discountBasisPoints: number;
  readonly discountAmountMinor: number;
  readonly taxableAmountMinor: number;
  readonly vatRateBasisPoints: number;
  readonly vatAmountMinor: number;
  readonly stampDutyMinor: number;
  readonly legalInvoice?: Readonly<Record<string, unknown>>;
}

export interface SubscriberWorkspaceIssue {
  readonly id: string;
  readonly subscriberId?: string;
  readonly serviceId?: string;
  readonly issueNumber: string;
  readonly subject: string;
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly status: 'open' | 'triaged' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  readonly updatedAt: string;
}

export interface SubscriberWorkspacePlan {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly recurringAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly billingMode: 'prepaid' | 'postpaid';
  readonly fupMode: 'none' | 'throttle' | 'cap' | 'bill';
}

export interface SubscriberWorkspaceServiceChange {
  readonly id: string;
  readonly serviceId: string;
  readonly action: 'plan_change' | 'suspend' | 'restore' | 'terminate';
  readonly fromStatus: SubscriberWorkspaceService['status'];
  readonly toStatus: SubscriberWorkspaceService['status'];
  readonly fromPlanId: string;
  readonly toPlanId: string;
  readonly reason: string;
  readonly effectiveAt: string;
}

export interface SubscriberWorkspaceAddon {
  readonly id: string;
  readonly branchId?: string;
  readonly code: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: 'recurring' | 'one_time' | 'quota_topup';
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly quotaGb?: number;
}

export interface SubscriberWorkspaceAddonPurchase {
  readonly id: string;
  readonly serviceId: string;
  readonly addonVersionId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: SubscriberWorkspaceAddon['kind'];
  readonly quantity: number;
  readonly totalAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly totalQuotaGb?: number;
  readonly appliesFrom: string;
  readonly appliesTo: string;
  readonly purchasedAt: string;
}

export interface SubscriberWorkspaceUsageBalance {
  readonly serviceId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseQuotaGb?: number;
  readonly topupQuotaGb: number;
  readonly usedBytes: number;
  readonly remainingBytes?: number;
  readonly excessBytes: number;
  readonly overageGb: number;
  readonly projectedOverageMinor: number;
  readonly currency: SupportedCurrency;
  readonly fupMode: SubscriberWorkspaceService['fupMode'];
}

export interface SubscriberWorkspace {
  readonly subscribers: readonly SubscriberWorkspaceSubscriber[];
  readonly services: readonly SubscriberWorkspaceService[];
  readonly invoices: readonly SubscriberWorkspaceInvoice[];
  readonly issues: readonly SubscriberWorkspaceIssue[];
  readonly plans: readonly SubscriberWorkspacePlan[];
  readonly serviceChanges: readonly SubscriberWorkspaceServiceChange[];
  readonly addons: readonly SubscriberWorkspaceAddon[];
  readonly addonPurchases: readonly SubscriberWorkspaceAddonPurchase[];
  readonly usageBalances: readonly SubscriberWorkspaceUsageBalance[];
}

export async function readSubscriberWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<SubscriberWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT audit_subscriber_workspace_read()`);
    const [
      subscribers,
      contacts,
      services,
      invoices,
      issues,
      plans,
      serviceChanges,
      addons,
      addonPurchases,
      usageBalances,
    ] = await Promise.all([
      transaction.execute<SubscriberRow>(sql`
        SELECT subscriber.id,subscriber.subscriber_number,subscriber.display_name,subscriber.status,
          subscriber.created_at,household.reference_code AS household_reference,
          household.display_name AS household_name,location.id AS location_id,
          location.label AS location_label,location.address_line,branch.code AS branch_code,
          area.code AS area_code,route.code AS route_code
        FROM operations_subscribers subscriber
        JOIN operations_households household ON household.tenant_id=subscriber.tenant_id
          AND household.id=subscriber.household_id
        JOIN operations_locations location ON location.tenant_id=subscriber.tenant_id
          AND location.id=subscriber.primary_location_id
        JOIN operations_branches branch ON branch.tenant_id=subscriber.tenant_id
          AND branch.id=subscriber.branch_id
        JOIN operations_areas area ON area.tenant_id=subscriber.tenant_id
          AND area.id=subscriber.area_id
        JOIN operations_routes route ON route.tenant_id=subscriber.tenant_id
          AND route.id=subscriber.route_id
        WHERE subscriber.tenant_id=${tenantId}
        ORDER BY subscriber.updated_at DESC LIMIT 500
      `),
      transaction.execute<ContactRow>(sql`
        SELECT contact.subscriber_id,contact.contact_kind,contact.contact_value,contact.label,
          contact.is_primary
        FROM operations_contacts contact
        WHERE contact.tenant_id=${tenantId} AND contact.archived_at IS NULL
        ORDER BY contact.is_primary DESC,contact.created_at
      `),
      transaction.execute<ServiceRow>(sql`
        SELECT service.id,service.subscriber_id,service.service_number,service.status,
          service.plan_id,service.billing_anchor_day,service.activated_at,service.terminated_at,
          plan.code AS plan_code,plan.name_en AS plan_name_en,plan.name_ar AS plan_name_ar,
          plan_version.recurring_amount_minor::text,plan_version.currency,
          plan_version.access_technology,plan_version.downstream_mbps,
          plan_version.upstream_mbps,plan_version.quota_gb::text,
          plan_version.billing_mode,plan_version.fup_policy->>'mode' AS fup_mode,
          installation.status::text AS installation_status
        FROM operations_services service
        JOIN operations_plans plan ON plan.tenant_id=service.tenant_id AND plan.id=service.plan_id
        JOIN LATERAL(
          SELECT version.* FROM operations_plan_versions version
          WHERE version.tenant_id=service.tenant_id AND version.plan_id=service.plan_id
            AND version.effective_from<=current_date
            AND (version.effective_to IS NULL OR version.effective_to>current_date)
          ORDER BY version.version DESC LIMIT 1
        ) plan_version ON true
        LEFT JOIN LATERAL(
          SELECT item.status FROM operations_installations item
          WHERE item.tenant_id=service.tenant_id AND item.service_id=service.id
          ORDER BY item.created_at DESC LIMIT 1
        ) installation ON true
        WHERE service.tenant_id=${tenantId}
        ORDER BY service.updated_at DESC LIMIT 750
      `),
      transaction.execute<InvoiceRow>(sql`
        SELECT invoice.id,service.subscriber_id,preparation.service_id,invoice.document_number,
          invoice.amount_minor::text,invoice.currency,invoice.posted_at,
          preparation.base_amount_minor::text,preparation.addon_amount_minor::text,
          preparation.overage_amount_minor::text,preparation.gross_amount_minor::text,
          preparation.discount_basis_points,preparation.discount_amount_minor::text,
          preparation.subtotal_minor::text AS taxable_amount_minor,
          preparation.vat_rate_basis_points,preparation.vat_minor::text,
          preparation.stamp_duty_minor::text,preparation.legal_invoice_snapshot,
          balance.allocated_minor::text,balance.credited_minor::text,
          balance.reversed_at IS NOT NULL AS reversed
        FROM operations_invoice_preparations preparation
        JOIN operations_services service ON service.tenant_id=preparation.tenant_id
          AND service.id=preparation.service_id
        JOIN finance_invoices invoice ON invoice.tenant_id=preparation.tenant_id
          AND invoice.id=preparation.finance_invoice_id AND invoice.entry_kind='posted'
        JOIN operations_finance_balances() balance ON balance.tenant_id=invoice.tenant_id
          AND balance.document_type='invoice' AND balance.document_id=invoice.id
        WHERE preparation.tenant_id=${tenantId} AND preparation.posting_status='posted'
        ORDER BY invoice.posted_at DESC LIMIT 1000
      `),
      transaction.execute<IssueRow>(sql`
        SELECT id,subscriber_id,service_id,issue_number,subject,priority,status,updated_at
        FROM operations_support_issues WHERE tenant_id=${tenantId}
        ORDER BY updated_at DESC LIMIT 500
      `),
      transaction.execute<PlanRow>(sql`
        SELECT plan.id,plan.code,plan.name_en,plan.name_ar,
          version.recurring_amount_minor::text,version.currency,version.access_technology,
          version.downstream_mbps,version.upstream_mbps,version.quota_gb::text,
          version.billing_mode,version.fup_policy->>'mode' AS fup_mode
        FROM operations_plans plan
        JOIN LATERAL(
          SELECT item.* FROM operations_plan_versions item
          WHERE item.tenant_id=plan.tenant_id AND item.plan_id=plan.id
            AND item.effective_from<=current_date
            AND (item.effective_to IS NULL OR item.effective_to>current_date)
          ORDER BY item.version DESC LIMIT 1
        ) version ON true
        WHERE plan.tenant_id=${tenantId} AND plan.active AND plan.archived_at IS NULL
        ORDER BY plan.code LIMIT 250
      `),
      transaction.execute<ServiceChangeRow>(sql`
        SELECT id,service_id,action,from_status,to_status,from_plan_id,to_plan_id,reason,effective_at
        FROM operations_service_change_orders WHERE tenant_id=${tenantId}
        ORDER BY effective_at DESC,id DESC LIMIT 1000
      `),
      transaction.execute<AddonRow>(sql`
        SELECT id,branch_id,code,version,name_en,name_ar,addon_kind,amount_minor::text,currency,
          quota_gb::text
        FROM operations_addon_versions
        WHERE tenant_id=${tenantId} AND effective_from<=current_date
          AND (effective_to IS NULL OR effective_to>current_date)
        ORDER BY code,version DESC LIMIT 250
      `),
      transaction.execute<AddonPurchaseRow>(sql`
        SELECT id,service_id,addon_version_id,addon_code,addon_name_en,addon_name_ar,addon_kind,
          quantity,total_amount_minor::text,currency,total_quota_gb::text,applies_from,applies_to,
          purchased_at
        FROM operations_service_addon_purchases WHERE tenant_id=${tenantId}
        ORDER BY purchased_at DESC,id DESC LIMIT 1000
      `),
      transaction.execute<UsageBalanceRow>(sql`
        SELECT service.id AS service_id,cycle.period_start,cycle.period_end,
          version.quota_gb::text AS base_quota_gb,
          coalesce(addons.topup_quota_gb,0)::text AS topup_quota_gb,
          coalesce(usage.used_bytes,0)::text AS used_bytes,
          CASE WHEN version.quota_gb IS NULL THEN NULL ELSE greatest(
            (version.quota_gb+coalesce(addons.topup_quota_gb,0))*1000000000
              - coalesce(usage.used_bytes,0),0)::text END AS remaining_bytes,
          (CASE WHEN version.quota_gb IS NULL THEN 0 ELSE greatest(
            coalesce(usage.used_bytes,0)
              - (version.quota_gb+coalesce(addons.topup_quota_gb,0))*1000000000,0)
            END)::text AS excess_bytes,
          (CASE WHEN version.quota_gb IS NULL THEN 0 ELSE (
            greatest(coalesce(usage.used_bytes,0)
              - (version.quota_gb+coalesce(addons.topup_quota_gb,0))*1000000000,0)
              + 999999999)/1000000000 END)::text AS overage_gb,
          (CASE WHEN version.fup_policy->>'mode'='bill' THEN
            ((greatest(coalesce(usage.used_bytes,0)
              - (version.quota_gb+coalesce(addons.topup_quota_gb,0))*1000000000,0)
              + 999999999)/1000000000)*version.overage_per_gb_minor ELSE 0 END)::text
            AS projected_overage_minor,
          version.currency,version.fup_policy->>'mode' AS fup_mode
        FROM operations_services service
        CROSS JOIN LATERAL(
          SELECT candidate.period_start,
            (candidate.period_start+interval '1 month')::date AS period_end
          FROM LATERAL(
            SELECT CASE WHEN current_date <
              (date_trunc('month',current_date)::date+(service.billing_anchor_day-1))
              THEN (date_trunc('month',current_date)::date+(service.billing_anchor_day-1)
                - interval '1 month')::date
              ELSE date_trunc('month',current_date)::date+(service.billing_anchor_day-1)
            END AS period_start
          ) candidate
        ) cycle
        JOIN LATERAL(
          SELECT item.* FROM operations_plan_versions item
          WHERE item.tenant_id=service.tenant_id AND item.plan_id=service.plan_id
            AND item.effective_from<=current_date
            AND (item.effective_to IS NULL OR item.effective_to>current_date)
          ORDER BY item.version DESC LIMIT 1
        ) version ON true
        LEFT JOIN LATERAL(
          SELECT coalesce(sum(purchase.total_quota_gb),0)::bigint AS topup_quota_gb
          FROM operations_service_addon_purchases purchase
          WHERE purchase.tenant_id=service.tenant_id AND purchase.service_id=service.id
            AND purchase.addon_kind='quota_topup'
            AND purchase.applies_from<cycle.period_end AND purchase.applies_to>cycle.period_start
        ) addons ON true
        LEFT JOIN LATERAL(
          SELECT coalesce(sum(event.total_bytes),0)::bigint AS used_bytes
          FROM operations_usage_events event
          WHERE event.tenant_id=service.tenant_id AND event.service_id=service.id
            AND event.occurred_at>=cycle.period_start::timestamptz
            AND event.occurred_at<cycle.period_end::timestamptz
        ) usage ON true
        WHERE service.tenant_id=${tenantId}
        ORDER BY service.updated_at DESC LIMIT 750
      `),
    ]);
    return {
      subscribers: subscribers.map((row) => ({
        id: row.id,
        subscriberNumber: row.subscriber_number,
        displayName: row.display_name,
        status: row.status,
        householdReference: row.household_reference,
        householdName: row.household_name,
        locationId: row.location_id,
        locationLabel: row.location_label,
        addressLine: row.address_line,
        branchCode: row.branch_code,
        areaCode: row.area_code,
        routeCode: row.route_code,
        createdAt: timestamp(row.created_at),
        contacts: contacts
          .filter((contact) => contact.subscriber_id === row.id)
          .map((contact) => ({
            kind: contact.contact_kind,
            value: contact.contact_value,
            ...(contact.label ? { label: contact.label } : {}),
            primary: contact.is_primary,
          })),
      })),
      services: services.map((row) => ({
        id: row.id,
        subscriberId: row.subscriber_id,
        serviceNumber: row.service_number,
        status: row.status,
        planId: row.plan_id,
        planCode: row.plan_code,
        planNameEn: row.plan_name_en,
        planNameAr: row.plan_name_ar,
        recurringAmountMinor: safeMinor(row.recurring_amount_minor),
        currency: row.currency,
        billingAnchorDay: row.billing_anchor_day,
        accessTechnology: row.access_technology,
        downstreamMbps: row.downstream_mbps,
        upstreamMbps: row.upstream_mbps,
        ...(row.quota_gb ? { quotaGb: safeMinor(row.quota_gb) } : {}),
        billingMode: row.billing_mode,
        fupMode: row.fup_mode,
        ...(row.installation_status ? { installationStatus: row.installation_status } : {}),
        ...(row.activated_at ? { activatedAt: timestamp(row.activated_at) } : {}),
        ...(row.terminated_at ? { terminatedAt: timestamp(row.terminated_at) } : {}),
      })),
      invoices: invoices.map((row) => {
        const amountMinor = safeMinor(row.amount_minor);
        const allocatedMinor = safeNonnegativeMinor(row.allocated_minor);
        const creditedMinor = safeNonnegativeMinor(row.credited_minor);
        return {
          id: row.id,
          subscriberId: row.subscriber_id,
          serviceId: row.service_id,
          documentNumber: row.document_number,
          amountMinor,
          allocatedMinor,
          creditedMinor,
          reversed: row.reversed,
          outstandingMinor: row.reversed
            ? 0
            : Math.max(0, amountMinor - allocatedMinor - creditedMinor),
          currency: row.currency,
          postedAt: timestamp(row.posted_at),
          baseAmountMinor: safeMinor(row.base_amount_minor),
          addonAmountMinor: safeNonnegativeMinor(row.addon_amount_minor),
          overageAmountMinor: safeNonnegativeMinor(row.overage_amount_minor),
          grossAmountMinor: safeMinor(row.gross_amount_minor),
          discountBasisPoints: row.discount_basis_points,
          discountAmountMinor: safeNonnegativeMinor(row.discount_amount_minor),
          taxableAmountMinor: safeMinor(row.taxable_amount_minor),
          vatRateBasisPoints: row.vat_rate_basis_points,
          vatAmountMinor: safeNonnegativeMinor(row.vat_minor),
          stampDutyMinor: safeNonnegativeMinor(row.stamp_duty_minor),
          ...(row.legal_invoice_snapshot ? { legalInvoice: row.legal_invoice_snapshot } : {}),
        };
      }),
      issues: issues.map((row) => ({
        id: row.id,
        ...(row.subscriber_id ? { subscriberId: row.subscriber_id } : {}),
        ...(row.service_id ? { serviceId: row.service_id } : {}),
        issueNumber: row.issue_number,
        subject: row.subject,
        priority: row.priority,
        status: row.status,
        updatedAt: timestamp(row.updated_at),
      })),
      plans: plans.map((row) => ({
        id: row.id,
        code: row.code,
        nameEn: row.name_en,
        nameAr: row.name_ar,
        recurringAmountMinor: safeMinor(row.recurring_amount_minor),
        currency: row.currency,
        accessTechnology: row.access_technology,
        downstreamMbps: row.downstream_mbps,
        upstreamMbps: row.upstream_mbps,
        ...(row.quota_gb ? { quotaGb: safeMinor(row.quota_gb) } : {}),
        billingMode: row.billing_mode,
        fupMode: row.fup_mode,
      })),
      serviceChanges: serviceChanges.map((row) => ({
        id: row.id,
        serviceId: row.service_id,
        action: row.action,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        fromPlanId: row.from_plan_id,
        toPlanId: row.to_plan_id,
        reason: row.reason,
        effectiveAt: timestamp(row.effective_at),
      })),
      addons: addons.map((row) => ({
        id: row.id,
        ...(row.branch_id ? { branchId: row.branch_id } : {}),
        code: row.code,
        version: row.version,
        nameEn: row.name_en,
        nameAr: row.name_ar,
        kind: row.addon_kind,
        amountMinor: safeMinor(row.amount_minor),
        currency: row.currency,
        ...(row.quota_gb ? { quotaGb: safeMinor(row.quota_gb) } : {}),
      })),
      addonPurchases: addonPurchases.map((row) => ({
        id: row.id,
        serviceId: row.service_id,
        addonVersionId: row.addon_version_id,
        code: row.addon_code,
        nameEn: row.addon_name_en,
        nameAr: row.addon_name_ar,
        kind: row.addon_kind,
        quantity: row.quantity,
        totalAmountMinor: safeMinor(row.total_amount_minor),
        currency: row.currency,
        ...(row.total_quota_gb ? { totalQuotaGb: safeMinor(row.total_quota_gb) } : {}),
        appliesFrom: day(row.applies_from),
        appliesTo: day(row.applies_to),
        purchasedAt: timestamp(row.purchased_at),
      })),
      usageBalances: usageBalances.map((row) => ({
        serviceId: row.service_id,
        periodStart: day(row.period_start),
        periodEnd: day(row.period_end),
        ...(row.base_quota_gb ? { baseQuotaGb: safeMinor(row.base_quota_gb) } : {}),
        topupQuotaGb: safeNonnegativeMinor(row.topup_quota_gb),
        usedBytes: safeNonnegativeMinor(row.used_bytes),
        ...(row.remaining_bytes
          ? { remainingBytes: safeNonnegativeMinor(row.remaining_bytes) }
          : {}),
        excessBytes: safeNonnegativeMinor(row.excess_bytes),
        overageGb: safeNonnegativeMinor(row.overage_gb),
        projectedOverageMinor: safeNonnegativeMinor(row.projected_overage_minor),
        currency: row.currency,
        fupMode: row.fup_mode,
      })),
    };
  });
}

interface SubscriberRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscriber_number: string;
  readonly display_name: string;
  readonly status: SubscriberWorkspaceSubscriber['status'];
  readonly created_at: Date | string;
  readonly household_reference: string;
  readonly household_name: string;
  readonly location_id: string;
  readonly location_label: string;
  readonly address_line: string;
  readonly branch_code: string;
  readonly area_code: string;
  readonly route_code: string;
}
interface ContactRow extends Record<string, unknown> {
  readonly subscriber_id: string;
  readonly contact_kind: SubscriberWorkspaceContact['kind'];
  readonly contact_value: string;
  readonly label: string | null;
  readonly is_primary: boolean;
}
interface ServiceRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscriber_id: string;
  readonly service_number: string;
  readonly status: SubscriberWorkspaceService['status'];
  readonly plan_id: string;
  readonly billing_anchor_day: number;
  readonly activated_at: Date | string | null;
  readonly terminated_at: Date | string | null;
  readonly plan_code: string;
  readonly plan_name_en: string;
  readonly plan_name_ar: string;
  readonly recurring_amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly installation_status: string | null;
  readonly access_technology: string;
  readonly downstream_mbps: number;
  readonly upstream_mbps: number;
  readonly quota_gb: string | null;
  readonly billing_mode: 'prepaid' | 'postpaid';
  readonly fup_mode: 'none' | 'throttle' | 'cap' | 'bill';
}
interface InvoiceRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscriber_id: string;
  readonly service_id: string;
  readonly document_number: string;
  readonly amount_minor: string;
  readonly allocated_minor: string;
  readonly credited_minor: string;
  readonly reversed: boolean;
  readonly currency: SupportedCurrency;
  readonly posted_at: Date | string;
  readonly base_amount_minor: string;
  readonly addon_amount_minor: string;
  readonly overage_amount_minor: string;
  readonly gross_amount_minor: string;
  readonly discount_basis_points: number;
  readonly discount_amount_minor: string;
  readonly taxable_amount_minor: string;
  readonly vat_rate_basis_points: number;
  readonly vat_minor: string;
  readonly stamp_duty_minor: string;
  readonly legal_invoice_snapshot: Readonly<Record<string, unknown>> | null;
}
interface IssueRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscriber_id: string | null;
  readonly service_id: string | null;
  readonly issue_number: string;
  readonly subject: string;
  readonly priority: SubscriberWorkspaceIssue['priority'];
  readonly status: SubscriberWorkspaceIssue['status'];
  readonly updated_at: Date | string;
}
interface PlanRow extends Record<string, unknown> {
  readonly id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly recurring_amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly access_technology: string;
  readonly downstream_mbps: number;
  readonly upstream_mbps: number;
  readonly quota_gb: string | null;
  readonly billing_mode: 'prepaid' | 'postpaid';
  readonly fup_mode: 'none' | 'throttle' | 'cap' | 'bill';
}
interface ServiceChangeRow extends Record<string, unknown> {
  readonly id: string;
  readonly service_id: string;
  readonly action: SubscriberWorkspaceServiceChange['action'];
  readonly from_status: SubscriberWorkspaceService['status'];
  readonly to_status: SubscriberWorkspaceService['status'];
  readonly from_plan_id: string;
  readonly to_plan_id: string;
  readonly reason: string;
  readonly effective_at: Date | string;
}
interface AddonRow extends Record<string, unknown> {
  readonly id: string;
  readonly branch_id: string | null;
  readonly code: string;
  readonly version: number;
  readonly name_en: string;
  readonly name_ar: string;
  readonly addon_kind: SubscriberWorkspaceAddon['kind'];
  readonly amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly quota_gb: string | null;
}
interface AddonPurchaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly service_id: string;
  readonly addon_version_id: string;
  readonly addon_code: string;
  readonly addon_name_en: string;
  readonly addon_name_ar: string;
  readonly addon_kind: SubscriberWorkspaceAddon['kind'];
  readonly quantity: number;
  readonly total_amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly total_quota_gb: string | null;
  readonly applies_from: Date | string;
  readonly applies_to: Date | string;
  readonly purchased_at: Date | string;
}
interface UsageBalanceRow extends Record<string, unknown> {
  readonly service_id: string;
  readonly period_start: Date | string;
  readonly period_end: Date | string;
  readonly base_quota_gb: string | null;
  readonly topup_quota_gb: string;
  readonly used_bytes: string;
  readonly remaining_bytes: string | null;
  readonly excess_bytes: string;
  readonly overage_gb: string;
  readonly projected_overage_minor: string;
  readonly currency: SupportedCurrency;
  readonly fup_mode: SubscriberWorkspaceService['fupMode'];
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function day(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
function safeMinor(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted <= 0)
    throw new RangeError('Subscriber finance amount is outside the safe monetary range.');
  return converted;
}
function safeNonnegativeMinor(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0)
    throw new RangeError('Subscriber allocation amount is outside the safe monetary range.');
  return converted;
}
