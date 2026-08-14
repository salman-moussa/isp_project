-- REQ-OPS-001..010, REQ-SEC-003, REQ-FIN-001: tenant operations core.
-- Forward-only migration. Subscriber records are internal ISP operations records; this migration
-- intentionally creates no subscriber identity, credential, session, login, or portal surface.
CREATE TYPE operations_subscriber_status AS ENUM ('lead', 'active', 'suspended', 'closed');
CREATE TYPE operations_service_status AS ENUM
  ('draft', 'pending_installation', 'active', 'suspended', 'terminated');
CREATE TYPE operations_installation_status AS ENUM
  ('requested', 'scheduled', 'in_progress', 'blocked', 'ready_for_activation', 'completed', 'cancelled');
CREATE TYPE operations_issue_status AS ENUM
  ('open', 'triaged', 'in_progress', 'waiting', 'resolved', 'closed');
CREATE TYPE operations_job_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');

CREATE TABLE operations_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  reference_code text NOT NULL,
  display_name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, reference_code),
  UNIQUE (tenant_id, id),
  CHECK (length(btrim(reference_code)) BETWEEN 1 AND 80),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 200)
);

CREATE TABLE operations_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  household_id uuid NOT NULL,
  label text NOT NULL,
  area_code text,
  address_line text NOT NULL,
  building text,
  floor text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, household_id) REFERENCES operations_households(tenant_id, id),
  CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  CHECK (length(btrim(address_line)) BETWEEN 1 AND 500),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE operations_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_number text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  household_id uuid NOT NULL,
  primary_location_id uuid,
  display_name text NOT NULL,
  status operations_subscriber_status NOT NULL DEFAULT 'lead',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (tenant_id, subscriber_number),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, household_id) REFERENCES operations_households(tenant_id, id),
  FOREIGN KEY (tenant_id, primary_location_id) REFERENCES operations_locations(tenant_id, id),
  CHECK (length(btrim(subscriber_number)) BETWEEN 1 AND 80),
  CHECK (length(btrim(idempotency_key)) >= 8),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX operations_subscribers_tenant_status_idx
  ON operations_subscribers(tenant_id, status, subscriber_number);

CREATE TABLE operations_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  contact_kind text NOT NULL CHECK (contact_kind IN ('phone', 'email', 'whatsapp', 'other')),
  contact_value text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  CHECK (length(btrim(contact_value)) BETWEEN 1 AND 320)
);
CREATE UNIQUE INDEX operations_contacts_one_primary_idx
  ON operations_contacts(tenant_id, subscriber_id, contact_kind)
  WHERE is_primary AND archived_at IS NULL;

CREATE TABLE operations_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  recurring_amount_minor bigint NOT NULL CHECK (recurring_amount_minor > 0),
  currency finance_currency NOT NULL,
  billing_interval_months integer NOT NULL DEFAULT 1 CHECK (billing_interval_months BETWEEN 1 AND 24),
  network_profile_reference text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  CHECK (length(btrim(code)) BETWEEN 1 AND 80),
  CHECK (length(btrim(name_en)) BETWEEN 1 AND 200),
  CHECK (length(btrim(name_ar)) BETWEEN 1 AND 200)
);

CREATE TABLE operations_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  location_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  service_number text NOT NULL,
  status operations_service_status NOT NULL DEFAULT 'draft',
  billing_anchor_day integer NOT NULL CHECK (billing_anchor_day BETWEEN 1 AND 28),
  activated_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES operations_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES operations_plans(tenant_id, id),
  CHECK (length(btrim(service_number)) BETWEEN 1 AND 80),
  CHECK ((status = 'terminated') = (terminated_at IS NOT NULL))
);
CREATE INDEX operations_services_tenant_subscriber_idx
  ON operations_services(tenant_id, subscriber_id, status);

CREATE TABLE operations_billing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  idempotency_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status operations_job_status NOT NULL DEFAULT 'pending',
  requested_by text NOT NULL,
  vat_rate_basis_points integer NOT NULL DEFAULT 0 CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_summary text,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8),
  CHECK (period_end > period_start)
);

-- Draft preparation only. Posting remains in immutable finance_invoices.
CREATE TABLE operations_invoice_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  billing_run_id uuid NOT NULL,
  service_id uuid NOT NULL,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor > 0),
  vat_rate_basis_points integer NOT NULL DEFAULT 0 CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  vat_minor bigint NOT NULL DEFAULT 0 CHECK (vat_minor >= 0),
  total_minor bigint GENERATED ALWAYS AS (subtotal_minor + vat_minor) STORED,
  currency finance_currency NOT NULL,
  posting_status text NOT NULL DEFAULT 'prepared' CHECK (posting_status IN ('prepared', 'posted', 'failed')),
  finance_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, billing_run_id, service_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, billing_run_id) REFERENCES operations_billing_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_invoice_id) REFERENCES finance_invoices(tenant_id, id)
);

-- Office intake is orchestration state; the posted cash entry remains finance_payments.
CREATE TABLE operations_office_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  receipt_number text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency finance_currency NOT NULL,
  finance_payment_id uuid,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_payment_id) REFERENCES finance_payments(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

-- Append-only correction chain. Corrections point to immutable allocation/reversal journal entries.
CREATE TABLE operations_office_payment_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_request_id uuid NOT NULL,
  previous_correction_id uuid,
  finance_allocation_id uuid NOT NULL,
  correction_kind text NOT NULL CHECK (correction_kind IN ('allocation', 'reversal', 'note')),
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_request_id) REFERENCES operations_office_payment_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, previous_correction_id) REFERENCES operations_office_payment_corrections(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_allocation_id) REFERENCES finance_payment_allocations(tenant_id, id),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_collector_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  collector_user_id uuid NOT NULL,
  subscriber_id uuid NOT NULL,
  route_reference text NOT NULL,
  due_on date NOT NULL,
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor > 0),
  currency finance_currency NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'visited', 'collected', 'returned', 'cancelled')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);
CREATE INDEX operations_collector_route_idx
  ON operations_collector_assignments(tenant_id, collector_user_id, due_on, currency);

CREATE TABLE operations_collector_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  collector_user_id uuid NOT NULL,
  business_date date NOT NULL,
  currency finance_currency NOT NULL,
  expected_minor bigint NOT NULL CHECK (expected_minor >= 0),
  declared_minor bigint NOT NULL CHECK (declared_minor >= 0),
  difference_minor bigint GENERATED ALWAYS AS (declared_minor - expected_minor) STORED,
  previous_reconciliation_id uuid,
  reason text,
  idempotency_key text NOT NULL,
  reconciled_by text NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, previous_reconciliation_id) REFERENCES operations_collector_reconciliations(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  status operations_installation_status NOT NULL DEFAULT 'requested',
  scheduled_for timestamptz,
  installer_user_id uuid,
  blocker_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  FOREIGN KEY (tenant_id, installer_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);

CREATE TABLE operations_installation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  installation_id uuid NOT NULL,
  from_status operations_installation_status,
  to_status operations_installation_status NOT NULL,
  note text,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, installation_id) REFERENCES operations_installations(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_support_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid,
  service_id uuid,
  issue_number text NOT NULL,
  idempotency_key text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status operations_issue_status NOT NULL DEFAULT 'open',
  assignee_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (tenant_id, issue_number),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (length(btrim(subject)) BETWEEN 1 AND 300),
  CHECK (length(btrim(idempotency_key)) >= 8),
  CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE operations_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  issue_id uuid NOT NULL,
  from_status operations_issue_status,
  to_status operations_issue_status NOT NULL,
  note text,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, issue_id) REFERENCES operations_support_issues(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  report_key text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  format text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  status operations_job_status NOT NULL DEFAULT 'pending',
  storage_reference text,
  expires_at timestamptz,
  idempotency_key text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, idempotency_key),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_configuration (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  config_key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, config_key),
  CHECK (config_key !~* '(secret|password|credential|token|private[_-]?key)')
);

