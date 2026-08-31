import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsConflictError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

interface AuthorizedSalesRequest {
  readonly authorization: SignedOperationsDatabaseContext;
}

export interface SalesLead {
  readonly id: string;
  readonly leadNumber: string;
  readonly partyKind: 'person' | 'business';
  readonly displayName: string;
  readonly source: string;
  readonly primaryPhone?: string;
  readonly primaryEmail?: string;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly addressLine: string;
  readonly needsSummary: string;
  readonly status: 'new' | 'qualifying' | 'qualified' | 'disqualified' | 'quoted' | 'won' | 'lost';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SalesOfferVersion {
  readonly id: string;
  readonly offerId: string;
  readonly branchId?: string;
  readonly code: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly recurringAmountMinor: number;
  readonly activationFeeMinor: number;
  readonly equipmentFeeMinor: number;
  readonly currency: SupportedCurrency;
  readonly commitmentMonths: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly published: boolean;
}

export interface SalesQualification {
  readonly id: string;
  readonly leadId: string;
  readonly version: number;
  readonly result: 'eligible' | 'ineligible' | 'survey_required' | 'reserved';
  readonly accessTechnology: string;
  readonly coverageSource: string;
  readonly reasonCodes: readonly string[];
  readonly capacityReference?: string;
  readonly reservationExpiresAt?: string;
  readonly createdAt: string;
}

export interface SalesQuote {
  readonly id: string;
  readonly leadId: string;
  readonly offerVersionId: string;
  readonly quoteNumber: string;
  readonly version: number;
  readonly status: 'pending_approval' | 'issued' | 'approved' | 'rejected' | 'accepted' | 'expired';
  readonly recurringAmountMinor: number;
  readonly activationFeeMinor: number;
  readonly equipmentFeeMinor: number;
  readonly discountBasisPoints: number;
  readonly currency: SupportedCurrency;
  readonly commitmentMonths: number;
  readonly validUntil: string;
  readonly createdAt: string;
}

export interface SalesOrderTask {
  readonly key: string;
  readonly type: 'commercial' | 'subscriber' | 'resource' | 'installation' | 'network' | 'billing';
  readonly dependsOn: readonly string[];
  readonly status:
    | 'pending'
    | 'ready'
    | 'running'
    | 'completed'
    | 'blocked'
    | 'failed'
    | 'cancelled';
  readonly attempts: number;
  readonly lastError?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export type SalesOrderCommand = 'retry_task' | 'place_on_hold' | 'resume' | 'cancel';

export interface SalesServiceOrder {
  readonly id: string;
  readonly leadId: string;
  readonly quoteId: string;
  readonly orderNumber: string;
  readonly status:
    | 'accepted'
    | 'validating'
    | 'in_progress'
    | 'on_hold'
    | 'fallout'
    | 'completed'
    | 'cancelled';
  readonly subscriberId?: string;
  readonly firstInvoiceId?: string;
  readonly firstInvoicePeriodStart?: string;
  readonly firstInvoicePeriodEnd?: string;
  readonly createdAt: string;
  readonly tasks: readonly SalesOrderTask[];
}

export interface SalesWorkspace {
  readonly leads: readonly SalesLead[];
  readonly offers: readonly SalesOfferVersion[];
  readonly qualifications: readonly SalesQualification[];
  readonly quotes: readonly SalesQuote[];
  readonly orders: readonly SalesServiceOrder[];
  readonly resources: readonly CapacityResource[];
  readonly plans: readonly SalesPlan[];
  readonly billingPolicies: readonly SalesBillingPolicy[];
  readonly installations: readonly SalesInstallation[];
  readonly scopes: {
    readonly branches: readonly SalesScopeItem[];
    readonly areas: readonly SalesScopeItem[];
    readonly routes: readonly SalesScopeItem[];
  };
}

export interface CapacityResource {
  readonly id: string;
  readonly type:
    | 'pop'
    | 'sector'
    | 'olt'
    | 'fiber_port'
    | 'wireless_sector'
    | 'access_node'
    | 'capacity_pool';
  readonly code: string;
  readonly name: string;
  readonly accessTechnology: string;
  readonly totalUnits: number;
  readonly reservedUnits: number;
  readonly availableUnits: number;
  readonly branchId: string;
  readonly areaId?: string;
  readonly routeId?: string;
  readonly status: 'active' | 'maintenance' | 'retired';
}

export interface SalesPlan {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly networkProfileReference?: string;
  readonly recurringAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly branchId?: string;
}

export interface SalesBillingPolicy {
  readonly id: string;
  readonly branchId?: string;
  readonly version: number;
  readonly vatRateBasisPoints: number;
  readonly roundingMode: 'half_up' | 'down' | 'up';
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface SalesInstallation {
  readonly id: string;
  readonly orderId: string;
  readonly serviceId: string;
  readonly status:
    | 'requested'
    | 'scheduled'
    | 'in_progress'
    | 'blocked'
    | 'ready_for_activation'
    | 'completed'
    | 'cancelled';
  readonly version: number;
  readonly scheduledFor?: string;
  readonly installerUserId?: string;
  readonly blockerReason?: string;
  readonly serviceActivatedAt?: string;
}

export interface SalesScopeItem {
  readonly id: string;
  readonly parentId?: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

export async function readSalesWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest,
): Promise<SalesWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT audit_sales_workspace_read()`);
    const [
      leads,
      offers,
      qualifications,
      quotes,
      orders,
      tasks,
      resources,
      plans,
      billingPolicies,
      installations,
      branches,
      areas,
      routes,
    ] = await Promise.all([
      transaction.execute<SalesLeadRow>(sql`
        SELECT * FROM sales_leads WHERE tenant_id=${tenantId}
        ORDER BY updated_at DESC LIMIT 100
      `),
      transaction.execute<SalesOfferRow>(sql`
        SELECT * FROM sales_offer_versions WHERE tenant_id=${tenantId} AND published
          AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>current_date)
        ORDER BY code,version DESC LIMIT 100
      `),
      transaction.execute<SalesQualificationRow>(sql`
        SELECT DISTINCT ON (lead_id) * FROM sales_qualifications WHERE tenant_id=${tenantId}
        ORDER BY lead_id,version DESC
      `),
      transaction.execute<SalesQuoteRow>(sql`
        SELECT * FROM sales_quotes WHERE tenant_id=${tenantId}
        ORDER BY updated_at DESC LIMIT 100
      `),
      transaction.execute<SalesOrderRow>(sql`
        SELECT * FROM sales_service_orders WHERE tenant_id=${tenantId}
        ORDER BY updated_at DESC LIMIT 100
      `),
      transaction.execute<SalesOrderTaskRow>(sql`
        SELECT task.* FROM sales_order_tasks task
        JOIN sales_service_orders sales_order ON sales_order.tenant_id=task.tenant_id
          AND sales_order.id=task.order_id
        WHERE task.tenant_id=${tenantId}
        ORDER BY task.order_id,task.created_at
      `),
      transaction.execute<CapacityResourceRow>(sql`
          SELECT * FROM operations_capacity_resources WHERE tenant_id=${tenantId}
          ORDER BY status,code LIMIT 250
        `),
      transaction.execute<SalesPlanRow>(sql`
          SELECT id,code,name_en,name_ar,network_profile_reference,
            recurring_amount_minor,currency,branch_id
          FROM operations_plans WHERE tenant_id=${tenantId} AND active
          ORDER BY code LIMIT 250
        `),
      transaction.execute<SalesBillingPolicyRow>(sql`
          SELECT id,branch_id,version,vat_rate_basis_points,rounding_mode,
            effective_from,effective_to
          FROM operations_billing_policies WHERE tenant_id=${tenantId}
          ORDER BY branch_id NULLS FIRST,version DESC LIMIT 250
        `),
      transaction.execute<SalesInstallationRow>(sql`
          SELECT installation.id,installation.sales_order_id,installation.service_id,
            installation.status,installation.version,installation.scheduled_for,
            installation.installer_user_id,installation.blocker_reason,service.activated_at
          FROM operations_installations installation
          JOIN operations_services service ON service.tenant_id=installation.tenant_id
            AND service.id=installation.service_id
          WHERE installation.tenant_id=${tenantId} AND installation.sales_order_id IS NOT NULL
          ORDER BY installation.updated_at DESC LIMIT 100
        `),
      transaction.execute<SalesScopeRow>(sql`
          SELECT id,NULL::uuid AS parent_id,code,name_en,name_ar
          FROM operations_branches WHERE tenant_id=${tenantId} AND active ORDER BY code
        `),
      transaction.execute<SalesScopeRow>(sql`
          SELECT id,branch_id AS parent_id,code,name_en,name_ar
          FROM operations_areas WHERE tenant_id=${tenantId} AND active ORDER BY code
        `),
      transaction.execute<SalesScopeRow>(sql`
          SELECT id,area_id AS parent_id,code,name_en,name_ar
          FROM operations_routes WHERE tenant_id=${tenantId} AND active ORDER BY code
        `),
    ]);
    return {
      leads: leads.map(mapLead),
      offers: offers.map(mapOffer),
      qualifications: qualifications.map(mapQualification),
      quotes: quotes.map(mapQuote),
      orders: orders.map((order) => ({
        ...mapOrder(order),
        tasks: tasks.filter((task) => task.order_id === order.id).map(mapTask),
      })),
      resources: resources.map(mapResource),
      plans: plans.map(mapPlan),
      billingPolicies: billingPolicies.map(mapBillingPolicy),
      installations: installations.map(mapInstallation),
      scopes: {
        branches: branches.map(mapScope),
        areas: areas.map(mapScope),
        routes: routes.map(mapScope),
      },
    };
  });
}

export async function createSalesLead(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly leadNumber: string;
    readonly partyKind: 'person' | 'business';
    readonly displayName: string;
    readonly source: string;
    readonly primaryPhone?: string;
    readonly primaryEmail?: string;
    readonly branchId: string;
    readonly areaId: string;
    readonly routeId: string;
    readonly addressLine: string;
    readonly needsSummary: string;
    readonly assignedTo?: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesLead & { readonly replayed: boolean }> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<SalesLeadRow>(sql`
      INSERT INTO sales_leads(
        tenant_id,lead_number,party_kind,display_name,source,primary_phone,primary_email,
        branch_id,area_id,route_id,address_line,needs_summary,assigned_to,idempotency_key,request_fingerprint
      ) VALUES (
        ${tenantId},${input.leadNumber},${input.partyKind},${input.displayName},${input.source},
        ${input.primaryPhone ?? null},${input.primaryEmail ?? null},${input.branchId},${input.areaId},
        ${input.routeId},${input.addressLine},${input.needsSummary},${input.assignedTo ?? null},
        ${input.idempotencyKey},${fingerprint}
      ) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING *
    `);
    if (inserted) return { ...mapLead(inserted), replayed: false };
    const [existing] = await transaction.execute<SalesLeadRow>(sql`
      SELECT * FROM sales_leads WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (!existing || existing.request_fingerprint !== fingerprint)
      throw new OperationsConflictError();
    return { ...mapLead(existing), replayed: true };
  });
}

