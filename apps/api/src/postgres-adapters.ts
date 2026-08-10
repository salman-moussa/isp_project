import {
  appendAuditEvent,
  appendSecurityEvent,
  isSessionActive,
  readApprovedSupportGrant,
  readTenantSummary,
  type Database,
} from '@isp/database';
import type { AuditEvent, AuditWriter } from './audit.js';
import { supportGrantSchema, type VerifiedTenantId } from '@isp/contracts';
import type {
  ApprovedSupportGrant,
  SessionStatusReader,
  SupportGrantStatusReader,
} from './authentication.js';
import type { TenantSummaryReader } from './summary.js';
import type { SecurityAuditEvent, SecurityAuditWriter } from './security-audit.js';

export class PostgresSessionStatusReader implements SessionStatusReader {
  public constructor(private readonly database: Database) {}

  public async isActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    return isSessionActive(this.database, sessionId, userId, now);
  }
}

export class PostgresSupportGrantStatusReader implements SupportGrantStatusReader {
  public constructor(private readonly database: Database) {}

  public async readApproved(
    grantId: string,
    tenantId: string,
    requesterId: string,
    now: Date,
  ): Promise<ApprovedSupportGrant | null> {
    const grant = await readApprovedSupportGrant(
      this.database,
      grantId,
      tenantId,
      requesterId,
      now,
    );
    if (!grant) return null;

    const validated = supportGrantSchema.parse({
      grantId: grant.id,
      tenantId: grant.tenantId,
      ticketId: grant.ticketId,
      approverId: grant.approverId,
      reason: grant.reason,
      permissions: grant.permissions,
      expiresAt: grant.expiresAt,
      authorizationVersion: grant.authorizationVersion,
    });
    return { ...grant, permissions: validated.permissions };
  }
}

export class PostgresAuditWriter implements AuditWriter {
  public constructor(private readonly database: Database) {}

  public async append(event: AuditEvent): Promise<void> {
    await appendAuditEvent(this.database, event);
  }
}

export class PostgresSecurityAuditWriter implements SecurityAuditWriter {
  public constructor(private readonly database: Database) {}

  public async append(event: SecurityAuditEvent): Promise<void> {
    await appendSecurityEvent(this.database, event);
  }
}

export class PostgresTenantSummaryReader implements TenantSummaryReader {
  public constructor(private readonly database: Database) {}

  public async read(tenantId: VerifiedTenantId, at: Date) {
    return readTenantSummary(this.database, tenantId, at);
  }
}
