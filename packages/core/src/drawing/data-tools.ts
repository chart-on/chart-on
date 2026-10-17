import { lowerBound } from '../data/util';
import type { Bar, Point, Rect, Time } from '../types';
import { withAlpha } from '../util/color';
import { AnchoredVwap, RangeProfileCache, RegressionCache } from './bar-studies';
import { dash, fillBetween, fillOf, HIT, labelText, line, pill, pillWidth, stroke, TEXT_FIELDS, two } from './draw';
import { distToSegment, pointInRect } from './geometry';
import { timeSpanBounds } from './model-bounds';
import type { BarSpan, Drawing, DrawingEnv, DrawingToolDef, ScreenDrawing } from './types';
import { sharp } from '../util/math';
import { onScreenRows } from '../profile/math';

/*
 * Drawing tools computed from the main series bars between their anchors.
 * Each drawing keeps its result in a cache tied to the drawing object and
 * checked against the bars on every frame, so redraws reuse it and live bars
 * only add their own bar (see `bar-studies.ts`).
 */

const DEFAULT_DEVIATION = 2;
const DEFAULT_VALUE_AREA = 70;
/** The longest row ends at the box's middle (percent of its width), so the bars stay readable on the other half. */
const DEFAULT_PROFILE_WIDTH = 50;
/** Opacity of the regression trend's and the anchored VWAP's bands without a `fill` of their own. */
const REGRESSION_ALPHA = 0.1;
const VWAP_ALPHA = 0.08;
/** Segments a straight fitted line is drawn with, so it bends as it should on a log scale. */
const SEGMENTS = 32;

/** Bars of the main series between `from` and `to`, without copying where the host allows. */
function spanOf(env: DrawingEnv, from: Time, to: Time): BarSpan {
  if (env.barSpan) return env.barSpan(from, to);
  const bars = env.bars(from, to);
  return { bars, start: 0, end: bars.length };
}

/** Earliest and latest anchor time. */
function timeRange(d: Drawing): [Time, Time] {
  const a = d.points[0]!.time;
  const b = (d.points[1] ?? d.points[0]!).time;
  return a <= b ? [a, b] : [b, a];
}

/** A cache per drawing object; a drawing replaced by an edit gets a new one. */
function cacheOf<T>(map: WeakMap<Drawing, T>, d: Drawing, make: () => T): T {
  let cache = map.get(d);
  if (!cache) map.set(d, (cache = make()));
  return cache;
}

/** A positive, finite style number, or `fallback`. */
function count(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Times label the axes; the anchors' prices only say where they were placed. */
const anchorTimes = (d: Drawing) => ({ times: d.points.map((p) => p.time) });

function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function nearPolyline(p: Point, points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i++) if (distToSegment(p, points[i - 1]!, points[i]!) <= HIT) return true;
  return false;
}

/* ---------------- Regression trend ---------------- */

const regressions = new WeakMap<Drawing, RegressionCache>();

interface RegressionLines {
  middle: Point[];
  /** Upper and lower lines; empty when the deviation is 0. */
  upper: Point[];
  lower: Point[];
  r: number;
  deviation: number;
}

