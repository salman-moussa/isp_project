-- 202609110400_tenant_membership_mirror_apply.sql
-- 202609110200 aligned the mirrored owner and administrator memberships in the tenant database but
-- ran without a tenant context, so forced row-level security hid every row from it. This repeats
-- the alignment under each tenant's own context through an idempotent function, so the tenant-side
-- directory reads match what the control database grants at sign-in.

CREATE FUNCTION mirror_canonical_admin_memberships() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t record; changed integer := 0; n integer;
  canonical text[] := ARRAY[
    'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
    'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
    'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
    'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
    'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
    'tenant.installation.view','tenant.installation.manage',
    'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
    'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
    'tenant.audit.view']::text[];
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE tenant_memberships SET role_key='isp_administrator'
      WHERE tenant_id=t.id AND role_key='administrator';
    UPDATE tenant_memberships SET permissions=canonical
      WHERE tenant_id=t.id AND role_key IN ('isp_owner','isp_administrator')
        AND permissions IS DISTINCT FROM canonical;
    GET DIAGNOSTICS n = ROW_COUNT;
    changed := changed + n;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION mirror_canonical_admin_memberships() FROM PUBLIC;

SELECT mirror_canonical_admin_memberships();
