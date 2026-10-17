import { describe, expect, it } from 'vitest';
import { HeatmapGrid } from '../src/gl/heatmap-grid';
import { footprintCells, levelRows, reducePixel, type CellReduce } from '../src/gl/heatmap-reduce';

const ROWS = 2000;
const COLS = 200;

/** A `COLS` × `ROWS` grid of `value(col, row)` with the levels of `reduce`. */
function grid(value: (col: number, row: number) => number, reduce: CellReduce, cols = COLS, rows = ROWS): HeatmapGrid {
  const g = new HeatmapGrid();
  g.maxColumns = cols;
  g.reduce = reduce;
  const values = new Float32Array(cols * rows);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) values[c * rows + r] = value(c, r);
  g.reset(rows, 0, 1, cols, values);
  return g;
}

/**
 * Render a grid's pixels the way `HEATMAP_FS` does (through its CPU
 * reference): `colsPerPx` columns per device pixel shifted by `colOffset`,
 * and rows at `rowAt(y)` for a device y. Returns each pixel's value, or null
 * where nothing is drawn.
 */
function render(g: HeatmapGrid, colsPerPx: number, colOffset: number, rowAt: (y: number) => number, height: number, reduce: CellReduce) {
  const out: Array<number | null> = [];
  const width = Math.ceil(g.cols / colsPerPx) + 1;
  const colAt = (x: number) => x * colsPerPx - colOffset;
  for (let x = -1; x < width; x++) {
    for (let y = -2; y < height + 2; y++) out.push(reducePixel(g, colAt, rowAt, x, y, reduce));
  }
  return out;
}

/** Rows counting down the device y (like prices), `rowsPerPx` a pixel, shifted by `offset` rows. */
const linear = (rowsPerPx: number, offset: number) => (y: number) => ROWS - y * rowsPerPx - offset;

/** One bright cell in an otherwise empty grid. */
const bright = (col: number, row: number) => (c: number, r: number) => (c === col && r === row ? 100 : 0);
/** Small positive integers, so float sums stay exact. */
const pattern = (c: number, r: number) => ((c * 7 + r * 13) % 11) + 1;

const offsets = Array.from({ length: 16 }, (_, i) => ({ col: (i % 4) * 0.5, row: i * 0.25 }));

function total(value: (c: number, r: number) => number): number {
  let sum = 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) sum += value(c, r);
  return sum;
}

const sumOf = (pixels: Array<number | null>) => pixels.reduce<number>((s, v) => s + (v ?? 0), 0);

