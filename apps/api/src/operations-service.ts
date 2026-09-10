import { integrationConfigureCommandSchema, type VerifiedTenantId } from '@isp/contracts';
import { createHash } from 'node:crypto';
import {
  executeFieldServiceCommand,
  readFieldServiceWorkspace,
  executeNetworkCommand,
  readNetworkWorkspace,
  executeIntegrationSettingsCommand,
  readTenantIntegrationDelivery,
  readTenantIntegrationSettings,
  readNocWorkspace,
  createOutageIncident,
  transitionOutageIncident,
  executeNocAlarmCommand,
  postCustomerAccountEntry,
  readCustomerAccounts,
  readChartOfAccounts,
  postJournalEntry,
  readJournalEntries,
  readCustomerStatement,
  readTrialBalance,
  readAccountingPeriods,
  closeAccountingPeriod,
  readDealerWorkspace,
  readCashierWorkspace,
  executeRegulatoryCommand,
  readRegulatoryWorkspace,
  executePeopleCommand,
  readPeopleWorkspace,
  executeCashierCommand,
  voidReceipt,
  readCollectionsWorkspace,
  executeCollectionCommand,
  recordCollection,
  readAssuranceWorkspace,
  executeAssuranceCommand,
  readSupportWorkspace,
  executeSupportCommand,
  readDashboardSnapshot,
  readReportsWorkspace,
  readReportDataset,
  recordReportExport,
  renderCsv,
  readCommunicationsWorkspace,
  executeTemplateCommand,
  executeCommunicationCommand,
  markNotificationDelivery,
  readQueuedNotifications,
  executeDealerChannelCommand,
  generateVoucherBatch,
  adjustDealerBalance,
  redeemVoucherForSubscriber,
  confirmVoucherCredit,
  readPendingVoucherRedemption,
  readWarehouses,
  readInventoryItems,
  readSerializedAssets,
  readWarehouseWorkspace,
  transitionInventoryCustody,
  executeProcurementCommand,
  executeWarehouseAdminCommand,
  executeStockCommand,
  executeStockReservationCommand,
  executeStockCountCommand,
  executeRmaCommand,
  executeVendorQuoteCommand,
  readNasClients,
  readRadiusSessions,
  readIpPools,
  readCpeDevices,
  readNetworkAlarms,
  readOutages,
  readQosReports,
  assignCollectorInvoice,
  applyServiceChangeOrder,
  acceptSalesQuote,
  approveSalesQuote,
  configureOperations,
  convertSalesOrderSubscriber,
  createCapacityResource,
  createAddonVersion,
  createBillingPolicyVersion,
  createSalesLead,
  createSalesOfferVersion,
  createSalesOrderInstallation,
  enqueueSalesOrderActivation,
  executeSalesOrderCommand,
  postSalesOrderFirstInvoice,
  createDunningPolicyVersion,
  purchaseServiceAddon,
  createSalesQuote,
  createOperationsPlanVersion,
  createServiceInstallation,
  createSubscriber,
  createSupportIssue,
  enqueueSubscriberNetworkAction,
  prepareRecurringInvoices,
  evaluateDunning,
  qualifySalesLead,
  readSalesWorkspace,
  readBillingWorkspace,
  prepareInvoiceDocument,
  completeInvoiceDocument,
  readInvoiceDocument,
  readSubscriberWorkspace,
  recordServiceUsage,
  reconcileCollector,
  recordCollectorEvidence,
  recordOfficePaymentCorrection,
  recordOfficePaymentRequest,
  requestOperationsExport,
  reserveSalesOrderResource,
  signOperationsAttestation,
  transitionInstallation,
  transitionSupportIssue,
  type Database,
  type OperationsAttestation,
  type SignedOperationsDatabaseContext,
} from '@isp/database';
import type { OperationsMutationContext, OperationsWriter } from './routes/operations/contracts.js';
import { integrationTestMail, integrationTestText } from './integrations/mail-templates.js';
import type { DeliveryPassResult } from '@isp/contracts';
import type { StoredIntegrationDelivery } from '@isp/database';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
import {
  performIntegrationTest,
  prepareIntegrationConfiguration,
  type IntegrationRuntime,
} from './integrations/runtime.js';
import { renderInvoicePdf } from './documents/invoice-pdf.js';
import { invoiceStorageKey, type InvoiceDocumentStore } from './documents/invoice-store.js';

type WriterInput<Key extends keyof OperationsWriter> = Parameters<OperationsWriter[Key]>[1];

export interface OperationsContextAuthorityConfig {
  readonly keyId: string;
  readonly secret: Uint8Array;
}

