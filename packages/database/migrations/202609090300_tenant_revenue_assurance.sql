-- 202609090300_tenant_revenue_assurance.sql
-- Revenue assurance: deterministic leakage controls evaluated from the tenant's own records
-- (services, invoices, payments, allocations, vouchers, collectors, dealers), findings with an
-- exposure amount per currency that persist across runs, and exposure cases with ownership,
-- lifecycle and closure evidence. Controls read; they never post or reverse money.

CREATE TABLE operations_assurance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (tenant_id, id)
);
CREATE INDEX assurance_runs_idx ON operations_assurance_runs(tenant_id, started_at DESC, id);

CREATE TABLE operations_assurance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_number text NOT NULL,
  title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 3 AND 200),
  title_ar text NOT NULL CHECK (length(btrim(title_ar)) BETWEEN 3 AND 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'written_off')),
  owner_user_id uuid REFERENCES users(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  resolution_en text CHECK (resolution_en IS NULL OR length(btrim(resolution_en)) BETWEEN 8 AND 2000),
  resolution_ar text CHECK (resolution_ar IS NULL OR length(btrim(resolution_ar)) BETWEEN 8 AND 2000),
  resolution_evidence text CHECK (resolution_evidence IS NULL OR length(btrim(resolution_evidence)) BETWEEN 8 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, case_number),
  CHECK ((status IN ('resolved', 'written_off')) = (closed_at IS NOT NULL)),
  CHECK (status NOT IN ('resolved', 'written_off') OR (resolution_en IS NOT NULL AND resolution_ar IS NOT NULL AND resolution_evidence IS NOT NULL))
);
CREATE INDEX assurance_cases_idx ON operations_assurance_cases(tenant_id, status, opened_at DESC, id);

CREATE TABLE operations_assurance_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  control_code text NOT NULL CHECK (control_code ~ '^[A-Z0-9_]{3,40}$'),
  subject_type text NOT NULL CHECK (subject_type IN ('service', 'invoice', 'payment', 'redemption', 'reconciliation', 'dealer')),
  subject_id uuid NOT NULL,
  subject_reference text NOT NULL,
  subscriber_id uuid,
  branch_id uuid,
  area_id uuid,
  route_id uuid,
  currency text CHECK (currency IS NULL OR currency IN ('USD', 'LBP')),
  exposure_minor bigint NOT NULL DEFAULT 0 CHECK (exposure_minor >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'cleared')),
  acknowledgement_note text CHECK (acknowledgement_note IS NULL OR length(acknowledgement_note) <= 1000),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  case_id uuid,
  first_seen_run_id uuid NOT NULL,
  last_seen_run_id uuid NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_at timestamptz,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, control_code, subject_type, subject_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES operations_assurance_cases(tenant_id, id),
  FOREIGN KEY (tenant_id, first_seen_run_id) REFERENCES operations_assurance_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, last_seen_run_id) REFERENCES operations_assurance_runs(tenant_id, id),
  CHECK ((status = 'cleared') = (cleared_at IS NOT NULL)),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CHECK (NOT operations_json_contains_secret_key(details))
);
CREATE INDEX assurance_findings_live_idx ON operations_assurance_findings(tenant_id, status, control_code, exposure_minor DESC);
CREATE INDEX assurance_findings_case_idx ON operations_assurance_findings(tenant_id, case_id) WHERE case_id IS NOT NULL;

CREATE TABLE operations_assurance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('operations_assurance_runs', 'operations_assurance_findings', 'operations_assurance_cases')),
  resource_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

-- Row security: findings bound to a branch/area/route follow the standard scope predicate; unscoped
-- findings, runs and cases are tenant-wide. Support grants cannot read assurance data.
CREATE FUNCTION assurance_context_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM operations_current_context() c
    WHERE c.tenant_id = target_tenant AND c.support_grant_id IS NULL
      AND c.permission IN ('tenant.billing.view', 'tenant.collection.reconcile', 'tenant.accounting.view', 'tenant.report.view'))
$$;
REVOKE ALL ON FUNCTION assurance_context_allows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assurance_context_allows(uuid) TO orvex_runtime;

ALTER TABLE operations_assurance_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_assurance_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY assurance_runs_scope ON operations_assurance_runs
  USING (assurance_context_allows(tenant_id)) WITH CHECK (assurance_context_allows(tenant_id));
