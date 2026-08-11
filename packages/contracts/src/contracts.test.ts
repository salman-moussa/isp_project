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

  it('rejects tenant sessions without a membership authorization version', () => {
    const result = sessionClaimsSchema.safeParse({
      sub: 'user-1',
      sessionId: 'session-1',
      audience: 'tenant',
      tenantId: '00000000-0000-4000-8000-000000000001',
      permissions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a platform session that tries to claim tenant scope without a support grant', () => {
    const result = sessionClaimsSchema.safeParse({
      sub: 'platform-user-1',
      sessionId: 'session-1',
      audience: 'platform',
      tenantId: '00000000-0000-4000-8000-000000000001',
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
