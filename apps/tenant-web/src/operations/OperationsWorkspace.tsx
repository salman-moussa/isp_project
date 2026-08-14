import { useEffect, useRef, useState } from 'react';
import './operations.css';

export type OperationsTask =
  | 'subscriber'
  | 'billing'
  | 'office-payment'
  | 'collectors'
  | 'installation'
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
  readonly onSubmit?: (task: OperationsTask) => void;
}

export function OperationsWorkspace({
  locale,
  initialTask = 'subscriber',
  state = 'empty',
  onRetry,
  onSubmit,
}: OperationsWorkspaceProps) {
  const [task, setTask] = useState<OperationsTask>(initialTask);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => setTask(initialTask), [initialTask]);
  useEffect(() => {
    if (mounted.current) heading.current?.focus();
    else mounted.current = true;
  }, [task]);
  const copy = operationsTaskCopy[locale][task];
  const [stateTitle, stateDescription] = stateCopy[locale][state];
  const retryable =
    (state === 'error' || state === 'offline' || state === 'retry') && onRetry !== undefined;
  const labels =
    locale === 'en'
      ? {
          tasks: 'Operations tasks',
          retry: 'Retry safely',
          audit: 'An audit reference appears only after a committed save',
          unavailable: 'Live submission is not connected in this demonstration.',
        }
      : {
          tasks: 'المهام التشغيلية',
          retry: 'إعادة المحاولة بأمان',
          audit: 'يظهر مرجع التدقيق بعد تثبيت الحفظ فقط',
          unavailable: 'الإرسال المباشر غير متصل في هذا العرض التوضيحي.',
        };

  return (
    <section
      className="operations-workspace"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-busy={state === 'loading'}
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
      <article className="operations-task-panel">
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
        <div
          className={`operations-state operations-state--${state}`}
          role="status"
          aria-live="polite"
        >
          <strong>{stateTitle}</strong>
          <span>{stateDescription}</span>
          {retryable && (
            <button type="button" onClick={onRetry}>
              {labels.retry}
            </button>
          )}
        </div>
        <footer>
          <small>{onSubmit ? labels.audit : labels.unavailable}</small>
          <button
            type="button"
            className="operations-primary"
            disabled={
              onSubmit === undefined ||
              state === 'loading' ||
              state === 'denied' ||
              state === 'offline'
            }
            onClick={() => onSubmit?.(task)}
          >
            {copy.primary}
          </button>
        </footer>
      </article>
    </section>
  );
}
