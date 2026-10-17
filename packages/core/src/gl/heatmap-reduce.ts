/**
 * How the heatmap cells under one device pixel combine into the colour shown:
 * `'max'` the largest value, `'sum'` their total, `'nearest'` the cell at the
 * pixel centre only.
 */
export type CellReduce = 'max' | 'sum' | 'nearest';

/** `u_reduce` value of each mode in `HEATMAP_FS`. */
export const REDUCE_MODES: Record<CellReduce, number> = { nearest: 0, max: 1, sum: 2 };

/** Texels the shader reads per fragment at most. */
export const MAX_READS = 64;
/** Columns per pixel read exactly at any row depth; past that, evenly spaced columns. */
export const EXACT_COLS = 8;

/**
 * Cells of one axis a pixel stands for, as `[first, last]` clamped to
 * `[0, count)`, or null when none: `a` and `b` are the fractional cell
 * positions of the pixel's edges, `centre` that of its centre. While cells
 * are at least a pixel wide it is the cell at the centre; otherwise the cells
 * whose centres lie in the pixel, so each cell counts in exactly one pixel.
 * The CPU reference of `cells` in `HEATMAP_FS`.
 */
export function footprintCells(a: number, b: number, centre: number, count: number): [number, number] | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let first: number;
  let last: number;
  if (hi - lo <= 1) {
    first = last = Math.floor(centre);
  } else {
    first = Math.max(Math.ceil(lo - 0.5), 0);
    last = Math.min(Math.ceil(hi - 0.5), count) - 1;
  }
  return first < 0 || last >= count || first > last ? null : [first, last];
}

/**
 * Rows of each reduction level of a `rows`-row grid: level `k` combines 4^k
 * rows per texel, down to at most 4 texels.
 */
export function levelRows(rows: number): number[] {
  const out: number[] = [];
  for (let n = rows; n > 4; ) out.push((n = Math.ceil(n / 4)));
  return out;
}

/**
 * Write the levels of one column: `values[from, from + rows)` combined four
 * rows at a time (max or sum), level after level, side by side from `out`.
 */
export function reduceColumn(values: Float32Array, from: number, rows: number, levels: Float32Array, out: number, sum: boolean): void {
  let src = values;
  for (let n = rows; n > 4; ) {
    const m = Math.ceil(n / 4);
    for (let i = 0; i < m; i++) {
      const end = from + Math.min(4 * i + 4, n);
      let v = src[from + 4 * i]!;
      for (let k = from + 4 * i + 1; k < end; k++) v = sum ? v + src[k]! : Math.max(v, src[k]!);
      levels[out + i] = v;
    }
    src = levels;
    from = out;
    out += m;
    n = m;
  }
}

/**
 * The finest level whose texels cover a pixel's rows `a` to `b` in at most
 * `maxRows` reads, keeping four spare for the texels its upper edge can add
 * (see `edgeRow`).
 */
export function levelOf(a: number, b: number, maxRows: number, levelCount: number): number {
  const span = Math.abs(b - a);
  let level = 0;
  while (level < levelCount && Math.ceil(span / 4 ** level) + 4 > maxRows) level++;
  return level;
}

/** First row past edge `e` (in rows), rounded up to a multiple of `size`. */
const edgeRow = (e: number, size: number) => size * Math.ceil(Math.ceil(e - 0.5) / size);

/** What `reducePixel` reads of a `HeatmapGrid`. */
export interface ReduceSource {
  rows: number;
  cols: number;
  values: Float32Array;
  levels: Float32Array;
  levelWidth: number;
  levelCount: number;
}

/**
 * The value device pixel (`px`, `py`) shows, or null where nothing is drawn:
 * the CPU reference of `HEATMAP_FS` without the gap. `colAt` and `rowAt` map a
 * device coordinate to a fractional cell position; pixel edges lie on whole
 * coordinates. Rows a pixel stands for are read from the finest level that
 * fits its reads, and an edge between two pixels on different levels rounds
 * up to the coarser texel. So each row counts in exactly one pixel wherever
 * rows per pixel do not shrink as rows grow, as on linear and log scales.
 */
export function reducePixel(
  g: ReduceSource,
  colAt: (x: number) => number,
  rowAt: (y: number) => number,
  px: number,
  py: number,
  reduce: CellReduce,
): number | null {
  if (reduce === 'nearest') {
    const col = Math.floor(colAt(px + 0.5));
    const row = Math.floor(rowAt(py + 0.5));
    return col < 0 || col >= g.cols || row < 0 || row >= g.rows ? null : g.values[col * g.rows + row]!;
  }
  const c0 = colAt(px);
  const c1 = colAt(px + 1);
  const r0 = rowAt(py);
  const r1 = rowAt(py + 1);
  const cols = footprintCells(c0, c1, colAt(px + 0.5), g.cols);
  let rows = footprintCells(r0, r1, rowAt(py + 0.5), g.rows);
  if (!cols || !rows) return null;
  const maxRows = Math.floor(MAX_READS / Math.min(Math.max(Math.ceil(Math.abs(c1 - c0)), 1), EXACT_COLS));
  const level = levelOf(r0, r1, maxRows, g.levelCount);
  const before = levelOf(rowAt(py - 1), r0, maxRows, g.levelCount);
  const after = levelOf(r1, rowAt(py + 2), maxRows, g.levelCount);
  let offset = 0;
  if (Math.max(level, before, after) > 0) {
    const e0 = edgeRow(r0, 4 ** Math.max(level, before));
    const e1 = edgeRow(r1, 4 ** Math.max(level, after));
    const size = 4 ** level;
    rows = [Math.max(Math.min(e0, e1) / size, 0), Math.min(Math.max(e0, e1) / size, Math.ceil(g.rows / size)) - 1];
    if (rows[0] > rows[1]) return null;
    for (let k = 1; k < level; k++) offset += Math.ceil(g.rows / 4 ** k);
  }
  const at = (c: number, r: number) => (level === 0 ? g.values[c * g.rows + r]! : g.levels[c * g.levelWidth + offset + r]!);
  const nc = cols[1] - cols[0] + 1;
  const nr = rows[1] - rows[0] + 1;
  const stepR = Math.ceil(nr / MAX_READS);
  const readR = Math.floor((nr - 1) / stepR) + 1;
  const stepC = Math.ceil(nc / Math.floor(MAX_READS / readR));
  const readC = Math.floor((nc - 1) / stepC) + 1;
  let v = reduce === 'sum' ? 0 : -3e38;
  for (let i = 0; i < readC * readR; i++) {
    const cell = at(cols[0] + Math.floor(i / readR) * stepC, rows[0] + (i % readR) * stepR);
    v = reduce === 'sum' ? v + cell : Math.max(v, cell);
  }
  // A sum over evenly spaced cells stands for all of them.
  return reduce === 'sum' ? (v * nc * nr) / (readC * readR) : v;
}
