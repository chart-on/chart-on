import type { Point } from '../types';
import { englishLocalizer, type Localizer } from '../util/locale';
import { HIT, hitLine, LABEL_OFF, labelText, line, LINE_FIELDS, pill, pillHeight, pillWidth, priceEdgeLabel, REFERENCE_FIELDS, stroke, strokeLine, TEXT_FIELDS, timeEdgeLabel, two } from './draw';
import { distToSegment, rayEnd } from './geometry';
import { barsText } from './measure-tools';
import { lineBounds, OPEN_BOUNDS } from './model-bounds';
import type { DrawingEnv, DrawingPoint, DrawingToolDef, ScreenDrawing } from './types';
import { clampLow, sharp } from '../util/math';


/** Both ends of the line through `a` and `b`, extended to the edges of the plot. */
function extendedEnds(a: Point, b: Point, env: DrawingEnv): [Point, Point] {
  return [rayEnd(b, a, env.width, env.height), rayEnd(a, b, env.width, env.height)];
}

export const extendedLine: DrawingToolDef = {
  type: 'extended-line',
  styleFields: LINE_FIELDS,
  label: 'Extended line',
  group: 'lines',
  points: 2,
  render(ctx, d, env) {
    stroke(ctx, d, env);
    line(ctx, ...extendedEnds(...two(d), env));
  },
  modelBounds: () => OPEN_BOUNDS,
  hitTest: (d, p, env) => distToSegment(p, ...extendedEnds(...two(d), env)) <= HIT,
};

/** Runs right from its point; its price label sits where it ends, at the right edge, as on a horizontal line. */
export const horizontalRay: DrawingToolDef = {
  type: 'horizontal-ray',
  styleFields: REFERENCE_FIELDS,
  defaultStyle: LABEL_OFF,
  label: 'Horizontal ray',
  group: 'lines',
  points: 1,
  render(ctx, d, env) {
    const a = d.points[0]!;
    const y = sharp(a.y);
    stroke(ctx, d, env);
    line(ctx, { x: a.x, y }, { x: env.width, y });
    if (d.drawing.style.showLabel === true) priceEdgeLabel(ctx, d, env, y);
  },
  modelBounds: (d) => ({ from: d.points[0]!.time, to: Infinity, low: d.points[0]!.price, high: d.points[0]!.price }),
  hitTest(d, p, env) {
    const a = d.points[0]!;
    return distToSegment(p, a, { x: Math.max(a.x, env.width), y: a.y }) <= HIT;
  },
};

/** A horizontal and a vertical line through one point, labelled like each of them. */
export const crossLine: DrawingToolDef = {
  type: 'cross-line',
  styleFields: REFERENCE_FIELDS,
  defaultStyle: LABEL_OFF,
  label: 'Cross line',
  group: 'lines',
  points: 1,
  render(ctx, d, env) {
    const x = sharp(d.points[0]!.x);
    const y = sharp(d.points[0]!.y);
    stroke(ctx, d, env);
    line(ctx, { x: 0, y }, { x: env.width, y });
    line(ctx, { x, y: 0 }, { x, y: env.height });
    const style = d.drawing.style;
    if (style.showLabel !== true) return;
    const left = priceEdgeLabel(ctx, d, env, y);
    // Near the bottom-right corner the pills would overlap: the time pill then ends before the price pill.
    const h = pillHeight(env, style);
    const level = Math.abs(y - (env.height - h / 2 - 4)) < h;
    timeEdgeLabel(ctx, d, env, x, level ? left - 2 : env.width);
  },
  modelBounds: () => OPEN_BOUNDS,
  hitTest: (d, p) => Math.abs(p.y - d.points[0]!.y) <= HIT || Math.abs(p.x - d.points[0]!.x) <= HIT,
};

/** Figures an info line shows between its two points. */
export interface InfoLineStats {
  /** Price change from the first point to the second. */
  change: number;
  /** `change` in percent of the first price (0 when it is 0). */
  percent: number;
  bars: number;
  /** Screen angle in degrees, counter-clockwise from the horizontal: up is positive. */
  angle: number;
}

