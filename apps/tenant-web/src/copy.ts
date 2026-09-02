import type { DrilldownItem, Locale, NavigationItem, Tone } from '@isp/ui';

export interface TenantCopy {
  productName: string;
  brandLabel: string;
  navLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
  skipLabel: string;
  languageLabel: string;
  englishLabel: string;
  arabicLabel: string;
  contextEyebrow: string;
  contextTitle: string;
  contextMeta: string;
  branchStatus: string;
  searchLabel: string;
  userLabel: string;
  pageEyebrow: string;
  pageTitle: string;
  pageDescription: string;
  addSubscriber: string;
  recordPayment: string;
  sectionToday: string;
  sectionTodayDescription: string;
  drilldownTarget: string;
  filteredBy: string;
  closeDrilldown: string;
  collectionTitle: string;
  collectionDescription: string;
  actionsTitle: string;
  actionsDescription: string;
  operationsTitle: string;
  operationsDescription: string;
  statesTitle: string;
  statesDescription: string;
  statesLabel: string;
  dataStatus: string;
  moduleEyebrow: string;
  moduleDescription: string;
  moduleEmptyTitle: string;
  moduleEmptyDescription: string;
  moduleAction: string;
  navigation: NavigationItem[];
  kpis: Array<{
    id: string;
    label: string;
    value: string | { usd: string; lbp: string };
    detail: string;
    trend: string;
    trendLabel: string;
    tone: Tone;
  }>;
  drilldowns: Record<string, { title: string; items: DrilldownItem[] }>;
  collectionRows: Array<{ label: string; amount: string; progress: string; tone: Tone }>;
  activities: Array<{ title: string; detail: string; time: string; tone: Tone }>;
  quickActions: Array<{ id: string; label: string; description: string }>;
  states: Record<
    'loading' | 'empty' | 'error' | 'denied',
    { label: string; title: string; description: string; action: string }
  >;
  support: {
    title: string;
    description: string;
    ticketLabel: string;
    ticket: string;
    scopeLabel: string;
    scope: string;
    expiresLabel: string;
    expires: string;
    auditLabel: string;
    endLabel: string;
  };
}

