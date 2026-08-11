import type { VerifiedTenantId } from '@isp/contracts';
import { calculateBackoffDelay, waitForDelay, type BackoffOptions } from './backoff.js';
import type { RelayHealth } from './health.js';
import type { RelayLogger } from './logger.js';

export interface BacklogSample {
  readonly count: number;
  readonly oldestOccurredAt?: string;
}

export interface RelayTenantTarget {
  readonly tenantId: VerifiedTenantId;
  probe(): Promise<void>;
  drain(deliveredAt: Date, batchSize: number): Promise<number>;
  readBacklog(): Promise<BacklogSample>;
}

export interface FinanceAuditRelayOptions {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly backoff: BackoffOptions;
}

export interface FinanceAuditRelayDependencies {
  readonly health: RelayHealth;
  readonly logger: RelayLogger;
  readonly probeControl: () => Promise<void>;
  readonly discoverTargets: () => Promise<readonly RelayTenantTarget[]>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface RetryState {
  consecutiveFailures: number;
  nextAttemptAtMs: number;
}

export class FinanceAuditRelay {
  readonly #options: FinanceAuditRelayOptions;
  readonly #dependencies: Required<Pick<FinanceAuditRelayDependencies, 'now' | 'random' | 'wait'>> &
    Omit<FinanceAuditRelayDependencies, 'now' | 'random' | 'wait'>;
  readonly #tenantRetries = new Map<VerifiedTenantId, RetryState>();
  #controlFailures = 0;
  #controlNextAttemptAtMs = 0;
  #discoveryFailures = 0;
  #discoveryNextAttemptAtMs = 0;

