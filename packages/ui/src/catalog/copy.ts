import type { Locale, Tone } from '../types';

export interface CatalogCopy {
  documentTitle: string;
  skipLabel: string;
  localeLabel: string;
  englishLabel: string;
  arabicLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  fixtureDisclosure: string;
  navigationLabel: string;
  sections: Array<{ id: CatalogSectionId; label: string }>;
  navigation: {
    title: string;
    description: string;
    activeLabel: string;
    queueLabel: string;
    reportsLabel: string;
  };
  records: {
    title: string;
    description: string;
    tableCaption: string;
    columnAccount: string;
    columnStatus: string;
    columnBalance: string;
    columnAction: string;
    openLabel: string;
    openedFeedback: string;
    mobileLabel: string;
    rows: CatalogRecord[];
  };
  signals: {
    title: string;
    description: string;
    calloutTitle: string;
    calloutDescription: string;
    statuses: Array<{ label: string; tone: Tone }>;
  };
  approval: {
    title: string;
    description: string;
    supportTitle: string;
    supportDescription: string;
    ticketLabel: string;
    ticket: string;
    scopeLabel: string;
    scope: string;
    expiresLabel: string;
    expires: string;
    auditLabel: string;
    endLabel: string;
    unavailableLabel: string;
    cardTitle: string;
    impactLabel: string;
    impact: string;
    reasonLabel: string;
    reason: string;
    approvalLabel: string;
    approvalState: string;
    approveLabel: string;
    approveUnavailableReason: string;
    permissionTitle: string;
    permissionDescription: string;
    requiredScopeLabel: string;
    requiredScope: string;
  };
  audit: {
    title: string;
    description: string;
    actorLabel: string;
    referenceLabel: string;
    outcomeLabel: string;
    items: Array<{
      title: string;
      actor: string;
      reference: string;
      outcome: string;
      time: string;
      timeZone: string;
      tone: Tone;
    }>;
  };
  states: {
    title: string;
    description: string;
    loadingTitle: string;
    loadingDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
    emptyFeedback: string;
    errorTitle: string;
    errorDescription: string;
    errorAction: string;
    errorFeedback: string;
    deniedTitle: string;
    deniedDescription: string;
    deniedAction: string;
    deniedUnavailableReason: string;
    requiredScopeLabel: string;
    requiredScope: string;
  };
  behavior: {
    title: string;
    description: string;
    keyboardTitle: string;
    keyboardDescription: string;
    focusLabel: string;
    motionTitle: string;
    motionDescription: string;
  };
}

export type CatalogSectionId =
  | 'navigation'
  | 'records'
  | 'signals'
  | 'approval'
  | 'audit'
  | 'states'
  | 'behavior';

export interface CatalogRecord {
  id: string;
  account: string;
  reference: string;
  status: string;
  tone: Tone;
  usd: string;
  lbp: string;
}

