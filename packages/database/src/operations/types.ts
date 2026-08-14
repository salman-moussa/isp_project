import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';

export interface SignedOperationsDatabaseContext {
  /** Exact UTF-8 JSON string signed by the trusted API context authority. */
  readonly attestationText: string;
  readonly signatureHex: string;
}

export interface OperationsRepositoryRequest {
  readonly authorization: SignedOperationsDatabaseContext;
}

export interface OperationsScopeSelection {
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}

export interface CreateSubscriberRecord extends OperationsRepositoryRequest {
  readonly subscriberNumber: string;
  readonly displayName: string;
  readonly householdReference: string;
  readonly householdName: string;
  readonly locationLabel: string;
  readonly addressLine: string;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly areaCode?: string;
  readonly primaryPhone?: string;
  readonly idempotencyKey: string;
}

export interface SubscriberRecord {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly subscriberNumber: string;
  readonly displayName: string;
  readonly status: 'lead' | 'active' | 'suspended' | 'closed';
  readonly householdId: string;
  readonly locationId: string;
  readonly idempotencyKey: string;
}

export interface PrepareBillingRunInput
  extends OperationsRepositoryRequest,
    OperationsScopeSelection {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
}

export interface BillingRunResult {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly preparedCount: number;
  readonly idempotencyKey: string;
}

export type NetworkActionPayload =
  | { readonly action: 'activate' | 'restore'; readonly payload: Readonly<Record<string, never>> }
  | { readonly action: 'change_profile'; readonly payload: { readonly profileReference: string } }
  | {
      readonly action: 'suspend' | 'terminate';
      readonly payload: { readonly reasonCode: string };
    };

export interface NetworkActionInput extends OperationsRepositoryRequest {
  readonly serviceId: string;
  readonly action: NetworkActionPayload['action'];
  readonly payload: NetworkActionPayload['payload'];
  readonly idempotencyKey: string;
  readonly requestedBy: string;
}

export interface CollectorReconciliationInput extends OperationsRepositoryRequest {
  readonly collectorUserId: string;
  readonly routeId: string;
  readonly businessDate: string;
  readonly currency: SupportedCurrency;
  readonly previousReconciliationId?: string;
  readonly reason?: string;
  readonly approvedBy?: string;
  readonly idempotencyKey: string;
  readonly reconciledBy: string;
}

export interface ExportJobInput extends OperationsRepositoryRequest, OperationsScopeSelection {
  readonly reportKey: string;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly format: 'csv' | 'xlsx' | 'pdf';
  readonly idempotencyKey: string;
  readonly requestedBy: string;
}

export interface PaymentCorrectionInput extends OperationsRepositoryRequest {
  readonly paymentRequestId: string;
  readonly financeAllocationId?: string;
  readonly previousCorrectionId?: string;
  readonly correctionKind: 'allocation' | 'reversal' | 'note';
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export interface InstallationTransitionInput extends OperationsRepositoryRequest {
  readonly installationId: string;
  readonly toStatus:
    | 'scheduled'
    | 'in_progress'
    | 'blocked'
    | 'ready_for_activation'
    | 'completed'
    | 'cancelled';
  readonly expectedVersion: number;
  readonly note?: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export interface CreateIssueInput extends OperationsRepositoryRequest {
  readonly issueNumber: string;
  readonly subscriberId?: string;
  readonly serviceId?: string;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly subject: string;
  readonly description: string;
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly idempotencyKey: string;
}

export interface IssueTransitionInput extends OperationsRepositoryRequest {
  readonly issueId: string;
  readonly toStatus: 'triaged' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  readonly expectedVersion: number;
  readonly note?: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export interface OfficePaymentRequestInput extends OperationsRepositoryRequest {
  readonly subscriberId: string;
  readonly financePaymentId: string;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly receiptNumber: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
}

export interface PlanVersionInput extends OperationsRepositoryRequest {
  readonly planId?: string;
  readonly branchId?: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly version: number;
  readonly recurringAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly billingIntervalMonths: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
}

export interface BillingPolicyVersionInput extends OperationsRepositoryRequest {
  readonly branchId?: string;
  readonly version: number;
  readonly vatRateBasisPoints: number;
  readonly roundingMode: 'half_up' | 'down' | 'up';
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
}

export interface ServiceInstallationInput extends OperationsRepositoryRequest {
  readonly subscriberId: string;
  readonly locationId: string;
  readonly planId: string;
  readonly serviceNumber: string;
  readonly billingAnchorDay: number;
  readonly branchId: string;
  readonly areaId: string;
  readonly routeId: string;
  readonly scheduledFor?: string;
  readonly installerUserId?: string;
  readonly idempotencyKey: string;
}

export interface CollectorAssignmentInput extends OperationsRepositoryRequest {
  readonly collectorUserId: string;
  readonly subscriberId: string;
  readonly routeId: string;
  readonly financeInvoiceId: string;
  readonly dueOn: string;
  readonly idempotencyKey: string;
}

export interface CollectorEvidenceInput extends OperationsRepositoryRequest {
  readonly assignmentId: string;
  readonly financePaymentId: string;
  readonly recordedBy: string;
  readonly idempotencyKey: string;
}

export interface OperationsConfigurationInput extends OperationsRepositoryRequest {
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly branchId?: string;
  readonly expectedVersion?: number;
  readonly updatedBy: string;
  readonly idempotencyKey: string;
}
