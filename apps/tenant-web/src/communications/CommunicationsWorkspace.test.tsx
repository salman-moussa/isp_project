import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readCommunicationsWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readCommunicationsWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readCommunicationsWorkspace, submitTenantOperation }));

const { CommunicationsWorkspace } = await import('./CommunicationsWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const subscriberId = '40000000-0000-4000-8000-000000000001';
const workspace: Workspace = {
  templates: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      templateKey: 'outage.notice',
      channel: 'sms',
      nameEn: 'Outage notice',
      nameAr: 'إشعار انقطاع',
      subjectEn: null,
      subjectAr: null,
      bodyEn: 'Service in {{area}} is interrupted.',
      bodyAr: 'الخدمة في {{area}} متوقفة.',
      status: 'approved',
      approvedBy: 'Service manager',
      approvedAt: '2026-09-09T01:00:00.000Z',
      createdBy: 'Rana Analyst',
      version: 2,
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      templateKey: 'invoice.ready',
      channel: 'email',
      nameEn: 'Invoice ready',
      nameAr: 'الفاتورة جاهزة',
      subjectEn: 'Your invoice is ready',
      subjectAr: 'فاتورتك جاهزة',
      bodyEn: 'Hello {{subscriberName}}',
      bodyAr: 'مرحباً {{subscriberName}}',
      status: 'draft',
      approvedBy: null,
      approvedAt: null,
      createdBy: 'Rana Analyst',
      version: 1,
    },
  ],
  consents: [],
  notifications: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      subscriberId,
      subscriberName: 'Rana Customer',
      channel: 'sms',
      destinationMasked: '+961…56',
      templateKey: 'outage.notice',
      locale: 'ar',
      subject: null,
      body: 'الخدمة في الحمرا متوقفة.',
      status: 'queued',
      suppressionReason: null,
      attempts: 0,
      lastError: null,
      providerReference: null,
      relatedType: 'manual',
      relatedId: null,
      requestedBy: 'Service agent',
      createdAt: '2026-09-09T02:00:00.000Z',
      nextAttemptAt: '2026-09-09T02:00:00.000Z',
      sentAt: null,
      version: 1,
    },
  ],
  subscribers: [{ id: subscriberId, name: 'Rana Customer', subscriberNumber: 'SUP-SUB' }],
  subscriberDirectoryTruncated: false,
  providers: [
    { channel: 'sms', configured: true },
    { channel: 'whatsapp', configured: false },
    { channel: 'email', configured: false },
  ],
  summary: { queued: 1, sentToday: 0, failed: 0, suppressed: 0, approvedTemplates: 1 },
};

describe('CommunicationsWorkspace', () => {
  beforeEach(() => {
    readCommunicationsWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readCommunicationsWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ notificationId: 'x', status: 'queued' });
  });

  it('queues a message from an approved template with variables and runs delivery', async () => {
    const user = userEvent.setup();
    render(<CommunicationsWorkspace locale="en" session={session} />);
    expect(await screen.findByText(/SMS configured/u)).toBeInTheDocument();
    expect(screen.getByText('Queued').nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Queue a message' }));
    await user.selectOptions(screen.getByLabelText('Subscriber'), subscriberId);
    await user.selectOptions(screen.getByLabelText('Template'), 'outage.notice');
    fireEvent.change(screen.getByLabelText('Variables, one per line as key=value'), {
      target: { value: 'area=Hamra\nticket=TCK-1' },
    });
    await user.click(screen.getByRole('button', { name: 'Queue message' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(1));
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'communications/commands',
      {
        command: expect.objectContaining({
          action: 'queue_notification',
          subscriberId,
          templateKey: 'outage.notice',
          locale: 'en',
          variables: { area: 'Hamra', ticket: 'TCK-1' },
        }) as unknown,
      },
      expect.stringMatching(/^web-comms-/u),
    );
    submitTenantOperation.mockResolvedValueOnce({ attempted: 1, sent: 1, failed: 0, skipped: [] });
    await user.click(screen.getByRole('button', { name: 'Send queued now' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(2));
    expect(submitTenantOperation.mock.calls[1]?.[1]).toBe('communications/deliver');
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 0 failed, 0 skipped');
  });

  it('approves a draft template at its version and records consent in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommunicationsWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'القوالب' }));
    expect(container.querySelector('.cm-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'اعتماد' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(1));
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'communications/templates',
      { command: { action: 'approve_template', templateKey: 'invoice.ready', expectedVersion: 1 } },
      expect.any(String),
    );
    await user.click(screen.getByRole('button', { name: 'الموافقات' }));
    await user.click(screen.getByRole('button', { name: 'تسجيل موافقة' }));
    await user.selectOptions(screen.getByLabelText('المشترك'), subscriberId);
    await user.selectOptions(screen.getByLabelText('القرار'), 'no');
    await user.click(screen.getByRole('button', { name: 'تسجيل' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalledTimes(2));
    expect(submitTenantOperation.mock.calls[1]?.[2]).toMatchObject({
      command: { action: 'record_consent', subscriberId, channel: 'sms', allowed: false },
    });
  });
});
