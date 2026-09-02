import './billing.css';
import { CustomerStatement } from './CustomerStatement';
import { AccountingForms } from './AccountingForms';
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
  const [activeTab, setActiveTab] = useState<
    'coa' | 'journal' | 'trial_balance' | 'periods' | 'statement'
  >('coa');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [trialCurrency, setTrialCurrency] = useState<'USD' | 'LBP'>('USD');
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [journalEntries, setJournalEntries] = useState<readonly JournalEntryRecord[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null);
  const [periods, setPeriods] = useState<readonly AccountingPeriodRecord[]>([]);

  const isAr = locale === 'ar';

  const money = (minor: number, currency: 'USD' | 'LBP') =>
    new Intl.NumberFormat(isAr ? 'ar-LB' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'USD' ? 2 : 0,
      maximumFractionDigits: currency === 'USD' ? 2 : 0,
    }).format(minor / (currency === 'USD' ? 100 : 1));
  const labels = {
    asset: isAr ? 'أصول' : 'Asset',
    liability: isAr ? 'التزامات' : 'Liability',
    equity: isAr ? 'حقوق الملكية' : 'Equity',
    revenue: isAr ? 'إيرادات' : 'Revenue',
    expense: isAr ? 'مصروفات' : 'Expense',
    posted: isAr ? 'مرحّل' : 'Posted',
    reversed: isAr ? 'معكوس' : 'Reversed',
    open: isAr ? 'مفتوحة' : 'Open',
    soft_closed: isAr ? 'إغلاق أولي' : 'Soft closed',
    hard_closed: isAr ? 'إغلاق نهائي' : 'Hard closed',
  };
  useEffect(() => {
    let current = true;
    setLoadState('loading');
    setAccounts([]);
    setJournalEntries([]);
    setTrialBalance(null);
    setPeriods([]);
    if (!session)
      return () => {
        current = false;
      };
    void Promise.all([
      readChartOfAccounts(session),
      readJournalEntries(session),
      readTrialBalance(session),
      readAccountingPeriods(session),
    ])
      .then(([accs, entries, tb, pers]) => {
        if (!current) return;
        setAccounts(accs);
        setJournalEntries(entries);
        setTrialBalance(tb);
        setPeriods(pers);
        setLoadState('ready');
      })
      .catch(() => {
        if (current) setLoadState('error');
      });
    return () => {
      current = false;
    };
  }, [session, retry]);
  const empty =
    activeTab !== 'statement' &&
    loadState === 'ready' &&
    (activeTab === 'coa'
      ? accounts.length === 0
      : activeTab === 'journal'
        ? journalEntries.length === 0
        : activeTab === 'periods'
          ? periods.length === 0
          : trialBalance?.accounts.length === 0);

  return (
    <section className="customer-accounts-workspace" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="workspace-header">
        <div>
          <h1>
            {isAr
              ? 'المحاسبة المزدوجة وميزان المراجعة'
              : 'Double-entry accounting and trial balance'}
          </h1>
          <p>
            {isAr
              ? 'حوكمة دليل الحسابات القياسي والقيود اليومية وميزان المراجعة والإغلاق الدوري بتوثيق كامل للعملات.'
              : 'Govern standard chart of accounts, journal entries, trial balance, and period close with explicit currency separation.'}
          </p>
        </div>
      </header>

      {!session && (
        <p role="alert">{isAr ? 'سجّل الدخول لعرض المحاسبة.' : 'Sign in to view accounting.'}</p>
      )}
      {session && loadState === 'loading' && (
        <p role="status">{isAr ? 'جارٍ تحميل المحاسبة…' : 'Loading accounting…'}</p>
      )}
      {session && loadState === 'error' && (
        <div role="alert">
          <p>
            {isAr
              ? 'تعذر تحميل المحاسبة. تحقق من صلاحية الوصول والاتصال ثم أعد المحاولة.'
              : 'Accounting could not be loaded. Check your access and connection, then retry.'}
          </p>
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {empty && (
        <p role="status">
          {isAr ? 'لا توجد سجلات محاسبية في هذا القسم.' : 'No accounting records in this section.'}
        </p>
      )}
      {loadState === 'ready' &&
        (!trialBalance?.coverage ||
          trialBalance.coverage.hasUnjournaledSources !== false ||
          trialBalance.coverage.hasLegacyEntries ||
          trialBalance.coverage.hasUnclassifiedEntries !== false ||
          trialBalance.coverage.hasUnjournaledInvoices) && (
          <p role="alert">
            {isAr
              ? 'هذا الدفتر غير مكتمل أو يحتاج إلى تسوية. لا تعتمد عليه كقوائم مالية نهائية. الإغلاق مشروط بتغطية القيود والتسوية.'
              : 'This ledger is incomplete or needs reconciliation. Do not treat it as final financial statements. Period close requires complete posting coverage and reconciliation.'}
          </p>
        )}
      <nav className="tab-navigation" aria-label={isAr ? 'أقسام المحاسبة' : 'Accounting sections'}>
        <button
          type="button"
          aria-pressed={activeTab === 'coa'}
          className={activeTab === 'coa' ? 'is-active' : ''}
          onClick={() => setActiveTab('coa')}
        >
          {isAr ? 'دليل الحسابات' : 'Chart of Accounts'}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'journal'}
          className={activeTab === 'journal' ? 'is-active' : ''}
          onClick={() => setActiveTab('journal')}
        >
          {isAr ? 'دفتر اليومية العامة' : 'General Ledger & Journals'}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'trial_balance'}
          className={activeTab === 'trial_balance' ? 'is-active' : ''}
          onClick={() => setActiveTab('trial_balance')}
        >
          {isAr ? 'ميزان المراجعة والقوائم' : 'Trial Balance'}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'periods'}
          className={activeTab === 'periods' ? 'is-active' : ''}
          onClick={() => setActiveTab('periods')}
        >
          {isAr ? 'الفترات المحاسبية والإغلاق' : 'Accounting Periods & Close'}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'statement'}
          onClick={() => setActiveTab('statement')}
        >
          {isAr ? 'كشف حساب العميل' : 'Customer statement'}
        </button>
      </nav>

      {session && loadState === 'ready' && activeTab === 'coa' && (
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
              {accounts.map((acc) => (
                <tr key={acc.id}>
                  <td>
                    <code>{acc.accountCode}</code>
                  </td>
                  <td>{isAr ? acc.accountNameAr : acc.accountNameEn}</td>
                  <td>
                    <span className={`badge badge--${labels[acc.accountType]}`}>
                      {labels[acc.accountType]}
                    </span>
                  </td>
                  <td>
                    {acc.currency === 'ANY'
                      ? isAr
                        ? 'حسب عملة القيد'
                        : 'Per entry currency'
                      : acc.currency}
                  </td>
                  <td>{acc.isSystem ? (isAr ? 'نظامي' : 'System') : isAr ? 'مخصص' : 'Custom'}</td>
                  <td>{acc.active ? (isAr ? 'نشط' : 'Active') : isAr ? 'معطل' : 'Disabled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {session && loadState === 'ready' && activeTab === 'journal' && (
        <div className="account-panel">
          <h2>{isAr ? 'دفتر اليومية العامة' : 'General Ledger Entries'}</h2>
          <p>
            {isAr
              ? 'يُعرض آخر ١٠٠ قيد من دفتر اليومية.'
              : 'Showing the latest 100 journal entries.'}
          </p>
          {journalEntries.map((je) => (
            <div key={je.id} className="journal-entry-card">
              <div className="journal-entry-header">
                <strong>{je.entryNumber}</strong> — {je.entryDate} |{' '}
                {isAr ? je.descriptionAr : je.descriptionEn}
                <span className="badge badge--posted">{labels[je.status]}</span>
                {je.classificationRequired && (
                  <span className="badge">
                    {isAr ? 'يحتاج إلى تصنيف' : 'Classification required'}
                  </span>
                )}
              </div>
              <table className="account-table">
                <thead>
                  <tr>
                    <th>{isAr ? 'الحساب' : 'Account'}</th>
                    <th>{isAr ? 'مدين (Debit)' : 'Debit'}</th>
                    <th>{isAr ? 'دائن (Credit)' : 'Credit'}</th>
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
                      <td>{line.debitMinor > 0 ? money(line.debitMinor, line.currency) : '-'}</td>
                      <td>{line.creditMinor > 0 ? money(line.creditMinor, line.currency) : '-'}</td>
                      <td>{line.currency}</td>
                      <td>{(isAr ? line.memoAr : line.memoEn) ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {session && loadState === 'ready' && trialBalance && activeTab === 'trial_balance' && (
        <div className="account-panel">
          <h2>
            {isAr
              ? `ميزان المراجعة بتاريخ ${trialBalance.asOfDate}`
              : `Trial Balance as of ${trialBalance.asOfDate}`}
          </h2>
          <label>
            {isAr ? 'عملة ميزان المراجعة' : 'Trial balance currency'}
            <select
              value={trialCurrency}
              onChange={(event) => setTrialCurrency(event.target.value as 'USD' | 'LBP')}
            >
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
          </label>
          <table className="account-table">
            <thead>
              <tr>
                <th>{isAr ? 'رمز الحساب' : 'Code'}</th>
                <th>{isAr ? 'اسم الحساب' : 'Account Name'}</th>
                <th>{isAr ? 'النوع' : 'Type'}</th>
                <th>
                  {isAr ? 'مدين' : 'Debit'} {trialCurrency}
                </th>
                <th>
                  {isAr ? 'دائن' : 'Credit'} {trialCurrency}
                </th>
                <th>{isAr ? 'صافي الرصيد' : 'Net Balance'}</th>
              </tr>
            </thead>
            <tbody>
              {trialBalance.accounts.map((acc) => (
                <tr key={acc.accountId}>
                  <td>
                    <code>{acc.accountCode}</code>
                  </td>
                  <td>{isAr ? acc.accountNameAr : acc.accountNameEn}</td>
                  <td>{labels[acc.accountType]}</td>
                  <td>
                    {money(
                      trialCurrency === 'USD' ? acc.debitMinorUsd : acc.debitMinorLbp,
                      trialCurrency,
                    )}
                  </td>
                  <td>
                    {money(
                      trialCurrency === 'USD' ? acc.creditMinorUsd : acc.creditMinorLbp,
                      trialCurrency,
                    )}
                  </td>
                  <td>
                    <strong>
                      {money(
                        trialCurrency === 'USD' ? acc.netBalanceMinorUsd : acc.netBalanceMinorLbp,
                        trialCurrency,
                      )}
                    </strong>
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
                  <strong>
                    {money(
                      trialCurrency === 'USD'
                        ? trialBalance.totalDebitUsd
                        : trialBalance.totalDebitLbp,
                      trialCurrency,
                    )}
                  </strong>
                </td>
                <td>
                  <strong>
                    {money(
                      trialCurrency === 'USD'
                        ? trialBalance.totalCreditUsd
                        : trialBalance.totalCreditLbp,
                      trialCurrency,
                    )}
                  </strong>
                </td>
                <td>-</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {session && loadState === 'ready' && activeTab === 'periods' && (
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
              {periods.map((p) => (
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
      {session && activeTab === 'statement' && (
        <CustomerStatement key={session.tenantId} locale={locale} session={session} />
      )}
      {session && (activeTab === 'journal' || activeTab === 'periods') && (
        <AccountingForms
          key={session.tenantId}
          locale={locale}
          session={session}
          mode={activeTab}
          accounts={accounts}
          journals={journalEntries}
          disabled={loadState !== 'ready'}
          onPosted={() => setRetry((v) => v + 1)}
        />
      )}
    </section>
  );
}
