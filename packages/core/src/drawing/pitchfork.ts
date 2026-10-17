import type { Point } from '../types';
import { withAlpha } from '../util/color';
import { fillOf, HIT, line, stroke, TEXT_FIELDS } from './draw';
import { type LevelLabel, levelLabels, levelText, visibleLevels } from './fibonacci';
import { distToSegment } from './geometry';
import { resolveLevelColor, ruleLevels } from './level-color';
import type { Drawing, DrawingEnv, DrawingLevel, DrawingModelBounds, DrawingStyle, DrawingToolDef, ScreenDrawing } from './types';

/**
 * Where a pitchfork's median line starts. Every variant aims the median line
 * at the midpoint of the second and third anchors (B and C); they differ in
 * the origin:
 * - `'standard'`: the first anchor A.
 * - `'schiff'`: A's time, halfway between A and B in price.
 * - `'modified-schiff'`: halfway between A and B in time and price.
 * - `'inside'`: halfway between A and C in time and price, so the median runs
 *   parallel to A→B inside the triangle of the anchors.
 */
export type PitchforkVariant = 'standard' | 'schiff' | 'modified-schiff' | 'inside';

/** A pitchfork's median line: from `origin` through `mid`, the midpoint of B and C. */
export interface PitchforkMedian {
  origin: Point;
  mid: Point;
}

const midpoint = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/**
 * Median line of a pitchfork with anchors `a`, `b` and `c`. Works on any
 * plane: pane pixels, or time (x) and price (y).
 */
export function pitchforkMedian(variant: PitchforkVariant, a: Point, b: Point, c: Point): PitchforkMedian {
  const mid = midpoint(b, c);
  switch (variant) {
    case 'schiff':
      return { origin: { x: a.x, y: (a.y + b.y) / 2 }, mid };
    case 'modified-schiff':
      return { origin: midpoint(a, b), mid };
    case 'inside':
      return { origin: midpoint(a, c), mid };
    default:
      return { origin: a, mid };
  }
}

/**
 * Default levels, from the method's geometry: multiples of the distance from
 * the median line to the tines through B and C. The tines (1) show; the
 * halfway lines (0.5) and the warning lines at two and three times the tine
 * distance are listed but hidden. Colors come from the shared level rule.
 */
const PITCHFORK_LEVELS: readonly DrawingLevel[] = /* @__PURE__ */ ruleLevels([0.5, 1, 2, 3], (v) => v === 1);

/** Visible levels of a style, or of the defaults, innermost first; styles may come from storage, so malformed entries are dropped. */
const forkLevels = (style: DrawingStyle) => visibleLevels(style, PITCHFORK_LEVELS).sort((x, y) => Math.abs(x.value) - Math.abs(y.value));

/** A line from `from` running past `to`, which lies well outside the pane. */
type Ray = [Point, Point];

interface PitchforkLayout {
  /** Median line, or null while it has no direction. */
  median: Ray | null;
  /** Level lines, two per level (B's side, C's side), innermost first. */
  /** Each level's value, color and two lines, with the points where they cross the B–C line. */
  levels: { value: number; color: string; sides: [Ray, Ray]; starts: [Point, Point] }[];
  /** The B–C line, reaching the outermost visible level. */
  base: [Point, Point];
  /** From A to a median origin that is not A. */
  guide: [Point, Point] | null;
  /** Where the bands next to the median start: the B–C midpoint for forks, A for fans. */
  bandStart: Point;
}

