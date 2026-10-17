import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer, recordingWebgl2 } from './fake-dom';
import { Chart } from '../src/chart';
import { HeatmapGrid, percentileRange } from '../src/gl/heatmap-grid';

describe('HeatmapGrid', () => {
  it('stores column-major values and appends columns', () => {
    const g = new HeatmapGrid();
    g.reset(3, 100, 10, 2, new Float32Array([1, 2, 3, 4, 5, 6]));
    expect(g.valueAt(1, 2)).toBe(6);
    expect(g.rowOfPrice(125)).toBe(2);
    g.setColumn(2, new Float32Array([7, 8, 9]));
    expect(g.cols).toBe(3);
    expect(g.valueAt(2, 0)).toBe(7);
    expect(g.valueAt(3, 0)).toBeUndefined();
  });

  it('grows capacity and drops old columns', () => {
    const g = new HeatmapGrid();
    g.maxColumns = 200;
    g.reset(1, 0, 1, 1, new Float32Array([1]));
    for (let i = 1; i < 150; i++) g.setColumn(i, new Float32Array([i + 1]));
    expect(g.cols).toBe(150);
    expect(g.capacity).toBeLessThanOrEqual(200);
    g.dropFront(50);
    expect(g.cols).toBe(100);
    expect(g.valueAt(0, 0)).toBe(51);
  });

  it('validates input', () => {
    const g = new HeatmapGrid();
    expect(() => g.reset(0, 0, 1, 0, new Float32Array())).toThrow();
    expect(() => g.reset(2, 0, 1, 2, new Float32Array(3))).toThrow();
    g.reset(2, 0, 1, 1, new Float32Array(2));
    expect(() => g.setColumn(0, new Float32Array(3))).toThrow();
  });
});

describe('HeatmapGrid reduction levels', () => {
  const ROWS = 40;
  const column = (seed: number) => new Float32Array(ROWS).map((_, r) => ((seed * 31 + r * 7) % 13) + 1);
  /** Level texels of `col`, rebuilt by hand: four rows a texel, then four texels of the level before. */
  function expected(g: HeatmapGrid, col: number): number[] {
    const out: number[] = [];
    let src = Array.from(g.values.subarray(col * ROWS, (col + 1) * ROWS));
    while (src.length > 4) {
      const next: number[] = [];
      for (let i = 0; i < src.length; i += 4) {
        const part = src.slice(i, i + 4);
        next.push(g.reduce === 'sum' ? part.reduce((a, b) => a + b, 0) : Math.max(...part));
      }
      out.push(...next);
      src = next;
    }
    return out;
  }
  const levelsOf = (g: HeatmapGrid, col: number) => Array.from(g.levels.subarray(col * g.levelWidth, (col + 1) * g.levelWidth));

  function make(reduce: 'max' | 'sum' | 'nearest', cols = 5): HeatmapGrid {
    const g = new HeatmapGrid();
    g.reduce = reduce;
    const values = new Float32Array(ROWS * cols);
    for (let c = 0; c < cols; c++) values.set(column(c), c * ROWS);
    g.reset(ROWS, 0, 1, cols, values);
    return g;
  }

  it('holds each column reduced four rows at a time, level after level', () => {
    for (const reduce of ['max', 'sum'] as const) {
      const g = make(reduce);
      // 40 rows: levels of 10, 3 texels.
      expect([g.levelCount, g.levelWidth]).toEqual([2, 13]);
      for (let c = 0; c < g.cols; c++) expect(levelsOf(g, c)).toEqual(expected(g, c));
    }
    expect([make('nearest').levelCount, make('nearest').levels.length]).toEqual([0, 0]);
  });

  it('updates only the appended or replaced column in every level', () => {
    const g = make('max');
    const before = Array.from(g.levels.subarray(0, g.cols * g.levelWidth));
    g.setColumn(5, column(99));
    expect(Array.from(g.levels.subarray(0, 5 * g.levelWidth))).toEqual(before);
    expect(levelsOf(g, 5)).toEqual(expected(g, 5));
    g.setColumn(2, column(42));
    const after = Array.from(g.levels.subarray(0, 6 * g.levelWidth));
    for (let c = 0; c < 6; c++) {
      if (c === 2 || c === 5) continue;
      expect(after.slice(c * g.levelWidth, (c + 1) * g.levelWidth)).toEqual(before.slice(c * g.levelWidth, (c + 1) * g.levelWidth));
    }
    expect(levelsOf(g, 2)).toEqual(expected(g, 2));
  });

  it('keeps the levels with their columns through drops, growth and a new reduce mode', () => {
    const g = make('max', 3);
    g.maxColumns = 300;
    for (let c = 3; c < 200; c++) g.setColumn(c, column(c));
    g.dropFront(10);
    expect(levelsOf(g, 0)).toEqual(expected(g, 0));
    expect(levelsOf(g, 189)).toEqual(expected(g, 189));
    const version = g.layoutVersion;
    g.setReduce('sum');
    expect(g.layoutVersion).toBeGreaterThan(version);
    expect(levelsOf(g, 100)).toEqual(expected(g, 100));
    g.setReduce('nearest');
    expect(g.levelWidth).toBe(0);
  });
});

describe('heatmap level uploads', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  it('uploads only the new column of the levels on a live append', () => {
    const gl = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const rows = 100;
    c.addCandles().setData(Array.from({ length: 60 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const map = c.addHeatmap();
    const times = Array.from({ length: 20 }, (_, i) => i * 60);
    map.setData({ rows, priceStart: 0, priceStep: 0.01, times, values: new Float32Array(rows * 20).fill(1) });
    const frame = () => {
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
    };
    frame();
    // Values (100 texels a column) and levels (25 + 7 + 2) allocated once each.
    expect(gl.textures.filter((t) => t.kind === 'image' && t.width > 1).map((t) => t.width)).toEqual(
      expect.arrayContaining([100, 34]),
    );
    gl.textures.length = 0;
    map.updateColumn(20 * 60, new Float32Array(rows).fill(3));
    frame();
    expect(gl.textures).toEqual([
      { kind: 'sub', x: 0, y: 20, width: 100, height: 1 },
      { kind: 'sub', x: 0, y: 20, width: 34, height: 1 },
    ]);
  });
});

describe('percentileRange', () => {
  it('ignores zeros and picks percentiles', () => {
    const values = new Float32Array(101);
    for (let i = 1; i <= 100; i++) values[i] = i;
    const r = percentileRange(values, values.length, 10, 90);
    expect(r.min).toBe(10);
    expect(r.max).toBe(90);
  });

  it('falls back on empty data', () => {
    expect(percentileRange(new Float32Array(4), 4, 10, 90)).toEqual({ min: 0, max: 1 });
  });
});
