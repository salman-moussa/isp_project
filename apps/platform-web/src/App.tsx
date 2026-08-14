import { useEffect, useState } from 'react';
import {
  ActivityList,
  AppShell,
  Button,
  DrilldownPanel,
  KpiCard,
  LocaleSwitcher,
  PageHeader,
  QuickAction,
  SectionHeading,
  SegmentedControl,
  StatePanel,
  StatusBadge,
  Surface,
  TaskRouteView,
  useHashNavigation,
  type Locale,
  type ApiSession,
  type StateVariant,
} from '@isp/ui';
import { platformCopy } from './copy';
import { platformRoutes } from './routes';
import {
  ControlCenterWorkspace,
  type ControlCenterClientRow,
  type ControlCenterFilters,
} from './control-center/ControlCenterWorkspace';
import { readControlClients } from './api';

const platformNavigationIds = platformCopy.en.navigation.map((item) => item.id);
const demonstrationClients: readonly ControlCenterClientRow[] = [
  {
    id: 'northline-demo',
    tradingName: 'Northline ISP (demo)',
    legalName: 'Northline Internet Services SAL',
    state: 'active',
    packageName: 'Scale',
    deploymentHealth: 'healthy',
    supportStatus: 'clear',
    openTicketCount: 0,
  },
  {
    id: 'metn-demo',
    tradingName: 'Metn Fiber (demo)',
    legalName: 'Metn Fiber Networks SARL',
    state: 'trial',
    packageName: 'Growth',
    deploymentHealth: 'attention',
    supportStatus: 'open',
    openTicketCount: 2,
  },
  {
    id: 'chouf-demo',
    tradingName: 'Chouf Connect (demo)',
    legalName: 'Chouf Connect SARL',
    state: 'grace',
    packageName: 'Starter',
    deploymentHealth: 'blocked',
    supportStatus: 'escalated',
    openTicketCount: 1,
  },
];

export function App({ session }: { readonly session?: ApiSession } = {}) {
  const [locale, setLocale] = useState<Locale>('en');
  const { activeId: activeNavigationId, navigate: navigateRoute } = useHashNavigation(
    platformNavigationIds,
    'overview',
  );
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const [stateVariant, setStateVariant] = useState<StateVariant>('loading');
  const [controlFilters, setControlFilters] = useState<ControlCenterFilters>({
    query: '',
    state: '',
    deploymentHealth: '',
    supportStatus: '',
  });
  const [controlClients, setControlClients] = useState<readonly ControlCenterClientRow[]>(
    session ? [] : demonstrationClients,
  );
  const [controlState, setControlState] = useState<'loading' | 'ready' | 'empty' | 'error'>(
    session ? 'loading' : 'ready',
  );
  const copy = platformCopy[locale];
  const drilldown = drilldownId ? copy.drilldowns[drilldownId] : undefined;
  useEffect(() => {
    if (!session) return;
    let active = true;
    setControlState('loading');
    void readControlClients(session)
      .then((clients) => {
        if (!active) return;
        setControlClients(clients);
        setControlState(clients.length ? 'ready' : 'empty');
      })
      .catch(() => active && setControlState('error'));
    return () => {
      active = false;
    };
  }, [session]);
  const filteredControlClients = controlClients.filter((client) => {
    const query = controlFilters.query.trim().toLocaleLowerCase(locale);
    return (
      (!query ||
        client.legalName.toLocaleLowerCase(locale).includes(query) ||
        client.tradingName.toLocaleLowerCase(locale).includes(query)) &&
      (!controlFilters.state || client.state === controlFilters.state) &&
      (!controlFilters.deploymentHealth ||
        client.deploymentHealth === controlFilters.deploymentHealth) &&
      (!controlFilters.supportStatus || client.supportStatus === controlFilters.supportStatus)
    );
  });

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
      context={{ eyebrow: copy.contextEyebrow, title: copy.contextTitle, meta: copy.contextMeta }}
      contextAction={<StatusBadge tone="positive">{copy.operatorStatus}</StatusBadge>}
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
            <span aria-hidden="true">MH</span>
          </button>
        </>
      }
    >
      {activeNavigationId === 'overview' ? (
        <>
          <PageHeader
            eyebrow={copy.pageEyebrow}
            title={copy.pageTitle}
            description={copy.pageDescription}
            actions={
              <>
                <Button variant="secondary" onClick={() => navigate('billing')}>
                  {copy.recordPayment}
                </Button>
                <Button variant="primary" onClick={() => navigate('clients')}>
                  {copy.addClient}
                </Button>
              </>
            }
          />

          <SectionHeading
            title={copy.sectionPortfolio}
            description={copy.sectionPortfolioDescription}
          />
          <div className="kpi-grid">
            {copy.kpis.map((kpi) => (
              <KpiCard
                key={kpi.id}
                {...kpi}
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

          <div className="content-grid dashboard-block">
            <Surface>
              <div className="surface__header">
                <div>
                  <h2>{copy.financeTitle}</h2>
                  <p>{copy.financeDescription}</p>
                </div>
                <StatusBadge tone="neutral">91</StatusBadge>
              </div>
              <div className="lifecycle-bars">
                {copy.lifecycle.map((item) => (
                  <div className="lifecycle-row" key={item.label}>
                    <span>{item.label}</span>
                    <div className={`lifecycle-track lifecycle-track--${item.tone}`}>
                      <span style={{ inlineSize: item.width }} />
                    </div>
                    <strong>{item.value}</strong>
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

          <Surface className="dashboard-block">
            <div className="surface__header">
              <div>
                <h2>{copy.operationsTitle}</h2>
                <p>{copy.operationsDescription}</p>
              </div>
              <StatusBadge tone="neutral">{copy.environment}</StatusBadge>
            </div>
            <ActivityList items={copy.activities} />
          </Surface>

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
      ) : activeNavigationId === 'clients' ? (
        <ControlCenterWorkspace
          locale={locale}
          viewState={
            controlState === 'ready' && filteredControlClients.length === 0 ? 'empty' : controlState
          }
          clients={filteredControlClients}
          onApplyFilters={setControlFilters}
          onOpenClient={() => navigate('subscriptions')}
          onAddClient={() => navigate('sales')}
          canAddClient={false}
          onRetry={() => {
            setControlFilters({ query: '', state: '', deploymentHealth: '', supportStatus: '' });
            if (session) {
              setControlState('loading');
              void readControlClients(session)
                .then((clients) => {
                  setControlClients(clients);
                  setControlState(clients.length ? 'ready' : 'empty');
                })
                .catch(() => setControlState('error'));
            }
          }}
          onOpenAudit={() => navigate('administration')}
        />
      ) : (
        <TaskRouteView
          route={platformRoutes[locale][activeNavigationId]}
          dataSourceLabel={copy.environment}
          onNavigate={navigate}
        />
      )}
    </AppShell>
  );
}
