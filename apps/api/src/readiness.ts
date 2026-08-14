import type { createDatabase } from '@isp/database';

type DatabaseClient = ReturnType<typeof createDatabase>['client'];

export async function assertControlDatabaseReady(client: DatabaseClient): Promise<void> {
  const state = await client.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_control_runtime');
    const [result] = await transaction.unsafe('SELECT * FROM public.control_center_readiness()');
    const [auth] = await transaction.unsafe('SELECT * FROM public.auth_readiness()');
    return { result, auth };
  });
  if (
    !state.result?.relations_ready ||
    !state.result.migrations_ready ||
    !state.result.runtime_role_ready ||
    !state.result.context_key_ready ||
    !state.result.privileges_ready ||
    !state.auth?.relations_ready ||
    !state.auth.migration_ready ||
    !state.auth.functions_ready
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
         AND operations.subscription_state_ready AS operations_ready
     FROM public.operations_readiness() operations`,
  );
  if (
    !state?.relations_ready ||
    !state.migrations_ready ||
    !state.guard_and_outbox_invariants_ready ||
    !state.operations_ready
  ) {
    throw new Error('Tenant database finance schema or guard invariant is not ready.');
  }
}
