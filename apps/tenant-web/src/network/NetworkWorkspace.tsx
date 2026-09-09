import { useCallback, useEffect, useState } from 'react';
import type {
  IpPoolSummary,
  NetworkInfrastructureCommand,
  NetworkJobRecord,
  NetworkResourceCommand,
  NetworkWorkspace as Workspace,
} from '@isp/contracts';
import { networkInfrastructureCommandSchema, networkResourceCommandSchema } from '@isp/contracts';
import { Button, StatePanel, StatusBadge, type ApiSession, type Locale } from '@isp/ui';
import { readNetworkWorkspace, submitTenantOperation, TenantApiError } from '../api';
import './network.css';

type Translate = (en: string, ar: string) => string;
type Tab = 'jobs' | 'routers' | 'bindings' | 'ipam' | 'nas' | 'cpe';
type Panel = { readonly tone: 'positive' | 'negative'; readonly text: string };

/**
 * Network operations: RouterOS worker jobs, router registry, service bindings, IPAM pools and
 * allocations, NAS clients with RADIUS sessions, and the CPE registry. Router and NAS changes go
 * through the approval-authority route (fresh MFA); everything else through the job authority.
 */
export function NetworkWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  const rtl = locale === 'ar';
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobScope, setJobScope] = useState<'open' | 'attention' | 'closed' | 'all'>('open');
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [form, setForm] = useState<string>();

  const load = useCallback(async () => {
    try {
      setData(await readNetworkWorkspace(session, { jobs: jobScope }));
      setState('ready');
    } catch (error) {
      setState(error instanceof TenantApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [session, jobScope]);
  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  const run = async (
    path: 'network/infrastructure' | 'network/resources',
    command: NetworkInfrastructureCommand | NetworkResourceCommand,
    success: string,
  ) => {
    setBusy(true);
    setPanel(undefined);
    try {
      const parsed =
        path === 'network/infrastructure'
          ? networkInfrastructureCommandSchema.parse(command)
          : networkResourceCommandSchema.parse(command);
      const result = await submitTenantOperation(session, path, { command: parsed }, key());
      setPanel({
        tone: 'positive',
        text: `${success}${typeof result.address === 'string' ? ` · ${result.address}` : ''}`,
      });
      setForm(undefined);
      await load();
    } catch (error) {
      setPanel({
        tone: 'negative',
        text:
          error instanceof Error
            ? error.message
            : t('The action failed safely.', 'فشل الإجراء بأمان.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const jobTone = (value: NetworkJobRecord['state']) =>
    value === 'succeeded' || value === 'reconciled'
      ? 'positive'
      : value === 'failed' || value === 'dead_lettered'
        ? 'critical'
        : value === 'partially_succeeded'
          ? 'warning'
          : value === 'canceled'
            ? 'neutral'
            : 'primary';
  const jobLabel = (value: NetworkJobRecord['state']) =>
    ({
      queued: t('Queued', 'في الانتظار'),
      running: t('Running', 'قيد التنفيذ'),
      retry_scheduled: t('Retry scheduled', 'إعادة محاولة مجدولة'),
      reconciling: t('Reconciling', 'قيد المطابقة'),
      reconciled: t('Reconciled', 'مطابق'),
      succeeded: t('Succeeded', 'نجح'),
      partially_succeeded: t('Partially succeeded', 'نجح جزئياً'),
      failed: t('Failed', 'فشل'),
      dead_lettered: t('Dead-lettered', 'متوقف نهائياً'),
      canceled: t('Cancelled', 'ملغى'),
    })[value];

  if (state !== 'ready' || !data) {
    return (
      <StatePanel
        variant={state === 'ready' ? 'loading' : state}
        title={
          state === 'denied'
            ? t('Network operations are outside your scope', 'عمليات الشبكة خارج نطاقك')
            : state === 'error'
              ? t('Network data could not be loaded', 'تعذّر تحميل بيانات الشبكة')
              : t('Loading network operations', 'جارٍ تحميل عمليات الشبكة')
        }
        description={
          state === 'denied'
            ? t(
                'Ask an administrator for network view permission.',
                'اطلب من المدير صلاحية عرض الشبكة.',
              )
            : state === 'error'
              ? t(
                  'No change was made. Retry the read safely.',
                  'لم يُجرَ أي تغيير. أعد المحاولة بأمان.',
                )
              : t(
                  'Routers, jobs, pools and devices are being read.',
                  'تُقرأ الراوترات والمهام والمجمّعات والأجهزة.',
                )
        }
        actionLabel={state === 'error' ? t('Retry', 'إعادة المحاولة') : undefined}
        onAction={() => {
          setState('loading');
          void load();
        }}
      />
    );
  }

  const attention = data.jobs.filter(
    (job) => job.state === 'failed' || job.state === 'dead_lettered',
  ).length;
  const tabs: readonly { readonly id: Tab; readonly label: string; readonly count: number }[] = [
    { id: 'jobs', label: t('Worker jobs', 'مهام العامل'), count: data.jobs.length },
    { id: 'routers', label: t('Routers', 'الراوترات'), count: data.routers.length },
    { id: 'bindings', label: t('Service bindings', 'ربط الخدمات'), count: data.bindings.length },
    { id: 'ipam', label: t('IP pools', 'مجمّعات العناوين'), count: data.pools.length },
    { id: 'nas', label: t('NAS & sessions', 'أجهزة NAS والجلسات'), count: data.nasClients.length },
    { id: 'cpe', label: t('CPE devices', 'أجهزة العميل'), count: data.cpeDevices.length },
  ];

  return (
    <div className="network-shell" dir={rtl ? 'rtl' : 'ltr'}>
      <header className="network-hero">
        <div>
          <span>{t('Network operations', 'عمليات الشبكة')}</span>
          <h1>
            {t(
              'Routers, addresses and subscriber sessions',
              'الراوترات والعناوين وجلسات المشتركين',
            )}
          </h1>
          <p>
            {t(
              'Every router command is a durable, idempotent job executed by the Network Worker. Credentials are references to secret files on the worker and never travel through this screen.',
              'كل أمر راوتر مهمة دائمة غير قابلة للتكرار ينفذها عامل الشبكة. بيانات الاعتماد مراجع لملفات سرية على العامل ولا تمر عبر هذه الشاشة أبداً.',
            )}
          </p>
        </div>
        <dl className="network-hero__stats">
          <div>
            <dt>{t('Routers enabled', 'راوترات مفعّلة')}</dt>
            <dd>{data.routers.filter((r) => r.enabled).length}</dd>
          </div>
          <div>
            <dt>{t('Open jobs', 'مهام مفتوحة')}</dt>
            <dd>{data.routers.reduce((sum, r) => sum + r.openJobs, 0)}</dd>
          </div>
          <div className={attention ? 'is-alert' : undefined}>
            <dt>{t('Needs attention', 'تحتاج انتباهاً')}</dt>
            <dd>{attention}</dd>
          </div>
          <div>
            <dt>{t('Active sessions', 'جلسات نشطة')}</dt>
            <dd>{data.sessions.filter((s) => !s.stoppedAt).length}</dd>
          </div>
        </dl>
      </header>

      <nav className="network-tabs" aria-label={t('Network areas', 'أقسام الشبكة')}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => {
              setTab(item.id);
              setForm(undefined);
            }}
          >
            {item.label} <small>{item.count}</small>
          </button>
        ))}
      </nav>

      {panel ? (
        <p className={`network-panel network-panel--${panel.tone}`} role="status">
          {panel.text}
        </p>
      ) : null}

      {tab === 'jobs' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('Worker jobs', 'مهام العامل')}</h2>
            <label className="network-inline">
              <span>{t('Show', 'عرض')}</span>
              <select
                value={jobScope}
                onChange={(event) => setJobScope(event.target.value as typeof jobScope)}
              >
                <option value="open">{t('Open', 'مفتوحة')}</option>
                <option value="attention">{t('Needs attention', 'تحتاج انتباهاً')}</option>
                <option value="closed">{t('Closed', 'مغلقة')}</option>
                <option value="all">{t('All', 'الكل')}</option>
              </select>
            </label>
          </div>
          {data.jobs.length === 0 ? (
            <p className="network-note">
              {t('No jobs in this view.', 'لا توجد مهام في هذا العرض.')}
            </p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--jobs">
                <span role="columnheader">{t('Job', 'المهمة')}</span>
                <span role="columnheader">{t('Action', 'الإجراء')}</span>
                <span role="columnheader">{t('Service', 'الخدمة')}</span>
                <span role="columnheader">{t('Router', 'الراوتر')}</span>
                <span role="columnheader">{t('Attempts', 'المحاولات')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
                <span role="columnheader">{t('Control', 'التحكم')}</span>
              </div>
              {data.jobs.map((job) => (
                <div role="row" key={job.jobId} className="network-table__row--jobs">
                  <span role="cell" dir="ltr" title={job.jobId}>
                    {job.jobId.slice(-12)}
                    <br />
                    <small>{time(job.createdAt)}</small>
                  </span>
                  <span role="cell" dir="ltr">
                    {job.kind ?? '—'}
                    <br />
                    <small>{job.origin ?? ''}</small>
                  </span>
                  <span role="cell">
                    {job.serviceNumber ?? job.serviceId ?? '—'}
                    <br />
                    <small>{job.subscriberName ?? ''}</small>
                  </span>
                  <span role="cell" dir="ltr">
                    {job.routerId ?? '—'}
                  </span>
                  <span role="cell">
                    {job.attempts}
                    {job.previousAttempts ? ` (+${job.previousAttempts})` : ''}
                    {job.lastErrorClass ? (
                      <>
                        <br />
                        <small>{job.lastErrorClass}</small>
                      </>
                    ) : null}
                  </span>
                  <span role="cell">
                    <StatusBadge tone={jobTone(job.state)}>{jobLabel(job.state)}</StatusBadge>
                  </span>
                  <span role="cell" className="network-actions">
                    {job.state === 'queued' || job.state === 'retry_scheduled' ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setForm(`cancel:${job.jobId}`)}
                      >
                        {t('Cancel', 'إلغاء')}
                      </Button>
                    ) : null}
                    {job.state === 'failed' || job.state === 'dead_lettered' ? (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => setForm(`retry:${job.jobId}`)}
                      >
                        {t('Retry', 'إعادة المحاولة')}
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
          {form?.startsWith('cancel:') || form?.startsWith('retry:') ? (
            <EvidenceForm
              t={t}
              title={
                form.startsWith('cancel:')
                  ? t('Cancel job', 'إلغاء المهمة')
                  : t('Re-queue job', 'إعادة المهمة إلى قائمة الانتظار')
              }
              submitLabel={
                form.startsWith('cancel:')
                  ? t('Confirm cancellation', 'تأكيد الإلغاء')
                  : t('Re-queue', 'إعادة إلى الانتظار')
              }
              busy={busy}
              onCancel={() => setForm(undefined)}
              onSubmit={(evidence) =>
                void run(
                  'network/resources',
                  {
                    action: form.startsWith('cancel:') ? 'cancel_job' : 'retry_job',
                    jobId: form.slice(form.indexOf(':') + 1),
                    ...evidence,
                  },
                  form.startsWith('cancel:')
                    ? t('Job cancelled', 'أُلغيت المهمة')
                    : t('Job re-queued', 'أُعيدت المهمة إلى الانتظار'),
                )
              }
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'routers' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('Routers', 'الراوترات')}</h2>
            <Button variant="primary" disabled={busy} onClick={() => setForm('router')}>
              {t('Register router', 'تسجيل راوتر')}
            </Button>
          </div>
          <p className="network-note">
            {t(
              'Router changes need the network approval authority and a fresh MFA code. The access reference must point at a secret file mounted on the Network Worker.',
              'تغييرات الراوتر تحتاج سلطة اعتماد الشبكة ورمز تحقق حديثاً. يجب أن يشير مرجع الوصول إلى ملف سري مثبت على عامل الشبكة.',
            )}
          </p>
          {data.routers.length === 0 ? (
            <p className="network-note">{t('No routers registered.', 'لا توجد راوترات مسجلة.')}</p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--routers">
                <span role="columnheader">{t('Router', 'الراوتر')}</span>
                <span role="columnheader">{t('Endpoint', 'نقطة الاتصال')}</span>
                <span role="columnheader">{t('Connector', 'الموصّل')}</span>
                <span role="columnheader">{t('Bound services', 'خدمات مرتبطة')}</span>
                <span role="columnheader">{t('Open jobs', 'مهام مفتوحة')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
              </div>
              {data.routers.map((router) => (
                <button
                  type="button"
                  role="row"
                  key={router.routerId}
                  className="network-table__row--routers"
                  onClick={() => setForm(`router:${router.routerId}`)}
                >
                  <span role="cell" dir="ltr">
                    {router.routerId}
                  </span>
                  <span role="cell" dir="ltr">
                    {router.endpoint}
                  </span>
                  <span role="cell" dir="ltr">
                    {router.connector}
                  </span>
                  <span role="cell">{router.boundServices}</span>
                  <span role="cell">{router.openJobs}</span>
                  <span role="cell">
                    <StatusBadge tone={router.enabled ? 'positive' : 'neutral'}>
                      {router.enabled ? t('Enabled', 'مفعّل') : t('Disabled', 'معطّل')}
                    </StatusBadge>
                  </span>
                </button>
              ))}
            </div>
          )}
          {form === 'router' || form?.startsWith('router:') ? (
            <RouterForm
              t={t}
              busy={busy}
              current={data.routers.find((r) => r.routerId === form.slice(7))}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run('network/infrastructure', command, t('Router saved', 'تم حفظ الراوتر'))
              }
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'bindings' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('Service bindings', 'ربط الخدمات')}</h2>
            <Button
              variant="primary"
              disabled={busy || data.routers.length === 0}
              onClick={() => setForm('binding')}
            >
              {t('Bind a service', 'ربط خدمة')}
            </Button>
          </div>
          {data.bindings.length === 0 ? (
            <p className="network-note">
              {t(
                'No service is bound to a router yet. Binding a service is what lets activation, suspension and profile changes reach the router.',
                'لا توجد خدمة مرتبطة براوتر بعد. ربط الخدمة هو ما يتيح للتفعيل والتعليق وتغيير الملف الوصول إلى الراوتر.',
              )}
            </p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--bindings">
                <span role="columnheader">{t('Service', 'الخدمة')}</span>
                <span role="columnheader">{t('Router', 'الراوتر')}</span>
                <span role="columnheader">{t('PPPoE account', 'حساب PPPoE')}</span>
                <span role="columnheader">{t('Addressing', 'العنونة')}</span>
                <span role="columnheader">{t('VLAN', 'VLAN')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
              </div>
              {data.bindings.map((binding) => (
                <div role="row" key={binding.serviceId} className="network-table__row--bindings">
                  <span role="cell">
                    {binding.serviceNumber}
                    <br />
                    <small>
                      {binding.subscriberName} · {binding.serviceStatus}
                    </small>
                  </span>
                  <span role="cell" dir="ltr">
                    {binding.routerId}
                  </span>
                  <span role="cell" dir="ltr">
                    {binding.accountName}
                  </span>
                  <span role="cell" dir="ltr">
                    {binding.staticAddress
                      ? `${t('static', 'ثابت')} ${binding.staticAddress}`
                      : `${t('pool', 'مجمّع')} ${binding.poolId ?? ''}`}
                  </span>
                  <span role="cell" dir="ltr">
                    {binding.vlanId ?? '—'}
                  </span>
                  <span role="cell">
                    <StatusBadge tone={binding.enabled ? 'positive' : 'neutral'}>
                      {binding.enabled ? t('Enabled', 'مفعّل') : t('Disabled', 'معطّل')}
                    </StatusBadge>
                  </span>
                </div>
              ))}
            </div>
          )}
          {form === 'binding' ? (
            <BindingForm
              t={t}
              busy={busy}
              data={data}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run('network/resources', command, t('Service bound', 'تم ربط الخدمة'))
              }
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'ipam' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('IP pools and allocations', 'مجمّعات العناوين والتخصيصات')}</h2>
            <Button variant="primary" disabled={busy} onClick={() => setForm('pool')}>
              {t('New pool', 'مجمّع جديد')}
            </Button>
          </div>
          {data.pools.length === 0 ? (
            <p className="network-note">{t('No pools yet.', 'لا توجد مجمّعات بعد.')}</p>
          ) : (
            <div className="network-pools">
              {data.pools.map((pool) => (
                <PoolCard
                  key={pool.id}
                  t={t}
                  pool={pool}
                  busy={busy}
                  onAllocate={() => setForm(`allocate:${pool.id}`)}
                  onEdit={() => setForm(`pool:${pool.id}`)}
                />
              ))}
            </div>
          )}
          {form === 'pool' || form?.startsWith('pool:') ? (
            <PoolForm
              t={t}
              busy={busy}
              current={data.pools.find((p) => p.id === form.slice(5))}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run('network/resources', command, t('Pool saved', 'تم حفظ المجمّع'))
              }
            />
          ) : null}
          {form?.startsWith('allocate:') ? (
            <AllocateForm
              t={t}
              busy={busy}
              poolId={form.slice(9)}
              data={data}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run('network/resources', command, t('Address allocated', 'تم تخصيص العنوان'))
              }
            />
          ) : null}
          <h3>{t('Live allocations', 'التخصيصات الحالية')}</h3>
          {data.allocations.filter((a) => a.status === 'allocated').length === 0 ? (
            <p className="network-note">{t('No live allocations.', 'لا توجد تخصيصات حالية.')}</p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--allocations">
                <span role="columnheader">{t('Address', 'العنوان')}</span>
                <span role="columnheader">{t('Kind', 'النوع')}</span>
                <span role="columnheader">{t('Service / label', 'الخدمة / التسمية')}</span>
                <span role="columnheader">{t('Since', 'منذ')}</span>
                <span role="columnheader">{t('Control', 'التحكم')}</span>
              </div>
              {data.allocations
                .filter((a) => a.status === 'allocated')
                .map((allocation) => (
                  <div role="row" key={allocation.id} className="network-table__row--allocations">
                    <span role="cell" dir="ltr">
                      {allocation.address}
                    </span>
                    <span role="cell">{allocation.kind}</span>
                    <span role="cell">{allocation.serviceNumber ?? allocation.label ?? '—'}</span>
                    <span role="cell">{time(allocation.allocatedAt)}</span>
                    <span role="cell">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setForm(`release:${allocation.id}`)}
                      >
                        {t('Release', 'تحرير')}
                      </Button>
                    </span>
                  </div>
                ))}
            </div>
          )}
          {form?.startsWith('release:') ? (
            <EvidenceForm
              t={t}
              title={t('Release address', 'تحرير العنوان')}
              submitLabel={t('Release', 'تحرير')}
              busy={busy}
              onCancel={() => setForm(undefined)}
              onSubmit={(evidence) =>
                void run(
                  'network/resources',
                  { action: 'release_address', allocationId: form.slice(8), ...evidence },
                  t('Address released', 'تم تحرير العنوان'),
                )
              }
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'nas' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('NAS clients and RADIUS sessions', 'أجهزة NAS وجلسات RADIUS')}</h2>
            <Button variant="primary" disabled={busy} onClick={() => setForm('nas')}>
              {t('Add NAS client', 'إضافة NAS')}
            </Button>
          </div>
          {data.nasClients.length === 0 ? (
            <p className="network-note">
              {t(
                'No NAS clients registered. Accounting from unregistered devices is refused.',
                'لا توجد أجهزة NAS مسجلة. تُرفض المحاسبة من أجهزة غير مسجلة.',
              )}
            </p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--nas">
                <span role="columnheader">{t('NAS', 'NAS')}</span>
                <span role="columnheader">{t('IP', 'العنوان')}</span>
                <span role="columnheader">{t('Type', 'النوع')}</span>
                <span role="columnheader">{t('Active sessions', 'جلسات نشطة')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
              </div>
              {data.nasClients.map((nas) => (
                <button
                  type="button"
                  role="row"
                  key={nas.id}
                  className="network-table__row--nas"
                  onClick={() => setForm(`nas:${nas.id}`)}
                >
                  <span role="cell">
                    {nas.nasName}
                    {nas.description ? (
                      <>
                        <br />
                        <small>{nas.description}</small>
                      </>
                    ) : null}
                  </span>
                  <span role="cell" dir="ltr">
                    {nas.ipAddress}
                  </span>
                  <span role="cell" dir="ltr">
                    {nas.nasType}
                  </span>
                  <span role="cell">{nas.activeSessions}</span>
                  <span role="cell">
                    <StatusBadge tone={nas.active ? 'positive' : 'neutral'}>
                      {nas.active ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                    </StatusBadge>
                  </span>
                </button>
              ))}
            </div>
          )}
          {form === 'nas' || form?.startsWith('nas:') ? (
            <NasForm
              t={t}
              busy={busy}
              current={data.nasClients.find((n) => n.id === form.slice(4))}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run(
                  'network/infrastructure',
                  command,
                  t('NAS client saved', 'تم حفظ جهاز NAS'),
                )
              }
            />
          ) : null}
          <h3>{t('Recent sessions', 'الجلسات الأخيرة')}</h3>
          {data.sessions.length === 0 ? (
            <p className="network-note">
              {t('No accounting sessions recorded yet.', 'لم تُسجَّل جلسات محاسبة بعد.')}
            </p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--sessions">
                <span role="columnheader">{t('Username', 'اسم المستخدم')}</span>
                <span role="columnheader">{t('Service', 'الخدمة')}</span>
                <span role="columnheader">{t('Framed IP', 'العنوان')}</span>
                <span role="columnheader">{t('Started', 'بدأت')}</span>
                <span role="columnheader">{t('Traffic in / out', 'الحركة وارد / صادر')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
              </div>
              {data.sessions.map((s) => (
                <div role="row" key={s.id} className="network-table__row--sessions">
                  <span role="cell" dir="ltr">
                    {s.username}
                  </span>
                  <span role="cell">{s.serviceNumber ?? '—'}</span>
                  <span role="cell" dir="ltr">
                    {s.framedIpAddress ?? '—'}
                  </span>
                  <span role="cell">{time(s.startedAt)}</span>
                  <span role="cell" dir="ltr">
                    {formatBytes(s.inputOctets)} / {formatBytes(s.outputOctets)}
                  </span>
                  <span role="cell">
                    <StatusBadge tone={s.stoppedAt ? 'neutral' : 'positive'}>
                      {s.stoppedAt ? t('Ended', 'انتهت') : t('Online', 'متصل')}
                    </StatusBadge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'cpe' ? (
        <section className="network-card">
          <div className="network-card__header">
            <h2>{t('CPE devices', 'أجهزة العميل')}</h2>
            <Button variant="primary" disabled={busy} onClick={() => setForm('cpe')}>
              {t('Register CPE', 'تسجيل جهاز')}
            </Button>
          </div>
          {data.cpeDevices.length === 0 ? (
            <p className="network-note">{t('No CPE registered.', 'لا توجد أجهزة مسجلة.')}</p>
          ) : (
            <div className="network-table" role="table">
              <div role="row" className="network-table__head network-table__row--cpe">
                <span role="columnheader">{t('Serial', 'الرقم التسلسلي')}</span>
                <span role="columnheader">{t('Model', 'الطراز')}</span>
                <span role="columnheader">{t('Service', 'الخدمة')}</span>
                <span role="columnheader">{t('Firmware', 'البرنامج الثابت')}</span>
                <span role="columnheader">{t('Last inform', 'آخر اتصال')}</span>
                <span role="columnheader">{t('State', 'الحالة')}</span>
              </div>
              {data.cpeDevices.map((cpe) => (
                <button
                  type="button"
                  role="row"
                  key={cpe.id}
                  className="network-table__row--cpe"
                  onClick={() => setForm(`cpe:${cpe.id}`)}
                >
                  <span role="cell" dir="ltr">
                    {cpe.serialNumber}
                  </span>
                  <span role="cell">{cpe.model ?? '—'}</span>
                  <span role="cell">{cpe.serviceNumber ?? t('Unassigned', 'غير معيّن')}</span>
                  <span role="cell" dir="ltr">
                    {cpe.firmwareVersion ?? '—'}
                  </span>
                  <span role="cell">{time(cpe.lastInformAt)}</span>
                  <span role="cell">
                    <StatusBadge tone={cpe.status === 'online' ? 'positive' : 'neutral'}>
                      {cpe.status === 'online' ? t('Online', 'متصل') : t('Offline', 'غير متصل')}
                    </StatusBadge>
                  </span>
                </button>
              ))}
            </div>
          )}
          {form === 'cpe' || form?.startsWith('cpe:') ? (
            <CpeForm
              t={t}
              busy={busy}
              data={data}
              current={data.cpeDevices.find((c) => c.id === form.slice(4))}
              onCancel={() => setForm(undefined)}
              onSubmit={(command) =>
                void run('network/resources', command, t('CPE saved', 'تم حفظ الجهاز'))
              }
            />
          ) : null}
        </section>
      ) : null}

      <section className="network-card">
        <h2>{t('Change history', 'سجل التغييرات')}</h2>
        {data.events.length === 0 ? (
          <p className="network-note">
            {t('No changes recorded yet.', 'لا توجد تغييرات مسجلة بعد.')}
          </p>
        ) : (
          <ol className="network-timeline">
            {data.events.slice(0, 30).map((event) => (
              <li key={event.id}>
                <time dateTime={event.occurredAt}>{time(event.occurredAt)}</time>
                <strong dir="ltr">{event.action.replaceAll('_', ' ')}</strong>
                <span dir="ltr">
                  {event.resourceType} · {event.resourceId.slice(0, 12)}
                </span>
                <span dir="auto">{rtl ? event.reasonAr : event.reasonEn}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} kB`;
  return `${value} B`;
}
function key(): string {
  return `web-network-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
function readEvidence(form: FormData) {
  return {
    reasonEn: text(form, 'reasonEn'),
    reasonAr: text(form, 'reasonAr'),
    evidence: text(form, 'evidence'),
  };
}

function EvidenceFields({ t, prefix }: { readonly t: Translate; readonly prefix: string }) {
  return (
    <div className="network-grid">
      <label className="network-field">
        <span>{t('Reason (English)', 'السبب (بالإنجليزية)')}</span>
        <input
          name="reasonEn"
          id={`${prefix}-reason-en`}
          required
          minLength={8}
          maxLength={1000}
          dir="ltr"
        />
      </label>
      <label className="network-field">
        <span>{t('Reason (Arabic)', 'السبب (بالعربية)')}</span>
        <input
          name="reasonAr"
          id={`${prefix}-reason-ar`}
          required
          minLength={8}
          maxLength={1000}
          dir="rtl"
        />
      </label>
      <label className="network-field network-field--wide">
        <span>{t('Evidence reference', 'مرجع الدليل')}</span>
        <input name="evidence" id={`${prefix}-evidence`} required minLength={8} maxLength={2000} />
      </label>
    </div>
  );
}

function EvidenceForm({
  t,
  title,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly title: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (evidence: ReturnType<typeof readEvidence>) => void;
}) {
  return (
    <form
      className="network-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readEvidence(new FormData(event.currentTarget)));
      }}
      aria-busy={busy}
    >
      <h3>{title}</h3>
      <EvidenceFields t={t} prefix="evidence" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function RouterForm({
  t,
  busy,
  current,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly current?: Workspace['routers'][number];
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkInfrastructureCommand) => void;
}) {
  return (
    <form
      className="network-form"
      key={current?.routerId ?? 'new'}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          action: current ? 'update_router' : 'register_router',
          routerId: current?.routerId ?? text(form, 'routerId'),
          endpoint: text(form, 'endpoint'),
          routerAccessReference: text(form, 'routerAccessReference'),
          connector: text(form, 'connector') as NetworkInfrastructureCommand extends {
            connector: infer C;
          }
            ? C
            : never,
          enabled: form.get('enabled') === 'on',
          ...readEvidence(form),
        });
      }}
    >
      <h3>{current ? t('Update router', 'تحديث الراوتر') : t('Register router', 'تسجيل راوتر')}</h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Router id', 'معرّف الراوتر')}</span>
          <input
            name="routerId"
            required
            defaultValue={current?.routerId ?? ''}
            disabled={Boolean(current)}
            dir="ltr"
            placeholder="core-1"
          />
        </label>
        <label className="network-field">
          <span>{t('HTTPS endpoint', 'نقطة اتصال HTTPS')}</span>
          <input
            name="endpoint"
            required
            type="url"
            defaultValue={current?.endpoint ?? ''}
            dir="ltr"
            placeholder="https://router.example.com/rest"
          />
        </label>
        <label className="network-field">
          <span>{t('Access reference (secret://…)', 'مرجع الوصول (secret://…)')}</span>
          <input
            name="routerAccessReference"
            required
            defaultValue={current?.credentialReference ?? ''}
            dir="ltr"
            placeholder="secret://routers/core-1"
          />
        </label>
        <label className="network-field">
          <span>{t('Connector', 'الموصّل')}</span>
          <select name="connector" defaultValue={current?.connector ?? 'routeros-rest'}>
            <option value="routeros-rest">RouterOS REST</option>
            <option value="routeros-api">RouterOS API</option>
            <option value="simulator">
              {t('Simulator (non-production)', 'محاكي (غير إنتاجي)')}
            </option>
          </select>
        </label>
        <label className="network-check">
          <input type="checkbox" name="enabled" defaultChecked={current?.enabled ?? true} />
          <span>{t('Enabled', 'مفعّل')}</span>
        </label>
      </div>
      <EvidenceFields t={t} prefix="router" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save router', 'حفظ الراوتر')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function NasForm({
  t,
  busy,
  current,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly current?: Workspace['nasClients'][number];
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkInfrastructureCommand) => void;
}) {
  return (
    <form
      className="network-form"
      key={current?.id ?? 'new'}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          action: 'upsert_nas_client',
          ...(current ? { nasClientId: current.id, expectedVersion: current.version } : {}),
          nasName: text(form, 'nasName'),
          ipAddress: text(form, 'ipAddress'),
          nasKeyReference: text(form, 'nasKeyReference'),
          nasType: text(form, 'nasType') as 'mikrotik' | 'cisco' | 'huawei' | 'other',
          ...(text(form, 'description') ? { description: text(form, 'description') } : {}),
          active: form.get('active') === 'on',
          ...readEvidence(form),
        });
      }}
    >
      <h3>
        {current ? t('Update NAS client', 'تحديث جهاز NAS') : t('Add NAS client', 'إضافة جهاز NAS')}
      </h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Name', 'الاسم')}</span>
          <input name="nasName" required minLength={2} defaultValue={current?.nasName ?? ''} />
        </label>
        <label className="network-field">
          <span>{t('IP address', 'عنوان IP')}</span>
          <input name="ipAddress" required defaultValue={current?.ipAddress ?? ''} dir="ltr" />
        </label>
        <label className="network-field">
          <span>{t('Shared key reference (secret://…)', 'مرجع المفتاح المشترك (secret://…)')}</span>
          <input
            name="nasKeyReference"
            required
            defaultValue={current?.secretReference ?? ''}
            dir="ltr"
            placeholder="secret://nas/core-1"
          />
        </label>
        <label className="network-field">
          <span>{t('Type', 'النوع')}</span>
          <select name="nasType" defaultValue={current?.nasType ?? 'mikrotik'}>
            <option value="mikrotik">MikroTik</option>
            <option value="cisco">Cisco</option>
            <option value="huawei">Huawei</option>
            <option value="other">{t('Other', 'أخرى')}</option>
          </select>
        </label>
        <label className="network-field network-field--wide">
          <span>{t('Description', 'الوصف')}</span>
          <input name="description" maxLength={500} defaultValue={current?.description ?? ''} />
        </label>
        <label className="network-check">
          <input type="checkbox" name="active" defaultChecked={current?.active ?? true} />
          <span>{t('Active', 'نشط')}</span>
        </label>
      </div>
      <EvidenceFields t={t} prefix="nas" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save NAS client', 'حفظ جهاز NAS')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function PoolCard({
  t,
  pool,
  busy,
  onAllocate,
  onEdit,
}: {
  readonly t: Translate;
  readonly pool: IpPoolSummary;
  readonly busy: boolean;
  readonly onAllocate: () => void;
  readonly onEdit: () => void;
}) {
  const ratio = pool.usable ? Math.min(100, Math.round((pool.allocated / pool.usable) * 100)) : 0;
  return (
    <div className="network-pool">
      <div className="network-pool__head">
        <strong dir="ltr">{pool.poolName}</strong>
        <StatusBadge tone={pool.active ? 'positive' : 'neutral'}>
          {pool.active ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
        </StatusBadge>
      </div>
      <span dir="ltr">
        {pool.subnetCidr} · {pool.purpose.replaceAll('_', ' ')}
        {pool.vlanId ? ` · VLAN ${pool.vlanId}` : ''}
      </span>
      <div className="network-pool__bar" aria-hidden="true">
        <span style={{ inlineSize: `${ratio}%` }} />
      </div>
      <small>
        {pool.usable !== null && pool.usable !== undefined
          ? t(
              `${pool.allocated} of ${pool.usable} addresses allocated`,
              `${pool.allocated} من ${pool.usable} عنواناً مخصص`,
            )
          : t(`${pool.allocated} allocations`, `${pool.allocated} تخصيصاً`)}
      </small>
      <div className="network-actions">
        <Button variant="secondary" disabled={busy || !pool.active} onClick={onAllocate}>
          {t('Allocate', 'تخصيص')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onEdit}>
          {t('Edit', 'تعديل')}
        </Button>
      </div>
    </div>
  );
}

function PoolForm({
  t,
  busy,
  current,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly current?: IpPoolSummary;
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkResourceCommand) => void;
}) {
  return (
    <form
      className="network-form"
      key={current?.id ?? 'new'}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const shared = {
          poolName: text(form, 'poolName'),
          subnetCidr: text(form, 'subnetCidr'),
          ...(text(form, 'gateway') ? { gateway: text(form, 'gateway') } : {}),
          ...(text(form, 'vlanId') ? { vlanId: Number(text(form, 'vlanId')) } : {}),
          purpose: text(form, 'purpose') as IpPoolSummary['purpose'],
          ...(text(form, 'description') ? { description: text(form, 'description') } : {}),
          active: form.get('active') === 'on',
          ...readEvidence(form),
        };
        onSubmit(
          current
            ? {
                action: 'update_ip_pool',
                poolId: current.id,
                expectedVersion: current.version,
                ...shared,
              }
            : { action: 'create_ip_pool', ...shared },
        );
      }}
    >
      <h3>{current ? t('Edit pool', 'تعديل المجمّع') : t('New IP pool', 'مجمّع عناوين جديد')}</h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Pool name', 'اسم المجمّع')}</span>
          <input
            name="poolName"
            required
            minLength={2}
            defaultValue={current?.poolName ?? ''}
            dir="ltr"
          />
        </label>
        <label className="network-field">
          <span>{t('Subnet (CIDR)', 'الشبكة الفرعية (CIDR)')}</span>
          <input
            name="subnetCidr"
            required
            defaultValue={current?.subnetCidr ?? ''}
            dir="ltr"
            placeholder="10.20.0.0/22"
          />
        </label>
        <label className="network-field">
          <span>{t('Gateway', 'البوابة')}</span>
          <input name="gateway" defaultValue={current?.gateway ?? ''} dir="ltr" />
        </label>
        <label className="network-field">
          <span>VLAN</span>
          <input
            name="vlanId"
            type="number"
            min={1}
            max={4094}
            defaultValue={current?.vlanId ?? ''}
            dir="ltr"
          />
        </label>
        <label className="network-field">
          <span>{t('Purpose', 'الغرض')}</span>
          <select name="purpose" defaultValue={current?.purpose ?? 'pppoe_dynamic'}>
            <option value="pppoe_dynamic">{t('PPPoE dynamic', 'PPPoE ديناميكي')}</option>
            <option value="static_public">{t('Static public', 'عام ثابت')}</option>
            <option value="cgnat">CGNAT</option>
            <option value="management">{t('Management', 'إدارة')}</option>
            <option value="infrastructure">{t('Infrastructure', 'بنية تحتية')}</option>
          </select>
        </label>
        <label className="network-field network-field--wide">
          <span>{t('Description', 'الوصف')}</span>
          <input name="description" maxLength={500} defaultValue={current?.description ?? ''} />
        </label>
        <label className="network-check">
          <input type="checkbox" name="active" defaultChecked={current?.active ?? true} />
          <span>{t('Active', 'نشط')}</span>
        </label>
      </div>
      <EvidenceFields t={t} prefix="pool" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save pool', 'حفظ المجمّع')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function AllocateForm({
  t,
  busy,
  poolId,
  data,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly poolId: string;
  readonly data: Workspace;
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkResourceCommand) => void;
}) {
  const [mode, setMode] = useState<'service' | 'reserved'>('service');
  return (
    <form
      className="network-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const address = text(form, 'address');
        onSubmit(
          mode === 'service'
            ? {
                action: 'allocate_service_address',
                poolId,
                serviceId: text(form, 'serviceId'),
                ...(address ? { address } : {}),
                ...(text(form, 'label') ? { label: text(form, 'label') } : {}),
                ...readEvidence(form),
              }
            : {
                action: 'reserve_address',
                poolId,
                ...(address ? { address } : {}),
                kind: text(form, 'kind') as 'reserved' | 'gateway' | 'infrastructure',
                ...(text(form, 'label') ? { label: text(form, 'label') } : {}),
                ...readEvidence(form),
              },
        );
      }}
    >
      <h3>{t('Allocate an address', 'تخصيص عنوان')}</h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Allocation', 'التخصيص')}</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="service">{t('For a subscriber service', 'لخدمة مشترك')}</option>
            <option value="reserved">{t('Reserved / infrastructure', 'محجوز / بنية تحتية')}</option>
          </select>
        </label>
        {mode === 'service' ? (
          <label className="network-field">
            <span>{t('Service', 'الخدمة')}</span>
            <select name="serviceId" required defaultValue="">
              <option value="">{t('Choose a service', 'اختر خدمة')}</option>
              {data.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.serviceNumber} · {service.subscriberName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="network-field">
            <span>{t('Kind', 'النوع')}</span>
            <select name="kind" defaultValue="reserved">
              <option value="reserved">{t('Reserved', 'محجوز')}</option>
              <option value="gateway">{t('Gateway', 'بوابة')}</option>
              <option value="infrastructure">{t('Infrastructure', 'بنية تحتية')}</option>
            </select>
          </label>
        )}
        <label className="network-field">
          <span>
            {t(
              'Specific address (optional; next free otherwise)',
              'عنوان محدد (اختياري؛ وإلا أول عنوان حر)',
            )}
          </span>
          <input name="address" dir="ltr" />
        </label>
        <label className="network-field">
          <span>{t('Label', 'التسمية')}</span>
          <input name="label" maxLength={120} />
        </label>
      </div>
      <EvidenceFields t={t} prefix="allocate" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Allocate address', 'تخصيص العنوان')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function BindingForm({
  t,
  busy,
  data,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly data: Workspace;
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkResourceCommand) => void;
}) {
  const [mode, setMode] = useState<'pool' | 'static'>('pool');
  return (
    <form
      className="network-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit({
          action: 'bind_service',
          serviceId: text(form, 'serviceId'),
          routerId: text(form, 'routerId'),
          accountName: text(form, 'accountName'),
          pppAccessReference: text(form, 'pppAccessReference'),
          ...(mode === 'pool'
            ? { poolId: text(form, 'poolId') }
            : { staticAddress: text(form, 'staticAddress') }),
          ...(text(form, 'vlanId') ? { vlanId: text(form, 'vlanId') } : {}),
          enabled: form.get('enabled') === 'on',
          ...readEvidence(form),
        });
      }}
    >
      <h3>{t('Bind a service to a router', 'ربط خدمة براوتر')}</h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Service', 'الخدمة')}</span>
          <select name="serviceId" required defaultValue="">
            <option value="">{t('Choose a service', 'اختر خدمة')}</option>
            {data.services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.serviceNumber} · {service.subscriberName}
              </option>
            ))}
          </select>
        </label>
        <label className="network-field">
          <span>{t('Router', 'الراوتر')}</span>
          <select name="routerId" required defaultValue="">
            <option value="">{t('Choose a router', 'اختر راوتر')}</option>
            {data.routers
              .filter((r) => r.enabled)
              .map((router) => (
                <option key={router.routerId} value={router.routerId}>
                  {router.routerId}
                </option>
              ))}
          </select>
        </label>
        <label className="network-field">
          <span>{t('PPPoE account name', 'اسم حساب PPPoE')}</span>
          <input name="accountName" required dir="ltr" />
        </label>
        <label className="network-field">
          <span>
            {t('PPPoE password reference (secret://…)', 'مرجع كلمة مرور PPPoE (secret://…)')}
          </span>
          <input name="pppAccessReference" required dir="ltr" placeholder="secret://ppp/account" />
        </label>
        <label className="network-field">
          <span>{t('Addressing', 'العنونة')}</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="pool">
              {t('Dynamic from router pool', 'ديناميكي من مجمّع الراوتر')}
            </option>
            <option value="static">
              {t('Static (allocated to this service)', 'ثابت (مخصص لهذه الخدمة)')}
            </option>
          </select>
        </label>
        {mode === 'pool' ? (
          <label className="network-field">
            <span>{t('Router pool id', 'معرّف مجمّع الراوتر')}</span>
            <input name="poolId" required dir="ltr" placeholder="pppoe-pool" />
          </label>
        ) : (
          <label className="network-field">
            <span>{t('Static address', 'العنوان الثابت')}</span>
            <select name="staticAddress" required defaultValue="">
              <option value="">{t('Choose an allocated address', 'اختر عنواناً مخصصاً')}</option>
              {data.allocations
                .filter((a) => a.status === 'allocated' && a.kind === 'service')
                .map((a) => (
                  <option key={a.id} value={a.address}>
                    {a.address} · {a.serviceNumber}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="network-field">
          <span>VLAN</span>
          <input name="vlanId" dir="ltr" />
        </label>
        <label className="network-check">
          <input type="checkbox" name="enabled" defaultChecked />
          <span>{t('Enabled', 'مفعّل')}</span>
        </label>
      </div>
      <EvidenceFields t={t} prefix="binding" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save binding', 'حفظ الربط')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function CpeForm({
  t,
  busy,
  data,
  current,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly busy: boolean;
  readonly data: Workspace;
  readonly current?: Workspace['cpeDevices'][number];
  readonly onCancel: () => void;
  readonly onSubmit: (command: NetworkResourceCommand) => void;
}) {
  return (
    <form
      className="network-form"
      key={current?.id ?? 'new'}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const shared = {
          ...(text(form, 'model') ? { model: text(form, 'model') } : {}),
          ...(text(form, 'oui') ? { oui: text(form, 'oui') } : {}),
          ...(text(form, 'tr069DeviceId') ? { tr069DeviceId: text(form, 'tr069DeviceId') } : {}),
          ...(text(form, 'serviceId') ? { serviceId: text(form, 'serviceId') } : {}),
          ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
          ...readEvidence(form),
        };
        onSubmit(
          current
            ? {
                action: 'update_cpe',
                cpeId: current.id,
                expectedVersion: current.version,
                ...shared,
              }
            : { action: 'register_cpe', serialNumber: text(form, 'serialNumber'), ...shared },
        );
      }}
    >
      <h3>{current ? t('Update CPE', 'تحديث الجهاز') : t('Register CPE', 'تسجيل جهاز')}</h3>
      <div className="network-grid">
        <label className="network-field">
          <span>{t('Serial number', 'الرقم التسلسلي')}</span>
          <input
            name="serialNumber"
            required
            minLength={2}
            defaultValue={current?.serialNumber ?? ''}
            disabled={Boolean(current)}
            dir="ltr"
          />
        </label>
        <label className="network-field">
          <span>{t('Model', 'الطراز')}</span>
          <input name="model" defaultValue={current?.model ?? ''} />
        </label>
        <label className="network-field">
          <span>OUI</span>
          <input name="oui" defaultValue={current?.oui ?? ''} dir="ltr" />
        </label>
        <label className="network-field">
          <span>{t('TR-069 device id', 'معرّف TR-069')}</span>
          <input name="tr069DeviceId" defaultValue={current?.tr069DeviceId ?? ''} dir="ltr" />
        </label>
        <label className="network-field">
          <span>{t('Assigned service', 'الخدمة المعيّنة')}</span>
          <select name="serviceId" defaultValue={current?.serviceId ?? ''}>
            <option value="">{t('Unassigned', 'غير معيّن')}</option>
            {data.services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.serviceNumber} · {service.subscriberName}
              </option>
            ))}
          </select>
        </label>
        <label className="network-field network-field--wide">
          <span>{t('Notes', 'ملاحظات')}</span>
          <input name="notes" maxLength={1000} defaultValue={current?.notes ?? ''} />
        </label>
      </div>
      <EvidenceFields t={t} prefix="cpe" />
      <div className="network-actions">
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save CPE', 'حفظ الجهاز')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}
