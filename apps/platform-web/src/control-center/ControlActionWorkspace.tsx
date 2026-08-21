import { useEffect, useState, type FormEvent } from 'react';
import type { ApiSession } from '@isp/ui';
import { submitControlAction } from '../api';
import './control-center.css';

export type ControlActionTask = 'package' | 'assignment' | 'transition' | 'invoice' | 'payment';

interface Field {
  readonly name: string;
  readonly label: readonly [string, string];
  readonly type?: 'text' | 'number' | 'datetime-local' | 'select' | 'textarea';
  readonly options?: readonly string[];
  readonly required?: boolean;
}

const fields: Readonly<Record<ControlActionTask, readonly Field[]>> = {
  package: [
    { name: 'packageKey', label: ['Package key', 'رمز الباقة'], required: true },
    { name: 'version', label: ['Version', 'النسخة'], type: 'number', required: true },
    { name: 'nameEn', label: ['English name', 'الاسم بالإنجليزية'], required: true },
    { name: 'nameAr', label: ['Arabic name', 'الاسم بالعربية'], required: true },
    {
      name: 'entitlements',
      label: ['Entitlements (comma separated)', 'الصلاحيات (مفصولة بفواصل)'],
      type: 'textarea',
      required: true,
    },
    {
      name: 'priceMinor',
      label: ['Price in minor units', 'السعر بالوحدة الصغرى'],
      type: 'number',
      required: true,
    },
    {
      name: 'currency',
      label: ['Currency', 'العملة'],
      type: 'select',
      options: ['USD', 'LBP'],
      required: true,
    },
    {
      name: 'effectiveFrom',
      label: ['Effective from', 'تاريخ السريان'],
      type: 'datetime-local',
      required: true,
    },
    {
      name: 'effectiveUntil',
      label: ['Effective until (optional)', 'نهاية السريان (اختياري)'],
      type: 'datetime-local',
    },
    { name: 'reason', label: ['Business reason', 'سبب الإجراء'], type: 'textarea', required: true },
  ],
  assignment: [
    { name: 'tenantId', label: ['Tenant ID', 'معرّف مساحة العمل'], required: true },
    {
      name: 'packageVersionId',
      label: ['Package version ID', 'معرّف نسخة الباقة'],
      required: true,
    },
    {
      name: 'state',
      label: ['Initial state', 'الحالة الأولية'],
      type: 'select',
      options: ['lead', 'trial', 'active', 'grace', 'restricted'],
      required: true,
    },
    {
      name: 'startsAt',
      label: ['Starts at', 'تاريخ البدء'],
      type: 'datetime-local',
      required: true,
    },
    {
      name: 'expectedRevision',
      label: ['Expected revision (optional)', 'رقم المراجعة المتوقع (اختياري)'],
      type: 'number',
    },
    { name: 'reason', label: ['Business reason', 'سبب الإجراء'], type: 'textarea', required: true },
  ],
  transition: [
    { name: 'tenantId', label: ['Tenant ID', 'معرّف مساحة العمل'], required: true },
    {
      name: 'expectedState',
      label: ['Current state', 'الحالة الحالية'],
      type: 'select',
      options: ['lead', 'trial', 'active', 'grace', 'restricted', 'terminated', 'archived'],
      required: true,
    },
    {
      name: 'toState',
      label: ['Move to state', 'النقل إلى الحالة'],
      type: 'select',
      options: ['trial', 'active', 'grace', 'restricted', 'terminated', 'archived'],
      required: true,
    },
    {
      name: 'expectedRevision',
      label: ['Expected revision', 'رقم المراجعة المتوقع'],
      type: 'number',
      required: true,
    },
    { name: 'reason', label: ['Business reason', 'سبب الإجراء'], type: 'textarea', required: true },
  ],
  invoice: financeFields('Invoice number', 'رقم الفاتورة', true),
  payment: financeFields('Payment number', 'رقم الدفعة', false),
};

function financeFields(numberEn: string, numberAr: string, due: boolean): readonly Field[] {
  return [
    { name: 'tenantId', label: ['Tenant ID', 'معرّف مساحة العمل'], required: true },
    { name: 'number', label: [numberEn, numberAr], required: true },
    {
      name: 'amountMinor',
      label: ['Amount in minor units', 'المبلغ بالوحدة الصغرى'],
      type: 'number',
      required: true,
    },
    {
      name: 'currency',
      label: ['Currency', 'العملة'],
      type: 'select',
      options: ['USD', 'LBP'],
      required: true,
    },
    ...(due
      ? [
          {
            name: 'dueAt',
            label: ['Due at', 'تاريخ الاستحقاق'],
            type: 'datetime-local',
            required: true,
          } as const,
        ]
      : []),
    { name: 'reason', label: ['Business reason', 'سبب الإجراء'], type: 'textarea', required: true },
  ];
}

const taskCopy: Readonly<
  Record<'en' | 'ar', Record<ControlActionTask, readonly [string, string]>>
