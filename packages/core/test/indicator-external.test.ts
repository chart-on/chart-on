import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { chunkRange, parseRow, RowStore } from '../src/indicators/external';
import type { Indicator } from '../src/indicators/indicator';
import type { BarsReset, DataSource, Interval, SymbolInfo } from '../src/data/types';
import type { IndicatorDef, IndicatorFetchRequest, IndicatorRow, InputValue } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const MINUTE = 60;

/** `count` one-minute bars ending at bar index 999, closes offset by `base`. */
function history(base: number, count = 1000): Bar[] {
  return Array.from({ length: count }, (_, k) => {
    const i = 1000 - count + k;
    const c = base + i;
    return { time: i * MINUTE, open: c, high: c, low: c, close: c };
  });
}

interface LiveFeed {
  symbol: string;
  onBar: (bar: Bar) => void;
  onReset?: () => void;
}

/**
 * A source with symbols A (closes from 0) and B (closes from 5000), paging back
 * `limit` at a time. With `live`, it streams bars through the handlers it collects.
 */
function source(live?: LiveFeed[]): DataSource {
  const series: Record<string, Bar[]> = { A: history(0), B: history(5000) };
  const resets = new Set<(reset: BarsReset) => void>();
  return {
    ...(live && {
      stream: (info: SymbolInfo, interval: Interval, onBar: (bar: Bar) => void) => {
        // The feed's resets go out through the source-level `onReset`.
        const onReset = () => resets.forEach((l) => l({ symbol: info.symbol, interval }));
        live.push({ symbol: info.symbol, onBar, onReset });
        return () => {};
      },
      onReset: (listener: (reset: BarsReset) => void) => {
        resets.add(listener);
        return () => void resets.delete(listener);
      },
    }),
    symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
    search: async () => [],
    history: async (info, _interval, req) => {
      const all = series[info.symbol] ?? [];
      const older = all.filter((b) => (req.to === undefined || b.time < req.to) && (req.from === undefined || b.time >= req.from));
      const page = older.slice(-req.limit);
      return { bars: page, atStart: page.length < req.limit };
    },
  };
}

/** Node's `setImmediate` (the core package does not include Node types). */
const nextTask = (globalThis as unknown as { setImmediate(fn: () => void): void }).setImmediate;

/**
 * Let pending loads finish. Each turn flushes the microtasks; `setImmediate`
 * instead of `setTimeout(0)`, whose timer granularity made a settle cost tens
 * of milliseconds on a loaded machine.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => nextTask(r));
}

async function chart(symbol = 'A', initialBars = 100, live?: LiveFeed[]): Promise<Chart> {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.setDataSource(source(live), { initialBars, pageBars: 100 });
  await c.setSymbol(symbol, '1m');
  return c;
}

type OiInputs = { venue: number; scale: number };

/** Rows `[time, oi]` with oi = venue * 1e6 + symbol offset + bar index. */
function rowsFor(req: IndicatorFetchRequest<OiInputs>): IndicatorRow[] {
  const rows: IndicatorRow[] = [];
  const offset = req.symbol.symbol === 'B' ? 5000 : 0;
  for (let t = Math.ceil(req.from / MINUTE) * MINUTE; t < req.to; t += MINUTE) {
    rows.push([t, req.inputs.venue * 1e6 + offset + t / MINUTE]);
  }
  return rows;
}

function oiDef(overrides: Partial<IndicatorDef<OiInputs>> = {}): IndicatorDef<OiInputs> {
  return {
    id: 'test/open-interest',
    name: 'Open interest',
    placement: 'pane',
    inputs: [
      { id: 'venue', type: 'number', default: 0 },
      { id: 'scale', type: 'number', default: 1 },
    ],
    plots: [{ id: 'oi', type: 'line' }],
    fields: ['oi'],
    compute: (src, { scale }, data) => ({ oi: data.oi!.map((v) => v * scale) }),
    update: (_src, { scale }, i, out, data) => {
      out.oi![i] = data.oi![i]! * scale;
    },
    fetch: async (req) => rowsFor(req),
    refetchOn: { inputs: ['venue'] },
    ...overrides,
  };
}

