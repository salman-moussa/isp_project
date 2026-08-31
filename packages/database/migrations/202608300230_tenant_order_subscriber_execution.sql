-- Execute the first accepted-order dependency as one tenant-scoped, audited transaction.
ALTER TABLE sales_order_tasks
  ADD COLUMN result_reference jsonb,
  ADD COLUMN execution_fingerprint text,
  ADD COLUMN execution_idempotency_key text,
  ADD COLUMN completed_by uuid;

ALTER TABLE sales_order_tasks
  ADD CONSTRAINT sales_order_tasks_completed_by_fk
    FOREIGN KEY (tenant_id,completed_by) REFERENCES tenant_memberships(tenant_id,user_id),
  ADD CONSTRAINT sales_order_tasks_execution_key_check
    CHECK (execution_idempotency_key IS NULL OR length(btrim(execution_idempotency_key))>=8),
  ADD CONSTRAINT sales_order_tasks_execution_pair_check
    CHECK ((execution_fingerprint IS NULL)=(execution_idempotency_key IS NULL));

CREATE UNIQUE INDEX sales_order_tasks_execution_idempotency_idx
  ON sales_order_tasks(tenant_id,execution_idempotency_key)
  WHERE execution_idempotency_key IS NOT NULL;

CREATE FUNCTION validate_sales_order_task_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF OLD.status='completed' OR (OLD.status,NEW.status) NOT IN (
    ('pending','ready'),('pending','cancelled'),
    ('ready','running'),('ready','completed'),('ready','blocked'),('ready','failed'),('ready','cancelled'),
    ('running','completed'),('running','blocked'),('running','failed'),
    ('blocked','ready'),('blocked','cancelled'),('failed','ready'),('failed','cancelled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invalid sales order task transition';
  END IF;
  IF NEW.status IN ('ready','running','completed') AND EXISTS (
    SELECT 1 FROM unnest(NEW.depends_on_keys) dependency_key
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_order_tasks dependency
      WHERE dependency.tenant_id=NEW.tenant_id AND dependency.order_id=NEW.order_id
        AND dependency.task_key=dependency_key AND dependency.status='completed'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='sales order task dependencies are incomplete';
  END IF;
  NEW.attempts:=CASE WHEN NEW.status='running' THEN OLD.attempts+1 ELSE NEW.attempts END;
  NEW.completed_at:=CASE WHEN NEW.status='completed' THEN coalesce(NEW.completed_at,clock_timestamp()) ELSE NULL END;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER sales_order_task_transition_guard
BEFORE UPDATE ON sales_order_tasks
FOR EACH ROW EXECUTE FUNCTION validate_sales_order_task_transition();

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
    (TG_TABLE_NAME='sales_leads' AND context_row.action='tenant.sales.lead.create'
      AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_qualifications')
      AND context_row.action='tenant.sales.qualify' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME='sales_offer_versions' AND context_row.action='tenant.catalog.offer.version.create'
      AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.create'
      AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.approve'
      AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes','sales_service_orders','sales_order_tasks')
      AND context_row.action='tenant.sales.quote.accept' AND context_row.permission='tenant.order.manage')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks')
      AND context_row.action='tenant.subscriber.create' AND context_row.permission='tenant.subscriber.create')
  ) THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize sales mutation'; END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value
  ) VALUES (
    context_row.tenant_id,context_row.action,TG_TABLE_NAME,row_id,context_row.actor_id,
    context_row.session_id,context_row.support_grant_id,context_row.permission,context_row.request_id,
    context_row.idempotency_key,context_row.ip_address,context_row.user_agent,'allowed',context_row.reason,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

-- Parent hierarchy rows must remain visible to a session scoped to their children. The original
-- generic helper required a non-null route even while validating an area, which made legitimate
-- route-scoped subscriber writes fail before their location could be created.
CREATE FUNCTION operations_hierarchy_scope_allows(
  target_tenant_id uuid,target_branch_id uuid DEFAULT NULL,
  target_area_id uuid DEFAULT NULL,target_route_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=target_tenant_id
      AND (target_branch_id IS NULL OR context.branch_ids IS NULL OR target_branch_id=ANY(context.branch_ids))
      AND (target_area_id IS NULL OR context.area_ids IS NULL OR target_area_id=ANY(context.area_ids))
      AND (target_route_id IS NULL OR context.route_ids IS NULL OR target_route_id=ANY(context.route_ids))
  )
$$;

DROP POLICY operations_branches_scope ON operations_branches;
CREATE POLICY operations_branches_scope ON operations_branches
  USING (operations_hierarchy_scope_allows(tenant_id,id))
  WITH CHECK (operations_hierarchy_scope_allows(tenant_id,id));
DROP POLICY operations_areas_scope ON operations_areas;
CREATE POLICY operations_areas_scope ON operations_areas
  USING (operations_hierarchy_scope_allows(tenant_id,branch_id,id))
  WITH CHECK (operations_hierarchy_scope_allows(tenant_id,branch_id,id));
DROP POLICY operations_routes_scope ON operations_routes;
CREATE POLICY operations_routes_scope ON operations_routes
  USING (operations_hierarchy_scope_allows(tenant_id,branch_id,area_id,id))
  WITH CHECK (operations_hierarchy_scope_allows(tenant_id,branch_id,area_id,id));

-- A household is branch-owned while its personal service address is area/route scoped. The former
-- all-command policy made every scoped subscriber create impossible because the parent row has no
-- area or route columns. Inserts require an authorized branch and no record-only restriction;
-- reads from a narrower session require at least one already-visible child location.
DROP POLICY operations_households_scope ON operations_households;
CREATE POLICY operations_households_select_scope ON operations_households FOR SELECT USING (
  EXISTS(
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_households.tenant_id
      AND (context.branch_ids IS NULL OR operations_households.branch_id=ANY(context.branch_ids))
      AND (context.record_ids IS NULL OR operations_households.id=ANY(context.record_ids))
      AND (
        (context.action='tenant.subscriber.create'
          AND context.permission='tenant.subscriber.create' AND context.record_ids IS NULL)
        OR (context.area_ids IS NULL AND context.route_ids IS NULL)
        OR EXISTS(
          SELECT 1 FROM operations_locations location
          WHERE location.tenant_id=operations_households.tenant_id
            AND location.household_id=operations_households.id
            AND operations_scope_allows(location.tenant_id,location.branch_id,location.area_id,
              location.route_id,location.id)
        )
      )
  )
);
CREATE POLICY operations_households_insert_scope ON operations_households FOR INSERT WITH CHECK (
  EXISTS(
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_households.tenant_id
      AND (context.branch_ids IS NULL OR operations_households.branch_id=ANY(context.branch_ids))
      AND context.record_ids IS NULL
  )
);

DROP POLICY sales_leads_scope ON sales_leads;
CREATE POLICY sales_leads_scope ON sales_leads USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.subscriber.create'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
);

