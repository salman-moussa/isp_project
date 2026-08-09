CREATE TYPE account_kind AS ENUM ('platform', 'tenant');
CREATE TYPE support_grant_status AS ENUM ('requested', 'approved', 'revoked', 'expired');

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  brand_name text NOT NULL,
  legal_name text NOT NULL,
  status text NOT NULL DEFAULT 'trial',
  timezone text NOT NULL DEFAULT 'Asia/Beirut',
  default_locale text NOT NULL DEFAULT 'en-LB',
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_kind account_kind NOT NULL,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  mfa_required boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_key text NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_memberships_tenant_idx ON tenant_memberships (tenant_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_digest text NOT NULL UNIQUE,
  device_label text,
  ip_address text,
  user_agent text,
  mfa_verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE support_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ticket_id text NOT NULL,
  requester_id uuid NOT NULL REFERENCES users(id),
  approver_id uuid REFERENCES users(id),
  reason text NOT NULL,
  permissions text[] NOT NULL,
  status support_grant_status NOT NULL DEFAULT 'requested',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approver_id IS NULL OR approver_id <> requester_id)
);
CREATE INDEX support_grants_tenant_status_idx ON support_grants (tenant_id, status);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_id uuid REFERENCES users(id),
  session_id uuid,
  support_grant_id uuid REFERENCES support_grants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  reason text,
  request_id text NOT NULL,
  ip_address text,
  user_agent text,
  result text NOT NULL,
  before jsonb,
  after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, action)
);
CREATE INDEX audit_events_tenant_time_idx ON audit_events (tenant_id, occurred_at);
CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_id, occurred_at);

CREATE TABLE tenant_dashboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  active_subscribers bigint NOT NULL DEFAULT 0,
  online_subscribers bigint NOT NULL DEFAULT 0,
  collections_usd_minor bigint NOT NULL DEFAULT 0,
  collections_lbp_minor bigint NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_subscribers >= 0),
  CHECK (online_subscribers >= 0)
);
CREATE INDEX tenant_dashboard_snapshots_tenant_time_idx
  ON tenant_dashboard_snapshots (tenant_id, computed_at DESC);

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_memberships_isolation ON tenant_memberships
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY support_grants_isolation ON support_grants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_isolation ON audit_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tenant_dashboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_dashboard_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_dashboard_snapshots_isolation ON tenant_dashboard_snapshots
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
