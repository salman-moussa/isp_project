import { errorResponseJsonSchema } from '@isp/contracts';
import { assertPermission, assertTenantContext, AuthorizationDeniedError } from '@isp/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CollectApiService } from '../../collect-service.js';
import {
  collectApprovalBody,
  collectApprovalParams,
  collectAuthorizeBody,
  collectDeltaQuery,
  collectIdempotencyHeaders,
  collectRefreshBody,
  collectSyncBody,
  collectTenantParams,
} from './contracts.js';

export interface CollectRouteOptions {
  readonly service: CollectApiService;
  readonly now: () => Date;
}

const errors = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
  500: errorResponseJsonSchema,
} as const;

export function registerCollectRoutes(app: FastifyInstance, options: CollectRouteOptions): void {
  app.post(
    '/v1/tenants/:tenantId/collect/devices/authorize',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        operationId: 'authorizeCollectDevice',
        tags: ['Orvex ISP Collect'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) => {
      const { tenantId } = collectTenantParams.parse(request.params);
      const body = collectAuthorizeBody.parse(request.body);
      const tenant = assertTenantContext(request.auth, tenantId, options.now());
      if (request.auth.supportGrant)
        throw new AuthorizationDeniedError('Support grants cannot authorize Collect devices.');
      assertPermission(request.auth, 'tenant.collection.view');
      assertPermission(request.auth, 'tenant.payment.post');
      const mfaVerifiedAt = freshMfa(request, options.now());
      const result = await options.service.authorizeDevice(tenant.tenantId, {
        ...requestContext(request),
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        deviceLabel: body.deviceLabel,
        devicePublicKeyThumbprint: body.devicePublicKeyThumbprint,
        mfaVerifiedAt,
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    '/v1/collect/token/refresh',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        operationId: 'refreshCollectDeviceToken',
        tags: ['Orvex ISP Collect'],
        response: errors,
      },
    },
    async (request, reply) => {
      const { refreshToken } = collectRefreshBody.parse(request.body);
      const result = await options.service.refresh(refreshToken);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    '/v1/collect/bootstrap',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        operationId: 'bootstrapCollectAssignments',
        tags: ['Orvex ISP Collect'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) => {
      const device = await collectDevice(request, options.service);
      requireScope(device.scopes, 'assignments:read');
      const result = await options.service.readBootstrap(device, requestContext(request));
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    '/v1/collect/delta',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        operationId: 'readCollectAssignmentDelta',
        tags: ['Orvex ISP Collect'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) => {
      const device = await collectDevice(request, options.service);
      requireScope(device.scopes, 'assignments:read');
      const query = collectDeltaQuery.parse(request.query);
      const result = await options.service.readDelta(
        device,
        requestContext(request),
        query.cursor,
        query.limit,
      );
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    '/v1/collect/sync',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        operationId: 'syncCollectOperations',
        tags: ['Orvex ISP Collect'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) => {
      const device = await collectDevice(request, options.service);
      const { operations } = collectSyncBody.parse(request.body);
      for (const operation of operations) requireScope(device.scopes, scopeFor(operation.type));
      const result = await options.service.sync(device, requestContext(request), operations);
      return reply.header('cache-control', 'private, no-store').send({ results: result });
    },
  );

  app.post(
    '/v1/tenants/:tenantId/collect/reconciliations/:reconciliationId/approve',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        operationId: 'approveCollectReconciliationDiscrepancy',
        tags: ['Orvex ISP Collect'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) => {
      const params = collectApprovalParams.parse(request.params);
      const headers = collectIdempotencyHeaders.parse(request.headers);
      const body = collectApprovalBody.parse(request.body);
      const tenant = assertTenantContext(request.auth, params.tenantId, options.now());
      if (request.auth.supportGrant)
        throw new AuthorizationDeniedError(
          'Support grants cannot approve collector discrepancies.',
        );
      assertPermission(request.auth, 'tenant.collection.reconcile');
      freshMfa(request, options.now());
      const result = await options.service.approveDiscrepancy(tenant.tenantId, {
        ...requestContext(request),
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        reconciliationId: params.reconciliationId,
        reason: body.reason,
        idempotencyKey: headers['idempotency-key'],
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
}

function requestContext(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
async function collectDevice(request: FastifyRequest, service: CollectApiService) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ') || authorization.length <= 7)
    throw new AuthorizationDeniedError('A Collect bearer token is required.');
  return service.authenticate(authorization.slice(7));
}
function freshMfa(request: FastifyRequest, now: Date): Date {
  const value = request.auth.mfaVerifiedAt ? new Date(request.auth.mfaVerifiedAt) : null;
  if (
    !value ||
    !Number.isFinite(value.getTime()) ||
    value > now ||
    now.getTime() - value.getTime() > 10 * 60_000
  ) {
    throw new AuthorizationDeniedError('Fresh MFA verification is required.');
  }
  return value;
}
function requireScope(scopes: readonly string[], required: string): void {
  if (!scopes.includes(required))
    throw new AuthorizationDeniedError('The Collect device scope does not authorize this request.');
}
function scopeFor(type: 'payment.create' | 'reconciliation.submit' | 'receipt.print.audit') {
  if (type === 'payment.create') return 'payments:create';
  if (type === 'reconciliation.submit') return 'reconciliations:submit';
  return 'receipts:print:audit';
}
