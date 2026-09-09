import { z } from 'zod';

// Customer service: tickets with caller verification, category, channel, SLA, notes, escalation,
// outage link, reopen and redress. Communications: approved bilingual templates, subscriber
// channel consent and a notification outbox with delivery evidence.

export const ticketPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const ticketCategorySchema = z.enum([
  'technical',
  'billing',
  'complaint',
  'request',
  'other',
]);
export const ticketChannelSchema = z.enum([
  'walk_in',
  'phone',
  'whatsapp',
  'email',
  'field',
  'internal',
]);
export const ticketStatusSchema = z.enum([
  'open',
  'triaged',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
]);
export const verificationMethodSchema = z.enum([
  'none',
  'contact_match',
  'id_document',
  'account_reference',
]);
export const messageChannelSchema = z.enum(['sms', 'whatsapp', 'email']);

const note = z.string().trim().min(3).max(4000);

export const createTicketSchema = z
  .object({
    action: z.literal('create_ticket'),
    subject: z.string().trim().min(3).max(300),
    description: z.string().trim().min(3).max(5000),
    priority: ticketPrioritySchema.default('normal'),
    category: ticketCategorySchema.default('other'),
    channel: ticketChannelSchema.default('internal'),
    subscriberId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    verification: z
      .object({
        method: verificationMethodSchema,
        contact: z.string().trim().min(3).max(320).optional(),
        reference: z.string().trim().min(2).max(200).optional(),
      })
      .strict()
      .optional(),
    outageId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.subscriberId ?? v.serviceId),
    'A ticket needs a subscriber or a service.',
  );

const ticketTarget = { issueId: z.uuid(), expectedVersion: z.number().int().positive() };
export const addTicketNoteSchema = z
  .object({
    action: z.literal('add_note'),
    ...ticketTarget,
    note,
    customerContact: z.boolean().optional(),
  })
  .strict();
export const escalateTicketSchema = z
  .object({
    action: z.literal('escalate'),
    ...ticketTarget,
    toUserId: z.uuid(),
    note: note.optional(),
  })
  .strict();
export const linkTicketOutageSchema = z
  .object({ action: z.literal('link_outage'), ...ticketTarget, outageId: z.uuid() })
  .strict();
export const reopenTicketSchema = z
  .object({ action: z.literal('reopen'), ...ticketTarget, note })
  .strict();
export const recordTicketRedressSchema = z
  .object({
    action: z.literal('record_redress'),
    ...ticketTarget,
    redressKind: z.enum(['credit_note', 'goodwill', 'service_extension', 'none']),
    reference: z.string().trim().min(2).max(200).optional(),
    note: note.optional(),
  })
  .strict();
export const supportCommandSchema = z.discriminatedUnion('action', [
  createTicketSchema,
  addTicketNoteSchema,
  escalateTicketSchema,
  linkTicketOutageSchema,
  reopenTicketSchema,
  recordTicketRedressSchema,
]);
export type SupportCommand = z.infer<typeof supportCommandSchema>;

