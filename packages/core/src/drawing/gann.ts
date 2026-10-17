import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { BAND_ALPHA, fillOf, HIT, line, stroke } from './draw';
import { ARC_FIELDS, copyLevels, edgeLabels, formatLevel, type LevelSegment, RIGHT_LABELS, type ShownLevel, styleLevels } from './fibonacci';
import { distToSegment, normalizedRect } from './geometry';
import { ruleLevels } from './level-color';
import type { DrawingEnv, DrawingLevel, DrawingModelBounds, DrawingStyle, DrawingToolDef, ScreenDrawing } from './types';

/**
 * The Gann tools, laid out in pane pixels from the projected anchors so they
 * keep their shape on log and percent scales. Levels and bands come from the
 * style's `levels` and `fill`, as on the Fibonacci tools.
 */

/** Gann's division of a range into quarters, the grid of the Gann square. */
const QUARTER_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels([0, 1 / 4, 1 / 2, 3 / 4, 1]);

/**
 * Gann's range divisions: eighths and thirds. The quarters show, as on the
 * Gann square; the odd eighths and the thirds are listed but hidden.
 */
const GANN_BOX_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels(
  [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1],
  (v) => (v * 4) % 1 === 0,
);

/** Fill of band `i` between two levels: the style's `fill`, or the level's color, alternating in strength. */
const band = (s: DrawingStyle, level: ShownLevel, i: number) => fillOf(s, withAlpha(level.color, i % 2 ? BAND_ALPHA : BAND_ALPHA / 2));

/** A line of the layout in the drawing's own color. */
const plain = (d: ScreenDrawing, env: DrawingEnv, from: Point, to: Point): LevelSegment => ({
  value: NaN,
  color: d.drawing.style.color ?? env.theme.drawing,
  from,
  to,
});

interface GridLayout {
  /** Corners of the box: the first anchor and the second (or, for the fixed square, the corner it sets). */
  a: Point;
  b: Point;
  /** Corners of the grid: the box stretched to the outermost levels. */
  from: Point;
  to: Point;
  /** Visible levels, lowest first, at their point on the box's diagonal. */
  levels: (ShownLevel & Point)[];
  lines: LevelSegment[];
}

/**
 * Grid of the box between the anchors, cut in price and in time at each
 * level. `square` keeps the box square in pane pixels: the second anchor sets
 * its width and whether it grows up or down. `angles` adds the box's
 * diagonals and lines from the first anchor to each level inside 0..1 on the
 * far edges.
 */
