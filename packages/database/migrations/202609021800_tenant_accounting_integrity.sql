-- REQ-FIN-001/002, REQ-SEC-003: forward-only journal repair; legacy evidence is not rewritten.
ALTER TABLE operations_chart_of_accounts ADD CONSTRAINT coa_tenant_id UNIQUE(tenant_id,id);
ALTER TABLE operations_journal_entries ADD CONSTRAINT journal_tenant_id UNIQUE(tenant_id,id),
  ADD COLUMN posting_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN customer_entry_id uuid,
  ADD COLUMN reverses_journal_id uuid,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_payload jsonb,
  ADD CONSTRAINT journal_customer_source FOREIGN KEY(tenant_id,customer_entry_id)
    REFERENCES operations_customer_account_entries(tenant_id,id),
  ADD CONSTRAINT journal_reversal_source FOREIGN KEY(tenant_id,reverses_journal_id)
    REFERENCES operations_journal_entries(tenant_id,id),
  ADD CONSTRAINT journal_customer_once UNIQUE(tenant_id,customer_entry_id),
  ADD CONSTRAINT journal_reversal_once UNIQUE(tenant_id,reverses_journal_id),
  ADD CONSTRAINT journal_request_once UNIQUE(tenant_id,idempotency_key);
-- NOT VALID preserves suspect legacy evidence while enforcing all new writes.
ALTER TABLE operations_journal_lines ADD CONSTRAINT journal_line_tenant_entry
  FOREIGN KEY(tenant_id,journal_entry_id) REFERENCES operations_journal_entries(tenant_id,id) NOT VALID,
  ADD CONSTRAINT journal_line_tenant_account FOREIGN KEY(tenant_id,account_id)
    REFERENCES operations_chart_of_accounts(tenant_id,id) NOT VALID,
  ADD CONSTRAINT journal_line_one_side CHECK((debit_minor>0 AND credit_minor=0)
    OR (credit_minor>0 AND debit_minor=0)) NOT VALID,
  ADD CONSTRAINT journal_line_safe_money CHECK(debit_minor<=9007199254740991
    AND credit_minor<=9007199254740991) NOT VALID;
ALTER TABLE operations_accounting_periods
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_payload jsonb,
  ADD CONSTRAINT accounting_close_request UNIQUE(tenant_id,idempotency_key),
  ADD CONSTRAINT accounting_period_dates CHECK(start_date<=end_date) NOT VALID;

CREATE FUNCTION accounting_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
   AND c.support_grant_id IS NULL AND c.permission IN
     ('tenant.accounting.view','tenant.accounting.post','tenant.accounting.close')
   AND operations_scope_allows(target_tenant))
$$;
DROP POLICY tenant_isolation_coa ON operations_chart_of_accounts;
DROP POLICY tenant_isolation_journal_entries ON operations_journal_entries;
DROP POLICY tenant_isolation_journal_lines ON operations_journal_lines;
DROP POLICY tenant_isolation_accounting_periods ON operations_accounting_periods;
CREATE POLICY accounting_coa_scope ON operations_chart_of_accounts
  USING(accounting_scope_allows(tenant_id));
CREATE POLICY accounting_journal_scope ON operations_journal_entries
  USING(accounting_scope_allows(tenant_id));
CREATE POLICY accounting_lines_scope ON operations_journal_lines
  USING(accounting_scope_allows(tenant_id));
CREATE POLICY accounting_period_scope ON operations_accounting_periods
  USING(accounting_scope_allows(tenant_id));
GRANT SELECT ON operations_chart_of_accounts,operations_journal_entries,
  operations_journal_lines,operations_accounting_periods TO orvex_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON operations_chart_of_accounts,operations_journal_entries,
  operations_journal_lines,operations_accounting_periods FROM orvex_runtime;
REVOKE ALL ON FUNCTION seed_tenant_default_chart_of_accounts(uuid) FROM PUBLIC,orvex_runtime;
-- Old seed is now internal-only; it cannot be used by runtime to mutate another tenant.

