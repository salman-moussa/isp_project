import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashierWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readCashierWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readCashierWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readCashierWorkspace, submitTenantOperation }));

const { CashierWorkspace } = await import('./CashierWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const subscriberId = '20000000-0000-4000-8000-000000000001';
const invoiceId = '30000000-0000-4000-8000-000000000001';
const base: Workspace = {
  asOf: '2026-09-09T08:00:00.000Z',
  drawers: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      branchId: '40000000-0000-4000-8000-000000000001',
      branchName: 'Hamra',
      branchNameAr: 'الحمرا',
      cashier: 'Counter cashier',
      mine: true,
      currency: 'USD',
      status: 'open',
      openingFloatMinor: 10000,
      cashReceiptsMinor: 2500,
      receipts: 1,
      expectedMinor: null,
      countedMinor: null,
      varianceMinor: null,
      openedAt: '2026-09-09T06:00:00.000Z',
      closedAt: null,
      closingNote: null,
      version: 1,
    },
  ],
  branches: [{ id: '40000000-0000-4000-8000-000000000001', nameEn: 'Hamra', nameAr: 'الحمرا' }],
  today: [{ currency: 'USD', method: 'cash', amountMinor: 2500, receipts: 1 }],
  receipts: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      receiptNumber: 'RC-000001',
      subscriberId,
      subscriberName: 'Layla Ahmad',
      subscriberNumber: 'SUB-1042',
      amountMinor: 2500,
      currency: 'USD',
      method: 'cash',
      reference: null,
      note: null,
      cashier: 'Counter cashier',
      drawerId: '10000000-0000-4000-8000-000000000001',
      postedAt: '2026-09-09T07:30:00.000Z',
      voidedAt: null,
      voidReason: null,
      allocatedMinor: 2500,
      allocations: [{ invoiceId, documentNumber: 'INV-2609-0007', amountMinor: 2500 }],
    },
  ],
  subscribers: [],
};
const found: Workspace = {
  ...base,
  subscribers: [
    {
      id: subscriberId,
      subscriberNumber: 'SUB-1042',
      displayName: 'Layla Ahmad',
      status: 'active',
      branchName: 'Hamra',
      branchNameAr: 'الحمرا',
      phone: '03 123 456',
      openInvoices: [
        {
          id: invoiceId,
          documentNumber: 'INV-2609-0007',
          currency: 'USD',
          amountMinor: 3000,
          remainingMinor: 500,
          postedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      unallocated: [],
    },
  ],
};

describe('CashierWorkspace', () => {
  beforeEach(() => {
    readCashierWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readCashierWorkspace.mockImplementation(async (...args: unknown[]) => {
      const query = args[1] as { search?: string } | undefined;
      return query?.search ? found : base;
    });
    submitTenantOperation.mockResolvedValue({
      receiptId: '50000000-0000-4000-8000-000000000002',
      receiptNumber: 'RC-000002',
      paymentId: 'pay',
      subscriberId,
      subscriberName: 'Layla Ahmad',
      amountMinor: 500,
      currency: 'USD',
      method: 'cash',
      allocatedMinor: 500,
      unallocatedMinor: 0,
      allocations: [
        { allocationId: 'a1', invoiceId, documentNumber: 'INV-2609-0007', amountMinor: 500 },
      ],
      drawerId: '10000000-0000-4000-8000-000000000001',
      postedAt: '2026-09-09T08:05:00.000Z',
      replayed: false,
    });
  });

  it('finds a subscriber, posts a cash receipt against the open invoice and shows the receipt', async () => {
    const user = userEvent.setup();
    render(<CashierWorkspace locale="en" session={session} />);
    expect(await screen.findByText('RC-000001')).toBeInTheDocument();
    expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Subscriber number, name or phone'), 'Layla');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: /Layla Ahmad/u }));
    await user.type(screen.getByLabelText('Amount received'), '5.00');
    await user.selectOptions(screen.getByLabelText('Apply to'), invoiceId);
    await user.click(screen.getByRole('button', { name: 'Post receipt' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'cashier/commands',
      {
        command: {
          action: 'record_receipt',
          subscriberId,
          invoiceId,
          amountMinor: 500,
          currency: 'USD',
          method: 'cash',
        },
      },
      expect.stringMatching(/^web-cashier-/u),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Receipt RC-000002 posted.');
    expect(screen.getByRole('article', { name: 'Receipt' })).toHaveTextContent('RC-000002');
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeInTheDocument();
  });

  it('voids a receipt with a reason through the reversal route, in Arabic', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValueOnce({
      receiptId: '50000000-0000-4000-8000-000000000001',
      reversalPaymentId: 'rev',
    });
    const { container } = render(<CashierWorkspace locale="ar" session={session} />);
    expect(await screen.findByText('RC-000001')).toBeInTheDocument();
    expect(container.querySelector('.cashier-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'إلغاء' }));
    await user.type(screen.getByLabelText('السبب'), 'اختير مشترك خاطئ عند الشباك');
    await user.click(screen.getByRole('button', { name: 'إلغاء الإيصال' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'cashier/void',
        {
          command: {
            action: 'void_receipt',
            receiptId: '50000000-0000-4000-8000-000000000001',
            reason: 'اختير مشترك خاطئ عند الشباك',
          },
        },
        expect.stringMatching(/^web-cashier-/u),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('أُلغي الإيصال بعكس مرتبط.');
  });

  it('closes the open drawer with the counted cash and the read version', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValueOnce({
      drawerId: '10000000-0000-4000-8000-000000000001',
      status: 'closed',
      expectedMinor: 12500,
      countedMinor: 12000,
      varianceMinor: -500,
      version: 2,
    });
    render(<CashierWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await user.type(screen.getByLabelText('Counted cash'), '120.00');
    await user.click(screen.getByRole('button', { name: 'Confirm count and close' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'cashier/commands',
        {
          command: {
            action: 'close_drawer',
            drawerId: '10000000-0000-4000-8000-000000000001',
            expectedVersion: 1,
            countedMinor: 12000,
          },
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Variance -$5.00');
  });
});
