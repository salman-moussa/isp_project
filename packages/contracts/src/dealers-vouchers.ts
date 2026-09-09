import { z } from 'zod';

// Dealer and voucher channel: dealer registry, per-currency prepaid float, PIN voucher batches,
// guarded redemption and the subscriber credit that follows it. Money is integer minor units in
// one currency per record; USD and LBP never combine.

export const dealerCurrencySchema = z.enum(['USD', 'LBP']);
export const dealerTypeSchema = z.enum(['dealer', 'reseller', 'pos']);
export const dealerStatusSchema = z.enum(['active', 'suspended']);
export const voucherBatchStatusSchema = z.enum(['generated', 'issued', 'cancelled']);
export const voucherStatusSchema = z.enum(['created', 'issued', 'redeemed', 'cancelled']);

const minor = z.number().int().nonnegative().safe();
const reasons = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
};
const dealerFields = {
  dealerName: z.string().trim().min(2).max(150),
  dealerType: dealerTypeSchema,
  contactName: z.string().trim().max(150),
  contactPhone: z.string().trim().min(3).max(40),
  email: z.string().trim().email().max(200),
  branchId: z.uuid(),
  creditLimitMinorUsd: minor,
  creditLimitMinorLbp: minor,
  commissionRateBps: z.number().int().min(0).max(5000),
  notes: z.string().trim().max(2000),
};

export const registerDealerSchema = z
  .object({
    action: z.literal('register_dealer'),
    dealerCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,49}$/u, 'Use letters, digits, - or _.'),
    dealerName: dealerFields.dealerName,
    contactPhone: dealerFields.contactPhone,
    dealerType: dealerFields.dealerType.optional(),
    contactName: dealerFields.contactName.optional(),
    email: dealerFields.email.optional(),
    branchId: dealerFields.branchId.optional(),
    creditLimitMinorUsd: dealerFields.creditLimitMinorUsd.optional(),
    creditLimitMinorLbp: dealerFields.creditLimitMinorLbp.optional(),
    commissionRateBps: dealerFields.commissionRateBps.optional(),
    notes: dealerFields.notes.optional(),
    ...reasons,
  })
  .strict();

export const updateDealerSchema = z
  .object({
    action: z.literal('update_dealer'),
    dealerId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    dealerName: dealerFields.dealerName.optional(),
    contactPhone: dealerFields.contactPhone.optional(),
    dealerType: dealerFields.dealerType.optional(),
    contactName: dealerFields.contactName.optional(),
    email: dealerFields.email.optional(),
    branchId: dealerFields.branchId.nullable().optional(),
    creditLimitMinorUsd: dealerFields.creditLimitMinorUsd.optional(),
    creditLimitMinorLbp: dealerFields.creditLimitMinorLbp.optional(),
    commissionRateBps: dealerFields.commissionRateBps.optional(),
    status: dealerStatusSchema.optional(),
    notes: dealerFields.notes.optional(),
    ...reasons,
  })
  .strict();

export const recordDealerDepositSchema = z
  .object({
    action: z.literal('record_deposit'),
    dealerId: z.uuid(),
    currency: dealerCurrencySchema,
    amountMinor: minor.positive(),
    reference: z.string().trim().min(3).max(200),
    ...reasons,
  })
  .strict();

export const adjustDealerBalanceSchema = z
  .object({
    action: z.literal('adjust_balance'),
    dealerId: z.uuid(),
    currency: dealerCurrencySchema,
    amountMinor: z
      .number()
      .int()
      .safe()
      .refine((v) => v !== 0, 'An adjustment cannot be zero.'),
    reference: z.string().trim().min(3).max(200).optional(),
    ...reasons,
  })
  .strict();

export const generateVoucherBatchSchema = z
  .object({
    action: z.literal('generate_batch'),
    batchNumber: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/u, 'Use upper-case letters, digits and - only.'),
    faceValueMinor: minor.positive(),
    currency: dealerCurrencySchema,
    quantity: z.number().int().min(1).max(2000),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    ...reasons,
  })
  .strict();

export const issueVoucherBatchSchema = z
  .object({
    action: z.literal('issue_batch'),
    batchId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    dealerId: z.uuid(),
    ...reasons,
  })
  .strict();

