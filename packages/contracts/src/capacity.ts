import { z } from 'zod';

// Capacity and upstream management: a register of upstream circuits with committed and burst
// capacity, cost per currency and contract dates; append-only utilisation samples; derived
// utilisation, headroom, saturation risk, a linear forecast and renewals due.

export const circuitKindSchema = z.enum([
  'transit',
  'peering',
  'ogero_dsl',
  'ogero_fiber',
  'wireless_backhaul',
  'leased_line',
  'other',
]);
export const circuitStatusSchema = z.enum(['planned', 'active', 'decommissioned']);

export const upsertCircuitSchema = z
  .object({
    action: z.literal('upsert_circuit'),
    circuitId: z.uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    code: z.string().trim().min(2).max(40).optional(),
    provider: z.string().trim().min(1).max(160).optional(),
    kind: circuitKindSchema.optional(),
    pop: z.string().trim().min(1).max(120).optional(),
    branchId: z.uuid().nullable().optional(),
    committedMbps: z.number().int().positive().max(1_000_000).optional(),
    burstMbps: z.number().int().positive().max(1_000_000).nullable().optional(),
    monthlyCostMinor: z.number().int().nonnegative().safe().optional(),
    currency: z.enum(['USD', 'LBP']).optional(),
    contractStart: z.iso.date().nullable().optional(),
    contractEnd: z.iso.date().nullable().optional(),
    renewalNoticeDays: z.number().int().min(0).max(730).optional(),
    slaAvailabilityPct: z.number().min(0).max(100).nullable().optional(),
    status: circuitStatusSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const recordSamplesSchema = z
  .object({
    action: z.literal('record_samples'),
    circuitId: z.uuid(),
    source: z.enum(['manual', 'import']).default('manual'),
    samples: z
      .array(
        z
          .object({
            sampledAt: z.iso.datetime({ offset: true }),
            peakInMbps: z.number().nonnegative(),
            peakOutMbps: z.number().nonnegative(),
            avgInMbps: z.number().nonnegative().optional(),
            avgOutMbps: z.number().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const capacityCommandSchema = z.discriminatedUnion('action', [
  upsertCircuitSchema,
  recordSamplesSchema,
]);
export type CapacityCommand = z.infer<typeof capacityCommandSchema>;
export const capacityQuerySchema = z
  .object({ days: z.coerce.number().int().min(7).max(365).optional() })
  .strict();
export type CapacityQuery = z.infer<typeof capacityQuerySchema>;

export interface CircuitRecord {
  readonly id: string;
  readonly code: string;
  readonly provider: string;
  readonly kind: string;
  readonly pop: string;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly committedMbps: number;
  readonly burstMbps: number | null;
  readonly monthlyCostMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly contractStart: string | null;
  readonly contractEnd: string | null;
  readonly renewalNoticeDays: number;
  readonly slaAvailabilityPct: number | null;
  readonly status: 'planned' | 'active' | 'decommissioned';
  readonly notes: string | null;
  readonly version: number;
  readonly daysToContractEnd: number | null;
  readonly renewalDue: boolean;
  readonly latestSample: {
    readonly sampledAt: string;
    readonly peakInMbps: number;
    readonly peakOutMbps: number;
  } | null;
  readonly peakMbps: number | null;
  readonly samples: number;
  readonly utilisationPct: number | null;
  readonly headroomMbps: number | null;
  readonly risk: 'ok' | 'warning' | 'critical' | 'unknown' | 'none';
  readonly growthMbpsPerMonth: number | null;
  readonly monthsToSaturation: number | null;
  readonly trend: readonly { readonly sampledAt: string; readonly peakMbps: number }[];
}
export interface CapacityWorkspace {
  readonly asOf: string;
  readonly windowDays: number;
  readonly circuits: readonly CircuitRecord[];
  readonly cost: readonly {
    readonly currency: 'USD' | 'LBP';
    readonly monthlyMinor: number;
    readonly circuits: number;
  }[];
  readonly totals: {
    readonly committedMbps: number;
    readonly active: number;
    readonly planned: number;
    readonly decommissioned: number;
  };
  readonly branches: readonly {
    readonly id: string;
    readonly nameEn: string;
    readonly nameAr: string;
  }[];
}
