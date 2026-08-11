import { describe, expect, it, vi } from 'vitest';
import { calculateBackoffDelay, waitForDelay } from './backoff.js';

describe('finance audit relay backoff', () => {
  it('grows exponentially, applies deterministic jitter, and never exceeds the cap', () => {
    const options = { baseDelayMs: 100, maximumDelayMs: 1_000, jitterRatio: 0.2 };
    expect(calculateBackoffDelay(1, options, () => 0)).toBe(80);
    expect(calculateBackoffDelay(2, options, () => 0.5)).toBe(200);
    expect(calculateBackoffDelay(20, options, () => 1)).toBe(1_000);
  });

  it('interrupts a pending delay when shutdown is requested', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForDelay(60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
