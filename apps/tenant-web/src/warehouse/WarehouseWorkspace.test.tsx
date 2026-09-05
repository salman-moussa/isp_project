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
const binId = '90000000-0000-4000-8000-000000000001';
const branchId = 'b0000000-0000-4000-8000-000000000001';
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
      version: 1,
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
      active: true,
      version: 1,
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
  bins: [
    {
      id: binId,
      warehouseId,
      warehouseCode: 'BEY-01',
      binCode: 'A-01',
      nameEn: 'Aisle A shelf 1',
      nameAr: 'الممر أ الرف ١',
      binKind: 'stock',
      active: true,
      version: 1,
    },
  ],
  branches: [{ id: branchId, code: 'BEY', nameEn: 'Beirut branch', nameAr: 'فرع بيروت' }],
  administrationEvents: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      aggregateType: 'item',
      aggregateId: itemId,
      aggregateVersion: 1,
      action: 'create_item',
      reasonEn: 'Initial catalog load for the Beirut rollout',
      reasonAr: 'تحميل الفهرس الأولي لإطلاق بيروت',
      evidence: 'Change request CR-2026-001.',
      occurredAt: '2026-09-01T09:00:00.000Z',
      actorName: 'Rana Administrator',
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
    // Scoped to the custody form: the administration panel reuses the same evidence labels.
    const custody = within(
      screen.getByRole('button', { name: 'Confirm handoff' }).closest('form')!,
    );
    await user.selectOptions(
      custody.getByLabelText('Installation with assigned technician'),
      installationId,
    );
    await user.type(
      custody.getByLabelText('Reason in English'),
      'Assigned for customer installation',
    );
    await user.type(custody.getByLabelText('Reason in Arabic'), 'تم التسليم لتركيب خدمة العميل');
    await user.type(
      custody.getByLabelText('Verification evidence'),
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

describe('Warehouse master-data administration', () => {
  const adminFill = async (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) => {
    const controls = within(form);
    await user.type(
      controls.getByLabelText('Reason in English'),
      'Approved for the branch rollout',
    );
    await user.type(controls.getByLabelText('Reason in Arabic'), 'تمت الموافقة لإطلاق الفرع');
    await user.type(
      controls.getByLabelText('Approval evidence / reference'),
      'Change request CR-2026-114',
    );
  };

  it('creates a catalog item through the administration route', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const form = (await screen.findByRole('heading', { name: 'Add catalog item' })).closest('form');
    const controls = within(form!);
    await user.type(controls.getByLabelText('SKU'), 'ONT-2100');
    await user.type(controls.getByLabelText('English name'), 'GPON ONT 2100');
    await user.type(controls.getByLabelText('Arabic name'), 'وحدة ألياف 2100');
    await user.selectOptions(controls.getByLabelText('Category'), 'ont_onu');
    await adminFill(user, form!);
    await user.click(controls.getByRole('button', { name: 'Create item' }));

    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalled());
    const call = vi.mocked(api.submitTenantOperation).mock.calls.at(-1);
    expect(call?.[1]).toBe('warehouse/administration');
    expect(call?.[2].command).toMatchObject({
      action: 'create_item',
      sku: 'ONT-2100',
      category: 'ont_onu',
      serializedFlag: true,
    });
  });

  it('edits an item as a full replacement carrying the reviewed version', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const table = (await screen.findByRole('table', { name: 'Catalog items' })).closest('table');
    await user.click(within(table!).getByRole('button', { name: 'Edit' }));

    const form = screen.getByRole('heading', { name: 'Edit CPE-AX' }).closest('form');
    const controls = within(form!);
    // The form is seeded from the record so an unedited field cannot be blanked by accident.
    expect(controls.getByLabelText('English name')).toHaveValue('Wi-Fi 6 CPE');
    await user.clear(controls.getByLabelText('English name'));
    await user.type(controls.getByLabelText('English name'), 'Wi-Fi 6 CPE rev B');
    await adminFill(user, form!);
    await user.click(controls.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalled());
    expect(vi.mocked(api.submitTenantOperation).mock.calls.at(-1)?.[2].command).toMatchObject({
      action: 'update_item',
      itemId,
      expectedVersion: 1,
      nameEn: 'Wi-Fi 6 CPE rev B',
      nameAr: 'جهاز واي فاي 6',
      active: true,
    });
  });

  it('surfaces the server conflict message instead of reporting success', async () => {
    vi.mocked(api.submitTenantOperation).mockRejectedValueOnce(
      new Error('catalog item changed; refresh before saving'),
    );
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const form = (await screen.findByRole('heading', { name: 'Add catalog item' })).closest('form');
    const controls = within(form!);
    await user.type(controls.getByLabelText('SKU'), 'ONT-2100');
    await user.type(controls.getByLabelText('English name'), 'GPON ONT 2100');
    await user.type(controls.getByLabelText('Arabic name'), 'وحدة ألياف 2100');
    await adminFill(user, form!);
    await user.click(controls.getByRole('button', { name: 'Create item' }));

    expect(await screen.findByText('catalog item changed; refresh before saving')).toBeVisible();
  });

  it('refuses evidence that only looks long enough and never calls the API', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const form = (await screen.findByRole('heading', { name: 'Add catalog item' })).closest('form');
    const controls = within(form!);
    await user.type(controls.getByLabelText('SKU'), 'ONT-2100');
    await user.type(controls.getByLabelText('English name'), 'GPON ONT 2100');
    await user.type(controls.getByLabelText('Arabic name'), 'وحدة ألياف 2100');
    // Each value satisfies the HTML minlength of 8 but collapses to far less once trimmed,
    // so only the contract check catches it.
    await user.type(controls.getByLabelText('Reason in English'), '  ok    ');
    await user.type(controls.getByLabelText('Reason in Arabic'), '  حسنا  ');
    await user.type(controls.getByLabelText('Approval evidence / reference'), '  ref   ');
    await user.click(controls.getByRole('button', { name: 'Create item' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Complete every field, including bilingual reason and evidence, before saving.',
    );
    expect(api.submitTenantOperation).not.toHaveBeenCalled();
  });

  it('blocks submission natively when a required evidence field is empty', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    const form = (await screen.findByRole('heading', { name: 'Add catalog item' })).closest('form');
    const controls = within(form!);
    await user.type(controls.getByLabelText('SKU'), 'ONT-2100');
    await user.type(controls.getByLabelText('English name'), 'GPON ONT 2100');
    await user.type(controls.getByLabelText('Arabic name'), 'وحدة ألياف 2100');
    await user.click(controls.getByRole('button', { name: 'Create item' }));

    expect(api.submitTenantOperation).not.toHaveBeenCalled();
  });

  it('explains why a warehouse cannot be created when no branch is in scope', async () => {
    vi.mocked(api.readWarehouseWorkspace).mockResolvedValue({ ...fixture, branches: [] });
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('tab', { name: /Warehouses/ }));

    expect(
      screen.getByText(
        'No branch is in your scope, so a warehouse cannot be placed. Ask an administrator to widen your branch scope.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create warehouse' })).toBeDisabled();
  });

  it('shows bins and immutable change history in Arabic', async () => {
    const user = userEvent.setup();
    render(<WarehouseWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('tab', { name: /الأرفف/ }));
    expect(screen.getByText('الممر أ الرف ١')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: /سجل التغييرات/ }));
    expect(screen.getByText('تم إنشاء صنف')).toBeVisible();
    expect(screen.getByText('تحميل الفهرس الأولي لإطلاق بيروت')).toBeVisible();
  });
});
