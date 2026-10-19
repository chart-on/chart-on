import { describe, expect, it } from 'vitest';
import { parseColor } from '@chart-on/core';
import css from '../src/style.css?raw';

/** Custom properties set by the first block that opens with `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--pc-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** A token's colour, following `var()` references. */
function color(tokens: Record<string, string>, name: string): string {
  const value = tokens[`--pc-${name}`];
  if (value === undefined) throw new Error(`No --pc-${name}`);
  const ref = /^var\((--pc-[\w-]+)\)$/.exec(value);
  return ref ? color(tokens, ref[1]!.slice(5)) : value;
}

function luminance(c: string): number {
  const [r, g, b] = parseColor(c).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Each theme's tokens as the cascade resolves them: later blocks win.
const dark = block('.pc-shell');
const light = { ...dark, ...block('.pc-shell.pc-light') };
const highContrast = { ...dark, ...block('.pc-shell.pc-theme-high-contrast') };
const highContrastLight = { ...light, ...highContrast, ...block('.pc-shell.pc-theme-high-contrast.pc-light') };

describe.each([
  ['dark', dark],
  ['light', light],
  ['high-contrast dark', highContrast],
  ['high-contrast light', highContrastLight],
])('%s shell chrome', (_, tokens) => {
  const pair = (fg: string, bg: string) => [`${fg} on ${bg}`, contrast(color(tokens, fg), color(tokens, bg))] as const;

  it('meets WCAG AA for text (4.5:1)', () => {
    const pairs = [
      ...['ink', 'muted-strong', 'muted'].flatMap((fg) => ['panel', 'surface', 'popover'].map((bg) => pair(fg, bg))),
      pair('ink', 'hover'),
      pair('ink', 'active'),
      pair('accent-ink', 'accent'),
      pair('tip-ink', 'tip-bg'),
    ];
    for (const [name, ratio] of pairs) expect(ratio, name).toBeGreaterThanOrEqual(4.5);
  });

  it('marks a selected bottom-bar toggle by more than colour, readable at rest and on hover', () => {
    // The CSS check below pins which tokens the selected chip uses.
    for (const bg of ['panel', 'hover']) {
      const [text, textRatio] = pair('ink', bg);
      expect(textRatio, text).toBeGreaterThanOrEqual(4.5);
      const [mark, markRatio] = pair('accent', bg);
      expect(markRatio, `underline: ${mark}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('meets WCAG AA for the focus ring and accent marks (3:1)', () => {
    for (const fg of ['focus', 'accent']) {
      for (const bg of ['shell', 'panel', 'surface', 'popover']) {
        const [name, ratio] = pair(fg, bg);
        expect(ratio, name).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('selected bottom-bar toggle', () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(code)?.[1] ?? '';

  it('shows an accent underline under ink text, not only a text colour change (WCAG 1.4.1)', () => {
    const body = rule('.pc-chip.is-active');
    expect(body).toMatch(/color: var\(--pc-ink\);/);
    expect(body).toMatch(/text-decoration: underline 2px var\(--pc-accent\);/);
  });
});
