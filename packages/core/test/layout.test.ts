import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError } from '../src/errors';
import { LAYOUT_VERSION, migrateLayout, type ChartLayout } from '../src/layout';
import type { DataSource } from '../src/data/types';
import { intervalSeconds } from '../src/data/util';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 10 + i, high: 11 + i, low: 9 + i, close: 10 + i }));

const paneDef: IndicatorDef<{ length: number }> = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: src.close.map((v) => v / 2) }),
};

const overlayDef: IndicatorDef<{ length: number }> = {
  id: 'test/avg',
  name: 'Avg',
  placement: 'overlay',
  inputs: [{ id: 'length', type: 'number', default: 20, min: 1 }],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: src.close }),
};

/** A chart like an app sets one up: main candles, the app's own volume pane, indicators registered. */
function chart(n = 200) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars(n));
  const volume = c.addPane({ stretch: 0.2 });
  c.addHistogram({ title: 'Volume' }, volume);
  c.indicators.register(paneDef);
  c.indicators.register(overlayDef);
  return c;
}

const line = (id: string, pane: number) => ({
  id,
  type: 'trendline',
  pane,
  points: [
    { time: 600, price: 15 },
    { time: 1800, price: 30 },
  ],
  style: {},
});

/** The pane of each indicator, by id. */
const indicatorPanes = (c: Chart) =>
  Object.fromEntries(c.indicators.getAll().map((ind) => [ind.type, ind.pane ? c.panes.indexOf(ind.pane) : -1]));

/** A chart arranged by hand: an oscillator above the volume pane, the overlay moved into it, scales and style changed. */
function arranged() {
  const c = chart();
  const osc = c.indicators.add('test/osc', { length: 9 });
  c.movePane(osc.pane!, 1);
  const avg = c.indicators.add('test/avg', { length: 50 });
  c.moveSeries(avg.series!, osc.pane!);
  c.setPaneHeights([0.6, 0.25, 0.15]);
  c.setPaneCollapsed(c.panes[2]!, true);
  c.setPaneHidden(c.panes[1]!, true);
  c.setPriceScaleMode('log');
  c.setPriceScaleOptions({ invert: true, marginTop: 0.2, fixedRange: { min: 0, max: 100 } }, 1);
  c.setPriceRange({ from: 5, to: 50 }, 2);
  c.main!.applyOptions({ style: 'hollow', upColor: '#00ff00', wicks: false });
  c.drawings.load({ version: 1, drawings: [line('a', 0), line('b', 1), line('c', 2)] });
  return c;
}

