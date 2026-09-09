-- 202609090100_tenant_noc_telemetry.sql
-- NOC telemetry: alarms derived from real RouterOS worker outcomes, an alarm lifecycle
-- (acknowledge, clear, link to an incident), planned maintenance windows that suppress alarms
-- raised inside them, incident SLA targets and an append-only NOC event ledger.
--
-- Orvex still is not a polling monitor: every worker-sourced alarm comes from an execution the
-- worker actually attempted against a registered router, never from a synthetic probe.

ALTER TABLE operations_network_alarms
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'worker')),
  ADD COLUMN dedup_key text CHECK (dedup_key IS NULL OR length(dedup_key) BETWEEN 3 AND 300),
  ADD COLUMN router_id text CHECK (router_id IS NULL OR length(btrim(router_id)) BETWEEN 1 AND 128),
  ADD COLUMN route_id uuid,
  ADD COLUMN service_id uuid,
  ADD COLUMN outage_id uuid,
  ADD COLUMN maintenance_id uuid,
  ADD COLUMN occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by uuid REFERENCES users(id),
  ADD COLUMN acknowledgement_note text CHECK (acknowledgement_note IS NULL OR length(acknowledgement_note) <= 1000),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT alarm_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT alarm_route_tenant FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  ADD CONSTRAINT alarm_service_tenant FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  ADD CONSTRAINT alarm_outage_tenant FOREIGN KEY (tenant_id, outage_id) REFERENCES operations_outages(tenant_id, id),
  ADD CONSTRAINT alarm_cleared_consistency CHECK ((status = 'cleared') = (cleared_at IS NOT NULL)),
  ADD CONSTRAINT alarm_acknowledged_consistency CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL));

CREATE UNIQUE INDEX alarm_live_dedup_idx ON operations_network_alarms(tenant_id, dedup_key)
  WHERE status <> 'cleared' AND dedup_key IS NOT NULL;
CREATE INDEX alarm_live_idx ON operations_network_alarms(tenant_id, status, last_seen_at DESC, id);

CREATE TABLE operations_maintenance_windows (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en text NOT NULL CHECK (length(btrim(title_en)) BETWEEN 3 AND 200),
  title_ar text NOT NULL CHECK (length(btrim(title_ar)) BETWEEN 3 AND 200),
  route_id uuid,
  router_id text CHECK (router_id IS NULL OR length(btrim(router_id)) BETWEEN 1 AND 128),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  expected_impact text NOT NULL CHECK (expected_impact IN ('none', 'degraded', 'outage')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  notes_en text CHECK (notes_en IS NULL OR length(notes_en) <= 2000),
  notes_ar text CHECK (notes_ar IS NULL OR length(notes_ar) <= 2000),
  created_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '14 days'),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id)
);
CREATE INDEX maintenance_window_idx ON operations_maintenance_windows(tenant_id, starts_at DESC, id);
ALTER TABLE operations_network_alarms
  ADD CONSTRAINT alarm_maintenance_tenant FOREIGN KEY (tenant_id, maintenance_id)
  REFERENCES operations_maintenance_windows(tenant_id, id);

CREATE TABLE operations_noc_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('operations_network_alarms', 'operations_maintenance_windows')),
  resource_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, resource_type, resource_id, version),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

-- Row security: tenant context readers see alarms and windows inside their scope (unscoped
-- device alarms are tenant-wide); the worker identity may only reflect execution outcomes.
DROP POLICY tenant_isolation_alarms ON operations_network_alarms;
CREATE POLICY noc_alarm_scope ON operations_network_alarms
  USING (tenant_id = (operations_current_context()).tenant_id
    AND (route_id IS NULL OR operations_scope_allows_route(tenant_id, route_id, NULL)))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id
    AND (route_id IS NULL OR operations_scope_allows_route(tenant_id, route_id, NULL)));
CREATE POLICY noc_alarm_worker ON operations_network_alarms FOR ALL
  USING (session_user = 'orvex_network_worker') WITH CHECK (session_user = 'orvex_network_worker');
ALTER TABLE operations_maintenance_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_maintenance_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY noc_maintenance_scope ON operations_maintenance_windows
  USING (tenant_id = (operations_current_context()).tenant_id
    AND (route_id IS NULL OR operations_scope_allows_route(tenant_id, route_id, NULL)))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id
    AND (route_id IS NULL OR operations_scope_allows_route(tenant_id, route_id, NULL)));
