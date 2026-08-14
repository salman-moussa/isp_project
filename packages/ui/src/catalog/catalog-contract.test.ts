import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalogCopy } from './copy';

describe('catalog reference contract', () => {
  it('keeps English and Arabic section/state coverage aligned', () => {
    expect(catalogCopy.ar.sections.map(({ id }) => id)).toEqual(
      catalogCopy.en.sections.map(({ id }) => id),
    );
    expect(Object.keys(catalogCopy.ar.states)).toEqual(Object.keys(catalogCopy.en.states));
    expect(catalogCopy.ar.records.rows.map(({ id }) => id)).toEqual(
      catalogCopy.en.records.rows.map(({ id }) => id),
    );
    expect(Object.keys(catalogCopy.ar.approval)).toEqual(Object.keys(catalogCopy.en.approval));
    expect(catalogCopy.ar.audit.items.map(({ reference }) => reference)).toEqual(
      catalogCopy.en.audit.items.map(({ reference }) => reference),
    );
  });

  it('defines narrow-layout, focus, forced-colors, and reduced-motion behavior', async () => {
    const stylesheet = await readFile(
      fileURLToPath(new URL('./catalog.css', import.meta.url)),
      'utf8',
    );

    expect(stylesheet).toContain('@media (max-width: 48rem)');
    expect(stylesheet).toContain('.catalog-record-list');
    expect(stylesheet).toContain(".catalog[lang='ar']");
    expect(stylesheet).toContain('font-family: var(--font-arabic)');
    expect(stylesheet).toContain('.catalog-table-wrap:focus-visible');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesheet).toContain('animation-duration: 0.01ms !important');
    expect(stylesheet).toContain('@media (forced-colors: active)');
  });
});
