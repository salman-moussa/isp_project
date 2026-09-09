import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkWorkspace as Workspace } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readNetworkWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readNetworkWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({
  readNetworkWorkspace,
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

const { NetworkWorkspace } = await import('./NetworkWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};

const workspace: Workspace = {
  routers: [
    {
      routerId: 'core-1',
      endpoint: 'https://core-1.example.test/rest',
      credentialReference: 'secret://routers/core-1',
      connector: 'routeros-rest',
      enabled: true,
      updatedAt: '2026-09-08T10:00:00.000Z',
      boundServices: 1,
      openJobs: 1,
    },
  ],
  bindings: [],
  jobs: [
    {
      jobId: 'network-job-11111111-2222-4333-8444-555555555555',
      state: 'dead_lettered',
      kind: 'pppoe.suspend',
      origin: 'tenant-service-lifecycle',
      routerId: 'core-1',
      serviceId: '10000000-0000-4000-8000-000000000001',
      serviceNumber: 'SVC-100',
      subscriberName: 'Network customer',
      attempts: 4,
      previousAttempts: 0,
      lastErrorClass: 'offline',
      createdAt: '2026-09-08T09:00:00.000Z',
      availableAt: '2026-09-08T09:10:00.000Z',
    },
  ],
  pools: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      poolName: 'static-public',
      subnetCidr: '203.0.113.0/29',
      ipVersion: 'v4',
      gateway: '203.0.113.1',
      purpose: 'static_public',
      active: true,
      version: 1,
      usable: 6,
      allocated: 2,
    },
  ],
  allocations: [],
  nasClients: [],
  cpeDevices: [],
  sessions: [],
  events: [],
  services: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      serviceNumber: 'SVC-100',
      subscriberName: 'Network customer',
      status: 'active',
    },
  ],
};

describe('NetworkWorkspace', () => {
  beforeEach(() => {
    readNetworkWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readNetworkWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ jobId: 'x', state: 'queued' });
  });

  it('shows worker jobs and re-queues a dead-lettered job with evidence', async () => {
    const user = userEvent.setup();
    render(<NetworkWorkspace locale="en" session={session} />);
    expect(
      await screen.findByRole('heading', { name: 'Routers, addresses and subscriber sessions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dead-lettered')).toBeInTheDocument();
    expect(screen.getAllByText('Needs attention')[0]?.nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.type(screen.getByLabelText('Reason (English)'), 'Router back online');
    await user.type(screen.getByLabelText('Reason (Arabic)'), 'عاد الراوتر للعمل');
    await user.type(screen.getByLabelText('Evidence reference'), 'NOC ticket 2026-091');
    await user.click(screen.getByRole('button', { name: 'Re-queue' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'network/resources',
      {
        command: {
          action: 'retry_job',
          jobId: 'network-job-11111111-2222-4333-8444-555555555555',
          reasonEn: 'Router back online',
          reasonAr: 'عاد الراوتر للعمل',
          evidence: 'NOC ticket 2026-091',
        },
      },
      expect.stringMatching(/^web-network-/u),
    );
  });

  it('allocates the next free address for a service from a pool', async () => {
    const user = userEvent.setup();
    render(<NetworkWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: /IP pools/u }));
    expect(screen.getByText('2 of 6 addresses allocated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allocate' }));
    await user.selectOptions(
      screen.getByLabelText('Service'),
      '10000000-0000-4000-8000-000000000001',
    );
    await user.type(screen.getByLabelText('Reason (English)'), 'Static IP for business line');
    await user.type(screen.getByLabelText('Reason (Arabic)'), 'عنوان ثابت لخط الأعمال');
    await user.type(screen.getByLabelText('Evidence reference'), 'Contract addendum 12');
    await user.click(screen.getByRole('button', { name: 'Allocate address' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'network/resources',
      {
        command: expect.objectContaining({
          action: 'allocate_service_address',
          poolId: '20000000-0000-4000-8000-000000000001',
          serviceId: '10000000-0000-4000-8000-000000000001',
        }) as unknown,
      },
      expect.any(String),
    );
  });

  it('sends router registration through the infrastructure route in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<NetworkWorkspace locale="ar" session={session} />);
    await user.click(await screen.findByRole('button', { name: /الراوترات/u }));
    expect(container.querySelector('.network-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: 'تسجيل راوتر' }));
    await user.type(screen.getByLabelText('معرّف الراوتر'), 'edge-2');
    await user.type(screen.getByLabelText('نقطة اتصال HTTPS'), 'https://edge-2.example.test/rest');
    await user.type(screen.getByLabelText('مرجع الوصول (secret://…)'), 'secret://routers/edge-2');
    await user.type(screen.getByLabelText('السبب (بالإنجليزية)'), 'Second edge router');
    await user.type(screen.getByLabelText('السبب (بالعربية)'), 'راوتر طرفي ثانٍ');
    await user.type(screen.getByLabelText('مرجع الدليل'), 'Change CHG-2026-100');
    await user.click(screen.getByRole('button', { name: 'حفظ الراوتر' }));
    await waitFor(() => expect(submitTenantOperation).toHaveBeenCalled());
    expect(submitTenantOperation).toHaveBeenCalledWith(
      session,
      'network/infrastructure',
      {
        command: expect.objectContaining({
          action: 'register_router',
          routerId: 'edge-2',
          routerAccessReference: 'secret://routers/edge-2',
          connector: 'routeros-rest',
          enabled: true,
        }) as unknown,
      },
      expect.any(String),
    );
  });
});
