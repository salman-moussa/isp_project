import { describe, expect, it, vi } from 'vitest';
import { confirmBulkBatch, previewBulkImpact } from './batch.js';
import type {
  NetworkJobRequest,
  PppoeDesiredState,
  RouterAdapter,
  RouterRegistration,
} from './domain.js';
import { RouterEgressPolicy } from './egress.js';
import { eventCanEnqueueSubscriberNetworkWork, handleNetworkIngress } from './ingress.js';
import { RouterCircuitBreaker, RouterConcurrencyLimiter, retryDelayMs } from './policy.js';
import { RouterOsSimulator, type RouterSimulatorScenario } from './simulator.js';
import { InMemoryDurableNetworkStore } from './store.js';
import { NetworkWorker } from './worker.js';

const now = new Date('2026-08-13T08:00:00.000Z');
const desired: PppoeDesiredState = {
  accountName: 'subscriber-100',
  enabled: false,
  profileId: 'profile-10m',
  ipAssignment: { mode: 'dynamic', poolId: 'pool-main' },
  vlanId: '200',
};
const router: RouterRegistration = {
  tenantId: 'tenant-1',
  routerId: 'router-1',
  endpoint: new URL('https://router-1.internal.example'),
  credentialReference: 'secret://tenants/tenant-1/routers/router-1',
  connector: 'simulator',
  enabled: true,
};

function request(overrides: Partial<NetworkJobRequest> = {}): NetworkJobRequest {
  return {
    requestId: 'request-1',
    idempotencyKey: 'idem-1',
    tenantId: 'tenant-1',
    routerId: 'router-1',
    subscriberServiceId: 'service-1',
    action: { kind: 'pppoe.suspend', desired },
    origin: 'tenant-service-lifecycle',
    actorId: 'staff-1',
    permission: 'network.subscribers.suspend',
    reason: 'Invoice collection policy approved by tenant staff.',
    ...overrides,
  };
}

async function harness(scenario: RouterSimulatorScenario) {
  const store = new InMemoryDurableNetworkStore();
  await store.registerRouter(router);
  const simulator = new RouterOsSimulator({ scenario });
  const worker = new NetworkWorker(
    store,
    simulator,
    new RouterEgressPolicy([router.endpoint.origin]),
    new RouterConcurrencyLimiter(1),
    new RouterCircuitBreaker({ failureThreshold: 3, resetAfterMs: 10_000 }),
    {
      timeoutMs: 2_000,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
      now: () => now,
      random: () => 0.5,
    },
  );
  return { store, simulator, worker };
}

