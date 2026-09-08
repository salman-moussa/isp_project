-- Field service dispatch: technicians with skills and territories, work orders with appointment
-- windows, SLA due times, checklists and outcomes, and a guarded lifecycle that drives the linked
-- installation record so field completion still feeds order orchestration and activation.

CREATE TABLE operations_field_technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  phone text,
  skills text[] NOT NULL DEFAULT ARRAY[]::text[],
  branch_id uuid,
  area_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  CHECK (skills <@ ARRAY['fiber','wireless','copper','cpe','survey','maintenance']::text[]),
  CHECK (cardinality(area_ids) <= 50)
);

CREATE TABLE operations_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_order_number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('installation','repair','relocation','maintenance','disconnection','survey')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','dispatched','on_site','completed','failed','cancelled')),
  subscriber_id uuid,
  service_id uuid,
  installation_id uuid,
  location_id uuid,
  branch_id uuid,
  area_id uuid,
  route_id uuid,
  technician_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  sla_due_at timestamptz,
  title_en text NOT NULL,
  title_ar text NOT NULL,
  instructions text,
  required_skills text[] NOT NULL DEFAULT ARRAY[]::text[],
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  revisit_of uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz,
  started_at timestamptz,
  closed_at timestamptz,
  UNIQUE (tenant_id, work_order_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  FOREIGN KEY (tenant_id, installation_id) REFERENCES operations_installations(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES operations_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  FOREIGN KEY (tenant_id, area_id) REFERENCES operations_areas(tenant_id, id),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  FOREIGN KEY (tenant_id, technician_id) REFERENCES operations_field_technicians(tenant_id, id),
  FOREIGN KEY (tenant_id, revisit_of) REFERENCES operations_work_orders(tenant_id, id),
  CHECK (length(btrim(title_en)) BETWEEN 3 AND 200),
  CHECK (length(btrim(title_ar)) BETWEEN 3 AND 200),
  CHECK (instructions IS NULL OR length(instructions) <= 4000),
  CHECK (required_skills <@ ARRAY['fiber','wireless','copper','cpe','survey','maintenance']::text[]),
  CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_typeof(outcome) = 'object'),
  CHECK ((window_start IS NULL) = (window_end IS NULL)),
  CHECK (window_end IS NULL OR window_end > window_start),
  CHECK (kind <> 'installation' OR installation_id IS NOT NULL),
  CHECK (status NOT IN ('scheduled','dispatched','on_site') OR window_start IS NOT NULL),
  CHECK (status NOT IN ('dispatched','on_site') OR technician_id IS NOT NULL),
  CHECK ((status IN ('completed','failed','cancelled')) = (closed_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failure_reason IS NOT NULL)
);
CREATE INDEX operations_work_orders_board_idx
  ON operations_work_orders(tenant_id, status, window_start);
CREATE INDEX operations_work_orders_technician_idx
  ON operations_work_orders(tenant_id, technician_id, window_start);
-- One live work order per installation: a second one is a revisit created on failure.
CREATE UNIQUE INDEX operations_work_orders_live_installation_idx
  ON operations_work_orders(tenant_id, installation_id)
  WHERE installation_id IS NOT NULL AND status NOT IN ('completed','failed','cancelled');

CREATE TABLE operations_work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_order_id uuid,
  technician_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) >= 8),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  evidence text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES operations_work_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, technician_id) REFERENCES operations_field_technicians(tenant_id, id),
  CHECK (work_order_id IS NOT NULL OR technician_id IS NOT NULL)
);
CREATE INDEX operations_work_order_events_order_idx
  ON operations_work_order_events(tenant_id, work_order_id, occurred_at DESC);

