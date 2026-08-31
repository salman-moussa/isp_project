-- PRD-CTL-006: atomic, replay-safe subscriber service lifecycle change orders.
CREATE TABLE operations_service_change_orders(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('plan_change','suspend','restore','terminate')),
  from_status operations_service_status NOT NULL,
  to_status operations_service_status NOT NULL,
  from_plan_id uuid NOT NULL,
  to_plan_id uuid NOT NULL,
  reason text NOT NULL,
  request_fingerprint text NOT NULL,
  network_action_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
  FOREIGN KEY(tenant_id,from_plan_id) REFERENCES operations_plans(tenant_id,id),
  FOREIGN KEY(tenant_id,to_plan_id) REFERENCES operations_plans(tenant_id,id),
  FOREIGN KEY(network_action_id) REFERENCES operations_network_action_outbox(id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
  CHECK(length(request_fingerprint)=64),
  CHECK(length(btrim(idempotency_key))>=8),
  CHECK((action='plan_change')=(from_plan_id<>to_plan_id)),
  CHECK((action='plan_change') OR from_plan_id=to_plan_id)
);
CREATE INDEX operations_service_change_orders_history_idx
  ON operations_service_change_orders(tenant_id,service_id,effective_at DESC,id DESC);
ALTER TABLE operations_service_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_service_change_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_service_change_orders_scope ON operations_service_change_orders
  USING(EXISTS(
    SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_service_change_orders.tenant_id
      AND service.id=operations_service_change_orders.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)
  ))
  WITH CHECK(EXISTS(
    SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_service_change_orders.tenant_id
      AND service.id=operations_service_change_orders.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)
  ));

CREATE OR REPLACE FUNCTION append_operations_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE; row_value jsonb;
  row_tenant_id uuid; row_id text; base_action text;
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
    OR (TG_TABLE_NAME IN ('operations_services','operations_subscribers',
      'operations_service_change_orders','operations_network_action_outbox')
      AND base_action='tenant.service.change.apply' AND context_row.permission='tenant.subscriber.edit')
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
  ) THEN RAISE EXCEPTION USING ERRCODE='P4033',
    MESSAGE='signed action and permission do not authorize this operations mutation'; END IF;
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

CREATE OR REPLACE FUNCTION operations_guard_network_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant_status text; service_status operations_service_status;
  installation_status operations_installation_status;
BEGIN
  SELECT status INTO tenant_status FROM operations_platform_subscription_events
  WHERE tenant_id=NEW.tenant_id ORDER BY recorded_at DESC,id DESC LIMIT 1 FOR SHARE;
  IF tenant_status IS NULL OR tenant_status NOT IN ('trial','active') THEN
    RAISE EXCEPTION USING ERRCODE='P4032',
      MESSAGE='Platform subscription state forbids subscriber network actions';
  END IF;
  IF NOT operations_scope_allows(NEW.tenant_id,NEW.branch_id,NEW.area_id,NEW.route_id,NEW.service_id)
  THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='network action is outside authorized scope'; END IF;
  SELECT service.status INTO service_status FROM operations_services service
  WHERE service.tenant_id=NEW.tenant_id AND service.id=NEW.service_id FOR SHARE;
  SELECT installation.status INTO installation_status FROM operations_installations installation
  WHERE installation.tenant_id=NEW.tenant_id AND installation.service_id=NEW.service_id
  ORDER BY installation.created_at DESC LIMIT 1 FOR SHARE;
  IF service_status IS NULL
    OR (NEW.action IN ('activate','restore','change_profile')
      AND (service_status<>'active' OR installation_status<>'completed'))
    OR (NEW.action='suspend' AND service_status<>'active')
    OR (NEW.action='terminate' AND service_status NOT IN ('active','suspended'))
  THEN RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='network action is incompatible with service lifecycle'; END IF;
  IF NEW.payload::text ~* '"[^" ]*(secret|password|credential|token|private[_-]?key)[^" ]*"[[:space:]]*:'
  THEN RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='network payload contains forbidden secret material'; END IF;
  IF (NEW.action IN ('activate','restore') AND NEW.payload<>'{}'::jsonb)
    OR (NEW.action='change_profile' AND NOT (jsonb_typeof(NEW.payload->'profileReference')='string'
      AND NEW.payload-'profileReference'='{}'::jsonb))
    OR (NEW.action IN ('suspend','terminate') AND NOT (jsonb_typeof(NEW.payload->'reasonCode')='string'
      AND NEW.payload-'reasonCode'='{}'::jsonb))
  THEN RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='network payload does not match action schema'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER operations_service_change_orders_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_service_change_orders
FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox();
CREATE TRIGGER operations_service_change_orders_append_only
BEFORE UPDATE OR DELETE ON operations_service_change_orders
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_service_change_orders_no_truncate
BEFORE TRUNCATE ON operations_service_change_orders
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

GRANT SELECT,INSERT ON operations_service_change_orders TO orvex_runtime;
GRANT UPDATE(status,plan_id,terminated_at,updated_at) ON operations_services TO orvex_runtime;
GRANT UPDATE(status,closed_at,updated_at) ON operations_subscribers TO orvex_runtime;

CREATE FUNCTION service_change_order_readiness()
RETURNS TABLE(migration_ready boolean,history_ready boolean,audit_ready boolean,guard_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202608310600_tenant_service_change_orders.sql'),
    to_regclass('public.operations_service_change_orders') IS NOT NULL,
    to_regprocedure('public.append_operations_audit_outbox()') IS NOT NULL,
    to_regprocedure('public.operations_guard_network_action()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION service_change_order_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION service_change_order_readiness() TO orvex_runtime;
