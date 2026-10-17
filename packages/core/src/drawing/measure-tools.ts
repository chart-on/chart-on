import type { Point, Rect } from '../types';
import { contrastText, withAlpha } from '../util/color';
import { englishLocalizer, pluralText, type CoreMessageKey, type Localizer } from '../util/locale';
import { arrowHead, dash, fillOf, HIT, line, LINE_FIELDS, pill, pillHeight, pillWidth, TEXT_FIELDS, two } from './draw';
import { distToSegment, normalizedRect, pointInRect } from './geometry';
import type { DrawingEnv, DrawingTextStyle, DrawingToolDef, ScreenDrawing } from './types';
import { clampLow, sharp } from '../util/math';

/** Space between a zone edge and its label, and between stacked labels. */
const GAP = 4;
/** Keeps labels off the pane edges. */
const INSET = 2;
const ZONE_ALPHA = 0.2;
const RANGE_ALPHA = 0.14;

type Format = (price: number) => string;

/* ------------------------------- figures ------------------------------- */

/** A move between two prices, as a signed difference and a percent. */
export interface PriceChange {
  /** Signed difference `to - from`. */
  change: number;
  /** `change` relative to `from`, in percent (0 when `from` is 0). */
  percent: number;
}

/** The change from `from` to `to`, absolute and in percent of `from`. */
export function priceChange(from: number, to: number): PriceChange {
  const change = to - from;
  return { change, percent: from !== 0 ? (change / Math.abs(from)) * 100 : 0 };
}

/** Direction of a position drawing: profit when the price rises (`long`) or falls (`short`). */
export type PositionSide = 'long' | 'short';

/** Outcome of a position drawing at its target and at its stop, with the reward-to-risk ratio. */
export interface PositionStats {
  /** Profit or loss in price if the target is hit; positive on the profitable side. */
  targetPnl: number;
  /** `targetPnl` relative to the entry, in percent. */
  targetPercent: number;
  /** Profit or loss in price if the stop is hit; negative when the stop caps a loss. */
  stopPnl: number;
  /** `stopPnl` relative to the entry, in percent. */
  stopPercent: number;
  /** Reward over risk, or null unless the target is a profit and the stop a loss. */
  riskReward: number | null;
}

/** Profit or loss at the target and the stop of a long or short position entered at `entry`, and its reward-to-risk ratio. */
export function positionStats(side: PositionSide, entry: number, target: number, stop: number): PositionStats {
  const dir = side === 'long' ? 1 : -1;
  const toTarget = priceChange(entry, target);
  const toStop = priceChange(entry, stop);
  const targetPnl = dir * toTarget.change;
  const stopPnl = dir * toStop.change;
  return {
    targetPnl,
    targetPercent: dir * toTarget.percent,
    stopPnl,
    stopPercent: dir * toStop.percent,
    riskReward: targetPnl > 0 && stopPnl < 0 ? targetPnl / -stopPnl : null,
  };
}

const DURATION_UNITS: readonly [number, CoreMessageKey][] = [
  [86400, 'measureDays'],
  [3600, 'measureHours'],
  [60, 'measureMinutes'],
  [1, 'measureSeconds'],
];

/**
 * Elapsed time in its two largest units, e.g. "3d 4h", "45m" or "-1h 30m".
 * The units and digits follow `localization` (`measureDays` to `measureSeconds`).
 */
export function formatDuration(seconds: number, localization: Localizer = englishLocalizer): string {
  const unit = (key: CoreMessageKey, n: number) => localization.text(key, { n: localization.number(n, 0) });
  let rest = Math.round(Math.abs(seconds));
  if (!Number.isFinite(rest) || rest === 0) return unit('measureSeconds', 0);
  const parts: string[] = [];
  for (const [size, key] of DURATION_UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(unit(key, n));
    // Stop at a zero unit after the first ("1d 0h 5m" reads as "1d").
    else if (parts.length > 0) break;
    if (parts.length === 2) break;
  }
  return `${seconds < 0 ? localization.minusSign : ''}${parts.join(' ')}`;
}

