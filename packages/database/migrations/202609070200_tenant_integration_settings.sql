-- Tenant integration settings: each ISP configures its own SMTP, SMS and WhatsApp providers for
-- customer-facing communications. Non-secret configuration is JSON; provider secrets are stored
-- only as API-side AES-256-GCM ciphertext and are never part of a read projection or an event.

CREATE TABLE operations_integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('smtp','sms','whatsapp')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext bytea,
  secret_key_id text,
  secret_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  secret_fingerprint text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_test_at timestamptz,
  last_test_status text CHECK (last_test_status IN ('passed','failed')),
  last_test_message text,
  UNIQUE (tenant_id, kind),
  CHECK ((secret_ciphertext IS NULL) = (secret_key_id IS NULL)),
  CHECK ((secret_ciphertext IS NULL) = (cardinality(secret_fields) = 0)),
  CHECK ((secret_ciphertext IS NULL) = (secret_fingerprint IS NULL)),
  CHECK (NOT operations_json_contains_secret_key(config)),
  CHECK (config::text !~* '"[^" ]*api[_-]?key[^" ]*"[[:space:]]*:')
);

CREATE TABLE operations_integration_setting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  setting_id uuid NOT NULL REFERENCES operations_integration_settings(id),
  kind text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('configure','test')),
  actor_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) >= 8),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  evidence text NOT NULL,
  before_config jsonb,
  after_config jsonb,
  secret_changed boolean NOT NULL DEFAULT false,
  test_status text CHECK (test_status IN ('passed','failed')),
  test_message text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);
CREATE INDEX operations_integration_setting_events_setting_idx
  ON operations_integration_setting_events(tenant_id, setting_id, occurred_at DESC);

CREATE TRIGGER integration_setting_event_immutable
 BEFORE UPDATE OR DELETE ON operations_integration_setting_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER integration_setting_event_no_truncate
 BEFORE TRUNCATE ON operations_integration_setting_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER integration_setting_no_delete BEFORE DELETE ON operations_integration_settings
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- Provider settings are tenant-wide. A branch-, area-, route- or record-scoped signature cannot
-- see them at all, and reads require an administrative permission in the signed context.
CREATE FUNCTION integration_settings_scope_allows(target_tenant_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_current_context() c
    WHERE c.tenant_id = target_tenant_id AND c.support_grant_id IS NULL
      AND c.branch_ids IS NULL AND c.area_ids IS NULL AND c.route_ids IS NULL AND c.record_ids IS NULL
      AND c.permission IN ('tenant.secret.manage','tenant.user.administer')
  )
$$;
REVOKE ALL ON FUNCTION integration_settings_scope_allows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_settings_scope_allows(uuid) TO orvex_runtime;

ALTER TABLE operations_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_integration_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_integration_setting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_integration_setting_events FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_settings_scope ON operations_integration_settings
  USING (integration_settings_scope_allows(tenant_id)) WITH CHECK (integration_settings_scope_allows(tenant_id));
CREATE POLICY integration_setting_events_scope ON operations_integration_setting_events
  USING (integration_settings_scope_allows(tenant_id)) WITH CHECK (integration_settings_scope_allows(tenant_id));
REVOKE ALL ON operations_integration_settings, operations_integration_setting_events FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_integration_settings, operations_integration_setting_events TO orvex_runtime;

CREATE FUNCTION operations_integration_setting_view(row_value operations_integration_settings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'id', row_value.id,
    'kind', row_value.kind,
    'version', row_value.version,
    'active', row_value.active,
    'config', row_value.config,
    'secretConfigured', row_value.secret_ciphertext IS NOT NULL,
    'protectedFields', to_jsonb(row_value.secret_fields),
    'cipherKeyId', row_value.secret_key_id,
    'updatedBy', row_value.updated_by,
    'updatedAt', row_value.updated_at,
    'lastTestAt', row_value.last_test_at,
    'lastTestStatus', row_value.last_test_status,
    'lastTestMessage', row_value.last_test_message
  )
$$;
REVOKE ALL ON FUNCTION operations_integration_setting_view(operations_integration_settings) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations_integration_setting_view(operations_integration_settings) TO orvex_runtime;