export interface OperationsRepositoryAdapter {
  readonly readNocWorkspace: typeof readNocWorkspace;
  readonly createOutageIncident: typeof createOutageIncident;
  readonly transitionOutageIncident: typeof transitionOutageIncident;
  readonly executeNocAlarmCommand: typeof executeNocAlarmCommand;
  readonly postCustomerAccountEntry: typeof postCustomerAccountEntry;
  readonly readCustomerAccounts: typeof readCustomerAccounts;
  readonly readChartOfAccounts: typeof readChartOfAccounts;
  readonly postJournalEntry: typeof postJournalEntry;
  readonly readJournalEntries: typeof readJournalEntries;
  readonly readCustomerStatement: typeof readCustomerStatement;
  readonly readTrialBalance: typeof readTrialBalance;
  readonly readAccountingPeriods: typeof readAccountingPeriods;
  readonly closeAccountingPeriod: typeof closeAccountingPeriod;
  readonly readDealerWorkspace: typeof readDealerWorkspace;
  readonly readCashierWorkspace: typeof readCashierWorkspace;
  readonly executeRegulatoryCommand: typeof executeRegulatoryCommand;
  readonly readRegulatoryWorkspace: typeof readRegulatoryWorkspace;
  readonly executePeopleCommand: typeof executePeopleCommand;
  readonly readPeopleWorkspace: typeof readPeopleWorkspace;
  readonly executeCashierCommand: typeof executeCashierCommand;
  readonly voidReceipt: typeof voidReceipt;
  readonly readCollectionsWorkspace: typeof readCollectionsWorkspace;
  readonly executeCollectionCommand: typeof executeCollectionCommand;
  readonly recordCollection: typeof recordCollection;
  readonly readAssuranceWorkspace: typeof readAssuranceWorkspace;
  readonly readSupportWorkspace: typeof readSupportWorkspace;
  readonly readDashboardSnapshot: typeof readDashboardSnapshot;
  readonly readReportsWorkspace: typeof readReportsWorkspace;
  readonly readReportDataset: typeof readReportDataset;
  readonly recordReportExport: typeof recordReportExport;
  readonly executeSupportCommand: typeof executeSupportCommand;
  readonly readCommunicationsWorkspace: typeof readCommunicationsWorkspace;
  readonly executeTemplateCommand: typeof executeTemplateCommand;
  readonly executeCommunicationCommand: typeof executeCommunicationCommand;
  readonly markNotificationDelivery: typeof markNotificationDelivery;
  readonly readQueuedNotifications: typeof readQueuedNotifications;
  readonly executeAssuranceCommand: typeof executeAssuranceCommand;
  readonly executeDealerChannelCommand: typeof executeDealerChannelCommand;
  readonly generateVoucherBatch: typeof generateVoucherBatch;
  readonly adjustDealerBalance: typeof adjustDealerBalance;
  readonly redeemVoucherForSubscriber: typeof redeemVoucherForSubscriber;
  readonly confirmVoucherCredit: typeof confirmVoucherCredit;
  readonly readPendingVoucherRedemption: typeof readPendingVoucherRedemption;
  readonly readWarehouses: typeof readWarehouses;
  readonly readInventoryItems: typeof readInventoryItems;
  readonly readSerializedAssets: typeof readSerializedAssets;
  readonly readWarehouseWorkspace: typeof readWarehouseWorkspace;
  readonly transitionInventoryCustody: typeof transitionInventoryCustody;
  readonly executeProcurementCommand: typeof executeProcurementCommand;
  readonly executeWarehouseAdminCommand: typeof executeWarehouseAdminCommand;
  readonly executeStockCommand: typeof executeStockCommand;
  readonly executeStockReservationCommand: typeof executeStockReservationCommand;
  readonly executeStockCountCommand: typeof executeStockCountCommand;
  readonly executeRmaCommand: typeof executeRmaCommand;
  readonly executeVendorQuoteCommand: typeof executeVendorQuoteCommand;
  readonly executeIntegrationSettingsCommand: typeof executeIntegrationSettingsCommand;
  readonly readTenantIntegrationSettings: typeof readTenantIntegrationSettings;
  readonly readTenantIntegrationDelivery: typeof readTenantIntegrationDelivery;
  readonly executeFieldServiceCommand: typeof executeFieldServiceCommand;
  readonly readFieldServiceWorkspace: typeof readFieldServiceWorkspace;
  readonly executeNetworkCommand: typeof executeNetworkCommand;
  readonly readNetworkWorkspace: typeof readNetworkWorkspace;
  readonly readNasClients: typeof readNasClients;
  readonly readRadiusSessions: typeof readRadiusSessions;
  readonly readIpPools: typeof readIpPools;
  readonly readCpeDevices: typeof readCpeDevices;
  readonly readNetworkAlarms: typeof readNetworkAlarms;
  readonly readOutages: typeof readOutages;
  readonly readQosReports: typeof readQosReports;
  readonly prepareInvoiceDocument: typeof prepareInvoiceDocument;
  readonly completeInvoiceDocument: typeof completeInvoiceDocument;
  readonly readInvoiceDocument: typeof readInvoiceDocument;
  readonly readBillingWorkspace: typeof readBillingWorkspace;
  readonly readSalesWorkspace: typeof readSalesWorkspace;
  readonly readSubscriberWorkspace: typeof readSubscriberWorkspace;
  readonly applyServiceChangeOrder: typeof applyServiceChangeOrder;
  readonly createAddonVersion: typeof createAddonVersion;
  readonly purchaseServiceAddon: typeof purchaseServiceAddon;
  readonly recordServiceUsage: typeof recordServiceUsage;
  readonly createSalesLead: typeof createSalesLead;
  readonly createSalesOfferVersion: typeof createSalesOfferVersion;
  readonly qualifySalesLead: typeof qualifySalesLead;
  readonly createSalesQuote: typeof createSalesQuote;
  readonly approveSalesQuote: typeof approveSalesQuote;
  readonly acceptSalesQuote: typeof acceptSalesQuote;
  readonly convertSalesOrderSubscriber: typeof convertSalesOrderSubscriber;
  readonly createCapacityResource: typeof createCapacityResource;
  readonly reserveSalesOrderResource: typeof reserveSalesOrderResource;
  readonly createSalesOrderInstallation: typeof createSalesOrderInstallation;
  readonly enqueueSalesOrderActivation: typeof enqueueSalesOrderActivation;
  readonly executeSalesOrderCommand: typeof executeSalesOrderCommand;
  readonly postSalesOrderFirstInvoice: typeof postSalesOrderFirstInvoice;
  readonly createSubscriber: typeof createSubscriber;
  readonly prepareRecurringInvoices: typeof prepareRecurringInvoices;
  readonly createDunningPolicyVersion: typeof createDunningPolicyVersion;
  readonly evaluateDunning: typeof evaluateDunning;
  readonly recordOfficePaymentRequest: typeof recordOfficePaymentRequest;
  readonly recordOfficePaymentCorrection: typeof recordOfficePaymentCorrection;
  readonly createOperationsPlanVersion: typeof createOperationsPlanVersion;
  readonly createBillingPolicyVersion: typeof createBillingPolicyVersion;
  readonly createServiceInstallation: typeof createServiceInstallation;
  readonly assignCollectorInvoice: typeof assignCollectorInvoice;
  readonly recordCollectorEvidence: typeof recordCollectorEvidence;
  readonly reconcileCollector: typeof reconcileCollector;
  readonly transitionInstallation: typeof transitionInstallation;
  readonly createSupportIssue: typeof createSupportIssue;
  readonly transitionSupportIssue: typeof transitionSupportIssue;
  readonly requestOperationsExport: typeof requestOperationsExport;
  readonly configureOperations: typeof configureOperations;
  readonly enqueueSubscriberNetworkAction: typeof enqueueSubscriberNetworkAction;
}

