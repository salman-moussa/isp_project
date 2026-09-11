-- orvex:database=control
-- Canonical role presets catch up with the contracts catalogue: the accounting permissions
-- (tenant.accounting.view / post / close) join the owner, administrator and finance presets, so
-- staff created or re-assigned through the product reach the accounting workspace without an
-- out-of-band grant. Legacy bootstrap memberships keyed 'administrator' become the canonical
-- 'isp_administrator' role, every membership is re-synchronised with its preset, and the sessions
-- of changed members end so the new authorization version is picked up at the next sign-in.
-- MFA flags are left untouched: enrolment stays a product action, never a migration side effect.

CREATE OR REPLACE FUNCTION tenant_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public AS $$
  SELECT CASE p_role
    WHEN 'isp_owner' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
      'tenant.installation.view','tenant.installation.manage',
      'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
      'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
      'tenant.audit.view']::text[]
    WHEN 'isp_administrator' THEN ARRAY[
      'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
      'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
      'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
      'tenant.installation.view','tenant.installation.manage',
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
      'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
      'tenant.report.view','tenant.report.export','tenant.audit.view']::text[]
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

-- Legacy bootstrap memberships used the non-canonical key 'administrator'.
UPDATE tenant_memberships SET role_key='isp_administrator' WHERE role_key='administrator';

WITH changed AS (
  UPDATE tenant_memberships
  SET permissions=tenant_role_permissions(role_key),authorization_version=authorization_version+1
  WHERE role_key IS NOT NULL
    AND tenant_role_permissions(role_key) IS NOT NULL
    AND permissions IS DISTINCT FROM tenant_role_permissions(role_key)
  RETURNING tenant_id,user_id
)
UPDATE auth_sessions AS session
SET revoked_at=clock_timestamp(),revoke_reason='canonical_permissions_upgraded'
FROM changed
WHERE session.tenant_id=changed.tenant_id AND session.user_id=changed.user_id
  AND session.audience='tenant' AND session.revoked_at IS NULL;
