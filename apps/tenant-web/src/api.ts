import type { ApiSession } from '@isp/ui';

export interface TenantSummary {
  readonly tenantId: string;
  readonly asOf: string;
  readonly activeSubscribers: number;
  readonly onlineSubscribers: number;
  readonly collections: { readonly USD: number; readonly LBP: number };
}

export interface TenantStaffMember {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleKey: string;
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly mfaRequired: boolean;
  readonly disabled: boolean;
  readonly authorizationVersion: number;
  readonly scope: {
    readonly branchIds?: readonly string[];
    readonly areaIds?: readonly string[];
    readonly routeIds?: readonly string[];
    readonly recordIds?: readonly string[];
  };
  readonly createdAt: string;
}

export interface TenantStaffInvitation {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleKey: string;
  readonly scope: TenantStaffMember['scope'];
  readonly status: 'pending' | 'accepted' | 'revoked' | 'expired';
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface TenantStaffSession {
  readonly id: string;
  readonly deviceLabel?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly mfaVerifiedAt?: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt?: string;
  readonly revokeReason?: string;
  readonly createdAt: string;
  readonly current: boolean;
}

export interface TenantStaffRole {
  readonly key: string;
  readonly permissions: readonly string[];
  readonly requiresMfa: boolean;
  readonly scopeMode: 'tenant' | 'branch_area_route';
}

export interface TenantScopeItem {
  readonly id: string;
  readonly parentId?: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface TenantScopeCatalogue {
  readonly branches: readonly TenantScopeItem[];
  readonly areas: readonly TenantScopeItem[];
  readonly routes: readonly TenantScopeItem[];
}

export interface TenantStaffAccess {
  readonly members: readonly TenantStaffMember[];
  readonly invitations: readonly TenantStaffInvitation[];
  readonly roles: readonly TenantStaffRole[];
  readonly scopes: TenantScopeCatalogue;
}

export async function readTenantStaff(session: ApiSession): Promise<TenantStaffAccess> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const base = `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/staff`;
  const [directoryResponse, rolesResponse, scopesResponse] = await Promise.all([
    fetch(base, { headers: authorizationHeaders(session) }),
    fetch(`${base}/roles`, { headers: authorizationHeaders(session) }),
    fetch(`${base}/scopes`, { headers: authorizationHeaders(session) }),
  ]);
  if (
    directoryResponse.status === 401 ||
    rolesResponse.status === 401 ||
    scopesResponse.status === 401
  )
    session.logout();
  if (!directoryResponse.ok || !rolesResponse.ok || !scopesResponse.ok) {
    throw new Error(
      `Tenant staff request failed (${!directoryResponse.ok ? directoryResponse.status : !rolesResponse.ok ? rolesResponse.status : scopesResponse.status}).`,
    );
  }
  const directory = (await directoryResponse.json()) as {
    readonly members: readonly TenantStaffMember[];
    readonly invitations: readonly TenantStaffInvitation[];
  };
  const roleBody = (await rolesResponse.json()) as { readonly roles: readonly TenantStaffRole[] };
  const scopes = (await scopesResponse.json()) as TenantScopeCatalogue;
  return { ...directory, roles: roleBody.roles, scopes };
}

export async function inviteTenantStaff(
  session: ApiSession,
  input: {
    readonly email: string;
    readonly displayName: string;
    readonly roleKey: string;
    readonly scope: TenantStaffMember['scope'];
    readonly reason: string;
  },
): Promise<void> {
  await staffMutation(session, '/invitations', 'POST', input, crypto.randomUUID());
}

export async function updateTenantStaff(
  session: ApiSession,
  userId: string,
  input: {
    readonly roleKey: string;
    readonly scope: TenantStaffMember['scope'];
    readonly active: boolean;
    readonly reason: string;
  },
): Promise<void> {
  await staffMutation(session, `/${encodeURIComponent(userId)}`, 'PATCH', input);
}

export async function revokeTenantStaffInvitation(
  session: ApiSession,
  invitationId: string,
  reason: string,
): Promise<void> {
  await staffMutation(session, `/invitations/${encodeURIComponent(invitationId)}/revoke`, 'POST', {
    reason,
  });
}

export async function readTenantStaffSessions(
  session: ApiSession,
  userId: string,
): Promise<readonly TenantStaffSession[]> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/staff/${encodeURIComponent(userId)}/sessions`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Session request');
  const body = (await response.json()) as { readonly sessions: readonly TenantStaffSession[] };
  return body.sessions;
}

export async function revokeTenantStaffSession(
  session: ApiSession,
  userId: string,
  sessionId: string,
): Promise<void> {
  await staffMutation(
    session,
    `/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
    'POST',
    { reason: 'Administrator revoked staff device session' },
  );
}

export async function startTenantStaffRecovery(session: ApiSession, userId: string): Promise<void> {
  await staffMutation(
    session,
    `/${encodeURIComponent(userId)}/recovery`,
    'POST',
    { reason: 'Administrator requested secure staff account recovery' },
    crypto.randomUUID(),
  );
}

export async function acceptTenantStaffInvitation(
  apiBaseUrl: string,
  token: string,
  newPassword: string,
): Promise<{ readonly outcome: 'created' | 'existing_account'; readonly tenantId: string }> {
  const response = await fetch(`${apiBaseUrl}/v1/staff-invitations/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    readonly outcome?: 'created' | 'existing_account';
    readonly tenantId?: string;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || !result.outcome || !result.tenantId) {
    throw new Error(result.error?.message ?? `Invitation acceptance failed (${response.status}).`);
  }
  return { outcome: result.outcome, tenantId: result.tenantId };
}

async function staffMutation(
  session: ApiSession,
  suffix: string,
  method: 'POST' | 'PATCH',
  body: Readonly<Record<string, unknown>>,
  idempotencyKey?: string,
) {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/staff${suffix}`,
    {
      method,
      headers: {
        ...authorizationHeaders(session),
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) {
    throw await staffError(response, 'Staff operation');
  }
}

async function staffError(response: Response, label: string): Promise<Error> {
  const result = (await response.json().catch(() => ({}))) as {
    readonly error?: { readonly message?: string };
  };
  return new Error(result.error?.message ?? `${label} failed (${response.status}).`);
}

function authorizationHeaders(session: ApiSession) {
  return { authorization: `Bearer ${session.accessToken}` };
}

export async function readTenantSummary(session: ApiSession): Promise<TenantSummary> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/summary`,
    { headers: { authorization: `Bearer ${session.accessToken}` } },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw new Error(`Tenant summary request failed (${response.status}).`);
  return (await response.json()) as TenantSummary;
}

export async function submitTenantOperation(
  session: ApiSession,
  path: string,
  payload: Readonly<Record<string, unknown>>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
  );
  if (response.status === 401) session.logout();
  const result = (await response.json()) as Record<string, unknown> & {
    readonly error?: { readonly message?: string };
  };
  if (!response.ok) {
    throw new Error(result.error?.message ?? `Operation failed (${response.status}).`);
  }
  return result;
}