function gridLayout(d: ScreenDrawing, env: DrawingEnv, defaults: readonly DrawingLevel[], square: boolean, angles: boolean): GridLayout {
  const a = d.points[0]!;
  let b = d.points[1] ?? a;
  if (square) b = { x: b.x, y: a.y + Math.abs(b.x - a.x) * (b.y < a.y ? -1 : 1) };
  const at = (k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const levels = styleLevels(d, env, defaults)
    .sort((x, y) => x.value - y.value)
    .map((l) => ({ ...l, ...at(l.value) }));
  const from = at(Math.min(0, levels[0]?.value ?? 0));
  const to = at(Math.max(1, levels[levels.length - 1]?.value ?? 1));
  const lines = levels.flatMap((l): LevelSegment[] => [
    { ...l, from: { x: from.x, y: l.y }, to: { x: to.x, y: l.y } },
    { ...l, from: { x: l.x, y: from.y }, to: { x: l.x, y: to.y } },
  ]);
  if (angles) {
    lines.push(plain(d, env, a, b), plain(d, env, { x: a.x, y: b.y }, { x: b.x, y: a.y }));
    for (const l of levels) {
      if (l.value <= 0 || l.value >= 1) continue;
      lines.push({ ...l, from: a, to: { x: b.x, y: l.y } }, { ...l, from: a, to: { x: l.x, y: b.y } });
    }
  }
  return { a, b, from, to, levels, lines };
}

/** Stroke each line in its own color. */
function strokeLines(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, lines: readonly LevelSegment[]): void {
  stroke(ctx, d, env, 1);
  for (const l of lines) {
    ctx.strokeStyle = l.color;
    line(ctx, l.from, l.to);
  }
}

const hitLines = (lines: readonly LevelSegment[], p: Point): boolean => lines.some((l) => distToSegment(p, l.from, l.to) <= HIT);

/** A grid tool: `square` and `angles` as in `gridLayout`. */
function gridTool(type: string, label: string, defaults: readonly DrawingLevel[], square: boolean, angles: boolean): DrawingToolDef {
  const layout = (d: ScreenDrawing, env: DrawingEnv) => gridLayout(d, env, defaults, square, angles);
  return {
    type,
    label,
    group: 'ratios',
    points: 2,
    defaultStyle: { levels: copyLevels(defaults), ...RIGHT_LABELS },
    styleFields: [...ARC_FIELDS, 'labelSide'],
    fillAlpha: BAND_ALPHA,
    bounds(d, env): Rect {
      const l = layout(d, env);
      return normalizedRect(l.from, l.to);
    },
    render(ctx, d, env) {
      const l = layout(d, env);
      const s = d.drawing.style;
      const left = Math.min(l.from.x, l.to.x);
      const width = Math.abs(l.to.x - l.from.x);
      for (let i = 1; i < l.levels.length; i++) {
        const [p, q] = [l.levels[i - 1]!, l.levels[i]!];
        ctx.fillStyle = band(s, q, i);
        ctx.fillRect(left, Math.min(p.y, q.y), width, Math.abs(q.y - p.y));
      }
      strokeLines(ctx, d, env, l.lines);
      edgeLabels(ctx, env, s, l.from, l.to, l.levels, l.levels, undefined, true);
    },
    hitTest: (d, p, env) => hitLines(layout(d, env).lines, p),
  };
}

/** Gann box: the box between two points, cut in price and in time at each level. */
export const gannBox = /* @__PURE__ */ gridTool('gann-box', 'Gann box', GANN_BOX_LEVELS, false, false);

/** Gann square: a grid at quarter levels with the box's diagonals and the angles from the first point. */
export const gannSquare = /* @__PURE__ */ gridTool('gann-square', 'Gann square', QUARTER_LEVELS, false, true);

/** Fixed Gann square: a Gann square kept square on screen, as wide as the second point is from the first. */
export const gannSquareFixed = /* @__PURE__ */ gridTool('gann-square-fixed', 'Gann square fixed', QUARTER_LEVELS, true, true);

/** Price to time ratios of the fan's rays: 1x8 (shallowest) to 8x1 (steepest), 1x1 through the second point. */
const FAN_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels([1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]);

/** A ratio as price units per time unit: `1x4` below 1, `4x1` from 1 up. */
export const gannRatio = (r: number): string => (r > 0 && r < 1 ? `1x${formatLevel(1 / r)}` : `${formatLevel(r)}x1`);

/**
 * Rays of a Gann fan, lowest ratio first. The anchors set the 1x1 slope; a
 * ray at ratio r moves r times as far in price for the same time. Each ray
 * runs from the first anchor past every edge of the pane, so the bands
 * between neighbours need no clipping.
 */
export function gannFanLayout(d: ScreenDrawing, env: DrawingEnv): LevelSegment[] {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = Math.abs(a.x) + Math.abs(a.y) + env.width + env.height;
  return styleLevels(d, env, FAN_LEVELS)
    .sort((x, y) => x.value - y.value)
    .map((l) => {
      const k = reach / (Math.hypot(dx, dy * l.value) || Infinity);
      return { ...l, from: a, to: { x: a.x + dx * k, y: a.y + dy * l.value * k } };
    });
}

/** Gann fan: rays from the first point at fixed price to time ratios, the 1x1 ray through the second point. */
export const gannFan: DrawingToolDef = {
  type: 'gann-fan',
  label: 'Gann fan',
  group: 'ratios',
  points: 2,
  defaultStyle: { levels: /* @__PURE__ */ copyLevels(FAN_LEVELS) },
  // Its labels name the rays' ratios, not levels, so it has no label content.
  styleFields: /* @__PURE__ */ ARC_FIELDS.filter((f) => f !== 'labelContent'),
  fillAlpha: BAND_ALPHA,
  // The rays run from the first point towards the second's side, at any price.
  modelBounds(d): DrawingModelBounds {
    const a = d.points[0]!;
    const right = (d.points[1] ?? a).time >= a.time;
    return { from: right ? a.time : -Infinity, to: right ? Infinity : a.time, low: -Infinity, high: Infinity };
  },
  render(ctx, d, env) {
    const rays = gannFanLayout(d, env);
    const s = d.drawing.style;
    for (let i = 1; i < rays.length; i++) {
      const [p, q] = [rays[i - 1]!, rays[i]!];
      ctx.fillStyle = band(s, q, i);
      ctx.beginPath();
      ctx.moveTo(p.from.x, p.from.y);
      ctx.lineTo(p.to.x, p.to.y);
      ctx.lineTo(q.to.x, q.to.y);
      ctx.fill();
    }
    strokeLines(ctx, d, env, rays);
    // Ratio labels where the rays leave the box between the points.
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    const flat = rays.filter((r) => Math.abs(r.value) <= 1).map((r) => ({ ...r, x: b.x, y: a.y + (b.y - a.y) * r.value }));
    const steep = rays.filter((r) => Math.abs(r.value) > 1).map((r) => ({ ...r, x: a.x + (b.x - a.x) / r.value, y: b.y }));
    edgeLabels(ctx, env, s, a, b, flat, steep, gannRatio);
  },
  hitTest: (d, p, env) => hitLines(gannFanLayout(d, env), p),
};
