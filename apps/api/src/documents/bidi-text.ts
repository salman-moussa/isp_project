import bidiFactory from 'bidi-js';
const bidi = bidiFactory();

/** Visual-order directional runs; each run stays logical for PDFKit/fontkit shaping. */
export function bidiTextRuns(value: string): string[] {
  if (!value) return [];
  const embedding = bidi.getEmbeddingLevels(value);
  const mirrored = bidi.getMirroredCharactersMap(value, embedding);
  const characters = value.split('').map((character, index) => mirrored.get(index) ?? character);
  const runs: { start: number; end: number; level: number }[] = [];
  const owners: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const level = embedding.levels[index] ?? 0;
    const last = runs[runs.length - 1];
    if (last && last.level === level) last.end = index;
    else runs.push({ start: index, end: index, level });
    owners[index] = runs.length - 1;
  }
  const indices = Array.from({ length: value.length }, (_, index) => index);
  for (const [start, end] of bidi.getReorderSegments(value, embedding)) {
    const reversed = indices.slice(start, end + 1).reverse();
    indices.splice(start, reversed.length, ...reversed);
  }
  const order = [...new Set(indices.map((index) => owners[index]!))];
  return order.map((index) => {
    const run = runs[index]!;
    const text = characters.slice(run.start, run.end + 1).join('');
    // Fontkit shapes/reverses Arabic runs. Neutral-only RTL runs need explicit reversal.
    return run.level % 2 && !/[\u0600-\u06ff]/.test(text)
      ? Array.from(text).reverse().join('')
      : text;
  });
}

export function wrapInvoiceText(
  value: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      // Long unbroken identifiers are split without dropping a character.
      for (const character of Array.from(word)) {
        if (line && measure(line + character) > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
