import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, StatePanel, StatusBadge } from './components';
import type { Locale } from './types';

/**
 * Provider settings editor shared by the Control Center (platform SMTP) and tenant workspaces
 * (tenant SMTP, SMS, WhatsApp). Secrets are write-only: the form never receives a stored value,
 * and a configured credential can be kept, replaced or cleared explicitly.
 */
export type IntegrationKindView = 'smtp' | 'sms' | 'whatsapp';

export interface IntegrationSettingView {
  readonly kind: IntegrationKindView;
  readonly version: number;
  readonly active: boolean;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secretConfigured: boolean;
  readonly protectedFields: readonly string[];
  readonly updatedBy: string;
  readonly updatedAt: string;
  readonly lastTestAt?: string | null;
  readonly lastTestStatus?: 'passed' | 'failed' | null;
  readonly lastTestMessage?: string | null;
}

export interface IntegrationEventView {
  readonly id: string;
  readonly kind: IntegrationKindView;
  readonly version: number;
  readonly action: 'configure' | 'test';
  readonly actorId: string;
  readonly reason: string;
  readonly reasonAr?: string;
  readonly secretChanged: boolean;
  readonly testStatus?: 'passed' | 'failed' | null;
  readonly testMessage?: string | null;
  readonly occurredAt: string;
}

export interface IntegrationDeliveryView {
  readonly id: string;
  readonly purpose: string;
  readonly channel: IntegrationKindView;
  readonly recipient: string;
  readonly status: 'sent' | 'failed';
  readonly providerReference?: string | null;
  readonly errorCode?: string | null;
  readonly occurredAt: string;
}

export type IntegrationEvidence =
  | { readonly reason: string }
  | { readonly reasonEn: string; readonly reasonAr: string; readonly evidence: string };

export interface IntegrationSaveInput {
  readonly kind: IntegrationKindView;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly keepSecrets: boolean;
  readonly active: boolean;
  readonly expectedVersion?: number;
  readonly evidence: IntegrationEvidence;
}

export interface IntegrationTestInput {
  readonly kind: IntegrationKindView;
  readonly recipient: string;
  readonly evidence: IntegrationEvidence;
}

export interface IntegrationSettingsPanelProps {
  readonly locale: Locale;
  readonly scope: 'platform' | 'tenant';
  readonly state: 'loading' | 'ready' | 'error' | 'denied';
  readonly settings: readonly IntegrationSettingView[];
  readonly events: readonly IntegrationEventView[];
  readonly deliveries?: readonly IntegrationDeliveryView[];
  readonly kinds?: readonly IntegrationKindView[];
  readonly evidenceMode: 'reason' | 'bilingual';
  readonly busy: boolean;
  readonly message?: { readonly tone: 'positive' | 'negative' | 'neutral'; readonly text: string };
  readonly onSave: (input: IntegrationSaveInput) => void;
  readonly onTest: (input: IntegrationTestInput) => void;
  readonly onRetry?: () => void;
}

type Translate = (en: string, ar: string) => string;

interface FieldDefinition {
  readonly name: string;
  readonly label: readonly [string, string];
  readonly kind?: 'text' | 'number' | 'email' | 'select' | 'password';
  readonly required?: boolean;
  readonly options?: readonly (readonly [string, string, string])[];
  readonly placeholder?: string;
  readonly hint?: readonly [string, string];
  readonly secret?: boolean;
}

