import {
  communicationCommandSchema,
  markDeliverySchema,
  supportCommandSchema,
  supportQuerySchema,
  templateCommandSchema,
  type CommunicationCommand,
  type CommunicationsWorkspace,
  type MarkDeliveryCommand,
  type MessageTemplate,
  type NotificationRecord,
  type SubscriberConsent,
  type SupportCommand,
  type SupportQuery,
  type SupportTicket,
  type SupportWorkspace,
  type TemplateCommand,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

const timestamp = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.toISOString();

async function runCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  fn: 'execute_support_command' | 'execute_communication_command',
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: Record<string, unknown> }>(
      fn === 'execute_support_command'
        ? sql`SELECT execute_support_command(${JSON.stringify(payload)}::jsonb) AS result`
        : sql`SELECT execute_communication_command(${JSON.stringify(payload)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Command returned no result.');
    return row.result;
  });
}

export function executeSupportCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: SupportCommand;
  },
) {
  return runCommand(
    database,
    tenantId,
    input.authorization,
    'execute_support_command',
    supportCommandSchema.parse(input.command),
  );
}

export function executeTemplateCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: TemplateCommand;
  },
) {
  return runCommand(
    database,
    tenantId,
    input.authorization,
    'execute_communication_command',
    templateCommandSchema.parse(input.command),
  );
}

export function executeCommunicationCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: CommunicationCommand;
  },
) {
  return runCommand(
    database,
    tenantId,
    input.authorization,
    'execute_communication_command',
    communicationCommandSchema.parse(input.command),
  );
}

export function markNotificationDelivery(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: MarkDeliveryCommand;
  },
) {
  return runCommand(
    database,
    tenantId,
    input.authorization,
    'execute_communication_command',
    markDeliverySchema.parse(input.command),
  );
}

/** Queued notifications due now, with the unmasked destination for the delivery pass only. */
export async function readQueuedNotifications(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext; readonly limit: number },
): Promise<
  readonly {
    id: string;
    channel: 'sms' | 'whatsapp' | 'email';
    destination: string;
    subject: string | null;
    body: string;
    version: number;
  }[]
> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      valid: boolean;
    }>(sql`SELECT true AS valid FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND permission='tenant.secret.manage' AND action='tenant.communication.manage' AND support_grant_id IS NULL`);
    if (!authority) throw new OperationsAuthorizationError('Secret management authority required.');
    return tx.execute<{
      id: string;
      channel: 'sms' | 'whatsapp' | 'email';
      destination: string;
      subject: string | null;
      body: string;
      version: number;
    }>(sql`SELECT id, channel, destination, subject, body, version FROM operations_notification_outbox
      WHERE tenant_id=${tenantId} AND status='queued' AND destination IS NOT NULL AND next_attempt_at<=clock_timestamp()
      ORDER BY next_attempt_at, created_at LIMIT ${input.limit}`);
  });
}

export async function readSupportWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<SupportQuery>;
  },
): Promise<SupportWorkspace> {
  const query = supportQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      valid: boolean;
    }>(sql`SELECT true AS valid FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND action='tenant.support.workspace.read' AND support_grant_id IS NULL
        AND permission IN ('tenant.subscriber.view','tenant.subscriber.edit')`);
    if (!authority) throw new OperationsAuthorizationError('Subscriber view authority required.');
    const tickets = await tx.execute<{ record: SupportTicket }>(sql`SELECT jsonb_build_object(
      'id', i.id, 'issueNumber', i.issue_number, 'subject', i.subject, 'description', i.description, 'priority', i.priority,
      'category', i.category, 'channel', i.channel, 'status', i.status, 'subscriberId', i.subscriber_id, 'subscriberName', s.display_name,
      'serviceId', i.service_id, 'serviceNumber', sv.service_number, 'assigneeUserId', i.assignee_user_id, 'assigneeName', a.display_name,
      'escalatedToName', e.display_name, 'escalatedAt', i.escalated_at, 'verification', i.verification,
      'slaRespondDueAt', i.sla_respond_due_at, 'slaResolveDueAt', i.sla_resolve_due_at, 'firstResponseAt', i.first_response_at,
      'respondBreached', (i.first_response_at IS NULL AND i.sla_respond_due_at IS NOT NULL AND i.sla_respond_due_at < clock_timestamp() AND i.status NOT IN ('resolved','closed')),
      'resolveBreached', (i.sla_resolve_due_at IS NOT NULL AND coalesce(i.closed_at, clock_timestamp()) > i.sla_resolve_due_at AND (i.status NOT IN ('resolved','closed') OR i.closed_at > i.sla_resolve_due_at)),
      'outageId', i.outage_id, 'outageTitleEn', o.outage_title_en, 'outageTitleAr', o.outage_title_ar, 'reopenCount', i.reopen_count,
      'redress', i.redress, 'createdAt', i.created_at, 'updatedAt', i.updated_at, 'closedAt', i.closed_at, 'version', i.version,
      'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'authorName', coalesce(u.display_name, n.author_id::text), 'note', n.note,
        'kind', n.kind, 'createdAt', n.created_at) ORDER BY n.created_at) FROM operations_issue_notes n LEFT JOIN users u ON u.id=n.author_id
        WHERE n.tenant_id=i.tenant_id AND n.issue_id=i.id), '[]'::jsonb),
      'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ev.id, 'fromStatus', ev.from_status, 'toStatus', ev.to_status, 'note', ev.note,
        'occurredAt', ev.occurred_at) ORDER BY ev.occurred_at) FROM operations_issue_events ev WHERE ev.tenant_id=i.tenant_id AND ev.issue_id=i.id), '[]'::jsonb)
      ) AS record
      FROM operations_support_issues i
      LEFT JOIN operations_subscribers s ON s.tenant_id=i.tenant_id AND s.id=i.subscriber_id
      LEFT JOIN operations_services sv ON sv.tenant_id=i.tenant_id AND sv.id=i.service_id
      LEFT JOIN users a ON a.id=i.assignee_user_id
      LEFT JOIN users e ON e.id=i.escalated_to_user_id
      LEFT JOIN operations_outages o ON o.tenant_id=i.tenant_id AND o.id=i.outage_id
      WHERE i.tenant_id=${tenantId}
        AND (${query.status}='all' OR (${query.status}='open' AND i.status NOT IN ('resolved','closed')) OR (${query.status}='closed' AND i.status IN ('resolved','closed')))
      ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, i.updated_at DESC, i.id
      LIMIT ${query.limit}`);
    const subscribers = await tx.execute<{ id: string; name: string; subscriberNumber: string }>(
      sql`SELECT id, display_name AS name, subscriber_number AS "subscriberNumber" FROM operations_subscribers
          WHERE tenant_id=${tenantId} AND status::text<>'closed' ORDER BY display_name, id LIMIT 1001`,
    );
    const services = await tx.execute<{ id: string; subscriberId: string; serviceNumber: string }>(
      sql`SELECT id, subscriber_id AS "subscriberId", service_number AS "serviceNumber" FROM operations_services
          WHERE tenant_id=${tenantId} AND status<>'terminated' ORDER BY service_number, id LIMIT 2000`,
    );
    const members = await tx.execute<{ userId: string; name: string }>(
      sql`SELECT m.user_id AS "userId", u.display_name AS name FROM tenant_memberships m JOIN users u ON u.id=m.user_id
          WHERE m.tenant_id=${tenantId} ORDER BY u.display_name, m.user_id LIMIT 500`,
    );
    const incidents = await tx.execute<{ id: string; titleEn: string; titleAr: string }>(
      sql`SELECT id, outage_title_en AS "titleEn", outage_title_ar AS "titleAr" FROM operations_outages
          WHERE tenant_id=${tenantId} AND status<>'resolved' ORDER BY started_at DESC, id LIMIT 100`,
    );
    const [summary] = await tx.execute<{
      open: string;
      waiting: string;
      respond_breached: string;
      resolve_breached: string;
      escalated: string;
    }>(sql`SELECT
      count(*) FILTER (WHERE status NOT IN ('resolved','closed'))::text AS open,
      count(*) FILTER (WHERE status='waiting')::text AS waiting,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND first_response_at IS NULL AND sla_respond_due_at < clock_timestamp())::text AS respond_breached,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND sla_resolve_due_at < clock_timestamp())::text AS resolve_breached,
      count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND escalated_at IS NOT NULL)::text AS escalated
      FROM operations_support_issues WHERE tenant_id=${tenantId}`);
    return {
      tickets: tickets.map((r) => r.record),
      subscribers: subscribers.slice(0, 1000),
      services: [...services],
      members: [...members],
      openIncidents: [...incidents],
      subscriberDirectoryTruncated: subscribers.length > 1000,
      summary: {
        open: Number(summary?.open ?? 0),
        waiting: Number(summary?.waiting ?? 0),
        respondBreached: Number(summary?.respond_breached ?? 0),
        resolveBreached: Number(summary?.resolve_breached ?? 0),
        escalated: Number(summary?.escalated ?? 0),
      },
    };
  });
}

const maskDestination = (value: string | null): string | null => {
  if (!value) return null;
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 2)}…@${domain}`;
  }
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
};

