import {
  peopleCommandSchema,
  peopleQuerySchema,
  regulatoryCommandSchema,
  regulatoryQuerySchema,
  type PeopleCommand,
  type PeopleQuery,
  type PeopleWorkspace,
  type RegulatoryCommand,
  type RegulatoryQuery,
  type RegulatoryWorkspace,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

type Signed = { readonly authorization: SignedOperationsDatabaseContext };

async function runCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  fn: 'execute_regulatory_command' | 'execute_people_command',
  command: unknown,
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: Record<string, unknown> }>(
      fn === 'execute_regulatory_command'
        ? sql`SELECT execute_regulatory_command(${JSON.stringify(command)}::jsonb) AS result`
        : sql`SELECT execute_people_command(${JSON.stringify(command)}::jsonb) AS result`,
    );
    if (!row) throw new Error(`${fn} returned no result.`);
    return row.result;
  });
}

/** Licences, obligations, KPI definitions and submissions (permission tenant.user.administer). */
export async function executeRegulatoryCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: RegulatoryCommand },
): Promise<Record<string, unknown>> {
  const command = regulatoryCommandSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_regulatory_command', command);
}

export async function readRegulatoryWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly query?: Partial<RegulatoryQuery> },
): Promise<RegulatoryWorkspace> {
  const query = regulatoryQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: RegulatoryWorkspace }>(
      sql`SELECT read_regulatory_workspace(${query.from ?? null}::date, ${query.to ?? null}::date) AS result`,
    );
    if (!row) throw new Error('Regulatory workspace returned no result.');
    return row.result;
  });
}

/** Teams, employees, shifts, leave and training (permission tenant.user.administer). */
export async function executePeopleCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly command: PeopleCommand },
): Promise<Record<string, unknown>> {
  const command = peopleCommandSchema.parse(input.command);
  return runCommand(database, tenantId, input.authorization, 'execute_people_command', command);
}

export async function readPeopleWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: Signed & { readonly query?: Partial<PeopleQuery> },
): Promise<PeopleWorkspace> {
  const query = peopleQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{ result: PeopleWorkspace }>(
      sql`SELECT read_people_workspace(${query.from ?? null}::date, ${query.to ?? null}::date) AS result`,
    );
    if (!row) throw new Error('People workspace returned no result.');
    return row.result;
  });
}