CREATE FUNCTION operations_json_contains_secret_key(candidate jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT candidate::text ~* '"[^" ]*(secret|password|credential|token|private[_-]?key)[^" ]*"[[:space:]]*:'
$$;

ALTER TABLE operations_configuration ADD CONSTRAINT operations_configuration_no_secret_keys
  CHECK (NOT operations_json_contains_secret_key(value));

CREATE TABLE operations_network_action_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('activate', 'suspend', 'restore', 'terminate', 'change_profile')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE FUNCTION operations_guard_network_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tenant_status text;
BEGIN
  SELECT status INTO tenant_status FROM public.tenants WHERE id = NEW.tenant_id;
  IF tenant_status IN ('restricted', 'terminated', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4032',
      MESSAGE = 'Platform subscription state forbids subscriber network actions';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_network_action_subscription_guard
BEFORE INSERT ON operations_network_action_outbox
FOR EACH ROW EXECUTE FUNCTION operations_guard_network_action();

CREATE FUNCTION operations_reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P4092', MESSAGE = 'Operations evidence is append-only';
END;
$$;

CREATE TRIGGER operations_payment_corrections_append_only
BEFORE UPDATE OR DELETE ON operations_office_payment_corrections
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_reconciliations_append_only
BEFORE UPDATE OR DELETE ON operations_collector_reconciliations
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_installation_events_append_only
BEFORE UPDATE OR DELETE ON operations_installation_events
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_issue_events_append_only
BEFORE UPDATE OR DELETE ON operations_issue_events
FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_payment_corrections_no_truncate
BEFORE TRUNCATE ON operations_office_payment_corrections
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_reconciliations_no_truncate
BEFORE TRUNCATE ON operations_collector_reconciliations
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_installation_events_no_truncate
BEFORE TRUNCATE ON operations_installation_events
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_issue_events_no_truncate
BEFORE TRUNCATE ON operations_issue_events
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'operations_households', 'operations_locations', 'operations_subscribers',
    'operations_contacts', 'operations_plans', 'operations_services', 'operations_billing_runs',
    'operations_invoice_preparations', 'operations_office_payment_requests',
    'operations_office_payment_corrections', 'operations_collector_assignments',
    'operations_collector_reconciliations', 'operations_installations',
    'operations_installation_events', 'operations_support_issues', 'operations_issue_events',
    'operations_export_jobs', 'operations_configuration', 'operations_network_action_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  operations_households, operations_locations, operations_subscribers, operations_contacts,
  operations_plans, operations_services, operations_billing_runs, operations_invoice_preparations,
  operations_office_payment_requests, operations_collector_assignments, operations_installations,
  operations_support_issues, operations_export_jobs, operations_configuration
TO orvex_runtime;
-- Delivery acknowledgement belongs to the isolated Network Worker role added by deployment
-- integration; the API runtime cannot forge delivery or clear an error.
GRANT SELECT, INSERT ON TABLE operations_network_action_outbox TO orvex_runtime;
GRANT SELECT, INSERT ON TABLE
  operations_office_payment_corrections, operations_collector_reconciliations,
  operations_installation_events, operations_issue_events
TO orvex_runtime;
REVOKE ALL ON FUNCTION operations_guard_network_action() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations_guard_network_action() TO orvex_runtime;
REVOKE ALL ON FUNCTION operations_reject_append_only_mutation() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Hardened Operations authorization, policy versioning, workflow evidence,
-- and atomic audit plane. Migration 2200 is intentionally unapplied, so these
-- definitions supersede the provisional grants/policies above in one commit.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE operations_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE operations_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id)
);

CREATE TABLE operations_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  area_id uuid NOT NULL,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id)
);

ALTER TABLE operations_households
  ADD COLUMN branch_id uuid NOT NULL,
  ADD CONSTRAINT operations_households_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id);
ALTER TABLE operations_locations
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD CONSTRAINT operations_locations_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_locations_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_locations_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id);
ALTER TABLE operations_subscribers
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD CONSTRAINT operations_subscribers_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_subscribers_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_subscribers_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id);
ALTER TABLE operations_plans
  ADD COLUMN branch_id uuid,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD CONSTRAINT operations_plans_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_plans_idempotency_key UNIQUE (tenant_id, idempotency_key),
  ADD CONSTRAINT operations_plans_idempotency_length CHECK (length(btrim(idempotency_key)) >= 8);
ALTER TABLE operations_services
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD CONSTRAINT operations_services_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_services_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_services_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT operations_services_idempotency_key UNIQUE (tenant_id, idempotency_key),
  ADD CONSTRAINT operations_services_idempotency_length CHECK (length(btrim(idempotency_key)) >= 8),
  ADD CONSTRAINT operations_services_activation_state_check CHECK (
    (status IN ('active', 'suspended', 'terminated')) = (activated_at IS NOT NULL)
  );

CREATE TYPE operations_rounding_mode AS ENUM ('half_up', 'down', 'up');
CREATE TABLE operations_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  recurring_amount_minor bigint NOT NULL CHECK (recurring_amount_minor > 0),
  currency finance_currency NOT NULL,
  billing_interval_months integer NOT NULL CHECK (billing_interval_months BETWEEN 1 AND 24),
  effective_from date NOT NULL,
  effective_to date,
  created_by text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plan_id, version),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES operations_plans(tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE operations_billing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  version integer NOT NULL CHECK (version > 0),
  vat_rate_basis_points integer NOT NULL CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  rounding_mode operations_rounding_mode NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_by text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, version),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

ALTER TABLE operations_billing_runs
  DROP COLUMN vat_rate_basis_points,
  ADD COLUMN scope_branch_ids uuid[],
  ADD COLUMN scope_area_ids uuid[],
  ADD COLUMN scope_route_ids uuid[];
ALTER TABLE operations_billing_runs
  ADD CONSTRAINT operations_billing_runs_max_period_check
    CHECK (period_end <= period_start + 31);
ALTER TABLE operations_invoice_preparations
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN billing_date date NOT NULL,
  ADD COLUMN period_start date NOT NULL,
  ADD COLUMN period_end date NOT NULL,
  ADD COLUMN plan_version_id uuid NOT NULL,
  ADD COLUMN billing_policy_id uuid NOT NULL,
  ADD CONSTRAINT operations_invoice_preparations_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_invoice_preparations_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_invoice_preparations_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT operations_invoice_preparations_plan_version_fk
    FOREIGN KEY (tenant_id, plan_version_id) REFERENCES operations_plan_versions(tenant_id, id),
  ADD CONSTRAINT operations_invoice_preparations_policy_fk
    FOREIGN KEY (tenant_id, billing_policy_id) REFERENCES operations_billing_policies(tenant_id, id),
  ADD CONSTRAINT operations_invoice_preparations_period_check CHECK (period_end > period_start),
  ADD CONSTRAINT operations_invoice_preparations_service_period_key
    UNIQUE (tenant_id, service_id, period_start, period_end);

ALTER TABLE operations_office_payment_requests
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD CONSTRAINT operations_payment_requests_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_payment_requests_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_payment_requests_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id);
ALTER TABLE operations_office_payment_corrections
  ALTER COLUMN finance_allocation_id DROP NOT NULL,
  ADD COLUMN amount_minor bigint,
  ADD COLUMN currency finance_currency,
  ADD CONSTRAINT operations_payment_correction_shape_check CHECK (
    (correction_kind = 'note' AND finance_allocation_id IS NULL
      AND amount_minor IS NULL AND currency IS NULL)
    OR
    (correction_kind IN ('allocation', 'reversal') AND finance_allocation_id IS NOT NULL
      AND amount_minor > 0 AND currency IS NOT NULL)
  );
CREATE UNIQUE INDEX operations_payment_correction_child_key
  ON operations_office_payment_corrections(tenant_id, previous_correction_id)
  WHERE previous_correction_id IS NOT NULL;
CREATE UNIQUE INDEX operations_payment_correction_finance_entry_key
  ON operations_office_payment_corrections(tenant_id, finance_allocation_id)
  WHERE finance_allocation_id IS NOT NULL;

ALTER TABLE operations_collector_assignments
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN finance_invoice_id uuid NOT NULL,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD CONSTRAINT operations_assignment_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT operations_assignment_invoice_fk
    FOREIGN KEY (tenant_id, finance_invoice_id) REFERENCES finance_invoices(tenant_id, id),
  ADD CONSTRAINT operations_assignment_invoice_key UNIQUE (tenant_id, finance_invoice_id),
  ADD CONSTRAINT operations_assignment_idempotency_key UNIQUE (tenant_id, idempotency_key),
  ADD CONSTRAINT operations_assignment_idempotency_length CHECK (length(btrim(idempotency_key)) >= 8);

CREATE TABLE operations_collector_collection_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assignment_id uuid NOT NULL,
  finance_payment_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency finance_currency NOT NULL,
  recorded_by text NOT NULL,
  idempotency_key text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, assignment_id),
  UNIQUE (tenant_id, finance_payment_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES operations_collector_assignments(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_payment_id) REFERENCES finance_payments(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

ALTER TABLE operations_collector_reconciliations
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN approved_by text,
  ADD CONSTRAINT operations_reconciliation_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT operations_reconciliation_difference_evidence_check CHECK (
    difference_minor = 0 AND approved_by IS NULL
  );
CREATE UNIQUE INDEX operations_reconciliation_child_key
  ON operations_collector_reconciliations(tenant_id, previous_reconciliation_id)
  WHERE previous_reconciliation_id IS NOT NULL;

ALTER TABLE operations_installations
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD CONSTRAINT operations_installations_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_installations_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_installations_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT operations_installations_service_key UNIQUE (tenant_id, service_id),
  ADD CONSTRAINT operations_installations_idempotency_key UNIQUE (tenant_id, idempotency_key),
  ADD CONSTRAINT operations_installations_idempotency_length CHECK (length(btrim(idempotency_key)) >= 8);
ALTER TABLE operations_installation_events
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN expected_version integer NOT NULL CHECK (expected_version > 0);
ALTER TABLE operations_support_issues
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT operations_issues_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_issues_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_issues_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id);
ALTER TABLE operations_issue_events
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN expected_version integer NOT NULL CHECK (expected_version > 0);
ALTER TABLE operations_export_jobs
  ADD COLUMN scope_branch_ids uuid[],
  ADD COLUMN scope_area_ids uuid[],
  ADD COLUMN scope_route_ids uuid[],
  ADD COLUMN scope_record_ids uuid[];
ALTER TABLE operations_configuration
  ADD COLUMN branch_id uuid,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD COLUMN request_fingerprint text NOT NULL,
  ADD CONSTRAINT operations_configuration_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_configuration_idempotency_key UNIQUE (tenant_id, idempotency_key),
  ADD CONSTRAINT operations_configuration_idempotency_length CHECK (length(btrim(idempotency_key)) >= 8);
CREATE TABLE operations_configuration_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  config_key text NOT NULL,
  branch_id uuid,
  version integer NOT NULL CHECK (version > 0),
  before_value jsonb,
  after_value jsonb NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  actor_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, config_key, version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, config_key) REFERENCES operations_configuration(tenant_id, config_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK (length(btrim(idempotency_key)) >= 8)
);
ALTER TABLE operations_network_action_outbox
  ADD COLUMN branch_id uuid NOT NULL,
  ADD COLUMN area_id uuid NOT NULL,
  ADD COLUMN route_id uuid NOT NULL,
  ADD CONSTRAINT operations_network_outbox_branch_fk
    FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT operations_network_outbox_area_fk
    FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  ADD CONSTRAINT operations_network_outbox_route_fk
    FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id);