const postgresOperationsRepository: OperationsRepositoryAdapter = {
  readNocWorkspace,
  createOutageIncident,
  transitionOutageIncident,
  executeNocAlarmCommand,
  postCustomerAccountEntry,
  readCustomerAccounts,
  readChartOfAccounts,
  postJournalEntry,
  readJournalEntries,
  readCustomerStatement,
  readTrialBalance,
  readAccountingPeriods,
  closeAccountingPeriod,
  readDealerWorkspace,
  readCashierWorkspace,
  executeRegulatoryCommand,
  readRegulatoryWorkspace,
  executePeopleCommand,
  readPeopleWorkspace,
  executeCashierCommand,
  voidReceipt,
  readCollectionsWorkspace,
  executeCollectionCommand,
  recordCollection,
  readAssuranceWorkspace,
  executeAssuranceCommand,
  readSupportWorkspace,
  executeSupportCommand,
  readDashboardSnapshot,
  readReportsWorkspace,
  readReportDataset,
  recordReportExport,
  readCommunicationsWorkspace,
  executeTemplateCommand,
  executeCommunicationCommand,
  markNotificationDelivery,
  readQueuedNotifications,
  executeDealerChannelCommand,
  generateVoucherBatch,
  adjustDealerBalance,
  redeemVoucherForSubscriber,
  confirmVoucherCredit,
  readPendingVoucherRedemption,
  readWarehouses,
  readInventoryItems,
  readSerializedAssets,
  readWarehouseWorkspace,
  transitionInventoryCustody,
  executeProcurementCommand,
  executeWarehouseAdminCommand,
  executeStockCommand,
  executeStockReservationCommand,
  executeStockCountCommand,
  executeRmaCommand,
  executeVendorQuoteCommand,
  executeIntegrationSettingsCommand,
  readTenantIntegrationSettings,
  readTenantIntegrationDelivery,
  executeFieldServiceCommand,
  readFieldServiceWorkspace,
  executeNetworkCommand,
  readNetworkWorkspace,
  readNasClients,
  readRadiusSessions,
  readIpPools,
  readCpeDevices,
  readNetworkAlarms,
  readOutages,
  readQosReports,
  prepareInvoiceDocument,
  completeInvoiceDocument,
  readInvoiceDocument,
  readBillingWorkspace,
  readSalesWorkspace,
  readSubscriberWorkspace,
  applyServiceChangeOrder,
  createAddonVersion,
  purchaseServiceAddon,
  recordServiceUsage,
  createSalesLead,
  createSalesOfferVersion,
  qualifySalesLead,
  createSalesQuote,
  approveSalesQuote,
  acceptSalesQuote,
  convertSalesOrderSubscriber,
  createCapacityResource,
  reserveSalesOrderResource,
  createSalesOrderInstallation,
  enqueueSalesOrderActivation,
  executeSalesOrderCommand,
  postSalesOrderFirstInvoice,
  createSubscriber,
  prepareRecurringInvoices,
  createDunningPolicyVersion,
  evaluateDunning,
  recordOfficePaymentRequest,
  recordOfficePaymentCorrection,
  createOperationsPlanVersion,
  createBillingPolicyVersion,
  createServiceInstallation,
  assignCollectorInvoice,
  recordCollectorEvidence,
  reconcileCollector,
  transitionInstallation,
  createSupportIssue,
  transitionSupportIssue,
  requestOperationsExport,
  configureOperations,
  enqueueSubscriberNetworkAction,
};

export function decodeOperationsContextSecret(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error('OPERATIONS_CONTEXT_SECRET_BASE64 must be canonical base64.');
  }
  const secret = Buffer.from(normalized, 'base64');
  if (secret.byteLength < 32) {
    throw new Error('OPERATIONS_CONTEXT_SECRET_BASE64 must decode to at least 32 bytes.');
  }
  return secret;
}

/**
 * Production adapter between the authenticated HTTP boundary and the tenant Operations repository.
 * Authority is derived only from the route-created mutation context and signed immediately before
 * the transaction; repository inputs never accept a caller-provided signature.
 */
export class PostgresOperationsService implements OperationsWriter {
  public constructor(
    private readonly database: Database,
    private readonly authority: OperationsContextAuthorityConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly repository: OperationsRepositoryAdapter = postgresOperationsRepository,
    private readonly documentStore?: InvoiceDocumentStore,
    private readonly integrations?: IntegrationRuntime,
  ) {}

