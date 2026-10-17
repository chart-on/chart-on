import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, recordingWebgl2 } from './fake-dom';
import { Chart } from '../src/chart';
import { Timeline } from '../src/timeline';
import { computeTickWeights } from '../src/util/format';
import { replaceFront } from '../src/util/array';
import { RECT_STRIDE, RectBatch } from '../src/gl/rect-batch';
import { LINE_STRIDE } from '../src/gl/line-batch';
import { volumeOf, type CandleSeries, type CandleSeriesOptions, type CustomSeriesDef, type Series } from '../src/series';
import type { DataSource } from '../src/data/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const HOUR = 3600;
/** UTC keeps tick weights cheap on every machine (see incremental-append.test.ts). */
const UTC_OPTIONS = { timezone: 'UTC' };

/**
 * Bar `i`, varied so volumes differ from bar to bar, and every bar rises from
 * its open but falls from the previous close or the other way round: a bar's
 * colour by previous close changes once an older bar arrives before it.
 */
const bar = (i: number): Bar => {
  const odd = i % 2 === 1;
  const open = (odd ? 10 : 20) + (i % 3);
  const close = (odd ? 12 : 15) + ((i * 7) % 3);
  return { time: i * HOUR, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100 + ((i * 13) % 90) };
};
const bars = (from: number, to: number): Bar[] => Array.from({ length: to - from }, (_, k) => bar(from + k));

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

describe('replaceFront', () => {
  it('replaces, inserts and removes at the front in place', () => {
    const a = [3, 4, 5];
    replaceFront(a, 0, [1, 2]);
    expect(a).toEqual([1, 2, 3, 4, 5]);
    replaceFront(a, 1, [0, 9]);
    expect(a).toEqual([0, 9, 2, 3, 4, 5]);
    replaceFront(a, 3, [7]);
    expect(a).toEqual([7, 3, 4, 5]);
    const big = Array.from({ length: 20_000 }, (_, i) => i);
    const same = big;
    replaceFront(big, 0, Array.from({ length: 10_000 }, (_, i) => i - 10_000));
    expect(same).toBe(big);
    expect(big).toEqual(Array.from({ length: 30_000 }, (_, i) => i - 10_000));
  });
});

describe('Timeline.prepend', () => {
  it('matches a full rebuild and moves `shift`', () => {
    // Days and months cross the page edges, so boundary weights matter.
    const times = Array.from({ length: 400 }, (_, i) => i * 5 * HOUR);
    const timeline = new Timeline();
    timeline.set(times.slice(300));
    const array = timeline.times;
    for (const from of [250, 100, 99, 0]) {
      const to = timeline.times[0]! / (5 * HOUR);
      timeline.prepend(times.slice(from, to));
    }
    expect(timeline.times).toBe(array);
    expect(timeline.times).toEqual(times);
    expect(Array.from(timeline.weights)).toEqual(Array.from(computeTickWeights(times)));
    expect(timeline.shift).toBe(300);
    timeline.append(400 * 5 * HOUR);
    expect(Array.from(timeline.weights)).toEqual(Array.from(computeTickWeights([...times, 400 * 5 * HOUR])));
    timeline.set(times.slice());
    expect(timeline.shift).toBe(0);
  });

  it('starts from empty', () => {
    const timeline = new Timeline();
    timeline.prepend([0, 60, 120]);
    expect(Array.from(timeline.weights)).toEqual(Array.from(computeTickWeights([0, 60, 120])));
    expect(timeline.interval).toBe(60);
  });
});

