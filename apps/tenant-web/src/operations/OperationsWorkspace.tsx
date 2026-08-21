import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import './operations.css';

export type OperationsTask =
  | 'subscriber'
  | 'billing'
  | 'office-payment'
  | 'collectors'
  | 'installation'
  | 'network'
  | 'support'
  | 'reports'
  | 'configuration';
export type OperationsViewState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'denied'
  | 'offline'
  | 'retry'
  | 'success';

interface LocalizedText {
  readonly title: string;
  readonly description: string;
  readonly primary: string;
  readonly steps: readonly string[];
}

export const operationsTaskCopy: Record<'en' | 'ar', Record<OperationsTask, LocalizedText>> = {
  en: {
    subscriber: {
      title: 'Add a subscriber service',
      description:
        'Capture the household, contact, scoped installation location, plan, and service. No subscriber account is created.',
      primary: 'Save subscriber draft',
      steps: ['Household & contact', 'Service location', 'Plan & activation review'],
    },
    billing: {
      title: 'Prepare recurring invoices',
      description:
        'Preview one eligible billing period using the effective VAT and rounding policy, with separate USD/LBP totals.',
      primary: 'Prepare invoice batch',
      steps: ['Choose period', 'Review eligible services', 'Prepare drafts'],
    },
    'office-payment': {
      title: 'Record an office payment',
      description:
        'Link a currency-specific posted finance receipt and use a linear, evidenced reversal chain for corrections.',
      primary: 'Review payment',
      steps: ['Posted receipt', 'Allocation evidence', 'Review & print'],
    },
    collectors: {
      title: 'Reconcile a collector route',
      description:
        'Derive expected and collected totals from assignments and posted evidence independently for USD and LBP.',
      primary: 'Reconcile route',
      steps: ['Assignments', 'Posted evidence', 'Approve any difference'],
    },
    installation: {
      title: 'Move an installation forward',
      description:
        'Schedule, record blockers, and attach field evidence before activation handoff or completion.',
      primary: 'Update installation',
      steps: ['Schedule', 'Field evidence', 'Activation handoff'],
    },
    network: {
      title: 'Queue a network service action',
      description:
        'Send one explicit, idempotent service action to the Network Worker. Platform subscription state never triggers subscriber suspension.',
      primary: 'Queue network action',
      steps: ['Select service', 'Review safe action', 'Queue & monitor'],
    },
    support: {
      title: 'Open an internal issue',
      description:
        'Link an issue to an in-scope subscriber or service and preserve evidence for every status transition.',
      primary: 'Create issue',
      steps: ['Describe', 'Prioritize', 'Assign'],
    },
    reports: {
      title: 'Export an operations report',
      description:
        'Apply the signed branch, area, route, and record scope to an expiring export request.',
      primary: 'Request export',
      steps: ['Select report', 'Review scope', 'Request file'],
    },
    configuration: {
      title: 'Configure operations defaults',
      description:
        'Version non-secret billing and workflow defaults. Credentials remain in the secret store.',
      primary: 'Review changes',
      steps: ['Effective policy', 'Workflow defaults', 'Version confirmation'],
    },
  },
  ar: {
    subscriber: {
      title: 'إضافة خدمة مشترك',
      description:
        'سجّل الأسرة ووسيلة الاتصال وموقع التركيب المصرّح به والباقـة والخدمة. لا يتم إنشاء حساب دخول للمشترك.',
      primary: 'حفظ مسودة المشترك',
      steps: ['الأسرة والاتصال', 'موقع الخدمة', 'مراجعة الباقة والتفعيل'],
    },
    billing: {
      title: 'تحضير الفواتير الدورية',
      description:
        'عاين فترة فوترة مؤهلة باستخدام سياسة الضريبة والتقريب النافذة، مع فصل إجماليات USD وLBP.',
      primary: 'تحضير دفعة الفواتير',
      steps: ['اختيار الفترة', 'مراجعة الخدمات المؤهلة', 'تحضير المسودات'],
    },
    'office-payment': {
      title: 'تسجيل دفعة مكتبية',
      description:
        'اربط إيصالاً مالياً مرحّلاً بعملة محددة واستخدم سلسلة عكس خطية ومدعومة بالأدلة للتصحيح.',
      primary: 'مراجعة الدفعة',
      steps: ['الإيصال المرحّل', 'دليل التخصيص', 'المراجعة والطباعة'],
    },
    collectors: {
      title: 'مطابقة مسار جابٍ',
      description:
        'اشتق المبالغ المتوقعة والمحصّلة من التعيينات والأدلة المرحّلة مع فصل USD عن LBP.',
      primary: 'مطابقة المسار',
      steps: ['التعيينات', 'الأدلة المرحّلة', 'اعتماد أي فرق'],
    },
    installation: {
      title: 'متابعة عملية التركيب',
      description:
        'حدّد الموعد وسجّل العوائق وأرفق أدلة العمل الميداني قبل التسليم للتفعيل أو الإكمال.',
      primary: 'تحديث التركيب',
      steps: ['الجدولة', 'الأدلة الميدانية', 'التسليم للتفعيل'],
    },
    network: {
      title: 'إرسال إجراء خدمة شبكية',
      description:
        'أرسل إجراء خدمة واحداً وصريحاً وغير قابل للتكرار إلى عامل الشبكة. لا تؤدي حالة اشتراك المنصة إلى تعليق خدمة المشترك.',
      primary: 'إرسال إجراء الشبكة',
      steps: ['اختيار الخدمة', 'مراجعة الإجراء الآمن', 'الإرسال والمراقبة'],
    },
    support: {
      title: 'فتح مشكلة داخلية',
      description: 'اربط المشكلة بمشترك أو خدمة ضمن النطاق واحفظ أدلة كل انتقال في الحالة.',
      primary: 'إنشاء المشكلة',
      steps: ['الوصف', 'الأولوية', 'التعيين'],
    },
    reports: {
      title: 'تصدير تقرير تشغيلي',
      description: 'طبّق نطاق الفرع والمنطقة والمسار والسجل الموقّع على طلب تصدير مؤقت.',
      primary: 'طلب التصدير',
      steps: ['اختيار التقرير', 'مراجعة النطاق', 'طلب الملف'],
    },
    configuration: {
      title: 'ضبط الإعدادات التشغيلية',
      description:
        'أنشئ نسخاً مؤرخة من إعدادات الفوترة وسير العمل غير السرية. تبقى بيانات الاعتماد في مخزن الأسرار.',
      primary: 'مراجعة التغييرات',
      steps: ['السياسة النافذة', 'إعدادات سير العمل', 'تأكيد النسخة'],
    },
  },
};

