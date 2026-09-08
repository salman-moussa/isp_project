-- Platform integration settings: SMTP (authentication delivery) plus optional SMS/WhatsApp
-- provider configuration managed from the Control Center. Non-secret configuration is stored as
-- JSON; secrets are stored only as API-side AES-256-GCM ciphertext under a named key. The database
-- never sees plaintext credentials and reads never return ciphertext to callers other than the
-- internal delivery reader used by the API runtime.

CREATE TABLE platform_integration_settings (
  kind text PRIMARY KEY CHECK (kind IN ('smtp','sms','whatsapp')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext bytea,
  secret_key_id text,
  secret_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_test_at timestamptz,
  last_test_status text CHECK (last_test_status IN ('passed','failed')),
  last_test_message text,
  CHECK ((secret_ciphertext IS NULL) = (secret_key_id IS NULL)),
  CHECK ((secret_ciphertext IS NULL) = (cardinality(secret_fields) = 0)),
  CHECK (config::text !~* '"[^" ]*(secret|password|credential|token|private[_-]?key|api[_-]?key)[^" ]*"[[:space:]]*:')
);

CREATE TABLE platform_integration_setting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('configure','test')),
  actor_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  reason text NOT NULL,
  before_config jsonb,
  after_config jsonb,
  secret_changed boolean NOT NULL DEFAULT false,
  secret_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  test_status text CHECK (test_status IN ('passed','failed')),
  test_message text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_integration_setting_events_kind_idx
  ON platform_integration_setting_events(kind, occurred_at DESC);
CREATE TRIGGER platform_integration_setting_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON platform_integration_setting_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER platform_integration_setting_events_no_truncate
BEFORE TRUNCATE ON platform_integration_setting_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- One-time codes for email OTP. Only a digest is stored; the challenge id is the adapter reference.
CREATE TABLE auth_otp_codes (
  challenge_id uuid PRIMARY KEY,
  code_digest text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auth_otp_codes_expiry_idx ON auth_otp_codes(expires_at);

-- Delivery evidence without message bodies or secrets. Recipients are stored masked.
CREATE TABLE platform_message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('otp','recovery','staff_invitation','integration_test')),
  channel text NOT NULL CHECK (channel IN ('smtp','sms','whatsapp')),
  recipient_masked text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  provider_reference text,
  error_code text,
  user_id text,
  tenant_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_message_deliveries_time_idx ON platform_message_deliveries(occurred_at DESC);
CREATE TRIGGER platform_message_deliveries_no_update_or_delete
BEFORE UPDATE OR DELETE ON platform_message_deliveries FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER platform_message_deliveries_no_truncate
BEFORE TRUNCATE ON platform_message_deliveries FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Masked projection shared by the Control Center read and by mutation results.
CREATE FUNCTION platform_integration_setting_view(row_value platform_integration_settings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object(
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

CREATE FUNCTION read_platform_integration_settings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; BEGIN
  PERFORM control_require_context('platform.integration.manage','integration.read');
  SELECT coalesce(jsonb_agg(platform_integration_setting_view(s) ORDER BY s.kind), '[]'::jsonb)
    INTO result FROM platform_integration_settings s;
  RETURN jsonb_build_object(
    'settings', result,
    'recentEvents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'version', e.version, 'action', e.action,
        'actorId', e.actor_id, 'reason', e.reason, 'secretChanged', e.secret_changed,
        'testStatus', e.test_status, 'testMessage', e.test_message, 'occurredAt', e.occurred_at
      ) ORDER BY e.occurred_at DESC)
      FROM (SELECT * FROM platform_integration_setting_events ORDER BY occurred_at DESC LIMIT 50) e
    ), '[]'::jsonb),
    'recentDeliveries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'purpose', d.purpose, 'channel', d.channel, 'recipient', d.recipient_masked,
        'status', d.status, 'providerReference', d.provider_reference, 'errorCode', d.error_code,
        'occurredAt', d.occurred_at
      ) ORDER BY d.occurred_at DESC)
      FROM (SELECT * FROM platform_message_deliveries ORDER BY occurred_at DESC LIMIT 50) d
    ), '[]'::jsonb)
  );
