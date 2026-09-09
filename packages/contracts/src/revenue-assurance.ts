import { z } from 'zod';

// Revenue assurance: leakage controls evaluated from the tenant's own records, persistent
// findings with an exposure per currency, and exposure cases with ownership and closure evidence.

export const assuranceControlCodes = [
  'ACTIVE_NOT_BILLED',
  'BILLED_AFTER_TERMINATION',
  'INVOICE_OVERDUE_60',
  'PAYMENT_UNALLOCATED_7',
  'DUPLICATE_PAYMENT_SAME_DAY',
  'VOUCHER_CREDIT_PENDING',
  'COLLECTOR_VARIANCE_30',
  'DEALER_OVER_LIMIT',
] as const;
export type AssuranceControlCode = (typeof assuranceControlCodes)[number];

export const assuranceFindingStatusSchema = z.enum(['open', 'acknowledged', 'resolved', 'cleared']);
export const assuranceCaseStatusSchema = z.enum([
  'open',
  'investigating',
  'resolved',
  'written_off',
]);

const reasons = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
};

export const runAssuranceControlsSchema = z
  .object({ action: z.literal('run_controls'), ...reasons })
  .strict();
export const acknowledgeAssuranceFindingSchema = z
  .object({
    action: z.literal('acknowledge_finding'),
    findingId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().max(1000).optional(),
    ...reasons,
  })
  .strict();
export const openAssuranceCaseSchema = z
  .object({
    action: z.literal('open_case'),
    titleEn: z.string().trim().min(3).max(200),
    titleAr: z.string().trim().min(3).max(200),
    findingIds: z.array(z.uuid()).min(1).max(200),
    ownerUserId: z.uuid().optional(),
    ...reasons,
  })
  .strict();
export const assignAssuranceCaseSchema = z
  .object({
    action: z.literal('assign_case'),
    caseId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    ownerUserId: z.uuid(),
    ...reasons,
  })
  .strict();
export const linkAssuranceFindingsSchema = z
  .object({
    action: z.literal('link_findings'),
    caseId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    findingIds: z.array(z.uuid()).min(1).max(200),
    ...reasons,
  })
  .strict();
export const transitionAssuranceCaseSchema = z
  .object({
    action: z.literal('transition_case'),
    caseId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    status: z.enum(['investigating', 'resolved', 'written_off']),
    resolutionEn: z.string().trim().min(8).max(2000).optional(),
    resolutionAr: z.string().trim().min(8).max(2000).optional(),
    resolutionEvidence: z.string().trim().min(8).max(2000).optional(),
    ...reasons,
  })
  .strict()
  .refine(
    (v) =>
      v.status === 'investigating' ||
      Boolean(v.resolutionEn && v.resolutionAr && v.resolutionEvidence),
    'Closing a case requires bilingual resolution and evidence.',
  );

export const assuranceCommandSchema = z.discriminatedUnion('action', [
  runAssuranceControlsSchema,
  acknowledgeAssuranceFindingSchema,
  openAssuranceCaseSchema,
  assignAssuranceCaseSchema,
  linkAssuranceFindingsSchema,
  transitionAssuranceCaseSchema,
]);
export type AssuranceCommand = z.infer<typeof assuranceCommandSchema>;

export const assuranceQuerySchema = z
  .object({
    findings: z.enum(['live', 'all']).default('live'),
    control: z.enum(assuranceControlCodes).optional(),
  })
  .strict();
export type AssuranceQuery = z.infer<typeof assuranceQuerySchema>;

export interface AssuranceControlSummary {
  readonly controlCode: AssuranceControlCode;
  readonly openFindings: number;
  readonly newFindings: number;
  readonly exposureUsdMinor: number;
  readonly exposureLbpMinor: number;
}

export interface AssuranceRun {
  readonly id: string;
  readonly requestedBy: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly summary: readonly AssuranceControlSummary[];
}

export interface AssuranceFinding {
  readonly id: string;
  readonly controlCode: AssuranceControlCode;
  readonly subjectType:
    | 'service'
    | 'invoice'
    | 'payment'
    | 'redemption'
    | 'reconciliation'
    | 'dealer';
  readonly subjectId: string;
  readonly subjectReference: string;
  readonly subscriberId: string | null;
  readonly subscriberName: string | null;
  readonly branchId: string | null;
  readonly currency: 'USD' | 'LBP' | null;
  readonly exposureMinor: number;
  readonly details: Record<string, unknown>;
  readonly status: z.infer<typeof assuranceFindingStatusSchema>;
  readonly acknowledgementNote: string | null;
  readonly acknowledgedBy: string | null;
  readonly caseId: string | null;
  readonly caseNumber: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly clearedAt: string | null;
  readonly resolvedAt: string | null;
  readonly version: number;
}

export interface AssuranceCase {
  readonly id: string;
  readonly caseNumber: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly status: z.infer<typeof assuranceCaseStatusSchema>;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly openedBy: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly resolutionEn: string | null;
  readonly resolutionAr: string | null;
  readonly resolutionEvidence: string | null;
  readonly findings: number;
  readonly exposureUsdMinor: number;
  readonly exposureLbpMinor: number;
  readonly version: number;
}

export interface AssuranceWorkspace {
  readonly latestRun: AssuranceRun | null;
  readonly runs: readonly AssuranceRun[];
  readonly findings: readonly AssuranceFinding[];
  readonly cases: readonly AssuranceCase[];
  readonly members: readonly { userId: string; name: string }[];
  readonly summary: {
    readonly openFindings: number;
    readonly acknowledgedFindings: number;
    readonly openCases: number;
    readonly exposureUsdMinor: number;
    readonly exposureLbpMinor: number;
  };
}
