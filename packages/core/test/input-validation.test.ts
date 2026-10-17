import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type DataDroppedEvent } from '../src/chart';
import { DataController, type DataTarget } from '../src/data/controller';
import { createStaticDataSource, parseCsv } from '../src/data/adapters';
import { isValidBar, normalizeBars, type DropReason } from '../src/data/util';
import type { BarsRequest, DataSource } from '../src/data/types';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const dropped: DataDroppedEvent[] = [];
  c.on('data:dropped', (e) => dropped.push(e));
  return { c, dropped };
}

const bar = (time: number, close = 10): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i * 60, 10 + i));
const BAD = [NaN, Infinity, -Infinity, undefined] as unknown as number[];
const POSITIONS = [0, 2, 4];

/**
 * Whether a series' GPU batch holds only finite floats. Reads the private
 * `batch` (no public accessor exists); the layout comes from `RECT_STRIDE`:
 * float32 fields followed by one RGBA8 color.
 */
function batchIsFinite(series: unknown): boolean {
  const batch = (series as { batch: { bytes: Uint8Array; count: number } }).batch;
  const floats = new Float32Array(batch.bytes.buffer, batch.bytes.byteOffset, batch.bytes.byteLength / 4);
  const stride = RECT_STRIDE / 4;
  const fields = stride - 1; // the last 4 bytes are the color
  for (let i = 0; i < batch.count; i++) for (let k = 0; k < fields; k++) if (!Number.isFinite(floats[i * stride + k]!)) return false;
  return true;
}

describe('candles', () => {
  it('reject non-finite times and prices in setData and update, naming the bar', () => {
    for (const bad of BAD) {
      for (const at of POSITIONS) {
        for (const key of ['time', 'open', 'high', 'low', 'close'] as const) {
          const { c } = chart();
          const candles = c.addCandles();
          const data = bars(5);
          data[at] = { ...data[at]!, [key]: bad };
          expect(() => candles.setData(data)).toThrow(key === 'time' ? /time/ : new RegExp(`index ${at}.*${key}`));
          expect(batchIsFinite(candles)).toBe(true);
        }
      }
      const { c } = chart();
      const candles = c.addCandles();
      candles.setData(bars(5));
      expect(() => candles.update({ ...bar(300), close: bad })).toThrow(/close/);
      expect(candles.data).toHaveLength(5);
    }
  });

  it('reject high below low and a non-finite volume, with one definition shared with data sources', () => {
    const swapped = { ...bar(60), high: 1, low: 2 };
    const noVolume = { ...bar(60), volume: NaN };
    for (const invalid of [swapped, noVolume]) {
      const { c, dropped } = chart();
      const candles = c.addCandles();
      expect(isValidBar(invalid)).toBe(false);
      expect(() => candles.setData([bar(0), invalid])).toThrow(/index 1/);
      expect(() => candles.update(invalid)).toThrow(/update/);
      candles.setData([bar(0), invalid], { normalize: true });
      expect(candles.data).toEqual([bar(0)]);
      expect(dropped).toEqual([{ reason: 'invalid', bar: invalid, series: candles }]);
    }
  });

  it('draw open or close outside low..high and a negative volume as given', () => {
    const { c } = chart();
    const candles = c.addCandles();
    const odd = [{ ...bar(0), open: 20 }, { ...bar(60), close: 1 }, { ...bar(120), volume: -5 }];
    for (const b of odd) expect(isValidBar(b)).toBe(true);
    candles.setData(odd);
    expect(candles.data).toEqual(odd);
    expect(batchIsFinite(candles)).toBe(true);
  });

  it('take the GPU base from a valid close', () => {
    const { c } = chart();
    const candles = c.addCandles();
    candles.setData(bars(5));
    expect((candles as unknown as { batch: { base: number } }).batch.base).toBe(10);
    expect(batchIsFinite(candles)).toBe(true);
  });
});