export async function createSalesOfferVersion(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly offerId?: string;
    readonly branchId?: string;
    readonly code: string;
    readonly version: number;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly accessTechnology: SalesOfferVersion['accessTechnology'];
    readonly downstreamMbps: number;
    readonly upstreamMbps: number;
    readonly quotaGb?: number;
    readonly recurringAmountMinor: number;
    readonly activationFeeMinor: number;
    readonly equipmentFeeMinor: number;
    readonly currency: SupportedCurrency;
    readonly commitmentMonths: number;
    readonly eligibility: Readonly<Record<string, unknown>>;
    readonly policy: Readonly<Record<string, unknown>>;
    readonly effectiveFrom: string;
    readonly effectiveTo?: string;
    readonly createdBy: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesOfferVersion & { readonly replayed: boolean }> {
  const offerId = input.offerId ?? randomUUID();
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${offerId}`},2301))
    `);
    const [existing] = await transaction.execute<SalesOfferRow>(sql`
      SELECT * FROM sales_offer_versions
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (existing) {
      if (existing.offer_id !== offerId && input.offerId) throw new OperationsConflictError();
      return { ...mapOffer(existing), replayed: true };
    }
    const [overlap] = await transaction.execute<{ readonly id: string }>(sql`
      SELECT id FROM sales_offer_versions WHERE tenant_id=${tenantId} AND offer_id=${offerId}
        AND daterange(effective_from,effective_to,'[)') &&
          daterange(${input.effectiveFrom}::date,${input.effectiveTo ?? null}::date,'[)') LIMIT 1
    `);
    if (overlap) throw new OperationsConflictError('Offer versions cannot have overlapping dates.');
    const [inserted] = await transaction.execute<SalesOfferRow>(sql`
      INSERT INTO sales_offer_versions(
        tenant_id,offer_id,branch_id,code,version,name_en,name_ar,access_technology,
        downstream_mbps,upstream_mbps,quota_gb,recurring_amount_minor,activation_fee_minor,
        equipment_fee_minor,currency,commitment_months,eligibility,policy,effective_from,
        effective_to,created_by,idempotency_key
      ) VALUES (
        ${tenantId},${offerId},${input.branchId ?? null},${input.code},${input.version},
        ${input.nameEn},${input.nameAr},${input.accessTechnology},${input.downstreamMbps},
        ${input.upstreamMbps},${input.quotaGb ?? null},${input.recurringAmountMinor},
        ${input.activationFeeMinor},${input.equipmentFeeMinor},${input.currency},
        ${input.commitmentMonths},${JSON.stringify(input.eligibility)}::jsonb,
        ${JSON.stringify(input.policy)}::jsonb,${input.effectiveFrom}::date,
        ${input.effectiveTo ?? null}::date,${input.createdBy},${input.idempotencyKey}
      ) RETURNING *
    `);
    if (!inserted) throw new Error('Unable to create the offer version.');
    return { ...mapOffer(inserted), replayed: false };
  });
}

export async function qualifySalesLead(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly leadId: string;
    readonly result: SalesQualification['result'];
    readonly accessTechnology: string;
    readonly coverageSource: string;
    readonly reasonCodes: readonly string[];
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly capacityReference?: string;
    readonly reservationExpiresAt?: string;
    readonly qualifiedBy: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesQualification & { readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.leadId}`},2302))
    `);
    const [existing] = await transaction.execute<SalesQualificationRow>(sql`
      SELECT * FROM sales_qualifications
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (existing) {
      if (existing.lead_id !== input.leadId || existing.result !== input.result)
        throw new OperationsConflictError();
      return { ...mapQualification(existing), replayed: true };
    }
    const [lead] = await transaction.execute<SalesLeadRow>(sql`
      SELECT * FROM sales_leads WHERE tenant_id=${tenantId} AND id=${input.leadId} FOR UPDATE
    `);
    if (!lead || !['new', 'qualifying'].includes(lead.status))
      throw new OperationsConflictError('Only a new or qualifying lead can be qualified.');
    if (lead.status === 'new') {
      await transaction.execute(sql`
        UPDATE sales_leads SET status='qualifying' WHERE tenant_id=${tenantId} AND id=${input.leadId}
      `);
    }
    const [inserted] = await transaction.execute<SalesQualificationRow>(sql`
      INSERT INTO sales_qualifications(
        tenant_id,lead_id,version,result,access_technology,coverage_source,reason_codes,
        evidence,capacity_reference,reservation_expires_at,qualified_by,idempotency_key
      ) SELECT ${tenantId},${input.leadId},coalesce(max(version),0)+1,${input.result},
        ${input.accessTechnology},${input.coverageSource},${textArray(input.reasonCodes)},
        ${JSON.stringify(input.evidence)}::jsonb,${input.capacityReference ?? null},
        ${input.reservationExpiresAt ?? null}::timestamptz,${input.qualifiedBy},${input.idempotencyKey}
      FROM sales_qualifications WHERE tenant_id=${tenantId} AND lead_id=${input.leadId}
      RETURNING *
    `);
    if (!inserted) throw new Error('Unable to qualify the lead.');
    if (input.result === 'eligible' || input.result === 'reserved') {
      await transaction.execute(sql`
        UPDATE sales_leads SET status='qualified' WHERE tenant_id=${tenantId} AND id=${input.leadId}
      `);
    } else if (input.result === 'ineligible') {
      await transaction.execute(sql`
        UPDATE sales_leads SET status='disqualified' WHERE tenant_id=${tenantId} AND id=${input.leadId}
      `);
    }
    return { ...mapQualification(inserted), replayed: false };
  });
}

