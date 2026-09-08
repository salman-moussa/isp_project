import type {
  IntegrationKind,
  IntegrationSettingEvent,
  IntegrationSettingRecord,
  TenantIntegrationWorkspace,
  VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  parseStoredIntegrationDelivery,
  type StoredIntegrationDelivery,
} from '../control-center/integrations.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface TenantIntegrationCommandInput {
  /** Command JSON without any secret material; a keyed fingerprint stands in for the secret. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly secretCiphertext?: Uint8Array;
  readonly authorization: SignedOperationsDatabaseContext;
}

export async function executeIntegrationSettingsCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: TenantIntegrationCommandInput,
): Promise<IntegrationSettingRecord & Record<string, unknown>> {
  const ciphertext = input.secretCiphertext ? Buffer.from(input.secretCiphertext) : null;
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly result: IntegrationSettingRecord & Record<string, unknown>;
    }>(
      sql`SELECT execute_integration_settings_command(${JSON.stringify(input.payload)}::jsonb, ${ciphertext}::bytea) AS result`,
    );
    if (!row) throw new Error('Integration settings command returned no result.');
    return row.result;
  });
}

export async function readTenantIntegrationSettings(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<TenantIntegrationWorkspace> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const settings = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly record: IntegrationSettingRecord;
    }>(
      sql`SELECT operations_integration_setting_view(s) AS record FROM operations_integration_settings s
          WHERE s.tenant_id = ${tenantId} ORDER BY s.kind`,
    );
    const events = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly kind: IntegrationKind;
      readonly version: number;
      readonly action: 'configure' | 'test';
      readonly actor_id: string;
      readonly reason_en: string;
      readonly reason_ar: string;
      readonly secret_changed: boolean;
      readonly test_status: 'passed' | 'failed' | null;
      readonly test_message: string | null;
      readonly occurred_at: Date | string;
    }>(
      sql`SELECT id, kind, version, action, actor_id, reason_en, reason_ar, secret_changed, test_status,
            test_message, occurred_at
          FROM operations_integration_setting_events WHERE tenant_id = ${tenantId}
          ORDER BY occurred_at DESC LIMIT 50`,
    );
    return {
      settings: settings.map((row) => row.record),
      events: events.map(
        (row): IntegrationSettingEvent => ({
          id: row.id,
          kind: row.kind,
          version: Number(row.version),
          action: row.action,
          actorId: row.actor_id,
          reason: row.reason_en,
          reasonAr: row.reason_ar,
          secretChanged: row.secret_changed,
          testStatus: row.test_status,
          testMessage: row.test_message,
          occurredAt: new Date(row.occurred_at).toISOString(),
        }),
      ),
    };
  });
}

export async function readTenantIntegrationDelivery(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  kind: IntegrationKind,
): Promise<StoredIntegrationDelivery | null> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly result: unknown;
    }>(sql`SELECT read_integration_delivery_settings(${kind}) AS result`);
    return parseStoredIntegrationDelivery(row?.result);
  });
}
