import {
  appendAuditEvent,
  appendSecurityEvent,
  allocatePayment,
  isSessionActive,
  readApprovedSupportGrant,
  readTenantSummary,
  postInvoice,
  postPayment,
  readActiveTenantMembership,
  reverseAllocation,
  reverseInvoice,
  reversePayment,
  type Database,
} from '@isp/database';
import type { AuditEvent, AuditWriter } from './audit.js';
import {
  permissionSet,
  supportGrantSchema,
  type Permission,
  type VerifiedTenantId,
} from '@isp/contracts';
import type {
  ActiveTenantMembership,
  ApprovedSupportGrant,
  SessionStatusReader,
  SupportGrantStatusReader,
  TenantMembershipStatusReader,
} from './authentication.js';
import type { TenantSummaryReader } from './summary.js';
import type { SecurityAuditEvent, SecurityAuditWriter } from './security-audit.js';
import type {
  FinanceAllocationReversal,
  FinanceAllocationWrite,
  FinanceDocumentReversal,
  FinanceDocumentWrite,
  FinanceWriter,
} from './finance.js';

export class PostgresSessionStatusReader implements SessionStatusReader {
  public constructor(private readonly database: Database) {}

  public async isActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    return isSessionActive(this.database, sessionId, userId, now);
  }
}

export class PostgresTenantMembershipStatusReader implements TenantMembershipStatusReader {
  public constructor(private readonly database: Database) {}

  public async readActive(
    tenantId: string,
    userId: string,
  ): Promise<ActiveTenantMembership | null> {
    const membership = await readActiveTenantMembership(
      this.database,
      tenantId as VerifiedTenantId,
      userId,
    );
    if (!membership) return null;
    if (!membership.permissions.every((permission) => permissionSet.has(permission))) {
      throw new Error('Tenant membership contains an unrecognized permission.');
    }
    return { ...membership, permissions: membership.permissions as readonly Permission[] };
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

export class PostgresFinanceWriter implements FinanceWriter {
  public constructor(private readonly database: Database) {}

  public postInvoice(tenantId: VerifiedTenantId, input: FinanceDocumentWrite) {
    return postInvoice(this.database, tenantId, input);
  }

  public reverseInvoice(tenantId: VerifiedTenantId, input: FinanceDocumentReversal) {
    return reverseInvoice(this.database, tenantId, input);
  }

  public postPayment(tenantId: VerifiedTenantId, input: FinanceDocumentWrite) {
    return postPayment(this.database, tenantId, input);
  }

  public reversePayment(tenantId: VerifiedTenantId, input: FinanceDocumentReversal) {
    return reversePayment(this.database, tenantId, input);
  }

  public allocate(tenantId: VerifiedTenantId, input: FinanceAllocationWrite) {
    return allocatePayment(this.database, tenantId, input);
  }

  public reverseAllocation(tenantId: VerifiedTenantId, input: FinanceAllocationReversal) {
    return reverseAllocation(this.database, tenantId, input);
  }
}
