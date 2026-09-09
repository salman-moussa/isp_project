-- 202609090600_tenant_cashier_collections.sql
-- Office cashier and field collections: cash drawers per cashier and currency, receipts posted
-- atomically (finance payment, allocations to the subscriber's open invoices, scoped office
-- source), voids as linked reversals, default collectors per route, invoice assignments derived
-- from the open balance, office-recorded collections with real amounts, and route settlements
-- whose difference is kept and approved rather than silently zeroed.
--
-- Money stays integer minor units in one currency per record; USD and LBP never combine.

-- ---------------------------------------------------------------------------------------------
-- Document counters (receipt numbers are issued by the database, never re-used)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operations_document_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  counter_key text NOT NULL CHECK (counter_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (tenant_id, counter_key)
);

CREATE FUNCTION operations_next_document_number(p_tenant uuid, p_key text, p_prefix text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO operations_document_counters(tenant_id, counter_key, next_value) VALUES (p_tenant, p_key, 2)
    ON CONFLICT (tenant_id, counter_key) DO UPDATE SET next_value = operations_document_counters.next_value + 1
    RETURNING next_value - 1 INTO n;
  RETURN p_prefix || '-' || lpad(n::text, 6, '0');
END $$;
REVOKE ALL ON FUNCTION operations_next_document_number(uuid, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Cash drawers
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operations_cash_drawers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES users(id),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float_minor bigint NOT NULL CHECK (opening_float_minor >= 0),
  expected_minor bigint,
  counted_minor bigint CHECK (counted_minor IS NULL OR counted_minor >= 0),
  variance_minor bigint,
  closing_note text CHECK (closing_note IS NULL OR length(closing_note) <= 1000),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (status <> 'closed' OR (expected_minor IS NOT NULL AND counted_minor IS NOT NULL AND variance_minor IS NOT NULL AND closed_by IS NOT NULL))
);
CREATE UNIQUE INDEX cash_drawer_one_open_per_cashier_currency
  ON operations_cash_drawers(tenant_id, cashier_user_id, currency) WHERE status = 'open';
CREATE INDEX cash_drawer_branch_idx ON operations_cash_drawers(tenant_id, branch_id, opened_at DESC);

ALTER TABLE operations_office_payment_requests
  ADD COLUMN method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'card', 'bank_transfer', 'omt', 'whish', 'other')),
  ADD COLUMN reference text CHECK (reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 200),
  ADD COLUMN note text CHECK (note IS NULL OR length(note) <= 1000),
  ADD COLUMN drawer_id uuid,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text CHECK (void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 8 AND 1000),
  ADD COLUMN void_payment_id uuid,
  ADD CONSTRAINT office_payment_drawer_fk FOREIGN KEY (tenant_id, drawer_id) REFERENCES operations_cash_drawers(tenant_id, id),
  ADD CONSTRAINT office_payment_void_fk FOREIGN KEY (tenant_id, void_payment_id) REFERENCES finance_payments(tenant_id, id),
  ADD CONSTRAINT office_payment_void_consistency CHECK ((voided_at IS NULL) = (void_payment_id IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));
CREATE INDEX office_payment_drawer_idx ON operations_office_payment_requests(tenant_id, drawer_id) WHERE drawer_id IS NOT NULL;
CREATE INDEX office_payment_requested_idx ON operations_office_payment_requests(tenant_id, requested_at DESC);

CREATE TABLE operations_cashier_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  drawer_id uuid,
  receipt_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, drawer_id) REFERENCES operations_cash_drawers(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES operations_office_payment_requests(tenant_id, id),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);
CREATE INDEX cashier_events_idx ON operations_cashier_events(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Field collections: route collectors, settlements, events
-- ---------------------------------------------------------------------------------------------
CREATE TABLE operations_route_collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  route_id uuid NOT NULL,
  collector_user_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (active = (ended_at IS NULL))
);
CREATE UNIQUE INDEX route_collector_one_active ON operations_route_collectors(tenant_id, route_id) WHERE active;

CREATE TABLE operations_route_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  collector_user_id uuid NOT NULL,
  route_id uuid NOT NULL,
  business_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  expected_minor bigint NOT NULL CHECK (expected_minor >= 0),
  declared_minor bigint NOT NULL CHECK (declared_minor >= 0),
  difference_minor bigint GENERATED ALWAYS AS (declared_minor - expected_minor) STORED,
  status text NOT NULL CHECK (status IN ('accepted', 'pending_approval', 'approved')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 8 AND 1000),
  settled_by uuid NOT NULL REFERENCES users(id),
  settled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  approval_reason text CHECK (approval_reason IS NULL OR length(btrim(approval_reason)) BETWEEN 8 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, collector_user_id, route_id, business_date, currency),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_reason IS NOT NULL)),
  CHECK (status <> 'accepted' OR declared_minor = expected_minor),
  CHECK (status = 'accepted' OR reason IS NOT NULL)
);
CREATE INDEX route_settlements_idx ON operations_route_settlements(tenant_id, business_date DESC, route_id);

CREATE TABLE operations_collection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  assignment_id uuid,
  settlement_id uuid,
  route_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES operations_collector_assignments(tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES operations_route_settlements(tenant_id, id),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);
CREATE INDEX collection_events_idx ON operations_collection_events(tenant_id, created_at DESC);

