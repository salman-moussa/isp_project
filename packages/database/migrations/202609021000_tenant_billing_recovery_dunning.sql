-- PRD-FIN-004: durable recurring-run recovery and explainable, human-governed dunning.
ALTER TABLE operations_billing_runs
  ADD COLUMN retry_of_run_id uuid,
  ADD CONSTRAINT operations_billing_runs_retry_fk
    FOREIGN KEY(tenant_id,retry_of_run_id) REFERENCES operations_billing_runs(tenant_id,id),
  ADD CONSTRAINT operations_billing_runs_retry_not_self CHECK(retry_of_run_id IS NULL OR retry_of_run_id<>id);

CREATE TABLE operations_billing_run_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  billing_run_id uuid NOT NULL,
  service_id uuid NOT NULL,
  source_item_id uuid,
  status text NOT NULL CHECK(status IN ('prepared','failed','skipped')),
  failure_code text,
  explanation_en text NOT NULL,
  explanation_ar text NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,billing_run_id,service_id),
  FOREIGN KEY(tenant_id,billing_run_id) REFERENCES operations_billing_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
  FOREIGN KEY(tenant_id,source_item_id) REFERENCES operations_billing_run_items(tenant_id,id),
  CHECK((status='failed')=(failure_code IS NOT NULL)),
  CHECK(length(btrim(explanation_en)) BETWEEN 8 AND 500),
  CHECK(length(btrim(explanation_ar)) BETWEEN 8 AND 500)
);
CREATE INDEX operations_billing_run_items_recovery_idx
  ON operations_billing_run_items(tenant_id,billing_run_id,status,service_id);

CREATE TABLE operations_dunning_policy_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  version integer NOT NULL CHECK(version>0),
  payment_terms_days integer NOT NULL CHECK(payment_terms_days BETWEEN 0 AND 365),
  reminder_after_days integer NOT NULL CHECK(reminder_after_days BETWEEN 0 AND 365),
  final_notice_after_days integer NOT NULL CHECK(final_notice_after_days BETWEEN 1 AND 730),
  suspension_review_after_days integer NOT NULL CHECK(suspension_review_after_days BETWEEN 2 AND 1095),
  effective_from date NOT NULL,
  effective_to date,
  reason text NOT NULL,
  request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),
  created_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,branch_id,version),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(reminder_after_days<final_notice_after_days
    AND final_notice_after_days<suspension_review_after_days),
  CHECK(effective_to IS NULL OR effective_to>effective_from),
  CHECK(length(btrim(reason)) BETWEEN 8 AND 1000)
);
CREATE UNIQUE INDEX operations_dunning_policy_global_version_key
  ON operations_dunning_policy_versions(tenant_id,version) WHERE branch_id IS NULL;
CREATE INDEX operations_dunning_policy_effective_idx
  ON operations_dunning_policy_versions(tenant_id,branch_id,effective_from,effective_to,version DESC);

CREATE TABLE operations_dunning_evaluation_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  as_of_date date NOT NULL,
  status operations_job_status NOT NULL DEFAULT 'running',
  evaluated_count integer NOT NULL DEFAULT 0 CHECK(evaluated_count>=0),
  advanced_count integer NOT NULL DEFAULT 0 CHECK(advanced_count>=0),
  resolved_count integer NOT NULL DEFAULT 0 CHECK(resolved_count>=0),
  scope_branch_ids uuid[],
  scope_area_ids uuid[],
  scope_route_ids uuid[],
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK((status IN ('succeeded','failed','cancelled'))=(completed_at IS NOT NULL))
);

