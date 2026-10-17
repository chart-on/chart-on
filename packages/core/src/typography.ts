import type { ChartTheme } from './theme';
import { resolveCssVars, type CssPropertyReader } from './util/css';
import { isNumber } from './util/records';

/** How digits are spaced: `tabular` gives every digit one width, so changing values do not shift. */
export type NumeralStyle = 'tabular' | 'proportional';

/** CSS font weight: a number from 1 to 1000, or a keyword. */
export type FontWeight = number | 'normal' | 'bold';

/** Font settings of one text surface. A field left out falls through to the baseline. */
export interface FontSettings {
  fontFamily?: string;
  /** Size in css px. */
  fontSize?: number;
  fontWeight?: FontWeight;
  numerals?: NumeralStyle;
}

/** The chart's text surfaces, each of which can override the baseline font. */
export type TypographySurface = 'axis' | 'legend' | 'labels' | 'drawings' | 'watermark' | 'markers';

export const TYPOGRAPHY_SURFACES: readonly TypographySurface[] = ['axis', 'legend', 'labels', 'drawings', 'watermark', 'markers'];

/**
 * Theme typography: a baseline font plus optional blocks per surface. The
 * baseline's family and size default to the theme's `fontFamily` and
 * `fontSize`, so themes that set only those keep working.
 */
export interface ChartTypography extends FontSettings {
  /** Price and time axis ticks and the price, crosshair and countdown labels on them. */
  axis?: FontSettings;
  /** Legend rows and the heatmap inspector. */
  legend?: FontSettings;
  /** Labels inside the plot: price lines, alerts, orders, trade badges, tooltips and indicator messages. */
  labels?: FontSettings;
  /** Text of drawings, the default for tools that read the theme font. */
  drawings?: FontSettings;
  /** Watermark family and weight; its sizes come from the watermark options. */
  watermark?: FontSettings;
  /** Text of bar markers (`annotations.setMarkers`). */
  markers?: FontSettings;
}

/** A surface's font with every field filled in. */
export type ResolvedFont = Required<FontSettings>;

/** Size steps a surface takes from the baseline when it sets no size of its own. */
const SIZE_STEP: Partial<Record<TypographySurface, number>> = { legend: 1 };

/** Weights a surface uses when its own block sets none, instead of the baseline's. */
const SURFACE_WEIGHT: Partial<Record<TypographySurface, FontWeight>> = { watermark: 600 };

const usable = (size: number | undefined): size is number => typeof size === 'number' && size > 0 && Number.isFinite(size);

/**
 * The font `surface` draws with: the surface block's fields, else the
 * typography baseline's, else the theme's `fontFamily` and `fontSize`, regular
 * weight and tabular numerals. Without `surface`, the baseline itself.
 */
export function resolveFont(theme: Pick<ChartTheme, 'fontFamily' | 'fontSize' | 'typography'>, surface?: TypographySurface): ResolvedFont {
  const base = theme.typography;
  const own = surface ? base?.[surface] : undefined;
  const ownSize = own?.fontSize;
  const baseSize = base?.fontSize;
  const fallbackSize = (usable(baseSize) ? baseSize : theme.fontSize) + (surface ? (SIZE_STEP[surface] ?? 0) : 0);
  return {
    fontFamily: own?.fontFamily || base?.fontFamily || theme.fontFamily,
    fontSize: usable(ownSize) ? ownSize : fallbackSize,
    fontWeight: own?.fontWeight ?? (surface && SURFACE_WEIGHT[surface]) ?? base?.fontWeight ?? 400,
    numerals: own?.numerals ?? base?.numerals ?? 'tabular',
  };
}

/**
 * CSS `font` shorthand for `font`, at `size` px when given. A regular weight is
 * left out, so the default theme yields the same string as before typography.
 */
export function fontCss(font: ResolvedFont, size = font.fontSize, weight: FontWeight = font.fontWeight): string {
  const w = weight === 400 || weight === 'normal' ? '' : `${weight} `;
  return `${w}${size}px ${font.fontFamily}`;
}

/** CSS `font-variant-numeric` value for DOM text. */
export function numeralsCss(numerals: NumeralStyle): string {
  return numerals === 'tabular' ? 'tabular-nums' : 'proportional-nums';
}

/**
 * Merge a typography patch into `base`, surface blocks field by field, so
 * `applyOptions({ theme: { typography: { axis: { fontSize: 13 } } } })` keeps
 * the rest.
 */
export function mergeTypography(base: ChartTypography | undefined, patch: ChartTypography | undefined): ChartTypography | undefined {
  if (!patch) return base;
  if (!base) return patch;
  const merged: ChartTypography = { ...base, ...patch };
  for (const surface of TYPOGRAPHY_SURFACES) {
    if (base[surface] && patch[surface]) merged[surface] = { ...base[surface], ...patch[surface] };
  }
  return merged;
}

/** CSS custom property for each typography baseline field without a top-level theme key. */
export const chartTypographyTokens: Readonly<Record<'fontWeight' | 'numerals', string>> = {
  fontWeight: '--pc-chart-font-weight',
  numerals: '--pc-chart-numerals',
};