const stateCopy: Record<'en' | 'ar', Record<OperationsViewState, readonly [string, string]>> = {
  en: {
    loading: [
      'Loading operations data',
      'Wait for the current scoped data before making a change.',
    ],
    empty: [
      'No task result yet',
      'Choose a task and enter its required evidence when you are ready.',
    ],
    error: [
      'Operations data could not be loaded',
      'No mutation was repeated. Retry the read safely.',
    ],
    denied: [
      'This task is outside your scope',
      'Ask a tenant administrator for the smallest required permission and scope.',
    ],
    offline: [
      'You are offline',
      'Inputs remain on this screen only. Posting and network work are disabled until connectivity returns.',
    ],
    retry: ['Ready to retry', 'Review the unchanged idempotency key before retrying.'],
    success: ['Task saved', 'The committed result and audit reference are ready for review.'],
  },
  ar: {
    loading: [
      'جارٍ تحميل البيانات التشغيلية',
      'انتظر البيانات الحالية ضمن نطاقك قبل إجراء أي تغيير.',
    ],
    empty: ['لا توجد نتيجة للمهمة بعد', 'اختر مهمة وأدخل الأدلة المطلوبة عندما تصبح جاهزاً.'],
    error: ['تعذّر تحميل البيانات التشغيلية', 'لم يتكرر أي إجراء. أعد محاولة القراءة بأمان.'],
    denied: ['هذه المهمة خارج نطاقك', 'اطلب من مدير الشركة أصغر صلاحية ونطاق مطلوبين.'],
    offline: [
      'أنت غير متصل',
      'تبقى المدخلات على هذه الشاشة فقط. يتعطّل الترحيل والعمل الشبكي حتى عودة الاتصال.',
    ],
    retry: ['جاهز لإعادة المحاولة', 'راجع مفتاح عدم التكرار نفسه قبل المحاولة.'],
    success: ['تم حفظ المهمة', 'النتيجة المثبتة ومرجع التدقيق جاهزان للمراجعة.'],
  },
};

