import type { Locale, TaskRouteDefinition, Tone } from '@isp/ui';

type MetricSeed = [string, string, string, string, Tone?];
type QueueSeed = [string, string, string, Tone?];
type ActionSeed = [string, string, string];
type RouteSeed = [string, string, string, MetricSeed[], string, string, QueueSeed[], ActionSeed[]];

function buildRoutes(
  seeds: Record<string, RouteSeed>,
  labels: { queue: string; next: string; nextDescription: string },
): Record<string, TaskRouteDefinition> {
  return Object.fromEntries(
    Object.entries(seeds).map(
      ([
        id,
        [eyebrow, title, description, metrics, queueTitle, queueDescription, queue, actions],
      ]) => [
        id,
        {
          eyebrow,
          title,
          description,
          metrics: metrics.map(([label, value, detail, status, tone]) => ({
            label,
            value,
            detail,
            status,
            tone,
          })),
          queueTitle: `${labels.queue} · ${queueTitle}`,
          queueDescription,
          queue: queue.map(([label, value, detail, tone]) => ({ label, value, detail, tone })),
          nextTitle: labels.next,
          nextDescription: labels.nextDescription,
          actions: actions.map(([label, description, targetId]) => ({
            label,
            description,
            targetId,
          })),
        },
      ],
    ),
  );
}

