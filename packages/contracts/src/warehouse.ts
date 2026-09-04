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

export const procurementVendorSchema = z.object({
  id: z.string().uuid(),
  vendorCode: z.string().trim().min(2).max(50),
  nameEn: z.string().trim().min(2).max(180),
  nameAr: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(180).nullable(),
  contactPhone: z.string().trim().max(50).nullable(),
  active: z.boolean(),
});
export type ProcurementVendor = z.infer<typeof procurementVendorSchema>;

const procurementEvidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
} as const;

export const procurementCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create_vendor'),
      vendorCode: z.string().trim().min(2).max(50),
      nameEn: z.string().trim().min(2).max(180),
      nameAr: z.string().trim().min(2).max(180),
      contactName: z.string().trim().min(2).max(180).optional(),
      contactPhone: z.string().trim().min(3).max(50).optional(),
      ...procurementEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('create_purchase_order'),
      poNumber: z.string().trim().min(2).max(80),
      vendorId: z.string().uuid(),
      warehouseId: z.string().uuid(),
      currency: z.enum(['USD', 'LBP']),
      lines: z
        .array(
          z
            .object({
              itemId: z.string().uuid(),
              quantity: z.number().int().positive().max(10000),
              unitCostMinor: z.number().int().positive().safe(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
      ...procurementEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('approve_purchase_order'),
      purchaseOrderId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...procurementEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('receive_purchase_order'),
      purchaseOrderId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      assets: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              serialNumber: z.string().trim().min(2).max(100),
              macAddress: z.string().trim().min(2).max(50).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      ...procurementEvidence,
    })
    .strict(),
]);
export type ProcurementCommand = z.infer<typeof procurementCommandSchema>;

export interface ProcurementPurchaseOrder {
  readonly id: string;
  readonly poNumber: string;
  readonly vendorId: string;
  readonly vendorNameEn: string;
  readonly vendorNameAr: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly status: 'draft' | 'approved' | 'received' | 'cancelled';
  readonly currency: 'USD' | 'LBP';
  readonly totalAmountMinor: number;
  readonly version: number;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly receivedAt: string | null;
  readonly lines: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly sku: string;
    readonly itemNameEn: string;
    readonly itemNameAr: string;
    readonly quantity: number;
    readonly receivedQuantity: number;
    readonly unitCostMinor: number;
  }[];
}

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
  readonly vendors: readonly ProcurementVendor[];
  readonly purchaseOrders: readonly ProcurementPurchaseOrder[];
}
