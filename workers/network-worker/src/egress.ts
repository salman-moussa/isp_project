import type { RouterRegistration } from './domain.js';

export class RouterEgressPolicy {
  readonly #allowedEndpoints: ReadonlySet<string>;

  constructor(allowedEndpoints: readonly string[]) {
    this.#allowedEndpoints = new Set(allowedEndpoints.map((endpoint) => new URL(endpoint).origin));
  }

  assertAllowed(router: RouterRegistration): void {
    if (!this.#allowedEndpoints.has(router.endpoint.origin)) {
      throw new Error(
        `Router endpoint is outside the configured egress allowlist: ${router.routerId}`,
      );
    }
    if (router.connector !== 'simulator' && router.endpoint.protocol !== 'https:') {
      throw new Error(`Router endpoint requires TLS: ${router.routerId}`);
    }
  }
}
