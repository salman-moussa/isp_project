import { z } from 'zod';
import { permissions } from './permissions.js';

const identifier = z.string().min(1).max(128);

export const supportGrantSchema = z.object({
  grantId: identifier,
  tenantId: identifier,
  ticketId: identifier,
  approverId: identifier,
  reason: z.string().min(8).max(500),
  permissions: z.array(z.enum(permissions)).min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

export const sessionClaimsSchema = z
  .object({
    sub: identifier,
    sessionId: identifier,
    audience: z.enum(['platform', 'tenant']),
    tenantId: identifier.optional(),
    permissions: z.array(z.enum(permissions)),
    branchIds: z.array(identifier).optional(),
    areaIds: z.array(identifier).optional(),
    routeIds: z.array(identifier).optional(),
    mfaVerifiedAt: z.string().datetime({ offset: true }).optional(),
    supportGrant: supportGrantSchema.optional(),
  })
  .superRefine((claims, context) => {
    if (claims.audience === 'tenant' && !claims.tenantId) {
      context.addIssue({
        code: 'custom',
        path: ['tenantId'],
        message: 'Tenant sessions require a tenant identifier.',
      });
    }
    if (claims.audience === 'tenant' && claims.supportGrant) {
      context.addIssue({
        code: 'custom',
        path: ['supportGrant'],
        message: 'Tenant sessions cannot contain platform support grants.',
      });
    }
  });

export type SupportGrant = z.infer<typeof supportGrantSchema>;
export type SessionClaims = z.infer<typeof sessionClaimsSchema>;
