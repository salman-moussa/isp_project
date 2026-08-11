-- Invalidate tenant authorization claims whenever canonical membership authority changes.

ALTER TABLE tenant_memberships
  ADD COLUMN authorization_version bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT tenant_memberships_authorization_version_check
    CHECK (authorization_version > 0);

CREATE FUNCTION bump_tenant_membership_authorization_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.tenant_id, NEW.user_id, NEW.role_key, NEW.permissions, NEW.scope, NEW.active
  ) IS DISTINCT FROM ROW(
    OLD.tenant_id, OLD.user_id, OLD.role_key, OLD.permissions, OLD.scope, OLD.active
  ) THEN
    NEW.authorization_version := OLD.authorization_version + 1;
  ELSE
    NEW.authorization_version := OLD.authorization_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_memberships_bump_authorization_version
BEFORE UPDATE ON tenant_memberships
FOR EACH ROW EXECUTE FUNCTION bump_tenant_membership_authorization_version();

REVOKE ALL ON FUNCTION bump_tenant_membership_authorization_version() FROM PUBLIC;
