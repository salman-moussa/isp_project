-- REQ-FIN-001/002: classify clearing entries via an explicit, balanced, audited correction.
CREATE TABLE operations_accounting_classifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 source_journal_id uuid NOT NULL,
 correction_journal_id uuid NOT NULL,
 actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,source_journal_id),
 UNIQUE(tenant_id,correction_journal_id),
 FOREIGN KEY(tenant_id,source_journal_id) REFERENCES operations_journal_entries(tenant_id,id),
 FOREIGN KEY(tenant_id,correction_journal_id) REFERENCES operations_journal_entries(tenant_id,id)
);
ALTER TABLE operations_accounting_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_accounting_classifications FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_classification_read ON operations_accounting_classifications
 USING(accounting_scope_allows(tenant_id));
CREATE POLICY accounting_classification_owner ON operations_accounting_classifications TO orvex_owner
 USING(EXISTS(SELECT 1 FROM operations_current_context() c
   WHERE c.tenant_id=operations_accounting_classifications.tenant_id AND c.support_grant_id IS NULL));
GRANT SELECT ON operations_accounting_classifications TO orvex_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON operations_accounting_classifications FROM orvex_runtime;
CREATE TRIGGER accounting_classification_immutable BEFORE UPDATE OR DELETE ON operations_accounting_classifications
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER accounting_classification_no_truncate BEFORE TRUNCATE ON operations_accounting_classifications
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER accounting_classification_audit AFTER INSERT ON operations_accounting_classifications
 FOR EACH ROW EXECUTE FUNCTION append_accounting_audit();

CREATE FUNCTION classify_accounting_journal(source_id uuid,correction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; source operations_journal_entries%ROWTYPE;
 correction operations_journal_entries%ROWTYPE;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF NOT accounting_scope_allows(c.tenant_id) OR c.permission<>'tenant.accounting.post'
   OR c.action<>'tenant.accounting.journal.post' THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed accounting posting authority required';
 END IF;
 SELECT * INTO source FROM operations_journal_entries WHERE tenant_id=c.tenant_id AND id=source_id;
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
REVOKE ALL ON FUNCTION classify_accounting_journal(uuid,uuid) FROM PUBLIC,orvex_runtime;

CREATE OR REPLACE FUNCTION accounting_has_unclassified_entries(target_tenant uuid,as_of date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT accounting_scope_allows(target_tenant) AND EXISTS(
   SELECT 1 FROM operations_journal_entries j WHERE j.tenant_id=target_tenant AND j.entry_date<=as_of
     AND j.classification_required AND j.reverses_journal_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM operations_journal_entries r WHERE r.tenant_id=j.tenant_id
       AND r.reverses_journal_id=j.id AND r.entry_date<=as_of)
     AND NOT EXISTS(SELECT 1 FROM operations_accounting_classifications c JOIN operations_journal_entries r
       ON r.tenant_id=c.tenant_id AND r.id=c.correction_journal_id
       WHERE c.tenant_id=j.tenant_id AND c.source_journal_id=j.id AND r.entry_date<=as_of))
$$;
CREATE OR REPLACE FUNCTION post_manual_accounting_journal(payload jsonb) RETURNS uuid
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
 IF payload->>'classifiesJournalId' IS NOT NULL THEN
   PERFORM classify_accounting_journal((payload->>'classifiesJournalId')::uuid,journal);
 END IF;
 RETURN journal;
END $$;
