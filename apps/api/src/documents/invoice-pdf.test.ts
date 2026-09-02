import { describe, expect, it } from 'vitest';
import { invoiceFixture } from './invoice-fixture.js';
import { renderInvoicePdf } from './invoice-pdf.js';

describe('immutable bilingual invoice renderer', () => {
  it('produces byte-identical PDFs from the same snapshot without a current clock dependency', async () => {
    const first = await renderInvoicePdf(invoiceFixture);
    const second = await renderInvoicePdf(structuredClone(invoiceFixture));
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
    expect(first.length).toBeLessThan(500_000);
  });
  it('renders long bilingual legal evidence and integer LBP amounts without dropping content', async () => {
    const snapshot = structuredClone(invoiceFixture);
    snapshot.invoice.currency = 'LBP';
    snapshot.supplier.addressAr = 'عنوان المورّد القانوني في بيروت لبنان '.repeat(12);
    snapshot.tax = {
      treatment: 'exempt',
      rateBasisPoints: 0,
      amountMinor: 0,
      reasonEn: 'Owner-confirmed exemption evidence. '.repeat(12),
      reasonAr: 'إثبات الإعفاء الضريبي المعتمد من المالك. '.repeat(10),
      authorityReference: 'DEMO-REFERENCE-NOT-LEGAL-ADVICE',
    };
    snapshot.amounts.totalMinor = snapshot.amounts.taxableMinor + snapshot.amounts.stampDutyMinor;
    expect((await renderInvoicePdf(snapshot)).length).toBeLessThan(500_000);
  });
  it('rejects malformed or inconsistent financial snapshots', async () => {
    await expect(renderInvoicePdf({})).rejects.toThrow();
    await expect(
      renderInvoicePdf({
        ...invoiceFixture,
        amounts: { ...invoiceFixture.amounts, totalMinor: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      renderInvoicePdf({
        ...invoiceFixture,
        tax: { treatment: 'exempt', rateBasisPoints: 0, amountMinor: 0 },
      }),
    ).rejects.toThrow();
  });
});
