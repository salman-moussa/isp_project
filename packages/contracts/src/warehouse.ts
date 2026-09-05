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
  version: z.number().int().positive(),
});
export type WarehouseRecord = z.infer<typeof warehouseRecordSchema>;

export const inventoryItemCategorySchema = z.enum([
  'router_cpe',
  'ont_onu',
  'fiber_cable',
  'drop_wire',
  'connector',
  'accessory',
  'other',
]);
export type InventoryItemCategory = z.infer<typeof inventoryItemCategorySchema>;

export const inventoryItemRecordSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().trim().min(2).max(50),
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  category: inventoryItemCategorySchema,
  unitCostMinorUsd: z.number().int().nonnegative(),
  unitCostMinorLbp: z.number().int().nonnegative(),
  serializedFlag: z.boolean(),
  reorderThreshold: z.number().int().nonnegative(),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type InventoryItemRecord = z.infer<typeof inventoryItemRecordSchema>;

export const warehouseBinKindSchema = z.enum(['stock', 'staging', 'quarantine', 'rma', 'scrap']);
export type WarehouseBinKind = z.infer<typeof warehouseBinKindSchema>;

export const warehouseBinRecordSchema = z.object({
  id: z.string().uuid(),
  warehouseId: z.string().uuid(),
  warehouseCode: z.string().trim().min(2).max(50),
  binCode: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  binKind: warehouseBinKindSchema,
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type WarehouseBinRecord = z.infer<typeof warehouseBinRecordSchema>;

export const serializedAssetRecordSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  serialNumber: z.string().trim().min(2).max(100),
  macAddress: z.string().trim().max(50).nullable(),
  warehouseId: z.string().uuid().nullable(),
  currentCustodianId: z.string().uuid().nullable(),
  installedServiceId: z.string().uuid().nullable(),
  status: z.enum([
    'in_stock',
    'reserved',
    'issued',
    'installed',
    'returned',
    'rma',
    // Terminal: written off through an RMA case, so it is no longer held anywhere.
    'scrapped',
  ]),
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
  // A receipt may be partial and may mix serialized units with bulk quantities, because a
  // supplier part-ships. Serialized lines are received by serial number, bulk lines by count.
  z
    .object({
      action: z.literal('receive_purchase_order'),
      purchaseOrderId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      binId: z.string().uuid().optional(),
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
        .max(500)
        .optional(),
      quantities: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              quantity: z.number().int().positive().max(1_000_000),
            })
            .strict(),
        )
        .max(100)
        .optional(),
      ...procurementEvidence,
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.assets?.length ?? 0) + (value.quantities?.length ?? 0) === 0) {
        context.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'A receipt must record at least one serialized unit or one quantity.',
        });
      }
      const serials = (value.assets ?? []).map((asset) => asset.serialNumber);
      if (new Set(serials).size !== serials.length) {
        context.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'A receipt cannot repeat the same serial number.',
        });
      }
    }),
]);
export type ProcurementCommand = z.infer<typeof procurementCommandSchema>;

/**
 * Warehouse administration commands.
 *
 * Update commands carry the complete record, not a patch: the server replaces every field
 * under an `expectedVersion` check, so two operators editing the same SKU cannot silently
 * merge into a record neither of them reviewed.
 */
const warehouseAdminEvidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
} as const;

const inventoryItemAttributes = {
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  category: inventoryItemCategorySchema,
  unitCostMinorUsd: z.number().int().nonnegative().safe(),
  unitCostMinorLbp: z.number().int().nonnegative().safe(),
  serializedFlag: z.boolean(),
  reorderThreshold: z.number().int().nonnegative().max(100000),
} as const;

const warehouseAttributes = {
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  locationAddress: z.string().trim().min(2).max(300),
  branchId: z.string().uuid(),
  isPrimary: z.boolean(),
} as const;

const binAttributes = {
  nameEn: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  binKind: warehouseBinKindSchema,
} as const;

export const warehouseAdminCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create_item'),
      sku: z.string().trim().min(2).max(50),
      ...inventoryItemAttributes,
      ...warehouseAdminEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('update_item'),
      itemId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...inventoryItemAttributes,
      active: z.boolean(),
      ...warehouseAdminEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('create_warehouse'),
      warehouseCode: z.string().trim().min(2).max(50),
      ...warehouseAttributes,
      ...warehouseAdminEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('update_warehouse'),
      warehouseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...warehouseAttributes,
      active: z.boolean(),
      ...warehouseAdminEvidence,
    })
    .strict()
    .superRefine((value, context) => {
      if (!value.active && value.isPrimary) {
        context.addIssue({
          code: 'custom',
          path: ['isPrimary'],
          message: 'A closed warehouse cannot be the primary warehouse.',
        });
      }
    }),
  z
    .object({
      action: z.literal('create_bin'),
      warehouseId: z.string().uuid(),
      binCode: z.string().trim().min(1).max(40),
      ...binAttributes,
      ...warehouseAdminEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('update_bin'),
      binId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...binAttributes,
      active: z.boolean(),
      ...warehouseAdminEvidence,
    })
    .strict(),
]);
export type WarehouseAdminCommand = z.infer<typeof warehouseAdminCommandSchema>;

