import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { alignSteps, formingSteps } from '../src/indicators/steps';
import { buildTail } from '../src/indicators/intervals';
import type { BarsReset, DataSource, Interval, SymbolInfo } from '../src/data/types';
import type { BarArrays, IndicatorDef, IntervalBars } from '../src/indicators/types';
import type { Bar } from '../src/types';
import { UTC, zoneOf } from '../src/util/timezone';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
/** 2023-11-15 00:00 UTC, a whole hour and day. */
const T0 = 1700006400;

function arrays(bars: readonly Bar[]): BarArrays {
  const col = (f: (b: Bar) => number) => Float64Array.from(bars, f);
  return {
    length: bars.length,
    time: col((b) => b.time),
    open: col((b) => b.open),
    high: col((b) => b.high),
    low: col((b) => b.low),
    close: col((b) => b.close),
    volume: col((b) => b.volume ?? NaN),
  };
}

/** A bar at `time` around `close`, with a range of one either side and volume 1. */
function bar(time: number, close: number): Bar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

describe('alignSteps', () => {
  const higher = [T0, T0 + HOUR, T0 + 2 * HOUR];
  const values = [10, 20, 30];

  it('holds each higher value until the next higher bar starts', () => {
    const lower = [T0 - MINUTE, T0, T0 + 59 * MINUTE, T0 + HOUR, T0 + 3 * HOUR];
    expect([...alignSteps(lower, higher, values)]).toEqual([NaN, 10, 10, 20, 30]);
  });

  it('shows a value only once its bar closed with closedOnly', () => {
    const lower = [T0, T0 + 59 * MINUTE, T0 + HOUR, T0 + 2 * HOUR + 1, T0 + 9 * HOUR];
    expect([...alignSteps(lower, higher, values, { closedOnly: true })]).toEqual([NaN, NaN, 10, 20, 20]);
  });

  it('carries a value across a session gap to the next higher bar', () => {
    // Daily bars Friday and Monday; hourly bars Friday afternoon and Monday morning.
    const friday = T0 + 2 * DAY;
    const monday = friday + 3 * DAY;
    const lower = [friday + 15 * HOUR, friday + 16 * HOUR, monday + 9 * HOUR];
    expect([...alignSteps(lower, [friday, monday], [1, 2])]).toEqual([1, 1, 2]);
    expect([...alignSteps(lower, [friday, monday], [1, 2], { closedOnly: true })]).toEqual([NaN, NaN, 1]);
  });

  it('follows daily bars across a DST change by their own start times', () => {
    // New York midnights around 2023-11-05, the day clocks go back: that day lasts 25 hours.
    const ny = zoneOf('America/New_York');
    const midnight = (d: number) => ny.fromWall(Date.UTC(2023, 10, d) / 1000);
    const days = [midnight(4), midnight(5), midnight(6)];
    expect(days[2]! - days[1]!).toBe(25 * HOUR);
    // The 24th hour of the long day still belongs to it; nominal 24h steps would move it to the next day.
    const lower = [days[1]! + 23 * HOUR, days[1]! + 24 * HOUR, days[2]!];
    expect([...alignSteps(lower, days, [4, 5, 6])]).toEqual([5, 5, 6]);
    expect([...alignSteps(lower, days, [4, 5, 6], { closedOnly: true })]).toEqual([4, 4, 5]);
  });

  it('never changes a closed-only value when later bars arrive', () => {
    const lower = Array.from({ length: 180 }, (_, i) => T0 + i * MINUTE);
    const full = alignSteps(lower, higher, values, { closedOnly: true });
    const early = alignSteps(lower.slice(0, 90), higher.slice(0, 2), values.slice(0, 2), { closedOnly: true });
    expect([...full.subarray(0, 90)]).toEqual([...early]);
  });
});

