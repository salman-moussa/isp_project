-- orvex:database=control
-- REQ-CC-001..007: private Control Center client, catalogue, subscription and billing slice.
-- Forward-only control-database migration. Commercial lifecycle changes deliberately have no
-- subscriber/network job table, trigger, foreign key, notification, or worker side effect.
-- Deployment prerequisite: the non-login role orvex_control_runtime must be bootstrapped before
-- this migration. The API login receives SET-only membership and a separate CONTROL_DATABASE_URL.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvex_control_runtime') THEN
    RAISE EXCEPTION 'bootstrap required role orvex_control_runtime before migration';
  END IF;
END $$;

-- HMAC verification is performed inside the database trust boundary. pgcrypto is a trusted
-- extension and must be installed on the control plane before signed request functions exist.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE control_client_state AS ENUM
  ('lead', 'trial', 'active', 'grace', 'restricted', 'terminated', 'archived');
CREATE TYPE control_currency AS ENUM ('USD', 'LBP');
CREATE TYPE control_finance_entry_kind AS ENUM ('posted', 'reversal');
CREATE TYPE control_approval_status AS ENUM ('pending', 'executed', 'rejected');

CREATE TABLE control_center_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 2 AND 200),
  trading_name text NOT NULL CHECK (length(btrim(trading_name)) BETWEEN 2 AND 200),
  registration_number text,
  account_owner_id text,
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX control_center_clients_owner_idx ON control_center_clients (account_owner_id, created_at DESC);

CREATE TABLE control_center_client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  contact_role text NOT NULL CHECK (contact_role IN ('primary', 'billing', 'technical', 'legal')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  email text,
  phone text,
  preferred_locale text NOT NULL CHECK (preferred_locale IN ('en', 'ar')),
  is_primary boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX control_center_contacts_one_primary_idx
  ON control_center_client_contacts (tenant_id) WHERE is_primary AND archived_at IS NULL;

CREATE TABLE control_center_package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_key text NOT NULL CHECK (package_key ~ '^[a-z][a-z0-9_-]{2,49}$'),
  version integer NOT NULL CHECK (version > 0),
  name_en text NOT NULL CHECK (length(btrim(name_en)) > 0),
  name_ar text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  entitlements text[] NOT NULL CHECK (cardinality(entitlements) > 0),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency control_currency NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (package_key, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX control_center_packages_effective_idx
  ON control_center_package_versions (package_key, effective_from DESC);

CREATE TABLE control_center_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES control_center_clients(tenant_id),
  package_version_id uuid NOT NULL REFERENCES control_center_package_versions(id),
  state control_client_state NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX control_center_subscriptions_state_idx ON control_center_subscriptions (state, updated_at DESC);

CREATE TABLE control_center_transition_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  subscription_id uuid NOT NULL REFERENCES control_center_subscriptions(id),
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  from_state control_client_state NOT NULL,
  to_state control_client_state NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  requested_by text NOT NULL,
  requested_session_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status control_approval_status NOT NULL DEFAULT 'pending',
  decided_by text,
  decision_reason text,
  decided_at timestamptz,
  CHECK ((status = 'pending') = (decided_by IS NULL AND decision_reason IS NULL AND decided_at IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE TABLE control_center_subscription_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  subscription_id uuid NOT NULL REFERENCES control_center_subscriptions(id),
  request_id uuid REFERENCES control_center_transition_requests(id),
  from_state control_client_state NOT NULL,
  to_state control_client_state NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  actor_id text NOT NULL,
  approver_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (actor_id IS DISTINCT FROM approver_id),
  CHECK (to_state NOT IN ('restricted', 'terminated', 'archived') OR approver_id IS NOT NULL)
);
CREATE INDEX control_center_transitions_tenant_time_idx
  ON control_center_subscription_transitions (tenant_id, occurred_at DESC);

CREATE TABLE control_center_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  entry_kind control_finance_entry_kind NOT NULL,
  invoice_number text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 100),
  reverses_invoice_id uuid REFERENCES control_center_invoices(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency control_currency NOT NULL,
  due_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, invoice_number, entry_kind), UNIQUE (reverses_invoice_id),
  CHECK ((entry_kind = 'posted' AND reverses_invoice_id IS NULL) OR
         (entry_kind = 'reversal' AND reverses_invoice_id IS NOT NULL))
);
CREATE TABLE control_center_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  entry_kind control_finance_entry_kind NOT NULL,
  receipt_number text NOT NULL CHECK (length(btrim(receipt_number)) BETWEEN 1 AND 100),
  reverses_payment_id uuid REFERENCES control_center_payments(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency control_currency NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, receipt_number, entry_kind), UNIQUE (reverses_payment_id),
  CHECK ((entry_kind = 'posted' AND reverses_payment_id IS NULL) OR
         (entry_kind = 'reversal' AND reverses_payment_id IS NOT NULL))
);
CREATE TABLE control_center_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  entry_kind control_finance_entry_kind NOT NULL,
  reverses_allocation_id uuid REFERENCES control_center_payment_allocations(id),
  invoice_id uuid NOT NULL REFERENCES control_center_invoices(id),
  payment_id uuid NOT NULL REFERENCES control_center_payments(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency control_currency NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (reverses_allocation_id),
  CHECK ((entry_kind = 'posted' AND reverses_allocation_id IS NULL) OR
         (entry_kind = 'reversal' AND reverses_allocation_id IS NOT NULL))
);

CREATE TABLE control_center_service_summaries (
  tenant_id uuid PRIMARY KEY REFERENCES control_center_clients(tenant_id),
  deployment_health text NOT NULL CHECK (deployment_health IN ('healthy', 'attention', 'blocked')),
  deployment_stage text NOT NULL,
  deployment_updated_at timestamptz NOT NULL,
  support_status text NOT NULL CHECK (support_status IN ('clear', 'open', 'escalated')),
  open_ticket_count integer NOT NULL DEFAULT 0 CHECK (open_ticket_count >= 0),
  oldest_open_ticket_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE control_center_idempotency (
  operation text NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation, actor_id, session_id, idempotency_key)
);