CREATE FUNCTION append_accounting_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed accounting authority required';
 END IF;
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,after_value)
 VALUES(c.tenant_id,c.action,TG_TABLE_NAME,NEW.id::text,c.actor_id,c.session_id,c.permission,
   c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE FUNCTION guard_new_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':accounting-period',0));
 IF NEW.posting_version<>'v2' OR NEW.status<>'posted' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='new journals require immutable v2 posting';
 END IF;
 IF EXISTS(SELECT 1 FROM operations_accounting_periods p WHERE p.tenant_id=NEW.tenant_id
   AND p.status<>'open' AND NEW.entry_date BETWEEN p.start_date AND p.end_date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='accounting period is closed';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION validate_journal_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid; target_tenant uuid;
BEGIN
 IF TG_TABLE_NAME='operations_journal_entries' THEN target:=NEW.id; ELSE target:=NEW.journal_entry_id; END IF;
 SELECT tenant_id INTO target_tenant FROM operations_journal_entries WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM operations_journal_lines WHERE journal_entry_id=target)
   OR EXISTS(SELECT 1 FROM operations_journal_lines l JOIN operations_chart_of_accounts a ON a.id=l.account_id
     WHERE l.journal_entry_id=target AND (l.tenant_id<>target_tenant OR a.tenant_id<>target_tenant
       OR (a.currency<>'ANY' AND a.currency<>l.currency) OR NOT a.active))
   OR EXISTS(SELECT 1 FROM operations_journal_lines WHERE journal_entry_id=target GROUP BY currency
     HAVING sum(debit_minor)<>sum(credit_minor) OR sum(debit_minor)>9007199254740991
       OR sum(credit_minor)>9007199254740991) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='journal must balance safely per currency within its tenant';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_new BEFORE INSERT ON operations_journal_entries
 FOR EACH ROW EXECUTE FUNCTION guard_new_journal();
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON operations_journal_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON operations_journal_lines
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();
CREATE TRIGGER journal_audit AFTER INSERT ON operations_journal_entries
 FOR EACH ROW EXECUTE FUNCTION append_accounting_audit();
CREATE TRIGGER accounting_period_audit AFTER INSERT ON operations_accounting_periods
 FOR EACH ROW EXECUTE FUNCTION append_accounting_audit();
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['operations_journal_entries','operations_journal_lines','operations_accounting_periods'] LOOP
   EXECUTE format('CREATE TRIGGER accounting_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation()',relation);
   EXECUTE format('CREATE TRIGGER accounting_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation()',relation);
 END LOOP;
END $$;