-- Two actions: configure (secrets travel separately so the replayed payload never carries
-- ciphertext or plaintext; a keyed fingerprint stands in for the secret) and test (records a
-- provider check the API already performed). Both run only under tenant.secret.manage.
CREATE FUNCTION execute_integration_settings_command(payload jsonb, p_secret_ciphertext bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_integration_setting_events%ROWTYPE;
 existing operations_integration_settings%ROWTYPE; saved operations_integration_settings%ROWTYPE;
 answer jsonb; keep_secret boolean; secret_changed boolean; expected integer; fields text[];
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.permission <> 'tenant.secret.manage'
   OR c.branch_ids IS NOT NULL OR c.area_ids IS NOT NULL OR c.route_ids IS NOT NULL OR c.record_ids IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='tenant-wide secret management authority is required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='complete bilingual integration evidence is required';
 END IF;
 IF coalesce(payload->>'kind','') NOT IN ('smtp','sms','whatsapp') THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown integration kind';
 END IF;
 IF operations_json_contains_secret_key(payload) THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='secrets must not travel inside the command payload';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':integration:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_integration_setting_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='integration retry key belongs to different content';
  END IF;
  RETURN prior.result || jsonb_build_object('replayed', true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':integration-kind:'||(payload->>'kind'),0));
 SELECT * INTO existing FROM operations_integration_settings
  WHERE tenant_id=c.tenant_id AND kind=payload->>'kind' FOR UPDATE;

 CASE payload->>'action'
 WHEN 'configure' THEN
  IF c.action <> 'tenant.integration.configure' THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='signed integration configuration authority required';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','kind','config','active','expectedVersion','keepProtected','protectedFields','cipherKeyId',
     'cipherFingerprint','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown integration configuration field';
  END IF;
  IF jsonb_typeof(payload->'config') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='integration configuration must be an object';
  END IF;
  keep_secret := coalesce((payload->>'keepProtected')::boolean, false);
  expected := (payload->>'expectedVersion')::integer;
  IF existing.id IS NOT NULL THEN
   IF expected IS NULL OR existing.version <> expected THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='integration settings changed; refresh before saving';
   END IF;
  ELSIF expected IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='integration settings do not exist yet';
  END IF;
  SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO fields
   FROM jsonb_array_elements_text(coalesce(payload->'protectedFields','[]'::jsonb));
  IF p_secret_ciphertext IS NOT NULL AND (nullif(payload->>'cipherKeyId','') IS NULL
    OR cardinality(fields) = 0 OR nullif(payload->>'cipherFingerprint','') IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='secret ciphertext requires a key id, field list and fingerprint';
  END IF;
  secret_changed := NOT keep_secret OR p_secret_ciphertext IS NOT NULL;
  IF existing.id IS NULL THEN
   INSERT INTO operations_integration_settings(tenant_id,kind,version,active,config,secret_ciphertext,
     secret_key_id,secret_fields,secret_fingerprint,updated_by)
   VALUES(c.tenant_id,payload->>'kind',1,coalesce((payload->>'active')::boolean,true),payload->'config',
     p_secret_ciphertext,
     CASE WHEN p_secret_ciphertext IS NULL THEN NULL ELSE payload->>'cipherKeyId' END,
     CASE WHEN p_secret_ciphertext IS NULL THEN ARRAY[]::text[] ELSE fields END,
     CASE WHEN p_secret_ciphertext IS NULL THEN NULL ELSE payload->>'cipherFingerprint' END,
     c.actor_id)
   RETURNING * INTO saved;
  ELSE
   UPDATE operations_integration_settings SET
     version=existing.version+1,
     active=coalesce((payload->>'active')::boolean,true),
     config=payload->'config',
     secret_ciphertext=CASE WHEN keep_secret AND p_secret_ciphertext IS NULL THEN existing.secret_ciphertext ELSE p_secret_ciphertext END,
     secret_key_id=CASE WHEN keep_secret AND p_secret_ciphertext IS NULL THEN existing.secret_key_id
       WHEN p_secret_ciphertext IS NULL THEN NULL ELSE payload->>'cipherKeyId' END,
     secret_fields=CASE WHEN keep_secret AND p_secret_ciphertext IS NULL THEN existing.secret_fields
       WHEN p_secret_ciphertext IS NULL THEN ARRAY[]::text[] ELSE fields END,
     secret_fingerprint=CASE WHEN keep_secret AND p_secret_ciphertext IS NULL THEN existing.secret_fingerprint
       WHEN p_secret_ciphertext IS NULL THEN NULL ELSE payload->>'cipherFingerprint' END,
     updated_by=c.actor_id, updated_at=clock_timestamp(),
     last_test_at=NULL, last_test_status=NULL, last_test_message=NULL
   WHERE id=existing.id RETURNING * INTO saved;
  END IF;
  answer := operations_integration_setting_view(saved);
  INSERT INTO operations_integration_setting_events(tenant_id,setting_id,kind,version,action,actor_id,session_id,
    request_id,idempotency_key,request_payload,result,reason_en,reason_ar,evidence,before_config,after_config,
    secret_changed)
  VALUES(c.tenant_id,saved.id,saved.kind,saved.version,'configure',c.actor_id,c.session_id,c.request_id,
    c.idempotency_key,payload,answer,btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),
    btrim(payload->>'evidence'),existing.config,saved.config,secret_changed);

 WHEN 'record_test' THEN
  IF c.action <> 'tenant.integration.test' THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='signed integration test authority required';
  END IF;
  IF existing.id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='integration is not configured yet';
  END IF;
  IF coalesce(payload->>'status','') NOT IN ('passed','failed') THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown integration test status';
  END IF;
  UPDATE operations_integration_settings SET last_test_at=clock_timestamp(),
    last_test_status=payload->>'status', last_test_message=left(payload->>'message',500)
   WHERE id=existing.id RETURNING * INTO saved;
  answer := operations_integration_setting_view(saved) || jsonb_build_object(
    'status', payload->>'status', 'recipient', payload->>'recipientMasked',
    'providerReference', payload->>'providerReference');
  INSERT INTO operations_integration_setting_events(tenant_id,setting_id,kind,version,action,actor_id,session_id,
    request_id,idempotency_key,request_payload,result,reason_en,reason_ar,evidence,test_status,test_message)
  VALUES(c.tenant_id,saved.id,saved.kind,saved.version,'test',c.actor_id,c.session_id,c.request_id,
    c.idempotency_key,payload,answer,btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),
    btrim(payload->>'evidence'),payload->>'status',left(payload->>'message',500));
 ELSE
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown integration command';
 END CASE;

 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_integration_settings',saved.id::text,c.actor_id,c.session_id,
   c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,
   CASE WHEN existing.id IS NULL THEN NULL ELSE operations_integration_setting_view(existing) END,answer);
 RETURN answer || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION execute_integration_settings_command(jsonb, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_integration_settings_command(jsonb, bytea) TO orvex_runtime;

-- Internal reader for the API when it performs a provider test or sends a tenant message. It
-- still requires the signed tenant-wide secret authority; the ciphertext opens only with the API key.
CREATE FUNCTION read_integration_delivery_settings(p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; row_value operations_integration_settings%ROWTYPE; BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.permission <> 'tenant.secret.manage'
   OR c.branch_ids IS NOT NULL OR c.area_ids IS NOT NULL OR c.route_ids IS NOT NULL OR c.record_ids IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='tenant-wide secret management authority is required';
 END IF;
 SELECT * INTO row_value FROM operations_integration_settings WHERE tenant_id=c.tenant_id AND kind=p_kind AND active;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('kind',row_value.kind,'version',row_value.version,'config',row_value.config,
   'secretCiphertext',CASE WHEN row_value.secret_ciphertext IS NULL THEN NULL ELSE encode(row_value.secret_ciphertext,'base64') END,
   'cipherKeyId',row_value.secret_key_id,'protectedFields',to_jsonb(row_value.secret_fields));
END $$;
REVOKE ALL ON FUNCTION read_integration_delivery_settings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_integration_delivery_settings(text) TO orvex_runtime;
