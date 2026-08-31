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
const resourceMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608310000_tenant_order_resource_execution.sql',
);
const installationExecutionMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608310100_tenant_order_installation_execution.sql',
);
const networkExecutionMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608310200_tenant_order_network_execution.sql',
);
const firstBillingMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608310300_tenant_order_first_billing.sql',
);
const orderExceptionMigration = resolve(
  import.meta.dirname,
  '../../migrations/202608310400_tenant_order_exception_commands.sql',
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

  it('reserves scoped capacity behind dependency, idempotency, RLS, and audit guards', async () => {
    const migration = await readFile(resourceMigration, 'utf8');
    expect(migration).toContain('CREATE TABLE operations_capacity_resources');
    expect(migration).toContain('CREATE TABLE sales_order_resource_reservations');
    expect(migration).toContain('operations_capacity_resources_scope_links');
    expect(migration).toContain("context_row.action='tenant.resource.reserve'");
    expect(migration).toContain("context_row.permission='tenant.network.job.create'");
    expect(migration).toContain('sales_resource_execution_readiness');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('links field installation state to the governed service-order dependency chain', async () => {
    const migration = await readFile(installationExecutionMigration, 'utf8');
    expect(migration).toContain('operations_installations_sales_order_fk');
    expect(migration).toContain('sync_sales_order_installation_task');
    expect(migration).toContain("NEW.status='completed'");
    expect(migration).toContain("task_key='network_activation'");
    expect(migration).toContain("context_row.action<>'tenant.installation.transition'");
    expect(migration).toContain('sales_installation_execution_readiness');
  });

  it('completes network activation only from a terminal durable worker result', async () => {
    const migration = await readFile(networkExecutionMigration, 'utf8');
    expect(migration).toContain('sync_sales_order_network_job');
    expect(migration).toContain("session_user<>'orvex_network_worker'");
    expect(migration).toContain("request_value->>'origin'<>'tenant-service-lifecycle'");
    expect(migration).toContain("job_state IN ('reconciled','succeeded')");
    expect(migration).toContain("task_key='first_billing'");
    expect(migration).toContain('FROM PUBLIC,orvex_runtime,orvex_network_worker');
    expect(migration).toContain('sales_network_execution_readiness');
  });

  it('posts first billing through immutable finance and closes the order atomically', async () => {
    const migration = await readFile(firstBillingMigration, 'utf8');
    expect(migration).toContain('sales_orders_first_invoice_fk');
    expect(migration).toContain("base_action='tenant.order.first_invoice.post'");
    expect(migration).toContain("context_row.permission='tenant.invoice.post'");
    expect(migration).toContain('sales_first_billing_readiness');
    expect(migration).toContain('first_invoice_period_end>first_invoice_period_start');
    expect(migration).toContain('operations_plan_versions_first_billing_read');
    expect(migration).toContain('operations_billing_policies_sales_workspace_read');
  });

  it('governs order fallout, recovery, hold, resume, and safe cancellation', async () => {
    const migration = await readFile(orderExceptionMigration, 'utf8');
    expect(migration).toContain('CREATE TABLE sales_order_commands');
    expect(migration).toContain('sync_sales_order_exception_status');
    expect(migration).toContain("command IN ('retry_task','place_on_hold','resume','cancel')");
    expect(migration).toContain("context_row.action='tenant.order.command'");
    expect(migration).toContain('sales_order_exception_readiness');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });
});