> = {
  en: {
    package: [
      'Package version',
      'Create an immutable commercial package version with explicit currency and entitlements.',
    ],
    assignment: [
      'Assign subscription',
      'Assign one package version and lifecycle state to an isolated ISP client.',
    ],
    transition: [
      'Transition subscription',
      'Request a guarded lifecycle transition. Restrictive changes may require independent approval.',
    ],
    invoice: [
      'Post platform invoice',
      'Post a currency-explicit client invoice with an immutable business reason.',
    ],
    payment: ['Post platform payment', 'Record a platform payment without mixing USD and LBP.'],
  },
  ar: {
    package: ['نسخة باقة', 'أنشئ نسخة باقة تجارية ثابتة بعملة وصلاحيات صريحة.'],
    assignment: ['تعيين الاشتراك', 'عيّن نسخة باقة وحالة دورة حياة لعميل مزوّد إنترنت معزول.'],
    transition: [
      'تغيير حالة الاشتراك',
      'اطلب تغييراً محمياً في دورة الحياة. قد تتطلب القيود موافقة مستقلة.',
    ],
    invoice: ['ترحيل فاتورة المنصة', 'رحّل فاتورة عميل بعملة صريحة وسبب عمل ثابت.'],
    payment: ['ترحيل دفعة المنصة', 'سجّل دفعة للمنصة دون خلط USD وLBP.'],
  },
};

export function ControlActionWorkspace({
  session,
  locale,
  initialTask,
}: {
  readonly session: ApiSession;
  readonly locale: 'en' | 'ar';
  readonly initialTask: ControlActionTask;
}) {
  const [task, setTask] = useState(initialTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reference, setReference] = useState<string>();
  useEffect(() => setTask(initialTask), [initialTask]);
  useEffect(() => {
    setError(undefined);
    setReference(undefined);
  }, [task]);
  const labels =
    locale === 'en'
      ? {
          eyebrow: 'CONTROLLED ACTION',
          actions: 'Control Center actions',
          save: 'Review & commit',
          saving: 'Committing…',
          success: 'Action committed',
          note: 'Every mutation uses a unique idempotency key and immutable audit evidence.',
        }
      : {
          eyebrow: 'إجراء محكوم',
          actions: 'إجراءات مركز التحكم',
          save: 'مراجعة وتثبيت',
          saving: 'جارٍ التثبيت…',
          success: 'تم تثبيت الإجراء',
          note: 'يستخدم كل إجراء مفتاحاً فريداً لمنع التكرار ودليل تدقيق ثابتاً.',
        };
  const [title, description] = taskCopy[locale][task];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(undefined);
    setReference(undefined);
    try {
      const data = payload(new FormData(form));
      const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';
      delete data.tenantId;
      const target = endpoint(task, tenantId);
      const result = await submitControlAction(
        session,
        target.method,
        target.path,
        data,
        `web-control-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      );
      setReference(findReference(result));
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action failed safely.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cc-action-workspace" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <nav className="cc-action-nav" aria-label={labels.actions}>
        {(Object.keys(taskCopy[locale]) as ControlActionTask[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-current={task === item ? 'page' : undefined}
            onClick={() => setTask(item)}
          >
            {taskCopy[locale][item][0]}
          </button>
        ))}
      </nav>
      <form className="cc-action-panel" onSubmit={(event) => void submit(event)}>
        <header>
          <p className="cc-workspace__eyebrow">{labels.eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <div className="cc-create__grid">
          {fields[task].map((field) => (
            <ActionField key={field.name} field={field} locale={locale} />
          ))}
        </div>
        <div className="cc-action-feedback" role={error ? 'alert' : 'status'}>
          {error ? (
            <span className="cc-create__error">{error}</span>
          ) : reference ? (
            <span className="cc-action-success">
              {labels.success}: <code>{reference}</code>
            </span>
          ) : (
            <span>{labels.note}</span>
          )}
        </div>
        <button className="cc-button cc-button--primary" type="submit" disabled={busy}>
          {busy ? labels.saving : labels.save}
        </button>
      </form>
    </section>
  );
}

function ActionField({ field, locale }: { readonly field: Field; readonly locale: 'en' | 'ar' }) {
  const common = { name: field.name, required: field.required };
  return (
    <label className={field.type === 'textarea' ? 'cc-field cc-field--wide' : 'cc-field'}>
      <span>{field.label[locale === 'en' ? 0 : 1]}</span>
      {field.type === 'select' ? (
        <select {...common}>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={field.type ?? 'text'}
          min={field.type === 'number' ? 0 : undefined}
        />
      )}
    </label>
  );
}

function payload(form: FormData): Record<string, unknown> {
  const value = Object.fromEntries(
    [...form.entries()].filter(([, item]) => typeof item === 'string' && item.trim() !== ''),
  ) as Record<string, unknown>;
  for (const key of ['version', 'priceMinor', 'expectedRevision', 'amountMinor'])
    if (typeof value[key] === 'string') value[key] = Number(value[key]);
  for (const key of ['effectiveFrom', 'effectiveUntil', 'startsAt', 'dueAt'])
    if (typeof value[key] === 'string') value[key] = new Date(value[key]).toISOString();
  if (typeof value.entitlements === 'string')
    value.entitlements = value.entitlements
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return value;
}

function endpoint(
  task: ControlActionTask,
  tenantId: string,
): { readonly method: 'POST' | 'PUT'; readonly path: string } {
  if (task === 'package') return { method: 'POST', path: 'packages/versions' };
  if (task === 'assignment')
    return { method: 'PUT', path: `clients/${encodeURIComponent(tenantId)}/subscription` };
  if (task === 'transition')
    return {
      method: 'POST',
      path: `clients/${encodeURIComponent(tenantId)}/subscription/transitions`,
    };
  return {
    method: 'POST',
    path: `clients/${encodeURIComponent(tenantId)}/billing/${task === 'invoice' ? 'invoices' : 'payments'}`,
  };
}

function findReference(result: Readonly<Record<string, unknown>>): string {
  for (const value of Object.values(result))
    if (typeof value === 'string' && value.length > 3) return value;
  return 'Committed with audit evidence';
}
