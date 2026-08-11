import type { VerifiedTenantId } from '@isp/contracts';

interface TenantHealthState {
  readonly tenantId: VerifiedTenantId;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  deliveredTotal: number;
  backlogObservedAt: string | null;
  backlogPendingCount: number | null;
  backlogOldestOccurredAt: string | null;
}

export interface RelayHealthSnapshot {
  readonly service: 'finance-audit-relay';
  readonly status: 'starting' | 'ready' | 'degraded' | 'stopping';
  readonly startedAt: string;
  readonly observedAt: string;
  readonly shuttingDown: boolean;
  readonly ready: boolean;
  readonly lastSuccessAt: string | null;
  readonly deliveredTotal: number;
  readonly control: {
    readonly lastSuccessAt: string | null;
    readonly lastFailureAt: string | null;
    readonly consecutiveFailures: number;
  };
  readonly discovery: {
    readonly lastSuccessAt: string | null;
    readonly lastFailureAt: string | null;
    readonly consecutiveFailures: number;
  };
  readonly tenants: readonly {
    readonly tenantId: string;
    readonly lastAttemptAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly lastFailureAt: string | null;
    readonly consecutiveFailures: number;
    readonly deliveredTotal: number;
    readonly backlog: {
      readonly observedAt: string | null;
      readonly pendingCount: number | null;
      readonly oldestOccurredAt: string | null;
      readonly healthy: boolean;
    };
  }[];
}

export class RelayHealth {
  readonly #startedAt: Date;
  readonly #readinessMaximumStaleMs: number;
  readonly #readinessMaximumBacklogCount: number;
  readonly #readinessMaximumBacklogAgeMs: number;
  readonly #tenants = new Map<VerifiedTenantId, TenantHealthState>();
  #shuttingDown = false;
  #controlLastSuccessAt: string | null = null;
  #controlLastFailureAt: string | null = null;
  #controlConsecutiveFailures = 0;
  #discoveryLastSuccessAt: string | null = null;
  #discoveryLastFailureAt: string | null = null;
  #discoveryConsecutiveFailures = 0;

