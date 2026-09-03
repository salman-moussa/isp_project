import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  InventoryCustodyCommand,
  SerializedAssetRecord,
  WarehouseWorkspace as Workspace,
} from '@isp/contracts';
import { inventoryCustodyCommandSchema } from '@isp/contracts';
import type { ApiSession, Locale } from '@isp/ui';
import { readWarehouseWorkspace, submitTenantOperation } from '../api';
import './warehouse.css';

type Action = InventoryCustodyCommand['action'];

export function WarehouseWorkspace({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session?: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState<Workspace>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);

  useEffect(() => {
    if (!session) {
      setState('ready');
      return;
    }
    let active = true;
    setState('loading');
    void readWarehouseWorkspace(session)
      .then((value) => {
        if (!active) return;
        setData(value);
        setState('ready');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [session, refresh]);

  const assets = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return data?.assets ?? [];
    return (data?.assets ?? []).filter((asset) =>
      [asset.serialNumber, asset.macAddress, asset.sku, asset.itemNameEn, asset.itemNameAr]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [data, filter]);
  const selected = data?.assets.find((asset) => asset.id === selectedId);
  const counts = (data?.assets ?? []).reduce<Record<string, number>>((result, asset) => {
    result[asset.status] = (result[asset.status] ?? 0) + 1;
    return result;
  }, {});

  const statusLabel = (status: SerializedAssetRecord['status']) =>
    ({
      in_stock: t('In stock', 'في المخزون'),
      reserved: t('Reserved', 'محجوز'),
      issued: t('Issued', 'بعهدة فني'),
      installed: t('Installed', 'مركّب'),
      returned: t('Returned', 'مرتجع'),
      rma: t('RMA', 'صيانة المورد'),
    })[status];
  const allowedActions = (status: SerializedAssetRecord['status']): readonly Action[] => {
    if (status === 'in_stock') return ['issue'];
    if (status === 'issued') return ['install', 'return'];
    if (status === 'installed') return ['return'];
    if (status === 'returned') return ['issue', 'rma'];
    return [];
  };
  const actionLabel = (value: Action) =>
    ({
      issue: t('Issue to installation', 'تسليم للتركيب'),
      install: t('Confirm installed', 'تأكيد التركيب'),
      return: t('Return to warehouse', 'إرجاع للمستودع'),
      rma: t('Send to RMA', 'إرسال لصيانة المورد'),
    })[value];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selected || !action || busy) return;
    const form = new FormData(event.currentTarget);
    const readField = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const installationId = readField('installationId');
    const installation = data?.installations.find((item) => item.id === installationId);
    const command = inventoryCustodyCommandSchema.parse({
      assetId: selected.id,
      expectedVersion: selected.version,
      action,
      ...(action === 'issue'
        ? { installationId, custodianUserId: installation?.installerUserId ?? undefined }
        : {}),
      ...(action === 'return' ? { warehouseId: readField('warehouseId') } : {}),
      reasonEn: readField('reasonEn'),
      reasonAr: readField('reasonAr'),
      evidence: readField('evidence'),
    });
    const fingerprint = JSON.stringify(command);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    try {
      await submitTenantOperation(session, 'warehouse/custody', { command }, retry.current.key);
      retry.current = undefined;
      setAction(undefined);
      setMessage(t('Custody history saved.', 'تم حفظ سجل العهدة.'));
      setRefresh((value) => value + 1);
    } catch {
      setMessage(
        t(
          'The change was not confirmed. Refresh if custody changed, or retry unchanged values safely.',
          'لم يتأكد التغيير. حدّث الصفحة إذا تغيّرت العهدة، أو أعد المحاولة بالقيم نفسها بأمان.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!session)
    return (
      <section className="warehouse-state">
        <h1>{t('Sign in to open Warehouse', 'سجّل الدخول لفتح المستودع')}</h1>
        <p>
          {t(
            'Serialized custody is available in an authenticated tenant session.',
            'إدارة العهدة المتسلسلة متاحة ضمن جلسة موثقة.',
          )}
        </p>
      </section>
    );
  if (state !== 'ready')
    return (
      <section className="warehouse-state" role={state === 'error' ? 'alert' : 'status'}>
        <h1>
          {state === 'loading'
            ? t('Loading custody', 'جارٍ تحميل العهدة')
            : t('Warehouse unavailable', 'المستودع غير متاح')}
        </h1>
        <p>
          {state === 'loading'
            ? t(
                'Reading permission-scoped equipment records.',
                'جارٍ قراءة المعدات ضمن نطاق الصلاحية.',
              )
            : t('Check your access or try again.', 'تحقق من صلاحياتك أو حاول مجدداً.')}
        </p>
        {state === 'error' && (
          <button onClick={() => setRefresh((value) => value + 1)}>
            {t('Retry', 'إعادة المحاولة')}
          </button>
        )}
      </section>
    );

  return (
    <main className="warehouse-shell">
      <header className="warehouse-hero">
        <div>
          <span>{t('Serialized equipment control', 'ضبط المعدات المتسلسلة')}</span>
          <h1>{t('Every device has an accountable handoff', 'لكل جهاز عهدة وتسليم موثّق')}</h1>
          <p>
            {t(
              'Issue, install, return, and RMA transitions preserve bilingual evidence and an immutable history.',
              'التسليم والتركيب والإرجاع والصيانة تحفظ دليلاً ثنائي اللغة وسجلاً غير قابل للتعديل.',
            )}
          </p>
        </div>
        <div className="warehouse-score">
          <strong>{data?.assets.length ?? 0}</strong>
          <small>{t('visible assets', 'أصل ظاهر')}</small>
        </div>
      </header>

      <section className="warehouse-metrics" aria-label={t('Custody summary', 'ملخص العهدة')}>
        <article>
          <small>{t('Available', 'متاح')}</small>
          <strong>{counts.in_stock ?? 0}</strong>
        </article>
        <article>
          <small>{t('With technicians', 'بعهدة الفنيين')}</small>
          <strong>{counts.issued ?? 0}</strong>
        </article>
        <article>
          <small>{t('Installed', 'مركّب')}</small>
          <strong>{counts.installed ?? 0}</strong>
        </article>
        <article>
          <small>{t('Return / RMA', 'مرتجع / صيانة')}</small>
          <strong>{(counts.returned ?? 0) + (counts.rma ?? 0)}</strong>
        </article>
      </section>

      <div className="warehouse-layout">
        <section className="warehouse-panel">
          <div className="warehouse-panel__head">
            <div>
              <h2>{t('Asset register', 'سجل الأصول')}</h2>
              <p>
                {t(
                  'Select a serialized device to inspect custody.',
                  'اختر جهازاً متسلسلاً لمراجعة عهدته.',
                )}
              </p>
            </div>
            <label>
              {t('Search', 'بحث')}
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('Serial, MAC, or SKU', 'تسلسل أو MAC أو SKU')}
              />
            </label>
          </div>
          <div className="warehouse-assets">
            {assets.map((asset) => (
              <button
                key={asset.id}
                className={asset.id === selectedId ? 'is-selected' : ''}
                onClick={() => {
                  setSelectedId(asset.id);
                  setAction(undefined);
                  setMessage('');
                }}
              >
                <span>
                  <strong>{asset.serialNumber}</strong>
                  <small>
                    {locale === 'ar' ? asset.itemNameAr : asset.itemNameEn} · {asset.sku}
                  </small>
                </span>
                <span className={`warehouse-status warehouse-status--${asset.status}`}>
                  {statusLabel(asset.status)}
                </span>
              </button>
            ))}
            {assets.length === 0 && (
              <p className="warehouse-empty">
                {t(
                  'No serialized assets match this view.',
                  'لا توجد أصول متسلسلة مطابقة لهذا العرض.',
                )}
              </p>
            )}
          </div>
        </section>

        <aside className="warehouse-panel warehouse-detail">
          {!selected ? (
            <div className="warehouse-empty">
              <h2>{t('Choose an asset', 'اختر أصلاً')}</h2>
              <p>
                {t(
                  'Custody, installation, and evidence history will appear here.',
                  'ستظهر هنا العهدة والتركيب وسجل الأدلة.',
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="warehouse-detail__title">
                <div>
                  <small>{selected.sku}</small>
                  <h2>{selected.serialNumber}</h2>
                </div>
                <span className={`warehouse-status warehouse-status--${selected.status}`}>
                  {statusLabel(selected.status)}
                </span>
              </div>
              <dl className="warehouse-facts">
                <div>
                  <dt>{t('Warehouse', 'المستودع')}</dt>
                  <dd>{selected.warehouseCode ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('Custodian', 'صاحب العهدة')}</dt>
                  <dd>{selected.custodianName ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('Service', 'الخدمة')}</dt>
                  <dd>{selected.serviceNumber ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('Version', 'الإصدار')}</dt>
                  <dd>{selected.version}</dd>
                </div>
              </dl>
              <div className="warehouse-actions">
                {allowedActions(selected.status).map((value) => (
                  <button
                    key={value}
                    onClick={() => {
                      setAction(value);
                      setMessage('');
                    }}
                    className={action === value ? 'is-active' : ''}
                  >
                    {actionLabel(value)}
                  </button>
                ))}
              </div>
              {action && (
                <form
                  className="warehouse-form"
                  onSubmit={(event) => {
                    void submit(event);
                  }}
                >
                  <h3>{actionLabel(action)}</h3>
                  {action === 'issue' && (
                    <label>
                      {t('Installation with assigned technician', 'التركيب مع الفني المكلّف')}
                      <select name="installationId" required defaultValue="">
                        <option value="">{t('Choose installation', 'اختر التركيب')}</option>
                        {data?.installations
                          .filter((item) => item.installerUserId)
                          .map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.serviceNumber} · {item.subscriberName} · {item.installerName}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {action === 'return' && (
                    <label>
                      {t('Return warehouse', 'مستودع الإرجاع')}
                      <select name="warehouseId" required defaultValue="">
                        <option value="">{t('Choose warehouse', 'اختر المستودع')}</option>
                        {data?.warehouses
                          .filter((item) => item.active)
                          .map((item) => (
                            <option value={item.id} key={item.id}>
                              {locale === 'ar' ? item.nameAr : item.nameEn} · {item.warehouseCode}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <div className="warehouse-form__pair">
                    <label>
                      {t('Reason in English', 'السبب بالإنجليزية')}
                      <textarea name="reasonEn" minLength={8} required />
                    </label>
                    <label>
                      {t('Reason in Arabic', 'السبب بالعربية')}
                      <textarea name="reasonAr" minLength={8} required dir="rtl" />
                    </label>
                  </div>
                  <label>
                    {t('Verification evidence', 'دليل التحقق')}
                    <textarea name="evidence" minLength={8} required />
                  </label>
                  <button className="warehouse-primary" disabled={busy}>
                    {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Confirm handoff', 'تأكيد التسليم')}
                  </button>
                </form>
              )}
              {message && (
                <p className="warehouse-message" role="status">
                  {message}
                </p>
              )}
              <section className="warehouse-history">
                <h3>{t('Custody history', 'سجل العهدة')}</h3>
                {selected.events.length === 0 ? (
                  <p>{t('No custody handoffs recorded yet.', 'لم تُسجّل عمليات تسليم بعد.')}</p>
                ) : (
                  selected.events
                    .slice()
                    .reverse()
                    .map((event) => (
                      <article key={event.id}>
                        <span>{actionLabel(event.action)}</span>
                        <strong>
                          {statusLabel(event.fromStatus)} → {statusLabel(event.toStatus)}
                        </strong>
                        <small>
                          {new Date(event.occurredAt).toLocaleString(
                            locale === 'ar' ? 'ar-LB' : 'en-LB',
                          )}
                        </small>
                        <p>{locale === 'ar' ? event.reasonAr : event.reasonEn}</p>
                      </article>
                    ))
                )}
              </section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
