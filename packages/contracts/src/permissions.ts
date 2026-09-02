export const permissions = [
  'platform.client.view',
  'platform.client.manage',
  'platform.subscription.manage',
  'platform.billing.view',
  'platform.billing.post',
  'platform.payment.post',
  'platform.payment.reverse',
  'platform.deployment.manage',
  'platform.support.request',
  'platform.support.approve',
  'platform.audit.view',
  'tenant.dashboard.view',
  'tenant.subscriber.view',
  'tenant.subscriber.create',
  'tenant.subscriber.edit',
  'tenant.sales.view',
  'tenant.sales.manage',
  'tenant.catalog.manage',
  'tenant.order.manage',
  'tenant.billing.view',
  'tenant.invoice.create',
  'tenant.invoice.post',
  'tenant.invoice.reverse',
  'tenant.payment.view',
  'tenant.payment.post',
  'tenant.payment.reverse',
  'tenant.collection.view',
  'tenant.collection.reconcile',
  'tenant.installation.view',
  'tenant.installation.manage',
  'tenant.network.view',
  'tenant.network.job.create',
  'tenant.network.bulk.approve',
  'tenant.report.view',
  'tenant.report.export',
  'tenant.user.administer',
  'tenant.secret.manage',
  'tenant.accounting.view',
  'tenant.accounting.post',
  'tenant.accounting.close',
  'tenant.audit.view',
] as const;

export type Permission = (typeof permissions)[number];

export const permissionSet = new Set<string>(permissions);

export const platformRoles = [
  'platform_owner',
  'platform_administrator',
  'sales_manager',
  'account_manager',
  'platform_finance',
  'deployment_administrator',
  'support_manager',
  'support_agent',
  'platform_auditor',
] as const;

export const tenantRoles = [
  'isp_owner',
  'isp_administrator',
  'branch_manager',
  'finance_billing',
  'cashier',
  'collector',
  'network_operator',
  'customer_service',
  'installer',
  'tenant_auditor',
] as const;

export type PlatformRole = (typeof platformRoles)[number];
export type TenantRole = (typeof tenantRoles)[number];

export interface AuthorizationScope {
  readonly tenantId?: string;
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}
