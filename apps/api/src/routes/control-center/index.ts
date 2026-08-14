import type { Permission } from '@isp/contracts';
import { AuthorizationDeniedError } from '@isp/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const lifecycleState = z.enum([
  'lead',
  'trial',
  'active',
  'grace',
  'restricted',
  'terminated',
  'archived',
]);
const uuid = z.uuid();
const idempotencyHeaders = z.object({ 'idempotency-key': z.string().trim().min(8).max(200) });
const tenantParams = z.object({ tenantId: uuid });
const reason = z.string().trim().min(8).max(500);
const clientBody = z
  .object({
    tenantId: uuid,
    legalName: z.string().trim().min(2).max(200),
    tradingName: z.string().trim().min(2).max(200),
    registrationNumber: z.string().trim().min(1).max(100).optional(),
    accountOwnerId: z.string().trim().min(1).max(128).optional(),
    notes: z.string().trim().max(2000).optional(),
    reason,
  })
  .strict();
const contactBody = z
  .object({
    role: z.enum(['primary', 'billing', 'technical', 'legal']),
    name: z.string().trim().min(2).max(120),
    email: z.email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{7,15}$/)
      .optional(),
    preferredLocale: z.enum(['en', 'ar']),
    isPrimary: z.boolean().default(false),
    reason,
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: 'Email or phone is required.' });
const packageBody = z
  .object({
    packageKey: z.string().regex(/^[a-z][a-z0-9_-]{2,49}$/),
    version: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(120),
    nameAr: z.string().trim().min(1).max(120),
    entitlements: z
      .array(z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/))
      .min(1)
      .max(100),
    priceMinor: z.number().int().nonnegative().safe(),
    currency: z.enum(['USD', 'LBP']),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    reason,
  })
  .strict()
  .refine((v) => !v.effectiveUntil || Date.parse(v.effectiveUntil) > Date.parse(v.effectiveFrom), {
    message: 'Package end time must follow its start time.',
    path: ['effectiveUntil'],
  });
const assignmentBody = z
  .object({
    packageVersionId: uuid,
    state: lifecycleState,
    startsAt: z.string().datetime({ offset: true }),
    expectedRevision: z.number().int().positive().optional(),
    reason,
  })
  .strict();
const transitionBody = z
  .object({
    expectedState: lifecycleState,
    expectedRevision: z.number().int().positive(),
    toState: lifecycleState,
    reason,
  })
  .strict();
const approvalParams = z.object({ approvalRequestId: uuid });
const approvalBody = z.object({ reason }).strict();
const documentBody = z
  .object({
    number: z.string().trim().min(1).max(100),
    amountMinor: z.number().int().positive().safe(),
    currency: z.enum(['USD', 'LBP']),
    dueAt: z.string().datetime({ offset: true }).optional(),
    reason,
  })
  .strict();
const documentParams = z.object({ tenantId: uuid, documentId: uuid });
const reversalBody = z.object({ number: z.string().trim().min(1).max(100), reason }).strict();
const allocationBody = z
  .object({
    invoiceId: uuid,
    paymentId: uuid,
    amountMinor: z.number().int().positive().safe(),
    currency: z.enum(['USD', 'LBP']),
    reason,
  })
  .strict();
