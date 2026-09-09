-- 202609090400_tenant_customer_service.sql
-- Customer service and communications: support tickets gain category, intake channel, caller
-- verification, SLA targets, first-response tracking, escalation, an outage link, reopen and
-- redress; internal notes; approved bilingual message templates; subscriber channel consent;
-- and a notification outbox whose delivery is recorded with provider evidence.

ALTER TABLE operations_support_issues
  ADD COLUMN category text NOT NULL DEFAULT 'other' CHECK (category IN ('technical', 'billing', 'complaint', 'request', 'other')),
  ADD COLUMN channel text NOT NULL DEFAULT 'internal' CHECK (channel IN ('walk_in', 'phone', 'whatsapp', 'email', 'field', 'internal')),
  ADD COLUMN verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN sla_respond_due_at timestamptz,
  ADD COLUMN sla_resolve_due_at timestamptz,
  ADD COLUMN first_response_at timestamptz,
  ADD COLUMN escalated_to_user_id uuid REFERENCES users(id),
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN outage_id uuid,
  ADD COLUMN reopen_count integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  ADD COLUMN redress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN last_note_at timestamptz,
  ADD CONSTRAINT support_issue_outage_tenant FOREIGN KEY (tenant_id, outage_id) REFERENCES operations_outages(tenant_id, id),
  ADD CONSTRAINT support_issue_verification_safe CHECK (NOT operations_json_contains_secret_key(verification)),
  ADD CONSTRAINT support_issue_redress_safe CHECK (NOT operations_json_contains_secret_key(redress)),
  ADD CONSTRAINT support_issue_escalation_consistency CHECK ((escalated_to_user_id IS NULL) = (escalated_at IS NULL));
CREATE INDEX support_issue_sla_idx ON operations_support_issues(tenant_id, status, sla_resolve_due_at);

CREATE TABLE operations_issue_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  issue_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 4000),
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'customer_contact', 'escalation', 'redress', 'reopen')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, issue_id) REFERENCES operations_support_issues(tenant_id, id)
);
CREATE INDEX issue_notes_idx ON operations_issue_notes(tenant_id, issue_id, created_at);

CREATE TABLE operations_support_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  issue_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, issue_id) REFERENCES operations_support_issues(tenant_id, id),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

CREATE TABLE operations_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9][a-z0-9_.-]{2,79}$'),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 2 AND 150),
  name_ar text NOT NULL CHECK (length(btrim(name_ar)) BETWEEN 2 AND 150),
  subject_en text CHECK (subject_en IS NULL OR length(btrim(subject_en)) BETWEEN 2 AND 200),
  subject_ar text CHECK (subject_ar IS NULL OR length(btrim(subject_ar)) BETWEEN 2 AND 200),
  body_en text NOT NULL CHECK (length(btrim(body_en)) BETWEEN 3 AND 4000),
  body_ar text NOT NULL CHECK (length(btrim(body_ar)) BETWEEN 3 AND 4000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, template_key),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL) OR status = 'retired'),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CHECK (channel <> 'email' OR (subject_en IS NOT NULL AND subject_ar IS NOT NULL))
);

CREATE TABLE operations_subscriber_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  allowed boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('customer_request', 'contract', 'regulatory', 'staff')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id)
);
CREATE INDEX subscriber_consents_idx ON operations_subscriber_consents(tenant_id, subscriber_id, channel, recorded_at DESC);

CREATE TABLE operations_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  destination text CHECK (destination IS NULL OR length(destination) BETWEEN 3 AND 320),
  template_key text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'ar')),
  subject text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'suppressed', 'cancelled')),
  suppression_reason text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  provider_reference text,
  related_type text CHECK (related_type IS NULL OR related_type IN ('support_issue', 'outage', 'invoice', 'service', 'manual')),
  related_id uuid,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((status = 'suppressed') = (suppression_reason IS NOT NULL))
);
CREATE INDEX notification_outbox_queue_idx ON operations_notification_outbox(tenant_id, status, next_attempt_at) WHERE status = 'queued';
CREATE INDEX notification_outbox_subscriber_idx ON operations_notification_outbox(tenant_id, subscriber_id, created_at DESC);

CREATE TABLE operations_communication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('operations_message_templates', 'operations_subscriber_consents', 'operations_notification_outbox')),
  resource_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);

