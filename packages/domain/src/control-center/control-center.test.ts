import { describe, expect, it } from 'vitest';
import {
  ControlCenterRuleError,
  assertSameCurrency,
  decideLifecycleApproval,
  decideLifecycleTransition,
  normalizeClientContact,
  normalizeDrilldownFilters,
  controlSoftwareAccessFor,
  validatePackageVersion,
} from './index.js';

describe('Control Center domain', () => {
  it('makes destructive transitions pending and requires later independent MFA approval', () => {
    expect(
      decideLifecycleTransition({
        from: 'active',
        to: 'restricted',
        reason: 'Payment review is required',
        actorId: 'operator-a',
      }).approvalRequired,
    ).toBe(true);
    expect(() =>
      decideLifecycleApproval({
        requesterId: 'operator-a',
        approverId: 'operator-a',
        approvalReason: 'Reviewed evidence',
        approverMfaVerifiedAt: new Date('2026-08-11T11:55:00Z'),
        now: new Date('2026-08-11T12:00:00Z'),
      }),
    ).toThrow('cannot approve');
    expect(
      decideLifecycleApproval({
        requesterId: 'operator-a',
        approverId: 'manager-b',
        approvalReason: 'Reviewed evidence',
        approverMfaVerifiedAt: new Date('2026-08-11T11:55:00Z'),
        now: new Date('2026-08-11T12:00:00Z'),
      }),
    ).toMatchObject({ approverId: 'manager-b' });
  });

  it('returns software access but no subscriber network command', () => {
    const result = decideLifecycleTransition({
      from: 'active',
      to: 'restricted',
      reason: 'Platform invoice is overdue',
      actorId: 'operator-a',
    });
    expect(result.access).toBe('recovery');
    expect(result.subscriberNetworkCommands).toEqual([]);
    expect(controlSoftwareAccessFor('active')).toBe('full');
  });

  it('requires separate approval when restoring restricted or terminated access', () => {
    expect(
      decideLifecycleTransition({
        from: 'restricted',
        to: 'active',
        reason: 'Account review completed',
        actorId: 'operator-a',
      }).approvalRequired,
    ).toBe(true);
  });

  it('rejects invalid and terminal archived transitions', () => {
    expect(() =>
      decideLifecycleTransition({
        from: 'archived',
        to: 'active',
        reason: 'Attempt restoration',
        actorId: 'operator-a',
      }),
    ).toThrow(ControlCenterRuleError);
  });

  it('normalizes bilingual contact channels', () => {
    expect(
      normalizeClientContact({
        name: '  Rami Haddad ',
        email: ' SALES@EXAMPLE.COM ',
        phone: '+961 (3) 123-456',
        role: 'primary',
        preferredLocale: 'ar',
      }),
    ).toMatchObject({
      name: 'Rami Haddad',
      email: 'sales@example.com',
      phone: '+9613123456',
    });
  });

  it('requires immutable package identity, bilingual names, and unique entitlements', () => {
    const version = validatePackageVersion({
      packageKey: 'isp_pro',
      version: 2,
      nameEn: 'ISP Pro',
      nameAr: 'مزود محترف',
      entitlements: ['billing.post', 'billing.post', 'network.view'],
      priceMinor: 50_00,
      currency: 'USD',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    expect(version.entitlements).toEqual(['billing.post', 'network.view']);
    expect(Object.isFrozen(version)).toBe(true);
  });

  it('never mixes USD and LBP allocations', () => {
    expect(() =>
      assertSameCurrency(
        { amountMinor: 100, currency: 'USD' },
        { amountMinor: 100_000, currency: 'LBP' },
      ),
    ).toThrow('cannot be allocated together');
  });

  it('deduplicates task filters and bounds pagination', () => {
    expect(
      normalizeDrilldownFilters({ states: ['active', 'active'], query: '  north  ', limit: 25 }),
    ).toMatchObject({ states: ['active'], query: 'north', limit: 25 });
    expect(() => normalizeDrilldownFilters({ limit: 101 })).toThrow(ControlCenterRuleError);
  });
});
