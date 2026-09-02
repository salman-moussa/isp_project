-- REQ-FIN-001: reject missing/cross-tenant account references with a scoped denial,
-- not a foreign-key/internal error. Deferred balance validation remains authoritative.
CREATE FUNCTION guard_accounting_line_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account operations_chart_of_accounts%ROWTYPE;
BEGIN
 SELECT * INTO account FROM operations_chart_of_accounts
   WHERE tenant_id=NEW.tenant_id AND id=NEW.account_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM operations_journal_entries
   WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_entry_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='journal account or entry is outside tenant scope';
 END IF;
 IF NOT account.active OR (account.currency<>'ANY' AND account.currency<>NEW.currency) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='account must be active and match journal currency';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_accounting_line_reference() FROM PUBLIC;
CREATE TRIGGER journal_line_reference BEFORE INSERT ON operations_journal_lines
 FOR EACH ROW EXECUTE FUNCTION guard_accounting_line_reference();
-- Invoice-only coverage is insufficient: existing deposits, receipts and allocations also
-- need posted journals before a period may be certified. No historical rows are rewritten.
CREATE FUNCTION accounting_has_unjournaled_sources(target_tenant uuid,as_of date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT accounting_scope_allows(target_tenant) AND (
   accounting_has_unjournaled_invoices(target_tenant,as_of)
   OR EXISTS(SELECT 1 FROM operations_customer_account_entries c
     WHERE c.tenant_id=target_tenant AND c.posted_at<((as_of+1)::timestamp AT TIME ZONE 'UTC')
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=c.tenant_id
       AND j.customer_entry_id=c.id AND j.posting_version='v2'))
   OR EXISTS(SELECT 1 FROM finance_payments p
     WHERE p.tenant_id=target_tenant AND p.posted_at<((as_of+1)::timestamp AT TIME ZONE 'UTC')
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=p.tenant_id
       AND j.source_type='payment' AND j.source_id=p.id AND j.posting_version='v2')
     AND NOT EXISTS(SELECT 1 FROM operations_customer_account_entries c JOIN operations_journal_entries j
       ON j.tenant_id=c.tenant_id AND j.customer_entry_id=c.id AND j.posting_version='v2'
       WHERE c.tenant_id=p.tenant_id AND c.payment_id=p.id AND c.kind IN ('deposit_received','deposit_reversal')))
   OR EXISTS(SELECT 1 FROM finance_payment_allocations a
     WHERE a.tenant_id=target_tenant AND a.posted_at<((as_of+1)::timestamp AT TIME ZONE 'UTC')
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=a.tenant_id
       AND j.source_type='payment' AND j.source_id=a.id AND j.posting_version='v2')
     AND NOT EXISTS(SELECT 1 FROM operations_customer_account_entries c JOIN operations_journal_entries j
       ON j.tenant_id=c.tenant_id AND j.customer_entry_id=c.id AND j.posting_version='v2'
       WHERE c.tenant_id=a.tenant_id AND c.allocation_id=a.id))
 )
$$;
CREATE FUNCTION guard_accounting_close_coverage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF accounting_has_unjournaled_sources(NEW.tenant_id,NEW.end_date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='period close blocked: financial source coverage needs reconciliation';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION accounting_has_unjournaled_sources(uuid,date),guard_accounting_close_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting_has_unjournaled_sources(uuid,date) TO orvex_runtime;
CREATE TRIGGER accounting_close_coverage BEFORE INSERT ON operations_accounting_periods
 FOR EACH ROW EXECUTE FUNCTION guard_accounting_close_coverage();
