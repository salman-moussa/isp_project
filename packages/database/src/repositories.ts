import type { TenantSummary, VerifiedTenantId } from '@isp/contracts';
import { and, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  auditEvents,
  securityEvents,
  sessions,
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
  const rows = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export interface ActiveTenantMembership {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly authorizationVersion: number;
}

/** Canonical tenant authorization used to reject stale or narrowed session claims. */
export async function readActiveTenantMembership(
  database: Database,
  tenantId: VerifiedTenantId,
  userId: string,
): Promise<ActiveTenantMembership | null> {
  return inTenantTransaction(database, tenantId, async (transaction) => {
    const [membership] = await transaction
      .select({
        tenantId: tenantMemberships.tenantId,
        userId: tenantMemberships.userId,
        permissions: tenantMemberships.permissions,
        authorizationVersion: tenantMemberships.authorizationVersion,
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
    return {
      ...membership,
      permissions: [...membership.permissions],
      authorizationVersion: safeInteger(membership.authorizationVersion, 'authorizationVersion'),
    };
  });
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
  return inTenantTransaction(database, tenantId as VerifiedTenantId, async (transaction) => {
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
  await inTenantTransaction(database, event.tenantId, async (transaction) => {
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
  await database.insert(securityEvents).values({
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
}
