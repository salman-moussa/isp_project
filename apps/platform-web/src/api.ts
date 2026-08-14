import type { ApiSession } from '@isp/ui';
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

async function safeMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}
