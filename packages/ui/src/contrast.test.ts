import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const white = '#ffffff';

describe('Orvex semantic color tokens', () => {
  it.each(['color-ink-muted', 'color-ink-subtle', 'color-teal', 'color-primary'])(
    '%s meets WCAG AA for normal text on a white surface',
    async (token) => {
      const stylesheet = await readFile(
        fileURLToPath(new URL('./theme.css', import.meta.url)),
        'utf8',
      );
      const value = stylesheet.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`, 'iu'))?.[1];
      expect(value, `Missing --${token}`).toBeDefined();
      expect(contrastRatio(value ?? white, white)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((value) => Number.parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color ${hex}`);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