/** Point on the line from `from` through `through`, `length` px away (at least `through`); null if they coincide. */
function far(from: Point, through: Point, length: number): Point | null {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const t = Math.max(1, length / len);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function layout(d: ScreenDrawing, env: DrawingEnv, variant: PitchforkVariant, fan: boolean): PitchforkLayout {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const c = d.points[2] ?? b;
  const { origin, mid } = pitchforkMedian(variant, a, b, c);
  // Long enough to leave the pane from anywhere on it; the canvas clips the rest.
  const reach = 4 * (env.width + env.height) + Math.hypot(mid.x - origin.x, mid.y - origin.y);
  const color = d.drawing.style.color ?? env.theme.drawing;
  const half = { x: b.x - mid.x, y: b.y - mid.y };
  const onBase = (k: number): Point => ({ x: mid.x + half.x * k, y: mid.y + half.y * k });
  // Fork lines run along the median's direction; fan rays leave A through their base point.
  const ray = (p: Point): Ray | null => {
    if (fan) {
      const end = far(a, p, reach);
      return end ? [a, end] : null;
    }
    const end = far(p, { x: p.x + mid.x - origin.x, y: p.y + mid.y - origin.y }, reach);
    return end ? [p, end] : null;
  };
  const medianEnd = far(fan ? a : origin, mid, reach);
  const levels: PitchforkLayout['levels'] = [];
  let outer = 1;
  for (const l of forkLevels(d.drawing.style)) {
    const k = Math.abs(l.value);
    outer = Math.max(outer, k);
    const r1 = ray(onBase(k));
    const r2 = ray(onBase(-k));
    if (r1 && r2) levels.push({ value: k, color: resolveLevelColor(l, env.theme) ?? color, sides: [r1, r2], starts: [onBase(k), onBase(-k)] });
  }
  return {
    median: medianEnd ? [fan ? a : origin, medianEnd] : null,
    levels,
    base: [onBase(outer), onBase(-outer)],
    guide: !fan && (origin.x !== a.x || origin.y !== a.y) ? [a, origin] : null,
    bandStart: fan ? a : mid,
  };
}

/** Lines that select the drawing. */
function segments(l: PitchforkLayout): [Point, Point][] {
  const out: [Point, Point][] = [l.base];
  if (l.median) out.push(l.median);
  if (l.guide) out.push(l.guide);
  for (const level of l.levels) out.push(...level.sides);
  return out;
}

function fillBands(ctx: CanvasRenderingContext2D, d: ScreenDrawing, l: PitchforkLayout): void {
  if (!l.median) return;
  const s = d.drawing.style;
  for (const side of [0, 1] as const) {
    // Fork bands start on the B–C line, not behind it at the median's origin.
    let inner: Ray = [l.bandStart, l.median[1]];
    for (const level of l.levels) {
      const outer = level.sides[side];
      ctx.fillStyle = fillOf(s, withAlpha(level.color, PITCHFORK_ALPHA));
      ctx.beginPath();
      ctx.moveTo(inner[0].x, inner[0].y);
      ctx.lineTo(inner[1].x, inner[1].y);
      ctx.lineTo(outer[1].x, outer[1].y);
      ctx.lineTo(outer[0].x, outer[0].y);
      ctx.closePath();
      ctx.fill();
      inner = outer;
    }
  }
}

function render(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, l: PitchforkLayout): void {
  fillBands(ctx, d, l);
  const color = d.drawing.style.color ?? env.theme.drawing;
  if (l.guide) {
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    line(ctx, ...l.guide);
  }
  stroke(ctx, d, env);
  line(ctx, ...l.base);
  if (l.median) line(ctx, ...l.median);
  for (const level of l.levels) {
    ctx.strokeStyle = level.color;
    line(ctx, ...level.sides[0]);
    line(ctx, ...level.sides[1]);
  }
  const s = d.drawing.style;
  if (s.showLabel !== true) return;
  // Each level's value where its lines cross the B–C line, on the side away from where they run: for forks the lines start there; for the pitchfan the label sits on its ray, between A and the B–C line.
  const labels = l.levels.flatMap((level) =>
    level.sides.map(([from, to], i): LevelLabel => {
      const at = level.starts[i]!;
      const ahead = to.x >= from.x;
      return { text: levelText(env, s, level.value, env.yToPrice(at.y)), x: at.x + (ahead ? -4 : 4), y: at.y, color: level.color, align: ahead ? 'right' : 'left' };
    }),
  );
  levelLabels(ctx, env, labels, s);
}

/**
 * Time and price box of a pitchfork: open in price, and open in time on each
 * side a line runs towards, measured from where its lines start.
 */
function pitchforkBounds(variant: PitchforkVariant, fan: boolean) {
  return (drawing: Drawing): DrawingModelBounds => {
    const pts = drawing.points.map((p) => ({ x: p.time, y: p.price }));
    const a = pts[0]!;
    const b = pts[1] ?? a;
    const c = pts[2] ?? b;
    const { origin, mid } = pitchforkMedian(variant, a, b, c);
    const outer = Math.max(1, ...forkLevels(drawing.style).map((l) => Math.abs(l.value)));
    const starts = [...pts, origin, mid, ...[outer, -outer].map((k) => ({ x: mid.x + (b.x - mid.x) * k, y: mid.y + (b.y - mid.y) * k }))];
    const dirs = fan ? starts.slice(1).map((p) => p.x - a.x) : [mid.x - origin.x];
    const times = starts.map((p) => p.x);
    return {
      from: dirs.some((dx) => dx < 0) ? -Infinity : Math.min(...times),
      to: dirs.some((dx) => dx > 0) ? Infinity : Math.max(...times),
      low: -Infinity,
      high: Infinity,
    };
  };
}

/**
 * Level labels came later, so a pitchfork draws them only when `showLabel` is
 * true and new ones start without them: saved pitchforks keep their look.
 */
const PITCHFORK_FIELDS = ['color', 'fill', 'lineWidth', 'lineStyle', 'levels', 'showLabel', 'labelContent', ...TEXT_FIELDS, 'showFill'];
/** Opacity of a pitchfork's bands without a `fill` of their own. */
const PITCHFORK_ALPHA = 0.1;

function pitchforkTool(type: string, label: string, variant: PitchforkVariant, fan = false): DrawingToolDef {
  return {
    type,
    label,
    group: 'parallels',
    points: 3,
    defaultStyle: { levels: PITCHFORK_LEVELS.map((l) => ({ ...l })), showLabel: false },
    styleFields: PITCHFORK_FIELDS,
    fillAlpha: PITCHFORK_ALPHA,
    modelBounds: pitchforkBounds(variant, fan),
    render: (ctx, d, env) => render(ctx, d, env, layout(d, env, variant, fan)),
    hitTest: (d, p, env) => segments(layout(d, env, variant, fan)).some(([s, e]) => distToSegment(p, s, e) <= HIT),
  };
}

export const pitchfork = /* @__PURE__ */ pitchforkTool('pitchfork', 'Pitchfork', 'standard');
export const schiffPitchfork = /* @__PURE__ */ pitchforkTool('schiff-pitchfork', 'Schiff pitchfork', 'schiff');
export const modifiedSchiffPitchfork = /* @__PURE__ */ pitchforkTool('modified-schiff-pitchfork', 'Modified Schiff pitchfork', 'modified-schiff');
export const insidePitchfork = /* @__PURE__ */ pitchforkTool('inside-pitchfork', 'Inside pitchfork', 'inside');
/** Rays from A through B, C, the midpoint of B and C, and each level's point on the B–C line. */
export const pitchfan = /* @__PURE__ */ pitchforkTool('pitchfan', 'Pitchfan', 'standard', true);
