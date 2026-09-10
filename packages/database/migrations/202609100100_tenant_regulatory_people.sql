-- 202609100100_tenant_regulatory_people.sql
-- Regulatory and QoS: a licence and renewal register, an obligations calendar, KPI definitions
-- with targets, and periodic submissions whose evidence is a retained snapshot computed from the
-- tenant's own incidents, alarms, tickets and services. People operations: employees linked to
-- staff identities, teams, shifts and on-call, leave with separated approval, and training or
-- certification records with expiry. Every mutation runs under the signed operations context.

-- ---------------------------------------------------------------------------------------------
-- Regulatory register
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operations_regulatory_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('isp_licence', 'frequency', 'municipal', 'numbering', 'other')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
  authority text NOT NULL CHECK (length(btrim(authority)) BETWEEN 1 AND 160),
  title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 1 AND 200),
  title_ar text NOT NULL CHECK (length(btrim(title_ar)) BETWEEN 1 AND 200),
  issued_on date,
  expires_on date,
  renewal_notice_days integer NOT NULL DEFAULT 90 CHECK (renewal_notice_days BETWEEN 0 AND 730),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'renewal_pending', 'expired', 'surrendered')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reference),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE TABLE operations_regulatory_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 1 AND 200),
  title_ar text NOT NULL CHECK (length(btrim(title_ar)) BETWEEN 1 AND 200),
  authority text NOT NULL CHECK (length(btrim(authority)) BETWEEN 1 AND 160),
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual', 'once')),
  next_due_on date NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  evidence_required boolean NOT NULL DEFAULT true,
  description text CHECK (description IS NULL OR length(description) <= 2000),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE operations_qos_kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{1,39}$'),
  name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 1 AND 160),
  name_ar text NOT NULL CHECK (length(btrim(name_ar)) BETWEEN 1 AND 160),
  computation text NOT NULL CHECK (computation IN ('availability_pct', 'mttr_minutes', 'fault_rate_per_100', 'critical_alarms',
    'complaints_per_100', 'first_response_minutes', 'resolution_minutes', 'sla_response_pct', 'sla_resolution_pct', 'manual')),
  unit text NOT NULL CHECK (unit IN ('percent', 'minutes', 'per_100', 'count')),
  target_value numeric(12, 3) NOT NULL,
  comparator text NOT NULL CHECK (comparator IN ('>=', '<=')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE operations_regulatory_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  obligation_id uuid,
  submission_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected')),
  evidence jsonb NOT NULL,
  manual_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  prepared_by uuid NOT NULL REFERENCES users(id),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  submission_reference text CHECK (submission_reference IS NULL OR length(btrim(submission_reference)) BETWEEN 1 AND 200),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, submission_number),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES operations_regulatory_obligations(tenant_id, id),
  CHECK (period_end >= period_start),
  CHECK ((status = 'draft') = (submitted_at IS NULL)),
  CHECK (status NOT IN ('accepted', 'rejected') OR decided_at IS NOT NULL),
  CHECK (NOT operations_json_contains_secret_key(evidence)),
  CHECK (NOT operations_json_contains_secret_key(manual_values))
);
CREATE INDEX regulatory_submissions_idx ON operations_regulatory_submissions(tenant_id, period_start DESC);

CREATE TABLE operations_regulatory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  entity_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

-- ---------------------------------------------------------------------------------------------
-- People operations
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operations_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 1 AND 120),
  name_ar text NOT NULL CHECK (length(btrim(name_ar)) BETWEEN 1 AND 120),
  branch_id uuid,
  lead_employee_id uuid,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id)
);

CREATE TABLE operations_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  employee_number text NOT NULL CHECK (length(btrim(employee_number)) BETWEEN 1 AND 40),
  user_id uuid,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  role_title text NOT NULL CHECK (length(btrim(role_title)) BETWEEN 1 AND 120),
  team_id uuid,
  branch_id uuid,
  phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  hired_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'suspended', 'left')),
  skills text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, employee_number),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES operations_teams(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK (cardinality(skills) <= 30)
);
CREATE UNIQUE INDEX employees_one_per_user ON operations_employees(tenant_id, user_id) WHERE user_id IS NOT NULL;
ALTER TABLE operations_teams
  ADD CONSTRAINT teams_lead_fk FOREIGN KEY (tenant_id, lead_employee_id) REFERENCES operations_employees(tenant_id, id);

CREATE TABLE operations_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  employee_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('shift', 'on_call')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location_note text CHECK (location_note IS NULL OR length(location_note) <= 200),
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 8 AND 500),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES operations_employees(tenant_id, id),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '36 hours'),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX shifts_employee_window_idx ON operations_shifts(tenant_id, employee_id, starts_at);

CREATE TABLE operations_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  employee_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('annual', 'sick', 'unpaid', 'compassionate', 'other')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES operations_employees(tenant_id, id),
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 365),
  CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX leave_requests_idx ON operations_leave_requests(tenant_id, status, starts_on);

CREATE TABLE operations_training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  employee_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  provider text CHECK (provider IS NULL OR length(provider) <= 160),
  kind text NOT NULL CHECK (kind IN ('training', 'certification', 'safety', 'induction')),
  completed_on date NOT NULL,
  expires_on date,
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES operations_employees(tenant_id, id),
  CHECK (expires_on IS NULL OR expires_on >= completed_on)
);

CREATE TABLE operations_people_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  entity_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

