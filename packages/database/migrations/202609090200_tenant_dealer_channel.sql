-- 202609090200_tenant_dealer_channel.sql
-- Dealer and voucher channel: governed dealer registry, a per-dealer per-currency prepaid float
-- ledger (deposits, batch issues net of commission, cancellations, approved adjustments), PIN
-- voucher batches generated in the database with salted hashes, guarded redemption with attempt
-- lockout, and a redemption record that tracks the subscriber account credit until it is posted.
--
-- Money stays integer minor units in one currency per entry; USD and LBP balances never combine.

ALTER TABLE operations_dealers
  ADD COLUMN dealer_type text NOT NULL DEFAULT 'dealer' CHECK (dealer_type IN ('dealer', 'reseller', 'pos')),
  ADD COLUMN contact_name text,
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD COLUMN branch_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  ADD COLUMN notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT dealer_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT dealer_branch_tenant FOREIGN KEY (tenant_id, branch_id) REFERENCES operations_branches(tenant_id, id),
  ADD CONSTRAINT dealer_active_matches_status CHECK (active = (status = 'active')),
  ADD CONSTRAINT dealer_code_shape CHECK (dealer_code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$');

ALTER TABLE operations_voucher_batches
  ADD COLUMN status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'issued', 'cancelled')),
  ADD COLUMN pin_salt text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT voucher_batch_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT voucher_batch_dealer_tenant FOREIGN KEY (tenant_id, dealer_id) REFERENCES operations_dealers(tenant_id, id),
  ADD CONSTRAINT voucher_batch_number_shape CHECK (batch_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  -- A cancelled batch keeps the issue time it had; only an issued batch must carry one.
  ADD CONSTRAINT voucher_batch_issue_consistency CHECK (status <> 'issued' OR issued_at IS NOT NULL),
  ADD CONSTRAINT voucher_batch_cancel_consistency CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

ALTER TABLE operations_vouchers
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN pin_attempts integer NOT NULL DEFAULT 0 CHECK (pin_attempts >= 0),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN redemption_id uuid,
  ADD CONSTRAINT voucher_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT voucher_batch_tenant FOREIGN KEY (tenant_id, batch_id) REFERENCES operations_voucher_batches(tenant_id, id),
  ADD CONSTRAINT voucher_redeemed_consistency CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL));
CREATE INDEX voucher_batch_status_idx ON operations_vouchers(tenant_id, batch_id, status);

CREATE TABLE operations_dealer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  dealer_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('deposit', 'batch_issue', 'commission', 'batch_cancel', 'adjustment')),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor bigint NOT NULL,
  batch_id uuid,
  reference text CHECK (reference IS NULL OR length(btrim(reference)) BETWEEN 3 AND 200),
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, dealer_id) REFERENCES operations_dealers(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES operations_voucher_batches(tenant_id, id)
);
CREATE INDEX dealer_ledger_idx ON operations_dealer_ledger(tenant_id, dealer_id, currency, created_at DESC, id);

CREATE TABLE operations_voucher_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  voucher_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  subscriber_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  status text NOT NULL DEFAULT 'credit_pending' CHECK (status IN ('credit_pending', 'credited')),
  account_entry_id uuid,
  redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  credited_at timestamptz,
  actor_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, voucher_id),
  FOREIGN KEY (tenant_id, voucher_id) REFERENCES operations_vouchers(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES operations_voucher_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, subscriber_id) REFERENCES operations_subscribers(tenant_id, id),
  CHECK ((status = 'credited') = (account_entry_id IS NOT NULL)),
  CHECK ((status = 'credited') = (credited_at IS NOT NULL))
);
CREATE INDEX voucher_redemption_pending_idx ON operations_voucher_redemptions(tenant_id, status, redeemed_at DESC)
  WHERE status = 'credit_pending';
ALTER TABLE operations_vouchers
  ADD CONSTRAINT voucher_redemption_tenant FOREIGN KEY (tenant_id, redemption_id)
  REFERENCES operations_voucher_redemptions(tenant_id, id);