describe('formingSteps', () => {
  /** Two hours of minute bars, closes 0..119; hourly bars aggregated from them. */
  const minutes = Array.from({ length: 120 }, (_, i) => bar(T0 + i * MINUTE, i));
  const hours = [0, 1].map((h) => {
    const part = minutes.slice(h * 60, h * 60 + 60);
    return {
      time: T0 + h * HOUR,
      open: part[0]!.open,
      high: Math.max(...part.map((b) => b.high)),
      low: Math.min(...part.map((b) => b.low)),
      close: part[part.length - 1]!.close,
      volume: part.length,
    };
  });

  it('shows each lower bar the higher bar as it stood then', () => {
    const seen: { index: number; high: number; close: number; volume: number }[] = [];
    const out = formingSteps(arrays(minutes), arrays(hours), (bars, j) => {
      seen.push({ index: j, high: bars.high[j]!, close: bars.close[j]!, volume: bars.volume[j]! });
      return bars.close[j]!;
    });
    // The running close, never the hour's final close.
    expect([...out]).toEqual(minutes.map((b) => b.close));
    expect(seen[0]).toEqual({ index: 0, high: 1, close: 0, volume: 1 });
    expect(seen[29]).toEqual({ index: 0, high: 30, close: 29, volume: 30 });
  });

  it('passes every earlier higher bar complete before the next one forms', () => {
    const calls: [number, number][] = [];
    formingSteps(arrays(minutes), arrays(hours), (bars, j) => {
      calls.push([j, bars.close[j]!]);
      return 0;
    });
    // Sixty partial calls for hour 0, then hour 0 complete, then hour 1 forming.
    expect(calls[60]).toEqual([0, 59]);
    expect(calls[61]).toEqual([1, 60]);
    expect(calls.filter(([j]) => j === 0)).toHaveLength(61);
  });

  it('has no lookahead: values do not depend on later lower bars', () => {
    const step = (bars: BarArrays, j: number) => bars.close[j]! - bars.open[j]! + (j > 0 ? bars.close[j - 1]! : 0);
    const full = formingSteps(arrays(minutes), arrays(hours), step);
    const partial = formingSteps(arrays(minutes.slice(0, 75)), arrays(hours), step);
    expect([...full.subarray(0, 75)]).toEqual([...partial]);
  });

  it('is NaN before the first higher bar', () => {
    const out = formingSteps(arrays([bar(T0 - MINUTE, 5), bar(T0, 6)]), arrays(hours), (bars, j) => bars.close[j]!);
    expect([...out]).toEqual([NaN, 6]);
  });
});

describe('buildTail', () => {
  const lower = arrays(Array.from({ length: 150 }, (_, i) => bar(T0 + i * MINUTE, i)));

  it('rebuilds the anchor from lower bars that reach back before it and cuts later bars', () => {
    const anchor = { time: T0 + HOUR, open: 1000, high: 2000, low: 0, close: 1500, volume: 99 };
    const tail = buildTail(anchor, lower, '1h', UTC);
    expect(tail.map((b) => b.time)).toEqual([T0 + HOUR, T0 + 2 * HOUR]);
    expect(tail[0]).toEqual({ time: T0 + HOUR, open: 60, high: 120, low: 59, close: 119, volume: 60 });
    expect(tail[1]).toEqual({ time: T0 + 2 * HOUR, open: 120, high: 150, low: 119, close: 149, volume: 30 });
  });

  it('only widens a loaded anchor the chart starts inside', () => {
    const anchor = { time: T0, open: -5, high: 3, low: -9, close: 1, volume: 500 };
    const tail = buildTail(anchor, arrays([bar(T0 + 30 * MINUTE, 7)]), '1h', UTC);
    expect(tail).toEqual([{ time: T0, open: -5, high: 8, low: -9, close: 7, volume: 500 }]);
  });

  it('keeps only the open of an anchor that may hold later data', () => {
    // A replay stopped 30 minutes into the hour: the loaded hour reached 50 later on.
    const anchor = { time: T0, open: 10, high: 50, low: 1, close: 40, volume: 99 };
    const tail = buildTail(anchor, arrays([bar(T0 + 10 * MINUTE, 12), bar(T0 + 30 * MINUTE, 14)]), '1h', UTC, false);
    expect(tail).toEqual([{ time: T0, open: 10, high: 15, low: 10, close: 14, volume: 2 }]);
  });

  it('keeps the phase of the loaded bars for new higher bars', () => {
    // Daily bars stamped at a 13:30 session open; the next session's bars start a new one.
    const open = T0 + 13.5 * HOUR;
    const anchor = { time: open, open: 1, high: 1, low: 1, close: 1 };
    const next = open + DAY;
    const tail = buildTail(anchor, arrays([bar(open + HOUR, 2), bar(next + HOUR, 3)]), '1d', UTC);
    expect(tail.map((b) => b.time)).toEqual([open, next]);
  });

  it('starts calendar bars in the symbol zone without an anchor', () => {
    const tail = buildTail(null, arrays([bar(Date.UTC(2024, 0, 31) / 1000, 1), bar(Date.UTC(2024, 1, 2) / 1000, 2)]), '1M', UTC);
    expect(tail.map((b) => b.time)).toEqual([Date.UTC(2024, 0, 1) / 1000, Date.UTC(2024, 1, 1) / 1000]);
  });
});

