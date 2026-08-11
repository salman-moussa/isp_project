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
    clients: [
      'Client operations',
      'Manage ISP client accounts',
      'Review commercial ownership, contract state, and deployment model without entering subscriber data.',
      [
        ['Active accounts', '84', 'Across all hosting models', 'Healthy', 'positive'],
        ['Renewals due', '12', 'Within the next 30 days', 'Follow up', 'warning'],
        ['Onboarding', '4', 'Commercial setup in progress', 'In progress', 'primary'],
      ],
      'Accounts needing attention',
      'Prioritized by renewal date and onboarding blockers.',
      [
        ['Chouf Connect', 'Renewal', 'Owner contact is still missing', 'critical'],
        ['Metn Fiber', 'Onboarding', 'Deployment model needs approval', 'warning'],
        ['Northline ISP (demo)', 'Active', 'Dedicated hosted · current version', 'positive'],
      ],
      [
        ['Review subscriptions', 'Confirm package and renewal state', 'subscriptions'],
        ['Open deployments', 'Resolve setup and infrastructure blockers', 'deployments'],
      ],
    ],
    sales: [
      'Commercial workspace',
      'Move qualified opportunities forward',
      'Keep the next owner, value, and follow-up date visible from qualification through handoff.',
      [
        ['Open opportunities', '18', 'USD 22,600 weighted value', 'On track', 'positive'],
        ['Follow-ups due', '5', 'Before end of business today', 'Due today', 'warning'],
        ['Ready to close', '3', 'Terms and package confirmed', 'Ready', 'primary'],
      ],
      'Today’s sales queue',
      'Deals ordered by the next committed activity.',
      [
        ['Beirut Broadband', 'Proposal', 'USD 1,440 · response due today', 'warning'],
        ['Cedars Net', 'Review', 'Security questionnaire received', 'primary'],
        ['Zahle Online', 'Handoff', 'Package accepted · create client', 'positive'],
      ],
      [
        ['Open ISP clients', 'Complete the commercial handoff', 'clients'],
        ['Compare packages', 'Check the approved commercial catalogue', 'packages'],
      ],
    ],
    packages: [
      'Commercial catalogue',
      'Control packages and add-ons',
      'Compare published offers, entitlements, and pricing without changing active subscriptions silently.',
      [
        ['Published packages', '4', 'Available for new subscriptions', 'Published', 'positive'],
        ['Draft changes', '2', 'Awaiting commercial approval', 'Review', 'warning'],
        ['Active add-ons', '7', 'Optional contracted services', 'Current', 'primary'],
      ],
      'Catalogue changes',
      'Every change remains explicit before it affects a contract.',
      [
        ['Scale package', 'Draft', 'New deployment allowance under review', 'warning'],
        ['Backup retention add-on', 'Published', 'Available to dedicated hosting', 'positive'],
        ['Migration assistance', 'Review', 'One-time fee needs approval', 'primary'],
      ],
      [
        ['Review subscriptions', 'See which contracts use each offer', 'subscriptions'],
        ['Open sales pipeline', 'Use approved offers in active deals', 'sales'],
      ],
    ],
    subscriptions: [
      'Revenue operations',
      'Track platform subscriptions',
      'Manage contract periods, renewal state, and package changes independently from subscriber connectivity.',
      [
        ['Active', '84', 'Platform service subscriptions', 'Current', 'positive'],
        ['Grace period', '4', 'Commercial follow-up only', 'Attention', 'warning'],
        ['Changes queued', '6', 'Effective at a future renewal', 'Scheduled', 'primary'],
      ],
      'Renewal worklist',
      'Subscription state never initiates subscriber network suspension.',
      [
        ['Metn Fiber', '9 days', 'Scale · renewal owner assigned', 'warning'],
        ['North Wave', '16 days', 'Growth · meeting scheduled', 'primary'],
        ['Chouf Connect', '24 days', 'Starter · contact required', 'critical'],
      ],
      [
        ['Open billing', 'Review invoices and posted payments', 'billing'],
        ['Compare packages', 'Prepare an explicit package change', 'packages'],
      ],
    ],
    billing: [
      'Platform finance',
      'Reconcile billing and payments',
      'Work with posted platform invoices and allocations while keeping every currency and correction explicit.',
      [
        ['USD outstanding', 'USD 18,240', 'Posted invoice balances', 'Open', 'warning'],
        ['USD collected', 'USD 31,420', 'Current billing period', 'Posted', 'positive'],
        ['Unallocated payments', '3', 'Need a confirmed invoice match', 'Review', 'critical'],
      ],
      'Finance work queue',
      'Posted records are corrected through linked adjustments, never overwritten.',
      [
        ['PAY-2048 · Bekaa Link', 'Allocate', 'USD 1,200 received by bank', 'warning'],
        ['INV-884 · South Link', 'Overdue', 'USD 660 · seven days late', 'critical'],
        ['REC-1703 · North Wave', 'Posted', 'USD 840 fully allocated', 'positive'],
      ],
      [
        ['Review subscriptions', 'Confirm the contracted billing period', 'subscriptions'],
        ['Open reports', 'Inspect finance summaries and exports', 'reports'],
      ],
    ],
    deployments: [
      'Delivery operations',
      'Coordinate client deployments',
      'See hosting model, version, backup, certificate, and job health before a release is promoted.',
      [
        ['Healthy', '88', 'Passing required deployment checks', 'Healthy', 'positive'],
        ['Attention', '3', 'A check needs an owner', 'Action needed', 'critical'],
        ['Updates ready', '11', 'Validated release available', 'Planned', 'primary'],
      ],
      'Deployment alerts',
      'Critical checks remain visible until an operator records resolution.',
      [
        ['Aley Broadband', 'Backup', 'Last success was 31 hours ago', 'critical'],
        ['South Link', 'Certificate', 'Expires in 12 days', 'warning'],
        ['City ISP', 'Precheck', 'Database extension mismatch', 'warning'],
      ],
      [
        ['Open support', 'Coordinate client-facing follow-up', 'support'],
        ['Open ISP clients', 'Confirm deployment ownership', 'clients'],
      ],
    ],
    support: [
      'Support operations',
      'Triage platform support safely',
      'Work from ticket context first; tenant access requires a separate approved, scoped, expiring grant.',
      [
        ['Open tickets', '27', 'Across platform support queues', 'Active', 'primary'],
        ['SLA risk', '7', 'Response due within two hours', 'Urgent', 'critical'],
        ['Access grants', '2', 'Approved and time limited', 'Audited', 'warning'],
      ],
      'Priority support queue',
      'A ticket alone never grants access to an ISP workspace.',
      [
        ['SUP-724 · North Wave', 'SLA risk', 'Billing configuration · no active grant', 'critical'],
        ['SUP-731 · City ISP', 'Investigating', 'Deployment precheck evidence attached', 'warning'],
        ['SUP-718 · Bekaa Link', 'Waiting', 'Client confirmation requested', 'primary'],
      ],
      [
        ['Review deployments', 'Check health evidence before escalation', 'deployments'],
        ['Open administration', 'Review roles and support grant policy', 'administration'],
      ],
    ],
    reports: [
      'Portfolio intelligence',
      'Review governed platform reports',
      'Use portfolio-level commercial and operational aggregates that never expose tenant subscriber details.',
      [
        ['Scheduled reports', '6', 'Next delivery in Beirut time', 'Running', 'positive'],
        ['Saved views', '14', 'Scoped to the current operator', 'Available', 'primary'],
        ['Exports ready', '2', 'Protected download window active', 'Expires soon', 'warning'],
      ],
      'Recent report activity',
      'Exports retain their scope and generation timestamp.',
      [
        ['Monthly recurring revenue', 'Ready', 'August 2026 · USD only', 'positive'],
        ['Renewal forecast', 'Scheduled', 'Runs tomorrow at 07:00', 'primary'],
        ['Deployment health', 'Ready', 'Generated today at 09:15', 'positive'],
      ],
      [
        ['Open billing', 'Inspect the posted finance source records', 'billing'],
        ['Review deployments', 'Inspect operational exceptions', 'deployments'],
      ],
    ],
    administration: [
      'Control governance',
      'Administer the platform boundary',
      'Manage platform operators, permission scopes, policies, and audit evidence without implicit tenant access.',
      [
        ['Platform operators', '16', 'Enabled staff identities', 'Current', 'positive'],
        ['Role assignments', '29', 'Permission-catalogue based', 'Reviewed', 'primary'],
        ['Reviews due', '3', 'Quarterly access review', 'Due', 'warning'],
      ],
      'Governance queue',
      'High-impact changes remain attributable and reviewable.',
      [
        ['Quarterly access review', 'Due', 'Three assignments need attestation', 'warning'],
        ['Support grant policy', 'Current', 'Maximum duration: 60 minutes', 'positive'],
        ['Audit export', 'Ready', 'August control-plane activity', 'primary'],
      ],
      [
        ['Open support', 'Review the operational use of access grants', 'support'],
        ['Open reports', 'Inspect governance evidence', 'reports'],
      ],
    ],
  },
  {
    queue: 'Work queue',
    next: 'Continue work',
    nextDescription: 'Open the related workspace without losing context.',
  },
);

