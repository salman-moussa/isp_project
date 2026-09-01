-- PRD-FIN-004 / PRD-CRM-003: governed add-ons, quota top-ups and mediated usage rating.
CREATE TABLE operations_addon_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  code text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  name_en text NOT NULL,
  name_ar text NOT NULL,
  addon_kind text NOT NULL CHECK(addon_kind IN ('recurring','one_time','quota_topup')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency finance_currency NOT NULL,
  quota_gb bigint,
  effective_from date NOT NULL,
  effective_to date,
  request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),
  created_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,code,version),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(length(btrim(code)) BETWEEN 1 AND 80),
  CHECK(length(btrim(name_en)) BETWEEN 1 AND 200),
  CHECK(length(btrim(name_ar)) BETWEEN 1 AND 200),
  CHECK(effective_to IS NULL OR effective_to>effective_from),
  CHECK((addon_kind='quota_topup')=(quota_gb IS NOT NULL)),
  CHECK(quota_gb IS NULL OR quota_gb>0)
);
CREATE INDEX operations_addon_versions_effective_idx
  ON operations_addon_versions(tenant_id,code,effective_from,effective_to);

CREATE TABLE operations_service_addon_purchases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  addon_version_id uuid NOT NULL,
  addon_code text NOT NULL,
  addon_name_en text NOT NULL,
  addon_name_ar text NOT NULL,
  addon_kind text NOT NULL CHECK(addon_kind IN ('recurring','one_time','quota_topup')),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  unit_amount_minor bigint NOT NULL CHECK(unit_amount_minor>0),
  total_amount_minor bigint GENERATED ALWAYS AS (quantity::bigint*unit_amount_minor) STORED,
  currency finance_currency NOT NULL,
  quota_gb_per_unit bigint,
  total_quota_gb bigint GENERATED ALWAYS AS
    (CASE WHEN quota_gb_per_unit IS NULL THEN NULL ELSE quantity::bigint*quota_gb_per_unit END) STORED,
  applies_from date NOT NULL,
  applies_to date NOT NULL,
  request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),
  purchased_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  purchased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
  FOREIGN KEY(tenant_id,addon_version_id) REFERENCES operations_addon_versions(tenant_id,id),
  FOREIGN KEY(tenant_id,purchased_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(applies_to>applies_from),
  CHECK((addon_kind='quota_topup')=(quota_gb_per_unit IS NOT NULL)),
  CHECK(quota_gb_per_unit IS NULL OR quota_gb_per_unit>0)
);
CREATE INDEX operations_service_addon_purchases_rating_idx
  ON operations_service_addon_purchases(tenant_id,service_id,applies_from,applies_to);

CREATE TABLE operations_usage_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  source text NOT NULL,
  event_reference text NOT NULL,
  occurred_at timestamptz NOT NULL,
  download_bytes bigint NOT NULL CHECK(download_bytes>=0),
  upload_bytes bigint NOT NULL CHECK(upload_bytes>=0),
  total_bytes bigint GENERATED ALWAYS AS (download_bytes+upload_bytes) STORED,
  request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),
  recorded_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,source,event_reference),
  FOREIGN KEY(tenant_id,service_id) REFERENCES operations_services(tenant_id,id),
  FOREIGN KEY(tenant_id,recorded_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(length(btrim(source)) BETWEEN 1 AND 80),
  CHECK(length(btrim(event_reference)) BETWEEN 1 AND 200),
  CHECK(download_bytes+upload_bytes>0)
);
CREATE INDEX operations_usage_events_rating_idx
  ON operations_usage_events(tenant_id,service_id,occurred_at,id);

ALTER TABLE operations_addon_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_addon_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_service_addon_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_service_addon_purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_usage_events FORCE ROW LEVEL SECURITY;

CREATE POLICY operations_addon_versions_scope ON operations_addon_versions
  USING(EXISTS(SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_addon_versions.tenant_id
      AND (operations_addon_versions.branch_id IS NULL OR context.branch_ids IS NULL
        OR operations_addon_versions.branch_id=ANY(context.branch_ids))))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=operations_addon_versions.tenant_id
      AND (operations_addon_versions.branch_id IS NULL OR context.branch_ids IS NULL
        OR operations_addon_versions.branch_id=ANY(context.branch_ids))));
CREATE POLICY operations_service_addon_purchases_scope ON operations_service_addon_purchases
  USING(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_service_addon_purchases.tenant_id
      AND service.id=operations_service_addon_purchases.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_service_addon_purchases.tenant_id
      AND service.id=operations_service_addon_purchases.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)));
CREATE POLICY operations_usage_events_scope ON operations_usage_events
  USING(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_usage_events.tenant_id
      AND service.id=operations_usage_events.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_services service
    WHERE service.tenant_id=operations_usage_events.tenant_id
      AND service.id=operations_usage_events.service_id
      AND operations_scope_allows(service.tenant_id,service.branch_id,service.area_id,
        service.route_id,service.id)));

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
    OR (TG_TABLE_NAME='operations_addon_versions'
      AND base_action='tenant.addon.version.create' AND context_row.permission='tenant.invoice.create')
    OR (TG_TABLE_NAME='operations_service_addon_purchases'
      AND base_action='tenant.service.addon.purchase' AND context_row.permission='tenant.subscriber.edit')
    OR (TG_TABLE_NAME='operations_usage_events'
      AND base_action='tenant.usage.record' AND context_row.permission='tenant.invoice.create')
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

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'operations_addon_versions','operations_service_addon_purchases','operations_usage_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox()',relation_name,relation_name);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation()',relation_name,relation_name);
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation()',relation_name,relation_name);
  END LOOP;
END $$;

GRANT SELECT,INSERT ON operations_addon_versions,operations_service_addon_purchases,
  operations_usage_events TO orvex_runtime;

CREATE FUNCTION usage_addon_rating_readiness()
RETURNS TABLE(migration_ready boolean,relations_ready boolean,guards_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202608310800_tenant_usage_addon_rating.sql'),
    to_regclass('public.operations_addon_versions') IS NOT NULL
      AND to_regclass('public.operations_service_addon_purchases') IS NOT NULL
      AND to_regclass('public.operations_usage_events') IS NOT NULL,
    (SELECT count(*)=9 FROM pg_trigger
      WHERE tgname IN (
        'operations_addon_versions_audit','operations_addon_versions_append_only',
        'operations_addon_versions_no_truncate','operations_service_addon_purchases_audit',
        'operations_service_addon_purchases_append_only','operations_service_addon_purchases_no_truncate',
        'operations_usage_events_audit','operations_usage_events_append_only',
        'operations_usage_events_no_truncate') AND tgenabled='O')
$$;
REVOKE ALL ON FUNCTION usage_addon_rating_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION usage_addon_rating_readiness() TO orvex_runtime;
