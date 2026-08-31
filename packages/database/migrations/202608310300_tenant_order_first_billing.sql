-- Atomically post the first immutable service invoice and close the accepted service order.
ALTER TABLE sales_service_orders
  ADD COLUMN first_invoice_id uuid,
  ADD COLUMN first_invoice_period_start date,
  ADD COLUMN first_invoice_period_end date,
  ADD CONSTRAINT sales_orders_first_invoice_fk
    FOREIGN KEY(tenant_id,first_invoice_id) REFERENCES finance_invoices(tenant_id,id),
  ADD CONSTRAINT sales_orders_first_invoice_key UNIQUE(tenant_id,first_invoice_id),
  ADD CONSTRAINT sales_orders_first_invoice_shape CHECK(
    (first_invoice_id IS NULL AND first_invoice_period_start IS NULL AND first_invoice_period_end IS NULL)
    OR (first_invoice_id IS NOT NULL AND first_invoice_period_start IS NOT NULL
      AND first_invoice_period_end>first_invoice_period_start)
  );

-- First billing may read only the effective shared plan and tax configuration for an otherwise
-- strictly scoped order. Lower-dimensional area/route claims must not hide branch/global read-only
-- configuration, while every order, installation, and service row remains protected by its normal
-- full-scope policy.
CREATE POLICY operations_plans_first_billing_read ON operations_plans
  FOR SELECT USING(EXISTS(
    SELECT 1 FROM operations_current_context() context_row
    WHERE context_row.tenant_id=operations_plans.tenant_id
      AND context_row.action='tenant.order.first_invoice.post'
      AND context_row.permission='tenant.invoice.post'
      AND (operations_plans.branch_id IS NULL OR context_row.branch_ids IS NULL
        OR operations_plans.branch_id=ANY(context_row.branch_ids))
  ));
CREATE POLICY operations_plan_versions_first_billing_read ON operations_plan_versions
  FOR SELECT USING(EXISTS(
    SELECT 1 FROM operations_current_context() context_row
    JOIN operations_plans plan ON plan.tenant_id=operations_plan_versions.tenant_id
      AND plan.id=operations_plan_versions.plan_id
    WHERE context_row.tenant_id=operations_plan_versions.tenant_id
      AND context_row.action='tenant.order.first_invoice.post'
      AND context_row.permission='tenant.invoice.post'
      AND (plan.branch_id IS NULL OR context_row.branch_ids IS NULL
        OR plan.branch_id=ANY(context_row.branch_ids))
  ));
CREATE POLICY operations_billing_policies_first_billing_read ON operations_billing_policies
  FOR SELECT USING(EXISTS(
    SELECT 1 FROM operations_current_context() context_row
    WHERE context_row.tenant_id=operations_billing_policies.tenant_id
      AND context_row.action='tenant.order.first_invoice.post'
      AND context_row.permission='tenant.invoice.post'
      AND (operations_billing_policies.branch_id IS NULL OR context_row.branch_ids IS NULL
        OR operations_billing_policies.branch_id=ANY(context_row.branch_ids))
  ));
CREATE POLICY operations_billing_policies_sales_workspace_read ON operations_billing_policies
  FOR SELECT USING(EXISTS(
    SELECT 1 FROM operations_current_context() context_row
    WHERE context_row.tenant_id=operations_billing_policies.tenant_id
      AND context_row.action='tenant.sales.workspace.read'
      AND context_row.permission='tenant.sales.view'
      AND (operations_billing_policies.branch_id IS NULL OR context_row.branch_ids IS NULL
        OR operations_billing_policies.branch_id=ANY(context_row.branch_ids))
  ));

