import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  supportCommandSchema,
  type SupportTicket,
  type SupportWorkspace as Workspace,
} from '@isp/contracts';
import { readSupportWorkspace, submitTenantOperation } from '../api';
import './support.css';

type Action = 'note' | 'escalate' | 'link_outage' | 'transition' | 'reopen' | 'redress';

export function SupportWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scope, setScope] = useState<'open' | 'all' | 'closed'>('open');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState('');
  const [action, setAction] = useState<Action>();
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [subscriberId, setSubscriberId] = useState('');
  const mounted = useRef(true);
  const locked = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setState('loading');
    void readSupportWorkspace(session, { status: scope })
      .then((result) => {
        if (active) {
          setData(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) {
          setData(undefined);
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, [session, scope, refresh]);
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const field = (form: FormData, key: string) => {
    const v = form.get(key);
    return typeof v === 'string' ? v.trim() : '';
  };
  const status = (value: SupportTicket['status']) =>
    ({
      open: t('Open', 'مفتوحة'),
      triaged: t('Triaged', 'مصنّفة'),
      in_progress: t('In progress', 'قيد المعالجة'),
      waiting: t('Waiting on customer', 'بانتظار العميل'),
      resolved: t('Resolved', 'محلولة'),
      closed: t('Closed', 'مغلقة'),
    })[value];
  const priority = (value: SupportTicket['priority']) =>
    ({
      low: t('Low', 'منخفضة'),
      normal: t('Normal', 'عادية'),
      high: t('High', 'مرتفعة'),
      urgent: t('Urgent', 'عاجلة'),
    })[value];
  const category = (value: SupportTicket['category']) =>
    ({
      technical: t('Technical', 'تقني'),
      billing: t('Billing', 'فوترة'),
      complaint: t('Complaint', 'شكوى'),
      request: t('Request', 'طلب'),
      other: t('Other', 'أخرى'),
    })[value];
  const channel = (value: SupportTicket['channel']) =>
    ({
      walk_in: t('Walk-in', 'حضور شخصي'),
      phone: t('Phone', 'هاتف'),
      whatsapp: 'WhatsApp',
      email: t('Email', 'بريد إلكتروني'),
      field: t('Field', 'ميداني'),
      internal: t('Internal', 'داخلي'),
    })[value];
  const verification = (method: string) =>
    ({
      none: t('Not verified', 'غير متحقق'),
      contact_match: t('Contact matched', 'تطابق جهة الاتصال'),
      id_document: t('ID document', 'وثيقة هوية'),
      account_reference: t('Account reference', 'مرجع الحساب'),
    })[method] ?? method;
  async function send(path: string, command: Readonly<Record<string, unknown>>, done: string) {
    if (!session || locked.current) return;
    const fingerprint = JSON.stringify({ path, command });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-support-${crypto.randomUUID()}` };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(session, path, command, retry.current.key);
      if (!mounted.current) return;
      retry.current = undefined;
      setCreating(false);
      setAction(undefined);
      if (typeof result.issueId === 'string') setSelected(result.issueId);
      if (typeof result.id === 'string') setSelected(result.id);
      setNotice(done);
      setRefresh((v) => v + 1);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : t(
                'The change was not confirmed. Check access or refresh a changed ticket, then retry the same values.',
                'لم يتأكد التغيير. تحقق من الصلاحيات أو حدّث التذكرة إذا تغيرت ثم أعد المحاولة بالقيم نفسها.',
              ),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const invalid = () =>
    setError(
      t(
        'Complete the required fields. A ticket needs a subscriber or a service and a verification method.',
        'أكمل الحقول المطلوبة. تحتاج التذكرة إلى مشترك أو خدمة وطريقة تحقق.',
      ),
    );
  function command(body: unknown, done: string) {
    const parsed = supportCommandSchema.safeParse(body);
    if (!parsed.success) return invalid();
    void send('support/commands', { command: parsed.data as Record<string, unknown> }, done);
  }
  const saved = t('Ticket saved and audited.', 'تم حفظ التذكرة وتدقيقها.');
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const method = field(form, 'verificationMethod');
    command(
      {
        action: 'create_ticket',
        subject: field(form, 'subject'),
        description: field(form, 'description'),
        priority: field(form, 'priority'),
        category: field(form, 'category'),
        channel: field(form, 'channel'),
        ...(subscriberId ? { subscriberId } : {}),
        ...(field(form, 'serviceId') ? { serviceId: field(form, 'serviceId') } : {}),
        verification: {
          method,
          ...(method === 'contact_match' ? { contact: field(form, 'verificationContact') } : {}),
          ...(method === 'id_document' || method === 'account_reference'
            ? { reference: field(form, 'verificationReference') }
            : {}),
        },
        ...(field(form, 'outageId') ? { outageId: field(form, 'outageId') } : {}),
      },
      saved,
    );
  }
  function act(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !action) return;
    const form = new FormData(event.currentTarget);
    const target = { issueId: ticket.id, expectedVersion: ticket.version };
    if (action === 'transition') {
      const toStatus = field(form, 'toStatus');
      const closing = toStatus === 'resolved' || toStatus === 'closed';
      void send(
        'issues/transitions',
        {
          ...target,
          toStatus,
          ...(field(form, 'note') ? { note: field(form, 'note') } : {}),
          evidence: closing ? { resolutionCode: field(form, 'resolutionCode') } : {},
        },
        saved,
      );
      return;
    }
    if (action === 'note')
      command(
        {
          action: 'add_note',
          ...target,
          note: field(form, 'note'),
          customerContact: field(form, 'customerContact') === 'on',
        },
        saved,
      );
    if (action === 'escalate')
      command(
        {
          action: 'escalate',
          ...target,
          toUserId: field(form, 'toUserId'),
          ...(field(form, 'note') ? { note: field(form, 'note') } : {}),
        },
        saved,
      );
    if (action === 'link_outage')
      command({ action: 'link_outage', ...target, outageId: field(form, 'outageId') }, saved);
    if (action === 'reopen')
      command({ action: 'reopen', ...target, note: field(form, 'note') }, saved);
    if (action === 'redress')
      command(
        {
          action: 'record_redress',
          ...target,
          redressKind: field(form, 'redressKind'),
          ...(field(form, 'reference') ? { reference: field(form, 'reference') } : {}),
          ...(field(form, 'note') ? { note: field(form, 'note') } : {}),
        },
        saved,
      );
  }
  if (!session)
    return (
      <section className="sup-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('Customer service', 'خدمة العملاء')}</h1>
        <p>
          {t(
            'Sign in to work tickets inside your permitted scope.',
            'سجّل الدخول للعمل على التذاكر ضمن نطاق صلاحيتك.',
          )}
        </p>
      </section>
    );
  const ticket = data?.tickets.find((i) => i.id === selected);
  const summary = data?.summary;
  const subscribers =
    data?.subscribers.filter((s) =>
      (s.name + ' ' + s.subscriberNumber).toLowerCase().includes(subscriberSearch.toLowerCase()),
    ) ?? [];
  const services =
    data?.services.filter((s) => !subscriberId || s.subscriberId === subscriberId) ?? [];
  const nextStatuses = ticket
    ? (
        {
          open: ['triaged', 'closed'],
          triaged: ['in_progress', 'waiting', 'resolved', 'closed'],
          in_progress: ['waiting', 'resolved'],
          waiting: ['in_progress', 'resolved', 'closed'],
          resolved: ['in_progress', 'closed'],
          closed: [],
        } as Record<SupportTicket['status'], SupportTicket['status'][]>
      )[ticket.status]
    : [];
  return (
    <section className="sup-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="sup-hero">
        <div>
          <span>{t('CUSTOMER SERVICE', 'خدمة العملاء')}</span>
          <h1>
            {t('Every call verified, every promise tracked.', 'كل مكالمة متحققة وكل وعد متابَع.')}
          </h1>
          <p>
            {t(
              'Tickets carry the intake channel, how the caller was verified, response and resolution targets by priority, notes, escalation, the incident they belong to and any redress granted.',
              'تحمل التذاكر قناة الاستقبال وطريقة التحقق من المتصل وأهداف الرد والحل حسب الأولوية والملاحظات والتصعيد والحادث المرتبط وأي تعويض مُنح.',
            )}
          </p>
        </div>
        {summary && (
          <dl className="sup-stats" aria-label={t('Ticket summary', 'ملخص التذاكر')}>
            <div>
              <dt>{t('Open', 'مفتوحة')}</dt>
              <dd>{summary.open}</dd>
            </div>
            <div>
              <dt>{t('Waiting', 'بانتظار العميل')}</dt>
              <dd>{summary.waiting}</dd>
            </div>
            <div className={summary.respondBreached > 0 ? 'is-alert' : ''}>
              <dt>{t('Response overdue', 'تجاوز مهلة الرد')}</dt>
              <dd>{summary.respondBreached}</dd>
            </div>
            <div className={summary.resolveBreached > 0 ? 'is-alert' : ''}>
              <dt>{t('Resolution overdue', 'تجاوز مهلة الحل')}</dt>
              <dd>{summary.resolveBreached}</dd>
            </div>
            <div>
              <dt>{t('Escalated', 'مصعّدة')}</dt>
              <dd>{summary.escalated}</dd>
            </div>
          </dl>
        )}
      </header>
      {notice && (
        <p className="sup-panel sup-panel--positive" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="sup-panel sup-panel--negative" role="alert">
          {error}
        </p>
      )}
      <div className="sup-toolbar">
        <label className="sup-inline">
          {t('Show', 'عرض')}
          <select
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="open">{t('Open tickets', 'التذاكر المفتوحة')}</option>
            <option value="closed">{t('Resolved and closed', 'المحلولة والمغلقة')}</option>
            <option value="all">{t('All', 'الكل')}</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          {t('Refresh', 'تحديث')}
        </button>
        <button
          type="button"
          className="sup-primary"
          disabled={busy || state !== 'ready'}
          onClick={() => {
            setCreating((v) => !v);
            setAction(undefined);
            setError('');
            setNotice('');
          }}
        >
          {creating
            ? t('Close new ticket', 'إغلاق التذكرة الجديدة')
            : t('New ticket', 'تذكرة جديدة')}
        </button>
      </div>
      {state === 'loading' && <p role="status">{t('Loading tickets…', 'جارٍ تحميل التذاكر…')}</p>}
      {state === 'error' && (
        <div className="sup-panel sup-panel--negative" role="alert">
          <h2>{t('Workspace unavailable', 'مساحة العمل غير متاحة')}</h2>
          <p>
            {t(
              'Check your connection and subscriber-view permission, then refresh.',
              'تحقق من الاتصال وصلاحية عرض المشتركين ثم حدّث.',
            )}
          </p>
          <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            {t('Refresh', 'تحديث')}
          </button>
        </div>
      )}
      {creating && data && (
        <form className="sup-card sup-form" onSubmit={create}>
          <h2>{t('New ticket', 'تذكرة جديدة')}</h2>
          <div className="sup-grid">
            <label className="sup-field">
              <span>{t('Find subscriber', 'البحث عن مشترك')}</span>
              <input
                type="search"
                value={subscriberSearch}
                onChange={(e) => setSubscriberSearch(e.target.value)}
              />
            </label>
            <label className="sup-field">
              <span>{t('Subscriber', 'المشترك')}</span>
              <select value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)}>
                <option value="">{t('Choose a subscriber', 'اختر مشتركاً')}</option>
                {subscribers.slice(0, 200).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subscriberNumber} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Service (optional)', 'الخدمة (اختياري)')}</span>
              <select name="serviceId" defaultValue="">
                <option value="">{t('Not service-specific', 'غير مرتبطة بخدمة')}</option>
                {services.slice(0, 300).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.serviceNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Channel', 'القناة')}</span>
              <select name="channel" defaultValue="phone">
                {(['walk_in', 'phone', 'whatsapp', 'email', 'field', 'internal'] as const).map(
                  (c) => (
                    <option key={c} value={c}>
                      {channel(c)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Category', 'الفئة')}</span>
              <select name="category" defaultValue="technical">
                {(['technical', 'billing', 'complaint', 'request', 'other'] as const).map((c) => (
                  <option key={c} value={c}>
                    {category(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Priority', 'الأولوية')}</span>
              <select name="priority" defaultValue="normal">
                {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                  <option key={p} value={p}>
                    {priority(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Caller verification', 'التحقق من المتصل')}</span>
              <select name="verificationMethod" defaultValue="contact_match">
                {(['contact_match', 'id_document', 'account_reference', 'none'] as const).map(
                  (m) => (
                    <option key={m} value={m}>
                      {verification(m)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="sup-field">
              <span>{t('Contact given by caller', 'جهة الاتصال التي قدمها المتصل')}</span>
              <input name="verificationContact" dir="ltr" placeholder="+961 3 000000" />
            </label>
            <label className="sup-field">
              <span>{t('Verification reference', 'مرجع التحقق')}</span>
              <input name="verificationReference" maxLength={200} />
            </label>
            <label className="sup-field">
              <span>{t('Related incident (optional)', 'الحادث المرتبط (اختياري)')}</span>
              <select name="outageId" defaultValue="">
                <option value="">{t('None', 'لا شيء')}</option>
                {data.openIncidents.map((o) => (
                  <option key={o.id} value={o.id}>
                    {locale === 'ar' ? o.titleAr : o.titleEn}
                  </option>
                ))}
              </select>
            </label>
            <label className="sup-field sup-field--wide">
              <span>{t('Subject', 'الموضوع')}</span>
              <input name="subject" required minLength={3} maxLength={300} />
            </label>
            <label className="sup-field sup-field--wide">
              <span>{t('Description', 'الوصف')}</span>
              <textarea name="description" required minLength={3} maxLength={5000} />
            </label>
          </div>
          <p className="sup-note">
            {t(
              'Response and resolution targets are set from the priority: urgent 1 h / 4 h, high 4 h / 24 h, normal 8 h / 72 h, low 24 h / 5 days.',
              'تُحدد مهل الرد والحل من الأولوية: عاجلة ساعة / ٤ ساعات، مرتفعة ٤ / ٢٤ ساعة، عادية ٨ / ٧٢ ساعة، منخفضة ٢٤ ساعة / ٥ أيام.',
            )}
          </p>
          <button type="submit" className="sup-primary" disabled={busy}>
            {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Open ticket', 'فتح التذكرة')}
          </button>
        </form>
      )}
      {state === 'ready' && data && (
        <div className="sup-workbench">
          <section className="sup-card" aria-label={t('Ticket queue', 'قائمة التذاكر')}>
            <h2>{t('Tickets', 'التذاكر')}</h2>
            {data.tickets.length === 0 && (
              <p className="sup-note">{t('No tickets in this view.', 'لا تذاكر في هذا العرض.')}</p>
            )}
            <ul className="sup-list">
              {data.tickets.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className={selected === i.id ? 'is-selected' : ''}
                    aria-pressed={selected === i.id}
                    disabled={busy}
                    onClick={() => {
                      setSelected(i.id);
                      setAction(undefined);
                      setError('');
                    }}
                  >
                    <span className="sup-row-meta">
                      <span className={'sup-priority priority-' + i.priority}>
                        {priority(i.priority)}
                      </span>
                      <span>{status(i.status)}</span>
                    </span>
                    <strong>{i.subject}</strong>
                    <span>
                      {i.issueNumber} · {i.subscriberName ?? '—'} · {category(i.category)}
                      {i.respondBreached && (
                        <em className="sup-breach">{t('response overdue', 'تجاوز الرد')}</em>
                      )}
                      {i.resolveBreached && (
                        <em className="sup-breach">{t('resolution overdue', 'تجاوز الحل')}</em>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="sup-card" aria-label={t('Ticket detail', 'تفاصيل التذكرة')}>
            {!ticket ? (
              <p className="sup-note">
                {t(
                  'Select a ticket to see its facts, notes and actions.',
                  'اختر تذكرة لعرض حقائقها وملاحظاتها وإجراءاتها.',
                )}
              </p>
            ) : (
              <>
                <span className="sup-eyebrow">
                  {ticket.issueNumber} · {t('Version', 'الإصدار')} {ticket.version}
                </span>
                <h2>{ticket.subject}</h2>
                <p>{ticket.description}</p>
                <dl className="sup-facts">
                  <div>
                    <dt>{t('Status', 'الحالة')}</dt>
                    <dd>{status(ticket.status)}</dd>
                  </div>
                  <div>
                    <dt>{t('Subscriber', 'المشترك')}</dt>
                    <dd>
                      {ticket.subscriberName ?? '—'}
                      {ticket.serviceNumber ? ` · ${ticket.serviceNumber}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Channel · verification', 'القناة · التحقق')}</dt>
                    <dd>
                      {channel(ticket.channel)} · {verification(ticket.verification.method)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Respond by', 'الرد قبل')}</dt>
                    <dd>
                      {date(ticket.slaRespondDueAt)}
                      {ticket.firstResponseAt
                        ? ` · ${t('responded', 'تم الرد')} ${date(ticket.firstResponseAt)}`
                        : ticket.respondBreached
                          ? ` · ${t('overdue', 'متجاوز')}`
                          : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Resolve by', 'الحل قبل')}</dt>
                    <dd>
                      {date(ticket.slaResolveDueAt)}
                      {ticket.resolveBreached ? ` · ${t('overdue', 'متجاوز')}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Assignee', 'المسؤول')}</dt>
                    <dd>
                      {ticket.assigneeName ?? t('Unassigned', 'غير معيّن')}
                      {ticket.escalatedToName
                        ? ` · ${t('escalated to', 'صُعّدت إلى')} ${ticket.escalatedToName}`
                        : ''}
                    </dd>
                  </div>
                  {ticket.outageId && (
                    <div>
                      <dt>{t('Incident', 'الحادث')}</dt>
                      <dd>{locale === 'ar' ? ticket.outageTitleAr : ticket.outageTitleEn}</dd>
                    </div>
                  )}
                  {ticket.redress.kind && (
                    <div>
                      <dt>{t('Redress', 'التعويض')}</dt>
                      <dd>
                        {ticket.redress.kind} {ticket.redress.reference ?? ''}
                      </dd>
                    </div>
                  )}
                  {ticket.reopenCount > 0 && (
                    <div>
                      <dt>{t('Reopened', 'أُعيد فتحها')}</dt>
                      <dd>{ticket.reopenCount}×</dd>
                    </div>
                  )}
                </dl>
                <div className="sup-actions">
                  {ticket.status !== 'closed' && (
                    <button type="button" disabled={busy} onClick={() => setAction('note')}>
                      {t('Add note', 'إضافة ملاحظة')}
                    </button>
                  )}
                  {nextStatuses.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => setAction('transition')}>
                      {t('Change status', 'تغيير الحالة')}
                    </button>
                  )}
                  {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
                    <button type="button" disabled={busy} onClick={() => setAction('escalate')}>
                      {t('Escalate', 'تصعيد')}
                    </button>
                  )}
                  {data.openIncidents.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => setAction('link_outage')}>
                      {t('Link incident', 'ربط بحادث')}
                    </button>
                  )}
                  {ticket.status === 'resolved' && (
                    <button type="button" disabled={busy} onClick={() => setAction('reopen')}>
                      {t('Reopen', 'إعادة فتح')}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => setAction('redress')}>
                    {t('Record redress', 'تسجيل تعويض')}
                  </button>
                </div>
                {action && (
                  <form className="sup-form" onSubmit={act} key={action + ticket.version}>
                    <h3>
                      {action === 'note'
                        ? t('Add note', 'إضافة ملاحظة')
                        : action === 'transition'
                          ? t('Change status', 'تغيير الحالة')
                          : action === 'escalate'
                            ? t('Escalate to a colleague', 'تصعيد إلى زميل')
                            : action === 'link_outage'
                              ? t('Link to an incident', 'ربط بحادث')
                              : action === 'reopen'
                                ? t('Reopen ticket', 'إعادة فتح التذكرة')
                                : t('Record redress', 'تسجيل تعويض')}
                    </h3>
                    {action === 'transition' && (
                      <>
                        <label className="sup-field">
                          <span>{t('Next status', 'الحالة التالية')}</span>
                          <select name="toStatus" defaultValue={nextStatuses[0]}>
                            {nextStatuses.map((s) => (
                              <option key={s} value={s}>
                                {status(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="sup-field">
                          <span>
                            {t(
                              'Resolution code (for resolved or closed)',
                              'رمز الحل (للمحلولة أو المغلقة)',
                            )}
                          </span>
                          <input name="resolutionCode" maxLength={120} dir="ltr" />
                        </label>
                      </>
                    )}
                    {action === 'escalate' && (
                      <label className="sup-field">
                        <span>{t('Escalate to', 'التصعيد إلى')}</span>
                        <select name="toUserId" required defaultValue="">
                          <option value="">{t('Choose a member', 'اختر عضواً')}</option>
                          {data.members.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {action === 'link_outage' && (
                      <label className="sup-field">
                        <span>{t('Incident', 'الحادث')}</span>
                        <select name="outageId" required defaultValue="">
                          <option value="">
                            {t('Choose an open incident', 'اختر حادثاً مفتوحاً')}
                          </option>
                          {data.openIncidents.map((o) => (
                            <option key={o.id} value={o.id}>
                              {locale === 'ar' ? o.titleAr : o.titleEn}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {action === 'redress' && (
                      <div className="sup-grid">
                        <label className="sup-field">
                          <span>{t('Kind', 'النوع')}</span>
                          <select name="redressKind" defaultValue="credit_note">
                            <option value="credit_note">{t('Credit note', 'إشعار دائن')}</option>
                            <option value="goodwill">{t('Goodwill', 'حسن نية')}</option>
                            <option value="service_extension">
                              {t('Service extension', 'تمديد الخدمة')}
                            </option>
                            <option value="none">{t('No redress', 'دون تعويض')}</option>
                          </select>
                        </label>
                        <label className="sup-field">
                          <span>{t('Document reference', 'مرجع المستند')}</span>
                          <input name="reference" maxLength={200} dir="ltr" />
                        </label>
                      </div>
                    )}
                    {action !== 'link_outage' && (
                      <label className="sup-field">
                        <span>{t('Note', 'ملاحظة')}</span>
                        <textarea
                          name="note"
                          required={action === 'note' || action === 'reopen'}
                          minLength={3}
                          maxLength={4000}
                        />
                      </label>
                    )}
                    {action === 'note' && (
                      <label className="sup-check">
                        <input type="checkbox" name="customerContact" />
                        {t(
                          'This was a contact with the customer (counts as the first response)',
                          'كان هذا تواصلاً مع العميل (يُحتسب كأول رد)',
                        )}
                      </label>
                    )}
                    <div className="sup-actions">
                      <button type="submit" className="sup-primary" disabled={busy}>
                        {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm', 'تأكيد')}
                      </button>
                      <button type="button" onClick={() => setAction(undefined)}>
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </form>
                )}
                <h3>{t('Notes', 'الملاحظات')}</h3>
                {ticket.notes.length === 0 ? (
                  <p className="sup-note">{t('No notes yet.', 'لا ملاحظات بعد.')}</p>
                ) : (
                  <ol className="sup-timeline">
                    {ticket.notes.map((n) => (
                      <li key={n.id}>
                        <strong>
                          {n.authorName} · {n.kind}
                        </strong>
                        <time dateTime={n.createdAt}>{date(n.createdAt)}</time>
                        <p>{n.note}</p>
                      </li>
                    ))}
                  </ol>
                )}
                <h3>{t('Status history', 'سجل الحالة')}</h3>
                <ol className="sup-timeline">
                  {ticket.history.map((h) => (
                    <li key={h.id}>
                      <strong>
                        {h.fromStatus
                          ? `${status(h.fromStatus as SupportTicket['status'])} → `
                          : ''}
                        {status(h.toStatus as SupportTicket['status'])}
                      </strong>
                      <time dateTime={h.occurredAt}>{date(h.occurredAt)}</time>
                      {h.note && <p>{h.note}</p>}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
