-- REQ-COLLECT-001..009, REQ-FIN-001, REQ-SEC-003/006: offline Collect device and sync boundary.
-- Forward-only tenant-plane migration. Raw access/refresh tokens are never stored.
CREATE TYPE collect_device_status AS ENUM ('active', 'revoked');
CREATE TYPE collect_operation_type AS ENUM
  ('payment.create', 'reconciliation.submit', 'receipt.print.audit');
CREATE TYPE collect_reconciliation_status AS ENUM ('accepted', 'pending_approval', 'approved');

CREATE TABLE collect_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  collector_user_id uuid NOT NULL,
  -- Session authority lives in the control plane. The signed Operations context binds this
  -- opaque identifier during authorization; the API revalidates it on every token use.
  source_session_id uuid NOT NULL,
  device_label text NOT NULL,
  device_public_key_thumbprint text NOT NULL,
  status collect_device_status NOT NULL DEFAULT 'active',
  scopes text[] NOT NULL,
  mfa_verified_at timestamptz NOT NULL,
  access_token_digest bytea NOT NULL UNIQUE,
  refresh_token_digest bytea NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  refresh_generation integer NOT NULL DEFAULT 1 CHECK (refresh_generation > 0),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_seen_at timestamptz,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (length(btrim(device_label)) BETWEEN 1 AND 120),
  CHECK (length(btrim(device_public_key_thumbprint)) BETWEEN 16 AND 200),
  CHECK (octet_length(access_token_digest) = 32 AND octet_length(refresh_token_digest) = 32),
  CHECK (scopes <@ ARRAY[
    'assignments:read','payments:create','reconciliations:submit','receipts:print:audit'
  ]::text[] AND cardinality(scopes) > 0),
  CHECK (access_expires_at > authorized_at AND access_expires_at <= authorized_at + interval '15 minutes'),
  CHECK (refresh_expires_at > access_expires_at AND refresh_expires_at <= authorized_at + interval '30 days'),
  CHECK ((status = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL AND length(btrim(revocation_reason)) >= 8))
);
CREATE INDEX collect_devices_identity_idx
  ON collect_devices(tenant_id, collector_user_id, status, access_expires_at);

CREATE TABLE collect_sync_operations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  operation_type collect_operation_type NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  server_recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, device_id, sequence),
  FOREIGN KEY (tenant_id, device_id) REFERENCES collect_devices(tenant_id, id)
);

CREATE TABLE collect_reconciliation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL,
  collector_user_id uuid NOT NULL,
  route_id uuid NOT NULL,
  business_date date NOT NULL,
  currency finance_currency NOT NULL,
  server_expected_minor bigint NOT NULL CHECK (server_expected_minor >= 0),
  declared_minor bigint NOT NULL CHECK (declared_minor >= 0),
  difference_minor bigint GENERATED ALWAYS AS (declared_minor - server_expected_minor) STORED,
  status collect_reconciliation_status NOT NULL,
  operation_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES collect_devices(tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, route_id) REFERENCES operations_routes(tenant_id, id),
  CHECK ((difference_minor = 0 AND status = 'accepted')
    OR (difference_minor <> 0 AND status IN ('pending_approval','approved')))
);
CREATE INDEX collect_reconciliation_pending_idx
  ON collect_reconciliation_submissions(tenant_id, submitted_at, id)
  WHERE status = 'pending_approval';

CREATE TABLE collect_reconciliation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  reconciliation_id uuid NOT NULL,
  approver_user_id uuid NOT NULL,
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, reconciliation_id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, reconciliation_id)
    REFERENCES collect_reconciliation_submissions(tenant_id, id),
  FOREIGN KEY (tenant_id, approver_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  CHECK (length(btrim(idempotency_key)) >= 8)
);