CREATE TABLE operations_dealer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload)),
  CHECK (NOT operations_json_contains_secret_key(result)),
  -- A PIN never lands in the ledger: the generation result is stored without the PIN list and
  -- redemption requests are stored with the PIN removed before insert.
  CHECK (NOT (request_payload ? 'pin') AND NOT (result ? 'pins'))
);

-- Scope: dealers with a branch follow the branch scope; unassigned dealers are tenant-wide.
CREATE FUNCTION dealer_scope_allows(target_tenant uuid, target_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM operations_current_context() c
    WHERE c.tenant_id = target_tenant AND c.support_grant_id IS NULL
      AND (target_branch IS NULL OR operations_scope_allows(target_tenant, target_branch)))
$$;
REVOKE ALL ON FUNCTION dealer_scope_allows(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dealer_scope_allows(uuid, uuid) TO orvex_runtime;

DROP POLICY tenant_isolation_dealers ON operations_dealers;
CREATE POLICY dealer_scope ON operations_dealers
  USING (dealer_scope_allows(tenant_id, branch_id)) WITH CHECK (dealer_scope_allows(tenant_id, branch_id));
DROP POLICY tenant_isolation_voucher_batches ON operations_voucher_batches;
CREATE POLICY voucher_batch_scope ON operations_voucher_batches
  USING (tenant_id = (operations_current_context()).tenant_id
    AND (dealer_id IS NULL OR EXISTS (SELECT 1 FROM operations_dealers d WHERE d.tenant_id = operations_voucher_batches.tenant_id AND d.id = dealer_id)))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
DROP POLICY tenant_isolation_vouchers ON operations_vouchers;
CREATE POLICY voucher_scope ON operations_vouchers
  USING (EXISTS (SELECT 1 FROM operations_voucher_batches b WHERE b.tenant_id = operations_vouchers.tenant_id AND b.id = batch_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_dealer_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dealer_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY dealer_ledger_scope ON operations_dealer_ledger
  USING (EXISTS (SELECT 1 FROM operations_dealers d WHERE d.tenant_id = operations_dealer_ledger.tenant_id AND d.id = dealer_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_voucher_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY voucher_redemption_scope ON operations_voucher_redemptions
  USING (tenant_id = (operations_current_context()).tenant_id AND operations_scope_allows_subscriber(tenant_id, subscriber_id))
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);
ALTER TABLE operations_dealer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dealer_events FORCE ROW LEVEL SECURITY;
CREATE POLICY dealer_events_tenant ON operations_dealer_events
  USING (tenant_id = (operations_current_context()).tenant_id)
  WITH CHECK (tenant_id = (operations_current_context()).tenant_id);

REVOKE ALL ON operations_dealers, operations_voucher_batches, operations_vouchers, operations_dealer_ledger,
  operations_voucher_redemptions, operations_dealer_events FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_dealers, operations_dealer_ledger, operations_voucher_redemptions, operations_dealer_events
  TO orvex_runtime;
-- The runtime never reads PIN material: the voucher and batch grants are column lists that leave
-- out the salted hash and the salt (only the SECURITY DEFINER command function sees them).
GRANT SELECT (id, tenant_id, batch_id, serial_number, status, redeemed_by_subscriber_id, redeemed_at, created_at,
  issued_at, cancelled_at, pin_attempts, locked_at, redemption_id) ON operations_vouchers TO orvex_runtime;
GRANT SELECT (id, tenant_id, batch_number, dealer_id, face_value_minor, currency, quantity, generated_at, status,
  issued_at, cancelled_at, expires_at, created_by, version, updated_at) ON operations_voucher_batches TO orvex_runtime;

CREATE TRIGGER dealer_ledger_immutable BEFORE UPDATE OR DELETE ON operations_dealer_ledger
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER dealer_ledger_no_truncate BEFORE TRUNCATE ON operations_dealer_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER dealer_events_immutable BEFORE UPDATE OR DELETE ON operations_dealer_events
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER dealer_events_no_truncate BEFORE TRUNCATE ON operations_dealer_events
  FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER voucher_no_delete BEFORE DELETE ON operations_vouchers
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER voucher_batch_no_delete BEFORE DELETE ON operations_voucher_batches
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER voucher_redemption_no_delete BEFORE DELETE ON operations_voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER dealer_no_delete BEFORE DELETE ON operations_dealers
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- Dealer float balance for one currency (sum of the append-only ledger).
CREATE FUNCTION dealer_balance_minor(p_tenant uuid, p_dealer uuid, p_currency text) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(amount_minor), 0)::bigint FROM operations_dealer_ledger
  WHERE tenant_id = p_tenant AND dealer_id = p_dealer AND currency = p_currency
$$;
GRANT EXECUTE ON FUNCTION dealer_balance_minor(uuid, uuid, text) TO orvex_runtime;

CREATE FUNCTION dealer_post_ledger(p_tenant uuid, p_dealer uuid, p_kind text, p_currency text, p_amount bigint,
  p_batch uuid, p_reference text, p_reason_en text, p_reason_ar text, p_actor uuid) RETURNS operations_dealer_ledger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE entry operations_dealer_ledger%ROWTYPE; current_balance bigint;
BEGIN
  PERFORM 1 FROM operations_dealers WHERE tenant_id = p_tenant AND id = p_dealer FOR UPDATE;
  current_balance := dealer_balance_minor(p_tenant, p_dealer, p_currency);
  INSERT INTO operations_dealer_ledger(tenant_id, dealer_id, entry_kind, currency, amount_minor, balance_after_minor,
    batch_id, reference, reason_en, reason_ar, actor_id)
  VALUES (p_tenant, p_dealer, p_kind, p_currency, p_amount, current_balance + p_amount, p_batch, p_reference,
    p_reason_en, p_reason_ar, p_actor)
  RETURNING * INTO entry;
  RETURN entry;
END $$;

-- Twelve-digit PIN from cryptographic randomness.
CREATE FUNCTION voucher_random_pin() RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT lpad((abs(('x' || encode(gen_random_bytes(8), 'hex'))::bit(64)::bigint) % 1000000000000)::text, 12, '0')
$$;

CREATE FUNCTION execute_dealer_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_variable
DECLARE
  c operations_request_contexts%ROWTYPE;
  prior operations_dealer_events%ROWTYPE;
  dealer operations_dealers%ROWTYPE;
  batch operations_voucher_batches%ROWTYPE;
  voucher operations_vouchers%ROWTYPE;
  redemption operations_voucher_redemptions%ROWTYPE;
  ledger_entry operations_dealer_ledger%ROWTYPE;
  v_action text; resource_type text; resource_id uuid; answer jsonb; stored_payload jsonb;
  before_value jsonb; after_value jsonb;
  v_reason_en text; v_reason_ar text; v_currency text; v_amount bigint; v_qty integer; v_limit bigint;
  v_commission bigint; v_net bigint; v_balance bigint; v_branch uuid; v_status text; v_pin text; v_serial text;
  v_pins jsonb := '[]'::jsonb; v_unredeemed integer; i integer; sub uuid; v_expires timestamptz;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL OR c.action <> 'tenant.dealer.channel.manage'
     OR c.permission NOT IN ('tenant.payment.post', 'tenant.collection.reconcile') THEN
    RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'signed dealer channel authority required';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR operations_json_contains_secret_key(payload - 'pin')
     OR length(btrim(coalesce(payload->>'reasonEn', ''))) NOT BETWEEN 8 AND 1000
     OR length(btrim(coalesce(payload->>'reasonAr', ''))) NOT BETWEEN 8 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'bilingual reasons required';
  END IF;
  v_action := payload->>'action';
  v_reason_en := btrim(payload->>'reasonEn'); v_reason_ar := btrim(payload->>'reasonAr');
  stored_payload := payload - 'pin';
  PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':dealer:' || c.idempotency_key, 0));
  SELECT * INTO prior FROM operations_dealer_events WHERE tenant_id = c.tenant_id AND idempotency_key = c.idempotency_key;
  IF FOUND THEN
    IF prior.request_payload IS DISTINCT FROM stored_payload OR prior.actor_id::text <> c.actor_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'dealer retry key belongs to different content';
    END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF v_action IN ('register_dealer', 'update_dealer') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'dealerId', 'expectedVersion', 'dealerCode', 'dealerName', 'dealerType', 'contactName', 'contactPhone',
         'email', 'branchId', 'creditLimitMinorUsd', 'creditLimitMinorLbp', 'commissionRateBps', 'status', 'notes',
         'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid dealer fields';
    END IF;
    v_branch := nullif(payload->>'branchId', '')::uuid;
    IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations_branches b WHERE b.tenant_id = c.tenant_id AND b.id = v_branch
        AND operations_scope_allows(b.tenant_id, b.id)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'branch is outside current scope';
    END IF;
    IF v_action = 'register_dealer' THEN
      IF length(btrim(coalesce(payload->>'dealerName', ''))) NOT BETWEEN 2 AND 150
         OR length(btrim(coalesce(payload->>'contactPhone', ''))) NOT BETWEEN 3 AND 40 THEN
        RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'dealer name and phone are required';
      END IF;
      IF EXISTS (SELECT 1 FROM operations_dealers d WHERE d.tenant_id = c.tenant_id AND d.dealer_code = upper(btrim(payload->>'dealerCode'))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'dealer code is already registered';
      END IF;
      INSERT INTO operations_dealers(tenant_id, dealer_code, dealer_name, contact_phone, credit_limit_minor_usd,
        credit_limit_minor_lbp, commission_rate_bps, active, dealer_type, contact_name, email, branch_id, status, notes)
      VALUES (c.tenant_id, upper(btrim(payload->>'dealerCode')), btrim(payload->>'dealerName'), btrim(payload->>'contactPhone'),
        coalesce((payload->>'creditLimitMinorUsd')::bigint, 0), coalesce((payload->>'creditLimitMinorLbp')::bigint, 0),
        coalesce((payload->>'commissionRateBps')::integer, 500), true, coalesce(payload->>'dealerType', 'dealer'),
        nullif(btrim(coalesce(payload->>'contactName', '')), ''), nullif(btrim(coalesce(payload->>'email', '')), ''),
        v_branch, 'active', nullif(btrim(coalesce(payload->>'notes', '')), ''))
      RETURNING * INTO dealer;
    ELSE
      SELECT * INTO dealer FROM operations_dealers WHERE tenant_id = c.tenant_id AND id = (payload->>'dealerId')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'dealer not found in scope'; END IF;
      IF dealer.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'dealer changed; refresh before saving';
      END IF;
      before_value := to_jsonb(dealer);
      v_status := coalesce(payload->>'status', dealer.status);
      IF v_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid dealer status'; END IF;
      UPDATE operations_dealers SET
        dealer_name = CASE WHEN payload ? 'dealerName' THEN btrim(payload->>'dealerName') ELSE dealer.dealer_name END,
        contact_phone = CASE WHEN payload ? 'contactPhone' THEN btrim(payload->>'contactPhone') ELSE dealer.contact_phone END,
        dealer_type = CASE WHEN payload ? 'dealerType' THEN payload->>'dealerType' ELSE dealer.dealer_type END,
        contact_name = CASE WHEN payload ? 'contactName' THEN nullif(btrim(payload->>'contactName'), '') ELSE dealer.contact_name END,
        email = CASE WHEN payload ? 'email' THEN nullif(btrim(payload->>'email'), '') ELSE dealer.email END,
        branch_id = CASE WHEN payload ? 'branchId' THEN v_branch ELSE dealer.branch_id END,
        credit_limit_minor_usd = CASE WHEN payload ? 'creditLimitMinorUsd' THEN (payload->>'creditLimitMinorUsd')::bigint ELSE dealer.credit_limit_minor_usd END,
        credit_limit_minor_lbp = CASE WHEN payload ? 'creditLimitMinorLbp' THEN (payload->>'creditLimitMinorLbp')::bigint ELSE dealer.credit_limit_minor_lbp END,
        commission_rate_bps = CASE WHEN payload ? 'commissionRateBps' THEN (payload->>'commissionRateBps')::integer ELSE dealer.commission_rate_bps END,
        notes = CASE WHEN payload ? 'notes' THEN nullif(btrim(payload->>'notes'), '') ELSE dealer.notes END,
        status = v_status, active = (v_status = 'active'), version = version + 1, updated_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND id = dealer.id RETURNING * INTO dealer;
    END IF;
    resource_type := 'operations_dealers'; resource_id := dealer.id; after_value := to_jsonb(dealer);
    answer := jsonb_build_object('dealerId', dealer.id, 'dealerCode', dealer.dealer_code, 'status', dealer.status, 'version', dealer.version);

  ELSIF v_action IN ('record_deposit', 'adjust_balance') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'dealerId', 'currency', 'amountMinor', 'reference', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid ledger fields';
    END IF;
    IF v_action = 'adjust_balance' AND c.permission <> 'tenant.collection.reconcile' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'balance adjustments need reconciliation authority';
    END IF;
    SELECT * INTO dealer FROM operations_dealers WHERE tenant_id = c.tenant_id AND id = (payload->>'dealerId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'dealer not found in scope'; END IF;
    v_currency := payload->>'currency'; v_amount := (payload->>'amountMinor')::bigint;
    IF v_currency NOT IN ('USD', 'LBP') OR v_amount IS NULL OR v_amount = 0
       OR (v_action = 'record_deposit' AND (v_amount <= 0 OR length(btrim(coalesce(payload->>'reference', ''))) NOT BETWEEN 3 AND 200)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'a positive amount, a currency and a receipt reference are required';
    END IF;
    IF v_action = 'record_deposit' AND EXISTS (SELECT 1 FROM operations_dealer_ledger l WHERE l.tenant_id = c.tenant_id
        AND l.entry_kind = 'deposit' AND l.reference = btrim(payload->>'reference')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'this receipt reference was already recorded';
    END IF;
    ledger_entry := dealer_post_ledger(c.tenant_id, dealer.id, CASE v_action WHEN 'record_deposit' THEN 'deposit' ELSE 'adjustment' END,
      v_currency, v_amount, NULL, nullif(btrim(coalesce(payload->>'reference', '')), ''), v_reason_en, v_reason_ar, c.actor_id::uuid);
    resource_type := 'operations_dealer_ledger'; resource_id := ledger_entry.id; after_value := to_jsonb(ledger_entry);
    answer := jsonb_build_object('entryId', ledger_entry.id, 'dealerId', dealer.id, 'currency', v_currency,
      'amountMinor', v_amount, 'balanceAfterMinor', ledger_entry.balance_after_minor);

  ELSIF v_action = 'generate_batch' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'batchNumber', 'faceValueMinor', 'currency', 'quantity', 'expiresAt', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid batch fields';
    END IF;
    v_currency := payload->>'currency'; v_amount := (payload->>'faceValueMinor')::bigint; v_qty := (payload->>'quantity')::integer;
    v_expires := nullif(payload->>'expiresAt', '')::timestamptz;
    IF v_currency NOT IN ('USD', 'LBP') OR v_amount IS NULL OR v_amount <= 0 OR v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 2000
       OR coalesce(payload->>'batchNumber', '') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
       OR (v_expires IS NOT NULL AND v_expires <= clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'batch number (A-Z, 0-9, -), positive face value, currency and 1-2000 vouchers are required';
    END IF;
    IF EXISTS (SELECT 1 FROM operations_voucher_batches b WHERE b.tenant_id = c.tenant_id AND b.batch_number = payload->>'batchNumber') THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'batch number already exists';
    END IF;
    INSERT INTO operations_voucher_batches(tenant_id, batch_number, dealer_id, face_value_minor, currency, quantity, expires_at, created_by)
    VALUES (c.tenant_id, payload->>'batchNumber', NULL, v_amount, v_currency, v_qty, v_expires, c.actor_id::uuid)
    RETURNING * INTO batch;
    FOR i IN 1..v_qty LOOP
      v_pin := voucher_random_pin();
      v_serial := batch.batch_number || '-' || lpad(i::text, 5, '0');
      INSERT INTO operations_vouchers(tenant_id, batch_id, serial_number, pin_hash, status)
      VALUES (c.tenant_id, batch.id, v_serial, encode(digest(batch.pin_salt || ':' || v_pin, 'sha256'), 'hex'), 'created');
      v_pins := v_pins || jsonb_build_object('serialNumber', v_serial, 'pin', v_pin);
    END LOOP;
    resource_type := 'operations_voucher_batches'; resource_id := batch.id; after_value := to_jsonb(batch) - 'pin_salt';
    answer := jsonb_build_object('batchId', batch.id, 'batchNumber', batch.batch_number, 'status', batch.status,
      'quantity', batch.quantity, 'currency', batch.currency, 'faceValueMinor', batch.face_value_minor, 'version', batch.version);

  ELSIF v_action IN ('issue_batch', 'cancel_batch') THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'batchId', 'expectedVersion', 'dealerId', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid batch command fields';
    END IF;
    SELECT * INTO batch FROM operations_voucher_batches WHERE tenant_id = c.tenant_id AND id = (payload->>'batchId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'batch not found in scope'; END IF;
    IF batch.version IS DISTINCT FROM (payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'batch changed; refresh before acting';
    END IF;
    before_value := to_jsonb(batch) - 'pin_salt';
    IF v_action = 'issue_batch' THEN
      IF batch.status <> 'generated' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'only a generated batch can be issued'; END IF;
      SELECT * INTO dealer FROM operations_dealers WHERE tenant_id = c.tenant_id AND id = (payload->>'dealerId')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'dealer not found in scope'; END IF;
      IF dealer.status <> 'active' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'a suspended dealer cannot receive vouchers'; END IF;
      v_amount := batch.face_value_minor * batch.quantity;
      v_commission := (v_amount * dealer.commission_rate_bps) / 10000;
      v_net := v_amount - v_commission;
      v_limit := CASE batch.currency WHEN 'USD' THEN dealer.credit_limit_minor_usd ELSE dealer.credit_limit_minor_lbp END;
      v_balance := dealer_balance_minor(c.tenant_id, dealer.id, batch.currency);
      IF v_balance - v_net + v_limit < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'dealer float and credit limit do not cover this batch';
      END IF;
      ledger_entry := dealer_post_ledger(c.tenant_id, dealer.id, 'batch_issue', batch.currency, -v_amount, batch.id,
        batch.batch_number, v_reason_en, v_reason_ar, c.actor_id::uuid);
      IF v_commission > 0 THEN
        ledger_entry := dealer_post_ledger(c.tenant_id, dealer.id, 'commission', batch.currency, v_commission, batch.id,
          batch.batch_number, v_reason_en, v_reason_ar, c.actor_id::uuid);
      END IF;
      UPDATE operations_voucher_batches SET status = 'issued', dealer_id = dealer.id, issued_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = batch.id RETURNING * INTO batch;
      UPDATE operations_vouchers SET status = 'issued', issued_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND batch_id = batch.id AND status = 'created';
      answer := jsonb_build_object('batchId', batch.id, 'status', batch.status, 'version', batch.version, 'dealerId', dealer.id,
        'faceTotalMinor', v_amount, 'commissionMinor', v_commission, 'netChargedMinor', v_net,
        'balanceAfterMinor', ledger_entry.balance_after_minor, 'currency', batch.currency);
    ELSE
      IF batch.status = 'cancelled' THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'batch is already cancelled'; END IF;
      SELECT count(*) INTO v_unredeemed FROM operations_vouchers v WHERE v.tenant_id = c.tenant_id AND v.batch_id = batch.id AND v.status IN ('created', 'issued');
      IF v_unredeemed = 0 THEN RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'nothing left to cancel in this batch'; END IF;
      IF batch.status = 'issued' AND batch.dealer_id IS NOT NULL THEN
        SELECT * INTO dealer FROM operations_dealers WHERE tenant_id = c.tenant_id AND id = batch.dealer_id FOR UPDATE;
        v_amount := batch.face_value_minor * v_unredeemed;
        v_commission := (v_amount * dealer.commission_rate_bps) / 10000;
        ledger_entry := dealer_post_ledger(c.tenant_id, dealer.id, 'batch_cancel', batch.currency, v_amount - v_commission, batch.id,
          batch.batch_number, v_reason_en, v_reason_ar, c.actor_id::uuid);
      END IF;
      UPDATE operations_vouchers SET status = 'cancelled', cancelled_at = clock_timestamp()
       WHERE tenant_id = c.tenant_id AND batch_id = batch.id AND status IN ('created', 'issued');
      UPDATE operations_voucher_batches SET status = 'cancelled', cancelled_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp() WHERE tenant_id = c.tenant_id AND id = batch.id RETURNING * INTO batch;
      answer := jsonb_build_object('batchId', batch.id, 'status', batch.status, 'version', batch.version,
        'cancelledVouchers', v_unredeemed, 'refundedMinor', CASE WHEN ledger_entry.id IS NULL THEN 0 ELSE ledger_entry.amount_minor END);
    END IF;
    resource_type := 'operations_voucher_batches'; resource_id := batch.id; after_value := to_jsonb(batch) - 'pin_salt';

  ELSIF v_action = 'redeem_voucher' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
        ('action', 'serialNumber', 'pin', 'subscriberId', 'reasonEn', 'reasonAr'))
       OR coalesce(payload->>'pin', '') !~ '^[0-9]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'serial number, a 12 digit PIN and a subscriber are required';
    END IF;
    sub := (payload->>'subscriberId')::uuid;
    IF NOT operations_scope_allows_subscriber(c.tenant_id, sub) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4033', MESSAGE = 'subscriber missing or outside scope';
    END IF;
    SELECT v.* INTO voucher FROM operations_vouchers v
     WHERE v.tenant_id = c.tenant_id AND v.serial_number = upper(btrim(payload->>'serialNumber')) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'voucher not found'; END IF;
    SELECT * INTO batch FROM operations_voucher_batches WHERE tenant_id = c.tenant_id AND id = voucher.batch_id;
    IF voucher.locked_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'voucher is locked after repeated wrong PINs';
    END IF;
    IF voucher.status <> 'issued' OR batch.status <> 'issued' THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = CASE voucher.status WHEN 'redeemed' THEN 'voucher was already redeemed'
        WHEN 'cancelled' THEN 'voucher was cancelled' ELSE 'voucher has not been issued to a dealer' END;
    END IF;
    IF batch.expires_at IS NOT NULL AND batch.expires_at < clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'voucher batch has expired';
    END IF;
    IF voucher.pin_hash <> encode(digest(batch.pin_salt || ':' || (payload->>'pin'), 'sha256'), 'hex') THEN
      -- A wrong PIN is recorded (and the voucher locked on the fifth) without raising, so the
      -- attempt survives the transaction; the caller turns the result into a refusal.
      UPDATE operations_vouchers SET pin_attempts = pin_attempts + 1,
        locked_at = CASE WHEN pin_attempts + 1 >= 5 THEN clock_timestamp() END
       WHERE tenant_id = c.tenant_id AND id = voucher.id RETURNING * INTO voucher;
      answer := jsonb_build_object('status', 'rejected', 'attemptsLeft', greatest(0, 5 - voucher.pin_attempts),
        'locked', voucher.locked_at IS NOT NULL);
      resource_type := 'operations_vouchers'; resource_id := voucher.id;
    ELSE
      INSERT INTO operations_voucher_redemptions(tenant_id, voucher_id, batch_id, subscriber_id, amount_minor, currency, actor_id)
      VALUES (c.tenant_id, voucher.id, batch.id, sub, batch.face_value_minor, batch.currency, c.actor_id::uuid)
      RETURNING * INTO redemption;
      UPDATE operations_vouchers SET status = 'redeemed', redeemed_at = clock_timestamp(), redeemed_by_subscriber_id = sub,
        redemption_id = redemption.id WHERE tenant_id = c.tenant_id AND id = voucher.id RETURNING * INTO voucher;
      answer := jsonb_build_object('status', 'redeemed', 'redemptionId', redemption.id, 'voucherId', voucher.id,
        'serialNumber', voucher.serial_number, 'subscriberId', sub, 'amountMinor', redemption.amount_minor,
        'currency', redemption.currency, 'creditStatus', redemption.status);
      resource_type := 'operations_voucher_redemptions'; resource_id := redemption.id; after_value := to_jsonb(redemption);
    END IF;

  ELSIF v_action = 'confirm_voucher_credit' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action', 'redemptionId', 'accountEntryId', 'reasonEn', 'reasonAr')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'invalid credit confirmation fields';
    END IF;
    SELECT * INTO redemption FROM operations_voucher_redemptions WHERE tenant_id = c.tenant_id AND id = (payload->>'redemptionId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'redemption not found in scope'; END IF;
    IF redemption.status = 'credited' THEN
      answer := jsonb_build_object('redemptionId', redemption.id, 'creditStatus', 'credited', 'accountEntryId', redemption.account_entry_id);
    ELSE
      IF NOT EXISTS (SELECT 1 FROM operations_customer_account_entries e WHERE e.tenant_id = c.tenant_id
          AND e.id = (payload->>'accountEntryId')::uuid AND e.subscriber_id = redemption.subscriber_id AND e.kind = 'deposit_received'
          AND e.amount_minor = redemption.amount_minor AND e.currency::text = redemption.currency) THEN
        RAISE EXCEPTION USING ERRCODE = 'P4091', MESSAGE = 'account entry does not match this redemption';
      END IF;
      before_value := to_jsonb(redemption);
      UPDATE operations_voucher_redemptions SET status = 'credited', account_entry_id = (payload->>'accountEntryId')::uuid,
        credited_at = clock_timestamp(), version = version + 1 WHERE tenant_id = c.tenant_id AND id = redemption.id RETURNING * INTO redemption;
      answer := jsonb_build_object('redemptionId', redemption.id, 'creditStatus', 'credited', 'accountEntryId', redemption.account_entry_id);
    END IF;
    resource_type := 'operations_voucher_redemptions'; resource_id := redemption.id; after_value := to_jsonb(redemption);
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P4001', MESSAGE = 'unknown dealer channel action';
  END IF;

  INSERT INTO operations_dealer_events(tenant_id, action, resource_type, resource_id, actor_id, idempotency_key, request_payload, result)
  VALUES (c.tenant_id, v_action, resource_type, resource_id, c.actor_id::uuid, c.idempotency_key, stored_payload, answer);
  INSERT INTO operations_audit_outbox(tenant_id, action, resource_type, resource_id, actor_id, session_id,
    permission, request_id, idempotency_key, ip_address, user_agent, result, reason, before_value, after_value)
  VALUES (c.tenant_id, c.action, resource_type, resource_id::text, c.actor_id, c.session_id, c.permission,
    c.request_id, c.idempotency_key, c.ip_address, c.user_agent, 'allowed', c.reason, before_value, after_value);
  -- PINs are returned exactly once, to the request that generated them; a replay never repeats them.
  RETURN CASE WHEN v_action = 'generate_batch' THEN answer || jsonb_build_object('pins', v_pins) ELSE answer END;
END $$;
REVOKE ALL ON FUNCTION execute_dealer_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_dealer_command(jsonb) TO orvex_runtime;
