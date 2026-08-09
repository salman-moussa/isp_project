import { describe, expect, it } from 'vitest';
import type { SessionClaims } from '@isp/contracts';
import {
  assertPlatformSubscriptionTransition,
  assertTenantContext,
  addMoney,
  softwareAccessFor,
} from './index.js';

const tenantClaims: SessionClaims = {
  sub: 'user-a',
  sessionId: 'session-a',
  audience: 'tenant',
  tenantId: 'tenant-a',
  permissions: ['tenant.dashboard.view'],
};

describe('domain invariants', () => {
  it('denies cross-tenant use', () => {
    expect(() => assertTenantContext(tenantClaims, 'tenant-b', new Date())).toThrow(
      'Cross-tenant access is denied.',
    );
  });

  it('does not silently combine currencies', () => {
    expect(() =>
      addMoney({ amountMinor: 10, currency: 'USD' }, { amountMinor: 895_000, currency: 'LBP' }),
    ).toThrow('explicit authorized exchange basis');
  });

  it('guards commercial transitions without returning a network action', () => {
    expect(() => assertPlatformSubscriptionTransition('active', 'archived')).toThrow();
    expect(softwareAccessFor('restricted')).toBe('recovery');
  });
});