/**
 * A signed bar count in words, e.g. "24 bars" or "1 bar": the plural forms
 * `measureBars.one`, `measureBars.few`, … (see `pluralText`), else
 * `measureBar` for one bar and `measureBars` for any other count.
 */
export function barsText(bars: number, localization: Localizer = englishLocalizer): string {
  const n = Math.abs(bars);
  const params = { count: localization.number(bars, 0) };
  return pluralText(localization, 'measureBars', n, params, localization.text(n === 1 ? 'measureBar' : 'measureBars', params));
}

/* ------------------------------- labels -------------------------------- */

/** Prefix "+" or the locale's minus sign to `magnitude` by the sign of `value`, unless the value shows as zero. */
function signed(value: number, magnitude: string, zero: boolean, localization: Localizer): string {
  return zero ? magnitude : `${value < 0 ? localization.minusSign : '+'}${magnitude}`;
}

const signedPrice = (value: number, format: Format, localization: Localizer) => {
  const magnitude = format(Math.abs(value));
  // The price format decides the precision; its text is read back in ASCII digits, whatever the locale writes.
  return signed(value, magnitude, !/[1-9]/.test(localization.delocalize(magnitude)), localization);
};
const signedPercent = (value: number, localization: Localizer) =>
  signed(value, localization.percent(Math.abs(value), 2), Math.round(Math.abs(value) * 100) === 0, localization);

export interface PositionLabels {
  target: string;
  stop: string;
  entry: string;
}

/**
 * Label texts of a position, e.g. target "Target 110.00 · +10.00 (+10.00%)".
 * Without `figures`, only the prices: "Target 110.00", "Long entry 100.00".
 */
export function positionLabels(
  side: PositionSide,
  entry: number,
  target: number,
  stop: number,
  format: Format,
  localization: Localizer = englishLocalizer,
  figures = true,
): PositionLabels {
  const s = positionStats(side, entry, target, stop);
  const t = (key: CoreMessageKey, price: number) => localization.text(key, { price: format(price) });
  const pnl = (value: number, percent: number) => `${signedPrice(value, format, localization)} (${signedPercent(percent, localization)})`;
  const ratio = s.riskReward === null ? '—' : localization.number(s.riskReward, 2);
  const and = (label: string, figure: string) => (figures ? `${label} · ${figure}` : label);
  return {
    target: and(t('positionTarget', target), pnl(s.targetPnl, s.targetPercent)),
    stop: and(t('positionStop', stop), pnl(s.stopPnl, s.stopPercent)),
    entry: and(t(side === 'long' ? 'positionLongEntry' : 'positionShortEntry', entry), localization.text('positionRiskReward', { ratio })),
  };
}

/** Price range label, e.g. "+12.50 (+2.31%)". */
export function priceRangeLabel(from: number, to: number, format: Format, localization: Localizer = englishLocalizer): string {
  const { change, percent } = priceChange(from, to);
  return `${signedPrice(change, format, localization)} (${signedPercent(percent, localization)})`;
}

/** Date range label from a signed bar count and elapsed seconds, e.g. "24 bars · 1d". */
export function dateRangeLabel(bars: number, seconds: number, localization: Localizer = englishLocalizer): string {
  return `${barsText(bars, localization)} · ${formatDuration(seconds, localization)}`;
}

/**
 * Vertical label layout: spread label centers so boxes `size` tall never
 * overlap, keeping them inside [top, bottom] when they fit. Order is kept.
 */
export function stackLabels(centers: readonly number[], size: number, top: number, bottom: number): number[] {
  const order = centers.map((_, i) => i).sort((a, b) => centers[a]! - centers[b]!);
  const ys = order.map((i) => centers[i]!);
  for (let k = 0; k < ys.length; k++) {
    ys[k] = Math.max(ys[k]!, top + size / 2, k > 0 ? ys[k - 1]! + size : -Infinity);
  }
  for (let k = ys.length - 1; k >= 0; k--) {
    ys[k] = Math.min(ys[k]!, bottom - size / 2, k < ys.length - 1 ? ys[k + 1]! - size : Infinity);
  }
  const out = new Array<number>(centers.length);
  order.forEach((i, k) => (out[i] = ys[k]!));
  return out;
}