export async function createSalesQuote(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly leadId: string;
    readonly offerVersionId: string;
    readonly quoteNumber: string;
    readonly version: number;
    readonly discountBasisPoints: number;
    readonly validUntil: string;
    readonly terms: Readonly<Record<string, unknown>>;
    readonly createdBy: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesQuote & { readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.leadId}`},2303))
    `);
    const [existing] = await transaction.execute<SalesQuoteRow>(sql`
      SELECT * FROM sales_quotes WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (existing) {
      if (existing.lead_id !== input.leadId || existing.offer_version_id !== input.offerVersionId)
        throw new OperationsConflictError();
      return { ...mapQuote(existing), replayed: true };
    }
    const [qualification] = await transaction.execute<SalesQualificationRow>(sql`
      SELECT * FROM sales_qualifications WHERE tenant_id=${tenantId} AND lead_id=${input.leadId}
        AND result IN ('eligible','reserved')
        AND (reservation_expires_at IS NULL OR reservation_expires_at>clock_timestamp())
      ORDER BY version DESC LIMIT 1
    `);
    const [offer] = await transaction.execute<SalesOfferRow>(sql`
      SELECT * FROM sales_offer_versions WHERE tenant_id=${tenantId} AND id=${input.offerVersionId}
        AND published AND effective_from<=current_date
        AND (effective_to IS NULL OR effective_to>current_date)
    `);
    if (!qualification || !offer)
      throw new OperationsConflictError(
        'An eligible qualification and effective offer are required.',
      );
    const status = input.discountBasisPoints > 500 ? 'pending_approval' : 'issued';
    const [inserted] = await transaction.execute<SalesQuoteRow>(sql`
      INSERT INTO sales_quotes(
        tenant_id,lead_id,qualification_id,offer_version_id,quote_number,version,status,
        recurring_amount_minor,activation_fee_minor,equipment_fee_minor,discount_basis_points,
        currency,commitment_months,valid_until,terms,created_by,idempotency_key
      ) VALUES (
        ${tenantId},${input.leadId},${qualification.id},${offer.id},${input.quoteNumber},
        ${input.version},${status},${offer.recurring_amount_minor},${offer.activation_fee_minor},
        ${offer.equipment_fee_minor},${input.discountBasisPoints},${offer.currency},
        ${offer.commitment_months},${input.validUntil}::date,${JSON.stringify(input.terms)}::jsonb,
        ${input.createdBy},${input.idempotencyKey}
      ) RETURNING *
    `);
    if (!inserted) throw new Error('Unable to create the quotation.');
    if (status === 'issued') {
      await transaction.execute(sql`
        UPDATE sales_leads SET status='quoted' WHERE tenant_id=${tenantId} AND id=${input.leadId}
          AND status='qualified'
      `);
    }
    return { ...mapQuote(inserted), replayed: false };
  });
}

export async function approveSalesQuote(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly quoteId: string;
    readonly approvedBy: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesQuote & { readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [quote] = await transaction.execute<SalesQuoteRow>(sql`
      SELECT * FROM sales_quotes WHERE tenant_id=${tenantId} AND id=${input.quoteId} FOR UPDATE
    `);
    if (!quote) throw new OperationsConflictError('Quotation was not found.');
    if (quote.status === 'approved') {
      if (quote.approval_idempotency_key !== input.idempotencyKey)
        throw new OperationsConflictError();
      return { ...mapQuote(quote), replayed: true };
    }
    if (quote.status !== 'pending_approval')
      throw new OperationsConflictError('Only a pending quotation can be approved.');
    const [updated] = await transaction.execute<SalesQuoteRow>(sql`
      UPDATE sales_quotes SET status='approved',approved_by=${input.approvedBy},
        approved_at=clock_timestamp(),approval_idempotency_key=${input.idempotencyKey}
      WHERE tenant_id=${tenantId} AND id=${input.quoteId} RETURNING *
    `);
    await transaction.execute(sql`
      UPDATE sales_leads SET status='quoted' WHERE tenant_id=${tenantId} AND id=${quote.lead_id}
        AND status='qualified'
    `);
    if (!updated) throw new Error('Unable to approve the quotation.');
    return { ...mapQuote(updated), replayed: false };
  });
}

export async function acceptSalesQuote(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly quoteId: string;
    readonly orderNumber: string;
    readonly acceptedBy: string;
    readonly acceptanceReference: string;
    readonly ownerId: string;
    readonly idempotencyKey: string;
  },
): Promise<SalesServiceOrder & { readonly replayed: boolean }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.quoteId}`},2304))
    `);
    const [existing] = await transaction.execute<SalesOrderRow>(sql`
      SELECT * FROM sales_service_orders
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (existing) {
      if (existing.quote_id !== input.quoteId) throw new OperationsConflictError();
      const tasks = await readOrderTasks(transaction, tenantId, existing.id);
      return { ...mapOrder(existing), tasks, replayed: true };
    }
    const [quote] = await transaction.execute<SalesQuoteRow>(sql`
      SELECT * FROM sales_quotes WHERE tenant_id=${tenantId} AND id=${input.quoteId} FOR UPDATE
    `);
    if (
      !quote ||
      !['issued', 'approved'].includes(quote.status) ||
      date(quote.valid_until) < today()
    )
      throw new OperationsConflictError(
        'Only a valid issued or approved quotation can be accepted.',
      );
    const [order] = await transaction.execute<SalesOrderRow>(sql`
      INSERT INTO sales_service_orders(
        tenant_id,lead_id,quote_id,order_number,owner_id,idempotency_key
      ) VALUES (
        ${tenantId},${quote.lead_id},${quote.id},${input.orderNumber},${input.ownerId},${input.idempotencyKey}
      ) RETURNING *
    `);
    if (!order) throw new Error('Unable to create the service order.');
    await transaction.execute(sql`
      UPDATE sales_quotes SET status='accepted',accepted_by=${input.acceptedBy},
        accepted_at=clock_timestamp(),acceptance_reference=${input.acceptanceReference}
      WHERE tenant_id=${tenantId} AND id=${quote.id}
    `);
    await transaction.execute(sql`
      UPDATE sales_leads SET status='won' WHERE tenant_id=${tenantId} AND id=${quote.lead_id}
        AND status='quoted'
    `);
    await transaction.execute(sql`
      INSERT INTO sales_order_tasks(tenant_id,order_id,task_key,task_type,depends_on_keys,status,completed_at)
      VALUES
        (${tenantId},${order.id},'commercial_acceptance','commercial',ARRAY[]::text[],'completed',clock_timestamp()),
        (${tenantId},${order.id},'subscriber_creation','subscriber',ARRAY['commercial_acceptance'],'ready',NULL),
        (${tenantId},${order.id},'resource_reservation','resource',ARRAY['subscriber_creation'],'pending',NULL),
        (${tenantId},${order.id},'installation','installation',ARRAY['resource_reservation'],'pending',NULL),
        (${tenantId},${order.id},'network_activation','network',ARRAY['installation'],'pending',NULL),
        (${tenantId},${order.id},'first_billing','billing',ARRAY['network_activation'],'pending',NULL)
    `);
    const tasks = await readOrderTasks(transaction, tenantId, order.id);
    return { ...mapOrder(order), tasks, replayed: false };
  });
}

