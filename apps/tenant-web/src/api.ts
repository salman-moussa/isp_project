import type { ApiSession } from '@isp/ui';

export interface TenantSummary {
  readonly tenantId: string;
  readonly asOf: string;
  readonly activeSubscribers: number;
  readonly onlineSubscribers: number;
  readonly collections: { readonly USD: number; readonly LBP: number };
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
