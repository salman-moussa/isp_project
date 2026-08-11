-- REQ-FIN-001, REQ-FIN-002, REQ-SEC-003: immutable, tenant-isolated finance journal.
CREATE TYPE finance_currency AS ENUM ('USD', 'LBP');
CREATE TYPE finance_document_kind AS ENUM ('posted', 'reversal');
CREATE TYPE finance_allocation_kind AS ENUM ('allocation', 'reversal');

CREATE TABLE finance_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_number text NOT NULL,
  entry_kind finance_document_kind NOT NULL DEFAULT 'posted',
  reverses_invoice_id uuid,
  amount_minor bigint NOT NULL,
  currency finance_currency NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_invoices_amount_positive_check CHECK (amount_minor > 0),
  CONSTRAINT finance_invoices_document_number_check CHECK (length(btrim(document_number)) > 0),
  CONSTRAINT finance_invoices_idempotency_key_check CHECK (length(btrim(idempotency_key)) >= 8),
  CONSTRAINT finance_invoices_reversal_shape_check CHECK (
    (entry_kind = 'posted' AND reverses_invoice_id IS NULL)
    OR (entry_kind = 'reversal' AND reverses_invoice_id IS NOT NULL)
  ),
  CONSTRAINT finance_invoices_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_invoices_tenant_document_number_key UNIQUE (tenant_id, document_number),
  CONSTRAINT finance_invoices_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT finance_invoices_reverses_invoice_id_key UNIQUE (reverses_invoice_id),
  CONSTRAINT finance_invoices_tenant_reversal_fk FOREIGN KEY (tenant_id, reverses_invoice_id)
    REFERENCES finance_invoices (tenant_id, id)
);
CREATE INDEX finance_invoices_tenant_posted_at_idx
  ON finance_invoices (tenant_id, posted_at DESC);

CREATE TABLE finance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  receipt_number text NOT NULL,
  entry_kind finance_document_kind NOT NULL DEFAULT 'posted',
  reverses_payment_id uuid,
  amount_minor bigint NOT NULL,
  currency finance_currency NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payments_amount_positive_check CHECK (amount_minor > 0),
  CONSTRAINT finance_payments_receipt_number_check CHECK (length(btrim(receipt_number)) > 0),
  CONSTRAINT finance_payments_idempotency_key_check CHECK (length(btrim(idempotency_key)) >= 8),
  CONSTRAINT finance_payments_reversal_shape_check CHECK (
    (entry_kind = 'posted' AND reverses_payment_id IS NULL)
    OR (entry_kind = 'reversal' AND reverses_payment_id IS NOT NULL)
  ),
  CONSTRAINT finance_payments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_payments_tenant_receipt_number_key UNIQUE (tenant_id, receipt_number),
  CONSTRAINT finance_payments_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT finance_payments_reverses_payment_id_key UNIQUE (reverses_payment_id),
  CONSTRAINT finance_payments_tenant_reversal_fk FOREIGN KEY (tenant_id, reverses_payment_id)
    REFERENCES finance_payments (tenant_id, id)
);
CREATE INDEX finance_payments_tenant_posted_at_idx
  ON finance_payments (tenant_id, posted_at DESC);

CREATE TABLE finance_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  entry_kind finance_allocation_kind NOT NULL DEFAULT 'allocation',
  reverses_allocation_id uuid,
  amount_minor bigint NOT NULL,
  currency finance_currency NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_allocations_amount_positive_check CHECK (amount_minor > 0),
  CONSTRAINT finance_allocations_idempotency_key_check CHECK (length(btrim(idempotency_key)) >= 8),
  CONSTRAINT finance_allocations_reversal_shape_check CHECK (
    (entry_kind = 'allocation' AND reverses_allocation_id IS NULL)
    OR (entry_kind = 'reversal' AND reverses_allocation_id IS NOT NULL)
  ),
  CONSTRAINT finance_allocations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT finance_allocations_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT finance_allocations_reverses_allocation_id_key UNIQUE (reverses_allocation_id),
  CONSTRAINT finance_allocations_tenant_payment_fk FOREIGN KEY (tenant_id, payment_id)
    REFERENCES finance_payments (tenant_id, id),
  CONSTRAINT finance_allocations_tenant_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES finance_invoices (tenant_id, id),
  CONSTRAINT finance_allocations_tenant_reversal_fk FOREIGN KEY (tenant_id, reverses_allocation_id)
    REFERENCES finance_payment_allocations (tenant_id, id)
);
CREATE INDEX finance_allocations_tenant_invoice_idx
  ON finance_payment_allocations (tenant_id, invoice_id, posted_at);