/* ------------------------------- drawing ------------------------------- */

/** The first three points, repeating the last placed one while fewer are placed. */
function three<P>(d: { readonly points: readonly P[] }): [P, P, P] {
  const [a, b] = two(d);
  return [a, b, d.points[2] ?? b];
}

/** Crisp 1px horizontal segment. */
function hline(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number): void {
  const cy = sharp(y);
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();
}

/** Crisp 1px vertical segment. */
function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const cx = sharp(x);
  ctx.beginPath();
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y1);
  ctx.stroke();
}

/** Line from a to b with an arrowhead at b. */
function arrowLine(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  line(ctx, a, b);
  arrowHead(ctx, a, b);
}

function onScreen(r: Rect, env: DrawingEnv): boolean {
  return r.x <= env.width && r.x + r.width >= 0 && r.y <= env.height && r.y + r.height >= 0;
}

/** Middle of the on-screen part of a horizontal span. */
function visibleCenter(x0: number, x1: number, env: DrawingEnv): number {
  return (Math.max(Math.min(x0, x1), 0) + Math.min(Math.max(x0, x1), env.width)) / 2;
}

/** Pill label centered on (cx, cy), kept inside the pane so it stays readable when the drawing is clipped. */
function tag(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  bg: string,
  fg: string,
  env: DrawingEnv,
  style: DrawingTextStyle,
): void {
  const w = pillWidth(env, text, style);
  const h = pillHeight(env, style);
  const x = clampLow(cx - w / 2, INSET, env.width - w - INSET);
  const y = clampLow(cy - h / 2, INSET, env.height - h - INSET);
  pill(ctx, text, x, y + h / 2, bg, fg, env, style);
}

/**
 * The switch for a measuring tool's figures, the label it computes: unset or
 * true shows it, as before the switch. It comes after the line and text fields,
 * so a toolbar's first fields stay the same.
 */
export const FIGURE_FIELDS = ['showStats'] as const;

/* ------------------------------- position ------------------------------ */

function renderPosition(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, side: PositionSide): void {
  const [e, t, s] = three(d);
  const [entry, target, stop] = three(d.drawing);
  const theme = env.theme;
  const stats = positionStats(side, entry.price, target.price, stop.price);
  // While placing, the stop follows the target until it is clicked; show it once they part.
  const hasStop = target.time !== stop.time || target.price !== stop.price;
  const style = d.drawing.style;
  const profit = style.profitColor ?? theme.up;
  const loss = style.lossColor ?? theme.down;
  const targetColor = stats.targetPnl >= 0 ? profit : loss;
  const stopColor = stats.stopPnl <= 0 ? loss : profit;
  const zones: [Point, string][] = hasStop ? [[t, targetColor], [s, stopColor]] : [[t, targetColor]];

  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  for (const [edge, color] of zones) {
    const r = normalizedRect(e, edge);
    ctx.fillStyle = withAlpha(color, ZONE_ALPHA);
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = color;
    hline(ctx, edge.y, e.x, edge.x);
  }
  const xs = zones.map(([edge]) => edge.x);
  const ys = zones.map(([edge]) => edge.y);
  const left = Math.min(e.x, ...xs);
  const right = Math.max(e.x, ...xs);
  ctx.strokeStyle = style.color ?? theme.textMuted;
  ctx.lineWidth = (style.lineWidth ?? 1) + (d.hovered && !d.selected ? 0.5 : 0);
  ctx.setLineDash(dash(style));
  hline(ctx, e.y, left, right);

  const top = Math.min(e.y, ...ys);
  const bounds = { x: left, y: top, width: right - left, height: Math.max(e.y, ...ys) - top };
  if (!onScreen(bounds, env)) return;
  // showStats false hides the P/L and R:R figures; the prices stay readable.
  const text = positionLabels(side, entry.price, target.price, stop.price, env.formatPrice, env.localization, style.showStats !== false);
  const h = pillHeight(env, style);
  const beyond = (edge: Point) => (edge.y <= e.y ? edge.y - h / 2 - GAP : edge.y + h / 2 + GAP);
  const labels = [
    { text: text.entry, x: visibleCenter(left, right, env), y: e.y, bg: theme.labelBackground, fg: theme.labelText },
    { text: text.target, x: visibleCenter(e.x, t.x, env), y: beyond(t), bg: targetColor, fg: contrastText(targetColor) },
  ];
  if (hasStop) {
    const x = visibleCenter(e.x, s.x, env);
    labels.push({ text: text.stop, x, y: beyond(s), bg: stopColor, fg: contrastText(stopColor) });
  }
  const placed = stackLabels(labels.map((l) => l.y), h + GAP, INSET, env.height - INSET);
  labels.forEach((l, i) => tag(ctx, l.text, l.x, placed[i]!, l.bg, l.fg, env, style));
}

