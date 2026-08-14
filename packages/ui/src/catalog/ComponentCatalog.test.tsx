// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ComponentCatalog } from './ComponentCatalog';

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => ({ measureText: () => ({ width: 0 }) }),
});

afterEach(cleanup);

describe('ComponentCatalog', () => {
  it.each([
    ['en', 'ltr'],
    ['ar', 'rtl'],
  ] as const)('has no detectable axe violations in %s/%s', async (locale, direction) => {
    const { container } = render(<ComponentCatalog initialLocale={locale} />);

    expect(container.firstElementChild).toHaveAttribute('lang', locale);
    expect(container.firstElementChild).toHaveAttribute('dir', direction);
    const results = await axe.run(container);

    if (results.violations.length > 0) {
      throw new Error(
        results.violations
          .map(
            ({ help, id, nodes }) =>
              `${id}: ${help} (${nodes.map(({ target }) => target.join(' ')).join(', ')})`,
          )
          .join('\n'),
      );
    }
  });

  it('keeps reference context and state examples intact when direction changes', async () => {
    const user = userEvent.setup();
    const { container } = render(<ComponentCatalog />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No write was attempted');
    expect(screen.getAllByText(/finance\.approve/u)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Arabic' }));

    expect(container.firstElementChild).toHaveAttribute('lang', 'ar');
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByText(/finance\.approve/u)).toHaveLength(2);
    expect(screen.getByText('بيانات مرجعية فقط', { exact: false })).toBeInTheDocument();
  });

  it('uses a caption, scoped headers, labelled mobile list, and separate currencies', () => {
    render(<ComponentCatalog />);

    const table = screen.getByRole('table', {
      name: 'Reference collection accounts and separate currency balances',
    });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Reference collection accounts' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', {
        name: 'Reference collection accounts and separate currency balances',
      }),
    ).toHaveAttribute('tabindex', '0');

    const usdValues = screen.getAllByText('128.00');
    const lbpValues = screen.getAllByText('4,250,000');
    expect(usdValues.every((value) => value.getAttribute('dir') === 'ltr')).toBe(true);
    expect(lbpValues.every((value) => value.getAttribute('dir') === 'ltr')).toBe(true);
    expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LBP').length).toBeGreaterThan(0);
  });

  it('moves focus programmatically from the skip link and from the focus fixture', async () => {
    const user = userEvent.setup();
    render(<ComponentCatalog />);

    await user.tab();
    const skipLink = screen.getByRole('link', { name: 'Skip to component examples' });
    expect(skipLink).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main', { name: 'Orvex ISP component catalog' })).toHaveFocus();

    skipLink.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'English' })).toHaveFocus();

    const focusControl = screen.getByRole('button', { name: 'Move focus to the catalog heading' });
    await user.click(focusControl);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('gives safe fixture controls feedback and exposes unavailable actions as disabled', async () => {
    const user = userEvent.setup();
    render(<ComponentCatalog />);

    await user.click(screen.getAllByRole('button', { name: 'Open reference record' })[0]);
    expect(screen.getByRole('status')).toHaveTextContent('Opened reference record: REF-1042');

    await user.click(screen.getByRole('button', { name: 'Clear example filter' }));
    expect(screen.getByRole('status')).toHaveTextContent('No production data changed');

    await user.click(screen.getByRole('button', { name: 'Retry example read' }));
    expect(screen.getByRole('status')).toHaveTextContent('No request was sent');

    expect(screen.getByRole('button', { name: 'Preview approval action' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'End example' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View escalation guidance' })).toBeDisabled();
    expect(screen.getByText('Approval is disabled because', { exact: false })).toBeVisible();
    expect(screen.getByText('Escalation is disabled because', { exact: false })).toBeVisible();
  });

  it('isolates every rendered technical token in an explicit LTR bidi boundary', () => {
    render(<ComponentCatalog initialLocale="ar" />);

    for (const token of [
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      'REF-1042',
      'REF-1088',
      'USD',
      'LBP',
      '128.00',
      '4,250,000',
      '72.50',
      '0',
      'CATALOG-DEMO',
      'finance.approve',
      'APV-DEMO',
      'AUD-DEMO',
      '09:10',
      '09:14',
      '09:18',
      'Asia/Beirut',
    ]) {
      const matches = screen.getAllByText(token, { exact: true });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((match) => match.tagName === 'BDI' && match.dir === 'ltr')).toBe(true);
    }
  });
});
