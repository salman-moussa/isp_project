import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssuranceWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readAssuranceWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readAssuranceWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readAssuranceWorkspace, submitTenantOperation }));

const { AssuranceWorkspace } = await import('./AssuranceWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const findingId = '90000000-0000-4000-8000-000000000001';
const caseId = '80000000-0000-4000-8000-000000000001';
const memberId = '70000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  latestRun: {
    id: '60000000-0000-4000-8000-000000000001',
    requestedBy: 'Finance lead',
    startedAt: '2026-09-09T03:00:00.000Z',
    completedAt: '2026-09-09T03:00:02.000Z',
    summary: [
      {
        controlCode: 'INVOICE_OVERDUE_60',
        openFindings: 1,
        newFindings: 1,
        exposureUsdMinor: 18482,
        exposureLbpMinor: 0,
      },
    ],
  },
  runs: [],
  findings: [
    {
      id: findingId,
      controlCode: 'INVOICE_OVERDUE_60',
      subjectType: 'invoice',
      subjectId: '50000000-0000-4000-8000-000000000001',
      subjectReference: 'INV-2026-000123',
      subscriberId: '40000000-0000-4000-8000-000000000001',
      subscriberName: 'Fixture customer',
      branchId: null,
      currency: 'USD',
      exposureMinor: 18482,
      details: {},
      status: 'open',
      acknowledgementNote: null,
      acknowledgedBy: null,
      caseId: null,
      caseNumber: null,
      firstSeenAt: '2026-09-09T03:00:01.000Z',
      lastSeenAt: '2026-09-09T03:00:01.000Z',
      clearedAt: null,
      resolvedAt: null,
      version: 1,
    },
  ],
  cases: [
    {
      id: caseId,
      caseNumber: 'RA-20260909-AB12CD',
      titleEn: 'Overdue invoices in Hamra',
      titleAr: 'فواتير متأخرة في الحمرا',
      status: 'open',
      ownerUserId: null,
      ownerName: null,
      openedBy: 'Finance lead',
      openedAt: '2026-09-09T03:05:00.000Z',
      closedAt: null,
      resolutionEn: null,
      resolutionAr: null,
      resolutionEvidence: null,
      findings: 1,
      exposureUsdMinor: 18482,
      exposureLbpMinor: 0,
      version: 1,
    },
  ],
  members: [{ userId: memberId, name: 'Rana Analyst' }],
  summary: {
    openFindings: 1,
    acknowledgedFindings: 0,
    openCases: 1,
    exposureUsdMinor: 18482,
    exposureLbpMinor: 0,
  },
};

describe('AssuranceWorkspace', () => {
  beforeEach(() => {
    readAssuranceWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readAssuranceWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ runId: 'x' });
  });

  it('shows control exposure from the last run and runs the controls with a reason', async () => {
    const user = userEvent.setup();
    render(<AssuranceWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Invoice unpaid over 60 days')).toBeInTheDocument();
    expect(screen.getByText('Exposure USD').nextElementSibling).toHaveTextContent('$184.82');
    await user.click(screen.getByRole('button', { name: 'Run controls' }));
    fireEvent.change(screen.getByLabelText('Reason (English)'), {
      target: { value: 'Month-end leakage review' },
    });
    fireEvent.change(screen.getByLabelText('Reason (Arabic)'), {
      target: { value: 'مراجعة التسرب في نهاية الشهر' },
    });
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'assurance/commands',
      { command: expect.objectContaining({ action: 'run_controls' }) as unknown },
      expect.stringMatching(/^web-assurance-/u),
    );
  });

  it('opens a case from selected findings with an owner', async () => {
    const user = userEvent.setup();
    render(<AssuranceWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Findings' }));
    expect(screen.getByText('INV-2026-000123')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select INV-2026-000123' }));
    await user.click(screen.getByRole('button', { name: /Open case/u }));
    fireEvent.change(screen.getByLabelText('Title in English'), {
      target: { value: 'Overdue invoices in Hamra' },
    });
    fireEvent.change(screen.getByLabelText('Title in Arabic'), {
      target: { value: 'فواتير متأخرة في الحمرا' },
    });
    await user.selectOptions(screen.getByLabelText('Owner (optional)'), memberId);
    fireEvent.change(screen.getByLabelText('Reason (English)'), {
      target: { value: 'Grouping overdue invoices for follow-up' },
    });
    fireEvent.change(screen.getByLabelText('Reason (Arabic)'), {
      target: { value: 'تجميع الفواتير المتأخرة للمتابعة' },
    });
    await user.click(screen.getByRole('button', { name: 'Open case with findings' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'assurance/commands',
      {
        command: expect.objectContaining({
          action: 'open_case',
          findingIds: [findingId],
          ownerUserId: memberId,
        }) as unknown,
      },
      expect.any(String),
    );
  });

  it('resolves a case with bilingual resolution and evidence in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<AssuranceWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'الحالات' }));
    expect(container.querySelector('.ra-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: /RA-20260909-AB12CD/u }));
    await user.click(screen.getByRole('button', { name: 'حل' }));
    fireEvent.change(screen.getByLabelText('الحل بالإنجليزية'), {
      target: { value: 'Invoices collected after the branch visit' },
    });
    fireEvent.change(screen.getByLabelText('الحل بالعربية'), {
      target: { value: 'تم تحصيل الفواتير بعد زيارة الفرع' },
    });
    fireEvent.change(screen.getByLabelText('مرجع الدليل'), {
      target: { value: 'Receipts RCPT-2026-0101 to 0104' },
    });
    fireEvent.change(screen.getByLabelText('السبب (بالإنجليزية)'), {
      target: { value: 'Case closed with receipts attached' },
    });
    fireEvent.change(screen.getByLabelText('السبب (بالعربية)'), {
      target: { value: 'أُغلقت الحالة مع إرفاق الإيصالات' },
    });
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'assurance/commands',
      {
        command: expect.objectContaining({
          action: 'transition_case',
          caseId,
          expectedVersion: 1,
          status: 'resolved',
          resolutionEvidence: 'Receipts RCPT-2026-0101 to 0104',
        }) as unknown,
      },
      expect.any(String),
    );
  });
});
