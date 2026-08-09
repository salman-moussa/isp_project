import type { Money, SupportedCurrency } from '@isp/contracts';

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error('Currency conversion requires an explicit authorized exchange basis.');
  }
  const amountMinor = left.amountMinor + right.amountMinor;
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Money arithmetic exceeded the safe integer range.');
  }
  return { amountMinor, currency: left.currency };
}

export function groupMoney(values: readonly Money[]): Record<SupportedCurrency, number> {
  return values.reduce<Record<SupportedCurrency, number>>(
    (totals, item) => {
      const sum = addMoney({ amountMinor: totals[item.currency], currency: item.currency }, item);
      return { ...totals, [item.currency]: sum.amountMinor };
    },
    { USD: 0, LBP: 0 },
  );
}
