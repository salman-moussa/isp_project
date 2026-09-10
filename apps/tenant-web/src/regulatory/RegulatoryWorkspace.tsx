import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import type {
  KpiEvidence,
  KpiEvidenceItem,
  RegulatoryWorkspace as Workspace,
  SubmissionRecord,
} from '@isp/contracts';
import { readRegulatoryWorkspace, submitTenantOperation } from '../api';
import './regulatory.css';

type View = 'kpis' | 'obligations' | 'licences' | 'submissions';

export function RegulatoryWorkspace({
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
  const [view, setView] = useState<View>('kpis');
  const [refresh, setRefresh] = useState(0);
  const [window, setWindow] = useState<{ from: string; to: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<'licence' | 'obligation' | 'kpi' | 'submission' | null>(
    null,
  );
  const [opened, setOpened] = useState<SubmissionRecord>();
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
    void readRegulatoryWorkspace(session, window ?? {})
      .then((result) => {
        if (active) {
          setData(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [session, refresh, window]);
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString(en ? 'en-GB' : 'ar-LB', { dateStyle: 'medium' })
      : '—';
  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(en ? 'en-GB' : 'ar-LB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const field = (form: FormData, key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const optional = (form: FormData, key: string) => {
    const value = field(form, key);
    return value ? { [key]: value } : {};
  };
  const idempotency = (fingerprint: string) => {
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-regulatory-${crypto.randomUUID()}` };
    return retry.current.key;
  };
  async function command(
    body: Record<string, unknown>,
    done: (result: Record<string, unknown>) => void,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(
        session,
        'regulatory/commands',
        { command: body },
        idempotency(JSON.stringify(body)),
      );
      retry.current = undefined;
      if (mounted.current) {
        done(result);
        setRefresh((v) => v + 1);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const unitLabel = (item: KpiEvidenceItem, value: number | null) => {
    if (value === null) return t('no data', 'لا بيانات');
    const n = new Intl.NumberFormat(en ? 'en-US' : 'ar-LB', { maximumFractionDigits: 2 }).format(
      value,
    );
    return (
      { percent: `${n}%`, minutes: `${n} ${t('min', 'د')}`, per_100: `${n} / 100`, count: n }[
        item.unit
      ] ?? n
    );
  };
  const statusLabel = (value: string) =>
    ({
      draft: t('Draft', 'مسودة'),
      submitted: t('Submitted', 'مرسل'),
      accepted: t('Accepted', 'مقبول'),
      rejected: t('Rejected', 'مرفوض'),
      active: t('Active', 'سارية'),
      renewal_pending: t('Renewal pending', 'بانتظار التجديد'),
      expired: t('Expired', 'منتهية'),
      surrendered: t('Surrendered', 'متنازل عنها'),
    })[value] ?? value;
  const frequencyLabel = (value: string) =>
    ({
      monthly: t('Monthly', 'شهري'),
      quarterly: t('Quarterly', 'ربع سنوي'),
      semiannual: t('Semi-annual', 'نصف سنوي'),
      annual: t('Annual', 'سنوي'),
      once: t('Once', 'مرة واحدة'),
    })[value] ?? value;
  const kpiRows = (evidence: KpiEvidence) =>
    Object.values(evidence.kpis).sort((a, b) => a.code.localeCompare(b.code));
  const overdue = data?.obligations.filter((o) => o.overdue).length ?? 0;
  const renewals =
    data?.licences.filter(
      (l) => l.renewalDue && l.status !== 'expired' && l.status !== 'surrendered',
    ).length ?? 0;
  const missed = data ? kpiRows(data.current).filter((k) => k.met === false).length : 0;

  function submitLicence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'upsert_licence',
        kind: field(form, 'kind'),
        reference: field(form, 'reference'),
        authority: field(form, 'authority'),
        titleEn: field(form, 'titleEn'),
        titleAr: field(form, 'titleAr'),
        ...optional(form, 'issuedOn'),
        ...optional(form, 'expiresOn'),
        renewalNoticeDays: Number(field(form, 'renewalNoticeDays') || 90),
        ...optional(form, 'notes'),
      },
      () => {
        setEditing(null);
        setNotice(t('Licence recorded.', 'سُجلت الرخصة.'));
      },
    );
  }
  function submitObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const owner = field(form, 'ownerUserId');
    void command(
      {
        action: 'upsert_obligation',
        code: field(form, 'code'),
        titleEn: field(form, 'titleEn'),
        titleAr: field(form, 'titleAr'),
        authority: field(form, 'authority'),
        frequency: field(form, 'frequency'),
        nextDueOn: field(form, 'nextDueOn'),
        ...(owner ? { ownerUserId: owner } : {}),
        evidenceRequired: form.get('evidenceRequired') === 'on',
        ...optional(form, 'description'),
      },
      () => {
        setEditing(null);
        setNotice(t('Obligation recorded.', 'سُجل الالتزام.'));
      },
    );
  }
  function submitKpi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'upsert_kpi',
        code: field(form, 'code'),
        nameEn: field(form, 'nameEn'),
        nameAr: field(form, 'nameAr'),
        computation: field(form, 'computation'),
        unit: field(form, 'unit'),
        target: Number(field(form, 'target')),
        comparator: field(form, 'comparator'),
      },
      () => {
        setEditing(null);
        setNotice(t('KPI defined.', 'عُرّف المؤشر.'));
      },
    );
  }
  function submitPrepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const obligationId = field(form, 'obligationId');
    void command(
      {
        action: 'prepare_submission',
        ...(obligationId ? { obligationId } : {}),
        periodStart: field(form, 'periodStart'),
        periodEnd: field(form, 'periodEnd'),
        ...optional(form, 'notes'),
      },
      (result) => {
        setEditing(null);
        setView('submissions');
        setNotice(
          `${t('Submission', 'التقديم')} ${String(result.submissionNumber)} ${t('prepared with its evidence snapshot.', 'أُعد مع لقطة الأدلة.')}`,
        );
      },
    );
  }
  function submitReference(event: FormEvent<HTMLFormElement>, submission: SubmissionRecord) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'submit',
        submissionId: submission.id,
        expectedVersion: submission.version,
        reference: field(form, 'reference'),
      },
      () => {
        setOpened(undefined);
        setNotice(t('Submitted to the regulator.', 'أُرسل إلى الجهة المنظمة.'));
      },
    );
  }
  function decide(submission: SubmissionRecord, status: 'accepted' | 'rejected') {
    const note =
      globalThis.prompt?.(t('Decision note (optional)', 'ملاحظة القرار (اختياري)')) ?? '';
    void command(
      {
        action: 'record_decision',
        submissionId: submission.id,
        expectedVersion: submission.version,
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      () => {
        setOpened(undefined);
        setNotice(t('Decision recorded.', 'سُجل القرار.'));
      },
    );
  }
  function exportEvidence(submission: SubmissionRecord) {
    const rows = kpiRows(submission.evidence);
    const cell = (v: unknown) => {
      const text =
        v === null || v === undefined
          ? ''
          : typeof v === 'string'
            ? v
            : typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : JSON.stringify(v);
      return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
    };
    const csv = [
      'code,name,computation,unit,target,comparator,value,met,numerator,denominator,source',
    ]
      .concat(
        rows.map((r) =>
          [
            r.code,
            r.nameEn,
            r.computation,
            r.unit,
            r.target,
            r.comparator,
            r.value,
            r.met,
            r.numerator,
            r.denominator,
            r.source,
          ]
            .map(cell)
            .join(','),
        ),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv + '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${submission.submissionNumber}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="reg-shell" dir={en ? 'ltr' : 'rtl'} aria-busy={busy}>
      <header className="reg-hero">
        <div>
          <span>{t('Regulatory & QoS', 'التنظيم وجودة الخدمة')}</span>
          <h1>
            {t('Obligations, licences and quality evidence', 'الالتزامات والرخص وأدلة الجودة')}
          </h1>
          <p>
            {t(
              'Every KPI is computed from your own outages, alarms, tickets and services, and every submission keeps the snapshot it was built from, so each number can be traced to the records behind it.',
              'يُحسب كل مؤشر من انقطاعاتك وإنذاراتك وتذاكرك وخدماتك، ويحتفظ كل تقديم باللقطة التي بُني منها، فيمكن تتبع كل رقم إلى السجلات وراءه.',
            )}
          </p>
        </div>
        <dl className="reg-stats">
          <div className={missed ? 'is-alert' : ''}>
            <dt>{t('KPIs below target', 'مؤشرات دون الهدف')}</dt>
            <dd>{missed}</dd>
          </div>
          <div className={overdue ? 'is-alert' : ''}>
            <dt>{t('Overdue obligations', 'التزامات متأخرة')}</dt>
            <dd>{overdue}</dd>
          </div>
          <div className={renewals ? 'is-alert' : ''}>
            <dt>{t('Renewals due', 'تجديدات مستحقة')}</dt>
            <dd>{renewals}</dd>
          </div>
          <div>
            <dt>{t('Submissions', 'التقديمات')}</dt>
            <dd>{data?.submissions.length ?? 0}</dd>
          </div>
        </dl>
      </header>
      {state === 'error' && (
        <div className="reg-banner is-error" role="alert">
          {t('The regulatory workspace could not be read.', 'تعذّرت قراءة مساحة التنظيم.')}
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}
      {error && (
        <div className="reg-banner is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="reg-banner" role="status">
          {notice}
        </div>
      )}
      <nav className="reg-views" aria-label={t('Regulatory views', 'عروض التنظيم')}>
        {(
          [
            ['kpis', t('QoS KPIs', 'مؤشرات الجودة')],
            ['obligations', t('Obligations', 'الالتزامات')],
            ['licences', t('Licences', 'الرخص')],
            ['submissions', t('Submissions', 'التقديمات')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'kpis' && data && (
        <section className="reg-panel" aria-label={t('QoS KPIs', 'مؤشرات الجودة')}>
          <div className="reg-section-head">
            <div>
              <h2>{t('Current period evidence', 'أدلة الفترة الحالية')}</h2>
              <p className="reg-note">
                {t('Window', 'النافذة')}: {date(data.current.periodStart)} →{' '}
                {date(data.current.periodEnd)} · {data.current.activeServices}{' '}
                {t('active services', 'خدمة نشطة')} · {data.current.outagesStarted}{' '}
                {t('outages', 'انقطاع')} · {data.current.tickets} {t('tickets', 'تذكرة')}
              </p>
            </div>
            <form
              className="reg-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                setWindow({ from: field(form, 'from'), to: field(form, 'to') });
              }}
            >
              <label>
                {t('From', 'من')}
                <input name="from" type="date" defaultValue={data.current.periodStart} required />
              </label>
              <label>
                {t('To', 'إلى')}
                <input name="to" type="date" defaultValue={data.current.periodEnd} required />
              </label>
              <button type="submit">{t('Recompute', 'إعادة الحساب')}</button>
              {data.kpis.length === 0 && (
                <button
                  type="button"
                  className="reg-primary"
                  onClick={() =>
                    void command({ action: 'seed_standard_kpis' }, () =>
                      setNotice(t('Standard KPI set added.', 'أُضيفت مجموعة المؤشرات القياسية.')),
                    )
                  }
                >
                  {t('Add standard KPI set', 'إضافة المجموعة القياسية')}
                </button>
              )}
              <button type="button" onClick={() => setEditing(editing === 'kpi' ? null : 'kpi')}>
                {t('Define KPI', 'تعريف مؤشر')}
              </button>
            </form>
          </div>
          {editing === 'kpi' && (
            <form className="reg-form" onSubmit={submitKpi}>
              <label>
                {t('Code', 'الرمز')}
                <input name="code" required pattern="[A-Za-z0-9_]{2,40}" />
              </label>
              <label>
                {t('Name (EN)', 'الاسم (إنجليزي)')}
                <input name="nameEn" required />
              </label>
              <label>
                {t('Name (AR)', 'الاسم (عربي)')}
                <input name="nameAr" required />
              </label>
              <label>
                {t('Computation', 'طريقة الحساب')}
                <select name="computation" defaultValue="manual">
                  {[
                    'availability_pct',
                    'mttr_minutes',
                    'fault_rate_per_100',
                    'critical_alarms',
                    'complaints_per_100',
                    'first_response_minutes',
                    'resolution_minutes',
                    'sla_response_pct',
                    'sla_resolution_pct',
                    'manual',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Unit', 'الوحدة')}
                <select name="unit" defaultValue="percent">
                  <option value="percent">%</option>
                  <option value="minutes">{t('minutes', 'دقائق')}</option>
                  <option value="per_100">/100</option>
                  <option value="count">{t('count', 'عدد')}</option>
                </select>
              </label>
              <label>
                {t('Target', 'الهدف')}
                <input name="target" type="number" step="0.001" required />
              </label>
              <label>
                {t('Met when', 'يتحقق عندما')}
                <select name="comparator" defaultValue=">=">
                  <option value=">=">≥ {t('target', 'الهدف')}</option>
                  <option value="<=">≤ {t('target', 'الهدف')}</option>
                </select>
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Save KPI', 'حفظ المؤشر')}
              </button>
            </form>
          )}
          {data.kpis.length === 0 ? (
            <p className="reg-note">
              {t(
                'No KPI is defined yet. Add the standard set or define your own.',
                'لم يُعرَّف أي مؤشر بعد. أضف المجموعة القياسية أو عرّف مؤشراتك.',
              )}
            </p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('KPI', 'المؤشر')}</th>
                    <th>{t('Value', 'القيمة')}</th>
                    <th>{t('Target', 'الهدف')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th>{t('Source', 'المصدر')}</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiRows(data.current).map((k) => (
                    <tr key={k.code}>
                      <td>
                        <strong>{en ? k.nameEn : k.nameAr}</strong>
                        <small>
                          {k.code} · {k.computation}
                        </small>
                      </td>
                      <td dir="ltr">{unitLabel(k, k.value)}</td>
                      <td dir="ltr">
                        {k.comparator} {unitLabel(k, k.target)}
                      </td>
                      <td>
                        <span
                          className={`reg-pill ${k.met === null ? '' : k.met ? 'is-ok' : 'is-bad'}`}
                        >
                          {k.met === null
                            ? t('No data', 'لا بيانات')
                            : k.met
                              ? t('Met', 'محقق')
                              : t('Below target', 'دون الهدف')}
                        </span>
                      </td>
                      <td>
                        {k.source === 'manual'
                          ? t('Manual', 'يدوي')
                          : `${t('computed', 'محسوب')}${k.numerator !== null ? ` · ${k.numerator}${k.denominator !== null ? ` / ${k.denominator}` : ''}` : ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'obligations' && data && (
        <section className="reg-panel" aria-label={t('Obligations', 'الالتزامات')}>
          <div className="reg-section-head">
            <h2>{t('Obligations calendar', 'تقويم الالتزامات')}</h2>
            <div className="reg-inline">
              <button
                type="button"
                onClick={() => setEditing(editing === 'obligation' ? null : 'obligation')}
              >
                {t('Add obligation', 'إضافة التزام')}
              </button>
              <button
                type="button"
                className="reg-primary"
                onClick={() => setEditing(editing === 'submission' ? null : 'submission')}
              >
                {t('Prepare submission', 'إعداد تقديم')}
              </button>
            </div>
          </div>
          {editing === 'obligation' && (
            <form className="reg-form" onSubmit={submitObligation}>
              <label>
                {t('Code', 'الرمز')}
                <input name="code" required pattern="[A-Za-z0-9_-]{2,40}" />
              </label>
              <label>
                {t('Title (EN)', 'العنوان (إنجليزي)')}
                <input name="titleEn" required />
              </label>
              <label>
                {t('Title (AR)', 'العنوان (عربي)')}
                <input name="titleAr" required />
              </label>
              <label>
                {t('Authority', 'الجهة')}
                <input name="authority" required />
              </label>
              <label>
                {t('Frequency', 'التكرار')}
                <select name="frequency" defaultValue="monthly">
                  {['monthly', 'quarterly', 'semiannual', 'annual', 'once'].map((f) => (
                    <option key={f} value={f}>
                      {frequencyLabel(f)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Next due', 'الاستحقاق التالي')}
                <input name="nextDueOn" type="date" required />
              </label>
              <label>
                {t('Owner', 'المسؤول')}
                <select name="ownerUserId" defaultValue="">
                  <option value="">{t('Unassigned', 'غير معيّن')}</option>
                  {data.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reg-check">
                <input name="evidenceRequired" type="checkbox" defaultChecked />{' '}
                {t('Evidence required', 'يلزم دليل')}
              </label>
              <label className="reg-span">
                {t('Description', 'الوصف')}
                <input name="description" maxLength={2000} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Save obligation', 'حفظ الالتزام')}
              </button>
            </form>
          )}
          {editing === 'submission' && (
            <form className="reg-form" onSubmit={submitPrepare}>
              <label>
                {t('Obligation', 'الالتزام')}
                <select name="obligationId" defaultValue="">
                  <option value="">{t('Ad hoc (no obligation)', 'دون التزام')}</option>
                  {data.obligations
                    .filter((o) => o.active)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} · {en ? o.titleEn : o.titleAr}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('Period start', 'بداية الفترة')}
                <input
                  name="periodStart"
                  type="date"
                  required
                  defaultValue={data.current.periodStart}
                />
              </label>
              <label>
                {t('Period end', 'نهاية الفترة')}
                <input
                  name="periodEnd"
                  type="date"
                  required
                  defaultValue={data.current.periodEnd}
                />
              </label>
              <label className="reg-span">
                {t('Notes', 'ملاحظات')}
                <input name="notes" maxLength={4000} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Compute evidence and prepare', 'حساب الأدلة والإعداد')}
              </button>
            </form>
          )}
          {data.obligations.length === 0 ? (
            <p className="reg-note">
              {t('No obligation recorded yet.', 'لم يُسجَّل أي التزام بعد.')}
            </p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Obligation', 'الالتزام')}</th>
                    <th>{t('Authority', 'الجهة')}</th>
                    <th>{t('Frequency', 'التكرار')}</th>
                    <th>{t('Next due', 'الاستحقاق')}</th>
                    <th>{t('Owner', 'المسؤول')}</th>
                    <th>{t('Last submission', 'آخر تقديم')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.obligations.map((o) => (
                    <tr
                      key={o.id}
                      className={o.overdue ? 'is-overdue' : o.active ? '' : 'is-muted'}
                    >
                      <td>
                        <strong>{en ? o.titleEn : o.titleAr}</strong>
                        <small>
                          {o.code}
                          {o.evidenceRequired ? ` · ${t('evidence required', 'يلزم دليل')}` : ''}
                        </small>
                      </td>
                      <td>{o.authority}</td>
                      <td>{frequencyLabel(o.frequency)}</td>
                      <td>
                        {date(o.nextDueOn)}
                        <small>
                          {o.overdue ? t('overdue', 'متأخر') : `${o.daysToDue} ${t('days', 'يوم')}`}
                        </small>
                      </td>
                      <td>{o.ownerName ?? '—'}</td>
                      <td>
                        {o.lastSubmission
                          ? `${o.lastSubmission.submissionNumber} · ${statusLabel(o.lastSubmission.status)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'licences' && data && (
        <section className="reg-panel" aria-label={t('Licences', 'الرخص')}>
          <div className="reg-section-head">
            <h2>{t('Licence and renewal register', 'سجل الرخص والتجديدات')}</h2>
            <button
              type="button"
              onClick={() => setEditing(editing === 'licence' ? null : 'licence')}
            >
              {t('Add licence', 'إضافة رخصة')}
            </button>
          </div>
          {editing === 'licence' && (
            <form className="reg-form" onSubmit={submitLicence}>
              <label>
                {t('Kind', 'النوع')}
                <select name="kind" defaultValue="isp_licence">
                  <option value="isp_licence">{t('ISP licence', 'رخصة مزود إنترنت')}</option>
                  <option value="frequency">{t('Frequency', 'تردد')}</option>
                  <option value="municipal">{t('Municipal', 'بلدية')}</option>
                  <option value="numbering">{t('Numbering', 'ترقيم')}</option>
                  <option value="other">{t('Other', 'أخرى')}</option>
                </select>
              </label>
              <label>
                {t('Reference', 'المرجع')}
                <input name="reference" required maxLength={120} />
              </label>
              <label>
                {t('Authority', 'الجهة')}
                <input name="authority" required maxLength={160} />
              </label>
              <label>
                {t('Title (EN)', 'العنوان (إنجليزي)')}
                <input name="titleEn" required />
              </label>
              <label>
                {t('Title (AR)', 'العنوان (عربي)')}
                <input name="titleAr" required />
              </label>
              <label>
                {t('Issued on', 'تاريخ الإصدار')}
                <input name="issuedOn" type="date" />
              </label>
              <label>
                {t('Expires on', 'تاريخ الانتهاء')}
                <input name="expiresOn" type="date" />
              </label>
              <label>
                {t('Renewal notice (days)', 'إشعار التجديد (أيام)')}
                <input name="renewalNoticeDays" type="number" min={0} max={730} defaultValue={90} />
              </label>
              <label className="reg-span">
                {t('Notes', 'ملاحظات')}
                <input name="notes" maxLength={2000} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Save licence', 'حفظ الرخصة')}
              </button>
            </form>
          )}
          {data.licences.length === 0 ? (
            <p className="reg-note">{t('No licence recorded yet.', 'لم تُسجَّل أي رخصة بعد.')}</p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Licence', 'الرخصة')}</th>
                    <th>{t('Authority', 'الجهة')}</th>
                    <th>{t('Issued', 'الإصدار')}</th>
                    <th>{t('Expires', 'الانتهاء')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.licences.map((l) => (
                    <tr key={l.id} className={l.renewalDue ? 'is-overdue' : ''}>
                      <td>
                        <strong>{en ? l.titleEn : l.titleAr}</strong>
                        <small>
                          {l.reference} · {l.kind}
                        </small>
                      </td>
                      <td>{l.authority}</td>
                      <td>{date(l.issuedOn)}</td>
                      <td>
                        {date(l.expiresOn)}
                        <small>
                          {l.daysToExpiry === null
                            ? ''
                            : l.daysToExpiry < 0
                              ? t('expired', 'منتهية')
                              : `${l.daysToExpiry} ${t('days', 'يوم')}`}
                        </small>
                      </td>
                      <td>
                        <span className={`reg-pill ${l.renewalDue ? 'is-bad' : 'is-ok'}`}>
                          {statusLabel(l.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'submissions' && data && (
        <section className="reg-panel" aria-label={t('Submissions', 'التقديمات')}>
          <div className="reg-section-head">
            <h2>{t('Periodic submissions', 'التقديمات الدورية')}</h2>
            <button
              type="button"
              className="reg-primary"
              onClick={() => {
                setView('obligations');
                setEditing('submission');
              }}
            >
              {t('Prepare submission', 'إعداد تقديم')}
            </button>
          </div>
          {opened && (
            <article className="reg-form reg-evidence" aria-label={opened.submissionNumber}>
              <div className="reg-section-head">
                <div>
                  <h3>
                    {opened.submissionNumber} · {statusLabel(opened.status)}
                  </h3>
                  <p className="reg-note">
                    {date(opened.periodStart)} → {date(opened.periodEnd)} ·{' '}
                    {t('prepared by', 'أعده')} {opened.preparedBy} · {time(opened.preparedAt)}
                    {opened.submissionReference ? ` · ${opened.submissionReference}` : ''}
                  </p>
                </div>
                <div className="reg-inline">
                  <button type="button" onClick={() => exportEvidence(opened)}>
                    {t('Export evidence CSV', 'تصدير الأدلة CSV')}
                  </button>
                  {opened.status === 'submitted' && (
                    <>
                      <button type="button" onClick={() => decide(opened, 'accepted')}>
                        {t('Mark accepted', 'وسم كمقبول')}
                      </button>
                      <button type="button" onClick={() => decide(opened, 'rejected')}>
                        {t('Mark rejected', 'وسم كمرفوض')}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setOpened(undefined)}>
                    {t('Close', 'إغلاق')}
                  </button>
                </div>
              </div>
              {opened.status === 'draft' && (
                <form className="reg-inline" onSubmit={(event) => submitReference(event, opened)}>
                  <label>
                    {t('Regulator reference', 'مرجع الجهة المنظمة')}
                    <input name="reference" required maxLength={200} />
                  </label>
                  <button type="submit" className="reg-primary" disabled={busy}>
                    {t('Submit to regulator', 'إرسال إلى الجهة')}
                  </button>
                </form>
              )}
              <div className="reg-table-wrap">
                <table className="reg-table">
                  <thead>
                    <tr>
                      <th>{t('KPI', 'المؤشر')}</th>
                      <th>{t('Value', 'القيمة')}</th>
                      <th>{t('Target', 'الهدف')}</th>
                      <th>{t('Status', 'الحالة')}</th>
                      <th>{t('Evidence', 'الدليل')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiRows(opened.evidence).map((k) => (
                      <tr key={k.code}>
                        <td>
                          {en ? k.nameEn : k.nameAr}
                          <small>{k.code}</small>
                        </td>
                        <td dir="ltr">{unitLabel(k, k.value)}</td>
                        <td dir="ltr">
                          {k.comparator} {unitLabel(k, k.target)}
                        </td>
                        <td>
                          <span
                            className={`reg-pill ${k.met === null ? '' : k.met ? 'is-ok' : 'is-bad'}`}
                          >
                            {k.met === null
                              ? t('No data', 'لا بيانات')
                              : k.met
                                ? t('Met', 'محقق')
                                : t('Below target', 'دون الهدف')}
                          </span>
                        </td>
                        <td>
                          {k.numerator !== null
                            ? `${k.numerator}${k.denominator !== null ? ` / ${k.denominator}` : ''}`
                            : k.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="reg-note">
                {t('Snapshot', 'اللقطة')}: {opened.evidence.activeServices}{' '}
                {t('active services', 'خدمة نشطة')} · {opened.evidence.activeSubscribers}{' '}
                {t('subscribers', 'مشترك')} · {opened.evidence.outagesStarted}{' '}
                {t('outages', 'انقطاع')} ({opened.evidence.outageMinutes} {t('min', 'د')}) ·{' '}
                {opened.evidence.criticalAlarms} {t('critical alarms', 'إنذار حرج')} ·{' '}
                {opened.evidence.tickets} {t('tickets', 'تذكرة')} · {opened.evidence.complaints}{' '}
                {t('complaints', 'شكوى')} · {t('computed', 'حُسبت')}{' '}
                {time(opened.evidence.computedAt)}
              </p>
            </article>
          )}
          {data.submissions.length === 0 ? (
            <p className="reg-note">
              {t('No submission has been prepared yet.', 'لم يُعد أي تقديم بعد.')}
            </p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Number', 'الرقم')}</th>
                    <th>{t('Obligation', 'الالتزام')}</th>
                    <th>{t('Period', 'الفترة')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th>{t('Reference', 'المرجع')}</th>
                    <th>{t('Prepared', 'أُعد')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.submissions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.submissionNumber}</strong>
                      </td>
                      <td>{s.obligationCode ?? t('Ad hoc', 'دون التزام')}</td>
                      <td>
                        {date(s.periodStart)} → {date(s.periodEnd)}
                      </td>
                      <td>
                        <span
                          className={`reg-pill ${s.status === 'accepted' ? 'is-ok' : s.status === 'rejected' ? 'is-bad' : ''}`}
                        >
                          {statusLabel(s.status)}
                        </span>
                      </td>
                      <td>{s.submissionReference ?? '—'}</td>
                      <td>
                        {s.preparedBy}
                        <small>{time(s.preparedAt)}</small>
                      </td>
                      <td>
                        <button type="button" onClick={() => setOpened(s)}>
                          {t('Open', 'فتح')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
