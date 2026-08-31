import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tenantMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608300210_tenant_sales_order_core.sql',
);
const controlMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608300200_control_sales_permissions.sql',
);
const executionMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608300230_tenant_order_subscriber_execution.sql',
);

describe('sales and order migrations', () => {
  it('provides focused canonical permissions and invalidates expanded sessions', async () => {
    const migration = await readFile(controlMigration, 'utf8');
    expect(migration).toContain("'tenant.sales.view'");
    expect(migration).toContain("'tenant.sales.manage'");
    expect(migration).toContain("'tenant.catalog.manage'");
    expect(migration).toContain("'tenant.order.manage'");
    expect(migration).toContain("revoke_reason='canonical_permissions_upgraded'");
    expect(migration).toContain('sales_permissions_readiness');
  });

  it('guards the complete lead-to-order history with RLS, MFA-facing actions, and atomic audit', async () => {
    const migration = await readFile(tenantMigration, 'utf8');
    for (const relation of [
      'sales_leads',
      'sales_offer_versions',
      'sales_qualifications',
      'sales_quotes',
      'sales_service_orders',
      'sales_order_tasks',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${relation}`);
      expect(migration).toContain(`'${relation}'`);
    }
    expect(migration).toContain('ALTER TABLE %I FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('append_sales_audit_outbox');
    expect(migration).toContain("context_row.action='tenant.sales.quote.approve'");
    expect(migration).toContain("context_row.action='tenant.sales.quote.accept'");
    expect(migration).toContain('protect_sales_history');
    expect(migration).toContain('sales_order_readiness');
    expect(migration).not.toContain('GRANT UPDATE, DELETE');
  });

  it('executes subscriber conversion behind dependency, idempotency, RLS, and audit guards', async () => {
    const migration = await readFile(executionMigration, 'utf8');
    expect(migration).toContain('validate_sales_order_task_transition');
    expect(migration).toContain('sales_order_tasks_execution_idempotency_idx');
    expect(migration).toContain("context_row.action='tenant.subscriber.create'");
    expect(migration).toContain("context_row.permission='tenant.subscriber.create'");
    expect(migration).toContain('sales_order_execution_readiness');
    expect(migration).toContain(
      'FOR EACH ROW EXECUTE FUNCTION validate_sales_order_task_transition',
    );
    expect(migration).toContain('operations_hierarchy_scope_allows');
    expect(migration).toContain('operations_households_insert_scope');
  });
});
