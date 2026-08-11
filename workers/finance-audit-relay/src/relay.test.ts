import { describe, expect, it, vi } from 'vitest';
import type { VerifiedTenantId } from '@isp/contracts';
import { RelayHealth } from './health.js';
import type { RelayLogger } from './logger.js';
import { FinanceAuditRelay } from './relay.js';

const tenantId = '00000000-0000-4000-8000-000000000001' as VerifiedTenantId;
const writeLog = vi.fn<RelayLogger['write']>();
const silentLogger: RelayLogger = { write: (...arguments_) => writeLog(...arguments_) };

describe('finance audit relay loop', () => {
  it('recovers after a failed tenant batch without blocking a later retry', async () => {
    let timeMs = Date.parse('2026-08-11T12:00:00.000Z');
    let attempts = 0;
    const controller = new AbortController();
    const health = new RelayHealth([tenantId], 60_000, 500, 120_000, new Date(timeMs));
    const relay = new FinanceAuditRelay(
      {
        batchSize: 100,
        pollIntervalMs: 1_000,
        backoff: { baseDelayMs: 100, maximumDelayMs: 1_000, jitterRatio: 0 },
      },
      {
        health,
        logger: silentLogger,
        probeControl: vi.fn().mockResolvedValue(undefined),
        discoverTargets: async () => [
          {
            tenantId,
            probe: vi.fn().mockResolvedValue(undefined),
            async drain() {
              attempts += 1;
              if (attempts === 1) throw new Error('credential-bearing database failure');
              return 2;
            },
            async readBacklog() {
              return { count: 0 };
            },
          },
        ],
        now: () => new Date(timeMs),
        random: () => 0.5,
        async wait(delayMs) {
          timeMs += delayMs;
          if (attempts >= 2) controller.abort();
        },
      },
    );

    await relay.run(controller.signal);

    expect(attempts).toBe(2);
    expect(health.snapshot(new Date(timeMs))).toMatchObject({
      ready: true,
      deliveredTotal: 2,
      tenants: [{ tenantId, consecutiveFailures: 0 }],
    });
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain(
      'credential-bearing database failure',
    );
  });

  it('waits for an in-flight batch before completing shutdown and starts no new batch', async () => {
    const controller = new AbortController();
    let releaseDrain: (() => void) | undefined;
    const drain = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          releaseDrain = () => resolve(0);
        }),
    );
    const relay = new FinanceAuditRelay(
      {
        batchSize: 100,
        pollIntervalMs: 1_000,
        backoff: { baseDelayMs: 100, maximumDelayMs: 1_000, jitterRatio: 0 },
      },
      {
        health: new RelayHealth([tenantId], 60_000, 500, 120_000),
        logger: silentLogger,
        probeControl: vi.fn().mockResolvedValue(undefined),
        discoverTargets: async () => [
          {
            tenantId,
            probe: vi.fn().mockResolvedValue(undefined),
            drain,
            readBacklog: vi.fn().mockResolvedValue({ count: 0 }),
          },
        ],
      },
    );

    const running = relay.run(controller.signal);
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));
    controller.abort();
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseDrain?.();
    await running;
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('registers and drains a pending tenant returned by database discovery', async () => {
    const discoveredTenantId = '00000000-0000-4000-8000-000000000002' as VerifiedTenantId;
    const configuredDrain = vi.fn().mockResolvedValue(0);
    const discoveredDrain = vi.fn().mockResolvedValue(1);
    const controller = new AbortController();
    const health = new RelayHealth([tenantId], 60_000, 500, 120_000);
    const relay = new FinanceAuditRelay(
      {
        batchSize: 100,
        pollIntervalMs: 1_000,
        backoff: { baseDelayMs: 100, maximumDelayMs: 1_000, jitterRatio: 0 },
      },
      {
        health,
        logger: silentLogger,
        probeControl: vi.fn().mockResolvedValue(undefined),
        discoverTargets: async () => [
          {
            tenantId,
            probe: vi.fn().mockResolvedValue(undefined),
            drain: configuredDrain,
            readBacklog: vi.fn().mockResolvedValue({ count: 0 }),
          },
          {
            tenantId: discoveredTenantId,
            probe: vi.fn().mockResolvedValue(undefined),
            drain: discoveredDrain,
            readBacklog: vi.fn().mockResolvedValue({ count: 0 }),
          },
        ],
        async wait(_delayMs, signal) {
          if (!signal.aborted) controller.abort();
        },
      },
    );

    await relay.run(controller.signal);

    expect(configuredDrain).toHaveBeenCalledOnce();
    expect(discoveredDrain).toHaveBeenCalledOnce();
    expect(health.snapshot()).toMatchObject({
      ready: true,
      tenants: [
        { tenantId, deliveredTotal: 0 },
        { tenantId: discoveredTenantId, deliveredTotal: 1 },
      ],
    });
  });
});
