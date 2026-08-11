import type { createDatabase } from '@isp/database';

type DatabaseClient = ReturnType<typeof createDatabase>['client'];

export async function assertControlDatabaseReady(client: DatabaseClient): Promise<void> {
  const [state] = await client.unsafe(
    `SELECT
       to_regclass('public.security_events') IS NOT NULL AS relations_ready,
       EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608100030_control_security_audit.sql'
       ) AS migrations_ready`,
  );
  if (!state?.relations_ready || !state.migrations_ready) {
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
       AND to_regclass('public.finance_audit_outbox') IS NOT NULL AS relations_ready,
       EXISTS (
         SELECT 1 FROM public._orvex_migrations
         WHERE name = '202608111700_finance_audit_relay_security.sql'
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
       ) IS NOT NULL AS guard_and_outbox_invariants_ready`,
  );
  if (
    !state?.relations_ready ||
    !state.migrations_ready ||
    !state.guard_and_outbox_invariants_ready
  ) {
    throw new Error('Tenant database finance schema or guard invariant is not ready.');
  }
}
