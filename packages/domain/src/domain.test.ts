import { describe, expect, it } from 'vitest';
import type { SessionClaims } from '@isp/contracts';
import {
  assertAllocationCurrency,
  assertExactReversal,
  assertPlatformSubscriptionTransition,
  assertPositiveMoney,
  assertTenantContext,
  addMoney,
  softwareAccessFor,
} from './index.js';

const tenantClaims: SessionClaims = {
  sub: 'user-a',
  sessionId: 'session-a',
  audience: 'tenant',
  tenantId: 'tenant-a',
  authorizationVersion: 1,
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

  it('rejects arithmetic that exceeds the safe integer range', () => {
    expect(() =>
      addMoney(
        { amountMinor: Number.MAX_SAFE_INTEGER, currency: 'USD' },
        { amountMinor: 1, currency: 'USD' },
      ),
    ).toThrow('safe integer range');
  });

  it('requires posted finance values to be positive safe integers', () => {
    expect(() => assertPositiveMoney({ amountMinor: 0, currency: 'USD' })).toThrow(
      'positive safe integer',
    );
    expect(() => assertPositiveMoney({ amountMinor: 1, currency: 'USD' })).not.toThrow();
  });

  it('does not allocate across USD and LBP documents', () => {
    expect(() =>
      assertAllocationCurrency(
        { amountMinor: 100, currency: 'USD' },
        { amountMinor: 100, currency: 'USD' },
        { amountMinor: 100, currency: 'LBP' },
      ),
    ).toThrow('same currency');
  });

  it('requires a reversal to exactly negate one original document', () => {
    expect(() =>
      assertExactReversal(
        { amountMinor: 100, currency: 'USD' },
        { amountMinor: 101, currency: 'USD' },
      ),
    ).toThrow('preserve the original');
  });

  it('guards commercial transitions without returning a network action', () => {
    expect(() => assertPlatformSubscriptionTransition('active', 'archived')).toThrow();
    expect(softwareAccessFor('restricted')).toBe('recovery');
  });
});
