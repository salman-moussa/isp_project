import type { ApiSession } from '@isp/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  readBillingWorkspace,
  submitBillingOperation,
  type BillingDunningCase,
  type BillingWorkspaceData,
  type BillingWorkspaceRun,
} from '../api';
import './billing.css';
import { InvoiceArchive } from './InvoiceArchive';

interface BillingWorkspaceProps {
  readonly locale: 'en' | 'ar';
  readonly session: ApiSession;
}

const copy = {
  en: {
    eyebrow: 'Revenue operations · Billing control',
    title: 'Run billing with recoverable outcomes',
    description:
      'Prepare exact recurring drafts, retry only failed services, and move unpaid invoices through an evidenced review—not automatic network suspension.',
    newRun: 'New recurring run',
    dunning: 'Dunning review',
    policy: 'Collection policy',
    history: 'Run history',
    queue: 'Open dunning queue',
    prepare: 'Prepare recurring drafts',
    evaluate: 'Evaluate overdue invoices',
    publish: 'Publish policy version',
    retry: 'Retry failed services',
    noRuns: 'No recurring billing runs yet.',
    noCases: 'No invoices currently require dunning review.',
    noPolicy: 'Publish a dunning policy before evaluating overdue invoices.',
    periodStart: 'Period start',
    periodEnd: 'Period end',
    asOf: 'Evaluate as of',
    reason: 'Business reason',
    version: 'Version',
    terms: 'Payment terms (days)',
    reminder: 'Reminder after overdue days',
    final: 'Final notice after overdue days',
    review: 'Suspension review after overdue days',
    effective: 'Effective from',
    success: 'The governed operation completed and the workspace was refreshed.',
    automatic: 'Review only',
    automaticDetail:
      'A suspension-review stage never sends a router command. An authorized employee must use the separate service lifecycle workflow.',
  },
  ar: {
    eyebrow: 'عمليات الإيرادات · ضبط الفوترة',
    title: 'نفّذ الفوترة مع نتائج قابلة للمعالجة',
    description:
      'حضّر مسودات دورية دقيقة، وأعد محاولة الخدمات الفاشلة فقط، وانقل الفواتير غير المدفوعة ضمن مراجعة موثقة من دون تعليق تلقائي للشبكة.',
    newRun: 'دفعة دورية جديدة',
    dunning: 'مراجعة التحصيل',
    policy: 'سياسة التحصيل',
    history: 'سجل الدفعات',
    queue: 'قائمة المتابعة المفتوحة',
    prepare: 'تحضير المسودات الدورية',
    evaluate: 'تقييم الفواتير المتأخرة',
    publish: 'نشر نسخة السياسة',
    retry: 'إعادة محاولة الخدمات الفاشلة',
    noRuns: 'لا توجد دفعات فوترة دورية بعد.',
    noCases: 'لا توجد فواتير تحتاج إلى مراجعة تحصيل حالياً.',
    noPolicy: 'انشر سياسة متابعة قبل تقييم الفواتير المتأخرة.',
    periodStart: 'بداية الفترة',
    periodEnd: 'نهاية الفترة',
    asOf: 'التقييم كما في',
    reason: 'السبب التشغيلي',
    version: 'النسخة',
    terms: 'مهلة الدفع (بالأيام)',
    reminder: 'التذكير بعد أيام التأخر',
    final: 'الإنذار النهائي بعد أيام التأخر',
    review: 'مراجعة التعليق بعد أيام التأخر',
    effective: 'نافذة من',
    success: 'اكتملت العملية المحكومة وتم تحديث مساحة العمل.',
    automatic: 'مراجعة فقط',
    automaticDetail:
      'مرحلة مراجعة التعليق لا ترسل أي أمر إلى الموجّه. يجب أن يستخدم موظف مخوّل مسار دورة حياة الخدمة المنفصل.',
  },
} as const;