ALTER TABLE operations_assurance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_assurance_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY assurance_cases_scope ON operations_assurance_cases
  USING (assurance_context_allows(tenant_id)) WITH CHECK (assurance_context_allows(tenant_id));
ALTER TABLE operations_assurance_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_assurance_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY assurance_findings_scope ON operations_assurance_findings
  USING (assurance_context_allows(tenant_id)
    AND (branch_id IS NULL OR operations_scope_allows(tenant_id, branch_id, area_id, route_id, NULL)))
  WITH CHECK (assurance_context_allows(tenant_id));
ALTER TABLE operations_assurance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_assurance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY assurance_events_scope ON operations_assurance_events
  USING (assurance_context_allows(tenant_id)) WITH CHECK (assurance_context_allows(tenant_id));

REVOKE ALL ON operations_assurance_runs, operations_assurance_cases, operations_assurance_findings, operations_assurance_events
  FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_assurance_runs, operations_assurance_cases, operations_assurance_findings, operations_assurance_events
  TO orvex_runtime;

CREATE TRIGGER assurance_events_immutable BEFORE UPDATE OR DELETE ON operations_assurance_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER assurance_events_no_truncate BEFORE TRUNCATE ON operations_assurance_events
  FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER assurance_runs_no_delete BEFORE DELETE ON operations_assurance_runs
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER assurance_findings_no_delete BEFORE DELETE ON operations_assurance_findings
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER assurance_cases_no_delete BEFORE DELETE ON operations_assurance_cases
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- One observed condition: insert or refresh the finding and return whether it is new.
CREATE FUNCTION assurance_observe(p_tenant uuid, p_run uuid, p_control text, p_subject_type text, p_subject uuid,
  p_reference text, p_subscriber uuid, p_branch uuid, p_area uuid, p_route uuid, p_currency text, p_exposure bigint,
  p_details jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE existing operations_assurance_findings%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM operations_assurance_findings
   WHERE tenant_id = p_tenant AND control_code = p_control AND subject_type = p_subject_type AND subject_id = p_subject FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO operations_assurance_findings(tenant_id, control_code, subject_type, subject_id, subject_reference, subscriber_id,
      branch_id, area_id, route_id, currency, exposure_minor, details, first_seen_run_id, last_seen_run_id)
    VALUES (p_tenant, p_control, p_subject_type, p_subject, p_reference, p_subscriber, p_branch, p_area, p_route, p_currency,
      greatest(0, coalesce(p_exposure, 0)), coalesce(p_details, '{}'::jsonb), p_run, p_run);
    RETURN true;
  END IF;
  UPDATE operations_assurance_findings SET
    subject_reference = p_reference, subscriber_id = p_subscriber, branch_id = p_branch, area_id = p_area, route_id = p_route,
    currency = p_currency, exposure_minor = greatest(0, coalesce(p_exposure, 0)), details = coalesce(p_details, '{}'::jsonb),
    last_seen_run_id = p_run, last_seen_at = clock_timestamp(),
    -- A condition that was cleared and comes back reopens; resolved and acknowledged states are kept.
    status = CASE WHEN existing.status = 'cleared' THEN 'open' ELSE existing.status END,
    cleared_at = CASE WHEN existing.status = 'cleared' THEN NULL ELSE existing.cleared_at END,
    version = existing.version + 1
   WHERE tenant_id = p_tenant AND id = existing.id;
  RETURN existing.status = 'cleared';
END $$;

-- Evaluate every control for one run and return the per-control summary.
CREATE FUNCTION assurance_evaluate(p_tenant uuid, p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r record; summary jsonb := '[]'::jsonb; v_count integer; v_new integer; v_usd bigint; v_lbp bigint;
  code text; codes text[] := ARRAY['ACTIVE_NOT_BILLED', 'BILLED_AFTER_TERMINATION', 'INVOICE_OVERDUE_60', 'PAYMENT_UNALLOCATED_7',
    'DUPLICATE_PAYMENT_SAME_DAY', 'VOUCHER_CREDIT_PENDING', 'COLLECTOR_VARIANCE_30', 'DEALER_OVER_LIMIT'];
BEGIN
  -- 1. Active services with no posted invoice in the last 35 days.
  FOR r IN SELECT s.id, s.service_number, s.subscriber_id, s.branch_id, s.area_id, s.route_id, p.currency, p.recurring_amount_minor,
      (SELECT max(ip.created_at) FROM operations_invoice_preparations ip WHERE ip.tenant_id = s.tenant_id AND ip.service_id = s.id AND ip.posting_status = 'posted') AS last_billed
    FROM operations_services s JOIN operations_plans p ON p.tenant_id = s.tenant_id AND p.id = s.plan_id
    WHERE s.tenant_id = p_tenant AND s.status = 'active' AND s.activated_at < clock_timestamp() - interval '35 days'
      AND NOT EXISTS (SELECT 1 FROM operations_invoice_preparations ip WHERE ip.tenant_id = s.tenant_id AND ip.service_id = s.id
        AND ip.posting_status = 'posted' AND ip.created_at > clock_timestamp() - interval '35 days')
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'ACTIVE_NOT_BILLED', 'service', r.id, r.service_number, r.subscriber_id, r.branch_id, r.area_id,
      r.route_id, r.currency::text, r.recurring_amount_minor, jsonb_build_object('lastBilledAt', r.last_billed));
  END LOOP;
  -- 2. Posted invoices raised after the service was terminated.
  FOR r IN SELECT s.id, s.service_number, s.subscriber_id, s.branch_id, s.area_id, s.route_id, ip.currency, ip.total_minor, i.document_number, s.terminated_at
    FROM operations_services s JOIN operations_invoice_preparations ip ON ip.tenant_id = s.tenant_id AND ip.service_id = s.id AND ip.posting_status = 'posted'
    JOIN finance_invoices i ON i.tenant_id = ip.tenant_id AND i.id = ip.finance_invoice_id
    WHERE s.tenant_id = p_tenant AND s.status = 'terminated' AND ip.created_at > s.terminated_at
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'BILLED_AFTER_TERMINATION', 'service', r.id, r.service_number, r.subscriber_id, r.branch_id, r.area_id,
      r.route_id, r.currency::text, r.total_minor, jsonb_build_object('invoiceNumber', r.document_number, 'terminatedAt', r.terminated_at));
  END LOOP;
  -- 3. Posted invoices older than 60 days with an unpaid remainder.
  FOR r IN SELECT i.id, i.document_number, i.currency, i.posted_at, i.amount_minor - g.allocated_minor - g.credited_minor AS remaining,
      s.subscriber_id, s.branch_id, s.area_id, s.route_id, s.service_number
    FROM finance_invoices i JOIN finance_document_guards g ON g.tenant_id = i.tenant_id AND g.document_type = 'invoice' AND g.document_id = i.id
    LEFT JOIN operations_invoice_preparations ip ON ip.tenant_id = i.tenant_id AND ip.finance_invoice_id = i.id
    LEFT JOIN operations_services s ON s.tenant_id = ip.tenant_id AND s.id = ip.service_id
    WHERE i.tenant_id = p_tenant AND i.entry_kind = 'posted' AND g.reversed_at IS NULL AND i.posted_at < clock_timestamp() - interval '60 days'
      AND i.amount_minor - g.allocated_minor - g.credited_minor > 0
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'INVOICE_OVERDUE_60', 'invoice', r.id, r.document_number, r.subscriber_id, r.branch_id, r.area_id,
      r.route_id, r.currency::text, r.remaining, jsonb_build_object('postedAt', r.posted_at, 'serviceNumber', r.service_number));
  END LOOP;
  -- 4. Posted payments older than 7 days that are not fully allocated.
  FOR r IN SELECT p.id, p.receipt_number, p.currency, p.posted_at, p.amount_minor - g.allocated_minor AS unallocated
    FROM finance_payments p JOIN finance_document_guards g ON g.tenant_id = p.tenant_id AND g.document_type = 'payment' AND g.document_id = p.id
    WHERE p.tenant_id = p_tenant AND p.entry_kind = 'posted' AND g.reversed_at IS NULL AND p.posted_at < clock_timestamp() - interval '7 days'
      AND p.amount_minor - g.allocated_minor > 0
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'PAYMENT_UNALLOCATED_7', 'payment', r.id, r.receipt_number, NULL, NULL, NULL, NULL,
      r.currency::text, r.unallocated, jsonb_build_object('postedAt', r.posted_at));
  END LOOP;
  -- 5. Two live payments of the same amount on the same day allocated to the same invoice.
  FOR r IN SELECT later.id, later.receipt_number, later.currency, later.amount_minor, earlier.receipt_number AS earlier_receipt, i.document_number
    FROM finance_payment_allocations a1 JOIN finance_payment_allocations a2
      ON a2.tenant_id = a1.tenant_id AND a2.invoice_id = a1.invoice_id AND a2.payment_id <> a1.payment_id
    JOIN finance_payments earlier ON earlier.tenant_id = a1.tenant_id AND earlier.id = a1.payment_id
    JOIN finance_payments later ON later.tenant_id = a2.tenant_id AND later.id = a2.payment_id
    JOIN finance_invoices i ON i.tenant_id = a1.tenant_id AND i.id = a1.invoice_id
    JOIN finance_document_guards ge ON ge.tenant_id = earlier.tenant_id AND ge.document_type = 'payment' AND ge.document_id = earlier.id
    JOIN finance_document_guards gl ON gl.tenant_id = later.tenant_id AND gl.document_type = 'payment' AND gl.document_id = later.id
    WHERE a1.tenant_id = p_tenant AND a1.entry_kind = 'allocation' AND a2.entry_kind = 'allocation'
      AND earlier.entry_kind = 'posted' AND later.entry_kind = 'posted' AND ge.reversed_at IS NULL AND gl.reversed_at IS NULL
      AND earlier.amount_minor = later.amount_minor AND earlier.currency = later.currency
      AND (earlier.posted_at AT TIME ZONE 'UTC')::date = (later.posted_at AT TIME ZONE 'UTC')::date
      AND (earlier.posted_at, earlier.id) < (later.posted_at, later.id)
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'DUPLICATE_PAYMENT_SAME_DAY', 'payment', r.id, r.receipt_number, NULL, NULL, NULL, NULL,
      r.currency::text, r.amount_minor, jsonb_build_object('earlierReceipt', r.earlier_receipt, 'invoiceNumber', r.document_number));
  END LOOP;
  -- 6. Voucher redemptions whose subscriber credit has been pending for more than an hour.
  FOR r IN SELECT rd.id, v.serial_number, rd.currency, rd.amount_minor, rd.redeemed_at, rd.subscriber_id, s.branch_id, s.area_id, s.route_id
    FROM operations_voucher_redemptions rd JOIN operations_vouchers v ON v.tenant_id = rd.tenant_id AND v.id = rd.voucher_id
    JOIN operations_subscribers s ON s.tenant_id = rd.tenant_id AND s.id = rd.subscriber_id
    WHERE rd.tenant_id = p_tenant AND rd.status = 'credit_pending' AND rd.redeemed_at < clock_timestamp() - interval '1 hour'
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'VOUCHER_CREDIT_PENDING', 'redemption', r.id, r.serial_number, r.subscriber_id, r.branch_id, r.area_id,
      r.route_id, r.currency, r.amount_minor, jsonb_build_object('redeemedAt', r.redeemed_at));
  END LOOP;
  -- 7. Collector reconciliations with a cash difference in the last 30 days.
  FOR r IN SELECT c.id, c.business_date, c.currency, c.difference_minor, u.display_name
    FROM operations_collector_reconciliations c LEFT JOIN users u ON u.id = c.collector_user_id
    WHERE c.tenant_id = p_tenant AND c.difference_minor <> 0 AND c.business_date > (clock_timestamp() AT TIME ZONE 'UTC')::date - 30
      AND NOT EXISTS (SELECT 1 FROM operations_collector_reconciliations n WHERE n.tenant_id = c.tenant_id AND n.previous_reconciliation_id = c.id)
  LOOP
    PERFORM assurance_observe(p_tenant, p_run, 'COLLECTOR_VARIANCE_30', 'reconciliation', r.id,
      coalesce(r.display_name, 'collector') || ' · ' || r.business_date::text, NULL, NULL, NULL, NULL, r.currency::text, abs(r.difference_minor),
      jsonb_build_object('businessDate', r.business_date, 'differenceMinor', r.difference_minor, 'collector', r.display_name));
  END LOOP;
  -- 8. Dealers whose float has gone beyond the credit limit in either currency.
  FOR r IN SELECT d.id, d.dealer_code, d.dealer_name, d.branch_id, cur.currency,
      dealer_balance_minor(d.tenant_id, d.id, cur.currency) AS balance,
      CASE cur.currency WHEN 'USD' THEN d.credit_limit_minor_usd ELSE d.credit_limit_minor_lbp END AS credit_limit
    FROM operations_dealers d CROSS JOIN (VALUES ('USD'), ('LBP')) AS cur(currency)
    WHERE d.tenant_id = p_tenant
  LOOP
    IF r.balance + r.credit_limit < 0 THEN
      PERFORM assurance_observe(p_tenant, p_run, 'DEALER_OVER_LIMIT', 'dealer', r.id, r.dealer_code || ' · ' || r.dealer_name || ' · ' || r.currency,
        NULL, r.branch_id, NULL, NULL, r.currency, -(r.balance + r.credit_limit),
        jsonb_build_object('balanceMinor', r.balance, 'creditLimitMinor', r.credit_limit, 'currency', r.currency));
    END IF;
  END LOOP;
  -- Conditions no longer observed clear themselves (resolved findings keep their state).
  UPDATE operations_assurance_findings SET status = 'cleared', cleared_at = clock_timestamp(), version = version + 1
   WHERE tenant_id = p_tenant AND last_seen_run_id <> p_run AND status IN ('open', 'acknowledged');
  FOREACH code IN ARRAY codes LOOP
    SELECT count(*) FILTER (WHERE status IN ('open', 'acknowledged')), count(*) FILTER (WHERE first_seen_run_id = p_run),
      coalesce(sum(exposure_minor) FILTER (WHERE status IN ('open', 'acknowledged') AND currency = 'USD'), 0),
      coalesce(sum(exposure_minor) FILTER (WHERE status IN ('open', 'acknowledged') AND currency = 'LBP'), 0)
      INTO v_count, v_new, v_usd, v_lbp
      FROM operations_assurance_findings WHERE tenant_id = p_tenant AND control_code = code;
    summary := summary || jsonb_build_object('controlCode', code, 'openFindings', v_count, 'newFindings', v_new,
      'exposureUsdMinor', v_usd, 'exposureLbpMinor', v_lbp);
  END LOOP;
  RETURN summary;
