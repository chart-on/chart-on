import { chartThemeTokens, contrastText, isColor, mixColors, presetTheme, withAlpha, type ChartTheme, type ColorPreset, type ColorPresetVariant } from '@chart-on/core';

/** Chart theme keys a preset derives, also written as chart tokens so shell CSS that reads them follows. */
const DERIVED_KEYS = [
  'background',
  'grid',
  'separator',
  'text',
  'textMuted',
  'crosshair',
  'labelBackground',
  'labelText',
  'line',
  'drawing',
  'drawingSelected',
  'drawingFill',
  'referenceLine',
  'watermark',
  'heatmap',
] as const satisfies readonly (keyof ChartTheme)[];

/**
 * The shell's CSS custom properties for `preset` in `mode`: surfaces, lines,
 * text and accent of the chrome mixed from the variant's background and
 * primary, the chart tokens of the colours `presetTheme` derives, then the
 * variant's own `tokens`. Up and down are left to the stylesheet, so the
 * palette setting keeps working.
 */
export function presetShellTokens(preset: ColorPreset, mode: 'light' | 'dark'): Record<string, string> {
  const theme = presetTheme(preset, mode);
  const { background: bg, primary } = preset[mode];
  const dark = mode === 'dark';
  const ink = dark ? '#ffffff' : '#000000';
  const mix = (t: number) => mixColors(bg, ink, t);
  const surface = dark ? mix(0.05) : mixColors(bg, '#ffffff', 0.5);
  const tokens: Record<string, string> = {
    '--pc-shell': mixColors(bg, '#000000', dark ? 0.35 : 0.07),
    '--pc-canvas': bg,
    '--pc-panel': bg,
    '--pc-surface': surface,
    '--pc-popover': surface,
    '--pc-hover': mix(dark ? 0.09 : 0.05),
    '--pc-active': mix(dark ? 0.15 : 0.09),
    '--pc-line': theme.separator,
    '--pc-line-strong': mix(dark ? 0.24 : 0.2),
    '--pc-ink': mix(dark ? 0.92 : 0.9),
    '--pc-muted-strong': theme.text,
    '--pc-muted': theme.textMuted,
    '--pc-faint': mix(0.36),
    '--pc-accent': primary,
    '--pc-accent-ink': contrastText(primary),
    '--pc-accent-soft': withAlpha(primary, dark ? 0.16 : 0.12),
    '--pc-tip-bg': theme.labelBackground,
    '--pc-tip-ink': theme.labelText,
  };
  for (const key of DERIVED_KEYS) {
    const value = theme[key];
    tokens[chartThemeTokens[key]] = Array.isArray(value) ? value.join(', ') : value;
  }
  return { ...tokens, ...preset[mode].tokens };
}

/**
 * Presets an embedder passed, without the unusable ones: an id, a label, and
 * a light and a dark variant with a background and primary the chart can
 * draw. Later duplicates of an id are dropped.
 */
export function usablePresets(presets: readonly ColorPreset[]): ColorPreset[] {
  const seen = new Set<string>();
  return presets.filter((p) => {
    const ok =
      typeof p?.id === 'string' &&
      p.id !== '' &&
      !seen.has(p.id) &&
      typeof p.label === 'string' &&
      usableVariant(p.light) &&
      usableVariant(p.dark);
    if (ok) seen.add(p.id);
    return ok;
  });
}

function usableVariant(v: ColorPresetVariant | undefined): boolean {
  return typeof v?.background === 'string' && isColor(v.background) && typeof v.primary === 'string' && isColor(v.primary);
}
