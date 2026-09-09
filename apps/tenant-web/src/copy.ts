import type { Locale, NavigationItem } from '@isp/ui';

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
  signedInEyebrow: string;
  signedInTitle: string;
  workspaceLabel: string;
  searchLabel: string;
  userLabel: string;
  signOutLabel: string;
  signInToOpen: string;
  signInDescription: string;
  navigation: NavigationItem[];
  quickActions: Array<{ id: string; label: string; description: string }>;
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
  contextEyebrow: 'ISP workspace',
  contextTitle: 'Sign in to your ISP workspace',
  contextMeta: 'Branch-scoped access · Asia/Beirut',
  signedInEyebrow: 'ISP workspace · Authenticated',
  signedInTitle: 'Authenticated ISP workspace',
  workspaceLabel: 'Workspace',
  searchLabel: 'Search subscribers, invoices, or receipts',
  userLabel: 'Account',
  signOutLabel: 'Sign out',
  signInToOpen: 'Sign in to open',
  signInDescription: 'This module is available only inside an authenticated tenant session.',
  navigation: [
    { id: 'dashboard', label: 'Operations dashboard' },
    { id: 'sales', label: 'Sales & orders' },
    { id: 'subscribers', label: 'Subscribers' },
    { id: 'billing', label: 'Billing & invoices' },
    { id: 'accounting', label: 'Accounting & ledger' },
    { id: 'payments', label: 'Payments & cashier' },
    { id: 'collectors', label: 'Collectors' },
    { id: 'dealers', label: 'Dealers & vouchers' },
    { id: 'assurance', label: 'Revenue assurance' },
    { id: 'mikrotik', label: 'Network' },
    { id: 'noc', label: 'NOC incidents' },
    { id: 'warehouse', label: 'Warehouse & custody' },
    { id: 'installations', label: 'Installations' },
    { id: 'support', label: 'Customer service' },
    { id: 'communications', label: 'Communications' },
    { id: 'reports', label: 'Reports' },
    { id: 'staff', label: 'Staff & access' },
    { id: 'configuration', label: 'Configuration' },
  ],
  quickActions: [
    {
      id: 'subscribers',
      label: 'Add a subscriber',
      description: 'Identity, address, package, and activation',
    },
    {
      id: 'payments',
      label: 'Take a payment',
      description: 'Post the receipt with its allocations and print it',
    },
    {
      id: 'billing',
      label: 'Preview bulk invoices',
      description: 'Validate first, then post asynchronously',
    },
    {
      id: 'collectors',
      label: 'Settle a collector route',
      description: 'Expected and declared cash per currency',
    },
  ],
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
  contextEyebrow: 'مساحة شركة الإنترنت',
  contextTitle: 'سجّل الدخول إلى مساحة عمل شركتك',
  contextMeta: 'وصول مقيّد بالفرع · بيروت',
  signedInEyebrow: 'مساحة شركة الإنترنت · موثقة',
  signedInTitle: 'مساحة عمل مزوّد الإنترنت',
  workspaceLabel: 'مساحة',
  searchLabel: 'البحث عن مشترك أو فاتورة أو إيصال',
  userLabel: 'الحساب',
  signOutLabel: 'تسجيل الخروج',
  signInToOpen: 'سجّل الدخول لفتح',
  signInDescription: 'هذه الوحدة متاحة فقط ضمن جلسة مستأجر موثقة.',
  navigation: [
    { id: 'dashboard', label: 'لوحة العمليات' },
    { id: 'sales', label: 'المبيعات والطلبات' },
    { id: 'subscribers', label: 'المشتركون' },
    { id: 'billing', label: 'الفوترة والفواتير' },
    { id: 'accounting', label: 'المحاسبة والدفتر العام' },
    { id: 'payments', label: 'الدفعات والصندوق' },
    { id: 'collectors', label: 'الجباة' },
    { id: 'dealers', label: 'الوكلاء والقسائم' },
    { id: 'assurance', label: 'ضمان الإيرادات' },
    { id: 'mikrotik', label: 'الشبكة' },
    { id: 'noc', label: 'حوادث الشبكة' },
    { id: 'warehouse', label: 'المستودع والعهدة' },
    { id: 'installations', label: 'التركيبات' },
    { id: 'support', label: 'خدمة العملاء' },
    { id: 'communications', label: 'التواصل' },
    { id: 'reports', label: 'التقارير' },
    { id: 'staff', label: 'الفريق والصلاحيات' },
    { id: 'configuration', label: 'الإعدادات' },
  ],
  quickActions: [
    { id: 'subscribers', label: 'إضافة مشترك', description: 'الهوية والعنوان والباقة والتفعيل' },
    { id: 'payments', label: 'استلام دفعة', description: 'ترحيل الإيصال مع تخصيصاته وطباعته' },
    {
      id: 'billing',
      label: 'معاينة فواتير جماعية',
      description: 'التحقق أولاً ثم الترحيل في الخلفية',
    },
    {
      id: 'collectors',
      label: 'تسوية مسار جابٍ',
      description: 'النقد المتوقع والمصرّح به لكل عملة',
    },
  ],
};

export const tenantCopy: Record<Locale, TenantCopy> = { en: english, ar: arabic };
