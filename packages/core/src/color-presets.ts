import { darkTheme, lightTheme, type ChartTheme } from './theme';
import { contrastRatio, contrastText, mixColors, withAlpha } from './util/color';

/** One scheme of a colour preset: a background and a primary colour, plus fixes. */
export interface ColorPresetVariant {
  /** Canvas colour; surfaces, lines and text are mixed from it. */
  background: string;
  /** Accent colour: line series, drawings and the heatmap ramp. */
  primary: string;
  /** Chart theme values that win over the derived ones, for anything the derivation gets wrong. */
  overrides?: Partial<ChartTheme>;
  /** Shell CSS custom properties (`--pc-*`) that win over the derived ones. Used by `@charton/ui`. */
  tokens?: Readonly<Record<string, string>>;
}

/**
 * A one-click colour scheme with a light and a dark variant, each a
 * background and a primary colour. `presetTheme` derives the rest of the
 * chart theme from the variant of the current mode.
 */
export interface ColorPreset {
  /** Stable id, saved with the user's appearance choices. */
  id: string;
  /** Name shown to the user, e.g. as the swatch's tooltip and accessible name. */
  label: string;
  /** Colours in light mode. */
  light: ColorPresetVariant;
  /** Colours in dark mode. */
  dark: ColorPresetVariant;
}

const preset = (id: string, label: string, light: [string, string], dark: [string, string]): ColorPreset => ({
  id,
  label,
  light: { background: light[0], primary: light[1] },
  dark: { background: dark[0], primary: dark[1] },
});

/** The built-in presets, each with a light and a dark variant: `[background, primary]`. */
export const builtInColorPresets: readonly ColorPreset[] = [
  preset('paper-ink', 'Paper & Ink', ['#f5f1e8', '#242424'], ['#242424', '#f5f1e8']),
  preset('matcha-cream', 'Matcha Cream', ['#f7f3e8', '#526b47'], ['#161b14', '#a9c79a']),
  preset('lavender-mist', 'Lavender Mist', ['#ede8ff', '#403578'], ['#1a1726', '#c9bbff']),
  preset('butter-cobalt', 'Butter Cobalt', ['#fff2c6', '#2849c7'], ['#10162e', '#ffe38a']),
  preset('peach-espresso', 'Peach Espresso', ['#ffe5d5', '#382923'], ['#231915', '#ffc7a6']),
  preset('terminal-lime', 'Terminal Lime', ['#f3f7ea', '#3f6b12'], ['#151a16', '#cbf567']),
  preset('midnight-violet', 'Midnight Violet', ['#f1eefb', '#5a3fc0'], ['#171426', '#b6a2ff']),
  preset('obsidian-gold', 'Obsidian Gold', ['#f6f3ec', '#8a6416'], ['#181818', '#e8bd69']),
  preset('deep-ocean', 'Deep Ocean', ['#eaf4f7', '#0b6e86'], ['#101f2b', '#62d6e8']),
  preset('carbon-coral', 'Carbon Coral', ['#f6f2f3', '#c2463a'], ['#1e1b20', '#ff8d82']),
];

/** Black on a light preset, white on a dark one: what text and lines are mixed towards. */
function presetInk(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? '#ffffff' : '#000000';
}

/**
 * The first mix of `background` towards `ink`, from `start` in steps of 0.02,
 * that reaches `minContrast` against `background` (`ink` itself when none does).
 */
function inkWithContrast(background: string, ink: string, start: number, minContrast: number): string {
  for (let t = start; t < 1; t += 0.02) {
    const color = mixColors(background, ink, t);
    if (contrastRatio(color, background) >= minContrast) return color;
  }
  return ink;
}

/**
 * The chart theme of `preset` in `mode`: `base` (default the built-in light
 * or dark theme for `mode`) with surfaces, lines, text, labels, watermark
 * and heatmap mixed from the background, and line series and drawings in the
 * primary colour, then the preset's own `overrides`. Up, down, bid, ask,
 * alerts and level colours stay `base`'s, so a colour-safe up and down pair
 * in `base` survives. Text reaches 7:1 and muted text 5:1 (5.5:1 on
 * dark presets) against the background. Headless use: `chart.applyOptions({ theme: presetTheme(preset, 'dark') })`.
 */
export function presetTheme(preset: ColorPreset, mode: 'light' | 'dark', base?: ChartTheme): ChartTheme {
  const variant = preset[mode];
  const dark = mode === 'dark';
  const bg = variant.background;
  const primary = variant.primary;
  const ink = presetInk(mode);
  const mix = (t: number) => mixColors(bg, ink, t);
  const text = inkWithContrast(bg, ink, dark ? 0.7 : 0.82, 7);
  // Dark presets get more, so muted text still passes 4.5:1 on the slightly lighter shell surfaces.
  const textMuted = inkWithContrast(bg, ink, dark ? 0.45 : 0.55, dark ? 5.5 : 5);
  const labelBackground = dark ? mix(0.18) : text;
  return {
    ...(base ?? (dark ? darkTheme : lightTheme)),
    background: bg,
    grid: mix(dark ? 0.07 : 0.06),
    gridHorizontal: undefined,
    gridVertical: undefined,
    separator: mix(0.12),
    text,
    textMuted,
    crosshair: mix(0.5),
    labelBackground,
    labelText: dark ? contrastText(labelBackground) : bg,
    line: primary,
    drawing: primary,
    drawingSelected: text,
    drawingFill: withAlpha(primary, 0.12),
    referenceLine: textMuted,
    levelNeutral: textMuted,
    watermark: withAlpha(text, dark ? 0.09 : 0.07),
    // Faint primary tint at the low end, through the primary, then on towards the ink,
    // so intensity moves steadily away from the canvas.
    heatmap: [
      mixColors(bg, primary, 0.12),
      mixColors(bg, primary, 0.38),
      mixColors(bg, primary, 0.68),
      primary,
      mixColors(primary, ink, 0.35),
      mixColors(primary, ink, 0.7),
    ],
    ...variant.overrides,
  };
}
