export function parseAccountAmount(value: string, currency: 'USD' | 'LBP'): number {
  const pattern = currency === 'USD' ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/;
  if (!pattern.test(value)) throw new Error('Invalid monetary amount.');
  const [whole = '0', fraction = ''] = value.split('.');
  const minor =
    currency === 'USD' ? BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) : BigInt(whole);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Amount exceeds safe integer limit.');
  return Number(minor);
}
export function accountMoney(value: number, currency: 'USD' | 'LBP', locale: 'en' | 'ar'): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-LB' : 'ar-LB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(currency === 'USD' ? value / 100 : value);
}
