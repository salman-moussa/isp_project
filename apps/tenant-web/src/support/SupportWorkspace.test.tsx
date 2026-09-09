import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readSupportWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readSupportWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readSupportWorkspace, submitTenantOperation }));

const { SupportWorkspace } = await import('./SupportWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const subscriberId = '40000000-0000-4000-8000-000000000001';
const issueId = '90000000-0000-4000-8000-000000000001';
const memberId = '70000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  tickets: [
    {
      id: issueId,
      issueNumber: 'TCK-20260909-A1B2C3',
      subject: 'No internet since morning',
      description: 'Router lights are red.',
      priority: 'high',
      category: 'technical',
      channel: 'phone',
      status: 'open',
      subscriberId,
      subscriberName: 'Rana Customer',
      serviceId: null,
      serviceNumber: 'SUP-SVC',
      assigneeUserId: null,
      assigneeName: null,
      escalatedToName: null,
      escalatedAt: null,
      verification: { method: 'contact_match', contact: '+961 3 123456' },
      slaRespondDueAt: '2026-09-09T05:00:00.000Z',
      slaResolveDueAt: '2026-09-10T01:00:00.000Z',
      firstResponseAt: null,
      respondBreached: true,
      resolveBreached: false,
      outageId: null,
      outageTitleEn: null,
      outageTitleAr: null,
      reopenCount: 0,
      redress: {},
      createdAt: '2026-09-09T01:00:00.000Z',
      updatedAt: '2026-09-09T01:00:00.000Z',
      closedAt: null,
      version: 1,
      notes: [],
      history: [],
    },
  ],
  subscribers: [{ id: subscriberId, name: 'Rana Customer', subscriberNumber: 'SUP-SUB' }],
  services: [],
  members: [{ userId: memberId, name: 'Service manager' }],
  openIncidents: [],
  subscriberDirectoryTruncated: false,
  summary: { open: 1, waiting: 0, respondBreached: 1, resolveBreached: 0, escalated: 0 },
};

describe('SupportWorkspace', () => {
  beforeEach(() => {
    readSupportWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readSupportWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ issueId, version: 2 });
  });

  it('opens a verified ticket for a subscriber', async () => {
    const user = userEvent.setup();
    render(<SupportWorkspace locale="en" session={session} />);
    expect(await screen.findByText('No internet since morning')).toBeInTheDocument();
    expect(screen.getByText('Response overdue').nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'New ticket' }));
    await user.selectOptions(screen.getByLabelText('Subscriber'), subscriberId);
    fireEvent.change(screen.getByLabelText('Contact given by caller'), {
      target: { value: '+961 3 123456' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Slow speed in the evening' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Customer reports 2 Mbps after 8pm.' },
    });
    await user.click(screen.getByRole('button', { name: 'Open ticket' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'support/commands',
      {
        command: expect.objectContaining({
          action: 'create_ticket',
          subscriberId,
          channel: 'phone',
          category: 'technical',
          verification: { method: 'contact_match', contact: '+961 3 123456' },
        }) as unknown,
      },
      expect.stringMatching(/^web-support-/u),
    );
  });

  it('escalates the selected ticket at its current version in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<SupportWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: /TCK-20260909-A1B2C3/u }));
    expect(container.querySelector('.sup-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'تصعيد' }));
    await user.selectOptions(screen.getByLabelText('التصعيد إلى'), memberId);
    fireEvent.change(screen.getByLabelText('ملاحظة'), {
      target: { value: 'Needs a field visit decision' },
    });
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'support/commands',
      {
        command: expect.objectContaining({
          action: 'escalate',
          issueId,
          expectedVersion: 1,
          toUserId: memberId,
        }) as unknown,
      },
      expect.any(String),
    );
  });

  it('changes status through the governed transition route with a resolution code', async () => {
    const user = userEvent.setup();
    render(<SupportWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: /TCK-20260909-A1B2C3/u }));
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    await user.selectOptions(screen.getByLabelText('Next status'), 'closed');
    fireEvent.change(screen.getByLabelText('Resolution code (for resolved or closed)'), {
      target: { value: 'duplicate' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'issues/transitions',
      expect.objectContaining({
        issueId,
        expectedVersion: 1,
        toStatus: 'closed',
        evidence: { resolutionCode: 'duplicate' },
      }) as unknown,
      expect.any(String),
    );
  });
});
