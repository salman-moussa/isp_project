-- orvex:database=control
-- REQ-AUTH-001..010: canonical login authority, MFA, rotating sessions, and recovery.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvex_control_runtime') THEN
    RAISE EXCEPTION 'bootstrap required role orvex_control_runtime before migration';
  END IF;
END $$;

CREATE TABLE platform_authorizations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  authorization_version bigint NOT NULL DEFAULT 1 CHECK (authorization_version > 0),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (cardinality(roles) > 0)
);

CREATE FUNCTION bump_platform_authorization_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.roles,NEW.permissions,NEW.active) IS DISTINCT FROM
     ROW(OLD.roles,OLD.permissions,OLD.active) THEN
    NEW.authorization_version := OLD.authorization_version + 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.authorization_version := OLD.authorization_version;
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_authorizations_bump_version
BEFORE UPDATE ON platform_authorizations FOR EACH ROW
EXECUTE FUNCTION bump_platform_authorization_version();

CREATE TABLE auth_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  audience text NOT NULL CHECK (audience IN ('platform','tenant')),
  tenant_id uuid REFERENCES tenants(id),
  adapter_reference text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((audience='tenant') = (tenant_id IS NOT NULL))
);
CREATE INDEX auth_mfa_challenges_user_time_idx
  ON auth_mfa_challenges(user_id,created_at DESC);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  audience text NOT NULL CHECK (audience IN ('platform','tenant')),
  tenant_id uuid REFERENCES tenants(id),
  authorization_version bigint NOT NULL CHECK (authorization_version > 0),
  token_family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  current_refresh_digest text NOT NULL UNIQUE,
  previous_refresh_digest text UNIQUE,
  refresh_generation bigint NOT NULL DEFAULT 0 CHECK (refresh_generation >= 0),
  device_label text,
  ip_address inet,
  user_agent text,
  mfa_verified_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((audience='tenant') = (tenant_id IS NOT NULL)),
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions(user_id,revoked_at,created_at DESC);
CREATE INDEX auth_sessions_family_idx ON auth_sessions(token_family_id);

CREATE TABLE auth_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_digest text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,idempotency_key)
);

