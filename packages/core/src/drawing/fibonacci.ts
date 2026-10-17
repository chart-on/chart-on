import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { extendSegment, parallelOffset } from './channel';
import { resolveLevelColor, ruleLevels } from './level-color';
import { BAND_ALPHA, fillBetween, fillOf, HIT, labelText, levelLines, line, LINE_FIELDS, NO_FILL, pill, pillHeight, pillWidth, stroke, TEXT_FIELDS } from './draw';
import { angleInSweep, arcBounds, distToSegment, onCircle, rayEnd, TAU } from './geometry';
import { OPEN_BOUNDS, pointBounds, timeSpanBounds } from './model-bounds';
import type { Drawing, DrawingEnv, DrawingLevel, DrawingModelBounds, DrawingPoint, DrawingStyle, DrawingTextStyle, DrawingToolDef, ScreenDrawing } from './types';
import { sharp } from '../util/math';

/** Standard retracement levels. */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** A Fibonacci level and the price it falls at. */
export interface FibLevel {
  level: number;
  price: number;
}

/**
 * Retracement prices of a move from `start` to `end`. Level 0 sits at the end of the move and 1 at
 * its start, so 0.618 is the 61.8% retracement; levels outside 0..1 project beyond the move.
 * Non-finite levels are skipped.
 */
export function fibLevels(start: number, end: number, levels: readonly number[] = FIB_LEVELS): FibLevel[] {
  return levels.filter(Number.isFinite).map((level) => ({ level, price: end + (start - end) * level }));
}

/** Standard trend-based extension levels. */
export const FIB_EXTENSION_LEVELS: readonly number[] = [0, 0.618, 1, 1.618, 2.618, 3.618, 4.236];

/**
 * Trend-based extension prices: the move from `start` to `end`, projected from
 * `from` (the retracement point). Level 1 adds the whole move to `from`, 1.618
 * adds 161.8% of it. Non-finite levels are skipped.
 */
export function fibExtensionLevels(
  start: number,
  end: number,
  from: number,
  levels: readonly number[] = FIB_EXTENSION_LEVELS,
): FibLevel[] {
  return levels.filter(Number.isFinite).map((level) => ({ level, price: from + (end - start) * level }));
}

interface FibLayout {
  /** Anchors in order, joined by the dashed guide. */
  anchors: Point[];
  left: number;
  right: number;
  /** Visible levels in ascending order with their color and pane-local y. */
  lines: (FibLevel & { color: string; y: number })[];
}

/**
 * Level lines of a Fibonacci tool: the style's levels (or `defaults`), priced
 * by `price`, spanning `from` to the rightmost anchor, or to the pane edge on
 * each side the style extends.
 */
function layout(
  d: ScreenDrawing,
  env: DrawingEnv,
  defaults: readonly DrawingLevel[],
  price: (levels: readonly number[]) => FibLevel[],
  from: number,
): FibLayout {
  const anchors = d.points;
  const levels = styleLevels(d, env, defaults);
  const prices = price(levels.map((l) => l.value));
  const lines = levels
    .map((l, i) => ({ ...prices[i]!, color: l.color, y: env.priceToY(prices[i]!.price) }))
    .sort((x, y) => x.level - y.level);
  const right = Math.max(...anchors.map((p) => p.x));
  const left = Math.min(from, right);
  const s = d.drawing.style;
  return { anchors, left: s.extendLeft ? Math.min(left, 0) : left, right: s.extendRight ? Math.max(right, env.width) : right, lines };
}

/** A visible level with its color resolved. */
export interface ShownLevel {
  value: number;
  color: string;
}

/**
 * Visible levels of the style (or `defaults`), each in its own color (see
 * `resolveLevelColor`) or the drawing's. Styles may come from storage, so
 * malformed entries are dropped instead of trusting the type.
 */
export function styleLevels(d: ScreenDrawing, env: DrawingEnv, defaults: readonly DrawingLevel[]): ShownLevel[] {
  const color = d.drawing.style.color ?? env.theme.drawing;
  return visibleLevels(d.drawing.style, defaults).map((l) => ({ value: l.value, color: resolveLevelColor(l, env.theme) ?? color }));
}

/** The visible, well-formed levels of `style`, or of `defaults` when it has none. */
export function visibleLevels(style: DrawingStyle, defaults: readonly DrawingLevel[]): DrawingLevel[] {
  return (Array.isArray(style.levels) ? style.levels : defaults).filter((l) => Number.isFinite(l?.value) && l.visible !== false);
}

/** `fill` replaces the alternating bands with one color; `labelSide: 'right'` keeps the bars before the move clear of labels. */
const FIB_FIELDS = ['color', 'fill', 'lineWidth', 'lineStyle', 'levels', 'extendLeft', 'extendRight', 'showLabel', 'labelSide', 'labelContent', ...TEXT_FIELDS, 'showFill'];

/**
 * `labelContent` of the Fib retracement and extension when unset, also in their
 * `defaultStyle` so the settings show what is drawn. Each level tool keeps the
 * content it drew before the option existed, so saved drawings keep their look:
 * these two showed the level with its price, the others the level alone.
 */
