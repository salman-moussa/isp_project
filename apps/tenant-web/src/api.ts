import type {
  CustomerAccountsWorkspace,
  ChartOfAccountRecord,
  JournalEntryRecord,
  TrialBalanceResponse,
  AccountingPeriodRecord,
} from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

export interface TenantSummary {
  readonly tenantId: string;
  readonly asOf: string;
  readonly activeSubscribers: number;
  readonly onlineSubscribers: number;
  readonly collections: { readonly USD: number; readonly LBP: number };
}

export interface BillingWorkspaceData {
  readonly runs: readonly BillingWorkspaceRun[];
  readonly dunningPolicies: readonly BillingDunningPolicy[];
  readonly dunningCases: readonly BillingDunningCase[];
  readonly documentStorageConfigured: boolean;
  readonly documentInvoices: readonly { readonly id: string; readonly documentNumber: string }[];
  readonly invoiceDocuments: readonly InvoiceDocumentArchive[];
}

export interface InvoiceDocumentArchive {
  readonly id: string;
  readonly invoiceId: string;
  readonly documentNumber: string;
  readonly status: 'pending' | 'ready';
  readonly rendererVersion: string;
  readonly retentionUntil: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
}

export interface BillingWorkspaceRunItem {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly status: 'prepared' | 'failed' | 'skipped';
  readonly failureCode?: string;
  readonly explanationEn: string;
  readonly explanationAr: string;
  readonly attemptNumber: number;
}

export interface BillingWorkspaceRun {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly retryOfRunId?: string;
  readonly preparedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly requestedAt: string;
  readonly completedAt?: string;
  readonly items: readonly BillingWorkspaceRunItem[];
}

