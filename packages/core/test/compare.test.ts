import { describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ComparedLoader, checkPair, combinePair, floorTime, pairName, snapBarsToGrid, snapToGrid } from '../src/data/compare';
import { CandleSeries } from '../src/series';
import type { DataSource, SymbolInfo } from '../src/data/types';
import { PriceScale, linkedRanges } from '../src/scales';
import { LinePath, buildLinePath } from '../src/line-path';
import type { Bar, ValuePoint } from '../src/types';

const bar = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close });

/** A source over a fixed list of bars that pages back `limit` at a time. */
function source(bars: Bar[]) {
  const unsubscribe = vi.fn();
  let onBar: ((bar: Bar) => void) | null = null;
  const s: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
    search: async () => [],
    history: async (_symbol, _interval, req) => {
      const older = bars.filter((b) => req.to === undefined || b.time < req.to);
      const page = older.slice(-req.limit);
      return { bars: page, atStart: page.length < req.limit };
    },
    stream: (_symbol, _interval, fn) => {
      onBar = fn;
      return unsubscribe;
    },
  };
  return { source: s, unsubscribe, push: (b: Bar) => onBar?.(b) };
}

function target() {
  const t = {
    points: [] as ValuePoint[],
    setData: (bars: Bar[]) => void (t.points = bars.map((b) => ({ time: b.time, value: b.close }))),
    update: vi.fn(),
    setPriceFormat: vi.fn(),
  };
  return t;
}

