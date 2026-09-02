// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvoiceArchive } from './InvoiceArchive';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tenantId: 'tenant',
  apiBaseUrl: 'https://api.example.test',
  logout: vi.fn(),
};
const workspace = {
  runs: [],
  dunningPolicies: [],
  dunningCases: [],
  documentStorageConfigured: true,
  documentInvoices: [{ id: 'invoice-1', documentNumber: 'INV-1' }],
  invoiceDocuments: [],
};
afterEach(() => vi.unstubAllGlobals());
describe('InvoiceArchive', () => {
  it('generates the selected invoice and exposes retryable failure without changing the invoice', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'archive-1' }) }));
    vi.stubGlobal('fetch', fetch);
    const reload = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<InvoiceArchive locale="en" session={session} workspace={workspace} reload={reload} />);
    await user.selectOptions(screen.getByLabelText('Posted invoice'), 'invoice-1');
    await user.click(screen.getByRole('button', { name: 'Generate / recover PDF' }));
    expect(await screen.findByText('Document operation completed.')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invoice-documents'),
      expect.objectContaining({ body: JSON.stringify({ invoiceId: 'invoice-1' }) }),
    );
    fetch.mockRejectedValueOnce(new Error('Offline'));
    await user.click(screen.getByRole('button', { name: 'Generate / recover PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no invoice was changed');
  });
  it('makes missing storage explicit in Arabic and prevents an unusable request', () => {
    render(
      <InvoiceArchive
        locale="ar"
        session={session}
        workspace={{ ...workspace, documentStorageConfigured: false }}
        reload={async () => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('إعداد تخزين المستندات');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
