import type { Point } from '../types';
import { distToSegment, simplifyPolyline } from './geometry';
import { clampNum } from '../util/math';

/** A freehand stroke as the sketch recognisers see it, in plot pixels. */
export interface SketchStroke {
  /** Points in drawing order, without non-finite or repeated points. */
  points: readonly Point[];
  /** Length of the path through `corners`, in pixels, which leaves out hand jitter. */
  length: number;
  /** Bounding box of `points`. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * Indices into `points` of the stroke's corners: the points a polyline
   * simplified within a few percent of the stroke's size keeps.
   */
  corners: readonly number[];
  /** Plot width in pixels, when known. Lets a straight stroke into either side of the plot become a ray. */
  plotWidth?: number;
}

/** One way to read a stroke as a drawing. */
export interface SketchCandidate {
  /** Drawing tool type, such as `'trendline'` or `'rectangle'`. */
  tool: string;
  /** How well the stroke fits, from 0 (not at all) to 1 (exactly). */
  score: number;
  /** The tool's anchor points in plot pixels, in the order the tool takes them. */
  points: Point[];
}

/**
 * Reads a stroke as zero or more drawings. Recognisers are pure: the same
 * stroke always gives the same candidates.
 */
export type SketchRecognizer = (stroke: SketchStroke) => SketchCandidate[];

/** Options of {@link recognizeSketch}. */
export interface SketchOptions {
  /** Plot width in pixels; without it, no stroke becomes a ray. */
  plotWidth?: number;
  /** Recognisers to ask. Default `builtinSketchRecognizers`; spread it to add your own. */
  recognizers?: readonly SketchRecognizer[];
  /** Candidates scoring below this are dropped. Default 0.5. */
  minScore?: number;
}

/** Strokes with a shorter path (px) are taps, not sketches. */
const MIN_LENGTH = 16;
/** A straight stroke ending this close (px) to either side of the plot becomes a ray. */
const EDGE = 12;
/** Strokes this close to horizontal or vertical (radians) read as horizontal or vertical lines. */
const AXIS_ANGLE = (10 * Math.PI) / 180;

const clamp01 = (v: number): number => clampNum(v, 0, 1);
const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Candidate drawings for a freehand stroke, best first. `points` are in plot
 * pixels in drawing order. Returns an empty list for taps and strokes that
 * fit no recogniser.
 */
export function recognizeSketch(points: readonly Point[], options: SketchOptions = {}): SketchCandidate[] {
  const stroke = sketchStroke(points, options.plotWidth);
  if (!stroke) return [];
  const minScore = options.minScore ?? 0.5;
  const out: SketchCandidate[] = [];
  for (const recognize of options.recognizers ?? builtinSketchRecognizers) {
    for (const c of recognize(stroke)) if (c.score >= minScore && Number.isFinite(c.score)) out.push(c);
  }
  // Stable: ties keep recogniser order.
  return out.sort((a, b) => b.score - a.score);
}

/** The stroke recognisers see, or null for a tap. */
function sketchStroke(raw: readonly Point[], plotWidth: number | undefined): SketchStroke | null {
  const points: Point[] = [];
  for (const p of raw) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = points[points.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    points.push({ x: p.x, y: p.y });
  }
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const tolerance = Math.max(2, 0.03 * Math.hypot(bounds.width, bounds.height));
  const corners = simplifyPolyline(points, tolerance);
  let length = 0;
  for (let i = 1; i < corners.length; i++) length += dist(points[corners[i - 1]!]!, points[corners[i]!]!);
  if (length < MIN_LENGTH) return null;
  const stroke: SketchStroke = { points, length, bounds, corners };
  if (plotWidth !== undefined) stroke.plotWidth = plotWidth;
  return stroke;
}

/**
 * How straight a stroke is, from 0 to 1: 1 when every point lies on the line
 * from the first to the last point and the path does not double back.
 */
