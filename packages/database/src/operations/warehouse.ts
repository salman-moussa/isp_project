import {
  type WarehouseRecord,
  type InventoryItemRecord,
  type SerializedAssetRecord,
  type InventoryCustodyCommand,
  type ProcurementCommand,
  type WarehouseAdminCommand,
  type StockCommand,
  type StockReservationCommand,
  type StockCountCommand,
  type WarehouseWorkspace,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readWarehouses(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly WarehouseRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      branch_id: string | null;
      warehouse_code: string;
      name_en: string;
      name_ar: string;
      location_address: string;
      is_primary: boolean;
      active: boolean;
      version: number;
    }>(sql`
      SELECT id, branch_id, warehouse_code, name_en, name_ar, location_address, is_primary, active, version
      FROM operations_warehouses
      WHERE tenant_id = ${tenantId}
      ORDER BY warehouse_code ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      warehouseCode: r.warehouse_code,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      locationAddress: r.location_address,
      isPrimary: r.is_primary,
      active: r.active,
      version: r.version,
    }));
  });
}

export async function readInventoryItems(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly InventoryItemRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      sku: string;
      name_en: string;
      name_ar: string;
      category: InventoryItemRecord['category'];
      unit_cost_minor_usd: string;
      unit_cost_minor_lbp: string;
      serialized_flag: boolean;
      reorder_threshold: number;
      active: boolean;
      version: number;
    }>(sql`
      SELECT id, sku, name_en, name_ar, category, unit_cost_minor_usd::text, unit_cost_minor_lbp::text, serialized_flag, reorder_threshold, active, version
      FROM operations_inventory_items
      WHERE tenant_id = ${tenantId}
      ORDER BY sku ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      category: r.category,
      unitCostMinorUsd: parseInt(r.unit_cost_minor_usd, 10),
      unitCostMinorLbp: parseInt(r.unit_cost_minor_lbp, 10),
      serializedFlag: r.serialized_flag,
      reorderThreshold: r.reorder_threshold,
      active: r.active,
      version: r.version,
    }));
  });
}

export async function readSerializedAssets(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly SerializedAssetRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      item_id: string;
      serial_number: string;
      mac_address: string | null;
      warehouse_id: string | null;
      current_custodian_id: string | null;
      installed_service_id: string | null;
      status: SerializedAssetRecord['status'];
      version: number;
    }>(sql`
      SELECT id, item_id, serial_number, mac_address, warehouse_id, current_custodian_id, installed_service_id, status, version
      FROM operations_serialized_assets
      WHERE tenant_id = ${tenantId}
      ORDER BY serial_number ASC
      LIMIT 200
    `);

    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      serialNumber: r.serial_number,
      macAddress: r.mac_address,
      warehouseId: r.warehouse_id,
      currentCustodianId: r.current_custodian_id,
      installedServiceId: r.installed_service_id,
      status: r.status,
      version: r.version,
    }));
  });
}