export const catalogCopy: Record<Locale, CatalogCopy> = {
  en: {
    documentTitle: 'Orvex ISP component catalog',
    skipLabel: 'Skip to component examples',
    localeLabel: 'Catalog language',
    englishLabel: 'English',
    arabicLabel: 'Arabic',
    eyebrow: 'Phase B reference',
    title: 'Operations component catalog',
    description: 'A bilingual reference for dense finance, support, approval, and audit workflows.',
    fixtureDisclosure:
      'Reference fixtures only — no live tenant, permission, finance, or audit data is shown.',
    navigationLabel: 'Catalog sections',
    sections: [
      { id: 'navigation', label: 'Navigation' },
      { id: 'records', label: 'Records' },
      { id: 'signals', label: 'Status and callout' },
      { id: 'approval', label: 'Approval and support' },
      { id: 'audit', label: 'Audit timeline' },
      { id: 'states', label: 'Operational states' },
      { id: 'behavior', label: 'Keyboard and motion' },
    ],
    navigation: {
      title: 'Task navigation',
      description: 'The active task is named in text and exposed with the current-page state.',
      activeLabel: 'Collections',
      queueLabel: 'Approval queue',
      reportsLabel: 'Reports',
    },
    records: {
      title: 'Data table and compact list',
      description:
        'The table keeps headers and a caption; the narrow layout becomes a labelled record list.',
      tableCaption: 'Reference collection accounts and separate currency balances',
      columnAccount: 'Account',
      columnStatus: 'Status',
      columnBalance: 'Balance',
      columnAction: 'Action',
      openLabel: 'Open reference record',
      openedFeedback: 'Opened reference record',
      mobileLabel: 'Reference collection accounts',
      rows: [
        {
          id: 'REF-1042',
          account: 'Reference account A',
          reference: 'REF-1042',
          status: 'Review needed',
          tone: 'warning',
          usd: '128.00',
          lbp: '4,250,000',
        },
        {
          id: 'REF-1088',
          account: 'Reference account B',
          reference: 'REF-1088',
          status: 'Reconciled',
          tone: 'positive',
          usd: '72.50',
          lbp: '0',
        },
      ],
    },
    signals: {
      title: 'Status and callout',
      description: 'Every tone includes words; color is supporting information only.',
      calloutTitle: 'Reference data is intentionally non-operational',
      calloutDescription:
        'Actions in this catalog demonstrate component behavior and do not send or approve work.',
      statuses: [
        { label: 'Informational', tone: 'primary' },
        { label: 'Complete', tone: 'positive' },
        { label: 'Needs attention', tone: 'warning' },
        { label: 'Critical', tone: 'critical' },
        { label: 'Not started', tone: 'neutral' },
      ],
    },
    approval: {
      title: 'Approval and support context',
      description:
        'Sensitive work keeps impact, reason, approval state, scope, expiry, and audit context visible.',
      supportTitle: 'Reference support session — not active',
      supportDescription: 'Demonstrates the persistent context required during scoped support.',
      ticketLabel: 'Ticket',
      ticket: 'CATALOG-DEMO',
      scopeLabel: 'Scope',
      scope: 'Read-only component preview',
      expiresLabel: 'Expiry',
      expires: 'Reference only',
      auditLabel: 'Audit example',
      endLabel: 'End example',
      unavailableLabel: 'Unavailable in the reference catalog',
      cardTitle: 'High-impact action review',
      impactLabel: 'Impact',
      impact: 'Would affect one selected reference record.',
      reasonLabel: 'Reason',
      reason: 'Component-catalog interaction review.',
      approvalLabel: 'Approval state',
      approvalState: 'Approval required',
      approveLabel: 'Preview approval action',
      approveUnavailableReason: 'Approval is disabled because this catalog cannot approve work.',
      permissionTitle: 'Permission is required',
      permissionDescription:
        'The example account lacks the required approval permission. Request the smallest required scope.',
      requiredScopeLabel: 'Required scope',
      requiredScope: 'finance.approve',
    },
    audit: {
      title: 'Audit timeline',
      description:
        'Ordered events retain an actor, action, outcome, reference, and explicit Beirut time.',
      actorLabel: 'Actor',
      referenceLabel: 'Reference',
      outcomeLabel: 'Outcome',
      items: [
        {
          title: 'Review opened',
          actor: 'Reference actor',
          reference: 'REF-1042',
          outcome: 'read-only example',
          time: '09:10',
          timeZone: 'Asia/Beirut',
          tone: 'primary',
        },
        {
          title: 'Approval requested',
          actor: 'Reference workflow',
          reference: 'APV-DEMO',
          outcome: 'pending example',
          time: '09:14',
          timeZone: 'Asia/Beirut',
          tone: 'warning',
        },
        {
          title: 'Evidence recorded',
          actor: 'Catalog fixture',
          reference: 'AUD-DEMO',
          outcome: 'complete example',
          time: '09:18',
          timeZone: 'Asia/Beirut',
          tone: 'positive',
        },
      ],
    },
    states: {
      title: 'Loading, empty, error, and permission states',
      description:
        'Each state explains what is known, what remained safe, and the next safe action.',
      loadingTitle: 'Loading reference records',
      loadingDescription: 'Current filters and navigation remain available.',
      emptyTitle: 'No records match this reference filter',
      emptyDescription: 'Clear the fixture filter to return to the complete example list.',
      emptyAction: 'Clear example filter',
      emptyFeedback: 'The example filter was cleared. No production data changed.',
      errorTitle: 'Reference records could not be read',
      errorDescription: 'No write was attempted. It is safe to retry this read-only example.',
      errorAction: 'Retry example read',
      errorFeedback: 'The read-only example retry completed. No request was sent.',
      deniedTitle: 'Access to this action is denied',
      deniedDescription:
        'The required approval permission is unavailable. The record remains unchanged in this example.',
      deniedAction: 'View escalation guidance',
      deniedUnavailableReason:
        'Escalation is disabled because the catalog does not open support requests.',
      requiredScopeLabel: 'Required scope',
      requiredScope: 'finance.approve',
    },
    behavior: {
      title: 'Keyboard, focus, and reduced motion',
      description:
        'Native controls follow task order, the skip link reaches the examples, and focus remains visible.',
      keyboardTitle: 'Keyboard contract',
      keyboardDescription:
        'Keyboard navigation reaches locale, section links, record actions, and state actions in document order. Native controls retain their standard activation behavior.',
      focusLabel: 'Move focus to the catalog heading',
      motionTitle: 'Reduced-motion contract',
      motionDescription:
        'When reduced motion is requested, catalog transitions and shared loading animation complete without sustained movement.',
    },
  },
  ar: {
    documentTitle: 'دليل مكوّنات أورفكس لمزوّد الإنترنت',
    skipLabel: 'انتقل إلى أمثلة المكوّنات',
    localeLabel: 'لغة الدليل',
    englishLabel: 'English',
    arabicLabel: 'العربية',
    eyebrow: 'مرجع المرحلة ب',
    title: 'دليل مكوّنات العمليات',
    description: 'مرجع ثنائي اللغة لواجهات المال والدعم والموافقات والتدقيق الكثيفة.',
    fixtureDisclosure:
      'بيانات مرجعية فقط — لا تُعرض بيانات حية لأي مستأجر أو صلاحية أو حركة مالية أو تدقيق.',
    navigationLabel: 'أقسام دليل المكوّنات',
    sections: [
      { id: 'navigation', label: 'التنقّل' },
      { id: 'records', label: 'السجلّات' },
      { id: 'signals', label: 'الحالة والتنبيه' },
      { id: 'approval', label: 'الموافقة والدعم' },
      { id: 'audit', label: 'المسار التدقيقي' },
      { id: 'states', label: 'حالات التشغيل' },
      { id: 'behavior', label: 'لوحة المفاتيح والحركة' },
    ],
    navigation: {
      title: 'التنقّل حسب المهمة',
      description: 'تُسمّى المهمة النشطة نصياً وتظهر كصفحة حالية للتقنيات المساعدة.',
      activeLabel: 'التحصيل',
      queueLabel: 'قائمة الموافقات',
      reportsLabel: 'التقارير',
    },
    records: {
      title: 'جدول البيانات والقائمة المختصرة',
      description:
        'يحافظ الجدول على العناوين والوصف، ويتحوّل في العرض الضيق إلى قائمة سجلات معنونة.',
      tableCaption: 'حسابات تحصيل مرجعية وأرصدة منفصلة بحسب العملة',
      columnAccount: 'الحساب',
      columnStatus: 'الحالة',
      columnBalance: 'الرصيد',
      columnAction: 'الإجراء',
      openLabel: 'افتح السجل المرجعي',
      openedFeedback: 'فُتح السجل المرجعي',
      mobileLabel: 'حسابات التحصيل المرجعية',
      rows: [
        {
          id: 'REF-1042',
          account: 'الحساب المرجعي أ',
          reference: 'REF-1042',
          status: 'بحاجة إلى مراجعة',
          tone: 'warning',
          usd: '128.00',
          lbp: '4,250,000',
        },
        {
          id: 'REF-1088',
          account: 'الحساب المرجعي ب',
          reference: 'REF-1088',
          status: 'تمت المطابقة',
          tone: 'positive',
          usd: '72.50',
          lbp: '0',
        },
      ],
    },
    signals: {
      title: 'الحالة والتنبيه',
      description: 'تتضمّن كل حالة كلمات واضحة؛ اللون معلومة مساندة فقط.',
      calloutTitle: 'البيانات المرجعية غير تشغيلية عمداً',
      calloutDescription: 'تشرح إجراءات هذا الدليل سلوك المكوّن ولا ترسل عملاً أو توافق عليه.',
      statuses: [
        { label: 'معلومة', tone: 'primary' },
        { label: 'مكتمل', tone: 'positive' },
        { label: 'بحاجة إلى انتباه', tone: 'warning' },
        { label: 'حرج', tone: 'critical' },
        { label: 'لم يبدأ', tone: 'neutral' },
      ],
    },
    approval: {
      title: 'سياق الموافقة والدعم',
      description: 'يبقى الأثر والسبب وحالة الموافقة والنطاق والانتهاء وسياق التدقيق ظاهراً.',
      supportTitle: 'جلسة دعم مرجعية — غير نشطة',
      supportDescription: 'مثال على السياق الدائم المطلوب أثناء الدعم محدود النطاق.',
      ticketLabel: 'التذكرة',
      ticket: 'CATALOG-DEMO',
      scopeLabel: 'النطاق',
      scope: 'معاينة المكوّنات للقراءة فقط',
      expiresLabel: 'الانتهاء',
      expires: 'مرجع فقط',
      auditLabel: 'مثال تدقيقي',
      endLabel: 'إنهاء المثال',
      unavailableLabel: 'غير متاح في الدليل المرجعي',
      cardTitle: 'مراجعة إجراء عالي الأثر',
      impactLabel: 'الأثر',
      impact: 'سيؤثر على سجل مرجعي واحد محدد.',
      reasonLabel: 'السبب',
      reason: 'مراجعة تفاعل ضمن دليل المكوّنات.',
      approvalLabel: 'حالة الموافقة',
      approvalState: 'الموافقة مطلوبة',
      approveLabel: 'معاينة إجراء الموافقة',
      approveUnavailableReason: 'الموافقة معطّلة لأن هذا الدليل لا ينفّذ أي عمل.',
      permissionTitle: 'الصلاحية مطلوبة',
      permissionDescription:
        'لا يملك الحساب التجريبي صلاحية الموافقة المطلوبة. اطلب أصغر نطاق مطلوب.',
      requiredScopeLabel: 'النطاق المطلوب',
      requiredScope: 'finance.approve',
    },
    audit: {
      title: 'المسار التدقيقي',
      description: 'تحفظ الأحداث المرتبة المنفّذ والإجراء والنتيجة والمرجع ووقت بيروت الصريح.',
      actorLabel: 'المنفّذ',
      referenceLabel: 'المرجع',
      outcomeLabel: 'النتيجة',
      items: [
        {
          title: 'فُتحت المراجعة',
          actor: 'منفّذ مرجعي',
          reference: 'REF-1042',
          outcome: 'مثال للقراءة فقط',
          time: '09:10',
          timeZone: 'Asia/Beirut',
          tone: 'primary',
        },
        {
          title: 'طُلِبت الموافقة',
          actor: 'مسار مرجعي',
          reference: 'APV-DEMO',
          outcome: 'مثال قيد الانتظار',
          time: '09:14',
          timeZone: 'Asia/Beirut',
          tone: 'warning',
        },
        {
          title: 'سُجّل الدليل',
          actor: 'بيانات الدليل',
          reference: 'AUD-DEMO',
          outcome: 'مثال مكتمل',
          time: '09:18',
          timeZone: 'Asia/Beirut',
          tone: 'positive',
        },
      ],
    },
    states: {
      title: 'حالات التحميل والفراغ والخطأ والصلاحيات',
      description: 'تشرح كل حالة ما هو معروف وما بقي آمناً والخطوة الآمنة التالية.',
      loadingTitle: 'جارٍ تحميل السجلات المرجعية',
      loadingDescription: 'تبقى عوامل التصفية والتنقّل الحالية متاحة.',
      emptyTitle: 'لا تطابق سجلات عامل التصفية المرجعي',
      emptyDescription: 'امسح عامل التصفية للعودة إلى قائمة الأمثلة الكاملة.',
      emptyAction: 'مسح عامل التصفية',
      emptyFeedback: 'مُسح عامل تصفية المثال. لم تتغير أي بيانات إنتاجية.',
      errorTitle: 'تعذّرت قراءة السجلات المرجعية',
      errorDescription: 'لم تُحاول أي كتابة. يمكن إعادة محاولة هذا المثال المخصص للقراءة بأمان.',
      errorAction: 'إعادة محاولة القراءة',
      errorFeedback: 'اكتملت إعادة محاولة المثال المخصص للقراءة. لم يُرسل أي طلب.',
      deniedTitle: 'الوصول إلى هذا الإجراء مرفوض',
      deniedDescription: 'صلاحية الموافقة المطلوبة غير متاحة. بقي السجل بلا تغيير في هذا المثال.',
      deniedAction: 'عرض إرشادات التصعيد',
      deniedUnavailableReason: 'التصعيد معطّل لأن الدليل لا يفتح طلبات دعم.',
      requiredScopeLabel: 'النطاق المطلوب',
      requiredScope: 'finance.approve',
    },
    behavior: {
      title: 'لوحة المفاتيح والتركيز وتقليل الحركة',
      description:
        'تتبع عناصر التحكم ترتيب المهمة، وينقل رابط التجاوز إلى الأمثلة، ويبقى التركيز ظاهراً.',
      keyboardTitle: 'عقد لوحة المفاتيح',
      keyboardDescription:
        'يصل التنقّل بلوحة المفاتيح إلى اللغة وروابط الأقسام وإجراءات السجلات والحالات بحسب ترتيب المستند. تحتفظ عناصر التحكم الأصلية بسلوك التفعيل القياسي.',
      focusLabel: 'انقل التركيز إلى عنوان الدليل',
      motionTitle: 'عقد تقليل الحركة',
      motionDescription:
        'عند طلب تقليل الحركة، تنتهي انتقالات الدليل وحركة التحميل المشتركة من دون حركة مستمرة.',
    },
  },
};