CREATE INDEX finance_allocations_tenant_payment_idx
  ON finance_payment_allocations (tenant_id, payment_id, posted_at);

-- Mutable coordination state is kept separate from the immutable journal. Runtime callers have
-- no direct privileges; fixed-search-path trigger functions alone maintain these guard rows.
CREATE TABLE finance_document_guards (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_type text NOT NULL CHECK (document_type IN ('invoice', 'payment')),
  document_id uuid NOT NULL,
  allocated_minor bigint NOT NULL DEFAULT 0 CHECK (allocated_minor >= 0),
  reversed_at timestamptz,
  PRIMARY KEY (tenant_id, document_type, document_id)
);

ALTER TABLE finance_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_invoices_isolation ON finance_invoices
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE finance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_payments_isolation ON finance_payments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE finance_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_payment_allocations_isolation ON finance_payment_allocations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE finance_document_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_document_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_document_guards_isolation ON finance_document_guards
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION reject_posted_finance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'posted finance records are append-only';
END;
$$;

CREATE FUNCTION validate_finance_invoice_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  original finance_invoices%ROWTYPE;
  existing finance_invoices%ROWTYPE;
  guard_reversed_at timestamptz;
  guard_allocated_minor bigint;
  guard_found boolean;
BEGIN
  SELECT * INTO existing
    FROM finance_invoices
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing.entry_kind = NEW.entry_kind
       AND existing.document_number = NEW.document_number
       AND existing.reverses_invoice_id IS NOT DISTINCT FROM NEW.reverses_invoice_id
       AND existing.amount_minor = NEW.amount_minor
       AND existing.currency = NEW.currency
       AND existing.actor_id = NEW.actor_id
       AND existing.posted_at = NEW.posted_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'idempotency key belongs to a different invoice operation';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT reversed_at, allocated_minor INTO guard_reversed_at, guard_allocated_minor
      FROM finance_document_guards
      WHERE tenant_id = NEW.tenant_id
        AND document_type = 'invoice'
        AND document_id = NEW.reverses_invoice_id
      FOR UPDATE;
    guard_found := FOUND;
    SELECT * INTO existing
      FROM finance_invoices
      WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
    IF FOUND THEN
      IF existing.entry_kind = NEW.entry_kind
         AND existing.document_number = NEW.document_number
         AND existing.reverses_invoice_id IS NOT DISTINCT FROM NEW.reverses_invoice_id
         AND existing.amount_minor = NEW.amount_minor
         AND existing.currency = NEW.currency
         AND existing.actor_id = NEW.actor_id
         AND existing.posted_at = NEW.posted_at THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'idempotency key belongs to a different invoice operation';
    END IF;
    IF NOT guard_found OR guard_reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoice is already reversed or missing its finance guard';
    END IF;
    SELECT * INTO original
      FROM finance_invoices
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_invoice_id
      FOR UPDATE;
    IF NOT FOUND OR original.entry_kind <> 'posted' THEN
      RAISE EXCEPTION 'invoice reversal must reference a posted invoice';
    END IF;
    IF original.amount_minor <> NEW.amount_minor OR original.currency <> NEW.currency THEN
      RAISE EXCEPTION 'invoice reversal must preserve amount and currency';
    END IF;
    IF guard_allocated_minor <> 0 THEN
      RAISE EXCEPTION 'invoice allocations must be reversed before the invoice';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_finance_payment_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  original finance_payments%ROWTYPE;
  existing finance_payments%ROWTYPE;
  guard_reversed_at timestamptz;
  guard_allocated_minor bigint;
  guard_found boolean;