export async function readWarehouseWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<WarehouseWorkspace> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const [authority] = await transaction.execute<{ valid: boolean }>(sql`
      SELECT true AS valid FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND permission='tenant.installation.view'
        AND action='tenant.warehouse.workspace.read' AND support_grant_id IS NULL
    `);
    if (!authority) throw new OperationsAuthorizationError('Warehouse view authority required.');

    const warehouses = await transaction.execute<{
      id: string;
      branchId: string | null;
      warehouseCode: string;
      nameEn: string;
      nameAr: string;
      locationAddress: string;
      isPrimary: boolean;
      active: boolean;
      version: number;
    }>(sql`SELECT id,branch_id AS "branchId",warehouse_code AS "warehouseCode",
      name_en AS "nameEn",name_ar AS "nameAr",location_address AS "locationAddress",
      is_primary AS "isPrimary",active,version
      FROM operations_warehouses WHERE tenant_id=${tenantId} ORDER BY is_primary DESC,warehouse_code,id`);
    const items = await transaction.execute<InventoryItemRecord>(sql`SELECT id,sku,
      name_en AS "nameEn",name_ar AS "nameAr",category,
      unit_cost_minor_usd::float8 AS "unitCostMinorUsd",unit_cost_minor_lbp::float8 AS "unitCostMinorLbp",
      serialized_flag AS "serializedFlag",reorder_threshold AS "reorderThreshold",active,version
      FROM operations_inventory_items WHERE tenant_id=${tenantId} ORDER BY sku,id`);
    const assets = await transaction.execute<WarehouseWorkspace['assets'][number]>(sql`
      SELECT a.id,a.item_id AS "itemId",a.serial_number AS "serialNumber",a.mac_address AS "macAddress",
        a.warehouse_id AS "warehouseId",a.current_custodian_id AS "currentCustodianId",
        a.installed_service_id AS "installedServiceId",a.status,a.version,i.sku,
        i.name_en AS "itemNameEn",i.name_ar AS "itemNameAr",w.warehouse_code AS "warehouseCode",
        u.display_name AS "custodianName",s.service_number AS "serviceNumber",
        a.current_installation_id AS "installationId",
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id',e.id,'assetId',e.asset_id,'version',e.version,'action',e.action,
          'fromStatus',e.from_status,'toStatus',e.to_status,'custodianUserId',e.custodian_user_id,
          'installationId',e.installation_id,'warehouseId',e.warehouse_id,'reasonEn',e.reason_en,
          'reasonAr',e.reason_ar,'evidence',e.evidence,'occurredAt',e.occurred_at
        ) ORDER BY e.version) FROM operations_inventory_custody_events e
          WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id),'[]'::jsonb) AS events
      FROM operations_serialized_assets a
      JOIN operations_inventory_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id
      LEFT JOIN operations_warehouses w ON w.tenant_id=a.tenant_id AND w.id=a.warehouse_id
      LEFT JOIN users u ON u.id=a.current_custodian_id
      LEFT JOIN operations_services s ON s.tenant_id=a.tenant_id AND s.id=a.installed_service_id
      WHERE a.tenant_id=${tenantId} ORDER BY a.serial_number,a.id LIMIT 500
    `);
    const installations = await transaction.execute<
      WarehouseWorkspace['installations'][number]
    >(sql`
      SELECT n.id,n.service_id AS "serviceId",s.service_number AS "serviceNumber",
        p.display_name AS "subscriberName",n.installer_user_id AS "installerUserId",
        u.display_name AS "installerName"
      FROM operations_installations n
      JOIN operations_services s ON s.tenant_id=n.tenant_id AND s.id=n.service_id
      JOIN operations_subscribers p ON p.tenant_id=s.tenant_id AND p.id=s.subscriber_id
      LEFT JOIN users u ON u.id=n.installer_user_id
      WHERE n.tenant_id=${tenantId} AND n.status IN('scheduled','in_progress','ready_for_activation')
      ORDER BY n.updated_at DESC,n.id LIMIT 250
    `);
    const vendors = await transaction.execute<WarehouseWorkspace['vendors'][number]>(sql`
      SELECT id,vendor_code AS "vendorCode",name_en AS "nameEn",name_ar AS "nameAr",
        contact_name AS "contactName",contact_phone AS "contactPhone",active
      FROM operations_procurement_vendors WHERE tenant_id=${tenantId}
      ORDER BY active DESC,vendor_code,id
    `);
    const purchaseOrders = await transaction.execute<
      WarehouseWorkspace['purchaseOrders'][number] & Record<string, unknown>
    >(sql`
      SELECT p.id,p.po_number AS "poNumber",p.vendor_id AS "vendorId",v.name_en AS "vendorNameEn",
        v.name_ar AS "vendorNameAr",p.warehouse_id AS "warehouseId",w.warehouse_code AS "warehouseCode",
        p.status,p.currency,p.total_amount_minor::float8 AS "totalAmountMinor",p.version,
        p.created_at AS "createdAt",p.approved_at AS "approvedAt",p.received_at AS "receivedAt",
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'itemId',l.item_id,'sku',i.sku,
          'itemNameEn',i.name_en,'itemNameAr',i.name_ar,'quantity',l.quantity,
          'receivedQuantity',l.received_quantity,'unitCostMinor',l.unit_cost_minor::float8)
          ORDER BY l.line_number) FROM operations_purchase_order_lines l
          JOIN operations_inventory_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
          WHERE l.tenant_id=p.tenant_id AND l.purchase_order_id=p.id),'[]'::jsonb) AS lines
      FROM operations_purchase_orders p
      JOIN operations_procurement_vendors v ON v.tenant_id=p.tenant_id AND v.id=p.vendor_id
      JOIN operations_warehouses w ON w.tenant_id=p.tenant_id AND w.id=p.warehouse_id
      WHERE p.tenant_id=${tenantId} ORDER BY p.created_at DESC,p.id LIMIT 250
    `);
    const bins = await transaction.execute<WarehouseWorkspace['bins'][number]>(sql`
      SELECT b.id,b.warehouse_id AS "warehouseId",w.warehouse_code AS "warehouseCode",
        b.bin_code AS "binCode",b.name_en AS "nameEn",b.name_ar AS "nameAr",
        b.bin_kind AS "binKind",b.active,b.version
      FROM operations_warehouse_bins b
      JOIN operations_warehouses w ON w.tenant_id=b.tenant_id AND w.id=b.warehouse_id
      WHERE b.tenant_id=${tenantId}
      ORDER BY w.warehouse_code,b.bin_code,b.id LIMIT 500
    `);
    // Only branches the signed session may actually place a warehouse in, so the
    // administration form cannot offer a branch the write would then deny.
    const branches = await transaction.execute<WarehouseWorkspace['branches'][number]>(sql`
      SELECT b.id,b.code,b.name_en AS "nameEn",b.name_ar AS "nameAr"
      FROM operations_branches b, operations_current_context() c
      WHERE b.tenant_id=${tenantId} AND b.active
        AND (c.branch_ids IS NULL OR b.id=ANY(c.branch_ids))
      ORDER BY b.code,b.id LIMIT 200
    `);
    const administrationEvents = await transaction.execute<
      WarehouseWorkspace['administrationEvents'][number] & Record<string, unknown>
    >(sql`
      SELECT e.id,e.aggregate_type AS "aggregateType",e.aggregate_id AS "aggregateId",
        e.aggregate_version AS "aggregateVersion",e.action,e.reason_en AS "reasonEn",
        e.reason_ar AS "reasonAr",e.evidence,e.occurred_at AS "occurredAt",
        u.display_name AS "actorName"
      FROM operations_warehouse_admin_events e
      LEFT JOIN users u ON u.id=e.actor_id
      WHERE e.tenant_id=${tenantId}
      ORDER BY e.occurred_at DESC,e.id LIMIT 200
    `);
    const stockBalances = await transaction.execute<
      WarehouseWorkspace['stockBalances'][number] & Record<string, unknown>
    >(sql`
      SELECT b.id,b.item_id AS "itemId",i.sku,i.name_en AS "itemNameEn",i.name_ar AS "itemNameAr",
        b.warehouse_id AS "warehouseId",w.warehouse_code AS "warehouseCode",
        b.bin_id AS "binId",n.bin_code AS "binCode",
        b.quantity_on_hand AS "quantityOnHand",b.quantity_reserved AS "quantityReserved",
        i.reorder_threshold AS "reorderThreshold",b.version
      FROM operations_stock_balances b
      JOIN operations_inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
      JOIN operations_warehouses w ON w.tenant_id=b.tenant_id AND w.id=b.warehouse_id
      LEFT JOIN operations_warehouse_bins n ON n.tenant_id=b.tenant_id AND n.id=b.bin_id
      WHERE b.tenant_id=${tenantId}
      ORDER BY i.sku,w.warehouse_code,n.bin_code NULLS FIRST,b.id LIMIT 500
    `);
    const stockMovements = await transaction.execute<
      WarehouseWorkspace['stockMovements'][number] & Record<string, unknown>
    >(sql`
      SELECT m.id,m.item_id AS "itemId",i.sku,m.kind,w.warehouse_code AS "warehouseCode",
        n.bin_code AS "binCode",m.quantity,m.unit_cost_minor::float8 AS "unitCostMinor",
        m.currency,m.journal_entry_id AS "journalEntryId",m.reason_en AS "reasonEn",
        m.reason_ar AS "reasonAr",m.evidence,m.occurred_at AS "occurredAt",
        u.display_name AS "actorName"
      FROM operations_stock_movements m
      JOIN operations_inventory_items i ON i.tenant_id=m.tenant_id AND i.id=m.item_id
      JOIN operations_warehouses w ON w.tenant_id=m.tenant_id AND w.id=m.warehouse_id
      LEFT JOIN operations_warehouse_bins n ON n.tenant_id=m.tenant_id AND n.id=m.bin_id
      LEFT JOIN users u ON u.id=m.actor_id
      WHERE m.tenant_id=${tenantId}
      ORDER BY m.occurred_at DESC,m.sequence,m.id LIMIT 200
    `);
    const stockReservations = await transaction.execute<
      WarehouseWorkspace['stockReservations'][number] & Record<string, unknown>
    >(sql`
      SELECT r.id,r.item_id AS "itemId",i.sku,i.name_en AS "itemNameEn",i.name_ar AS "itemNameAr",
        r.warehouse_id AS "warehouseId",w.warehouse_code AS "warehouseCode",
        r.bin_id AS "binId",n.bin_code AS "binCode",r.quantity,r.status,
        r.installation_id AS "installationId",s.service_number AS "serviceNumber",
        r.reference,r.version,r.created_at AS "createdAt",r.resolved_at AS "resolvedAt"
      FROM operations_stock_reservations r
      JOIN operations_inventory_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id
      JOIN operations_warehouses w ON w.tenant_id=r.tenant_id AND w.id=r.warehouse_id
      LEFT JOIN operations_warehouse_bins n ON n.tenant_id=r.tenant_id AND n.id=r.bin_id
      LEFT JOIN operations_installations f ON f.tenant_id=r.tenant_id AND f.id=r.installation_id
      LEFT JOIN operations_services s ON s.tenant_id=f.tenant_id AND s.id=f.service_id
      WHERE r.tenant_id=${tenantId}
      ORDER BY (r.status='held') DESC,r.created_at DESC,r.id LIMIT 300
    `);
    const stockCounts = await transaction.execute<
      WarehouseWorkspace['stockCounts'][number] & Record<string, unknown>
    >(sql`
      SELECT k.id,k.count_number AS "countNumber",k.warehouse_id AS "warehouseId",
        w.warehouse_code AS "warehouseCode",k.bin_id AS "binId",n.bin_code AS "binCode",
        k.currency,k.status,k.version,k.opened_at AS "openedAt",k.closed_at AS "closedAt",
        k.journal_entry_id AS "journalEntryId",
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id',l.id,'itemId',l.item_id,'sku',i.sku,'itemNameEn',i.name_en,'itemNameAr',i.name_ar,
          'systemQuantity',l.system_quantity,'countedQuantity',l.counted_quantity,
          'unitCostMinor',l.unit_cost_minor::float8,'variance',l.variance
        ) ORDER BY i.sku) FROM operations_stock_count_lines l
          JOIN operations_inventory_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
          WHERE l.tenant_id=k.tenant_id AND l.count_id=k.id),'[]'::jsonb) AS lines
      FROM operations_stock_counts k
      JOIN operations_warehouses w ON w.tenant_id=k.tenant_id AND w.id=k.warehouse_id
      LEFT JOIN operations_warehouse_bins n ON n.tenant_id=k.tenant_id AND n.id=k.bin_id
      WHERE k.tenant_id=${tenantId}
      ORDER BY (k.status='open') DESC,k.opened_at DESC,k.id LIMIT 100
    `);
    return {
      warehouses,
      items,
      assets,
      installations,
      vendors,
      purchaseOrders,
      bins,
      branches,
      administrationEvents,
      stockBalances,
      stockMovements,
      stockReservations,
      stockCounts,
    };
  });
}