const BOTH = 'both';

/** Default levels; their colors come from the shared rule (`levelColor`), so they follow the theme. */
const RETRACEMENT_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels(FIB_LEVELS);

const EXTENSION_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels(FIB_EXTENSION_LEVELS);

export const copyLevels = (levels: readonly DrawingLevel[]): DrawingLevel[] => levels.map((l) => ({ ...l }));

export const formatLevel = (level: number) => String(Number(level.toFixed(4)));

/**
 * A level's label by the style's `labelContent` (`fallback` when unset):
 * the level, its `price`, both, or the level in percent. Without a `price`
 * (a label that marks a time or a radius) the price choices show the level.
 */
export function levelText(env: DrawingEnv, style: DrawingStyle, value: number, price?: number, fallback: DrawingStyle['labelContent'] = 'level'): string {
  const level = formatLevel(value);
  const content = style.labelContent ?? fallback;
  if (content === 'percent') return `${formatLevel(value * 100)}%`;
  if (price === undefined || content === 'level') return level;
  return content === 'price' ? env.formatPrice(price) : `${level} (${env.formatPrice(price)})`;
}

function renderLevels(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, l: FibLayout): void {
  const { anchors, left, right, lines } = l;
  const s = d.drawing.style;
  for (let i = 1; i < lines.length; i++) {
    const y0 = lines[i - 1]!.y;
    const y1 = lines[i]!.y;
    ctx.fillStyle = fillOf(s, withAlpha(lines[i]!.color, i % 2 ? BAND_ALPHA : BAND_ALPHA / 2));
    ctx.fillRect(left, Math.min(y0, y1), right - left, Math.abs(y1 - y0));
  }
  // Dashed guide through the anchors.
  ctx.strokeStyle = withAlpha(s.color ?? env.theme.drawing, 0.5);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let i = 1; i < anchors.length; i++) line(ctx, anchors[i - 1]!, anchors[i]!);
  stroke(ctx, d, env, 1);
  const label = (f: FibLevel) => (s.showLabel === false ? undefined : levelText(env, s, f.level, f.price, BOTH));
  levelLines(ctx, env, lines.map((f) => ({ y: f.y, color: f.color, label: label(f) })), left, right, s, s.labelSide);
}

function hitLevels(l: FibLayout, p: Point): boolean {
  const { anchors, left, right, lines } = l;
  for (let i = 1; i < anchors.length; i++) if (distToSegment(p, anchors[i - 1]!, anchors[i]!) <= HIT) return true;
  return p.x >= left - HIT && p.x <= right + HIT && lines.some((f) => Math.abs(p.y - f.y) <= HIT);
}

function retracementLayout(d: ScreenDrawing, env: DrawingEnv): FibLayout {
  const start = d.drawing.points[0]!;
  const end = d.drawing.points[1] ?? start;
  const from = Math.min(...d.points.map((p) => p.x));
  return layout(d, env, RETRACEMENT_LEVELS, (levels) => fibLevels(start.price, end.price, levels), from);
}

/**
 * Levels start at the retracement point (or the trend end until it is placed)
 * and run at least the trend's width past it: placed in time order, that point
 * is the rightmost anchor, and the levels would otherwise have no length.
 */
function extensionLayout(d: ScreenDrawing, env: DrawingEnv): FibLayout {
  const [start, end = start, from = end] = d.drawing.points as [DrawingPoint, DrawingPoint?, DrawingPoint?];
  const [a, b = a, c = b] = d.points as [Point, Point?, Point?];
  const l = layout(d, env, EXTENSION_LEVELS, (levels) => fibExtensionLevels(start.price, end.price, from.price, levels), c.x);
  return { ...l, right: Math.max(l.right, c.x + Math.abs(b.x - a.x)) };
}

export const fibRetracement: DrawingToolDef = {
  type: 'fib-retracement',
  label: 'Fib retracement',
  group: 'ratios',
  points: 2,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(RETRACEMENT_LEVELS), labelContent: BOTH },
  styleFields: FIB_FIELDS,
  fillAlpha: BAND_ALPHA,
  // Levels may lie past the anchors' prices.
  modelBounds: timeSpanBounds,
  render: (ctx, d, env) => renderLevels(ctx, d, env, retracementLayout(d, env)),
  hitTest: (d, p, env) => hitLevels(retracementLayout(d, env), p),
};

export const fibExtension: DrawingToolDef = {
  type: 'fib-extension',
  label: 'Trend-based Fib extension',
  group: 'ratios',
  points: 3,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(EXTENSION_LEVELS), labelContent: BOTH },
  styleFields: FIB_FIELDS,
  fillAlpha: BAND_ALPHA,
  modelBounds: timeSpanBounds,
  render: (ctx, d, env) => renderLevels(ctx, d, env, extensionLayout(d, env)),
  hitTest: (d, p, env) => hitLevels(extensionLayout(d, env), p),
};