BEGIN
  SELECT * INTO existing
    FROM finance_payments
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing.entry_kind = NEW.entry_kind
       AND existing.receipt_number = NEW.receipt_number
       AND existing.reverses_payment_id IS NOT DISTINCT FROM NEW.reverses_payment_id
       AND existing.amount_minor = NEW.amount_minor
       AND existing.currency = NEW.currency
       AND existing.actor_id = NEW.actor_id
       AND existing.posted_at = NEW.posted_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'idempotency key belongs to a different payment operation';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT reversed_at, allocated_minor INTO guard_reversed_at, guard_allocated_minor
      FROM finance_document_guards
      WHERE tenant_id = NEW.tenant_id
        AND document_type = 'payment'
        AND document_id = NEW.reverses_payment_id
      FOR UPDATE;
    guard_found := FOUND;
    SELECT * INTO existing
      FROM finance_payments
      WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
    IF FOUND THEN
      IF existing.entry_kind = NEW.entry_kind
         AND existing.receipt_number = NEW.receipt_number
         AND existing.reverses_payment_id IS NOT DISTINCT FROM NEW.reverses_payment_id
         AND existing.amount_minor = NEW.amount_minor
         AND existing.currency = NEW.currency
         AND existing.actor_id = NEW.actor_id
         AND existing.posted_at = NEW.posted_at THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'idempotency key belongs to a different payment operation';
    END IF;
    IF NOT guard_found OR guard_reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'payment is already reversed or missing its finance guard';
    END IF;
    SELECT * INTO original
      FROM finance_payments
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_payment_id
      FOR UPDATE;
    IF NOT FOUND OR original.entry_kind <> 'posted' THEN
      RAISE EXCEPTION 'payment reversal must reference a posted payment';
    END IF;
    IF original.amount_minor <> NEW.amount_minor OR original.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment reversal must preserve amount and currency';
    END IF;
    IF guard_allocated_minor <> 0 THEN
      RAISE EXCEPTION 'payment allocations must be reversed before the payment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_finance_allocation_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  invoice finance_invoices%ROWTYPE;
  payment finance_payments%ROWTYPE;
  original finance_payment_allocations%ROWTYPE;
  existing finance_payment_allocations%ROWTYPE;
  invoice_reversed_at timestamptz;
  payment_reversed_at timestamptz;
  payment_guard_found boolean;
  invoice_allocated_minor bigint;
  payment_allocated_minor bigint;
BEGIN
  SELECT * INTO existing
    FROM finance_payment_allocations
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing.entry_kind = NEW.entry_kind
       AND existing.payment_id = NEW.payment_id
       AND existing.invoice_id = NEW.invoice_id
       AND existing.reverses_allocation_id IS NOT DISTINCT FROM NEW.reverses_allocation_id
       AND existing.amount_minor = NEW.amount_minor
       AND existing.currency = NEW.currency
       AND existing.actor_id = NEW.actor_id
       AND existing.posted_at = NEW.posted_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'idempotency key belongs to a different allocation operation';
  END IF;

  -- Every writer locks invoice guard then payment guard, providing a stable lock order. A locked
  -- guard returns its latest tuple even when this statement began before a reversal committed.
  SELECT reversed_at, allocated_minor INTO invoice_reversed_at, invoice_allocated_minor
    FROM finance_document_guards
    WHERE tenant_id = NEW.tenant_id
      AND document_type = 'invoice'
      AND document_id = NEW.invoice_id
    FOR UPDATE;
  IF NOT FOUND OR invoice_reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'allocation requires an active posted invoice';
  END IF;
  SELECT reversed_at, allocated_minor INTO payment_reversed_at, payment_allocated_minor
    FROM finance_document_guards
    WHERE tenant_id = NEW.tenant_id
      AND document_type = 'payment'
      AND document_id = NEW.payment_id
    FOR UPDATE;
  payment_guard_found := FOUND;
  SELECT * INTO existing
    FROM finance_payment_allocations
    WHERE tenant_id = NEW.tenant_id AND idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing.entry_kind = NEW.entry_kind
       AND existing.payment_id = NEW.payment_id
       AND existing.invoice_id = NEW.invoice_id
       AND existing.reverses_allocation_id IS NOT DISTINCT FROM NEW.reverses_allocation_id
       AND existing.amount_minor = NEW.amount_minor
       AND existing.currency = NEW.currency
       AND existing.actor_id = NEW.actor_id
       AND existing.posted_at = NEW.posted_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'idempotency key belongs to a different allocation operation';
  END IF;
  IF NOT payment_guard_found OR payment_reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'allocation requires an active posted payment';
  END IF;

  SELECT * INTO invoice
    FROM finance_invoices
    WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id
    FOR UPDATE;
  SELECT * INTO payment
    FROM finance_payments
    WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id
    FOR UPDATE;

  IF invoice.id IS NULL OR invoice.entry_kind <> 'posted' THEN
    RAISE EXCEPTION 'allocation requires an active posted invoice';
  END IF;
  IF payment.id IS NULL OR payment.entry_kind <> 'posted' THEN
    RAISE EXCEPTION 'allocation requires an active posted payment';
  END IF;
  IF invoice.currency <> payment.currency OR NEW.currency <> invoice.currency THEN
    RAISE EXCEPTION 'allocation currency must match both posted documents';
  END IF;

  IF NEW.entry_kind = 'reversal' THEN
    SELECT * INTO original
      FROM finance_payment_allocations
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_allocation_id
      FOR UPDATE;
    IF NOT FOUND OR original.entry_kind <> 'allocation' THEN
      RAISE EXCEPTION 'allocation reversal must reference an allocation';
    END IF;
    IF original.payment_id <> NEW.payment_id OR original.invoice_id <> NEW.invoice_id
       OR original.amount_minor <> NEW.amount_minor OR original.currency <> NEW.currency THEN
      RAISE EXCEPTION 'allocation reversal must preserve documents, amount, and currency';
    END IF;
    RETURN NEW;
  END IF;

  IF invoice_allocated_minor + NEW.amount_minor > invoice.amount_minor THEN
    RAISE EXCEPTION 'allocation exceeds the invoice balance';
  END IF;
  IF payment_allocated_minor + NEW.amount_minor > payment.amount_minor THEN
    RAISE EXCEPTION 'allocation exceeds the payment balance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION maintain_finance_allocation_guards() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  delta bigint;
