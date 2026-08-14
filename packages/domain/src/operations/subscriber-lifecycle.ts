export const subscriberStatuses = ['lead', 'active', 'suspended', 'closed'] as const;
export type SubscriberStatus = (typeof subscriberStatuses)[number];

export const serviceStatuses = [
  'draft',
  'pending_installation',
  'active',
  'suspended',
  'terminated',
] as const;
export type ServiceStatus = (typeof serviceStatuses)[number];

export const installationStatuses = [
  'requested',
  'scheduled',
  'in_progress',
  'blocked',
  'ready_for_activation',
  'completed',
  'cancelled',
] as const;
export type InstallationStatus = (typeof installationStatuses)[number];

export const issueStatuses = [
  'open',
  'triaged',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export class OperationsRuleError extends Error {
  public readonly code = 'OPERATIONS_RULE_VIOLATION';

  public constructor(message: string) {
    super(message);
    this.name = 'OperationsRuleError';
  }
}

const subscriberTransitions: Readonly<Record<SubscriberStatus, readonly SubscriberStatus[]>> = {
  lead: ['active', 'closed'],
  active: ['suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: [],
};

const serviceTransitions: Readonly<Record<ServiceStatus, readonly ServiceStatus[]>> = {
  draft: ['pending_installation', 'terminated'],
  pending_installation: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: [],
};

const installationTransitions: Readonly<Record<InstallationStatus, readonly InstallationStatus[]>> =
  {
    requested: ['scheduled', 'cancelled'],
    scheduled: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['blocked', 'ready_for_activation', 'cancelled'],
    blocked: ['scheduled', 'in_progress', 'cancelled'],
    ready_for_activation: ['completed', 'blocked'],
    completed: [],
    cancelled: [],
  };

const issueTransitions: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  open: ['triaged', 'closed'],
  triaged: ['in_progress', 'waiting', 'resolved', 'closed'],
  in_progress: ['waiting', 'resolved'],
  waiting: ['in_progress', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

export function assertSubscriberTransition(from: SubscriberStatus, to: SubscriberStatus): void {
  assertTransition('subscriber', from, to, subscriberTransitions[from]);
}

export function assertServiceTransition(from: ServiceStatus, to: ServiceStatus): void {
  assertTransition('service', from, to, serviceTransitions[from]);
}

export function assertInstallationTransition(
  from: InstallationStatus,
  to: InstallationStatus,
): void {
  assertTransition('installation', from, to, installationTransitions[from]);
}

export function assertIssueTransition(from: IssueStatus, to: IssueStatus): void {
  assertTransition('issue', from, to, issueTransitions[from]);
}

function assertTransition<T extends string>(
  entity: string,
  from: T,
  to: T,
  allowed: readonly T[],
): void {
  if (from === to || !allowed.includes(to)) {
    throw new OperationsRuleError(`Invalid ${entity} transition: ${from} -> ${to}.`);
  }
}

/**
 * Subscriber service state is independent of the tenant's Orvex commercial subscription.
 * A restricted platform subscription blocks creation of network work; it never maps to a
 * subscriber suspension action.
 */
export function assertNetworkActionAllowed(platformSubscriptionStatus: string): void {
  if (['restricted', 'terminated', 'archived'].includes(platformSubscriptionStatus)) {
    throw new OperationsRuleError(
      'Platform subscription state forbids enqueuing subscriber network actions.',
    );
  }
}