export const cancelVoucherBatchSchema = z
  .object({
    action: z.literal('cancel_batch'),
    batchId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    ...reasons,
  })
  .strict();

export const dealerChannelCommandSchema = z.discriminatedUnion('action', [
  registerDealerSchema,
  updateDealerSchema,
  recordDealerDepositSchema,
  generateVoucherBatchSchema,
  issueVoucherBatchSchema,
  cancelVoucherBatchSchema,
]);
export type DealerChannelCommand = z.infer<typeof dealerChannelCommandSchema>;
export type AdjustDealerBalanceCommand = z.infer<typeof adjustDealerBalanceSchema>;

export const redeemVoucherSchema = z
  .object({
    serialNumber: z.string().trim().min(4).max(60),
    pin: z.string().regex(/^[0-9]{12}$/u, 'The PIN is twelve digits.'),
    subscriberId: z.uuid(),
    ...reasons,
  })
  .strict();
export type RedeemVoucherCommand = z.infer<typeof redeemVoucherSchema>;

export const retryVoucherCreditSchema = z
  .object({
    redemptionId: z.uuid(),
    ...reasons,
  })
  .strict();
export type RetryVoucherCreditCommand = z.infer<typeof retryVoucherCreditSchema>;

export interface DealerBalance {
  readonly currency: 'USD' | 'LBP';
  readonly balanceMinor: number;
  readonly creditLimitMinor: number;
  readonly availableMinor: number;
}

export interface DealerRecord {
  readonly id: string;
  readonly dealerCode: string;
  readonly dealerName: string;
  readonly dealerType: z.infer<typeof dealerTypeSchema>;
  readonly contactName: string | null;
  readonly contactPhone: string;
  readonly email: string | null;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly creditLimitMinorUsd: number;
  readonly creditLimitMinorLbp: number;
  readonly commissionRateBps: number;
  readonly status: z.infer<typeof dealerStatusSchema>;
  readonly notes: string | null;
  readonly version: number;
  readonly balances: readonly DealerBalance[];
  readonly issuedBatches: number;
  readonly redeemedVouchers: number;
}

export interface VoucherBatchRecord {
  readonly id: string;
  readonly batchNumber: string;
  readonly status: z.infer<typeof voucherBatchStatusSchema>;
  readonly dealerId: string | null;
  readonly dealerName: string | null;
  readonly faceValueMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly quantity: number;
  readonly issuedCount: number;
  readonly redeemedCount: number;
  readonly cancelledCount: number;
  readonly generatedAt: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly version: number;
}

export interface DealerLedgerEntry {
  readonly id: string;
  readonly dealerId: string;
  readonly dealerName: string;
  readonly entryKind: 'deposit' | 'batch_issue' | 'commission' | 'batch_cancel' | 'adjustment';
  readonly currency: 'USD' | 'LBP';
  readonly amountMinor: number;
  readonly balanceAfterMinor: number;
  readonly batchNumber: string | null;
  readonly reference: string | null;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly actorName: string;
  readonly createdAt: string;
}

export interface VoucherRedemptionRecord {
  readonly id: string;
  readonly serialNumber: string;
  readonly batchNumber: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly status: 'credit_pending' | 'credited';
  readonly accountEntryId: string | null;
  readonly redeemedAt: string;
  readonly creditedAt: string | null;
  readonly actorName: string;
}

export interface DealerWorkspace {
  readonly dealers: readonly DealerRecord[];
  readonly batches: readonly VoucherBatchRecord[];
  readonly ledger: readonly DealerLedgerEntry[];
  readonly redemptions: readonly VoucherRedemptionRecord[];
  readonly branches: readonly { id: string; nameEn: string; nameAr: string }[];
  readonly subscribers: readonly { id: string; name: string; subscriberNumber: string }[];
  readonly subscriberDirectoryTruncated: boolean;
  readonly summary: {
    readonly activeDealers: number;
    readonly issuedVouchersOutstanding: number;
    readonly pendingCredits: number;
    readonly floatUsdMinor: number;
    readonly floatLbpMinor: number;
  };
}

/** Returned once by batch generation; never persisted or replayed. */
export interface GeneratedVoucherPins {
  readonly batchId: string;
  readonly batchNumber: string;
  readonly pins: readonly { serialNumber: string; pin: string }[];
}