/* ------------------------------ on the chart ------------------------------ */

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const nextTask = (globalThis as unknown as { setImmediate(fn: () => void): void }).setImmediate;
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => nextTask(r));
}

/** 2000 minute bars with closes 0..1999, and hourly bars aggregated from them. */
const MINUTES = Array.from({ length: 2000 }, (_, i) => bar(T0 + i * MINUTE, i));
function aggregate(bars: readonly Bar[], seconds: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const time = Math.floor(b.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume = (last.volume ?? 0) + (b.volume ?? 0);
    } else out.push({ ...b, time });
  }
  return out;
}

interface Harness {
  calls: { symbol: string; interval: Interval; to?: number; limit: number }[];
  live: ((bar: Bar) => void)[];
  /** Live subscriptions to other symbols' bars, whether each was unsubscribed, and a reset of its bars (through the source's `onReset`). */
  others: { symbol: string; interval: Interval; onBar: (bar: Bar) => void; onReset: () => void; off: boolean }[];
  /** Multiplies symbol B's prices. */
  scaleB: number;
  source: DataSource;
}

function harness(): Harness {
  const resets = new Set<(reset: BarsReset) => void>();
  const series: Record<string, Bar[]> = { '1m': MINUTES, '1h': aggregate(MINUTES, HOUR) };
  const h: Harness = {
    calls: [],
    live: [],
    others: [],
    scaleB: 10,
    source: {
      symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
      search: async () => [],
      history: async (info, interval, req) => {
        if (req.kind === 'history' && interval !== '1m') h.calls.push({ symbol: info.symbol, interval, to: req.to, limit: req.limit });
        const all = series[interval] ?? [];
        const page = all.filter((b) => req.to === undefined || b.time < req.to).slice(-req.limit);
        // Symbol B trades at ten times A's prices.
        const scale = info.symbol === 'B' ? h.scaleB : 1;
        const bars = page.map((b) => ({ ...b, open: b.open * scale, high: b.high * scale, low: b.low * scale, close: b.close * scale }));
        return { bars, atStart: page.length < req.limit };
      },
      onReset: (listener) => {
        resets.add(listener);
        return () => resets.delete(listener);
      },
      stream: (info, interval, onBar) => {
        if (interval === '1m') {
          h.live.push(onBar);
          return () => {};
        }
        const onReset = () => {
          for (const listener of [...resets]) listener({ symbol: info.symbol, interval });
        };
        const sub = { symbol: info.symbol, interval, onBar, onReset, off: false };
        h.others.push(sub);
        return () => {
          sub.off = true;
        };
      },
    },
  };
  return h;
}

/** An indicator that keeps what it was given, and plots the hour's close as it stood at each minute. */
function recorder(interval: Interval = '1h', lookback = 3) {
  const seen: IntervalBars[] = [];
  const def: IndicatorDef<{ hours: string }> = {
    id: `hourly-close-${interval}`,
    name: 'Hourly close',
    placement: 'pane',
    inputs: [{ id: 'hours', type: 'text', default: interval }],
    plots: [{ id: 'close', type: 'line' }, { id: 'closed', type: 'line' }],
    intervals: ({ hours }) => [{ interval: hours as Interval, lookback }],
    compute(src, { hours }, _data, bars) {
      seen.push(bars);
      const higher = bars[hours]!;
      return {
        close: formingSteps(src, higher, (b, j) => b.close[j]!),
        closed: alignSteps(src.time, higher.time, higher.close, { closedOnly: true }),
      };
    },
  };
  return { def, seen };
}

async function chartWith(h: Harness, interval: Interval = '1m', initialBars = 150): Promise<Chart> {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.setDataSource(h.source, { initialBars, pageBars: 100 });
  await c.setSymbol('A', interval);
  return c;
}

