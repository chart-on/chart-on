import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { GroupedLine, LINE_MERGES, Pyramid } from '../src/lod';
import type { IndicatorDef } from '../src/indicators/types';
import type { CustomSeriesView } from '../src/series';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const bar = (i: number): Bar => ({ time: i * 60, open: 100, high: 101, low: 99, close: 100 });

/** A grouped chart of `n` flat bars, zoomed out to fit them all. */
function chart(n: number) {
  const c = new Chart(fakeContainer(), { animateViewChanges: false, grouping: { mode: 'pixel' } });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: n }, (_, i) => bar(i)));
  c.fitContent(false);
  frame(c);
  return c;
}

/** A wave with a spike every 997 points. */
const wave = (i: number) => (i % 997 === 500 ? 1000 : Math.sin(i / 40) * 10);

describe('GroupedLine', () => {
  it('keeps the first, lowest, highest and last value of each bucket, and breaks between distant buckets', () => {
    const indices = [0, 1, 2, 3, 12, 13];
    const values = [5, 1, 9, 4, 7, 8];
    const p = new Pyramid(LINE_MERGES, {
      count: () => indices.length,
      index: (k) => indices[k]!,
      itemAt: (i) => indices.indexOf(i),
      value: (k) => values[k]!,
    });
    const g = new GroupedLine().fill(p, 2, 0, 15, true);
    expect([...g.index.subarray(0, g.length)]).toEqual([1.5, 1.5, 1.5, 1.5, 13.5, 13.5, 13.5, 13.5, 13.5]);
    expect([...g.value.subarray(0, g.length)]).toEqual([5, 1, 9, 4, NaN, 7, 7, 8, 8]);
    expect(new GroupedLine().fill(p, 2, 0, 15).length).toBe(8);
  });

  it('moves each bucket past its first value into its column, top first, leaving gap vertices', () => {
    const indices = [0, 1, 2, 3, 12, 13];
    const values = [5, 1, 9, 4, 7, 8];
    const p = new Pyramid(LINE_MERGES, {
      count: () => indices.length,
      index: (k) => indices[k]!,
      itemAt: (i) => indices.indexOf(i),
      value: (k) => values[k]!,
    });
    const g = new GroupedLine().fill(p, 2, 0, 15, true);
    // At x = 1.1 * index - 0.2, the first centre (1.5) rounds left to column 1 and the second (13.5) right to 15.
    const left = 1.2 / 1.1;
    const right = 15.2 / 1.1;
    const snapped = () => [...g.index.subarray(0, g.length)].map((i) => Math.round(i * 1e6) / 1e6);
    const round = (xs: number[]) => xs.map((i) => Math.round(i * 1e6) / 1e6);
    g.snapColumns([1.1, -0.2], true, false);
    expect(snapped()).toEqual(round([1.5, left, left, left, 13.5, 13.5, right, right, right]));
    expect([...g.value.subarray(0, g.length)]).toEqual([5, 9, 1, 4, NaN, 7, 8, 7, 8]);
    // Forward: a first value right of its column moves there too, so a fill never steps back.
    g.fill(p, 2, 0, 15, true).snapColumns([1.1, -0.2], false, true);
    expect(snapped()).toEqual(round([left, left, left, left, 13.5, 13.5, right, right, right]));
    expect([...g.value.subarray(0, g.length)]).toEqual([5, 1, 9, 4, NaN, 7, 7, 8, 8]);
  });
});

describe('grouped line series', () => {
  it('autoscales over whole buckets, keeps spikes and shows the bucket in the legend', () => {
    const c = chart(100_000);
    const line = c.addLine({ title: 'Wave' });
    line.setData(Array.from({ length: 100_000 }, (_, i) => ({ time: i * 60, value: wave(i) })));
    frame(c);
    const L = c.groupLevel;
    expect(L).toBeGreaterThan(0);
    const [lo, hi] = line.priceRange(0, 99_999)!;
    expect(hi).toBe(1000);
    expect(lo).toBeCloseTo(-10, 1);
    const w = 2 ** L;
    expect(line.legend(5).parts[0]!.text).toBe(line.formatValue(wave(w - 1)));
  });

  it('follows live updates and appends', () => {
    const c = chart(4096);
    const line = c.addLine({ title: 'Live' });
    line.setData(Array.from({ length: 4096 }, (_, i) => ({ time: i * 60, value: 1 })));
    frame(c);
    line.update({ time: 4095 * 60, value: 50 });
    expect(line.priceRange(0, 4095)![1]).toBe(50);
    expect(line.legend(4095).parts[0]!.text).toBe(line.formatValue(50));
  });
});

