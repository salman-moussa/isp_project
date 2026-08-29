-- orvex:database=control
-- Wave 1: guarded tenant staff invitations, role/scope changes, suspension and session invalidation.

CREATE TABLE tenant_staff_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  display_name text NOT NULL,
  role_key text NOT NULL,
  permissions text[] NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_digest text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,idempotency_key),
  CHECK (email=lower(btrim(email)) AND email LIKE '%_@_%._%'),
  CHECK (char_length(display_name) BETWEEN 2 AND 120),
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 160),
  CHECK (expires_at>created_at),
  CHECK ((accepted_at IS NULL)=(accepted_by IS NULL)),
  CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX tenant_staff_invitations_tenant_status_idx
  ON tenant_staff_invitations(tenant_id,accepted_at,revoked_at,created_at DESC);
CREATE UNIQUE INDEX tenant_staff_invitations_active_email_key
  ON tenant_staff_invitations(tenant_id,email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE tenant_staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_staff_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_staff_invitations_isolation ON tenant_staff_invitations
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION tenant_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public AS $$
  SELECT CASE p_role
    WHEN 'isp_owner' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.installation.view','tenant.installation.manage',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
      'tenant.audit.view']::text[]
    WHEN 'isp_administrator' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.installation.view','tenant.installation.manage',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
      'tenant.audit.view']::text[]
    WHEN 'branch_manager' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.billing.view','tenant.payment.view','tenant.collection.view','tenant.collection.reconcile',
      'tenant.installation.view','tenant.installation.manage','tenant.network.view','tenant.report.view',
      'tenant.report.export','tenant.audit.view']::text[]
    WHEN 'finance_billing' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.billing.view','tenant.invoice.create',
      'tenant.invoice.post','tenant.invoice.reverse','tenant.payment.view','tenant.payment.post',
      'tenant.payment.reverse','tenant.collection.view','tenant.collection.reconcile',
      'tenant.report.view','tenant.report.export','tenant.audit.view']::text[]
    WHEN 'cashier' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.billing.view','tenant.payment.view',
      'tenant.payment.post']::text[]
    WHEN 'collector' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.payment.view','tenant.payment.post',
      'tenant.collection.view']::text[]
    WHEN 'network_operator' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.installation.view','tenant.network.view',
      'tenant.network.job.create','tenant.network.bulk.approve','tenant.report.view','tenant.audit.view']::text[]
    WHEN 'customer_service' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.billing.view','tenant.payment.view','tenant.installation.view','tenant.network.view']::text[]
    WHEN 'installer' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.installation.view',
      'tenant.installation.manage','tenant.network.view']::text[]
    WHEN 'tenant_auditor' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.billing.view','tenant.payment.view',
      'tenant.collection.view','tenant.installation.view','tenant.network.view','tenant.report.view',
      'tenant.report.export','tenant.audit.view']::text[]
    ELSE NULL
  END
$$;

