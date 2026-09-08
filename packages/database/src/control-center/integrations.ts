import type {
  IntegrationKind,
  IntegrationSettingRecord,
  IntegrationTestResult,
  PlatformIntegrationWorkspace,
} from '@isp/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inControlTransaction, mapControlCenterDatabaseError } from './repository.js';
import type { SignedControlDatabaseContext } from './types.js';

type ControlTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface ControlMutation {
  readonly authorization: SignedControlDatabaseContext;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly reason: string;
}

export interface ConfigurePlatformIntegrationInput extends ControlMutation {
  readonly kind: IntegrationKind;
  readonly config: Readonly<Record<string, unknown>>;
  readonly active: boolean;
  readonly secretCiphertext?: Uint8Array;
  readonly cipherKeyId?: string;
  readonly protectedFields: readonly string[];
  readonly keepSecrets: boolean;
  readonly expectedVersion?: number;
}

export interface RecordPlatformIntegrationTestInput extends ControlMutation {
  readonly kind: IntegrationKind;
  readonly status: 'passed' | 'failed';
  readonly message: string;
  readonly recipientMasked: string;
  readonly providerReference?: string;
  readonly errorCode?: string;
}

/** What the API needs to open a provider secret and talk to the provider. Never leaves the API. */
export interface StoredIntegrationDelivery {
  readonly kind: IntegrationKind;
  readonly version: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secretCiphertext?: Uint8Array;
  readonly cipherKeyId?: string;
  readonly protectedFields: readonly string[];
}

export interface AuthDeliveryTarget {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly accountKind: 'platform' | 'tenant';
}

export interface MessageDeliveryEvidence {
  readonly purpose: 'otp' | 'recovery' | 'staff_invitation' | 'integration_test';
  readonly channel: IntegrationKind;
  readonly recipientMasked: string;
  readonly status: 'sent' | 'failed';
  readonly providerReference?: string;
  readonly errorCode?: string;
  readonly userId?: string;
  readonly tenantId?: string;
}

async function selectResult<T>(tx: ControlTransaction, statement: SQL): Promise<T> {
  const [row] = await tx.execute<{ readonly [key: string]: unknown; readonly result: T }>(
    statement,
  );
  if (!row) throw new Error('Control Center function returned no result.');
  return row.result;
}

function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`,`,
      )}]::text[]`;
}

export function readPlatformIntegrationSettings(
  database: Database,
  authorization: SignedControlDatabaseContext,
): Promise<PlatformIntegrationWorkspace> {
  return inControlTransaction(database, authorization, (tx) =>
    selectResult(tx, sql`SELECT read_platform_integration_settings() AS result`),
  );
}

export function configurePlatformIntegration(
  database: Database,
  input: ConfigurePlatformIntegrationInput,
): Promise<IntegrationSettingRecord & { readonly replay: boolean }> {
  const ciphertext = input.secretCiphertext ? Buffer.from(input.secretCiphertext) : null;
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT configure_platform_integration(${input.kind},${JSON.stringify(input.config)}::jsonb,${input.active},${ciphertext}::bytea,${input.cipherKeyId ?? null},${textArray(input.protectedFields)},${input.keepSecrets},${input.expectedVersion ?? null}::integer,${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}

export function recordPlatformIntegrationTest(
  database: Database,
  input: RecordPlatformIntegrationTestInput,
): Promise<IntegrationTestResult> {
  return inControlTransaction(database, input.authorization, (tx) =>
    selectResult(
      tx,
      sql`SELECT record_platform_integration_test(${input.kind},${input.status},${input.message},${input.recipientMasked},${input.providerReference ?? null},${input.errorCode ?? null},${input.reason},${input.idempotencyKey},${input.requestHash}) AS result`,
    ),
  );
}

interface DeliveryRow {
  readonly kind: IntegrationKind;
  readonly version: number;
  readonly config: Record<string, unknown>;
  readonly secretCiphertext: string | null;
  readonly cipherKeyId: string | null;
  readonly protectedFields: readonly string[];
}

export function parseStoredIntegrationDelivery(value: unknown): StoredIntegrationDelivery | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as DeliveryRow;
  return {
    kind: row.kind,
    version: Number(row.version),
    config: row.config ?? {},
    ...(row.secretCiphertext
      ? { secretCiphertext: Buffer.from(row.secretCiphertext, 'base64') }
      : {}),
    ...(row.cipherKeyId ? { cipherKeyId: row.cipherKeyId } : {}),
    protectedFields: row.protectedFields ?? [],
  };
}

/**
 * Runtime-role access used by authentication delivery. These calls happen before any session
 * exists (login OTP), so they carry no signed request context; the SECURITY DEFINER functions
 * they reach are granted only to the API runtime role and expose no plaintext secret.
 */
export class PostgresPlatformIntegrationStore {
  public constructor(private readonly database: Database) {}

  public readIntegration(kind: IntegrationKind): Promise<StoredIntegrationDelivery | null> {
    return this.runtime(async (tx) => {
      const [row] = await tx.execute<{ readonly [key: string]: unknown; readonly result: unknown }>(
        sql`SELECT read_platform_integration_delivery(${kind}) AS result`,
      );
      return parseStoredIntegrationDelivery(row?.result);
    });
  }

  public readTarget(userId: string): Promise<AuthDeliveryTarget | null> {
    return this.runtime(async (tx) => {
      const [row] = await tx.execute<{
        readonly [key: string]: unknown;
        readonly result: AuthDeliveryTarget | null;
      }>(sql`SELECT read_auth_delivery_target(${userId}::uuid) AS result`);
      return row?.result ?? null;
    });
  }

  public storeOtp(challengeId: string, codeDigest: string, expiresAt: Date): Promise<void> {
    return this.runtime(async (tx) => {
      await tx.execute(
        sql`SELECT store_auth_otp_code(${challengeId}::uuid,${codeDigest},${expiresAt.toISOString()}::timestamptz)`,
      );
    });
  }

  public verifyOtp(
    challengeId: string,
    codeDigest: string,
    now: Date,
    maximumAttempts: number,
  ): Promise<boolean> {
    return this.runtime(async (tx) => {
      const [row] = await tx.execute<{ readonly [key: string]: unknown; readonly result: boolean }>(
        sql`SELECT verify_auth_otp_code(${challengeId}::uuid,${codeDigest},${now.toISOString()}::timestamptz,${maximumAttempts}) AS result`,
      );
      return row?.result === true;
    });
  }

  public recordDelivery(evidence: MessageDeliveryEvidence): Promise<void> {
    return this.runtime(async (tx) => {
      await tx.execute(
        sql`SELECT record_platform_message_delivery(${evidence.purpose},${evidence.channel},${evidence.recipientMasked},${evidence.status},${evidence.providerReference ?? null},${evidence.errorCode ?? null},${evidence.userId ?? null},${evidence.tenantId ?? null}::uuid)`,
      );
    });
  }

  private async runtime<T>(work: (tx: ControlTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(async (tx) => {
        await tx.execute(sql.raw('SET LOCAL ROLE orvex_control_runtime'));
        return work(tx);
      });
    } catch (error) {
      throw mapControlCenterDatabaseError(error);
    }
  }
}
