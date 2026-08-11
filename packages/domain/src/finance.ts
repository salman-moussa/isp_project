import type { Money } from '@isp/contracts';

export class FinanceRuleError extends Error {
  public readonly code = 'FINANCE_RULE_VIOLATION';

  public constructor(message: string) {
    super(message);
    this.name = 'FinanceRuleError';
  }
}

export function assertPositiveMoney(money: Money): void {
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor <= 0) {
    throw new FinanceRuleError('A posted financial amount must be a positive safe integer.');
  }
}

export function assertAllocationCurrency(allocation: Money, invoice: Money, payment: Money): void {
  assertPositiveMoney(allocation);
  assertPositiveMoney(invoice);
  assertPositiveMoney(payment);
  if (invoice.currency !== payment.currency || allocation.currency !== invoice.currency) {
    throw new FinanceRuleError(
      'An allocation must use the same currency as its invoice and payment.',
    );
  }
}

export function assertExactReversal(original: Money, reversal: Money): void {
  assertPositiveMoney(original);
  assertPositiveMoney(reversal);
  if (original.currency !== reversal.currency || original.amountMinor !== reversal.amountMinor) {
    throw new FinanceRuleError('A reversal must preserve the original amount and currency.');
  }
}