-- Invoked only from ledger insertion, once per actual posting, including reversals.
CREATE FUNCTION journal_customer_account_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; journal uuid; parent_journal uuid;
 ar text; cash text; revenue text; advance text; component record;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.actor_id IS DISTINCT FROM NEW.actor_id
   OR c.action IS DISTINCT FROM 'tenant.customer_account.'||NEW.kind
   OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='customer journal requires its signed ledger authority';
 END IF;
 PERFORM seed_tenant_default_chart_of_accounts(NEW.tenant_id);
 INSERT INTO operations_chart_of_accounts(tenant_id,account_code,account_name_en,account_name_ar,
   account_type,currency,is_system) VALUES
   (NEW.tenant_id,'2300','Customer advances USD','دفعات العملاء المقدمة USD','liability','USD',true),
   (NEW.tenant_id,'2310','Customer advances LBP','دفعات العملاء المقدمة LBP','liability','LBP',true)
 ON CONFLICT(tenant_id,account_code) DO NOTHING;
 ar:=CASE NEW.currency WHEN 'LBP' THEN '1110' ELSE '1100' END;
 cash:=CASE NEW.currency WHEN 'LBP' THEN '1020' ELSE '1010' END;
 revenue:=CASE NEW.currency WHEN 'LBP' THEN '4010' ELSE '4000' END;
 advance:=CASE NEW.currency WHEN 'LBP' THEN '2310' ELSE '2300' END;
 IF NEW.reverses_entry_id IS NOT NULL THEN
   SELECT id INTO parent_journal FROM operations_journal_entries
     WHERE tenant_id=NEW.tenant_id AND customer_entry_id=NEW.reverses_entry_id AND posting_version='v2';
   IF NOT FOUND THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='legacy source requires reviewed opening/reconciliation journal before reversal';
   END IF;
 END IF;
 INSERT INTO operations_journal_entries(tenant_id,entry_number,entry_date,description_en,description_ar,
   source_type,source_id,posted_by,posting_version,customer_entry_id,reverses_journal_id)
 VALUES(NEW.tenant_id,'CA-'||NEW.id::text,(NEW.posted_at AT TIME ZONE 'UTC')::date,
   NEW.reason_en,NEW.reason_ar,CASE WHEN NEW.kind LIKE 'credit%' THEN 'credit_note' ELSE 'deposit' END,
   NEW.id,NEW.actor_id::uuid,'v2',NEW.id,parent_journal) RETURNING id INTO journal;
 IF parent_journal IS NOT NULL THEN
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,credit_minor,currency)
   SELECT journal,tenant_id,account_id,credit_minor,debit_minor,currency
   FROM operations_journal_lines WHERE journal_entry_id=parent_journal;
 ELSIF NEW.kind='credit_note' THEN
   FOR component IN SELECT * FROM (VALUES(revenue,NEW.net_minor),('2200',NEW.vat_minor),
     ('2220',NEW.stamp_minor)) AS amounts(code,amount) WHERE amount>0 LOOP
     INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
       SELECT journal,NEW.tenant_id,id,component.amount,NEW.currency::text
       FROM operations_chart_of_accounts WHERE tenant_id=NEW.tenant_id AND account_code=component.code;
   END LOOP;
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts
       WHERE tenant_id=NEW.tenant_id AND account_code=ar;
 ELSIF NEW.kind IN ('deposit_received','deposit_applied') THEN
   IF NEW.kind='deposit_applied' AND NOT EXISTS(SELECT 1 FROM operations_journal_entries
     WHERE tenant_id=NEW.tenant_id AND customer_entry_id=NEW.source_entry_id AND posting_version='v2') THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='legacy deposit requires reviewed opening/reconciliation journal before allocation';
   END IF;
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts
       WHERE tenant_id=NEW.tenant_id AND account_code=CASE NEW.kind WHEN 'deposit_received' THEN cash ELSE advance END;
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
     SELECT journal,NEW.tenant_id,id,NEW.amount_minor,NEW.currency::text FROM operations_chart_of_accounts
       WHERE tenant_id=NEW.tenant_id AND account_code=CASE NEW.kind WHEN 'deposit_received' THEN advance ELSE ar END;
 ELSE
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='unsupported customer journal kind';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_account_journal AFTER INSERT ON operations_customer_account_entries
 FOR EACH ROW EXECUTE FUNCTION journal_customer_account_entry();

CREATE FUNCTION post_manual_accounting_journal(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; existing operations_journal_entries%ROWTYPE;
 journal uuid; line jsonb;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF NOT accounting_scope_allows(c.tenant_id) OR c.permission<>'tenant.accounting.post'
   OR c.action<>'tenant.accounting.journal.post' OR (payload->>'sourceType') IS DISTINCT FROM 'manual'
   OR payload->>'sourceId' IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='unrestricted signed manual-journal permission required';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':manual:'||c.idempotency_key,0));
 SELECT * INTO existing FROM operations_journal_entries
   WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
   IF existing.request_payload IS DISTINCT FROM payload THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='journal idempotency conflict';
   END IF;
   RETURN existing.id;
 END IF;
 PERFORM seed_tenant_default_chart_of_accounts(c.tenant_id);
 IF jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array' OR coalesce(jsonb_array_length(payload->'lines'),0) NOT BETWEEN 2 AND 200 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='journal requires 2 to 200 lines';
 END IF;
 INSERT INTO operations_journal_entries(tenant_id,entry_number,entry_date,description_en,description_ar,
   source_type,posted_by,posting_version,idempotency_key,request_payload)
 VALUES(c.tenant_id,payload->>'entryNumber',(payload->>'entryDate')::date,
   payload->>'descriptionEn',payload->>'descriptionAr','manual',c.actor_id::uuid,'v2',c.idempotency_key,payload)
 RETURNING id INTO journal;
 FOR line IN SELECT * FROM jsonb_array_elements(payload->'lines') LOOP
   INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,credit_minor,currency,memo_en,memo_ar)
   VALUES(journal,c.tenant_id,(line->>'accountId')::uuid,(line->>'debitMinor')::bigint,
     (line->>'creditMinor')::bigint,line->>'currency',line->>'memoEn',line->>'memoAr');
 END LOOP;
 RETURN journal;
