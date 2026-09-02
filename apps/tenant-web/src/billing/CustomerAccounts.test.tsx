// @vitest-environment jsdom
import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerAccounts } from './CustomerAccounts';
const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  apiBaseUrl: 'https://example.invalid',
  logout: vi.fn(),
};
const workspace = {
  subscribers: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Cedar Studio' }],
  invoices: [],
  entries: [],
};
afterEach(() => vi.unstubAllGlobals());
describe('customer account workspace', () => {
  it('keeps exact amounts and reuses the same idempotency key after a lost response', async () => {
    let posts = 0;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        if (posts === 1) throw new Error('Response lost');
        return { ok: true, status: 201, json: async () => ({ id: 'posted' }) };
      }
      return { ok: true, status: 200, json: async () => workspace };
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CustomerAccounts locale="en" session={session} />);
    await screen.findByRole('option', { name: 'Cedar Studio' });
    await user.selectOptions(screen.getByLabelText('Customer'), workspace.subscribers[0].id);
    await user.type(screen.getByLabelText('Amount (USD)'), '0.29');
    await user.type(screen.getByLabelText('New document / receipt number'), 'DEP-1');
    await user.type(screen.getByLabelText('Unique cash receipt or bank reference'), 'BANK-1');
    await user.type(screen.getByLabelText('Reason in English'), 'Confirmed cash receipt');
    await user.type(screen.getByLabelText('Reason in Arabic'), 'إيصال نقدي مؤكد وموثق');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Post verified entry' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Post verified entry' }));
    await screen.findByText('Posted and audited: DEP-1');
    const calls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(calls).toHaveLength(2);
    const requestBody = calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected JSON request');
    expect((JSON.parse(requestBody) as { amountMinor: number }).amountMinor).toBe(29);
    expect((calls[0]?.[1]?.headers as Record<string, string>)['idempotency-key']).toBe(
      (calls[1]?.[1]?.headers as Record<string, string>)['idempotency-key'],
    );
    expect(screen.getByLabelText('New document / receipt number')).toHaveValue('');
  });
  it('has labelled Arabic controls and an RTL layout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => workspace })),
    );
    const user = userEvent.setup();
    const { container } = render(<CustomerAccounts locale="ar" session={session} />);
    await screen.findByRole('option', { name: 'Cedar Studio' });
    await user.selectOptions(screen.getByLabelText('العميل'), workspace.subscribers[0].id);
    expect(container.querySelector('section')).toHaveAttribute('dir', 'rtl');
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });
  it('shows a denied read with a retry action and does not expose stale records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Denied' } }),
      })),
    );
    render(<CustomerAccounts locale="en" session={session} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load accounts');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    expect(screen.queryByRole('option', { name: 'Cedar Studio' })).not.toBeInTheDocument();
  });
});
