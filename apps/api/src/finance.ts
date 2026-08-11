import type { SupportedCurrency, VerifiedTenantId } from '@isp/contracts';

export interface FinanceDocumentResult {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly entryKind: 'posted' | 'reversal';
  readonly number: string;
  readonly reversesId?: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly postedAt: string;
}

export interface FinanceAllocationResult {
  readonly id: string;
  readonly tenantId: VerifiedTenantId;
  readonly entryKind: 'allocation' | 'reversal';
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly reversesId?: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly postedAt: string;
}

export interface FinanceWriter {
  postInvoice(
    tenantId: VerifiedTenantId,
    input: FinanceDocumentWrite,
  ): Promise<FinanceDocumentResult>;
  reverseInvoice(
    tenantId: VerifiedTenantId,
    input: FinanceDocumentReversal,
  ): Promise<FinanceDocumentResult>;
  postPayment(
    tenantId: VerifiedTenantId,
    input: FinanceDocumentWrite,
  ): Promise<FinanceDocumentResult>;
  reversePayment(
    tenantId: VerifiedTenantId,
    input: FinanceDocumentReversal,
  ): Promise<FinanceDocumentResult>;
  allocate(
    tenantId: VerifiedTenantId,
    input: FinanceAllocationWrite,
  ): Promise<FinanceAllocationResult>;
  reverseAllocation(
    tenantId: VerifiedTenantId,
    input: FinanceAllocationReversal,
  ): Promise<FinanceAllocationResult>;
}

export interface FinanceDocumentWrite {
  readonly number: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceMutationAuditContext;
}

export interface FinanceMutationAuditContext {
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly permission: string;
  readonly reason: string;
}

export interface FinanceDocumentReversal {
  readonly originalId: string;
  readonly reversalNumber: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceMutationAuditContext;
}

export interface FinanceAllocationWrite {
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: SupportedCurrency;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceMutationAuditContext;
}

export interface FinanceAllocationReversal {
  readonly originalId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly postedAt: Date;
  readonly audit: FinanceMutationAuditContext;
}

export class UnconfiguredFinanceWriter implements FinanceWriter {
  private unavailable(): never {
    throw new Error('The finance writer is not configured.');
  }

  public async postInvoice(): Promise<FinanceDocumentResult> {
    return this.unavailable();
  }
  public async reverseInvoice(): Promise<FinanceDocumentResult> {
    return this.unavailable();
  }
  public async postPayment(): Promise<FinanceDocumentResult> {
    return this.unavailable();
  }
  public async reversePayment(): Promise<FinanceDocumentResult> {
    return this.unavailable();
  }
  public async allocate(): Promise<FinanceAllocationResult> {
    return this.unavailable();
  }
  public async reverseAllocation(): Promise<FinanceAllocationResult> {
    return this.unavailable();
  }
}