describe('RectBatch front headroom', () => {
  const color: [number, number, number, number] = [1, 2, 3, 4];
  it('keeps existing instances in their storage slots and marks only the new ones dirty', () => {
    const batch = new RectBatch();
    batch.resize(4);
    for (let i = 0; i < 4; i++) batch.set(i, i, 1, 2, 0, color);
    // First prepend grows storage (everything is dirty then).
    batch.indexBase += 2;
    batch.growFront(2);
    batch.set(0, 0, 1, 2, 0, color);
    batch.set(1, 1, 1, 2, 0, color);
    expect(batch.count).toBe(6);
    batch.markClean();
    const head = batch.head;
    const capacity = batch.capacity;
    const before = batch.storage.slice((head + 2) * RECT_STRIDE, (head + 6) * RECT_STRIDE);
    batch.indexBase += 3;
    batch.growFront(3);
    for (let i = 0; i < 3; i++) batch.set(i, i, 1, 2, 0, color);
    expect(batch.capacity).toBe(capacity);
    expect(batch.head).toBe(head - 3);
    expect([batch.dirtyFrom, batch.dirtyTo]).toEqual([0, 3]);
    expect(batch.storage.slice((head + 2) * RECT_STRIDE, (head + 6) * RECT_STRIDE)).toEqual(before);
    // Stored indices are relative to indexBase; instance 5 was index 3, now 3 + 5.
    const f32 = new Float32Array(batch.bytes.slice().buffer);
    expect(Array.from({ length: 9 }, (_, i) => f32[(i * RECT_STRIDE) / 4]! + batch.indexBase)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    batch.growFront(-2);
    expect(batch.count).toBe(7);
    expect(batch.head).toBe(head - 1);
  });

  it('keeps room for every instance when it grows far past its front headroom', () => {
    const batch = new RectBatch();
    batch.resize(600);
    batch.growFront(600);
    expect(batch.head).toBeGreaterThan(0);
    // Far more than the storage holds: a full setData after history pages.
    batch.resize(4000);
    expect(batch.head + batch.count).toBeLessThanOrEqual(batch.capacity);
    batch.set(3999, 3999, 1, 2, 0, color);
    const f32 = new Float32Array(batch.bytes.slice().buffer);
    expect(f32[(3999 * RECT_STRIDE) / 4]).toBe(3999);
  });
});

/** A candle, histogram, line and custom series of every kind that follows the main bars. */
interface Band {
  time: number;
  upper: number;
  lower: number;
}

const bandDef: CustomSeriesDef<Band, object> = {
  type: 'band',
  defaultOptions: {},
  priceRange: (p) => [p.lower, p.upper],
  draw: () => {},
  legend: (p) => (p ? [{ label: 'U', text: String(p.upper) }] : []),
  lastValue: (p) => ({ value: p.upper }),
};

const smaDef: IndicatorDef = {
  id: 'avg',
  name: 'Avg',
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => {
    const v = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) v[i] = i > 0 ? (src.close[i]! + src.close[i - 1]!) / 2 : NaN;
    return { v };
  },
};

/** Everything a series derives from its data, with GPU instances decoded to absolute indices and prices. */
function snapshot(s: Series, n: number) {
  const inner = s as unknown as {
    display?: Bar[];
    data: unknown[];
    align: { index: Int32Array; source: Int32Array; count: number };
    batch?: RectBatch;
  };
  const { align, batch } = inner;
  const at = [0, 1, Math.floor(n / 2), n - 2, n - 1];
  let instances: number[][] | undefined;
  if (batch) {
    const f32 = new Float32Array(batch.bytes.slice().buffer);
    const u8 = batch.bytes;
    // Prices sit relative to `base`, which differs between the two builds: compare at float32 resolution.
    const price = (v: number) => Math.round((v + batch.base) * 1e4) / 1e4;
    instances = Array.from({ length: batch.count }, (_, i) => {
      const f = (i * RECT_STRIDE) / 4;
      const c = i * RECT_STRIDE + 20;
      return [f32[f]! + batch.indexBase, price(f32[f + 1]!), price(f32[f + 2]!), f32[f + 3]!, f32[f + 4]!, u8[c]!, u8[c + 1]!, u8[c + 2]!, u8[c + 3]!];
    });
  }
  return {
    data: inner.data,
    display: inner.display,
    index: Array.from(align.index.subarray(0, align.count)),
    source: Array.from(align.source.subarray(0, align.count)),
    instances,
    range: [s.priceRange(0, n), s.priceRange(n - 5, n - 1), s.priceRange(0, n, true)],
    legend: at.map((i) => s.legend(i)),
    lastValues: s.lastValues(),
  };
}

const TOTAL = 90;

/**
 * A chart whose main series holds bars [start, TOTAL); its followers hold
 * every bar from 0, so those before `start` have no bar to sit on yet.
 */
