-- PRD-FIN-004: recurring preparation may read branch/global legal billing configuration while
-- the service, run, preparation, usage, and addon rows remain protected by full branch/area/route
-- scope. Without this dimensional policy, a route-scoped operator cannot read a branch parent.
CREATE POLICY operations_billing_policies_recurring_prepare_read ON operations_billing_policies
  FOR SELECT USING(EXISTS(
    SELECT 1 FROM operations_current_context() context_row
    WHERE context_row.tenant_id=operations_billing_policies.tenant_id
      AND context_row.action IN ('tenant.billing.prepare','support.tenant.billing.prepare')
      AND context_row.permission='tenant.invoice.create'
      AND (operations_billing_policies.branch_id IS NULL OR context_row.branch_ids IS NULL
        OR operations_billing_policies.branch_id=ANY(context_row.branch_ids))
  ));

CREATE OR REPLACE FUNCTION billing_recovery_dunning_readiness()
RETURNS TABLE(migration_ready boolean,run_items_ready boolean,dunning_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202609021000_tenant_billing_recovery_dunning.sql')
      AND EXISTS(SELECT 1 FROM _orvex_migrations
        WHERE name='202609021001_tenant_billing_prepare_policy_read.sql'),
    to_regclass('public.operations_billing_run_items') IS NOT NULL,
    to_regclass('public.operations_dunning_policy_versions') IS NOT NULL
      AND to_regclass('public.operations_dunning_cases') IS NOT NULL
      AND to_regclass('public.operations_dunning_events') IS NOT NULL,
    to_regprocedure('public.append_billing_recovery_audit_outbox()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION billing_recovery_dunning_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_recovery_dunning_readiness() TO orvex_runtime;
