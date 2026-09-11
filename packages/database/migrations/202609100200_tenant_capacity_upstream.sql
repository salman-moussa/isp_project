-- 202609100200_tenant_capacity_upstream.sql
-- Capacity and upstream management: a register of upstream circuits (transit, peering, Ogero,
-- wireless backhaul, leased lines) with committed and burst capacity, monthly cost per currency,
-- contract dates and renewal notice; append-only utilisation samples per circuit; and a reader
-- that derives utilisation, headroom, saturation risk, a linear forecast of months to saturation,
-- renewals due and the monthly cost per currency. Money stays integer minor units per currency.

CREATE TABLE operations_upstream_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('transit', 'peering', 'ogero_dsl', 'ogero_fiber', 'wireless_backhaul', 'leased_line', 'other')),
  pop text NOT NULL CHECK (length(btrim(pop)) BETWEEN 1 AND 120),
  branch_id uuid,
  committed_mbps integer NOT NULL CHECK (committed_mbps > 0),
  burst_mbps integer CHECK (burst_mbps IS NULL OR burst_mbps >= committed_mbps),
  monthly_cost_minor bigint NOT NULL CHECK (monthly_cost_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  contract_start date,
  contract_end date,
  renewal_notice_days integer NOT NULL DEFAULT 60 CHECK (renewal_notice_days BETWEEN 0 AND 730),
  sla_availability_pct numeric(5, 2) CHECK (sla_availability_pct IS NULL OR sla_availability_pct BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'decommissioned')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start)
);

CREATE TABLE operations_capacity_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  circuit_id uuid NOT NULL,
  sampled_at timestamptz NOT NULL,
  peak_in_mbps numeric(12, 3) NOT NULL CHECK (peak_in_mbps >= 0),
  peak_out_mbps numeric(12, 3) NOT NULL CHECK (peak_out_mbps >= 0),
  avg_in_mbps numeric(12, 3) CHECK (avg_in_mbps IS NULL OR avg_in_mbps >= 0),
  avg_out_mbps numeric(12, 3) CHECK (avg_out_mbps IS NULL OR avg_out_mbps >= 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, circuit_id, sampled_at),
  FOREIGN KEY (tenant_id, circuit_id) REFERENCES operations_upstream_circuits(tenant_id, id)
);
CREATE INDEX capacity_samples_circuit_idx ON operations_capacity_samples(tenant_id, circuit_id, sampled_at DESC);

CREATE TABLE operations_capacity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  circuit_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

