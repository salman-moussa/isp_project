import { describe, expect, it } from 'vitest';
import {
  journalEntryInputSchema,
  customerStatementQuerySchema,
  periodCloseRequestSchema,
} from './accounting.js';
const line = {
  accountId: '10000000-0000-4000-8000-000000000001',
  debitMinor: 100,
  creditMinor: 0,
  currency: 'USD',
};
const entry = {
  entryNumber: 'MAN-1',
  entryDate: '2026-09-02',
  descriptionEn: 'Documented manual entry',
  descriptionAr: 'قيد يدوي موثق بالكامل',
  sourceType: 'manual',
  lines: [line, { ...line, debitMinor: 0, creditMinor: 100 }],
};
describe('accounting input integrity', () => {
  it('accepts balanced manual entries', () =>
    expect(journalEntryInputSchema.safeParse(entry).success).toBe(true));
  it.each([
    { sourceType: 'invoice' },
    { entryDate: '2026-02-30' },
    {
      lines: [
        { ...line, debitMinor: 100, creditMinor: 100 },
        { ...line, debitMinor: 0, creditMinor: 0 },
      ],
    },
    { lines: [line, { ...line, debitMinor: 0, creditMinor: 99 }] },
    { lines: [line, { ...line, debitMinor: 0, creditMinor: 100, currency: 'LBP' }] },
    {
      lines: [
        { ...line, debitMinor: Number.MAX_SAFE_INTEGER },
        line,
        { ...line, debitMinor: 0, creditMinor: Number.MAX_SAFE_INTEGER },
        { ...line, debitMinor: 0, creditMinor: 100 },
      ],
    },
  ])('rejects invalid journal %j', (change) =>
    expect(journalEntryInputSchema.safeParse({ ...entry, ...change }).success).toBe(false),
  );
  it('validates statement dates and bounds paging', () => {
    expect(
      customerStatementQuerySchema.safeParse({
        subscriberId: line.accountId,
        startDate: '2026-09-03',
        endDate: '2026-09-02',
      }).success,
    ).toBe(false);
    expect(
      customerStatementQuerySchema.safeParse({
        subscriberId: line.accountId,
        page: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
  });
  it('requires valid ordered close dates and bilingual reasons', () => {
    const close = {
      periodName: 'September',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      closeType: 'hard',
      notesEn: 'Reviewed close request',
      notesAr: 'طلب إغلاق تمت مراجعته',
    };
    expect(periodCloseRequestSchema.safeParse(close).success).toBe(true);
    expect(periodCloseRequestSchema.safeParse({ ...close, startDate: '2026-10-01' }).success).toBe(
      false,
    );
    expect(periodCloseRequestSchema.safeParse({ ...close, notesAr: '' }).success).toBe(false);
  });
});
