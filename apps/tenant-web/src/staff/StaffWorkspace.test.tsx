import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffWorkspace } from './StaffWorkspace';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  apiBaseUrl: 'https://api.example.test',
  logout: vi.fn(),
};

const members = [
  {
    id: '00000000-0000-4000-8000-000000000011',
    email: 'collector@example.com',
    displayName: 'Nour Collector',
    roleKey: 'collector',
    permissions: ['tenant.collection.view', 'tenant.payment.post'],
    active: true,
    mfaRequired: true,
    disabled: false,
    authorizationVersion: 2,
    scope: { routeIds: ['route-a'] },
    createdAt: '2026-08-28T08:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    email: 'admin@example.com',
    displayName: 'Salman Admin',
    roleKey: 'isp_administrator',
    permissions: ['tenant.user.administer'],
    active: true,
    mfaRequired: false,
    disabled: false,
    authorizationVersion: 1,
    scope: {},
    createdAt: '2026-08-28T08:00:00.000Z',
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('StaffWorkspace', () => {
  it('loads, filters, and presents the real access posture accessibly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ members, invitations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          roles: [
            {
              key: 'collector',
              permissions: ['tenant.collection.view'],
              requiresMfa: true,
              scopeMode: 'branch_area_route',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          branches: [],
          areas: [],
          routes: [{ id: 'route-a', code: 'R-A', nameEn: 'Route A', nameAr: 'المسار أ' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sessions: [
            {
              id: '00000000-0000-4000-8000-000000000088',
              deviceLabel: 'Collector phone',
              ipAddress: '192.0.2.10',
              lastSeenAt: '2026-08-29T08:00:00.000Z',
              idleExpiresAt: '2026-08-29T09:00:00.000Z',
              absoluteExpiresAt: '2026-08-30T08:00:00.000Z',
              createdAt: '2026-08-28T08:00:00.000Z',
              current: false,
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { container } = render(<StaffWorkspace locale="en" session={session} />);

    expect(await screen.findByText('Nour Collector')).toBeVisible();
    expect(screen.getAllByText('1', { selector: '.access-metric strong' })).toHaveLength(2);
    expect(screen.getByText('0', { selector: '.access-metric strong' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Sessions' })[0]);
    expect(await screen.findByText('Collector phone')).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search staff' }), 'Salman');
    expect(screen.queryByText('Nour Collector')).not.toBeInTheDocument();
    expect(screen.getByText('Salman Admin')).toBeVisible();
    await waitFor(async () => expect((await axe.run(container)).violations).toEqual([]));
  });

  it('shows a retry path when the protected read fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<StaffWorkspace locale="ar" session={session} />);
    expect(await screen.findByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
  });
});
