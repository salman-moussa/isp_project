CREATE TABLE operations_capacity_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  resource_type text NOT NULL CHECK(resource_type IN ('pop','sector','olt','fiber_port','wireless_sector','access_node','capacity_pool')),
  code text NOT NULL,
  name text NOT NULL,
  access_technology text NOT NULL,
  total_units integer NOT NULL CHECK(total_units>0),
  reserved_units integer NOT NULL DEFAULT 0 CHECK(reserved_units>=0 AND reserved_units<=total_units),
  branch_id uuid NOT NULL,
  area_id uuid,
  route_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','retired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),UNIQUE(tenant_id,code),UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY(tenant_id,area_id) REFERENCES operations_areas(tenant_id,id),
  FOREIGN KEY(tenant_id,route_id) REFERENCES operations_routes(tenant_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(length(btrim(code)) BETWEEN 1 AND 80),
  CHECK(length(btrim(name)) BETWEEN 1 AND 200),
  CHECK(length(btrim(idempotency_key))>=8)
);

CREATE TABLE sales_order_resource_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  subscriber_id uuid NOT NULL,
  units integer NOT NULL CHECK(units>0),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','consumed','released')),
  reserved_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  UNIQUE(tenant_id,id),UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,order_id) REFERENCES sales_service_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES operations_capacity_resources(tenant_id,id),
  FOREIGN KEY(tenant_id,subscriber_id) REFERENCES operations_subscribers(tenant_id,id),
  FOREIGN KEY(tenant_id,reserved_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK((status='released')=(released_at IS NOT NULL)),
  CHECK(length(btrim(idempotency_key))>=8)
);

CREATE INDEX operations_capacity_resources_available_idx
  ON operations_capacity_resources(tenant_id,status,access_technology,branch_id,area_id,route_id);

CREATE TRIGGER operations_capacity_resources_scope_links
BEFORE INSERT OR UPDATE ON operations_capacity_resources
FOR EACH ROW EXECUTE FUNCTION validate_operations_scope_links();

CREATE FUNCTION append_resource_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE; row_value jsonb; row_id text;
  context_found boolean;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  context_found:=FOUND;
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_id:=row_value->>'id';
  IF NOT context_found OR (row_value->>'tenant_id')::uuid<>context_row.tenant_id OR row_id IS NULL
    OR context_row.permission<>'tenant.network.job.create'
    OR NOT (
      (TG_TABLE_NAME='operations_capacity_resources'
        AND context_row.action IN ('tenant.resource.create','tenant.resource.reserve'))
      OR (TG_TABLE_NAME='sales_order_resource_reservations'
        AND context_row.action='tenant.resource.reserve')
    ) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed resource action is required';
  END IF;
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

CREATE TRIGGER operations_capacity_resources_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_capacity_resources
FOR EACH ROW EXECUTE FUNCTION append_resource_audit_outbox();
CREATE TRIGGER sales_order_resource_reservations_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_order_resource_reservations
FOR EACH ROW EXECUTE FUNCTION append_resource_audit_outbox();

ALTER TABLE operations_capacity_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_capacity_resources FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_order_resource_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_resource_reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY operations_capacity_resources_scope ON operations_capacity_resources USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.order.manage','tenant.network.view','tenant.network.job.create'])
  AND operations_hierarchy_scope_allows(tenant_id,branch_id,area_id,route_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.network.job.create'])
  AND operations_hierarchy_scope_allows(tenant_id,branch_id,area_id,route_id)
);
CREATE POLICY sales_order_resource_reservations_scope ON sales_order_resource_reservations USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.order.manage','tenant.network.view','tenant.network.job.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.network.job.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
);

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
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
);
DROP POLICY sales_quotes_scope ON sales_quotes;
CREATE POLICY sales_quotes_scope ON sales_quotes USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.network.job.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
DROP POLICY sales_offers_scope ON sales_offer_versions;
CREATE POLICY sales_offers_scope ON sales_offer_versions USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage','tenant.network.job.create'])
  AND sales_scope_allows_branch(tenant_id,branch_id,id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.catalog.manage']) AND sales_scope_allows_branch(tenant_id,branch_id,id)
);
DROP POLICY sales_orders_scope ON sales_service_orders;
CREATE POLICY sales_orders_scope ON sales_service_orders USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
DROP POLICY sales_order_tasks_scope ON sales_order_tasks;
CREATE POLICY sales_order_tasks_scope ON sales_order_tasks USING(
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.subscriber.create','tenant.network.job.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK(
  sales_current_permission_is(ARRAY['tenant.order.manage','tenant.subscriber.create','tenant.network.job.create'])
  AND sales_scope_allows_order(tenant_id,order_id)
);

CREATE FUNCTION sales_resource_execution_readiness()
RETURNS TABLE(migration_ready boolean,relations_ready boolean,guards_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608310000_tenant_order_resource_execution.sql'),
    to_regclass('public.operations_capacity_resources') IS NOT NULL
      AND to_regclass('public.sales_order_resource_reservations') IS NOT NULL,
    to_regprocedure('public.append_resource_audit_outbox()') IS NOT NULL
      AND to_regprocedure('public.validate_sales_order_task_transition()') IS NOT NULL
$$;

REVOKE ALL ON TABLE operations_capacity_resources,sales_order_resource_reservations FROM PUBLIC;
GRANT SELECT,INSERT ON TABLE operations_capacity_resources,sales_order_resource_reservations TO orvex_runtime;
GRANT UPDATE(reserved_units,updated_at) ON operations_capacity_resources TO orvex_runtime;
GRANT UPDATE(status,attempts,last_error,updated_at,completed_at,result_reference,
  execution_fingerprint,execution_idempotency_key,completed_by) ON sales_order_tasks TO orvex_runtime;
REVOKE ALL ON FUNCTION append_resource_audit_outbox(),sales_resource_execution_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_resource_execution_readiness() TO orvex_runtime;