CREATE TRIGGER capacity_samples_append_only BEFORE UPDATE OR DELETE ON operations_capacity_samples
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER capacity_events_append_only BEFORE UPDATE OR DELETE ON operations_capacity_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['operations_upstream_circuits', 'operations_capacity_samples', 'operations_capacity_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t || '_tenant', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
  END LOOP;
END $$;

CREATE FUNCTION capacity_context_or_raise(p_action text, p_permissions text[]) RETURNS operations_request_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> p_action OR NOT (c.permission = ANY(p_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed capacity authority required';
  END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION capacity_context_or_raise(text, text[]) FROM PUBLIC;

CREATE FUNCTION execute_capacity_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_capacity_events%ROWTYPE;
  circuit operations_upstream_circuits%ROWTYPE;
  before jsonb; v_action text; answer jsonb; v_id uuid; n integer := 0; item jsonb; sample_id uuid;
BEGIN
  c := capacity_context_or_raise('tenant.capacity.manage', ARRAY['tenant.network.job.create']);
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid capacity payload';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':capacity:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_capacity_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'capacity retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'upsert_circuit' THEN
    v_id := (payload->>'circuitId')::uuid;
    IF payload ? 'branchId' AND payload->>'branchId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND b.id = (payload->>'branchId')::uuid AND operations_scope_allows(b.tenant_id, b.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'branch missing or outside scope';
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO operations_upstream_circuits(tenant_id, code, provider, kind, pop, branch_id, committed_mbps, burst_mbps, monthly_cost_minor, currency,
          contract_start, contract_end, renewal_notice_days, sla_availability_pct, status, notes)
        VALUES (c.tenant_id, upper(btrim(payload->>'code')), btrim(payload->>'provider'), payload->>'kind', btrim(payload->>'pop'), (payload->>'branchId')::uuid,
          (payload->>'committedMbps')::integer, (payload->>'burstMbps')::integer, coalesce((payload->>'monthlyCostMinor')::bigint, 0), payload->>'currency',
          (payload->>'contractStart')::date, (payload->>'contractEnd')::date, coalesce((payload->>'renewalNoticeDays')::integer, 60),
          (payload->>'slaAvailabilityPct')::numeric, coalesce(payload->>'status', 'active'), nullif(btrim(coalesce(payload->>'notes', '')), ''))
        RETURNING * INTO circuit;
    ELSE
      SELECT * INTO circuit FROM operations_upstream_circuits WHERE tenant_id = c.tenant_id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'circuit missing'; END IF;
      IF circuit.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'circuit changed since it was read'; END IF;
      before := to_jsonb(circuit);
      UPDATE operations_upstream_circuits SET
        provider = coalesce(btrim(payload->>'provider'), provider), kind = coalesce(payload->>'kind', kind), pop = coalesce(btrim(payload->>'pop'), pop),
        branch_id = CASE WHEN payload ? 'branchId' THEN (payload->>'branchId')::uuid ELSE branch_id END,
        committed_mbps = coalesce((payload->>'committedMbps')::integer, committed_mbps),
        burst_mbps = CASE WHEN payload ? 'burstMbps' THEN (payload->>'burstMbps')::integer ELSE burst_mbps END,
        monthly_cost_minor = coalesce((payload->>'monthlyCostMinor')::bigint, monthly_cost_minor), currency = coalesce(payload->>'currency', currency),
        contract_start = CASE WHEN payload ? 'contractStart' THEN (payload->>'contractStart')::date ELSE contract_start END,
        contract_end = CASE WHEN payload ? 'contractEnd' THEN (payload->>'contractEnd')::date ELSE contract_end END,
        renewal_notice_days = coalesce((payload->>'renewalNoticeDays')::integer, renewal_notice_days),
        sla_availability_pct = CASE WHEN payload ? 'slaAvailabilityPct' THEN (payload->>'slaAvailabilityPct')::numeric ELSE sla_availability_pct END,
        status = coalesce(payload->>'status', status), notes = CASE WHEN payload ? 'notes' THEN nullif(btrim(payload->>'notes'), '') ELSE notes END,
        version = version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = c.tenant_id AND id = v_id RETURNING * INTO circuit;
    END IF;
    INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id, permission, request_id, idempotency_key,
        ip_address, user_agent, result, reason, before_value, after_value)
      VALUES (c.tenant_id, c.action, 'operations_upstream_circuits', circuit.id::text, c.actor_id, c.session_id, c.permission, c.request_id, c.idempotency_key,
        c.ip_address, c.user_agent, 'allowed', c.reason, before, to_jsonb(circuit));
    answer := jsonb_build_object('circuitId', circuit.id, 'code', circuit.code, 'status', circuit.status, 'version', circuit.version);

  ELSIF v_action = 'record_samples' THEN
    v_id := (payload->>'circuitId')::uuid;
    SELECT * INTO circuit FROM operations_upstream_circuits WHERE tenant_id = c.tenant_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'circuit missing'; END IF;
    IF circuit.status = 'decommissioned' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a decommissioned circuit takes no samples'; END IF;
    IF jsonb_typeof(payload->'samples') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'samples') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'record between 1 and 500 samples';
    END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'samples') LOOP
      INSERT INTO operations_capacity_samples(tenant_id, circuit_id, sampled_at, peak_in_mbps, peak_out_mbps, avg_in_mbps, avg_out_mbps, source, recorded_by)
        VALUES (c.tenant_id, circuit.id, (item->>'sampledAt')::timestamptz, (item->>'peakInMbps')::numeric, (item->>'peakOutMbps')::numeric,
          (item->>'avgInMbps')::numeric, (item->>'avgOutMbps')::numeric, coalesce(payload->>'source', 'manual'), c.actor_id::uuid)
        ON CONFLICT (tenant_id, circuit_id, sampled_at) DO NOTHING RETURNING id INTO sample_id;
      IF sample_id IS NOT NULL THEN n := n + 1; END IF;
      sample_id := NULL;
    END LOOP;
    INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id, permission, request_id, idempotency_key,
        ip_address, user_agent, result, reason, before_value, after_value)
      VALUES (c.tenant_id, c.action, 'operations_capacity_samples', circuit.id::text, c.actor_id, c.session_id, c.permission, c.request_id, c.idempotency_key,
        c.ip_address, c.user_agent, 'allowed', c.reason, NULL, jsonb_build_object('circuitId', circuit.id, 'recorded', n));
    answer := jsonb_build_object('circuitId', circuit.id, 'recorded', n);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown capacity action';
  END IF;

  INSERT INTO operations_capacity_events(tenant_id, action, circuit_id, actor_id, idempotency_key, request_payload, result)
    VALUES (c.tenant_id, v_action, circuit.id, c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_capacity_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_capacity_command(jsonb) TO orvex_runtime;

CREATE FUNCTION read_capacity_workspace(p_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; days integer := least(greatest(coalesce(p_days, 30), 7), 365); since timestamptz; today date; result jsonb;
BEGIN
  c := capacity_context_or_raise('tenant.capacity.workspace.read', ARRAY['tenant.network.view', 'tenant.network.job.create', 'tenant.report.view']);
  since := clock_timestamp() - make_interval(days => days);
  today := (clock_timestamp() AT TIME ZONE 'Asia/Beirut')::date;
  SELECT jsonb_build_object(
    'asOf', clock_timestamp(), 'windowDays', days,
    'circuits', coalesce((SELECT jsonb_agg(item ORDER BY (item->>'riskOrder'), (item->>'code')) FROM (
      SELECT jsonb_build_object('id', u.id, 'code', u.code, 'provider', u.provider, 'kind', u.kind, 'pop', u.pop, 'branchId', u.branch_id, 'branchName', b.name_en,
        'committedMbps', u.committed_mbps, 'burstMbps', u.burst_mbps, 'monthlyCostMinor', u.monthly_cost_minor, 'currency', u.currency,
        'contractStart', u.contract_start, 'contractEnd', u.contract_end, 'renewalNoticeDays', u.renewal_notice_days, 'slaAvailabilityPct', u.sla_availability_pct,
        'status', u.status, 'notes', u.notes, 'version', u.version,
        'daysToContractEnd', CASE WHEN u.contract_end IS NULL THEN NULL ELSE u.contract_end - today END,
        'renewalDue', u.status <> 'decommissioned' AND u.contract_end IS NOT NULL AND u.contract_end - today <= u.renewal_notice_days,
        'latestSample', (SELECT jsonb_build_object('sampledAt', s.sampled_at, 'peakInMbps', s.peak_in_mbps, 'peakOutMbps', s.peak_out_mbps)
            FROM operations_capacity_samples s WHERE s.tenant_id = u.tenant_id AND s.circuit_id = u.id ORDER BY s.sampled_at DESC LIMIT 1),
        'peakMbps', w.peak, 'samples', w.n,
        'utilisationPct', CASE WHEN w.peak IS NULL THEN NULL ELSE round(100 * w.peak / u.committed_mbps, 1) END,
        'headroomMbps', CASE WHEN w.peak IS NULL THEN NULL ELSE round(u.committed_mbps - w.peak, 1) END,
        'risk', CASE WHEN u.status <> 'active' THEN 'none' WHEN w.peak IS NULL THEN 'unknown' WHEN w.peak >= 0.9 * u.committed_mbps THEN 'critical'
                     WHEN w.peak >= 0.75 * u.committed_mbps THEN 'warning' ELSE 'ok' END,
        'riskOrder', CASE WHEN u.status <> 'active' THEN 4 WHEN w.peak IS NULL THEN 3 WHEN w.peak >= 0.9 * u.committed_mbps THEN 0 WHEN w.peak >= 0.75 * u.committed_mbps THEN 1 ELSE 2 END,
        'growthMbpsPerMonth', CASE WHEN w.slope IS NULL THEN NULL ELSE round(w.slope * 30, 2) END,
        'monthsToSaturation', CASE WHEN w.slope IS NULL OR w.slope <= 0 OR w.peak IS NULL OR w.peak >= u.committed_mbps THEN NULL
                                   ELSE round((u.committed_mbps - w.peak) / (w.slope * 30), 1) END,
        'trend', coalesce((SELECT jsonb_agg(jsonb_build_object('sampledAt', s.sampled_at, 'peakMbps', greatest(s.peak_in_mbps, s.peak_out_mbps)) ORDER BY s.sampled_at)
            FROM (SELECT * FROM operations_capacity_samples s WHERE s.tenant_id = u.tenant_id AND s.circuit_id = u.id AND s.sampled_at >= since ORDER BY s.sampled_at DESC LIMIT 90) s), '[]'::jsonb)
      ) AS item
      FROM operations_upstream_circuits u
      LEFT JOIN operations_branches b ON b.tenant_id = u.tenant_id AND b.id = u.branch_id
      LEFT JOIN LATERAL (
        SELECT max(greatest(s.peak_in_mbps, s.peak_out_mbps)) AS peak, count(*) AS n,
          regr_slope(greatest(s.peak_in_mbps, s.peak_out_mbps)::double precision, extract(epoch FROM s.sampled_at) / 86400)::numeric AS slope
        FROM operations_capacity_samples s WHERE s.tenant_id = u.tenant_id AND s.circuit_id = u.id AND s.sampled_at >= since) w ON true
      WHERE u.tenant_id = c.tenant_id) rows), '[]'::jsonb),
    'cost', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', x.currency, 'monthlyMinor', x.total, 'circuits', x.n) ORDER BY x.currency)
      FROM (SELECT u.currency, sum(u.monthly_cost_minor) AS total, count(*) AS n FROM operations_upstream_circuits u WHERE u.tenant_id = c.tenant_id AND u.status = 'active' GROUP BY u.currency) x), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object('committedMbps', coalesce(sum(u.committed_mbps), 0), 'active', count(*) FILTER (WHERE u.status = 'active'),
        'planned', count(*) FILTER (WHERE u.status = 'planned'), 'decommissioned', count(*) FILTER (WHERE u.status = 'decommissioned'))
      FROM operations_upstream_circuits u WHERE u.tenant_id = c.tenant_id),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'nameEn', b.name_en, 'nameAr', b.name_ar) ORDER BY b.name_en)
      FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND operations_scope_allows(b.tenant_id, b.id)), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_capacity_workspace(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_capacity_workspace(integer) TO orvex_runtime;
