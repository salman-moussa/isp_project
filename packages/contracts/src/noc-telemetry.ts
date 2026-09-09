import { z } from 'zod';

// NOC telemetry: alarms (worker-derived or operator-raised), their lifecycle, planned
// maintenance windows and incident SLA. Every mutation carries a bilingual reason.

export const alarmSeveritySchema = z.enum(['critical', 'major', 'minor', 'warning']);
export const alarmStatusSchema = z.enum(['active', 'acknowledged', 'cleared']);
export const maintenanceStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);
export const maintenanceImpactSchema = z.enum(['none', 'degraded', 'outage']);

const nocCommandReason = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
};

export const raiseAlarmSchema = z
  .object({
    action: z.literal('raise_alarm'),
    deviceName: z.string().trim().min(2).max(100),
    severity: alarmSeveritySchema,
    alarmCode: z.string().regex(/^[A-Z0-9_]{3,40}$/u, 'Use an upper-case code such as LINK_DOWN.'),
    messageEn: z.string().trim().min(3).max(500),
    messageAr: z.string().trim().min(3).max(500),
    routeId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    routerId: z.string().trim().min(1).max(128).optional(),
    ...nocCommandReason,
  })
  .strict();

export const acknowledgeAlarmSchema = z
  .object({
    action: z.literal('acknowledge_alarm'),
    alarmId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().max(1000).optional(),
    ...nocCommandReason,
  })
  .strict();

export const clearAlarmSchema = z
  .object({
    action: z.literal('clear_alarm'),
    alarmId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    ...nocCommandReason,
  })
  .strict();

export const linkAlarmIncidentSchema = z
  .object({
    action: z.literal('link_alarm_incident'),
    alarmId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    outageId: z.uuid(),
    ...nocCommandReason,
  })
  .strict();

export const createMaintenanceSchema = z
  .object({
    action: z.literal('create_maintenance'),
    titleEn: z.string().trim().min(3).max(200),
    titleAr: z.string().trim().min(3).max(200),
    routeId: z.uuid().optional(),
    routerId: z.string().trim().min(1).max(128).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    expectedImpact: maintenanceImpactSchema,
    notesEn: z.string().trim().max(2000).optional(),
    notesAr: z.string().trim().max(2000).optional(),
    ...nocCommandReason,
  })
  .strict()
  .refine(
    (v) => Date.parse(v.endsAt) > Date.parse(v.startsAt),
    'The window must end after it starts.',
  );

export const updateMaintenanceSchema = z
  .object({
    action: z.literal('update_maintenance'),
    maintenanceId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    status: maintenanceStatusSchema.optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    notesEn: z.string().trim().max(2000).optional(),
    notesAr: z.string().trim().max(2000).optional(),
    ...nocCommandReason,
  })
  .strict();

export const nocAlarmCommandSchema = z.discriminatedUnion('action', [
  raiseAlarmSchema,
  acknowledgeAlarmSchema,
  clearAlarmSchema,
  linkAlarmIncidentSchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
]);
export type NocAlarmCommand = z.infer<typeof nocAlarmCommandSchema>;

export interface NocAlarm {
  readonly id: string;
  readonly deviceName: string;
  readonly severity: z.infer<typeof alarmSeveritySchema>;
  readonly alarmCode: string;
  readonly messageEn: string;
  readonly messageAr: string;
  readonly source: 'manual' | 'worker';
  readonly status: z.infer<typeof alarmStatusSchema>;
  readonly routerId: string | null;
  readonly routeId: string | null;
  readonly serviceId: string | null;
  readonly serviceNumber: string | null;
  readonly outageId: string | null;
  readonly maintenanceId: string | null;
  readonly occurrenceCount: number;
  readonly raisedAt: string;
  readonly lastSeenAt: string;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgementNote: string | null;
  readonly clearedAt: string | null;
  readonly version: number;
}

export interface NocMaintenanceWindow {
  readonly id: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly routeId: string | null;
  readonly routerId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly expectedImpact: z.infer<typeof maintenanceImpactSchema>;
  readonly status: z.infer<typeof maintenanceStatusSchema>;
  readonly notesEn: string | null;
  readonly notesAr: string | null;
  readonly createdBy: string;
  readonly suppressedAlarms: number;
  readonly version: number;
}

export interface NocAlarmSummary {
  readonly active: number;
  readonly acknowledged: number;
  readonly critical: number;
  readonly suppressed: number;
  readonly slaBreaches: number;
}