/** A level label: a pill at `x` (its left, centre or right edge by `align`), centered on `y`. */
export interface LevelLabel {
  text: string;
  x: number;
  y: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

/** Label pills, skipping any that would overlap one already drawn. */
export function levelLabels(ctx: CanvasRenderingContext2D, env: DrawingEnv, labels: readonly LevelLabel[], style: DrawingTextStyle): void {
  const h = pillHeight(env, style);
  const drawn: Rect[] = [];
  for (const l of labels) {
    const w = pillWidth(env, l.text, style);
    const left = l.align === 'right' ? l.x - w : l.align === 'center' ? l.x - w / 2 : l.x;
    const box = { x: left, y: l.y - h / 2, width: w, height: h };
    const overlaps = (r: Rect) => box.x < r.x + r.width && r.x < box.x + w && box.y < r.y + r.height && r.y < box.y + h;
    if (drawn.some(overlaps)) continue;
    drawn.push(box);
    pill(ctx, l.text, box.x, l.y, l.color, labelText(l.color, env), env, style);
  }
}

/** One level line of the channel or fan tools, in pane-local css px. */
export interface LevelSegment extends ShownLevel {
  from: Point;
  to: Point;
}

const CHANNEL_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels([...FIB_LEVELS, 1.618]);

/**
 * Lines of a Fibonacci channel, lowest level first: the base line A→B moved
 * towards its parallel through C by each level's fraction of the distance.
 * Like the parallel channel, the distance is measured in pane pixels, so the
 * lines stay parallel on any price scale. They reach the pane edge on each
 * side the style extends.
 */
function channelLayout(d: ScreenDrawing, env: DrawingEnv): LevelSegment[] {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const o = parallelOffset(a, b, d.points[2] ?? b);
  const [l, r] = extendSegment(a, b, d.drawing.style, env.width);
  const shift = (p: Point, k: number): Point => ({ x: p.x + o.x * k, y: p.y + o.y * k });
  return styleLevels(d, env, CHANNEL_LEVELS)
    .sort((x, y) => x.value - y.value)
    .map((level) => ({ ...level, from: shift(l, level.value), to: shift(r, level.value) }));
}

export const fibChannel: DrawingToolDef = {
  type: 'fib-channel',
  label: 'Fib channel',
  // A channel first: its levels are lines parallel to the base line, as in every Parallels tool.
  group: 'parallels',
  points: 3,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(CHANNEL_LEVELS) },
  styleFields: FIB_FIELDS,
  fillAlpha: BAND_ALPHA,
  // Levels past 1 leave the anchors' prices; a vertical base line offsets in time instead.
  modelBounds: (d) => (d.points[0]!.time === (d.points[1] ?? d.points[0]!).time ? OPEN_BOUNDS : timeSpanBounds(d)),
  render(ctx, d, env) {
    const lines = channelLayout(d, env);
    const s = d.drawing.style;
    for (let i = 1; i < lines.length; i++) {
      const [p, q] = [lines[i - 1]!, lines[i]!];
      fillBetween(ctx, [p.from, p.to], [q.from, q.to], fillOf(s, withAlpha(q.color, i % 2 ? BAND_ALPHA : BAND_ALPHA / 2)));
    }
    stroke(ctx, d, env, 1);
    for (const l of lines) {
      ctx.strokeStyle = l.color;
      line(ctx, l.from, l.to);
    }
    if (s.showLabel === false) return;
    // Beside the line's left end (or with labelSide 'right' its right end), moved along it to stay on screen while the line is.
    // A price label shows the price where it sits; its room is the wider of the texts at the line's ends.
    const right = s.labelSide === 'right';
    const room = (l: LevelSegment, p: Point) => pillWidth(env, levelText(env, s, l.value, env.yToPrice(p.y)), s);
    const labels = lines.map((l): LevelLabel => {
      const w = Math.max(room(l, l.from), room(l, l.to)) + 8;
      const x = right ? Math.max(Math.min(l.to.x, env.width - w), l.from.x) : Math.min(Math.max(l.from.x, w), l.to.x);
      const y = l.to.x === l.from.x ? l.from.y : l.from.y + ((x - l.from.x) * (l.to.y - l.from.y)) / (l.to.x - l.from.x);
      return { text: levelText(env, s, l.value, env.yToPrice(y)), x: right ? x + 6 : x - 6, y, color: l.color, align: right ? 'left' : 'right' };
    });
    levelLabels(ctx, env, labels, s);
  },
  hitTest: (d, p, env) => channelLayout(d, env).some((l) => distToSegment(p, l.from, l.to) <= HIT),
};

/**
 * Fibonacci numbers: time zones fall this many anchor distances from the first
 * anchor. They are counts, not ratios of a move, so the level color rule does
 * not apply and the zones draw in the drawing's color.
 */
const TIME_ZONE_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].map((value) => ({ value }));

/** A full-height level line of the time tools, at pane-local `x`. */
type TimeLine = ShownLevel & { x: number };

