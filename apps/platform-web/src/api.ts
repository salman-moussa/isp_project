import type {
  ApiSession,
  IntegrationDeliveryView,
  IntegrationEventView,
  IntegrationKindView,
  IntegrationSettingView,
} from '@isp/ui';
import type { ControlCenterClientRow } from './control-center/ControlCenterWorkspace';

interface ClientResponse {
  readonly id: string;
  readonly legalName: string;
  readonly tradingName: string;
  readonly state: ControlCenterClientRow['state'];
  readonly packageKey?: string;
  readonly deploymentHealth?: 'healthy' | 'attention' | 'blocked';
  readonly supportStatus?: 'clear' | 'open' | 'escalated';
  readonly openTicketCount: number;
}

export async function readControlClients(session: ApiSession): Promise<ControlCenterClientRow[]> {
  const response = await fetch(`${session.apiBaseUrl}/v1/control-center/clients?limit=100`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 401) session.logout();
  if (!response.ok) throw new Error(await safeMessage(response));
  const rows = (await response.json()) as ClientResponse[];
  return rows.map((row) => ({
    id: row.id,
    legalName: row.legalName,
    tradingName: row.tradingName,
    state: row.state,
    packageName: row.packageKey ?? '—',
    deploymentHealth: row.deploymentHealth ?? 'unknown',
    supportStatus: row.supportStatus ?? 'unknown',
    openTicketCount: row.openTicketCount,
  }));
}

export interface CreateControlClientInput {
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradingName: string;
  readonly registrationNumber?: string;
  readonly accountOwnerId?: string;
  readonly notes?: string;
  readonly reason: string;
}

export async function createControlClient(
  session: ApiSession,
  input: CreateControlClientInput,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(`${session.apiBaseUrl}/v1/control-center/clients`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (response.status === 401) session.logout();
  if (!response.ok) throw new Error(await safeMessage(response));
}

export async function submitControlAction(
  session: ApiSession,
  method: 'POST' | 'PUT',
  path: string,
  payload: Readonly<Record<string, unknown>>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${session.apiBaseUrl}/v1/control-center/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) session.logout();
  const result = (await response.json()) as Record<string, unknown> & {
    readonly error?: { readonly message?: string };
  };
  if (!response.ok) throw new Error(result.error?.message ?? `Action failed (${response.status}).`);
  return result;
}

async function safeMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export class ControlApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ControlApiError';
  }
}

export interface ControlIntegrationWorkspace {
  readonly settings: readonly IntegrationSettingView[];
  readonly recentEvents: readonly IntegrationEventView[];
  readonly recentDeliveries: readonly IntegrationDeliveryView[];
}

export async function readControlIntegrations(
  session: ApiSession,
): Promise<ControlIntegrationWorkspace> {
  const response = await fetch(`${session.apiBaseUrl}/v1/control-center/integrations`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 401) session.logout();
  if (!response.ok) throw new ControlApiError(await safeMessage(response), response.status);
  return (await response.json()) as ControlIntegrationWorkspace;
}

export interface ControlIntegrationConfigureBody {
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly keepSecrets: boolean;
  readonly active: boolean;
  readonly expectedVersion?: number;
  readonly reason: string;
}

export function configureControlIntegration(
  session: ApiSession,
  kind: IntegrationKindView,
  body: ControlIntegrationConfigureBody,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  return submitControlAction(
    session,
    'PUT',
    `integrations/${encodeURIComponent(kind)}`,
    body,
    idempotencyKey,
  );
}

export function testControlIntegration(
  session: ApiSession,
  kind: IntegrationKindView,
  body: { readonly recipient: string; readonly reason: string },
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  return submitControlAction(
    session,
    'POST',
    `integrations/${encodeURIComponent(kind)}/tests`,
    body,
    idempotencyKey,
  );
}
