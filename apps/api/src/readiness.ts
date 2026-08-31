import type { createDatabase } from '@isp/database';

type DatabaseClient = ReturnType<typeof createDatabase>['client'];

export async function assertHttpDependencyReady(
  url: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Required background service is not ready.');
  } catch {
    throw new Error('Required background service is not ready.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertControlDatabaseReady(client: DatabaseClient): Promise<void> {
  const state = await client.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_control_runtime');
    const [result] = await transaction.unsafe('SELECT * FROM public.control_center_readiness()');
    const [auth] = await transaction.unsafe('SELECT * FROM public.auth_readiness()');
    const [staff] = await transaction.unsafe(
      'SELECT * FROM public.tenant_staff_lifecycle_readiness()',
    );
    const [staffSessions] = await transaction.unsafe(
      'SELECT * FROM public.tenant_staff_sessions_readiness()',
    );
    const [salesPermissions] = await transaction.unsafe(
      'SELECT * FROM public.sales_permissions_readiness()',
    );
    return { result, auth, staff, staffSessions, salesPermissions };
  });
  if (
    !state.result?.relations_ready ||
    !state.result.migrations_ready ||
    !state.result.runtime_role_ready ||
    !state.result.context_key_ready ||
    !state.result.privileges_ready ||
    !state.auth?.relations_ready ||
    !state.auth.migration_ready ||
    !state.auth.functions_ready ||
    !state.staff?.relations_ready ||
    !state.staff.migration_ready ||
    !state.staff.functions_ready ||
    !state.staffSessions?.migration_ready ||
    !state.staffSessions.functions_ready ||
    !state.salesPermissions?.migration_ready ||
    !state.salesPermissions.functions_ready ||
    !state.salesPermissions.assignments_ready
  ) {
    throw new Error('Control database schema is not ready.');
  }
}

export async function assertTenantDatabaseReady(client: DatabaseClient): Promise<void> {
  const [state] = await client.unsafe(
    `SELECT
       to_regclass('public.tenant_dashboard_snapshots') IS NOT NULL
       AND to_regclass('public.finance_invoices') IS NOT NULL
       AND to_regclass('public.finance_payments') IS NOT NULL
       AND to_regclass('public.finance_payment_allocations') IS NOT NULL
       AND to_regclass('public.finance_document_guards') IS NOT NULL
       AND to_regclass('public.finance_audit_outbox') IS NOT NULL
       AND to_regclass('public.operations_subscribers') IS NOT NULL
       AND to_regclass('public.operations_audit_outbox') IS NOT NULL
       AND to_regclass('public.operations_platform_subscription_events') IS NOT NULL
       AND to_regclass('public.sales_leads') IS NOT NULL
       AND to_regclass('public.sales_offer_versions') IS NOT NULL
       AND to_regclass('public.sales_qualifications') IS NOT NULL
       AND to_regclass('public.sales_quotes') IS NOT NULL
       AND to_regclass('public.sales_service_orders') IS NOT NULL
       AND to_regclass('public.sales_order_tasks') IS NOT NULL
       AND to_regclass('public.collect_devices') IS NOT NULL
       AND to_regclass('public.collect_sync_operations') IS NOT NULL
       AND to_regclass('public.collect_audit_outbox') IS NOT NULL
       AND to_regprocedure('public.authenticate_collect_device(bytea)') IS NOT NULL
       AND to_regprocedure('public.rotate_collect_device_tokens(bytea,bytea,bytea,timestamp with time zone,timestamp with time zone)') IS NOT NULL AS relations_ready,
       EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608111700_finance_audit_relay_security.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608112200_tenant_operations_core.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608112300_tenant_collect_sync.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608112500_tenant_network_worker.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608300210_tenant_sales_order_core.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608300230_tenant_order_subscriber_execution.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608310000_tenant_order_resource_execution.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608310100_tenant_order_installation_execution.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608310200_tenant_order_network_execution.sql'
       ) AND EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608310300_tenant_order_first_billing.sql'
       ) AS migrations_ready,
       (
         SELECT count(*) = 5
         FROM pg_trigger trigger
         JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND trigger.tgenabled = 'O'
           AND NOT trigger.tgisinternal
           AND trigger.tgname IN (
             'finance_invoices_maintain_guard',
             'finance_payments_maintain_guard',
             'finance_allocations_maintain_guards',
             'finance_invoices_audit_outbox',
             'finance_payments_audit_outbox'
           )
       )
       AND EXISTS (
         SELECT 1 FROM pg_trigger trigger
         JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = 'finance_payment_allocations'
           AND trigger.tgname = 'finance_allocations_audit_outbox'
           AND trigger.tgenabled = 'O'
       )
       AND EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE namespace.nspname = 'public'
           AND relation.relname = 'finance_audit_outbox'
           AND owner_role.rolname = 'orvex_finance_audit_relay_owner'
       )
       AND to_regprocedure('public.list_finance_audit_relay_tenants()') IS NOT NULL
       AND to_regprocedure(
         'public.mark_finance_audit_outbox_delivered(uuid,timestamp with time zone)'
       ) IS NOT NULL AS guard_and_outbox_invariants_ready,
       operations.context_key_ready
         AND operations.subscription_state_ready AS operations_ready,
       sales.migration_ready AND sales.relations_ready AND sales.guards_ready AS sales_ready,
       execution.migration_ready AND execution.columns_ready AND execution.guards_ready
         AS sales_execution_ready,
       resource_execution.migration_ready AND resource_execution.relations_ready
         AND resource_execution.guards_ready AS sales_resource_execution_ready,
       installation_execution.migration_ready AND installation_execution.column_ready
         AND installation_execution.sync_ready AS sales_installation_execution_ready,
       network_execution.migration_ready AND network_execution.sync_ready
         AND network_execution.worker_bridge_ready AS sales_network_execution_ready,
       first_billing.migration_ready AND first_billing.columns_ready
         AND first_billing.audit_ready AS sales_first_billing_ready
     FROM public.operations_readiness() operations
     CROSS JOIN public.sales_order_readiness() sales
     CROSS JOIN public.sales_order_execution_readiness() execution
     CROSS JOIN public.sales_resource_execution_readiness() resource_execution
     CROSS JOIN public.sales_installation_execution_readiness() installation_execution
     CROSS JOIN public.sales_network_execution_readiness() network_execution
     CROSS JOIN public.sales_first_billing_readiness() first_billing`,
  );
  if (
    !state?.relations_ready ||
    !state.migrations_ready ||
    !state.guard_and_outbox_invariants_ready ||
    !state.operations_ready ||
    !state.sales_ready ||
    !state.sales_execution_ready ||
    !state.sales_resource_execution_ready ||
    !state.sales_installation_execution_ready ||
    !state.sales_network_execution_ready ||
    !state.sales_first_billing_ready
  ) {
    throw new Error('Tenant database finance schema or guard invariant is not ready.');
  }
}
