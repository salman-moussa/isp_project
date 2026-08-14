import type { OtpAdapter, RecoveryDeliveryAdapter } from './auth-service.js';

export class RemoteAuthDeliveryAdapter implements OtpAdapter, RecoveryDeliveryAdapter {
  public constructor(
    private readonly baseUrl: URL,
    private readonly bearerToken: string,
  ) {
    if (baseUrl.protocol !== 'https:') {
      throw new Error('Production authentication delivery requires HTTPS.');
    }
    if (bearerToken.length < 32) throw new Error('Authentication delivery token is too short.');
  }

  public async start(input: { userId: string; challengeId: string; expiresAt: Date }) {
    const result = await this.post('/v1/otp/challenges', {
      userId: input.userId,
      challengeId: input.challengeId,
      expiresAt: input.expiresAt.toISOString(),
    });
    if (typeof result.adapterReference !== 'string' || result.adapterReference.length < 1) {
      throw new Error('Authentication delivery returned an invalid challenge reference.');
    }
    return { adapterReference: result.adapterReference };
  }

  public async verify(input: { adapterReference: string; code: string }): Promise<boolean> {
    const result = await this.post('/v1/otp/verify', input);
    return result.valid === true;
  }

  public async deliver(input: { userId: string; email: string; token: string; expiresAt: Date }) {
    await this.post('/v1/recovery/messages', {
      userId: input.userId,
      email: input.email,
      token: input.token,
      expiresAt: input.expiresAt.toISOString(),
    });
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('Authentication delivery provider is unavailable.');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Authentication delivery returned an invalid response.');
    }
    return value as Record<string, unknown>;
  }
}

/** Explicit local-only adapter. It is never selected when NODE_ENV=production. */
export class DevelopmentAuthDeliveryAdapter implements OtpAdapter, RecoveryDeliveryAdapter {
  readonly #challenges = new Map<string, string>();

  public async start(input: { challengeId: string }) {
    this.#challenges.set(input.challengeId, '000000');
    return { adapterReference: input.challengeId };
  }

  public async verify(input: { adapterReference: string; code: string }): Promise<boolean> {
    const valid = this.#challenges.get(input.adapterReference) === input.code;
    if (valid) this.#challenges.delete(input.adapterReference);
    return valid;
  }

  public async deliver(): Promise<void> {
    // Local recovery delivery is intentionally inert; tests inject their own capturing adapter.
  }
}
