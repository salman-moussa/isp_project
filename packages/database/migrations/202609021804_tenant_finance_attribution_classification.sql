-- REQ-SEC-003/FIN-002: signed audit attribution and date-correct classification checks.
CREATE OR REPLACE FUNCTION guard_finance_accounting_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; permitted boolean:=false;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS DISTINCT FROM NEW.tenant_id OR c.actor_id IS DISTINCT FROM NEW.actor_id
   OR c.support_grant_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='financial posting requires signed tenant actor context';
 END IF;
 IF c.session_id IS DISTINCT FROM nullif(current_setting('app.finance_session_id',true),'')
   OR c.request_id IS DISTINCT FROM nullif(current_setting('app.finance_request_id',true),'') THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='finance audit attribution must match signed request';
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

CREATE FUNCTION accounting_has_unclassified_entries(target_tenant uuid,as_of date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT accounting_scope_allows(target_tenant) AND EXISTS(
   SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=target_tenant AND j.entry_date<=as_of
     AND j.classification_required AND j.reverses_journal_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries r WHERE r.tenant_id=j.tenant_id
       AND r.reverses_journal_id=j.id AND r.entry_date<=as_of))
$$;
REVOKE ALL ON FUNCTION accounting_has_unclassified_entries(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting_has_unclassified_entries(uuid,date) TO orvex_runtime;
CREATE OR REPLACE FUNCTION guard_accounting_close_coverage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF accounting_has_unjournaled_sources(NEW.tenant_id,NEW.end_date)
   OR accounting_has_unclassified_entries(NEW.tenant_id,NEW.end_date) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='period close blocked: financial source coverage or classification needs reconciliation';
 END IF;
 RETURN NEW;
END $$;