-- The HMAC key is installed out of band by the operations context owner. The runtime can execute
-- the verifier but cannot read or mutate key/context rows, so arbitrary custom GUCs grant nothing.
CREATE TABLE operations_context_keys (
  key_id text PRIMARY KEY,
  secret bytea NOT NULL CHECK (octet_length(secret) >= 32),
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE TABLE operations_request_contexts (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  support_grant_id text,
  permission text NOT NULL,
  action text NOT NULL,
  request_id text NOT NULL,
  ip_address text NOT NULL,
  user_agent text,
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  branch_ids uuid[],
  area_ids uuid[],
  route_ids uuid[],
  record_ids uuid[],
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (backend_pid, transaction_id)
);

CREATE FUNCTION begin_operations_request_context(attestation_text text, signature_hex text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  attestation jsonb;
  context_key operations_context_keys%ROWTYPE;
  expires_at_value timestamptz;
BEGIN
  attestation := attestation_text::jsonb;
  SELECT * INTO context_key
  FROM operations_context_keys
  WHERE key_id = attestation->>'keyId'
    AND active_from <= clock_timestamp()
    AND (active_until IS NULL OR active_until > clock_timestamp());
  IF NOT FOUND OR signature_hex IS NULL OR
     encode(hmac(convert_to(attestation_text, 'UTF8'), context_key.secret, 'sha256'), 'hex')
       <> lower(signature_hex) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'invalid operations context attestation';
  END IF;
  expires_at_value := (attestation->>'expiresAt')::timestamptz;
  IF expires_at_value <= clock_timestamp()
     OR expires_at_value > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'expired operations context attestation';
  END IF;
  IF nullif(attestation->>'tenantId', '') IS NULL
     OR nullif(attestation->>'actorId', '') IS NULL
     OR nullif(attestation->>'sessionId', '') IS NULL
     OR nullif(attestation->>'permission', '') IS NULL
     OR nullif(attestation->>'action', '') IS NULL
     OR nullif(attestation->>'requestId', '') IS NULL
     OR nullif(attestation->>'ipAddress', '') IS NULL
     OR nullif(attestation->>'reason', '') IS NULL
     OR length(btrim(coalesce(attestation->>'idempotencyKey', ''))) < 8 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'incomplete operations context attestation';
  END IF;

  DELETE FROM operations_request_contexts
  WHERE backend_pid = pg_backend_pid() AND transaction_id = txid_current();
  INSERT INTO operations_request_contexts (
    backend_pid, transaction_id, tenant_id, actor_id, session_id, support_grant_id,
    permission, action, request_id, ip_address, user_agent, reason, idempotency_key,
    branch_ids, area_ids, route_ids, record_ids, expires_at
  ) VALUES (
    pg_backend_pid(), txid_current(), (attestation->>'tenantId')::uuid,
    attestation->>'actorId', attestation->>'sessionId', nullif(attestation->>'supportGrantId', ''),
    attestation->>'permission', attestation->>'action', attestation->>'requestId',
    attestation->>'ipAddress', nullif(attestation->>'userAgent', ''), attestation->>'reason',
    attestation->>'idempotencyKey',
    CASE WHEN attestation ? 'branchIds' THEN ARRAY(SELECT jsonb_array_elements_text(attestation->'branchIds')::uuid) END,
    CASE WHEN attestation ? 'areaIds' THEN ARRAY(SELECT jsonb_array_elements_text(attestation->'areaIds')::uuid) END,
    CASE WHEN attestation ? 'routeIds' THEN ARRAY(SELECT jsonb_array_elements_text(attestation->'routeIds')::uuid) END,
    CASE WHEN attestation ? 'recordIds' THEN ARRAY(SELECT jsonb_array_elements_text(attestation->'recordIds')::uuid) END,
    expires_at_value
  );
END;
$$;

CREATE FUNCTION operations_current_context() RETURNS operations_request_contexts
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT c.* FROM operations_request_contexts c
  WHERE c.backend_pid = pg_backend_pid()
    AND c.transaction_id = txid_current()
    AND c.expires_at > statement_timestamp()
$$;

CREATE FUNCTION operations_scope_allows(
  target_tenant_id uuid,
  target_branch_id uuid DEFAULT NULL,
  target_area_id uuid DEFAULT NULL,
  target_route_id uuid DEFAULT NULL,
  target_record_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_current_context() c
    WHERE c.tenant_id = target_tenant_id
      AND (c.branch_ids IS NULL OR (target_branch_id IS NOT NULL AND target_branch_id = ANY(c.branch_ids)))
      AND (c.area_ids IS NULL OR (target_area_id IS NOT NULL AND target_area_id = ANY(c.area_ids)))
      AND (c.route_ids IS NULL OR (target_route_id IS NOT NULL AND target_route_id = ANY(c.route_ids)))
      AND (c.record_ids IS NULL OR (target_record_id IS NOT NULL AND target_record_id = ANY(c.record_ids)))
  )
$$;

CREATE FUNCTION operations_scope_allows_subscriber(target_tenant_id uuid, subscriber_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_subscribers s
    WHERE s.tenant_id = target_tenant_id AND s.id = subscriber_id
      AND operations_scope_allows(s.tenant_id, s.branch_id, s.area_id, s.route_id, s.id)
  )
$$;

CREATE FUNCTION operations_scope_allows_payment_request(target_tenant_id uuid, request_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_office_payment_requests p
    WHERE p.tenant_id = target_tenant_id AND p.id = request_id
      AND operations_scope_allows(p.tenant_id, p.branch_id, p.area_id, p.route_id, p.id)
  )
$$;

CREATE FUNCTION operations_scope_allows_route(target_tenant_id uuid, target_route_id uuid, record_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_routes r
    WHERE r.tenant_id = target_tenant_id AND r.id = target_route_id
      AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, record_id)
  )
$$;

CREATE FUNCTION operations_scope_allows_installation(target_tenant_id uuid, installation_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_installations i
    WHERE i.tenant_id = target_tenant_id AND i.id = installation_id
      AND operations_scope_allows(i.tenant_id, i.branch_id, i.area_id, i.route_id, i.id)
  )
$$;

CREATE FUNCTION operations_scope_allows_issue(target_tenant_id uuid, issue_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_support_issues i
    WHERE i.tenant_id = target_tenant_id AND i.id = issue_id
      AND operations_scope_allows(i.tenant_id, i.branch_id, i.area_id, i.route_id, i.id)
  )
$$;

CREATE FUNCTION operations_scope_allows_arrays(
  target_tenant_id uuid,
  target_branch_ids uuid[],
  target_area_ids uuid[],
  target_route_ids uuid[],
  target_record_ids uuid[] DEFAULT NULL
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_current_context() c
    WHERE c.tenant_id = target_tenant_id
      AND (c.branch_ids IS NULL OR (target_branch_ids IS NOT NULL AND target_branch_ids <@ c.branch_ids))
      AND (c.area_ids IS NULL OR (target_area_ids IS NOT NULL AND target_area_ids <@ c.area_ids))
      AND (c.route_ids IS NULL OR (target_route_ids IS NOT NULL AND target_route_ids <@ c.route_ids))
      AND (c.record_ids IS NULL OR (target_record_ids IS NOT NULL AND target_record_ids <@ c.record_ids))
  )
$$;

CREATE TABLE operations_audit_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  support_grant_id text,
  permission text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  ip_address text NOT NULL,
  user_agent text,
  result text NOT NULL CHECK (result = 'allowed'),
  reason text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  CHECK (length(btrim(idempotency_key)) >= 8)
);
CREATE INDEX operations_audit_outbox_pending_idx
  ON operations_audit_outbox(tenant_id, occurred_at, event_id) WHERE delivered_at IS NULL;

CREATE FUNCTION list_operations_audit_relay_tenants() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT tenant_id FROM operations_audit_outbox
  WHERE delivered_at IS NULL ORDER BY tenant_id
$$;

CREATE FUNCTION read_operations_audit_outbox(target_tenant_id uuid, batch_size integer)
RETURNS SETOF operations_audit_outbox
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT * FROM operations_audit_outbox
  WHERE tenant_id = target_tenant_id AND delivered_at IS NULL
  ORDER BY occurred_at, event_id
  LIMIT greatest(1, least(coalesce(batch_size, 100), 500))
$$;

