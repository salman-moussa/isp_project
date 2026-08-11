-- REQ-SEC-003, REQ-SEC-006: complete finance audit attribution and dedicated relay privileges.
ALTER TABLE finance_audit_outbox
  ADD COLUMN session_id text,
  ADD COLUMN support_grant_id text,
  ADD COLUMN request_id text,
  ADD COLUMN ip_address text,
  ADD COLUMN user_agent text,
  ADD COLUMN permission text,
  ADD COLUMN reason text,
  ADD COLUMN client_posted_at timestamptz;

-- The old protection trigger rejects every evidence-field update. Remove only the row trigger
-- inside this migration transaction, perform the controlled owner backfill, then install the
-- stricter replacement before the transaction can commit. The truncate guard remains active.
ALTER TABLE finance_audit_outbox DISABLE ROW LEVEL SECURITY;
DROP TRIGGER finance_audit_outbox_protect_update_or_delete ON finance_audit_outbox;

UPDATE finance_audit_outbox
SET
  session_id = 'legacy-unavailable',
  request_id = event_id::text,
  ip_address = 'legacy-unavailable',
  permission = 'legacy-unavailable',
  reason = 'legacy finance audit evidence before request-context capture',
  client_posted_at = occurred_at
WHERE session_id IS NULL;

ALTER TABLE finance_audit_outbox
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN request_id SET NOT NULL,
  ALTER COLUMN ip_address SET NOT NULL,
  ALTER COLUMN permission SET NOT NULL,
  ALTER COLUMN reason SET NOT NULL,
  ALTER COLUMN client_posted_at SET NOT NULL;
ALTER TABLE finance_audit_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_audit_outbox FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_events
  ADD COLUMN actor_reference text,
  ADD COLUMN session_reference text,
  ADD COLUMN support_grant_reference text,
  ADD COLUMN request_reference text,
  ADD COLUMN permission text;

CREATE OR REPLACE FUNCTION append_finance_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  base_action text;
  finance_action text;
  finance_resource_type text;
  reversal_id uuid;
  context_actor_id text;
  context_session_id text;
  context_support_grant_id text;
  context_request_id text;
  context_ip_address text;
  context_user_agent text;
  context_permission text;
  context_reason text;