-- Row security: notes and support events follow the issue's scope; templates are tenant-wide;
-- consents and notifications follow the subscriber's scope.
ALTER TABLE operations_issue_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_issue_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_notes_scope ON operations_issue_notes
  USING (EXISTS (SELECT 1 FROM operations_support_issues i WHERE i.tenant_id = operations_issue_notes.tenant_id AND i.id = issue_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_support_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_support_events FORCE ROW LEVEL SECURITY;
CREATE POLICY support_events_scope ON operations_support_events
  USING (EXISTS (SELECT 1 FROM operations_support_issues i WHERE i.tenant_id = operations_support_events.tenant_id AND i.id = issue_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_message_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY message_templates_tenant ON operations_message_templates
  USING (tenant_id = (operations_current_context()).tenant_id AND (operations_current_context()).support_grant_id IS NULL)
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_subscriber_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_subscriber_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriber_consents_scope ON operations_subscriber_consents
  USING (operations_scope_allows_subscriber(tenant_id, subscriber_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_notification_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_outbox_scope ON operations_notification_outbox
  USING (operations_scope_allows_subscriber(tenant_id, subscriber_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_communication_events FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_events_tenant ON operations_communication_events
  USING (tenant_id = (operations_current_context()).tenant_id AND (operations_current_context()).support_grant_id IS NULL)
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);

REVOKE ALL ON operations_issue_notes, operations_support_events, operations_message_templates, operations_subscriber_consents,
  operations_notification_outbox, operations_communication_events FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_issue_notes, operations_support_events, operations_message_templates, operations_subscriber_consents,
  operations_notification_outbox, operations_communication_events TO orvex_runtime;

CREATE TRIGGER issue_notes_immutable BEFORE UPDATE OR DELETE ON operations_issue_notes
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER support_events_immutable BEFORE UPDATE OR DELETE ON operations_support_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER subscriber_consents_immutable BEFORE UPDATE OR DELETE ON operations_subscriber_consents
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER communication_events_immutable BEFORE UPDATE OR DELETE ON operations_communication_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER notification_outbox_no_delete BEFORE DELETE ON operations_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER message_templates_no_delete BEFORE DELETE ON operations_message_templates
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- SLA targets by priority: minutes to first response and to resolution.
CREATE FUNCTION support_sla_minutes(p_priority text) RETURNS integer[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_priority WHEN 'urgent' THEN ARRAY[60, 240] WHEN 'high' THEN ARRAY[240, 1440]
    WHEN 'normal' THEN ARRAY[480, 4320] ELSE ARRAY[1440, 7200] END
$$;

-- The audit outbox trigger admits the support command on the issue tables.
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

CREATE FUNCTION execute_support_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_support_events%ROWTYPE;
  issue operations_support_issues%ROWTYPE;
  sub operations_subscribers%ROWTYPE;
  svc operations_services%ROWTYPE;
  v_action text; answer jsonb; v_note text; sla integer[]; v_number text; v_method text; v_contact text;
  v_verification jsonb; v_user uuid; v_kind text;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.support.manage'
     OR c.permission <> 'tenant.subscriber.edit' THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed customer service authority required';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid support payload';
  END IF;
  v_action := payload->>'action';
  v_note := nullif(btrim(coalesce(payload->>'note', '')), '');
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':support:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_support_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'support retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'create_ticket' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'subject', 'description', 'priority', 'category', 'channel', 'subscriberId', 'serviceId', 'verification', 'outageId'))
       OR length(btrim(coalesce(payload->>'subject', ''))) NOT BETWEEN 3 AND 300
       OR length(btrim(coalesce(payload->>'description', ''))) NOT BETWEEN 3 AND 5000
       OR coalesce(payload->>'priority', 'normal') NOT IN ('low', 'normal', 'high', 'urgent')
       OR coalesce(payload->>'category', 'other') NOT IN ('technical', 'billing', 'complaint', 'request', 'other')
       OR coalesce(payload->>'channel', 'internal') NOT IN ('walk_in', 'phone', 'whatsapp', 'email', 'field', 'internal')
       OR (nullif(payload->>'subscriberId', '') IS NULL AND nullif(payload->>'serviceId', '') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid ticket details';
    END IF;
    IF nullif(payload->>'serviceId', '') IS NOT NULL THEN
      SELECT * INTO svc FROM operations_services WHERE tenant_id = c.tenant_id AND id = (payload->>'serviceId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'service missing or outside scope'; END IF;
    END IF;
    SELECT * INTO sub FROM operations_subscribers WHERE tenant_id = c.tenant_id
      AND id = coalesce(nullif(payload->>'subscriberId', '')::uuid, svc.subscriber_id);
    IF NOT FOUND OR (svc.id IS NOT NULL AND svc.subscriber_id <> sub.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'subscriber missing, outside scope or not the service owner';
    END IF;
    -- Caller verification: a contact match must name a live contact of this subscriber.
    v_verification := coalesce(payload->'verification', '{}'::jsonb);
    v_method := coalesce(v_verification->>'method', 'none');
    IF v_method NOT IN ('none', 'contact_match', 'id_document', 'account_reference') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid verification method';
    END IF;
    IF v_method = 'contact_match' THEN
      v_contact := btrim(coalesce(v_verification->>'contact', ''));
      IF v_contact = '' OR NOT EXISTS (SELECT 1 FROM operations_contacts ct WHERE ct.tenant_id = c.tenant_id AND ct.subscriber_id = sub.id
          AND ct.archived_at IS NULL AND lower(regexp_replace(ct.contact_value, '[\s-]', '', 'g')) = lower(regexp_replace(v_contact, '[\s-]', '', 'g'))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'the given contact does not match a live subscriber contact';
      END IF;
    ELSIF v_method <> 'none' AND length(btrim(coalesce(v_verification->>'reference', ''))) NOT BETWEEN 2 AND 200 THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'verification reference is required for this method';
    END IF;
    v_verification := jsonb_build_object('method', v_method, 'verifiedBy', c.actor_id, 'verifiedAt', clock_timestamp())
      || CASE WHEN v_method = 'contact_match' THEN jsonb_build_object('contact', v_contact)
         WHEN v_method <> 'none' THEN jsonb_build_object('reference', btrim(v_verification->>'reference')) ELSE '{}'::jsonb END;
    IF nullif(payload->>'outageId', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_outages o WHERE o.tenant_id = c.tenant_id AND o.id = (payload->>'outageId')::uuid) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'incident not found in scope';
    END IF;
    sla := support_sla_minutes(coalesce(payload->>'priority', 'normal'));
    v_number := 'TCK-' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    INSERT INTO operations_support_issues(tenant_id, issue_number, idempotency_key, subscriber_id, service_id, branch_id, area_id, route_id,
      subject, description, priority, category, channel, verification, sla_respond_due_at, sla_resolve_due_at, outage_id)
    VALUES (c.tenant_id, v_number, c.idempotency_key, sub.id, svc.id, sub.branch_id, sub.area_id, sub.route_id,
      btrim(payload->>'subject'), btrim(payload->>'description'), coalesce(payload->>'priority', 'normal'),
      coalesce(payload->>'category', 'other'), coalesce(payload->>'channel', 'internal'), v_verification,
      clock_timestamp() + make_interval(mins => sla[1]), clock_timestamp() + make_interval(mins => sla[2]),
      nullif(payload->>'outageId', '')::uuid)
    RETURNING * INTO issue;
    answer := jsonb_build_object('issueId', issue.id, 'issueNumber', issue.issue_number, 'status', issue.status, 'version', issue.version,
      'slaRespondDueAt', issue.sla_respond_due_at, 'slaResolveDueAt', issue.sla_resolve_due_at);

  ELSIF v_action IN ('add_note', 'escalate', 'link_outage', 'reopen', 'record_redress') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'issueId', 'expectedVersion', 'note', 'customerContact', 'toUserId', 'outageId', 'redressKind', 'reference')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid ticket command fields';
    END IF;
    SELECT * INTO issue FROM operations_support_issues WHERE tenant_id = c.tenant_id AND id = (payload->>'issueId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'ticket not found in scope'; END IF;
    IF issue.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'ticket changed; refresh before acting';
    END IF;
    IF v_action = 'add_note' THEN
      IF v_note IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a note is required'; END IF;
      IF issue.status = 'closed' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a closed ticket takes no notes; reopen it'; END IF;
      v_kind := CASE WHEN coalesce((payload->>'customerContact')::boolean, false) THEN 'customer_contact' ELSE 'note' END;
      INSERT INTO operations_issue_notes(tenant_id, issue_id, author_id, note, kind) VALUES (c.tenant_id, issue.id, c.actor_id::uuid, v_note, v_kind);
      UPDATE operations_support_issues SET last_note_at = clock_timestamp(),
        first_response_at = CASE WHEN v_kind = 'customer_contact' THEN coalesce(first_response_at, clock_timestamp()) ELSE first_response_at END,
        version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = issue.id RETURNING * INTO issue;
    ELSIF v_action = 'escalate' THEN
      v_user := nullif(payload->>'toUserId', '')::uuid;
      IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = c.tenant_id AND m.user_id = v_user) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'escalation target must be a workspace member';
      END IF;
      IF issue.status IN ('resolved', 'closed') THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a resolved ticket cannot be escalated'; END IF;
      INSERT INTO operations_issue_notes(tenant_id, issue_id, author_id, note, kind)
      VALUES (c.tenant_id, issue.id, c.actor_id::uuid, coalesce(v_note, 'Escalated'), 'escalation');
      UPDATE operations_support_issues SET escalated_to_user_id = v_user, escalated_at = clock_timestamp(), assignee_user_id = v_user,
        priority = CASE WHEN priority IN ('low', 'normal') THEN 'high' ELSE priority END,
        version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = issue.id RETURNING * INTO issue;
    ELSIF v_action = 'link_outage' THEN
      IF NOT EXISTS (SELECT 1 FROM operations_outages o WHERE o.tenant_id = c.tenant_id AND o.id = (payload->>'outageId')::uuid) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'incident not found in scope';
      END IF;
      UPDATE operations_support_issues SET outage_id = (payload->>'outageId')::uuid, version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = issue.id RETURNING * INTO issue;
    ELSIF v_action = 'reopen' THEN
      -- Closed tickets are terminal under the transition guard; a resolved one returns to work.
      IF issue.status <> 'resolved' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a resolved ticket can be reopened'; END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a reopen note is required'; END IF;
      INSERT INTO operations_issue_events(tenant_id, issue_id, from_status, to_status, note, actor_id, idempotency_key, evidence, expected_version)
      VALUES (c.tenant_id, issue.id, issue.status, 'in_progress', v_note, c.actor_id, c.idempotency_key || ':reopen', '{}'::jsonb, issue.version);
      INSERT INTO operations_issue_notes(tenant_id, issue_id, author_id, note, kind) VALUES (c.tenant_id, issue.id, c.actor_id::uuid, v_note, 'reopen');
      sla := support_sla_minutes(issue.priority);
      UPDATE operations_support_issues SET status = 'in_progress', closed_at = NULL, reopen_count = reopen_count + 1,
        sla_resolve_due_at = clock_timestamp() + make_interval(mins => sla[2]), version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = issue.id RETURNING * INTO issue;
    ELSE
      IF coalesce(payload->>'redressKind', '') NOT IN ('credit_note', 'goodwill', 'service_extension', 'none')
         OR (payload->>'redressKind' <> 'none' AND length(btrim(coalesce(payload->>'reference', ''))) NOT BETWEEN 2 AND 200) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'redress needs a kind and a document reference';
      END IF;
      INSERT INTO operations_issue_notes(tenant_id, issue_id, author_id, note, kind)
      VALUES (c.tenant_id, issue.id, c.actor_id::uuid, coalesce(v_note, 'Redress recorded: ' || (payload->>'redressKind')), 'redress');
      UPDATE operations_support_issues SET redress = jsonb_build_object('kind', payload->>'redressKind', 'reference', nullif(btrim(coalesce(payload->>'reference', '')), ''),
          'recordedBy', c.actor_id, 'recordedAt', clock_timestamp()),
        version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = issue.id RETURNING * INTO issue;
    END IF;
    answer := jsonb_build_object('issueId', issue.id, 'issueNumber', issue.issue_number, 'status', issue.status, 'version', issue.version,
      'reopenCount', issue.reopen_count, 'escalatedToUserId', issue.escalated_to_user_id, 'outageId', issue.outage_id);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown support action';
  END IF;

  INSERT INTO operations_support_events(tenant_id, action, issue_id, version, actor_id, idempotency_key, request_payload, result)
  VALUES (c.tenant_id, v_action, issue.id, issue.version, c.actor_id::uuid, c.idempotency_key, payload, answer);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_support_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_support_command(jsonb) TO orvex_runtime;

-- Template rendering: {{name}} placeholders replaced from a flat variables object; unknown
-- placeholders are left visible so a missing variable is never silently blank.
CREATE FUNCTION communication_render(p_template text, p_variables jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE result text := p_template; k text; v text;
BEGIN
  IF p_variables IS NOT NULL AND jsonb_typeof(p_variables) = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each_text(p_variables) LOOP
      IF k ~ '^[A-Za-z0-9_]{1,40}$' THEN
        result := replace(result, '{{' || k || '}}', coalesce(v, ''));
      END IF;
    END LOOP;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION execute_communication_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_communication_events%ROWTYPE;
  tpl operations_message_templates%ROWTYPE;
  consent operations_subscriber_consents%ROWTYPE;
  msg operations_notification_outbox%ROWTYPE;
  sub operations_subscribers%ROWTYPE;
  v_action text; resource_type text; resource_id uuid; answer jsonb; before_value jsonb; after_value jsonb;
  v_locale text; v_channel text; v_dest text; v_body text; v_subject text; v_suppress text; v_vars jsonb;
  allowed_permissions text[];
BEGIN
  SELECT * INTO c FROM operations_current_context();
  v_action := payload->>'action';
  allowed_permissions := CASE
    WHEN v_action IN ('upsert_template', 'approve_template', 'retire_template') THEN ARRAY['tenant.user.administer']
    WHEN v_action IN ('mark_delivery') THEN ARRAY['tenant.secret.manage']
    ELSE ARRAY['tenant.subscriber.edit'] END;
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.communication.manage'
     OR NOT (c.permission = ANY(allowed_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed communication authority required for this action';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload) THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid communication payload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':communication:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_communication_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'communication retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action = 'upsert_template' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'templateKey', 'expectedVersion', 'channel', 'nameEn', 'nameAr', 'subjectEn', 'subjectAr', 'bodyEn', 'bodyAr'))
       OR coalesce(payload->>'templateKey', '') !~ '^[a-z0-9][a-z0-9_.-]{2,79}$'
       OR coalesce(payload->>'channel', '') NOT IN ('sms', 'whatsapp', 'email') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid template details';
    END IF;
    SELECT * INTO tpl FROM operations_message_templates WHERE tenant_id = c.tenant_id AND template_key = payload->>'templateKey' FOR UPDATE;
    IF FOUND THEN
      IF tpl.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'template changed; refresh before saving';
      END IF;
      before_value := to_jsonb(tpl);
      -- Any content change returns the template to draft until it is approved again.
      UPDATE operations_message_templates SET channel = payload->>'channel', name_en = btrim(payload->>'nameEn'), name_ar = btrim(payload->>'nameAr'),
        subject_en = nullif(btrim(coalesce(payload->>'subjectEn', '')), ''), subject_ar = nullif(btrim(coalesce(payload->>'subjectAr', '')), ''),
        body_en = btrim(payload->>'bodyEn'), body_ar = btrim(payload->>'bodyAr'), status = 'draft', approved_by = NULL, approved_at = NULL,
        version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = tpl.id RETURNING * INTO tpl;
    ELSE
      INSERT INTO operations_message_templates(tenant_id, template_key, channel, name_en, name_ar, subject_en, subject_ar, body_en, body_ar, created_by)
      VALUES (c.tenant_id, payload->>'templateKey', payload->>'channel', btrim(payload->>'nameEn'), btrim(payload->>'nameAr'),
        nullif(btrim(coalesce(payload->>'subjectEn', '')), ''), nullif(btrim(coalesce(payload->>'subjectAr', '')), ''),
        btrim(payload->>'bodyEn'), btrim(payload->>'bodyAr'), c.actor_id::uuid)
      RETURNING * INTO tpl;
    END IF;
    resource_type := 'operations_message_templates'; resource_id := tpl.id; after_value := to_jsonb(tpl);
    answer := jsonb_build_object('templateId', tpl.id, 'templateKey', tpl.template_key, 'status', tpl.status, 'version', tpl.version);

  ELSIF v_action IN ('approve_template', 'retire_template') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'templateKey', 'expectedVersion')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid template command fields';
    END IF;
    SELECT * INTO tpl FROM operations_message_templates WHERE tenant_id = c.tenant_id AND template_key = payload->>'templateKey' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'template not found'; END IF;
    IF tpl.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'template changed; refresh before acting';
    END IF;
    before_value := to_jsonb(tpl);
    IF v_action = 'approve_template' THEN
      IF tpl.status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a draft template can be approved'; END IF;
      IF tpl.created_by::text = c.actor_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'a template must be approved by someone other than its author';
      END IF;
      UPDATE operations_message_templates SET status = 'approved', approved_by = c.actor_id::uuid, approved_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = tpl.id RETURNING * INTO tpl;
    ELSE
      UPDATE operations_message_templates SET status = 'retired', version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = tpl.id RETURNING * INTO tpl;
    END IF;
    resource_type := 'operations_message_templates'; resource_id := tpl.id; after_value := to_jsonb(tpl);
    answer := jsonb_build_object('templateId', tpl.id, 'templateKey', tpl.template_key, 'status', tpl.status, 'version', tpl.version);

  ELSIF v_action = 'record_consent' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'subscriberId', 'channel', 'allowed', 'source', 'note'))
       OR coalesce(payload->>'channel', '') NOT IN ('sms', 'whatsapp', 'email')
       OR jsonb_typeof(payload->'allowed') IS DISTINCT FROM 'boolean'
       OR coalesce(payload->>'source', '') NOT IN ('customer_request', 'contract', 'regulatory', 'staff') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid consent details';
    END IF;
    SELECT * INTO sub FROM operations_subscribers WHERE tenant_id = c.tenant_id AND id = (payload->>'subscriberId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'subscriber missing or outside scope'; END IF;
    INSERT INTO operations_subscriber_consents(tenant_id, subscriber_id, channel, allowed, source, note, recorded_by)
    VALUES (c.tenant_id, sub.id, payload->>'channel', (payload->>'allowed')::boolean, payload->>'source',
      nullif(btrim(coalesce(payload->>'note', '')), ''), c.actor_id::uuid) RETURNING * INTO consent;
    resource_type := 'operations_subscriber_consents'; resource_id := consent.id; after_value := to_jsonb(consent);
    answer := jsonb_build_object('consentId', consent.id, 'subscriberId', sub.id, 'channel', consent.channel, 'allowed', consent.allowed);

  ELSIF v_action = 'queue_notification' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'subscriberId', 'templateKey', 'locale', 'variables', 'destination', 'relatedType', 'relatedId'))
       OR coalesce(payload->>'locale', 'ar') NOT IN ('en', 'ar') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid notification request';
    END IF;
    SELECT * INTO sub FROM operations_subscribers WHERE tenant_id = c.tenant_id AND id = (payload->>'subscriberId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'subscriber missing or outside scope'; END IF;
    SELECT * INTO tpl FROM operations_message_templates WHERE tenant_id = c.tenant_id AND template_key = payload->>'templateKey';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'template not found'; END IF;
    IF tpl.status <> 'approved' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only an approved template can be sent'; END IF;
    v_channel := tpl.channel; v_locale := coalesce(payload->>'locale', 'ar');
    v_vars := coalesce(payload->'variables', '{}'::jsonb) || jsonb_build_object('subscriberName', sub.display_name, 'subscriberNumber', sub.subscriber_number);
    v_body := communication_render(CASE v_locale WHEN 'ar' THEN tpl.body_ar ELSE tpl.body_en END, v_vars);
    v_subject := communication_render(CASE v_locale WHEN 'ar' THEN tpl.subject_ar ELSE tpl.subject_en END, v_vars);
    -- Destination: explicit, else the subscriber's live primary contact for the channel.
    v_dest := nullif(btrim(coalesce(payload->>'destination', '')), '');
    IF v_dest IS NULL THEN
      SELECT ct.contact_value INTO v_dest FROM operations_contacts ct WHERE ct.tenant_id = c.tenant_id AND ct.subscriber_id = sub.id
        AND ct.archived_at IS NULL AND ct.contact_kind = CASE v_channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'whatsapp' ELSE 'phone' END
        ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1;
      IF v_dest IS NULL AND v_channel = 'whatsapp' THEN
        SELECT ct.contact_value INTO v_dest FROM operations_contacts ct WHERE ct.tenant_id = c.tenant_id AND ct.subscriber_id = sub.id
          AND ct.archived_at IS NULL AND ct.contact_kind = 'phone' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1;
      END IF;
    END IF;
    SELECT * INTO consent FROM operations_subscriber_consents WHERE tenant_id = c.tenant_id AND subscriber_id = sub.id AND channel = v_channel
      ORDER BY recorded_at DESC, id DESC LIMIT 1;
    v_suppress := CASE WHEN v_dest IS NULL THEN 'no_destination'
      WHEN consent.id IS NOT NULL AND NOT consent.allowed THEN 'consent_withdrawn' END;
    INSERT INTO operations_notification_outbox(tenant_id, subscriber_id, channel, destination, template_key, locale, subject, body, status,
      suppression_reason, related_type, related_id, requested_by)
    VALUES (c.tenant_id, sub.id, v_channel, v_dest, tpl.template_key, v_locale, v_subject, v_body,
      CASE WHEN v_suppress IS NULL THEN 'queued' ELSE 'suppressed' END, v_suppress,
      nullif(payload->>'relatedType', ''), nullif(payload->>'relatedId', '')::uuid, c.actor_id::uuid)
    RETURNING * INTO msg;
    resource_type := 'operations_notification_outbox'; resource_id := msg.id; after_value := to_jsonb(msg);
    answer := jsonb_build_object('notificationId', msg.id, 'status', msg.status, 'channel', msg.channel, 'suppressionReason', msg.suppression_reason,
      'version', msg.version);

  ELSIF v_action IN ('mark_delivery', 'cancel_notification') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'notificationId', 'expectedVersion', 'outcome', 'providerReference', 'error', 'note')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid delivery fields';
    END IF;
    SELECT * INTO msg FROM operations_notification_outbox WHERE tenant_id = c.tenant_id AND id = (payload->>'notificationId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'notification not found in scope'; END IF;
    IF msg.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'notification changed; refresh before acting';
    END IF;
    IF msg.status <> 'queued' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a queued notification can change'; END IF;
    before_value := to_jsonb(msg);
    IF v_action = 'cancel_notification' THEN
      UPDATE operations_notification_outbox SET status = 'cancelled', last_error = nullif(btrim(coalesce(payload->>'note', '')), ''),
        version = version + 1 WHERE tenant_id = c.tenant_id AND id = msg.id RETURNING * INTO msg;
    ELSIF coalesce(payload->>'outcome', '') = 'sent' THEN
      UPDATE operations_notification_outbox SET status = 'sent', sent_at = clock_timestamp(), attempts = attempts + 1,
        provider_reference = nullif(btrim(coalesce(payload->>'providerReference', '')), ''), last_error = NULL, version = version + 1
       WHERE tenant_id = c.tenant_id AND id = msg.id RETURNING * INTO msg;
    ELSIF coalesce(payload->>'outcome', '') = 'failed' THEN
      -- Retry with a growing delay; the fifth failure parks the message as failed.
      UPDATE operations_notification_outbox SET attempts = attempts + 1, last_error = left(coalesce(payload->>'error', 'delivery failed'), 500),
        status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END,
        next_attempt_at = clock_timestamp() + make_interval(mins => 15 * (attempts + 1)), version = version + 1
       WHERE tenant_id = c.tenant_id AND id = msg.id RETURNING * INTO msg;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'delivery outcome must be sent or failed';
    END IF;
    resource_type := 'operations_notification_outbox'; resource_id := msg.id; after_value := to_jsonb(msg);
    answer := jsonb_build_object('notificationId', msg.id, 'status', msg.status, 'attempts', msg.attempts, 'version', msg.version,
      'providerReference', msg.provider_reference);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown communication action';
  END IF;

  INSERT INTO operations_communication_events(tenant_id, action, resource_type, resource_id, actor_id, idempotency_key, request_payload, result)
  VALUES (c.tenant_id, v_action, resource_type, resource_id, c.actor_id::uuid, c.idempotency_key, payload, answer);
  INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id,
    permission, request_id, idempotency_key, ip_address, user_agent, result, reason, before_value, after_value)
  VALUES (c.tenant_id, c.action, resource_type, resource_id::text, c.actor_id, c.session_id, c.permission,
    c.request_id, c.idempotency_key, c.ip_address, c.user_agent, 'allowed', c.reason, before_value, after_value);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_communication_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_communication_command(jsonb) TO orvex_runtime;
