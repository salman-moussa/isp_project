import { errorResponseJsonSchema, type Permission } from '@isp/contracts';
import { assertPermission, assertTenantContext } from '@isp/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditWriter } from '../audit.js';
import type { TenantStaffReader } from '../staff.js';

const paramsSchema = z.object({ tenantId: z.uuid() });

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

export interface TenantStaffRouteOptions {
  readonly audit: AuditWriter;
  readonly staff: TenantStaffReader;
  readonly now: () => Date;
}

export function registerTenantStaffRoute(
  app: FastifyInstance,
  options: TenantStaffRouteOptions,
): void {
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
            required: ['tenantId', 'members'],
            properties: {
              tenantId: { type: 'string', format: 'uuid' },
              members: { type: 'array', items: staffMemberJsonSchema },
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

      try {
        const members = await options.staff.read(context.tenantId);
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
          metadata: { permission, memberCount: members.length },
          occurredAt: options.now().toISOString(),
        });
        return reply.header('cache-control', 'private, no-store').send({ tenantId, members });
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
    },
  );
}