CREATE FUNCTION read_operations_audit_backlog(target_tenant_id uuid)
RETURNS TABLE(pending_count bigint, oldest_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT count(*), min(occurred_at)
  FROM operations_audit_outbox
  WHERE tenant_id = target_tenant_id AND delivered_at IS NULL
$$;

CREATE FUNCTION mark_operations_audit_outbox_delivered(target_event_id uuid, delivered_time timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE updated_count integer;
BEGIN
  IF delivered_time IS NULL THEN RAISE EXCEPTION 'delivery time is required'; END IF;
  UPDATE operations_audit_outbox SET delivered_at = delivered_time
  WHERE event_id = target_event_id AND delivered_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE FUNCTION append_operations_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  context_row operations_request_contexts%ROWTYPE;
  row_value jsonb;
  row_tenant_id uuid;
  row_id text;
  base_action text;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed operations request context is required';
  END IF;
  row_value := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_tenant_id := (row_value->>'tenant_id')::uuid;
  row_id := coalesce(row_value->>'id', row_value->>'event_id', row_value->>'config_key');
  IF row_tenant_id <> context_row.tenant_id OR row_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'operations audit context does not match mutation';
  END IF;
  base_action := regexp_replace(context_row.action, '^support\.', '');
  IF NOT (
    (TG_TABLE_NAME IN ('operations_branches', 'operations_areas', 'operations_routes',
      'operations_configuration', 'operations_configuration_changes')
      AND base_action = 'tenant.operations.configure' AND context_row.permission = 'tenant.user.administer')
    OR (TG_TABLE_NAME IN ('operations_households', 'operations_locations',
      'operations_subscribers', 'operations_contacts')
      AND base_action = 'tenant.subscriber.create' AND context_row.permission = 'tenant.subscriber.create')
    OR (TG_TABLE_NAME IN ('operations_plans', 'operations_plan_versions')
      AND base_action = 'tenant.plan.version.create' AND context_row.permission = 'tenant.invoice.create')
    OR (TG_TABLE_NAME = 'operations_billing_policies'
      AND base_action = 'tenant.billing.policy.version.create' AND context_row.permission = 'tenant.invoice.create')
    OR (TG_TABLE_NAME IN ('operations_services', 'operations_installations')
      AND base_action IN ('tenant.service.installation.create', 'tenant.installation.transition')
      AND context_row.permission = 'tenant.installation.manage')
    OR (TG_TABLE_NAME IN ('operations_billing_runs', 'operations_invoice_preparations')
      AND base_action = 'tenant.billing.prepare' AND context_row.permission = 'tenant.invoice.create')
    OR (TG_TABLE_NAME = 'operations_office_payment_requests'
      AND base_action = 'tenant.payment.office.record' AND context_row.permission = 'tenant.payment.post')
    OR (TG_TABLE_NAME = 'operations_office_payment_corrections'
      AND base_action = 'tenant.payment.correct' AND context_row.permission = 'tenant.payment.reverse')
    OR (TG_TABLE_NAME = 'operations_collector_assignments'
      AND base_action = 'tenant.collection.assign' AND context_row.permission = 'tenant.collection.reconcile')
    OR (TG_TABLE_NAME = 'operations_collector_collection_evidence'
      AND base_action = 'tenant.collection.evidence.record' AND context_row.permission = 'tenant.payment.post')
    OR (TG_TABLE_NAME = 'operations_collector_reconciliations'
      AND base_action = 'tenant.collection.reconcile' AND context_row.permission = 'tenant.collection.reconcile')
    OR (TG_TABLE_NAME = 'operations_installation_events'
      AND base_action = 'tenant.installation.transition' AND context_row.permission = 'tenant.installation.manage')
    OR (TG_TABLE_NAME = 'operations_support_issues'
      AND base_action IN ('tenant.issue.create', 'tenant.issue.transition')
      AND context_row.permission = 'tenant.subscriber.edit')
    OR (TG_TABLE_NAME = 'operations_issue_events'
      AND base_action = 'tenant.issue.transition' AND context_row.permission = 'tenant.subscriber.edit')
    OR (TG_TABLE_NAME = 'operations_export_jobs'
      AND base_action = 'tenant.report.export' AND context_row.permission = 'tenant.report.export')
    OR (TG_TABLE_NAME = 'operations_network_action_outbox'
      AND base_action = 'tenant.network.job.create' AND context_row.permission = 'tenant.network.job.create')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed action and permission do not authorize this operations mutation';
  END IF;
  INSERT INTO operations_audit_outbox (
    tenant_id, action, resource_type, resource_id, actor_id, session_id,
    support_grant_id, permission, request_id, idempotency_key, ip_address, user_agent,
    result, reason, before_value, after_value
  ) VALUES (
    row_tenant_id, context_row.action, TG_TABLE_NAME, row_id, context_row.actor_id,
    context_row.session_id, context_row.support_grant_id, context_row.permission,
    context_row.request_id, context_row.idempotency_key, context_row.ip_address,
    context_row.user_agent, 'allowed', context_row.reason,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION protect_operations_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'operations_audit_outbox' AND TG_OP = 'UPDATE'
     AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL
     AND ROW(NEW.event_id, NEW.tenant_id, NEW.action, NEW.resource_type, NEW.resource_id,
             NEW.actor_id, NEW.session_id, NEW.support_grant_id, NEW.permission,
             NEW.request_id, NEW.idempotency_key, NEW.ip_address, NEW.user_agent,
             NEW.result, NEW.reason, NEW.before_value, NEW.after_value, NEW.occurred_at)
         IS NOT DISTINCT FROM
         ROW(OLD.event_id, OLD.tenant_id, OLD.action, OLD.resource_type, OLD.resource_id,
             OLD.actor_id, OLD.session_id, OLD.support_grant_id, OLD.permission,
             OLD.request_id, OLD.idempotency_key, OLD.ip_address, OLD.user_agent,
             OLD.result, OLD.reason, OLD.before_value, OLD.after_value, OLD.occurred_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P4092', MESSAGE = 'operations evidence is immutable';
END;
$$;

CREATE TRIGGER operations_audit_outbox_immutable
BEFORE UPDATE OR DELETE ON operations_audit_outbox
FOR EACH ROW EXECUTE FUNCTION protect_operations_evidence();
CREATE TRIGGER operations_audit_outbox_no_truncate
BEFORE TRUNCATE ON operations_audit_outbox
FOR EACH STATEMENT EXECUTE FUNCTION protect_operations_evidence();
CREATE TRIGGER operations_configuration_changes_immutable
BEFORE UPDATE OR DELETE ON operations_configuration_changes
FOR EACH ROW EXECUTE FUNCTION protect_operations_evidence();
CREATE TRIGGER operations_configuration_changes_no_truncate
BEFORE TRUNCATE ON operations_configuration_changes
FOR EACH STATEMENT EXECUTE FUNCTION protect_operations_evidence();

-- Fail closed on an immutable commercial-state history. A platform-state change only appends
-- evidence; it never creates subscriber network work.
CREATE TABLE operations_platform_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  status text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, revision),
  UNIQUE (tenant_id, recorded_at, id)
);

CREATE FUNCTION record_operations_platform_subscription_state(
  event_id uuid, target_tenant_id uuid, target_status text, target_revision bigint,
  source_occurred_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_revision bigint;
BEGIN
  IF target_status NOT IN ('trial','active','grace','restricted','terminated','archived')
     OR target_revision <= 0 OR source_occurred_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='invalid platform subscription state envelope';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant_id::text, 2200));
  IF EXISTS (SELECT 1 FROM operations_platform_subscription_events WHERE source_event_id=event_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_platform_subscription_events
      WHERE source_event_id=event_id AND tenant_id=target_tenant_id
        AND status=target_status AND revision=target_revision
        AND recorded_at=source_occurred_at AND source='control-center-relay'
    ) THEN
      RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='platform subscription event identity conflicts with existing evidence';
    END IF;
    RETURN false;
  END IF;
  SELECT max(revision) INTO current_revision FROM operations_platform_subscription_events
  WHERE tenant_id=target_tenant_id;
  IF current_revision IS NOT NULL AND target_revision <= current_revision THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='platform subscription state revision is stale';
  END IF;
  INSERT INTO operations_platform_subscription_events(
    source_event_id,tenant_id,status,revision,source,recorded_at
  ) VALUES(event_id,target_tenant_id,target_status,target_revision,'control-center-relay',source_occurred_at);
  RETURN true;
END;
$$;
CREATE TRIGGER operations_platform_subscription_events_immutable
BEFORE UPDATE OR DELETE ON operations_platform_subscription_events
FOR EACH ROW EXECUTE FUNCTION protect_operations_evidence();
CREATE TRIGGER operations_platform_subscription_events_no_truncate
BEFORE TRUNCATE ON operations_platform_subscription_events
FOR EACH STATEMENT EXECUTE FUNCTION protect_operations_evidence();

CREATE FUNCTION operations_readiness()
RETURNS TABLE (
  context_key_ready boolean,
  subscription_state_ready boolean,
  pending_audit_count bigint,
  oldest_pending_audit_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT
    EXISTS (SELECT 1 FROM operations_context_keys
      WHERE active_from <= statement_timestamp()
        AND (active_until IS NULL OR active_until > statement_timestamp())),
    NOT EXISTS (SELECT 1 FROM tenants t WHERE NOT EXISTS (
      SELECT 1 FROM operations_platform_subscription_events e WHERE e.tenant_id = t.id
    )),
    count(*) FILTER (WHERE delivered_at IS NULL),
    min(occurred_at) FILTER (WHERE delivered_at IS NULL)
  FROM operations_audit_outbox
$$;

CREATE OR REPLACE FUNCTION operations_guard_network_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  tenant_status text;
  service_status operations_service_status;
  installation_status operations_installation_status;
BEGIN
  SELECT status INTO tenant_status
  FROM operations_platform_subscription_events
  WHERE tenant_id = NEW.tenant_id
  ORDER BY recorded_at DESC, id DESC
  LIMIT 1
  FOR SHARE;
  IF tenant_status IS NULL OR tenant_status NOT IN ('trial', 'active') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4032',
      MESSAGE = 'Platform subscription state forbids subscriber network actions';
  END IF;
  IF NOT operations_scope_allows(
    NEW.tenant_id, NEW.branch_id, NEW.area_id, NEW.route_id, NEW.service_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'network action is outside authorized scope';
  END IF;
  SELECT service.status INTO service_status
  FROM operations_services service
  WHERE service.tenant_id=NEW.tenant_id AND service.id=NEW.service_id
  FOR SHARE;
  SELECT installation.status INTO installation_status
  FROM operations_installations installation
  WHERE installation.tenant_id=NEW.tenant_id AND installation.service_id=NEW.service_id
  ORDER BY installation.created_at DESC LIMIT 1 FOR SHARE;
  IF service_status IS NULL OR
     (NEW.action IN ('activate','restore','change_profile') AND
       (service_status <> 'active' OR installation_status <> 'completed')) OR
     (NEW.action IN ('suspend','terminate') AND service_status <> 'active') THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='network action is incompatible with service lifecycle';
  END IF;
  IF NEW.payload::text ~* '"[^" ]*(secret|password|credential|token|private[_-]?key)[^" ]*"[[:space:]]*:' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'network payload contains forbidden secret material';
  END IF;
  IF (NEW.action IN ('activate', 'restore') AND NEW.payload <> '{}'::jsonb)
     OR (NEW.action = 'change_profile' AND NOT (
       jsonb_typeof(NEW.payload->'profileReference') = 'string'
       AND NEW.payload - 'profileReference' = '{}'::jsonb
     ))
     OR (NEW.action IN ('suspend', 'terminate') AND NOT (
       jsonb_typeof(NEW.payload->'reasonCode') = 'string'
       AND NEW.payload - 'reasonCode' = '{}'::jsonb
     )) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'network payload does not match action schema';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_operations_scope_links() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE area_branch uuid; route_branch uuid; route_area uuid;
BEGIN
  IF NEW.area_id IS NOT NULL THEN
    SELECT branch_id INTO area_branch FROM operations_areas
    WHERE tenant_id = NEW.tenant_id AND id = NEW.area_id;
    IF area_branch IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'area is not in the selected branch';
    END IF;
  END IF;
  IF NEW.route_id IS NOT NULL THEN
    SELECT branch_id, area_id INTO route_branch, route_area FROM operations_routes
    WHERE tenant_id = NEW.tenant_id AND id = NEW.route_id;
    IF route_branch IS DISTINCT FROM NEW.branch_id OR route_area IS DISTINCT FROM NEW.area_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'route is not in the selected branch and area';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'operations_locations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_households household
      WHERE household.tenant_id = NEW.tenant_id AND household.id = NEW.household_id
        AND household.branch_id = NEW.branch_id
    ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'location scope does not match household';
    END IF;
  ELSIF TG_TABLE_NAME = 'operations_subscribers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_households household
      JOIN operations_locations location
        ON location.tenant_id = household.tenant_id AND location.household_id = household.id
      WHERE household.tenant_id = NEW.tenant_id AND household.id = NEW.household_id
        AND location.id = NEW.primary_location_id AND household.branch_id = NEW.branch_id
        AND location.branch_id = NEW.branch_id AND location.area_id = NEW.area_id
        AND location.route_id = NEW.route_id
    ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'subscriber scope does not match household and location';
    END IF;
  ELSIF TG_TABLE_NAME = 'operations_services' THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_subscribers subscriber
      JOIN operations_locations location
        ON location.tenant_id = subscriber.tenant_id AND location.household_id = subscriber.household_id
      JOIN operations_plans plan
        ON plan.tenant_id = subscriber.tenant_id AND plan.id = NEW.plan_id
      WHERE subscriber.tenant_id = NEW.tenant_id AND subscriber.id = NEW.subscriber_id
        AND location.id = NEW.location_id AND subscriber.branch_id = NEW.branch_id
        AND subscriber.area_id = NEW.area_id AND subscriber.route_id = NEW.route_id
        AND location.branch_id = NEW.branch_id AND location.area_id = NEW.area_id
        AND location.route_id = NEW.route_id
        AND (plan.branch_id IS NULL OR plan.branch_id = NEW.branch_id)
    ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'service scope does not match subscriber, location, and plan';
    END IF;
  ELSIF TG_TABLE_NAME = 'operations_installations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_services service
      WHERE service.tenant_id = NEW.tenant_id AND service.id = NEW.service_id
        AND service.branch_id = NEW.branch_id AND service.area_id = NEW.area_id
        AND service.route_id = NEW.route_id
    ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'installation scope does not match service';
    END IF;
  ELSIF TG_TABLE_NAME = 'operations_network_action_outbox' THEN
    IF NOT EXISTS (
      SELECT 1 FROM operations_services service
      WHERE service.tenant_id = NEW.tenant_id AND service.id = NEW.service_id
        AND service.branch_id = NEW.branch_id AND service.area_id = NEW.area_id
        AND service.route_id = NEW.route_id
    ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'network action scope does not match service';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_support_issue_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE subscriber_scope operations_subscribers%ROWTYPE; service_scope operations_services%ROWTYPE;
BEGIN
  IF NEW.service_id IS NOT NULL THEN
    SELECT * INTO service_scope FROM operations_services
    WHERE tenant_id = NEW.tenant_id AND id = NEW.service_id;
    IF NOT FOUND OR (NEW.subscriber_id IS NOT NULL AND NEW.subscriber_id <> service_scope.subscriber_id)
       OR NEW.branch_id <> service_scope.branch_id OR NEW.area_id <> service_scope.area_id
       OR NEW.route_id <> service_scope.route_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'support issue scope does not match service';
    END IF;
  ELSE
    SELECT * INTO subscriber_scope FROM operations_subscribers
    WHERE tenant_id = NEW.tenant_id AND id = NEW.subscriber_id;
    IF NOT FOUND OR NEW.branch_id <> subscriber_scope.branch_id
       OR NEW.area_id <> subscriber_scope.area_id OR NEW.route_id <> subscriber_scope.route_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'support issue scope does not match subscriber';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_support_issue_scope_guard
BEFORE INSERT OR UPDATE ON operations_support_issues
FOR EACH ROW EXECUTE FUNCTION validate_support_issue_scope();

CREATE FUNCTION validate_operations_route_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM operations_areas area
    WHERE area.tenant_id = NEW.tenant_id AND area.id = NEW.area_id
      AND area.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'route area does not belong to branch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_route_scope_guard
BEFORE INSERT OR UPDATE ON operations_routes
FOR EACH ROW EXECUTE FUNCTION validate_operations_route_scope();

CREATE FUNCTION validate_billing_run_period() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':billing', 0));
  IF EXISTS (
    SELECT 1 FROM operations_billing_runs r
    WHERE r.tenant_id = NEW.tenant_id
      AND r.status NOT IN ('failed', 'cancelled')
      AND daterange(r.period_start, r.period_end, '[)') && daterange(NEW.period_start, NEW.period_end, '[)')
      AND r.id <> NEW.id
      AND r.idempotency_key <> NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'billing period overlaps an existing run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_billing_run_period_guard
BEFORE INSERT OR UPDATE ON operations_billing_runs
FOR EACH ROW EXECUTE FUNCTION validate_billing_run_period();

CREATE FUNCTION validate_effective_operations_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE overlap_found boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || TG_TABLE_NAME || ':' ||
    coalesce(to_jsonb(NEW)->>'plan_id', to_jsonb(NEW)->>'branch_id', 'tenant'), 0
  ));
  IF TG_TABLE_NAME = 'operations_plan_versions' THEN
    SELECT EXISTS (
      SELECT 1 FROM operations_plan_versions v
      WHERE v.tenant_id = NEW.tenant_id AND v.plan_id = NEW.plan_id AND v.id <> NEW.id
        AND v.idempotency_key <> NEW.idempotency_key
        AND daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[)')
          && daterange(NEW.effective_from, coalesce(NEW.effective_to, 'infinity'::date), '[)')
    ) INTO overlap_found;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM operations_billing_policies p
      WHERE p.tenant_id = NEW.tenant_id AND p.branch_id IS NOT DISTINCT FROM NEW.branch_id
        AND p.id <> NEW.id
        AND p.idempotency_key <> NEW.idempotency_key
        AND daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[)')
          && daterange(NEW.effective_from, coalesce(NEW.effective_to, 'infinity'::date), '[)')
    ) INTO overlap_found;
  END IF;
  IF overlap_found THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'effective operations versions cannot overlap';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_plan_versions_effective_guard
BEFORE INSERT OR UPDATE ON operations_plan_versions
FOR EACH ROW EXECUTE FUNCTION validate_effective_operations_version();
CREATE TRIGGER operations_billing_policies_effective_guard
BEFORE INSERT OR UPDATE ON operations_billing_policies
FOR EACH ROW EXECUTE FUNCTION validate_effective_operations_version();

CREATE FUNCTION validate_office_payment_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE payment_row finance_payments%ROWTYPE; subscriber_row operations_subscribers%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM finance_payments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.finance_payment_id FOR SHARE;
  SELECT * INTO subscriber_row FROM operations_subscribers
  WHERE tenant_id = NEW.tenant_id AND id = NEW.subscriber_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'office payment subscriber is missing';
  END IF;
  IF payment_row.id IS NULL OR payment_row.entry_kind <> 'posted'
     OR payment_row.receipt_number <> NEW.receipt_number
     OR payment_row.amount_minor <> NEW.amount_minor
     OR payment_row.currency <> NEW.currency THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'office payment must match posted finance evidence';
  END IF;
  IF NEW.branch_id <> subscriber_row.branch_id OR NEW.area_id <> subscriber_row.area_id
     OR NEW.route_id <> subscriber_row.route_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'office payment scope must match subscriber';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_office_payment_request_guard
BEFORE INSERT ON operations_office_payment_requests
FOR EACH ROW EXECUTE FUNCTION validate_office_payment_request();

CREATE FUNCTION validate_payment_correction_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  request_row operations_office_payment_requests%ROWTYPE;
  allocation_row finance_payment_allocations%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM operations_office_payment_corrections
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key
  ) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.payment_request_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM operations_office_payment_corrections
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key
  ) THEN RETURN NULL; END IF;
  SELECT * INTO request_row FROM operations_office_payment_requests
  WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'payment request is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM operations_office_payment_corrections c
    WHERE c.tenant_id = NEW.tenant_id AND c.payment_request_id = NEW.payment_request_id
      AND NOT EXISTS (
        SELECT 1 FROM operations_office_payment_corrections child
        WHERE child.tenant_id = c.tenant_id AND child.previous_correction_id = c.id
      )
      AND c.id IS DISTINCT FROM NEW.previous_correction_id
  ) OR (NEW.previous_correction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM operations_office_payment_corrections c
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.previous_correction_id
      AND c.payment_request_id = NEW.payment_request_id
  )) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'payment correction must extend the current tail';
  END IF;
  IF NEW.correction_kind <> 'note' THEN
    SELECT * INTO allocation_row FROM finance_payment_allocations
    WHERE tenant_id = NEW.tenant_id AND id = NEW.finance_allocation_id FOR SHARE;
    IF NOT FOUND OR allocation_row.payment_id <> request_row.finance_payment_id
       OR allocation_row.currency <> request_row.currency
       OR allocation_row.amount_minor > request_row.amount_minor
       OR (NEW.correction_kind = 'allocation' AND allocation_row.entry_kind <> 'allocation')
       OR (NEW.correction_kind = 'reversal' AND allocation_row.entry_kind <> 'reversal') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'payment correction finance lineage is invalid';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM operations_invoice_preparations preparation
      JOIN operations_services service
        ON service.tenant_id = preparation.tenant_id AND service.id = preparation.service_id
      WHERE preparation.tenant_id = NEW.tenant_id
        AND preparation.finance_invoice_id = allocation_row.invoice_id
        AND preparation.posting_status = 'posted'
        AND service.subscriber_id = request_row.subscriber_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'payment correction invoice does not belong to the request subscriber';
    END IF;
    IF NEW.correction_kind = 'reversal' AND NOT EXISTS (
      SELECT 1 FROM operations_office_payment_corrections prior
      WHERE prior.tenant_id = NEW.tenant_id
        AND prior.payment_request_id = NEW.payment_request_id
        AND prior.finance_allocation_id = allocation_row.reverses_allocation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'payment reversal must reverse an earlier correction allocation';
    END IF;
    NEW.amount_minor := allocation_row.amount_minor;
    NEW.currency := allocation_row.currency;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_payment_correction_chain_guard
BEFORE INSERT ON operations_office_payment_corrections
FOR EACH ROW EXECUTE FUNCTION validate_payment_correction_chain();

CREATE FUNCTION derive_collector_assignment_amount() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE invoice_row finance_invoices%ROWTYPE; allocated_minor_value bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.collector_user_id::text || ':' || NEW.route_id::text || ':' || NEW.due_on::text || ':' || NEW.currency::text, 0
  ));
  SELECT * INTO invoice_row FROM finance_invoices
  WHERE tenant_id = NEW.tenant_id AND id = NEW.finance_invoice_id FOR SHARE;
  IF NOT FOUND OR invoice_row.entry_kind <> 'posted' OR EXISTS (
    SELECT 1 FROM finance_invoices reversal
    WHERE reversal.tenant_id = invoice_row.tenant_id
      AND reversal.reverses_invoice_id = invoice_row.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector assignment requires an active posted invoice';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM operations_invoice_preparations preparation
    JOIN operations_services service
      ON service.tenant_id = preparation.tenant_id AND service.id = preparation.service_id
    WHERE preparation.tenant_id = NEW.tenant_id
      AND preparation.finance_invoice_id = NEW.finance_invoice_id
      AND preparation.posting_status = 'posted'
      AND service.subscriber_id = NEW.subscriber_id
      AND service.route_id = NEW.route_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector assignment invoice, subscriber, and route do not match';
  END IF;
  SELECT allocated_minor INTO allocated_minor_value
  FROM finance_document_guards
  WHERE tenant_id = NEW.tenant_id AND document_type = 'invoice' AND document_id = invoice_row.id
  FOR UPDATE;
  IF NOT FOUND OR invoice_row.amount_minor - allocated_minor_value <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector assignment requires an outstanding invoice balance';
  END IF;
  NEW.expected_amount_minor := invoice_row.amount_minor - allocated_minor_value;
  NEW.currency := invoice_row.currency;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_collector_assignment_amount_guard
BEFORE INSERT OR UPDATE ON operations_collector_assignments
FOR EACH ROW EXECUTE FUNCTION derive_collector_assignment_amount();

CREATE FUNCTION derive_collector_evidence_amount() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE payment_row finance_payments%ROWTYPE; assignment_row operations_collector_assignments%ROWTYPE;
BEGIN
  SELECT * INTO assignment_row FROM operations_collector_assignments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector assignment is missing';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    assignment_row.tenant_id::text || ':' || assignment_row.collector_user_id::text || ':' || assignment_row.route_id::text || ':' || assignment_row.due_on::text || ':' || assignment_row.currency::text, 0
  ));
  SELECT * INTO payment_row FROM finance_payments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.finance_payment_id FOR SHARE;
  IF NOT FOUND OR payment_row.entry_kind <> 'posted' OR EXISTS (
    SELECT 1 FROM finance_payments reversal
    WHERE reversal.tenant_id = payment_row.tenant_id
      AND reversal.reverses_payment_id = payment_row.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector evidence requires an active posted payment';
  END IF;
  IF payment_row.currency <> assignment_row.currency OR NOT EXISTS (
    SELECT 1 FROM finance_payment_allocations allocation
    WHERE allocation.tenant_id = NEW.tenant_id
      AND allocation.payment_id = payment_row.id
      AND allocation.invoice_id = assignment_row.finance_invoice_id
      AND allocation.entry_kind = 'allocation'
      AND NOT EXISTS (
        SELECT 1 FROM finance_payment_allocations reversal
        WHERE reversal.tenant_id = allocation.tenant_id
          AND reversal.reverses_allocation_id = allocation.id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector payment is not allocated to the assigned invoice';
  END IF;
  NEW.amount_minor := payment_row.amount_minor;
  NEW.currency := payment_row.currency;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_collector_evidence_amount_guard
BEFORE INSERT ON operations_collector_collection_evidence
FOR EACH ROW EXECUTE FUNCTION derive_collector_evidence_amount();

CREATE FUNCTION derive_collector_reconciliation_totals() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM operations_collector_reconciliations
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key
  ) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.collector_user_id::text || ':' || NEW.route_id::text || ':' || NEW.business_date::text || ':' || NEW.currency::text, 0
  ));
  IF EXISTS (
    SELECT 1 FROM operations_collector_reconciliations
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key
  ) THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM operations_collector_reconciliations r
    WHERE r.tenant_id = NEW.tenant_id AND r.collector_user_id = NEW.collector_user_id
      AND r.route_id = NEW.route_id AND r.business_date = NEW.business_date
      AND r.currency = NEW.currency
      AND NOT EXISTS (
        SELECT 1 FROM operations_collector_reconciliations child
        WHERE child.tenant_id = r.tenant_id AND child.previous_reconciliation_id = r.id
      )
      AND r.id IS DISTINCT FROM NEW.previous_reconciliation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'reconciliation must extend the current tail';
  END IF;
  PERFORM 1
  FROM operations_collector_assignments a
  WHERE a.tenant_id = NEW.tenant_id AND a.collector_user_id = NEW.collector_user_id
    AND a.route_id = NEW.route_id AND a.due_on = NEW.business_date
    AND a.currency = NEW.currency AND a.status <> 'cancelled'
  FOR UPDATE;
  PERFORM 1
  FROM operations_collector_collection_evidence e
  JOIN operations_collector_assignments a
    ON a.tenant_id = e.tenant_id AND a.id = e.assignment_id
  WHERE a.tenant_id = NEW.tenant_id AND a.collector_user_id = NEW.collector_user_id
    AND a.route_id = NEW.route_id AND a.due_on = NEW.business_date
    AND e.currency = NEW.currency
  FOR UPDATE OF e, a;
  SELECT coalesce(sum(a.expected_amount_minor), 0) INTO NEW.expected_minor
  FROM operations_collector_assignments a
  WHERE a.tenant_id = NEW.tenant_id AND a.collector_user_id = NEW.collector_user_id
    AND a.route_id = NEW.route_id AND a.due_on = NEW.business_date
    AND a.currency = NEW.currency AND a.status <> 'cancelled';
  SELECT coalesce(sum(e.amount_minor), 0) INTO NEW.declared_minor
  FROM operations_collector_collection_evidence e
  JOIN operations_collector_assignments a
    ON a.tenant_id = e.tenant_id AND a.id = e.assignment_id
  WHERE a.tenant_id = NEW.tenant_id AND a.collector_user_id = NEW.collector_user_id
    AND a.route_id = NEW.route_id AND a.due_on = NEW.business_date
    AND e.currency = NEW.currency
  ;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_collector_reconciliation_totals_guard
