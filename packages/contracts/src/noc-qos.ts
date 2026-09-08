import { z } from 'zod';

export const alarmRecordSchema = z.object({
  id: z.string().uuid(),
  deviceName: z.string().trim().min(2).max(100),
  severity: z.enum(['critical', 'major', 'minor', 'warning']),
  alarmCode: z.string().trim(),
  messageEn: z.string().trim(),
  messageAr: z.string().trim(),
  raisedAt: z.string(),
  clearedAt: z.string().nullable(),
  status: z.enum(['active', 'acknowledged', 'cleared']),
});
export type AlarmRecord = z.infer<typeof alarmRecordSchema>;

export const outageRecordSchema = z.object({
  id: z.string().uuid(),
  outageTitleEn: z.string().trim(),
  outageTitleAr: z.string().trim(),
  affectedRegion: z.string().trim(),
  impactedSubscribersCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  rootCauseEn: z.string().nullable(),
  rootCauseAr: z.string().nullable(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
});
export type OutageRecord = z.infer<typeof outageRecordSchema>;

export const qosReportRecordSchema = z.object({
  id: z.string().uuid(),
  reportPeriod: z.string().trim(),
  uptimePercentage: z.number().min(0).max(100),
  avgLatencyMs: z.number().int().nonnegative(),
  billingAccuracyPct: z.number().min(0).max(100),
  mttrHours: z.number().nonnegative(),
  submittedToTra: z.boolean(),
});
export type QosReportRecord = z.infer<typeof qosReportRecordSchema>;
export const nocStatusSchema = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);
const nocReason = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
};
export const createOutageSchema = z
  .object({
    titleEn: z.string().trim().min(3).max(200),
    titleAr: z.string().trim().min(3).max(200),
    routeId: z.uuid(),
    severity: z.enum(['critical', 'major', 'minor', 'warning']),
    serviceIds: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate services.'),
    ...nocReason,
  })
  .strict();
export const transitionOutageSchema = z
  .object({
    outageId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    status: nocStatusSchema,
    ...nocReason,
    rootCauseEn: z.string().trim().min(8).max(1000).optional(),
    rootCauseAr: z.string().trim().min(8).max(1000).optional(),
    resolutionEvidence: z.string().trim().min(8).max(1000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.status !== 'resolved' || Boolean(v.rootCauseEn && v.rootCauseAr && v.resolutionEvidence),
    'Resolution requires bilingual root cause and evidence.',
  );
export const nocQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(['all', 'open', 'resolved']).default('open'),
  })
  .strict();
export type CreateOutageCommand = z.infer<typeof createOutageSchema>;
export type TransitionOutageCommand = z.infer<typeof transitionOutageSchema>;
export type NocQuery = z.infer<typeof nocQuerySchema>;
export interface NocIncident extends OutageRecord {
  readonly routeId: string | null;
  readonly severity: 'critical' | 'major' | 'minor' | 'warning';
  readonly version: number;
  readonly serviceIds: readonly string[];
  readonly events: readonly {
    id: string;
    version: number;
    status: z.infer<typeof nocStatusSchema>;
    reasonEn: string;
    reasonAr: string;
    occurredAt: string;
    resolutionEvidence: string | null;
  }[];
}
export interface NocWorkspace {
  readonly incidents: readonly NocIncident[];
  readonly routes: readonly { id: string; nameEn: string; nameAr: string }[];
  readonly services: readonly {
    id: string;
    routeId: string;
    serviceNumber: string;
    subscriberName: string;
  }[];
  readonly serviceDirectoryTruncated: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
}
