import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  createOutageSchema,
  transitionOutageSchema,
  type NocWorkspace as Workspace,
  type NocIncident,
} from '@isp/contracts';
import { readNocWorkspace, submitTenantOperation } from '../api';
import './noc.css';

export function NocWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>(),
    [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState<'open' | 'all' | 'resolved'>('open'),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [route, setRoute] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]),
    [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const mounted = useRef(true),
    locked = useRef(false),
    retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
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
    void readNocWorkspace(session, { page, pageSize: 25, status })
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
  }, [session, status, page, refresh]);
  const incident = data?.incidents.find((i) => i.id === selected);
  const services =
    data?.services.filter(
      (s) =>
        s.routeId === route &&
        (s.serviceNumber + ' ' + s.subscriberName).toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const label = (value: NocIncident['status']) =>
    ({
      investigating: t('Investigating', 'قيد التحقيق'),
      identified: t('Cause identified', 'تم تحديد السبب'),
      monitoring: t('Monitoring recovery', 'مراقبة التعافي'),
      resolved: t('Resolved', 'تم الحل'),
    })[value];
  const severity = (value: NocIncident['severity']) =>
    ({
      critical: t('Critical', 'حرج'),
      major: t('Major', 'مرتفع'),
      minor: t('Minor', 'منخفض'),
      warning: t('Warning', 'تنبيه'),
    })[value];
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const value = (form: FormData, key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  async function send(path: string, command: unknown) {
    if (!session || locked.current) return;
    const fingerprint = JSON.stringify({ path, command });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(session, path, { command }, retry.current.key);
      if (!mounted.current) return;
      retry.current = undefined;
      setCreating(false);
      setServiceIds([]);
      setRoute('');
      setSearch('');
      setSelected(typeof result.id === 'string' ? result.id : '');
      setNotice(
        t(
          'Incident saved. History and audit evidence were recorded.',
          'تم حفظ الحادث وتسجيل السجل ودليل التدقيق.',
        ),
      );
      setRefresh((v) => v + 1);
    } catch {
      if (mounted.current)
        setError(
          t(
            'The change was not confirmed. Check access or refresh a changed incident. Retry unchanged values to recover a lost response safely.',
            'لم يتأكد التغيير. تحقق من الصلاحيات أو حدّث الحادث إذا تغير. أعد إرسال القيم نفسها لاستعادة رد مفقود بأمان.',
          ),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = createOutageSchema.safeParse({
      titleEn: value(form, 'titleEn'),
      titleAr: value(form, 'titleAr'),
      routeId: route,
      severity: value(form, 'severity'),
      serviceIds,
      reasonEn: value(form, 'reasonEn'),
      reasonAr: value(form, 'reasonAr'),
    });
    if (!result.success) {
      setError(
        t(
          'Choose a route and affected services, and complete both languages.',
          'اختر مساراً وخدمات متأثرة وأكمل البيانات باللغتين.',
        ),
      );
      return;
    }
    void send('noc/incidents', result.data);
  }
  function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!incident) return;
    const form = new FormData(event.currentTarget),
      next = value(form, 'status');
    const result = transitionOutageSchema.safeParse({
      outageId: incident.id,
      expectedVersion: incident.version,
      status: next,
      reasonEn: value(form, 'reasonEn'),
      reasonAr: value(form, 'reasonAr'),
      ...(next === 'resolved'
        ? {
            rootCauseEn: value(form, 'rootCauseEn'),
            rootCauseAr: value(form, 'rootCauseAr'),
            resolutionEvidence: value(form, 'resolutionEvidence'),
          }
        : {}),
    });
    if (!result.success) {
      setError(
        t(
          'Complete bilingual reasons. Resolving also requires the root cause and verification evidence.',
          'أكمل الأسباب باللغتين. الحل يتطلب السبب الجذري ودليل التحقق أيضاً.',
        ),
      );
      return;
    }
    void send('noc/incidents/transition', result.data);
  }
  if (!session)
    return (
      <section className="noc-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('NOC incidents', 'حوادث الشبكة')}</h1>
        <p>
          {t(
            'Sign in to view your permitted incident workspace.',
            'سجّل الدخول لعرض الحوادث المسموح لك بالوصول إليها.',
          )}
        </p>
      </section>
    );
  return (
    <section className="noc-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="noc-header">
        <div>
          <span className="noc-eyebrow">{t('NETWORK OPERATIONS', 'عمليات الشبكة')}</span>
          <h1>{t('From interruption to resolution.', 'من الانقطاع إلى استعادة الخدمة.')}</h1>
          <p>
            {t(
              'One incident, a clear impact list and a traceable recovery history.',
              'حادث واحد، قائمة واضحة للخدمات المتأثرة وسجل موثق لاستعادة الخدمة.',
            )}
          </p>
        </div>
        <button
          type="button"
          className="noc-primary"
          disabled={busy || state !== 'ready'}
          onClick={() => {
            setCreating((v) => !v);
            setError('');
            setNotice('');
          }}
        >
          {creating
            ? t('Close new incident', 'إغلاق الحادث الجديد')
            : t('Record incident', 'تسجيل حادث')}
        </button>
      </header>
      <div className="noc-boundary">
        <span aria-hidden="true">●</span>
        <p>
          {t(
            'Operator-recorded incidents · Scoped service impact · No automatic router changes or provider notifications',
            'حوادث مسجلة بواسطة المشغل · تأثير الخدمات ضمن الصلاحيات · دون تغييرات آلية للموجّه أو إشعارات للمزود',
          )}
        </p>
      </div>
      {notice && (
        <p className="noc-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="noc-error" role="alert">
          {error}
        </p>
      )}
      <div className="noc-toolbar">
        <label>
          {t('Show incidents', 'عرض الحوادث')}
          <select
            disabled={busy}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
              setSelected('');
            }}
          >
            <option value="open">{t('Open incidents', 'الحوادث المفتوحة')}</option>
            <option value="resolved">{t('Resolved', 'تم الحل')}</option>
            <option value="all">{t('All history', 'كامل السجل')}</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          {t('Refresh', 'تحديث')}
        </button>
        {data && state === 'ready' && (
          <span>
            {data.totalCount} {t('incidents in this view', 'حادث في هذا العرض')}
          </span>
        )}
      </div>
      {state === 'loading' && (
        <p role="status">
          {t('Loading scoped incident workspace…', 'جارٍ تحميل الحوادث ضمن نطاق الصلاحية…')}
        </p>
      )}
      {state === 'error' && (
        <div className="noc-error" role="alert">
          <h2>{t('Workspace unavailable', 'مساحة العمل غير متاحة')}</h2>
          <p>
            {t(
              'Check your connection and network-view permission, then refresh. No demonstration records are shown.',
              'تحقق من الاتصال وصلاحية عرض الشبكة ثم حدّث. لا تُعرض سجلات تجريبية.',
            )}
          </p>
        </div>
      )}
      {creating && data && (
        <form className="noc-card noc-create" onSubmit={create}>
          <fieldset disabled={busy || state !== 'ready'}>
            <legend>{t('New incident • define the impact', 'حادث جديد • تحديد التأثير')}</legend>
            <div className="noc-fields">
              <label>
                {t('Title in English', 'العنوان بالإنجليزية')}
                <input name="titleEn" required minLength={3} maxLength={200} lang="en" dir="ltr" />
              </label>
              <label>
                {t('Title in Arabic', 'العنوان بالعربية')}
                <input name="titleAr" required minLength={3} maxLength={200} lang="ar" dir="rtl" />
              </label>
              <label>
                {t('Route', 'المسار')}
                <select
                  required
                  value={route}
                  onChange={(e) => {
                    setRoute(e.target.value);
                    setServiceIds([]);
                    setSearch('');
                  }}
                >
                  <option value="">{t('Choose a scoped route', 'اختر مساراً ضمن الصلاحية')}</option>
                  {data.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {locale === 'ar' ? r.nameAr : r.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Severity', 'الخطورة')}
                <select name="severity" defaultValue="major">
                  {(['critical', 'major', 'minor', 'warning'] as const).map((s) => (
                    <option key={s} value={s}>
                      {severity(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="noc-services">
              <legend>
                {t('Affected services', 'الخدمات المتأثرة')} · {serviceIds.length}/200
              </legend>
              <label>
                {t('Find service or customer', 'البحث عن خدمة أو عميل')}
                <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" />
              </label>
              {data.serviceDirectoryTruncated && (
                <p role="status">
                  {t(
                    'Directory shows the first 1,000 accessible services. Narrow your staff scope if the required service is absent.',
                    'يعرض الدليل أول ١٠٠٠ خدمة متاحة. ضيّق نطاق صلاحية الموظف إذا لم تظهر الخدمة المطلوبة.',
                  )}
                </p>
              )}
              <div className="noc-service-list">
                {services.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={serviceIds.includes(s.id)}
                      disabled={!serviceIds.includes(s.id) && serviceIds.length >= 200}
                      onChange={(e) =>
                        setServiceIds((old) =>
                          e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span>
                      <strong>{s.serviceNumber}</strong>
                      <small>{s.subscriberName}</small>
                    </span>
                  </label>
                ))}
              </div>
              {services.length === 0 && (
                <p>
                  {t(
                    'Choose a route with accessible services. No matching services are listed.',
                    'اختر مساراً له خدمات متاحة. لا توجد خدمات مطابقة.',
                  )}
                </p>
              )}
            </fieldset>
            <Reasons locale={locale} />
            <p className="noc-hint">
              {t(
                'The server calculates affected customers from these services; no estimated count is posted.',
                'يحسب الخادم العملاء المتأثرين من هذه الخدمات؛ لا يُرحَّل عدد تقديري.',
              )}
            </p>
            <button className="noc-primary" type="submit" disabled={serviceIds.length === 0}>
              {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Create incident', 'إنشاء الحادث')}
            </button>
          </fieldset>
        </form>
      )}
      {state === 'ready' && data && (
        <div className="noc-workbench">
          <section className="noc-card noc-queue" aria-label={t('Incident queue', 'قائمة الحوادث')}>
            <div className="noc-card-heading">
              <h2>{t('Incident queue', 'قائمة الحوادث')}</h2>
              <span>{t('Latest first', 'الأحدث أولاً')}</span>
            </div>
            {data.incidents.length === 0 && (
              <div className="noc-empty">
                <h3>{t('No incidents in this view', 'لا حوادث في هذا العرض')}</h3>
                <p>
                  {t(
                    'This is your recorded incident list, not a claim that every network device is healthy.',
                    'هذه قائمة الحوادث المسجلة وليست تأكيداً على سلامة جميع أجهزة الشبكة.',
                  )}
                </p>
              </div>
            )}
            {data.incidents.map((i) => (
              <button
                key={i.id}
                type="button"
                disabled={busy}
                className={'noc-incident ' + (selected === i.id ? 'is-selected' : '')}
                aria-pressed={selected === i.id}
                onClick={() => {
                  setSelected(i.id);
                  setError('');
                }}
              >
                <span className="noc-row-meta">
                  <span className={'noc-severity severity-' + i.severity}>
                    {severity(i.severity)}
                  </span>
                  <span>{label(i.status)}</span>
                </span>
                <strong>{locale === 'ar' ? i.outageTitleAr : i.outageTitleEn}</strong>
                <span>
                  {i.impactedSubscribersCount} {t('customers affected', 'عميل متأثر')} ·{' '}
                  {date(i.startedAt)}
                </span>
              </button>
            ))}
            <nav className="noc-pagination" aria-label={t('Incident pages', 'صفحات الحوادث')}>
              <button
                type="button"
                disabled={busy || page <= 1}
                onClick={() => {
                  setPage((v) => v - 1);
                  setSelected('');
                }}
              >
                {t('Previous', 'السابق')}
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(data.totalCount / data.pageSize))}
              </span>
              <button
                type="button"
                disabled={busy || page * data.pageSize >= data.totalCount}
                onClick={() => {
                  setPage((v) => v + 1);
                  setSelected('');
                }}
              >
                {t('Next', 'التالي')}
              </button>
            </nav>
          </section>
          <section
            className="noc-card noc-detail"
            aria-label={t('Incident detail', 'تفاصيل الحادث')}
          >
            {!incident ? (
              <div className="noc-empty">
                <h2>{t('Select an incident', 'اختر حادثاً')}</h2>
                <p>
                  {t(
                    'Review its impact, recovery evidence and status history here.',
                    'راجع تأثيره ودليل التعافي وسجل حالته هنا.',
                  )}
                </p>
              </div>
            ) : (
              <>
                <span className="noc-eyebrow">
                  {t('INCIDENT RECORD', 'سجل الحادث')} · {t('Version', 'الإصدار')}{' '}
                  {incident.version}
                </span>
                <h2>{locale === 'ar' ? incident.outageTitleAr : incident.outageTitleEn}</h2>
                <dl className="noc-facts">
                  <div>
                    <dt>{t('Current status', 'الحالة الحالية')}</dt>
                    <dd>{label(incident.status)}</dd>
                  </div>
                  <div>
                    <dt>{t('Affected customers', 'العملاء المتأثرون')}</dt>
                    <dd>{incident.impactedSubscribersCount}</dd>
                  </div>
                  <div>
                    <dt>{t('Started', 'بداية الحادث')}</dt>
                    <dd>{date(incident.startedAt)}</dd>
                  </div>
                  {incident.resolvedAt && (
                    <div>
                      <dt>{t('Resolved', 'تم الحل')}</dt>
                      <dd>{date(incident.resolvedAt)}</dd>
                    </div>
                  )}
                </dl>
                <details>
                  <summary>
                    {t('Affected service references', 'مراجع الخدمات المتأثرة')} (
                    {incident.serviceIds.length})
                  </summary>
                  <ul>
                    {incident.serviceIds.map((id) => (
                      <li key={id}>
                        {data.services.find((s) => s.id === id)?.serviceNumber ?? id}
                      </li>
                    ))}
                  </ul>
                </details>
                <h3>{t('Recovery timeline', 'التسلسل الزمني للتعافي')}</h3>
                {incident.events.length === 0 ? (
                  <p>
                    {t(
                      'Legacy record: no governed history. Read-only until reviewed.',
                      'سجل قديم دون تاريخ محكوم. للقراءة فقط حتى مراجعته.',
                    )}
                  </p>
                ) : (
                  <ol className="noc-timeline">
                    {incident.events.map((e) => (
                      <li key={e.id}>
                        <strong>{label(e.status)}</strong>
                        <time dateTime={e.occurredAt}>{date(e.occurredAt)}</time>
                        <p>{locale === 'ar' ? e.reasonAr : e.reasonEn}</p>
                        {e.resolutionEvidence && (
                          <p className="noc-evidence">
                            {t('Verification', 'التحقق')}: {e.resolutionEvidence}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {incident.routeId && incident.events.length > 0 && (
                  <TransitionForm
                    key={incident.id + ':' + incident.version}
                    incident={incident}
                    locale={locale}
                    busy={busy}
                    onSubmit={transition}
                  />
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
    <div className="noc-fields">
      <label>
        {locale === 'ar' ? 'السبب بالإنجليزية' : 'Reason in English'}
        <textarea name="reasonEn" required minLength={8} maxLength={1000} lang="en" dir="ltr" />
      </label>
      <label>
        {locale === 'ar' ? 'السبب بالعربية' : 'Reason in Arabic'}
        <textarea name="reasonAr" required minLength={8} maxLength={1000} lang="ar" dir="rtl" />
      </label>
    </div>
  );
}
function TransitionForm({
  incident,
  locale,
  busy,
  onSubmit,
}: {
  readonly incident: NocIncident;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const choices =
    incident.status === 'investigating'
      ? ['identified']
      : incident.status === 'identified'
        ? ['monitoring']
        : incident.status === 'monitoring'
          ? ['resolved', 'investigating']
          : ['investigating'];
  const [next, setNext] = useState(choices[0]);
  return (
    <form className="noc-transition" onSubmit={onSubmit}>
      <fieldset disabled={busy}>
        <legend>{t('Record next step', 'تسجيل الخطوة التالية')}</legend>
        <label>
          {t('Next status', 'الحالة التالية')}
          <select name="status" value={next} onChange={(e) => setNext(e.target.value)}>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c === 'identified'
                  ? t('Cause identified', 'تم تحديد السبب')
                  : c === 'monitoring'
                    ? t('Monitor recovery', 'مراقبة التعافي')
                    : c === 'resolved'
                      ? t('Resolve with evidence', 'الحل مع دليل')
                      : t('Reopen investigation', 'إعادة فتح التحقيق')}
              </option>
            ))}
          </select>
        </label>
        <Reasons locale={locale} />
        {next === 'resolved' && (
          <div className="noc-fields">
            <label>
              {t('Root cause in English', 'السبب الجذري بالإنجليزية')}
              <textarea
                name="rootCauseEn"
                required
                minLength={8}
                maxLength={1000}
                lang="en"
                dir="ltr"
              />
            </label>
            <label>
              {t('Root cause in Arabic', 'السبب الجذري بالعربية')}
              <textarea
                name="rootCauseAr"
                required
                minLength={8}
                maxLength={1000}
                lang="ar"
                dir="rtl"
              />
            </label>
            <label className="noc-full">
              {t('Recovery verification evidence', 'دليل التحقق من التعافي')}
              <textarea name="resolutionEvidence" required minLength={8} maxLength={1000} />
            </label>
            <label className="noc-full noc-confirm">
              <input type="checkbox" required />
              {t(
                'I verified recovery for the recorded impact. This does not issue a router command.',
                'تحققت من تعافي الخدمات المتأثرة المسجلة. لا يصدر هذا الإجراء أمراً للموجّه.',
              )}
            </label>
          </div>
        )}
        <button type="submit" className="noc-primary">
          {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save status update', 'حفظ تحديث الحالة')}
        </button>
      </fieldset>
    </form>
  );
}