-- Append-only ledgers and row policies (runtime reads go through SECURITY DEFINER readers).
CREATE TRIGGER cashier_events_append_only BEFORE UPDATE OR DELETE ON operations_cashier_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER collection_events_append_only BEFORE UPDATE OR DELETE ON operations_collection_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['operations_document_counters','operations_cash_drawers','operations_cashier_events',
    'operations_route_collectors','operations_route_settlements','operations_collection_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t || '_tenant', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
  END LOOP;
END $$;
CREATE TRIGGER cash_drawers_audit AFTER INSERT OR UPDATE OR DELETE ON operations_cash_drawers
  FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox();
CREATE TRIGGER route_collectors_audit AFTER INSERT OR UPDATE OR DELETE ON operations_route_collectors
  FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox();
CREATE TRIGGER route_settlements_audit AFTER INSERT OR UPDATE OR DELETE ON operations_route_settlements
  FOR EACH ROW EXECUTE FUNCTION append_operations_audit_outbox();

-- ---------------------------------------------------------------------------------------------
-- Audit allow-list: cashier and collection actions may touch their tables.
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
-- Finance source guard: the cashier and collection workflows post receipts, allocations and
-- linked reversals under their own signed actions. Everything else is unchanged.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_finance_accounting_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; permitted boolean:=false;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.actor_id IS DISTINCT FROM NEW.actor_id
   OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='financial posting requires signed tenant actor context';
 END IF;
 IF TG_TABLE_NAME='finance_invoices' THEN
   permitted:=(NEW.entry_kind='posted' AND (
     (c.permission='tenant.invoice.post' AND c.action IN ('tenant.invoice.post','tenant.order.first_invoice.post'))
     OR (c.permission='tenant.invoice.create' AND c.action='tenant.billing.prepare')))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.invoice.reverse' AND c.action='tenant.invoice.reverse');
 ELSIF TG_TABLE_NAME='finance_payments' THEN
   permitted:=(NEW.entry_kind='posted' AND c.permission='tenant.payment.post' AND c.action IN
     ('tenant.payment.post','tenant.payment.office.record','tenant.collection.evidence.record','tenant.customer_account.deposit_received',
      'tenant.cashier.manage','tenant.collection.manage'))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.payment.reverse' AND c.action IN
       ('tenant.payment.reverse','tenant.customer_account.deposit_reversal','tenant.cashier.manage'));
 ELSE
   permitted:=(NEW.entry_kind='allocation' AND (
     (c.permission='tenant.payment.post' AND c.action IN ('tenant.payment.allocate','tenant.collection.evidence.record','tenant.customer_account.deposit_applied',
       'tenant.cashier.manage','tenant.collection.manage'))
     OR (c.permission='tenant.payment.reverse' AND c.action='tenant.payment.correct')))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.payment.reverse' AND c.action IN
       ('tenant.payment.allocation.reverse','tenant.payment.correct','tenant.customer_account.deposit_application_reversal','tenant.cashier.manage'));
 END IF;
 IF NOT permitted THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed finance action does not authorize this source';
 END IF;
 -- Raw finance endpoints carry no service/branch identity: they require unrestricted tenant scope.
 IF c.action IN ('tenant.invoice.post','tenant.invoice.reverse','tenant.payment.post',
   'tenant.payment.reverse','tenant.payment.allocate','tenant.payment.allocation.reverse')
   AND NOT operations_scope_allows(NEW.tenant_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='use a scoped operational workflow for this finance mutation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':accounting-period',0));
 -- An exact retry is a read of its already-posted result, even after a subsequent period close.
 IF EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=NEW.tenant_id
   AND j.finance_source_table=TG_TABLE_NAME AND j.finance_source_id IN (
     SELECT (r->>'id')::uuid FROM (
       SELECT to_jsonb(i) r FROM finance_invoices i WHERE TG_TABLE_NAME='finance_invoices' AND i.tenant_id=NEW.tenant_id AND i.idempotency_key=NEW.idempotency_key
       UNION ALL SELECT to_jsonb(p) FROM finance_payments p WHERE TG_TABLE_NAME='finance_payments' AND p.tenant_id=NEW.tenant_id AND p.idempotency_key=NEW.idempotency_key
       UNION ALL SELECT to_jsonb(a) FROM finance_payment_allocations a WHERE TG_TABLE_NAME='finance_payment_allocations' AND a.tenant_id=NEW.tenant_id AND a.idempotency_key=NEW.idempotency_key
     ) old_source)) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM operations_accounting_periods p WHERE p.tenant_id=NEW.tenant_id
   AND p.status<>'open' AND (NEW.posted_at AT TIME ZONE 'UTC')::date BETWEEN p.start_date AND p.end_date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='financial source date belongs to a closed accounting period';
 END IF;
 IF NEW.amount_minor>9007199254740991 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='financial source amount exceeds safe integer range';
 END IF;
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION cashier_context_or_raise(p_action text, p_permissions text[]) RETURNS operations_request_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> p_action OR NOT (c.permission = ANY(p_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed cashier or collection authority required';
  END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  PERFORM set_config('app.finance_actor_id', c.actor_id, true);
  PERFORM set_config('app.finance_session_id', c.session_id, true);
  PERFORM set_config('app.finance_support_grant_id', '', true);
  PERFORM set_config('app.finance_permission', c.permission, true);
  PERFORM set_config('app.finance_request_id', c.request_id, true);
  PERFORM set_config('app.finance_ip_address', c.ip_address, true);
  PERFORM set_config('app.finance_user_agent', coalesce(c.user_agent, ''), true);
  PERFORM set_config('app.finance_reason', c.reason, true);
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION cashier_context_or_raise(text, text[]) FROM PUBLIC;

-- Open balance of a posted, unreversed invoice.
CREATE FUNCTION cashier_invoice_open_minor(p_tenant uuid, p_invoice uuid) RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.amount_minor - g.allocated_minor - g.credited_minor
  FROM finance_invoices i
  JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
  WHERE i.tenant_id = p_tenant AND i.id = p_invoice AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
$$;
REVOKE ALL ON FUNCTION cashier_invoice_open_minor(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Cashier commands
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION execute_cashier_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_cashier_events%ROWTYPE;
  drawer operations_cash_drawers%ROWTYPE;
  receipt operations_office_payment_requests%ROWTYPE;
  sub operations_subscribers%ROWTYPE;
  inv record;
  alloc record;
  v_action text; answer jsonb; allocations jsonb := '[]'::jsonb;
  v_amount bigint; v_left bigint; v_part bigint; v_currency text; v_invoice uuid; v_method text;
  v_number text; v_payment uuid; v_allocation uuid; v_reversal uuid; n integer := 0;
  v_expected bigint; v_counted bigint; v_reason text; v_receipt_id uuid;
BEGIN
  c := cashier_context_or_raise('tenant.cashier.manage', ARRAY['tenant.payment.post', 'tenant.payment.reverse']);
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid cashier payload';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':cashier:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_cashier_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'cashier retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;
  PERFORM accounting_lock_financial_request();

  IF v_action = 'open_drawer' THEN
    IF c.permission <> 'tenant.payment.post' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'drawer control requires payment posting authority';
    END IF;
    IF coalesce(payload->>'currency', '') NOT IN ('USD', 'LBP')
       OR coalesce((payload->>'openingFloatMinor')::bigint, -1) < 0
       OR NOT EXISTS (SELECT 1 FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND b.id = (payload->>'branchId')::uuid
                        AND operations_scope_allows(b.tenant_id, b.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'drawer needs a scoped branch, a currency and a non-negative opening float';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_cash_drawers d WHERE d.tenant_id = c.tenant_id AND d.cashier_user_id::text = c.actor_id
                 AND d.currency = payload->>'currency' AND d.status = 'open') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a drawer in this currency is already open for this cashier';
    END IF;
    INSERT INTO operations_cash_drawers(tenant_id, branch_id, cashier_user_id, currency, opening_float_minor)
      VALUES (c.tenant_id, (payload->>'branchId')::uuid, c.actor_id::uuid, payload->>'currency', (payload->>'openingFloatMinor')::bigint)
      RETURNING * INTO drawer;
    answer := jsonb_build_object('drawerId', drawer.id, 'status', drawer.status, 'version', drawer.version);

  ELSIF v_action = 'close_drawer' THEN
    IF c.permission <> 'tenant.payment.post' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'drawer control requires payment posting authority';
    END IF;
    SELECT * INTO drawer FROM operations_cash_drawers WHERE tenant_id = c.tenant_id AND id = (payload->>'drawerId')::uuid FOR UPDATE;
    IF NOT FOUND OR drawer.cashier_user_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'drawer missing or not yours to close';
    END IF;
    IF drawer.status <> 'open' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'drawer is already closed';
    END IF;
    IF drawer.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'drawer changed since it was read';
    END IF;
    v_counted := (payload->>'countedMinor')::bigint;
    IF v_counted IS NULL OR v_counted < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'counted cash must be a non-negative amount';
    END IF;
    SELECT drawer.opening_float_minor + coalesce(sum(CASE WHEN r.voided_at IS NULL THEN r.amount_minor ELSE 0 END), 0)
      INTO v_expected
      FROM operations_office_payment_requests r
      WHERE r.tenant_id = c.tenant_id AND r.drawer_id = drawer.id AND r.method = 'cash';
    UPDATE operations_cash_drawers SET status = 'closed', expected_minor = v_expected, counted_minor = v_counted,
      variance_minor = v_counted - v_expected, closing_note = nullif(btrim(coalesce(payload->>'note', '')), ''),
      closed_at = clock_timestamp(), closed_by = c.actor_id::uuid, version = version + 1
      WHERE tenant_id = c.tenant_id AND id = drawer.id RETURNING * INTO drawer;
    answer := jsonb_build_object('drawerId', drawer.id, 'status', drawer.status, 'expectedMinor', drawer.expected_minor,
      'countedMinor', drawer.counted_minor, 'varianceMinor', drawer.variance_minor, 'version', drawer.version);

  ELSIF v_action = 'record_receipt' THEN
    IF c.permission <> 'tenant.payment.post' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'receipts require payment posting authority';
    END IF;
    v_amount := (payload->>'amountMinor')::bigint;
    v_currency := payload->>'currency';
    v_method := coalesce(payload->>'method', 'cash');
    v_invoice := (payload->>'invoiceId')::uuid;
    IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 9007199254740991 OR v_currency NOT IN ('USD', 'LBP')
       OR v_method NOT IN ('cash', 'card', 'bank_transfer', 'omt', 'whish', 'other')
       OR (v_method <> 'cash' AND nullif(btrim(coalesce(payload->>'reference', '')), '') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'receipt needs a positive amount, a currency, a method and a reference for non-cash methods';
    END IF;
    SELECT * INTO sub FROM operations_subscribers WHERE tenant_id = c.tenant_id AND id = (payload->>'subscriberId')::uuid;
    IF NOT FOUND OR NOT operations_scope_allows_subscriber(c.tenant_id, sub.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'subscriber missing or outside scope';
    END IF;
    IF sub.status::text = 'closed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'closed subscribers cannot receive receipts';
    END IF;
    v_number := nullif(btrim(coalesce(payload->>'receiptNumber', '')), '');
    IF v_number IS NULL THEN
      v_number := operations_next_document_number(c.tenant_id, 'office_receipt', 'RC');
    ELSIF length(v_number) > 120 OR EXISTS (SELECT 1 FROM finance_payments p WHERE p.tenant_id = c.tenant_id AND p.receipt_number = v_number) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'receipt number is already used';
    END IF;
    -- Cash receipts join the cashier's open drawer in the same currency when one exists.
    SELECT * INTO drawer FROM operations_cash_drawers d WHERE d.tenant_id = c.tenant_id AND d.cashier_user_id::text = c.actor_id
      AND d.currency = v_currency AND d.status = 'open' AND v_method = 'cash' FOR UPDATE;
    PERFORM set_config('app.finance_action', 'tenant.payment.post', true);
    INSERT INTO finance_payments(tenant_id, receipt_number, entry_kind, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (c.tenant_id, v_number, 'posted', v_amount, v_currency::finance_currency, 'cashier:' || c.idempotency_key, c.actor_id, clock_timestamp())
      RETURNING id INTO v_payment;
    v_left := v_amount;
    PERFORM set_config('app.finance_action', 'tenant.payment.allocate', true);
    FOR inv IN
      SELECT i.id, i.document_number, i.amount_minor - g.allocated_minor - g.credited_minor AS remaining
      FROM finance_invoices i
      JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
      JOIN operations_invoice_preparations p ON p.tenant_id = i.tenant_id AND p.finance_invoice_id = i.id AND p.posting_status = 'posted'
      JOIN operations_services s ON s.tenant_id = p.tenant_id AND s.id = p.service_id
      WHERE i.tenant_id = c.tenant_id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
        AND s.subscriber_id = sub.id AND i.currency::text = v_currency
        AND (v_invoice IS NULL OR i.id = v_invoice)
        AND i.amount_minor - g.allocated_minor - g.credited_minor > 0
      ORDER BY i.posted_at, i.id
      FOR UPDATE OF g
    LOOP
      EXIT WHEN v_left <= 0;
      n := n + 1;
      v_part := least(v_left, inv.remaining);
      INSERT INTO finance_payment_allocations(tenant_id, payment_id, invoice_id, entry_kind, amount_minor, currency, idempotency_key, actor_id, posted_at)
        VALUES (c.tenant_id, v_payment, inv.id, 'allocation', v_part, v_currency::finance_currency,
          'cashier:' || c.idempotency_key || ':alloc:' || n, c.actor_id, clock_timestamp())
        RETURNING id INTO v_allocation;
      allocations := allocations || jsonb_build_object('allocationId', v_allocation, 'invoiceId', inv.id,
        'documentNumber', inv.document_number, 'amountMinor', v_part);
      v_left := v_left - v_part;
    END LOOP;
    IF v_invoice IS NOT NULL AND n = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'the chosen invoice is not open for this subscriber in this currency';
    END IF;
    INSERT INTO operations_office_payment_requests(tenant_id, subscriber_id, finance_payment_id, branch_id, area_id, route_id,
        idempotency_key, receipt_number, amount_minor, currency, requested_by, method, reference, note, drawer_id)
      VALUES (c.tenant_id, sub.id, v_payment, sub.branch_id, sub.area_id, sub.route_id, 'cashier:' || c.idempotency_key,
        v_number, v_amount, v_currency::finance_currency, c.actor_id, v_method,
        nullif(btrim(coalesce(payload->>'reference', '')), ''), nullif(btrim(coalesce(payload->>'note', '')), ''), drawer.id)
      RETURNING * INTO receipt;
    answer := jsonb_build_object('receiptId', receipt.id, 'receiptNumber', v_number, 'paymentId', v_payment,
      'subscriberId', sub.id, 'subscriberName', sub.display_name, 'amountMinor', v_amount, 'currency', v_currency,
      'method', v_method, 'allocatedMinor', v_amount - v_left, 'unallocatedMinor', v_left,
      'allocations', allocations, 'drawerId', drawer.id, 'postedAt', receipt.requested_at);

  ELSIF v_action = 'void_receipt' THEN
    IF c.permission <> 'tenant.payment.reverse' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'voiding a receipt requires payment reversal authority';
    END IF;
    v_reason := nullif(btrim(coalesce(payload->>'reason', '')), '');
    IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 8 AND 1000 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a void reason of 8 to 1000 characters is required';
    END IF;
    SELECT * INTO receipt FROM operations_office_payment_requests WHERE tenant_id = c.tenant_id AND id = (payload->>'receiptId')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT operations_scope_allows_payment_request(c.tenant_id, receipt.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'receipt missing or outside scope';
    END IF;
    IF receipt.voided_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'receipt is already voided';
    END IF;
    IF receipt.drawer_id IS NOT NULL AND EXISTS (SELECT 1 FROM operations_cash_drawers d WHERE d.tenant_id = c.tenant_id AND d.id = receipt.drawer_id AND d.status = 'closed') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'receipt belongs to a closed drawer; post a correction instead';
    END IF;
    PERFORM set_config('app.finance_action', 'tenant.payment.allocation.reverse', true);
    FOR alloc IN
      SELECT a.id, a.invoice_id, a.amount_minor, a.currency
      FROM finance_payment_allocations a
      WHERE a.tenant_id = c.tenant_id AND a.payment_id = receipt.finance_payment_id AND a.entry_kind = 'allocation'
        AND NOT EXISTS (SELECT 1 FROM finance_payment_allocations r WHERE r.tenant_id = a.tenant_id AND r.reverses_allocation_id = a.id)
      ORDER BY a.posted_at, a.id
    LOOP
      n := n + 1;
      INSERT INTO finance_payment_allocations(tenant_id, payment_id, invoice_id, entry_kind, reverses_allocation_id, amount_minor, currency, idempotency_key, actor_id, posted_at)
        VALUES (c.tenant_id, receipt.finance_payment_id, alloc.invoice_id, 'reversal', alloc.id, alloc.amount_minor, alloc.currency,
          'cashier:' || c.idempotency_key || ':unalloc:' || n, c.actor_id, clock_timestamp());
    END LOOP;
    PERFORM set_config('app.finance_action', 'tenant.payment.reverse', true);
    INSERT INTO finance_payments(tenant_id, receipt_number, entry_kind, reverses_payment_id, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (c.tenant_id, receipt.receipt_number || '-VOID', 'reversal', receipt.finance_payment_id, receipt.amount_minor, receipt.currency,
        'cashier:' || c.idempotency_key, c.actor_id, clock_timestamp())
      RETURNING id INTO v_reversal;
    UPDATE operations_office_payment_requests SET voided_at = clock_timestamp(), void_reason = v_reason, void_payment_id = v_reversal
      WHERE tenant_id = c.tenant_id AND id = receipt.id RETURNING * INTO receipt;
    answer := jsonb_build_object('receiptId', receipt.id, 'receiptNumber', receipt.receipt_number, 'reversalPaymentId', v_reversal,
      'reversedAllocations', n, 'amountMinor', receipt.amount_minor, 'currency', receipt.currency, 'voidedAt', receipt.voided_at);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown cashier action';
  END IF;

  v_receipt_id := CASE WHEN v_action IN ('record_receipt', 'void_receipt') THEN receipt.id END;
  INSERT INTO operations_cashier_events(tenant_id, action, drawer_id, receipt_id, actor_id, idempotency_key, request_payload, result)
    VALUES (c.tenant_id, v_action, CASE WHEN v_action IN ('open_drawer', 'close_drawer') THEN drawer.id ELSE receipt.drawer_id END,
      v_receipt_id, c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_cashier_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_cashier_command(jsonb) TO orvex_runtime;

-- ---------------------------------------------------------------------------------------------
-- Cashier workspace reader
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION read_cashier_workspace(p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; day_start timestamptz; result jsonb; term text;
BEGIN
  c := cashier_context_or_raise('tenant.cashier.workspace.read', ARRAY['tenant.payment.view', 'tenant.payment.post']);
  day_start := date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Beirut') AT TIME ZONE 'Asia/Beirut';
  term := nullif(btrim(coalesce(p_search, '')), '');
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'drawers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'branchId', d.branch_id, 'branchName', b.name_en, 'branchNameAr', b.name_ar,
        'cashier', u.display_name, 'mine', d.cashier_user_id::text = c.actor_id, 'currency', d.currency, 'status', d.status,
        'openingFloatMinor', d.opening_float_minor,
        'cashReceiptsMinor', (SELECT coalesce(sum(r.amount_minor), 0) FROM operations_office_payment_requests r
            WHERE r.tenant_id = d.tenant_id AND r.drawer_id = d.id AND r.method = 'cash' AND r.voided_at IS NULL),
        'receipts', (SELECT count(*) FROM operations_office_payment_requests r WHERE r.tenant_id = d.tenant_id AND r.drawer_id = d.id AND r.voided_at IS NULL),
        'expectedMinor', d.expected_minor, 'countedMinor', d.counted_minor, 'varianceMinor', d.variance_minor,
        'openedAt', d.opened_at, 'closedAt', d.closed_at, 'closingNote', d.closing_note, 'version', d.version) ORDER BY d.status, d.opened_at DESC)
      FROM operations_cash_drawers d
      JOIN operations_branches b ON b.tenant_id = d.tenant_id AND b.id = d.branch_id
      JOIN users u ON u.id = d.cashier_user_id
      WHERE d.tenant_id = c.tenant_id AND operations_scope_allows(d.tenant_id, d.branch_id)
        AND (d.status = 'open' OR d.closed_at >= day_start - interval '7 days')), '[]'::jsonb),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'nameEn', b.name_en, 'nameAr', b.name_ar) ORDER BY b.name_en)
      FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND operations_scope_allows(b.tenant_id, b.id)), '[]'::jsonb),
    'today', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', t.currency, 'method', t.method, 'amountMinor', t.amount, 'receipts', t.receipts) ORDER BY t.currency, t.method)
      FROM (SELECT r.currency::text AS currency, r.method, sum(r.amount_minor) AS amount, count(*) AS receipts
            FROM operations_office_payment_requests r
            WHERE r.tenant_id = c.tenant_id AND r.requested_at >= day_start AND r.voided_at IS NULL
              AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.route_id, r.id)
            GROUP BY r.currency, r.method) t), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(item ORDER BY (item->>'postedAt') DESC) FROM (
      SELECT jsonb_build_object('id', r.id, 'receiptNumber', r.receipt_number, 'subscriberId', r.subscriber_id, 'subscriberName', s.display_name,
        'subscriberNumber', s.subscriber_number, 'amountMinor', r.amount_minor, 'currency', r.currency, 'method', r.method, 'reference', r.reference,
        'note', r.note, 'cashier', coalesce(u.display_name, r.requested_by), 'drawerId', r.drawer_id, 'postedAt', r.requested_at,
        'voidedAt', r.voided_at, 'voidReason', r.void_reason,
        'allocatedMinor', (SELECT coalesce(sum(CASE a.entry_kind WHEN 'allocation' THEN a.amount_minor ELSE -a.amount_minor END), 0)
            FROM finance_payment_allocations a WHERE a.tenant_id = r.tenant_id AND a.payment_id = r.finance_payment_id),
        'allocations', (SELECT coalesce(jsonb_agg(jsonb_build_object('invoiceId', a.invoice_id, 'documentNumber', i.document_number, 'amountMinor', a.amount_minor) ORDER BY a.posted_at), '[]'::jsonb)
            FROM finance_payment_allocations a JOIN finance_invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
            WHERE a.tenant_id = r.tenant_id AND a.payment_id = r.finance_payment_id AND a.entry_kind = 'allocation'
              AND NOT EXISTS (SELECT 1 FROM finance_payment_allocations x WHERE x.tenant_id = a.tenant_id AND x.reverses_allocation_id = a.id))) AS item
      FROM operations_office_payment_requests r
      JOIN operations_subscribers s ON s.tenant_id = r.tenant_id AND s.id = r.subscriber_id
      LEFT JOIN users u ON u.id::text = r.requested_by
      WHERE r.tenant_id = c.tenant_id AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.route_id, r.id)
      ORDER BY r.requested_at DESC LIMIT 100) rows), '[]'::jsonb),
    'subscribers', CASE WHEN term IS NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'subscriberNumber', s.subscriber_number, 'displayName', s.display_name, 'status', s.status::text,
        'branchName', b.name_en, 'branchNameAr', b.name_ar,
        'phone', (SELECT ct.contact_value FROM operations_contacts ct WHERE ct.tenant_id = s.tenant_id AND ct.subscriber_id = s.id
                    AND ct.contact_kind IN ('phone', 'whatsapp') AND ct.archived_at IS NULL ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1),
        'openInvoices', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'documentNumber', i.document_number, 'currency', i.currency,
              'amountMinor', i.amount_minor, 'remainingMinor', i.amount_minor - g.allocated_minor - g.credited_minor, 'postedAt', i.posted_at) ORDER BY i.posted_at), '[]'::jsonb)
            FROM finance_invoices i
            JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
            JOIN operations_invoice_preparations p ON p.tenant_id = i.tenant_id AND p.finance_invoice_id = i.id AND p.posting_status = 'posted'
            JOIN operations_services sv ON sv.tenant_id = p.tenant_id AND sv.id = p.service_id
            WHERE i.tenant_id = s.tenant_id AND sv.subscriber_id = s.id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
              AND i.amount_minor - g.allocated_minor - g.credited_minor > 0),
        'unallocated', (SELECT coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'amountMinor', x.amount)), '[]'::jsonb) FROM (
            SELECT pm.currency::text AS currency, sum(pm.amount_minor - gp.allocated_minor) AS amount
            FROM operations_office_payment_requests r
            JOIN finance_payments pm ON pm.tenant_id = r.tenant_id AND pm.id = r.finance_payment_id
            JOIN finance_document_guards gp ON gp.tenant_id = pm.tenant_id AND gp.document_type = 'payment' AND gp.document_id = pm.id
            WHERE r.tenant_id = s.tenant_id AND r.subscriber_id = s.id AND r.voided_at IS NULL AND gp.reversed_at IS NULL
              AND pm.amount_minor - gp.allocated_minor > 0 GROUP BY pm.currency) x)) ORDER BY s.display_name)
      FROM (SELECT s.* FROM operations_subscribers s
            WHERE s.tenant_id = c.tenant_id AND operations_scope_allows_subscriber(s.tenant_id, s.id)
              AND (s.subscriber_number ILIKE '%' || term || '%' OR s.display_name ILIKE '%' || term || '%'
                   OR EXISTS (SELECT 1 FROM operations_contacts ct WHERE ct.tenant_id = s.tenant_id AND ct.subscriber_id = s.id AND ct.contact_value ILIKE '%' || term || '%'))
            ORDER BY s.display_name LIMIT 12) s
      JOIN operations_branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_cashier_workspace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_cashier_workspace(text) TO orvex_runtime;

