import { errorResponseJsonSchema } from '@isp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth-service.js';

const uuid = z.uuid();
const loginBody = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(128),
    audience: z.enum(['platform', 'tenant']),
    tenantId: uuid.optional(),
    deviceLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((body) => (body.audience === 'tenant') === (body.tenantId !== undefined), {
    message: 'Tenant login requires exactly one tenant identifier.',
  });
const mfaBody = z
  .object({
    challengeId: uuid,
    code: z.string().regex(/^\d{6,8}$/),
    deviceLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const refreshBody = z.object({ refreshToken: z.string().min(32).max(512) }).strict();
const recoveryStartBody = z.object({ email: z.email().max(320) }).strict();
const recoveryCompleteBody = z
  .object({ token: z.string().min(32).max(512), newPassword: z.string().min(12).max(128) })
  .strict();
const sessionParams = z.object({ sessionId: uuid });

const errors = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  429: errorResponseJsonSchema,
  500: errorResponseJsonSchema,
} as const;

export function registerAuthRoutes(app: FastifyInstance, service: AuthService): void {
  app.post(
    '/v1/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: { operationId: 'login', tags: ['Authentication'], response: errors },
    },
    async (request, reply) => {
      const body = loginBody.parse(request.body);
      const result = await service.login(
        {
          email: body.email,
          password: body.password,
          audience: body.audience,
          ...(body.tenantId ? { tenantId: body.tenantId } : {}),
          ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
        },
        evidence(request),
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.post(
    '/v1/auth/mfa/verify',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: { operationId: 'verifyMfa', tags: ['Authentication'], response: errors },
    },
    async (request, reply) => {
      const body = mfaBody.parse(request.body);
      const result = await service.verifyMfa(
        {
          challengeId: body.challengeId,
          code: body.code,
          ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
        },
        evidence(request),
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.post(
    '/v1/auth/refresh',
    {
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: { operationId: 'refreshSession', tags: ['Authentication'], response: errors },
    },
    async (request, reply) => {
      const result = await service.refresh(
        refreshBody.parse(request.body).refreshToken,
        evidence(request),
      );
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.post(
    '/v1/auth/recovery/start',
    {
      config: { rateLimit: { max: 3, timeWindow: '30 minutes' } },
      schema: {
        operationId: 'startRecovery',
        tags: ['Authentication'],
        response: {
          ...errors,
          202: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'accepted' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = recoveryStartBody.parse(request.body);
      await service.startRecovery(body.email, request.id, evidence(request));
      return reply.code(202).send({ status: 'accepted' });
    },
  );

  app.post(
    '/v1/auth/recovery/complete',
    {
      config: { rateLimit: { max: 5, timeWindow: '30 minutes' } },
      schema: {
        operationId: 'completeRecovery',
        tags: ['Authentication'],
        response: { ...errors, 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      const body = recoveryCompleteBody.parse(request.body);
      await service.completeRecovery(body.token, body.newPassword, evidence(request));
      return reply.code(204).send();
    },
  );

  app.get(
    '/v1/auth/sessions',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      schema: {
        operationId: 'listSessions',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: errors,
      },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send({ sessions: await service.listSessions(request.auth.sub) }),
  );

  app.delete(
    '/v1/auth/sessions/:sessionId',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      schema: {
        operationId: 'revokeSession',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: { ...errors, 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      const { sessionId } = sessionParams.parse(request.params);
      await service.revokeSession(request.auth.sub, sessionId, evidence(request));
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/auth/sessions',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      schema: {
        operationId: 'revokeAllSessions',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: { ...errors, 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await service.revokeAllSessions(request.auth.sub, evidence(request));
      return reply.code(204).send();
    },
  );
}

function evidence(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
