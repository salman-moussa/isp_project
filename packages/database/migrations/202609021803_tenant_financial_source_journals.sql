-- REQ-FIN-001/002, REQ-SEC-003: all new financial sources join the signed journal boundary.
ALTER TABLE operations_journal_entries
 ADD COLUMN finance_source_table text,
 ADD COLUMN finance_source_id uuid,
 ADD COLUMN classification_required boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT journal_finance_source_shape CHECK(
   (finance_source_table IS NULL AND finance_source_id IS NULL) OR
   (finance_source_table IN ('finance_invoices','finance_payments','finance_payment_allocations') AND finance_source_id IS NOT NULL)),
 ADD CONSTRAINT journal_finance_source_once UNIQUE(tenant_id,finance_source_table,finance_source_id);

CREATE FUNCTION accounting_lock_financial_request() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.permission IN ('tenant.invoice.post','tenant.invoice.reverse','tenant.invoice.create',
   'tenant.payment.post','tenant.payment.reverse','tenant.accounting.post','tenant.accounting.close') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':accounting-period',0));
 END IF;
END $$;
REVOKE ALL ON FUNCTION accounting_lock_financial_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting_lock_financial_request() TO orvex_runtime;

CREATE FUNCTION guard_finance_accounting_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; permitted boolean:=false;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.actor_id IS DISTINCT FROM NEW.actor_id
   OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='financial posting requires signed tenant actor context';
 END IF;
 IF TG_TABLE_NAME='finance_invoices' THEN
   permitted:=(NEW.entry_kind='posted' AND (
     (c.permission='tenant.invoice.post' AND c.action IN ('tenant.invoice.post','tenant.order.first_invoice.post'))
     OR (c.permission='tenant.invoice.create' AND c.action='tenant.billing.prepare')))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.invoice.reverse' AND c.action='tenant.invoice.reverse');
 ELSIF TG_TABLE_NAME='finance_payments' THEN
   permitted:=(NEW.entry_kind='posted' AND c.permission='tenant.payment.post' AND c.action IN
     ('tenant.payment.post','tenant.payment.office.record','tenant.collection.evidence.record','tenant.customer_account.deposit_received'))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.payment.reverse' AND c.action IN
       ('tenant.payment.reverse','tenant.customer_account.deposit_reversal'));
 ELSE
   permitted:=(NEW.entry_kind='allocation' AND (
     (c.permission='tenant.payment.post' AND c.action IN ('tenant.payment.allocate','tenant.collection.evidence.record','tenant.customer_account.deposit_applied'))
     OR (c.permission='tenant.payment.reverse' AND c.action='tenant.payment.correct')))
     OR (NEW.entry_kind='reversal' AND c.permission='tenant.payment.reverse' AND c.action IN
       ('tenant.payment.allocation.reverse','tenant.payment.correct','tenant.customer_account.deposit_application_reversal'));
 END IF;
 IF NOT permitted THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed finance action does not authorize this source';
 END IF;
 -- Raw finance endpoints carry no service/branch identity: they require unrestricted tenant scope.
 IF c.action IN ('tenant.invoice.post','tenant.invoice.reverse','tenant.payment.post',
   'tenant.payment.reverse','tenant.payment.allocate','tenant.payment.allocation.reverse')
   AND NOT operations_scope_allows(NEW.tenant_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='use a scoped operational workflow for this finance mutation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':accounting-period',0));
 -- An exact retry is a read of its already-posted result, even after a subsequent period close.
 IF EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=NEW.tenant_id
   AND j.finance_source_table=TG_TABLE_NAME AND j.finance_source_id IN (
     SELECT (r->>'id')::uuid FROM (
       SELECT to_jsonb(i) r FROM finance_invoices i WHERE TG_TABLE_NAME='finance_invoices' AND i.tenant_id=NEW.tenant_id AND i.idempotency_key=NEW.idempotency_key
       UNION ALL SELECT to_jsonb(p) FROM finance_payments p WHERE TG_TABLE_NAME='finance_payments' AND p.tenant_id=NEW.tenant_id AND p.idempotency_key=NEW.idempotency_key
       UNION ALL SELECT to_jsonb(a) FROM finance_payment_allocations a WHERE TG_TABLE_NAME='finance_payment_allocations' AND a.tenant_id=NEW.tenant_id AND a.idempotency_key=NEW.idempotency_key
     ) old_source)) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM operations_accounting_periods p WHERE p.tenant_id=NEW.tenant_id
   AND p.status<>'open' AND (NEW.posted_at AT TIME ZONE 'UTC')::date BETWEEN p.start_date AND p.end_date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='financial source date belongs to a closed accounting period';
 END IF;
 IF NEW.amount_minor>9007199254740991 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='financial source amount exceeds safe integer range';
 END IF;
 RETURN NEW;
