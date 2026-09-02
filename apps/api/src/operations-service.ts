import type { VerifiedTenantId } from '@isp/contracts';
import { createHash } from 'node:crypto';
import {
  readNocWorkspace,
  createOutageIncident,
  transitionOutageIncident,
  postCustomerAccountEntry,
  readCustomerAccounts,
  readChartOfAccounts,
  postJournalEntry,
  readJournalEntries,
  readCustomerStatement,
  readTrialBalance,
  readAccountingPeriods,
  closeAccountingPeriod,
  readDealers,
  generateVoucherBatch,
  redeemVoucher,
  readWarehouses,
  readInventoryItems,
  readSerializedAssets,
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
  readonly postCustomerAccountEntry: typeof postCustomerAccountEntry;
  readonly readCustomerAccounts: typeof readCustomerAccounts;
  readonly readChartOfAccounts: typeof readChartOfAccounts;
  readonly postJournalEntry: typeof postJournalEntry;
  readonly readJournalEntries: typeof readJournalEntries;
  readonly readCustomerStatement: typeof readCustomerStatement;
  readonly readTrialBalance: typeof readTrialBalance;
  readonly readAccountingPeriods: typeof readAccountingPeriods;
  readonly closeAccountingPeriod: typeof closeAccountingPeriod;
  readonly readDealers: typeof readDealers;
  readonly generateVoucherBatch: typeof generateVoucherBatch;
  readonly redeemVoucher: typeof redeemVoucher;
  readonly readWarehouses: typeof readWarehouses;
  readonly readInventoryItems: typeof readInventoryItems;
  readonly readSerializedAssets: typeof readSerializedAssets;
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
  postCustomerAccountEntry,
  readCustomerAccounts,
  readChartOfAccounts,
  postJournalEntry,
  readJournalEntries,
  readCustomerStatement,
  readTrialBalance,
  readAccountingPeriods,
  closeAccountingPeriod,
  readDealers,
  generateVoucherBatch,
  redeemVoucher,
  readWarehouses,
  readInventoryItems,
  readSerializedAssets,
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

  public readDealers(tenantId: VerifiedTenantId, input: WriterInput<'readDealers'>) {
    return this.repository.readDealers(this.database, tenantId, this.sign(tenantId, input));
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

  public redeemVoucher(tenantId: VerifiedTenantId, input: WriterInput<'redeemVoucher'>) {
    return this.repository.redeemVoucher(this.database, tenantId, {
      command: input.command,
      authorization: this.sign(tenantId, input),
    });
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