END $$;

-- p_secret_ciphertext NULL with p_keep_secret=true keeps the stored secret; NULL with
-- p_keep_secret=false clears it. Every change is versioned and audited without secret bytes.
CREATE FUNCTION configure_platform_integration(
  p_kind text, p_config jsonb, p_active boolean, p_secret_ciphertext bytea, p_secret_key_id text,
  p_secret_fields text[], p_keep_secret boolean, p_expected_version integer,
  p_reason text, p_key text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  prior jsonb; existing platform_integration_settings%ROWTYPE; saved platform_integration_settings%ROWTYPE;
  context_row control_center_request_contexts%ROWTYPE; secret_changed boolean; result jsonb;
BEGIN
  PERFORM control_require_context('platform.integration.manage','integration.configure');
  prior := control_claim_idempotency('integration.configure', p_key, p_hash);
  IF prior IS NOT NULL THEN RETURN prior || jsonb_build_object('replay', true); END IF;
  SELECT * INTO context_row FROM control_current_context();
  IF p_kind NOT IN ('smtp','sms','whatsapp') THEN
    RAISE EXCEPTION 'unknown integration kind %', p_kind USING ERRCODE='23514';
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'integration configuration must be a JSON object' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_integration:' || p_kind, 0));
  SELECT * INTO existing FROM platform_integration_settings WHERE kind = p_kind FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR existing.version <> p_expected_version THEN
      RAISE EXCEPTION 'integration settings version changed' USING ERRCODE='CC412';
    END IF;
  ELSIF p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'integration settings do not exist yet' USING ERRCODE='CC404';
  END IF;
  secret_changed := NOT p_keep_secret OR p_secret_ciphertext IS NOT NULL;
  IF p_secret_ciphertext IS NOT NULL AND (p_secret_key_id IS NULL OR cardinality(p_secret_fields) = 0) THEN
    RAISE EXCEPTION 'secret ciphertext requires a key id and field list' USING ERRCODE='23514';
  END IF;
  INSERT INTO platform_integration_settings(kind, version, active, config, secret_ciphertext, secret_key_id,
    secret_fields, updated_by, updated_at)
  VALUES (p_kind, 1, p_active, p_config, p_secret_ciphertext, p_secret_key_id,
    coalesce(p_secret_fields, ARRAY[]::text[]), context_row.actor_id, clock_timestamp())
  ON CONFLICT (kind) DO UPDATE SET
    version = platform_integration_settings.version + 1,
    active = EXCLUDED.active,
    config = EXCLUDED.config,
    secret_ciphertext = CASE WHEN p_keep_secret AND p_secret_ciphertext IS NULL
      THEN platform_integration_settings.secret_ciphertext ELSE EXCLUDED.secret_ciphertext END,
    secret_key_id = CASE WHEN p_keep_secret AND p_secret_ciphertext IS NULL
      THEN platform_integration_settings.secret_key_id ELSE EXCLUDED.secret_key_id END,
    secret_fields = CASE WHEN p_keep_secret AND p_secret_ciphertext IS NULL
      THEN platform_integration_settings.secret_fields ELSE EXCLUDED.secret_fields END,
    updated_by = EXCLUDED.updated_by,
    updated_at = clock_timestamp(),
    last_test_at = NULL, last_test_status = NULL, last_test_message = NULL
  RETURNING * INTO saved;
  INSERT INTO platform_integration_setting_events(kind, version, action, actor_id, session_id, request_id,
    reason, before_config, after_config, secret_changed, secret_fields)
  VALUES (p_kind, saved.version, 'configure', context_row.actor_id, context_row.session_id,
    context_row.request_id, p_reason, existing.config, saved.config, secret_changed, saved.secret_fields);
  PERFORM control_append_audit('integration.configure', 'platform_integration_setting', p_kind, NULL,
    p_reason, CASE WHEN existing.kind IS NULL THEN 'null'::jsonb ELSE platform_integration_setting_view(existing) END,
    platform_integration_setting_view(saved));
  result := platform_integration_setting_view(saved) || jsonb_build_object('replay', false);
  PERFORM control_complete_idempotency('integration.configure', p_key, result);
  RETURN result;
END $$;

CREATE FUNCTION record_platform_integration_test(
  p_kind text, p_status text, p_message text, p_recipient_masked text, p_provider_reference text,
  p_error_code text, p_reason text, p_key text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb; saved platform_integration_settings%ROWTYPE; context_row control_center_request_contexts%ROWTYPE; result jsonb;
BEGIN
  PERFORM control_require_context('platform.integration.manage','integration.test');
  prior := control_claim_idempotency('integration.test', p_key, p_hash);
  IF prior IS NOT NULL THEN RETURN prior || jsonb_build_object('replay', true); END IF;
  SELECT * INTO context_row FROM control_current_context();
  IF p_status NOT IN ('passed','failed') THEN
    RAISE EXCEPTION 'unknown test status %', p_status USING ERRCODE='23514';
  END IF;
  UPDATE platform_integration_settings SET last_test_at = clock_timestamp(), last_test_status = p_status,
    last_test_message = left(p_message, 500)
  WHERE kind = p_kind RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration % is not configured', p_kind USING ERRCODE='CC404';
  END IF;
  INSERT INTO platform_integration_setting_events(kind, version, action, actor_id, session_id, request_id,
    reason, test_status, test_message)
  VALUES (p_kind, saved.version, 'test', context_row.actor_id, context_row.session_id, context_row.request_id,
    p_reason, p_status, left(p_message, 500));
  INSERT INTO platform_message_deliveries(purpose, channel, recipient_masked, status, provider_reference,
    error_code, user_id)
  VALUES ('integration_test', p_kind, p_recipient_masked, CASE WHEN p_status='passed' THEN 'sent' ELSE 'failed' END,
    p_provider_reference, p_error_code, context_row.actor_id);
  PERFORM control_append_audit('integration.test', 'platform_integration_setting', p_kind, NULL, p_reason,
    'null'::jsonb, jsonb_build_object('status', p_status, 'message', left(p_message, 500)));
  result := platform_integration_setting_view(saved) || jsonb_build_object('replay', false);
  PERFORM control_complete_idempotency('integration.test', p_key, result);
  RETURN result;
END $$;

-- Internal delivery reader: no request context because OTP delivery starts before any session exists.
-- Callable only by the API runtime role; it returns ciphertext that only the API key can open.
CREATE FUNCTION read_platform_integration_delivery(p_kind text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object(
    'kind', kind, 'version', version, 'config', config,
    'secretCiphertext', CASE WHEN secret_ciphertext IS NULL THEN NULL ELSE encode(secret_ciphertext,'base64') END,
    'cipherKeyId', secret_key_id, 'protectedFields', to_jsonb(secret_fields)
  ) FROM platform_integration_settings WHERE kind = p_kind AND active
$$;

CREATE FUNCTION read_auth_delivery_target(p_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('userId', id, 'email', email, 'displayName', display_name,
    'accountKind', account_kind)
  FROM users WHERE id = p_user_id AND disabled_at IS NULL
$$;

CREATE FUNCTION store_auth_otp_code(p_challenge_id uuid, p_code_digest text, p_expires_at timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  INSERT INTO auth_otp_codes(challenge_id, code_digest, expires_at)
  VALUES (p_challenge_id, p_code_digest, p_expires_at)
  ON CONFLICT (challenge_id) DO NOTHING
$$;

-- Constant-shape verification: the row is locked, attempts are counted, and success consumes the code.
CREATE FUNCTION verify_auth_otp_code(p_challenge_id uuid, p_code_digest text, p_now timestamptz, p_max_attempts integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target auth_otp_codes%ROWTYPE; BEGIN
  SELECT * INTO target FROM auth_otp_codes WHERE challenge_id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR target.consumed_at IS NOT NULL OR target.expires_at <= p_now OR target.attempts >= p_max_attempts THEN
    RETURN false;
  END IF;
  IF target.code_digest = p_code_digest THEN
    UPDATE auth_otp_codes SET consumed_at = p_now WHERE challenge_id = p_challenge_id;
    RETURN true;
  END IF;
  UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE challenge_id = p_challenge_id;
  RETURN false;
END $$;

CREATE FUNCTION record_platform_message_delivery(
  p_purpose text, p_channel text, p_recipient_masked text, p_status text, p_provider_reference text,
  p_error_code text, p_user_id text, p_tenant_id uuid
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  INSERT INTO platform_message_deliveries(purpose, channel, recipient_masked, status, provider_reference,
    error_code, user_id, tenant_id)
  VALUES (p_purpose, p_channel, p_recipient_masked, p_status, p_provider_reference, p_error_code, p_user_id, p_tenant_id)
  RETURNING id
$$;

CREATE FUNCTION platform_integration_readiness() RETURNS TABLE(relations_ready boolean, functions_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    to_regclass('public.platform_integration_settings') IS NOT NULL
      AND to_regclass('public.auth_otp_codes') IS NOT NULL
      AND to_regclass('public.platform_message_deliveries') IS NOT NULL,
    to_regprocedure('public.read_platform_integration_delivery(text)') IS NOT NULL
      AND to_regprocedure('public.verify_auth_otp_code(uuid,text,timestamp with time zone,integer)') IS NOT NULL
$$;

-- Platform administrators receive the new canonical permission explicitly. The version bump
-- trigger invalidates their current sessions, which is the intended effect of a permission change.
UPDATE platform_authorizations SET permissions = array_append(permissions, 'platform.integration.manage')
WHERE active AND NOT ('platform.integration.manage' = ANY(permissions))
  AND (roles && ARRAY['platform_owner','platform_administrator']::text[]);

-- ISP owners and administrators hold every tenant permission by preset; memberships created
-- before tenant.secret.manage was exercised receive it explicitly so provider configuration is
-- reachable without an out-of-band grant. The membership version bump ends their sessions.
UPDATE tenant_memberships SET permissions = array_append(permissions, 'tenant.secret.manage')
WHERE active AND role_key IN ('isp_owner','isp_administrator')
  AND NOT ('tenant.secret.manage' = ANY(permissions));

REVOKE ALL ON platform_integration_settings, platform_integration_setting_events, auth_otp_codes,
  platform_message_deliveries FROM PUBLIC, orvex_control_runtime;
REVOKE ALL ON FUNCTION platform_integration_setting_view(platform_integration_settings) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_platform_integration_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION configure_platform_integration(text,jsonb,boolean,bytea,text,text[],boolean,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_platform_integration_test(text,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_platform_integration_delivery(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_auth_delivery_target(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_auth_otp_code(uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_auth_otp_code(uuid,text,timestamptz,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_platform_message_delivery(text,text,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_integration_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_platform_integration_settings() TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION configure_platform_integration(text,jsonb,boolean,bytea,text,text[],boolean,integer,text,text,text) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION record_platform_integration_test(text,text,text,text,text,text,text,text,text) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION read_platform_integration_delivery(text) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION read_auth_delivery_target(uuid) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION store_auth_otp_code(uuid,text,timestamptz) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION verify_auth_otp_code(uuid,text,timestamptz,integer) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION record_platform_message_delivery(text,text,text,text,text,text,text,uuid) TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION platform_integration_readiness() TO orvex_control_runtime;
