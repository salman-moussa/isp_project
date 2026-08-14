import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import type { SignedOperationsDatabaseContext } from '../operations/types.js';

export type CollectDeviceScope =
  | 'assignments:read'
  | 'payments:create'
  | 'reconciliations:submit'
  | 'receipts:print:audit';

export interface CollectDeviceIdentity {
  readonly deviceId: string;
  readonly tenantId: VerifiedTenantId;
  readonly collectorUserId: string;
  readonly sessionId: string;
  readonly scopes: readonly CollectDeviceScope[];
  readonly accessExpiresAt: string;
}

export interface CollectTokenDigests {
  /** SHA-256 digest bytes. Raw access and refresh tokens never cross the repository boundary. */
  readonly accessTokenDigest: Uint8Array;
  readonly refreshTokenDigest: Uint8Array;
}

export interface AuthorizeCollectDeviceInput extends CollectTokenDigests {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly collectorUserId: string;
  readonly sourceSessionId: string;
  readonly deviceLabel: string;
  readonly devicePublicKeyThumbprint: string;
  readonly mfaVerifiedAt: Date;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly scopes: readonly CollectDeviceScope[];
}

export interface RotateCollectTokensInput extends CollectTokenDigests {
  readonly presentedRefreshTokenDigest: Uint8Array;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export interface CollectAssignment {
  readonly assignmentId: string;
  readonly subscriberId: string;
  readonly subscriberNumber: string;
  readonly subscriberDisplayName: string;
  readonly addressLine: string;
  readonly routeId: string;
  readonly routeReference: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly dueOn: string;
  readonly outstandingAmountMinor: number;
  readonly currency: SupportedCurrency;
  readonly status: 'assigned' | 'visited' | 'collected' | 'returned';
}

export type CollectSyncOperation =
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'payment.create';
      readonly payload: {
        readonly assignmentId: string;
        readonly amountMinor: number;
        readonly currency: SupportedCurrency;
        readonly clientRecordedAt: string;
      };
    }
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'reconciliation.submit';
      readonly payload: {
        readonly routeId: string;
        readonly businessDate: string;
        readonly declaredAmountMinor: number;
        readonly currency: SupportedCurrency;
      };
    }
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'receipt.print.audit';
      readonly payload: {
        readonly assignmentId: string;
        readonly paymentId: string;
        readonly printerReference: string;
        readonly copyKind: 'original' | 'duplicate';
      };
    };

export interface CollectSyncEnvelope {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly device: CollectDeviceIdentity;
  readonly operations: readonly CollectSyncOperation[];
  readonly payloadHashes: Readonly<Record<string, string>>;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly serverReceivedAt: Date;
}

export interface CollectSyncResult {
  readonly operationId: string;
  readonly sequence: number;
  readonly type: CollectSyncOperation['type'];
  readonly replayed: boolean;
  readonly serverRecordedAt: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export interface ApproveCollectDiscrepancyInput {
  readonly authorization: SignedOperationsDatabaseContext;
  readonly reconciliationId: string;
  readonly approverUserId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}
