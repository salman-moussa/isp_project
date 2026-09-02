import { permissions, type Permission, type TenantRole } from './permissions.js';

export interface TenantRolePreset {
  readonly key: TenantRole;
  readonly permissions: readonly Permission[];
  readonly requiresMfa: boolean;
  readonly scopeMode: 'tenant' | 'branch_area_route';
}

const tenantPermissions = permissions.filter((permission) => permission.startsWith('tenant.'));

/** Canonical presets. Public staff APIs accept a role, never an arbitrary permission array. */
export const tenantRolePresets: Readonly<Record<TenantRole, TenantRolePreset>> = {
  isp_owner: {
    key: 'isp_owner',
    permissions: tenantPermissions,
    requiresMfa: true,
    scopeMode: 'tenant',
  },
  isp_administrator: {
    key: 'isp_administrator',
    permissions: tenantPermissions,
    requiresMfa: true,
    scopeMode: 'tenant',
  },
  branch_manager: {
    key: 'branch_manager',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.subscriber.create',
      'tenant.subscriber.edit',
      'tenant.sales.view',
      'tenant.sales.manage',
      'tenant.order.manage',
      'tenant.billing.view',
      'tenant.payment.view',
      'tenant.collection.view',
      'tenant.collection.reconcile',
      'tenant.installation.view',
      'tenant.installation.manage',
      'tenant.network.view',
      'tenant.report.view',
      'tenant.report.export',
      'tenant.audit.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  finance_billing: {
    key: 'finance_billing',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.catalog.manage',
      'tenant.billing.view',
      'tenant.invoice.create',
      'tenant.invoice.post',
      'tenant.invoice.reverse',
      'tenant.payment.view',
      'tenant.payment.post',
      'tenant.payment.reverse',
      'tenant.collection.view',
      'tenant.collection.reconcile',
      'tenant.accounting.view',
      'tenant.accounting.post',
      'tenant.accounting.close',
      'tenant.report.view',
      'tenant.report.export',
      'tenant.audit.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  cashier: {
    key: 'cashier',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.billing.view',
      'tenant.payment.view',
      'tenant.payment.post',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  collector: {
    key: 'collector',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.payment.view',
      'tenant.payment.post',
      'tenant.collection.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  network_operator: {
    key: 'network_operator',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.installation.view',
      'tenant.network.view',
      'tenant.network.job.create',
      'tenant.network.bulk.approve',
      'tenant.report.view',
      'tenant.audit.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  customer_service: {
    key: 'customer_service',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.subscriber.create',
      'tenant.subscriber.edit',
      'tenant.sales.view',
      'tenant.sales.manage',
      'tenant.order.manage',
      'tenant.billing.view',
      'tenant.payment.view',
      'tenant.installation.view',
      'tenant.network.view',
    ],
    requiresMfa: false,
    scopeMode: 'branch_area_route',
  },
  installer: {
    key: 'installer',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.installation.view',
      'tenant.installation.manage',
      'tenant.network.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
  tenant_auditor: {
    key: 'tenant_auditor',
    permissions: [
      'tenant.dashboard.view',
      'tenant.subscriber.view',
      'tenant.sales.view',
      'tenant.billing.view',
      'tenant.payment.view',
      'tenant.collection.view',
      'tenant.installation.view',
      'tenant.network.view',
      'tenant.report.view',
      'tenant.report.export',
      'tenant.audit.view',
    ],
    requiresMfa: true,
    scopeMode: 'branch_area_route',
  },
};

export function tenantRolePreset(role: TenantRole): TenantRolePreset {
  return tenantRolePresets[role];
}