/**
 * Pane-local x of each level's line, lowest level first: `from` plus the level
 * times `step`. Bars are evenly spaced on the time axis, so the lines fall
 * whole multiples of the step's bar count apart, past the last bar too.
 */
function timeLines(d: ScreenDrawing, env: DrawingEnv, defaults: readonly DrawingLevel[], from: number, step: number): TimeLine[] {
  return styleLevels(d, env, defaults)
    .sort((x, y) => x.value - y.value)
    .map((level) => ({ ...level, x: from + step * level.value }));
}

/** Time zones: the first anchor plus each level times the distance to the second. */
function timeZones(d: ScreenDrawing, env: DrawingEnv): TimeLine[] {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  return timeLines(d, env, TIME_ZONE_LEVELS, a.x, b.x - a.x);
}

/**
 * `defaultStyle` of the tools whose labels sit right of their lines or box,
 * which is also how they draw a style without `labelSide`, so the settings
 * show what is drawn. It is where the time tools have always put them and
 * where a box drawn forward in time put its price labels; a box drawn
 * backwards in time used to label its left (far) edge and now labels its
 * right edge too.
 */
export const RIGHT_LABELS = { labelSide: 'right' } as const;

/**
 * Opacity of opt-in band `i` (from 1): the fill's own, then half of it,
 * alternating like the level tools' bands, so neighbouring bands stay apart.
 */
const bandOpacity = (i: number): number => (i % 2 ? 1 : 0.5);

/**
 * Bands between neighbouring rays from `a`, in `fill`. Each band's far side
 * lies well past the pane in both rays' directions, so no corner is cut.
 */
function fanBands(ctx: CanvasRenderingContext2D, a: Point, rays: readonly LevelSegment[], fill: string, env: DrawingEnv): void {
  const reach = 2 * (Math.abs(a.x) + Math.abs(a.y) + env.width + env.height);
  const far = (r: LevelSegment): Point => {
    const k = reach / (Math.hypot(r.to.x - a.x, r.to.y - a.y) || Infinity);
    return { x: a.x + (r.to.x - a.x) * k, y: a.y + (r.to.y - a.y) * k };
  };
  ctx.fillStyle = fill;
  for (let i = 1; i < rays.length; i++) {
    const [p, q] = [far(rays[i - 1]!), far(rays[i]!)];
    ctx.globalAlpha = bandOpacity(i);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Full-height lines, labelled with their level along the bottom of the pane. */
function renderTimeLines(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, lines: readonly TimeLine[]): void {
  const fill = fillOf(d.drawing.style, NO_FILL);
  if (fill !== NO_FILL) {
    // Full-height bands between neighbouring lines.
    ctx.fillStyle = fill;
    for (let i = 1; i < lines.length; i++) {
      ctx.globalAlpha = bandOpacity(i);
      ctx.fillRect(lines[i - 1]!.x, 0, lines[i]!.x - lines[i - 1]!.x, env.height);
    }
    ctx.globalAlpha = 1;
  }
  stroke(ctx, d, env, 1);
  for (const z of lines) {
    const x = sharp(z.x);
    ctx.strokeStyle = z.color;
    line(ctx, { x, y: 0 }, { x, y: env.height });
  }
  const s = d.drawing.style;
  if (s.showLabel === false) return;
  const y = env.height - pillHeight(env, s) / 2 - 4;
  // Right of each line unless labelSide is 'left'.
  const left = s.labelSide === 'left';
  const label = (z: TimeLine): LevelLabel => ({ text: levelText(env, s, z.value), x: z.x + (left ? -4 : 4), y, color: z.color, align: left ? 'right' : 'left' });
  levelLabels(ctx, env, lines.map(label), s);
}

/**
 * Time span of lines or rays leaving `origin` (default the first anchor), open
 * in price. `reach` gives the directions a level's lines run in, as multiples
 * of the step from the first anchor to the second; a line with direction 0
 * stays at the origin.
 */
function levelTimeBounds(
  d: Drawing,
  defaults: readonly DrawingLevel[],
  reach: (k: number) => number[],
  origin: DrawingPoint = d.points[0]!,
): DrawingModelBounds {
  const a = origin;
  const step = (d.points[1] ?? d.points[0]!).time - d.points[0]!.time;
  const dirs = visibleLevels(d.style, defaults).flatMap((l) => reach(l.value).map((k) => Math.sign(step * k)));
  return {
    from: dirs.some((dir) => dir < 0) ? -Infinity : a.time,
    to: dirs.some((dir) => dir > 0) ? Infinity : a.time,
    low: -Infinity,
    high: Infinity,
  };
}

export const fibTimeZone: DrawingToolDef = {
  type: 'fib-time-zone',
  label: 'Fib time zone',
  group: 'time',
  points: 2,
  // Only the anchors' times matter.
  snap: 'time',
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(TIME_ZONE_LEVELS), ...RIGHT_LABELS },
  // `fill` is opt-in, as on the time cycles: unset, no bands.
  styleFields: ['color', 'lineWidth', 'lineStyle', 'levels', 'showLabel', 'labelSide', 'labelContent', ...TEXT_FIELDS, 'fill'],
  modelBounds: (d) => levelTimeBounds(d, TIME_ZONE_LEVELS, (k) => [k]),
  axisMarks: (d) => ({ times: d.points.map((p) => p.time) }),
  cursor: () => 'ew-resize',
  render: (ctx, d, env) => renderTimeLines(ctx, d, env, timeZones(d, env)),
  hitTest: (d, p, env) => timeZones(d, env).some((z) => Math.abs(p.x - z.x) <= HIT),
};

/**
 * Fractions of the trend's duration, projected from the third anchor: 0 (the
 * third anchor itself) and the powers of the golden ratio from φ⁻² to φ²,
 * rounded to three decimals like `FIB_LEVELS`.
 */
const TREND_TIME_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels([0, 0.382, 0.618, 1, 1.618, 2.618]);

/**
 * Lines of the trend-based time tool: the duration of the move from the first
 * anchor to the second, times each level, counted from the third anchor (the
 * second until the third is placed).
 */
function trendTimes(d: ScreenDrawing, env: DrawingEnv): TimeLine[] {
  const [a, b = a, c = b] = d.points as [Point, Point?, Point?];
  return timeLines(d, env, TREND_TIME_LEVELS, c.x, b.x - a.x);
}

/** Trend-based Fibonacci time: full-height lines at fractions of a move's duration, projected from a third point. */
export const fibTime: DrawingToolDef = {
  type: 'fib-time',
  label: 'Trend-based Fib time',
  group: 'time',
  points: 3,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(TREND_TIME_LEVELS), ...RIGHT_LABELS },
  styleFields: ['color', 'lineWidth', 'lineStyle', 'levels', 'showLabel', 'labelSide', 'labelContent', ...TEXT_FIELDS, 'fill'],
  // The lines leave the third anchor; the guide spans the anchors.
  modelBounds(d) {
    const lines = levelTimeBounds(d, TREND_TIME_LEVELS, (k) => [k], d.points[2] ?? d.points[1]);
    const anchors = pointBounds(d);
    return { ...lines, from: Math.min(lines.from, anchors.from), to: Math.max(lines.to, anchors.to) };
  },
  render(ctx, d, env) {
    // Dashed guide through the anchors.
    ctx.strokeStyle = withAlpha(d.drawing.style.color ?? env.theme.drawing, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let i = 1; i < d.points.length; i++) line(ctx, d.points[i - 1]!, d.points[i]!);
    renderTimeLines(ctx, d, env, trendTimes(d, env));
  },
  hitTest(d, p, env) {
    for (let i = 1; i < d.points.length; i++) if (distToSegment(p, d.points[i - 1]!, d.points[i]!) <= HIT) return true;
    return trendTimes(d, env).some((z) => Math.abs(p.x - z.x) <= HIT);
  },
};