export interface OperationsWorkspaceProps {
  readonly locale: 'en' | 'ar';
  readonly initialTask?: OperationsTask;
  readonly state?: OperationsViewState;
  readonly onRetry?: () => void;
  readonly onSubmit?: (
    task: OperationsTask,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ) => Promise<Record<string, unknown>>;
}

export function OperationsWorkspace({
  locale,
  initialTask = 'subscriber',
  state = 'empty',
  onRetry,
  onSubmit,
}: OperationsWorkspaceProps) {
  const [task, setTask] = useState<OperationsTask>(initialTask);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();
  const [submissionReference, setSubmissionReference] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey());
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => setTask(initialTask), [initialTask]);
  useEffect(() => {
    setSubmissionError(undefined);
    setSubmissionReference(undefined);
    setIdempotencyKey(createIdempotencyKey());
  }, [task]);
  useEffect(() => {
    if (mounted.current) heading.current?.focus();
    else mounted.current = true;
  }, [task]);
  const copy = operationsTaskCopy[locale][task];
  const effectiveState: OperationsViewState = submitting
    ? 'loading'
    : submissionError
      ? 'error'
      : submissionReference
        ? 'success'
        : state;
  const [stateTitle, stateDescription] = stateCopy[locale][effectiveState];
  const retryable =
    (effectiveState === 'error' || effectiveState === 'offline' || effectiveState === 'retry') &&
    (onRetry !== undefined || submissionError !== undefined);
  const labels =
    locale === 'en'
      ? {
          tasks: 'Operations tasks',
          retry: 'Retry safely',
          audit: 'An audit reference appears only after a committed save',
          unavailable: 'Live submission is available after authenticated access.',
          live: 'Changes are permission scoped, idempotent, and written with audit evidence.',
          reference: 'Saved reference',
          validation: 'Review the highlighted fields and try again.',
        }
      : {
          tasks: 'المهام التشغيلية',
          retry: 'إعادة المحاولة بأمان',
          audit: 'يظهر مرجع التدقيق بعد تثبيت الحفظ فقط',
          unavailable: 'يتاح الإرسال المباشر ضمن جلسة مصرح بها.',
          live: 'التغييرات مقيّدة بالصلاحيات وغير قابلة للتكرار ومحفوظة مع دليل تدقيق.',
          reference: 'مرجع الحفظ',
          validation: 'راجع الحقول المطلوبة وحاول مجدداً.',
        };

  const fields = useMemo(() => taskFields[task], [task]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmit) return;
    const form = event.currentTarget;
    setSubmitting(true);
    setSubmissionError(undefined);
    setSubmissionReference(undefined);
    try {
      const payload = payloadFor(task, new FormData(form));
      const result = await onSubmit(task, payload, idempotencyKey);
      setSubmissionReference(resultReference(result));
      setIdempotencyKey(createIdempotencyKey());
      form.reset();
    } catch (caught) {
      setSubmissionError(caught instanceof Error ? caught.message : labels.validation);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="operations-workspace"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-busy={effectiveState === 'loading'}
    >
      <nav aria-label={labels.tasks} className="operations-task-nav">
        {(Object.keys(operationsTaskCopy[locale]) as OperationsTask[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={task === id ? 'page' : undefined}
            onClick={() => setTask(id)}
          >
            {operationsTaskCopy[locale][id].title}
          </button>
        ))}
      </nav>
      <form className="operations-task-panel" onSubmit={(event) => void submit(event)}>
        <header>
          <p className="operations-eyebrow">{labels.tasks}</p>
          <h1 ref={heading} tabIndex={-1}>
            {copy.title}
          </h1>
          <p>{copy.description}</p>
        </header>
        <ol className="operations-steps" aria-label={copy.title}>
          {copy.steps.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="operations-form-grid">
          {fields.map((field) => (
            <OperationField key={field.name} field={field} locale={locale} />
          ))}
        </div>
        <div
          className={`operations-state operations-state--${effectiveState}`}
          role={submissionError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <strong>{stateTitle}</strong>
          <span>{submissionError ?? stateDescription}</span>
          {submissionReference ? (
            <code>
              {labels.reference}: {submissionReference}
            </code>
          ) : null}
          {retryable && (
            <button
              type="button"
              onClick={() => {
                setSubmissionError(undefined);
                onRetry?.();
              }}
            >
              {labels.retry}
            </button>
          )}
        </div>
        <footer>
          <small>{onSubmit ? labels.live : labels.unavailable}</small>
          <button
            type="submit"
            className="operations-primary"
            disabled={
              onSubmit === undefined ||
              effectiveState === 'loading' ||
              effectiveState === 'denied' ||
              effectiveState === 'offline'
            }
          >
            {submitting ? (locale === 'en' ? 'Saving…' : 'جارٍ الحفظ…') : copy.primary}
          </button>
        </footer>
      </form>
    </section>
  );
}

type FieldKind = 'text' | 'number' | 'date' | 'datetime-local' | 'select' | 'textarea';
interface OperationFieldDefinition {
  readonly name: string;
  readonly label: readonly [string, string];
  readonly kind?: FieldKind;
  readonly required?: boolean;
  readonly placeholder?: readonly [string, string];
  readonly options?: readonly string[];
  readonly min?: number;
}

const scopeFields: readonly OperationFieldDefinition[] = [
  { name: 'branchId', label: ['Branch ID', 'معرّف الفرع'], required: true },
  { name: 'areaId', label: ['Area ID', 'معرّف المنطقة'], required: true },
  { name: 'routeId', label: ['Route ID', 'معرّف المسار'], required: true },
];

const taskFields: Readonly<Record<OperationsTask, readonly OperationFieldDefinition[]>> = {
  subscriber: [
    { name: 'subscriberNumber', label: ['Subscriber number', 'رقم المشترك'], required: true },
    { name: 'displayName', label: ['Subscriber name', 'اسم المشترك'], required: true },
    { name: 'householdReference', label: ['Household reference', 'مرجع الأسرة'], required: true },
    { name: 'householdName', label: ['Household name', 'اسم الأسرة'], required: true },
    { name: 'locationLabel', label: ['Location label', 'اسم الموقع'], required: true },
    { name: 'addressLine', label: ['Address', 'العنوان'], kind: 'textarea', required: true },
    ...scopeFields,
    { name: 'areaCode', label: ['Area code (optional)', 'رمز المنطقة (اختياري)'] },
    { name: 'primaryPhone', label: ['Primary phone (optional)', 'الهاتف الأساسي (اختياري)'] },
  ],
  billing: [
    { name: 'periodStart', label: ['Period start', 'بداية الفترة'], kind: 'date', required: true },
    { name: 'periodEnd', label: ['Period end', 'نهاية الفترة'], kind: 'date', required: true },
  ],
  'office-payment': [
    { name: 'subscriberId', label: ['Subscriber ID', 'معرّف المشترك'], required: true },
    {
      name: 'financePaymentId',
      label: ['Finance payment ID', 'معرّف الدفعة المالية'],
      required: true,
    },
    ...scopeFields,
    { name: 'receiptNumber', label: ['Receipt number', 'رقم الإيصال'], required: true },
    {
      name: 'amountMinor',
      label: ['Amount in minor units', 'المبلغ بالوحدة الصغرى'],
      kind: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'currency',
      label: ['Currency', 'العملة'],
      kind: 'select',
      required: true,
      options: ['USD', 'LBP'],
    },
  ],
  collectors: [
    { name: 'collectorUserId', label: ['Collector user ID', 'معرّف الجابي'], required: true },
    { name: 'routeId', label: ['Route ID', 'معرّف المسار'], required: true },
    { name: 'businessDate', label: ['Business date', 'تاريخ العمل'], kind: 'date', required: true },
    {
      name: 'currency',
      label: ['Currency', 'العملة'],
      kind: 'select',
      required: true,
      options: ['USD', 'LBP'],
    },
    {
      name: 'reason',
      label: ['Difference reason (if needed)', 'سبب الفرق (عند الحاجة)'],
      kind: 'textarea',
    },
  ],
  installation: [
    { name: 'installationId', label: ['Installation ID', 'معرّف التركيب'], required: true },
    {
      name: 'expectedVersion',
      label: ['Current version', 'رقم النسخة الحالية'],
      kind: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'toStatus',
      label: ['Move to status', 'النقل إلى الحالة'],
      kind: 'select',
      required: true,
      options: [
        'in_progress',
        'scheduled',
        'blocked',
        'ready_for_activation',
        'completed',
        'cancelled',
      ],
    },
    { name: 'note', label: ['Operational note', 'ملاحظة تشغيلية'], kind: 'textarea' },
    {
      name: 'scheduledFor',
      label: ['Scheduled for (scheduled only)', 'موعد التنفيذ (للجدولة)'],
      kind: 'datetime-local',
    },
    { name: 'installerUserId', label: ['Installer ID (scheduled only)', 'معرّف الفني (للجدولة)'] },
    {
      name: 'signalTest',
      label: ['Signal test (activation/completion)', 'اختبار الإشارة (للتفعيل/الإكمال)'],
    },
    { name: 'equipmentSerial', label: ['Equipment serial', 'الرقم التسلسلي للمعدات'] },
    { name: 'completedAt', label: ['Evidence time', 'وقت الدليل'], kind: 'datetime-local' },
  ],
  network: [
    { name: 'serviceId', label: ['Service ID', 'معرّف الخدمة'], required: true },
    {
      name: 'action',
      label: ['Action', 'الإجراء'],
      kind: 'select',
      required: true,
      options: ['activate', 'restore', 'change_profile', 'suspend', 'terminate'],
    },
    {
      name: 'profileReference',
      label: ['Profile reference (profile change)', 'مرجع الباقة (لتغيير الباقة)'],
    },
    {
      name: 'reasonCode',
      label: ['Reason code (suspend/terminate)', 'رمز السبب (للتعليق/الإنهاء)'],
    },
  ],
  support: [
    { name: 'issueNumber', label: ['Issue number', 'رقم المشكلة'], required: true },
    { name: 'subject', label: ['Subject', 'الموضوع'], required: true },
    { name: 'description', label: ['Description', 'الوصف'], kind: 'textarea', required: true },
    {
      name: 'priority',
      label: ['Priority', 'الأولوية'],
      kind: 'select',
      required: true,
      options: ['low', 'normal', 'high', 'urgent'],
    },
    { name: 'subscriberId', label: ['Subscriber ID (or service ID)', 'معرّف المشترك (أو الخدمة)'] },
    { name: 'serviceId', label: ['Service ID (or subscriber ID)', 'معرّف الخدمة (أو المشترك)'] },
    ...scopeFields,
  ],
  reports: [
    {
      name: 'reportKey',
      label: ['Report key', 'رمز التقرير'],
      required: true,
      placeholder: ['collections_daily', 'collections_daily'],
    },
    {
      name: 'format',
      label: ['Format', 'الصيغة'],
      kind: 'select',
      required: true,
      options: ['csv', 'xlsx', 'pdf'],
    },
    {
      name: 'filters',
      label: ['Filters (JSON)', 'عوامل التصفية (JSON)'],
      kind: 'textarea',
      placeholder: ['{}', '{}'],
    },
  ],
  configuration: [
    { name: 'key', label: ['Configuration key', 'مفتاح الإعداد'], required: true },
    {
      name: 'value',
      label: ['Configuration value (JSON)', 'قيمة الإعداد (JSON)'],
      kind: 'textarea',
      required: true,
      placeholder: ['{}', '{}'],
    },
    { name: 'branchId', label: ['Branch ID (optional)', 'معرّف الفرع (اختياري)'] },
    {
      name: 'expectedVersion',
      label: ['Expected version (optional)', 'النسخة المتوقعة (اختياري)'],
      kind: 'number',
      min: 1,
    },
  ],
};

function OperationField({
  field,
  locale,
}: {
  readonly field: OperationFieldDefinition;
  readonly locale: 'en' | 'ar';
}) {
  const label = field.label[locale === 'en' ? 0 : 1];
  const common = {
    name: field.name,
    required: field.required,
    placeholder: field.placeholder?.[locale === 'en' ? 0 : 1],
  };
  return (
    <label
      className={
        field.kind === 'textarea' ? 'operations-field operations-field--wide' : 'operations-field'
      }
    >
      <span>{label}</span>
      {field.kind === 'select' ? (
        <select
          {...common}
          defaultValue={field.options?.includes('normal') ? 'normal' : field.options?.[0]}
        >
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      ) : field.kind === 'textarea' ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={field.kind ?? 'text'}
          min={field.min}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
        />
      )}
    </label>
  );
}