  public constructor(
    options: FinanceAuditRelayOptions,
    dependencies: FinanceAuditRelayDependencies,
  ) {
    this.#options = options;
    this.#dependencies = {
      ...dependencies,
      now: dependencies.now ?? (() => new Date()),
      random: dependencies.random ?? Math.random,
      wait: dependencies.wait ?? waitForDelay,
    };
  }

  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const nextDelay = await this.#runCycle(signal);
      if (!signal.aborted) await this.#dependencies.wait(nextDelay, signal);
    }
  }

  async #runCycle(signal: AbortSignal): Promise<number> {
    const cycleTime = this.#dependencies.now();
    if (cycleTime.getTime() < this.#controlNextAttemptAtMs) {
      return this.#boundedDelay(this.#controlNextAttemptAtMs - cycleTime.getTime());
    }

    try {
      await this.#dependencies.probeControl();
      this.#controlFailures = 0;
      this.#controlNextAttemptAtMs = 0;
      this.#dependencies.health.recordControlSuccess(this.#dependencies.now());
    } catch {
      const failedAt = this.#dependencies.now();
      this.#controlFailures += 1;
      this.#dependencies.health.recordControlFailure(failedAt);
      const delay = calculateBackoffDelay(
        this.#controlFailures,
        this.#options.backoff,
        this.#dependencies.random,
      );
      this.#controlNextAttemptAtMs = failedAt.getTime() + delay;
      this.#dependencies.logger.write('error', 'control_probe_failed', {
        consecutiveFailures: this.#controlFailures,
        retryDelayMs: delay,
      });
      return this.#boundedDelay(delay);
    }

    const discoveryTime = this.#dependencies.now();
    if (discoveryTime.getTime() < this.#discoveryNextAttemptAtMs) {
      return this.#boundedDelay(this.#discoveryNextAttemptAtMs - discoveryTime.getTime());
    }

    let targets: readonly RelayTenantTarget[];
    try {
      targets = await this.#dependencies.discoverTargets();
      if (targets.length === 0)
        throw new Error('Finance audit relay discovery returned no targets.');
      const tenantIds = new Set<VerifiedTenantId>();
      for (const target of targets) {
        if (tenantIds.has(target.tenantId))
          throw new Error('Finance audit relay discovery returned a duplicate tenant.');
        tenantIds.add(target.tenantId);
        this.#dependencies.health.registerTenant(target.tenantId);
        if (!this.#tenantRetries.has(target.tenantId)) {
          this.#tenantRetries.set(target.tenantId, {
            consecutiveFailures: 0,
            nextAttemptAtMs: 0,
          });
        }
      }
      this.#discoveryFailures = 0;
      this.#discoveryNextAttemptAtMs = 0;
      this.#dependencies.health.recordDiscoverySuccess(this.#dependencies.now());
    } catch {
      const failedAt = this.#dependencies.now();
      this.#discoveryFailures += 1;
      this.#dependencies.health.recordDiscoveryFailure(failedAt);
      const delay = calculateBackoffDelay(
        this.#discoveryFailures,
        this.#options.backoff,
        this.#dependencies.random,
      );
      this.#discoveryNextAttemptAtMs = failedAt.getTime() + delay;
      this.#dependencies.logger.write('error', 'tenant_discovery_failed', {
        consecutiveFailures: this.#discoveryFailures,
        retryDelayMs: delay,
      });
      return this.#boundedDelay(delay);
    }

    let immediateBacklog = false;
    let earliestNextAttemptAtMs = Number.POSITIVE_INFINITY;
    for (const target of targets) {
      if (signal.aborted) break;
      const retry = this.#requireRetry(target.tenantId);
      const attemptTime = this.#dependencies.now();
      if (attemptTime.getTime() < retry.nextAttemptAtMs) {
        earliestNextAttemptAtMs = Math.min(earliestNextAttemptAtMs, retry.nextAttemptAtMs);
        continue;
      }

      this.#dependencies.health.recordTenantAttempt(target.tenantId, attemptTime);
      try {
        await target.probe();
        const delivered = await target.drain(attemptTime, this.#options.batchSize);
        const backlog = await target.readBacklog();
        const succeededAt = this.#dependencies.now();
        retry.consecutiveFailures = 0;
        retry.nextAttemptAtMs = 0;
        immediateBacklog ||= backlog.count > 0;
        this.#dependencies.health.recordTenantSuccess(
          target.tenantId,
          succeededAt,
          delivered,
          backlog.count,
          backlog.oldestOccurredAt,
        );
        if (delivered > 0 || backlog.count > 0) {
          this.#dependencies.logger.write('info', 'tenant_batch_delivered', {
            tenantId: target.tenantId,
            delivered,
            backlogPendingCount: backlog.count,
            backlogOldestOccurredAt: backlog.oldestOccurredAt ?? null,
          });
        }
      } catch {
        const failedAt = this.#dependencies.now();
        retry.consecutiveFailures = this.#dependencies.health.recordTenantFailure(
          target.tenantId,
          failedAt,
        );
        const delay = calculateBackoffDelay(
          retry.consecutiveFailures,
          this.#options.backoff,
          this.#dependencies.random,
        );
        retry.nextAttemptAtMs = failedAt.getTime() + delay;
        earliestNextAttemptAtMs = Math.min(earliestNextAttemptAtMs, retry.nextAttemptAtMs);
        this.#dependencies.logger.write('error', 'tenant_batch_failed', {
          tenantId: target.tenantId,
          consecutiveFailures: retry.consecutiveFailures,
          retryDelayMs: delay,
        });
      }
    }

    if (immediateBacklog) return 10;
    const nowMs = this.#dependencies.now().getTime();
    const retryDelay = earliestNextAttemptAtMs - nowMs;
    return this.#boundedDelay(
      Number.isFinite(retryDelay) ? retryDelay : this.#options.pollIntervalMs,
    );
  }

  #boundedDelay(delayMs: number): number {
    return Math.max(10, Math.min(this.#options.pollIntervalMs, Math.ceil(delayMs)));
  }

  #requireRetry(tenantId: VerifiedTenantId): RetryState {
    const retry = this.#tenantRetries.get(tenantId);
    if (!retry) throw new Error('Relay attempted an unconfigured tenant.');
    return retry;
  }
}
