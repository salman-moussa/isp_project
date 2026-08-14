import type { Permission } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import type {
  AuthAudience,
  AuthPrincipal,
  AuthRepository,
  AuthSecurityEvent,
  AuthSessionRecord,
  CanonicalAuthorization,
  RefreshRotationResult,
  StoredMfaChallenge,
} from './types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class PostgresAuthRepository implements AuthRepository {
  public constructor(private readonly database: Database) {}

  public async findPrincipalByEmail(normalizedEmail: string): Promise<AuthPrincipal | null> {
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<{ principal: unknown } & Record<string, unknown>>(sql`
        SELECT read_auth_principal(${normalizedEmail}) AS principal
      `);
      return parsePrincipal(row?.principal);
    });
  }

  public async readAuthorization(userId: string, audience: AuthAudience, tenantId?: string) {
    const principal = await this.transaction(async (tx) => {
      const [row] = await tx.execute<{ principal: unknown } & Record<string, unknown>>(sql`
        SELECT read_auth_principal_by_id(${userId}::uuid) AS principal
      `);
      return parsePrincipal(row?.principal);
    });
    return (
      principal?.authorizations.find(
        (candidate) => candidate.audience === audience && candidate.tenantId === tenantId,
      ) ?? null
    );
  }

  public createMfaChallenge(input: Omit<StoredMfaChallenge, 'attempts' | 'consumedAt'>) {
    return this.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO auth_mfa_challenges
        (id,user_id,audience,tenant_id,adapter_reference,expires_at)
        VALUES (${input.id}::uuid,${input.userId}::uuid,${input.audience},${input.tenantId ?? null}::uuid,
          ${input.adapterReference},${input.expiresAt.toISOString()}::text::timestamptz)`);
    });
  }

  public consumeMfaChallenge(id: string, now: Date): Promise<StoredMfaChallenge | null> {
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<MfaRow>(sql`UPDATE auth_mfa_challenges
        SET consumed_at=${now.toISOString()}::text::timestamptz
        WHERE id=${id}::uuid AND consumed_at IS NULL
          AND expires_at>${now.toISOString()}::text::timestamptz AND attempts<10 RETURNING *`);
      return row ? mapMfa(row) : null;
    });
  }

  public readMfaChallenge(id: string, now: Date): Promise<StoredMfaChallenge | null> {
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<MfaRow>(sql`SELECT * FROM auth_mfa_challenges
        WHERE id=${id}::uuid AND consumed_at IS NULL
          AND expires_at>${now.toISOString()}::text::timestamptz AND attempts<10`);
      return row ? mapMfa(row) : null;
    });
  }

  public recordMfaFailure(id: string, now: Date, maximumAttempts: number): Promise<void> {
    return this.transaction(async (tx) => {
      await tx.execute(sql`UPDATE auth_mfa_challenges SET attempts=LEAST(attempts+1,10),
        consumed_at=CASE WHEN attempts+1>=${maximumAttempts}
          THEN ${now.toISOString()}::text::timestamptz ELSE consumed_at END
        WHERE id=${id}::uuid AND consumed_at IS NULL`);
    });
  }

  public createSession(
    input: AuthSessionRecord & { readonly refreshDigest: string; readonly tokenFamilyId: string },
  ): Promise<void> {
    return this.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO auth_sessions
        (id,user_id,audience,tenant_id,authorization_version,token_family_id,
         current_refresh_digest,device_label,ip_address,user_agent,mfa_verified_at,
         last_seen_at,idle_expires_at,absolute_expires_at)
        VALUES (${input.id}::uuid,${input.userId}::uuid,${input.audience},
          ${input.tenantId ?? null}::uuid,${input.authorizationVersion},${input.tokenFamilyId}::uuid,
          ${input.refreshDigest},${input.deviceLabel ?? null},${input.ipAddress ?? null}::inet,
          ${input.userAgent ?? null},${input.mfaVerifiedAt?.toISOString() ?? null}::text::timestamptz,
          ${input.lastSeenAt.toISOString()}::text::timestamptz,
          ${input.idleExpiresAt.toISOString()}::text::timestamptz,
          ${input.absoluteExpiresAt.toISOString()}::text::timestamptz)`);
    });
  }

  public rotateRefresh(
    presentedDigest: string,
    replacementDigest: string,
    now: Date,
    idleExpiresAt: Date,
  ): Promise<RefreshRotationResult> {
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<RotationRow>(sql`SELECT * FROM rotate_auth_refresh_token(
        ${presentedDigest},${replacementDigest},
        ${now.toISOString()}::text::timestamptz,
        ${idleExpiresAt.toISOString()}::text::timestamptz)`);
      if (!row || row.outcome !== 'rotated')
        return { outcome: row?.outcome === 'reuse' ? 'reuse' : 'invalid' };
      return { outcome: 'rotated', session: mapRotation(row, now, idleExpiresAt) };
    });
  }

  public listSessions(userId: string, now: Date): Promise<readonly AuthSessionRecord[]> {
    return this.transaction(async (tx) => {
      const rows = await tx.execute<SessionRow>(sql`SELECT * FROM auth_sessions
        WHERE user_id=${userId}::uuid AND revoked_at IS NULL
          AND idle_expires_at>${now.toISOString()}::text::timestamptz
          AND absolute_expires_at>${now.toISOString()}::text::timestamptz ORDER BY created_at DESC`);
      return rows.map(mapSession);
    });
  }

  public revokeSession(userId: string, sessionId: string, now: Date, reason: string) {
    return this.transaction(async (tx) => {
      const rows = await tx.execute(sql`UPDATE auth_sessions
        SET revoked_at=${now.toISOString()}::text::timestamptz,revoke_reason=${reason}
        WHERE id=${sessionId}::uuid AND user_id=${userId}::uuid AND revoked_at IS NULL RETURNING id`);
      return rows.length === 1;
    });
  }

  public revokeAllSessions(userId: string, now: Date, reason: string) {
    return this.transaction(async (tx) => {
      const rows = await tx.execute(sql`UPDATE auth_sessions
        SET revoked_at=${now.toISOString()}::text::timestamptz,revoke_reason=${reason}
        WHERE user_id=${userId}::uuid AND revoked_at IS NULL RETURNING id`);
      return rows.length;
    });
  }

  public createRecoveryToken(input: {
    userId: string;
    digest: string;
    idempotencyKey: string;
    expiresAt: Date;
  }) {
    return this.transaction(async (tx) => {
      const rows = await tx.execute(sql`INSERT INTO auth_recovery_tokens
        (user_id,token_digest,idempotency_key,expires_at)
        VALUES (${input.userId}::uuid,${input.digest},${input.idempotencyKey},
          ${input.expiresAt.toISOString()}::text::timestamptz)
        ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`);
      return rows.length === 1;
    });
  }

  public completeRecovery(input: { digest: string; passwordHash: string; now: Date }) {
    return this.transaction(async (tx) => {
      const [token] = await tx.execute<{ user_id: string }>(sql`UPDATE auth_recovery_tokens
        SET consumed_at=${input.now.toISOString()}::text::timestamptz
        WHERE token_digest=${input.digest} AND consumed_at IS NULL
          AND expires_at>${input.now.toISOString()}::text::timestamptz RETURNING user_id::text`);
      if (!token) return false;
      await tx.execute(
        sql`UPDATE users SET password_hash=${input.passwordHash} WHERE id=${token.user_id}::uuid`,
      );
      await tx.execute(sql`UPDATE auth_sessions
        SET revoked_at=${input.now.toISOString()}::text::timestamptz,revoke_reason='password_recovery'
        WHERE user_id=${token.user_id}::uuid AND revoked_at IS NULL`);
      return true;
    });
  }

  public appendSecurityEvent(event: AuthSecurityEvent): Promise<void> {
    return this.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO auth_security_events
        (actor_id,session_id,action,result,reason_code,request_id,ip_address,user_agent,metadata,occurred_at)
        VALUES (${event.actorId ?? null}::uuid,${event.sessionId ?? null}::uuid,${event.action},
          ${event.result},${event.reasonCode},${event.requestId},${event.ipAddress ?? null}::inet,
          ${event.userAgent ?? null},${JSON.stringify(event.metadata ?? {})}::jsonb,
          ${event.occurredAt.toISOString()}::text::timestamptz)
        ON CONFLICT(request_id,action) DO NOTHING`);
    });
  }

  private async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
      return work(tx);
    });
  }
}

interface MfaRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  audience: AuthAudience;
  tenant_id: string | null;
  adapter_reference: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  attempts: number;
}
interface SessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  audience: AuthAudience;
  tenant_id: string | null;
  authorization_version: string | number;
  mfa_verified_at: Date | string | null;
  last_seen_at: Date | string;
  idle_expires_at: Date | string;
  absolute_expires_at: Date | string;
  revoked_at: Date | string | null;
  device_label: string | null;
  user_agent: string | null;
}
interface RotationRow extends Record<string, unknown> {
  outcome: string;
  session_id: string;
  user_id: string;
  audience: AuthAudience;
  tenant_id: string | null;
  authorization_version: string | number;
  mfa_verified_at: Date | string | null;
  absolute_expires_at: Date | string;
}

function scope(value: Record<string, unknown>) {
  return {
    ...(stringArray(value.branchIds) ? { branchIds: stringArray(value.branchIds)! } : {}),
    ...(stringArray(value.areaIds) ? { areaIds: stringArray(value.areaIds)! } : {}),
    ...(stringArray(value.routeIds) ? { routeIds: stringArray(value.routeIds)! } : {}),
    ...(stringArray(value.recordIds) ? { recordIds: stringArray(value.recordIds)! } : {}),
  };
}

function parsePrincipal(value: unknown): AuthPrincipal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.userId !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.displayName !== 'string' ||
    typeof candidate.passwordHash !== 'string' ||
    typeof candidate.mfaRequired !== 'boolean' ||
    !Array.isArray(candidate.authorizations)
  ) {
    throw new Error('Authentication authority returned malformed principal data.');
  }
  const authorizations = candidate.authorizations.map(parseAuthorization);
  return {
    userId: candidate.userId,
    email: candidate.email,
    displayName: candidate.displayName,
    passwordHash: candidate.passwordHash,
    mfaRequired: candidate.mfaRequired,
    authorizations,
  };
}

function parseAuthorization(value: unknown): CanonicalAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Authentication authority returned malformed authorization data.');
  }
  const candidate = value as Record<string, unknown>;
  const permissions = stringArray(candidate.permissions);
  const version = Number(candidate.authorizationVersion);
  if (
    (candidate.audience !== 'platform' && candidate.audience !== 'tenant') ||
    !permissions ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (candidate.audience === 'tenant' && typeof candidate.tenantId !== 'string')
  ) {
    throw new Error('Authentication authority returned malformed authorization data.');
  }
  const authorizationScope =
    candidate.scope && typeof candidate.scope === 'object' && !Array.isArray(candidate.scope)
      ? scope(candidate.scope as Record<string, unknown>)
      : {};
  return {
    audience: candidate.audience,
    ...(candidate.audience === 'tenant' ? { tenantId: candidate.tenantId as string } : {}),
    authorizationVersion: version,
    permissions: permissions as Permission[],
    ...authorizationScope,
  };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}
function mapMfa(row: MfaRow): StoredMfaChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    audience: row.audience,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    adapterReference: row.adapter_reference,
    expiresAt: date(row.expires_at),
    ...(row.consumed_at ? { consumedAt: date(row.consumed_at) } : {}),
    attempts: row.attempts,
  };
}
function mapSession(row: SessionRow): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    audience: row.audience,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    authorizationVersion: Number(row.authorization_version),
    ...(row.mfa_verified_at ? { mfaVerifiedAt: date(row.mfa_verified_at) } : {}),
    lastSeenAt: date(row.last_seen_at),
    idleExpiresAt: date(row.idle_expires_at),
    absoluteExpiresAt: date(row.absolute_expires_at),
    ...(row.revoked_at ? { revokedAt: date(row.revoked_at) } : {}),
    ...(row.device_label ? { deviceLabel: row.device_label } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
  };
}
function mapRotation(row: RotationRow, now: Date, idle: Date): AuthSessionRecord {
  return {
    id: row.session_id,
    userId: row.user_id,
    audience: row.audience,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    authorizationVersion: Number(row.authorization_version),
    ...(row.mfa_verified_at ? { mfaVerifiedAt: date(row.mfa_verified_at) } : {}),
    lastSeenAt: now,
    idleExpiresAt: new Date(Math.min(idle.getTime(), date(row.absolute_expires_at).getTime())),
    absoluteExpiresAt: date(row.absolute_expires_at),
  };
}

function date(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Authentication authority returned an invalid timestamp.');
  return parsed;
}
