-- REQ-FIN-002: classification is immutable; reversal undoes the source plus its correction.
CREATE OR REPLACE FUNCTION classify_accounting_journal(source_id uuid,correction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; source operations_journal_entries%ROWTYPE;
 correction operations_journal_entries%ROWTYPE;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF NOT accounting_scope_allows(c.tenant_id) OR c.permission<>'tenant.accounting.post'
   OR c.action<>'tenant.accounting.journal.post' THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed accounting posting authority required';
 END IF;
 SELECT * INTO source FROM operations_journal_entries WHERE tenant_id=c.tenant_id AND id=classify_accounting_journal.source_id;
 SELECT * INTO correction FROM operations_journal_entries WHERE tenant_id=c.tenant_id AND id=correction_id;
 IF source.id IS NULL OR correction.id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='classification journals are outside scope';
 END IF;
 IF NOT source.classification_required OR source.posting_version<>'v2'
   OR source.reverses_journal_id IS NOT NULL OR correction.entry_date<source.entry_date
   OR correction.source_type<>'manual' OR source.id=correction.id
   OR EXISTS(SELECT 1 FROM operations_journal_entries WHERE tenant_id=c.tenant_id AND reverses_journal_id=source.id)
   OR EXISTS(SELECT 1 FROM operations_accounting_classifications WHERE tenant_id=c.tenant_id AND source_journal_id=source.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='classification source is reversed, resolved, invalid or newer than correction';
 END IF;
 -- Exactly remove the source's clearing balance, separately by account and currency.
 IF NOT EXISTS(SELECT 1 FROM operations_journal_lines l JOIN operations_chart_of_accounts a ON a.id=l.account_id
   WHERE l.journal_entry_id=source.id AND a.account_code IN ('1090','1091','2490','2491'))
   OR EXISTS(
     SELECT l.account_id,l.currency FROM operations_journal_lines l
     JOIN operations_chart_of_accounts a ON a.id=l.account_id AND a.tenant_id=l.tenant_id
     WHERE l.tenant_id=c.tenant_id AND l.journal_entry_id IN (source.id,correction.id)
       AND a.account_code IN ('1090','1091','2490','2491')
     GROUP BY l.account_id,l.currency HAVING sum(l.debit_minor-l.credit_minor)<>0
   ) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='classification must fully clear the original clearing accounts per currency';
 END IF;
 INSERT INTO operations_accounting_classifications(tenant_id,source_journal_id,correction_journal_id,actor_id)
 VALUES(c.tenant_id,source.id,correction.id,c.actor_id);
END $$;
CREATE OR REPLACE FUNCTION journal_financial_source() RETURNS trigger
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
   needs_classification:=parent_classification AND NOT EXISTS(
     SELECT 1 FROM operations_accounting_classifications WHERE tenant_id=NEW.tenant_id AND source_journal_id=parent);
   IF EXISTS(SELECT 1 FROM operations_accounting_classifications k JOIN operations_journal_entries r
     ON r.tenant_id=k.tenant_id AND r.id=k.correction_journal_id
     WHERE k.tenant_id=NEW.tenant_id AND k.source_journal_id=parent
       AND r.entry_date>(NEW.posted_at AT TIME ZONE 'UTC')::date) THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reversal cannot predate its classification correction';
   END IF;
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
   SELECT journal,NEW.tenant_id,l.account_id,
     greatest(sum(l.credit_minor-l.debit_minor),0),greatest(sum(l.debit_minor-l.credit_minor),0),l.currency
   FROM operations_journal_lines l WHERE l.tenant_id=NEW.tenant_id AND (
     l.journal_entry_id=parent OR l.journal_entry_id IN (
       SELECT correction_journal_id FROM operations_accounting_classifications
       WHERE tenant_id=NEW.tenant_id AND source_journal_id=parent))
   GROUP BY l.account_id,l.currency HAVING sum(l.debit_minor-l.credit_minor)<>0;
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