  public constructor(
    tenantIds: readonly VerifiedTenantId[],
    readinessMaximumStaleMs: number,
    readinessMaximumBacklogCount: number,
    readinessMaximumBacklogAgeMs: number,
    startedAt = new Date(),
  ) {
    this.#startedAt = startedAt;
    this.#readinessMaximumStaleMs = readinessMaximumStaleMs;
    this.#readinessMaximumBacklogCount = readinessMaximumBacklogCount;
    this.#readinessMaximumBacklogAgeMs = readinessMaximumBacklogAgeMs;
    for (const tenantId of tenantIds) {
      this.#tenants.set(tenantId, {
        tenantId,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        deliveredTotal: 0,
        backlogObservedAt: null,
        backlogPendingCount: null,
        backlogOldestOccurredAt: null,
      });
    }
  }

  public recordControlSuccess(at: Date): void {
    this.#controlLastSuccessAt = at.toISOString();
    this.#controlConsecutiveFailures = 0;
  }

  public recordControlFailure(at: Date): void {
    this.#controlLastFailureAt = at.toISOString();
    this.#controlConsecutiveFailures += 1;
  }

  public recordDiscoverySuccess(at: Date): void {
    this.#discoveryLastSuccessAt = at.toISOString();
    this.#discoveryConsecutiveFailures = 0;
  }

  public recordDiscoveryFailure(at: Date): void {
    this.#discoveryLastFailureAt = at.toISOString();
    this.#discoveryConsecutiveFailures += 1;
  }

  public registerTenant(tenantId: VerifiedTenantId): void {
    if (this.#tenants.has(tenantId)) return;
    this.#tenants.set(tenantId, {
      tenantId,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      deliveredTotal: 0,
      backlogObservedAt: null,
      backlogPendingCount: null,
      backlogOldestOccurredAt: null,
    });
  }

  public recordTenantAttempt(tenantId: VerifiedTenantId, at: Date): void {
    this.#requireTenant(tenantId).lastAttemptAt = at.toISOString();
  }

  public recordTenantSuccess(
    tenantId: VerifiedTenantId,
    at: Date,
    delivered: number,
    backlogPendingCount: number,
    backlogOldestOccurredAt: string | undefined,
  ): void {
    const tenant = this.#requireTenant(tenantId);
    const timestamp = at.toISOString();
    tenant.lastSuccessAt = timestamp;
    tenant.consecutiveFailures = 0;
    tenant.deliveredTotal += delivered;
    tenant.backlogObservedAt = timestamp;
    tenant.backlogPendingCount = backlogPendingCount;
    tenant.backlogOldestOccurredAt = backlogOldestOccurredAt ?? null;
  }

  public recordTenantFailure(tenantId: VerifiedTenantId, at: Date): number {
    const tenant = this.#requireTenant(tenantId);
    tenant.lastFailureAt = at.toISOString();
    tenant.consecutiveFailures += 1;
    return tenant.consecutiveFailures;
  }

  public beginShutdown(): void {
    this.#shuttingDown = true;
  }

  public snapshot(at = new Date()): RelayHealthSnapshot {
    const tenantStates = [...this.#tenants.values()];
    const timestamps = tenantStates
      .map((tenant) => tenant.lastSuccessAt)
      .filter((value): value is string => value !== null);
    const lastSuccessAt = timestamps.length === 0 ? null : (timestamps.sort().at(-1) ?? null);
    const controlReady =
      this.#controlLastSuccessAt !== null &&
      this.#controlConsecutiveFailures === 0 &&
      isFresh(this.#controlLastSuccessAt, at, this.#readinessMaximumStaleMs);
    const discoveryReady =
      this.#discoveryLastSuccessAt !== null &&
      this.#discoveryConsecutiveFailures === 0 &&
      isFresh(this.#discoveryLastSuccessAt, at, this.#readinessMaximumStaleMs);
    const tenantsReady = tenantStates.every(
      (tenant) =>
        tenant.lastSuccessAt !== null &&
        tenant.consecutiveFailures === 0 &&
        isFresh(tenant.lastSuccessAt, at, this.#readinessMaximumStaleMs) &&
        this.#isBacklogHealthy(tenant, at),
    );
    const ready = !this.#shuttingDown && controlReady && discoveryReady && tenantsReady;
    const attempted =
      this.#controlLastSuccessAt !== null ||
      this.#controlLastFailureAt !== null ||
      this.#discoveryLastSuccessAt !== null ||
      this.#discoveryLastFailureAt !== null ||
      tenantStates.some((tenant) => tenant.lastAttemptAt !== null);
    const status = this.#shuttingDown
      ? 'stopping'
      : ready
        ? 'ready'
        : attempted
          ? 'degraded'
          : 'starting';

    return {
      service: 'finance-audit-relay',
      status,
      startedAt: this.#startedAt.toISOString(),
      observedAt: at.toISOString(),
      shuttingDown: this.#shuttingDown,
      ready,
      lastSuccessAt,
      deliveredTotal: tenantStates.reduce((total, tenant) => total + tenant.deliveredTotal, 0),
      control: {
        lastSuccessAt: this.#controlLastSuccessAt,
        lastFailureAt: this.#controlLastFailureAt,
        consecutiveFailures: this.#controlConsecutiveFailures,
      },
      discovery: {
        lastSuccessAt: this.#discoveryLastSuccessAt,
        lastFailureAt: this.#discoveryLastFailureAt,
        consecutiveFailures: this.#discoveryConsecutiveFailures,
      },
      tenants: tenantStates.map((tenant) => ({
        tenantId: tenant.tenantId,
        lastAttemptAt: tenant.lastAttemptAt,
        lastSuccessAt: tenant.lastSuccessAt,
        lastFailureAt: tenant.lastFailureAt,
        consecutiveFailures: tenant.consecutiveFailures,
        deliveredTotal: tenant.deliveredTotal,
        backlog: {
          observedAt: tenant.backlogObservedAt,
          pendingCount: tenant.backlogPendingCount,
          oldestOccurredAt: tenant.backlogOldestOccurredAt,
          healthy: this.#isBacklogHealthy(tenant, at),
        },
      })),
    };
  }

  #requireTenant(tenantId: VerifiedTenantId): TenantHealthState {
    const tenant = this.#tenants.get(tenantId);
    if (!tenant) throw new Error('Relay health received an unconfigured tenant.');
    return tenant;
  }

  #isBacklogHealthy(tenant: TenantHealthState, at: Date): boolean {
    if (tenant.backlogPendingCount === null) return false;
    if (tenant.backlogPendingCount > this.#readinessMaximumBacklogCount) return false;
    if (tenant.backlogPendingCount === 0) return tenant.backlogOldestOccurredAt === null;
    if (tenant.backlogOldestOccurredAt === null) return false;
    return isFresh(tenant.backlogOldestOccurredAt, at, this.#readinessMaximumBacklogAgeMs);
  }
}

function isFresh(timestamp: string, now: Date, maximumStaleMs: number): boolean {
  const age = now.getTime() - Date.parse(timestamp);
  return age >= 0 && age <= maximumStaleMs;
}
