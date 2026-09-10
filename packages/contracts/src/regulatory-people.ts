import { z } from 'zod';

// Regulatory and QoS: licence register, obligations calendar, KPI definitions with targets and
// periodic submissions whose evidence is a retained snapshot computed from the tenant's own
// records. People operations: employees linked to staff identities, teams, shifts and on-call,
// leave with separated approval, and training records with expiry.

const version = z.number().int().positive();
const isoDate = z.iso.date();

export const licenceKindSchema = z.enum([
  'isp_licence',
  'frequency',
  'municipal',
  'numbering',
  'other',
]);
export const licenceStatusSchema = z.enum(['active', 'renewal_pending', 'expired', 'surrendered']);
export const obligationFrequencySchema = z.enum([
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'once',
]);
export const kpiComputationSchema = z.enum([
  'availability_pct',
  'mttr_minutes',
  'fault_rate_per_100',
  'critical_alarms',
  'complaints_per_100',
  'first_response_minutes',
  'resolution_minutes',
  'sla_response_pct',
  'sla_resolution_pct',
  'manual',
]);
export const kpiUnitSchema = z.enum(['percent', 'minutes', 'per_100', 'count']);

export const upsertLicenceSchema = z
  .object({
    action: z.literal('upsert_licence'),
    licenceId: z.uuid().optional(),
    expectedVersion: version.optional(),
    kind: licenceKindSchema.optional(),
    reference: z.string().trim().min(1).max(120).optional(),
    authority: z.string().trim().min(1).max(160).optional(),
    titleEn: z.string().trim().min(1).max(200).optional(),
    titleAr: z.string().trim().min(1).max(200).optional(),
    issuedOn: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
    renewalNoticeDays: z.number().int().min(0).max(730).optional(),
    status: licenceStatusSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const upsertObligationSchema = z
  .object({
    action: z.literal('upsert_obligation'),
    obligationId: z.uuid().optional(),
    expectedVersion: version.optional(),
    code: z.string().trim().min(2).max(40).optional(),
    titleEn: z.string().trim().min(1).max(200).optional(),
    titleAr: z.string().trim().min(1).max(200).optional(),
    authority: z.string().trim().min(1).max(160).optional(),
    frequency: obligationFrequencySchema.optional(),
    nextDueOn: isoDate.optional(),
    ownerUserId: z.uuid().nullable().optional(),
    evidenceRequired: z.boolean().optional(),
    description: z.string().trim().max(2000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const upsertKpiSchema = z
  .object({
    action: z.literal('upsert_kpi'),
    kpiId: z.uuid().optional(),
    expectedVersion: version.optional(),
    code: z.string().trim().min(2).max(40).optional(),
    nameEn: z.string().trim().min(1).max(160).optional(),
    nameAr: z.string().trim().min(1).max(160).optional(),
    computation: kpiComputationSchema.optional(),
    unit: kpiUnitSchema.optional(),
    target: z.number().finite().optional(),
    comparator: z.enum(['>=', '<=']).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const seedStandardKpisSchema = z
  .object({ action: z.literal('seed_standard_kpis') })
  .strict();
export const prepareSubmissionSchema = z
  .object({
    action: z.literal('prepare_submission'),
    obligationId: z.uuid().optional(),
    periodStart: isoDate,
    periodEnd: isoDate,
    manualValues: z.record(z.string().regex(/^[A-Z0-9_]{2,40}$/u), z.number().finite()).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict();
export const submitSubmissionSchema = z
  .object({
    action: z.literal('submit'),
    submissionId: z.uuid(),
    expectedVersion: version,
    reference: z.string().trim().min(1).max(200),
  })
  .strict();
export const decideSubmissionSchema = z
  .object({
    action: z.literal('record_decision'),
    submissionId: z.uuid(),
    expectedVersion: version,
    status: z.enum(['accepted', 'rejected']),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export const regulatoryCommandSchema = z.discriminatedUnion('action', [
  upsertLicenceSchema,
  upsertObligationSchema,
  upsertKpiSchema,
  seedStandardKpisSchema,
  prepareSubmissionSchema,
  submitSubmissionSchema,
  decideSubmissionSchema,
]);
export type RegulatoryCommand = z.infer<typeof regulatoryCommandSchema>;
export const regulatoryQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict();
export type RegulatoryQuery = z.infer<typeof regulatoryQuerySchema>;

export interface KpiEvidenceItem {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly computation: string;
  readonly unit: string;
  readonly target: number;
  readonly comparator: '>=' | '<=';
  readonly value: number | null;
  readonly met: boolean | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly source: 'computed' | 'manual';
}
export interface KpiEvidence {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly computedAt: string;
  readonly periodMinutes: number;
  readonly activeServices: number;
  readonly activeSubscribers: number;
  readonly outageMinutes: number;
  readonly outagesStarted: number;
  readonly outagesResolved: number;
  readonly criticalAlarms: number;
  readonly tickets: number;
  readonly complaints: number;
  readonly kpis: Record<string, KpiEvidenceItem>;
}
export interface LicenceRecord {
  readonly id: string;
  readonly kind: string;
  readonly reference: string;
  readonly authority: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly renewalNoticeDays: number;
  readonly status: string;
  readonly notes: string | null;
  readonly version: number;
  readonly daysToExpiry: number | null;
  readonly renewalDue: boolean;
}
export interface ObligationRecord {
  readonly id: string;
  readonly code: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly authority: string;
  readonly frequency: string;
  readonly nextDueOn: string;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly evidenceRequired: boolean;
  readonly description: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly daysToDue: number;
  readonly overdue: boolean;
  readonly lastSubmission: {
    readonly id: string;
    readonly submissionNumber: string;
    readonly status: string;
    readonly periodEnd: string;
  } | null;
}
export interface KpiDefinitionRecord {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly computation: string;
  readonly unit: string;
  readonly target: number;
  readonly comparator: '>=' | '<=';
  readonly active: boolean;
  readonly version: number;
}
export interface SubmissionRecord {
  readonly id: string;
  readonly submissionNumber: string;
  readonly obligationId: string | null;
  readonly obligationCode: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: 'draft' | 'submitted' | 'accepted' | 'rejected';
  readonly evidence: KpiEvidence;
  readonly notes: string | null;
  readonly preparedBy: string;
  readonly preparedAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly submissionReference: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly version: number;
}
export interface RegulatoryWorkspace {
  readonly asOf: string;
  readonly licences: readonly LicenceRecord[];
  readonly obligations: readonly ObligationRecord[];
  readonly kpis: readonly KpiDefinitionRecord[];
  readonly current: KpiEvidence;
  readonly submissions: readonly SubmissionRecord[];
  readonly members: readonly { readonly userId: string; readonly name: string }[];
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------
export const employeeStatusSchema = z.enum(['active', 'on_leave', 'suspended', 'left']);
export const shiftKindSchema = z.enum(['shift', 'on_call']);
export const leaveKindSchema = z.enum(['annual', 'sick', 'unpaid', 'compassionate', 'other']);
export const trainingKindSchema = z.enum(['training', 'certification', 'safety', 'induction']);

export const upsertTeamSchema = z
  .object({
    action: z.literal('upsert_team'),
    teamId: z.uuid().optional(),
    expectedVersion: version.optional(),
    code: z.string().trim().min(2).max(40).optional(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    nameAr: z.string().trim().min(1).max(120).optional(),
    branchId: z.uuid().nullable().optional(),
    leadEmployeeId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const upsertEmployeeSchema = z
  .object({
    action: z.literal('upsert_employee'),
    employeeId: z.uuid().optional(),
    expectedVersion: version.optional(),
    employeeNumber: z.string().trim().min(1).max(40).optional(),
    userId: z.uuid().nullable().optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    roleTitle: z.string().trim().min(1).max(120).optional(),
    teamId: z.uuid().nullable().optional(),
    branchId: z.uuid().nullable().optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().max(320).optional(),
    hiredOn: isoDate.nullable().optional(),
    status: employeeStatusSchema.optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const scheduleShiftSchema = z
  .object({
    action: z.literal('schedule_shift'),
    employeeId: z.uuid(),
    kind: shiftKindSchema.default('shift'),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    locationNote: z.string().trim().max(200).optional(),
  })
  .strict();
export const cancelShiftSchema = z
  .object({
    action: z.literal('cancel_shift'),
    shiftId: z.uuid(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
export const requestLeaveSchema = z
  .object({
    action: z.literal('request_leave'),
    employeeId: z.uuid(),
    kind: leaveKindSchema.default('annual'),
    startsOn: isoDate,
    endsOn: isoDate,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export const decideLeaveSchema = z
  .object({
    action: z.literal('decide_leave'),
    leaveId: z.uuid(),
    expectedVersion: version,
    status: z.enum(['approved', 'rejected', 'cancelled']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const recordTrainingSchema = z
  .object({
    action: z.literal('record_training'),
    employeeId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    provider: z.string().trim().max(160).optional(),
    kind: trainingKindSchema.default('training'),
    completedOn: isoDate,
    expiresOn: isoDate.optional(),
    reference: z.string().trim().max(200).optional(),
  })
  .strict();
export const peopleCommandSchema = z.discriminatedUnion('action', [
  upsertTeamSchema,
  upsertEmployeeSchema,
  scheduleShiftSchema,
  cancelShiftSchema,
  requestLeaveSchema,
  decideLeaveSchema,
  recordTrainingSchema,
]);
export type PeopleCommand = z.infer<typeof peopleCommandSchema>;
export const peopleQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict();
export type PeopleQuery = z.infer<typeof peopleQuerySchema>;

export interface TeamRecord {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly leadEmployeeId: string | null;
  readonly leadName: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly members: number;
}
export interface EmployeeRecord {
  readonly id: string;
  readonly employeeNumber: string;
  readonly userId: string | null;
  readonly userName: string | null;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly teamId: string | null;
  readonly teamCode: string | null;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly hiredOn: string | null;
  readonly status: 'active' | 'on_leave' | 'suspended' | 'left';
  readonly skills: readonly string[];
  readonly notes: string | null;
  readonly version: number;
  readonly onLeaveToday: boolean;
  readonly onShiftNow: boolean;
  readonly technician: boolean;
  readonly expiringTraining: number;
}
export interface ShiftRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly kind: 'shift' | 'on_call';
  readonly startsAt: string;
  readonly endsAt: string;
  readonly locationNote: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
}
export interface LeaveRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly kind: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly reason: string | null;
  readonly status: 'requested' | 'approved' | 'rejected' | 'cancelled';
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly version: number;
}
export interface TrainingRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly title: string;
  readonly provider: string | null;
  readonly kind: string;
  readonly completedOn: string;
  readonly expiresOn: string | null;
  readonly reference: string | null;
  readonly expired: boolean;
  readonly expiringSoon: boolean;
}
export interface PeopleWorkspace {
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly teams: readonly TeamRecord[];
  readonly employees: readonly EmployeeRecord[];
  readonly shifts: readonly ShiftRecord[];
  readonly leave: readonly LeaveRecord[];
  readonly training: readonly TrainingRecord[];
  readonly members: readonly {
    readonly userId: string;
    readonly name: string;
    readonly roleKey: string;
    readonly linked: boolean;
  }[];
  readonly branches: readonly {
    readonly id: string;
    readonly nameEn: string;
    readonly nameAr: string;
  }[];
}
