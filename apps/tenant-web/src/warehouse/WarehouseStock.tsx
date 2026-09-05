import { useMemo, useState, type FormEvent } from 'react';
import type {
  StockCommand,
  StockMovementRecord,
  WarehouseWorkspace as Workspace,
} from '@isp/contracts';
import { stockCommandSchema } from '@isp/contracts';
import type { Locale } from '@isp/ui';

type Translate = (en: string, ar: string) => string;
type Tab = 'balances' | 'transfer' | 'adjust' | 'movements';

/**
 * Bulk (non-serialized) stock: quantity per item, warehouse and bin.
 *
 * Transfers relocate quantity and post no journal. Adjustments change what the business owns,
 * so they post to the inventory variance account and are a finance action requiring step-up.
 * The two are separate tabs and separate routes so the difference is never accidental.
 */
export function WarehouseStock({
  locale,
  data,
  busy,
  message,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly data: Workspace;
  readonly busy: boolean;
  readonly message: string;
  readonly onSubmit: (command: StockCommand) => void;
}) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  const [tab, setTab] = useState<Tab>('balances');
  const [filter, setFilter] = useState('');
  const [validation, setValidation] = useState('');

  const bulkItems = useMemo(
    () => data.items.filter((item) => !item.serializedFlag && item.active),
    [data.items],
  );
  const balances = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return data.stockBalances;
    return data.stockBalances.filter((balance) =>
      [balance.sku, balance.itemNameEn, balance.itemNameAr, balance.warehouseCode]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [data.stockBalances, filter]);

  const totalOnHand = data.stockBalances.reduce((sum, b) => sum + b.quantityOnHand, 0);
  const belowReorder = data.stockBalances.filter(
    (b) => b.quantityOnHand <= b.reorderThreshold,
  ).length;

  const kindLabel = (kind: StockMovementRecord['kind']) =>
    ({
      receipt: t('Received', 'استلام'),
      transfer_out: t('Transferred out', 'تحويل صادر'),
      transfer_in: t('Transferred in', 'تحويل وارد'),
      adjustment_increase: t('Adjusted up', 'تسوية بالزيادة'),
      adjustment_decrease: t('Adjusted down', 'تسوية بالنقص'),
    })[kind];

  const readText = (form: FormData, name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const readNumber = (form: FormData, name: string) => Number(form.get(name) ?? 0);
  const optionalId = (form: FormData, name: string) => {
    const value = readText(form, name);
    return value === '' ? undefined : value;
  };
  const evidenceFrom = (form: FormData) => ({
    reasonEn: readText(form, 'reasonEn'),
    reasonAr: readText(form, 'reasonAr'),
    evidence: readText(form, 'evidence'),
  });

  const dispatch = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = stockCommandSchema.safeParse(build(new FormData(form)));
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ??
          t(
            'Complete every field, including bilingual reason and evidence, before saving.',
            'أكمل جميع الحقول، بما فيها السبب ثنائي اللغة والدليل، قبل الحفظ.',
          ),
      );
      return;
    }
    setValidation('');
    onSubmit(parsed.data);
    form.reset();
  };

  const tabs: readonly { readonly id: Tab; readonly label: string }[] = [
    { id: 'balances', label: t('On hand', 'المتوفر') },
    { id: 'transfer', label: t('Transfer', 'تحويل') },
    { id: 'adjust', label: t('Adjust', 'تسوية') },
    { id: 'movements', label: t('Movements', 'الحركات') },
  ];

  return (
    <section className="warehouse-stock" aria-labelledby="warehouse-stock-title">
      <div className="warehouse-panel__head">
        <div>
          <span>{t('Bulk stock', 'المخزون بالكمية')}</span>
          <h2 id="warehouse-stock-title">
            {t('Quantity by warehouse and bin', 'الكميات حسب المستودع والرف')}
          </h2>
          <p>
            {t(
              'Cable, connectors and other counted materials. Serialized devices are tracked individually under asset custody.',
              'الكابلات والموصلات والمواد التي تُعد بالكمية. الأجهزة المتسلسلة تُتابع فرديًا ضمن عهدة الأصول.',
            )}
          </p>
        </div>
        <div className="warehouse-score">
          <strong>{totalOnHand}</strong>
          <small>{t('units on hand', 'وحدة متوفرة')}</small>
        </div>
      </div>

      <section className="warehouse-metrics" aria-label={t('Stock summary', 'ملخص المخزون')}>
        <article>
          <small>{t('Stocked locations', 'مواقع بها مخزون')}</small>
          <strong>{data.stockBalances.length}</strong>
        </article>
        <article>
          <small>{t('At or below reorder point', 'عند حد إعادة الطلب أو دونه')}</small>
          <strong>{belowReorder}</strong>
        </article>
        <article>
          <small>{t('Bulk SKUs', 'أصناف بالكمية')}</small>
          <strong>{bulkItems.length}</strong>
        </article>
        <article>
          <small>{t('Recorded movements', 'حركات مسجلة')}</small>
          <strong>{data.stockMovements.length}</strong>
        </article>
      </section>

      <div
        className="warehouse-tabs"
        role="tablist"
        aria-label={t('Bulk stock', 'المخزون بالكمية')}
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`warehouse-stock-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`warehouse-stock-panel-${entry.id}`}
            className={tab === entry.id ? 'is-active' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {validation && (
        <p className="warehouse-message warehouse-message--error" role="alert">
          {validation}
        </p>
      )}

      {tab === 'balances' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-balances"
          aria-labelledby="warehouse-stock-tab-balances"
          className="warehouse-card"
        >
          <div className="warehouse-panel__head">
            <h3>{t('On hand', 'المتوفر')}</h3>
            <label>
              {t('Search', 'بحث')}
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('SKU, name, or warehouse', 'الرمز أو الاسم أو المستودع')}
              />
            </label>
          </div>
          <div className="warehouse-table-scroll">
            <table className="warehouse-table">
              <caption className="warehouse-visually-hidden">
                {t('Stock on hand', 'المخزون المتوفر')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('SKU', 'الرمز')}</th>
                  <th scope="col">{t('Item', 'الصنف')}</th>
                  <th scope="col">{t('Warehouse', 'المستودع')}</th>
                  <th scope="col">{t('Bin', 'الرف')}</th>
                  <th scope="col">{t('On hand', 'المتوفر')}</th>
                  <th scope="col">{t('Reserved', 'محجوز')}</th>
                  <th scope="col">{t('Reorder at', 'حد إعادة الطلب')}</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr
                    key={balance.id}
                    className={balance.quantityOnHand <= balance.reorderThreshold ? 'is-low' : ''}
                  >
                    <td>{balance.sku}</td>
                    <td>{locale === 'ar' ? balance.itemNameAr : balance.itemNameEn}</td>
                    <td>{balance.warehouseCode}</td>
                    <td>{balance.binCode ?? t('Unbinned', 'بدون رف')}</td>
                    <td>
                      {balance.quantityOnHand}
                      {balance.quantityOnHand <= balance.reorderThreshold && (
                        <span className="warehouse-flag">{t('Reorder', 'أعد الطلب')}</span>
                      )}
                    </td>
                    <td>{balance.quantityReserved}</td>
                    <td>{balance.reorderThreshold}</td>
                  </tr>
                ))}
                {balances.length === 0 && (
                  <tr>
                    <td colSpan={7} className="warehouse-empty">
                      {filter
                        ? t('No location matches this search.', 'لا يوجد موقع مطابق لهذا البحث.')
                        : t(
                            'No bulk stock yet. Receive a purchase order against a bulk SKU to open a balance.',
                            'لا يوجد مخزون بالكمية بعد. استلم طلب شراء لصنف بالكمية لفتح رصيد.',
                          )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'transfer' && (
        <form
          role="tabpanel"
          id="warehouse-stock-panel-transfer"
          aria-labelledby="warehouse-stock-tab-transfer"
          className="warehouse-form warehouse-card"
          onSubmit={(event) =>
            dispatch(event, (form) => ({
              action: 'transfer_stock',
              itemId: readText(form, 'itemId'),
              quantity: readNumber(form, 'quantity'),
              fromWarehouseId: readText(form, 'fromWarehouseId'),
              fromBinId: optionalId(form, 'fromBinId'),
              toWarehouseId: readText(form, 'toWarehouseId'),
              toBinId: optionalId(form, 'toBinId'),
              ...evidenceFrom(form),
            }))
          }
        >
          <h3>{t('Move stock between locations', 'نقل المخزون بين المواقع')}</h3>
          <p className="warehouse-hint">
            {t(
              'A transfer relocates quantity without changing what it is worth, so it posts no accounting entry.',
              'التحويل ينقل الكمية دون تغيير قيمتها، لذلك لا يُرحّل أي قيد محاسبي.',
            )}
          </p>
          <div className="warehouse-form__pair">
            <label>
              {t('Item', 'الصنف')}
              <select name="itemId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {bulkItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {locale === 'ar' ? item.nameAr : item.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Quantity', 'الكمية')}
              <input name="quantity" type="number" min={1} max={1000000} required />
            </label>
          </div>
          <div className="warehouse-form__pair">
            <label>
              {t('From warehouse', 'من المستودع')}
              <select name="fromWarehouseId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {data.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.warehouseCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('From bin (optional)', 'من الرف (اختياري)')}
              <select name="fromBinId" defaultValue="">
                <option value="">{t('Unbinned', 'بدون رف')}</option>
                {data.bins
                  .filter((bin) => bin.active)
                  .map((bin) => (
                    <option key={bin.id} value={bin.id}>
                      {bin.warehouseCode} · {bin.binCode}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="warehouse-form__pair">
            <label>
              {t('To warehouse', 'إلى المستودع')}
              <select name="toWarehouseId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {data.warehouses
                  .filter((warehouse) => warehouse.active)
                  .map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.warehouseCode}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('To bin (optional)', 'إلى الرف (اختياري)')}
              <select name="toBinId" defaultValue="">
                <option value="">{t('Unbinned', 'بدون رف')}</option>
                {data.bins
                  .filter((bin) => bin.active)
                  .map((bin) => (
                    <option key={bin.id} value={bin.id}>
                      {bin.warehouseCode} · {bin.binCode}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <StockEvidenceFields t={t} />
          <button className="warehouse-primary" disabled={busy || bulkItems.length === 0}>
            {t('Record transfer', 'تسجيل التحويل')}
          </button>
          {bulkItems.length === 0 && (
            <p className="warehouse-hint" role="status">
              {t(
                'No bulk SKU exists yet. Create one under master data first.',
                'لا يوجد صنف بالكمية بعد. أنشئ صنفاً من البيانات الأساسية أولاً.',
              )}
            </p>
          )}
        </form>
      )}

      {tab === 'adjust' && (
        <form
          role="tabpanel"
          id="warehouse-stock-panel-adjust"
          aria-labelledby="warehouse-stock-tab-adjust"
          className="warehouse-form warehouse-card"
          onSubmit={(event) =>
            dispatch(event, (form) => ({
              action: 'adjust_stock',
              itemId: readText(form, 'itemId'),
              quantity: readNumber(form, 'quantity'),
              warehouseId: readText(form, 'warehouseId'),
              binId: optionalId(form, 'binId'),
              direction: readText(form, 'direction'),
              currency: readText(form, 'currency'),
              ...evidenceFrom(form),
            }))
          }
        >
          <h3>{t('Correct a counted difference', 'تصحيح فرق جردي')}</h3>
          <p className="warehouse-hint warehouse-hint--warn">
            {t(
              'An adjustment changes what the business owns and posts to the inventory variance account. It requires finance authority and recent multi-factor verification.',
              'التسوية تغيّر ما تملكه الشركة وتُرحّل إلى حساب فروقات المخزون. تتطلب صلاحية مالية وتحققاً ثنائياً حديثاً.',
            )}
          </p>
          <div className="warehouse-form__pair">
            <label>
              {t('Item', 'الصنف')}
              <select name="itemId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {bulkItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {locale === 'ar' ? item.nameAr : item.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Quantity', 'الكمية')}
              <input name="quantity" type="number" min={1} max={1000000} required />
            </label>
          </div>
          <div className="warehouse-form__pair">
            <label>
              {t('Warehouse', 'المستودع')}
              <select name="warehouseId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {data.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.warehouseCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Bin (optional)', 'الرف (اختياري)')}
              <select name="binId" defaultValue="">
                <option value="">{t('Unbinned', 'بدون رف')}</option>
                {data.bins
                  .filter((bin) => bin.active)
                  .map((bin) => (
                    <option key={bin.id} value={bin.id}>
                      {bin.warehouseCode} · {bin.binCode}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="warehouse-form__pair">
            <label>
              {t('Direction', 'الاتجاه')}
              <select name="direction" defaultValue="decrease">
                <option value="decrease">{t('Decrease (loss, damage)', 'نقص (فقد أو تلف)')}</option>
                <option value="increase">
                  {t('Increase (found stock)', 'زيادة (مخزون وُجد)')}
                </option>
              </select>
            </label>
            <label>
              {t('Valuation currency', 'عملة التقييم')}
              <select name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </label>
          </div>
          <p className="warehouse-hint">
            {t(
              "Valued at the item's configured unit cost for the chosen currency. USD and LBP are posted to separate accounts and never combined.",
              'يُقيَّم بتكلفة الوحدة المحددة للصنف بالعملة المختارة. يُرحَّل الدولار والليرة إلى حسابين منفصلين ولا يُجمعان.',
            )}
          </p>
          <StockEvidenceFields t={t} />
          <button className="warehouse-primary" disabled={busy || bulkItems.length === 0}>
            {t('Post adjustment', 'ترحيل التسوية')}
          </button>
        </form>
      )}

      {tab === 'movements' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-movements"
          aria-labelledby="warehouse-stock-tab-movements"
          className="warehouse-card"
        >
          <h3>{t('Movement history', 'سجل الحركات')}</h3>
          {data.stockMovements.length === 0 ? (
            <p className="warehouse-empty">
              {t('No stock movement recorded yet.', 'لم تُسجَّل أي حركة مخزون بعد.')}
            </p>
          ) : (
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">
                  {t('Movement history', 'سجل الحركات')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('When', 'التاريخ')}</th>
                    <th scope="col">{t('Movement', 'الحركة')}</th>
                    <th scope="col">{t('SKU', 'الرمز')}</th>
                    <th scope="col">{t('Location', 'الموقع')}</th>
                    <th scope="col">{t('Quantity', 'الكمية')}</th>
                    <th scope="col">{t('Posted', 'مُرحّل')}</th>
                    <th scope="col">{t('Reason', 'السبب')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>
                        {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(movement.occurredAt))}
                      </td>
                      <td>{kindLabel(movement.kind)}</td>
                      <td>{movement.sku}</td>
                      <td>
                        {movement.warehouseCode}
                        {movement.binCode ? ` · ${movement.binCode}` : ''}
                      </td>
                      <td>{movement.quantity}</td>
                      <td>
                        {movement.journalEntryId
                          ? `${(movement.unitCostMinor * movement.quantity) / 100} ${movement.currency}`
                          : t('No entry', 'بدون قيد')}
                      </td>
                      <td className="warehouse-table__reason">
                        {locale === 'ar' ? movement.reasonAr : movement.reasonEn}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {message && (
        <p className="warehouse-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function StockEvidenceFields({ t }: { readonly t: Translate }) {
  return (
    <>
      <div className="warehouse-form__pair">
        <label>
          {t('Stock reason in English', 'سبب حركة المخزون بالإنجليزية')}
          <textarea name="reasonEn" minLength={8} maxLength={1000} required />
        </label>
        <label>
          {t('Stock reason in Arabic', 'سبب حركة المخزون بالعربية')}
          <textarea name="reasonAr" minLength={8} maxLength={1000} required dir="rtl" />
        </label>
      </div>
      <label>
        {t('Stock evidence / reference', 'دليل / مرجع حركة المخزون')}
        <textarea name="evidence" minLength={8} maxLength={2000} required />
      </label>
    </>
  );
}
