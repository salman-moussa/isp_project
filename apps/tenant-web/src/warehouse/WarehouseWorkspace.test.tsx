import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryCustodyCommand, WarehouseWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';
import * as api from '../api';
import { WarehouseWorkspace } from './WarehouseWorkspace';

vi.mock('../api', () => ({ readWarehouseWorkspace: vi.fn(), submitTenantOperation: vi.fn() }));

const tenantId = '10000000-0000-4000-8000-000000000001';
const warehouseId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const itemId = '40000000-0000-4000-8000-000000000001';
const installationId = '50000000-0000-4000-8000-000000000001';
const serviceId = '60000000-0000-4000-8000-000000000001';
const installerId = '70000000-0000-4000-8000-000000000001';
const session: ApiSession = {
  apiBaseUrl: 'https://example.test',
  tenantId,
  accessToken: 'test',
  refreshToken: 'test',
  logout: vi.fn(),
};
const fixture: Workspace = {
  warehouses: [
    {
      id: warehouseId,
      branchId: null,
      warehouseCode: 'BEY-01',
      nameEn: 'Beirut warehouse',
      nameAr: 'مستودع بيروت',
      locationAddress: 'Beirut',
      isPrimary: true,
      active: true,
    },
  ],
  items: [
    {
      id: itemId,
      sku: 'CPE-AX',
      nameEn: 'Wi-Fi 6 CPE',
      nameAr: 'جهاز واي فاي 6',
      category: 'router_cpe',
      unitCostMinorUsd: 5000,
      unitCostMinorLbp: 0,
      serializedFlag: true,
      reorderThreshold: 5,
    },
  ],
  assets: [
    {
      id: assetId,
      itemId,
      serialNumber: 'ORX-0001',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      warehouseId,
      currentCustodianId: null,
      installedServiceId: null,
      status: 'in_stock',
      version: 1,
      sku: 'CPE-AX',
      itemNameEn: 'Wi-Fi 6 CPE',
      itemNameAr: 'جهاز واي فاي 6',
      warehouseCode: 'BEY-01',
      custodianName: null,
      serviceNumber: null,
      installationId: null,
      events: [],
    },
  ],
  installations: [
    {
      id: installationId,
      serviceId,
      serviceNumber: 'SVC-101',
      subscriberName: 'Maya Customer',
      installerUserId: installerId,
      installerName: 'Ali Installer',
    },
  ],
  vendors: [
    {
      id: '80000000-0000-4000-8000-000000000001',
      vendorCode: 'V-001',
      nameEn: 'Fiber supplier',
      nameAr: 'مورد الألياف',
      contactName: null,
      contactPhone: null,
      active: true,
    },
  ],
  purchaseOrders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readWarehouseWorkspace).mockResolvedValue(fixture);
  vi.mocked(api.submitTenantOperation).mockResolvedValue({
    id: assetId,
    status: 'issued',
    version: 2,
  });
});

describe('Warehouse custody workspace', () => {
  it('requires an authenticated tenant session', () => {
    render(<WarehouseWorkspace locale="en" />);
    expect(screen.getByRole('heading', { name: 'Sign in to open Warehouse' })).toBeVisible();
    expect(api.readWarehouseWorkspace).not.toHaveBeenCalled();
  });

  it('issues a real serialized asset to an installation with bilingual evidence', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: /ORX-0001/ }));
    await user.click(screen.getByRole('button', { name: 'Issue to installation' }));
    await user.selectOptions(
      screen.getByLabelText('Installation with assigned technician'),
      installationId,
    );
    await user.type(
      screen.getByLabelText('Reason in English'),
      'Assigned for customer installation',
    );
    await user.type(screen.getByLabelText('Reason in Arabic'), 'تم التسليم لتركيب خدمة العميل');
    await user.type(
      screen.getByLabelText('Verification evidence'),
      'Serial and seal verified at handoff',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm handoff' }));
    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalledOnce());
    const [sentSession, path, payload, key] =
      vi.mocked(api.submitTenantOperation).mock.calls[0] ?? [];
    expect(sentSession).toBe(session);
    expect(path).toBe('warehouse/custody');
    expect(key).toEqual(expect.any(String));
    expect((payload as { command: Partial<InventoryCustodyCommand> }).command).toMatchObject({
      assetId,
      expectedVersion: 1,
      action: 'issue',
      installationId,
      custodianUserId: installerId,
    });
  });

  it('creates a valued serialized purchase-order draft from the guided form', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const form = (await screen.findByRole('heading', { name: '2. Create purchase order' })).closest(
      'form',
    );
    expect(form).not.toBeNull();
    const controls = within(form!);
    await user.type(controls.getByLabelText('PO number'), 'PO-2026-001');
    await user.selectOptions(
      controls.getByLabelText('Supplier'),
      '80000000-0000-4000-8000-000000000001',
    );
    await user.selectOptions(controls.getByLabelText('Receiving warehouse'), warehouseId);
    await user.selectOptions(controls.getByLabelText('Serialized item'), itemId);
    await user.type(controls.getByLabelText('Quantity'), '2');
    await user.type(controls.getByLabelText('Unit cost (minor)'), '7500');
    await user.type(
      controls.getByLabelText('Procurement reason in English'),
      'Controlled stock replenishment',
    );
    await user.type(
      controls.getByLabelText('Procurement reason in Arabic'),
      'تجديد المخزون بشكل مضبوط',
    );
    await user.type(
      controls.getByLabelText('Procurement evidence / reference'),
      'Approved supplier quotation Q-001',
    );
    await user.click(controls.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalled());
    const call = vi.mocked(api.submitTenantOperation).mock.calls.at(-1);
    expect(call?.[0]).toBe(session);
    expect(call?.[1]).toBe('warehouse/procurement');
    expect(call?.[2].command).toMatchObject({
      action: 'create_purchase_order',
      poNumber: 'PO-2026-001',
      lines: [{ itemId, quantity: 2, unitCostMinor: 7500 }],
    });
    expect(call?.[3]).toEqual(expect.any(String));
  });
});
