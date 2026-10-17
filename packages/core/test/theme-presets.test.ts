import { describe, expect, it } from 'vitest';
import {
  colorSafeUpDown,
  darkTheme,
  highContrastDarkTheme,
  highContrastLightTheme,
  lightTheme,
  type ChartTheme,
} from '../src/theme';
import { builtInColorPresets, presetTheme } from '../src/color-presets';

type Rgb = [number, number, number];

/** sRGB channels 0..1 of `#rrggbb`. */
function hex(color: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`not #rrggbb: ${color}`);
  return [m[1]!, m[2]!, m[3]!].map((c) => parseInt(c, 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (rgb: Rgb) => rgb.map(toLinear) as Rgb;

/** WCAG relative luminance and contrast ratio. */
const luminance = (rgb: Rgb) => {
  const [r, g, b] = linear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Colour-vision deficiency simulation (Machado, Oliveira and Fernandes 2009,
 * severity 1), applied to linear RGB.
 */
const DEFICIENCIES: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function simulate(lin: Rgb, matrix: number[][]): Rgb {
  return matrix.map((row) => clamp(row[0]! * lin[0] + row[1]! * lin[1] + row[2]! * lin[2])) as Rgb;
}

/** CIELAB (D65) of a linear RGB colour. */
function lab([r, g, b]: Rgb): Rgb {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Smallest CIELAB distance between two colours as seen with normal vision and each deficiency. */
function worstDistance(a: string, b: string): { deficiency: string; distance: number } {
  const views = { normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ...DEFICIENCIES };
  return Object.entries(views)
    .map(([deficiency, m]) => ({ deficiency, distance: deltaE(lab(simulate(linear(hex(a)), m)), lab(simulate(linear(hex(b)), m))) }))
    .sort((x, y) => x.distance - y.distance)[0]!;
}

const presets: [string, ChartTheme][] = [
  ['highContrastDarkTheme', highContrastDarkTheme],
  ['highContrastLightTheme', highContrastLightTheme],
];
const colorSafe: [string, ChartTheme][] = [
  ['dark', { ...darkTheme, ...colorSafeUpDown.dark }],
  ['light', { ...lightTheme, ...colorSafeUpDown.light }],
  ['high-contrast dark', { ...highContrastDarkTheme, ...colorSafeUpDown.dark }],
  ['high-contrast light', { ...highContrastLightTheme, ...colorSafeUpDown.light }],
];

describe('high-contrast themes', () => {
  it.each(presets)('%s: text meets WCAG AAA and labels AA', (_name, theme) => {
    expect(contrast(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.textMuted, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.labelText, theme.labelBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(presets)('%s: series and lines stand out from the canvas (3:1)', (_name, theme) => {
    for (const key of ['up', 'down', 'line', 'drawing', 'referenceLine', 'bid', 'ask', 'extendedHours', 'alert', 'separator'] as const) {
      expect(contrast(theme[key], theme.background), key).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(presets)('%s: heatmap moves steadily away from the canvas', (_name, theme) => {
    const steps = theme.heatmap.map((c) => contrast(c, theme.background));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]!);
  });
});

describe('colour-safe up and down', () => {
  it.each(colorSafe)('on the %s theme: up and down stay apart for every deficiency', (_name, theme) => {
    const worst = worstDistance(theme.up, theme.down);
    expect(worst.distance, worst.deficiency).toBeGreaterThanOrEqual(50);
  });

  it.each(colorSafe)('on the %s theme: up and down stand out from the canvas (3:1)', (_name, theme) => {
    expect(contrast(theme.up, theme.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.down, theme.background)).toBeGreaterThanOrEqual(3);
  });

  it('is needed: the default red and green fall below that distance for red-green deficiencies', () => {
    expect(worstDistance(darkTheme.up, darkTheme.down).distance).toBeLessThan(30);
  });
});

describe('colour presets', () => {
  const cases = builtInColorPresets.flatMap((p) =>
    (['light', 'dark'] as const).flatMap((mode) => {
      const base = mode === 'dark' ? darkTheme : lightTheme;
      return [
        [`${p.label} ${mode} (default)`, presetTheme(p, mode), p[mode].primary] as const,
        [`${p.label} ${mode} (colour-safe)`, presetTheme(p, mode, { ...base, ...colorSafeUpDown[mode] }), p[mode].primary] as const,
      ];
    }),
  );

  it('are ten with distinct ids, each with a light and a dark variant', () => {
    expect(builtInColorPresets).toHaveLength(10);
    expect(new Set(builtInColorPresets.map((p) => p.id)).size).toBe(10);
    for (const p of builtInColorPresets) {
      expect(contrast(p.light.background, '#ffffff'), p.id).toBeLessThan(1.3);
      expect(contrast(p.dark.background, '#000000'), p.id).toBeLessThan(1.5);
    }
  });

  it('start from the base theme of the mode', () => {
    const paper = builtInColorPresets[0]!;
    expect(presetTheme(paper, 'light')).toMatchObject({ background: paper.light.background, up: lightTheme.up });
    expect(presetTheme(paper, 'dark')).toMatchObject({ background: paper.dark.background, up: darkTheme.up });
  });

  it.each(cases)('%s: text and muted text meet WCAG AA, labels too', (_name, theme) => {
    expect(contrast(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.textMuted, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.labelText, theme.labelBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('%s: the primary, up and down stand out from the canvas (3:1)', (_name, theme, primary) => {
    expect(theme.line).toBe(primary);
    for (const key of ['line', 'up', 'down'] as const) expect(contrast(theme[key], theme.background), key).toBeGreaterThanOrEqual(3);
  });

  it.each(cases)('%s: up and down stay apart', (name, theme) => {
    if (name.endsWith('(colour-safe)')) {
      const worst = worstDistance(theme.up, theme.down);
      expect(worst.distance, worst.deficiency).toBeGreaterThanOrEqual(50);
    } else {
      expect(deltaE(lab(linear(hex(theme.up))), lab(linear(hex(theme.down))))).toBeGreaterThanOrEqual(50);
    }
  });

  it.each(cases)('%s: heatmap moves steadily away from the canvas', (_name, theme) => {
    const steps = theme.heatmap.map((c) => contrast(c, theme.background));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]!);
  });

  it('keeps the base up and down colours and applies its own overrides last', () => {
    const lime = builtInColorPresets.find((p) => p.id === 'terminal-lime')!;
    const safe = presetTheme(lime, 'dark', { ...darkTheme, ...colorSafeUpDown.dark });
    expect([safe.up, safe.down]).toEqual([colorSafeUpDown.dark.up, colorSafeUpDown.dark.down]);
    expect(presetTheme(lime, 'dark').fontFamily).toBe(darkTheme.fontFamily);
    const fixed = { ...lime, dark: { ...lime.dark, overrides: { grid: '#010203', up: '#00ff00' } } };
    expect(presetTheme(fixed, 'dark')).toMatchObject({ grid: '#010203', up: '#00ff00' });
    expect(presetTheme(fixed, 'light').grid).not.toBe('#010203');
  });
});
