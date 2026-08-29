import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const accountKind = pgEnum('account_kind', ['platform', 'tenant']);
export const supportGrantStatus = pgEnum('support_grant_status', [
  'requested',
  'approved',
  'revoked',
  'expired',
]);
export const financeCurrency = pgEnum('finance_currency', ['USD', 'LBP']);
export const financeDocumentKind = pgEnum('finance_document_kind', ['posted', 'reversal']);
export const financeAllocationKind = pgEnum('finance_allocation_kind', ['allocation', 'reversal']);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    brandName: text('brand_name').notNull(),
    legalName: text('legal_name').notNull(),
    status: text('status').notNull().default('trial'),
    timezone: text('timezone').notNull().default('Asia/Beirut'),
    defaultLocale: text('default_locale').notNull().default('en-LB'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [unique('tenants_code_key').on(table.code)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountKind: accountKind('account_kind').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    mfaRequired: boolean('mfa_required').notNull().default(false),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('users_email_key').on(table.email)],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleKey: text('role_key').notNull(),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    scope: jsonb('scope').notNull().default({}),
    active: boolean('active').notNull().default(true),
    authorizationVersion: bigint('authorization_version', { mode: 'bigint' }).notNull().default(1n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tenant_memberships_tenant_id_user_id_key').on(table.tenantId, table.userId),
    index('tenant_memberships_tenant_idx').on(table.tenantId),
    check('tenant_memberships_authorization_version_check', sql`${table.authorizationVersion} > 0`),
  ],
);

