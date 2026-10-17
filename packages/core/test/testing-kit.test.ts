import { afterEach, describe, expect, it } from 'vitest';
import { Chart, annotations, createChart } from '../src/index';
import {
  describeScene,
  driveFrames,
  emitPointer,
  flushFrames,
  installTestEnvironment,
  sampleBars,
  waitForData,
  type TestEnvironment,
} from '../src/testing';
import type { DataSource, SymbolInfo } from '../src/data/types';

let env: TestEnvironment | null = null;
const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  env?.uninstall();
  env = null;
});

function chart(options: Parameters<typeof installTestEnvironment>[0] = {}) {
  env = installTestEnvironment(options);
  const c = new Chart(env.container());
  charts.push(c);
  return c;
}

describe('installTestEnvironment', () => {
  it('runs a chart at the given size and puts the globals back', () => {
    const g = globalThis as Record<string, unknown>;
    expect(g.document).toBeUndefined();
    const c = chart({ width: 640, height: 480 });
    expect(c.width).toBe(640);
    expect(c.height).toBe(480);
    charts.splice(0).forEach((x) => x.destroy());
    env!.uninstall();
    env = null;
    expect(g.document).toBeUndefined();
    expect(g.requestAnimationFrame).toBeUndefined();
  });
});

describe('sampleBars', () => {
  it('gives the same valid bars for the same seed, other bars for another', () => {
    const a = sampleBars({ count: 50, seed: 7, interval: 300, start: 3000 });
    expect(a).toEqual(sampleBars({ count: 50, seed: 7, interval: 300, start: 3000 }));
    expect(a).not.toEqual(sampleBars({ count: 50, seed: 8, interval: 300, start: 3000 }));
    expect(a[1]!.time - a[0]!.time).toBe(300);
    for (const b of a) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      expect(Math.round(b.close * 100)).toBe(b.close * 100);
    }
  });
});

describe('frames', () => {
  it('runs pending frames with increasing timestamps, and stops when nothing is pending', () => {
    chart();
    const stamps: number[] = [];
    requestAnimationFrame((t) => {
      stamps.push(t);
      requestAnimationFrame((u) => stamps.push(u));
    });
    expect(driveFrames({ count: 5, step: 10 })).toBeLessThan(5);
    expect(stamps).toHaveLength(2);
    expect(stamps[1]! - stamps[0]!).toBe(10);
    expect(flushFrames()).toBe(0);
  });

  it('throws when something keeps animating', () => {
    chart();
    const loop = () => requestAnimationFrame(loop);
    loop();
    expect(() => flushFrames(20)).toThrow(/pending/);
  });
});