export const supportQuerySchema = z
  .object({
    status: z.enum(['open', 'all', 'closed']).default('open'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();
export type SupportQuery = z.infer<typeof supportQuerySchema>;

export interface SupportTicket {
  readonly id: string;
  readonly issueNumber: string;
  readonly subject: string;
  readonly description: string;
  readonly priority: z.infer<typeof ticketPrioritySchema>;
  readonly category: z.infer<typeof ticketCategorySchema>;
  readonly channel: z.infer<typeof ticketChannelSchema>;
  readonly status: z.infer<typeof ticketStatusSchema>;
  readonly subscriberId: string | null;
  readonly subscriberName: string | null;
  readonly serviceId: string | null;
  readonly serviceNumber: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeName: string | null;
  readonly escalatedToName: string | null;
  readonly escalatedAt: string | null;
  readonly verification: {
    method: string;
    contact?: string;
    reference?: string;
    verifiedAt?: string;
  };
  readonly slaRespondDueAt: string | null;
  readonly slaResolveDueAt: string | null;
  readonly firstResponseAt: string | null;
  readonly respondBreached: boolean;
  readonly resolveBreached: boolean;
  readonly outageId: string | null;
  readonly outageTitleEn: string | null;
  readonly outageTitleAr: string | null;
  readonly reopenCount: number;
  readonly redress: { kind?: string; reference?: string | null };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly version: number;
  readonly notes: readonly {
    id: string;
    authorName: string;
    note: string;
    kind: 'note' | 'customer_contact' | 'escalation' | 'redress' | 'reopen';
    createdAt: string;
  }[];
  readonly history: readonly {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    occurredAt: string;
  }[];
}

export interface SupportWorkspace {
  readonly tickets: readonly SupportTicket[];
  readonly subscribers: readonly { id: string; name: string; subscriberNumber: string }[];
  readonly services: readonly { id: string; subscriberId: string; serviceNumber: string }[];
  readonly members: readonly { userId: string; name: string }[];
  readonly openIncidents: readonly { id: string; titleEn: string; titleAr: string }[];
  readonly subscriberDirectoryTruncated: boolean;
  readonly summary: {
    readonly open: number;
    readonly waiting: number;
    readonly respondBreached: number;
    readonly resolveBreached: number;
    readonly escalated: number;
  };
}

export const upsertTemplateSchema = z
  .object({
    action: z.literal('upsert_template'),
    templateKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{2,79}$/u, 'Use lower-case letters, digits, . _ -'),
    expectedVersion: z.number().int().positive().optional(),
    channel: messageChannelSchema,
    nameEn: z.string().trim().min(2).max(150),
    nameAr: z.string().trim().min(2).max(150),
    subjectEn: z.string().trim().min(2).max(200).optional(),
    subjectAr: z.string().trim().min(2).max(200).optional(),
    bodyEn: z.string().trim().min(3).max(4000),
    bodyAr: z.string().trim().min(3).max(4000),
  })
  .strict()
  .refine(
    (v) => v.channel !== 'email' || Boolean(v.subjectEn && v.subjectAr),
    'Email templates need subjects in both languages.',
  );
export const approveTemplateSchema = z
  .object({
    action: z.literal('approve_template'),
    templateKey: z.string().trim().min(3).max(80),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const retireTemplateSchema = z
  .object({
    action: z.literal('retire_template'),
    templateKey: z.string().trim().min(3).max(80),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const templateCommandSchema = z.discriminatedUnion('action', [
  upsertTemplateSchema,
  approveTemplateSchema,
  retireTemplateSchema,
]);
export type TemplateCommand = z.infer<typeof templateCommandSchema>;

export const recordConsentSchema = z
  .object({
    action: z.literal('record_consent'),
    subscriberId: z.uuid(),
    channel: messageChannelSchema,
    allowed: z.boolean(),
    source: z.enum(['customer_request', 'contract', 'regulatory', 'staff']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const queueNotificationSchema = z
  .object({
    action: z.literal('queue_notification'),
    subscriberId: z.uuid(),
    templateKey: z.string().trim().min(3).max(80),
    locale: z.enum(['en', 'ar']).default('ar'),
    variables: z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/u), z.string().max(500)).optional(),
    destination: z.string().trim().min(3).max(320).optional(),
    relatedType: z.enum(['support_issue', 'outage', 'invoice', 'service', 'manual']).optional(),
    relatedId: z.uuid().optional(),
  })
  .strict();
export const cancelNotificationSchema = z
  .object({
    action: z.literal('cancel_notification'),
    notificationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export const communicationCommandSchema = z.discriminatedUnion('action', [
  recordConsentSchema,
  queueNotificationSchema,
  cancelNotificationSchema,
]);
export type CommunicationCommand = z.infer<typeof communicationCommandSchema>;

export const markDeliverySchema = z
  .object({
    action: z.literal('mark_delivery'),
    notificationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    outcome: z.enum(['sent', 'failed']),
    providerReference: z.string().trim().max(200).optional(),
    error: z.string().trim().max(500).optional(),
  })
  .strict();
export type MarkDeliveryCommand = z.infer<typeof markDeliverySchema>;

export const deliverNotificationsSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(25) })
  .strict();
export type DeliverNotificationsCommand = z.infer<typeof deliverNotificationsSchema>;

export interface MessageTemplate {
  readonly id: string;
  readonly templateKey: string;
  readonly channel: z.infer<typeof messageChannelSchema>;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly subjectEn: string | null;
  readonly subjectAr: string | null;
  readonly bodyEn: string;
  readonly bodyAr: string;
  readonly status: 'draft' | 'approved' | 'retired';
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdBy: string;
  readonly version: number;
}

export interface SubscriberConsent {
  readonly id: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly channel: z.infer<typeof messageChannelSchema>;
  readonly allowed: boolean;
  readonly source: string;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export interface NotificationRecord {
  readonly id: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly channel: z.infer<typeof messageChannelSchema>;
  readonly destinationMasked: string | null;
  readonly templateKey: string;
  readonly locale: 'en' | 'ar';
  readonly subject: string | null;
  readonly body: string;
  readonly status: 'queued' | 'sent' | 'failed' | 'suppressed' | 'cancelled';
  readonly suppressionReason: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly providerReference: string | null;
  readonly relatedType: string | null;
  readonly relatedId: string | null;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly nextAttemptAt: string;
  readonly sentAt: string | null;
  readonly version: number;
}

export interface CommunicationsWorkspace {
  readonly templates: readonly MessageTemplate[];
  readonly consents: readonly SubscriberConsent[];
  readonly notifications: readonly NotificationRecord[];
  readonly subscribers: readonly { id: string; name: string; subscriberNumber: string }[];
  readonly subscriberDirectoryTruncated: boolean;
  readonly providers: readonly {
    channel: z.infer<typeof messageChannelSchema>;
    configured: boolean;
  }[];
  readonly summary: {
    readonly queued: number;
    readonly sentToday: number;
    readonly failed: number;
    readonly suppressed: number;
    readonly approvedTemplates: number;
  };
}

export interface DeliveryPassResult {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: readonly { notificationId: string; reason: string }[];
}
