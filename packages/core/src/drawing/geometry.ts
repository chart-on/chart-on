import type { Point, Rect } from '../types';
import { clampLow } from '../util/math';

/** A full turn in radians. */
export const TAU = 2 * Math.PI;

/** Distance from `p` to the nearest point of the segment from `a` to `b`. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clampLow(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * `to` moved onto the nearest of the eight directions from `from` that are
 * horizontal, vertical or at 45°. Horizontal and vertical results keep
 * `from.y` and `from.x` exactly; diagonal ones project `to` onto the diagonal.
 */
export function constrainAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // tan(22.5°): closer to an axis than to a diagonal.
  const tan = Math.SQRT2 - 1;
  if (ay <= ax * tan) return { x: to.x, y: from.y };
  if (ax <= ay * tan) return { x: from.x, y: to.y };
  const d = (ax + ay) / 2;
  return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
}

/** Point where the ray a→b leaves the rectangle [0,w]×[0,h] (or b if degenerate). */
export function rayEnd(a: Point, b: Point, width: number, height: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return b;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (width - a.x) / dx);
  if (dx < 0) t = Math.min(t, -a.x / dx);
  if (dy > 0) t = Math.min(t, (height - a.y) / dy);
  if (dy < 0) t = Math.min(t, -a.y / dy);
  if (!Number.isFinite(t) || t < 1) t = 1;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** The point at `angle` (a canvas angle: 0 points right, positive turns clockwise on screen) on the circle of radius `r` around `c`. */
export function onCircle(c: Point, r: number, angle: number): Point {
  return { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
}

/** Whether `angle` lies on the arc running `sweep` radians from `start`. */
export function angleInSweep(angle: number, start: number, sweep: number): boolean {
  if (Math.abs(sweep) >= TAU) return true;
  const t = (((angle - start) % TAU) + TAU) % TAU;
  return sweep >= 0 ? t <= sweep : t === 0 || t >= TAU + sweep;
}

/**
 * Bounding box of the arc of radius `r` around `c` running `sweep` radians
 * from `start`: its ends, and the points due right, down, left and up that it
 * passes.
 */
export function arcBounds(c: Point, r: number, start: number, sweep: number): Rect {
  const end = start + sweep;
  const pts = [onCircle(c, r, start), onCircle(c, r, end)];
  const quarter = Math.PI / 2;
  const [lo, hi] = sweep >= 0 ? [start, end] : [end, start];
  for (let q = Math.ceil(lo / quarter); q * quarter <= hi; q++) pts.push(onCircle(c, r, q * quarter));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The rectangle spanned by two corner points, with a non-negative width and height. */
export function normalizedRect(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Whether `p` lies in the rectangle spanned by corners `a` and `b`, grown by `tolerance` on every side. */
export function pointInRect(p: Point, a: Point, b: Point, tolerance = 0): boolean {
  const r = normalizedRect(a, b);
  return (
    p.x >= r.x - tolerance &&
    p.x <= r.x + r.width + tolerance &&
    p.y >= r.y - tolerance &&
    p.y <= r.y + r.height + tolerance
  );
}

/**
 * Indices of the points a simplified polyline keeps. The first and last points
 * are always kept; no dropped point lies further than twice `tolerance`
 * from the kept line.
 *
 * A radial pass first drops points within `tolerance` of the previous kept
 * point, which is linear and thins densely sampled strokes. Ramer-Douglas-Peucker
 * then runs on what is left: typically O(n log n), O(n²) in the worst case
 * (every split peels off a single point), so callers with very long input
 * should cap or pre-thin it.
 */
export function simplifyPolyline(points: readonly Point[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const idx = radialFilter(points, tolerance);
  if (idx.length <= 2) return idx;
  const keep = new Uint8Array(idx.length);
  keep[0] = 1;
  keep[idx.length - 1] = 1;
  // An explicit stack: long strokes would recurse too deep.
  const stack: [number, number][] = [[0, idx.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const a = points[idx[from]!]!;
    const b = points[idx[to]!]!;
    let far = -1;
    let max = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = distToSegment(points[idx[i]!]!, a, b);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([from, far], [far, to]);
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(idx[i]!));
  return out;
}

/** Indices of the points further than `tolerance` from the previous kept one; the last point is always kept. */
function radialFilter(points: readonly Point[], tolerance: number): number[] {
  const out = [0];
  let last = points[0]!;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const p = points[i]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) <= tolerance) continue;
    out.push(i);
    last = p;
  }
  out.push(end);
  return out;
}
