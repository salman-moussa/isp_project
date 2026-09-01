-- PRD-FIN-004: owner-approved legal invoice identity, discounts, stamp duty and retention.
ALTER TABLE operations_billing_policies
  ADD COLUMN supplier_name_en text,
  ADD COLUMN supplier_name_ar text,
  ADD COLUMN supplier_address_en text,
  ADD COLUMN supplier_address_ar text,
  ADD COLUMN supplier_tax_registration_number text,
  ADD COLUMN stamp_duty_usd_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN stamp_duty_lbp_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN retention_years integer,
  ADD CONSTRAINT operations_billing_policies_stamp_check CHECK(
    stamp_duty_usd_minor>=0 AND stamp_duty_lbp_minor>=0
  ),
  ADD CONSTRAINT operations_billing_policies_legal_identity_check CHECK(
    (supplier_name_en IS NULL AND supplier_name_ar IS NULL
      AND supplier_address_en IS NULL AND supplier_address_ar IS NULL
      AND supplier_tax_registration_number IS NULL AND retention_years IS NULL)
    OR
    (length(btrim(supplier_name_en)) BETWEEN 1 AND 200
      AND length(btrim(supplier_name_ar)) BETWEEN 1 AND 200
      AND length(btrim(supplier_address_en)) BETWEEN 1 AND 500
      AND length(btrim(supplier_address_ar)) BETWEEN 1 AND 500
      AND length(btrim(supplier_tax_registration_number)) BETWEEN 1 AND 100
      AND retention_years BETWEEN 1 AND 50)
  );

-- Keep legacy preparations readable while every new preparation receives the complete amount and
-- legal document snapshot. Stamp duty is added after VAT and never converted between currencies.
ALTER TABLE operations_invoice_preparations DROP COLUMN total_minor;
ALTER TABLE operations_invoice_preparations
  ADD COLUMN gross_amount_minor bigint,
  ADD COLUMN discount_basis_points integer NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN stamp_duty_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN legal_invoice_snapshot jsonb;
ALTER TABLE operations_invoice_preparations DISABLE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations
  DISABLE TRIGGER operations_invoice_preparations_audit_outbox;
UPDATE operations_invoice_preparations SET gross_amount_minor=subtotal_minor
WHERE gross_amount_minor IS NULL;
ALTER TABLE operations_invoice_preparations
  ENABLE TRIGGER operations_invoice_preparations_audit_outbox;
ALTER TABLE operations_invoice_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations
  ALTER COLUMN gross_amount_minor SET NOT NULL,
  ADD COLUMN total_minor bigint GENERATED ALWAYS AS
    (subtotal_minor+vat_minor+stamp_duty_minor) STORED,
  DROP CONSTRAINT operations_invoice_preparations_rating_amounts_check,
  ADD CONSTRAINT operations_invoice_preparations_legal_amounts_check CHECK(
    base_amount_minor>0 AND addon_amount_minor>=0 AND overage_amount_minor>=0
    AND gross_amount_minor=base_amount_minor+addon_amount_minor+overage_amount_minor
    AND discount_basis_points BETWEEN 0 AND 3000
    AND discount_amount_minor>=0 AND discount_amount_minor<gross_amount_minor
    AND subtotal_minor=gross_amount_minor-discount_amount_minor
    AND stamp_duty_minor>=0
  ),
  ADD CONSTRAINT operations_invoice_preparations_legal_snapshot_check CHECK(
    legal_invoice_snapshot IS NULL OR (
      jsonb_typeof(legal_invoice_snapshot)='object'
      AND legal_invoice_snapshot ?& ARRAY['supplier','recipient','invoice','service','amounts','tax']
      AND NOT operations_json_contains_secret_key(legal_invoice_snapshot)
    )
  );

CREATE FUNCTION legal_invoice_policy_readiness()
RETURNS TABLE(migration_ready boolean,policy_ready boolean,invoice_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202609020900_tenant_legal_invoice_policy.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_billing_policies'
        AND column_name='supplier_tax_registration_number'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_invoice_preparations'
        AND column_name='legal_invoice_snapshot')
$$;
REVOKE ALL ON FUNCTION legal_invoice_policy_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION legal_invoice_policy_readiness() TO orvex_runtime;
