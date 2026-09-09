import { useEffect, useState } from 'react';
import {
  ActivityList,
  DrilldownPanel,
  KpiCard,
  MoneyPair,
  PageHeader,
  QuickAction,
  SectionHeading,
  StatePanel,
  Surface,
  type ApiSession,
  type Locale,
} from '@isp/ui';
import type { DashboardSnapshot } from '@isp/contracts';
import { readDashboardSnapshot } from '../api';
import { accountMoney } from '../billing/account-money';
import './dashboard.css';

type Kpi = 'collections' | 'receivables' | 'sessions' | 'work';

export function DashboardWorkspace({
  locale,
  session,
  onNavigate,
  quickActions,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
  readonly onNavigate: (id: string) => void;
  readonly quickActions: readonly { id: string; label: string; description: string }[];
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<Kpi | null>(null);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setState('loading');
    void readDashboardSnapshot(session)
      .then((result) => {
        if (active) {
          setSnapshot(result);
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
  const money = (minor: number, currency: 'USD' | 'LBP') => accountMoney(minor, currency, locale);
  const time = (value: string) =>
    new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const channel = (value: string) =>
    ({
      office: t('Office cashier', 'صندوق المكتب'),
      collector: t('Collector routes', 'مسارات الجباة'),
      other: t('Other channels', 'قنوات أخرى'),
    })[value] ?? value;
  if (!session)
    return (
      <>
        <PageHeader
          eyebrow={t('OPERATIONS DASHBOARD', 'لوحة العمليات')}
          title={t(
            'Sign in to see today’s operating picture.',
            'سجّل الدخول لرؤية صورة عمل اليوم.',
          )}
          description={t(
            'Collections, receivables, live sessions and failed work are computed from your tenant’s own records for your permitted scope. Nothing is shown before you sign in.',
            'تُحسب التحصيلات والذمم والجلسات الحية والأعمال الفاشلة من سجلات شركتك ضمن نطاق صلاحيتك. لا يُعرض شيء قبل تسجيل الدخول.',
          )}
        />
      </>
    );
  const drilldown = (() => {
    if (!snapshot || !open) return null;
    if (open === 'collections')
      return {
        title: t('Receipts posted today', 'الإيصالات المرحّلة اليوم'),
        items: snapshot.collections.recent.map((r) => ({
          label: `${r.receiptNumber} · ${r.subscriberName ?? channel(r.channel)}`,
          value: money(r.amountMinor, r.currency),
          detail: `${channel(r.channel)} · ${time(r.postedAt)}`,
          tone: 'positive' as const,
        })),
      };
    if (open === 'receivables')
      return {
        title: t('Oldest unpaid invoices', 'أقدم الفواتير غير المسددة'),
        items: snapshot.receivables.oldest.map((i) => ({
          label: `${i.documentNumber} · ${i.subscriberName ?? '—'}`,
          value: money(i.remainingMinor, i.currency),
          detail: `${t('posted', 'رُحّلت')} ${time(i.postedAt)}`,
          tone: 'warning' as const,
        })),
      };
    if (open === 'sessions')
      return {
        title: t('Live sessions by NAS', 'الجلسات الحية حسب NAS'),
        items: snapshot.services.byNas.map((n) => ({
          label: n.nasName,
          value: String(n.sessions),
          detail: t('active PPPoE sessions', 'جلسات PPPoE نشطة'),
          tone: 'primary' as const,
        })),
      };
    return {
      title: t('Failed work needing a decision', 'أعمال فاشلة تحتاج قراراً'),
      items: snapshot.work.failed.map((f) => ({
        label: `${f.kind} · ${f.reference}`,
        value: t('failed', 'فشل'),
        detail: `${f.detail} · ${time(f.at)}`,
        tone: 'critical' as const,
      })),
    };
  })();
  return (
    <>
      <PageHeader
        eyebrow={t('OPERATIONS DASHBOARD', 'لوحة العمليات')}
        title={t('Today’s operating picture', 'صورة عمل اليوم')}
        description={
          snapshot
            ? `${t('Computed from your records at', 'محسوبة من سجلاتك عند')} ${time(snapshot.asOf)}. ${t('Currencies are never combined.', 'لا تُجمع العملات أبداً.')}`
            : t('Reading the permission-scoped snapshot…', 'جارٍ قراءة اللقطة ضمن نطاق الصلاحية…')
        }
      />
      {state === 'error' && (
        <StatePanel
          variant="error"
          title={t('Dashboard unavailable', 'اللوحة غير متاحة')}
          description={t(
            'The live snapshot could not be read. Check your connection and dashboard permission, then retry.',
            'تعذّرت قراءة اللقطة الحية. تحقق من الاتصال وصلاحية اللوحة ثم أعد المحاولة.',
          )}
          actionLabel={t('Retry', 'إعادة المحاولة')}
          onAction={() => setRefresh((v) => v + 1)}
        />
      )}
      {state === 'loading' && (
        <StatePanel
          variant="loading"
          title={t('Loading authorized data', 'جارٍ تحميل البيانات المصرح بها')}
          description={t(
            'The dashboard is being computed from the API.',
            'تُحسب اللوحة من الواجهة الآن.',
          )}
        />
      )}
      {snapshot && state === 'ready' && (
        <>
          <SectionHeading
            title={t('Today', 'اليوم')}
            description={t(
              'Open any card to see the records behind it.',
              'افتح أي بطاقة لرؤية السجلات وراءها.',
            )}
          />
          <div className="kpi-grid">
            <KpiCard
              label={t('Collections today', 'تحصيلات اليوم')}
              value={
                <MoneyPair
                  usd={money(snapshot.collections.usdMinor, 'USD')}
                  lbp={money(snapshot.collections.lbpMinor, 'LBP')}
                />
              }
              detail={`${snapshot.collections.receipts} ${t('receipts posted', 'إيصالاً مرحّلاً')}`}
              tone="positive"
              targetLabel={t('Open receipts', 'فتح الإيصالات')}
              onOpen={() => setOpen('collections')}
            />
            <KpiCard
              label={t('Unpaid invoices', 'فواتير غير مسددة')}
              value={String(snapshot.receivables.unpaidInvoices)}
              detail={`${money(snapshot.receivables.usdMinor, 'USD')} · ${money(snapshot.receivables.lbpMinor, 'LBP')}`}
              trend={String(snapshot.receivables.overdue30)}
              trendLabel={t('older than 30 days', 'أقدم من ٣٠ يوماً')}
              tone={snapshot.receivables.overdue30 > 0 ? 'warning' : 'primary'}
              targetLabel={t('Open oldest invoices', 'فتح أقدم الفواتير')}
              onOpen={() => setOpen('receivables')}
            />
            <KpiCard
              label={t('Live sessions', 'جلسات حية')}
              value={String(snapshot.services.liveSessions)}
              detail={`${snapshot.services.active} ${t('active services', 'خدمة نشطة')} · ${snapshot.services.suspended} ${t('suspended', 'معلّقة')}`}
              trend={String(snapshot.services.pendingInstallation)}
              trendLabel={t('awaiting installation', 'بانتظار التركيب')}
              tone="primary"
              targetLabel={t('Open sessions by NAS', 'فتح الجلسات حسب NAS')}
              onOpen={() => setOpen('sessions')}
            />
            <KpiCard
              label={t('Failed work', 'أعمال فاشلة')}
              value={String(snapshot.work.failedJobs)}
              detail={`${snapshot.work.openTickets} ${t('open tickets', 'تذكرة مفتوحة')} · ${snapshot.work.ticketsOverdue} ${t('overdue', 'متجاوزة')} · ${snapshot.work.openIncidents} ${t('incidents', 'حادث')}`}
              trend={String(snapshot.work.workOrdersToday)}
              trendLabel={t('field visits today', 'زيارة ميدانية اليوم')}
              tone={snapshot.work.failedJobs > 0 ? 'critical' : 'positive'}
              targetLabel={t('Open failed work', 'فتح الأعمال الفاشلة')}
              onOpen={() => setOpen('work')}
            />
          </div>
          {drilldown && (
            <DrilldownPanel
              title={drilldown.title}
              filterLabel={t('Records behind the card', 'السجلات وراء البطاقة')}
              items={
                drilldown.items.length > 0
                  ? drilldown.items
                  : [
                      {
                        label: t('Nothing recorded', 'لا سجلات'),
                        value: '0',
                        detail: t(
                          'No records match this card right now.',
                          'لا سجلات تطابق هذه البطاقة الآن.',
                        ),
                        tone: 'neutral' as const,
                      },
                    ]
              }
              closeLabel={t('Close records', 'إغلاق السجلات')}
              onClose={() => setOpen(null)}
            />
          )}
          <div className="content-grid dashboard-block">
            <Surface>
              <div className="surface__header">
                <div>
                  <h2>{t('Collections by channel', 'التحصيل حسب القناة')}</h2>
                  <p>
                    {t(
                      'Posted amounts today; each currency on its own line.',
                      'المبالغ المرحّلة اليوم؛ كل عملة في سطر.',
                    )}
                  </p>
                </div>
              </div>
              {snapshot.collections.byChannel.length === 0 ? (
                <p className="dashboard-note">
                  {t('No receipts posted today yet.', 'لا إيصالات مرحّلة اليوم بعد.')}
                </p>
              ) : (
                <div className="collection-ledger">
                  {snapshot.collections.byChannel.map((row) => (
                    <div className="collection-row" key={row.channel + row.currency}>
                      <span>
                        {channel(row.channel)} · {row.currency}
                      </span>
                      <strong dir="ltr">{money(row.amountMinor, row.currency)}</strong>
                      <small>
                        {row.receipts} {t('receipts', 'إيصال')}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </Surface>
            <Surface>
              <div className="surface__header">
                <div>
                  <h2>{t('Shift shortcuts', 'اختصارات المناوبة')}</h2>
                  <p>
                    {t(
                      'Fast entry points for the most common office work.',
                      'مداخل سريعة لأكثر أعمال المكتب شيوعاً.',
                    )}
                  </p>
                </div>
              </div>
              <div className="quick-actions">
                {quickActions.map((action) => (
                  <QuickAction key={action.id} {...action} onClick={() => onNavigate(action.id)} />
                ))}
              </div>
            </Surface>
          </div>
          <Surface className="dashboard-block">
            <div className="surface__header">
              <div>
                <h2>{t('Recent operational activity', 'النشاط التشغيلي الأخير')}</h2>
                <p>
                  {t(
                    'The latest audited actions in your scope.',
                    'أحدث الإجراءات المدققة ضمن نطاقك.',
                  )}
                </p>
              </div>
            </div>
            {snapshot.activity.length === 0 ? (
              <p className="dashboard-note">{t('No audited activity yet.', 'لا نشاط مدقق بعد.')}</p>
            ) : (
              <ActivityList
                items={snapshot.activity.map((a) => ({
                  title: a.action,
                  detail: `${a.resourceType} · ${a.actor}`,
                  time: time(a.at),
                  tone: 'neutral' as const,
                }))}
              />
            )}
          </Surface>
        </>
      )}
    </>
  );
}
