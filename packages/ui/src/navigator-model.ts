import type { Time } from '@chart-on/core';

/** One point the navigator draws: a bar's close or a line's value. */
export type NavigatorPoint = { time: Time; close: number } | { time: Time; value: number };

/**
 * The overview line, reduced to at most one column per pixel. Column `c`
 * holds the first, lowest, highest and last value of the points that fall
 * into it, at `cols[4c]` to `cols[4c + 3]`.
 */
export interface NavigatorOverview {
  /** Columns in use: the point count, capped at the pixel width. */
  count: number;
  cols: Float64Array;
  /** Lowest and highest value over all points (NaN without finite values). */
  min: number;
  max: number;
}

/**
 * The window over the history, as fractions of the point indices: 0 is the
 * oldest point, 1 the newest.
 */
export interface NavigatorWindow {
  start: number;
  end: number;
}

const valueOf = (p: NavigatorPoint): number => ('close' in p ? p.close : p.value);

/** First point of column `c` when `n` points share `count` columns evenly. */
const firstOf = (c: number, n: number, count: number): number => (count === n ? c : Math.ceil((c * n) / count));

/**
 * Reduce `points` to at most `width` columns (per-pixel decimation). It runs
 * in one pass over the points, so a million of them take a few milliseconds.
 * Pass the previous result as `reuse` to keep its buffer.
 */
export function decimate(points: readonly NavigatorPoint[], width: number, reuse?: NavigatorOverview): NavigatorOverview {
  const n = points.length;
  const count = Math.max(0, Math.min(n, Math.floor(width)));
  const cols = reuse && reuse.cols.length >= count * 4 ? reuse.cols : new Float64Array(count * 4);
  const out: NavigatorOverview = { count, cols, min: NaN, max: NaN };
  for (let c = 0; c < count; c++) fillColumn(points, out, c);
  updateExtent(out);
  return out;
}

/**
 * Recompute only the newest column after the last point changed in place (a
 * live tick), which is far cheaper than `decimate` on a long history. An
 * appended point moves the column boundaries, so it needs `decimate`. Returns
 * false when the point count no longer matches `overview`.
 */
export function refreshLastColumn(points: readonly NavigatorPoint[], overview: NavigatorOverview, width: number): boolean {
  const count = Math.max(0, Math.min(points.length, Math.floor(width)));
  if (count === 0 || count !== overview.count) return false;
  fillColumn(points, overview, count - 1);
  updateExtent(overview);
  return true;
}

function fillColumn(points: readonly NavigatorPoint[], out: NavigatorOverview, c: number): void {
  const n = points.length;
  const from = firstOf(c, n, out.count);
  const to = c + 1 === out.count ? n : firstOf(c + 1, n, out.count);
  let first = NaN;
  let last = NaN;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < to; i++) {
    const v = valueOf(points[i]!);
    if (!Number.isFinite(v)) continue;
    if (first !== first) first = v;
    last = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const at = c * 4;
  out.cols[at] = first;
  out.cols[at + 1] = first === first ? lo : NaN;
  out.cols[at + 2] = first === first ? hi : NaN;
  out.cols[at + 3] = last;
}

function updateExtent(out: NavigatorOverview): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = 0; c < out.count; c++) {
    const a = out.cols[c * 4 + 1]!;
    const b = out.cols[c * 4 + 2]!;
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  out.min = lo === Infinity ? NaN : lo;
  out.max = hi === -Infinity ? NaN : hi;
}

/** Index of the first point at or after `time` (`points.length` when none is). */
export function indexAtTime(points: readonly NavigatorPoint[], time: Time): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The window showing the time span [from, to], clamped to the history. Null with fewer than two points. */
export function windowFromRange(points: readonly NavigatorPoint[], range: { from: Time; to: Time }): NavigatorWindow | null {
  const last = points.length - 1;
  if (last < 1) return null;
  const fraction = (i: number) => Math.max(0, Math.min(1, i / last));
  const a = fraction(indexAtTime(points, range.from));
  // `to` is the time of the last visible bar; past the newest bar the window ends at 1.
  const b = fraction(indexAtTime(points, range.to));
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The time span a window covers: the times of the points at its edges. Null with fewer than two points. */
export function rangeFromWindow(points: readonly NavigatorPoint[], win: NavigatorWindow): { from: Time; to: Time } | null {
  const last = points.length - 1;
  if (last < 1) return null;
  const at = (f: number) => points[Math.max(0, Math.min(last, Math.round(f * last)))]!.time;
  return { from: at(win.start), to: at(win.end) };
}

/** Move `win` by `delta` (a fraction of the history), keeping its width and staying inside [0, 1]. */
export function panWindow(win: NavigatorWindow, delta: number): NavigatorWindow {
  const width = Math.min(1, win.end - win.start);
  const start = Math.max(0, Math.min(1 - width, win.start + delta));
  return { start, end: start + width };
}

/**
 * Move one edge of `win` to `at`, at least `minWidth` from the other edge and
 * inside [0, 1]. An edge dragged past the other one stops there.
 */
export function resizeWindow(win: NavigatorWindow, edge: 'start' | 'end', at: number, minWidth: number): NavigatorWindow {
  const min = Math.min(1, Math.max(0, minWidth));
  if (edge === 'start') return { start: Math.max(0, Math.min(win.end - min, at)), end: win.end };
  return { start: win.start, end: Math.min(1, Math.max(win.start + min, at)) };
}

/** Centre a window of `win`'s width on `at`, as a click on the strip outside the window does. */
export function centerWindow(win: NavigatorWindow, at: number): NavigatorWindow {
  return panWindow(win, at - (win.start + win.end) / 2);
}