const english: TenantCopy = {
  productName: 'Orvex ISP Operations',
  brandLabel: 'Orvex ISP connection and routing mark',
  navLabel: 'Orvex ISP Operations navigation',
  menuLabel: 'Open Orvex ISP Operations navigation',
  closeMenuLabel: 'Close Orvex ISP Operations navigation',
  skipLabel: 'Skip to Orvex ISP Operations content',
  languageLabel: 'Interface language',
  englishLabel: 'EN',
  arabicLabel: 'ع',
  contextEyebrow: 'ISP workspace · Demonstration data',
  contextTitle: 'Northline ISP (demo)',
  contextMeta: 'Hamra branch · Demonstration data · Finance & operations',
  branchStatus: 'Hamra branch',
  searchLabel: 'Search subscribers, invoices, or receipts',
  userLabel: 'Open account menu for Rami Khalil',
  pageEyebrow: 'Sunday · 9 August 2026',
  pageTitle: 'Collections, subscriber service, and network work—ready for the morning shift.',
  pageDescription:
    'USD and LBP stay separate. Network status and cash collection use the same permission-scoped demonstration workspace.',
  addSubscriber: 'Add subscriber',
  recordPayment: 'Record payment',
  sectionToday: "Today's operating picture",
  sectionTodayDescription:
    'Open any card to work from the exact subscriber, payment, or job list behind it.',
  drilldownTarget: 'Open filtered operational records',
  filteredBy: 'Active filter',
  closeDrilldown: 'Close filtered operational records',
  collectionTitle: 'Collection pace by channel',
  collectionDescription: 'Posted amounts only; currencies are never combined.',
  actionsTitle: 'Shift shortcuts',
  actionsDescription: 'Fast entry points for the most common office work.',
  operationsTitle: 'Recent operational activity',
  operationsDescription: 'Financial and network events with an auditable source.',
  statesTitle: 'Complete workflow states',
  statesDescription:
    'Teams always get a next step when data is delayed, missing, failed, or restricted.',
  statesLabel: 'Preview response state',
  dataStatus: 'Demonstration data',
  moduleEyebrow: 'ISP operations module',
  moduleDescription:
    'The bilingual module shell is ready for branch-scoped permissions, API data, saved filters, and audit history.',
  moduleEmptyTitle: 'Nothing is waiting in this view',
  moduleEmptyDescription:
    'Change the branch or saved filters, or begin a new record if your role allows it.',
  moduleAction: 'Start a new record',
  navigation: [
    { id: 'dashboard', label: 'Operations dashboard' },
    { id: 'sales', label: 'Sales & orders' },
    { id: 'subscribers', label: 'Subscribers' },
    { id: 'billing', label: 'Billing & invoices' },
    { id: 'accounting', label: 'Accounting & ledger' },
    { id: 'payments', label: 'Payments & cashier' },
    { id: 'collectors', label: 'Collectors', badge: '2' },
    { id: 'mikrotik', label: 'MikroTik network', badge: '3' },
    { id: 'noc', label: 'NOC incidents' },
    { id: 'installations', label: 'Installations' },
    { id: 'support', label: 'Internal support' },
    { id: 'reports', label: 'Reports' },
    { id: 'staff', label: 'Staff & access' },
    { id: 'configuration', label: 'Configuration' },
  ],
  kpis: [
    {
      id: 'collections',
      label: "Today's collections",
      value: { usd: '4,280.00', lbp: '186,750,000' },
      detail: 'Office + 6 active collectors',
      trend: '68%',
      trendLabel: 'of today’s route target',
      tone: 'positive',
    },
    {
      id: 'due',
      label: 'Subscribers due today',
      value: '146',
      detail: '52 on collector routes',
      trend: '27',
      trendLabel: 'promises due today',
      tone: 'warning',
    },
    {
      id: 'online',
      label: 'Subscribers online now',
      value: '3,842',
      detail: '4,106 active services',
      trend: '93.6%',
      trendLabel: 'currently online',
      tone: 'primary',
    },
    {
      id: 'jobs',
      label: 'Failed operational jobs',
      value: '3',
      detail: 'Billing, sync, and MikroTik',
      trend: '2',
      trendLabel: 'safe to retry',
      tone: 'critical',
    },
  ],
  drilldowns: {
    collections: {
      title: 'Payments · posted today · Hamra branch',
      items: [
        {
          label: 'Office cashier',
          value: 'USD 1,940',
          detail: 'LBP 48,500,000 · 71 receipts',
          tone: 'positive',
        },
        {
          label: 'Collector routes',
          value: 'USD 2,340',
          detail: 'LBP 138,250,000 · 126 receipts',
          tone: 'positive',
        },
        {
          label: 'OMT / Whish',
          value: '18 refs',
          detail: '3 awaiting proof verification',
          tone: 'warning',
        },
      ],
    },
    due: {
      title: 'Subscribers · renewal date = today',
      items: [
        {
          label: 'Hamra North route',
          value: '38 due',
          detail: 'Collector: Hadi · 21 remaining',
          tone: 'warning',
        },
        {
          label: 'Ras Beirut route',
          value: '31 due',
          detail: 'Collector: Noor · 12 remaining',
          tone: 'warning',
        },
        {
          label: 'Office / unassigned',
          value: '77 due',
          detail: '27 promises recorded',
          tone: 'primary',
        },
      ],
    },
    online: {
      title: 'Internet services · operational status',
      items: [
        { label: 'Online', value: '3,842', detail: 'Updated 34 seconds ago', tone: 'positive' },
        { label: 'Offline', value: '264', detail: '18 changed in the last hour', tone: 'warning' },
        {
          label: 'Routers reporting',
          value: '12 / 12',
          detail: 'All connectors healthy',
          tone: 'positive',
        },
      ],
    },
    jobs: {
      title: 'Jobs · status = failed',
      items: [
        {
          label: 'MikroTik profile change',
          value: 'Retry safe',
          detail: 'Subscriber CN-1842 · known timeout',
          tone: 'warning',
        },
        {
          label: 'Collector sync batch',
          value: 'Review',
          detail: 'One receipt number conflict',
          tone: 'critical',
        },
        {
          label: 'Billing run',
          value: 'Retry safe',
          detail: 'Two records failed validation',
          tone: 'warning',
        },
      ],
    },
  },
  collectionRows: [
    { label: 'Office cash · USD', amount: 'USD 1,940.00', progress: '61%', tone: 'positive' },
    { label: 'Collector cash · USD', amount: 'USD 2,340.00', progress: '74%', tone: 'primary' },
    { label: 'Office cash · LBP', amount: 'LBP 48,500,000', progress: '54%', tone: 'warning' },
    { label: 'Collector cash · LBP', amount: 'LBP 138,250,000', progress: '81%', tone: 'positive' },
  ],
  activities: [
    {
      title: 'Payment posted',
      detail: 'CN-2084 · USD 30.00 · cash · RCPT-82019',
      time: '10:47',
      tone: 'positive',
    },
    {
      title: 'Subscriber restored',
      detail: 'CN-1842 · MikroTik job confirmed desired state',
      time: '10:43',
      tone: 'primary',
    },
    {
      title: 'Collector sync conflict',
      detail: 'Route H-04 · local receipt number already used',
      time: '10:31',
      tone: 'critical',
    },
    {
      title: 'Installation completed',
      detail: 'CN-4110 · ONU recorded · activation handoff ready',
      time: '10:05',
      tone: 'warning',
    },
  ],
  quickActions: [
    {
      id: 'subscribers',
      label: 'Add a subscriber',
      description: 'Identity, address, package, and activation',
    },
    {
      id: 'payments',
      label: 'Record an office payment',
      description: 'Allocate, post, and print a receipt',
    },
    {
      id: 'billing',
      label: 'Preview bulk invoices',
      description: 'Validate first, then post asynchronously',
    },
    {
      id: 'collectors',
      label: 'Reconcile collectors',
      description: 'Expected and declared totals per currency',
    },
  ],
  states: {
    loading: {
      label: 'Loading',
      title: 'Refreshing branch operations',
      description: 'The saved view stays intact while payments and network aggregates update.',
      action: 'Loading',
    },
    empty: {
      label: 'Empty',
      title: 'No subscribers match these filters',
      description: 'Clear a filter or switch branch. Your saved view has not been changed.',
      action: 'Clear filters',
    },
    error: {
      label: 'Error',
      title: 'Operational data could not be refreshed',
      description:
        'Posted payments remain safe. Retry the read without repeating any financial action.',
      action: 'Try again',
    },
    denied: {
      label: 'Access denied',
      title: 'This branch is outside your current scope',
      description: 'Ask an ISP administrator for the smallest branch permission needed.',
      action: 'Request access',
    },
  },
  support: {
    title: 'Demonstration support banner',
    description:
      'Example only. No live support grant or audit record is connected to this demonstration workspace.',
    ticketLabel: 'Ticket',
    ticket: 'SUP-724',
    scopeLabel: 'Scope',
    scope: 'Billing configuration · read only',
    expiresLabel: 'Expires',
    expires: '11:30 Beirut',
    auditLabel: 'Not active',
    endLabel: 'Hide example',
  },
};