function parityChart(options: Partial<CandleSeriesOptions>, start: number) {
  const c = new Chart(fakeContainer(), UTC_OPTIONS);
  charts.push(c);
  const all = bars(0, TOTAL);
  const main = c.addCandles(options);
  main.setData(all.slice(start));
  const s = {
    chart: c,
    main,
    candles: c.addCandles(options),
    volume: c.addHistogram({ follow: volumeOf }),
    histogram: c.addHistogram({ positiveColor: '#0f0', negativeColor: '#f00', base: 11 }),
    line: c.addLine(),
    followLine: c.addLine({ follow: (b) => (b.time % (3 * HOUR) === 0 ? null : { time: b.time, value: b.close }) }),
    band: c.addCustomSeries(bandDef),
  };
  s.candles.setData(all.filter((_, i) => i % 4 !== 1));
  s.histogram.setData(all.map((b) => ({ time: b.time, value: b.close })));
  s.line.setData(all.filter((_, i) => i % 5 !== 2).map((b) => ({ time: b.time, value: b.close })));
  s.band.setData(all.map((b) => ({ time: b.time, upper: b.high, lower: b.low })));
  c.indicators.add(smaDef);
  return s;
}

const KEYS = ['main', 'candles', 'volume', 'histogram', 'line', 'followLine', 'band'] as const;

describe('a history page matches a fresh setData', () => {
  const styles: Partial<CandleSeriesOptions>[] = [
    { style: 'candles' },
    { style: 'hollow' },
    { style: 'bars' },
    { style: 'heikinAshi' },
    { style: 'volumeCandles' },
    { style: 'line' },
    { style: 'candles', colorByPreviousClose: true },
  ];

  for (const options of styles) {
    it(`${options.style}${options.colorByPreviousClose ? ' by previous close' : ''}`, () => {
      const live = parityChart(options, 60);
      frame(live.chart);
      // Pages of different sizes, the last reaching the first bar; frames in between.
      for (const [from, to] of [[41, 60], [40, 41], [10, 40], [0, 10]] as const) {
        expect(live.main.prependBars(bars(from, to))).toBe(true);
        frame(live.chart);
      }
      const fresh = parityChart(options, 0);

      expect(live.chart.timeline.times).toEqual(fresh.chart.timeline.times);
      expect(Array.from(live.chart.timeline.weights)).toEqual(Array.from(fresh.chart.timeline.weights));
      for (const key of KEYS) expect(snapshot(live[key], TOTAL), key).toEqual(snapshot(fresh[key], TOTAL));
      const outputs = (s: typeof live) => Array.from(s.chart.indicators.getAll()[0]!.values.v!);
      expect(outputs(live)).toEqual(outputs(fresh));
    });
  }

  it('setData after pages, then appended bars, still match a fresh chart', () => {
    const live = parityChart({ style: 'candles' }, 60);
    frame(live.chart);
    for (const [from, to] of [[40, 60], [20, 40]] as const) {
      live.main.prependBars(bars(from, to));
      frame(live.chart);
    }
    // More bars than the front headroom and storage hold.
    live.main.setData(bars(0, TOTAL));
    frame(live.chart);
    const fresh = parityChart({ style: 'candles' }, 0);
    for (const key of KEYS) expect(snapshot(live[key], TOTAL), key).toEqual(snapshot(fresh[key], TOTAL));
  });

  it('a page then appended bars match a fresh chart', () => {
    const live = parityChart({ style: 'candles' }, 60);
    // Leave the last bars out so they arrive as appends after the page.
    live.main.setData(bars(60, TOTAL - 3));
    frame(live.chart);
    live.main.prependBars(bars(30, 60));
    frame(live.chart);
    for (let i = TOTAL - 3; i < TOTAL; i++) {
      live.main.update(bar(i));
      frame(live.chart);
    }
    live.main.prependBars(bars(0, 30));
    frame(live.chart);
    const fresh = parityChart({ style: 'candles' }, 0);
    for (const key of KEYS) expect(snapshot(live[key], TOTAL), key).toEqual(snapshot(fresh[key], TOTAL));
  });

  it('refuses bars that do not sit before the first one, changing nothing', () => {
    const live = parityChart({ style: 'candles' }, 60);
    const before = snapshot(live.main, TOTAL);
    expect(live.main.prependBars(bars(50, 61))).toBe(false);
    expect(snapshot(live.main, TOTAL)).toEqual(before);
    expect(live.chart.timeline.length).toBe(30);
  });
});

