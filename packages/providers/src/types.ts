export type ProviderKind =
  | 'omt'
  | 'whish'
  | 'pos'
  | 'online_payment'
  | 'bank_import'
  | 'maps'
  | 'bluetooth_printer'
  | 'object_storage'
  | 'malware_scanner'
  | 'email'
  | 'otp'
  | 'whatsapp_deep_link'
  | 'dns'
  | 'ssl';

export type ProviderMode = 'disabled' | 'manual' | 'fake' | 'sandbox' | 'live';
export type SecretReference = `secret://${string}`;

export interface ProviderConfiguration {
  readonly providerId: string;
  readonly kind: ProviderKind;
  readonly mode: ProviderMode;
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly secretReferences: Readonly<Record<string, SecretReference>>;
  readonly endpoint?: URL;
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

export interface ProviderRequestContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly deadline: Date;
}

export interface ProviderHealth {
  readonly providerId: string;
  readonly status: 'healthy' | 'degraded' | 'disabled' | 'configuration_required';
  readonly checkedAt: string;
  readonly latencyMs?: number;
  readonly safeMessage: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface ActivationChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly evidenceReference?: string;
}

export interface ProviderActivation {
  readonly providerId: string;
  readonly liveAvailable: boolean;
  readonly liveBlockedReason?: string;
  readonly checklist: readonly ActivationChecklistItem[];
}

export interface ProviderAdapter {
  readonly configuration: ProviderConfiguration;
  health(context: ProviderRequestContext): Promise<ProviderHealth>;
  activation(): ProviderActivation;
}

export type ProviderFailureClass =
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'invalid_request'
  | 'rate_limited'
  | 'timeout'
  | 'transport'
  | 'unavailable'
  | 'replay';

export class ProviderError extends Error {
  constructor(
    readonly failureClass: ProviderFailureClass,
    readonly retryable: boolean,
    safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'ProviderError';
  }
}

export interface DeadLetterRecord {
  readonly providerId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly failureClass: ProviderFailureClass;
  readonly attempts: number;
  readonly safeMessage: string;
  readonly createdAt: string;
}

export interface ProviderDeadLetterStore {
  append(record: DeadLetterRecord): Promise<void>;
  list(providerId: string): Promise<readonly DeadLetterRecord[]>;
}

export class InMemoryProviderDeadLetterStore implements ProviderDeadLetterStore {
  readonly #records: DeadLetterRecord[] = [];
  async append(record: DeadLetterRecord): Promise<void> {
    this.#records.push(structuredClone(record));
  }
  async list(providerId: string): Promise<readonly DeadLetterRecord[]> {
    return this.#records
      .filter((record) => record.providerId === providerId)
      .map((record) => structuredClone(record));
  }
}
