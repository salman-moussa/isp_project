import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('keeps approved support access visible, scoped, and revocable', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole('region', { name: 'Approved support session is active' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Billing configuration · read only')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'End session now' }));
    expect(
      screen.queryByRole('region', { name: 'Approved support session is active' }),
    ).not.toBeInTheDocument();
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

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
