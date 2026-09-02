-- PRD-FIN-004 / PRD-LOC-004: explicit tax eligibility and immutable bilingual invoice artifacts.
ALTER TABLE operations_billing_policies
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable'
    CHECK(tax_treatment IN ('taxable','exempt','out_of_scope')),
  ADD COLUMN tax_reason_en text,
  ADD COLUMN tax_reason_ar text,
  ADD COLUMN tax_authority_reference text,
  ADD CONSTRAINT operations_billing_policies_tax_eligibility_check CHECK(
    (tax_treatment='taxable' AND tax_reason_en IS NULL AND tax_reason_ar IS NULL
      AND tax_authority_reference IS NULL)
    OR
    (tax_treatment IN ('exempt','out_of_scope') AND vat_rate_basis_points=0
      AND tax_reason_en IS NOT NULL AND tax_reason_ar IS NOT NULL
      AND tax_authority_reference IS NOT NULL
      AND length(btrim(tax_reason_en)) BETWEEN 8 AND 500
      AND length(btrim(tax_reason_ar)) BETWEEN 8 AND 500
      AND length(btrim(tax_authority_reference)) BETWEEN 3 AND 200)
  );

ALTER TABLE operations_invoice_preparations
  ADD CONSTRAINT invoice_preparation_document_identity UNIQUE(tenant_id,id,finance_invoice_id);

CREATE TABLE operations_invoice_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  finance_invoice_id uuid NOT NULL,
  invoice_preparation_id uuid NOT NULL,
  renderer_version text NOT NULL CHECK(length(btrim(renderer_version)) BETWEEN 1 AND 80),
  locale text NOT NULL DEFAULT 'bilingual' CHECK(locale='bilingual'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
  storage_key text,
  sha256 text CHECK(sha256 IS NULL OR sha256~'^[0-9a-f]{64}$'),
  size_bytes bigint CHECK(size_bytes IS NULL OR size_bytes BETWEEN 1 AND 26214400),
  content_type text CHECK(content_type IS NULL OR content_type='application/pdf'),
  retention_until date NOT NULL,
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key))>=8),
  request_fingerprint text NOT NULL CHECK(request_fingerprint~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,finance_invoice_id,renderer_version,locale),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,finance_invoice_id) REFERENCES finance_invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_preparation_id,finance_invoice_id)
    REFERENCES operations_invoice_preparations(tenant_id,id,finance_invoice_id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES tenant_memberships(tenant_id,user_id),
  CHECK(
    (status='pending' AND storage_key IS NULL AND sha256 IS NULL AND size_bytes IS NULL
      AND content_type IS NULL AND completed_at IS NULL)
    OR
    (status='ready' AND storage_key IS NOT NULL AND content_type IS NOT NULL
      AND storage_key='tenants/'||tenant_id::text||'/invoices/'||id::text||'.pdf'
      AND length(btrim(storage_key)) BETWEEN 8 AND 1000
      AND sha256 IS NOT NULL AND size_bytes IS NOT NULL
      AND content_type='application/pdf' AND completed_at IS NOT NULL)
  )
);
CREATE INDEX operations_invoice_documents_archive_idx
  ON operations_invoice_documents(tenant_id,retention_until,created_at DESC);

ALTER TABLE operations_invoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY operations_invoice_documents_scope ON operations_invoice_documents
  USING(EXISTS(SELECT 1 FROM operations_invoice_preparations preparation
    WHERE preparation.tenant_id=operations_invoice_documents.tenant_id
      AND preparation.id=operations_invoice_documents.invoice_preparation_id
      AND operations_scope_allows(preparation.tenant_id,preparation.branch_id,
        preparation.area_id,preparation.route_id,preparation.service_id)))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_invoice_preparations preparation
    WHERE preparation.tenant_id=operations_invoice_documents.tenant_id
      AND preparation.id=operations_invoice_documents.invoice_preparation_id
      AND operations_scope_allows(preparation.tenant_id,preparation.branch_id,
        preparation.area_id,preparation.route_id,preparation.service_id)));

CREATE FUNCTION validate_invoice_document_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' OR NOT EXISTS(
      SELECT 1 FROM operations_invoice_preparations preparation
      WHERE preparation.tenant_id=NEW.tenant_id AND preparation.id=NEW.invoice_preparation_id
        AND preparation.finance_invoice_id=NEW.finance_invoice_id
        AND preparation.posting_status='posted' AND preparation.legal_invoice_snapshot IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invoice documents require a posted legal snapshot';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invoice document archives are immutable';
  END IF;
  IF OLD.status<>'pending' OR NEW.status<>'ready' OR NEW.id<>OLD.id
    OR NEW.tenant_id<>OLD.tenant_id OR NEW.finance_invoice_id<>OLD.finance_invoice_id
    OR NEW.invoice_preparation_id<>OLD.invoice_preparation_id
    OR NEW.renderer_version<>OLD.renderer_version OR NEW.locale<>OLD.locale
    OR NEW.retention_until<>OLD.retention_until OR NEW.requested_by<>OLD.requested_by
    OR NEW.idempotency_key<>OLD.idempotency_key
    OR NEW.request_fingerprint<>OLD.request_fingerprint OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='invalid invoice document archive transition';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION append_invoice_document_audit_outbox() RETURNS trigger
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
  IF TG_OP='INSERT' AND ((row_value->>'requested_by')::uuid<>context_row.actor_id
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

CREATE TRIGGER operations_invoice_documents_transition
BEFORE INSERT OR UPDATE OR DELETE ON operations_invoice_documents
FOR EACH ROW EXECUTE FUNCTION validate_invoice_document_transition();
CREATE TRIGGER operations_invoice_documents_no_truncate
BEFORE TRUNCATE ON operations_invoice_documents
FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER operations_invoice_documents_audit
AFTER INSERT OR UPDATE OR DELETE ON operations_invoice_documents
FOR EACH ROW EXECUTE FUNCTION append_invoice_document_audit_outbox();

GRANT SELECT,INSERT ON operations_invoice_documents TO orvex_runtime;
GRANT UPDATE(status,storage_key,sha256,size_bytes,content_type,completed_at)
  ON operations_invoice_documents TO orvex_runtime;

CREATE FUNCTION invoice_document_readiness()
RETURNS TABLE(migration_ready boolean,tax_ready boolean,archive_ready boolean,audit_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202609021100_tenant_invoice_documents.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_billing_policies'
        AND column_name='tax_treatment'),
    to_regclass('public.operations_invoice_documents') IS NOT NULL,
    to_regprocedure('public.append_invoice_document_audit_outbox()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION validate_invoice_document_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION append_invoice_document_audit_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION invoice_document_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invoice_document_readiness() TO orvex_runtime;
