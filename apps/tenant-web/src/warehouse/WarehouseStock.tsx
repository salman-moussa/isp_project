import { useMemo, useState, type FormEvent } from 'react';
import type {
  StockCommand,
  StockMovementRecord,
  RmaCommand,
  VendorQuoteCommand,
  StockCountCommand,
  StockReservationCommand,
  WarehouseWorkspace as Workspace,
} from '@isp/contracts';
import {
  stockCommandSchema,
  rmaCommandSchema,
  vendorQuoteCommandSchema,
  stockCountCommandSchema,
  stockReservationCommandSchema,
} from '@isp/contracts';
import type { Locale } from '@isp/ui';

type Translate = (en: string, ar: string) => string;
type Tab =
  | 'balances'
  | 'reservations'
  | 'counts'
  | 'rma'
  | 'reorder'
  | 'quotes'
  | 'transfer'
  | 'adjust'
  | 'movements';

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
  onReserve,
  onCount,
  onRma,
  onQuote,
}: {
  readonly locale: Locale;
  readonly data: Workspace;
  readonly busy: boolean;
  readonly message: string;
  readonly onSubmit: (command: StockCommand) => void;
  readonly onReserve: (command: StockReservationCommand) => void;
  readonly onCount: (command: StockCountCommand) => void;
  readonly onRma: (command: RmaCommand) => void;
  readonly onQuote: (command: VendorQuoteCommand) => void;
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
      reservation_hold: t('Reserved', 'حجز'),
      reservation_release: t('Reservation released', 'إلغاء حجز'),
      consumption: t('Consumed', 'استهلاك'),
      count_increase: t('Count surplus', 'زيادة جرد'),
      count_decrease: t('Count shortfall', 'نقص جرد'),
    })[kind];

  const dispatchQuote = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = vendorQuoteCommandSchema.safeParse(build(new FormData(form)));
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
    onQuote(parsed.data);
    form.reset();
  };

  const dispatchRma = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = rmaCommandSchema.safeParse(build(new FormData(form)));
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
    onRma(parsed.data);
    form.reset();
  };

  const dispatchCount = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = stockCountCommandSchema.safeParse(build(new FormData(form)));
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
    onCount(parsed.data);
    form.reset();
  };

  const dispatchReservation = (
    event: FormEvent<HTMLFormElement>,
    build: (form: FormData) => unknown,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = stockReservationCommandSchema.safeParse(build(new FormData(form)));
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
    onReserve(parsed.data);
    form.reset();
  };

  const reservationStatusLabel = (status: 'held' | 'released' | 'consumed') =>
    ({
      held: t('Held', 'محجوز'),
      released: t('Released', 'أُلغي'),
      consumed: t('Consumed', 'استُهلك'),
    })[status];

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
    { id: 'reservations', label: t('Reservations', 'الحجوزات') },
    { id: 'counts', label: t('Counts', 'الجرد') },
    { id: 'rma', label: t('RMA', 'الصيانة') },
    { id: 'reorder', label: t('Reorder', 'إعادة الطلب') },
    { id: 'quotes', label: t('Quotes', 'عروض الأسعار') },
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

      {tab === 'reservations' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-reservations"
          aria-labelledby="warehouse-stock-tab-reservations"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Reservations', 'الحجوزات')}</h3>
            <p className="warehouse-hint">
              {t(
                'Held quantity stays on hand but cannot be transferred away. Releasing returns it to free stock; consuming expenses what was actually used.',
                'الكمية المحجوزة تبقى في المخزون لكن لا يمكن نقلها. الإلغاء يعيدها للمخزون الحر، والاستهلاك يحمّل ما استُخدم فعلاً على المصاريف.',
              )}
            </p>
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">
                  {t('Stock reservations', 'حجوزات المخزون')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Reference', 'المرجع')}</th>
                    <th scope="col">{t('SKU', 'الرمز')}</th>
                    <th scope="col">{t('Location', 'الموقع')}</th>
                    <th scope="col">{t('Quantity', 'الكمية')}</th>
                    <th scope="col">{t('Service', 'الخدمة')}</th>
                    <th scope="col">{t('State', 'الحالة')}</th>
                    <th scope="col">{t('Action', 'إجراء')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockReservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td>{reservation.reference}</td>
                      <td>{reservation.sku}</td>
                      <td>
                        {reservation.warehouseCode}
                        {reservation.binCode ? ` · ${reservation.binCode}` : ''}
                      </td>
                      <td>{reservation.quantity}</td>
                      <td>{reservation.serviceNumber ?? t('Unlinked', 'غير مرتبط')}</td>
                      <td>{reservationStatusLabel(reservation.status)}</td>
                      <td>
                        {reservation.status === 'held' ? (
                          <span className="warehouse-row-actions">
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onReserve({
                                  action: 'consume_reservation',
                                  reservationId: reservation.id,
                                  expectedVersion: reservation.version,
                                  reasonEn: `Material consumed for ${reservation.reference}`,
                                  reasonAr: `تم استهلاك المواد للمرجع ${reservation.reference}`,
                                  evidence: `Consumption confirmed against ${reservation.reference}.`,
                                })
                              }
                            >
                              {t('Consume', 'استهلاك')}
                            </button>
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onReserve({
                                  action: 'release_reservation',
                                  reservationId: reservation.id,
                                  expectedVersion: reservation.version,
                                  reasonEn: `Reservation released for ${reservation.reference}`,
                                  reasonAr: `تم إلغاء الحجز للمرجع ${reservation.reference}`,
                                  evidence: `Release confirmed against ${reservation.reference}.`,
                                })
                              }
                            >
                              {t('Release', 'إلغاء')}
                            </button>
                          </span>
                        ) : (
                          <span className="warehouse-muted">{t('Closed', 'مغلق')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.stockReservations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="warehouse-empty">
                        {t('No stock is held for a job yet.', 'لا يوجد مخزون محجوز لأي مهمة بعد.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatchReservation(event, (form) => ({
                action: 'reserve_stock',
                itemId: readText(form, 'itemId'),
                quantity: readNumber(form, 'quantity'),
                warehouseId: readText(form, 'warehouseId'),
                binId: optionalId(form, 'binId'),
                installationId: optionalId(form, 'installationId'),
                reference: readText(form, 'reference'),
                ...evidenceFrom(form),
              }))
            }
          >
            <h3>{t('Hold stock for a job', 'حجز مخزون لمهمة')}</h3>
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
                {t('Installation (optional)', 'التركيب (اختياري)')}
                <select name="installationId" defaultValue="">
                  <option value="">{t('Not linked', 'غير مرتبط')}</option>
                  {data.installations.map((installation) => (
                    <option key={installation.id} value={installation.id}>
                      {installation.serviceNumber} · {installation.subscriberName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Job reference', 'مرجع المهمة')}
                <input name="reference" required minLength={2} maxLength={200} />
              </label>
            </div>
            <StockEvidenceFields t={t} />
            <button className="warehouse-primary" disabled={busy || bulkItems.length === 0}>
              {t('Hold stock', 'حجز المخزون')}
            </button>
          </form>
        </div>
      )}

      {tab === 'quotes' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-quotes"
          aria-labelledby="warehouse-stock-tab-quotes"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Quote requests', 'طلبات عروض الأسعار')}</h3>
            <p className="warehouse-hint">
              {t(
                'Ask several vendors, compare what comes back, and award. Awarding creates a draft purchase order at the quoted prices, which still goes through the normal approval.',
                'اطلب من عدة موردين، قارن ما يصل، ثم رَسِّ العرض. الترسية تنشئ مسودة طلب شراء بالأسعار المعروضة، وتبقى خاضعة للاعتماد المعتاد.',
              )}
            </p>
            {data.quoteRequests.length === 0 ? (
              <p className="warehouse-empty">
                {t('No quote request has been raised.', 'لم يُنشأ أي طلب عرض سعر.')}
              </p>
            ) : (
              data.quoteRequests.map((request) => (
                <article key={request.id} className="warehouse-count">
                  <header>
                    <div>
                      <strong>{request.requestNumber}</strong>
                      <small>
                        {request.warehouseCode}
                        {request.neededBy
                          ? ` · ${t('needed by', 'مطلوب قبل')} ${request.neededBy}`
                          : ''}
                      </small>
                    </div>
                    <span className={`warehouse-status warehouse-status--${request.status}`}>
                      {
                        {
                          open: t('Open', 'مفتوح'),
                          awarded: t('Awarded', 'مُرسى'),
                          cancelled: t('Cancelled', 'ملغى'),
                        }[request.status]
                      }
                    </span>
                  </header>
                  <div className="warehouse-table-scroll">
                    <table className="warehouse-table">
                      <caption className="warehouse-visually-hidden">
                        {t('Quotes for', 'عروض لـ')} {request.requestNumber}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('Vendor', 'المورد')}</th>
                          <th scope="col">{t('Total', 'الإجمالي')}</th>
                          <th scope="col">{t('Lead time', 'مدة التوريد')}</th>
                          <th scope="col">{t('Valid until', 'صالح حتى')}</th>
                          <th scope="col">{t('State', 'الحالة')}</th>
                          <th scope="col">{t('Action', 'إجراء')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {request.quotes.map((quote) => (
                          <tr key={quote.id}>
                            <td>{locale === 'ar' ? quote.vendorNameAr : quote.vendorNameEn}</td>
                            <td>
                              {/* Currency is shown per quote; totals are never summed across currencies. */}
                              {(quote.totalAmountMinor / 100).toLocaleString(
                                locale === 'ar' ? 'ar-LB' : 'en-GB',
                              )}{' '}
                              {quote.currency}
                            </td>
                            <td>
                              {quote.leadTimeDays} {t('days', 'يوم')}
                            </td>
                            <td>{quote.validUntil ?? '—'}</td>
                            <td>
                              {
                                {
                                  received: t('Received', 'مستلم'),
                                  awarded: t('Awarded', 'مُرسى'),
                                  rejected: t('Not selected', 'غير مختار'),
                                }[quote.status]
                              }
                            </td>
                            <td>
                              {request.status === 'open' ? (
                                <button
                                  type="button"
                                  className="warehouse-link"
                                  disabled={busy}
                                  onClick={() =>
                                    onQuote({
                                      action: 'award_quote',
                                      requestId: request.id,
                                      expectedVersion: request.version,
                                      quoteId: quote.id,
                                      poNumber: `PO-${request.requestNumber}`,
                                      reasonEn: `Awarding ${request.requestNumber} to the selected vendor`,
                                      reasonAr: `ترسية ${request.requestNumber} على المورد المختار`,
                                      evidence: `Comparison sheet for ${request.requestNumber} approved.`,
                                    })
                                  }
                                >
                                  {t('Award', 'ترسية')}
                                </button>
                              ) : (
                                <span className="warehouse-muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {request.quotes.length === 0 && (
                          <tr>
                            <td colSpan={6} className="warehouse-empty">
                              {t('No quote received yet.', 'لم يُستلم أي عرض بعد.')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))
            )}
          </div>

          <form
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatchQuote(event, (form) => ({
                action: 'create_quote_request',
                requestNumber: readText(form, 'requestNumber'),
                warehouseId: readText(form, 'warehouseId'),
                neededBy: optionalId(form, 'neededBy'),
                lines: [
                  {
                    itemId: readText(form, 'itemId'),
                    quantity: readNumber(form, 'quantity'),
                  },
                ],
                ...evidenceFrom(form),
              }))
            }
          >
            <h3>{t('Request quotes', 'طلب عروض أسعار')}</h3>
            <label>
              {t('Request number', 'رقم الطلب')}
              <input name="requestNumber" required minLength={2} maxLength={80} />
            </label>
            <div className="warehouse-form__pair">
              <label>
                {t('Item', 'الصنف')}
                <select name="itemId" required defaultValue="">
                  <option value="">{t('Choose', 'اختر')}</option>
                  {data.items
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sku} · {locale === 'ar' ? item.nameAr : item.nameEn}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('Quantity', 'الكمية')}
                <input name="quantity" type="number" min={1} max={10000} required />
              </label>
            </div>
            <div className="warehouse-form__pair">
              <label>
                {t('Deliver to', 'التسليم إلى')}
                <select name="warehouseId" required defaultValue="">
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
                {t('Needed by (optional)', 'مطلوب قبل (اختياري)')}
                <input name="neededBy" type="date" />
              </label>
            </div>
            <StockEvidenceFields t={t} />
            <button className="warehouse-primary" disabled={busy}>
              {t('Raise request', 'إنشاء الطلب')}
            </button>
          </form>
        </div>
      )}

      {tab === 'rma' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-rma"
          aria-labelledby="warehouse-stock-tab-rma"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Repair and return cases', 'حالات الصيانة والإرجاع')}</h3>
            <p className="warehouse-hint">
              {t(
                'A device sent for repair either comes back, is replaced, or is written off. Scrapping is the only step that touches the books and requires finance authority.',
                'الجهاز المرسل للصيانة إما يعود أو يُستبدل أو يُشطب. الإتلاف هو الخطوة الوحيدة التي تمس الدفاتر وتتطلب صلاحية مالية.',
              )}
            </p>
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">
                  {t('RMA cases', 'حالات الصيانة')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Case', 'الحالة')}</th>
                    <th scope="col">{t('Serial', 'التسلسل')}</th>
                    <th scope="col">{t('Vendor', 'المورد')}</th>
                    <th scope="col">{t('State', 'الوضع')}</th>
                    <th scope="col">{t('Replacement', 'البديل')}</th>
                    <th scope="col">{t('Action', 'إجراء')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rmaCases.map((rma) => (
                    <tr key={rma.id}>
                      <td>{rma.caseNumber}</td>
                      <td>{rma.serialNumber}</td>
                      <td>
                        {rma.vendorId
                          ? locale === 'ar'
                            ? rma.vendorNameAr
                            : rma.vendorNameEn
                          : t('None', 'لا يوجد')}
                      </td>
                      <td>
                        {
                          {
                            open: t('Open', 'مفتوحة'),
                            sent_to_vendor: t('At vendor', 'لدى المورد'),
                            repaired: t('Repaired', 'تم الإصلاح'),
                            replaced: t('Replaced', 'تم الاستبدال'),
                            scrapped: t('Written off', 'مشطوب'),
                            closed: t('Closed', 'مغلقة'),
                          }[rma.status]
                        }
                      </td>
                      <td>{rma.replacementSerialNumber ?? '—'}</td>
                      <td>
                        <span className="warehouse-row-actions">
                          {rma.status === 'open' && rma.vendorId && (
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onRma({
                                  action: 'send_to_vendor',
                                  caseId: rma.id,
                                  expectedVersion: rma.version,
                                  reasonEn: `Shipping ${rma.serialNumber} to the vendor for repair`,
                                  reasonAr: `إرسال ${rma.serialNumber} إلى المورد للإصلاح`,
                                  evidence: `Vendor claim raised against case ${rma.caseNumber}.`,
                                })
                              }
                            >
                              {t('Send to vendor', 'إرسال للمورد')}
                            </button>
                          )}
                          {rma.status === 'sent_to_vendor' && (
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onRma({
                                  action: 'receive_repaired',
                                  caseId: rma.id,
                                  expectedVersion: rma.version,
                                  reasonEn: `Repaired unit ${rma.serialNumber} returned to stock`,
                                  reasonAr: `عودة الوحدة ${rma.serialNumber} بعد الإصلاح للمخزون`,
                                  evidence: `Repair confirmed against case ${rma.caseNumber}.`,
                                })
                              }
                            >
                              {t('Receive repaired', 'استلام بعد الإصلاح')}
                            </button>
                          )}
                          {(rma.status === 'open' || rma.status === 'sent_to_vendor') && (
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onRma({
                                  action: 'scrap_asset',
                                  caseId: rma.id,
                                  expectedVersion: rma.version,
                                  reasonEn: `Writing off ${rma.serialNumber} as beyond repair`,
                                  reasonAr: `شطب ${rma.serialNumber} لتعذر إصلاحه`,
                                  evidence: `Write-off approved against case ${rma.caseNumber}.`,
                                })
                              }
                            >
                              {t('Write off', 'شطب')}
                            </button>
                          )}
                          {['repaired', 'replaced', 'scrapped'].includes(rma.status) && (
                            <button
                              type="button"
                              className="warehouse-link"
                              disabled={busy}
                              onClick={() =>
                                onRma({
                                  action: 'close_case',
                                  caseId: rma.id,
                                  expectedVersion: rma.version,
                                  reasonEn: `Closing resolved case ${rma.caseNumber}`,
                                  reasonAr: `إغلاق الحالة المنتهية ${rma.caseNumber}`,
                                  evidence: `Case ${rma.caseNumber} resolved and closed.`,
                                })
                              }
                            >
                              {t('Close', 'إغلاق')}
                            </button>
                          )}
                          {rma.status === 'closed' && (
                            <span className="warehouse-muted">{t('Closed', 'مغلقة')}</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.rmaCases.length === 0 && (
                    <tr>
                      <td colSpan={6} className="warehouse-empty">
                        {t('No repair case has been opened.', 'لم تُفتح أي حالة صيانة.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatchRma(event, (form) => ({
                action: 'open_case',
                caseNumber: readText(form, 'caseNumber'),
                assetId: readText(form, 'assetId'),
                vendorId: optionalId(form, 'vendorId'),
                faultSummary: readText(form, 'faultSummary'),
                ...evidenceFrom(form),
              }))
            }
          >
            <h3>{t('Open a repair case', 'فتح حالة صيانة')}</h3>
            <label>
              {t('Case number', 'رقم الحالة')}
              <input name="caseNumber" required minLength={2} maxLength={80} />
            </label>
            <label>
              {t('Device', 'الجهاز')}
              <select name="assetId" required defaultValue="">
                <option value="">{t('Choose', 'اختر')}</option>
                {data.assets
                  .filter((asset) => ['in_stock', 'returned'].includes(asset.status))
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.serialNumber} · {asset.sku}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('Vendor (optional)', 'المورد (اختياري)')}
              <select name="vendorId" defaultValue="">
                <option value="">{t('Not assigned', 'غير محدد')}</option>
                {data.vendors
                  .filter((vendor) => vendor.active)
                  .map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {locale === 'ar' ? vendor.nameAr : vendor.nameEn}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('Fault summary', 'ملخص العطل')}
              <textarea name="faultSummary" minLength={8} maxLength={1000} required />
            </label>
            <p className="warehouse-hint">
              {t(
                'Only a device physically back in a warehouse can enter a repair case.',
                'الجهاز الموجود فعلياً في المستودع فقط يمكن أن يدخل حالة صيانة.',
              )}
            </p>
            <StockEvidenceFields t={t} />
            <button className="warehouse-primary" disabled={busy}>
              {t('Open case', 'فتح الحالة')}
            </button>
          </form>
        </div>
      )}

      {tab === 'reorder' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-reorder"
          aria-labelledby="warehouse-stock-tab-reorder"
          className="warehouse-card"
        >
          <h3>{t('Purchasing suggestions', 'اقتراحات الشراء')}</h3>
          <p className="warehouse-hint">
            {t(
              'Locations whose available quantity, after subtracting reservations and what is already on order, sits below the reorder threshold. Nothing here commits a purchase.',
              'المواقع التي تقل كميتها المتاحة — بعد خصم الحجوزات وما هو قيد الطلب — عن حد إعادة الطلب. لا شيء هنا يلتزم بشراء.',
            )}
          </p>
          <div className="warehouse-table-scroll">
            <table className="warehouse-table">
              <caption className="warehouse-visually-hidden">
                {t('Purchasing suggestions', 'اقتراحات الشراء')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('SKU', 'الرمز')}</th>
                  <th scope="col">{t('Item', 'الصنف')}</th>
                  <th scope="col">{t('Warehouse', 'المستودع')}</th>
                  <th scope="col">{t('Available', 'المتاح')}</th>
                  <th scope="col">{t('On order', 'قيد الطلب')}</th>
                  <th scope="col">{t('Reorder at', 'حد إعادة الطلب')}</th>
                  <th scope="col">{t('Suggested', 'المقترح')}</th>
                </tr>
              </thead>
              <tbody>
                {data.reorderSuggestions.map((suggestion) => (
                  <tr key={`${suggestion.itemId}-${suggestion.warehouseId}`}>
                    <td>{suggestion.sku}</td>
                    <td>{locale === 'ar' ? suggestion.itemNameAr : suggestion.itemNameEn}</td>
                    <td>{suggestion.warehouseCode}</td>
                    <td>{suggestion.quantityAvailable}</td>
                    <td>{suggestion.quantityOnOrder}</td>
                    <td>{suggestion.reorderThreshold}</td>
                    <td>
                      <strong>{suggestion.suggestedQuantity}</strong>
                    </td>
                  </tr>
                ))}
                {data.reorderSuggestions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="warehouse-empty">
                      {t(
                        'Every stocked location is at or above its reorder threshold.',
                        'كل المواقع عند حد إعادة الطلب أو أعلى منه.',
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'counts' && (
        <div
          role="tabpanel"
          id="warehouse-stock-panel-counts"
          aria-labelledby="warehouse-stock-tab-counts"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Stock counts', 'عمليات الجرد')}</h3>
            <p className="warehouse-hint">
              {t(
                'A count freezes what the system believed, records what was found, and posts the difference once when closed. Closing requires finance authority.',
                'الجرد يثبّت ما يعتقده النظام، ويسجّل ما وُجد فعلاً، ويرحّل الفرق مرة واحدة عند الإغلاق. الإغلاق يتطلب صلاحية مالية.',
              )}
            </p>
            {data.stockCounts.length === 0 ? (
              <p className="warehouse-empty">
                {t('No count has been opened yet.', 'لم يُفتح أي جرد بعد.')}
              </p>
            ) : (
              data.stockCounts.map((count) => (
                <article key={count.id} className="warehouse-count">
                  <header>
                    <div>
                      <strong>{count.countNumber}</strong>
                      <small>
                        {count.warehouseCode}
                        {count.binCode ? ` · ${count.binCode}` : ''} · {count.currency}
                      </small>
                    </div>
                    <span className={`warehouse-status warehouse-status--${count.status}`}>
                      {
                        {
                          open: t('Open', 'مفتوح'),
                          closed: t('Closed', 'مغلق'),
                          cancelled: t('Cancelled', 'ملغى'),
                        }[count.status]
                      }
                    </span>
                  </header>
                  <div className="warehouse-table-scroll">
                    <table className="warehouse-table">
                      <caption className="warehouse-visually-hidden">
                        {t('Count lines', 'بنود الجرد')} {count.countNumber}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('SKU', 'الرمز')}</th>
                          <th scope="col">{t('System', 'النظام')}</th>
                          <th scope="col">{t('Counted', 'المجرود')}</th>
                          <th scope="col">{t('Variance', 'الفرق')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {count.lines.map((line) => (
                          <tr key={line.id}>
                            <td>{line.sku}</td>
                            <td>{line.systemQuantity}</td>
                            <td>{line.countedQuantity ?? t('Not counted', 'لم يُجرد')}</td>
                            <td>
                              {line.variance === null
                                ? '—'
                                : line.variance > 0
                                  ? `+${line.variance}`
                                  : line.variance}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {count.status === 'open' && (
                    <form
                      className="warehouse-form"
                      onSubmit={(event) =>
                        dispatchCount(event, (form) => ({
                          action: 'record_count',
                          countId: count.id,
                          expectedVersion: count.version,
                          lines: count.lines.map((line) => ({
                            lineId: line.id,
                            countedQuantity: readNumber(form, `counted-${line.id}`),
                          })),
                          ...evidenceFrom(form),
                        }))
                      }
                    >
                      <h4>{t('Record counted quantities', 'تسجيل الكميات المجرودة')}</h4>
                      <div className="warehouse-form__pair">
                        {count.lines.map((line) => (
                          <label key={line.id}>
                            {line.sku}
                            <input
                              name={`counted-${line.id}`}
                              type="number"
                              min={0}
                              required
                              defaultValue={line.countedQuantity ?? line.systemQuantity}
                            />
                          </label>
                        ))}
                      </div>
                      <StockEvidenceFields t={t} />
                      <div className="warehouse-form__actions">
                        <button className="warehouse-primary" disabled={busy}>
                          {t('Save counted quantities', 'حفظ الكميات')}
                        </button>
                        <button
                          type="button"
                          className="warehouse-link"
                          disabled={busy}
                          onClick={() =>
                            onCount({
                              action: 'close_count',
                              countId: count.id,
                              expectedVersion: count.version,
                              reasonEn: `Closing stock count ${count.countNumber}`,
                              reasonAr: `إغلاق جرد المخزون ${count.countNumber}`,
                              evidence: `Count sheet ${count.countNumber} approved for posting.`,
                            })
                          }
                        >
                          {t('Close and post variance', 'إغلاق وترحيل الفرق')}
                        </button>
                        <button
                          type="button"
                          className="warehouse-link"
                          disabled={busy}
                          onClick={() =>
                            onCount({
                              action: 'cancel_count',
                              countId: count.id,
                              expectedVersion: count.version,
                              reasonEn: `Cancelling stock count ${count.countNumber}`,
                              reasonAr: `إلغاء جرد المخزون ${count.countNumber}`,
                              evidence: `Count sheet ${count.countNumber} abandoned without posting.`,
                            })
                          }
                        >
                          {t('Cancel count', 'إلغاء الجرد')}
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              ))
            )}
          </div>

          <form
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatchCount(event, (form) => ({
                action: 'open_count',
                countNumber: readText(form, 'countNumber'),
                warehouseId: readText(form, 'warehouseId'),
                binId: optionalId(form, 'binId'),
                currency: readText(form, 'currency'),
                ...evidenceFrom(form),
              }))
            }
          >
            <h3>{t('Open a count', 'فتح جرد')}</h3>
            <label>
              {t('Count number', 'رقم الجرد')}
              <input name="countNumber" required minLength={2} maxLength={80} />
            </label>
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
                  <option value="">{t('Whole warehouse', 'المستودع بالكامل')}</option>
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
            <label>
              {t('Valuation currency', 'عملة التقييم')}
              <select name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </label>
            <p className="warehouse-hint">
              {t(
                'Every line is valued in this one currency, so a count never mixes USD and LBP.',
                'تُقيَّم كل البنود بهذه العملة وحدها، لذا لا يخلط الجرد الدولار والليرة أبداً.',
              )}
            </p>
            <StockEvidenceFields t={t} />
            <button className="warehouse-primary" disabled={busy}>
              {t('Open count', 'فتح الجرد')}
            </button>
          </form>
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