BEGIN
  delta := CASE WHEN NEW.entry_kind = 'allocation' THEN NEW.amount_minor ELSE -NEW.amount_minor END;
  UPDATE finance_document_guards
    SET allocated_minor = allocated_minor + delta
    WHERE tenant_id = NEW.tenant_id
      AND document_type = 'invoice'
      AND document_id = NEW.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice finance guard is missing';
  END IF;
  UPDATE finance_document_guards
    SET allocated_minor = allocated_minor + delta
    WHERE tenant_id = NEW.tenant_id
      AND document_type = 'payment'
      AND document_id = NEW.payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment finance guard is missing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION maintain_finance_document_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.entry_kind = 'posted' THEN
    INSERT INTO finance_document_guards (tenant_id, document_type, document_id)
      VALUES (NEW.tenant_id, TG_ARGV[0], NEW.id);
  ELSE
    UPDATE finance_document_guards
      SET reversed_at = NEW.posted_at
      WHERE tenant_id = NEW.tenant_id
        AND document_type = TG_ARGV[0]
        AND document_id = (
          to_jsonb(NEW) ->> CASE
            WHEN TG_ARGV[0] = 'invoice' THEN 'reverses_invoice_id'
            ELSE 'reverses_payment_id'
          END
        )::uuid
        AND reversed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'finance document guard could not record reversal';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER finance_invoices_validate_insert
BEFORE INSERT ON finance_invoices
FOR EACH ROW EXECUTE FUNCTION validate_finance_invoice_entry();
CREATE TRIGGER finance_payments_validate_insert
BEFORE INSERT ON finance_payments
FOR EACH ROW EXECUTE FUNCTION validate_finance_payment_entry();
CREATE TRIGGER finance_invoices_maintain_guard
AFTER INSERT ON finance_invoices
FOR EACH ROW EXECUTE FUNCTION maintain_finance_document_guard('invoice');
CREATE TRIGGER finance_payments_maintain_guard
AFTER INSERT ON finance_payments
FOR EACH ROW EXECUTE FUNCTION maintain_finance_document_guard('payment');
CREATE TRIGGER finance_allocations_validate_insert
BEFORE INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION validate_finance_allocation_entry();
CREATE TRIGGER finance_allocations_maintain_guards
AFTER INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION maintain_finance_allocation_guards();

CREATE TRIGGER finance_invoices_no_update_or_delete
BEFORE UPDATE OR DELETE ON finance_invoices
FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_mutation();
CREATE TRIGGER finance_invoices_no_truncate
BEFORE TRUNCATE ON finance_invoices
FOR EACH STATEMENT EXECUTE FUNCTION reject_posted_finance_mutation();
CREATE TRIGGER finance_payments_no_update_or_delete
BEFORE UPDATE OR DELETE ON finance_payments
FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_mutation();
CREATE TRIGGER finance_payments_no_truncate
BEFORE TRUNCATE ON finance_payments
FOR EACH STATEMENT EXECUTE FUNCTION reject_posted_finance_mutation();
CREATE TRIGGER finance_allocations_no_update_or_delete
BEFORE UPDATE OR DELETE ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_mutation();
CREATE TRIGGER finance_allocations_no_truncate
BEFORE TRUNCATE ON finance_payment_allocations
FOR EACH STATEMENT EXECUTE FUNCTION reject_posted_finance_mutation();

GRANT SELECT, INSERT ON TABLE
  finance_invoices,
  finance_payments,
  finance_payment_allocations
TO orvex_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  finance_invoices,
  finance_payments,
  finance_payment_allocations
FROM orvex_runtime;

REVOKE ALL ON FUNCTION reject_posted_finance_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_finance_invoice_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_finance_payment_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_finance_allocation_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION maintain_finance_document_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maintain_finance_allocation_guards() FROM PUBLIC;