describe('line and histogram points', () => {
  it('treat a non-finite value as a gap and keep the batch finite', () => {
    for (const bad of BAD) {
      for (const at of POSITIONS) {
        const { c } = chart();
        c.addCandles().setData(bars(5));
        const points = bars(5).map((b) => ({ time: b.time, value: b.close }));
        points[at] = { ...points[at]!, value: bad };
        const line = c.addLine();
        const histogram = c.addHistogram();
        line.setData(points);
        histogram.setData(points);
        expect(line.data.map((p) => p.time)).toEqual(points.filter((_, i) => i !== at).map((p) => p.time));
        expect(histogram.data).toHaveLength(4);
        expect(batchIsFinite(histogram)).toBe(true);
      }
    }
  });

  it('reject non-finite times', () => {
    const { c } = chart();
    expect(() => c.addLine().setData([{ time: NaN, value: 1 }])).toThrow(/time at index 0/);
    expect(() => c.addHistogram().update({ time: Infinity, value: 1 })).toThrow(/time/);
  });

  it('reject non-finite times on every series, also when normalizing', () => {
    const { c, dropped } = chart();
    const custom = () => c.addCustomSeries({ type: 'dots', draw() {}, priceRange: () => null }, {});
    for (const normalize of [false, true]) {
      expect(() => c.addLine().setData([{ time: 0, value: 1 }, { time: NaN, value: 1 }], { normalize })).toThrow(/time at index 1/);
      expect(() => c.addHistogram().setData([{ time: 0, value: 1 }, { time: NaN, value: 1 }], { normalize })).toThrow(/time at index 1/);
      expect(() => custom().setData([{ time: 0 }, { time: NaN }], { normalize })).toThrow(/time at index 1/);
      expect(() => c.addCandles().setData([bar(0), bar(NaN)], { normalize })).toThrow(/time/);
    }
    expect(() => c.addLine().update({ time: NaN, value: 1 })).toThrow(/time/);
    expect(() => custom().update({ time: NaN })).toThrow(/time/);
    expect(dropped).toEqual([]);
  });

  it('remove the last point when an update gives it no value', () => {
    const { c } = chart();
    const line = c.addLine();
    line.setData([
      { time: 0, value: 1 },
      { time: 60, value: 2 },
    ]);
    line.update({ time: 60, value: NaN });
    expect(line.data.map((p) => p.time)).toEqual([0]);
    line.update({ time: 120, value: NaN });
    expect(line.data.map((p) => p.time)).toEqual([0]);
  });

  it('heatmaps reject non-finite times', () => {
    const { c } = chart();
    expect(() =>
      c.addHeatmap().setData({ times: [0, NaN], rows: 1, priceStart: 0, priceStep: 1, values: new Float32Array(2) }),
    ).toThrow(/time at index 1/);
  });
});

describe('heatmap updates', () => {
  function heatmap() {
    const { c, dropped } = chart();
    c.addCandles().setData(bars(3));
    const heat = c.addHeatmap();
    heat.setData({ times: [0, 60], rows: 1, priceStart: 0, priceStep: 1, values: new Float32Array([1, 2]) });
    return { heat, dropped };
  }

  it('reject a non-finite time without appending a column', () => {
    const { heat } = heatmap();
    for (const bad of BAD) expect(() => heat.updateColumn(bad, new Float32Array([3]))).toThrow(/time/);
    expect(heat.grid.cols).toBe(2);
  });

  it('drop and report a column older than the last one', () => {
    const { heat, dropped } = heatmap();
    const column = new Float32Array([3]);
    expect(() => heat.updateColumn(0, column)).not.toThrow();
    expect(dropped).toEqual([{ reason: 'older', bar: { time: 0, column }, series: heat }]);
    expect(heat.grid.cols).toBe(2);
  });
});

describe('older updates', () => {
  it('are dropped and reported the same way on every series type', () => {
    const { c, dropped } = chart();
    const candles = c.addCandles();
    candles.setData(bars(3));
    const line = c.addLine();
    line.setData([{ time: 120, value: 1 }]);
    const histogram = c.addHistogram();
    histogram.setData([{ time: 120, value: 1 }]);
    const custom = c.addCustomSeries({ type: 'dots', draw() {}, priceRange: () => null }, {});
    custom.setData([{ time: 120 }]);
    for (const [series, item] of [
      [candles, bar(0)],
      [line, { time: 0, value: 5 }],
      [histogram, { time: 0, value: 5 }],
      [custom, { time: 0 }],
    ] as const) {
      expect(() => (series as { update(x: unknown): void }).update(item)).not.toThrow();
      expect(dropped.at(-1)).toEqual({ reason: 'older', bar: item, series });
    }
    expect(candles.data).toHaveLength(3);
    expect(line.data).toHaveLength(1);
  });
});

describe('setData normalize', () => {
  it('sorts, dedupes and drops invalid bars, reporting each', () => {
    const { c, dropped } = chart();
    const candles = c.addCandles();
    const invalid = { ...bar(60), close: NaN };
    candles.setData([bar(120, 1), bar(0), invalid, bar(120, 2), bar(60)], { normalize: true });
    expect(candles.data).toEqual([bar(0), bar(60), bar(120, 2)]);
    expect(dropped.map((e) => [e.reason, e.bar])).toEqual([
      ['invalid', invalid],
      ['duplicate', bar(120, 1)],
    ]);
  });

  it('names the option when times are out of order', () => {
    const { c } = chart();
    expect(() => c.addLine().setData([{ time: 60, value: 1 }, { time: 0, value: 1 }])).toThrow(/normalize: true/);
    const line = c.addLine();
    line.setData([{ time: 60, value: 1 }, { time: 0, value: 2 }], { normalize: true });
    expect(line.data.map((p) => p.time)).toEqual([0, 60]);
  });
});

