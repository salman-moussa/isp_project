import { lazy, Suspense, useState, type ReactNode } from 'react';
import {
  AppShell,
  LocaleSwitcher,
  StatePanel,
  useHashNavigation,
  type Locale,
  type ApiSession,
} from '@isp/ui';
import { tenantCopy } from './copy';

const StaffWorkspace = lazy(() =>
  import('./staff/StaffWorkspace').then((module) => ({ default: module.StaffWorkspace })),
);
const SalesWorkspace = lazy(() =>
  import('./sales/SalesWorkspace').then((module) => ({ default: module.SalesWorkspace })),
);
const SubscriberWorkspace = lazy(() =>
  import('./subscribers/SubscriberWorkspace').then((module) => ({
    default: module.SubscriberWorkspace,
  })),
);
const BillingWorkspace = lazy(() =>
  import('./billing/BillingWorkspace').then((module) => ({ default: module.BillingWorkspace })),
);
const NocWorkspace = lazy(() =>
  import('./noc/NocWorkspace').then((module) => ({ default: module.NocWorkspace })),
);
const AccountingWorkspace = lazy(() =>
  import('./billing/AccountingWorkspace').then((module) => ({
    default: module.AccountingWorkspace,
  })),
);
const WarehouseWorkspace = lazy(() =>
  import('./warehouse/WarehouseWorkspace').then((module) => ({
    default: module.WarehouseWorkspace,
  })),
);
const ConfigurationWorkspace = lazy(() =>
  import('./configuration/ConfigurationWorkspace').then((module) => ({
    default: module.ConfigurationWorkspace,
  })),
);
const FieldServiceWorkspace = lazy(() =>
  import('./field/FieldServiceWorkspace').then((module) => ({
    default: module.FieldServiceWorkspace,
  })),
);
const SupportWorkspace = lazy(() =>
  import('./support/SupportWorkspace').then((module) => ({
    default: module.SupportWorkspace,
  })),
);
const CommunicationsWorkspace = lazy(() =>
  import('./communications/CommunicationsWorkspace').then((module) => ({
    default: module.CommunicationsWorkspace,
  })),
);
const AssuranceWorkspace = lazy(() =>
  import('./assurance/AssuranceWorkspace').then((module) => ({
    default: module.AssuranceWorkspace,
  })),
);
const DealerWorkspace = lazy(() =>
  import('./dealers/DealerWorkspace').then((module) => ({
    default: module.DealerWorkspace,
  })),
);
const DashboardWorkspace = lazy(() =>
  import('./dashboard/DashboardWorkspace').then((module) => ({
    default: module.DashboardWorkspace,
  })),
);
const ReportsWorkspace = lazy(() =>
  import('./reports/ReportsWorkspace').then((module) => ({
    default: module.ReportsWorkspace,
  })),
);
const CashierWorkspace = lazy(() =>
  import('./cashier/CashierWorkspace').then((module) => ({
    default: module.CashierWorkspace,
  })),
);
const CollectionsWorkspace = lazy(() =>
  import('./collections/CollectionsWorkspace').then((module) => ({
    default: module.CollectionsWorkspace,
  })),
);
const NetworkWorkspace = lazy(() =>
  import('./network/NetworkWorkspace').then((module) => ({
    default: module.NetworkWorkspace,
  })),
);

const tenantNavigationIds = tenantCopy.en.navigation.map((item) => item.id);