/** A level at a point on the edge of a box. */
type EdgeLevel = ShownLevel & Point;

/**
 * Labels of the levels on the far edges of the box from `a` to `b`: price
 * levels beside the edge at `b`'s time, time levels past the edge at its
 * price. With `sided`, the style's `labelSide` puts the price labels beside
 * the box's left or right edge instead, the right one when unset (see
 * `RIGHT_LABELS`). `text` formats a level's value; without it the labels
 * show the style's `labelContent`, the price ones with their price.
 */
export function edgeLabels(
  ctx: CanvasRenderingContext2D,
  env: DrawingEnv,
  style: DrawingStyle,
  a: Point,
  b: Point,
  price: readonly EdgeLevel[],
  time: readonly EdgeLevel[],
  text?: (value: number) => string,
  sided = false,
): void {
  if (style.showLabel === false) return;
  const side = sided ? (style.labelSide ?? 'right') : undefined;
  const right = side ? side === 'right' : b.x >= a.x;
  const edge = side ? (right ? Math.max(a.x, b.x) : Math.min(a.x, b.x)) : b.x;
  const offset = (pillHeight(env, style) / 2 + 4) * (b.y <= a.y ? -1 : 1);
  const labels = [
    ...price.map((l): LevelLabel => ({ text: text?.(l.value) ?? levelText(env, style, l.value, env.yToPrice(l.y)), x: edge + (right ? 4 : -4), y: l.y, color: l.color, align: right ? 'left' : 'right' })),
    ...time.map((l): LevelLabel => ({ text: text?.(l.value) ?? levelText(env, style, l.value), x: l.x, y: b.y + offset, color: l.color, align: 'center' })),
  ];
  levelLabels(ctx, env, labels, style);
}

/** A Fibonacci tool, so its rays sit at the Fibonacci ratios of the retracement. */
const SPEED_FAN_LEVELS: readonly DrawingLevel[] = RETRACEMENT_LEVELS;

interface SpeedFanLayout {
  /** Rays from the first anchor through each level's point on the box edge at the second anchor's time. */
  price: LevelSegment[];
  /** Rays from the first anchor through each level's point on the box edge at the second anchor's price. */
  time: LevelSegment[];
  /** Points the rays pass on the box edges, where the grid lines and labels go. */
  priceAt: Point[];
  timeAt: Point[];
}

