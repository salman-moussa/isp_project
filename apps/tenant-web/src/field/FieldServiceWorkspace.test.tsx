import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldServiceWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readFieldServiceWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readFieldServiceWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({
  readFieldServiceWorkspace,
  submitTenantOperation,
  TenantApiError: class TenantApiError extends Error {
    public constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

const { FieldServiceWorkspace } = await import('./FieldServiceWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};

const workspace: Workspace = {
  day: '2026-09-09',
  technicians: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000001',
      displayName: 'Maya Technician',
      phone: '+96170123456',
      skills: ['fiber', 'cpe'],
      areaIds: [],
      active: true,
      version: 1,
      openWorkOrders: 1,
    },
  ],
  workOrders: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      workOrderNumber: 'WO-20260909-ABC123',
      kind: 'installation',
      priority: 'high',
      status: 'dispatched',
      subscriberName: 'Field customer',
      serviceNumber: 'FLD-SVC',
      installationId: '40000000-0000-4000-8000-000000000001',
      installationStatus: 'scheduled',
      address: '12 Cedar Street',
      technicianId: '10000000-0000-4000-8000-000000000001',
      technicianName: 'Maya Technician',
      windowStart: '2026-09-09T08:00:00.000Z',
      windowEnd: '2026-09-09T10:00:00.000Z',
      slaDueAt: '2026-09-08T08:00:00.000Z',
      overdue: true,
      titleEn: 'Fiber installation',
      titleAr: 'تركيب ألياف',
      requiredSkills: ['fiber'],
      checklist: [
        { key: 'ont', labelEn: 'ONT mounted', labelAr: 'تثبيت الـONT', required: true },
        { key: 'wifi', labelEn: 'Wi-Fi handed over', labelAr: 'تسليم الواي فاي', required: false },
      ],
      outcome: {},
      version: 3,
      createdAt: '2026-09-08T10:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      workOrderNumber: 'WO-20260909-DEF456',
      kind: 'repair',
      priority: 'normal',
      status: 'open',
      subscriberName: 'Other customer',
      overdue: false,
      titleEn: 'Replace drop wire',
      titleAr: 'استبدال سلك التوصيل',
      requiredSkills: [],
      checklist: [],
      outcome: {},
      version: 1,
      createdAt: '2026-09-08T11:00:00.000Z',
    },
  ],
  events: [
    {
      id: 'e1',
      workOrderId: '30000000-0000-4000-8000-000000000001',
      action: 'schedule_work_order',
      fromStatus: 'open',
      toStatus: 'dispatched',
      actorId: 'dispatcher',
      reasonEn: 'Scheduled for the morning slot',
      reasonAr: 'جُدول للفترة الصباحية',
      evidence: 'Board review',
      occurredAt: '2026-09-08T12:00:00.000Z',
    },
  ],
  staff: [
    {
      userId: '20000000-0000-4000-8000-000000000002',
      displayName: 'New Installer',
      email: 'installer@example.test',
      roleKey: 'installer',
    },
  ],
  openInstallations: [],
  scopes: { branches: [], areas: [] },
  page: 1,
  pageSize: 50,
  totalCount: 2,
};

describe('FieldServiceWorkspace', () => {
  beforeEach(() => {
    readFieldServiceWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readFieldServiceWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({
      workOrderId: 'x',
      workOrderNumber: 'WO-1',
      status: 'on_site',
      version: 4,
    });
  });

  it('renders the dispatch board with unassigned and per-technician columns', async () => {
    render(<FieldServiceWorkspace locale="en" session={session} />);
    expect(
      await screen.findByRole('heading', { name: 'Dispatch board and technician work' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Unassigned/u })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Maya Technician/u })).toBeInTheDocument();
    expect(screen.getByText('WO-20260909-ABC123')).toBeInTheDocument();
    expect(screen.getByText('Overdue SLA').nextElementSibling).toHaveTextContent('1');
    expect(readFieldServiceWorkspace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('lets the technician confirm arrival with bilingual evidence and the current version', async () => {
    const user = userEvent.setup();
    render(<FieldServiceWorkspace locale="en" session={session} />);
    await user.click(await screen.findByText('WO-20260909-ABC123'));
    const detail = within(screen.getByRole('complementary', { name: 'Work order detail' }));
    expect(detail.getByText('Field customer')).toBeInTheDocument();
    await user.click(detail.getByRole('button', { name: 'Arrived on site' }));
    await user.type(detail.getByLabelText('Reason (English)'), 'Technician at the premises');
    await user.type(detail.getByLabelText('Reason (Arabic)'), 'الفني في الموقع');
    await user.type(detail.getByLabelText('Evidence reference'), 'Mobile check-in 08:05');
    await user.click(detail.getByRole('button', { name: 'Confirm arrival' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'field-service/execute',
      {
        command: {
          action: 'start_work_order',
          workOrderId: '30000000-0000-4000-8000-000000000001',
          expectedVersion: 3,
          reasonEn: 'Technician at the premises',
          reasonAr: 'الفني في الموقع',
          evidence: 'Mobile check-in 08:05',
        },
      },
      expect.stringMatching(/^web-field-/u),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Work started on site');
  });

  it('registers a technician from the workspace member list in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<FieldServiceWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'الفنيون' }));
    expect(container.querySelector('.field-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'تسجيل فني' }));
    await user.selectOptions(
      screen.getByLabelText('عضو مساحة العمل'),
      '20000000-0000-4000-8000-000000000002',
    );
    await user.type(screen.getByLabelText('الاسم المعروض'), 'فني جديد');
    await user.click(screen.getByLabelText('ألياف'));
    await user.type(screen.getByLabelText('السبب (بالإنجليزية)'), 'New hire onboarded');
    await user.type(screen.getByLabelText('السبب (بالعربية)'), 'تم إلحاق موظف جديد');
    await user.type(screen.getByLabelText('مرجع الدليل'), 'HR file 2026-091');
    await user.click(screen.getByRole('button', { name: 'تسجيل' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'field-service/dispatch',
      {
        command: expect.objectContaining({
          action: 'register_technician',
          userId: '20000000-0000-4000-8000-000000000002',
          displayName: 'فني جديد',
          skills: ['fiber'],
          areaIds: [],
        }) as unknown,
      },
      expect.any(String),
    );
  });

  it('shows the denied state without a board', async () => {
    const { TenantApiError } = await import('../api');
    readFieldServiceWorkspace.mockRejectedValueOnce(new TenantApiError('denied', 403));
    render(<FieldServiceWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Field service is outside your scope')).toBeInTheDocument();
    expect(screen.queryByText('Dispatch board')).not.toBeInTheDocument();
  });
});
