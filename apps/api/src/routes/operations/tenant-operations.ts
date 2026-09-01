import { errorResponseJsonSchema, type Permission, type VerifiedTenantId } from '@isp/contracts';
import { assertPermission, assertTenantContext, AuthorizationDeniedError } from '@isp/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditWriter } from '../../audit.js';
import type { SecurityAuditWriter } from '../../security-audit.js';
import type { OperationsDefinition, OperationsWriter } from './contracts.js';

const tenantParams = z.object({ tenantId: z.uuid() });
const headers = z.object({ 'idempotency-key': z.string().trim().min(8).max(200) });
const uuid = z.uuid();
const scopedLocation = { branchId: uuid, areaId: uuid, routeId: uuid } as const;
const businessReason = z.string().trim().min(8).max(1000);

const salesLeadBody = z
  .object({
    leadNumber: z.string().trim().min(1).max(80),
    partyKind: z.enum(['person', 'business']),
    displayName: z.string().trim().min(1).max(200),
    source: z.string().trim().min(1).max(100),
    primaryPhone: z.string().trim().min(3).max(40).optional(),
    primaryEmail: z.email().max(320).optional(),
    ...scopedLocation,
    addressLine: z.string().trim().min(3).max(500),
    needsSummary: z.string().trim().min(3).max(1000),
    assignedTo: uuid.optional(),
    reason: businessReason,
  })
  .strict();
const salesOfferBody = z
  .object({
    offerId: uuid.optional(),
    branchId: uuid.optional(),
    code: z.string().trim().min(1).max(80),
    version: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(200),
    nameAr: z.string().trim().min(1).max(200),
    accessTechnology: z.enum([
      'fiber',
      'fixed_wireless',
      'dsl',
      'leased_line',
      'satellite',
      'other',
    ]),
    downstreamMbps: z.number().int().positive().max(100_000),
    upstreamMbps: z.number().int().positive().max(100_000),
    quotaGb: z.number().int().positive().max(10_000_000).optional(),
    recurringAmountMinor: z.number().int().positive().safe(),
    activationFeeMinor: z.number().int().nonnegative().safe(),
    equipmentFeeMinor: z.number().int().nonnegative().safe(),
    currency: z.enum(['USD', 'LBP']),
    commitmentMonths: z.number().int().min(0).max(60),
    eligibility: z.record(z.string(), z.unknown()).default({}),
    policy: z.record(z.string(), z.unknown()).default({}),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    reason: businessReason,
  })
  .strict()
  .refine(
    (body) => body.effectiveTo === undefined || body.effectiveTo > body.effectiveFrom,
    'Offer version end must follow its start.',
  );
const salesQualificationBody = z
  .object({
    leadId: uuid,
    result: z.enum(['eligible', 'ineligible', 'survey_required', 'reserved']),
    accessTechnology: z.string().trim().min(1).max(80),
    coverageSource: z.string().trim().min(1).max(200),
    reasonCodes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    evidence: z.record(z.string(), z.unknown()).default({}),
    capacityReference: z.string().trim().min(1).max(200).optional(),
    reservationExpiresAt: z.string().datetime({ offset: true }).optional(),
    reason: businessReason,
  })
  .strict()
  .refine(
    (body) => (body.result === 'reserved') === (body.reservationExpiresAt !== undefined),
    'Reserved qualifications require an expiration; other results must omit it.',
  );
const salesQuoteBody = z
  .object({
    leadId: uuid,
    offerVersionId: uuid,
    quoteNumber: z.string().trim().min(1).max(80),
    version: z.number().int().positive(),
    discountBasisPoints: z.number().int().min(0).max(3000),
    validUntil: z.iso.date(),
    terms: z.record(z.string(), z.unknown()).default({}),
    reason: businessReason,
  })
  .strict();
const salesQuoteApprovalBody = z.object({ quoteId: uuid, reason: businessReason }).strict();
const salesQuoteAcceptanceBody = z
  .object({
    quoteId: uuid,
    orderNumber: z.string().trim().min(1).max(80),
    acceptedBy: z.string().trim().min(2).max(200),
    acceptanceReference: z.string().trim().min(3).max(200),
    ownerId: uuid.optional(),
    reason: businessReason,
  })
  .strict();
const salesOrderSubscriberBody = z
  .object({
    orderId: uuid,
    subscriberNumber: z.string().trim().min(1).max(80),
    householdReference: z.string().trim().min(1).max(80),
    locationLabel: z.string().trim().min(1).max(100),
    areaCode: z.string().trim().min(1).max(80).optional(),
    reason: businessReason,
  })
  .strict();
