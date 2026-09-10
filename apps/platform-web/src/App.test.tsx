import axe from 'axe-core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '@isp/ui';
import { platformCopy } from './copy';
import type * as ApiModule from './api';

const api = vi.hoisted(() => ({
  readControlClients: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createControlClient: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlPortfolio: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlClientFile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlPackages: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlSubscriptions: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlBilling: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlAudit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readControlIntegrations: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitControlAction: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  ...api,
}));

const { App } = await import('./App');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const tenantId = '00000000-0000-4000-8000-000000000042';
const portfolio = {
  asOf: '2026-09-09T08:00:00.000Z',
  clients: {
    total: 2,
    byState: [
      { state: 'active', count: 1 },
      { state: 'trial', count: 1 },
    ],
    newThisMonth: 1,
  },
  subscriptions: {
    mrr: [{ currency: 'USD', amountMinor: 25000, subscriptions: 1 }],
    renewalsDue: [
      {
        tenantId,
        tradingName: 'Bekaa Link',
        state: 'active',
        endsAt: '2026-09-30T00:00:00.000Z',
        packageKey: 'growth',
        priceMinor: 25000,
        currency: 'USD',
      },
    ],
    pendingTransitions: 1,
  },
  billing: {
    outstanding: [{ currency: 'USD', amountMinor: 15000, invoices: 1 }],
    receivedThisMonth: [{ currency: 'USD', amountMinor: 10000, payments: 1 }],
  },
  service: {
    healthy: 1,
    attention: 0,
    blocked: 0,
    unknown: 1,
    openTickets: 2,
    escalated: 0,
    activeSupportGrants: 0,
    requestedSupportGrants: 1,
  },
  activity: [
    {
      id: 'a1',
      operation: 'client.create',
      entityType: 'client',
      entityId: tenantId,
      tenantId,
      tradingName: 'Bekaa Link',
      actor: 'Portfolio operator',
      reason: 'Onboarding',
      occurredAt: '2026-09-09T07:00:00.000Z',
    },
  ],
};

describe('Orvex ISP Control Center shell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    for (const mock of Object.values(api)) mock.mockReset();
    api.readControlClients.mockResolvedValue([
      {
        id: tenantId,
        legalName: 'Bekaa Link SAL',
        tradingName: 'Bekaa Link',
        state: 'active',
        packageName: 'growth',
        deploymentHealth: 'healthy',
        supportStatus: 'open',
        openTicketCount: 2,
      },
    ]);
    api.readControlPortfolio.mockResolvedValue(portfolio);
    api.readControlPackages.mockResolvedValue([]);
    api.readControlSubscriptions.mockResolvedValue([]);
    api.readControlBilling.mockResolvedValue({
      asOf: portfolio.asOf,
      outstandingByClient: [],
      invoices: [],
      payments: [],
    });
    api.readControlAudit.mockResolvedValue([]);
    api.readControlIntegrations.mockResolvedValue({
      settings: [],
      recentEvents: [],
      recentDeliveries: [],
    });
    api.readControlClientFile.mockResolvedValue({
      client: {
        id: 'c1',
        tenantId,
        legalName: 'Bekaa Link SAL',
        tradingName: 'Bekaa Link',
        registrationNumber: null,
        accountOwner: null,
        notes: null,
        createdAt: portfolio.asOf,
        tenantCode: 'BEKAA',
        tenantStatus: 'active',
      },
      contacts: [],
      subscription: null,
      transitionRequests: [],
      transitions: [],
      invoices: [],
      payments: [],
      outstanding: [],
      summary: null,
      supportGrants: [],
      audit: [],
    });
  });

  it('shows a sign-in panel for every module before authentication, in Arabic RTL too', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Sign in to open Portfolio overview' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Billing & payments' }));
    await user.click(screen.getByRole('button', { name: 'ع' }));
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'الفوترة والدفعات' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'سجّل الدخول لفتح الفوترة والدفعات' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/demo/iu)).toBeNull();
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('renders the live portfolio overview and opens a client file from a renewal', async () => {
    const user = userEvent.setup();
    render(<App session={session} />);
    expect(await screen.findByText('Active ISP clients')).toBeInTheDocument();
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0);
    expect(screen.getByText('client.create · Bekaa Link')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bekaa Link' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Client file' }),
    ).toBeInTheDocument();
    expect(api.readControlClientFile).toHaveBeenCalledWith(session, tenantId);
    expect(screen.getByText('BEKAA · active')).toBeInTheDocument();
  });

  it('opens a distinct authenticated view for every navigation item', async () => {
    const user = userEvent.setup();
    const { container } = render(<App session={session} />);
    const headings: Record<string, string> = {
      clients: 'ISP client lifecycle',
      sales: 'From lead to active client',
      packages: 'Package versions and entitlements',
      subscriptions: 'Package assignments and their state',
      billing: 'Invoices, receipts and allocations',
      deployments: 'Deployment health per ISP workspace',
      support: 'Client support status and scoped access',
      reports: 'What left the control plane, and who did what',
    };
    for (const item of platformCopy.en.navigation.slice(1)) {
      const navigationButton = screen
        .getByText(item.label, { selector: '.side-navigation__label' })
        .closest('button');
      await user.click(navigationButton!);
      expect(navigationButton).toHaveAttribute('aria-current', 'page');
      if (headings[item.id]) {
        expect(
          await screen.findByRole('heading', { level: 1, name: headings[item.id] }),
        ).toBeInTheDocument();
      } else {
        expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      }
    }
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('loads a deep link and follows browser history events', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#/billing');
    render(<App session={session} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Invoices, receipts and allocations' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ISP clients' }));
    expect(window.location.hash).toBe('#/clients');
    window.history.replaceState(null, '', '#/billing');
    fireEvent.popState(window);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Invoices, receipts and allocations' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('link', { name: 'Skip to Orvex ISP Control Center content' }),
    );
    expect(window.location.hash).toBe('#/billing');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
