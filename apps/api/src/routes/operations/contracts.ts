import type {
  CreateOutageCommand,
  TransitionOutageCommand,
  NocQuery,
  CustomerAccountCommand,
  Permission,
  SupportedCurrency,
  VerifiedTenantId,
  JournalEntryInput,
  CustomerStatementQuery,
  PeriodCloseRequest,
  VoucherBatchInput,
  VoucherRedeemInput,
  InventoryCustodyCommand,
  ProcurementCommand,
  WarehouseAdminCommand,
  StockCommand,
  StockReservationCommand,
  StockCountCommand,
  RmaCommand,
  VendorQuoteCommand,
} from '@isp/contracts';

export interface OperationsMutationContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly permission: Permission;
  /** Audited authorization action; distinct from a requested network device action. */
  readonly auditAction: string;
  readonly reason: string;
  /** Undefined means unrestricted for that dimension; an empty array denies every record. */
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}

export interface OperationsWriter {
  readNocWorkspace(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { query?: Partial<NocQuery> },
  ): Promise<unknown>;
  createOutageIncident(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { command: CreateOutageCommand },
  ): Promise<unknown>;
  transitionOutageIncident(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { command: TransitionOutageCommand },
  ): Promise<unknown>;
  postCustomerAccountEntry(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly command: CustomerAccountCommand;
    },
  ): Promise<unknown>;
  readCustomerAccounts(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  generateInvoiceDocument(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly invoiceId: string },
  ): Promise<unknown>;
  downloadInvoiceDocument(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly artifactId: string },
  ): Promise<{ readonly bytes: Buffer; readonly filename: string }>;
  readBillingWorkspace(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readSubscriberWorkspace(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readSalesWorkspace(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  applyServiceChangeOrder(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly serviceId: string;
      readonly action: 'plan_change' | 'suspend' | 'restore' | 'terminate';
      readonly targetPlanId?: string;
    },
  ): Promise<unknown>;
  createAddonVersion(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly branchId?: string;
      readonly code: string;
      readonly version: number;
      readonly nameEn: string;
      readonly nameAr: string;
      readonly kind: 'recurring' | 'one_time' | 'quota_topup';
      readonly amountMinor: number;
      readonly currency: SupportedCurrency;
      readonly quotaGb?: number;
      readonly effectiveFrom: string;
      readonly effectiveTo?: string;
    },
  ): Promise<unknown>;
  purchaseServiceAddon(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly serviceId: string;
      readonly addonVersionId: string;
      readonly quantity: number;
      readonly appliesFrom: string;
      readonly appliesTo: string;
    },
  ): Promise<unknown>;
  recordServiceUsage(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly serviceId: string;
      readonly source: string;
      readonly eventReference: string;
      readonly occurredAt: string;
      readonly downloadBytes: number;
      readonly uploadBytes: number;
    },
  ): Promise<unknown>;
  createSalesLead(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly leadNumber: string;
      readonly partyKind: 'person' | 'business';
      readonly displayName: string;
      readonly source: string;
      readonly primaryPhone?: string;
      readonly primaryEmail?: string;
      readonly branchId: string;
      readonly areaId: string;
      readonly routeId: string;
      readonly addressLine: string;
      readonly needsSummary: string;
      readonly assignedTo?: string;
    },
  ): Promise<unknown>;
  createSalesOfferVersion(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly offerId?: string;
      readonly branchId?: string;
      readonly code: string;
      readonly version: number;
      readonly nameEn: string;
      readonly nameAr: string;
      readonly accessTechnology: string;
      readonly downstreamMbps: number;
      readonly upstreamMbps: number;
      readonly quotaGb?: number;
      readonly recurringAmountMinor: number;
      readonly activationFeeMinor: number;
      readonly equipmentFeeMinor: number;
      readonly currency: SupportedCurrency;
      readonly commitmentMonths: number;
      readonly eligibility: Readonly<Record<string, unknown>>;
      readonly policy: Readonly<Record<string, unknown>>;
      readonly effectiveFrom: string;
      readonly effectiveTo?: string;
    },
  ): Promise<unknown>;
  qualifySalesLead(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly leadId: string;
      readonly result: 'eligible' | 'ineligible' | 'survey_required' | 'reserved';
      readonly accessTechnology: string;
      readonly coverageSource: string;
      readonly reasonCodes: readonly string[];
      readonly evidence: Readonly<Record<string, unknown>>;
      readonly capacityReference?: string;
      readonly reservationExpiresAt?: string;
    },
  ): Promise<unknown>;
  createSalesQuote(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly leadId: string;
      readonly offerVersionId: string;
      readonly quoteNumber: string;
      readonly version: number;
      readonly discountBasisPoints: number;
      readonly validUntil: string;
      readonly terms: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown>;
  approveSalesQuote(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly quoteId: string },
  ): Promise<unknown>;
  acceptSalesQuote(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly quoteId: string;
      readonly orderNumber: string;
      readonly acceptedBy: string;
      readonly acceptanceReference: string;
      readonly ownerId?: string;
    },
  ): Promise<unknown>;
  convertSalesOrderSubscriber(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly orderId: string;
      readonly subscriberNumber: string;
      readonly householdReference: string;
      readonly locationLabel: string;
      readonly areaCode?: string;
    },
  ): Promise<unknown>;
  createCapacityResource(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly type:
        | 'pop'
        | 'sector'
        | 'olt'
        | 'fiber_port'
        | 'wireless_sector'
        | 'access_node'
        | 'capacity_pool';
      readonly code: string;
      readonly name: string;
      readonly accessTechnology: string;
      readonly totalUnits: number;
      readonly branchId: string;
      readonly areaId?: string;
      readonly routeId?: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown>;
  reserveSalesOrderResource(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly orderId: string;
      readonly resourceId: string;
      readonly units: number;
    },
  ): Promise<unknown>;
  createSalesOrderInstallation(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly orderId: string;
      readonly planId: string;
      readonly serviceNumber: string;
      readonly billingAnchorDay: number;
    },
  ): Promise<unknown>;
  enqueueSalesOrderActivation(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly orderId: string },
  ): Promise<unknown>;
  executeSalesOrderCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly orderId: string;
      readonly command: 'retry_task' | 'place_on_hold' | 'resume' | 'cancel';
      readonly taskKey?: string;
    },
  ): Promise<unknown>;
  postSalesOrderFirstInvoice(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly orderId: string;
      readonly documentNumber: string;
      readonly periodStart: string;
      readonly periodEnd: string;
    },
  ): Promise<unknown>;
  createSubscriber(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly subscriberNumber: string;
      readonly displayName: string;
      readonly householdReference: string;
      readonly householdName: string;
      readonly locationLabel: string;
      readonly addressLine: string;
      readonly branchId: string;
      readonly areaId: string;
      readonly routeId: string;
      readonly areaCode?: string;
      readonly primaryPhone?: string;
    },
  ): Promise<unknown>;
  prepareBilling(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly retryOfRunId?: string;
    },
  ): Promise<unknown>;
  createDunningPolicyVersion(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly branchId?: string;
      readonly version: number;
      readonly paymentTermsDays: number;
      readonly reminderAfterDays: number;
      readonly finalNoticeAfterDays: number;
      readonly suspensionReviewAfterDays: number;
      readonly effectiveFrom: string;
      readonly effectiveTo?: string;
    },
  ): Promise<unknown>;
  evaluateDunning(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly asOfDate: string },
  ): Promise<unknown>;
  recordOfficePayment(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly subscriberId: string;
      readonly financePaymentId: string;
      readonly branchId: string;
      readonly areaId: string;
      readonly routeId: string;
      readonly receiptNumber: string;
      readonly amountMinor: number;
      readonly currency: SupportedCurrency;
    },
  ): Promise<unknown>;
  recordPaymentCorrection(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly paymentRequestId: string;
      readonly financeAllocationId?: string;
      readonly previousCorrectionId?: string;
      readonly correctionKind: 'allocation' | 'reversal' | 'note';
      readonly reason: string;
    },
  ): Promise<unknown>;
  createPlanVersion(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly planId?: string;
      readonly branchId?: string;
      readonly code: string;
      readonly nameEn: string;
      readonly nameAr: string;
      readonly networkProfileReference?: string;
      readonly accessTechnology: string;
      readonly downstreamMbps: number;
      readonly upstreamMbps: number;
      readonly quotaGb?: number;
      readonly billingMode: 'prepaid' | 'postpaid';
      readonly prorationMode: 'none' | 'daily';
      readonly fupPolicy: Readonly<Record<string, unknown>>;
      readonly includedAddons: readonly Readonly<Record<string, unknown>>[];
      readonly overagePerGbMinor?: number;
      readonly version: number;
      readonly recurringAmountMinor: number;
      readonly currency: SupportedCurrency;
      readonly billingIntervalMonths: number;
      readonly effectiveFrom: string;
      readonly effectiveTo?: string;
    },
  ): Promise<unknown>;
  createBillingPolicyVersion(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly branchId?: string;
      readonly version: number;
      readonly vatRateBasisPoints: number;
      readonly roundingMode: 'half_up' | 'down' | 'up';
      readonly supplierNameEn: string;
      readonly supplierNameAr: string;
      readonly supplierAddressEn: string;
      readonly supplierAddressAr: string;
      readonly supplierTaxRegistrationNumber: string;
      readonly taxTreatment: 'taxable' | 'exempt' | 'out_of_scope';
      readonly taxReasonEn?: string;
      readonly taxReasonAr?: string;
      readonly taxAuthorityReference?: string;
      readonly stampDutyUsdMinor: number;
      readonly stampDutyLbpMinor: number;
      readonly retentionYears: number;
      readonly effectiveFrom: string;
      readonly effectiveTo?: string;
    },
  ): Promise<unknown>;
  createServiceInstallation(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly subscriberId: string;
      readonly locationId: string;
      readonly planId: string;
      readonly serviceNumber: string;
      readonly billingAnchorDay: number;
      readonly branchId: string;
      readonly areaId: string;
      readonly routeId: string;
      readonly scheduledFor?: string;
      readonly installerUserId?: string;
    },
  ): Promise<unknown>;
  assignCollector(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly collectorUserId: string;
      readonly subscriberId: string;
      readonly routeId: string;
      readonly financeInvoiceId: string;
      readonly dueOn: string;
    },
  ): Promise<unknown>;
  recordCollectorEvidence(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly assignmentId: string;
      readonly financePaymentId: string;
    },
  ): Promise<unknown>;
  reconcileCollector(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly collectorUserId: string;
      readonly routeId: string;
      readonly businessDate: string;
      readonly currency: SupportedCurrency;
      readonly previousReconciliationId?: string;
      readonly reason?: string;
    },
  ): Promise<unknown>;
  transitionInstallation(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly installationId: string;
      readonly toStatus: string;
      readonly expectedVersion: number;
      readonly note?: string;
      readonly evidence: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown>;
  createIssue(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly issueNumber: string;
      readonly subject: string;
      readonly description: string;
      readonly priority: 'low' | 'normal' | 'high' | 'urgent';
      readonly subscriberId?: string;
      readonly serviceId?: string;
      readonly branchId: string;
      readonly areaId: string;
      readonly routeId: string;
    },
  ): Promise<unknown>;
  transitionIssue(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly issueId: string;
      readonly toStatus: string;
      readonly expectedVersion: number;
      readonly note?: string;
      readonly evidence: Readonly<Record<string, unknown>>;
    },
  ): Promise<unknown>;
  requestExport(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly reportKey: string;
      readonly filters: Readonly<Record<string, unknown>>;
      readonly format: 'csv' | 'xlsx' | 'pdf';
    },
  ): Promise<unknown>;
  configure(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly key: string;
      readonly value: Readonly<Record<string, unknown>>;
      readonly branchId?: string;
      readonly expectedVersion?: number;
    },
  ): Promise<unknown>;
  enqueueNetworkAction(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext &
      (
        | {
            readonly serviceId: string;
            readonly action: 'activate' | 'restore';
            readonly payload: Record<string, never>;
          }
        | {
            readonly serviceId: string;
            readonly action: 'change_profile';
            readonly payload: { readonly profileReference: string };
          }
        | {
            readonly serviceId: string;
            readonly action: 'suspend' | 'terminate';
            readonly payload: { readonly reasonCode: string };
          }
      ),
  ): Promise<unknown>;
  readChartOfAccounts(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  postJournalEntry(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly command: JournalEntryInput;
    },
  ): Promise<unknown>;
  readJournalEntries(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readCustomerStatement(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly query: CustomerStatementQuery;
    },
  ): Promise<unknown>;
  readTrialBalance(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly asOfDate?: string },
  ): Promise<unknown>;
  readAccountingPeriods(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  closeAccountingPeriod(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly request: PeriodCloseRequest;
    },
  ): Promise<unknown>;
  readDealers(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  generateVoucherBatch(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly command: VoucherBatchInput;
    },
  ): Promise<unknown>;
  redeemVoucher(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly command: VoucherRedeemInput;
    },
  ): Promise<unknown>;
  readWarehouses(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readInventoryItems(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readSerializedAssets(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readWarehouseWorkspace(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  transitionInventoryCustody(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: InventoryCustodyCommand },
  ): Promise<unknown>;
  executeProcurementCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: ProcurementCommand },
  ): Promise<unknown>;
  executeWarehouseAdminCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: WarehouseAdminCommand },
  ): Promise<unknown>;
  executeStockCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: StockCommand },
  ): Promise<unknown>;
  executeStockReservationCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: StockReservationCommand },
  ): Promise<unknown>;
  executeStockCountCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: StockCountCommand },
  ): Promise<unknown>;
  executeRmaCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: RmaCommand },
  ): Promise<unknown>;
  executeVendorQuoteCommand(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & { readonly command: VendorQuoteCommand },
  ): Promise<unknown>;
  readNasClients(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readRadiusSessions(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext,
  ): Promise<unknown>;
  readIpPools(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readCpeDevices(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readNetworkAlarms(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readOutages(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
  readQosReports(tenantId: VerifiedTenantId, input: OperationsMutationContext): Promise<unknown>;
}

export interface OperationsDefinition {
  readonly path: string;
  readonly operationId: string;
  readonly permission: Permission;
  readonly action: string;
  readonly resourceType: string;
}
