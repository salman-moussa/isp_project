import { describe, expect, it } from 'vitest';
import { bidiTextRuns, wrapInvoiceText } from './bidi-text.js';
describe('bilingual invoice line layout', () => {
  it('preserves Latin identifiers and digits inside RTL text', () => {
    const runs = bidiTextRuns('عنوان Block A-123 بيروت');
    expect(runs).toContain('Block A-123');
    expect(runs.join('')).not.toContain('321-A');
    expect(runs[0]).toContain('بيروت');
  });
  it('wraps long identifiers without clipping', () => {
    expect(wrapInvoiceText('ABCDEFGHIJ next', 4, (text) => text.length)).toEqual([
      'ABCD',
      'EFGH',
      'IJ',
      'next',
    ]);
  });
});
