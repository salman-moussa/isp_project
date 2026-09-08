import { z } from 'zod';

export const dealerRecordSchema = z.object({
  id: z.string().uuid(),
  dealerCode: z.string().trim().min(2).max(50),
  dealerName: z.string().trim().min(2).max(150),
  contactPhone: z.string().trim().min(3).max(40),
  creditLimitMinorUsd: z.number().int().nonnegative(),
  creditLimitMinorLbp: z.number().int().nonnegative(),
  commissionRateBps: z.number().int().min(0).max(5000),
  active: z.boolean(),
});
export type DealerRecord = z.infer<typeof dealerRecordSchema>;

export const voucherBatchInputSchema = z.object({
  batchNumber: z.string().trim().min(2).max(80),
  dealerId: z.string().uuid().optional(),
  faceValueMinor: z.number().int().positive(),
  currency: z.enum(['USD', 'LBP']),
  quantity: z.number().int().min(1).max(10000),
});
export type VoucherBatchInput = z.infer<typeof voucherBatchInputSchema>;

export const voucherRedeemInputSchema = z.object({
  serialNumber: z.string().trim().min(4).max(100),
  pinCode: z.string().trim().min(4).max(50),
  subscriberId: z.string().uuid(),
});
export type VoucherRedeemInput = z.infer<typeof voucherRedeemInputSchema>;
