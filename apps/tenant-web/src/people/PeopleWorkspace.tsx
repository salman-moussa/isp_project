import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import type { EmployeeRecord, LeaveRecord, PeopleWorkspace as Workspace } from '@isp/contracts';
import { readPeopleWorkspace, submitTenantOperation } from '../api';
import '../regulatory/regulatory.css';

type View = 'people' | 'schedule' | 'leave' | 'training';

export function PeopleWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const en = locale === 'en';
  const t = (english: string, arabic: string) => (en ? english : arabic);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View>('people');
  const [refresh, setRefresh] = useState(0);
  const [window, setWindow] = useState<{ from: string; to: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<
    'team' | 'employee' | 'shift' | 'leave' | 'training' | null
  >(null);
  const [selected, setSelected] = useState<EmployeeRecord>();
  const mounted = useRef(true);
  const locked = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState((current) => (current === 'ready' ? current : 'loading'));
    void readPeopleWorkspace(session, window ?? {})
      .then((result) => {
        if (active) {
          setData(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [session, refresh, window]);
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString(en ? 'en-GB' : 'ar-LB', { dateStyle: 'medium' })
      : '—';
  const time = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(en ? 'en-GB' : 'ar-LB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';
  const field = (form: FormData, key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const optional = (form: FormData, key: string) => {
    const value = field(form, key);
    return value ? { [key]: value } : {};
  };
  const idempotency = (fingerprint: string) => {
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-people-${crypto.randomUUID()}` };
    return retry.current.key;
  };
  async function command(
    body: Record<string, unknown>,
    done: (result: Record<string, unknown>) => void,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await submitTenantOperation(
        session,
        'people/commands',
        { command: body },
        idempotency(JSON.stringify(body)),
      );
      retry.current = undefined;
      if (mounted.current) {
        done(result);
        setRefresh((v) => v + 1);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const statusLabel = (value: string) =>
    ({
      active: t('Active', 'نشط'),
      on_leave: t('On leave', 'في إجازة'),
      suspended: t('Suspended', 'موقوف'),
      left: t('Left', 'غادر'),
      requested: t('Requested', 'مطلوبة'),
      approved: t('Approved', 'موافق عليها'),
      rejected: t('Rejected', 'مرفوضة'),
      cancelled: t('Cancelled', 'ملغاة'),
    })[value] ?? value;
  const kindLabel = (value: string) =>
    ({
      shift: t('Shift', 'مناوبة'),
      on_call: t('On call', 'استدعاء'),
      annual: t('Annual', 'سنوية'),
      sick: t('Sick', 'مرضية'),
      unpaid: t('Unpaid', 'غير مدفوعة'),
      compassionate: t('Compassionate', 'ظرف عائلي'),
      other: t('Other', 'أخرى'),
      training: t('Training', 'تدريب'),
      certification: t('Certification', 'شهادة'),
      safety: t('Safety', 'سلامة'),
      induction: t('Induction', 'تعريف'),
    })[value] ?? value;
  const active = data?.employees.filter((e) => e.status !== 'left') ?? [];
  const onShift = active.filter((e) => e.onShiftNow).length;
  const onLeave = active.filter((e) => e.onLeaveToday).length;
  const pendingLeave = data?.leave.filter((l) => l.status === 'requested').length ?? 0;
  const expiring = data?.training.filter((r) => r.expiringSoon || r.expired).length ?? 0;
  const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

  function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const branchId = field(form, 'branchId');
    void command(
      {
        action: 'upsert_team',
        code: field(form, 'code'),
        nameEn: field(form, 'nameEn'),
        nameAr: field(form, 'nameAr'),
        ...(branchId ? { branchId } : {}),
      },
      () => {
        setEditing(null);
        setNotice(t('Team saved.', 'حُفظ الفريق.'));
      },
    );
  }
  function submitEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = field(form, 'userId');
    const teamId = field(form, 'teamId');
    const branchId = field(form, 'branchId');
    const skills = field(form, 'skills')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    void command(
      {
        action: 'upsert_employee',
        ...(selected ? { employeeId: selected.id, expectedVersion: selected.version } : {}),
        employeeNumber: field(form, 'employeeNumber'),
        ...(userId ? { userId } : {}),
        displayName: field(form, 'displayName'),
        roleTitle: field(form, 'roleTitle'),
        ...(teamId ? { teamId } : {}),
        ...(branchId ? { branchId } : {}),
        ...optional(form, 'phone'),
        ...optional(form, 'email'),
        ...optional(form, 'hiredOn'),
        status: field(form, 'status') || 'active',
        skills,
      },
      () => {
        setEditing(null);
        setSelected(undefined);
        setNotice(t('Employee saved.', 'حُفظ الموظف.'));
      },
    );
  }
  function submitShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'schedule_shift',
        employeeId: field(form, 'employeeId'),
        kind: field(form, 'kind') || 'shift',
        startsAt: toIso(field(form, 'startsAt')),
        endsAt: toIso(field(form, 'endsAt')),
        ...optional(form, 'locationNote'),
      },
      () => {
        setEditing(null);
        setNotice(t('Shift scheduled.', 'جُدولت المناوبة.'));
      },
    );
  }
  function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'request_leave',
        employeeId: field(form, 'employeeId'),
        kind: field(form, 'kind') || 'annual',
        startsOn: field(form, 'startsOn'),
        endsOn: field(form, 'endsOn'),
        ...optional(form, 'reason'),
      },
      () => {
        setEditing(null);
        setNotice(t('Leave requested.', 'طُلبت الإجازة.'));
      },
    );
  }
  function submitTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command(
      {
        action: 'record_training',
        employeeId: field(form, 'employeeId'),
        title: field(form, 'title'),
        kind: field(form, 'kind') || 'training',
        completedOn: field(form, 'completedOn'),
        ...optional(form, 'expiresOn'),
        ...optional(form, 'provider'),
        ...optional(form, 'reference'),
      },
      () => {
        setEditing(null);
        setNotice(t('Training recorded.', 'سُجل التدريب.'));
      },
    );
  }
  function decideLeave(leave: LeaveRecord, status: 'approved' | 'rejected' | 'cancelled') {
    void command(
      { action: 'decide_leave', leaveId: leave.id, expectedVersion: leave.version, status },
      () => setNotice(t('Leave request updated.', 'حُدّث طلب الإجازة.')),
    );
  }
  function cancelShift(shiftId: string) {
    const reason =
      globalThis.prompt?.(t('Reason for cancelling the shift', 'سبب إلغاء المناوبة')) ?? '';
    if (reason.trim().length < 8) return;
    void command({ action: 'cancel_shift', shiftId, reason: reason.trim() }, () =>
      setNotice(t('Shift cancelled.', 'أُلغيت المناوبة.')),
    );
  }
  const employeeOptions = active.map((e) => (
    <option key={e.id} value={e.id}>
      {e.displayName} · {e.employeeNumber}
    </option>
  ));

  return (
    <div className="reg-shell" dir={en ? 'ltr' : 'rtl'} aria-busy={busy}>
      <header className="reg-hero">
        <div>
          <span>{t('People & shifts', 'الفريق والمناوبات')}</span>
          <h1>
            {t(
              'Who is on, who is off, and who is certified',
              'من على المناوبة، ومن في إجازة، ومن حاصل على الشهادة',
            )}
          </h1>
          <p>
            {t(
              'One employee record per person, linked to their staff sign-in when they have one. Shifts and on-call cannot overlap or fall on approved leave, leave is decided by someone else, and training expiry is visible before it lapses.',
              'سجل موظف واحد لكل شخص، مرتبط بحساب الموظف إن وُجد. لا تتداخل المناوبات ولا تقع على إجازة معتمدة، ويقرر الإجازة شخص آخر، ويظهر انتهاء التدريب قبل سقوطه.',
            )}
          </p>
        </div>
        <dl className="reg-stats">
          <div>
            <dt>{t('On shift now', 'على المناوبة الآن')}</dt>
            <dd>{onShift}</dd>
          </div>
          <div>
            <dt>{t('On leave today', 'في إجازة اليوم')}</dt>
            <dd>{onLeave}</dd>
          </div>
          <div className={pendingLeave ? 'is-alert' : ''}>
            <dt>{t('Leave to decide', 'إجازات للبت')}</dt>
            <dd>{pendingLeave}</dd>
          </div>
          <div className={expiring ? 'is-alert' : ''}>
            <dt>{t('Training expiring', 'تدريب ينتهي')}</dt>
            <dd>{expiring}</dd>
          </div>
        </dl>
      </header>
      {state === 'error' && (
        <div className="reg-banner is-error" role="alert">
          {t('The people workspace could not be read.', 'تعذّرت قراءة مساحة الفريق.')}
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}
      {error && (
        <div className="reg-banner is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="reg-banner" role="status">
          {notice}
        </div>
      )}
      <nav className="reg-views" aria-label={t('People views', 'عروض الفريق')}>
        {(
          [
            ['people', t('People & teams', 'الأشخاص والفرق')],
            ['schedule', t('Schedule', 'الجدول')],
            ['leave', t('Leave', 'الإجازات')],
            ['training', t('Training', 'التدريب')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'people' && data && (
        <section className="reg-panel" aria-label={t('People & teams', 'الأشخاص والفرق')}>
          <div className="reg-section-head">
            <h2>{t('Employees', 'الموظفون')}</h2>
            <div className="reg-inline">
              <button type="button" onClick={() => setEditing(editing === 'team' ? null : 'team')}>
                {t('Add team', 'إضافة فريق')}
              </button>
              <button
                type="button"
                className="reg-primary"
                onClick={() => {
                  setSelected(undefined);
                  setEditing(editing === 'employee' ? null : 'employee');
                }}
              >
                {t('Add employee', 'إضافة موظف')}
              </button>
            </div>
          </div>
          {editing === 'team' && (
            <form className="reg-form" onSubmit={submitTeam}>
              <label>
                {t('Code', 'الرمز')}
                <input name="code" required pattern="[A-Za-z0-9_-]{2,40}" />
              </label>
              <label>
                {t('Name (EN)', 'الاسم (إنجليزي)')}
                <input name="nameEn" required />
              </label>
              <label>
                {t('Name (AR)', 'الاسم (عربي)')}
                <input name="nameAr" required />
              </label>
              <label>
                {t('Branch', 'الفرع')}
                <select name="branchId" defaultValue="">
                  <option value="">{t('Any', 'أي')}</option>
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {en ? b.nameEn : b.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Save team', 'حفظ الفريق')}
              </button>
            </form>
          )}
          {editing === 'employee' && (
            <form className="reg-form" onSubmit={submitEmployee} key={selected?.id ?? 'new'}>
              <label>
                {t('Employee number', 'رقم الموظف')}
                <input
                  name="employeeNumber"
                  required
                  maxLength={40}
                  defaultValue={selected?.employeeNumber}
                />
              </label>
              <label>
                {t('Name', 'الاسم')}
                <input
                  name="displayName"
                  required
                  maxLength={120}
                  defaultValue={selected?.displayName}
                />
              </label>
              <label>
                {t('Role title', 'المسمى الوظيفي')}
                <input
                  name="roleTitle"
                  required
                  maxLength={120}
                  defaultValue={selected?.roleTitle}
                />
              </label>
              <label>
                {t('Staff sign-in', 'حساب الموظف')}
                <select name="userId" defaultValue={selected?.userId ?? ''}>
                  <option value="">{t('No sign-in', 'بلا حساب')}</option>
                  {data.members
                    .filter((m) => !m.linked || m.userId === selected?.userId)
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} · {m.roleKey}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('Team', 'الفريق')}
                <select name="teamId" defaultValue={selected?.teamId ?? ''}>
                  <option value="">—</option>
                  {data.teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {en ? tm.nameEn : tm.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Branch', 'الفرع')}
                <select name="branchId" defaultValue={selected?.branchId ?? ''}>
                  <option value="">—</option>
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {en ? b.nameEn : b.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Phone', 'الهاتف')}
                <input name="phone" placeholder="+9613…" defaultValue={selected?.phone ?? ''} />
              </label>
              <label>
                {t('Email', 'البريد')}
                <input name="email" type="email" defaultValue={selected?.email ?? ''} />
              </label>
              <label>
                {t('Hired on', 'تاريخ التوظيف')}
                <input name="hiredOn" type="date" defaultValue={selected?.hiredOn ?? ''} />
              </label>
              <label>
                {t('Status', 'الحالة')}
                <select name="status" defaultValue={selected?.status ?? 'active'}>
                  {['active', 'on_leave', 'suspended', 'left'].map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reg-span">
                {t('Skills (comma separated)', 'المهارات (مفصولة بفواصل)')}
                <input name="skills" defaultValue={selected?.skills.join(', ') ?? ''} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {selected ? t('Save changes', 'حفظ التغييرات') : t('Add employee', 'إضافة موظف')}
              </button>
            </form>
          )}
          {data.teams.length > 0 && (
            <ul className="reg-inline">
              {data.teams.map((tm) => (
                <li key={tm.id} className="reg-pill">
                  {en ? tm.nameEn : tm.nameAr} · {tm.members} {t('members', 'أعضاء')}
                  {tm.leadName ? ` · ${t('lead', 'القائد')} ${tm.leadName}` : ''}
                </li>
              ))}
            </ul>
          )}
          {data.employees.length === 0 ? (
            <p className="reg-note">{t('No employee recorded yet.', 'لم يُسجَّل أي موظف بعد.')}</p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Employee', 'الموظف')}</th>
                    <th>{t('Role', 'الدور')}</th>
                    <th>{t('Team', 'الفريق')}</th>
                    <th>{t('Sign-in', 'الحساب')}</th>
                    <th>{t('Today', 'اليوم')}</th>
                    <th>{t('Skills', 'المهارات')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className={e.status === 'left' ? 'is-muted' : ''}>
                      <td>
                        <strong>{e.displayName}</strong>
                        <small>
                          {e.employeeNumber}
                          {e.phone ? ` · ${e.phone}` : ''}
                        </small>
                      </td>
                      <td>
                        {e.roleTitle}
                        <small>{statusLabel(e.status)}</small>
                      </td>
                      <td>
                        {e.teamCode ?? '—'}
                        <small>{e.branchName ?? ''}</small>
                      </td>
                      <td>
                        {e.userName ?? t('none', 'لا يوجد')}
                        {e.technician ? ` · ${t('technician', 'فني')}` : ''}
                      </td>
                      <td>
                        {e.onLeaveToday ? (
                          <span className="reg-pill is-bad">{t('On leave', 'في إجازة')}</span>
                        ) : e.onShiftNow ? (
                          <span className="reg-pill is-ok">{t('On shift', 'على المناوبة')}</span>
                        ) : (
                          '—'
                        )}
                        {e.expiringTraining > 0 && (
                          <small>
                            {e.expiringTraining} {t('training expiring', 'تدريب ينتهي')}
                          </small>
                        )}
                      </td>
                      <td>{e.skills.join(', ')}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(e);
                            setEditing('employee');
                          }}
                        >
                          {t('Edit', 'تعديل')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'schedule' && data && (
        <section className="reg-panel" aria-label={t('Schedule', 'الجدول')}>
          <div className="reg-section-head">
            <div>
              <h2>{t('Shifts and on-call', 'المناوبات والاستدعاء')}</h2>
              <p className="reg-note">
                {date(data.from)} → {date(data.to)}
              </p>
            </div>
            <form
              className="reg-inline"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                setWindow({ from: field(form, 'from'), to: field(form, 'to') });
              }}
            >
              <label>
                {t('From', 'من')}
                <input name="from" type="date" defaultValue={data.from} required />
              </label>
              <label>
                {t('To', 'إلى')}
                <input name="to" type="date" defaultValue={data.to} required />
              </label>
              <button type="submit">{t('Show', 'عرض')}</button>
              <button
                type="button"
                className="reg-primary"
                onClick={() => setEditing(editing === 'shift' ? null : 'shift')}
              >
                {t('Schedule shift', 'جدولة مناوبة')}
              </button>
            </form>
          </div>
          {editing === 'shift' && (
            <form className="reg-form" onSubmit={submitShift}>
              <label>
                {t('Employee', 'الموظف')}
                <select name="employeeId" required>
                  {employeeOptions}
                </select>
              </label>
              <label>
                {t('Kind', 'النوع')}
                <select name="kind" defaultValue="shift">
                  <option value="shift">{kindLabel('shift')}</option>
                  <option value="on_call">{kindLabel('on_call')}</option>
                </select>
              </label>
              <label>
                {t('Starts', 'البداية')}
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                {t('Ends', 'النهاية')}
                <input name="endsAt" type="datetime-local" required />
              </label>
              <label>
                {t('Location note', 'ملاحظة الموقع')}
                <input name="locationNote" maxLength={200} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Schedule', 'جدولة')}
              </button>
            </form>
          )}
          {data.shifts.length === 0 ? (
            <p className="reg-note">{t('No shift in this window.', 'لا مناوبة في هذه النافذة.')}</p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Employee', 'الموظف')}</th>
                    <th>{t('Kind', 'النوع')}</th>
                    <th>{t('Starts', 'البداية')}</th>
                    <th>{t('Ends', 'النهاية')}</th>
                    <th>{t('Note', 'ملاحظة')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.shifts.map((s) => (
                    <tr key={s.id} className={s.cancelledAt ? 'is-muted' : ''}>
                      <td>{s.employeeName}</td>
                      <td>{kindLabel(s.kind)}</td>
                      <td>{time(s.startsAt)}</td>
                      <td>{time(s.endsAt)}</td>
                      <td>
                        {s.cancelledAt
                          ? `${t('Cancelled', 'ملغاة')} · ${s.cancelReason ?? ''}`
                          : (s.locationNote ?? '—')}
                      </td>
                      <td>
                        {!s.cancelledAt && (
                          <button type="button" onClick={() => cancelShift(s.id)}>
                            {t('Cancel', 'إلغاء')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'leave' && data && (
        <section className="reg-panel" aria-label={t('Leave', 'الإجازات')}>
          <div className="reg-section-head">
            <h2>{t('Leave requests', 'طلبات الإجازة')}</h2>
            <button
              type="button"
              className="reg-primary"
              onClick={() => setEditing(editing === 'leave' ? null : 'leave')}
            >
              {t('Request leave', 'طلب إجازة')}
            </button>
          </div>
          {editing === 'leave' && (
            <form className="reg-form" onSubmit={submitLeave}>
              <label>
                {t('Employee', 'الموظف')}
                <select name="employeeId" required>
                  {employeeOptions}
                </select>
              </label>
              <label>
                {t('Kind', 'النوع')}
                <select name="kind" defaultValue="annual">
                  {['annual', 'sick', 'unpaid', 'compassionate', 'other'].map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('From', 'من')}
                <input name="startsOn" type="date" required />
              </label>
              <label>
                {t('To', 'إلى')}
                <input name="endsOn" type="date" required />
              </label>
              <label className="reg-span">
                {t('Reason', 'السبب')}
                <input name="reason" maxLength={1000} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Submit request', 'إرسال الطلب')}
              </button>
            </form>
          )}
          {data.leave.length === 0 ? (
            <p className="reg-note">{t('No leave request on record.', 'لا طلب إجازة مسجل.')}</p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Employee', 'الموظف')}</th>
                    <th>{t('Kind', 'النوع')}</th>
                    <th>{t('Dates', 'التواريخ')}</th>
                    <th>{t('Requested by', 'طلبها')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.leave.map((l) => (
                    <tr key={l.id}>
                      <td>{l.employeeName}</td>
                      <td>
                        {kindLabel(l.kind)}
                        <small>{l.reason ?? ''}</small>
                      </td>
                      <td>
                        {date(l.startsOn)} → {date(l.endsOn)}
                      </td>
                      <td>
                        {l.requestedBy}
                        <small>{time(l.requestedAt)}</small>
                      </td>
                      <td>
                        <span
                          className={`reg-pill ${l.status === 'approved' ? 'is-ok' : l.status === 'rejected' ? 'is-bad' : ''}`}
                        >
                          {statusLabel(l.status)}
                        </span>
                        {l.decidedBy && (
                          <small>
                            {l.decidedBy}
                            {l.decisionNote ? ` · ${l.decisionNote}` : ''}
                          </small>
                        )}
                      </td>
                      <td className="reg-inline">
                        {l.status === 'requested' && (
                          <>
                            <button type="button" onClick={() => decideLeave(l, 'approved')}>
                              {t('Approve', 'موافقة')}
                            </button>
                            <button type="button" onClick={() => decideLeave(l, 'rejected')}>
                              {t('Reject', 'رفض')}
                            </button>
                            <button type="button" onClick={() => decideLeave(l, 'cancelled')}>
                              {t('Withdraw', 'سحب')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'training' && data && (
        <section className="reg-panel" aria-label={t('Training', 'التدريب')}>
          <div className="reg-section-head">
            <h2>{t('Training and certifications', 'التدريب والشهادات')}</h2>
            <button
              type="button"
              className="reg-primary"
              onClick={() => setEditing(editing === 'training' ? null : 'training')}
            >
              {t('Record training', 'تسجيل تدريب')}
            </button>
          </div>
          {editing === 'training' && (
            <form className="reg-form" onSubmit={submitTraining}>
              <label>
                {t('Employee', 'الموظف')}
                <select name="employeeId" required>
                  {employeeOptions}
                </select>
              </label>
              <label>
                {t('Title', 'العنوان')}
                <input name="title" required maxLength={200} />
              </label>
              <label>
                {t('Kind', 'النوع')}
                <select name="kind" defaultValue="training">
                  {['training', 'certification', 'safety', 'induction'].map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Provider', 'الجهة')}
                <input name="provider" maxLength={160} />
              </label>
              <label>
                {t('Completed on', 'تاريخ الإكمال')}
                <input name="completedOn" type="date" required />
              </label>
              <label>
                {t('Expires on', 'تاريخ الانتهاء')}
                <input name="expiresOn" type="date" />
              </label>
              <label>
                {t('Reference', 'المرجع')}
                <input name="reference" maxLength={200} />
              </label>
              <button type="submit" className="reg-primary" disabled={busy}>
                {t('Record', 'تسجيل')}
              </button>
            </form>
          )}
          {data.training.length === 0 ? (
            <p className="reg-note">{t('No training recorded yet.', 'لم يُسجَّل أي تدريب بعد.')}</p>
          ) : (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th>{t('Employee', 'الموظف')}</th>
                    <th>{t('Training', 'التدريب')}</th>
                    <th>{t('Completed', 'أُكمل')}</th>
                    <th>{t('Expires', 'ينتهي')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.training.map((r) => (
                    <tr key={r.id}>
                      <td>{r.employeeName}</td>
                      <td>
                        <strong>{r.title}</strong>
                        <small>
                          {kindLabel(r.kind)}
                          {r.provider ? ` · ${r.provider}` : ''}
                          {r.reference ? ` · ${r.reference}` : ''}
                        </small>
                      </td>
                      <td>{date(r.completedOn)}</td>
                      <td>{date(r.expiresOn)}</td>
                      <td>
                        <span
                          className={`reg-pill ${r.expired ? 'is-bad' : r.expiringSoon ? '' : 'is-ok'}`}
                        >
                          {r.expired
                            ? t('Expired', 'منتهٍ')
                            : r.expiringSoon
                              ? t('Expiring soon', 'ينتهي قريباً')
                              : t('Valid', 'ساري')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
