/**
 * Screen-space paths for line series: per-pixel decimation, gap handling and
 * the line shapes (straight, stepped, curved), kept apart from the canvas so
 * they can be tested on their own.
 */
import type { LineStyle } from './annotations/types';
import { isColor } from './util/color';

/** How a line connects its points: straight segments, steps, or a smooth curve. */
export type LineType = 'simple' | 'step' | 'curved';

/** How a line is shaped and stroked. Every field is optional. */
export interface LineShape {
  /** Default `'solid'`. */
  lineStyle?: LineStyle | undefined;
  /** Default `'simple'`. */
  lineType?: LineType | undefined;
  /** Break the line where timeline indices are not consecutive (bars without a point). */
  breakGaps?: boolean | undefined;
}

/**
 * A line's vertices in css px, split into runs that are drawn as separate
 * subpaths. The buffers grow as needed and are reused frame after frame.
 */
export class LinePath {
  x = new Float64Array(256);
  y = new Float64Array(256);
  /** Tangent dy/dx at each vertex; filled for curved lines only. */
  slope = new Float64Array(256);
  length = 0;
  /** Vertex offset where each run starts. */
  runStart = new Int32Array(16);
  runCount = 0;
  /**
   * Line colour id of each vertex, for the segment that starts there (0: the
   * series colour). Made the first time a path is built with colours.
   */
  color: Int32Array | null = null;
  /** Fill colour id of each vertex, for the area under the segment that starts there (0: from the line colour). */
  fill: Int32Array | null = null;
  /** Whether the last build filled `color` and `fill`. */
  colored = false;

  clear(): void {
    this.length = 0;
    this.runCount = 0;
    this.colored = false;
  }

  /** First vertex of run `r`. */
  start(r: number): number {
    return this.runStart[r]!;
  }

  /** One past the last vertex of run `r`. */
  end(r: number): number {
    return r + 1 < this.runCount ? this.runStart[r + 1]! : this.length;
  }

  /** Begin a new run unless the current one is still empty. */
  newRun(): void {
    if (this.runCount > 0 && this.runStart[this.runCount - 1] === this.length) return;
    if (this.runCount === this.runStart.length) this.runStart = grow(this.runStart, new Int32Array(this.runCount * 2));
    this.runStart[this.runCount++] = this.length;
  }

  push(x: number, y: number): void {
    if (this.runCount === 0) this.newRun();
    if (this.length === this.x.length) {
      const n = this.length * 2;
      this.x = grow(this.x, new Float64Array(n));
      this.y = grow(this.y, new Float64Array(n));
      this.slope = new Float64Array(n);
      if (this.color) this.color = grow(this.color, new Int32Array(n));
      if (this.fill) this.fill = grow(this.fill, new Int32Array(n));
    }
    this.x[this.length] = x;
    this.y[this.length] = y;
    this.length++;
  }

  /** Set the colour ids of vertex `i`. */
  paint(i: number, line: number, fill: number): void {
    this.color![i] = line;
    this.fill![i] = fill;
  }

  /** Make the colour buffers, as long as the vertex buffers, if they are missing. */
  ensureColors(): void {
    const n = this.x.length;
    if (this.color?.length !== n) this.color = this.color ? grow(this.color, new Int32Array(n)) : new Int32Array(n);
    if (this.fill?.length !== n) this.fill = this.fill ? grow(this.fill, new Int32Array(n)) : new Int32Array(n);
  }

  /** Drop a trailing empty run. */
  finish(): void {
    if (this.runCount > 0 && this.runStart[this.runCount - 1] === this.length) this.runCount--;
  }
}

function grow<T extends Float64Array | Int32Array>(from: T, to: T): T {
  to.set(from);
  return to;
}

/**
 * Per-point colours for `buildLinePath`, as ids from a `ColorPalette`: the
 * line colour and the fill colour of aligned position `k`, 0 when it has none.
 */
export interface PathColors {
  line(k: number): number;
  fill(k: number): number;
}

/**
 * Build the path of aligned positions [a, b) into `out`. `indexAt` gives a
 * position's timeline index and `valueAt` its value; `xOf` and `yOf` project
 * them to css px.
 *
 * When several points share a pixel column only the first, lowest, highest and
 * last are kept, so the cost stays O(width) at any zoom. The shape is applied
 * to those vertices: steps hold each value until the next vertex, and curves
 * get monotone tangents, so they never overshoot a point. Values that project
 * to a non-finite y (NaN) end the run, as does a jump in the timeline index
 * when `breakGaps` is set.
 *
 * With `colors`, each vertex also gets the colour ids of the point it came
 * from, which colour the segment to the next vertex. A pixel column keeps the
 * colours of its last point, and a step's corner keeps the colours of the
 * point it levels out from.
 */
