import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportDataset, ReportsWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readReportsWorkspace, readReportDataset, submitTenantOperation } = vi.hoisted(() => ({
  readReportsWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readReportDataset: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readReportsWorkspace, readReportDataset, submitTenantOperation }));

const { ReportsWorkspace } = await import('./ReportsWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const workspace: Workspace = {
  catalogue: [
    { key: 'ar_aging', windowed: false },
    { key: 'collections_daily', windowed: true },
  ],
  exports: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      reportKey: 'ar_aging',
      format: 'csv',
      status: 'succeeded',
      rows: 2,
      requestedBy: 'Branch manager',
      requestedAt: '2026-09-09T08:00:00.000Z',
      completedAt: '2026-09-09T08:00:01.000Z',
    },
  ],
};
const dataset: ReportDataset = {
  key: 'ar_aging',
  from: '2026-08-10',
  to: '2026-09-09',
  generatedAt: '2026-09-09T08:05:00.000Z',
  rows: [
    { currency: 'USD', bucket: '0-30', bucketOrder: 1, invoices: 1, remainingMinor: 200000 },
    { currency: 'USD', bucket: '61-90', bucketOrder: 3, invoices: 1, remainingMinor: 500000 },
  ],
};

describe('ReportsWorkspace', () => {
  beforeEach(() => {
    readReportsWorkspace.mockReset();
    readReportDataset.mockReset();
    submitTenantOperation.mockReset();
    readReportsWorkspace.mockResolvedValue(workspace);
    readReportDataset.mockResolvedValue(dataset);
    submitTenantOperation.mockResolvedValue({
      jobId: 'job',
      rows: 2,
      filename: 'ar_aging.csv',
      csv: 'a,b\r\n',
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('runs a report, formats money with its currency and records a CSV export', async () => {
    const user = userEvent.setup();
    render(<ReportsWorkspace locale="en" session={session} />);
    expect((await screen.findAllByText('Receivables aging')).length).toBeGreaterThan(0);
    expect(screen.getByText('Branch manager')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run report' }));
    expect(await screen.findByText('$5,000.00')).toBeInTheDocument();
    expect(readReportDataset).toHaveBeenCalledWith(session, 'ar_aging', {});
    expect(screen.queryByText('bucketOrder')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'reports/export',
      { command: { key: 'ar_aging', format: 'csv' } },
      expect.stringMatching(/^web-report-/u),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('ar_aging.csv (2 rows)');
  });

  it('passes a date window to windowed reports in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReportsWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: /التحصيل حسب اليوم والقناة/u }));
    expect(container.querySelector('.rp-shell')).toHaveAttribute('dir', 'rtl');
    await user.type(screen.getByLabelText('من'), '2026-08-01');
    await user.type(screen.getByLabelText('إلى'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: 'تشغيل التقرير' }));
    await waitFor(() =>
      expect(readReportDataset).toHaveBeenCalledWith(session, 'collections_daily', {
        from: '2026-08-01',
        to: '2026-08-31',
      }),
    );
  });
});
