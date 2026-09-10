import type { Locale, NavigationItem } from '@isp/ui';

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
  contextEyebrow: string;
  contextTitle: string;
  contextMeta: string;
  signedInEyebrow: string;
  signedInTitle: string;
  signedInMeta: string;
  operatorStatus: string;
  searchLabel: string;
  userLabel: string;
  signOutLabel: string;
  signInToOpen: string;
  signInDescription: string;
  navigation: NavigationItem[];
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
  contextEyebrow: 'Vendor control plane',
  contextTitle: 'Sign in to the Control Center',
  contextMeta: 'Platform staff only · Asia/Beirut',
  signedInEyebrow: 'Production control plane',
  signedInTitle: 'ISP client portfolio',
  signedInMeta: 'Authenticated API · Asia/Beirut',
  operatorStatus: 'Portfolio view',
  searchLabel: 'Search ISP clients and deployments',
  userLabel: 'Account',
  signOutLabel: 'Sign out',
  signInToOpen: 'Sign in to open',
  signInDescription: 'This module is available only inside an authenticated platform session.',
  navigation: [
    { id: 'overview', label: 'Portfolio overview' },
    { id: 'clients', label: 'ISP clients' },
    { id: 'sales', label: 'Sales pipeline' },
    { id: 'packages', label: 'Packages & add-ons' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'billing', label: 'Billing & payments' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'support', label: 'Support center' },
    { id: 'reports', label: 'Reports & audit' },
    { id: 'administration', label: 'Administration' },
  ],
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
  contextTitle: 'سجّل الدخول إلى مركز التحكم',
  contextMeta: 'لموظفي المنصة فقط · توقيت بيروت',
  signedInEyebrow: 'منصة التحكم الإنتاجية',
  signedInTitle: 'محفظة عملاء الإنترنت',
  signedInMeta: 'واجهة مصرح بها · توقيت بيروت',
  operatorStatus: 'عرض المحفظة',
  searchLabel: 'البحث عن شركات الإنترنت وعمليات النشر',
  userLabel: 'الحساب',
  signOutLabel: 'تسجيل الخروج',
  signInToOpen: 'سجّل الدخول لفتح',
  signInDescription: 'هذه الوحدة متاحة فقط ضمن جلسة منصة موثقة.',
  navigation: [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'clients', label: 'شركات الإنترنت' },
    { id: 'sales', label: 'مسار المبيعات' },
    { id: 'packages', label: 'الباقات والإضافات' },
    { id: 'subscriptions', label: 'الاشتراكات' },
    { id: 'billing', label: 'الفوترة والدفعات' },
    { id: 'deployments', label: 'عمليات النشر' },
    { id: 'support', label: 'مركز الدعم' },
    { id: 'reports', label: 'التقارير والتدقيق' },
    { id: 'administration', label: 'الإدارة' },
  ],
};

export const platformCopy: Record<Locale, PlatformCopy> = { en: english, ar: arabic };
