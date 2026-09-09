import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  communicationCommandSchema,
  deliverNotificationsSchema,
  templateCommandSchema,
  type CommunicationsWorkspace as Workspace,
  type MessageTemplate,
  type NotificationRecord,
} from '@isp/contracts';
import { readCommunicationsWorkspace, submitTenantOperation } from '../api';
import './communications.css';

type View = 'outbox' | 'templates' | 'consent';

export function CommunicationsWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View>('outbox');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | 'new'>();
  const [consenting, setConsenting] = useState(false);
  const [subscriberSearch, setSubscriberSearch] = useState('');
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
    void readCommunicationsWorkspace(session)
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
  }, [session, refresh]);
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
  const channelName = (value: 'sms' | 'whatsapp' | 'email') =>
    ({ sms: 'SMS', whatsapp: 'WhatsApp', email: t('Email', 'بريد إلكتروني') })[value];
  const messageStatus = (value: NotificationRecord['status']) =>
    ({
      queued: t('Queued', 'في الانتظار'),
      sent: t('Sent', 'أُرسلت'),
      failed: t('Failed', 'فشلت'),
      suppressed: t('Suppressed', 'مكبوتة'),
      cancelled: t('Cancelled', 'ملغاة'),
    })[value];
  const suppression = (value: string | null) =>
    value === 'consent_withdrawn'
      ? t('consent withdrawn', 'سُحبت الموافقة')
      : value === 'no_destination'
        ? t('no contact on file', 'لا جهة اتصال مسجلة')
        : (value ?? '');
  const templateStatus = (value: MessageTemplate['status']) =>
    ({
      draft: t('Draft', 'مسودة'),
      approved: t('Approved', 'معتمد'),
      retired: t('Retired', 'متقاعد'),
    })[value];
  async function send(path: string, command: unknown, done: string) {
    if (!session || locked.current) return;
    const fingerprint = JSON.stringify({ path, command });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-comms-${crypto.randomUUID()}` };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(session, path, { command }, retry.current.key);
      if (!mounted.current) return;
      retry.current = undefined;
      setComposing(false);
      setEditing(undefined);
      setConsenting(false);
      const count = (value: unknown) => (typeof value === 'number' ? value : 0);
      const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
      setNotice(
        path === 'communications/deliver'
          ? `${done} ${count(result.sent)} ${t('sent', 'أُرسلت')}, ${count(result.failed)} ${t('failed', 'فشلت')}, ${skipped} ${t('skipped', 'تُخطيت')}.`
          : done,
      );
      setRefresh((v) => v + 1);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : t(
                'The change was not confirmed. Check access or refresh a changed record, then retry the same values.',
                'لم يتأكد التغيير. تحقق من الصلاحيات أو حدّث السجل إذا تغير ثم أعد المحاولة بالقيم نفسها.',
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
        'Complete the required fields in both languages. Template keys use lower-case letters, digits, dots, dashes and underscores.',
        'أكمل الحقول المطلوبة باللغتين. مفاتيح القوالب بأحرف صغيرة وأرقام ونقاط وشرطات وشرطات سفلية.',
      ),
    );
  function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = templateCommandSchema.safeParse({
      action: 'upsert_template',
      templateKey: field(form, 'templateKey'),
      ...(editing && editing !== 'new' ? { expectedVersion: editing.version } : {}),
      channel: field(form, 'channel'),
      nameEn: field(form, 'nameEn'),
      nameAr: field(form, 'nameAr'),
      ...(field(form, 'subjectEn') ? { subjectEn: field(form, 'subjectEn') } : {}),
      ...(field(form, 'subjectAr') ? { subjectAr: field(form, 'subjectAr') } : {}),
      bodyEn: field(form, 'bodyEn'),
      bodyAr: field(form, 'bodyAr'),
    });
    if (!parsed.success) return invalid();
    void send(
      'communications/templates',
      parsed.data,
      t(
        'Template saved as a draft; it needs approval by someone else before use.',
        'حُفظ القالب كمسودة؛ يحتاج اعتماداً من شخص آخر قبل الاستخدام.',
      ),
    );
  }
  function governTemplate(
    template: MessageTemplate,
    action: 'approve_template' | 'retire_template',
  ) {
    const parsed = templateCommandSchema.safeParse({
      action,
      templateKey: template.templateKey,
      expectedVersion: template.version,
    });
    if (!parsed.success) return invalid();
    void send('communications/templates', parsed.data, t('Template updated.', 'تم تحديث القالب.'));
  }
  function compose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const variables: Record<string, string> = {};
    for (const pair of field(form, 'variables').split(/\n+/u)) {
      const [key, ...rest] = pair.split('=');
      if (key?.trim() && rest.length > 0) variables[key.trim()] = rest.join('=').trim();
    }
    const parsed = communicationCommandSchema.safeParse({
      action: 'queue_notification',
      subscriberId: field(form, 'subscriberId'),
      templateKey: field(form, 'templateKey'),
      locale: field(form, 'locale'),
      ...(Object.keys(variables).length > 0 ? { variables } : {}),
      ...(field(form, 'destination') ? { destination: field(form, 'destination') } : {}),
      relatedType: 'manual',
    });
    if (!parsed.success) return invalid();
    void send(
      'communications/commands',
      parsed.data,
      t('Message queued for delivery.', 'أُدرجت الرسالة للإرسال.'),
    );
  }
  function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = communicationCommandSchema.safeParse({
      action: 'record_consent',
      subscriberId: field(form, 'subscriberId'),
      channel: field(form, 'channel'),
      allowed: field(form, 'allowed') === 'yes',
      source: field(form, 'source'),
      ...(field(form, 'note') ? { note: field(form, 'note') } : {}),
    });
    if (!parsed.success) return invalid();
    void send('communications/commands', parsed.data, t('Consent recorded.', 'تم تسجيل الموافقة.'));
  }
  function cancel(message: NotificationRecord) {
    const parsed = communicationCommandSchema.safeParse({
      action: 'cancel_notification',
      notificationId: message.id,
      expectedVersion: message.version,
    });
    if (!parsed.success) return invalid();
    void send('communications/commands', parsed.data, t('Message cancelled.', 'أُلغيت الرسالة.'));
  }
  function deliver() {
    const parsed = deliverNotificationsSchema.safeParse({ limit: 25 });
    if (!parsed.success) return;
    void send(
      'communications/deliver',
      parsed.data,
      t('Delivery pass finished:', 'انتهت دورة الإرسال:'),
    );
  }
  if (!session)
    return (
      <section className="cm-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <h1>{t('Communications', 'التواصل')}</h1>
        <p>
          {t(
            'Sign in to manage templates, consent and the notification outbox.',
            'سجّل الدخول لإدارة القوالب والموافقات وصندوق الإشعارات.',
          )}
        </p>
      </section>
    );
  const summary = data?.summary;
  const approved = data?.templates.filter((x) => x.status === 'approved') ?? [];
  const subscribers =
    data?.subscribers.filter((s) =>
      (s.name + ' ' + s.subscriberNumber).toLowerCase().includes(subscriberSearch.toLowerCase()),
    ) ?? [];
  return (
    <section className="cm-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-busy={busy}>
      <header className="cm-hero">
        <div>
          <span>{t('COMMUNICATIONS', 'التواصل')}</span>
          <h1>
            {t(
              'Approved words, consented channels, evidenced delivery.',
              'كلمات معتمدة وقنوات بموافقة وإرسال موثق.',
            )}
          </h1>
          <p>
            {t(
              'Every customer message comes from a bilingual template approved by someone other than its author, respects the subscriber’s consent per channel, and keeps the provider reference or the error of each delivery attempt.',
              'كل رسالة للعميل تأتي من قالب ثنائي اللغة يعتمده شخص غير مؤلفه، وتحترم موافقة المشترك لكل قناة، وتحتفظ بمرجع المزود أو خطأ كل محاولة إرسال.',
            )}
          </p>
        </div>
        {summary && (
          <dl className="cm-stats" aria-label={t('Outbox summary', 'ملخص الصندوق')}>
            <div className={summary.queued > 0 ? 'is-alert' : ''}>
              <dt>{t('Queued', 'في الانتظار')}</dt>
              <dd>{summary.queued}</dd>
            </div>
            <div>
              <dt>{t('Sent (24 h)', 'أُرسلت (٢٤ س)')}</dt>
              <dd>{summary.sentToday}</dd>
            </div>
            <div className={summary.failed > 0 ? 'is-alert' : ''}>
              <dt>{t('Failed', 'فشلت')}</dt>
              <dd>{summary.failed}</dd>
            </div>
            <div>
              <dt>{t('Suppressed', 'مكبوتة')}</dt>
              <dd>{summary.suppressed}</dd>
            </div>
            <div>
              <dt>{t('Approved templates', 'قوالب معتمدة')}</dt>
              <dd>{summary.approvedTemplates}</dd>
            </div>
          </dl>
        )}
      </header>
      {data && (
        <p className="cm-note">
          {t('Providers:', 'المزودون:')}{' '}
          {data.providers
            .map(
              (p) =>
                `${channelName(p.channel)} ${p.configured ? t('configured', 'مهيأ') : t('not configured', 'غير مهيأ')}`,
            )
            .join(' · ')}
          {' — '}
          {t(
            'configure providers under Configuration → Integrations.',
            'هيّئ المزودين من الإعدادات ← التكاملات.',
          )}
        </p>
      )}
      <nav className="cm-tabs" aria-label={t('Communication views', 'عروض التواصل')}>
        {(
          [
            ['outbox', t('Outbox', 'صندوق الإشعارات')],
            ['templates', t('Templates', 'القوالب')],
            ['consent', t('Consent', 'الموافقات')],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            aria-current={view === key ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setView(key);
              setError('');
              setNotice('');
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="cm-panel cm-panel--positive" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="cm-panel cm-panel--negative" role="alert">
          {error}
        </p>
      )}
      {state === 'loading' && (
        <p role="status">{t('Loading communications…', 'جارٍ تحميل التواصل…')}</p>
      )}
      {state === 'error' && (
        <div className="cm-panel cm-panel--negative" role="alert">
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

      {state === 'ready' && data && view === 'outbox' && (
        <section className="cm-card">
          <div className="cm-card__header">
            <h2>{t('Notification outbox', 'صندوق الإشعارات')}</h2>
            <div className="cm-actions">
              <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
                {t('Refresh', 'تحديث')}
              </button>
              <button type="button" disabled={busy} onClick={deliver}>
                {t('Send queued now', 'إرسال المنتظر الآن')}
              </button>
              <button
                type="button"
                className="cm-primary"
                disabled={busy || approved.length === 0}
                onClick={() => setComposing((v) => !v)}
              >
                {composing ? t('Close', 'إغلاق') : t('Queue a message', 'إدراج رسالة')}
              </button>
            </div>
          </div>
          <p className="cm-note">
            {t(
              '"Send queued now" needs secret-management authority: it reads the configured provider credentials, sends each due message and records the outcome. Failed messages retry with a growing delay and park after five attempts.',
              'يتطلب "إرسال المنتظر الآن" صلاحية إدارة الأسرار: يقرأ بيانات اعتماد المزود المهيأ ويرسل كل رسالة مستحقة ويسجل النتيجة. تُعاد محاولة الرسائل الفاشلة بتأخير متزايد وتتوقف بعد خمس محاولات.',
            )}
          </p>
          {composing && (
            <form className="cm-form" onSubmit={compose}>
              <h3>{t('Queue a message from an approved template', 'إدراج رسالة من قالب معتمد')}</h3>
              <div className="cm-grid">
                <label className="cm-field">
                  <span>{t('Find subscriber', 'البحث عن مشترك')}</span>
                  <input
                    type="search"
                    value={subscriberSearch}
                    onChange={(e) => setSubscriberSearch(e.target.value)}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Subscriber', 'المشترك')}</span>
                  <select name="subscriberId" required defaultValue="">
                    <option value="">{t('Choose a subscriber', 'اختر مشتركاً')}</option>
                    {subscribers.slice(0, 200).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.subscriberNumber} · {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Template', 'القالب')}</span>
                  <select name="templateKey" required defaultValue="">
                    <option value="">
                      {t('Choose an approved template', 'اختر قالباً معتمداً')}
                    </option>
                    {approved.map((x) => (
                      <option key={x.id} value={x.templateKey}>
                        {locale === 'ar' ? x.nameAr : x.nameEn} · {channelName(x.channel)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Language', 'اللغة')}</span>
                  <select name="locale" defaultValue={locale}>
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Destination override (optional)', 'وجهة بديلة (اختياري)')}</span>
                  <input name="destination" dir="ltr" />
                </label>
                <label className="cm-field cm-field--wide">
                  <span>
                    {t('Variables, one per line as key=value', 'المتغيرات، سطر لكل key=value')}
                  </span>
                  <textarea
                    name="variables"
                    dir="ltr"
                    placeholder={'area=Hamra\nticket=TCK-20260909-A1B2C3'}
                  />
                </label>
              </div>
              <button type="submit" className="cm-primary" disabled={busy}>
                {busy ? t('Queueing…', 'جارٍ الإدراج…') : t('Queue message', 'إدراج الرسالة')}
              </button>
            </form>
          )}
          {data.notifications.length === 0 ? (
            <p className="cm-note">{t('No messages yet.', 'لا رسائل بعد.')}</p>
          ) : (
            <ul className="cm-list">
              {data.notifications.map((m) => (
                <li key={m.id} className={'cm-message status-' + m.status}>
                  <div className="cm-row-meta">
                    <span>
                      {channelName(m.channel)} · {messageStatus(m.status)}
                      {m.suppressionReason ? ` (${suppression(m.suppressionReason)})` : ''}
                    </span>
                    <span>{date(m.createdAt)}</span>
                  </div>
                  <strong>
                    {m.subscriberName} · {m.destinationMasked ?? t('no destination', 'لا وجهة')} ·{' '}
                    {m.templateKey}
                  </strong>
                  <p>{m.body}</p>
                  <small>
                    {m.attempts} {t('attempts', 'محاولات')}
                    {m.providerReference
                      ? ` · ${t('provider ref', 'مرجع المزود')} ${m.providerReference}`
                      : ''}
                    {m.lastError ? ` · ${m.lastError}` : ''}
                    {m.sentAt ? ` · ${t('sent', 'أُرسلت')} ${date(m.sentAt)}` : ''}
                    {` · ${t('by', 'بواسطة')} ${m.requestedBy}`}
                  </small>
                  {m.status === 'queued' && (
                    <div className="cm-actions">
                      <button type="button" disabled={busy} onClick={() => cancel(m)}>
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'templates' && (
        <section className="cm-card">
          <div className="cm-card__header">
            <h2>{t('Message templates', 'قوالب الرسائل')}</h2>
            <button
              type="button"
              className="cm-primary"
              disabled={busy}
              onClick={() => setEditing(editing ? undefined : 'new')}
            >
              {editing ? t('Close', 'إغلاق') : t('New template', 'قالب جديد')}
            </button>
          </div>
          {editing && (
            <form
              className="cm-form"
              onSubmit={submitTemplate}
              key={editing === 'new' ? 'new' : editing.id}
            >
              <h3>
                {editing === 'new'
                  ? t('New template', 'قالب جديد')
                  : t('Edit template', 'تعديل القالب')}
              </h3>
              <div className="cm-grid">
                <label className="cm-field">
                  <span>{t('Template key', 'مفتاح القالب')}</span>
                  <input
                    name="templateKey"
                    required
                    dir="ltr"
                    placeholder="outage.notice"
                    defaultValue={editing === 'new' ? '' : editing.templateKey}
                    readOnly={editing !== 'new'}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Channel', 'القناة')}</span>
                  <select name="channel" defaultValue={editing === 'new' ? 'sms' : editing.channel}>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">{t('Email', 'بريد إلكتروني')}</option>
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Name in English', 'الاسم بالإنجليزية')}</span>
                  <input
                    name="nameEn"
                    required
                    lang="en"
                    dir="ltr"
                    defaultValue={editing === 'new' ? '' : editing.nameEn}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Name in Arabic', 'الاسم بالعربية')}</span>
                  <input
                    name="nameAr"
                    required
                    lang="ar"
                    dir="rtl"
                    defaultValue={editing === 'new' ? '' : editing.nameAr}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Email subject in English', 'موضوع البريد بالإنجليزية')}</span>
                  <input
                    name="subjectEn"
                    lang="en"
                    dir="ltr"
                    defaultValue={editing === 'new' ? '' : (editing.subjectEn ?? '')}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Email subject in Arabic', 'موضوع البريد بالعربية')}</span>
                  <input
                    name="subjectAr"
                    lang="ar"
                    dir="rtl"
                    defaultValue={editing === 'new' ? '' : (editing.subjectAr ?? '')}
                  />
                </label>
                <label className="cm-field cm-field--wide">
                  <span>{t('Body in English', 'النص بالإنجليزية')}</span>
                  <textarea
                    name="bodyEn"
                    required
                    lang="en"
                    dir="ltr"
                    defaultValue={editing === 'new' ? '' : editing.bodyEn}
                  />
                </label>
                <label className="cm-field cm-field--wide">
                  <span>{t('Body in Arabic', 'النص بالعربية')}</span>
                  <textarea
                    name="bodyAr"
                    required
                    lang="ar"
                    dir="rtl"
                    defaultValue={editing === 'new' ? '' : editing.bodyAr}
                  />
                </label>
              </div>
              <p className="cm-note">
                {t(
                  'Placeholders look like {{subscriberName}}; {{subscriberName}} and {{subscriberNumber}} are always available. Saving returns the template to draft until a different administrator approves it.',
                  'تكون العناصر النائبة بالشكل {{subscriberName}}؛ ويتوفر {{subscriberName}} و{{subscriberNumber}} دائماً. الحفظ يعيد القالب إلى مسودة حتى يعتمده مدير آخر.',
                )}
              </p>
              <button type="submit" className="cm-primary" disabled={busy}>
                {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save template', 'حفظ القالب')}
              </button>
            </form>
          )}
          {data.templates.length === 0 ? (
            <p className="cm-note">{t('No templates yet.', 'لا قوالب بعد.')}</p>
          ) : (
            <ul className="cm-list">
              {data.templates.map((x) => (
                <li key={x.id} className={'cm-message status-' + x.status}>
                  <div className="cm-row-meta">
                    <span>
                      {channelName(x.channel)} · {templateStatus(x.status)}
                    </span>
                    <span>
                      {t('Version', 'الإصدار')} {x.version}
                      {x.approvedBy ? ` · ${t('approved by', 'اعتمده')} ${x.approvedBy}` : ''}
                    </span>
                  </div>
                  <strong>
                    {locale === 'ar' ? x.nameAr : x.nameEn} · <code>{x.templateKey}</code>
                  </strong>
                  <p dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                    {locale === 'ar' ? x.bodyAr : x.bodyEn}
                  </p>
                  <div className="cm-actions">
                    {x.status !== 'retired' && (
                      <button type="button" disabled={busy} onClick={() => setEditing(x)}>
                        {t('Edit', 'تعديل')}
                      </button>
                    )}
                    {x.status === 'draft' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => governTemplate(x, 'approve_template')}
                      >
                        {t('Approve', 'اعتماد')}
                      </button>
                    )}
                    {x.status !== 'retired' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => governTemplate(x, 'retire_template')}
                      >
                        {t('Retire', 'إيقاف')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {state === 'ready' && data && view === 'consent' && (
        <section className="cm-card">
          <div className="cm-card__header">
            <h2>{t('Channel consent', 'موافقة القنوات')}</h2>
            <button
              type="button"
              className="cm-primary"
              disabled={busy}
              onClick={() => setConsenting((v) => !v)}
            >
              {consenting ? t('Close', 'إغلاق') : t('Record consent', 'تسجيل موافقة')}
            </button>
          </div>
          {consenting && (
            <form className="cm-form" onSubmit={recordConsent}>
              <div className="cm-grid">
                <label className="cm-field">
                  <span>{t('Find subscriber', 'البحث عن مشترك')}</span>
                  <input
                    type="search"
                    value={subscriberSearch}
                    onChange={(e) => setSubscriberSearch(e.target.value)}
                  />
                </label>
                <label className="cm-field">
                  <span>{t('Subscriber', 'المشترك')}</span>
                  <select name="subscriberId" required defaultValue="">
                    <option value="">{t('Choose a subscriber', 'اختر مشتركاً')}</option>
                    {subscribers.slice(0, 200).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.subscriberNumber} · {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Channel', 'القناة')}</span>
                  <select name="channel" defaultValue="sms">
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">{t('Email', 'بريد إلكتروني')}</option>
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Decision', 'القرار')}</span>
                  <select name="allowed" defaultValue="yes">
                    <option value="yes">{t('Allowed', 'مسموح')}</option>
                    <option value="no">{t('Withdrawn', 'مسحوب')}</option>
                  </select>
                </label>
                <label className="cm-field">
                  <span>{t('Source', 'المصدر')}</span>
                  <select name="source" defaultValue="customer_request">
                    <option value="customer_request">{t('Customer request', 'طلب العميل')}</option>
                    <option value="contract">{t('Contract', 'العقد')}</option>
                    <option value="regulatory">{t('Regulatory', 'تنظيمي')}</option>
                    <option value="staff">{t('Staff decision', 'قرار الموظف')}</option>
                  </select>
                </label>
                <label className="cm-field cm-field--wide">
                  <span>{t('Note (optional)', 'ملاحظة (اختياري)')}</span>
                  <input name="note" maxLength={1000} />
                </label>
              </div>
              <button type="submit" className="cm-primary" disabled={busy}>
                {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Record', 'تسجيل')}
              </button>
            </form>
          )}
          {data.consents.length === 0 ? (
            <p className="cm-note">
              {t(
                'No consent decisions recorded. Without a decision a channel is allowed for service messages.',
                'لا قرارات موافقة مسجلة. دون قرار تكون القناة مسموحة لرسائل الخدمة.',
              )}
            </p>
          ) : (
            <ul className="cm-list">
              {data.consents.map((c) => (
                <li
                  key={c.id}
                  className={'cm-message ' + (c.allowed ? 'status-sent' : 'status-failed')}
                >
                  <div className="cm-row-meta">
                    <span>
                      {channelName(c.channel)} ·{' '}
                      {c.allowed ? t('Allowed', 'مسموح') : t('Withdrawn', 'مسحوب')}
                    </span>
                    <span>{date(c.recordedAt)}</span>
                  </div>
                  <strong>{c.subscriberName}</strong>
                  <small>
                    {c.source} · {c.recordedBy}
                    {c.note ? ` · ${c.note}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