CREATE OR REPLACE FUNCTION append_operations_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  context_row operations_request_contexts%ROWTYPE;
  row_value jsonb;
  row_tenant_id uuid;
  row_id text;
  base_action text;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed operations request context is required';
  END IF;
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_tenant_id:=(row_value->>'tenant_id')::uuid;
  row_id:=coalesce(row_value->>'id',row_value->>'event_id',row_value->>'config_key');
  IF row_tenant_id<>context_row.tenant_id OR row_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='operations audit context does not match mutation';
  END IF;
  base_action:=regexp_replace(context_row.action,'^support\.','');
  IF NOT (
    (TG_TABLE_NAME IN ('operations_branches','operations_areas','operations_routes',
      'operations_configuration','operations_configuration_changes')
      AND base_action='tenant.operations.configure' AND context_row.permission='tenant.user.administer')
    OR (TG_TABLE_NAME IN ('operations_households','operations_locations',
      'operations_subscribers','operations_contacts')
      AND base_action='tenant.subscriber.create' AND context_row.permission='tenant.subscriber.create')
    OR (TG_TABLE_NAME IN ('operations_plans','operations_plan_versions')
      AND base_action='tenant.plan.version.create' AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME='operations_billing_policies'
      AND base_action='tenant.billing.policy.version.create' AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME IN ('operations_services','operations_installations')
      AND base_action IN ('tenant.service.installation.create','tenant.installation.transition')
      AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME IN ('operations_billing_runs','operations_invoice_preparations')
      AND base_action='tenant.billing.prepare' AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME IN ('operations_billing_runs','operations_invoice_preparations')
      AND base_action='tenant.order.first_invoice.post' AND context_row.permission='tenant.invoice.post')
    OR (TG_TABLE_NAME='operations_office_payment_requests'
      AND base_action='tenant.payment.office.record' AND context_row.permission='tenant.payment.post')
    OR (TG_TABLE_NAME='operations_office_payment_corrections'
      AND base_action='tenant.payment.correct' AND context_row.permission='tenant.payment.reverse')
    OR (TG_TABLE_NAME='operations_collector_assignments'
      AND base_action='tenant.collection.assign' AND context_row.permission='tenant.collection.reconcile')
    OR (TG_TABLE_NAME='operations_collector_collection_evidence'
      AND base_action='tenant.collection.evidence.record' AND context_row.permission='tenant.payment.post')
    OR (TG_TABLE_NAME='operations_collector_reconciliations'
      AND base_action='tenant.collection.reconcile' AND context_row.permission='tenant.collection.reconcile')
    OR (TG_TABLE_NAME='operations_installation_events'
      AND base_action='tenant.installation.transition' AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME='operations_support_issues'
      AND base_action IN ('tenant.issue.create','tenant.issue.transition')
      AND context_row.permission='tenant.subscriber.edit')
    OR (TG_TABLE_NAME='operations_issue_events'
      AND base_action='tenant.issue.transition' AND context_row.permission='tenant.subscriber.edit')
    OR (TG_TABLE_NAME='operations_export_jobs'
      AND base_action='tenant.report.export' AND context_row.permission='tenant.report.export')
    OR (TG_TABLE_NAME='operations_network_action_outbox'
      AND base_action='tenant.network.job.create' AND context_row.permission='tenant.network.job.create')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',
      MESSAGE='signed action and permission do not authorize this operations mutation';
  END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value
  ) VALUES(
    row_tenant_id,context_row.action,TG_TABLE_NAME,row_id,context_row.actor_id,
    context_row.session_id,context_row.support_grant_id,context_row.permission,
    context_row.request_id,context_row.idempotency_key,context_row.ip_address,
    context_row.user_agent,'allowed',context_row.reason,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION append_sales_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE; row_value jsonb; row_id text;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed sales context is required'; END IF;
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_id:=row_value->>'id';
  IF (row_value->>'tenant_id')::uuid<>context_row.tenant_id OR row_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='sales audit context does not match mutation';
  END IF;
  IF NOT (
    (TG_TABLE_NAME='sales_leads' AND context_row.action='tenant.sales.lead.create' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_qualifications') AND context_row.action='tenant.sales.qualify' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME='sales_offer_versions' AND context_row.action='tenant.catalog.offer.version.create' AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.create' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.approve' AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes','sales_service_orders','sales_order_tasks') AND context_row.action='tenant.sales.quote.accept' AND context_row.permission='tenant.order.manage')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks') AND context_row.action='tenant.subscriber.create' AND context_row.permission='tenant.subscriber.create')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action='tenant.resource.reserve' AND context_row.permission='tenant.network.job.create')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action IN ('tenant.service.installation.create','tenant.installation.transition') AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action IN ('tenant.network.job.create','tenant.network.job.complete') AND context_row.permission='tenant.network.job.create')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks')
      AND context_row.action='tenant.order.first_invoice.post'
      AND context_row.permission='tenant.invoice.post')
  ) THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize sales mutation'; END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value
  ) VALUES(
    context_row.tenant_id,context_row.action,TG_TABLE_NAME,row_id,context_row.actor_id,
    context_row.session_id,context_row.support_grant_id,context_row.permission,context_row.request_id,
    context_row.idempotency_key,context_row.ip_address,context_row.user_agent,'allowed',context_row.reason,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP POLICY sales_leads_scope ON sales_leads;
CREATE POLICY sales_leads_scope ON sales_leads USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage','tenant.invoice.post'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
);
DROP POLICY sales_orders_scope ON sales_service_orders;
CREATE POLICY sales_orders_scope ON sales_service_orders USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage','tenant.invoice.post'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create','tenant.invoice.post'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
DROP POLICY sales_order_tasks_scope ON sales_order_tasks;
CREATE POLICY sales_order_tasks_scope ON sales_order_tasks USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage','tenant.invoice.post'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage','tenant.invoice.post'])
  AND sales_scope_allows_order(tenant_id,order_id)
);

GRANT UPDATE(status,first_invoice_id,first_invoice_period_start,first_invoice_period_end,
  completed_at,updated_at) ON sales_service_orders TO orvex_runtime;

CREATE FUNCTION sales_first_billing_readiness()
RETURNS TABLE(migration_ready boolean,columns_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608310300_tenant_order_first_billing.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='sales_service_orders' AND column_name='first_invoice_id'),
    to_regprocedure('public.append_sales_audit_outbox()') IS NOT NULL
      AND to_regprocedure('public.append_operations_audit_outbox()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION sales_first_billing_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_first_billing_readiness() TO orvex_runtime;
