import { useEffect, useState } from 'react';
import {
  ActivityList,
  AppShell,
  Button,
  DrilldownPanel,
  KpiCard,
  LocaleSwitcher,
  MoneyPair,
  PageHeader,
  QuickAction,
  SectionHeading,
  SegmentedControl,
  StatePanel,
  StatusBadge,
  SupportSessionBanner,
  Surface,
  TaskRouteView,
  useHashNavigation,
  type Locale,
  type ApiSession,
  type StateVariant,
} from '@isp/ui';
import { tenantCopy } from './copy';
import {
  operationPath,
  OperationsWorkspace,
  type OperationsTask,
} from './operations/OperationsWorkspace';
import { tenantRoutes } from './routes';
import { readTenantSummary, submitTenantOperation, type TenantSummary } from './api';
import { StaffWorkspace } from './staff/StaffWorkspace';
import { SalesWorkspace } from './sales/SalesWorkspace';
import { SubscriberWorkspace } from './subscribers/SubscriberWorkspace';
import { BillingWorkspace } from './billing/BillingWorkspace';
import { NocWorkspace } from './noc/NocWorkspace';
import { AccountingWorkspace } from './billing/AccountingWorkspace';

const tenantNavigationIds = tenantCopy.en.navigation.map((item) => item.id);
export const tenantOperationsTasks: Readonly<Record<string, OperationsTask>> = {
  subscribers: 'subscriber',
  billing: 'billing',
  payments: 'office-payment',
  collectors: 'collectors',
  installations: 'installation',
  network: 'network',
  support: 'support',
  reports: 'reports',
  configuration: 'configuration',
};

