import type { Money, SupportedCurrency } from '@isp/contracts';

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error('Currency conversion requires an explicit authorized exchange basis.');
  }
  return { amountMinor: left.amountMinor + right.amountMinor, currency: left.currency };
}

export function groupMoney(values: readonly Money[]): Record<SupportedCurrency, number> {
  return values.reduce<Record<SupportedCurrency, number>>(
    (totals, item) => ({ ...totals, [item.currency]: totals[item.currency] + item.amountMinor }),
    { USD: 0, LBP: 0 },
  );
}