CREATE FUNCTION tenant_role_requires_mfa(p_role text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_role <> 'customer_service' AND tenant_role_permissions(p_role) IS NOT NULL
$$;

CREATE FUNCTION validate_tenant_staff_scope(p_role text,p_scope jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE key text; item jsonb;
BEGIN
  IF p_scope IS NULL OR jsonb_typeof(p_scope)<>'object' THEN
    RAISE EXCEPTION 'staff scope must be an object' USING ERRCODE='22023';
  END IF;
  FOR key,item IN SELECT * FROM jsonb_each(p_scope) LOOP
    IF key NOT IN ('branchIds','areaIds','routeIds','recordIds') OR jsonb_typeof(item)<>'array' OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(item) value WHERE jsonb_typeof(value)<>'string') THEN
      RAISE EXCEPTION 'staff scope contains an invalid field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_role IN ('isp_owner','isp_administrator') AND p_scope <> '{}'::jsonb THEN
    RAISE EXCEPTION 'tenant-wide roles cannot carry a narrower scope' USING ERRCODE='22023';
  END IF;
  IF p_role NOT IN ('isp_owner','isp_administrator') AND p_scope='{}'::jsonb THEN
    RAISE EXCEPTION 'operational roles require an explicit scope' USING ERRCODE='22023';
  END IF;
  IF p_role='collector' AND coalesce(jsonb_array_length(p_scope->'routeIds'),0)=0 THEN
    RAISE EXCEPTION 'collector role requires at least one route' USING ERRCODE='22023';
  END IF;
END $$;

CREATE FUNCTION assert_tenant_staff_administrator(
  p_tenant_id uuid,p_actor_id uuid,p_session_id uuid,p_now timestamptz,p_require_mfa boolean
) RETURNS tenant_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE membership tenant_memberships%ROWTYPE; actor_session auth_sessions%ROWTYPE;
BEGIN
  PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
  SELECT * INTO membership FROM tenant_memberships
    WHERE tenant_id=p_tenant_id AND user_id=p_actor_id AND active FOR SHARE;
  IF NOT FOUND OR NOT ('tenant.user.administer'=ANY(membership.permissions)) THEN
    RAISE EXCEPTION 'tenant staff administration denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO actor_session FROM auth_sessions
    WHERE id=p_session_id AND user_id=p_actor_id AND audience='tenant' AND tenant_id=p_tenant_id
      AND revoked_at IS NULL AND idle_expires_at>p_now AND absolute_expires_at>p_now
      AND authorization_version=membership.authorization_version FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant administrator session is not active' USING ERRCODE='42501';
  END IF;
  IF p_require_mfa AND
     (actor_session.mfa_verified_at IS NULL OR actor_session.mfa_verified_at<p_now-interval '10 minutes') THEN
    RAISE EXCEPTION 'recent MFA verification is required' USING ERRCODE='42501';
  END IF;
  RETURN membership;
END $$;

CREATE FUNCTION create_tenant_staff_invitation(
  p_id uuid,p_tenant_id uuid,p_actor_id uuid,p_session_id uuid,p_email text,p_display_name text,
  p_role text,p_scope jsonb,p_token_digest text,p_idempotency_key text,p_expires_at timestamptz,
  p_request_id text,p_ip_address text,p_user_agent text,p_reason text,p_now timestamptz
) RETURNS TABLE(invitation_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing tenant_staff_invitations%ROWTYPE; normalized_email text:=lower(btrim(p_email));
  normalized_name text:=btrim(p_display_name); role_permissions text[]; calculated_hash text;
BEGIN
  PERFORM assert_tenant_staff_administrator(p_tenant_id,p_actor_id,p_session_id,p_now,true);
  role_permissions:=tenant_role_permissions(p_role);
  IF role_permissions IS NULL THEN RAISE EXCEPTION 'unknown tenant role' USING ERRCODE='22023'; END IF;
  PERFORM validate_tenant_staff_scope(p_role,p_scope);
  IF p_expires_at<=p_now OR p_expires_at>p_now+interval '7 days' THEN
    RAISE EXCEPTION 'invitation expiry is invalid' USING ERRCODE='22023';
  END IF;
  calculated_hash:=encode(digest(concat_ws('|',normalized_email,normalized_name,p_role,p_scope::text,p_expires_at::text),'sha256'),'hex');
  SELECT * INTO existing FROM tenant_staff_invitations
    WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing.request_hash<>calculated_hash THEN
      RAISE EXCEPTION 'idempotency key was used with another request' USING ERRCODE='23505';
    END IF;
    invitation_id:=existing.id; replayed:=true; RETURN NEXT; RETURN;
  END IF;
  UPDATE tenant_staff_invitations SET revoked_at=p_now,revoke_reason='superseded'
    WHERE tenant_id=p_tenant_id AND email=normalized_email AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO tenant_staff_invitations(id,tenant_id,email,display_name,role_key,permissions,scope,
    token_digest,idempotency_key,request_hash,invited_by,expires_at)
  VALUES(p_id,p_tenant_id,normalized_email,normalized_name,p_role,role_permissions,p_scope,p_token_digest,
    p_idempotency_key,calculated_hash,p_actor_id,p_expires_at);
  INSERT INTO audit_events(tenant_id,actor_id,session_id,action,resource_type,resource_id,reason,
    request_id,ip_address,user_agent,result,after,metadata,occurred_at)
  VALUES(p_tenant_id,p_actor_id,p_session_id,'tenant.staff.invitation.create','tenant_staff_invitation',
    p_id::text,p_reason,p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('email',normalized_email,'displayName',normalized_name,'roleKey',p_role,'scope',p_scope,
      'expiresAt',p_expires_at),'{}'::jsonb,p_now);
  invitation_id:=p_id; replayed:=false; RETURN NEXT;
END $$;

CREATE FUNCTION accept_tenant_staff_invitation(
  p_token_digest text,p_password_hash text,p_request_id text,p_ip_address text,p_user_agent text,p_now timestamptz
) RETURNS TABLE(outcome text,tenant_id uuid,user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target tenant_staff_invitations%ROWTYPE; tenant_row tenants%ROWTYPE; principal users%ROWTYPE;
  prior_tenant text:=current_setting('app.tenant_id',true); is_existing boolean:=false;
  target_found boolean:=false;
BEGIN
  FOR tenant_row IN SELECT * FROM tenants LOOP
    PERFORM set_config('app.tenant_id',tenant_row.id::text,true);
    SELECT * INTO target FROM tenant_staff_invitations
      WHERE token_digest=p_token_digest FOR UPDATE;
    IF FOUND THEN target_found:=true; EXIT; END IF;
  END LOOP;
  IF NOT target_found OR target.accepted_at IS NOT NULL OR target.revoked_at IS NOT NULL OR target.expires_at<=p_now THEN
    PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
    outcome:='invalid'; tenant_id:=NULL; user_id:=NULL; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO principal FROM users WHERE lower(email)=target.email LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF principal.account_kind<>'tenant' OR principal.disabled_at IS NOT NULL THEN
      RAISE EXCEPTION 'existing account is not eligible for tenant invitation' USING ERRCODE='42501';
    END IF;
    is_existing:=true;
  ELSE
    INSERT INTO users(account_kind,email,display_name,password_hash,mfa_required)
      VALUES('tenant',target.email,target.display_name,p_password_hash,tenant_role_requires_mfa(target.role_key))
      RETURNING * INTO principal;
  END IF;
  INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope,active)
    VALUES(target.tenant_id,principal.id,target.role_key,target.permissions,target.scope,true)
    ON CONFLICT ON CONSTRAINT tenant_memberships_tenant_id_user_id_key
    DO UPDATE SET role_key=excluded.role_key,
      permissions=excluded.permissions,scope=excluded.scope,active=true;
  IF tenant_role_requires_mfa(target.role_key) THEN
    UPDATE users SET mfa_required=true WHERE id=principal.id;
  END IF;
  UPDATE auth_sessions AS session SET revoked_at=p_now,revoke_reason='tenant_invitation_accepted'
    WHERE session.user_id=principal.id AND session.audience='tenant'
      AND session.tenant_id=target.tenant_id AND session.revoked_at IS NULL;
  UPDATE tenant_staff_invitations SET accepted_at=p_now,accepted_by=principal.id WHERE id=target.id;
  INSERT INTO audit_events(tenant_id,actor_id,action,resource_type,resource_id,reason,request_id,
    ip_address,user_agent,result,after,metadata,occurred_at)
  VALUES(target.tenant_id,principal.id,'tenant.staff.invitation.accept','tenant_membership',principal.id::text,
    'invitation token accepted',p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('roleKey',target.role_key,'scope',target.scope),
    jsonb_build_object('invitationId',target.id,'existingAccount',is_existing),p_now);
  outcome:=CASE WHEN is_existing THEN 'existing_account' ELSE 'created' END;
  tenant_id:=target.tenant_id; user_id:=principal.id;
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NEXT;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RAISE;
END $$;

CREATE FUNCTION update_tenant_staff_membership(
  p_tenant_id uuid,p_actor_id uuid,p_session_id uuid,p_target_user_id uuid,p_role text,p_scope jsonb,
  p_active boolean,p_request_id text,p_ip_address text,p_user_agent text,p_reason text,p_now timestamptz
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_member tenant_memberships%ROWTYPE; role_permissions text[]; new_version bigint;
  active_owner_count bigint;
BEGIN
  PERFORM assert_tenant_staff_administrator(p_tenant_id,p_actor_id,p_session_id,p_now,true);
  IF p_target_user_id=p_actor_id AND NOT p_active THEN
    RAISE EXCEPTION 'administrators cannot suspend their own membership' USING ERRCODE='42501';
  END IF;
  role_permissions:=tenant_role_permissions(p_role);
  IF role_permissions IS NULL THEN RAISE EXCEPTION 'unknown tenant role' USING ERRCODE='22023'; END IF;
  PERFORM validate_tenant_staff_scope(p_role,p_scope);
  SELECT * INTO current_member FROM tenant_memberships
    WHERE tenant_id=p_tenant_id AND user_id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant staff membership not found' USING ERRCODE='P0002'; END IF;
  IF current_member.role_key='isp_owner' AND (p_role<>'isp_owner' OR NOT p_active) THEN
    SELECT count(*) INTO active_owner_count FROM tenant_memberships
      WHERE tenant_id=p_tenant_id AND role_key='isp_owner' AND active AND user_id<>p_target_user_id;
    IF active_owner_count=0 THEN
      RAISE EXCEPTION 'the last active ISP owner cannot be removed' USING ERRCODE='42501';
    END IF;
  END IF;
  UPDATE tenant_memberships SET role_key=p_role,permissions=role_permissions,scope=p_scope,active=p_active
    WHERE id=current_member.id RETURNING authorization_version INTO new_version;
  IF tenant_role_requires_mfa(p_role) THEN UPDATE users SET mfa_required=true WHERE id=p_target_user_id; END IF;
  UPDATE auth_sessions SET revoked_at=p_now,revoke_reason='tenant_membership_changed'
    WHERE user_id=p_target_user_id AND audience='tenant' AND tenant_id=p_tenant_id AND revoked_at IS NULL;
  INSERT INTO audit_events(tenant_id,actor_id,session_id,action,resource_type,resource_id,reason,
    request_id,ip_address,user_agent,result,before,after,metadata,occurred_at)
  VALUES(p_tenant_id,p_actor_id,p_session_id,'tenant.staff.membership.update','tenant_membership',
    current_member.id::text,p_reason,p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('roleKey',current_member.role_key,'scope',current_member.scope,'active',current_member.active),
    jsonb_build_object('roleKey',p_role,'scope',p_scope,'active',p_active,'authorizationVersion',new_version),
    jsonb_build_object('targetUserId',p_target_user_id),p_now);
  RETURN new_version;
END $$;

CREATE FUNCTION revoke_tenant_staff_invitation(
  p_tenant_id uuid,p_actor_id uuid,p_session_id uuid,p_invitation_id uuid,
  p_request_id text,p_ip_address text,p_user_agent text,p_reason text,p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target tenant_staff_invitations%ROWTYPE;
BEGIN
  PERFORM assert_tenant_staff_administrator(p_tenant_id,p_actor_id,p_session_id,p_now,true);
  SELECT * INTO target FROM tenant_staff_invitations
    WHERE tenant_id=p_tenant_id AND id=p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant staff invitation not found' USING ERRCODE='P0002'; END IF;
  IF target.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'accepted invitations cannot be revoked' USING ERRCODE='22023';
  END IF;
  IF target.revoked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE tenant_staff_invitations SET revoked_at=p_now,revoke_reason=p_reason WHERE id=target.id;
  INSERT INTO audit_events(tenant_id,actor_id,session_id,action,resource_type,resource_id,reason,
    request_id,ip_address,user_agent,result,before,after,metadata,occurred_at)
  VALUES(p_tenant_id,p_actor_id,p_session_id,'tenant.staff.invitation.revoke','tenant_staff_invitation',
    target.id::text,p_reason,p_request_id,p_ip_address,p_user_agent,'allowed',
    jsonb_build_object('status','pending','email',target.email,'roleKey',target.role_key),
    jsonb_build_object('status','revoked','revokedAt',p_now),'{}'::jsonb,p_now);
  RETURN true;
END $$;

CREATE FUNCTION tenant_staff_lifecycle_readiness()
RETURNS TABLE(relations_ready boolean,migration_ready boolean,functions_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT to_regclass('public.tenant_staff_invitations') IS NOT NULL,
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608290100_control_tenant_staff_lifecycle.sql'),
    to_regprocedure('public.create_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,timestamp with time zone,text,text,text,text,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.accept_tenant_staff_invitation(text,text,text,text,text,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.update_tenant_staff_membership(uuid,uuid,uuid,uuid,text,jsonb,boolean,text,text,text,text,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.revoke_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,text,timestamp with time zone)') IS NOT NULL
$$;

REVOKE ALL ON tenant_staff_invitations FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant_role_permissions(text),tenant_role_requires_mfa(text),
  validate_tenant_staff_scope(text,jsonb),
  assert_tenant_staff_administrator(uuid,uuid,uuid,timestamptz,boolean),
  create_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,timestamptz,text,text,text,text,timestamptz),
  accept_tenant_staff_invitation(text,text,text,text,text,timestamptz),
  update_tenant_staff_membership(uuid,uuid,uuid,uuid,text,jsonb,boolean,text,text,text,text,timestamptz),
  revoke_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),
  tenant_staff_lifecycle_readiness() FROM PUBLIC;
GRANT SELECT ON tenant_staff_invitations TO orvex_control_runtime;
GRANT EXECUTE ON FUNCTION
  create_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,timestamptz,text,text,text,text,timestamptz),
  accept_tenant_staff_invitation(text,text,text,text,text,timestamptz),
  update_tenant_staff_membership(uuid,uuid,uuid,uuid,text,jsonb,boolean,text,text,text,text,timestamptz),
  revoke_tenant_staff_invitation(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz),
  tenant_staff_lifecycle_readiness() TO orvex_control_runtime;