const capacityResourceBody = z
  .object({
    type: z.enum([
      'pop',
      'sector',
      'olt',
      'fiber_port',
      'wireless_sector',
      'access_node',
      'capacity_pool',
    ]),
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    accessTechnology: z.enum([
      'fiber',
      'fixed_wireless',
      'dsl',
      'leased_line',
      'satellite',
      'other',
    ]),
    totalUnits: z.number().int().positive().max(1_000_000),
    branchId: uuid,
    areaId: uuid.optional(),
    routeId: uuid.optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    reason: businessReason,
  })
  .strict();
const salesOrderResourceBody = z
  .object({
    orderId: uuid,
    resourceId: uuid,
    units: z.number().int().positive().max(1_000_000),
    reason: businessReason,
  })
  .strict();
const salesOrderInstallationBody = z
  .object({
    orderId: uuid,
    planId: uuid,
    serviceNumber: z.string().trim().min(1).max(80),
    billingAnchorDay: z.number().int().min(1).max(28),
    reason: businessReason,
  })
  .strict();
const salesOrderNetworkBody = z.object({ orderId: uuid, reason: businessReason }).strict();
const salesOrderCommandBody = z
  .object({
    orderId: uuid,
    command: z.enum(['retry_task', 'place_on_hold', 'resume', 'cancel']),
    taskKey: z.string().trim().min(1).max(80).optional(),
    reason: businessReason,
  })
  .strict()
  .superRefine((body, context) => {
    if ((body.command === 'retry_task') !== Boolean(body.taskKey)) {
      context.addIssue({
        code: 'custom',
        path: ['taskKey'],
        message: 'taskKey is required only for retry_task',
      });
    }
  });
