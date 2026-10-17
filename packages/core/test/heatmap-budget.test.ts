import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DEFAULT_HEATMAP_BUDGET, HeatmapGrid, heatmapColumnLimit } from '../src/gl/heatmap-grid';
import type { HeatmapSeries } from '../src/series';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** A chart with `bars` one-minute candles and a heatmap over the first `cols` of them. */
function heatmap(rows: number, cols: number, options: Parameters<Chart['addHeatmap']>[0] = {}, bars = cols + 50) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(Array.from({ length: bars }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
  const series = c.addHeatmap(options);
  const times = Array.from({ length: cols }, (_, i) => i * 60);
  const values = new Float32Array(rows * cols).map((_, i) => (i % 97) + 1);
  series.setData({ rows, priceStart: 0, priceStep: 1, times, values });
  return { c, series };
}

const firstTime = (s: HeatmapSeries) => (s as unknown as { firstTime: number }).firstTime;

describe('heatmapColumnLimit', () => {
  it('takes the smallest of the GPU limit, maxColumns and the budget at 8 bytes a cell', () => {
    // 256 MiB / (2,000 rows × 8 B) = 16,777 columns, under a 16,384 texture.
    expect(heatmapColumnLimit(2000, 16384)).toBe(16384);
    // 256 MiB / (16,384 × 8 B) = 2,048.
    expect(heatmapColumnLimit(16384, 16384)).toBe(2048);
    expect(heatmapColumnLimit(16384, 16384, Infinity, DEFAULT_HEATMAP_BUDGET * 2)).toBe(4096);
    expect(heatmapColumnLimit(100, 16384, 500)).toBe(500);
    expect(heatmapColumnLimit(100, 4096, 10_000, 100 * 8 * 300)).toBe(300);
    // Never below one column.
    expect(heatmapColumnLimit(100, 4096, Infinity, 1)).toBe(1);
  });

  it('pays for the reduction levels of max and sum', () => {
    // 2,000 rows keep 500 + 125 + 32 + 8 + 2 level texels a column: 256 MiB / (2,667 × 8 B).
    expect(heatmapColumnLimit(2000, 16384, Infinity, DEFAULT_HEATMAP_BUDGET, 'max')).toBe(12581);
    expect(heatmapColumnLimit(2000, 16384, Infinity, DEFAULT_HEATMAP_BUDGET, 'sum')).toBe(12581);
    expect(heatmapColumnLimit(2000, 16384, Infinity, DEFAULT_HEATMAP_BUDGET, 'nearest')).toBe(16384);
    // Four rows or fewer need no levels.
    expect(heatmapColumnLimit(4, 4096, Infinity, 4 * 8 * 300, 'max')).toBe(300);
  });
});

describe('HeatmapGrid.setMaxColumns', () => {
  it('drops the oldest columns over the cap and releases storage', () => {
    const g = new HeatmapGrid();
    g.maxColumns = 100;
    g.reset(2, 0, 1, 80, new Float32Array(160).map((_, i) => i));
    expect(g.capacity).toBe(100);
    expect(g.setMaxColumns(50)).toBe(30);
    expect(g.cols).toBe(50);
    expect(g.capacity).toBe(50);
    expect(g.valueAt(0, 0)).toBe(60);
    expect(g.setMaxColumns(200)).toBe(0);
    expect(g.cols).toBe(50);
  });
});

describe('heatmap series budget', () => {
  it('keeps the newest columns that fit the budget', () => {
    const rows = 100;
    const { series } = heatmap(rows, 150, { memoryBudget: rows * 8 * 100, cellReduce: 'nearest' });
    expect(series.grid.cols).toBe(100);
    expect(series.grid.capacity).toBeLessThanOrEqual(100);
    expect(firstTime(series)).toBe(50 * 60);
  });

  it('counts the reduction levels in the budget, and trims when they are turned on', () => {
    const rows = 100;
    // 100 rows keep 25 + 7 + 2 level texels a column: 80,000 B / (134 × 8 B) = 74 columns.
    const { series } = heatmap(rows, 150, { memoryBudget: rows * 8 * 100 });
    expect(series.grid.cols).toBe(74);
    expect(series.grid.levels.length).toBeLessThanOrEqual(34 * 74);
    series.applyOptions({ cellReduce: 'nearest' });
    expect(series.grid.levels.length).toBe(0);
    series.setData({ rows, priceStart: 0, priceStep: 1, times: [...Array(150).keys()].map((i) => i * 60), values: new Float32Array(rows * 150) });
    expect(series.grid.cols).toBe(100);
    series.applyOptions({ cellReduce: 'sum' });
    expect(series.grid.cols).toBe(74);
    expect(series.grid.reduce).toBe('sum');
    expect(series.grid.levelWidth).toBe(34);
    expect(firstTime(series)).toBe(76 * 60);
  });

  it('trims at once when maxColumns is lowered', () => {
    const { series } = heatmap(10, 120);
    series.applyOptions({ maxColumns: 40 });
    expect(series.grid.cols).toBe(40);
    expect(firstTime(series)).toBe(80 * 60);
    // Live appends at the cap drop the oldest eighth.
    series.updateColumn(120 * 60, new Float32Array(10).fill(1));
    expect(series.grid.cols).toBe(36);
    expect(firstTime(series)).toBe(85 * 60);
  });

  it('rejects invalid caps', () => {
    expect(() => heatmap(10, 10, { maxColumns: 0 })).toThrow(/maxColumns/);
    const { series } = heatmap(10, 10);
    expect(() => series.applyOptions({ memoryBudget: -1 })).toThrow(/memoryBudget/);
    expect(series.options.memoryBudget).toBeUndefined();
  });
});

describe('heatmap trims', () => {
  /** Value of the test helper's data at column `col`, row `row`. */
  const valueOf = (rows: number, col: number, row: number) => ((col * rows + row) % 97) + 1;
  const firstIndex = (s: HeatmapSeries) => (s as unknown as { firstIndex: number }).firstIndex;

  it('maps the first stored column to the oldest kept bar after a setData trim', () => {
    const rows = 10;
    const { series } = heatmap(rows, 150, { maxColumns: 100 });
    expect(series.valueAt(0, 0)).toBe(valueOf(rows, 50, 0));
    expect(firstIndex(series)).toBe(50);
    expect(series.cellAt(50, 0.5)).toMatchObject({ col: 0, row: 0, value: valueOf(rows, 50, 0) });
    expect(series.cellAt(49, 0.5)).toBeNull();
  });

  it('keeps firstIndex aligned after a cap trim on append', () => {
    const rows = 10;
    const { series } = heatmap(rows, 40, { maxColumns: 40 });
    series.updateColumn(40 * 60, new Float32Array(rows).fill(1));
    // The oldest eighth (5 columns) went.
    expect(firstIndex(series)).toBe(5);
    expect(series.valueAt(0, 0)).toBe(valueOf(rows, 5, 0));
    expect(series.cellAt(5, 0.5)).toMatchObject({ col: 0, value: valueOf(rows, 5, 0) });
    expect(series.cellAt(40, 0.5)).toMatchObject({ col: 35, value: 1 });
  });

  it('leaves the state unchanged when a wrong-length column arrives at the cap', () => {
    const rows = 10;
    const { series } = heatmap(rows, 40, { maxColumns: 40 });
    const snapshot = () => ({
      cols: series.grid.cols,
      first: firstTime(series),
      index: firstIndex(series),
      value: series.valueAt(0, 0),
    });
    const before = snapshot();
    expect(() => series.updateColumn(40 * 60, new Float32Array(rows + 1))).toThrow(/rows/);
    expect(snapshot()).toEqual(before);
  });
});

describe('heatmap colour lookup table', () => {
  const lut = (s: HeatmapSeries) => (s as unknown as { lut: Uint8Array }).lut;

  it('is reused across columns and rebuilt only when the colours change', () => {
    const rows = 10;
    const { series } = heatmap(rows, 20);
    const first = lut(series);
    series.updateColumn(20 * 60, new Float32Array(rows).fill(1));
    series.updateColumn(20 * 60, new Float32Array(rows).fill(2));
    series.updateColumn(21 * 60, new Float32Array(rows).fill(3));
    series.applyOptions({ gap: 2 });
    expect(lut(series)).toBe(first);
    series.applyOptions({ colors: ['#000000', '#ffffff'] });
    expect(lut(series)).not.toBe(first);
    const second = lut(series);
    series.applyOptions({ colors: ['#000000', '#ffffff'] });
    expect(lut(series)).toBe(second);
  });
});

describe('heatmap colour range', () => {
  afterEach(() => vi.useRealTimers());

  it('is recomputed at most every 250 ms while columns arrive', () => {
    vi.useFakeTimers();
    const rows = 2000;
    const { series } = heatmap(rows, 200, {}, 400);
    void series.range;
    const refresh = vi.spyOn(series as unknown as { refreshRange(): void }, 'refreshRange');
    const column = new Float32Array(rows).fill(5);
    for (let i = 0; i < 20; i++) {
      series.updateColumn((200 + i) * 60, column);
      void series.range;
    }
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    const range = series.range;
    expect(series.range).toBe(range);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('asks for a frame once the throttle ends, so the last change shows', () => {
    vi.useFakeTimers();
    const rows = 10;
    const { c, series } = heatmap(rows, 20);
    void series.range;
    series.updateColumn(20 * 60, new Float32Array(rows).fill(1000));
    const render = vi.spyOn(c, 'requestRender');
    void series.range;
    expect(render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(render).toHaveBeenCalled();
  });

  it('follows a replaced last column', () => {
    vi.useFakeTimers();
    const rows = 10;
    const { series } = heatmap(rows, 20, { highPercentile: 100 });
    const before = series.range.max;
    series.updateColumn(19 * 60, new Float32Array(rows).fill(1000));
    vi.advanceTimersByTime(250);
    expect(before).toBeLessThan(1000);
    expect(series.range.max).toBe(1000);
  });

  it('is recomputed at once after setData or an option change', () => {
    vi.useFakeTimers();
    const rows = 10;
    const { series } = heatmap(rows, 20, { highPercentile: 100 });
    void series.range;
    series.setData({ rows, priceStart: 0, priceStep: 1, times: [0, 60], values: new Float32Array(rows * 2).fill(7) });
    expect(series.range.min).toBe(7);
    series.applyOptions({ highPercentile: 50 });
    expect(series.range.max).toBeCloseTo(7, 4);
  });

  it('follows changed percentiles', () => {
    const { series } = heatmap(50, 50);
    const before = series.range;
    series.applyOptions({ highPercentile: 50 });
    expect(series.range.max).toBeLessThan(before.max);
  });
});
