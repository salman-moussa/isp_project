import type { ApiSession } from '@isp/ui';
import {
  customerAccountSchemas,
  type CustomerAccountKind,
  type CustomerAccountsWorkspace,
} from '@isp/contracts';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { readCustomerAccounts, submitTenantOperation } from '../api';
import { parseAccountAmount, accountMoney } from './account-money';

const labels: Record<CustomerAccountKind, readonly [string, string]> = {
  credit_note: ['Credit unpaid invoice', 'تخفيض فاتورة غير مسددة'],
  credit_reversal: ['Reverse credit note', 'عكس الإشعار الدائن'],
  deposit_received: ['Record deposit received', 'تسجيل دفعة مقدمة مستلمة'],
  deposit_applied: ['Apply deposit to invoice', 'تخصيص دفعة لفاتورة'],
  deposit_application_reversal: ['Reverse deposit allocation', 'عكس تخصيص الدفعة'],
  deposit_reversal: ['Correct unused receipt', 'تصحيح إيصال غير مستخدم'],
};
export function CustomerAccounts({
  locale,
  session,
}: {
  readonly locale: 'en' | 'ar';
  readonly session: ApiSession;
}) {
  const en = locale === 'en';
  const t = (a: string, b: string) => (en ? a : b);
  const [workspace, setWorkspace] = useState<CustomerAccountsWorkspace>();
  const [customer, setCustomer] = useState('');
  const [kind, setKind] = useState<CustomerAccountKind>('deposit_received');
  const [currency, setCurrency] = useState<'USD' | 'LBP'>('USD');
  const [invoiceId, setInvoiceId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const locked = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await readCustomerAccounts(session));
      setError('');
    } catch {
      setError('read');
      setWorkspace(undefined);
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => {
    void load();
  }, [load]);
  const invoices = workspace?.invoices.filter((i) => i.subscriberId === customer) ?? [];
  const history = workspace?.entries.filter((e) => e.subscriberId === customer) ?? [];
  const sources = history.filter(
    (e) =>
      !e.reversed &&
      (kind === 'credit_reversal'
        ? e.kind === 'credit_note'
        : kind === 'deposit_application_reversal'
          ? e.kind === 'deposit_applied'
          : e.kind === 'deposit_received' &&
            (kind === 'deposit_reversal'
              ? e.availableMinor === e.amountMinor
              : (e.availableMinor ?? 0) > 0)),
  );
  const source = sources.find((e) => e.id === sourceId);
  const invoice = invoices.find((i) => i.id === invoiceId);
  const unit =
    kind === 'deposit_received' ? currency : (source?.currency ?? invoice?.currency ?? currency);
  const needsInvoice = kind === 'credit_note' || kind === 'deposit_applied';
  const needsSource = kind !== 'credit_note' && kind !== 'deposit_received';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (key: string) => {
      const field = fields.get(key);
      return typeof field === 'string' ? field.trim() : '';
    };
    let body: Record<string, unknown> = {
      documentNumber: value('documentNumber'),
      reasonEn: value('reasonEn'),
      reasonAr: value('reasonAr'),
    };
    try {
      if (kind === 'deposit_received')
        body = {
          ...body,
          subscriberId: customer,
          currency,
          amountMinor: parseAccountAmount(value('amount'), currency),
          sourceReference: value('sourceReference'),
        };
      else if (kind === 'credit_note')
        body = {
          ...body,
          subscriberId: customer,
          invoiceId,
          currency: unit,
          netMinor: parseAccountAmount(value('net'), unit),
          vatMinor: parseAccountAmount(value('vat'), unit),
          stampMinor: parseAccountAmount(value('stamp'), unit),
        };
      else
        body = {
          ...body,
          sourceEntryId: sourceId,
          ...(kind === 'deposit_applied'
            ? { invoiceId, amountMinor: parseAccountAmount(value('amount'), unit) }
            : {}),
        };
      body = customerAccountSchemas[kind].parse(body);
    } catch {
      setError('validation');
      return;
    }
    const fingerprint = JSON.stringify({ kind, body });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await submitTenantOperation(session, 'customer-accounts/' + kind, body, retry.current.key);
      // Do not reuse the old document number after a confirmed append.
      retry.current = undefined;
      form.reset();
      setSourceId('');
      setInvoiceId('');
      setNotice(String(body.documentNumber));
      await load();
    } catch {
      setError('post');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="billing-panel customer-accounts"
      dir={en ? 'ltr' : 'rtl'}
      aria-busy={busy || loading}
    >
      <header className="billing-panel__heading">
        <div>
          <span>{t('Customer ledger · append-only', 'حساب العميل · سجل ثابت')}</span>
          <h2>{t('Every adjustment has a story', 'كل تسوية لها سجل واضح')}</h2>
          <p>
            {t(
              'Record received deposits, settle invoices, and correct unpaid charges with a linked audit trail.',
              'سجّل الدفعات المستلمة وسدّد الفواتير وصحّح المبالغ غير المدفوعة مع سجل تدقيق مترابط.',
            )}
          </p>
        </div>
        <button type="button" disabled={busy || loading} onClick={() => void load()}>
          {t('Refresh', 'تحديث')}
        </button>
      </header>
      <p className="account-safety">
        {t(
          'No bank transfer or refund is sent. Receipt corrections only reverse unused receipts. Credits reduce unpaid invoices; original PDFs stay unchanged. Confirm tax components with your accountant.',
          'لا يُرسل تحويل مصرفي أو استرداد. تصحيح الإيصال يعكس الإيصالات غير المستخدمة فقط. الإشعارات تخفض الفواتير غير المسددة ولا تغير ملفاتها الأصلية. راجع مكونات الضريبة مع محاسبك.',
        )}
      </p>
      {error && (
        <p role="alert" className="billing-feedback billing-feedback--error">
          {error === 'validation'
            ? t(
                'Check the fields and amounts: USD accepts cents; LBP uses whole pounds. Reasons need at least 8 characters.',
                'تحقق من الحقول والمبالغ: الدولار يقبل السنتات والليرة أعداداً صحيحة. الأسباب ٨ أحرف على الأقل.',
              )
            : error === 'read'
              ? t(
                  'Cannot load accounts. Check billing-view permission and connection, then refresh.',
                  'تعذر تحميل الحسابات. تحقق من صلاحية عرض الفوترة والاتصال ثم حدّث.',
                )
              : t(
                  'Not confirmed. Check your permissions, recent MFA, available balance and unique receipt/reference. Retry unchanged fields to safely recover a lost response.',
                  'لم تُؤكّد العملية. تحقق من الصلاحيات والتحقق المتعدد الحديث والرصيد وتفرّد الإيصال والمرجع. أعد المحاولة بنفس الحقول لاستعادة الرد بأمان.',
                )}
        </p>
      )}
      {notice && (
        <p role="status" className="billing-feedback">
          {t('Posted and audited: ', 'تم الترحيل والتدقيق: ')}
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">{t('Loading customer accounts…', 'جار تحميل حسابات العملاء…')}</p>
      ) : null}
      {!loading && workspace?.subscribers.length === 0 ? (
        <p>{t('No customers in your authorized scope.', 'لا يوجد عملاء ضمن نطاق صلاحياتك.')}</p>
      ) : null}
      <label className="account-customer">
        <span>{t('Customer', 'العميل')}</span>
        <select
          value={customer}
          disabled={busy || loading}
          onChange={(e) => {
            setCustomer(e.target.value);
            setSourceId('');
            setInvoiceId('');
          }}
        >
          <option value="">{t('Choose a customer', 'اختر عميلاً')}</option>
          {workspace?.subscribers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p className="account-caption">
        {t(
          'Scoped view: up to 500 customers, latest 500 invoices and account entries. Not a complete account statement.',
          'عرض حسب الصلاحيات: حتى ٥٠٠ عميل وآخر ٥٠٠ فاتورة وقيد. ليس كشف حساب شاملاً.',
        )}
      </p>
      {customer && (
        <div className="account-layout">
          <form className="billing-command account-form" onSubmit={(e) => void submit(e)}>
            <fieldset disabled={busy || loading || !workspace}>
              <legend>{t('Post an account entry', 'ترحيل قيد حساب')}</legend>
              <label>
                <span>{t('Operation', 'العملية')}</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as CustomerAccountKind);
                    setSourceId('');
                    setInvoiceId('');
                  }}
                >
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label[en ? 0 : 1]}
                    </option>
                  ))}
                </select>
              </label>
              {kind === 'deposit_received' && (
                <label>
                  <span>{t('Currency', 'العملة')}</span>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'USD' | 'LBP')}
                  >
                    <option>USD</option>
                    <option>LBP</option>
                  </select>
                </label>
              )}
              {needsSource && (
                <label>
                  <span>{t('Original entry', 'القيد الأصلي')}</span>
                  <select
                    required
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      setInvoiceId('');
                    }}
                  >
                    <option value="">{t('Select eligible entry', 'اختر قيداً مؤهلاً')}</option>
                    {sources.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.documentNumber +
                          ' · ' +
                          accountMoney(e.availableMinor ?? e.amountMinor, e.currency, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {needsInvoice && (
                <label>
                  <span>{t('Invoice', 'الفاتورة')}</span>
                  <select required value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                    <option value="">{t('Select unpaid invoice', 'اختر فاتورة غير مسددة')}</option>
                    {invoices
                      .filter(
                        (i) =>
                          i.outstandingMinor > 0 && (!source || source.currency === i.currency),
                      )
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.documentNumber +
                            ' · ' +
                            accountMoney(i.outstandingMinor, i.currency, locale)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {invoice && needsInvoice && (
                <p className="account-safety">
                  {t('Outstanding: ', 'المتبقي: ')}
                  {accountMoney(invoice.outstandingMinor, invoice.currency, locale)}
                  {kind === 'credit_note' && (
                    <>
                      <br />
                      {t(
                        'Component ceilings (net / VAT / stamp): ',
                        'حدود المكونات (الصافي / الضريبة / الطابع): ',
                      )}
                      {[
                        invoice.netRemainingMinor,
                        invoice.vatRemainingMinor,
                        invoice.stampRemainingMinor,
                      ]
                        .map((a) => accountMoney(a, invoice.currency, locale))
                        .join(' / ')}
                    </>
                  )}
                </p>
              )}
              {kind === 'credit_note' ? (
                <div className="account-amounts">
                  {[
                    ['net', t('Net credit', 'صافي التخفيض')],
                    ['vat', t('VAT credit', 'تخفيض الضريبة')],
                    ['stamp', t('Stamp credit', 'تخفيض الطابع')],
                  ].map(([name, label]) => (
                    <label key={name}>
                      <span>{label + ' (' + unit + ')'}</span>
                      <input name={name} required inputMode="decimal" defaultValue="0" />
                    </label>
                  ))}
                </div>
              ) : (
                (kind === 'deposit_received' || kind === 'deposit_applied') && (
                  <label>
                    <span>{t('Amount', 'المبلغ') + ' (' + unit + ')'}</span>
                    <input name="amount" required inputMode="decimal" />
                  </label>
                )
              )}
              <label>
                <span>{t('New document / receipt number', 'رقم المستند / الإيصال الجديد')}</span>
                <input name="documentNumber" required maxLength={100} />
              </label>
              {kind === 'deposit_received' && (
                <label>
                  <span>
                    {t(
                      'Unique cash receipt or bank reference',
                      'مرجع إيصال النقد أو المصرف الفريد',
                    )}
                  </span>
                  <input name="sourceReference" required minLength={3} maxLength={200} />
                </label>
              )}
              <label>
                <span>{t('Reason in English', 'السبب بالإنجليزية')}</span>
                <textarea name="reasonEn" dir="ltr" required minLength={8} maxLength={500} />
              </label>
              <label>
                <span>{t('Reason in Arabic', 'السبب بالعربية')}</span>
                <textarea name="reasonAr" dir="rtl" required minLength={8} maxLength={500} />
              </label>
              <label className="account-confirm">
                <input type="checkbox" required />
                {t(
                  'I verified the customer, amounts and source evidence. Post an immutable entry.',
                  'راجعت العميل والمبالغ والمستند الأصلي. أوافق على ترحيل قيد ثابت.',
                )}
              </label>
              <button type="submit">
                {busy
                  ? t('Posting…', 'جار الترحيل…')
                  : t('Post verified entry', 'ترحيل القيد المراجع')}
              </button>
            </fieldset>
          </form>
          <div className="account-history">
            <h3>{t('Account activity', 'حركة الحساب')}</h3>
            {!history.length && (
              <p>
                {t(
                  'No account entries yet for this customer.',
                  'لا توجد قيود حساب لهذا العميل بعد.',
                )}
              </p>
            )}
            {history.map((e) => (
              <article key={e.id}>
                <div>
                  <strong>{e.documentNumber}</strong>
                  <strong dir="ltr">{accountMoney(e.amountMinor, e.currency, locale)}</strong>
                </div>
                <span>
                  {labels[e.kind][en ? 0 : 1]}
                  {e.reversed ? t(' · Reversed', ' · معكوس') : ''}
                </span>
                {e.availableMinor !== null && (
                  <p>
                    {t('Unapplied: ', 'غير مخصص: ')}
                    {accountMoney(e.availableMinor, e.currency, locale)}
                  </p>
                )}
                <p>{en ? e.reasonEn : e.reasonAr}</p>
                <small>{new Date(e.postedAt).toLocaleString(en ? 'en-LB' : 'ar-LB')}</small>
                <details>
                  <summary>{t('Audit links', 'روابط التدقيق')}</summary>
                  <small>
                    {t('Entry: ', 'القيد: ')}
                    {e.id}
                    <br />
                    {t('Actor: ', 'الموظف: ')}
                    {e.actorId}
                    {e.invoiceId && (
                      <>
                        <br />
                        {t('Invoice: ', 'الفاتورة: ')}
                        {e.invoiceId}
                      </>
                    )}
                    {(e.sourceEntryId || e.reversesEntryId) && (
                      <>
                        <br />
                        {t('Source: ', 'المصدر: ')}
                        {e.reversesEntryId ?? e.sourceEntryId}
                      </>
                    )}
                  </small>
                </details>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
