import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { arrowHead, fillOf, HIT, LINE_FIELDS, stroke, two } from './draw';
import { distToSegment, normalizedRect } from './geometry';
import type { DrawingEnv, DrawingToolDef, ScreenDrawing } from './types';

const radius = (c: Point, edge: Point): number => Math.hypot(edge.x - c.x, edge.y - c.y);
const SHAPE_FIELDS = ['color', 'fill', 'lineWidth', 'lineStyle', 'showFill'];

/** Fill with the style's `fill`, or a faint tint of the line color. */
function fillShape(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv): void {
  const color = d.drawing.style.color ?? env.theme.drawing;
  ctx.fillStyle = fillOf(d.drawing.style, withAlpha(color, 0.14));
  ctx.fill();
}

/** Begin a path through `pts`, closed back to the first when `close`. */
function trace(ctx: CanvasRenderingContext2D, pts: readonly Point[], close?: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}

/** Whether `p` lies within `reach` of the line through `pts`, closed back to the first when `close`. */
function nearPoints(p: Point, pts: readonly Point[], reach: number, close?: boolean): boolean {
  return pts.some((b, i) => distToSegment(p, pts[i ? i - 1 : close ? pts.length - 1 : 0]!, b) <= reach);
}

/** Even-odd test of `p` against the polygon through `pts`. */
function inPolygon(p: Point, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The box around `pts`. */
function boxOf(pts: readonly Point[]): Rect {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A filled three-point shape whose outline `corners` makes from the drawing's points. */
function polygonTool(type: string, label: string, corners: (pts: Point[]) => Point[]): DrawingToolDef {
  return {
    type,
    styleFields: SHAPE_FIELDS,
    label,
    group: 'annotate',
    points: 3,
    bounds: (d) => boxOf(corners(d.points)),
    render(ctx, d, env) {
      trace(ctx, corners(d.points), true);
      fillShape(ctx, d, env);
      stroke(ctx, d, env);
      ctx.stroke();
    },
    hitTest(d, p) {
      const c = corners(d.points);
      return inPolygon(p, c) || nearPoints(p, c, HIT / 2, true);
    },
  };
}

/** Circle: the first point is the centre, the second lies on the edge. */
export const circle: DrawingToolDef = {
  type: 'circle',
  styleFields: SHAPE_FIELDS,
  label: 'Circle',
  group: 'annotate',
  points: 2,
  bounds(d) {
    const [c, edge] = two(d);
    const r = radius(c, edge);
    return { x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r };
  },
  render(ctx, d, env) {
    const [c, edge] = two(d);
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius(c, edge), 0, Math.PI * 2);
    fillShape(ctx, d, env);
    stroke(ctx, d, env);
    ctx.stroke();
  },
  hitTest(d, p) {
    const [c, edge] = two(d);
    return Math.hypot(p.x - c.x, p.y - c.y) <= radius(c, edge) + HIT / 2;
  },
};

/** Ellipse inscribed in the box between two opposite corners. */
export const ellipse: DrawingToolDef = {
  type: 'ellipse',
  styleFields: SHAPE_FIELDS,
  label: 'Ellipse',
  group: 'annotate',
  points: 2,
  render(ctx, d, env) {
    const r = normalizedRect(...two(d));
    ctx.beginPath();
    ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
    fillShape(ctx, d, env);
    stroke(ctx, d, env);
    ctx.stroke();
  },
  hitTest(d, p) {
    const r = normalizedRect(...two(d));
    const rx = r.width / 2 + HIT / 2;
    const ry = r.height / 2 + HIT / 2;
    const dx = p.x - (r.x + r.width / 2);
    const dy = p.y - (r.y + r.height / 2);
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  },
};

/**
 * Rectangle at any angle: the first two points are the ends of one side, the
 * third sets how far the opposite side lies from it.
 */
export const rotatedRectangle = polygonTool('rotated-rectangle', 'Rotated rectangle', (pts) => {
  const a = pts[0]!;
  const b = pts[1] ?? a;
  const c = pts[2] ?? b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Offset of the third point across the first side, along its normal.
  const k = ((c.y - a.y) * dx - (c.x - a.x) * dy) / (dx * dx + dy * dy || 1);
  return [a, b, { x: b.x - dy * k, y: b.y + dx * k }, { x: a.x - dy * k, y: a.y + dx * k }];
});

/** Triangle through three points. */
export const triangle = polygonTool('triangle', 'Triangle', (pts) => pts);

/** Segments a curve's outline is drawn and hit-tested with. */
const SEGMENTS = 48;

/**
 * The curve from `a` to `b` that passes through `c` halfway along, as
 * `SEGMENTS` + 1 points appended to `out`: a quadratic Bézier whose control
 * point lies twice as far from the chord's midpoint as `c`.
 */
export function bend(a: Point, b: Point, c: Point, out: Point[] = []): Point[] {
  const kx = 2 * c.x - (a.x + b.x) / 2;
  const ky = 2 * c.y - (a.y + b.y) / 2;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * kx + t * t * b.x, y: u * u * a.y + 2 * u * t * ky + t * t * b.y });
  }
  return out;
}

