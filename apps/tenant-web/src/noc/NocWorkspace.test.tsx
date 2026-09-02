import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { ApiSession } from '@isp/ui';
import type { NocWorkspace as Workspace, NocIncident } from '@isp/contracts';
import { NocWorkspace } from './NocWorkspace';
import * as api from '../api';
vi.mock('../api', () => ({ readNocWorkspace: vi.fn(), submitTenantOperation: vi.fn() }));
const id = '10000000-0000-4000-8000-000000000001',
  route = '20000000-0000-4000-8000-000000000001';
const session: ApiSession = {
  apiBaseUrl: 'https://example.test',
  tenantId: id,
  accessToken: 'test',
  refreshToken: 'test',
  logout: vi.fn(),
};
const incident: NocIncident = {
  id,
  routeId: route,
  outageTitleEn: 'Upstream cabinet power',
  outageTitleAr: 'طاقة خزانة الشبكة',
  affectedRegion: 'Test route',
  impactedSubscribersCount: 1,
  startedAt: '2026-09-02T12:00:00Z',
  resolvedAt: null,
  rootCauseEn: null,
  rootCauseAr: null,
  status: 'monitoring',
  severity: 'major',
  version: 3,
  serviceIds: [id],
  events: [
    {
      id,
      version: 3,
      status: 'monitoring',
      reasonEn: 'Monitoring confirmed recovery',
      reasonAr: 'مراقبة استعادة الخدمة المؤكدة',
      occurredAt: '2026-09-02T12:10:00Z',
      resolutionEvidence: null,
    },
  ],
};
const empty: Workspace = {
  incidents: [],
  routes: [{ id: route, nameEn: 'Test route', nameAr: 'مسار تجريبي' }],
  services: [{ id, routeId: route, serviceNumber: 'SVC-001', subscriberName: 'Fixture customer' }],
  serviceDirectoryTruncated: false,
  page: 1,
  pageSize: 25,
  totalCount: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readNocWorkspace).mockResolvedValue(empty);
  vi.mocked(api.submitTenantOperation).mockResolvedValue({ id });
});
describe('NOC workflow', () => {
  it('requires sign-in and does not show invented health metrics', () => {
    render(<NocWorkspace locale="en" />);
    expect(screen.getByText(/Sign in to view/)).toBeVisible();
    expect(api.readNocWorkspace).not.toHaveBeenCalled();
  });
  it('renders a true empty state and retries a denied or failed read in Arabic', async () => {
    vi.mocked(api.readNocWorkspace).mockRejectedValueOnce(new Error('denied'));
    const user = userEvent.setup();
    render(<NocWorkspace locale="ar" session={session} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('مساحة العمل غير متاحة');
    await user.click(screen.getByRole('button', { name: 'تحديث' }));
    expect(await screen.findByText('لا حوادث في هذا العرض')).toBeVisible();
    expect(screen.getByText('لا حوادث في هذا العرض').closest('.noc-shell')).toHaveAttribute(
      'dir',
      'rtl',
    );
  });
  it('creates from actual scoped services and preserves the key on a lost response', async () => {
    const user = userEvent.setup();
    render(<NocWorkspace locale="en" session={session} />);
    await screen.findByText('No incidents in this view');
    await user.click(screen.getByRole('button', { name: 'Record incident' }));
    fireEvent.change(screen.getByLabelText('Title in English'), {
      target: { value: 'Circuit interruption' },
    });
    fireEvent.change(screen.getByLabelText('Title in Arabic'), {
      target: { value: 'انقطاع الدارة الرئيسية' },
    });
    await user.selectOptions(screen.getByLabelText('Route'), route);
    await user.click(screen.getByRole('checkbox', { name: /SVC-001/ }));
    fireEvent.change(screen.getByLabelText('Reason in English'), {
      target: { value: 'Confirmed by operator and customer' },
    });
    fireEvent.change(screen.getByLabelText('Reason in Arabic'), {
      target: { value: 'تم التحقق بواسطة المشغل والعميل' },
    });
    vi.mocked(api.submitTenantOperation).mockRejectedValueOnce(new Error('lost response'));
    await user.click(screen.getByRole('button', { name: 'Create incident' }));
    await screen.findByRole('alert');
    const first = vi.mocked(api.submitTenantOperation).mock.calls[0];
    expect(first?.[2]).toMatchObject({
      command: { routeId: route, serviceIds: [id], severity: 'major' },
    });
    expect(first?.[2]).not.toHaveProperty('command.impactedSubscribersCount');
    await user.click(screen.getByRole('button', { name: 'Create incident' }));
    await screen.findByText('Incident saved. History and audit evidence were recorded.');
    expect(vi.mocked(api.submitTenantOperation).mock.calls[1]?.[3]).toBe(first?.[3]);
  });
  it('requires resolution evidence and acknowledgement; submits the current version', async () => {
    vi.mocked(api.readNocWorkspace).mockResolvedValue({
      ...empty,
      incidents: [incident],
      totalCount: 1,
    });
    const user = userEvent.setup();
    render(<NocWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: /Upstream cabinet power/ }));
    await user.click(screen.getByRole('button', { name: 'Save status update' }));
    expect(api.submitTenantOperation).not.toHaveBeenCalled();
    for (const [label, value] of [
      ['Reason in English', 'Recovery verified with the customer'],
      ['Reason in Arabic', 'تم التحقق من التعافي لدى العميل'],
      ['Root cause in English', 'Upstream cabinet power loss'],
      ['Root cause in Arabic', 'انقطاع طاقة الخزانة الرئيسية'],
      ['Recovery verification evidence', 'Technician and subscriber confirm recovery'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save status update' }));
    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.submitTenantOperation).mock.calls[0]?.[2]).toMatchObject({
      command: { outageId: id, expectedVersion: 3, status: 'resolved' },
    });
  });
  it('requests server pagination and status filters', async () => {
    vi.mocked(api.readNocWorkspace).mockResolvedValue({ ...empty, totalCount: 26 });
    const user = userEvent.setup();
    render(<NocWorkspace locale="en" session={session} />);
    await screen.findByText('No incidents in this view');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.readNocWorkspace).toHaveBeenLastCalledWith(session, {
        page: 2,
        pageSize: 25,
        status: 'open',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Show incidents'), 'resolved');
    await waitFor(() =>
      expect(api.readNocWorkspace).toHaveBeenLastCalledWith(session, {
        page: 1,
        pageSize: 25,
        status: 'resolved',
      }),
    );
  });
});
