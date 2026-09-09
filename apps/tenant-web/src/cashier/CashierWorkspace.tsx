import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import type {
  CashDrawerRecord,
  CashierSubscriber,
  CashierWorkspace as Workspace,
  ReceiptMethod,
  ReceiptRecord,
  ReceiptResult,
} from '@isp/contracts';
import { readCashierWorkspace, submitTenantOperation } from '../api';
import { accountMoney, parseAccountAmount } from '../billing/account-money';
import { MfaStepUp } from './MfaStepUp';
import './cashier.css';

type Currency = 'USD' | 'LBP';
const methods: readonly ReceiptMethod[] = [
  'cash',
  'card',
  'bank_transfer',
  'omt',
  'whish',
  'other',
];

export function CashierWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const en = locale === 'en';
  const t = (english: string, arabic: string) => (en ? english : arabic);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CashierSubscriber>();
  const [currency, setCurrency] = useState<Currency>('USD');
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastReceipt, setLastReceipt] = useState<ReceiptResult>();
  const [voiding, setVoiding] = useState<ReceiptRecord>();
  const [closing, setClosing] = useState<CashDrawerRecord>();
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState((current) => (current === 'ready' ? current : 'loading'));
    void readCashierWorkspace(session, query ? { search: query } : {})
      .then((result) => {
        if (!active) return;
        setData(result);
        setState('ready');
        if (selected) {
          const fresh = result.subscribers.find((s) => s.id === selected.id);
          if (fresh) setSelected(fresh);
        }
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
    // The selected subscriber is refreshed from the same read; it must not retrigger it.
  }, [session, query, refresh]);
  const money = useCallback(
    (minor: number, unit: Currency) => accountMoney(minor, unit, locale),
    [locale],
  );
  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(en ? 'en-GB' : 'ar-LB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const methodLabel = (value: ReceiptMethod) =>
    ({
      cash: t('Cash', 'نقداً'),
      card: t('Card', 'بطاقة'),
      bank_transfer: t('Bank transfer', 'تحويل مصرفي'),
      omt: 'OMT',
      whish: 'Whish',
      other: t('Other', 'أخرى'),
    })[value];
  const field = (form: FormData, key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const idempotency = (fingerprint: string) => {
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-cashier-${crypto.randomUUID()}` };
    return retry.current.key;
  };
  async function run(
    path: string,
    command: Record<string, unknown>,
    onDone?: (result: Record<string, unknown>) => void,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(
        session,
        path,
        { command },
        idempotency(JSON.stringify({ path, command })),
      );
      retry.current = undefined;
      if (mounted.current) {
        onDone?.(result);
        setRefresh((v) => v + 1);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submitReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const amountMinor = parseAccountAmount(field(form, 'amount'), currency);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError(t('Enter a positive amount.', 'أدخل مبلغاً موجباً.'));
      return;
    }
    const invoiceId = field(form, 'invoiceId');
    const reference = field(form, 'reference');
    const receiptNumber = field(form, 'receiptNumber');
    const note = field(form, 'note');
    const target = event.currentTarget;
    void run(
      'cashier/commands',
      {
        action: 'record_receipt',
        subscriberId: selected.id,
        ...(invoiceId ? { invoiceId } : {}),
        amountMinor,
        currency,
        method,
        ...(reference ? { reference } : {}),
        ...(receiptNumber ? { receiptNumber } : {}),
        ...(note ? { note } : {}),
      },
      (result) => {
        setLastReceipt(result as unknown as ReceiptResult);
        setNotice(
          `${t('Receipt', 'الإيصال')} ${String(result.receiptNumber)} ${t('posted.', 'رُحّل.')}`,
        );
        target.reset();
      },
    );
  }
  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const unit = field(form, 'currency') as Currency;
    const openingFloatMinor = parseAccountAmount(field(form, 'float') || '0', unit);
    void run(
      'cashier/commands',
      {
        action: 'open_drawer',
        branchId: field(form, 'branchId'),
        currency: unit,
        openingFloatMinor,
      },
      () => {
        setOpening(false);
        setNotice(t('Drawer opened.', 'فُتح الصندوق.'));
      },
    );
  }
  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closing) return;
    const form = new FormData(event.currentTarget);
    const countedMinor = parseAccountAmount(field(form, 'counted'), closing.currency);
    const note = field(form, 'note');
    void run(
      'cashier/commands',
      {
        action: 'close_drawer',
        drawerId: closing.id,
        expectedVersion: closing.version,
        countedMinor,
        ...(note ? { note } : {}),
      },
      (result) => {
        setClosing(undefined);
        setNotice(
          `${t('Drawer closed. Variance', 'أُغلق الصندوق. الفرق')} ${money(Number(result.varianceMinor), closing.currency)}.`,
        );
      },
    );
  }
  function submitVoid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voiding) return;
    const reason = field(new FormData(event.currentTarget), 'reason');
    void run('cashier/void', { action: 'void_receipt', receiptId: voiding.id, reason }, () => {
      setVoiding(undefined);
      setNotice(t('Receipt voided with a linked reversal.', 'أُلغي الإيصال بعكس مرتبط.'));
    });
  }
  const openDrawers = data?.drawers.filter((d) => d.status === 'open' && d.mine) ?? [];
  const drawerFor = (unit: Currency) => openDrawers.find((d) => d.currency === unit);
  const invoiceOptions = selected?.openInvoices.filter((i) => i.currency === currency) ?? [];
  const statusLabel = (value: string) =>
    ({
      active: t('Active', 'نشط'),
      suspended: t('Suspended', 'معلّق'),
      lead: t('Lead', 'مهتم'),
      pending: t('Pending', 'قيد الانتظار'),
      closed: t('Closed', 'مغلق'),
    })[value] ?? value;

  return (
    <div className="cashier-shell" dir={en ? 'ltr' : 'rtl'} aria-busy={busy}>
      <header className="cashier-hero">
        <div>
          <span>{t('Payments & cashier', 'الدفعات والصندوق')}</span>
          <h1>{t('Counter receipts', 'إيصالات المكتب')}</h1>
          <p>
            {t(
              'Find the subscriber, take the money, and the receipt is posted with its allocations in one step. Every void is a linked reversal; nothing posted is ever edited.',
              'ابحث عن المشترك واستلم المبلغ فيُرحَّل الإيصال مع تخصيصاته بخطوة واحدة. كل إلغاء هو عكس مرتبط؛ لا يُعدَّل شيء مرحّل أبداً.',
            )}
          </p>
        </div>
        <dl className="cashier-stats">
          {(['USD', 'LBP'] as const).map((unit) => {
            const drawer = drawerFor(unit);
            const today = data?.today.filter((row) => row.currency === unit) ?? [];
            const total = today.reduce((sum, row) => sum + row.amountMinor, 0);
            return (
              <div key={unit} className={drawer ? 'is-open' : ''}>
                <dt>
                  {t('Today', 'اليوم')} · {unit}
                </dt>
                <dd dir="ltr">{money(total, unit)}</dd>
                <small>
                  {drawer
                    ? `${t('Drawer open · cash', 'الصندوق مفتوح · نقد')} ${money(drawer.openingFloatMinor + drawer.cashReceiptsMinor, unit)}`
                    : t('No open drawer', 'لا صندوق مفتوح')}
                </small>
              </div>
            );
          })}
        </dl>
      </header>

      {state === 'error' && (
        <div className="cashier-banner is-error" role="alert">
          {t(
            'The cashier workspace could not be read. Check your connection and payment permission.',
            'تعذّرت قراءة مساحة الصندوق. تحقق من الاتصال وصلاحية الدفعات.',
          )}
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}
      {error && (
        <div className="cashier-banner is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="cashier-banner" role="status">
          {notice}
        </div>
      )}

      <section className="cashier-drawers" aria-label={t('Cash drawers', 'صناديق النقد')}>
        <div className="cashier-section-head">
          <h2>{t('Cash drawers', 'صناديق النقد')}</h2>
          <button type="button" onClick={() => setOpening((v) => !v)}>
            {t('Open a drawer', 'فتح صندوق')}
          </button>
        </div>
        {opening && (
          <form className="cashier-form cashier-inline" onSubmit={submitOpen}>
            <label>
              {t('Branch', 'الفرع')}
              <select name="branchId" required>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {en ? b.nameEn : b.nameAr}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Currency', 'العملة')}
              <select name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </label>
            <label>
              {t('Opening float', 'الرصيد الافتتاحي')}
              <input name="float" inputMode="decimal" placeholder="0" />
            </label>
            <button type="submit" className="cashier-primary" disabled={busy}>
              {t('Open drawer', 'فتح الصندوق')}
            </button>
          </form>
        )}
        {data && data.drawers.length === 0 ? (
          <p className="cashier-note">
            {t(
              'No drawer has been opened in your scope during the last seven days.',
              'لم يُفتح أي صندوق ضمن نطاقك خلال الأيام السبعة الماضية.',
            )}
          </p>
        ) : (
          <div className="cashier-table-wrap">
            <table className="cashier-table">
              <thead>
                <tr>
                  <th>{t('Cashier', 'أمين الصندوق')}</th>
                  <th>{t('Branch', 'الفرع')}</th>
                  <th>{t('Currency', 'العملة')}</th>
                  <th>{t('Opening float', 'الرصيد الافتتاحي')}</th>
                  <th>{t('Cash receipts', 'الإيصالات النقدية')}</th>
                  <th>{t('Counted', 'المعدود')}</th>
                  <th>{t('Variance', 'الفرق')}</th>
                  <th>{t('Status', 'الحالة')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.drawers.map((d) => (
                  <tr key={d.id}>
                    <td>{d.cashier}</td>
                    <td>{en ? d.branchName : d.branchNameAr}</td>
                    <td>{d.currency}</td>
                    <td dir="ltr">{money(d.openingFloatMinor, d.currency)}</td>
                    <td dir="ltr">
                      {money(d.cashReceiptsMinor, d.currency)} · {d.receipts}
                    </td>
                    <td dir="ltr">
                      {d.countedMinor === null ? '—' : money(d.countedMinor, d.currency)}
                    </td>
                    <td dir="ltr" className={d.varianceMinor ? 'is-variance' : ''}>
                      {d.varianceMinor === null ? '—' : money(d.varianceMinor, d.currency)}
                    </td>
                    <td>
                      <span className={`cashier-pill is-${d.status}`}>
                        {d.status === 'open' ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}
                      </span>
                      <small>{time(d.status === 'open' ? d.openedAt : d.closedAt)}</small>
                    </td>
                    <td>
                      {d.status === 'open' && d.mine && (
                        <button type="button" onClick={() => setClosing(d)}>
                          {t('Close', 'إغلاق')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {closing && (
          <form className="cashier-form cashier-inline" onSubmit={submitClose}>
            <strong>
              {t('Close drawer', 'إغلاق الصندوق')} · {closing.currency} ·{' '}
              {t('expected cash', 'النقد المتوقع')}{' '}
              <span dir="ltr">
                {money(closing.openingFloatMinor + closing.cashReceiptsMinor, closing.currency)}
              </span>
            </strong>
            <label>
              {t('Counted cash', 'النقد المعدود')}
              <input name="counted" inputMode="decimal" required autoFocus />
            </label>
            <label>
              {t('Note', 'ملاحظة')}
              <input name="note" maxLength={1000} />
            </label>
            <button type="submit" className="cashier-primary" disabled={busy}>
              {t('Confirm count and close', 'تأكيد العد والإغلاق')}
            </button>
            <button type="button" onClick={() => setClosing(undefined)}>
              {t('Cancel', 'إلغاء')}
            </button>
          </form>
        )}
      </section>

      <div className="cashier-columns">
        <section className="cashier-panel" aria-label={t('Take a payment', 'استلام دفعة')}>
          <h2>{t('Take a payment', 'استلام دفعة')}</h2>
          <form
            className="cashier-search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
            }}
          >
            <label>
              {t('Subscriber number, name or phone', 'رقم المشترك أو الاسم أو الهاتف')}
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('e.g. SUB-1042 or 03 123 456', 'مثال: SUB-1042 أو 03 123 456')}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t('Search', 'بحث')}
            </button>
          </form>
          {query && data && data.subscribers.length === 0 && (
            <p className="cashier-note">
              {t('No subscriber in your scope matches.', 'لا مشترك ضمن نطاقك يطابق البحث.')}
            </p>
          )}
          {data && data.subscribers.length > 0 && (
            <ul className="cashier-results">
              {data.subscribers.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={selected?.id === s.id ? 'is-selected' : ''}
                    onClick={() => {
                      setSelected(s);
                      setLastReceipt(undefined);
                      const first = s.openInvoices[0];
                      if (first) setCurrency(first.currency);
                    }}
                  >
                    <strong>{s.displayName}</strong>
                    <span>
                      {s.subscriberNumber} · {statusLabel(s.status)} ·{' '}
                      {en ? s.branchName : s.branchNameAr}
                      {s.phone ? ` · ${s.phone}` : ''}
                    </span>
                    <span dir="ltr">
                      {s.openInvoices.length === 0
                        ? t('No open invoices', 'لا فواتير مفتوحة')
                        : (['USD', 'LBP'] as const)
                            .map((unit) => {
                              const sum = s.openInvoices
                                .filter((i) => i.currency === unit)
                                .reduce((acc, i) => acc + i.remainingMinor, 0);
                              return sum > 0 ? money(sum, unit) : null;
                            })
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <form className="cashier-form" onSubmit={submitReceipt}>
              <h3>
                {selected.displayName} · {selected.subscriberNumber}
              </h3>
              {selected.unallocated.length > 0 && (
                <p className="cashier-note">
                  {t('Unallocated credit on account:', 'رصيد غير مخصص في الحساب:')}{' '}
                  {selected.unallocated.map((u) => money(u.amountMinor, u.currency)).join(' · ')}
                </p>
              )}
              <div className="cashier-grid">
                <label>
                  {t('Currency', 'العملة')}
                  <select
                    name="currency"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value as Currency)}
                  >
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                  </select>
                </label>
                <label>
                  {t('Amount received', 'المبلغ المستلم')}
                  <input name="amount" inputMode="decimal" required autoFocus />
                </label>
                <label>
                  {t('Method', 'طريقة الدفع')}
                  <select
                    name="method"
                    value={method}
                    onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
                  >
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {methodLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('Reference', 'المرجع')}
                  <input
                    name="reference"
                    maxLength={200}
                    required={method !== 'cash'}
                    placeholder={
                      method === 'cash'
                        ? t('optional', 'اختياري')
                        : t(
                            'card slip, transfer or agent number',
                            'رقم القسيمة أو التحويل أو الوكيل',
                          )
                    }
                  />
                </label>
                <label>
                  {t('Apply to', 'تطبيق على')}
                  <select name="invoiceId" defaultValue="">
                    <option value="">
                      {t('Oldest open invoices first', 'أقدم الفواتير المفتوحة أولاً')}
                    </option>
                    {invoiceOptions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.documentNumber} · {money(i.remainingMinor, i.currency)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('Receipt number', 'رقم الإيصال')}
                  <input
                    name="receiptNumber"
                    maxLength={120}
                    placeholder={t('blank = issued by the system', 'فارغ = يصدره النظام')}
                  />
                </label>
                <label className="cashier-span">
                  {t('Note', 'ملاحظة')}
                  <input name="note" maxLength={1000} />
                </label>
              </div>
              {invoiceOptions.length === 0 && (
                <p className="cashier-note">
                  {t(
                    'No open invoice in this currency; the receipt stays as credit on the account until an invoice is issued.',
                    'لا فاتورة مفتوحة بهذه العملة؛ يبقى الإيصال رصيداً في الحساب حتى تصدر فاتورة.',
                  )}
                </p>
              )}
              {method === 'cash' && !drawerFor(currency) && (
                <p className="cashier-note">
                  {t(
                    'You have no open drawer in this currency; the cash receipt will post without a drawer link.',
                    'لا صندوق مفتوح لديك بهذه العملة؛ سيُرحَّل الإيصال النقدي دون ربط بصندوق.',
                  )}
                </p>
              )}
              <button type="submit" className="cashier-primary" disabled={busy}>
                {t('Post receipt', 'ترحيل الإيصال')}
              </button>
            </form>
          )}
          {lastReceipt && (
            <article className="cashier-receipt" aria-label={t('Receipt', 'الإيصال')}>
              <header>
                <strong>{lastReceipt.receiptNumber}</strong>
                <span>{time(lastReceipt.postedAt)}</span>
              </header>
              <p>{lastReceipt.subscriberName}</p>
              <dl>
                <div>
                  <dt>{t('Received', 'المستلم')}</dt>
                  <dd dir="ltr">{money(lastReceipt.amountMinor, lastReceipt.currency)}</dd>
                </div>
                <div>
                  <dt>{t('Method', 'طريقة الدفع')}</dt>
                  <dd>{methodLabel(lastReceipt.method)}</dd>
                </div>
                {lastReceipt.allocations.map((a) => (
                  <div key={a.allocationId}>
                    <dt>{a.documentNumber}</dt>
                    <dd dir="ltr">{money(a.amountMinor, lastReceipt.currency)}</dd>
                  </div>
                ))}
                {lastReceipt.unallocatedMinor > 0 && (
                  <div>
                    <dt>{t('Kept as credit', 'أُبقي رصيداً')}</dt>
                    <dd dir="ltr">{money(lastReceipt.unallocatedMinor, lastReceipt.currency)}</dd>
                  </div>
                )}
              </dl>
              <button type="button" onClick={() => window.print()}>
                {t('Print receipt', 'طباعة الإيصال')}
              </button>
            </article>
          )}
        </section>

        <section className="cashier-panel" aria-label={t('Receipts', 'الإيصالات')}>
          <h2>{t('Receipts', 'الإيصالات')}</h2>
          {voiding && (
            <form className="cashier-form cashier-inline" onSubmit={submitVoid}>
              <strong>
                {t('Void', 'إلغاء')} {voiding.receiptNumber} ·{' '}
                <span dir="ltr">{money(voiding.amountMinor, voiding.currency)}</span>
              </strong>
              <p className="cashier-note">
                {t(
                  'A void posts a linked reversal of the payment and its allocations. Recent identity verification is required.',
                  'يرحّل الإلغاء عكساً مرتبطاً للدفعة وتخصيصاتها. يلزم تحقق حديث من الهوية.',
                )}
              </p>
              <MfaStepUp locale={locale} session={session} />
              <label>
                {t('Reason', 'السبب')}
                <input name="reason" minLength={8} maxLength={1000} required />
              </label>
              <button type="submit" className="cashier-primary" disabled={busy}>
                {t('Void receipt', 'إلغاء الإيصال')}
              </button>
              <button type="button" onClick={() => setVoiding(undefined)}>
                {t('Keep it', 'إبقاؤه')}
              </button>
            </form>
          )}
          {data && data.receipts.length === 0 ? (
            <p className="cashier-note">
              {t('No receipts in your scope yet.', 'لا إيصالات ضمن نطاقك بعد.')}
            </p>
          ) : (
            <div className="cashier-table-wrap">
              <table className="cashier-table">
                <thead>
                  <tr>
                    <th>{t('Receipt', 'الإيصال')}</th>
                    <th>{t('Subscriber', 'المشترك')}</th>
                    <th>{t('Amount', 'المبلغ')}</th>
                    <th>{t('Method', 'الطريقة')}</th>
                    <th>{t('Applied to', 'طُبّق على')}</th>
                    <th>{t('Cashier', 'أمين الصندوق')}</th>
                    <th>{t('Posted', 'رُحّل')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.receipts.map((r) => (
                    <tr key={r.id} className={r.voidedAt ? 'is-voided' : ''}>
                      <td>
                        <strong>{r.receiptNumber}</strong>
                        {r.voidedAt && (
                          <small>
                            {t('Voided', 'ملغى')} · {r.voidReason}
                          </small>
                        )}
                      </td>
                      <td>
                        {r.subscriberName}
                        <small>{r.subscriberNumber}</small>
                      </td>
                      <td dir="ltr">{money(r.amountMinor, r.currency)}</td>
                      <td>
                        {methodLabel(r.method)}
                        {r.reference && <small>{r.reference}</small>}
                      </td>
                      <td>
                        {r.allocations.length === 0
                          ? t('Credit on account', 'رصيد في الحساب')
                          : r.allocations.map((a) => a.documentNumber).join(', ')}
                      </td>
                      <td>{r.cashier}</td>
                      <td>{time(r.postedAt)}</td>
                      <td>
                        {!r.voidedAt && (
                          <button type="button" onClick={() => setVoiding(r)}>
                            {t('Void', 'إلغاء')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
