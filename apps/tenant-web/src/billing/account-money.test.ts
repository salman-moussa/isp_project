import { describe, expect, it } from 'vitest';
import { parseAccountAmount } from './account-money';
describe('account amount parsing', () => {
  it('converts decimal USD without floating-point multiplication', () => {
    expect(parseAccountAmount('0.29', 'USD')).toBe(29);
    expect(parseAccountAmount('12.1', 'USD')).toBe(1210);
    expect(parseAccountAmount('89500', 'LBP')).toBe(89500);
  });
  it.each(['1e3', '-1', '0.001', 'NaN', '1,000', '9007199254740992', ''])(
    'rejects unsafe amount %s',
    (value) => {
      expect(() => parseAccountAmount(value, 'USD')).toThrow();
    },
  );
  it('rejects fractional LBP', () => expect(() => parseAccountAmount('1.5', 'LBP')).toThrow());
});