/** Screen lines of a regression trend, or null when no bar between its anchors has a close. */
function regressionLines(d: ScreenDrawing, env: DrawingEnv): RegressionLines | null {
  const drawing = d.drawing;
  const [from, to] = timeRange(drawing);
  const cache = cacheOf(regressions, drawing, () => new RegressionCache());
  const span = spanOf(env, from, to);
  const fit = cache.get(span, `${from}|${to}`);
  if (!fit) return null;
  const { start, end } = cache;
  const last = end - 1 - start;
  const xa = env.timeToX(span.bars[start]!.time);
  const xb = env.timeToX(span.bars[end - 1]!.time);
  const step = last > 0 ? (xb - xa) / last : 0;
  const style = drawing.style;
  const xStart = style.extendLeft && step > 0 ? Math.min(xa, 0) : xa;
  const xEnd = style.extendRight && step > 0 ? Math.max(xb, env.width) : xb;
  const k = count(style.deviation, DEFAULT_DEVIATION) * fit.deviation;
  const lines: RegressionLines = { middle: [], upper: [], lower: [], r: fit.r, deviation: fit.deviation };
  const segments = xEnd > xStart ? SEGMENTS : 0;
  for (let s = 0; s <= segments; s++) {
    const x = segments ? xStart + ((xEnd - xStart) * s) / segments : xStart;
    const price = fit.intercept + fit.slope * (step > 0 ? (x - xa) / step : 0);
    lines.middle.push({ x, y: env.priceToY(price) });
    if (k > 0) {
      lines.upper.push({ x, y: env.priceToY(price + k) });
      lines.lower.push({ x, y: env.priceToY(price - k) });
    }
  }
  return lines;
}

export const regressionTrend: DrawingToolDef = {
  type: 'regression-trend',
  label: 'Regression trend',
  group: 'parallels',
  points: 2,
  defaultStyle: { deviation: DEFAULT_DEVIATION },
  styleFields: ['color', 'fill', 'lineWidth', 'lineStyle', 'deviation', 'middleLine', 'extendLeft', 'extendRight', 'showStats', ...TEXT_FIELDS, 'showFill'],
  fillAlpha: REGRESSION_ALPHA,
  settings: [{ key: 'deviation', label: 'Deviation', type: 'number', min: 0, max: 10, step: 0.1 }],
  modelBounds: timeSpanBounds,
  axisMarks: anchorTimes,
  render(ctx, d, env) {
    const lines = regressionLines(d, env);
    const style = d.drawing.style;
    const color = style.color ?? env.theme.drawing;
    if (!lines) {
      // No bars between the anchors yet: show where the fit will go.
      stroke(ctx, d, env);
      ctx.setLineDash([4, 4]);
      line(ctx, ...two(d));
      return;
    }
    const { middle, upper, lower } = lines;
    if (upper.length > 1) fillBetween(ctx, upper, lower, fillOf(style, withAlpha(color, REGRESSION_ALPHA)));
    stroke(ctx, d, env);
    if (upper.length > 1) {
      polyline(ctx, upper);
      polyline(ctx, lower);
    }
    if (style.middleLine !== false || upper.length <= 1) {
      if (upper.length > 1) ctx.setLineDash([4, 4]);
      polyline(ctx, middle);
    }
    if (style.showStats) {
      const text = `r ${lines.r.toFixed(2)} · σ ${env.formatPrice(lines.deviation)}`;
      const top = (upper.length ? upper : middle).at(-1)!;
      pill(ctx, text, top.x - pillWidth(env, text, style), top.y - 14, color, labelText(color, env), env, style);
    }
  },
  hitTest(d, p, env) {
    const lines = regressionLines(d, env);
    if (!lines) return distToSegment(p, ...two(d)) <= HIT;
    return nearPolyline(p, lines.middle) || nearPolyline(p, lines.upper) || nearPolyline(p, lines.lower);
  },
};

/* ---------------- Anchored VWAP ---------------- */

const vwaps = new WeakMap<Drawing, AnchoredVwap>();

interface VwapLines {
  /** Runs of the VWAP line over the visible bars; a bar without a value breaks a run. */
  middle: Point[][];
  upper: Point[][];
  lower: Point[][];
  /** Newest value, NaN when none. */
  last: number;
}

