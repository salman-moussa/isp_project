import { errorResponseJsonSchema, type Permission, type VerifiedTenantId } from '@isp/contracts';
import { assertPermission, assertTenantContext } from '@isp/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditWriter } from '../audit.js';
import type {
  FinanceAllocationResult,
  FinanceDocumentResult,
  FinanceMutationAuditContext,
  FinanceWriter,
} from '../finance.js';
import type { SecurityAuditWriter } from '../security-audit.js';

const tenantParamsSchema = z.object({ tenantId: z.uuid() });
const entryParamsSchema = tenantParamsSchema.extend({ entryId: z.uuid() });
const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8).max(200),
});
const postedAtSchema = z.string().datetime({ offset: true });
const documentBodySchema = z.object({
  number: z.string().trim().min(1).max(100),
  amountMinor: z.number().int().positive().safe(),
  currency: z.enum(['USD', 'LBP']),
  postedAt: postedAtSchema,
});
const reversalBodySchema = z.object({
  number: z.string().trim().min(1).max(100),
  postedAt: postedAtSchema,
});
const allocationBodySchema = z.object({
  invoiceId: z.uuid(),
  paymentId: z.uuid(),
  amountMinor: z.number().int().positive().safe(),
  currency: z.enum(['USD', 'LBP']),
  postedAt: postedAtSchema,
});
const allocationReversalBodySchema = z.object({ postedAt: postedAtSchema });

const paramsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId'],
  properties: { tenantId: { type: 'string', format: 'uuid' } },
} as const;
const entryParamsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'entryId'],
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    entryId: { type: 'string', format: 'uuid' },
  },
} as const;
const headersJsonSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 8, maxLength: 200 } },
} as const;
const moneyProperties = {
  amountMinor: { type: 'integer', minimum: 1 },
  currency: { type: 'string', enum: ['USD', 'LBP'] },
  postedAt: { type: 'string', format: 'date-time' },
} as const;
const documentBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'amountMinor', 'currency', 'postedAt'],
  properties: {
    number: { type: 'string', minLength: 1, maxLength: 100 },
    ...moneyProperties,
  },
} as const;
const reversalBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'postedAt'],
  properties: {
    number: { type: 'string', minLength: 1, maxLength: 100 },
    postedAt: { type: 'string', format: 'date-time' },
  },
} as const;
const allocationBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['invoiceId', 'paymentId', 'amountMinor', 'currency', 'postedAt'],
  properties: {
    invoiceId: { type: 'string', format: 'uuid' },
    paymentId: { type: 'string', format: 'uuid' },
    ...moneyProperties,
  },
} as const;
const allocationReversalBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['postedAt'],
  properties: { postedAt: { type: 'string', format: 'date-time' } },
} as const;
const documentResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'entryKind',
    'number',
    'amountMinor',
    'currency',
    'idempotencyKey',
    'postedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    entryKind: { type: 'string', enum: ['posted', 'reversal'] },
    number: { type: 'string' },
    reversesId: { type: 'string', format: 'uuid' },
    amountMinor: { type: 'integer' },
    currency: { type: 'string', enum: ['USD', 'LBP'] },
    idempotencyKey: { type: 'string' },
    postedAt: { type: 'string', format: 'date-time' },
  },
} as const;
const allocationResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenantId',
    'entryKind',
    'paymentId',
    'invoiceId',
    'amountMinor',
    'currency',
    'idempotencyKey',
    'postedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    entryKind: { type: 'string', enum: ['allocation', 'reversal'] },
    paymentId: { type: 'string', format: 'uuid' },
    invoiceId: { type: 'string', format: 'uuid' },
    reversesId: { type: 'string', format: 'uuid' },
    amountMinor: { type: 'integer' },
    currency: { type: 'string', enum: ['USD', 'LBP'] },
    idempotencyKey: { type: 'string' },
    postedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export interface TenantFinanceRouteOptions {
  readonly audit: AuditWriter;
  readonly finance: FinanceWriter;
  readonly now: () => Date;
  readonly securityAudit: SecurityAuditWriter;
}