/**
 * Speed fan of the box between A and B: level k sits k of the way back from B
 * towards A, in price on B's time edge and in time on B's price edge. Level 0
 * is the line through B, which only the price rays draw.
 */
function speedFanLayout(d: ScreenDrawing, env: DrawingEnv): SpeedFanLayout {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const levels = styleLevels(d, env, SPEED_FAN_LEVELS).sort((x, y) => x.value - y.value);
  const ray = (level: ShownLevel, through: Point): LevelSegment => ({ ...level, from: a, to: rayEnd(a, through, env.width, env.height) });
  const priceAt = levels.map((l) => ({ x: b.x, y: b.y + (a.y - b.y) * l.value }));
  const timeLevels = levels.filter((l) => l.value !== 0);
  const timeAt = timeLevels.map((l) => ({ x: b.x + (a.x - b.x) * l.value, y: b.y }));
  return {
    price: levels.map((l, i) => ray(l, priceAt[i]!)),
    time: timeLevels.map((l, i) => ray(l, timeAt[i]!)),
    priceAt,
    timeAt,
  };
}

export const fibSpeedFan: DrawingToolDef = {
  type: 'fib-speed-fan',
  label: 'Fib speed resistance fan',
  group: 'ratios',
  points: 2,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(SPEED_FAN_LEVELS), ...RIGHT_LABELS },
  // `fill` is opt-in: unset, the fan draws no bands, as before it had the field.
  styleFields: ['color', 'lineWidth', 'lineStyle', 'levels', 'showLabel', 'labelSide', 'labelContent', ...TEXT_FIELDS, 'fill'],
  // Price rays run towards B's side; a time ray points back past A for levels above 1.
  modelBounds: (d) => levelTimeBounds(d, SPEED_FAN_LEVELS, (k) => [1, 1 - k]),
  render(ctx, d, env) {
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    const l = speedFanLayout(d, env);
    const fill = fillOf(d.drawing.style, NO_FILL);
    if (fill !== NO_FILL) for (const rays of [l.price, l.time]) fanBands(ctx, a, rays, fill, env);
    // Faint grid across the box at each level.
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    l.price.forEach((r, i) => {
      ctx.strokeStyle = withAlpha(r.color, 0.3);
      line(ctx, { x: a.x, y: l.priceAt[i]!.y }, l.priceAt[i]!);
    });
    l.time.forEach((r, i) => {
      ctx.strokeStyle = withAlpha(r.color, 0.3);
      line(ctx, { x: l.timeAt[i]!.x, y: a.y }, l.timeAt[i]!);
    });
    stroke(ctx, d, env, 1);
    for (const r of [...l.price, ...l.time]) {
      ctx.strokeStyle = r.color;
      line(ctx, r.from, r.to);
    }
    const price = l.price.map((r, i) => ({ ...r, ...l.priceAt[i]! }));
    edgeLabels(ctx, env, d.drawing.style, a, b, price, l.time.map((r, i) => ({ ...r, ...l.timeAt[i]! })), undefined, true);
  },
  hitTest(d, p, env) {
    const l = speedFanLayout(d, env);
    return [...l.price, ...l.time].some((r) => distToSegment(p, r.from, r.to) <= HIT);
  },
};

/** Levels of the circle, arc and wedge tools: radii as fractions of the distance between two anchors. */
const ARC_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ CHANNEL_LEVELS.filter((l) => l.value > 0);

/** A level of the circle, arc and wedge tools: an arc of radius `r` px around the layout's centre. */
interface LevelArc extends ShownLevel {
  r: number;
}

/**
 * Concentric level arcs, in pane pixels so they keep their shape on any price
 * scale. Angles are canvas angles (0 points right, positive turns clockwise
 * on screen); every arc runs `sweep` radians from `start`.
 */
interface ArcLayout {
  center: Point;
  start: number;
  sweep: number;
  /** Levels with a positive radius, smallest first. */
  arcs: LevelArc[];
}