DROP POLICY sales_orders_scope ON sales_service_orders;
CREATE POLICY sales_orders_scope ON sales_service_orders USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);

DROP POLICY sales_order_tasks_scope ON sales_order_tasks;
CREATE POLICY sales_order_tasks_scope ON sales_order_tasks USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
);

CREATE FUNCTION sales_order_execution_readiness()
RETURNS TABLE(migration_ready boolean,columns_ready boolean,guards_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608300230_tenant_order_subscriber_execution.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='sales_order_tasks' AND column_name='result_reference')
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='sales_order_tasks' AND column_name='execution_idempotency_key'),
    to_regprocedure('public.validate_sales_order_task_transition()') IS NOT NULL
      AND to_regprocedure('public.append_sales_audit_outbox()') IS NOT NULL
$$;

GRANT UPDATE(status,subscriber_id,updated_at) ON sales_service_orders TO orvex_runtime;
GRANT UPDATE(status,attempts,last_error,updated_at,completed_at,result_reference,
  execution_fingerprint,execution_idempotency_key,completed_by)
  ON sales_order_tasks TO orvex_runtime;

REVOKE ALL ON FUNCTION validate_sales_order_task_transition(),sales_order_execution_readiness(),
  operations_hierarchy_scope_allows(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_order_execution_readiness(),
  operations_hierarchy_scope_allows(uuid,uuid,uuid,uuid) TO orvex_runtime;