function straightness(s: SketchStroke): number {
  const a = s.points[0]!;
  const b = s.points[s.points.length - 1]!;
  const chord = dist(a, b);
  if (chord < MIN_LENGTH || chord / s.length < 0.9) return 0;
  let maxDev = 0;
  for (const p of s.points) maxDev = Math.max(maxDev, distToSegment(p, a, b));
  return clamp01(1 - maxDev / Math.max(4, 0.1 * chord));
}

/**
 * Straight strokes: a horizontal or vertical line when close to either,
 * a ray when the stroke ends at a side of the plot, else a trend line.
 * Every straight stroke also offers a trend line, below the others.
 */
const sketchLines: SketchRecognizer = (s) => {
  const q = straightness(s);
  if (q === 0) return [];
  const a = s.points[0]!;
  const b = s.points[s.points.length - 1]!;
  const angle = Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x));
  const out: SketchCandidate[] = [];
  let trend = 0.85 * q;
  if (angle <= AXIS_ANGLE) {
    const y = s.points.reduce((sum, p) => sum + p.y, 0) / s.points.length;
    out.push({ tool: 'hline', score: q * (1 - angle / (2 * AXIS_ANGLE)), points: [{ x: (a.x + b.x) / 2, y }] });
    trend = 0.6 * q;
  } else if (Math.PI / 2 - angle <= AXIS_ANGLE) {
    const x = s.points.reduce((sum, p) => sum + p.x, 0) / s.points.length;
    out.push({ tool: 'vline', score: q * (1 - (Math.PI / 2 - angle) / (2 * AXIS_ANGLE)), points: [{ x, y: (a.y + b.y) / 2 }] });
    trend = 0.6 * q;
  } else if (s.plotWidth !== undefined && (b.x >= s.plotWidth - EDGE || b.x <= EDGE)) {
    out.push({ tool: 'ray', score: 0.95 * q, points: [{ ...a }, { ...b }] });
    trend = 0.7 * q;
  }
  out.push({ tool: 'trendline', score: trend, points: [{ ...a }, { ...b }] });
  return out;
};

/**
 * A straight shaft ending in a short hook that turns back past a right
 * angle: an arrow from the shaft's start to its tip.
 */
const sketchArrow: SketchRecognizer = (s) => {
  const pts = s.points;
  const start = pts[0]!;
  // The tip is the point furthest from the start; the hook is everything after it.
  let tipAt = 0;
  for (let i = 1; i < pts.length; i++) if (dist(start, pts[i]!) > dist(start, pts[tipAt]!)) tipAt = i;
  const tip = pts[tipAt]!;
  const shaft = dist(start, tip);
  let barb = tip;
  for (let i = tipAt + 1; i < pts.length; i++) if (dist(tip, pts[i]!) > dist(tip, barb)) barb = pts[i]!;
  const hook = dist(tip, barb);
  if (shaft < 0.6 * s.length || hook < Math.max(8, 0.08 * shaft) || hook > 0.45 * shaft) return [];
  let maxDev = 0;
  for (let i = 0; i < tipAt; i++) maxDev = Math.max(maxDev, distToSegment(pts[i]!, start, tip));
  const straight = clamp01(1 - maxDev / Math.max(4, 0.1 * shaft));
  const turn = angleBetween(tip.x - start.x, tip.y - start.y, barb.x - tip.x, barb.y - tip.y);
  if (straight === 0 || turn < (100 * Math.PI) / 180) return [];
  return [
    { tool: 'arrow', score: 0.9 * straight, points: [{ ...start }, { ...tip }] },
    { tool: 'trendline', score: 0.55 * straight, points: [{ ...start }, { ...tip }] },
  ];
};

/**
 * Closed loops: a rectangle when the loop fills its bounding box, an ellipse
 * when it fills about π/4 of it. Both take the box's opposite corners.
 */
