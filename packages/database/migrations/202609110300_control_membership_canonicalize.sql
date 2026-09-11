-- orvex:database=control
-- 202609110100 replaced the role presets but its data statements ran without a tenant context:
-- tenant_memberships carries forced row-level security keyed on app.tenant_id, so the owner role
-- the migrator assumes saw no rows and the legacy bootstrap membership stayed on its old key and
-- snapshot. This defines an idempotent, tenant-aware canonicalisation and runs it once. The
-- function walks every tenant under its own context, renames legacy 'administrator' memberships to
-- 'isp_administrator', re-synchronises each membership with its preset, bumps the authorization
-- version and ends the affected tenant sessions. It is SECURITY DEFINER so a later operator run
-- (or the live test) behaves exactly like the migration. MFA flags are never touched.

CREATE FUNCTION canonicalize_tenant_memberships() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t record; changed integer := 0; n integer;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE tenant_memberships SET role_key='isp_administrator'
      WHERE tenant_id=t.id AND role_key='administrator';
    WITH synced AS (
      UPDATE tenant_memberships
      SET permissions=tenant_role_permissions(role_key),authorization_version=authorization_version+1
      WHERE tenant_id=t.id AND role_key IS NOT NULL
        AND tenant_role_permissions(role_key) IS NOT NULL
        AND permissions IS DISTINCT FROM tenant_role_permissions(role_key)
      RETURNING user_id
    ), ended AS (
      UPDATE auth_sessions AS session
      SET revoked_at=clock_timestamp(),revoke_reason='canonical_permissions_upgraded'
      FROM synced
      WHERE session.tenant_id=t.id AND session.user_id=synced.user_id
        AND session.audience='tenant' AND session.revoked_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO n FROM synced;
    changed := changed + n;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION canonicalize_tenant_memberships() FROM PUBLIC;

SELECT canonicalize_tenant_memberships();
