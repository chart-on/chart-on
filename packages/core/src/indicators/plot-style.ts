/**
 * Plot styles the user sets over an indicator definition's: checks, the
 * lenient parse of saved state, and the style a plot ends up with.
 */
import type { LineStyle } from '../annotations/types';
import type { IndicatorDef, PlotDef, PlotStyle } from './types';
import { isNumber } from '../util/records';

/** Stroke width of a line plot whose definition sets none. */
export const DEFAULT_PLOT_LINE_WIDTH = 1.5;

const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

const isLineWidth = (value: unknown): value is number => isNumber(value) && value > 0;
const isLineStyle = (value: unknown): value is LineStyle => LINE_STYLES.includes(value as LineStyle);

/** The style plot `plot` draws with: the definition's, with `style` over it. */
export function resolvePlotStyle(plot: PlotDef, style: PlotStyle | undefined): PlotStyle {
  const visible = style?.visible ?? true;
  if (plot.type !== 'line') return { visible };
  return {
    lineWidth: style?.lineWidth ?? plot.lineWidth ?? DEFAULT_PLOT_LINE_WIDTH,
    lineStyle: style?.lineStyle ?? plot.lineStyle ?? 'solid',
    visible,
  };
}

/** Why `style` cannot apply to `plot` (null when unknown, while pending), or null when it can. */
export function plotStyleError(style: PlotStyle, plot: PlotDef | null): string | null {
  if (style.lineWidth !== undefined && !isLineWidth(style.lineWidth)) return `lineWidth must be a positive number, got ${String(style.lineWidth)}`;
  if (style.lineStyle !== undefined && !isLineStyle(style.lineStyle)) {
    return `lineStyle must be 'solid', 'dashed' or 'dotted', got ${String(style.lineStyle)}`;
  }
  if (style.visible !== undefined && typeof style.visible !== 'boolean') return `visible must be a boolean, got ${String(style.visible)}`;
  if (plot && plot.type !== 'line' && (style.lineWidth !== undefined || style.lineStyle !== undefined)) {
    return 'lineWidth and lineStyle apply to line plots only';
  }
  return null;
}

/**
 * Only what differs from `plot`'s definition, so a value set back to the
 * definition's is no longer an override; `{}` when nothing does. Without
 * `plot` (pending) everything is kept.
 */
export function plotOverride(style: PlotStyle, plot: PlotDef | null): PlotStyle {
  const base = plot ? resolvePlotStyle(plot, undefined) : {};
  const out: PlotStyle = {};
  if (style.lineWidth !== undefined && style.lineWidth !== base.lineWidth) out.lineWidth = style.lineWidth;
  if (style.lineStyle !== undefined && style.lineStyle !== base.lineStyle) out.lineStyle = style.lineStyle;
  if (style.visible !== undefined && style.visible !== base.visible) out.visible = style.visible;
  return out;
}

/** Overrides from saved state that fit `def`: unknown plots, invalid values and those equal to the definition's are dropped. */
export function fitPlotStyles(def: IndicatorDef, styles: Readonly<Record<string, PlotStyle>>): Record<string, PlotStyle> {
  const out: Record<string, PlotStyle> = {};
  for (const plot of def.plots) {
    const style = styles[plot.id];
    if (!style) continue;
    const own = plotOverride(plot.type === 'line' ? style : { visible: style.visible }, plot);
    if (Object.keys(own).length > 0) out[plot.id] = own;
  }
  return out;
}

/** Saved plot styles with the invalid members dropped; null when none are left. */
export function parsePlotStyles(value: unknown): Record<string, PlotStyle> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, PlotStyle> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { lineWidth, lineStyle, visible } = raw as Record<string, unknown>;
    const style: PlotStyle = {};
    if (isLineWidth(lineWidth)) style.lineWidth = lineWidth;
    if (isLineStyle(lineStyle)) style.lineStyle = lineStyle;
    if (typeof visible === 'boolean') style.visible = visible;
    if (Object.keys(style).length > 0) out[id] = style;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A deep copy of `styles`. */
export function copyPlotStyles(styles: Readonly<Record<string, PlotStyle>>): Record<string, PlotStyle> {
  const out: Record<string, PlotStyle> = {};
  for (const [id, style] of Object.entries(styles)) out[id] = { ...style };
  return out;
}
