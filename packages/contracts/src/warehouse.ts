import { z } from 'zod';

export const warehouseRecordSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
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
  version: z.number().int().positive(),
});
export type SerializedAssetRecord = z.infer<typeof serializedAssetRecordSchema>;

export const inventoryCustodyActionSchema = z.enum(['issue', 'install', 'return', 'rma']);

export const inventoryCustodyCommandSchema = z
  .object({
    assetId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    action: inventoryCustodyActionSchema,
    installationId: z.string().uuid().optional(),
    custodianUserId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    reasonEn: z.string().trim().min(8).max(1000),
    reasonAr: z.string().trim().min(8).max(1000),
    evidence: z.string().trim().min(8).max(2000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'issue' && (!value.installationId || !value.custodianUserId)) {
      context.addIssue({
        code: 'custom',
        message: 'Issuing equipment requires an installation and custodian.',
      });
    }
    if (value.action === 'return' && !value.warehouseId) {
      context.addIssue({ code: 'custom', message: 'Returning equipment requires a warehouse.' });
    }
  });
export type InventoryCustodyCommand = z.infer<typeof inventoryCustodyCommandSchema>;

export interface InventoryCustodyEvent {
  readonly id: string;
  readonly assetId: string;
  readonly version: number;
  readonly action: z.infer<typeof inventoryCustodyActionSchema>;
  readonly fromStatus: SerializedAssetRecord['status'];
  readonly toStatus: SerializedAssetRecord['status'];
  readonly custodianUserId: string | null;
  readonly installationId: string | null;
  readonly warehouseId: string | null;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly evidence: string;
  readonly occurredAt: string;
}

export interface WarehouseWorkspace {
  readonly warehouses: readonly WarehouseRecord[];
  readonly items: readonly InventoryItemRecord[];
  readonly assets: readonly (SerializedAssetRecord & {
    readonly sku: string;
    readonly itemNameEn: string;
    readonly itemNameAr: string;
    readonly warehouseCode: string | null;
    readonly custodianName: string | null;
    readonly serviceNumber: string | null;
    readonly installationId: string | null;
    readonly events: readonly InventoryCustodyEvent[];
  })[];
  readonly installations: readonly {
    readonly id: string;
    readonly serviceId: string;
    readonly serviceNumber: string;
    readonly subscriberName: string;
    readonly installerUserId: string | null;
    readonly installerName: string | null;
  }[];
}
