import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FinanceConflictError, IdempotencyConflictError } from '@isp/database';
import { AuthorizationDeniedError } from '@isp/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { ZodError } from 'zod';
import type { ApiConfig } from './config.js';
import {
  DenyAllSessionStatusReader,
  DenyAllSupportGrantStatusReader,
  DenyAllTenantMembershipStatusReader,
  registerAuthentication,
  type SessionStatusReader,
  type SupportGrantStatusReader,
  type TenantMembershipStatusReader,
} from './authentication.js';
import { DemoTenantSummaryReader, type TenantSummaryReader } from './summary.js';
import { MemoryAuditWriter, type AuditWriter } from './audit.js';
import { registerTenantSummaryRoute } from './routes/tenant-summary.js';
import { registerTenantFinanceRoutes } from './routes/tenant-finance.js';
import { MemorySecurityAuditWriter, type SecurityAuditWriter } from './security-audit.js';
import { type FinanceWriter, UnconfiguredFinanceWriter } from './finance.js';

export interface AppDependencies {
  readonly audit?: AuditWriter;
  readonly finance?: FinanceWriter;
  readonly summaries?: TenantSummaryReader;
  readonly now?: () => Date;
  readonly sessions?: SessionStatusReader;
  readonly tenantMemberships?: TenantMembershipStatusReader;
  readonly supportGrants?: SupportGrantStatusReader;
  readonly readiness?: () => Promise<void>;
  readonly securityAudit?: SecurityAuditWriter;
}

export async function buildApp(
  config: ApiConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization'] },
    genReqId: () => ulid(),
    trustProxy: config.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: '15m',
      iss: config.SUPPORT_TOKEN_ISSUER,
      aud: config.SUPPORT_TOKEN_AUDIENCE,
    },
    verify: {
      allowedIss: config.SUPPORT_TOKEN_ISSUER,
      allowedAud: config.SUPPORT_TOKEN_AUDIENCE,
    },
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Orvex ISP Core API', version: '0.1.0' },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const now = dependencies.now ?? (() => new Date());
  const securityAudit = dependencies.securityAudit ?? new MemorySecurityAuditWriter();
  registerAuthentication(
    app,
    dependencies.sessions ?? new DenyAllSessionStatusReader(),
    dependencies.tenantMemberships ?? new DenyAllTenantMembershipStatusReader(),
    dependencies.supportGrants ?? new DenyAllSupportGrantStatusReader(),
    securityAudit,
    now,
  );

  app.get(
    '/health',
    {
      schema: {
        operationId: 'healthCheck',
        tags: ['Service'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'service'],
            properties: {
              status: { type: 'string', const: 'ok' },
              service: { type: 'string', const: 'api' },
            },
          },
        },
      },
    },
    async () => ({ status: 'ok', service: 'api' }),
  );
  app.get(
    '/ready',
    {
      schema: {
        operationId: 'readinessCheck',
        tags: ['Service'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'ready' } },
          },
          503: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'not_ready' } },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        if (!dependencies.readiness) throw new Error('No readiness probe is configured.');
        await dependencies.readiness();
        return { status: 'ready' };
      } catch {
        return reply.code(503).send({ status: 'not_ready' });
      }
    },
  );

  registerTenantSummaryRoute(app, {
    audit: dependencies.audit ?? new MemoryAuditWriter(),
    summaries: dependencies.summaries ?? new DemoTenantSummaryReader(),
    securityAudit,
    now,
  });
  registerTenantFinanceRoutes(app, {
    audit: dependencies.audit ?? new MemoryAuditWriter(),
    finance: dependencies.finance ?? new UnconfiguredFinanceWriter(),
    securityAudit,
    now,
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (error instanceof AuthorizationDeniedError) {
      return reply.code(403).send({
        error: { code: error.code, message: error.message, requestId },
      });
    }
    if (error instanceof IdempotencyConflictError || error instanceof FinanceConflictError) {
      return reply.code(409).send({
        error: { code: error.code, message: error.message, requestId },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request did not match the expected contract.',
          requestId,
          details: { issues: error.issues },
        },
      });
    }
    const frameworkValidation =
      typeof error === 'object' && error !== null && 'validation' in error
        ? error.validation
        : undefined;
    if (frameworkValidation) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request did not match the expected contract.',
          requestId,
          details: { issues: frameworkValidation },
        },
      });
    }
    const frameworkStatus =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    if (frameworkStatus === 401) {
      return reply.code(401).send({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          requestId,
        },
      });
    }
    request.log.error({ err: error, requestId }, 'request failed');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
    });
  });

  return app;
}
