import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ControlCenterAuthorizationError,
  ControlCenterConflictError,
  ControlCenterIdempotencyError,
  ControlCenterNotFoundError,
  ControlCenterPreconditionError,
  ControlCenterValidationError,
  CollectAuthorizationError,
  CollectConflictError,
  CollectValidationError,
  FinanceConflictError,
  IdempotencyConflictError,
  OperationsAuthorizationError,
  OperationsConflictError,
  OperationsIdempotencyConflictError,
  OperationsValidationError,
  TenantStaffAuthorizationError,
  TenantStaffConflictError,
  TenantStaffNotFoundError,
  TenantStaffValidationError,
} from '@isp/database';
import { AuthorizationDeniedError, ControlCenterRuleError } from '@isp/domain';
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
import {
  registerControlCenterRoutes,
  type ControlCenterApiService,
} from './routes/control-center/index.js';
import { registerTenantOperationsRoutes } from './routes/operations/index.js';
import type { OperationsWriter } from './routes/operations/contracts.js';
import { registerCollectRoutes } from './routes/collect/index.js';
import type { CollectApiService } from './collect-service.js';
import type { AuthService } from './auth-service.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTenantStaffRoute } from './routes/tenant-staff.js';
import { StaffInvitationDeliveryError, type TenantStaffApiService } from './staff.js';
import type { TenantStaffScopeService } from './staff-scope-service.js';

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
  readonly controlCenter?: ControlCenterApiService;
  readonly operations?: OperationsWriter;
  readonly collect?: CollectApiService;
  readonly auth?: AuthService | ((app: FastifyInstance) => AuthService);
  readonly staff?: TenantStaffApiService;
  readonly staffScopes?: TenantStaffScopeService;
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
  const authService = dependencies.auth
    ? typeof dependencies.auth === 'function'
      ? dependencies.auth(app)
      : dependencies.auth
    : undefined;
  if (authService) registerAuthRoutes(app, authService);

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
  if (dependencies.staff) {
    registerTenantStaffRoute(app, {
      audit: dependencies.audit ?? new MemoryAuditWriter(),
      staff: dependencies.staff,
      ...(dependencies.staffScopes ? { scopes: dependencies.staffScopes } : {}),
      ...(authService ? { auth: authService } : {}),
      now,
    });
  }
  registerTenantFinanceRoutes(app, {
    audit: dependencies.audit ?? new MemoryAuditWriter(),
    finance: dependencies.finance ?? new UnconfiguredFinanceWriter(),
    securityAudit,
    now,
  });
  if (dependencies.controlCenter) {
    registerControlCenterRoutes(app, { service: dependencies.controlCenter, now });
  }
  if (dependencies.operations) {
    registerTenantOperationsRoutes(app, {
      writer: dependencies.operations,
      audit: dependencies.audit ?? new MemoryAuditWriter(),
      securityAudit,
      now,
    });
  }
  if (dependencies.collect) {
    registerCollectRoutes(app, { service: dependencies.collect, now });
  }

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (
      error instanceof AuthorizationDeniedError ||
      error instanceof ControlCenterAuthorizationError ||
      error instanceof OperationsAuthorizationError ||
      error instanceof CollectAuthorizationError ||
      error instanceof TenantStaffAuthorizationError
    ) {
      return reply.code(403).send({
        error: { code: error.code, message: error.message, requestId },
      });
    }
    if (
      error instanceof IdempotencyConflictError ||
      error instanceof FinanceConflictError ||
      error instanceof ControlCenterIdempotencyError ||
      error instanceof ControlCenterConflictError ||
      error instanceof OperationsConflictError ||
      error instanceof OperationsIdempotencyConflictError ||
      error instanceof CollectConflictError ||
      error instanceof TenantStaffConflictError
    ) {
      return reply.code(409).send({
        error: { code: error.code, message: error.message, requestId },
      });
    }
    if (error instanceof ControlCenterPreconditionError) {
      return reply
        .code(412)
        .send({ error: { code: error.code, message: error.message, requestId } });
    }
    if (error instanceof ControlCenterNotFoundError) {
      return reply
        .code(404)
        .send({ error: { code: error.code, message: error.message, requestId } });
    }
    if (error instanceof TenantStaffNotFoundError) {
      return reply
        .code(404)
        .send({ error: { code: error.code, message: error.message, requestId } });
    }
    if (error instanceof ControlCenterValidationError || error instanceof ControlCenterRuleError) {
      return reply
        .code(400)
        .send({ error: { code: error.code, message: error.message, requestId } });
    }
    if (
      error instanceof OperationsValidationError ||
      error instanceof CollectValidationError ||
      error instanceof TenantStaffValidationError
    ) {
      return reply
        .code(400)
        .send({ error: { code: error.code, message: error.message, requestId } });
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
    if (frameworkStatus === 400) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: error instanceof Error ? error.message : 'The request was invalid.',
          requestId,
        },
      });
    }
    if (error instanceof StaffInvitationDeliveryError || frameworkStatus === 503) {
      return reply.code(503).send({
        error: {
          code: 'EXTERNAL_DEPENDENCY_UNAVAILABLE',
          message:
            error instanceof Error ? error.message : 'An external dependency is unavailable.',
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
