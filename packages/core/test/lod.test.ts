import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { groupLevel, Pyramid, type PyramidSource } from '../src/lod';
import type { Bar } from '../src/types';

/** Items at timeline indices `indices` with values `values`, counting value reads. */
function source(indices: number[], values: number[]): PyramidSource<'v'> & { valueReads: number } {
  const src = {
    valueReads: 0,
    count: () => indices.length,
    index: (k: number) => indices[k]!,
    itemAt: (index: number) => indices.indexOf(index),
    value: (k: number) => {
      src.valueReads++;
      return values[k]!;
    },
  };
  return src;
}

function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const MERGES = { v: 'max' } as const;

describe('Pyramid', () => {
  it('answers min and max over any range like a scan, with gaps in the items', () => {
    const rand = random(11);
    const indices: number[] = [];
    for (let i = 0; i < 3000; i++) if (rand() > 0.2) indices.push(i);
    const values = indices.map(() => Math.round(rand() * 1000) - 500);
    const p = new Pyramid({ lo: 'min', hi: 'max' } as const, {
      count: () => indices.length,
      index: (k) => indices[k]!,
      itemAt: (index) => indices.indexOf(index),
      value: (k) => values[k]!,
    });
    for (let t = 0; t < 200; t++) {
      const a = Math.floor(rand() * 3000);
      const b = a + Math.floor(rand() * (3000 - a));
      const inRange = values.filter((_, k) => indices[k]! >= a && indices[k]! <= b);
      expect(p.extreme('lo', 'min', a, b)).toBe(inRange.length ? Math.min(...inRange) : Infinity);
      expect(p.extreme('hi', 'max', a, b)).toBe(inRange.length ? Math.max(...inRange) : -Infinity);
    }
  });

  it('reads O(log n) buckets per query', () => {
    const n = 1 << 20;
    const indices = Array.from({ length: n }, (_, i) => i);
    const p = new Pyramid(MERGES, { count: () => n, index: (k) => k, itemAt: (i) => (i < n ? i : -1), value: (k) => k % 977 });
    p.extreme('v', 'max', 0, n - 1);
    p.reads = 0;
    expect(p.extreme('v', 'max', 3, n - 5)).toBe(976);
    expect(p.reads).toBeLessThanOrEqual(2 * 21);
    expect(indices.length).toBe(n);
  });

  it('updates only the last bucket of each level on a tick and an append', () => {
    const indices = Array.from({ length: 1000 }, (_, i) => i);
    const values = indices.map((i) => (i * 37) % 101);
    const src = source(indices, values);
    const p = new Pyramid(MERGES, src);
    p.size(10);
    src.valueReads = 0;
    values[999] = 5000;
    p.update(999);
    expect(src.valueReads).toBeLessThanOrEqual(2);
    expect(p.get(10, 0, 'v')).toBe(5000);
    indices.push(1000);
    values.push(7000);
    src.valueReads = 0;
    p.update(1000);
    expect(src.valueReads).toBeLessThanOrEqual(2);
    expect(p.get(10, 0, 'v')).toBe(7000);
    // Same as building from scratch.
    const fresh = new Pyramid(MERGES, source(indices, values));
    for (let L = 1; L <= 10; L++) for (let j = 0; j < fresh.size(L); j++) expect(p.get(L, j, 'v')).toBe(fresh.get(L, j, 'v'));
  });

  it('picks a level whose buckets are at least two device pixels wide', () => {
    expect(groupLevel(2)).toBe(0);
    expect(groupLevel(1)).toBe(1);
    expect(groupLevel(0.3)).toBe(3);
    expect(groupLevel(0.25)).toBe(3);
  });
});

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function bars(n: number): Bar[] {
  const out: Bar[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = open + Math.sin(i / 50) + (i % 7) * 0.01 - 0.03;
    out.push({ time: i * 60, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 10 + (i % 5) });
  }
  return out;
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

function chart(n: number, grouping = true) {
  const c = new Chart(fakeContainer(), { animateViewChanges: false, grouping: grouping ? { mode: 'pixel' } : null });
  charts.push(c);
  const data = bars(n);
  const candles = c.addCandles();
  candles.setData(data);
  frame(c);
  return { c, candles, data };
}

/** Instances each `drawRects` call drew in one frame. */
function drawnInstances(c: Chart): number[] {
  const r = (c as unknown as { renderer: { drawRects: (...args: unknown[]) => void } }).renderer;
  const counts: number[] = [];
  const draw = r.drawRects.bind(r);
  r.drawRects = (batch, first, count, u) => {
    counts.push(count as number);
    draw(batch, first, count, u);
  };
  frame(c);
  r.drawRects = draw;
  return counts;
}

describe('grouping', () => {
  it('fits a million bars and draws at most two instances per device pixel', () => {
    const { c } = chart(1_000_000);
    expect(c.fitContent(false)).toBe(true);
    frame(c);
    expect(c.grouping?.level).toBeGreaterThan(0);
    const counts = drawnInstances(c);
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) expect(n).toBeLessThanOrEqual(2 * c.plotWidth);
    // A million bars takes seconds under a loaded full-suite run.
  }, 30_000);

  it('stays off by default: fitContent stops at minBarSpacing', () => {
    const { c } = chart(100_000, false);
    expect(c.fitContent(false)).toBe(false);
    expect(c.grouping).toBeNull();
  });

  it('autoscales to the grouped bars like a scan of the bars on screen', () => {
    const { c, candles, data } = chart(200_000);
    c.fitContent(false);
    frame(c);
    const { from, to } = c.time.visibleRange();
    const w = 2 ** c.groupLevel;
    const shown = data.slice(Math.floor(from / w) * w, (Math.floor(to / w) + 1) * w);
    const lo = shown.reduce((m, b) => Math.min(m, b.low), Infinity);
    const hi = shown.reduce((m, b) => Math.max(m, b.high), -Infinity);
    expect(candles.priceRange(from, to)).toEqual([lo, hi]);
  });

  it('keeps buckets on absolute indices, so panning does not change them', () => {
    const { c, candles } = chart(50_000);
    c.fitContent(false);
    frame(c);
    const index = 20_000;
    const before = candles.groupAt(index);
    c.time.pan(3 * c.time.barSpacing);
    frame(c);
    expect(c.groupLevel).toBeGreaterThan(0);
    expect(candles.groupAt(index)).toEqual(before);
  });

  it('reports the bucket in the legend, valuesAt and grouping:change', () => {
    const { c, candles, data } = chart(10_000);
    const changes: unknown[] = [];
    c.on('grouping:change', (g) => changes.push(g));
    c.fitContent(false);
    frame(c);
    const g = c.grouping!;
    expect(changes).toEqual([g]);
    expect(g.bars).toBe(2 ** g.level);
    const v = c.valuesAt(data[5]!.time)!;
    expect(v.group).toEqual({ time: 0, endTime: data[g.bars - 1]!.time, count: g.bars });
    const bucket = data.slice(0, g.bars);
    const legend = v.series[0]!.legend!;
    expect(legend.parts.map((p) => p.text)).toContain(candles.format(Math.max(...bucket.map((b) => b.high))));
    c.applyOptions({ grouping: null });
    frame(c);
    expect(changes.at(-1)).toBeNull();
    expect(c.valuesAt(data[5]!.time)!.group).toBeUndefined();
  });

  it('keeps the grouped bars in step with live ticks and appends', () => {
    const { c, candles, data } = chart(4096);
    candles.applyOptions({ animate: false });
    c.fitContent(false);
    frame(c);
    const L = c.groupLevel;
    const last = data.at(-1)!;
    candles.update({ ...last, high: last.high + 100 });
    expect(candles.groupAt(4095)!.bar!.high).toBe(last.high + 100);
    candles.update({ time: last.time + 60, open: 1, high: 2, low: 0.5, close: 1.5 });
    frame(c);
    const g = candles.groupAt(4096)!;
    expect(g.bar!.close).toBe(1.5);
    expect(c.groupLevel).toBeGreaterThanOrEqual(L - 1);
  });

  it('sums histogram columns by default', () => {
    const { c, data } = chart(8192);
    const volume = c.addHistogram({ title: 'Volume' });
    volume.setData(data.map((b) => ({ time: b.time, value: b.volume! })));
    c.fitContent(false);
    frame(c);
    const w = c.grouping!.bars;
    const sum = data.slice(0, w).reduce((s, b) => s + b.volume!, 0);
    expect(volume.legend(0).parts[0]!.text).toBe(volume.formatValue(sum));
    volume.applyOptions({ groupBy: 'max' });
    expect(volume.legend(0).parts[0]!.text).toBe(volume.formatValue(Math.max(...data.slice(0, w).map((b) => b.volume!))));
  });
});
