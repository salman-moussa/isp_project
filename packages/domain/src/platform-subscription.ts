export const platformSubscriptionStates = [
  'lead',
  'trial',
  'active',
  'grace',
  'restricted',
  'terminated',
  'archived',
] as const;

export type PlatformSubscriptionState = (typeof platformSubscriptionStates)[number];

const allowedTransitions: Readonly<
  Record<PlatformSubscriptionState, readonly PlatformSubscriptionState[]>
> = {
  lead: ['trial', 'active', 'archived'],
  trial: ['active', 'terminated', 'archived'],
  active: ['grace', 'restricted', 'terminated'],
  grace: ['active', 'restricted', 'terminated'],
  restricted: ['active', 'terminated'],
  terminated: ['active', 'archived'],
  archived: [],
};

export function assertPlatformSubscriptionTransition(
  from: PlatformSubscriptionState,
  to: PlatformSubscriptionState,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid platform subscription transition: ${from} -> ${to}`);
  }
}

/**
 * Commercial state intentionally has no subscriber/network side effect. Callers receive only the
 * software-access policy so this module cannot enqueue a MikroTik or subscriber action.
 */
export function softwareAccessFor(state: PlatformSubscriptionState): 'full' | 'recovery' | 'none' {
  if (state === 'active' || state === 'trial' || state === 'grace') return 'full';
  if (state === 'restricted' || state === 'terminated') return 'recovery';
  return 'none';
}