export function App({ session }: { readonly session?: ApiSession } = {}) {
  const [locale, setLocale] = useState<Locale>('en');
  const { activeId: activeNavigationId, navigate: navigateRoute } = useHashNavigation(
    tenantNavigationIds,
    'dashboard',
  );
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const [stateVariant, setStateVariant] = useState<StateVariant>('loading');
  const [supportSessionActive, setSupportSessionActive] = useState(false);
  const [summary, setSummary] = useState<TenantSummary>();
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>(
    session ? 'loading' : 'ready',
  );
  const copy = tenantCopy[locale];
  const drilldown = drilldownId ? copy.drilldowns[drilldownId] : undefined;
  useEffect(() => {
    if (!session) return;
    let active = true;
    void readTenantSummary(session)
      .then((value) => {
        if (!active) return;
        setSummary(value);
        setSummaryState('ready');
      })
      .catch(() => active && setSummaryState('error'));
    return () => {
      active = false;
    };
  }, [session]);
  const kpis = session
    ? copy.kpis.map((kpi) => {
        if (kpi.id === 'collections') {
          return {
            ...kpi,
            value: {
              usd: summary ? formatMinor(summary.collections.USD, 'USD', locale) : '—',
              lbp: summary ? formatMinor(summary.collections.LBP, 'LBP', locale) : '—',
            },
            detail: summary
              ? `${locale === 'en' ? 'As of' : 'حتى'} ${new Date(summary.asOf).toLocaleString(locale === 'en' ? 'en-LB' : 'ar-LB')}`
              : '—',
            trend: '',
            trendLabel: '',
          };
        }
        if (kpi.id === 'online') {
          return {
            ...kpi,
            value: summary ? String(summary.onlineSubscribers) : '—',
            detail: summary
              ? locale === 'en'
                ? `${summary.activeSubscribers} active subscribers`
                : `${summary.activeSubscribers} مشتركاً نشطاً`
              : '—',
            trend: summary?.activeSubscribers
              ? `${((summary.onlineSubscribers / summary.activeSubscribers) * 100).toFixed(1)}%`
              : '—',
            trendLabel: locale === 'en' ? 'currently online' : 'متصلون حالياً',
          };
        }
        return {
          ...kpi,
          value: '—',
          detail: locale === 'en' ? 'Projection not available' : 'لا تتوفر قراءة حالية',
          trend: '',
          trendLabel: '',
        };
      })
    : copy.kpis;

  const navigate = (id: string) => {
    navigateRoute(id);
    setDrilldownId(null);
  };

  return (
    <AppShell
      locale={locale}
      brandLabel={copy.brandLabel}
      productName={copy.productName}
      navLabel={copy.navLabel}
      menuLabel={copy.menuLabel}
      closeMenuLabel={copy.closeMenuLabel}
      skipLabel={copy.skipLabel}
      navigation={copy.navigation}
      activeNavigationId={activeNavigationId}
      onNavigate={navigate}
      context={{
        eyebrow: session ? 'ISP workspace · Authenticated' : copy.contextEyebrow,
        title: session
          ? locale === 'en'
            ? 'Authenticated ISP workspace'
            : 'مساحة عمل مزوّد الإنترنت'
          : copy.contextTitle,
        meta: session
          ? `${locale === 'en' ? 'Workspace' : 'مساحة'} …${session.tenantId?.slice(-8) ?? ''} · Asia/Beirut`
          : copy.contextMeta,
      }}
      contextAction={<StatusBadge tone="positive">{copy.branchStatus}</StatusBadge>}
      commandLabel={copy.searchLabel}
      toolbar={
        <>
          <LocaleSwitcher
            locale={locale}
            onChange={setLocale}
            englishLabel={copy.englishLabel}
            arabicLabel={copy.arabicLabel}
            groupLabel={copy.languageLabel}
          />
          <button
            type="button"
            className="user-chip"
            aria-label={session ? (locale === 'en' ? 'Sign out' : 'تسجيل الخروج') : copy.userLabel}
            onClick={session?.logout}
          >
            <span aria-hidden="true">ISP</span>
          </button>
        </>
      }
      supportBanner={
        supportSessionActive ? (
          <SupportSessionBanner {...copy.support} onEnd={() => setSupportSessionActive(false)} />
        ) : undefined
      }
    >
      {activeNavigationId === 'dashboard' ? (
        <>
          <PageHeader
            eyebrow={copy.pageEyebrow}
            title={copy.pageTitle}
            description={copy.pageDescription}
            actions={
              <>
                <Button variant="secondary" onClick={() => navigate('subscribers')}>
                  {copy.addSubscriber}
                </Button>
                <Button variant="primary" onClick={() => navigate('payments')}>
                  {copy.recordPayment}
                </Button>
              </>
            }
          />

          <SectionHeading title={copy.sectionToday} description={copy.sectionTodayDescription} />
          <div className="kpi-grid">
            {kpis.map((kpi) => (
              <KpiCard
                key={kpi.id}
                label={kpi.label}
                value={
                  typeof kpi.value === 'string' ? (
                    kpi.value
                  ) : (
                    <MoneyPair usd={kpi.value.usd} lbp={kpi.value.lbp} />
                  )
                }
                detail={kpi.detail}
                trend={kpi.trend}
                trendLabel={kpi.trendLabel}
                tone={kpi.tone}
                targetLabel={copy.drilldownTarget}
                onOpen={() => setDrilldownId(kpi.id)}
              />
            ))}
          </div>

          {drilldown && (
            <DrilldownPanel
              title={drilldown.title}
              filterLabel={copy.filteredBy}
              items={drilldown.items}
              closeLabel={copy.closeDrilldown}
              onClose={() => setDrilldownId(null)}
            />
          )}

          {session && summaryState !== 'ready' ? (
            <StatePanel
              variant={summaryState === 'loading' ? 'loading' : 'error'}
              title={
                summaryState === 'loading'
                  ? locale === 'en'
                    ? 'Loading authorized data'
                    : 'جارٍ تحميل البيانات المصرح بها'
                  : locale === 'en'
                    ? 'Data unavailable'
                    : 'البيانات غير متاحة'
              }
              description={
                summaryState === 'loading'
                  ? locale === 'en'
                    ? 'The tenant summary is being read from the API.'
                    : 'جارٍ قراءة ملخص مساحة العمل من الواجهة.'
                  : locale === 'en'
                    ? 'The authenticated tenant summary could not be loaded.'
                    : 'تعذّر تحميل ملخص مساحة العمل المصرح به.'
              }
              actionLabel={summaryState === 'error' ? 'Retry' : undefined}
              onAction={() => {
                if (!session) return;
                setSummaryState('loading');
                void readTenantSummary(session)
                  .then((value) => {
                    setSummary(value);
                    setSummaryState('ready');
                  })
                  .catch(() => setSummaryState('error'));
              }}
            />
          ) : null}

          {session && summaryState === 'ready' && summary ? (
            <div className="content-grid dashboard-block">
              <Surface className="live-summary">
                <div className="surface__header">
                  <div>
                    <h2>{locale === 'en' ? 'Live workspace pulse' : 'نبض مساحة العمل المباشر'}</h2>
                    <p>
                      {locale === 'en'
                        ? 'Current permission-scoped API snapshot'
                        : 'لقطة حالية مقيّدة بالصلاحيات'}
                    </p>
                  </div>
                  <StatusBadge tone="positive">
                    {locale === 'en' ? 'Connected' : 'متصل'}
                  </StatusBadge>
                </div>
                <dl className="live-summary__facts">
                  <div>
                    <dt>{locale === 'en' ? 'Active subscribers' : 'المشتركون النشطون'}</dt>
                    <dd>{summary.activeSubscribers}</dd>
                  </div>
                  <div>
                    <dt>{locale === 'en' ? 'Online now' : 'متصلون الآن'}</dt>
                    <dd>{summary.onlineSubscribers}</dd>
                  </div>
                  <div>
                    <dt>{locale === 'en' ? 'Last snapshot' : 'آخر لقطة'}</dt>
                    <dd>
                      {new Date(summary.asOf).toLocaleTimeString(
                        locale === 'en' ? 'en-LB' : 'ar-LB',
                      )}
                    </dd>
                  </div>
                </dl>
              </Surface>
              <Surface>
                <div className="surface__header">
                  <div>
                    <h2>{copy.actionsTitle}</h2>
                    <p>{copy.actionsDescription}</p>
                  </div>
                </div>
                <div className="quick-actions">
                  {copy.quickActions.map((action) => (
                    <QuickAction key={action.id} {...action} onClick={() => navigate(action.id)} />
                  ))}
                </div>
              </Surface>
            </div>
          ) : null}

          {!session ? (
            <div className="content-grid dashboard-block">
              <Surface>
                <div className="surface__header">
                  <div>
                    <h2>{copy.collectionTitle}</h2>
                    <p>{copy.collectionDescription}</p>
                  </div>
                </div>
                <div className="collection-ledger">
                  {copy.collectionRows.map((row) => (
                    <div className="collection-row" key={row.label}>
                      <span>{row.label}</span>
                      <strong dir="ltr">{row.amount}</strong>
                      <div
                        className={`collection-track collection-track--${row.tone}`}
                        aria-hidden="true"
                      >
                        <span style={{ inlineSize: row.progress }} />
                      </div>
                      <small>{row.progress}</small>
                    </div>
                  ))}
                </div>
              </Surface>
              <Surface>
                <div className="surface__header">
                  <div>
                    <h2>{copy.actionsTitle}</h2>
                    <p>{copy.actionsDescription}</p>
                  </div>
                </div>
                <div className="quick-actions">
                  {copy.quickActions.map((action) => (
                    <QuickAction key={action.id} {...action} onClick={() => navigate(action.id)} />
                  ))}
                </div>
              </Surface>
            </div>
          ) : null}

          {!session ? (
            <Surface className="dashboard-block">
              <div className="surface__header">
                <div>
                  <h2>{copy.operationsTitle}</h2>
                  <p>{copy.operationsDescription}</p>
                </div>
                <StatusBadge tone="neutral">{copy.dataStatus}</StatusBadge>
              </div>
              <ActivityList items={copy.activities} />
            </Surface>
          ) : null}

          {!session ? (
            <>
              <SectionHeading title={copy.statesTitle} description={copy.statesDescription} />
              <div className="state-showcase">
                <StatePanel
                  variant={stateVariant}
                  title={copy.states[stateVariant].title}
                  description={copy.states[stateVariant].description}
                  actionLabel={
                    stateVariant === 'loading' ? undefined : copy.states[stateVariant].action
                  }
                  onAction={() => setStateVariant('loading')}
                />
                <SegmentedControl
                  label={copy.statesLabel}
                  value={stateVariant}
                  onChange={(value) => setStateVariant(value as StateVariant)}
                  options={(Object.keys(copy.states) as StateVariant[]).map((value) => ({
                    value,
                    label: copy.states[value].label,
                  }))}
                />
              </div>
            </>
          ) : null}
        </>
      ) : activeNavigationId === 'staff' && session ? (
        <StaffWorkspace locale={locale} session={session} />
      ) : activeNavigationId === 'sales' && session ? (
        <SalesWorkspace locale={locale} session={session} />
      ) : activeNavigationId === 'subscribers' && session ? (
        <SubscriberWorkspace locale={locale} session={session} onNavigate={navigate} />
      ) : activeNavigationId === 'billing' && session ? (
        <BillingWorkspace locale={locale} session={session} />
      ) : activeNavigationId === 'noc' ? (
        <NocWorkspace locale={locale} session={session} key={session?.tenantId ?? 'signed-out'} />
      ) : activeNavigationId === 'accounting' ? (
        <AccountingWorkspace locale={locale} session={session} />
      ) : activeNavigationId === 'sales' ? (
        <StatePanel
          variant="empty"
          title={locale === 'en' ? 'Sign in to open Sales' : 'سجّل الدخول لفتح المبيعات'}
          description={
            locale === 'en'
              ? 'The governed pipeline is available only inside an authenticated tenant session.'
              : 'مسار المبيعات المحكوم متاح فقط ضمن جلسة مستأجر موثقة.'
          }
        />
      ) : tenantOperationsTasks[activeNavigationId] ? (
        <OperationsWorkspace
          locale={locale}
          initialTask={tenantOperationsTasks[activeNavigationId]}
          state="empty"
          onSubmit={
            session
              ? (task, payload, idempotencyKey) =>
                  submitTenantOperation(session, operationPath(task), payload, idempotencyKey)
              : undefined
          }
        />
      ) : (
        <TaskRouteView
          route={tenantRoutes[locale][activeNavigationId]}
          dataSourceLabel={session ? 'Authenticated API' : copy.dataStatus}
          onNavigate={navigate}
        />
      )}
    </AppShell>
  );
}

function formatMinor(amount: number, currency: 'USD' | 'LBP', locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-LB' : 'ar-LB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  }).format(amount / 100);
}