/** The typography tokens read from `style` over `fallback`; `fallback` when none is set or usable. */
export function typographyFromCss(style: CssPropertyReader, fallback?: ChartTypography): ChartTypography | undefined {
  const weight = resolveCssVars(style.getPropertyValue(chartTypographyTokens.fontWeight), style);
  const numerals = resolveCssVars(style.getPropertyValue(chartTypographyTokens.numerals), style);
  const patch: ChartTypography = {};
  if (/^\d+$/.test(weight) && Number(weight) >= 1 && Number(weight) <= 1000) patch.fontWeight = Number(weight);
  else if (weight === 'normal' || weight === 'bold') patch.fontWeight = weight;
  if (numerals === 'tabular' || numerals === 'proportional') patch.numerals = numerals;
  return Object.keys(patch).length > 0 ? { ...fallback, ...patch } : fallback;
}

const DIGITS = '0123456789';
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/** Digit cell width per canvas font; null when the font's digits already share one width. */
const digitCells = new Map<string, number | null>();

/**
 * Canvas text has no `font-variant-numeric`, so tabular numerals are laid out
 * by hand: each digit is centred in a cell as wide as the font's widest digit.
 * Fonts whose digits are already tabular take the plain path.
 */
function digitCell(ctx: CanvasRenderingContext2D): number | null {
  const font = ctx.font;
  let cell = digitCells.get(font);
  if (cell === undefined) {
    let min = Infinity;
    let max = 0;
    for (const d of DIGITS) {
      const w = ctx.measureText(d)?.width;
      if (!isNumber(w)) return null;
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    cell = max - min > 0.01 ? max : null;
    if (digitCells.size >= 64) digitCells.clear();
    digitCells.set(font, cell);
  }
  return cell;
}

/** Width in css px of `text` in the context's font, digits spaced as `numerals` says (right-to-left text as `fillNumerals` draws it, in one piece). */
export function measureNumerals(ctx: CanvasRenderingContext2D, text: string, numerals: NumeralStyle): number {
  const cell = numerals === 'tabular' && textDirection(text) === 'ltr' ? digitCell(ctx) : null;
  if (cell === null) return ctx.measureText(text).width;
  let width = 0;
  let run = '';
  for (const ch of text) {
    if (!isDigit(ch)) {
      run += ch;
      continue;
    }
    if (run) width += ctx.measureText(run).width;
    run = '';
    width += cell;
  }
  if (run) width += ctx.measureText(run).width;
  return width;
}

/** Text whose first letter is in a right-to-left script. */
const RTL_FIRST = /^\P{L}*(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;

/**
 * Base direction of `text` as `dir="auto"` picks it: right to left when its
 * first letter is in a right-to-left script, else left to right (digits and
 * signs alone read left to right).
 */
export function textDirection(text: string): CanvasDirection {
  return RTL_FIRST.test(text) ? 'rtl' : 'ltr';
}

/**
 * `ctx.fillText` in `text`'s own base direction, so mixed scripts read in
 * order and numbers keep their signs in place whatever direction the page
 * gives the canvas. The chart aligns text only `left`, `right` or `center`,
 * which the direction leaves alone.
 */
export function fillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
  ctx.direction = textDirection(text);
  if (maxWidth === undefined) ctx.fillText(text, x, y);
  else ctx.fillText(text, x, y, maxWidth);
}

/** One line of a text box from `left` to `right`: at `left`, or at `right` when it reads right to left. */
export function fillLine(ctx: CanvasRenderingContext2D, text: string, left: number, right: number, y: number): void {
  const rtl = textDirection(text) === 'rtl';
  ctx.textAlign = rtl ? 'right' : 'left';
  fillText(ctx, text, rtl ? right : left, y);
}

/**
 * `ctx.fillText` with digits spaced as `numerals` says, honouring `textAlign`.
 * Right-to-left text is drawn in one piece: laying it out run by run would
 * put the runs in the wrong order.
 */
export function fillNumerals(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, numerals: NumeralStyle): void {
  const cell = numerals === 'tabular' && /\d/.test(text) && textDirection(text) === 'ltr' ? digitCell(ctx) : null;
  if (cell === null) {
    fillText(ctx, text, x, y);
    return;
  }
  ctx.direction = 'ltr';
  const align = ctx.textAlign;
  const width = measureNumerals(ctx, text, numerals);
  let left = align === 'right' || align === 'end' ? x - width : align === 'center' ? x - width / 2 : x;
  ctx.textAlign = 'left';
  let run = '';
  const flush = () => {
    if (!run) return;
    ctx.fillText(run, left, y);
    left += ctx.measureText(run).width;
    run = '';
  };
  for (const ch of text) {
    if (!isDigit(ch)) {
      run += ch;
      continue;
    }
    flush();
    ctx.fillText(ch, left + (cell - ctx.measureText(ch).width) / 2, y);
    left += cell;
  }
  flush();
  ctx.textAlign = align;
}