-- Row policies, append-only ledgers and audit on state tables.
CREATE TRIGGER regulatory_events_append_only BEFORE UPDATE OR DELETE ON operations_regulatory_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER people_events_append_only BEFORE UPDATE OR DELETE ON operations_people_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER training_records_append_only BEFORE UPDATE OR DELETE ON operations_training_records
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['operations_regulatory_licences','operations_regulatory_obligations','operations_qos_kpi_definitions',
    'operations_regulatory_submissions','operations_regulatory_events','operations_teams','operations_employees','operations_shifts',
    'operations_leave_requests','operations_training_records','operations_people_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t || '_tenant', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['operations_regulatory_licences','operations_regulatory_obligations','operations_qos_kpi_definitions',
    'operations_regulatory_submissions','operations_teams','operations_employees','operations_shifts','operations_leave_requests',
    'operations_training_records'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox()', t || '_audit', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Audit allow-list: regulatory and people actions may touch their tables.
-- ---------------------------------------------------------------------------------------------
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
      AND base_action IN ('tenant.service.installation.create','tenant.installation.transition',
        'tenant.field.dispatch','tenant.field.execute')
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
      AND base_action IN ('tenant.installation.transition','tenant.field.dispatch','tenant.field.execute')
      AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME='operations_support_issues'
      AND base_action IN ('tenant.issue.create','tenant.issue.transition','tenant.support.manage')
      AND context_row.permission='tenant.subscriber.edit')
    OR (TG_TABLE_NAME='operations_issue_events'
      AND base_action IN ('tenant.issue.transition','tenant.support.manage')
      AND context_row.permission='tenant.subscriber.edit')
    OR (TG_TABLE_NAME='operations_export_jobs'
      AND base_action='tenant.report.export' AND context_row.permission='tenant.report.export')
    OR (TG_TABLE_NAME='operations_network_action_outbox'
      AND base_action='tenant.network.job.create' AND context_row.permission='tenant.network.job.create')
    OR (TG_TABLE_NAME IN ('operations_office_payment_requests','operations_cash_drawers')
      AND base_action='tenant.cashier.manage' AND context_row.permission IN ('tenant.payment.post','tenant.payment.reverse'))
    OR (TG_TABLE_NAME IN ('operations_collector_assignments','operations_collector_collection_evidence',
      'operations_route_collectors','operations_route_settlements')
      AND base_action='tenant.collection.manage' AND context_row.permission IN ('tenant.collection.reconcile','tenant.payment.post'))
    OR (TG_TABLE_NAME IN ('operations_regulatory_licences','operations_regulatory_obligations','operations_qos_kpi_definitions',
      'operations_regulatory_submissions')
      AND base_action='tenant.regulatory.manage' AND context_row.permission='tenant.user.administer')
    OR (TG_TABLE_NAME IN ('operations_teams','operations_employees','operations_shifts','operations_leave_requests',
      'operations_training_records')
      AND base_action='tenant.people.manage' AND context_row.permission='tenant.user.administer')
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

