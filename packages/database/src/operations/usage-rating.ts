import { createHash } from 'node:crypto';
import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsConflictError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export type AddonKind = 'recurring' | 'one_time' | 'quota_topup';

export interface AddonVersionInput {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly branchId?: string;
  readonly code: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: AddonKind;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly quotaGb?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
}

export interface AddonVersionResult {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly replayed: boolean;
}

export interface ServiceAddonPurchaseInput {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly serviceId: string;
  readonly addonVersionId: string;
  readonly quantity: number;
  readonly appliesFrom: string;
  readonly appliesTo: string;
  readonly purchasedBy: string;
  readonly idempotencyKey: string;
}

export interface ServiceAddonPurchaseResult {
  readonly id: string;
  readonly serviceId: string;
  readonly addonVersionId: string;
  readonly totalAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly totalQuotaGb?: number;
  readonly replayed: boolean;
}

export interface UsageEventInput {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly serviceId: string;
  readonly source: string;
  readonly eventReference: string;
  readonly occurredAt: string;
  readonly downloadBytes: number;
  readonly uploadBytes: number;
  readonly recordedBy: string;
  readonly idempotencyKey: string;
}

export interface UsageEventResult {
  readonly id: string;
  readonly serviceId: string;
  readonly totalBytes: number;
  readonly replayed: boolean;
}