describe('prepending a history page', () => {
  // 1M bars: nothing per page may grow with the bars already loaded.
  it.each([20_000, 1_000_000])('does no full rebuild, allocation or upload proportional to %i bars', (n) => {
    const { context, uploads } = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: context }), UTC_OPTIONS);
    charts.push(c);
    const PAGE = 500;
    // Bars n + 2 pages back: two pages fit in front.
    const main = c.addCandles();
    main.setData(bars(2 * PAGE, n + 2 * PAGE));
    const volume = c.addHistogram({ follow: volumeOf });
    const line = c.addLine();
    line.setData(bars(0, n + 2 * PAGE).map((b) => ({ time: b.time, value: b.close })));
    const band = c.addCustomSeries(bandDef);
    band.setData(main.data.map((b) => ({ time: b.time, upper: b.high, lower: b.low })));
    frame(c);

    // The first page grows the storage at the front; measure the second.
    main.prependBars(bars(PAGE, 2 * PAGE));
    frame(c);

    const series: Series[] = [main, volume, line, band];
    const rebuilds = series.map((s) => vi.spyOn(s, 'rebuild'));
    const realigns = series.map((s) => vi.spyOn(s, 'realign'));
    const resets = vi.spyOn(c.timeline, 'set');
    const times = c.timeline.times;
    const page = bars(0, PAGE);
    // The load's off-screen bars reach the GPU over the next frames (#559); let them land first.
    const renderer = (c as unknown as { renderer: { uploadsPending: boolean } }).renderer;
    for (let i = 0; i < 100 && renderer.uploadsPending; i++) frame(c);
    expect(renderer.uploadsPending).toBe(false);
    uploads.length = 0;

    const allocated = measureAllocations(() => {
      main.prependBars(page);
      frame(c);
    });

    for (const spy of [...rebuilds, ...realigns, resets]) expect(spy).not.toHaveBeenCalled();
    expect(allocated.bytes).toBeLessThan(256 * 1024);
    expect(allocated.longestCopy).toBeLessThanOrEqual(PAGE + 1);
    expect(c.timeline.times).toBe(times);
    expect(c.timeline.length).toBe(n + 2 * PAGE);
    expect(uploads.filter((u) => u.kind === 'data')).toEqual([]);
    // Candles: three rects for each new bar and for the old first bar (its previous close is new).
    const perBar = 3 * RECT_STRIDE;
    const candleBatch = main.batch;
    const volumeBatch = (volume as unknown as { batch: RectBatch }).batch;
    expect(uploads).toContainEqual({ kind: 'sub', offset: candleBatch.head * RECT_STRIDE, bytes: (PAGE + 1) * perBar });
    // Volume: one column per new bar, and the old first one recoloured.
    expect(uploads).toContainEqual({ kind: 'sub', offset: volumeBatch.head * RECT_STRIDE, bytes: (PAGE + 1) * RECT_STRIDE });
    // Line: the page's points (aligned now), the old first point rejoined and the leading break vertex.
    const lineBytes = (PAGE + 2) * LINE_STRIDE;
    expect(uploads).toContainEqual({ kind: 'sub', offset: expect.any(Number), bytes: lineBytes });
    expect(uploads.reduce((sum, u) => sum + u.bytes, 0)).toBeLessThanOrEqual((PAGE + 1) * (perBar + RECT_STRIDE) + lineBytes);
    expect(line.data).toHaveLength(n + 2 * PAGE);
    expect((line as unknown as { align: { count: number } }).align.count).toBe(n + 2 * PAGE);
  }, 120_000);

  it('ten pages cost less than one setData of the same bars', () => {
    const n = 200_000;
    const PAGE = 500;
    const c = new Chart(fakeContainer(), UTC_OPTIONS);
    charts.push(c);
    const all = bars(0, n + 10 * PAGE);
    const main = c.addCandles();
    main.setData(all.slice(10 * PAGE));
    const volume = c.addHistogram({ follow: volumeOf });
    void volume;
    frame(c);
    const pages: number[] = [];
    for (let p = 9; p >= 0; p--) {
      const t0 = performance.now();
      main.prependBars(all.slice(p * PAGE, (p + 1) * PAGE));
      frame(c);
      pages.push(performance.now() - t0);
    }
    const t0 = performance.now();
    main.setData(all);
    frame(c);
    const full = performance.now() - t0;
    expect(pages.reduce((a, b) => a + b, 0)).toBeLessThan(full);
  }, 60_000);
});

