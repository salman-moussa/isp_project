-- REQ-FIN-001/002: customer-bound deposits and unpaid-invoice credit adjustments.
-- Cash receipts remain in finance_payments; credit notes never masquerade as cash.
ALTER TABLE finance_document_guards
  ADD COLUMN credited_net_minor bigint NOT NULL DEFAULT 0 CHECK(credited_net_minor>=0),
  ADD COLUMN credited_vat_minor bigint NOT NULL DEFAULT 0 CHECK(credited_vat_minor>=0),
  ADD COLUMN credited_stamp_minor bigint NOT NULL DEFAULT 0 CHECK(credited_stamp_minor>=0),
  ADD COLUMN credited_minor bigint GENERATED ALWAYS AS
    (credited_net_minor+credited_vat_minor+credited_stamp_minor) STORED;

CREATE TABLE operations_customer_account_entries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscriber_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('credit_note','credit_reversal','deposit_received',
    'deposit_applied','deposit_application_reversal','deposit_reversal')),
  document_number text NOT NULL CHECK(length(btrim(document_number)) BETWEEN 1 AND 100),
  invoice_id uuid,
  payment_id uuid,
  allocation_id uuid,
  source_entry_id uuid,
  reverses_entry_id uuid,
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  currency finance_currency NOT NULL,
  net_minor bigint NOT NULL DEFAULT 0 CHECK(net_minor BETWEEN 0 AND 9007199254740991),
  vat_minor bigint NOT NULL DEFAULT 0 CHECK(vat_minor BETWEEN 0 AND 9007199254740991),
  stamp_minor bigint NOT NULL DEFAULT 0 CHECK(stamp_minor BETWEEN 0 AND 9007199254740991),
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 500),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 500),
  source_reference text,
  invoice_snapshot jsonb,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload jsonb NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,document_number),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(reverses_entry_id),
  UNIQUE(allocation_id),
  FOREIGN KEY(tenant_id,subscriber_id) REFERENCES operations_subscribers(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES finance_invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES finance_payments(tenant_id,id),
  FOREIGN KEY(tenant_id,allocation_id) REFERENCES finance_payment_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,source_entry_id) REFERENCES operations_customer_account_entries(tenant_id,id),
  FOREIGN KEY(tenant_id,reverses_entry_id) REFERENCES operations_customer_account_entries(tenant_id,id),
  CHECK((kind IN ('credit_note','credit_reversal') AND invoice_id IS NOT NULL
      AND payment_id IS NULL AND amount_minor=net_minor+vat_minor+stamp_minor)
    OR (kind NOT IN ('credit_note','credit_reversal') AND payment_id IS NOT NULL
      AND net_minor=0 AND vat_minor=0 AND stamp_minor=0)),
  CHECK((kind IN ('credit_reversal','deposit_application_reversal','deposit_reversal'))
    = (reverses_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX customer_deposit_payment_binding
  ON operations_customer_account_entries(tenant_id,payment_id) WHERE kind='deposit_received';
CREATE UNIQUE INDEX customer_deposit_receipt_reference
  ON operations_customer_account_entries(tenant_id,source_reference) WHERE kind='deposit_received';
CREATE INDEX customer_account_history
  ON operations_customer_account_entries(tenant_id,subscriber_id,posted_at DESC);

CREATE FUNCTION customer_account_invoice_scope(target_tenant uuid,target_invoice uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM operations_invoice_preparations p
    WHERE p.tenant_id=target_tenant AND p.finance_invoice_id=target_invoice
      AND operations_scope_allows(p.tenant_id,p.branch_id,p.area_id,p.route_id,p.service_id))
$$;
ALTER TABLE operations_customer_account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_customer_account_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_account_scope ON operations_customer_account_entries
  USING(operations_scope_allows_subscriber(tenant_id,subscriber_id)
    AND (invoice_id IS NULL OR customer_account_invoice_scope(tenant_id,invoice_id)));
CREATE TRIGGER customer_accounts_append_only
  BEFORE UPDATE OR DELETE ON operations_customer_account_entries
  FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER customer_accounts_no_truncate
  BEFORE TRUNCATE ON operations_customer_account_entries
  FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
GRANT SELECT ON operations_customer_account_entries TO orvex_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON operations_customer_account_entries FROM orvex_runtime;

-- Applies to every allocation path, including legacy finance and mobile collection.
-- Existing allocation validation locks invoice first, payment second. This AFTER trigger sorts
-- after finance_allocations_maintain_guards and checks the final, serialized balance.
CREATE FUNCTION validate_credited_invoice_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM finance_document_guards g JOIN finance_invoices i
    ON i.tenant_id=g.tenant_id AND i.id=g.document_id
    WHERE g.tenant_id=NEW.tenant_id AND g.document_type='invoice'
      AND g.document_id=NEW.invoice_id AND g.allocated_minor+g.credited_minor>i.amount_minor) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='allocation exceeds the credited invoice balance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_allocations_zzz_credit_balance AFTER INSERT ON finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION validate_credited_invoice_allocation();

CREATE FUNCTION validate_credited_invoice_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE credit_balance bigint;
BEGIN
  IF NEW.entry_kind='reversal' THEN
    SELECT credited_minor INTO credit_balance FROM finance_document_guards
      WHERE tenant_id=NEW.tenant_id AND document_type='invoice'
        AND document_id=NEW.reverses_invoice_id FOR UPDATE;
    IF credit_balance>0 THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reverse credit notes before reversing the invoice';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_invoices_credit_reversal BEFORE INSERT ON finance_invoices
  FOR EACH ROW EXECUTE FUNCTION validate_credited_invoice_reversal();

-- A bound deposit cannot be spent/reversed through legacy APIs without an account entry.
-- Deferred checking permits the atomic ledger + account append in the function below.
CREATE FUNCTION validate_customer_deposit_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_payment uuid;
BEGIN
  IF TG_TABLE_NAME='finance_payment_allocations' THEN
    target_payment:=NEW.payment_id;
  ELSE
    target_payment:=NEW.reverses_payment_id;
  END IF;
  IF target_payment IS NOT NULL AND EXISTS(SELECT 1 FROM operations_customer_account_entries
    WHERE tenant_id=NEW.tenant_id AND payment_id=target_payment AND kind='deposit_received') THEN
    IF TG_TABLE_NAME='finance_payment_allocations' THEN
      IF NOT EXISTS(SELECT 1 FROM operations_customer_account_entries
        WHERE tenant_id=NEW.tenant_id AND allocation_id=NEW.id) THEN
        RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='deposit allocations require the customer account workflow';
      END IF;
    ELSE
      IF NOT EXISTS(SELECT 1 FROM operations_customer_account_entries
        WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.id AND kind='deposit_reversal') THEN
        RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='deposit reversals require the customer account workflow';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER customer_deposit_allocation_link
  AFTER INSERT ON finance_payment_allocations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_customer_deposit_link();
CREATE CONSTRAINT TRIGGER customer_deposit_reversal_link
  AFTER INSERT ON finance_payments DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_customer_deposit_link();

CREATE FUNCTION post_customer_account_entry(payload jsonb)
RETURNS operations_customer_account_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  ctx operations_request_contexts%ROWTYPE;
  result operations_customer_account_entries%ROWTYPE;
  parent operations_customer_account_entries%ROWTYPE;
  inv finance_invoices%ROWTYPE;
  guard finance_document_guards%ROWTYPE;
  entry_kind text:=payload->>'kind';
  expected_permission text;
  subscriber uuid;
  invoice uuid;
  payment uuid;
  allocation uuid;
  source_entry uuid;
  reversal uuid;
  amount bigint;
  net bigint:=0;
  vat bigint:=0;
  stamp bigint:=0;
  money_currency finance_currency;
  snapshot jsonb;
  document text:=btrim(payload->>'documentNumber');
  reference text:=nullif(btrim(payload->>'sourceReference'),'');
  finance_action text;
BEGIN
  SELECT * INTO ctx FROM operations_current_context();
  expected_permission:=CASE entry_kind
    WHEN 'credit_note' THEN 'tenant.invoice.reverse'
    WHEN 'credit_reversal' THEN 'tenant.invoice.reverse'
    WHEN 'deposit_received' THEN 'tenant.payment.post'
    WHEN 'deposit_applied' THEN 'tenant.payment.post'
    WHEN 'deposit_application_reversal' THEN 'tenant.payment.reverse'
    WHEN 'deposit_reversal' THEN 'tenant.payment.reverse' END;
  IF ctx.tenant_id IS NULL OR expected_permission IS NULL
    OR ctx.permission IS DISTINCT FROM expected_permission
    OR ctx.action IS DISTINCT FROM 'tenant.customer_account.'||entry_kind
    OR ctx.support_grant_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed customer account authority required';
  END IF;
  PERFORM set_config('app.tenant_id',ctx.tenant_id::text,true);
  -- Serialize retries before any monetary mutation; equality uses canonical JSONB.
  PERFORM pg_advisory_xact_lock(hashtextextended(ctx.tenant_id::text||':account:'||ctx.idempotency_key,0));
  SELECT * INTO result FROM operations_customer_account_entries
    WHERE tenant_id=ctx.tenant_id AND idempotency_key=ctx.idempotency_key;
  IF FOUND THEN
    IF NOT operations_scope_allows_subscriber(result.tenant_id,result.subscriber_id)
      OR (result.invoice_id IS NOT NULL AND NOT customer_account_invoice_scope(result.tenant_id,result.invoice_id)) THEN
      RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='account entry outside current scope';
    END IF;
    IF result.request_payload IS DISTINCT FROM payload THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='idempotency key belongs to another account request';
    END IF;
    RETURN result;
  END IF;

  IF entry_kind IN ('credit_reversal','deposit_application_reversal','deposit_reversal','deposit_applied') THEN
    source_entry:=(payload->>'sourceEntryId')::uuid;
    SELECT * INTO parent FROM operations_customer_account_entries
      WHERE tenant_id=ctx.tenant_id AND id=source_entry;
    IF NOT FOUND OR NOT operations_scope_allows_subscriber(ctx.tenant_id,parent.subscriber_id)
      OR (parent.invoice_id IS NOT NULL AND NOT customer_account_invoice_scope(ctx.tenant_id,parent.invoice_id)) THEN
      RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='source account entry missing or outside scope';
    END IF;
    IF parent.kind IS DISTINCT FROM (CASE entry_kind
      WHEN 'credit_reversal' THEN 'credit_note'
      WHEN 'deposit_application_reversal' THEN 'deposit_applied'
      ELSE 'deposit_received' END)
      OR EXISTS(SELECT 1 FROM operations_customer_account_entries WHERE reverses_entry_id=parent.id) THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='source entry is not eligible for this operation';
    END IF;
    subscriber:=parent.subscriber_id;
    money_currency:=parent.currency;
    payment:=parent.payment_id;
    invoice:=parent.invoice_id;
    amount:=parent.amount_minor;
    net:=parent.net_minor; vat:=parent.vat_minor; stamp:=parent.stamp_minor;
    snapshot:=parent.invoice_snapshot;
    IF entry_kind<>'deposit_applied' THEN reversal:=parent.id; END IF;
  ELSE
    subscriber:=(payload->>'subscriberId')::uuid;
    money_currency:=(payload->>'currency')::finance_currency;
  END IF;
  IF subscriber IS NULL OR NOT operations_scope_allows_subscriber(ctx.tenant_id,subscriber) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='subscriber missing or outside scope';
  END IF;
  IF entry_kind IN ('credit_note','deposit_applied') THEN
    invoice:=(payload->>'invoiceId')::uuid;
    SELECT i.* INTO inv
      FROM finance_invoices i JOIN operations_invoice_preparations p
        ON p.tenant_id=i.tenant_id AND p.finance_invoice_id=i.id
      JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id
      WHERE i.tenant_id=ctx.tenant_id AND i.id=invoice AND i.entry_kind='posted'
        AND p.posting_status='posted' AND s.subscriber_id=subscriber
        AND customer_account_invoice_scope(ctx.tenant_id,i.id);
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='posted invoice missing or outside customer scope';
    END IF;
    SELECT legal_invoice_snapshot INTO snapshot FROM operations_invoice_preparations
      WHERE tenant_id=ctx.tenant_id AND finance_invoice_id=invoice;
    IF inv.currency IS DISTINCT FROM money_currency THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='customer account currencies must match';
    END IF;
  END IF;
  IF entry_kind IN ('credit_note','credit_reversal') THEN
    SELECT * INTO guard FROM finance_document_guards WHERE tenant_id=ctx.tenant_id
      AND document_type='invoice' AND document_id=invoice FOR UPDATE;
    IF NOT FOUND OR guard.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='credit requires an active invoice';
    END IF;
    IF entry_kind='credit_note' THEN
      net:=(payload->>'netMinor')::bigint;
      vat:=(payload->>'vatMinor')::bigint;
      stamp:=(payload->>'stampMinor')::bigint;
      amount:=net+vat+stamp;
      IF snapshot IS NULL OR net IS NULL OR vat IS NULL OR stamp IS NULL
        OR net<0 OR vat<0 OR stamp<0 OR amount NOT BETWEEN 1 AND 9007199254740991
        OR guard.allocated_minor+guard.credited_minor+amount>inv.amount_minor
        OR snapshot#>>'{amounts,taxableMinor}' IS NULL
        OR snapshot#>>'{tax,amountMinor}' IS NULL
        OR snapshot#>>'{amounts,stampDutyMinor}' IS NULL
        OR guard.credited_net_minor+net>(snapshot#>>'{amounts,taxableMinor}')::bigint
        OR guard.credited_vat_minor+vat>(snapshot#>>'{tax,amountMinor}')::bigint
        OR guard.credited_stamp_minor+stamp>(snapshot#>>'{amounts,stampDutyMinor}')::bigint THEN
        RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='credit exceeds unpaid balance or original invoice components';
      END IF;
    END IF;
    UPDATE finance_document_guards SET
      credited_net_minor=credited_net_minor+CASE entry_kind WHEN 'credit_note' THEN net ELSE -net END,
      credited_vat_minor=credited_vat_minor+CASE entry_kind WHEN 'credit_note' THEN vat ELSE -vat END,
      credited_stamp_minor=credited_stamp_minor+CASE entry_kind WHEN 'credit_note' THEN stamp ELSE -stamp END
      WHERE tenant_id=ctx.tenant_id AND document_type='invoice' AND document_id=invoice;
  ELSE
    finance_action:=CASE entry_kind
      WHEN 'deposit_received' THEN 'tenant.payment.post'
      WHEN 'deposit_applied' THEN 'tenant.payment.allocate'
      WHEN 'deposit_application_reversal' THEN 'tenant.payment.allocation.reverse'
      ELSE 'tenant.payment.reverse' END;
    PERFORM set_config('app.finance_actor_id',ctx.actor_id,true);
    PERFORM set_config('app.finance_session_id',ctx.session_id,true);
    PERFORM set_config('app.finance_support_grant_id','',true);
    PERFORM set_config('app.finance_action',finance_action,true);
    PERFORM set_config('app.finance_permission',ctx.permission,true);
    PERFORM set_config('app.finance_request_id',ctx.request_id,true);
    PERFORM set_config('app.finance_ip_address',ctx.ip_address,true);
    PERFORM set_config('app.finance_user_agent',coalesce(ctx.user_agent,''),true);
    PERFORM set_config('app.finance_reason',ctx.reason,true);
    IF entry_kind='deposit_received' THEN
      amount:=(payload->>'amountMinor')::bigint;
      IF reference IS NULL OR length(reference) NOT BETWEEN 3 AND 200 THEN
        RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a unique actual receipt or bank reference is required';
      END IF;
      INSERT INTO finance_payments(tenant_id,receipt_number,amount_minor,currency,idempotency_key,actor_id,posted_at)
        VALUES(ctx.tenant_id,document,amount,money_currency,'account:'||ctx.idempotency_key,ctx.actor_id,clock_timestamp())
        RETURNING id INTO payment;
    ELSIF entry_kind IN ('deposit_applied','deposit_application_reversal') THEN
      IF entry_kind='deposit_applied' THEN amount:=(payload->>'amountMinor')::bigint; END IF;
      INSERT INTO finance_payment_allocations(tenant_id,payment_id,invoice_id,entry_kind,
        reverses_allocation_id,amount_minor,currency,idempotency_key,actor_id,posted_at)
        VALUES(ctx.tenant_id,payment,invoice,
          CASE entry_kind WHEN 'deposit_applied' THEN 'allocation' ELSE 'reversal' END::finance_allocation_kind,
          CASE entry_kind WHEN 'deposit_application_reversal' THEN parent.allocation_id END,
          amount,money_currency,'account:'||ctx.idempotency_key,ctx.actor_id,clock_timestamp())
        RETURNING id INTO allocation;
    ELSE
      INSERT INTO finance_payments(tenant_id,receipt_number,entry_kind,reverses_payment_id,
        amount_minor,currency,idempotency_key,actor_id,posted_at)
        VALUES(ctx.tenant_id,document,'reversal',payment,amount,money_currency,
          'account:'||ctx.idempotency_key,ctx.actor_id,clock_timestamp()) RETURNING id INTO payment;
    END IF;
  END IF;
  INSERT INTO operations_customer_account_entries(tenant_id,subscriber_id,kind,document_number,
    invoice_id,payment_id,allocation_id,source_entry_id,reverses_entry_id,amount_minor,currency,
    net_minor,vat_minor,stamp_minor,reason_en,reason_ar,source_reference,invoice_snapshot,
    actor_id,idempotency_key,request_payload)
    VALUES(ctx.tenant_id,subscriber,entry_kind,document,invoice,payment,allocation,source_entry,reversal,
      amount,money_currency,net,vat,stamp,btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),
      reference,snapshot,ctx.actor_id,ctx.idempotency_key,payload) RETURNING * INTO result;
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,
    session_id,support_grant_id,permission,request_id,idempotency_key,ip_address,user_agent,
    result,reason,before_value,after_value)
    VALUES(ctx.tenant_id,ctx.action,'operations_customer_account_entries',result.id::text,
      ctx.actor_id,ctx.session_id,NULL,ctx.permission,ctx.request_id,ctx.idempotency_key,
      ctx.ip_address,ctx.user_agent,'allowed',ctx.reason,NULL,to_jsonb(result)-'invoice_snapshot');
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION customer_account_invoice_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_account_invoice_scope(uuid,uuid) TO orvex_runtime;
REVOKE ALL ON FUNCTION validate_credited_invoice_allocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_credited_invoice_reversal() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_customer_deposit_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION post_customer_account_entry(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_customer_account_entry(jsonb) TO orvex_runtime;