const arabic: TenantCopy = {
  ...english,
  productName: 'عمليات Orvex ISP',
  brandLabel: 'علامة Orvex ISP الهندسية للاتصال والتوجيه',
  navLabel: 'التنقّل في عمليات Orvex ISP',
  menuLabel: 'فتح قائمة عمليات Orvex ISP',
  closeMenuLabel: 'إغلاق قائمة عمليات Orvex ISP',
  skipLabel: 'الانتقال إلى محتوى عمليات Orvex ISP',
  languageLabel: 'لغة الواجهة',
  contextEyebrow: 'مساحة شركة الإنترنت · بيانات تجريبية',
  contextTitle: 'شركة نورث لاين التجريبية',
  contextMeta: 'فرع الحمرا · بيانات تجريبية · المالية والعمليات',
  branchStatus: 'فرع الحمرا',
  searchLabel: 'البحث عن مشترك أو فاتورة أو إيصال',
  userLabel: 'فتح قائمة حساب رامي خليل',
  pageEyebrow: 'الأحد · ٩ آب ٢٠٢٦',
  pageTitle: 'التحصيل وخدمة المشتركين وعمل الشبكة جاهزة للوردية الصباحية.',
  pageDescription:
    'تبقى USD وLBP منفصلتين. حالة الشبكة والتحصيل النقدي ضمن مساحة واحدة مقيّدة بالصلاحيات.',
  addSubscriber: 'إضافة مشترك',
  recordPayment: 'تسجيل دفعة',
  sectionToday: 'صورة العمليات اليوم',
  sectionTodayDescription:
    'افتح أي بطاقة للوصول إلى قائمة المشتركين أو الدفعات أو المهام التي تقف خلفها.',
  drilldownTarget: 'فتح السجلات التشغيلية المفلترة',
  filteredBy: 'عامل التصفية النشط',
  closeDrilldown: 'إغلاق السجلات التشغيلية',
  collectionTitle: 'وتيرة التحصيل بحسب القناة',
  collectionDescription: 'المبالغ المُرحّلة فقط؛ لا يتم جمع العملات معاً.',
  actionsTitle: 'اختصارات الوردية',
  actionsDescription: 'مداخل سريعة لأكثر مهام المكتب تكراراً.',
  operationsTitle: 'آخر النشاطات التشغيلية',
  operationsDescription: 'أحداث مالية وشبكية مع مصدر قابل للتدقيق.',
  statesTitle: 'حالات سير عمل مكتملة',
  statesDescription:
    'يحصل الفريق دائماً على خطوة تالية عند التأخير أو الفراغ أو الفشل أو منع الوصول.',
  statesLabel: 'معاينة حالة الاستجابة',
  dataStatus: 'بيانات تجريبية',
  moduleEyebrow: 'وحدة عمليات شركة الإنترنت',
  moduleDescription:
    'هيكل الوحدة الثنائي اللغة جاهز لصلاحيات الفروع وبيانات API والفلاتر المحفوظة وسجل التدقيق.',
  moduleEmptyTitle: 'لا يوجد عمل ينتظر في هذا العرض',
  moduleEmptyDescription: 'غيّر الفرع أو الفلاتر المحفوظة، أو ابدأ سجلاً جديداً إذا سمح دورك.',
  moduleAction: 'بدء سجل جديد',
  navigation: [
    { id: 'dashboard', label: 'لوحة العمليات' },
    { id: 'sales', label: 'المبيعات والطلبات' },
    { id: 'subscribers', label: 'المشتركون' },
    { id: 'billing', label: 'الفوترة والفواتير' },
    { id: 'accounting', label: 'المحاسبة والدفتر العام' },
    { id: 'payments', label: 'الدفعات والصندوق' },
    { id: 'collectors', label: 'الجباة', badge: '٢' },
    { id: 'mikrotik', label: 'شبكة MikroTik', badge: '٣' },
    { id: 'noc', label: 'حوادث الشبكة' },
    { id: 'installations', label: 'التركيبات' },
    { id: 'support', label: 'الدعم الداخلي' },
    { id: 'reports', label: 'التقارير' },
    { id: 'staff', label: 'الفريق والصلاحيات' },
    { id: 'configuration', label: 'الإعدادات' },
  ],
  kpis: [
    {
      id: 'collections',
      label: 'تحصيل اليوم',
      value: { usd: '4,280.00', lbp: '186,750,000' },
      detail: 'المكتب + ٦ جباة نشطين',
      trend: '٦٨٪',
      trendLabel: 'من هدف مسارات اليوم',
      tone: 'positive',
    },
    {
      id: 'due',
      label: 'مشتركون مستحقون اليوم',
      value: '١٤٦',
      detail: '٥٢ على مسارات الجباة',
      trend: '٢٧',
      trendLabel: 'وعود دفع مستحقة اليوم',
      tone: 'warning',
    },
    {
      id: 'online',
      label: 'مشتركون متصلون الآن',
      value: '٣٬٨٤٢',
      detail: 'من أصل ٤٬١٠٦ خدمات نشطة',
      trend: '٩٣٫٦٪',
      trendLabel: 'متصلون حالياً',
      tone: 'primary',
    },
    {
      id: 'jobs',
      label: 'مهام تشغيلية فاشلة',
      value: '٣',
      detail: 'فوترة ومزامنة وMikroTik',
      trend: '٢',
      trendLabel: 'آمنة لإعادة المحاولة',
      tone: 'critical',
    },
  ],
  drilldowns: {
    collections: {
      title: 'الدفعات · مُرحّلة اليوم · فرع الحمرا',
      items: [
        {
          label: 'صندوق المكتب',
          value: 'USD 1,940',
          detail: 'LBP 48,500,000 · ٧١ إيصالاً',
          tone: 'positive',
        },
        {
          label: 'مسارات الجباة',
          value: 'USD 2,340',
          detail: 'LBP 138,250,000 · ١٢٦ إيصالاً',
          tone: 'positive',
        },
        {
          label: 'OMT / Whish',
          value: '١٨ مرجعاً',
          detail: '٣ تنتظر التحقق من الإثبات',
          tone: 'warning',
        },
      ],
    },
    due: {
      title: 'المشتركون · تاريخ التجديد = اليوم',
      items: [
        {
          label: 'مسار الحمرا الشمالي',
          value: '٣٨ مستحقاً',
          detail: 'الجابي: هادي · بقي ٢١',
          tone: 'warning',
        },
        {
          label: 'مسار رأس بيروت',
          value: '٣١ مستحقاً',
          detail: 'الجابية: نور · بقي ١٢',
          tone: 'warning',
        },
        {
          label: 'المكتب / بلا تعيين',
          value: '٧٧ مستحقاً',
          detail: '٢٧ وعد دفع مسجلاً',
          tone: 'primary',
        },
      ],
    },
    online: {
      title: 'خدمات الإنترنت · الحالة التشغيلية',
      items: [
        { label: 'متصل', value: '٣٬٨٤٢', detail: 'آخر تحديث منذ ٣٤ ثانية', tone: 'positive' },
        {
          label: 'غير متصل',
          value: '٢٦٤',
          detail: '١٨ تغيروا خلال الساعة الأخيرة',
          tone: 'warning',
        },
        {
          label: 'موجّهات ترسل بيانات',
          value: '12 / 12',
          detail: 'كل الموصلات سليمة',
          tone: 'positive',
        },
      ],
    },
    jobs: {
      title: 'المهام · الحالة = فاشلة',
      items: [
        {
          label: 'تغيير ملف MikroTik',
          value: 'إعادة آمنة',
          detail: 'المشترك CN-1842 · مهلة معروفة',
          tone: 'warning',
        },
        {
          label: 'دفعة مزامنة الجابي',
          value: 'مراجعة',
          detail: 'تعارض واحد في رقم إيصال',
          tone: 'critical',
        },
        {
          label: 'تشغيل الفوترة',
          value: 'إعادة آمنة',
          detail: 'سجلان فشلا في التحقق',
          tone: 'warning',
        },
      ],
    },
  },
  collectionRows: [
    { label: 'نقد المكتب · USD', amount: 'USD 1,940.00', progress: '61%', tone: 'positive' },
    { label: 'نقد الجباة · USD', amount: 'USD 2,340.00', progress: '74%', tone: 'primary' },
    { label: 'نقد المكتب · LBP', amount: 'LBP 48,500,000', progress: '54%', tone: 'warning' },
    { label: 'نقد الجباة · LBP', amount: 'LBP 138,250,000', progress: '81%', tone: 'positive' },
  ],
  activities: [
    {
      title: 'ترحيل دفعة',
      detail: 'CN-2084 · USD 30.00 · نقد · RCPT-82019',
      time: '١٠:٤٧',
      tone: 'positive',
    },
    {
      title: 'إعادة خدمة مشترك',
      detail: 'CN-1842 · مهمة MikroTik أكدت الحالة المطلوبة',
      time: '١٠:٤٣',
      tone: 'primary',
    },
    {
      title: 'تعارض مزامنة جابٍ',
      detail: 'المسار H-04 · رقم الإيصال المحلي مستخدم',
      time: '١٠:٣١',
      tone: 'critical',
    },
    {
      title: 'اكتمال تركيب',
      detail: 'CN-4110 · سُجل ONU · جاهز لتسليم التفعيل',
      time: '١٠:٠٥',
      tone: 'warning',
    },
  ],
  quickActions: [
    { id: 'subscribers', label: 'إضافة مشترك', description: 'الهوية والعنوان والباقة والتفعيل' },
    { id: 'payments', label: 'تسجيل دفعة مكتبية', description: 'تخصيص وترحيل وطباعة الإيصال' },
    {
      id: 'billing',
      label: 'معاينة فواتير جماعية',
      description: 'التحقق أولاً ثم الترحيل في الخلفية',
    },
    {
      id: 'collectors',
      label: 'مطابقة حسابات الجباة',
      description: 'المتوقع والمصرّح به لكل عملة',
    },
  ],
  states: {
    loading: {
      label: 'تحميل',
      title: 'جارٍ تحديث عمليات الفرع',
      description: 'يبقى العرض المحفوظ كما هو أثناء تحديث الدفعات وملخصات الشبكة.',
      action: 'جارٍ التحميل',
    },
    empty: {
      label: 'فارغ',
      title: 'لا يوجد مشتركون يطابقون هذه الفلاتر',
      description: 'أزل فلترًا أو غيّر الفرع. لم يتغير عرضك المحفوظ.',
      action: 'مسح الفلاتر',
    },
    error: {
      label: 'خطأ',
      title: 'تعذّر تحديث البيانات التشغيلية',
      description: 'الدفعات المُرحّلة آمنة. أعد قراءة البيانات من دون تكرار أي إجراء مالي.',
      action: 'إعادة المحاولة',
    },
    denied: {
      label: 'وصول مرفوض',
      title: 'هذا الفرع خارج نطاق صلاحيتك',
      description: 'اطلب من مدير الشركة أصغر صلاحية لازمة لهذا الفرع.',
      action: 'طلب صلاحية',
    },
  },
  support: {
    title: 'مثال توضيحي لشريط جلسة الدعم',
    description:
      'هذا مثال فقط. لا توجد منحة دعم نشطة أو سجلات تدقيق مرتبطة بمساحة العمل التجريبية.',
    ticketLabel: 'التذكرة',
    ticket: 'SUP-724',
    scopeLabel: 'النطاق',
    scope: 'إعدادات الفوترة · قراءة فقط',
    expiresLabel: 'تنتهي',
    expires: '١١:٣٠ بتوقيت بيروت',
    auditLabel: 'غير نشطة',
    endLabel: 'إخفاء المثال',
  },
};

export const tenantCopy: Record<Locale, TenantCopy> = { en: english, ar: arabic };
