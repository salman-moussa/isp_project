-- orvex:database=control
-- Control-side readers for the staff directory mirror. The API runtime role may not read the
-- tenants table directly; these SECURITY DEFINER functions expose exactly what the tenant-side
-- mirror needs (tenant row, member identities without password hashes, memberships) and nothing
-- else. Sessions and secrets are never part of the snapshot.

CREATE FUNCTION list_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT id FROM tenants ORDER BY created_at, id
$$;
REVOKE ALL ON FUNCTION list_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenant_ids() TO orvex_control_runtime;

CREATE FUNCTION read_tenant_directory(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t tenants%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO t FROM tenants WHERE id = p_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'code', t.code, 'brandName', t.brand_name, 'legalName', t.legal_name,
      'status', t.status, 'timezone', t.timezone, 'defaultLocale', t.default_locale, 'archivedAt', t.archived_at),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'userId', u.id, 'membershipId', m.id, 'email', u.email, 'displayName', u.display_name,
        'mfaRequired', u.mfa_required, 'disabledAt', u.disabled_at, 'roleKey', m.role_key,
        'permissions', to_jsonb(m.permissions), 'scope', m.scope, 'active', m.active) ORDER BY u.email)
      FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = p_tenant), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION read_tenant_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_tenant_directory(uuid) TO orvex_control_runtime;
