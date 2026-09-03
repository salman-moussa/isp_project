import { render, screen, waitFor } from '@testing-library/react';
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
});