describe('serializeLayout / loadLayout', () => {
  it('round-trips panes, heights, indicators, scales, chart type and drawings', () => {
    const saved = arranged().serializeLayout();
    expect(saved.version).toBe(LAYOUT_VERSION);
    expect(saved.panes).toHaveLength(3);
    expect(saved.indicators?.map((s) => [s.type, s.pane])).toEqual([
      ['test/osc', 1],
      ['test/avg', 1],
    ]);

    const c = chart();
    const result = c.loadLayout(JSON.parse(JSON.stringify(saved)));
    expect(result.errors).toEqual([]);
    expect(c.panes).toHaveLength(3);
    expect(indicatorPanes(c)).toEqual({ 'test/osc': 1, 'test/avg': 1 });
    // The app's volume pane is matched to the saved pane without indicators.
    expect(c.panes[2]!.series[0]!.options).toMatchObject({ title: 'Volume' });
    expect(c.indicators.getAll().map((i) => i.inputs.length)).toEqual([9, 50]);
    c.getPaneHeights().forEach((h, i) => expect(h).toBeCloseTo([0.6, 0.25, 0.15][i]!, 6));
    expect(c.panes.map((p) => p.collapsed)).toEqual([false, false, true]);
    expect(c.panes.map((p) => p.hidden)).toEqual([false, true, false]);
    expect(c.getPriceScaleMode()).toBe('log');
    expect(c.getPriceScaleOptions(1)).toMatchObject({ invert: true, marginTop: 0.2, fixedRange: { min: 0, max: 100 } });
    // Only the margin that was set is saved; the others stay automatic.
    expect(saved.panes![1]!.scales.right!.marginBottom).toBeUndefined();
    expect([c.panes[1]!.price.marginTop, c.panes[1]!.price.marginBottom]).toEqual([0.2, null]);
    expect(c.isAutoScale(2)).toBe(false);
    expect(c.panes[2]!.price.minPrice).toBeCloseTo(5);
    expect(c.panes[2]!.price.maxPrice).toBeCloseTo(50);
    expect(c.main!.options).toMatchObject({ style: 'hollow', upColor: '#00ff00', wicks: false });
    expect(c.drawings.getAll().map((d) => [d.id, d.pane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    // Saving the restored chart gives the same layout.
    const again = c.serializeLayout({ meta: saved.meta });
    expect(again).toEqual(saved);
    // A margin the layout leaves out goes back to automatic, even after one was set.
    const auto = JSON.parse(JSON.stringify(saved));
    delete auto.panes[1].scales.right.marginTop;
    expect(c.loadLayout(auto).errors).toEqual([]);
    expect([c.panes[1]!.price.marginTop, c.panes[1]!.price.marginBottom]).toEqual([null, null]);
  });

  it('loads margins saved before they became automatic as fixed margins', () => {
    const saved = chart().serializeLayout();
    // Layouts saved before #857 stored every margin: 0.1 and 0.08 on the main pane.
    Object.assign(saved.panes![0]!.scales.right!, { marginTop: 0.1, marginBottom: 0.08 });
    const c = chart();
    expect(c.loadLayout(JSON.parse(JSON.stringify(saved))).errors).toEqual([]);
    expect(c.getPriceScaleOptions()).toMatchObject({ marginTop: 0.1, marginBottom: 0.08 });
    // The upgrading guide's step hands them back to the chart.
    c.setPriceScaleOptions({ marginTop: null, marginBottom: null });
    expect([c.panes[0]!.price.marginTop, c.panes[0]!.price.marginBottom]).toEqual([null, null]);
  });

  it('keeps the visible range only when asked', () => {
    const a = chart();
    a.setVisibleTimeRange(60 * 50, 60 * 120, false);
    expect(a.serializeLayout().visibleRange).toBeUndefined();
    const saved = a.serializeLayout({ visibleRange: true });
    expect(saved.visibleRange).toEqual(a.getVisibleRange());

    const b = chart();
    b.resize();
    b.loadLayout(saved);
    expect(b.getVisibleRange()).toEqual(a.getVisibleRange());
  });

  it('stamps metadata and leaves drawings out on request', () => {
    const c = arranged();
    const saved = c.serializeLayout({ drawings: false, meta: { name: 'Swing', createdAt: 100 } });
    expect(saved.drawings).toBeUndefined();
    expect(saved.meta).toMatchObject({ name: 'Swing', createdAt: 100 });
    expect(saved.meta!.updatedAt).toBeGreaterThan(100);
    expect(chart().loadLayout(saved).meta).toEqual(saved.meta);
  });

  it('leaves indicators added with persist: false out', () => {
    const c = chart();
    c.indicators.add('test/osc', {}, { persist: false });
    c.indicators.add('test/avg');
    expect(c.indicators.serialize().map((s) => s.type)).toEqual(['test/avg']);
    expect(c.serializeLayout().indicators?.map((s) => s.type)).toEqual(['test/avg']);
  });

  it('replaces the indicators and panes of an earlier layout', () => {
    const c = arranged();
    const plain = chart().serializeLayout();
    expect(c.loadLayout(plain).errors).toEqual([]);
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.panes).toHaveLength(2);
    expect(c.panes[1]!.series[0]!.options).toMatchObject({ title: 'Volume' });
    expect(c.drawings.getAll()).toEqual([]);
    expect(c.getPriceScaleMode()).toBe('normal');
    expect(c.main!.options).toMatchObject({ style: 'candles', upColor: undefined, wicks: undefined });
  });

  it('keeps indicators whose definition is not registered as placeholders', () => {
    const saved = arranged().serializeLayout();
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars(50));
    c.addHistogram({ title: 'Volume' }, c.addPane());
    // Neither definition registered: both stay as placeholders and round-trip.
    const result = c.loadLayout(saved);
    expect(result.errors).toEqual([]);
    expect(c.indicators.getAll().every((i) => i.pending)).toBe(true);
    expect(c.serializeLayout().indicators).toEqual(saved.indicators);
  });
});

describe('loadLayout with partial or corrupt input', () => {
  it('throws, changing nothing, on something that is not a layout', () => {
    const c = arranged();
    const before = c.serializeLayout();
    for (const bad of [null, 'layout', [], { panes: [] }, { version: 99 }]) {
      expect(() => c.loadLayout(bad)).toThrow(ChartError);
    }
    expect(c.serializeLayout({ meta: before.meta })).toEqual(before);
    try {
      c.loadLayout({ version: 'x' });
    } catch (err) {
      expect((err as ChartError).code).toBe('invalid-layout');
    }
  });

  it('leaves parts the layout does not have alone', () => {
    const c = arranged();
    const before = c.serializeLayout();
    expect(c.loadLayout({ version: 1 }).errors).toEqual([]);
    expect(c.serializeLayout({ meta: before.meta })).toEqual(before);
    c.loadLayout({ version: 1, mainSeries: { style: 'line' } });
    expect(c.main!.options.style).toBe('line');
    expect(c.indicators.getAll()).toHaveLength(2);
    expect(c.drawings.getAll()).toHaveLength(3);
  });

  it('skips and reports the invalid parts and loads the rest', () => {
    const saved = arranged().serializeLayout() as unknown as Record<string, any>;
    saved.mainSeries.style = 'pie';
    saved.mainSeries.lineWidth = -1;
    saved.indicators.splice(1, 0, { type: 42 });
    saved.panes[1].height = 'tall';
    saved.panes[1].scales.right.mode = 'cubic';
    saved.panes[2].scales.right.range = null;
    saved.drawings.drawings.push({ id: 'broken', type: 'trendline', pane: 0, points: 'none' });
    saved.visibleRange = { from: 10, to: 'later' };
    saved.maximizedPane = 7;
    saved.interval = '1x';

    const c = chart();
    const { errors } = c.loadLayout(saved);
    expect(errors.map((e) => e.part).sort()).toEqual(
      [
        'drawings[3]',
        'indicators[1]',
        'interval',
        'mainSeries.lineWidth',
        'mainSeries.style',
        'maximizedPane',
        'panes[1].height',
        'panes[1].scales.right.mode',
        'panes[2].scales.right.range',
        'visibleRange',
      ].sort(),
    );
    // Everything else loaded.
    expect(indicatorPanes(c)).toEqual({ 'test/osc': 1, 'test/avg': 1 });
    expect(c.main!.options).toMatchObject({ style: 'candles', upColor: '#00ff00', wicks: false });
    expect(c.getPriceScaleOptions(1)).toMatchObject({ invert: true, mode: 'normal' });
    expect(c.isAutoScale(2)).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(3);
    expect(c.panes.map((p) => p.collapsed)).toEqual([false, false, true]);
  });

  it('draws candles for a chart style this version does not draw, such as hlcArea before its rename', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    c.main!.applyOptions({ style: 'line' });
    const { errors } = c.loadLayout({ version: 1, mainSeries: { style: 'hlcArea', wicks: false } });
    expect(errors.map((e) => e.part)).toEqual(['mainSeries.style']);
    expect(c.main!.options).toMatchObject({ style: 'candles', wicks: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('charton [option-range]: the layout\'s chart style "hlcArea" is unknown'));
    warn.mockRestore();
  });

  it('reports a pane hidden flag that is not a boolean and shows the pane', () => {
    const c = arranged();
    const saved = c.serializeLayout();
    expect(saved.panes![1]!.hidden).toBe(true);
    const { errors } = c.loadLayout({ ...saved, panes: saved.panes!.map((p, i) => (i === 1 ? { ...p, hidden: 'yes' } : p)) });
    expect(errors.map((e) => e.part)).toEqual(['panes[1].hidden']);
    expect(c.panes[1]!.hidden).toBe(false);
  });

  it('reports a whole part of the wrong type without losing the others', () => {
    const c = arranged();
    const { errors } = c.loadLayout({ version: 1, indicators: 'none', panes: {}, drawings: { version: 1 }, mainSeries: 3 });
    expect(errors.map((e) => e.part)).toEqual(['mainSeries', 'indicators', 'panes', 'drawings']);
    expect(c.indicators.getAll()).toHaveLength(2);
    expect(c.drawings.getAll()).toHaveLength(3);
  });

  it('reports invalid indicator inputs through the indicator registry and keeps the indicator', () => {
    const c = chart();
    const { errors } = c.loadLayout({
      version: 1,
      indicators: [{ type: 'test/osc', inputs: { length: -5 }, pane: 1, visible: true }],
    });
    expect(errors).toEqual([{ part: 'indicators[0]', reason: expect.stringContaining('length') }]);
    expect(c.indicators.getAll()[0]!.inputs.length).toBe(14);
  });

  it('drops drawings on panes the layout cannot restore', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars(50));
    const { errors } = c.loadLayout({
      version: 1,
      panes: [{ height: 1, scales: {} }],
      drawings: { version: 1, drawings: [line('a', 0), line('b', 3)] },
    });
    expect(errors).toEqual([{ part: 'drawings', reason: expect.stringContaining('1 drawing') }]);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual(['a']);
  });

  it('creates an empty pane for drawings when the app has none to match', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars(50));
    c.loadLayout({
      version: 1,
      panes: [
        { height: 0.7, scales: {} },
        { height: 0.3, scales: {} },
      ],
      drawings: { version: 1, drawings: [line('a', 1)] },
    });
    expect(c.panes).toHaveLength(2);
    expect(c.drawings.getAll()[0]!.pane).toBe(1);
  });

  it('keeps unknown fields and writes them back', () => {
    const c = chart();
    const result = c.loadLayout({ version: 1, watchlist: ['A', 'B'], theme: { dark: true } });
    expect(result.unknown).toEqual(['watchlist', 'theme']);
    const saved = c.serializeLayout() as ChartLayout & Record<string, unknown>;
    expect(saved.watchlist).toEqual(['A', 'B']);
    expect(saved.theme).toEqual({ dark: true });
  });
});

