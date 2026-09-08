export type TenantId = string;
export type RouterId = string;
export type SubscriberServiceId = string;

export type SecretReference = `secret://${string}`;

export interface RouterRegistration {
  readonly routerId: RouterId;
  readonly tenantId: TenantId;
  readonly endpoint: URL;
  readonly credentialReference: SecretReference;
  readonly connector: 'routeros-api' | 'routeros-rest' | 'simulator';
  readonly enabled: boolean;
}

export interface PppoeDesiredState {
  readonly accountName: string;
  readonly enabled: boolean;
  readonly profileId: string;
  readonly ipAssignment:
    | { readonly mode: 'dynamic'; readonly poolId: string }
    | { readonly mode: 'static'; readonly address: string };
  readonly vlanId?: string;
}

export interface PppoeObservedState extends PppoeDesiredState {
  readonly activeSessionId?: string;
  /** Complete bounded active-session observation; undefined means not verified. */
  readonly activeSessionIds?: readonly string[];
  readonly lastLoginAt?: string;
  readonly sampledAt: string;
}

export type NetworkAction =
  | {
      readonly kind: 'pppoe.create';
      readonly desired: PppoeDesiredState;
      readonly passwordSecretReference: SecretReference;
    }
  | { readonly kind: 'pppoe.suspend'; readonly desired: PppoeDesiredState }
  | { readonly kind: 'pppoe.restore'; readonly desired: PppoeDesiredState }
  | {
      readonly kind: 'pppoe.password.change';
      readonly desired: PppoeDesiredState;
      readonly passwordSecretReference: SecretReference;
    }
  | { readonly kind: 'pppoe.profile.change'; readonly desired: PppoeDesiredState }
  | { readonly kind: 'pppoe.address.change'; readonly desired: PppoeDesiredState }
  | {
      readonly kind: 'session.disconnect';
      readonly desired: PppoeDesiredState;
      readonly sessionId: string;
    };

export const destructiveActionKinds = new Set<NetworkAction['kind']>([
  'pppoe.suspend',
  'pppoe.password.change',
  'pppoe.profile.change',
  'pppoe.address.change',
  'session.disconnect',
]);

export type NetworkJobOrigin =
  | 'tenant-service-lifecycle'
  | 'tenant-network-operation'
  | 'approved-bulk-operation'
  | 'manual-retry';

export interface NetworkJobRequest {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly tenantId: TenantId;
  readonly routerId: RouterId;
  readonly subscriberServiceId: SubscriberServiceId;
  readonly action: NetworkAction;
  readonly origin: NetworkJobOrigin;
  readonly actorId: string;
  readonly permission: string;
  readonly approvalId?: string;
  readonly reason: string;
}

export type NetworkJobState =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'reconciling'
  | 'reconciled'
  | 'succeeded'
  | 'partially_succeeded'
  | 'failed'
  | 'dead_lettered'
  | 'canceled';

export interface NetworkJobAttempt {
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: RouterCommandOutcome;
  readonly observedBefore?: PppoeObservedState;
  readonly observedAfter?: PppoeObservedState;
}

export interface NetworkJob {
  readonly jobId: string;
  readonly request: NetworkJobRequest;
  readonly createdAt: string;
  readonly previousObservedState?: PppoeObservedState;
  readonly attempts: readonly NetworkJobAttempt[];
  readonly state: NetworkJobState;
  readonly availableAt: string;
  readonly lastErrorClass?: RouterErrorClass;
}

export type RouterErrorClass =
  | 'authentication'
  | 'authorization'
  | 'offline'
  | 'rate_limited'
  | 'timeout'
  | 'transport'
  | 'invalid_request'
  | 'observed_state_mismatch'
  | 'circuit_open';

export type RouterCommandOutcome =
  | {
      readonly classification: 'definite_success';
      readonly requestId: string;
      readonly observed: PppoeObservedState;
      readonly latencyMs: number;
    }
  | {
      readonly classification: 'definite_failure';
      readonly requestId: string;
      readonly errorClass: RouterErrorClass;
      readonly retryable: boolean;
      readonly safeMessage: string;
    }
  | {
      readonly classification: 'uncertain';
      readonly requestId: string;
      readonly errorClass: Extract<RouterErrorClass, 'timeout' | 'transport'>;
      readonly safeMessage: string;
    };

export interface RouterHealth {
  readonly available: boolean;
  readonly cpuPercent: number;
  readonly memoryUsedPercent: number;
  readonly uptimeSeconds: number;
  readonly latencyMs: number;
  readonly routerClock: string;
  readonly checkedAt: string;
}

export interface RouterResourceInventory {
  readonly profiles: readonly { readonly profileId: string; readonly rateLimit: string }[];
  readonly ipPools: readonly { readonly poolId: string; readonly ranges: readonly string[] }[];
  readonly vlans: readonly { readonly vlanId: string; readonly interfaceName: string }[];
  readonly sampledAt: string;
}

export interface ActiveSessionObservation {
  readonly subscriberServiceId: SubscriberServiceId;
  readonly sessionId: string;
  readonly routerId: RouterId;
  readonly ipAddress: string;
  readonly uptimeSeconds: number;
  readonly lastLoginAt: string;
  readonly sampledAt: string;
}

export interface SafeUsageSample {
  readonly subscriberServiceId: SubscriberServiceId;
  readonly sampledAt: string;
  readonly receivedBytes: number;
  readonly transmittedBytes: number;
}

export interface RouterCommandContext {
  readonly signal?: AbortSignal;
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly credentialReference: SecretReference;
}

export interface RouterAdapter {
  probe(registration: RouterRegistration): Promise<RouterHealth>;
  observe(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    context: RouterCommandContext,
  ): Promise<PppoeObservedState | undefined>;
  execute(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    action: NetworkAction,
    context: RouterCommandContext,
  ): Promise<RouterCommandOutcome>;
}

export function observedMatchesDesired(
  observed: PppoeObservedState | undefined,
  desired: PppoeDesiredState,
): boolean {
  if (observed === undefined) return false;
  return (
    observed.accountName === desired.accountName &&
    observed.enabled === desired.enabled &&
    observed.profileId === desired.profileId &&
    observed.vlanId === desired.vlanId &&
    JSON.stringify(observed.ipAssignment) === JSON.stringify(desired.ipAssignment)
  );
}
/** Configuration equality alone does not prove that a specific session disappeared. */
export function observedConfirmsAction(
  observed: PppoeObservedState | undefined,
  action: NetworkAction,
): boolean {
  if (!observedMatchesDesired(observed, action.desired)) return false;
  return (
    action.kind !== 'session.disconnect' ||
    (observed?.activeSessionIds !== undefined &&
      !observed.activeSessionIds.includes(action.sessionId))
  );
}