export async function convertSalesOrderSubscriber(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly subscriberNumber: string;
    readonly householdReference: string;
    readonly locationLabel: string;
    readonly areaCode?: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly subscriberId: string;
  readonly householdId: string;
  readonly locationId: string;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:order-subscriber:${input.orderId}`},2305))
    `);
    const [replay] = await transaction.execute<{
      readonly order_id: string;
      readonly execution_fingerprint: string;
      readonly result_reference: Record<string, unknown>;
    }>(sql`
      SELECT order_id,execution_fingerprint,result_reference FROM sales_order_tasks
      WHERE tenant_id=${tenantId} AND execution_idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.order_id !== input.orderId || replay.execution_fingerprint !== fingerprint)
        throw new OperationsConflictError();
      return conversionResult(replay.order_id, replay.result_reference, true);
    }

    const [target] = await transaction.execute<{
      readonly order_id: string;
      readonly order_status: SalesServiceOrder['status'];
      readonly subscriber_id: string | null;
      readonly task_status: SalesOrderTask['status'];
      readonly display_name: string;
      readonly primary_phone: string | null;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly address_line: string;
    }>(sql`
      SELECT sales_order.id AS order_id,sales_order.status AS order_status,
        sales_order.subscriber_id,task.status AS task_status,lead.display_name,lead.primary_phone,
        lead.branch_id,lead.area_id,lead.route_id,lead.address_line
      FROM sales_service_orders sales_order
      JOIN sales_leads lead ON lead.tenant_id=sales_order.tenant_id AND lead.id=sales_order.lead_id
      JOIN sales_order_tasks task ON task.tenant_id=sales_order.tenant_id
        AND task.order_id=sales_order.id AND task.task_key='subscriber_creation'
      WHERE sales_order.tenant_id=${tenantId} AND sales_order.id=${input.orderId}
      FOR UPDATE OF sales_order,task
    `);
    if (!target) throw new Error('The service order is unavailable in the authorized scope.');
    if (target.subscriber_id || target.task_status === 'completed')
      throw new OperationsConflictError('The service order already has a subscriber.');
    if (
      target.task_status !== 'ready' ||
      !['accepted', 'validating', 'in_progress'].includes(target.order_status)
    )
      throw new OperationsConflictError('The subscriber task is not ready.');

    const [insertedHousehold] = await transaction.execute<{
      readonly id: string;
      readonly branch_id: string;
      readonly display_name: string;
    }>(sql`
      INSERT INTO operations_households(tenant_id,branch_id,reference_code,display_name)
      VALUES (${tenantId},${target.branch_id},${input.householdReference},${target.display_name})
      ON CONFLICT(tenant_id,reference_code) DO NOTHING
      RETURNING id,branch_id,display_name
    `);
    const household =
      insertedHousehold ??
      (
        await transaction.execute<{
          readonly id: string;
          readonly branch_id: string;
          readonly display_name: string;
        }>(sql`
      SELECT id,branch_id,display_name FROM operations_households
      WHERE tenant_id=${tenantId} AND reference_code=${input.householdReference} FOR SHARE
    `)
      )[0];
    if (!household) throw new Error('Unable to create the subscriber household.');
    if (household.branch_id !== target.branch_id || household.display_name !== target.display_name)
      throw new OperationsConflictError(
        'The household reference belongs to different customer data.',
      );

    const [location] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_locations(
        tenant_id,household_id,branch_id,area_id,route_id,label,area_code,address_line
      ) VALUES (
        ${tenantId},${household.id},${target.branch_id},${target.area_id},${target.route_id},
        ${input.locationLabel},${input.areaCode ?? null},${target.address_line}
      ) RETURNING id
    `);
    if (!location) throw new Error('Unable to create the subscriber service location.');
    const [subscriber] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_subscribers(
        tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,
        primary_location_id,display_name,branch_id,area_id,route_id
      ) VALUES (
        ${tenantId},${input.subscriberNumber},${input.idempotencyKey},${fingerprint},${household.id},
        ${location.id},${target.display_name},${target.branch_id},${target.area_id},${target.route_id}
      ) RETURNING id
    `);
    if (!subscriber) throw new Error('Unable to convert the lead into a subscriber.');
    if (target.primary_phone) {
      await transaction.execute(sql`
        INSERT INTO operations_contacts(
          tenant_id,subscriber_id,contact_kind,contact_value,label,is_primary
        ) VALUES (${tenantId},${subscriber.id},'phone',${target.primary_phone},'primary',true)
      `);
    }
    const result = {
      subscriberId: subscriber.id,
      householdId: household.id,
      locationId: location.id,
    };
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='completed',attempts=attempts+1,last_error=NULL,
        result_reference=${JSON.stringify(result)}::jsonb,execution_fingerprint=${fingerprint},
        execution_idempotency_key=${input.idempotencyKey},completed_by=${input.actorId}
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key='subscriber_creation'
    `);
    await transaction.execute(sql`
      UPDATE sales_service_orders SET subscriber_id=${subscriber.id},status='in_progress',
        updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${input.orderId}
    `);
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='ready'
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId}
        AND task_key='resource_reservation' AND status='pending'
    `);
    return { orderId: input.orderId, ...result, replayed: false };
  });
}

export async function createCapacityResource(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly type: CapacityResource['type'];
    readonly code: string;
    readonly name: string;
    readonly accessTechnology: string;
    readonly totalUnits: number;
    readonly branchId: string;
    readonly areaId?: string;
    readonly routeId?: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<CapacityResource & { readonly replayed: boolean }> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [inserted] = await transaction.execute<CapacityResourceRow>(sql`
      INSERT INTO operations_capacity_resources(
        tenant_id,resource_type,code,name,access_technology,total_units,branch_id,area_id,route_id,
        metadata,created_by,idempotency_key,request_fingerprint
      ) VALUES(
        ${tenantId},${input.type},${input.code},${input.name},${input.accessTechnology},
        ${input.totalUnits},${input.branchId},${input.areaId ?? null},${input.routeId ?? null},
        ${JSON.stringify(input.metadata)}::jsonb,${input.actorId},${input.idempotencyKey},${fingerprint}
      ) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING *
    `);
    if (inserted) return { ...mapResource(inserted), replayed: false };
    const [existing] = await transaction.execute<CapacityResourceRow>(sql`
      SELECT * FROM operations_capacity_resources
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (!existing || existing.request_fingerprint !== fingerprint)
      throw new OperationsConflictError();
    return { ...mapResource(existing), replayed: true };
  });
}

export async function reserveSalesOrderResource(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly resourceId: string;
    readonly units: number;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly reservationId: string;
  readonly resourceId: string;
  readonly units: number;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [replay] = await transaction.execute<{
      readonly id: string;
      readonly order_id: string;
      readonly resource_id: string;
      readonly units: number;
      readonly request_fingerprint: string;
    }>(sql`
      SELECT id,order_id,resource_id,units,request_fingerprint
      FROM sales_order_resource_reservations
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.order_id !== input.orderId || replay.request_fingerprint !== fingerprint)
        throw new OperationsConflictError();
      return {
        orderId: replay.order_id,
        reservationId: replay.id,
        resourceId: replay.resource_id,
        units: replay.units,
        replayed: true,
      };
    }
    const [target] = await transaction.execute<{
      readonly subscriber_id: string | null;
      readonly task_status: SalesOrderTask['status'];
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly access_technology: string;
    }>(sql`
      SELECT sales_order.subscriber_id,task.status AS task_status,lead.branch_id,lead.area_id,
        lead.route_id,offer.access_technology
      FROM sales_service_orders sales_order
      JOIN sales_leads lead ON lead.tenant_id=sales_order.tenant_id AND lead.id=sales_order.lead_id
      JOIN sales_quotes quote ON quote.tenant_id=sales_order.tenant_id AND quote.id=sales_order.quote_id
      JOIN sales_offer_versions offer ON offer.tenant_id=quote.tenant_id AND offer.id=quote.offer_version_id
      JOIN sales_order_tasks task ON task.tenant_id=sales_order.tenant_id
        AND task.order_id=sales_order.id AND task.task_key='resource_reservation'
      WHERE sales_order.tenant_id=${tenantId} AND sales_order.id=${input.orderId}
      FOR UPDATE OF sales_order,task
    `);
    if (!target?.subscriber_id || target.task_status !== 'ready')
      throw new OperationsConflictError('The resource task is not ready.');
    const [resource] = await transaction.execute<CapacityResourceRow>(sql`
      SELECT * FROM operations_capacity_resources
      WHERE tenant_id=${tenantId} AND id=${input.resourceId} FOR UPDATE
    `);
    if (
      !resource ||
      resource.status !== 'active' ||
      resource.access_technology !== target.access_technology ||
      resource.branch_id !== target.branch_id ||
      (resource.area_id !== null && resource.area_id !== target.area_id) ||
      (resource.route_id !== null && resource.route_id !== target.route_id)
    )
      throw new OperationsConflictError('The resource is not eligible for this service order.');
    if (resource.total_units - resource.reserved_units < input.units)
      throw new OperationsConflictError(
        'The selected resource has insufficient available capacity.',
      );
    const [reservation] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO sales_order_resource_reservations(
        tenant_id,order_id,resource_id,subscriber_id,units,reserved_by,idempotency_key,request_fingerprint
      ) VALUES(
        ${tenantId},${input.orderId},${resource.id},${target.subscriber_id},${input.units},
        ${input.actorId},${input.idempotencyKey},${fingerprint}
      ) RETURNING id
    `);
    if (!reservation) throw new Error('Unable to reserve the selected capacity resource.');
    await transaction.execute(sql`
      UPDATE operations_capacity_resources SET reserved_units=reserved_units+${input.units},
        updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${resource.id}
    `);
    const result = { reservationId: reservation.id, resourceId: resource.id, units: input.units };
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='completed',attempts=attempts+1,last_error=NULL,
        result_reference=${JSON.stringify(result)}::jsonb,execution_fingerprint=${fingerprint},
        execution_idempotency_key=${input.idempotencyKey},completed_by=${input.actorId}
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key='resource_reservation'
    `);
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='ready'
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId}
        AND task_key='installation' AND status='pending'
    `);
    return { orderId: input.orderId, ...result, replayed: false };
  });
}