CREATE TABLE collect_receipt_print_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL,
  collector_user_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  finance_payment_id uuid NOT NULL,
  printer_reference text NOT NULL,
  copy_kind text NOT NULL CHECK (copy_kind IN ('original','duplicate')),
  operation_id uuid NOT NULL,
  printed_at timestamptz NOT NULL,
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES collect_devices(tenant_id, id),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES operations_collector_assignments(tenant_id, id),
  FOREIGN KEY (tenant_id, finance_payment_id) REFERENCES finance_payments(tenant_id, id),
  CHECK (length(btrim(printer_reference)) BETWEEN 1 AND 200)
);

-- Monotonic server cursor; trigger-owned so clients cannot manufacture delta events.
CREATE TABLE collect_assignment_changes (
  change_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  collector_user_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  visible boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, collector_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);
CREATE INDEX collect_assignment_changes_device_delta_idx
  ON collect_assignment_changes(tenant_id, collector_user_id, change_id);

CREATE TABLE collect_audit_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  permission text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  ip_address text NOT NULL,
  user_agent text,
  reason text NOT NULL,
  after_value jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  CHECK (length(btrim(idempotency_key)) >= 8)
);
CREATE INDEX collect_audit_pending_idx ON collect_audit_outbox(tenant_id, occurred_at, event_id)
  WHERE delivered_at IS NULL;

CREATE FUNCTION collect_context_allows(target_tenant_id uuid, target_collector_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = target_tenant_id
      AND context.actor_id = target_collector_user_id::text
      AND context.support_grant_id IS NULL
      AND context.permission IN ('tenant.collection.view','tenant.payment.post','tenant.collection.reconcile')
  )
$$;

ALTER TABLE collect_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_devices_context ON collect_devices
  USING (collect_context_allows(tenant_id, collector_user_id))
  WITH CHECK (collect_context_allows(tenant_id, collector_user_id));
ALTER TABLE collect_sync_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_sync_context ON collect_sync_operations USING (EXISTS (
  SELECT 1 FROM collect_devices device WHERE device.tenant_id = collect_sync_operations.tenant_id
    AND device.id = collect_sync_operations.device_id
    AND collect_context_allows(device.tenant_id, device.collector_user_id)
)) WITH CHECK (EXISTS (
  SELECT 1 FROM collect_devices device WHERE device.tenant_id = collect_sync_operations.tenant_id
    AND device.id = collect_sync_operations.device_id
    AND collect_context_allows(device.tenant_id, device.collector_user_id)
));
ALTER TABLE collect_reconciliation_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_reconciliation_context ON collect_reconciliation_submissions
  USING (collect_context_allows(tenant_id, collector_user_id) OR EXISTS (
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_reconciliation_submissions.tenant_id
      AND context.permission = 'tenant.collection.reconcile'
      AND context.action = 'tenant.collect.reconciliation.discrepancy.approve'
  )) WITH CHECK (collect_context_allows(tenant_id, collector_user_id) OR EXISTS (
    SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_reconciliation_submissions.tenant_id
      AND context.permission = 'tenant.collection.reconcile'
      AND context.action = 'tenant.collect.reconciliation.discrepancy.approve'
  ));
ALTER TABLE collect_reconciliation_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_approval_context ON collect_reconciliation_approvals
  USING (EXISTS (SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_reconciliation_approvals.tenant_id
      AND context.actor_id = collect_reconciliation_approvals.approver_user_id::text
      AND context.permission = 'tenant.collection.reconcile'
      AND context.action = 'tenant.collect.reconciliation.discrepancy.approve'))
  WITH CHECK (EXISTS (SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_reconciliation_approvals.tenant_id
      AND context.actor_id = collect_reconciliation_approvals.approver_user_id::text
      AND context.permission = 'tenant.collection.reconcile'
      AND context.action = 'tenant.collect.reconciliation.discrepancy.approve'));
ALTER TABLE collect_receipt_print_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_print_context ON collect_receipt_print_events
  USING (collect_context_allows(tenant_id, collector_user_id))
  WITH CHECK (collect_context_allows(tenant_id, collector_user_id));
