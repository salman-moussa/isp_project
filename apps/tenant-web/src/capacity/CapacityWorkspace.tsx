import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import type { CapacityWorkspace as Workspace, CircuitRecord } from '@isp/contracts';
import { readCapacityWorkspace, submitTenantOperation } from '../api';
import '../regulatory/regulatory.css';
import './capacity.css';

type Editing =
  | { kind: 'circuit'; circuit?: CircuitRecord }
  | { kind: 'samples'; circuit: CircuitRecord };

const KINDS = [
  'transit',
  'peering',
  'ogero_dsl',
  'ogero_fiber',
  'wireless_backhaul',
  'leased_line',
  'other',
] as const;

export function CapacityWorkspace({
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
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [opened, setOpened] = useState<string>();
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
    void readCapacityWorkspace(session, { days })
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
  }, [session, refresh, days]);

  const number = new Intl.NumberFormat(en ? 'en-US' : 'ar-LB', { maximumFractionDigits: 1 });
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(en ? 'en-US' : 'ar-LB', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    }).format(currency === 'LBP' ? minor : minor / 100);
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
  const idempotency = (fingerprint: string) => {
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `web-capacity-${crypto.randomUUID()}` };
    return retry.current.key;
  };
  async function command(body: Record<string, unknown>, done: () => void) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await submitTenantOperation(
        session,
        'capacity/commands',
        { command: body },
        idempotency(JSON.stringify(body)),
      );
      retry.current = undefined;
      if (mounted.current) {
        done();
        setRefresh((v) => v + 1);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const kindLabel = (value: string) =>
    ({
      transit: t('IP transit', 'عبور إنترنت'),
      peering: t('Peering', 'تناظر'),
      ogero_dsl: t('Ogero DSL', 'أوجيرو DSL'),
      ogero_fiber: t('Ogero fibre', 'أوجيرو ألياف'),
      wireless_backhaul: t('Wireless backhaul', 'ربط لاسلكي'),
      leased_line: t('Leased line', 'خط مستأجر'),
      other: t('Other', 'أخرى'),
    })[value] ?? value;
  const statusLabel = (value: string) =>
    ({
      planned: t('Planned', 'مخطط'),
      active: t('Active', 'فعّال'),
      decommissioned: t('Decommissioned', 'مُوقف'),
    })[value] ?? value;
  const riskLabel = (value: CircuitRecord['risk']) =>
    ({
      ok: t('Healthy', 'سليم'),
      warning: t('Watch', 'مراقبة'),
      critical: t('Saturating', 'يقترب من التشبع'),
      unknown: t('No samples', 'لا عينات'),
      none: t('Not active', 'غير فعّال'),
    })[value];
  const riskClass = (value: CircuitRecord['risk']) =>
    ({ ok: 'is-ok', warning: 'is-warn', critical: 'is-bad', unknown: '', none: 'is-muted' })[value];

  const circuits = data?.circuits ?? [];
  const critical = circuits.filter((c) => c.risk === 'critical').length;
  const warning = circuits.filter((c) => c.risk === 'warning').length;
  const renewals = circuits.filter((c) => c.renewalDue).length;
  const peak = circuits.reduce((sum, c) => sum + (c.peakMbps ?? 0), 0);
  const committed = data?.totals.committedMbps ?? 0;

  function submitCircuit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = editing?.kind === 'circuit' ? editing.circuit : undefined;
    const optionalDate = (key: string) => {
      const value = field(form, key);
      return value ? { [key]: value } : existing ? { [key]: null } : {};
    };
    const branch = field(form, 'branchId');
    const burst = field(form, 'burstMbps');
    const sla = field(form, 'slaAvailabilityPct');
    const currency = field(form, 'currency');
    void command(
      {
        action: 'upsert_circuit',
        ...(existing
          ? { circuitId: existing.id, expectedVersion: existing.version }
          : { code: field(form, 'code').toUpperCase() }),
        provider: field(form, 'provider'),
        kind: field(form, 'kind'),
        pop: field(form, 'pop'),
        branchId: branch || null,
        committedMbps: Number(field(form, 'committedMbps')),
        burstMbps: burst ? Number(burst) : null,
        monthlyCostMinor: Math.round(
          Number(field(form, 'monthlyCost') || 0) * (currency === 'LBP' ? 1 : 100),
        ),
        currency,
        ...optionalDate('contractStart'),
        ...optionalDate('contractEnd'),
        renewalNoticeDays: Number(field(form, 'renewalNoticeDays') || 60),
        slaAvailabilityPct: sla ? Number(sla) : null,
        status: field(form, 'status'),
        notes: field(form, 'notes'),
      },
      () => {
        setEditing(null);
        setNotice(
          existing
            ? t('Circuit updated.', 'حُدّثت الدائرة.')
            : t('Circuit recorded.', 'سُجلت الدائرة.'),
        );
      },
    );
  }
  function submitSamples(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing?.kind !== 'samples') return;
    const form = new FormData(event.currentTarget);
    const avgIn = field(form, 'avgInMbps');
    const avgOut = field(form, 'avgOutMbps');
    void command(
      {
        action: 'record_samples',
        circuitId: editing.circuit.id,
        source: 'manual',
        samples: [
          {
            sampledAt: new Date(field(form, 'sampledAt')).toISOString(),
            peakInMbps: Number(field(form, 'peakInMbps')),
            peakOutMbps: Number(field(form, 'peakOutMbps')),
            ...(avgIn ? { avgInMbps: Number(avgIn) } : {}),
            ...(avgOut ? { avgOutMbps: Number(avgOut) } : {}),
          },
        ],
      },
      () => {
        setEditing(null);
        setNotice(t('Sample recorded.', 'سُجلت العينة.'));
      },
    );
  }

  if (state === 'error')
    return (
      <div className="reg-shell" dir={en ? 'ltr' : 'rtl'} aria-live="polite">
        <div className="reg-banner is-error" role="alert">
          {t('The capacity workspace could not be loaded.', 'تعذّر تحميل مساحة السعة.')}
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="reg-shell" dir={en ? 'ltr' : 'rtl'} aria-busy="true">
        <p className="reg-note">{t('Loading capacity…', 'جارٍ تحميل السعة…')}</p>
      </div>
    );

  const detail = circuits.find((c) => c.id === opened);
  const sparkline = (trend: CircuitRecord['trend'], limit: number) => {
    if (trend.length < 2) return null;
    const max = Math.max(limit, ...trend.map((p) => p.peakMbps));
    const points = trend
      .map((p, i) => `${(i / (trend.length - 1)) * 100},${40 - (p.peakMbps / max) * 40}`)
      .join(' ');
    const line = 40 - (limit / max) * 40;
    return (
      <svg className="cap-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1={line} y2={line} className="cap-spark-limit" />
        <polyline points={points} className="cap-spark-line" />
      </svg>
    );
  };
  const costLine =
    data.cost.length === 0
      ? t('No cost recorded', 'لا كلفة مسجلة')
      : `${data.cost.map((c) => money(c.monthlyMinor, c.currency)).join(' · ')} ${t('per month', 'شهرياً')}`;

  return (
    <div className="reg-shell" dir={en ? 'ltr' : 'rtl'} aria-busy={busy}>
      <header className="reg-hero">
        <div>
          <h2>{t('Capacity & upstream', 'السعة والروابط العلوية')}</h2>
          <p>
            {t(
              'Upstream circuits, committed capacity, utilisation from recorded peaks, saturation forecast and renewals.',
              'الدوائر العلوية، السعة الملتزمة، الاستخدام من الذروات المسجلة، توقّع التشبع والتجديدات.',
            )}
          </p>
        </div>
        <div className="reg-inline">
          <label>
            {t('Window', 'النافذة')}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>{t('7 days', '7 أيام')}</option>
              <option value={30}>{t('30 days', '30 يوماً')}</option>
              <option value={90}>{t('90 days', '90 يوماً')}</option>
              <option value={365}>{t('12 months', '12 شهراً')}</option>
            </select>
          </label>
          <button
            type="button"
            className="reg-primary"
            onClick={() => setEditing({ kind: 'circuit' })}
            disabled={busy}
          >
            {t('Add circuit', 'إضافة دائرة')}
          </button>
        </div>
      </header>
      {error ? (
        <div className="reg-banner is-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="reg-banner" role="status">
          {notice}
        </div>
      ) : null}
      <dl className="reg-stats">
        <div>
          <dt>{t('Committed capacity', 'السعة الملتزمة')}</dt>
          <dd>
            {number.format(committed)} Mbps
            <small>
              {t('Active circuits', 'دوائر فعّالة')}: {data.totals.active}
            </small>
          </dd>
        </div>
        <div>
          <dt>{t('Peak in window', 'الذروة في النافذة')}</dt>
          <dd>
            {number.format(peak)} Mbps
            <small>
              {committed > 0
                ? `${number.format((peak / committed) * 100)}% ${t('of committed', 'من الملتزم')}`
                : t('No committed capacity', 'لا سعة ملتزمة')}
            </small>
          </dd>
        </div>
        <div className={critical > 0 || warning > 0 ? 'is-alert' : ''}>
          <dt>{t('Saturation risk', 'خطر التشبع')}</dt>
          <dd>
            {critical}
            <small>
              {t('Watch', 'مراقبة')}: {warning}
            </small>
          </dd>
        </div>
        <div className={renewals > 0 ? 'is-alert' : ''}>
          <dt>{t('Renewals due', 'تجديدات مستحقة')}</dt>
          <dd>
            {renewals}
            <small>{costLine}</small>
          </dd>
        </div>
      </dl>

      {editing?.kind === 'circuit' ? (
        <form
          className="reg-form"
          onSubmit={submitCircuit}
          aria-label={t('Circuit form', 'نموذج الدائرة')}
        >
          <h3 className="reg-span">
            {editing.circuit
              ? t('Edit circuit', 'تعديل الدائرة')
              : t('New upstream circuit', 'دائرة علوية جديدة')}
          </h3>
          {editing.circuit ? null : (
            <label>
              {t('Code', 'الرمز')}
              <input
                name="code"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}"
                placeholder="TRANSIT-BEY-1"
              />
            </label>
          )}
          <label>
            {t('Provider', 'المزوّد')}
            <input
              name="provider"
              required
              maxLength={160}
              defaultValue={editing.circuit?.provider ?? ''}
            />
          </label>
          <label>
            {t('Kind', 'النوع')}
            <select name="kind" defaultValue={editing.circuit?.kind ?? 'transit'}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Point of presence', 'نقطة الحضور')}
            <input name="pop" required maxLength={120} defaultValue={editing.circuit?.pop ?? ''} />
          </label>
          <label>
            {t('Branch', 'الفرع')}
            <select name="branchId" defaultValue={editing.circuit?.branchId ?? ''}>
              <option value="">{t('Whole network', 'الشبكة كلها')}</option>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {en ? b.nameEn : b.nameAr}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Committed Mbps', 'الملتزم (Mbps)')}
            <input
              name="committedMbps"
              type="number"
              min={1}
              max={1000000}
              required
              defaultValue={editing.circuit?.committedMbps ?? ''}
            />
          </label>
          <label>
            {t('Burst Mbps', 'الحد الأقصى (Mbps)')}
            <input
              name="burstMbps"
              type="number"
              min={1}
              max={1000000}
              defaultValue={editing.circuit?.burstMbps ?? ''}
            />
          </label>
          <label>
            {t('Monthly cost', 'الكلفة الشهرية')}
            <input
              name="monthlyCost"
              type="number"
              min={0}
              step="0.01"
              defaultValue={
                editing.circuit
                  ? editing.circuit.currency === 'LBP'
                    ? editing.circuit.monthlyCostMinor
                    : editing.circuit.monthlyCostMinor / 100
                  : ''
              }
            />
          </label>
          <label>
            {t('Currency', 'العملة')}
            <select name="currency" defaultValue={editing.circuit?.currency ?? 'USD'}>
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
          </label>
          <label>
            {t('Contract start', 'بداية العقد')}
            <input
              name="contractStart"
              type="date"
              defaultValue={editing.circuit?.contractStart ?? ''}
            />
          </label>
          <label>
            {t('Contract end', 'نهاية العقد')}
            <input
              name="contractEnd"
              type="date"
              defaultValue={editing.circuit?.contractEnd ?? ''}
            />
          </label>
          <label>
            {t('Renewal notice (days)', 'إشعار التجديد (أيام)')}
            <input
              name="renewalNoticeDays"
              type="number"
              min={0}
              max={730}
              defaultValue={editing.circuit?.renewalNoticeDays ?? 60}
            />
          </label>
          <label>
            {t('SLA availability %', 'توافر اتفاقية الخدمة %')}
            <input
              name="slaAvailabilityPct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={editing.circuit?.slaAvailabilityPct ?? ''}
            />
          </label>
          <label>
            {t('Status', 'الحالة')}
            <select name="status" defaultValue={editing.circuit?.status ?? 'active'}>
              {(['planned', 'active', 'decommissioned'] as const).map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="reg-span">
            {t('Notes', 'ملاحظات')}
            <textarea name="notes" maxLength={2000} defaultValue={editing.circuit?.notes ?? ''} />
          </label>
          <div className="reg-inline">
            <button type="submit" className="reg-primary" disabled={busy}>
              {t('Save circuit', 'حفظ الدائرة')}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              {t('Cancel', 'إلغاء')}
            </button>
          </div>
        </form>
      ) : null}
      {editing?.kind === 'samples' ? (
        <form
          className="reg-form"
          onSubmit={submitSamples}
          aria-label={t('Sample form', 'نموذج العينة')}
        >
          <h3 className="reg-span">
            {t('Record utilisation sample', 'تسجيل عينة استخدام')} · {editing.circuit.code}
          </h3>
          <label>
            {t('Sampled at', 'وقت العينة')}
            <input
              name="sampledAt"
              type="datetime-local"
              required
              defaultValue={new Date(Date.now() - 3_600_000).toISOString().slice(0, 16)}
            />
          </label>
          <label>
            {t('Peak inbound Mbps', 'ذروة الوارد (Mbps)')}
            <input name="peakInMbps" type="number" min={0} step="0.001" required />
          </label>
          <label>
            {t('Peak outbound Mbps', 'ذروة الصادر (Mbps)')}
            <input name="peakOutMbps" type="number" min={0} step="0.001" required />
          </label>
          <label>
            {t('Average inbound Mbps', 'متوسط الوارد (Mbps)')}
            <input name="avgInMbps" type="number" min={0} step="0.001" />
          </label>
          <label>
            {t('Average outbound Mbps', 'متوسط الصادر (Mbps)')}
            <input name="avgOutMbps" type="number" min={0} step="0.001" />
          </label>
          <div className="reg-inline">
            <button type="submit" className="reg-primary" disabled={busy}>
              {t('Record sample', 'تسجيل العينة')}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              {t('Cancel', 'إلغاء')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="reg-panel">
        <div className="reg-section-head">
          <h3>{t('Upstream circuits', 'الدوائر العلوية')}</h3>
          <span className="reg-note">
            {t('Sorted by saturation risk', 'مرتبة حسب خطر التشبع')} · {data.windowDays}{' '}
            {t('days', 'يوماً')}
          </span>
        </div>
        {circuits.length === 0 ? (
          <p className="reg-note">
            {t(
              'No upstream circuits recorded yet. Add each transit, peering, Ogero or backhaul circuit with its committed capacity and contract dates.',
              'لم تُسجّل دوائر علوية بعد. أضف كل دائرة عبور أو تناظر أو أوجيرو أو ربط مع سعتها الملتزمة وتواريخ عقدها.',
            )}
          </p>
        ) : (
          <div className="reg-table-wrap">
            <table className="reg-table cap-table">
              <thead>
                <tr>
                  <th scope="col">{t('Circuit', 'الدائرة')}</th>
                  <th scope="col">{t('Kind', 'النوع')}</th>
                  <th scope="col">{t('Committed', 'الملتزم')}</th>
                  <th scope="col">{t('Peak', 'الذروة')}</th>
                  <th scope="col">{t('Utilisation', 'الاستخدام')}</th>
                  <th scope="col">{t('Trend', 'الاتجاه')}</th>
                  <th scope="col">{t('Saturation', 'التشبع')}</th>
                  <th scope="col">{t('Contract', 'العقد')}</th>
                  <th scope="col">{t('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {circuits.map((c) => (
                  <tr
                    key={c.id}
                    className={
                      c.risk === 'critical' ? 'is-overdue' : c.status === 'active' ? '' : 'is-muted'
                    }
                  >
                    <td>
                      <strong>{c.code}</strong>
                      <br />
                      <small>
                        {c.provider} · {c.pop}
                        {c.branchName ? ` · ${c.branchName}` : ''}
                      </small>
                    </td>
                    <td>
                      {kindLabel(c.kind)}
                      <br />
                      <span className={`reg-pill ${c.status === 'active' ? 'is-ok' : ''}`}>
                        {statusLabel(c.status)}
                      </span>
                    </td>
                    <td>
                      {number.format(c.committedMbps)} Mbps
                      {c.burstMbps ? (
                        <>
                          <br />
                          <small>
                            {t('burst', 'حد أقصى')} {number.format(c.burstMbps)}
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td>{c.peakMbps === null ? '—' : `${number.format(c.peakMbps)} Mbps`}</td>
                    <td>
                      {c.utilisationPct === null ? (
                        '—'
                      ) : (
                        <div
                          className="cap-meter"
                          aria-label={`${number.format(c.utilisationPct)}%`}
                        >
                          <span
                            style={{ width: `${Math.min(100, c.utilisationPct)}%` }}
                            className={riskClass(c.risk)}
                          />
                          <b>{number.format(c.utilisationPct)}%</b>
                        </div>
                      )}
                    </td>
                    <td>
                      {sparkline(c.trend, c.committedMbps) ?? (
                        <small>{t('needs 2+ samples', 'يحتاج عينتين فأكثر')}</small>
                      )}
                    </td>
                    <td>
                      <span className={`reg-pill ${riskClass(c.risk)}`}>{riskLabel(c.risk)}</span>
                      {c.monthsToSaturation !== null ? (
                        <>
                          <br />
                          <small>
                            ≈ {number.format(c.monthsToSaturation)} {t('months', 'أشهر')}
                          </small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {c.contractEnd ? date(c.contractEnd) : '—'}
                      {c.renewalDue ? (
                        <>
                          <br />
                          <span className="reg-pill is-warn">
                            {t('Renewal due', 'تجديد مستحق')}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="cap-actions">
                      <button
                        type="button"
                        onClick={() => setOpened(opened === c.id ? undefined : c.id)}
                      >
                        {opened === c.id ? t('Hide', 'إخفاء') : t('Details', 'التفاصيل')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: 'circuit', circuit: c })}
                        disabled={busy}
                      >
                        {t('Edit', 'تعديل')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: 'samples', circuit: c })}
                        disabled={busy || c.status === 'decommissioned'}
                      >
                        {t('Sample', 'عينة')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail ? (
        <div className="reg-panel cap-detail" aria-label={detail.code}>
          <div className="reg-section-head">
            <h3>
              {detail.code} · {detail.provider}
            </h3>
            <span className="reg-note">
              {t('Version', 'الإصدار')} {detail.version}
            </span>
          </div>
          <dl className="cap-facts">
            <div>
              <dt>{t('Headroom', 'الهامش')}</dt>
              <dd>
                {detail.headroomMbps === null ? '—' : `${number.format(detail.headroomMbps)} Mbps`}
              </dd>
            </div>
            <div>
              <dt>{t('Growth per month', 'النمو الشهري')}</dt>
              <dd>
                {detail.growthMbpsPerMonth === null
                  ? '—'
                  : `${number.format(detail.growthMbpsPerMonth)} Mbps`}
              </dd>
            </div>
            <div>
              <dt>{t('Samples in window', 'العينات في النافذة')}</dt>
              <dd>{detail.samples}</dd>
            </div>
            <div>
              <dt>{t('Latest sample', 'آخر عينة')}</dt>
              <dd>
                {detail.latestSample
                  ? `${time(detail.latestSample.sampledAt)} · ↓${number.format(detail.latestSample.peakInMbps)} ↑${number.format(detail.latestSample.peakOutMbps)}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('Monthly cost', 'الكلفة الشهرية')}</dt>
              <dd>{money(detail.monthlyCostMinor, detail.currency)}</dd>
            </div>
            <div>
              <dt>{t('Contract', 'العقد')}</dt>
              <dd>
                {date(detail.contractStart)} → {date(detail.contractEnd)}
                {detail.daysToContractEnd !== null
                  ? ` (${detail.daysToContractEnd} ${t('days', 'يوماً')})`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>{t('SLA availability', 'توافر اتفاقية الخدمة')}</dt>
              <dd>
                {detail.slaAvailabilityPct === null
                  ? '—'
                  : `${number.format(detail.slaAvailabilityPct)}%`}
              </dd>
            </div>
            <div>
              <dt>{t('Notes', 'ملاحظات')}</dt>
              <dd>{detail.notes ?? '—'}</dd>
            </div>
          </dl>
          {detail.trend.length > 0 ? (
            <div className="reg-table-wrap">
              <table className="reg-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Sampled at', 'وقت العينة')}</th>
                    <th scope="col">{t('Peak Mbps', 'الذروة (Mbps)')}</th>
                    <th scope="col">{t('Utilisation', 'الاستخدام')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.trend].reverse().map((p) => (
                    <tr key={p.sampledAt}>
                      <td>{time(p.sampledAt)}</td>
                      <td>{number.format(p.peakMbps)}</td>
                      <td>{number.format((p.peakMbps / detail.committedMbps) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
