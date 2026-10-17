import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, recordingWebgl2 } from './fake-dom';
import { Chart } from '../src/chart';
import { Timeline } from '../src/timeline';
import { computeTickWeights } from '../src/util/format';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import type { IndicatorDef } from '../src/indicators/types';
import type { CandleSeriesOptions, CustomSeriesDef, Series } from '../src/series';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const HOUR = 3600;
/**
 * The default `'local'` timezone asks `Intl` for offsets on machines not set
 * to UTC, which adds a cost that depends on the machine's zone. The large-data
 * tests pin UTC so their cost is the same on every machine.
 */
const UTC_OPTIONS = { timezone: 'UTC' };
const bar = (i: number): Bar => ({ time: i * HOUR, open: 10, high: 12, low: 8, close: 10 + (i % 7), volume: 100 + i });

describe('Timeline.append', () => {
  it('matches a full rebuild and leaves earlier weights alone', () => {
    const times = Array.from({ length: 200 }, (_, i) => i * HOUR);
    const timeline = new Timeline();
    timeline.set(times.slice(0, 100));
    const before = Array.from(timeline.weights);
    for (let i = 100; i < 200; i++) timeline.append(times[i]!);
    expect(Array.from(timeline.weights)).toEqual(Array.from(computeTickWeights(times)));
    expect(Array.from(timeline.weights.subarray(0, 100))).toEqual(before);
    expect(timeline.length).toBe(200);
    expect(timeline.interval).toBe(HOUR);
  });

  it('starts from empty', () => {
    const timeline = new Timeline();
    timeline.append(0);
    timeline.append(60);
    expect(Array.from(timeline.weights)).toEqual(Array.from(computeTickWeights([0, 60])));
    expect(timeline.indexOf(60)).toBe(1);
  });
});


const smaDef: IndicatorDef = {
  id: 'avg',
  name: 'Avg',
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
  update: (src, _inputs, i, out) => {
    out.v![i] = src.close[i]!;
  },
};

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
        // A typed array over an existing buffer is a view; anything else owns new storage.
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

describe('appending a bar', () => {
  // 1M bars is the scale streaming must hold at: nothing per append may grow with n.
  it.each([20_000, 1_000_000])('does no full rebuild, allocation or upload proportional to %i bars', (n) => {
    const { context, uploads } = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: context }), UTC_OPTIONS);
    charts.push(c);
    const data = Array.from({ length: n }, (_, i) => bar(i));
    const main = c.addCandles();
    main.setData(data);
    const lines = [c.addLine(), c.addLine()];
    for (const line of lines) line.setData(data.map((b) => ({ time: b.time, value: b.close })));
    const volume = c.addHistogram();
    volume.setData(data.map((b) => ({ time: b.time, value: b.volume! })));
    for (let k = 0; k < 3; k++) c.indicators.add(smaDef);
    const frame = () => {
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
    };
    frame();

    // The first append may grow the batches; measure the second.
    main.update(bar(n));
    for (const line of lines) line.update({ time: n * HOUR, value: 1 });
    volume.update({ time: n * HOUR, value: 1 });
    frame();

    const series = [main, ...lines, volume];
    const rebuilds = series.map((s) => vi.spyOn(s, 'rebuild'));
    const realigns = series.map((s) => vi.spyOn(s, 'realign'));
    const resets = vi.spyOn(c.timeline, 'set');
    const computes = vi.spyOn(smaDef, 'compute');
    const times = c.timeline.times;
    // The load's off-screen bars reach the GPU over the next frames (#559); let them land first.
    const renderer = (c as unknown as { renderer: { uploadsPending: boolean } }).renderer;
    for (let i = 0; i < 100 && renderer.uploadsPending; i++) frame();
    expect(renderer.uploadsPending).toBe(false);
    uploads.length = 0;

    const allocated = measureAllocations(() => {
      main.update(bar(n + 1));
      for (const line of lines) line.update({ time: (n + 1) * HOUR, value: 1 });
      volume.update({ time: (n + 1) * HOUR, value: 2 });
      frame();
    });

    for (const spy of [...rebuilds, ...realigns, resets, computes]) expect(spy).not.toHaveBeenCalled();
    // Proportional to n would be at least n bytes (one tick weight per bar) and an n-long copy.
    expect(allocated.bytes).toBeLessThan(64 * 1024);
    expect(allocated.longestCopy).toBeLessThan(10_000);
    expect(c.timeline.times).toBe(times);
    expect(c.timeline.length).toBe(n + 2);
    expect(uploads.filter((u) => u.kind === 'data')).toEqual([]);
    // Candles write three rects per bar; the histogram one column per point.
    const perBar = 3 * RECT_STRIDE;
    expect(uploads).toContainEqual({ kind: 'sub', offset: (n + 1) * perBar, bytes: perBar });
    expect(uploads).toContainEqual({ kind: 'sub', offset: (n + 1) * RECT_STRIDE, bytes: RECT_STRIDE });
    expect(Math.max(...uploads.map((u) => u.bytes))).toBeLessThanOrEqual(perBar);
    expect(lines[0]!.data).toHaveLength(n + 2);
  }, 60_000);

  it('places a point that arrived before its main bar on the projected bar, and keeps it there once the bar appends', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const main = c.addCandles();
    main.setData([bar(0), bar(1)]);
    const line = c.addLine();
    line.setData([{ time: 0, value: 1 }, { time: HOUR, value: 2 }]);
    line.update({ time: 2 * HOUR, value: 3 });
    const align = () => (line as unknown as { align: { count: number; index: Int32Array } }).align;
    expect(align().count).toBe(3);
    expect(align().index[2]).toBe(2);
    main.update(bar(2));
    expect(align().count).toBe(3);
    expect(align().index[2]).toBe(2);
  });

  it('keeps Heikin Ashi bars chained across appends', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const main = c.addCandles({ style: 'heikinAshi' });
    main.setData([bar(0), bar(1)]);
    main.update(bar(2));
    const appended = (main as unknown as { display: Bar[] }).display;
    const rebuilt = c.addCandles({ style: 'heikinAshi' });
    rebuilt.setData([bar(0), bar(1), bar(2)]);
    expect(appended).toEqual((rebuilt as unknown as { display: Bar[] }).display);
  });
});