/**
 * Three anchors: entry, target and stop, placed in that order. Each zone
 * spans from the entry anchor to its own anchor, so every anchor sits on the
 * outer corner of the zone it controls and can be dragged on its own.
 */
function positionTool(type: string, label: string, side: PositionSide): DrawingToolDef {
  return {
    type,
    label,
    group: 'measure',
    points: 3,
    // Zones are colored by profit and loss; the line style applies to the entry line.
    styleFields: [...LINE_FIELDS, ...TEXT_FIELDS, ...FIGURE_FIELDS, 'profitColor', 'lossColor'],
    render: (ctx, d, env) => renderPosition(ctx, d, env, side),
    hitTest(d, p) {
      const [e, t, s] = three(d);
      return pointInRect(p, e, t, HIT / 2) || pointInRect(p, e, s, HIT / 2);
    },
  };
}

export const longPosition = /* @__PURE__ */ positionTool('long-position', 'Long position', 'long');
export const shortPosition = /* @__PURE__ */ positionTool('short-position', 'Short position', 'short');

/* -------------------------------- ranges ------------------------------- */

/** Fill the range box and set up its outline; returns the range color. */
function rangeBox(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, r: Rect): string {
  const style = d.drawing.style;
  const color = style.color ?? env.theme.drawing;
  ctx.fillStyle = fillOf(style, withAlpha(color, RANGE_ALPHA));
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = (style.lineWidth ?? 1) + (d.hovered && !d.selected ? 0.5 : 0);
  ctx.setLineDash(dash(style));
  ctx.lineCap = 'round';
  return color;
}

const RANGE_FIELDS = ['color', 'fill', 'lineWidth', 'lineStyle', ...TEXT_FIELDS, ...FIGURE_FIELDS, 'showFill'];

const rangeHitTest: DrawingToolDef['hitTest'] = (d, p) => pointInRect(p, ...two(d), HIT / 2);

/** Vertical measurement: price change and percent between two anchors. */
export const priceRange: DrawingToolDef = {
  type: 'price-range',
  label: 'Price range',
  group: 'measure',
  points: 2,
  styleFields: RANGE_FIELDS,
  render(ctx, d, env) {
    const [a, b] = two(d);
    const [from, to] = two(d.drawing);
    const r = normalizedRect(a, b);
    const color = rangeBox(ctx, d, env, r);
    hline(ctx, a.y, r.x, r.x + r.width);
    hline(ctx, b.y, r.x, r.x + r.width);
    const mid = r.x + r.width / 2;
    arrowLine(ctx, { x: mid, y: a.y }, { x: mid, y: b.y });
    if (d.drawing.style.showStats === false || !onScreen(r, env)) return;
    const h = pillHeight(env, d.drawing.style);
    const y = b.y <= a.y ? r.y - h / 2 - GAP : r.y + r.height + h / 2 + GAP;
    const text = priceRangeLabel(from.price, to.price, env.formatPrice, env.localization);
    tag(ctx, text, visibleCenter(r.x, r.x + r.width, env), y, color, contrastText(color), env, d.drawing.style);
  },
  hitTest: rangeHitTest,
};

