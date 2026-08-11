export interface BackoffOptions {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly jitterRatio: number;
}

export function calculateBackoffDelay(
  consecutiveFailures: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new RangeError('Consecutive failures must be a positive integer.');
  }
  if (
    !Number.isFinite(options.baseDelayMs) ||
    options.baseDelayMs <= 0 ||
    !Number.isFinite(options.maximumDelayMs) ||
    options.maximumDelayMs < options.baseDelayMs ||
    !Number.isFinite(options.jitterRatio) ||
    options.jitterRatio < 0 ||
    options.jitterRatio > 1
  ) {
    throw new RangeError('Backoff options are invalid.');
  }

  const exponent = Math.min(consecutiveFailures - 1, 30);
  const uncapped = options.baseDelayMs * 2 ** exponent;
  const capped = Math.min(options.maximumDelayMs, uncapped);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new RangeError('Backoff random source must return a number from zero through one.');
  }
  const factor = 1 - options.jitterRatio + 2 * options.jitterRatio * sample;
  return Math.min(options.maximumDelayMs, Math.max(0, Math.round(capped * factor)));
}

export async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || delayMs <= 0) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, delayMs);
    signal.addEventListener('abort', done, { once: true });

    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
