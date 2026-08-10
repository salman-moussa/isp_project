import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const errorResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
} as const;

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

export const tenantSummaryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'asOf', 'activeSubscribers', 'onlineSubscribers', 'collections'],
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    asOf: { type: 'string', format: 'date-time' },
    activeSubscribers: { type: 'integer', minimum: 0 },
    onlineSubscribers: { type: 'integer', minimum: 0 },
    collections: {
      type: 'object',
      additionalProperties: false,
      required: ['USD', 'LBP'],
      properties: {
        USD: { type: 'integer' },
        LBP: { type: 'integer' },
      },
    },
  },
} as const;

export type TenantSummary = z.infer<typeof tenantSummarySchema>;
