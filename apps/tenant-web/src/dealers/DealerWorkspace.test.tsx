import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealerWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readDealerWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readDealerWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readDealerWorkspace, submitTenantOperation }));

const { DealerWorkspace } = await import('./DealerWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const dealerId = '50000000-0000-4000-8000-000000000001';
const batchId = '60000000-0000-4000-8000-000000000001';
const subscriberId = '40000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  dealers: [
    {
      id: dealerId,
      dealerCode: 'HAM-01',
      dealerName: 'Hamra Mobile Shop',
      dealerType: 'dealer',
      contactName: 'Rami',
      contactPhone: '+961 1 000000',
      email: null,
      branchId: null,
      branchName: null,
      creditLimitMinorUsd: 50000,
      creditLimitMinorLbp: 0,
      commissionRateBps: 400,
      status: 'active',
      notes: null,
      version: 2,
      balances: [
        { currency: 'USD', balanceMinor: -12000, creditLimitMinor: 50000, availableMinor: 38000 },
        { currency: 'LBP', balanceMinor: 0, creditLimitMinor: 0, availableMinor: 0 },
      ],
      issuedBatches: 1,
      redeemedVouchers: 3,
    },
  ],
  batches: [
    {
      id: batchId,
      batchNumber: 'B-2026-001',
      status: 'generated',
      dealerId: null,
      dealerName: null,
      faceValueMinor: 1000,
      currency: 'USD',
      quantity: 50,
      issuedCount: 0,
      redeemedCount: 0,
      cancelledCount: 0,
      generatedAt: '2026-09-09T02:00:00.000Z',
      issuedAt: null,
      expiresAt: null,
      version: 1,
    },
  ],
  ledger: [],
  redemptions: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      serialNumber: 'B-2026-000-00007',
      batchNumber: 'B-2026-000',
      subscriberId,
      subscriberName: 'Fixture customer',
      amountMinor: 1000,
      currency: 'USD',
      status: 'credit_pending',
      accountEntryId: null,
      redeemedAt: '2026-09-09T02:10:00.000Z',
      creditedAt: null,
      actorName: 'Cashier',
    },
  ],
  branches: [],
  subscribers: [{ id: subscriberId, name: 'Fixture customer', subscriberNumber: 'SUB-001' }],
  subscriberDirectoryTruncated: false,
  summary: {
    activeDealers: 1,
    issuedVouchersOutstanding: 47,
    pendingCredits: 1,
    floatUsdMinor: -12000,
    floatLbpMinor: 0,
  },
};

describe('DealerWorkspace', () => {
  beforeEach(() => {
    readDealerWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readDealerWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ dealerId, version: 3 });
  });

  it('shows per-currency float and records a dealer deposit in minor units', async () => {
    const user = userEvent.setup();
    render(<DealerWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Hamra Mobile Shop')).toBeInTheDocument();
    expect(screen.getByText('Credits pending').nextElementSibling).toHaveTextContent('1');
    expect(screen.getAllByText(/-\$120\.00/u)[0]).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250.50' } });
    fireEvent.change(screen.getByLabelText('Receipt or bank reference'), {
      target: { value: 'RCPT-2026-0091' },
    });
    fireEvent.change(screen.getByLabelText('Reason (English)'), {
      target: { value: 'Cash deposit at the branch counter' },
    });
    fireEvent.change(screen.getByLabelText('Reason (Arabic)'), {
      target: { value: 'إيداع نقدي عند صندوق الفرع' },
    });
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'dealers/channel',
      {
        command: {
          action: 'record_deposit',
          dealerId,
          currency: 'USD',
          amountMinor: 25050,
          reference: 'RCPT-2026-0091',
          reasonEn: 'Cash deposit at the branch counter',
          reasonAr: 'إيداع نقدي عند صندوق الفرع',
        },
      },
      expect.stringMatching(/^web-dealer-/u),
    );
  });

  it('issues a generated batch to a dealer at its current version', async () => {
    const user = userEvent.setup();
    render(<DealerWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Voucher batches' }));
    expect(screen.getByText('B-2026-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    await user.selectOptions(screen.getByLabelText('Dealer'), dealerId);
    fireEvent.change(screen.getByLabelText('Reason (English)'), {
      target: { value: 'Handed over 50 cards to the dealer' },
    });
    fireEvent.change(screen.getByLabelText('Reason (Arabic)'), {
      target: { value: 'تم تسليم 50 بطاقة للوكيل' },
    });
    await user.click(screen.getByRole('button', { name: 'Issue to dealer' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'dealers/channel',
      {
        command: expect.objectContaining({
          action: 'issue_batch',
          batchId,
          expectedVersion: 1,
          dealerId,
        }) as unknown,
      },
      expect.any(String),
    );
  });

  it('redeems a voucher for a subscriber in Arabic and retries a pending credit', async () => {
    const user = userEvent.setup();
    const { container } = render(<DealerWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'استخدام قسيمة' }));
    expect(container.querySelector('.dealer-shell')).toHaveAttribute('dir', 'rtl');
    fireEvent.change(screen.getByLabelText('الرقم التسلسلي'), {
      target: { value: 'b-2026-001-00042' },
    });
    fireEvent.change(screen.getByLabelText('الرمز (12 رقماً)'), {
      target: { value: '1234 5678 9012' },
    });
    await user.selectOptions(screen.getByLabelText('المشترك'), subscriberId);
    fireEvent.change(screen.getByLabelText('السبب (بالإنجليزية)'), {
      target: { value: 'Customer presented the card at the counter' },
    });
    fireEvent.change(screen.getByLabelText('السبب (بالعربية)'), {
      target: { value: 'قدّم العميل البطاقة عند الصندوق' },
    });
    await user.click(screen.getByRole('button', { name: 'استخدام القسيمة' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(1));
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'dealers/redeem',
      {
        command: expect.objectContaining({
          serialNumber: 'B-2026-001-00042',
          pin: '123456789012',
          subscriberId,
        }) as unknown,
      },
      expect.any(String),
    );
    await user.click(screen.getByRole('button', { name: 'إكمال القيد' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(2));
    expect(submitTenantOperation.mock.calls[1]?.[1]).toBe('dealers/credit-retry');
  });
});
