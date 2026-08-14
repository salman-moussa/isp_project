import axe from 'axe-core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { platformCopy } from './copy';
import { platformRoutes } from './routes';

describe('Orvex ISP Control Center shell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('switches to Arabic RTL without losing the current module', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Billing & payments' }));
    await user.click(screen.getByRole('button', { name: 'ع' }));

    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'الفوترة والدفعات' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: platformRoutes.ar.billing.title }),
    ).toBeInTheDocument();
  });

  it('exposes semantic navigation, skip link, and an accessible default shell', async () => {
    const { container } = render(<App />);

    expect(
      screen.getByRole('navigation', { name: 'Orvex ISP Control Center navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      screen.getByRole('link', { name: 'Skip to Orvex ISP Control Center content' }),
    ).toHaveAttribute('href', '#main-content');
    expect(screen.getByText('ORVEX')).toBeInTheDocument();
    expect(screen.getByText('Orvex ISP Control Center')).toBeInTheDocument();
    expect(screen.getByText('Demonstration data')).toBeInTheDocument();

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('opens a distinct task view for every platform navigation item', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    for (const item of platformCopy.en.navigation.slice(1)) {
      const navigationButton = screen
        .getByText(item.label, { selector: '.side-navigation__label' })
        .closest('button');
      expect(navigationButton).not.toBeNull();
      await user.click(navigationButton!);

      expect(navigationButton).toHaveAttribute('aria-current', 'page');
      if (item.id === 'clients') {
        expect(
          screen.getByRole('heading', { level: 1, name: 'ISP client lifecycle' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Northline ISP (demo)')).toBeVisible();
      } else {
        expect(
          screen.getByRole('heading', { level: 1, name: platformRoutes.en[item.id].title }),
        ).toBeInTheDocument();
        expect(
          screen.getByText(platformCopy.en.environment, { selector: '.route-disclosure *' }),
        ).toBeVisible();
        expect(
          screen.getByRole('heading', {
            level: 2,
            name: platformRoutes.en[item.id].metrics[0].label,
          }),
        ).toBeInTheDocument();
      }
    }

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('mounts the Control Center workspace with working demonstration filters', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'ISP clients' }));

    await user.type(screen.getByRole('searchbox'), 'Metn');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText('Metn Fiber (demo)')).toBeVisible();
    expect(screen.queryByText('Northline ISP (demo)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add ISP client' })).not.toBeInTheDocument();
  });

  it('loads a deep link and follows browser back and forward history events', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#/billing');
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: platformRoutes.en.billing.title }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ISP clients' }));
    expect(window.location.hash).toBe('#/clients');

    window.history.replaceState(null, '', '#/billing');
    fireEvent.popState(window);
    expect(
      screen.getByRole('heading', { level: 1, name: platformRoutes.en.billing.title }),
    ).toBeInTheDocument();

    window.history.replaceState(null, '', '#/clients');
    fireEvent.popState(window);
    expect(
      screen.getByRole('heading', { level: 1, name: 'ISP client lifecycle' }),
    ).toBeInTheDocument();
  });

  it('skips to main content without replacing the active route hash', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#/billing');
    render(<App />);

    await user.click(
      screen.getByRole('link', { name: 'Skip to Orvex ISP Control Center content' }),
    );

    expect(window.location.hash).toBe('#/billing');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Billing & payments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: platformRoutes.en.billing.title }),
    ).toBeInTheDocument();
  });
});
