import type {
  ActivationChecklistItem,
  ProviderActivation,
  ProviderAdapter,
  ProviderConfiguration,
  ProviderHealth,
} from './types.js';

export abstract class BaseFakeProvider implements ProviderAdapter {
  constructor(
    readonly configuration: ProviderConfiguration,
    private readonly checklist: readonly ActivationChecklistItem[] = [],
    private readonly liveBlockedReason?: string,
  ) {}

  async health(): Promise<ProviderHealth> {
    if (!this.configuration.enabled || this.configuration.mode === 'disabled') {
      return this.healthRecord('disabled', 'Provider is disabled.');
    }
    if (this.configuration.mode === 'live' && this.liveBlockedReason !== undefined) {
      return this.healthRecord('configuration_required', this.liveBlockedReason);
    }
    return this.healthRecord('healthy', `${this.configuration.mode} provider is ready.`);
  }

  activation(): ProviderActivation {
    const liveAvailable =
      this.liveBlockedReason === undefined &&
      this.checklist.filter((item) => item.required).every((item) => item.satisfied);
    return {
      providerId: this.configuration.providerId,
      liveAvailable,
      ...(this.liveBlockedReason === undefined
        ? {}
        : { liveBlockedReason: this.liveBlockedReason }),
      checklist: this.checklist,
    };
  }

  healthRecord(status: ProviderHealth['status'], safeMessage: string): ProviderHealth {
    return {
      providerId: this.configuration.providerId,
      status,
      checkedAt: '2026-08-13T08:00:00.000Z',
      safeMessage,
      metrics: { requests: 0, failures: 0, rateLimited: 0 },
    };
  }

  protected assertOperational(): void {
    if (!this.configuration.enabled || this.configuration.mode === 'disabled') {
      throw new Error('Provider is disabled.');
    }
  }
}