export async function createAddonVersion(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AddonVersionInput,
): Promise<AddonVersionResult> {
  const fingerprint = addonFingerprint(input);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:addon:${input.code}`},0)
    )`);
    const [replay] = await transaction.execute<AddonRow>(sql`
      SELECT id,code,version,branch_id,name_en,name_ar,addon_kind,amount_minor::text,currency,
        quota_gb::text,effective_from,effective_to,request_fingerprint
      FROM operations_addon_versions
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        throw new OperationsConflictError('The add-on idempotency key has different input.');
      return { id: replay.id, code: replay.code, version: replay.version, replayed: true };
    }
    const [overlap] = await transaction.execute<{ readonly id: string }>(sql`
      SELECT id FROM operations_addon_versions
      WHERE tenant_id=${tenantId} AND code=${input.code}
        AND branch_id IS NOT DISTINCT FROM ${input.branchId ?? null}::uuid
        AND daterange(effective_from,effective_to,'[)')
          && daterange(${input.effectiveFrom}::date,${input.effectiveTo ?? null}::date,'[)')
      LIMIT 1
    `);
    if (overlap)
      throw new OperationsConflictError(
        'An effective version already covers part of this add-on period.',
      );
    const [created] = await transaction.execute<AddonRow>(sql`
      INSERT INTO operations_addon_versions(
        tenant_id,branch_id,code,version,name_en,name_ar,addon_kind,amount_minor,currency,quota_gb,
        effective_from,effective_to,request_fingerprint,created_by,idempotency_key
      ) VALUES(
        ${tenantId},${input.branchId ?? null},${input.code},${input.version},${input.nameEn},
        ${input.nameAr},${input.kind},${input.amountMinor},${input.currency},${input.quotaGb ?? null},
        ${input.effectiveFrom}::date,${input.effectiveTo ?? null}::date,${fingerprint},
        ${input.createdBy},${input.idempotencyKey}
      ) RETURNING id,code,version,branch_id,name_en,name_ar,addon_kind,amount_minor::text,currency,
        quota_gb::text,effective_from,effective_to,request_fingerprint
    `);
    if (!created) throw new OperationsConflictError('The add-on version could not be created.');
    return { id: created.id, code: created.code, version: created.version, replayed: false };
  });
}

export async function purchaseServiceAddon(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ServiceAddonPurchaseInput,
): Promise<ServiceAddonPurchaseResult> {
  const fingerprint = purchaseFingerprint(input);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:service-rating:${input.serviceId}`},0)
    )`);
    const [replay] = await transaction.execute<PurchaseRow>(sql`
      SELECT id,service_id,addon_version_id,total_amount_minor::text,currency,
        total_quota_gb::text,request_fingerprint
      FROM operations_service_addon_purchases
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        throw new OperationsConflictError(
          'The add-on purchase idempotency key has different input.',
        );
      return purchaseResult(replay, true);
    }
    const [target] = await transaction.execute<{
      readonly service_id: string;
      readonly service_status: string;
      readonly branch_id: string;
      readonly addon_id: string;
      readonly code: string;
      readonly name_en: string;
      readonly name_ar: string;
      readonly addon_kind: AddonKind;
      readonly amount_minor: string;
      readonly currency: SupportedCurrency;
      readonly quota_gb: string | null;
      readonly plan_currency: SupportedCurrency;
    }>(sql`
      SELECT service.id AS service_id,service.status::text AS service_status,service.branch_id,
        addon.id AS addon_id,addon.code,addon.name_en,addon.name_ar,addon.addon_kind,
        addon.amount_minor::text,addon.currency,addon.quota_gb::text,
        plan_version.currency AS plan_currency
      FROM operations_services service
      JOIN operations_addon_versions addon ON addon.tenant_id=service.tenant_id
        AND addon.id=${input.addonVersionId}
        AND (addon.branch_id IS NULL OR addon.branch_id=service.branch_id)
        AND addon.effective_from<=${input.appliesFrom}::date
        AND (addon.effective_to IS NULL OR addon.effective_to>${input.appliesFrom}::date)
      JOIN LATERAL(
        SELECT version.currency FROM operations_plan_versions version
        WHERE version.tenant_id=service.tenant_id AND version.plan_id=service.plan_id
          AND version.effective_from<=${input.appliesFrom}::date
          AND (version.effective_to IS NULL OR version.effective_to>${input.appliesFrom}::date)
        ORDER BY version.version DESC LIMIT 1
      ) plan_version ON true
      WHERE service.tenant_id=${tenantId} AND service.id=${input.serviceId}
      FOR UPDATE OF service
    `);
    if (!target || !['active', 'suspended'].includes(target.service_status))
      throw new OperationsConflictError('The service or effective add-on is unavailable.');
    if (target.currency !== target.plan_currency)
      throw new OperationsConflictError(
        'The add-on currency must match the service plan currency; no implicit conversion is allowed.',
      );
    const [prepared] = await transaction.execute<{ readonly id: string }>(sql`
      SELECT id FROM operations_invoice_preparations
      WHERE tenant_id=${tenantId} AND service_id=${input.serviceId}
        AND period_start=${input.appliesFrom}::date AND period_end=${input.appliesTo}::date
      LIMIT 1
    `);
    if (prepared)
      throw new OperationsConflictError(
        'Billing is already prepared for this service period; use a governed correction.',
      );
    const [created] = await transaction.execute<PurchaseRow>(sql`
      INSERT INTO operations_service_addon_purchases(
        tenant_id,service_id,addon_version_id,addon_code,addon_name_en,addon_name_ar,addon_kind,
        quantity,unit_amount_minor,currency,quota_gb_per_unit,applies_from,applies_to,
        request_fingerprint,purchased_by,idempotency_key
      ) VALUES(
        ${tenantId},${input.serviceId},${target.addon_id},${target.code},${target.name_en},
        ${target.name_ar},${target.addon_kind},${input.quantity},${safeInteger(target.amount_minor)},
        ${target.currency},${target.quota_gb ? safeInteger(target.quota_gb) : null},
        ${input.appliesFrom}::date,${input.appliesTo}::date,${fingerprint},${input.purchasedBy},
        ${input.idempotencyKey}
      ) RETURNING id,service_id,addon_version_id,total_amount_minor::text,currency,
        total_quota_gb::text,request_fingerprint
    `);
    if (!created) throw new OperationsConflictError('The service add-on could not be purchased.');
    return purchaseResult(created, false);
  });
}

