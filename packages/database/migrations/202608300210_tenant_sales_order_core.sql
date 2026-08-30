-- orvex:database=tenant
-- Wave 2: tenant-scoped CRM, versioned offers, qualification, quotations, and order decomposition.

CREATE TABLE sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_number text NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('person','business')),
  display_name text NOT NULL,
  source text NOT NULL,
  primary_phone text,
  primary_email text,
  branch_id uuid NOT NULL,
  area_id uuid NOT NULL,
  route_id uuid NOT NULL,
  address_line text NOT NULL,
  needs_summary text NOT NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','qualifying','qualified','disqualified','quoted','won','lost')),
  assigned_to uuid,
  loss_reason text,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,lead_number),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY (tenant_id,area_id) REFERENCES operations_areas(tenant_id,id),
  FOREIGN KEY (tenant_id,route_id) REFERENCES operations_routes(tenant_id,id),
  FOREIGN KEY (tenant_id,assigned_to) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK (length(btrim(lead_number)) BETWEEN 1 AND 80),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  CHECK (length(btrim(source)) BETWEEN 1 AND 100),
  CHECK (length(btrim(address_line)) BETWEEN 3 AND 500),
  CHECK (length(btrim(needs_summary)) BETWEEN 3 AND 1000),
  CHECK (length(btrim(idempotency_key)) >= 8)
);
CREATE INDEX sales_leads_pipeline_idx ON sales_leads(tenant_id,status,updated_at DESC);

CREATE TABLE sales_offer_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  offer_id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid,
  code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name_en text NOT NULL,
  name_ar text NOT NULL,
  access_technology text NOT NULL
    CHECK (access_technology IN ('fiber','fixed_wireless','dsl','leased_line','satellite','other')),
  downstream_mbps integer NOT NULL CHECK (downstream_mbps > 0),
  upstream_mbps integer NOT NULL CHECK (upstream_mbps > 0),
  quota_gb integer CHECK (quota_gb IS NULL OR quota_gb > 0),
  recurring_amount_minor bigint NOT NULL CHECK (recurring_amount_minor > 0),
  activation_fee_minor bigint NOT NULL DEFAULT 0 CHECK (activation_fee_minor >= 0),
  equipment_fee_minor bigint NOT NULL DEFAULT 0 CHECK (equipment_fee_minor >= 0),
  currency finance_currency NOT NULL,
  commitment_months integer NOT NULL DEFAULT 0 CHECK (commitment_months BETWEEN 0 AND 60),
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility)='object'),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(policy)='object'),
  effective_from date NOT NULL,
  effective_to date,
  published boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,offer_id,version),
  UNIQUE (tenant_id,code,version),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES operations_branches(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (length(btrim(code)) BETWEEN 1 AND 80),
  CHECK (length(btrim(name_en)) BETWEEN 1 AND 200),
  CHECK (length(btrim(name_ar)) BETWEEN 1 AND 200),
  CHECK (length(btrim(idempotency_key)) >= 8)
);
CREATE INDEX sales_offer_effective_idx
  ON sales_offer_versions(tenant_id,published,effective_from,effective_to);

