import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barBucket, createBarBuilder, resampleBars, tradesToBars } from '../src/data/aggregate';
import { createPollingDataSource } from '../src/data/adapters';
import { sliceBars } from '../src/data/util';
import type { BarsRequest, BarsReset, FeedStatus, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';
import { hours } from './sessions';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const NY = 'America/New_York';

describe('barBucket', () => {
  it('puts a time on a bucket edge in the bar that starts there', () => {
    const bucket = barBucket({ interval: '5m' });
    expect(bucket(300)).toBe(300);
    expect(bucket(299.999)).toBe(0);
    expect(bucket(599)).toBe(300);
    expect(barBucket({ interval: '1h' })(utc(2024, 3, 5, 10, 0))).toBe(utc(2024, 3, 5, 10, 0));
  });

  it('starts daily bars at midnight in the timezone, not in UTC', () => {
    const bucket = barBucket({ interval: '1d', timezone: NY });
    // 23:30 in New York on March 5 is already March 6 in UTC.
    expect(bucket(utc(2024, 3, 6, 4, 30))).toBe(utc(2024, 3, 5, 5));
    // Midnight is the first second of the new day.
    expect(bucket(utc(2024, 3, 6, 5))).toBe(utc(2024, 3, 6, 5));
    expect(bucket(utc(2024, 3, 6, 4, 59, 59))).toBe(utc(2024, 3, 5, 5));
    // After the switch to daylight saving time, midnight is 04:00 UTC.
    expect(bucket(utc(2024, 3, 11, 12))).toBe(utc(2024, 3, 11, 4));
    expect(barBucket({ interval: '1d' })(utc(2024, 3, 6, 4, 30))).toBe(utc(2024, 3, 6));
  });

  it('gives an overnight session evening to the next trading day', () => {
    const bucket = barBucket({ interval: '1d', timezone: NY, session: hours([['18:00', '17:00']]) });
    expect(bucket(utc(2024, 3, 5, 23, 30))).toBe(utc(2024, 3, 6, 5)); // 18:30 New York, March 5
    expect(bucket(utc(2024, 3, 5, 21, 30))).toBe(utc(2024, 3, 5, 5)); // 16:30, still March 5
    expect(bucket(utc(2024, 3, 5, 22, 30))).toBeNull(); // 17:30, the daily break
  });

  it('starts weeks on Monday and months on the 1st, in the timezone', () => {
    expect(barBucket({ interval: '1w' })(utc(2024, 3, 6, 12))).toBe(utc(2024, 3, 4));
    expect(barBucket({ interval: '1w' })(utc(2024, 3, 4))).toBe(utc(2024, 3, 4));
    expect(barBucket({ interval: '1w' })(utc(2024, 3, 3, 23, 59))).toBe(utc(2024, 2, 26));
    expect(barBucket({ interval: '1w', timezone: NY })(utc(2024, 3, 4, 2))).toBe(utc(2024, 2, 26, 5));
    const month = barBucket({ interval: '1M', timezone: NY });
    expect(month(utc(2024, 4, 1, 3))).toBe(utc(2024, 3, 1, 5)); // March 31, 23:00 New York
    expect(month(utc(2024, 4, 1, 4))).toBe(utc(2024, 4, 1, 4));
    expect(barBucket({ interval: '1Q' })(utc(2024, 5, 20))).toBe(utc(2024, 4, 1));
  });

  it('aligns intraday bars to the session open and drops times outside it', () => {
    const bucket = barBucket({ interval: '1h', timezone: NY, session: hours([['09:30', '16:00']]) });
    expect(bucket(utc(2024, 3, 5, 14, 30))).toBe(utc(2024, 3, 5, 14, 30)); // 09:30 open
    expect(bucket(utc(2024, 3, 5, 15, 15))).toBe(utc(2024, 3, 5, 14, 30));
    expect(bucket(utc(2024, 3, 5, 20, 45))).toBe(utc(2024, 3, 5, 20, 30)); // the short last hour
    expect(bucket(utc(2024, 3, 5, 21, 5))).toBeNull(); // 16:05
    expect(bucket(utc(2024, 3, 5, 14, 0))).toBeNull(); // 09:00
  });
});

describe('createBarBuilder', () => {
  it('builds OHLCV and buy volume, starting a new bar on the bucket edge', () => {
    const builder = createBarBuilder({ interval: '1m' });
    expect(builder.bar).toBeNull();
    builder.push({ time: 0, price: 10, size: 1, side: 'buy' });
    builder.push({ time: 20, price: 12, size: 2, side: 'sell' });
    expect(builder.push({ time: 59.5, price: 9, size: 3, side: 'buy' })).toEqual({
      time: 0, open: 10, high: 12, low: 9, close: 9, volume: 6, buyVolume: 4,
    });
    expect(builder.push({ time: 60, price: 11, size: 1 })).toEqual({ time: 60, open: 11, high: 11, low: 11, close: 11, volume: 1 });
  });

  it('keeps the open and close of the earliest and latest trades and drops trades for older bars', () => {
    const builder = createBarBuilder({ interval: '1m' });
    builder.push({ time: 70, price: 10 });
    builder.push({ time: 80, price: 11 });
    // Late, but still in this bar: counts for high and low, not the close.
    expect(builder.push({ time: 75, price: 13 })).toEqual({ time: 60, open: 10, high: 13, low: 10, close: 11 });
    // Earlier than the first trade of this bar: becomes the open.
    expect(builder.push({ time: 65, price: 9 })).toEqual({ time: 60, open: 9, high: 13, low: 9, close: 11 });
    expect(builder.push({ time: 30, price: 1 })).toBeNull();
    expect(builder.push({ time: NaN, price: 1 })).toBeNull();
    expect(builder.bar?.close).toBe(11);
    builder.reset();
    expect(builder.bar).toBeNull();
    expect(builder.push({ time: 30, price: 1 })?.time).toBe(0);
  });

  it('returns copies', () => {
    const builder = createBarBuilder({ interval: '1m' });
    const first = builder.push({ time: 0, price: 10 })!;
    builder.push({ time: 1, price: 20 });
    expect(first.close).toBe(10);
  });

  it('builds daily bars per trading day of the session', () => {
    const bars = tradesToBars(
      [
        { time: utc(2024, 3, 5, 23, 30), price: 3 }, // 18:30 on March 5: trading day March 6
        { time: utc(2024, 3, 5, 15), price: 1 },
        { time: utc(2024, 3, 5, 22, 30), price: 99 }, // in the daily break: dropped
        { time: utc(2024, 3, 6, 15), price: 4 },
      ],
      { interval: '1d', timezone: NY, session: hours([['18:00', '17:00']]) },
    );
    expect(bars).toEqual([
      { time: utc(2024, 3, 5, 5), open: 1, high: 1, low: 1, close: 1 },
      { time: utc(2024, 3, 6, 5), open: 3, high: 4, low: 3, close: 4 },
    ]);
  });
});

describe('resampleBars', () => {
  const minute = (time: number, close: number): Bar => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 2 });

  it('builds 5m bars from 1m bars', () => {
    const bars = Array.from({ length: 12 }, (_, i) => minute(i * 60, 10 + i));
    expect(resampleBars(bars, { interval: '5m' })).toEqual([
      { time: 0, open: 10, high: 15, low: 9, close: 14, volume: 10 },
      { time: 300, open: 15, high: 20, low: 14, close: 19, volume: 10 },
      { time: 600, open: 20, high: 22, low: 19, close: 21, volume: 4 },
    ]);
  });

  it('builds daily bars from intraday ones by session', () => {
    const session = hours([['09:30', '16:00']]);
    const bars = [
      minute(utc(2024, 3, 5, 14, 0), 1), // pre-market: dropped
      minute(utc(2024, 3, 5, 14, 30), 2),
      minute(utc(2024, 3, 5, 20, 59), 3),
      minute(utc(2024, 3, 6, 14, 30), 4),
    ];
    expect(resampleBars(bars, { interval: '1d', timezone: NY, session })).toEqual([
      { time: utc(2024, 3, 5, 5), open: 2, high: 4, low: 1, close: 3, volume: 4 },
      { time: utc(2024, 3, 6, 5), open: 4, high: 5, low: 3, close: 4, volume: 2 },
    ]);
  });
});