-- Installed out-of-band by a DBA. Runtime can verify signed attestations but cannot read key rows.
CREATE TABLE control_center_context_keys (
  key_id text PRIMARY KEY,
  secret bytea NOT NULL CHECK (octet_length(secret) >= 32),
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE TABLE control_center_request_contexts (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  permission text NOT NULL,
  action text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  ip_address inet NOT NULL,
  user_agent text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  mfa_verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (backend_pid,transaction_id)
);

CREATE TABLE control_center_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  tenant_id uuid,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  permission text NOT NULL,
  request_id text NOT NULL,
  ip_address inet NOT NULL,
  user_agent text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, operation)
);
CREATE INDEX control_center_audit_tenant_time_idx ON control_center_audit_events (tenant_id, occurred_at DESC);

CREATE FUNCTION reject_control_center_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Control Center evidence is append-only' USING ERRCODE = '55000';
END $$;
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['control_center_package_versions','control_center_subscription_transitions',
    'control_center_invoices','control_center_payments','control_center_payment_allocations',
    'control_center_audit_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_control_center_immutable_mutation()', n, n);
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_control_center_immutable_mutation()', n, n);
  END LOOP;
END $$;

CREATE FUNCTION guard_control_subscription_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('app.control_internal_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'subscription lifecycle is writable only through guarded Control Center functions'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER control_center_subscriptions_guard
BEFORE INSERT OR UPDATE OR DELETE ON control_center_subscriptions
FOR EACH ROW EXECUTE FUNCTION guard_control_subscription_write();

CREATE FUNCTION validate_control_package_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_version integer; BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.package_key, 2100));
  SELECT max(version) INTO prior_version FROM control_center_package_versions WHERE package_key = NEW.package_key;
  IF (prior_version IS NULL AND NEW.version <> 1) OR
     (prior_version IS NOT NULL AND NEW.version <> prior_version + 1) THEN
    RAISE EXCEPTION 'package version must increase monotonically by one' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM control_center_package_versions p WHERE p.package_key = NEW.package_key
    AND tstzrange(p.effective_from, p.effective_until, '[)') &&
        tstzrange(NEW.effective_from, NEW.effective_until, '[)')) THEN
    RAISE EXCEPTION 'package effective periods cannot overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER control_center_package_version_guard BEFORE INSERT ON control_center_package_versions
FOR EACH ROW EXECUTE FUNCTION validate_control_package_version();

CREATE FUNCTION validate_control_finance_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oi control_center_invoices%ROWTYPE; op control_center_payments%ROWTYPE; oa control_center_payment_allocations%ROWTYPE;
DECLARE invoice_used bigint; payment_used bigint; BEGIN
  IF TG_TABLE_NAME = 'control_center_payment_allocations' THEN
    SELECT * INTO oi FROM control_center_invoices WHERE id = NEW.invoice_id FOR UPDATE;
    SELECT * INTO op FROM control_center_payments WHERE id = NEW.payment_id FOR UPDATE;
    IF oi.id IS NULL OR op.id IS NULL OR oi.tenant_id <> NEW.tenant_id OR op.tenant_id <> NEW.tenant_id
       OR oi.entry_kind <> 'posted' OR op.entry_kind <> 'posted' OR oi.currency <> NEW.currency OR op.currency <> NEW.currency THEN
      RAISE EXCEPTION 'allocation tenant, kind, or currency mismatch' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM control_center_invoices WHERE reverses_invoice_id=oi.id) OR
       EXISTS (SELECT 1 FROM control_center_payments WHERE reverses_payment_id=op.id) THEN
      RAISE EXCEPTION 'allocation cannot target a reversed document' USING ERRCODE='23514';
    END IF;
    IF NEW.entry_kind = 'reversal' THEN
      SELECT * INTO oa FROM control_center_payment_allocations WHERE id = NEW.reverses_allocation_id FOR UPDATE;
      IF oa.id IS NULL OR oa.entry_kind <> 'posted' OR oa.tenant_id <> NEW.tenant_id OR oa.invoice_id <> NEW.invoice_id
         OR oa.payment_id <> NEW.payment_id OR oa.amount_minor <> NEW.amount_minor OR oa.currency <> NEW.currency THEN
        RAISE EXCEPTION 'allocation reversal must exactly match original' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT COALESCE(sum(CASE WHEN entry_kind='posted' THEN amount_minor ELSE -amount_minor END),0)
        INTO invoice_used FROM control_center_payment_allocations WHERE invoice_id=NEW.invoice_id;
      SELECT COALESCE(sum(CASE WHEN entry_kind='posted' THEN amount_minor ELSE -amount_minor END),0)
        INTO payment_used FROM control_center_payment_allocations WHERE payment_id=NEW.payment_id;
      IF invoice_used + NEW.amount_minor > oi.amount_minor OR payment_used + NEW.amount_minor > op.amount_minor THEN
        RAISE EXCEPTION 'allocation exceeds available balance' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.entry_kind = 'reversal' THEN
    IF TG_TABLE_NAME = 'control_center_invoices' THEN
      SELECT * INTO oi FROM control_center_invoices WHERE id=NEW.reverses_invoice_id FOR UPDATE;
      IF oi.id IS NULL OR oi.entry_kind <> 'posted' OR oi.tenant_id<>NEW.tenant_id OR oi.amount_minor<>NEW.amount_minor OR oi.currency<>NEW.currency
         OR EXISTS (SELECT 1 FROM control_center_payment_allocations a WHERE a.invoice_id=oi.id GROUP BY a.invoice_id
                    HAVING sum(CASE WHEN a.entry_kind='posted' THEN a.amount_minor ELSE -a.amount_minor END) <> 0) THEN
        RAISE EXCEPTION 'invoice reversal must match an unallocated posting' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO op FROM control_center_payments WHERE id=NEW.reverses_payment_id FOR UPDATE;
      IF op.id IS NULL OR op.entry_kind <> 'posted' OR op.tenant_id<>NEW.tenant_id OR op.amount_minor<>NEW.amount_minor OR op.currency<>NEW.currency
         OR EXISTS (SELECT 1 FROM control_center_payment_allocations a WHERE a.payment_id=op.id GROUP BY a.payment_id
                    HAVING sum(CASE WHEN a.entry_kind='posted' THEN a.amount_minor ELSE -a.amount_minor END) <> 0) THEN
        RAISE EXCEPTION 'payment reversal must match an unallocated posting' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER control_center_invoice_balance_guard BEFORE INSERT ON control_center_invoices FOR EACH ROW EXECUTE FUNCTION validate_control_finance_write();
