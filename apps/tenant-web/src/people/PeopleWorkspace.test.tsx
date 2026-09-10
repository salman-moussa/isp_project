import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeopleWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readPeopleWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readPeopleWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readPeopleWorkspace, submitTenantOperation }));

const { PeopleWorkspace } = await import('./PeopleWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const employeeId = '50000000-0000-4000-8000-000000000001';
const leaveId = '60000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  asOf: '2026-09-10T08:00:00.000Z',
  from: '2026-09-07',
  to: '2026-09-13',
  teams: [
    {
      id: 't1',
      code: 'FIELD',
      nameEn: 'Field team',
      nameAr: 'فريق الميدان',
      branchId: null,
      branchName: null,
      leadEmployeeId: employeeId,
      leadName: 'Jad Haddad',
      active: true,
      version: 1,
      members: 1,
    },
  ],
  employees: [
    {
      id: employeeId,
      employeeNumber: 'E-1',
      userId: '70000000-0000-4000-8000-000000000001',
      userName: 'Jad Haddad',
      displayName: 'Jad Haddad',
      roleTitle: 'Technician',
      teamId: 't1',
      teamCode: 'FIELD',
      branchId: null,
      branchName: null,
      phone: '+96170123456',
      email: null,
      hiredOn: '2025-01-15',
      status: 'active',
      skills: ['fiber', 'cpe'],
      notes: null,
      version: 1,
      onLeaveToday: false,
      onShiftNow: true,
      technician: true,
      expiringTraining: 1,
    },
  ],
  shifts: [
    {
      id: 's1',
      employeeId,
      employeeName: 'Jad Haddad',
      kind: 'shift',
      startsAt: '2026-09-10T06:00:00.000Z',
      endsAt: '2026-09-10T14:00:00.000Z',
      locationNote: 'Hamra',
      cancelledAt: null,
      cancelReason: null,
    },
  ],
  leave: [
    {
      id: leaveId,
      employeeId,
      employeeName: 'Jad Haddad',
      kind: 'annual',
      startsOn: '2026-09-20',
      endsOn: '2026-09-22',
      reason: 'Family',
      status: 'requested',
      requestedBy: 'Jad Haddad',
      requestedAt: '2026-09-09T08:00:00.000Z',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      version: 1,
    },
  ],
  training: [
    {
      id: 'r1',
      employeeId,
      employeeName: 'Jad Haddad',
      title: 'Working at height',
      provider: null,
      kind: 'safety',
      completedOn: '2025-10-01',
      expiresOn: '2026-10-01',
      reference: 'WAH-77',
      expired: false,
      expiringSoon: true,
    },
  ],
  members: [
    {
      userId: '70000000-0000-4000-8000-000000000001',
      name: 'Jad Haddad',
      roleKey: 'technician',
      linked: true,
    },
    {
      userId: '70000000-0000-4000-8000-000000000002',
      name: 'Rana Khoury',
      roleKey: 'cashier',
      linked: false,
    },
  ],
  branches: [{ id: 'b1', nameEn: 'Hamra', nameAr: 'الحمرا' }],
};

describe('PeopleWorkspace', () => {
  beforeEach(() => {
    readPeopleWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readPeopleWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ leaveId, status: 'approved', version: 2 });
  });

  it('lists employees with today status and approves a leave request', async () => {
    const user = userEvent.setup();
    render(<PeopleWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Jad Haddad')).toBeInTheDocument();
    expect(screen.getByText('On shift')).toBeInTheDocument();
    expect(screen.getByText('On shift now').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Leave to decide').nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'people/commands',
        { command: { action: 'decide_leave', leaveId, expectedVersion: 1, status: 'approved' } },
        expect.stringMatching(/^web-people-/u),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Leave request updated.');
  });

  it('adds an employee linked to an unlinked staff sign-in, in Arabic', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValueOnce({ employeeId: 'new', version: 1 });
    const { container } = render(<PeopleWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'إضافة موظف' }));
    expect(container.querySelector('.reg-shell')).toHaveAttribute('dir', 'rtl');
    await user.type(screen.getByLabelText('رقم الموظف'), 'E-2');
    await user.type(screen.getByLabelText('الاسم'), 'Rana Khoury');
    await user.type(screen.getByLabelText('المسمى الوظيفي'), 'Cashier');
    await user.selectOptions(
      screen.getByLabelText('حساب الموظف'),
      '70000000-0000-4000-8000-000000000002',
    );
    await user.type(screen.getByLabelText('المهارات (مفصولة بفواصل)'), 'cash, billing');
    // The form submit renders after the header button of the same name.
    await user.click(screen.getAllByRole('button', { name: 'إضافة موظف' }).at(-1)!);
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'people/commands',
        {
          command: {
            action: 'upsert_employee',
            employeeNumber: 'E-2',
            userId: '70000000-0000-4000-8000-000000000002',
            displayName: 'Rana Khoury',
            roleTitle: 'Cashier',
            status: 'active',
            skills: ['cash', 'billing'],
          },
        },
        expect.any(String),
      ),
    );
  });

  it('schedules a shift from the schedule view', async () => {
    const user = userEvent.setup();
    submitTenantOperation.mockResolvedValueOnce({ shiftId: 's2' });
    render(<PeopleWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Schedule shift' }));
    await user.selectOptions(screen.getByLabelText('Employee'), employeeId);
    await user.type(screen.getByLabelText('Starts'), '2026-09-12T06:00');
    await user.type(screen.getByLabelText('Ends'), '2026-09-12T14:00');
    await user.click(screen.getAllByRole('button', { name: 'Schedule' }).at(-1)!);
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    const call = submitTenantOperation.mock.calls.at(0);
    expect(call?.[1]).toBe('people/commands');
    const command = (call?.[2] as { command: Record<string, unknown> }).command;
    expect(command.action).toBe('schedule_shift');
    expect(command.employeeId).toBe(employeeId);
    expect(command.kind).toBe('shift');
    expect(
      new Date(String(command.endsAt)).getTime() - new Date(String(command.startsAt)).getTime(),
    ).toBe(8 * 3_600_000);
  });
});
