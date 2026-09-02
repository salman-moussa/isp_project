import { z } from 'zod';

export const warehouseRecordSchema = z.object({
  id: z.string().uuid(),
  warehouseCode: z.string().trim().min(2).max(50),
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  locationAddress: z.string().trim().min(2).max(300),
  isPrimary: z.boolean(),
  active: z.boolean(),
});
export type WarehouseRecord = z.infer<typeof warehouseRecordSchema>;

export const inventoryItemRecordSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().trim().min(2).max(50),
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  category: z.enum([
    'router_cpe',
    'ont_onu',
    'fiber_cable',
    'drop_wire',
    'connector',
    'accessory',
    'other',
  ]),
  unitCostMinorUsd: z.number().int().nonnegative(),
  unitCostMinorLbp: z.number().int().nonnegative(),
  serializedFlag: z.boolean(),
  reorderThreshold: z.number().int().nonnegative(),
});
export type InventoryItemRecord = z.infer<typeof inventoryItemRecordSchema>;

export const serializedAssetRecordSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  serialNumber: z.string().trim().min(2).max(100),
  macAddress: z.string().trim().max(50).nullable(),
  warehouseId: z.string().uuid().nullable(),
  currentCustodianId: z.string().uuid().nullable(),
  installedServiceId: z.string().uuid().nullable(),
  status: z.enum(['in_stock', 'reserved', 'issued', 'installed', 'returned', 'rma']),
});
export type SerializedAssetRecord = z.infer<typeof serializedAssetRecordSchema>;