describe('ComparedLoader', () => {
  const history = Array.from({ length: 2500 }, (_, i) => bar(i * 60, 100 + i));

  it('loads closes and pages back until history reaches the main series', async () => {
    const { source: s } = source(history);
    const t = target();
    const loader = new ComparedLoader(s, 'B', t, () => {});
    await loader.load('1m', 60 * 100);
    expect(t.points[0]!.time).toBeLessThanOrEqual(60 * 100);
    expect(t.points.at(-1)).toEqual({ time: 2499 * 60, value: 2599 });
    expect(t.setPriceFormat).toHaveBeenCalledWith({ type: 'decimal', precision: 2 });
    expect(loader.info?.symbol).toBe('B');
  });

  it('stops paging when the source runs out', async () => {
    const { source: s } = source(history.slice(-50));
    const t = target();
    const loader = new ComparedLoader(s, 'B', t, () => {});
    await loader.load('1m', 0);
    expect(t.points).toHaveLength(50);
  });

  it('streams live closes and unsubscribes on dispose', async () => {
    const { source: s, unsubscribe, push } = source(history.slice(-10));
    const t = target();
    const loader = new ComparedLoader(s, 'B', t, () => {});
    await loader.load('1m', null);
    push(bar(2500 * 60, 7));
    expect(t.update).toHaveBeenCalledWith(bar(2500 * 60, 7));
    loader.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('reports load errors', async () => {
    const onError = vi.fn();
    const s: DataSource = {
      symbol: async () => {
        throw new Error('unknown symbol');
      },
      search: async () => [],
      history: async () => ({ bars: [] }),
    };
    const loader = new ComparedLoader(s, 'X', target(), onError);
    await expect(loader.load('1m', null)).rejects.toThrow('unknown symbol');
    expect(onError).toHaveBeenCalled();
  });
});

describe('gaps in a compared line', () => {
  it('splits aligned points into runs of consecutive bars', () => {
    const index = [0, 1, 2, 5, 6, 9];
    const build = (a: number, b: number) =>
      buildLinePath(new LinePath(), a, b, (k) => index[k]!, () => 1, (i) => i * 10, (v) => v, { breakGaps: true });
    const path = build(0, 6);
    expect(Array.from(path.runStart.subarray(0, path.runCount))).toEqual([0, 3, 5]);
    expect(path.length).toBe(6);
    expect(build(2, 2).runCount).toBe(0);
  });
});

describe('percent normalization', () => {
  function scale(base: number): PriceScale {
    const s = new PriceScale({ marginTop: 0, marginBottom: 0 });
    s.mode = 'percent';
    s.percentBase = base;
    s.height = 100;
    return s;
  }

  it('puts linked scales on one percent range from their own bases', () => {
    const main = scale(100);
    const other = scale(10);
    other.link = main;
    // Main moves 0% to +10%, the other -10% to +20%.
    const [a, b] = linkedRanges([
      { scale: main, range: [100, 110] },
      { scale: other, range: [9, 12] },
    ]);
    expect(a).toEqual([90, 120]);
    expect(b![0]).toBeCloseTo(9);
    expect(b![1]).toBeCloseTo(12);
    main.fit(...a!);
    other.fit(...b!);
    // The same percent change sits at the same height on both.
    expect(other.priceToY(11)).toBeCloseTo(main.priceToY(110));
    expect(other.priceToY(10)).toBeCloseTo(main.priceToY(100));
  });
});

describe('chart.compare', () => {
  it('adds, links and removes compared symbols', async () => {
    const main = source(Array.from({ length: 300 }, (_, i) => bar(i * 60, 50 + i)));
    const c = new Chart(fakeContainer());
    try {
      expect(() => c.compare('B')).toThrow(/data source/);
      c.setDataSource(main.source);
      await c.setSymbol('A', '1m');
      const errors = vi.fn();
      c.on('compare:error', errors);

      const b = c.compare('B');
      await b.ready;
      expect(c.compared).toEqual([b]);
      expect(b.series.data.length).toBeGreaterThan(0);
      expect(c.getPriceScaleMode()).toBe('percent');
      expect(b.series.scale.link).toBe(c.panes[0]!.price);
      expect(b.serialize()).toEqual({ symbol: 'B', mode: 'percent', style: 'line', color: expect.any(String) });
      expect(() => c.compare('B')).toThrow(/already/);

      const p = c.compare('P', { mode: 'pane' });
      await p.ready;
      expect(c.panes).toHaveLength(2);
      p.remove();
      expect(c.panes).toHaveLength(1);

      const unsubscribed = main.unsubscribe.mock.calls.length;
      b.remove();
      expect(c.compared).toEqual([]);
      expect(c.panes[0]!.series).not.toContain(b.series);
      // Removing it unsubscribes its live bars from the source.
      expect(main.unsubscribe).toHaveBeenCalledTimes(unsubscribed + 1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      c.destroy();
    }
  });
});

describe('snapping compared points onto the main bars', () => {
  const times = [60, 120, 180];
  const pt = (time: number, value = time) => ({ time, value });

  it('moves off-grid points into the bar they fall in, keeping its last value', () => {
    expect(snapToGrid([pt(30), pt(70), pt(100), pt(130), pt(170), pt(180)], times)).toEqual([
      { time: 60, value: 100 },
      { time: 120, value: 170 },
      { time: 180, value: 180 },
    ]);
  });

  it('keeps points past the last main bar as they are', () => {
    expect(snapToGrid([pt(180), pt(240)], times)).toEqual([pt(180), pt(240)]);
  });

  it('finds the bar at or before a time', () => {
    expect(floorTime(times, 59)).toBeNull();
    expect(floorTime(times, 60)).toBe(60);
    expect(floorTime(times, 179)).toBe(120);
    expect(floorTime([], 10)).toBeNull();
  });
});

describe('ComparedLoader paging', () => {
  it('covers the oldest of several overlapping requests', async () => {
    const { source: s } = source(Array.from({ length: 3000 }, (_, i) => bar(i * 60, i)));
    const t = target();
    const loader = new ComparedLoader(s, 'B', t, () => {});
    await loader.load('1m', null);
    await Promise.all([loader.cover(60 * 1200), loader.cover(60 * 100)]);
    expect(t.points[0]!.time).toBeLessThanOrEqual(60 * 100);
  });
});

describe('chart.compare state', () => {
  async function setup() {
    const main = source(Array.from({ length: 3000 }, (_, i) => bar(i * 60, 50 + i)));
    const c = new Chart(fakeContainer());
    c.setDataSource(main.source);
    return { c, main };
  }

  it('resets scale state when a symbol is compared again in another mode', async () => {
    const { c } = await setup();
    try {
      await c.setSymbol('A', '1m');
      const pane = c.panes[0]!;
      c.compare('B', { mode: 'scale' }).remove();
      const percent = c.compare('B');
      expect(percent.series.scale.side).toBe('none');
      expect(percent.series.scale.link).toBe(pane.price);
      percent.remove();
      const scaled = c.compare('B', { mode: 'scale' });
      expect(scaled.series.scale.side).toBe('left');
      expect(scaled.series.scale.link).toBeNull();
      expect(scaled.series.scale.mode).toBe('normal');
      scaled.remove();
      expect(pane.scales.map((s) => s.id)).toEqual(['right']);
    } finally {
      c.destroy();
    }
  });

  it('switches mode in place, keeping its series, bars, row and handle', async () => {
    const { c } = await setup();
    try {
      await c.setSymbol('A', '1m');
      const b = c.compare('B');
      const after = c.addLine({ title: 'After' });
      await b.ready;
      const series = b.series;
      const points = series.data.length;
      const pane = c.panes[0]!;
      const events: string[] = [];
      c.on('series:add', () => events.push('add'));
      c.on('series:remove', () => events.push('remove'));
      c.on('panes:change', () => events.push('panes'));

      b.setMode('scale');
      expect(b.mode).toBe('scale');
      expect(c.getPriceScaleMode()).toBe('normal');
      expect(series.scale.side).toBe('left');
      expect(series.scale.link).toBeNull();

      b.setMode('pane');
      expect(c.panes).toHaveLength(2);
      expect(series.pane).toBe(c.panes[1]);
      expect(series.scale).toBe(c.panes[1]!.price);
      expect(pane.scales.map((s) => s.id)).toEqual(['right']);
      expect(series.data.length).toBe(points);
      expect(b.serialize().mode).toBe('pane');

      b.setMode('percent');
      expect(c.panes).toHaveLength(1);
      // Back in its row, before the line added after it.
      expect(pane.series).toEqual([c.main, series, after]);
      expect(series.scale.link).toBe(pane.price);
      expect(c.getPriceScaleMode()).toBe('percent');
      expect(c.compared).toEqual([b]);
      expect(b.series).toBe(series);
      expect(series.data.length).toBe(points);
      expect(events.filter((e) => e !== 'panes')).toEqual([]);
      expect(events).toContain('panes');

      expect(() => b.setMode('nope' as never)).toThrow(/Unknown compare mode/);
      b.remove();
      expect(c.compared).toEqual([]);
      expect(c.getPriceScaleMode()).toBe('normal');
      // A removed comparison stays removed.
      b.setMode('pane');
      expect(c.panes).toHaveLength(1);
    } finally {
      c.destroy();
    }
  });

  it('puts an own pane back at its place and height, and recolours candles beside the main ones', async () => {
    const { c } = await setup();
    try {
      await c.setSymbol('A', '1m');
      const p = c.compare('P', { mode: 'pane', style: 'candles', color: '#22d3ee' });
      const below = c.addLine({ title: 'Below' }, c.addPane());
      c.panes[1]!.stretch = 0.4;
      expect(() => p.setMode('percent')).toThrow(/scale.*pane/);
      p.setMode('scale');
      expect(c.panes).toHaveLength(2);
      expect((p.series as CandleSeries).options.upColor).toBe('#22d3ee');
      p.setMode('pane');
      expect(c.panes.map((pane) => pane.series[0])).toEqual([c.main, p.series, below]);
      expect(c.panes[1]!.stretch).toBe(0.4);
      expect((p.series as CandleSeries).options.upColor).toBeUndefined();
      expect(p.serialize()).toEqual({ symbol: 'P', mode: 'pane', style: 'candles', color: '#22d3ee' });
    } finally {
      c.destroy();
    }
  });

  it('gives the main scale its mode back when the last percent comparison goes', async () => {
    const { c } = await setup();
    try {
      await c.setSymbol('A', '1m');
      const a = c.compare('B');
      const b = c.compare('C');
      expect(c.getPriceScaleMode()).toBe('percent');
      a.remove();
      expect(c.getPriceScaleMode()).toBe('percent');
      b.remove();
      expect(c.getPriceScaleMode()).toBe('normal');
    } finally {
      c.destroy();
    }
  });

  it('waits for the main symbol before loading, and settles ready after that load', async () => {
    const { c } = await setup();
    try {
      const b = c.compare('B');
      let settled = false;
      void b.ready.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await c.setSymbol('A', '1m');
      await b.ready;
      expect(b.series.data.length).toBeGreaterThan(0);
    } finally {
      c.destroy();
    }
  });

  it('reloads compared symbols along with the main one', async () => {
    const bars = Array.from({ length: 300 }, (_, i) => bar(i * 60, 50 + i));
    const c = new Chart(fakeContainer());
    try {
      c.setDataSource(source(bars).source);
      await c.setSymbol('A', '1m');
      const b = c.compare('B');
      await b.ready;
      expect((b.series.data.at(-1) as ValuePoint).value).toBe(349);
      // The source corrected its newest bar.
      bars[bars.length - 1] = bar(299 * 60, 1);
      await c.reload();
      await new Promise((r) => setTimeout(r, 0));
      expect((b.series.data.at(-1) as ValuePoint).value).toBe(1);
    } finally {
      c.destroy();
    }
  });

  it('follows the main history back, and goes away with the data source', async () => {
    const { c, main } = await setup();
    try {
      await c.setSymbol('A', '1m');
      const b = c.compare('B');
      await b.ready;
      await c.data!.loadMore();
      await c.data!.loadMore();
      // Let the compared symbol page in behind the main series.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(b.series.data[0]!.time).toBeLessThanOrEqual(c.timeline.times[0]!);
      c.setDataSource(main.source);
      expect(c.compared).toEqual([]);
    } finally {
      c.destroy();
    }
  });
});

describe('compared symbols as candles or bars', () => {
  const ohlc = (time: number, open: number, high: number, low: number, close: number, volume?: number): Bar =>
    volume === undefined ? { time, open, high, low, close } : { time, open, high, low, close, volume };

  it('merges bars that fall in one main bar', () => {
    const times = [60, 120, 180];
    expect(snapBarsToGrid([ohlc(30, 1, 1, 1, 1), ohlc(60, 5, 9, 4, 6, 10), ohlc(90, 6, 12, 2, 3, 5), ohlc(130, 3, 4, 3, 4)], times)).toEqual([
      ohlc(60, 5, 12, 2, 3, 15),
      ohlc(120, 3, 4, 3, 4),
    ]);
    // Past the last main bar: kept as they are.
    expect(snapBarsToGrid([ohlc(240, 1, 2, 0, 1)], times)).toEqual([ohlc(240, 1, 2, 0, 1)]);
  });

  it('draws candles in a pane and coloured bars on their own scale, and saves the style', async () => {
    const main = source(Array.from({ length: 300 }, (_, i) => bar(i * 60, 50 + i)));
    const c = new Chart(fakeContainer());
    try {
      c.setDataSource(main.source);
      await c.setSymbol('A', '1m');
      expect(() => c.compare('X', { style: 'candles' })).toThrow(/scale.*pane/);
      expect(() => c.compare('X', { mode: 'pane', style: 'area' as never })).toThrow(/style/);
      const p = c.compare('P', { mode: 'pane', style: 'candles' });
      await p.ready;
      expect(p.series).toBeInstanceOf(CandleSeries);
      expect(p.series.data).toHaveLength(300);
      expect((p.series as CandleSeries).options.style).toBe('candles');
      // Not the main series: the chart's main candles stay the ones from setSymbol.
      expect(c.main).not.toBe(p.series);
      const s = c.compare('S', { mode: 'scale', style: 'bars', color: '#22d3ee' });
      await s.ready;
      expect((s.series as CandleSeries).options).toMatchObject({ style: 'bars', upColor: '#22d3ee' });
      expect(s.serialize()).toEqual({ symbol: 'S', mode: 'scale', style: 'bars', color: '#22d3ee' });
      p.remove();
      s.remove();
      expect(c.panes).toHaveLength(1);
      expect(c.panes[0]!.series.some((x) => x instanceof CandleSeries && x !== c.main)).toBe(false);
    } finally {
      c.destroy();
    }
  });

  it('updates the forming candle from live bars', async () => {
    const main = source(Array.from({ length: 10 }, (_, i) => bar(i * 60, 50 + i)));
    const c = new Chart(fakeContainer());
    try {
      c.setDataSource(main.source);
      await c.setSymbol('A', '1m');
      const p = c.compare('P', { mode: 'pane', style: 'candles' });
      await p.ready;
      main.push(ohlc(9 * 60, 59, 70, 40, 65));
      expect(p.series.data.at(-1)).toEqual(ohlc(9 * 60, 59, 70, 40, 65));
    } finally {
      c.destroy();
    }
  });
});

describe('synthetic pairs', () => {
  const ohlc = (time: number, open: number, high: number, low: number, close: number): Bar => ({ time, open, high, low, close });

  it('combine bar by bar where both legs have a bar', () => {
    const a = [ohlc(60, 10, 12, 9, 11), ohlc(120, 11, 13, 10, 12), ohlc(180, 12, 12, 12, 12)];
    const b = [ohlc(60, 5, 6, 4, 5), ohlc(180, 4, 4, 4, 4)];
    expect(combinePair(a, b, { ratio: ['A', 'B'] })).toEqual([
      { time: 60, open: 2, high: 2.25, low: 2, close: 2.2 },
      { time: 180, open: 3, high: 3, low: 3, close: 3 },
    ]);
    expect(combinePair(a, b, { spread: ['A', 'B'], weights: [2, 1] })).toEqual([
      { time: 60, open: 15, high: 18, low: 14, close: 17 },
      { time: 180, open: 20, high: 20, low: 20, close: 20 },
    ]);
    // A ratio over a zero leaves a gap.
    expect(combinePair([ohlc(60, 1, 1, 1, 1)], [ohlc(60, 0, 0, 0, 0)], { ratio: ['A', 'B'] })).toEqual([]);
  });

  it('names pairs and rejects malformed ones', () => {
    expect(pairName({ ratio: ['A', 'B'] })).toBe('A/B');
    expect(pairName({ spread: ['A', 'B'] })).toBe('A-B');
    expect(pairName({ spread: ['A', 'B'], weights: [2, 1] })).toBe('2*A-B');
    expect(() => checkPair({ ratio: ['A'] } as never)).toThrow(/two symbols/);
    expect(() => checkPair({ spread: ['A', 'B'], weights: [1, Number.NaN] })).toThrow(/weights/);
  });

  it('load both legs, update live from either, and unsubscribe both on removal', async () => {
    const main = source(Array.from({ length: 50 }, (_, i) => bar(i * 60, 100 + i)));
    const c = new Chart(fakeContainer());
    try {
      c.setDataSource(main.source);
      await c.setSymbol('A', '1m');
      const unsubscribed = main.unsubscribe.mock.calls.length;
      const p = c.compare({ ratio: ['X', 'Y'] }, { mode: 'pane' });
      await p.ready;
      expect(p.symbol).toBe('X/Y');
      expect(p.series.data).toHaveLength(50);
      expect((p.series.data[0] as ValuePoint).value).toBe(1);
      expect(p.serialize()).toEqual({ symbol: 'X/Y', mode: 'pane', style: 'line', color: expect.any(String), pair: { ratio: ['X', 'Y'] } });
      expect(() => c.compare({ ratio: ['X', 'Y'] })).toThrow(/already/);
      // Both legs share the fake source's single subscription slot, so a pushed bar reaches the last leg subscribed.
      main.push(bar(49 * 60, 300));
      expect((p.series.data.at(-1) as ValuePoint).value).not.toBe(1);
      p.remove();
      expect(main.unsubscribe).toHaveBeenCalledTimes(unsubscribed + 2);
    } finally {
      c.destroy();
    }
  });
});
