import { useState } from 'react';
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
  type Locale,
  type StateVariant,
} from '@isp/ui';
import { tenantCopy } from './copy';

export function App() {
  const [locale, setLocale] = useState<Locale>('en');
  const [activeNavigationId, setActiveNavigationId] = useState('dashboard');
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const [stateVariant, setStateVariant] = useState<StateVariant>('loading');
  const [supportSessionActive, setSupportSessionActive] = useState(false);
  const copy = tenantCopy[locale];
  const activeNavigation =
    copy.navigation.find((item) => item.id === activeNavigationId) ?? copy.navigation[0];
  const drilldown = drilldownId ? copy.drilldowns[drilldownId] : undefined;

  const navigate = (id: string) => {
    setActiveNavigationId(id);
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
          <button type="button" className="user-chip" aria-label={copy.userLabel}>
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
            {copy.kpis.map((kpi) => (
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
      ) : (
        <>
          <PageHeader
            eyebrow={copy.moduleEyebrow}
            title={activeNavigation.label}
            description={copy.moduleDescription}
          />
          <div className="module-placeholder">
            <StatePanel
              variant="empty"
              title={copy.moduleEmptyTitle}
              description={copy.moduleEmptyDescription}
              actionLabel={copy.moduleAction}
              onAction={() => undefined}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
