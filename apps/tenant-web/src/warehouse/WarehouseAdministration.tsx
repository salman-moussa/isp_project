import { useMemo, useState, type FormEvent } from 'react';
import type {
  InventoryItemRecord,
  WarehouseAdminCommand,
  WarehouseBinRecord,
  WarehouseRecord,
  WarehouseWorkspace as Workspace,
} from '@isp/contracts';
import { warehouseAdminCommandSchema } from '@isp/contracts';
import type { Locale } from '@isp/ui';

type Translate = (en: string, ar: string) => string;
type Tab = 'items' | 'warehouses' | 'bins' | 'history';

/**
 * Catalog, warehouse and bin administration.
 *
 * Every edit is a full replacement guarded by the record's `version`, so the form always
 * carries the values the operator actually reviewed. A stale version is reported as a
 * refresh-and-retry conflict rather than being merged silently.
 */
export function WarehouseAdministration({
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
  readonly onSubmit: (command: WarehouseAdminCommand) => void;
}) {
  const t: Translate = (en, ar) => (locale === 'ar' ? ar : en);
  const rtl = locale === 'ar';
  const [tab, setTab] = useState<Tab>('items');
  const [itemFilter, setItemFilter] = useState('');
  const [editingItem, setEditingItem] = useState<InventoryItemRecord>();
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseRecord>();
  const [editingBin, setEditingBin] = useState<WarehouseBinRecord>();

  const items = useMemo(() => {
    const query = itemFilter.trim().toLowerCase();
    if (!query) return data.items;
    return data.items.filter((item) =>
      [item.sku, item.nameEn, item.nameAr].some((value) => value.toLowerCase().includes(query)),
    );
  }, [data.items, itemFilter]);

  const categoryLabel = (category: InventoryItemRecord['category']) =>
    ({
      router_cpe: t('Router / CPE', 'راوتر / معدة عميل'),
      ont_onu: t('ONT / ONU', 'وحدة ألياف'),
      fiber_cable: t('Fiber cable', 'كابل ألياف'),
      drop_wire: t('Drop wire', 'سلك توصيل'),
      connector: t('Connector', 'موصل'),
      accessory: t('Accessory', 'ملحق'),
      other: t('Other', 'أخرى'),
    })[category];
  const binKindLabel = (kind: WarehouseBinRecord['binKind']) =>
    ({
      stock: t('Stock', 'مخزون'),
      staging: t('Staging', 'تجهيز'),
      quarantine: t('Quarantine', 'حجر'),
      rma: t('RMA', 'صيانة المورد'),
      scrap: t('Scrap', 'إتلاف'),
    })[kind];
  const actionLabel = (action: WarehouseAdminCommand['action']) =>
    ({
      create_item: t('Item created', 'تم إنشاء صنف'),
      update_item: t('Item updated', 'تم تعديل صنف'),
      create_warehouse: t('Warehouse created', 'تم إنشاء مستودع'),
      update_warehouse: t('Warehouse updated', 'تم تعديل مستودع'),
      create_bin: t('Bin created', 'تم إنشاء رف'),
      update_bin: t('Bin updated', 'تم تعديل رف'),
    })[action];

  const tabs: readonly { readonly id: Tab; readonly label: string; readonly count: number }[] = [
    { id: 'items', label: t('Catalog items', 'أصناف الفهرس'), count: data.items.length },
    { id: 'warehouses', label: t('Warehouses', 'المستودعات'), count: data.warehouses.length },
    { id: 'bins', label: t('Bins', 'الأرفف'), count: data.bins.length },
    {
      id: 'history',
      label: t('Change history', 'سجل التغييرات'),
      count: data.administrationEvents.length,
    },
  ];

  const readNumber = (form: FormData, name: string) => Number(form.get(name) ?? 0);
  const readText = (form: FormData, name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const readChecked = (form: FormData, name: string) => form.get(name) === 'on';
  const evidenceFrom = (form: FormData) => ({
    reasonEn: readText(form, 'reasonEn'),
    reasonAr: readText(form, 'reasonAr'),
    evidence: readText(form, 'evidence'),
  });

  const [validation, setValidation] = useState('');
  const dispatch = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => unknown) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = warehouseAdminCommandSchema.safeParse(build(form));
    if (!parsed.success) {
      setValidation(
        t(
          'Complete every field, including bilingual reason and evidence, before saving.',
          'أكمل جميع الحقول، بما فيها السبب ثنائي اللغة والدليل، قبل الحفظ.',
        ),
      );
      return;
    }
    setValidation('');
    onSubmit(parsed.data);
  };

  return (
    <section className="warehouse-administration" aria-labelledby="warehouse-admin-title">
      <div className="warehouse-panel__head">
        <div>
          <span>{t('Master data', 'البيانات الأساسية')}</span>
          <h2 id="warehouse-admin-title">
            {t('Catalog, warehouses, and bins', 'الفهرس والمستودعات والأرفف')}
          </h2>
          <p>
            {t(
              'Every change is versioned, bilingual, and permanently recorded. Serialization cannot change once stock or purchase commitments exist.',
              'كل تغيير موثّق بإصدار وثنائي اللغة ومحفوظ بشكل دائم. لا يمكن تغيير التسلسل بعد وجود مخزون أو التزامات شراء.',
            )}
          </p>
        </div>
      </div>

      <div
        className="warehouse-tabs"
        role="tablist"
        aria-label={t('Master data', 'البيانات الأساسية')}
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`warehouse-admin-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`warehouse-admin-panel-${entry.id}`}
            className={tab === entry.id ? 'is-active' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            <span className="warehouse-tabs__count">{entry.count}</span>
          </button>
        ))}
      </div>

      {validation && (
        <p className="warehouse-message warehouse-message--error" role="alert">
          {validation}
        </p>
      )}

      {tab === 'items' && (
        <div
          role="tabpanel"
          id="warehouse-admin-panel-items"
          aria-labelledby="warehouse-admin-tab-items"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <div className="warehouse-panel__head">
              <h3>{t('Catalog', 'الفهرس')}</h3>
              <label>
                {t('Search', 'بحث')}
                <input
                  value={itemFilter}
                  onChange={(event) => setItemFilter(event.target.value)}
                  placeholder={t('SKU or name', 'رمز الصنف أو الاسم')}
                />
              </label>
            </div>
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">
                  {t('Catalog items', 'أصناف الفهرس')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('SKU', 'الرمز')}</th>
                    <th scope="col">{t('Name', 'الاسم')}</th>
                    <th scope="col">{t('Category', 'الفئة')}</th>
                    <th scope="col">{t('Tracking', 'التتبع')}</th>
                    <th scope="col">{t('Reorder at', 'حد إعادة الطلب')}</th>
                    <th scope="col">{t('State', 'الحالة')}</th>
                    <th scope="col">{t('Edit', 'تعديل')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.active ? '' : 'is-retired'}>
                      <td>{item.sku}</td>
                      <td>{locale === 'ar' ? item.nameAr : item.nameEn}</td>
                      <td>{categoryLabel(item.category)}</td>
                      <td>
                        {item.serializedFlag
                          ? t('Serialized', 'متسلسل')
                          : t('Bulk quantity', 'كمية')}
                      </td>
                      <td>{item.reorderThreshold}</td>
                      <td>{item.active ? t('Active', 'نشط') : t('Retired', 'متوقف')}</td>
                      <td>
                        <button
                          type="button"
                          className="warehouse-link"
                          onClick={() => setEditingItem(item)}
                        >
                          {t('Edit', 'تعديل')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="warehouse-empty">
                        {itemFilter
                          ? t('No item matches this search.', 'لا يوجد صنف مطابق لهذا البحث.')
                          : t(
                              'No catalog item yet. Create the first SKU to enable purchasing and receiving.',
                              'لا يوجد صنف بعد. أنشئ أول رمز صنف لتفعيل الشراء والاستلام.',
                            )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            key={editingItem?.id ?? 'new-item'}
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatch(event, (form) =>
                editingItem
                  ? {
                      action: 'update_item',
                      itemId: editingItem.id,
                      expectedVersion: editingItem.version,
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      category: readText(form, 'category'),
                      unitCostMinorUsd: readNumber(form, 'unitCostMinorUsd'),
                      unitCostMinorLbp: readNumber(form, 'unitCostMinorLbp'),
                      serializedFlag: readChecked(form, 'serializedFlag'),
                      reorderThreshold: readNumber(form, 'reorderThreshold'),
                      active: readChecked(form, 'active'),
                      ...evidenceFrom(form),
                    }
                  : {
                      action: 'create_item',
                      sku: readText(form, 'sku'),
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      category: readText(form, 'category'),
                      unitCostMinorUsd: readNumber(form, 'unitCostMinorUsd'),
                      unitCostMinorLbp: readNumber(form, 'unitCostMinorLbp'),
                      serializedFlag: readChecked(form, 'serializedFlag'),
                      reorderThreshold: readNumber(form, 'reorderThreshold'),
                      ...evidenceFrom(form),
                    },
              )
            }
          >
            <h3>
              {editingItem
                ? t(`Edit ${editingItem.sku}`, `تعديل ${editingItem.sku}`)
                : t('Add catalog item', 'إضافة صنف')}
            </h3>
            {editingItem ? (
              <p className="warehouse-hint">
                {t(
                  `Saving replaces version ${editingItem.version}. If someone else saved first, refresh and reapply.`,
                  `الحفظ يستبدل الإصدار ${editingItem.version}. إذا حفظ شخص آخر أولاً، حدّث الصفحة وأعد التطبيق.`,
                )}
              </p>
            ) : (
              <label>
                {t('SKU', 'رمز الصنف')}
                <input name="sku" required minLength={2} maxLength={50} />
              </label>
            )}
            <div className="warehouse-form__pair">
              <label>
                {t('English name', 'الاسم بالإنجليزية')}
                <input name="nameEn" required defaultValue={editingItem?.nameEn ?? ''} />
              </label>
              <label>
                {t('Arabic name', 'الاسم بالعربية')}
                <input name="nameAr" required dir="rtl" defaultValue={editingItem?.nameAr ?? ''} />
              </label>
            </div>
            <div className="warehouse-form__pair">
              <label>
                {t('Category', 'الفئة')}
                <select name="category" defaultValue={editingItem?.category ?? 'router_cpe'}>
                  {(
                    [
                      'router_cpe',
                      'ont_onu',
                      'fiber_cable',
                      'drop_wire',
                      'connector',
                      'accessory',
                      'other',
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Reorder threshold', 'حد إعادة الطلب')}
                <input
                  name="reorderThreshold"
                  type="number"
                  min={0}
                  max={100000}
                  required
                  defaultValue={editingItem?.reorderThreshold ?? 5}
                />
              </label>
            </div>
            <div className="warehouse-form__pair">
              <label>
                {t('Unit cost (USD cents)', 'تكلفة الوحدة (سنت أمريكي)')}
                <input
                  name="unitCostMinorUsd"
                  type="number"
                  min={0}
                  required
                  defaultValue={editingItem?.unitCostMinorUsd ?? 0}
                />
              </label>
              <label>
                {t('Unit cost (LBP minor)', 'تكلفة الوحدة (ليرة – وحدة صغرى)')}
                <input
                  name="unitCostMinorLbp"
                  type="number"
                  min={0}
                  required
                  defaultValue={editingItem?.unitCostMinorLbp ?? 0}
                />
              </label>
            </div>
            <p className="warehouse-hint">
              {t(
                'USD and LBP costs are recorded separately and are never added together.',
                'تُسجَّل تكلفة الدولار والليرة بشكل منفصل ولا تُجمعان أبداً.',
              )}
            </p>
            <label className="warehouse-check">
              <input
                name="serializedFlag"
                type="checkbox"
                defaultChecked={editingItem?.serializedFlag ?? true}
              />
              {t('Track each unit by serial number', 'تتبّع كل وحدة برقم تسلسلي')}
            </label>
            {editingItem && (
              <label className="warehouse-check">
                <input name="active" type="checkbox" defaultChecked={editingItem.active} />
                {t('Available for purchasing', 'متاح للشراء')}
              </label>
            )}
            <AdminEvidenceFields t={t} />
            <div className="warehouse-form__actions">
              <button className="warehouse-primary" disabled={busy}>
                {editingItem ? t('Save item', 'حفظ الصنف') : t('Create item', 'إنشاء الصنف')}
              </button>
              {editingItem && (
                <button
                  type="button"
                  className="warehouse-link"
                  onClick={() => setEditingItem(undefined)}
                >
                  {t('Cancel', 'إلغاء')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === 'warehouses' && (
        <div
          role="tabpanel"
          id="warehouse-admin-panel-warehouses"
          aria-labelledby="warehouse-admin-tab-warehouses"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Warehouses', 'المستودعات')}</h3>
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">
                  {t('Warehouses', 'المستودعات')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Code', 'الرمز')}</th>
                    <th scope="col">{t('Name', 'الاسم')}</th>
                    <th scope="col">{t('Address', 'العنوان')}</th>
                    <th scope="col">{t('Role', 'الدور')}</th>
                    <th scope="col">{t('State', 'الحالة')}</th>
                    <th scope="col">{t('Edit', 'تعديل')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warehouses.map((warehouse) => (
                    <tr key={warehouse.id} className={warehouse.active ? '' : 'is-retired'}>
                      <td>{warehouse.warehouseCode}</td>
                      <td>{locale === 'ar' ? warehouse.nameAr : warehouse.nameEn}</td>
                      <td>{warehouse.locationAddress}</td>
                      <td>
                        {warehouse.isPrimary ? t('Primary', 'رئيسي') : t('Secondary', 'فرعي')}
                      </td>
                      <td>{warehouse.active ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}</td>
                      <td>
                        <button
                          type="button"
                          className="warehouse-link"
                          onClick={() => setEditingWarehouse(warehouse)}
                        >
                          {t('Edit', 'تعديل')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.warehouses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="warehouse-empty">
                        {t(
                          'No warehouse in scope yet. Create one to receive stock.',
                          'لا يوجد مستودع ضمن النطاق. أنشئ مستودعاً لاستلام المخزون.',
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            key={editingWarehouse?.id ?? 'new-warehouse'}
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatch(event, (form) =>
                editingWarehouse
                  ? {
                      action: 'update_warehouse',
                      warehouseId: editingWarehouse.id,
                      expectedVersion: editingWarehouse.version,
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      locationAddress: readText(form, 'locationAddress'),
                      branchId: readText(form, 'branchId'),
                      isPrimary: readChecked(form, 'isPrimary'),
                      active: readChecked(form, 'active'),
                      ...evidenceFrom(form),
                    }
                  : {
                      action: 'create_warehouse',
                      warehouseCode: readText(form, 'warehouseCode'),
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      locationAddress: readText(form, 'locationAddress'),
                      branchId: readText(form, 'branchId'),
                      isPrimary: readChecked(form, 'isPrimary'),
                      ...evidenceFrom(form),
                    },
              )
            }
          >
            <h3>
              {editingWarehouse
                ? t(
                    `Edit ${editingWarehouse.warehouseCode}`,
                    `تعديل ${editingWarehouse.warehouseCode}`,
                  )
                : t('Add warehouse', 'إضافة مستودع')}
            </h3>
            {!editingWarehouse && (
              <label>
                {t('Warehouse code', 'رمز المستودع')}
                <input name="warehouseCode" required minLength={2} maxLength={50} />
              </label>
            )}
            <div className="warehouse-form__pair">
              <label>
                {t('English name', 'الاسم بالإنجليزية')}
                <input name="nameEn" required defaultValue={editingWarehouse?.nameEn ?? ''} />
              </label>
              <label>
                {t('Arabic name', 'الاسم بالعربية')}
                <input
                  name="nameAr"
                  required
                  dir="rtl"
                  defaultValue={editingWarehouse?.nameAr ?? ''}
                />
              </label>
            </div>
            <label>
              {t('Address', 'العنوان')}
              <input
                name="locationAddress"
                required
                defaultValue={editingWarehouse?.locationAddress ?? ''}
              />
            </label>
            <label>
              {t('Branch', 'الفرع')}
              <select
                name="branchId"
                required
                defaultValue={editingWarehouse?.branchId ?? data.branches[0]?.id ?? ''}
              >
                <option value="">{t('Choose', 'اختر')}</option>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} · {locale === 'ar' ? branch.nameAr : branch.nameEn}
                  </option>
                ))}
              </select>
            </label>
            {data.branches.length === 0 && (
              <p className="warehouse-hint" role="status">
                {t(
                  'No branch is in your scope, so a warehouse cannot be placed. Ask an administrator to widen your branch scope.',
                  'لا يوجد فرع ضمن نطاقك، لذا لا يمكن إنشاء مستودع. اطلب من المسؤول توسيع نطاق الفروع.',
                )}
              </p>
            )}
            <label className="warehouse-check">
              <input
                name="isPrimary"
                type="checkbox"
                defaultChecked={editingWarehouse?.isPrimary ?? false}
              />
              {t('Primary warehouse for the tenant', 'المستودع الرئيسي للمشترك')}
            </label>
            <p className="warehouse-hint">
              {t(
                'Only one warehouse is primary. Setting this demotes the current primary in the same transaction, and requires tenant-wide scope.',
                'مستودع واحد فقط يكون رئيسياً. التفعيل يلغي الرئيسي الحالي في المعاملة نفسها، ويتطلب نطاقاً على مستوى المشترك.',
              )}
            </p>
            {editingWarehouse && (
              <label className="warehouse-check">
                <input name="active" type="checkbox" defaultChecked={editingWarehouse.active} />
                {t('Open for stock movement', 'مفتوح لحركة المخزون')}
              </label>
            )}
            <AdminEvidenceFields t={t} />
            <div className="warehouse-form__actions">
              <button className="warehouse-primary" disabled={busy || data.branches.length === 0}>
                {editingWarehouse
                  ? t('Save warehouse', 'حفظ المستودع')
                  : t('Create warehouse', 'إنشاء المستودع')}
              </button>
              {editingWarehouse && (
                <button
                  type="button"
                  className="warehouse-link"
                  onClick={() => setEditingWarehouse(undefined)}
                >
                  {t('Cancel', 'إلغاء')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === 'bins' && (
        <div
          role="tabpanel"
          id="warehouse-admin-panel-bins"
          aria-labelledby="warehouse-admin-tab-bins"
          className="warehouse-admin-grid"
        >
          <div className="warehouse-card">
            <h3>{t('Bins', 'الأرفف')}</h3>
            <div className="warehouse-table-scroll">
              <table className="warehouse-table">
                <caption className="warehouse-visually-hidden">{t('Bins', 'الأرفف')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Warehouse', 'المستودع')}</th>
                    <th scope="col">{t('Bin', 'الرف')}</th>
                    <th scope="col">{t('Name', 'الاسم')}</th>
                    <th scope="col">{t('Purpose', 'الغرض')}</th>
                    <th scope="col">{t('State', 'الحالة')}</th>
                    <th scope="col">{t('Edit', 'تعديل')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bins.map((bin) => (
                    <tr key={bin.id} className={bin.active ? '' : 'is-retired'}>
                      <td>{bin.warehouseCode}</td>
                      <td>{bin.binCode}</td>
                      <td>{locale === 'ar' ? bin.nameAr : bin.nameEn}</td>
                      <td>{binKindLabel(bin.binKind)}</td>
                      <td>{bin.active ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}</td>
                      <td>
                        <button
                          type="button"
                          className="warehouse-link"
                          onClick={() => setEditingBin(bin)}
                        >
                          {t('Edit', 'تعديل')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.bins.length === 0 && (
                    <tr>
                      <td colSpan={6} className="warehouse-empty">
                        {t(
                          'No bin defined yet. Bins divide a warehouse into countable locations.',
                          'لا يوجد رف بعد. تقسّم الأرفف المستودع إلى مواقع قابلة للجرد.',
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            key={editingBin?.id ?? 'new-bin'}
            className="warehouse-form warehouse-card"
            onSubmit={(event) =>
              dispatch(event, (form) =>
                editingBin
                  ? {
                      action: 'update_bin',
                      binId: editingBin.id,
                      expectedVersion: editingBin.version,
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      binKind: readText(form, 'binKind'),
                      active: readChecked(form, 'active'),
                      ...evidenceFrom(form),
                    }
                  : {
                      action: 'create_bin',
                      warehouseId: readText(form, 'warehouseId'),
                      binCode: readText(form, 'binCode'),
                      nameEn: readText(form, 'nameEn'),
                      nameAr: readText(form, 'nameAr'),
                      binKind: readText(form, 'binKind'),
                      ...evidenceFrom(form),
                    },
              )
            }
          >
            <h3>
              {editingBin
                ? t(`Edit ${editingBin.binCode}`, `تعديل ${editingBin.binCode}`)
                : t('Add bin', 'إضافة رف')}
            </h3>
            {!editingBin && (
              <div className="warehouse-form__pair">
                <label>
                  {t('Warehouse', 'المستودع')}
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
                  {t('Bin code', 'رمز الرف')}
                  <input name="binCode" required minLength={1} maxLength={40} />
                </label>
              </div>
            )}
            <div className="warehouse-form__pair">
              <label>
                {t('English name', 'الاسم بالإنجليزية')}
                <input name="nameEn" required defaultValue={editingBin?.nameEn ?? ''} />
              </label>
              <label>
                {t('Arabic name', 'الاسم بالعربية')}
                <input name="nameAr" required dir="rtl" defaultValue={editingBin?.nameAr ?? ''} />
              </label>
            </div>
            <label>
              {t('Purpose', 'الغرض')}
              <select name="binKind" defaultValue={editingBin?.binKind ?? 'stock'}>
                {(['stock', 'staging', 'quarantine', 'rma', 'scrap'] as const).map((value) => (
                  <option key={value} value={value}>
                    {binKindLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            {editingBin && (
              <label className="warehouse-check">
                <input name="active" type="checkbox" defaultChecked={editingBin.active} />
                {t('Open for stock movement', 'مفتوح لحركة المخزون')}
              </label>
            )}
            <AdminEvidenceFields t={t} />
            <div className="warehouse-form__actions">
              <button
                className="warehouse-primary"
                disabled={busy || data.warehouses.filter((w) => w.active).length === 0}
              >
                {editingBin ? t('Save bin', 'حفظ الرف') : t('Create bin', 'إنشاء الرف')}
              </button>
              {editingBin && (
                <button
                  type="button"
                  className="warehouse-link"
                  onClick={() => setEditingBin(undefined)}
                >
                  {t('Cancel', 'إلغاء')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === 'history' && (
        <div
          role="tabpanel"
          id="warehouse-admin-panel-history"
          aria-labelledby="warehouse-admin-tab-history"
          className="warehouse-card"
        >
          <h3>{t('Change history', 'سجل التغييرات')}</h3>
          {data.administrationEvents.length === 0 ? (
            <p className="warehouse-empty">
              {t(
                'No master-data change has been recorded yet.',
                'لم يُسجَّل أي تغيير في البيانات الأساسية بعد.',
              )}
            </p>
          ) : (
            <ol className="warehouse-history">
              {data.administrationEvents.map((event) => (
                <li key={event.id}>
                  <article>
                    <header>
                      <strong>{actionLabel(event.action)}</strong>
                      <small>
                        {new Intl.DateTimeFormat(rtl ? 'ar-LB' : 'en-GB', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(event.occurredAt))}
                        {event.actorName ? ` · ${event.actorName}` : ''}
                        {` · ${t('version', 'إصدار')} ${event.aggregateVersion}`}
                      </small>
                    </header>
                    <p>{locale === 'ar' ? event.reasonAr : event.reasonEn}</p>
                    <p className="warehouse-history__evidence">{event.evidence}</p>
                  </article>
                </li>
              ))}
            </ol>
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

function AdminEvidenceFields({ t }: { readonly t: Translate }) {
  return (
    <>
      <div className="warehouse-form__pair">
        <label>
          {t('Reason in English', 'السبب بالإنجليزية')}
          <textarea name="reasonEn" minLength={8} maxLength={1000} required />
        </label>
        <label>
          {t('Reason in Arabic', 'السبب بالعربية')}
          <textarea name="reasonAr" minLength={8} maxLength={1000} required dir="rtl" />
        </label>
      </div>
      <label>
        {t('Approval evidence / reference', 'دليل الاعتماد / المرجع')}
        <textarea name="evidence" minLength={8} maxLength={2000} required />
      </label>
    </>
  );
}
