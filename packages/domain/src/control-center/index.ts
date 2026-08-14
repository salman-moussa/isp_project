/**
 * REQ-CC-001..007: framework-free Control Center lifecycle, catalogue, and finance rules.
 * This module deliberately has no network-worker vocabulary: commercial restriction only returns
 * Control Center access policy and can never enqueue subscriber/network commands.
 */

export const clientLifecycleStates = [
  'lead',
  'trial',
  'active',
  'grace',
  'restricted',
  'terminated',
  'archived',
] as const;

export type ClientLifecycleState = (typeof clientLifecycleStates)[number];
export type ControlCenterCurrency = 'USD' | 'LBP';
export type SoftwareAccess = 'none' | 'full' | 'recovery';

const lifecycleTransitions: Readonly<
  Record<ClientLifecycleState, readonly ClientLifecycleState[]>
> = {
  lead: ['trial', 'active', 'archived'],
  trial: ['active', 'terminated', 'archived'],
  active: ['grace', 'restricted', 'terminated'],
  grace: ['active', 'restricted', 'terminated'],
  restricted: ['active', 'terminated'],
  terminated: ['active', 'archived'],
  archived: [],
};

const approvalRequiredStates = new Set<ClientLifecycleState>([
  'restricted',
  'terminated',
  'archived',
]);

export class ControlCenterRuleError extends Error {
  public readonly code = 'CONTROL_CENTER_RULE_VIOLATION';

  public constructor(message: string) {
    super(message);
    this.name = 'ControlCenterRuleError';
  }
}

export interface LifecycleTransitionCommand {
  readonly from: ClientLifecycleState;
  readonly to: ClientLifecycleState;
  readonly reason: string;
  readonly actorId: string;
}

export interface LifecycleTransitionDecision {
  readonly from: ClientLifecycleState;
  readonly to: ClientLifecycleState;
  readonly reason: string;
  readonly actorId: string;
  readonly approvalRequired: boolean;
  readonly access: SoftwareAccess;
  readonly subscriberNetworkCommands: readonly never[];
}

export function decideLifecycleTransition(
  command: LifecycleTransitionCommand,
): LifecycleTransitionDecision {
  if (!lifecycleTransitions[command.from].includes(command.to)) {
    throw new ControlCenterRuleError(
      `Invalid client lifecycle transition: ${command.from} -> ${command.to}.`,
    );
  }
  const reason = command.reason.trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new ControlCenterRuleError(
      'A transition reason between 8 and 500 characters is required.',
    );
  }
  return {
    from: command.from,
    to: command.to,
    reason,
    actorId: command.actorId,
    approvalRequired:
      approvalRequiredStates.has(command.to) ||
      ((command.from === 'restricted' || command.from === 'terminated') && command.to === 'active'),
    access: controlSoftwareAccessFor(command.to),
    subscriberNetworkCommands: [],
  };
}

export interface LifecycleApprovalCommand {
  readonly requesterId: string;
  readonly approverId: string;
  readonly approvalReason: string;
  readonly approverMfaVerifiedAt?: Date;
  readonly now: Date;
}

/** Validate the separate authenticated action that approves a high-risk transition request. */
export function decideLifecycleApproval(command: LifecycleApprovalCommand): Readonly<{
  approverId: string;
  approvalReason: string;
}> {
  if (command.requesterId === command.approverId) {
    throw new ControlCenterRuleError('The transition requester cannot approve their own action.');
  }
  const reason = command.approvalReason.trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new ControlCenterRuleError(
      'An approval reason between 8 and 500 characters is required.',
    );
  }
  if (!command.approverMfaVerifiedAt) {
    throw new ControlCenterRuleError('Fresh MFA verification is required to approve this action.');
  }
  const age = command.now.getTime() - command.approverMfaVerifiedAt.getTime();
  if (age < 0 || age > 10 * 60 * 1000) {
    throw new ControlCenterRuleError('MFA verification must be no more than ten minutes old.');
  }
  return Object.freeze({ approverId: command.approverId, approvalReason: reason });
}

