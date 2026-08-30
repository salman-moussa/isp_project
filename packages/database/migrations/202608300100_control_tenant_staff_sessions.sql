-- orvex:database=control
-- Wave 1: administrator-controlled tenant staff session/device visibility and revocation.

CREATE FUNCTION read_tenant_staff_sessions(
  p_tenant_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_target_user_id uuid,
  p_request_id text,p_ip_address text,p_user_agent text,p_now timestamptz
) RETURNS TABLE(
  session_id uuid,device_label text,ip_address text,user_agent text,mfa_verified_at timestamptz,
  last_seen_at timestamptz,idle_expires_at timestamptz,absolute_expires_at timestamptz,
  revoked_at timestamptz,revoke_reason text,created_at timestamptz,is_current boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM assert_tenant_staff_administrator(
    p_tenant_id,p_actor_id,p_actor_session_id,p_now,true
  );
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships AS membership
    WHERE membership.tenant_id=p_tenant_id AND membership.user_id=p_target_user_id
  ) THEN
    RAISE EXCEPTION 'tenant staff membership not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO audit_events(
    tenant_id,actor_id,session_id,action,resource_type,resource_id,request_id,
    ip_address,user_agent,result,metadata,occurred_at
  ) VALUES (
    p_tenant_id,p_actor_id,p_actor_session_id,'tenant.staff.sessions.read','tenant_staff_sessions',
    p_target_user_id::text,p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('targetUserId',p_target_user_id),p_now
  );
  RETURN QUERY
    SELECT session.id,session.device_label,session.ip_address::text,session.user_agent,
      session.mfa_verified_at,session.last_seen_at,session.idle_expires_at,
      session.absolute_expires_at,session.revoked_at,session.revoke_reason,session.created_at,
      session.id=p_actor_session_id
    FROM auth_sessions AS session
    WHERE session.user_id=p_target_user_id AND session.audience='tenant'
      AND session.tenant_id=p_tenant_id
    ORDER BY session.created_at DESC
    LIMIT 50;
END $$;

CREATE FUNCTION revoke_tenant_staff_session(
  p_tenant_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_target_user_id uuid,
  p_target_session_id uuid,p_request_id text,p_ip_address text,p_user_agent text,
  p_reason text,p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target auth_sessions%ROWTYPE;
BEGIN
  PERFORM assert_tenant_staff_administrator(
    p_tenant_id,p_actor_id,p_actor_session_id,p_now,true
  );
  IF p_target_session_id=p_actor_session_id THEN
    RAISE EXCEPTION 'use sign out to revoke the current administrator session' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM auth_sessions AS session
    WHERE session.id=p_target_session_id AND session.user_id=p_target_user_id
      AND session.audience='tenant' AND session.tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant staff session not found' USING ERRCODE='P0002'; END IF;
  IF target.revoked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE auth_sessions AS session SET revoked_at=p_now,revoke_reason='tenant_admin_revoked'
    WHERE session.id=target.id;
  INSERT INTO audit_events(
    tenant_id,actor_id,session_id,action,resource_type,resource_id,reason,request_id,
    ip_address,user_agent,result,before,after,metadata,occurred_at
  ) VALUES (
    p_tenant_id,p_actor_id,p_actor_session_id,'tenant.staff.session.revoke','auth_session',
    target.id::text,p_reason,p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('revokedAt',target.revoked_at),
    jsonb_build_object('revokedAt',p_now,'revokeReason','tenant_admin_revoked'),
    jsonb_build_object('targetUserId',p_target_user_id),p_now
  );
  RETURN true;
END $$;

CREATE FUNCTION tenant_staff_sessions_readiness()
RETURNS TABLE(migration_ready boolean,functions_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608300100_control_tenant_staff_sessions.sql'),
    to_regprocedure('public.read_tenant_staff_sessions(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.revoke_tenant_staff_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamp with time zone)') IS NOT NULL
$$;

REVOKE ALL ON FUNCTION
  read_tenant_staff_sessions(uuid,uuid,uuid,uuid,text,text,text,timestamptz),
  revoke_tenant_staff_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),
  tenant_staff_sessions_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  read_tenant_staff_sessions(uuid,uuid,uuid,uuid,text,text,text,timestamptz),
  revoke_tenant_staff_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),
  tenant_staff_sessions_readiness() TO orvex_control_runtime;
