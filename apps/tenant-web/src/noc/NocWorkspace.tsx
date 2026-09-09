import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  createOutageSchema,
  transitionOutageSchema,
  nocAlarmCommandSchema,
  type NocWorkspace as Workspace,
  type NocIncident,
  type NocAlarm,
  type NocMaintenanceWindow,
} from '@isp/contracts';
import { readNocWorkspace, submitTenantOperation } from '../api';
import './noc.css';

type View = 'incidents' | 'alarms' | 'maintenance';
type AlarmAction = 'acknowledge_alarm' | 'clear_alarm' | 'link_alarm_incident';

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
  const [view, setView] = useState<View>('incidents');
  const [status, setStatus] = useState<'open' | 'all' | 'resolved'>('open'),
    [alarmScope, setAlarmScope] = useState<'live' | 'all'>('live'),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [route, setRoute] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]),
    [search, setSearch] = useState('');
  const [raising, setRaising] = useState(false),
    [planning, setPlanning] = useState(false),
    [alarmForm, setAlarmForm] = useState<{ alarm: NocAlarm; action: AlarmAction }>();
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
    void readNocWorkspace(session, { page, pageSize: 25, status, alarms: alarmScope })
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
  }, [session, status, alarmScope, page, refresh]);
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
  const alarmStatus = (value: NocAlarm['status']) =>
    ({
      active: t('Active', 'نشط'),
      acknowledged: t('Acknowledged', 'تم الإقرار'),
      cleared: t('Cleared', 'تمت الإزالة'),
    })[value];
  const windowStatus = (value: NocMaintenanceWindow['status']) =>
    ({
      planned: t('Planned', 'مخطط'),
      in_progress: t('In progress', 'جارٍ'),
      completed: t('Completed', 'مكتمل'),
      cancelled: t('Cancelled', 'ملغى'),
    })[value];
  const impact = (value: NocMaintenanceWindow['expectedImpact']) =>
    ({
      none: t('No customer impact', 'دون تأثير على العملاء'),
      degraded: t('Degraded service', 'خدمة متدهورة'),
      outage: t('Service outage', 'انقطاع الخدمة'),
    })[value];
  const routeName = (id: string | null) => {
    const found = data?.routes.find((r) => r.id === id);
    return found ? (locale === 'ar' ? found.nameAr : found.nameEn) : null;
  };
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const value = (form: FormData, key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const optional = (form: FormData, key: string) => {
    const v = value(form, key);
    return v ? { [key]: v } : {};
  };
  async function send(path: string, command: unknown, done: string) {
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
      setRaising(false);
      setPlanning(false);
      setAlarmForm(undefined);
      setServiceIds([]);
      setRoute('');
      setSearch('');
      if (path.startsWith('noc/incidents')) {
        setSelected(typeof result.id === 'string' ? result.id : '');
      }
      setNotice(done);
      setRefresh((v) => v + 1);
    } catch {
      if (mounted.current)
        setError(
          t(
            'The change was not confirmed. Check access or refresh a changed record. Retry unchanged values to recover a lost response safely.',
            'لم يتأكد التغيير. تحقق من الصلاحيات أو حدّث السجل إذا تغير. أعد إرسال القيم نفسها لاستعادة رد مفقود بأمان.',
          ),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const incidentSaved = t(
    'Incident saved. History and audit evidence were recorded.',
    'تم حفظ الحادث وتسجيل السجل ودليل التدقيق.',
  );
  const alarmSaved = t(
    'Alarm updated. The NOC ledger and audit evidence were recorded.',
    'تم تحديث الإنذار وتسجيل سجل المراقبة ودليل التدقيق.',
  );
  const windowSaved = t(
    'Maintenance window saved. Alarms raised inside it are marked as expected.',
    'تم حفظ نافذة الصيانة. الإنذارات الصادرة داخلها تُعلَّم كمتوقعة.',
  );
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
    void send('noc/incidents', result.data, incidentSaved);
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
    void send('noc/incidents/transition', result.data, incidentSaved);
  }
  function submitAlarmCommand(command: unknown, done: string) {
    const result = nocAlarmCommandSchema.safeParse(command);
    if (!result.success) {
      setError(
        t(
          'Complete the required fields in both languages. Alarm codes are upper-case, such as LINK_DOWN.',
          'أكمل الحقول المطلوبة باللغتين. رموز الإنذار بأحرف كبيرة مثل LINK_DOWN.',
        ),
      );
      return;
    }
    void send('noc/alarms', result.data, done);
  }
  function raise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submitAlarmCommand(
      {
        action: 'raise_alarm',
        deviceName: value(form, 'deviceName'),
        severity: value(form, 'severity'),
        alarmCode: value(form, 'alarmCode').toUpperCase(),
        messageEn: value(form, 'messageEn'),
        messageAr: value(form, 'messageAr'),
        ...optional(form, 'routeId'),
        ...optional(form, 'routerId'),
        reasonEn: value(form, 'reasonEn'),
        reasonAr: value(form, 'reasonAr'),
      },
      alarmSaved,
    );
  }
  function actOnAlarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!alarmForm) return;
    const form = new FormData(event.currentTarget);
    submitAlarmCommand(
      {
        action: alarmForm.action,
        alarmId: alarmForm.alarm.id,
        expectedVersion: alarmForm.alarm.version,
        ...(alarmForm.action === 'acknowledge_alarm' ? optional(form, 'note') : {}),
        ...(alarmForm.action === 'link_alarm_incident'
          ? { outageId: value(form, 'outageId') }
          : {}),
        reasonEn: value(form, 'reasonEn'),
        reasonAr: value(form, 'reasonAr'),
      },
      alarmSaved,
    );
  }
  function plan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const iso = (key: string) => {
      const raw = value(form, key);
      return raw ? new Date(raw).toISOString() : '';
    };
    submitAlarmCommand(
      {
        action: 'create_maintenance',
        titleEn: value(form, 'titleEn'),
        titleAr: value(form, 'titleAr'),
        ...optional(form, 'routeId'),
        ...optional(form, 'routerId'),
        startsAt: iso('startsAt'),
        endsAt: iso('endsAt'),
        expectedImpact: value(form, 'expectedImpact'),
        ...optional(form, 'notesEn'),
        ...optional(form, 'notesAr'),
        reasonEn: value(form, 'reasonEn'),
        reasonAr: value(form, 'reasonAr'),
      },
      windowSaved,
    );
  }
  function moveWindow(
    window: NocMaintenanceWindow,
    next: 'in_progress' | 'completed' | 'cancelled',
    form: FormData,
  ) {
    submitAlarmCommand(
      {
        action: 'update_maintenance',
        maintenanceId: window.id,
        expectedVersion: window.version,
        status: next,
        reasonEn: value(form, 'reasonEn'),
        reasonAr: value(form, 'reasonAr'),
      },
      windowSaved,
    );
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
  const summary = data?.alarmSummary;
  const openIncidents = data?.incidents.filter((i) => i.status !== 'resolved') ?? [];
  return (
    <section className="noc-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="noc-header">
        <div>
          <span className="noc-eyebrow">{t('NETWORK OPERATIONS', 'عمليات الشبكة')}</span>
          <h1>{t('From interruption to resolution.', 'من الانقطاع إلى استعادة الخدمة.')}</h1>
          <p>
            {t(
              'Alarms from real router executions, planned maintenance and incidents with a traceable recovery history.',
              'إنذارات من تنفيذ فعلي على الراوترات، صيانة مخططة، وحوادث بسجل تعافٍ موثق.',
            )}
          </p>
        </div>
        {summary && (
          <dl className="noc-stats" aria-label={t('Assurance summary', 'ملخص الضمان')}>
            <div className={summary.critical > 0 ? 'is-alert' : ''}>
              <dt>{t('Active alarms', 'إنذارات نشطة')}</dt>
              <dd>{summary.active}</dd>
            </div>
            <div className={summary.critical > 0 ? 'is-alert' : ''}>
              <dt>{t('Critical', 'حرجة')}</dt>
              <dd>{summary.critical}</dd>
            </div>
            <div>
              <dt>{t('Acknowledged', 'تم الإقرار بها')}</dt>
              <dd>{summary.acknowledged}</dd>
            </div>
            <div>
              <dt>{t('In maintenance', 'ضمن صيانة')}</dt>
              <dd>{summary.suppressed}</dd>
            </div>
            <div className={summary.slaBreaches > 0 ? 'is-alert' : ''}>
              <dt>{t('SLA breached', 'تجاوز SLA')}</dt>
              <dd>{summary.slaBreaches}</dd>
            </div>
          </dl>
        )}
      </header>
      <div className="noc-boundary">
        <span aria-hidden="true">●</span>
        <p>
          {t(
            'Worker-observed alarms · Operator-recorded incidents · Scoped service impact · No automatic router changes or provider notifications',
            'إنذارات يرصدها عامل الشبكة · حوادث مسجلة بواسطة المشغل · تأثير الخدمات ضمن الصلاحيات · دون تغييرات آلية للموجّه أو إشعارات للمزود',
          )}
        </p>
      </div>
      <nav className="noc-views" aria-label={t('Assurance views', 'عروض الضمان')}>
        {(
          [
            ['incidents', t('Incidents', 'الحوادث'), data?.totalCount],
            [
              'alarms',
              t('Alarms', 'الإنذارات'),
              summary ? summary.active + summary.acknowledged : 0,
            ],
            [
              'maintenance',
              t('Maintenance', 'الصيانة'),
              data?.maintenanceWindows.filter(
                (w) => w.status === 'planned' || w.status === 'in_progress',
              ).length,
            ],
          ] as const
        ).map(([key, name, count]) => (
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
            {typeof count === 'number' && <small> {count}</small>}
          </button>
        ))}
      </nav>
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
      {state === 'loading' && (
        <p role="status">
          {t('Loading scoped assurance workspace…', 'جارٍ تحميل مساحة الضمان ضمن نطاق الصلاحية…')}
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
          <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            {t('Refresh', 'تحديث')}
          </button>
        </div>
      )}

      {view === 'incidents' && (
        <>
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
            {data && state === 'ready' && (
              <span>
                {data.totalCount} {t('incidents in this view', 'حادث في هذا العرض')}
              </span>
            )}
          </div>
          {creating && data && (
            <form className="noc-card noc-create" onSubmit={create}>
              <fieldset disabled={busy || state !== 'ready'}>
                <legend>
                  {t('New incident • define the impact', 'حادث جديد • تحديد التأثير')}
                </legend>
                <div className="noc-fields">
                  <label>
                    {t('Title in English', 'العنوان بالإنجليزية')}
                    <input
                      name="titleEn"
                      required
                      minLength={3}
                      maxLength={200}
                      lang="en"
                      dir="ltr"
                    />
                  </label>
                  <label>
                    {t('Title in Arabic', 'العنوان بالعربية')}
                    <input
                      name="titleAr"
                      required
                      minLength={3}
                      maxLength={200}
                      lang="ar"
                      dir="rtl"
                    />
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
                      <option value="">
                        {t('Choose a scoped route', 'اختر مساراً ضمن الصلاحية')}
                      </option>
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
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      type="search"
                    />
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
              <section
                className="noc-card noc-queue"
                aria-label={t('Incident queue', 'قائمة الحوادث')}
              >
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
                      <span>
                        {label(i.status)}
                        {i.slaBreached && i.status !== 'resolved' && (
                          <span className="noc-sla is-breached">
                            {t('SLA breached', 'تجاوز SLA')}
                          </span>
                        )}
                      </span>
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
                      <div>
                        <dt>{t('Resolution target', 'هدف الحل')}</dt>
                        <dd>
                          {date(incident.slaDueAt)}
                          {incident.slaBreached && (
                            <span className="noc-sla is-breached">
                              {incident.status === 'resolved'
                                ? t('Resolved late', 'حُل متأخراً')
                                : t('Breached', 'متجاوز')}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Linked alarms', 'إنذارات مرتبطة')}</dt>
                        <dd>{incident.linkedAlarms}</dd>
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
        </>
      )}

      {view === 'alarms' && state === 'ready' && data && (
        <>
          <div className="noc-toolbar">
            <label>
              {t('Show alarms', 'عرض الإنذارات')}
              <select
                disabled={busy}
                value={alarmScope}
                onChange={(e) => setAlarmScope(e.target.value as typeof alarmScope)}
              >
                <option value="live">
                  {t('Live (active and acknowledged)', 'الحية (نشطة ومُقرّ بها)')}
                </option>
                <option value="all">{t('Including cleared', 'بما فيها المزالة')}</option>
              </select>
            </label>
            <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
              {t('Refresh', 'تحديث')}
            </button>
            <button
              type="button"
              className="noc-primary"
              disabled={busy}
              onClick={() => {
                setRaising((v) => !v);
                setAlarmForm(undefined);
                setError('');
                setNotice('');
              }}
            >
              {raising
                ? t('Close alarm form', 'إغلاق نموذج الإنذار')
                : t('Raise alarm', 'رفع إنذار')}
            </button>
            <span>
              {data.alarms.length} {t('alarms in this view', 'إنذار في هذا العرض')}
            </span>
          </div>
          {raising && (
            <form className="noc-card noc-create" onSubmit={raise}>
              <fieldset disabled={busy}>
                <legend>
                  {t(
                    'Operator alarm • observed outside the worker',
                    'إنذار مشغل • رُصد خارج عامل الشبكة',
                  )}
                </legend>
                <div className="noc-fields">
                  <label>
                    {t('Device name', 'اسم الجهاز')}
                    <input name="deviceName" required minLength={2} maxLength={100} dir="ltr" />
                  </label>
                  <label>
                    {t('Alarm code', 'رمز الإنذار')}
                    <input
                      name="alarmCode"
                      required
                      pattern="[A-Za-z0-9_]{3,40}"
                      placeholder="LINK_DOWN"
                      dir="ltr"
                    />
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
                  <label>
                    {t('Route (optional)', 'المسار (اختياري)')}
                    <select name="routeId" defaultValue="">
                      <option value="">{t('Tenant-wide', 'على مستوى الشركة')}</option>
                      {data.routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {locale === 'ar' ? r.nameAr : r.nameEn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Router (optional)', 'الراوتر (اختياري)')}
                    <select name="routerId" defaultValue="">
                      <option value="">{t('Not a registered router', 'ليس راوتراً مسجلاً')}</option>
                      {data.routerIds.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Message in English', 'الرسالة بالإنجليزية')}
                    <input
                      name="messageEn"
                      required
                      minLength={3}
                      maxLength={500}
                      lang="en"
                      dir="ltr"
                    />
                  </label>
                  <label>
                    {t('Message in Arabic', 'الرسالة بالعربية')}
                    <input
                      name="messageAr"
                      required
                      minLength={3}
                      maxLength={500}
                      lang="ar"
                      dir="rtl"
                    />
                  </label>
                </div>
                <Reasons locale={locale} />
                <button className="noc-primary" type="submit">
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Raise alarm', 'رفع الإنذار')}
                </button>
              </fieldset>
            </form>
          )}
          <section className="noc-card" aria-label={t('Alarm list', 'قائمة الإنذارات')}>
            <div className="noc-card-heading">
              <h2>{t('Alarms', 'الإنذارات')}</h2>
              <span>{t('Most urgent first', 'الأكثر إلحاحاً أولاً')}</span>
            </div>
            {data.alarms.length === 0 && (
              <div className="noc-empty">
                <h3>{t('No alarms in this view', 'لا إنذارات في هذا العرض')}</h3>
                <p>
                  {t(
                    'Worker alarms appear when a router execution fails; operator alarms are raised here. An empty list is not a health guarantee.',
                    'تظهر إنذارات العامل عند فشل تنفيذ على الراوتر؛ وتُرفع إنذارات المشغل هنا. القائمة الفارغة ليست ضماناً للسلامة.',
                  )}
                </p>
              </div>
            )}
            <ul className="noc-alarms">
              {data.alarms.map((a) => (
                <li key={a.id} className={'noc-alarm status-' + a.status}>
                  <div className="noc-row-meta">
                    <span className={'noc-severity severity-' + a.severity}>
                      {severity(a.severity)}
                    </span>
                    <span>
                      {alarmStatus(a.status)} ·{' '}
                      {a.source === 'worker'
                        ? t('Network worker', 'عامل الشبكة')
                        : t('Operator', 'مشغل')}
                      {a.maintenanceId && (
                        <span className="noc-sla">{t('In maintenance', 'ضمن صيانة')}</span>
                      )}
                    </span>
                  </div>
                  <strong>
                    {a.deviceName} · <code>{a.alarmCode}</code>
                  </strong>
                  <p>{locale === 'ar' ? a.messageAr : a.messageEn}</p>
                  <small>
                    {t('Seen', 'رُصد')} {a.occurrenceCount}× · {t('last', 'آخر مرة')}{' '}
                    {date(a.lastSeenAt)}
                    {a.serviceNumber ? ` · ${a.serviceNumber}` : ''}
                    {routeName(a.routeId) ? ` · ${routeName(a.routeId)}` : ''}
                    {a.acknowledgedBy
                      ? ` · ${t('acknowledged by', 'أقرّ به')} ${a.acknowledgedBy}`
                      : ''}
                    {a.outageId ? ` · ${t('linked to an incident', 'مرتبط بحادث')}` : ''}
                  </small>
                  {a.status !== 'cleared' && (
                    <div className="noc-actions">
                      {a.status === 'active' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setAlarmForm({ alarm: a, action: 'acknowledge_alarm' })}
                        >
                          {t('Acknowledge', 'إقرار')}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy || openIncidents.length === 0}
                        onClick={() => setAlarmForm({ alarm: a, action: 'link_alarm_incident' })}
                      >
                        {t('Link to incident', 'ربط بحادث')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setAlarmForm({ alarm: a, action: 'clear_alarm' })}
                      >
                        {t('Clear', 'إزالة')}
                      </button>
                    </div>
                  )}
                  {alarmForm?.alarm.id === a.id && (
                    <form className="noc-transition" onSubmit={actOnAlarm}>
                      <fieldset disabled={busy}>
                        <legend>
                          {alarmForm.action === 'acknowledge_alarm'
                            ? t('Acknowledge alarm', 'الإقرار بالإنذار')
                            : alarmForm.action === 'clear_alarm'
                              ? t('Clear alarm', 'إزالة الإنذار')
                              : t('Link alarm to an open incident', 'ربط الإنذار بحادث مفتوح')}
                        </legend>
                        {alarmForm.action === 'acknowledge_alarm' && (
                          <label className="noc-full">
                            {t('Note (optional)', 'ملاحظة (اختياري)')}
                            <input name="note" maxLength={1000} />
                          </label>
                        )}
                        {alarmForm.action === 'link_alarm_incident' && (
                          <label className="noc-full">
                            {t('Incident', 'الحادث')}
                            <select name="outageId" required defaultValue="">
                              <option value="">
                                {t('Choose an open incident', 'اختر حادثاً مفتوحاً')}
                              </option>
                              {openIncidents.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {locale === 'ar' ? i.outageTitleAr : i.outageTitleEn}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <Reasons locale={locale} />
                        <div className="noc-actions">
                          <button type="submit" className="noc-primary">
                            {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm', 'تأكيد')}
                          </button>
                          <button type="button" onClick={() => setAlarmForm(undefined)}>
                            {t('Cancel', 'إلغاء')}
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {view === 'maintenance' && state === 'ready' && data && (
        <>
          <div className="noc-toolbar">
            <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
              {t('Refresh', 'تحديث')}
            </button>
            <button
              type="button"
              className="noc-primary"
              disabled={busy}
              onClick={() => {
                setPlanning((v) => !v);
                setError('');
                setNotice('');
              }}
            >
              {planning
                ? t('Close planning form', 'إغلاق نموذج التخطيط')
                : t('Plan maintenance', 'تخطيط صيانة')}
            </button>
            <span>
              {data.maintenanceWindows.length} {t('windows in this view', 'نافذة في هذا العرض')}
            </span>
          </div>
          {planning && (
            <form className="noc-card noc-create" onSubmit={plan}>
              <fieldset disabled={busy}>
                <legend>
                  {t(
                    'Planned maintenance • alarms inside are expected',
                    'صيانة مخططة • الإنذارات داخلها متوقعة',
                  )}
                </legend>
                <div className="noc-fields">
                  <label>
                    {t('Title in English', 'العنوان بالإنجليزية')}
                    <input
                      name="titleEn"
                      required
                      minLength={3}
                      maxLength={200}
                      lang="en"
                      dir="ltr"
                    />
                  </label>
                  <label>
                    {t('Title in Arabic', 'العنوان بالعربية')}
                    <input
                      name="titleAr"
                      required
                      minLength={3}
                      maxLength={200}
                      lang="ar"
                      dir="rtl"
                    />
                  </label>
                  <label>
                    {t('Starts', 'البداية')}
                    <input name="startsAt" type="datetime-local" required />
                  </label>
                  <label>
                    {t('Ends', 'النهاية')}
                    <input name="endsAt" type="datetime-local" required />
                  </label>
                  <label>
                    {t('Router (optional)', 'الراوتر (اختياري)')}
                    <select name="routerId" defaultValue="">
                      <option value="">{t('All routers', 'كل الراوترات')}</option>
                      {data.routerIds.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Route (optional)', 'المسار (اختياري)')}
                    <select name="routeId" defaultValue="">
                      <option value="">{t('Tenant-wide', 'على مستوى الشركة')}</option>
                      {data.routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {locale === 'ar' ? r.nameAr : r.nameEn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Expected impact', 'التأثير المتوقع')}
                    <select name="expectedImpact" defaultValue="degraded">
                      {(['none', 'degraded', 'outage'] as const).map((v) => (
                        <option key={v} value={v}>
                          {impact(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Notes in English (optional)', 'ملاحظات بالإنجليزية (اختياري)')}
                    <input name="notesEn" maxLength={2000} lang="en" dir="ltr" />
                  </label>
                  <label>
                    {t('Notes in Arabic (optional)', 'ملاحظات بالعربية (اختياري)')}
                    <input name="notesAr" maxLength={2000} lang="ar" dir="rtl" />
                  </label>
                </div>
                <Reasons locale={locale} />
                <button className="noc-primary" type="submit">
                  {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save window', 'حفظ النافذة')}
                </button>
              </fieldset>
            </form>
          )}
          <section className="noc-card" aria-label={t('Maintenance windows', 'نوافذ الصيانة')}>
            <div className="noc-card-heading">
              <h2>{t('Maintenance windows', 'نوافذ الصيانة')}</h2>
              <span>{t('Running and planned first', 'الجارية والمخططة أولاً')}</span>
            </div>
            {data.maintenanceWindows.length === 0 && (
              <div className="noc-empty">
                <h3>{t('No maintenance windows', 'لا نوافذ صيانة')}</h3>
                <p>
                  {t(
                    'Plan a window before scheduled work so alarms raised during it are marked as expected.',
                    'خطط نافذة قبل الأعمال المجدولة لتُعلَّم الإنذارات الصادرة خلالها كمتوقعة.',
                  )}
                </p>
              </div>
            )}
            <ul className="noc-alarms">
              {data.maintenanceWindows.map((w) => (
                <MaintenanceRow
                  key={w.id + ':' + w.version}
                  window={w}
                  locale={locale}
                  busy={busy}
                  statusLabel={windowStatus(w.status)}
                  impactLabel={impact(w.expectedImpact)}
                  routeLabel={routeName(w.routeId)}
                  date={date}
                  onMove={(next, form) => moveWindow(w, next, form)}
                />
              ))}
            </ul>
          </section>
        </>
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
function MaintenanceRow({
  window,
  locale,
  busy,
  statusLabel,
  impactLabel,
  routeLabel,
  date,
  onMove,
}: {
  readonly window: NocMaintenanceWindow;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly statusLabel: string;
  readonly impactLabel: string;
  readonly routeLabel: string | null;
  readonly date: (value: string) => string;
  readonly onMove: (next: 'in_progress' | 'completed' | 'cancelled', form: FormData) => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [next, setNext] = useState<'in_progress' | 'completed' | 'cancelled'>();
  const choices: readonly ('in_progress' | 'completed' | 'cancelled')[] =
    window.status === 'planned'
      ? ['in_progress', 'cancelled']
      : window.status === 'in_progress'
        ? ['completed', 'cancelled']
        : [];
  const name = (v: 'in_progress' | 'completed' | 'cancelled') =>
    v === 'in_progress'
      ? t('Start work', 'بدء العمل')
      : v === 'completed'
        ? t('Complete', 'إكمال')
        : t('Cancel window', 'إلغاء النافذة');
  return (
    <li className={'noc-alarm status-' + window.status}>
      <div className="noc-row-meta">
        <span className="noc-severity">{statusLabel}</span>
        <span>{impactLabel}</span>
      </div>
      <strong>{locale === 'ar' ? window.titleAr : window.titleEn}</strong>
      <p>
        {date(window.startsAt)} → {date(window.endsAt)}
        {window.routerId ? ` · ${window.routerId}` : ''}
        {routeLabel ? ` · ${routeLabel}` : ''}
      </p>
      <small>
        {t('Planned by', 'خطط بواسطة')} {window.createdBy} · {window.suppressedAlarms}{' '}
        {t('alarms marked as expected', 'إنذار مُعلَّم كمتوقع')}
        {window.notesEn || window.notesAr
          ? ` · ${locale === 'ar' ? window.notesAr || window.notesEn : window.notesEn || window.notesAr}`
          : ''}
      </small>
      {choices.length > 0 && (
        <div className="noc-actions">
          {choices.map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => setNext(c)}>
              {name(c)}
            </button>
          ))}
        </div>
      )}
      {next && (
        <form
          className="noc-transition"
          onSubmit={(event) => {
            event.preventDefault();
            onMove(next, new FormData(event.currentTarget));
          }}
        >
          <fieldset disabled={busy}>
            <legend>{name(next)}</legend>
            <Reasons locale={locale} />
            <div className="noc-actions">
              <button type="submit" className="noc-primary">
                {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm', 'تأكيد')}
              </button>
              <button type="button" onClick={() => setNext(undefined)}>
                {t('Cancel', 'إلغاء')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </li>
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
