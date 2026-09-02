import {
  type WarehouseRecord,
  type InventoryItemRecord,
  type SerializedAssetRecord,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readWarehouses(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly WarehouseRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      warehouse_code: string;
      name_en: string;
      name_ar: string;
      location_address: string;
      is_primary: boolean;
      active: boolean;
    }>(sql`
      SELECT id, warehouse_code, name_en, name_ar, location_address, is_primary, active
      FROM operations_warehouses
      WHERE tenant_id = ${tenantId}
      ORDER BY warehouse_code ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      warehouseCode: r.warehouse_code,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      locationAddress: r.location_address,
      isPrimary: r.is_primary,
      active: r.active,
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
    }>(sql`
      SELECT id, sku, name_en, name_ar, category, unit_cost_minor_usd::text, unit_cost_minor_lbp::text, serialized_flag, reorder_threshold
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
    }>(sql`
      SELECT id, item_id, serial_number, mac_address, warehouse_id, current_custodian_id, installed_service_id, status
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
    }));
  });
}
