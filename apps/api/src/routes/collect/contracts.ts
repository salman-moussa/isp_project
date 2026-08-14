import { z } from 'zod';

const uuid = z.uuid();
const currency = z.enum(['USD', 'LBP']);

export const collectAuthorizeBody = z
  .object({
    deviceLabel: z.string().trim().min(1).max(120),
    devicePublicKeyThumbprint: z.string().trim().min(16).max(200),
  })
  .strict();

export const collectRefreshBody = z
  .object({
    refreshToken: z.string().regex(/^orvex_collect_r1\.[A-Za-z0-9_-]{43}$/),
  })
  .strict();

const paymentOperation = z
  .object({
    operationId: uuid,
    sequence: z.number().int().positive().safe(),
    type: z.literal('payment.create'),
    payload: z
      .object({
        assignmentId: uuid,
        amountMinor: z.number().int().positive().safe(),
        currency,
        clientRecordedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
const reconciliationOperation = z
  .object({
    operationId: uuid,
    sequence: z.number().int().positive().safe(),
    type: z.literal('reconciliation.submit'),
    payload: z
      .object({
        routeId: uuid,
        businessDate: z.iso.date(),
        declaredAmountMinor: z.number().int().nonnegative().safe(),
        currency,
      })
      .strict(),
  })
  .strict();
const printOperation = z
  .object({
    operationId: uuid,
    sequence: z.number().int().positive().safe(),
    type: z.literal('receipt.print.audit'),
    payload: z
      .object({
        assignmentId: uuid,
        paymentId: uuid,
        printerReference: z.string().trim().min(1).max(200),
        copyKind: z.enum(['original', 'duplicate']),
      })
      .strict(),
  })
  .strict();
export const collectSyncBody = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion('type', [paymentOperation, reconciliationOperation, printOperation]),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const collectDeltaQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().safe().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const collectApprovalBody = z
  .object({ reason: z.string().trim().min(8).max(1000) })
  .strict();
export const collectTenantParams = z.object({ tenantId: uuid });
export const collectApprovalParams = collectTenantParams.extend({ reconciliationId: uuid });
export const collectIdempotencyHeaders = z.object({
  'idempotency-key': z.string().trim().min(8).max(200),
});
