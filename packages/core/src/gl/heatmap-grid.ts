import { levelRows, reduceColumn, type CellReduce } from './heatmap-reduce';
import { clampNum } from '../util/math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Bytes one heatmap cell costs at full capacity: its R32F texel plus the `Float32Array` mirror. */
export const HEATMAP_CELL_BYTES = 8;
/** Default `memoryBudget` of a heatmap series: 256 MiB. */
export const DEFAULT_HEATMAP_BUDGET = 256 * 1024 * 1024;

/** Texels per column of the reduction levels a grid of `rows` keeps for `reduce` (none for `'nearest'`). */
const levelTexels = (rows: number, reduce: CellReduce) => (reduce === 'nearest' ? [] : levelRows(rows));

/**
 * Most columns a heatmap of `rows` rows may store: within the GPU texture
 * height, `maxColumns` and the byte budget (which also pays for the
 * reduction levels of `reduce`), and at least one.
 */
export function heatmapColumnLimit(
  rows: number,
  maxTextureSize: number,
  maxColumns = Infinity,
  budget = DEFAULT_HEATMAP_BUDGET,
  reduce: CellReduce = 'nearest',
): number {
  const texels = Math.max(1, rows) + levelTexels(rows, reduce).reduce((a, b) => a + b, 0);
  const byBudget = Math.floor(budget / (texels * HEATMAP_CELL_BYTES));
  return Math.max(1, Math.min(maxTextureSize, Math.floor(maxColumns), byBudget));
}

/**
 * CPU-side heatmap storage mirroring the GPU texture layout:
 * texture width = rows, texture height = column capacity. Unless `reduce` is
 * `'nearest'` it also keeps each column's reduction levels (see `levelRows`),
 * side by side in `levels`, `levelWidth` per column, for the shader to read
 * where many rows share a pixel.
 */
export class HeatmapGrid {
  rows = 0;
  cols = 0;
  priceStart = 0;
  priceStep = 1;
  values = new Float32Array(0);
  /** How `levels` combine rows: set it before `reset`, or change it with `setReduce`. */
  reduce: CellReduce = 'max';
  levels = new Float32Array(0);
  levelWidth = 0;
  levelCount = 0;
  /** Lowest column changed since last GPU sync; Infinity when clean. */
  dirtyFrom = Infinity;
  /** Bumped when rows/capacity change and the texture must be reallocated. */
  layoutVersion = 0;
  gpu: unknown = null;
  /** Hard cap on stored columns; see `setMaxColumns`. */
  maxColumns = 4096;

  get capacity(): number {
    return this.rows === 0 ? 0 : this.values.length / this.rows;
  }

  reset(rows: number, priceStart: number, priceStep: number, cols: number, values: Float32Array): void {
    if (rows <= 0 || priceStep <= 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap needs rows > 0 and priceStep > 0' : '');
    if (values.length < rows * cols) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap values shorter than rows × columns' : '');
    if (cols > this.maxColumns) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Heatmap exceeds ${this.maxColumns} columns` : '');
    this.rows = rows;
    this.priceStart = priceStart;
    this.priceStep = priceStep;
    this.cols = cols;
    const capacity = Math.min(this.maxColumns, Math.max(cols + 64, Math.ceil(cols * 1.25)));
    this.values = new Float32Array(rows * capacity);
    this.values.set(values.subarray(0, rows * cols));
    this.#layoutLevels(capacity);
  }

  /** Change how the levels combine rows, rebuilding them. */
  setReduce(reduce: CellReduce): void {
    if (reduce === this.reduce) return;
    this.reduce = reduce;
    if (this.rows > 0) this.#layoutLevels(this.capacity);
  }

  /** Write one column; `col === cols` appends. Caller must drop columns at `maxColumns`. */
  setColumn(col: number, column: Float32Array): void {
    if (column.length !== this.rows) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Heatmap column must have ${this.rows} rows` : '');
    if (col < 0 || col > this.cols || col >= this.maxColumns) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap column out of range' : '');
    if (col === this.cols) {
      if (this.cols + 1 > this.capacity) this.#grow();
      this.cols++;
    }
    this.values.set(column, col * this.rows);
    this.#fillLevels(col, col + 1);
    if (col < this.dirtyFrom) this.dirtyFrom = col;
  }

