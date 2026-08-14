import {
  ProviderError,
  type ProviderDeadLetterStore,
  type ProviderRequestContext,
} from './types.js';

export interface ProviderRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly failureThreshold: number;
  readonly circuitResetMs: number;
}

export interface ProviderSleeper {
  sleep(delayMs: number): Promise<void>;
}

export class ProviderExecutor {
  #failures = 0;
  #openedAt: number | undefined;

  constructor(
    private readonly providerId: string,
    private readonly policy: ProviderRetryPolicy,
    private readonly deadLetters: ProviderDeadLetterStore,
    private readonly sleeper: ProviderSleeper,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async #beforeDeadline<T>(
    context: ProviderRequestContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const remainingMs = context.deadline.getTime() - this.now().getTime();
    if (remainingMs <= 0) {
      throw new ProviderError('timeout', false, 'Provider request deadline has expired.');
    }
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new ProviderError('timeout', true, 'Provider request timed out.')),
        remainingMs,
      );
    });
    try {
      return await Promise.race([operation(), deadline]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async run<T>(
    context: ProviderRequestContext,
    operation: (attempt: number) => Promise<T>,
  ): Promise<T> {
    const nowMs = this.now().getTime();
    if (this.#openedAt !== undefined && nowMs - this.#openedAt < this.policy.circuitResetMs) {
      throw new ProviderError('unavailable', true, 'Provider circuit is open.');
    }
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      try {
        const result = await this.#beforeDeadline(context, () => operation(attempt));
        this.#failures = 0;
        this.#openedAt = undefined;
        return result;
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError('transport', true, 'Provider request failed safely.');
        this.#failures += 1;
        if (this.#failures >= this.policy.failureThreshold) this.#openedAt = this.now().getTime();
        if (!providerError.retryable || attempt === this.policy.maxAttempts) {
          await this.deadLetters.append({
            providerId: this.providerId,
            requestId: context.requestId,
            idempotencyKey: context.idempotencyKey,
            failureClass: providerError.failureClass,
            attempts: attempt,
            safeMessage: providerError.message,
            createdAt: this.now().toISOString(),
          });
          throw providerError;
        }
        const delay = Math.min(
          this.policy.maxDelayMs,
          this.policy.baseDelayMs * 2 ** (attempt - 1),
        );
        await this.sleeper.sleep(delay);
      }
    }
    throw new ProviderError('unavailable', false, 'Provider attempts exhausted.');
  }
}