BEFORE INSERT ON operations_collector_reconciliations
FOR EACH ROW EXECUTE FUNCTION derive_collector_reconciliation_totals();

CREATE FUNCTION validate_installation_event_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE installation_row operations_installations%ROWTYPE; service_row operations_services%ROWTYPE;
BEGIN
  SELECT * INTO installation_row FROM operations_installations
  WHERE tenant_id = NEW.tenant_id AND id = NEW.installation_id FOR UPDATE;
  IF NOT FOUND OR installation_row.version <> NEW.expected_version OR installation_row.status <> NEW.from_status THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'installation version or source state changed';
  END IF;
  IF NOT (
    (NEW.from_status = 'requested' AND NEW.to_status IN ('scheduled', 'cancelled')) OR
    (NEW.from_status = 'scheduled' AND NEW.to_status IN ('in_progress', 'blocked', 'cancelled')) OR
    (NEW.from_status = 'in_progress' AND NEW.to_status IN ('blocked', 'ready_for_activation', 'cancelled')) OR
    (NEW.from_status = 'blocked' AND NEW.to_status IN ('scheduled', 'in_progress', 'cancelled')) OR
    (NEW.from_status = 'ready_for_activation' AND NEW.to_status IN ('completed', 'blocked'))
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'invalid installation transition'; END IF;
  IF NEW.to_status = 'scheduled' AND NOT (
    jsonb_typeof(NEW.evidence->'scheduledFor') = 'string'
    AND jsonb_typeof(NEW.evidence->'installerUserId') = 'string'
    AND (NEW.evidence->>'scheduledFor')::timestamptz > clock_timestamp() - interval '15 minutes'
    AND EXISTS (
      SELECT 1 FROM tenant_memberships membership
      WHERE membership.tenant_id = NEW.tenant_id
        AND membership.user_id = (NEW.evidence->>'installerUserId')::uuid
        AND membership.active
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'valid schedule and active installer are required';
  END IF;
  IF NEW.to_status = 'blocked' AND length(btrim(coalesce(NEW.note, ''))) < 8 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'blocker reason is required';
  END IF;
  IF NEW.to_status IN ('ready_for_activation', 'completed') AND NOT (
    jsonb_typeof(NEW.evidence->'signalTest') = 'string'
    AND length(btrim(NEW.evidence->>'signalTest')) BETWEEN 1 AND 500
    AND jsonb_typeof(NEW.evidence->'equipmentSerial') = 'string'
    AND length(btrim(NEW.evidence->>'equipmentSerial')) BETWEEN 1 AND 200
    AND jsonb_typeof(NEW.evidence->'completedAt') = 'string'
    AND (NEW.evidence->>'completedAt')::timestamptz >= clock_timestamp() - interval '24 hours'
    AND (NEW.evidence->>'completedAt')::timestamptz <= clock_timestamp() + interval '5 minutes'
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'installation completion evidence is incomplete'; END IF;
  SELECT * INTO service_row FROM operations_services
  WHERE tenant_id = NEW.tenant_id AND id = installation_row.service_id FOR UPDATE;
  IF NEW.to_status = 'completed' AND service_row.status <> 'pending_installation' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'service is not pending installation';
  END IF;
  IF NEW.to_status = 'completed' THEN
    UPDATE operations_services
    SET status = 'active', activated_at = clock_timestamp()
    WHERE tenant_id = NEW.tenant_id AND id = service_row.id;
  END IF;
  UPDATE operations_installations SET status = NEW.to_status,
    blocker_reason = CASE WHEN NEW.to_status = 'blocked' THEN NEW.note ELSE NULL END,
    scheduled_for = CASE WHEN NEW.to_status = 'scheduled'
      THEN (NEW.evidence->>'scheduledFor')::timestamptz ELSE scheduled_for END,
    installer_user_id = CASE WHEN NEW.to_status = 'scheduled'
      THEN (NEW.evidence->>'installerUserId')::uuid ELSE installer_user_id END,
    version = version + 1, updated_at = clock_timestamp()
  WHERE tenant_id = NEW.tenant_id AND id = NEW.installation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_installation_event_transition_guard
BEFORE INSERT ON operations_installation_events
FOR EACH ROW EXECUTE FUNCTION validate_installation_event_transition();

CREATE FUNCTION validate_issue_event_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE issue_row operations_support_issues%ROWTYPE;
BEGIN
  SELECT * INTO issue_row FROM operations_support_issues
  WHERE tenant_id = NEW.tenant_id AND id = NEW.issue_id FOR UPDATE;
  IF NOT FOUND OR issue_row.version <> NEW.expected_version OR issue_row.status <> NEW.from_status THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'issue version or source state changed';
  END IF;
  IF NOT (
    (NEW.from_status = 'open' AND NEW.to_status IN ('triaged', 'closed')) OR
    (NEW.from_status = 'triaged' AND NEW.to_status IN ('in_progress', 'waiting', 'resolved', 'closed')) OR
    (NEW.from_status = 'in_progress' AND NEW.to_status IN ('waiting', 'resolved')) OR
    (NEW.from_status = 'waiting' AND NEW.to_status IN ('in_progress', 'resolved', 'closed')) OR
    (NEW.from_status = 'resolved' AND NEW.to_status IN ('in_progress', 'closed'))
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'invalid support issue transition'; END IF;
  IF NEW.to_status IN ('resolved', 'closed') AND NOT (
    jsonb_typeof(NEW.evidence->'resolutionCode') = 'string'
    AND length(btrim(NEW.evidence->>'resolutionCode')) > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'resolution evidence is required';
  END IF;
  UPDATE operations_support_issues SET status = NEW.to_status, version = version + 1,
    updated_at = clock_timestamp(), closed_at = CASE WHEN NEW.to_status = 'closed' THEN clock_timestamp() ELSE NULL END
  WHERE tenant_id = NEW.tenant_id AND id = NEW.issue_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_issue_event_transition_guard
BEFORE INSERT ON operations_issue_events
FOR EACH ROW EXECUTE FUNCTION validate_issue_event_transition();

-- Validate all branch/area/route combinations at the write boundary.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'operations_locations', 'operations_subscribers', 'operations_services',
    'operations_office_payment_requests', 'operations_installations',
    'operations_support_issues', 'operations_network_action_outbox'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_operations_scope_links()',
      table_name || '_scope_links', table_name
    );
  END LOOP;
END;
$$;

-- Every read/write now requires the signed,
-- owner-protected transaction context. Empty arrays deny all; omitted arrays mean unrestricted.
ALTER TABLE operations_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_branches_scope ON operations_branches
  USING (operations_scope_allows(tenant_id, id)) WITH CHECK (operations_scope_allows(tenant_id, id));
ALTER TABLE operations_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_areas_scope ON operations_areas
  USING (operations_scope_allows(tenant_id, branch_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, id));
ALTER TABLE operations_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_routes_scope ON operations_routes
  USING (operations_scope_allows(tenant_id, branch_id, area_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, id));

CREATE POLICY operations_households_scope ON operations_households
  USING (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id));
CREATE POLICY operations_locations_scope ON operations_locations
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_subscribers_scope ON operations_subscribers
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_contacts_scope ON operations_contacts
  USING (operations_scope_allows_subscriber(tenant_id, subscriber_id)) WITH CHECK (operations_scope_allows_subscriber(tenant_id, subscriber_id));
CREATE POLICY operations_plans_scope ON operations_plans
  USING (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id));
CREATE POLICY operations_services_scope ON operations_services
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_billing_runs_scope ON operations_billing_runs
  USING (operations_scope_allows_arrays(tenant_id, scope_branch_ids, scope_area_ids, scope_route_ids))
  WITH CHECK (operations_scope_allows_arrays(tenant_id, scope_branch_ids, scope_area_ids, scope_route_ids));
CREATE POLICY operations_invoice_preparations_scope ON operations_invoice_preparations
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, service_id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, service_id));
CREATE POLICY operations_payment_requests_scope ON operations_office_payment_requests
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_payment_corrections_scope ON operations_office_payment_corrections
  USING (operations_scope_allows_payment_request(tenant_id, payment_request_id)) WITH CHECK (operations_scope_allows_payment_request(tenant_id, payment_request_id));
CREATE POLICY operations_assignments_scope ON operations_collector_assignments
  USING (operations_scope_allows_route(tenant_id, route_id, id)) WITH CHECK (operations_scope_allows_route(tenant_id, route_id, id));
CREATE POLICY operations_reconciliations_scope ON operations_collector_reconciliations
  USING (operations_scope_allows_route(tenant_id, route_id, id)) WITH CHECK (operations_scope_allows_route(tenant_id, route_id, id));
CREATE POLICY operations_installations_scope ON operations_installations
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_installation_events_scope ON operations_installation_events
  USING (operations_scope_allows_installation(tenant_id, installation_id)) WITH CHECK (operations_scope_allows_installation(tenant_id, installation_id));
CREATE POLICY operations_issues_scope ON operations_support_issues
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY operations_issue_events_scope ON operations_issue_events
  USING (operations_scope_allows_issue(tenant_id, issue_id)) WITH CHECK (operations_scope_allows_issue(tenant_id, issue_id));
CREATE POLICY operations_exports_scope ON operations_export_jobs
  USING (operations_scope_allows_arrays(tenant_id, scope_branch_ids, scope_area_ids, scope_route_ids, scope_record_ids))
  WITH CHECK (operations_scope_allows_arrays(tenant_id, scope_branch_ids, scope_area_ids, scope_route_ids, scope_record_ids));
CREATE POLICY operations_configuration_scope ON operations_configuration
  USING (operations_scope_allows(tenant_id, branch_id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id));
ALTER TABLE operations_configuration_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_configuration_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_configuration_changes_scope ON operations_configuration_changes
  USING (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id))
  WITH CHECK (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id));
