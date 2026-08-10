import type { DrilldownItem, Locale, NavigationItem, Tone } from '@isp/ui';

export interface PlatformCopy {
  productName: string;
  brandLabel: string;
  navLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
  skipLabel: string;
  languageLabel: string;
  englishLabel: string;
  arabicLabel: string;
  environment: string;
  contextEyebrow: string;
  contextTitle: string;
  contextMeta: string;
  operatorStatus: string;
  searchLabel: string;
  userLabel: string;
  pageEyebrow: string;
  pageTitle: string;
  pageDescription: string;
  addClient: string;
  recordPayment: string;
  sectionPortfolio: string;
  sectionPortfolioDescription: string;
  drilldownTarget: string;
  filteredBy: string;
  closeDrilldown: string;
  financeTitle: string;
  financeDescription: string;
  operationsTitle: string;
  operationsDescription: string;
  actionsTitle: string;
  actionsDescription: string;
  statesTitle: string;
  statesDescription: string;
  statesLabel: string;
  retry: string;
  requestAccess: string;
  moduleEyebrow: string;
  moduleDescription: string;
  moduleEmptyTitle: string;
  moduleEmptyDescription: string;
  moduleAction: string;
  navigation: NavigationItem[];
  kpis: Array<{
    id: string;
    label: string;
    value: string;
    detail: string;
    trend: string;
    trendLabel: string;
    tone: Tone;
  }>;
  drilldowns: Record<string, { title: string; items: DrilldownItem[] }>;
  lifecycle: Array<{ label: string; value: string; width: string; tone: Tone }>;
  activities: Array<{ title: string; detail: string; time: string; tone: Tone }>;
  quickActions: Array<{ id: string; label: string; description: string }>;
  states: Record<
    'loading' | 'empty' | 'error' | 'denied',
    { label: string; title: string; description: string; action: string }
  >;
}

