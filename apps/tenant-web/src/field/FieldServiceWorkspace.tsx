import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type {
  FieldDispatchCommand,
  FieldExecutionCommand,
  FieldServiceWorkspace as Workspace,
  FieldTechnicianRecord,
  TechnicianSkill,
  WorkOrderKind,
  WorkOrderRecord,
  WorkOrderStatus,
} from '@isp/contracts';
import { fieldDispatchCommandSchema, fieldExecutionCommandSchema } from '@isp/contracts';
import { Button, StatePanel, StatusBadge, type ApiSession, type Locale } from '@isp/ui';
import { readFieldServiceWorkspace, submitTenantOperation, TenantApiError } from '../api';
import './field.css';

type Translate = (en: string, ar: string) => string;
type Tab = 'board' | 'orders' | 'technicians';
type Panel = { readonly tone: 'positive' | 'negative'; readonly text: string };

const SKILLS: readonly TechnicianSkill[] = [
  'fiber',
  'wireless',
  'copper',
  'cpe',
  'survey',
  'maintenance',
];
const KINDS: readonly WorkOrderKind[] = [
  'installation',
  'repair',
  'relocation',
  'maintenance',
  'disconnection',
  'survey',
];

const defaultChecklists: Readonly<Record<WorkOrderKind, string>> = {
  installation:
    'ont|ONT mounted and powered|تثبيت وتشغيل الـONT\nsignal|Optical signal within range|الإشارة الضوئية ضمن النطاق\nwifi|Wi-Fi handed over to customer|تسليم الواي فاي للعميل',
  repair:
    'fault|Fault located and fixed|تحديد العطل وإصلاحه\nverify|Service verified with customer|التحقق من الخدمة مع العميل',
  relocation:
    'remove|Equipment removed from old address|إزالة المعدات من العنوان القديم\ninstall|Equipment installed at new address|تركيب المعدات في العنوان الجديد',
  maintenance: 'inspect|Site inspected|فحص الموقع\nreport|Findings reported|تسجيل النتائج',
  disconnection:
    'recover|Equipment recovered|استرداد المعدات\nconfirm|Disconnection confirmed|تأكيد الفصل',
  survey:
    'access|Access and line of sight checked|التحقق من الوصول وخط الرؤية\nestimate|Material estimate recorded|تسجيل تقدير المواد',
};

/**
 * Dispatch board, work order queue and technician registry. Every mutation carries bilingual
 * evidence and the record version it was based on; conflicts surface as refresh-and-retry.
 */
