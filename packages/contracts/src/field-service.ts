import { z } from 'zod';

/**
 * Field service dispatch: technicians with skills and territories, and work orders that carry an
 * appointment window, SLA, checklist and outcome through a guarded lifecycle. Installation work
 * orders drive the linked installation record, so order orchestration keeps one history.
 */
export const technicianSkillSchema = z.enum([
  'fiber',
  'wireless',
  'copper',
  'cpe',
  'survey',
  'maintenance',
]);
export type TechnicianSkill = z.infer<typeof technicianSkillSchema>;

export const workOrderKindSchema = z.enum([
  'installation',
  'repair',
  'relocation',
  'maintenance',
  'disconnection',
  'survey',
]);
export type WorkOrderKind = z.infer<typeof workOrderKindSchema>;

export const workOrderPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type WorkOrderPriority = z.infer<typeof workOrderPrioritySchema>;

export const workOrderStatusSchema = z.enum([
  'open',
  'scheduled',
  'dispatched',
  'on_site',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, 'Use the international +country format.');
const fieldEvidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
};

export const workOrderChecklistItemSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    labelEn: z.string().trim().min(1).max(200),
    labelAr: z.string().trim().min(1).max(200),
    required: z.boolean().default(true),
    done: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type WorkOrderChecklistItem = z.infer<typeof workOrderChecklistItemSchema>;

export const workOrderChecklistResultSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    done: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const workOrderOutcomeSchema = z
  .object({
    signalDbm: z.number().min(-60).max(10).optional(),
    downloadMbps: z.number().min(0).max(100_000).optional(),
    uploadMbps: z.number().min(0).max(100_000).optional(),
    serialNumbers: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    photoReferences: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    customerName: z.string().trim().min(1).max(120).optional(),
    customerAcknowledged: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type WorkOrderOutcome = z.infer<typeof workOrderOutcomeSchema>;

const window = {
  windowStart: isoDate,
  windowEnd: isoDate,
};

/** Dispatcher commands, signed as `tenant.field.dispatch`. */
export const fieldDispatchCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('register_technician'),
      userId: uuid,
      displayName: z.string().trim().min(1).max(120),
      phone: phone.optional(),
      skills: z.array(technicianSkillSchema).max(6).default([]),
      branchId: uuid.optional(),
      areaIds: z.array(uuid).max(50).default([]),
      ...fieldEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('update_technician'),
      technicianId: uuid,
      expectedVersion: z.number().int().positive(),
      displayName: z.string().trim().min(1).max(120),
      phone: phone.optional(),
      skills: z.array(technicianSkillSchema).max(6).default([]),
      branchId: uuid.optional(),
      areaIds: z.array(uuid).max(50).default([]),
      active: z.boolean(),
      ...fieldEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('create_work_order'),
      kind: workOrderKindSchema,
      priority: workOrderPrioritySchema.default('normal'),
      serviceId: uuid.optional(),
      subscriberId: uuid.optional(),
      installationId: uuid.optional(),
      locationId: uuid.optional(),
      titleEn: z.string().trim().min(3).max(200),
      titleAr: z.string().trim().min(3).max(200),
      instructions: z.string().trim().max(4000).optional(),
      requiredSkills: z.array(technicianSkillSchema).max(6).default([]),
      checklist: z.array(workOrderChecklistItemSchema).max(40).default([]),
      windowStart: isoDate.optional(),
      windowEnd: isoDate.optional(),
      slaDueAt: isoDate.optional(),
      technicianId: uuid.optional(),
      ...fieldEvidence,
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.windowStart === undefined) !== (value.windowEnd === undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['windowEnd'],
          message: 'An appointment window needs both a start and an end.',
        });
      }
      if (
        value.windowStart &&
        value.windowEnd &&
        Date.parse(value.windowEnd) <= Date.parse(value.windowStart)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['windowEnd'],
          message: 'The appointment window must end after it starts.',
        });
      }
      if (value.kind === 'installation' && !value.installationId) {
        context.addIssue({
          code: 'custom',
          path: ['installationId'],
          message: 'Installation work must reference the installation record.',
        });
      }
      if (value.technicianId && !value.windowStart) {
        context.addIssue({
          code: 'custom',
          path: ['technicianId'],
          message: 'Assigning a technician requires an appointment window.',
        });
      }
    }),
  z
    .object({
      action: z.literal('schedule_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      ...window,
      technicianId: uuid.optional(),
      slaDueAt: isoDate.optional(),
      ...fieldEvidence,
    })
    .strict()
    .refine((value) => Date.parse(value.windowEnd) > Date.parse(value.windowStart), {
      message: 'The appointment window must end after it starts.',
      path: ['windowEnd'],
    }),
  z
    .object({
      action: z.literal('assign_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      /** Omit to return the work to the unassigned queue. */
      technicianId: uuid.optional(),
      ...fieldEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      ...fieldEvidence,
    })
    .strict(),
]);
export type FieldDispatchCommand = z.infer<typeof fieldDispatchCommandSchema>;

