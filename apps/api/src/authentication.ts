import { sessionClaimsSchema, type Permission } from '@isp/contracts';
import type { FastifyInstance } from 'fastify';

export interface SessionStatusReader {
  isActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
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
  supportGrants: SupportGrantStatusReader,
  now: () => Date,
): void {
  app.decorateRequest('auth');
  app.decorate('authenticate', async (request) => {
    const rawClaims = await request.jwtVerify();
    const parsedClaims = sessionClaimsSchema.safeParse(rawClaims);
    if (!parsedClaims.success) {
      throw new SessionInvalidError();
    }
    const claims = parsedClaims.data;
    if (!(await sessions.isActive(claims.sessionId, claims.sub, now()))) {
      throw new SessionInvalidError();
    }
    if (claims.supportGrant) {
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
  });
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