export async function executeStockCountCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: StockCountCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{ result: Record<string, unknown> }>(
      sql`SELECT execute_stock_count_command(${JSON.stringify(input.command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Stock count command returned no result.');
    return row.result;
  });
}

export async function executeStockReservationCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: StockReservationCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{ result: Record<string, unknown> }>(
      sql`SELECT execute_stock_reservation_command(${JSON.stringify(input.command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Stock reservation command returned no result.');
    return row.result;
  });
}

export async function executeStockCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: StockCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<Record<string, unknown>> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{ result: Record<string, unknown> }>(
      sql`SELECT execute_stock_command(${JSON.stringify(input.command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Stock command returned no result.');
    return row.result;
  });
}

export async function executeWarehouseAdminCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: WarehouseAdminCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string; readonly version: number }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      result: { id: string; status: string; version: number };
    }>(
      sql`SELECT execute_warehouse_admin_command(${JSON.stringify(input.command)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Warehouse administration command returned no result.');
    return row.result;
  });
}

export async function executeProcurementCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: ProcurementCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string; readonly version: number }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      result: { id: string; status: string; version: number };
    }>(sql`SELECT execute_procurement_command(${JSON.stringify(input.command)}::jsonb) AS result`);
    if (!row) throw new Error('Procurement command returned no result.');
    return row.result;
  });
}

export async function transitionInventoryCustody(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: InventoryCustodyCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string; readonly version: number }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      result: { id: string; status: string; version: number };
    }>(sql`SELECT execute_inventory_custody(${JSON.stringify(input.command)}::jsonb) AS result`);
    if (!row) throw new Error('Inventory custody transition returned no result.');
    return row.result;
  });
}