export const tenantStaffInvitations = pgTable(
  'tenant_staff_invitations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    roleKey: text('role_key').notNull(),
    permissions: text('permissions').array().notNull(),
    scope: jsonb('scope').notNull().default({}),
    tokenDigest: text('token_digest').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tenant_staff_invitations_token_digest_key').on(table.tokenDigest),
    unique('tenant_staff_invitations_tenant_id_idempotency_key_key').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    uniqueIndex('tenant_staff_invitations_active_email_key')
      .on(table.tenantId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index('tenant_staff_invitations_tenant_status_idx').on(
      table.tenantId,
      table.acceptedAt,
      table.revokedAt,
      table.createdAt,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenDigest: text('token_digest').notNull(),
    deviceLabel: text('device_label'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sessions_token_digest_key').on(table.tokenDigest),
    index('sessions_user_idx').on(table.userId),
  ],
);

export const supportGrants = pgTable(
  'support_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    ticketId: text('ticket_id').notNull(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    approverId: uuid('approver_id').references(() => users.id),
    reason: text('reason').notNull(),
    permissions: text('permissions').array().notNull(),
    status: supportGrantStatus('status').notNull().default('requested'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    authorizationVersion: bigint('authorization_version', { mode: 'bigint' }).notNull().default(1n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_grants_tenant_status_idx').on(table.tenantId, table.status),
    check(
      'support_grants_check',
      sql`${table.approverId} IS NULL OR ${table.approverId} <> ${table.requesterId}`,
    ),
    check('support_grants_authorization_version_check', sql`${table.authorizationVersion} > 0`),
    check(
      'support_grants_approval_state_check',
      sql`${table.status} <> 'approved' OR ${table.approverId} IS NOT NULL`,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorId: uuid('actor_id').references(() => users.id),
    actorReference: text('actor_reference'),
    sessionId: uuid('session_id'),
    sessionReference: text('session_reference'),
    supportGrantId: uuid('support_grant_id').references(() => supportGrants.id),
    supportGrantReference: text('support_grant_reference'),
    requestReference: text('request_reference'),
    permission: text('permission'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    reason: text('reason'),
    requestId: text('request_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    result: text('result').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_tenant_time_idx').on(table.tenantId, table.occurredAt),
    index('audit_events_actor_time_idx').on(table.actorId, table.occurredAt),
    unique('audit_events_request_id_action_key').on(table.requestId, table.action),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id'),
    sessionId: text('session_id'),
    claimedTenantId: text('claimed_tenant_id'),
    supportGrantId: text('support_grant_id'),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    requestId: text('request_id').notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('security_events_time_idx').on(table.occurredAt.desc()),
    index('security_events_actor_time_idx').on(table.actorId, table.occurredAt.desc()),
    unique('security_events_request_id_action_key').on(table.requestId, table.action),
  ],
);

export const tenantDashboardSnapshots = pgTable(
  'tenant_dashboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    activeSubscribers: bigint('active_subscribers', { mode: 'bigint' }).notNull().default(0n),
    onlineSubscribers: bigint('online_subscribers', { mode: 'bigint' }).notNull().default(0n),
    collectionsUsdMinor: bigint('collections_usd_minor', { mode: 'bigint' }).notNull().default(0n),
    collectionsLbpMinor: bigint('collections_lbp_minor', { mode: 'bigint' }).notNull().default(0n),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tenant_dashboard_snapshots_tenant_time_idx').on(table.tenantId, table.computedAt.desc()),
    check(
      'tenant_dashboard_snapshots_active_subscribers_check',
      sql`${table.activeSubscribers} >= 0`,
    ),
    check(
      'tenant_dashboard_snapshots_online_subscribers_check',
      sql`${table.onlineSubscribers} >= 0`,
    ),
  ],
);

export const financeInvoices = pgTable(
  'finance_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    documentNumber: text('document_number').notNull(),
    entryKind: financeDocumentKind('entry_kind').notNull().default('posted'),
    reversesInvoiceId: uuid('reverses_invoice_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: financeCurrency('currency').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    actorId: text('actor_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('finance_invoices_tenant_id_id_key').on(table.tenantId, table.id),
    unique('finance_invoices_tenant_document_number_key').on(table.tenantId, table.documentNumber),
    unique('finance_invoices_tenant_idempotency_key_key').on(table.tenantId, table.idempotencyKey),
    unique('finance_invoices_reverses_invoice_id_key').on(table.reversesInvoiceId),
    index('finance_invoices_tenant_posted_at_idx').on(table.tenantId, table.postedAt.desc()),
    check('finance_invoices_amount_positive_check', sql`${table.amountMinor} > 0`),
  ],
);

export const financePayments = pgTable(
  'finance_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    receiptNumber: text('receipt_number').notNull(),
    entryKind: financeDocumentKind('entry_kind').notNull().default('posted'),
    reversesPaymentId: uuid('reverses_payment_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: financeCurrency('currency').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    actorId: text('actor_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('finance_payments_tenant_id_id_key').on(table.tenantId, table.id),
    unique('finance_payments_tenant_receipt_number_key').on(table.tenantId, table.receiptNumber),
    unique('finance_payments_tenant_idempotency_key_key').on(table.tenantId, table.idempotencyKey),
    unique('finance_payments_reverses_payment_id_key').on(table.reversesPaymentId),
    index('finance_payments_tenant_posted_at_idx').on(table.tenantId, table.postedAt.desc()),
    check('finance_payments_amount_positive_check', sql`${table.amountMinor} > 0`),
  ],
);

export const financePaymentAllocations = pgTable(
  'finance_payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    entryKind: financeAllocationKind('entry_kind').notNull().default('allocation'),
    reversesAllocationId: uuid('reverses_allocation_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: financeCurrency('currency').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    actorId: text('actor_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('finance_allocations_tenant_id_id_key').on(table.tenantId, table.id),
    unique('finance_allocations_tenant_idempotency_key_key').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    unique('finance_allocations_reverses_allocation_id_key').on(table.reversesAllocationId),
    index('finance_allocations_tenant_invoice_idx').on(
      table.tenantId,
      table.invoiceId,
      table.postedAt,
    ),
    index('finance_allocations_tenant_payment_idx').on(
      table.tenantId,
      table.paymentId,
      table.postedAt,
    ),
    check('finance_allocations_amount_positive_check', sql`${table.amountMinor} > 0`),
  ],
);

export const financeAuditOutbox = pgTable(
  'finance_audit_outbox',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sourceTable: text('source_table').notNull(),
    sourceEntryId: uuid('source_entry_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    actorId: text('actor_id').notNull(),
    sessionId: text('session_id').notNull(),
    supportGrantId: text('support_grant_id'),
    requestId: text('request_id').notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent'),
    permission: text('permission').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: financeCurrency('currency').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    clientPostedAt: timestamp('client_posted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    unique('finance_audit_outbox_source_key').on(table.sourceTable, table.sourceEntryId),
    index('finance_audit_outbox_tenant_pending_idx')
      .on(table.tenantId, table.createdAt, table.eventId)
      .where(sql`${table.deliveredAt} IS NULL`),
    check('finance_audit_outbox_amount_minor_check', sql`${table.amountMinor} > 0`),
  ],
);
