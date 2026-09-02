import { describe, expect, it } from 'vitest';
import { customerAccountSchemas } from './customer-accounts.js';
const base = {
  documentNumber: 'CR-01',
  reasonEn: 'Correct duplicate charge',
  reasonAr: 'تصحيح مبلغ مكرر في الفاتورة',
  subscriberId: '10000000-0000-4000-8000-000000000001',
  invoiceId: '10000000-0000-4000-8000-000000000002',
  currency: 'USD',
  netMinor: 100,
  vatMinor: 11,
  stampMinor: 0,
};
describe('customer account input contracts', () => {
  it('accepts exact positive credit components', () =>
    expect(customerAccountSchemas.credit_note.parse(base).netMinor).toBe(100));
  it.each([
    { netMinor: -1 },
    { netMinor: 0, vatMinor: 0 },
    { netMinor: 0.1 },
    { netMinor: Number.MAX_SAFE_INTEGER, vatMinor: 1 },
    { currency: 'EUR' },
    { actorId: 'spoofed' },
    { reasonAr: 'short' },
  ])('rejects unsafe or forged credit input %j', (change) => {
    expect(customerAccountSchemas.credit_note.safeParse({ ...base, ...change }).success).toBe(
      false,
    );
  });
  it('never accepts a caller-provided reversal amount', () => {
    expect(
      customerAccountSchemas.credit_reversal.safeParse({
        documentNumber: 'REV-01',
        reasonEn: base.reasonEn,
        reasonAr: base.reasonAr,
        sourceEntryId: base.invoiceId,
        amountMinor: 1,
      }).success,
    ).toBe(false);
  });
});