/** The indicator's value at the bar with `time`. */
function valueAt(c: Chart, indicator: Indicator, time: number): number | undefined {
  const k = c.timeline.times.indexOf(time);
  return indicator.values.oi?.[k];
}

describe('external indicator data', () => {
  it('chunks requests by bars, merges and de-duplicates', () => {
    const times = Array.from({ length: 10 }, (_, i) => i * 60);
    expect(chunkRange(times, 0, 600, 4)).toEqual([
      { from: 0, to: 240, barCount: 4 },
      { from: 240, to: 480, barCount: 4 },
      { from: 480, to: 600, barCount: 2 },
    ]);
    expect(chunkRange(times, 600, 700, 4)).toEqual([]);
    const store = new RowStore();
    store.set(120, Float64Array.of(1));
    store.set(60, Float64Array.of(2));
    store.set(120, Float64Array.of(3));
    expect(store.times()).toEqual([60, 120]);
    expect(store.get(120)).toEqual(Float64Array.of(3));
    expect(parseRow([60, 'x', 2], 2)).toEqual([60, Float64Array.of(NaN, 2)]);
    expect(parseRow(['60', 1], 1)).toBeNull();
  });

  it('fetches the loaded range in parallel chunks and aligns the rows to the bars', async () => {
    const c = await chart();
    const calls: IndicatorFetchRequest<OiInputs>[] = [];
    const ind = c.indicators.add(
      oiDef({
        chunkBars: 30,
        fetch: async (req) => {
          calls.push(req);
          const rows = rowsFor(req);
          // An overlapping duplicate (a later row for the same time wins) and a row outside the range (dropped).
          return [...rows, [req.from, -1], [req.to + 10 * MINUTE, -2]];
        },
      }),
    );
    expect(ind.status).toBe('loading');
    await settle();
    const times = c.timeline.times;
    expect(times).toHaveLength(100);
    expect(calls.map((r) => r.barCount)).toEqual([30, 30, 30, 10]);
    expect(calls[0]!.from).toBe(times[0]);
    expect(calls[1]!.from).toBe(calls[0]!.to);
    expect(calls[3]!.to).toBe(times[99]! + MINUTE);
    expect(calls[0]!.symbol.symbol).toBe('A');
    expect(calls[0]!.interval).toBe('1m');
    expect(ind.status).toBe('loaded');
    expect(valueAt(c, ind, times[0]!)).toBe(-1);
    expect(valueAt(c, ind, times[1]!)).toBe(times[1]! / MINUTE);
    expect(valueAt(c, ind, times[95]!)).toBe(times[95]! / MINUTE);
    expect(ind.values.oi).toHaveLength(100);
  });

  it('discards a fetch answered after a symbol switch', async () => {
    const c = await chart();
    const pending: { req: IndicatorFetchRequest<OiInputs>; resolve: (rows: IndicatorRow[]) => void }[] = [];
    const ind = c.indicators.add(
      oiDef({ fetch: (req) => new Promise((resolve) => pending.push({ req, resolve })) }),
    );
    expect(pending).toHaveLength(1);
    await c.setSymbol('B', '1m');
    expect(pending).toHaveLength(2);
    expect(pending[0]!.req.signal.aborted).toBe(true);
    expect(pending[1]!.req.symbol.symbol).toBe('B');
    pending[1]!.resolve(rowsFor(pending[1]!.req));
    // The stale answer for A arrives last and must not overwrite B's rows.
    pending[0]!.resolve(rowsFor(pending[0]!.req).map(([t]) => [t, -99] as IndicatorRow));
    await settle();
    const last = c.timeline.times.at(-1)!;
    expect(valueAt(c, ind, last)).toBe(5000 + last / MINUTE);
    expect(ind.status).toBe('loaded');
  });

  it('aborts and ignores a fetch on an interval switch, removal or destroy', async () => {
    const c = await chart();
    const pending: { req: IndicatorFetchRequest<OiInputs>; resolve: (rows: IndicatorRow[]) => void }[] = [];
    const def = oiDef({ fetch: (req) => new Promise((resolve) => pending.push({ req, resolve })) });
    const ind = c.indicators.add(def);
    await c.setSymbol('A', '5m');
    expect(pending).toHaveLength(2);
    expect(pending[0]!.req.signal.aborted).toBe(true);
    expect(pending[1]!.req.interval).toBe('5m');
    pending[0]!.resolve(rowsFor(pending[0]!.req));
    await settle();
    expect(ind.status).toBe('loading');

    const statuses: string[] = [];
    c.on('indicator:status', ({ status }) => statuses.push(status));
    ind.remove();
    expect(pending[1]!.req.signal.aborted).toBe(true);
    pending[1]!.resolve(rowsFor(pending[1]!.req));
    await settle();
    expect(statuses).toEqual([]);

    const again = c.indicators.add(def);
    expect(pending).toHaveLength(3);
    const errors: unknown[] = [];
    c.on('indicator:error', ({ error }) => errors.push(error));
    c.destroy();
    expect(pending[2]!.req.signal.aborted).toBe(true);
    pending[2]!.resolve(rowsFor(pending[2]!.req));
    await settle();
    expect(errors).toEqual([]);
    expect(again.values.oi?.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('fetches older rows in step with main history', async () => {
    const c = await chart();
    const calls: IndicatorFetchRequest<OiInputs>[] = [];
    const ind = c.indicators.add(oiDef({ fetch: async (req) => (calls.push(req), rowsFor(req)) }));
    await settle();
    const oldFirst = c.timeline.times[0]!;
    await c.data!.loadMore();
    await settle();
    const first = c.timeline.times[0]!;
    expect(first).toBeLessThan(oldFirst);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ from: first, to: oldFirst, barCount: 100 });
    expect(valueAt(c, ind, first)).toBe(first / MINUTE);
    expect(valueAt(c, ind, oldFirst)).toBe(oldFirst / MINUTE);
  });

  it('refetches only for inputs listed in refetchOn', async () => {
    const c = await chart();
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const ind = c.indicators.add(oiDef({ fetch }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const last = c.timeline.times.at(-1)!;

    ind.applyInputs({ scale: 2 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(valueAt(c, ind, last)).toBe((2 * last) / MINUTE);

    ind.applyInputs({ venue: 1 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0].inputs.venue).toBe(1);
    expect(valueAt(c, ind, last)).toBe(2 * (1e6 + last / MINUTE));
  });

  it('refetches for inputs marked affectsData', async () => {
    const c = await chart();
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const ind = c.indicators.add(
      oiDef({
        fetch,
        refetchOn: undefined,
        inputs: [
          { id: 'venue', type: 'number', default: 0, affectsData: true },
          { id: 'scale', type: 'number', default: 1 },
        ],
      }),
    );
    await settle();
    ind.applyInputs({ scale: 2 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    ind.applyInputs({ venue: 1 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0].inputs.venue).toBe(1);
  });

  it('keeps rows across a symbol switch when refetchOn.symbol is false', async () => {
    const c = await chart();
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const ind = c.indicators.add(oiDef({ fetch, refetchOn: { symbol: false } }));
    await settle();
    await c.setSymbol('B', '1m');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const last = c.timeline.times.at(-1)!;
    expect(valueAt(c, ind, last)).toBe(last / MINUTE);
  });

  it('shows the supports message instead of fetching, and clears it when supported', async () => {
    const c = await chart('B');
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const statuses: [string, string | null][] = [];
    c.on('indicator:status', ({ status, message }) => statuses.push([status, message]));
    const ind = c.indicators.add(
      oiDef({ fetch, supports: ({ symbol }) => (symbol.symbol === 'A' ? true : 'Only for A') }),
    );
    expect(ind.status).toBe('idle');
    expect(ind.message).toBe('Only for A');
    expect(fetch).not.toHaveBeenCalled();
    expect(ind.values.oi!.every(Number.isNaN)).toBe(true);

    await c.setSymbol('A', '1m');
    await settle();
    expect(ind.message).toBeNull();
    expect(ind.status).toBe('loaded');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([
      ['idle', 'Only for A'],
      ['loading', null],
      ['loaded', null],
    ]);

    await c.setSymbol('B', '1m');
    expect(ind.message).toBe('Only for A');
    expect(ind.values.oi!.every(Number.isNaN)).toBe(true);
  });

  it('streams live rows into the last bar and re-subscribes on a switch', async () => {
    const c = await chart();
    const subs: { symbol: string; onRow: (row: IndicatorRow) => void; off: ReturnType<typeof vi.fn> }[] = [];
    const ind = c.indicators.add(
      oiDef({
        subscribe: ({ symbol }, onRow) => {
          const off = vi.fn();
          subs.push({ symbol: symbol.symbol, onRow, off });
          return off;
        },
      }),
    );
    await settle();
    const last = c.timeline.times.at(-1)!;
    subs[0]!.onRow([last + 30, 42]);
    expect(valueAt(c, ind, last)).toBe(42);
    // Rows past the last bar's interval wait for their bar.
    subs[0]!.onRow([last + 2 * MINUTE, 7]);
    expect(valueAt(c, ind, last)).toBe(42);

    await c.setSymbol('B', '1m');
    expect(subs[0]!.off).toHaveBeenCalled();
    expect(subs).toHaveLength(2);
    expect(subs[1]!.symbol).toBe('B');
    // A late row from the old subscription is ignored.
    subs[0]!.onRow([c.timeline.times.at(-1)!, -5]);
    await settle();
    expect(valueAt(c, ind, c.timeline.times.at(-1)!)).not.toBe(-5);

    ind.remove();
    expect(subs[1]!.off).toHaveBeenCalled();
  });

  it('re-aligns the previous bar to rows in a gap when a bar is appended', async () => {
    const live: LiveFeed[] = [];
    const c = await chart('A', 100, live);
    let onRow: ((row: IndicatorRow) => void) | null = null;
    const update = vi.fn<NonNullable<IndicatorDef<OiInputs>['update']>>((_src, { scale }, i, out, data) => {
      out.oi![i] = data.oi![i]! * scale;
    });
    const ind = c.indicators.add(
      oiDef({
        update,
        subscribe: (_ctx, row) => {
          onRow = row;
          return () => {};
        },
      }),
    );
    await settle();
    const last = c.timeline.times.at(-1)!;
    onRow!([last + 30, 42]);
    // In the gap after the last bar's interval: no bar holds it yet.
    onRow!([last + 3 * MINUTE, 7]);
    expect(valueAt(c, ind, last)).toBe(42);

    // A session gap: the next bar opens five intervals later.
    update.mockClear();
    const next = last + 5 * MINUTE;
    live[0]!.onBar({ time: next, open: 1, high: 1, low: 1, close: 1 });
    expect(valueAt(c, ind, last)).toBe(7);
    expect(valueAt(c, ind, next)).toBeNaN();
    expect(update.mock.calls.map((call) => call[2])).toEqual([c.timeline.times.length - 2, c.timeline.times.length - 1]);

    // Without a row in the gap only the new bar is recalculated.
    update.mockClear();
    live[0]!.onBar({ time: next + MINUTE, open: 1, high: 1, low: 1, close: 1 });
    expect(update.mock.calls.map((call) => call[2])).toEqual([c.timeline.times.length - 1]);
  });

  it('reports fetch errors and app errors through status', async () => {
    const c = await chart();
    const errors: unknown[] = [];
    c.on('indicator:error', ({ error }) => errors.push(error));
    const ind = c.indicators.add(
      oiDef({
        fetch: async () => {
          throw new Error('feed down');
        },
      }),
    );
    await settle();
    expect(ind.status).toBe('error');
    expect(ind.message).toBe('feed down');
    expect(errors).toHaveLength(1);

    const plain = c.indicators.add(oiDef({ id: 'test/plain', fetch: async (req) => rowsFor(req) }));
    await settle();
    plain.setError('Upstream quota exceeded');
    expect(plain.status).toBe('error');
    expect(plain.message).toBe('Upstream quota exceeded');
    plain.clearError();
    expect(plain.status).toBe('loaded');
    expect(plain.message).toBeNull();
  });

  it('refetch drops the rows and fetches again', async () => {
    const c = await chart();
    let venueShift = 0;
    const ind = c.indicators.add(
      oiDef({ fetch: async (req) => rowsFor(req).map(([t, v]) => [t, v! + venueShift] as IndicatorRow) }),
    );
    await settle();
    const last = c.timeline.times.at(-1)!;
    venueShift = 3;
    ind.refetch();
    await settle();
    expect(valueAt(c, ind, last)).toBe(last / MINUTE + 3);
  });

  it('gives fetch another symbol’s bars through the data source', async () => {
    const c = await chart();
    const ind = c.indicators.add(
      oiDef({
        fetch: async (req) => (await req.barsOf('B')).map((b): IndicatorRow => [b.time, b.close]),
      }),
    );
    await settle();
    const last = c.timeline.times.at(-1)!;
    expect(valueAt(c, ind, last)).toBe(5000 + last / MINUTE);
  });

  it('drops the rows when the data source is detached', async () => {
    const c = await chart();
    const ind = c.indicators.add(oiDef());
    await settle();
    expect(ind.status).toBe('loaded');
    c.setDataSource(null);
    c.main!.setData(history(0, 50));
    await settle();
    expect(ind.values.oi).toHaveLength(50);
    expect(ind.values.oi!.every(Number.isNaN)).toBe(true);
    expect(ind.status).toBe('idle');
  });

  it('fetches rows for bars appended live when it has no subscription', async () => {
    const live: LiveFeed[] = [];
    const c = await chart('A', 100, live);
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const ind = c.indicators.add(oiDef({ fetch }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const prevTo = fetch.mock.calls[0]![0].to;
    const last = c.timeline.times.at(-1)!;
    // A tick in the last bar fetches nothing.
    live[0]!.onBar({ time: last, open: 1, high: 1, low: 1, close: 1 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const next = last + MINUTE;
    live[0]!.onBar({ time: next, open: 1, high: 1, low: 1, close: 1 });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toMatchObject({ from: prevTo, to: next + MINUTE, barCount: 1 });
    expect(valueAt(c, ind, next)).toBe(next / MINUTE);
    expect(ind.status).toBe('loaded');
  });

  it('refetches the rows when the source resets its bars', async () => {
    const live: LiveFeed[] = [];
    const c = await chart('A', 100, live);
    let shift = 0;
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) =>
      rowsFor(req).map(([t, v]) => [t, v! + shift] as IndicatorRow),
    );
    const ind = c.indicators.add(oiDef({ fetch }));
    await settle();
    shift = 7;
    live[0]!.onReset!();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    const last = c.timeline.times.at(-1)!;
    expect(valueAt(c, ind, last)).toBe(last / MINUTE + 7);
  });

  it('keeps a subscribe failure even when the fetch succeeds', async () => {
    const c = await chart();
    const ind = c.indicators.add(
      oiDef({
        subscribe: () => {
          throw new Error('stream down');
        },
      }),
    );
    await settle();
    expect(ind.status).toBe('error');
    expect(ind.message).toBe('stream down');
  });

  it('keeps a fetch failure until a later fetch covers its range', async () => {
    const c = await chart();
    const pending: { req: IndicatorFetchRequest<OiInputs>; resolve: (rows: IndicatorRow[]) => void; reject: (e: Error) => void }[] = [];
    const ind = c.indicators.add(
      oiDef({ fetch: (req) => new Promise((resolve, reject) => pending.push({ req, resolve, reject })) }),
    );
    await c.data!.loadMore();
    expect(pending).toHaveLength(2);
    pending[0]!.reject(new Error('feed down'));
    await settle();
    // Older history loads fine, but the failed range is still missing.
    pending[1]!.resolve(rowsFor(pending[1]!.req));
    await settle();
    expect(ind.status).toBe('error');
    expect(ind.message).toBe('feed down');
    // The next sync (here: more history) fetches the failed range again.
    await c.data!.loadMore();
    expect(pending).toHaveLength(3);
    expect(pending[2]!.req.from).toBe(c.timeline.times[0]);
    pending[2]!.resolve(rowsFor(pending[2]!.req));
    await settle();
    expect(ind.status).toBe('loaded');
  });

  it('keeps live rows that arrive while a fetch is in flight', async () => {
    const c = await chart();
    const pending: { req: IndicatorFetchRequest<OiInputs>; resolve: (rows: IndicatorRow[]) => void }[] = [];
    let onRow: ((row: IndicatorRow) => void) | null = null;
    const ind = c.indicators.add(
      oiDef({
        fetch: (req) => new Promise((resolve) => pending.push({ req, resolve })),
        subscribe: (_ctx, emit) => {
          onRow = emit;
          return () => {};
        },
      }),
    );
    const last = c.timeline.times.at(-1)!;
    onRow!([last, 42]);
    pending[0]!.resolve(rowsFor(pending[0]!.req));
    await settle();
    expect(valueAt(c, ind, last)).toBe(42);
    expect(valueAt(c, ind, last - MINUTE)).toBe((last - MINUTE) / MINUTE);
  });

  it('re-subscribes on a symbol switch that keeps the rows', async () => {
    const c = await chart();
    const fetch = vi.fn(async (req: IndicatorFetchRequest<OiInputs>) => rowsFor(req));
    const subs: { symbol: string; off: ReturnType<typeof vi.fn> }[] = [];
    const ind = c.indicators.add(
      oiDef({
        fetch,
        refetchOn: { symbol: false },
        subscribe: ({ symbol }) => {
          const off = vi.fn();
          subs.push({ symbol: symbol.symbol, off });
          return off;
        },
      }),
    );
    await settle();
    await c.setSymbol('B', '1m');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(subs.map((s) => s.symbol)).toEqual(['A', 'B']);
    expect(subs[0]!.off).toHaveBeenCalled();
    const last = c.timeline.times.at(-1)!;
    expect(valueAt(c, ind, last)).toBe(last / MINUTE);
  });

  it('releases the subscription when the chart is destroyed', async () => {
    const c = await chart();
    const off = vi.fn();
    c.indicators.add(oiDef({ subscribe: () => off }));
    await settle();
    c.destroy();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('stays idle without a data source', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(history(0, 10));
    const fetch = vi.fn(async () => [] as IndicatorRow[]);
    const ind = c.indicators.add(oiDef({ fetch }));
    expect(ind.status).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates the external-data members', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const bad = (overrides: Partial<IndicatorDef<OiInputs>>) => () =>
      c.indicators.register(oiDef({ id: `test/bad-${Math.random().toString(36).slice(2)}`, ...overrides }));
    expect(bad({ fields: undefined })).toThrow(/needs fields/);
    expect(bad({ fetch: undefined })).toThrow(/fields need fetch or subscribe/);
    expect(bad({ fields: ['a', 'a'] })).toThrow(/unique/);
    expect(bad({ chunkBars: 0 })).toThrow(/chunkBars/);
    expect(bad({ refetchOn: { inputs: ['nope'] } })).toThrow(/unknown input "nope"/);
  });

  it('keeps plain indicators idle and passes them no data', async () => {
    const c = await chart();
    let seen: Record<string, Float64Array> | null = null;
    const ind = c.indicators.add({
      id: 'test/close',
      name: 'Close',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'v', type: 'line' }],
      compute: (src, _inputs: Record<string, InputValue>, data) => {
        seen = { ...data };
        return { v: src.close.slice() };
      },
    });
    expect(ind.status).toBe('idle');
    expect(seen).toEqual({});
  });
});
