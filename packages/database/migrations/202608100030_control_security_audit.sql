-- REQ-SEC-005: authentication and unscoped platform denials require a control-plane audit sink.
CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text,
  session_id text,
  claimed_tenant_id text,
  support_grant_id text,
  action text NOT NULL,
  reason text NOT NULL,
  request_id text NOT NULL,
  ip_address text NOT NULL,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, action)
);

CREATE INDEX security_events_time_idx ON security_events (occurred_at DESC);
CREATE INDEX security_events_actor_time_idx ON security_events (actor_id, occurred_at DESC);

CREATE TRIGGER security_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER security_events_no_truncate
BEFORE TRUNCATE ON security_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

GRANT INSERT ON TABLE security_events TO orvex_runtime;
GRANT SELECT ON TABLE _orvex_migrations TO orvex_runtime;
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON TABLE security_events FROM orvex_runtime;