const english = buildRoutes(
  {
    subscribers: [
      'Subscriber service',
      'Find and serve subscribers',
      'Work from one branch-scoped record for identity, service address, package, balance, and network state.',
      [
        ['Active subscribers', '2,481', 'Hamra branch', 'Online', 'positive'],
        ['Service holds', '26', 'Operational review required', 'Review', 'warning'],
        ['New this month', '41', 'Identity and address verified', 'Growing', 'primary'],
      ],
      'Subscriber attention',
      'Prioritized by service impact and the next recorded action.',
      [
        ['SUB-10482 · Layla A.', 'Review', 'Package change requested for renewal', 'warning'],
        ['SUB-09821 · Karim N.', 'Online', 'Payment posted · service current', 'positive'],
        ['SUB-11731 · Sami H.', 'Install', 'Address survey completed', 'primary'],
      ],
      [
        ['Open billing', 'Review invoices and balances', 'billing'],
        ['Open installations', 'Coordinate pending activations', 'installations'],
      ],
    ],
    billing: [
      'Subscriber finance',
      'Run billing and invoices',
      'Prepare, issue, and correct subscriber invoices while preserving posted records and separate USD and LBP ledgers.',
      [
        ['Draft invoices', '118', 'Ready for validation', 'Draft', 'primary'],
        ['USD outstanding', 'USD 12,840', 'Posted balances only', 'Open', 'warning'],
        ['LBP outstanding', 'LBP 486M', 'Never combined with USD', 'Open', 'warning'],
      ],
      'Billing work queue',
      'Corrections use linked reversals or notes instead of overwriting posted entries.',
      [
        ['INV-2608-118', 'Validate', 'USD 30 · package and period ready', 'primary'],
        ['INV-2607-884', 'Overdue', 'LBP 3,000,000 · follow-up assigned', 'critical'],
        ['BATCH-2608-A', 'Draft', '118 invoices · validation pending', 'warning'],
      ],
      [
        ['Open payments', 'Allocate receipts to posted invoices', 'payments'],
        ['Open reports', 'Review currency-separated aging', 'reports'],
      ],
    ],
    payments: [
      'Cashier workspace',
      'Post payments and close the shift',
      'Record each receipt in its original currency, allocate it explicitly, and reconcile the cashier drawer.',
      [
        ['USD collected', 'USD 2,140', 'Posted today', 'Balanced', 'positive'],
        ['LBP collected', 'LBP 74M', 'Posted today', 'Balanced', 'positive'],
        ['Unallocated', '3', 'Receipts need invoice matches', 'Resolve', 'critical'],
      ],
      'Cashier work queue',
      'Every posted receipt remains attributable to its source and operator.',
      [
        ['REC-8421 · Layla A.', 'Allocate', 'USD 30 · cash', 'warning'],
        ['REC-8419 · Karim N.', 'Posted', 'LBP 2,500,000 · OMT', 'positive'],
        ['Drawer · Hamra', 'Close', 'Count due at 18:00 Beirut', 'primary'],
      ],
      [
        ['Open billing', 'Match receipts to posted invoices', 'billing'],
        ['Open collectors', 'Reconcile field collections', 'collectors'],
      ],
    ],
    collectors: [
      'Field collection',
      'Coordinate collector routes',
      'Assign branch-scoped visits, monitor sync, and reconcile submitted receipts before closing a collector shift.',
      [
        ['Collectors active', '8', 'Two routes currently syncing', 'Active', 'positive'],
        ['Visits remaining', '37', 'Across today’s routes', 'In progress', 'primary'],
        ['Sync attention', '2', 'Retry or conflict review needed', 'Attention', 'critical'],
      ],
      'Collector exceptions',
      'Offline work stays visible until the server accepts or rejects each change.',
      [
        ['Route HAM-04 · Jad', 'Sync', 'One receipt awaiting upload', 'warning'],
        ['Route HAM-07 · Nour', 'Conflict', 'Subscriber balance changed', 'critical'],
        ['Route HAM-02 · Rima', 'Closed', 'Drawer reconciled at 15:40', 'positive'],
      ],
      [
        ['Open payments', 'Reconcile submitted receipts', 'payments'],
        ['Open subscribers', 'Review visit account context', 'subscribers'],
      ],
    ],
    mikrotik: [
      'Network operations',
      'Review MikroTik service work',
      'Inspect verified subscriber mappings and queued commands; every mutation is idempotent, authorized, and auditable.',
      [
        [
          'Routers online',
          '12 / 13',
          'Last health check under five minutes',
          'Attention',
          'warning',
        ],
        ['Commands queued', '7', 'Network Worker owns execution', 'Queued', 'primary'],
        ['Failed commands', '3', 'Retry decision required', 'Action needed', 'critical'],
      ],
      'Network Worker queue',
      'Platform subscription state never initiates subscriber suspension.',
      [
        ['RTR-HAM-03', 'Offline', 'Last contact 22 minutes ago', 'critical'],
        ['CMD-18942 · SUB-10482', 'Queued', 'Speed profile change at renewal', 'primary'],
        ['CMD-18931 · SUB-09821', 'Applied', 'Enable confirmed by read-back', 'positive'],
      ],
      [
        ['Open subscribers', 'Verify service and router mapping', 'subscribers'],
        ['Open support', 'Coordinate unresolved network incidents', 'support'],
      ],
    ],
    installations: [
      'Field service',
      'Schedule installations',
      'Move each order from survey through activation with an owner, appointment, equipment record, and proof of work.',
      [
        ['Scheduled today', '9', 'Hamra service area', 'Scheduled', 'primary'],
        ['Ready to activate', '3', 'Physical work complete', 'Ready', 'positive'],
        ['Blocked', '2', 'Site or equipment issue', 'Attention', 'critical'],
      ],
      'Installation board',
      'Appointments are shown in Beirut time with the next responsible team.',
      [
        ['INS-442 · Sami H.', '10:30', 'Router assigned · technician en route', 'primary'],
        ['INS-439 · Mira K.', 'Activate', 'Signal test passed', 'positive'],
        ['INS-447 · Omar D.', 'Blocked', 'Building access not confirmed', 'critical'],
      ],
      [
        ['Open subscribers', 'Confirm the service account', 'subscribers'],
        ['Open MikroTik', 'Coordinate activation commands', 'mikrotik'],
      ],
    ],
    support: [
      'Service desk',
      'Resolve internal support work',
      'Triage subscriber, billing, collection, and network issues inside the ISP workspace and its permission boundary.',
      [
        ['Open tickets', '34', 'Across all branch queues', 'Active', 'primary'],
        ['SLA risk', '5', 'Response due within one hour', 'Urgent', 'critical'],
        ['Waiting on subscriber', '11', 'Follow-up date recorded', 'Waiting', 'warning'],
      ],
      'Priority service queue',
      'Each ticket keeps its subscriber, owner, history, and next action together.',
      [
        ['TKT-3184 · Rawan S.', 'SLA risk', 'Intermittent service · network owner', 'critical'],
        ['TKT-3191 · Ali M.', 'Billing', 'Receipt allocation evidence attached', 'warning'],
        ['TKT-3172 · Dalia R.', 'Waiting', 'Appointment confirmation requested', 'primary'],
      ],
      [
        ['Open subscribers', 'Review account and service history', 'subscribers'],
        ['Open MikroTik', 'Inspect network evidence and commands', 'mikrotik'],
      ],
    ],
    reports: [
      'Operational intelligence',
      'Use governed ISP reports',
      'Review branch and tenant aggregates with explicit periods, currencies, filters, and protected exports.',
      [
        ['Scheduled reports', '7', 'Next run in Beirut time', 'Running', 'positive'],
        ['Saved views', '19', 'Scoped to the current role', 'Available', 'primary'],
        ['Exports ready', '3', 'Protected download window active', 'Expires soon', 'warning'],
      ],
      'Recent report activity',
      'USD and LBP finance reports remain separate end to end.',
      [
        ['Daily cashier close', 'Ready', 'USD and LBP sections · today', 'positive'],
        ['Subscriber aging · USD', 'Ready', 'Generated at 09:10', 'positive'],
        ['Network exceptions', 'Scheduled', 'Runs hourly', 'primary'],
      ],
      [
        ['Open billing', 'Inspect the posted invoice source', 'billing'],
        ['Open configuration', 'Review schedules and retention', 'configuration'],
      ],
    ],
    configuration: [
      'Workspace governance',
      'Configure ISP operations',
      'Manage branches, roles, numbering, billing policy, integrations, and audit settings within the tenant boundary.',
      [
        ['Enabled users', '48', 'Across four branches', 'Current', 'positive'],
        ['Role assignments', '76', 'Permission-catalogue based', 'Reviewed', 'primary'],
        ['Reviews due', '4', 'Quarterly access attestation', 'Due', 'warning'],
      ],
      'Configuration review',
      'High-impact changes remain explicit, attributable, and auditable.',
      [
        ['Invoice numbering', 'Current', 'HAM-YYYY-sequence', 'positive'],
        ['MikroTik integration', 'Healthy', 'Secret stored by reference', 'positive'],
        ['Access review', 'Due', 'Four assignments need attestation', 'warning'],
      ],
      [
        ['Open reports', 'Review governance and audit evidence', 'reports'],
        ['Open collectors', 'Review field-team assignments', 'collectors'],
      ],
    ],
  },
  {
    queue: 'Work queue',
    next: 'Continue work',
    nextDescription: 'Open the connected workflow without losing branch context.',
  },
);

