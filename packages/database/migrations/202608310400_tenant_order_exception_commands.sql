-- PRD-CTL-004: governed service-order fallout, recovery, hold/resume, and safe cancellation.
CREATE TABLE sales_order_commands(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('retry_task','place_on_hold','resume','cancel')),
  task_key text,
  reason text NOT NULL,
  request_fingerprint text NOT NULL,
  result_reference jsonb NOT NULL,
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,order_id) REFERENCES sales_service_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK((command='retry_task')=(task_key IS NOT NULL)),
  CHECK(task_key IS NULL OR length(btrim(task_key)) BETWEEN 1 AND 80),
  CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
  CHECK(length(request_fingerprint)=64),
  CHECK(jsonb_typeof(result_reference)='object'),
  CHECK(length(btrim(idempotency_key))>=8)
);
CREATE INDEX sales_order_commands_history_idx
  ON sales_order_commands(tenant_id,order_id,created_at DESC);
ALTER TABLE sales_order_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_order_commands_scope ON sales_order_commands
  USING(sales_current_permission_is(ARRAY['tenant.sales.view','tenant.order.manage'])
    AND sales_scope_allows_order(tenant_id,order_id))
  WITH CHECK(sales_current_permission_is(ARRAY['tenant.order.manage'])
    AND sales_scope_allows_order(tenant_id,order_id));

-- A failed/blocked delivery step must surface as order fallout. Recovery returns the order to work
-- only when no other exception remains. The trigger is owner-mediated, but each source task update
-- is still RLS-scoped and every derived order update passes the signed audit trigger.
CREATE FUNCTION sync_sales_order_exception_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('failed','blocked') THEN
    UPDATE sales_service_orders SET status='fallout',updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id
      AND status NOT IN ('on_hold','completed','cancelled');
  ELSIF OLD.status IN ('failed','blocked') AND NEW.status='ready'
    AND NOT EXISTS(
      SELECT 1 FROM sales_order_tasks task
      WHERE task.tenant_id=NEW.tenant_id AND task.order_id=NEW.order_id
        AND task.id<>NEW.id AND task.status IN ('failed','blocked')
    ) THEN
    UPDATE sales_service_orders SET status='in_progress',updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id AND status='fallout';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_order_task_exception_sync
AFTER UPDATE OF status ON sales_order_tasks
FOR EACH ROW EXECUTE FUNCTION sync_sales_order_exception_status();

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
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks') AND context_row.action IN ('tenant.service.installation.create','tenant.installation.transition') AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks') AND context_row.action IN ('tenant.network.job.create','tenant.network.job.complete') AND context_row.permission='tenant.network.job.create')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks') AND context_row.action='tenant.order.first_invoice.post' AND context_row.permission='tenant.invoice.post')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks','sales_order_commands')
      AND context_row.action='tenant.order.command' AND context_row.permission='tenant.order.manage')
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

CREATE TRIGGER sales_order_commands_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_order_commands
FOR EACH ROW EXECUTE FUNCTION append_sales_audit_outbox();

GRANT SELECT,INSERT ON sales_order_commands TO orvex_runtime;
GRANT UPDATE(status,updated_at) ON sales_service_orders TO orvex_runtime;
GRANT UPDATE(status,last_error,result_reference,execution_fingerprint,
  execution_idempotency_key,completed_by) ON sales_order_tasks TO orvex_runtime;

CREATE FUNCTION sales_order_exception_readiness()
RETURNS TABLE(migration_ready boolean,commands_ready boolean,sync_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608310400_tenant_order_exception_commands.sql'),
    to_regclass('public.sales_order_commands') IS NOT NULL,
    to_regprocedure('public.sync_sales_order_exception_status()') IS NOT NULL,
    to_regprocedure('public.append_sales_audit_outbox()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION sync_sales_order_exception_status(),sales_order_exception_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_order_exception_readiness() TO orvex_runtime;