const smtpFields: readonly FieldDefinition[] = [
  {
    name: 'host',
    label: ['SMTP host', 'خادم SMTP'],
    required: true,
    placeholder: 'smtp.example.com',
  },
  { name: 'port', label: ['Port', 'المنفذ'], kind: 'number', required: true, placeholder: '587' },
  {
    name: 'security',
    label: ['Connection security', 'أمان الاتصال'],
    kind: 'select',
    required: true,
    options: [
      ['starttls', 'STARTTLS (port 587)', 'STARTTLS (المنفذ 587)'],
      ['tls', 'Implicit TLS (port 465)', 'TLS مباشر (المنفذ 465)'],
      ['none', 'None (internal relay only)', 'بدون (مرحّل داخلي فقط)'],
    ],
  },
  { name: 'username', label: ['Username', 'اسم المستخدم'], placeholder: 'mailer@example.com' },
  {
    name: 'password',
    label: ['Password', 'كلمة المرور'],
    kind: 'password',
    secret: true,
    hint: ['Stored encrypted; never shown again.', 'تُخزَّن مشفّرة ولا تُعرض مجدداً.'],
  },
  { name: 'fromAddress', label: ['From address', 'عنوان المرسل'], kind: 'email', required: true },
  { name: 'fromName', label: ['From name', 'اسم المرسل'], placeholder: 'Orvex ISP' },
  { name: 'replyTo', label: ['Reply-to address', 'عنوان الرد'], kind: 'email' },
  {
    name: 'timeoutMs',
    label: ['Timeout (ms)', 'المهلة (مللي ثانية)'],
    kind: 'number',
    placeholder: '15000',
  },
];

const smsProviderFields: Readonly<Record<string, readonly FieldDefinition[]>> = {
  twilio: [
    {
      name: 'accountSid',
      label: ['Twilio account SID', 'معرّف حساب Twilio'],
      required: true,
      placeholder: 'AC…',
    },
    {
      name: 'fromNumber',
      label: ['Sender number (+country…)', 'رقم المرسل (+رمز الدولة…)'],
      required: true,
      placeholder: '+9617…',
    },
    {
      name: 'authToken',
      label: ['Auth token', 'رمز المصادقة'],
      kind: 'password',
      secret: true,
      required: true,
    },
  ],
  http_json: [
    {
      name: 'endpointUrl',
      label: ['HTTPS endpoint', 'عنوان HTTPS'],
      required: true,
      placeholder: 'https://gateway.example.com/send',
    },
    { name: 'senderId', label: ['Sender ID', 'معرّف المرسل'] },
    {
      name: 'authToken',
      label: ['Bearer token', 'رمز Bearer'],
      kind: 'password',
      secret: true,
      required: true,
    },
  ],
};

const whatsappProviderFields: Readonly<Record<string, readonly FieldDefinition[]>> = {
  twilio: [
    {
      name: 'accountSid',
      label: ['Twilio account SID', 'معرّف حساب Twilio'],
      required: true,
      placeholder: 'AC…',
    },
    {
      name: 'fromNumber',
      label: ['WhatsApp sender (+country…)', 'رقم واتساب المرسل (+رمز الدولة…)'],
      required: true,
      placeholder: '+9617…',
    },
    {
      name: 'authToken',
      label: ['Auth token', 'رمز المصادقة'],
      kind: 'password',
      secret: true,
      required: true,
    },
  ],
  meta_cloud: [
    { name: 'phoneNumberId', label: ['Phone number ID', 'معرّف رقم الهاتف'], required: true },
    { name: 'apiVersion', label: ['Graph API version', 'إصدار Graph API'], placeholder: 'v20.0' },
    {
      name: 'authToken',
      label: ['Access token', 'رمز الوصول'],
      kind: 'password',
      secret: true,
      required: true,
    },
  ],
};

const providerOptions: Readonly<
  Record<'sms' | 'whatsapp', readonly (readonly [string, string, string])[]>
> = {
  sms: [
    ['twilio', 'Twilio', 'Twilio'],
    ['http_json', 'Generic HTTPS JSON gateway', 'بوابة HTTPS JSON عامة'],
  ],
  whatsapp: [
    ['twilio', 'Twilio WhatsApp', 'Twilio واتساب'],
    ['meta_cloud', 'Meta WhatsApp Cloud API', 'Meta WhatsApp Cloud API'],
  ],
};

