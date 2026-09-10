import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KpiEvidence, RegulatoryWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readRegulatoryWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readRegulatoryWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readRegulatoryWorkspace, submitTenantOperation }));

const { RegulatoryWorkspace } = await import('./RegulatoryWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const evidence: KpiEvidence = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-10',
  computedAt: '2026-09-10T08:00:00.000Z',
  periodMinutes: 14400,
  activeServices: 120,
  activeSubscribers: 118,
  outageMinutes: 90,
  outagesStarted: 1,
  outagesResolved: 1,
  criticalAlarms: 0,
  tickets: 4,
  complaints: 1,
  kpis: {
    AVAILABILITY: {
      code: 'AVAILABILITY',
      nameEn: 'Network availability',
      nameAr: 'توافر الشبكة',
      computation: 'availability_pct',
      unit: 'percent',
      target: 99.5,
      comparator: '>=',
      value: 99.375,
      met: false,
      numerator: 90,
      denominator: 14400,
      source: 'computed',
    },
    MTTR: {
      code: 'MTTR',
      nameEn: 'Mean time to restore',
      nameAr: 'متوسط زمن الإصلاح',
      computation: 'mttr_minutes',
      unit: 'minutes',
      target: 240,
      comparator: '<=',
      value: 90,
      met: true,
      numerator: 1,
      denominator: null,
      source: 'computed',
    },
  },
};
const workspace: Workspace = {
  asOf: '2026-09-10T08:00:00.000Z',
  licences: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'isp_licence',
      reference: 'ISP-2026-001',
      authority: 'TRA',
      titleEn: 'ISP licence',
      titleAr: 'رخصة مزود الإنترنت',
      issuedOn: '2024-10-01',
      expiresOn: '2026-10-10',
      renewalNoticeDays: 90,
      status: 'active',
      notes: null,
      version: 1,
      daysToExpiry: 30,
      renewalDue: true,
    },
  ],
  obligations: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      code: 'QOS-M',
      titleEn: 'Monthly QoS report',
      titleAr: 'تقرير الجودة الشهري',
      authority: 'TRA',
      frequency: 'monthly',
      nextDueOn: '2026-09-05',
      ownerUserId: null,
      ownerName: 'Compliance manager',
      evidenceRequired: true,
      description: null,
      active: true,
      version: 1,
      daysToDue: -5,
      overdue: true,
      lastSubmission: null,
    },
  ],
  kpis: [
    {
      id: 'k1',
      code: 'AVAILABILITY',
      nameEn: 'Network availability',
      nameAr: 'توافر الشبكة',
      computation: 'availability_pct',
      unit: 'percent',
      target: 99.5,
      comparator: '>=',
      active: true,
      version: 1,
    },
    {
      id: 'k2',
      code: 'MTTR',
      nameEn: 'Mean time to restore',
      nameAr: 'متوسط زمن الإصلاح',
      computation: 'mttr_minutes',
      unit: 'minutes',
      target: 240,
      comparator: '<=',
      active: true,
      version: 1,
    },
  ],
  current: evidence,
  submissions: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      submissionNumber: 'REG-000001',
      obligationId: '20000000-0000-4000-8000-000000000001',
      obligationCode: 'QOS-M',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      status: 'draft',
      evidence,
      notes: null,
      preparedBy: 'Compliance manager',
      preparedAt: '2026-09-09T08:00:00.000Z',
      submittedBy: null,
      submittedAt: null,
      submissionReference: null,
      decidedAt: null,
      decisionNote: null,
      version: 1,
    },
  ],
  members: [{ userId: '40000000-0000-4000-8000-000000000001', name: 'Compliance manager' }],
};

describe('RegulatoryWorkspace', () => {
  beforeEach(() => {
    readRegulatoryWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readRegulatoryWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ submissionId: 'x', status: 'submitted', version: 2 });
  });

  it('shows KPI evidence with met and missed targets and the overdue counters', async () => {
    render(<RegulatoryWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Network availability')).toBeInTheDocument();
    expect(screen.getByText('Below target')).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('computed · 90 / 14400')).toBeInTheDocument();
    expect(screen.getByText('KPIs below target').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Overdue obligations').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Renewals due').nextElementSibling).toHaveTextContent('1');
  });

  it('opens a draft submission and sends it with the regulator reference, in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<RegulatoryWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'التقديمات' }));
    expect(container.querySelector('.reg-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'فتح' }));
    expect(screen.getByRole('article', { name: 'REG-000001' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('مرجع الجهة المنظمة'), 'TRA-2026-0042');
    await user.click(screen.getByRole('button', { name: 'إرسال إلى الجهة' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'regulatory/commands',
        {
          command: {
            action: 'submit',
            submissionId: '30000000-0000-4000-8000-000000000001',
            expectedVersion: 1,
            reference: 'TRA-2026-0042',
          },
        },
        expect.stringMatching(/^web-regulatory-/u),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('أُرسل إلى الجهة المنظمة.');
  });

  it('prepares a submission for an obligation and a period', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValueOnce({
      submissionId: 'y',
      submissionNumber: 'REG-000002',
      status: 'draft',
    });
    render(<RegulatoryWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Obligations' }));
    await user.click(screen.getByRole('button', { name: 'Prepare submission' }));
    await user.selectOptions(
      screen.getByLabelText('Obligation'),
      '20000000-0000-4000-8000-000000000001',
    );
    await user.click(screen.getByRole('button', { name: 'Compute evidence and prepare' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'regulatory/commands',
        {
          command: {
            action: 'prepare_submission',
            obligationId: '20000000-0000-4000-8000-000000000001',
            periodStart: '2026-09-01',
            periodEnd: '2026-09-10',
          },
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('REG-000002');
  });
});