/**
 * Bulk (non-serialized) stock lives as a quantity per (item, warehouse, bin). Serialized units
 * keep their own per-unit custody rows and never appear here.
 */
export const stockBalanceRecordSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemNameEn: z.string(),
  itemNameAr: z.string(),
  warehouseId: z.string().uuid(),
  warehouseCode: z.string(),
  binId: z.string().uuid().nullable(),
  binCode: z.string().nullable(),
  quantityOnHand: z.number().int().nonnegative(),
  quantityReserved: z.number().int().nonnegative(),
  reorderThreshold: z.number().int().nonnegative(),
  version: z.number().int().positive(),
});
export type StockBalanceRecord = z.infer<typeof stockBalanceRecordSchema>;

const stockEvidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
} as const;

export const stockMovementKindSchema = z.enum([
  'receipt',
  'transfer_out',
  'transfer_in',
  'adjustment_increase',
  'adjustment_decrease',
  'reservation_hold',
  'reservation_release',
  'consumption',
]);
export type StockMovementKind = z.infer<typeof stockMovementKindSchema>;

export const stockReservationRecordSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  itemNameEn: z.string(),
  itemNameAr: z.string(),
  warehouseId: z.string().uuid(),
  warehouseCode: z.string(),
  binId: z.string().uuid().nullable(),
  binCode: z.string().nullable(),
  quantity: z.number().int().positive(),
  status: z.enum(['held', 'released', 'consumed']),
  installationId: z.string().uuid().nullable(),
  serviceNumber: z.string().nullable(),
  reference: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type StockReservationRecord = z.infer<typeof stockReservationRecordSchema>;

/**
 * Reservations hold bulk quantity for field work. A release returns it to free stock and posts
 * nothing; consuming it removes the used quantity and posts its value from Inventory to Network
 * Operating Expense, because that is the point at which inventory becomes cost.
 */
export const stockReservationCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('reserve_stock'),
      itemId: z.string().uuid(),
      quantity: z.number().int().positive().max(1_000_000),
      warehouseId: z.string().uuid(),
      binId: z.string().uuid().optional(),
      installationId: z.string().uuid().optional(),
      reference: z.string().trim().min(2).max(200),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('release_reservation'),
      reservationId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('consume_reservation'),
      reservationId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      /** Defaults to the whole reservation; any unused remainder returns to free stock. */
      quantity: z.number().int().positive().max(1_000_000).optional(),
      ...stockEvidence,
    })
    .strict(),
]);
export type StockReservationCommand = z.infer<typeof stockReservationCommandSchema>;

export interface StockCountLineRecord {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemNameEn: string;
  readonly itemNameAr: string;
  readonly systemQuantity: number;
  readonly countedQuantity: number | null;
  readonly unitCostMinor: number;
  readonly variance: number | null;
}

export interface StockCountRecord {
  readonly id: string;
  readonly countNumber: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly binId: string | null;
  readonly binCode: string | null;
  readonly currency: 'USD' | 'LBP';
  readonly status: 'open' | 'closed' | 'cancelled';
  readonly version: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly journalEntryId: string | null;
  readonly lines: readonly StockCountLineRecord[];
}

/**
 * A stock count is a session, not a series of ad-hoc adjustments: it freezes what the system
 * believed, records what was found, and posts the difference once. Opening and recording are
 * warehouse work; closing moves money and carries finance authority with step-up.
 */
export const stockCountCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('open_count'),
      countNumber: z.string().trim().min(2).max(80),
      warehouseId: z.string().uuid(),
      binId: z.string().uuid().optional(),
      currency: z.enum(['USD', 'LBP']),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('record_count'),
      countId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      lines: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              countedQuantity: z.number().int().nonnegative().max(10_000_000),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('close_count'),
      countId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel_count'),
      countId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
]);
export type StockCountCommand = z.infer<typeof stockCountCommandSchema>;

