import {
  appendAuditEvent,
  isSessionActive,
  isSupportGrantActive,
  readTenantSummary,
  type Database,
} from '@isp/database';
import type { AuditEvent, AuditWriter } from './audit.js';
import type { SessionStatusReader, SupportGrantStatusReader } from './authentication.js';
import type { TenantSummaryReader } from './summary.js';

export class PostgresSessionStatusReader implements SessionStatusReader {
  public constructor(private readonly database: Database) {}

  public async isActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    return isSessionActive(this.database, sessionId, userId, now);
  }
}

export class PostgresSupportGrantStatusReader implements SupportGrantStatusReader {
  public constructor(private readonly database: Database) {}

  public async isActive(
    grantId: string,
    tenantId: string,
    requesterId: string,
    now: Date,
  ): Promise<boolean> {
    return isSupportGrantActive(this.database, grantId, tenantId, requesterId, now);
  }
}

export class PostgresAuditWriter implements AuditWriter {
  public constructor(private readonly database: Database) {}

  public async append(event: AuditEvent): Promise<void> {
    await appendAuditEvent(this.database, event);
  }
}

export class PostgresTenantSummaryReader implements TenantSummaryReader {
  public constructor(private readonly database: Database) {}

  public async read(tenantId: string, at: Date) {
    return readTenantSummary(this.database, tenantId, at);
  }
}