describe('indicators reading another interval', () => {
  it('loads the higher bars with their warm-up and values without hindsight', async () => {
    const h = harness();
    const c = await chartWith(h);
    const { def, seen } = recorder();
    const ind = c.indicators.add(def);
    await settle();
    expect(ind.status).toBe('loaded');
    const lower = c.main!.data;
    const hours = seen[seen.length - 1]!['1h']!;
    // Three hourly bars before the one holding the chart's first bar.
    const holding = Math.floor(lower[0]!.time / HOUR) * HOUR;
    expect(hours.time[0]).toBeLessThanOrEqual(holding - 3 * HOUR);
    expect(hours.time[hours.length - 1]).toBe(Math.floor(lower[lower.length - 1]!.time / HOUR) * HOUR);
    // Each minute sees the hour's close as it stood then: its own close.
    expect([...ind.values.close!]).toEqual(lower.map((b) => b.close));
    // Closed-only values are the previous hour's final close.
    const k = lower.length - 1;
    const prevHourClose = (Math.floor(lower[k]!.time / HOUR) * HOUR - T0) / MINUTE - 1;
    expect(ind.values.closed![k]).toBe(prevHourClose);
  });

  it('updates the forming higher bar on each live bar without refetching', async () => {
    const h = harness();
    const c = await chartWith(h);
    const { def, seen } = recorder();
    const ind = c.indicators.add(def);
    await settle();
    const fetched = h.calls.length;
    const last = c.main!.data[c.main!.data.length - 1]!;
    // A tick on the last minute, then a new minute that starts the next hour.
    h.live[0]!({ ...last, high: 5000, close: 4000 });
    let hours = seen[seen.length - 1]!['1h']!;
    expect(hours.high[hours.length - 1]).toBe(5000);
    expect(hours.close[hours.length - 1]).toBe(4000);
    expect(ind.values.close![ind.values.close!.length - 1]).toBe(4000);
    const nextHour = Math.floor(last.time / HOUR) * HOUR + HOUR;
    h.live[0]!(bar(nextHour, 4100));
    hours = seen[seen.length - 1]!['1h']!;
    expect(hours.time[hours.length - 1]).toBe(nextHour);
    expect(hours.close[hours.length - 1]).toBe(4100);
    // The hour that just closed now shows on closed-only values.
    expect(ind.values.closed![ind.values.closed!.length - 1]).toBe(4000);
    await settle();
    expect(h.calls.length).toBe(fetched);
  });

  it('shows nothing after the replay time from a loaded higher bar the chart starts inside', async () => {
    const h = harness();
    // 19 minutes, all inside the last loaded hour.
    const c = await chartWith(h, '1m', 19);
    const { def, seen } = recorder('1h', 0);
    const ind = c.indicators.add(def);
    await settle();
    const lower = c.main!.data;
    const hour = Math.floor(lower[lower.length - 1]!.time / HOUR) * HOUR;
    expect(lower[0]!.time).toBeGreaterThanOrEqual(hour);
    // Live, the loaded hour keeps its own range.
    const live = seen[seen.length - 1]!['1h']!;
    expect(live.high[live.length - 1]).toBe(2000);
    expect(c.replay.start(lower[5]!.time)).toBe(true);
    const shown = c.main!.data;
    const last = shown[shown.length - 1]!;
    const hours = seen[seen.length - 1]!['1h']!;
    const k = hours.length - 1;
    expect(hours.time[k]).toBe(hour);
    expect(hours.high[k]).toBe(Math.max(...shown.map((b) => b.high)));
    expect(hours.close[k]).toBe(last.close);
    expect(ind.values.close![shown.length - 1]).toBe(last.close);
  });

  it('loads older higher bars as history pages in', async () => {
    const h = harness();
    const c = await chartWith(h, '1m', 150);
    const { def, seen } = recorder('1h', 2);
    c.indicators.add(def);
    await settle();
    const before = seen[seen.length - 1]!['1h']!.time[0]!;
    const fetched = h.calls.length;
    // Four pages of 100 minutes reach well before the loaded hourly bars.
    for (let i = 0; i < 4; i++) await c.data!.loadMore();
    await settle();
    const first = c.main!.data[0]!.time;
    expect(first).toBeLessThan(before);
    expect(h.calls.length).toBeGreaterThan(fetched);
    const hours = seen[seen.length - 1]!['1h']!;
    expect(hours.time[0]).toBeLessThanOrEqual(Math.floor(first / HOUR) * HOUR - 2 * HOUR);
    // Still one bar per hour, ascending.
    for (let i = 1; i < hours.length; i++) expect(hours.time[i]! - hours.time[i - 1]!).toBe(HOUR);
  });

  it('draws nothing and says why while the chart interval is not shorter', async () => {
    const h = harness();
    const c = await chartWith(h, '1h');
    const { def, seen } = recorder();
    const ind = c.indicators.add(def);
    await settle();
    expect(ind.status).toBe('idle');
    expect(ind.message).toBe('Needs a chart interval below 1h');
    expect(seen[seen.length - 1]!['1h']!.length).toBe(0);
    expect(h.calls).toHaveLength(0);
    // Back to minutes: it loads and draws.
    await c.setSymbol('A', '1m');
    await settle();
    expect(ind.status).toBe('loaded');
    expect(ind.message).toBeNull();
    expect(Number.isFinite(ind.values.close![ind.values.close!.length - 1]!)).toBe(true);
  });

  it('reports a failed load and retries on the next data load', async () => {
    const h = harness();
    const history = h.source.history;
    let fail = true;
    h.source.history = async (info, interval, req) => {
      if (interval === '1h' && fail) throw new Error('no hourly bars');
      return history(info, interval, req);
    };
    const c = await chartWith(h);
    const errors: unknown[] = [];
    c.on('indicator:error', ({ error }) => errors.push(error));
    const { def } = recorder();
    const ind = c.indicators.add(def);
    await settle();
    expect(ind.status).toBe('error');
    expect(ind.message).toBe('no hourly bars');
    expect(errors).toHaveLength(1);
    fail = false;
    ind.refetch();
    await settle();
    expect(ind.status).toBe('loaded');
  });

  it("loads another symbol's bars with their warm-up and follows its live bars", async () => {
    const h = harness();
    const c = await chartWith(h);
    const seen: IntervalBars[] = [];
    const def: IndicatorDef = {
      id: 'other-hourly',
      name: 'Other hourly close',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'close', type: 'line' }],
      intervals: () => [{ interval: '1h', symbol: 'B', lookback: 2 }],
      compute(src, _inputs, _data, bars) {
        seen.push(bars);
        const b = bars['B@1h']!;
        return { close: alignSteps(src.time, b.time, b.close) };
      },
    };
    const ind = c.indicators.add(def);
    await settle();
    expect(ind.status).toBe('loaded');
    expect(h.calls.every((call) => call.symbol === 'B')).toBe(true);
    const lower = c.main!.data;
    let hours = seen[seen.length - 1]!['B@1h']!;
    const lastHour = Math.floor(lower[lower.length - 1]!.time / HOUR) * HOUR;
    expect(hours.time[0]).toBeLessThanOrEqual(Math.floor(lower[0]!.time / HOUR) * HOUR - 2 * HOUR);
    // As loaded: the newest hour is B's own, not built from the chart's bars.
    expect(hours.time[hours.length - 1]).toBe(lastHour);
    expect(hours.close[hours.length - 1]).toBe(lower[lower.length - 1]!.close * 10);
    // B's live bars move its newest hour, then start the next one, without refetching.
    expect(h.others).toHaveLength(1);
    const fetched = h.calls.length;
    h.others[0]!.onBar({ time: lastHour, open: 1, high: 99999, low: 0, close: 777 });
    hours = seen[seen.length - 1]!['B@1h']!;
    expect(hours.close[hours.length - 1]).toBe(777);
    expect(ind.values.close![lower.length - 1]).toBe(777);
    h.others[0]!.onBar(bar(lastHour - HOUR, 1)); // older: ignored
    h.live[0]!(bar(lastHour + HOUR, 5));
    h.others[0]!.onBar(bar(lastHour + HOUR, 888));
    hours = seen[seen.length - 1]!['B@1h']!;
    expect(hours.time[hours.length - 1]).toBe(lastHour + HOUR);
    expect(ind.values.close![c.main!.data.length - 1]).toBe(888);
    await settle();
    expect(h.calls.length).toBe(fetched);
    // A switch of the chart's symbol keeps B's bars; removing the indicator stops following them.
    await c.setSymbol('C', '1m');
    await settle();
    expect(h.calls.length).toBe(fetched);
    expect(h.others[0]!.off).toBe(false);
    c.indicators.remove(ind);
    expect(h.others[0]!.off).toBe(true);
  });

  /** An indicator plotting symbol B's hourly close, and the bars it was last given. */
  function otherHourly() {
    const seen: IntervalBars[] = [];
    const def: IndicatorDef = {
      id: 'other-hourly',
      name: 'Other hourly close',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'close', type: 'line' }],
      intervals: () => [{ interval: '1h', symbol: 'B' }],
      compute(src, _inputs, _data, bars) {
        seen.push(bars);
        const b = bars['B@1h']!;
        return { close: alignSteps(src.time, b.time, b.close) };
      },
    };
    return { def, last: () => seen[seen.length - 1]!['B@1h']! };
  }

  it("reloads another symbol's bars when the source resets them", async () => {
    const h = harness();
    const c = await chartWith(h);
    const { def, last } = otherHourly();
    c.indicators.add(def);
    await settle();
    expect(last().close[last().length - 1]).toBe(c.main!.data[c.main!.data.length - 1]!.close * 10);
    const fetched = h.calls.length;
    h.scaleB = 20;
    h.others[0]!.onReset!();
    await settle();
    expect(h.calls.length).toBeGreaterThan(fetched);
    expect(last().close[last().length - 1]).toBe(c.main!.data[c.main!.data.length - 1]!.close * 20);
    // The old stream ended and a new one follows the reloaded bars.
    expect(h.others[0]!.off).toBe(true);
    expect(h.others.filter((s) => !s.off)).toHaveLength(1);
  });

  it('keeps a named symbol apart from the chart when the chart switches to it', async () => {
    const h = harness();
    const c = await chartWith(h);
    const { def, last } = otherHourly();
    c.indicators.add(def);
    await settle();
    await c.setSymbol('B', '1m');
    await settle();
    // Still the streamed entry: its stream keeps writing the newest bar, not the chart's bars.
    expect(h.others.filter((s) => !s.off)).toHaveLength(1);
    const k = last().length - 1;
    h.others.find((s) => !s.off)!.onBar({ time: last().time[k]!, open: 1, high: 99999, low: 0, close: 4321 });
    expect(last().close[k]).toBe(4321);
  });

  it('reports an invalid symbol in an intervals entry', async () => {
    const h = harness();
    const c = await chartWith(h);
    const errors: unknown[] = [];
    c.on('indicator:error', ({ error }) => errors.push(error));
    const { def } = recorder();
    c.indicators.add({ ...def, id: 'bad-symbol', intervals: () => [{ interval: '1h', symbol: '' }], compute: (src) => ({ close: new Float64Array(src.length), closed: new Float64Array(src.length) }) });
    await settle();
    expect(errors.some((e) => /invalid entry/.test(String(e)))).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it('combines intervals with fetched rows', async () => {
    const h = harness();
    const c = await chartWith(h);
    let given: { data: Readonly<Record<string, Float64Array>>; bars: IntervalBars } | null = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const def: IndicatorDef = {
      id: 'mixed',
      name: 'Mixed',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'sum', type: 'line' }],
      fields: ['x'],
      fetch: async ({ from }) => {
        await gate;
        return [[from, 1]];
      },
      intervals: () => [{ interval: '1h' }],
      compute(src, _inputs, data, bars) {
        given = { data, bars };
        const hourly = alignSteps(src.time, bars['1h']!.time, bars['1h']!.close);
        return { sum: hourly.map((v, i) => v + data.x![i]!) };
      },
    };
    const ind = c.indicators.add(def);
    await settle();
    // The bars loaded, the rows not yet: still loading.
    expect(given!.bars['1h']!.length).toBeGreaterThan(0);
    expect(ind.status).toBe('loading');
    release();
    await settle();
    expect(ind.status).toBe('loaded');
    expect(given!.data.x![0]).toBe(1);
    const hours = given!.bars['1h']!;
    const first = c.main!.data[0]!.time;
    expect(ind.values.sum![0]).toBe(alignSteps([first], hours.time, hours.close)[0]! + 1);
    // A refetch reloads both.
    const fetched = h.calls.length;
    ind.refetch();
    await settle();
    expect(h.calls.length).toBeGreaterThan(fetched);
  });
});
