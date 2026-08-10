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
  uuid,
} from 'drizzle-orm/pg-core';

export const accountKind = pgEnum('account_kind', ['platform', 'tenant']);
export const supportGrantStatus = pgEnum('support_grant_status', [
  'requested',
  'approved',
  'revoked',
  'expired',
]);

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tenant_memberships_tenant_id_user_id_key').on(table.tenantId, table.userId),
    index('tenant_memberships_tenant_idx').on(table.tenantId),
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
    sessionId: uuid('session_id'),
    supportGrantId: uuid('support_grant_id').references(() => supportGrants.id),
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
