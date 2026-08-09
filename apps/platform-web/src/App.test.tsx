import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Orvex ISP Control Center shell', () => {
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
  });

  it('exposes semantic navigation, skip link, and an accessible default shell', async () => {
    const { container } = render(<App />);

    expect(screen.getByRole('navigation', { name: 'Platform navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: 'Skip to platform content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByText('ORVEX')).toBeInTheDocument();
    expect(screen.getByText('Orvex ISP Control Center')).toBeInTheDocument();
    expect(screen.getByText('Demonstration data')).toBeInTheDocument();

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
