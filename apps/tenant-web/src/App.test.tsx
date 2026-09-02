import axe from 'axe-core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, tenantOperationsTasks } from './App';
import { tenantCopy } from './copy';
import { operationsTaskCopy } from './operations/OperationsWorkspace';
import { tenantRoutes } from './routes';

describe('Orvex ISP Operations shell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('switches to Arabic RTL without losing the selected module', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Payments & cashier' }));
    await user.click(screen.getByRole('button', { name: 'ع' }));

    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'الدفعات والصندوق' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: operationsTaskCopy.ar['office-payment'].title,
      }),
    ).toBeInTheDocument();
  });

  it('does not present a simulated support grant as active', () => {
    render(<App />);

    expect(screen.queryByRole('region', { name: 'Demonstration support banner' })).toBeNull();
  });

  it('contains mobile navigation focus and restores it after Escape', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    try {
      render(<App />);
      const menu = screen.getByRole('button', {
        name: 'Open Orvex ISP Operations navigation',
      });
      await user.click(menu);

      expect(document.querySelector('.skip-link')).toHaveAttribute('inert');
      expect(document.querySelector('.app-shell__canvas')).toHaveAttribute('inert');
      expect(document.querySelector('.app-shell__canvas')).toHaveAttribute('aria-hidden', 'true');
      expect(document.querySelector('.navigation-scrim')).toHaveAttribute('aria-hidden', 'true');
      expect(document.querySelector('.navigation-scrim')).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('button', { name: 'Operations dashboard' })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(menu).toHaveFocus();
      expect(menu).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.getByRole('link', { name: 'Skip to Orvex ISP Operations content' }),
      ).not.toHaveAttribute('inert');
      expect(document.querySelector('.app-shell__canvas')).not.toHaveAttribute('inert');
      expect(document.querySelector('.side-navigation')).toHaveAttribute('inert');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('exposes semantic navigation, a skip link, and an accessible default shell', async () => {
    const { container } = render(<App />);

    expect(
      screen.getByRole('navigation', { name: 'Orvex ISP Operations navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      screen.getByRole('link', { name: 'Skip to Orvex ISP Operations content' }),
    ).toHaveAttribute('href', '#main-content');
    expect(screen.getByText('ORVEX')).toBeInTheDocument();
    expect(screen.getByText('Orvex ISP Operations')).toBeInTheDocument();
    expect(screen.getAllByText('Demonstration data').length).toBeGreaterThan(0);

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('opens a distinct task view for every operations navigation item', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    for (const item of tenantCopy.en.navigation.slice(1)) {
      const navigationButton = screen
        .getByText(item.label, { selector: '.side-navigation__label' })
        .closest('button');
      expect(navigationButton).not.toBeNull();
      await user.click(navigationButton!);

      expect(navigationButton).toHaveAttribute('aria-current', 'page');
      const operationsTask = tenantOperationsTasks[item.id];
      if (item.id === 'sales') {
        expect(
          screen.getByRole('heading', { level: 3, name: 'Sign in to open Sales' }),
        ).toBeInTheDocument();
      } else if (operationsTask) {
        expect(
          screen.getByRole('heading', {
            level: 1,
            name: operationsTaskCopy.en[operationsTask].title,
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: operationsTaskCopy.en[operationsTask].primary }),
        ).toBeDisabled();
      } else {
        expect(
          screen.getByRole('heading', { level: 1, name: tenantRoutes.en[item.id].title }),
        ).toBeInTheDocument();
        expect(
          screen.getByText(tenantCopy.en.dataStatus, { selector: '.route-disclosure *' }),
        ).toBeVisible();
      }
    }

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('opens the bilingual command center from the keyboard and navigates directly', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Go anywhere' })).toBeVisible();
    const search = screen.getByRole('searchbox', {
      name: 'Search subscribers, invoices, or receipts',
    });
    await user.type(search, 'payments');
    await user.click(screen.getByRole('option', { name: /Payments & cashier/ }));

    expect(window.location.hash).toBe('#/payments');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads a deep link and follows browser back and forward history events', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#/payments');
    render(<App />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: operationsTaskCopy.en['office-payment'].title,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Subscribers' }));
    expect(window.location.hash).toBe('#/subscribers');

    window.history.replaceState(null, '', '#/payments');
    fireEvent.popState(window);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: operationsTaskCopy.en['office-payment'].title,
      }),
    ).toBeInTheDocument();

    window.history.replaceState(null, '', '#/subscribers');
    fireEvent.popState(window);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: operationsTaskCopy.en.subscriber.title,
      }),
    ).toBeInTheDocument();
  });

  it('skips to main content without replacing the active route hash', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#/payments');
    render(<App />);

    await user.click(screen.getByRole('link', { name: 'Skip to Orvex ISP Operations content' }));

    expect(window.location.hash).toBe('#/payments');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Payments & cashier' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: operationsTaskCopy.en['office-payment'].title,
      }),
    ).toBeInTheDocument();
  });
});
