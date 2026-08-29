import type { Permission, SessionClaims } from '@isp/contracts';
import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
const PASSWORD_PREFIX = 'scrypt$v=1';
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_PASSWORD_HASH = `${PASSWORD_PREFIX}$N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

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
export interface MfaChallengeRecord {
  readonly id: string;
  readonly userId: string;
  readonly audience: AuthAudience;
  readonly tenantId?: string;
  readonly adapterReference: string;
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly consumedAt?: Date;
}
export interface SessionRecord {
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
export interface AuthRepositoryPort {
  findPrincipalByEmail(email: string): Promise<AuthPrincipal | null>;
  readAuthorization(
    userId: string,
    audience: AuthAudience,
    tenantId?: string,
  ): Promise<CanonicalAuthorization | null>;
  createMfaChallenge(input: Omit<MfaChallengeRecord, 'attempts' | 'consumedAt'>): Promise<void>;
  readMfaChallenge(id: string, now: Date): Promise<MfaChallengeRecord | null>;
  consumeMfaChallenge(id: string, now: Date): Promise<MfaChallengeRecord | null>;
  recordMfaFailure(id: string, now: Date, maximumAttempts: number): Promise<void>;
  createSession(
    input: SessionRecord & { refreshDigest: string; tokenFamilyId: string },
  ): Promise<void>;
  rotateRefresh(
    presentedDigest: string,
    replacementDigest: string,
    now: Date,
    idleExpiresAt: Date,
  ): Promise<{ outcome: 'invalid' | 'reuse' } | { outcome: 'rotated'; session: SessionRecord }>;
  listSessions(userId: string, now: Date): Promise<readonly SessionRecord[]>;
  revokeSession(userId: string, sessionId: string, now: Date, reason: string): Promise<boolean>;
  revokeAllSessions(userId: string, now: Date, reason: string): Promise<number>;
  createRecoveryToken(input: {
    userId: string;
    digest: string;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<boolean>;
  completeRecovery(input: { digest: string; passwordHash: string; now: Date }): Promise<boolean>;
  appendSecurityEvent(event: SecurityEvent): Promise<void>;
}
export interface SecurityEvent {
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
export interface AccessTokenIssuer {
  issue(claims: SessionClaims, expiresAt: Date): Promise<string>;
}
export interface OtpAdapter {
  start(input: {
    userId: string;
    challengeId: string;
    expiresAt: Date;
  }): Promise<{ adapterReference: string }>;
  verify(input: { adapterReference: string; code: string }): Promise<boolean>;
}
export interface RecoveryDeliveryAdapter {
  deliver(input: { userId: string; email: string; token: string; expiresAt: Date }): Promise<void>;
}
export interface RequestEvidence {
  readonly requestId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}
export interface AuthServiceOptions {
  readonly tokenDigestSecret: Uint8Array;
  readonly idleTtlMs?: number;
  readonly absoluteTtlMs?: number;
  readonly accessTtlMs?: number;
  readonly mfaTtlMs?: number;
  readonly recoveryTtlMs?: number;
  readonly maximumMfaAttempts?: number;
  readonly now?: () => Date;
}

export class InvalidCredentialsError extends Error {
  public readonly statusCode = 401;
  public constructor() {
    super('Authentication could not be completed.');
    this.name = 'InvalidCredentialsError';
  }
}
export class InvalidSessionError extends Error {
  public readonly statusCode = 401;
  public constructor() {
    super('The session is unavailable.');
    this.name = 'InvalidSessionError';
  }
}
export class PasswordPolicyError extends Error {
  public readonly statusCode = 400;
  public constructor() {
    super('The password must contain 12 to 128 characters.');
    this.name = 'PasswordPolicyError';
  }
}

export type LoginResult =
  | { readonly status: 'mfa_required'; readonly challengeId: string; readonly expiresAt: string }
  | SessionTokens;
export interface SessionTokens {
  readonly status: 'authenticated';
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
  readonly sessionId: string;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly accessTtlMs: number;
  private readonly mfaTtlMs: number;
  private readonly recoveryTtlMs: number;
  private readonly maximumMfaAttempts: number;
  public constructor(
    private readonly repository: AuthRepositoryPort,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly otp: OtpAdapter,
    private readonly recovery: RecoveryDeliveryAdapter,
    private readonly options: AuthServiceOptions,
  ) {
    if (options.tokenDigestSecret.byteLength < 32)
      throw new Error('Auth token digest secret must be at least 32 bytes.');
    this.now = options.now ?? (() => new Date());
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60_000;
    this.absoluteTtlMs = options.absoluteTtlMs ?? 30 * 24 * 60 * 60_000;
    this.accessTtlMs = options.accessTtlMs ?? 10 * 60_000;
    this.mfaTtlMs = options.mfaTtlMs ?? 5 * 60_000;
    this.recoveryTtlMs = options.recoveryTtlMs ?? 30 * 60_000;
    this.maximumMfaAttempts = options.maximumMfaAttempts ?? 5;
  }

  public async login(
    input: {
      email: string;
      password: string;
      audience: AuthAudience;
      tenantId?: string;
      deviceLabel?: string;
    },
    evidence: RequestEvidence,
  ): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const principal = await this.repository.findPrincipalByEmail(email);
    const valid = await verifyPassword(
      input.password,
      principal?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const authorization = principal?.authorizations.find(
      (a) => a.audience === input.audience && a.tenantId === input.tenantId,
    );
    if (!principal || !valid || !authorization) {
      await this.audit(evidence, {
        action: 'auth.login',
        result: 'denied',
        reasonCode: 'invalid_credentials_or_audience',
      });
      throw new InvalidCredentialsError();
    }
    if (principal.mfaRequired) {
      const now = this.now();
      const challengeId = randomUUID();
      const expiresAt = new Date(now.getTime() + this.mfaTtlMs);
      const started = await this.otp.start({ userId: principal.userId, challengeId, expiresAt });
      await this.repository.createMfaChallenge({
        id: challengeId,
        userId: principal.userId,
        audience: authorization.audience,
        ...(authorization.tenantId ? { tenantId: authorization.tenantId } : {}),
        adapterReference: started.adapterReference,
        expiresAt,
      });
      await this.audit(evidence, {
        actorId: principal.userId,
        action: 'auth.login',
        result: 'allowed',
        reasonCode: 'mfa_challenge_created',
      });
      return { status: 'mfa_required', challengeId, expiresAt: expiresAt.toISOString() };
    }
    return this.createSession(
      principal.userId,
      authorization,
      undefined,
      input.deviceLabel,
      evidence,
    );
  }

  public async verifyMfa(
    input: { challengeId: string; code: string; deviceLabel?: string },
    evidence: RequestEvidence,
  ): Promise<SessionTokens> {
    const now = this.now();
    const challenge = await this.repository.readMfaChallenge(input.challengeId, now);
    const valid = challenge
      ? await this.otp.verify({ adapterReference: challenge.adapterReference, code: input.code })
      : false;
    if (!challenge || !valid) {
      if (challenge)
        await this.repository.recordMfaFailure(challenge.id, now, this.maximumMfaAttempts);
      await this.audit(evidence, {
        ...(challenge ? { actorId: challenge.userId } : {}),
        action: 'auth.mfa.verify',
        result: 'denied',
        reasonCode: 'invalid_or_expired',
      });
      throw new InvalidCredentialsError();
    }
    const consumed = await this.repository.consumeMfaChallenge(challenge.id, now);
    if (!consumed) {
      await this.audit(evidence, {
        actorId: challenge.userId,
        action: 'auth.mfa.verify',
        result: 'denied',
        reasonCode: 'already_consumed',
      });
      throw new InvalidCredentialsError();
    }
    const authorization = await this.repository.readAuthorization(
      challenge.userId,
      challenge.audience,
      challenge.tenantId,
    );
    if (!authorization) {
      await this.audit(evidence, {
        actorId: challenge.userId,
        action: 'auth.mfa.verify',
        result: 'denied',
        reasonCode: 'authorization_changed',
      });
      throw new InvalidCredentialsError();
    }
    return this.createSession(challenge.userId, authorization, now, input.deviceLabel, evidence);
  }

  public async startMfaStepUp(
    input: {
      readonly userId: string;
      readonly audience: AuthAudience;
      readonly tenantId?: string;
    },
    evidence: RequestEvidence,
  ): Promise<{
    readonly status: 'mfa_required';
    readonly challengeId: string;
    readonly expiresAt: string;
  }> {
    const authorization = await this.repository.readAuthorization(
      input.userId,
      input.audience,
      input.tenantId,
    );
    if (!authorization) {
      await this.audit(evidence, {
        actorId: input.userId,
        action: 'auth.mfa.step_up',
        result: 'denied',
        reasonCode: 'authorization_changed',
      });
      throw new InvalidSessionError();
    }
    const now = this.now();
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + this.mfaTtlMs);
    const started = await this.otp.start({ userId: input.userId, challengeId, expiresAt });
    await this.repository.createMfaChallenge({
      id: challengeId,
      userId: input.userId,
      audience: authorization.audience,
      ...(authorization.tenantId ? { tenantId: authorization.tenantId } : {}),
      adapterReference: started.adapterReference,
      expiresAt,
    });
    await this.audit(evidence, {
      actorId: input.userId,
      action: 'auth.mfa.step_up',
      result: 'allowed',
      reasonCode: 'challenge_created',
    });
    return { status: 'mfa_required', challengeId, expiresAt: expiresAt.toISOString() };
  }

  public async refresh(refreshToken: string, evidence: RequestEvidence): Promise<SessionTokens> {
    const now = this.now();
    const replacement = randomToken();
    const result = await this.repository.rotateRefresh(
      this.digest(refreshToken),
      this.digest(replacement),
      now,
      new Date(now.getTime() + this.idleTtlMs),
    );
    if (result.outcome !== 'rotated') {
      await this.audit(evidence, {
        action: 'auth.refresh',
        result: 'denied',
        reasonCode: result.outcome === 'reuse' ? 'refresh_reuse_detected' : 'invalid_refresh',
      });
      throw new InvalidSessionError();
    }
    const authorization = await this.repository.readAuthorization(
      result.session.userId,
      result.session.audience,
      result.session.tenantId,
    );
    if (
      !authorization ||
      authorization.authorizationVersion !== result.session.authorizationVersion
    ) {
      await this.repository.revokeSession(
        result.session.userId,
        result.session.id,
        now,
        'authorization_changed',
      );
      await this.audit(evidence, {
        actorId: result.session.userId,
        sessionId: result.session.id,
        action: 'auth.refresh',
        result: 'denied',
        reasonCode: 'authorization_changed',
      });
      throw new InvalidSessionError();
    }
    const accessExpiresAt = minDate(
      new Date(now.getTime() + this.accessTtlMs),
      result.session.absoluteExpiresAt,
    );
    const accessToken = await this.accessTokens.issue(
      toClaims(
        result.session.id,
        result.session.userId,
        authorization,
        result.session.mfaVerifiedAt,
      ),
      accessExpiresAt,
    );
    await this.audit(evidence, {
      actorId: result.session.userId,
      sessionId: result.session.id,
      action: 'auth.refresh',
      result: 'allowed',
      reasonCode: 'rotated',
    });
    return {
      status: 'authenticated',
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: replacement,
      refreshExpiresAt: minDate(
        result.session.idleExpiresAt,
        result.session.absoluteExpiresAt,
      ).toISOString(),
      sessionId: result.session.id,
    };
  }

  public listSessions(userId: string): Promise<readonly SessionRecord[]> {
    return this.repository.listSessions(userId, this.now());
  }
  public async revokeSession(
    userId: string,
    sessionId: string,
    evidence: RequestEvidence,
  ): Promise<void> {
    await this.repository.revokeSession(userId, sessionId, this.now(), 'user_logout');
    await this.audit(evidence, {
      actorId: userId,
      sessionId,
      action: 'auth.session.revoke',
      result: 'allowed',
      reasonCode: 'requested',
    });
  }
  public async revokeAllSessions(userId: string, evidence: RequestEvidence): Promise<void> {
    await this.repository.revokeAllSessions(userId, this.now(), 'user_revoke_all');
    await this.audit(evidence, {
      actorId: userId,
      action: 'auth.session.revoke_all',
      result: 'allowed',
      reasonCode: 'requested',
    });
  }

  public async startRecovery(
    emailInput: string,
    idempotencyKey: string,
    evidence: RequestEvidence,
  ): Promise<void> {
    const principal = await this.repository.findPrincipalByEmail(normalizeEmail(emailInput));
    if (principal) {
      const now = this.now();
      const token = randomToken();
      const expiresAt = new Date(now.getTime() + this.recoveryTtlMs);
      const created = await this.repository.createRecoveryToken({
        userId: principal.userId,
        digest: this.digest(token),
        idempotencyKey,
        expiresAt,
      });
      if (created)
        await this.recovery.deliver({
          userId: principal.userId,
          email: principal.email,
          token,
          expiresAt,
        });
    }
    await this.audit(evidence, {
      ...(principal ? { actorId: principal.userId } : {}),
      action: 'auth.recovery.start',
      result: 'allowed',
      reasonCode: 'generic_response',
    });
  }
  public async completeRecovery(
    token: string,
    newPassword: string,
    evidence: RequestEvidence,
  ): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    const completed = await this.repository.completeRecovery({
      digest: this.digest(token),
      passwordHash,
      now: this.now(),
    });
    await this.audit(evidence, {
      action: 'auth.recovery.complete',
      result: completed ? 'allowed' : 'denied',
      reasonCode: completed ? 'completed' : 'invalid_or_expired',
    });
  }

  private async createSession(
    userId: string,
    authorization: CanonicalAuthorization,
    mfaVerifiedAt: Date | undefined,
    deviceLabel: string | undefined,
    evidence: RequestEvidence,
  ): Promise<SessionTokens> {
    const now = this.now();
    const id = randomUUID();
    const refreshToken = randomToken();
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteTtlMs);
    const idleExpiresAt = minDate(new Date(now.getTime() + this.idleTtlMs), absoluteExpiresAt);
    const record: SessionRecord = {
      id,
      userId,
      audience: authorization.audience,
      ...(authorization.tenantId ? { tenantId: authorization.tenantId } : {}),
      authorizationVersion: authorization.authorizationVersion,
      ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}),
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      ...(deviceLabel ? { deviceLabel } : {}),
      ...(evidence.ipAddress ? { ipAddress: evidence.ipAddress } : {}),
      ...(evidence.userAgent ? { userAgent: evidence.userAgent } : {}),
    };
    await this.repository.createSession({
      ...record,
      refreshDigest: this.digest(refreshToken),
      tokenFamilyId: randomUUID(),
    });
    const accessExpiresAt = minDate(new Date(now.getTime() + this.accessTtlMs), absoluteExpiresAt);
    const accessToken = await this.accessTokens.issue(
      toClaims(id, userId, authorization, mfaVerifiedAt),
      accessExpiresAt,
    );
    await this.audit(evidence, {
      actorId: userId,
      sessionId: id,
      action: 'auth.session.create',
      result: 'allowed',
      reasonCode: mfaVerifiedAt ? 'mfa_verified' : 'password_verified',
    });
    return {
      status: 'authenticated',
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      refreshExpiresAt: idleExpiresAt.toISOString(),
      sessionId: id,
    };
  }
  private digest(token: string): string {
    return createHmac('sha256', this.options.tokenDigestSecret).update(token, 'utf8').digest('hex');
  }
  private audit(
    evidence: RequestEvidence,
    event: Omit<SecurityEvent, 'requestId' | 'ipAddress' | 'userAgent' | 'occurredAt'>,
  ): Promise<void> {
    return this.repository.appendSecurityEvent({
      ...event,
      requestId: evidence.requestId,
      ...(evidence.ipAddress ? { ipAddress: evidence.ipAddress } : {}),
      ...(evidence.userAgent ? { userAgent: evidence.userAgent } : {}),
      occurredAt: this.now(),
    });
  }
}

export async function hashPassword(password: string): Promise<string> {
  validateNewPassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `${PASSWORD_PREFIX}$N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) {
    await derive(password, Buffer.alloc(16), SCRYPT_N, SCRYPT_R, SCRYPT_P);
    return false;
  }
  const actual = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p);
  return actual.length === parsed.digest.length && timingSafeEqual(actual, parsed.digest);
}
export function credentialRateLimitKey(email: string, secret: Uint8Array): string {
  return createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
}
function validateNewPassword(password: string) {
  if (password.length < 12 || password.length > 128) throw new PasswordPolicyError();
}
async function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: n, r, p, maxmem: SCRYPT_MAX_MEMORY },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}
function parseHash(encoded: string) {
  const match =
    /^scrypt\$v=1\$N=(\d+)\$r=(\d+)\$p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(
      encoded,
    );
  if (!match) return null;
  const n = Number(match[1]),
    r = Number(match[2]),
    p = Number(match[3]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;
  const salt = Buffer.from(match[4]!, 'base64'),
    digest = Buffer.from(match[5]!, 'base64');
  return salt.length === 16 && digest.length === SCRYPT_KEY_LENGTH
    ? { n, r, p, salt, digest }
    : null;
}
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
function minDate(a: Date, b: Date): Date {
  return a.getTime() < b.getTime() ? a : b;
}
function toClaims(
  sessionId: string,
  userId: string,
  authorization: CanonicalAuthorization,
  mfa?: Date,
): SessionClaims {
  return {
    sub: userId,
    sessionId,
    audience: authorization.audience,
    permissions: [...authorization.permissions],
    ...(authorization.tenantId
      ? {
          tenantId: authorization.tenantId,
          authorizationVersion: authorization.authorizationVersion,
        }
      : {}),
    ...(authorization.branchIds ? { branchIds: [...authorization.branchIds] } : {}),
    ...(authorization.areaIds ? { areaIds: [...authorization.areaIds] } : {}),
    ...(authorization.routeIds ? { routeIds: [...authorization.routeIds] } : {}),
    ...(authorization.recordIds ? { recordIds: [...authorization.recordIds] } : {}),
    ...(mfa ? { mfaVerifiedAt: mfa.toISOString() } : {}),
  };
}