describe('layout versions', () => {
  it('upgrades an older format through the migrate hook', () => {
    const c = chart();
    // An app's own earlier format: version 0, chart type under another name.
    const old = { version: 0, chartType: 'area', studies: [{ id: 'test/osc', length: 30 }] };
    const result = c.loadLayout(old, {
      migrate: (data, from) => {
        expect(from).toBe(0);
        const studies = data.studies as { id: string; length: number }[];
        return {
          version: 1,
          mainSeries: { style: data.chartType },
          indicators: studies.map((s) => ({ type: s.id, inputs: { length: s.length }, pane: 1, visible: true })),
        };
      },
    });
    expect(result.errors).toEqual([]);
    expect(c.main!.options.style).toBe('area');
    expect(c.indicators.getAll()[0]!.inputs).toEqual({ length: 30 });
  });

  it('runs built-in steps in order, after the hook when it returns an older version', () => {
    const steps = {
      1: (d: Record<string, unknown>) => ({ ...d, version: 2, renamed: d.old }),
      2: (d: Record<string, unknown>) => ({ ...d, version: 3 }),
    };
    expect(migrateLayout({ version: 1, old: 'x' }, 3, steps)).toEqual({ version: 3, old: 'x', renamed: 'x' });
    const hook = (d: Record<string, unknown>) => ({ ...d, version: 1 });
    expect(migrateLayout({ version: 'legacy', old: 'y' }, 3, steps, hook)).toMatchObject({ version: 3, renamed: 'y' });
  });

  it('rejects versions nothing upgrades, and steps that do not move forward', () => {
    expect(() => migrateLayout({ version: 2 })).toThrow(/Unsupported layout version 2/);
    expect(() => migrateLayout({ version: 1 }, 2, { 1: (d) => d })).toThrow(/returned version 1/);
    // The hook runs once; a second unknown version is not passed to it again.
    expect(() => migrateLayout({ version: 5 }, 1, {}, (d) => ({ ...d, version: 6 }))).toThrow(/Unsupported/);
  });
});