describe('heatmap cell reduction', () => {
  it('keeps a single bright cell visible at every pan offset with max', () => {
    for (const cell of [bright(57, 1234), bright(0, 0), bright(COLS - 1, ROWS - 1)]) {
      const g = grid(cell, 'max');
      for (const offset of offsets) {
        const pixels = render(g, 2, offset.col, linear(4, offset.row), ROWS / 4, 'max');
        expect(pixels.filter((v) => v === 100)).toHaveLength(1);
      }
    }
  });

  it('loses it at some offsets with nearest, as one sample per pixel did', () => {
    const g = grid(bright(57, 1234), 'nearest');
    const shown = offsets.map((o) => render(g, 2, o.col, linear(4, o.row), ROWS / 4, 'nearest').includes(100));
    expect(shown).toContain(false);
    expect(shown).toContain(true);
  });

  it('counts every cell exactly once with sum', () => {
    const g = grid(pattern, 'sum');
    for (const o of offsets.slice(0, 4)) {
      expect(sumOf(render(g, 2, o.col, linear(4, o.row), ROWS / 4, 'sum'))).toBe(total(pattern));
    }
  });

  it('reads rows from the levels where many share a pixel, still exactly', () => {
    // 8 columns a pixel leave 8 row reads: 50 rows a pixel come from level 2 (16 rows a texel).
    for (const flip of [false, true]) {
      const rowAt = (offset: number) => (y: number) => (flip ? y * 50 + offset : linear(50, offset)(y));
      for (const o of offsets.slice(0, 6)) {
        const pixels = render(grid(bright(57, 1234), 'max'), 8, o.col, rowAt(o.row), ROWS / 50, 'max');
        expect(pixels.filter((v) => v === 100)).toHaveLength(1);
        expect(sumOf(render(grid(pattern, 'sum'), 8, o.col, rowAt(o.row), ROWS / 50, 'sum'))).toBe(total(pattern));
      }
    }
  });

  it('keeps each row in one pixel where the level changes down the pane', () => {
    // Rows a pixel grow with the row, as on a log scale: row = a·t + b·t² for
    // t pixels from the bottom row, rows up or down the pane. Levels change
    // down the pane, and an edge between levels must not drop or repeat rows.
    const sum = grid(pattern, 'sum');
    const brights = [0, 3, 700, 1300, 1999].map((row) => grid(bright(40, row), 'max'));
    for (const colsPerPx of [1, 3, 8]) {
      for (const [a, b] of [[1.2, 0.02], [2, 0.18], [3, 1.3], [1.5, 0.5]] as const) {
        const height = Math.ceil((-a + Math.sqrt(a * a + 4 * b * ROWS)) / (2 * b)) + 1;
        for (const flip of [false, true]) {
          const rowAt = (y: number) => {
            const t = flip ? height - y : y;
            return a * t + b * t * t;
          };
          const pixels = (g: HeatmapGrid, reduce: CellReduce) => {
            const out: Array<number | null> = [];
            for (let x = -1; x <= COLS / colsPerPx; x++) {
              for (let y = 0; y < height; y++) out.push(reducePixel(g, (q) => q * colsPerPx, rowAt, x, y, reduce));
            }
            return out;
          };
          expect(sumOf(pixels(sum, 'sum'))).toBe(total(pattern));
          for (const g of brights) expect(pixels(g, 'max').filter((v) => v === 100)).toHaveLength(1);
        }
      }
    }
  });

  it('samples the cell at the centre while cells are at least a pixel', () => {
    expect(footprintCells(10.2, 10.9, 10.55, 20)).toEqual([10, 10]);
    // Straddling a boundary: still one cell, the one at the centre.
    expect(footprintCells(10.6, 11.4, 11, 20)).toEqual([11, 11]);
    expect(footprintCells(10.2, 10.9, 10.55, 10)).toBeNull();
  });

  it('takes the cells whose centres lie in the pixel, clamped to the grid', () => {
    expect(footprintCells(10, 14, 12, 20)).toEqual([10, 13]);
    expect(footprintCells(14, 10, 12, 20)).toEqual([10, 13]);
    expect(footprintCells(-3, 1, -1, 20)).toEqual([0, 0]);
    expect(footprintCells(-3, 0.4, -1, 20)).toBeNull();
    expect(footprintCells(18, 22, 20, 20)).toEqual([18, 19]);
  });

  it('reads only the cell at the pixel centre with nearest, however many share the pixel', () => {
    const g = grid(pattern, 'nearest', 20, 20);
    // 4 columns and 4 rows a pixel: the centre is at column 2, row 8.
    expect(reducePixel(g, (x) => x * 4, (y) => 10 - y * 4, 0, 0, 'nearest')).toBe(pattern(2, 8));
    expect(reducePixel(g, (x) => x * 4, (y) => 10 - y * 4, 5, 0, 'nearest')).toBeNull();
    expect(reducePixel(g, (x) => x * 4, (y) => 10 - y * 4, 0, 3, 'nearest')).toBeNull();
  });

  it('reads evenly spaced columns past the cap, scaling a sum up', () => {
    // 100 columns and half a row a pixel: 50 of the columns read, standing for all.
    const g = grid(() => 1, 'sum', 100, 10);
    expect(reducePixel(g, (x) => x * 100, (y) => 5 - y / 2, 0, 0, 'sum')).toBe(100);
    // Every second column is read, so a bright odd column is missed.
    const odd = grid(bright(31, 4), 'max', 100, 10);
    expect(reducePixel(odd, (x) => x * 100, (y) => 5 - y / 2, 0, 0, 'max')).toBe(0);
  });

  it('sizes the levels a quarter of the rows each, down to four', () => {
    expect(levelRows(2000)).toEqual([500, 125, 32, 8, 2]);
    expect(levelRows(16)).toEqual([4]);
    expect(levelRows(4)).toEqual([]);
  });
});