export interface BillingDunningPolicy {
  readonly id: string;
  readonly branchId?: string;
  readonly version: number;
  readonly paymentTermsDays: number;
  readonly reminderAfterDays: number;
  readonly finalNoticeAfterDays: number;
  readonly suspensionReviewAfterDays: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface BillingDunningCase {
  readonly id: string;
  readonly documentNumber: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly currentStage: 'reminder' | 'final_notice' | 'suspension_review' | 'resolved';
  readonly status: 'open' | 'resolved';
  readonly dueOn: string;
  readonly outstandingMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly version: number;
  readonly events: readonly {
    readonly id: string;
    readonly fromStage?: string;
    readonly toStage: 'reminder' | 'final_notice' | 'suspension_review' | 'resolved';
    readonly daysOverdue: number;
    readonly outstandingMinor: number;
    readonly explanationEn: string;
    readonly explanationAr: string;
    readonly occurredAt: string;
  }[];
}

export interface SubscriberWorkspaceData {
  readonly subscribers: readonly SubscriberWorkspaceSubscriber[];
  readonly services: readonly SubscriberWorkspaceService[];
  readonly invoices: readonly SubscriberWorkspaceInvoice[];
  readonly issues: readonly SubscriberWorkspaceIssue[];
  readonly plans: readonly SubscriberWorkspacePlan[];
  readonly serviceChanges: readonly SubscriberWorkspaceServiceChange[];
  readonly addons: readonly SubscriberWorkspaceAddon[];
  readonly addonPurchases: readonly SubscriberWorkspaceAddonPurchase[];
  readonly usageBalances: readonly SubscriberWorkspaceUsageBalance[];
}
export interface SubscriberWorkspaceSubscriber {
  readonly id: string;
  readonly subscriberNumber: string;
  readonly displayName: string;
  readonly status: 'lead' | 'active' | 'suspended' | 'closed';
  readonly householdReference: string;
  readonly householdName: string;
  readonly locationId: string;
  readonly locationLabel: string;
  readonly addressLine: string;
  readonly branchCode: string;
  readonly areaCode: string;
  readonly routeCode: string;
  readonly createdAt: string;
  readonly contacts: readonly {
    readonly kind: 'phone' | 'email' | 'whatsapp' | 'other';
    readonly value: string;
    readonly label?: string;
    readonly primary: boolean;
  }[];
}
export interface SubscriberWorkspaceService {
  readonly id: string;
  readonly subscriberId: string;
  readonly serviceNumber: string;
  readonly status: 'draft' | 'pending_installation' | 'active' | 'suspended' | 'terminated';
  readonly planId: string;
  readonly planCode: string;
  readonly planNameEn: string;
  readonly planNameAr: string;
  readonly recurringAmountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly billingAnchorDay: number;
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly billingMode: 'prepaid' | 'postpaid';
  readonly fupMode: 'none' | 'throttle' | 'cap' | 'bill';
  readonly installationStatus?: string;
  readonly activatedAt?: string;
  readonly terminatedAt?: string;
}
export interface SubscriberWorkspaceInvoice {
  readonly id: string;
  readonly subscriberId: string;
  readonly serviceId: string;
  readonly documentNumber: string;
  readonly amountMinor: number;
  readonly allocatedMinor: number;
  readonly creditedMinor?: number;
  readonly reversed?: boolean;
  readonly outstandingMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly postedAt: string;
  readonly baseAmountMinor: number;
  readonly addonAmountMinor: number;
  readonly overageAmountMinor: number;
  readonly grossAmountMinor: number;
  readonly discountBasisPoints: number;
  readonly discountAmountMinor: number;
  readonly taxableAmountMinor: number;
  readonly vatRateBasisPoints: number;
  readonly vatAmountMinor: number;
  readonly stampDutyMinor: number;
  readonly legalInvoice?: {
    readonly version: number;
    readonly retentionYears: number;
    readonly supplier: {
      readonly nameEn: string;
      readonly nameAr: string;
      readonly addressEn: string;
      readonly addressAr: string;
      readonly taxRegistrationNumber: string;
    };
    readonly recipient: { readonly name: string; readonly address: string };
    readonly invoice: {
      readonly serialNumber: string;
      readonly issuedAt: string;
      readonly currency: 'USD' | 'LBP';
    };
    readonly service: {
      readonly number: string;
      readonly descriptionEn: string;
      readonly descriptionAr: string;
      readonly periodStart: string;
      readonly periodEnd: string;
    };
    readonly amounts: Readonly<Record<string, number>>;
    readonly tax: { readonly rateBasisPoints: number; readonly amountMinor: number };
  };
}
export interface SubscriberWorkspaceIssue {
  readonly id: string;
  readonly subscriberId?: string;
  readonly serviceId?: string;
  readonly issueNumber: string;
  readonly subject: string;
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly status: 'open' | 'triaged' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  readonly updatedAt: string;
}
export interface SubscriberWorkspacePlan {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly recurringAmountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly billingMode: 'prepaid' | 'postpaid';
  readonly fupMode: 'none' | 'throttle' | 'cap' | 'bill';
}
export interface SubscriberWorkspaceServiceChange {
  readonly id: string;
  readonly serviceId: string;
  readonly action: 'plan_change' | 'suspend' | 'restore' | 'terminate';
  readonly fromStatus: SubscriberWorkspaceService['status'];
  readonly toStatus: SubscriberWorkspaceService['status'];
  readonly fromPlanId: string;
  readonly toPlanId: string;
  readonly reason: string;
  readonly effectiveAt: string;
}
export interface SubscriberWorkspaceAddon {
  readonly id: string;
  readonly branchId?: string;
  readonly code: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: 'recurring' | 'one_time' | 'quota_topup';
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly quotaGb?: number;
}
export interface SubscriberWorkspaceAddonPurchase {
  readonly id: string;
  readonly serviceId: string;
  readonly addonVersionId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: SubscriberWorkspaceAddon['kind'];
  readonly quantity: number;
  readonly totalAmountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly totalQuotaGb?: number;
  readonly appliesFrom: string;
  readonly appliesTo: string;
  readonly purchasedAt: string;
}
export interface SubscriberWorkspaceUsageBalance {
  readonly serviceId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseQuotaGb?: number;
  readonly topupQuotaGb: number;
  readonly usedBytes: number;
  readonly remainingBytes?: number;
  readonly excessBytes: number;
  readonly overageGb: number;
  readonly projectedOverageMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly fupMode: SubscriberWorkspaceService['fupMode'];
}

export interface SalesLead {
  readonly id: string;
  readonly leadNumber: string;
  readonly partyKind: 'person' | 'business';
  readonly displayName: string;
  readonly source: string;
  readonly primaryPhone?: string;
  readonly primaryEmail?: string;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly addressLine: string;
  readonly needsSummary: string;
  readonly status: 'new' | 'qualifying' | 'qualified' | 'disqualified' | 'quoted' | 'won' | 'lost';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SalesOfferVersion {
  readonly id: string;
  readonly offerId: string;
  readonly branchId?: string;
  readonly code: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly accessTechnology: string;
  readonly downstreamMbps: number;
  readonly upstreamMbps: number;
  readonly quotaGb?: number;
  readonly recurringAmountMinor: number;
  readonly activationFeeMinor: number;
  readonly equipmentFeeMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly commitmentMonths: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly published: boolean;
}

export interface SalesQualification {
  readonly id: string;
  readonly leadId: string;
  readonly version: number;
  readonly result: 'eligible' | 'ineligible' | 'survey_required' | 'reserved';
  readonly accessTechnology: string;
  readonly coverageSource: string;
  readonly reasonCodes: readonly string[];
  readonly capacityReference?: string;
  readonly reservationExpiresAt?: string;
  readonly createdAt: string;
}

export interface SalesQuote {
  readonly id: string;
  readonly leadId: string;
  readonly offerVersionId: string;
  readonly quoteNumber: string;
  readonly version: number;
  readonly status: 'pending_approval' | 'issued' | 'approved' | 'rejected' | 'accepted' | 'expired';
  readonly recurringAmountMinor: number;
  readonly activationFeeMinor: number;
  readonly equipmentFeeMinor: number;
  readonly discountBasisPoints: number;
  readonly currency: 'USD' | 'LBP';
  readonly commitmentMonths: number;
  readonly validUntil: string;
  readonly createdAt: string;
}

export interface SalesServiceOrder {
  readonly id: string;
  readonly leadId: string;
  readonly quoteId: string;
  readonly orderNumber: string;
  readonly status:
    | 'accepted'
    | 'validating'
    | 'in_progress'
    | 'on_hold'
    | 'fallout'
    | 'completed'
    | 'cancelled';
  readonly subscriberId?: string;
  readonly firstInvoiceId?: string;
  readonly firstInvoicePeriodStart?: string;
  readonly firstInvoicePeriodEnd?: string;
  readonly createdAt: string;
  readonly tasks: readonly {
    readonly key: string;
    readonly type: string;
    readonly dependsOn: readonly string[];
    readonly status: string;
    readonly attempts: number;
    readonly lastError?: string;
    readonly result?: Readonly<Record<string, unknown>>;
  }[];
}

export interface CapacityResource {
  readonly id: string;
  readonly type:
    | 'pop'
    | 'sector'
    | 'olt'
    | 'fiber_port'
    | 'wireless_sector'
    | 'access_node'
    | 'capacity_pool';
  readonly code: string;
  readonly name: string;
  readonly accessTechnology: string;
  readonly totalUnits: number;
  readonly reservedUnits: number;
  readonly availableUnits: number;
  readonly branchId: string;
  readonly areaId?: string;
  readonly routeId?: string;
  readonly status: 'active' | 'maintenance' | 'retired';
}

export interface SalesPlan {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly networkProfileReference?: string;
  readonly recurringAmountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly branchId?: string;
}

export interface SalesBillingPolicy {
  readonly taxTreatment: 'taxable' | 'exempt' | 'out_of_scope';
  readonly taxReasonEn?: string;
  readonly taxReasonAr?: string;
  readonly taxAuthorityReference?: string;
  readonly id: string;
  readonly branchId?: string;
  readonly version: number;
  readonly vatRateBasisPoints: number;
  readonly roundingMode: 'half_up' | 'down' | 'up';
  readonly supplierNameEn?: string;
  readonly supplierNameAr?: string;
  readonly supplierAddressEn?: string;
  readonly supplierAddressAr?: string;
  readonly supplierTaxRegistrationNumber?: string;
  readonly stampDutyUsdMinor: number;
  readonly stampDutyLbpMinor: number;
  readonly retentionYears?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface SalesInstallation {
  readonly id: string;
  readonly orderId: string;
  readonly serviceId: string;
  readonly status:
    | 'requested'
    | 'scheduled'
    | 'in_progress'
    | 'blocked'
    | 'ready_for_activation'
    | 'completed'
    | 'cancelled';
  readonly version: number;
  readonly scheduledFor?: string;
  readonly installerUserId?: string;
  readonly blockerReason?: string;
  readonly serviceActivatedAt?: string;
}

export interface SalesWorkspaceData {
  readonly leads: readonly SalesLead[];
  readonly offers: readonly SalesOfferVersion[];
  readonly qualifications: readonly SalesQualification[];
  readonly quotes: readonly SalesQuote[];
  readonly orders: readonly SalesServiceOrder[];
  readonly resources: readonly CapacityResource[];
  readonly plans: readonly SalesPlan[];
  readonly billingPolicies: readonly SalesBillingPolicy[];
  readonly installations: readonly SalesInstallation[];
  readonly scopes: TenantScopeCatalogue;
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

export async function readSalesWorkspace(session: ApiSession): Promise<SalesWorkspaceData> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/sales/workspace`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Sales workspace');
  return (await response.json()) as SalesWorkspaceData;
}

export async function readBillingWorkspace(session: ApiSession): Promise<BillingWorkspaceData> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/billing/workspace`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Billing workspace');
  return (await response.json()) as BillingWorkspaceData;
}

export async function submitBillingOperation(
  session: ApiSession,
  path: 'billing-runs' | 'dunning-policy-versions' | 'dunning-evaluations' | 'invoice-documents',
  payload: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  return submitTenantOperation(session, path, payload, crypto.randomUUID());
}

export async function downloadInvoiceDocument(
  session: ApiSession,
  artifactId: string,
): Promise<Blob> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/invoice-documents/${encodeURIComponent(artifactId)}/pdf`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Invoice document');
  return response.blob();
}

export async function readSubscriberWorkspace(
  session: ApiSession,
): Promise<SubscriberWorkspaceData> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/subscribers/workspace`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Subscriber workspace');
  return (await response.json()) as SubscriberWorkspaceData;
}

export async function applyServiceChange(
  session: ApiSession,
  input:
    | {
        readonly serviceId: string;
        readonly action: 'plan_change';
        readonly targetPlanId: string;
        readonly reason: string;
      }
    | {
        readonly serviceId: string;
        readonly action: 'suspend' | 'restore' | 'terminate';
        readonly reason: string;
      },
): Promise<void> {
  await submitTenantOperation(session, 'services/change-orders', input, crypto.randomUUID());
}

export async function purchaseServiceAddon(
  session: ApiSession,
  input: {
    readonly serviceId: string;
    readonly addonVersionId: string;
    readonly quantity: number;
    readonly appliesFrom: string;
    readonly appliesTo: string;
    readonly reason: string;
  },
): Promise<void> {
  await submitTenantOperation(session, 'services/addons', input, crypto.randomUUID());
}

export async function recordServiceUsage(
  session: ApiSession,
  input: {
    readonly serviceId: string;
    readonly source: string;
    readonly eventReference: string;
    readonly occurredAt: string;
    readonly downloadBytes: number;
    readonly uploadBytes: number;
    readonly reason: string;
  },
): Promise<void> {
  await submitTenantOperation(session, 'usage-events', input, crypto.randomUUID());
}

export async function submitSalesOperation(
  session: ApiSession,
  path: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  await submitTenantOperation(session, `sales/${path}`, payload, crypto.randomUUID());
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
export async function readCustomerAccounts(
  session: ApiSession,
): Promise<CustomerAccountsWorkspace> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/operations/customer-accounts/workspace`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Customer accounts');
  return (await response.json()) as CustomerAccountsWorkspace;
}

export async function readChartOfAccounts(
  session: ApiSession,
): Promise<readonly ChartOfAccountRecord[]> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/accounting/chart-of-accounts`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Chart of accounts');
  return (await response.json()) as readonly ChartOfAccountRecord[];
}

export async function readJournalEntries(
  session: ApiSession,
): Promise<readonly JournalEntryRecord[]> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/accounting/journal-entries`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Journal entries');
  return (await response.json()) as readonly JournalEntryRecord[];
}

export async function readTrialBalance(
  session: ApiSession,
  asOfDate?: string,
): Promise<TrialBalanceResponse> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const url = `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/accounting/trial-balance${asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : ''}`;
  const response = await fetch(url, { headers: authorizationHeaders(session) });
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Trial balance');
  return (await response.json()) as TrialBalanceResponse;
}

export async function readAccountingPeriods(
  session: ApiSession,
): Promise<readonly AccountingPeriodRecord[]> {
  if (!session.tenantId) throw new Error('The authenticated tenant workspace is missing.');
  const response = await fetch(
    `${session.apiBaseUrl}/v1/tenants/${encodeURIComponent(session.tenantId)}/accounting/periods`,
    { headers: authorizationHeaders(session) },
  );
  if (response.status === 401) session.logout();
  if (!response.ok) throw await staffError(response, 'Accounting periods');
  return (await response.json()) as readonly AccountingPeriodRecord[];
}
