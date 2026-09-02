import { z } from 'zod';

export const accountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const accountCurrencySchema = z.enum(['USD', 'LBP', 'ANY']);
export type AccountCurrency = z.infer<typeof accountCurrencySchema>;

export const periodStatusSchema = z.enum(['open', 'soft_closed', 'hard_closed']);
export type PeriodStatus = z.infer<typeof periodStatusSchema>;

export const chartOfAccountSchema = z.object({
  id: z.string().uuid(),
  accountCode: z.string().trim().min(3).max(20),
  accountNameEn: z.string().trim().min(3).max(150),
  accountNameAr: z.string().trim().min(3).max(150),
  accountType: accountTypeSchema,
  currency: accountCurrencySchema,
  isSystem: z.boolean(),
  active: z.boolean(),
});
export type ChartOfAccountRecord = z.infer<typeof chartOfAccountSchema>;

export const journalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  debitMinor: z.number().int().nonnegative().safe(),
  creditMinor: z.number().int().nonnegative().safe(),
  currency: z.enum(['USD', 'LBP']),
  memoEn: z.string().trim().max(300).optional(),
  memoAr: z.string().trim().max(300).optional(),
});
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalEntryInputSchema = z
  .object({
    entryNumber: z.string().trim().min(1).max(100),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    descriptionEn: z.string().trim().min(5).max(500),
    descriptionAr: z.string().trim().min(5).max(500),
    sourceType: z.enum(['invoice', 'payment', 'credit_note', 'deposit', 'expense', 'manual', 'close']),
    sourceId: z.string().uuid().optional(),
    lines: z.array(journalLineInputSchema).min(2),
  })
  .refine((data) => {
    let usdDebit = 0;
    let usdCredit = 0;
    let lbpDebit = 0;
    let lbpCredit = 0;

    for (const line of data.lines) {
      if (line.currency === 'USD') {
        usdDebit += line.debitMinor;
        usdCredit += line.creditMinor;
      } else {
        lbpDebit += line.debitMinor;
        lbpCredit += line.creditMinor;
      }
    }

    return (
      Number.isSafeInteger(usdDebit) &&
      Number.isSafeInteger(usdCredit) &&
      Number.isSafeInteger(lbpDebit) &&
      Number.isSafeInteger(lbpCredit) &&
      usdDebit === usdCredit &&
      lbpDebit === lbpCredit &&
      (usdDebit > 0 || lbpDebit > 0)
    );
  }, 'Journal entry debits must equal credits per currency and must be greater than zero.');
export type JournalEntryInput = z.infer<typeof journalEntryInputSchema>;

export interface JournalEntryRecord {
  readonly id: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly status: 'posted' | 'reversed';
  readonly postedAt: string;
  readonly postedBy: string;
  readonly lines: readonly {
    readonly id: string;
    readonly accountId: string;
    readonly accountCode: string;
    readonly accountNameEn: string;
    readonly accountNameAr: string;
    readonly debitMinor: number;
    readonly creditMinor: number;
    readonly currency: 'USD' | 'LBP';
    readonly memoEn: string | null;
    readonly memoAr: string | null;
  }[];
}

export const customerStatementQuerySchema = z.object({
  subscriberId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.enum(['USD', 'LBP']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CustomerStatementQuery = z.infer<typeof customerStatementQuerySchema>;

export interface CustomerStatementEntry {
  readonly id: string;
  readonly date: string;
  readonly type: 'invoice' | 'payment' | 'credit_note' | 'deposit' | 'reversal';
  readonly documentNumber: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly runningBalanceMinor: number;
  readonly currency: 'USD' | 'LBP';
}

export interface CustomerStatementResponse {
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly currency: 'USD' | 'LBP';
  readonly startDate: string;
  readonly endDate: string;
  readonly openingBalanceMinor: number;
  readonly closingBalanceMinor: number;
  readonly totalDebitsMinor: number;
  readonly totalCreditsMinor: number;
  readonly entries: readonly CustomerStatementEntry[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface TrialBalanceAccount {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountNameEn: string;
  readonly accountNameAr: string;
  readonly accountType: AccountType;
  readonly debitMinorUsd: number;
  readonly creditMinorUsd: number;
  readonly debitMinorLbp: number;
  readonly creditMinorLbp: number;
  readonly netBalanceMinorUsd: number;
  readonly netBalanceMinorLbp: number;
}

export interface TrialBalanceResponse {
  readonly asOfDate: string;
  readonly accounts: readonly TrialBalanceAccount[];
  readonly totalDebitUsd: number;
  readonly totalCreditUsd: number;
  readonly totalDebitLbp: number;
  readonly totalCreditLbp: number;
}

export interface PeriodCloseRequest {
  readonly periodName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly closeType: 'soft' | 'hard';
  readonly notesEn: string;
  readonly notesAr: string;
}

export interface AccountingPeriodRecord {
  readonly id: string;
  readonly periodName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: PeriodStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
}
