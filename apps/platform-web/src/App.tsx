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
import {
  ControlActionWorkspace,
  type ControlActionTask,
} from './control-center/ControlActionWorkspace';
import { createControlClient, readControlClients } from './api';

const platformNavigationIds = platformCopy.en.navigation.map((item) => item.id);
const controlActionRoutes: Readonly<Record<string, ControlActionTask>> = {
  packages: 'package',
  subscriptions: 'assignment',
  billing: 'invoice',
};
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
  const activeClients = controlClients.filter((client) => client.state === 'active').length;
  const attentionClients = controlClients.filter(
    (client) => client.deploymentHealth === 'attention' || client.deploymentHealth === 'blocked',
  ).length;
  const openTickets = controlClients.reduce((sum, client) => sum + client.openTicketCount, 0);
  const escalatedClients = controlClients.filter(
    (client) => client.supportStatus === 'escalated',
  ).length;
  const portfolioKpis: typeof copy.kpis = session
    ? [
        {
          id: 'active',
          label: locale === 'en' ? 'Active ISP clients' : 'عملاء الإنترنت النشطون',
          value: String(activeClients),
          detail:
            locale === 'en'
              ? `${controlClients.length} authorized client records`
              : `${controlClients.length} سجلاً مصرحاً للعميل`,
          trend: '',
          trendLabel: '',
          tone: 'positive',
        },
        {
          id: 'portfolio',
          label: locale === 'en' ? 'Portfolio records' : 'سجلات المحفظة',
          value: String(controlClients.length),
          detail: locale === 'en' ? 'Read from Control Center API' : 'مقروءة من واجهة مركز التحكم',
          trend: '',
          trendLabel: '',
          tone: 'primary',
        },
        {
          id: 'tickets',
          label: locale === 'en' ? 'Open support tickets' : 'تذاكر الدعم المفتوحة',
          value: String(openTickets),
          detail:
            locale === 'en'
              ? `${escalatedClients} escalated clients`
              : `${escalatedClients} عملاء مصعّدون`,
          trend: '',
          trendLabel: '',
          tone: openTickets ? 'warning' : 'positive',
        },
        {
          id: 'health',
          label: locale === 'en' ? 'Deployment attention' : 'عمليات نشر تحتاج متابعة',
          value: String(attentionClients),
          detail:
            locale === 'en' ? 'Attention or blocked health state' : 'حالة تحتاج متابعة أو محظورة',
          trend: '',
          trendLabel: '',
          tone: attentionClients ? 'critical' : 'positive',
        },
      ]
    : copy.kpis;
  const lifecycleRows: typeof copy.lifecycle = session
    ? (['active', 'trial', 'grace', 'restricted'] as const).map((state, index) => {
        const count = controlClients.filter((client) => client.state === state).length;
        return {
          label:
            locale === 'en'
              ? (
                  {
                    active: 'Active',
                    trial: 'Trial',
                    grace: 'Grace',
                    restricted: 'Restricted',
                  } as const
                )[state]
              : ({ active: 'نشط', trial: 'تجريبي', grace: 'مهلة', restricted: 'مقيّد' } as const)[
                  state
                ],
          value: String(count),
          width: `${controlClients.length ? Math.max(4, (count / controlClients.length) * 100) : 0}%`,
          tone: (['positive', 'primary', 'warning', 'critical'] as const)[index],
        };
      })
    : copy.lifecycle;
  const liveActivities: typeof copy.activities = controlClients
    .filter((client) => client.openTicketCount > 0 || client.deploymentHealth !== 'healthy')
    .slice(0, 5)
    .map((client) => ({
      title: client.tradingName,
      detail:
        locale === 'en'
          ? `${client.openTicketCount} open tickets · deployment ${client.deploymentHealth}`
          : `${client.openTicketCount} تذاكر مفتوحة · النشر ${client.deploymentHealth}`,
      time: locale === 'en' ? 'Current' : 'حالي',
      tone:
        client.deploymentHealth === 'blocked'
          ? 'critical'
          : client.openTicketCount
            ? 'warning'
            : 'positive',
    }));

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
      context={
        session
          ? {
              eyebrow: locale === 'en' ? 'Production control plane' : 'منصة التحكم الإنتاجية',
              title: locale === 'en' ? 'Lebanon client portfolio' : 'محفظة العملاء في لبنان',
              meta:
                locale === 'en'
                  ? 'Authenticated API · Asia/Beirut'
                  : 'واجهة مصرح بها · توقيت بيروت',
            }
          : { eyebrow: copy.contextEyebrow, title: copy.contextTitle, meta: copy.contextMeta }
      }
      contextAction={<StatusBadge tone="positive">{copy.operatorStatus}</StatusBadge>}
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
            <span aria-hidden="true">OX</span>
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
            {portfolioKpis.map((kpi) => (
              <KpiCard
                key={kpi.id}
                {...kpi}
                targetLabel={copy.drilldownTarget}
                onOpen={() => (session ? navigate('clients') : setDrilldownId(kpi.id))}
              />
            ))}
          </div>

          {!session && drilldown && (
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
                <StatusBadge tone="neutral">{session ? controlClients.length : 91}</StatusBadge>
              </div>
              <div className="lifecycle-bars">
                {lifecycleRows.map((item) => (
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
              <StatusBadge tone={session ? 'positive' : 'neutral'}>
                {session ? (locale === 'en' ? 'Live API' : 'واجهة مباشرة') : copy.environment}
              </StatusBadge>
            </div>
            {session && controlState !== 'ready' ? (
              <StatePanel
                variant={
                  controlState === 'loading'
                    ? 'loading'
                    : controlState === 'error'
                      ? 'error'
                      : 'empty'
                }
                title={locale === 'en' ? 'Portfolio data' : 'بيانات المحفظة'}
                description={
                  locale === 'en'
                    ? 'The authorized client portfolio is being resolved.'
                    : 'جارٍ تحميل محفظة العملاء المصرح بها.'
                }
              />
            ) : liveActivities.length || !session ? (
              <ActivityList items={session ? liveActivities : copy.activities} />
            ) : (
              <StatePanel
                variant="empty"
                title={locale === 'en' ? 'No operational alerts' : 'لا توجد تنبيهات تشغيلية'}
                description={
                  locale === 'en'
                    ? 'All current client records are clear.'
                    : 'كل سجلات العملاء الحالية سليمة.'
                }
              />
            )}
          </Surface>

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
          canAddClient={Boolean(session)}
          onCreateClient={
            session
              ? async (input, idempotencyKey) => {
                  await createControlClient(session, input, idempotencyKey);
                  const clients = await readControlClients(session);
                  setControlClients(clients);
                  setControlState(clients.length ? 'ready' : 'empty');
                }
              : undefined
          }
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
      ) : session && controlActionRoutes[activeNavigationId] ? (
        <ControlActionWorkspace
          session={session}
          locale={locale}
          initialTask={controlActionRoutes[activeNavigationId]}
        />
      ) : (
        <TaskRouteView
          route={platformRoutes[locale][activeNavigationId]}
          dataSourceLabel={
            session
              ? locale === 'en'
                ? 'Guided workflow · connected actions remain permission scoped'
                : 'مسار إرشادي · الإجراءات المتصلة مقيّدة بالصلاحيات'
              : copy.environment
          }
          onNavigate={navigate}
        />
      )}
    </AppShell>
  );
}
