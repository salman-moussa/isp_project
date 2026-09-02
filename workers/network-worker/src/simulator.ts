import type {
  NetworkAction,
  PppoeObservedState,
  RouterAdapter,
  RouterCommandContext,
  RouterCommandOutcome,
  RouterHealth,
  RouterRegistration,
  SubscriberServiceId,
} from './domain.js';

export type RouterSimulatorScenario =
  | 'success'
  | 'slow_response'
  | 'timeout'
  | 'authentication_failure'
  | 'offline_router'
  | 'partial_bulk_result'
  | 'rate_limit'
  | 'inconsistent_observed_state'
  | 'reconnect';

export interface RouterSimulatorFixture {
  readonly scenario: RouterSimulatorScenario;
  readonly latencyMs?: number;
  readonly failSubscriberServiceIds?: readonly string[];
}

export class RouterOsSimulator implements RouterAdapter {
  readonly #states = new Map<string, PppoeObservedState>();
  readonly #calls = new Map<string, number>();

  constructor(private readonly fixture: RouterSimulatorFixture) {}

  seed(subscriberServiceId: string, state: PppoeObservedState): void {
    this.#states.set(subscriberServiceId, structuredClone(state));
  }

  calls(subscriberServiceId: string): number {
    return this.#calls.get(subscriberServiceId) ?? 0;
  }

  async probe(): Promise<RouterHealth> {
    const available = this.fixture.scenario !== 'offline_router';
    return {
      available,
      cpuPercent: 16,
      memoryUsedPercent: 38,
      uptimeSeconds: 86_400,
      latencyMs: this.fixture.latencyMs ?? 12,
      routerClock: '2026-08-13T08:00:00.000Z',
      checkedAt: '2026-08-13T08:00:00.000Z',
    };
  }

  async observe(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    context: RouterCommandContext,
  ): Promise<PppoeObservedState | undefined> {
    void registration;
    void context;
    const state = this.#states.get(subscriberServiceId);
    return state === undefined ? undefined : structuredClone(state);
  }

  async execute(
    _registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    action: NetworkAction,
    context: RouterCommandContext,
  ): Promise<RouterCommandOutcome> {
    const call = (this.#calls.get(subscriberServiceId) ?? 0) + 1;
    this.#calls.set(subscriberServiceId, call);

    if (this.fixture.scenario === 'authentication_failure') {
      return this.failure(
        context.requestId,
        'authentication',
        false,
        'Router authentication failed.',
      );
    }
    if (this.fixture.scenario === 'offline_router') {
      return this.failure(context.requestId, 'offline', true, 'Router is offline.');
    }
    if (this.fixture.scenario === 'rate_limit') {
      return this.failure(context.requestId, 'rate_limited', true, 'Router rate limit reached.');
    }
    if (this.fixture.scenario === 'timeout') {
      return {
        classification: 'uncertain',
        requestId: context.requestId,
        errorClass: 'timeout',
        safeMessage: 'Router outcome is unknown after timeout.',
      };
    }
    if (this.fixture.scenario === 'reconnect' && call === 1) {
      return this.failure(
        context.requestId,
        'offline',
        true,
        'Router disconnected; reconnect pending.',
      );
    }
    if (
      this.fixture.scenario === 'partial_bulk_result' &&
      (this.fixture.failSubscriberServiceIds?.includes(subscriberServiceId) ?? call % 2 === 0)
    ) {
      return this.failure(
        context.requestId,
        'invalid_request',
        false,
        'Simulator rejected this batch member.',
      );
    }

    const observed: PppoeObservedState = {
      ...action.desired,
      profileId:
        this.fixture.scenario === 'inconsistent_observed_state'
          ? `${action.desired.profileId}-unexpected`
          : action.desired.profileId,
      ...(action.kind === 'session.disconnect' ? { activeSessionIds: [] } : {}),
      sampledAt: '2026-08-13T08:00:01.000Z',
    };
    this.#states.set(subscriberServiceId, observed);
    return {
      classification: 'definite_success',
      requestId: context.requestId,
      observed: structuredClone(observed),
      latencyMs: this.fixture.latencyMs ?? (this.fixture.scenario === 'slow_response' ? 2_500 : 12),
    };
  }

  failure(
    requestId: string,
    errorClass: 'authentication' | 'offline' | 'rate_limited' | 'invalid_request',
    retryable: boolean,
    safeMessage: string,
  ): RouterCommandOutcome {
    return { classification: 'definite_failure', requestId, errorClass, retryable, safeMessage };
  }
}
