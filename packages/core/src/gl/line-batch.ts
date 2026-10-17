import { Slots } from './slots';
import { clampLow } from '../util/math';

/** Bytes per vertex: timeline index, value - base, arc length (or a band's lower value - base), point flag (f32 × 4). */
export const LINE_STRIDE = 16;

/** How `LineBatch.build` connects points. */
export interface LineBuildShape {
  /** Hold each value until the next point's index, then jump (two vertices per point). */
  step: boolean;
  /** Break the line where timeline indices are not consecutive. */
  breakGaps: boolean;
}

/** The shape of a band: its points are joined straight, over index gaps too. */
const BAND: LineBuildShape = { step: false, breakGaps: false };

/**
 * CPU-side vertex buffer for `GLRenderer.drawLine`: a line's points as
 * (timeline index, value), projected to the screen by the vertex shader, so
 * panning and zooming upload nothing. Values are stored relative to `base`
 * for float32 precision, like `RectBatch`.
 *
 * Runs are separated by break vertices (flag 0), and the buffer starts and
 * ends with one, so every segment can read the vertex before and after it.
 * Points with no finite value break the line, as does a jump in the index
 * with `breakGaps`. Step lines get an extra vertex per point.
 *
 * The arc slot holds the screen-space length from the start of the run for
 * dashed lines; it depends on the view, so `measure` refreshes it for the
 * vertices on screen each frame. A band (`buildBand`) keeps its lower line's
 * values there instead, so it is never measured: it is filled, and its own
 * line may be stroked solid (an edge).
 *
 * Like `RectBatch`, the storage keeps headroom at the front, so points added
 * before the first one (`prepend`) are written and uploaded on their own.
 */
export class LineBatch extends Slots {
  base = 0;
  /** Added to the stored timeline indices, so bars added at the front of the timeline move every point without a rewrite. */
  indexShift = 0;
  /** The shape the vertices were built with; null before the first build. */
  shape: LineBuildShape | null = null;
  /** Built as a band, with a lower value per point. */
  #band = false;
  /** First vertex written for each point, plus the trailing break after the last. */
  #startOf = new Int32Array(64);
  #points = 0;

  constructor() {
    super(LINE_STRIDE);
  }

  /**
   * Write points [from, n) from `indexAt` and `valueAt`, keeping the vertices
   * of the points before `from`. `from` 0 (or a new shape) rebuilds all and
   * picks a new base.
   */
  build(
    n: number,
    indexAt: (k: number) => number,
    valueAt: (k: number) => number,
    shape: LineBuildShape,
    from = 0,
  ): void {
    this.#write(n, indexAt, valueAt, null, shape, from);
  }

  /**
   * Like `build`, for the band between two lines over the same points, to
   * fill with `GLRenderer.drawFill`: `upperAt` is the line, `lowerAt` the
   * other edge (either may be the higher one). A point is a gap unless both
   * values are finite.
   */
  buildBand(
    n: number,
    indexAt: (k: number) => number,
    upperAt: (k: number) => number,
    lowerAt: (k: number) => number,
    from = 0,
  ): void {
    this.#write(n, indexAt, upperAt, lowerAt, BAND, from);
  }

