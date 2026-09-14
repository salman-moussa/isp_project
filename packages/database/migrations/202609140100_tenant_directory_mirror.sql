-- 202609140100_tenant_directory_mirror.sql
-- Staff identities and memberships are authoritative in the control database, where sign-in,
-- invitations and role changes happen. The tenant database keeps a mirror because operational
-- rows reference tenant_memberships(tenant_id, user_id) for assignees, collectors, approvers and
-- authors. On a two-database deployment nothing kept that mirror current after bootstrap, so
-- staff invited later could sign in but could not own or be assigned operational records.
--
-- mirror_tenant_directory(payload) applies one tenant's directory snapshot from the control
-- database: the tenant row, every member identity and every membership. It only ever inserts a
-- placeholder password hash (the tenant database never authenticates anyone) and never changes an
-- existing hash, so on a single-database deployment, where control and tenant tables are the same
-- tables, it is a no-op. Updates are written only when a value differs, so the membership
-- authorization-version trigger does not fire for unchanged rows and no session is ended by a
-- mirror pass. Permissions are copied verbatim: the mirror grants nothing; sign-in still derives
-- authority from the control database alone.

CREATE FUNCTION mirror_tenant_directory(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_tenant uuid; t jsonb; m jsonb; was_insert boolean;
  inserted_users integer := 0; updated_users integer := 0;
  inserted_members integer := 0; updated_members integer := 0; deactivated integer := 0;
  seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'tenant') IS DISTINCT FROM 'object'
     OR jsonb_typeof(payload->'members') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='directory mirror payload must carry tenant and members';
  END IF;
  t := payload->'tenant';
  v_tenant := (t->>'id')::uuid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='directory mirror payload names no tenant';
  END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  INSERT INTO tenants(id, code, brand_name, legal_name, status, timezone, default_locale, archived_at)
    VALUES (v_tenant, t->>'code', t->>'brandName', t->>'legalName', coalesce(t->>'status', 'trial'),
      coalesce(t->>'timezone', 'Asia/Beirut'), coalesce(t->>'defaultLocale', 'en-LB'), (t->>'archivedAt')::timestamptz)
    ON CONFLICT (id) DO UPDATE SET
      code = excluded.code, brand_name = excluded.brand_name, legal_name = excluded.legal_name,
      status = excluded.status, timezone = excluded.timezone, default_locale = excluded.default_locale,
      archived_at = excluded.archived_at
    WHERE (tenants.code, tenants.brand_name, tenants.legal_name, tenants.status, tenants.timezone, tenants.default_locale, tenants.archived_at)
      IS DISTINCT FROM (excluded.code, excluded.brand_name, excluded.legal_name, excluded.status, excluded.timezone, excluded.default_locale, excluded.archived_at);

  FOR m IN SELECT * FROM jsonb_array_elements(payload->'members') LOOP
    seen := array_append(seen, (m->>'userId')::uuid);
    -- xmax = 0 on the returned row means the row was inserted; an unchanged row returns nothing.
    was_insert := NULL;
    INSERT INTO users(id, account_kind, email, display_name, password_hash, mfa_required, disabled_at)
      VALUES ((m->>'userId')::uuid, 'tenant', m->>'email', m->>'displayName', 'mirror$not-a-login',
        coalesce((m->>'mfaRequired')::boolean, false), (m->>'disabledAt')::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        email = excluded.email, display_name = excluded.display_name,
        mfa_required = excluded.mfa_required, disabled_at = excluded.disabled_at
      WHERE (users.email, users.display_name, users.mfa_required, users.disabled_at)
        IS DISTINCT FROM (excluded.email, excluded.display_name, excluded.mfa_required, excluded.disabled_at)
      RETURNING (xmax = 0) INTO was_insert;
    IF was_insert IS TRUE THEN inserted_users := inserted_users + 1;
    ELSIF was_insert IS FALSE THEN updated_users := updated_users + 1; END IF;

    was_insert := NULL;
    INSERT INTO tenant_memberships(id, tenant_id, user_id, role_key, permissions, scope, active)
      VALUES (coalesce((m->>'membershipId')::uuid, gen_random_uuid()), v_tenant, (m->>'userId')::uuid, m->>'roleKey',
        coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(m->'permissions') x), ARRAY[]::text[]),
        coalesce(m->'scope', '{}'::jsonb), coalesce((m->>'active')::boolean, true))
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role_key = excluded.role_key, permissions = excluded.permissions, scope = excluded.scope, active = excluded.active
      WHERE (tenant_memberships.role_key, tenant_memberships.permissions, tenant_memberships.scope, tenant_memberships.active)
        IS DISTINCT FROM (excluded.role_key, excluded.permissions, excluded.scope, excluded.active)
      RETURNING (xmax = 0) INTO was_insert;
    IF was_insert IS TRUE THEN inserted_members := inserted_members + 1;
    ELSIF was_insert IS FALSE THEN updated_members := updated_members + 1; END IF;
  END LOOP;

  -- A membership the control database no longer lists is deactivated, never deleted: operational
  -- rows keep referencing it.
  UPDATE tenant_memberships SET active = false
    WHERE tenant_id = v_tenant AND active AND NOT (user_id = ANY(seen));
  GET DIAGNOSTICS deactivated = ROW_COUNT;

  PERFORM set_config('app.tenant_id', '', true);
  RETURN jsonb_build_object('tenantId', v_tenant, 'insertedUsers', inserted_users, 'updatedUsers', updated_users,
    'insertedMembers', inserted_members, 'updatedMembers', updated_members, 'deactivatedMembers', deactivated,
    'members', jsonb_array_length(payload->'members'));
END $$;
REVOKE ALL ON FUNCTION mirror_tenant_directory(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mirror_tenant_directory(jsonb) TO orvex_runtime;
