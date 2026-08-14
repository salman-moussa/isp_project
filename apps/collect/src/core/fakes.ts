import type {
  Clock,
  CollectSyncEndpoint,
  IdGenerator,
  PayloadHasher,
  PrintReceiptRequest,
  ReceiptPrinter,
  SyncResponse,
} from './adapters.js';
import type { OutboxOperation } from './model.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export class FakeClock implements Clock {
  public constructor(public value = new Date('2026-08-13T09:00:00.000Z')) {}
  public now(): Date {
    return new Date(this.value);
  }
}

export class SequenceIds implements IdGenerator {
  private sequence = 0;
  public next(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
  }
}

export class StableTestHasher implements PayloadHasher {
  public async hash(payload: Readonly<Record<string, unknown>>): Promise<string> {
    const text = JSON.stringify(stableValue(payload));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `test-fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
}

export class FakePrinter implements ReceiptPrinter {
  public requests: PrintReceiptRequest[] = [];
  public nextOutcome: 'printed' | 'failed' | 'disconnected' = 'printed';
  public async print(
    request: PrintReceiptRequest,
  ): Promise<{ outcome: 'printed' } | { outcome: 'failed' | 'disconnected'; code: string }> {
    this.requests.push(request);
    return this.nextOutcome === 'printed'
      ? { outcome: 'printed' }
      : { outcome: this.nextOutcome, code: `printer_${this.nextOutcome}` };
  }
}

export class FakeSyncEndpoint implements CollectSyncEndpoint {
  public online = true;
  public deviceStatus: 'authorized' | 'revoked' | 'reauth_required' = 'authorized';
  public conflictOperationIds = new Set<string>();
  public rejectedOperationIds = new Set<string>();
  public retryableOperationIds = new Set<string>();
  public received: OutboxOperation[] = [];
  private readonly accepted = new Map<
    string,
    { payloadHash: string; canonicalReference: string }
  >();

  public async push(request: {
    deviceId: string;
    sessionId: string;
    operations: readonly OutboxOperation[];
  }): Promise<SyncResponse> {
    if (!this.online) throw new Error('offline');
    if (this.deviceStatus !== 'authorized') {
      return {
        checkpoint: `checkpoint-${this.received.length}`,
        deviceStatus: this.deviceStatus,
        outcomes: [],
      };
    }
    const outcomes: SyncResponse['outcomes'][number][] = [];
    for (const operation of request.operations) {
      this.received.push(operation);
      const prior = this.accepted.get(operation.operationId);
      if (prior !== undefined && prior.payloadHash !== operation.payloadHash) {
        outcomes.push({
          operationId: operation.operationId,
          status: 'conflict',
          code: 'idempotency_payload_mismatch',
          safeServerFacts: { canonicalReference: prior.canonicalReference },
        });
      } else if (this.conflictOperationIds.has(operation.operationId)) {
        outcomes.push({
          operationId: operation.operationId,
          status: 'conflict',
          code: 'assignment_changed',
          safeServerFacts: { assignmentState: 'reassigned' },
        });
      } else if (this.rejectedOperationIds.has(operation.operationId)) {
        outcomes.push({
          operationId: operation.operationId,
          status: 'rejected',
          code: 'authorization_denied',
        });
      } else if (this.retryableOperationIds.has(operation.operationId)) {
        outcomes.push({
          operationId: operation.operationId,
          status: 'retryable',
          code: 'temporarily_unavailable',
        });
      } else {
        const accepted = prior ?? {
          payloadHash: operation.payloadHash,
          canonicalReference: `canonical-${operation.operationId}`,
        };
        this.accepted.set(operation.operationId, accepted);
        outcomes.push({
          operationId: operation.operationId,
          status: 'accepted',
          canonicalReference: accepted.canonicalReference,
          ...(operation.type === 'payment.create'
            ? { canonicalReceiptNumber: `R-${operation.operationId.slice(-8)}` }
            : {}),
          recordedAtServer: '2026-08-13T09:05:00.000Z',
        });
      }
    }
    return {
      checkpoint: `checkpoint-${this.received.length}`,
      deviceStatus: 'authorized',
      outcomes,
    };
  }
}
