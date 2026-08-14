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
import { OperationsWorkspace, type OperationsTask } from './operations/OperationsWorkspace';
import { tenantRoutes } from './routes';
import { readTenantSummary, type TenantSummary } from './api';

const tenantNavigationIds = tenantCopy.en.navigation.map((item) => item.id);
export const tenantOperationsTasks: Readonly<Record<string, OperationsTask>> = {
  subscribers: 'subscriber',
  billing: 'billing',
  payments: 'office-payment',
  collectors: 'collectors',
  installations: 'installation',
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
              usd: summary ? `${summary.collections.USD} minor` : '—',
              lbp: summary ? `${summary.collections.LBP} minor` : '—',
            },
            detail: summary ? `As of ${new Date(summary.asOf).toLocaleString(locale)}` : '—',
            trend: '',
            trendLabel: '',
          };
        }
        if (kpi.id === 'online') {
          return {
            ...kpi,
            value: summary ? String(summary.onlineSubscribers) : '—',
            detail: summary ? `${summary.activeSubscribers} active subscribers` : '—',
            trend: summary?.activeSubscribers
              ? `${((summary.onlineSubscribers / summary.activeSubscribers) * 100).toFixed(1)}%`
              : '—',
            trendLabel: 'currently online',
          };
        }
        return {
          ...kpi,
          value: '—',
          detail: 'Projection not available',
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
        title: session?.tenantId ?? copy.contextTitle,
        meta: session ? 'Permission-scoped API data · Asia/Beirut' : copy.contextMeta,
      }}
      contextAction={<StatusBadge tone="positive">{copy.branchStatus}</StatusBadge>}
      toolbar={
        <>
          <button type="button" className="header-icon-button" aria-label={copy.searchLabel}>
            ⌕
          </button>
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
            aria-label={copy.userLabel}
            onClick={session?.logout}
          >
            <span aria-hidden="true">RK</span>
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
              title={summaryState === 'loading' ? 'Loading authorized data' : 'Data unavailable'}
              description={
                summaryState === 'loading'
                  ? 'The tenant summary is being read from the API.'
                  : 'The authenticated tenant summary could not be loaded.'
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
      ) : tenantOperationsTasks[activeNavigationId] ? (
        <OperationsWorkspace
          locale={locale}
          initialTask={tenantOperationsTasks[activeNavigationId]}
          state="empty"
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