export async function createSalesOrderInstallation(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly planId: string;
    readonly serviceNumber: string;
    readonly billingAnchorDay: number;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly serviceId: string;
  readonly installationId: string;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:order-installation:${input.idempotencyKey}`},0)
    )`);
    const [replay] = await transaction.execute<{
      readonly service_id: string;
      readonly installation_id: string;
      readonly sales_order_id: string;
      readonly plan_id: string;
      readonly service_number: string;
      readonly billing_anchor_day: number;
      readonly execution_fingerprint: string | null;
    }>(sql`
      SELECT service.id AS service_id,installation.id AS installation_id,
        installation.sales_order_id,service.plan_id,service.service_number,
        service.billing_anchor_day,task.execution_fingerprint
      FROM operations_services service
      JOIN operations_installations installation
        ON installation.tenant_id=service.tenant_id AND installation.service_id=service.id
      JOIN sales_order_tasks task ON task.tenant_id=installation.tenant_id
        AND task.order_id=installation.sales_order_id AND task.task_key='installation'
      WHERE service.tenant_id=${tenantId} AND service.idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (
        replay.sales_order_id !== input.orderId ||
        replay.plan_id !== input.planId ||
        replay.service_number !== input.serviceNumber ||
        replay.billing_anchor_day !== input.billingAnchorDay ||
        replay.execution_fingerprint !== fingerprint
      )
        throw new OperationsConflictError();
      return {
        orderId: input.orderId,
        serviceId: replay.service_id,
        installationId: replay.installation_id,
        replayed: true,
      };
    }

    const [target] = await transaction.execute<{
      readonly subscriber_id: string;
      readonly location_id: string;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly task_status: SalesOrderTask['status'];
      readonly recurring_amount_minor: string | number;
      readonly currency: SupportedCurrency;
    }>(sql`
      SELECT sales_order.subscriber_id,subscriber.primary_location_id AS location_id,
        lead.branch_id,lead.area_id,lead.route_id,task.status AS task_status,
        quote.recurring_amount_minor,quote.currency
      FROM sales_service_orders sales_order
      JOIN sales_leads lead ON lead.tenant_id=sales_order.tenant_id AND lead.id=sales_order.lead_id
      JOIN sales_quotes quote ON quote.tenant_id=sales_order.tenant_id AND quote.id=sales_order.quote_id
      JOIN operations_subscribers subscriber ON subscriber.tenant_id=sales_order.tenant_id
        AND subscriber.id=sales_order.subscriber_id
      JOIN sales_order_tasks task ON task.tenant_id=sales_order.tenant_id
        AND task.order_id=sales_order.id AND task.task_key='installation'
      WHERE sales_order.tenant_id=${tenantId} AND sales_order.id=${input.orderId}
      FOR UPDATE OF sales_order,task
    `);
    if (!target || target.task_status !== 'ready')
      throw new OperationsConflictError('The installation task is not ready.');

    const [service] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_services(
        tenant_id,subscriber_id,location_id,plan_id,service_number,status,billing_anchor_day,
        branch_id,area_id,route_id,idempotency_key
      )
      SELECT ${tenantId},${target.subscriber_id},${target.location_id},plan.id,
        ${input.serviceNumber},'pending_installation',${input.billingAnchorDay},
        ${target.branch_id},${target.area_id},${target.route_id},${input.idempotencyKey}
      FROM operations_plans plan
      WHERE plan.tenant_id=${tenantId} AND plan.id=${input.planId} AND plan.active
        AND (plan.branch_id IS NULL OR plan.branch_id=${target.branch_id})
        AND plan.recurring_amount_minor=${Number(target.recurring_amount_minor)}
        AND plan.currency=${target.currency}
      RETURNING id
    `);
    if (!service) throw new OperationsConflictError('The selected plan is not eligible.');
    const [installation] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_installations(
        tenant_id,service_id,status,branch_id,area_id,route_id,idempotency_key,sales_order_id
      ) VALUES(
        ${tenantId},${service.id},'requested',${target.branch_id},${target.area_id},
        ${target.route_id},${input.idempotencyKey},${input.orderId}
      ) RETURNING id
    `);
    if (!installation) throw new Error('Unable to create the governed installation work order.');
    const result = { serviceId: service.id, installationId: installation.id };
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='running',last_error=NULL,
        result_reference=${JSON.stringify(result)}::jsonb,execution_fingerprint=${fingerprint},
        execution_idempotency_key=${input.idempotencyKey}
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key='installation'
    `);
    return { orderId: input.orderId, ...result, replayed: false };
  });
}