describe('grouped indicator plots', () => {
  const def: IndicatorDef = {
    id: 'wave',
    name: 'Wave',
    placement: 'pane',
    inputs: [],
    plots: [
      { id: 'line', type: 'line' },
      { id: 'hist', type: 'histogram' },
    ],
    compute: (src) => {
      const line = new Float64Array(src.length);
      const hist = new Float64Array(src.length);
      for (let i = 0; i < src.length; i++) {
        line[i] = i < 10 ? NaN : wave(i);
        hist[i] = i % 3;
      }
      return { line, hist };
    },
  };

  it('autoscale lines from the levels and histograms from bucket columns, and draw one column per bucket', () => {
    const c = chart(50_000);
    const series = c.indicators.add(def).series!;
    frame(c);
    expect(c.groupLevel).toBeGreaterThan(0);
    const [lo, hi] = series.priceRange(0, 49_999)!;
    expect(hi).toBe(1000);
    expect(lo).toBeLessThanOrEqual(0);
    const r = (c as unknown as { renderer: { drawRects: (...args: unknown[]) => void } }).renderer;
    const counts: number[] = [];
    const draw = r.drawRects.bind(r);
    r.drawRects = (batch, first, count, u) => {
      counts.push(count as number);
      draw(batch, first, count, u);
    };
    frame(c);
    r.drawRects = draw;
    for (const n of counts) expect(n).toBeLessThanOrEqual(2 * c.plotWidth);
    // The histogram's last value in the first bucket.
    const w = c.grouping!.bars;
    expect(series.legend(0).parts.map((p) => p.text)).toContain(series.options.format((w - 1) % 3));
  });
});

describe('grouped custom series', () => {
  type Item = { time: number; value: number };

  function custom(c: Chart, group?: (items: readonly Item[]) => Item) {
    const draw = vi.fn((_ctx: CanvasRenderingContext2D, _view: CustomSeriesView<Item, object>) => {});
    const groupHook = group && vi.fn(group);
    const s = c.addCustomSeries<Item, object>({
      type: 'dots',
      priceRange: (item) => [item.value, item.value],
      draw,
      ...(groupHook ? { group: groupHook } : {}),
    });
    s.setData(Array.from({ length: 4096 }, (_, i) => ({ time: i * 60, value: i })));
    frame(c);
    return { s, draw, groupHook };
  }

  it('draws one grouped item per bucket, as wide as the bucket, and calls group once per bucket', () => {
    const c = chart(4096);
    const sum = (items: readonly Item[]) => ({ time: items[0]!.time, value: items.reduce((t, x) => t + x.value, 0) });
    const { s, draw, groupHook } = custom(c, sum);
    const view = draw.mock.calls.at(-1)![1];
    const w = c.grouping!.bars;
    expect(view.barSpacing).toBeCloseTo(c.time.barSpacing * w);
    expect(view.items[0]!.item.value).toBe((w * (w - 1)) / 2);
    expect(view.items[0]!.index).toBe((w - 1) / 2);
    const calls = groupHook!.mock.calls.length;
    frame(c);
    expect(groupHook!.mock.calls.length).toBe(calls);
    // A live update recomputes only the newest bucket.
    s.update({ time: 4095 * 60, value: 0 });
    frame(c);
    expect(groupHook!.mock.calls.length).toBe(calls + 1);
  });

  it('shows the last item of each bucket without a group hook', () => {
    const c = chart(4096);
    const { draw } = custom(c);
    const view = draw.mock.calls.at(-1)![1];
    const w = c.grouping!.bars;
    expect(view.items[0]!.item.value).toBe(w - 1);
  });
});
