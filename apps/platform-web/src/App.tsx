import { useEffect, useState } from 'react';
import {
  AppShell,
  LocaleSwitcher,
  StatePanel,
  StatusBadge,
  useHashNavigation,
  type Locale,
  type ApiSession,
} from '@isp/ui';
import { platformCopy } from './copy';
import {
  ControlCenterWorkspace,
  type ControlCenterClientRow,
  type ControlCenterFilters,
} from './control-center/ControlCenterWorkspace';
import { AdministrationWorkspace } from './administration/AdministrationWorkspace';
import { createControlClient, readControlClients } from './api';
import {
  BillingPage,
  ClientFilePanel,
  DeploymentsPage,
  PackagesPage,
  PortfolioOverview,
  ReportsPage,
  SalesPipelinePage,
  SubscriptionsPage,
  SupportPage,
} from './portfolio/PortfolioPages';

const platformNavigationIds = platformCopy.en.navigation.map((item) => item.id);

export function App({ session }: { readonly session?: ApiSession } = {}) {
  const [locale, setLocale] = useState<Locale>('en');
  const { activeId: activeNavigationId, navigate: navigateRoute } = useHashNavigation(
    platformNavigationIds,
    'overview',
  );
  const [controlFilters, setControlFilters] = useState<ControlCenterFilters>({
    query: '',
    state: '',
    deploymentHealth: '',
    supportStatus: '',
  });
  const [controlClients, setControlClients] = useState<readonly ControlCenterClientRow[]>([]);
  const [controlState, setControlState] = useState<'loading' | 'ready' | 'empty' | 'error'>(
    'loading',
  );
  const [openClientId, setOpenClientId] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const copy = platformCopy[locale];
  const activeLabel =
    copy.navigation.find((item) => item.id === activeNavigationId)?.label ?? activeNavigationId;
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
  }, [session, refresh]);
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
  };
  const openClient = (tenantId: string) => {
    setOpenClientId(tenantId);
  };
  const signIn = (
    <StatePanel
      variant="empty"
      title={`${copy.signInToOpen} ${activeLabel}`}
      description={copy.signInDescription}
    />
  );
  const clientFile =
    session && openClientId ? (
      <ClientFilePanel
        session={session}
        locale={locale}
        tenantId={openClientId}
        onClose={() => setOpenClientId(undefined)}
      />
    ) : null;

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
          ? { eyebrow: copy.signedInEyebrow, title: copy.signedInTitle, meta: copy.signedInMeta }
          : { eyebrow: copy.contextEyebrow, title: copy.contextTitle, meta: copy.contextMeta }
      }
      contextAction={
        session ? <StatusBadge tone="positive">{copy.operatorStatus}</StatusBadge> : undefined
      }
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
            aria-label={session ? copy.signOutLabel : copy.userLabel}
            onClick={session?.logout}
          >
            <span aria-hidden="true">OX</span>
          </button>
        </>
      }
    >
      {!session ? (
        signIn
      ) : activeNavigationId === 'overview' ? (
        <>
          <PortfolioOverview
            session={session}
            locale={locale}
            onNavigate={navigate}
            onOpenClient={openClient}
          />
          {clientFile}
        </>
      ) : activeNavigationId === 'clients' ? (
        <>
          <ControlCenterWorkspace
            locale={locale}
            viewState={
              controlState === 'ready' && filteredControlClients.length === 0
                ? 'empty'
                : controlState
            }
            clients={filteredControlClients}
            onApplyFilters={setControlFilters}
            onOpenClient={openClient}
            onAddClient={() => navigate('sales')}
            canAddClient
            onCreateClient={async (input, idempotencyKey) => {
              await createControlClient(session, input, idempotencyKey);
              setRefresh((value) => value + 1);
            }}
            onRetry={() => {
              setControlFilters({ query: '', state: '', deploymentHealth: '', supportStatus: '' });
              setRefresh((value) => value + 1);
            }}
            onOpenAudit={() => navigate('reports')}
          />
          {clientFile}
        </>
      ) : activeNavigationId === 'sales' ? (
        <>
          <SalesPipelinePage
            session={session}
            locale={locale}
            onOpenClient={openClient}
            onAddClient={() => navigate('clients')}
          />
          {clientFile}
        </>
      ) : activeNavigationId === 'packages' ? (
        <PackagesPage session={session} locale={locale} />
      ) : activeNavigationId === 'subscriptions' ? (
        <>
          <SubscriptionsPage session={session} locale={locale} onOpenClient={openClient} />
          {clientFile}
        </>
      ) : activeNavigationId === 'billing' ? (
        <>
          <BillingPage session={session} locale={locale} onOpenClient={openClient} />
          {clientFile}
        </>
      ) : activeNavigationId === 'deployments' ? (
        <>
          <DeploymentsPage
            session={session}
            locale={locale}
            onOpenClient={openClient}
            clients={controlClients}
          />
          {clientFile}
        </>
      ) : activeNavigationId === 'support' ? (
        <>
          <SupportPage
            session={session}
            locale={locale}
            onOpenClient={openClient}
            clients={controlClients}
          />
          {clientFile}
        </>
      ) : activeNavigationId === 'reports' ? (
        <ReportsPage session={session} locale={locale} />
      ) : activeNavigationId === 'administration' ? (
        <AdministrationWorkspace session={session} locale={locale} />
      ) : (
        signIn
      )}
    </AppShell>
  );
}
