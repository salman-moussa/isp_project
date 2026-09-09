import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  assuranceCommandSchema,
  assuranceControlCodes,
  type AssuranceCase,
  type AssuranceControlCode,
  type AssuranceFinding,
  type AssuranceWorkspace as Workspace,
} from '@isp/contracts';
import { readAssuranceWorkspace, submitTenantOperation } from '../api';
import { accountMoney } from '../billing/account-money';
import './assurance.css';

type View = 'controls' | 'findings' | 'cases';

export function AssuranceWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View>('controls');
  const [scope, setScope] = useState<'live' | 'all'>('live');
  const [control, setControl] = useState<AssuranceControlCode | ''>('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [opening, setOpening] = useState(false);
  const [acknowledging, setAcknowledging] = useState<AssuranceFinding>();
  const [selectedCase, setSelectedCase] = useState('');
  const [caseAction, setCaseAction] = useState<
    'assign' | 'investigating' | 'resolved' | 'written_off'
  >();
  const [running, setRunning] = useState(false);
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
    void readAssuranceWorkspace(session, { findings: scope, ...(control ? { control } : {}) })
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
  }, [session, scope, control, refresh]);
  const money = (minor: number, currency: 'USD' | 'LBP' | null) =>
    currency ? accountMoney(minor, currency, locale) : '—';
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
  const controlName = (code: AssuranceControlCode) =>
    ({
      ACTIVE_NOT_BILLED: t('Active service not billed (35 days)', 'خدمة نشطة دون فوترة (٣٥ يوماً)'),
      BILLED_AFTER_TERMINATION: t('Billed after termination', 'فوترة بعد الإنهاء'),
      INVOICE_OVERDUE_60: t('Invoice unpaid over 60 days', 'فاتورة غير مسددة لأكثر من ٦٠ يوماً'),
      PAYMENT_UNALLOCATED_7: t('Payment unallocated over 7 days', 'دفعة غير مخصصة لأكثر من ٧ أيام'),
      DUPLICATE_PAYMENT_SAME_DAY: t('Possible duplicate payment', 'دفعة مكررة محتملة'),
      VOUCHER_CREDIT_PENDING: t('Voucher credit pending', 'قيد قسيمة معلق'),
      COLLECTOR_VARIANCE_30: t(
        'Collector cash variance (30 days)',
        'فرق نقدي لدى الجابي (٣٠ يوماً)',
      ),
      DEALER_OVER_LIMIT: t('Dealer beyond credit limit', 'وكيل تجاوز سقف الائتمان'),
    })[code];
  const controlHint = (code: AssuranceControlCode) =>
    ({
      ACTIVE_NOT_BILLED: t(
        'Active services with no posted invoice in the last 35 days; exposure is the plan recurring amount.',
        'خدمات نشطة دون فاتورة مرحّلة خلال ٣٥ يوماً؛ التعرض هو مبلغ الخطة الدوري.',
      ),
      BILLED_AFTER_TERMINATION: t(
        'Invoices posted after the service was terminated.',
        'فواتير رُحّلت بعد إنهاء الخدمة.',
      ),
      INVOICE_OVERDUE_60: t(
        'Posted invoices older than 60 days with an unpaid remainder.',
        'فواتير مرحّلة أقدم من ٦٠ يوماً ولها رصيد غير مسدد.',
      ),
      PAYMENT_UNALLOCATED_7: t(
        'Posted payments older than 7 days not fully allocated to invoices.',
        'دفعات مرحّلة أقدم من ٧ أيام لم تُخصص بالكامل للفواتير.',
      ),
      DUPLICATE_PAYMENT_SAME_DAY: t(
        'Two live payments of the same amount on the same day allocated to the same invoice.',
        'دفعتان حيّتان بالمبلغ نفسه في اليوم نفسه مخصصتان للفاتورة نفسها.',
      ),
      VOUCHER_CREDIT_PENDING: t(
        'Redeemed vouchers whose subscriber credit has been pending for over an hour.',
        'قسائم مستخدمة تأخر قيد رصيد المشترك لها أكثر من ساعة.',
      ),
      COLLECTOR_VARIANCE_30: t(
        'Collector reconciliations with a declared-versus-expected difference in the last 30 days.',
        'تسويات جباة بفرق بين المعلن والمتوقع خلال ٣٠ يوماً.',
      ),
      DEALER_OVER_LIMIT: t(
        'Dealer float below the negative credit limit in either currency.',
        'رصيد وكيل تجاوز سقف الائتمان السالب بأي عملة.',
      ),
    })[code];
  const findingStatus = (value: AssuranceFinding['status']) =>
    ({
      open: t('Open', 'مفتوح'),
      acknowledged: t('Acknowledged', 'تم الإقرار'),
      resolved: t('Resolved', 'محلول'),
      cleared: t('Cleared', 'زال'),
    })[value];
  const caseStatus = (value: AssuranceCase['status']) =>
    ({
      open: t('Open', 'مفتوحة'),
      investigating: t('Investigating', 'قيد التحقيق'),
      resolved: t('Resolved', 'محلولة'),
      written_off: t('Written off', 'مشطوبة'),
    })[value];
  async function send(command: unknown, done: string) {
    if (!session || locked.current) return;
    const parsed = assuranceCommandSchema.safeParse(command);
    if (!parsed.success) {
      setError(
        t(
          'Complete the required fields in both languages. Closing a case needs a resolution and evidence.',
          'أكمل الحقول المطلوبة باللغتين. إغلاق الحالة يتطلب حلاً ودليلاً.',
        ),
      );
      return;
    }
    const fingerprint = JSON.stringify(parsed.data);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-assurance-${crypto.randomUUID()}` };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await submitTenantOperation(
        session,
        'assurance/commands',
        { command: parsed.data },
        retry.current.key,
      );
      if (!mounted.current) return;
      retry.current = undefined;
      setOpening(false);
      setAcknowledging(undefined);
      setCaseAction(undefined);
      setRunning(false);
      setSelected([]);
      setNotice(done);
      setRefresh((v) => v + 1);
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
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function runControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send(
      {
        action: 'run_controls',
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      },
      t(
        'Controls evaluated. Findings and exposure were refreshed.',
        'تم تقييم الضوابط وتحديث النتائج والتعرض.',
      ),
    );
  }
  function acknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acknowledging) return;
    const form = new FormData(event.currentTarget);
    void send(
      {
        action: 'acknowledge_finding',
        findingId: acknowledging.id,
        expectedVersion: acknowledging.version,
        ...(field(form, 'note') ? { note: field(form, 'note') } : {}),
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      },
      t('Finding acknowledged.', 'تم الإقرار بالنتيجة.'),
    );
  }
  function openCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send(
      {
        action: 'open_case',
        titleEn: field(form, 'titleEn'),
        titleAr: field(form, 'titleAr'),
        findingIds: selected,
        ...(field(form, 'ownerUserId') ? { ownerUserId: field(form, 'ownerUserId') } : {}),
        reasonEn: field(form, 'reasonEn'),
        reasonAr: field(form, 'reasonAr'),
      },
      t('Exposure case opened with the selected findings.', 'فُتحت حالة تعرض بالنتائج المحددة.'),
    );
  }
  function actOnCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = data?.cases.find((c) => c.id === selectedCase);
    if (!target || !caseAction) return;
    const form = new FormData(event.currentTarget);
    const reasons = { reasonEn: field(form, 'reasonEn'), reasonAr: field(form, 'reasonAr') };
    if (caseAction === 'assign') {
      void send(
        {
          action: 'assign_case',
          caseId: target.id,
          expectedVersion: target.version,
          ownerUserId: field(form, 'ownerUserId'),
          ...reasons,
        },
        t('Case owner updated.', 'تم تحديث مالك الحالة.'),
      );
      return;
    }
    void send(
      {
        action: 'transition_case',
        caseId: target.id,
        expectedVersion: target.version,
        status: caseAction,
        ...(caseAction === 'investigating'
          ? {}
          : {
              resolutionEn: field(form, 'resolutionEn'),
              resolutionAr: field(form, 'resolutionAr'),
              resolutionEvidence: field(form, 'resolutionEvidence'),
            }),
        ...reasons,
      },
      t('Case updated and audited.', 'تم تحديث الحالة وتدقيقها.'),
    );
  }
  if (!session)
    return (
      <section className="ra-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('Revenue assurance', 'ضمان الإيرادات')}</h1>
        <p>
          {t(
            'Sign in to review leakage controls and exposure cases.',
            'سجّل الدخول لمراجعة ضوابط التسرب وحالات التعرض.',
          )}
        </p>
      </section>
    );
  const summary = data?.summary;
  const latest = data?.latestRun;
  const selectable =
    data?.findings.filter(
      (f) => (f.status === 'open' || f.status === 'acknowledged') && !f.caseId,
    ) ?? [];
  const current = data?.cases.find((c) => c.id === selectedCase);
  return (
    <section className="ra-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="ra-hero">
        <div>
          <span>{t('REVENUE ASSURANCE', 'ضمان الإيرادات')}</span>
          <h1>
            {t(
              'Find leakage in your own records before it becomes loss.',
              'اكتشف التسرب في سجلاتك قبل أن يصبح خسارة.',
            )}
          </h1>
          <p>
            {t(
              'Eight deterministic controls read services, invoices, payments, vouchers, collectors and dealers. Findings keep their history across runs; cases carry ownership and closure evidence. Nothing here posts or reverses money.',
              'ثمانية ضوابط حتمية تقرأ الخدمات والفواتير والدفعات والقسائم والجباة والوكلاء. تحتفظ النتائج بتاريخها عبر التشغيلات؛ وتحمل الحالات الملكية ودليل الإغلاق. لا شيء هنا يرحّل مالاً أو يعكسه.',
            )}
          </p>
        </div>
        {summary && (
          <dl className="ra-stats" aria-label={t('Exposure summary', 'ملخص التعرض')}>
            <div className={summary.openFindings > 0 ? 'is-alert' : ''}>
              <dt>{t('Open findings', 'نتائج مفتوحة')}</dt>
              <dd>{summary.openFindings}</dd>
            </div>
            <div>
              <dt>{t('Acknowledged', 'مُقرّ بها')}</dt>
              <dd>{summary.acknowledgedFindings}</dd>
            </div>
            <div>
              <dt>{t('Open cases', 'حالات مفتوحة')}</dt>
              <dd>{summary.openCases}</dd>
            </div>
            <div>
              <dt>{t('Exposure USD', 'التعرض بالدولار')}</dt>
              <dd>{money(summary.exposureUsdMinor, 'USD')}</dd>
            </div>
            <div>
              <dt>{t('Exposure LBP', 'التعرض بالليرة')}</dt>
              <dd>{money(summary.exposureLbpMinor, 'LBP')}</dd>
            </div>
          </dl>
        )}
      </header>
      <nav className="ra-tabs" aria-label={t('Assurance views', 'عروض الضمان')}>
        {(
          [
            ['controls', t('Controls', 'الضوابط')],
            ['findings', t('Findings', 'النتائج')],
            ['cases', t('Cases', 'الحالات')],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            aria-current={view === key ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setView(key);
              setError('');
              setNotice('');
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="ra-panel ra-panel--positive" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="ra-panel ra-panel--negative" role="alert">
          {error}
        </p>
      )}
      {state === 'loading' && (
        <p role="status">{t('Loading revenue assurance…', 'جارٍ تحميل ضمان الإيرادات…')}</p>
      )}
      {state === 'error' && (
        <div className="ra-panel ra-panel--negative" role="alert">
          <h2>{t('Workspace unavailable', 'مساحة العمل غير متاحة')}</h2>
          <p>
            {t(
              'Check your connection and billing-view permission, then refresh.',
              'تحقق من الاتصال وصلاحية عرض الفوترة ثم حدّث.',
            )}
          </p>
          <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            {t('Refresh', 'تحديث')}
          </button>
        </div>
      )}

      {state === 'ready' && data && view === 'controls' && (
        <section className="ra-card">
          <div className="ra-card__header">
            <div>
              <h2>{t('Control catalogue', 'كتالوج الضوابط')}</h2>
              <p className="ra-note">
                {latest
                  ? `${t('Last run', 'آخر تشغيل')} ${date(latest.completedAt ?? latest.startedAt)} · ${latest.requestedBy}`
                  : t('Controls have not been run yet.', 'لم تُشغَّل الضوابط بعد.')}
              </p>
            </div>
            <div className="ra-actions">
              <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
                {t('Refresh', 'تحديث')}
              </button>
              <button
                type="button"
                className="ra-primary"
                disabled={busy}
                onClick={() => setRunning((v) => !v)}
              >
                {running ? t('Close', 'إغلاق') : t('Run controls', 'تشغيل الضوابط')}
              </button>
            </div>
          </div>
          {running && (
            <form className="ra-form" onSubmit={runControls}>
              <h3>{t('Evaluate every control now', 'تقييم كل الضوابط الآن')}</h3>
              <p className="ra-note">
                {t(
                  'Needs reconciliation authority. The run is recorded with its summary; findings that no longer apply clear themselves.',
                  'يتطلب صلاحية التسوية. يُسجَّل التشغيل مع ملخصه؛ والنتائج التي لم تعد قائمة تزول تلقائياً.',
                )}
              </p>
              <Reasons locale={locale} />
              <button type="submit" className="ra-primary" disabled={busy}>
                {busy ? t('Running…', 'جارٍ التشغيل…') : t('Run now', 'تشغيل الآن')}
              </button>
            </form>
          )}
          <div className="ra-controls">
            {assuranceControlCodes.map((code) => {
              const row = latest?.summary.find((s) => s.controlCode === code);
              return (
                <article
                  key={code}
                  className={'ra-control ' + (row && row.openFindings > 0 ? 'has-findings' : '')}
                >
                  <h3>{controlName(code)}</h3>
                  <p>{controlHint(code)}</p>
                  <dl>
                    <div>
                      <dt>{t('Open', 'مفتوح')}</dt>
                      <dd>{row?.openFindings ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('New in last run', 'جديد في آخر تشغيل')}</dt>
                      <dd>{row?.newFindings ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>USD</dt>
                      <dd>{row ? money(row.exposureUsdMinor, 'USD') : '—'}</dd>
                    </div>
                    <div>
                      <dt>LBP</dt>
                      <dd>{row ? money(row.exposureLbpMinor, 'LBP') : '—'}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setControl(code);
                      setView('findings');
                    }}
                  >
                    {t('See findings', 'عرض النتائج')}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {state === 'ready' && data && view === 'findings' && (
        <section className="ra-card">
          <div className="ra-card__header">
            <h2>{t('Findings', 'النتائج')}</h2>
            <div className="ra-actions">
              <label className="ra-inline">
                {t('Control', 'الضابط')}
                <select
                  value={control}
                  disabled={busy}
                  onChange={(e) => setControl(e.target.value as AssuranceControlCode | '')}
                >
                  <option value="">{t('All controls', 'كل الضوابط')}</option>
                  {assuranceControlCodes.map((code) => (
                    <option key={code} value={code}>
                      {controlName(code)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ra-inline">
                {t('Show', 'عرض')}
                <select
                  value={scope}
                  disabled={busy}
                  onChange={(e) => setScope(e.target.value as 'live' | 'all')}
                >
                  <option value="live">{t('Live only', 'القائمة فقط')}</option>
                  <option value="all">
                    {t('Including cleared and resolved', 'بما فيها الزائلة والمحلولة')}
                  </option>
                </select>
              </label>
              <button
                type="button"
                className="ra-primary"
                disabled={busy || selected.length === 0}
                onClick={() => setOpening((v) => !v)}
              >
                {t('Open case', 'فتح حالة')} ({selected.length})
              </button>
            </div>
          </div>
          {opening && (
            <form className="ra-form" onSubmit={openCase}>
              <h3>{t('New exposure case', 'حالة تعرض جديدة')}</h3>
              <div className="ra-grid">
                <label className="ra-field">
                  <span>{t('Title in English', 'العنوان بالإنجليزية')}</span>
                  <input
                    name="titleEn"
                    required
                    minLength={3}
                    maxLength={200}
                    lang="en"
                    dir="ltr"
                  />
                </label>
                <label className="ra-field">
                  <span>{t('Title in Arabic', 'العنوان بالعربية')}</span>
                  <input
                    name="titleAr"
                    required
                    minLength={3}
                    maxLength={200}
                    lang="ar"
                    dir="rtl"
                  />
                </label>
                <label className="ra-field">
                  <span>{t('Owner (optional)', 'المالك (اختياري)')}</span>
                  <select name="ownerUserId" defaultValue="">
                    <option value="">{t('Unassigned', 'غير معيّن')}</option>
                    {data.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Reasons locale={locale} />
              <div className="ra-actions">
                <button type="submit" className="ra-primary" disabled={busy}>
                  {busy
                    ? t('Saving…', 'جارٍ الحفظ…')
                    : t('Open case with findings', 'فتح الحالة بالنتائج')}
                </button>
                <button type="button" onClick={() => setOpening(false)}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {acknowledging && (
            <form className="ra-form" onSubmit={acknowledge}>
              <h3>
                {t('Acknowledge', 'الإقرار بـ')} {acknowledging.subjectReference}
              </h3>
              <label className="ra-field">
                <span>{t('Note (optional)', 'ملاحظة (اختياري)')}</span>
                <input name="note" maxLength={1000} />
              </label>
              <Reasons locale={locale} />
              <div className="ra-actions">
                <button type="submit" className="ra-primary" disabled={busy}>
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm', 'تأكيد')}
                </button>
                <button type="button" onClick={() => setAcknowledging(undefined)}>
                  {t('Cancel', 'إلغاء')}
                </button>
              </div>
            </form>
          )}
          {data.findings.length === 0 ? (
            <p className="ra-note">
              {t(
                'No findings in this view. Run the controls to evaluate the current records; an empty list after a run means the controls found nothing, not that every process is healthy.',
                'لا نتائج في هذا العرض. شغّل الضوابط لتقييم السجلات الحالية؛ القائمة الفارغة بعد التشغيل تعني أن الضوابط لم تجد شيئاً، لا أن كل العمليات سليمة.',
              )}
            </p>
          ) : (
            <div className="ra-table" role="table">
              <div className="ra-table__row ra-table__row--findings ra-table__head" role="row">
                <span role="columnheader">{t('Select', 'تحديد')}</span>
                <span role="columnheader">{t('Control', 'الضابط')}</span>
                <span role="columnheader">{t('Subject', 'الموضوع')}</span>
                <span role="columnheader">{t('Exposure', 'التعرض')}</span>
                <span role="columnheader">{t('Status', 'الحالة')}</span>
                <span role="columnheader">{t('Seen', 'رُصد')}</span>
                <span role="columnheader">{t('Actions', 'إجراءات')}</span>
              </div>
              {data.findings.map((f) => (
                <div
                  key={f.id}
                  className={'ra-table__row ra-table__row--findings status-' + f.status}
                  role="row"
                >
                  <span role="cell">
                    <input
                      type="checkbox"
                      aria-label={`${t('Select', 'تحديد')} ${f.subjectReference}`}
                      checked={selected.includes(f.id)}
                      disabled={!selectable.some((s) => s.id === f.id)}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked ? [...old, f.id] : old.filter((id) => id !== f.id),
                        )
                      }
                    />
                  </span>
                  <span role="cell">{controlName(f.controlCode)}</span>
                  <span role="cell">
                    <strong>{f.subjectReference}</strong>
                    <small>
                      {f.subscriberName ?? ''}
                      {f.caseNumber ? ` · ${f.caseNumber}` : ''}
                    </small>
                  </span>
                  <span role="cell">{money(f.exposureMinor, f.currency)}</span>
                  <span role="cell">
                    {findingStatus(f.status)}
                    {f.acknowledgedBy && <small>{f.acknowledgedBy}</small>}
                  </span>
                  <span role="cell">
                    {date(f.lastSeenAt)}
                    <small>
                      {t('first', 'أولاً')} {date(f.firstSeenAt)}
                    </small>
                  </span>
                  <span role="cell" className="ra-actions">
                    {f.status === 'open' && (
                      <button type="button" disabled={busy} onClick={() => setAcknowledging(f)}>
                        {t('Acknowledge', 'إقرار')}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'cases' && (
        <div className="ra-workbench">
          <section className="ra-card">
            <div className="ra-card__header">
              <h2>{t('Exposure cases', 'حالات التعرض')}</h2>
              <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
                {t('Refresh', 'تحديث')}
              </button>
            </div>
            {data.cases.length === 0 ? (
              <p className="ra-note">
                {t(
                  'No cases yet. Select findings and open a case.',
                  'لا حالات بعد. حدد نتائج وافتح حالة.',
                )}
              </p>
            ) : (
              <ul className="ra-cases">
                {data.cases.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={selectedCase === c.id ? 'is-selected' : ''}
                      aria-pressed={selectedCase === c.id}
                      disabled={busy}
                      onClick={() => {
                        setSelectedCase(c.id);
                        setCaseAction(undefined);
                      }}
                    >
                      <span className="ra-case__meta">
                        <span>{c.caseNumber}</span>
                        <span>{caseStatus(c.status)}</span>
                      </span>
                      <strong>{locale === 'ar' ? c.titleAr : c.titleEn}</strong>
                      <span>
                        {c.findings} {t('findings', 'نتيجة')} · {money(c.exposureUsdMinor, 'USD')} ·{' '}
                        {money(c.exposureLbpMinor, 'LBP')}
                        {c.ownerName ? ` · ${c.ownerName}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ra-card" aria-label={t('Case detail', 'تفاصيل الحالة')}>
            {!current ? (
              <p className="ra-note">
                {t(
                  'Select a case to see its findings and act on it.',
                  'اختر حالة لعرض نتائجها والتصرف فيها.',
                )}
              </p>
            ) : (
              <>
                <span className="ra-eyebrow">
                  {current.caseNumber} · {t('Version', 'الإصدار')} {current.version}
                </span>
                <h2>{locale === 'ar' ? current.titleAr : current.titleEn}</h2>
                <dl className="ra-facts">
                  <div>
                    <dt>{t('Status', 'الحالة')}</dt>
                    <dd>{caseStatus(current.status)}</dd>
                  </div>
                  <div>
                    <dt>{t('Owner', 'المالك')}</dt>
                    <dd>{current.ownerName ?? t('Unassigned', 'غير معيّن')}</dd>
                  </div>
                  <div>
                    <dt>{t('Opened', 'فُتحت')}</dt>
                    <dd>
                      {date(current.openedAt)} · {current.openedBy}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Exposure', 'التعرض')}</dt>
                    <dd>
                      {money(current.exposureUsdMinor, 'USD')} ·{' '}
                      {money(current.exposureLbpMinor, 'LBP')}
                    </dd>
                  </div>
                  {current.closedAt && (
                    <div>
                      <dt>{t('Closed', 'أُغلقت')}</dt>
                      <dd>{date(current.closedAt)}</dd>
                    </div>
                  )}
                </dl>
                {current.resolutionEn && (
                  <p className="ra-evidence">
                    {locale === 'ar' ? current.resolutionAr : current.resolutionEn}
                    <br />
                    <small>
                      {t('Evidence', 'الدليل')}: {current.resolutionEvidence}
                    </small>
                  </p>
                )}
                <h3>{t('Findings in this case', 'النتائج في هذه الحالة')}</h3>
                <ul className="ra-plain">
                  {data.findings
                    .filter((f) => f.caseId === current.id)
                    .map((f) => (
                      <li key={f.id}>
                        {controlName(f.controlCode)} · {f.subjectReference} ·{' '}
                        {money(f.exposureMinor, f.currency)} · {findingStatus(f.status)}
                      </li>
                    ))}
                </ul>
                {scope === 'live' &&
                  data.findings.filter((f) => f.caseId === current.id).length <
                    current.findings && (
                    <p className="ra-note">
                      {t(
                        'Some findings of this case are resolved or cleared; switch Findings to "including cleared" to see them.',
                        'بعض نتائج هذه الحالة محلولة أو زائلة؛ بدّل عرض النتائج إلى "بما فيها الزائلة" لرؤيتها.',
                      )}
                    </p>
                  )}
                {(current.status === 'open' || current.status === 'investigating') && (
                  <div className="ra-actions">
                    <button type="button" disabled={busy} onClick={() => setCaseAction('assign')}>
                      {t('Assign owner', 'تعيين مالك')}
                    </button>
                    {current.status === 'open' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCaseAction('investigating')}
                      >
                        {t('Start investigation', 'بدء التحقيق')}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => setCaseAction('resolved')}>
                      {t('Resolve', 'حل')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCaseAction('written_off')}
                    >
                      {t('Write off', 'شطب')}
                    </button>
                  </div>
                )}
                {caseAction && (
                  <form className="ra-form" onSubmit={actOnCase} key={caseAction}>
                    <h3>
                      {caseAction === 'assign'
                        ? t('Assign owner', 'تعيين مالك')
                        : caseAction === 'investigating'
                          ? t('Start investigation', 'بدء التحقيق')
                          : caseAction === 'resolved'
                            ? t('Resolve with evidence', 'الحل مع دليل')
                            : t('Write off with evidence', 'الشطب مع دليل')}
                    </h3>
                    {caseAction === 'assign' && (
                      <label className="ra-field">
                        <span>{t('Owner', 'المالك')}</span>
                        <select
                          name="ownerUserId"
                          required
                          defaultValue={current.ownerUserId ?? ''}
                        >
                          <option value="">{t('Choose a member', 'اختر عضواً')}</option>
                          {data.members.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(caseAction === 'resolved' || caseAction === 'written_off') && (
                      <div className="ra-grid">
                        <label className="ra-field">
                          <span>{t('Resolution in English', 'الحل بالإنجليزية')}</span>
                          <textarea
                            name="resolutionEn"
                            required
                            minLength={8}
                            maxLength={2000}
                            lang="en"
                            dir="ltr"
                          />
                        </label>
                        <label className="ra-field">
                          <span>{t('Resolution in Arabic', 'الحل بالعربية')}</span>
                          <textarea
                            name="resolutionAr"
                            required
                            minLength={8}
                            maxLength={2000}
                            lang="ar"
                            dir="rtl"
                          />
                        </label>
                        <label className="ra-field ra-field--wide">
                          <span>{t('Evidence reference', 'مرجع الدليل')}</span>
                          <input
                            name="resolutionEvidence"
                            required
                            minLength={8}
                            maxLength={2000}
                          />
                        </label>
                      </div>
                    )}
                    <Reasons locale={locale} />
                    <div className="ra-actions">
                      <button type="submit" className="ra-primary" disabled={busy}>
                        {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm', 'تأكيد')}
                      </button>
                      <button type="button" onClick={() => setCaseAction(undefined)}>
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function Reasons({ locale }: { readonly locale: Locale }) {
  return (
    <div className="ra-grid">
      <label className="ra-field">
        <span>{locale === 'ar' ? 'السبب (بالإنجليزية)' : 'Reason (English)'}</span>
        <textarea name="reasonEn" required minLength={8} maxLength={1000} lang="en" dir="ltr" />
      </label>
      <label className="ra-field">
        <span>{locale === 'ar' ? 'السبب (بالعربية)' : 'Reason (Arabic)'}</span>
        <textarea name="reasonAr" required minLength={8} maxLength={1000} lang="ar" dir="rtl" />
      </label>
    </div>
  );
}
