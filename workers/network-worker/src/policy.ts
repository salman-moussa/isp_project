export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
});

export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const multiplier = 1 - policy.jitterRatio + 2 * policy.jitterRatio * boundedRandom;
  return Math.round(base * multiplier);
}

export interface CircuitPolicy {
  readonly failureThreshold: number;
  readonly resetAfterMs: number;
}

interface CircuitState {
  failures: number;
  openedAt?: number;
  halfOpenProbeInFlight: boolean;
}

export class RouterCircuitBreaker {
  readonly #states = new Map<string, CircuitState>();

  constructor(private readonly policy: CircuitPolicy) {}

  tryAcquire(routerId: string, nowMs: number): boolean {
    const state = this.#states.get(routerId);
    if (state?.openedAt === undefined) return true;
    if (nowMs - state.openedAt < this.policy.resetAfterMs) return false;
    if (state.halfOpenProbeInFlight) return false;
    state.halfOpenProbeInFlight = true;
    return true;
  }

  recordSuccess(routerId: string): void {
    this.#states.delete(routerId);
  }

  recordFailure(routerId: string, nowMs: number): void {
    const state = this.#states.get(routerId) ?? { failures: 0, halfOpenProbeInFlight: false };
    state.failures += 1;
    state.halfOpenProbeInFlight = false;
    if (state.failures >= this.policy.failureThreshold) state.openedAt = nowMs;
    this.#states.set(routerId, state);
  }

  state(routerId: string, nowMs: number): 'closed' | 'open' | 'half_open' {
    const state = this.#states.get(routerId);
    if (state?.openedAt === undefined) return 'closed';
    return nowMs - state.openedAt < this.policy.resetAfterMs ? 'open' : 'half_open';
  }
}

export class RouterConcurrencyLimiter {
  readonly #active = new Map<string, number>();

  constructor(private readonly limitPerRouter: number) {
    if (!Number.isInteger(limitPerRouter) || limitPerRouter < 1) {
      throw new Error('Per-router concurrency must be a positive integer.');
    }
  }

  tryAcquire(routerId: string): (() => void) | undefined {
    const active = this.#active.get(routerId) ?? 0;
    if (active >= this.limitPerRouter) return undefined;
    this.#active.set(routerId, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#active.get(routerId) ?? 1;
      if (current <= 1) this.#active.delete(routerId);
      else this.#active.set(routerId, current - 1);
    };
  }

  active(routerId: string): number {
    return this.#active.get(routerId) ?? 0;
  }
}
