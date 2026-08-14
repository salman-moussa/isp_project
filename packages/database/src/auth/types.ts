import type { Permission } from '@isp/contracts';

export type AuthAudience = 'platform' | 'tenant';

export interface CanonicalAuthorization {
  readonly audience: AuthAudience;
  readonly tenantId?: string;
  readonly authorizationVersion: number;
  readonly permissions: readonly Permission[];
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}

export interface AuthPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly mfaRequired: boolean;
  readonly authorizations: readonly CanonicalAuthorization[];
}

export interface StoredMfaChallenge {
  readonly id: string;
  readonly userId: string;
  readonly audience: AuthAudience;
  readonly tenantId?: string;
  readonly adapterReference: string;
  readonly expiresAt: Date;
  readonly consumedAt?: Date;
  readonly attempts: number;
}

export interface AuthSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly audience: AuthAudience;
  readonly tenantId?: string;
  readonly authorizationVersion: number;
  readonly mfaVerifiedAt?: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt?: Date;
  readonly deviceLabel?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export type RefreshRotationResult =
  | { readonly outcome: 'invalid' | 'reuse' }
  | { readonly outcome: 'rotated'; readonly session: AuthSessionRecord };

export interface AuthSecurityEvent {
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly action: string;
  readonly result: 'allowed' | 'denied' | 'failed';
  readonly reasonCode: string;
  readonly requestId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface AuthRepository {
  findPrincipalByEmail(normalizedEmail: string): Promise<AuthPrincipal | null>;
  readAuthorization(
    userId: string,
    audience: AuthAudience,
    tenantId?: string,
  ): Promise<CanonicalAuthorization | null>;
  createMfaChallenge(input: Omit<StoredMfaChallenge, 'attempts' | 'consumedAt'>): Promise<void>;
  readMfaChallenge(id: string, now: Date): Promise<StoredMfaChallenge | null>;
  consumeMfaChallenge(id: string, now: Date): Promise<StoredMfaChallenge | null>;
  recordMfaFailure(id: string, now: Date, maximumAttempts: number): Promise<void>;
  createSession(
    input: AuthSessionRecord & { readonly refreshDigest: string; readonly tokenFamilyId: string },
  ): Promise<void>;
  rotateRefresh(
    presentedDigest: string,
    replacementDigest: string,
    now: Date,
    idleExpiresAt: Date,
  ): Promise<RefreshRotationResult>;
  listSessions(userId: string, now: Date): Promise<readonly AuthSessionRecord[]>;
  revokeSession(userId: string, sessionId: string, now: Date, reason: string): Promise<boolean>;
  revokeAllSessions(userId: string, now: Date, reason: string): Promise<number>;
  createRecoveryToken(input: {
    readonly userId: string;
    readonly digest: string;
    readonly idempotencyKey: string;
    readonly expiresAt: Date;
  }): Promise<boolean>;
  completeRecovery(input: {
    readonly digest: string;
    readonly passwordHash: string;
    readonly now: Date;
  }): Promise<boolean>;
  appendSecurityEvent(event: AuthSecurityEvent): Promise<void>;
}
