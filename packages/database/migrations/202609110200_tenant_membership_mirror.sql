-- 202609110200_tenant_membership_mirror.sql
-- The tenant database keeps a mirror of staff memberships for directory reads (assignees, team
-- members, approvers). Rows mirrored at bootstrap under the legacy key 'administrator' carried a
-- permission snapshot from before the canonical catalogue. This aligns those rows with the
-- canonical owner and administrator presets so directory reads match what the control database
-- grants at sign-in. Other roles are untouched. On a single-database deployment the control
-- migration has already normalised the same rows and this statement changes nothing.

UPDATE tenant_memberships SET role_key='isp_administrator' WHERE role_key='administrator';

UPDATE tenant_memberships SET permissions=ARRAY[
    'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
    'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
    'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
    'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
    'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
    'tenant.installation.view','tenant.installation.manage',
    'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
    'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
    'tenant.audit.view']::text[]
WHERE role_key IN ('isp_owner','isp_administrator')
  AND permissions IS DISTINCT FROM ARRAY[
    'tenant.dashboard.view','tenant.subscriber.view','tenant.subscriber.create','tenant.subscriber.edit',
    'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
    'tenant.billing.view','tenant.invoice.create','tenant.invoice.post','tenant.invoice.reverse',
    'tenant.payment.view','tenant.payment.post','tenant.payment.reverse','tenant.collection.view',
    'tenant.collection.reconcile','tenant.accounting.view','tenant.accounting.post','tenant.accounting.close',
    'tenant.installation.view','tenant.installation.manage',
    'tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve',
    'tenant.report.view','tenant.report.export','tenant.user.administer','tenant.secret.manage',
    'tenant.audit.view']::text[];