const salesOrderFirstBillingBody = z
  .object({
    orderId: uuid,
    documentNumber: z.string().trim().min(1).max(100),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    reason: businessReason,
  })
  .strict()
  .superRefine((body, context) => {
    const start = new Date(`${body.periodStart}T00:00:00.000Z`);
    const end = new Date(`${body.periodEnd}T00:00:00.000Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    if (days < 1 || days > 31) {
      context.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: 'First billing period must contain between 1 and 31 days.',
      });
    }
  });

const subscriberBody = z
  .object({
    subscriberNumber: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(200),
    householdReference: z.string().trim().min(1).max(80),
    householdName: z.string().trim().min(1).max(200),
    locationLabel: z.string().trim().min(1).max(100),
    addressLine: z.string().trim().min(1).max(500),
    ...scopedLocation,
    areaCode: z.string().trim().min(1).max(80).optional(),
    primaryPhone: z.string().trim().min(3).max(40).optional(),
  })
  .strict();
const billingBody = z
  .object({ periodStart: z.iso.date(), periodEnd: z.iso.date() })
  .strict()
  .refine((body) => body.periodEnd > body.periodStart, 'Billing period end must follow its start.');
const officePaymentBody = z
  .object({
    subscriberId: uuid,
    financePaymentId: uuid,
    ...scopedLocation,
    receiptNumber: z.string().trim().min(1).max(120),
    amountMinor: z.number().int().positive().safe(),
    currency: z.enum(['USD', 'LBP']),
  })
  .strict();
const correctionBody = z
  .object({
    paymentRequestId: uuid,
    financeAllocationId: uuid.optional(),
    previousCorrectionId: uuid.optional(),
    correctionKind: z.enum(['allocation', 'reversal', 'note']),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict()
  .superRefine((body, context) => {
    if ((body.correctionKind === 'note') === (body.financeAllocationId !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['financeAllocationId'],
        message:
          'Notes omit finance allocation evidence; allocation and reversal corrections require it.',
      });
    }
  });
const planVersionBody = z
  .object({
    planId: uuid.optional(),
    branchId: uuid.optional(),
    code: z.string().trim().min(1).max(80),
    nameEn: z.string().trim().min(1).max(200),
    nameAr: z.string().trim().min(1).max(200),
    networkProfileReference: z.string().trim().min(1).max(200).optional(),
    accessTechnology: z.string().trim().min(1).max(80),
    downstreamMbps: z.number().int().positive().max(1_000_000),
    upstreamMbps: z.number().int().positive().max(1_000_000),
    quotaGb: z.number().int().positive().safe().optional(),
    billingMode: z.enum(['prepaid', 'postpaid']),
    prorationMode: z.enum(['none', 'daily']),
    fupPolicy: z
      .object({ mode: z.enum(['none', 'throttle', 'cap', 'bill']) })
      .catchall(z.unknown()),
    includedAddons: z.array(z.record(z.string(), z.unknown())).max(50),
    overagePerGbMinor: z.number().int().positive().safe().optional(),
    version: z.number().int().positive(),
    recurringAmountMinor: z.number().int().positive().safe(),
    currency: z.enum(['USD', 'LBP']),
    billingIntervalMonths: z.number().int().min(1).max(24),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
  })
  .strict()
  .refine(
    (body) => (body.fupPolicy.mode === 'bill') === (body.overagePerGbMinor !== undefined),
    'Billable overage requires a positive per-GB price; other FUP modes must omit it.',
  )
  .refine(
    (body) => body.effectiveTo === undefined || body.effectiveTo > body.effectiveFrom,
    'Plan version end must follow its start.',
  );
const serviceInstallationBody = z
  .object({
    subscriberId: uuid,
    locationId: uuid,
    planId: uuid,
    serviceNumber: z.string().trim().min(1).max(80),
    billingAnchorDay: z.number().int().min(1).max(28),
    ...scopedLocation,
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    installerUserId: uuid.optional(),
  })
  .strict()
  .refine(
    (body) => (body.scheduledFor === undefined) === (body.installerUserId === undefined),
    'A schedule and installer must be supplied together.',
  );
const addonVersionBody = z
  .object({
    branchId: uuid.optional(),
    code: z.string().trim().min(1).max(80),
    version: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(200),
    nameAr: z.string().trim().min(1).max(200),
    kind: z.enum(['recurring', 'one_time', 'quota_topup']),
    amountMinor: z.number().int().positive().safe(),
    currency: z.enum(['USD', 'LBP']),
    quotaGb: z.number().int().positive().safe().optional(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    reason: businessReason,
  })
  .strict()
  .refine(
    (body) => (body.kind === 'quota_topup') === (body.quotaGb !== undefined),
    'Quota top-ups require a positive quota; other add-ons must omit it.',
  )
  .refine(
    (body) => body.effectiveTo === undefined || body.effectiveTo > body.effectiveFrom,
    'Add-on version end must follow its start.',
  );
const serviceAddonPurchaseBody = z
  .object({
    serviceId: uuid,
    addonVersionId: uuid,
    quantity: z.number().int().positive().max(1000),
    appliesFrom: z.iso.date(),
    appliesTo: z.iso.date(),
    reason: businessReason,
  })
  .strict()
  .refine(
    (body) => body.appliesTo > body.appliesFrom,
    'Purchase period end must follow its start.',
  );
const usageEventBody = z
  .object({
    serviceId: uuid,
    source: z.string().trim().min(1).max(80),
    eventReference: z.string().trim().min(1).max(200),
    occurredAt: z.string().datetime({ offset: true }),
    downloadBytes: z.number().int().nonnegative().safe(),
    uploadBytes: z.number().int().nonnegative().safe(),
    reason: businessReason,
  })
  .strict()
  .refine(
    (body) => body.downloadBytes + body.uploadBytes > 0,
    'A usage event must contain transferred bytes.',
  );
const billingPolicyBody = z
  .object({
    branchId: uuid.optional(),
    version: z.number().int().positive(),
    vatRateBasisPoints: z.number().int().min(0).max(10_000),
    roundingMode: z.enum(['half_up', 'down', 'up']),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
  })
  .strict()
  .refine(
    (body) => body.effectiveTo === undefined || body.effectiveTo > body.effectiveFrom,
    'Billing policy end must follow its start.',
  );
const assignmentBody = z
  .object({
    collectorUserId: uuid,
    subscriberId: uuid,
    routeId: uuid,
    financeInvoiceId: uuid,
    dueOn: z.iso.date(),
  })
  .strict();
const collectorEvidenceBody = z.object({ assignmentId: uuid, financePaymentId: uuid }).strict();
const reconciliationBody = z
  .object({
    collectorUserId: uuid,
    routeId: uuid,
    businessDate: z.iso.date(),
    currency: z.enum(['USD', 'LBP']),
    previousReconciliationId: uuid.optional(),
    reason: z.string().trim().min(8).max(1000).optional(),
  })
  .strict();
const installationTransitionBase = {
  installationId: uuid,
  expectedVersion: z.number().int().positive(),
} as const;
const installationCompletionEvidence = z
  .object({
    signalTest: z.string().trim().min(1).max(500),
    equipmentSerial: z.string().trim().min(1).max(200),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const installationBody = z.discriminatedUnion('toStatus', [
  z
    .object({
      ...installationTransitionBase,
      toStatus: z.literal('scheduled'),
      note: z.string().trim().min(1).max(2000).optional(),
      evidence: z
        .object({
          scheduledFor: z.string().datetime({ offset: true }),
          installerUserId: uuid,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...installationTransitionBase,
      toStatus: z.literal('blocked'),
      note: z.string().trim().min(8).max(2000),
      evidence: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...installationTransitionBase,
      toStatus: z.enum(['ready_for_activation', 'completed']),
      note: z.string().trim().min(1).max(2000).optional(),
      evidence: installationCompletionEvidence,
    })
    .strict(),
  z
    .object({
      ...installationTransitionBase,
      toStatus: z.enum(['in_progress', 'cancelled']),
      note: z.string().trim().min(1).max(2000).optional(),
      evidence: z.object({}).strict(),
    })
    .strict(),
]);
const issueBody = z
  .object({
    issueNumber: z.string().trim().min(1).max(80),
    subject: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(5000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    subscriberId: uuid.optional(),
    serviceId: uuid.optional(),
    ...scopedLocation,
  })
  .strict()
  .refine(
    (value) => value.subscriberId || value.serviceId,
    'An issue must identify a subscriber or service.',
  );
const issueTransitionBase = {
  issueId: uuid,
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(1).max(2000).optional(),
} as const;
const issueTransitionBody = z.discriminatedUnion('toStatus', [
  z
    .object({
      ...issueTransitionBase,
      toStatus: z.enum(['resolved', 'closed']),
      evidence: z.object({ resolutionCode: z.string().trim().min(1).max(120) }).strict(),
    })
    .strict(),
  z
    .object({
      ...issueTransitionBase,
      toStatus: z.enum(['triaged', 'in_progress', 'waiting']),
      evidence: z.object({}).strict(),
    })
    .strict(),
]);
const exportBody = z
  .object({
    reportKey: z.string().trim().min(1).max(120),
    filters: z.record(z.string(), z.unknown()).default({}),
    format: z.enum(['csv', 'xlsx', 'pdf']),
  })
  .strict();
const configurationBody = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^(?!.*(?:secret|password|credential|token|private[_-]?key))/i),
    value: z.record(z.string(), z.unknown()),
    branchId: uuid.optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (body) => !containsSecretKey(body.value),
    'Configuration must contain secret-store references only.',
  );
const networkBody = z.discriminatedUnion('action', [
  z
    .object({
      serviceId: uuid,
      action: z.enum(['activate', 'restore']),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      serviceId: uuid,
      action: z.literal('change_profile'),
      payload: z
        .object({
          profileReference: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      serviceId: uuid,
      action: z.enum(['suspend', 'terminate']),
      payload: z
        .object({
          reasonCode: z.string().trim().min(1).max(120),
        })
        .strict(),
    })
    .strict(),
]);
const serviceChangeBody = z.discriminatedUnion('action', [
  z
    .object({
      serviceId: uuid,
      action: z.literal('plan_change'),
      targetPlanId: uuid,
      reason: z.string().trim().min(8).max(500),
    })
    .strict(),
  z
    .object({
      serviceId: uuid,
      action: z.enum(['suspend', 'restore', 'terminate']),
      reason: z.string().trim().min(8).max(500),
    })
    .strict(),
]);

export const operationsRequestSchemas = {
  salesLeadBody,
  salesOfferBody,
  salesQualificationBody,
  salesQuoteBody,
  salesQuoteApprovalBody,
  salesQuoteAcceptanceBody,
  salesOrderSubscriberBody,
  capacityResourceBody,
  salesOrderResourceBody,
  salesOrderInstallationBody,
  subscriberBody,
  billingBody,
  officePaymentBody,
  correctionBody,
  planVersionBody,
  billingPolicyBody,
  serviceInstallationBody,
  assignmentBody,
  collectorEvidenceBody,
  reconciliationBody,
  installationBody,
  issueBody,
  issueTransitionBody,
  exportBody,
  configurationBody,
  networkBody,
  serviceChangeBody,
} as const;

interface RouteSpec extends OperationsDefinition {
  readonly schema: z.ZodType;
  readonly requiresRecentMfa?: boolean;
  readonly additionalPermissions?: readonly Permission[];
  readonly execute: (
    writer: OperationsWriter,
    tenantId: VerifiedTenantId,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
}
export interface TenantOperationsRouteOptions {
  readonly audit: AuditWriter;
  readonly securityAudit: SecurityAuditWriter;
  readonly writer: OperationsWriter;
  readonly now: () => Date;
}

export function registerTenantOperationsRoutes(
  app: FastifyInstance,
  options: TenantOperationsRouteOptions,
): void {
  const routes: readonly RouteSpec[] = [
    operation(
      '/sales/leads',
      'createSalesLead',
      'tenant.sales.manage',
      'tenant.sales.lead.create',
      'sales_lead',
      salesLeadBody,
      (w, id, v) => w.createSalesLead(id, v as never),
    ),
    operation(
      '/sales/offers',
      'createSalesOfferVersion',
      'tenant.catalog.manage',
      'tenant.catalog.offer.version.create',
      'sales_offer_version',
      salesOfferBody,
      (w, id, v) => w.createSalesOfferVersion(id, v as never),
    ),
    operation(
      '/sales/qualifications',
      'qualifySalesLead',
      'tenant.sales.manage',
      'tenant.sales.qualify',
      'sales_qualification',
      salesQualificationBody,
      (w, id, v) => w.qualifySalesLead(id, v as never),
    ),
    operation(
      '/sales/quotes',
      'createSalesQuote',
      'tenant.sales.manage',
      'tenant.sales.quote.create',
      'sales_quote',
      salesQuoteBody,
      (w, id, v) => w.createSalesQuote(id, v as never),
    ),
    operation(
      '/sales/quotes/approve',
      'approveSalesQuote',
      'tenant.catalog.manage',
      'tenant.sales.quote.approve',
      'sales_quote',
      salesQuoteApprovalBody,
      (w, id, v) => w.approveSalesQuote(id, v as never),
      true,
    ),
    operation(
      '/sales/quotes/accept',
      'acceptSalesQuote',
      'tenant.order.manage',
      'tenant.sales.quote.accept',
      'sales_service_order',
      salesQuoteAcceptanceBody,
      (w, id, v) => w.acceptSalesQuote(id, v as never),
      true,
    ),
    operation(
      '/sales/orders/subscriber',
      'convertSalesOrderSubscriber',
      'tenant.subscriber.create',
      'tenant.subscriber.create',
      'sales_service_order',
      salesOrderSubscriberBody,
      (w, id, v) => w.convertSalesOrderSubscriber(id, v as never),
      false,
      ['tenant.order.manage'],
    ),
    operation(
      '/sales/resources',
      'createCapacityResource',
      'tenant.network.job.create',
      'tenant.resource.create',
      'operations_capacity_resource',
      capacityResourceBody,
      (w, id, v) => w.createCapacityResource(id, v as never),
    ),
    operation(
      '/sales/orders/resource',
      'reserveSalesOrderResource',
      'tenant.network.job.create',
      'tenant.resource.reserve',
      'sales_order_resource_reservation',
      salesOrderResourceBody,
      (w, id, v) => w.reserveSalesOrderResource(id, v as never),
      false,
      ['tenant.order.manage'],
    ),
    operation(
      '/sales/orders/installation',
      'createSalesOrderInstallation',
      'tenant.installation.manage',
      'tenant.service.installation.create',
      'operations_installation',
      salesOrderInstallationBody,
      (w, id, v) => w.createSalesOrderInstallation(id, v as never),
      false,
      ['tenant.order.manage'],
    ),
    operation(
      '/sales/orders/network',
      'enqueueSalesOrderActivation',
      'tenant.network.job.create',
      'tenant.network.job.create',
      'operations_network_action',
      salesOrderNetworkBody,
      (w, id, v) => w.enqueueSalesOrderActivation(id, v as never),
      false,
      ['tenant.order.manage'],
    ),
    operation(
      '/sales/orders/commands',
      'executeSalesOrderCommand',
      'tenant.order.manage',
      'tenant.order.command',
      'sales_order_command',
      salesOrderCommandBody,
      (w, id, v) => w.executeSalesOrderCommand(id, v as never),
    ),
    operation(
      '/sales/orders/billing',
      'postSalesOrderFirstInvoice',
      'tenant.invoice.post',
      'tenant.order.first_invoice.post',
      'finance_invoice',
      salesOrderFirstBillingBody,
      (w, id, v) => w.postSalesOrderFirstInvoice(id, v as never),
      false,
      ['tenant.order.manage', 'tenant.invoice.create'],
    ),
    operation(
      '/subscribers',
      'createOperationsSubscriber',
      'tenant.subscriber.create',
      'tenant.subscriber.create',
      'subscriber',
      subscriberBody,
      (w, id, v) => w.createSubscriber(id, v as never),
    ),
    operation(
      '/billing-runs',
      'prepareOperationsBillingRun',
      'tenant.invoice.create',
      'tenant.billing.prepare',
      'billing_run',
      billingBody,
      (w, id, v) => w.prepareBilling(id, v as never),
    ),
    operation(
      '/office-payments',
      'recordOperationsOfficePayment',
      'tenant.payment.post',
      'tenant.payment.office.record',
      'office_payment',
      officePaymentBody,
      (w, id, v) => w.recordOfficePayment(id, v as never),
    ),
    operation(
      '/payment-corrections',
      'correctOperationsPayment',
      'tenant.payment.reverse',
      'tenant.payment.correct',
      'payment_correction',
      correctionBody,
      (w, id, v) => w.recordPaymentCorrection(id, v as never),
    ),
    operation(
      '/plan-versions',
      'createOperationsPlanVersion',
      'tenant.invoice.create',
      'tenant.plan.version.create',
      'plan_version',
      planVersionBody,
      (w, id, v) => w.createPlanVersion(id, v as never),
    ),
    operation(
      '/addon-versions',
      'createOperationsAddonVersion',
      'tenant.invoice.create',
      'tenant.addon.version.create',
      'addon_version',
      addonVersionBody,
      (w, id, v) => w.createAddonVersion(id, v as never),
    ),
    operation(
      '/services/addons',
      'purchaseOperationsServiceAddon',
      'tenant.subscriber.edit',
      'tenant.service.addon.purchase',
      'service_addon_purchase',
      serviceAddonPurchaseBody,
      (w, id, v) => w.purchaseServiceAddon(id, v as never),
      false,
      ['tenant.invoice.create'],
    ),
    operation(
      '/usage-events',
      'recordOperationsUsageEvent',
      'tenant.invoice.create',
      'tenant.usage.record',
      'usage_event',
      usageEventBody,
      (w, id, v) => w.recordServiceUsage(id, v as never),
    ),
    operation(
      '/billing-policy-versions',
      'createOperationsBillingPolicyVersion',
      'tenant.invoice.create',
      'tenant.billing.policy.version.create',
      'billing_policy',
      billingPolicyBody,
      (w, id, v) => w.createBillingPolicyVersion(id, v as never),
    ),
    operation(
      '/service-installations',
      'createOperationsServiceInstallation',
      'tenant.installation.manage',
      'tenant.service.installation.create',
      'service_installation',
      serviceInstallationBody,
      (w, id, v) => w.createServiceInstallation(id, v as never),
    ),
    operation(
      '/collector-assignments',
      'assignOperationsCollector',
      'tenant.collection.reconcile',
      'tenant.collection.assign',
      'collector_assignment',
      assignmentBody,
      (w, id, v) => w.assignCollector(id, v as never),
    ),
    operation(
      '/collector-evidence',
      'recordOperationsCollectorEvidence',
      'tenant.payment.post',
      'tenant.collection.evidence.record',
      'collector_evidence',
      collectorEvidenceBody,
      (w, id, v) => w.recordCollectorEvidence(id, v as never),
    ),
    operation(
      '/collector-reconciliations',
      'reconcileOperationsCollector',
      'tenant.collection.reconcile',
      'tenant.collection.reconcile',
      'collector_reconciliation',
      reconciliationBody,
      (w, id, v) => w.reconcileCollector(id, v as never),
    ),
    operation(
      '/installations/transitions',
      'transitionOperationsInstallation',
      'tenant.installation.manage',
      'tenant.installation.transition',
      'installation',
      installationBody,
      (w, id, v) => w.transitionInstallation(id, v as never),
    ),
    operation(
      '/issues',
      'createOperationsIssue',
      'tenant.subscriber.edit',
      'tenant.issue.create',
      'support_issue',
      issueBody,
      (w, id, v) => w.createIssue(id, v as never),
    ),
    operation(
      '/issues/transitions',
      'transitionOperationsIssue',
      'tenant.subscriber.edit',
      'tenant.issue.transition',
      'support_issue',
      issueTransitionBody,
      (w, id, v) => w.transitionIssue(id, v as never),
    ),
    operation(
      '/exports',
      'requestOperationsExport',
      'tenant.report.export',
      'tenant.report.export',
      'export_job',
      exportBody,
      (w, id, v) => w.requestExport(id, v as never),
    ),
    operation(
      '/configuration',
      'configureOperations',
      'tenant.user.administer',
      'tenant.operations.configure',
      'configuration',
      configurationBody,
      (w, id, v) => w.configure(id, v as never),
    ),
    operation(
      '/services/change-orders',
      'applyServiceChangeOrder',
      'tenant.subscriber.edit',
      'tenant.service.change.apply',
      'service_change_order',
      serviceChangeBody,
      (w, id, v) => w.applyServiceChangeOrder(id, v as never),
      false,
      ['tenant.order.manage'],
    ),
    operation(
      '/network-actions',
      'enqueueOperationsNetworkAction',
      'tenant.network.job.create',
      'tenant.network.job.create',
      'network_action',
      networkBody,
      (w, id, v) => w.enqueueNetworkAction(id, v as never),
    ),
  ];
  registerWorkspaceRead(
    app,
    options,
    {
      path: '/v1/tenants/:tenantId/operations/sales/workspace',
      operationId: 'readSalesWorkspace',
      permission: 'tenant.sales.view',
      action: 'tenant.sales.workspace.read',
      resourceType: 'sales_workspace',
      schema: z.object({}).strict(),
      execute: (writer, tenantId, input) => writer.readSalesWorkspace(tenantId, input as never),
    },
    'Tenant sales',
    'sales-read',
    'Authorized sales workspace read',
  );
  registerWorkspaceRead(
    app,
    options,
    {
      path: '/v1/tenants/:tenantId/operations/subscribers/workspace',
      operationId: 'readSubscriberWorkspace',
      permission: 'tenant.subscriber.view',
      action: 'tenant.subscriber.workspace.read',
      resourceType: 'subscriber_workspace',
      schema: z.object({}).strict(),
      execute: (writer, tenantId, input) =>
        writer.readSubscriberWorkspace(tenantId, input as never),
    },
    'Tenant subscribers',
    'subscriber-read',
    'Authorized subscriber workspace read',
  );
  for (const spec of routes) registerMutation(app, options, spec);
}

function operation(
  path: string,
  operationId: string,
  permission: Permission,
  action: string,
  resourceType: string,
  schema: z.ZodType,
  execute: RouteSpec['execute'],
  requiresRecentMfa = false,
  additionalPermissions: readonly Permission[] = [],
): RouteSpec {
  return {
    path: `/v1/tenants/:tenantId/operations${path}`,
    operationId,
    permission,
    action,
    resourceType,
    schema,
    execute,
    ...(requiresRecentMfa ? { requiresRecentMfa } : {}),
    ...(additionalPermissions.length > 0 ? { additionalPermissions } : {}),
  };
}

function registerWorkspaceRead(
  app: FastifyInstance,
  options: TenantOperationsRouteOptions,
  spec: RouteSpec,
  tag: string,
  idempotencyPrefix: string,
  reason: string,
): void {
  app.get(
    spec.path,
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        operationId: spec.operationId,
        tags: [tag],
        security: [{ bearerAuth: [] }],
        response: {
          200: { type: 'object', additionalProperties: true },
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { tenantId: requestedTenantId } = tenantParams.parse(request.params);
      const idempotencyKey = `${idempotencyPrefix}:${request.id}`;
      let context: ReturnType<typeof assertTenantContext>;
      try {
        context = assertTenantContext(request.auth, requestedTenantId, options.now());
        if (request.auth.supportGrant) {
          throw new AuthorizationDeniedError('Support sessions cannot read this tenant workspace.');
        }
        assertPermission(request.auth, spec.permission);
      } catch (error) {
        await auditDenial(request, options, spec, requestedTenantId, idempotencyKey, error);
        throw error;
      }
      const result = await spec.execute(options.writer, context.tenantId, {
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        idempotencyKey,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        permission: spec.permission,
        auditAction: spec.action,
        reason,
        ...(request.auth.branchIds !== undefined ? { branchIds: request.auth.branchIds } : {}),
        ...(request.auth.areaIds !== undefined ? { areaIds: request.auth.areaIds } : {}),
        ...(request.auth.routeIds !== undefined ? { routeIds: request.auth.routeIds } : {}),
        ...(request.auth.recordIds !== undefined ? { recordIds: request.auth.recordIds } : {}),
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
}

function registerMutation(
  app: FastifyInstance,
  options: TenantOperationsRouteOptions,
  spec: RouteSpec,
): void {
  app.post(
    spec.path,
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        operationId: spec.operationId,
        tags: ['Tenant operations'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantId'],
          properties: { tenantId: { type: 'string', format: 'uuid' } },
        },
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': { type: 'string', minLength: 8, maxLength: 200 } },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          201: { type: 'object', additionalProperties: true },
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => executeMutation(request, reply, options, spec),
  );
}

async function executeMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  options: TenantOperationsRouteOptions,
  spec: RouteSpec,
) {
  const { tenantId: requestedTenantId } = tenantParams.parse(request.params);
  const idempotencyKey = headers.parse(request.headers)['idempotency-key'];
  const body = spec.schema.parse(request.body) as Record<string, unknown>;
  let context: ReturnType<typeof assertTenantContext>;
  try {
    context = assertTenantContext(request.auth, requestedTenantId, options.now());
    if (request.auth.supportGrant) {
      throw new AuthorizationDeniedError(
        'Operations support access requires canonical branch, area, route, and record grant scopes.',
      );
    }
    assertPermission(request.auth, spec.permission);
    for (const permission of spec.additionalPermissions ?? []) {
      assertPermission(request.auth, permission);
    }
    if (spec.requiresRecentMfa) assertRecentMfa(request, options.now());
    assertBodyWithinClaimScope(request, body);
  } catch (error) {
    await auditDenial(request, options, spec, requestedTenantId, idempotencyKey, error);
    throw error;
  }
  const auditAction = spec.action;
  const result = await spec.execute(options.writer, context.tenantId, {
    ...body,
    actorId: request.auth.sub,
    sessionId: request.auth.sessionId,
    idempotencyKey,
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    permission: spec.permission,
    auditAction,
    reason: typeof body.reason === 'string' ? body.reason : 'authorized operations mutation',
    ...(request.auth.branchIds !== undefined ? { branchIds: request.auth.branchIds } : {}),
    ...(request.auth.areaIds !== undefined ? { areaIds: request.auth.areaIds } : {}),
    ...(request.auth.routeIds !== undefined ? { routeIds: request.auth.routeIds } : {}),
    ...(request.auth.recordIds !== undefined ? { recordIds: request.auth.recordIds } : {}),
  });
  // Allowed evidence is emitted by the repository transaction itself. Appending here would make
  // an audit failure occur after a committed mutation and would not be atomic.
  return reply.code(201).header('cache-control', 'private, no-store').send(result);
}

function assertRecentMfa(request: FastifyRequest, now: Date): void {
  const verifiedAt = request.auth.mfaVerifiedAt
    ? new Date(request.auth.mfaVerifiedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > 10 * 60_000) {
    throw new AuthorizationDeniedError(
      'Recent MFA verification is required for this sales action.',
    );
  }
}

function assertBodyWithinClaimScope(request: FastifyRequest, body: Record<string, unknown>): void {
  assertDimension(request.auth.branchIds, body.branchId, 'branch');
  assertDimension(request.auth.areaIds, body.areaId, 'area');
  assertDimension(request.auth.routeIds, body.routeId, 'route');
}
function assertDimension(
  allowed: readonly string[] | undefined,
  selected: unknown,
  label: string,
): void {
  if (
    allowed !== undefined &&
    selected !== undefined &&
    (typeof selected !== 'string' || !allowed.includes(selected))
  ) {
    throw new AuthorizationDeniedError(`The selected ${label} is outside the session scope.`);
  }
}

async function auditDenial(
  request: FastifyRequest,
  options: TenantOperationsRouteOptions,
  spec: RouteSpec,
  requestedTenantId: string,
  idempotencyKey: string,
  originalError: unknown,
): Promise<void> {
  const auditTenantId = request.auth.tenantId ?? request.auth.supportGrant?.tenantId;
  if (auditTenantId) {
    try {
      const auditContext = assertTenantContext(request.auth, auditTenantId, options.now());
      await options.audit.append({
        tenantId: auditContext.tenantId,
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        ...(request.auth.supportGrant ? { supportGrantId: request.auth.supportGrant.grantId } : {}),
        action: request.auth.supportGrant ? `support.${spec.action}` : spec.action,
        resourceType: spec.resourceType,
        resourceId: requestedTenantId,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        result: 'denied',
        metadata: {
          permission: spec.permission,
          idempotencyKey,
          reason: originalError instanceof Error ? originalError.message : 'authorization denied',
        },
        occurredAt: options.now().toISOString(),
      });
      return;
    } catch {
      /* Fall through to the platform security stream. */
    }
  }
  await options.securityAudit.append({
    actorId: request.auth.sub,
    sessionId: request.auth.sessionId,
    claimedTenantId: requestedTenantId,
    ...(request.auth.supportGrant?.grantId
      ? { supportGrantId: request.auth.supportGrant.grantId }
      : {}),
    action: `support.${spec.action}`,
    reason: 'missing_or_expired_scoped_grant',
    requestId: request.id,
    ipAddress: request.ip,
    metadata: { permission: spec.permission },
    occurredAt: options.now().toISOString(),
  });
}

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /secret|password|credential|token|private[_-]?key/i.test(key) || containsSecretKey(item),
  );
}
