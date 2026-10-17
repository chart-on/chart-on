import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOhlcvDataSource, type OhlcvExchange, type OhlcvMarket } from '../src/data/ohlcv';
import { testDataSource } from '../src/data/conformance';
import { ChartError } from '../src/errors';
import type { BarsRequest, DataSource, FeedStatus, ResetRange, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const MINUTE = 60_000;
type Row = [number, number, number, number, number, number];
const row = (ms: number, close: number, volume = 10): Row => [ms, close, close + 1, close - 1, close, volume];

const MARKETS: OhlcvMarket[] = [
  { symbol: 'AAA/USD', base: 'AAA', quote: 'USD', type: 'spot', active: true, precision: { price: 0.01 } },
  { symbol: 'BBB/USD:USD', base: 'BBB', quote: 'USD', type: 'swap', precision: { price: 3 } },
  { symbol: 'OLD/USD', base: 'OLD', quote: 'USD', type: 'spot', active: false, precision: { price: 0.5 } },
];

interface Call {
  symbol: string;
  timeframe: string;
  since: number | undefined;
  limit: number | undefined;
}

/** An exchange object over `rows` (oldest first); `cap` is the venue's own per-request maximum. */
function fakeExchange(rows: Row[], extra: Partial<OhlcvExchange> & { cap?: number } = {}) {
  const calls: Call[] = [];
  const { cap = Infinity, ...members } = extra;
  const exchange: OhlcvExchange = {
    name: 'Test venue',
    timeframes: { '1m': '1', '1h': '60', '1d': 'D', '1w': 'W', '1M': 'M', weird: 'x' },
    loadMarkets: async () => Object.fromEntries(MARKETS.map((m) => [m.symbol, m])),
    async fetchOHLCV(symbol, timeframe, since, limit) {
      calls.push({ symbol, timeframe, since, limit });
      const n = Math.min(limit ?? 100, cap);
      if (since === undefined) return rows.slice(-n);
      return rows.filter((r) => r[0] >= since).slice(0, n);
    },
    ...members,
  };
  return { exchange, calls };
}

/** Minute rows ending with the bar forming now. */
function minuteRows(count: number): Row[] {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  return Array.from({ length: count }, (_, i) => row(now - (count - 1 - i) * MINUTE, 100 + i));
}

const request = (fields: Partial<BarsRequest>): BarsRequest => ({
  kind: 'history',
  limit: 100,
  signal: new AbortController().signal,
  ...fields,
});

const info = async (source: DataSource, symbol = 'AAA/USD') => source.symbol(symbol);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createOhlcvDataSource history', () => {
  it('pages forward over several requests, in seconds, never above the per-request maximum', async () => {
    const rows = minuteRows(3000);
    const { exchange, calls } = fakeExchange(rows);
    const source = createOhlcvDataSource(exchange, { maxBarsPerRequest: 500 });
    const result = await source.history(await info(source), '1m', request({ kind: 'initial', limit: 1200 }));
    expect(result.bars).toHaveLength(1200);
    expect(result.atStart).toBe(false);
    expect(result.bars.at(-1)!.time).toBe(rows.at(-1)![0] / 1000);
    expect(result.bars[0]!.time).toBe(rows[1800]![0] / 1000);
    expect(result.bars.every((b, i) => i === 0 || b.time - result.bars[i - 1]!.time === 60)).toBe(true);
    expect(result.bars[0]).toEqual({ time: rows[1800]![0] / 1000, open: 1900, high: 1901, low: 1899, close: 1900, volume: 10 });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.symbol === 'AAA/USD' && c.timeframe === '1m' && c.limit! <= 500)).toBe(true);
    expect(calls.every((c) => Number.isInteger(c.since! / 1000))).toBe(true);
  });

  it('rejects trade and volume intervals with an invalid-interval ChartError', async () => {
    const { exchange, calls } = fakeExchange(minuteRows(10));
    const source = createOhlcvDataSource(exchange);
    await expect(source.history(await info(source), '100T', request({ kind: 'initial', limit: 5 }))).rejects.toMatchObject({
      code: 'invalid-interval',
    });
    expect(calls).toHaveLength(0);
  });

  it('keeps paging when the venue caps rows below the maximum', async () => {
    const rows = minuteRows(3000);
    const { exchange, calls } = fakeExchange(rows, { cap: 100 });
    const source = createOhlcvDataSource(exchange);
    const result = await source.history(await info(source), '1m', request({ kind: 'initial', limit: 450 }));
    expect(result.bars).toHaveLength(450);
    expect(result.bars.at(-1)!.time).toBe(rows.at(-1)![0] / 1000);
    expect(calls.length).toBe(5);
  });

  it('trims to `to` (exclusive) and `from` (inclusive)', async () => {
    const rows = minuteRows(3000);
    const { exchange } = fakeExchange(rows);
    const source = createOhlcvDataSource(exchange);
    const symbol = await info(source);
    const t = (i: number) => rows[i]![0] / 1000;

    const page = await source.history(symbol, '1m', request({ to: t(2000), limit: 100 }));
    expect(page.bars.map((b) => b.time)).toEqual(rows.slice(1900, 2000).map((r) => r[0] / 1000));

    const ranged = await source.history(symbol, '1m', request({ from: t(1950), to: t(2000), limit: 100 }));
    expect(ranged.bars).toHaveLength(50);
    expect(ranged.bars[0]!.time).toBe(t(1950));
    expect(ranged.atStart).toBe(false);

    const refresh = await source.history(symbol, '1m', request({ kind: 'refresh', from: t(2990), limit: 100 }));
    expect(refresh.bars.map((b) => b.time)).toEqual(rows.slice(2990).map((r) => r[0] / 1000));
  });

  it('reports atStart once the venue has nothing older', async () => {
    const rows = minuteRows(300);
    const { exchange } = fakeExchange(rows);
    const source = createOhlcvDataSource(exchange);
    const symbol = await info(source);
    const partial = await source.history(symbol, '1m', request({ to: rows[50]![0] / 1000, limit: 100 }));
    expect(partial.bars).toHaveLength(50);
    expect(partial.atStart).toBe(false);
    const empty = await source.history(symbol, '1m', request({ to: rows[0]![0] / 1000, limit: 100 }));
    expect(empty).toEqual({ bars: [], atStart: true });
  });

  it('passes the chart conformance check', async () => {
    const { exchange } = fakeExchange(minuteRows(400));
    const source = createOhlcvDataSource(exchange, { maxBarsPerRequest: 30 });
    expect(await testDataSource(source, { symbol: 'AAA/USD', interval: '1m', limit: 50 })).toEqual([]);
  });

  it('honours an aborted signal before and between pages', async () => {
    const rows = minuteRows(3000);
    const { exchange, calls } = fakeExchange(rows);
    const source = createOhlcvDataSource(exchange, { maxBarsPerRequest: 100 });
    const symbol = await info(source);

    const before = new AbortController();
    before.abort();
    await expect(source.history(symbol, '1m', request({ signal: before.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(0);

    const during = new AbortController();
    const fetch = exchange.fetchOHLCV.bind(exchange);
    exchange.fetchOHLCV = async (...args) => {
      const result = await fetch(...args);
      during.abort();
      return result;
    };
    await expect(source.history(symbol, '1m', request({ limit: 1000, signal: during.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('passes data source errors through', async () => {
    const { exchange } = fakeExchange([], {
      fetchOHLCV: async () => {
        throw new Error('rate limited');
      },
    });
    const source = createOhlcvDataSource(exchange);
    await expect(source.history(await info(source), '1m', request({}))).rejects.toThrow('rate limited');
  });

  it('skips entries that are not rows and leaves bars with missing prices for the chart to drop', async () => {
    const rows = minuteRows(3);
    const junk = [rows[0], 'junk', [rows[1]![0], null, 1, 1, 1], rows[2]] as unknown as Row[];
    const { exchange } = fakeExchange(junk);
    const source = createOhlcvDataSource(exchange);
    const { bars } = await source.history(await info(source), '1m', request({ kind: 'initial', limit: 10 }));
    expect(bars.map((b) => b.time)).toEqual(rows.map((r) => r[0] / 1000));
    expect(bars[1]!.open).toBeNaN();
    expect(bars[1]!.volume).toBeUndefined();

    const { exchange: broken } = fakeExchange([], { fetchOHLCV: async () => ({}) as unknown as Row[] });
    const symbol = await info(source);
    await expect(createOhlcvDataSource(broken).history(symbol, '1m', request({}))).rejects.toThrow('list of OHLCV rows');
  });
});

describe('createOhlcvDataSource intervals and symbols', () => {
  it('lists only the timeframes the exchange has and maps equal intervals onto them', async () => {
    const { exchange, calls } = fakeExchange(minuteRows(10));
    const source = createOhlcvDataSource(exchange);
    const symbol = await info(source);
    expect(symbol.intervals).toEqual(['1m', '1h', '1d', '1w', '1M']);

    await source.history(symbol, '60m', request({ limit: 2 }));
    expect(calls.at(-1)!.timeframe).toBe('1h');
    await source.history(symbol, '7d', request({ limit: 2 }));
    expect(calls.at(-1)!.timeframe).toBe('1w');

    const unsupported = source.history(symbol, '2h', request({}));
    await expect(unsupported).rejects.toBeInstanceOf(ChartError);
    await expect(unsupported).rejects.toMatchObject({ code: 'invalid-interval' });
    // A calendar month is not 30 fixed days.
    await expect(source.history(symbol, '30d', request({}))).rejects.toMatchObject({ code: 'invalid-interval' });
  });

  it('passes any interval through when the exchange lists no timeframes', async () => {
    const { exchange, calls } = fakeExchange(minuteRows(10), { timeframes: undefined });
    const source = createOhlcvDataSource(exchange);
    const symbol = await info(source);
    expect(symbol.intervals).toBeUndefined();
    await source.history(symbol, '3m', request({ limit: 2 }));
    expect(calls.at(-1)!.timeframe).toBe('3m');
  });

  it('builds symbols from markets: precision, tick size, type and search', async () => {
    let loads = 0;
    const { exchange } = fakeExchange([], {
      loadMarkets: async () => {
        if (loads++ === 0) throw new Error('offline');
        return MARKETS;
      },
    });
    const source = createOhlcvDataSource(exchange);
    await expect(source.symbol('AAA/USD')).rejects.toThrow('offline');

    const spot = await source.symbol('AAA/USD');
    expect(spot).toMatchObject({ symbol: 'AAA/USD', name: 'AAA/USD', type: 'spot', tickSize: 0.01, exchange: 'Test venue' });
    expect(spot.precision).toBeUndefined();
    expect(spot.description).toBe('AAA/USD spot');

    const perpetual = await source.symbol('BBB/USD:USD');
    expect(perpetual).toMatchObject({ type: 'perpetual', precision: 3, description: 'BBB/USD perpetual' });
    expect(perpetual.tickSize).toBeUndefined();

    await expect(source.symbol('NOPE/USD')).rejects.toThrow('Unknown symbol');
    expect((await source.search('usd')).map((s) => s.symbol)).toEqual(['AAA/USD', 'BBB/USD:USD']);
    expect((await source.symbol('OLD/USD')).tickSize).toBe(0.5);
    await source.search('a');
    expect(loads).toBe(2);
  });

  it('skips empty market entries, as libraries type their market map', async () => {
    const { exchange } = fakeExchange([], {
      loadMarkets: async () => ({ 'AAA/USD': { symbol: 'AAA/USD', active: true }, 'GONE/USD': undefined }),
    });
    const source = createOhlcvDataSource(exchange);
    expect((await source.search('')).map((s) => s.symbol)).toEqual(['AAA/USD']);
    await expect(source.symbol('GONE/USD')).rejects.toThrow('Unknown symbol');
  });

  it('reads whole precisions as tick sizes when told to, and lets the app adjust symbols', async () => {
    const { exchange } = fakeExchange([], { loadMarkets: async () => [{ symbol: 'IDX', precision: { price: 5 } }] });
    const source = createOhlcvDataSource(exchange, {
      pricePrecision: 'tickSize',
      symbolInfo: (market, symbol): SymbolInfo => ({ ...symbol, timezone: 'UTC', description: `Index ${market.symbol}` }),
    });
    expect(await source.symbol('IDX')).toMatchObject({ tickSize: 5, timezone: 'UTC', description: 'Index IDX' });
  });
});

/** Promises the test settles one by one, standing in for a stream. */
function streamQueue() {
  const pending: ((rows: Row[]) => void)[] = [];
  const failing: ((error: Error) => void)[] = [];
  const watch = vi.fn(
    () =>
      new Promise<Row[]>((resolve, reject) => {
        pending.push(resolve);
        failing.push(reject);
      }),
  );
  return {
    watch,
    /** Settle the pending read with `rows`, then let the adapter start the next read. */
    push: async (rows: Row[]) => {
      failing.shift();
      pending.shift()!(rows);
      await vi.advanceTimersByTimeAsync(1);
    },
    fail: async () => {
      pending.shift();
      failing.shift()!(new Error('socket closed'));
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

function collect() {
  const bars: Bar[] = [];
  const resets: (ResetRange | undefined)[] = [];
  return { bars, resets, onBar: (bar: Bar) => bars.push(bar), onReset: (range?: ResetRange) => resets.push(range) };
}

describe('createOhlcvDataSource live bars', () => {
  it('streams new and changed bars, a changed previous bar before the new one', async () => {
    vi.useFakeTimers();
    const stream = streamQueue();
    const { exchange, calls } = fakeExchange([], { watchOHLCV: stream.watch });
    const source = createOhlcvDataSource(exchange);
    const out = collect();
    const statuses: FeedStatus['state'][] = [];
    source.onStatus!((s) => statuses.push(s.state));
    source.onReset!((reset) => out.onReset(reset.range));
    const stop = source.stream!(await info(source), '1m', out.onBar);
    const t = 1_700_000_040_000;

    await stream.push([row(t - MINUTE, 1), row(t, 2)]);
    expect(out.bars).toEqual([{ time: t / 1000, open: 2, high: 3, low: 1, close: 2, volume: 10 }]);
    await stream.push([row(t - MINUTE, 1), row(t, 2)]);
    expect(out.bars).toHaveLength(1);
    await stream.push([row(t, 3)]);
    expect(out.bars.at(-1)!.close).toBe(3);
    await stream.push([row(t, 4, 12), row(t + MINUTE, 5)]);
    expect(out.bars.slice(-2).map((b) => [b.time, b.close, b.volume])).toEqual([
      [t / 1000, 4, 12],
      [t / 1000 + 60, 5, 10],
    ]);
    expect(out.resets).toEqual([]);

    // The read skipped the bar at t + 1 min: the chart refetches from it.
    await stream.push([row(t + 3 * MINUTE, 6)]);
    expect(out.resets).toEqual([{ from: t / 1000 + 60 }]);
    expect(out.bars.at(-1)!.time).toBe(t / 1000 + 180);

    expect(statuses).toEqual(['connected']);
    expect(calls).toHaveLength(0);
    stop();
    expect(statuses).toEqual(['connected', 'disconnected']);
  });

  it('backs off after a failed read and reports the outage', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const stream = streamQueue();
    const unwatch = vi.fn(async () => {});
    const { exchange } = fakeExchange([], { watchOHLCV: stream.watch, unWatchOHLCV: unwatch });
    const source = createOhlcvDataSource(exchange, { reconnect: { minMs: 1000, maxMs: 4000 } });
    const statuses: FeedStatus['state'][] = [];
    source.onStatus!((s) => statuses.push(s.state));
    const out = collect();
    source.onReset!((reset) => out.onReset(reset.range));
    const stop = source.stream!(await info(source), '1m', out.onBar);

    await stream.fail();
    expect(statuses).toEqual(['reconnecting']);
    expect(stream.watch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(stream.watch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.watch).toHaveBeenCalledTimes(2);

    await stream.fail();
    await vi.advanceTimersByTimeAsync(1999);
    expect(stream.watch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.watch).toHaveBeenCalledTimes(3);

    await stream.push([row(1_700_000_040_000, 1)]);
    expect(statuses).toEqual(['reconnecting', 'connected']);
    expect(out.bars).toHaveLength(1);
    stop();
    expect(unwatch).toHaveBeenCalledWith('AAA/USD', '1m');
  });

  it('polls the newest rows when the exchange has no stream, re-sending the finished bar', async () => {
    vi.useFakeTimers();
    const t = 1_700_000_040_000;
    const rows: Row[] = [row(t - MINUTE, 1), row(t, 2)];
    const { exchange, calls } = fakeExchange(rows, {
      // Present but flagged unsupported, as libraries that define every method do.
      watchOHLCV: async () => [],
      has: { watchOHLCV: false },
    });
    const source = createOhlcvDataSource(exchange, { pollMs: 1000 });
    const out = collect();
    source.onReset!((reset) => out.onReset(reset.range));
    const stop = source.stream!(await info(source), '1m', out.onBar);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ symbol: 'AAA/USD', timeframe: '1m', since: undefined, limit: 2 }]);
    expect(out.bars.map((b) => b.close)).toEqual([2]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(out.bars).toHaveLength(1);

    rows[1] = row(t, 3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.bars.map((b) => b.close)).toEqual([2, 3]);

    // Trades landed in the bar at t after the last poll, then a new bar started.
    rows[1] = row(t, 4);
    rows.push(row(t + MINUTE, 5));
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.bars.map((b) => [b.time, b.close])).toEqual([
      [t / 1000, 2],
      [t / 1000, 3],
      [t / 1000, 4],
      [t / 1000 + 60, 5],
    ]);
    expect(out.resets).toEqual([]);

    stop();
    const count = calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(count);
  });

  it('builds its own bars, so a library updating its rows in place changes no bar the chart holds', async () => {
    vi.useFakeTimers();
    const t = 1_700_000_040_000;
    const rows: Row[] = [row(t, 2)];
    const { exchange } = fakeExchange(rows);
    const source = createOhlcvDataSource(exchange, { pollMs: 1000 });
    const out = collect();
    const stop = source.stream!(await info(source), '1m', out.onBar);
    await vi.advanceTimersByTimeAsync(0);
    const sent = { time: t / 1000, open: 2, high: 3, low: 1, close: 2, volume: 10 };
    expect(out.bars).toEqual([sent]);

    // The library reuses the row it returned and writes the next trade into it.
    rows[0]![2] = 4;
    rows[0]![4] = 4;
    expect(out.bars).toEqual([sent]);
    // The next read compares against the bar sent, not the changed row, so the change goes out.
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.bars.map((b) => [b.high, b.close])).toEqual([
      [3, 2],
      [4, 4],
    ]);
    stop();
  });

  it('ignores a read that lands after unsubscribing', async () => {
    vi.useFakeTimers();
    const stream = streamQueue();
    const { exchange } = fakeExchange([], { watchOHLCV: stream.watch });
    const source = createOhlcvDataSource(exchange);
    const out = collect();
    source.onReset!((reset) => out.onReset(reset.range));
    const stop = source.stream!(await info(source), '1m', out.onBar);
    stop();
    await stream.push([row(1_700_000_040_000, 1)]);
    expect(out.bars).toEqual([]);
    expect(stream.watch).toHaveBeenCalledTimes(1);
  });
});
