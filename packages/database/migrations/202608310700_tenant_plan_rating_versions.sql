-- PRD-FIN-004 / PRD-NET-002: one effective plan version drives commercial and network truth.
ALTER TABLE operations_plan_versions
  ADD COLUMN access_technology text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN downstream_mbps integer NOT NULL DEFAULT 1,
  ADD COLUMN upstream_mbps integer NOT NULL DEFAULT 1,
  ADD COLUMN quota_gb bigint,
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'postpaid',
  ADD COLUMN proration_mode text NOT NULL DEFAULT 'daily',
  ADD COLUMN fup_policy jsonb NOT NULL DEFAULT '{"mode":"none"}'::jsonb,
  ADD COLUMN included_addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN overage_per_gb_minor bigint,
  ADD CONSTRAINT operations_plan_versions_access_technology_check
    CHECK(length(btrim(access_technology)) BETWEEN 1 AND 80),
  ADD CONSTRAINT operations_plan_versions_speed_check
    CHECK(downstream_mbps BETWEEN 1 AND 1000000 AND upstream_mbps BETWEEN 1 AND 1000000),
  ADD CONSTRAINT operations_plan_versions_quota_check CHECK(quota_gb IS NULL OR quota_gb>0),
  ADD CONSTRAINT operations_plan_versions_billing_mode_check
    CHECK(billing_mode IN ('prepaid','postpaid')),
  ADD CONSTRAINT operations_plan_versions_proration_mode_check
    CHECK(proration_mode IN ('none','daily')),
  ADD CONSTRAINT operations_plan_versions_fup_policy_check CHECK(
    jsonb_typeof(fup_policy)='object'
    AND fup_policy->>'mode' IN ('none','throttle','cap','bill')
    AND NOT operations_json_contains_secret_key(fup_policy)
  ),
  ADD CONSTRAINT operations_plan_versions_included_addons_check CHECK(
    jsonb_typeof(included_addons)='array'
    AND NOT operations_json_contains_secret_key(included_addons)
  ),
  ADD CONSTRAINT operations_plan_versions_overage_check CHECK(
    (fup_policy->>'mode'='bill')=(overage_per_gb_minor IS NOT NULL)
    AND (overage_per_gb_minor IS NULL OR overage_per_gb_minor>0)
  );

ALTER TABLE operations_invoice_preparations
  ADD COLUMN base_amount_minor bigint,
  ADD COLUMN addon_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN overage_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN rating_snapshot jsonb NOT NULL DEFAULT '{"source":"legacy"}'::jsonb;
-- Forced RLS correctly hides historical tenant rows from the migration owner. Temporarily
-- remove it inside this transaction so every existing preparation receives its base split.
ALTER TABLE operations_invoice_preparations DISABLE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations
  DISABLE TRIGGER operations_invoice_preparations_audit_outbox;
UPDATE operations_invoice_preparations SET base_amount_minor=subtotal_minor
WHERE base_amount_minor IS NULL;
ALTER TABLE operations_invoice_preparations
  ENABLE TRIGGER operations_invoice_preparations_audit_outbox;
ALTER TABLE operations_invoice_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_invoice_preparations
  ALTER COLUMN base_amount_minor SET NOT NULL,
  ADD CONSTRAINT operations_invoice_preparations_rating_amounts_check CHECK(
    base_amount_minor>0 AND addon_amount_minor>=0 AND overage_amount_minor>=0
    AND subtotal_minor=base_amount_minor+addon_amount_minor+overage_amount_minor
  ),
  ADD CONSTRAINT operations_invoice_preparations_rating_snapshot_check CHECK(
    jsonb_typeof(rating_snapshot)='object'
    AND NOT operations_json_contains_secret_key(rating_snapshot)
  );

CREATE FUNCTION plan_rating_version_readiness()
RETURNS TABLE(migration_ready boolean,plan_columns_ready boolean,invoice_snapshot_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202608310700_tenant_plan_rating_versions.sql'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_plan_versions'
        AND column_name='fup_policy'),
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='operations_invoice_preparations'
        AND column_name='rating_snapshot')
$$;
REVOKE ALL ON FUNCTION plan_rating_version_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plan_rating_version_readiness() TO orvex_runtime;