describe('describeScene', () => {
  it('summarises panes, scales, series and drawings the same way every run', () => {
    const scene = () => {
      const c = chart();
      c.addCandles({ title: 'Sample', animate: false }).setData(sampleBars({ count: 120 }));
      c.addLine({ title: 'Flat', priceScale: 'left' }).setData(sampleBars({ count: 120 }).map((b) => ({ time: b.time, value: 1 })));
      c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 1704067200, price: 100.123456789 }], style: {} });
      flushFrames();
      const out = describeScene(c);
      charts.splice(0).forEach((x) => x.destroy());
      env!.uninstall();
      env = null;
      return out;
    };
    const first = scene();
    expect(scene()).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.panes[0]!.series.map((s) => [s.kind, s.title, s.scale])).toEqual([
      ['candles', 'Sample', 'right'],
      ['line', 'Flat', 'left'],
    ]);
    expect(first.panes[0]!.series[1]!.values).toEqual({ value: 1 });
    expect(first.drawings[0]!.points[0]!.price).toBe(100.123);
    expect(first.visibleRange).not.toBeNull();
  });

  it('counts aligned raw items in view, finite heatmap cells and hidden series', () => {
    const c = chart({ width: 500, height: 400 });
    const bars = sampleBars({ count: 200 });
    c.addCandles({ animate: false }).setData(bars);
    const line = c.addLine();
    // A point between bar times is not aligned, even while its time is in view.
    line.setData([{ time: bars[160]!.time + 1, value: 10 }, ...bars.slice(170).map((b) => ({ time: b.time, value: b.close }))]);
    const histogram = c.addHistogram();
    histogram.setData(bars.slice(170).map((b) => ({ time: b.time, value: b.volume! })));
    const custom = c.addCustomSeries({ type: 'test', defaultOptions: {}, priceRange: () => [1, 2], draw() {} });
    custom.setData(bars.slice(190).map((b) => ({ time: b.time })));
    const heat = c.addHeatmap();
    heat.setData({ times: bars.map((b) => b.time), priceStart: 90, priceStep: 1, rows: 2, values: new Float32Array(bars.flatMap(() => [1, NaN])) });
    flushFrames();
    const range = c.time.visibleRange();
    const scene = describeScene(c);
    const series = scene.panes[0]!.series;
    expect(series.find((s) => s.kind === 'candles')!.visiblePointCount).toBe(range.to - range.from + 1);
    expect(series.find((s) => s.kind === 'line')!.visiblePointCount).toBe(30);
    expect(series.find((s) => s.kind === 'histogram')!.visiblePointCount).toBe(30);
    expect(series.find((s) => s.kind === 'custom')!.visiblePointCount).toBe(10);
    expect(series.find((s) => s.kind === 'heatmap')!.visiblePointCount).toBe(range.to - range.from + 1);
    line.setVisible(false);
    expect(describeScene(c).panes[0]!.series.find((s) => s.kind === 'line')!.visiblePointCount).toBe(0);
    c.panes[0]!.collapsed = true;
    expect(describeScene(c).panes[0]!.series.every((s) => s.visiblePointCount === 0)).toBe(true);
  });

  it('summarises the annotations of a chart without trading()', () => {
    env = installTestEnvironment();
    const c = createChart(env.container(), { plugins: [annotations()] });
    charts.push(c);
    c.addCandles({ animate: false }).setData(sampleBars({ count: 50 }));
    c.annotations.addPriceLine({ price: 100 });
    flushFrames();
    expect(describeScene(c).annotations.map((a) => a.kind)).toEqual(['price-line']);
  });

  it('summarises all app annotation kinds with stable targets and serialisable options', () => {
    const scene = () => {
      const c = chart();
      const bars = sampleBars({ count: 120 });
      const main = c.addCandles({ animate: false });
      main.setData(bars);
      const pane = c.addPane();
      const line = c.addLine({}, pane);
      line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
      c.annotations.setMarkers([{ id: 'main', time: bars[80]!.time, shape: 'circle' }]);
      c.annotations.setMarkers([{ time: bars[90]!.time, shape: 'label', text: 'Signal', icon: { image: document.createElement('canvas') }, price: 100.123456789 }], line);
      c.annotations.setTrades([{ id: 'fill', time: bars[90]!.time, side: 'buy', price: 100.123456789, quantity: 2 }]);
      c.annotations.addPriceLine({ price: 100.123456789, title: 'Level', series: line, onClick() {} });
      c.annotations.addTradeLine({ price: 100, side: 'buy', takeProfit: 110, stopLoss: 90 });
      c.annotations.addAlertLine({ price: 110, title: 'Alert' }).setVisible(false);
      c.annotations.startOrderDraft({ price: 101, side: 'sell' });
      c.annotations.addTimeBand({ from: bars[80]!.time, to: bars[90]!.time, label: 'Window' });
      c.annotations.addPriceZone({ from: 90.123456789, to: 110, fromTime: bars[80]!.time });
      c.annotations.addTextLabel({ time: bars[90]!.time, price: 100, text: 'Note' });
      flushFrames();
      const out = describeScene(c);
      charts.splice(0).forEach((x) => x.destroy());
      env!.uninstall();
      env = null;
      return out;
    };
    const first = scene();
    expect(scene()).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.annotations.map((a) => a.kind)).toEqual(['marker', 'marker', 'trade', 'price-line', 'trade-line', 'alert-line', 'draft-line', 'time-band', 'price-zone', 'text-label']);
    expect(first.annotations[1]).toMatchObject({ pane: 1, series: 0, options: { time: 1704072600, price: 100.123, text: 'Signal' } });
    expect(first.annotations[1]!.options).not.toHaveProperty('icon');
    expect(first.annotations[3]).toMatchObject({ pane: 1, series: 0, options: { price: 100.123, title: 'Level' } });
    expect(first.annotations[3]!.options).not.toHaveProperty('series');
    expect(first.annotations[3]!.options).not.toHaveProperty('onClick');
    expect(first.annotations[5]!.visible).toBe(false);
    expect(first.annotations[7]!.options.from).toBe(1704072000);
    expect(first.annotations[8]!.options.from).toBe(90.1235);
  });

  it('returns empty annotations and zero counts before data or without plugins', () => {
    env = installTestEnvironment();
    const c = createChart(env.container());
    charts.push(c);
    c.addCandles();
    flushFrames();
    expect(describeScene(c).annotations).toEqual([]);
    expect(describeScene(c).panes[0]!.series[0]!.visiblePointCount).toBe(0);
  });

  it('counts finite outputs of shown indicator plots', () => {
    const c = chart();
    c.addCandles({ animate: false }).setData(sampleBars({ count: 100 }));
    const indicator = c.indicators.add({
      id: 'test-count', name: 'Count', placement: 'overlay', inputs: [],
      plots: [{ id: 'a', type: 'line' }, { id: 'b', type: 'line' }],
      compute(src) {
        return { a: Float64Array.from(src.close, (_, i) => i < 90 ? NaN : 1), b: new Float64Array(src.length).fill(2) };
      },
    });
    flushFrames();
    const count = () => describeScene(c).panes[0]!.series.find((s) => s.kind === 'indicator')!.visiblePointCount;
    expect(count()).toBe(c.time.visibleRange().to - c.time.visibleRange().from + 1 + 10);
    indicator.setPlotStyle('b', { visible: false });
    expect(count()).toBe(10);
  });
});

describe('waitForData', () => {
  it('settles a data source load and its frames', async () => {
    const c = chart();
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
      search: async () => [],
      history: async () => ({ bars: sampleBars({ count: 30 }), atStart: true }),
    };
    c.setDataSource(source);
    void c.setSymbol('S', '1m');
    await waitForData(c);
    expect(c.main?.data).toHaveLength(30);
    expect(describeScene(c).panes[0]!.series[0]!.values).not.toBeNull();
  });
});

describe('emitPointer', () => {
  it('drives the chart input at a time and price', () => {
    const c = chart();
    const bars = sampleBars({ count: 100 });
    c.addCandles({ animate: false }).setData(bars);
    flushFrames();
    const moves: (number | null)[] = [];
    const clicks: number[] = [];
    c.on('crosshair:move', (e) => moves.push(e?.time ?? null));
    c.on('plot:click', (e) => clicks.push(e.time));
    const at = bars[80]!;
    expect(emitPointer(c, { type: 'move', time: at.time, price: at.close })).toBe(true);
    expect(emitPointer(c, { type: 'click', time: at.time, price: at.close })).toBe(true);
    emitPointer(c, { type: 'leave', time: at.time, price: at.close });
    expect(moves[0]).toBe(at.time);
    expect(moves.at(-1)).toBeNull();
    expect(clicks).toEqual([at.time]);
    expect(emitPointer(c, { type: 'move', time: at.time, price: at.close, pane: 5 })).toBe(false);
  });
});