export function IntegrationSettingsPanel({
  locale,
  scope,
  state,
  settings,
  events,
  deliveries,
  kinds = ['smtp', 'sms', 'whatsapp'],
  evidenceMode,
  busy,
  message,
  onSave,
  onTest,
  onRetry,
}: IntegrationSettingsPanelProps) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  const rtl = locale === 'ar';
  const [kind, setKind] = useState<IntegrationKindView>(kinds[0] ?? 'smtp');
  const current = settings.find((setting) => setting.kind === kind);
  const [provider, setProvider] = useState<string>('twilio');
  useEffect(() => {
    const configured = current?.config.provider;
    setProvider(typeof configured === 'string' ? configured : 'twilio');
  }, [current, kind]);

  const kindLabel = (value: IntegrationKindView) =>
    ({
      smtp: t('Email (SMTP)', 'البريد (SMTP)'),
      sms: t('SMS', 'الرسائل النصية'),
      whatsapp: t('WhatsApp', 'واتساب'),
    })[value];
  const fields = useMemo<readonly FieldDefinition[]>(() => {
    if (kind === 'smtp') return smtpFields;
    const table = kind === 'sms' ? smsProviderFields : whatsappProviderFields;
    return table[provider] ?? [];
  }, [kind, provider]);
  const formatTime = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString(locale === 'ar' ? 'ar-LB' : 'en-LB') : '—';

  const readEvidence = (form: FormData): IntegrationEvidence =>
    evidenceMode === 'reason'
      ? { reason: text(form, 'reason') }
      : {
          reasonEn: text(form, 'reasonEn'),
          reasonAr: text(form, 'reasonAr'),
          evidence: text(form, 'evidence'),
        };

  const submitSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const config: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    if (kind !== 'smtp') config.provider = provider;
    for (const field of fields) {
      const raw = text(form, field.name);
      if (field.secret) {
        if (raw) secrets[field.name] = raw;
        continue;
      }
      if (!raw) continue;
      config[field.name] = field.kind === 'number' ? Number(raw) : raw;
    }
    const keepSecrets = form.get('keepSecrets') === 'on' && Boolean(current?.secretConfigured);
    onSave({
      kind,
      config,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
      keepSecrets: Object.keys(secrets).length > 0 ? false : keepSecrets,
      active: form.get('active') !== null,
      ...(current ? { expectedVersion: current.version } : {}),
      evidence: readEvidence(form),
    });
  };

  const submitTest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onTest({ kind, recipient: text(form, 'recipient'), evidence: readEvidence(form) });
  };

  if (state === 'loading' || state === 'error' || state === 'denied') {
    return (
      <StatePanel
        variant={state}
        title={
          state === 'loading'
            ? t('Loading integration settings', 'جارٍ تحميل إعدادات التكامل')
            : state === 'denied'
              ? t('Integration settings are outside your scope', 'إعدادات التكامل خارج نطاقك')
              : t('Integration settings could not be loaded', 'تعذّر تحميل إعدادات التكامل')
        }
        description={
          state === 'loading'
            ? t(
                'Stored provider settings are being read without their secrets.',
                'تُقرأ إعدادات المزوّدين المخزنة دون أسرارها.',
              )
            : state === 'denied'
              ? t(
                  'Ask an administrator with secret management permission.',
                  'اطلب مديراً يملك صلاحية إدارة الأسرار.',
                )
              : t(
                  'No change was made. Retry the read safely.',
                  'لم يُجرَ أي تغيير. أعد المحاولة بأمان.',
                )
        }
        actionLabel={state === 'error' && onRetry ? t('Retry', 'إعادة المحاولة') : undefined}
        onAction={onRetry}
      />
    );
  }

  return (
    <section className="integration-panel" dir={rtl ? 'rtl' : 'ltr'}>
      <header className="integration-panel__hero">
        <div>
          <span>
            {scope === 'platform'
              ? t('Platform integrations', 'تكاملات المنصة')
              : t('Workspace integrations', 'تكاملات مساحة العمل')}
          </span>
          <h1>
            {scope === 'platform'
              ? t(
                  'Delivery providers for sign-in codes, recovery and invitations',
                  'مزوّدو التسليم لرموز الدخول والاسترداد والدعوات',
                )
              : t(
                  'Providers for customer email, SMS and WhatsApp',
                  'مزوّدو البريد والرسائل النصية وواتساب للعملاء',
                )}
          </h1>
          <p>
            {t(
              'Non-secret settings are versioned and audited. Credentials are stored encrypted, never displayed, and can be replaced or cleared at any time.',
              'تُحفظ الإعدادات غير السرية بنسخ مؤرخة ومدققة. تُخزَّن بيانات الاعتماد مشفّرة ولا تُعرض أبداً ويمكن استبدالها أو مسحها في أي وقت.',
            )}
          </p>
        </div>
      </header>

      <nav className="integration-panel__tabs" aria-label={t('Integration kinds', 'أنواع التكامل')}>
        {kinds.map((item) => {
          const setting = settings.find((entry) => entry.kind === item);
          return (
            <button
              key={item}
              type="button"
              aria-current={kind === item ? 'page' : undefined}
              onClick={() => setKind(item)}
            >
              {kindLabel(item)}
              <StatusBadge tone={setting ? (setting.active ? 'positive' : 'neutral') : 'neutral'}>
                {setting
                  ? setting.active
                    ? t('Configured', 'مُهيّأ')
                    : t('Inactive', 'غير فعّال')
                  : t('Not configured', 'غير مُهيّأ')}
              </StatusBadge>
            </button>
          );
        })}
      </nav>

      {message ? (
        <p
          className={`integration-panel__message integration-panel__message--${message.tone}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <div className="integration-panel__grid">
        <form className="integration-panel__card" onSubmit={submitSettings} aria-busy={busy}>
          <h2>
            {t('Settings', 'الإعدادات')} · {kindLabel(kind)}
          </h2>
          <dl className="integration-panel__facts">
            <div>
              <dt>{t('Version', 'النسخة')}</dt>
              <dd>{current ? `v${current.version}` : '—'}</dd>
            </div>
            <div>
              <dt>{t('Credential', 'بيانات الاعتماد')}</dt>
              <dd>
                {current?.secretConfigured
                  ? `${t('Stored', 'مخزنة')} (${current.protectedFields.join(', ')})`
                  : t('None stored', 'لا شيء مخزن')}
              </dd>
            </div>
            <div>
              <dt>{t('Last test', 'آخر اختبار')}</dt>
              <dd>
                {current?.lastTestStatus ? (
                  <>
                    <StatusBadge
                      tone={current.lastTestStatus === 'passed' ? 'positive' : 'negative'}
                    >
                      {current.lastTestStatus === 'passed'
                        ? t('Passed', 'ناجح')
                        : t('Failed', 'فاشل')}
                    </StatusBadge>{' '}
                    {formatTime(current.lastTestAt)}
                  </>
                ) : (
                  t('Not tested yet', 'لم يُختبر بعد')
                )}
              </dd>
            </div>
          </dl>
          {current?.lastTestMessage ? (
            <p className="integration-panel__note" dir="auto">
              {current.lastTestMessage}
            </p>
          ) : null}
          {kind !== 'smtp' ? (
            <label className="integration-field">
              <span>{t('Provider', 'المزوّد')}</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                {providerOptions[kind].map(([value, en, ar]) => (
                  <option key={value} value={value}>
                    {t(en, ar)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="integration-panel__fields">
            {fields.map((field) => (
              <IntegrationField
                key={`${kind}-${provider}-${field.name}-${current?.version ?? 0}`}
                field={field}
                locale={locale}
                value={current?.config[field.name]}
                secretConfigured={Boolean(current?.secretConfigured)}
              />
            ))}
          </div>
          {current?.secretConfigured ? (
            <label className="integration-check">
              <input type="checkbox" name="keepSecrets" defaultChecked />
              <span>
                {t(
                  'Keep the stored credential (leave the secret field empty)',
                  'الاحتفاظ ببيانات الاعتماد المخزنة (اترك حقل السر فارغاً)',
                )}
              </span>
            </label>
          ) : null}
          <label className="integration-check">
            <input type="checkbox" name="active" defaultChecked={current?.active ?? true} />
            <span>
              {t('Active — use this provider for deliveries', 'فعّال — استخدم هذا المزوّد للإرسال')}
            </span>
          </label>
          <EvidenceFields locale={locale} mode={evidenceMode} prefix="save" />
          <Button
            type="submit"
            variant="primary"
            isLoading={busy}
            loadingLabel={t('Saving…', 'جارٍ الحفظ…')}
          >
            {current
              ? t('Save new version', 'حفظ نسخة جديدة')
              : t('Save settings', 'حفظ الإعدادات')}
          </Button>
        </form>

        <form className="integration-panel__card" onSubmit={submitTest} aria-busy={busy}>
          <h2>{t('Send a test', 'إرسال اختبار')}</h2>
          <p className="integration-panel__note">
            {kind === 'smtp'
              ? t(
                  'A bilingual test email is sent through the saved settings.',
                  'يُرسل بريد اختبار ثنائي اللغة عبر الإعدادات المحفوظة.',
                )
              : t(
                  'A short bilingual test message is sent to the number below.',
                  'تُرسل رسالة اختبار قصيرة ثنائية اللغة إلى الرقم أدناه.',
                )}
          </p>
          <label className="integration-field">
            <span>
              {kind === 'smtp'
                ? t('Recipient email', 'بريد المستلم')
                : t('Recipient number (+country…)', 'رقم المستلم (+رمز الدولة…)')}
            </span>
            <input name="recipient" type={kind === 'smtp' ? 'email' : 'tel'} required dir="ltr" />
          </label>
          <EvidenceFields locale={locale} mode={evidenceMode} prefix="test" />
          <Button
            type="submit"
            variant="secondary"
            isLoading={busy}
            loadingLabel={t('Sending…', 'جارٍ الإرسال…')}
            disabled={!current}
          >
            {t('Send test', 'إرسال الاختبار')}
          </Button>
        </form>
      </div>

      <section className="integration-panel__card">
        <h2>{t('Change history', 'سجل التغييرات')}</h2>
        {events.length === 0 ? (
          <p className="integration-panel__note">
            {t('No changes recorded yet.', 'لا توجد تغييرات مسجلة بعد.')}
          </p>
        ) : (
          <div className="integration-table" role="table">
            <div role="row" className="integration-table__head">
              <span role="columnheader">{t('When', 'الوقت')}</span>
              <span role="columnheader">{t('Kind', 'النوع')}</span>
              <span role="columnheader">{t('Action', 'الإجراء')}</span>
              <span role="columnheader">{t('Reason', 'السبب')}</span>
              <span role="columnheader">{t('Outcome', 'النتيجة')}</span>
            </div>
            {events.map((event) => (
              <div role="row" key={event.id}>
                <span role="cell">{formatTime(event.occurredAt)}</span>
                <span role="cell">
                  {kindLabel(event.kind)} v{event.version}
                </span>
                <span role="cell">
                  {event.action === 'configure'
                    ? event.secretChanged
                      ? t('Configured (credential changed)', 'تهيئة (تغيّرت بيانات الاعتماد)')
                      : t('Configured', 'تهيئة')
                    : t('Test', 'اختبار')}
                </span>
                <span role="cell" dir="auto">
                  {locale === 'ar' && event.reasonAr ? event.reasonAr : event.reason}
                </span>
                <span role="cell" dir="auto">
                  {event.testStatus
                    ? `${event.testStatus === 'passed' ? t('Passed', 'ناجح') : t('Failed', 'فاشل')}${event.testMessage ? ` · ${event.testMessage}` : ''}`
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {deliveries ? (
        <section className="integration-panel__card">
          <h2>{t('Recent deliveries', 'آخر عمليات الإرسال')}</h2>
          {deliveries.length === 0 ? (
            <p className="integration-panel__note">
              {t('No deliveries recorded yet.', 'لا توجد عمليات إرسال مسجلة بعد.')}
            </p>
          ) : (
            <div className="integration-table" role="table">
              <div role="row" className="integration-table__head">
                <span role="columnheader">{t('When', 'الوقت')}</span>
                <span role="columnheader">{t('Purpose', 'الغرض')}</span>
                <span role="columnheader">{t('Recipient', 'المستلم')}</span>
                <span role="columnheader">{t('Status', 'الحالة')}</span>
                <span role="columnheader">{t('Reference', 'المرجع')}</span>
              </div>
              {deliveries.map((delivery) => (
                <div role="row" key={delivery.id}>
                  <span role="cell">{formatTime(delivery.occurredAt)}</span>
                  <span role="cell">{delivery.purpose.replaceAll('_', ' ')}</span>
                  <span role="cell" dir="ltr">
                    {delivery.recipient}
                  </span>
                  <span role="cell">
                    <StatusBadge tone={delivery.status === 'sent' ? 'positive' : 'negative'}>
                      {delivery.status === 'sent' ? t('Sent', 'أُرسل') : t('Failed', 'فشل')}
                    </StatusBadge>
                  </span>
                  <span role="cell" dir="ltr">
                    {delivery.providerReference ?? delivery.errorCode ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}

function IntegrationField({
  field,
  locale,
  value,
  secretConfigured,
}: {
  readonly field: FieldDefinition;
  readonly locale: Locale;
  readonly value: unknown;
  readonly secretConfigured: boolean;
}) {
  const label = field.label[locale === 'ar' ? 1 : 0];
  const defaultValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return (
    <div className="integration-field">
      <label>
        <span>{label}</span>
        {field.kind === 'select' ? (
          <select
            name={field.name}
            required={field.required}
            defaultValue={defaultValue || field.options?.[0]?.[0]}
          >
            {field.options?.map(([option, en, ar]) => (
              <option key={option} value={option}>
                {locale === 'ar' ? ar : en}
              </option>
            ))}
          </select>
        ) : (
          <input
            name={field.name}
            type={
              field.kind === 'password'
                ? 'password'
                : field.kind === 'number'
                  ? 'number'
                  : field.kind === 'email'
                    ? 'email'
                    : 'text'
            }
            required={field.secret ? field.required && !secretConfigured : field.required}
            defaultValue={field.secret ? '' : defaultValue}
            placeholder={field.secret && secretConfigured ? '••••••••' : field.placeholder}
            autoComplete={field.secret ? 'new-password' : 'off'}
            dir="ltr"
            inputMode={field.kind === 'number' ? 'numeric' : undefined}
          />
        )}
      </label>
      {field.hint ? <small>{field.hint[locale === 'ar' ? 1 : 0]}</small> : null}
    </div>
  );
}

function EvidenceFields({
  locale,
  mode,
  prefix,
}: {
  readonly locale: Locale;
  readonly mode: 'reason' | 'bilingual';
  readonly prefix: string;
}) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  if (mode === 'reason') {
    return (
      <label className="integration-field integration-field--wide">
        <span>{t('Reason (audit)', 'السبب (للتدقيق)')}</span>
        <input name="reason" required minLength={8} maxLength={500} id={`${prefix}-reason`} />
      </label>
    );
  }
  return (
    <div className="integration-panel__fields">
      <label className="integration-field">
        <span>{t('Reason (English)', 'السبب (بالإنجليزية)')}</span>
        <input
          name="reasonEn"
          required
          minLength={8}
          maxLength={1000}
          id={`${prefix}-reason-en`}
          dir="ltr"
        />
      </label>
      <label className="integration-field">
        <span>{t('Reason (Arabic)', 'السبب (بالعربية)')}</span>
        <input
          name="reasonAr"
          required
          minLength={8}
          maxLength={1000}
          id={`${prefix}-reason-ar`}
          dir="rtl"
        />
      </label>
      <label className="integration-field integration-field--wide">
        <span>{t('Evidence reference', 'مرجع الدليل')}</span>
        <input name="evidence" required minLength={8} maxLength={2000} id={`${prefix}-evidence`} />
      </label>
    </div>
  );
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
