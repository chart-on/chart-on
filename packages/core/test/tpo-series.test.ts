import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { tpoColumns, type TpoColumn } from '../src/profile/tpo';
import { tpoSeries, type TpoSeriesOptions } from '../src/profile/tpo-series';
import type { CustomSeriesBaseOptions, CustomSeriesView } from '../src/series';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';
import { withAlpha } from '../src/util/color';

type Call = [string, ...unknown[]];

/** A 2D context that records the calls the series makes, with the fill style in force for each fill. */
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({ fillStyle: '', textAlign: 'start', font: '', textBaseline: 'alphabetic' } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push(key.startsWith('fill') ? [key, target.fillStyle, ...args] : [key, ...args]);
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, of: (name: string) => calls.filter((c) => c[0] === name) };
}

const bar = (time: number, low: number, high: number): Bar => ({ time, open: low, high, low, close: high });

/**
 * One session of three periods on rows 100 to 104 (row size 1): counts
 * [1, 3, 2, 1, 1], point of control row 1 (101), value area rows 0 to 3.
 */
const session = (time = 0) => tpoColumns([bar(time, 100, 102), bar(time + 1800, 101, 104), bar(time + 3600, 101, 101)], { rowSize: 1 });

/** A view drawing `columns` at `barSpacing` px with `rowPx` css px per price unit (`-rowPx` inverts the scale). */
function view(columns: TpoColumn[], barSpacing: number, rowPx: number, options: TpoSeriesOptions = {}) {
  return {
    items: columns.map((item, i) => ({ item, index: i, x: 50 + i * barSpacing })),
    options: { title: 'TPO', lastValueLabel: false, format: (v: number) => v.toFixed(1), ...options } as TpoSeriesOptions & CustomSeriesBaseOptions,
    width: 400,
    height: 400,
    barSpacing,
    pixelRatio: 1,
    theme: darkTheme,
    priceToY: (p: number) => 300 - (p - 100) * rowPx,
    yToPrice: (y: number) => 100 + (300 - y) / rowPx,
    indexToX: (i: number) => 50 + i * barSpacing,
  } satisfies CustomSeriesView<TpoColumn, TpoSeriesOptions & CustomSeriesBaseOptions>;
}

/** Rects per fill, in fill order, with the fill style: [style, rects][]. */
function fills(calls: Call[]): [unknown, unknown[][]][] {
  const out: [unknown, unknown[][]][] = [];
  let rects: unknown[][] = [];
  for (const c of calls) {
    if (c[0] === 'beginPath') rects = [];
    if (c[0] === 'rect') rects.push(c.slice(1));
    if (c[0] === 'fill') out.push([c[1], rects]);
  }
  return out;
}

describe('tpoSeries', () => {
  it('fixes the session profile used by the tests', () => {
    const p = session()[0]!.profile;
    expect([p.counts, p.poc, p.valueAreaLow, p.valueAreaHigh]).toEqual([[1, 3, 2, 1, 1], 1, 0, 3]);
  });

  it('autoscales every bar to its whole session profile', () => {
    for (const c of session()) expect(tpoSeries.priceRange(c, {})).toEqual([100, 105]);
    const empty = tpoColumns([{ time: 0, open: 1, high: NaN, low: 1, close: 1 }], { rowSize: 1 });
    expect(tpoSeries.priceRange(empty[0]!, {})).toBeNull();
  });

  it('draws blocks in three batched fills: value area, outside it, point of control', () => {
    const { ctx, calls, of } = recorder();
    tpoSeries.draw(ctx, view(session(), 6, 6));
    const f = fills(calls);
    expect(f.map(([style]) => style)).toEqual([darkTheme.line, withAlpha(darkTheme.line, 0.4), darkTheme.text]);
    // Column 0 holds rows 0-4, column 1 rows 1-2, column 2 row 1. Cells are 1 px narrower and shorter than their slot.
    expect(f[0]![1]).toEqual([
      [47, 294, 5, 5],
      [47, 282, 5, 5],
      [47, 276, 5, 5],
      [53, 282, 5, 5],
    ]);
    expect(f[1]![1]).toEqual([[47, 270, 5, 5]]);
    expect(f[2]![1].map((r) => r[0])).toEqual([47, 53, 59]);
    expect(of('fillText')).toEqual([]);
  });

  it('writes period letters when cells are big enough, coloured like the blocks', () => {
    const { ctx, calls, of } = recorder();
    tpoSeries.draw(ctx, view(session(), 20, 12, { color: '#123456', pocColor: '#abcdef' }));
    expect(fills(calls).every(([, rects]) => rects.length === 0)).toBe(true);
    const faded = withAlpha('#123456', 0.4);
    expect(of('fillText').map((c) => [c[2], c[1], c[3], c[4]])).toEqual([
      ['A', '#123456', 50, 294],
      ['A', '#abcdef', 50, 282],
      ['A', '#123456', 50, 270],
      ['B', '#123456', 50, 258],
      ['B', faded, 50, 246],
      ['B', '#abcdef', 70, 282],
      ['B', '#123456', 70, 270],
      ['C', '#abcdef', 90, 282],
    ]);
  });

  it('draws blocks only with letters: false, and blocks when rows are too short for letters', () => {
    for (const v of [view(session(), 20, 12, { letters: false }), view(session(), 20, 6)]) {
      const { ctx, calls, of } = recorder();
      tpoSeries.draw(ctx, v);
      expect(fills(calls).reduce((n, [, rects]) => n + rects.length, 0)).toBe(8);
      expect(of('fillText')).toEqual([]);
    }
  });

  it('keeps narrow columns at least 1 px wide, and works on an inverted scale', () => {
    const { ctx, calls } = recorder();
    tpoSeries.draw(ctx, view(session(), 0.5, -6));
    const rects = fills(calls).flatMap(([, r]) => r);
    expect(rects).toHaveLength(8);
    expect(rects.every((r) => r[2] === 1 && (r[3] as number) > 0)).toBe(true);
    // Inverted: row 0 (100..101) runs from y 300 down to 306.
    expect(fills(calls)[0]![1][0]).toEqual([49.75, 300, 1, 5]);
  });

  it('shows the point of control and value area in the legend', () => {
    const o = view([], 1, 1).options;
    expect(tpoSeries.legend!(session()[1], o)).toEqual([
      { label: 'POC', text: '101.5' },
      { label: 'VAH', text: '104.0' },
      { label: 'VAL', text: '100.0' },
    ]);
    expect(tpoSeries.legend!(undefined, o)).toEqual([]);
  });

  describe('on a chart', () => {
    const charts: Chart[] = [];
    afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

    it('draws through addCustomSeries and autoscales to the session', () => {
      const c = new Chart(fakeContainer());
      charts.push(c);
      const errors = vi.fn();
      c.on('series:error', errors);
      const bars = [bar(0, 100, 102), bar(1800, 101, 104), bar(3600, 101, 101)];
      c.addCandles().setData(bars);
      const draw = vi.fn(tpoSeries.draw);
      const tpo = c.addCustomSeries({ ...tpoSeries, draw }, { title: 'TPO' });
      tpo.setData(tpoColumns(bars, { rowSize: 1 }));
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
      expect(errors).not.toHaveBeenCalled();
      expect(draw.mock.calls.at(-1)![1].items.map((i) => i.item.column)).toEqual([0, 1, 2]);
      // The last bar alone spans one row; autoscale still covers its session.
      expect(tpo.priceRange(2, 2)).toEqual([100, 105]);
    });
  });
});
