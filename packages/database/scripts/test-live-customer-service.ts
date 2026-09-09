import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type {
  CommunicationCommand,
  Permission,
  SupportCommand,
  TemplateCommand,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  executeCommunicationCommand,
  executeSupportCommand,
  executeTemplateCommand,
  inOperationsTransaction,
  markNotificationDelivery,
  readCommunicationsWorkspace,
  readQueuedNotifications,
  readSupportWorkspace,
  signOperationsAttestation,
  transitionSupportIssue,
} from '../src/index.js';

/**
 * Live acceptance for customer service and communications on PostgreSQL 18: verified ticket
 * intake with SLA targets, notes and first response, escalation, outage link, resolution through
 * the existing transition path, reopen and redress; governed templates with separated approval,
 * consent, notification queueing with rendering and suppression, delivery evidence with retry
 * and lockout, scope and immutability.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Customer service acceptance requires the SALES_TEST database URLs.');
  }
  console.log('Customer service acceptance skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Customer service acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `support-test-${randomUUID()}`;
const secret = randomBytes(32);
const tenantId = randomUUID() as VerifiedTenantId;
const agentId = randomUUID();
const adminUserId = randomUUID();
const branchId = randomUUID();
const otherBranchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const householdId = randomUUID();
const locationId = randomUUID();
const subscriberId = randomUUID();
const planId = randomUUID();
const serviceId = randomUUID();
const sign = (
  action: string,
  permission: Permission,
  idempotencyKey = randomUUID(),
  overrides: Record<string, unknown> = {},
) =>
  signOperationsAttestation(
    {
      keyId,
      tenantId,
      actorId: agentId,
      sessionId: randomUUID(),
      requestId: randomUUID(),
      permission,
      action,
      idempotencyKey,
      reason: 'Synthetic customer service acceptance',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    secret,
  );
const support = (
  command: SupportCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeSupportCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.support.manage',
      options.permission ?? 'tenant.subscriber.edit',
      options.key,
      options.overrides,
    ),
  });
const templates = (
  command: TemplateCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeTemplateCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.communication.manage',
      options.permission ?? 'tenant.user.administer',
      options.key,
      options.overrides,
    ),
  });
const communicate = (
  command: CommunicationCommand,
  options: { key?: string; permission?: Permission; overrides?: Record<string, unknown> } = {},
) =>
  executeCommunicationCommand(runtime.db, tenantId, {
    command,
    authorization: sign(
      'tenant.communication.manage',
      options.permission ?? 'tenant.subscriber.edit',
      options.key,
      options.overrides,
    ),
  });
const readSupport = (
  query: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) =>
  readSupportWorkspace(runtime.db, tenantId, {
    query,
    authorization: sign(
      'tenant.support.workspace.read',
      'tenant.subscriber.view',
      randomUUID(),
      overrides,
    ),
  });
const readComms = (overrides: Record<string, unknown> = {}) =>
  readCommunicationsWorkspace(runtime.db, tenantId, {
    authorization: sign(
      'tenant.communication.workspace.read',
      'tenant.subscriber.view',
      randomUUID(),
      overrides,
    ),
  });

try {
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Support proof','Support proof','active')",
      [tenantId, `SUP-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Service agent','not-a-login'),($3,'tenant',$4,'Service manager','not-a-login')",
      [agentId, `${agentId}@support.invalid`, adminUserId, `${adminUserId}@support.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'customer_service',ARRAY['tenant.subscriber.view','tenant.subscriber.edit'],'{}'::jsonb),($1,$3,'isp_administrator',ARRAY['tenant.user.administer','tenant.secret.manage'],'{}'::jsonb)",
      [tenantId, agentId, adminUserId],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'SUP-B','Support branch','فرع الدعم'),($3,$2,'SUP-B2','Other branch','فرع آخر')",
      [branchId, tenantId, otherBranchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'SUP-A','Support area','منطقة الدعم')",
      [areaId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'SUP-R','Support route','مسار الدعم')",
      [routeId, tenantId, branchId, areaId],
    );
    await tx.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'SUP-H','Support household',$3)",
      [householdId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Home','5 Fiber Lane',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'SUP-SUB','support-subscriber-1','fixture',$3,$4,'Rana Customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_contacts(tenant_id,subscriber_id,contact_kind,contact_value,is_primary) VALUES($1,$2,'phone','+961 3 123456',true),($1,$2,'email','rana@example.test',true)",
      [tenantId, subscriberId],
    );
    await tx.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'SUP-P','Support plan','خطة الدعم',2500,'USD',$3,'support-plan-0001')",
      [planId, tenantId, branchId],
    );
    await tx.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,activated_at,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'SUP-SVC','active',clock_timestamp(),1,$6,$7,$8,'support-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
    await tx.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
  });

  // --- Ticket intake with verification and SLA -----------------------------------------------
  await assert.rejects(
    support(
      {
        action: 'create_ticket',
        subject: 'No internet',
        description: 'Router lights red',
        subscriberId,
      },
      { permission: 'tenant.subscriber.view' },
    ),
  );
  await assert.rejects(
    support({
      action: 'create_ticket',
      subject: 'No internet',
      description: 'Router lights red',
      subscriberId,
      verification: { method: 'contact_match', contact: '+961 3 999999' },
    }),
    /does not match/u,
  );
  const ticketKey = randomUUID();
  const create: SupportCommand = {
    action: 'create_ticket',
    subject: 'No internet since morning',
    description: 'Customer reports the router lights are red.',
    priority: 'high',
    category: 'technical',
    channel: 'phone',
    serviceId,
    verification: { method: 'contact_match', contact: '+961-3-123456' },
  };
  const ticket = await support(create, { key: ticketKey });
  assert.match(String(ticket.issueNumber), /^TCK-\d{8}-[0-9A-F]{6}$/u);
  assert.equal((await support(create, { key: ticketKey })).replayed, true);
  await assert.rejects(
    support({ ...create, subject: 'Changed' }, { key: ticketKey }),
    /different content/u,
  );
  assert.equal(
    Date.parse(String(ticket.slaResolveDueAt)) - Date.parse(String(ticket.slaRespondDueAt)),
    (1440 - 240) * 60_000,
    'high priority: 4 hours to respond, 24 hours to resolve',
  );
  const issueId = ticket.issueId as string;
  let board = await readSupport();
  let row = board.tickets.find((t) => t.id === issueId);
  assert(row);
  assert.equal(row.subscriberName, 'Rana Customer');
  assert.equal(row.serviceNumber, 'SUP-SVC');
  assert.equal(row.verification.method, 'contact_match');
  assert.equal(row.respondBreached, false);
  assert.equal(board.summary.open, 1);

  // --- Notes, first response, escalation, outage link -----------------------------------------
  await assert.rejects(
    support({ action: 'add_note', issueId, expectedVersion: 9, note: 'Called the customer back' }),
    /changed/u,
  );
  const noted = await support({
    action: 'add_note',
    issueId,
    expectedVersion: 1,
    note: 'Called the customer back and asked for a router restart',
    customerContact: true,
  });
  assert.equal(noted.version, 2);
  row = (await readSupport()).tickets.find((t) => t.id === issueId);
  assert(row?.firstResponseAt, 'a customer contact records the first response');
  assert.equal(row.notes.length, 1);
  await assert.rejects(
    support({ action: 'escalate', issueId, expectedVersion: 2, toUserId: randomUUID() }),
    /workspace member/u,
  );
  const escalated = await support({
    action: 'escalate',
    issueId,
    expectedVersion: 2,
    toUserId: adminUserId,
    note: 'Needs a field visit decision',
  });
  assert.equal(escalated.escalatedToUserId, adminUserId);
  row = (await readSupport()).tickets.find((t) => t.id === issueId);
  assert.equal(row?.escalatedToName, 'Service manager');
  assert.equal(row?.assigneeName, 'Service manager');
  assert.equal(row?.priority, 'high');
  await assert.rejects(
    support({ action: 'link_outage', issueId, expectedVersion: 3, outageId: randomUUID() }),
    /not found/u,
  );

  // --- Resolution through the governed transition path, then reopen and redress ---------------
  const transition = (
    toStatus: 'triaged' | 'in_progress' | 'resolved' | 'closed',
    expectedVersion: number,
  ) =>
    transitionSupportIssue(runtime.db, tenantId, {
      authorization: sign('tenant.issue.transition', 'tenant.subscriber.edit'),
      issueId,
      expectedVersion,
      toStatus,
      actorId: agentId,
      idempotencyKey: randomUUID(),
      evidence:
        toStatus === 'resolved' || toStatus === 'closed'
          ? { resolutionCode: 'router_restart' }
          : {},
    } as never);
  await assert.rejects(
    support({ action: 'reopen', issueId, expectedVersion: 3, note: 'Still down' }),
    /only a resolved/u,
  );
  await transition('triaged', 3);
  await transition('in_progress', 4);
  await transition('resolved', 5);
  row = (await readSupport({ status: 'closed' })).tickets.find((t) => t.id === issueId);
  assert.equal(row?.status, 'resolved');
  await assert.rejects(
    support({ action: 'escalate', issueId, expectedVersion: 6, toUserId: adminUserId }),
    /resolved ticket/u,
  );
  const reopened = await support({
    action: 'reopen',
    issueId,
    expectedVersion: 6,
    note: 'Customer called again: still no service in the evening',
  });
  assert.equal(reopened.status, 'in_progress', 'a reopened ticket goes straight back to work');
  assert.equal(reopened.reopenCount, 1);
  assert.equal(reopened.version, 8, 'the transition guard and the reopen each advance the version');
  row = (await readSupport()).tickets.find((t) => t.id === issueId);
  assert.equal(row?.history.at(-1)?.toStatus, 'in_progress');
  assert.equal(row?.history.at(-1)?.fromStatus, 'resolved');
  await assert.rejects(
    support({ action: 'record_redress', issueId, expectedVersion: 8, redressKind: 'credit_note' }),
    /document reference/u,
  );
  const redressed = await support({
    action: 'record_redress',
    issueId,
    expectedVersion: 8,
    redressKind: 'credit_note',
    reference: 'CN-2026-0042',
    note: 'One week credited for the outage',
  });
  assert.equal(redressed.version, 9);
  row = (await readSupport()).tickets.find((t) => t.id === issueId);
  assert.equal(row?.redress.reference, 'CN-2026-0042');
  assert.equal(row?.notes.filter((n) => n.kind === 'redress').length, 1);
  assert.equal(row?.notes.length, 4, 'contact note, escalation, reopen and redress notes');

  // --- Scope: another branch sees nothing; support grants are refused -------------------------
  assert.equal((await readSupport({}, { branchIds: [otherBranchId] })).tickets.length, 0);
  await assert.rejects(readSupport({}, { supportGrantId: randomUUID() }));
  await assert.rejects(
    support(
      { action: 'add_note', issueId, expectedVersion: 9, note: 'Out of scope note' },
      { overrides: { branchIds: [otherBranchId] } },
    ),
  );

  // --- Templates: authored by the agent role? No — governance needs the administrator ---------
  const template: TemplateCommand = {
    action: 'upsert_template',
    templateKey: 'outage.notice',
    channel: 'sms',
    nameEn: 'Outage notice',
    nameAr: 'إشعار انقطاع',
    bodyEn: 'Dear {{subscriberName}}, service in {{area}} is interrupted. Ticket {{ticket}}.',
    bodyAr: 'عزيزنا {{subscriberName}}، الخدمة في {{area}} متوقفة. التذكرة {{ticket}}.',
  };
  await assert.rejects(templates(template, { permission: 'tenant.subscriber.edit' }));
  const created = await templates(template);
  assert.equal(created.status, 'draft');
  // The author cannot approve their own template.
  await assert.rejects(
    templates({ action: 'approve_template', templateKey: 'outage.notice', expectedVersion: 1 }),
    /other than its author/u,
  );
  const approved = await templates(
    { action: 'approve_template', templateKey: 'outage.notice', expectedVersion: 1 },
    { overrides: { actorId: adminUserId } },
  );
  assert.equal(approved.status, 'approved');
  await assert.rejects(
    templates({ action: 'upsert_template', ...template, expectedVersion: 1 } as TemplateCommand),
    /changed/u,
  );
  const email: TemplateCommand = {
    action: 'upsert_template',
    templateKey: 'invoice.ready',
    channel: 'email',
    nameEn: 'Invoice ready',
    nameAr: 'الفاتورة جاهزة',
    subjectEn: 'Your invoice {{invoice}} is ready',
    subjectAr: 'فاتورتك {{invoice}} جاهزة',
    bodyEn: 'Hello {{subscriberName}}, invoice {{invoice}} is ready.',
    bodyAr: 'مرحباً {{subscriberName}}، الفاتورة {{invoice}} جاهزة.',
  };
  await templates(email);

  // --- Consent and queueing with rendering, suppression and destination resolution ------------
  await assert.rejects(
    communicate({
      action: 'queue_notification',
      subscriberId,
      templateKey: 'invoice.ready',
      locale: 'en',
    }),
    /approved template/u,
  );
  const queued = await communicate({
    action: 'queue_notification',
    subscriberId,
    templateKey: 'outage.notice',
    locale: 'ar',
    variables: { area: 'الحمرا', ticket: String(ticket.issueNumber) },
    relatedType: 'support_issue',
    relatedId: issueId,
  });
  assert.equal(queued.status, 'queued');
  let comms = await readComms();
  const message = comms.notifications.find((n) => n.id === queued.notificationId);
  assert(message);
  assert.equal(
    message.body,
    `عزيزنا Rana Customer، الخدمة في الحمرا متوقفة. التذكرة ${String(ticket.issueNumber)}.`,
  );
  assert.equal(message.destinationMasked, '+961…56');
  assert.equal(message.channel, 'sms');
  assert.equal(comms.summary.queued, 1);
  assert.equal(comms.providers.find((p) => p.channel === 'sms')?.configured, false);
  await communicate({
    action: 'record_consent',
    subscriberId,
    channel: 'sms',
    allowed: false,
    source: 'customer_request',
    note: 'Asked to stop SMS',
  });
  const suppressed = await communicate({
    action: 'queue_notification',
    subscriberId,
    templateKey: 'outage.notice',
    variables: { area: 'Hamra', ticket: 'x' },
  });
  assert.equal(suppressed.status, 'suppressed');
  assert.equal(suppressed.suppressionReason, 'consent_withdrawn');
  await communicate({
    action: 'record_consent',
    subscriberId,
    channel: 'sms',
    allowed: true,
    source: 'customer_request',
  });
  comms = await readComms();
  assert.equal(
    comms.consents.find((c) => c.channel === 'sms')?.allowed,
    true,
    'latest consent wins',
  );

  // --- Delivery evidence: the pass reads unmasked destinations only with secret authority ------
  await assert.rejects(
    readQueuedNotifications(runtime.db, tenantId, {
      authorization: sign('tenant.communication.manage', 'tenant.subscriber.edit'),
      limit: 10,
    }),
  );
  const due = await readQueuedNotifications(runtime.db, tenantId, {
    authorization: sign('tenant.communication.manage', 'tenant.secret.manage'),
    limit: 10,
  });
  assert.equal(due.length, 1);
  assert.equal(due[0]?.destination, '+961 3 123456');
  const mark = (
    outcome: 'sent' | 'failed',
    expectedVersion: number,
    key = randomUUID(),
    permission: Permission = 'tenant.secret.manage',
  ) =>
    markNotificationDelivery(runtime.db, tenantId, {
      command: {
        action: 'mark_delivery',
        notificationId: message.id,
        expectedVersion,
        outcome,
        ...(outcome === 'sent' ? { providerReference: 'SM-123' } : { error: 'provider timeout' }),
      },
      authorization: sign('tenant.communication.manage', permission, key),
    });
  await assert.rejects(mark('sent', 1, randomUUID(), 'tenant.subscriber.edit'));
  const failedOnce = await mark('failed', 1);
  assert.equal(failedOnce.status, 'queued');
  assert.equal(failedOnce.attempts, 1);
  const stillQueued = await readQueuedNotifications(runtime.db, tenantId, {
    authorization: sign('tenant.communication.manage', 'tenant.secret.manage'),
    limit: 10,
  });
  assert.equal(stillQueued.length, 0, 'a failed attempt waits for its retry delay');
  const sentKey = randomUUID();
  const sent = await mark('sent', 2, sentKey);
  assert.equal(sent.status, 'sent');
  assert.equal((await mark('sent', 2, sentKey)).replayed, true);
  await assert.rejects(mark('sent', 3), /only a queued/u);
  comms = await readComms();
  assert.equal(comms.notifications.find((n) => n.id === message.id)?.providerReference, 'SM-123');
  assert.equal(comms.summary.sentToday, 1);
  // Cancel a queued message with the agent authority.
  const second = await communicate({
    action: 'queue_notification',
    subscriberId,
    templateKey: 'outage.notice',
    variables: { area: 'Hamra', ticket: 'y' },
  });
  const cancelled = await communicate({
    action: 'cancel_notification',
    notificationId: second.notificationId as string,
    expectedVersion: 1,
    note: 'Sent by phone instead',
  });
  assert.equal(cancelled.status, 'cancelled');

  // --- Scope and immutability ---------------------------------------------------------------------
  assert.equal((await readComms({ branchIds: [otherBranchId] })).notifications.length, 0);
  await assert.rejects(readComms({ supportGrantId: randomUUID() }));
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.support.manage', 'tenant.subscriber.edit'),
      (tx) =>
        tx.execute(
          sql`UPDATE operations_issue_notes SET note='tampered' WHERE tenant_id=${tenantId}`,
        ),
    ),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_notification_outbox WHERE tenant_id=$1', [tenantId]),
  );
  await assert.rejects(
    admin.unsafe('DELETE FROM operations_subscriber_consents WHERE tenant_id=$1', [tenantId]),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND action IN ('tenant.support.manage','tenant.communication.manage')",
    [tenantId],
  );
  assert(audit && audit.count >= 16, `audit rows ${String(audit?.count)}`);
  console.log('Customer service and communications acceptance passed.');
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
