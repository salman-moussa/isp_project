// @vitest-environment jsdom

import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesWorkspace } from './SalesWorkspace';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  apiBaseUrl: 'https://api.example.test',
  logout: vi.fn(),
};

const workspace = {
  leads: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      leadNumber: 'LEAD-1001',
      partyKind: 'business',
      displayName: 'Cedar Studio',
      source: 'referral',
      primaryPhone: '+9611000000',
      branchId: '20000000-0000-4000-8000-000000000001',
      areaId: '30000000-0000-4000-8000-000000000001',
      routeId: '40000000-0000-4000-8000-000000000001',
      addressLine: 'Hamra, Beirut',
      needsSummary: 'Business fiber with stable upload capacity.',
      status: 'won',
      createdAt: '2026-08-30T08:00:00.000Z',
      updatedAt: '2026-08-30T08:20:00.000Z',
    },
  ],
  offers: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      offerId: '50000000-0000-4000-8000-000000000002',
      code: 'BIZ-100',
      version: 1,
      nameEn: 'Business Fiber 100',
      nameAr: 'فايبر أعمال ١٠٠',
      accessTechnology: 'fiber',
      downstreamMbps: 100,
      upstreamMbps: 50,
      recurringAmountMinor: 12500,
      activationFeeMinor: 5000,
      equipmentFeeMinor: 10000,
      currency: 'USD',
      commitmentMonths: 12,
      effectiveFrom: '2026-08-30',
      published: true,
    },
  ],
  qualifications: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      leadId: '10000000-0000-4000-8000-000000000001',
      version: 1,
      result: 'eligible',
      accessTechnology: 'fiber',
      coverageSource: 'POP and building survey',
      reasonCodes: ['coverage_confirmed'],
      capacityReference: 'CAP-HAM-01',
      createdAt: '2026-08-30T08:05:00.000Z',
    },
  ],
  quotes: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      leadId: '10000000-0000-4000-8000-000000000001',
      offerVersionId: '50000000-0000-4000-8000-000000000001',
      quoteNumber: 'Q-1001',
      version: 1,
      status: 'accepted',
      recurringAmountMinor: 12500,
      activationFeeMinor: 5000,
      equipmentFeeMinor: 10000,
      discountBasisPoints: 800,
      currency: 'USD',
      commitmentMonths: 12,
      validUntil: '2026-09-15',
      createdAt: '2026-08-30T08:10:00.000Z',
    },
  ],
  orders: [
    {
      id: '80000000-0000-4000-8000-000000000001',
      leadId: '10000000-0000-4000-8000-000000000001',
      quoteId: '70000000-0000-4000-8000-000000000001',
      orderNumber: 'SO-1001',
      status: 'accepted',
      createdAt: '2026-08-30T08:20:00.000Z',
      tasks: [
        { key: 'commercial_acceptance', type: 'commercial', dependsOn: [], status: 'completed' },
        {
          key: 'subscriber_creation',
          type: 'subscriber',
          dependsOn: ['commercial_acceptance'],
          status: 'ready',
        },
      ],
    },
  ],
  scopes: {
    branches: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        code: 'BEY',
        nameEn: 'Beirut',
        nameAr: 'بيروت',
      },
    ],
    areas: [],
    routes: [],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('SalesWorkspace', () => {
  it('presents real pipeline, effective offers, and order dependencies accessibly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => workspace })),
    );
    const user = userEvent.setup();
    const { container } = render(<SalesWorkspace locale="en" session={session} />);
    expect(await screen.findByText('Cedar Studio')).toBeVisible();
    expect(screen.getByText(/POP and building survey/)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Offer catalogue' }));
    expect(screen.getByText('Business Fiber 100')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Service orders' }));
    expect(screen.getByText('SO-1001')).toBeVisible();
    expect(screen.getByText('Subscriber conversion')).toBeVisible();
    await waitFor(async () => expect((await axe.run(container)).violations).toEqual([]));
  });

  it('shows a truthful Arabic retry state when the governed read fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<SalesWorkspace locale="ar" session={session} />);
    expect(await screen.findByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
  });
});