const english: PlatformCopy = {
  productName: 'Orvex ISP Control Center',
  brandLabel: 'Orvex ISP connection and routing mark',
  navLabel: 'Orvex ISP Control Center navigation',
  menuLabel: 'Open Orvex ISP Control Center navigation',
  closeMenuLabel: 'Close Orvex ISP Control Center navigation',
  skipLabel: 'Skip to Orvex ISP Control Center content',
  languageLabel: 'Interface language',
  englishLabel: 'EN',
  arabicLabel: 'ع',
  environment: 'Demonstration data',
  contextEyebrow: 'Vendor control plane',
  contextTitle: 'Orvex Solutions',
  contextMeta: 'Lebanon portfolio · Demonstration workspace · Asia/Beirut',
  operatorStatus: 'Portfolio view',
  searchLabel: 'Search ISP clients and deployments',
  userLabel: 'Open account menu for Maya Haddad',
  pageEyebrow: 'Portfolio command desk',
  pageTitle: 'A clear view of every ISP client—without crossing the data boundary.',
  pageDescription:
    'Commercial health, renewals, deployments, and support are visible here. Subscriber personal data stays inside each ISP workspace.',
  addClient: 'Add ISP client',
  recordPayment: 'Record payment',
  sectionPortfolio: 'Portfolio pulse',
  sectionPortfolioDescription: 'Each figure opens the exact client or operational list behind it.',
  drilldownTarget: 'Open filtered records',
  filteredBy: 'Active filter',
  closeDrilldown: 'Close filtered records',
  financeTitle: 'Client lifecycle distribution',
  financeDescription: 'Contract states across the current portfolio.',
  operationsTitle: 'Operational timeline',
  operationsDescription: 'Commercial, deployment, and support events in Beirut time.',
  actionsTitle: 'Move work forward',
  actionsDescription: 'Permission-aware starting points for common platform work.',
  statesTitle: 'Resilient interface states',
  statesDescription: 'Every module uses the same calm, actionable response patterns.',
  statesLabel: 'Preview response state',
  retry: 'Try again',
  requestAccess: 'Request access',
  moduleEyebrow: 'Platform module',
  moduleDescription:
    'This protected module is wired into the bilingual shell and ready for its permission-scoped API workflow.',
  moduleEmptyTitle: 'No records match this view yet',
  moduleEmptyDescription:
    'Adjust saved filters or create the first record when your role allows it.',
  moduleAction: 'Create first record',
  navigation: [
    { id: 'overview', label: 'Portfolio overview' },
    { id: 'clients', label: 'ISP clients' },
    { id: 'sales', label: 'Sales pipeline' },
    { id: 'packages', label: 'Packages & add-ons' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'billing', label: 'Billing & payments' },
    { id: 'deployments', label: 'Deployments', badge: '3' },
    { id: 'support', label: 'Support center', badge: '7' },
    { id: 'reports', label: 'Reports' },
    { id: 'administration', label: 'Administration' },
  ],
  kpis: [
    {
      id: 'active',
      label: 'Active ISP clients',
      value: '84',
      detail: 'of 91 demonstration workspaces',
      trend: '+6.3%',
      trendLabel: 'year over year',
      tone: 'positive',
    },
    {
      id: 'mrr',
      label: 'Monthly recurring revenue',
      value: 'USD 31,420',
      detail: 'Posted platform subscriptions',
      trend: '+4.8%',
      trendLabel: 'vs. last month',
      tone: 'primary',
    },
    {
      id: 'renewals',
      label: 'Renewals due in 30 days',
      value: '12',
      detail: 'USD 8,760 expected',
      trend: '4',
      trendLabel: 'need contact this week',
      tone: 'warning',
    },
    {
      id: 'health',
      label: 'Deployment attention',
      value: '3',
      detail: 'SSL, backup, or job health',
      trend: '1',
      trendLabel: 'critical check',
      tone: 'critical',
    },
  ],
  drilldowns: {
    active: {
      title: 'Active ISP clients · status = Active',
      items: [
        {
          label: 'Northline ISP (demo)',
          value: 'Active',
          detail: 'Dedicated hosted · v1.8.4',
          tone: 'positive',
        },
        {
          label: 'Bekaa Link',
          value: 'Active',
          detail: 'Shared hosted · v1.8.4',
          tone: 'positive',
        },
        {
          label: 'Coast Online',
          value: 'Active',
          detail: 'Self-hosted · v1.8.3',
          tone: 'positive',
        },
      ],
    },
    mrr: {
      title: 'Posted subscriptions · August 2026',
      items: [
        { label: 'Dedicated hosted', value: 'USD 16,900', detail: '22 clients', tone: 'primary' },
        { label: 'Shared hosted', value: 'USD 10,740', detail: '51 clients', tone: 'primary' },
        { label: 'Self-hosted support', value: 'USD 3,780', detail: '11 clients', tone: 'primary' },
      ],
    },
    renewals: {
      title: 'Renewal date · next 30 days',
      items: [
        {
          label: 'Metn Fiber',
          value: '9 days',
          detail: 'USD 1,200 · owner contacted',
          tone: 'warning',
        },
        {
          label: 'North Wave',
          value: '16 days',
          detail: 'USD 840 · meeting scheduled',
          tone: 'warning',
        },
        {
          label: 'Chouf Connect',
          value: '24 days',
          detail: 'USD 660 · no activity',
          tone: 'critical',
        },
      ],
    },
    health: {
      title: 'Deployments · attention required',
      items: [
        {
          label: 'Aley Broadband',
          value: 'Backup',
          detail: 'Last success 31 hours ago',
          tone: 'critical',
        },
        { label: 'South Link', value: 'SSL', detail: 'Expires in 12 days', tone: 'warning' },
        {
          label: 'City ISP',
          value: 'Jobs',
          detail: 'Two failed migration prechecks',
          tone: 'warning',
        },
      ],
    },
  },
  lifecycle: [
    { label: 'Active', value: '84', width: '92%', tone: 'positive' },
    { label: 'Trial', value: '5', width: '31%', tone: 'primary' },
    { label: 'Grace', value: '4', width: '25%', tone: 'warning' },
    { label: 'Restricted', value: '2', width: '18%', tone: 'critical' },
  ],
  activities: [
    {
      title: 'Payment allocated',
      detail: 'Bekaa Link · USD 1,200 · receipt PLT-2048',
      time: '10:42',
      tone: 'positive',
    },
    {
      title: 'Deployment precheck failed',
      detail: 'City ISP · database extension mismatch',
      time: '09:18',
      tone: 'critical',
    },
    {
      title: 'Support access approved',
      detail: 'North Wave · ticket SUP-724 · read-only billing',
      time: '08:55',
      tone: 'warning',
    },
    {
      title: 'Package change scheduled',
      detail: 'Northline ISP (demo) · Growth to Scale · next renewal',
      time: 'Yesterday',
      tone: 'primary',
    },
  ],
  quickActions: [
    {
      id: 'clients',
      label: 'Onboard an ISP client',
      description: 'Company, package, deployment, and owner setup',
    },
    {
      id: 'billing',
      label: 'Record a platform payment',
      description: 'Cash, bank, OMT, Whish, or POS',
    },
    {
      id: 'deployments',
      label: 'Review deployment alerts',
      description: 'Backups, SSL, versions, and failed jobs',
    },
    { id: 'support', label: 'Triage SLA risk', description: 'Seven tickets need review' },
  ],
  states: {
    loading: {
      label: 'Loading',
      title: 'Loading protected portfolio data',
      description: 'The current view stays in place while fresh aggregates arrive.',
      action: 'Loading',
    },
    empty: {
      label: 'Empty',
      title: 'No clients match this filter',
      description: 'Clear one or more filters, or save this view for later.',
      action: 'Clear filters',
    },
    error: {
      label: 'Error',
      title: 'Portfolio data could not be refreshed',
      description: 'Nothing was changed. Retry now or use the last successful snapshot.',
      action: 'Try again',
    },
    denied: {
      label: 'Access denied',
      title: 'This view needs a broader platform scope',
      description: 'Your current role can see portfolio health but not commercial amounts.',
      action: 'Request access',
    },
  },
};