export async function recordServiceUsage(
  database: Database,
  tenantId: VerifiedTenantId,
  input: UsageEventInput,
): Promise<UsageEventResult> {
  const fingerprint = usageFingerprint(input);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [replay] = await transaction.execute<UsageRow>(sql`
      SELECT id,service_id,total_bytes::text,request_fingerprint
      FROM operations_usage_events
      WHERE tenant_id=${tenantId} AND idempotency_key=${input.idempotencyKey}
    `);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        throw new OperationsConflictError('The usage idempotency key has different input.');
      return usageResult(replay, true);
    }
    const [service] = await transaction.execute<{
      readonly id: string;
      readonly status: string;
    }>(sql`
      SELECT id,status::text FROM operations_services
      WHERE tenant_id=${tenantId} AND id=${input.serviceId}
      FOR SHARE
    `);
    if (!service || ['draft', 'pending_installation'].includes(service.status))
      throw new OperationsConflictError('Usage requires an activated subscriber service.');
    const [created] = await transaction.execute<UsageRow>(sql`
      INSERT INTO operations_usage_events(
        tenant_id,service_id,source,event_reference,occurred_at,download_bytes,upload_bytes,
        request_fingerprint,recorded_by,idempotency_key
      ) VALUES(
        ${tenantId},${input.serviceId},${input.source},${input.eventReference},
        ${input.occurredAt}::timestamptz,${input.downloadBytes},${input.uploadBytes},${fingerprint},
        ${input.recordedBy},${input.idempotencyKey}
      ) RETURNING id,service_id,total_bytes::text,request_fingerprint
    `);
    if (!created) throw new OperationsConflictError('The usage event could not be recorded.');
    return usageResult(created, false);
  });
}

interface AddonRow extends Record<string, unknown> {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly branch_id: string | null;
  readonly name_en: string;
  readonly name_ar: string;
  readonly addon_kind: AddonKind;
  readonly amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly quota_gb: string | null;
  readonly effective_from: Date | string;
  readonly effective_to: Date | string | null;
  readonly request_fingerprint: string;
}
interface PurchaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly service_id: string;
  readonly addon_version_id: string;
  readonly total_amount_minor: string;
  readonly currency: SupportedCurrency;
  readonly total_quota_gb: string | null;
  readonly request_fingerprint: string;
}
interface UsageRow extends Record<string, unknown> {
  readonly id: string;
  readonly service_id: string;
  readonly total_bytes: string;
  readonly request_fingerprint: string;
}

function purchaseResult(row: PurchaseRow, replayed: boolean): ServiceAddonPurchaseResult {
  return {
    id: row.id,
    serviceId: row.service_id,
    addonVersionId: row.addon_version_id,
    totalAmountMinor: safeInteger(row.total_amount_minor),
    currency: row.currency,
    ...(row.total_quota_gb ? { totalQuotaGb: safeInteger(row.total_quota_gb) } : {}),
    replayed,
  };
}
function usageResult(row: UsageRow, replayed: boolean): UsageEventResult {
  return {
    id: row.id,
    serviceId: row.service_id,
    totalBytes: safeInteger(row.total_bytes),
    replayed,
  };
}
function addonFingerprint(input: AddonVersionInput): string {
  return fingerprint({
    branchId: input.branchId ?? null,
    code: input.code,
    version: input.version,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    kind: input.kind,
    amountMinor: input.amountMinor,
    currency: input.currency,
    quotaGb: input.quotaGb ?? null,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    createdBy: input.createdBy,
  });
}
function purchaseFingerprint(input: ServiceAddonPurchaseInput): string {
  return fingerprint({
    serviceId: input.serviceId,
    addonVersionId: input.addonVersionId,
    quantity: input.quantity,
    appliesFrom: input.appliesFrom,
    appliesTo: input.appliesTo,
    purchasedBy: input.purchasedBy,
  });
}
function usageFingerprint(input: UsageEventInput): string {
  return fingerprint({
    serviceId: input.serviceId,
    source: input.source,
    eventReference: input.eventReference,
    occurredAt: input.occurredAt,
    downloadBytes: input.downloadBytes,
    uploadBytes: input.uploadBytes,
    recordedBy: input.recordedBy,
  });
}
function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function safeInteger(value: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0)
    throw new RangeError('Usage or rating amount is outside the safe integer range.');
  return converted;
}
