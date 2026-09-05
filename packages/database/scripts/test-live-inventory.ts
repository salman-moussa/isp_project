import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type {
  InventoryCustodyCommand,
  Permission,
  ProcurementCommand,
  WarehouseAdminCommand,
  StockCommand,
  StockReservationCommand,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  inOperationsTransaction,
  readWarehouseWorkspace,
  signOperationsAttestation,
  transitionInventoryCustody,
  executeProcurementCommand,
  executeWarehouseAdminCommand,
  executeStockCommand,
  executeStockReservationCommand,
} from '../src/index.js';

const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) throw new Error('Set local SALES_TEST database URLs.');
for (const value of [adminUrl, runtimeUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Serialized inventory acceptance is restricted to local isp_test.',
  );
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const keyId = `inventory-test-${randomUUID()}`;
const secret = randomBytes(32);
try {
  const tenantId = randomUUID() as VerifiedTenantId;
  const actorId = randomUUID();
  const branchId = randomUUID();
  const areaId = randomUUID();
  const routeId = randomUUID();
  const householdId = randomUUID();
  const locationId = randomUUID();
  const subscriberId = randomUUID();
  const planId = randomUUID();
  const serviceId = randomUUID();
  const installationId = randomUUID();
  const warehouseId = randomUUID();
  const itemId = randomUUID();
  const assetId = randomUUID();
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Inventory proof','Inventory proof','active')",
      [tenantId, `INV-${tenantId}`],
    );
    await transaction.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Inventory technician','not-a-login')",
      [actorId, `${actorId}@inventory.invalid`],
    );
    await transaction.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope) VALUES($1,$2,'owner',ARRAY['tenant.installation.view','tenant.installation.manage','tenant.catalog.manage','tenant.accounting.post'],$3::jsonb)",
      [
        tenantId,
        actorId,
        JSON.stringify({ branchIds: [branchId], areaIds: [areaId], routeIds: [routeId] }),
      ],
    );
    await transaction.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'INV-B','Inventory branch','فرع المخزون')",
      [branchId, tenantId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar) VALUES($1,$2,$3,'INV-A','Inventory area','منطقة المخزون')",
      [areaId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar) VALUES($1,$2,$3,$4,'INV-R','Inventory route','مسار المخزون')",
      [routeId, tenantId, branchId, areaId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_households(id,tenant_id,reference_code,display_name,branch_id) VALUES($1,$2,'INV-H','Inventory household',$3)",
      [householdId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_locations(id,tenant_id,household_id,label,address_line,branch_id,area_id,route_id) VALUES($1,$2,$3,'Inventory location','Local fixture',$4,$5,$6)",
      [locationId, tenantId, householdId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_subscribers(id,tenant_id,subscriber_number,idempotency_key,request_fingerprint,household_id,primary_location_id,display_name,status,branch_id,area_id,route_id) VALUES($1,$2,'INV-SUB','inventory-subscriber-1','fixture',$3,$4,'Inventory customer','active',$5,$6,$7)",
      [subscriberId, tenantId, householdId, locationId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_plans(id,tenant_id,code,name_en,name_ar,recurring_amount_minor,currency,branch_id,idempotency_key) VALUES($1,$2,'INV-P','Inventory plan','خطة المخزون',1000,'USD',$3,'inventory-plan-0001')",
      [planId, tenantId, branchId],
    );
    await transaction.unsafe(
      "INSERT INTO operations_services(id,tenant_id,subscriber_id,location_id,plan_id,service_number,status,billing_anchor_day,branch_id,area_id,route_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'INV-SVC','pending_installation',1,$6,$7,$8,'inventory-service-1')",
      [serviceId, tenantId, subscriberId, locationId, planId, branchId, areaId, routeId],
    );
  });
  await admin.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL session_replication_role='replica'");
    await transaction.unsafe(
      "INSERT INTO operations_context_keys(key_id,secret,active_from) VALUES($1,decode($2,'hex'),clock_timestamp()-interval '1 minute')",
      [keyId, secret.toString('hex')],
    );
    await transaction.unsafe(
      `INSERT INTO operations_installations(id,tenant_id,service_id,status,installer_user_id,branch_id,area_id,route_id,idempotency_key)
       VALUES($1,$2,$3,'in_progress',$4,$5,$6,$7,'inventory-install-1')`,
      [installationId, tenantId, serviceId, actorId, branchId, areaId, routeId],
    );
    await transaction.unsafe(
      `INSERT INTO operations_warehouses(id,tenant_id,branch_id,warehouse_code,name_en,name_ar,location_address,is_primary)
       VALUES($1,$2,$3,$4,'Inventory proof','مستودع الاختبار','Local acceptance',true)`,
      [warehouseId, tenantId, branchId, `WH-${warehouseId.slice(0, 8)}`],
    );
    await transaction.unsafe(
      `INSERT INTO operations_inventory_items(id,tenant_id,sku,name_en,name_ar,category,serialized_flag)
       VALUES($1,$2,$3,'Acceptance CPE','جهاز اختبار','router_cpe',true)`,
      [itemId, tenantId, `CPE-${itemId.slice(0, 8)}`],
    );
    await transaction.unsafe(
      `INSERT INTO operations_serialized_assets(id,tenant_id,item_id,serial_number,warehouse_id)
       VALUES($1,$2,$3,$4,$5)`,
      [assetId, tenantId, itemId, `SER-${assetId.slice(0, 8)}`, warehouseId],
    );
  });

  const sign = (
    action: string,
    permission: Permission,
    idempotencyKey = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    signOperationsAttestation(
      {
        keyId,
        tenantId,
        actorId,
        sessionId: randomUUID(),
        requestId: randomUUID(),
        permission,
        action,
        idempotencyKey,
        reason: 'Synthetic serialized inventory custody acceptance',
        ipAddress: '127.0.0.1',
        branchIds: [branchId],
        areaIds: [areaId],
        routeIds: [routeId],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      secret,
    );
  const read = (overrides: Record<string, unknown> = {}) =>
    readWarehouseWorkspace(
      runtime.db,
      tenantId,
      sign('tenant.warehouse.workspace.read', 'tenant.installation.view', randomUUID(), overrides),
    );
  const mutate = (command: InventoryCustodyCommand, key = randomUUID()) =>
    transitionInventoryCustody(runtime.db, tenantId, {
      command,
      authorization: sign('tenant.warehouse.custody.transition', 'tenant.installation.manage', key),
    });
  const procure = (
    command: ProcurementCommand,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    executeProcurementCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        command.action === 'approve_purchase_order'
          ? 'tenant.warehouse.procurement.approve'
          : 'tenant.warehouse.procurement.manage',
        command.action === 'approve_purchase_order'
          ? 'tenant.accounting.post'
          : 'tenant.catalog.manage',
        key,
        overrides,
      ),
    });

  const initial = await read();
  assert(initial.assets.some((asset) => asset.id === assetId && asset.version === 1));
  assert(initial.installations.some((installation) => installation.id === installationId));
  const denied = await read({ branchIds: [randomUUID()] });
  assert(!denied.assets.some((asset) => asset.id === assetId));

  const evidence = {
    reasonEn: 'Assigned for the active customer installation',
    reasonAr: 'تم التسليم لتركيب خدمة العميل النشطة',
    evidence: 'Serial number and equipment seal verified at handoff.',
  };
  const issue: InventoryCustodyCommand = {
    assetId,
    expectedVersion: 1,
    action: 'issue',
    installationId,
    custodianUserId: actorId,
    ...evidence,
  };
  const issueKey = randomUUID();
  assert.equal((await mutate(issue, issueKey)).version, 2);
  assert.equal((await mutate(issue, issueKey)).version, 2);
  await assert.rejects(mutate({ ...issue, evidence: 'Conflicting retry evidence.' }, issueKey));
  await assert.rejects(mutate({ ...issue, expectedVersion: 1 }));
  assert.equal(
    (await mutate({ ...evidence, assetId, expectedVersion: 2, action: 'install' })).version,
    3,
  );
  assert.equal(
    (
      await mutate({
        ...evidence,
        assetId,
        expectedVersion: 3,
        action: 'return',
        warehouseId,
      })
    ).version,
    4,
  );
  assert.equal(
    (await mutate({ ...evidence, assetId, expectedVersion: 4, action: 'rma' })).version,
    5,
  );
  const finished = await read();
  const asset = finished.assets.find((candidate) => candidate.id === assetId);
  assert.equal(asset?.status, 'rma');
  assert.equal(asset?.events.length, 4);
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.warehouse.custody.transition', 'tenant.installation.manage'),
      (transaction) =>
        transaction.execute(
          sql`UPDATE operations_inventory_custody_events SET evidence='tampered' WHERE asset_id=${assetId}::uuid`,
        ),
    ),
  );
  const [audit] = await admin.unsafe(
    "SELECT count(*)::int AS count FROM operations_audit_outbox WHERE tenant_id=$1 AND resource_type='operations_serialized_assets' AND resource_id=$2",
    [tenantId, assetId],
  );
  assert.equal(audit.count, 4);

  const procurementEvidence = {
    reasonEn: 'Approved for controlled stock replenishment',
    reasonAr: 'تم الاعتماد لتجديد المخزون بشكل مضبوط',
    evidence: 'Supplier quotation and serialized packing list verified.',
  };
  const vendor = await procure({
    action: 'create_vendor',
    vendorCode: `V-${tenantId.slice(0, 8)}`,
    nameEn: 'Acceptance supplier',
    nameAr: 'مورد اختبار القبول',
    ...procurementEvidence,
  });
  const draft = await procure({
    action: 'create_purchase_order',
    poNumber: `PO-${tenantId.slice(0, 8)}`,
    vendorId: vendor.id,
    warehouseId,
    currency: 'USD',
    lines: [{ itemId, quantity: 2, unitCostMinor: 7500 }],
    ...procurementEvidence,
  });
  assert.equal(draft.status, 'draft');
  const approvalCommand: ProcurementCommand = {
    action: 'approve_purchase_order',
    purchaseOrderId: draft.id,
    expectedVersion: 1,
    ...procurementEvidence,
  };
  await assert.rejects(procure(approvalCommand, randomUUID(), { branchIds: [randomUUID()] }));
  const approved = await procure({
    ...approvalCommand,
  });
  assert.equal(approved.status, 'approved');
  const [line] = await admin.unsafe(
    'SELECT id FROM operations_purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2',
    [tenantId, draft.id],
  );
  const receiptCommand: ProcurementCommand = {
    action: 'receive_purchase_order',
    purchaseOrderId: draft.id,
    expectedVersion: 2,
    assets: [
      { lineId: line.id, serialNumber: `RX-${randomUUID()}` },
      { lineId: line.id, serialNumber: `RX-${randomUUID()}` },
    ],
    ...procurementEvidence,
  };
  const receiptKey = randomUUID();
  const received = await procure(receiptCommand, receiptKey);
  assert.equal(received.status, 'received');
  assert.deepEqual(await procure(receiptCommand, receiptKey), received);
  await assert.rejects(
    procure(
      { ...receiptCommand, evidence: 'A conflicting receipt retry is rejected.' },
      receiptKey,
    ),
  );
  const [journalEvidence] = await admin.unsafe(
    `SELECT count(DISTINCT j.id)::int AS journals,coalesce(sum(l.debit_minor),0)::int AS debits,
      coalesce(sum(l.credit_minor),0)::int AS credits
     FROM operations_journal_entries j JOIN operations_journal_lines l ON l.journal_entry_id=j.id
     WHERE j.tenant_id=$1 AND j.source_type='inventory_receipt' AND j.source_id=$2`,
    [tenantId, draft.id],
  );
  assert.equal(journalEvidence.journals, 1);
  assert.equal(journalEvidence.debits, 15000);
  assert.equal(journalEvidence.credits, 15000);
  const withProcurement = await read();
  assert(withProcurement.vendors.some((candidate) => candidate.id === vendor.id));
  assert(
    withProcurement.purchaseOrders.some(
      (candidate) => candidate.id === draft.id && candidate.status === 'received',
    ),
  );

  // --- Catalog, warehouse and bin administration -------------------------------------
  const administer = (
    command: WarehouseAdminCommand,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    executeWarehouseAdminCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        'tenant.warehouse.administration.manage',
        'tenant.catalog.manage',
        key,
        overrides,
      ),
    });
  const adminEvidence = {
    reasonEn: 'Catalog and warehouse structure approved for the branch rollout',
    reasonAr: 'تمت الموافقة على هيكل الفهرس والمستودع لإطلاق الفرع',
    evidence: 'Change request CR-2026-114 signed by operations and finance.',
  };

  // Administration requires its own signed action; a procurement signature must not work.
  await assert.rejects(
    executeWarehouseAdminCommand(runtime.db, tenantId, {
      command: {
        action: 'create_item',
        sku: `WRONG-${tenantId.slice(0, 8)}`,
        nameEn: 'Rejected item',
        nameAr: 'صنف مرفوض',
        category: 'accessory',
        unitCostMinorUsd: 100,
        unitCostMinorLbp: 0,
        serializedFlag: false,
        reorderThreshold: 1,
        ...adminEvidence,
      },
      authorization: sign('tenant.warehouse.procurement.manage', 'tenant.catalog.manage'),
    }),
  );

  const createdItem: WarehouseAdminCommand = {
    action: 'create_item',
    sku: `ONT-${tenantId.slice(0, 8)}`,
    nameEn: 'GPON ONT acceptance unit',
    nameAr: 'وحدة ألياف لاختبار القبول',
    category: 'ont_onu',
    unitCostMinorUsd: 4200,
    unitCostMinorLbp: 0,
    serializedFlag: true,
    reorderThreshold: 25,
    ...adminEvidence,
  };
  const itemKey = randomUUID();
  const newItem = await administer(createdItem, itemKey);
  assert.equal(newItem.version, 1);
  // Exact replay returns the original result; a changed payload under the same key conflicts.
  assert.deepEqual(await administer(createdItem, itemKey), newItem);
  await assert.rejects(
    administer({ ...createdItem, evidence: 'A conflicting administration retry.' }, itemKey),
  );
  // A duplicate SKU is refused rather than silently creating a second catalog entry.
  await assert.rejects(administer({ ...createdItem, nameEn: 'Duplicate SKU attempt' }));

  const updatedItem = await administer({
    action: 'update_item',
    itemId: newItem.id,
    expectedVersion: 1,
    nameEn: 'GPON ONT acceptance unit v2',
    nameAr: 'وحدة ألياف لاختبار القبول ٢',
    category: 'ont_onu',
    unitCostMinorUsd: 4400,
    unitCostMinorLbp: 0,
    serializedFlag: true,
    reorderThreshold: 30,
    active: true,
    ...adminEvidence,
  });
  assert.equal(updatedItem.version, 2);
  // A stale expectedVersion is a conflict, not a last-writer-wins overwrite.
  await assert.rejects(
    administer({
      action: 'update_item',
      itemId: newItem.id,
      expectedVersion: 1,
      nameEn: 'Stale write',
      nameAr: 'كتابة قديمة',
      category: 'ont_onu',
      unitCostMinorUsd: 4400,
      unitCostMinorLbp: 0,
      serializedFlag: true,
      reorderThreshold: 30,
      active: true,
      ...adminEvidence,
    }),
  );
  // The item received in this run already carries stock, so serialization is now history.
  await assert.rejects(
    administer({
      action: 'update_item',
      itemId,
      expectedVersion: 1,
      nameEn: 'Serialization flip attempt',
      nameAr: 'محاولة تغيير التسلسل',
      category: 'router_cpe',
      unitCostMinorUsd: 100,
      unitCostMinorLbp: 0,
      serializedFlag: false,
      reorderThreshold: 5,
      active: true,
      ...adminEvidence,
    }),
  );

  const newWarehouse = await administer({
    action: 'create_warehouse',
    warehouseCode: `WH-${tenantId.slice(0, 8)}`,
    nameEn: 'Northern acceptance depot',
    nameAr: 'مستودع الشمال لاختبار القبول',
    locationAddress: 'Tripoli, Lebanon',
    branchId,
    isPrimary: false,
    ...adminEvidence,
  });
  assert.equal(newWarehouse.version, 1);
  // A branch outside the signed scope cannot receive a warehouse.
  await assert.rejects(
    administer({
      action: 'create_warehouse',
      warehouseCode: `WH2-${tenantId.slice(0, 8)}`,
      nameEn: 'Out of scope depot',
      nameAr: 'مستودع خارج النطاق',
      locationAddress: 'Beirut, Lebanon',
      branchId: randomUUID(),
      isPrimary: false,
      ...adminEvidence,
    }),
  );
  // The primary designation is tenant-wide, so a branch-scoped signature must refuse it.
  await assert.rejects(
    administer({
      action: 'create_warehouse',
      warehouseCode: `WH3-${tenantId.slice(0, 8)}`,
      nameEn: 'Scoped primary attempt',
      nameAr: 'محاولة تعيين مستودع رئيسي',
      locationAddress: 'Beirut, Lebanon',
      branchId,
      isPrimary: true,
      ...adminEvidence,
    }),
  );

  const newBin = await administer({
    action: 'create_bin',
    warehouseId: newWarehouse.id,
    binCode: 'A-01',
    nameEn: 'Aisle A shelf 1',
    nameAr: 'الممر أ الرف ١',
    binKind: 'stock',
    ...adminEvidence,
  });
  assert.equal(newBin.version, 1);
  await assert.rejects(
    administer({
      action: 'create_bin',
      warehouseId: newWarehouse.id,
      binCode: 'a-01',
      nameEn: 'Duplicate bin code',
      nameAr: 'رمز رف مكرر',
      binKind: 'stock',
      ...adminEvidence,
    }),
  );
  const quarantined = await administer({
    action: 'update_bin',
    binId: newBin.id,
    expectedVersion: 1,
    nameEn: 'Aisle A quarantine',
    nameAr: 'الممر أ الحجر',
    binKind: 'quarantine',
    active: true,
    ...adminEvidence,
  });
  assert.equal(quarantined.version, 2);

  // The original warehouse still holds RMA/returned custody, so closing it is refused.
  const [originalWarehouseVersion] = await admin.unsafe(
    'SELECT version FROM operations_warehouses WHERE tenant_id=$1 AND id=$2',
    [tenantId, warehouseId],
  );
  await assert.rejects(
    administer({
      action: 'update_warehouse',
      warehouseId,
      expectedVersion: originalWarehouseVersion.version as number,
      nameEn: 'Closing attempt',
      nameAr: 'محاولة إغلاق',
      locationAddress: 'Beirut, Lebanon',
      branchId,
      isPrimary: false,
      active: false,
      ...adminEvidence,
    }),
  );

  // Administration history is append-only.
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.warehouse.administration.manage', 'tenant.catalog.manage'),
      (transaction) =>
        transaction.execute(
          sql`UPDATE operations_warehouse_admin_events SET evidence='tampered' WHERE tenant_id=${tenantId}::uuid`,
        ),
    ),
  );

  const administered = await read();
  assert(
    administered.items.some(
      (candidate) => candidate.id === newItem.id && candidate.version === 2 && candidate.active,
    ),
  );
  assert(administered.warehouses.some((candidate) => candidate.id === newWarehouse.id));
  assert(
    administered.bins.some(
      (candidate) => candidate.id === newBin.id && candidate.binKind === 'quarantine',
    ),
  );
  assert(administered.branches.some((candidate) => candidate.id === branchId));
  assert(administered.administrationEvents.length >= 5);
  const [adminAudit] = await admin.unsafe(
    `SELECT count(*)::int AS count FROM operations_audit_outbox
      WHERE tenant_id=$1 AND action='tenant.warehouse.administration.manage'`,
    [tenantId],
  );
  assert.equal(adminAudit.count, administered.administrationEvents.length);

  // --- Non-serialized stock: partial receiving, transfers, adjustments -----------------
  const stockMove = (
    command: StockCommand,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    executeStockCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        command.action === 'adjust_stock'
          ? 'tenant.warehouse.stock.adjust'
          : 'tenant.warehouse.stock.transfer',
        command.action === 'adjust_stock' ? 'tenant.accounting.post' : 'tenant.installation.manage',
        key,
        overrides,
      ),
    });
  const stockEvidence = {
    reasonEn: 'Bulk cable stock movement for the branch rollout',
    reasonAr: 'حركة مخزون الكابلات لإطلاق الفرع',
    evidence: 'Stock movement note SM-2026-311 approved by operations.',
  };

  // A bin in the receiving warehouse itself; newBin belongs to the other depot.
  const receivingBin = await administer({
    action: 'create_bin',
    warehouseId,
    binCode: 'R-01',
    nameEn: 'Receiving bay 1',
    nameAr: 'ساحة الاستلام ١',
    binKind: 'staging',
    ...adminEvidence,
  });

  const bulkItem = await administer({
    action: 'create_item',
    sku: `DROP-${tenantId.slice(0, 8)}`,
    nameEn: 'Drop wire 100m reel',
    nameAr: 'بكرة سلك توصيل 100 متر',
    category: 'drop_wire',
    unitCostMinorUsd: 1500,
    unitCostMinorLbp: 0,
    serializedFlag: false,
    reorderThreshold: 10,
    ...adminEvidence,
  });

  // A purchase order may now mix serialized and bulk lines.
  const mixedOrder = await procure({
    action: 'create_purchase_order',
    poNumber: `PO2-${tenantId.slice(0, 8)}`,
    vendorId: vendor.id,
    warehouseId,
    currency: 'USD',
    lines: [
      { itemId: newItem.id, quantity: 2, unitCostMinor: 4400 },
      { itemId: bulkItem.id, quantity: 10, unitCostMinor: 1500 },
    ],
    ...procurementEvidence,
  });
  await procure({
    action: 'approve_purchase_order',
    purchaseOrderId: mixedOrder.id,
    expectedVersion: 1,
    ...procurementEvidence,
  });
  const orderLines = await admin.unsafe(
    `SELECT l.id,i.serialized_flag FROM operations_purchase_order_lines l
      JOIN operations_inventory_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
      WHERE l.tenant_id=$1 AND l.purchase_order_id=$2 ORDER BY l.line_number`,
    [tenantId, mixedOrder.id],
  );
  const serializedLine = orderLines.find((l) => l.serialized_flag)!;
  const bulkLine = orderLines.find((l) => !l.serialized_flag)!;

  // A bulk line cannot be received by serial number, and vice versa.
  await assert.rejects(
    procure({
      action: 'receive_purchase_order',
      purchaseOrderId: mixedOrder.id,
      expectedVersion: 2,
      assets: [{ lineId: bulkLine.id as string, serialNumber: `WRONG-${randomUUID()}` }],
      ...procurementEvidence,
    }),
  );
  // Over-receiving beyond the outstanding quantity is refused.
  await assert.rejects(
    procure({
      action: 'receive_purchase_order',
      purchaseOrderId: mixedOrder.id,
      expectedVersion: 2,
      quantities: [{ lineId: bulkLine.id as string, quantity: 11 }],
      ...procurementEvidence,
    }),
  );

  const firstReceiptKey = randomUUID();
  const firstReceipt = await procure(
    {
      action: 'receive_purchase_order',
      purchaseOrderId: mixedOrder.id,
      expectedVersion: 2,
      binId: receivingBin.id,
      quantities: [{ lineId: bulkLine.id as string, quantity: 4 }],
      ...procurementEvidence,
    },
    firstReceiptKey,
  );
  assert.equal(firstReceipt.status, 'partially_received');
  // Only the value actually received is posted, never the whole order.
  assert.equal(
    (firstReceipt as unknown as { receivedValueMinor: number }).receivedValueMinor,
    6000,
  );
  assert.deepEqual(
    await procure(
      {
        action: 'receive_purchase_order',
        purchaseOrderId: mixedOrder.id,
        expectedVersion: 2,
        binId: receivingBin.id,
        quantities: [{ lineId: bulkLine.id as string, quantity: 4 }],
        ...procurementEvidence,
      },
      firstReceiptKey,
    ),
    firstReceipt,
  );

  const secondReceipt = await procure({
    action: 'receive_purchase_order',
    purchaseOrderId: mixedOrder.id,
    expectedVersion: 3,
    binId: receivingBin.id,
    assets: [
      { lineId: serializedLine.id as string, serialNumber: `MX-${randomUUID()}` },
      { lineId: serializedLine.id as string, serialNumber: `MX-${randomUUID()}` },
    ],
    quantities: [{ lineId: bulkLine.id as string, quantity: 6 }],
    ...procurementEvidence,
  });
  assert.equal(secondReceipt.status, 'received');
  assert.equal(
    (secondReceipt as unknown as { receivedValueMinor: number }).receivedValueMinor,
    17800,
  );

  const [payable] = await admin.unsafe(
    `SELECT coalesce(sum(l.debit_minor),0)::int AS debits,coalesce(sum(l.credit_minor),0)::int AS credits,
       count(DISTINCT j.id)::int AS journals
     FROM operations_journal_entries j JOIN operations_journal_lines l ON l.journal_entry_id=j.id
     WHERE j.tenant_id=$1 AND j.source_type='inventory_receipt' AND j.source_id=$2`,
    [tenantId, mixedOrder.id],
  );
  // Two instalments, two journals, and the two posts sum to the full order value.
  assert.equal(payable.journals, 2);
  assert.equal(payable.debits, 23800);
  assert.equal(payable.credits, 23800);

  // Transfers relocate quantity without changing value, so they post no journal.
  const transferKey = randomUUID();
  const transferCommand: StockCommand = {
    action: 'transfer_stock',
    itemId: bulkItem.id,
    quantity: 4,
    fromWarehouseId: warehouseId,
    fromBinId: receivingBin.id,
    toWarehouseId: newWarehouse.id,
    ...stockEvidence,
  };
  const transferred = await stockMove(transferCommand, transferKey);
  assert.equal((transferred as { fromQuantityOnHand: number }).fromQuantityOnHand, 6);
  assert.equal((transferred as { toQuantityOnHand: number }).toQuantityOnHand, 4);
  assert.deepEqual(await stockMove(transferCommand, transferKey), transferred);
  await assert.rejects(
    stockMove({ ...transferCommand, evidence: 'A conflicting transfer retry.' }, transferKey),
  );
  // Moving more than the location holds is refused.
  await assert.rejects(stockMove({ ...transferCommand, quantity: 999 }));
  // A serialized item never moves through the bulk plane.
  await assert.rejects(stockMove({ ...transferCommand, itemId: newItem.id, quantity: 1 }));
  // Transfers need the operations action, not the finance one.
  await assert.rejects(
    executeStockCommand(runtime.db, tenantId, {
      command: { ...transferCommand, quantity: 1 },
      authorization: sign('tenant.warehouse.stock.adjust', 'tenant.accounting.post'),
    }),
  );

  const shrinkage = await stockMove({
    action: 'adjust_stock',
    itemId: bulkItem.id,
    quantity: 2,
    warehouseId: newWarehouse.id,
    direction: 'decrease',
    currency: 'USD',
    ...stockEvidence,
  });
  assert.equal((shrinkage as { quantityOnHand: number }).quantityOnHand, 2);
  const [variance] = await admin.unsafe(
    `SELECT coalesce(sum(l.debit_minor),0)::int AS debits,coalesce(sum(l.credit_minor),0)::int AS credits
     FROM operations_journal_entries j JOIN operations_journal_lines l ON l.journal_entry_id=j.id
     WHERE j.tenant_id=$1 AND j.source_type='inventory_adjustment'`,
    [tenantId],
  );
  // 2 units at the item's 1500 standard cost, posted to variance against inventory.
  assert.equal(variance.debits, 3000);
  assert.equal(variance.credits, 3000);

  // Stock movements are append-only.
  await assert.rejects(
    inOperationsTransaction(
      runtime.db,
      tenantId,
      sign('tenant.warehouse.stock.transfer', 'tenant.installation.manage'),
      (transaction) =>
        transaction.execute(
          sql`UPDATE operations_stock_movements SET evidence='tampered' WHERE tenant_id=${tenantId}::uuid`,
        ),
    ),
  );

  const withStock = await read();
  const binBalance = withStock.stockBalances.find(
    (b) => b.itemId === bulkItem.id && b.binId === receivingBin.id,
  );
  assert.equal(binBalance?.quantityOnHand, 6);
  assert(
    withStock.stockBalances.some(
      (b) =>
        b.itemId === bulkItem.id && b.warehouseId === newWarehouse.id && b.quantityOnHand === 2,
    ),
  );
  assert(withStock.stockMovements.some((m) => m.kind === 'transfer_out'));
  assert(withStock.stockMovements.some((m) => m.kind === 'transfer_in'));
  assert(withStock.stockMovements.some((m) => m.kind === 'adjustment_decrease'));
  assert(withStock.purchaseOrders.some((p) => p.id === mixedOrder.id && p.status === 'received'));

  // --- Reservations and material consumption ------------------------------------------
  const reserve = (
    command: StockReservationCommand,
    key = randomUUID(),
    overrides: Record<string, unknown> = {},
  ) =>
    executeStockReservationCommand(runtime.db, tenantId, {
      command,
      authorization: sign(
        'tenant.warehouse.stock.reserve',
        'tenant.installation.manage',
        key,
        overrides,
      ),
    });
  const reservationEvidence = {
    reasonEn: 'Material held for the scheduled customer installation',
    reasonAr: 'مواد محجوزة للتركيب المجدول للعميل',
    evidence: 'Job pack JP-2026-778 issued to the field team.',
  };

  // 6 units remain in the receiving bin after the earlier transfer.
  const holdCommand: StockReservationCommand = {
    action: 'reserve_stock',
    itemId: bulkItem.id,
    quantity: 4,
    warehouseId,
    binId: receivingBin.id,
    installationId,
    reference: 'JP-2026-778',
    ...reservationEvidence,
  };
  const holdKey = randomUUID();
  const held = await reserve(holdCommand, holdKey);
  assert.equal((held as { status: string }).status, 'held');
  assert.equal((held as { quantityReserved: number }).quantityReserved, 4);
  assert.equal((held as { quantityOnHand: number }).quantityOnHand, 6);
  assert.deepEqual(await reserve(holdCommand, holdKey), held);
  await assert.rejects(
    reserve({ ...holdCommand, evidence: 'A conflicting reservation retry.' }, holdKey),
  );

  // Reserved stock cannot be transferred away from under the job holding it.
  await assert.rejects(
    stockMove({
      action: 'transfer_stock',
      itemId: bulkItem.id,
      quantity: 4,
      fromWarehouseId: warehouseId,
      fromBinId: receivingBin.id,
      toWarehouseId: newWarehouse.id,
      ...stockEvidence,
    }),
  );
  // Only 2 of the 6 are free, so a second hold of 4 must fail.
  await assert.rejects(reserve({ ...holdCommand, reference: 'JP-2026-779' }));
  // A serialized item is held through custody, never a bulk reservation.
  await assert.rejects(reserve({ ...holdCommand, itemId: newItem.id, reference: 'JP-2026-780' }));
  // Reservations need their own signed action.
  await assert.rejects(
    executeStockReservationCommand(runtime.db, tenantId, {
      command: { ...holdCommand, reference: 'JP-2026-781' },
      authorization: sign('tenant.warehouse.stock.transfer', 'tenant.installation.manage'),
    }),
  );

  const releasedHold = await reserve({
    action: 'reserve_stock',
    itemId: bulkItem.id,
    quantity: 2,
    warehouseId,
    binId: receivingBin.id,
    reference: 'JP-2026-782',
    ...reservationEvidence,
  });
  const releasedId = (releasedHold as { reservationId: string }).reservationId;
  const released = await reserve({
    action: 'release_reservation',
    reservationId: releasedId,
    expectedVersion: 1,
    ...reservationEvidence,
  });
  // A release returns quantity to free stock and touches no value.
  assert.equal((released as { status: string }).status, 'released');
  assert.equal((released as { quantityReserved: number }).quantityReserved, 4);
  assert.equal((released as { quantityOnHand: number }).quantityOnHand, 6);
  await assert.rejects(
    reserve({
      action: 'release_reservation',
      reservationId: releasedId,
      expectedVersion: 2,
      ...reservationEvidence,
    }),
  );

  const heldId = (held as { reservationId: string }).reservationId;
  await assert.rejects(
    reserve({
      action: 'consume_reservation',
      reservationId: heldId,
      expectedVersion: 1,
      quantity: 5,
      ...reservationEvidence,
    }),
  );
  const consumed = await reserve({
    action: 'consume_reservation',
    reservationId: heldId,
    expectedVersion: 1,
    quantity: 3,
    ...reservationEvidence,
  });
  assert.equal((consumed as { status: string }).status, 'consumed');
  assert.equal((consumed as { quantity: number }).quantity, 3);
  // The hold is fully released and only the used quantity leaves stock, so the unused
  // fourth unit returns to free stock rather than staying reserved.
  assert.equal((consumed as { quantityReserved: number }).quantityReserved, 0);
  assert.equal((consumed as { quantityOnHand: number }).quantityOnHand, 3);

  const [consumption] = await admin.unsafe(
    `SELECT coalesce(sum(l.debit_minor),0)::int AS debits,coalesce(sum(l.credit_minor),0)::int AS credits,
       count(DISTINCT j.id)::int AS journals
     FROM operations_journal_entries j JOIN operations_journal_lines l ON l.journal_entry_id=j.id
     WHERE j.tenant_id=$1 AND j.source_type='inventory_consumption'`,
    [tenantId],
  );
  // 3 units at the 1500 standard cost, expensed out of inventory.
  assert.equal(consumption.journals, 1);
  assert.equal(consumption.debits, 4500);
  assert.equal(consumption.credits, 4500);
  const [expenseSide] = await admin.unsafe(
    `SELECT a.account_code FROM operations_journal_entries j
       JOIN operations_journal_lines l ON l.journal_entry_id=j.id
       JOIN operations_chart_of_accounts a ON a.id=l.account_id
      WHERE j.tenant_id=$1 AND j.source_type='inventory_consumption' AND l.debit_minor>0`,
    [tenantId],
  );
  assert.equal(expenseSide.account_code, '5000');

  const withReservations = await read();
  assert(
    withReservations.stockReservations.some(
      (r) => r.id === heldId && r.status === 'consumed' && r.serviceNumber === 'INV-SVC',
    ),
  );
  assert(
    withReservations.stockReservations.some((r) => r.id === releasedId && r.status === 'released'),
  );
  assert(withReservations.stockMovements.some((m) => m.kind === 'consumption'));
  assert(withReservations.stockMovements.some((m) => m.kind === 'reservation_hold'));
  assert(withReservations.stockMovements.some((m) => m.kind === 'reservation_release'));

  console.log(
    'Inventory live proof passed: custody, procurement, serialized receipt, scoped administration, partial mixed receiving, bulk transfers, valued adjustments, reservations and expensed consumption.',
  );
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
