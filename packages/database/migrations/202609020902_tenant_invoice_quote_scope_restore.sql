-- Preserve every established delivery read path while adding the narrow invoice-post read path.
DROP POLICY sales_quotes_scope ON sales_quotes;
CREATE POLICY sales_quotes_scope ON sales_quotes USING(
  sales_current_permission_is(ARRAY[
    'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
    'tenant.network.job.create','tenant.installation.manage','tenant.invoice.post'
  ])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);

CREATE OR REPLACE FUNCTION legal_invoice_policy_readiness()
RETURNS TABLE(migration_ready boolean,policy_ready boolean,invoice_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202609020900_tenant_legal_invoice_policy.sql')
      AND EXISTS(SELECT 1 FROM _orvex_migrations
        WHERE name='202609020901_tenant_invoice_quote_discount_scope.sql')
      AND EXISTS(SELECT 1 FROM _orvex_migrations
        WHERE name='202609020902_tenant_invoice_quote_scope_restore.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_billing_policies'
        AND column_name='supplier_tax_registration_number'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_invoice_preparations'
        AND column_name='legal_invoice_snapshot')
$$;