const arabic: PlatformCopy = {
  ...english,
  productName: 'مركز تحكم Orvex ISP',
  brandLabel: 'علامة Orvex ISP الهندسية للاتصال والتوجيه',
  navLabel: 'التنقّل في مركز تحكم Orvex ISP',
  menuLabel: 'فتح قائمة مركز تحكم Orvex ISP',
  closeMenuLabel: 'إغلاق قائمة مركز تحكم Orvex ISP',
  skipLabel: 'الانتقال إلى محتوى مركز تحكم Orvex ISP',
  languageLabel: 'لغة الواجهة',
  contextEyebrow: 'طبقة تحكم المزوّد',
  environment: 'بيانات تجريبية',
  contextTitle: 'Orvex Solutions',
  contextMeta: 'محفظة لبنان · مساحة تجريبية · توقيت بيروت',
  operatorStatus: 'عرض المحفظة',
  searchLabel: 'البحث عن شركات الإنترنت وعمليات النشر',
  userLabel: 'فتح قائمة حساب مايا حدّاد',
  pageEyebrow: 'مكتب قيادة المحفظة',
  pageTitle: 'رؤية واضحة لكل شركة إنترنت، من دون تجاوز حدود بياناتها.',
  pageDescription:
    'تظهر هنا الصحة التجارية والتجديدات والنشر والدعم. تبقى بيانات المشتركين الشخصية داخل مساحة عمل كل شركة.',
  addClient: 'إضافة شركة إنترنت',
  recordPayment: 'تسجيل دفعة',
  sectionPortfolio: 'نبض المحفظة',
  sectionPortfolioDescription: 'كل رقم يفتح القائمة المفلترة الدقيقة التي تقف خلفه.',
  drilldownTarget: 'فتح السجلات المفلترة',
  filteredBy: 'عامل التصفية النشط',
  closeDrilldown: 'إغلاق السجلات المفلترة',
  financeTitle: 'توزيع دورة حياة العملاء',
  financeDescription: 'حالات العقود ضمن المحفظة الحالية.',
  operationsTitle: 'السجل التشغيلي',
  operationsDescription: 'الأنشطة التجارية وعمليات النشر والدعم بحسب توقيت بيروت.',
  actionsTitle: 'أنجز العمل التالي',
  actionsDescription: 'نقاط بدء للمهام الشائعة بحسب الصلاحيات.',
  statesTitle: 'حالات واجهة موثوقة',
  statesDescription: 'تستخدم كل الوحدات أنماط استجابة هادئة وقابلة للتنفيذ.',
  statesLabel: 'معاينة حالة الاستجابة',
  retry: 'إعادة المحاولة',
  requestAccess: 'طلب صلاحية',
  moduleEyebrow: 'وحدة في المنصة',
  moduleDescription:
    'هذه الوحدة المحمية موصولة بالهيكل الثنائي اللغة وجاهزة لتدفق API المقيد بالصلاحيات.',
  moduleEmptyTitle: 'لا توجد سجلات تطابق هذا العرض بعد',
  moduleEmptyDescription: 'عدّل عوامل التصفية المحفوظة أو أنشئ أول سجل عندما تسمح صلاحيتك.',
  moduleAction: 'إنشاء أول سجل',
  navigation: [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'clients', label: 'شركات الإنترنت' },
    { id: 'sales', label: 'مسار المبيعات' },
    { id: 'packages', label: 'الباقات والإضافات' },
    { id: 'subscriptions', label: 'الاشتراكات' },
    { id: 'billing', label: 'الفوترة والدفعات' },
    { id: 'deployments', label: 'عمليات النشر', badge: '٣' },
    { id: 'support', label: 'مركز الدعم', badge: '٧' },
    { id: 'reports', label: 'التقارير' },
    { id: 'administration', label: 'الإدارة' },
  ],
  kpis: [
    {
      id: 'active',
      label: 'شركات الإنترنت النشطة',
      value: '٨٤',
      detail: 'من أصل ٩١ مساحة عمل فعّالة',
      trend: '+٦٫٣٪',
      trendLabel: 'مقارنة بالسنة الماضية',
      tone: 'positive',
    },
    {
      id: 'mrr',
      label: 'الإيراد الشهري المتكرر',
      value: 'USD 31,420',
      detail: 'اشتراكات منصة مُرحّلة',
      trend: '+٤٫٨٪',
      trendLabel: 'مقارنة بالشهر الماضي',
      tone: 'primary',
    },
    {
      id: 'renewals',
      label: 'تجديدات خلال ٣٠ يوماً',
      value: '١٢',
      detail: 'USD 8,760 متوقعة',
      trend: '٤',
      trendLabel: 'تحتاج تواصلاً هذا الأسبوع',
      tone: 'warning',
    },
    {
      id: 'health',
      label: 'عمليات نشر تحتاج متابعة',
      value: '٣',
      detail: 'SSL أو نسخ احتياطي أو مهام',
      trend: '١',
      trendLabel: 'فحص حرج',
      tone: 'critical',
    },
  ],
  drilldowns: {
    active: {
      title: 'شركات الإنترنت · الحالة = نشطة',
      items: [
        {
          label: 'شركة نورث لاين التجريبية',
          value: 'نشطة',
          detail: 'استضافة مخصصة · v1.8.4',
          tone: 'positive',
        },
        { label: 'بقاع لينك', value: 'نشطة', detail: 'استضافة مشتركة · v1.8.4', tone: 'positive' },
        {
          label: 'كوست أونلاين',
          value: 'نشطة',
          detail: 'استضافة ذاتية · v1.8.3',
          tone: 'positive',
        },
      ],
    },
    mrr: {
      title: 'الاشتراكات المُرحّلة · آب ٢٠٢٦',
      items: [
        { label: 'استضافة مخصصة', value: 'USD 16,900', detail: '٢٢ عميلاً', tone: 'primary' },
        { label: 'استضافة مشتركة', value: 'USD 10,740', detail: '٥١ عميلاً', tone: 'primary' },
        {
          label: 'دعم الاستضافة الذاتية',
          value: 'USD 3,780',
          detail: '١١ عميلاً',
          tone: 'primary',
        },
      ],
    },
    renewals: {
      title: 'تاريخ التجديد · خلال ٣٠ يوماً',
      items: [
        { label: 'متن فايبر', value: '٩ أيام', detail: 'USD 1,200 · تم التواصل', tone: 'warning' },
        { label: 'نورث ويف', value: '١٦ يوماً', detail: 'USD 840 · اجتماع محدد', tone: 'warning' },
        { label: 'شوف كونيكت', value: '٢٤ يوماً', detail: 'USD 660 · لا نشاط', tone: 'critical' },
      ],
    },
    health: {
      title: 'عمليات النشر · تحتاج متابعة',
      items: [
        {
          label: 'عاليه برودباند',
          value: 'نسخ احتياطي',
          detail: 'آخر نجاح منذ ٣١ ساعة',
          tone: 'critical',
        },
        { label: 'ساوث لينك', value: 'SSL', detail: 'تنتهي خلال ١٢ يوماً', tone: 'warning' },
        { label: 'سيتي ISP', value: 'مهام', detail: 'فشلان في فحص الترحيل', tone: 'warning' },
      ],
    },
  },
  lifecycle: [
    { label: 'نشطة', value: '٨٤', width: '92%', tone: 'positive' },
    { label: 'تجريبية', value: '٥', width: '31%', tone: 'primary' },
    { label: 'مهلة', value: '٤', width: '25%', tone: 'warning' },
    { label: 'مقيّدة', value: '٢', width: '18%', tone: 'critical' },
  ],
  activities: [
    {
      title: 'تخصيص دفعة',
      detail: 'بقاع لينك · USD 1,200 · إيصال PLT-2048',
      time: '١٠:٤٢',
      tone: 'positive',
    },
    {
      title: 'فشل فحص النشر',
      detail: 'سيتي ISP · عدم تطابق إضافة قاعدة البيانات',
      time: '٠٩:١٨',
      tone: 'critical',
    },
    {
      title: 'الموافقة على وصول الدعم',
      detail: 'نورث ويف · تذكرة SUP-724 · قراءة الفوترة فقط',
      time: '٠٨:٥٥',
      tone: 'warning',
    },
    {
      title: 'جدولة تغيير الباقة',
      detail: 'شركة نورث لاين التجريبية · Growth إلى Scale · عند التجديد',
      time: 'أمس',
      tone: 'primary',
    },
  ],
  quickActions: [
    {
      id: 'clients',
      label: 'إعداد شركة إنترنت',
      description: 'الشركة والباقة والنشر وحساب المالك',
    },
    {
      id: 'billing',
      label: 'تسجيل دفعة للمنصة',
      description: 'نقد أو تحويل أو OMT أو Whish أو POS',
    },
    {
      id: 'deployments',
      label: 'مراجعة تنبيهات النشر',
      description: 'النسخ وSSL والإصدارات والمهام الفاشلة',
    },
    { id: 'support', label: 'فرز مخاطر SLA', description: 'سبع تذاكر تحتاج مراجعة' },
  ],
  states: {
    loading: {
      label: 'تحميل',
      title: 'جارٍ تحميل بيانات المحفظة المحمية',
      description: 'يبقى العرض الحالي مكانه أثناء وصول الملخصات الجديدة.',
      action: 'جارٍ التحميل',
    },
    empty: {
      label: 'فارغ',
      title: 'لا يوجد عملاء يطابقون هذا الفلتر',
      description: 'أزل بعض عوامل التصفية أو احفظ هذا العرض لوقت لاحق.',
      action: 'مسح الفلاتر',
    },
    error: {
      label: 'خطأ',
      title: 'تعذّر تحديث بيانات المحفظة',
      description: 'لم يتغيّر شيء. أعد المحاولة أو استخدم آخر نسخة ناجحة.',
      action: 'إعادة المحاولة',
    },
    denied: {
      label: 'وصول مرفوض',
      title: 'هذا العرض يحتاج صلاحية أوسع',
      description: 'يمكن لدورك رؤية صحة المحفظة من دون المبالغ التجارية.',
      action: 'طلب صلاحية',
    },
  },
};

export const platformCopy: Record<Locale, PlatformCopy> = { en: english, ar: arabic };
