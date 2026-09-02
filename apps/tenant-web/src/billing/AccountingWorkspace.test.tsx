import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AccountingWorkspace } from './AccountingWorkspace';

describe('AccountingWorkspace component', () => {
  it('renders English bilingual workspace and switches tabs accessibly', async () => {
    const user = userEvent.setup();
    render(<AccountingWorkspace locale="en" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Double-Entry Accounting & General Ledger' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Chart of Accounts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'General Ledger & Journals' }));
    expect(screen.getByRole('heading', { level: 2, name: 'General Ledger Entries' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trial Balance' }));
    expect(screen.getByRole('heading', { level: 2, name: /Trial Balance as of/ })).toBeInTheDocument();
  });

  it('renders Arabic RTL workspace correctly', () => {
    render(<AccountingWorkspace locale="ar" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'المحاسبة المزدوجة والدفتر العام' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'دليل الحسابات' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