/** Horizontal measurement: bar count and elapsed time between two anchors. */
export const dateRange: DrawingToolDef = {
  type: 'date-range',
  label: 'Date range',
  group: 'measure',
  points: 2,
  styleFields: RANGE_FIELDS,
  render(ctx, d, env) {
    const [a, b] = two(d);
    const [from, to] = two(d.drawing);
    const r = normalizedRect(a, b);
    const color = rangeBox(ctx, d, env, r);
    vline(ctx, a.x, r.y, r.y + r.height);
    vline(ctx, b.x, r.y, r.y + r.height);
    const mid = r.y + r.height / 2;
    arrowLine(ctx, { x: a.x, y: mid }, { x: b.x, y: mid });
    if (d.drawing.style.showStats === false || !onScreen(r, env)) return;
    const y = r.y + r.height + pillHeight(env, d.drawing.style) / 2 + GAP;
    const text = dateRangeLabel(env.barsBetween(from, to), to.time - from.time, env.localization);
    tag(ctx, text, visibleCenter(r.x, r.x + r.width, env), y, color, contrastText(color), env, d.drawing.style);
  },
  hitTest: rangeHitTest,
};

/**
 * Both measurements in one box: price change, percent, bar count and elapsed
 * time between two anchors, labelled beyond the end anchor like a price range.
 */
export const datePriceRange: DrawingToolDef = {
  type: 'date-price-range',
  label: 'Date and price range',
  group: 'measure',
  points: 2,
  styleFields: RANGE_FIELDS,
  render(ctx, d, env) {
    const [a, b] = two(d);
    const [from, to] = two(d.drawing);
    const r = normalizedRect(a, b);
    const color = rangeBox(ctx, d, env, r);
    ctx.strokeRect(sharp(r.x), sharp(r.y), Math.round(r.width), Math.round(r.height));
    arrowLine(ctx, { x: r.x + r.width / 2, y: a.y }, { x: r.x + r.width / 2, y: b.y });
    arrowLine(ctx, { x: a.x, y: r.y + r.height / 2 }, { x: b.x, y: r.y + r.height / 2 });
    if (d.drawing.style.showStats === false || !onScreen(r, env)) return;
    const h = pillHeight(env, d.drawing.style);
    const y = b.y <= a.y ? r.y - h / 2 - GAP : r.y + r.height + h / 2 + GAP;
    const price = priceRangeLabel(from.price, to.price, env.formatPrice, env.localization);
    const text = `${price} · ${dateRangeLabel(env.barsBetween(from, to), to.time - from.time, env.localization)}`;
    tag(ctx, text, visibleCenter(r.x, r.x + r.width, env), y, color, contrastText(color), env, d.drawing.style);
  },
  hitTest: rangeHitTest,
};

/* ------------------------------- forecast ------------------------------ */

/**
 * A hypothesis: a dashed arrow from where the move starts to where it is
 * expected to end, labelled with the change, the percent and the bar count.
 * Colored up or down by direction unless the style sets a color.
 */
export const forecast: DrawingToolDef = {
  type: 'forecast',
  label: 'Forecast',
  group: 'measure',
  points: 2,
  defaultStyle: { lineStyle: 'dashed' },
  styleFields: [...LINE_FIELDS, ...TEXT_FIELDS, ...FIGURE_FIELDS],
  render(ctx, d, env) {
    const [a, b] = two(d);
    const [from, to] = two(d.drawing);
    const style = d.drawing.style;
    const color = style.color ?? (to.price >= from.price ? env.theme.up : env.theme.down);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = (style.lineWidth ?? 1.5) + (d.hovered && !d.selected ? 0.5 : 0);
    ctx.lineCap = 'round';
    ctx.setLineDash(dash(style));
    line(ctx, a, b);
    arrowHead(ctx, a, b);
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (style.showStats === false || !onScreen(normalizedRect(a, b), env)) return;
    const { formatPrice, localization } = env;
    const text = `${priceRangeLabel(from.price, to.price, formatPrice, localization)} · ${barsText(env.barsBetween(from, to), localization)}`;
    const h = pillHeight(env, style);
    const y = b.y <= a.y ? b.y - h / 2 - GAP : b.y + h / 2 + GAP;
    tag(ctx, text, b.x, y, color, contrastText(color), env, style);
  },
  hitTest: (d, p) => distToSegment(p, ...two(d)) <= HIT,
};
