import { sessionClaimsSchema } from '@isp/contracts';
import type { FastifyInstance } from 'fastify';

export interface SessionStatusReader {
  isActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
}

export interface SupportGrantStatusReader {
  isActive(grantId: string, tenantId: string, requesterId: string, now: Date): Promise<boolean>;
}

export class DenyAllSessionStatusReader implements SessionStatusReader {
  public async isActive(): Promise<boolean> {
    return false;
  }
}

export class DenyAllSupportGrantStatusReader implements SupportGrantStatusReader {
  public async isActive(): Promise<boolean> {
    return false;
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
    const claims = sessionClaimsSchema.parse(rawClaims);
    if (!(await sessions.isActive(claims.sessionId, claims.sub, now()))) {
      throw new SessionInvalidError();
    }
    if (
      claims.supportGrant &&
      !(await supportGrants.isActive(
        claims.supportGrant.grantId,
        claims.supportGrant.tenantId,
        claims.sub,
        now(),
      ))
    ) {
      throw new SessionInvalidError();
    }
    request.auth = claims;
  });
}
