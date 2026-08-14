import type {
  ProviderActivation,
  ProviderAdapter,
  ProviderHealth,
  ProviderKind,
  ProviderRequestContext,
} from './types.js';

export class ProviderRegistry {
  readonly #providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): void {
    if (this.#providers.has(provider.configuration.providerId)) {
      throw new Error(`Provider ID is already registered: ${provider.configuration.providerId}`);
    }
    this.#providers.set(provider.configuration.providerId, provider);
  }

  get(providerId: string, expectedKind?: ProviderKind): ProviderAdapter {
    const provider = this.#providers.get(providerId);
    if (provider === undefined) throw new Error(`Provider is not registered: ${providerId}`);
    if (expectedKind !== undefined && provider.configuration.kind !== expectedKind) {
      throw new Error(`Provider kind mismatch for ${providerId}.`);
    }
    return provider;
  }

  featureEnabled(providerId: string, feature: string): boolean {
    const provider = this.get(providerId);
    return (
      provider.configuration.enabled && (provider.configuration.featureFlags[feature] ?? false)
    );
  }

  async health(context: ProviderRequestContext): Promise<readonly ProviderHealth[]> {
    return Promise.all([...this.#providers.values()].map((provider) => provider.health(context)));
  }

  activation(): readonly ProviderActivation[] {
    return [...this.#providers.values()].map((provider) => provider.activation());
  }
}
