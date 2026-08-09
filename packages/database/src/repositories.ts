import type { TenantSummary } from '@isp/contracts';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, sessions, supportGrants, tenantDashboardSnapshots } from './schema.js';
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

export async function isSupportGrantActive(
  database: Database,
  grantId: string,
  tenantId: string,
  requesterId: string,
  now: Date,
): Promise<boolean> {
  const rows = await database
    .select({ id: supportGrants.id })
    .from(supportGrants)
    .where(
      and(
        eq(supportGrants.id, grantId),
        eq(supportGrants.tenantId, tenantId),
        eq(supportGrants.requesterId, requesterId),
        eq(supportGrants.status, 'approved'),
        isNull(supportGrants.revokedAt),
        gt(supportGrants.expiresAt, now),
      ),
    )
    .limit(1);
  return rows.length === 1;
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
  tenantId: string,
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
  readonly tenantId: string;
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