ALTER TABLE collect_assignment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_assignment_changes_context ON collect_assignment_changes
  USING (collect_context_allows(tenant_id, collector_user_id))
  WITH CHECK (
    collect_context_allows(tenant_id, collector_user_id)
    OR EXISTS (
      SELECT 1 FROM operations_current_context() context
      WHERE context.tenant_id = collect_assignment_changes.tenant_id
        AND context.permission = 'tenant.collection.reconcile'
        AND context.support_grant_id IS NULL
    )
  );
ALTER TABLE collect_audit_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY collect_audit_context ON collect_audit_outbox
  USING (EXISTS (SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_audit_outbox.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM operations_current_context() context
    WHERE context.tenant_id = collect_audit_outbox.tenant_id
      AND context.actor_id = collect_audit_outbox.actor_id
      AND context.request_id = collect_audit_outbox.request_id));

ALTER TABLE collect_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_sync_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_reconciliation_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_reconciliation_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_receipt_print_events FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_assignment_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE collect_audit_outbox FORCE ROW LEVEL SECURITY;

CREATE FUNCTION record_collect_assignment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.collector_user_id IS DISTINCT FROM NEW.collector_user_id THEN
    INSERT INTO collect_assignment_changes(tenant_id, collector_user_id, assignment_id, visible)
      VALUES (OLD.tenant_id, OLD.collector_user_id, OLD.id, false);
  END IF;
  INSERT INTO collect_assignment_changes(tenant_id, collector_user_id, assignment_id, visible)
    VALUES (NEW.tenant_id, NEW.collector_user_id, NEW.id,
      NEW.status IN ('assigned','visited','returned'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_assignment_collect_delta
AFTER INSERT OR UPDATE OF collector_user_id, status, expected_amount_minor, currency, due_on
ON operations_collector_assignments FOR EACH ROW EXECUTE FUNCTION record_collect_assignment_change();

CREATE FUNCTION validate_collect_reconciliation_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE reconciliation collect_reconciliation_submissions%ROWTYPE;
BEGIN
  SELECT * INTO reconciliation FROM collect_reconciliation_submissions
    WHERE tenant_id=NEW.tenant_id AND id=NEW.reconciliation_id FOR UPDATE;
  IF NOT FOUND OR reconciliation.status <> 'pending_approval' OR reconciliation.difference_minor = 0 THEN
    RAISE EXCEPTION USING ERRCODE='C4090', MESSAGE='only a pending Collect discrepancy can be approved';
  END IF;
  IF reconciliation.collector_user_id = NEW.approver_user_id OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships manager
    JOIN users identity ON identity.id=manager.user_id AND identity.disabled_at IS NULL
    WHERE manager.tenant_id=NEW.tenant_id AND manager.user_id=NEW.approver_user_id
      AND manager.active
      AND manager.permissions @> ARRAY['tenant.collection.reconcile']::text[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE='C4030', MESSAGE='an independent current manager is required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER collect_reconciliation_approval_guard BEFORE INSERT
  ON collect_reconciliation_approvals FOR EACH ROW
  EXECUTE FUNCTION validate_collect_reconciliation_approval();

-- Access checks are owner-mediated and return no token material. Every call rechecks the device,
-- collector membership, user, and device expiry/revocation state. Canonical source-session
-- validation is intentionally performed against the separate control plane by the API.
CREATE FUNCTION authenticate_collect_device(p_access_token_digest bytea)
RETURNS TABLE(device_id uuid, tenant_id uuid, collector_user_id uuid, source_session_id uuid,
  scopes text[], access_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  target collect_devices%ROWTYPE;
  prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  SELECT device.* INTO target FROM collect_devices device
  WHERE device.access_token_digest=p_access_token_digest AND device.status='active'
    AND device.access_expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',target.tenant_id::text,true);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships membership
    JOIN users identity ON identity.id=membership.user_id AND identity.disabled_at IS NULL
    WHERE membership.tenant_id=target.tenant_id
      AND membership.user_id=target.collector_user_id AND membership.active
      AND membership.role_key='collector'
      AND membership.permissions @> ARRAY['tenant.collection.view','tenant.payment.post']::text[]
  ) THEN
    PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  device_id:=target.id; tenant_id:=target.tenant_id;
  collector_user_id:=target.collector_user_id; source_session_id:=target.source_session_id;
  scopes:=target.scopes; access_expires_at:=target.access_expires_at;
  RETURN NEXT;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RAISE;
END;
$$;

CREATE FUNCTION rotate_collect_device_tokens(
  p_refresh_token_digest bytea, p_access_token_digest bytea, p_new_refresh_token_digest bytea,
  p_access_expires_at timestamptz, p_refresh_expires_at timestamptz
) RETURNS TABLE(device_id uuid, tenant_id uuid, collector_user_id uuid, source_session_id uuid,
  scopes text[], access_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target collect_devices%ROWTYPE;
  prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  SELECT device.* INTO target FROM collect_devices device
  WHERE device.refresh_token_digest = p_refresh_token_digest AND device.status = 'active'
    AND device.refresh_expires_at > clock_timestamp() FOR UPDATE OF device;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',target.tenant_id::text,true);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships membership
    JOIN users identity ON identity.id=membership.user_id AND identity.disabled_at IS NULL
    WHERE membership.tenant_id=target.tenant_id
      AND membership.user_id=target.collector_user_id AND membership.active
      AND membership.role_key='collector'
      AND membership.permissions @> ARRAY['tenant.collection.view','tenant.payment.post']::text[]
  ) THEN
    PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
    RETURN;
  END IF;
  IF p_access_expires_at <= clock_timestamp()
    OR p_access_expires_at > clock_timestamp() + interval '15 minutes'
    OR p_refresh_expires_at <= p_access_expires_at
    OR p_refresh_expires_at > clock_timestamp() + interval '30 days'
    OR octet_length(p_access_token_digest) <> 32 OR octet_length(p_new_refresh_token_digest) <> 32 THEN
    RAISE EXCEPTION USING ERRCODE='C4000', MESSAGE='invalid Collect token rotation envelope';
  END IF;
  UPDATE collect_devices SET access_token_digest=p_access_token_digest,
    refresh_token_digest=p_new_refresh_token_digest, access_expires_at=p_access_expires_at,
    refresh_expires_at=p_refresh_expires_at, refresh_generation=refresh_generation+1,
    last_seen_at=clock_timestamp()
  WHERE id=target.id;
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN QUERY SELECT target.id,target.tenant_id,target.collector_user_id,target.source_session_id,
    target.scopes,p_access_expires_at;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RAISE;
END;
$$;

CREATE FUNCTION protect_collect_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'collect_audit_outbox' AND TG_OP = 'UPDATE'
    AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL
    AND ROW(NEW.event_id,NEW.tenant_id,NEW.action,NEW.resource_type,NEW.resource_id,
      NEW.actor_id,NEW.session_id,NEW.permission,NEW.request_id,NEW.idempotency_key,
      NEW.ip_address,NEW.user_agent,NEW.reason,NEW.after_value,NEW.occurred_at)
      IS NOT DISTINCT FROM
      ROW(OLD.event_id,OLD.tenant_id,OLD.action,OLD.resource_type,OLD.resource_id,
      OLD.actor_id,OLD.session_id,OLD.permission,OLD.request_id,OLD.idempotency_key,
      OLD.ip_address,OLD.user_agent,OLD.reason,OLD.after_value,OLD.occurred_at) THEN RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'collect_reconciliation_submissions' AND TG_OP = 'UPDATE'
    AND OLD.status='pending_approval' AND NEW.status='approved'
    AND ROW(NEW.id,NEW.tenant_id,NEW.device_id,NEW.collector_user_id,NEW.route_id,
      NEW.business_date,NEW.currency,NEW.server_expected_minor,NEW.declared_minor,
      NEW.difference_minor,NEW.operation_id,NEW.submitted_at)
      IS NOT DISTINCT FROM
      ROW(OLD.id,OLD.tenant_id,OLD.device_id,OLD.collector_user_id,OLD.route_id,
      OLD.business_date,OLD.currency,OLD.server_expected_minor,OLD.declared_minor,
      OLD.difference_minor,OLD.operation_id,OLD.submitted_at)
    AND EXISTS (SELECT 1 FROM collect_reconciliation_approvals approval
      WHERE approval.tenant_id=NEW.tenant_id AND approval.reconciliation_id=NEW.id) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE='P4092', MESSAGE='Collect evidence is immutable';
END;
$$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['collect_sync_operations','collect_reconciliation_approvals',
    'collect_receipt_print_events','collect_assignment_changes'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_collect_evidence()',
      table_name || '_immutable', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION protect_collect_evidence()',
      table_name || '_no_truncate', table_name);
  END LOOP;
END $$;
CREATE TRIGGER collect_reconciliation_immutable BEFORE UPDATE OR DELETE
  ON collect_reconciliation_submissions FOR EACH ROW EXECUTE FUNCTION protect_collect_evidence();
CREATE TRIGGER collect_reconciliation_no_truncate BEFORE TRUNCATE
  ON collect_reconciliation_submissions FOR EACH STATEMENT EXECUTE FUNCTION protect_collect_evidence();
CREATE TRIGGER collect_audit_immutable BEFORE UPDATE OR DELETE
  ON collect_audit_outbox FOR EACH ROW EXECUTE FUNCTION protect_collect_evidence();
CREATE TRIGGER collect_audit_no_truncate BEFORE TRUNCATE
  ON collect_audit_outbox FOR EACH STATEMENT EXECUTE FUNCTION protect_collect_evidence();

CREATE FUNCTION read_collect_audit_outbox(target_tenant_id uuid, batch_size integer)
RETURNS SETOF collect_audit_outbox LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public AS $$
  SELECT * FROM collect_audit_outbox WHERE tenant_id=target_tenant_id AND delivered_at IS NULL
  ORDER BY occurred_at,event_id LIMIT greatest(1,least(coalesce(batch_size,100),500))
$$;
CREATE FUNCTION mark_collect_audit_delivered(target_event_id uuid, delivered_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE updated_count integer; BEGIN
  IF delivered_time IS NULL THEN RAISE EXCEPTION 'delivery time is required'; END IF;
  UPDATE collect_audit_outbox SET delivered_at=delivered_time
    WHERE event_id=target_event_id AND delivered_at IS NULL;
  GET DIAGNOSTICS updated_count=ROW_COUNT; RETURN updated_count=1;
END $$;

REVOKE ALL ON TABLE collect_devices,collect_sync_operations,collect_reconciliation_submissions,
  collect_reconciliation_approvals,collect_receipt_print_events,collect_assignment_changes,
  collect_audit_outbox FROM PUBLIC,orvex_runtime;
GRANT SELECT,INSERT ON collect_devices TO orvex_runtime;
GRANT UPDATE(last_sequence,last_seen_at) ON collect_devices TO orvex_runtime;
GRANT SELECT,INSERT ON collect_sync_operations,collect_reconciliation_submissions,
  collect_reconciliation_approvals,collect_receipt_print_events,collect_audit_outbox TO orvex_runtime;
GRANT SELECT ON collect_assignment_changes TO orvex_runtime;
GRANT UPDATE(status) ON collect_reconciliation_submissions TO orvex_runtime;
GRANT EXECUTE ON FUNCTION authenticate_collect_device(bytea),
  rotate_collect_device_tokens(bytea,bytea,bytea,timestamptz,timestamptz) TO orvex_runtime;
REVOKE ALL ON FUNCTION collect_context_allows(uuid,uuid),record_collect_assignment_change(),
  validate_collect_reconciliation_approval(),
  authenticate_collect_device(bytea),rotate_collect_device_tokens(bytea,bytea,bytea,timestamptz,timestamptz),
  protect_collect_evidence(),read_collect_audit_outbox(uuid,integer),
  mark_collect_audit_delivered(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collect_context_allows(uuid,uuid) TO orvex_runtime;
GRANT EXECUTE ON FUNCTION read_collect_audit_outbox(uuid,integer),
  mark_collect_audit_delivered(uuid,timestamptz) TO orvex_finance_audit_relay;
