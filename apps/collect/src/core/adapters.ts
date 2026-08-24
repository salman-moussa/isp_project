import type { OutboxOperation } from './model';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface PayloadHasher {
  hash(payload: Readonly<Record<string, unknown>>): Promise<string>;
}

export interface PrintReceiptRequest {
  readonly provisionalReceiptNumber: string;
  readonly canonicalReceiptNumber?: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly subscriberName: string;
}

export interface ReceiptPrinter {
  print(
    request: PrintReceiptRequest,
  ): Promise<{ outcome: 'printed' } | { outcome: 'failed' | 'disconnected'; code: string }>;
}

export type SyncOutcome =
  | {
      readonly operationId: string;
      readonly status: 'accepted';
      readonly canonicalReference: string;
      readonly canonicalReceiptNumber?: string;
      readonly recordedAtServer: string;
    }
  | {
      readonly operationId: string;
      readonly status: 'conflict';
      readonly code: string;
      readonly safeServerFacts: Readonly<Record<string, unknown>>;
    }
  | { readonly operationId: string; readonly status: 'rejected'; readonly code: string }
  | { readonly operationId: string; readonly status: 'retryable'; readonly code: string };

export interface SyncResponse {
  readonly checkpoint: string;
  readonly deviceStatus: 'authorized' | 'revoked' | 'reauth_required';
  readonly outcomes: readonly SyncOutcome[];
}

export interface CollectSyncEndpoint {
  push(request: {
    readonly deviceId: string;
    readonly sessionId: string;
    readonly operations: readonly OutboxOperation[];
  }): Promise<SyncResponse>;
}