describe('view clamping', () => {
  it('reports when more bars are asked for than fit at minBarSpacing', () => {
    const c = new Chart(fakeContainer(), UTC_OPTIONS);
    charts.push(c);
    const main = c.addCandles();
    main.setData(Array.from({ length: 100 }, (_, i) => bar(i)));
    expect(c.fitContent(false)).toBe(true);
    expect(c.setVisibleTimeRange(0, 50 * HOUR, false)).toBe(true);
    main.setData(Array.from({ length: 100_000 }, (_, i) => bar(i)));
    expect(c.fitContent(false)).toBe(false);
    expect(c.setVisibleTimeRange(0, 99_999 * HOUR, false)).toBe(false);
  });
});

/** Everything a series derives from its data: what it draws, autoscales on and labels. */
function snapshot(s: Series, bars: number) {
  const inner = s as unknown as {
    display?: Bar[];
    align: { index: Int32Array; source: Int32Array; count: number };
    batch?: { count: number; base: number; bytes: Uint8Array };
  };
  const { align, batch } = inner;
  const at = [0, 1, Math.floor(bars / 2), bars - 2, bars - 1];
  return {
    display: inner.display,
    index: Array.from(align.index.subarray(0, align.count)),
    source: Array.from(align.source.subarray(0, align.count)),
    batch: batch && { count: batch.count, base: batch.base, bytes: batch.bytes.subarray(0, batch.count * RECT_STRIDE) },
    range: [s.priceRange(0, bars), s.priceRange(bars - 5, bars - 1), s.priceRange(0, bars, true)],
    legend: at.map((i) => s.legend(i)),
    lastValues: s.lastValues(),
  };
}

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

/** A chart with a main candle series plus one following series of each other kind. */
function parityChart(candles: Partial<CandleSeriesOptions>) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return {
    chart: c,
    main: c.addCandles(candles),
    candles: c.addCandles(candles),
    volume: c.addHistogram({ positiveColor: '#0f0', negativeColor: '#f00', base: 11 }),
    line: c.addLine(),
    band: c.addCustomSeries(bandDef),
  };
}

/** Bar `i` in version `v`: ticks of the forming bar change its values but not its time. */
const versioned = (i: number, v: number): Bar => {
  const open = 10 + ((i * 7) % 5);
  const close = open + (((i + v) * 3) % 7) - 3;
  return { time: i * HOUR, open, close, high: Math.max(open, close) + 1 + v, low: Math.min(open, close) - 1, volume: 100 + ((i * 13 + v * 29) % 90) };
};