CREATE TABLE auth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  session_id uuid,
  action text NOT NULL,
  result text NOT NULL CHECK (result IN ('allowed','denied','failed')),
  reason_code text NOT NULL,
  request_id text NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,action)
);
CREATE INDEX auth_security_events_time_idx ON auth_security_events(occurred_at DESC);
CREATE TRIGGER auth_security_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON auth_security_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER auth_security_events_no_truncate
BEFORE TRUNCATE ON auth_security_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- This is the only refresh mutation. The row lock makes two concurrent rotations deterministic.
CREATE FUNCTION rotate_auth_refresh_token(
  p_presented_digest text,
  p_replacement_digest text,
  p_now timestamptz,
  p_idle_expires_at timestamptz
) RETURNS TABLE(outcome text,session_id uuid,user_id uuid,audience text,tenant_id uuid,
  authorization_version bigint,mfa_verified_at timestamptz,absolute_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s auth_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM auth_sessions
  WHERE current_refresh_digest=p_presented_digest OR previous_refresh_digest=p_presented_digest
  FOR UPDATE;
  IF NOT FOUND THEN outcome := 'invalid'; RETURN NEXT; RETURN; END IF;
  session_id:=s.id; user_id:=s.user_id; audience:=s.audience; tenant_id:=s.tenant_id;
  authorization_version:=s.authorization_version; mfa_verified_at:=s.mfa_verified_at;
  absolute_expires_at:=s.absolute_expires_at;
  IF s.previous_refresh_digest=p_presented_digest THEN
    UPDATE auth_sessions SET revoked_at=p_now,revoke_reason='refresh_reuse_detected'
      WHERE token_family_id=s.token_family_id AND revoked_at IS NULL;
    outcome := 'reuse'; RETURN NEXT; RETURN;
  END IF;
  IF s.revoked_at IS NOT NULL OR p_now >= s.idle_expires_at OR p_now >= s.absolute_expires_at THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  UPDATE auth_sessions AS target SET previous_refresh_digest=target.current_refresh_digest,
    current_refresh_digest=p_replacement_digest,
    refresh_generation=target.refresh_generation+1,
    last_seen_at=p_now,
    idle_expires_at=LEAST(p_idle_expires_at,target.absolute_expires_at)
    WHERE target.id=s.id;
  outcome := 'rotated'; RETURN NEXT;
END $$;

-- Canonical authentication reads are owner-mediated. Tenant membership RLS remains FORCEd;
-- the function installs one exact tenant context at a time instead of bypassing the policy.
CREATE FUNCTION read_auth_principal(p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  principal users%ROWTYPE;
  tenant tenants%ROWTYPE;
  membership tenant_memberships%ROWTYPE;
  authorizations jsonb := '[]'::jsonb;
  prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  SELECT * INTO principal FROM users
  WHERE lower(email)=lower(p_email) AND disabled_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF principal.account_kind = 'platform' THEN
    authorizations := authorizations || coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'audience','platform','authorizationVersion',authorization_version,
        'permissions',permissions
      )) FROM platform_authorizations WHERE user_id=principal.id AND active
    ), '[]'::jsonb);
  END IF;

  FOR tenant IN SELECT * FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant.id::text, true);
    SELECT * INTO membership FROM tenant_memberships
      WHERE tenant_id=tenant.id AND user_id=principal.id AND active LIMIT 1;
    IF FOUND THEN
      authorizations := authorizations || jsonb_build_array(jsonb_build_object(
        'audience','tenant','tenantId',membership.tenant_id,
        'authorizationVersion',membership.authorization_version,
        'permissions',membership.permissions,'scope',membership.scope
      ));
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(prior_tenant,''), true);

  RETURN jsonb_build_object(
    'userId',principal.id,'email',principal.email,'displayName',principal.display_name,
    'passwordHash',principal.password_hash,'mfaRequired',principal.mfa_required,
    'authorizations',authorizations
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id', coalesce(prior_tenant,''), true);
  RAISE;
END $$;

CREATE FUNCTION read_auth_principal_by_id(p_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT read_auth_principal((SELECT email FROM users WHERE id=p_user_id AND disabled_at IS NULL))
$$;

CREATE FUNCTION is_auth_session_active(p_session_id uuid,p_user_id uuid,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  target auth_sessions%ROWTYPE;
  current_version bigint;
  prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  SELECT * INTO target FROM auth_sessions
  WHERE id=p_session_id AND user_id=p_user_id AND revoked_at IS NULL
    AND idle_expires_at>p_now AND absolute_expires_at>p_now;
  IF NOT FOUND THEN RETURN false; END IF;
  IF target.audience='platform' THEN
    SELECT authorization_version INTO current_version FROM platform_authorizations
      WHERE user_id=target.user_id AND active;
  ELSE
    PERFORM set_config('app.tenant_id', target.tenant_id::text, true);
    SELECT authorization_version INTO current_version FROM tenant_memberships
      WHERE tenant_id=target.tenant_id AND user_id=target.user_id AND active;
    PERFORM set_config('app.tenant_id', coalesce(prior_tenant,''), true);
  END IF;
  RETURN current_version IS NOT NULL AND current_version=target.authorization_version;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id', coalesce(prior_tenant,''), true);
  RAISE;
END $$;

CREATE FUNCTION auth_readiness()
RETURNS TABLE(relations_ready boolean,migration_ready boolean,functions_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    to_regclass('public.platform_authorizations') IS NOT NULL
      AND to_regclass('public.auth_mfa_challenges') IS NOT NULL
      AND to_regclass('public.auth_sessions') IS NOT NULL
      AND to_regclass('public.auth_recovery_tokens') IS NOT NULL
      AND to_regclass('public.auth_security_events') IS NOT NULL,
    EXISTS (SELECT 1 FROM public._orvex_migrations
      WHERE name='202608112400_control_auth_sessions.sql'),
    to_regprocedure('public.read_auth_principal(text)') IS NOT NULL
      AND to_regprocedure('public.is_auth_session_active(uuid,uuid,timestamp with time zone)') IS NOT NULL
$$;

REVOKE ALL ON FUNCTION bump_platform_authorization_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_auth_refresh_token(text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_auth_principal(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_auth_principal_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_auth_session_active(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_readiness() FROM PUBLIC;
REVOKE ALL ON platform_authorizations,auth_mfa_challenges,auth_sessions,
  auth_recovery_tokens,auth_security_events FROM PUBLIC;
GRANT SELECT ON users,tenant_memberships,platform_authorizations TO orvex_control_runtime;
GRANT SELECT,INSERT,UPDATE ON auth_mfa_challenges,auth_sessions,auth_recovery_tokens
  TO orvex_control_runtime;
GRANT SELECT,INSERT ON auth_security_events TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION rotate_auth_refresh_token(text,text,timestamptz,timestamptz)
  TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION read_auth_principal(text),
  read_auth_principal_by_id(uuid)
  TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION is_auth_session_active(uuid,uuid,timestamptz)
  TO orvex_control_runtime,orvex_runtime;
GRANT EXECUTE ON FUNCTION auth_readiness() TO orvex_control_runtime;
