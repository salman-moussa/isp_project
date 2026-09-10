import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityList,
  KpiCard,
  PageHeader,
  SectionHeading,
  StatePanel,
  StatusBadge,
  Surface,
  type ApiSession,
  type Locale,
} from '@isp/ui';
import {
  ControlApiError,
  readControlAudit,
  readControlBilling,
  readControlClientFile,
  readControlPackages,
  readControlPortfolio,
  readControlSubscriptions,
  type ControlAuditRow,
  type ControlBillingLedger,
  type ControlClientFile,
  type ControlPackageVersion,
  type ControlPortfolio,
  type ControlSubscriptionRow,
} from '../api';
import {
  ControlActionWorkspace,
  type ControlActionTask,
} from '../control-center/ControlActionWorkspace';
import './portfolio.css';

type Currency = 'USD' | 'LBP';
type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly denied: boolean };

export function money(minor: number, currency: Currency, locale: Locale): string {
  const value = currency === 'USD' ? minor / 100 : minor;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(value);
}
function when(value: string | null | undefined, locale: Locale, withTime = true): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  });
}
function useControlRead<T>(
  session: ApiSession,
  read: (session: ApiSession) => Promise<T>,
  key: unknown,
): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  // Callers pass inline readers; only the session, key and explicit retries trigger a read.
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    reader
      .current(session)
      .then((data) => active && setState({ status: 'ready', data }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            status: 'error',
            denied: error instanceof ControlApiError && error.status === 403,
          }),
      );
    return () => {
      active = false;
    };
  }, [session, key, tick]);
  return [state, () => setTick((v) => v + 1)];
}
function stateLabel(value: string, locale: Locale): string {
  const en: Record<string, string> = {
    lead: 'Lead',
    trial: 'Trial',
    active: 'Active',
    grace: 'Grace',
    restricted: 'Restricted',
    terminated: 'Terminated',
    archived: 'Archived',
  };
  const ar: Record<string, string> = {
    lead: 'مهتم',
    trial: 'تجريبي',
    active: 'نشط',
    grace: 'مهلة',
    restricted: 'مقيّد',
    terminated: 'منتهٍ',
    archived: 'مؤرشف',
  };
  return (locale === 'ar' ? ar : en)[value] ?? value;
}
function stateTone(value: string): 'positive' | 'primary' | 'warning' | 'critical' | 'neutral' {
  if (value === 'active') return 'positive';
  if (value === 'trial' || value === 'lead') return 'primary';
  if (value === 'grace') return 'warning';
  if (value === 'restricted' || value === 'terminated') return 'critical';
  return 'neutral';
}
function Pending({
  locale,
  state,
  retry,
  denied,
}: {
  locale: Locale;
  state: 'loading' | 'error';
  retry: () => void;
  denied?: boolean;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  if (state === 'loading')
    return (
      <StatePanel
        variant="loading"
        title={t('Loading portfolio data', 'جارٍ تحميل بيانات المحفظة')}
        description={t(
          'Reading the control plane through the authenticated API.',
          'جارٍ القراءة من طبقة التحكم عبر الواجهة المصرح بها.',
        )}
      />
    );
  if (denied)
    return (
      <StatePanel
        variant="denied"
        title={t(
          'This view needs a broader platform permission',
          'يحتاج هذا العرض صلاحية منصة أوسع',
        )}
        description={t(
          'Your platform role does not include the permission this page reads with.',
          'لا يتضمن دورك في المنصة الصلاحية التي تقرأ بها هذه الصفحة.',
        )}
      />
    );
  return (
    <StatePanel
      variant="error"
      title={t('Portfolio data could not be read', 'تعذّرت قراءة بيانات المحفظة')}
      description={t('Nothing was changed. Retry now.', 'لم يتغير شيء. أعد المحاولة الآن.')}
      actionLabel={t('Try again', 'إعادة المحاولة')}
      onAction={retry}
    />
  );
}
function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'positive' | 'primary' | 'warning' | 'critical' | 'neutral';
}) {
  return (
    <div className={`pf-stat is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Table({ children }: { children: ReactNode }) {
  return (
    <div className="pf-table-wrap">
      <table className="pf-table">{children}</table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function PortfolioOverview({
  session,
  locale,
  onNavigate,
  onOpenClient,
}: {
  session: ApiSession;
  locale: Locale;
  onNavigate: (id: string) => void;
  onOpenClient: (tenantId: string) => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlPortfolio, 'portfolio');
  if (state.status !== 'ready')
    return (
      <Pending
        locale={locale}
        state={state.status}
        retry={retry}
        denied={state.status === 'error' && state.denied}
      />
    );
  const p = state.data;
  const active = p.clients.byState.find((s) => s.state === 'active')?.count ?? 0;
  const perCurrency = (lines: readonly { currency: Currency; amountMinor: number }[]) =>
    lines.length === 0
      ? t('nothing posted', 'لا شيء مرحّل')
      : lines.map((l) => money(l.amountMinor, l.currency, locale)).join(' · ');
  const lifecycle = ['lead', 'trial', 'active', 'grace', 'restricted', 'terminated', 'archived']
    .map((s) => ({
      state: s,
      count: p.clients.byState.find((x) => x.state === s)?.count ?? 0,
    }))
    .filter((x) => x.count > 0);
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('PORTFOLIO', 'المحفظة')}
        title={t(
          'Every ISP client, without crossing the data boundary',
          'كل شركة إنترنت، من دون تجاوز حدود بياناتها',
        )}
        description={`${t('Computed from the control plane at', 'محسوبة من طبقة التحكم عند')} ${when(p.asOf, locale)}. ${t('Subscriber data stays inside each ISP workspace.', 'تبقى بيانات المشتركين داخل مساحة كل شركة.')}`}
      />
      <SectionHeading
        title={t('Portfolio pulse', 'نبض المحفظة')}
        description={t(
          'Each figure opens the list behind it.',
          'كل رقم يفتح القائمة التي تقف خلفه.',
        )}
      />
      <div className="kpi-grid">
        <KpiCard
          label={t('Active ISP clients', 'عملاء الإنترنت النشطون')}
          value={String(active)}
          detail={`${p.clients.total} ${t('client records', 'سجل عميل')} · ${p.clients.newThisMonth} ${t('new this month', 'جديد هذا الشهر')}`}
          tone="positive"
          targetLabel={t('Open clients', 'فتح العملاء')}
          onOpen={() => onNavigate('clients')}
        />
        <KpiCard
          label={t('Monthly recurring revenue', 'الإيراد الشهري المتكرر')}
          value={perCurrency(p.subscriptions.mrr)}
          detail={t(
            'Active and grace subscriptions at package price',
            'الاشتراكات النشطة وفي المهلة بسعر الباقة',
          )}
          tone="primary"
          targetLabel={t('Open subscriptions', 'فتح الاشتراكات')}
          onOpen={() => onNavigate('subscriptions')}
        />
        <KpiCard
          label={t('Outstanding platform invoices', 'فواتير المنصة المستحقة')}
          value={perCurrency(p.billing.outstanding)}
          detail={`${t('Received this month', 'المقبوض هذا الشهر')}: ${perCurrency(p.billing.receivedThisMonth)}`}
          tone={p.billing.outstanding.length ? 'warning' : 'positive'}
          targetLabel={t('Open billing', 'فتح الفوترة')}
          onOpen={() => onNavigate('billing')}
        />
        <KpiCard
          label={t('Renewals due in 30 days', 'تجديدات خلال ٣٠ يوماً')}
          value={String(p.subscriptions.renewalsDue.length)}
          detail={`${p.subscriptions.pendingTransitions} ${t('transition requests awaiting approval', 'طلبات انتقال بانتظار الموافقة')}`}
          tone={p.subscriptions.renewalsDue.length ? 'warning' : 'positive'}
          targetLabel={t('Open subscriptions', 'فتح الاشتراكات')}
          onOpen={() => onNavigate('subscriptions')}
        />
        <KpiCard
          label={t('Deployment attention', 'عمليات نشر تحتاج متابعة')}
          value={String(p.service.attention + p.service.blocked)}
          detail={`${p.service.healthy} ${t('healthy', 'سليمة')} · ${p.service.unknown} ${t('not reporting', 'لا تبلّغ')}`}
          tone={p.service.blocked ? 'critical' : p.service.attention ? 'warning' : 'positive'}
          targetLabel={t('Open deployments', 'فتح عمليات النشر')}
          onOpen={() => onNavigate('deployments')}
        />
        <KpiCard
          label={t('Support', 'الدعم')}
          value={String(p.service.openTickets)}
          detail={`${p.service.escalated} ${t('escalated', 'مصعّد')} · ${p.service.activeSupportGrants} ${t('active support grants', 'منح دعم نشطة')} · ${p.service.requestedSupportGrants} ${t('requested', 'مطلوبة')}`}
          tone={
            p.service.escalated
              ? 'critical'
              : p.service.requestedSupportGrants
                ? 'warning'
                : 'positive'
          }
          targetLabel={t('Open support', 'فتح الدعم')}
          onOpen={() => onNavigate('support')}
        />
      </div>
      <div className="content-grid dashboard-block">
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{t('Client lifecycle', 'دورة حياة العملاء')}</h2>
              <p>{t('Contract states across the portfolio.', 'حالات العقود ضمن المحفظة.')}</p>
            </div>
            <StatusBadge tone="neutral">{p.clients.total}</StatusBadge>
          </div>
          {lifecycle.length === 0 ? (
            <p className="pf-note">
              {t('No ISP client has been onboarded yet.', 'لم تُضف أي شركة إنترنت بعد.')}
            </p>
          ) : (
            <div className="lifecycle-bars">
              {lifecycle.map((row) => (
                <div className="lifecycle-row" key={row.state}>
                  <span>{stateLabel(row.state, locale)}</span>
                  <div
                    className={`lifecycle-track lifecycle-track--${stateTone(row.state) === 'neutral' ? 'primary' : stateTone(row.state)}`}
                  >
                    <span
                      style={{ inlineSize: `${Math.max(4, (row.count / p.clients.total) * 100)}%` }}
                    />
                  </div>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </div>
          )}
        </Surface>
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{t('Renewals due', 'تجديدات مستحقة')}</h2>
              <p>
                {t(
                  'Subscriptions ending within 30 days, or ended in the last week.',
                  'اشتراكات تنتهي خلال ٣٠ يوماً أو انتهت في الأسبوع الماضي.',
                )}
              </p>
            </div>
          </div>
          {p.subscriptions.renewalsDue.length === 0 ? (
            <p className="pf-note">{t('Nothing is due for renewal.', 'لا شيء مستحق للتجديد.')}</p>
          ) : (
            <ul className="pf-list">
              {p.subscriptions.renewalsDue.map((r) => (
                <li key={r.tenantId}>
                  <button
                    type="button"
                    className="cc-link"
                    onClick={() => onOpenClient(r.tenantId)}
                  >
                    {r.tradingName}
                  </button>
                  <span>
                    {r.packageKey} · {money(r.priceMinor, r.currency, locale)} ·{' '}
                    {when(r.endsAt, locale, false)}
                  </span>
                  <StatusBadge tone={stateTone(r.state)}>{stateLabel(r.state, locale)}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>
      <Surface className="dashboard-block">
        <div className="surface__header">
          <div>
            <h2>{t('Recent control-plane activity', 'آخر نشاط في طبقة التحكم')}</h2>
            <p>
              {t(
                'The latest audited operations, newest first.',
                'أحدث العمليات المدققة، الأحدث أولاً.',
              )}
            </p>
          </div>
          <StatusBadge tone="positive">{t('Live API', 'واجهة مباشرة')}</StatusBadge>
        </div>
        {p.activity.length === 0 ? (
          <p className="pf-note">
            {t('No audited operation has been recorded yet.', 'لم تُسجَّل أي عملية مدققة بعد.')}
          </p>
        ) : (
          <ActivityList
            items={p.activity.map((a) => ({
              title: `${a.operation}${a.tradingName ? ` · ${a.tradingName}` : ''}`,
              detail: `${a.actor} · ${a.reason}`,
              time: when(a.occurredAt, locale),
              tone: 'neutral' as const,
            }))}
          />
        )}
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function ClientFilePanel({
  session,
  locale,
  tenantId,
  onClose,
}: {
  session: ApiSession;
  locale: Locale;
  tenantId: string;
  onClose: () => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(
    session,
    (s) => readControlClientFile(s, tenantId),
    tenantId,
  );
  return (
    <section
      className="pf-panel pf-file"
      aria-label={t('Client file', 'ملف العميل')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="pf-section-head">
        <h2>{t('Client file', 'ملف العميل')}</h2>
        <button type="button" className="cc-button" onClick={onClose}>
          {t('Close file', 'إغلاق الملف')}
        </button>
      </div>
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <ClientFile file={state.data} locale={locale} />
      )}
    </section>
  );
}
function ClientFile({ file, locale }: { file: ControlClientFile; locale: Locale }) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const c = file.client;
  const s = file.subscription;
  return (
    <div className="pf-file-grid">
      <div className="pf-card">
        <h3>{c.tradingName}</h3>
        <dl className="pf-dl">
          <div>
            <dt>{t('Legal name', 'الاسم القانوني')}</dt>
            <dd>{c.legalName}</dd>
          </div>
          <div>
            <dt>{t('Workspace', 'مساحة العمل')}</dt>
            <dd>
              {c.tenantCode ?? c.tenantId}
              {c.tenantStatus ? ` · ${c.tenantStatus}` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('Registration', 'رقم التسجيل')}</dt>
            <dd>{c.registrationNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('Account owner', 'مالك الحساب')}</dt>
            <dd>{c.accountOwner ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('Since', 'منذ')}</dt>
            <dd>{when(c.createdAt, locale, false)}</dd>
          </div>
          {c.notes && (
            <div>
              <dt>{t('Notes', 'ملاحظات')}</dt>
              <dd>{c.notes}</dd>
            </div>
          )}
        </dl>
        <h4>{t('Contacts', 'جهات الاتصال')}</h4>
        {file.contacts.length === 0 ? (
          <p className="pf-note">{t('No contact recorded.', 'لا جهة اتصال مسجلة.')}</p>
        ) : (
          <ul className="pf-list">
            {file.contacts.map((k) => (
              <li key={k.id}>
                <strong>{k.name}</strong>
                <span>
                  {k.role}
                  {k.isPrimary ? ` · ${t('primary', 'رئيسي')}` : ''}
                  {k.email ? ` · ${k.email}` : ''}
                  {k.phone ? ` · ${k.phone}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pf-card">
        <h3>{t('Subscription', 'الاشتراك')}</h3>
        {!s ? (
          <p className="pf-note">{t('No package assigned yet.', 'لم تُسند باقة بعد.')}</p>
        ) : (
          <dl className="pf-dl">
            <div>
              <dt>{t('State', 'الحالة')}</dt>
              <dd>
                <StatusBadge tone={stateTone(s.state)}>{stateLabel(s.state, locale)}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt>{t('Package', 'الباقة')}</dt>
              <dd>
                {locale === 'ar' ? s.packageNameAr : s.packageName} · v{s.version} ·{' '}
                {money(s.priceMinor, s.currency, locale)}
              </dd>
            </div>
            <div>
              <dt>{t('Entitlements', 'الاستحقاقات')}</dt>
              <dd>{s.entitlements.join(', ')}</dd>
            </div>
            <div>
              <dt>{t('Period', 'الفترة')}</dt>
              <dd>
                {when(s.startsAt, locale, false)} →{' '}
                {s.endsAt ? when(s.endsAt, locale, false) : t('open-ended', 'مفتوح')}
              </dd>
            </div>
            <div>
              <dt>{t('Revision', 'المراجعة')}</dt>
              <dd>{s.revision}</dd>
            </div>
          </dl>
        )}
        <h4>{t('Transition requests', 'طلبات الانتقال')}</h4>
        {file.transitionRequests.length === 0 ? (
          <p className="pf-note">{t('None.', 'لا شيء.')}</p>
        ) : (
          <ul className="pf-list">
            {file.transitionRequests.map((r) => (
              <li key={r.id}>
                <strong>
                  {stateLabel(r.fromState, locale)} → {stateLabel(r.toState, locale)}
                </strong>
                <span>
                  {r.requestedBy} · {when(r.requestedAt, locale)} · {r.reason}
                </span>
                <StatusBadge
                  tone={
                    r.status === 'pending'
                      ? 'warning'
                      : r.status === 'executed'
                        ? 'positive'
                        : 'critical'
                  }
                >
                  {r.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
        <h4>{t('Service', 'الخدمة')}</h4>
        {!file.summary ? (
          <p className="pf-note">
            {t('This deployment has not reported yet.', 'لم يبلّغ هذا النشر بعد.')}
          </p>
        ) : (
          <dl className="pf-dl">
            <div>
              <dt>{t('Deployment', 'النشر')}</dt>
              <dd>
                {file.summary.deploymentHealth ?? '—'} · {file.summary.deploymentStage ?? '—'} ·{' '}
                {when(file.summary.deploymentUpdatedAt, locale)}
              </dd>
            </div>
            <div>
              <dt>{t('Support', 'الدعم')}</dt>
              <dd>
                {file.summary.supportStatus ?? '—'} · {file.summary.openTicketCount}{' '}
                {t('open', 'مفتوحة')}
              </dd>
            </div>
          </dl>
        )}
        {file.supportGrants.length > 0 && (
          <>
            <h4>{t('Support grants', 'منح الدعم')}</h4>
            <ul className="pf-list">
              {file.supportGrants.map((g) => (
                <li key={g.id}>
                  <strong>
                    {g.ticketId} · {g.status}
                  </strong>
                  <span>
                    {g.requester}
                    {g.approver ? ` → ${g.approver}` : ''} · {g.permissions.join(', ')} ·{' '}
                    {t('expires', 'تنتهي')} {when(g.expiresAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="pf-card pf-span">
        <h3>{t('Platform billing', 'فوترة المنصة')}</h3>
        <p className="pf-note">
          {t('Outstanding', 'المستحق')}:{' '}
          {file.outstanding.length === 0
            ? t('nothing', 'لا شيء')
            : file.outstanding
                .map((o) => `${money(o.amountMinor, o.currency, locale)} (${o.invoices})`)
                .join(' · ')}
        </p>
        <Table>
          <thead>
            <tr>
              <th>{t('Document', 'المستند')}</th>
              <th>{t('Kind', 'النوع')}</th>
              <th>{t('Amount', 'المبلغ')}</th>
              <th>{t('Allocated', 'المخصص')}</th>
              <th>{t('Due', 'الاستحقاق')}</th>
              <th>{t('Posted', 'رُحّل')}</th>
            </tr>
          </thead>
          <tbody>
            {file.invoices.map((i) => (
              <tr key={i.id} className={i.reversed || i.entryKind === 'reversal' ? 'is-muted' : ''}>
                <td>{i.invoiceNumber}</td>
                <td>
                  {t('Invoice', 'فاتورة')}
                  {i.entryKind === 'reversal' ? ` · ${t('reversal', 'عكس')}` : ''}
                </td>
                <td dir="ltr">{money(i.amountMinor, i.currency, locale)}</td>
                <td dir="ltr">{money(i.allocatedMinor, i.currency, locale)}</td>
                <td>{when(i.dueAt, locale, false)}</td>
                <td>{when(i.postedAt, locale)}</td>
              </tr>
            ))}
            {file.payments.map((p) => (
              <tr key={p.id} className={p.reversed || p.entryKind === 'reversal' ? 'is-muted' : ''}>
                <td>{p.receiptNumber}</td>
                <td>
                  {t('Payment', 'دفعة')}
                  {p.entryKind === 'reversal' ? ` · ${t('reversal', 'عكس')}` : ''}
                </td>
                <td dir="ltr">{money(p.amountMinor, p.currency, locale)}</td>
                <td dir="ltr">{money(p.allocatedMinor, p.currency, locale)}</td>
                <td>—</td>
                <td>{when(p.postedAt, locale)}</td>
              </tr>
            ))}
            {file.invoices.length + file.payments.length === 0 && (
              <tr>
                <td colSpan={6} className="pf-note">
                  {t(
                    'No platform document posted for this client.',
                    'لا مستند منصة مرحّل لهذا العميل.',
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
        <h4>{t('Audit trail', 'سجل التدقيق')}</h4>
        <ul className="pf-list pf-audit">
          {file.audit.map((a) => (
            <li key={a.id}>
              <strong>{a.operation}</strong>
              <span>
                {a.actor} · {a.reason} · {when(a.occurredAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function SubscriptionsPage({
  session,
  locale,
  onOpenClient,
  task = 'transition',
}: {
  session: ApiSession;
  locale: Locale;
  onOpenClient: (tenantId: string) => void;
  task?: ControlActionTask;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlSubscriptions, 'subscriptions');
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('SUBSCRIPTIONS', 'الاشتراكات')}
        title={t('Package assignments and their state', 'إسناد الباقات وحالتها')}
        description={t(
          'Restrictive transitions need a second, MFA-verified approver; nothing here touches subscriber service.',
          'الانتقالات المقيِّدة تحتاج معتمداً ثانياً بتحقق متعدد العوامل؛ لا شيء هنا يمس خدمة المشتركين.',
        )}
      />
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <Surface>
          {state.data.length === 0 ? (
            <p className="pf-note">
              {t('No subscription has been assigned yet.', 'لم يُسند أي اشتراك بعد.')}
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('Client', 'العميل')}</th>
                  <th>{t('State', 'الحالة')}</th>
                  <th>{t('Package', 'الباقة')}</th>
                  <th>{t('Price', 'السعر')}</th>
                  <th>{t('Period', 'الفترة')}</th>
                  <th>{t('Revision', 'المراجعة')}</th>
                  <th>{t('Pending request', 'طلب معلّق')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        type="button"
                        className="cc-link"
                        onClick={() => onOpenClient(s.tenantId)}
                      >
                        {s.tradingName}
                      </button>
                      <small>{s.legalName}</small>
                    </td>
                    <td>
                      <StatusBadge tone={stateTone(s.state)}>
                        {stateLabel(s.state, locale)}
                      </StatusBadge>
                    </td>
                    <td>
                      {locale === 'ar' ? s.packageNameAr : s.packageName}
                      <small>{s.packageKey}</small>
                    </td>
                    <td dir="ltr">{money(s.priceMinor, s.currency, locale)}</td>
                    <td>
                      {when(s.startsAt, locale, false)} →{' '}
                      {s.endsAt ? when(s.endsAt, locale, false) : t('open', 'مفتوح')}
                    </td>
                    <td>{s.revision}</td>
                    <td>
                      {s.pendingRequest
                        ? `${stateLabel(s.pendingRequest.toState, locale)} · ${s.pendingRequest.requestedBy}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Surface>
      )}
      <ControlActionWorkspace session={session} locale={locale} initialTask={task} />
    </div>
  );
}

export function PackagesPage({ session, locale }: { session: ApiSession; locale: Locale }) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlPackages, 'packages');
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('PACKAGES', 'الباقات')}
        title={t('Package versions and entitlements', 'نسخ الباقات والاستحقاقات')}
        description={t(
          'Versions are immutable; a new version carries the change and existing subscriptions keep theirs.',
          'النسخ ثابتة؛ تحمل النسخة الجديدة التغيير وتحتفظ الاشتراكات الحالية بنسختها.',
        )}
      />
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <Surface>
          {state.data.length === 0 ? (
            <p className="pf-note">
              {t('No package version exists yet.', 'لا توجد نسخة باقة بعد.')}
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('Package', 'الباقة')}</th>
                  <th>{t('Version', 'النسخة')}</th>
                  <th>{t('Price', 'السعر')}</th>
                  <th>{t('Entitlements', 'الاستحقاقات')}</th>
                  <th>{t('Effective', 'السريان')}</th>
                  <th>{t('Subscriptions', 'الاشتراكات')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((p) => (
                  <tr key={p.id} className={p.current ? '' : 'is-muted'}>
                    <td>
                      <strong>{locale === 'ar' ? p.nameAr : p.nameEn}</strong>
                      <small>{p.packageKey}</small>
                    </td>
                    <td>
                      v{p.version}
                      {p.current ? '' : ` · ${t('not current', 'غير سارية')}`}
                    </td>
                    <td dir="ltr">{money(p.priceMinor, p.currency, locale)}</td>
                    <td>{p.entitlements.join(', ')}</td>
                    <td>
                      {when(p.effectiveFrom, locale, false)}
                      {p.effectiveUntil ? ` → ${when(p.effectiveUntil, locale, false)}` : ''}
                    </td>
                    <td>
                      {p.activeSubscriptions} {t('active', 'نشط')} / {p.subscriptions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Surface>
      )}
      <ControlActionWorkspace session={session} locale={locale} initialTask="package" />
    </div>
  );
}

export function BillingPage({
  session,
  locale,
  onOpenClient,
}: {
  session: ApiSession;
  locale: Locale;
  onOpenClient: (tenantId: string) => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlBilling, 'billing');
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('PLATFORM BILLING', 'فوترة المنصة')}
        title={t('Invoices, receipts and allocations', 'الفواتير والإيصالات والتخصيصات')}
        description={t(
          'Posted documents are immutable; corrections are linked reversals. Balances are shown per currency and never combined.',
          'المستندات المرحّلة ثابتة؛ التصحيحات عكوس مرتبطة. تُعرض الأرصدة لكل عملة ولا تُجمع أبداً.',
        )}
      />
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <>
          <Surface>
            <div className="surface__header">
              <div>
                <h2>{t('Outstanding by client', 'المستحق حسب العميل')}</h2>
              </div>
            </div>
            {state.data.outstandingByClient.length === 0 ? (
              <p className="pf-note">
                {t(
                  'No client has an outstanding platform invoice.',
                  'لا عميل لديه فاتورة منصة مستحقة.',
                )}
              </p>
            ) : (
              <ul className="pf-list">
                {state.data.outstandingByClient.map((o) => (
                  <li key={o.tenantId}>
                    <button
                      type="button"
                      className="cc-link"
                      onClick={() => onOpenClient(o.tenantId)}
                    >
                      {o.tradingName}
                    </button>
                    <span dir="ltr">
                      {o.outstanding
                        .map((x) => `${money(x.amountMinor, x.currency, locale)} (${x.invoices})`)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          <Surface>
            <div className="surface__header">
              <div>
                <h2>{t('Ledger', 'الدفتر')}</h2>
                <p>{t('Latest 200 invoices and receipts.', 'آخر ٢٠٠ فاتورة وإيصال.')}</p>
              </div>
            </div>
            <Table>
              <thead>
                <tr>
                  <th>{t('Client', 'العميل')}</th>
                  <th>{t('Document', 'المستند')}</th>
                  <th>{t('Amount', 'المبلغ')}</th>
                  <th>{t('Allocated', 'المخصص')}</th>
                  <th>{t('Posted', 'رُحّل')}</th>
                  <th>{t('By', 'بواسطة')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.invoices.map((i) => (
                  <tr
                    key={`i-${i.id}`}
                    className={i.reversed || i.entryKind === 'reversal' ? 'is-muted' : ''}
                  >
                    <td>{i.tradingName}</td>
                    <td>
                      {i.invoiceNumber} · {t('invoice', 'فاتورة')}
                      {i.entryKind === 'reversal' ? ` · ${t('reversal', 'عكس')}` : ''}
                    </td>
                    <td dir="ltr">{money(i.amountMinor, i.currency, locale)}</td>
                    <td dir="ltr">{money(i.allocatedMinor, i.currency, locale)}</td>
                    <td>{when(i.postedAt, locale)}</td>
                    <td>{i.actor}</td>
                  </tr>
                ))}
                {state.data.payments.map((p) => (
                  <tr
                    key={`p-${p.id}`}
                    className={p.reversed || p.entryKind === 'reversal' ? 'is-muted' : ''}
                  >
                    <td>{p.tradingName}</td>
                    <td>
                      {p.receiptNumber} · {t('receipt', 'إيصال')}
                      {p.entryKind === 'reversal' ? ` · ${t('reversal', 'عكس')}` : ''}
                    </td>
                    <td dir="ltr">{money(p.amountMinor, p.currency, locale)}</td>
                    <td dir="ltr">{money(p.allocatedMinor, p.currency, locale)}</td>
                    <td>{when(p.postedAt, locale)}</td>
                    <td>{p.actor}</td>
                  </tr>
                ))}
                {state.data.invoices.length + state.data.payments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pf-note">
                      {t('Nothing posted yet.', 'لا شيء مرحّل بعد.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Surface>
        </>
      )}
      <ControlActionWorkspace session={session} locale={locale} initialTask="invoice" />
    </div>
  );
}

export function SalesPipelinePage({
  session,
  locale,
  onOpenClient,
  onAddClient,
}: {
  session: ApiSession;
  locale: Locale;
  onOpenClient: (tenantId: string) => void;
  onAddClient: () => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlSubscriptions, 'pipeline');
  const [portfolio] = useControlRead(session, readControlPortfolio, 'pipeline-portfolio');
  const leads =
    portfolio.status === 'ready'
      ? (portfolio.data.clients.byState.find((s) => s.state === 'lead')?.count ?? 0)
      : 0;
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('SALES PIPELINE', 'مسار المبيعات')}
        title={t('From lead to active client', 'من مهتم إلى عميل نشط')}
        description={t(
          'Onboard the company, assign a package version, then move the subscription through trial to active. Every step is audited.',
          'أضف الشركة، وأسند نسخة باقة، ثم انقل الاشتراك من التجربة إلى النشاط. كل خطوة مدققة.',
        )}
      />
      <div className="kpi-grid">
        <KpiCard
          label={t('Leads without a package', 'مهتمون بلا باقة')}
          value={String(leads)}
          detail={t('Clients created without a subscription', 'عملاء أُنشئوا دون اشتراك')}
          tone="primary"
          targetLabel={t('Add ISP client', 'إضافة شركة إنترنت')}
          onOpen={onAddClient}
        />
        <Stat
          label={t('In trial', 'في التجربة')}
          value={String(
            state.status === 'ready' ? state.data.filter((s) => s.state === 'trial').length : 0,
          )}
          detail={t('Trial subscriptions to convert', 'اشتراكات تجريبية للتحويل')}
          tone="warning"
        />
        <Stat
          label={t('In grace', 'في المهلة')}
          value={String(
            state.status === 'ready' ? state.data.filter((s) => s.state === 'grace').length : 0,
          )}
          detail={t('Renewals to close', 'تجديدات لإغلاقها')}
          tone="critical"
        />
      </div>
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{t('Open pipeline', 'المسار المفتوح')}</h2>
              <p>
                {t(
                  'Trial and grace subscriptions, soonest end first.',
                  'اشتراكات التجربة والمهلة، الأقرب انتهاءً أولاً.',
                )}
              </p>
            </div>
          </div>
          {state.data.filter((s) => s.state === 'trial' || s.state === 'grace').length === 0 ? (
            <p className="pf-note">{t('The pipeline is empty.', 'المسار فارغ.')}</p>
          ) : (
            <ul className="pf-list">
              {state.data
                .filter((s) => s.state === 'trial' || s.state === 'grace')
                .map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="cc-link"
                      onClick={() => onOpenClient(s.tenantId)}
                    >
                      {s.tradingName}
                    </button>
                    <span>
                      {s.packageKey} · {money(s.priceMinor, s.currency, locale)} ·{' '}
                      {s.endsAt
                        ? `${t('ends', 'ينتهي')} ${when(s.endsAt, locale, false)}`
                        : t('open-ended', 'مفتوح')}
                    </span>
                    <StatusBadge tone={stateTone(s.state)}>
                      {stateLabel(s.state, locale)}
                    </StatusBadge>
                  </li>
                ))}
            </ul>
          )}
        </Surface>
      )}
      <ControlActionWorkspace session={session} locale={locale} initialTask="assignment" />
    </div>
  );
}

export function DeploymentsPage({
  session,
  locale,
  onOpenClient,
  clients,
}: {
  session: ApiSession;
  locale: Locale;
  onOpenClient: (tenantId: string) => void;
  clients: readonly {
    id: string;
    tradingName: string;
    deploymentHealth: string;
    supportStatus: string;
    openTicketCount: number;
    state: string;
  }[];
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlPortfolio, 'deployments');
  const health = (v: string) =>
    ({
      healthy: t('Healthy', 'سليم'),
      attention: t('Attention', 'يحتاج متابعة'),
      blocked: t('Blocked', 'محظور'),
      unknown: t('Not reporting', 'لا يبلّغ'),
    })[v] ?? v;
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('DEPLOYMENTS', 'عمليات النشر')}
        title={t('Deployment health per ISP workspace', 'صحة النشر لكل مساحة عمل')}
        description={t(
          "Health, stage and last report come from each deployment's service summary. A workspace that has never reported shows as not reporting.",
          'تأتي الصحة والمرحلة وآخر تقرير من ملخص خدمة كل نشر. المساحة التي لم تبلّغ قط تظهر كأنها لا تبلّغ.',
        )}
      />
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <div className="kpi-grid">
          <Stat
            label={t('Healthy', 'سليمة')}
            value={String(state.data.service.healthy)}
            detail={t('Reported healthy', 'أبلغت أنها سليمة')}
            tone="positive"
          />
          <Stat
            label={t('Attention', 'تحتاج متابعة')}
            value={String(state.data.service.attention)}
            detail={t('SSL, backup or job health', 'الشهادة أو النسخ الاحتياطي أو المهام')}
            tone="warning"
          />
          <Stat
            label={t('Blocked', 'محظورة')}
            value={String(state.data.service.blocked)}
            detail={t('Needs an operator now', 'تحتاج مشغّلاً الآن')}
            tone="critical"
          />
          <Stat
            label={t('Not reporting', 'لا تبلّغ')}
            value={String(state.data.service.unknown)}
            detail={t('No service summary yet', 'لا ملخص خدمة بعد')}
            tone="neutral"
          />
        </div>
      )}
      <Surface>
        {clients.length === 0 ? (
          <p className="pf-note">{t('No ISP client yet.', 'لا شركة إنترنت بعد.')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t('Client', 'العميل')}</th>
                <th>{t('Contract', 'العقد')}</th>
                <th>{t('Deployment', 'النشر')}</th>
                <th>{t('Support', 'الدعم')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="cc-link" onClick={() => onOpenClient(c.id)}>
                      {c.tradingName}
                    </button>
                  </td>
                  <td>
                    <StatusBadge tone={stateTone(c.state)}>
                      {stateLabel(c.state, locale)}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge
                      tone={
                        c.deploymentHealth === 'healthy'
                          ? 'positive'
                          : c.deploymentHealth === 'attention'
                            ? 'warning'
                            : c.deploymentHealth === 'blocked'
                              ? 'critical'
                              : 'neutral'
                      }
                    >
                      {health(c.deploymentHealth)}
                    </StatusBadge>
                  </td>
                  <td>
                    {c.openTicketCount} {t('open', 'مفتوحة')} · {c.supportStatus}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Surface>
    </div>
  );
}

export function SupportPage({
  session,
  locale,
  onOpenClient,
  clients,
}: {
  session: ApiSession;
  locale: Locale;
  onOpenClient: (tenantId: string) => void;
  clients: readonly {
    id: string;
    tradingName: string;
    supportStatus: string;
    openTicketCount: number;
  }[];
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, readControlPortfolio, 'support');
  const rows = clients.filter((c) => c.openTicketCount > 0 || c.supportStatus === 'escalated');
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('SUPPORT CENTER', 'مركز الدعم')}
        title={t('Client support status and scoped access', 'حالة دعم العملاء والوصول المقيّد')}
        description={t(
          'Platform staff never hold implicit tenant access; support work happens through time-boxed, approved, audited grants requested from the workspace.',
          'لا يملك موظفو المنصة وصولاً ضمنياً إلى المساحات؛ يتم الدعم عبر منح محدودة زمنياً ومعتمدة ومدققة تُطلب من المساحة.',
        )}
      />
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <div className="kpi-grid">
          <Stat
            label={t('Open tickets', 'تذاكر مفتوحة')}
            value={String(state.data.service.openTickets)}
            detail={`${state.data.service.escalated} ${t('escalated clients', 'عملاء مصعّدون')}`}
            tone={state.data.service.escalated ? 'critical' : 'positive'}
          />
          <Stat
            label={t('Active support grants', 'منح دعم نشطة')}
            value={String(state.data.service.activeSupportGrants)}
            detail={t('Approved and not yet expired', 'معتمدة ولم تنته بعد')}
            tone="primary"
          />
          <Stat
            label={t('Requested grants', 'منح مطلوبة')}
            value={String(state.data.service.requestedSupportGrants)}
            detail={t('Awaiting an approver', 'بانتظار معتمد')}
            tone={state.data.service.requestedSupportGrants ? 'warning' : 'positive'}
          />
        </div>
      )}
      <Surface>
        {rows.length === 0 ? (
          <p className="pf-note">
            {t(
              'No client has open or escalated support work.',
              'لا عميل لديه عمل دعم مفتوح أو مصعّد.',
            )}
          </p>
        ) : (
          <ul className="pf-list">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" className="cc-link" onClick={() => onOpenClient(c.id)}>
                  {c.tradingName}
                </button>
                <span>
                  {c.openTicketCount} {t('open tickets', 'تذاكر مفتوحة')}
                </span>
                <StatusBadge tone={c.supportStatus === 'escalated' ? 'critical' : 'warning'}>
                  {c.supportStatus}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

export function ReportsPage({ session, locale }: { session: ApiSession; locale: Locale }) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [state, retry] = useControlRead(session, (s) => readControlAudit(s), 'audit');
  const [subscriptions] = useControlRead(session, readControlSubscriptions, 'audit-subscriptions');
  const [notice, setNotice] = useState('');
  const download = (rows: readonly Record<string, unknown>[], name: string) => {
    const first = rows[0];
    const columns = first ? Object.keys(first) : [];
    const cell = (v: unknown) => {
      const text =
        v === null || v === undefined
          ? ''
          : typeof v === 'string'
            ? v
            : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint'
              ? String(v)
              : JSON.stringify(v);
      return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
    };
    const csv =
      [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join(
        '\r\n',
      ) + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`${name} (${rows.length} ${t('rows', 'صف')})`);
  };
  return (
    <div className="pf-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={t('REPORTS & AUDIT', 'التقارير والتدقيق')}
        title={t(
          'What left the control plane, and who did what',
          'ما خرج من طبقة التحكم ومن فعل ماذا',
        )}
        description={t(
          'Exports are rendered from the same reads the pages use. The audit trail is append-only.',
          'تُنشأ الصادرات من القراءات نفسها التي تستخدمها الصفحات. سجل التدقيق يُضاف إليه فقط.',
        )}
      />
      <Surface>
        <div className="surface__header">
          <div>
            <h2>{t('Exports', 'الصادرات')}</h2>
          </div>
        </div>
        <div className="pf-actions">
          <button
            type="button"
            className="cc-button"
            disabled={subscriptions.status !== 'ready'}
            onClick={() =>
              subscriptions.status === 'ready' &&
              download(
                subscriptions.data as unknown as Record<string, unknown>[],
                'subscriptions.csv',
              )
            }
          >
            {t('Subscriptions CSV', 'الاشتراكات CSV')}
          </button>
          <button
            type="button"
            className="cc-button"
            disabled={state.status !== 'ready'}
            onClick={() =>
              state.status === 'ready' &&
              download(state.data as unknown as Record<string, unknown>[], 'control-audit.csv')
            }
          >
            {t('Audit trail CSV', 'سجل التدقيق CSV')}
          </button>
          {notice && <span role="status">{notice}</span>}
        </div>
      </Surface>
      {state.status !== 'ready' ? (
        <Pending
          locale={locale}
          state={state.status}
          retry={retry}
          denied={state.status === 'error' && state.denied}
        />
      ) : (
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{t('Audit trail', 'سجل التدقيق')}</h2>
              <p>{t('Latest 100 control-plane operations.', 'آخر ١٠٠ عملية في طبقة التحكم.')}</p>
            </div>
          </div>
          {state.data.length === 0 ? (
            <p className="pf-note">{t('No operation recorded yet.', 'لم تُسجَّل أي عملية بعد.')}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('When', 'متى')}</th>
                  <th>{t('Operation', 'العملية')}</th>
                  <th>{t('Client', 'العميل')}</th>
                  <th>{t('Actor', 'الفاعل')}</th>
                  <th>{t('Permission', 'الصلاحية')}</th>
                  <th>{t('Reason', 'السبب')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((a: ControlAuditRow) => (
                  <tr key={a.id}>
                    <td>{when(a.occurredAt, locale)}</td>
                    <td>
                      {a.operation}
                      <small>
                        {a.entityType} · {a.entityId}
                      </small>
                    </td>
                    <td>{a.tradingName ?? '—'}</td>
                    <td>{a.actor}</td>
                    <td>{a.permission}</td>
                    <td>{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Surface>
      )}
    </div>
  );
}

export type {
  ControlBillingLedger,
  ControlPackageVersion,
  ControlPortfolio,
  ControlSubscriptionRow,
};
