import { describe, expect, it } from 'vitest';
import { moneySchema, sessionClaimsSchema } from './index.js';

describe('shared security and money contracts', () => {
  it('rejects a tenant session without a tenant context', () => {
    const result = sessionClaimsSchema.safeParse({
      sub: 'user-1',
      sessionId: 'session-1',
      audience: 'tenant',
      permissions: [],
    });
    expect(result.success).toBe(false);
  });

  it('keeps currency explicit', () => {
    expect(moneySchema.parse({ amountMinor: 15_000, currency: 'LBP' })).toEqual({
      amountMinor: 15_000,
      currency: 'LBP',
    });
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'EUR' }).success).toBe(false);
  });
});