CREATE POLICY operations_network_outbox_scope ON operations_network_action_outbox
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, service_id)) WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, service_id));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'operations_plan_versions', 'operations_billing_policies',
    'operations_collector_collection_evidence', 'operations_audit_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (operations_scope_allows(tenant_id)) WITH CHECK (operations_scope_allows(tenant_id))',
      table_name || '_scope', table_name
    );
  END LOOP;
END;
$$;

DROP POLICY operations_plan_versions_scope ON operations_plan_versions;
CREATE POLICY operations_plan_versions_scope ON operations_plan_versions
  USING (EXISTS (
    SELECT 1 FROM operations_plans p
    WHERE p.tenant_id = operations_plan_versions.tenant_id
      AND p.id = operations_plan_versions.plan_id
      AND operations_scope_allows(p.tenant_id, p.branch_id, NULL, NULL, p.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM operations_plans p
    WHERE p.tenant_id = operations_plan_versions.tenant_id
      AND p.id = operations_plan_versions.plan_id
      AND operations_scope_allows(p.tenant_id, p.branch_id, NULL, NULL, p.id)
  ));
DROP POLICY operations_billing_policies_scope ON operations_billing_policies;
CREATE POLICY operations_billing_policies_scope ON operations_billing_policies
  USING (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id))
  WITH CHECK (operations_scope_allows(tenant_id, branch_id, NULL, NULL, id));
