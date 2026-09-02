import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '@isp/ui';
import type { ChartOfAccountRecord } from '@isp/contracts';
import { AccountingForms } from './AccountingForms';
import { CustomerStatement } from './CustomerStatement';
import * as api from '../api';
vi.mock('../api', () => ({
  submitTenantOperation: vi.fn(),
  readSubscriberWorkspace: vi.fn(),
  readCustomerStatement: vi.fn(),
}));
const session: ApiSession = {
  apiBaseUrl: 'https://example.test',
  tenantId: '10000000-0000-4000-8000-000000000001',
  accessToken: 'test',
  refreshToken: 'test',
  logout: vi.fn(),
};
const accounts: ChartOfAccountRecord[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    accountCode: '1010',
    accountNameEn: 'Cash USD',
    accountNameAr: 'نقد',
    accountType: 'asset',
    currency: 'USD',
    isSystem: true,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    accountCode: '1100',
    accountNameEn: 'Receivables USD',
    accountNameAr: 'ذمم',
    accountType: 'asset',
    currency: 'USD',
    isSystem: true,
    active: true,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.submitTenantOperation).mockResolvedValue({ id: 'confirmed' });
});
async function fillJournal() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Reference'), 'MAN-TEST');
  fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-09-02' } });
  await user.selectOptions(screen.getAllByLabelText('Account')[0], accounts[0].id);
  await user.selectOptions(screen.getAllByLabelText('Account')[1], accounts[1].id);
  await user.type(screen.getAllByLabelText('Amount')[0], '1.25');
  await user.type(screen.getAllByLabelText('Amount')[1], '1.25');
  await user.type(screen.getByLabelText('Reason in English'), 'Documented accounting correction');
  await user.type(screen.getByLabelText('Reason in Arabic'), 'تصحيح محاسبي موثق بالكامل');
  return user;
}
describe('Accounting forms', () => {
  it('posts integer amounts and retains the retry key after a lost response', async () => {
    vi.mocked(api.submitTenantOperation).mockRejectedValueOnce(new Error('connection lost'));
    const posted = vi.fn();
    render(
      <AccountingForms
        locale="en"
        session={session}
        mode="journal"
        accounts={accounts}
        journals={[]}
        disabled={false}
        onPosted={posted}
      />,
    );
    const user = await fillJournal();
    await user.click(screen.getByRole('button', { name: 'Post journal' }));
    await screen.findByRole('alert');
    const first = vi.mocked(api.submitTenantOperation).mock.calls[0];
    expect(first[1]).toBe('accounting/journals');
    expect(first[2]).toMatchObject({
      command: {
        sourceType: 'manual',
        lines: [
          { debitMinor: 125, creditMinor: 0 },
          { debitMinor: 0, creditMinor: 125 },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Post journal' }));
    await screen.findByText('Posting confirmed and recorded in the audit trail.');
    expect(vi.mocked(api.submitTenantOperation).mock.calls[1]?.[3]).toBe(first[3]);
    expect(posted).toHaveBeenCalledTimes(1);
  });
  it('rejects unbalanced entries before an API call', async () => {
    render(
      <AccountingForms
        locale="en"
        session={session}
        mode="journal"
        accounts={accounts}
        journals={[]}
        disabled={false}
        onPosted={() => {}}
      />,
    );
    const user = await fillJournal();
    await user.clear(screen.getAllByLabelText('Amount')[1]);
    await user.type(screen.getAllByLabelText('Amount')[1], '1.24');
    await user.click(screen.getByRole('button', { name: 'Post journal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('balanced amounts');
    expect(api.submitTenantOperation).not.toHaveBeenCalled();
  });
  it('requires explicit close acknowledgement and sends bilingual reasons', async () => {
    const user = userEvent.setup();
    render(
      <AccountingForms
        locale="en"
        session={session}
        mode="periods"
        accounts={[]}
        journals={[]}
        disabled={false}
        onPosted={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Reference'), '2026-09');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-30' } });
    await user.type(screen.getByLabelText('Reason in English'), 'Reviewed period and all postings');
    await user.type(screen.getByLabelText('Reason in Arabic'), 'مراجعة الفترة والقيود بالكامل');
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    expect(api.submitTenantOperation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    expect(vi.mocked(api.submitTenantOperation).mock.calls[0]?.[1]).toBe(
      'accounting/periods/close',
    );
    expect(vi.mocked(api.submitTenantOperation).mock.calls[0]?.[2]).toMatchObject({
      request: {
        periodName: '2026-09',
        closeType: 'soft',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      },
    });
  });
  it('completes MFA through the session adapter without submitting a journal', async () => {
    const user = userEvent.setup(),
      start = vi.fn().mockResolvedValue({ challengeId: 'challenge' }),
      complete = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountingForms
        locale="en"
        session={{ ...session, startMfaStepUp: start, completeMfaStepUp: complete }}
        mode="journal"
        accounts={accounts}
        journals={[]}
        disabled={false}
        onPosted={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Verify identity' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith('challenge', '123456'));
    expect(api.submitTenantOperation).not.toHaveBeenCalled();
  });
});
describe('Customer statement UI', () => {
  it('loads scoped customers, shows amounts and paginates through the API', async () => {
    const user = userEvent.setup();
    vi.mocked(api.readSubscriberWorkspace).mockResolvedValue({
      subscribers: [
        { id: session.tenantId, subscriberNumber: 'S-10', displayName: 'Test customer' },
      ],
    } as never);
    vi.mocked(api.readCustomerStatement).mockImplementation(async (_session, query) => ({
      subscriberId: query.subscriberId,
      subscriberName: 'Test customer',
      currency: 'LBP',
      startDate: '2026-01-01',
      endDate: '2026-09-02',
      openingBalanceMinor: 100000,
      closingBalanceMinor: 90000,
      totalDebitsMinor: 0,
      totalCreditsMinor: 10000,
      entries: [],
      totalCount: 26,
      page: query.page,
      pageSize: 25,
    }));
    render(<CustomerStatement locale="en" session={session} />);
    await screen.findByRole('option', { name: 'S-10 — Test customer' });
    await user.selectOptions(screen.getByLabelText('Customer'), session.tenantId!);
    await user.selectOptions(screen.getByLabelText('Currency'), 'LBP');
    await user.click(screen.getByRole('button', { name: 'View statement' }));
    await screen.findByRole('heading', { name: 'Test customer · LBP' });
    expect(screen.getByText(/Opening balance/)).toHaveTextContent('100,000');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.readCustomerStatement).toHaveBeenLastCalledWith(
        session,
        expect.objectContaining({ page: 2, currency: 'LBP' }),
      ),
    );
  });
  it('shows directory denial without made-up customers', async () => {
    vi.mocked(api.readSubscriberWorkspace).mockRejectedValue(new Error('403'));
    render(<CustomerStatement locale="ar" session={session} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('يلزم إذن عرض المشتركين');
    expect(screen.getByRole('button', { name: 'عرض الكشف' })).toBeDisabled();
  });
});
