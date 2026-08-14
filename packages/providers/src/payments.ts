import { BaseFakeProvider } from './base.js';
import { ProviderError, type ProviderConfiguration, type ProviderRequestContext } from './types.js';

export interface ManualTransferEvidence {
  readonly externalReference: string;
  readonly proofAttachmentId: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly receivedAt: string;
}

export interface PaymentVerification {
  readonly state: 'pending_manual_review' | 'verified' | 'rejected';
  readonly providerReference: string;
  readonly source: 'manual' | 'fake';
  readonly safeMessage: string;
}

export interface MoneyTransferProvider {
  submitEvidence(
    evidence: ManualTransferEvidence,
    context: ProviderRequestContext,
  ): Promise<PaymentVerification>;
}

export class ManualMoneyTransferProvider extends BaseFakeProvider implements MoneyTransferProvider {
  constructor(configuration: ProviderConfiguration) {
    if (configuration.kind !== 'omt' && configuration.kind !== 'whish') {
      throw new ProviderError(
        'configuration',
        false,
        'Manual transfer adapter only supports OMT or Whish.',
      );
    }
    super(
      configuration,
      [
        {
          id: 'official-contract',
          label: 'Signed official provider contract',
          required: true,
          satisfied: false,
        },
        {
          id: 'official-docs',
          label: 'Current official API documentation',
          required: true,
          satisfied: false,
        },
        {
          id: 'sandbox-credentials',
          label: 'Sandbox credentials in secret manager',
          required: true,
          satisfied: false,
        },
        {
          id: 'webhook-key',
          label: 'Webhook signing secret reference',
          required: true,
          satisfied: false,
        },
        {
          id: 'reconciliation',
          label: 'Settlement reconciliation approved',
          required: true,
          satisfied: false,
        },
      ],
      'Live verification is disabled until an official contract, documentation and credentials exist.',
    );
  }

  async submitEvidence(
    evidence: ManualTransferEvidence,
    context?: ProviderRequestContext,
  ): Promise<PaymentVerification> {
    void context;
    this.assertOperational();
    if (
      evidence.externalReference.trim().length < 4 ||
      evidence.proofAttachmentId.trim().length === 0
    ) {
      throw new ProviderError(
        'invalid_request',
        false,
        'Transfer reference and proof are required.',
      );
    }
    if (!Number.isSafeInteger(evidence.amountMinor) || evidence.amountMinor <= 0) {
      throw new ProviderError(
        'invalid_request',
        false,
        'Transfer amount must be positive integer minor units.',
      );
    }
    return {
      state: 'pending_manual_review',
      providerReference: evidence.externalReference,
      source: 'manual',
      safeMessage: 'Evidence recorded for authorized manual review.',
    };
  }
}

export class FakeMoneyTransferProvider extends BaseFakeProvider implements MoneyTransferProvider {
  async submitEvidence(
    evidence: ManualTransferEvidence,
    context?: ProviderRequestContext,
  ): Promise<PaymentVerification> {
    void context;
    this.assertOperational();
    if (!Number.isSafeInteger(evidence.amountMinor) || evidence.amountMinor <= 0) {
      throw new ProviderError(
        'invalid_request',
        false,
        'Transfer amount must be positive integer minor units.',
      );
    }
    return {
      state: evidence.externalReference.startsWith('REJECT-') ? 'rejected' : 'verified',
      providerReference: evidence.externalReference,
      source: 'fake',
      safeMessage: 'Fake provider produced a deterministic verification result.',
    };
  }
}

export interface PaymentChargeRequest {
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly paymentMethodTokenReference: `secret://${string}`;
}

export interface PaymentChargeResult {
  readonly state: 'authorized' | 'declined';
  readonly providerReference: string;
}

export class FakeCardPaymentProvider extends BaseFakeProvider {
  constructor(configuration: ProviderConfiguration) {
    if (configuration.kind !== 'pos' && configuration.kind !== 'online_payment') {
      throw new ProviderError(
        'configuration',
        false,
        'Card adapter requires POS or online payment kind.',
      );
    }
    super(configuration);
  }

  async charge(
    request: PaymentChargeRequest,
    context: ProviderRequestContext,
  ): Promise<PaymentChargeResult> {
    this.assertOperational();
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
      throw new ProviderError(
        'invalid_request',
        false,
        'Charge amount must be positive integer minor units.',
      );
    }
    return {
      state: context.idempotencyKey.startsWith('decline-') ? 'declined' : 'authorized',
      providerReference: `fake-${context.idempotencyKey}`,
    };
  }
}

export interface BankImportRow {
  readonly bookingDate: string;
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
}

export class FakeBankImportProvider extends BaseFakeProvider {
  async parse(rows: readonly BankImportRow[]): Promise<readonly BankImportRow[]> {
    this.assertOperational();
    const seen = new Set<string>();
    return rows.map((row) => {
      if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor === 0) {
        throw new ProviderError(
          'invalid_request',
          false,
          'Bank amounts require non-zero integer minor units.',
        );
      }
      const key = `${row.bookingDate}:${row.reference}:${row.amountMinor}:${row.currency}`;
      if (seen.has(key))
        throw new ProviderError('invalid_request', false, 'Duplicate bank import row.');
      seen.add(key);
      return Object.freeze({ ...row });
    });
  }
}