const allocationParams = z.object({ tenantId: uuid, allocationId: uuid });
const listQuery = z.object({
  state: z.union([lifecycleState, z.array(lifecycleState)]).optional(),
  packageKey: z.union([z.string(), z.array(z.string())]).optional(),
  deploymentHealth: z
    .union([
      z.enum(['healthy', 'attention', 'blocked']),
      z.array(z.enum(['healthy', 'attention', 'blocked'])),
    ])
    .optional(),
  supportStatus: z
    .union([
      z.enum(['clear', 'open', 'escalated']),
      z.array(z.enum(['clear', 'open', 'escalated'])),
    ])
    .optional(),
  query: z.string().trim().max(120).optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface ControlCenterApiService {
  listClients(input: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
  createClient(input: Record<string, unknown>): Promise<unknown>;
  createContact(input: Record<string, unknown>): Promise<unknown>;
  createPackageVersion(input: Record<string, unknown>): Promise<unknown>;
  assignSubscription(input: Record<string, unknown>): Promise<unknown>;
  transitionSubscription(input: Record<string, unknown>): Promise<unknown>;
  approveTransition(input: Record<string, unknown>): Promise<unknown>;
  postInvoice(input: Record<string, unknown>): Promise<unknown>;
  postPayment(input: Record<string, unknown>): Promise<unknown>;
  reverseInvoice(input: Record<string, unknown>): Promise<unknown>;
  reversePayment(input: Record<string, unknown>): Promise<unknown>;
  allocatePayment(input: Record<string, unknown>): Promise<unknown>;
  reverseAllocation(input: Record<string, unknown>): Promise<unknown>;
}
export interface ControlCenterRouteOptions {
  readonly service: ControlCenterApiService;
  readonly now: () => Date;
}

export function registerControlCenterRoutes(
  app: FastifyInstance,
  options: ControlCenterRouteOptions,
): void {
  const authenticate = (request: FastifyRequest, reply: FastifyReply) =>
    app.authenticate(request, reply);
  app.get('/v1/control-center/clients', {
    preHandler: [authenticate, platformPermission('platform.client.view')],
    handler: async (request) => {
      const filters = listQuery.parse(request.query);
      return options.service.listClients(
        {
          ...filters,
          states: toArray(filters.state),
          packageKeys: toArray(filters.packageKey),
          deploymentHealth: toArray(filters.deploymentHealth),
          supportStatus: toArray(filters.supportStatus),
        },
        requestContext(request, 'platform.client.view', 'client.list'),
      );
    },
  });
  app.post('/v1/control-center/clients', {
    preHandler: [authenticate, platformPermission('platform.client.manage')],
    handler: async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.service.createClient(
            mutationEnvelope(
              request,
              clientBody.parse(request.body),
              options,
              'platform.client.manage',
              'client.create',
            ),
          ),
        ),
  });
  app.post('/v1/control-center/clients/:tenantId/contacts', {
    preHandler: [authenticate, platformPermission('platform.client.manage')],
    handler: async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      return reply
        .code(201)
        .send(
          await options.service.createContact(
            mutationEnvelope(
              request,
              { tenantId, ...contactBody.parse(request.body) },
              options,
              'platform.client.manage',
              'contact.create',
            ),
          ),
        );
    },
  });
  app.post('/v1/control-center/packages/versions', {
    preHandler: [authenticate, platformPermission('platform.subscription.manage')],
    handler: async (request, reply) =>
      reply
        .code(201)
        .send(
          await options.service.createPackageVersion(
            mutationEnvelope(
              request,
              packageBody.parse(request.body),
              options,
              'platform.subscription.manage',
              'package.create',
            ),
          ),
        ),
  });
  app.put('/v1/control-center/clients/:tenantId/subscription', {
    preHandler: [authenticate, platformPermission('platform.subscription.manage')],
    handler: async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      return reply
        .code(200)
        .send(
          await options.service.assignSubscription(
            mutationEnvelope(
              request,
              { tenantId, ...assignmentBody.parse(request.body) },
              options,
              'platform.subscription.manage',
              'subscription.assign',
            ),
          ),
        );
    },
  });
  app.post('/v1/control-center/clients/:tenantId/subscription/transitions', {
    preHandler: [authenticate, platformPermission('platform.subscription.manage')],
    handler: async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      const result = await options.service.transitionSubscription(
        mutationEnvelope(
          request,
          { tenantId, ...transitionBody.parse(request.body) },
          options,
          'platform.subscription.manage',
          'transition.request',
        ),
      );
      const pending = (result as { status?: string }).status === 'pending';
      return reply
        .code(pending ? 202 : 201)
        .send({ ...(result as Record<string, unknown>), subscriberNetworkCommands: [] });
    },
  });
  app.post('/v1/control-center/subscription/transition-requests/:approvalRequestId/approve', {
    preHandler: [
      authenticate,
      platformPermission('platform.subscription.manage'),
      freshMfa(options.now),
    ],
    handler: async (request, reply) => {
      const { approvalRequestId } = approvalParams.parse(request.params);
      const result = await options.service.approveTransition(
        mutationEnvelope(
          request,
          { approvalRequestId, ...approvalBody.parse(request.body) },
          options,
          'platform.subscription.manage',
          'transition.approve',
        ),
      );
      return reply
        .code(201)
        .send({ ...(result as Record<string, unknown>), subscriberNetworkCommands: [] });
    },
  });
  registerDocumentRoute(app, options, 'invoices', 'platform.billing.post');
  registerDocumentRoute(app, options, 'payments', 'platform.payment.post');
  registerFinanceCorrectionRoutes(app, options);
}