export async function enqueueSalesOrderActivation(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly serviceId: string;
  readonly outboxId: string;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:order-network:${input.orderId}`},0)
    )`);
    const [replay] = await transaction.execute<{
      readonly order_id: string;
      readonly execution_fingerprint: string | null;
      readonly result_reference: Record<string, unknown> | null;
    }>(sql`
      SELECT order_id,execution_fingerprint,result_reference FROM sales_order_tasks
      WHERE tenant_id=${tenantId} AND task_key='network_activation'
        AND execution_idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.order_id !== input.orderId || replay.execution_fingerprint !== fingerprint)
        throw new OperationsConflictError();
      const serviceId = replay.result_reference?.serviceId;
      const outboxId = replay.result_reference?.outboxId;
      if (typeof serviceId !== 'string' || typeof outboxId !== 'string')
        throw new Error('The replayed activation is missing its durable references.');
      return { orderId: input.orderId, serviceId, outboxId, replayed: true };
    }

    const [target] = await transaction.execute<{
      readonly service_id: string;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly task_status: SalesOrderTask['status'];
    }>(sql`
      SELECT service.id AS service_id,service.branch_id,service.area_id,service.route_id,
        task.status AS task_status
      FROM sales_service_orders sales_order
      JOIN sales_order_tasks task ON task.tenant_id=sales_order.tenant_id
        AND task.order_id=sales_order.id AND task.task_key='network_activation'
      JOIN operations_installations installation ON installation.tenant_id=sales_order.tenant_id
        AND installation.sales_order_id=sales_order.id AND installation.status='completed'
      JOIN operations_services service ON service.tenant_id=installation.tenant_id
        AND service.id=installation.service_id AND service.status='active'
      WHERE sales_order.tenant_id=${tenantId} AND sales_order.id=${input.orderId}
      FOR UPDATE OF sales_order,task
    `);
    if (!target || target.task_status !== 'ready')
      throw new OperationsConflictError('The network activation task is not ready.');

    const [outbox] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_network_action_outbox(
        tenant_id,service_id,branch_id,area_id,route_id,action,payload,idempotency_key,requested_by
      ) VALUES(
        ${tenantId},${target.service_id},${target.branch_id},${target.area_id},${target.route_id},
        'activate','{}'::jsonb,
        ${input.idempotencyKey},${input.actorId}
      ) RETURNING id
    `);
    if (!outbox) throw new Error('Unable to queue the governed network activation.');
    const result = { serviceId: target.service_id, outboxId: outbox.id };
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='running',last_error=NULL,
        result_reference=${JSON.stringify(result)}::jsonb,execution_fingerprint=${fingerprint},
        execution_idempotency_key=${input.idempotencyKey}
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key='network_activation'
    `);
    return { orderId: input.orderId, ...result, replayed: false };
  });
}

export async function postSalesOrderFirstInvoice(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly documentNumber: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:order-first-billing:${input.orderId}`},0)
    )`);
    const [replay] = await transaction.execute<{
      readonly order_id: string;
      readonly execution_fingerprint: string | null;
      readonly result_reference: Record<string, unknown> | null;
    }>(sql`
      SELECT order_id,execution_fingerprint,result_reference FROM sales_order_tasks
      WHERE tenant_id=${tenantId} AND task_key='first_billing'
        AND execution_idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.order_id !== input.orderId || replay.execution_fingerprint !== fingerprint)
        throw new OperationsConflictError();
      return firstBillingResult(replay.order_id, replay.result_reference, true);
    }

    const [target] = await transaction.execute<{
      readonly service_id: string;
      readonly branch_id: string;
      readonly area_id: string;
      readonly route_id: string;
      readonly task_status: SalesOrderTask['status'];
      readonly activated_on: Date | string;
      readonly plan_version_id: string;
      readonly billing_policy_id: string;
      readonly subtotal_minor: string;
      readonly vat_rate_basis_points: number;
      readonly vat_minor: string;
      readonly total_minor: string;
      readonly currency: SupportedCurrency;
    }>(sql`
      SELECT service.id AS service_id,service.branch_id,service.area_id,service.route_id,
        task.status AS task_status,service.activated_at::date AS activated_on,
        plan_version.id AS plan_version_id,billing_policy.id AS billing_policy_id,
        plan_version.recurring_amount_minor::text AS subtotal_minor,
        billing_policy.vat_rate_basis_points,
        (CASE billing_policy.rounding_mode
          WHEN 'down' THEN (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points)/10000
          WHEN 'up' THEN (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points+9999)/10000
          ELSE (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points+5000)/10000
        END)::text AS vat_minor,
        (plan_version.recurring_amount_minor+CASE billing_policy.rounding_mode
          WHEN 'down' THEN (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points)/10000
          WHEN 'up' THEN (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points+9999)/10000
          ELSE (plan_version.recurring_amount_minor*billing_policy.vat_rate_basis_points+5000)/10000
        END)::text AS total_minor,plan_version.currency
      FROM sales_service_orders sales_order
      JOIN sales_order_tasks task ON task.tenant_id=sales_order.tenant_id
        AND task.order_id=sales_order.id AND task.task_key='first_billing'
      JOIN sales_order_tasks network_task ON network_task.tenant_id=sales_order.tenant_id
        AND network_task.order_id=sales_order.id AND network_task.task_key='network_activation'
        AND network_task.status='completed'
      JOIN operations_installations installation ON installation.tenant_id=sales_order.tenant_id
        AND installation.sales_order_id=sales_order.id AND installation.status='completed'
      JOIN operations_services service ON service.tenant_id=installation.tenant_id
        AND service.id=installation.service_id AND service.status='active'
      JOIN LATERAL(
        SELECT version.* FROM operations_plan_versions version
        WHERE version.tenant_id=service.tenant_id AND version.plan_id=service.plan_id
          AND version.effective_from<=${input.periodStart}::date
          AND (version.effective_to IS NULL OR version.effective_to>${input.periodStart}::date)
        ORDER BY version.version DESC LIMIT 1
      ) plan_version ON true
      JOIN LATERAL(
        SELECT policy.* FROM operations_billing_policies policy
        WHERE policy.tenant_id=service.tenant_id
          AND (policy.branch_id=service.branch_id OR policy.branch_id IS NULL)
          AND policy.effective_from<=${input.periodStart}::date
          AND (policy.effective_to IS NULL OR policy.effective_to>${input.periodStart}::date)
        ORDER BY (policy.branch_id IS NOT NULL) DESC,policy.version DESC LIMIT 1
      ) billing_policy ON true
      WHERE sales_order.tenant_id=${tenantId} AND sales_order.id=${input.orderId}
      FOR UPDATE OF sales_order,task
    `);
    if (!target || target.task_status !== 'ready')
      throw new OperationsConflictError(
        'First billing requires verified activation and an effective billing policy.',
      );
    if (date(target.activated_on) !== input.periodStart)
      throw new OperationsConflictError('The first billing period must begin on activation day.');
    const amountMinor = safeMinor(target.total_minor);
    const subtotalMinor = safeMinor(target.subtotal_minor);
    const vatMinor = safeNonnegativeMinor(target.vat_minor);

    const [existingInvoice] = await transaction.execute<{ readonly id: string }>(sql`
      SELECT id FROM finance_invoices
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (existingInvoice) throw new OperationsConflictError();

    const [context] = await transaction.execute<{
      readonly actor_id: string;
      readonly session_id: string;
      readonly support_grant_id: string | null;
      readonly request_id: string;
      readonly ip_address: string;
      readonly user_agent: string | null;
      readonly reason: string;
    }>(sql`SELECT actor_id,session_id,support_grant_id,request_id,ip_address,user_agent,reason
      FROM operations_current_context()`);
    if (!context || context.actor_id !== input.actorId)
      throw new Error('The signed billing actor does not match the request.');
    for (const [name, value] of [
      ['app.finance_actor_id', context.actor_id],
      ['app.finance_session_id', context.session_id],
      ['app.finance_support_grant_id', context.support_grant_id ?? ''],
      ['app.finance_action', 'tenant.invoice.post'],
      ['app.finance_request_id', context.request_id],
      ['app.finance_ip_address', context.ip_address],
      ['app.finance_user_agent', context.user_agent ?? ''],
      ['app.finance_permission', 'tenant.invoice.post'],
      ['app.finance_reason', context.reason],
    ] as const) {
      await transaction.execute(sql`SELECT set_config(${name},${value},true)`);
    }

    const [billingRun] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO operations_billing_runs(
        tenant_id,idempotency_key,period_start,period_end,status,requested_by,
        scope_branch_ids,scope_area_ids,scope_route_ids
      ) VALUES(
        ${tenantId},${input.idempotencyKey},${input.periodStart}::date,${input.periodEnd}::date,
        'running',${input.actorId},ARRAY[${target.branch_id}::uuid],
        ARRAY[${target.area_id}::uuid],ARRAY[${target.route_id}::uuid]
      ) RETURNING id
    `);
    if (!billingRun) throw new Error('Unable to open the first billing run.');
    const [invoice] = await transaction.execute<{ readonly id: string }>(sql`
      INSERT INTO finance_invoices(
        tenant_id,document_number,entry_kind,amount_minor,currency,idempotency_key,actor_id,posted_at
      ) VALUES(
        ${tenantId},${input.documentNumber},'posted',${amountMinor},${target.currency},
        ${input.idempotencyKey},${input.actorId},clock_timestamp()
      ) RETURNING id
    `);
    if (!invoice) throw new Error('Unable to post the immutable first invoice.');
    await transaction.execute(sql`
      INSERT INTO operations_invoice_preparations(
        tenant_id,billing_run_id,service_id,subtotal_minor,vat_rate_basis_points,vat_minor,
        currency,posting_status,finance_invoice_id,branch_id,area_id,route_id,billing_date,
        period_start,period_end,plan_version_id,billing_policy_id
      ) VALUES(
        ${tenantId},${billingRun.id},${target.service_id},${subtotalMinor},
        ${target.vat_rate_basis_points},${vatMinor},${target.currency},'posted',${invoice.id},
        ${target.branch_id},${target.area_id},${target.route_id},${input.periodStart}::date,
        ${input.periodStart}::date,${input.periodEnd}::date,${target.plan_version_id},
        ${target.billing_policy_id}
      )
    `);
    const result = {
      invoiceId: invoice.id,
      documentNumber: input.documentNumber,
      serviceId: target.service_id,
      amountMinor,
      currency: target.currency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      billingRunId: billingRun.id,
    };
    await transaction.execute(sql`
      UPDATE sales_order_tasks SET status='completed',last_error=NULL,completed_by=${input.actorId},
        result_reference=${JSON.stringify(result)}::jsonb,execution_fingerprint=${fingerprint},
        execution_idempotency_key=${input.idempotencyKey}
      WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key='first_billing'
    `);
    await transaction.execute(sql`
      UPDATE sales_service_orders SET status='completed',first_invoice_id=${invoice.id},
        first_invoice_period_start=${input.periodStart}::date,
        first_invoice_period_end=${input.periodEnd}::date,completed_at=clock_timestamp(),
        updated_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${input.orderId}
    `);
    await transaction.execute(sql`
      UPDATE operations_billing_runs SET status='succeeded',completed_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${billingRun.id}
    `);
    return {
      orderId: input.orderId,
      invoiceId: invoice.id,
      amountMinor,
      currency: target.currency,
      replayed: false,
    };
  });
}

