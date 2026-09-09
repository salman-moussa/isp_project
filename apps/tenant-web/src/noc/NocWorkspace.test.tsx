import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { ApiSession } from '@isp/ui';
import type { NocWorkspace as Workspace, NocIncident, NocAlarm } from '@isp/contracts';
import { NocWorkspace } from './NocWorkspace';
import * as api from '../api';
vi.mock('../api', () => ({ readNocWorkspace: vi.fn(), submitTenantOperation: vi.fn() }));
const id = '10000000-0000-4000-8000-000000000001',
  route = '20000000-0000-4000-8000-000000000001',
  alarmId = '30000000-0000-4000-8000-000000000001';
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
  slaDueAt: '2026-09-02T16:00:00Z',
  slaBreached: true,
  linkedAlarms: 1,
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
const alarm: NocAlarm = {
  id: alarmId,
  deviceName: 'edge-1',
  severity: 'critical',
  alarmCode: 'ROUTER_UNREACHABLE',
  messageEn: 'Router edge-1 did not answer the worker (offline).',
  messageAr: 'لم يستجب الراوتر edge-1 لعامل الشبكة (offline).',
  source: 'worker',
  status: 'active',
  routerId: 'edge-1',
  routeId: route,
  serviceId: id,
  serviceNumber: 'SVC-001',
  outageId: null,
  maintenanceId: null,
  occurrenceCount: 3,
  raisedAt: '2026-09-09T01:00:00Z',
  lastSeenAt: '2026-09-09T01:20:00Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgementNote: null,
  clearedAt: null,
  version: 3,
};
const empty: Workspace = {
  incidents: [],
  routes: [{ id: route, nameEn: 'Test route', nameAr: 'مسار تجريبي' }],
  services: [{ id, routeId: route, serviceNumber: 'SVC-001', subscriberName: 'Fixture customer' }],
  serviceDirectoryTruncated: false,
  alarms: [],
  maintenanceWindows: [],
  routerIds: ['edge-1'],
  alarmSummary: { active: 0, acknowledged: 0, critical: 0, suppressed: 0, slaBreaches: 0 },
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
    await user.click(screen.getAllByRole('button', { name: 'تحديث' })[0]);
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
    expect(screen.getByText('Resolution target').nextElementSibling).toHaveTextContent('Breached');
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
        alarms: 'live',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Show incidents'), 'resolved');
    await waitFor(() =>
      expect(api.readNocWorkspace).toHaveBeenLastCalledWith(session, {
        page: 1,
        pageSize: 25,
        status: 'resolved',
        alarms: 'live',
      }),
    );
  });
  it('shows worker alarms with the summary and acknowledges one at its current version', async () => {
    vi.mocked(api.readNocWorkspace).mockResolvedValue({
      ...empty,
      alarms: [alarm],
      alarmSummary: { active: 1, acknowledged: 0, critical: 1, suppressed: 0, slaBreaches: 0 },
    });
    const user = userEvent.setup();
    render(<NocWorkspace locale="en" session={session} />);
    expect((await screen.findByText('Critical')).nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: /^Alarms/ }));
    expect(screen.getByText('Router edge-1 did not answer the worker (offline).')).toBeVisible();
    expect(screen.getByText(/Seen 3×/)).toBeVisible();
    // No open incident exists, so linking is not offered.
    expect(screen.getByRole('button', { name: 'Link to incident' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Field team dispatched' },
    });
    fireEvent.change(screen.getByLabelText('Reason in English'), {
      target: { value: 'Router power loss confirmed on site' },
    });
    fireEvent.change(screen.getByLabelText('Reason in Arabic'), {
      target: { value: 'تم تأكيد انقطاع طاقة الراوتر في الموقع' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.submitTenantOperation).mock.calls[0]?.[1]).toBe('noc/alarms');
    expect(vi.mocked(api.submitTenantOperation).mock.calls[0]?.[2]).toMatchObject({
      command: {
        action: 'acknowledge_alarm',
        alarmId,
        expectedVersion: 3,
        note: 'Field team dispatched',
      },
    });
  });
  it('plans a maintenance window for a registered router with ISO timestamps in Arabic', async () => {
    const user = userEvent.setup();
    render(<NocWorkspace locale="ar" session={session} />);
    await screen.findByText('لا حوادث في هذا العرض');
    await user.click(screen.getByRole('button', { name: /الصيانة/ }));
    await user.click(screen.getByRole('button', { name: 'تخطيط صيانة' }));
    fireEvent.change(screen.getByLabelText('العنوان بالإنجليزية'), {
      target: { value: 'Edge router firmware' },
    });
    fireEvent.change(screen.getByLabelText('العنوان بالعربية'), {
      target: { value: 'ترقية برمجية للراوتر الطرفي' },
    });
    fireEvent.change(screen.getByLabelText('البداية'), { target: { value: '2026-09-12T02:00' } });
    fireEvent.change(screen.getByLabelText('النهاية'), { target: { value: '2026-09-12T04:00' } });
    await user.selectOptions(screen.getByLabelText('الراوتر (اختياري)'), 'edge-1');
    fireEvent.change(screen.getByLabelText('السبب بالإنجليزية'), {
      target: { value: 'Vendor advisory firmware upgrade' },
    });
    fireEvent.change(screen.getByLabelText('السبب بالعربية'), {
      target: { value: 'ترقية برمجية وفق توصية المورد' },
    });
    await user.click(screen.getByRole('button', { name: 'حفظ النافذة' }));
    await waitFor(() => expect(api.submitTenantOperation).toHaveBeenCalledTimes(1));
    const command = (
      vi.mocked(api.submitTenantOperation).mock.calls[0]?.[2] as {
        command: Record<string, unknown>;
      }
    ).command;
    expect(command).toMatchObject({
      action: 'create_maintenance',
      routerId: 'edge-1',
      expectedImpact: 'degraded',
    });
    expect(command).not.toHaveProperty('routeId');
    expect(String(command.startsAt)).toMatch(/Z$/u);
    expect(Date.parse(String(command.endsAt))).toBeGreaterThan(
      Date.parse(String(command.startsAt)),
    );
  });
});
