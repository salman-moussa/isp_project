import type { TenantSummary, VerifiedTenantId } from '@isp/contracts';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  auditEvents,
  securityEvents,
  supportGrants,
  tenantDashboardSnapshots,
  tenantMemberships,
} from './schema.js';
import { inTenantTransaction } from './tenant-transaction.js';

export async function isSessionActive(
  database: Database,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
    const rows = await transaction.execute<{ readonly active: boolean }>(sql`
      SELECT is_auth_session_active(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${now.toISOString()}::text::timestamptz
      ) AS active
    `);
    return rows[0]?.active === true;
  });
}

export interface ActiveTenantMembership {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly authorizationVersion: number;
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}

/** Canonical tenant authorization used to reject stale or narrowed session claims. */
export async function readActiveTenantMembership(
  database: Database,
  tenantId: VerifiedTenantId,
  userId: string,
): Promise<ActiveTenantMembership | null> {
  return inControlTenantTransaction(database, tenantId, async (transaction) => {
    const [membership] = await transaction
      .select({
        tenantId: tenantMemberships.tenantId,
        userId: tenantMemberships.userId,
        permissions: tenantMemberships.permissions,
        authorizationVersion: tenantMemberships.authorizationVersion,
        scope: tenantMemberships.scope,
      })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.active, true),
        ),
      )
      .limit(1);

    if (!membership) return null;
    const scope = readAuthorizationScope(membership.scope);
    return {
      ...membership,
      scope: undefined,
      permissions: [...membership.permissions],
      authorizationVersion: safeInteger(membership.authorizationVersion, 'authorizationVersion'),
      ...scope,
    };
  });
}

function readAuthorizationScope(value: unknown): {
  branchIds?: readonly string[];
  areaIds?: readonly string[];
  routeIds?: readonly string[];
  recordIds?: readonly string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scope = value as Record<string, unknown>;
  const result: Record<string, readonly string[]> = {};
  for (const key of ['branchIds', 'areaIds', 'routeIds', 'recordIds'] as const) {
    const item = scope[key];
    if (item !== undefined) {
      if (!Array.isArray(item) || !item.every((entry) => typeof entry === 'string')) {
        throw new Error(`Tenant membership ${key} scope is invalid.`);
      }
      result[key] = [...new Set(item)];
    }
  }
  return result;
}

export async function isSupportGrantActive(
  database: Database,
  grantId: string,
  tenantId: string,
  requesterId: string,
  now: Date,
): Promise<boolean> {
  return (await readApprovedSupportGrant(database, grantId, tenantId, requesterId, now)) !== null;
}

export interface ApprovedSupportGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly approverId: string;
  readonly ticketId: string;
  readonly reason: string;
  readonly permissions: readonly string[];
  readonly expiresAt: string;
  readonly authorizationVersion: number;
}

/** Canonical source for comparing a support token's authorization claims with current DB state. */
export async function readApprovedSupportGrant(
  database: Database,
  grantId: string,
  tenantId: string,
  requesterId: string,
  now: Date,
): Promise<ApprovedSupportGrant | null> {
  // This lookup bootstraps support authorization: the signed grant/user tuple and canonical row
  // must match before the API can issue a general VerifiedTenantId capability.
  return inControlTenantTransaction(database, tenantId as VerifiedTenantId, async (transaction) => {
    const [grant] = await transaction
      .select({
        id: supportGrants.id,
        tenantId: supportGrants.tenantId,
        requesterId: supportGrants.requesterId,
        approverId: supportGrants.approverId,
        ticketId: supportGrants.ticketId,
        reason: supportGrants.reason,
        permissions: supportGrants.permissions,
        expiresAt: supportGrants.expiresAt,
        authorizationVersion: supportGrants.authorizationVersion,
      })
      .from(supportGrants)
      .where(
        and(
          eq(supportGrants.id, grantId),
          eq(supportGrants.tenantId, tenantId),
          eq(supportGrants.requesterId, requesterId),
          eq(supportGrants.status, 'approved'),
          isNotNull(supportGrants.approverId),
          isNull(supportGrants.revokedAt),
          gt(supportGrants.expiresAt, now),
        ),
      )
      .limit(1);

    if (!grant || !grant.approverId) return null;
    return {
      ...grant,
      approverId: grant.approverId,
      permissions: [...grant.permissions],
      expiresAt: grant.expiresAt.toISOString(),
      authorizationVersion: safeInteger(grant.authorizationVersion, 'authorizationVersion'),
    };
  });
}

async function inControlTenantTransaction<T>(
  database: Database,
  tenantId: VerifiedTenantId,
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
    await transaction.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return work(transaction);
  });
}

function safeInteger(value: bigint, field: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`${field} exceeds the safe API integer range.`);
  }
  return converted;
}

export async function readTenantSummary(
  database: Database,
  tenantId: VerifiedTenantId,
  now: Date,
): Promise<TenantSummary> {
  return inTenantTransaction(database, tenantId, async (transaction) => {
    const [snapshot] = await transaction
      .select()
      .from(tenantDashboardSnapshots)
      .where(eq(tenantDashboardSnapshots.tenantId, tenantId))
      .orderBy(desc(tenantDashboardSnapshots.computedAt))
      .limit(1);

    if (!snapshot) {
      return {
        tenantId,
        asOf: now.toISOString(),
        activeSubscribers: 0,
        onlineSubscribers: 0,
        collections: { USD: 0, LBP: 0 },
      };
    }

    return {
      tenantId,
      asOf: snapshot.computedAt.toISOString(),
      activeSubscribers: safeInteger(snapshot.activeSubscribers, 'activeSubscribers'),
      onlineSubscribers: safeInteger(snapshot.onlineSubscribers, 'onlineSubscribers'),
      collections: {
        USD: safeInteger(snapshot.collectionsUsdMinor, 'collections.USD'),
        LBP: safeInteger(snapshot.collectionsLbpMinor, 'collections.LBP'),
      },
    };
  });
}

export interface AuditRecord {
  readonly tenantId: VerifiedTenantId;
  readonly actorId: string;
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly result: 'allowed' | 'denied' | 'failed';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export async function appendAuditEvent(database: Database, event: AuditRecord): Promise<void> {
  await inControlTenantTransaction(database, event.tenantId, async (transaction) => {
    await transaction.insert(auditEvents).values({
      tenantId: event.tenantId,
      actorId: event.actorId,
      sessionId: event.sessionId,
      ...(event.supportGrantId ? { supportGrantId: event.supportGrantId } : {}),
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      ...(event.userAgent ? { userAgent: event.userAgent } : {}),
      result: event.result,
      metadata: event.metadata,
      occurredAt: new Date(event.occurredAt),
    });
  });
}

export interface SecurityAuditRecord {
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly claimedTenantId?: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly reason: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export async function appendSecurityEvent(
  database: Database,
  event: SecurityAuditRecord,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
    await transaction.insert(securityEvents).values({
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.claimedTenantId ? { claimedTenantId: event.claimedTenantId } : {}),
      ...(event.supportGrantId ? { supportGrantId: event.supportGrantId } : {}),
      action: event.action,
      reason: event.reason,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      ...(event.userAgent ? { userAgent: event.userAgent } : {}),
      metadata: event.metadata,
      occurredAt: new Date(event.occurredAt),
    });
  });
}