function registerDocumentRoute(
  app: FastifyInstance,
  options: ControlCenterRouteOptions,
  kind: 'invoices' | 'payments',
  permission: Permission,
): void {
  const authenticate = (request: FastifyRequest, reply: FastifyReply) =>
    app.authenticate(request, reply);
  app.post(`/v1/control-center/clients/:tenantId/billing/${kind}`, {
    preHandler: [authenticate, platformPermission(permission)],
    handler: async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      const body = documentBody.parse(request.body);
      if (kind === 'invoices' && !body.dueAt)
        documentBody.extend({ dueAt: z.string().datetime({ offset: true }) }).parse(request.body);
      const input = mutationEnvelope(
        request,
        { tenantId, ...body },
        options,
        permission,
        kind === 'invoices' ? 'invoice.post' : 'payment.post',
      );
      const result =
        kind === 'invoices'
          ? await options.service.postInvoice(input)
          : await options.service.postPayment(input);
      return reply.code(201).send(result);
    },
  });
}
function registerFinanceCorrectionRoutes(
  app: FastifyInstance,
  options: ControlCenterRouteOptions,
): void {
  const authenticate = (request: FastifyRequest, reply: FastifyReply) =>
    app.authenticate(request, reply);
  app.post('/v1/control-center/clients/:tenantId/billing/invoices/:documentId/reversals', {
    preHandler: [authenticate, platformPermission('platform.billing.post')],
    handler: async (request, reply) => {
      const { tenantId, documentId } = documentParams.parse(request.params);
      return reply
        .code(201)
        .send(
          await options.service.reverseInvoice(
            mutationEnvelope(
              request,
              { tenantId, originalId: documentId, ...reversalBody.parse(request.body) },
              options,
              'platform.billing.post',
              'invoice.reverse',
            ),
          ),
        );
    },
  });
  app.post('/v1/control-center/clients/:tenantId/billing/payments/:documentId/reversals', {
    preHandler: [authenticate, platformPermission('platform.payment.reverse')],
    handler: async (request, reply) => {
      const { tenantId, documentId } = documentParams.parse(request.params);
      return reply
        .code(201)
        .send(
          await options.service.reversePayment(
            mutationEnvelope(
              request,
              { tenantId, originalId: documentId, ...reversalBody.parse(request.body) },
              options,
              'platform.payment.reverse',
              'payment.reverse',
            ),
          ),
        );
    },
  });
  app.post('/v1/control-center/clients/:tenantId/billing/allocations', {
    preHandler: [authenticate, platformPermission('platform.payment.post')],
    handler: async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      return reply
        .code(201)
        .send(
          await options.service.allocatePayment(
            mutationEnvelope(
              request,
              { tenantId, ...allocationBody.parse(request.body) },
              options,
              'platform.payment.post',
              'allocation.post',
            ),
          ),
        );
    },
  });
  app.post('/v1/control-center/clients/:tenantId/billing/allocations/:allocationId/reversals', {
    preHandler: [authenticate, platformPermission('platform.payment.reverse')],
    handler: async (request, reply) => {
      const { tenantId, allocationId } = allocationParams.parse(request.params);
      return reply
        .code(201)
        .send(
          await options.service.reverseAllocation(
            mutationEnvelope(
              request,
              { tenantId, originalId: allocationId, ...approvalBody.parse(request.body) },
              options,
              'platform.payment.reverse',
              'allocation.reverse',
            ),
          ),
        );
    },
  });
}
function platformPermission(permission: Permission) {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.auth.audience !== 'platform' || !request.auth.permissions.includes(permission))
      throw new AuthorizationDeniedError(
        'A current platform permission is required for this Control Center task.',
      );
  };
}
function freshMfa(now: () => Date) {
  return async (request: FastifyRequest): Promise<void> => {
    const verified = request.auth.mfaVerifiedAt
      ? Date.parse(request.auth.mfaVerifiedAt)
      : Number.NaN;
    const age = now().getTime() - verified;
    if (!Number.isFinite(verified) || age < 0 || age > 600_000)
      throw new AuthorizationDeniedError(
        'Fresh MFA verification is required to approve this Control Center action.',
      );
  };
}
function requestContext(
  request: FastifyRequest,
  permission: Permission,
  action: string,
): Record<string, unknown> {
  return {
    actorId: request.auth.sub,
    sessionId: request.auth.sessionId,
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    permission,
    action,
    ...(request.auth.mfaVerifiedAt ? { mfaVerifiedAt: new Date(request.auth.mfaVerifiedAt) } : {}),
  };
}
function mutationEnvelope(
  request: FastifyRequest,
  body: Record<string, unknown>,
  options: ControlCenterRouteOptions,
  permission: Permission,
  action: string,
): Record<string, unknown> {
  const key = idempotencyHeaders.parse(request.headers)['idempotency-key'];
  return {
    ...body,
    ...requestContext(request, permission, action),
    idempotencyKey: key,
    requestHash: createHash('sha256').update(canonicalJson(body)).digest('hex'),
    receivedAt: options.now().toISOString(),
  };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function toArray<T>(value: T | readonly T[] | undefined): readonly T[] | undefined {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value as T];
}
