// @vitest-environment jsdom

import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriberWorkspace } from './SubscriberWorkspace';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  apiBaseUrl: 'https://api.example.test',
  logout: vi.fn(),
};
const workspace = {
  subscribers: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      subscriberNumber: 'SUB-1001',
      displayName: 'Cedar Studio',
      status: 'active',
      householdReference: 'HH-1001',
      householdName: 'Cedar Studio',
      locationId: '20000000-0000-4000-8000-000000000001',
      locationLabel: 'Office',
      addressLine: 'Hamra, Beirut',
      branchCode: 'BEY',
      areaCode: 'HAM',
      routeCode: 'HAM-01',
      createdAt: '2026-08-31T08:00:00.000Z',
      contacts: [{ kind: 'phone', value: '+9611000000', primary: true }],
    },
  ],
  services: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      subscriberId: '10000000-0000-4000-8000-000000000001',
      serviceNumber: 'SVC-1001',
      status: 'active',
      planId: '40000000-0000-4000-8000-000000000001',
      planCode: 'BIZ-100',
      planNameEn: 'Business Fiber 100',
      planNameAr: 'فايبر أعمال ١٠٠',
      recurringAmountMinor: 12500,
      currency: 'USD',
      billingAnchorDay: 1,
      accessTechnology: 'fiber',
      downstreamMbps: 100,
      upstreamMbps: 50,
      quotaGb: 1000,
      billingMode: 'postpaid',
      fupMode: 'throttle',
      installationStatus: 'completed',
      activatedAt: '2026-08-31T09:00:00.000Z',
    },
  ],
  invoices: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      subscriberId: '10000000-0000-4000-8000-000000000001',
      serviceId: '30000000-0000-4000-8000-000000000001',
      documentNumber: 'INV-1001',
      amountMinor: 13875,
      allocatedMinor: 0,
      outstandingMinor: 13875,
      currency: 'USD',
      postedAt: '2026-08-31T09:05:00.000Z',
    },
  ],
  issues: [],
  plans: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      code: 'BIZ-100',
      nameEn: 'Business Fiber 100',
      nameAr: 'فايبر أعمال ١٠٠',
      recurringAmountMinor: 12500,
      currency: 'USD',
      accessTechnology: 'fiber',
      downstreamMbps: 100,
      upstreamMbps: 50,
      quotaGb: 1000,
      billingMode: 'postpaid',
      fupMode: 'throttle',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      code: 'BIZ-200',
      nameEn: 'Business Fiber 200',
      nameAr: 'فايبر أعمال ٢٠٠',
      recurringAmountMinor: 19000,
      currency: 'USD',
      accessTechnology: 'fiber',
      downstreamMbps: 200,
      upstreamMbps: 100,
      quotaGb: 2000,
      billingMode: 'postpaid',
      fupMode: 'bill',
    },
  ],
  serviceChanges: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('SubscriberWorkspace', () => {
  it('shows the real subscriber 360 record and filters it accessibly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => workspace })),
    );
    const user = userEvent.setup();
    const { container } = render(
      <SubscriberWorkspace locale="en" session={session} onNavigate={vi.fn()} />,
    );
    expect(await screen.findAllByText('Cedar Studio')).not.toHaveLength(0);
    expect(screen.getByText('Business Fiber 100')).toBeVisible();
    expect(screen.getByText('INV-1001')).toBeVisible();
    expect(screen.getByText('+9611000000')).toBeVisible();
    expect(screen.getByText('Lifecycle & change history')).toBeVisible();
    await user.type(screen.getByRole('searchbox'), 'not present');
    expect(screen.getByText('No subscribers match')).toBeVisible();
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });
});
