import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSnapshot } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readDashboardSnapshot } = vi.hoisted(() => ({
  readDashboardSnapshot: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('../api', () => ({ readDashboardSnapshot }));

const { DashboardWorkspace } = await import('./DashboardWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const snapshot: DashboardSnapshot = {
  asOf: '2026-09-09T08:00:00.000Z',
  collections: {
    usdMinor: 100000,
    lbpMinor: 900000,
    receipts: 2,
    byChannel: [
      { channel: 'office', currency: 'USD', amountMinor: 100000, receipts: 1 },
      { channel: 'other', currency: 'LBP', amountMinor: 900000, receipts: 1 },
    ],
    recent: [
      {
        receiptNumber: 'RCPT-0001',
        currency: 'USD',
        amountMinor: 100000,
        channel: 'office',
        subscriberName: 'Analytics customer',
        postedAt: '2026-09-09T07:30:00.000Z',
      },
    ],
  },
  receivables: { unpaidInvoices: 2, overdue30: 1, usdMinor: 700000, lbpMinor: 0, oldest: [] },
  services: { active: 1, suspended: 0, pendingInstallation: 0, liveSessions: 0, byNas: [] },
  work: {
    failedJobs: 1,
    openTickets: 3,
    ticketsOverdue: 1,
    openIncidents: 0,
    workOrdersToday: 2,
    failed: [
      {
        kind: 'network',
        reference: 'network-job-1',
        detail: 'dead_lettered',
        at: '2026-09-09T06:00:00.000Z',
      },
    ],
  },
  activity: [
    {
      action: 'tenant.support.manage',
      resourceType: 'operations_support_issues',
      actor: 'Service agent',
      at: '2026-09-09T07:00:00.000Z',
      result: 'allowed',
    },
  ],
};
const quickActions = [{ id: 'payments', label: 'Record payment', description: 'Office cashier' }];

describe('DashboardWorkspace', () => {
  beforeEach(() => {
    readDashboardSnapshot.mockReset();
    readDashboardSnapshot.mockResolvedValue(snapshot);
  });

  it('shows no figures before sign-in', () => {
    render(
      <DashboardWorkspace locale="en" onNavigate={() => undefined} quickActions={quickActions} />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in to see today’s operating picture.' }),
    ).toBeInTheDocument();
    expect(readDashboardSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText(/\$/u)).toBeNull();
  });

  it('renders live figures with currencies apart and opens the records behind a card', async () => {
    const user = userEvent.setup();
    render(
      <DashboardWorkspace
        locale="en"
        session={session}
        onNavigate={() => undefined}
        quickActions={quickActions}
      />,
    );
    expect(await screen.findByText('Collections today')).toBeInTheDocument();
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/LBP.?900,000/u).length).toBeGreaterThan(0);
    expect(screen.getByText('Failed work').closest('button')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: /Collections today/u }));
    expect(screen.getByRole('heading', { name: 'Receipts posted today' })).toBeInTheDocument();
    expect(screen.getByText('RCPT-0001 · Analytics customer')).toBeInTheDocument();
    expect(screen.getByText('tenant.support.manage')).toBeInTheDocument();
  });

  it('offers a retry when the snapshot cannot be read, in Arabic', async () => {
    readDashboardSnapshot.mockRejectedValueOnce(new Error('denied'));
    const user = userEvent.setup();
    render(
      <DashboardWorkspace
        locale="ar"
        session={session}
        onNavigate={() => undefined}
        quickActions={quickActions}
      />,
    );
    expect(await screen.findByText('اللوحة غير متاحة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('تحصيلات اليوم')).toBeInTheDocument();
  });
});