export function controlSoftwareAccessFor(state: ClientLifecycleState): SoftwareAccess {
  if (state === 'trial' || state === 'active' || state === 'grace') return 'full';
  if (state === 'restricted' || state === 'terminated') return 'recovery';
  return 'none';
}

export interface ClientContactInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly role: 'primary' | 'billing' | 'technical' | 'legal';
  readonly preferredLocale: 'en' | 'ar';
}

export function normalizeClientContact(input: ClientContactInput): ClientContactInput {
  const name = input.name.trim();
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.replace(/[\s()-]/g, '');
  if (name.length < 2 || name.length > 120) {
    throw new ControlCenterRuleError('Contact name must contain 2 to 120 characters.');
  }
  if (!email && !phone) {
    throw new ControlCenterRuleError('A contact requires an email address or phone number.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ControlCenterRuleError('The contact email address is invalid.');
  }
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new ControlCenterRuleError('The contact phone number is invalid.');
  }
  return {
    ...input,
    name,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

export interface PackageVersionInput {
  readonly packageKey: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly entitlements: readonly string[];
  readonly priceMinor: number;
  readonly currency: ControlCenterCurrency;
  readonly effectiveFrom: Date;
  readonly effectiveUntil?: Date;
}

export function validatePackageVersion(input: PackageVersionInput): Readonly<PackageVersionInput> {
  if (!/^[a-z][a-z0-9_-]{2,49}$/.test(input.packageKey)) {
    throw new ControlCenterRuleError('Package key must be a stable lowercase identifier.');
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new ControlCenterRuleError('Package version must be a positive integer.');
  }
  if (!input.nameEn.trim() || !input.nameAr.trim()) {
    throw new ControlCenterRuleError('Package names are required in English and Arabic.');
  }
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) {
    throw new ControlCenterRuleError('Package price must be a non-negative safe integer.');
  }
  const entitlements = [...new Set(input.entitlements.map((value) => value.trim()))];
  if (
    !entitlements.length ||
    entitlements.some((value) => !/^[a-z][a-z0-9_.-]{2,99}$/.test(value))
  ) {
    throw new ControlCenterRuleError('At least one valid entitlement is required.');
  }
  if (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom) {
    throw new ControlCenterRuleError('Package end time must follow its start time.');
  }
  return Object.freeze({ ...input, entitlements: Object.freeze(entitlements) });
}

export interface PlatformMoneyInput {
  readonly amountMinor: number;
  readonly currency: ControlCenterCurrency;
}

export function assertPlatformMoney(input: PlatformMoneyInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ControlCenterRuleError('A posted platform amount must be a positive safe integer.');
  }
}

export function assertSameCurrency(left: PlatformMoneyInput, right: PlatformMoneyInput): void {
  assertPlatformMoney(left);
  assertPlatformMoney(right);
  if (left.currency !== right.currency) {
    throw new ControlCenterRuleError('USD and LBP platform amounts cannot be allocated together.');
  }
}

export interface ClientDrilldownFilters {
  readonly states?: readonly ClientLifecycleState[];
  readonly packageKeys?: readonly string[];
  readonly deploymentHealth?: readonly ('healthy' | 'attention' | 'blocked')[];
  readonly supportStatus?: readonly ('clear' | 'open' | 'escalated')[];
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function normalizeDrilldownFilters(filters: ClientDrilldownFilters): ClientDrilldownFilters {
  const limit = filters.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ControlCenterRuleError('Drill-down limit must be between 1 and 100.');
  }
  const query = filters.query?.trim();
  if (query && query.length > 120) {
    throw new ControlCenterRuleError('Drill-down search is limited to 120 characters.');
  }
  return {
    ...(filters.states ? { states: [...new Set(filters.states)] } : {}),
    ...(filters.packageKeys ? { packageKeys: [...new Set(filters.packageKeys)] } : {}),
    ...(filters.deploymentHealth
      ? { deploymentHealth: [...new Set(filters.deploymentHealth)] }
      : {}),
    ...(filters.supportStatus ? { supportStatus: [...new Set(filters.supportStatus)] } : {}),
    ...(query ? { query } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    limit,
  };
}
