-- Forward-only correction: signed actor references are text, while membership user IDs are UUIDs.
CREATE OR REPLACE FUNCTION append_invoice_document_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE; row_value jsonb;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND OR context_row.permission<>'tenant.invoice.create'
    OR context_row.support_grant_id IS NOT NULL
    OR context_row.action<>'tenant.invoice.document.generate' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed invoice document authority is required';
  END IF;
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF (row_value->>'tenant_id')::uuid<>context_row.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='invoice document tenant mismatch';
  END IF;
  IF TG_OP='INSERT' AND (row_value->>'requested_by'<>context_row.actor_id
    OR row_value->>'idempotency_key'<>context_row.idempotency_key) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='invoice document request authority mismatch';
  END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value
  ) VALUES(
    context_row.tenant_id,context_row.action,'operations_invoice_documents',row_value->>'id',
    context_row.actor_id,context_row.session_id,context_row.support_grant_id,
    context_row.permission,context_row.request_id,context_row.idempotency_key,
    context_row.ip_address,context_row.user_agent,'allowed',context_row.reason,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION invoice_document_readiness()
RETURNS TABLE(migration_ready boolean,tax_ready boolean,archive_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202609021100_tenant_invoice_documents.sql')
      AND EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202609021101_tenant_invoice_document_actor.sql'),
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='operations_billing_policies_tax_eligibility_check'),
    EXISTS(SELECT 1 FROM pg_class WHERE oid='public.operations_invoice_documents'::regclass
      AND relrowsecurity AND relforcerowsecurity),
    3=(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.operations_invoice_documents'::regclass
      AND tgname IN ('operations_invoice_documents_transition','operations_invoice_documents_no_truncate',
        'operations_invoice_documents_audit') AND tgenabled='O' AND NOT tgisinternal)
$$;