END $$;

CREATE FUNCTION close_accounting_period(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; existing operations_accounting_periods%ROWTYPE; period uuid;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF NOT accounting_scope_allows(c.tenant_id) OR c.permission<>'tenant.accounting.close'
   OR c.action<>'tenant.accounting.period.close' THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='unrestricted signed period-close permission required';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':accounting-period',0));
 SELECT * INTO existing FROM operations_accounting_periods WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
   IF existing.request_payload IS DISTINCT FROM payload THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='period-close idempotency conflict';
   END IF;
   RETURN existing.id;
 END IF;
 IF coalesce(payload->>'closeType','') NOT IN ('soft','hard')
   OR (payload->>'startDate') IS NULL OR (payload->>'endDate') IS NULL
   OR (payload->>'startDate')::date>(payload->>'endDate')::date THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='invalid accounting close dates or type';
 END IF;
 -- Do not certify a partial legacy ledger as a complete closed period.
 IF EXISTS(SELECT 1 FROM operations_journal_entries WHERE tenant_id=c.tenant_id AND posting_version='legacy')
   OR EXISTS(SELECT 1 FROM finance_invoices i WHERE i.tenant_id=c.tenant_id
     AND i.posted_at<(payload->>'endDate')::date+interval '1 day'
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=i.tenant_id
       AND j.source_type='invoice' AND j.source_id=i.id AND j.posting_version='v2')) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='period close blocked: invoice/legacy accounting coverage needs reconciliation';
 END IF;
 IF EXISTS(SELECT 1 FROM operations_accounting_periods WHERE tenant_id=c.tenant_id
   AND start_date<=(payload->>'endDate')::date AND end_date>=(payload->>'startDate')::date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='accounting periods may not overlap';
 END IF;
 INSERT INTO operations_accounting_periods(tenant_id,period_name,start_date,end_date,status,closed_at,
   closed_by,idempotency_key,request_payload)
 VALUES(c.tenant_id,payload->>'periodName',(payload->>'startDate')::date,(payload->>'endDate')::date,
   CASE payload->>'closeType' WHEN 'hard' THEN 'hard_closed' ELSE 'soft_closed' END,
   clock_timestamp(),c.actor_id::uuid,c.idempotency_key,payload) RETURNING id INTO period;
 RETURN period;
END $$;
REVOKE ALL ON FUNCTION accounting_scope_allows(uuid),append_accounting_audit(),guard_new_journal(),
 validate_journal_balance(),journal_customer_account_entry(),post_manual_accounting_journal(jsonb),
 close_accounting_period(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting_scope_allows(uuid),post_manual_accounting_journal(jsonb),
 close_accounting_period(jsonb) TO orvex_runtime;
-- Coverage checks must not be hidden by the invoice table's billing-specific RLS policy.
CREATE FUNCTION accounting_has_unjournaled_invoices(target_tenant uuid,as_of date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT accounting_scope_allows(target_tenant) AND EXISTS(
   SELECT 1 FROM finance_invoices i WHERE i.tenant_id=target_tenant
     AND i.posted_at<((as_of+1)::timestamp AT TIME ZONE 'UTC')
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=i.tenant_id
       AND j.source_type='invoice' AND j.source_id=i.id AND j.posting_version='v2'))
$$;
REVOKE ALL ON FUNCTION accounting_has_unjournaled_invoices(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting_has_unjournaled_invoices(uuid,date) TO orvex_runtime;
