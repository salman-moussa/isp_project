ALTER TABLE operations_installations
  ADD COLUMN sales_order_id uuid,
  ADD CONSTRAINT operations_installations_sales_order_fk
    FOREIGN KEY(tenant_id,sales_order_id) REFERENCES sales_service_orders(tenant_id,id),
  ADD CONSTRAINT operations_installations_sales_order_key UNIQUE(tenant_id,sales_order_id);

CREATE FUNCTION sync_sales_order_installation_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE;
BEGIN
  IF NEW.sales_order_id IS NULL OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND OR context_row.tenant_id<>NEW.tenant_id
    OR context_row.permission<>'tenant.installation.manage'
    OR context_row.action<>'tenant.installation.transition' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed installation transition is required';
  END IF;

  IF NEW.status='blocked' THEN
    UPDATE sales_order_tasks SET status='blocked',last_error=NEW.blocker_reason
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status IN ('ready','running');
  ELSIF NEW.status='scheduled' THEN
    UPDATE sales_order_tasks SET status='ready',last_error=NULL
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='blocked';
  ELSIF NEW.status='in_progress' THEN
    UPDATE sales_order_tasks SET status='running',last_error=NULL
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='ready';
  ELSIF NEW.status='cancelled' THEN
    UPDATE sales_order_tasks SET status='cancelled',last_error='installation cancelled'
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status IN ('ready','running','blocked');
  ELSIF NEW.status='completed' THEN
    UPDATE sales_order_tasks SET status='completed',last_error=NULL,completed_by=context_row.actor_id::uuid,
      result_reference=coalesce(result_reference,'{}'::jsonb)||jsonb_build_object(
        'installationId',NEW.id,'serviceId',NEW.service_id,'installationStatus',NEW.status
      )
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='running';
    UPDATE sales_order_tasks SET status='ready'
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='network_activation' AND status='pending'
      AND EXISTS(
        SELECT 1 FROM sales_order_tasks installation_task
        WHERE installation_task.tenant_id=NEW.tenant_id
          AND installation_task.order_id=NEW.sales_order_id
          AND installation_task.task_key='installation'
          AND installation_task.status='completed'
      );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER operations_installations_order_task_sync
AFTER UPDATE OF status ON operations_installations
FOR EACH ROW EXECUTE FUNCTION sync_sales_order_installation_task();

-- Plans are tenant/branch parents of route-scoped services. Child-scoped operators must be able
-- to use the authorized parent without the legacy helper demanding columns the plan cannot own.
DROP POLICY operations_plans_scope ON operations_plans;
CREATE POLICY operations_plans_scope ON operations_plans
  USING(operations_hierarchy_scope_allows(tenant_id,branch_id))
  WITH CHECK(operations_hierarchy_scope_allows(tenant_id,branch_id));
DROP POLICY operations_plan_versions_scope ON operations_plan_versions;
CREATE POLICY operations_plan_versions_scope ON operations_plan_versions
  USING(EXISTS(
    SELECT 1 FROM operations_plans plan
    WHERE plan.tenant_id=operations_plan_versions.tenant_id
      AND plan.id=operations_plan_versions.plan_id
      AND operations_hierarchy_scope_allows(plan.tenant_id,plan.branch_id)
  ))
  WITH CHECK(EXISTS(
    SELECT 1 FROM operations_plans plan
    WHERE plan.tenant_id=operations_plan_versions.tenant_id
      AND plan.id=operations_plan_versions.plan_id
      AND operations_hierarchy_scope_allows(plan.tenant_id,plan.branch_id)
  ));

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
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
);
DROP POLICY sales_quotes_scope ON sales_quotes;
CREATE POLICY sales_quotes_scope ON sales_quotes USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.network.job.create','tenant.installation.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
DROP POLICY sales_offers_scope ON sales_offer_versions;
CREATE POLICY sales_offers_scope ON sales_offer_versions USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.network.job.create','tenant.installation.manage'])
  AND sales_scope_allows_branch(tenant_id,branch_id,id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.catalog.manage']) AND sales_scope_allows_branch(tenant_id,branch_id,id)
);
DROP POLICY sales_orders_scope ON sales_service_orders;
CREATE POLICY sales_orders_scope ON sales_service_orders USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
DROP POLICY sales_order_tasks_scope ON sales_order_tasks;
CREATE POLICY sales_order_tasks_scope ON sales_order_tasks USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create','tenant.network.job.create','tenant.installation.manage'])
  AND sales_scope_allows_order(tenant_id,order_id)
);

CREATE FUNCTION sales_installation_execution_readiness()
RETURNS TABLE(migration_ready boolean,column_ready boolean,sync_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608310100_tenant_order_installation_execution.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='operations_installations' AND column_name='sales_order_id'),
    to_regprocedure('public.sync_sales_order_installation_task()') IS NOT NULL
$$;

REVOKE ALL ON FUNCTION sync_sales_order_installation_task(),sales_installation_execution_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_installation_execution_readiness() TO orvex_runtime;
