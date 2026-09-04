import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type {
  InventoryCustodyCommand,
  Permission,
  ProcurementCommand,
  VerifiedTenantId,
} from '@isp/contracts';
import {
  createDatabase,
  inOperationsTransaction,
  readWarehouseWorkspace,
  signOperationsAttestation,
  transitionInventoryCustody,
  executeProcurementCommand,
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
  console.log(
    'Inventory live proof passed: governed custody plus vendor, approval, serialized receipt, exact replay/conflict, and balanced inventory/AP posting.',
  );
} finally {
  await admin
    .unsafe('UPDATE operations_context_keys SET revoked_at=clock_timestamp() WHERE key_id=$1', [
      keyId,
    ])
    .catch(() => {});
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