-- ---------------------------------------------------------------------------------------------
-- Shared context helper
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION people_context_or_raise(p_action text, p_permissions text[]) RETURNS operations_request_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> p_action OR NOT (c.permission = ANY(p_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed regulatory or people authority required';
  END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION people_context_or_raise(text, text[]) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- QoS evidence: every KPI value is computed from retained source rows with its numerator and
-- denominator, so a submission can be traced back to the records behind each number.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION regulatory_compute_kpis(p_tenant uuid, p_from date, p_to date, p_manual jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  win_start timestamptz := p_from::timestamp AT TIME ZONE 'Asia/Beirut';
  win_end timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Beirut';
  period_minutes numeric := extract(epoch FROM (win_end - win_start)) / 60;
  active_services numeric; active_subscribers numeric;
  outage_minutes numeric; outages_started integer; outages_resolved integer; mttr numeric;
  critical_alarms integer; complaints integer; tickets integer;
  first_response numeric; resolution numeric; sla_resp numeric; sla_res numeric;
  values jsonb := '{}'::jsonb;
  k operations_qos_kpi_definitions%ROWTYPE;
  v numeric; num numeric; den numeric; met boolean; item jsonb;
BEGIN
  SELECT count(*) INTO active_services FROM operations_services s WHERE s.tenant_id = p_tenant AND s.status = 'active';
  SELECT count(*) INTO active_subscribers FROM operations_subscribers s WHERE s.tenant_id = p_tenant AND s.status = 'active';
  SELECT coalesce(sum(extract(epoch FROM (least(coalesce(o.resolved_at, clock_timestamp()), win_end) - greatest(o.started_at, win_start))) / 60), 0)
    INTO outage_minutes
    FROM operations_outages o WHERE o.tenant_id = p_tenant AND o.started_at < win_end AND coalesce(o.resolved_at, clock_timestamp()) > win_start;
  SELECT count(*) INTO outages_started FROM operations_outages o WHERE o.tenant_id = p_tenant AND o.started_at >= win_start AND o.started_at < win_end;
  SELECT count(*), avg(extract(epoch FROM (o.resolved_at - o.started_at)) / 60) INTO outages_resolved, mttr
    FROM operations_outages o WHERE o.tenant_id = p_tenant AND o.resolved_at >= win_start AND o.resolved_at < win_end;
  SELECT count(*) INTO critical_alarms FROM operations_network_alarms a
    WHERE a.tenant_id = p_tenant AND a.severity = 'critical' AND a.raised_at >= win_start AND a.raised_at < win_end;
  SELECT count(*) FILTER (WHERE i.category = 'complaint'), count(*),
      avg(extract(epoch FROM (i.first_response_at - i.created_at)) / 60) FILTER (WHERE i.first_response_at IS NOT NULL),
      avg(extract(epoch FROM (i.closed_at - i.created_at)) / 60) FILTER (WHERE i.closed_at IS NOT NULL),
      100.0 * count(*) FILTER (WHERE i.first_response_at IS NOT NULL AND i.sla_respond_due_at IS NOT NULL AND i.first_response_at <= i.sla_respond_due_at)
        / nullif(count(*) FILTER (WHERE i.sla_respond_due_at IS NOT NULL), 0),
      100.0 * count(*) FILTER (WHERE i.closed_at IS NOT NULL AND i.sla_resolve_due_at IS NOT NULL AND i.closed_at <= i.sla_resolve_due_at)
        / nullif(count(*) FILTER (WHERE i.sla_resolve_due_at IS NOT NULL AND i.closed_at IS NOT NULL), 0)
    INTO complaints, tickets, first_response, resolution, sla_resp, sla_res
    FROM operations_support_issues i WHERE i.tenant_id = p_tenant AND i.created_at >= win_start AND i.created_at < win_end;

  FOR k IN SELECT * FROM operations_qos_kpi_definitions d WHERE d.tenant_id = p_tenant AND d.active ORDER BY d.code LOOP
    num := NULL; den := NULL;
    CASE k.computation
      WHEN 'availability_pct' THEN num := outage_minutes; den := period_minutes; v := greatest(0, 100 - 100 * outage_minutes / nullif(period_minutes, 0));
      WHEN 'mttr_minutes' THEN num := outages_resolved; v := mttr;
      WHEN 'fault_rate_per_100' THEN num := outages_started; den := active_services; v := CASE WHEN active_services > 0 THEN 100 * outages_started / active_services END;
      WHEN 'critical_alarms' THEN num := critical_alarms; v := critical_alarms;
      WHEN 'complaints_per_100' THEN num := complaints; den := active_subscribers; v := CASE WHEN active_subscribers > 0 THEN 100 * complaints / active_subscribers END;
      WHEN 'first_response_minutes' THEN num := tickets; v := first_response;
      WHEN 'resolution_minutes' THEN num := tickets; v := resolution;
      WHEN 'sla_response_pct' THEN num := tickets; v := sla_resp;
      WHEN 'sla_resolution_pct' THEN num := tickets; v := sla_res;
      ELSE v := (p_manual->>k.code)::numeric;
    END CASE;
    met := CASE WHEN v IS NULL THEN NULL WHEN k.comparator = '>=' THEN v >= k.target_value ELSE v <= k.target_value END;
    item := jsonb_build_object('code', k.code, 'nameEn', k.name_en, 'nameAr', k.name_ar, 'computation', k.computation, 'unit', k.unit,
      'target', k.target_value, 'comparator', k.comparator, 'value', round(v, 3), 'met', met, 'numerator', num, 'denominator', den,
      'source', CASE k.computation WHEN 'manual' THEN 'manual' ELSE 'computed' END);
    values := values || jsonb_build_object(k.code, item);
  END LOOP;
  RETURN jsonb_build_object('periodStart', p_from, 'periodEnd', p_to, 'computedAt', clock_timestamp(), 'periodMinutes', round(period_minutes),
    'activeServices', active_services, 'activeSubscribers', active_subscribers, 'outageMinutes', round(outage_minutes, 1),
    'outagesStarted', outages_started, 'outagesResolved', outages_resolved, 'criticalAlarms', critical_alarms,
    'tickets', tickets, 'complaints', complaints, 'kpis', values);
END $$;
REVOKE ALL ON FUNCTION regulatory_compute_kpis(uuid, date, date, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Regulatory commands
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION execute_regulatory_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_regulatory_events%ROWTYPE;
  lic operations_regulatory_licences%ROWTYPE;
  ob operations_regulatory_obligations%ROWTYPE;
  kpi operations_qos_kpi_definitions%ROWTYPE;
  sub operations_regulatory_submissions%ROWTYPE;
  v_action text; answer jsonb; v_id uuid; v_entity uuid; n integer := 0; v_from date; v_to date; v_status text;
  d record;
BEGIN
  c := people_context_or_raise('tenant.regulatory.manage', ARRAY['tenant.user.administer']);
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid regulatory payload';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':regulatory:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_regulatory_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'regulatory retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'upsert_licence' THEN
    v_id := (payload->>'licenceId')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO operations_regulatory_licences(tenant_id, kind, reference, authority, title_en, title_ar, issued_on, expires_on, renewal_notice_days, status, notes)
        VALUES (c.tenant_id, payload->>'kind', btrim(payload->>'reference'), btrim(payload->>'authority'), btrim(payload->>'titleEn'), btrim(payload->>'titleAr'),
          (payload->>'issuedOn')::date, (payload->>'expiresOn')::date, coalesce((payload->>'renewalNoticeDays')::integer, 90),
          coalesce(payload->>'status', 'active'), nullif(btrim(coalesce(payload->>'notes', '')), ''))
        RETURNING * INTO lic;
    ELSE
      SELECT * INTO lic FROM operations_regulatory_licences WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'licence missing'; END IF;
      IF lic.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'licence changed since it was read'; END IF;
      UPDATE operations_regulatory_licences SET
        kind = coalesce(payload->>'kind', kind), reference = coalesce(btrim(payload->>'reference'), reference), authority = coalesce(btrim(payload->>'authority'), authority),
        title_en = coalesce(btrim(payload->>'titleEn'), title_en), title_ar = coalesce(btrim(payload->>'titleAr'), title_ar),
        issued_on = CASE WHEN payload ? 'issuedOn' THEN (payload->>'issuedOn')::date ELSE issued_on END,
        expires_on = CASE WHEN payload ? 'expiresOn' THEN (payload->>'expiresOn')::date ELSE expires_on END,
        renewal_notice_days = coalesce((payload->>'renewalNoticeDays')::integer, renewal_notice_days),
        status = coalesce(payload->>'status', status), notes = CASE WHEN payload ? 'notes' THEN nullif(btrim(payload->>'notes'), '') ELSE notes END,
        version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO lic;
    END IF;
    v_entity := lic.id;
    answer := jsonb_build_object('licenceId', lic.id, 'status', lic.status, 'version', lic.version);

  ELSIF v_action = 'upsert_obligation' THEN
    v_id := (payload->>'obligationId')::uuid;
    IF payload ? 'ownerUserId' AND payload->>'ownerUserId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = (payload->>'ownerUserId')::uuid AND m.active) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'obligation owner must be an active member';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO operations_regulatory_obligations(tenant_id, code, title_en, title_ar, authority, frequency, next_due_on, owner_user_id, evidence_required, description)
        VALUES (c.tenant_id, upper(btrim(payload->>'code')), btrim(payload->>'titleEn'), btrim(payload->>'titleAr'), btrim(payload->>'authority'), payload->>'frequency',
          (payload->>'nextDueOn')::date, (payload->>'ownerUserId')::uuid, coalesce((payload->>'evidenceRequired')::boolean, true), nullif(btrim(coalesce(payload->>'description', '')), ''))
        RETURNING * INTO ob;
    ELSE
      SELECT * INTO ob FROM operations_regulatory_obligations WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'obligation missing'; END IF;
      IF ob.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'obligation changed since it was read'; END IF;
      UPDATE operations_regulatory_obligations SET
        title_en = coalesce(btrim(payload->>'titleEn'), title_en), title_ar = coalesce(btrim(payload->>'titleAr'), title_ar), authority = coalesce(btrim(payload->>'authority'), authority),
        frequency = coalesce(payload->>'frequency', frequency), next_due_on = coalesce((payload->>'nextDueOn')::date, next_due_on),
        owner_user_id = CASE WHEN payload ? 'ownerUserId' THEN (payload->>'ownerUserId')::uuid ELSE owner_user_id END,
        evidence_required = coalesce((payload->>'evidenceRequired')::boolean, evidence_required),
        description = CASE WHEN payload ? 'description' THEN nullif(btrim(payload->>'description'), '') ELSE description END,
        active = coalesce((payload->>'active')::boolean, active), version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO ob;
    END IF;
    v_entity := ob.id;
    answer := jsonb_build_object('obligationId', ob.id, 'nextDueOn', ob.next_due_on, 'version', ob.version);

  ELSIF v_action = 'upsert_kpi' THEN
    v_id := (payload->>'kpiId')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO operations_qos_kpi_definitions(tenant_id, code, name_en, name_ar, computation, unit, target_value, comparator)
        VALUES (c.tenant_id, upper(btrim(payload->>'code')), btrim(payload->>'nameEn'), btrim(payload->>'nameAr'), payload->>'computation', payload->>'unit',
          (payload->>'target')::numeric, payload->>'comparator')
        RETURNING * INTO kpi;
    ELSE
      SELECT * INTO kpi FROM operations_qos_kpi_definitions WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'kpi missing'; END IF;
      IF kpi.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'kpi changed since it was read'; END IF;
      UPDATE operations_qos_kpi_definitions SET
        name_en = coalesce(btrim(payload->>'nameEn'), name_en), name_ar = coalesce(btrim(payload->>'nameAr'), name_ar),
        target_value = coalesce((payload->>'target')::numeric, target_value), comparator = coalesce(payload->>'comparator', comparator),
        active = coalesce((payload->>'active')::boolean, active), version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO kpi;
    END IF;
    v_entity := kpi.id;
    answer := jsonb_build_object('kpiId', kpi.id, 'code', kpi.code, 'version', kpi.version);

  ELSIF v_action = 'seed_standard_kpis' THEN
    FOR d IN SELECT * FROM (VALUES
        ('AVAILABILITY', 'Network availability', 'توافر الشبكة', 'availability_pct', 'percent', 99.5, '>='),
        ('MTTR', 'Mean time to restore', 'متوسط زمن الإصلاح', 'mttr_minutes', 'minutes', 240, '<='),
        ('FAULT_RATE', 'Faults per 100 services', 'الأعطال لكل ١٠٠ خدمة', 'fault_rate_per_100', 'per_100', 5, '<='),
        ('CRITICAL_ALARMS', 'Critical alarms raised', 'الإنذارات الحرجة', 'critical_alarms', 'count', 10, '<='),
        ('COMPLAINTS', 'Complaints per 100 subscribers', 'الشكاوى لكل ١٠٠ مشترك', 'complaints_per_100', 'per_100', 2, '<='),
        ('FIRST_RESPONSE', 'Average first response', 'متوسط الاستجابة الأولى', 'first_response_minutes', 'minutes', 60, '<='),
        ('RESOLUTION', 'Average ticket resolution', 'متوسط حل التذاكر', 'resolution_minutes', 'minutes', 1440, '<='),
        ('SLA_RESPONSE', 'Tickets answered within SLA', 'التذاكر المجابة ضمن المهلة', 'sla_response_pct', 'percent', 90, '>='),
        ('SLA_RESOLUTION', 'Tickets resolved within SLA', 'التذاكر المحلولة ضمن المهلة', 'sla_resolution_pct', 'percent', 90, '>=')
      ) AS s(code, name_en, name_ar, computation, unit, target, comparator) LOOP
      INSERT INTO operations_qos_kpi_definitions(tenant_id, code, name_en, name_ar, computation, unit, target_value, comparator)
        VALUES (c.tenant_id, d.code, d.name_en, d.name_ar, d.computation, d.unit, d.target, d.comparator)
        ON CONFLICT (tenant_id, code) DO NOTHING;
      IF FOUND THEN n := n + 1; END IF;
    END LOOP;
    answer := jsonb_build_object('created', n);

  ELSIF v_action = 'prepare_submission' THEN
    v_from := (payload->>'periodStart')::date; v_to := (payload->>'periodEnd')::date;
    IF v_from IS NULL OR v_to IS NULL OR v_to < v_from OR v_to - v_from > 366 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'submission needs a period of at most one year';
    END IF;
    IF payload ? 'obligationId' AND payload->>'obligationId' IS NOT NULL THEN
      SELECT * INTO ob FROM operations_regulatory_obligations WHERE tenant_id = c.tenant_id AND id = (payload->>'obligationId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'obligation missing'; END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM operations_qos_kpi_definitions k WHERE k.tenant_id = c.tenant_id AND k.active) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'define at least one active KPI before preparing a submission';
    END IF;
    INSERT INTO operations_regulatory_submissions(tenant_id, obligation_id, submission_number, period_start, period_end, evidence, manual_values, notes, prepared_by)
      VALUES (c.tenant_id, ob.id, operations_next_document_number(c.tenant_id, 'regulatory_submission', 'REG'), v_from, v_to,
        regulatory_compute_kpis(c.tenant_id, v_from, v_to, coalesce(payload->'manualValues', '{}'::jsonb)), coalesce(payload->'manualValues', '{}'::jsonb),
        nullif(btrim(coalesce(payload->>'notes', '')), ''), c.actor_id::uuid)
      RETURNING * INTO sub;
    v_entity := sub.id;
    answer := jsonb_build_object('submissionId', sub.id, 'submissionNumber', sub.submission_number, 'status', sub.status, 'evidence', sub.evidence, 'version', sub.version);

  ELSIF v_action IN ('submit', 'record_decision') THEN
    SELECT * INTO sub FROM operations_regulatory_submissions WHERE tenant_id = c.tenant_id AND id = (payload->>'submissionId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'submission missing'; END IF;
    IF sub.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'submission changed since it was read'; END IF;
    IF v_action = 'submit' THEN
      IF sub.status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a draft can be submitted'; END IF;
      IF nullif(btrim(coalesce(payload->>'reference', '')), '') IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'the regulator reference is required'; END IF;
      UPDATE operations_regulatory_submissions SET status = 'submitted', submitted_by = c.actor_id::uuid, submitted_at = clock_timestamp(),
        submission_reference = btrim(payload->>'reference'), version = version + 1 WHERE tenant_id = c.tenant_id AND id = sub.id RETURNING * INTO sub;
      IF sub.obligation_id IS NOT NULL THEN
        UPDATE operations_regulatory_obligations SET next_due_on = CASE frequency
            WHEN 'monthly' THEN next_due_on + interval '1 month' WHEN 'quarterly' THEN next_due_on + interval '3 months'
            WHEN 'semiannual' THEN next_due_on + interval '6 months' WHEN 'annual' THEN next_due_on + interval '1 year' ELSE next_due_on END,
          active = CASE WHEN frequency = 'once' THEN false ELSE active END, version = version + 1, updated_at = clock_timestamp()
          WHERE tenant_id = c.tenant_id AND id = sub.obligation_id;
      END IF;
    ELSE
      v_status := payload->>'status';
      IF sub.status <> 'submitted' OR v_status NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a submitted report can be decided'; END IF;
      UPDATE operations_regulatory_submissions SET status = v_status, decided_at = clock_timestamp(), decision_note = nullif(btrim(coalesce(payload->>'note', '')), ''),
        version = version + 1 WHERE tenant_id = c.tenant_id AND id = sub.id RETURNING * INTO sub;
    END IF;
    v_entity := sub.id;
    answer := jsonb_build_object('submissionId', sub.id, 'status', sub.status, 'version', sub.version);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown regulatory action';
  END IF;

  INSERT INTO operations_regulatory_events(tenant_id, action, entity_id, actor_id, idempotency_key, request_payload, result)
    VALUES (c.tenant_id, v_action, v_entity, c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_regulatory_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_regulatory_command(jsonb) TO orvex_runtime;

CREATE FUNCTION read_regulatory_workspace(p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; today date; f date; t date; result jsonb;
BEGIN
  c := people_context_or_raise('tenant.regulatory.workspace.read', ARRAY['tenant.report.view', 'tenant.report.export', 'tenant.user.administer']);
  today := (clock_timestamp() AT TIME ZONE 'Asia/Beirut')::date;
  f := coalesce(p_from, date_trunc('month', today)::date);
  t := coalesce(p_to, today);
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'licences', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'reference', l.reference, 'authority', l.authority, 'titleEn', l.title_en, 'titleAr', l.title_ar,
        'issuedOn', l.issued_on, 'expiresOn', l.expires_on, 'renewalNoticeDays', l.renewal_notice_days, 'status', l.status, 'notes', l.notes, 'version', l.version,
        'daysToExpiry', CASE WHEN l.expires_on IS NULL THEN NULL ELSE l.expires_on - today END,
        'renewalDue', l.expires_on IS NOT NULL AND l.expires_on - today <= l.renewal_notice_days) ORDER BY l.expires_on NULLS LAST, l.reference)
      FROM operations_regulatory_licences l WHERE l.tenant_id = c.tenant_id), '[]'::jsonb),
    'obligations', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'titleEn', o.title_en, 'titleAr', o.title_ar, 'authority', o.authority,
        'frequency', o.frequency, 'nextDueOn', o.next_due_on, 'ownerUserId', o.owner_user_id, 'ownerName', u.display_name, 'evidenceRequired', o.evidence_required,
        'description', o.description, 'active', o.active, 'version', o.version, 'daysToDue', o.next_due_on - today, 'overdue', o.active AND o.next_due_on < today,
        'lastSubmission', (SELECT jsonb_build_object('id', s.id, 'submissionNumber', s.submission_number, 'status', s.status, 'periodEnd', s.period_end)
            FROM operations_regulatory_submissions s WHERE s.tenant_id = o.tenant_id AND s.obligation_id = o.id ORDER BY s.prepared_at DESC LIMIT 1)) ORDER BY o.active DESC, o.next_due_on)
      FROM operations_regulatory_obligations o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.tenant_id = c.tenant_id), '[]'::jsonb),
    'kpis', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'code', k.code, 'nameEn', k.name_en, 'nameAr', k.name_ar, 'computation', k.computation, 'unit', k.unit,
        'target', k.target_value, 'comparator', k.comparator, 'active', k.active, 'version', k.version) ORDER BY k.code)
      FROM operations_qos_kpi_definitions k WHERE k.tenant_id = c.tenant_id), '[]'::jsonb),
    'current', regulatory_compute_kpis(c.tenant_id, f, t),
    'submissions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'submissionNumber', s.submission_number, 'obligationId', s.obligation_id, 'obligationCode', o.code,
        'periodStart', s.period_start, 'periodEnd', s.period_end, 'status', s.status, 'evidence', s.evidence, 'notes', s.notes,
        'preparedBy', coalesce(pb.display_name, s.prepared_by::text), 'preparedAt', s.prepared_at, 'submittedBy', sb.display_name, 'submittedAt', s.submitted_at,
        'submissionReference', s.submission_reference, 'decidedAt', s.decided_at, 'decisionNote', s.decision_note, 'version', s.version) ORDER BY s.prepared_at DESC)
      FROM (SELECT * FROM operations_regulatory_submissions WHERE tenant_id = c.tenant_id ORDER BY prepared_at DESC LIMIT 100) s
      LEFT JOIN operations_regulatory_obligations o ON o.tenant_id = s.tenant_id AND o.id = s.obligation_id
      LEFT JOIN users pb ON pb.id = s.prepared_by LEFT JOIN users sb ON sb.id = s.submitted_by), '[]'::jsonb),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', u.display_name) ORDER BY u.display_name)
      FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = c.tenant_id AND m.active), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_regulatory_workspace(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_regulatory_workspace(date, date) TO orvex_runtime;

-- ---------------------------------------------------------------------------------------------
-- People commands
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION execute_people_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_people_events%ROWTYPE;
  team operations_teams%ROWTYPE;
  emp operations_employees%ROWTYPE;
  sh operations_shifts%ROWTYPE;
  lv operations_leave_requests%ROWTYPE;
  tr operations_training_records%ROWTYPE;
  v_action text; answer jsonb; v_id uuid; v_entity uuid; v_user uuid; v_start timestamptz; v_end timestamptz; v_status text;
BEGIN
  c := people_context_or_raise('tenant.people.manage', ARRAY['tenant.user.administer']);
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid people payload';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':people:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_people_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'people retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'upsert_team' THEN
    v_id := (payload->>'teamId')::uuid;
    IF payload ? 'branchId' AND payload->>'branchId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND b.id = (payload->>'branchId')::uuid AND operations_scope_allows(b.tenant_id, b.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'branch missing or outside scope';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO operations_teams(tenant_id, code, name_en, name_ar, branch_id, lead_employee_id)
        VALUES (c.tenant_id, upper(btrim(payload->>'code')), btrim(payload->>'nameEn'), btrim(payload->>'nameAr'), (payload->>'branchId')::uuid, (payload->>'leadEmployeeId')::uuid)
        RETURNING * INTO team;
    ELSE
      SELECT * INTO team FROM operations_teams WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'team missing'; END IF;
      IF team.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'team changed since it was read'; END IF;
      UPDATE operations_teams SET name_en = coalesce(btrim(payload->>'nameEn'), name_en), name_ar = coalesce(btrim(payload->>'nameAr'), name_ar),
        branch_id = CASE WHEN payload ? 'branchId' THEN (payload->>'branchId')::uuid ELSE branch_id END,
        lead_employee_id = CASE WHEN payload ? 'leadEmployeeId' THEN (payload->>'leadEmployeeId')::uuid ELSE lead_employee_id END,
        active = coalesce((payload->>'active')::boolean, active), version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO team;
    END IF;
    v_entity := team.id;
    answer := jsonb_build_object('teamId', team.id, 'code', team.code, 'version', team.version);

  ELSIF v_action = 'upsert_employee' THEN
    v_id := (payload->>'employeeId')::uuid;
    v_user := (payload->>'userId')::uuid;
    IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_user) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'linked staff identity must be a member of this workspace';
    END IF;
    IF payload ? 'branchId' AND payload->>'branchId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND b.id = (payload->>'branchId')::uuid AND operations_scope_allows(b.tenant_id, b.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'branch missing or outside scope';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO operations_employees(tenant_id, employee_number, user_id, display_name, role_title, team_id, branch_id, phone, email, hired_on, status, skills, notes)
        VALUES (c.tenant_id, btrim(payload->>'employeeNumber'), v_user, btrim(payload->>'displayName'), btrim(payload->>'roleTitle'), (payload->>'teamId')::uuid,
          (payload->>'branchId')::uuid, nullif(btrim(coalesce(payload->>'phone', '')), ''), nullif(btrim(coalesce(payload->>'email', '')), ''), (payload->>'hiredOn')::date,
          coalesce(payload->>'status', 'active'), coalesce(ARRAY(SELECT jsonb_array_elements_text(payload->'skills')), ARRAY[]::text[]), nullif(btrim(coalesce(payload->>'notes', '')), ''))
        RETURNING * INTO emp;
    ELSE
      SELECT * INTO emp FROM operations_employees WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'employee missing'; END IF;
      IF emp.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'employee changed since it was read'; END IF;
      UPDATE operations_employees SET
        user_id = CASE WHEN payload ? 'userId' THEN v_user ELSE user_id END,
        display_name = coalesce(btrim(payload->>'displayName'), display_name), role_title = coalesce(btrim(payload->>'roleTitle'), role_title),
        team_id = CASE WHEN payload ? 'teamId' THEN (payload->>'teamId')::uuid ELSE team_id END,
        branch_id = CASE WHEN payload ? 'branchId' THEN (payload->>'branchId')::uuid ELSE branch_id END,
        phone = CASE WHEN payload ? 'phone' THEN nullif(btrim(payload->>'phone'), '') ELSE phone END,
        email = CASE WHEN payload ? 'email' THEN nullif(btrim(payload->>'email'), '') ELSE email END,
        hired_on = CASE WHEN payload ? 'hiredOn' THEN (payload->>'hiredOn')::date ELSE hired_on END,
        status = coalesce(payload->>'status', status),
        skills = CASE WHEN payload ? 'skills' THEN ARRAY(SELECT jsonb_array_elements_text(payload->'skills')) ELSE skills END,
        notes = CASE WHEN payload ? 'notes' THEN nullif(btrim(payload->>'notes'), '') ELSE notes END,
        version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO emp;
    END IF;
    v_entity := emp.id;
    answer := jsonb_build_object('employeeId', emp.id, 'employeeNumber', emp.employee_number, 'status', emp.status, 'version', emp.version);

  ELSIF v_action = 'schedule_shift' THEN
    SELECT * INTO emp FROM operations_employees WHERE tenant_id = c.tenant_id AND id = (payload->>'employeeId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'employee missing'; END IF;
    IF emp.status = 'left' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'an employee who left cannot be scheduled'; END IF;
    v_start := (payload->>'startsAt')::timestamptz; v_end := (payload->>'endsAt')::timestamptz;
    IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'shift needs a start before its end'; END IF;
    IF EXISTS (SELECT 1 FROM operations_shifts s WHERE s.tenant_id = c.tenant_id AND s.employee_id = emp.id AND s.cancelled_at IS NULL
                 AND s.kind = coalesce(payload->>'kind', 'shift') AND s.starts_at < v_end AND s.ends_at > v_start) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'the employee already has a shift of this kind in that window';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_leave_requests l WHERE l.tenant_id = c.tenant_id AND l.employee_id = emp.id AND l.status = 'approved'
                 AND l.starts_on <= (v_end AT TIME ZONE 'Asia/Beirut')::date AND l.ends_on >= (v_start AT TIME ZONE 'Asia/Beirut')::date) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'the employee is on approved leave in that window';
    END IF;
    INSERT INTO operations_shifts(tenant_id, employee_id, kind, starts_at, ends_at, location_note, created_by)
      VALUES (c.tenant_id, emp.id, coalesce(payload->>'kind', 'shift'), v_start, v_end, nullif(btrim(coalesce(payload->>'locationNote', '')), ''), c.actor_id::uuid)
      RETURNING * INTO sh;
    v_entity := sh.id;
    answer := jsonb_build_object('shiftId', sh.id, 'employeeId', emp.id, 'kind', sh.kind, 'startsAt', sh.starts_at, 'endsAt', sh.ends_at);

  ELSIF v_action = 'cancel_shift' THEN
    SELECT * INTO sh FROM operations_shifts WHERE tenant_id = c.tenant_id AND id = (payload->>'shiftId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'shift missing'; END IF;
    IF sh.cancelled_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'shift is already cancelled'; END IF;
    IF length(btrim(coalesce(payload->>'reason', ''))) < 8 THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'cancelling needs a reason of at least 8 characters'; END IF;
    UPDATE operations_shifts SET cancelled_at = clock_timestamp(), cancel_reason = btrim(payload->>'reason') WHERE tenant_id = c.tenant_id AND id = sh.id RETURNING * INTO sh;
    v_entity := sh.id;
    answer := jsonb_build_object('shiftId', sh.id, 'cancelledAt', sh.cancelled_at);

  ELSIF v_action = 'request_leave' THEN
    SELECT * INTO emp FROM operations_employees WHERE tenant_id = c.tenant_id AND id = (payload->>'employeeId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'employee missing'; END IF;
    IF (payload->>'startsOn')::date IS NULL OR (payload->>'endsOn')::date IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'leave needs its dates'; END IF;
    IF EXISTS (SELECT 1 FROM operations_leave_requests l WHERE l.tenant_id = c.tenant_id AND l.employee_id = emp.id AND l.status IN ('requested', 'approved')
                 AND l.starts_on <= (payload->>'endsOn')::date AND l.ends_on >= (payload->>'startsOn')::date) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'an open leave request already covers those dates';
    END IF;
    INSERT INTO operations_leave_requests(tenant_id, employee_id, kind, starts_on, ends_on, reason, requested_by)
      VALUES (c.tenant_id, emp.id, coalesce(payload->>'kind', 'annual'), (payload->>'startsOn')::date, (payload->>'endsOn')::date,
        nullif(btrim(coalesce(payload->>'reason', '')), ''), c.actor_id::uuid)
      RETURNING * INTO lv;
    v_entity := lv.id;
    answer := jsonb_build_object('leaveId', lv.id, 'status', lv.status, 'version', lv.version);

  ELSIF v_action = 'decide_leave' THEN
    SELECT * INTO lv FROM operations_leave_requests WHERE tenant_id = c.tenant_id AND id = (payload->>'leaveId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'leave request missing'; END IF;
    IF lv.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'leave request changed since it was read'; END IF;
    v_status := payload->>'status';
    IF lv.status <> 'requested' OR v_status NOT IN ('approved', 'rejected', 'cancelled') THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only an open request can be decided'; END IF;
    SELECT * INTO emp FROM operations_employees WHERE tenant_id = c.tenant_id AND id = lv.employee_id;
    IF v_status IN ('approved', 'rejected') AND (lv.requested_by::text = c.actor_id OR emp.user_id::text = c.actor_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'a different person must decide the leave request';
    END IF;
    UPDATE operations_leave_requests SET status = v_status,
      decided_by = CASE WHEN v_status = 'cancelled' THEN NULL ELSE c.actor_id::uuid END,
      decided_at = CASE WHEN v_status = 'cancelled' THEN NULL ELSE clock_timestamp() END,
      decision_note = nullif(btrim(coalesce(payload->>'note', '')), ''), version = version + 1
      WHERE tenant_id = c.tenant_id AND id = lv.id RETURNING * INTO lv;
    IF v_status = 'approved' THEN
      UPDATE operations_shifts SET cancelled_at = clock_timestamp(), cancel_reason = 'Approved leave ' || lv.id::text
        WHERE tenant_id = c.tenant_id AND employee_id = lv.employee_id AND cancelled_at IS NULL
          AND (starts_at AT TIME ZONE 'Asia/Beirut')::date <= lv.ends_on AND (ends_at AT TIME ZONE 'Asia/Beirut')::date >= lv.starts_on;
    END IF;
    v_entity := lv.id;
    answer := jsonb_build_object('leaveId', lv.id, 'status', lv.status, 'version', lv.version);

  ELSIF v_action = 'record_training' THEN
    SELECT * INTO emp FROM operations_employees WHERE tenant_id = c.tenant_id AND id = (payload->>'employeeId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'employee missing'; END IF;
    INSERT INTO operations_training_records(tenant_id, employee_id, title, provider, kind, completed_on, expires_on, reference, recorded_by)
      VALUES (c.tenant_id, emp.id, btrim(payload->>'title'), nullif(btrim(coalesce(payload->>'provider', '')), ''), coalesce(payload->>'kind', 'training'),
        (payload->>'completedOn')::date, (payload->>'expiresOn')::date, nullif(btrim(coalesce(payload->>'reference', '')), ''), c.actor_id::uuid)
      RETURNING * INTO tr;
    v_entity := tr.id;
    answer := jsonb_build_object('trainingId', tr.id, 'employeeId', emp.id, 'expiresOn', tr.expires_on);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown people action';
  END IF;

  INSERT INTO operations_people_events(tenant_id, action, entity_id, actor_id, idempotency_key, request_payload, result)
    VALUES (c.tenant_id, v_action, v_entity, c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_people_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_people_command(jsonb) TO orvex_runtime;

CREATE FUNCTION read_people_workspace(p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; today date; f date; t date; result jsonb;
BEGIN
  c := people_context_or_raise('tenant.people.workspace.read', ARRAY['tenant.user.administer', 'tenant.installation.view', 'tenant.report.view']);
  today := (clock_timestamp() AT TIME ZONE 'Asia/Beirut')::date;
  f := coalesce(p_from, today - ((extract(isodow FROM today)::integer - 1)));
  t := coalesce(p_to, f + 6);
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(), 'from', f, 'to', t,
    'teams', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tm.id, 'code', tm.code, 'nameEn', tm.name_en, 'nameAr', tm.name_ar, 'branchId', tm.branch_id, 'branchName', b.name_en,
        'leadEmployeeId', tm.lead_employee_id, 'leadName', le.display_name, 'active', tm.active, 'version', tm.version,
        'members', (SELECT count(*) FROM operations_employees e WHERE e.tenant_id = tm.tenant_id AND e.team_id = tm.id AND e.status <> 'left')) ORDER BY tm.code)
      FROM operations_teams tm LEFT JOIN operations_branches b ON b.tenant_id = tm.tenant_id AND b.id = tm.branch_id
      LEFT JOIN operations_employees le ON le.tenant_id = tm.tenant_id AND le.id = tm.lead_employee_id WHERE tm.tenant_id = c.tenant_id), '[]'::jsonb),
    'employees', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'employeeNumber', e.employee_number, 'userId', e.user_id, 'userName', u.display_name,
        'displayName', e.display_name, 'roleTitle', e.role_title, 'teamId', e.team_id, 'teamCode', tm.code, 'branchId', e.branch_id, 'branchName', b.name_en,
        'phone', e.phone, 'email', e.email, 'hiredOn', e.hired_on, 'status', e.status, 'skills', to_jsonb(e.skills), 'notes', e.notes, 'version', e.version,
        'onLeaveToday', EXISTS (SELECT 1 FROM operations_leave_requests l WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'approved' AND today BETWEEN l.starts_on AND l.ends_on),
        'onShiftNow', EXISTS (SELECT 1 FROM operations_shifts s WHERE s.tenant_id = e.tenant_id AND s.employee_id = e.id AND s.cancelled_at IS NULL AND clock_timestamp() BETWEEN s.starts_at AND s.ends_at),
        'technician', EXISTS (SELECT 1 FROM operations_field_technicians ft WHERE ft.tenant_id = e.tenant_id AND ft.user_id = e.user_id AND ft.active),
        'expiringTraining', (SELECT count(*) FROM operations_training_records r WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.expires_on IS NOT NULL AND r.expires_on <= today + 90)) ORDER BY e.status, e.display_name)
      FROM operations_employees e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN operations_teams tm ON tm.tenant_id = e.tenant_id AND tm.id = e.team_id
      LEFT JOIN operations_branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id WHERE e.tenant_id = c.tenant_id), '[]'::jsonb),
    'shifts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'employeeId', s.employee_id, 'employeeName', e.display_name, 'kind', s.kind, 'startsAt', s.starts_at, 'endsAt', s.ends_at,
        'locationNote', s.location_note, 'cancelledAt', s.cancelled_at, 'cancelReason', s.cancel_reason) ORDER BY s.starts_at, e.display_name)
      FROM operations_shifts s JOIN operations_employees e ON e.tenant_id = s.tenant_id AND e.id = s.employee_id
      WHERE s.tenant_id = c.tenant_id AND s.starts_at < (t + 1)::timestamp AT TIME ZONE 'Asia/Beirut' AND s.ends_at > f::timestamp AT TIME ZONE 'Asia/Beirut'), '[]'::jsonb),
    'leave', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'employeeId', l.employee_id, 'employeeName', e.display_name, 'kind', l.kind, 'startsOn', l.starts_on, 'endsOn', l.ends_on,
        'reason', l.reason, 'status', l.status, 'requestedBy', coalesce(rb.display_name, l.requested_by::text), 'requestedAt', l.requested_at, 'decidedBy', db.display_name,
        'decidedAt', l.decided_at, 'decisionNote', l.decision_note, 'version', l.version) ORDER BY CASE l.status WHEN 'requested' THEN 0 ELSE 1 END, l.starts_on DESC)
      FROM (SELECT * FROM operations_leave_requests WHERE tenant_id = c.tenant_id AND (status = 'requested' OR ends_on >= today - 60) ORDER BY starts_on DESC LIMIT 200) l
      JOIN operations_employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id LEFT JOIN users rb ON rb.id = l.requested_by LEFT JOIN users db ON db.id = l.decided_by), '[]'::jsonb),
    'training', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'employeeId', r.employee_id, 'employeeName', e.display_name, 'title', r.title, 'provider', r.provider, 'kind', r.kind,
        'completedOn', r.completed_on, 'expiresOn', r.expires_on, 'reference', r.reference, 'expired', r.expires_on IS NOT NULL AND r.expires_on < today,
        'expiringSoon', r.expires_on IS NOT NULL AND r.expires_on >= today AND r.expires_on <= today + 90) ORDER BY r.expires_on NULLS LAST, r.completed_on DESC)
      FROM (SELECT * FROM operations_training_records WHERE tenant_id = c.tenant_id ORDER BY created_at DESC LIMIT 300) r
      JOIN operations_employees e ON e.tenant_id = r.tenant_id AND e.id = r.employee_id), '[]'::jsonb),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', u.display_name, 'roleKey', m.role_key,
        'linked', EXISTS (SELECT 1 FROM operations_employees e WHERE e.tenant_id = m.tenant_id AND e.user_id = m.user_id)) ORDER BY u.display_name)
      FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = c.tenant_id AND m.active), '[]'::jsonb),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'nameEn', b.name_en, 'nameAr', b.name_ar) ORDER BY b.name_en)
      FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND operations_scope_allows(b.tenant_id, b.id)), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_people_workspace(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_people_workspace(date, date) TO orvex_runtime;

-- ---------------------------------------------------------------------------------------------
-- Outage rows are NOC-scoped; regulatory evidence, the dashboard and governed reports read them
-- under their own signed read actions. Writes stay with the NOC permissions.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION noc_scope_allows(target_tenant uuid,target_route uuid,target_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL
  AND (c.permission IN('tenant.network.view','tenant.network.job.create')
    OR (c.action IN('tenant.regulatory.workspace.read','tenant.regulatory.manage','tenant.dashboard.read','tenant.report.read')
      AND c.permission IN('tenant.report.view','tenant.report.export','tenant.user.administer','tenant.dashboard.view')))
  AND CASE WHEN target_route IS NULL THEN operations_scope_allows(target_tenant)
    ELSE operations_scope_allows_route(target_tenant,target_route,target_id) END)
$$;
