import { z } from 'zod';

export const supportedCurrencies = ['USD', 'LBP'] as const;
export type SupportedCurrency = (typeof supportedCurrencies)[number];

export const moneySchema = z.object({
  amountMinor: z.number().int().safe(),
  currency: z.enum(supportedCurrencies),
});

export type Money = z.infer<typeof moneySchema>;

export const exchangeBasisSchema = z.object({
  fromCurrency: z.enum(supportedCurrencies),
  toCurrency: z.enum(supportedCurrencies),
  numerator: z.number().int().positive().safe(),
  denominator: z.number().int().positive().safe(),
  authorizedBy: z.string().min(1),
  reason: z.string().min(8),
  effectiveAt: z.string().datetime({ offset: true }),
});
