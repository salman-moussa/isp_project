// @vitest-environment jsdom

import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingWorkspace } from './BillingWorkspace';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  apiBaseUrl: 'https://api.example.test',
  logout: vi.fn(),
};

const workspace = {
  runs: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      periodStart: '2026-08-01',
      periodEnd: '2026-09-01',
      status: 'failed',
      preparedCount: 4,
      failedCount: 1,
      skippedCount: 0,
      requestedAt: '2026-09-01T08:00:00.000Z',
      completedAt: '2026-09-01T08:01:00.000Z',
      items: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          serviceId: '30000000-0000-4000-8000-000000000001',
          serviceNumber: 'SVC-1001',
          subscriberName: 'Cedar Studio',
          status: 'failed',
          failureCode: 'missing_billing_policy',
          explanationEn: 'No effective legal billing policy covers the service billing date.',
          explanationAr: 'لا توجد سياسة فوترة قانونية نافذة تغطي تاريخ فوترة الخدمة.',
          attemptNumber: 1,
        },
      ],
    },
  ],
  dunningPolicies: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      version: 1,
      paymentTermsDays: 10,
      reminderAfterDays: 2,
      finalNoticeAfterDays: 7,
      suspensionReviewAfterDays: 14,
      effectiveFrom: '2026-08-01',
    },
  ],
  dunningCases: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      documentNumber: 'INV-1001',
      serviceNumber: 'SVC-1001',
      subscriberName: 'Cedar Studio',
      currentStage: 'suspension_review',
      status: 'open',
      dueOn: '2026-08-11',
      outstandingMinor: 18482,
      currency: 'USD',
      version: 3,
      events: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          toStage: 'suspension_review',
          daysOverdue: 22,
          outstandingMinor: 18482,
          explanationEn: 'Invoice INV-1001 reached suspension review after 22 overdue days.',
          explanationAr: 'بلغت الفاتورة INV-1001 مرحلة مراجعة التعليق بعد 22 يوماً من التأخر.',
          occurredAt: '2026-09-02T08:00:00.000Z',
        },
      ],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('BillingWorkspace', () => {
  it('shows failed-only recovery and makes suspension review explicitly manual', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 201, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => workspace };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => '70000000-0000-4000-8000-000000000001' });
    const user = userEvent.setup();
    const { container } = render(<BillingWorkspace locale="en" session={session} />);

    expect(await screen.findByText('Run billing with recoverable outcomes')).toBeVisible();
    expect(screen.getByText(/never sends a router command/i)).toBeVisible();
    expect(screen.getByText('INV-1001')).toBeVisible();
    expect(screen.getAllByText('Suspension review')[0]).toBeVisible();

    await user.click(screen.getByText('2026-08-01 → 2026-09-01'));
    expect(
      screen.getByText('No effective legal billing policy covers the service billing date.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry failed services' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const request = fetchMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].endsWith('/billing-runs'),
    );
    expect(request?.[1]?.body).toContain('retryOfRunId');

    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });
});