const sketchLoops: SketchRecognizer = (s) => {
  const { x, y, width: w, height: h } = s.bounds;
  if (w < 10 || h < 10) return [];
  const gap = dist(s.points[0]!, s.points[s.points.length - 1]!);
  if (gap > Math.max(12, 0.15 * s.length)) return [];
  const fill = Math.abs(polygonArea(s.points)) / (w * h);
  const corners = (): Point[] => [{ x, y }, { x: x + w, y: y + h }];
  const out: SketchCandidate[] = [];
  const closed = clamp01(1 - gap / s.length);
  const rectPerimeter = 2 * (w + h);
  if (s.length <= 1.4 * rectPerimeter) {
    const score = closed * clamp01(1 - Math.abs(fill - 1) / 0.25);
    if (score > 0) out.push({ tool: 'rectangle', score, points: corners() });
  }
  const a = w / 2;
  const b = h / 2;
  // Ramanujan's approximation of the ellipse perimeter.
  const ellipsePerimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  if (s.length <= 1.4 * ellipsePerimeter) {
    const score = closed * clamp01(1 - Math.abs(fill - Math.PI / 4) / 0.15);
    if (score > 0) out.push({ tool: 'ellipse', score, points: corners() });
  }
  return out;
};

/**
 * A zig-zag of three or more legs that alternate up and down while moving
 * one way in time: a Fibonacci retracement between its lowest and highest
 * points, in the order the stroke reaches them from left to right.
 */
const sketchZigzag: SketchRecognizer = (s) => {
  const c = s.corners.map((i) => s.points[i]!);
  if (c.length < 4) return [];
  const first = c[0]!;
  const last = c[c.length - 1]!;
  const dir = Math.sign(last.x - first.x);
  if (dir === 0) return [];
  const slack = 0.05 * s.bounds.width;
  const legs: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const dx = c[i]!.x - c[i - 1]!.x;
    const dy = c[i]!.y - c[i - 1]!.y;
    if (dx * dir < -slack) return [];
    // Simplification can leave a short kink at a turn; it does not start a leg.
    if (Math.abs(dy) < 0.1 * s.bounds.height) continue;
    const n = legs.length;
    if (n > 0 && Math.sign(dy) === Math.sign(legs[n - 1]!)) legs[n - 1] = legs[n - 1]! + dy;
    else legs.push(dy);
  }
  if (legs.length < 3 || legs.some((dy) => Math.abs(dy) < 0.2 * s.bounds.height)) return [];
  let low = c[0]!;
  let high = c[0]!;
  for (const p of c) {
    if (p.y > low.y) low = p;
    if (p.y < high.y) high = p;
  }
  const ordered = (low.x - high.x) * dir <= 0 ? [low, high] : [high, low];
  return [{ tool: 'fib-retracement', score: 0.8, points: ordered.map((p) => ({ ...p })) }];
};

/**
 * Whether a stroke is a scribble: one that doubles back on itself at least
 * four times, like crossing something out. Legs under 15% of the stroke's
 * size are kinks of a rounded turn and are skipped.
 */
export function isScribble(points: readonly Point[]): boolean {
  const s = sketchStroke(points, undefined);
  if (!s) return false;
  const min = 0.15 * Math.max(s.bounds.width, s.bounds.height);
  let reversals = 0;
  let leg: Point | null = null;
  for (let i = 1; i < s.corners.length; i++) {
    const a = s.points[s.corners[i - 1]!]!;
    const b = s.points[s.corners[i]!]!;
    const next = { x: b.x - a.x, y: b.y - a.y };
    if (Math.hypot(next.x, next.y) < min) continue;
    if (leg && angleBetween(leg.x, leg.y, next.x, next.y) > (150 * Math.PI) / 180) reversals++;
    leg = next;
  }
  return reversals >= 4;
}

/** The recognisers `recognizeSketch` asks by default. */
export const builtinSketchRecognizers: readonly SketchRecognizer[] = [sketchLines, sketchArrow, sketchLoops, sketchZigzag];

/** Angle (radians, 0 to π) between two direction vectors. */
function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return Math.acos(clampNum(cos, -1, 1));
}

/** Signed area of the polygon through `points`, closed back to the first. */
function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}