export async function executeSalesOrderCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizedSalesRequest & {
    readonly orderId: string;
    readonly command: SalesOrderCommand;
    readonly taskKey?: string;
    readonly reason: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
  },
): Promise<{
  readonly orderId: string;
  readonly command: SalesOrderCommand;
  readonly orderStatus: SalesServiceOrder['status'];
  readonly taskKey?: string;
  readonly replayed: boolean;
}> {
  const fingerprint = digest(input, ['authorization']);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:order-command:${input.orderId}`},0)
    )`);
    const [replay] = await transaction.execute<{
      readonly order_id: string;
      readonly command: SalesOrderCommand;
      readonly task_key: string | null;
      readonly request_fingerprint: string;
      readonly result_reference: Record<string, unknown>;
    }>(sql`
      SELECT order_id,command,task_key,request_fingerprint,result_reference
      FROM sales_order_commands
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (
        replay.order_id !== input.orderId ||
        replay.command !== input.command ||
        (replay.task_key ?? undefined) !== input.taskKey ||
        replay.request_fingerprint !== fingerprint
      )
        throw new OperationsConflictError();
      return orderCommandResult(replay.order_id, replay.command, replay.result_reference, true);
    }

    const [order] = await transaction.execute<{
      readonly status: SalesServiceOrder['status'];
      readonly subscriber_id: string | null;
    }>(sql`
      SELECT status,subscriber_id FROM sales_service_orders
      WHERE tenant_id=${tenantId} AND id=${input.orderId}
      FOR UPDATE
    `);
    if (!order) throw new OperationsConflictError('The service order was not found.');

    let orderStatus: SalesServiceOrder['status'];
    if (input.command === 'retry_task') {
      if (!input.taskKey || ['completed', 'cancelled', 'on_hold'].includes(order.status))
        throw new OperationsConflictError('This order cannot retry a delivery task.');
      const [task] = await transaction.execute<{
        readonly status: SalesOrderTask['status'];
      }>(sql`
        SELECT status FROM sales_order_tasks
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key=${input.taskKey}
        FOR UPDATE
      `);
      if (!task || !['failed', 'blocked'].includes(task.status))
        throw new OperationsConflictError('Only a failed or blocked task can be retried.');
      await transaction.execute(sql`
        UPDATE sales_order_tasks SET status='ready',last_error=NULL
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND task_key=${input.taskKey}
      `);
      const [recoveredOrder] = await transaction.execute<{
        readonly status: SalesServiceOrder['status'];
      }>(sql`
        SELECT status FROM sales_service_orders
        WHERE tenant_id=${tenantId} AND id=${input.orderId}
      `);
      if (!recoveredOrder) throw new OperationsConflictError();
      orderStatus = recoveredOrder.status;
    } else if (input.command === 'place_on_hold') {
      if (!['accepted', 'in_progress', 'fallout'].includes(order.status))
        throw new OperationsConflictError('Only an active service order can be placed on hold.');
      const [running] = await transaction.execute<{ readonly count: number }>(sql`
        SELECT count(*)::integer AS count FROM sales_order_tasks
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId} AND status='running'
      `);
      if ((running?.count ?? 0) > 0)
        throw new OperationsConflictError(
          'Wait for the running delivery step before placing a hold.',
        );
      orderStatus = 'on_hold';
      await transaction.execute(sql`
        UPDATE sales_service_orders SET status=${orderStatus},updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.orderId}
      `);
    } else if (input.command === 'resume') {
      if (order.status !== 'on_hold')
        throw new OperationsConflictError('Only an order on hold can be resumed.');
      const [exceptions] = await transaction.execute<{ readonly count: number }>(sql`
        SELECT count(*)::integer AS count FROM sales_order_tasks
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId}
          AND status IN ('failed','blocked')
      `);
      orderStatus = (exceptions?.count ?? 0) > 0 ? 'fallout' : 'in_progress';
      await transaction.execute(sql`
        UPDATE sales_service_orders SET status=${orderStatus},updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.orderId}
      `);
    } else {
      if (['completed', 'cancelled'].includes(order.status))
        throw new OperationsConflictError('This service order is already terminal.');
      if (order.subscriber_id)
        throw new OperationsConflictError(
          'Orders with a subscriber require a governed service termination instead of cancellation.',
        );
      const [unsafeTask] = await transaction.execute<{ readonly task_key: string }>(sql`
        SELECT task_key FROM sales_order_tasks
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId}
          AND (status='running' OR (status='completed' AND task_key<>'commercial_acceptance'))
        LIMIT 1
      `);
      if (unsafeTask)
        throw new OperationsConflictError(
          'Cancellation is blocked because delivery side effects already exist.',
        );
      await transaction.execute(sql`
        UPDATE sales_order_tasks SET status='cancelled',last_error=${input.reason}
        WHERE tenant_id=${tenantId} AND order_id=${input.orderId}
          AND status IN ('pending','ready','blocked','failed')
      `);
      orderStatus = 'cancelled';
      await transaction.execute(sql`
        UPDATE sales_service_orders SET status=${orderStatus},updated_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${input.orderId}
      `);
    }

    const result = {
      orderStatus,
      ...(input.taskKey ? { taskKey: input.taskKey } : {}),
    };
    await transaction.execute(sql`
      INSERT INTO sales_order_commands(
        tenant_id,order_id,command,task_key,reason,request_fingerprint,result_reference,
        requested_by,idempotency_key
      ) VALUES(
        ${tenantId},${input.orderId},${input.command},${input.taskKey ?? null},${input.reason},
        ${fingerprint},${JSON.stringify(result)}::jsonb,${input.actorId},${input.idempotencyKey}
      )
    `);
    return {
      orderId: input.orderId,
      command: input.command,
      orderStatus,
      ...(input.taskKey ? { taskKey: input.taskKey } : {}),
      replayed: false,
    };
  });
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function readOrderTasks(
  transaction: Transaction,
  tenantId: VerifiedTenantId,
  orderId: string,
) {
  const rows = await transaction.execute<SalesOrderTaskRow>(sql`
    SELECT * FROM sales_order_tasks WHERE tenant_id=${tenantId} AND order_id=${orderId}
    ORDER BY created_at
  `);
  return rows.map(mapTask);
}

interface SalesLeadRow extends Record<string, unknown> {
  readonly id: string;
  readonly lead_number: string;
  readonly party_kind: SalesLead['partyKind'];
  readonly display_name: string;
  readonly source: string;
  readonly primary_phone: string | null;
  readonly primary_email: string | null;
  readonly branch_id: string;
  readonly area_id: string;
  readonly route_id: string;
  readonly address_line: string;
  readonly needs_summary: string;
  readonly status: SalesLead['status'];
  readonly request_fingerprint: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}
interface SalesOfferRow extends Record<string, unknown> {
  readonly id: string;
  readonly offer_id: string;
  readonly branch_id: string | null;
  readonly code: string;
  readonly version: number;
  readonly name_en: string;
  readonly name_ar: string;
  readonly access_technology: string;
  readonly downstream_mbps: number;
  readonly upstream_mbps: number;
  readonly quota_gb: number | null;
  readonly recurring_amount_minor: string | number;
  readonly activation_fee_minor: string | number;
  readonly equipment_fee_minor: string | number;
  readonly currency: SupportedCurrency;
  readonly commitment_months: number;
  readonly effective_from: Date | string;
  readonly effective_to: Date | string | null;
  readonly published: boolean;
}
interface SalesQualificationRow extends Record<string, unknown> {
  readonly id: string;
  readonly lead_id: string;
  readonly version: number;
  readonly result: SalesQualification['result'];
  readonly access_technology: string;
  readonly coverage_source: string;
  readonly reason_codes: string[];
  readonly capacity_reference: string | null;
  readonly reservation_expires_at: Date | string | null;
  readonly created_at: Date | string;
}
interface SalesQuoteRow extends Record<string, unknown> {
  readonly id: string;
  readonly lead_id: string;
  readonly offer_version_id: string;
  readonly quote_number: string;
  readonly version: number;
  readonly status: SalesQuote['status'];
  readonly recurring_amount_minor: string | number;
  readonly activation_fee_minor: string | number;
  readonly equipment_fee_minor: string | number;
  readonly discount_basis_points: number;
  readonly currency: SupportedCurrency;
  readonly commitment_months: number;
  readonly valid_until: Date | string;
  readonly approval_idempotency_key: string | null;
  readonly created_at: Date | string;
}
interface SalesOrderRow extends Record<string, unknown> {
  readonly id: string;
  readonly lead_id: string;
  readonly quote_id: string;
  readonly order_number: string;
  readonly status: SalesServiceOrder['status'];
  readonly subscriber_id: string | null;
  readonly first_invoice_id: string | null;
  readonly first_invoice_period_start: Date | string | null;
  readonly first_invoice_period_end: Date | string | null;
  readonly created_at: Date | string;
}
interface SalesOrderTaskRow extends Record<string, unknown> {
  readonly order_id: string;
  readonly task_key: string;
  readonly task_type: SalesOrderTask['type'];
  readonly depends_on_keys: string[];
  readonly status: SalesOrderTask['status'];
  readonly attempts: number;
  readonly last_error: string | null;
  readonly result_reference: Record<string, unknown> | null;
}
interface SalesScopeRow extends Record<string, unknown> {
  readonly id: string;
  readonly parent_id: string | null;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
}
interface CapacityResourceRow extends Record<string, unknown> {
  readonly id: string;
  readonly resource_type: CapacityResource['type'];
  readonly code: string;
  readonly name: string;
  readonly access_technology: string;
  readonly total_units: number;
  readonly reserved_units: number;
  readonly branch_id: string;
  readonly area_id: string | null;
  readonly route_id: string | null;
  readonly status: CapacityResource['status'];
  readonly request_fingerprint: string;
}
interface SalesPlanRow extends Record<string, unknown> {
  readonly id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly network_profile_reference: string | null;
  readonly recurring_amount_minor: string | number;
  readonly currency: SupportedCurrency;
  readonly branch_id: string | null;
}
interface SalesBillingPolicyRow extends Record<string, unknown> {
  readonly id: string;
  readonly branch_id: string | null;
  readonly version: number;
  readonly vat_rate_basis_points: number;
  readonly rounding_mode: SalesBillingPolicy['roundingMode'];
  readonly effective_from: Date | string;
  readonly effective_to: Date | string | null;
}
interface SalesInstallationRow extends Record<string, unknown> {
  readonly id: string;
  readonly sales_order_id: string;
  readonly service_id: string;
  readonly status: SalesInstallation['status'];
  readonly version: number;
  readonly scheduled_for: Date | string | null;
  readonly installer_user_id: string | null;
  readonly blocker_reason: string | null;
  readonly activated_at: Date | string | null;
}

function mapLead(row: SalesLeadRow): SalesLead {
  return {
    id: row.id,
    leadNumber: row.lead_number,
    partyKind: row.party_kind,
    displayName: row.display_name,
    source: row.source,
    ...(row.primary_phone ? { primaryPhone: row.primary_phone } : {}),
    ...(row.primary_email ? { primaryEmail: row.primary_email } : {}),
    branchId: row.branch_id,
    areaId: row.area_id,
    routeId: row.route_id,
    addressLine: row.address_line,
    needsSummary: row.needs_summary,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function mapOffer(row: SalesOfferRow): SalesOfferVersion {
  return {
    id: row.id,
    offerId: row.offer_id,
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    code: row.code,
    version: row.version,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    accessTechnology: row.access_technology,
    downstreamMbps: row.downstream_mbps,
    upstreamMbps: row.upstream_mbps,
    ...(row.quota_gb ? { quotaGb: row.quota_gb } : {}),
    recurringAmountMinor: Number(row.recurring_amount_minor),
    activationFeeMinor: Number(row.activation_fee_minor),
    equipmentFeeMinor: Number(row.equipment_fee_minor),
    currency: row.currency,
    commitmentMonths: row.commitment_months,
    effectiveFrom: date(row.effective_from),
    ...(row.effective_to ? { effectiveTo: date(row.effective_to) } : {}),
    published: row.published,
  };
}
function mapQualification(row: SalesQualificationRow): SalesQualification {
  return {
    id: row.id,
    leadId: row.lead_id,
    version: row.version,
    result: row.result,
    accessTechnology: row.access_technology,
    coverageSource: row.coverage_source,
    reasonCodes: row.reason_codes,
    ...(row.capacity_reference ? { capacityReference: row.capacity_reference } : {}),
    ...(row.reservation_expires_at
      ? { reservationExpiresAt: iso(row.reservation_expires_at) }
      : {}),
    createdAt: iso(row.created_at),
  };
}
function mapQuote(row: SalesQuoteRow): SalesQuote {
  return {
    id: row.id,
    leadId: row.lead_id,
    offerVersionId: row.offer_version_id,
    quoteNumber: row.quote_number,
    version: row.version,
    status: row.status,
    recurringAmountMinor: Number(row.recurring_amount_minor),
    activationFeeMinor: Number(row.activation_fee_minor),
    equipmentFeeMinor: Number(row.equipment_fee_minor),
    discountBasisPoints: row.discount_basis_points,
    currency: row.currency,
    commitmentMonths: row.commitment_months,
    validUntil: date(row.valid_until),
    createdAt: iso(row.created_at),
  };
}
function mapOrder(row: SalesOrderRow): Omit<SalesServiceOrder, 'tasks'> {
  return {
    id: row.id,
    leadId: row.lead_id,
    quoteId: row.quote_id,
    orderNumber: row.order_number,
    status: row.status,
    ...(row.subscriber_id ? { subscriberId: row.subscriber_id } : {}),
    ...(row.first_invoice_id ? { firstInvoiceId: row.first_invoice_id } : {}),
    ...(row.first_invoice_period_start
      ? { firstInvoicePeriodStart: date(row.first_invoice_period_start) }
      : {}),
    ...(row.first_invoice_period_end
      ? { firstInvoicePeriodEnd: date(row.first_invoice_period_end) }
      : {}),
    createdAt: iso(row.created_at),
  };
}
function mapTask(row: SalesOrderTaskRow): SalesOrderTask {
  return {
    key: row.task_key,
    type: row.task_type,
    dependsOn: row.depends_on_keys,
    status: row.status,
    attempts: row.attempts,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.result_reference ? { result: row.result_reference } : {}),
  };
}
function mapScope(row: SalesScopeRow): SalesScopeItem {
  return {
    id: row.id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    code: row.code,
    nameEn: row.name_en,
    nameAr: row.name_ar,
  };
}
function mapResource(row: CapacityResourceRow): CapacityResource {
  return {
    id: row.id,
    type: row.resource_type,
    code: row.code,
    name: row.name,
    accessTechnology: row.access_technology,
    totalUnits: row.total_units,
    reservedUnits: row.reserved_units,
    availableUnits: row.total_units - row.reserved_units,
    branchId: row.branch_id,
    ...(row.area_id ? { areaId: row.area_id } : {}),
    ...(row.route_id ? { routeId: row.route_id } : {}),
    status: row.status,
  };
}
function mapPlan(row: SalesPlanRow): SalesPlan {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    ...(row.network_profile_reference
      ? { networkProfileReference: row.network_profile_reference }
      : {}),
    recurringAmountMinor: Number(row.recurring_amount_minor),
    currency: row.currency,
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
  };
}
function mapBillingPolicy(row: SalesBillingPolicyRow): SalesBillingPolicy {
  return {
    id: row.id,
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    version: row.version,
    vatRateBasisPoints: row.vat_rate_basis_points,
    roundingMode: row.rounding_mode,
    effectiveFrom: date(row.effective_from),
    ...(row.effective_to ? { effectiveTo: date(row.effective_to) } : {}),
  };
}
function mapInstallation(row: SalesInstallationRow): SalesInstallation {
  return {
    id: row.id,
    orderId: row.sales_order_id,
    serviceId: row.service_id,
    status: row.status,
    version: row.version,
    ...(row.scheduled_for ? { scheduledFor: iso(row.scheduled_for) } : {}),
    ...(row.installer_user_id ? { installerUserId: row.installer_user_id } : {}),
    ...(row.blocker_reason ? { blockerReason: row.blocker_reason } : {}),
    ...(row.activated_at ? { serviceActivatedAt: iso(row.activated_at) } : {}),
  };
}
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function date(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function conversionResult(
  orderId: string,
  result: Readonly<Record<string, unknown>>,
  replayed: boolean,
) {
  const subscriberId = result.subscriberId;
  const householdId = result.householdId;
  const locationId = result.locationId;
  if (
    typeof subscriberId !== 'string' ||
    typeof householdId !== 'string' ||
    typeof locationId !== 'string'
  )
    throw new Error('The subscriber conversion result is incomplete.');
  return { orderId, subscriberId, householdId, locationId, replayed };
}
function firstBillingResult(
  orderId: string,
  result: Readonly<Record<string, unknown>> | null,
  replayed: boolean,
): {
  readonly orderId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly replayed: boolean;
} {
  const invoiceId = result?.invoiceId;
  const amountMinor = result?.amountMinor;
  const currency = result?.currency;
  if (
    typeof invoiceId !== 'string' ||
    typeof amountMinor !== 'number' ||
    (currency !== 'USD' && currency !== 'LBP')
  )
    throw new Error('The first billing result is incomplete.');
  return { orderId, invoiceId, amountMinor, currency, replayed };
}
function orderCommandResult(
  orderId: string,
  command: SalesOrderCommand,
  result: Readonly<Record<string, unknown>>,
  replayed: boolean,
): {
  readonly orderId: string;
  readonly command: SalesOrderCommand;
  readonly orderStatus: SalesServiceOrder['status'];
  readonly taskKey?: string;
  readonly replayed: boolean;
} {
  const orderStatus = result.orderStatus;
  const taskKey = result.taskKey;
  if (
    typeof orderStatus !== 'string' ||
    ![
      'accepted',
      'validating',
      'in_progress',
      'on_hold',
      'fallout',
      'completed',
      'cancelled',
    ].includes(orderStatus) ||
    (taskKey !== undefined && typeof taskKey !== 'string')
  )
    throw new Error('The service-order command result is incomplete.');
  return {
    orderId,
    command,
    orderStatus: orderStatus as SalesServiceOrder['status'],
    ...(typeof taskKey === 'string' ? { taskKey } : {}),
    replayed,
  };
}
function safeMinor(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted <= 0)
    throw new RangeError('The billed amount is outside the safe monetary range.');
  return converted;
}
function safeNonnegativeMinor(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0)
    throw new RangeError('The tax amount is outside the safe monetary range.');
  return converted;
}
function digest(value: object, omitted: readonly string[]): string {
  const entries = Object.entries(value)
    .filter(([key]) => !omitted.includes(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(entries)))
    .digest('hex');
}

function textArray(values: readonly string[]) {
  return values.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`,`,
      )}]::text[]`;
}
