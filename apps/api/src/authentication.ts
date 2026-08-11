import { sessionClaimsSchema, type Permission } from '@isp/contracts';
import type { FastifyInstance } from 'fastify';
import type { SecurityAuditWriter } from './security-audit.js';

export interface SessionStatusReader {
  isActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
}

export interface TenantMembershipStatusReader {
  readActive(tenantId: string, userId: string): Promise<ActiveTenantMembership | null>;
}

export interface ActiveTenantMembership {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissions: readonly Permission[];
  readonly authorizationVersion: number;
}

export interface SupportGrantStatusReader {
  readApproved(
    grantId: string,
    tenantId: string,
    requesterId: string,
    now: Date,
  ): Promise<ApprovedSupportGrant | null>;
}

export interface ApprovedSupportGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly ticketId: string;
  readonly approverId: string;
  readonly reason: string;
  readonly permissions: readonly Permission[];
  readonly expiresAt: string;
  readonly authorizationVersion: number;
}

export class DenyAllSessionStatusReader implements SessionStatusReader {
  public async isActive(): Promise<boolean> {
    return false;
  }
}

export class DenyAllTenantMembershipStatusReader implements TenantMembershipStatusReader {
  public async readActive(): Promise<null> {
    return null;
  }
}

export class DenyAllSupportGrantStatusReader implements SupportGrantStatusReader {
  public async readApproved(): Promise<null> {
    return null;
  }
}

export class SessionInvalidError extends Error {
  public readonly statusCode = 401;

  public constructor() {
    super('The session is expired, revoked, or unavailable.');
    this.name = 'SessionInvalidError';
  }
}

export function registerAuthentication(
  app: FastifyInstance,
  sessions: SessionStatusReader,
  tenantMemberships: TenantMembershipStatusReader,
  supportGrants: SupportGrantStatusReader,
  securityAudit: SecurityAuditWriter,
  now: () => Date,
): void {
  app.decorateRequest('auth');
  app.decorate('authenticate', async (request) => {
    let claims: ReturnType<typeof sessionClaimsSchema.parse> | undefined;
    try {
      const rawClaims = await request.jwtVerify();
      const parsedClaims = sessionClaimsSchema.safeParse(rawClaims);
      if (!parsedClaims.success) {
        throw new SessionInvalidError();
      }
      claims = parsedClaims.data;
      if (!(await sessions.isActive(claims.sessionId, claims.sub, now()))) {
        throw new SessionInvalidError();
      }
      if (claims.audience === 'tenant') {
        const membership = await tenantMemberships.readActive(claims.tenantId!, claims.sub);
        if (!membership || !matchesActiveTenantMembership(claims, membership)) {
          throw new SessionInvalidError();
        }
      } else if (claims.supportGrant) {
        const approvedGrant = await supportGrants.readApproved(
          claims.supportGrant.grantId,
          claims.supportGrant.tenantId,
          claims.sub,
          now(),
        );
        if (!approvedGrant || !matchesApprovedGrant(claims.supportGrant, approvedGrant)) {
          throw new SessionInvalidError();
        }
      }
      request.auth = claims;
    } catch (error) {
      const claimedTenantId = claims?.tenantId ?? claims?.supportGrant?.tenantId;
      await securityAudit.append({
        ...(claims?.sub ? { actorId: claims.sub } : {}),
        ...(claims?.sessionId ? { sessionId: claims.sessionId } : {}),
        ...(claimedTenantId ? { claimedTenantId } : {}),
        ...(claims?.supportGrant?.grantId ? { supportGrantId: claims.supportGrant.grantId } : {}),
        action: claims?.supportGrant ? 'support.authentication.validate' : 'session.validate',
        reason: error instanceof SessionInvalidError ? 'invalid_or_revoked' : 'verification_failed',
        requestId: request.id,
        ipAddress: request.ip,
        ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
        metadata: {},
        occurredAt: now().toISOString(),
      });
      throw error;
    }
  });
}

function matchesActiveTenantMembership(
  claims: ReturnType<typeof sessionClaimsSchema.parse>,
  membership: ActiveTenantMembership,
): boolean {
  return (
    claims.audience === 'tenant' &&
    claims.tenantId === membership.tenantId &&
    claims.sub === membership.userId &&
    claims.authorizationVersion === membership.authorizationVersion &&
    samePermissionSet(claims.permissions, membership.permissions)
  );
}

function matchesApprovedGrant(
  tokenGrant: NonNullable<ReturnType<typeof sessionClaimsSchema.parse>['supportGrant']>,
  approvedGrant: ApprovedSupportGrant,
): boolean {
  return (
    tokenGrant.grantId === approvedGrant.id &&
    tokenGrant.tenantId === approvedGrant.tenantId &&
    tokenGrant.ticketId === approvedGrant.ticketId &&
    tokenGrant.approverId === approvedGrant.approverId &&
    tokenGrant.reason === approvedGrant.reason &&
    tokenGrant.expiresAt === approvedGrant.expiresAt &&
    tokenGrant.authorizationVersion === approvedGrant.authorizationVersion &&
    samePermissionSet(tokenGrant.permissions, approvedGrant.permissions)
  );
}

function samePermissionSet(left: readonly Permission[], right: readonly Permission[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size && [...leftSet].every((permission) => rightSet.has(permission))
  );
}
