import { z } from 'zod';

const minor = z.number().int().nonnegative().safe();
const common = {
  documentNumber: z.string().trim().min(1).max(100),
  reasonEn: z.string().trim().min(8).max(500),
  reasonAr: z.string().trim().min(8).max(500),
};
const reversal = { ...common, sourceEntryId: z.uuid() };
export const customerAccountSchemas = {
  credit_note: z
    .object({
      ...common,
      subscriberId: z.uuid(),
      invoiceId: z.uuid(),
      currency: z.enum(['USD', 'LBP']),
      netMinor: minor,
      vatMinor: minor,
      stampMinor: minor,
    })
    .strict()
    .refine(
      (v) =>
        Number.isSafeInteger(v.netMinor + v.vatMinor + v.stampMinor) &&
        v.netMinor + v.vatMinor + v.stampMinor > 0,
      'Credit must be a positive safe integer amount.',
    ),
  credit_reversal: z.object(reversal).strict(),
  deposit_received: z
    .object({
      ...common,
      subscriberId: z.uuid(),
      currency: z.enum(['USD', 'LBP']),
      amountMinor: minor.positive(),
      sourceReference: z.string().trim().min(3).max(200),
    })
    .strict(),
  deposit_applied: z
    .object({
      ...common,
      sourceEntryId: z.uuid(),
      invoiceId: z.uuid(),
      amountMinor: minor.positive(),
    })
    .strict(),
  deposit_application_reversal: z.object(reversal).strict(),
  deposit_reversal: z.object(reversal).strict(),
};
export type CustomerAccountKind = keyof typeof customerAccountSchemas;
export type CustomerAccountCommand = {
  [K in CustomerAccountKind]: { readonly kind: K } & z.infer<(typeof customerAccountSchemas)[K]>;
}[CustomerAccountKind];
export interface CustomerAccountEntry {
  readonly id: string;
  readonly subscriberId: string;
  readonly kind: CustomerAccountKind;
  readonly documentNumber: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly postedAt: string;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly actorId: string;
  readonly invoiceId: string | null;
  readonly sourceEntryId: string | null;
  readonly reversesEntryId: string | null;
  readonly reversed: boolean;
  readonly availableMinor: number | null;
}
export interface CustomerAccountsWorkspace {
  readonly subscribers: readonly { readonly id: string; readonly name: string }[];
  readonly invoices: readonly {
    readonly id: string;
    readonly subscriberId: string;
    readonly documentNumber: string;
    readonly currency: 'USD' | 'LBP';
    readonly outstandingMinor: number;
    readonly creditedMinor: number;
    readonly netRemainingMinor: number;
    readonly vatRemainingMinor: number;
    readonly stampRemainingMinor: number;
  }[];
  readonly entries: readonly CustomerAccountEntry[];
}
