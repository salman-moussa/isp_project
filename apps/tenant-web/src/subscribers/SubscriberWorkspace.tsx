import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  PageHeader,
  StatePanel,
  StatusBadge,
  Surface,
  type ApiSession,
  type Locale,
} from '@isp/ui';
import {
  readSubscriberWorkspace,
  type SubscriberWorkspaceData,
  type SubscriberWorkspaceSubscriber,
} from '../api';
import './subscriber.css';

export function SubscriberWorkspace({
  locale,
  session,
  onNavigate,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
  readonly onNavigate: (route: string) => void;
}) {
  const isEnglish = locale === 'en';
  const [data, setData] = useState<SubscriberWorkspaceData>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string>();

  const load = () => {
    setState('loading');
    void readSubscriberWorkspace(session)
      .then((workspace) => {
        setData(workspace);
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, [session]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale === 'en' ? 'en' : 'ar');
    return (data?.subscribers ?? []).filter(
      (subscriber) =>
        (status === 'all' || subscriber.status === status) &&
        (!needle ||
          [
            subscriber.subscriberNumber,
            subscriber.displayName,
            subscriber.addressLine,
            ...subscriber.contacts.map((contact) => contact.value),
          ].some((value) =>
            value.toLocaleLowerCase(locale === 'en' ? 'en' : 'ar').includes(needle),
          )),
    );
  }, [data, locale, query, status]);
  const selected = filtered.find((subscriber) => subscriber.id === selectedId) ?? filtered[0];

  if (state !== 'ready' || !data) {
    return (
      <StatePanel
        variant={state === 'error' ? 'error' : 'loading'}
        title={
          state === 'error'
            ? isEnglish
              ? 'Subscriber workspace unavailable'
              : 'مساحة المشتركين غير متاحة'
            : isEnglish
              ? 'Loading subscriber operations'
              : 'جارٍ تحميل عمليات المشتركين'
        }
        description={
          state === 'error'
            ? isEnglish
              ? 'The governed subscriber records could not be read.'
              : 'تعذّرت قراءة سجلات المشتركين المحكومة.'
            : isEnglish
              ? 'Reading only records permitted by your branch, area, and route scope.'
              : 'تتم قراءة السجلات المسموحة ضمن نطاق الفرع والمنطقة والمسار فقط.'
        }
        actionLabel={state === 'error' ? (isEnglish ? 'Retry' : 'إعادة المحاولة') : undefined}
        onAction={state === 'error' ? load : undefined}
      />
    );
  }

  const activeServices = data.services.filter((service) => service.status === 'active').length;
  const openIssues = data.issues.filter(
    (issue) => !['resolved', 'closed'].includes(issue.status),
  ).length;
  const outstanding = data.invoices.reduce(
    (totals, invoice) => ({
      ...totals,
      [invoice.currency]: totals[invoice.currency] + invoice.outstandingMinor,
    }),
    { USD: 0, LBP: 0 },
  );

  return (
    <div className="subscriber-workspace">
      <PageHeader
        eyebrow={
          isEnglish ? 'Subscriber 360 · Internal operations' : 'المشترك ٣٦٠ · العمليات الداخلية'
        }
        title={
          isEnglish ? 'Find, understand, and serve every subscriber' : 'ابحث وافهم واخدم كل مشترك'
        }
        description={
          isEnglish
            ? 'One governed record for contacts, service location, plans, activation, balance, and support history. This is an employee workspace—not a subscriber portal.'
            : 'سجل محكوم واحد لجهات الاتصال وموقع الخدمة والباقات والتفعيل والرصيد والدعم. هذه مساحة للموظفين وليست بوابة للمشترك.'
        }
        actions={
          <Button variant="primary" onClick={() => onNavigate('sales')}>
            {isEnglish ? 'Open acquisition & orders' : 'فتح المبيعات والطلبات'}
          </Button>
        }
      />

      <section
        className="subscriber-pulse"
        aria-label={isEnglish ? 'Subscriber totals' : 'إجماليات المشتركين'}
      >
        <Metric
          label={isEnglish ? 'Visible subscribers' : 'المشتركون المتاحون'}
          value={data.subscribers.length}
        />
        <Metric label={isEnglish ? 'Active services' : 'الخدمات الفعّالة'} value={activeServices} />
        <Metric
          label={isEnglish ? 'Open support issues' : 'طلبات الدعم المفتوحة'}
          value={openIssues}
          tone={openIssues ? 'warning' : 'positive'}
        />
        <Metric
          label={isEnglish ? 'USD outstanding' : 'الرصيد بالدولار'}
          value={money(outstanding.USD, 'USD', locale)}
        />
        <Metric
          label={isEnglish ? 'LBP outstanding' : 'الرصيد بالليرة'}
          value={money(outstanding.LBP, 'LBP', locale)}
        />
      </section>

      <div className="subscriber-filters">
        <label>
          <span>
            {isEnglish
              ? 'Search subscriber, phone, or address'
              : 'ابحث بالمشترك أو الهاتف أو العنوان'}
          </span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
        </label>
        <label>
          <span>{isEnglish ? 'Subscriber status' : 'حالة المشترك'}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">{isEnglish ? 'All statuses' : 'كل الحالات'}</option>
            {['lead', 'active', 'suspended', 'closed'].map((value) => (
              <option value={value} key={value}>
                {statusText(value, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!filtered.length ? (
        <section className="subscriber-empty">
          <h2>{isEnglish ? 'Search results' : 'نتائج البحث'}</h2>
          <StatePanel
            variant="empty"
            title={isEnglish ? 'No subscribers match' : 'لا يوجد مشتركون مطابقون'}
            description={
              isEnglish ? 'Change the search or status filter.' : 'غيّر البحث أو عامل تصفية الحالة.'
            }
          />
        </section>
      ) : (
        <div className="subscriber-layout">
          <Surface className="subscriber-directory">
            <div className="surface__header">
              <div>
                <h2>{isEnglish ? 'Subscriber directory' : 'دليل المشتركين'}</h2>
                <p>
                  {isEnglish
                    ? `${filtered.length} scoped records`
                    : `${filtered.length} سجلاً ضمن النطاق`}
                </p>
              </div>
            </div>
            <div className="subscriber-directory__list">
              {filtered.map((subscriber) => (
                <SubscriberButton
                  key={subscriber.id}
                  subscriber={subscriber}
                  locale={locale}
                  selected={subscriber.id === selected?.id}
                  onSelect={() => setSelectedId(subscriber.id)}
                />
              ))}
            </div>
          </Surface>
          {selected ? <SubscriberDetail locale={locale} data={data} subscriber={selected} /> : null}
        </div>
      )}
    </div>
  );
}

function SubscriberButton({
  subscriber,
  locale,
  selected,
  onSelect,
}: {
  readonly subscriber: SubscriberWorkspaceSubscriber;
  readonly locale: Locale;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : undefined}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span>
        <strong>{subscriber.displayName}</strong>
        <small>
          {subscriber.subscriberNumber} · {subscriber.routeCode}
        </small>
      </span>
      <StatusBadge
        tone={
          subscriber.status === 'active'
            ? 'positive'
            : subscriber.status === 'suspended'
              ? 'warning'
              : 'neutral'
        }
      >
        {statusText(subscriber.status, locale)}
      </StatusBadge>
    </button>
  );
}

function SubscriberDetail({
  locale,
  data,
  subscriber,
}: {
  readonly locale: Locale;
  readonly data: SubscriberWorkspaceData;
  readonly subscriber: SubscriberWorkspaceSubscriber;
}) {
  const isEnglish = locale === 'en';
  const services = data.services.filter((service) => service.subscriberId === subscriber.id);
  const invoices = data.invoices.filter((invoice) => invoice.subscriberId === subscriber.id);
  const issues = data.issues.filter((issue) => issue.subscriberId === subscriber.id);
  return (
    <div className="subscriber-detail">
      <Surface className="subscriber-identity">
        <div className="surface__header">
          <div>
            <small>{subscriber.subscriberNumber}</small>
            <h2>{subscriber.displayName}</h2>
            <p>
              {subscriber.householdReference} · {subscriber.householdName}
            </p>
          </div>
          <StatusBadge tone={subscriber.status === 'active' ? 'positive' : 'neutral'}>
            {statusText(subscriber.status, locale)}
          </StatusBadge>
        </div>
        <dl className="subscriber-facts">
          <Fact
            label={isEnglish ? 'Service address' : 'عنوان الخدمة'}
            value={`${subscriber.locationLabel} · ${subscriber.addressLine}`}
          />
          <Fact
            label={isEnglish ? 'Territory' : 'النطاق'}
            value={`${subscriber.branchCode} / ${subscriber.areaCode} / ${subscriber.routeCode}`}
          />
          <Fact
            label={isEnglish ? 'Created' : 'تاريخ الإنشاء'}
            value={new Date(subscriber.createdAt).toLocaleDateString(isEnglish ? 'en-LB' : 'ar-LB')}
          />
        </dl>
        <div className="subscriber-contacts">
          {subscriber.contacts.length ? (
            subscriber.contacts.map((contact) => (
              <span key={`${contact.kind}:${contact.value}`}>
                <small>{contact.kind}</small>
                <strong dir="auto">{contact.value}</strong>
              </span>
            ))
          ) : (
            <small>{isEnglish ? 'No active contact recorded' : 'لا توجد جهة اتصال فعّالة'}</small>
          )}
        </div>
      </Surface>

      <section className="subscriber-section">
        <h2>{isEnglish ? 'Services and network lifecycle' : 'الخدمات ودورة حياة الشبكة'}</h2>
        {services.length ? (
          services.map((service) => (
            <Surface key={service.id} className="subscriber-service-card">
              <div>
                <small>{service.serviceNumber}</small>
                <strong>{locale === 'en' ? service.planNameEn : service.planNameAr}</strong>
                <span>
                  {service.planCode} ·{' '}
                  {money(service.recurringAmountMinor, service.currency, locale)} ·{' '}
                  {isEnglish ? 'anchor' : 'يوم الفوترة'} {service.billingAnchorDay}
                </span>
              </div>
              <div>
                <StatusBadge
                  tone={
                    service.status === 'active'
                      ? 'positive'
                      : service.status === 'suspended'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {statusText(service.status, locale)}
                </StatusBadge>
                {service.installationStatus ? (
                  <small>
                    {isEnglish ? 'Installation' : 'التركيب'}:{' '}
                    {statusText(service.installationStatus, locale)}
                  </small>
                ) : null}
              </div>
            </Surface>
          ))
        ) : (
          <StatePanel
            variant="empty"
            title={isEnglish ? 'No service yet' : 'لا توجد خدمة بعد'}
            description={
              isEnglish
                ? 'The subscriber exists, but no service record is visible in this scope.'
                : 'المشترك موجود، لكن لا يظهر سجل خدمة ضمن هذا النطاق.'
            }
          />
        )}
      </section>

      <div className="subscriber-detail__columns">
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{isEnglish ? 'Invoices and balance' : 'الفواتير والرصيد'}</h2>
              <p>
                {isEnglish ? 'Original currencies remain separate' : 'تبقى العملات الأصلية منفصلة'}
              </p>
            </div>
          </div>
          <div className="subscriber-ledger">
            {invoices.length ? (
              invoices.map((invoice) => (
                <div key={invoice.id}>
                  <span>
                    <strong>{invoice.documentNumber}</strong>
                    <small>
                      {new Date(invoice.postedAt).toLocaleDateString(isEnglish ? 'en-LB' : 'ar-LB')}
                    </small>
                  </span>
                  <span>
                    <strong>{money(invoice.outstandingMinor, invoice.currency, locale)}</strong>
                    <small>{isEnglish ? 'outstanding' : 'متبقٍ'}</small>
                  </span>
                </div>
              ))
            ) : (
              <p>{isEnglish ? 'No posted invoice is linked.' : 'لا توجد فاتورة مرحلة مرتبطة.'}</p>
            )}
          </div>
        </Surface>
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{isEnglish ? 'Support history' : 'سجل الدعم'}</h2>
              <p>{isEnglish ? 'Open and recent issues' : 'الطلبات المفتوحة والحديثة'}</p>
            </div>
          </div>
          <div className="subscriber-ledger">
            {issues.length ? (
              issues.map((issue) => (
                <div key={issue.id}>
                  <span>
                    <strong>{issue.issueNumber}</strong>
                    <small>{issue.subject}</small>
                  </span>
                  <StatusBadge
                    tone={
                      issue.priority === 'urgent'
                        ? 'critical'
                        : issue.status === 'closed'
                          ? 'positive'
                          : 'warning'
                    }
                  >
                    {statusText(issue.status, locale)}
                  </StatusBadge>
                </div>
              ))
            ) : (
              <p>{isEnglish ? 'No support issue is linked.' : 'لا يوجد طلب دعم مرتبط.'}</p>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'primary',
}: {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: 'primary' | 'positive' | 'warning';
}) {
  return (
    <Surface className={`subscriber-metric subscriber-metric--${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </Surface>
  );
}
function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function money(minor: number, currency: 'USD' | 'LBP', locale: Locale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-LB' : 'ar-LB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  }).format(currency === 'USD' ? minor / 100 : minor);
}
function statusText(status: string, locale: Locale) {
  const labels: Record<string, { en: string; ar: string }> = {
    lead: { en: 'Lead', ar: 'محتمل' },
    active: { en: 'Active', ar: 'فعّال' },
    suspended: { en: 'Suspended', ar: 'موقوف' },
    closed: { en: 'Closed', ar: 'مغلق' },
    draft: { en: 'Draft', ar: 'مسودة' },
    pending_installation: { en: 'Pending installation', ar: 'بانتظار التركيب' },
    terminated: { en: 'Terminated', ar: 'منتهية' },
    requested: { en: 'Requested', ar: 'مطلوب' },
    scheduled: { en: 'Scheduled', ar: 'مجدول' },
    in_progress: { en: 'In progress', ar: 'قيد التنفيذ' },
    blocked: { en: 'Blocked', ar: 'معطّل' },
    ready_for_activation: { en: 'Ready for activation', ar: 'جاهز للتفعيل' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
    open: { en: 'Open', ar: 'مفتوح' },
    triaged: { en: 'Triaged', ar: 'تم الفرز' },
    waiting: { en: 'Waiting', ar: 'بانتظار' },
    resolved: { en: 'Resolved', ar: 'محلول' },
  };
  return labels[status]?.[locale] ?? status.replaceAll('_', ' ');
}