const arabic = buildRoutes(
  {
    clients: [
      'عمليات العملاء',
      'إدارة حسابات شركات الإنترنت',
      'راجع الملكية التجارية وحالة العقد ونموذج الاستضافة من دون الدخول إلى بيانات المشتركين.',
      [
        ['الحسابات النشطة', '٨٤', 'ضمن كل نماذج الاستضافة', 'سليمة', 'positive'],
        ['تجديدات قريبة', '١٢', 'خلال الثلاثين يوماً المقبلة', 'متابعة', 'warning'],
        ['قيد الإعداد', '٤', 'إعداد تجاري قيد التنفيذ', 'قيد العمل', 'primary'],
      ],
      'حسابات تحتاج انتباهاً',
      'مرتبة بحسب موعد التجديد وعوائق الإعداد.',
      [
        ['Chouf Connect', 'تجديد', 'لم يُسجّل تواصل المالك بعد', 'critical'],
        ['Metn Fiber', 'إعداد', 'نموذج الاستضافة يحتاج موافقة', 'warning'],
        ['Northline ISP (demo)', 'نشط', 'استضافة مخصصة · الإصدار الحالي', 'positive'],
      ],
      [
        ['مراجعة الاشتراكات', 'تأكيد الباقة وحالة التجديد', 'subscriptions'],
        ['فتح عمليات النشر', 'حل عوائق الإعداد والبنية التحتية', 'deployments'],
      ],
    ],
    sales: [
      'مساحة العمل التجارية',
      'دفع الفرص المؤهلة إلى الأمام',
      'أبقِ المالك التالي والقيمة وموعد المتابعة واضحاً من التأهيل حتى التسليم.',
      [
        ['فرص مفتوحة', '١٨', 'قيمة مرجّحة USD 22,600', 'على المسار', 'positive'],
        ['متابعات مستحقة', '٥', 'قبل نهاية عمل اليوم', 'اليوم', 'warning'],
        ['جاهزة للإغلاق', '٣', 'الشروط والباقة مؤكدتان', 'جاهزة', 'primary'],
      ],
      'قائمة مبيعات اليوم',
      'الصفقات مرتبة حسب النشاط الملتزم التالي.',
      [
        ['Beirut Broadband', 'عرض', 'USD 1,440 · الرد اليوم', 'warning'],
        ['Cedars Net', 'مراجعة', 'استبيان الأمان مستلم', 'primary'],
        ['Zahle Online', 'تسليم', 'الباقة مقبولة · أنشئ العميل', 'positive'],
      ],
      [
        ['فتح شركات الإنترنت', 'إكمال التسليم التجاري', 'clients'],
        ['مقارنة الباقات', 'مراجعة الكتالوج التجاري المعتمد', 'packages'],
      ],
    ],
    packages: [
      'الكتالوج التجاري',
      'إدارة الباقات والإضافات',
      'قارن العروض المنشورة والاستحقاقات والأسعار من دون تغيير الاشتراكات النشطة بصمت.',
      [
        ['باقات منشورة', '٤', 'متاحة للاشتراكات الجديدة', 'منشورة', 'positive'],
        ['تغييرات مسودة', '٢', 'بانتظار الموافقة التجارية', 'مراجعة', 'warning'],
        ['إضافات نشطة', '٧', 'خدمات تعاقدية اختيارية', 'حالية', 'primary'],
      ],
      'تغييرات الكتالوج',
      'يبقى كل تغيير صريحاً قبل أن يؤثر في عقد.',
      [
        ['باقة Scale', 'مسودة', 'سعة نشر جديدة قيد المراجعة', 'warning'],
        ['إضافة حفظ النسخ', 'منشورة', 'متاحة للاستضافة المخصصة', 'positive'],
        ['مساعدة الترحيل', 'مراجعة', 'الرسم لمرة واحدة يحتاج موافقة', 'primary'],
      ],
      [
        ['مراجعة الاشتراكات', 'معرفة العقود التي تستخدم كل عرض', 'subscriptions'],
        ['فتح مسار المبيعات', 'استخدام العروض المعتمدة في الصفقات', 'sales'],
      ],
    ],
    subscriptions: [
      'عمليات الإيرادات',
      'متابعة اشتراكات المنصة',
      'أدر فترات العقود والتجديد وتغييرات الباقات بصورة مستقلة عن اتصال المشتركين.',
      [
        ['نشطة', '٨٤', 'اشتراكات خدمة المنصة', 'حالية', 'positive'],
        ['فترة سماح', '٤', 'متابعة تجارية فقط', 'انتباه', 'warning'],
        ['تغييرات مجدولة', '٦', 'تسري عند تجديد لاحق', 'مجدولة', 'primary'],
      ],
      'عمل التجديد',
      'حالة الاشتراك لا تبدأ أبداً تعليق شبكة مشترك.',
      [
        ['Metn Fiber', '٩ أيام', 'Scale · المالك معيّن', 'warning'],
        ['North Wave', '١٦ يوماً', 'Growth · الاجتماع مجدول', 'primary'],
        ['Chouf Connect', '٢٤ يوماً', 'Starter · التواصل مطلوب', 'critical'],
      ],
      [
        ['فتح الفوترة', 'مراجعة الفواتير والدفعات المرحلة', 'billing'],
        ['مقارنة الباقات', 'تحضير تغيير باقة صريح', 'packages'],
      ],
    ],
    billing: [
      'مالية المنصة',
      'تسوية الفوترة والدفعات',
      'اعمل على فواتير المنصة وتخصيصاتها المرحلة مع إبقاء كل عملة وتصحيح صريحين.',
      [
        ['المستحق بالدولار', 'USD 18,240', 'أرصدة فواتير مرحلة', 'مفتوح', 'warning'],
        ['المحصّل بالدولار', 'USD 31,420', 'فترة الفوترة الحالية', 'مرحّل', 'positive'],
        ['دفعات غير مخصصة', '٣', 'تحتاج مطابقة فاتورة', 'مراجعة', 'critical'],
      ],
      'قائمة العمل المالي',
      'تُصحح السجلات المرحلة بقيود مرتبطة ولا تُستبدل.',
      [
        ['PAY-2048 · Bekaa Link', 'تخصيص', 'USD 1,200 مستلمة عبر المصرف', 'warning'],
        ['INV-884 · South Link', 'متأخرة', 'USD 660 · سبعة أيام', 'critical'],
        ['REC-1703 · North Wave', 'مرحلة', 'USD 840 مخصصة بالكامل', 'positive'],
      ],
      [
        ['مراجعة الاشتراكات', 'تأكيد فترة الفوترة المتعاقد عليها', 'subscriptions'],
        ['فتح التقارير', 'فحص الملخصات والتصدير المالي', 'reports'],
      ],
    ],
    deployments: [
      'عمليات التسليم',
      'تنسيق نشر العملاء',
      'راجع نموذج الاستضافة والإصدار والنسخ الاحتياطية والشهادة والمهام قبل الترقية.',
      [
        ['سليمة', '٨٨', 'تجتاز فحوص النشر المطلوبة', 'سليمة', 'positive'],
        ['تحتاج انتباهاً', '٣', 'فحص يحتاج مالكاً', 'إجراء مطلوب', 'critical'],
        ['تحديثات جاهزة', '١١', 'إصدار متحقق منه متاح', 'مخططة', 'primary'],
      ],
      'تنبيهات النشر',
      'تبقى الفحوص الحرجة ظاهرة حتى يسجل المشغل حلها.',
      [
        ['Aley Broadband', 'نسخ احتياطي', 'آخر نجاح قبل ٣١ ساعة', 'critical'],
        ['South Link', 'شهادة', 'تنتهي خلال ١٢ يوماً', 'warning'],
        ['City ISP', 'فحص مسبق', 'عدم تطابق امتداد قاعدة البيانات', 'warning'],
      ],
      [
        ['فتح الدعم', 'تنسيق المتابعة مع العميل', 'support'],
        ['فتح شركات الإنترنت', 'تأكيد ملكية النشر', 'clients'],
      ],
    ],
    support: [
      'عمليات الدعم',
      'فرز دعم المنصة بأمان',
      'ابدأ من سياق التذكرة؛ يتطلب دخول مساحة العميل منحة منفصلة معتمدة ومحددة وتنتهي تلقائياً.',
      [
        ['تذاكر مفتوحة', '٢٧', 'في قوائم دعم المنصة', 'نشطة', 'primary'],
        ['خطر SLA', '٧', 'الرد خلال ساعتين', 'عاجل', 'critical'],
        ['منح دخول', '٢', 'معتمدة ومحدودة الوقت', 'مدققة', 'warning'],
      ],
      'قائمة الدعم ذات الأولوية',
      'التذكرة وحدها لا تمنح دخول مساحة شركة الإنترنت.',
      [
        ['SUP-724 · North Wave', 'خطر SLA', 'إعداد فوترة · لا منحة نشطة', 'critical'],
        ['SUP-731 · City ISP', 'تحقيق', 'دليل فحص النشر مرفق', 'warning'],
        ['SUP-718 · Bekaa Link', 'انتظار', 'طُلب تأكيد العميل', 'primary'],
      ],
      [
        ['مراجعة النشر', 'فحص دليل الصحة قبل التصعيد', 'deployments'],
        ['فتح الإدارة', 'مراجعة الأدوار وسياسة منح الدعم', 'administration'],
      ],
    ],
    reports: [
      'تحليلات المحفظة',
      'مراجعة تقارير المنصة المحكومة',
      'استخدم تجميعات تجارية وتشغيلية لا تكشف تفاصيل مشتركي العملاء.',
      [
        ['تقارير مجدولة', '٦', 'التسليم التالي بتوقيت بيروت', 'تعمل', 'positive'],
        ['عروض محفوظة', '١٤', 'محددة للمشغل الحالي', 'متاحة', 'primary'],
        ['تصديران جاهزان', '٢', 'نافذة التنزيل محمية', 'تنتهي قريباً', 'warning'],
      ],
      'نشاط التقارير الأخير',
      'يحافظ كل تصدير على نطاقه ووقت إنشائه.',
      [
        ['الإيراد الشهري المتكرر', 'جاهز', 'آب ٢٠٢٦ · USD فقط', 'positive'],
        ['توقع التجديد', 'مجدول', 'غداً الساعة ٠٧:٠٠', 'primary'],
        ['صحة النشر', 'جاهز', 'أُنشئ اليوم ٠٩:١٥', 'positive'],
      ],
      [
        ['فتح الفوترة', 'فحص السجلات المالية المصدرية المرحلة', 'billing'],
        ['مراجعة النشر', 'فحص الاستثناءات التشغيلية', 'deployments'],
      ],
    ],
    administration: [
      'حوكمة التحكم',
      'إدارة حدود المنصة',
      'أدر المشغلين ونطاقات الصلاحيات والسياسات والتدقيق من دون دخول ضمني لبيانات العملاء.',
      [
        ['مشغلو المنصة', '١٦', 'هويات موظفين مفعّلة', 'حالية', 'positive'],
        ['تعيينات الأدوار', '٢٩', 'مبنية على كتالوج الصلاحيات', 'مراجعة', 'primary'],
        ['مراجعات مستحقة', '٣', 'مراجعة وصول فصلية', 'مستحقة', 'warning'],
      ],
      'قائمة الحوكمة',
      'تبقى التغييرات عالية الأثر منسوبة وقابلة للمراجعة.',
      [
        ['مراجعة الوصول الفصلية', 'مستحقة', 'ثلاثة تعيينات تحتاج تصديقاً', 'warning'],
        ['سياسة منحة الدعم', 'حالية', 'المدة القصوى: ٦٠ دقيقة', 'positive'],
        ['تصدير التدقيق', 'جاهز', 'نشاط طبقة التحكم لشهر آب', 'primary'],
      ],
      [
        ['فتح الدعم', 'مراجعة استخدام منح الدخول تشغيلياً', 'support'],
        ['فتح التقارير', 'فحص دليل الحوكمة', 'reports'],
      ],
    ],
  },
  {
    queue: 'قائمة العمل',
    next: 'متابعة العمل',
    nextDescription: 'افتح مساحة العمل المرتبطة من دون فقدان السياق.',
  },
);

export const platformRoutes: Record<Locale, Record<string, TaskRouteDefinition>> = {
  en: english,
  ar: arabic,
};
