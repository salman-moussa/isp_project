import {
  signOperationsAttestation,
  appendAuditEvent,
  appendSecurityEvent,
  allocatePayment,
  isSessionActive,
  readApprovedSupportGrant,
  readTenantSummary,
  readTenantStaff,
  readTenantStaffInvitations,
  readTenantStaffSessions,
  revokeTenantStaffInvitation,
  revokeTenantStaffSession,
  createTenantStaffInvitation,
  acceptTenantStaffInvitation,
  updateTenantStaffMembership,
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
import type { TenantStaffRepository } from './staff.js';
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

export class PostgresTenantStaffRepository implements TenantStaffRepository {
  public constructor(private readonly database: Database) {}

  public read(tenantId: VerifiedTenantId) {
    return readTenantStaff(this.database, tenantId);
  }

  public readInvitations(tenantId: VerifiedTenantId, now: Date) {
    return readTenantStaffInvitations(this.database, tenantId, now);
  }

  public createInvitation(input: Parameters<TenantStaffRepository['createInvitation']>[0]) {
    return createTenantStaffInvitation(this.database, input);
  }

  public acceptInvitation(input: Parameters<TenantStaffRepository['acceptInvitation']>[0]) {
    return acceptTenantStaffInvitation(this.database, input);
  }

  public updateMembership(input: Parameters<TenantStaffRepository['updateMembership']>[0]) {
    return updateTenantStaffMembership(this.database, input);
  }

  public revokeInvitation(input: Parameters<TenantStaffRepository['revokeInvitation']>[0]) {
    return revokeTenantStaffInvitation(this.database, input);
  }

  public readSessions(input: Parameters<TenantStaffRepository['readSessions']>[0]) {
    return readTenantStaffSessions(this.database, input);
  }

  public revokeSession(input: Parameters<TenantStaffRepository['revokeSession']>[0]) {
    return revokeTenantStaffSession(this.database, input);
  }
}

export class PostgresFinanceWriter implements FinanceWriter {
  public constructor(
    private readonly database: Database,
    private readonly authority: { readonly keyId: string; readonly secret: Uint8Array },
  ) {}

  private authorize<
    T extends
      | FinanceDocumentWrite
      | FinanceDocumentReversal
      | FinanceAllocationWrite
      | FinanceAllocationReversal,
  >(tenantId: VerifiedTenantId, input: T) {
    const { permission, ...audit } = input.audit;
    if (!permissionSet.has(permission)) throw new Error('Unknown finance permission.');
    return {
      ...input,
      authorization: signOperationsAttestation(
        {
          ...audit,
          permission: permission as Permission,
          keyId: this.authority.keyId,
          tenantId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        this.authority.secret,
      ),
    };
  }

  public postInvoice(tenantId: VerifiedTenantId, input: FinanceDocumentWrite) {
    return postInvoice(this.database, tenantId, this.authorize(tenantId, input));
  }

  public reverseInvoice(tenantId: VerifiedTenantId, input: FinanceDocumentReversal) {
    return reverseInvoice(this.database, tenantId, this.authorize(tenantId, input));
  }

  public postPayment(tenantId: VerifiedTenantId, input: FinanceDocumentWrite) {
    return postPayment(this.database, tenantId, this.authorize(tenantId, input));
  }

  public reversePayment(tenantId: VerifiedTenantId, input: FinanceDocumentReversal) {
    return reversePayment(this.database, tenantId, this.authorize(tenantId, input));
  }

  public allocate(tenantId: VerifiedTenantId, input: FinanceAllocationWrite) {
    return allocatePayment(this.database, tenantId, this.authorize(tenantId, input));
  }

  public reverseAllocation(tenantId: VerifiedTenantId, input: FinanceAllocationReversal) {
    return reverseAllocation(this.database, tenantId, this.authorize(tenantId, input));
  }
}