CREATE TABLE sales_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  result text NOT NULL CHECK (result IN ('eligible','ineligible','survey_required','reserved')),
  access_technology text NOT NULL,
  coverage_source text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  capacity_reference text,
  reservation_expires_at timestamptz,
  qualified_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,lead_id,version),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,lead_id) REFERENCES sales_leads(tenant_id,id),
  FOREIGN KEY (tenant_id,qualified_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK ((result='reserved')=(reservation_expires_at IS NOT NULL)),
  CHECK (length(btrim(access_technology)) BETWEEN 1 AND 80),
  CHECK (length(btrim(coverage_source)) BETWEEN 1 AND 200),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE sales_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  qualification_id uuid NOT NULL,
  offer_version_id uuid NOT NULL,
  quote_number text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL
    CHECK (status IN ('pending_approval','issued','approved','rejected','accepted','expired')),
  recurring_amount_minor bigint NOT NULL CHECK (recurring_amount_minor > 0),
  activation_fee_minor bigint NOT NULL CHECK (activation_fee_minor >= 0),
  equipment_fee_minor bigint NOT NULL CHECK (equipment_fee_minor >= 0),
  discount_basis_points integer NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 3000),
  currency finance_currency NOT NULL,
  commitment_months integer NOT NULL CHECK (commitment_months BETWEEN 0 AND 60),
  valid_until date NOT NULL,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terms)='object'),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  approval_idempotency_key text,
  accepted_by text,
  accepted_at timestamptz,
  acceptance_reference text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,quote_number,version),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,lead_id) REFERENCES sales_leads(tenant_id,id),
  FOREIGN KEY (tenant_id,qualification_id) REFERENCES sales_qualifications(tenant_id,id),
  FOREIGN KEY (tenant_id,offer_version_id) REFERENCES sales_offer_versions(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,approved_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK ((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK (approval_idempotency_key IS NULL OR length(btrim(approval_idempotency_key)) >= 8),
  CHECK ((status='accepted')=(accepted_at IS NOT NULL)),
  CHECK (length(btrim(quote_number)) BETWEEN 1 AND 80),
  CHECK (length(btrim(idempotency_key)) >= 8)
);
CREATE INDEX sales_quotes_pipeline_idx ON sales_quotes(tenant_id,status,updated_at DESC);

CREATE TABLE sales_service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','validating','in_progress','on_hold','fallout','completed','cancelled')),
  subscriber_id uuid,
  owner_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,quote_id),
  UNIQUE (tenant_id,order_number),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,lead_id) REFERENCES sales_leads(tenant_id,id),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES sales_quotes(tenant_id,id),
  FOREIGN KEY (tenant_id,subscriber_id) REFERENCES operations_subscribers(tenant_id,id),
  FOREIGN KEY (tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK (length(btrim(order_number)) BETWEEN 1 AND 80),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE sales_order_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  task_key text NOT NULL,
  task_type text NOT NULL
    CHECK (task_type IN ('commercial','subscriber','resource','installation','network','billing')),
  depends_on_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','running','completed','blocked','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,order_id,task_key),
  FOREIGN KEY (tenant_id,order_id) REFERENCES sales_service_orders(tenant_id,id),
  CHECK (length(btrim(task_key)) BETWEEN 1 AND 80)
);

CREATE FUNCTION sales_current_permission_is(allowed text[]) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM operations_current_context() WHERE permission=ANY(allowed))
$$;

CREATE FUNCTION sales_scope_allows_branch(target_tenant_id uuid,target_branch_id uuid,target_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id=target_tenant_id
      AND (context.branch_ids IS NULL OR target_branch_id IS NULL OR target_branch_id=ANY(context.branch_ids))
      AND (context.record_ids IS NULL OR target_id=ANY(context.record_ids))
  )
$$;

CREATE FUNCTION sales_scope_allows_lead(target_tenant_id uuid,target_lead_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM sales_leads lead
    WHERE lead.tenant_id=target_tenant_id AND lead.id=target_lead_id
      AND operations_scope_allows(lead.tenant_id,lead.branch_id,lead.area_id,lead.route_id,lead.id)
  )
$$;

CREATE FUNCTION sales_scope_allows_order(target_tenant_id uuid,target_order_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM sales_service_orders sales_order
    WHERE sales_order.tenant_id=target_tenant_id AND sales_order.id=target_order_id
      AND sales_scope_allows_lead(sales_order.tenant_id,sales_order.lead_id)
  )
$$;

CREATE FUNCTION validate_sales_lead_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF (OLD.status,NEW.status) NOT IN (
    ('new','qualifying'),('new','lost'),('qualifying','qualified'),
    ('qualifying','disqualified'),('qualifying','lost'),('qualified','quoted'),
    ('qualified','lost'),('quoted','won'),('quoted','lost')
  ) THEN RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invalid sales lead transition'; END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER sales_lead_transition_guard BEFORE UPDATE ON sales_leads
FOR EACH ROW EXECUTE FUNCTION validate_sales_lead_transition();

CREATE FUNCTION validate_sales_quote_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF (OLD.status,NEW.status) NOT IN (
    ('pending_approval','approved'),('pending_approval','rejected'),
    ('issued','accepted'),('issued','rejected'),('issued','expired'),
    ('approved','accepted'),('approved','rejected'),('approved','expired')
  ) THEN RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invalid sales quote transition'; END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER sales_quote_transition_guard BEFORE UPDATE ON sales_quotes
FOR EACH ROW EXECUTE FUNCTION validate_sales_quote_transition();

CREATE FUNCTION protect_sales_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P4092',MESSAGE='sales commercial history is immutable';
END $$;
CREATE TRIGGER sales_offer_immutable BEFORE UPDATE OR DELETE ON sales_offer_versions
FOR EACH ROW EXECUTE FUNCTION protect_sales_history();
CREATE TRIGGER sales_qualification_immutable BEFORE UPDATE OR DELETE ON sales_qualifications
FOR EACH ROW EXECUTE FUNCTION protect_sales_history();

CREATE FUNCTION append_sales_audit_outbox() RETURNS trigger
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