describe('Network Worker contracts (REQ-NET-001)', () => {
  it('deduplicates durable jobs by tenant and idempotency key', async () => {
    const store = new InMemoryDurableNetworkStore();
    const first = await store.enqueue(request(), now);
    const second = await store.enqueue(request({ requestId: 'different-request' }), now);
    expect(second.jobId).toBe(first.jobId);
    expect(second.request.requestId).toBe('request-1');
  });

  it('proves platform subscription events cannot enqueue subscriber work', async () => {
    const store = new InMemoryDurableNetworkStore();
    const result = await handleNetworkIngress(
      store,
      {
        type: 'platform.subscription.state_changed',
        tenantId: 'tenant-1',
        subscriptionState: 'restricted',
        eventId: 'platform-event-1',
      },
      now,
    );
    expect(result).toEqual({
      accepted: false,
      reason: 'platform_subscription_events_are_non_networking',
    });
    expect(await store.getByIdempotency('tenant-1', 'platform-event-1')).toBeUndefined();
    expect(eventCanEnqueueSubscriberNetworkWork('platform.subscription.state_changed')).toBe(false);
  });

  it.each([
    ['success', 'succeeded'],
    ['slow_response', 'succeeded'],
    ['authentication_failure', 'dead_lettered'],
    ['offline_router', 'retry_scheduled'],
    ['rate_limit', 'retry_scheduled'],
    ['timeout', 'reconciling'],
    ['inconsistent_observed_state', 'reconciling'],
    ['reconnect', 'retry_scheduled'],
  ] satisfies readonly (readonly [RouterSimulatorScenario, string])[])(
    'handles simulator scenario %s as %s',
    async (scenario, expectedState) => {
      const { store, worker } = await harness(scenario);
      await store.enqueue(request(), now);
      const result = await worker.processNext();
      expect(result?.state).toBe(expectedState);
    },
  );

  it('reconciles an uncertain destructive outcome before retrying it', async () => {
    const { store, simulator, worker } = await harness('timeout');
    const job = await store.enqueue(request(), now);
    const first = await worker.processNext();
    expect(first?.state).toBe('reconciling');
    simulator.seed('service-1', { ...desired, sampledAt: now.toISOString() });
    await store.save({ ...first!, availableAt: now.toISOString() });
    const second = await worker.processNext();
    expect(second?.state).toBe('reconciled');
    expect(simulator.calls('service-1')).toBe(1);
    expect((await store.get(job.jobId))?.state).toBe('reconciled');
  });

  it('returns mixed results for the partial bulk simulator scenario', async () => {
    const store = new InMemoryDurableNetworkStore();
    await store.registerRouter(router);
    const simulator = new RouterOsSimulator({
      scenario: 'partial_bulk_result',
      failSubscriberServiceIds: ['service-2'],
    });
    const context = {
      requestId: 'batch-request',
      timeoutMs: 2_000,
      credentialReference: router.credentialReference,
    };
    const first = await simulator.execute(
      router,
      'service-1',
      { kind: 'pppoe.suspend', desired },
      context,
    );
    const second = await simulator.execute(
      router,
      'service-2',
      { kind: 'pppoe.suspend', desired },
      context,
    );
    expect(first.classification).toBe('definite_success');
    expect(second.classification).toBe('definite_failure');
  });

  it('enforces per-router concurrency and bounded backoff', () => {
    const limiter = new RouterConcurrencyLimiter(1);
    const release = limiter.tryAcquire('router-1');
    expect(release).toBeTypeOf('function');
    expect(limiter.tryAcquire('router-1')).toBeUndefined();
    release!();
    expect(limiter.tryAcquire('router-1')).toBeTypeOf('function');
    expect(
      retryDelayMs(10, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5_000, jitterRatio: 0 }),
    ).toBe(5_000);
  });

  it('opens and half-opens a per-router circuit', () => {
    const circuit = new RouterCircuitBreaker({ failureThreshold: 2, resetAfterMs: 1_000 });
    circuit.recordFailure('router-1', 0);
    circuit.recordFailure('router-1', 10);
    expect(circuit.tryAcquire('router-1', 500)).toBe(false);
    expect(circuit.state('router-1', 1_100)).toBe('half_open');
    expect(circuit.tryAcquire('router-1', 1_100)).toBe(true);
    expect(circuit.tryAcquire('router-1', 1_101)).toBe(false);
  });

  it('rejects endpoints outside the explicit egress allowlist', () => {
    expect(() => new RouterEgressPolicy([]).assertAllowed(router)).toThrow(/allowlist/);
  });
});