  public postCustomerAccountEntry(
    tenantId: VerifiedTenantId,
    input: WriterInput<'postCustomerAccountEntry'>,
  ) {
    return this.repository.postCustomerAccountEntry(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readCustomerAccounts(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readCustomerAccounts'>,
  ) {
    return this.repository.readCustomerAccounts(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public async generateInvoiceDocument(
    tenantId: VerifiedTenantId,
    input: WriterInput<'generateInvoiceDocument'>,
  ) {
    const store = this.requireDocumentStore();
    const source = await this.repository.prepareInvoiceDocument(this.database, tenantId, {
      ...input,
      requestedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
    if (source.status === 'ready') {
      return {
        id: source.id,
        invoiceId: source.invoiceId,
        documentNumber: source.documentNumber,
        status: source.status,
        rendererVersion: source.rendererVersion,
        retentionUntil: source.retentionUntil,
        sha256: source.sha256,
        sizeBytes: source.sizeBytes,
        completedAt: source.completedAt,
      };
    }
    const bytes = await renderInvoicePdf(source.legalInvoiceSnapshot);
    const storageKey = invoiceStorageKey(tenantId, source.id);
    await store.put(storageKey, bytes, source.retentionUntil);
    return this.repository.completeInvoiceDocument(this.database, tenantId, {
      artifactId: source.id,
      storageKey,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      authorization: this.sign(tenantId, input),
    });
  }

  public async downloadInvoiceDocument(
    tenantId: VerifiedTenantId,
    input: WriterInput<'downloadInvoiceDocument'>,
  ) {
    const store = this.requireDocumentStore();
    const { archive, storageKey } = await this.repository.readInvoiceDocument(
      this.database,
      tenantId,
      {
        artifactId: input.artifactId,
        authorization: this.sign(tenantId, input),
      },
    );
    if (storageKey !== invoiceStorageKey(tenantId, archive.id))
      throw new Error('Invoice storage namespace mismatch.');
    const bytes = await store.get(storageKey);
    if (
      bytes.length !== archive.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== archive.sha256
    ) {
      throw new Error('Invoice archive integrity verification failed.');
    }
    return { bytes, filename: `invoice-${archive.id}.pdf` };
  }

  private requireDocumentStore(): InvoiceDocumentStore {
    if (!this.documentStore)
      throw Object.assign(new Error('Private invoice storage is not configured.'), {
        statusCode: 503,
      });
    return this.documentStore;
  }

  public async readBillingWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readBillingWorkspace'>,
  ) {
    const workspace = await this.repository.readBillingWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
    return { ...workspace, documentStorageConfigured: Boolean(this.documentStore) };
  }

  public readSalesWorkspace(tenantId: VerifiedTenantId, input: WriterInput<'readSalesWorkspace'>) {
    return this.repository.readSalesWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public readSubscriberWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readSubscriberWorkspace'>,
  ) {
    return this.repository.readSubscriberWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public applyServiceChangeOrder(
    tenantId: VerifiedTenantId,
    input: WriterInput<'applyServiceChangeOrder'>,
  ) {
    return this.repository.applyServiceChangeOrder(this.database, tenantId, {
      ...input,
      requestedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public createAddonVersion(tenantId: VerifiedTenantId, input: WriterInput<'createAddonVersion'>) {
    return this.repository.createAddonVersion(this.database, tenantId, {
      ...input,
      createdBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public purchaseServiceAddon(
    tenantId: VerifiedTenantId,
    input: WriterInput<'purchaseServiceAddon'>,
  ) {
    return this.repository.purchaseServiceAddon(this.database, tenantId, {
      ...input,
      purchasedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public recordServiceUsage(tenantId: VerifiedTenantId, input: WriterInput<'recordServiceUsage'>) {
    return this.repository.recordServiceUsage(this.database, tenantId, {
      ...input,
      recordedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public createSalesLead(tenantId: VerifiedTenantId, input: WriterInput<'createSalesLead'>) {
    return this.repository.createSalesLead(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public createSalesOfferVersion(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createSalesOfferVersion'>,
  ) {
    return this.repository.createSalesOfferVersion(this.database, tenantId, {
      ...input,
      createdBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public qualifySalesLead(tenantId: VerifiedTenantId, input: WriterInput<'qualifySalesLead'>) {
    return this.repository.qualifySalesLead(this.database, tenantId, {
      ...input,
      qualifiedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public createSalesQuote(tenantId: VerifiedTenantId, input: WriterInput<'createSalesQuote'>) {
    return this.repository.createSalesQuote(this.database, tenantId, {
      ...input,
      createdBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public approveSalesQuote(tenantId: VerifiedTenantId, input: WriterInput<'approveSalesQuote'>) {
    return this.repository.approveSalesQuote(this.database, tenantId, {
      ...input,
      approvedBy: input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public acceptSalesQuote(tenantId: VerifiedTenantId, input: WriterInput<'acceptSalesQuote'>) {
    return this.repository.acceptSalesQuote(this.database, tenantId, {
      ...input,
      ownerId: input.ownerId ?? input.actorId,
      authorization: this.sign(tenantId, input),
    });
  }

  public convertSalesOrderSubscriber(
    tenantId: VerifiedTenantId,
    input: WriterInput<'convertSalesOrderSubscriber'>,
  ) {
    return this.repository.convertSalesOrderSubscriber(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public createCapacityResource(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createCapacityResource'>,
  ) {
    return this.repository.createCapacityResource(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public reserveSalesOrderResource(
    tenantId: VerifiedTenantId,
    input: WriterInput<'reserveSalesOrderResource'>,
  ) {
    return this.repository.reserveSalesOrderResource(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public createSalesOrderInstallation(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createSalesOrderInstallation'>,
  ) {
    return this.repository.createSalesOrderInstallation(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public enqueueSalesOrderActivation(
    tenantId: VerifiedTenantId,
    input: WriterInput<'enqueueSalesOrderActivation'>,
  ) {
    return this.repository.enqueueSalesOrderActivation(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      actorId: input.actorId,
    });
  }

  public executeSalesOrderCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeSalesOrderCommand'>,
  ) {
    return this.repository.executeSalesOrderCommand(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      actorId: input.actorId,
    });
  }

  public postSalesOrderFirstInvoice(
    tenantId: VerifiedTenantId,
    input: WriterInput<'postSalesOrderFirstInvoice'>,
  ) {
    return this.repository.postSalesOrderFirstInvoice(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      actorId: input.actorId,
    });
  }

  public createSubscriber(tenantId: VerifiedTenantId, input: WriterInput<'createSubscriber'>) {
    return this.repository.createSubscriber(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public prepareBilling(tenantId: VerifiedTenantId, input: WriterInput<'prepareBilling'>) {
    return this.repository.prepareRecurringInvoices(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      requestedBy: input.actorId,
    });
  }

  public createDunningPolicyVersion(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createDunningPolicyVersion'>,
  ) {
    return this.repository.createDunningPolicyVersion(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      createdBy: input.actorId,
    });
  }

  public evaluateDunning(tenantId: VerifiedTenantId, input: WriterInput<'evaluateDunning'>) {
    return this.repository.evaluateDunning(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      requestedBy: input.actorId,
    });
  }

  public recordOfficePayment(
    tenantId: VerifiedTenantId,
    input: WriterInput<'recordOfficePayment'>,
  ) {
    return this.repository.recordOfficePaymentRequest(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      requestedBy: input.actorId,
    });
  }

  public recordPaymentCorrection(
    tenantId: VerifiedTenantId,
    input: WriterInput<'recordPaymentCorrection'>,
  ) {
    return this.repository.recordOfficePaymentCorrection(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      actorId: input.actorId,
    });
  }

  public createPlanVersion(tenantId: VerifiedTenantId, input: WriterInput<'createPlanVersion'>) {
    return this.repository.createOperationsPlanVersion(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      createdBy: input.actorId,
    });
  }

  public createBillingPolicyVersion(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createBillingPolicyVersion'>,
  ) {
    return this.repository.createBillingPolicyVersion(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      createdBy: input.actorId,
    });
  }

  public createServiceInstallation(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createServiceInstallation'>,
  ) {
    return this.repository.createServiceInstallation(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public assignCollector(tenantId: VerifiedTenantId, input: WriterInput<'assignCollector'>) {
    return this.repository.assignCollectorInvoice(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public recordCollectorEvidence(
    tenantId: VerifiedTenantId,
    input: WriterInput<'recordCollectorEvidence'>,
  ) {
    return this.repository.recordCollectorEvidence(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      recordedBy: input.actorId,
    });
  }

  public reconcileCollector(tenantId: VerifiedTenantId, input: WriterInput<'reconcileCollector'>) {
    return this.repository.reconcileCollector(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      reconciledBy: input.actorId,
    });
  }

  public transitionInstallation(
    tenantId: VerifiedTenantId,
    input: WriterInput<'transitionInstallation'>,
  ) {
    return this.repository.transitionInstallation(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      toStatus: input.toStatus as Parameters<typeof transitionInstallation>[2]['toStatus'],
      actorId: input.actorId,
    });
  }

  public createIssue(tenantId: VerifiedTenantId, input: WriterInput<'createIssue'>) {
    return this.repository.createSupportIssue(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
    });
  }

  public transitionIssue(tenantId: VerifiedTenantId, input: WriterInput<'transitionIssue'>) {
    return this.repository.transitionSupportIssue(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      toStatus: input.toStatus as Parameters<typeof transitionSupportIssue>[2]['toStatus'],
      actorId: input.actorId,
    });
  }

  public requestExport(tenantId: VerifiedTenantId, input: WriterInput<'requestExport'>) {
    return this.repository.requestOperationsExport(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      requestedBy: input.actorId,
    });
  }

  public configure(tenantId: VerifiedTenantId, input: WriterInput<'configure'>) {
    return this.repository.configureOperations(this.database, tenantId, {
      ...input,
      authorization: this.sign(tenantId, input),
      updatedBy: input.actorId,
    });
  }

  public enqueueNetworkAction(
    tenantId: VerifiedTenantId,
    input: WriterInput<'enqueueNetworkAction'>,
  ) {
    const authorization = this.sign(tenantId, input);
    return this.repository.enqueueSubscriberNetworkAction(this.database, tenantId, {
      serviceId: input.serviceId,
      action: input.action,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.actorId,
      authorization,
    });
  }

  public readChartOfAccounts(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readChartOfAccounts'>,
  ) {
    return this.repository.readChartOfAccounts(this.database, tenantId, this.sign(tenantId, input));
  }

  public postJournalEntry(tenantId: VerifiedTenantId, input: WriterInput<'postJournalEntry'>) {
    return this.repository.postJournalEntry(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readJournalEntries(tenantId: VerifiedTenantId, input: WriterInput<'readJournalEntries'>) {
    return this.repository.readJournalEntries(this.database, tenantId, this.sign(tenantId, input));
  }

  public readCustomerStatement(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readCustomerStatement'>,
  ) {
    return this.repository.readCustomerStatement(
      this.database,
      tenantId,
      this.sign(tenantId, input),
      input.query,
    );
  }

  public readTrialBalance(tenantId: VerifiedTenantId, input: WriterInput<'readTrialBalance'>) {
    return this.repository.readTrialBalance(
      this.database,
      tenantId,
      this.sign(tenantId, input),
      input.asOfDate,
    );
  }

  public readAccountingPeriods(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readAccountingPeriods'>,
  ) {
    return this.repository.readAccountingPeriods(
      this.database,
      tenantId,
      this.sign(tenantId, input),
    );
  }

  public closeAccountingPeriod(
    tenantId: VerifiedTenantId,
    input: WriterInput<'closeAccountingPeriod'>,
  ) {
    return this.repository.closeAccountingPeriod(this.database, tenantId, {
      request: input.request,
      authorization: this.sign(tenantId, input),
    });
  }

  public readDashboardSnapshot(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readDashboardSnapshot'>,
  ) {
    return this.repository.readDashboardSnapshot(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public readReportsWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readReportsWorkspace'>,
  ) {
    return this.repository.readReportsWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public readReportDataset(tenantId: VerifiedTenantId, input: WriterInput<'readReportDataset'>) {
    const { key, ...window } = input.query ?? {};
    if (!key) throw new Error('A report key is required.');
    return this.repository.readReportDataset(this.database, tenantId, {
      key,
      query: window,
      authorization: this.sign(tenantId, input),
    });
  }

  /** Renders the dataset as CSV and records the export as a completed job. */
  public async exportReport(tenantId: VerifiedTenantId, input: WriterInput<'exportReport'>) {
    const dataset = await this.repository.readReportDataset(this.database, tenantId, {
      key: input.command.key,
      query: {
        ...(input.command.from ? { from: input.command.from } : {}),
        ...(input.command.to ? { to: input.command.to } : {}),
      },
      authorization: this.sign(tenantId, {
        ...input,
        permission: 'tenant.report.export',
        auditAction: 'tenant.report.read',
        idempotencyKey: `${input.idempotencyKey}:read`,
      }),
    });
    const csv = renderCsv(dataset.rows);
    const job = await this.repository.recordReportExport(this.database, tenantId, {
      command: input.command,
      rows: dataset.rows.length,
      authorization: this.sign(tenantId, input),
    });
    return {
      ...job,
      rows: dataset.rows.length,
      filename: `${input.command.key}-${dataset.from}-${dataset.to}.csv`,
      csv,
    };
  }

  public readSupportWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readSupportWorkspace'>,
  ) {
    return this.repository.readSupportWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeSupportCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeSupportCommand'>,
  ) {
    return this.repository.executeSupportCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readCommunicationsWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readCommunicationsWorkspace'>,
  ) {
    return this.repository.readCommunicationsWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public executeTemplateCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeTemplateCommand'>,
  ) {
    return this.repository.executeTemplateCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeCommunicationCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeCommunicationCommand'>,
  ) {
    return this.repository.executeCommunicationCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  /**
   * One delivery pass over the queued notifications: each due message is sent through the
   * tenant's configured provider for its channel and the outcome is recorded on the message
   * with a deterministic key per attempt, so a repeated pass never double-sends.
   */
  public async deliverNotifications(
    tenantId: VerifiedTenantId,
    input: WriterInput<'deliverNotifications'>,
  ): Promise<DeliveryPassResult> {
    const runtime = this.requireIntegrations();
    const queued = await this.repository.readQueuedNotifications(this.database, tenantId, {
      authorization: this.sign(tenantId, {
        ...input,
        idempotencyKey: `${input.idempotencyKey}:read`,
      }),
      limit: input.command.limit,
    });
    const settings = new Map<'smtp' | 'sms' | 'whatsapp', StoredIntegrationDelivery | null>();
    const stored = async (kind: 'smtp' | 'sms' | 'whatsapp') => {
      if (!settings.has(kind)) {
        settings.set(
          kind,
          await this.repository.readTenantIntegrationDelivery(
            this.database,
            tenantId,
            this.sign(tenantId, {
              ...input,
              idempotencyKey: `${input.idempotencyKey}:settings:${kind}`,
            }),
            kind,
          ),
        );
      }
      return settings.get(kind) ?? null;
    };
    const result = {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: [] as { notificationId: string; reason: string }[],
    };
    for (const message of queued) {
      const kind = message.channel === 'email' ? 'smtp' : message.channel;
      const provider = await stored(kind);
      if (!provider) {
        result.skipped.push({ notificationId: message.id, reason: `no active ${kind} provider` });
        continue;
      }
      result.attempted += 1;
      const outcome = await performIntegrationTest(runtime, provider, message.destination, {
        mail: {
          subject: message.subject ?? 'Orvex ISP',
          text: message.body,
          html: `<p>${escapeHtml(message.body).replace(/\n/gu, '<br />')}</p>`,
        },
        text: message.body,
      }).catch((error: unknown) => ({
        status: 'failed' as const,
        message: error instanceof Error ? error.message.slice(0, 500) : 'delivery failed',
        recipientMasked: '',
      }));
      await this.repository.markNotificationDelivery(this.database, tenantId, {
        command: {
          action: 'mark_delivery',
          notificationId: message.id,
          expectedVersion: message.version,
          outcome: outcome.status === 'passed' ? 'sent' : 'failed',
          ...(outcome.status === 'passed' && outcome.providerReference
            ? { providerReference: outcome.providerReference }
            : {}),
          ...(outcome.status === 'failed' ? { error: outcome.message } : {}),
        },
        authorization: this.sign(tenantId, {
          ...input,
          idempotencyKey: `notification-delivery:${message.id}:${message.version}`,
        }),
      });
      if (outcome.status === 'passed') result.sent += 1;
      else result.failed += 1;
    }
    return result;
  }

  public readAssuranceWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readAssuranceWorkspace'>,
  ) {
    return this.repository.readAssuranceWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeAssuranceCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeAssuranceCommand'>,
  ) {
    return this.repository.executeAssuranceCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readDealerWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readDealerWorkspace'>,
  ) {
    return this.repository.readDealerWorkspace(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
    });
  }

  public readRegulatoryWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readRegulatoryWorkspace'>,
  ) {
    return this.repository.readRegulatoryWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeRegulatoryCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeRegulatoryCommand'>,
  ) {
    return this.repository.executeRegulatoryCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readPeopleWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readPeopleWorkspace'>,
  ) {
    return this.repository.readPeopleWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executePeopleCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executePeopleCommand'>,
  ) {
    return this.repository.executePeopleCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readCashierWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readCashierWorkspace'>,
  ) {
    return this.repository.readCashierWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeCashierCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeCashierCommand'>,
  ) {
    return this.repository.executeCashierCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public voidReceipt(tenantId: VerifiedTenantId, input: WriterInput<'voidReceipt'>) {
    return this.repository.voidReceipt(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readCollectionsWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readCollectionsWorkspace'>,
  ) {
    return this.repository.readCollectionsWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeCollectionCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeCollectionCommand'>,
  ) {
    return this.repository.executeCollectionCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public recordCollection(tenantId: VerifiedTenantId, input: WriterInput<'recordCollection'>) {
    return this.repository.recordCollection(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeDealerChannelCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeDealerChannelCommand'>,
  ) {
    return this.repository.executeDealerChannelCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public generateVoucherBatch(
    tenantId: VerifiedTenantId,
    input: WriterInput<'generateVoucherBatch'>,
  ) {
    return this.repository.generateVoucherBatch(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public adjustDealerBalance(
    tenantId: VerifiedTenantId,
    input: WriterInput<'adjustDealerBalance'>,
  ) {
    return this.repository.adjustDealerBalance(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  /**
   * Voucher redemption is a three-step saga with visible state: the voucher is marked redeemed
   * (atomic, PIN-guarded), the subscriber deposit is posted through the customer account ledger
   * under its own signed action, and the redemption is confirmed against that entry. Every step
   * carries a deterministic idempotency key, so a retry after a partial failure completes the
   * same redemption instead of creating another.
   */
  public async redeemVoucher(tenantId: VerifiedTenantId, input: WriterInput<'redeemVoucher'>) {
    const redeemed = await this.repository.redeemVoucherForSubscriber(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
    if (redeemed.creditStatus === 'credited') return redeemed;
    const credit = await this.creditRedemption(tenantId, input, {
      redemptionId: redeemed.redemptionId,
      serialNumber: redeemed.serialNumber,
      subscriberId: redeemed.subscriberId,
      amountMinor: redeemed.amountMinor,
      currency: redeemed.currency,
    });
    return { ...redeemed, creditStatus: 'credited', accountEntryId: credit.accountEntryId };
  }

  /** Completes the subscriber credit for a redemption whose posting failed earlier. */
  public async retryVoucherCredit(
    tenantId: VerifiedTenantId,
    input: WriterInput<'retryVoucherCredit'>,
  ) {
    const pending = await this.repository.readPendingVoucherRedemption(this.database, tenantId, {
      authorization: this.sign(tenantId, input),
      redemptionId: input.command.redemptionId,
    });
    if (pending.status === 'credited') {
      return {
        redemptionId: pending.id,
        creditStatus: 'credited',
        accountEntryId: pending.accountEntryId,
      };
    }
    const credit = await this.creditRedemption(tenantId, input, {
      redemptionId: pending.id,
      serialNumber: pending.serialNumber,
      subscriberId: pending.subscriberId,
      amountMinor: pending.amountMinor,
      currency: pending.currency,
    });
    return {
      redemptionId: pending.id,
      creditStatus: 'credited',
      accountEntryId: credit.accountEntryId,
    };
  }

  private async creditRedemption(
    tenantId: VerifiedTenantId,
    input: OperationsMutationContext & {
      readonly command: { readonly reasonEn: string; readonly reasonAr: string };
    },
    redemption: {
      readonly redemptionId: string;
      readonly serialNumber: string;
      readonly subscriberId: string;
      readonly amountMinor: number;
      readonly currency: 'USD' | 'LBP';
    },
  ) {
    const reasonEn = input.command.reasonEn.slice(0, 500);
    const reasonAr = input.command.reasonAr.slice(0, 500);
    const entry = await this.repository.postCustomerAccountEntry(this.database, tenantId, {
      command: {
        kind: 'deposit_received',
        subscriberId: redemption.subscriberId,
        currency: redemption.currency,
        amountMinor: redemption.amountMinor,
        documentNumber: `VCH-${redemption.serialNumber}`,
        sourceReference: `VOUCHER:${redemption.serialNumber}`,
        reasonEn,
        reasonAr,
      },
      authorization: this.sign(tenantId, {
        ...input,
        permission: 'tenant.payment.post',
        auditAction: 'tenant.customer_account.deposit_received',
        idempotencyKey: `voucher-credit:${redemption.redemptionId}`,
      }),
    });
    await this.repository.confirmVoucherCredit(this.database, tenantId, {
      command: {
        redemptionId: redemption.redemptionId,
        accountEntryId: entry.id,
        reasonEn: input.command.reasonEn,
        reasonAr: input.command.reasonAr,
      },
      authorization: this.sign(tenantId, {
        ...input,
        permission: 'tenant.payment.post',
        auditAction: 'tenant.dealer.channel.manage',
        idempotencyKey: `voucher-confirm:${redemption.redemptionId}`,
      }),
    });
    return { accountEntryId: entry.id };
  }

  public readWarehouses(tenantId: VerifiedTenantId, input: WriterInput<'readWarehouses'>) {
    return this.repository.readWarehouses(this.database, tenantId, this.sign(tenantId, input));
  }

  public readInventoryItems(tenantId: VerifiedTenantId, input: WriterInput<'readInventoryItems'>) {
    return this.repository.readInventoryItems(this.database, tenantId, this.sign(tenantId, input));
  }

  public readSerializedAssets(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readSerializedAssets'>,
  ) {
    return this.repository.readSerializedAssets(
      this.database,
      tenantId,
      this.sign(tenantId, input),
    );
  }

  public readWarehouseWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readWarehouseWorkspace'>,
  ) {
    return this.repository.readWarehouseWorkspace(
      this.database,
      tenantId,
      this.sign(tenantId, input),
    );
  }

  public transitionInventoryCustody(
    tenantId: VerifiedTenantId,
    input: WriterInput<'transitionInventoryCustody'>,
  ) {
    return this.repository.transitionInventoryCustody(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeProcurementCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeProcurementCommand'>,
  ) {
    return this.repository.executeProcurementCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeWarehouseAdminCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeWarehouseAdminCommand'>,
  ) {
    return this.repository.executeWarehouseAdminCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeStockCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeStockCommand'>,
  ) {
    return this.repository.executeStockCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeStockReservationCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeStockReservationCommand'>,
  ) {
    return this.repository.executeStockReservationCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeStockCountCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeStockCountCommand'>,
  ) {
    return this.repository.executeStockCountCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeRmaCommand(tenantId: VerifiedTenantId, input: WriterInput<'executeRmaCommand'>) {
    return this.repository.executeRmaCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeVendorQuoteCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeVendorQuoteCommand'>,
  ) {
    return this.repository.executeVendorQuoteCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readFieldServiceWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readFieldServiceWorkspace'>,
  ) {
    return this.repository.readFieldServiceWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeFieldDispatchCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeFieldDispatchCommand'>,
  ) {
    return this.repository.executeFieldServiceCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeFieldExecutionCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeFieldExecutionCommand'>,
  ) {
    return this.repository.executeFieldServiceCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readNetworkWorkspace(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readNetworkWorkspace'>,
  ) {
    return this.repository.readNetworkWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public executeNetworkInfrastructureCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeNetworkInfrastructureCommand'>,
  ) {
    return this.repository.executeNetworkCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeNocAlarmCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeNocAlarmCommand'>,
  ) {
    return this.repository.executeNocAlarmCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public executeNetworkResourceCommand(
    tenantId: VerifiedTenantId,
    input: WriterInput<'executeNetworkResourceCommand'>,
  ) {
    return this.repository.executeNetworkCommand(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }

  public readIntegrationSettings(
    tenantId: VerifiedTenantId,
    input: WriterInput<'readIntegrationSettings'>,
  ) {
    return this.repository.readTenantIntegrationSettings(
      this.database,
      tenantId,
      this.sign(tenantId, input),
    );
  }

  public configureIntegration(
    tenantId: VerifiedTenantId,
    input: WriterInput<'configureIntegration'>,
  ) {
    const runtime = this.requireIntegrations();
    const command = integrationConfigureCommandSchema.parse(input.command);
    const prepared = prepareIntegrationConfiguration(runtime, {
      kind: command.kind,
      config: command.config,
      ...(command.secrets ? { secrets: command.secrets } : {}),
      keepSecrets: command.keepSecrets,
      active: command.active,
      ...(command.expectedVersion !== undefined
        ? { expectedVersion: command.expectedVersion }
        : {}),
    });
    // The replayable payload carries a keyed fingerprint instead of the credential itself.
    return this.repository.executeIntegrationSettingsCommand(this.database, tenantId, {
      payload: {
        action: 'configure',
        kind: prepared.kind,
        config: prepared.config,
        active: prepared.active,
        keepProtected: prepared.keepSecrets,
        protectedFields: prepared.protectedFields,
        ...(prepared.cipherKeyId ? { cipherKeyId: prepared.cipherKeyId } : {}),
        ...(prepared.cipherFingerprint ? { cipherFingerprint: prepared.cipherFingerprint } : {}),
        ...(prepared.expectedVersion !== undefined
          ? { expectedVersion: prepared.expectedVersion }
          : {}),
        reasonEn: command.reasonEn,
        reasonAr: command.reasonAr,
        evidence: command.evidence,
      },
      ...(prepared.secretCiphertext ? { secretCiphertext: prepared.secretCiphertext } : {}),
      authorization: this.sign(tenantId, input),
    });
  }

  public async testIntegration(tenantId: VerifiedTenantId, input: WriterInput<'testIntegration'>) {
    const runtime = this.requireIntegrations();
    const command = input.command;
    const stored = await this.repository.readTenantIntegrationDelivery(
      this.database,
      tenantId,
      this.sign(tenantId, { ...input, idempotencyKey: `${input.idempotencyKey}:read` }),
      command.kind,
    );
    const occurredAt = this.now();
    const outcome = stored
      ? await performIntegrationTest(runtime, stored, command.recipient, {
          mail: integrationTestMail({ scope: 'tenant', requestedBy: input.actorId, occurredAt }),
          text: integrationTestText({ scope: 'tenant', occurredAt }),
        })
      : {
          status: 'failed' as const,
          message: `No active ${command.kind} settings are configured for this workspace.`,
          recipientMasked: command.recipient,
          errorCode: 'NOT_CONFIGURED',
        };
    return this.repository.executeIntegrationSettingsCommand(this.database, tenantId, {
      payload: {
        action: 'record_test',
        kind: command.kind,
        status: outcome.status,
        message: outcome.message,
        recipientMasked: outcome.recipientMasked,
        ...(outcome.providerReference ? { providerReference: outcome.providerReference } : {}),
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        reasonEn: command.reasonEn,
        reasonAr: command.reasonAr,
        evidence: command.evidence,
      },
      authorization: this.sign(tenantId, input),
    });
  }

  private requireIntegrations(): IntegrationRuntime {
    if (!this.integrations) {
      throw new Error('Integration settings are not available in this Operations runtime.');
    }
    return this.integrations;
  }

  public readNasClients(tenantId: VerifiedTenantId, input: WriterInput<'readNasClients'>) {
    return this.repository.readNasClients(this.database, tenantId, this.sign(tenantId, input));
  }

  public readRadiusSessions(tenantId: VerifiedTenantId, input: WriterInput<'readRadiusSessions'>) {
    return this.repository.readRadiusSessions(this.database, tenantId, this.sign(tenantId, input));
  }

  public readIpPools(tenantId: VerifiedTenantId, input: WriterInput<'readIpPools'>) {
    return this.repository.readIpPools(this.database, tenantId, this.sign(tenantId, input));
  }

  public readCpeDevices(tenantId: VerifiedTenantId, input: WriterInput<'readCpeDevices'>) {
    return this.repository.readCpeDevices(this.database, tenantId, this.sign(tenantId, input));
  }

  public readNetworkAlarms(tenantId: VerifiedTenantId, input: WriterInput<'readNetworkAlarms'>) {
    return this.repository.readNetworkAlarms(this.database, tenantId, this.sign(tenantId, input));
  }

  public readOutages(tenantId: VerifiedTenantId, input: WriterInput<'readOutages'>) {
    return this.repository.readOutages(this.database, tenantId, this.sign(tenantId, input));
  }

  public readQosReports(tenantId: VerifiedTenantId, input: WriterInput<'readQosReports'>) {
    return this.repository.readQosReports(this.database, tenantId, this.sign(tenantId, input));
  }

  public readNocWorkspace(tenantId: VerifiedTenantId, input: WriterInput<'readNocWorkspace'>) {
    return this.repository.readNocWorkspace(this.database, tenantId, {
      ...(input.query ? { query: input.query } : {}),
      authorization: this.sign(tenantId, input),
    });
  }
  public createOutageIncident(
    tenantId: VerifiedTenantId,
    input: WriterInput<'createOutageIncident'>,
  ) {
    return this.repository.createOutageIncident(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }
  public transitionOutageIncident(
    tenantId: VerifiedTenantId,
    input: WriterInput<'transitionOutageIncident'>,
  ) {
    return this.repository.transitionOutageIncident(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
  }
  private sign(
    tenantId: VerifiedTenantId,
    context: OperationsMutationContext,
  ): SignedOperationsDatabaseContext {
    const expiresAt = new Date(this.now().getTime() + 60_000).toISOString();
    const attestation: OperationsAttestation = {
      keyId: this.authority.keyId,
      tenantId,
      actorId: context.actorId,
      sessionId: context.sessionId,
      ...(context.supportGrantId ? { supportGrantId: context.supportGrantId } : {}),
      permission: context.permission,
      action: context.auditAction,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      reason: context.reason,
      idempotencyKey: context.idempotencyKey,
      ...(context.branchIds !== undefined ? { branchIds: context.branchIds } : {}),
      ...(context.areaIds !== undefined ? { areaIds: context.areaIds } : {}),
      ...(context.routeIds !== undefined ? { routeIds: context.routeIds } : {}),
      ...(context.recordIds !== undefined ? { recordIds: context.recordIds } : {}),
      expiresAt,
    };
    return signOperationsAttestation(attestation, this.authority.secret);
  }
}