describe('data source drops', () => {
  it('reports invalid, older and duplicate bars from a source', async () => {
    let push: (b: Bar) => void = () => {};
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }),
      search: async () => [],
      history: async () => ({ bars: [bar(0), bar(60, 1), bar(60, 2), { ...bar(120), low: NaN }] }),
      stream: (_s, _i, onBar) => {
        push = onBar;
        return () => {};
      },
    };
    const drops: [DropReason, Bar][] = [];
    const target: DataTarget = {
      setData: () => {},
      update: () => {},
      setPriceFormat: () => {},
      dropped: (b, reason) => drops.push([reason, b]),
    };
    const controller = new DataController(source, target, () => {}, { initialBars: 10, pageBars: 10 });
    await controller.setSymbol('A', '1m');
    push({ ...bar(180), high: NaN });
    push(bar(0));
    expect(drops.map(([reason, b]) => [reason, b.time])).toEqual([
      ['invalid', 120],
      ['duplicate', 60],
      ['invalid', 180],
      ['older', 0],
    ]);
  });

  it('a static source reports each invalid and duplicate bar once while paging', async () => {
    const { c, dropped } = chart();
    const invalid = { ...bar(120), close: NaN };
    const untimed = { ...bar(0), time: NaN };
    const replaced = bar(60, 1);
    const source = createStaticDataSource({
      symbols: [{ symbol: 'A', name: 'A' }],
      bars: () => [bar(240), untimed, bar(0), replaced, bar(60, 2), invalid, bar(180)],
    });
    c.setDataSource(source, { initialBars: 2, pageBars: 2 });
    await c.setSymbol('A', '1m');
    while (c.data!.hasMoreHistory) await c.data!.loadMore();
    expect(c.main!.data.map((b) => b.time)).toEqual([0, 60, 180, 240]);
    expect(dropped.map((e) => [e.reason, e.bar]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['duplicate', replaced],
      ['invalid', invalid],
      ['invalid', untimed],
    ]);
  });

  it('parseCsv reports skipped rows and duplicate times through onDrop', () => {
    const seen: [DropReason, number][] = [];
    const out = parseCsv('60,1,2,0,1\nbad,row\n60,1,3,0,2\n0,1,2,0,1', { onDrop: (b, reason) => seen.push([reason, b.time]) });
    expect(out.map((b) => [b.time, b.close])).toEqual([
      [0, 1],
      [60, 2],
    ]);
    expect(seen).toEqual([
      ['invalid', NaN],
      ['duplicate', 60],
    ]);
  });

  it('reports drops only from the fetch whose bars are used when refreshing a cached series', async () => {
    for (const pageBars of [2, 10]) {
      const tail = (r: BarsRequest) => (r.kind === 'initial' ? [bar(0), bar(60)] : [bar(60), bar(120), bar(180), { ...bar(240), close: NaN }]);
      const source: DataSource = {
        symbol: async (symbol) => ({ symbol, name: symbol }),
        search: async () => [],
        // Fresh objects on every call, like a network source.
        history: async (_s, _i, r) => ({ bars: tail(r).map((b) => ({ ...b })) }),
      };
      const drops: [DropReason, number][] = [];
      const target: DataTarget = {
        setData: () => {},
        update: () => {},
        setPriceFormat: () => {},
        dropped: (b, reason) => drops.push([reason, b.time]),
      };
      const controller = new DataController(source, target, () => {}, { initialBars: 10, pageBars });
      await controller.setSymbol('A', '1m');
      await controller.setSymbol('B', '1m');
      await controller.setSymbol('A', '1m');
      // pageBars 2: the tail is too long to patch, the full reload is used and its bars are clean.
      expect(drops).toEqual(pageBars === 2 ? [] : [['invalid', 240]]);
    }
  });

  it('normalizeBars reports what it leaves out', () => {
    const seen: DropReason[] = [];
    normalizeBars([bar(60), { ...bar(0), open: Infinity }, bar(60, 3)], (_b, reason) => seen.push(reason));
    expect(seen).toEqual(['invalid', 'duplicate']);
  });
});

describe('development warnings', () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

  it('warn about millisecond times and fractional seconds in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c } = chart();
    c.addCandles().setData([bar(1_700_000_000_000), bar(1_700_000_060_000)]);
    c.addLine().setData([{ time: 0.5, value: 1 }]);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => /milliseconds/.test(m))).toBe(true);
    expect(messages.some((m) => /whole second/.test(m))).toBe(true);
  });

  it('stay silent in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const { c } = chart();
      c.addCandles().setData([bar(1_700_000_000_000), bar(1_700_000_060_000)]);
    } finally {
      env.NODE_ENV = previous;
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