  #write(
    n: number,
    indexAt: (k: number) => number,
    upperAt: (k: number) => number,
    lowerAt: ((k: number) => number) | null,
    shape: LineBuildShape,
    from: number,
  ): void {
    const band = lowerAt !== null;
    // A gap where a band's lower value is missing too.
    const valueAt = lowerAt ? (k: number) => (Number.isFinite(lowerAt(k)) ? upperAt(k) : NaN) : upperAt;
    const lower = lowerAt ?? (() => 0);
    const same =
      this.shape !== null && this.#band === band && this.shape.step === shape.step && this.shape.breakGaps === shape.breakGaps;
    if (!same || from > this.#points) from = 0;
    from = clampLow(from, 0, n);
    this.shape = shape;
    this.#band = band;
    if (from === 0) {
      this.base = 0;
      this.indexShift = 0;
      for (let k = 0; k < n; k++) {
        const v = valueAt(k);
        if (Number.isFinite(v)) {
          this.base = v;
          break;
        }
      }
    }
    if (this.#startOf.length < n + 1) {
      const next = new Int32Array(Math.max(n + 1, this.#startOf.length * 2));
      next.set(this.#startOf.subarray(0, from));
      this.#startOf = next;
    }
    // Up to two vertices per point, a break after each, and the leading and trailing ones.
    this.resize((this.#startOf[from] ?? 0) + 3 * (n - from) + 2);
    let c = this.#run(from === 0 ? this.#put(0, 0, 0, 0, 0) : this.#startOf[from]!, from, n, indexAt, valueAt, lower, shape);
    if (this.f32[(this.head + c - 1) * 4 + 3] !== 0) c = this.#put(c, 0, 0, 0, 0);
    this.#startOf[n] = c - 1;
    this.#points = n;
    const changed = from === 0 ? 0 : this.#startOf[from]!;
    this.count = c;
    this.#markDirty(changed, c);
  }

  /**
   * `added` points were added in front of the first one, replacing the first
   * `dropped`; the others keep their values and move up by `added - dropped`.
   * Writes the new points and rejoins the first kept one in the front
   * headroom, keeping every other vertex in its storage slot, so only the
   * front uploads. Returns false (writing nothing) when the line needs a
   * whole `build` instead: never built, a band, or nothing kept past the
   * rejoined point.
   */
  prepend(added: number, dropped: number, indexAt: (k: number) => number, valueAt: (k: number) => number): boolean {
    const shape = this.shape;
    const old = this.#points;
    if (!shape || this.#band || old < dropped + 2) return false;
    if (added === 0 && dropped === 0) return true;
    const n = old - dropped + added;
    // Old vertices [0, kept) go: the leading break and the dropped and rejoined points.
    const kept = this.#startOf[dropped + 1]!;
    if (this.#startOf.length < n + 1) {
      const next = new Int32Array(Math.max(n + 1, this.#startOf.length * 2));
      next.set(this.#startOf.subarray(dropped + 1, old + 1), added + 1);
      this.#startOf = next;
    } else this.#startOf.copyWithin(added + 1, dropped + 1, old + 1);
    // Write the front forward from slot 0 of room enough for it, then move it up against the kept vertices.
    const room = 3 * (added + 1) + 1;
    this.growFront(room);
    const c = this.#run(this.#put(0, 0, 0, 0, 0), 0, added + 1, indexAt, valueAt, () => 0, shape);
    const gap = kept + room - c;
    const at = this.head * 4;
    this.f32.copyWithin(at + gap * 4, at, at + c * 4);
    this.#markDirty(gap, gap + c);
    this.growFront(-gap);
    for (let k = added + 1; k <= n; k++) this.#startOf[k] = this.#startOf[k]! + c - kept;
    this.#points = n;
    return true;
  }

  /** Write points [from, to) from vertex `c` on, joined to point `from - 1`; returns the vertex after them. */
  #run(
    c: number,
    from: number,
    to: number,
    indexAt: (k: number) => number,
    valueAt: (k: number) => number,
    lower: (k: number) => number,
    shape: LineBuildShape,
  ): number {
    let prevIndex = from > 0 ? indexAt(from - 1) : NaN;
    let prevValue = from > 0 ? valueAt(from - 1) : NaN;
    let prevLower = from > 0 ? lower(from - 1) : NaN;
    const breakRun = () => {
      if (this.f32[(this.head + c - 1) * 4 + 3] !== 0) c = this.#put(c, 0, 0, 0, 0);
    };
    for (let k = from; k < to; k++) {
      this.#startOf[k] = c;
      const index = indexAt(k);
      const value = valueAt(k);
      const low = lower(k);
      if (!Number.isFinite(value)) {
        breakRun();
      } else {
        const joined = Number.isFinite(prevValue) && !(shape.breakGaps && index !== prevIndex + 1);
        if (!joined) breakRun();
        else if (shape.step && value !== prevValue && index !== prevIndex) c = this.#put(c, index, prevValue, 1, prevLower);
        c = this.#put(c, index, value, 1, low);
      }
      prevIndex = index;
      prevValue = value;
      prevLower = low;
    }
    return c;
  }

  /** The first vertex of point `k` (k = count gives the trailing break). */
  vertexOf(k: number): number {
    return this.#startOf[clampLow(k, 0, this.#points)]!;
  }

  /** Vertex range [first, end) holding points [a, b) and a neighbour either side. */
  vertexRange(a: number, b: number): [first: number, end: number] {
    if (this.#points === 0) return [1, 1];
    return [Math.max(1, this.vertexOf(Math.min(a - 1, this.#points - 1))), Math.max(1, this.vertexOf(b + 1))];
  }

  /**
   * Refresh the arc lengths of vertices [first, end) on screen, given by
   * `xOf` and `yOf` (css px). They count from vertex `origin` (forwards, and
   * backwards before it), restart after each break, and are kept modulo
   * `period` so they stay small.
   */
  measure(
    first: number,
    origin: number,
    end: number,
    xOf: (index: number) => number,
    yOf: (value: number) => number,
    period: number,
  ): void {
    const f = this.f32;
    const head = this.head * 4;
    const walk = (from: number, to: number, step: 1 | -1) => {
      let arc = 0;
      let px = NaN;
      let py = NaN;
      for (let i = from; i !== to; i += step) {
        const o = head + i * 4;
        if (f[o + 3] === 0) {
          px = NaN;
          continue;
        }
        const x = xOf(f[o]! + this.indexShift);
        const y = yOf(f[o + 1]! + this.base);
        if (Number.isNaN(px)) arc = 0;
        else {
          const dx = x - px;
          const dy = y - py;
          arc = (arc + step * Math.sqrt(dx * dx + dy * dy)) % period;
        }
        f[o + 2] = arc < 0 ? arc + period : arc;
        px = x;
        py = y;
      }
    };
    origin = clampLow(origin, first, end - 1);
    walk(origin, end, 1);
    walk(origin, first - 1, -1);
    this.#markDirty(first, end);
  }

  #markDirty(from: number, to: number): void {
    if (from < this.dirtyFrom) this.dirtyFrom = from;
    if (to > this.dirtyTo) this.dirtyTo = to;
  }

  /** Write vertex `i`; `lower` is a band's lower value (only kept for bands, else the arc starts at 0). */
  #put(i: number, index: number, value: number, flag: number, lower: number): number {
    const f = (this.head + i) * 4;
    this.f32[f] = index - this.indexShift;
    this.f32[f + 1] = flag ? value - this.base : 0;
    this.f32[f + 2] = flag && this.#band ? lower - this.base : 0;
    this.f32[f + 3] = flag;
    return i + 1;
  }
}