CREATE FUNCTION audit_sales_workspace_read() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND OR context_row.permission<>'tenant.sales.view'
    OR context_row.action<>'tenant.sales.workspace.read' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed sales read context is required';
  END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason
  ) VALUES (
    context_row.tenant_id,context_row.action,'sales_workspace',context_row.tenant_id::text,
    context_row.actor_id,context_row.session_id,context_row.support_grant_id,context_row.permission,
    context_row.request_id,context_row.idempotency_key,context_row.ip_address,context_row.user_agent,
    'allowed',context_row.reason
  );
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_leads','sales_offer_versions','sales_qualifications','sales_quotes',
    'sales_service_orders','sales_order_tasks'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION append_sales_audit_outbox()',
      table_name||'_audit_outbox',table_name
    );
  END LOOP;
END $$;

CREATE POLICY sales_leads_scope ON sales_leads USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND operations_scope_allows(tenant_id,branch_id,area_id,route_id,id)
);
CREATE POLICY sales_offers_scope ON sales_offer_versions USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_branch(tenant_id,branch_id,id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.catalog.manage'])
  AND sales_scope_allows_branch(tenant_id,branch_id,id)
);
CREATE POLICY sales_qualifications_scope ON sales_qualifications USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.sales.manage']) AND sales_scope_allows_lead(tenant_id,lead_id)
);
CREATE POLICY sales_quotes_scope ON sales_quotes USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
);
CREATE POLICY sales_orders_scope ON sales_service_orders USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage'])
  AND sales_scope_allows_lead(tenant_id,lead_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.order.manage']) AND sales_scope_allows_lead(tenant_id,lead_id)
);
CREATE POLICY sales_order_tasks_scope ON sales_order_tasks USING (
  sales_current_permission_is(ARRAY['tenant.sales.view','tenant.sales.manage','tenant.order.manage'])
  AND sales_scope_allows_order(tenant_id,order_id)
) WITH CHECK (
  sales_current_permission_is(ARRAY['tenant.order.manage']) AND sales_scope_allows_order(tenant_id,order_id)
);

CREATE FUNCTION sales_order_readiness()
RETURNS TABLE(migration_ready boolean,relations_ready boolean,guards_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608300210_tenant_sales_order_core.sql'),
    to_regclass('public.sales_leads') IS NOT NULL
      AND to_regclass('public.sales_offer_versions') IS NOT NULL
      AND to_regclass('public.sales_qualifications') IS NOT NULL
      AND to_regclass('public.sales_quotes') IS NOT NULL
      AND to_regclass('public.sales_service_orders') IS NOT NULL
      AND to_regclass('public.sales_order_tasks') IS NOT NULL,
    to_regprocedure('public.append_sales_audit_outbox()') IS NOT NULL
      AND to_regprocedure('public.sales_scope_allows_lead(uuid,uuid)') IS NOT NULL
$$;

REVOKE ALL ON TABLE sales_leads,sales_offer_versions,sales_qualifications,sales_quotes,
  sales_service_orders,sales_order_tasks FROM PUBLIC;
GRANT SELECT,INSERT ON TABLE sales_leads,sales_offer_versions,sales_qualifications,sales_quotes,
  sales_service_orders,sales_order_tasks TO orvex_runtime;
GRANT UPDATE(status,loss_reason,updated_at) ON sales_leads TO orvex_runtime;
GRANT UPDATE(status,approved_by,approved_at,approval_idempotency_key,accepted_by,accepted_at,acceptance_reference,updated_at)
  ON sales_quotes TO orvex_runtime;
GRANT UPDATE(status,subscriber_id,updated_at,completed_at) ON sales_service_orders TO orvex_runtime;
GRANT UPDATE(status,attempts,last_error,updated_at,completed_at) ON sales_order_tasks TO orvex_runtime;

REVOKE ALL ON FUNCTION sales_current_permission_is(text[]),sales_scope_allows_branch(uuid,uuid,uuid),
  sales_scope_allows_lead(uuid,uuid),sales_scope_allows_order(uuid,uuid),sales_order_readiness(),
  validate_sales_lead_transition(),validate_sales_quote_transition(),protect_sales_history(),
  append_sales_audit_outbox(),audit_sales_workspace_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_current_permission_is(text[]),sales_scope_allows_branch(uuid,uuid,uuid),
  sales_scope_allows_lead(uuid,uuid),sales_scope_allows_order(uuid,uuid),sales_order_readiness()
TO orvex_runtime;
GRANT EXECUTE ON FUNCTION audit_sales_workspace_read() TO orvex_runtime;
