import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('Orvex ISP Operations shell', () => {
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
});