describe('history pages from a data source', () => {
  const END = 2_000;
  /** Hourly bars [0, END), paged by `to` and `limit`. */
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol }),
    search: async () => [],
    history: async (_info, _interval, req) => {
      const to = req.to === undefined ? END : req.to / HOUR;
      const from = Math.max(0, to - req.limit);
      return { bars: bars(from, to), atStart: from === 0 };
    },
  };

  it('prepend the page instead of setting every bar again, and match a full load', async () => {
    const c = new Chart(fakeContainer(), UTC_OPTIONS);
    charts.push(c);
    c.setDataSource(source, { initialBars: 300, pageBars: 300 });
    await c.setSymbol('A', '1h');
    const volume = c.addHistogram({ follow: volumeOf });
    c.indicators.add(smaDef);
    const main = c.main as CandleSeries;
    const setData = vi.spyOn(main, 'setData');
    const loaded: number[] = [];
    c.on('data:loaded', (e) => loaded.push(e.bars.length));
    for (let i = 0; i < 3; i++) await c.data!.loadMore();
    expect(setData).not.toHaveBeenCalled();
    expect(loaded).toEqual([600, 900, 1200]);
    expect(c.timeline.length).toBe(1200);

    const fresh = new Chart(fakeContainer(), UTC_OPTIONS);
    charts.push(fresh);
    const freshMain = fresh.addCandles();
    freshMain.setData(bars(END - 1200, END));
    const freshVolume = fresh.addHistogram({ follow: volumeOf });
    fresh.indicators.add(smaDef);
    expect(snapshot(main, 1200)).toEqual(snapshot(freshMain, 1200));
    expect(snapshot(volume, 1200)).toEqual(snapshot(freshVolume, 1200));
    expect(Array.from(c.indicators.getAll()[0]!.values.v!)).toEqual(Array.from(fresh.indicators.getAll()[0]!.values.v!));
  });
});

/**
 * Run `fn` and measure what it allocates: bytes of fresh typed-array and
 * ArrayBuffer storage, and the longest array or typed array it copied
 * (`slice`, `map`, `filter`, `concat`, `from`). Views (`subarray`) are free.
 */
function measureAllocations(fn: () => void): { bytes: number; longestCopy: number } {
  const g = globalThis as unknown as Record<string, unknown>;
  const names = ['ArrayBuffer', 'Float64Array', 'Float32Array', 'Int32Array', 'Uint32Array', 'Int16Array', 'Uint16Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray'];
  const Buffer = ArrayBuffer;
  const result = { bytes: 0, longestCopy: 0 };
  const restore: (() => void)[] = [];
  const replace = (owner: object, key: string, value: unknown) => {
    const o = owner as Record<string, unknown>;
    const original = o[key];
    o[key] = value;
    restore.push(() => (o[key] = original));
  };
  for (const name of names) {
    replace(g, name, new Proxy(g[name] as new (...args: unknown[]) => ArrayBufferLike | ArrayBufferView, {
      construct(target, args, newTarget) {
        const made = Reflect.construct(target, args, newTarget) as ArrayBufferLike | ArrayBufferView;
        if (!(args[0] instanceof Buffer)) result.bytes += made.byteLength;
        return made;
      },
    }));
  }
  const copying = (original: (...args: unknown[]) => unknown) =>
    function (this: { length: number }, ...args: unknown[]) {
      result.longestCopy = Math.max(result.longestCopy, this.length);
      return original.apply(this, args);
    };
  const typed = Object.getPrototypeOf(Uint8Array.prototype) as Record<string, (...args: unknown[]) => unknown>;
  const array = Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const proto of [array, typed]) {
    for (const key of ['slice', 'map', 'filter']) replace(proto, key, copying(proto[key]!));
  }
  replace(array, 'concat', copying(array.concat!));
  const from = Array.from;
  replace(Array, 'from', (src: ArrayLike<unknown>, ...rest: []) => {
    result.longestCopy = Math.max(result.longestCopy, src.length ?? 0);
    return from(src, ...rest);
  });
  try {
    fn();
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
  return result;
}
