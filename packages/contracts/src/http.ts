import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const tenantSummarySchema = z.object({
  tenantId: z.string(),
  asOf: z.string().datetime({ offset: true }),
  activeSubscribers: z.number().int().nonnegative(),
  onlineSubscribers: z.number().int().nonnegative(),
  collections: z.object({
    USD: z.number().int(),
    LBP: z.number().int(),
  }),
});

export type TenantSummary = z.infer<typeof tenantSummarySchema>;
