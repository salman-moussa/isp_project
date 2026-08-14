import type { DurableNetworkStore } from './store.js';
import type { NetworkJob, NetworkJobRequest } from './domain.js';

export type NetworkIngressEvent =
  | {
      readonly type: 'tenant.service.network_action_requested';
      readonly request: NetworkJobRequest;
    }
  | {
      readonly type: 'platform.subscription.state_changed';
      readonly tenantId: string;
      readonly subscriptionState: 'active' | 'restricted' | 'suspended' | 'terminated';
      readonly eventId: string;
    };

export type NetworkIngressResult =
  | { readonly accepted: true; readonly job: NetworkJob }
  | {
      readonly accepted: false;
      readonly reason: 'platform_subscription_events_are_non_networking';
    };

export async function handleNetworkIngress(
  store: DurableNetworkStore,
  event: NetworkIngressEvent,
  now: Date,
): Promise<NetworkIngressResult> {
  if (event.type === 'platform.subscription.state_changed') {
    return { accepted: false, reason: 'platform_subscription_events_are_non_networking' };
  }
  return { accepted: true, job: await store.enqueue(event.request, now) };
}

// This exhaustive mapping is deliberately non-configurable. Platform commercial state may
// restrict the application, but it can never manufacture a subscriber RouterOS command.
export function eventCanEnqueueSubscriberNetworkWork(type: NetworkIngressEvent['type']): boolean {
  switch (type) {
    case 'tenant.service.network_action_requested':
      return true;
    case 'platform.subscription.state_changed':
      return false;
  }
}
