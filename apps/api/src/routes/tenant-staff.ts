import {
  errorResponseJsonSchema,
  tenantRolePresets,
  tenantRoles,
  type Permission,
} from '@isp/contracts';
import { TenantStaffNotFoundError } from '@isp/database';
import { assertPermission, assertTenantContext, AuthorizationDeniedError } from '@isp/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditWriter } from '../audit.js';
import type { AuthService } from '../auth-service.js';
import type { TenantStaffApiService } from '../staff.js';
import type { TenantStaffScopeService } from '../staff-scope-service.js';

const paramsSchema = z.object({ tenantId: z.uuid() });
const memberParamsSchema = paramsSchema.extend({ userId: z.uuid() });
const sessionParamsSchema = memberParamsSchema.extend({ sessionId: z.uuid() });
const invitationParamsSchema = paramsSchema.extend({ invitationId: z.uuid() });
const scopeSchema = z
  .object({
    branchIds: z.array(z.uuid()).max(100).optional(),
    areaIds: z.array(z.uuid()).max(200).optional(),
    routeIds: z.array(z.uuid()).max(500).optional(),
    recordIds: z.array(z.uuid()).max(500).optional(),
  })
  .strict();
const invitationBodySchema = z
  .object({
    email: z.email().max(320),
    displayName: z.string().trim().min(2).max(120),
    roleKey: z.enum(tenantRoles),
    scope: scopeSchema,
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const membershipBodySchema = z
  .object({
    roleKey: z.enum(tenantRoles),
    scope: scopeSchema,
    active: z.boolean(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const revocationBodySchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
const recoveryBodySchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
const invitationAcceptBodySchema = z
  .object({
    token: z.string().min(32).max(512),
    newPassword: z.string().min(12).max(128),
  })
  .strict();
const idempotencyHeaderSchema = z.string().trim().min(8).max(160);

const staffMemberJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'email',
    'displayName',
    'roleKey',
    'permissions',
    'active',
    'mfaRequired',
    'disabled',
    'authorizationVersion',
    'scope',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    roleKey: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    active: { type: 'boolean' },
    mfaRequired: { type: 'boolean' },
    disabled: { type: 'boolean' },
    authorizationVersion: { type: 'integer', minimum: 1 },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: {
        branchIds: { type: 'array', items: { type: 'string' } },
        areaIds: { type: 'array', items: { type: 'string' } },
        routeIds: { type: 'array', items: { type: 'string' } },
        recordIds: { type: 'array', items: { type: 'string' } },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const invitationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'displayName', 'roleKey', 'scope', 'status', 'expiresAt', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    roleKey: { type: 'string' },
    scope: staffMemberJsonSchema.properties.scope,
    status: { type: 'string', enum: ['pending', 'accepted', 'revoked', 'expired'] },
    expiresAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export interface TenantStaffRouteOptions {
  readonly audit: AuditWriter;
  readonly staff: TenantStaffApiService;
  readonly scopes?: TenantStaffScopeService;
  readonly auth?: AuthService;
  readonly now: () => Date;
}

export function registerTenantStaffRoute(
  app: FastifyInstance,
  options: TenantStaffRouteOptions,
): void {
  if (options.scopes) {
    app.get(
      '/v1/tenants/:tenantId/staff/scopes',
      {
        onRequest: [(request, reply) => app.authenticate(request, reply)],
        schema: {
          operationId: 'readTenantStaffScopes',
          tags: ['Tenant identity'],
          security: [{ bearerAuth: [] }],
          response: {
            400: errorResponseJsonSchema,
            401: errorResponseJsonSchema,
            403: errorResponseJsonSchema,
          },
        },
      },
      async (request, reply) => {
        const { tenantId } = paramsSchema.parse(request.params);
        const context = assertTenantContext(request.auth, tenantId, options.now());
        assertPermission(request.auth, 'tenant.user.administer');
        const catalogue = await options.scopes!.read(context.tenantId, scopeActor(request));
        return reply.header('cache-control', 'private, no-store').send(catalogue);
      },
    );
  }
  app.get(
    '/v1/tenants/:tenantId/staff',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        operationId: 'readTenantStaff',
        summary: 'Read the tenant staff and access directory',
        description:
          'Returns identity status, role, permissions, MFA policy, and authorization scope. Password and secret material is never returned.',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['tenantId'],
          properties: { tenantId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['tenantId', 'members', 'invitations'],
            properties: {
              tenantId: { type: 'string', format: 'uuid' },
              members: { type: 'array', items: staffMemberJsonSchema },
              invitations: { type: 'array', items: invitationJsonSchema },
            },
          },
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { tenantId } = paramsSchema.parse(request.params);
      const permission: Permission = 'tenant.user.administer';
      const context = assertTenantContext(request.auth, tenantId, options.now());
      try {
        assertPermission(request.auth, permission);
      } catch (error) {
        await options.audit.append({
          tenantId: context.tenantId,
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
          action: context.supportGrantId ? 'support.tenant.staff.read' : 'tenant.staff.read',
          resourceType: 'tenant_staff_directory',
          resourceId: tenantId,
          requestId: request.id,
          ipAddress: request.ip,
          result: 'denied',
          metadata: { permission },
          occurredAt: options.now().toISOString(),
        });
        throw error;
      }

      let directory: readonly [
        Awaited<ReturnType<TenantStaffApiService['read']>>,
        Awaited<ReturnType<TenantStaffApiService['readInvitations']>>,
      ];
      try {
        directory = await Promise.all([
          options.staff.read(context.tenantId),
          options.staff.readInvitations(context.tenantId),
        ]);
      } catch (error) {
        await options.audit.append({
          tenantId: context.tenantId,
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
          action: context.supportGrantId ? 'support.tenant.staff.read' : 'tenant.staff.read',
          resourceType: 'tenant_staff_directory',
          resourceId: tenantId,
          requestId: request.id,
          ipAddress: request.ip,
          result: 'failed',
          metadata: { permission, failureClass: 'staff_reader' },
          occurredAt: options.now().toISOString(),
        });
        throw error;
      }
      const [members, invitations] = directory;
      await options.audit.append({
        tenantId: context.tenantId,
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
        action: context.supportGrantId ? 'support.tenant.staff.read' : 'tenant.staff.read',
        resourceType: 'tenant_staff_directory',
        resourceId: tenantId,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        result: 'allowed',
        metadata: {
          permission,
          memberCount: members.length,
          invitationCount: invitations.length,
        },
        occurredAt: options.now().toISOString(),
      });
      return reply
        .header('cache-control', 'private, no-store')
        .send({ tenantId, members, invitations });
    },
  );

  app.get(
    '/v1/tenants/:tenantId/staff/roles',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      schema: {
        operationId: 'readTenantStaffRoles',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['roles'],
            properties: {
              roles: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['key', 'permissions', 'requiresMfa', 'scopeMode'],
                  properties: {
                    key: { type: 'string', enum: tenantRoles },
                    permissions: { type: 'array', items: { type: 'string' } },
                    requiresMfa: { type: 'boolean' },
                    scopeMode: { type: 'string', enum: ['tenant', 'branch_area_route'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId } = paramsSchema.parse(request.params);
      const context = assertTenantContext(request.auth, tenantId, options.now());
      assertPermission(request.auth, 'tenant.user.administer');
      await options.audit.append({
        tenantId: context.tenantId,
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
        action: context.supportGrantId
          ? 'support.tenant.staff.roles.read'
          : 'tenant.staff.roles.read',
        resourceType: 'tenant_role_catalogue',
        resourceId: tenantId,
        requestId: request.id,
        ipAddress: request.ip,
        result: 'allowed',
        metadata: { permission: 'tenant.user.administer' },
        occurredAt: options.now().toISOString(),
      });
      return reply
        .header('cache-control', 'private, no-store')
        .send({ roles: tenantRoles.map((role) => tenantRolePresets[role]) });
    },
  );

  app.post(
    '/v1/tenants/:tenantId/staff/invitations',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        operationId: 'inviteTenantStaff',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['invitationId', 'status', 'expiresAt', 'replayed'],
            properties: {
              invitationId: { type: 'string', format: 'uuid' },
              status: { type: 'string', const: 'pending' },
              expiresAt: { type: 'string', format: 'date-time' },
              replayed: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId } = paramsSchema.parse(request.params);
      const context = await authorizeStaffMutation(request, tenantId, options, 'invitation.create');
      const body = invitationBodySchema.parse(request.body);
      const scope = cleanScope(body.scope);
      if (options.scopes)
        await options.scopes.assertValid(context.tenantId, scope, scopeActor(request));
      const idempotencyKey = idempotencyHeaderSchema.parse(request.headers['idempotency-key']);
      const result = await options.staff.invite(
        context.tenantId,
        {
          email: body.email,
          displayName: body.displayName,
          roleKey: body.roleKey,
          scope,
        },
        {
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          requestId: request.id,
          ipAddress: request.ip,
          ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
          reason: body.reason,
          idempotencyKey,
        },
      );
      return reply.code(201).header('cache-control', 'no-store').send(result);
    },
  );

  app.patch(
    '/v1/tenants/:tenantId/staff/:userId',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        operationId: 'updateTenantStaffMembership',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['authorizationVersion'],
            properties: { authorizationVersion: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = memberParamsSchema.parse(request.params);
      const context = await authorizeStaffMutation(request, tenantId, options, 'membership.update');
      const body = membershipBodySchema.parse(request.body);
      const scope = cleanScope(body.scope);
      if (options.scopes)
        await options.scopes.assertValid(context.tenantId, scope, scopeActor(request));
      const authorizationVersion = await options.staff.updateMembership(
        context.tenantId,
        userId,
        { roleKey: body.roleKey, scope, active: body.active },
        {
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          requestId: request.id,
          ipAddress: request.ip,
          ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
          reason: body.reason,
        },
      );
      return reply.header('cache-control', 'no-store').send({ authorizationVersion });
    },
  );

  app.post(
    '/v1/tenants/:tenantId/staff/invitations/:invitationId/revoke',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        operationId: 'revokeTenantStaffInvitation',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['revoked'],
            properties: { revoked: { type: 'boolean' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, invitationId } = invitationParamsSchema.parse(request.params);
      const context = await authorizeStaffMutation(request, tenantId, options, 'invitation.revoke');
      const body = revocationBodySchema.parse(request.body);
      const revoked = await options.staff.revokeInvitation(context.tenantId, invitationId, {
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        reason: body.reason,
      });
      return reply.header('cache-control', 'no-store').send({ revoked });
    },
  );

  app.get(
    '/v1/tenants/:tenantId/staff/:userId/sessions',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
      schema: {
        operationId: 'readTenantStaffSessions',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['sessions'],
            properties: {
              sessions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'id',
                    'lastSeenAt',
                    'idleExpiresAt',
                    'absoluteExpiresAt',
                    'createdAt',
                    'current',
                  ],
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    deviceLabel: { type: 'string' },
                    ipAddress: { type: 'string' },
                    userAgent: { type: 'string' },
                    mfaVerifiedAt: { type: 'string', format: 'date-time' },
                    lastSeenAt: { type: 'string', format: 'date-time' },
                    idleExpiresAt: { type: 'string', format: 'date-time' },
                    absoluteExpiresAt: { type: 'string', format: 'date-time' },
                    revokedAt: { type: 'string', format: 'date-time' },
                    revokeReason: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    current: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = memberParamsSchema.parse(request.params);
      const context = await authorizeStaffMutation(request, tenantId, options, 'sessions.read');
      const sessions = await options.staff.readSessions(context.tenantId, userId, {
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        reason: 'Administrator reviewed staff sessions',
      });
      return reply.header('cache-control', 'private, no-store').send({ sessions });
    },
  );

  app.post(
    '/v1/tenants/:tenantId/staff/:userId/sessions/:sessionId/revoke',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        operationId: 'revokeTenantStaffSession',
        tags: ['Tenant identity'],
        security: [{ bearerAuth: [] }],
        response: {
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['revoked'],
            properties: { revoked: { type: 'boolean' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, userId, sessionId } = sessionParamsSchema.parse(request.params);
      const context = await authorizeStaffMutation(request, tenantId, options, 'session.revoke');
      const body = revocationBodySchema.parse(request.body);
      const revoked = await options.staff.revokeSession(context.tenantId, userId, sessionId, {
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        reason: body.reason,
      });
      return reply.header('cache-control', 'no-store').send({ revoked });
    },
  );

  if (options.auth) {
    app.post(
      '/v1/tenants/:tenantId/staff/:userId/recovery',
      {
        onRequest: [(request, reply) => app.authenticate(request, reply)],
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
        schema: {
          operationId: 'startTenantStaffRecovery',
          tags: ['Tenant identity'],
          security: [{ bearerAuth: [] }],
          response: {
            400: errorResponseJsonSchema,
            401: errorResponseJsonSchema,
            403: errorResponseJsonSchema,
            404: errorResponseJsonSchema,
            202: { type: 'null' },
          },
        },
      },
      async (request, reply) => {
        const { tenantId, userId } = memberParamsSchema.parse(request.params);
        const context = await authorizeStaffMutation(request, tenantId, options, 'recovery.start');
        const body = recoveryBodySchema.parse(request.body);
        const idempotencyKey = idempotencyHeaderSchema.parse(request.headers['idempotency-key']);
        const target = (await options.staff.read(context.tenantId)).find(
          (member) => member.id === userId,
        );
        if (!target) throw new TenantStaffNotFoundError('Tenant staff membership was not found.');
        await options.auth!.startRecovery(target.email, idempotencyKey, requestEvidence(request));
        await options.audit.append({
          tenantId: context.tenantId,
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          action: 'tenant.staff.recovery.start',
          resourceType: 'tenant_staff_identity',
          resourceId: userId,
          requestId: request.id,
          ipAddress: request.ip,
          result: 'allowed',
          metadata: { delivery: 'requested', targetUserId: userId, businessReason: body.reason },
          occurredAt: options.now().toISOString(),
        });
        return reply.code(202).send();
      },
    );
  }

  app.post(
    '/v1/staff-invitations/accept',
    {
      config: { rateLimit: { max: 5, timeWindow: '30 minutes' } },
      schema: {
        operationId: 'acceptTenantStaffInvitation',
        tags: ['Authentication'],
        response: {
          400: errorResponseJsonSchema,
          429: errorResponseJsonSchema,
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['outcome', 'tenantId'],
            properties: {
              outcome: { type: 'string', enum: ['created', 'existing_account'] },
              tenantId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = invitationAcceptBodySchema.parse(request.body);
      const result = await options.staff.accept(
        body.token,
        body.newPassword,
        requestEvidence(request),
      );
      return reply.header('cache-control', 'no-store').send({
        outcome: result.outcome,
        tenantId: result.tenantId,
      });
    },
  );
}

async function authorizeStaffMutation(
  request: FastifyRequest,
  tenantId: string,
  options: TenantStaffRouteOptions,
  action: string,
) {
  const context = assertTenantContext(request.auth, tenantId, options.now());
  try {
    assertPermission(request.auth, 'tenant.user.administer');
    if (context.supportGrantId) {
      throw new AuthorizationDeniedError('Support grants cannot administer tenant identities.');
    }
    const verifiedAt = request.auth.mfaVerifiedAt
      ? Date.parse(request.auth.mfaVerifiedAt)
      : Number.NaN;
    if (!Number.isFinite(verifiedAt) || options.now().getTime() - verifiedAt > 10 * 60_000) {
      throw new AuthorizationDeniedError('Recent MFA verification is required.');
    }
    return context;
  } catch (error) {
    await options.audit.append({
      tenantId: context.tenantId,
      actorId: request.auth.sub,
      sessionId: request.auth.sessionId,
      action: `tenant.staff.${action}`,
      resourceType: 'tenant_staff_administration',
      resourceId: tenantId,
      requestId: request.id,
      ipAddress: request.ip,
      result: 'denied',
      metadata: { permission: 'tenant.user.administer', recentMfaRequired: true },
      occurredAt: options.now().toISOString(),
    });
    throw error;
  }
}

function requestEvidence(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}

function scopeActor(request: FastifyRequest) {
  return {
    actorId: request.auth.sub,
    sessionId: request.auth.sessionId,
    requestId: request.id,
    ipAddress: request.ip,
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}

function cleanScope(scope: z.infer<typeof scopeSchema>) {
  return {
    ...(scope.branchIds ? { branchIds: scope.branchIds } : {}),
    ...(scope.areaIds ? { areaIds: scope.areaIds } : {}),
    ...(scope.routeIds ? { routeIds: scope.routeIds } : {}),
    ...(scope.recordIds ? { recordIds: scope.recordIds } : {}),
  };
}
