import type { Permission, SessionClaims } from '@isp/contracts';

export class AuthorizationDeniedError extends Error {
  public readonly code = 'AUTHORIZATION_DENIED';

  public constructor(message = 'The current identity is not authorized for this action.') {
    super(message);
    this.name = 'AuthorizationDeniedError';
  }
}

export function hasPermission(claims: SessionClaims, permission: Permission): boolean {
  if (claims.audience === 'platform' && claims.supportGrant) {
    return claims.supportGrant.permissions.includes(permission);
  }
  return claims.permissions.includes(permission);
}

export function assertPermission(claims: SessionClaims, permission: Permission): void {
  if (!hasPermission(claims, permission)) {
    throw new AuthorizationDeniedError();
  }
}

export function assertTenantContext(
  claims: SessionClaims,
  requestedTenantId: string,
  now: Date,
): { supportGrantId?: string } {
  if (claims.audience === 'tenant') {
    if (claims.tenantId !== requestedTenantId) {
      throw new AuthorizationDeniedError('Cross-tenant access is denied.');
    }
    return {};
  }

  const grant = claims.supportGrant;
  if (
    !grant ||
    grant.tenantId !== requestedTenantId ||
    Date.parse(grant.expiresAt) <= now.getTime()
  ) {
    throw new AuthorizationDeniedError('An active scoped support grant is required.');
  }
  return { supportGrantId: grant.grantId };
}