describe('loadLayout with a data source', () => {
  const END = 100_000 * 60;
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: `${symbol} display name` }),
    search: async () => [],
    history: async (_info, interval, req) => {
      const step = intervalSeconds(interval);
      const out: Bar[] = [];
      const newest = req.to === undefined ? END : req.to - step;
      for (let t = newest; t > END - 5000 * step && out.length < req.limit; t -= step) {
        out.unshift({ time: t, open: 1, high: 2, low: 0.5, close: 1 });
      }
      return { bars: out, atStart: out.length < req.limit };
    },
  };

  function sourced() {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles();
    c.setDataSource(source, { initialBars: 300, pageBars: 300 });
    return c;
  }

  it('saves the symbol id and interval and loads them back with the visible range', async () => {
    const a = sourced();
    await a.setSymbol('ABC', '5m');
    a.setVisibleTimeRange(END - 600 * 300, END - 300 * 300, false);
    const saved = a.serializeLayout({ visibleRange: true });
    expect(saved).toMatchObject({ symbol: 'ABC', interval: '5m' });

    const b = sourced();
    const result = b.loadLayout(saved);
    expect(result.ready).not.toBeNull();
    await result.ready;
    expect(b.data?.symbol?.symbol).toBe('ABC');
    expect(b.data?.interval).toBe('5m');
    const range = b.getVisibleRange()!;
    expect(Math.abs(range.from - saved.visibleRange!.from)).toBeLessThanOrEqual(300);
    expect(Math.abs(range.to - saved.visibleRange!.to)).toBeLessThanOrEqual(300);
  });

  it('leaves the saved price ranges out when another symbol is picked while it loads', async () => {
    const a = sourced();
    await a.setSymbol('ABC', '5m');
    a.setPriceScaleOptions({ autoScale: false }, 0, 'right');
    a.setPriceRange({ from: 10, to: 20 }, 0, 'right');
    const saved = a.serializeLayout();

    const b = sourced();
    const result = b.loadLayout(saved);
    const picked = b.setSymbol('XYZ', '1h');
    b.setPriceRange({ from: 30, to: 40 }, 0, 'right');
    await Promise.all([result.ready, picked]);
    expect(b.data?.symbol?.symbol).toBe('XYZ');
    expect(b.getPriceRange(0, 'right')).toMatchObject({ from: 30, to: 40 });
  });

  it('can leave the symbol to the app', () => {
    const b = sourced();
    const result = b.loadLayout({ version: 1, symbol: 'ABC', interval: '1h' }, { symbol: false });
    expect(result.ready).toBeNull();
    expect(b.data?.symbol).toBeNull();
  });
});