describe('immutable bulk impact model (REQ-NET-002)', () => {
  it('captures exact inclusions, exclusions, approval and digest', () => {
    const preview = previewBulkImpact({
      tenantId: 'tenant-1',
      selection: { type: 'area', areaId: 'area-1' },
      actionKind: 'pppoe.suspend',
      candidates: [
        {
          subscriberServiceId: 'service-1',
          routerId: 'router-1',
          areaId: 'area-1',
          packageId: 'package-a',
          currentActionAllowed: true,
        },
        {
          subscriberServiceId: 'service-2',
          routerId: 'router-1',
          areaId: 'area-1',
          packageId: 'package-a',
          currentActionAllowed: false,
          exclusionReason: 'Already suspended',
        },
      ],
      generatedAt: now,
    });
    const batch = confirmBulkBatch({
      preview,
      batchId: 'batch-1',
      reason: 'Approved maintenance window',
      permission: 'network.bulk.suspend',
      actorId: 'operator-1',
      approvalId: 'approval-1',
      confirmedAt: now,
    });
    expect(batch.included.map((item) => item.subscriberServiceId)).toEqual(['service-1']);
    expect(batch.excluded[0]?.exclusionReason).toBe('Already suspended');
    expect(Object.isFrozen(batch)).toBe(true);
    expect(batch.digest).toMatch(/^fnv1a-/);
  });
});
describe('action-specific acknowledgement', () => {
  it('does not reconcile a disconnect while the target session remains or no active list was observed', async () => {
    for (const active of [undefined, ['*A']] as const) {
      const { store, simulator, worker } = await harness('timeout');
      await store.enqueue(
        request({ action: { kind: 'session.disconnect', desired, sessionId: '*A' } }),
        now,
      );
      const first = await worker.processNext();
      simulator.seed('service-1', {
        ...desired,
        sampledAt: now.toISOString(),
        ...(active ? { activeSessionIds: active } : {}),
      });
      await store.save({ ...first!, availableAt: now.toISOString() });
      const retry = await worker.processNext();
      expect(retry?.state).toBe('dead_lettered');
      expect(simulator.calls('service-1')).toBe(2);
    }
  });
  it('reconciles a timed-out disconnect only after a full observation excludes the target', async () => {
    const { store, simulator, worker } = await harness('timeout');
    await store.enqueue(
      request({ action: { kind: 'session.disconnect', desired, sessionId: '*A' } }),
      now,
    );
    const first = await worker.processNext();
    simulator.seed('service-1', {
      ...desired,
      sampledAt: now.toISOString(),
      activeSessionIds: ['*B'],
    });
    await store.save({ ...first!, availableAt: now.toISOString() });
    expect((await worker.processNext())?.state).toBe('reconciled');
    expect(simulator.calls('service-1')).toBe(1);
  });
  it('does not infer a successful password rotation from unchanged profile fields or resend it after timeout', async () => {
    const { store, simulator, worker } = await harness('timeout');
    await store.enqueue(
      request({
        action: {
          kind: 'pppoe.password.change',
          desired,
          passwordSecretReference: 'secret://test/password',
        },
      }),
      now,
    );
    const first = await worker.processNext();
    simulator.seed('service-1', { ...desired, sampledAt: now.toISOString() });
    await store.save({ ...first!, availableAt: now.toISOString() });
    expect((await worker.processNext())?.state).toBe('dead_lettered');
    expect(simulator.calls('service-1')).toBe(1);
  });
  it('counts preflight failures without sending a mutation or stranding the claimed job', async () => {
    const { store, simulator, worker } = await harness('success');
    vi.spyOn(simulator, 'observe').mockRejectedValue(new Error('offline'));
    await store.enqueue(request(), now);
    const first = await worker.processNext();
    expect(first?.state).toBe('retry_scheduled');
    expect(first?.attempts).toHaveLength(1);
    expect(simulator.calls('service-1')).toBe(0);
  });
  it('aborts the adapter transport when the worker deadline expires', async () => {
    const store = new InMemoryDurableNetworkStore();
    await store.registerRouter(router);
    let aborted = false;
    const adapter: RouterAdapter = {
      probe: async () => ({
        available: true,
        cpuPercent: 0,
        memoryUsedPercent: 0,
        uptimeSeconds: 1,
        latencyMs: 0,
        routerClock: now.toISOString(),
        checkedAt: now.toISOString(),
      }),
      observe: async () => ({ ...desired, sampledAt: now.toISOString() }),
      execute: async (_router, _service, _action, commandContext) =>
        new Promise((resolve) => {
          commandContext.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve({
                classification: 'uncertain',
                requestId: commandContext.requestId,
                errorClass: 'timeout',
                safeMessage: 'Aborted by the worker deadline.',
              });
            },
            { once: true },
          );
        }),
    };
    const worker = new NetworkWorker(
      store,
      adapter,
      new RouterEgressPolicy([router.endpoint.origin]),
      new RouterConcurrencyLimiter(1),
      new RouterCircuitBreaker({ failureThreshold: 3, resetAfterMs: 10_000 }),
      {
        timeoutMs: 10,
        retryPolicy: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
        now: () => now,
        random: () => 0.5,
      },
    );
    await store.enqueue(request(), now);
    const result = await worker.processNext();
    expect(aborted).toBe(true);
    expect(result?.state).toBe('reconciling');
    expect(result?.attempts[0]?.outcome).toMatchObject({
      classification: 'uncertain',
      errorClass: 'timeout',
    });
  });
});
