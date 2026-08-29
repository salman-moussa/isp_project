import type { VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface OperationsScopeItem {
  readonly id: string;
  readonly parentId?: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

export interface OperationsScopeCatalogue {
  readonly branches: readonly OperationsScopeItem[];
  readonly areas: readonly OperationsScopeItem[];
  readonly routes: readonly OperationsScopeItem[];
}

export function readOperationsScopeCatalogue(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<OperationsScopeCatalogue> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const branches = await transaction.execute<ScopeRow>(sql`
      SELECT id, NULL::uuid AS parent_id, code, name_en, name_ar
      FROM operations_branches WHERE tenant_id=${tenantId} AND active ORDER BY code
    `);
    const areas = await transaction.execute<ScopeRow>(sql`
      SELECT id, branch_id AS parent_id, code, name_en, name_ar
      FROM operations_areas WHERE tenant_id=${tenantId} AND active ORDER BY code
    `);
    const routes = await transaction.execute<ScopeRow>(sql`
      SELECT id, area_id AS parent_id, code, name_en, name_ar
      FROM operations_routes WHERE tenant_id=${tenantId} AND active ORDER BY code
    `);
    return {
      branches: branches.map(scopeItem),
      areas: areas.map(scopeItem),
      routes: routes.map(scopeItem),
    };
  });
}

interface ScopeRow extends Record<string, unknown> {
  readonly id: string;
  readonly parent_id: string | null;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
}

function scopeItem(row: ScopeRow): OperationsScopeItem {
  return {
    id: row.id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    code: row.code,
    nameEn: row.name_en,
    nameAr: row.name_ar,
  };
}