export function FieldServiceWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  const rtl = locale === 'ar';
  const [tab, setTab] = useState<Tab>('board');
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<'active' | 'all' | 'closed'>('active');
  const [technicianFilter, setTechnicianFilter] = useState('');
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [editingTechnician, setEditingTechnician] = useState<FieldTechnicianRecord | 'new'>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>();

  const load = useCallback(async () => {
    try {
      const value = await readFieldServiceWorkspace(session, {
        day,
        status,
        ...(technicianFilter ? { technicianId: technicianFilter } : {}),
      });
      setData(value);
      setState('ready');
    } catch (error) {
      setState(error instanceof TenantApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [session, day, status, technicianFilter]);
  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  const run = async (
    path: 'field-service/dispatch' | 'field-service/execute',
    command: FieldDispatchCommand | FieldExecutionCommand,
    success: string,
  ) => {
    setBusy(true);
    setPanel(undefined);
    try {
      const parsed =
        path === 'field-service/dispatch'
          ? fieldDispatchCommandSchema.parse(command)
          : fieldExecutionCommandSchema.parse(command);
      const result = await submitTenantOperation(session, path, { command: parsed }, key());
      setPanel({
        tone: 'positive',
        text: `${success}${typeof result.workOrderNumber === 'string' ? ` · ${result.workOrderNumber}` : ''}`,
      });
      setCreating(false);
      setEditingTechnician(undefined);
      await load();
      return true;
    } catch (error) {
      setPanel({
        tone: 'negative',
        text:
          error instanceof Error
            ? error.message
            : t('The action failed safely.', 'فشل الإجراء بأمان.'),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selected = data?.workOrders.find((order) => order.id === selectedId);
  const statusLabel = (value: WorkOrderStatus) =>
    ({
      open: t('Open', 'مفتوح'),
      scheduled: t('Scheduled', 'مجدول'),
      dispatched: t('Dispatched', 'مُرسل'),
      on_site: t('On site', 'في الموقع'),
      completed: t('Completed', 'مكتمل'),
      failed: t('Failed', 'فشل'),
      cancelled: t('Cancelled', 'ملغى'),
    })[value];
  const kindLabel = (value: WorkOrderKind) =>
    ({
      installation: t('Installation', 'تركيب'),
      repair: t('Repair', 'إصلاح'),
      relocation: t('Relocation', 'نقل'),
      maintenance: t('Maintenance', 'صيانة'),
      disconnection: t('Disconnection', 'فصل'),
      survey: t('Survey', 'معاينة'),
    })[value];
  const skillLabel = (value: TechnicianSkill) =>
    ({
      fiber: t('Fiber', 'ألياف'),
      wireless: t('Wireless', 'لاسلكي'),
      copper: t('Copper', 'نحاس'),
      cpe: t('CPE', 'أجهزة العميل'),
      survey: t('Survey', 'معاينة'),
      maintenance: t('Maintenance', 'صيانة'),
    })[value];
  const tone = (value: WorkOrderStatus) =>
    value === 'completed'
      ? 'positive'
      : value === 'failed' || value === 'cancelled'
        ? 'critical'
        : value === 'on_site' || value === 'dispatched'
          ? 'primary'
          : 'neutral';
  const time = (value?: string) =>
    value
      ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const counts = useMemo(() => {
    const orders = data?.workOrders ?? [];
    return {
      open: orders.filter((o) => o.status === 'open' || o.status === 'scheduled').length,
      dispatched: orders.filter((o) => o.status === 'dispatched').length,
      onSite: orders.filter((o) => o.status === 'on_site').length,
      overdue: orders.filter((o) => o.overdue).length,
    };
  }, [data]);

  if (state !== 'ready' || !data) {
    return (
      <StatePanel
        variant={state === 'ready' ? 'loading' : state}
        title={
          state === 'denied'
            ? t('Field service is outside your scope', 'الخدمة الميدانية خارج نطاقك')
            : state === 'error'
              ? t('The dispatch board could not be loaded', 'تعذّر تحميل لوحة الإرسال')
              : t('Loading the dispatch board', 'جارٍ تحميل لوحة الإرسال')
        }
        description={
          state === 'denied'
            ? t(
                'Ask an administrator for installation view permission.',
                'اطلب من المدير صلاحية عرض التركيبات.',
              )
            : state === 'error'
              ? t(
                  'No change was made. Retry the read safely.',
                  'لم يُجرَ أي تغيير. أعد المحاولة بأمان.',
                )
              : t(
                  'Work orders, technicians and open installations are being read.',
                  'تُقرأ أوامر العمل والفنيون والتركيبات المفتوحة.',
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

  const activeTechnicians = data.technicians.filter((technician) => technician.active);
  const boardOrders = data.workOrders.filter(
    (order) => !['completed', 'failed', 'cancelled'].includes(order.status) || status !== 'active',
  );

  return (
    <div className="field-shell" dir={rtl ? 'rtl' : 'ltr'}>
      <header className="field-hero">
        <div>
          <span>{t('Field service', 'الخدمة الميدانية')}</span>
          <h1>{t('Dispatch board and technician work', 'لوحة الإرسال وعمل الفنيين')}</h1>
          <p>
            {t(
              'Schedule appointment windows, dispatch skilled technicians, and close work with checklists and evidence. Installation work drives the linked installation record automatically.',
              'جدول نوافذ المواعيد، أرسل الفنيين المؤهلين، وأغلق العمل بقوائم التحقق والأدلة. يقود عمل التركيب سجل التركيب المرتبط تلقائياً.',
            )}
          </p>
        </div>
        <dl className="field-hero__stats">
          <div>
            <dt>{t('Waiting', 'بانتظار')}</dt>
            <dd>{counts.open}</dd>
          </div>
          <div>
            <dt>{t('Dispatched', 'مُرسل')}</dt>
            <dd>{counts.dispatched}</dd>
          </div>
          <div>
            <dt>{t('On site', 'في الموقع')}</dt>
            <dd>{counts.onSite}</dd>
          </div>
          <div className={counts.overdue ? 'is-alert' : undefined}>
            <dt>{t('Overdue SLA', 'تجاوز اتفاقية الخدمة')}</dt>
            <dd>{counts.overdue}</dd>
          </div>
        </dl>
      </header>

      <div className="field-toolbar">
        <nav className="field-tabs" aria-label={t('Field service views', 'عروض الخدمة الميدانية')}>
          {(['board', 'orders', 'technicians'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => setTab(item)}
            >
              {item === 'board'
                ? t('Dispatch board', 'لوحة الإرسال')
                : item === 'orders'
                  ? t('Work orders', 'أوامر العمل')
                  : t('Technicians', 'الفنيون')}
            </button>
          ))}
        </nav>
        <div className="field-filters">
          <label>
            <span>{t('Day', 'اليوم')}</span>
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          <label>
            <span>{t('Status', 'الحالة')}</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="active">{t('Active', 'نشط')}</option>
              <option value="all">{t('All', 'الكل')}</option>
              <option value="closed">{t('Closed', 'مغلق')}</option>
            </select>
          </label>
          <label>
            <span>{t('Technician', 'الفني')}</span>
            <select
              value={technicianFilter}
              onChange={(event) => setTechnicianFilter(event.target.value)}
            >
              <option value="">{t('Everyone', 'الجميع')}</option>
              {data.technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.displayName}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={() => setCreating(true)} disabled={busy}>
            {t('New work order', 'أمر عمل جديد')}
          </Button>
        </div>
      </div>

      {panel ? (
        <p className={`field-panel field-panel--${panel.tone}`} role="status">
          {panel.text}
        </p>
      ) : null}

      {creating ? (
        <CreateWorkOrderForm
          t={t}
          data={data}
          busy={busy}
          kindLabel={kindLabel}
          skillLabel={skillLabel}
          onCancel={() => setCreating(false)}
          onSubmit={(command) =>
            void run(
              'field-service/dispatch',
              command,
              t('Work order created', 'تم إنشاء أمر العمل'),
            )
          }
        />
      ) : null}

      {tab === 'board' ? (
        <section className="field-board" aria-label={t('Dispatch board', 'لوحة الإرسال')}>
          <BoardColumn
            title={t('Unassigned', 'غير معيّن')}
            orders={boardOrders.filter((order) => !order.technicianId)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            t={t}
            statusLabel={statusLabel}
            kindLabel={kindLabel}
            tone={tone}
            time={time}
          />
          {activeTechnicians.map((technician) => (
            <BoardColumn
              key={technician.id}
              title={technician.displayName}
              subtitle={technician.skills.map(skillLabel).join(' · ')}
              orders={boardOrders.filter((order) => order.technicianId === technician.id)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              t={t}
              statusLabel={statusLabel}
              kindLabel={kindLabel}
              tone={tone}
              time={time}
            />
          ))}
          {activeTechnicians.length === 0 ? (
            <div className="field-column field-column--empty">
              <h3>{t('No active technicians', 'لا يوجد فنيون نشطون')}</h3>
              <p>{t('Register technicians to start dispatching.', 'سجّل الفنيين لبدء الإرسال.')}</p>
              <Button variant="secondary" onClick={() => setTab('technicians')}>
                {t('Open technician registry', 'فتح سجل الفنيين')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'orders' ? (
        <section className="field-card">
          <h2>
            {t('Work orders', 'أوامر العمل')} · {data.totalCount}
          </h2>
          {data.workOrders.length === 0 ? (
            <p className="field-note">
              {t(
                'No work orders match the current filters.',
                'لا توجد أوامر عمل تطابق عوامل التصفية الحالية.',
              )}
            </p>
          ) : (
            <div className="field-table" role="table">
              <div role="row" className="field-table__head">
                <span role="columnheader">{t('Number', 'الرقم')}</span>
                <span role="columnheader">{t('Work', 'العمل')}</span>
                <span role="columnheader">{t('Customer', 'العميل')}</span>
                <span role="columnheader">{t('Window', 'النافذة')}</span>
                <span role="columnheader">{t('Technician', 'الفني')}</span>
                <span role="columnheader">{t('Status', 'الحالة')}</span>
              </div>
              {data.workOrders.map((order) => (
                <button
                  type="button"
                  role="row"
                  key={order.id}
                  className={order.id === selectedId ? 'is-selected' : undefined}
                  onClick={() => setSelectedId(order.id)}
                >
                  <span role="cell" dir="ltr">
                    {order.workOrderNumber}
                  </span>
                  <span role="cell">
                    {kindLabel(order.kind)} · {rtl ? order.titleAr : order.titleEn}
                  </span>
                  <span role="cell">{order.subscriberName ?? '—'}</span>
                  <span role="cell">
                    {order.windowStart
                      ? `${time(order.windowStart)} → ${time(order.windowEnd)}`
                      : t('Unscheduled', 'غير مجدول')}
                  </span>
                  <span role="cell">{order.technicianName ?? '—'}</span>
                  <span role="cell">
                    <StatusBadge tone={tone(order.status)}>{statusLabel(order.status)}</StatusBadge>
                    {order.overdue ? (
                      <StatusBadge tone="warning">{t('Overdue', 'متأخر')}</StatusBadge>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'technicians' ? (
        <TechnicianRegistry
          t={t}
          data={data}
          busy={busy}
          skillLabel={skillLabel}
          editing={editingTechnician}
          onEdit={setEditingTechnician}
          onSubmit={(command) =>
            void run(
              'field-service/dispatch',
              command,
              command.action === 'register_technician'
                ? t('Technician registered', 'تم تسجيل الفني')
                : t('Technician updated', 'تم تحديث الفني'),
            )
          }
        />
      ) : null}

      {selected ? (
        <WorkOrderDetail
          t={t}
          rtl={rtl}
          order={selected}
          data={data}
          busy={busy}
          statusLabel={statusLabel}
          kindLabel={kindLabel}
          skillLabel={skillLabel}
          tone={tone}
          time={time}
          onClose={() => setSelectedId(undefined)}
          onDispatch={(command, success) => run('field-service/dispatch', command, success)}
          onExecute={(command, success) => run('field-service/execute', command, success)}
        />
      ) : null}
    </div>
  );
}

function BoardColumn({
  title,
  subtitle,
  orders,
  selectedId,
  onSelect,
  t,
  statusLabel,
  kindLabel,
  tone,
  time,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly orders: readonly WorkOrderRecord[];
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  readonly t: Translate;
  readonly statusLabel: (value: WorkOrderStatus) => string;
  readonly kindLabel: (value: WorkOrderKind) => string;
  readonly tone: (value: WorkOrderStatus) => 'positive' | 'critical' | 'primary' | 'neutral';
  readonly time: (value?: string) => string;
}) {
  return (
    <div className="field-column">
      <h3>
        {title} <small>{orders.length}</small>
      </h3>
      {subtitle ? <p className="field-note">{subtitle}</p> : null}
      {orders.length === 0 ? (
        <p className="field-note">{t('Nothing here for this day.', 'لا شيء هنا لهذا اليوم.')}</p>
      ) : null}
      {orders.map((order) => (
        <button
          type="button"
          key={order.id}
          className={`field-ticket${order.id === selectedId ? ' is-selected' : ''}${order.overdue ? ' is-overdue' : ''}`}
          onClick={() => onSelect(order.id)}
        >
          <span className="field-ticket__number" dir="ltr">
            {order.workOrderNumber}
          </span>
          <strong>{kindLabel(order.kind)}</strong>
          <span>{order.subscriberName ?? order.titleEn}</span>
          <span className="field-ticket__time">
            {order.windowStart
              ? `${time(order.windowStart)} → ${time(order.windowEnd)}`
              : t('Unscheduled', 'غير مجدول')}
          </span>
          <StatusBadge tone={tone(order.status)}>{statusLabel(order.status)}</StatusBadge>
        </button>
      ))}
    </div>
  );
}

function EvidenceFields({ t, prefix }: { readonly t: Translate; readonly prefix: string }) {
  return (
    <div className="field-grid">
      <label className="field-field">
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
      <label className="field-field">
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
      <label className="field-field field-field--wide">
        <span>{t('Evidence reference', 'مرجع الدليل')}</span>
        <input name="evidence" id={`${prefix}-evidence`} required minLength={8} maxLength={2000} />
      </label>
    </div>
  );
}

function readEvidence(form: FormData) {
  return {
    reasonEn: text(form, 'reasonEn'),
    reasonAr: text(form, 'reasonAr'),
    evidence: text(form, 'evidence'),
  };
}
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
function isoOrUndefined(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
function key(): string {
  return `web-field-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}
function parseChecklist(source: string) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawKey = '', labelEn = '', labelAr = '', required = ''] = line
        .split('|')
        .map((part) => part.trim());
      return {
        key: rawKey,
        labelEn,
        labelAr: labelAr || labelEn,
        required: required !== 'optional',
      };
    });
}

function CreateWorkOrderForm({
  t,
  data,
  busy,
  kindLabel,
  skillLabel,
  onCancel,
  onSubmit,
}: {
  readonly t: Translate;
  readonly data: Workspace;
  readonly busy: boolean;
  readonly kindLabel: (value: WorkOrderKind) => string;
  readonly skillLabel: (value: TechnicianSkill) => string;
  readonly onCancel: () => void;
  readonly onSubmit: (command: FieldDispatchCommand) => void;
}) {
  const [kind, setKind] = useState<WorkOrderKind>('installation');
  const [checklist, setChecklist] = useState(defaultChecklists.installation);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const windowStart = isoOrUndefined(text(form, 'windowStart'));
    const windowEnd = isoOrUndefined(text(form, 'windowEnd'));
    const slaDueAt = isoOrUndefined(text(form, 'slaDueAt'));
    const technicianId = text(form, 'technicianId');
    const installationId = text(form, 'installationId');
    const subscriberId = text(form, 'subscriberId');
    onSubmit({
      action: 'create_work_order',
      kind,
      priority: text(form, 'priority') as FieldDispatchCommand extends { priority?: infer P }
        ? NonNullable<P>
        : never,
      ...(installationId ? { installationId } : {}),
      ...(subscriberId ? { subscriberId } : {}),
      titleEn: text(form, 'titleEn'),
      titleAr: text(form, 'titleAr'),
      ...(text(form, 'instructions') ? { instructions: text(form, 'instructions') } : {}),
      requiredSkills: SKILLS.filter((skill) => form.get(`skill-${skill}`) === 'on'),
      checklist: parseChecklist(text(form, 'checklist')),
      ...(windowStart ? { windowStart } : {}),
      ...(windowEnd ? { windowEnd } : {}),
      ...(slaDueAt ? { slaDueAt } : {}),
      ...(technicianId ? { technicianId } : {}),
      ...readEvidence(form),
    });
  };
  return (
    <form className="field-card field-form" onSubmit={submit} aria-busy={busy}>
      <h2>{t('New work order', 'أمر عمل جديد')}</h2>
      <div className="field-grid">
        <label className="field-field">
          <span>{t('Kind', 'النوع')}</span>
          <select
            name="kind"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as WorkOrderKind;
              setKind(next);
              setChecklist(defaultChecklists[next]);
            }}
          >
            {KINDS.map((item) => (
              <option key={item} value={item}>
                {kindLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-field">
          <span>{t('Priority', 'الأولوية')}</span>
          <select name="priority" defaultValue="normal">
            <option value="low">{t('Low', 'منخفضة')}</option>
            <option value="normal">{t('Normal', 'عادية')}</option>
            <option value="high">{t('High', 'مرتفعة')}</option>
            <option value="urgent">{t('Urgent', 'عاجلة')}</option>
          </select>
        </label>
        {kind === 'installation' ? (
          <label className="field-field field-field--wide">
            <span>{t('Installation', 'التركيب')}</span>
            <select name="installationId" required>
              <option value="">{t('Choose an open installation', 'اختر تركيباً مفتوحاً')}</option>
              {data.openInstallations.map((installation) => (
                <option key={installation.id} value={installation.id}>
                  {installation.subscriberName} · {installation.serviceNumber} ·{' '}
                  {installation.status}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field-field field-field--wide">
            <span>{t('Subscriber ID', 'معرّف المشترك')}</span>
            <input name="subscriberId" dir="ltr" placeholder="uuid" />
          </label>
        )}
        <label className="field-field">
          <span>{t('Title (English)', 'العنوان (بالإنجليزية)')}</span>
          <input name="titleEn" required minLength={3} maxLength={200} dir="ltr" />
        </label>
        <label className="field-field">
          <span>{t('Title (Arabic)', 'العنوان (بالعربية)')}</span>
          <input name="titleAr" required minLength={3} maxLength={200} dir="rtl" />
        </label>
        <label className="field-field field-field--wide">
          <span>{t('Instructions', 'التعليمات')}</span>
          <textarea name="instructions" rows={2} maxLength={4000} />
        </label>
        <fieldset className="field-field field-field--wide field-skills">
          <legend>{t('Required skills', 'المهارات المطلوبة')}</legend>
          {SKILLS.map((skill) => (
            <label key={skill}>
              <input
                type="checkbox"
                name={`skill-${skill}`}
                defaultChecked={kind === 'installation' && skill === 'fiber'}
              />
              <span>{skillLabel(skill)}</span>
            </label>
          ))}
        </fieldset>
        <label className="field-field field-field--wide">
          <span>
            {t(
              'Checklist (one per line: key | English | Arabic | optional)',
              'قائمة التحقق (سطر لكل بند: المفتاح | الإنجليزية | العربية | optional)',
            )}
          </span>
          <textarea
            name="checklist"
            rows={4}
            value={checklist}
            onChange={(event) => setChecklist(event.target.value)}
            dir="ltr"
          />
        </label>
        <label className="field-field">
          <span>{t('Window start', 'بداية النافذة')}</span>
          <input name="windowStart" type="datetime-local" />
        </label>
        <label className="field-field">
          <span>{t('Window end', 'نهاية النافذة')}</span>
          <input name="windowEnd" type="datetime-local" />
        </label>
        <label className="field-field">
          <span>{t('SLA due', 'موعد اتفاقية الخدمة')}</span>
          <input name="slaDueAt" type="datetime-local" />
        </label>
        <label className="field-field">
          <span>{t('Technician (needs a window)', 'الفني (يتطلب نافذة)')}</span>
          <select name="technicianId" defaultValue="">
            <option value="">{t('Unassigned', 'غير معيّن')}</option>
            {data.technicians
              .filter((technician) => technician.active)
              .map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.displayName}
                </option>
              ))}
          </select>
        </label>
      </div>
      <EvidenceFields t={t} prefix="create" />
      <div className="field-actions">
        <Button
          type="submit"
          variant="primary"
          isLoading={busy}
          loadingLabel={t('Saving…', 'جارٍ الحفظ…')}
        >
          {t('Create work order', 'إنشاء أمر العمل')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Cancel', 'إلغاء')}
        </Button>
      </div>
    </form>
  );
}

function TechnicianRegistry({
  t,
  data,
  busy,
  skillLabel,
  editing,
  onEdit,
  onSubmit,
}: {
  readonly t: Translate;
  readonly data: Workspace;
  readonly busy: boolean;
  readonly skillLabel: (value: TechnicianSkill) => string;
  readonly editing?: FieldTechnicianRecord | 'new';
  readonly onEdit: (value?: FieldTechnicianRecord | 'new') => void;
  readonly onSubmit: (command: FieldDispatchCommand) => void;
}) {
  const current = editing && editing !== 'new' ? editing : undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const shared = {
      displayName: text(form, 'displayName'),
      ...(text(form, 'phone') ? { phone: text(form, 'phone') } : {}),
      skills: SKILLS.filter((skill) => form.get(`skill-${skill}`) === 'on'),
      ...(text(form, 'branchId') ? { branchId: text(form, 'branchId') } : {}),
      areaIds: data.scopes.areas
        .filter((area) => form.get(`area-${area.id}`) === 'on')
        .map((area) => area.id),
      ...readEvidence(form),
    };
    onSubmit(
      current
        ? {
            action: 'update_technician',
            technicianId: current.id,
            expectedVersion: current.version,
            active: form.get('active') === 'on',
            ...shared,
          }
        : { action: 'register_technician', userId: text(form, 'userId'), ...shared },
    );
  };
  const registered = new Set(data.technicians.map((technician) => technician.userId));
  return (
    <section className="field-card">
      <div className="field-card__header">
        <h2>
          {t('Technicians', 'الفنيون')} · {data.technicians.length}
        </h2>
        <Button variant="primary" onClick={() => onEdit('new')} disabled={busy}>
          {t('Register technician', 'تسجيل فني')}
        </Button>
      </div>
      {editing ? (
        <form className="field-form" onSubmit={submit} aria-busy={busy} key={current?.id ?? 'new'}>
          <div className="field-grid">
            {current ? null : (
              <label className="field-field field-field--wide">
                <span>{t('Workspace member', 'عضو مساحة العمل')}</span>
                <select name="userId" required defaultValue="">
                  <option value="">{t('Choose a member', 'اختر عضواً')}</option>
                  {data.staff
                    .filter((member) => !registered.has(member.userId))
                    .map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName} · {member.email} · {member.roleKey}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field-field">
              <span>{t('Display name', 'الاسم المعروض')}</span>
              <input
                name="displayName"
                required
                maxLength={120}
                defaultValue={current?.displayName ?? ''}
              />
            </label>
            <label className="field-field">
              <span>{t('Phone (+country…)', 'الهاتف (+رمز الدولة…)')}</span>
              <input
                name="phone"
                dir="ltr"
                defaultValue={current?.phone ?? ''}
                placeholder="+9617…"
              />
            </label>
            <label className="field-field">
              <span>{t('Home branch', 'الفرع الأساسي')}</span>
              <select name="branchId" defaultValue={current?.branchId ?? ''}>
                <option value="">{t('Tenant-wide', 'على مستوى المؤسسة')}</option>
                {data.scopes.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.nameEn} / {branch.nameAr}
                  </option>
                ))}
              </select>
            </label>
            {current ? (
              <label className="field-check">
                <input type="checkbox" name="active" defaultChecked={current.active} />
                <span>{t('Active', 'نشط')}</span>
              </label>
            ) : null}
            <fieldset className="field-field field-field--wide field-skills">
              <legend>{t('Skills', 'المهارات')}</legend>
              {SKILLS.map((skill) => (
                <label key={skill}>
                  <input
                    type="checkbox"
                    name={`skill-${skill}`}
                    defaultChecked={current?.skills.includes(skill) ?? false}
                  />
                  <span>{skillLabel(skill)}</span>
                </label>
              ))}
            </fieldset>
            {data.scopes.areas.length > 0 ? (
              <fieldset className="field-field field-field--wide field-skills">
                <legend>{t('Territories (areas)', 'المناطق المخدومة')}</legend>
                {data.scopes.areas.map((area) => (
                  <label key={area.id}>
                    <input
                      type="checkbox"
                      name={`area-${area.id}`}
                      defaultChecked={current?.areaIds.includes(area.id) ?? false}
                    />
                    <span>
                      {area.nameEn} / {area.nameAr}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
          <EvidenceFields t={t} prefix="technician" />
          <div className="field-actions">
            <Button
              type="submit"
              variant="primary"
              isLoading={busy}
              loadingLabel={t('Saving…', 'جارٍ الحفظ…')}
            >
              {current ? t('Save technician', 'حفظ الفني') : t('Register', 'تسجيل')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onEdit(undefined)}
              disabled={busy}
            >
              {t('Cancel', 'إلغاء')}
            </Button>
          </div>
        </form>
      ) : null}
      {data.technicians.length === 0 ? (
        <p className="field-note">
          {t('No technicians registered yet.', 'لم يُسجَّل أي فني بعد.')}
        </p>
      ) : (
        <div className="field-table" role="table">
          <div role="row" className="field-table__head field-table__head--technicians">
            <span role="columnheader">{t('Name', 'الاسم')}</span>
            <span role="columnheader">{t('Skills', 'المهارات')}</span>
            <span role="columnheader">{t('Phone', 'الهاتف')}</span>
            <span role="columnheader">{t('Active work', 'العمل النشط')}</span>
            <span role="columnheader">{t('Status', 'الحالة')}</span>
          </div>
          {data.technicians.map((technician) => (
            <button
              type="button"
              role="row"
              key={technician.id}
              className="field-table__row--technicians"
              onClick={() => onEdit(technician)}
            >
              <span role="cell">{technician.displayName}</span>
              <span role="cell">{technician.skills.map(skillLabel).join(', ') || '—'}</span>
              <span role="cell" dir="ltr">
                {technician.phone ?? '—'}
              </span>
              <span role="cell">{technician.openWorkOrders}</span>
              <span role="cell">
                <StatusBadge tone={technician.active ? 'positive' : 'neutral'}>
                  {technician.active ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                </StatusBadge>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkOrderDetail({
  t,
  rtl,
  order,
  data,
  busy,
  statusLabel,
  kindLabel,
  skillLabel,
  tone,
  time,
  onClose,
  onDispatch,
  onExecute,
}: {
  readonly t: Translate;
  readonly rtl: boolean;
  readonly order: WorkOrderRecord;
  readonly data: Workspace;
  readonly busy: boolean;
  readonly statusLabel: (value: WorkOrderStatus) => string;
  readonly kindLabel: (value: WorkOrderKind) => string;
  readonly skillLabel: (value: TechnicianSkill) => string;
  readonly tone: (value: WorkOrderStatus) => 'positive' | 'critical' | 'primary' | 'neutral';
  readonly time: (value?: string) => string;
  readonly onClose: () => void;
  readonly onDispatch: (command: FieldDispatchCommand, success: string) => Promise<boolean>;
  readonly onExecute: (command: FieldExecutionCommand, success: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<
    'none' | 'schedule' | 'assign' | 'cancel' | 'start' | 'complete' | 'fail'
  >('none');
  useEffect(() => setMode('none'), [order.id, order.version]);
  const events = data.events.filter((event) => event.workOrderId === order.id);
  const technicians = data.technicians.filter(
    (technician) =>
      technician.active && order.requiredSkills.every((skill) => technician.skills.includes(skill)),
  );
  const closed = ['completed', 'failed', 'cancelled'].includes(order.status);
  const submitDispatch =
    (build: (form: FormData) => FieldDispatchCommand, success: string) =>
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void onDispatch(build(new FormData(event.currentTarget)), success);
    };
  const submitExecute =
    (build: (form: FormData) => FieldExecutionCommand, success: string) =>
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void onExecute(build(new FormData(event.currentTarget)), success);
    };
  const base = { workOrderId: order.id, expectedVersion: order.version };
  let form: ReactNode = null;
  if (mode === 'schedule') {
    form = (
      <form
        className="field-form"
        onSubmit={submitDispatch(
          (f) => ({
            action: 'schedule_work_order',
            ...base,
            windowStart: new Date(text(f, 'windowStart')).toISOString(),
            windowEnd: new Date(text(f, 'windowEnd')).toISOString(),
            ...(text(f, 'technicianId') ? { technicianId: text(f, 'technicianId') } : {}),
            ...(text(f, 'slaDueAt')
              ? { slaDueAt: new Date(text(f, 'slaDueAt')).toISOString() }
              : {}),
            ...readEvidence(f),
          }),
          t('Appointment scheduled', 'تمت جدولة الموعد'),
        )}
      >
        <div className="field-grid">
          <label className="field-field">
            <span>{t('Window start', 'بداية النافذة')}</span>
            <input name="windowStart" type="datetime-local" required />
          </label>
          <label className="field-field">
            <span>{t('Window end', 'نهاية النافذة')}</span>
            <input name="windowEnd" type="datetime-local" required />
          </label>
          <label className="field-field">
            <span>{t('SLA due', 'موعد اتفاقية الخدمة')}</span>
            <input name="slaDueAt" type="datetime-local" />
          </label>
          <label className="field-field">
            <span>{t('Technician', 'الفني')}</span>
            <select name="technicianId" defaultValue={order.technicianId ?? ''}>
              <option value="">{t('Keep unassigned', 'إبقاؤه غير معيّن')}</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <EvidenceFields t={t} prefix="schedule" />
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Schedule', 'جدولة')}
        </Button>
      </form>
    );
  } else if (mode === 'assign') {
    form = (
      <form
        className="field-form"
        onSubmit={submitDispatch(
          (f) => ({
            action: 'assign_work_order',
            ...base,
            ...(text(f, 'technicianId') ? { technicianId: text(f, 'technicianId') } : {}),
            ...readEvidence(f),
          }),
          t('Assignment updated', 'تم تحديث التعيين'),
        )}
      >
        <label className="field-field">
          <span>{t('Technician', 'الفني')}</span>
          <select name="technicianId" defaultValue={order.technicianId ?? ''}>
            <option value="">
              {t('Return to unassigned queue', 'إعادة إلى قائمة غير المعيّن')}
            </option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.displayName} · {technician.openWorkOrders} {t('active', 'نشط')}
              </option>
            ))}
          </select>
        </label>
        <EvidenceFields t={t} prefix="assign" />
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Save assignment', 'حفظ التعيين')}
        </Button>
      </form>
    );
  } else if (mode === 'cancel') {
    form = (
      <form
        className="field-form"
        onSubmit={submitDispatch(
          (f) => ({ action: 'cancel_work_order', ...base, ...readEvidence(f) }),
          t('Work order cancelled', 'تم إلغاء أمر العمل'),
        )}
      >
        <EvidenceFields t={t} prefix="cancel" />
        <Button type="submit" variant="secondary" isLoading={busy}>
          {t('Confirm cancellation', 'تأكيد الإلغاء')}
        </Button>
      </form>
    );
  } else if (mode === 'start') {
    form = (
      <form
        className="field-form"
        onSubmit={submitExecute(
          (f) => ({ action: 'start_work_order', ...base, ...readEvidence(f) }),
          t('Work started on site', 'بدأ العمل في الموقع'),
        )}
      >
        <EvidenceFields t={t} prefix="start" />
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Confirm arrival', 'تأكيد الوصول')}
        </Button>
      </form>
    );
  } else if (mode === 'complete') {
    form = (
      <form
        className="field-form"
        onSubmit={submitExecute(
          (f) => ({
            action: 'complete_work_order',
            ...base,
            checklist: order.checklist.map((item) => ({
              key: item.key,
              done: f.get(`check-${item.key}`) === 'on',
              ...(text(f, `note-${item.key}`) ? { note: text(f, `note-${item.key}`) } : {}),
            })),
            outcome: {
              ...(text(f, 'signalDbm') ? { signalDbm: Number(text(f, 'signalDbm')) } : {}),
              ...(text(f, 'downloadMbps') ? { downloadMbps: Number(text(f, 'downloadMbps')) } : {}),
              ...(text(f, 'uploadMbps') ? { uploadMbps: Number(text(f, 'uploadMbps')) } : {}),
              ...(text(f, 'serialNumbers')
                ? {
                    serialNumbers: text(f, 'serialNumbers')
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(text(f, 'customerName') ? { customerName: text(f, 'customerName') } : {}),
              customerAcknowledged: f.get('customerAcknowledged') === 'on',
              ...(text(f, 'notes') ? { notes: text(f, 'notes') } : {}),
            },
            ...readEvidence(f),
          }),
          t('Work completed', 'اكتمل العمل'),
        )}
      >
        <div className="field-checklist">
          {order.checklist.map((item) => (
            <div key={item.key} className="field-checklist__item">
              <label className="field-check">
                <input type="checkbox" name={`check-${item.key}`} />
                <span>
                  {rtl ? item.labelAr : item.labelEn}
                  {item.required === false ? ` (${t('optional', 'اختياري')})` : ''}
                </span>
              </label>
              <input name={`note-${item.key}`} placeholder={t('Note', 'ملاحظة')} maxLength={500} />
            </div>
          ))}
        </div>
        <div className="field-grid">
          <label className="field-field">
            <span>{t('Signal (dBm)', 'الإشارة (dBm)')}</span>
            <input name="signalDbm" type="number" step="0.1" min={-60} max={10} dir="ltr" />
          </label>
          <label className="field-field">
            <span>{t('Download (Mbps)', 'التنزيل (ميغابت/ث)')}</span>
            <input name="downloadMbps" type="number" step="0.1" min={0} dir="ltr" />
          </label>
          <label className="field-field">
            <span>{t('Upload (Mbps)', 'الرفع (ميغابت/ث)')}</span>
            <input name="uploadMbps" type="number" step="0.1" min={0} dir="ltr" />
          </label>
          <label className="field-field">
            <span>
              {t('Serial numbers (comma separated)', 'الأرقام التسلسلية (مفصولة بفاصلة)')}
            </span>
            <input name="serialNumbers" dir="ltr" />
          </label>
          <label className="field-field">
            <span>{t('Customer name', 'اسم العميل')}</span>
            <input name="customerName" maxLength={120} />
          </label>
          <label className="field-check">
            <input type="checkbox" name="customerAcknowledged" />
            <span>{t('Customer acknowledged the work', 'أقرّ العميل بالعمل')}</span>
          </label>
          <label className="field-field field-field--wide">
            <span>{t('Notes', 'ملاحظات')}</span>
            <textarea name="notes" rows={2} maxLength={2000} />
          </label>
        </div>
        <EvidenceFields t={t} prefix="complete" />
        <Button type="submit" variant="primary" isLoading={busy}>
          {t('Complete work order', 'إكمال أمر العمل')}
        </Button>
      </form>
    );
  } else if (mode === 'fail') {
    form = (
      <form
        className="field-form"
        onSubmit={submitExecute(
          (f) => ({
            action: 'fail_work_order',
            ...base,
            failureReason: text(f, 'failureReason'),
            ...(text(f, 'revisitWindowStart')
              ? { revisitWindowStart: new Date(text(f, 'revisitWindowStart')).toISOString() }
              : {}),
            ...(text(f, 'revisitWindowEnd')
              ? { revisitWindowEnd: new Date(text(f, 'revisitWindowEnd')).toISOString() }
              : {}),
            ...readEvidence(f),
          }),
          t('Failure recorded; revisit created', 'تم تسجيل الفشل وإنشاء إعادة زيارة'),
        )}
      >
        <div className="field-grid">
          <label className="field-field field-field--wide">
            <span>{t('Failure reason', 'سبب الفشل')}</span>
            <textarea name="failureReason" required minLength={8} maxLength={1000} rows={2} />
          </label>
          <label className="field-field">
            <span>{t('Revisit window start', 'بداية نافذة إعادة الزيارة')}</span>
            <input name="revisitWindowStart" type="datetime-local" />
          </label>
          <label className="field-field">
            <span>{t('Revisit window end', 'نهاية نافذة إعادة الزيارة')}</span>
            <input name="revisitWindowEnd" type="datetime-local" />
          </label>
        </div>
        <EvidenceFields t={t} prefix="fail" />
        <Button type="submit" variant="secondary" isLoading={busy}>
          {t('Record failure', 'تسجيل الفشل')}
        </Button>
      </form>
    );
  }

  return (
    <aside className="field-detail" aria-label={t('Work order detail', 'تفاصيل أمر العمل')}>
      <header className="field-card__header">
        <div>
          <span className="field-ticket__number" dir="ltr">
            {order.workOrderNumber}
          </span>
          <h2>{rtl ? order.titleAr : order.titleEn}</h2>
          <p className="field-note">
            {kindLabel(order.kind)} · {order.priority} ·{' '}
            <StatusBadge tone={tone(order.status)}>{statusLabel(order.status)}</StatusBadge>
            {order.overdue ? (
              <StatusBadge tone="warning">{t('Overdue', 'متأخر')}</StatusBadge>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="field-detail__close"
          onClick={onClose}
          aria-label={t('Close detail', 'إغلاق التفاصيل')}
        >
          ×
        </button>
      </header>
      <dl className="field-facts">
        <div>
          <dt>{t('Customer', 'العميل')}</dt>
          <dd>
            {order.subscriberName ?? '—'}
            {order.subscriberNumber ? ` · ${order.subscriberNumber}` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('Service', 'الخدمة')}</dt>
          <dd dir="ltr">{order.serviceNumber ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('Address', 'العنوان')}</dt>
          <dd>{order.address ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('Window', 'النافذة')}</dt>
          <dd>
            {order.windowStart
              ? `${time(order.windowStart)} → ${time(order.windowEnd)}`
              : t('Unscheduled', 'غير مجدول')}
          </dd>
        </div>
        <div>
          <dt>{t('SLA due', 'موعد اتفاقية الخدمة')}</dt>
          <dd>{time(order.slaDueAt)}</dd>
        </div>
        <div>
          <dt>{t('Technician', 'الفني')}</dt>
          <dd>{order.technicianName ?? t('Unassigned', 'غير معيّن')}</dd>
        </div>
        <div>
          <dt>{t('Required skills', 'المهارات المطلوبة')}</dt>
          <dd>{order.requiredSkills.map(skillLabel).join(', ') || '—'}</dd>
        </div>
        {order.installationId ? (
          <div>
            <dt>{t('Installation', 'التركيب')}</dt>
            <dd>{order.installationStatus}</dd>
          </div>
        ) : null}
        {order.revisitOf ? (
          <div>
            <dt>{t('Revisit of', 'إعادة زيارة لـ')}</dt>
            <dd dir="ltr">{order.revisitOf}</dd>
          </div>
        ) : null}
        {order.failureReason ? (
          <div>
            <dt>{t('Failure reason', 'سبب الفشل')}</dt>
            <dd>{order.failureReason}</dd>
          </div>
        ) : null}
      </dl>
      {order.instructions ? (
        <p className="field-note" dir="auto">
          {order.instructions}
        </p>
      ) : null}
      {order.checklist.length > 0 ? (
        <ul className="field-checklist-view">
          {order.checklist.map((item) => (
            <li key={item.key} className={item.done ? 'is-done' : undefined}>
              <span>{item.done ? '✓' : '○'}</span> {rtl ? item.labelAr : item.labelEn}
              {item.note ? ` — ${item.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {Object.keys(order.outcome).length > 0 ? (
        <dl className="field-facts">
          {order.outcome.signalDbm !== undefined ? (
            <div>
              <dt>{t('Signal', 'الإشارة')}</dt>
              <dd dir="ltr">{order.outcome.signalDbm} dBm</dd>
            </div>
          ) : null}
          {order.outcome.serialNumbers?.length ? (
            <div>
              <dt>{t('Serials', 'الأرقام التسلسلية')}</dt>
              <dd dir="ltr">{order.outcome.serialNumbers.join(', ')}</dd>
            </div>
          ) : null}
          {order.outcome.customerAcknowledged !== undefined ? (
            <div>
              <dt>{t('Customer acknowledged', 'إقرار العميل')}</dt>
              <dd>{order.outcome.customerAcknowledged ? t('Yes', 'نعم') : t('No', 'لا')}</dd>
            </div>
          ) : null}
          {order.outcome.notes ? (
            <div>
              <dt>{t('Notes', 'ملاحظات')}</dt>
              <dd dir="auto">{order.outcome.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {closed ? null : (
        <div className="field-actions">
          {order.status === 'open' ||
          order.status === 'scheduled' ||
          order.status === 'dispatched' ? (
            <Button variant="secondary" onClick={() => setMode('schedule')} disabled={busy}>
              {order.windowStart ? t('Reschedule', 'إعادة الجدولة') : t('Schedule', 'جدولة')}
            </Button>
          ) : null}
          {order.status === 'scheduled' || order.status === 'dispatched' ? (
            <Button variant="secondary" onClick={() => setMode('assign')} disabled={busy}>
              {order.technicianId ? t('Reassign', 'إعادة التعيين') : t('Assign', 'تعيين')}
            </Button>
          ) : null}
          {order.status === 'dispatched' ? (
            <Button variant="primary" onClick={() => setMode('start')} disabled={busy}>
              {t('Arrived on site', 'وصل إلى الموقع')}
            </Button>
          ) : null}
          {order.status === 'on_site' ? (
            <Button variant="primary" onClick={() => setMode('complete')} disabled={busy}>
              {t('Complete', 'إكمال')}
            </Button>
          ) : null}
          {order.status === 'dispatched' || order.status === 'on_site' ? (
            <Button variant="secondary" onClick={() => setMode('fail')} disabled={busy}>
              {t('Could not complete', 'تعذّر الإكمال')}
            </Button>
          ) : null}
          {order.status !== 'on_site' ? (
            <Button variant="secondary" onClick={() => setMode('cancel')} disabled={busy}>
              {t('Cancel work', 'إلغاء العمل')}
            </Button>
          ) : null}
        </div>
      )}
      {form}
      <h3>{t('Timeline', 'الخط الزمني')}</h3>
      {events.length === 0 ? (
        <p className="field-note">{t('No events yet.', 'لا توجد أحداث بعد.')}</p>
      ) : (
        <ol className="field-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.occurredAt}>{time(event.occurredAt)}</time>
              <strong>{event.action.replaceAll('_', ' ')}</strong>
              {event.toStatus ? (
                <StatusBadge tone={tone(event.toStatus as WorkOrderStatus)}>
                  {statusLabel(event.toStatus as WorkOrderStatus)}
                </StatusBadge>
              ) : null}
              <span dir="auto">{rtl ? event.reasonAr : event.reasonEn}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