-- ---------------------------------------------------------------------------------------------
-- Collection commands
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION execute_collection_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_collection_events%ROWTYPE;
  a operations_collector_assignments%ROWTYPE;
  st operations_route_settlements%ROWTYPE;
  rc operations_route_collectors%ROWTYPE;
  inv record;
  v_action text; answer jsonb; v_route uuid; v_collector uuid; v_due date; v_reason text;
  v_open bigint; v_amount bigint; v_number text; v_payment uuid; v_allocation uuid; v_evidence uuid; v_currency text;
  v_expected bigint; v_declared bigint; v_status text; n integer := 0;
  manage boolean; post boolean;
BEGIN
  c := cashier_context_or_raise('tenant.collection.manage', ARRAY['tenant.collection.reconcile', 'tenant.payment.post']);
  manage := c.permission = 'tenant.collection.reconcile';
  post := c.permission = 'tenant.payment.post';
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid collection payload';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':collections:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_collection_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collection retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;
  PERFORM accounting_lock_financial_request();

  IF v_action = 'assign_route_collector' THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'route collectors require collection management authority'; END IF;
    v_route := (payload->>'routeId')::uuid;
    v_collector := (payload->>'collectorUserId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM operations_routes r WHERE r.tenant_id = c.tenant_id AND r.id = v_route AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'route missing or outside scope';
    END IF;
    IF v_collector IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_collector AND m.active
        AND ('tenant.collection.view' = ANY(m.permissions) OR m.role_key = 'collector')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector must be an active member with collection authority';
    END IF;
    UPDATE operations_route_collectors SET active = false, ended_at = clock_timestamp()
      WHERE tenant_id = c.tenant_id AND route_id = v_route AND active AND collector_user_id IS DISTINCT FROM v_collector;
    IF v_collector IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_route_collectors x WHERE x.tenant_id = c.tenant_id AND x.route_id = v_route AND x.active) THEN
      INSERT INTO operations_route_collectors(tenant_id, route_id, collector_user_id, assigned_by)
        VALUES (c.tenant_id, v_route, v_collector, c.actor_id::uuid) RETURNING * INTO rc;
    END IF;
    answer := jsonb_build_object('routeId', v_route, 'collectorUserId', v_collector);

  ELSIF v_action IN ('assign_invoice', 'assign_route_due') THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'assignments require collection management authority'; END IF;
    v_due := (payload->>'dueOn')::date;
    IF v_due IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a due date is required'; END IF;
    answer := '[]'::jsonb;
    FOR inv IN
      SELECT i.id AS invoice_id, i.document_number, i.currency::text AS currency, sv.subscriber_id, sv.route_id,
        i.amount_minor - g.allocated_minor - g.credited_minor AS remaining,
        (SELECT x.collector_user_id FROM operations_route_collectors x WHERE x.tenant_id = sv.tenant_id AND x.route_id = sv.route_id AND x.active) AS route_collector
      FROM finance_invoices i
      JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
      JOIN operations_invoice_preparations p ON p.tenant_id = i.tenant_id AND p.finance_invoice_id = i.id AND p.posting_status = 'posted'
      JOIN operations_services sv ON sv.tenant_id = p.tenant_id AND sv.id = p.service_id
      WHERE i.tenant_id = c.tenant_id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
        AND i.amount_minor - g.allocated_minor - g.credited_minor > 0
        AND ((v_action = 'assign_invoice' AND i.id = (payload->>'invoiceId')::uuid)
          OR (v_action = 'assign_route_due' AND sv.route_id = (payload->>'routeId')::uuid))
        AND operations_scope_allows_route(sv.tenant_id, sv.route_id, sv.id)
        AND NOT EXISTS (SELECT 1 FROM operations_collector_assignments x WHERE x.tenant_id = i.tenant_id AND x.finance_invoice_id = i.id)
      ORDER BY i.posted_at, i.id
    LOOP
      v_collector := coalesce((payload->>'collectorUserId')::uuid, inv.route_collector);
      IF v_collector IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'no collector given and the route has no default collector';
      END IF;
      n := n + 1;
      INSERT INTO operations_collector_assignments(tenant_id, collector_user_id, subscriber_id, route_id, route_reference,
          finance_invoice_id, due_on, expected_amount_minor, currency, idempotency_key)
        SELECT c.tenant_id, v_collector, inv.subscriber_id, r.id, r.code, inv.invoice_id, v_due, inv.remaining, inv.currency::finance_currency,
          'collections:' || c.idempotency_key || ':' || n
        FROM operations_routes r WHERE r.tenant_id = c.tenant_id AND r.id = inv.route_id
        RETURNING * INTO a;
      answer := answer || jsonb_build_object('assignmentId', a.id, 'invoiceId', inv.invoice_id, 'documentNumber', inv.document_number,
        'expectedMinor', a.expected_amount_minor, 'currency', a.currency, 'collectorUserId', v_collector);
    END LOOP;
    IF v_action = 'assign_invoice' AND n = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'invoice is not open, is outside scope, or is already assigned';
    END IF;
    answer := jsonb_build_object('assigned', n, 'assignments', answer);

  ELSIF v_action = 'reassign' THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'reassignment requires collection management authority'; END IF;
    SELECT * INTO a FROM operations_collector_assignments WHERE tenant_id = c.tenant_id AND id = (payload->>'assignmentId')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT operations_scope_allows_route(c.tenant_id, a.route_id, a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'assignment missing or outside scope';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_collector_collection_evidence e WHERE e.tenant_id = c.tenant_id AND e.assignment_id = a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collected assignments cannot be reassigned';
    END IF;
    v_collector := coalesce((payload->>'collectorUserId')::uuid, a.collector_user_id);
    IF NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_collector AND m.active) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'collector must be an active member';
    END IF;
    UPDATE operations_collector_assignments SET collector_user_id = v_collector, due_on = coalesce((payload->>'dueOn')::date, due_on), status = 'assigned'
      WHERE tenant_id = c.tenant_id AND id = a.id RETURNING * INTO a;
    answer := jsonb_build_object('assignmentId', a.id, 'collectorUserId', a.collector_user_id, 'dueOn', a.due_on, 'status', a.status);

  ELSIF v_action IN ('mark_visited', 'mark_returned', 'cancel_assignment') THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'assignment outcomes require collection management authority'; END IF;
    SELECT * INTO a FROM operations_collector_assignments WHERE tenant_id = c.tenant_id AND id = (payload->>'assignmentId')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT operations_scope_allows_route(c.tenant_id, a.route_id, a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'assignment missing or outside scope';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_collector_collection_evidence e WHERE e.tenant_id = c.tenant_id AND e.assignment_id = a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'assignment already has collection evidence';
    END IF;
    IF a.status = 'cancelled' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'assignment is cancelled'; END IF;
    v_reason := nullif(btrim(coalesce(payload->>'reason', '')), '');
    IF v_action = 'cancel_assignment' AND (v_reason IS NULL OR length(v_reason) < 8) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'cancelling needs a reason of at least 8 characters';
    END IF;
    UPDATE operations_collector_assignments SET status = CASE v_action WHEN 'mark_visited' THEN 'visited' WHEN 'mark_returned' THEN 'returned' ELSE 'cancelled' END
      WHERE tenant_id = c.tenant_id AND id = a.id RETURNING * INTO a;
    answer := jsonb_build_object('assignmentId', a.id, 'status', a.status);

  ELSIF v_action = 'record_collection' THEN
    IF NOT post THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'recording a collection requires payment posting authority'; END IF;
    SELECT * INTO a FROM operations_collector_assignments WHERE tenant_id = c.tenant_id AND id = (payload->>'assignmentId')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT operations_scope_allows_route(c.tenant_id, a.route_id, a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'assignment missing or outside scope';
    END IF;
    IF a.status NOT IN ('assigned', 'visited', 'returned')
       OR EXISTS (SELECT 1 FROM operations_collector_collection_evidence e WHERE e.tenant_id = c.tenant_id AND e.assignment_id = a.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'assignment is not payable';
    END IF;
    v_open := cashier_invoice_open_minor(c.tenant_id, a.finance_invoice_id);
    IF v_open IS NULL OR v_open <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'the assigned invoice has no open balance';
    END IF;
    v_amount := coalesce((payload->>'amountMinor')::bigint, v_open);
    IF v_amount <= 0 OR v_amount > v_open THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'collected amount must be positive and at most the open balance';
    END IF;
    v_currency := a.currency::text;
    v_number := nullif(btrim(coalesce(payload->>'receiptNumber', '')), '');
    IF v_number IS NULL THEN
      v_number := operations_next_document_number(c.tenant_id, 'collector_receipt', 'CR');
    ELSIF length(v_number) > 120 OR EXISTS (SELECT 1 FROM finance_payments p WHERE p.tenant_id = c.tenant_id AND p.receipt_number = v_number) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'receipt number is already used';
    END IF;
    PERFORM set_config('app.finance_action', 'tenant.payment.post', true);
    INSERT INTO finance_payments(tenant_id, receipt_number, entry_kind, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (c.tenant_id, v_number, 'posted', v_amount, v_currency::finance_currency, 'collections:' || c.idempotency_key, c.actor_id, clock_timestamp())
      RETURNING id INTO v_payment;
    PERFORM set_config('app.finance_action', 'tenant.payment.allocate', true);
    INSERT INTO finance_payment_allocations(tenant_id, payment_id, invoice_id, entry_kind, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (c.tenant_id, v_payment, a.finance_invoice_id, 'allocation', v_amount, v_currency::finance_currency,
        'collections:' || c.idempotency_key || ':alloc', c.actor_id, clock_timestamp())
      RETURNING id INTO v_allocation;
    INSERT INTO operations_collector_collection_evidence(tenant_id, assignment_id, finance_payment_id, amount_minor, currency, recorded_by, idempotency_key)
      VALUES (c.tenant_id, a.id, v_payment, v_amount, v_currency::finance_currency, c.actor_id, 'collections:' || c.idempotency_key)
      RETURNING id INTO v_evidence;
    answer := jsonb_build_object('assignmentId', a.id, 'evidenceId', v_evidence, 'paymentId', v_payment, 'allocationId', v_allocation,
      'receiptNumber', v_number, 'amountMinor', v_amount, 'currency', v_currency, 'remainingMinor', v_open - v_amount);

  ELSIF v_action = 'settle_route' THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'settlements require collection management authority'; END IF;
    v_route := (payload->>'routeId')::uuid;
    v_collector := (payload->>'collectorUserId')::uuid;
    v_due := (payload->>'businessDate')::date;
    v_currency := payload->>'currency';
    v_declared := (payload->>'declaredMinor')::bigint;
    v_reason := nullif(btrim(coalesce(payload->>'reason', '')), '');
    IF v_route IS NULL OR v_collector IS NULL OR v_due IS NULL OR v_currency NOT IN ('USD', 'LBP') OR v_declared IS NULL OR v_declared < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'settlement needs route, collector, business date, currency and declared cash';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM operations_routes r WHERE r.tenant_id = c.tenant_id AND r.id = v_route AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'route missing or outside scope';
    END IF;
    SELECT coalesce(sum(e.amount_minor), 0) INTO v_expected
      FROM operations_collector_collection_evidence e
      JOIN operations_collector_assignments x ON x.tenant_id = e.tenant_id AND x.id = e.assignment_id
      WHERE e.tenant_id = c.tenant_id AND x.collector_user_id = v_collector AND x.route_id = v_route AND e.currency::text = v_currency
        AND e.recorded_at >= v_due AND e.recorded_at < v_due + 1;
    v_status := CASE WHEN v_declared = v_expected THEN 'accepted' ELSE 'pending_approval' END;
    IF v_status <> 'accepted' AND (v_reason IS NULL OR length(v_reason) < 8) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a difference between declared and expected cash needs a reason';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_route_settlements s WHERE s.tenant_id = c.tenant_id AND s.collector_user_id = v_collector
                 AND s.route_id = v_route AND s.business_date = v_due AND s.currency = v_currency) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'this route, collector, day and currency are already settled';
    END IF;
    INSERT INTO operations_route_settlements(tenant_id, collector_user_id, route_id, business_date, currency, expected_minor, declared_minor, status, reason, settled_by)
      VALUES (c.tenant_id, v_collector, v_route, v_due, v_currency, v_expected, v_declared, v_status, v_reason, c.actor_id::uuid)
      RETURNING * INTO st;
    answer := jsonb_build_object('settlementId', st.id, 'status', st.status, 'expectedMinor', st.expected_minor, 'declaredMinor', st.declared_minor,
      'differenceMinor', st.difference_minor, 'currency', st.currency, 'version', st.version);

  ELSIF v_action = 'approve_settlement' THEN
    IF NOT manage THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'approval requires collection management authority'; END IF;
    v_reason := nullif(btrim(coalesce(payload->>'reason', '')), '');
    IF v_reason IS NULL OR length(v_reason) < 8 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'approval needs a reason of at least 8 characters';
    END IF;
    SELECT * INTO st FROM operations_route_settlements WHERE tenant_id = c.tenant_id AND id = (payload->>'settlementId')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM operations_routes r WHERE r.tenant_id = c.tenant_id AND r.id = st.route_id AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'settlement missing or outside scope';
    END IF;
    IF st.status <> 'pending_approval' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'settlement is not awaiting approval'; END IF;
    IF st.settled_by::text = c.actor_id OR st.collector_user_id::text = c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'a different manager must approve the difference';
    END IF;
    IF st.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'settlement changed since it was read';
    END IF;
    UPDATE operations_route_settlements SET status = 'approved', approved_by = c.actor_id::uuid, approved_at = clock_timestamp(),
      approval_reason = v_reason, version = version + 1 WHERE tenant_id = c.tenant_id AND id = st.id RETURNING * INTO st;
    answer := jsonb_build_object('settlementId', st.id, 'status', st.status, 'version', st.version);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown collection action';
  END IF;

  INSERT INTO operations_collection_events(tenant_id, action, assignment_id, settlement_id, route_id, actor_id, idempotency_key, request_payload, result)
    VALUES (c.tenant_id, v_action, CASE WHEN v_action IN ('reassign', 'mark_visited', 'mark_returned', 'cancel_assignment', 'record_collection') THEN a.id END,
      st.id, coalesce(v_route, a.route_id, st.route_id), c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_collection_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_collection_command(jsonb) TO orvex_runtime;

-- ---------------------------------------------------------------------------------------------
-- Collections workspace reader
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION read_collections_workspace(p_day date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; d date; result jsonb;
BEGIN
  c := cashier_context_or_raise('tenant.collections.workspace.read', ARRAY['tenant.collection.view', 'tenant.collection.reconcile', 'tenant.payment.post']);
  d := coalesce(p_day, (clock_timestamp() AT TIME ZONE 'Asia/Beirut')::date);
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(),
    'day', d,
    'collectors', coalesce((SELECT jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', u.display_name, 'roleKey', m.role_key, 'active', m.active,
        'routes', (SELECT count(*) FROM operations_route_collectors x WHERE x.tenant_id = m.tenant_id AND x.collector_user_id = m.user_id AND x.active),
        'openAssignments', (SELECT count(*) FROM operations_collector_assignments x WHERE x.tenant_id = m.tenant_id AND x.collector_user_id = m.user_id
            AND x.status IN ('assigned', 'visited', 'returned')
            AND NOT EXISTS (SELECT 1 FROM operations_collector_collection_evidence e WHERE e.tenant_id = x.tenant_id AND e.assignment_id = x.id)),
        'devices', (SELECT count(*) FROM collect_devices dv WHERE dv.tenant_id = m.tenant_id AND dv.collector_user_id = m.user_id AND dv.status = 'active'),
        'lastSeenAt', (SELECT max(dv.last_seen_at) FROM collect_devices dv WHERE dv.tenant_id = m.tenant_id AND dv.collector_user_id = m.user_id)) ORDER BY u.display_name)
      FROM tenant_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = c.tenant_id AND m.active AND ('tenant.collection.view' = ANY(m.permissions) OR m.role_key = 'collector')), '[]'::jsonb),
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'nameEn', r.name_en, 'nameAr', r.name_ar, 'active', r.active,
        'branchId', r.branch_id, 'collectorUserId', rc.collector_user_id, 'collectorName', cu.display_name,
        'openAssignments', (SELECT count(*) FROM operations_collector_assignments x WHERE x.tenant_id = r.tenant_id AND x.route_id = r.id
            AND x.status IN ('assigned', 'visited', 'returned')
            AND NOT EXISTS (SELECT 1 FROM operations_collector_collection_evidence e WHERE e.tenant_id = x.tenant_id AND e.assignment_id = x.id)),
        'unassignedInvoices', (SELECT count(*) FROM finance_invoices i
            JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
            JOIN operations_invoice_preparations p ON p.tenant_id = i.tenant_id AND p.finance_invoice_id = i.id AND p.posting_status = 'posted'
            JOIN operations_services sv ON sv.tenant_id = p.tenant_id AND sv.id = p.service_id
            WHERE i.tenant_id = r.tenant_id AND sv.route_id = r.id AND i.entry_kind = 'posted' AND g.reversed_at IS NULL
              AND i.amount_minor - g.allocated_minor - g.credited_minor > 0
              AND NOT EXISTS (SELECT 1 FROM operations_collector_assignments x WHERE x.tenant_id = i.tenant_id AND x.finance_invoice_id = i.id))) ORDER BY r.code)
      FROM operations_routes r
      LEFT JOIN operations_route_collectors rc ON rc.tenant_id = r.tenant_id AND rc.route_id = r.id AND rc.active
      LEFT JOIN users cu ON cu.id = rc.collector_user_id
      WHERE r.tenant_id = c.tenant_id AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)), '[]'::jsonb),
    'assignments', coalesce((SELECT jsonb_agg(item ORDER BY (item->>'dueOn'), (item->>'subscriberName')) FROM (
      SELECT jsonb_build_object('id', x.id, 'subscriberId', x.subscriber_id, 'subscriberName', s.display_name, 'subscriberNumber', s.subscriber_number,
        'routeId', x.route_id, 'routeCode', x.route_reference, 'collectorUserId', x.collector_user_id, 'collectorName', cu.display_name,
        'invoiceId', x.finance_invoice_id, 'documentNumber', i.document_number, 'dueOn', x.due_on, 'expectedMinor', x.expected_amount_minor,
        'openMinor', greatest(cashier_invoice_open_minor(x.tenant_id, x.finance_invoice_id), 0), 'currency', x.currency,
        'status', CASE WHEN e.id IS NOT NULL THEN 'collected' ELSE x.status END,
        'collectedMinor', e.amount_minor, 'collectedAt', e.recorded_at, 'receiptNumber', pm.receipt_number,
        'phone', (SELECT ct.contact_value FROM operations_contacts ct WHERE ct.tenant_id = s.tenant_id AND ct.subscriber_id = s.id
                    AND ct.contact_kind IN ('phone', 'whatsapp') AND ct.archived_at IS NULL ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1),
        'assignedAt', x.assigned_at) AS item
      FROM operations_collector_assignments x
      JOIN operations_subscribers s ON s.tenant_id = x.tenant_id AND s.id = x.subscriber_id
      JOIN finance_invoices i ON i.tenant_id = x.tenant_id AND i.id = x.finance_invoice_id
      LEFT JOIN users cu ON cu.id = x.collector_user_id
      LEFT JOIN operations_collector_collection_evidence e ON e.tenant_id = x.tenant_id AND e.assignment_id = x.id
      LEFT JOIN finance_payments pm ON pm.tenant_id = e.tenant_id AND pm.id = e.finance_payment_id
      WHERE x.tenant_id = c.tenant_id AND operations_scope_allows_route(x.tenant_id, x.route_id, x.id)
        AND ((e.id IS NULL AND x.status IN ('assigned', 'visited', 'returned') AND x.due_on <= d + 7)
          OR (e.id IS NOT NULL AND e.recorded_at >= d - 7)
          OR (x.status = 'cancelled' AND x.assigned_at >= d - 7))
      ORDER BY x.due_on, s.display_name LIMIT 500) rows), '[]'::jsonb),
    'settlements', coalesce((SELECT jsonb_agg(item ORDER BY (item->>'settledAt') DESC) FROM (
      SELECT jsonb_build_object('id', s.id, 'source', 'office', 'routeId', s.route_id, 'routeCode', r.code, 'collectorUserId', s.collector_user_id,
        'collectorName', cu.display_name, 'businessDate', s.business_date, 'currency', s.currency, 'expectedMinor', s.expected_minor,
        'declaredMinor', s.declared_minor, 'differenceMinor', s.difference_minor, 'status', s.status, 'reason', s.reason,
        'settledBy', sb.display_name, 'settledAt', s.settled_at, 'approvedBy', ab.display_name, 'approvedAt', s.approved_at,
        'approvalReason', s.approval_reason, 'version', s.version) AS item
      FROM operations_route_settlements s
      JOIN operations_routes r ON r.tenant_id = s.tenant_id AND r.id = s.route_id
      LEFT JOIN users cu ON cu.id = s.collector_user_id LEFT JOIN users sb ON sb.id = s.settled_by LEFT JOIN users ab ON ab.id = s.approved_by
      WHERE s.tenant_id = c.tenant_id AND s.business_date >= d - 30 AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)
      UNION ALL
      SELECT jsonb_build_object('id', s.id, 'source', 'device', 'routeId', s.route_id, 'routeCode', r.code, 'collectorUserId', s.collector_user_id,
        'collectorName', cu.display_name, 'businessDate', s.business_date, 'currency', s.currency::text, 'expectedMinor', s.server_expected_minor,
        'declaredMinor', s.declared_minor, 'differenceMinor', s.difference_minor, 'status', s.status::text, 'reason', NULL,
        'settledBy', cu.display_name, 'settledAt', s.submitted_at, 'approvedBy', ab.display_name, 'approvedAt', ap.approved_at,
        'approvalReason', ap.reason, 'version', 1)
      FROM collect_reconciliation_submissions s
      JOIN operations_routes r ON r.tenant_id = s.tenant_id AND r.id = s.route_id
      LEFT JOIN collect_reconciliation_approvals ap ON ap.tenant_id = s.tenant_id AND ap.reconciliation_id = s.id
      LEFT JOIN users cu ON cu.id = s.collector_user_id LEFT JOIN users ab ON ab.id = ap.approver_user_id
      WHERE s.tenant_id = c.tenant_id AND s.business_date >= d - 30 AND operations_scope_allows(r.tenant_id, r.branch_id, r.area_id, r.id, r.id)
      ) rows), '[]'::jsonb),
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', dv.id, 'label', dv.device_label, 'collectorUserId', dv.collector_user_id,
        'collectorName', cu.display_name, 'status', dv.status::text, 'lastSeenAt', dv.last_seen_at, 'authorizedAt', dv.authorized_at,
        'lastSequence', dv.last_sequence, 'revokedAt', dv.revoked_at) ORDER BY dv.status, dv.last_seen_at DESC NULLS LAST)
      FROM collect_devices dv LEFT JOIN users cu ON cu.id = dv.collector_user_id
      WHERE dv.tenant_id = c.tenant_id AND (dv.status = 'active' OR dv.authorized_at >= clock_timestamp() - interval '30 days')), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_collections_workspace(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_collections_workspace(date) TO orvex_runtime;
