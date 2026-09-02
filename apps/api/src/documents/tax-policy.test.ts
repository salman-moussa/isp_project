import { describe, expect, it } from 'vitest';
import { operationsRequestSchemas } from '../routes/operations/tenant-operations.js';
const policy = {
  version: 1,
  vatRateBasisPoints: 1100,
  roundingMode: 'half_up',
  supplierNameEn: 'Cedar SAL',
  supplierNameAr: 'شركة الأرز',
  supplierAddressEn: 'Beirut, Lebanon',
  supplierAddressAr: 'بيروت، لبنان',
  supplierTaxRegistrationNumber: 'DEMO-1',
  stampDutyUsdMinor: 0,
  stampDutyLbpMinor: 0,
  retentionYears: 10,
  effectiveFrom: '2026-09-01',
  reason: 'Owner approved legal policy',
  taxTreatment: 'taxable',
};
describe('explicit tax treatment', () => {
  it('requires bilingual evidence and zero VAT for exemption or outside-scope policies', () => {
    const schema = operationsRequestSchemas.billingPolicyBody;
    expect(schema.safeParse(policy).success).toBe(true);
    for (const taxTreatment of ['exempt', 'out_of_scope']) {
      expect(schema.safeParse({ ...policy, taxTreatment }).success).toBe(false);
      const valid = {
        ...policy,
        taxTreatment,
        vatRateBasisPoints: 0,
        taxReasonEn: 'Owner-approved evidence',
        taxReasonAr: 'إثبات ضريبي معتمد',
        taxAuthorityReference: 'DEMO-REF',
      };
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse({ ...valid, taxReasonAr: undefined }).success).toBe(false);
      expect(schema.safeParse({ ...valid, vatRateBasisPoints: 1100 }).success).toBe(false);
      expect(schema.safeParse({ ...valid, taxTreatment: 'taxable' }).success).toBe(false);
    }
  });
});
