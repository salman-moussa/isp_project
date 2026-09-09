import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionsWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readCollectionsWorkspace, submitTenantOperation, approveDeviceReconciliation } = vi.hoisted(
  () => ({
    readCollectionsWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
    approveDeviceReconciliation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
  }),
);
vi.mock('../api', () => ({
  readCollectionsWorkspace,
  submitTenantOperation,
  approveDeviceReconciliation,
}));

const { CollectionsWorkspace } = await import('./CollectionsWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const collectorId = '60000000-0000-4000-8000-000000000001';
const routeId = '70000000-0000-4000-8000-000000000001';
const assignmentId = '80000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  asOf: '2026-09-09T08:00:00.000Z',
  day: '2026-09-09',
  collectors: [
    {
      userId: collectorId,
      name: 'Jad Haddad',
      roleKey: 'collector',
      active: true,
      routes: 1,
      openAssignments: 1,
      devices: 1,
      lastSeenAt: '2026-09-09T07:00:00.000Z',
    },
  ],
  routes: [
    {
      id: routeId,
      code: 'HAM-04',
      nameEn: 'Hamra north',
      nameAr: 'الحمرا الشمالية',
      active: true,
      branchId: '40000000-0000-4000-8000-000000000001',
      collectorUserId: collectorId,
      collectorName: 'Jad Haddad',
      openAssignments: 1,
      unassignedInvoices: 3,
    },
  ],
  assignments: [
    {
      id: assignmentId,
      subscriberId: '20000000-0000-4000-8000-000000000001',
      subscriberName: 'Layla Ahmad',
      subscriberNumber: 'SUB-1042',
      routeId,
      routeCode: 'HAM-04',
      collectorUserId: collectorId,
      collectorName: 'Jad Haddad',
      invoiceId: '30000000-0000-4000-8000-000000000001',
      documentNumber: 'INV-2609-0007',
      dueOn: '2026-09-08',
      expectedMinor: 3000,
      openMinor: 3000,
      currency: 'USD',
      status: 'assigned',
      collectedMinor: null,
      collectedAt: null,
      receiptNumber: null,
      phone: '03 123 456',
      assignedAt: '2026-09-07T08:00:00.000Z',
    },
  ],
  settlements: [
    {
      id: '90000000-0000-4000-8000-000000000001',
      source: 'device',
      routeId,
      routeCode: 'HAM-04',
      collectorUserId: collectorId,
      collectorName: 'Jad Haddad',
      businessDate: '2026-09-08',
      currency: 'USD',
      expectedMinor: 3000,
      declaredMinor: 2500,
      differenceMinor: -500,
      status: 'pending_approval',
      reason: null,
      settledBy: 'Jad Haddad',
      settledAt: '2026-09-08T16:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      approvalReason: null,
      version: 1,
    },
  ],
  devices: [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      label: 'Jad phone',
      collectorUserId: collectorId,
      collectorName: 'Jad Haddad',
      status: 'active',
      lastSeenAt: '2026-09-09T07:00:00.000Z',
      authorizedAt: '2026-09-01T07:00:00.000Z',
      lastSequence: 12,
      revokedAt: null,
    },
  ],
};

describe('CollectionsWorkspace', () => {
  beforeEach(() => {
    readCollectionsWorkspace.mockReset();
    submitTenantOperation.mockReset();
    approveDeviceReconciliation.mockReset();
    readCollectionsWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ receiptNumber: 'CR-000001' });
    approveDeviceReconciliation.mockResolvedValue({ status: 'approved' });
  });

  it('lists overdue assignments and posts the cash a collector handed in', async () => {
    const user = userEvent.setup();
    render(<CollectionsWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Layla Ahmad')).toBeInTheDocument();
    expect(screen.getByText('Overdue').nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Record cash' }));
    await user.type(screen.getByLabelText('Amount handed in (blank = full balance)'), '30.00');
    await user.type(screen.getByLabelText('Receipt number from the book'), 'BK-77');
    await user.click(screen.getByRole('button', { name: 'Post collection' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'collections/record',
        {
          command: {
            action: 'record_collection',
            assignmentId,
            amountMinor: 3000,
            receiptNumber: 'BK-77',
          },
        },
        expect.stringMatching(/^web-collections-/u),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('CR-000001');
  });

  it('approves a Collect device difference through the approval endpoint, in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<CollectionsWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'التسويات' }));
    expect(container.querySelector('.col-shell')).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByText('HAM-04').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'موافقة' }));
    await user.type(screen.getByLabelText('سبب الموافقة'), 'عُدّ النقد مرتين مع الجابي');
    // The approval form renders ahead of the table, so its submit is the first match.
    await user.click(screen.getAllByRole('button', { name: 'موافقة' })[0]);
    await waitFor(() =>
      expect(approveDeviceReconciliation).toHaveBeenCalledWith(
        session,
        '90000000-0000-4000-8000-000000000001',
        'عُدّ النقد مرتين مع الجابي',
        expect.stringMatching(/^web-collections-/u),
      ),
    );
    expect(submitTenantOperation).not.toHaveBeenCalled();
  });

  it('assigns every open invoice on a route and changes the route collector', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValue({ assigned: 3 });
    render(<CollectionsWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Routes & collectors' }));
    await user.click(screen.getByRole('button', { name: 'Assign due invoices' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'collections/commands',
        {
          command: {
            action: 'assign_route_due',
            routeId,
            dueOn: new Date().toISOString().slice(0, 10),
          },
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('3 invoices assigned.');
    await user.selectOptions(screen.getByLabelText('Collector for HAM-04'), '');
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenLastCalledWith(
        session,
        'collections/commands',
        { command: { action: 'assign_route_collector', routeId, collectorUserId: null } },
        expect.any(String),
      ),
    );
  });
});
