import type { VerifiedTenantId } from '@isp/contracts';
import {
  assignCollectorInvoice,
  acceptSalesQuote,
  approveSalesQuote,
  configureOperations,
  convertSalesOrderSubscriber,
  createCapacityResource,
  createBillingPolicyVersion,
  createSalesLead,
  createSalesOfferVersion,
  createSalesQuote,
  createOperationsPlanVersion,
  createServiceInstallation,
  createSubscriber,
  createSupportIssue,
  enqueueSubscriberNetworkAction,
  prepareRecurringInvoices,
  qualifySalesLead,
  readSalesWorkspace,
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

type WriterInput<Key extends keyof OperationsWriter> = Parameters<OperationsWriter[Key]>[1];

export interface OperationsContextAuthorityConfig {
  readonly keyId: string;
  readonly secret: Uint8Array;
}

export interface OperationsRepositoryAdapter {
  readonly readSalesWorkspace: typeof readSalesWorkspace;
  readonly createSalesLead: typeof createSalesLead;
  readonly createSalesOfferVersion: typeof createSalesOfferVersion;
  readonly qualifySalesLead: typeof qualifySalesLead;
  readonly createSalesQuote: typeof createSalesQuote;
  readonly approveSalesQuote: typeof approveSalesQuote;
  readonly acceptSalesQuote: typeof acceptSalesQuote;
  readonly convertSalesOrderSubscriber: typeof convertSalesOrderSubscriber;
  readonly createCapacityResource: typeof createCapacityResource;
  readonly reserveSalesOrderResource: typeof reserveSalesOrderResource;
  readonly createSubscriber: typeof createSubscriber;
  readonly prepareRecurringInvoices: typeof prepareRecurringInvoices;
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
  readSalesWorkspace,
  createSalesLead,
  createSalesOfferVersion,
  qualifySalesLead,
  createSalesQuote,
  approveSalesQuote,
  acceptSalesQuote,
  convertSalesOrderSubscriber,
  createCapacityResource,
  reserveSalesOrderResource,
  createSubscriber,
  prepareRecurringInvoices,
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
  ) {}

  public readSalesWorkspace(tenantId: VerifiedTenantId, input: WriterInput<'readSalesWorkspace'>) {
    return this.repository.readSalesWorkspace(this.database, tenantId, {
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
