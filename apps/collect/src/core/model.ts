export type Currency = 'USD' | 'LBP';
export type PaymentMethod = 'cash' | 'omt' | 'whish' | 'bank_transfer';
export type DeviceStatus = 'authorized' | 'revoked' | 'reauth_required';
export type SyncStatus = 'pending' | 'accepted' | 'conflict' | 'rejected';

export interface DeviceRegistration {
  readonly deviceId: string;
  readonly collectorId: string;
  readonly tenantId: string;
  readonly status: DeviceStatus;
  readonly authorizedAt: string;
  readonly cachedAssignmentsExpireAt: string;
  readonly revocationReason?: string;
}

export interface CollectorSession {
  readonly sessionId: string;
  readonly tokenHandle: string;
  readonly deviceId: string;
  readonly collectorId: string;
  readonly tenantId: string;
  readonly assignmentContextVersion: number;
  readonly authenticatedAt: string;
  readonly mfaVerifiedAt: string;
  readonly expiresAt: string;
}

export interface Assignment {
  readonly assignmentId: string;
  readonly assignmentVersion: number;
  readonly routeId: string;
  readonly routeNameEn: string;
  readonly routeNameAr: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly serviceReference: string;
  readonly areaEn: string;
  readonly areaAr: string;
  readonly outstandingMinor: number;
  readonly currency: Currency;
}

export interface PaymentInput {
  readonly assignmentId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly allocationInvoiceId: string;
  readonly note?: string;
  readonly proofReference?: string;
  readonly occurredAtDevice: string;
}

export interface LocalPayment {
  readonly localPaymentId: string;
  readonly operationId: string;
  readonly assignmentId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly allocationInvoiceId: string;
  readonly note?: string;
  readonly proofReference?: string;
  readonly provisionalReceiptNumber: string;
  readonly occurredAtDevice: string;
  readonly clockSkewSuspected: boolean;
  readonly localSequence: number;
  readonly syncStatus: SyncStatus;
  readonly canonicalPaymentId?: string;
  readonly canonicalReceiptNumber?: string;
}

export type OperationType = 'payment.create' | 'reconciliation.submit' | 'receipt.print.audit';

export interface OutboxOperation {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly type: OperationType;
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly collectorId: string;
  readonly assignmentContextVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly dependencies: readonly string[];
  readonly createdLocalSequence: number;
  readonly occurredAtDevice: string;
  readonly status: SyncStatus;
  readonly attemptCount: number;
  readonly canonicalReference?: string;
  readonly failureCode?: string;
}

export interface PrintAttempt {
  readonly attemptId: string;
  readonly operationId: string;
  readonly localPaymentId: string;
  readonly attemptedAt: string;
  readonly outcome: 'printed' | 'failed' | 'disconnected';
  readonly failureCode?: string;
}

export interface ReconciliationLine {
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly expectedMinor: number;
  readonly declaredMinor: number;
  readonly differenceMinor: number;
  readonly denominationCounts?: Readonly<Record<string, number>>;
  readonly handoverReference?: string;
  readonly proofReference?: string;
}

export interface ReconciliationDraft {
  readonly reconciliationId: string;
  readonly businessDate: string;
  readonly lines: readonly ReconciliationLine[];
  readonly note?: string;
  readonly requiresManagerApproval: boolean;
  readonly status: 'draft' | SyncStatus;
  readonly operationId?: string;
}

export interface ConflictRecord {
  readonly operationId: string;
  readonly code: string;
  readonly safeLocalFacts: Readonly<Record<string, unknown>>;
  readonly safeServerFacts: Readonly<Record<string, unknown>>;
  readonly allowedResolutions: readonly ('retain_evidence' | 'supersede_with_new_operation')[];
}

export interface CollectState {
  readonly schemaVersion: 1;
  device?: DeviceRegistration;
  session?: CollectorSession;
  assignments: Assignment[];
  payments: LocalPayment[];
  outbox: OutboxOperation[];
  printAttempts: PrintAttempt[];
  reconciliations: ReconciliationDraft[];
  conflicts: ConflictRecord[];
  nextLocalSequence: number;
  lastServerCheckpoint?: string;
  lockedReason?: 'revoked' | 'session_expired' | 'cache_expired' | 'reauth_required';
}

export function createEmptyState(): CollectState {
  return {
    schemaVersion: 1,
    assignments: [],
    payments: [],
    outbox: [],
    printAttempts: [],
    reconciliations: [],
    conflicts: [],
    nextLocalSequence: 1,
  };
}

export class CollectAccessError extends Error {
  public constructor(
    public readonly code:
      | 'revoked'
      | 'session_expired'
      | 'cache_expired'
      | 'reauth_required'
      | 'scope_denied',
  ) {
    super(code);
    this.name = 'CollectAccessError';
  }
}

export class CollectValidationError extends Error {
  public constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'CollectValidationError';
  }
}

export class CollectConflictError extends Error {
  public constructor(public readonly operationId: string) {
    super(`Operation ${operationId} requires explicit conflict resolution.`);
    this.name = 'CollectConflictError';
  }
}
