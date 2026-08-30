-- orvex:database=control
-- Wave 2: canonical CRM, catalogue, and order permissions.

CREATE OR REPLACE FUNCTION tenant_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public AS $$
  SELECT CASE p_role
    WHEN 'isp_owner' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.installation.view','tenant.installation.manage',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
      'tenant.audit.view']::text[]
    WHEN 'isp_administrator' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.installation.view','tenant.installation.manage',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
      'tenant.audit.view']::text[]
    WHEN 'branch_manager' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.billing.view',
      'tenant.payment.view','tenant.collection.view','tenant.collection.reconcile',
      'tenant.installation.view','tenant.installation.manage','tenant.network.view','tenant.report.view',
      'tenant.report.export','tenant.audit.view']::text[]
    WHEN 'finance_billing' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.catalog.manage',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.report.view','tenant.report.export','tenant.audit.view']::text[]
    WHEN 'cashier' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.billing.view',
      'tenant.payment.view','tenant.payment.post']::text[]
    WHEN 'collector' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.payment.view',
      'tenant.payment.post','tenant.collection.view']::text[]
    WHEN 'network_operator' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.installation.view',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.audit.view']::text[]
    WHEN 'customer_service' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.order.manage','tenant.billing.view',
      'tenant.payment.view','tenant.installation.view','tenant.network.view']::text[]
    WHEN 'installer' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.installation.view',
      'tenant.installation.manage','tenant.network.view']::text[]
    WHEN 'tenant_auditor' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.sales.view','tenant.billing.view',
      'tenant.payment.view','tenant.collection.view','tenant.installation.view','tenant.network.view',
      'tenant.report.view','tenant.report.export','tenant.audit.view']::text[]
    ELSE NULL
  END
$$;

WITH changed AS (
  UPDATE tenant_memberships
  SET permissions=tenant_role_permissions(role_key),authorization_version=authorization_version+1
  WHERE role_key IS NOT NULL
    AND permissions IS DISTINCT FROM tenant_role_permissions(role_key)
  RETURNING tenant_id,user_id
)
UPDATE auth_sessions AS session
SET revoked_at=clock_timestamp(),revoke_reason='canonical_permissions_upgraded'
FROM changed
WHERE session.tenant_id=changed.tenant_id AND session.user_id=changed.user_id
  AND session.audience='tenant' AND session.revoked_at IS NULL;

CREATE FUNCTION sales_permissions_readiness()
RETURNS TABLE(migration_ready boolean,functions_ready boolean,assignments_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608300200_control_sales_permissions.sql'),
    tenant_role_permissions('isp_owner') @> ARRAY[
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage'],
    NOT EXISTS(
      SELECT 1 FROM tenant_memberships
      WHERE role_key IS NOT NULL AND permissions IS DISTINCT FROM tenant_role_permissions(role_key)
    )
$$;

REVOKE ALL ON FUNCTION sales_permissions_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_permissions_readiness() TO orvex_control_runtime;