/** Technician (or tenant-wide dispatcher) commands, signed as `tenant.field.execute`. */
export const fieldExecutionCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      ...fieldEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('complete_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      checklist: z.array(workOrderChecklistResultSchema).max(40).default([]),
      outcome: workOrderOutcomeSchema.default({}),
      ...fieldEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('fail_work_order'),
      workOrderId: uuid,
      expectedVersion: z.number().int().positive(),
      failureReason: z.string().trim().min(8).max(1000),
      revisitWindowStart: isoDate.optional(),
      revisitWindowEnd: isoDate.optional(),
      ...fieldEvidence,
    })
    .strict()
    .refine(
      (value) =>
        (value.revisitWindowStart === undefined) === (value.revisitWindowEnd === undefined) &&
        (!value.revisitWindowStart ||
          Date.parse(value.revisitWindowEnd!) > Date.parse(value.revisitWindowStart)),
      { message: 'A revisit window needs a start and a later end.', path: ['revisitWindowEnd'] },
    ),
]);
export type FieldExecutionCommand = z.infer<typeof fieldExecutionCommandSchema>;

export const fieldServiceQuerySchema = z
  .object({
    /** Board day in YYYY-MM-DD (tenant local calendar); defaults to today. */
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z.enum(['active', 'all', 'closed']).default('active'),
    technicianId: uuid.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type FieldServiceQuery = z.infer<typeof fieldServiceQuerySchema>;

export interface FieldTechnicianRecord {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly phone?: string;
  readonly skills: readonly TechnicianSkill[];
  readonly branchId?: string;
  readonly areaIds: readonly string[];
  readonly active: boolean;
  readonly version: number;
  readonly openWorkOrders: number;
}

export interface WorkOrderRecord {
  readonly id: string;
  readonly workOrderNumber: string;
  readonly kind: WorkOrderKind;
  readonly priority: WorkOrderPriority;
  readonly status: WorkOrderStatus;
  readonly subscriberId?: string;
  readonly subscriberName?: string;
  readonly subscriberNumber?: string;
  readonly serviceId?: string;
  readonly serviceNumber?: string;
  readonly installationId?: string;
  readonly installationStatus?: string;
  readonly locationId?: string;
  readonly address?: string;
  readonly branchId?: string;
  readonly areaId?: string;
  readonly routeId?: string;
  readonly technicianId?: string;
  readonly technicianName?: string;
  readonly windowStart?: string;
  readonly windowEnd?: string;
  readonly slaDueAt?: string;
  readonly overdue: boolean;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly instructions?: string;
  readonly requiredSkills: readonly TechnicianSkill[];
  readonly checklist: readonly WorkOrderChecklistItem[];
  readonly outcome: WorkOrderOutcome;
  readonly failureReason?: string;
  readonly revisitOf?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly dispatchedAt?: string;
  readonly startedAt?: string;
  readonly closedAt?: string;
}

export interface WorkOrderEventRecord {
  readonly id: string;
  readonly workOrderId?: string;
  readonly technicianId?: string;
  readonly action: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly actorId: string;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly evidence: string;
  readonly occurredAt: string;
}

export interface FieldStaffOption {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleKey: string;
}

export interface FieldOpenInstallation {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly status: string;
}

export interface FieldServiceWorkspace {
  readonly day: string;
  readonly technicians: readonly FieldTechnicianRecord[];
  readonly workOrders: readonly WorkOrderRecord[];
  readonly events: readonly WorkOrderEventRecord[];
  readonly staff: readonly FieldStaffOption[];
  readonly openInstallations: readonly FieldOpenInstallation[];
  readonly scopes: {
    readonly branches: readonly {
      readonly id: string;
      readonly nameEn: string;
      readonly nameAr: string;
    }[];
    readonly areas: readonly {
      readonly id: string;
      readonly branchId: string;
      readonly nameEn: string;
      readonly nameAr: string;
    }[];
  };
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
}
