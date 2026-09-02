import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '@isp/ui';
import * as api from '../api';
import { AccountingWorkspace } from './AccountingWorkspace';
vi.mock('../api', () => ({
  readChartOfAccounts: vi.fn(),
  readJournalEntries: vi.fn(),
  readTrialBalance: vi.fn(),
  readAccountingPeriods: vi.fn(),
}));
const session: ApiSession = {
  apiBaseUrl: 'https://example.test',
  tenantId: 'tenant-a',
  accessToken: 'test',
  refreshToken: 'test',
  logout: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readChartOfAccounts).mockResolvedValue([]);
  vi.mocked(api.readJournalEntries).mockResolvedValue([]);
  vi.mocked(api.readAccountingPeriods).mockResolvedValue([]);
  vi.mocked(api.readTrialBalance).mockResolvedValue({
    asOfDate: '2026-09-02',
    accounts: [],
    totalDebitUsd: 0,
    totalCreditUsd: 0,
    totalDebitLbp: 0,
    totalCreditLbp: 0,
    coverage: {
      hasUnjournaledSources: false,
      hasLegacyEntries: false,
      hasUnjournaledInvoices: false,
    },
  });
});
describe('Accounting workspace truthfulness', () => {
  it('requires sign-in and never displays sample financial records', () => {
    render(<AccountingWorkspace locale="en" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in');
    expect(api.readChartOfAccounts).not.toHaveBeenCalled();
    expect(screen.queryByText('JE-2026-001')).not.toBeInTheDocument();
  });
  it('renders actual empty results and switches sections', async () => {
    const user = userEvent.setup();
    render(<AccountingWorkspace locale="en" session={session} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByText('No accounting records in this section.');
    await user.click(screen.getByRole('button', { name: 'General Ledger & Journals' }));
    expect(screen.getByRole('button', { name: 'General Ledger & Journals' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('JE-2026-001')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trial Balance' }));
    expect(
      screen.getByRole('heading', { name: 'Trial Balance as of 2026-09-02' }),
    ).toBeInTheDocument();
  });
  it('shows failures instead of sample data and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(api.readChartOfAccounts).mockRejectedValueOnce(new Error('403 forbidden'));
    render(<AccountingWorkspace locale="en" session={session} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your access');
    expect(screen.queryByText('Cashbox USD')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No accounting records in this section.');
    expect(api.readChartOfAccounts).toHaveBeenCalledTimes(2);
  });
  it('formats LBP as whole units, warns about incomplete coverage, and supports RTL', async () => {
    const user = userEvent.setup();
    vi.mocked(api.readTrialBalance).mockResolvedValue({
      asOfDate: '2026-09-02',
      accounts: [
        {
          accountId: 'a',
          accountCode: '1020',
          accountNameEn: 'Cash LBP',
          accountNameAr: 'صندوق الليرة',
          accountType: 'asset',
          debitMinorUsd: 0,
          creditMinorUsd: 0,
          netBalanceMinorUsd: 0,
          debitMinorLbp: 100000,
          creditMinorLbp: 0,
          netBalanceMinorLbp: 100000,
        },
      ],
      totalDebitUsd: 0,
      totalCreditUsd: 0,
      totalDebitLbp: 100000,
      totalCreditLbp: 100000,
      coverage: { hasLegacyEntries: true, hasUnjournaledInvoices: true },
    });
    const { container } = render(<AccountingWorkspace locale="ar" session={session} />);
    await waitFor(() => expect(api.readTrialBalance).toHaveBeenCalledWith(session));
    await screen.findByRole('alert');
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'ميزان المراجعة والقوائم' }));
    await user.selectOptions(screen.getByRole('combobox'), 'LBP');
    const amount = new Intl.NumberFormat('ar-LB', {
      style: 'currency',
      currency: 'LBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(100000);
    expect(screen.getAllByText(amount, { normalizer: (text) => text }).length).toBeGreaterThan(0);
  });
  it('ignores an old tenant response after switching sessions', async () => {
    let complete!: (value: Awaited<ReturnType<typeof api.readChartOfAccounts>>) => void;
    vi.mocked(api.readChartOfAccounts).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { rerender } = render(<AccountingWorkspace locale="en" session={session} />);
    rerender(<AccountingWorkspace locale="en" session={{ ...session, tenantId: 'tenant-b' }} />);
    await screen.findByText('No accounting records in this section.');
    complete([
      {
        id: 'a',
        accountCode: '1010',
        accountNameEn: 'Old tenant cash',
        accountNameAr: 'قديم',
        accountType: 'asset',
        currency: 'USD',
        active: true,
        isSystem: true,
      },
    ]);
    await waitFor(() => expect(screen.queryByText('Old tenant cash')).not.toBeInTheDocument());
  });
});