interface MutationDefinition {
  readonly path: string;
  readonly operationId: string;
  readonly permission: Permission;
  readonly action: string;
  readonly resourceType: string;
  readonly hasEntryId: boolean;
  readonly bodySchema: z.ZodType;
  readonly bodyJsonSchema: object;
  readonly responseJsonSchema: object;
  readonly run: (
    tenantId: VerifiedTenantId,
    entryId: string | undefined,
    body: unknown,
    idempotencyKey: string,
    actor: { readonly actorId: string; readonly audit: FinanceMutationAuditContext },
  ) => Promise<FinanceDocumentResult | FinanceAllocationResult>;
}

export function registerTenantFinanceRoutes(
  app: FastifyInstance,
  options: TenantFinanceRouteOptions,
): void {
  const definitions: MutationDefinition[] = [
    {
      path: '/v1/tenants/:tenantId/finance/invoices',
      operationId: 'postTenantInvoice',
      permission: 'tenant.invoice.post',
      action: 'tenant.invoice.post',
      resourceType: 'invoice',
      hasEntryId: false,
      bodySchema: documentBodySchema,
      bodyJsonSchema: documentBodyJsonSchema,
      responseJsonSchema: documentResponseJsonSchema,
      run: (tenantId, _entryId, value, key, actor) => {
        const body = documentBodySchema.parse(value);
        return options.finance.postInvoice(tenantId, {
          ...body,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
    {
      path: '/v1/tenants/:tenantId/finance/invoices/:entryId/reversal',
      operationId: 'reverseTenantInvoice',
      permission: 'tenant.invoice.reverse',
      action: 'tenant.invoice.reverse',
      resourceType: 'invoice_reversal',
      hasEntryId: true,
      bodySchema: reversalBodySchema,
      bodyJsonSchema: reversalBodyJsonSchema,
      responseJsonSchema: documentResponseJsonSchema,
      run: (tenantId, entryId, value, key, actor) => {
        const body = reversalBodySchema.parse(value);
        return options.finance.reverseInvoice(tenantId, {
          originalId: entryId!,
          reversalNumber: body.number,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
    {
      path: '/v1/tenants/:tenantId/finance/payments',
      operationId: 'postTenantPayment',
      permission: 'tenant.payment.post',
      action: 'tenant.payment.post',
      resourceType: 'payment',
      hasEntryId: false,
      bodySchema: documentBodySchema,
      bodyJsonSchema: documentBodyJsonSchema,
      responseJsonSchema: documentResponseJsonSchema,
      run: (tenantId, _entryId, value, key, actor) => {
        const body = documentBodySchema.parse(value);
        return options.finance.postPayment(tenantId, {
          ...body,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
    {
      path: '/v1/tenants/:tenantId/finance/payments/:entryId/reversal',
      operationId: 'reverseTenantPayment',
      permission: 'tenant.payment.reverse',
      action: 'tenant.payment.reverse',
      resourceType: 'payment_reversal',
      hasEntryId: true,
      bodySchema: reversalBodySchema,
      bodyJsonSchema: reversalBodyJsonSchema,
      responseJsonSchema: documentResponseJsonSchema,
      run: (tenantId, entryId, value, key, actor) => {
        const body = reversalBodySchema.parse(value);
        return options.finance.reversePayment(tenantId, {
          originalId: entryId!,
          reversalNumber: body.number,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
    {
      path: '/v1/tenants/:tenantId/finance/allocations',
      operationId: 'allocateTenantPayment',
      permission: 'tenant.payment.post',
      action: 'tenant.payment.allocate',
      resourceType: 'payment_allocation',
      hasEntryId: false,
      bodySchema: allocationBodySchema,
      bodyJsonSchema: allocationBodyJsonSchema,
      responseJsonSchema: allocationResponseJsonSchema,
      run: (tenantId, _entryId, value, key, actor) => {
        const body = allocationBodySchema.parse(value);
        return options.finance.allocate(tenantId, {
          ...body,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
    {
      path: '/v1/tenants/:tenantId/finance/allocations/:entryId/reversal',
      operationId: 'reverseTenantPaymentAllocation',
      permission: 'tenant.payment.reverse',
      action: 'tenant.payment.allocation.reverse',
      resourceType: 'payment_allocation_reversal',
      hasEntryId: true,
      bodySchema: allocationReversalBodySchema,
      bodyJsonSchema: allocationReversalBodyJsonSchema,
      responseJsonSchema: allocationResponseJsonSchema,
      run: (tenantId, entryId, value, key, actor) => {
        const body = allocationReversalBodySchema.parse(value);
        return options.finance.reverseAllocation(tenantId, {
          originalId: entryId!,
          idempotencyKey: key,
          actorId: actor.actorId,
          audit: actor.audit,
          postedAt: new Date(body.postedAt),
        });
      },
    },
  ];

  for (const definition of definitions) registerMutation(app, options, definition);
}

function registerMutation(
  app: FastifyInstance,
  options: TenantFinanceRouteOptions,
  definition: MutationDefinition,
): void {
  app.post(
    definition.path,
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        operationId: definition.operationId,
        tags: ['Tenant finance'],
        security: [{ bearerAuth: [] }],
        params: definition.hasEntryId ? entryParamsJsonSchema : paramsJsonSchema,
        headers: headersJsonSchema,
        body: definition.bodyJsonSchema,
        response: {
          201: definition.responseJsonSchema,
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => executeMutation(request, reply, options, definition),
  );
}

async function executeMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  options: TenantFinanceRouteOptions,
  definition: MutationDefinition,
) {
  const tenantParams = tenantParamsSchema.parse(request.params);
  const entryId = definition.hasEntryId
    ? entryParamsSchema.parse(request.params).entryId
    : undefined;
  const headers = idempotencyHeadersSchema.parse(request.headers);
  const body = definition.bodySchema.parse(request.body);
  const context = await authorizeMutation(request, options, tenantParams.tenantId, definition);
  const action = context.supportGrantId ? `support.${definition.action}` : definition.action;
  const requestAudit: FinanceMutationAuditContext = {
    sessionId: request.auth.sessionId,
    ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
    action,
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    permission: definition.permission,
    reason: request.auth.supportGrant?.reason ?? 'Authorized tenant finance mutation.',
  };
  const commonAudit = {
    tenantId: context.tenantId,
    actorId: request.auth.sub,
    sessionId: request.auth.sessionId,
    ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
    action,
    resourceType: definition.resourceType,
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    metadata: {
      permission: definition.permission,
      idempotencyKey: headers['idempotency-key'],
    },
    occurredAt: options.now().toISOString(),
  };
  try {
    const result = await definition.run(
      context.tenantId,
      entryId,
      body,
      headers['idempotency-key'],
      { actorId: request.auth.sub, audit: requestAudit },
    );
    // Successful finance evidence is inserted into the tenant outbox by the same PostgreSQL
    // transaction as the journal row, then relayed idempotently to the control audit stream.
    return reply.code(201).header('cache-control', 'private, no-store').send(result);
  } catch (error) {
    await options.audit.append({
      ...commonAudit,
      resourceId: entryId ?? headers['idempotency-key'],
      result: 'failed',
    });
    throw error;
  }
}

async function authorizeMutation(
  request: FastifyRequest,
  options: TenantFinanceRouteOptions,
  requestedTenantId: string,
  definition: MutationDefinition,
) {
  try {
    const context = assertTenantContext(request.auth, requestedTenantId, options.now());
    assertPermission(request.auth, definition.permission);
    return context;
  } catch (error) {
    const auditTenantId = request.auth.tenantId ?? request.auth.supportGrant?.tenantId;
    if (auditTenantId) {
      try {
        const auditContext = assertTenantContext(request.auth, auditTenantId, options.now());
        await options.audit.append({
          tenantId: auditContext.tenantId,
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          ...(auditContext.supportGrantId ? { supportGrantId: auditContext.supportGrantId } : {}),
          action: auditContext.supportGrantId ? `support.${definition.action}` : definition.action,
          resourceType: definition.resourceType,
          resourceId: requestedTenantId,
          requestId: request.id,
          ipAddress: request.ip,
          result: 'denied',
          metadata: { permission: definition.permission, requestedTenantId },
          occurredAt: options.now().toISOString(),
        });
        throw error;
      } catch (auditContextError) {
        if (auditContextError === error) throw error;
      }
    }
    await options.securityAudit.append({
      actorId: request.auth.sub,
      sessionId: request.auth.sessionId,
      claimedTenantId: requestedTenantId,
      ...(request.auth.supportGrant?.grantId
        ? { supportGrantId: request.auth.supportGrant.grantId }
        : {}),
      action: `support.${definition.action}`,
      reason: 'missing_or_expired_scoped_grant',
      requestId: request.id,
      ipAddress: request.ip,
      metadata: { permission: definition.permission },
      occurredAt: options.now().toISOString(),
    });
    throw error;
  }
}