CREATE TABLE operations_dunning_cases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  finance_invoice_id uuid NOT NULL,
  invoice_preparation_id uuid NOT NULL,
  service_id uuid NOT NULL,
  subscriber_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  area_id uuid NOT NULL,
  route_id uuid NOT NULL,
  due_on date NOT NULL,
  current_stage text NOT NULL CHECK(current_stage IN ('reminder','final_notice','suspension_review','resolved')),
  status text NOT NULL CHECK(status IN ('open','resolved')),
  outstanding_minor bigint NOT NULL CHECK(outstanding_minor>=0),
  currency finance_currency NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,finance_invoice_id),
  FOREIGN KEY(tenant_id,finance_invoice_id) REFERENCES finance_invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_preparation_id) REFERENCES operations_invoice_preparations(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
  FOREIGN KEY(tenant_id,subscriber_id) REFERENCES operations_subscribers(tenant_id,id),
  FOREIGN KEY(tenant_id,policy_version_id) REFERENCES operations_dunning_policy_versions(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY(tenant_id,area_id) REFERENCES operations_areas(tenant_id,id),
  FOREIGN KEY(tenant_id,route_id) REFERENCES operations_routes(tenant_id,id),
  CHECK((status='resolved')=(current_stage='resolved')),
  CHECK((status='resolved')=(resolved_at IS NOT NULL)),
  CHECK((status='resolved')=(outstanding_minor=0))
);
CREATE INDEX operations_dunning_cases_queue_idx
  ON operations_dunning_cases(tenant_id,status,current_stage,due_on,branch_id,route_id);

CREATE TABLE operations_dunning_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  dunning_case_id uuid NOT NULL,
  evaluation_run_id uuid NOT NULL,
  from_stage text,
  to_stage text NOT NULL CHECK(to_stage IN ('reminder','final_notice','suspension_review','resolved')),
  days_overdue integer NOT NULL,
  outstanding_minor bigint NOT NULL CHECK(outstanding_minor>=0),
  currency finance_currency NOT NULL,
  explanation_en text NOT NULL,
  explanation_ar text NOT NULL,
  policy_snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,dunning_case_id,evaluation_run_id),
  FOREIGN KEY(tenant_id,dunning_case_id) REFERENCES operations_dunning_cases(tenant_id,id),
  FOREIGN KEY(tenant_id,evaluation_run_id) REFERENCES operations_dunning_evaluation_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(from_stage IS NULL OR from_stage IN ('reminder','final_notice','suspension_review')),
  CHECK(length(btrim(explanation_en)) BETWEEN 8 AND 1000),
  CHECK(length(btrim(explanation_ar)) BETWEEN 8 AND 1000),
  CHECK(jsonb_typeof(policy_snapshot)='object' AND NOT operations_json_contains_secret_key(policy_snapshot))
);
CREATE INDEX operations_dunning_events_history_idx
  ON operations_dunning_events(tenant_id,dunning_case_id,occurred_at,id);

ALTER TABLE operations_billing_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_billing_run_items FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_evaluation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dunning_events FORCE ROW LEVEL SECURITY;

CREATE POLICY operations_billing_run_items_scope ON operations_billing_run_items
  USING(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_billing_run_items.tenant_id
      AND service.id=operations_billing_run_items.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_billing_run_items.tenant_id
      AND service.id=operations_billing_run_items.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)));
CREATE POLICY operations_dunning_policy_scope ON operations_dunning_policy_versions
  USING(EXISTS(SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_dunning_policy_versions.tenant_id
      AND (operations_dunning_policy_versions.branch_id IS NULL OR context.branch_ids IS NULL
        OR operations_dunning_policy_versions.branch_id=ANY(context.branch_ids))))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_dunning_policy_versions.tenant_id
      AND (operations_dunning_policy_versions.branch_id IS NULL OR context.branch_ids IS NULL
        OR operations_dunning_policy_versions.branch_id=ANY(context.branch_ids))));
CREATE POLICY operations_dunning_runs_scope ON operations_dunning_evaluation_runs
  USING(operations_scope_allows_arrays(tenant_id,scope_branch_ids,scope_area_ids,scope_route_ids))
  WITH CHECK(operations_scope_allows_arrays(tenant_id,scope_branch_ids,scope_area_ids,scope_route_ids));
CREATE POLICY operations_dunning_cases_scope ON operations_dunning_cases
  USING(operations_scope_allows(tenant_id,branch_id,area_id,route_id,service_id))
  WITH CHECK(operations_scope_allows(tenant_id,branch_id,area_id,route_id,service_id));