CREATE TRIGGER control_center_payment_balance_guard BEFORE INSERT ON control_center_payments FOR EACH ROW EXECUTE FUNCTION validate_control_finance_write();
CREATE TRIGGER control_center_allocation_balance_guard BEFORE INSERT ON control_center_payment_allocations FOR EACH ROW EXECUTE FUNCTION validate_control_finance_write();

CREATE FUNCTION begin_control_request_context(attestation_text text,signature_hex text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE attestation jsonb; context_key control_center_context_keys%ROWTYPE; expires timestamptz; BEGIN
  attestation:=attestation_text::jsonb;
  SELECT * INTO context_key FROM control_center_context_keys WHERE key_id=attestation->>'keyId'
    AND active_from<=clock_timestamp() AND (active_until IS NULL OR active_until>clock_timestamp());
  IF NOT FOUND OR signature_hex IS NULL OR
     encode(hmac(convert_to(attestation_text,'UTF8'),context_key.secret,'sha256'),'hex')<>lower(signature_hex) THEN
    RAISE EXCEPTION 'invalid Control Center context attestation' USING ERRCODE='CA403';
  END IF;
  expires:=(attestation->>'expiresAt')::timestamptz;
  IF expires<=clock_timestamp() OR expires>clock_timestamp()+interval '5 minutes' OR
     nullif(attestation->>'actorId','') IS NULL OR nullif(attestation->>'sessionId','') IS NULL OR
     nullif(attestation->>'permission','') IS NULL OR nullif(attestation->>'action','') IS NULL OR
     nullif(attestation->>'requestId','') IS NULL OR nullif(attestation->>'requestHash','') IS NULL OR
     nullif(attestation->>'ipAddress','') IS NULL OR length(btrim(coalesce(attestation->>'reason','')))<8 OR
     length(btrim(coalesce(attestation->>'idempotencyKey','')))<8 THEN
    RAISE EXCEPTION 'expired or incomplete Control Center context attestation' USING ERRCODE='CA403';
  END IF;
  DELETE FROM control_center_request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  INSERT INTO control_center_request_contexts(backend_pid,transaction_id,actor_id,session_id,permission,action,
    request_id,request_hash,idempotency_key,ip_address,user_agent,reason,mfa_verified_at,expires_at)
  VALUES(pg_backend_pid(),txid_current(),attestation->>'actorId',attestation->>'sessionId',attestation->>'permission',
    attestation->>'action',attestation->>'requestId',lower(attestation->>'requestHash'),attestation->>'idempotencyKey',
    (attestation->>'ipAddress')::inet,nullif(attestation->>'userAgent',''),attestation->>'reason',
    nullif(attestation->>'mfaVerifiedAt','')::timestamptz,expires);
END $$;

CREATE FUNCTION control_current_context() RETURNS SETOF control_center_request_contexts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT * FROM control_center_request_contexts WHERE backend_pid=pg_backend_pid()
    AND transaction_id=txid_current() AND expires_at>clock_timestamp()
$$;

-- Runtime readiness is intentionally metadata-only. It proves that the SET-only login reached the
-- dedicated role and that at least one signing key is currently usable without exposing key bytes.
CREATE FUNCTION control_center_readiness()
RETURNS TABLE(
  relations_ready boolean,
  migrations_ready boolean,
  runtime_role_ready boolean,
  context_key_ready boolean,
  privileges_ready boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT
    to_regclass('public.security_events') IS NOT NULL
      AND to_regclass('public.control_center_clients') IS NOT NULL
      AND to_regclass('public.control_center_audit_events') IS NOT NULL,
    EXISTS (
      SELECT 1 FROM _orvex_migrations
      WHERE name = '202608100030_control_security_audit.sql'
    ) AND EXISTS (
      SELECT 1 FROM _orvex_migrations
      WHERE name = '202608112100_control_center_core.sql'
    ),
    current_setting('role', true) = 'orvex_control_runtime'
      AND EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'orvex_control_runtime' AND NOT rolcanlogin AND NOT rolbypassrls
      )
      AND pg_has_role(session_user, 'orvex_control_runtime', 'SET'),
    EXISTS (
      SELECT 1 FROM control_center_context_keys
      WHERE active_from <= clock_timestamp()
        AND (active_until IS NULL OR active_until > clock_timestamp())
    ),
    has_function_privilege(
      'orvex_control_runtime',
      'public.begin_control_request_context(text,text)',
      'EXECUTE'
    )
      AND has_function_privilege(
        'orvex_control_runtime',
        'public.create_control_client(uuid,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      )
      AND NOT has_table_privilege(
        'orvex_control_runtime', 'public.control_center_context_keys', 'SELECT'
      )
$$;

CREATE FUNCTION control_require_context(required_permission text,required_action text,require_fresh_mfa boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row control_center_request_contexts%ROWTYPE; BEGIN
  SELECT * INTO context_row FROM control_current_context();
  IF NOT FOUND OR context_row.permission IS DISTINCT FROM required_permission OR context_row.action IS DISTINCT FROM required_action THEN
    RAISE EXCEPTION 'signed Control Center request context is required' USING ERRCODE='CA403';
  END IF;
  IF require_fresh_mfa AND (context_row.mfa_verified_at IS NULL OR context_row.mfa_verified_at>clock_timestamp()
    OR context_row.mfa_verified_at<clock_timestamp()-interval '10 minutes') THEN
    RAISE EXCEPTION 'fresh MFA verification is required' USING ERRCODE='CA403';
  END IF;
END $$;

CREATE FUNCTION control_claim_idempotency(op text,key text,hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior control_center_idempotency%ROWTYPE; context_row control_center_request_contexts%ROWTYPE; inserted boolean; BEGIN
  SELECT * INTO STRICT context_row FROM control_current_context();
  IF context_row.action<>op OR context_row.idempotency_key<>key OR context_row.request_hash<>hash THEN
    RAISE EXCEPTION 'signed request identity does not match mutation' USING ERRCODE='CA403';
  END IF;
  INSERT INTO control_center_idempotency(operation,actor_id,session_id,idempotency_key,request_hash)
    VALUES(op,context_row.actor_id,context_row.session_id,key,hash) ON CONFLICT DO NOTHING RETURNING true INTO inserted;
  IF inserted THEN RETURN NULL; END IF;
  SELECT * INTO prior FROM control_center_idempotency WHERE operation=op AND actor_id=context_row.actor_id
    AND session_id=context_row.session_id AND idempotency_key=key;
  IF prior.request_hash IS DISTINCT FROM hash THEN
    RAISE EXCEPTION 'idempotency key reused with different request' USING ERRCODE='CI409';
  END IF;
  IF prior.response IS NULL THEN RAISE EXCEPTION 'idempotent operation has no committed result' USING ERRCODE='40001'; END IF;
  RETURN prior.response;
END $$;
CREATE FUNCTION control_complete_idempotency(op text,key text,result jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  UPDATE control_center_idempotency SET response=result WHERE operation=op
    AND actor_id=(SELECT actor_id FROM control_current_context())
    AND session_id=(SELECT session_id FROM control_current_context()) AND idempotency_key=key
$$;

CREATE FUNCTION control_append_audit(op text, entity_kind text, entity text, tenant uuid, why text, before_value jsonb, after_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row control_center_request_contexts%ROWTYPE; BEGIN
  SELECT * INTO STRICT context_row FROM control_current_context();
  IF context_row.action<>op OR context_row.reason<>why THEN
    RAISE EXCEPTION 'signed audit context does not match mutation' USING ERRCODE='CA403';
  END IF;
  INSERT INTO control_center_audit_events(operation,entity_type,entity_id,tenant_id,actor_id,session_id,
    permission,request_id,ip_address,user_agent,reason,before_state,after_state,occurred_at)
  VALUES(op,entity_kind,entity,tenant,context_row.actor_id,context_row.session_id,context_row.permission,
    context_row.request_id,context_row.ip_address,context_row.user_agent,why,before_value,after_value,clock_timestamp());
END
$$;

CREATE FUNCTION create_control_client(p_tenant uuid,p_legal text,p_trading text,p_registration text,p_owner text,p_notes text,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; row control_center_clients%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.client.manage','client.create'); replay:=control_claim_idempotency('client.create',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  INSERT INTO control_center_clients(tenant_id,legal_name,trading_name,registration_number,account_owner_id,notes,created_by)
    VALUES(p_tenant,btrim(p_legal),btrim(p_trading),p_registration,p_owner,coalesce(p_notes,''),(SELECT actor_id FROM control_current_context())) RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'tenantId',row.tenant_id,'legalName',row.legal_name,'tradingName',row.trading_name,'state','lead','createdAt',row.created_at,'replay',false);
  PERFORM control_append_audit('client.create','client',row.id::text,row.tenant_id,p_reason,'null'::jsonb,to_jsonb(row));
  PERFORM control_complete_idempotency('client.create',p_key,result); RETURN result;
END $$;

CREATE FUNCTION create_control_contact(p_tenant uuid,p_role text,p_name text,p_email text,p_phone text,p_locale text,p_primary boolean,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; row control_center_client_contacts%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.client.manage','contact.create'); replay:=control_claim_idempotency('contact.create',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  INSERT INTO control_center_client_contacts(tenant_id,contact_role,display_name,email,phone,preferred_locale,is_primary,created_by)
    VALUES(p_tenant,p_role,btrim(p_name),p_email,p_phone,p_locale,p_primary,(SELECT actor_id FROM control_current_context())) RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'tenantId',row.tenant_id,'replay',false);
  PERFORM control_append_audit('contact.create','contact',row.id::text,row.tenant_id,p_reason,'null'::jsonb,to_jsonb(row));
  PERFORM control_complete_idempotency('contact.create',p_key,result); RETURN result;
END $$;

CREATE FUNCTION create_control_package_version(p_key_name text,p_version integer,p_name_en text,p_name_ar text,p_entitlements text[],p_price bigint,p_currency control_currency,p_from timestamptz,p_until timestamptz,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; row control_center_package_versions%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.subscription.manage','package.create'); replay:=control_claim_idempotency('package.create',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  INSERT INTO control_center_package_versions(package_key,version,name_en,name_ar,entitlements,price_minor,currency,effective_from,effective_until,created_by)
    VALUES(p_key_name,p_version,btrim(p_name_en),btrim(p_name_ar),p_entitlements,p_price,p_currency,p_from,p_until,(SELECT actor_id FROM control_current_context())) RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'packageKey',row.package_key,'version',row.version,'replay',false);
  PERFORM control_append_audit('package.create','package_version',row.id::text,NULL,p_reason,'null'::jsonb,to_jsonb(row));
  PERFORM control_complete_idempotency('package.create',p_key,result); RETURN result;
END $$;

CREATE FUNCTION assign_control_subscription(p_tenant uuid,p_package uuid,p_state control_client_state,p_starts timestamptz,p_expected_revision integer,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; prior control_center_subscriptions%ROWTYPE; row control_center_subscriptions%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.subscription.manage','subscription.assign'); replay:=control_claim_idempotency('subscription.assign',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  SELECT * INTO prior FROM control_center_subscriptions WHERE tenant_id=p_tenant FOR UPDATE;
  IF prior.id IS NOT NULL AND prior.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'subscription revision conflict' USING ERRCODE='CC412'; END IF;
  IF prior.id IS NULL AND p_state NOT IN ('lead','trial','active') THEN RAISE EXCEPTION 'initial subscription state cannot bypass approval' USING ERRCODE='23514'; END IF;
  IF prior.id IS NOT NULL AND p_state <> prior.state THEN RAISE EXCEPTION 'package assignment cannot change lifecycle state' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM control_center_package_versions WHERE id=p_package
    AND effective_from<=CASE WHEN prior.id IS NULL THEN p_starts ELSE prior.starts_at END
    AND (effective_until IS NULL OR effective_until>CASE WHEN prior.id IS NULL THEN p_starts ELSE prior.starts_at END);
  IF NOT FOUND THEN RAISE EXCEPTION 'package version is not effective at canonical subscription start' USING ERRCODE='23514'; END IF;
  PERFORM set_config('app.control_internal_write','on',true);
  INSERT INTO control_center_subscriptions(tenant_id,package_version_id,state,starts_at,created_by)
    VALUES(p_tenant,p_package,p_state,p_starts,(SELECT actor_id FROM control_current_context()))
    ON CONFLICT(tenant_id) DO UPDATE SET package_version_id=excluded.package_version_id,revision=control_center_subscriptions.revision+1,updated_at=clock_timestamp()
    RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'tenantId',row.tenant_id,'state',row.state,'revision',row.revision,'replay',false);
  PERFORM control_append_audit('subscription.assign','subscription',row.id::text,row.tenant_id,p_reason,coalesce(to_jsonb(prior),'null'::jsonb),to_jsonb(row));
  PERFORM control_complete_idempotency('subscription.assign',p_key,result); RETURN result;
END $$;

CREATE FUNCTION control_transition_allowed(a control_client_state,b control_client_state) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT (a,b) IN (('lead','trial'),('lead','active'),('lead','archived'),('trial','active'),('trial','terminated'),('trial','archived'),('active','grace'),('active','restricted'),('active','terminated'),('grace','active'),('grace','restricted'),('grace','terminated'),('restricted','active'),('restricted','terminated'),('terminated','active'),('terminated','archived')) $$;

CREATE FUNCTION request_control_transition(p_tenant uuid,p_expected_state control_client_state,p_expected_revision integer,p_to control_client_state,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; subscription_before jsonb; sub control_center_subscriptions%ROWTYPE; req control_center_transition_requests%ROWTYPE; tr control_center_subscription_transitions%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.subscription.manage','transition.request'); replay:=control_claim_idempotency('transition.request',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  SELECT * INTO sub FROM control_center_subscriptions WHERE tenant_id=p_tenant FOR UPDATE;
  IF sub.id IS NULL OR sub.state<>p_expected_state OR sub.revision<>p_expected_revision THEN RAISE EXCEPTION 'subscription state or revision conflict' USING ERRCODE='CC412'; END IF;
  IF NOT control_transition_allowed(sub.state,p_to) THEN RAISE EXCEPTION 'invalid lifecycle transition' USING ERRCODE='23514'; END IF;
  subscription_before:=to_jsonb(sub);
  IF p_to IN ('restricted','terminated','archived') OR (sub.state IN ('restricted','terminated') AND p_to='active') THEN
    INSERT INTO control_center_transition_requests(tenant_id,subscription_id,expected_revision,from_state,to_state,reason,requested_by,requested_session_id)
      SELECT p_tenant,sub.id,sub.revision,sub.state,p_to,p_reason,actor_id,session_id FROM control_current_context() RETURNING * INTO req;
    result:=jsonb_build_object('approvalRequestId',req.id,'state',sub.state,'status','pending','replay',false);
    PERFORM control_append_audit('transition.request','transition_request',req.id::text,p_tenant,p_reason,to_jsonb(sub),to_jsonb(req));
  ELSE
    PERFORM set_config('app.control_internal_write','on',true);
    UPDATE control_center_subscriptions SET state=p_to,revision=revision+1,updated_at=clock_timestamp() WHERE id=sub.id RETURNING * INTO sub;
    INSERT INTO control_center_subscription_transitions(tenant_id,subscription_id,from_state,to_state,reason,actor_id)
      VALUES(p_tenant,sub.id,p_expected_state,p_to,p_reason,(SELECT actor_id FROM control_current_context())) RETURNING * INTO tr;
    result:=jsonb_build_object('transitionId',tr.id,'state',p_to,'status','executed','replay',false);
    PERFORM control_append_audit('transition.execute','subscription',sub.id::text,p_tenant,p_reason,subscription_before,to_jsonb(sub));
  END IF;
  PERFORM control_complete_idempotency('transition.request',p_key,result); RETURN result;
END $$;

CREATE FUNCTION approve_control_transition(p_request uuid,p_decision_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; request_before jsonb; subscription_before jsonb; context_row control_center_request_contexts%ROWTYPE; req control_center_transition_requests%ROWTYPE; sub control_center_subscriptions%ROWTYPE; tr control_center_subscription_transitions%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.subscription.manage','transition.approve',true);
  SELECT * INTO STRICT context_row FROM control_current_context();
  SELECT * INTO req FROM control_center_transition_requests WHERE id=p_request FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'transition approval request not found' USING ERRCODE='CC404'; END IF;
  IF req.requested_by=context_row.actor_id OR req.requested_session_id=context_row.session_id THEN
    RAISE EXCEPTION 'requester actor and session cannot approve own transition' USING ERRCODE='CA403';
  END IF;
  replay:=control_claim_idempotency('transition.approve',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  IF req.status<>'pending' THEN RAISE EXCEPTION 'transition approval request already decided' USING ERRCODE='CC409'; END IF;
  SELECT * INTO sub FROM control_center_subscriptions WHERE id=req.subscription_id FOR UPDATE;
  IF sub.revision<>req.expected_revision OR sub.state<>req.from_state THEN RAISE EXCEPTION 'subscription changed while approval was pending' USING ERRCODE='CC412'; END IF;
  request_before:=to_jsonb(req);
  subscription_before:=to_jsonb(sub);
  UPDATE control_center_transition_requests SET status='executed',decided_by=context_row.actor_id,decision_reason=p_decision_reason,decided_at=clock_timestamp() WHERE id=req.id RETURNING * INTO req;
  PERFORM set_config('app.control_internal_write','on',true);
  UPDATE control_center_subscriptions SET state=req.to_state,revision=revision+1,updated_at=clock_timestamp() WHERE id=sub.id RETURNING * INTO sub;
  INSERT INTO control_center_subscription_transitions(tenant_id,subscription_id,request_id,from_state,to_state,reason,actor_id,approver_id)
    VALUES(req.tenant_id,req.subscription_id,req.id,req.from_state,req.to_state,req.reason,req.requested_by,context_row.actor_id) RETURNING * INTO tr;
  result:=jsonb_build_object('transitionId',tr.id,'approvalRequestId',req.id,'state',req.to_state,'status','executed','replay',false);
  PERFORM control_append_audit('transition.approve','subscription',sub.id::text,req.tenant_id,p_decision_reason,jsonb_build_object('request',request_before,'subscription',subscription_before),jsonb_build_object('request',to_jsonb(req),'subscription',to_jsonb(sub)));
  PERFORM control_complete_idempotency('transition.approve',p_key,result); RETURN result;
END $$;

CREATE FUNCTION post_control_document(p_kind text,p_tenant uuid,p_number text,p_amount bigint,p_currency control_currency,p_due timestamptz,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; result jsonb; invoice_row control_center_invoices%ROWTYPE; payment_row control_center_payments%ROWTYPE; operation text; permission text; BEGIN
  IF p_kind NOT IN ('invoice','payment') THEN RAISE EXCEPTION 'invalid document kind' USING ERRCODE='22023'; END IF;
  operation:=p_kind||'.post'; permission:=CASE p_kind WHEN 'invoice' THEN 'platform.billing.post' ELSE 'platform.payment.post' END;
  PERFORM control_require_context(permission,operation); replay:=control_claim_idempotency(operation,p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay || '{"replay":true}'::jsonb; END IF;
  IF p_kind='invoice' THEN
    IF p_due IS NULL THEN RAISE EXCEPTION 'invoice due date required' USING ERRCODE='23502'; END IF;
    INSERT INTO control_center_invoices(tenant_id,entry_kind,invoice_number,amount_minor,currency,due_at,actor_id,reason)
      VALUES(p_tenant,'posted',p_number,p_amount,p_currency,p_due,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO invoice_row;
    result:=jsonb_build_object('id',invoice_row.id,'tenantId',invoice_row.tenant_id,'entryKind',invoice_row.entry_kind,'number',invoice_row.invoice_number,'amountMinor',invoice_row.amount_minor,'currency',invoice_row.currency,'postedAt',invoice_row.posted_at,'replay',false);
    PERFORM control_append_audit(operation,p_kind,invoice_row.id::text,p_tenant,p_reason,'null'::jsonb,to_jsonb(invoice_row));
  ELSE
    INSERT INTO control_center_payments(tenant_id,entry_kind,receipt_number,amount_minor,currency,actor_id,reason)
      VALUES(p_tenant,'posted',p_number,p_amount,p_currency,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO payment_row;
    result:=jsonb_build_object('id',payment_row.id,'tenantId',payment_row.tenant_id,'entryKind',payment_row.entry_kind,'number',payment_row.receipt_number,'amountMinor',payment_row.amount_minor,'currency',payment_row.currency,'postedAt',payment_row.posted_at,'replay',false);
    PERFORM control_append_audit(operation,p_kind,payment_row.id::text,p_tenant,p_reason,'null'::jsonb,to_jsonb(payment_row));
  END IF;
  PERFORM control_complete_idempotency(operation,p_key,result); RETURN result;
END $$;

CREATE FUNCTION reverse_control_document(p_kind text,p_tenant uuid,p_original uuid,p_number text,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; result jsonb; oi control_center_invoices%ROWTYPE; op control_center_payments%ROWTYPE; row_i control_center_invoices%ROWTYPE; row_p control_center_payments%ROWTYPE; operation text; BEGIN
  IF p_kind NOT IN ('invoice','payment') THEN RAISE EXCEPTION 'invalid document kind' USING ERRCODE='22023'; END IF;
  operation:=p_kind||'.reverse';
  PERFORM control_require_context(CASE p_kind WHEN 'invoice' THEN 'platform.billing.post' ELSE 'platform.payment.reverse' END,operation);
  replay:=control_claim_idempotency(operation,p_key,p_hash); IF replay IS NOT NULL THEN RETURN replay||'{"replay":true}'::jsonb; END IF;
  IF p_kind='invoice' THEN
    SELECT * INTO oi FROM control_center_invoices WHERE id=p_original AND tenant_id=p_tenant FOR UPDATE;
    IF oi.id IS NULL THEN RAISE EXCEPTION 'invoice not found' USING ERRCODE='CC404'; END IF;
    INSERT INTO control_center_invoices(tenant_id,entry_kind,invoice_number,reverses_invoice_id,amount_minor,currency,due_at,actor_id,reason)
      VALUES(oi.tenant_id,'reversal',p_number,oi.id,oi.amount_minor,oi.currency,oi.due_at,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO row_i;
    result:=jsonb_build_object('id',row_i.id,'tenantId',row_i.tenant_id,'entryKind',row_i.entry_kind,'number',row_i.invoice_number,'amountMinor',row_i.amount_minor,'currency',row_i.currency,'postedAt',row_i.posted_at,'replay',false);
    PERFORM control_append_audit(operation,'invoice',row_i.id::text,oi.tenant_id,p_reason,to_jsonb(oi),to_jsonb(row_i));
  ELSE
    SELECT * INTO op FROM control_center_payments WHERE id=p_original AND tenant_id=p_tenant FOR UPDATE;
    IF op.id IS NULL THEN RAISE EXCEPTION 'payment not found' USING ERRCODE='CC404'; END IF;
    INSERT INTO control_center_payments(tenant_id,entry_kind,receipt_number,reverses_payment_id,amount_minor,currency,actor_id,reason)
      VALUES(op.tenant_id,'reversal',p_number,op.id,op.amount_minor,op.currency,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO row_p;
    result:=jsonb_build_object('id',row_p.id,'tenantId',row_p.tenant_id,'entryKind',row_p.entry_kind,'number',row_p.receipt_number,'amountMinor',row_p.amount_minor,'currency',row_p.currency,'postedAt',row_p.posted_at,'replay',false);
    PERFORM control_append_audit(operation,'payment',row_p.id::text,op.tenant_id,p_reason,to_jsonb(op),to_jsonb(row_p));
  END IF;
  PERFORM control_complete_idempotency(operation,p_key,result); RETURN result;
END $$;

CREATE FUNCTION allocate_control_payment(p_tenant uuid,p_invoice uuid,p_payment uuid,p_amount bigint,p_currency control_currency,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; row control_center_payment_allocations%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.payment.post','allocation.post'); replay:=control_claim_idempotency('allocation.post',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay||'{"replay":true}'::jsonb; END IF;
  INSERT INTO control_center_payment_allocations(tenant_id,entry_kind,invoice_id,payment_id,amount_minor,currency,actor_id,reason)
    VALUES(p_tenant,'posted',p_invoice,p_payment,p_amount,p_currency,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'tenantId',row.tenant_id,'entryKind','posted','amountMinor',row.amount_minor,'currency',row.currency,'postedAt',row.posted_at,'replay',false);
  PERFORM control_append_audit('allocation.post','allocation',row.id::text,row.tenant_id,p_reason,'null'::jsonb,to_jsonb(row));
  PERFORM control_complete_idempotency('allocation.post',p_key,result); RETURN result;
END $$;

CREATE FUNCTION reverse_control_allocation(p_tenant uuid,p_original uuid,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay jsonb; original control_center_payment_allocations%ROWTYPE; row control_center_payment_allocations%ROWTYPE; result jsonb; BEGIN
  PERFORM control_require_context('platform.payment.reverse','allocation.reverse'); replay:=control_claim_idempotency('allocation.reverse',p_key,p_hash);
  IF replay IS NOT NULL THEN RETURN replay||'{"replay":true}'::jsonb; END IF;
  SELECT * INTO original FROM control_center_payment_allocations WHERE id=p_original AND tenant_id=p_tenant FOR UPDATE;
  IF original.id IS NULL THEN RAISE EXCEPTION 'allocation not found' USING ERRCODE='CC404'; END IF;
  INSERT INTO control_center_payment_allocations(tenant_id,entry_kind,reverses_allocation_id,invoice_id,payment_id,amount_minor,currency,actor_id,reason)
    VALUES(original.tenant_id,'reversal',original.id,original.invoice_id,original.payment_id,original.amount_minor,original.currency,(SELECT actor_id FROM control_current_context()),p_reason) RETURNING * INTO row;
  result:=jsonb_build_object('id',row.id,'tenantId',row.tenant_id,'entryKind','reversal','amountMinor',row.amount_minor,'currency',row.currency,'postedAt',row.posted_at,'replay',false);
  PERFORM control_append_audit('allocation.reverse','allocation',row.id::text,row.tenant_id,p_reason,to_jsonb(original),to_jsonb(row));
  PERFORM control_complete_idempotency('allocation.reverse',p_key,result); RETURN result;
END $$;

-- Cross-plane commercial-state delivery. The Control Center transaction appends this durable
-- envelope atomically; a dedicated relay delivers it to the tenant Operations database.
CREATE TABLE control_center_subscription_state_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES control_center_clients(tenant_id),
  status control_client_state NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  UNIQUE (tenant_id, revision)
);
CREATE INDEX control_center_subscription_state_outbox_pending_idx
  ON control_center_subscription_state_outbox(occurred_at,event_id) WHERE delivered_at IS NULL;

CREATE FUNCTION append_control_subscription_state_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.revision IS DISTINCT FROM OLD.revision THEN
    INSERT INTO control_center_subscription_state_outbox(tenant_id,status,revision)
    VALUES(NEW.tenant_id,NEW.state,NEW.revision);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER control_center_subscription_state_outbox_append
AFTER INSERT OR UPDATE ON control_center_subscriptions
FOR EACH ROW EXECUTE FUNCTION append_control_subscription_state_outbox();

CREATE FUNCTION list_control_subscription_state_relay_tenants() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT DISTINCT tenant_id FROM control_center_subscription_state_outbox
  WHERE delivered_at IS NULL ORDER BY tenant_id
$$;
CREATE FUNCTION read_control_subscription_state_outbox(target_tenant_id uuid,batch_size integer)
RETURNS SETOF control_center_subscription_state_outbox
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT * FROM control_center_subscription_state_outbox
  WHERE tenant_id=target_tenant_id AND delivered_at IS NULL ORDER BY occurred_at,event_id
  LIMIT greatest(1,least(coalesce(batch_size,100),500))
$$;
CREATE FUNCTION read_control_subscription_state_backlog(target_tenant_id uuid)
RETURNS TABLE(pending_count bigint,oldest_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT count(*),min(occurred_at)
  FROM control_center_subscription_state_outbox
  WHERE tenant_id=target_tenant_id AND delivered_at IS NULL
$$;
CREATE FUNCTION mark_control_subscription_state_delivered(event_id_value uuid,delivered_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE changed integer; BEGIN
  IF delivered_time IS NULL THEN RAISE EXCEPTION 'delivery time is required'; END IF;
  UPDATE control_center_subscription_state_outbox SET delivered_at=delivered_time
  WHERE event_id=event_id_value AND delivered_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
CREATE FUNCTION protect_control_subscription_state_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL
     AND ROW(NEW.event_id,NEW.tenant_id,NEW.status,NEW.revision,NEW.occurred_at)
       IS NOT DISTINCT FROM ROW(OLD.event_id,OLD.tenant_id,OLD.status,OLD.revision,OLD.occurred_at)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'subscription state outbox is immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER control_center_subscription_state_outbox_immutable
BEFORE UPDATE OR DELETE ON control_center_subscription_state_outbox
FOR EACH ROW EXECUTE FUNCTION protect_control_subscription_state_outbox();
CREATE TRIGGER control_center_subscription_state_outbox_no_truncate
BEFORE TRUNCATE ON control_center_subscription_state_outbox
FOR EACH STATEMENT EXECUTE FUNCTION protect_control_subscription_state_outbox();

-- Read access is through this stable projection; clients have no duplicated lifecycle column.
CREATE VIEW control_center_client_drilldown WITH (security_barrier=true) AS
SELECT c.id,c.tenant_id,c.legal_name,c.trading_name,coalesce(s.state,'lead'::control_client_state) state,
 c.account_owner_id,c.created_at,p.package_key,ss.deployment_health,ss.support_status,coalesce(ss.open_ticket_count,0) open_ticket_count
FROM control_center_clients c LEFT JOIN control_center_subscriptions s ON s.tenant_id=c.tenant_id
LEFT JOIN control_center_package_versions p ON p.id=s.package_version_id
LEFT JOIN control_center_service_summaries ss ON ss.tenant_id=c.tenant_id;

REVOKE ALL ON TABLE control_center_clients,control_center_client_contacts,
  control_center_package_versions,control_center_subscriptions,control_center_transition_requests,
  control_center_subscription_transitions,control_center_invoices,control_center_payments,
  control_center_payment_allocations,control_center_service_summaries,control_center_idempotency,
  control_center_audit_events,control_center_context_keys,control_center_request_contexts,
  control_center_subscription_state_outbox
  FROM orvex_control_runtime;
GRANT USAGE ON SCHEMA public TO orvex_control_runtime;
GRANT SELECT ON control_center_client_drilldown, control_center_audit_events TO orvex_control_runtime;
REVOKE ALL ON FUNCTION
  create_control_client(uuid,text,text,text,text,text,text,text,text),
  create_control_contact(uuid,text,text,text,text,text,boolean,text,text,text),
  create_control_package_version(text,integer,text,text,text[],bigint,control_currency,timestamptz,timestamptz,text,text,text),
  assign_control_subscription(uuid,uuid,control_client_state,timestamptz,integer,text,text,text),
  request_control_transition(uuid,control_client_state,integer,control_client_state,text,text,text),
  approve_control_transition(uuid,text,text,text),
  post_control_document(text,uuid,text,bigint,control_currency,timestamptz,text,text,text),
  reverse_control_document(text,uuid,uuid,text,text,text,text),
  allocate_control_payment(uuid,uuid,uuid,bigint,control_currency,text,text,text),
  reverse_control_allocation(uuid,uuid,text,text,text),
  begin_control_request_context(text,text),control_current_context(),control_center_readiness(),
  control_require_context(text,text,boolean),control_claim_idempotency(text,text,text),
  control_complete_idempotency(text,text,jsonb),
  control_append_audit(text,text,text,uuid,text,jsonb,jsonb),
  control_transition_allowed(control_client_state,control_client_state),
  reject_control_center_immutable_mutation(),guard_control_subscription_write(),
  validate_control_package_version(),validate_control_finance_write()
FROM PUBLIC;
REVOKE ALL ON FUNCTION append_control_subscription_state_outbox(),
  list_control_subscription_state_relay_tenants(),
  read_control_subscription_state_outbox(uuid,integer),
  read_control_subscription_state_backlog(uuid),
  mark_control_subscription_state_delivered(uuid,timestamptz),
  protect_control_subscription_state_outbox()
FROM PUBLIC,orvex_control_runtime;
GRANT USAGE ON SCHEMA public TO orvex_finance_audit_relay;
GRANT EXECUTE ON FUNCTION list_control_subscription_state_relay_tenants(),
  read_control_subscription_state_outbox(uuid,integer),
  read_control_subscription_state_backlog(uuid),
  mark_control_subscription_state_delivered(uuid,timestamptz)
TO orvex_finance_audit_relay;
GRANT EXECUTE ON FUNCTION
  create_control_client(uuid,text,text,text,text,text,text,text,text),
  create_control_contact(uuid,text,text,text,text,text,boolean,text,text,text),
  create_control_package_version(text,integer,text,text,text[],bigint,control_currency,timestamptz,timestamptz,text,text,text),
  assign_control_subscription(uuid,uuid,control_client_state,timestamptz,integer,text,text,text),
  request_control_transition(uuid,control_client_state,integer,control_client_state,text,text,text),
  approve_control_transition(uuid,text,text,text),
  post_control_document(text,uuid,text,bigint,control_currency,timestamptz,text,text,text),
  reverse_control_document(text,uuid,uuid,text,text,text,text),
  allocate_control_payment(uuid,uuid,uuid,bigint,control_currency,text,text,text),
  reverse_control_allocation(uuid,uuid,text,text,text),
  begin_control_request_context(text,text),control_current_context(),control_center_readiness()
TO orvex_control_runtime;
-- Bootstrap hook (outside this transaction):
-- GRANT orvex_control_runtime TO <control_api_login> WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
