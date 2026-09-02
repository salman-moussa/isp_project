import type {
  ChartOfAccountRecord,
  JournalEntryRecord,
  TrialBalanceResponse,
  AccountingPeriodRecord,
} from '@isp/contracts';
import type { ApiSession, Locale } from '@isp/ui';
import { useEffect, useState } from 'react';
import {
  readChartOfAccounts,
  readJournalEntries,
  readTrialBalance,
  readAccountingPeriods,
} from '../api';

interface AccountingWorkspaceProps {
  readonly locale: Locale;
  readonly session?: ApiSession;
}

export function AccountingWorkspace({ locale, session }: AccountingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'coa' | 'journal' | 'trial_balance' | 'periods'>(
    'coa',
  );
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [journalEntries, setJournalEntries] = useState<readonly JournalEntryRecord[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null);
  const [periods, setPeriods] = useState<readonly AccountingPeriodRecord[]>([]);

  const isAr = locale === 'ar';

  useEffect(() => {
    if (!session) return;
    void Promise.all([
      readChartOfAccounts(session).catch(() => []),
      readJournalEntries(session).catch(() => []),
      readTrialBalance(session).catch(() => null),
      readAccountingPeriods(session).catch(() => []),
    ]).then(([accs, entries, tb, pers]) => {
      setAccounts(accs);
      setJournalEntries(entries);
      setTrialBalance(tb);
      setPeriods(pers);
    });
  }, [session]);

  const initialAccounts: readonly ChartOfAccountRecord[] =
    accounts.length > 0
      ? accounts
      : [
          {
            id: '1',
            accountCode: '1010',
            accountNameEn: 'Cashbox USD',
            accountNameAr: 'صندوق المتجر USD',
            accountType: 'asset',
            currency: 'USD',
            isSystem: true,
            active: true,
          },
          {
            id: '2',
            accountCode: '1020',
            accountNameEn: 'Cashbox LBP',
            accountNameAr: 'صندوق المتجر LBP',
            accountType: 'asset',
            currency: 'LBP',
            isSystem: true,
            active: true,
          },
          {
            id: '3',
            accountCode: '1030',
            accountNameEn: 'Bank USD',
            accountNameAr: 'حساب البنك USD',
            accountType: 'asset',
            currency: 'USD',
            isSystem: true,
            active: true,
          },
          {
            id: '4',
            accountCode: '1100',
            accountNameEn: 'Accounts Receivable USD',
            accountNameAr: 'ذمم المشتركين USD',
            accountType: 'asset',
            currency: 'USD',
            isSystem: true,
            active: true,
          },
          {
            id: '5',
            accountCode: '2100',
            accountNameEn: 'Accounts Payable USD',
            accountNameAr: 'ذمم الموردين USD',
            accountType: 'liability',
            currency: 'USD',
            isSystem: true,
            active: true,
          },
          {
            id: '6',
            accountCode: '2200',
            accountNameEn: 'VAT Payable',
            accountNameAr: 'الضريبة على القيمة المضافة',
            accountType: 'liability',
            currency: 'ANY',
            isSystem: true,
            active: true,
          },
          {
            id: '7',
            accountCode: '4000',
            accountNameEn: 'Internet Service Revenue USD',
            accountNameAr: 'إيرادات خدمات الإنترنت USD',
            accountType: 'revenue',
            currency: 'USD',
            isSystem: true,
            active: true,
          },
          {
            id: '8',
            accountCode: '5000',
            accountNameEn: 'Network Operating Expense',
            accountNameAr: 'مصاريف تشغيل الشبكة',
            accountType: 'expense',
            currency: 'ANY',
            isSystem: true,
            active: true,
          },
        ];

  const initialJournalEntries: readonly JournalEntryRecord[] =
    journalEntries.length > 0
      ? journalEntries
      : [
          {
            id: 'je-1',
            entryNumber: 'JE-2026-001',
            entryDate: '2026-09-01',
            descriptionEn: 'Monthly subscriber billing posting',
            descriptionAr: 'ترحيل الفوترة الشهرية للمشتركين',
            sourceType: 'invoice',
            sourceId: 'inv-101',
            status: 'posted',
            postedAt: '2026-09-01T10:00:00Z',
            postedBy: 'system',
            lines: [
              {
                id: 'jl-1',
                accountId: '4',
                accountCode: '1100',
                accountNameEn: 'Accounts Receivable USD',
                accountNameAr: 'ذمم المشتركين USD',
                debitMinor: 45000,
                creditMinor: 0,
                currency: 'USD',
                memoEn: 'AR Invoice #101',
                memoAr: null,
              },
              {
                id: 'jl-2',
                accountId: '7',
                accountCode: '4000',
                accountNameEn: 'Internet Service Revenue USD',
                accountNameAr: 'إيرادات خدمات الإنترنت USD',
                debitMinor: 0,
                creditMinor: 40541,
                currency: 'USD',
                memoEn: 'Net revenue',
                memoAr: null,
              },
              {
                id: 'jl-3',
                accountId: '6',
                accountCode: '2200',
                accountNameEn: 'VAT Payable',
                accountNameAr: 'الضريبة على القيمة المضافة',
                debitMinor: 0,
                creditMinor: 4459,
                currency: 'USD',
                memoEn: '11% VAT',
                memoAr: null,
              },
            ],
          },
        ];

  const initialTrialBalance: TrialBalanceResponse = trialBalance ?? {
    asOfDate: '2026-09-02',
    accounts: [
      {
        accountId: '1',
        accountCode: '1010',
        accountNameEn: 'Cashbox USD',
        accountNameAr: 'صندوق المتجر USD',
        accountType: 'asset',
        debitMinorUsd: 125000,
        creditMinorUsd: 0,
        debitMinorLbp: 0,
        creditMinorLbp: 0,
        netBalanceMinorUsd: 125000,
        netBalanceMinorLbp: 0,
      },
      {
        accountId: '4',
        accountCode: '1100',
        accountNameEn: 'Accounts Receivable USD',
        accountNameAr: 'ذمم المشتركين USD',
        accountType: 'asset',
        debitMinorUsd: 45000,
        creditMinorUsd: 25000,
        debitMinorLbp: 0,
        creditMinorLbp: 0,
        netBalanceMinorUsd: 20000,
        netBalanceMinorLbp: 0,
      },
      {
        accountId: '6',
        accountCode: '2200',
        accountNameEn: 'VAT Payable',
        accountNameAr: 'الضريبة على القيمة المضافة',
        accountType: 'liability',
        debitMinorUsd: 0,
        creditMinorUsd: 4459,
        debitMinorLbp: 0,
        creditMinorLbp: 0,
        netBalanceMinorUsd: -4459,
        netBalanceMinorLbp: 0,
      },
      {
        accountId: '7',
        accountCode: '4000',
        accountNameEn: 'Internet Service Revenue USD',
        accountNameAr: 'إيرادات خدمات الإنترنت USD',
        accountType: 'revenue',
        debitMinorUsd: 0,
        creditMinorUsd: 40541,
        debitMinorLbp: 0,
        creditMinorLbp: 0,
        netBalanceMinorUsd: -40541,
        netBalanceMinorLbp: 0,
      },
    ],
    totalDebitUsd: 170000,
    totalCreditUsd: 70000,
    totalDebitLbp: 0,
    totalCreditLbp: 0,
  };

  const initialPeriods: readonly AccountingPeriodRecord[] =
    periods.length > 0
      ? periods
      : [
          {
            id: 'p-1',
            periodName: '2026-Q1',
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            status: 'hard_closed',
            closedAt: '2026-04-05T12:00:00Z',
            closedBy: 'admin',
          },
          {
            id: 'p-2',
            periodName: '2026-Q2',
            startDate: '2026-04-01',
            endDate: '2026-06-30',
            status: 'hard_closed',
            closedAt: '2026-07-05T12:00:00Z',
            closedBy: 'admin',
          },
          {
            id: 'p-3',
            periodName: '2026-Q3',
            startDate: '2026-07-01',
            endDate: '2026-09-30',
            status: 'open',
            closedAt: null,
            closedBy: null,
          },
        ];

  return (
    <section className="customer-accounts-workspace" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="workspace-header">
        <div>
          <h1>
            {isAr ? 'المحاسبة المزدوجة وميزان المراجعة' : 'Double-entry accounting and trial balance'}
          </h1>
          <p>
            {isAr
              ? 'حوكمة دليل الحسابات القياسي والقيود اليومية وميزان المراجعة والإغلاق الدوري بتوثيق كامل للعملات.'
              : 'Govern standard chart of accounts, journal entries, trial balance, and period close with explicit currency separation.'}
          </p>
        </div>
      </header>

      <nav className="tab-navigation" aria-label={isAr ? 'أقسام المحاسبة' : 'Accounting sections'}>
        <button
          type="button"
          aria-selected={activeTab === 'coa'}
          className={activeTab === 'coa' ? 'is-active' : ''}
          onClick={() => setActiveTab('coa')}
        >
          {isAr ? 'دليل الحسابات' : 'Chart of Accounts'}
        </button>
        <button
          type="button"
          aria-selected={activeTab === 'journal'}
          className={activeTab === 'journal' ? 'is-active' : ''}
          onClick={() => setActiveTab('journal')}
        >
          {isAr ? 'دفتر اليومية العامة' : 'General Ledger & Journals'}
        </button>
        <button
          type="button"
          aria-selected={activeTab === 'trial_balance'}
          className={activeTab === 'trial_balance' ? 'is-active' : ''}
          onClick={() => setActiveTab('trial_balance')}
        >
          {isAr ? 'ميزان المراجعة والقوائم' : 'Trial Balance'}
        </button>
        <button
          type="button"
          aria-selected={activeTab === 'periods'}
          className={activeTab === 'periods' ? 'is-active' : ''}
          onClick={() => setActiveTab('periods')}
        >
          {isAr ? 'الفترات المحاسبية والإغلاق' : 'Accounting Periods & Close'}
        </button>
      </nav>

      {activeTab === 'coa' && (
        <div className="account-panel">
          <h2>{isAr ? 'دليل الحسابات القياسي' : 'Chart of Accounts'}</h2>
          <table className="account-table">
            <thead>
              <tr>
                <th>{isAr ? 'رمز الحساب' : 'Account Code'}</th>
                <th>{isAr ? 'اسم الحساب' : 'Account Name'}</th>
                <th>{isAr ? 'النوع' : 'Type'}</th>
                <th>{isAr ? 'العملة' : 'Currency'}</th>
                <th>{isAr ? 'نوع النظام' : 'System Account'}</th>
                <th>{isAr ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {initialAccounts.map((acc) => (
                <tr key={acc.id}>
                  <td>
                    <code>{acc.accountCode}</code>
                  </td>
                  <td>{isAr ? acc.accountNameAr : acc.accountNameEn}</td>
                  <td>
                    <span className={`badge badge--${acc.accountType}`}>{acc.accountType}</span>
                  </td>
                  <td>{acc.currency}</td>
                  <td>{acc.isSystem ? (isAr ? 'نظامي' : 'System') : isAr ? 'مخصص' : 'Custom'}</td>
                  <td>{acc.active ? (isAr ? 'نشط' : 'Active') : isAr ? 'معطل' : 'Disabled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'journal' && (
        <div className="account-panel">
          <h2>{isAr ? 'دفتر اليومية العامة' : 'General Ledger Entries'}</h2>
          {initialJournalEntries.map((je) => (
            <div key={je.id} className="journal-entry-card">
              <div className="journal-entry-header">
                <strong>{je.entryNumber}</strong> — {je.entryDate} |{' '}
                {isAr ? je.descriptionAr : je.descriptionEn}
                <span className="badge badge--posted">{je.status}</span>
              </div>
              <table className="account-table">
                <thead>
                  <tr>
                    <th>{isAr ? 'الحساب' : 'Account'}</th>
                    <th>{isAr ? 'مدين (Debit)' : 'Debit Minor'}</th>
                    <th>{isAr ? 'دائن (Credit)' : 'Credit Minor'}</th>
                    <th>{isAr ? 'العملة' : 'Currency'}</th>
                    <th>{isAr ? 'ملاحظة' : 'Memo'}</th>
                  </tr>
                </thead>
                <tbody>
                  {je.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <code>{line.accountCode}</code> —{' '}
                        {isAr ? line.accountNameAr : line.accountNameEn}
                      </td>
                      <td>{line.debitMinor > 0 ? (line.debitMinor / 100).toFixed(2) : '-'}</td>
                      <td>{line.creditMinor > 0 ? (line.creditMinor / 100).toFixed(2) : '-'}</td>
                      <td>{line.currency}</td>
                      <td>{line.memoEn ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'trial_balance' && (
        <div className="account-panel">
          <h2>
            {isAr
              ? `ميزان المراجعة بتاريخ ${initialTrialBalance.asOfDate}`
              : `Trial Balance as of ${initialTrialBalance.asOfDate}`}
          </h2>
          <table className="account-table">
            <thead>
              <tr>
                <th>{isAr ? 'رمز الحساب' : 'Code'}</th>
                <th>{isAr ? 'اسم الحساب' : 'Account Name'}</th>
                <th>{isAr ? 'النوع' : 'Type'}</th>
                <th>{isAr ? 'مدين USD' : 'Debit USD'}</th>
                <th>{isAr ? 'دائن USD' : 'Credit USD'}</th>
                <th>{isAr ? 'صافي الرصيد' : 'Net Balance'}</th>
              </tr>
            </thead>
            <tbody>
              {initialTrialBalance.accounts.map((acc) => (
                <tr key={acc.accountId}>
                  <td>
                    <code>{acc.accountCode}</code>
                  </td>
                  <td>{isAr ? acc.accountNameAr : acc.accountNameEn}</td>
                  <td>{acc.accountType}</td>
                  <td>{(acc.debitMinorUsd / 100).toFixed(2)}</td>
                  <td>{(acc.creditMinorUsd / 100).toFixed(2)}</td>
                  <td>
                    <strong>{(acc.netBalanceMinorUsd / 100).toFixed(2)} USD</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <strong>{isAr ? 'الإجمالي' : 'Total'}</strong>
                </td>
                <td>
                  <strong>{(initialTrialBalance.totalDebitUsd / 100).toFixed(2)}</strong>
                </td>
                <td>
                  <strong>{(initialTrialBalance.totalCreditUsd / 100).toFixed(2)}</strong>
                </td>
                <td>-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeTab === 'periods' && (
        <div className="account-panel">
          <h2>{isAr ? 'حالة الفترات المحاسبية وإغلاق الفترة' : 'Accounting Period Management'}</h2>
          <table className="account-table">
            <thead>
              <tr>
                <th>{isAr ? 'الفترة' : 'Period Name'}</th>
                <th>{isAr ? 'من تاريخ' : 'Start Date'}</th>
                <th>{isAr ? 'إلى تاريخ' : 'End Date'}</th>
                <th>{isAr ? 'الحالة' : 'Status'}</th>
                <th>{isAr ? 'تاريخ الإغلاق' : 'Closed At'}</th>
              </tr>
            </thead>
            <tbody>
              {initialPeriods.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.periodName}</strong>
                  </td>
                  <td>{p.startDate}</td>
                  <td>{p.endDate}</td>
                  <td>
                    <span className={`badge badge--${p.status}`}>{p.status}</span>
                  </td>
                  <td>{p.closedAt ?? (isAr ? 'مفتوحة' : 'Open')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
