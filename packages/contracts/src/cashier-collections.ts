import { z } from 'zod';

// Office cashier and field collections: drawers per cashier and currency, receipts posted
// atomically with their allocations, voids as linked reversals, route collectors, invoice
// assignments derived from the open balance, office-recorded collections and route settlements
// whose difference is kept and approved by a different manager.

export const cashierCurrencySchema = z.enum(['USD', 'LBP']);
export const receiptMethodSchema = z.enum([
  'cash',
  'card',
  'bank_transfer',
  'omt',
  'whish',
  'other',
]);
export type ReceiptMethod = z.infer<typeof receiptMethodSchema>;

const minor = z.number().int().nonnegative().safe();
const positiveMinor = z.number().int().positive().safe();

export const openDrawerSchema = z
  .object({
    action: z.literal('open_drawer'),
    branchId: z.uuid(),
    currency: cashierCurrencySchema,
    openingFloatMinor: minor,
  })
  .strict();
export const closeDrawerSchema = z
  .object({
    action: z.literal('close_drawer'),
    drawerId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    countedMinor: minor,
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const recordReceiptSchema = z
  .object({
    action: z.literal('record_receipt'),
    subscriberId: z.uuid(),
    invoiceId: z.uuid().optional(),
    amountMinor: positiveMinor,
    currency: cashierCurrencySchema,
    method: receiptMethodSchema.default('cash'),
    reference: z.string().trim().min(1).max(200).optional(),
    receiptNumber: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((body) => body.method === 'cash' || body.reference !== undefined, {
    path: ['reference'],
    message: 'Non-cash receipts need the card, transfer or agent reference.',
  });
export const cashierCommandSchema = z.discriminatedUnion('action', [
  openDrawerSchema,
  closeDrawerSchema,
  recordReceiptSchema,
]);
export type CashierCommand = z.infer<typeof cashierCommandSchema>;

export const voidReceiptSchema = z
  .object({
    action: z.literal('void_receipt'),
    receiptId: z.uuid(),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();
export type VoidReceiptCommand = z.infer<typeof voidReceiptSchema>;

export const cashierQuerySchema = z
  .object({ search: z.string().trim().min(1).max(120).optional() })
  .strict();
export type CashierQuery = z.infer<typeof cashierQuerySchema>;

export interface CashDrawerRecord {
  readonly id: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly branchNameAr: string;
  readonly cashier: string;
  readonly mine: boolean;
  readonly currency: 'USD' | 'LBP';
  readonly status: 'open' | 'closed';
  readonly openingFloatMinor: number;
  readonly cashReceiptsMinor: number;
  readonly receipts: number;
  readonly expectedMinor: number | null;
  readonly countedMinor: number | null;
  readonly varianceMinor: number | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closingNote: string | null;
  readonly version: number;
}
export interface ReceiptAllocation {
  readonly invoiceId: string;
  readonly documentNumber: string;
  readonly amountMinor: number;
}
export interface ReceiptRecord {
  readonly id: string;
  readonly receiptNumber: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly subscriberNumber: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly method: ReceiptMethod;
  readonly reference: string | null;
  readonly note: string | null;
  readonly cashier: string;
  readonly drawerId: string | null;
  readonly postedAt: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly allocatedMinor: number;
  readonly allocations: readonly ReceiptAllocation[];
}
export interface CashierOpenInvoice {
  readonly id: string;
  readonly documentNumber: string;
  readonly currency: 'USD' | 'LBP';
  readonly amountMinor: number;
  readonly remainingMinor: number;
  readonly postedAt: string;
}
export interface CashierSubscriber {
  readonly id: string;
  readonly subscriberNumber: string;
  readonly displayName: string;
  readonly status: string;
  readonly branchName: string;
  readonly branchNameAr: string;
  readonly phone: string | null;
  readonly openInvoices: readonly CashierOpenInvoice[];
  readonly unallocated: readonly {
    readonly currency: 'USD' | 'LBP';
    readonly amountMinor: number;
  }[];
}
export interface CashierWorkspace {
  readonly asOf: string;
  readonly drawers: readonly CashDrawerRecord[];
  readonly branches: readonly {
    readonly id: string;
    readonly nameEn: string;
    readonly nameAr: string;
  }[];
  readonly today: readonly {
    readonly currency: 'USD' | 'LBP';
    readonly method: ReceiptMethod;
    readonly amountMinor: number;
    readonly receipts: number;
  }[];
  readonly receipts: readonly ReceiptRecord[];
  readonly subscribers: readonly CashierSubscriber[];
}
export interface ReceiptResult {
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly paymentId: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly method: ReceiptMethod;
  readonly allocatedMinor: number;
  readonly unallocatedMinor: number;
  readonly allocations: readonly (ReceiptAllocation & { readonly allocationId: string })[];
  readonly drawerId: string | null;
  readonly postedAt: string;
  readonly replayed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------
export const assignRouteCollectorSchema = z
  .object({
    action: z.literal('assign_route_collector'),
    routeId: z.uuid(),
    collectorUserId: z.uuid().nullable(),
  })
  .strict();
export const assignInvoiceSchema = z
  .object({
    action: z.literal('assign_invoice'),
    invoiceId: z.uuid(),
    collectorUserId: z.uuid().optional(),
    dueOn: z.iso.date(),
  })
  .strict();
export const assignRouteDueSchema = z
  .object({
    action: z.literal('assign_route_due'),
    routeId: z.uuid(),
    collectorUserId: z.uuid().optional(),
    dueOn: z.iso.date(),
  })
  .strict();
export const reassignSchema = z
  .object({
    action: z.literal('reassign'),
    assignmentId: z.uuid(),
    collectorUserId: z.uuid().optional(),
    dueOn: z.iso.date().optional(),
  })
  .strict();
export const assignmentOutcomeSchema = z
  .object({
    action: z.enum(['mark_visited', 'mark_returned', 'cancel_assignment']),
    assignmentId: z.uuid(),
    reason: z.string().trim().min(8).max(1000).optional(),
  })
  .strict();
export const settleRouteSchema = z
  .object({
    action: z.literal('settle_route'),
    routeId: z.uuid(),
    collectorUserId: z.uuid(),
    businessDate: z.iso.date(),
    currency: cashierCurrencySchema,
    declaredMinor: minor,
    reason: z.string().trim().min(8).max(1000).optional(),
  })
  .strict();
export const collectionManageCommandSchema = z.discriminatedUnion('action', [
  assignRouteCollectorSchema,
  assignInvoiceSchema,
  assignRouteDueSchema,
  reassignSchema,
  assignmentOutcomeSchema,
  settleRouteSchema,
]);
export type CollectionManageCommand = z.infer<typeof collectionManageCommandSchema>;

export const recordCollectionSchema = z
  .object({
    action: z.literal('record_collection'),
    assignmentId: z.uuid(),
    amountMinor: positiveMinor.optional(),
    receiptNumber: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type RecordCollectionCommand = z.infer<typeof recordCollectionSchema>;

export const approveSettlementSchema = z
  .object({
    action: z.literal('approve_settlement'),
    settlementId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();
export type ApproveSettlementCommand = z.infer<typeof approveSettlementSchema>;

export const collectionsQuerySchema = z.object({ day: z.iso.date().optional() }).strict();
export type CollectionsQuery = z.infer<typeof collectionsQuerySchema>;

export interface CollectorRecord {
  readonly userId: string;
  readonly name: string;
  readonly roleKey: string;
  readonly active: boolean;
  readonly routes: number;
  readonly openAssignments: number;
  readonly devices: number;
  readonly lastSeenAt: string | null;
}
export interface CollectionRouteRecord {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly active: boolean;
  readonly branchId: string;
  readonly collectorUserId: string | null;
  readonly collectorName: string | null;
  readonly openAssignments: number;
  readonly unassignedInvoices: number;
}
export interface CollectionAssignmentRecord {
  readonly id: string;
  readonly subscriberId: string;
  readonly subscriberName: string;
  readonly subscriberNumber: string;
  readonly routeId: string;
  readonly routeCode: string;
  readonly collectorUserId: string;
  readonly collectorName: string | null;
  readonly invoiceId: string;
  readonly documentNumber: string;
  readonly dueOn: string;
  readonly expectedMinor: number;
  readonly openMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly status: 'assigned' | 'visited' | 'returned' | 'collected' | 'cancelled';
  readonly collectedMinor: number | null;
  readonly collectedAt: string | null;
  readonly receiptNumber: string | null;
  readonly phone: string | null;
  readonly assignedAt: string;
}
export interface RouteSettlementRecord {
  readonly id: string;
  readonly source: 'office' | 'device';
  readonly routeId: string;
  readonly routeCode: string;
  readonly collectorUserId: string;
  readonly collectorName: string | null;
  readonly businessDate: string;
  readonly currency: 'USD' | 'LBP';
  readonly expectedMinor: number;
  readonly declaredMinor: number;
  readonly differenceMinor: number;
  readonly status: 'accepted' | 'pending_approval' | 'approved';
  readonly reason: string | null;
  readonly settledBy: string | null;
  readonly settledAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalReason: string | null;
  readonly version: number;
}
export interface CollectDeviceRecord {
  readonly id: string;
  readonly label: string;
  readonly collectorUserId: string;
  readonly collectorName: string | null;
  readonly status: string;
  readonly lastSeenAt: string | null;
  readonly authorizedAt: string;
  readonly lastSequence: number;
  readonly revokedAt: string | null;
}
export interface CollectionsWorkspace {
  readonly asOf: string;
  readonly day: string;
  readonly collectors: readonly CollectorRecord[];
  readonly routes: readonly CollectionRouteRecord[];
  readonly assignments: readonly CollectionAssignmentRecord[];
  readonly settlements: readonly RouteSettlementRecord[];
  readonly devices: readonly CollectDeviceRecord[];
}