DROP POLICY operations_collector_collection_evidence_scope ON operations_collector_collection_evidence;
CREATE POLICY operations_collector_collection_evidence_scope ON operations_collector_collection_evidence
  USING (EXISTS (
    SELECT 1 FROM operations_collector_assignments a
    WHERE a.tenant_id = operations_collector_collection_evidence.tenant_id
      AND a.id = operations_collector_collection_evidence.assignment_id
      AND operations_scope_allows_route(a.tenant_id, a.route_id, a.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM operations_collector_assignments a
    WHERE a.tenant_id = operations_collector_collection_evidence.tenant_id
      AND a.id = operations_collector_collection_evidence.assignment_id
      AND operations_scope_allows_route(a.tenant_id, a.route_id, a.id)
  ));

-- Relay functions are owner-mediated and ordinary runtime has no outbox privilege. The owner must
-- bypass RLS inside those functions, while direct callers remain policy constrained.
ALTER TABLE operations_audit_outbox NO FORCE ROW LEVEL SECURITY;

CREATE POLICY operations_platform_subscription_event_read ON operations_platform_subscription_events
  FOR SELECT USING (operations_scope_allows(tenant_id));
ALTER TABLE operations_platform_subscription_events ENABLE ROW LEVEL SECURITY;

-- Every Operations mutation is audited in the same tenant transaction.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'operations_branches', 'operations_areas', 'operations_routes', 'operations_households',
    'operations_locations', 'operations_subscribers', 'operations_contacts', 'operations_plans',
    'operations_plan_versions', 'operations_billing_policies', 'operations_services',
    'operations_billing_runs', 'operations_invoice_preparations',
    'operations_office_payment_requests', 'operations_office_payment_corrections',
    'operations_collector_assignments', 'operations_collector_collection_evidence',
    'operations_collector_reconciliations', 'operations_installations',
    'operations_installation_events', 'operations_support_issues', 'operations_issue_events',
    'operations_export_jobs', 'operations_configuration', 'operations_configuration_changes',
    'operations_network_action_outbox'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox()',
      table_name || '_audit_outbox', table_name
    );
  END LOOP;