export function buildLinePath(
  out: LinePath,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  valueAt: (k: number) => number,
  xOf: (index: number) => number,
  yOf: (value: number) => number,
  shape: LineShape = {},
  colors?: PathColors,
): LinePath {
  out.clear();
  if (colors) out.ensureColors();
  const step = shape.lineType === 'step';
  const breakGaps = shape.breakGaps === true;
  let column = NaN;
  let count = 0;
  let minY = 0;
  let maxY = 0;
  let lastY = 0;
  let prevIndex = NaN;
  let runFrom = 0;
  // Colour ids of the column's latest point, and the column's first vertex.
  let line = 0;
  let fill = 0;
  let columnFrom = 0;

  // Add a vertex; steps first go level to the new x, then jump.
  const emit = (x: number, y: number) => {
    const n = out.length;
    if (step && n > runFrom) {
      const px = out.x[n - 1]!;
      const py = out.y[n - 1]!;
      if (x !== px && y !== py) {
        out.push(x, py);
        if (colors) out.paint(n, out.color![n - 1]!, out.fill![n - 1]!);
      }
    }
    out.push(x, y);
    if (colors) out.paint(out.length - 1, line, fill);
  };
  const flush = () => {
    if (count > 1) {
      if (minY !== maxY) {
        emit(column, minY);
        emit(column, maxY);
      }
      emit(column, lastY);
      // The column's first vertex was painted with its first point's colours.
      if (colors) out.paint(columnFrom, line, fill);
    }
    column = NaN;
    count = 0;
  };
  const breakRun = () => {
    flush();
    out.newRun();
    runFrom = out.length;
  };

  for (let k = a; k < b; k++) {
    const index = indexAt(k);
    const y = yOf(valueAt(k));
    if (!Number.isFinite(y)) {
      breakRun();
      prevIndex = NaN;
      continue;
    }
    if (breakGaps && index !== prevIndex + 1 && !Number.isNaN(prevIndex)) breakRun();
    prevIndex = index;
    const x = xOf(index);
    const col = Math.round(x);
    if (col !== column) flush();
    if (colors) {
      line = colors.line(k);
      fill = colors.fill(k);
    }
    if (col !== column) {
      column = col;
      emit(x, y);
      columnFrom = out.length - 1;
      minY = maxY = y;
    } else {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    count++;
    lastY = y;
  }
  flush();
  out.finish();
  out.colored = colors !== undefined;
  if (shape.lineType === 'curved') for (let r = 0; r < out.runCount; r++) monotoneSlopes(out, out.start(r), out.end(r));
  return out;
}

/**
 * Tangents for a monotone cubic through vertices [s, e): zero at local
 * extremes, else a harmonic mean of the neighbouring secant slopes, which keeps
 * every curve segment inside its endpoints' box. Segments with no width (points
 * stacked in one pixel column) count as flat.
 */
function monotoneSlopes(p: LinePath, s: number, e: number): void {
  const secant = (i: number) => {
    const dx = p.x[i + 1]! - p.x[i]!;
    return dx > 0 ? (p.y[i + 1]! - p.y[i]!) / dx : 0;
  };
  if (e - s < 2) {
    if (e > s) p.slope[s] = 0;
    return;
  }
  let prev = secant(s);
  p.slope[s] = prev;
  for (let i = s + 1; i < e - 1; i++) {
    const next = secant(i);
    p.slope[i] = prev * next > 0 ? (2 * prev * next) / (prev + next) : 0;
    prev = next;
  }
  p.slope[e - 1] = prev;
}

/**
 * Add run `r` of `path` to the current canvas path. Curved lines use cubic
 * segments wherever two vertices are apart horizontally, straight ones elsewhere.
 */
export function traceRun(ctx: CanvasRenderingContext2D, path: LinePath, r: number, curved: boolean): void {
  traceSpan(ctx, path, path.start(r), path.end(r), curved);
}

/** Add vertices [s, e) of `path` to the current canvas path as one subpath, shaped as `traceRun` shapes a run. */
export function traceSpan(ctx: CanvasRenderingContext2D, path: LinePath, s: number, e: number, curved: boolean): void {
  const { x, y, slope } = path;
  ctx.moveTo(x[s]!, y[s]!);
  for (let i = s + 1; i < e; i++) {
    const dx = x[i]! - x[i - 1]!;
    if (curved && dx > 0) {
      const t = dx / 3;
      ctx.bezierCurveTo(x[i - 1]! + t, y[i - 1]! + slope[i - 1]! * t, x[i]! - t, y[i]! - slope[i]! * t, x[i]!, y[i]!);
    } else {
      ctx.lineTo(x[i]!, y[i]!);
    }
  }
}

const DASH = [0, 0];
const NO_DASH: number[] = [];

/**
 * Dash pattern for `style` at `lineWidth`, empty for solid lines. Patterns
 * match the drawing tools' at their default width and grow with thicker lines.
 * The array is reused between calls; `setLineDash` copies it.
 */
export function lineDash(style: LineStyle | undefined, lineWidth: number): number[] {
  const w = Number.isFinite(lineWidth) ? lineWidth : 1;
  if (style === 'dashed') {
    DASH[0] = Math.max(6, 3 * w);
    DASH[1] = Math.max(4, 2 * w);
    return DASH;
  }
  if (style === 'dotted') {
    DASH[0] = Math.max(1.5, w);
    DASH[1] = Math.max(3, 2 * w);
    return DASH;
  }
  return NO_DASH;
}

/** Past this many colours a palette starts over. */
const PALETTE_LIMIT = 1024;

/**
 * Small integer ids for per-point colour strings, so paths keep colours in
 * typed arrays. Id 0 means no colour: unset, or one the canvas cannot use.
 */
export class ColorPalette {
  /** The colour of each id; index 0 is unused. */
  readonly colors: string[] = [''];
  private readonly ids = new Map<string, number>();

  /** The id of `color`, 0 when it is unset or invalid. */
  id(color: string | undefined): number {
    if (typeof color !== 'string') return 0;
    let id = this.ids.get(color);
    if (id === undefined) {
      id = isColor(color) ? this.colors.push(color) - 1 : 0;
      this.ids.set(color, id);
    }
    return id;
  }

  /** Forget every id once there are many. Call before building a path, never while one is in use. */
  trim(): void {
    if (this.ids.size < PALETTE_LIMIT) return;
    this.ids.clear();
    this.colors.length = 1;
  }
}

/** Shared scratch path for drawing; a frame draws one line at a time. */
export const scratchPath = new LinePath();
