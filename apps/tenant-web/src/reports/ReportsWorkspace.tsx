import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  reportExportSchema,
  type ReportDataset,
  type ReportKey,
  type ReportsWorkspace as Workspace,
} from '@isp/contracts';
import { readReportDataset, readReportsWorkspace, submitTenantOperation } from '../api';
import { accountMoney } from '../billing/account-money';
import './reports.css';

export function ReportsWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ReportKey>('ar_aging');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dataset, setDataset] = useState<ReportDataset>();
  const [datasetState, setDatasetState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
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
    void readReportsWorkspace(session)
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
  }, [session, refresh]);
  const name = (key: ReportKey) =>
    ({
      ar_aging: t('Receivables aging', 'أعمار الذمم'),
      collections_daily: t('Collections by day and channel', 'التحصيل حسب اليوم والقناة'),
      subscriber_status: t('Subscribers by branch and status', 'المشتركون حسب الفرع والحالة'),
      plan_mix: t('Plan mix and monthly recurring', 'مزيج الخطط والإيراد الشهري المتكرر'),
      ticket_sla: t('Ticket SLA by priority', 'مهل التذاكر حسب الأولوية'),
      incidents: t('Incidents and time to resolve', 'الحوادث ومدة الحل'),
      dealer_float: t('Dealer float and vouchers', 'رصيد الوكلاء والقسائم'),
      assurance_exposure: t('Revenue assurance exposure', 'تعرض ضمان الإيرادات'),
      notification_delivery: t('Notification delivery', 'تسليم الإشعارات'),
    })[key];
  const hint = (key: ReportKey) =>
    ({
      ar_aging: t(
        'Unpaid posted invoices in 0-30, 31-60, 61-90 and 90+ day buckets per currency.',
        'الفواتير المرحّلة غير المسددة في شرائح ٠-٣٠، ٣١-٦٠، ٦١-٩٠ و٩٠+ يوماً لكل عملة.',
      ),
      collections_daily: t(
        'Posted receipts per day, currency and channel within the window.',
        'الإيصالات المرحّلة لكل يوم وعملة وقناة ضمن النافذة.',
      ),
      subscriber_status: t(
        'Subscriber counts by branch and lifecycle status.',
        'أعداد المشتركين حسب الفرع وحالة دورة الحياة.',
      ),
      plan_mix: t(
        'Active services per plan with the recurring amount they represent.',
        'الخدمات النشطة لكل خطة والمبلغ المتكرر الذي تمثله.',
      ),
      ticket_sla: t(
        'Tickets opened in the window: responded and resolved within target, reopened, escalated.',
        'التذاكر المفتوحة ضمن النافذة: الرد والحل ضمن الهدف، المعاد فتحها، المصعّدة.',
      ),
      incidents: t(
        'Incidents started in the window with minutes to resolve against the SLA target.',
        'الحوادث التي بدأت ضمن النافذة مع دقائق الحل مقابل هدف SLA.',
      ),
      dealer_float: t(
        'Each dealer’s float per currency, credit limit and vouchers still in the field.',
        'رصيد كل وكيل لكل عملة وسقف الائتمان والقسائم لدى الوكلاء.',
      ),
      assurance_exposure: t(
        'Open and acknowledged findings grouped by control and currency.',
        'النتائج المفتوحة والمُقرّ بها مجمّعة حسب الضابط والعملة.',
      ),
      notification_delivery: t(
        'Messages per day, channel and delivery status within the window.',
        'الرسائل لكل يوم وقناة وحالة تسليم ضمن النافذة.',
      ),
    })[key];
  const windowed = data?.catalogue.find((c) => c.key === selected)?.windowed ?? false;
  const query = () => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  async function run(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!session) return;
    setDatasetState('loading');
    setError('');
    try {
      const result = await readReportDataset(session, selected, query());
      if (!mounted.current) return;
      setDataset(result);
      setDatasetState('ready');
    } catch (cause) {
      if (!mounted.current) return;
      setDatasetState('error');
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : t('The report could not be read.', 'تعذّرت قراءة التقرير.'),
      );
    }
  }
  async function exportCsv() {
    if (!session || busy) return;
    const parsed = reportExportSchema.safeParse({ key: selected, ...query(), format: 'csv' });
    if (!parsed.success) {
      setError(t('Choose a valid date window.', 'اختر نافذة تاريخ صالحة.'));
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(
        session,
        'reports/export',
        { command: parsed.data },
        `web-report-${crypto.randomUUID()}`,
      );
      if (!mounted.current) return;
      const csv = typeof result.csv === 'string' ? result.csv : '';
      const filename = typeof result.filename === 'string' ? result.filename : `${selected}.csv`;
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `${t('Export recorded and downloaded', 'تم تسجيل التصدير وتنزيله')}: ${filename} (${typeof result.rows === 'number' ? result.rows : 0} ${t('rows', 'صفاً')}).`,
      );
      setRefresh((v) => v + 1);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : t('The export was not completed.', 'لم يكتمل التصدير.'),
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const cell = (key: string, value: unknown, row: Record<string, unknown>) => {
    if (typeof value === 'number' && /Minor$/u.test(key)) {
      const currency = row.currency;
      return currency === 'USD' || currency === 'LBP'
        ? accountMoney(value, currency, locale)
        : String(value);
    }
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value))
      return new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    if (typeof value === 'object') return JSON.stringify(value);
    return typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '—';
  };
  if (!session)
    return (
      <section className="rp-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('Reports', 'التقارير')}</h1>
        <p>
          {t(
            'Sign in to run governed reports for your scope.',
            'سجّل الدخول لتشغيل التقارير المحكومة ضمن نطاقك.',
          )}
        </p>
      </section>
    );
  const columns = dataset
    ? Array.from(new Set(dataset.rows.flatMap((r) => Object.keys(r)))).filter(
        (c) => c !== 'bucketOrder',
      )
    : [];
  return (
    <section className="rp-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="rp-hero">
        <div>
          <span>{t('REPORTS', 'التقارير')}</span>
          <h1>{t('Governed reports from your own records.', 'تقارير محكومة من سجلاتك.')}</h1>
          <p>
            {t(
              'Every report is computed on request for your permitted scope; money keeps its currency; each CSV export is recorded with who ran it and how many rows left the system.',
              'يُحسب كل تقرير عند الطلب ضمن نطاق صلاحيتك؛ يحتفظ المال بعملته؛ ويُسجَّل كل تصدير CSV مع من شغّله وعدد الصفوف التي غادرت النظام.',
            )}
          </p>
        </div>
      </header>
      {notice && (
        <p className="rp-panel rp-panel--positive" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rp-panel rp-panel--negative" role="alert">
          {error}
        </p>
      )}
      {state === 'loading' && (
        <p role="status">{t('Loading report catalogue…', 'جارٍ تحميل كتالوج التقارير…')}</p>
      )}
      {state === 'error' && (
        <div className="rp-panel rp-panel--negative" role="alert">
          <h2>{t('Reports unavailable', 'التقارير غير متاحة')}</h2>
          <p>
            {t(
              'Check your connection and report-view permission, then refresh.',
              'تحقق من الاتصال وصلاحية عرض التقارير ثم حدّث.',
            )}
          </p>
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Refresh', 'تحديث')}
          </button>
        </div>
      )}
      {state === 'ready' && data && (
        <>
          <section className="rp-card">
            <h2>{t('Catalogue', 'الكتالوج')}</h2>
            <div className="rp-catalogue">
              {data.catalogue.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  aria-current={selected === entry.key ? 'true' : undefined}
                  onClick={() => {
                    setSelected(entry.key);
                    setDataset(undefined);
                    setDatasetState('idle');
                  }}
                >
                  <strong>{name(entry.key)}</strong>
                  <small>{hint(entry.key)}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="rp-card">
            <form className="rp-toolbar" onSubmit={(event) => void run(event)}>
              <strong>{name(selected)}</strong>
              {windowed && (
                <>
                  <label className="rp-inline">
                    {t('From', 'من')}
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label className="rp-inline">
                    {t('To', 'إلى')}
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </label>
                </>
              )}
              <button type="submit" className="rp-primary" disabled={datasetState === 'loading'}>
                {datasetState === 'loading'
                  ? t('Running…', 'جارٍ التشغيل…')
                  : t('Run report', 'تشغيل التقرير')}
              </button>
              <button type="button" disabled={busy} onClick={() => void exportCsv()}>
                {busy ? t('Exporting…', 'جارٍ التصدير…') : t('Export CSV', 'تصدير CSV')}
              </button>
            </form>
            {datasetState === 'idle' && (
              <p className="rp-note">
                {windowed
                  ? t(
                      'Defaults to the last 30 days when no window is given.',
                      'الافتراضي آخر ٣٠ يوماً عند عدم تحديد نافذة.',
                    )
                  : t(
                      'This report has no date window; it reflects the current records.',
                      'لا نافذة تاريخ لهذا التقرير؛ يعكس السجلات الحالية.',
                    )}
              </p>
            )}
            {dataset && datasetState === 'ready' && (
              <>
                <p className="rp-note">
                  {dataset.rows.length} {t('rows', 'صفاً')} · {dataset.from} → {dataset.to} ·{' '}
                  {t('generated', 'أُنشئ')}{' '}
                  {new Date(dataset.generatedAt).toLocaleString(
                    locale === 'ar' ? 'ar-LB' : 'en-GB',
                    {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    },
                  )}
                </p>
                {dataset.rows.length === 0 ? (
                  <p className="rp-note">
                    {t('No rows for this window.', 'لا صفوف لهذه النافذة.')}
                  </p>
                ) : (
                  <div className="rp-table">
                    <table>
                      <thead>
                        <tr>
                          {columns.map((c) => (
                            <th key={c} scope="col">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataset.rows.map((row, index) => (
                          <tr key={index}>
                            {columns.map((c) => (
                              <td key={c} className={typeof row[c] === 'number' ? 'is-number' : ''}>
                                {cell(c, row[c], row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="rp-card">
            <h2>{t('Export history', 'سجل التصدير')}</h2>
            {data.exports.length === 0 ? (
              <p className="rp-note">{t('No exports recorded yet.', 'لا تصديرات مسجلة بعد.')}</p>
            ) : (
              <div className="rp-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('Report', 'التقرير')}</th>
                      <th scope="col">{t('Format', 'الصيغة')}</th>
                      <th scope="col">{t('Status', 'الحالة')}</th>
                      <th scope="col">{t('Rows', 'الصفوف')}</th>
                      <th scope="col">{t('By', 'بواسطة')}</th>
                      <th scope="col">{t('When', 'التاريخ')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exports.map((job) => (
                      <tr key={job.id}>
                        <td>{job.reportKey}</td>
                        <td>{job.format}</td>
                        <td>{job.status}</td>
                        <td className="is-number">{job.rows ?? '—'}</td>
                        <td>{job.requestedBy}</td>
                        <td>
                          {new Date(job.requestedAt).toLocaleString(
                            locale === 'ar' ? 'ar-LB' : 'en-GB',
                            {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            },
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