END $$;
-- Sort before existing finance guard locks to maintain accounting -> invoice -> payment order.
CREATE TRIGGER aaa_accounting_invoice BEFORE INSERT ON finance_invoices
 FOR EACH ROW EXECUTE FUNCTION guard_finance_accounting_source();
CREATE TRIGGER aaa_accounting_payment BEFORE INSERT ON finance_payments
 FOR EACH ROW EXECUTE FUNCTION guard_finance_accounting_source();
CREATE TRIGGER aaa_accounting_allocation BEFORE INSERT ON finance_payment_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_finance_accounting_source();

CREATE FUNCTION journal_financial_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; journal uuid; parent uuid; original_id uuid;
 prep operations_invoice_preparations%ROWTYPE; snapshot jsonb; component record;
 ar text; cash text; revenue text; unapplied text; clearing text; needs_classification boolean:=false;
 debit_code text; credit_code text; net bigint; vat bigint; stamp bigint;
 source_type text; description text; parent_classification boolean;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.actor_id IS DISTINCT FROM NEW.actor_id
   OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='financial journal lost its signed source context';
 END IF;
 IF TG_TABLE_NAME<>'finance_invoices' AND EXISTS(
   SELECT 1 FROM operations_customer_account_entries e JOIN operations_journal_entries j
     ON j.tenant_id=e.tenant_id AND j.customer_entry_id=e.id AND j.posting_version='v2'
   WHERE e.tenant_id=NEW.tenant_id AND (
     (TG_TABLE_NAME='finance_payments' AND e.payment_id=NEW.id AND e.kind IN ('deposit_received','deposit_reversal'))
     OR (TG_TABLE_NAME='finance_payment_allocations' AND e.allocation_id=NEW.id))) THEN
   RETURN NEW; -- Customer-account trigger already posted this exact receipt/allocation once.
 END IF;
 IF EXISTS(SELECT 1 FROM operations_journal_entries WHERE tenant_id=NEW.tenant_id
   AND finance_source_table=TG_TABLE_NAME AND finance_source_id=NEW.id) THEN RETURN NEW; END IF;
 -- Governed workflows must leave their scoped source evidence in this transaction.
 IF c.action IN ('tenant.billing.prepare','tenant.order.first_invoice.post') AND NOT EXISTS(
   SELECT 1 FROM operations_invoice_preparations p WHERE p.tenant_id=NEW.tenant_id
     AND p.finance_invoice_id=NEW.id AND p.posting_status='posted'
     AND operations_scope_allows(p.tenant_id,p.branch_id,p.area_id,p.route_id,p.service_id)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='invoice has no governed scoped billing source';
 END IF;
 IF c.action='tenant.payment.office.record' AND NOT EXISTS(
   SELECT 1 FROM operations_office_payment_requests p WHERE p.tenant_id=NEW.tenant_id
     AND p.finance_payment_id=NEW.id AND operations_scope_allows(p.tenant_id,p.branch_id,p.area_id,p.route_id,p.id)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='receipt has no scoped office source';
 END IF;
 IF c.action='tenant.collection.evidence.record' AND NOT EXISTS(
   SELECT 1 FROM operations_collector_collection_evidence e
   JOIN operations_collector_assignments a ON a.tenant_id=e.tenant_id AND a.id=e.assignment_id
   WHERE e.tenant_id=NEW.tenant_id AND a.collector_user_id=c.actor_id::uuid
     AND e.finance_payment_id=(CASE WHEN TG_TABLE_NAME='finance_payments' THEN NEW.id ELSE (to_jsonb(NEW)->>'payment_id')::uuid END)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='receipt has no collector assignment evidence';
 END IF;
 IF c.action='tenant.payment.correct' AND NOT EXISTS(
   SELECT 1 FROM operations_office_payment_corrections p WHERE p.tenant_id=NEW.tenant_id AND p.finance_allocation_id=NEW.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='allocation has no scoped correction evidence';
 END IF;
 IF c.action LIKE 'tenant.customer_account.%' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='customer-account source is missing its atomic journal';
 END IF;
 PERFORM seed_tenant_default_chart_of_accounts(NEW.tenant_id);
 INSERT INTO operations_chart_of_accounts(tenant_id,account_code,account_name_en,account_name_ar,account_type,currency,is_system) VALUES
   (NEW.tenant_id,'1090','Receipts pending classification USD','مقبوضات قيد التصنيف USD','asset','USD',true),
   (NEW.tenant_id,'1091','Receipts pending classification LBP','مقبوضات قيد التصنيف LBP','asset','LBP',true),
   (NEW.tenant_id,'2400','Unapplied receipts USD','مقبوضات غير مخصصة USD','liability','USD',true),
   (NEW.tenant_id,'2410','Unapplied receipts LBP','مقبوضات غير مخصصة LBP','liability','LBP',true),
   (NEW.tenant_id,'2490','Invoice classification clearing USD','حساب تصنيف الفواتير USD','liability','USD',true),
   (NEW.tenant_id,'2491','Invoice classification clearing LBP','حساب تصنيف الفواتير LBP','liability','LBP',true)
 ON CONFLICT(tenant_id,account_code) DO NOTHING;
 ar:=CASE NEW.currency WHEN 'LBP' THEN '1110' ELSE '1100' END;
 cash:=CASE NEW.currency WHEN 'LBP' THEN '1020' ELSE '1010' END;
 revenue:=CASE NEW.currency WHEN 'LBP' THEN '4010' ELSE '4000' END;
 unapplied:=CASE NEW.currency WHEN 'LBP' THEN '2410' ELSE '2400' END;
 clearing:=CASE NEW.currency WHEN 'LBP' THEN '2491' ELSE '2490' END;
 source_type:=CASE TG_TABLE_NAME WHEN 'finance_invoices' THEN 'invoice' ELSE 'payment' END;
 description:=CASE TG_TABLE_NAME WHEN 'finance_invoices' THEN 'Invoice' WHEN 'finance_payments' THEN 'Receipt' ELSE 'Allocation' END;
 original_id:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'finance_invoices' THEN 'reverses_invoice_id'
   WHEN 'finance_payments' THEN 'reverses_payment_id' ELSE 'reverses_allocation_id' END)::uuid;
 IF original_id IS NOT NULL THEN
   SELECT id,classification_required INTO parent,parent_classification FROM operations_journal_entries
     WHERE tenant_id=NEW.tenant_id AND finance_source_table=TG_TABLE_NAME AND finance_source_id=original_id AND posting_version='v2';
   IF NOT FOUND THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='legacy financial source requires approved reconciliation before reversal';
   END IF;
   needs_classification:=parent_classification;
 ELSIF TG_TABLE_NAME='finance_invoices' THEN
   SELECT * INTO prep FROM operations_invoice_preparations WHERE tenant_id=NEW.tenant_id
     AND finance_invoice_id=NEW.id AND posting_status='posted';
   snapshot:=prep.legal_invoice_snapshot;
   IF snapshot IS NULL THEN
     needs_classification:=true; debit_code:=ar; credit_code:=clearing;
   ELSE
     net:=(snapshot#>>'{amounts,taxableMinor}')::bigint;
     vat:=(snapshot#>>'{tax,amountMinor}')::bigint;
     stamp:=(snapshot#>>'{amounts,stampDutyMinor}')::bigint;
     IF net IS NULL OR vat IS NULL OR stamp IS NULL OR net<0 OR vat<0 OR stamp<0
       OR net::numeric+vat+stamp<>NEW.amount_minor OR prep.currency<>NEW.currency THEN
       RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invoice journal must match immutable legal amounts and currency';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='finance_payments' THEN
   credit_code:=unapplied;
   IF c.action='tenant.collection.evidence.record' THEN debit_code:=cash;
   ELSE debit_code:=CASE NEW.currency WHEN 'LBP' THEN '1091' ELSE '1090' END; needs_classification:=true;
   END IF;
 ELSE
   -- The original receipt must already have a journal (its deferred event precedes allocation).
   IF NOT EXISTS(SELECT 1 FROM operations_journal_entries WHERE tenant_id=NEW.tenant_id
     AND finance_source_table='finance_payments' AND finance_source_id=NEW.payment_id AND posting_version='v2') THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='legacy receipt requires approved reconciliation before allocation';
   END IF;
   debit_code:=unapplied; credit_code:=ar;
 END IF;
 INSERT INTO operations_journal_entries(tenant_id,entry_number,entry_date,description_en,description_ar,
   source_type,source_id,posted_by,posting_version,finance_source_table,finance_source_id,reverses_journal_id,classification_required)
 VALUES(NEW.tenant_id,'FIN-'||NEW.id::text,(NEW.posted_at AT TIME ZONE 'UTC')::date,
   description||' '||NEW.id::text,'قيد مالي '||NEW.id::text,source_type,NEW.id,NEW.actor_id::uuid,'v2',
   TG_TABLE_NAME,NEW.id,parent,needs_classification) RETURNING id INTO journal;
 IF parent IS NOT NULL THEN
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,credit_minor,currency)
   SELECT journal,tenant_id,account_id,credit_minor,debit_minor,currency FROM operations_journal_lines WHERE journal_entry_id=parent;
 ELSIF snapshot IS NOT NULL THEN
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts WHERE tenant_id=NEW.tenant_id AND account_code=ar;
   FOR component IN SELECT * FROM (VALUES(revenue,net),('2200',vat),('2220',stamp)) AS amounts(code,amount) WHERE amount>0 LOOP
     INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
       SELECT journal,NEW.tenant_id,id,component.amount,NEW.currency::text FROM operations_chart_of_accounts
         WHERE tenant_id=NEW.tenant_id AND account_code=component.code;
   END LOOP;
 ELSE
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts
       WHERE tenant_id=NEW.tenant_id AND account_code=debit_code;
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts
       WHERE tenant_id=NEW.tenant_id AND account_code=credit_code;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER finance_invoice_journal AFTER INSERT ON finance_invoices
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_financial_source();
CREATE CONSTRAINT TRIGGER finance_payment_journal AFTER INSERT ON finance_payments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_financial_source();
CREATE CONSTRAINT TRIGGER finance_allocation_journal AFTER INSERT ON finance_payment_allocations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_financial_source();
REVOKE ALL ON FUNCTION guard_finance_accounting_source(),journal_financial_source() FROM PUBLIC;

CREATE OR REPLACE FUNCTION guard_accounting_close_coverage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF accounting_has_unjournaled_sources(NEW.tenant_id,NEW.end_date) OR EXISTS(
   SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=NEW.tenant_id
     AND j.entry_date<=NEW.end_date AND j.classification_required
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries r WHERE r.tenant_id=j.tenant_id AND r.reverses_journal_id=j.id)
     AND j.reverses_journal_id IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='period close blocked: financial source coverage or classification needs reconciliation';
 END IF;
 RETURN NEW;
END $$;
