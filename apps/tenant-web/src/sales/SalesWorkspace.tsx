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
  readSalesWorkspace,
  submitSalesOperation,
  submitTenantOperation,
  type CapacityResource,
  type SalesBillingPolicy,
  type SalesLead,
  type SalesInstallation,
  type SalesOfferVersion,
  type SalesPlan,
  type SalesQuote,
  type SalesWorkspaceData,
  type TenantScopeItem,
} from '../api';
import './sales.css';

type SalesView = 'pipeline' | 'catalogue' | 'orders';

export function SalesWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const isEnglish = locale === 'en';
  const [data, setData] = useState<SalesWorkspaceData>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<SalesView>('pipeline');
  const [panel, setPanel] = useState<'lead' | 'offer' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [mfaChallengeId, setMfaChallengeId] = useState<string>();
  const [mfaCode, setMfaCode] = useState('');

  const load = () => {
    setState('loading');
    void readSalesWorkspace(session)
      .then((workspace) => {
        setData(workspace);
        setState('ready');
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
        setState('error');
      });
  };

  useEffect(load, [session]);

  const mutate = async (path: string, payload: Readonly<Record<string, unknown>>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await submitSalesOperation(session, path, payload);
      setMessage(
        isEnglish ? 'Sales record committed and audited.' : 'تم حفظ سجل المبيعات وتدقيقه.',
      );
      setPanel(null);
      await readSalesWorkspace(session).then(setData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const mutateTenant = async (path: string, payload: Readonly<Record<string, unknown>>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await submitTenantOperation(session, path, payload, crypto.randomUUID());
      setMessage(
        isEnglish ? 'Operations record committed and audited.' : 'تم حفظ سجل العمليات وتدقيقه.',
      );
      await readSalesWorkspace(session).then(setData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  if (state !== 'ready' || !data) {
    return (
      <StatePanel
        variant={state === 'loading' ? 'loading' : 'error'}
        title={
          state === 'loading'
            ? isEnglish
              ? 'Loading the governed sales pipeline'
              : 'جارٍ تحميل مسار المبيعات المحكوم'
            : isEnglish
              ? 'Sales workspace unavailable'
              : 'مساحة المبيعات غير متاحة'
        }
        description={
          message ??
          (isEnglish
            ? 'Reading permission- and branch-scoped commercial records.'
            : 'جارٍ قراءة السجلات التجارية وفق الصلاحيات ونطاق الفروع.')
        }
        actionLabel={state === 'error' ? (isEnglish ? 'Retry' : 'إعادة المحاولة') : undefined}
        onAction={load}
      />
    );
  }

  const counts = {
    open: data.leads.filter((lead) => !['won', 'lost', 'disqualified'].includes(lead.status))
      .length,
    qualified: data.leads.filter((lead) => lead.status === 'qualified').length,
    approvals: data.quotes.filter((quote) => quote.status === 'pending_approval').length,
    orders: data.orders.filter((order) => order.status !== 'completed').length,
  };

  return (
    <div className="sales-workspace">
      <PageHeader
        eyebrow={isEnglish ? 'CRM · Catalogue · Orders' : 'المبيعات · الباقات · الطلبات'}
        title={isEnglish ? 'Growth & service order studio' : 'استوديو النمو وطلبات الخدمة'}
        description={
          isEnglish
            ? 'Move a prospect from first contact through explainable technical qualification, controlled pricing, acceptance, and an orchestrated service order.'
            : 'انقل العميل المحتمل من التواصل الأول إلى التأهيل التقني المفسّر والتسعير المحكوم والقبول وطلب خدمة منسّق.'
        }
        actions={
          <>
            {session.startMfaStepUp ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void session.startMfaStepUp!()
                    .then((challenge) => setMfaChallengeId(challenge.challengeId))
                    .catch((error) =>
                      setMessage(error instanceof Error ? error.message : String(error)),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {isEnglish ? 'Verify approval' : 'تحقق للموافقة'}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setPanel('offer')}>
              {isEnglish ? 'New offer version' : 'نسخة باقة جديدة'}
            </Button>
            <Button variant="primary" onClick={() => setPanel('lead')}>
              {isEnglish ? 'Capture lead' : 'تسجيل عميل محتمل'}
            </Button>
          </>
        }
      />

      {mfaChallengeId && session.completeMfaStepUp ? (
        <Surface className="sales-mfa-panel">
          <div>
            <strong>
              {isEnglish ? 'Sensitive approval verification' : 'التحقق للموافقة الحساسة'}
            </strong>
            <span>
              {isEnglish
                ? 'Enter the one-time code before approving discounts or accepting contracts.'
                : 'أدخل الرمز لمرة واحدة قبل اعتماد الخصومات أو قبول العقود.'}
            </span>
          </div>
          <input
            aria-label={isEnglish ? 'Verification code' : 'رمز التحقق'}
            inputMode="numeric"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={busy || mfaCode.trim().length < 4}
            onClick={() => {
              setBusy(true);
              void session.completeMfaStepUp!(mfaChallengeId, mfaCode.trim())
                .then(() => {
                  setMfaChallengeId(undefined);
                  setMfaCode('');
                  setMessage(
                    isEnglish ? 'Approval verification is current.' : 'التحقق للموافقة حديث.',
                  );
                })
                .catch((error) =>
                  setMessage(error instanceof Error ? error.message : String(error)),
                )
                .finally(() => setBusy(false));
            }}
          >
            {isEnglish ? 'Confirm code' : 'تأكيد الرمز'}
          </Button>
        </Surface>
      ) : null}

      {message ? (
        <p className="sales-message" role="status">
          {message}
        </p>
      ) : null}

      <section className="sales-metrics" aria-label={isEnglish ? 'Sales posture' : 'حالة المبيعات'}>
        <SalesMetric label={isEnglish ? 'Open pipeline' : 'المسار المفتوح'} value={counts.open} />
        <SalesMetric label={isEnglish ? 'Qualified' : 'مؤهلون'} value={counts.qualified} />
        <SalesMetric
          label={isEnglish ? 'Approval queue' : 'بانتظار الموافقة'}
          value={counts.approvals}
          tone="warning"
        />
        <SalesMetric
          label={isEnglish ? 'Orders in flight' : 'طلبات قيد التنفيذ'}
          value={counts.orders}
          tone="primary"
        />
      </section>

      <div
        className="sales-view-switcher"
        role="tablist"
        aria-label={isEnglish ? 'Sales view' : 'عرض المبيعات'}
      >
        {(['pipeline', 'catalogue', 'orders'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={view === candidate}
            onClick={() => setView(candidate)}
          >
            {viewLabel(candidate, locale)}
          </button>
        ))}
      </div>

      {panel === 'lead' ? (
        <LeadForm
          locale={locale}
          scopes={data.scopes}
          busy={busy}
          onClose={() => setPanel(null)}
          onSubmit={(payload) => mutate('leads', payload)}
        />
      ) : null}
      {panel === 'offer' ? (
        <OfferForm
          locale={locale}
          scopes={data.scopes}
          busy={busy}
          onClose={() => setPanel(null)}
          onSubmit={(payload) => mutate('offers', payload)}
        />
      ) : null}

      {view === 'pipeline' ? (
        <Pipeline locale={locale} data={data} busy={busy} onMutate={mutate} />
      ) : view === 'catalogue' ? (
        <Catalogue locale={locale} offers={data.offers} />
      ) : (
        <Orders
          locale={locale}
          data={data}
          busy={busy}
          onMutate={mutate}
          onOperate={mutateTenant}
        />
      )}
    </div>
  );
}

function SalesMetric({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: string;
}) {
  return (
    <div className={`sales-metric sales-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Pipeline({
  locale,
  data,
  busy,
  onMutate,
}: {
  readonly locale: Locale;
  readonly data: SalesWorkspaceData;
  readonly busy: boolean;
  readonly onMutate: (path: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  if (!data.leads.length) {
    return (
      <StatePanel
        variant="empty"
        title={isEnglish ? 'No leads yet' : 'لا يوجد عملاء محتملون'}
        description={
          isEnglish
            ? 'Capture the first prospect to begin a governed sales journey.'
            : 'سجّل أول عميل محتمل لبدء رحلة مبيعات محكومة.'
        }
      />
    );
  }
  return (
    <div className="sales-pipeline-grid">
      {data.leads.map((lead) => {
        const qualification = data.qualifications.find((item) => item.leadId === lead.id);
        const quote = data.quotes.find((item) => item.leadId === lead.id);
        return (
          <Surface className="sales-lead-card" key={lead.id}>
            <div className="sales-lead-card__top">
              <div>
                <small>
                  {lead.leadNumber} · {lead.source}
                </small>
                <h2>{lead.displayName}</h2>
                <p>{lead.needsSummary}</p>
              </div>
              <StatusBadge
                tone={
                  lead.status === 'won'
                    ? 'positive'
                    : lead.status === 'disqualified' || lead.status === 'lost'
                      ? 'critical'
                      : 'primary'
                }
              >
                {statusLabel(lead.status, locale)}
              </StatusBadge>
            </div>
            <dl>
              <div>
                <dt>{isEnglish ? 'Location' : 'الموقع'}</dt>
                <dd>{lead.addressLine}</dd>
              </div>
              <div>
                <dt>{isEnglish ? 'Contact' : 'التواصل'}</dt>
                <dd>{lead.primaryPhone ?? lead.primaryEmail ?? '—'}</dd>
              </div>
            </dl>
            {qualification ? (
              <p className="sales-evidence">
                <strong>{isEnglish ? 'Qualification:' : 'التأهيل:'}</strong>{' '}
                {statusLabel(qualification.result, locale)} · {qualification.coverageSource}
                {qualification.capacityReference ? ` · ${qualification.capacityReference}` : ''}
              </p>
            ) : null}
            {lead.status === 'new' || lead.status === 'qualifying' ? (
              <QualificationForm
                locale={locale}
                lead={lead}
                busy={busy}
                onSubmit={(payload) => onMutate('qualifications', payload)}
              />
            ) : null}
            {lead.status === 'qualified' ? (
              <QuoteForm
                locale={locale}
                lead={lead}
                offers={data.offers}
                busy={busy}
                onSubmit={(payload) => onMutate('quotes', payload)}
              />
            ) : null}
            {quote ? (
              <QuoteActions
                locale={locale}
                quote={quote}
                lead={lead}
                busy={busy}
                onMutate={onMutate}
              />
            ) : null}
          </Surface>
        );
      })}
    </div>
  );
}

function QualificationForm({
  locale,
  lead,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly lead: SalesLead;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const result = formText(form, 'result');
        void onSubmit({
          leadId: lead.id,
          result,
          accessTechnology: formText(form, 'technology'),
          coverageSource: formText(form, 'coverage'),
          reasonCodes: result === 'ineligible' ? ['coverage_unavailable'] : [],
          evidence: { checkedAt: new Date().toISOString() },
          ...(formText(form, 'capacity') ? { capacityReference: formText(form, 'capacity') } : {}),
          ...(result === 'reserved'
            ? { reservationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
            : {}),
          reason: 'Technical qualification recorded from verified coverage evidence',
        }).catch(() => undefined);
      }}
    >
      <strong>{isEnglish ? 'Technical qualification' : 'التأهيل التقني'}</strong>
      <div className="sales-form-row">
        <select name="result" aria-label={isEnglish ? 'Qualification result' : 'نتيجة التأهيل'}>
          <option value="eligible">{isEnglish ? 'Eligible' : 'مؤهل'}</option>
          <option value="reserved">
            {isEnglish ? 'Eligible · reserve 24h' : 'مؤهل · حجز ٢٤ ساعة'}
          </option>
          <option value="survey_required">
            {isEnglish ? 'Site survey required' : 'يلزم كشف ميداني'}
          </option>
          <option value="ineligible">{isEnglish ? 'Not eligible' : 'غير مؤهل'}</option>
        </select>
        <select name="technology" aria-label={isEnglish ? 'Access technology' : 'تقنية الوصول'}>
          <option value="fiber">Fiber</option>
          <option value="fixed_wireless">Fixed wireless</option>
          <option value="dsl">DSL</option>
        </select>
        <input
          name="coverage"
          required
          placeholder={isEnglish ? 'Coverage source' : 'مصدر التغطية'}
        />
        <input
          name="capacity"
          placeholder={isEnglish ? 'Capacity / POP reference' : 'مرجع السعة / نقطة التواجد'}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {isEnglish ? 'Record result' : 'حفظ النتيجة'}
        </Button>
      </div>
    </form>
  );
}

function QuoteForm({
  locale,
  lead,
  offers,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly lead: SalesLead;
  readonly offers: readonly SalesOfferVersion[];
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          leadId: lead.id,
          offerVersionId: formText(form, 'offer'),
          quoteNumber: `Q-${lead.leadNumber}-${Date.now().toString().slice(-5)}`,
          version: 1,
          discountBasisPoints: Math.round(Number(formText(form, 'discount') || '0') * 100),
          validUntil: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
          terms: { validityDays: 14 },
          reason: 'Quotation created from the approved effective offer version',
        }).catch(() => undefined);
      }}
    >
      <strong>{isEnglish ? 'Prepare quotation' : 'تحضير عرض السعر'}</strong>
      <div className="sales-form-row">
        <select name="offer" required aria-label={isEnglish ? 'Offer' : 'الباقة'}>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {isEnglish ? offer.nameEn : offer.nameAr} ·{' '}
              {money(offer.recurringAmountMinor, offer.currency, locale)}
            </option>
          ))}
        </select>
        <label>
          <span>{isEnglish ? 'Discount %' : 'الخصم %'}</span>
          <input name="discount" type="number" min="0" max="30" step="0.25" defaultValue="0" />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !offers.length}>
          {isEnglish ? 'Issue quote' : 'إصدار العرض'}
        </Button>
      </div>
    </form>
  );
}

function QuoteActions({
  locale,
  quote,
  lead,
  busy,
  onMutate,
}: {
  readonly locale: Locale;
  readonly quote: SalesQuote;
  readonly lead: SalesLead;
  readonly busy: boolean;
  readonly onMutate: (path: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <div className="sales-quote">
      <div>
        <strong>{quote.quoteNumber}</strong>
        <span>
          {money(quote.recurringAmountMinor, quote.currency, locale)} ·{' '}
          {quote.discountBasisPoints / 100}% {isEnglish ? 'discount' : 'خصم'}
        </span>
      </div>
      <StatusBadge
        tone={
          quote.status === 'accepted'
            ? 'positive'
            : quote.status === 'pending_approval'
              ? 'warning'
              : 'primary'
        }
      >
        {statusLabel(quote.status, locale)}
      </StatusBadge>
      {quote.status === 'pending_approval' ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void onMutate('quotes/approve', {
              quoteId: quote.id,
              reason: 'Approved quotation discount within commercial authority',
            }).catch(() => undefined)
          }
        >
          {isEnglish ? 'Approve discount' : 'اعتماد الخصم'}
        </Button>
      ) : null}
      {quote.status === 'issued' || quote.status === 'approved' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void onMutate('quotes/accept', {
              quoteId: quote.id,
              orderNumber: `SO-${lead.leadNumber}-${Date.now().toString().slice(-5)}`,
              acceptedBy: formText(form, 'acceptedBy'),
              acceptanceReference: formText(form, 'reference'),
              reason: 'Customer acceptance evidence verified before service order creation',
            }).catch(() => undefined);
          }}
        >
          <input
            name="acceptedBy"
            required
            placeholder={isEnglish ? 'Accepted by' : 'اسم الموافق'}
          />
          <input
            name="reference"
            required
            placeholder={isEnglish ? 'Signed contract / call reference' : 'مرجع العقد / الاتصال'}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {isEnglish ? 'Accept & create order' : 'قبول وإنشاء الطلب'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Catalogue({
  locale,
  offers,
}: {
  readonly locale: Locale;
  readonly offers: readonly SalesOfferVersion[];
}) {
  const isEnglish = locale === 'en';
  return (
    <div className="sales-catalogue">
      {offers.length ? (
        offers.map((offer) => (
          <Surface key={offer.id} className="sales-offer-card">
            <div>
              <small>
                {offer.code} · v{offer.version}
              </small>
              <h2>{isEnglish ? offer.nameEn : offer.nameAr}</h2>
              <p>
                {offer.accessTechnology.replaceAll('_', ' ')} · {offer.downstreamMbps}/
                {offer.upstreamMbps} Mbps{offer.quotaGb ? ` · ${offer.quotaGb} GB` : ''}
              </p>
            </div>
            <strong>{money(offer.recurringAmountMinor, offer.currency, locale)}</strong>
            <dl>
              <div>
                <dt>{isEnglish ? 'Activation' : 'التفعيل'}</dt>
                <dd>{money(offer.activationFeeMinor, offer.currency, locale)}</dd>
              </div>
              <div>
                <dt>{isEnglish ? 'Equipment' : 'التجهيزات'}</dt>
                <dd>{money(offer.equipmentFeeMinor, offer.currency, locale)}</dd>
              </div>
              <div>
                <dt>{isEnglish ? 'Commitment' : 'الالتزام'}</dt>
                <dd>{offer.commitmentMonths || (isEnglish ? 'None' : 'بدون')}</dd>
              </div>
            </dl>
          </Surface>
        ))
      ) : (
        <StatePanel
          variant="empty"
          title={isEnglish ? 'No effective offers' : 'لا توجد باقات نافذة'}
          description={
            isEnglish
              ? 'Publish an effective offer version before quoting.'
              : 'انشر نسخة باقة نافذة قبل إعداد عرض سعر.'
          }
        />
      )}
    </div>
  );
}

function Orders({
  locale,
  data,
  busy,
  onMutate,
  onOperate,
}: {
  readonly locale: Locale;
  readonly data: SalesWorkspaceData;
  readonly busy: boolean;
  readonly onMutate: (path: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly onOperate: (path: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <div className="sales-orders">
      <CapacityRegister
        locale={locale}
        data={data}
        busy={busy}
        onSubmit={(payload) => onMutate('resources', payload)}
      />
      {data.orders.length ? (
        data.orders.map((order) => {
          const lead = data.leads.find((candidate) => candidate.id === order.leadId);
          const subscriberTask = order.tasks.find((task) => task.key === 'subscriber_creation');
          const resourceTask = order.tasks.find((task) => task.key === 'resource_reservation');
          const installationTask = order.tasks.find((task) => task.key === 'installation');
          const networkTask = order.tasks.find((task) => task.key === 'network_activation');
          const firstBillingTask = order.tasks.find((task) => task.key === 'first_billing');
          const exceptionTasks = order.tasks.filter(
            (task) => task.status === 'failed' || task.status === 'blocked',
          );
          const executionEnabled = !['on_hold', 'fallout', 'completed', 'cancelled'].includes(
            order.status,
          );
          const installation = data.installations.find(
            (candidate) => candidate.orderId === order.id,
          );
          const quote = data.quotes.find((candidate) => candidate.id === order.quoteId);
          const offer = data.offers.find((candidate) => candidate.id === quote?.offerVersionId);
          const eligiblePlans = data.plans.filter(
            (plan) =>
              quote &&
              plan.networkProfileReference &&
              (!plan.branchId || plan.branchId === lead?.branchId) &&
              plan.recurringAmountMinor === quote.recurringAmountMinor &&
              plan.currency === quote.currency,
          );
          const activationDate = installation?.serviceActivatedAt?.slice(0, 10);
          const effectiveBillingPolicies = data.billingPolicies.filter(
            (policy) =>
              activationDate &&
              (!policy.branchId || policy.branchId === lead?.branchId) &&
              policy.effectiveFrom <= activationDate &&
              (!policy.effectiveTo || policy.effectiveTo > activationDate),
          );
          const eligibleResources = data.resources.filter(
            (resource) =>
              lead &&
              offer &&
              resource.status === 'active' &&
              resource.availableUnits > 0 &&
              resource.accessTechnology === offer.accessTechnology &&
              resource.branchId === lead.branchId &&
              (!resource.areaId || resource.areaId === lead.areaId) &&
              (!resource.routeId || resource.routeId === lead.routeId),
          );
          return (
            <Surface key={order.id} className="sales-order-card">
              <div className="sales-order-card__header">
                <div>
                  <small>{isEnglish ? 'Service order' : 'طلب خدمة'}</small>
                  <h2>{order.orderNumber}</h2>
                </div>
                <StatusBadge
                  tone={
                    order.status === 'fallout'
                      ? 'critical'
                      : order.status === 'completed'
                        ? 'positive'
                        : 'primary'
                  }
                >
                  {statusLabel(order.status, locale)}
                </StatusBadge>
              </div>
              {order.subscriberId ? (
                <p className="sales-order-card__link">
                  <strong>{isEnglish ? 'Subscriber linked' : 'تم ربط المشترك'}</strong>
                  <span>{order.subscriberId}</span>
                </p>
              ) : null}
              {order.firstInvoiceId ? (
                <p className="sales-order-card__link">
                  <strong>{isEnglish ? 'First invoice posted' : 'تم ترحيل الفاتورة الأولى'}</strong>
                  <span>
                    {order.firstInvoiceId} · {order.firstInvoicePeriodStart} →{' '}
                    {order.firstInvoicePeriodEnd}
                  </span>
                </p>
              ) : null}
              <ol>
                {order.tasks.map((task) => (
                  <li key={task.key} className={`sales-task sales-task--${task.status}`}>
                    <span aria-hidden="true" />
                    <div>
                      <strong>{taskLabel(task.type, locale)}</strong>
                      <small>
                        {task.dependsOn.length
                          ? `${isEnglish ? 'After' : 'بعد'} ${task.dependsOn.join(', ')}`
                          : isEnglish
                            ? 'No dependency'
                            : 'دون تبعية'}
                        {task.lastError ? ` · ${task.lastError}` : ''}
                        {task.attempts
                          ? ` · ${isEnglish ? 'Attempts' : 'المحاولات'} ${task.attempts}`
                          : ''}
                      </small>
                    </div>
                    <StatusBadge
                      tone={
                        task.status === 'completed'
                          ? 'positive'
                          : task.status === 'blocked' || task.status === 'failed'
                            ? 'critical'
                            : 'neutral'
                      }
                    >
                      {statusLabel(task.status, locale)}
                    </StatusBadge>
                  </li>
                ))}
              </ol>
              {order.status !== 'on_hold'
                ? exceptionTasks.map((task) => (
                    <RetryOrderTaskForm
                      key={task.key}
                      locale={locale}
                      orderId={order.id}
                      taskKey={task.key}
                      taskType={task.type}
                      busy={busy}
                      onSubmit={(payload) => onMutate('orders/commands', payload)}
                    />
                  ))
                : null}
              {!['completed', 'cancelled'].includes(order.status) ? (
                <OrderCommandForm
                  key={order.status}
                  locale={locale}
                  orderId={order.id}
                  orderStatus={order.status}
                  canCancel={!order.subscriberId}
                  busy={busy}
                  onSubmit={(payload) => onMutate('orders/commands', payload)}
                />
              ) : null}
              {executionEnabled &&
              lead &&
              subscriberTask?.status === 'ready' &&
              !order.subscriberId ? (
                <SubscriberConversionForm
                  locale={locale}
                  orderId={order.id}
                  orderNumber={order.orderNumber}
                  lead={lead}
                  busy={busy}
                  onSubmit={(payload) => onMutate('orders/subscriber', payload)}
                />
              ) : null}
              {executionEnabled && resourceTask?.status === 'ready' ? (
                <ResourceReservationForm
                  locale={locale}
                  orderId={order.id}
                  resources={eligibleResources}
                  busy={busy}
                  onSubmit={(payload) => onMutate('orders/resource', payload)}
                />
              ) : null}
              {executionEnabled && installationTask?.status === 'ready' && !installation ? (
                <>
                  {!eligiblePlans.length && quote && lead ? (
                    <PlanPublicationForm
                      locale={locale}
                      orderNumber={order.orderNumber}
                      branchId={lead.branchId}
                      quote={quote}
                      busy={busy}
                      onSubmit={(payload) => onOperate('plan-versions', payload)}
                    />
                  ) : null}
                  <InstallationCreationForm
                    locale={locale}
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    plans={eligiblePlans}
                    busy={busy}
                    onSubmit={(payload) => onMutate('orders/installation', payload)}
                  />
                </>
              ) : null}
              {executionEnabled && installation ? (
                <InstallationProgress
                  locale={locale}
                  installation={installation}
                  busy={busy}
                  onSubmit={(payload) => onOperate('installations/transitions', payload)}
                />
              ) : null}
              {executionEnabled && networkTask?.status === 'ready' ? (
                <NetworkActivationForm
                  locale={locale}
                  orderId={order.id}
                  busy={busy}
                  onSubmit={(payload) => onMutate('orders/network', payload)}
                />
              ) : null}
              {executionEnabled &&
              firstBillingTask?.status === 'ready' &&
              activationDate &&
              lead ? (
                effectiveBillingPolicies.length ? (
                  <FirstBillingForm
                    locale={locale}
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    activationDate={activationDate}
                    policy={effectiveBillingPolicies[0]}
                    busy={busy}
                    onSubmit={(payload) => onMutate('orders/billing', payload)}
                  />
                ) : (
                  <BillingPolicyPublicationForm
                    locale={locale}
                    branchId={lead.branchId}
                    effectiveFrom={activationDate}
                    nextVersion={
                      Math.max(
                        0,
                        ...data.billingPolicies
                          .filter((policy) => policy.branchId === lead.branchId)
                          .map((policy) => policy.version),
                      ) + 1
                    }
                    busy={busy}
                    onSubmit={(payload) => onOperate('billing-policy-versions', payload)}
                  />
                )
              ) : null}
            </Surface>
          );
        })
      ) : (
        <StatePanel
          variant="empty"
          title={isEnglish ? 'No accepted orders' : 'لا توجد طلبات مقبولة'}
          description={
            isEnglish
              ? 'Accepted quotations decompose here into controlled delivery tasks.'
              : 'تتحول عروض الأسعار المقبولة هنا إلى مهام تسليم محكومة.'
          }
        />
      )}
    </div>
  );
}

function RetryOrderTaskForm({
  locale,
  orderId,
  taskKey,
  taskType,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly taskKey: string;
  readonly taskType: string;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          orderId,
          command: 'retry_task',
          taskKey,
          reason: formText(form, 'reason'),
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>
          {isEnglish
            ? `Resolve and retry ${taskLabel(taskType, locale)}`
            : `معالجة وإعادة ${taskLabel(taskType, locale)}`}
        </strong>
        <span>
          {isEnglish
            ? 'Record what was corrected. Dependencies are checked again before the step returns to Ready.'
            : 'سجّل ما تمت معالجته. يعاد التحقق من التبعيات قبل إعادة الخطوة إلى جاهز.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Resolution note' : 'ملاحظة المعالجة'}</span>
        <input name="reason" minLength={8} maxLength={500} required />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {isEnglish ? 'Retry governed step' : 'إعادة الخطوة المحكومة'}
      </Button>
    </form>
  );
}

function OrderCommandForm({
  locale,
  orderId,
  orderStatus,
  canCancel,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly orderStatus: string;
  readonly canCancel: boolean;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const [command, setCommand] = useState<'place_on_hold' | 'resume' | 'cancel'>(
    orderStatus === 'on_hold' ? 'resume' : 'place_on_hold',
  );
  const options =
    orderStatus === 'on_hold' ? ['resume'] : ['place_on_hold', ...(canCancel ? ['cancel'] : [])];
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({ orderId, command, reason: formText(form, 'reason') }).catch(
          () => undefined,
        );
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Order control' : 'التحكم بالطلب'}</strong>
        <span>
          {canCancel
            ? isEnglish
              ? 'Hold, resume, or cancel before subscriber/service side effects exist.'
              : 'علّق أو استأنف أو ألغِ قبل إنشاء آثار المشترك أو الخدمة.'
            : isEnglish
              ? 'Cancellation is locked after subscriber creation; use a governed service termination.'
              : 'يُقفل الإلغاء بعد إنشاء المشترك؛ استخدم إنهاء خدمة محكوماً.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Action' : 'الإجراء'}</span>
        <select
          value={command}
          onChange={(event) =>
            setCommand(event.target.value as 'place_on_hold' | 'resume' | 'cancel')
          }
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {orderCommandLabel(option, locale)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{isEnglish ? 'Operational reason' : 'السبب التشغيلي'}</span>
        <input name="reason" minLength={8} maxLength={500} required />
      </label>
      <Button type="submit" variant={command === 'cancel' ? 'danger' : 'secondary'} disabled={busy}>
        {orderCommandLabel(command, locale)}
      </Button>
    </form>
  );
}

function PlanPublicationForm({
  locale,
  orderNumber,
  branchId,
  quote,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderNumber: string;
  readonly branchId: string;
  readonly quote: SalesQuote;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          branchId,
          code: formText(form, 'code'),
          nameEn: formText(form, 'nameEn'),
          nameAr: formText(form, 'nameAr'),
          networkProfileReference: formText(form, 'networkProfileReference'),
          version: 1,
          recurringAmountMinor: quote.recurringAmountMinor,
          currency: quote.currency,
          billingIntervalMonths: 1,
          effectiveFrom: new Date().toISOString().slice(0, 10),
          reason: 'Order-matched billing and network profile published for governed activation',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Publish the order plan' : 'نشر خطة الطلب'}</strong>
        <span>
          {isEnglish
            ? 'This order needs a price-matched plan with a RouterOS profile before installation can open.'
            : 'يحتاج هذا الطلب إلى خطة مطابقة للسعر مع ملف RouterOS قبل فتح التركيب.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Plan code' : 'رمز الخطة'}</span>
        <input name="code" defaultValue={`PLAN-${orderNumber}`.slice(0, 80)} required />
      </label>
      <label>
        <span>{isEnglish ? 'English name' : 'الاسم بالإنجليزية'}</span>
        <input name="nameEn" required />
      </label>
      <label>
        <span>{isEnglish ? 'Arabic name' : 'الاسم بالعربية'}</span>
        <input name="nameAr" dir="rtl" required />
      </label>
      <label>
        <span>{isEnglish ? 'RouterOS profile reference' : 'مرجع ملف RouterOS'}</span>
        <input name="networkProfileReference" placeholder="profile-business-100" required />
      </label>
      <Button type="submit" variant="secondary" disabled={busy}>
        {isEnglish ? 'Publish matched plan' : 'نشر الخطة المطابقة'}
      </Button>
    </form>
  );
}

function NetworkActivationForm({
  locale,
  orderId,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          orderId,
          reason: 'Verified field installation queued for durable RouterOS activation',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Ready: activate network service' : 'جاهز: تفعيل خدمة الشبكة'}</strong>
        <span>
          {isEnglish
            ? 'The order completes this step only after the Network Worker confirms the router state. An active router and service binding must already be provisioned.'
            : 'لا تُكمل المنصة هذه الخطوة إلا بعد تأكيد عامل الشبكة لحالة الموجّه. يجب تجهيز ربط فعّال للموجّه والخدمة مسبقاً.'}
        </span>
      </div>
      <Button type="submit" variant="primary" disabled={busy}>
        {isEnglish ? 'Queue verified activation' : 'إرسال التفعيل المتحقق'}
      </Button>
    </form>
  );
}

function BillingPolicyPublicationForm({
  locale,
  branchId,
  effectiveFrom,
  nextVersion,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly branchId: string;
  readonly effectiveFrom: string;
  readonly nextVersion: number;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          branchId,
          version: nextVersion,
          vatRateBasisPoints: Number(formText(form, 'vatRateBasisPoints')),
          roundingMode: formText(form, 'roundingMode'),
          effectiveFrom,
          reason: 'Owner-approved branch billing policy published before first service invoice',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Billing policy required' : 'سياسة الفوترة مطلوبة'}</strong>
        <span>
          {isEnglish
            ? 'Confirm the branch tax rate and rounding rule. Orvex will not invent a legal tax policy.'
            : 'أكد معدل الضريبة وقاعدة التقريب للفرع. لا تفترض Orvex سياسة ضريبية قانونية.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'VAT basis points (0–10000)' : 'نقاط أساس الضريبة (٠–١٠٠٠٠)'}</span>
        <input name="vatRateBasisPoints" type="number" min="0" max="10000" required />
      </label>
      <label>
        <span>{isEnglish ? 'Rounding rule' : 'قاعدة التقريب'}</span>
        <select name="roundingMode" defaultValue="half_up">
          <option value="half_up">{isEnglish ? 'Half up' : 'نصف للأعلى'}</option>
          <option value="down">{isEnglish ? 'Down' : 'للأسفل'}</option>
          <option value="up">{isEnglish ? 'Up' : 'للأعلى'}</option>
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={busy}>
        {isEnglish ? 'Publish billing policy' : 'نشر سياسة الفوترة'}
      </Button>
    </form>
  );
}

function FirstBillingForm({
  locale,
  orderId,
  orderNumber,
  activationDate,
  policy,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly activationDate: string;
  readonly policy: SalesBillingPolicy;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          orderId,
          documentNumber: formText(form, 'documentNumber'),
          periodStart: activationDate,
          periodEnd: formText(form, 'periodEnd'),
          reason: 'First immutable service invoice posted after verified network activation',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Ready: post first invoice' : 'جاهز: ترحيل الفاتورة الأولى'}</strong>
        <span>
          {isEnglish
            ? `Activation ${activationDate} · VAT ${(policy.vatRateBasisPoints / 100).toFixed(2)}% · ${policy.roundingMode.replaceAll('_', ' ')}`
            : `التفعيل ${activationDate} · الضريبة ${(policy.vatRateBasisPoints / 100).toFixed(2)}٪ · ${policy.roundingMode}`}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Invoice number' : 'رقم الفاتورة'}</span>
        <input
          name="documentNumber"
          defaultValue={`INV-${orderNumber}-001`.slice(0, 100)}
          required
        />
      </label>
      <label>
        <span>{isEnglish ? 'Period end' : 'نهاية الفترة'}</span>
        <input
          name="periodEnd"
          type="date"
          min={nextDay(activationDate)}
          max={addDays(activationDate, 31)}
          defaultValue={addMonth(activationDate)}
          required
        />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {isEnglish ? 'Post invoice and complete order' : 'ترحيل الفاتورة وإكمال الطلب'}
      </Button>
    </form>
  );
}

function CapacityRegister({
  locale,
  data,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly data: SalesWorkspaceData;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const [branchId, setBranchId] = useState(data.scopes.branches[0]?.id ?? '');
  const areas = data.scopes.areas.filter((item) => item.parentId === branchId);
  const [areaId, setAreaId] = useState('');
  const routes = data.scopes.routes.filter((item) => item.parentId === areaId);
  return (
    <Surface className="sales-capacity">
      <div className="surface__header">
        <div>
          <small>{isEnglish ? 'Network inventory' : 'مخزون الشبكة'}</small>
          <h2>{isEnglish ? 'Service capacity register' : 'سجل سعة الخدمة'}</h2>
          <p>
            {isEnglish
              ? 'Declare reservable ports, sectors, nodes, or shared capacity before assigning an accepted order.'
              : 'عرّف المنافذ والقطاعات والعقد أو السعة المشتركة القابلة للحجز قبل إسناد الطلب المقبول.'}
          </p>
        </div>
        <strong className="sales-capacity__summary">
          {data.resources.reduce((total, resource) => total + resource.availableUnits, 0)}{' '}
          <span>{isEnglish ? 'units available' : 'وحدة متاحة'}</span>
        </strong>
      </div>
      {data.resources.length ? (
        <div
          className="sales-capacity__inventory"
          aria-label={isEnglish ? 'Capacity inventory' : 'مخزون السعة'}
        >
          {data.resources.slice(0, 8).map((resource) => (
            <div key={resource.id}>
              <strong>{resource.code}</strong>
              <span>{resource.name}</span>
              <small>
                {resource.accessTechnology.replaceAll('_', ' ')} · {resource.availableUnits}/
                {resource.totalUnits} {isEnglish ? 'free' : 'متاحة'}
              </small>
            </div>
          ))}
        </div>
      ) : null}
      <form
        className="sales-capacity__form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSubmit({
            type: formText(form, 'type'),
            code: formText(form, 'code'),
            name: formText(form, 'name'),
            accessTechnology: formText(form, 'technology'),
            totalUnits: Number(formText(form, 'totalUnits')),
            branchId,
            ...(areaId ? { areaId } : {}),
            ...(formText(form, 'routeId') ? { routeId: formText(form, 'routeId') } : {}),
            metadata: {},
            reason: 'Reservable service capacity added to governed network inventory',
          }).catch(() => undefined);
        }}
      >
        <label>
          <span>{isEnglish ? 'Resource type' : 'نوع المورد'}</span>
          <select name="type">
            <option value="fiber_port">{isEnglish ? 'Fiber port' : 'منفذ ألياف'}</option>
            <option value="wireless_sector">{isEnglish ? 'Wireless sector' : 'قطاع لاسلكي'}</option>
            <option value="olt">OLT</option>
            <option value="pop">POP</option>
            <option value="access_node">{isEnglish ? 'Access node' : 'عقدة وصول'}</option>
            <option value="capacity_pool">{isEnglish ? 'Capacity pool' : 'مجموعة سعة'}</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Code' : 'الرمز'}</span>
          <input name="code" required placeholder="OLT-BEY-01" />
        </label>
        <label>
          <span>{isEnglish ? 'Display name' : 'الاسم'}</span>
          <input name="name" required />
        </label>
        <label>
          <span>{isEnglish ? 'Technology' : 'التقنية'}</span>
          <select name="technology">
            <option value="fiber">Fiber</option>
            <option value="fixed_wireless">Fixed wireless</option>
            <option value="dsl">DSL</option>
            <option value="leased_line">Leased line</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Total units' : 'إجمالي الوحدات'}</span>
          <input name="totalUnits" type="number" min="1" defaultValue="1" required />
        </label>
        <ScopeSelect
          label={isEnglish ? 'Branch' : 'الفرع'}
          items={data.scopes.branches}
          locale={locale}
          value={branchId}
          onChange={(value) => {
            setBranchId(value);
            setAreaId('');
          }}
        />
        <ScopeSelect
          label={isEnglish ? 'Area (optional)' : 'المنطقة (اختياري)'}
          items={areas}
          locale={locale}
          value={areaId}
          onChange={setAreaId}
          optional
        />
        <ScopeSelect
          label={isEnglish ? 'Route (optional)' : 'المسار (اختياري)'}
          items={routes}
          locale={locale}
          name="routeId"
          optional
        />
        <Button type="submit" variant="secondary" disabled={busy || !branchId}>
          {isEnglish ? 'Add capacity' : 'إضافة السعة'}
        </Button>
      </form>
    </Surface>
  );
}

function ResourceReservationForm({
  locale,
  orderId,
  resources,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly resources: readonly CapacityResource[];
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          orderId,
          resourceId: formText(form, 'resourceId'),
          units: Number(formText(form, 'units')),
          reason: 'Eligible service capacity reserved for accepted service order',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Ready: reserve network capacity' : 'جاهز: حجز سعة الشبكة'}</strong>
        <span>
          {resources.length
            ? isEnglish
              ? 'Only active capacity matching the order technology and service territory is shown.'
              : 'تظهر فقط السعة الفعالة المطابقة لتقنية الطلب ونطاق الخدمة.'
            : isEnglish
              ? 'No eligible capacity is available. Add capacity for this technology and territory above.'
              : 'لا توجد سعة مؤهلة. أضف سعة لهذه التقنية وهذا النطاق أعلاه.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Eligible resource' : 'المورد المؤهل'}</span>
        <select name="resourceId" required disabled={!resources.length}>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.code} · {resource.name} · {resource.availableUnits}{' '}
              {isEnglish ? 'available' : 'متاحة'}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{isEnglish ? 'Units' : 'الوحدات'}</span>
        <input name="units" type="number" min="1" defaultValue="1" required />
      </label>
      <Button type="submit" variant="primary" disabled={busy || !resources.length}>
        {isEnglish ? 'Reserve and continue installation' : 'حجز ومتابعة التركيب'}
      </Button>
    </form>
  );
}

function InstallationCreationForm({
  locale,
  orderId,
  orderNumber,
  plans,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly plans: readonly SalesPlan[];
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          orderId,
          planId: formText(form, 'planId'),
          serviceNumber: formText(form, 'serviceNumber'),
          billingAnchorDay: Number(formText(form, 'billingAnchorDay')),
          reason: 'Installation work order created after subscriber and capacity controls passed',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>
          {isEnglish ? 'Ready: open installation work order' : 'جاهز: فتح أمر عمل تركيب'}
        </strong>
        <span>
          {plans.length
            ? isEnglish
              ? 'The service and field work order are linked atomically. Network activation remains locked until evidenced installation completion.'
              : 'يتم ربط الخدمة وأمر العمل الميداني ذرياً. يبقى تفعيل الشبكة مقفلاً حتى إكمال التركيب بالأدلة.'
            : isEnglish
              ? 'No active billing plan is available for this branch. Publish one in Operations first.'
              : 'لا توجد خطة فوترة فعالة لهذا الفرع. انشر خطة في العمليات أولاً.'}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Operations plan' : 'خطة العمليات'}</span>
        <select name="planId" required disabled={!plans.length}>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.code} · {isEnglish ? plan.nameEn : plan.nameAr} ·{' '}
              {money(plan.recurringAmountMinor, plan.currency, locale)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{isEnglish ? 'Service number' : 'رقم الخدمة'}</span>
        <input name="serviceNumber" defaultValue={`SVC-${orderNumber}`} required />
      </label>
      <label>
        <span>{isEnglish ? 'Monthly billing day' : 'يوم الفوترة الشهري'}</span>
        <input name="billingAnchorDay" type="number" min="1" max="28" defaultValue="1" required />
      </label>
      <Button type="submit" variant="primary" disabled={busy || !plans.length}>
        {isEnglish ? 'Create field work order' : 'إنشاء أمر العمل الميداني'}
      </Button>
    </form>
  );
}

function InstallationProgress({
  locale,
  installation,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly installation: SalesInstallation;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const transition = (
    toStatus: string,
    evidence: Readonly<Record<string, unknown>>,
    note?: string,
  ) =>
    onSubmit({
      installationId: installation.id,
      expectedVersion: installation.version,
      toStatus,
      evidence,
      ...(note ? { note } : {}),
    });
  return (
    <div className="sales-installation-progress">
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Field installation' : 'التركيب الميداني'}</strong>
        <span>
          {installation.id} · {statusLabel(installation.status, locale)} · v{installation.version}
        </span>
      </div>
      {installation.status === 'requested' || installation.status === 'blocked' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void transition(
              'scheduled',
              {
                scheduledFor: new Date(formText(form, 'scheduledFor')).toISOString(),
                installerUserId: formText(form, 'installerUserId'),
              },
              isEnglish
                ? 'Installation scheduled from service order'
                : 'تمت جدولة التركيب من الطلب',
            ).catch(() => undefined);
          }}
        >
          <label>
            <span>{isEnglish ? 'Appointment' : 'الموعد'}</span>
            <input name="scheduledFor" type="datetime-local" required />
          </label>
          <label>
            <span>{isEnglish ? 'Installer staff ID' : 'معرّف فني التركيب'}</span>
            <input name="installerUserId" required />
          </label>
          <Button type="submit" variant="secondary" disabled={busy}>
            {isEnglish ? 'Schedule installation' : 'جدولة التركيب'}
          </Button>
        </form>
      ) : installation.status === 'scheduled' ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void transition('in_progress', {}).catch(() => undefined)}
        >
          {isEnglish ? 'Start field work' : 'بدء العمل الميداني'}
        </Button>
      ) : installation.status === 'in_progress' ||
        installation.status === 'ready_for_activation' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void transition(
              installation.status === 'in_progress' ? 'ready_for_activation' : 'completed',
              {
                signalTest: formText(form, 'signalTest'),
                equipmentSerial: formText(form, 'equipmentSerial'),
                completedAt: new Date().toISOString(),
              },
              isEnglish ? 'Verified field completion evidence' : 'أدلة إكمال ميداني متحقق منها',
            ).catch(() => undefined);
          }}
        >
          <label>
            <span>{isEnglish ? 'Signal / optical test' : 'فحص الإشارة / الألياف'}</span>
            <input name="signalTest" required />
          </label>
          <label>
            <span>{isEnglish ? 'Equipment serial' : 'الرقم التسلسلي للجهاز'}</span>
            <input name="equipmentSerial" required />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            {installation.status === 'in_progress'
              ? isEnglish
                ? 'Submit activation evidence'
                : 'إرسال أدلة التفعيل'
              : isEnglish
                ? 'Complete installation'
                : 'إكمال التركيب'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function SubscriberConversionForm({
  locale,
  orderId,
  orderNumber,
  lead,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly lead: SalesLead;
  readonly busy: boolean;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <form
      className="sales-order-execution"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSubmit({
          orderId,
          subscriberNumber: formText(form, 'subscriberNumber'),
          householdReference: formText(form, 'householdReference'),
          locationLabel: formText(form, 'locationLabel'),
          ...(formText(form, 'areaCode') ? { areaCode: formText(form, 'areaCode') } : {}),
          reason: 'Accepted service order converted to a governed subscriber record',
        }).catch(() => undefined);
      }}
    >
      <div className="sales-order-execution__intro">
        <strong>{isEnglish ? 'Ready: create subscriber' : 'جاهز: إنشاء المشترك'}</strong>
        <span>
          {isEnglish
            ? `${lead.displayName} and the accepted service address will be copied atomically from the order.`
            : `سيتم نسخ ${lead.displayName} وعنوان الخدمة المقبول ذرياً من الطلب.`}
        </span>
      </div>
      <label>
        <span>{isEnglish ? 'Subscriber number' : 'رقم المشترك'}</span>
        <input name="subscriberNumber" defaultValue={`SUB-${orderNumber}`} required />
      </label>
      <label>
        <span>{isEnglish ? 'Household / company reference' : 'مرجع المنزل / الشركة'}</span>
        <input name="householdReference" defaultValue={`HH-${lead.leadNumber}`} required />
      </label>
      <label>
        <span>{isEnglish ? 'Service location label' : 'اسم موقع الخدمة'}</span>
        <input
          name="locationLabel"
          defaultValue={isEnglish ? 'Primary service location' : 'موقع الخدمة الرئيسي'}
          required
        />
      </label>
      <label>
        <span>{isEnglish ? 'Area code (optional)' : 'رمز المنطقة (اختياري)'}</span>
        <input name="areaCode" />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {isEnglish ? 'Create and link subscriber' : 'إنشاء المشترك وربطه'}
      </Button>
    </form>
  );
}

function LeadForm({
  locale,
  scopes,
  busy,
  onClose,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly scopes: SalesWorkspaceData['scopes'];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const [branchId, setBranchId] = useState(scopes.branches[0]?.id ?? '');
  const areas = useMemo(
    () => scopes.areas.filter((item) => item.parentId === branchId),
    [branchId, scopes.areas],
  );
  const [areaId, setAreaId] = useState('');
  const routes = scopes.routes.filter((item) => item.parentId === areaId);
  return (
    <Surface className="sales-editor">
      <div className="surface__header">
        <div>
          <h2>{isEnglish ? 'Capture a qualified prospect' : 'تسجيل عميل محتمل'}</h2>
          <p>
            {isEnglish
              ? 'No duplicate subscriber is created; conversion happens only after accepted order checks.'
              : 'لا يتم إنشاء مشترك مكرر؛ التحويل يحصل فقط بعد فحوص الطلب المقبول.'}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          {isEnglish ? 'Close' : 'إغلاق'}
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSubmit({
            leadNumber: formText(form, 'leadNumber'),
            partyKind: formText(form, 'partyKind'),
            displayName: formText(form, 'displayName'),
            source: formText(form, 'source'),
            primaryPhone: formText(form, 'phone') || undefined,
            primaryEmail: formText(form, 'email') || undefined,
            branchId,
            areaId,
            routeId: formText(form, 'routeId'),
            addressLine: formText(form, 'address'),
            needsSummary: formText(form, 'needs'),
            reason: 'New sales prospect captured with contact and service need evidence',
          }).catch(() => undefined);
        }}
      >
        <label>
          <span>{isEnglish ? 'Lead number' : 'رقم العميل المحتمل'}</span>
          <input
            name="leadNumber"
            required
            defaultValue={`LEAD-${Date.now().toString().slice(-6)}`}
          />
        </label>
        <label>
          <span>{isEnglish ? 'Type' : 'النوع'}</span>
          <select name="partyKind">
            <option value="person">{isEnglish ? 'Person' : 'فرد'}</option>
            <option value="business">{isEnglish ? 'Business' : 'شركة'}</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Name' : 'الاسم'}</span>
          <input name="displayName" required />
        </label>
        <label>
          <span>{isEnglish ? 'Source' : 'المصدر'}</span>
          <select name="source">
            <option value="referral">{isEnglish ? 'Referral' : 'إحالة'}</option>
            <option value="walk_in">{isEnglish ? 'Walk-in' : 'زيارة المكتب'}</option>
            <option value="campaign">{isEnglish ? 'Campaign' : 'حملة'}</option>
            <option value="partner">{isEnglish ? 'Partner' : 'شريك'}</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Phone' : 'الهاتف'}</span>
          <input name="phone" inputMode="tel" />
        </label>
        <label>
          <span>{isEnglish ? 'Email' : 'البريد'}</span>
          <input name="email" type="email" />
        </label>
        <ScopeSelect
          label={isEnglish ? 'Branch' : 'الفرع'}
          items={scopes.branches}
          locale={locale}
          value={branchId}
          onChange={(value) => {
            setBranchId(value);
            setAreaId('');
          }}
        />
        <ScopeSelect
          label={isEnglish ? 'Area' : 'المنطقة'}
          items={areas}
          locale={locale}
          value={areaId}
          onChange={setAreaId}
        />
        <ScopeSelect
          label={isEnglish ? 'Route' : 'المسار'}
          items={routes}
          locale={locale}
          name="routeId"
        />
        <label className="sales-editor__wide">
          <span>{isEnglish ? 'Service address' : 'عنوان الخدمة'}</span>
          <input name="address" required />
        </label>
        <label className="sales-editor__wide">
          <span>{isEnglish ? 'Needs survey' : 'احتياجات العميل'}</span>
          <textarea name="needs" required rows={3} />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !branchId || !areaId || !routes.length}
        >
          {isEnglish ? 'Save lead' : 'حفظ العميل المحتمل'}
        </Button>
      </form>
    </Surface>
  );
}

function OfferForm({
  locale,
  scopes,
  busy,
  onClose,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly scopes: SalesWorkspaceData['scopes'];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  return (
    <Surface className="sales-editor">
      <div className="surface__header">
        <div>
          <h2>{isEnglish ? 'Publish an effective offer version' : 'نشر نسخة باقة نافذة'}</h2>
          <p>
            {isEnglish
              ? 'Pricing and technical terms are snapshotted into every quotation.'
              : 'يتم تثبيت السعر والشروط التقنية داخل كل عرض سعر.'}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          {isEnglish ? 'Close' : 'إغلاق'}
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const currency = formText(form, 'currency');
          const minor = currency === 'USD' ? 100 : 1;
          void onSubmit({
            branchId: formText(form, 'branchId') || undefined,
            code: formText(form, 'code'),
            version: Number(formText(form, 'version')),
            nameEn: formText(form, 'nameEn'),
            nameAr: formText(form, 'nameAr'),
            accessTechnology: formText(form, 'technology'),
            downstreamMbps: Number(formText(form, 'downstream')),
            upstreamMbps: Number(formText(form, 'upstream')),
            ...(formText(form, 'quota') ? { quotaGb: Number(formText(form, 'quota')) } : {}),
            recurringAmountMinor: Math.round(Number(formText(form, 'recurring')) * minor),
            activationFeeMinor: Math.round(Number(formText(form, 'activation') || '0') * minor),
            equipmentFeeMinor: Math.round(Number(formText(form, 'equipment') || '0') * minor),
            currency,
            commitmentMonths: Number(formText(form, 'commitment') || '0'),
            eligibility: {},
            policy: {},
            effectiveFrom: formText(form, 'effectiveFrom'),
            reason: 'Commercial offer version approved for controlled publication',
          }).catch(() => undefined);
        }}
      >
        <label>
          <span>{isEnglish ? 'Code' : 'الرمز'}</span>
          <input name="code" required />
        </label>
        <label>
          <span>{isEnglish ? 'Version' : 'النسخة'}</span>
          <input name="version" type="number" min="1" defaultValue="1" required />
        </label>
        <label>
          <span>English name</span>
          <input name="nameEn" required />
        </label>
        <label>
          <span>الاسم العربي</span>
          <input name="nameAr" dir="rtl" required />
        </label>
        <label>
          <span>{isEnglish ? 'Technology' : 'التقنية'}</span>
          <select name="technology">
            <option value="fiber">Fiber</option>
            <option value="fixed_wireless">Fixed wireless</option>
            <option value="dsl">DSL</option>
            <option value="leased_line">Leased line</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Branch (optional)' : 'الفرع (اختياري)'}</span>
          <select name="branchId">
            <option value="">{isEnglish ? 'All branches' : 'كل الفروع'}</option>
            {scopes.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {scopeName(item, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Download Mbps' : 'تنزيل Mbps'}</span>
          <input name="downstream" type="number" min="1" required />
        </label>
        <label>
          <span>{isEnglish ? 'Upload Mbps' : 'رفع Mbps'}</span>
          <input name="upstream" type="number" min="1" required />
        </label>
        <label>
          <span>{isEnglish ? 'Quota GB (blank = unlimited)' : 'الحصة GB (فارغ = غير محدودة)'}</span>
          <input name="quota" type="number" min="1" />
        </label>
        <label>
          <span>{isEnglish ? 'Currency' : 'العملة'}</span>
          <select name="currency">
            <option value="USD">USD</option>
            <option value="LBP">LBP</option>
          </select>
        </label>
        <label>
          <span>{isEnglish ? 'Recurring amount' : 'المبلغ الدوري'}</span>
          <input name="recurring" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          <span>{isEnglish ? 'Activation fee' : 'رسم التفعيل'}</span>
          <input name="activation" type="number" min="0" step="0.01" defaultValue="0" />
        </label>
        <label>
          <span>{isEnglish ? 'Equipment fee' : 'رسم التجهيزات'}</span>
          <input name="equipment" type="number" min="0" step="0.01" defaultValue="0" />
        </label>
        <label>
          <span>{isEnglish ? 'Commitment months' : 'أشهر الالتزام'}</span>
          <input name="commitment" type="number" min="0" max="60" defaultValue="0" />
        </label>
        <label>
          <span>{isEnglish ? 'Effective from' : 'نافذة من'}</span>
          <input
            name="effectiveFrom"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {isEnglish ? 'Publish version' : 'نشر النسخة'}
        </Button>
      </form>
    </Surface>
  );
}

function ScopeSelect({
  label,
  items,
  locale,
  value,
  onChange,
  name,
  optional = false,
}: {
  readonly label: string;
  readonly items: readonly TenantScopeItem[];
  readonly locale: Locale;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly name?: string;
  readonly optional?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        name={name}
        required={!optional}
        value={onChange ? value : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      >
        <option value="">—</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {scopeName(item, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
function scopeName(item: TenantScopeItem, locale: Locale) {
  return `${item.code} · ${locale === 'en' ? item.nameEn : item.nameAr}`;
}
function formText(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}
function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function nextDay(dateValue: string) {
  return addDays(dateValue, 1);
}
function addMonth(dateValue: string) {
  const source = new Date(`${dateValue}T00:00:00.000Z`);
  const targetYear = source.getUTCFullYear() + (source.getUTCMonth() === 11 ? 1 : 0);
  const targetMonth = (source.getUTCMonth() + 1) % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(source.getUTCDate(), lastTargetDay)))
    .toISOString()
    .slice(0, 10);
}
function money(minor: number, currency: 'USD' | 'LBP', locale: Locale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-LB' : 'ar-LB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  }).format(currency === 'USD' ? minor / 100 : minor);
}
function viewLabel(view: SalesView, locale: Locale) {
  const labels = {
    pipeline: { en: 'Sales pipeline', ar: 'مسار المبيعات' },
    catalogue: { en: 'Offer catalogue', ar: 'دليل الباقات' },
    orders: { en: 'Service orders', ar: 'طلبات الخدمة' },
  } as const;
  return labels[view][locale];
}
function taskLabel(type: string, locale: Locale) {
  const labels: Record<string, { en: string; ar: string }> = {
    commercial: { en: 'Commercial acceptance', ar: 'القبول التجاري' },
    subscriber: { en: 'Subscriber conversion', ar: 'تحويل المشترك' },
    resource: { en: 'Resource reservation', ar: 'حجز الموارد' },
    installation: { en: 'Installation delivery', ar: 'تنفيذ التركيب' },
    network: { en: 'Network activation', ar: 'تفعيل الشبكة' },
    billing: { en: 'First billing', ar: 'الفوترة الأولى' },
  };
  return labels[type]?.[locale] ?? type;
}
function orderCommandLabel(command: string, locale: Locale) {
  const labels: Record<string, { en: string; ar: string }> = {
    place_on_hold: { en: 'Place on hold', ar: 'تعليق الطلب' },
    resume: { en: 'Resume order', ar: 'استئناف الطلب' },
    cancel: { en: 'Cancel order', ar: 'إلغاء الطلب' },
  };
  return labels[command]?.[locale] ?? command.replaceAll('_', ' ');
}
function statusLabel(status: string, locale: Locale) {
  const labels: Record<string, { en: string; ar: string }> = {
    new: { en: 'New', ar: 'جديد' },
    qualifying: { en: 'Qualifying', ar: 'قيد التأهيل' },
    qualified: { en: 'Qualified', ar: 'مؤهل' },
    disqualified: { en: 'Not eligible', ar: 'غير مؤهل' },
    quoted: { en: 'Quoted', ar: 'تم التسعير' },
    won: { en: 'Won', ar: 'مكتسب' },
    lost: { en: 'Lost', ar: 'مفقود' },
    eligible: { en: 'Eligible', ar: 'مؤهل' },
    ineligible: { en: 'Ineligible', ar: 'غير مؤهل' },
    survey_required: { en: 'Survey required', ar: 'يلزم كشف' },
    reserved: { en: 'Capacity reserved', ar: 'السعة محجوزة' },
    pending_approval: { en: 'Approval required', ar: 'تحتاج موافقة' },
    issued: { en: 'Issued', ar: 'صادر' },
    approved: { en: 'Approved', ar: 'معتمد' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    accepted: { en: 'Accepted', ar: 'مقبول' },
    expired: { en: 'Expired', ar: 'منتهي' },
    ready: { en: 'Ready', ar: 'جاهز' },
    pending: { en: 'Pending', ar: 'معلق' },
    running: { en: 'Running', ar: 'قيد التنفيذ' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    blocked: { en: 'Blocked', ar: 'معطل' },
    failed: { en: 'Failed', ar: 'فشل' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
    validating: { en: 'Validating', ar: 'قيد التحقق' },
    in_progress: { en: 'In progress', ar: 'قيد التنفيذ' },
    on_hold: { en: 'On hold', ar: 'معلق' },
    fallout: { en: 'Fallout', ar: 'استثناء' },
  };
  return labels[status]?.[locale] ?? status.replaceAll('_', ' ');
}