CREATE POLICY noc_maintenance_worker ON operations_maintenance_windows FOR SELECT
  USING (session_user = 'orvex_network_worker');
ALTER TABLE operations_noc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_noc_events FORCE ROW LEVEL SECURITY;
CREATE POLICY noc_event_tenant ON operations_noc_events
  USING (tenant_id = (operations_current_context()).tenant_id)
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);

REVOKE ALL ON operations_network_alarms, operations_maintenance_windows, operations_noc_events
  FROM PUBLIC, orvex_runtime, orvex_network_worker;
GRANT SELECT ON operations_network_alarms, operations_maintenance_windows, operations_noc_events TO orvex_runtime;

CREATE TRIGGER noc_events_immutable BEFORE UPDATE OR DELETE ON operations_noc_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_events_no_truncate BEFORE TRUNCATE ON operations_noc_events
  FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_alarm_no_delete BEFORE DELETE ON operations_network_alarms
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER noc_maintenance_no_delete BEFORE DELETE ON operations_maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- Incident SLA targets by severity (minutes to resolution).
CREATE FUNCTION noc_sla_minutes(p_severity text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_severity WHEN 'critical' THEN 60 WHEN 'major' THEN 240 WHEN 'minor' THEN 1440 ELSE 4320 END
$$;

-- Maintenance window that covers a router/route right now, if any (used for suppression).
CREATE FUNCTION noc_active_maintenance(p_tenant uuid, p_router text, p_route uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.id FROM operations_maintenance_windows m
  WHERE m.tenant_id = p_tenant AND m.status IN ('planned', 'in_progress')
    AND clock_timestamp() BETWEEN m.starts_at AND m.ends_at
    AND (m.router_id IS NULL OR m.router_id = p_router)
    AND (m.route_id IS NULL OR m.route_id = p_route)
  ORDER BY m.starts_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION noc_sla_minutes(text), noc_active_maintenance(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION noc_sla_minutes(text) TO orvex_runtime;

-- Worker outcomes become alarms. The trigger fires when a job's state settles after an attempt:
-- a definite success clears the router's live worker alarms; a failure classified as a router
-- problem raises or refreshes one deduplicated alarm per router and problem class.
CREATE FUNCTION network_worker.reflect_job_alarm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, network_worker AS $$
DECLARE
  router text; err text; svc uuid; rt uuid; dedup text; code text; sev text;
  msg_en text; msg_ar text; maint uuid;
BEGIN
  -- Only the worker identity reports execution outcomes; any other writer leaves alarms alone.
  IF session_user <> 'orvex_network_worker' THEN RETURN NEW; END IF;
  router := nullif(btrim(coalesce(NEW.request->>'routerId', '')), '');
  IF router IS NULL THEN RETURN NEW; END IF;
  svc := nullif(NEW.request->>'subscriberServiceId', '')::uuid;
  IF svc IS NOT NULL THEN
    SELECT s.route_id INTO rt FROM operations_services s WHERE s.tenant_id = NEW.tenant_id AND s.id = svc;
  END IF;
  IF NEW.state IN ('succeeded', 'reconciled') THEN
    UPDATE operations_network_alarms
       SET status = 'cleared', cleared_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
     WHERE tenant_id = NEW.tenant_id AND source = 'worker' AND router_id = router AND status <> 'cleared'
       AND alarm_code IN ('ROUTER_UNREACHABLE', 'ROUTER_ACCESS_DENIED');
    RETURN NEW;
  END IF;
  IF NEW.state NOT IN ('retry_scheduled', 'failed', 'dead_lettered', 'partially_succeeded') THEN RETURN NEW; END IF;
  err := coalesce(NEW.job->>'lastErrorClass', (NEW.job->'attempts')->-1->'outcome'->>'errorClass');
  IF err IN ('offline', 'timeout', 'transport', 'circuit_open') THEN
    dedup := 'router:' || router || ':unreachable'; code := 'ROUTER_UNREACHABLE';
    sev := CASE WHEN NEW.state = 'dead_lettered' THEN 'critical' ELSE 'major' END;
    msg_en := 'Router ' || router || ' did not answer the worker (' || err || ').';
    msg_ar := 'لم يستجب الراوتر ' || router || ' لعامل الشبكة (' || err || ').';
  ELSIF err IN ('authentication', 'authorization') THEN
    dedup := 'router:' || router || ':access'; code := 'ROUTER_ACCESS_DENIED'; sev := 'critical';
    msg_en := 'Router ' || router || ' refused the worker credential (' || err || ').';
    msg_ar := 'رفض الراوتر ' || router || ' بيانات اعتماد عامل الشبكة (' || err || ').';
  ELSIF err = 'observed_state_mismatch' AND svc IS NOT NULL THEN
    dedup := 'service:' || svc::text || ':state-mismatch'; code := 'SERVICE_STATE_MISMATCH'; sev := 'minor';
    msg_en := 'Router ' || router || ' reports a subscriber state that differs from the requested change.';
    msg_ar := 'يبلّغ الراوتر ' || router || ' عن حالة مشترك تختلف عن التغيير المطلوب.';
  ELSE
    RETURN NEW;
  END IF;
  maint := noc_active_maintenance(NEW.tenant_id, router, rt);
  INSERT INTO operations_network_alarms(tenant_id, device_name, severity, alarm_code, message_en, message_ar,
    source, dedup_key, router_id, route_id, service_id, maintenance_id, status)
  VALUES (NEW.tenant_id, router, sev, code, msg_en, msg_ar, 'worker', dedup, router, rt, svc, maint, 'active')
  ON CONFLICT (tenant_id, dedup_key) WHERE status <> 'cleared' AND dedup_key IS NOT NULL DO UPDATE SET
    occurrence_count = operations_network_alarms.occurrence_count + 1,
    last_seen_at = clock_timestamp(),
    severity = CASE WHEN excluded.severity = 'critical' OR operations_network_alarms.severity = 'critical'
      THEN 'critical' ELSE operations_network_alarms.severity END,
    message_en = excluded.message_en, message_ar = excluded.message_ar,
    version = operations_network_alarms.version + 1, updated_at = clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER network_job_alarm AFTER UPDATE ON network_worker.jobs
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION network_worker.reflect_job_alarm();

-- Registered router ids for the maintenance form (tenant context required; no credentials).
CREATE FUNCTION read_noc_router_ids() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, network_worker AS $$
  SELECT coalesce(array_agg(r.router_id ORDER BY r.router_id), ARRAY[]::text[])
  FROM network_worker.routers r
  WHERE r.tenant_id = (SELECT tenant_id FROM operations_current_context()
    WHERE permission IN ('tenant.network.view', 'tenant.network.job.create', 'tenant.network.bulk.approve'))
$$;
REVOKE ALL ON FUNCTION read_noc_router_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_noc_router_ids() TO orvex_runtime;

-- Signed alarm and maintenance commands.
CREATE FUNCTION execute_noc_alarm_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_noc_events%ROWTYPE;
  alarm operations_network_alarms%ROWTYPE;
  window_row operations_maintenance_windows%ROWTYPE;
  outage operations_outages%ROWTYPE;
  v_action text; v_status text; resource_type text; resource_id uuid; resource_version integer;
  answer jsonb; before_value jsonb; after_value jsonb; rt uuid; svc uuid;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.permission <> 'tenant.network.job.create'
     OR c.action <> 'tenant.noc.alarm.manage' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed NOC alarm authority required';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload)
     OR length(btrim(coalesce(payload->>'reasonEn', ''))) NOT BETWEEN 8 AND 1000
     OR length(btrim(coalesce(payload->>'reasonAr', ''))) NOT BETWEEN 8 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'bilingual reasons required';
  END IF;
  v_action := payload->>'action';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':noc-alarm:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_noc_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'NOC retry key belongs to different content';
    END IF;
    RETURN prior.result;
  END IF;

  IF v_action = 'raise_alarm' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'deviceName', 'severity', 'alarmCode', 'messageEn', 'messageAr', 'routeId', 'serviceId', 'routerId', 'reasonEn', 'reasonAr'))
       OR length(btrim(coalesce(payload->>'deviceName', ''))) NOT BETWEEN 2 AND 100
       OR coalesce(payload->>'severity', '') NOT IN ('critical', 'major', 'minor', 'warning')
       OR coalesce(payload->>'alarmCode', '') !~ '^[A-Z0-9_]{3,40}$'
       OR length(btrim(coalesce(payload->>'messageEn', ''))) NOT BETWEEN 3 AND 500
       OR length(btrim(coalesce(payload->>'messageAr', ''))) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid alarm details';
    END IF;
    rt := nullif(payload->>'routeId', '')::uuid;
    svc := nullif(payload->>'serviceId', '')::uuid;
    IF svc IS NOT NULL THEN
      SELECT s.route_id INTO rt FROM operations_services s WHERE s.tenant_id = c.tenant_id AND s.id = svc
        AND operations_scope_allows(s.tenant_id, s.branch_id, s.area_id, s.route_id, s.id);
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'service is outside current scope'; END IF;
    END IF;
    IF rt IS NOT NULL AND NOT noc_scope_allows(c.tenant_id, rt, NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'route is outside current scope';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_network_alarms a WHERE a.tenant_id = c.tenant_id AND a.status <> 'cleared'
        AND a.dedup_key = 'manual:' || btrim(payload->>'deviceName') || ':' || (payload->>'alarmCode')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'an equivalent alarm is already open';
    END IF;
    INSERT INTO operations_network_alarms(tenant_id, device_name, severity, alarm_code, message_en, message_ar,
      source, dedup_key, router_id, route_id, service_id, maintenance_id, status)
    VALUES (c.tenant_id, btrim(payload->>'deviceName'), payload->>'severity', payload->>'alarmCode',
      btrim(payload->>'messageEn'), btrim(payload->>'messageAr'), 'manual',
      'manual:' || btrim(payload->>'deviceName') || ':' || (payload->>'alarmCode'),
      nullif(btrim(coalesce(payload->>'routerId', '')), ''), rt, svc,
      noc_active_maintenance(c.tenant_id, nullif(btrim(coalesce(payload->>'routerId', '')), ''), rt), 'active')
    RETURNING * INTO alarm;
    resource_type := 'operations_network_alarms'; resource_id := alarm.id; resource_version := alarm.version;
    after_value := to_jsonb(alarm);
    answer := jsonb_build_object('alarmId', alarm.id, 'status', alarm.status, 'version', alarm.version);

  ELSIF v_action IN ('acknowledge_alarm', 'clear_alarm', 'link_alarm_incident') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'alarmId', 'expectedVersion', 'note', 'outageId', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid alarm command fields';
    END IF;
    SELECT * INTO alarm FROM operations_network_alarms
     WHERE tenant_id = c.tenant_id AND id = (payload->>'alarmId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'alarm not found'; END IF;
    IF alarm.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'alarm changed; refresh before acting';
    END IF;
    before_value := to_jsonb(alarm);
    IF v_action = 'acknowledge_alarm' THEN
      IF alarm.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only an active alarm can be acknowledged'; END IF;
      UPDATE operations_network_alarms SET status = 'acknowledged', acknowledged_at = clock_timestamp(),
        acknowledged_by = c.actor_id::uuid, acknowledgement_note = nullif(btrim(coalesce(payload->>'note', '')), ''),
        version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = alarm.id RETURNING * INTO alarm;
    ELSIF v_action = 'clear_alarm' THEN
      IF alarm.status = 'cleared' THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'alarm is already cleared'; END IF;
      UPDATE operations_network_alarms SET status = 'cleared', cleared_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = alarm.id RETURNING * INTO alarm;
    ELSE
      SELECT * INTO outage FROM operations_outages WHERE tenant_id = c.tenant_id AND id = (payload->>'outageId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'incident not found in scope'; END IF;
      IF alarm.status = 'cleared' THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a cleared alarm cannot be linked'; END IF;
      UPDATE operations_network_alarms SET outage_id = outage.id, version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = alarm.id RETURNING * INTO alarm;
    END IF;
    resource_type := 'operations_network_alarms'; resource_id := alarm.id; resource_version := alarm.version;
    after_value := to_jsonb(alarm);
    answer := jsonb_build_object('alarmId', alarm.id, 'status', alarm.status, 'version', alarm.version,
      'outageId', alarm.outage_id);

  ELSIF v_action = 'create_maintenance' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'titleEn', 'titleAr', 'routeId', 'routerId', 'startsAt', 'endsAt', 'expectedImpact', 'notesEn', 'notesAr', 'reasonEn', 'reasonAr'))
       OR length(btrim(coalesce(payload->>'titleEn', ''))) NOT BETWEEN 3 AND 200
       OR length(btrim(coalesce(payload->>'titleAr', ''))) NOT BETWEEN 3 AND 200
       OR coalesce(payload->>'expectedImpact', '') NOT IN ('none', 'degraded', 'outage')
       OR nullif(payload->>'startsAt', '') IS NULL OR nullif(payload->>'endsAt', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid maintenance details';
    END IF;
    rt := nullif(payload->>'routeId', '')::uuid;
    IF rt IS NOT NULL AND NOT noc_scope_allows(c.tenant_id, rt, NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'route is outside current scope';
    END IF;
    IF (payload->>'endsAt')::timestamptz <= (payload->>'startsAt')::timestamptz
       OR (payload->>'endsAt')::timestamptz < clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'maintenance window must end in the future, after it starts';
    END IF;
    INSERT INTO operations_maintenance_windows(tenant_id, title_en, title_ar, route_id, router_id, starts_at, ends_at,
      expected_impact, notes_en, notes_ar, created_by)
    VALUES (c.tenant_id, btrim(payload->>'titleEn'), btrim(payload->>'titleAr'), rt,
      nullif(btrim(coalesce(payload->>'routerId', '')), ''), (payload->>'startsAt')::timestamptz,
      (payload->>'endsAt')::timestamptz, payload->>'expectedImpact',
      nullif(btrim(coalesce(payload->>'notesEn', '')), ''), nullif(btrim(coalesce(payload->>'notesAr', '')), ''),
      c.actor_id::uuid)
    RETURNING * INTO window_row;
    resource_type := 'operations_maintenance_windows'; resource_id := window_row.id; resource_version := window_row.version;
    after_value := to_jsonb(window_row);
    answer := jsonb_build_object('maintenanceId', window_row.id, 'status', window_row.status, 'version', window_row.version);

  ELSIF v_action = 'update_maintenance' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'maintenanceId', 'expectedVersion', 'status', 'endsAt', 'notesEn', 'notesAr', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid maintenance update fields';
    END IF;
    SELECT * INTO window_row FROM operations_maintenance_windows
     WHERE tenant_id = c.tenant_id AND id = (payload->>'maintenanceId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'maintenance window not found'; END IF;
    IF window_row.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'maintenance window changed; refresh before acting';
    END IF;
    v_status := coalesce(payload->>'status', window_row.status);
    IF NOT (v_status = window_row.status
        OR (window_row.status = 'planned' AND v_status IN ('in_progress', 'cancelled'))
        OR (window_row.status = 'in_progress' AND v_status IN ('completed', 'cancelled'))) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'invalid maintenance status transition';
    END IF;
    IF window_row.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a closed maintenance window cannot change';
    END IF;
    IF payload ? 'endsAt' AND (payload->>'endsAt')::timestamptz <= window_row.starts_at THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'maintenance window must end after it starts';
    END IF;
    before_value := to_jsonb(window_row);
    UPDATE operations_maintenance_windows SET status = v_status,
      ends_at = CASE WHEN payload ? 'endsAt' THEN (payload->>'endsAt')::timestamptz ELSE ends_at END,
      notes_en = CASE WHEN payload ? 'notesEn' THEN nullif(btrim(payload->>'notesEn'), '') ELSE notes_en END,
      notes_ar = CASE WHEN payload ? 'notesAr' THEN nullif(btrim(payload->>'notesAr'), '') ELSE notes_ar END,
      version = version + 1, updated_at = clock_timestamp()
     WHERE tenant_id = c.tenant_id AND id = window_row.id RETURNING * INTO window_row;
    resource_type := 'operations_maintenance_windows'; resource_id := window_row.id; resource_version := window_row.version;
    after_value := to_jsonb(window_row);
    answer := jsonb_build_object('maintenanceId', window_row.id, 'status', window_row.status, 'version', window_row.version);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown NOC alarm action';
  END IF;

  INSERT INTO operations_noc_events(tenant_id, action, resource_type, resource_id, version, actor_id, reason_en, reason_ar,
    idempotency_key, request_payload, result)
  VALUES (c.tenant_id, v_action, resource_type, resource_id, resource_version, c.actor_id::uuid,
    btrim(payload->>'reasonEn'), btrim(payload->>'reasonAr'), c.idempotency_key, payload, answer);
  INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id,
    permission, request_id, idempotency_key, ip_address, user_agent, result, reason, before_value, after_value)
  VALUES (c.tenant_id, c.action, resource_type, resource_id::text, c.actor_id, c.session_id, c.permission,
    c.request_id, c.idempotency_key, c.ip_address, c.user_agent, 'allowed', c.reason, before_value, after_value);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_noc_alarm_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_noc_alarm_command(jsonb) TO orvex_runtime;
