import type { Permission } from '@isp/contracts';
import { assertPermission, assertTenantContext } from '@isp/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditWriter } from '../audit.js';
import type { TenantSummaryReader } from '../summary.js';

const paramsSchema = z.object({ tenantId: z.uuid() });

export interface TenantSummaryRouteOptions {
  readonly audit: AuditWriter;
  readonly summaries: TenantSummaryReader;
  readonly now: () => Date;
}

export function registerTenantSummaryRoute(
  app: FastifyInstance,
  options: TenantSummaryRouteOptions,
): void {
  app.get(
    '/v1/tenants/:tenantId/summary',
    {
      onRequest: [(request, reply) => app.authenticate(request, reply)],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { tenantId } = paramsSchema.parse(request.params);
      const permission: Permission = 'tenant.dashboard.view';
      let context: ReturnType<typeof assertTenantContext>;
      try {
        context = assertTenantContext(request.auth, tenantId, options.now());
        assertPermission(request.auth, permission);
      } catch (error) {
        const requestedSupportGrantId = request.auth.supportGrant?.grantId;
        const authenticatedTenantId = request.auth.tenantId ?? request.auth.supportGrant?.tenantId;
        if (authenticatedTenantId) {
          const verifiedAuditContext = assertTenantContext(
            request.auth,
            authenticatedTenantId,
            options.now(),
          );
          await options.audit.append({
            tenantId: verifiedAuditContext.tenantId,
            actorId: request.auth.sub,
            sessionId: request.auth.sessionId,
            ...(requestedSupportGrantId ? { supportGrantId: requestedSupportGrantId } : {}),
            action:
              request.auth.audience === 'platform'
                ? 'support.tenant.summary.read'
                : 'tenant.summary.read',
            resourceType: 'tenant_summary',
            resourceId: tenantId,
            requestId: request.id,
            ipAddress: request.ip,
            result: 'denied',
            metadata: { permission, requestedTenantId: tenantId },
            occurredAt: options.now().toISOString(),
          });
        } else {
          request.log.warn(
            { action: 'tenant.summary.read', requestedTenantId: tenantId },
            'unscoped platform access denied; control-plane audit sink required',
          );
        }
        throw error;
      }

      const userAgentHeader = request.headers['user-agent'];
      let summary;
      try {
        summary = await options.summaries.read(context.tenantId, options.now());
      } catch (error) {
        await options.audit.append({
          tenantId: context.tenantId,
          actorId: request.auth.sub,
          sessionId: request.auth.sessionId,
          ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
          action: context.supportGrantId ? 'support.tenant.summary.read' : 'tenant.summary.read',
          resourceType: 'tenant_summary',
          resourceId: tenantId,
          requestId: request.id,
          ipAddress: request.ip,
          result: 'failed',
          metadata: { permission, failureClass: 'summary_reader' },
          occurredAt: options.now().toISOString(),
        });
        throw error;
      }
      const baseAudit = {
        tenantId: context.tenantId,
        actorId: request.auth.sub,
        sessionId: request.auth.sessionId,
        action: context.supportGrantId ? 'support.tenant.summary.read' : 'tenant.summary.read',
        resourceType: 'tenant_summary',
        resourceId: tenantId,
        requestId: request.id,
        ipAddress: request.ip,
        result: 'allowed' as const,
        metadata: { permission },
        occurredAt: options.now().toISOString(),
      };

      await options.audit.append({
        ...baseAudit,
        ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
        ...(userAgentHeader ? { userAgent: userAgentHeader } : {}),
      });

      return reply.header('cache-control', 'private, no-store').send(summary);
    },
  );
}
