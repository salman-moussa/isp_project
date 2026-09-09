import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import type {
  CollectionAssignmentRecord,
  CollectionsWorkspace as Workspace,
  RouteSettlementRecord,
} from '@isp/contracts';
import {
  approveDeviceReconciliation,
  readCollectionsWorkspace,
  submitTenantOperation,
} from '../api';
import { accountMoney, parseAccountAmount } from '../billing/account-money';
import { MfaStepUp } from '../cashier/MfaStepUp';
import './collections.css';

type View = 'routes' | 'assignments' | 'settlements' | 'devices';
type Currency = 'USD' | 'LBP';
type AssignmentAction = 'record' | 'reassign' | 'cancel';

export function CollectionsWorkspace({
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
  const [view, setView] = useState<View>('assignments');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'open' | 'collected' | 'all'>('open');
  const [acting, setActing] = useState<{
    assignment: CollectionAssignmentRecord;
    action: AssignmentAction;
  }>();
  const [approving, setApproving] = useState<RouteSettlementRecord>();
  const [settling, setSettling] = useState(false);
  const [bulkRoute, setBulkRoute] = useState<string>();
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
    void readCollectionsWorkspace(session)
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
  }, [session, refresh]);
  const money = useCallback(
    (minor: number, unit: Currency) => accountMoney(minor, unit, locale),
    [locale],
  );
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
  const today = new Date().toISOString().slice(0, 10);
  const idempotency = (fingerprint: string) => {
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-collections-${crypto.randomUUID()}` };
    return retry.current.key;
  };
  async function run(
    work: (key: string) => Promise<Record<string, unknown>>,
    fingerprint: string,
    done: (result: Record<string, unknown>) => void,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work(idempotency(fingerprint));
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
  const command = (
    path: string,
    body: Record<string, unknown>,
    done: (r: Record<string, unknown>) => void,
  ) =>
    run(
      (key) => submitTenantOperation(session, path, { command: body }, key),
      JSON.stringify({ path, body }),
      done,
    );
  const statusLabel = (value: CollectionAssignmentRecord['status']) =>
    ({
      assigned: t('Assigned', 'مُسند'),
      visited: t('Visited', 'تمت الزيارة'),
      returned: t('Returned', 'أُعيد'),
      collected: t('Collected', 'حُصّل'),
      cancelled: t('Cancelled', 'ملغى'),
    })[value];
  const settlementStatus = (value: RouteSettlementRecord['status']) =>
    ({
      accepted: t('Accepted', 'مقبول'),
      pending_approval: t('Awaiting approval', 'بانتظار الموافقة'),
      approved: t('Approved', 'موافق عليه'),
    })[value];
  const assignments = (data?.assignments ?? []).filter((a) =>
    filter === 'all'
      ? true
      : filter === 'open'
        ? ['assigned', 'visited', 'returned'].includes(a.status)
        : a.status === 'collected',
  );
  const overdue = (a: CollectionAssignmentRecord) =>
    a.status !== 'collected' && a.status !== 'cancelled' && a.dueOn < today;
  const pendingSettlements =
    data?.settlements.filter((s) => s.status === 'pending_approval').length ?? 0;
  const openCount =
    data?.assignments.filter((a) => ['assigned', 'visited', 'returned'].includes(a.status))
      .length ?? 0;
  const overdueCount = data?.assignments.filter(overdue).length ?? 0;

  function submitAssignmentAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acting) return;
    const form = new FormData(event.currentTarget);
    const { assignment, action } = acting;
    if (action === 'record') {
      const amountText = field(form, 'amount');
      const receiptNumber = field(form, 'receiptNumber');
      const amountMinor = amountText
        ? parseAccountAmount(amountText, assignment.currency)
        : undefined;
      void command(
        'collections/record',
        {
          action: 'record_collection',
          assignmentId: assignment.id,
          ...(amountMinor ? { amountMinor } : {}),
          ...(receiptNumber ? { receiptNumber } : {}),
        },
        (result) => {
          setActing(undefined);
          setNotice(
            `${t('Collection posted as receipt', 'رُحّل التحصيل كإيصال')} ${String(result.receiptNumber)}.`,
          );
        },
      );
    } else if (action === 'reassign') {
      const collectorUserId = field(form, 'collectorUserId');
      const dueOn = field(form, 'dueOn');
      void command(
        'collections/commands',
        {
          action: 'reassign',
          assignmentId: assignment.id,
          ...(collectorUserId ? { collectorUserId } : {}),
          ...(dueOn ? { dueOn } : {}),
        },
        () => {
          setActing(undefined);
          setNotice(t('Assignment updated.', 'حُدّث الإسناد.'));
        },
      );
    } else {
      void command(
        'collections/commands',
        { action: 'cancel_assignment', assignmentId: assignment.id, reason: field(form, 'reason') },
        () => {
          setActing(undefined);
          setNotice(t('Assignment cancelled.', 'أُلغي الإسناد.'));
        },
      );
    }
  }
  function submitBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bulkRoute) return;
    const form = new FormData(event.currentTarget);
    const collectorUserId = field(form, 'collectorUserId');
    void command(
      'collections/commands',
      {
        action: 'assign_route_due',
        routeId: bulkRoute,
        dueOn: field(form, 'dueOn'),
        ...(collectorUserId ? { collectorUserId } : {}),
      },
      (result) => {
        setBulkRoute(undefined);
        setNotice(`${String(result.assigned)} ${t('invoices assigned.', 'فاتورة أُسندت.')}`);
      },
    );
  }
  function submitSettle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currency = field(form, 'currency') as Currency;
    const reason = field(form, 'reason');
    void command(
      'collections/commands',
      {
        action: 'settle_route',
        routeId: field(form, 'routeId'),
        collectorUserId: field(form, 'collectorUserId'),
        businessDate: field(form, 'businessDate'),
        currency,
        declaredMinor: parseAccountAmount(field(form, 'declared') || '0', currency),
        ...(reason ? { reason } : {}),
      },
      (result) => {
        setSettling(false);
        setNotice(
          result.status === 'accepted'
            ? t(
                'Settlement accepted: declared cash matches the receipts.',
                'قُبلت التسوية: النقد المصرّح يطابق الإيصالات.',
              )
            : `${t('Difference of', 'فرق قدره')} ${money(Number(result.differenceMinor), currency)} ${t('recorded and awaiting approval.', 'سُجّل وينتظر الموافقة.')}`,
        );
      },
    );
  }
  function submitApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approving) return;
    const reason = field(new FormData(event.currentTarget), 'reason');
    const target = approving;
    void run(
      (key) =>
        target.source === 'device'
          ? approveDeviceReconciliation(session, target.id, reason, key)
          : submitTenantOperation(
              session,
              'collections/approve',
              {
                command: {
                  action: 'approve_settlement',
                  settlementId: target.id,
                  expectedVersion: target.version,
                  reason,
                },
              },
              key,
            ),
      JSON.stringify({ approve: target.id, reason }),
      () => {
        setApproving(undefined);
        setNotice(t('Difference approved.', 'تمت الموافقة على الفرق.'));
      },
    );
  }

  return (
    <div className="col-shell" dir={en ? 'ltr' : 'rtl'} aria-busy={busy}>
      <header className="col-hero">
        <div>
          <span>{t('Collectors', 'الجباة')}</span>
          <h1>{t('Field collections', 'التحصيل الميداني')}</h1>
          <p>
            {t(
              'Each route has a collector. Open invoices are assigned with their real balance, cash is posted as receipts, and the day is settled against what was actually collected; any difference is kept and approved by a second manager.',
              'لكل مسار جابٍ. تُسند الفواتير المفتوحة برصيدها الحقيقي، ويُرحَّل النقد كإيصالات، ويُسوّى اليوم مقابل ما حُصّل فعلاً؛ أي فرق يُحفظ ويوافق عليه مدير ثانٍ.',
            )}
          </p>
        </div>
        <dl className="col-stats">
          <div>
            <dt>{t('Open assignments', 'إسنادات مفتوحة')}</dt>
            <dd>{openCount}</dd>
          </div>
          <div className={overdueCount ? 'is-alert' : ''}>
            <dt>{t('Overdue', 'متأخرة')}</dt>
            <dd>{overdueCount}</dd>
          </div>
          <div className={pendingSettlements ? 'is-alert' : ''}>
            <dt>{t('Awaiting approval', 'بانتظار الموافقة')}</dt>
            <dd>{pendingSettlements}</dd>
          </div>
          <div>
            <dt>{t('Active devices', 'أجهزة نشطة')}</dt>
            <dd>{data?.devices.filter((d) => d.status === 'active').length ?? 0}</dd>
          </div>
        </dl>
      </header>

      {state === 'error' && (
        <div className="col-banner is-error" role="alert">
          {t('The collections workspace could not be read.', 'تعذّرت قراءة مساحة التحصيل.')}
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}
      {error && (
        <div className="col-banner is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="col-banner" role="status">
          {notice}
        </div>
      )}

      <nav className="col-views" aria-label={t('Collection views', 'عروض التحصيل')}>
        {(
          [
            ['assignments', t('Assignments', 'الإسنادات')],
            ['routes', t('Routes & collectors', 'المسارات والجباة')],
            ['settlements', t('Settlements', 'التسويات')],
            ['devices', t('Collect devices', 'أجهزة التحصيل')],
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

      {view === 'assignments' && (
        <section className="col-panel" aria-label={t('Assignments', 'الإسنادات')}>
          <div className="col-section-head">
            <h2>{t('Assignments', 'الإسنادات')}</h2>
            <div className="col-filters" role="group" aria-label={t('Filter', 'تصفية')}>
              {(
                [
                  ['open', t('Open', 'مفتوحة')],
                  ['collected', t('Collected', 'محصّلة')],
                  ['all', t('All', 'الكل')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {acting && (
            <form className="col-form col-inline" onSubmit={submitAssignmentAction}>
              <strong>
                {acting.assignment.subscriberName} · {acting.assignment.documentNumber} ·{' '}
                <span dir="ltr">
                  {money(acting.assignment.openMinor, acting.assignment.currency)}
                </span>
              </strong>
              {acting.action === 'record' && (
                <>
                  <label>
                    {t(
                      'Amount handed in (blank = full balance)',
                      'المبلغ المسلّم (فارغ = الرصيد كاملاً)',
                    )}
                    <input name="amount" inputMode="decimal" autoFocus />
                  </label>
                  <label>
                    {t('Receipt number from the book', 'رقم الإيصال من الدفتر')}
                    <input
                      name="receiptNumber"
                      maxLength={120}
                      placeholder={t('blank = issued by the system', 'فارغ = يصدره النظام')}
                    />
                  </label>
                  <button type="submit" className="col-primary" disabled={busy}>
                    {t('Post collection', 'ترحيل التحصيل')}
                  </button>
                </>
              )}
              {acting.action === 'reassign' && (
                <>
                  <label>
                    {t('Collector', 'الجابي')}
                    <select name="collectorUserId" defaultValue={acting.assignment.collectorUserId}>
                      {data?.collectors.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Due on', 'تاريخ الاستحقاق')}
                    <input name="dueOn" type="date" defaultValue={acting.assignment.dueOn} />
                  </label>
                  <button type="submit" className="col-primary" disabled={busy}>
                    {t('Save', 'حفظ')}
                  </button>
                </>
              )}
              {acting.action === 'cancel' && (
                <>
                  <label>
                    {t('Reason', 'السبب')}
                    <input name="reason" minLength={8} maxLength={1000} required autoFocus />
                  </label>
                  <button type="submit" className="col-primary" disabled={busy}>
                    {t('Cancel assignment', 'إلغاء الإسناد')}
                  </button>
                </>
              )}
              <button type="button" onClick={() => setActing(undefined)}>
                {t('Back', 'رجوع')}
              </button>
            </form>
          )}
          {data && assignments.length === 0 ? (
            <p className="col-note">
              {t('Nothing here for this filter.', 'لا شيء ضمن هذه التصفية.')}
            </p>
          ) : (
            <div className="col-table-wrap">
              <table className="col-table">
                <thead>
                  <tr>
                    <th>{t('Due', 'الاستحقاق')}</th>
                    <th>{t('Subscriber', 'المشترك')}</th>
                    <th>{t('Route', 'المسار')}</th>
                    <th>{t('Collector', 'الجابي')}</th>
                    <th>{t('Invoice', 'الفاتورة')}</th>
                    <th>{t('Open balance', 'الرصيد المفتوح')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id} className={overdue(a) ? 'is-overdue' : ''}>
                      <td>{date(a.dueOn)}</td>
                      <td>
                        {a.subscriberName}
                        <small>
                          {a.subscriberNumber}
                          {a.phone ? ` · ${a.phone}` : ''}
                        </small>
                      </td>
                      <td>{a.routeCode}</td>
                      <td>{a.collectorName ?? '—'}</td>
                      <td>{a.documentNumber}</td>
                      <td dir="ltr">
                        {a.status === 'collected' && a.collectedMinor !== null
                          ? `${money(a.collectedMinor, a.currency)} · ${a.receiptNumber ?? ''}`
                          : money(a.openMinor, a.currency)}
                      </td>
                      <td>
                        <span className={`col-pill is-${a.status}`}>{statusLabel(a.status)}</span>
                        {a.collectedAt && <small>{time(a.collectedAt)}</small>}
                      </td>
                      <td className="col-actions">
                        {['assigned', 'visited', 'returned'].includes(a.status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => setActing({ assignment: a, action: 'record' })}
                            >
                              {t('Record cash', 'تسجيل النقد')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setActing({ assignment: a, action: 'reassign' })}
                            >
                              {t('Reassign', 'إعادة إسناد')}
                            </button>
                            {a.status === 'assigned' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void command(
                                    'collections/commands',
                                    { action: 'mark_visited', assignmentId: a.id },
                                    () => setNotice(t('Marked as visited.', 'سُجّلت الزيارة.')),
                                  )
                                }
                              >
                                {t('Visited', 'تمت الزيارة')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setActing({ assignment: a, action: 'cancel' })}
                            >
                              {t('Cancel', 'إلغاء')}
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

      {view === 'routes' && (
        <section className="col-panel" aria-label={t('Routes & collectors', 'المسارات والجباة')}>
          <h2>{t('Routes & collectors', 'المسارات والجباة')}</h2>
          {bulkRoute && (
            <form className="col-form col-inline" onSubmit={submitBulk}>
              <strong>
                {t('Assign every open invoice on route', 'إسناد كل فاتورة مفتوحة على المسار')}{' '}
                {data?.routes.find((r) => r.id === bulkRoute)?.code}
              </strong>
              <label>
                {t('Due on', 'تاريخ الاستحقاق')}
                <input name="dueOn" type="date" defaultValue={today} required />
              </label>
              <label>
                {t('Collector (blank = route collector)', 'الجابي (فارغ = جابي المسار)')}
                <select name="collectorUserId" defaultValue="">
                  <option value="">{t('Route collector', 'جابي المسار')}</option>
                  {data?.collectors.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="col-primary" disabled={busy}>
                {t('Assign', 'إسناد')}
              </button>
              <button type="button" onClick={() => setBulkRoute(undefined)}>
                {t('Back', 'رجوع')}
              </button>
            </form>
          )}
          <div className="col-table-wrap">
            <table className="col-table">
              <thead>
                <tr>
                  <th>{t('Route', 'المسار')}</th>
                  <th>{t('Collector', 'الجابي')}</th>
                  <th>{t('Open assignments', 'إسنادات مفتوحة')}</th>
                  <th>{t('Unassigned open invoices', 'فواتير مفتوحة غير مسندة')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.routes.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.code}</strong>
                      <small>{en ? r.nameEn : r.nameAr}</small>
                    </td>
                    <td>
                      <select
                        aria-label={`${t('Collector for', 'جابي')} ${r.code}`}
                        value={r.collectorUserId ?? ''}
                        disabled={busy}
                        onChange={(event) =>
                          void command(
                            'collections/commands',
                            {
                              action: 'assign_route_collector',
                              routeId: r.id,
                              collectorUserId: event.target.value || null,
                            },
                            () => setNotice(t('Route collector updated.', 'حُدّث جابي المسار.')),
                          )
                        }
                      >
                        <option value="">{t('No collector', 'بلا جابٍ')}</option>
                        {data.collectors.map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{r.openAssignments}</td>
                    <td>{r.unassignedInvoices}</td>
                    <td>
                      {r.unassignedInvoices > 0 && (
                        <button type="button" onClick={() => setBulkRoute(r.id)}>
                          {t('Assign due invoices', 'إسناد الفواتير المستحقة')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t('Collectors', 'الجباة')}</h3>
          <ul className="col-collectors">
            {data?.collectors.map((c) => (
              <li key={c.userId}>
                <strong>{c.name}</strong>
                <span>
                  {c.routes} {t('routes', 'مسار')} · {c.openAssignments} {t('open', 'مفتوح')} ·{' '}
                  {c.devices} {t('devices', 'جهاز')}
                  {c.lastSeenAt ? ` · ${t('last sync', 'آخر مزامنة')} ${time(c.lastSeenAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'settlements' && (
        <section className="col-panel" aria-label={t('Settlements', 'التسويات')}>
          <div className="col-section-head">
            <h2>{t('Settlements', 'التسويات')}</h2>
            <button type="button" onClick={() => setSettling((v) => !v)}>
              {t('Settle a route', 'تسوية مسار')}
            </button>
          </div>
          {settling && (
            <form className="col-form col-inline" onSubmit={submitSettle}>
              <label>
                {t('Route', 'المسار')}
                <select name="routeId" required>
                  {data?.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Collector', 'الجابي')}
                <select name="collectorUserId" required>
                  {data?.collectors.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Business date', 'تاريخ العمل')}
                <input name="businessDate" type="date" defaultValue={today} required />
              </label>
              <label>
                {t('Currency', 'العملة')}
                <select name="currency" defaultValue="USD">
                  <option value="USD">USD</option>
                  <option value="LBP">LBP</option>
                </select>
              </label>
              <label>
                {t('Cash handed in', 'النقد المسلّم')}
                <input name="declared" inputMode="decimal" required />
              </label>
              <label>
                {t('Reason if it differs', 'السبب إن اختلف')}
                <input name="reason" maxLength={1000} />
              </label>
              <button type="submit" className="col-primary" disabled={busy}>
                {t('Settle', 'تسوية')}
              </button>
            </form>
          )}
          {approving && (
            <form className="col-form col-inline" onSubmit={submitApprove}>
              <strong>
                {t('Approve difference of', 'الموافقة على فرق قدره')}{' '}
                <span dir="ltr">{money(approving.differenceMinor, approving.currency)}</span> ·{' '}
                {approving.routeCode} · {approving.collectorName}
              </strong>
              <MfaStepUp locale={locale} session={session} />
              <label>
                {t('Approval reason', 'سبب الموافقة')}
                <input name="reason" minLength={8} maxLength={1000} required />
              </label>
              <button type="submit" className="col-primary" disabled={busy}>
                {t('Approve', 'موافقة')}
              </button>
              <button type="button" onClick={() => setApproving(undefined)}>
                {t('Back', 'رجوع')}
              </button>
            </form>
          )}
          {data && data.settlements.length === 0 ? (
            <p className="col-note">
              {t('No settlements in the last 30 days.', 'لا تسويات خلال آخر ٣٠ يوماً.')}
            </p>
          ) : (
            <div className="col-table-wrap">
              <table className="col-table">
                <thead>
                  <tr>
                    <th>{t('Date', 'التاريخ')}</th>
                    <th>{t('Route', 'المسار')}</th>
                    <th>{t('Collector', 'الجابي')}</th>
                    <th>{t('Expected', 'المتوقع')}</th>
                    <th>{t('Declared', 'المصرّح')}</th>
                    <th>{t('Difference', 'الفرق')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th>{t('Source', 'المصدر')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.settlements.map((s) => (
                    <tr key={`${s.source}-${s.id}`}>
                      <td>{date(s.businessDate)}</td>
                      <td>{s.routeCode}</td>
                      <td>{s.collectorName ?? '—'}</td>
                      <td dir="ltr">{money(s.expectedMinor, s.currency)}</td>
                      <td dir="ltr">{money(s.declaredMinor, s.currency)}</td>
                      <td dir="ltr" className={s.differenceMinor ? 'is-variance' : ''}>
                        {money(s.differenceMinor, s.currency)}
                      </td>
                      <td>
                        <span className={`col-pill is-${s.status}`}>
                          {settlementStatus(s.status)}
                        </span>
                        {s.reason && <small>{s.reason}</small>}
                        {s.approvedBy && (
                          <small>
                            {t('by', 'بواسطة')} {s.approvedBy} · {s.approvalReason}
                          </small>
                        )}
                      </td>
                      <td>
                        {s.source === 'device'
                          ? t('Collect app', 'تطبيق التحصيل')
                          : t('Office', 'المكتب')}
                      </td>
                      <td>
                        {s.status === 'pending_approval' && (
                          <button type="button" onClick={() => setApproving(s)}>
                            {t('Approve', 'موافقة')}
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

      {view === 'devices' && (
        <section className="col-panel" aria-label={t('Collect devices', 'أجهزة التحصيل')}>
          <h2>{t('Collect devices', 'أجهزة التحصيل')}</h2>
          <p className="col-note">
            {t(
              'Devices are authorised by the collector from the Collect app with a recent identity check; the office sees their sync state here.',
              'يفوّض الجابي الأجهزة من تطبيق التحصيل بعد تحقق حديث من الهوية؛ ويرى المكتب حالة مزامنتها هنا.',
            )}
          </p>
          {data && data.devices.length === 0 ? (
            <p className="col-note">
              {t('No Collect device has been authorised yet.', 'لم يُفوَّض أي جهاز تحصيل بعد.')}
            </p>
          ) : (
            <div className="col-table-wrap">
              <table className="col-table">
                <thead>
                  <tr>
                    <th>{t('Device', 'الجهاز')}</th>
                    <th>{t('Collector', 'الجابي')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th>{t('Last sync', 'آخر مزامنة')}</th>
                    <th>{t('Authorised', 'فُوّض')}</th>
                    <th>{t('Operations synced', 'العمليات المزامنة')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.devices.map((d) => (
                    <tr key={d.id}>
                      <td>{d.label}</td>
                      <td>{d.collectorName ?? '—'}</td>
                      <td>
                        <span className={`col-pill is-${d.status}`}>{d.status}</span>
                      </td>
                      <td>{time(d.lastSeenAt)}</td>
                      <td>{time(d.authorizedAt)}</td>
                      <td>{d.lastSequence}</td>
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
