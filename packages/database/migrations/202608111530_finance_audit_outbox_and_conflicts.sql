-- REQ-FIN-002, REQ-SEC-006: atomically preserve finance audit evidence on the tenant plane.
CREATE TABLE finance_audit_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_table text NOT NULL CHECK (
    source_table IN ('finance_invoices', 'finance_payments', 'finance_payment_allocations')
  ),
  source_entry_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency finance_currency NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT finance_audit_outbox_source_key UNIQUE (source_table, source_entry_id)
);
CREATE INDEX finance_audit_outbox_tenant_pending_idx
  ON finance_audit_outbox (tenant_id, created_at, event_id)
  WHERE delivered_at IS NULL;

ALTER TABLE finance_audit_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_audit_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_audit_outbox_isolation ON finance_audit_outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION append_finance_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  finance_action text;
  finance_resource_type text;
  reversal_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'finance_invoices' THEN
    finance_action := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'tenant.invoice.post'
      ELSE 'tenant.invoice.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'invoice'
      ELSE 'invoice_reversal'
    END;
    reversal_id := NEW.reverses_invoice_id;
  ELSIF TG_TABLE_NAME = 'finance_payments' THEN
    finance_action := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'tenant.payment.post'
      ELSE 'tenant.payment.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'posted' THEN 'payment'
      ELSE 'payment_reversal'
    END;
    reversal_id := NEW.reverses_payment_id;
  ELSE
    finance_action := CASE
      WHEN NEW.entry_kind = 'allocation' THEN 'tenant.payment.allocate'
      ELSE 'tenant.payment.allocation.reverse'
    END;
    finance_resource_type := CASE
      WHEN NEW.entry_kind = 'allocation' THEN 'payment_allocation'
      ELSE 'payment_allocation_reversal'
    END;
    reversal_id := NEW.reverses_allocation_id;
  END IF;

  INSERT INTO finance_audit_outbox (
    tenant_id, source_table, source_entry_id, action, resource_type, actor_id,
    idempotency_key, amount_minor, currency, metadata, occurred_at
  ) VALUES (
    NEW.tenant_id,
    TG_TABLE_NAME,
    NEW.id,
    finance_action,
    finance_resource_type,
    NEW.actor_id,
    NEW.idempotency_key,
    NEW.amount_minor,
    NEW.currency,
    jsonb_strip_nulls(jsonb_build_object(
      'entryKind', NEW.entry_kind,
      'reversesId', reversal_id
    )),
    NEW.posted_at
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION protect_finance_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance audit outbox records cannot be removed';
  END IF;
  IF ROW(
    NEW.event_id, NEW.tenant_id, NEW.source_table, NEW.source_entry_id, NEW.action,
    NEW.resource_type, NEW.actor_id, NEW.idempotency_key, NEW.amount_minor,
    NEW.currency, NEW.metadata, NEW.occurred_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.event_id, OLD.tenant_id, OLD.source_table, OLD.source_entry_id, OLD.action,
    OLD.resource_type, OLD.actor_id, OLD.idempotency_key, OLD.amount_minor,
    OLD.currency, OLD.metadata, OLD.occurred_at, OLD.created_at
  ) OR NEW.delivered_at IS NULL OR OLD.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'finance audit outbox evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION mark_finance_audit_outbox_delivered(target_event_id uuid, delivered_time timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  updated_count integer;
BEGIN
  IF delivered_time IS NULL THEN
    RAISE EXCEPTION 'a delivery timestamp is required';
  END IF;
  UPDATE finance_audit_outbox
    SET delivered_at = delivered_time
    WHERE event_id = target_event_id
      AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      AND delivered_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE TRIGGER finance_invoices_audit_outbox
AFTER INSERT ON finance_invoices
FOR EACH ROW EXECUTE FUNCTION append_finance_audit_outbox();
CREATE TRIGGER finance_payments_audit_outbox
AFTER INSERT ON finance_payments
FOR EACH ROW EXECUTE FUNCTION append_finance_audit_outbox();
CREATE TRIGGER finance_allocations_audit_outbox
AFTER INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION append_finance_audit_outbox();
CREATE TRIGGER finance_audit_outbox_protect_update_or_delete
BEFORE UPDATE OR DELETE ON finance_audit_outbox
FOR EACH ROW EXECUTE FUNCTION protect_finance_audit_outbox();
CREATE TRIGGER finance_audit_outbox_protect_truncate
BEFORE TRUNCATE ON finance_audit_outbox
FOR EACH STATEMENT EXECUTE FUNCTION protect_finance_audit_outbox();

GRANT SELECT ON TABLE finance_audit_outbox TO orvex_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE finance_audit_outbox FROM orvex_runtime;
GRANT EXECUTE ON FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz)
  TO orvex_runtime;
REVOKE ALL ON FUNCTION append_finance_audit_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_finance_audit_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_finance_audit_outbox_delivered(uuid, timestamptz)
  TO orvex_runtime;

-- Assign stable SQLSTATEs without changing the already-applied journal migration. The replacement
-- is deliberately limited to exact, reviewed messages in the three existing validation functions.
DO $$
DECLARE
  function_name text;
  definition text;
  idempotency_message text;
  business_message text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'validate_finance_invoice_entry()',
    'validate_finance_payment_entry()',
    'validate_finance_allocation_entry()'
  ] LOOP
    SELECT pg_get_functiondef(function_name::regprocedure) INTO definition;

    FOREACH idempotency_message IN ARRAY ARRAY[
      'idempotency key belongs to a different invoice operation',
      'idempotency key belongs to a different payment operation',
      'idempotency key belongs to a different allocation operation'
    ] LOOP
      definition := replace(
        definition,
        format('RAISE EXCEPTION %L;', idempotency_message),
        format(
          'RAISE EXCEPTION USING ERRCODE = ''P4090'', MESSAGE = %L;',
          idempotency_message
        )
      );
    END LOOP;

    FOREACH business_message IN ARRAY ARRAY[
      'invoice is already reversed or missing its finance guard',
      'invoice reversal must reference a posted invoice',
      'invoice reversal must preserve amount and currency',
      'invoice allocations must be reversed before the invoice',
      'payment is already reversed or missing its finance guard',
      'payment reversal must reference a posted payment',
      'payment reversal must preserve amount and currency',
      'payment allocations must be reversed before the payment',
      'allocation requires an active posted invoice',
      'allocation requires an active posted payment',
      'allocation currency must match both posted documents',
      'allocation reversal must reference an allocation',
      'allocation reversal must preserve documents, amount, and currency',
      'allocation exceeds the invoice balance',
      'allocation exceeds the payment balance'
    ] LOOP
      definition := replace(
        definition,
        format('RAISE EXCEPTION %L;', business_message),
        format(
          'RAISE EXCEPTION USING ERRCODE = ''P4091'', MESSAGE = %L;',
          business_message
        )
      );
    END LOOP;

    EXECUTE definition;
  END LOOP;
END;
$$;
