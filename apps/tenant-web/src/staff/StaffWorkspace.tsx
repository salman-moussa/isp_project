import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  PageHeader,
  StatePanel,
  StatusBadge,
  Surface,
  type ApiSession,
  type Locale,
} from '@isp/ui';
import {
  inviteTenantStaff,
  readTenantStaff,
  revokeTenantStaffInvitation,
  updateTenantStaff,
  type TenantStaffInvitation,
  type TenantStaffMember,
  type TenantStaffRole,
  type TenantScopeCatalogue,
} from '../api';
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
  const [invitations, setInvitations] = useState<readonly TenantStaffInvitation[]>([]);
  const [roleCatalogue, setRoleCatalogue] = useState<readonly TenantStaffRole[]>([]);
  const [scopeCatalogue, setScopeCatalogue] = useState<TenantScopeCatalogue>({
    branches: [],
    areas: [],
    routes: [],
  });
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [operationState, setOperationState] = useState<'idle' | 'busy'>('idle');
  const [operationMessage, setOperationMessage] = useState<string>();
  const [stepUpChallengeId, setStepUpChallengeId] = useState<string>();
  const [stepUpCode, setStepUpCode] = useState('');
  const isEnglish = locale === 'en';

  const load = () => {
    setState('loading');
    void readTenantStaff(session)
      .then((result) => {
        setMembers(result.members);
        setInvitations(result.invitations);
        setRoleCatalogue(result.roles);
        setScopeCatalogue(result.scopes);
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
          <>
            {session.startMfaStepUp ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setOperationState('busy');
                  setOperationMessage(undefined);
                  void session.startMfaStepUp!()
                    .then((challenge) => setStepUpChallengeId(challenge.challengeId))
                    .catch((error) =>
                      setOperationMessage(error instanceof Error ? error.message : String(error)),
                    )
                    .finally(() => setOperationState('idle'));
                }}
                disabled={operationState === 'busy'}
              >
                {isEnglish ? 'Verify sensitive action' : 'تحقق لإجراء حساس'}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setInviteOpen((value) => !value)}>
              {inviteOpen
                ? isEnglish
                  ? 'Close invitation'
                  : 'إغلاق الدعوة'
                : isEnglish
                  ? 'Invite employee'
                  : 'دعوة موظف'}
            </Button>
            <Button variant="secondary" onClick={load} disabled={state === 'loading'}>
              {isEnglish ? 'Refresh directory' : 'تحديث الدليل'}
            </Button>
          </>
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
          {stepUpChallengeId && session.completeMfaStepUp ? (
            <Surface className="staff-step-up">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setOperationState('busy');
                  setOperationMessage(undefined);
                  void session.completeMfaStepUp!(stepUpChallengeId, stepUpCode)
                    .then(() => {
                      setStepUpChallengeId(undefined);
                      setStepUpCode('');
                      setOperationMessage(
                        isEnglish
                          ? 'MFA verified. Sensitive staff actions are unlocked for ten minutes.'
                          : 'تم التحقق. الإجراءات الحساسة متاحة لعشر دقائق.',
                      );
                    })
                    .catch((error) =>
                      setOperationMessage(error instanceof Error ? error.message : String(error)),
                    )
                    .finally(() => setOperationState('idle'));
                }}
              >
                <div>
                  <strong>{isEnglish ? 'Complete MFA verification' : 'أكمل التحقق'}</strong>
                  <span>
                    {isEnglish
                      ? 'Enter the code from the configured authentication provider.'
                      : 'أدخل الرمز من مزود التحقق المهيأ.'}
                  </span>
                </div>
                <label>
                  <span>{isEnglish ? 'Verification code' : 'رمز التحقق'}</span>
                  <input
                    value={stepUpCode}
                    onChange={(event) => setStepUpCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,8}"
                    minLength={6}
                    maxLength={8}
                    required
                    autoFocus
                  />
                </label>
                <Button variant="primary" type="submit" disabled={operationState === 'busy'}>
                  {isEnglish ? 'Verify code' : 'تأكيد الرمز'}
                </Button>
              </form>
            </Surface>
          ) : null}
          {inviteOpen ? (
            <InvitationForm
              locale={locale}
              roles={roleCatalogue}
              scopes={scopeCatalogue}
              busy={operationState === 'busy'}
              onSubmit={async (input) => {
                setOperationState('busy');
                setOperationMessage(undefined);
                try {
                  await inviteTenantStaff(session, input);
                  setOperationMessage(
                    isEnglish
                      ? 'Invitation recorded and handed to the configured delivery provider.'
                      : 'تم تسجيل الدعوة وتسليمها إلى مزود الإرسال المهيأ.',
                  );
                  setInviteOpen(false);
                  load();
                } catch (error) {
                  setOperationMessage(error instanceof Error ? error.message : String(error));
                } finally {
                  setOperationState('idle');
                }
              }}
            />
          ) : null}
          {operationMessage ? (
            <p className="staff-operation-message" role="status">
              {operationMessage}
            </p>
          ) : null}
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
            <AccessMetric
              label={isEnglish ? 'Pending invitations' : 'دعوات معلقة'}
              value={invitations.filter((invitation) => invitation.status === 'pending').length}
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
                  <StaffCard
                    key={member.id}
                    member={member}
                    locale={locale}
                    busy={operationState === 'busy'}
                    roles={roleCatalogue}
                    scopes={scopeCatalogue}
                    onToggle={async () => {
                      setOperationState('busy');
                      setOperationMessage(undefined);
                      try {
                        await updateTenantStaff(session, member.id, {
                          roleKey: member.roleKey,
                          scope: member.scope,
                          active: !member.active,
                          reason: member.active
                            ? 'Administrator suspended staff access'
                            : 'Administrator restored staff access',
                        });
                        setOperationMessage(
                          isEnglish
                            ? 'Membership updated and existing tenant sessions revoked.'
                            : 'تم تحديث العضوية وإلغاء جلسات المستأجر الحالية.',
                        );
                        load();
                      } catch (error) {
                        setOperationMessage(error instanceof Error ? error.message : String(error));
                      } finally {
                        setOperationState('idle');
                      }
                    }}
                    onUpdate={async (input) => {
                      setOperationState('busy');
                      setOperationMessage(undefined);
                      try {
                        await updateTenantStaff(session, member.id, input);
                        setOperationMessage(
                          isEnglish
                            ? 'Role and scope updated. Existing tenant sessions were revoked.'
                            : 'تم تحديث الدور والنطاق وإلغاء جلسات المستأجر الحالية.',
                        );
                        load();
                      } catch (error) {
                        setOperationMessage(error instanceof Error ? error.message : String(error));
                      } finally {
                        setOperationState('idle');
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </Surface>

          {invitations.length ? (
            <Surface className="staff-invitations">
              <div className="surface__header">
                <div>
                  <h2>{isEnglish ? 'Invitation history' : 'سجل الدعوات'}</h2>
                  <p>
                    {isEnglish
                      ? 'Tokens are never displayed. Expired and replaced invitations remain visible as evidence.'
                      : 'لا يتم عرض الرموز. تبقى الدعوات المنتهية والمستبدلة ظاهرة كدليل.'}
                  </p>
                </div>
              </div>
              <div className="invitation-list">
                {invitations.map((invitation) => (
                  <article key={invitation.id}>
                    <div>
                      <strong>{invitation.displayName}</strong>
                      <span>{invitation.email}</span>
                    </div>
                    <span>{roleLabel(invitation.roleKey, locale)}</span>
                    <StatusBadge tone={invitation.status === 'pending' ? 'warning' : 'neutral'}>
                      {invitationStatus(invitation.status, locale)}
                    </StatusBadge>
                    <time dateTime={invitation.expiresAt}>
                      {new Date(invitation.expiresAt).toLocaleDateString(
                        isEnglish ? 'en-LB' : 'ar-LB',
                      )}
                    </time>
                    {invitation.status === 'pending' ? (
                      <Button
                        variant="secondary"
                        disabled={operationState === 'busy'}
                        onClick={() => {
                          setOperationState('busy');
                          setOperationMessage(undefined);
                          void revokeTenantStaffInvitation(
                            session,
                            invitation.id,
                            'Administrator revoked pending staff invitation',
                          )
                            .then(() => {
                              setOperationMessage(
                                isEnglish
                                  ? 'Pending invitation revoked.'
                                  : 'تم إلغاء الدعوة المعلقة.',
                              );
                              load();
                            })
                            .catch((error) =>
                              setOperationMessage(
                                error instanceof Error ? error.message : String(error),
                              ),
                            )
                            .finally(() => setOperationState('idle'));
                        }}
                      >
                        {isEnglish ? 'Revoke' : 'إلغاء'}
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            </Surface>
          ) : null}
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

function InvitationForm({
  locale,
  roles,
  scopes,
  busy,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly roles: readonly TenantStaffRole[];
  readonly scopes: TenantScopeCatalogue;
  readonly busy: boolean;
  readonly onSubmit: (input: {
    readonly email: string;
    readonly displayName: string;
    readonly roleKey: string;
    readonly scope: TenantStaffMember['scope'];
    readonly reason: string;
  }) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const [roleKey, setRoleKey] = useState('customer_service');
  const [routeIds, setRouteIds] = useState<readonly string[]>([]);
  const selectedRole = roles.find((role) => role.key === roleKey);
  const scoped = selectedRole?.scopeMode === 'branch_area_route';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onSubmit({
      email: String(data.get('email') ?? ''),
      displayName: String(data.get('displayName') ?? ''),
      roleKey,
      scope: scoped ? { routeIds } : {},
      reason: String(data.get('reason') ?? ''),
    });
  };
  return (
    <Surface className="staff-invite-panel">
      <div className="surface__header">
        <div>
          <h2>{isEnglish ? 'Secure employee invitation' : 'دعوة موظف آمنة'}</h2>
          <p>
            {isEnglish
              ? 'Requires recent MFA. The employee receives a one-time link and creates their own password.'
              : 'تتطلب تحققاً حديثاً. يستلم الموظف رابطاً لمرة واحدة وينشئ كلمة مروره بنفسه.'}
          </p>
        </div>
      </div>
      <form className="staff-invite-form" onSubmit={submit}>
        <label>
          <span>{isEnglish ? 'Full name' : 'الاسم الكامل'}</span>
          <input name="displayName" required minLength={2} maxLength={120} autoComplete="name" />
        </label>
        <label>
          <span>{isEnglish ? 'Work email' : 'البريد المهني'}</span>
          <input name="email" type="email" required maxLength={320} autoComplete="email" />
        </label>
        <label>
          <span>{isEnglish ? 'Role preset' : 'الدور المعتمد'}</span>
          <select value={roleKey} onChange={(event) => setRoleKey(event.target.value)} required>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {roleLabel(role.key, locale)}
                {role.requiresMfa ? (isEnglish ? ' · MFA' : ' · تحقق') : ''}
              </option>
            ))}
          </select>
        </label>
        {scoped ? (
          <label>
            <span>{isEnglish ? 'Authorized routes' : 'المسارات المصرح بها'}</span>
            <select
              multiple
              value={[...routeIds]}
              onChange={(event) =>
                setRouteIds([...event.currentTarget.selectedOptions].map((option) => option.value))
              }
              required
              size={Math.min(6, Math.max(3, scopes.routes.length))}
            >
              {scopes.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.code} · {isEnglish ? route.nameEn : route.nameAr}
                </option>
              ))}
            </select>
            <small>
              {isEnglish
                ? 'Only active routes from the governed Operations catalogue can be assigned.'
                : 'يمكن تعيين المسارات النشطة فقط من كتالوج العمليات المحكوم.'}
            </small>
          </label>
        ) : null}
        <label className="staff-invite-form__reason">
          <span>{isEnglish ? 'Business reason' : 'سبب العمل'}</span>
          <input name="reason" required minLength={8} maxLength={500} />
        </label>
        <div className="staff-invite-form__action">
          <Button variant="primary" type="submit" disabled={busy || roles.length === 0}>
            {busy
              ? isEnglish
                ? 'Sending…'
                : 'جارٍ الإرسال…'
              : isEnglish
                ? 'Send invitation'
                : 'إرسال الدعوة'}
          </Button>
        </div>
      </form>
    </Surface>
  );
}

function StaffCard({
  member,
  locale,
  busy,
  roles,
  scopes,
  onToggle,
  onUpdate,
}: {
  readonly member: TenantStaffMember;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly roles: readonly TenantStaffRole[];
  readonly scopes: TenantScopeCatalogue;
  readonly onToggle: () => Promise<void>;
  readonly onUpdate: (input: {
    readonly roleKey: string;
    readonly scope: TenantStaffMember['scope'];
    readonly active: boolean;
    readonly reason: string;
  }) => Promise<void>;
}) {
  const isEnglish = locale === 'en';
  const enabled = member.active && !member.disabled;
  const [editing, setEditing] = useState(false);
  const [roleKey, setRoleKey] = useState(member.roleKey);
  const [routeIds, setRouteIds] = useState<readonly string[]>(member.scope.routeIds ?? []);
  const selectedRole = roles.find((candidate) => candidate.key === roleKey);
  const scopedRecordCount = Object.values(member.scope).reduce(
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
          <dd>{scopedRecordCount || (isEnglish ? 'Tenant-wide' : 'كل المستأجر')}</dd>
        </div>
        <div>
          <dt>{isEnglish ? 'Access version' : 'نسخة الوصول'}</dt>
          <dd>{member.authorizationVersion}</dd>
        </div>
      </dl>
      <div className="staff-card__actions">
        <Button variant="secondary" onClick={() => setEditing((value) => !value)} disabled={busy}>
          {editing
            ? isEnglish
              ? 'Close editor'
              : 'إغلاق التعديل'
            : isEnglish
              ? 'Edit access'
              : 'تعديل الوصول'}
        </Button>
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          onClick={() => void onToggle()}
          disabled={busy}
        >
          {enabled
            ? isEnglish
              ? 'Suspend access'
              : 'تعليق الوصول'
            : isEnglish
              ? 'Restore access'
              : 'استعادة الوصول'}
        </Button>
      </div>
      {editing ? (
        <form
          className="staff-card__editor"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const scoped = selectedRole?.scopeMode === 'branch_area_route';
            void onUpdate({
              roleKey,
              scope: scoped ? { routeIds } : {},
              active: member.active,
              reason: String(data.get('reason') ?? ''),
            }).then(() => setEditing(false));
          }}
        >
          <label>
            <span>{isEnglish ? 'Role preset' : 'الدور المعتمد'}</span>
            <select value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
              {roles.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {roleLabel(candidate.key, locale)}
                </option>
              ))}
            </select>
          </label>
          {selectedRole?.scopeMode === 'branch_area_route' ? (
            <label>
              <span>{isEnglish ? 'Authorized route IDs' : 'معرّفات المسارات المصرح بها'}</span>
              <select
                multiple
                value={[...routeIds]}
                onChange={(event) =>
                  setRouteIds(
                    [...event.currentTarget.selectedOptions].map((option) => option.value),
                  )
                }
                required
              >
                {scopes.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.code} · {isEnglish ? route.nameEn : route.nameAr}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>{isEnglish ? 'Reason for change' : 'سبب التغيير'}</span>
            <input name="reason" required minLength={8} maxLength={500} />
          </label>
          <Button variant="primary" type="submit" disabled={busy || !selectedRole}>
            {isEnglish ? 'Apply and revoke sessions' : 'تطبيق وإلغاء الجلسات'}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function roleLabel(roleKey: string, locale: Locale): string {
  return roleLabels[roleKey]?.[locale] ?? roleKey.replaceAll('_', ' ');
}

function invitationStatus(status: TenantStaffInvitation['status'], locale: Locale): string {
  const labels = {
    pending: { en: 'Pending', ar: 'معلقة' },
    accepted: { en: 'Accepted', ar: 'مقبولة' },
    revoked: { en: 'Revoked', ar: 'ملغاة' },
    expired: { en: 'Expired', ar: 'منتهية' },
  } as const;
  return labels[status][locale];
}