/**
 * Two curves joined smoothly at the middle of `a`-`b`: the first passes
 * through `c`, the second through `c` mirrored at that middle, making an S.
 */
export function doubleBend(a: Point, b: Point, c: Point): Point[] {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return bend(m, b, { x: a.x + b.x - c.x, y: a.y + b.y - c.y }, bend(a, m, c));
}

/** The circular arc from `a` to `b` through `c`; the segment `a`-`b` when the three are in line. */
export function arcThrough(a: Point, b: Point, c: Point): Point[] {
  const det = 2 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (Math.abs(det) < 1e-9) return [a, b];
  const sa = a.x * a.x + a.y * a.y;
  const sb = b.x * b.x + b.y * b.y - sa;
  const sc = c.x * c.x + c.y * c.y - sa;
  // Centre of the circle through the three points.
  const ox = ((c.y - a.y) * sb - (b.y - a.y) * sc) / det;
  const oy = ((b.x - a.x) * sc - (c.x - a.x) * sb) / det;
  const r = Math.hypot(a.x - ox, a.y - oy);
  const from = Math.atan2(a.y - oy, a.x - ox);
  const turn = (q: Point): number => (Math.atan2(q.y - oy, q.x - ox) - from + 4 * Math.PI) % (2 * Math.PI);
  // Go round the way that passes `c`.
  let sweep = turn(b);
  if (turn(c) > sweep) sweep -= 2 * Math.PI;
  return Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const t = from + (sweep * i) / SEGMENTS;
    return { x: ox + r * Math.cos(t), y: oy + r * Math.sin(t) };
  });
}

/**
 * A three-point line tool: `outline` runs from the first point to the second,
 * shaped by the third (the chord's midpoint until it is placed).
 */
function curveTool(type: string, label: string, outline: (a: Point, b: Point, c: Point) => Point[]): DrawingToolDef {
  const pts = (d: ScreenDrawing): Point[] => {
    const [a, b] = two(d);
    return outline(a, b, d.points[2] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  };
  return {
    type,
    styleFields: LINE_FIELDS,
    label,
    group: 'annotate',
    points: 3,
    bounds: (d) => boxOf(pts(d)),
    render: (ctx, d, env) => strokePoints(ctx, d, env, 0, pts(d)),
    hitTest: (d, p) => nearPoints(p, pts(d), HIT + (d.drawing.style.lineWidth ?? 2) / 2),
  };
}

/** Curve between the first two points, through the third halfway along. */
export const curve = curveTool('curve', 'Curve', bend);
/** S-curve between the first two points: its first half passes through the third point, its second half mirrors that. */
export const doubleCurve = curveTool('double-curve', 'Double curve', doubleBend);
/** Circular arc from the first point to the second, through the third. */
export const arc = curveTool('arc', 'Arc', arcThrough);

/** Stroke the line through `pts` (the drawing's points by default), with round joins, at `alpha` opacity when given. */
function strokePoints(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, alpha?: number, pts = d.points): void {
  stroke(ctx, d, env);
  if (alpha) ctx.strokeStyle = withAlpha(d.drawing.style.color ?? env.theme.drawing, alpha);
  ctx.lineJoin = 'round';
  trace(ctx, pts);
  ctx.stroke();
}

/** Hit test of the line through the drawing's points, widened by its line width. */
const nearLine = (d: ScreenDrawing, p: Point): boolean => nearPoints(p, d.points, HIT + (d.drawing.style.lineWidth ?? 2) / 2);

/** Line through points placed one click at a time; double-click or Enter ends it. */
export const polyline: DrawingToolDef = {
  type: 'polyline',
  styleFields: LINE_FIELDS,
  label: 'Polyline',
  group: 'annotate',
  points: 'n',
  render: strokePoints,
  hitTest: nearLine,
};

/** Polyline with an arrow head at its last point. */
export const path: DrawingToolDef = {
  type: 'path',
  styleFields: LINE_FIELDS,
  label: 'Path',
  group: 'annotate',
  points: 'n',
  render(ctx, d, env) {
    strokePoints(ctx, d, env);
    const pts = d.points;
    if (pts.length > 1) arrowHead(ctx, pts[pts.length - 2]!, pts[pts.length - 1]!);
  },
  hitTest: nearLine,
};

/** Freehand stroke, simplified within a pixel when the stroke ends. */
export const brush: DrawingToolDef = {
  type: 'brush',
  styleFields: LINE_FIELDS,
  label: 'Brush',
  group: 'annotate',
  points: 'free',
  simplify: true,
  defaultStyle: { lineWidth: 2 },
  render: strokePoints,
  hitTest: nearLine,
};

/** Wide, translucent freehand stroke for marking up an area. */
export const highlighter: DrawingToolDef = {
  type: 'highlighter',
  styleFields: ['color', 'lineWidth'],
  label: 'Highlighter',
  group: 'annotate',
  points: 'free',
  simplify: true,
  defaultStyle: { lineWidth: 12 },
  render: (ctx, d, env) => strokePoints(ctx, d, env, 0.4),
  hitTest: nearLine,
};
