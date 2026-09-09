import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  adjustDealerBalanceSchema,
  dealerChannelCommandSchema,
  redeemVoucherSchema,
  retryVoucherCreditSchema,
  type DealerRecord,
  type DealerWorkspace as Workspace,
  type GeneratedVoucherPins,
  type VoucherBatchRecord,
} from '@isp/contracts';
import { readDealerWorkspace, submitTenantOperation } from '../api';
import { accountMoney, parseAccountAmount } from '../billing/account-money';
import './dealers.css';

type View = 'dealers' | 'batches' | 'redeem' | 'ledger';
type Currency = 'USD' | 'LBP';

export function DealerWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View>('dealers');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState<DealerRecord>();
  const [depositFor, setDepositFor] = useState<DealerRecord>();
  const [adjustFor, setAdjustFor] = useState<DealerRecord>();
  const [generating, setGenerating] = useState(false);
  const [issuing, setIssuing] = useState<VoucherBatchRecord>();
  const [cancelling, setCancelling] = useState<VoucherBatchRecord>();
  const [pins, setPins] = useState<GeneratedVoucherPins>();
  const [subscriberSearch, setSubscriberSearch] = useState('');
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
    if (!session) return;
    let active = true;
    setState('loading');
    void readDealerWorkspace(session)
      .then((result) => {
        if (active) {
          setData(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) {
          setData(undefined);
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, [session, refresh]);
  const money = useCallback(
    (minor: number, currency: Currency) => accountMoney(minor, currency, locale),
    [locale],
  );
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const field = (form: FormData, key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const optional = (form: FormData, key: string) => {
    const v = field(form, key);
    return v ? { [key]: v } : {};
  };
  const dealerType = (value: DealerRecord['dealerType']) =>
    ({
      dealer: t('Dealer', 'وكيل'),
      reseller: t('Reseller', 'موزّع'),
      pos: t('Point of sale', 'نقطة بيع'),
    })[value];
  const batchStatus = (value: VoucherBatchRecord['status']) =>
    ({
      generated: t('Generated', 'مولّدة'),
      issued: t('Issued', 'مُصدرة'),
      cancelled: t('Cancelled', 'ملغاة'),
    })[value];
  const entryKind = (value: Workspace['ledger'][number]['entryKind']) =>
    ({
      deposit: t('Deposit', 'إيداع'),
      batch_issue: t('Batch issued', 'إصدار دفعة'),
      commission: t('Commission', 'عمولة'),
      batch_cancel: t('Batch cancelled', 'إلغاء دفعة'),
      adjustment: t('Adjustment', 'تسوية'),
    })[value];
  const closeForms = () => {
    setRegistering(false);
    setEditing(undefined);
    setDepositFor(undefined);
    setAdjustFor(undefined);
    setGenerating(false);
    setIssuing(undefined);
    setCancelling(undefined);
  };
  async function send(path: string, command: unknown, done: string) {
    if (!session || locked.current) return undefined;
    const fingerprint = JSON.stringify({ path, command });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-dealer-${crypto.randomUUID()}` };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(session, path, { command }, retry.current.key);
      if (!mounted.current) return undefined;
      retry.current = undefined;
      closeForms();
      setNotice(done);
      setRefresh((v) => v + 1);
      return result;
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : t(
                'The change was not confirmed. Check access or refresh a changed record, then retry the same values.',
                'لم يتأكد التغيير. تحقق من الصلاحيات أو حدّث السجل إذا تغير ثم أعد المحاولة بالقيم نفسها.',
              ),
        );
      return undefined;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const invalid = () =>
    setError(
      t(
        'Complete the required fields in both languages and check amounts and codes.',
        'أكمل الحقول المطلوبة باللغتين وتحقق من المبالغ والرموز.',
      ),
    );
  function channel(command: unknown, done: string) {
    const parsed = dealerChannelCommandSchema.safeParse(command);
    if (!parsed.success) return invalid();
    void send('dealers/channel', parsed.data, done);
  }
  const savedDealer = t('Dealer saved and audited.', 'تم حفظ الوكيل وتدقيقه.');
  const savedLedger = t('Float entry recorded and audited.', 'تم تسجيل قيد الرصيد وتدقيقه.');
  const savedBatch = t('Batch updated and audited.', 'تم تحديث الدفعة وتدقيقها.');
  function submitDealer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numbers = {
      creditLimitMinorUsd: field(form, 'creditLimitUsd')
        ? parseAccountAmount(field(form, 'creditLimitUsd'), 'USD')
        : 0,
      creditLimitMinorLbp: field(form, 'creditLimitLbp')
        ? parseAccountAmount(field(form, 'creditLimitLbp'), 'LBP')
        : 0,
      commissionRateBps: Math.round(Number(field(form, 'commissionPercent') || '0') * 100),
    };
    const common = {
      dealerName: field(form, 'dealerName'),
      contactPhone: field(form, 'contactPhone'),
      dealerType: field(form, 'dealerType'),
      ...optional(form, 'contactName'),
      ...optional(form, 'email'),
      ...optional(form, 'notes'),
      reasonEn: field(form, 'reasonEn'),
      reasonAr: field(form, 'reasonAr'),
    };
    try {
      if (editing) {
        channel(
          {
            action: 'update_dealer',
            dealerId: editing.id,
            expectedVersion: editing.version,
            branchId: field(form, 'branchId') || null,
            status: field(form, 'status'),
            ...numbers,
            ...common,
          },
          savedDealer,
        );
      } else {
        channel(
          {
            action: 'register_dealer',
            dealerCode: field(form, 'dealerCode').toUpperCase(),
            ...optional(form, 'branchId'),
            ...numbers,
            ...common,
          },
          savedDealer,
        );
      }
    } catch {
      invalid();
    }
  }
  function submitDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!depositFor) return;
    const form = new FormData(event.currentTarget);
    const currency = field(form, 'currency') as Currency;
    try {
      channel(
        {
          action: 'record_deposit',
          dealerId: depositFor.id,
          currency,
          amountMinor: parseAccountAmount(field(form, 'amount'), currency),
          reference: field(form, 'reference'),
          reasonEn: field(form, 'reasonEn'),
          reasonAr: field(form, 'reasonAr'),
        },
        savedLedger,
      );
    } catch {
      invalid();
    }
  }
  function submitAdjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustFor) return;
    const form = new FormData(event.currentTarget);
    const currency = field(form, 'currency') as Currency;
    try {
      const amount = parseAccountAmount(field(form, 'amount'), currency);
      const parsed = adjustDealerBalanceSchema.safeParse({
        action: 'adjust_balance',
        dealerId: adjustFor.id,
        currency,
        amountMinor: field(form, 'direction') === 'decrease' ? -amount : amount,
        ...optional(form, 'reference'),
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      });
      if (!parsed.success) return invalid();
      void send('dealers/adjust', parsed.data, savedLedger);
    } catch {
      invalid();
    }
  }
  async function submitGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currency = field(form, 'currency') as Currency;
    try {
      const command = {
        action: 'generate_batch',
        batchNumber: field(form, 'batchNumber').toUpperCase(),
        faceValueMinor: parseAccountAmount(field(form, 'faceValue'), currency),
        currency,
        quantity: Number(field(form, 'quantity')),
        ...(field(form, 'expiresAt')
          ? { expiresAt: new Date(field(form, 'expiresAt')).toISOString() }
          : {}),
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      };
      const parsed = dealerChannelCommandSchema.safeParse(command);
      if (!parsed.success) return invalid();
      const result = await send(
        'dealers/batches',
        parsed.data,
        t(
          'Batch generated. The PINs below are shown once; print or hand them over now.',
          'تم توليد الدفعة. تظهر الرموز أدناه مرة واحدة؛ اطبعها أو سلّمها الآن.',
        ),
      );
      if (result && Array.isArray(result.pins)) {
        setPins(result as unknown as GeneratedVoucherPins);
        setView('batches');
      }
    } catch {
      invalid();
    }
  }
  function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issuing) return;
    const form = new FormData(event.currentTarget);
    channel(
      {
        action: 'issue_batch',
        batchId: issuing.id,
        expectedVersion: issuing.version,
        dealerId: field(form, 'dealerId'),
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      },
      savedBatch,
    );
  }
  function submitCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancelling) return;
    const form = new FormData(event.currentTarget);
    channel(
      {
        action: 'cancel_batch',
        batchId: cancelling.id,
        expectedVersion: cancelling.version,
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      },
      savedBatch,
    );
  }
  function submitRedeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = redeemVoucherSchema.safeParse({
      serialNumber: field(form, 'serialNumber').toUpperCase(),
      pin: field(form, 'pin').replace(/\s+/gu, ''),
      subscriberId: field(form, 'subscriberId'),
      reasonEn: field(form, 'reasonEn'),
      reasonAr: field(form, 'reasonAr'),
    });
    if (!parsed.success) return invalid();
    const target = event.currentTarget;
    void send(
      'dealers/redeem',
      parsed.data,
      t(
        'Voucher redeemed and the subscriber account credited.',
        'تم استخدام القسيمة وقيد الرصيد في حساب المشترك.',
      ),
    ).then((result) => {
      if (result) target.reset();
    });
  }
  function retryCredit(redemptionId: string) {
    const parsed = retryVoucherCreditSchema.safeParse({
      redemptionId,
      reasonEn: 'Retrying the subscriber credit for a redeemed voucher',
      reasonAr: 'إعادة محاولة قيد رصيد المشترك لقسيمة مستخدمة',
    });
    if (!parsed.success) return;
    void send(
      'dealers/credit-retry',
      parsed.data,
      t('Subscriber credit completed.', 'اكتمل قيد رصيد المشترك.'),
    );
  }
  if (!session)
    return (
      <section className="dealer-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('Dealers and vouchers', 'الوكلاء والقسائم')}</h1>
        <p>
          {t(
            'Sign in to manage the dealer channel inside your permitted scope.',
            'سجّل الدخول لإدارة قناة الوكلاء ضمن نطاق صلاحيتك.',
          )}
        </p>
      </section>
    );
  const summary = data?.summary;
  const subscribers =
    data?.subscribers.filter((s) =>
      (s.name + ' ' + s.subscriberNumber).toLowerCase().includes(subscriberSearch.toLowerCase()),
    ) ?? [];
  const activeDealers = data?.dealers.filter((d) => d.status === 'active') ?? [];
  return (
    <section className="dealer-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="dealer-hero">
        <div>
          <span>{t('SALES CHANNEL', 'قناة البيع')}</span>
          <h1>
            {t('Dealers, prepaid float and PIN vouchers.', 'الوكلاء والرصيد المسبق وقسائم الرموز.')}
          </h1>
          <p>
            {t(
              'Every dealer keeps a per-currency float; batches are issued against it net of commission and each redemption credits the subscriber account through the finance ledger.',
              'لكل وكيل رصيد بكل عملة على حدة؛ تُصدر الدفعات مقابله بعد خصم العمولة، وكل استخدام يقيّد رصيد المشترك عبر دفتر المالية.',
            )}
          </p>
        </div>
        {summary && (
          <dl className="dealer-stats" aria-label={t('Channel summary', 'ملخص القناة')}>
            <div>
              <dt>{t('Active dealers', 'وكلاء نشطون')}</dt>
              <dd>{summary.activeDealers}</dd>
            </div>
            <div>
              <dt>{t('Vouchers in the field', 'قسائم لدى الوكلاء')}</dt>
              <dd>{summary.issuedVouchersOutstanding}</dd>
            </div>
            <div className={summary.pendingCredits > 0 ? 'is-alert' : ''}>
              <dt>{t('Credits pending', 'أرصدة معلقة')}</dt>
              <dd>{summary.pendingCredits}</dd>
            </div>
            <div>
              <dt>{t('Float USD', 'الرصيد بالدولار')}</dt>
              <dd>{money(summary.floatUsdMinor, 'USD')}</dd>
            </div>
            <div>
              <dt>{t('Float LBP', 'الرصيد بالليرة')}</dt>
              <dd>{money(summary.floatLbpMinor, 'LBP')}</dd>
            </div>
          </dl>
        )}
      </header>
      <nav className="dealer-tabs" aria-label={t('Dealer channel views', 'عروض قناة الوكلاء')}>
        {(
          [
            ['dealers', t('Dealers', 'الوكلاء')],
            ['batches', t('Voucher batches', 'دفعات القسائم')],
            ['redeem', t('Redeem', 'استخدام قسيمة')],
            ['ledger', t('Float ledger', 'دفتر الرصيد')],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            aria-current={view === key ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setView(key);
              closeForms();
              setError('');
              setNotice('');
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="dealer-panel dealer-panel--positive" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="dealer-panel dealer-panel--negative" role="alert">
          {error}
        </p>
      )}
      {state === 'loading' && (
        <p role="status">{t('Loading dealer channel…', 'جارٍ تحميل قناة الوكلاء…')}</p>
      )}
      {state === 'error' && (
        <div className="dealer-panel dealer-panel--negative" role="alert">
          <h2>{t('Workspace unavailable', 'مساحة العمل غير متاحة')}</h2>
          <p>
            {t(
              'Check your connection and payment-view permission, then refresh.',
              'تحقق من الاتصال وصلاحية عرض الدفعات ثم حدّث.',
            )}
          </p>
          <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            {t('Refresh', 'تحديث')}
          </button>
        </div>
      )}
      {pins && (
        <section
          className="dealer-card dealer-pins"
          aria-label={t('Generated PINs', 'الرموز المولّدة')}
        >
          <div className="dealer-card__header">
            <h2>
              {t('PINs for batch', 'رموز الدفعة')} {pins.batchNumber}
            </h2>
            <button type="button" onClick={() => setPins(undefined)}>
              {t('I have handed them over', 'تم التسليم')}
            </button>
          </div>
          <p className="dealer-note">
            {t(
              'These PINs are not stored in clear text and will not be shown again. Print them for the dealer before closing this panel.',
              'لا تُحفظ هذه الرموز بشكل واضح ولن تظهر مجدداً. اطبعها للوكيل قبل إغلاق هذه اللوحة.',
            )}
          </p>
          <div className="dealer-table" role="table">
            <div
              className="dealer-table__row dealer-table__row--pins dealer-table__head"
              role="row"
            >
              <span role="columnheader">{t('Serial', 'الرقم التسلسلي')}</span>
              <span role="columnheader">PIN</span>
            </div>
            {pins.pins.map((p) => (
              <div
                key={p.serialNumber}
                className="dealer-table__row dealer-table__row--pins"
                role="row"
              >
                <span role="cell">{p.serialNumber}</span>
                <span role="cell">
                  <code>{p.pin}</code>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {state === 'ready' && data && view === 'dealers' && (
        <section className="dealer-card">
          <div className="dealer-card__header">
            <h2>{t('Dealer registry', 'سجل الوكلاء')}</h2>
            <div className="dealer-actions">
              <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
                {t('Refresh', 'تحديث')}
              </button>
              <button
                type="button"
                className="dealer-primary"
                disabled={busy}
                onClick={() => {
                  closeForms();
                  setRegistering(true);
                }}
              >
                {t('Register dealer', 'تسجيل وكيل')}
              </button>
            </div>
          </div>
          {(registering || editing) && (
            <form className="dealer-form" onSubmit={submitDealer} key={editing?.id ?? 'new'}>
              <h3>{editing ? t('Update dealer', 'تحديث الوكيل') : t('New dealer', 'وكيل جديد')}</h3>
              <div className="dealer-grid">
                {!editing && (
                  <label className="dealer-field">
                    <span>{t('Dealer code', 'رمز الوكيل')}</span>
                    <input
                      name="dealerCode"
                      required
                      pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,49}"
                      dir="ltr"
                    />
                  </label>
                )}
                <label className="dealer-field">
                  <span>{t('Dealer name', 'اسم الوكيل')}</span>
                  <input
                    name="dealerName"
                    required
                    minLength={2}
                    maxLength={150}
                    defaultValue={editing?.dealerName}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Type', 'النوع')}</span>
                  <select name="dealerType" defaultValue={editing?.dealerType ?? 'dealer'}>
                    {(['dealer', 'reseller', 'pos'] as const).map((v) => (
                      <option key={v} value={v}>
                        {dealerType(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Contact name', 'اسم جهة الاتصال')}</span>
                  <input
                    name="contactName"
                    maxLength={150}
                    defaultValue={editing?.contactName ?? ''}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Phone', 'الهاتف')}</span>
                  <input
                    name="contactPhone"
                    required
                    minLength={3}
                    maxLength={40}
                    dir="ltr"
                    defaultValue={editing?.contactPhone}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Email', 'البريد الإلكتروني')}</span>
                  <input
                    name="email"
                    type="email"
                    maxLength={200}
                    dir="ltr"
                    defaultValue={editing?.email ?? ''}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Branch', 'الفرع')}</span>
                  <select name="branchId" defaultValue={editing?.branchId ?? ''}>
                    <option value="">{t('Tenant-wide', 'على مستوى الشركة')}</option>
                    {data.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {locale === 'ar' ? b.nameAr : b.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Credit limit USD', 'سقف الائتمان بالدولار')}</span>
                  <input
                    name="creditLimitUsd"
                    inputMode="decimal"
                    dir="ltr"
                    defaultValue={editing ? (editing.creditLimitMinorUsd / 100).toFixed(2) : ''}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Credit limit LBP', 'سقف الائتمان بالليرة')}</span>
                  <input
                    name="creditLimitLbp"
                    inputMode="numeric"
                    dir="ltr"
                    defaultValue={editing ? String(editing.creditLimitMinorLbp) : ''}
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Commission %', 'العمولة %')}</span>
                  <input
                    name="commissionPercent"
                    inputMode="decimal"
                    dir="ltr"
                    defaultValue={editing ? (editing.commissionRateBps / 100).toString() : '5'}
                  />
                </label>
                {editing && (
                  <label className="dealer-field">
                    <span>{t('Status', 'الحالة')}</span>
                    <select name="status" defaultValue={editing.status}>
                      <option value="active">{t('Active', 'نشط')}</option>
                      <option value="suspended">{t('Suspended', 'موقوف')}</option>
                    </select>
                  </label>
                )}
                <label className="dealer-field dealer-field--wide">
                  <span>{t('Notes', 'ملاحظات')}</span>
                  <input name="notes" maxLength={2000} defaultValue={editing?.notes ?? ''} />
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save dealer', 'حفظ الوكيل')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {depositFor && (
            <form className="dealer-form" onSubmit={submitDeposit}>
              <h3>
                {t('Record deposit for', 'تسجيل إيداع لـ')} {depositFor.dealerName}
              </h3>
              <div className="dealer-grid">
                <label className="dealer-field">
                  <span>{t('Currency', 'العملة')}</span>
                  <select name="currency" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Amount', 'المبلغ')}</span>
                  <input name="amount" required inputMode="decimal" dir="ltr" />
                </label>
                <label className="dealer-field dealer-field--wide">
                  <span>{t('Receipt or bank reference', 'مرجع الإيصال أو الحوالة')}</span>
                  <input name="reference" required minLength={3} maxLength={200} dir="ltr" />
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Record deposit', 'تسجيل الإيداع')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {adjustFor && (
            <form className="dealer-form" onSubmit={submitAdjust}>
              <h3>
                {t('Approved float adjustment for', 'تسوية رصيد معتمدة لـ')} {adjustFor.dealerName}
              </h3>
              <p className="dealer-note">
                {t(
                  'Needs reconciliation authority and a recent MFA step-up. The entry is appended, never edited.',
                  'تتطلب صلاحية التسوية وتحققاً ثنائياً حديثاً. يُضاف القيد ولا يُعدَّل أبداً.',
                )}
              </p>
              <div className="dealer-grid">
                <label className="dealer-field">
                  <span>{t('Currency', 'العملة')}</span>
                  <select name="currency" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Direction', 'الاتجاه')}</span>
                  <select name="direction" defaultValue="increase">
                    <option value="increase">{t('Increase float', 'زيادة الرصيد')}</option>
                    <option value="decrease">{t('Decrease float', 'إنقاص الرصيد')}</option>
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Amount', 'المبلغ')}</span>
                  <input name="amount" required inputMode="decimal" dir="ltr" />
                </label>
                <label className="dealer-field">
                  <span>{t('Reference (optional)', 'المرجع (اختياري)')}</span>
                  <input name="reference" maxLength={200} dir="ltr" />
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Post adjustment', 'ترحيل التسوية')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {data.dealers.length === 0 ? (
            <p className="dealer-note">
              {t(
                'No dealers registered yet. Register the first dealer to start issuing voucher batches.',
                'لا وكلاء مسجلون بعد. سجّل الوكيل الأول لبدء إصدار دفعات القسائم.',
              )}
            </p>
          ) : (
            <div className="dealer-table" role="table">
              <div
                className="dealer-table__row dealer-table__row--dealers dealer-table__head"
                role="row"
              >
                <span role="columnheader">{t('Dealer', 'الوكيل')}</span>
                <span role="columnheader">{t('Contact', 'جهة الاتصال')}</span>
                <span role="columnheader">{t('Float USD', 'الرصيد بالدولار')}</span>
                <span role="columnheader">{t('Float LBP', 'الرصيد بالليرة')}</span>
                <span role="columnheader">{t('Commission', 'العمولة')}</span>
                <span role="columnheader">{t('Activity', 'النشاط')}</span>
                <span role="columnheader">{t('Actions', 'إجراءات')}</span>
              </div>
              {data.dealers.map((d) => (
                <div
                  key={d.id}
                  className={'dealer-table__row dealer-table__row--dealers status-' + d.status}
                  role="row"
                >
                  <span role="cell">
                    <strong>{d.dealerName}</strong>
                    <small>
                      {d.dealerCode} · {dealerType(d.dealerType)}
                      {d.branchName ? ` · ${d.branchName}` : ''}
                      {d.status === 'suspended' ? ` · ${t('Suspended', 'موقوف')}` : ''}
                    </small>
                  </span>
                  <span role="cell">
                    {d.contactName ?? '—'}
                    <small>{d.contactPhone}</small>
                  </span>
                  {d.balances.map((b) => (
                    <span
                      role="cell"
                      key={b.currency}
                      className={b.balanceMinor < 0 ? 'is-negative' : ''}
                    >
                      {money(b.balanceMinor, b.currency)}
                      <small>
                        {t('available', 'المتاح')} {money(b.availableMinor, b.currency)}
                      </small>
                    </span>
                  ))}
                  <span role="cell">{(d.commissionRateBps / 100).toFixed(2)}%</span>
                  <span role="cell">
                    {d.issuedBatches} {t('batches', 'دفعة')}
                    <small>
                      {d.redeemedVouchers} {t('redeemed', 'مستخدمة')}
                    </small>
                  </span>
                  <span role="cell" className="dealer-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        closeForms();
                        setEditing(d);
                      }}
                    >
                      {t('Edit', 'تعديل')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        closeForms();
                        setDepositFor(d);
                      }}
                    >
                      {t('Deposit', 'إيداع')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        closeForms();
                        setAdjustFor(d);
                      }}
                    >
                      {t('Adjust', 'تسوية')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'batches' && (
        <section className="dealer-card">
          <div className="dealer-card__header">
            <h2>{t('Voucher batches', 'دفعات القسائم')}</h2>
            <div className="dealer-actions">
              <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
                {t('Refresh', 'تحديث')}
              </button>
              <button
                type="button"
                className="dealer-primary"
                disabled={busy}
                onClick={() => {
                  closeForms();
                  setGenerating(true);
                }}
              >
                {t('Generate batch', 'توليد دفعة')}
              </button>
            </div>
          </div>
          {generating && (
            <form className="dealer-form" onSubmit={(event) => void submitGenerate(event)}>
              <h3>{t('New voucher batch', 'دفعة قسائم جديدة')}</h3>
              <div className="dealer-grid">
                <label className="dealer-field">
                  <span>{t('Batch number', 'رقم الدفعة')}</span>
                  <input
                    name="batchNumber"
                    required
                    pattern="[A-Za-z0-9][A-Za-z0-9-]{1,39}"
                    placeholder="B-2026-001"
                    dir="ltr"
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Currency', 'العملة')}</span>
                  <select name="currency" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                  </select>
                </label>
                <label className="dealer-field">
                  <span>{t('Face value', 'القيمة الاسمية')}</span>
                  <input name="faceValue" required inputMode="decimal" dir="ltr" />
                </label>
                <label className="dealer-field">
                  <span>{t('Quantity (1-2000)', 'الكمية (1-2000)')}</span>
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    max={2000}
                    required
                    defaultValue={100}
                    dir="ltr"
                  />
                </label>
                <label className="dealer-field">
                  <span>{t('Expires (optional)', 'تنتهي في (اختياري)')}</span>
                  <input name="expiresAt" type="datetime-local" />
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy
                    ? t('Generating…', 'جارٍ التوليد…')
                    : t('Generate vouchers', 'توليد القسائم')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {issuing && (
            <form className="dealer-form" onSubmit={submitIssue}>
              <h3>
                {t('Issue batch', 'إصدار الدفعة')} {issuing.batchNumber}
              </h3>
              <p className="dealer-note">
                {t('Face total', 'إجمالي القيمة')}:{' '}
                {money(issuing.faceValueMinor * issuing.quantity, issuing.currency)}.{' '}
                {t(
                  'The dealer float is charged net of commission and must stay within the credit limit.',
                  'يُحمَّل رصيد الوكيل بعد خصم العمولة ويجب أن يبقى ضمن سقف الائتمان.',
                )}
              </p>
              <div className="dealer-grid">
                <label className="dealer-field">
                  <span>{t('Dealer', 'الوكيل')}</span>
                  <select name="dealerId" required defaultValue="">
                    <option value="">{t('Choose an active dealer', 'اختر وكيلاً نشطاً')}</option>
                    {activeDealers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.dealerName} · {d.dealerCode}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Issue to dealer', 'إصدار للوكيل')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {cancelling && (
            <form className="dealer-form" onSubmit={submitCancel}>
              <h3>
                {t('Cancel remaining vouchers in', 'إلغاء القسائم المتبقية في')}{' '}
                {cancelling.batchNumber}
              </h3>
              <p className="dealer-note">
                {t(
                  'Unredeemed vouchers are cancelled and the dealer float is credited back net of commission. Redeemed vouchers stay redeemed.',
                  'تُلغى القسائم غير المستخدمة ويُعاد المبلغ إلى رصيد الوكيل بعد خصم العمولة. تبقى القسائم المستخدمة كما هي.',
                )}
              </p>
              <Reasons locale={locale} />
              <div className="dealer-actions">
                <button type="submit" className="dealer-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm cancellation', 'تأكيد الإلغاء')}
                </button>
                <button type="button" onClick={closeForms}>
                  {t('Back', 'رجوع')}
                </button>
              </div>
            </form>
          )}
          {data.batches.length === 0 ? (
            <p className="dealer-note">{t('No batches yet.', 'لا دفعات بعد.')}</p>
          ) : (
            <div className="dealer-table" role="table">
              <div
                className="dealer-table__row dealer-table__row--batches dealer-table__head"
                role="row"
              >
                <span role="columnheader">{t('Batch', 'الدفعة')}</span>
                <span role="columnheader">{t('Status', 'الحالة')}</span>
                <span role="columnheader">{t('Dealer', 'الوكيل')}</span>
                <span role="columnheader">{t('Face value', 'القيمة')}</span>
                <span role="columnheader">{t('Vouchers', 'القسائم')}</span>
                <span role="columnheader">{t('Dates', 'التواريخ')}</span>
                <span role="columnheader">{t('Actions', 'إجراءات')}</span>
              </div>
              {data.batches.map((b) => (
                <div
                  key={b.id}
                  className={'dealer-table__row dealer-table__row--batches status-' + b.status}
                  role="row"
                >
                  <span role="cell">
                    <strong>{b.batchNumber}</strong>
                  </span>
                  <span role="cell">{batchStatus(b.status)}</span>
                  <span role="cell">{b.dealerName ?? '—'}</span>
                  <span role="cell">
                    {money(b.faceValueMinor, b.currency)}
                    <small>
                      {t('total', 'الإجمالي')} {money(b.faceValueMinor * b.quantity, b.currency)}
                    </small>
                  </span>
                  <span role="cell">
                    {b.quantity}
                    <small>
                      {b.issuedCount} {t('in field', 'لدى الوكيل')} · {b.redeemedCount}{' '}
                      {t('redeemed', 'مستخدمة')} · {b.cancelledCount} {t('cancelled', 'ملغاة')}
                    </small>
                  </span>
                  <span role="cell">
                    {date(b.generatedAt)}
                    <small>
                      {b.issuedAt ? `${t('issued', 'أُصدرت')} ${date(b.issuedAt)}` : ''}
                      {b.expiresAt ? ` · ${t('expires', 'تنتهي')} ${date(b.expiresAt)}` : ''}
                    </small>
                  </span>
                  <span role="cell" className="dealer-actions">
                    {b.status === 'generated' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          closeForms();
                          setIssuing(b);
                        }}
                      >
                        {t('Issue', 'إصدار')}
                      </button>
                    )}
                    {b.status !== 'cancelled' &&
                      b.issuedCount + (b.status === 'generated' ? b.quantity : 0) > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            closeForms();
                            setCancelling(b);
                          }}
                        >
                          {t('Cancel remaining', 'إلغاء المتبقي')}
                        </button>
                      )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'redeem' && (
        <section className="dealer-card">
          <div className="dealer-card__header">
            <h2>{t('Redeem a voucher for a subscriber', 'استخدام قسيمة لمشترك')}</h2>
            <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
              {t('Refresh', 'تحديث')}
            </button>
          </div>
          <form className="dealer-form" onSubmit={submitRedeem}>
            <div className="dealer-grid">
              <label className="dealer-field">
                <span>{t('Serial number', 'الرقم التسلسلي')}</span>
                <input
                  name="serialNumber"
                  required
                  minLength={4}
                  maxLength={60}
                  dir="ltr"
                  placeholder="B-2026-001-00042"
                />
              </label>
              <label className="dealer-field">
                <span>{t('PIN (12 digits)', 'الرمز (12 رقماً)')}</span>
                <input
                  name="pin"
                  required
                  inputMode="numeric"
                  pattern="[0-9 ]{12,15}"
                  dir="ltr"
                  autoComplete="off"
                />
              </label>
              <label className="dealer-field">
                <span>{t('Find subscriber', 'البحث عن مشترك')}</span>
                <input
                  type="search"
                  value={subscriberSearch}
                  onChange={(e) => setSubscriberSearch(e.target.value)}
                />
              </label>
              <label className="dealer-field">
                <span>{t('Subscriber', 'المشترك')}</span>
                <select name="subscriberId" required defaultValue="">
                  <option value="">{t('Choose a subscriber', 'اختر مشتركاً')}</option>
                  {subscribers.slice(0, 200).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subscriberNumber} · {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {data.subscriberDirectoryTruncated && (
              <p className="dealer-note" role="status">
                {t(
                  'Directory shows the first 1,000 accessible subscribers; narrow the search if the subscriber is absent.',
                  'يعرض الدليل أول ١٠٠٠ مشترك متاح؛ ضيّق البحث إذا لم يظهر المشترك.',
                )}
              </p>
            )}
            <Reasons locale={locale} />
            <p className="dealer-note">
              {t(
                'Five wrong PINs lock the voucher. A successful redemption posts a deposit to the subscriber account under the finance ledger.',
                'خمسة رموز خاطئة تقفل القسيمة. الاستخدام الناجح يرحّل إيداعاً إلى حساب المشترك في دفتر المالية.',
              )}
            </p>
            <button type="submit" className="dealer-primary" disabled={busy}>
              {busy ? t('Redeeming…', 'جارٍ الاستخدام…') : t('Redeem voucher', 'استخدام القسيمة')}
            </button>
          </form>
          <h3>{t('Recent redemptions', 'الاستخدامات الأخيرة')}</h3>
          {data.redemptions.length === 0 ? (
            <p className="dealer-note">{t('No redemptions yet.', 'لا استخدامات بعد.')}</p>
          ) : (
            <div className="dealer-table" role="table">
              <div
                className="dealer-table__row dealer-table__row--redemptions dealer-table__head"
                role="row"
              >
                <span role="columnheader">{t('Voucher', 'القسيمة')}</span>
                <span role="columnheader">{t('Subscriber', 'المشترك')}</span>
                <span role="columnheader">{t('Amount', 'المبلغ')}</span>
                <span role="columnheader">{t('Credit', 'القيد')}</span>
                <span role="columnheader">{t('When', 'التاريخ')}</span>
                <span role="columnheader">{t('By', 'بواسطة')}</span>
              </div>
              {data.redemptions.map((r) => (
                <div
                  key={r.id}
                  className={'dealer-table__row dealer-table__row--redemptions status-' + r.status}
                  role="row"
                >
                  <span role="cell">
                    <strong>{r.serialNumber}</strong>
                    <small>{r.batchNumber}</small>
                  </span>
                  <span role="cell">{r.subscriberName}</span>
                  <span role="cell">{money(r.amountMinor, r.currency)}</span>
                  <span role="cell">
                    {r.status === 'credited'
                      ? t('Credited', 'مقيّد')
                      : t('Credit pending', 'القيد معلق')}
                    {r.status === 'credit_pending' && (
                      <button type="button" disabled={busy} onClick={() => retryCredit(r.id)}>
                        {t('Complete credit', 'إكمال القيد')}
                      </button>
                    )}
                  </span>
                  <span role="cell">{date(r.redeemedAt)}</span>
                  <span role="cell">{r.actorName}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'ledger' && (
        <section className="dealer-card">
          <div className="dealer-card__header">
            <h2>{t('Float ledger', 'دفتر الرصيد')}</h2>
            <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
              {t('Refresh', 'تحديث')}
            </button>
          </div>
          {data.ledger.length === 0 ? (
            <p className="dealer-note">{t('No ledger entries yet.', 'لا قيود بعد.')}</p>
          ) : (
            <div className="dealer-table" role="table">
              <div
                className="dealer-table__row dealer-table__row--ledger dealer-table__head"
                role="row"
              >
                <span role="columnheader">{t('When', 'التاريخ')}</span>
                <span role="columnheader">{t('Dealer', 'الوكيل')}</span>
                <span role="columnheader">{t('Entry', 'القيد')}</span>
                <span role="columnheader">{t('Amount', 'المبلغ')}</span>
                <span role="columnheader">{t('Balance after', 'الرصيد بعده')}</span>
                <span role="columnheader">{t('Reference', 'المرجع')}</span>
                <span role="columnheader">{t('By', 'بواسطة')}</span>
              </div>
              {data.ledger.map((l) => (
                <div key={l.id} className="dealer-table__row dealer-table__row--ledger" role="row">
                  <span role="cell">{date(l.createdAt)}</span>
                  <span role="cell">{l.dealerName}</span>
                  <span role="cell">
                    {entryKind(l.entryKind)}
                    <small>{locale === 'ar' ? l.reasonAr : l.reasonEn}</small>
                  </span>
                  <span role="cell" className={l.amountMinor < 0 ? 'is-negative' : 'is-positive'}>
                    {money(l.amountMinor, l.currency)}
                  </span>
                  <span role="cell">{money(l.balanceAfterMinor, l.currency)}</span>
                  <span role="cell">{l.batchNumber ?? l.reference ?? '—'}</span>
                  <span role="cell">{l.actorName}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function Reasons({ locale }: { readonly locale: Locale }) {
  return (
    <div className="dealer-grid">
      <label className="dealer-field">
        <span>{locale === 'ar' ? 'السبب (بالإنجليزية)' : 'Reason (English)'}</span>
        <textarea name="reasonEn" required minLength={8} maxLength={1000} lang="en" dir="ltr" />
      </label>
      <label className="dealer-field">
        <span>{locale === 'ar' ? 'السبب (بالعربية)' : 'Reason (Arabic)'}</span>
        <textarea name="reasonAr" required minLength={8} maxLength={1000} lang="ar" dir="rtl" />
      </label>
    </div>
  );
}