export interface RmaCaseRecord {
  readonly id: string;
  readonly caseNumber: string;
  readonly assetId: string;
  readonly serialNumber: string;
  readonly sku: string;
  readonly vendorId: string | null;
  readonly vendorNameEn: string | null;
  readonly vendorNameAr: string | null;
  readonly warehouseCode: string;
  readonly faultSummary: string;
  readonly status: 'open' | 'sent_to_vendor' | 'repaired' | 'replaced' | 'scrapped' | 'closed';
  readonly replacementSerialNumber: string | null;
  readonly journalEntryId: string | null;
  readonly version: number;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
}

/**
 * RMA lifecycle for serialized equipment. Scrapping writes the device off and is the only step
 * that touches the books, so it carries finance authority; the rest is warehouse work.
 */
export const rmaCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('open_case'),
      caseNumber: z.string().trim().min(2).max(80),
      assetId: z.string().uuid(),
      vendorId: z.string().uuid().optional(),
      faultSummary: z.string().trim().min(8).max(1000),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('send_to_vendor'),
      caseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('receive_repaired'),
      caseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('receive_replacement'),
      caseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      replacementSerialNumber: z.string().trim().min(2).max(100),
      replacementMacAddress: z.string().trim().min(2).max(50).optional(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('scrap_asset'),
      caseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('close_case'),
      caseId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      ...stockEvidence,
    })
    .strict(),
]);
export type RmaCommand = z.infer<typeof rmaCommandSchema>;

/**
 * Derived purchasing signal: what a location holds, what is already on order, and how much more
 * would restore it to its reorder threshold. Read-only — nothing here commits a purchase.
 */
export interface ReorderSuggestionRecord {
  readonly itemId: string;
  readonly sku: string;
  readonly itemNameEn: string;
  readonly itemNameAr: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly quantityOnHand: number;
  readonly quantityReserved: number;
  readonly quantityAvailable: number;
  readonly quantityOnOrder: number;
  readonly reorderThreshold: number;
  readonly suggestedQuantity: number;
}

export interface StockMovementRecord {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly kind: StockMovementKind;
  readonly warehouseCode: string;
  readonly binCode: string | null;
  readonly quantity: number;
  readonly unitCostMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly journalEntryId: string | null;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly evidence: string;
  readonly occurredAt: string;
  readonly actorName: string | null;
}

export const stockCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('transfer_stock'),
      itemId: z.string().uuid(),
      quantity: z.number().int().positive().max(1_000_000),
      fromWarehouseId: z.string().uuid(),
      fromBinId: z.string().uuid().optional(),
      toWarehouseId: z.string().uuid(),
      toBinId: z.string().uuid().optional(),
      ...stockEvidence,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.fromWarehouseId === value.toWarehouseId && value.fromBinId === value.toBinId) {
        context.addIssue({
          code: 'custom',
          path: ['toWarehouseId'],
          message: 'Source and destination locations must differ.',
        });
      }
    }),
  // Writing inventory value up or down posts to the variance account, so this is a finance
  // action rather than an operations one.
  z
    .object({
      action: z.literal('adjust_stock'),
      itemId: z.string().uuid(),
      quantity: z.number().int().positive().max(1_000_000),
      warehouseId: z.string().uuid(),
      binId: z.string().uuid().optional(),
      direction: z.enum(['increase', 'decrease']),
      currency: z.enum(['USD', 'LBP']),
      ...stockEvidence,
    })
    .strict(),
]);
export type StockCommand = z.infer<typeof stockCommandSchema>;

export interface WarehouseAdminEvent {
  readonly id: string;
  readonly aggregateType: 'item' | 'warehouse' | 'bin';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly action: WarehouseAdminCommand['action'];
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly evidence: string;
  readonly occurredAt: string;
  readonly actorName: string | null;
}

export interface ProcurementPurchaseOrder {
  readonly id: string;
  readonly poNumber: string;
  readonly vendorId: string;
  readonly vendorNameEn: string;
  readonly vendorNameAr: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly status: 'draft' | 'approved' | 'partially_received' | 'received' | 'cancelled';
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
  readonly bins: readonly WarehouseBinRecord[];
  /** Branches the signed session may place a warehouse in; empty means none are in scope. */
  readonly branches: readonly {
    readonly id: string;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
  }[];
  readonly administrationEvents: readonly WarehouseAdminEvent[];
  readonly stockBalances: readonly StockBalanceRecord[];
  readonly stockMovements: readonly StockMovementRecord[];
  readonly stockReservations: readonly StockReservationRecord[];
  readonly stockCounts: readonly StockCountRecord[];
  readonly rmaCases: readonly RmaCaseRecord[];
  readonly reorderSuggestions: readonly ReorderSuggestionRecord[];
}