export async function readCommunicationsWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<CommunicationsWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      valid: boolean;
    }>(sql`SELECT true AS valid FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND action='tenant.communication.workspace.read' AND support_grant_id IS NULL
        AND permission IN ('tenant.subscriber.view','tenant.subscriber.edit','tenant.user.administer','tenant.secret.manage')`);
    if (!authority) throw new OperationsAuthorizationError('Subscriber view authority required.');
    const templates = await tx.execute<{
      id: string;
      template_key: string;
      channel: MessageTemplate['channel'];
      name_en: string;
      name_ar: string;
      subject_en: string | null;
      subject_ar: string | null;
      body_en: string;
      body_ar: string;
      status: MessageTemplate['status'];
      approved_by: string | null;
      approved_at: Date | string | null;
      created_by: string;
      version: number;
    }>(sql`SELECT t.id, t.template_key, t.channel, t.name_en, t.name_ar, t.subject_en, t.subject_ar, t.body_en, t.body_ar, t.status,
        a.display_name AS approved_by, t.approved_at, coalesce(c.display_name, t.created_by::text) AS created_by, t.version
      FROM operations_message_templates t LEFT JOIN users a ON a.id=t.approved_by LEFT JOIN users c ON c.id=t.created_by
      WHERE t.tenant_id=${tenantId} ORDER BY t.status, t.template_key LIMIT 300`);
    const consents = await tx.execute<{
      id: string;
      subscriber_id: string;
      subscriber_name: string;
      channel: SubscriberConsent['channel'];
      allowed: boolean;
      source: string;
      note: string | null;
      recorded_by: string;
      recorded_at: Date | string;
    }>(sql`SELECT DISTINCT ON (c.subscriber_id, c.channel) c.id, c.subscriber_id, s.display_name AS subscriber_name, c.channel, c.allowed,
        c.source, c.note, coalesce(u.display_name, c.recorded_by::text) AS recorded_by, c.recorded_at
      FROM operations_subscriber_consents c JOIN operations_subscribers s ON s.tenant_id=c.tenant_id AND s.id=c.subscriber_id
      LEFT JOIN users u ON u.id=c.recorded_by
      WHERE c.tenant_id=${tenantId} ORDER BY c.subscriber_id, c.channel, c.recorded_at DESC, c.id DESC LIMIT 500`);
    const notifications = await tx.execute<{
      id: string;
      subscriber_id: string;
      subscriber_name: string;
      channel: NotificationRecord['channel'];
      destination: string | null;
      template_key: string;
      locale: 'en' | 'ar';
      subject: string | null;
      body: string;
      status: NotificationRecord['status'];
      suppression_reason: string | null;
      attempts: number;
      last_error: string | null;
      provider_reference: string | null;
      related_type: string | null;
      related_id: string | null;
      requested_by: string;
      created_at: Date | string;
      next_attempt_at: Date | string;
      sent_at: Date | string | null;
      version: number;
    }>(sql`SELECT n.id, n.subscriber_id, s.display_name AS subscriber_name, n.channel, n.destination, n.template_key, n.locale, n.subject, n.body,
        n.status, n.suppression_reason, n.attempts, n.last_error, n.provider_reference, n.related_type, n.related_id,
        coalesce(u.display_name, n.requested_by::text) AS requested_by, n.created_at, n.next_attempt_at, n.sent_at, n.version
      FROM operations_notification_outbox n JOIN operations_subscribers s ON s.tenant_id=n.tenant_id AND s.id=n.subscriber_id
      LEFT JOIN users u ON u.id=n.requested_by
      WHERE n.tenant_id=${tenantId}
      ORDER BY CASE n.status WHEN 'queued' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, n.created_at DESC, n.id LIMIT 300`);
    const subscribers = await tx.execute<{ id: string; name: string; subscriberNumber: string }>(
      sql`SELECT id, display_name AS name, subscriber_number AS "subscriberNumber" FROM operations_subscribers
          WHERE tenant_id=${tenantId} AND status::text<>'closed' ORDER BY display_name, id LIMIT 1001`,
    );
    const providers = await tx.execute<{ kind: 'sms' | 'whatsapp' | 'smtp' }>(
      sql`SELECT kind FROM operations_integration_settings WHERE tenant_id=${tenantId} AND active`,
    );
    const configured = new Set(providers.map((p) => (p.kind === 'smtp' ? 'email' : p.kind)));
    const [summary] = await tx.execute<{
      queued: string;
      sent_today: string;
      failed: string;
      suppressed: string;
      approved: string;
    }>(sql`SELECT
      (SELECT count(*) FROM operations_notification_outbox n WHERE n.tenant_id=${tenantId} AND n.status='queued')::text AS queued,
      (SELECT count(*) FROM operations_notification_outbox n WHERE n.tenant_id=${tenantId} AND n.status='sent' AND n.sent_at > clock_timestamp() - interval '24 hours')::text AS sent_today,
      (SELECT count(*) FROM operations_notification_outbox n WHERE n.tenant_id=${tenantId} AND n.status='failed')::text AS failed,
      (SELECT count(*) FROM operations_notification_outbox n WHERE n.tenant_id=${tenantId} AND n.status='suppressed')::text AS suppressed,
      (SELECT count(*) FROM operations_message_templates t WHERE t.tenant_id=${tenantId} AND t.status='approved')::text AS approved`);
    return {
      templates: templates.map(
        (t): MessageTemplate => ({
          id: t.id,
          templateKey: t.template_key,
          channel: t.channel,
          nameEn: t.name_en,
          nameAr: t.name_ar,
          subjectEn: t.subject_en,
          subjectAr: t.subject_ar,
          bodyEn: t.body_en,
          bodyAr: t.body_ar,
          status: t.status,
          approvedBy: t.approved_by,
          approvedAt: timestamp(t.approved_at),
          createdBy: t.created_by,
          version: Number(t.version),
        }),
      ),
      consents: consents.map(
        (c): SubscriberConsent => ({
          id: c.id,
          subscriberId: c.subscriber_id,
          subscriberName: c.subscriber_name,
          channel: c.channel,
          allowed: c.allowed,
          source: c.source,
          note: c.note,
          recordedBy: c.recorded_by,
          recordedAt: timestamp(c.recorded_at) ?? '',
        }),
      ),
      notifications: notifications.map(
        (n): NotificationRecord => ({
          id: n.id,
          subscriberId: n.subscriber_id,
          subscriberName: n.subscriber_name,
          channel: n.channel,
          destinationMasked: maskDestination(n.destination),
          templateKey: n.template_key,
          locale: n.locale,
          subject: n.subject,
          body: n.body,
          status: n.status,
          suppressionReason: n.suppression_reason,
          attempts: Number(n.attempts),
          lastError: n.last_error,
          providerReference: n.provider_reference,
          relatedType: n.related_type,
          relatedId: n.related_id,
          requestedBy: n.requested_by,
          createdAt: timestamp(n.created_at) ?? '',
          nextAttemptAt: timestamp(n.next_attempt_at) ?? '',
          sentAt: timestamp(n.sent_at),
          version: Number(n.version),
        }),
      ),
      subscribers: subscribers.slice(0, 1000),
      subscriberDirectoryTruncated: subscribers.length > 1000,
      providers: (['sms', 'whatsapp', 'email'] as const).map((channel) => ({
        channel,
        configured: configured.has(channel),
      })),
      summary: {
        queued: Number(summary?.queued ?? 0),
        sentToday: Number(summary?.sent_today ?? 0),
        failed: Number(summary?.failed ?? 0),
        suppressed: Number(summary?.suppressed ?? 0),
        approvedTemplates: Number(summary?.approved ?? 0),
      },
    };
  });
}