/** Each visible level's arc, its radius the level times `unit` px. */
function arcLayout(d: ScreenDrawing, env: DrawingEnv, center: Point, unit: number, start: number, sweep: number): ArcLayout {
  const arcs = styleLevels(d, env, ARC_LEVELS)
    .map((l) => ({ ...l, r: unit * l.value }))
    .filter((a) => a.r > 0)
    .sort((x, y) => x.r - y.r);
  return { center, start, sweep, arcs };
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const angleOf = (from: Point, to: Point): number => Math.atan2(to.y - from.y, to.x - from.x);

function arcPath(ctx: CanvasRenderingContext2D, l: ArcLayout, r: number, reverse = false): void {
  const [from, to] = reverse ? [l.start + l.sweep, l.start] : [l.start, l.start + l.sweep];
  ctx.arc(l.center.x, l.center.y, r, from, to, (l.sweep < 0) !== reverse);
}

/** Bands between neighbouring arcs, the arcs, and a label on each at `labelAngle`. */
function renderArcs(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, l: ArcLayout, labelAngle: number): void {
  const s = d.drawing.style;
  for (let i = 1; i < l.arcs.length; i++) {
    const [inner, outer] = [l.arcs[i - 1]!, l.arcs[i]!];
    ctx.beginPath();
    arcPath(ctx, l, outer.r);
    arcPath(ctx, l, inner.r, true);
    ctx.closePath();
    ctx.fillStyle = fillOf(s, withAlpha(outer.color, i % 2 ? BAND_ALPHA : BAND_ALPHA / 2));
    ctx.fill();
  }
  stroke(ctx, d, env, 1);
  for (const a of l.arcs) {
    ctx.strokeStyle = a.color;
    ctx.beginPath();
    arcPath(ctx, l, a.r);
    ctx.stroke();
  }
  if (s.showLabel === false) return;
  const label = (a: LevelArc): LevelLabel => {
    const at = onCircle(l.center, a.r, labelAngle);
    return { text: levelText(env, s, a.value), x: at.x, y: at.y, color: a.color, align: 'center' };
  };
  levelLabels(ctx, env, l.arcs.map(label), s);
}

/** Whether `p` lies on one of the arcs, or within reach of an arc's ends. */
function hitArcs(l: ArcLayout, p: Point): boolean {
  const dist = distance(l.center, p);
  const angle = angleOf(l.center, p);
  return l.arcs.some(
    (a) =>
      Math.abs(dist - a.r) <= HIT &&
      (angleInSweep(angle, l.start, l.sweep) ||
        distance(p, onCircle(l.center, a.r, l.start)) <= HIT ||
        distance(p, onCircle(l.center, a.r, l.start + l.sweep)) <= HIT),
  );
}

/** Box of the largest arc, or null before the drawing has any size. */
function arcsExtent(l: ArcLayout): Rect | null {
  const outer = l.arcs[l.arcs.length - 1];
  return outer ? arcBounds(l.center, outer.r, l.start, l.sweep) : null;
}

/** Dashed guide between two anchors. */
function guide(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, a: Point, b: Point): void {
  ctx.strokeStyle = withAlpha(d.drawing.style.color ?? env.theme.drawing, 0.5);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  line(ctx, a, b);
}

export const ARC_FIELDS = ['color', 'fill', 'lineWidth', 'lineStyle', 'levels', 'showLabel', 'labelContent', ...TEXT_FIELDS, 'showFill'];

/** Circles around the first anchor, level 1 through the second. */
function circlesLayout(d: ScreenDrawing, env: DrawingEnv): ArcLayout {
  const a = d.points[0]!;
  return arcLayout(d, env, a, distance(a, d.points[1] ?? a), 0, TAU);
}

/** Fibonacci circles: concentric circles around the first point, the second on level 1. */
export const fibCircles: DrawingToolDef = {
  type: 'fib-circles',
  label: 'Fib circles',
  group: 'ratios',
  points: 2,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(ARC_LEVELS) },
  styleFields: ARC_FIELDS,
  fillAlpha: BAND_ALPHA,
  bounds: (d, env) => arcsExtent(circlesLayout(d, env)),
  render(ctx, d, env) {
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    guide(ctx, d, env, a, b);
    // Labels on the side away from the second anchor, so they never cover it.
    renderArcs(ctx, d, env, circlesLayout(d, env), angleOf(b, a));
  },
  hitTest(d, p, env) {
    const a = d.points[0]!;
    return distToSegment(p, a, d.points[1] ?? a) <= HIT || hitArcs(circlesLayout(d, env), p);
  },
};

/**
 * Half circles around the end of the move (the second anchor), on the start's
 * side of the horizontal through the end: below it after a rise, above it after
 * a fall. Level 1 passes the start's distance.
 */
function arcsLayout(d: ScreenDrawing, env: DrawingEnv): ArcLayout {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  return arcLayout(d, env, b, distance(a, b), a.y >= b.y ? 0 : Math.PI, Math.PI);
}

/** Fibonacci arcs: half circles around the end of a move, at fractions of its length. */
export const fibArcs: DrawingToolDef = {
  type: 'fib-arcs',
  label: 'Fib arcs',
  group: 'ratios',
  points: 2,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(ARC_LEVELS) },
  styleFields: ARC_FIELDS,
  fillAlpha: BAND_ALPHA,
  bounds: (d, env) => arcsExtent(arcsLayout(d, env)),
  render(ctx, d, env) {
    const a = d.points[0]!;
    guide(ctx, d, env, a, d.points[1] ?? a);
    const l = arcsLayout(d, env);
    // Labels at the top or bottom of each arc.
    renderArcs(ctx, d, env, l, l.start + l.sweep / 2);
  },
  hitTest(d, p, env) {
    const a = d.points[0]!;
    return distToSegment(p, a, d.points[1] ?? a) <= HIT || hitArcs(arcsLayout(d, env), p);
  },
};

interface WedgeLayout extends ArcLayout {
  /** Ends of the two edges from the apex, as long as the larger of the outer arc and the first edge. */
  edges: [Point, Point];
}

