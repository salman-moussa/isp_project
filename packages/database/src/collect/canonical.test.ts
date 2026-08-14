import { describe, expect, it } from 'vitest';
import { canonicalJson, collectPayloadHash, safeCollectInteger } from './canonical.js';

describe('Collect canonical operation evidence', () => {
  it('hashes equivalent object key order identically and changed money differently', () => {
    const left = { type: 'payment.create', payload: { currency: 'USD', amountMinor: 1000 } };
    const right = { payload: { amountMinor: 1000, currency: 'USD' }, type: 'payment.create' };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(collectPayloadHash(left)).toBe(collectPayloadHash(right));
    expect(collectPayloadHash(left)).not.toBe(
      collectPayloadHash({ ...left, payload: { ...left.payload, amountMinor: 1001 } }),
    );
  });

  it('rejects database integers outside the JavaScript safe range', () => {
    expect(safeCollectInteger('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => safeCollectInteger('9007199254740992')).toThrow(RangeError);
  });
});