/** Screen lines of an anchored VWAP over the visible bars. */
function vwapLines(d: ScreenDrawing, env: DrawingEnv): VwapLines {
  const drawing = d.drawing;
  const anchor = drawing.points[0]!.time;
  const vwap = cacheOf(vwaps, drawing, () => new AnchoredVwap());
  const span = spanOf(env, anchor, Infinity);
  vwap.update(span, String(anchor));
  const { bars } = span;
  const { start, end, values, deviations } = vwap;
  const k = count(drawing.style.deviation, 0);
  const out: VwapLines = { middle: [], upper: [], lower: [], last: values.at(-1) ?? NaN };
  // Only the visible bars, with one more on each side so the line reaches the edges.
  const first = Math.max(start, lowerBound(bars, env.xToTime(0)) - 1);
  const stop = Math.min(end, lowerBound(bars, env.xToTime(env.width)) + 1);
  let run: [Point[], Point[], Point[]] | null = null;
  for (let i = first; i < stop; i++) {
    const value = values[i - start]!;
    if (!Number.isFinite(value)) {
      run = null;
      continue;
    }
    if (!run) {
      run = [[], [], []];
      out.middle.push(run[0]);
      if (k > 0) {
        out.upper.push(run[1]);
        out.lower.push(run[2]);
      }
    }
    const x = env.timeToX(bars[i]!.time);
    run[0].push({ x, y: env.priceToY(value) });
    if (k > 0) {
      const band = k * deviations[i - start]!;
      run[1].push({ x, y: env.priceToY(value + band) });
      run[2].push({ x, y: env.priceToY(value - band) });
    }
  }
  return out;
}

export const anchoredVwap: DrawingToolDef = {
  type: 'anchored-vwap',
  label: 'Anchored VWAP',
  group: 'measure',
  points: 1,
  // The anchor sits on the bar it starts from.
  snap: 'ohlc',
  defaultStyle: { deviation: 0 },
  styleFields: ['color', 'lineWidth', 'lineStyle', 'deviation', 'fill', 'showLabel', ...TEXT_FIELDS, 'showFill'],
  fillAlpha: VWAP_ALPHA,
  settings: [{ key: 'deviation', label: 'Band deviation', type: 'number', min: 0, max: 10, step: 0.5 }],
  modelBounds: (d) => ({ from: d.points[0]!.time, to: Infinity, low: -Infinity, high: Infinity }),
  axisMarks: anchorTimes,
  render(ctx, d, env) {
    const lines = vwapLines(d, env);
    const style = d.drawing.style;
    const color = style.color ?? env.theme.drawing;
    const fill = fillOf(style, withAlpha(color, VWAP_ALPHA));
    lines.upper.forEach((upper, r) => upper.length > 1 && fillBetween(ctx, upper, lines.lower[r]!, fill));
    stroke(ctx, d, env);
    for (const run of lines.middle) polyline(ctx, run);
    if (lines.upper.length) {
      ctx.lineWidth = 1;
      ctx.setLineDash(dash({ lineStyle: 'dashed' }));
      for (const run of [...lines.upper, ...lines.lower]) polyline(ctx, run);
    }
    const tail = lines.middle.at(-1)?.at(-1);
    if (style.showLabel !== false && tail && Number.isFinite(lines.last)) {
      pill(ctx, env.formatPrice(lines.last), tail.x + 6, tail.y, color, labelText(color, env), env, style);
    }
  },
  hitTest(d, p, env) {
    const lines = vwapLines(d, env);
    return [...lines.middle, ...lines.upper, ...lines.lower].some((run) => nearPolyline(p, run));
  },
};

/* ---------------- Fixed-range volume profile ---------------- */

const profiles = new WeakMap<Drawing, RangeProfileCache>();

interface ProfileBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The profile between the anchors and the box it fills, or null when the bars
 * there have no volume. Without `style.rows`, rows follow the box's height on
 * screen (`onScreenRows`), as the volume profile series does.
 */