/**
 * Arcs around the apex (the first anchor) between its edges through the second
 * and third anchors, across the smaller angle; level 1 passes the second
 * anchor. Until the third anchor is placed both edges run through the second.
 */
function wedgeLayout(d: ScreenDrawing, env: DrawingEnv): WedgeLayout {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const c = d.points[2] ?? b;
  const start = angleOf(a, b);
  const turn = (((angleOf(a, c) - start) % TAU) + TAU) % TAU;
  const sweep = c === b || distance(a, c) === 0 ? 0 : turn > Math.PI ? turn - TAU : turn;
  const l = arcLayout(d, env, a, distance(a, b), start, sweep);
  const reach = Math.max(distance(a, b), l.arcs[l.arcs.length - 1]?.r ?? 0);
  return { ...l, edges: [onCircle(a, reach, start), onCircle(a, reach, start + sweep)] };
}

/** Fibonacci wedge: arcs at fractions of an edge's length, between two edges from an apex. */
export const fibWedge: DrawingToolDef = {
  type: 'fib-wedge',
  label: 'Fib wedge',
  group: 'ratios',
  points: 3,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(ARC_LEVELS) },
  styleFields: ARC_FIELDS,
  fillAlpha: BAND_ALPHA,
  bounds(d, env) {
    const l = wedgeLayout(d, env);
    const box = arcsExtent(l);
    const xs = [...l.edges.map((p) => p.x), ...(box ? [box.x, box.x + box.width] : [])];
    const ys = [...l.edges.map((p) => p.y), ...(box ? [box.y, box.y + box.height] : [])];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  },
  render(ctx, d, env) {
    const l = wedgeLayout(d, env);
    stroke(ctx, d, env, 1);
    for (const e of l.edges) line(ctx, l.center, e);
    // Labels in the middle of each arc.
    renderArcs(ctx, d, env, l, l.start + l.sweep / 2);
  },
  hitTest(d, p, env) {
    const l = wedgeLayout(d, env);
    return l.edges.some((e) => distToSegment(p, l.center, e) <= HIT) || hitArcs(l, p);
  },
};

/**
 * Growth rate per radian of the golden spiral, r = R·e^(k·t): ln(φ) / (π / 2), so the radius grows
 * by the golden ratio φ every quarter turn. A literal, because a computed top-level value would stay
 * in bundles that never register the drawing tools.
 */
const SPIRAL_GROWTH = 0.30634896253003313;

/**
 * Points of a logarithmic spiral around `center` through `through`, whose
 * radius grows by the golden ratio every quarter turn: the curve that nested
 * Fibonacci squares approximate. Growing outwards it turns anticlockwise on
 * screen. It winds inwards until its radius drops below `inner` px and
 * outwards until it passes `outer` px (at least as far as `through`), with a
 * point every `step` radians. Empty when `through` lies within `inner` of the
 * centre.
 */
export function goldenSpiral(center: Point, through: Point, outer: number, inner = 0.5, step = Math.PI / 32): Point[] {
  const r = distance(center, through);
  if (!(r > inner) || !Number.isFinite(r)) return [];
  const angle = angleOf(center, through);
  const from = Math.log(inner / r) / SPIRAL_GROWTH;
  const to = Math.max(0, Math.log(Math.min(outer, 1e6) / r) / SPIRAL_GROWTH);
  // Whole steps from `through`, so it lies on the curve exactly, plus both ends.
  const ts = [from];
  for (let i = Math.floor(from / step) + 1; i * step < to; i++) if (i * step > from) ts.push(i * step);
  ts.push(to);
  return ts.map((t) => onCircle(center, r * Math.exp(SPIRAL_GROWTH * t), angle - t));
}

/** Spiral around the first anchor through the second, out past the pane's farthest corner. */
function spiralLayout(d: ScreenDrawing, env: DrawingEnv): Point[] {
  const a = d.points[0]!;
  const corners = [0, env.width].flatMap((x) => [0, env.height].map((y) => distance(a, { x, y })));
  return goldenSpiral(a, d.points[1] ?? a, Math.max(...corners));
}

/** Fibonacci spiral: a golden spiral around the first point, passing through the second. */
export const fibSpiral: DrawingToolDef = {
  type: 'fib-spiral',
  label: 'Fib spiral',
  group: 'ratios',
  points: 2,
  styleFields: LINE_FIELDS,
  bounds(d, env) {
    const pts = spiralLayout(d, env);
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  },
  render(ctx, d, env) {
    const a = d.points[0]!;
    guide(ctx, d, env, a, d.points[1] ?? a);
    const pts = spiralLayout(d, env);
    if (pts.length === 0) return;
    stroke(ctx, d, env);
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  },
  hitTest(d, p, env) {
    const a = d.points[0]!;
    if (distToSegment(p, a, d.points[1] ?? a) <= HIT) return true;
    const pts = spiralLayout(d, env);
    return pts.some((q, i) => i > 0 && distToSegment(p, pts[i - 1]!, q) <= HIT);
  },
};
