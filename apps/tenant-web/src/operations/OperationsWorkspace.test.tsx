import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationsWorkspace } from './OperationsWorkspace';

describe('OperationsWorkspace', () => {
  it('renders bilingual task copy and never offers subscriber login', () => {
    render(<OperationsWorkspace locale="ar" initialTask="subscriber" />);
    expect(screen.getByRole('heading', { name: 'إضافة خدمة مشترك' })).toBeInTheDocument();
    expect(screen.queryByText(/تسجيل الدخول/)).not.toBeInTheDocument();
    expect(document.querySelector('[dir="rtl"]')).toBeInTheDocument();
  });

  it('disables mutations offline without claiming durable local storage', () => {
    const retry = vi.fn();
    render(<OperationsWorkspace locale="en" state="offline" onRetry={retry} />);
    expect(screen.getByRole('button', { name: 'Save subscriber draft' })).toBeDisabled();
    expect(screen.getByText(/remain on this screen only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry safely' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('moves focus with task-first views', () => {
    render(<OperationsWorkspace locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile a collector route' }));
    const heading = screen.getByRole('heading', { name: 'Reconcile a collector route' });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/independently for USD and LBP/)).toBeInTheDocument();
  });

  it('defaults to a truthful empty state rather than claiming a save', () => {
    render(<OperationsWorkspace locale="en" />);
    expect(screen.getByText('No task result yet')).toBeInTheDocument();
    expect(screen.queryByText('Task saved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save subscriber draft' })).toBeDisabled();
    expect(screen.getByText(/available after authenticated access/)).toBeInTheDocument();
  });

  it('submits a production billing payload with an idempotency key', async () => {
    const submit = vi.fn(async () => ({ id: 'billing-run-1' }));
    render(<OperationsWorkspace locale="en" initialTask="billing" onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invoice batch' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith(
      'billing',
      { periodStart: '2026-08-01', periodEnd: '2026-09-01' },
      expect.stringMatching(/^web-/u),
    );
    expect(screen.getByText(/billing-run-1/)).toBeInTheDocument();
  });
});
