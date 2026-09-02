import {
  destructiveActionKinds,
  observedConfirmsAction,
  type NetworkJob,
  type NetworkJobAttempt,
  type RouterAdapter,
  type RouterCommandOutcome,
} from './domain.js';
import type { RouterEgressPolicy } from './egress.js';
import { DEFAULT_RETRY_POLICY, retryDelayMs } from './policy.js';
import type { RetryPolicy, RouterCircuitBreaker, RouterConcurrencyLimiter } from './policy.js';
import type { DurableNetworkStore } from './store.js';

export interface NetworkWorkerOptions {
  readonly timeoutMs: number;
  readonly retryPolicy?: RetryPolicy;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export class NetworkWorker {
  readonly #retryPolicy: RetryPolicy;
  readonly #now: () => Date;
  readonly #random: () => number;

  constructor(
    private readonly store: DurableNetworkStore,
    private readonly adapter: RouterAdapter,
    private readonly egress: RouterEgressPolicy,
    private readonly concurrency: RouterConcurrencyLimiter,
    private readonly circuit: RouterCircuitBreaker,
    private readonly options: NetworkWorkerOptions,
  ) {
    this.#retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
  }

  async processNext(): Promise<NetworkJob | undefined> {
    const now = this.#now();
    const job = await this.store.claimNext(now);
    if (job === undefined) return undefined;
    const release = this.concurrency.tryAcquire(job.request.routerId);
    if (release === undefined) {
      return this.rescheduleWithoutAttempt(job, 'circuit_open', 100);
    }
    try {
      return await this.processClaimed(job, now);
    } finally {
      release();
    }
  }

  async processClaimed(job: NetworkJob, now: Date): Promise<NetworkJob> {
    const router = await this.store.getRouter(job.request.tenantId, job.request.routerId);
    if (router === undefined || !router.enabled) {
      return this.finishFailure(job, 'invalid_request');
    }
    this.egress.assertAllowed(router);
    if (!this.circuit.tryAcquire(router.routerId, now.getTime())) {
      return this.rescheduleWithoutAttempt(job, 'circuit_open', this.#retryPolicy.baseDelayMs);
    }

    const commandAbort = new AbortController();
    const context = {
      signal: commandAbort.signal,
      requestId: job.request.requestId,
      timeoutMs: this.options.timeoutMs,
      credentialReference: router.credentialReference,
    };
    let observedBefore;
    try {
      observedBefore = await this.adapter.observe(router, job.request.subscriberServiceId, context);
    } catch {
      return this.applyOutcome(
        job,
        {
          attempt: job.attempts.length + 1,
          startedAt: now.toISOString(),
          finishedAt: this.#now().toISOString(),
          outcome: {
            classification: 'definite_failure',
            requestId: context.requestId,
            errorClass: 'transport',
            retryable: true,
            safeMessage: 'Preflight observation failed; no command was sent.',
          },
        },
        now,
      );
    }
    const priorAttempt = job.attempts.at(-1);
    if (
      priorAttempt?.outcome.classification === 'uncertain' &&
      job.request.action.kind === 'pppoe.password.change'
    ) {
      // Secret read-back is deliberately unavailable; unchanged profile data cannot prove rotation.
      const held = {
        ...job,
        state: 'dead_lettered' as const,
        lastErrorClass: 'observed_state_mismatch' as const,
      };
      await this.store.save(held);
      return held;
    }
    if (
      priorAttempt?.outcome.classification === 'uncertain' &&
      destructiveActionKinds.has(job.request.action.kind) &&
      observedBefore !== undefined &&
      observedConfirmsAction(observedBefore, job.request.action)
    ) {
      const reconciled = {
        ...job,
        state: 'reconciled' as const,
        previousObservedState: observedBefore,
      };
      this.circuit.recordSuccess(router.routerId);
      await this.store.save(reconciled);
      return reconciled;
    }

    const startedAt = this.#now();
    let timeout: NodeJS.Timeout | undefined;
    const adapterCall = this.adapter.execute(
      router,
      job.request.subscriberServiceId,
      job.request.action,
      context,
    );
    const timedOut = new Promise<RouterCommandOutcome>((resolve) => {
      timeout = setTimeout(() => {
        commandAbort.abort();
        resolve({
          classification: 'uncertain',
          requestId: context.requestId,
          errorClass: 'timeout',
          safeMessage: 'Router outcome is unknown after the configured timeout.',
        });
      }, this.options.timeoutMs);
    });
    let outcome: RouterCommandOutcome;
    try {
      outcome = await Promise.race([adapterCall, timedOut]);
    } catch {
      outcome = {
        classification: 'uncertain',
        requestId: context.requestId,
        errorClass: 'transport',
        safeMessage: 'Router transport failed before the outcome could be established.',
      };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (
      outcome.classification === 'definite_success' &&
      !observedConfirmsAction(outcome.observed, job.request.action)
    ) {
      outcome = {
        classification: 'uncertain',
        requestId: outcome.requestId,
        errorClass: 'transport',
        safeMessage: 'Router acknowledged the command but observed state does not match.',
      };
    }
    const attempt: NetworkJobAttempt = {
      attempt: job.attempts.length + 1,
      startedAt: startedAt.toISOString(),
      finishedAt: this.#now().toISOString(),
      outcome,
      ...(observedBefore === undefined ? {} : { observedBefore }),
      ...(outcome.classification === 'definite_success' ? { observedAfter: outcome.observed } : {}),
    };
    return this.applyOutcome(job, attempt, now);
  }

  async applyOutcome(job: NetworkJob, attempt: NetworkJobAttempt, now: Date): Promise<NetworkJob> {
    const attempts = [...job.attempts, attempt];
    const outcome = attempt.outcome;
    if (outcome.classification === 'definite_success') {
      this.circuit.recordSuccess(job.request.routerId);
      const succeeded = { ...job, attempts, state: 'succeeded' as const };
      await this.store.save(succeeded);
      return succeeded;
    }

    this.circuit.recordFailure(job.request.routerId, now.getTime());
    const retryable = outcome.classification === 'uncertain' || outcome.retryable;
    if (!retryable || attempts.length >= this.#retryPolicy.maxAttempts) {
      const deadLettered = {
        ...job,
        attempts,
        state: 'dead_lettered' as const,
        lastErrorClass: outcome.errorClass,
      };
      await this.store.save(deadLettered);
      return deadLettered;
    }

    const delay = retryDelayMs(attempts.length, this.#retryPolicy, this.#random);
    const retry = {
      ...job,
      attempts,
      state:
        outcome.classification === 'uncertain'
          ? ('reconciling' as const)
          : ('retry_scheduled' as const),
      availableAt: new Date(now.getTime() + delay).toISOString(),
      lastErrorClass: outcome.errorClass,
    };
    await this.store.save(retry);
    return retry;
  }

  async finishFailure(job: NetworkJob, errorClass: 'invalid_request'): Promise<NetworkJob> {
    const failed = { ...job, state: 'failed' as const, lastErrorClass: errorClass };
    await this.store.save(failed);
    return failed;
  }

  async rescheduleWithoutAttempt(
    job: NetworkJob,
    errorClass: 'circuit_open',
    delayMs: number,
  ): Promise<NetworkJob> {
    const retry = {
      ...job,
      state: 'retry_scheduled' as const,
      availableAt: new Date(this.#now().getTime() + delayMs).toISOString(),
      lastErrorClass: errorClass,
    };
    await this.store.save(retry);
    return retry;
  }
}
