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
  readonly outstandingMinor: number;
  readonly currency: SupportedCurrency;
  readonly postedAt: string;
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

export interface SubscriberWorkspace {
  readonly subscribers: readonly SubscriberWorkspaceSubscriber[];
  readonly services: readonly SubscriberWorkspaceService[];
  readonly invoices: readonly SubscriberWorkspaceInvoice[];
  readonly issues: readonly SubscriberWorkspaceIssue[];
  readonly plans: readonly SubscriberWorkspacePlan[];
  readonly serviceChanges: readonly SubscriberWorkspaceServiceChange[];
}

export async function readSubscriberWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<SubscriberWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT audit_subscriber_workspace_read()`);
    const [subscribers, contacts, services, invoices, issues, plans, serviceChanges] =
      await Promise.all([
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
          coalesce(sum(CASE allocation.entry_kind
            WHEN 'allocation' THEN allocation.amount_minor ELSE -allocation.amount_minor END),0)::text
            AS allocated_minor
        FROM operations_invoice_preparations preparation
        JOIN operations_services service ON service.tenant_id=preparation.tenant_id
          AND service.id=preparation.service_id
        JOIN finance_invoices invoice ON invoice.tenant_id=preparation.tenant_id
          AND invoice.id=preparation.finance_invoice_id AND invoice.entry_kind='posted'
        LEFT JOIN finance_payment_allocations allocation ON allocation.tenant_id=invoice.tenant_id
          AND allocation.invoice_id=invoice.id
        WHERE preparation.tenant_id=${tenantId} AND preparation.posting_status='posted'
        GROUP BY invoice.id,service.subscriber_id,preparation.service_id
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
        return {
          id: row.id,
          subscriberId: row.subscriber_id,
          serviceId: row.service_id,
          documentNumber: row.document_number,
          amountMinor,
          allocatedMinor,
          outstandingMinor: Math.max(0, amountMinor - allocatedMinor),
          currency: row.currency,
          postedAt: timestamp(row.posted_at),
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
  readonly currency: SupportedCurrency;
  readonly posted_at: Date | string;
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

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