describe('createPollingDataSource', () => {
  const symbol: SymbolInfo = { symbol: 'X', name: 'X' };
  const b = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close });

  let bars: Bar[];
  let fail: boolean;
  let requests: BarsRequest[];

  beforeEach(() => {
    vi.useFakeTimers();
    bars = [b(0, 10), b(60, 11)];
    fail = false;
    requests = [];
  });
  afterEach(() => vi.useRealTimers());

  function subscribe(limit?: number) {
    const source = createPollingDataSource({
      pollMs: 1000,
      limit,
      history: {
        symbol: async (s) => ({ symbol: s, name: s }),
        search: async () => [],
        history: async (_symbol, _interval, request) => {
          requests.push(request);
          if (fail) throw new Error('offline');
          return sliceBars(bars.map((x) => ({ ...x })), request);
        },
      },
    });
    const got: Bar[] = [];
    const resets: BarsReset[] = [];
    const statuses: FeedStatus['state'][] = [];
    source.onStatus!((s) => statuses.push(s.state));
    source.onReset!((reset) => resets.push(reset));
    const stop = source.stream!(symbol, '1m', (bar) => got.push(bar));
    return { got, resets, statuses, stop };
  }

  it('sends, oldest first, the bars that are new or changed since the last poll', async () => {
    const { got, stop } = subscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([b(0, 10), b(60, 11)]);
    expect(requests[0]).toMatchObject({ kind: 'refresh', limit: 2 });
    // No `from` key at all, so a url() that serializes the whole request sends none.
    expect(new URLSearchParams(Object.entries(requests[0]!).filter(([k]) => k !== 'signal')).toString()).toBe(
      'kind=refresh&limit=2',
    );

    got.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests[1]!.from).toBe(60);
    expect(got).toEqual([]);

    bars[1] = b(60, 12);
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toEqual([b(60, 12)]);

    // The previous bar changed and a new bar opened: the previous one goes first.
    got.length = 0;
    bars[1] = b(60, 13);
    bars.push(b(120, 14));
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toEqual([b(60, 13), b(120, 14)]);

    // An unchanged previous bar is not sent again when a new bar opens.
    got.length = 0;
    bars.push(b(180, 15));
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toEqual([b(180, 15)]);
    stop();
  });

  it('asks the chart to refetch when a poll misses bars', async () => {
    const { got, resets, stop } = subscribe();
    await vi.advanceTimersByTimeAsync(0);
    got.length = 0;
    bars.push(b(120, 1), b(180, 2), b(240, 3));
    await vi.advanceTimersByTimeAsync(1000);
    // The bars still go out; the chart holds them until the gap is refetched.
    expect(got).toEqual([b(180, 2), b(240, 3)]);
    expect(resets).toEqual([{ symbol: 'X', interval: '1m', range: { from: 60 } }]);
    // Polling carries on from the newest bar.
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests[2]!.from).toBe(240);
    stop();
  });

  it('reports failed polls as reconnecting and stops when unsubscribed', async () => {
    const { statuses, stop } = subscribe(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[0]!.limit).toBe(5);
    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
    stop();
    expect(statuses.at(-1)).toBe('disconnected');
    const count = requests.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.length).toBe(count);
  });

  it('aborts a poll in flight when unsubscribed', async () => {
    const { got, stop } = subscribe();
    vi.advanceTimersByTime(0); // starts the first poll without letting it settle
    stop();
    expect(requests[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
  });
});
