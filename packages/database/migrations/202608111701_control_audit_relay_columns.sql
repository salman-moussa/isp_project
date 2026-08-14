-- orvex:database=control
-- Control-plane half of the tenant audit relay contract. Tenant outbox ownership and delivery
-- functions remain in migration 1700; this migration gives a separate control database only the
-- immutable audit envelope columns and least-privilege relay access it needs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orvex_finance_audit_relay') THEN
    RAISE EXCEPTION 'bootstrap required role orvex_finance_audit_relay before migration';
  END IF;
END $$;

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_reference text,
  ADD COLUMN IF NOT EXISTS session_reference text,
  ADD COLUMN IF NOT EXISTS support_grant_reference text,
  ADD COLUMN IF NOT EXISTS request_reference text,
  ADD COLUMN IF NOT EXISTS permission text;

GRANT USAGE ON SCHEMA public TO orvex_finance_audit_relay;
GRANT SELECT,INSERT ON TABLE audit_events TO orvex_finance_audit_relay;
REVOKE UPDATE,DELETE,TRUNCATE ON TABLE audit_events FROM orvex_finance_audit_relay;