END;
$$;

-- Remove broad provisional writes. Composition uses the reviewed repository statements and the
-- signed-context entry point; delivery roles are provisioned separately.
REVOKE ALL ON TABLE operations_context_keys, operations_request_contexts,
  operations_audit_outbox, operations_platform_subscription_events FROM PUBLIC, orvex_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  operations_branches, operations_areas, operations_routes, operations_households,
  operations_locations, operations_subscribers, operations_contacts, operations_plans,
  operations_plan_versions, operations_billing_policies, operations_services,
  operations_billing_runs, operations_invoice_preparations, operations_office_payment_requests,
  operations_office_payment_corrections, operations_collector_assignments,
  operations_collector_collection_evidence, operations_collector_reconciliations,
  operations_installations, operations_installation_events, operations_support_issues,
  operations_issue_events, operations_export_jobs, operations_configuration,
  operations_configuration_changes, operations_network_action_outbox
FROM orvex_runtime;
GRANT SELECT, INSERT ON TABLE
  operations_branches, operations_areas, operations_routes, operations_households,
  operations_locations, operations_subscribers, operations_contacts, operations_plans,
  operations_plan_versions, operations_billing_policies, operations_services,
  operations_billing_runs, operations_invoice_preparations, operations_office_payment_requests,
  operations_office_payment_corrections, operations_collector_assignments,
  operations_collector_collection_evidence, operations_collector_reconciliations,
  operations_installations, operations_installation_events, operations_support_issues,
  operations_issue_events, operations_export_jobs, operations_configuration,
  operations_configuration_changes, operations_network_action_outbox
TO orvex_runtime;
GRANT UPDATE(status, completed_at, error_summary) ON operations_billing_runs TO orvex_runtime;
GRANT UPDATE(value, branch_id, version, updated_by, updated_at, idempotency_key, request_fingerprint)
  ON operations_configuration TO orvex_runtime;
GRANT EXECUTE ON FUNCTION begin_operations_request_context(text, text) TO orvex_runtime;
GRANT EXECUTE ON FUNCTION operations_current_context() TO orvex_runtime;
GRANT EXECUTE ON FUNCTION operations_readiness() TO orvex_runtime;
GRANT EXECUTE ON FUNCTION
  operations_scope_allows(uuid, uuid, uuid, uuid, uuid),
  operations_scope_allows_subscriber(uuid, uuid),
  operations_scope_allows_payment_request(uuid, uuid),
  operations_scope_allows_route(uuid, uuid, uuid),
  operations_scope_allows_installation(uuid, uuid),
  operations_scope_allows_issue(uuid, uuid),
  operations_scope_allows_arrays(uuid, uuid[], uuid[], uuid[], uuid[])
TO orvex_runtime;

REVOKE ALL ON FUNCTION begin_operations_request_context(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_readiness() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_current_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_subscriber(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_payment_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_route(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_installation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_issue(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_scope_allows_arrays(uuid, uuid[], uuid[], uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_operations_audit_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_operations_audit_relay_tenants() FROM PUBLIC, orvex_runtime;
REVOKE ALL ON FUNCTION read_operations_audit_outbox(uuid, integer) FROM PUBLIC, orvex_runtime;
REVOKE ALL ON FUNCTION read_operations_audit_backlog(uuid) FROM PUBLIC, orvex_runtime;
REVOKE ALL ON FUNCTION mark_operations_audit_outbox_delivered(uuid, timestamptz) FROM PUBLIC, orvex_runtime;
REVOKE ALL ON FUNCTION protect_operations_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION record_operations_platform_subscription_state(uuid,uuid,text,bigint,timestamptz) FROM PUBLIC, orvex_runtime;
GRANT EXECUTE ON FUNCTION list_operations_audit_relay_tenants(),
  read_operations_audit_outbox(uuid,integer),
  read_operations_audit_backlog(uuid),
  mark_operations_audit_outbox_delivered(uuid,timestamptz),
  record_operations_platform_subscription_state(uuid,uuid,text,bigint,timestamptz)
TO orvex_finance_audit_relay;
REVOKE ALL ON FUNCTION validate_operations_scope_links() FROM PUBLIC;
REVOKE ALL ON FUNCTION operations_json_contains_secret_key(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_support_issue_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_operations_route_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_billing_run_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_effective_operations_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_office_payment_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_payment_correction_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION derive_collector_assignment_amount() FROM PUBLIC;
REVOKE ALL ON FUNCTION derive_collector_evidence_amount() FROM PUBLIC;
REVOKE ALL ON FUNCTION derive_collector_reconciliation_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_installation_event_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_issue_event_transition() FROM PUBLIC;
