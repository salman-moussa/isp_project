-- REQ-SEC-003, REQ-SEC-006: keep the application role non-owning and make audit storage append-only.
-- Cluster roles are provisioned before this migration by infrastructure (or the production DBA).

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO orvex_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

ALTER TABLE support_grants
  ADD COLUMN authorization_version bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT support_grants_authorization_version_check CHECK (authorization_version > 0),
  ADD CONSTRAINT support_grants_permissions_nonempty_check CHECK (cardinality(permissions) > 0),
  ADD CONSTRAINT support_grants_approval_state_check
    CHECK (status <> 'approved' OR approver_id IS NOT NULL);

CREATE FUNCTION bump_support_grant_authorization_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.tenant_id, NEW.ticket_id, NEW.requester_id, NEW.approver_id, NEW.permissions,
    NEW.status, NEW.expires_at, NEW.revoked_at
  ) IS DISTINCT FROM ROW(
    OLD.tenant_id, OLD.ticket_id, OLD.requester_id, OLD.approver_id, OLD.permissions,
    OLD.status, OLD.expires_at, OLD.revoked_at
  ) THEN
    NEW.authorization_version := OLD.authorization_version + 1;
  ELSE
    NEW.authorization_version := OLD.authorization_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_grants_bump_authorization_version
BEFORE UPDATE ON support_grants
FOR EACH ROW EXECUTE FUNCTION bump_support_grant_authorization_version();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  tenants,
  users,
  tenant_memberships,
  sessions,
  support_grants,
  tenant_dashboard_snapshots
TO orvex_runtime;

GRANT SELECT, INSERT ON TABLE audit_events TO orvex_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM orvex_runtime;

REVOKE ALL ON FUNCTION reject_audit_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_support_grant_authorization_version() FROM PUBLIC;

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- New objects remain private until the migration that creates them grants the exact runtime access.
ALTER DEFAULT PRIVILEGES FOR ROLE orvex_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE orvex_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
