import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  customerStatementQuerySchema,
  type CustomerStatementQuery,
  type CustomerStatementResponse,
} from '@isp/contracts';
import {
  readCustomerStatement,
  readSubscriberWorkspace,
  type SubscriberWorkspaceSubscriber,
} from '../api';
import { accountMoney } from './account-money';

export function CustomerStatement({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [customers, setCustomers] = useState<readonly SubscriberWorkspaceSubscriber[]>([]);
  const [lookup, setLookup] = useState<'loading' | 'ready' | 'error'>('loading'),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<CustomerStatementResponse>(),
    [query, setQuery] = useState<CustomerStatementQuery>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestVersion = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestVersion.current++;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLookup('loading');
    void readSubscriberWorkspace(session)
      .then((data) => {
        if (current) {
          setCustomers(data.subscribers);
          setLookup('ready');
        }
      })
      .catch(() => {
        if (current) {
          setCustomers([]);
          setLookup('error');
        }
      });
    return () => {
      current = false;
    };
  }, [session, retry]);
  async function load(next: CustomerStatementQuery) {
    const version = ++requestVersion.current;
    setBusy(true);
    setError('');
    setResult(undefined);
    setQuery(next);
    try {
      const data = await readCustomerStatement(session, next);
      if (alive.current && version === requestVersion.current) setResult(data);
    } catch {
      if (alive.current && version === requestVersion.current) setError('read');
    } finally {
      if (alive.current && version === requestVersion.current) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      get = (key: string) => {
        const field = form.get(key);
        return typeof field === 'string' ? field : '';
      };
    try {
      const next = customerStatementQuerySchema.parse({
        subscriberId: get('subscriber'),
        currency: get('currency'),
        ...(get('start') ? { startDate: get('start') } : {}),
        ...(get('end') ? { endDate: get('end') } : {}),
        page: 1,
        pageSize: 25,
      });
      void load(next);
    } catch {
      setError('validation');
    }
  }
  return (
    <section className="billing-panel accounting-statement" aria-busy={busy}>
      <h2>{t('Customer statement', 'كشف حساب العميل')}</h2>
      <p>
        {t(
          'Net customer position, including advances. Select one currency; positive balances are owed by the customer.',
          'صافي حساب العميل بما فيه الدفعات المقدمة. اختر عملة واحدة؛ الرصيد الموجب مستحق على العميل.',
        )}
      </p>
      {lookup === 'loading' && (
        <p role="status">{t('Loading customer directory…', 'جارٍ تحميل دليل العملاء…')}</p>
      )}
      {lookup === 'error' && (
        <div role="alert">
          <p>
            {t(
              'Customer directory unavailable. Subscriber-view permission is required.',
              'دليل العملاء غير متاح. يلزم إذن عرض المشتركين.',
            )}
          </p>
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            {t('Retry directory', 'إعادة تحميل الدليل')}
          </button>
        </div>
      )}
      {lookup === 'ready' && customers.length === 0 && (
        <p role="status">{t('No customers in your scope.', 'لا يوجد عملاء ضمن نطاق صلاحيتك.')}</p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy || lookup !== 'ready' || customers.length === 0}>
          <legend>{t('Statement filters', 'مرشحات الكشف')}</legend>
          <label>
            {t('Customer', 'العميل')}
            <select name="subscriber" required defaultValue="">
              <option value="">{t('Choose customer', 'اختر العميل')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.subscriberNumber} — {c.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Currency', 'العملة')}
            <select name="currency">
              <option>USD</option>
              <option>LBP</option>
            </select>
          </label>
          <label>
            {t('Start date (optional)', 'تاريخ البداية (اختياري)')}
            <input name="start" type="date" />
          </label>
          <label>
            {t('End date (optional)', 'تاريخ النهاية (اختياري)')}
            <input name="end" type="date" />
          </label>
          <button type="submit">{t('View statement', 'عرض الكشف')}</button>
        </fieldset>
      </form>
      {busy && <p role="status">{t('Loading statement…', 'جارٍ تحميل الكشف…')}</p>}
      {error && (
        <div role="alert">
          <p>
            {error === 'validation'
              ? t('Select a customer and valid ordered dates.', 'اختر عميلاً وتواريخ صحيحة ومرتبة.')
              : t(
                  'Statement unavailable. Check access and connection, then retry.',
                  'الكشف غير متاح. تحقق من الصلاحية والاتصال ثم أعد المحاولة.',
                )}
          </p>
          {query && (
            <button type="button" disabled={busy} onClick={() => void load(query)}>
              {t('Retry statement', 'إعادة تحميل الكشف')}
            </button>
          )}
        </div>
      )}
      {result && (
        <>
          <h3>
            {result.subscriberName} · {result.currency}
          </h3>
          <p>
            {t('Opening balance', 'الرصيد الافتتاحي')}:{' '}
            {accountMoney(result.openingBalanceMinor, result.currency, locale)} ·{' '}
            {t('Closing balance', 'الرصيد الختامي')}:{' '}
            {accountMoney(result.closingBalanceMinor, result.currency, locale)}
          </p>
          <p>
            {t('Period debits', 'مدين الفترة')}:{' '}
            {accountMoney(result.totalDebitsMinor, result.currency, locale)} ·{' '}
            {t('Period credits', 'دائن الفترة')}:{' '}
            {accountMoney(result.totalCreditsMinor, result.currency, locale)}
          </p>
          {result.entries.length === 0 ? (
            <p role="status">
              {t(
                'No entries in this period. The opening balance is preserved.',
                'لا قيود في هذه الفترة. الرصيد الافتتاحي محفوظ.',
              )}
            </p>
          ) : (
            <div
              className="account-table-scroll"
              role="region"
              aria-label={t('Statement entries', 'قيود الكشف')}
              tabIndex={0}
            >
              <table className="account-table">
                <thead>
                  <tr>
                    {[
                      t('Date', 'التاريخ'),
                      t('Reference', 'المرجع'),
                      t('Description', 'الوصف'),
                      t('Debit', 'مدين'),
                      t('Credit', 'دائن'),
                      t('Balance', 'الرصيد'),
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.date.slice(0, 10)}</td>
                      <td>{e.documentNumber}</td>
                      <td>{locale === 'ar' ? e.descriptionAr : e.descriptionEn}</td>
                      <td>{accountMoney(e.debitMinor, e.currency, locale)}</td>
                      <td>{accountMoney(e.creditMinor, e.currency, locale)}</td>
                      <td>{accountMoney(e.runningBalanceMinor, e.currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav aria-label={t('Statement pages', 'صفحات الكشف')}>
            <button
              type="button"
              disabled={busy || result.page <= 1}
              onClick={() => query && void load({ ...query, page: result.page - 1 })}
            >
              {t('Previous', 'السابق')}
            </button>
            <span>
              {t('Page', 'الصفحة')} {result.page} /{' '}
              {Math.max(1, Math.ceil(result.totalCount / result.pageSize))}
            </span>
            <button
              type="button"
              disabled={busy || result.page * result.pageSize >= result.totalCount}
              onClick={() => query && void load({ ...query, page: result.page + 1 })}
            >
              {t('Next', 'التالي')}
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