  /** Drop the oldest `count` columns (keeps texture under GPU size limits). */
  dropFront(count: number): void {
    if (count <= 0) return;
    const n = Math.min(count, this.cols);
    this.values.copyWithin(0, n * this.rows, this.cols * this.rows);
    this.levels.copyWithin(0, n * this.levelWidth, this.cols * this.levelWidth);
    this.cols -= n;
    this.dirtyFrom = 0;
  }

  /**
   * Change the column cap. Columns over it are dropped from the front and
   * storage above it is released. Returns how many columns were dropped.
   */
  setMaxColumns(max: number): number {
    this.maxColumns = max;
    const drop = Math.max(0, this.cols - max);
    this.dropFront(drop);
    if (this.rows > 0 && this.capacity > max) this.#realloc(max);
    return drop;
  }

  valueAt(col: number, row: number): number | undefined {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return undefined;
    return this.values[col * this.rows + row];
  }

  rowOfPrice(price: number): number {
    return Math.floor((price - this.priceStart) / this.priceStep);
  }

  #grow(): void {
    this.#realloc(Math.min(this.maxColumns, Math.max(this.capacity * 2, this.cols + 64)));
  }

  /** Move the stored columns to storage for `capacity` columns. */
  #realloc(capacity: number): void {
    const next = new Float32Array(this.rows * capacity);
    next.set(this.values.subarray(0, this.rows * this.cols));
    this.values = next;
    const levels = new Float32Array(this.levelWidth * capacity);
    levels.set(this.levels.subarray(0, this.levelWidth * this.cols));
    this.levels = levels;
    this.layoutVersion++;
    this.dirtyFrom = 0;
  }

  /** Size the levels for the rows and `reduce`, and rebuild them for every column. */
  #layoutLevels(capacity: number): void {
    const sizes = levelTexels(this.rows, this.reduce);
    this.levelCount = sizes.length;
    this.levelWidth = sizes.reduce((a, b) => a + b, 0);
    this.levels = new Float32Array(this.levelWidth * capacity);
    this.#fillLevels(0, this.cols);
    this.layoutVersion++;
    this.dirtyFrom = 0;
  }

  #fillLevels(from: number, to: number): void {
    if (this.levelWidth === 0) return;
    for (let col = from; col < to; col++) {
      reduceColumn(this.values, col * this.rows, this.rows, this.levels, col * this.levelWidth, this.reduce === 'sum');
    }
  }
}

/** Reused sample buffer of `percentileRange`, so live updates do not allocate. */
let scratch = new Float32Array(0);

/**
 * Color range from percentiles of positive values (sampled for big grids).
 * Values below `low` are transparent; values above `high` saturate.
 */
export function percentileRange(
  values: Float32Array,
  length: number,
  lowPct: number,
  highPct: number,
  maxSamples = 50_000,
): { min: number; max: number } {
  const stride = Math.max(1, Math.floor(length / maxSamples));
  const capacity = Math.ceil(length / stride);
  if (scratch.length < capacity) scratch = new Float32Array(capacity);
  let n = 0;
  for (let i = 0; i < length; i += stride) {
    const v = values[i]!;
    if (v > 0 && Number.isFinite(v)) scratch[n++] = v;
  }
  if (n === 0) return { min: 0, max: 1 };
  // A typed array sorts numerically and natively, much faster than a comparator on number[].
  const sample = scratch.subarray(0, n).sort();
  const at = (p: number) => sample[clampNum(Math.floor((p / 100) * (sample.length - 1)), 0, sample.length - 1)]!;
  const min = at(lowPct);
  const max = Math.max(at(highPct), min * (1 + 1e-6) + 1e-12);
  return { min, max };
}
