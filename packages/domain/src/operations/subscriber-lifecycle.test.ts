import { describe, expect, it } from 'vitest';
import { deriveCollectorReconciliation, prepareInvoiceAmounts } from './billing.js';
import {
  assertInstallationTransition,
  assertNetworkActionAllowed,
  assertServiceTransition,
} from './subscriber-lifecycle.js';

describe('operations domain rules', () => {
  it('allows the focused installation path and rejects skipped activation readiness', () => {
    expect(() => assertInstallationTransition('requested', 'scheduled')).not.toThrow();
    expect(() => assertInstallationTransition('in_progress', 'completed')).toThrow(
      /Invalid installation transition/,
    );
  });

  it('makes terminated subscriber services terminal', () => {
    expect(() => assertServiceTransition('terminated', 'active')).toThrow();
  });

  it('does not convert platform restriction into subscriber network work', () => {
    expect(() => assertNetworkActionAllowed('restricted')).toThrow(/forbids enqueuing/);
    expect(() => assertNetworkActionAllowed('active')).not.toThrow();
  });

  it('uses only the effective versioned VAT and rounding policy', () => {
    expect(
      prepareInvoiceAmounts({
        amountMinor: 10_000,
        currency: 'USD',
        billingDate: new Date('2026-08-05T00:00:00Z'),
        periodStart: new Date('2026-08-01T00:00:00Z'),
        periodEnd: new Date('2026-09-01T00:00:00Z'),
        policy: {
          id: 'policy-a',
          vatRateBasisPoints: 1_100,
          roundingMode: 'half_up',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      }),
    ).toEqual({
      subtotalMinor: 10_000,
      vatMinor: 1_100,
      totalMinor: 11_100,
      currency: 'USD',
      billingPolicyId: 'policy-a',
    });
  });

  it('derives collector totals from assignments and posted evidence by currency', () => {
    expect(
      deriveCollectorReconciliation(
        'LBP',
        [
          { amountMinor: 12_000_000, currency: 'LBP' },
          { amountMinor: 50_00, currency: 'USD' },
        ],
        [{ amountMinor: 11_500_000, currency: 'LBP' }],
      ),
    ).toEqual({
      currency: 'LBP',
      expectedMinor: 12_000_000,
      declaredMinor: 11_500_000,
      differenceMinor: -500_000,
    });
  });
});
