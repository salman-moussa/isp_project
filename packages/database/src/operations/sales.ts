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
}

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
  readonly createdAt: string;
  readonly tasks: readonly SalesOrderTask[];
}

export interface SalesWorkspace {
  readonly leads: readonly SalesLead[];
  readonly offers: readonly SalesOfferVersion[];
  readonly qualifications: readonly SalesQualification[];
  readonly quotes: readonly SalesQuote[];
  readonly orders: readonly SalesServiceOrder[];
  readonly scopes: {
    readonly branches: readonly SalesScopeItem[];
    readonly areas: readonly SalesScopeItem[];
    readonly routes: readonly SalesScopeItem[];
  };
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
    const [leads, offers, qualifications, quotes, orders, tasks, branches, areas, routes] =
      await Promise.all([
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
  readonly created_at: Date | string;
}
interface SalesOrderTaskRow extends Record<string, unknown> {
  readonly order_id: string;
  readonly task_key: string;
  readonly task_type: SalesOrderTask['type'];
  readonly depends_on_keys: string[];
  readonly status: SalesOrderTask['status'];
}
interface SalesScopeRow extends Record<string, unknown> {
  readonly id: string;
  readonly parent_id: string | null;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
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
    createdAt: iso(row.created_at),
  };
}
function mapTask(row: SalesOrderTaskRow): SalesOrderTask {
  return {
    key: row.task_key,
    type: row.task_type,
    dependsOn: row.depends_on_keys,
    status: row.status,
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
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function date(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
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