/** Price change, percent, bar count and screen angle from `pa` to `pb` (drawn at `a` and `b`). */
export function infoLineStats(pa: DrawingPoint, pb: DrawingPoint, a: Point, b: Point, bars: number): InfoLineStats {
  const change = pb.price - pa.price;
  return {
    change,
    percent: pa.price !== 0 ? (change / Math.abs(pa.price)) * 100 : 0,
    bars,
    // Screen y grows downwards, so flip it for a conventional angle.
    angle: (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI,
  };
}

/** One-line label: "+1.25 (+2.50%) · 12 bars · 34.5°", in the language of `localization`. */
export function infoLineLabel(
  stats: InfoLineStats,
  formatPrice: (price: number) => string,
  localization: Localizer = englishLocalizer,
): string {
  const sign = stats.change >= 0 ? '+' : localization.minusSign;
  const price = formatPrice(Math.abs(stats.change));
  const percent = localization.percent(Math.abs(stats.percent), 2);
  return `${sign}${price} (${sign}${percent}) · ${barsText(stats.bars, localization)} · ${angleText(stats.angle, localization)}`;
}

const angleText = (angle: number, localization: Localizer = englishLocalizer) => `${localization.number(angle, 1)}°`;

export const infoLine: DrawingToolDef = {
  type: 'info-line',
  styleFields: [...LINE_FIELDS, 'showStats', ...TEXT_FIELDS, 'extendLeft', 'extendRight'],
  // Says what the user gets: a trend line that also shows its change, bars and angle.
  label: 'Trend line with stats',
  group: 'lines',
  points: 2,
  modelBounds: lineBounds,
  render(ctx, d, env) {
    const [a, b] = two(d);
    strokeLine(ctx, d, env, a, b);
    if (d.drawing.points.length < 2 || d.drawing.style.showStats === false) return;
    const [pa, pb] = d.drawing.points as [DrawingPoint, DrawingPoint];
    const stats = infoLineStats(pa, pb, a, b, env.barsBetween(pa, pb));
    const text = infoLineLabel(stats, env.formatPrice, env.localization);
    const style = d.drawing.style;
    const color = style.color ?? env.theme.drawing;
    const w = pillWidth(env, text, style);
    const h = pillHeight(env, style);
    // Beside the second point, kept inside the plot.
    const x = clampLow(b.x + 8, 0, env.width - w);
    const y = clampLow(b.y + (b.y <= a.y ? -(h / 2 + 4) : h / 2 + 4), h / 2, env.height - h / 2);
    pill(ctx, text, x, y, color, labelText(color, env), env, style);
  },
  hitTest: hitLine,
};

/** Radius of a trend angle's arc, in css px; shorter lines use their length. */
const ANGLE_ARC = 32;

interface TrendAngleLayout {
  a: Point;
  b: Point;
  /** Arc radius and the canvas angle of the line (positive turns clockwise on screen). */
  r: number;
  angle: number;
}

function trendAngleLayout(d: ScreenDrawing): TrendAngleLayout {
  const [a, b] = two(d);
  return { a, b, r: Math.min(ANGLE_ARC, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Trend line with its angle from the horizontal through the first point, in screen space. */
export const trendAngle: DrawingToolDef = {
  type: 'trend-angle',
  styleFields: [...LINE_FIELDS, 'showLabel', ...TEXT_FIELDS],
  label: 'Trend angle',
  group: 'lines',
  points: 2,
  // The reference line and arc stay within their radius of the first point.
  bounds(d) {
    const { a, r } = trendAngleLayout(d);
    return { x: a.x - r, y: a.y - r, width: 2 * r, height: 2 * r };
  },
  render(ctx, d, env) {
    const { a, b, r, angle } = trendAngleLayout(d);
    stroke(ctx, d, env);
    line(ctx, a, b);
    if (r === 0) return;
    // Dashed horizontal reference and the arc between it and the line, the short way round.
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    line(ctx, a, { x: a.x + r, y: a.y });
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, angle, angle < 0);
    ctx.stroke();
    const style = d.drawing.style;
    if (style.showLabel === false) return;
    const pa = d.drawing.points[0]!;
    const text = angleText(infoLineStats(pa, d.drawing.points[1] ?? pa, a, b, 0).angle, env.localization);
    const w = pillWidth(env, text, style);
    // Just outside the middle of the arc.
    const mid = angle / 2;
    const x = a.x + (r + 4) * Math.cos(mid);
    const y = a.y + (r + pillHeight(env, style) / 2 + 2) * Math.sin(mid);
    const color = style.color ?? env.theme.drawing;
    pill(ctx, text, Math.cos(mid) < 0 ? x - w : x, y, color, labelText(color, env), env, style);
  },
  hitTest: (d, p) => distToSegment(p, ...two(d)) <= HIT,
};

export const lineTools: DrawingToolDef[] = [extendedLine, infoLine, trendAngle, horizontalRay, crossLine];