export function BillingWorkspace({ locale, session }: BillingWorkspaceProps) {
  const text = copy[locale];
  const [workspace, setWorkspace] = useState<BillingWorkspaceData>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const defaults = useMemo(() => periodDefaults(new Date()), []);

  async function load() {
    setError(undefined);
    try {
      setWorkspace(await readBillingWorkspace(session));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Billing workspace request failed.');
    }
  }

  useEffect(() => {
    void load();
  }, [session]);

  async function mutate(
    path: 'billing-runs' | 'dunning-policy-versions' | 'dunning-evaluations',
    payload: Readonly<Record<string, unknown>>,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await submitBillingOperation(session, path, payload);
      await load();
      setNotice(text.success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Billing operation failed.');
    } finally {
      setBusy(false);
    }
  }

  const failedServices = workspace?.runs.reduce((total, run) => total + run.failedCount, 0) ?? 0;
  const openCases = workspace?.dunningCases.filter((item) => item.status === 'open') ?? [];
  const reviewCases = openCases.filter((item) => item.currentStage === 'suspension_review').length;

  return (
    <div className="billing-workspace" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="billing-hero">
        <div>
          <span>{text.eyebrow}</span>
          <h1>{text.title}</h1>
          <p>{text.description}</p>
        </div>
        <div className="billing-guardrail" role="note">
          <strong>{text.automatic}</strong>
          <p>{text.automaticDetail}</p>
        </div>
      </header>

      {error ? (
        <div className="billing-feedback billing-feedback--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            {locale === 'en' ? 'Retry read' : 'إعادة القراءة'}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="billing-feedback" role="status">
          {notice}
        </div>
      ) : null}

      <section
        className="billing-metrics"
        aria-label={locale === 'en' ? 'Billing pulse' : 'مؤشرات الفوترة'}
      >
        <Metric
          label={locale === 'en' ? 'Recent runs' : 'الدفعات الأخيرة'}
          value={workspace?.runs.length ?? 0}
        />
        <Metric
          label={locale === 'en' ? 'Failed services' : 'الخدمات الفاشلة'}
          value={failedServices}
          tone={failedServices ? 'risk' : 'good'}
        />
        <Metric
          label={locale === 'en' ? 'Open dunning' : 'متابعة مفتوحة'}
          value={openCases.length}
        />
        <Metric
          label={locale === 'en' ? 'Suspension reviews' : 'مراجعات التعليق'}
          value={reviewCases}
          tone={reviewCases ? 'risk' : 'good'}
        />
      </section>

      <div className="billing-command-grid">
        <InvoiceArchive locale={locale} session={session} workspace={workspace} reload={load} />
        <RunForm
          locale={locale}
          defaults={defaults}
          busy={busy}
          onSubmit={(payload) => void mutate('billing-runs', payload)}
        />
        <EvaluationForm
          locale={locale}
          busy={busy}
          onSubmit={(payload) => void mutate('dunning-evaluations', payload)}
        />
        <PolicyForm
          locale={locale}
          busy={busy}
          onSubmit={(payload) => void mutate('dunning-policy-versions', payload)}
        />
      </div>

      <section className="billing-panel">
        <div className="billing-panel__heading">
          <div>
            <span>{text.newRun}</span>
            <h2>{text.history}</h2>
          </div>
          <small>{workspace?.runs.length ?? 0}</small>
        </div>
        {!workspace ? (
          <p>{locale === 'en' ? 'Loading billing evidence…' : 'جارٍ تحميل أدلة الفوترة…'}</p>
        ) : null}
        {workspace?.runs.length === 0 ? <p className="billing-empty">{text.noRuns}</p> : null}
        <div className="billing-runs">
          {workspace?.runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              locale={locale}
              busy={busy}
              onRetry={() =>
                void mutate('billing-runs', {
                  periodStart: run.periodStart,
                  periodEnd: run.periodEnd,
                  retryOfRunId: run.id,
                  reason:
                    'Retry only failed services after correcting their effective billing configuration.',
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="billing-panel">
        <div className="billing-panel__heading">
          <div>
            <span>{text.dunning}</span>
            <h2>{text.queue}</h2>
          </div>
          <small>{openCases.length}</small>
        </div>
        {workspace?.dunningPolicies.length === 0 ? (
          <p className="billing-empty">{text.noPolicy}</p>
        ) : null}
        {workspace && openCases.length === 0 ? (
          <p className="billing-empty">{text.noCases}</p>
        ) : null}
        <div className="dunning-grid">
          {workspace?.dunningCases.map((item) => (
            <DunningCard key={item.id} item={item} locale={locale} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'neutral' | 'good' | 'risk';
}) {
  return (
    <article className={`billing-metric billing-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RunForm({
  locale,
  defaults,
  busy,
  onSubmit,
}: {
  readonly locale: 'en' | 'ar';
  readonly defaults: { readonly start: string; readonly end: string };
  readonly busy: boolean;
  readonly onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const text = copy[locale];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      periodStart: formText(form, 'periodStart'),
      periodEnd: formText(form, 'periodEnd'),
      reason: formText(form, 'reason'),
    });
  }
  return (
    <form className="billing-command" onSubmit={submit}>
      <span>{text.newRun}</span>
      <h2>{text.prepare}</h2>
      <label>
        {text.periodStart}
        <input name="periodStart" type="date" defaultValue={defaults.start} required />
      </label>
      <label>
        {text.periodEnd}
        <input name="periodEnd" type="date" defaultValue={defaults.end} required />
      </label>
      <label>
        {text.reason}
        <textarea
          name="reason"
          defaultValue={
            locale === 'en'
              ? 'Prepare the scheduled recurring billing period.'
              : 'تحضير فترة الفوترة الدورية المجدولة.'
          }
          minLength={8}
          required
        />
      </label>
      <button disabled={busy}>{text.prepare}</button>
    </form>
  );
}

function EvaluationForm({
  locale,
  busy,
  onSubmit,
}: {
  readonly locale: 'en' | 'ar';
  readonly busy: boolean;
  readonly onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const text = copy[locale];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({ asOfDate: formText(form, 'asOfDate'), reason: formText(form, 'reason') });
  }
  return (
    <form className="billing-command" onSubmit={submit}>
      <span>{text.dunning}</span>
      <h2>{text.evaluate}</h2>
      <label>
        {text.asOf}
        <input name="asOfDate" type="date" defaultValue={isoDate(new Date())} required />
      </label>
      <label>
        {text.reason}
        <textarea
          name="reason"
          defaultValue={
            locale === 'en'
              ? 'Evaluate unpaid posted invoices under the approved policy.'
              : 'تقييم الفواتير المرحلة غير المدفوعة وفق السياسة المعتمدة.'
          }
          minLength={8}
          required
        />
      </label>
      <button disabled={busy}>{text.evaluate}</button>
    </form>
  );
}

function PolicyForm({
  locale,
  busy,
  onSubmit,
}: {
  readonly locale: 'en' | 'ar';
  readonly busy: boolean;
  readonly onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const text = copy[locale];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      version: Number(form.get('version')),
      paymentTermsDays: Number(form.get('paymentTermsDays')),
      reminderAfterDays: Number(form.get('reminderAfterDays')),
      finalNoticeAfterDays: Number(form.get('finalNoticeAfterDays')),
      suspensionReviewAfterDays: Number(form.get('suspensionReviewAfterDays')),
      effectiveFrom: formText(form, 'effectiveFrom'),
      reason: formText(form, 'reason'),
    });
  }
  return (
    <form className="billing-command billing-command--policy" onSubmit={submit}>
      <span>{text.policy}</span>
      <h2>{text.publish}</h2>
      <div className="billing-command__split">
        <label>
          {text.version}
          <input name="version" type="number" min="1" defaultValue="1" required />
        </label>
        <label>
          {text.terms}
          <input name="paymentTermsDays" type="number" min="0" defaultValue="10" required />
        </label>
        <label>
          {text.reminder}
          <input name="reminderAfterDays" type="number" min="0" defaultValue="2" required />
        </label>
        <label>
          {text.final}
          <input name="finalNoticeAfterDays" type="number" min="1" defaultValue="7" required />
        </label>
        <label>
          {text.review}
          <input
            name="suspensionReviewAfterDays"
            type="number"
            min="2"
            defaultValue="14"
            required
          />
        </label>
        <label>
          {text.effective}
          <input name="effectiveFrom" type="date" defaultValue={isoDate(new Date())} required />
        </label>
      </div>
      <label>
        {text.reason}
        <textarea
          name="reason"
          defaultValue={
            locale === 'en'
              ? 'Owner approved staged collection review thresholds.'
              : 'اعتمد المالك مراحل مراجعة التحصيل.'
          }
          minLength={8}
          required
        />
      </label>
      <button disabled={busy}>{text.publish}</button>
    </form>
  );
}

function RunCard({
  run,
  locale,
  busy,
  onRetry,
}: {
  readonly run: BillingWorkspaceRun;
  readonly locale: 'en' | 'ar';
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <details className={`billing-run billing-run--${run.status}`}>
      <summary>
        <div>
          <strong>
            {run.periodStart} → {run.periodEnd}
          </strong>
          <small>
            {shortId(run.id)}
            {run.retryOfRunId
              ? ` · ${locale === 'en' ? 'retry' : 'إعادة'} ${shortId(run.retryOfRunId)}`
              : ''}
          </small>
        </div>
        <div className="billing-run__counts">
          <Status value={run.status} locale={locale} />
          <span>{run.preparedCount} ✓</span>
          <span>{run.failedCount} !</span>
          <span>{run.skippedCount} ↷</span>
        </div>
      </summary>
      <div className="billing-run__body">
        {run.items.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.subscriberName}</strong>
              <small>
                {item.serviceNumber} · {locale === 'en' ? 'attempt' : 'المحاولة'}{' '}
                {item.attemptNumber}
              </small>
            </div>
            <p>{locale === 'en' ? item.explanationEn : item.explanationAr}</p>
            <Status value={item.status} locale={locale} />
          </article>
        ))}
        {run.failedCount > 0 ? (
          <button type="button" disabled={busy} onClick={onRetry}>
            {copy[locale].retry}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function DunningCard({
  item,
  locale,
}: {
  readonly item: BillingDunningCase;
  readonly locale: 'en' | 'ar';
}) {
  return (
    <article className={`dunning-card dunning-card--${item.currentStage}`}>
      <header>
        <div>
          <span>{item.documentNumber}</span>
          <h3>{item.subscriberName}</h3>
          <small>{item.serviceNumber}</small>
        </div>
        <Status value={item.currentStage} locale={locale} />
      </header>
      <strong className="dunning-card__amount">
        {money(item.outstandingMinor, item.currency, locale)}
      </strong>
      <p>{locale === 'en' ? `Due ${item.dueOn}` : `استحقاق ${item.dueOn}`}</p>
      <ol>
        {item.events.map((event) => (
          <li key={event.id}>
            <span>{locale === 'en' ? event.explanationEn : event.explanationAr}</span>
            <small>{event.occurredAt.slice(0, 10)}</small>
          </li>
        ))}
      </ol>
    </article>
  );
}

function Status({ value, locale }: { readonly value: string; readonly locale: 'en' | 'ar' }) {
  const labels: Record<string, readonly [string, string]> = {
    pending: ['Pending', 'قيد الانتظار'],
    running: ['Running', 'قيد التنفيذ'],
    succeeded: ['Succeeded', 'ناجحة'],
    failed: ['Needs attention', 'تحتاج متابعة'],
    cancelled: ['Cancelled', 'ملغاة'],
    prepared: ['Prepared', 'محضّرة'],
    skipped: ['Skipped safely', 'تم تجاوزها بأمان'],
    reminder: ['Reminder', 'تذكير'],
    final_notice: ['Final notice', 'إنذار نهائي'],
    suspension_review: ['Suspension review', 'مراجعة التعليق'],
    resolved: ['Resolved', 'مغلقة'],
  };
  return (
    <span className={`billing-status billing-status--${value}`}>
      {labels[value]?.[locale === 'en' ? 0 : 1] ?? value}
    </span>
  );
}

function periodDefaults(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: isoDate(start), end: isoDate(end) };
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
function shortId(value: string) {
  return value.slice(0, 8);
}
function money(amountMinor: number, currency: 'USD' | 'LBP', locale: 'en' | 'ar') {
  return new Intl.NumberFormat(locale === 'en' ? 'en-LB' : 'ar-LB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  }).format(currency === 'USD' ? amountMinor / 100 : amountMinor);
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