function rangeProfile(d: ScreenDrawing, env: DrawingEnv) {
  const drawing = d.drawing;
  const [from, to] = timeRange(drawing);
  const style = drawing.style;
  const valueArea = Math.min(100, count(style.valueArea, DEFAULT_VALUE_AREA));
  const cache = cacheOf(profiles, drawing, () => new RangeProfileCache());
  const span = spanOf(env, from, to);
  const fixed = count(style.rows, 0);
  const get = (rows: number) => cache.get(span, Math.max(1, Math.round(rows)), valueArea, `${from}|${to}`);
  const profile = fixed ? get(fixed) : onScreenRows(get, cache.profile.rows, env.priceToY);
  if (profile.rows === 0 || !(profile.maxVolume > 0)) return null;
  const a = d.points[0]!.x;
  const b = (d.points[1] ?? d.points[0]!).x;
  const box: ProfileBox = {
    left: Math.min(a, b),
    right: Math.max(a, b),
    top: env.priceToY(profile.rowHigh(profile.rows - 1)),
    bottom: env.priceToY(profile.rowLow(0)),
  };
  if (box.top > box.bottom) [box.top, box.bottom] = [box.bottom, box.top];
  return { profile, box };
}

export const fixedRangeVolumeProfile: DrawingToolDef = {
  type: 'fixed-range-volume-profile',
  label: 'Fixed range volume profile',
  group: 'measure',
  points: 2,
  snap: 'time',
  defaultStyle: { valueArea: DEFAULT_VALUE_AREA, profileWidth: DEFAULT_PROFILE_WIDTH },
  styleFields: ['color', 'lineWidth', 'rows', 'valueArea', 'profileWidth', 'showLabel', ...TEXT_FIELDS],
  settings: [
    { key: 'rows', label: 'Rows (0 = auto)', type: 'number', min: 0, max: 500, step: 1 },
    { key: 'valueArea', label: 'Value area %', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'profileWidth', label: 'Width %', type: 'number', min: 1, max: 100, step: 1 },
  ],
  modelBounds: timeSpanBounds,
  axisMarks: anchorTimes,
  bounds(d, env): Rect | null {
    const found = rangeProfile(d, env);
    if (!found) return null;
    const { left, right, top, bottom } = found.box;
    return { x: left, y: top, width: right - left, height: bottom - top };
  },
  render(ctx, d, env) {
    const style = d.drawing.style;
    const color = style.color ?? env.theme.drawing;
    const found = rangeProfile(d, env);
    if (!found) {
      // No volume between the anchors: mark the range.
      stroke(ctx, d, env, 1);
      ctx.setLineDash([4, 4]);
      for (const p of d.points) line(ctx, { x: p.x, y: 0 }, { x: p.x, y: env.height });
      return;
    }
    const { profile, box } = found;
    const width = box.right - box.left;
    const scale = (width * Math.min(100, count(style.profileWidth, DEFAULT_PROFILE_WIDTH))) / 100 / profile.maxVolume;
    ctx.fillStyle = withAlpha(color, 0.05);
    ctx.fillRect(box.left, box.top, width, box.bottom - box.top);
    for (let r = 0; r < profile.rows; r++) {
      const volume = profile.volume[r]!;
      if (!(volume > 0)) continue;
      const y0 = env.priceToY(profile.rowHigh(r));
      const y1 = env.priceToY(profile.rowLow(r));
      const top = Math.min(y0, y1);
      const height = Math.abs(y1 - y0);
      const h = height > 3 ? height - 1 : height;
      const alpha = r >= profile.valueAreaLow && r <= profile.valueAreaHigh ? 0.5 : 0.22;
      if (profile.hasBuySell) {
        const buy = profile.buy[r]! * scale;
        ctx.fillStyle = withAlpha(env.theme.up, alpha);
        ctx.fillRect(box.left, top, buy, h);
        ctx.fillStyle = withAlpha(env.theme.down, alpha);
        ctx.fillRect(box.left + buy, top, (volume - profile.buy[r]!) * scale, h);
      } else {
        ctx.fillStyle = withAlpha(color, alpha);
        ctx.fillRect(box.left, top, volume * scale, h);
      }
    }
    const poc = profile.rowPrice(profile.poc);
    const y = env.priceToY(poc);
    stroke(ctx, d, env, 1.5);
    line(ctx, { x: box.left, y }, { x: box.right, y });
    if (style.showLabel !== false) pill(ctx, env.formatPrice(poc), box.right + 4, y, color, labelText(color, env), env, style);
  },
  hitTest(d, p, env) {
    const found = rangeProfile(d, env);
    if (!found) return d.points.some((a) => Math.abs(p.x - a.x) <= HIT);
    const { left, right, top, bottom } = found.box;
    return pointInRect(p, { x: left, y: top }, { x: right, y: bottom }, HIT / 2);
  },
};