BEGIN
  IF TG_TABLE_NAME = 'finance_invoices' THEN
    base_action := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'tenant.invoice.post'
      ELSE 'tenant.invoice.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'invoice'
      ELSE 'invoice_reversal'
    END;
    reversal_id := NEW.reverses_invoice_id;
  ELSIF TG_TABLE_NAME = 'finance_payments' THEN
    base_action := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'tenant.payment.post'
      ELSE 'tenant.payment.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'payment'
      ELSE 'payment_reversal'
    END;
    reversal_id := NEW.reverses_payment_id;
  ELSE
    base_action := CASE
      WHEN NEW.entry_kind = 'allocation' THEN 'tenant.payment.allocate'
      ELSE 'tenant.payment.allocation.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'allocation' THEN 'payment_allocation'
      ELSE 'payment_allocation_reversal'
    END;
    reversal_id := NEW.reverses_allocation_id;
  END IF;

  context_actor_id := nullif(current_setting('app.finance_actor_id', true), '');
  context_session_id := nullif(current_setting('app.finance_session_id', true), '');
  context_support_grant_id := nullif(current_setting('app.finance_support_grant_id', true), '');
  context_request_id := nullif(current_setting('app.finance_request_id', true), '');
  context_ip_address := nullif(current_setting('app.finance_ip_address', true), '');
  context_user_agent := nullif(current_setting('app.finance_user_agent', true), '');
  context_permission := nullif(current_setting('app.finance_permission', true), '');
  context_reason := nullif(current_setting('app.finance_reason', true), '');
  finance_action := nullif(current_setting('app.finance_action', true), '');

  IF context_actor_id IS NULL OR context_actor_id <> NEW.actor_id
     OR context_session_id IS NULL OR context_request_id IS NULL
     OR context_ip_address IS NULL OR context_permission IS NULL OR context_reason IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4092',
      MESSAGE = 'complete authorized finance request context is required';
  END IF;
  IF finance_action NOT IN (base_action, 'support.' || base_action) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4092',
      MESSAGE = 'finance audit action does not match the posted operation';
  END IF;
  IF (finance_action LIKE 'support.%') <> (context_support_grant_id IS NOT NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4092',
      MESSAGE = 'support finance action and grant context must agree';
  END IF;

  INSERT INTO finance_audit_outbox (
    tenant_id, source_table, source_entry_id, action, resource_type, actor_id,
    session_id, support_grant_id, request_id, ip_address, user_agent, permission,
    reason, idempotency_key, amount_minor, currency, metadata, occurred_at,
    client_posted_at
  ) VALUES (
    NEW.tenant_id,
    TG_TABLE_NAME,
    NEW.id,
    finance_action,
    finance_resource_type,
    context_actor_id,
    context_session_id,
    context_support_grant_id,
    context_request_id,
    context_ip_address,
    context_user_agent,
    context_permission,
    context_reason,
    NEW.idempotency_key,
    NEW.amount_minor,
    NEW.currency,
    jsonb_strip_nulls(jsonb_build_object(
      'entryKind', NEW.entry_kind,
      'reversesId', reversal_id,
      'clientPostedAt', NEW.posted_at
    )),
    clock_timestamp(),
    NEW.posted_at
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION protect_finance_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance audit outbox records cannot be removed';
  END IF;
  IF ROW(
    NEW.event_id, NEW.tenant_id, NEW.source_table, NEW.source_entry_id, NEW.action,
    NEW.resource_type, NEW.actor_id, NEW.session_id, NEW.support_grant_id,
    NEW.request_id, NEW.ip_address, NEW.user_agent, NEW.permission, NEW.reason,
    NEW.idempotency_key, NEW.amount_minor, NEW.currency, NEW.metadata,
    NEW.occurred_at, NEW.client_posted_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.event_id, OLD.tenant_id, OLD.source_table, OLD.source_entry_id, OLD.action,
    OLD.resource_type, OLD.actor_id, OLD.session_id, OLD.support_grant_id,
    OLD.request_id, OLD.ip_address, OLD.user_agent, OLD.permission, OLD.reason,
    OLD.idempotency_key, OLD.amount_minor, OLD.currency, OLD.metadata,
    OLD.occurred_at, OLD.client_posted_at, OLD.created_at
  ) OR NEW.delivered_at IS NULL OR OLD.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'finance audit outbox evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_audit_outbox_protect_update_or_delete
BEFORE UPDATE OR DELETE ON finance_audit_outbox
FOR EACH ROW EXECUTE FUNCTION protect_finance_audit_outbox();

CREATE FUNCTION list_finance_audit_relay_tenants() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT tenant_id
  FROM finance_audit_outbox
  WHERE delivered_at IS NULL
  ORDER BY tenant_id
$$;

CREATE POLICY finance_audit_outbox_owner_discovery ON finance_audit_outbox
  FOR SELECT TO orvex_finance_audit_relay_owner
  USING (true);

REVOKE ALL ON TABLE finance_audit_outbox FROM orvex_runtime;
REVOKE ALL ON FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz)
  FROM orvex_runtime;
REVOKE ALL ON FUNCTION list_finance_audit_relay_tenants() FROM PUBLIC, orvex_runtime;

GRANT USAGE ON SCHEMA public TO orvex_finance_audit_relay;
GRANT SELECT ON TABLE finance_audit_outbox TO orvex_finance_audit_relay;
GRANT SELECT, INSERT ON TABLE audit_events TO orvex_finance_audit_relay;
GRANT EXECUTE ON FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz)
  TO orvex_finance_audit_relay;
GRANT EXECUTE ON FUNCTION list_finance_audit_relay_tenants()
  TO orvex_finance_audit_relay;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  finance_invoices,
  finance_payments,
  finance_payment_allocations,
  finance_audit_outbox
FROM orvex_finance_audit_relay;

-- Transfer ownership only after all application/relay ACLs are final. With PostgreSQL 18's
-- INHERIT FALSE membership, the migration owner may SET ROLE for transfer but does not retain
-- the outbox owner's privileges during ordinary work.
GRANT CREATE ON SCHEMA public TO orvex_finance_audit_relay_owner;
GRANT USAGE ON SCHEMA public TO orvex_finance_audit_relay_owner;
ALTER TABLE finance_audit_outbox OWNER TO orvex_finance_audit_relay_owner;
ALTER FUNCTION append_finance_audit_outbox() OWNER TO orvex_finance_audit_relay_owner;
ALTER FUNCTION protect_finance_audit_outbox() OWNER TO orvex_finance_audit_relay_owner;
ALTER FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz)
  OWNER TO orvex_finance_audit_relay_owner;
ALTER FUNCTION list_finance_audit_relay_tenants()
  OWNER TO orvex_finance_audit_relay_owner;
REVOKE CREATE ON SCHEMA public FROM orvex_finance_audit_relay_owner;