describe('appends and ticks match a fresh build', () => {
  const styles: Partial<CandleSeriesOptions>[] = [
    { style: 'candles' },
    { style: 'hollow' },
    { style: 'heikinAshi' },
    { style: 'volumeCandles' },
    { style: 'candles', colorByPreviousClose: true },
  ];

  for (const options of styles) {
    it(`${options.style}${options.colorByPreviousClose ? ' by previous close' : ''}`, () => {
      const live = parityChart(options);
      const bars: Bar[] = Array.from({ length: 30 }, (_, i) => versioned(i, 0));
      const feed = (s: ReturnType<typeof parityChart>, b: Bar) => {
        s.candles.update(b);
        s.volume.update({ time: b.time, value: b.close });
        s.line.update({ time: b.time, value: b.close });
        s.band.update({ time: b.time, upper: b.high, lower: b.low });
      };
      live.main.setData(bars.slice());
      live.candles.setData(bars.slice());
      live.volume.setData(bars.map((b) => ({ time: b.time, value: b.close })));
      live.line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
      live.band.setData(bars.map((b) => ({ time: b.time, upper: b.high, lower: b.low })));

      for (let i = bars.length; i < 60; i++) {
        // A few ticks of the forming bar, sometimes partly eased in, then the next bar.
        for (let v = 1; v <= i % 3; v++) {
          const b = versioned(i - 1, v);
          bars[i - 1] = b;
          live.main.update(b);
          feed(live, b);
          if ((i + v) % 2 === 0) for (const s of [live.main, live.candles]) s.step(16);
        }
        const next = versioned(i, 0);
        bars.push(next);
        // Following series sometimes get the new time before the main series has it.
        if (i % 2 === 0) feed(live, next);
        live.main.update(next);
        if (i % 2 === 1) feed(live, next);
      }
      // A last animated tick, eased to rest.
      const last = versioned(bars.length - 1, 5);
      bars[bars.length - 1] = last;
      live.main.update(last);
      feed(live, last);
      for (const s of [live.main, live.candles]) while (s.step(1e9));

      const fresh = parityChart(options);
      fresh.main.setData(bars.slice());
      fresh.candles.setData(bars.slice());
      fresh.volume.setData(bars.map((b) => ({ time: b.time, value: b.close })));
      fresh.line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
      fresh.band.setData(bars.map((b) => ({ time: b.time, upper: b.high, lower: b.low })));

      expect(live.chart.timeline.times).toEqual(fresh.chart.timeline.times);
      expect(Array.from(live.chart.timeline.weights)).toEqual(Array.from(fresh.chart.timeline.weights));
      for (const key of ['main', 'candles', 'volume', 'line', 'band'] as const) {
        expect(snapshot(live[key], bars.length), key).toEqual(snapshot(fresh[key], bars.length));
      }
    });
  }
});

describe('appending after an animated tick', () => {
  const tick = (i: number): Bar => ({ time: i * HOUR, open: 10, high: 15, low: 6, close: 14, volume: 500 + i });

  for (const style of ['candles', 'heikinAshi'] as const) {
    it(`finalizes the eased last bar before appending (${style})`, () => {
      const c = new Chart(fakeContainer());
      charts.push(c);
      const main = c.addCandles({ style });
      main.setData([bar(0), bar(1), bar(2)]);
      // Animated same-time tick, then a newer bar before any frame eases it in.
      main.update(tick(2));
      main.update(bar(3));
      const fresh = new Chart(fakeContainer());
      charts.push(fresh);
      const rebuilt = fresh.addCandles({ style });
      rebuilt.setData([bar(0), bar(1), tick(2), bar(3)]);
      type Inner = { display: Bar[]; batch: { count: number; bytes: Uint8Array } };
      const a = main as unknown as Inner;
      const b = rebuilt as unknown as Inner;
      expect(a.display).toEqual(b.display);
      expect(a.batch.count).toBe(b.batch.count);
      expect(a.batch.bytes.subarray(0, a.batch.count * RECT_STRIDE)).toEqual(b.batch.bytes.subarray(0, b.batch.count * RECT_STRIDE));
    });
  }
});
