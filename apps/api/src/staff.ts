import {
  tenantRolePreset,
  type AuthorizationScope,
  type TenantRole,
  type VerifiedTenantId,
} from '@isp/contracts';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, type RequestEvidence } from './auth-service.js';

export interface TenantStaffMember {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleKey: string;
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly mfaRequired: boolean;
  readonly disabled: boolean;
  readonly authorizationVersion: number;
  readonly scope: AuthorizationScope;
  readonly createdAt: string;
}

export interface TenantStaffInvitation {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleKey: string;
  readonly scope: AuthorizationScope;
  readonly status: 'pending' | 'accepted' | 'revoked' | 'expired';
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface TenantStaffSession {
  readonly id: string;
  readonly deviceLabel?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly mfaVerifiedAt?: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt?: string;
  readonly revokeReason?: string;
  readonly createdAt: string;
  readonly current: boolean;
}

export interface StaffActorContext extends RequestEvidence {
  readonly actorId: string;
  readonly sessionId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface TenantStaffRepository {
  read(tenantId: VerifiedTenantId): Promise<readonly TenantStaffMember[]>;
  readInvitations(tenantId: VerifiedTenantId, now: Date): Promise<readonly TenantStaffInvitation[]>;
  createInvitation(input: {
    readonly tenantId: VerifiedTenantId;
    readonly actorId: string;
    readonly sessionId: string;
    readonly invitationId: string;
    readonly email: string;
    readonly displayName: string;
    readonly roleKey: string;
    readonly scope: AuthorizationScope;
    readonly tokenDigest: string;
    readonly idempotencyKey: string;
    readonly expiresAt: Date;
    readonly requestId: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<{ readonly invitationId: string; readonly replayed: boolean }>;
  acceptInvitation(input: {
    readonly tokenDigest: string;
    readonly passwordHash: string;
    readonly requestId: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: 'invalid' }
    | {
        readonly outcome: 'created' | 'existing_account';
        readonly tenantId: string;
        readonly userId: string;
      }
  >;
  updateMembership(input: {
    readonly tenantId: VerifiedTenantId;
    readonly actorId: string;
    readonly sessionId: string;
    readonly targetUserId: string;
    readonly roleKey: string;
    readonly scope: AuthorizationScope;
    readonly active: boolean;
    readonly requestId: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<number>;
  revokeInvitation(input: {
    readonly tenantId: VerifiedTenantId;
    readonly actorId: string;
    readonly sessionId: string;
    readonly invitationId: string;
    readonly requestId: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<boolean>;
  readSessions(
    input: Omit<StaffActorContext, 'idempotencyKey'> & {
      readonly tenantId: VerifiedTenantId;
      readonly targetUserId: string;
      readonly now: Date;
    },
  ): Promise<readonly TenantStaffSession[]>;
  revokeSession(
    input: Omit<StaffActorContext, 'idempotencyKey'> & {
      readonly tenantId: VerifiedTenantId;
      readonly targetUserId: string;
      readonly targetSessionId: string;
      readonly now: Date;
    },
  ): Promise<boolean>;
}

export interface StaffInvitationDeliveryAdapter {
  deliverInvitation(input: {
    readonly invitationId: string;
    readonly tenantId: string;
    readonly email: string;
    readonly displayName: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void>;
}

export class StaffInvitationInvalidError extends Error {
  public readonly statusCode = 400;
  public constructor() {
    super('The staff invitation is invalid or expired.');
  }
}

export class StaffInvitationDeliveryError extends Error {
  public readonly statusCode = 503;
  public constructor() {
    super('The invitation was recorded but delivery is unavailable. Revoke it before retrying.');
  }
}

export interface TenantStaffApiService {
  read(tenantId: VerifiedTenantId): Promise<readonly TenantStaffMember[]>;
  readInvitations(tenantId: VerifiedTenantId): Promise<readonly TenantStaffInvitation[]>;
  invite(
    tenantId: VerifiedTenantId,
    input: {
      readonly email: string;
      readonly displayName: string;
      readonly roleKey: TenantRole;
      readonly scope: AuthorizationScope;
    },
    actor: StaffActorContext,
  ): Promise<{
    readonly invitationId: string;
    readonly status: 'pending';
    readonly expiresAt: string;
    readonly replayed: boolean;
  }>;
  accept(
    token: string,
    newPassword: string,
    evidence: RequestEvidence,
  ): Promise<{
    readonly outcome: 'created' | 'existing_account';
    readonly tenantId: string;
    readonly userId: string;
  }>;
  updateMembership(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    input: {
      readonly roleKey: TenantRole;
      readonly scope: AuthorizationScope;
      readonly active: boolean;
    },
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ): Promise<number>;
  revokeInvitation(
    tenantId: VerifiedTenantId,
    invitationId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ): Promise<boolean>;
  readSessions(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ): Promise<readonly TenantStaffSession[]>;
  revokeSession(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    targetSessionId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ): Promise<boolean>;
}

export class TenantStaffService implements TenantStaffApiService {
  private readonly now: () => Date;
  private readonly invitationTtlMs: number;

  public constructor(
    private readonly repository: TenantStaffRepository,
    private readonly delivery: StaffInvitationDeliveryAdapter,
    private readonly tokenDigestSecret: Uint8Array,
    options: { readonly now?: () => Date; readonly invitationTtlMs?: number } = {},
  ) {
    if (tokenDigestSecret.byteLength < 32) {
      throw new Error('Staff invitation digest secret must be at least 32 bytes.');
    }
    this.now = options.now ?? (() => new Date());
    this.invitationTtlMs = options.invitationTtlMs ?? 24 * 60 * 60_000;
  }

  public read(tenantId: VerifiedTenantId) {
    return this.repository.read(tenantId);
  }

  public readInvitations(tenantId: VerifiedTenantId) {
    return this.repository.readInvitations(tenantId, this.now());
  }

  public async invite(
    tenantId: VerifiedTenantId,
    input: {
      readonly email: string;
      readonly displayName: string;
      readonly roleKey: TenantRole;
      readonly scope: AuthorizationScope;
    },
    actor: StaffActorContext,
  ) {
    const preset = tenantRolePreset(input.roleKey);
    validateScope(preset.scopeMode, input.roleKey, input.scope);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.invitationTtlMs);
    const invitationId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const created = await this.repository.createInvitation({
      tenantId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      invitationId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      roleKey: input.roleKey,
      scope: input.scope,
      tokenDigest: this.digest(token),
      idempotencyKey: actor.idempotencyKey,
      expiresAt,
      requestId: actor.requestId,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: actor.reason,
      now,
    });
    if (!created.replayed) {
      try {
        await this.delivery.deliverInvitation({
          invitationId: created.invitationId,
          tenantId,
          email: input.email.trim().toLowerCase(),
          displayName: input.displayName.trim(),
          token,
          expiresAt,
        });
      } catch {
        throw new StaffInvitationDeliveryError();
      }
    }
    return {
      invitationId: created.invitationId,
      status: 'pending' as const,
      expiresAt: expiresAt.toISOString(),
      replayed: created.replayed,
    };
  }

  public async accept(token: string, newPassword: string, evidence: RequestEvidence) {
    const result = await this.repository.acceptInvitation({
      tokenDigest: this.digest(token),
      passwordHash: await hashPassword(newPassword),
      requestId: evidence.requestId,
      ...(evidence.ipAddress ? { ipAddress: evidence.ipAddress } : {}),
      ...(evidence.userAgent ? { userAgent: evidence.userAgent } : {}),
      now: this.now(),
    });
    if (result.outcome === 'invalid') throw new StaffInvitationInvalidError();
    return result;
  }

  public updateMembership(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    input: {
      readonly roleKey: TenantRole;
      readonly scope: AuthorizationScope;
      readonly active: boolean;
    },
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ) {
    const preset = tenantRolePreset(input.roleKey);
    validateScope(preset.scopeMode, input.roleKey, input.scope);
    return this.repository.updateMembership({
      tenantId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      targetUserId,
      roleKey: input.roleKey,
      scope: input.scope,
      active: input.active,
      requestId: actor.requestId,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: actor.reason,
      now: this.now(),
    });
  }

  public revokeInvitation(
    tenantId: VerifiedTenantId,
    invitationId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ) {
    return this.repository.revokeInvitation({
      tenantId,
      invitationId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      requestId: actor.requestId,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: actor.reason,
      now: this.now(),
    });
  }

  public readSessions(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ) {
    return this.repository.readSessions({
      tenantId,
      targetUserId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      requestId: actor.requestId,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: actor.reason,
      now: this.now(),
    });
  }

  public revokeSession(
    tenantId: VerifiedTenantId,
    targetUserId: string,
    targetSessionId: string,
    actor: Omit<StaffActorContext, 'idempotencyKey'>,
  ) {
    return this.repository.revokeSession({
      tenantId,
      targetUserId,
      targetSessionId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      requestId: actor.requestId,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: actor.reason,
      now: this.now(),
    });
  }

  private digest(token: string) {
    return createHmac('sha256', this.tokenDigestSecret).update(token, 'utf8').digest('hex');
  }
}

function validateScope(
  mode: 'tenant' | 'branch_area_route',
  role: TenantRole,
  scope: AuthorizationScope,
): void {
  const values = [scope.branchIds, scope.areaIds, scope.routeIds, scope.recordIds].filter(
    (item): item is readonly string[] => item !== undefined,
  );
  if (mode === 'tenant' && values.some((item) => item.length > 0)) {
    throw new StaffInvitationInvalidError();
  }
  if (mode === 'branch_area_route' && !values.some((item) => item.length > 0)) {
    throw new StaffInvitationInvalidError();
  }
  if (role === 'collector' && !scope.routeIds?.length) {
    throw new StaffInvitationInvalidError();
  }
}
