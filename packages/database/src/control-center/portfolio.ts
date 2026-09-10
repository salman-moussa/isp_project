import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inControlTransaction } from './repository.js';
import type { SignedControlDatabaseContext } from './types.js';

// Control Center reads computed by SECURITY DEFINER functions under the signed control context.
// The functions verify the permission and action themselves; these wrappers only carry the
// signed attestation and return the JSON document as-is.

export type ControlMoneyLine = {
  readonly currency: 'USD' | 'LBP';
  readonly amountMinor: number;
};

export interface ControlPortfolioSnapshot {
  readonly asOf: string;
  readonly clients: {
    readonly total: number;
    readonly byState: readonly { readonly state: string; readonly count: number }[];
    readonly newThisMonth: number;
  };
  readonly subscriptions: {
    readonly mrr: readonly (ControlMoneyLine & { readonly subscriptions: number })[];
    readonly renewalsDue: readonly {
      readonly tenantId: string;
      readonly tradingName: string;
      readonly state: string;
      readonly endsAt: string;
      readonly packageKey: string;
      readonly priceMinor: number;
      readonly currency: 'USD' | 'LBP';
    }[];
    readonly pendingTransitions: number;
  };
  readonly billing: {
    readonly outstanding: readonly (ControlMoneyLine & { readonly invoices: number })[];
    readonly receivedThisMonth: readonly (ControlMoneyLine & { readonly payments: number })[];
  };
  readonly service: {
    readonly healthy: number;
    readonly attention: number;
    readonly blocked: number;
    readonly unknown: number;
    readonly openTickets: number;
    readonly escalated: number;
    readonly activeSupportGrants: number;
    readonly requestedSupportGrants: number;
  };
  readonly activity: readonly {
    readonly id: string;
    readonly operation: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly tenantId: string | null;
    readonly tradingName: string | null;
    readonly actor: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[];
}

async function readJson<T>(
  database: Database,
  authorization: SignedControlDatabaseContext,
  statement: ReturnType<typeof sql>,
): Promise<T> {
  return inControlTransaction(database, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: T }>(statement);
    if (!row) throw new Error('Control Center read returned no result.');
    return row.result;
  });
}

export function readControlPortfolio(
  database: Database,
  authorization: SignedControlDatabaseContext,
): Promise<ControlPortfolioSnapshot> {
  return readJson(database, authorization, sql`SELECT read_control_portfolio() AS result`);
}

export function readControlClientDetail(
  database: Database,
  authorization: SignedControlDatabaseContext,
  tenantId: string,
): Promise<Record<string, unknown>> {
  return readJson(
    database,
    authorization,
    sql`SELECT read_control_client_detail(${tenantId}::uuid) AS result`,
  );
}

export function readControlPackages(
  database: Database,
  authorization: SignedControlDatabaseContext,
): Promise<readonly Record<string, unknown>[]> {
  return readJson(database, authorization, sql`SELECT read_control_packages() AS result`);
}

export function readControlSubscriptions(
  database: Database,
  authorization: SignedControlDatabaseContext,
): Promise<readonly Record<string, unknown>[]> {
  return readJson(database, authorization, sql`SELECT read_control_subscriptions() AS result`);
}

export function readControlBilling(
  database: Database,
  authorization: SignedControlDatabaseContext,
  limit = 200,
): Promise<Record<string, unknown>> {
  return readJson(
    database,
    authorization,
    sql`SELECT read_control_billing(${Math.min(Math.max(Math.trunc(limit), 1), 500)}) AS result`,
  );
}

export function readControlAudit(
  database: Database,
  authorization: SignedControlDatabaseContext,
  query: { readonly limit?: number; readonly before?: string } = {},
): Promise<readonly Record<string, unknown>[]> {
  return readJson(
    database,
    authorization,
    sql`SELECT read_control_audit(${Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 500)}, ${query.before ?? null}::timestamptz) AS result`,
  );
}