CREATE TRIGGER work_order_event_immutable
 BEFORE UPDATE OR DELETE ON operations_work_order_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER work_order_event_no_truncate
 BEFORE TRUNCATE ON operations_work_order_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER work_order_no_delete BEFORE DELETE ON operations_work_orders
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER field_technician_no_delete BEFORE DELETE ON operations_field_technicians
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- A technician is visible inside the home-branch scope and always to the technician themself.
CREATE FUNCTION field_technician_scope_allows(target_tenant_id uuid, target_branch_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT operations_scope_allows(target_tenant_id, target_branch_id)
    OR EXISTS (
      SELECT 1 FROM operations_current_context() c
      WHERE c.tenant_id = target_tenant_id AND c.actor_id = target_user_id::text
    )
$$;
CREATE FUNCTION work_order_scope_allows(target_tenant_id uuid, target_work_order_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_work_orders w
    WHERE w.tenant_id = target_tenant_id AND w.id = target_work_order_id
      AND operations_scope_allows(w.tenant_id, w.branch_id, w.area_id, w.route_id, w.id)
  )
$$;
REVOKE ALL ON FUNCTION field_technician_scope_allows(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION work_order_scope_allows(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION field_technician_scope_allows(uuid,uuid,uuid) TO orvex_runtime;
GRANT EXECUTE ON FUNCTION work_order_scope_allows(uuid,uuid) TO orvex_runtime;

ALTER TABLE operations_field_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_field_technicians FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_work_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_work_order_events FORCE ROW LEVEL SECURITY;
CREATE POLICY field_technician_scope ON operations_field_technicians
  USING (field_technician_scope_allows(tenant_id, branch_id, user_id))
  WITH CHECK (field_technician_scope_allows(tenant_id, branch_id, user_id));
CREATE POLICY work_order_scope ON operations_work_orders
  USING (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id))
  WITH CHECK (operations_scope_allows(tenant_id, branch_id, area_id, route_id, id));
CREATE POLICY work_order_event_scope ON operations_work_order_events
  USING (
    (work_order_id IS NOT NULL AND work_order_scope_allows(tenant_id, work_order_id))
    OR (work_order_id IS NULL AND EXISTS (
      SELECT 1 FROM operations_field_technicians t
      WHERE t.tenant_id = operations_work_order_events.tenant_id AND t.id = operations_work_order_events.technician_id
        AND field_technician_scope_allows(t.tenant_id, t.branch_id, t.user_id)))
  )
  WITH CHECK (
    (work_order_id IS NOT NULL AND work_order_scope_allows(tenant_id, work_order_id))
    OR (work_order_id IS NULL AND technician_id IS NOT NULL)
  );
REVOKE ALL ON operations_field_technicians, operations_work_orders, operations_work_order_events
  FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_field_technicians, operations_work_orders, operations_work_order_events
  TO orvex_runtime;

-- Order-task synchronisation now accepts field-service actions alongside the direct transition.
CREATE OR REPLACE FUNCTION sync_sales_order_installation_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE;
BEGIN
  IF NEW.sales_order_id IS NULL OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND OR context_row.tenant_id<>NEW.tenant_id
    OR context_row.permission<>'tenant.installation.manage'
    OR context_row.action NOT IN ('tenant.installation.transition','tenant.field.dispatch','tenant.field.execute') THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed installation transition is required';
  END IF;

  IF NEW.status='blocked' THEN
    UPDATE sales_order_tasks SET status='blocked',last_error=NEW.blocker_reason
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status IN ('ready','running');
  ELSIF NEW.status='scheduled' THEN
    UPDATE sales_order_tasks SET status='ready',last_error=NULL
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='blocked';
  ELSIF NEW.status='in_progress' THEN
    UPDATE sales_order_tasks SET status='running',last_error=NULL
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='ready';
  ELSIF NEW.status='cancelled' THEN
    UPDATE sales_order_tasks SET status='cancelled',last_error='installation cancelled'
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status IN ('ready','running','blocked');
  ELSIF NEW.status='completed' THEN
    UPDATE sales_order_tasks SET status='completed',last_error=NULL,completed_by=context_row.actor_id::uuid,
      result_reference=coalesce(result_reference,'{}'::jsonb)||jsonb_build_object(
        'installationId',NEW.id,'serviceId',NEW.service_id,'installationStatus',NEW.status
      )
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='installation' AND status='running';
    UPDATE sales_order_tasks SET status='ready'
    WHERE tenant_id=NEW.tenant_id AND order_id=NEW.sales_order_id
      AND task_key='network_activation' AND status='pending'
      AND EXISTS(
        SELECT 1 FROM sales_order_tasks installation_task
        WHERE installation_task.tenant_id=NEW.tenant_id
          AND installation_task.order_id=NEW.sales_order_id
          AND installation_task.task_key='installation'
          AND installation_task.status='completed'
      );
  END IF;
  RETURN NEW;
END $$;

-- Installation transitions driven by field work reuse the installation event ledger, so the
-- sales workspace and Subscriber 360 keep one history regardless of which screen acted.
CREATE FUNCTION field_service_transition_installation(
  p_tenant_id uuid, p_installation_id uuid, p_to_status operations_installation_status,
  p_note text, p_evidence jsonb, p_actor_id text, p_idempotency_key text,
  p_scheduled_for timestamptz, p_installer_user_id uuid, p_blocker_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE inst operations_installations%ROWTYPE; allowed boolean;
BEGIN
  SELECT * INTO inst FROM operations_installations
   WHERE tenant_id = p_tenant_id AND id = p_installation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='linked installation is outside the current scope';
  END IF;
  IF inst.status = p_to_status AND p_to_status = 'scheduled' THEN
    -- Rescheduling keeps the status and only moves the appointment.
    UPDATE operations_installations SET scheduled_for = p_scheduled_for,
      installer_user_id = coalesce(p_installer_user_id, installer_user_id),
      version = version + 1, updated_at = clock_timestamp()
     WHERE tenant_id = p_tenant_id AND id = p_installation_id;
    RETURN;
  END IF;
  allowed := CASE inst.status
    WHEN 'requested' THEN p_to_status IN ('scheduled','cancelled')
    WHEN 'scheduled' THEN p_to_status IN ('in_progress','blocked','cancelled')
    WHEN 'in_progress' THEN p_to_status IN ('blocked','ready_for_activation','cancelled')
    WHEN 'blocked' THEN p_to_status IN ('scheduled','in_progress','cancelled')
    WHEN 'ready_for_activation' THEN p_to_status IN ('completed','blocked')
    ELSE false END;
  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
      MESSAGE = format('installation is %s and cannot move to %s from field work', inst.status, p_to_status);
  END IF;
  INSERT INTO operations_installation_events(tenant_id, installation_id, from_status, to_status, note,
    evidence, expected_version, actor_id, idempotency_key)
  VALUES (p_tenant_id, p_installation_id, inst.status, p_to_status, p_note, coalesce(p_evidence, '{}'::jsonb),
    inst.version, p_actor_id, p_idempotency_key);
  UPDATE operations_installations SET status = p_to_status,
    scheduled_for = coalesce(p_scheduled_for, scheduled_for),
    installer_user_id = coalesce(p_installer_user_id, installer_user_id),
    blocker_reason = CASE WHEN p_to_status = 'blocked' THEN p_blocker_reason ELSE NULL END,
    version = version + 1, updated_at = clock_timestamp()
   WHERE tenant_id = p_tenant_id AND id = p_installation_id;
END $$;
REVOKE ALL ON FUNCTION field_service_transition_installation(uuid,uuid,operations_installation_status,text,jsonb,text,text,timestamptz,uuid,text) FROM PUBLIC;

CREATE FUNCTION execute_field_service_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE c operations_request_contexts%ROWTYPE; prior operations_work_order_events%ROWTYPE;
 tech operations_field_technicians%ROWTYPE; wo operations_work_orders%ROWTYPE;
 revisit operations_work_orders%ROWTYPE; sub operations_subscribers%ROWTYPE;
 answer jsonb; before_value jsonb; action text; from_status text; kind text;
 window_start timestamptz; window_end timestamptz; item jsonb; checklist jsonb; skills text[];
 areas uuid[]; tenant_wide boolean; number text; missing integer;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 action := payload->>'action';
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.permission <> 'tenant.installation.manage'
   OR c.action NOT IN ('tenant.field.dispatch','tenant.field.execute') THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='signed field service authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='complete bilingual field evidence is required';
 END IF;
 IF (c.action = 'tenant.field.dispatch' AND action NOT IN ('register_technician','update_technician',
      'create_work_order','schedule_work_order','assign_work_order','cancel_work_order'))
   OR (c.action = 'tenant.field.execute' AND action NOT IN ('start_work_order','complete_work_order','fail_work_order')) THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='the signed field action does not cover this command';
 END IF;
 tenant_wide := c.branch_ids IS NULL AND c.area_ids IS NULL AND c.route_ids IS NULL AND c.record_ids IS NULL;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':field:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_work_order_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='field service retry key belongs to different content';
  END IF;
  RETURN prior.result || jsonb_build_object('replayed', true);
 END IF;

 CASE action
 WHEN 'register_technician' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','userId','displayName','phone','skills','branchId','areaIds','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown technician field'; END IF;
  SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO skills FROM jsonb_array_elements_text(coalesce(payload->'skills','[]'::jsonb));
  SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[]) INTO areas FROM jsonb_array_elements_text(coalesce(payload->'areaIds','[]'::jsonb));
  IF NOT EXISTS(SELECT 1 FROM tenant_memberships m WHERE m.tenant_id=c.tenant_id
      AND m.user_id=(payload->>'userId')::uuid AND m.active) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the technician must be an active member of this workspace'; END IF;
  IF EXISTS(SELECT 1 FROM operations_field_technicians t WHERE t.tenant_id=c.tenant_id AND t.user_id=(payload->>'userId')::uuid) THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='this member is already registered as a technician'; END IF;
  IF cardinality(areas) > 0 AND EXISTS(SELECT 1 FROM unnest(areas) a WHERE NOT EXISTS(
      SELECT 1 FROM operations_areas ar WHERE ar.tenant_id=c.tenant_id AND ar.id=a)) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='a territory area does not exist'; END IF;
  INSERT INTO operations_field_technicians(tenant_id,user_id,display_name,phone,skills,branch_id,area_ids)
  VALUES(c.tenant_id,(payload->>'userId')::uuid,btrim(payload->>'displayName'),nullif(btrim(payload->>'phone'),''),
    skills,nullif(payload->>'branchId','')::uuid,areas)
  RETURNING * INTO tech;
  answer := jsonb_build_object('technicianId',tech.id,'version',tech.version,'active',tech.active);
  INSERT INTO operations_work_order_events(tenant_id,technician_id,action,actor_id,session_id,request_id,
    idempotency_key,request_payload,result,reason_en,reason_ar,evidence)
  VALUES(c.tenant_id,tech.id,action,c.actor_id,c.session_id,c.request_id,c.idempotency_key,payload,answer,
    btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),btrim(payload->>'evidence'));
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,'operations_field_technicians',tech.id::text,c.actor_id,c.session_id,c.permission,
    c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,NULL,to_jsonb(tech));
  RETURN answer || jsonb_build_object('replayed', false);

 WHEN 'update_technician' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','technicianId','expectedVersion','displayName','phone','skills','branchId','areaIds','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown technician field'; END IF;
  SELECT * INTO tech FROM operations_field_technicians
   WHERE tenant_id=c.tenant_id AND id=(payload->>'technicianId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='technician is outside the current scope'; END IF;
  IF tech.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='technician changed; refresh before saving'; END IF;
  before_value := to_jsonb(tech);
  SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO skills FROM jsonb_array_elements_text(coalesce(payload->'skills','[]'::jsonb));
  SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[]) INTO areas FROM jsonb_array_elements_text(coalesce(payload->'areaIds','[]'::jsonb));
  IF (payload->>'active')::boolean IS FALSE AND EXISTS(SELECT 1 FROM operations_work_orders w
      WHERE w.tenant_id=c.tenant_id AND w.technician_id=tech.id AND w.status IN ('dispatched','on_site')) THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='reassign dispatched work before deactivating this technician'; END IF;
  UPDATE operations_field_technicians SET display_name=btrim(payload->>'displayName'),
    phone=nullif(btrim(payload->>'phone'),''), skills=skills, branch_id=nullif(payload->>'branchId','')::uuid,
    area_ids=areas, active=coalesce((payload->>'active')::boolean,true), version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=tech.id RETURNING * INTO tech;
  answer := jsonb_build_object('technicianId',tech.id,'version',tech.version,'active',tech.active);
  INSERT INTO operations_work_order_events(tenant_id,technician_id,action,actor_id,session_id,request_id,
    idempotency_key,request_payload,result,reason_en,reason_ar,evidence)
  VALUES(c.tenant_id,tech.id,action,c.actor_id,c.session_id,c.request_id,c.idempotency_key,payload,answer,
    btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),btrim(payload->>'evidence'));
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,'operations_field_technicians',tech.id::text,c.actor_id,c.session_id,c.permission,
    c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(tech));
  RETURN answer || jsonb_build_object('replayed', false);

 WHEN 'create_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','kind','priority','serviceId','subscriberId','installationId','locationId','titleEn','titleAr',
     'instructions','requiredSkills','checklist','windowStart','windowEnd','slaDueAt','technicianId','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown work order field'; END IF;
  kind := payload->>'kind';
  wo.subscriber_id := nullif(payload->>'subscriberId','')::uuid;
  wo.service_id := nullif(payload->>'serviceId','')::uuid;
  wo.installation_id := nullif(payload->>'installationId','')::uuid;
  wo.location_id := nullif(payload->>'locationId','')::uuid;
  IF wo.installation_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM operations_installations i WHERE i.tenant_id=c.tenant_id AND i.id=wo.installation_id
       AND i.status NOT IN ('completed','cancelled')) THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the installation is outside scope or already closed'; END IF;
   SELECT i.service_id INTO wo.service_id FROM operations_installations i WHERE i.tenant_id=c.tenant_id AND i.id=wo.installation_id;
  END IF;
  IF wo.service_id IS NOT NULL THEN
   SELECT s.subscriber_id, s.location_id INTO wo.subscriber_id, wo.location_id
    FROM operations_services s WHERE s.tenant_id=c.tenant_id AND s.id=wo.service_id;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the service is outside the current scope'; END IF;
  END IF;
  IF wo.subscriber_id IS NOT NULL THEN
   SELECT * INTO sub FROM operations_subscribers WHERE tenant_id=c.tenant_id AND id=wo.subscriber_id;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the subscriber is outside the current scope'; END IF;
   wo.branch_id := sub.branch_id; wo.area_id := sub.area_id; wo.route_id := sub.route_id;
   wo.location_id := coalesce(wo.location_id, sub.primary_location_id);
  ELSIF NOT tenant_wide THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='only a tenant-wide dispatcher can open work without a subscriber';
  END IF;
  IF wo.installation_id IS NOT NULL THEN
   SELECT i.branch_id, i.area_id, i.route_id INTO wo.branch_id, wo.area_id, wo.route_id
    FROM operations_installations i WHERE i.tenant_id=c.tenant_id AND i.id=wo.installation_id;
  END IF;
  SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO skills FROM jsonb_array_elements_text(coalesce(payload->'requiredSkills','[]'::jsonb));
  checklist := coalesce(payload->'checklist', '[]'::jsonb);
  IF jsonb_typeof(checklist) <> 'array' OR jsonb_array_length(checklist) > 40 THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='checklist must be an array of at most 40 items'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(checklist) LOOP
   IF jsonb_typeof(item) <> 'object' OR length(btrim(coalesce(item->>'key',''))) NOT BETWEEN 1 AND 40
     OR length(btrim(coalesce(item->>'labelEn',''))) NOT BETWEEN 1 AND 200
     OR length(btrim(coalesce(item->>'labelAr',''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='each checklist item needs a key and bilingual labels'; END IF;
  END LOOP;
  window_start := nullif(payload->>'windowStart','')::timestamptz;
  window_end := nullif(payload->>'windowEnd','')::timestamptz;
  number := 'WO-'||to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDD')||'-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO operations_work_orders(tenant_id,work_order_number,kind,priority,status,subscriber_id,service_id,
    installation_id,location_id,branch_id,area_id,route_id,window_start,window_end,sla_due_at,title_en,title_ar,
    instructions,required_skills,checklist,created_by)
  VALUES(c.tenant_id,number,kind,coalesce(payload->>'priority','normal'),
    CASE WHEN window_start IS NULL THEN 'open' ELSE 'scheduled' END,
    wo.subscriber_id,wo.service_id,wo.installation_id,wo.location_id,wo.branch_id,wo.area_id,wo.route_id,
    window_start,window_end,nullif(payload->>'slaDueAt','')::timestamptz,btrim(payload->>'titleEn'),btrim(payload->>'titleAr'),
    nullif(btrim(payload->>'instructions'),''),skills,checklist,c.actor_id)
  RETURNING * INTO wo;
  IF nullif(payload->>'technicianId','') IS NOT NULL THEN
   IF window_start IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='assigning a technician requires an appointment window'; END IF;
   SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=(payload->>'technicianId')::uuid AND active;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician is inactive or outside scope'; END IF;
   IF NOT (wo.required_skills <@ tech.skills) THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician lacks a required skill for this work'; END IF;
   UPDATE operations_work_orders SET technician_id=tech.id, status='dispatched', dispatched_at=clock_timestamp(),
     version=version+1, updated_at=clock_timestamp() WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  END IF;
  IF wo.installation_id IS NOT NULL AND wo.window_start IS NOT NULL THEN
   PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'scheduled',
     'Scheduled from field work order '||wo.work_order_number,
     jsonb_build_object('workOrderId',wo.id,'scheduledFor',wo.window_start,'installerUserId',tech.user_id),
     c.actor_id, c.idempotency_key||':installation', wo.window_start, tech.user_id, NULL);
  END IF;
  from_status := NULL;

 WHEN 'schedule_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','windowStart','windowEnd','technicianId','slaDueAt','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown scheduling field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status NOT IN ('open','scheduled','dispatched') THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only open, scheduled or dispatched work can be scheduled'; END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  window_start := (payload->>'windowStart')::timestamptz; window_end := (payload->>'windowEnd')::timestamptz;
  IF nullif(payload->>'technicianId','') IS NOT NULL THEN
   SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=(payload->>'technicianId')::uuid AND active;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician is inactive or outside scope'; END IF;
   IF NOT (wo.required_skills <@ tech.skills) THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician lacks a required skill for this work'; END IF;
  ELSIF wo.technician_id IS NOT NULL THEN
   SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=wo.technician_id;
  END IF;
  UPDATE operations_work_orders SET window_start=window_start, window_end=window_end,
    sla_due_at=coalesce(nullif(payload->>'slaDueAt','')::timestamptz, sla_due_at),
    technician_id=CASE WHEN nullif(payload->>'technicianId','') IS NOT NULL THEN tech.id ELSE technician_id END,
    status=CASE WHEN coalesce(nullif(payload->>'technicianId','')::uuid, technician_id) IS NOT NULL THEN 'dispatched' ELSE 'scheduled' END,
    dispatched_at=CASE WHEN coalesce(nullif(payload->>'technicianId','')::uuid, technician_id) IS NOT NULL THEN coalesce(dispatched_at, clock_timestamp()) ELSE NULL END,
    version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  IF wo.installation_id IS NOT NULL THEN
   PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'scheduled',
     'Scheduled from field work order '||wo.work_order_number,
     jsonb_build_object('workOrderId',wo.id,'scheduledFor',wo.window_start,'installerUserId',tech.user_id),
     c.actor_id, c.idempotency_key||':installation', wo.window_start, tech.user_id, NULL);
  END IF;

 WHEN 'assign_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','technicianId','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown assignment field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status NOT IN ('scheduled','dispatched') THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='schedule an appointment window before assigning a technician'; END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  IF nullif(payload->>'technicianId','') IS NULL THEN
   UPDATE operations_work_orders SET technician_id=NULL, status='scheduled', dispatched_at=NULL,
     version=version+1, updated_at=clock_timestamp() WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  ELSE
   SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=(payload->>'technicianId')::uuid AND active;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician is inactive or outside scope'; END IF;
   IF NOT (wo.required_skills <@ tech.skills) THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='technician lacks a required skill for this work'; END IF;
   UPDATE operations_work_orders SET technician_id=tech.id, status='dispatched', dispatched_at=clock_timestamp(),
     version=version+1, updated_at=clock_timestamp() WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
   IF wo.installation_id IS NOT NULL THEN
    -- Dispatching a revisit re-schedules a blocked installation; otherwise only the installer changes.
    IF EXISTS(SELECT 1 FROM operations_installations i WHERE i.tenant_id=c.tenant_id AND i.id=wo.installation_id
        AND i.status IN ('requested','blocked')) THEN
     PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'scheduled',
       'Dispatched from field work order '||wo.work_order_number,
       jsonb_build_object('workOrderId',wo.id,'scheduledFor',wo.window_start,'installerUserId',tech.user_id),
       c.actor_id, c.idempotency_key||':installation', wo.window_start, tech.user_id, NULL);
    ELSE
     UPDATE operations_installations SET installer_user_id=tech.user_id, version=version+1, updated_at=clock_timestamp()
      WHERE tenant_id=c.tenant_id AND id=wo.installation_id;
    END IF;
   END IF;
  END IF;

 WHEN 'cancel_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown cancellation field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status IN ('on_site','completed','failed','cancelled') THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work on site or already closed cannot be cancelled'; END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  UPDATE operations_work_orders SET status='cancelled', closed_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;

 WHEN 'start_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown start field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status <> 'dispatched' THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only dispatched work can be started on site'; END IF;
  SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=wo.technician_id;
  IF NOT tenant_wide AND tech.user_id::text <> c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='only the assigned technician or a tenant-wide dispatcher can start this work'; END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  UPDATE operations_work_orders SET status='on_site', started_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  IF wo.installation_id IS NOT NULL THEN
   PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'in_progress',
     'Field work started on site for '||wo.work_order_number, jsonb_build_object('workOrderId',wo.id),
     c.actor_id, c.idempotency_key||':installation', NULL, NULL, NULL);
  END IF;

 WHEN 'complete_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','checklist','outcome','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown completion field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status <> 'on_site' THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only work in progress on site can be completed'; END IF;
  SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=wo.technician_id;
  IF NOT tenant_wide AND tech.user_id::text <> c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='only the assigned technician or a tenant-wide dispatcher can complete this work'; END IF;
  IF jsonb_typeof(coalesce(payload->'outcome','{}'::jsonb)) <> 'object' THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='outcome must be an object'; END IF;
  -- Every required checklist item must be reported done, by key, in the completion payload.
  checklist := coalesce(payload->'checklist','[]'::jsonb);
  SELECT count(*) INTO missing FROM jsonb_array_elements(wo.checklist) req
   WHERE coalesce((req->>'required')::boolean, true)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(checklist) done
       WHERE done->>'key' = req->>'key' AND (done->>'done')::boolean IS TRUE);
  IF missing > 0 THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE=format('%s required checklist item(s) are not done', missing); END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  UPDATE operations_work_orders SET status='completed', closed_at=clock_timestamp(),
    checklist=(SELECT coalesce(jsonb_agg(req || coalesce((SELECT to_jsonb(done) - 'key' FROM jsonb_array_elements(checklist) done WHERE done->>'key'=req->>'key' LIMIT 1),'{}'::jsonb)),'[]'::jsonb)
      FROM jsonb_array_elements(wo.checklist) req),
    outcome=coalesce(payload->'outcome','{}'::jsonb), version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  IF wo.installation_id IS NOT NULL THEN
   PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'ready_for_activation',
     'Field work completed for '||wo.work_order_number,
     jsonb_build_object('workOrderId',wo.id)||coalesce(payload->'outcome','{}'::jsonb),
     c.actor_id, c.idempotency_key||':installation', NULL, NULL, NULL);
  END IF;

 WHEN 'fail_work_order' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','workOrderId','expectedVersion','failureReason','revisitWindowStart','revisitWindowEnd','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown failure field'; END IF;
  SELECT * INTO wo FROM operations_work_orders WHERE tenant_id=c.tenant_id AND id=(payload->>'workOrderId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='work order is outside the current scope'; END IF;
  IF wo.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='work order changed; refresh before saving'; END IF;
  IF wo.status NOT IN ('dispatched','on_site') THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only dispatched or on-site work can fail'; END IF;
  IF length(btrim(coalesce(payload->>'failureReason',''))) NOT BETWEEN 8 AND 1000 THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='a failure reason of 8 to 1000 characters is required'; END IF;
  SELECT * INTO tech FROM operations_field_technicians WHERE tenant_id=c.tenant_id AND id=wo.technician_id;
  IF NOT tenant_wide AND tech.user_id::text <> c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='only the assigned technician or a tenant-wide dispatcher can fail this work'; END IF;
  before_value := to_jsonb(wo); from_status := wo.status;
  UPDATE operations_work_orders SET status='failed', failure_reason=btrim(payload->>'failureReason'),
    closed_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
   WHERE tenant_id=c.tenant_id AND id=wo.id RETURNING * INTO wo;
  window_start := nullif(payload->>'revisitWindowStart','')::timestamptz;
  window_end := nullif(payload->>'revisitWindowEnd','')::timestamptz;
  -- A revisit keeps the same checklist and skills; it is unassigned so the dispatcher decides.
  INSERT INTO operations_work_orders(tenant_id,work_order_number,kind,priority,status,subscriber_id,service_id,
    installation_id,location_id,branch_id,area_id,route_id,window_start,window_end,sla_due_at,title_en,title_ar,
    instructions,required_skills,checklist,revisit_of,created_by)
  VALUES(c.tenant_id,'WO-'||to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDD')||'-'||upper(substr(md5(gen_random_uuid()::text),1,6)),
    wo.kind,wo.priority,CASE WHEN window_start IS NULL THEN 'open' ELSE 'scheduled' END,wo.subscriber_id,wo.service_id,
    wo.installation_id,wo.location_id,wo.branch_id,wo.area_id,wo.route_id,window_start,window_end,wo.sla_due_at,
    'Revisit: '||wo.title_en,'إعادة زيارة: '||wo.title_ar,wo.instructions,wo.required_skills,
    (SELECT coalesce(jsonb_agg(req - 'done' - 'note'),'[]'::jsonb) FROM jsonb_array_elements(wo.checklist) req),
    wo.id,c.actor_id)
  RETURNING * INTO revisit;
  IF wo.installation_id IS NOT NULL THEN
   PERFORM field_service_transition_installation(c.tenant_id, wo.installation_id, 'blocked',
     'Field work failed for '||wo.work_order_number, jsonb_build_object('workOrderId',wo.id,'revisitWorkOrderId',revisit.id),
     c.actor_id, c.idempotency_key||':installation', NULL, NULL, btrim(payload->>'failureReason'));
  END IF;
 ELSE
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown field service command';
 END CASE;

 answer := jsonb_build_object('workOrderId',wo.id,'workOrderNumber',wo.work_order_number,'status',wo.status,
   'version',wo.version,'technicianId',wo.technician_id,'installationId',wo.installation_id)
   || CASE WHEN revisit.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('revisitWorkOrderId',revisit.id,'revisitWorkOrderNumber',revisit.work_order_number) END;
 INSERT INTO operations_work_order_events(tenant_id,work_order_id,technician_id,action,from_status,to_status,actor_id,
   session_id,request_id,idempotency_key,request_payload,result,reason_en,reason_ar,evidence)
 VALUES(c.tenant_id,wo.id,wo.technician_id,action,from_status,wo.status,c.actor_id,c.session_id,c.request_id,
   c.idempotency_key,payload,answer,btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),btrim(payload->>'evidence'));
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_work_orders',wo.id::text,c.actor_id,c.session_id,c.permission,
   c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(wo));
 RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_field_service_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_field_service_command(jsonb) TO orvex_runtime;

-- Installation rows and their events may now also be written by field-service commands. The
-- allow-list is otherwise identical to 202608310800_tenant_usage_addon_rating.sql.
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