END $$;

CREATE FUNCTION execute_assurance_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_assurance_events%ROWTYPE;
  run_row operations_assurance_runs%ROWTYPE;
  finding operations_assurance_findings%ROWTYPE;
  case_row operations_assurance_cases%ROWTYPE;
  v_action text; resource_type text; resource_id uuid; answer jsonb; before_value jsonb; after_value jsonb;
  v_reason_en text; v_reason_ar text; v_status text; ids uuid[]; linked integer; v_owner uuid; v_number text;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.assurance.manage'
     OR c.permission <> 'tenant.collection.reconcile' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed revenue assurance authority required';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload)
     OR length(btrim(coalesce(payload->>'reasonEn', ''))) NOT BETWEEN 8 AND 1000
     OR length(btrim(coalesce(payload->>'reasonAr', ''))) NOT BETWEEN 8 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'bilingual reasons required';
  END IF;
  v_action := payload->>'action'; v_reason_en := btrim(payload->>'reasonEn'); v_reason_ar := btrim(payload->>'reasonAr');
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':assurance:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_assurance_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'assurance retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'run_controls' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid run fields';
    END IF;
    -- One evaluation at a time per tenant so findings are never double-counted.
    PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':assurance-run', 0));
    INSERT INTO operations_assurance_runs(tenant_id, requested_by) VALUES (c.tenant_id, c.actor_id::uuid) RETURNING * INTO run_row;
    UPDATE operations_assurance_runs SET summary = assurance_evaluate(c.tenant_id, run_row.id), completed_at = clock_timestamp()
     WHERE tenant_id = c.tenant_id AND id = run_row.id RETURNING * INTO run_row;
    resource_type := 'operations_assurance_runs'; resource_id := run_row.id; after_value := to_jsonb(run_row);
    answer := jsonb_build_object('runId', run_row.id, 'startedAt', run_row.started_at, 'completedAt', run_row.completed_at, 'summary', run_row.summary);

  ELSIF v_action = 'acknowledge_finding' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'findingId', 'expectedVersion', 'note', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid finding fields';
    END IF;
    SELECT * INTO finding FROM operations_assurance_findings WHERE tenant_id = c.tenant_id AND id = (payload->>'findingId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'finding not found in scope'; END IF;
    IF finding.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'finding changed; refresh before acting';
    END IF;
    IF finding.status <> 'open' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only an open finding can be acknowledged'; END IF;
    before_value := to_jsonb(finding);
    UPDATE operations_assurance_findings SET status = 'acknowledged', acknowledged_at = clock_timestamp(), acknowledged_by = c.actor_id::uuid,
      acknowledgement_note = nullif(btrim(coalesce(payload->>'note', '')), ''), version = version + 1
     WHERE tenant_id = c.tenant_id AND id = finding.id RETURNING * INTO finding;
    resource_type := 'operations_assurance_findings'; resource_id := finding.id; after_value := to_jsonb(finding);
    answer := jsonb_build_object('findingId', finding.id, 'status', finding.status, 'version', finding.version);

  ELSIF v_action = 'open_case' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'titleEn', 'titleAr', 'findingIds', 'ownerUserId', 'reasonEn', 'reasonAr'))
       OR length(btrim(coalesce(payload->>'titleEn', ''))) NOT BETWEEN 3 AND 200
       OR length(btrim(coalesce(payload->>'titleAr', ''))) NOT BETWEEN 3 AND 200
       OR jsonb_typeof(payload->'findingIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid case details';
    END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO ids FROM jsonb_array_elements_text(payload->'findingIds');
    IF coalesce(cardinality(ids), 0) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'select 1 to 200 findings';
    END IF;
    v_owner := nullif(payload->>'ownerUserId', '')::uuid;
    IF v_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_owner) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'owner must be a workspace member';
    END IF;
    SELECT count(*) INTO linked FROM operations_assurance_findings f WHERE f.tenant_id = c.tenant_id AND f.id = ANY(ids)
      AND f.status IN ('open', 'acknowledged') AND f.case_id IS NULL;
    IF linked <> cardinality(ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'every finding must be live, in scope and not already in a case';
    END IF;
    v_number := 'RA-' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    INSERT INTO operations_assurance_cases(tenant_id, case_number, title_en, title_ar, owner_user_id, opened_by)
    VALUES (c.tenant_id, v_number, btrim(payload->>'titleEn'), btrim(payload->>'titleAr'), v_owner, c.actor_id::uuid) RETURNING * INTO case_row;
    UPDATE operations_assurance_findings SET case_id = case_row.id, version = version + 1 WHERE tenant_id = c.tenant_id AND id = ANY(ids);
    resource_type := 'operations_assurance_cases'; resource_id := case_row.id; after_value := to_jsonb(case_row);
    answer := jsonb_build_object('caseId', case_row.id, 'caseNumber', case_row.case_number, 'status', case_row.status, 'version', case_row.version,
      'findings', cardinality(ids));

  ELSIF v_action IN ('assign_case', 'transition_case', 'link_findings') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'caseId', 'expectedVersion', 'ownerUserId', 'status', 'findingIds', 'resolutionEn', 'resolutionAr', 'resolutionEvidence', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid case command fields';
    END IF;
    SELECT * INTO case_row FROM operations_assurance_cases WHERE tenant_id = c.tenant_id AND id = (payload->>'caseId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'case not found'; END IF;
    IF case_row.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'case changed; refresh before acting';
    END IF;
    IF case_row.status IN ('resolved', 'written_off') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a closed case cannot change';
    END IF;
    before_value := to_jsonb(case_row);
    IF v_action = 'assign_case' THEN
      v_owner := nullif(payload->>'ownerUserId', '')::uuid;
      IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_owner) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'owner must be a workspace member';
      END IF;
      UPDATE operations_assurance_cases SET owner_user_id = v_owner, version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = case_row.id RETURNING * INTO case_row;
    ELSIF v_action = 'link_findings' THEN
      SELECT array_agg(DISTINCT value::uuid) INTO ids FROM jsonb_array_elements_text(payload->'findingIds');
      SELECT count(*) INTO linked FROM operations_assurance_findings f WHERE f.tenant_id = c.tenant_id AND f.id = ANY(ids)
        AND f.status IN ('open', 'acknowledged') AND f.case_id IS NULL;
      IF coalesce(cardinality(ids), 0) = 0 OR linked <> cardinality(ids) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'every finding must be live, in scope and not already in a case';
      END IF;
      UPDATE operations_assurance_findings SET case_id = case_row.id, version = version + 1 WHERE tenant_id = c.tenant_id AND id = ANY(ids);
      UPDATE operations_assurance_cases SET version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = case_row.id RETURNING * INTO case_row;
    ELSE
      v_status := payload->>'status';
      IF v_status IS NULL OR NOT ((case_row.status = 'open' AND v_status IN ('investigating', 'resolved', 'written_off'))
          OR (case_row.status = 'investigating' AND v_status IN ('resolved', 'written_off'))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'invalid case status transition';
      END IF;
      IF v_status IN ('resolved', 'written_off') AND (
          length(btrim(coalesce(payload->>'resolutionEn', ''))) NOT BETWEEN 8 AND 2000
          OR length(btrim(coalesce(payload->>'resolutionAr', ''))) NOT BETWEEN 8 AND 2000
          OR length(btrim(coalesce(payload->>'resolutionEvidence', ''))) NOT BETWEEN 8 AND 2000) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'closing a case requires bilingual resolution and evidence';
      END IF;
      UPDATE operations_assurance_cases SET status = v_status,
        closed_at = CASE WHEN v_status IN ('resolved', 'written_off') THEN clock_timestamp() END,
        resolution_en = CASE WHEN v_status IN ('resolved', 'written_off') THEN btrim(payload->>'resolutionEn') END,
        resolution_ar = CASE WHEN v_status IN ('resolved', 'written_off') THEN btrim(payload->>'resolutionAr') END,
        resolution_evidence = CASE WHEN v_status IN ('resolved', 'written_off') THEN btrim(payload->>'resolutionEvidence') END,
        version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = case_row.id RETURNING * INTO case_row;
      IF v_status IN ('resolved', 'written_off') THEN
        UPDATE operations_assurance_findings SET status = 'resolved', resolved_at = clock_timestamp(), cleared_at = NULL, version = version + 1
         WHERE tenant_id = c.tenant_id AND case_id = case_row.id AND status IN ('open', 'acknowledged', 'cleared');
      END IF;
    END IF;
    resource_type := 'operations_assurance_cases'; resource_id := case_row.id; after_value := to_jsonb(case_row);
    answer := jsonb_build_object('caseId', case_row.id, 'caseNumber', case_row.case_number, 'status', case_row.status, 'version', case_row.version,
      'ownerUserId', case_row.owner_user_id);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown revenue assurance action';
  END IF;

  INSERT INTO operations_assurance_events(tenant_id, action, resource_type, resource_id, actor_id, reason_en, reason_ar, idempotency_key, request_payload, result)
  VALUES (c.tenant_id, v_action, resource_type, resource_id, c.actor_id::uuid, v_reason_en, v_reason_ar, c.idempotency_key, payload, answer);
  INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id,
    permission, request_id, idempotency_key, ip_address, user_agent, result, reason, before_value, after_value)
  VALUES (c.tenant_id, c.action, resource_type, resource_id::text, c.actor_id, c.session_id, c.permission,
    c.request_id, c.idempotency_key, c.ip_address, c.user_agent, 'allowed', c.reason, before_value, after_value);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_assurance_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_assurance_command(jsonb) TO orvex_runtime;

-- Reads that cross into finance tables need the finance tenant setting; this wrapper sets it for
-- the workspace read under a verified context.
CREATE FUNCTION assurance_prepare_read() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.assurance.workspace.read'
     OR c.permission NOT IN ('tenant.billing.view', 'tenant.collection.reconcile', 'tenant.accounting.view', 'tenant.report.view') THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'revenue assurance view authority required';
  END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  RETURN c.tenant_id;
END $$;
REVOKE ALL ON FUNCTION assurance_prepare_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assurance_prepare_read() TO orvex_runtime;
