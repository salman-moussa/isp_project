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
  applyServiceChange,
  purchaseServiceAddon,
  readSubscriberWorkspace,
  recordServiceUsage,
  type SubscriberWorkspaceData,
  type SubscriberWorkspaceInvoice,
  type SubscriberWorkspaceService,
  type SubscriberWorkspaceSubscriber,
} from '../api';
import './subscriber.css';

function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function localDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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
          {selected ? (
            <SubscriberDetail
              locale={locale}
              data={data}
              subscriber={selected}
              session={session}
              onChanged={load}
            />
          ) : null}
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
  session,
  onChanged,
}: {
  readonly locale: Locale;
  readonly data: SubscriberWorkspaceData;
  readonly subscriber: SubscriberWorkspaceSubscriber;
  readonly session: ApiSession;
  readonly onChanged: () => void;
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
            <div className="subscriber-service" key={service.id}>
              <Surface className="subscriber-service-card">
                <div>
                  <small>{service.serviceNumber}</small>
                  <strong>{locale === 'en' ? service.planNameEn : service.planNameAr}</strong>
                  <span>
                    {service.planCode} ·{' '}
                    {money(service.recurringAmountMinor, service.currency, locale)} ·{' '}
                    {isEnglish ? 'anchor' : 'يوم الفوترة'} {service.billingAnchorDay}
                  </span>
                  <span>
                    {service.accessTechnology} · {service.downstreamMbps}/{service.upstreamMbps}{' '}
                    Mbps ·{' '}
                    {service.quotaGb
                      ? `${service.quotaGb} GB`
                      : isEnglish
                        ? 'Unlimited quota'
                        : 'حصة غير محدودة'}{' '}
                    · {service.billingMode} · FUP {service.fupMode}
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
              <UsageAndAddons
                locale={locale}
                session={session}
                service={service}
                data={data}
                onChanged={onChanged}
              />
              <ServiceLifecycle
                locale={locale}
                session={session}
                service={service}
                data={data}
                onChanged={onChanged}
              />
            </div>
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
          <div className="subscriber-invoices">
            {invoices.length ? (
              invoices.map((invoice) => (
                <InvoiceDocument key={invoice.id} invoice={invoice} locale={locale} />
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

function InvoiceDocument({
  invoice,
  locale,
}: {
  readonly invoice: SubscriberWorkspaceInvoice;
  readonly locale: Locale;
}) {
  const isEnglish = locale === 'en';
  const legal = invoice.legalInvoice;
  return (
    <details className="invoice-document">
      <summary>
        <span>
          <strong>{invoice.documentNumber}</strong>
          <small>
            {new Date(invoice.postedAt).toLocaleDateString(isEnglish ? 'en-LB' : 'ar-LB')}
          </small>
        </span>
        <span>
          <strong>{money(invoice.outstandingMinor, invoice.currency, locale)}</strong>
          <small>{isEnglish ? 'outstanding · open details' : 'متبقٍ · فتح التفاصيل'}</small>
        </span>
      </summary>
      {legal ? (
        <div className="invoice-sheet" dir={isEnglish ? 'ltr' : 'rtl'}>
          <header>
            <div>
              <span>{isEnglish ? 'Tax invoice' : 'فاتورة ضريبية'}</span>
              <h3>{isEnglish ? legal.supplier.nameEn : legal.supplier.nameAr}</h3>
              <p>{isEnglish ? legal.supplier.addressEn : legal.supplier.addressAr}</p>
              <small>
                {isEnglish ? 'Ministry of Finance registration' : 'رقم التسجيل لدى وزارة المالية'}:{' '}
                <bdi>{legal.supplier.taxRegistrationNumber}</bdi>
              </small>
            </div>
            <dl>
              <div>
                <dt>{isEnglish ? 'Serial' : 'الرقم التسلسلي'}</dt>
                <dd>
                  <bdi>{legal.invoice.serialNumber}</bdi>
                </dd>
              </div>
              <div>
                <dt>{isEnglish ? 'Issued' : 'تاريخ الإصدار'}</dt>
                <dd>
                  {new Date(legal.invoice.issuedAt).toLocaleDateString(
                    isEnglish ? 'en-LB' : 'ar-LB',
                  )}
                </dd>
              </div>
              <div>
                <dt>{isEnglish ? 'Currency' : 'العملة'}</dt>
                <dd>{invoice.currency}</dd>
              </div>
            </dl>
          </header>
          <section className="invoice-parties">
            <div>
              <span>{isEnglish ? 'Bill to' : 'الفاتورة إلى'}</span>
              <strong>{legal.recipient.name}</strong>
              <small>{legal.recipient.address}</small>
            </div>
            <div>
              <span>{isEnglish ? 'Service' : 'الخدمة'}</span>
              <strong>
                {isEnglish ? legal.service.descriptionEn : legal.service.descriptionAr}
              </strong>
              <small>
                <bdi>{legal.service.number}</bdi> · {legal.service.periodStart} →{' '}
                {legal.service.periodEnd}
              </small>
            </div>
          </section>
          <div className="invoice-lines">
            <InvoiceLine
              label={isEnglish ? 'Base service' : 'الخدمة الأساسية'}
              amount={invoice.baseAmountMinor}
              invoice={invoice}
              locale={locale}
            />
            {invoice.addonAmountMinor ? (
              <InvoiceLine
                label={isEnglish ? 'Add-ons and top-ups' : 'الإضافات والحصص'}
                amount={invoice.addonAmountMinor}
                invoice={invoice}
                locale={locale}
              />
            ) : null}
            {invoice.overageAmountMinor ? (
              <InvoiceLine
                label={isEnglish ? 'Usage overage' : 'الاستخدام الزائد'}
                amount={invoice.overageAmountMinor}
                invoice={invoice}
                locale={locale}
              />
            ) : null}
            {invoice.discountAmountMinor ? (
              <InvoiceLine
                label={`${isEnglish ? 'Approved discount' : 'الحسم المعتمد'} (${invoice.discountBasisPoints / 100}%)`}
                amount={-invoice.discountAmountMinor}
                invoice={invoice}
                locale={locale}
              />
            ) : null}
            <InvoiceLine
              label={`${isEnglish ? 'VAT' : 'الضريبة'} (${invoice.vatRateBasisPoints / 100}%)`}
              amount={invoice.vatAmountMinor}
              invoice={invoice}
              locale={locale}
            />
            {invoice.stampDutyMinor ? (
              <InvoiceLine
                label={isEnglish ? 'Stamp duty' : 'رسم الطابع'}
                amount={invoice.stampDutyMinor}
                invoice={invoice}
                locale={locale}
              />
            ) : null}
            <InvoiceLine
              label={isEnglish ? 'Invoice total' : 'إجمالي الفاتورة'}
              amount={invoice.amountMinor}
              invoice={invoice}
              locale={locale}
              total
            />
          </div>
          <footer>
            {isEnglish
              ? `Immutable accounting record · retention policy ${legal.retentionYears} years`
              : `سجل محاسبي ثابت · سياسة الحفظ ${legal.retentionYears} سنوات`}
          </footer>
        </div>
      ) : (
        <p className="invoice-document__legacy">
          {isEnglish
            ? 'This legacy invoice predates the legal document snapshot.'
            : 'تسبق هذه الفاتورة القديمة لقطة المستند القانوني.'}
        </p>
      )}
    </details>
  );
}

function InvoiceLine({
  label,
  amount,
  invoice,
  locale,
  total = false,
}: {
  readonly label: string;
  readonly amount: number;
  readonly invoice: SubscriberWorkspaceInvoice;
  readonly locale: Locale;
  readonly total?: boolean;
}) {
  return (
    <div className={total ? 'invoice-line invoice-line--total' : 'invoice-line'}>
      <span>{label}</span>
      <strong>{money(amount, invoice.currency, locale)}</strong>
    </div>
  );
}

function UsageAndAddons({
  locale,
  session,
  service,
  data,
  onChanged,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
  readonly service: SubscriberWorkspaceService;
  readonly data: SubscriberWorkspaceData;
  readonly onChanged: () => void;
}) {
  const isEnglish = locale === 'en';
  const balance = data.usageBalances.find((item) => item.serviceId === service.id);
  const purchases = data.addonPurchases.filter((item) => item.serviceId === service.id);
  const addons = data.addons.filter((item) => item.currency === service.currency);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  if (!balance) return null;
  const allowedBytes = balance.baseQuotaGb
    ? (balance.baseQuotaGb + balance.topupQuotaGb) * 1_000_000_000
    : undefined;
  const usagePercent = allowedBytes
    ? Math.min(100, Math.round((balance.usedBytes / allowedBytes) * 100))
    : 0;
  const commit = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await work();
      setMessage(
        isEnglish ? 'Rating evidence saved and audited.' : 'تم حفظ دليل الاحتساب وتدقيقه.',
      );
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="service-usage">
      <summary>
        <span>
          <strong>{isEnglish ? 'Usage, quota & add-ons' : 'الاستخدام والحصة والإضافات'}</strong>
          <small>
            {formatGb(balance.usedBytes)} {isEnglish ? 'used' : 'مستخدم'} ·{' '}
            {balance.remainingBytes === undefined
              ? isEnglish
                ? 'unlimited'
                : 'غير محدود'
              : `${formatGb(balance.remainingBytes)} ${isEnglish ? 'remaining' : 'متبقٍ'}`}
          </small>
        </span>
        {balance.projectedOverageMinor > 0 ? (
          <StatusBadge tone="warning">
            {money(balance.projectedOverageMinor, balance.currency, locale)}{' '}
            {isEnglish ? 'projected' : 'متوقع'}
          </StatusBadge>
        ) : (
          <StatusBadge tone="positive">{isEnglish ? 'Within policy' : 'ضمن السياسة'}</StatusBadge>
        )}
      </summary>
      <div className="service-usage__body">
        <div className="usage-balance">
          <div>
            <span>{isEnglish ? 'Current billing cycle' : 'دورة الفوترة الحالية'}</span>
            <strong>
              {balance.periodStart} → {balance.periodEnd}
            </strong>
          </div>
          <div>
            <span>{isEnglish ? 'Available quota' : 'الحصة المتاحة'}</span>
            <strong>
              {balance.baseQuotaGb === undefined
                ? isEnglish
                  ? 'Unlimited'
                  : 'غير محدودة'
                : `${balance.baseQuotaGb + balance.topupQuotaGb} GB`}
            </strong>
            {balance.topupQuotaGb > 0 ? (
              <small>
                +{balance.topupQuotaGb} GB {isEnglish ? 'top-up' : 'إضافة'}
              </small>
            ) : null}
          </div>
          <div>
            <span>{isEnglish ? 'FUP outcome' : 'نتيجة الاستخدام العادل'}</span>
            <strong>
              {balance.overageGb > 0
                ? `${balance.overageGb} GB · ${balance.fupMode}`
                : isEnglish
                  ? 'No excess usage'
                  : 'لا يوجد استخدام زائد'}
            </strong>
          </div>
          {allowedBytes ? (
            <progress
              max="100"
              value={usagePercent}
              aria-label={isEnglish ? 'Quota used' : 'الحصة المستخدمة'}
            />
          ) : null}
        </div>

        <div className="service-rating-actions">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void commit(() =>
                purchaseServiceAddon(session, {
                  serviceId: service.id,
                  addonVersionId: formText(form, 'addonVersionId'),
                  quantity: Number(form.get('quantity')),
                  appliesFrom: balance.periodStart,
                  appliesTo: balance.periodEnd,
                  reason: 'Subscriber approved add-on purchase for the current billing cycle',
                }),
              );
            }}
          >
            <strong>{isEnglish ? 'Purchase add-on or top-up' : 'شراء إضافة أو حصة'}</strong>
            <label>
              <span>{isEnglish ? 'Catalogue item' : 'عنصر الدليل'}</span>
              <select name="addonVersionId" required disabled={!addons.length}>
                <option value="">{isEnglish ? 'Select an item' : 'اختر عنصراً'}</option>
                {addons.map((addon) => (
                  <option value={addon.id} key={addon.id}>
                    {isEnglish ? addon.nameEn : addon.nameAr} ·{' '}
                    {money(addon.amountMinor, addon.currency, locale)}
                    {addon.quotaGb ? ` · ${addon.quotaGb} GB` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{isEnglish ? 'Quantity' : 'الكمية'}</span>
              <input name="quantity" type="number" min="1" max="1000" defaultValue="1" required />
            </label>
            <Button type="submit" variant="secondary" disabled={busy || !addons.length}>
              {isEnglish ? 'Add to cycle' : 'إضافة إلى الدورة'}
            </Button>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const occurredAt = new Date(formText(form, 'occurredAt')).toISOString();
              void commit(() =>
                recordServiceUsage(session, {
                  serviceId: service.id,
                  source: formText(form, 'source'),
                  eventReference: formText(form, 'eventReference'),
                  occurredAt,
                  downloadBytes: Math.round(Number(form.get('downloadGb')) * 1_000_000_000),
                  uploadBytes: Math.round(Number(form.get('uploadGb')) * 1_000_000_000),
                  reason: 'Authorized usage mediation event recorded for subscriber rating',
                }),
              );
            }}
          >
            <strong>{isEnglish ? 'Record mediated usage' : 'تسجيل استخدام موثّق'}</strong>
            <label>
              <span>{isEnglish ? 'Source' : 'المصدر'}</span>
              <input name="source" defaultValue="radius" required />
            </label>
            <label>
              <span>{isEnglish ? 'Source reference' : 'مرجع المصدر'}</span>
              <input name="eventReference" required />
            </label>
            <label>
              <span>{isEnglish ? 'Occurred at' : 'وقت الحدوث'}</span>
              <input
                name="occurredAt"
                type="datetime-local"
                defaultValue={localDateTimeValue()}
                required
              />
            </label>
            <label>
              <span>{isEnglish ? 'Download GB' : 'تنزيل GB'}</span>
              <input
                name="downloadGb"
                type="number"
                min="0"
                step="0.001"
                defaultValue="0"
                required
              />
            </label>
            <label>
              <span>{isEnglish ? 'Upload GB' : 'رفع GB'}</span>
              <input name="uploadGb" type="number" min="0" step="0.001" defaultValue="0" required />
            </label>
            <Button type="submit" variant="secondary" disabled={busy}>
              {isEnglish ? 'Record usage' : 'تسجيل الاستخدام'}
            </Button>
          </form>
        </div>
        {message ? <p role="status">{message}</p> : null}
        {purchases.length ? (
          <ul className="service-addon-history">
            {purchases.map((purchase) => (
              <li key={purchase.id}>
                <span>
                  <strong>{isEnglish ? purchase.nameEn : purchase.nameAr}</strong>
                  <small>
                    {purchase.code} · {purchase.appliesFrom} → {purchase.appliesTo}
                  </small>
                </span>
                <span>
                  {purchase.totalQuotaGb ? `+${purchase.totalQuotaGb} GB · ` : ''}
                  {money(purchase.totalAmountMinor, purchase.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function ServiceLifecycle({
  locale,
  session,
  service,
  data,
  onChanged,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
  readonly service: SubscriberWorkspaceService;
  readonly data: SubscriberWorkspaceData;
  readonly onChanged: () => void;
}) {
  const isEnglish = locale === 'en';
  const [action, setAction] = useState<'plan_change' | 'suspend' | 'restore' | 'terminate'>(
    service.status === 'suspended' ? 'restore' : 'plan_change',
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const history = data.serviceChanges.filter((change) => change.serviceId === service.id);
  const availableActions =
    service.status === 'active'
      ? (['plan_change', 'suspend', 'terminate'] as const)
      : service.status === 'suspended'
        ? (['restore', 'terminate'] as const)
        : [];
  useEffect(() => {
    if (service.status === 'suspended' && !['restore', 'terminate'].includes(action))
      setAction('restore');
    if (service.status === 'active' && action === 'restore') setAction('plan_change');
  }, [action, service.status]);
  if (!availableActions.length && !history.length) return null;
  return (
    <details className="service-lifecycle">
      <summary>
        <span>
          <strong>{isEnglish ? 'Lifecycle & change history' : 'دورة الحياة وسجل التغييرات'}</strong>
          <small>
            {history.length
              ? isEnglish
                ? `${history.length} governed change${history.length === 1 ? '' : 's'}`
                : `${history.length} تغييرات محكومة`
              : isEnglish
                ? 'No change recorded yet'
                : 'لم يُسجّل أي تغيير بعد'}
          </small>
        </span>
        <span aria-hidden="true">＋</span>
      </summary>
      {availableActions.length ? (
        <form
          className="service-change-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const reasonValue = form.get('reason');
            const targetPlanValue = form.get('targetPlanId');
            const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
            const targetPlanId = typeof targetPlanValue === 'string' ? targetPlanValue : '';
            if (action === 'terminate') {
              const accepted = globalThis.confirm(
                isEnglish
                  ? 'Terminate this service? Billing eligibility and network access will end.'
                  : 'إنهاء هذه الخدمة؟ ستتوقف أهلية الفوترة والوصول إلى الشبكة.',
              );
              if (!accepted) return;
            }
            setPending(true);
            setMessage(undefined);
            const request =
              action === 'plan_change'
                ? { serviceId: service.id, action, targetPlanId, reason }
                : { serviceId: service.id, action, reason };
            void applyServiceChange(session, request)
              .then(() => {
                setMessage(isEnglish ? 'Change committed.' : 'تم اعتماد التغيير.');
                onChanged();
              })
              .catch((error: unknown) =>
                setMessage(error instanceof Error ? error.message : 'Service change failed.'),
              )
              .finally(() => setPending(false));
          }}
        >
          <label>
            <span>{isEnglish ? 'Change action' : 'إجراء التغيير'}</span>
            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value as 'plan_change' | 'suspend' | 'restore' | 'terminate')
              }
            >
              {availableActions.map((value) => (
                <option key={value} value={value}>
                  {statusText(value, locale)}
                </option>
              ))}
            </select>
          </label>
          {action === 'plan_change' ? (
            <label>
              <span>{isEnglish ? 'New plan' : 'الباقة الجديدة'}</span>
              <select name="targetPlanId" required defaultValue="">
                <option value="" disabled>
                  {isEnglish ? 'Select a plan' : 'اختر باقة'}
                </option>
                {data.plans
                  .filter((plan) => plan.id !== service.planId)
                  .map((plan) => (
                    <option value={plan.id} key={plan.id}>
                      {locale === 'en' ? plan.nameEn : plan.nameAr} · {plan.downstreamMbps}/
                      {plan.upstreamMbps} Mbps ·{' '}
                      {money(plan.recurringAmountMinor, plan.currency, locale)}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="service-change-form__reason">
            <span>{isEnglish ? 'Business reason' : 'سبب العمل'}</span>
            <textarea name="reason" minLength={8} maxLength={500} rows={2} required />
          </label>
          <Button
            type="submit"
            variant={action === 'terminate' ? 'danger' : 'primary'}
            disabled={pending}
          >
            {pending
              ? isEnglish
                ? 'Applying…'
                : 'جارٍ التنفيذ…'
              : isEnglish
                ? 'Apply governed change'
                : 'تطبيق التغيير المحكوم'}
          </Button>
          {message ? <p role="status">{message}</p> : null}
        </form>
      ) : null}
      {history.length ? (
        <ol className="service-change-history">
          {history.map((change) => (
            <li key={change.id}>
              <span>
                <strong>{statusText(change.action, locale)}</strong>
                <small>{change.reason}</small>
              </span>
              <small>
                {new Date(change.effectiveAt).toLocaleString(isEnglish ? 'en-LB' : 'ar-LB')}
              </small>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
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
function formatGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`;
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
    plan_change: { en: 'Change plan', ar: 'تغيير الباقة' },
    suspend: { en: 'Suspend service', ar: 'تعليق الخدمة' },
    restore: { en: 'Restore service', ar: 'إعادة الخدمة' },
    terminate: { en: 'Terminate service', ar: 'إنهاء الخدمة' },
  };
  return labels[status]?.[locale] ?? status.replaceAll('_', ' ');
}