const arabic = buildRoutes(
  {
    subscribers: [
      'خدمة المشتركين',
      'البحث عن المشتركين وخدمتهم',
      'اعمل من سجل واحد مقيّد بالفرع للهوية والعنوان والباقة والرصيد وحالة الشبكة.',
      [
        ['مشتركون نشطون', '٢٬٤٨١', 'فرع الحمرا', 'متصلون', 'positive'],
        ['تعليق خدمة', '٢٦', 'تحتاج مراجعة تشغيلية', 'مراجعة', 'warning'],
        ['جدد هذا الشهر', '٤١', 'الهوية والعنوان متحققان', 'نمو', 'primary'],
      ],
      'مشتركون يحتاجون انتباهاً',
      'مرتبة حسب أثر الخدمة والإجراء المسجل التالي.',
      [
        ['SUB-10482 · ليلى أ.', 'مراجعة', 'تغيير باقة عند التجديد', 'warning'],
        ['SUB-09821 · كريم ن.', 'متصل', 'الدفعة مرحلة · الخدمة حالية', 'positive'],
        ['SUB-11731 · سامي ح.', 'تركيب', 'مسح العنوان مكتمل', 'primary'],
      ],
      [
        ['فتح الفوترة', 'مراجعة الفواتير والأرصدة', 'billing'],
        ['فتح التركيبات', 'تنسيق عمليات التفعيل المعلقة', 'installations'],
      ],
    ],
    billing: [
      'مالية المشتركين',
      'تشغيل الفوترة والفواتير',
      'حضّر الفواتير وأصدرها وصححها مع حفظ السجلات المرحلة وفصل دفاتر USD وLBP.',
      [
        ['فواتير مسودة', '١١٨', 'جاهزة للتحقق', 'مسودة', 'primary'],
        ['مستحق USD', 'USD 12,840', 'أرصدة مرحلة فقط', 'مفتوح', 'warning'],
        ['مستحق LBP', 'LBP 486M', 'لا يُجمع مع USD', 'مفتوح', 'warning'],
      ],
      'قائمة عمل الفوترة',
      'التصحيحات تستخدم قيوداً عكسية أو ملاحظات مرتبطة ولا تستبدل القيود المرحلة.',
      [
        ['INV-2608-118', 'تحقق', 'USD 30 · الباقة والفترة جاهزتان', 'primary'],
        ['INV-2607-884', 'متأخرة', 'LBP 3,000,000 · المتابعة معيّنة', 'critical'],
        ['BATCH-2608-A', 'مسودة', '١١٨ فاتورة · التحقق معلق', 'warning'],
      ],
      [
        ['فتح الدفعات', 'تخصيص الإيصالات للفواتير المرحلة', 'payments'],
        ['فتح التقارير', 'مراجعة الأعمار مفصولة بالعملة', 'reports'],
      ],
    ],
    payments: [
      'مساحة الصندوق',
      'ترحيل الدفعات وإغلاق الوردية',
      'سجل كل إيصال بعملته الأصلية وخصصه صراحةً وسوِّ صندوق أمين الصندوق.',
      [
        ['محصّل USD', 'USD 2,140', 'مرحّل اليوم', 'متوازن', 'positive'],
        ['محصّل LBP', 'LBP 74M', 'مرحّل اليوم', 'متوازن', 'positive'],
        ['غير مخصص', '٣', 'إيصالات تحتاج مطابقة', 'حل مطلوب', 'critical'],
      ],
      'قائمة عمل الصندوق',
      'يبقى كل إيصال مرحّل منسوباً إلى مصدره ومشغله.',
      [
        ['REC-8421 · ليلى أ.', 'تخصيص', 'USD 30 · نقداً', 'warning'],
        ['REC-8419 · كريم ن.', 'مرحّل', 'LBP 2,500,000 · OMT', 'positive'],
        ['صندوق الحمرا', 'إغلاق', 'الجرد الساعة ١٨:٠٠ بتوقيت بيروت', 'primary'],
      ],
      [
        ['فتح الفوترة', 'مطابقة الإيصالات مع الفواتير', 'billing'],
        ['فتح الجباة', 'تسوية التحصيل الميداني', 'collectors'],
      ],
    ],
    collectors: [
      'التحصيل الميداني',
      'تنسيق مسارات الجباة',
      'عيّن الزيارات المقيّدة بالفرع وراقب المزامنة وسوِّ الإيصالات قبل إغلاق الوردية.',
      [
        ['جباة نشطون', '٨', 'مساران يتزامنان الآن', 'نشط', 'positive'],
        ['زيارات متبقية', '٣٧', 'في مسارات اليوم', 'قيد العمل', 'primary'],
        ['انتباه للمزامنة', '٢', 'إعادة محاولة أو مراجعة تعارض', 'انتباه', 'critical'],
      ],
      'استثناءات الجباة',
      'يبقى العمل دون اتصال ظاهراً حتى يقبل الخادم كل تغيير أو يرفضه.',
      [
        ['HAM-04 · جاد', 'مزامنة', 'إيصال واحد ينتظر الرفع', 'warning'],
        ['HAM-07 · نور', 'تعارض', 'تغير رصيد المشترك', 'critical'],
        ['HAM-02 · ريما', 'مغلق', 'تمت تسوية الصندوق ١٥:٤٠', 'positive'],
      ],
      [
        ['فتح الدفعات', 'تسوية الإيصالات المقدمة', 'payments'],
        ['فتح المشتركين', 'مراجعة سياق حساب الزيارة', 'subscribers'],
      ],
    ],
    mikrotik: [
      'عمليات الشبكة',
      'مراجعة أعمال شبكة MikroTik',
      'افحص ربط المشتركين المتحقق منه والأوامر المنتظرة؛ كل تغيير متكرر بأمان ومصرح ومدقق.',
      [
        ['موجّهات متصلة', '١٢ / ١٣', 'آخر فحص خلال خمس دقائق', 'انتباه', 'warning'],
        ['أوامر منتظرة', '٧', 'عامل الشبكة ينفذها', 'منتظرة', 'primary'],
        ['أوامر فاشلة', '٣', 'قرار إعادة المحاولة مطلوب', 'إجراء مطلوب', 'critical'],
      ],
      'قائمة عامل الشبكة',
      'حالة اشتراك المنصة لا تبدأ أبداً تعليق مشترك.',
      [
        ['RTR-HAM-03', 'غير متصل', 'آخر اتصال قبل ٢٢ دقيقة', 'critical'],
        ['CMD-18942 · SUB-10482', 'منتظر', 'تغيير السرعة عند التجديد', 'primary'],
        ['CMD-18931 · SUB-09821', 'مطبق', 'التفعيل مؤكد بالقراءة', 'positive'],
      ],
      [
        ['فتح المشتركين', 'التحقق من الخدمة وربط الموجّه', 'subscribers'],
        ['فتح الدعم', 'تنسيق حوادث الشبكة غير المحلولة', 'support'],
      ],
    ],
    installations: [
      'الخدمة الميدانية',
      'جدولة التركيبات',
      'انقل كل طلب من المسح حتى التفعيل مع مالك وموعد ومعدات وإثبات عمل.',
      [
        ['مجدولة اليوم', '٩', 'منطقة خدمة الحمرا', 'مجدولة', 'primary'],
        ['جاهزة للتفعيل', '٣', 'العمل الميداني مكتمل', 'جاهزة', 'positive'],
        ['معطلة', '٢', 'مشكلة موقع أو معدات', 'انتباه', 'critical'],
      ],
      'لوحة التركيبات',
      'تظهر المواعيد بتوقيت بيروت مع الفريق المسؤول التالي.',
      [
        ['INS-442 · سامي ح.', '١٠:٣٠', 'الموجّه معيّن · الفني في الطريق', 'primary'],
        ['INS-439 · ميرا ك.', 'تفعيل', 'اختبار الإشارة ناجح', 'positive'],
        ['INS-447 · عمر د.', 'معطل', 'دخول المبنى غير مؤكد', 'critical'],
      ],
      [
        ['فتح المشتركين', 'تأكيد حساب الخدمة', 'subscribers'],
        ['فتح MikroTik', 'تنسيق أوامر التفعيل', 'mikrotik'],
      ],
    ],
    support: [
      'مكتب الخدمة',
      'حل أعمال الدعم الداخلية',
      'افرز مشاكل المشتركين والفوترة والتحصيل والشبكة داخل مساحة شركة الإنترنت وحدود صلاحياتها.',
      [
        ['تذاكر مفتوحة', '٣٤', 'في قوائم كل الفروع', 'نشطة', 'primary'],
        ['خطر SLA', '٥', 'الرد خلال ساعة', 'عاجل', 'critical'],
        ['بانتظار المشترك', '١١', 'موعد المتابعة مسجل', 'انتظار', 'warning'],
      ],
      'قائمة الخدمة ذات الأولوية',
      'تبقي كل تذكرة المشترك والمالك والسجل والإجراء التالي معاً.',
      [
        ['TKT-3184 · روان س.', 'خطر SLA', 'خدمة متقطعة · مالك الشبكة', 'critical'],
        ['TKT-3191 · علي م.', 'فوترة', 'دليل تخصيص الإيصال مرفق', 'warning'],
        ['TKT-3172 · داليا ر.', 'انتظار', 'طُلب تأكيد الموعد', 'primary'],
      ],
      [
        ['فتح المشتركين', 'مراجعة الحساب وسجل الخدمة', 'subscribers'],
        ['فتح MikroTik', 'فحص دليل الشبكة والأوامر', 'mikrotik'],
      ],
    ],
    reports: [
      'التحليلات التشغيلية',
      'استخدام تقارير شركة الإنترنت المحكومة',
      'راجع تجميعات الفروع والمستأجر مع فترات وعملات وفلاتر وتصدير محمي صريحة.',
      [
        ['تقارير مجدولة', '٧', 'التشغيل التالي بتوقيت بيروت', 'تعمل', 'positive'],
        ['عروض محفوظة', '١٩', 'محددة للدور الحالي', 'متاحة', 'primary'],
        ['تصديرات جاهزة', '٣', 'نافذة التنزيل محمية', 'تنتهي قريباً', 'warning'],
      ],
      'نشاط التقارير الأخير',
      'تبقى تقارير USD وLBP المالية منفصلة بالكامل.',
      [
        ['إغلاق الصندوق اليومي', 'جاهز', 'قسم USD وقسم LBP · اليوم', 'positive'],
        ['أعمار المشتركين · USD', 'جاهز', 'أُنشئ الساعة ٠٩:١٠', 'positive'],
        ['استثناءات الشبكة', 'مجدول', 'يعمل كل ساعة', 'primary'],
      ],
      [
        ['فتح الفوترة', 'فحص مصدر الفواتير المرحلة', 'billing'],
        ['فتح الإعدادات', 'مراجعة الجداول والاحتفاظ', 'configuration'],
      ],
    ],
    configuration: [
      'حوكمة مساحة العمل',
      'إعداد عمليات شركة الإنترنت',
      'أدر الفروع والأدوار والترقيم وسياسة الفوترة والتكامل والتدقيق داخل حدود المستأجر.',
      [
        ['مستخدمون مفعّلون', '٤٨', 'في أربعة فروع', 'حالي', 'positive'],
        ['تعيينات الأدوار', '٧٦', 'مبنية على كتالوج الصلاحيات', 'مراجعة', 'primary'],
        ['مراجعات مستحقة', '٤', 'تصديق وصول فصلي', 'مستحقة', 'warning'],
      ],
      'مراجعة الإعدادات',
      'تبقى التغييرات عالية الأثر صريحة ومنسوبة وقابلة للتدقيق.',
      [
        ['ترقيم الفواتير', 'حالي', 'HAM-YYYY-sequence', 'positive'],
        ['تكامل MikroTik', 'سليم', 'السر محفوظ كمرجع', 'positive'],
        ['مراجعة الوصول', 'مستحقة', 'أربعة تعيينات تحتاج تصديقاً', 'warning'],
      ],
      [
        ['فتح التقارير', 'مراجعة دليل الحوكمة والتدقيق', 'reports'],
        ['فتح الجباة', 'مراجعة تعيينات الفريق الميداني', 'collectors'],
      ],
    ],
  },
  {
    queue: 'قائمة العمل',
    next: 'متابعة العمل',
    nextDescription: 'افتح سير العمل المرتبط من دون فقدان سياق الفرع.',
  },
);

export const tenantRoutes: Record<Locale, Record<string, TaskRouteDefinition>> = {
  en: english,
  ar: arabic,
};