export function App({ session }: { readonly session?: ApiSession } = {}) {
  const [locale, setLocale] = useState<Locale>('en');
  const { activeId: activeNavigationId, navigate: navigateRoute } = useHashNavigation(
    tenantNavigationIds,
    'dashboard',
  );
  const copy = tenantCopy[locale];
  const activeLabel =
    copy.navigation.find((item) => item.id === activeNavigationId)?.label ?? activeNavigationId;
  const navigate = (id: string) => {
    navigateRoute(id);
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
        eyebrow: session ? copy.signedInEyebrow : copy.contextEyebrow,
        title: session ? copy.signedInTitle : copy.contextTitle,
        meta: session
          ? `${copy.workspaceLabel} …${session.tenantId?.slice(-8) ?? ''} · Asia/Beirut`
          : copy.contextMeta,
      }}
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
            <span aria-hidden="true">ISP</span>
          </button>
        </>
      }
    >
      {activeNavigationId === 'dashboard' ? (
        <WorkspaceBoundary locale={locale}>
          <DashboardWorkspace
            locale={locale}
            session={session}
            onNavigate={navigate}
            quickActions={copy.quickActions}
          />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'reports' && session ? (
        <WorkspaceBoundary locale={locale}>
          <ReportsWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'reports' ? (
        <StatePanel
          variant="empty"
          title={locale === 'en' ? 'Sign in to open Reports' : 'سجّل الدخول لفتح التقارير'}
          description={
            locale === 'en'
              ? 'Governed reports and CSV exports are available only inside an authenticated tenant session.'
              : 'التقارير المحكومة وتصدير CSV متاحة فقط ضمن جلسة مستأجر موثقة.'
          }
        />
      ) : activeNavigationId === 'staff' && session ? (
        <WorkspaceBoundary locale={locale}>
          <StaffWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'sales' && session ? (
        <WorkspaceBoundary locale={locale}>
          <SalesWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'subscribers' && session ? (
        <WorkspaceBoundary locale={locale}>
          <SubscriberWorkspace locale={locale} session={session} onNavigate={navigate} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'billing' && session ? (
        <WorkspaceBoundary locale={locale}>
          <BillingWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'noc' ? (
        <WorkspaceBoundary locale={locale}>
          <NocWorkspace locale={locale} session={session} key={session?.tenantId ?? 'signed-out'} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'accounting' ? (
        <WorkspaceBoundary locale={locale}>
          <AccountingWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'warehouse' ? (
        <WorkspaceBoundary locale={locale}>
          <WarehouseWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'support' && session ? (
        <WorkspaceBoundary locale={locale}>
          <SupportWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'communications' && session ? (
        <WorkspaceBoundary locale={locale}>
          <CommunicationsWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'assurance' && session ? (
        <WorkspaceBoundary locale={locale}>
          <AssuranceWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'dealers' && session ? (
        <WorkspaceBoundary locale={locale}>
          <DealerWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'payments' && session ? (
        <WorkspaceBoundary locale={locale}>
          <CashierWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'collectors' && session ? (
        <WorkspaceBoundary locale={locale}>
          <CollectionsWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'mikrotik' && session ? (
        <WorkspaceBoundary locale={locale}>
          <NetworkWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'installations' && session ? (
        <WorkspaceBoundary locale={locale}>
          <FieldServiceWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'configuration' && session ? (
        <WorkspaceBoundary locale={locale}>
          <ConfigurationWorkspace locale={locale} session={session} />
        </WorkspaceBoundary>
      ) : activeNavigationId === 'support' ? (
        <StatePanel
          variant="empty"
          title={
            locale === 'en' ? 'Sign in to open Customer service' : 'سجّل الدخول لفتح خدمة العملاء'
          }
          description={
            locale === 'en'
              ? 'Tickets, verification and escalation are available only inside an authenticated tenant session.'
              : 'التذاكر والتحقق والتصعيد متاحة فقط ضمن جلسة مستأجر موثقة.'
          }
        />
      ) : activeNavigationId === 'communications' ? (
        <StatePanel
          variant="empty"
          title={locale === 'en' ? 'Sign in to open Communications' : 'سجّل الدخول لفتح التواصل'}
          description={
            locale === 'en'
              ? 'Templates, consent and the notification outbox are available only inside an authenticated tenant session.'
              : 'القوالب والموافقات وصندوق الإشعارات متاحة فقط ضمن جلسة مستأجر موثقة.'
          }
        />
      ) : activeNavigationId === 'assurance' ? (
        <StatePanel
          variant="empty"
          title={
            locale === 'en'
              ? 'Sign in to open Revenue assurance'
              : 'سجّل الدخول لفتح ضمان الإيرادات'
          }
          description={
            locale === 'en'
              ? 'Leakage controls, findings and exposure cases are available only inside an authenticated tenant session.'
              : 'ضوابط التسرب والنتائج وحالات التعرض متاحة فقط ضمن جلسة مستأجر موثقة.'
          }
        />
      ) : activeNavigationId === 'dealers' ? (
        <StatePanel
          variant="empty"
          title={locale === 'en' ? 'Sign in to open Dealers' : 'سجّل الدخول لفتح الوكلاء'}
          description={
            locale === 'en'
              ? 'Dealer float, voucher batches and redemptions are available only inside an authenticated tenant session.'
              : 'رصيد الوكلاء ودفعات القسائم والاستخدامات متاحة فقط ضمن جلسة مستأجر موثقة.'
          }
        />
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
      ) : (
        <StatePanel
          variant="empty"
          title={`${copy.signInToOpen} ${activeLabel}`}
          description={copy.signInDescription}
        />
      )}
    </AppShell>
  );
}

function WorkspaceBoundary({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <StatePanel
          variant="loading"
          title={locale === 'en' ? 'Opening workspace' : 'جارٍ فتح مساحة العمل'}
          description={
            locale === 'en'
              ? 'Loading the selected operations tools.'
              : 'جارٍ تحميل أدوات العمليات المحددة.'
          }
        />
      }
    >
      {children}
    </Suspense>
  );
}