CREATE POLICY operations_dunning_events_scope ON operations_dunning_events
  USING(EXISTS(SELECT 1 FROM operations_dunning_cases dunning_case
    WHERE dunning_case.tenant_id=operations_dunning_events.tenant_id
      AND dunning_case.id=operations_dunning_events.dunning_case_id
      AND operations_scope_allows(dunning_case.tenant_id,dunning_case.branch_id,
        dunning_case.area_id,dunning_case.route_id,dunning_case.service_id)))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_dunning_cases dunning_case
    WHERE dunning_case.tenant_id=operations_dunning_events.tenant_id
      AND dunning_case.id=operations_dunning_events.dunning_case_id
      AND operations_scope_allows(dunning_case.tenant_id,dunning_case.branch_id,
        dunning_case.area_id,dunning_case.route_id,dunning_case.service_id)));

CREATE FUNCTION append_billing_recovery_audit_outbox() RETURNS trigger
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
  row_id:=row_value->>'id';
  base_action:=regexp_replace(context_row.action,'^support\.','');
  IF row_tenant_id<>context_row.tenant_id OR row_id IS NULL OR NOT (
    (TG_TABLE_NAME='operations_billing_run_items'
      AND base_action='tenant.billing.prepare' AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME='operations_dunning_policy_versions'
      AND base_action='tenant.dunning.policy.version.create'
      AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME IN ('operations_dunning_evaluation_runs','operations_dunning_cases',
        'operations_dunning_events')
      AND base_action='tenant.dunning.evaluate' AND context_row.permission='tenant.invoice.create')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',
      MESSAGE='signed action and permission do not authorize this billing mutation';
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

CREATE TRIGGER operations_billing_run_items_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_billing_run_items
FOR EACH ROW EXECUTE FUNCTION append_billing_recovery_audit_outbox();
CREATE TRIGGER operations_billing_run_items_append_only
BEFORE UPDATE OR DELETE ON operations_billing_run_items
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_billing_run_items_no_truncate
BEFORE TRUNCATE ON operations_billing_run_items
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_dunning_policy_versions_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_dunning_policy_versions
FOR EACH ROW EXECUTE FUNCTION append_billing_recovery_audit_outbox();
CREATE TRIGGER operations_dunning_policy_versions_append_only
BEFORE UPDATE OR DELETE ON operations_dunning_policy_versions
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_dunning_policy_versions_no_truncate
BEFORE TRUNCATE ON operations_dunning_policy_versions
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_dunning_evaluation_runs_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_dunning_evaluation_runs
FOR EACH ROW EXECUTE FUNCTION append_billing_recovery_audit_outbox();
CREATE TRIGGER operations_dunning_cases_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_dunning_cases
FOR EACH ROW EXECUTE FUNCTION append_billing_recovery_audit_outbox();
CREATE TRIGGER operations_dunning_events_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_dunning_events
FOR EACH ROW EXECUTE FUNCTION append_billing_recovery_audit_outbox();
CREATE TRIGGER operations_dunning_events_append_only
BEFORE UPDATE OR DELETE ON operations_dunning_events
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_dunning_events_no_truncate
BEFORE TRUNCATE ON operations_dunning_events
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

GRANT SELECT,INSERT ON operations_billing_run_items,operations_dunning_policy_versions,
  operations_dunning_evaluation_runs,operations_dunning_cases,operations_dunning_events TO orvex_runtime;
GRANT UPDATE(status,evaluated_count,advanced_count,resolved_count,completed_at)
  ON operations_dunning_evaluation_runs TO orvex_runtime;
GRANT UPDATE(policy_version_id,due_on,current_stage,status,outstanding_minor,version,
  last_evaluated_at,resolved_at) ON operations_dunning_cases TO orvex_runtime;

CREATE FUNCTION billing_recovery_dunning_readiness()
RETURNS TABLE(migration_ready boolean,run_items_ready boolean,dunning_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202609021000_tenant_billing_recovery_dunning.sql'),
    to_regclass('public.operations_billing_run_items') IS NOT NULL,
    to_regclass('public.operations_dunning_policy_versions') IS NOT NULL
      AND to_regclass('public.operations_dunning_cases') IS NOT NULL
      AND to_regclass('public.operations_dunning_events') IS NOT NULL,
    to_regprocedure('public.append_billing_recovery_audit_outbox()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION append_billing_recovery_audit_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION billing_recovery_dunning_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_recovery_dunning_readiness() TO orvex_runtime;
