import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function collectPayloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function safeCollectInteger(value: string | number): number {
  const converted = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(converted)) throw new RangeError('Collect amount exceeds safe range.');
  return converted;
}