const taskPaths: Readonly<Record<OperationsTask, string>> = {
  subscriber: 'subscribers',
  billing: 'billing-runs',
  'office-payment': 'office-payments',
  collectors: 'collector-reconciliations',
  installation: 'installations/transitions',
  network: 'network-actions',
  support: 'issues',
  reports: 'exports',
  configuration: 'configuration',
};

export function operationPath(task: OperationsTask): string {
  return taskPaths[task];
}

function payloadFor(task: OperationsTask, form: FormData): Record<string, unknown> {
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  ) as Record<string, string>;
  for (const key of ['amountMinor', 'expectedVersion']) {
    if (raw[key] !== undefined) (raw as Record<string, unknown>)[key] = Number(raw[key]);
  }
  for (const key of ['scheduledFor', 'completedAt']) {
    if (raw[key]) raw[key] = new Date(raw[key]).toISOString();
  }
  if (task === 'reports') (raw as Record<string, unknown>).filters = parseJson(raw.filters ?? '{}');
  if (task === 'configuration')
    (raw as Record<string, unknown>).value = parseJson(raw.value ?? '{}');
  if (task === 'installation') {
    const toStatus = raw.toStatus;
    const payload: Record<string, unknown> = { ...raw };
    delete payload.scheduledFor;
    delete payload.installerUserId;
    delete payload.signalTest;
    delete payload.equipmentSerial;
    delete payload.completedAt;
    if (toStatus === 'scheduled') {
      payload.evidence = { scheduledFor: raw.scheduledFor, installerUserId: raw.installerUserId };
    } else if (toStatus === 'ready_for_activation' || toStatus === 'completed') {
      payload.evidence = {
        signalTest: raw.signalTest,
        equipmentSerial: raw.equipmentSerial,
        completedAt: raw.completedAt,
      };
    } else payload.evidence = {};
    return payload;
  }
  if (task === 'network') {
    const payload: Record<string, unknown> = { serviceId: raw.serviceId, action: raw.action };
    if (raw.action === 'change_profile')
      payload.payload = { profileReference: raw.profileReference };
    else if (raw.action === 'suspend' || raw.action === 'terminate')
      payload.payload = { reasonCode: raw.reasonCode };
    else payload.payload = {};
    return payload;
  }
  return raw;
}

function parseJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('JSON value must be an object.');
  }
  return parsed as Record<string, unknown>;
}

function createIdempotencyKey(): string {
  return `web-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function resultReference(result: Readonly<Record<string, unknown>>): string {
  for (const key of [
    'id',
    'subscriberId',
    'paymentId',
    'reconciliationId',
    'issueId',
    'exportId',
    'key',
  ]) {
    const value = result[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return 'Committed with audit evidence';
}