/* ---------------- Bars pattern ---------------- */

/** Width of a copied bar's body as a share of the bar step. */
const BODY = 0.6;
/** Bar step in css px of a copy of one bar, which has no neighbour to measure. */
const ONE_BAR_STEP = 8;

/**
 * Where a bars pattern puts its copy: the main series bars `start` to `end`
 * (exclusive) between the first two anchors, moved in price by `shift` so the
 * first one opens at the third anchor's price. The first copied bar sits at
 * `x`, each next one `step` css px further right, keeping the bars' spacing.
 */
export interface BarsPatternCopy {
  bars: readonly Bar[];
  start: number;
  end: number;
  shift: number;
  x: number;
  step: number;
}

/**
 * The bars between the first two anchors of `d`, copied to start at `x` and
 * moved so the first bar's `key` price is `price`. Null without bars there.
 */
function copyOf(d: Drawing, env: DrawingEnv, x: number, price: number, key: 'open' | 'close'): BarsPatternCopy | null {
  const [from, to] = timeRange(d);
  const { bars, start, end } = spanOf(env, from, to);
  if (end <= start) return null;
  const n = end - start;
  const step = n > 1 ? (env.timeToX(bars[end - 1]!.time) - env.timeToX(bars[start]!.time)) / (n - 1) : ONE_BAR_STEP;
  return { bars, start, end, shift: price - bars[start]![key], x, step };
}

/** The copy of a bars pattern, or null before its third anchor is placed or without bars between the first two. */
export function barsPatternCopy(d: ScreenDrawing, env: DrawingEnv): BarsPatternCopy | null {
  const target = d.drawing.points[2];
  return target && d.points[2] ? copyOf(d.drawing, env, d.points[2].x, target.price, 'open') : null;
}

/**
 * The copy of a projection: the bars between its anchors, moved to start on
 * the main series' newest bar with their first close on its close. Null
 * without bars between the anchors.
 */
export function projectionCopy(d: ScreenDrawing, env: DrawingEnv): BarsPatternCopy | null {
  const tail = spanOf(env, timeRange(d.drawing)[0], Infinity);
  const latest = tail.bars[tail.end - 1];
  return latest ? copyOf(d.drawing, env, env.timeToX(latest.time), latest.close, 'close') : null;
}

/** Screen box of a copy, from its first to its last body and its highest high to its lowest low. */
function copyBox(copy: BarsPatternCopy, env: DrawingEnv): Rect {
  let high = -Infinity;
  let low = Infinity;
  for (let i = copy.start; i < copy.end; i++) {
    high = Math.max(high, copy.bars[i]!.high);
    low = Math.min(low, copy.bars[i]!.low);
  }
  const half = (Math.abs(copy.step) * BODY) / 2;
  const top = env.priceToY(high + copy.shift);
  const bottom = env.priceToY(low + copy.shift);
  const right = copy.x + (copy.end - copy.start - 1) * copy.step;
  return { x: Math.min(copy.x, right) - half, y: Math.min(top, bottom), width: Math.abs(right - copy.x) + 2 * half, height: Math.abs(bottom - top) };
}


/** A copy reaches past its anchors, as far as the copied bars go. */
const copyBounds = (d: Drawing) => ({ from: Math.min(...d.points.map((p) => p.time)), to: Infinity, low: -Infinity, high: Infinity });

