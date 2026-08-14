export type OperationsCurrency = 'USD' | 'LBP';

export type TaxRoundingMode = 'half_up' | 'down' | 'up';

export interface EffectiveBillingPolicy {
  readonly id: string;
  readonly vatRateBasisPoints: number;
  readonly roundingMode: TaxRoundingMode;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

export interface InvoicePreparationInput {
  readonly amountMinor: number;
  readonly currency: OperationsCurrency;
  readonly billingDate: Date;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly policy: EffectiveBillingPolicy;
}

export interface PreparedInvoiceAmounts {
  readonly subtotalMinor: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
  readonly currency: OperationsCurrency;
  readonly billingPolicyId: string;
}

export function prepareInvoiceAmounts(input: InvoicePreparationInput): PreparedInvoiceAmounts {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new RangeError('Invoice subtotal must be a positive safe integer.');
  }
  if (input.periodEnd <= input.periodStart) {
    throw new RangeError('Invoice period end must be after period start.');
  }
  if (input.billingDate < input.periodStart || input.billingDate >= input.periodEnd) {
    throw new RangeError('The billing date must be inside the half-open billing period.');
  }
  const { policy } = input;
  if (
    !Number.isInteger(policy.vatRateBasisPoints) ||
    policy.vatRateBasisPoints < 0 ||
    policy.vatRateBasisPoints > 10_000
  ) {
    throw new RangeError('The effective VAT policy is invalid.');
  }
  if (
    input.billingDate < policy.effectiveFrom ||
    (policy.effectiveTo !== undefined && input.billingDate >= policy.effectiveTo)
  ) {
    throw new RangeError('The billing policy is not effective on the billing date.');
  }

  const numerator = input.amountMinor * policy.vatRateBasisPoints;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('VAT calculation exceeds safe range.');
  const vatMinor = roundTax(numerator, policy.roundingMode);
  const totalMinor = input.amountMinor + vatMinor;
  if (!Number.isSafeInteger(totalMinor)) throw new RangeError('Invoice total exceeds safe range.');
  return {
    subtotalMinor: input.amountMinor,
    vatMinor,
    totalMinor,
    currency: input.currency,
    billingPolicyId: policy.id,
  };
}

function roundTax(numerator: number, mode: TaxRoundingMode): number {
  const whole = Math.trunc(numerator / 10_000);
  const remainder = numerator % 10_000;
  if (mode === 'down' || remainder === 0) return whole;
  if (mode === 'up') return whole + 1;
  return whole + (remainder >= 5_000 ? 1 : 0);
}

export interface AssignmentAmount {
  readonly amountMinor: number;
  readonly currency: OperationsCurrency;
}

export interface PostedCollectionEvidence {
  readonly amountMinor: number;
  readonly currency: OperationsCurrency;
}

export interface ReconciliationTotals {
  readonly currency: OperationsCurrency;
  readonly expectedMinor: number;
  readonly declaredMinor: number;
  readonly differenceMinor: number;
}

export function deriveCollectorReconciliation(
  currency: OperationsCurrency,
  assignments: readonly AssignmentAmount[],
  evidence: readonly PostedCollectionEvidence[],
): ReconciliationTotals {
  const expectedMinor = sumCurrency(assignments, currency);
  const declaredMinor = sumCurrency(evidence, currency);
  return { currency, expectedMinor, declaredMinor, differenceMinor: declaredMinor - expectedMinor };
}

function sumCurrency(
  values: readonly { readonly amountMinor: number; readonly currency: OperationsCurrency }[],
  currency: OperationsCurrency,
): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0) {
      throw new RangeError('Reconciliation evidence must use non-negative safe integers.');
    }
    if (value.currency !== currency) continue;
    total += value.amountMinor;
    if (!Number.isSafeInteger(total))
      throw new RangeError('Reconciliation total exceeds safe range.');
  }
  return total;
}

export function assertSingleCurrency(
  invoiceCurrency: OperationsCurrency,
  paymentCurrency: OperationsCurrency,
): void {
  if (invoiceCurrency !== paymentCurrency) {
    throw new Error('Payment allocation cannot cross USD and LBP balances.');
  }
}
