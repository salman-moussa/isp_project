import type { LegalInvoiceSnapshot } from './invoice-pdf.js';

/** Synthetic example only, never a Lebanese tax recommendation or real customer data. */
export const invoiceFixture: LegalInvoiceSnapshot = {
  version: 1,
  languages: ['en', 'ar'],
  retentionYears: 10,
  supplier: {
    nameEn: 'Cedar Network SAL',
    nameAr: 'شركة شبكة الأرز',
    addressEn: 'Hamra Street, Beirut, Lebanon',
    addressAr: 'شارع الحمرا، مبنى Block A-123، بيروت، لبنان',
    taxRegistrationNumber: 'DEMO-100001',
  },
  recipient: { name: 'Cedar Studio', address: 'Achrafieh, Beirut, Lebanon' },
  invoice: {
    serialNumber: 'DEMO-INV-2026-1001',
    issuedAt: '2026-09-02T08:00:00.000Z',
    currency: 'USD',
  },
  service: {
    number: 'SVC-1001',
    descriptionEn: 'Business fiber - monthly subscription',
    descriptionAr: 'اشتراك شهري بخدمة الألياف للشركات',
    periodStart: '2026-09-01',
    periodEnd: '2026-10-01',
  },
  amounts: {
    baseMinor: 15000,
    addonsMinor: 2000,
    overageMinor: 420,
    grossMinor: 17420,
    discountBasisPoints: 500,
    discountMinor: 871,
    taxableMinor: 16549,
    stampDutyMinor: 113,
    totalMinor: 18482,
  },
  tax: { treatment: 'taxable', rateBasisPoints: 1100, amountMinor: 1820 },
};
