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
