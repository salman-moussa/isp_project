import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  PageHeader,
  StatePanel,
  StatusBadge,
  Surface,
  type ApiSession,
  type Locale,
} from '@isp/ui';
import { readTenantStaff, type TenantStaffMember } from '../api';
import './staff.css';

const roleLabels: Readonly<Record<string, { en: string; ar: string }>> = {
  isp_owner: { en: 'ISP owner', ar: 'مالك شركة الإنترنت' },
  isp_administrator: { en: 'ISP administrator', ar: 'مسؤول شركة الإنترنت' },
  branch_manager: { en: 'Branch manager', ar: 'مدير فرع' },
  finance_billing: { en: 'Finance & billing', ar: 'المالية والفوترة' },
  cashier: { en: 'Cashier', ar: 'أمين صندوق' },
  collector: { en: 'Collector', ar: 'جابي' },
  network_operator: { en: 'Network operator', ar: 'مشغّل الشبكة' },
  customer_service: { en: 'Customer service', ar: 'خدمة المشتركين' },
  installer: { en: 'Installer', ar: 'فنّي تركيب' },
  tenant_auditor: { en: 'Tenant auditor', ar: 'مدقق المستأجر' },
};

export function StaffWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const [members, setMembers] = useState<readonly TenantStaffMember[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const isEnglish = locale === 'en';

  const load = () => {
    setState('loading');
    void readTenantStaff(session)
      .then((result) => {
        setMembers(result);
        setState('ready');
      })
      .catch(() => setState('error'));
  };

  useEffect(load, [session]);

  const roles = useMemo(
    () => [...new Set(members.map((member) => member.roleKey))].sort(),
    [members],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return members.filter(
      (member) =>
        (role === 'all' || member.roleKey === role) &&
        (!normalized ||
          member.displayName.toLocaleLowerCase().includes(normalized) ||
          member.email.toLocaleLowerCase().includes(normalized)),
    );
  }, [members, query, role]);
  const activeCount = members.filter((member) => member.active && !member.disabled).length;
  const mfaCount = members.filter((member) => member.mfaRequired).length;
  const collectorCount = members.filter(
    (member) => member.roleKey === 'collector' && member.active && !member.disabled,
  ).length;

  return (
    <>
      <PageHeader
        eyebrow={isEnglish ? 'Identity & access' : 'الهوية والوصول'}
        title={isEnglish ? 'Staff & access center' : 'مركز الفريق والصلاحيات'}
        description={
          isEnglish
            ? 'The real tenant identity directory. Review who can enter Orvex, their role, scope, MFA policy, and effective account state.'
            : 'دليل الهوية الحقيقي للمستأجر. راجع من يمكنه دخول Orvex ودوره ونطاقه وسياسة التحقق وحالة حسابه.'
        }
        actions={
          <Button variant="secondary" onClick={load} disabled={state === 'loading'}>
            {isEnglish ? 'Refresh directory' : 'تحديث الدليل'}
          </Button>
        }
      />

      {state !== 'ready' ? (
        <StatePanel
          variant={state === 'loading' ? 'loading' : 'error'}
          title={
            state === 'loading'
              ? isEnglish
                ? 'Loading authorized staff'
                : 'جارٍ تحميل الفريق المصرح'
              : isEnglish
                ? 'Staff directory unavailable'
                : 'دليل الفريق غير متاح'
          }
          description={
            state === 'loading'
              ? isEnglish
                ? 'Reading tenant-scoped identities without exposing credential material.'
                : 'جارٍ قراءة الهويات ضمن نطاق المستأجر دون كشف بيانات الاعتماد.'
              : isEnglish
                ? 'Check your tenant-user administration permission or retry the protected read.'
                : 'تحقق من صلاحية إدارة المستخدمين أو أعد محاولة القراءة المحمية.'
          }
          actionLabel={state === 'error' ? (isEnglish ? 'Try again' : 'إعادة المحاولة') : undefined}
          onAction={load}
        />
      ) : (
        <>
          <div className="staff-metrics" aria-label={isEnglish ? 'Access posture' : 'وضع الوصول'}>
            <AccessMetric
              label={isEnglish ? 'Active accounts' : 'حسابات نشطة'}
              value={activeCount}
            />
            <AccessMetric label={isEnglish ? 'MFA required' : 'التحقق مطلوب'} value={mfaCount} />
            <AccessMetric
              label={isEnglish ? 'Active collectors' : 'جباة نشطون'}
              value={collectorCount}
            />
          </div>

          <Surface className="staff-directory">
            <div className="staff-toolbar">
              <label>
                <span>{isEnglish ? 'Search staff' : 'البحث في الفريق'}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={isEnglish ? 'Name or email' : 'الاسم أو البريد'}
                />
              </label>
              <label>
                <span>{isEnglish ? 'Role' : 'الدور'}</span>
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="all">{isEnglish ? 'All roles' : 'كل الأدوار'}</option>
                  {roles.map((roleKey) => (
                    <option key={roleKey} value={roleKey}>
                      {roleLabel(roleKey, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <p aria-live="polite">
                {isEnglish
                  ? `${filtered.length} of ${members.length} people`
                  : `${filtered.length} من ${members.length}`}
              </p>
            </div>

            {filtered.length === 0 ? (
              <StatePanel
                variant="empty"
                title={isEnglish ? 'No staff match these filters' : 'لا يوجد فريق مطابق للفلاتر'}
                description={
                  isEnglish
                    ? 'Clear the search or choose another role.'
                    : 'امسح البحث أو اختر دوراً آخر.'
                }
                actionLabel={isEnglish ? 'Clear filters' : 'مسح الفلاتر'}
                onAction={() => {
                  setQuery('');
                  setRole('all');
                }}
              />
            ) : (
              <div className="staff-list">
                {filtered.map((member) => (
                  <StaffCard key={member.id} member={member} locale={locale} />
                ))}
              </div>
            )}
          </Surface>
        </>
      )}
    </>
  );
}

function AccessMetric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Surface className="access-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </Surface>
  );
}

function StaffCard({
  member,
  locale,
}: {
  readonly member: TenantStaffMember;
  readonly locale: Locale;
}) {
  const isEnglish = locale === 'en';
  const enabled = member.active && !member.disabled;
  const scopes = Object.values(member.scope).reduce(
    (total, values) => total + (values?.length ?? 0),
    0,
  );
  return (
    <article className="staff-card">
      <div className="staff-card__identity">
        <span className="staff-avatar" aria-hidden="true">
          {member.displayName.slice(0, 2).toLocaleUpperCase()}
        </span>
        <div>
          <h2>{member.displayName}</h2>
          <a href={`mailto:${member.email}`}>{member.email}</a>
        </div>
      </div>
      <div className="staff-card__badges">
        <StatusBadge tone={enabled ? 'positive' : 'critical'}>
          {enabled ? (isEnglish ? 'Active' : 'نشط') : isEnglish ? 'Blocked' : 'محظور'}
        </StatusBadge>
        <StatusBadge tone={member.mfaRequired ? 'primary' : 'warning'}>
          {member.mfaRequired
            ? isEnglish
              ? 'MFA required'
              : 'التحقق مطلوب'
            : isEnglish
              ? 'MFA optional'
              : 'التحقق اختياري'}
        </StatusBadge>
      </div>
      <dl className="staff-card__facts">
        <div>
          <dt>{isEnglish ? 'Role' : 'الدور'}</dt>
          <dd>{roleLabel(member.roleKey, locale)}</dd>
        </div>
        <div>
          <dt>{isEnglish ? 'Permissions' : 'الصلاحيات'}</dt>
          <dd>{member.permissions.length}</dd>
        </div>
        <div>
          <dt>{isEnglish ? 'Scoped records' : 'عناصر النطاق'}</dt>
          <dd>{scopes || (isEnglish ? 'Tenant-wide' : 'كل المستأجر')}</dd>
        </div>
        <div>
          <dt>{isEnglish ? 'Access version' : 'نسخة الوصول'}</dt>
          <dd>{member.authorizationVersion}</dd>
        </div>
      </dl>
    </article>
  );
}

function roleLabel(roleKey: string, locale: Locale): string {
  return roleLabels[roleKey]?.[locale] ?? roleKey.replaceAll('_', ' ');
}