export const barsPattern: DrawingToolDef = {
  type: 'bars-pattern',
  label: 'Bars pattern',
  group: 'measure',
  points: 3,
  defaultStyle: { lineStyle: 'dashed' },
  styleFields: ['color', 'lineWidth', 'lineStyle'],
  modelBounds: copyBounds,
  bounds(d, env) {
    const copy = barsPatternCopy(d, env);
    return copy && copyBox(copy, env);
  },
  render(ctx, d, env) {
    // The source range: a line between the first two anchors.
    stroke(ctx, d, env, 1);
    line(ctx, ...two(d));
    const copy = barsPatternCopy(d, env);
    if (!copy) return;
    const color = withAlpha(d.drawing.style.color ?? env.theme.drawing, 0.7);
    const { bars, shift, step } = copy;
    const width = Math.max(1, Math.round(Math.abs(step) * BODY));
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ctx.fillStyle = color;
    // Wicks and rising (hollow) bodies in one path; falling bodies filled.
    ctx.beginPath();
    for (let i = copy.start; i < copy.end; i++) {
      const x = sharp(copy.x + (i - copy.start) * step);
      if (x < -width || x > env.width + width) continue;
      const bar = bars[i]!;
      const open = env.priceToY(bar.open + shift);
      const close = env.priceToY(bar.close + shift);
      const top = Math.min(open, close);
      const bottom = Math.max(open, close);
      ctx.moveTo(x, env.priceToY(bar.high + shift));
      ctx.lineTo(x, top);
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, env.priceToY(bar.low + shift));
      const left = x - width / 2;
      if (bar.close >= bar.open) ctx.rect(left, top, width, Math.max(1, bottom - top));
      else ctx.fillRect(left, top, width, Math.max(1, bottom - top));
    }
    ctx.stroke();
  },
  hitTest(d, p, env) {
    if (distToSegment(p, ...two(d)) <= HIT) return true;
    const copy = barsPatternCopy(d, env);
    if (!copy) return false;
    const box = copyBox(copy, env);
    return pointInRect(p, box, { x: box.x + box.width, y: box.y + box.height }, HIT / 2);
  },
};

/* ---------------- Projection ---------------- */

/** Screen path of a projection: the copied closes, one point per bar. */
function projectionPath(d: ScreenDrawing, env: DrawingEnv): Point[] {
  const copy = projectionCopy(d, env);
  const path: Point[] = [];
  for (let i = copy?.start ?? 0; copy && i < copy.end; i++) {
    path.push({ x: copy.x + (i - copy.start) * copy.step, y: env.priceToY(copy.bars[i]!.close + copy.shift) });
  }
  return path;
}

export const projection: DrawingToolDef = {
  type: 'projection',
  label: 'Projection',
  group: 'measure',
  points: 2,
  defaultStyle: { lineStyle: 'dashed' },
  styleFields: ['color', 'lineWidth', 'lineStyle'],
  modelBounds: copyBounds,
  bounds(d, env) {
    const path = projectionPath(d, env);
    if (!path.length) return null;
    let top = Infinity;
    let bottom = -Infinity;
    for (const { y } of path) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const left = Math.min(path[0]!.x, path[path.length - 1]!.x);
    return { x: left, y: top, width: Math.abs(path[path.length - 1]!.x - path[0]!.x), height: bottom - top };
  },
  render(ctx, d, env) {
    // The source range between the anchors, then its close path replayed from the newest bar.
    stroke(ctx, d, env, 1);
    line(ctx, ...two(d));
    ctx.strokeStyle = withAlpha(d.drawing.style.color ?? env.theme.drawing, 0.7);
    polyline(ctx, projectionPath(d, env));
  },
  hitTest(d, p, env) {
    return distToSegment(p, ...two(d)) <= HIT || nearPolyline(p, projectionPath(d, env));
  },
};
