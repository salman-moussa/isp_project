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

export type ControlIntegrationConfigureBody = {
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly keepSecrets: boolean;
  readonly active: boolean;
  readonly expectedVersion?: number;
  readonly reason: string;
};

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

async function readControlJson<T>(session: ApiSession, path: string): Promise<T> {
  const response = await fetch(`${session.apiBaseUrl}/v1/control-center/${path}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 401) session.logout();
  if (response.status === 403) throw new ControlApiError(await safeMessage(response), 403);
  if (!response.ok) throw new ControlApiError(await safeMessage(response), response.status);
  return (await response.json()) as T;
}

export interface ControlMoneyLine {
  readonly currency: 'USD' | 'LBP';
  readonly amountMinor: number;
}
export interface ControlPortfolio {
  readonly asOf: string;
  readonly clients: {
    readonly total: number;
    readonly byState: readonly { readonly state: string; readonly count: number }[];
    readonly newThisMonth: number;
  };
  readonly subscriptions: {
    readonly mrr: readonly (ControlMoneyLine & { readonly subscriptions: number })[];
    readonly renewalsDue: readonly {
      readonly tenantId: string;
      readonly tradingName: string;
      readonly state: string;
      readonly endsAt: string;
      readonly packageKey: string;
      readonly priceMinor: number;
      readonly currency: 'USD' | 'LBP';
    }[];
    readonly pendingTransitions: number;
  };
  readonly billing: {
    readonly outstanding: readonly (ControlMoneyLine & { readonly invoices: number })[];
    readonly receivedThisMonth: readonly (ControlMoneyLine & { readonly payments: number })[];
  };
  readonly service: {
    readonly healthy: number;
    readonly attention: number;
    readonly blocked: number;
    readonly unknown: number;
    readonly openTickets: number;
    readonly escalated: number;
    readonly activeSupportGrants: number;
    readonly requestedSupportGrants: number;
  };
  readonly activity: readonly {
    readonly id: string;
    readonly operation: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly tenantId: string | null;
    readonly tradingName: string | null;
    readonly actor: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[];
}
export interface ControlClientFile {
  readonly client: {
    readonly id: string;
    readonly tenantId: string;
    readonly legalName: string;
    readonly tradingName: string;
    readonly registrationNumber: string | null;
    readonly accountOwner: string | null;
    readonly notes: string | null;
    readonly createdAt: string;
    readonly tenantCode: string | null;
    readonly tenantStatus: string | null;
  };
  readonly contacts: readonly {
    readonly id: string;
    readonly role: string;
    readonly name: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly preferredLocale: string;
    readonly isPrimary: boolean;
  }[];
  readonly subscription: {
    readonly id: string;
    readonly state: string;
    readonly packageVersionId: string;
    readonly packageKey: string;
    readonly packageName: string;
    readonly packageNameAr: string;
    readonly version: number;
    readonly priceMinor: number;
    readonly currency: 'USD' | 'LBP';
    readonly entitlements: readonly string[];
    readonly startsAt: string;
    readonly endsAt: string | null;
    readonly revision: number;
  } | null;
  readonly transitionRequests: readonly {
    readonly id: string;
    readonly fromState: string;
    readonly toState: string;
    readonly reason: string;
    readonly requestedBy: string;
    readonly requestedAt: string;
    readonly status: string;
    readonly decidedBy: string | null;
    readonly decisionReason: string | null;
    readonly decidedAt: string | null;
    readonly expectedRevision: number;
  }[];
  readonly transitions: readonly {
    readonly id: string;
    readonly fromState: string;
    readonly toState: string;
    readonly reason: string;
    readonly actor: string;
    readonly approver: string | null;
    readonly occurredAt: string;
  }[];
  readonly invoices: readonly ControlLedgerInvoice[];
  readonly payments: readonly ControlLedgerPayment[];
  readonly outstanding: readonly (ControlMoneyLine & { readonly invoices: number })[];
  readonly summary: {
    readonly deploymentHealth: string | null;
    readonly deploymentStage: string | null;
    readonly deploymentUpdatedAt: string | null;
    readonly supportStatus: string | null;
    readonly openTicketCount: number;
    readonly oldestOpenTicketAt: string | null;
    readonly updatedAt: string;
  } | null;
  readonly supportGrants: readonly {
    readonly id: string;
    readonly ticketId: string;
    readonly requester: string;
    readonly approver: string | null;
    readonly reason: string;
    readonly permissions: readonly string[];
    readonly status: string;
    readonly expiresAt: string;
    readonly revokedAt: string | null;
    readonly createdAt: string;
  }[];
  readonly audit: readonly {
    readonly id: string;
    readonly operation: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly actor: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[];
}
export interface ControlLedgerInvoice {
  readonly id: string;
  readonly tenantId?: string;
  readonly tradingName?: string;
  readonly invoiceNumber: string;
  readonly entryKind: 'posted' | 'reversal';
  readonly reversesInvoiceId: string | null;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly dueAt: string | null;
  readonly postedAt: string;
  readonly reason: string;
  readonly actor?: string;
  readonly reversed: boolean;
  readonly allocatedMinor: number;
}
export interface ControlLedgerPayment {
  readonly id: string;
  readonly tenantId?: string;
  readonly tradingName?: string;
  readonly receiptNumber: string;
  readonly entryKind: 'posted' | 'reversal';
  readonly reversesPaymentId: string | null;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly postedAt: string;
  readonly reason: string;
  readonly actor?: string;
  readonly reversed: boolean;
  readonly allocatedMinor: number;
}
export interface ControlPackageVersion {
  readonly id: string;
  readonly packageKey: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly entitlements: readonly string[];
  readonly priceMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly current: boolean;
  readonly subscriptions: number;
  readonly activeSubscriptions: number;
}
export interface ControlSubscriptionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly tradingName: string;
  readonly legalName: string;
  readonly state: string;
  readonly packageVersionId: string;
  readonly packageKey: string;
  readonly packageName: string;
  readonly packageNameAr: string;
  readonly priceMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly revision: number;
  readonly updatedAt: string;
  readonly pendingRequest: {
    readonly id: string;
    readonly toState: string;
    readonly reason: string;
    readonly requestedBy: string;
    readonly requestedAt: string;
  } | null;
}
export interface ControlBillingLedger {
  readonly asOf: string;
  readonly outstandingByClient: readonly {
    readonly tenantId: string;
    readonly tradingName: string;
    readonly outstanding: readonly (ControlMoneyLine & { readonly invoices: number })[];
  }[];
  readonly invoices: readonly ControlLedgerInvoice[];
  readonly payments: readonly ControlLedgerPayment[];
}
export interface ControlAuditRow {
  readonly id: string;
  readonly operation: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly tenantId: string | null;
  readonly tradingName: string | null;
  readonly actor: string;
  readonly permission: string;
  readonly requestId: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export const readControlPortfolio = (session: ApiSession) =>
  readControlJson<ControlPortfolio>(session, 'portfolio');
export const readControlClientFile = (session: ApiSession, tenantId: string) =>
  readControlJson<ControlClientFile>(session, `clients/${encodeURIComponent(tenantId)}/detail`);
export const readControlPackages = (session: ApiSession) =>
  readControlJson<readonly ControlPackageVersion[]>(session, 'packages');
export const readControlSubscriptions = (session: ApiSession) =>
  readControlJson<readonly ControlSubscriptionRow[]>(session, 'subscriptions');
export const readControlBilling = (session: ApiSession) =>
  readControlJson<ControlBillingLedger>(session, 'billing?limit=200');
export const readControlAudit = (session: ApiSession, before?: string) =>
  readControlJson<readonly ControlAuditRow[]>(
    session,
    before ? `audit?limit=100&before=${encodeURIComponent(before)}` : 'audit?limit=100',
  );
