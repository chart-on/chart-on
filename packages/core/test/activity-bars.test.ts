import { describe, expect, it } from 'vitest';
import { createBarBuilder, tradesToBars, type TradeTick } from '../src/data/aggregate';
import type { Bar } from '../src/types';

/** Feed trades one by one, as a live stream would, and keep the newest copy of each bar. */
function live(trades: readonly TradeTick[], options: Parameters<typeof createBarBuilder>[0]): Bar[] {
  const builder = createBarBuilder(options);
  const out: Bar[] = [];
  for (const trade of trades) {
    for (const bar of builder.apply(trade)) {
      if (out.length > 0 && out[out.length - 1]!.time === bar.time) out[out.length - 1] = bar;
      else out.push(bar);
    }
  }
  return out;
}

/** A deterministic trade stream: uneven gaps, prices that wander, mixed sides and sizes. */
function stream(n: number): TradeTick[] {
  const trades: TradeTick[] = [];
  let time = 1_700_000_000;
  let price = 100;
  for (let i = 0; i < n; i++) {
    time += (i * 7) % 5 === 0 ? 0 : ((i * 13) % 9) * 0.25;
    price += (((i * 31) % 11) - 5) * 0.1;
    trades.push({ time, price, size: 1 + ((i * 17) % 23) / 4, side: i % 3 === 0 ? 'sell' : 'buy' });
  }
  return trades;
}

describe('tick bars', () => {
  it('starts a new bar after every N trades and leaves the last bar partial', () => {
    const trades: TradeTick[] = [
      { time: 10, price: 5, size: 1, side: 'buy' },
      { time: 11, price: 7, size: 2, side: 'sell' },
      { time: 12, price: 4, size: 1, side: 'buy' },
      { time: 20, price: 6, size: 3 },
      { time: 21, price: 8, size: 1 },
    ];
    expect(tradesToBars(trades, { ticks: 3 })).toEqual([
      { time: 10, open: 5, high: 7, low: 4, close: 4, volume: 4, buyVolume: 2, startTime: 10, endTime: 12 },
      { time: 20, open: 6, high: 8, low: 6, close: 8, volume: 4, startTime: 20, endTime: 21 },
    ]);
  });

  it('builds one bar per trade with ticks: 1 and has no volume without sizes', () => {
    const bars = tradesToBars([{ time: 1, price: 2 }, { time: 3, price: 4 }], { ticks: 1 });
    expect(bars).toEqual([
      { time: 1, open: 2, high: 2, low: 2, close: 2, startTime: 1, endTime: 1 },
      { time: 3, open: 4, high: 4, low: 4, close: 4, startTime: 3, endTime: 3 },
    ]);
  });

  it('keeps bar times increasing when trades share a time', () => {
    const trades = Array.from({ length: 6 }, (_, i): TradeTick => ({ time: 50, price: 10 + i }));
    const bars = tradesToBars(trades, { ticks: 2, minGap: 0.5 });
    expect(bars.map((b) => b.time)).toEqual([50, 50.5, 51]);
    expect(bars.map((b) => b.startTime)).toEqual([50, 50, 50]);
  });

  it('counts trades in arrival order but keeps the open and close by time', () => {
    const builder = createBarBuilder({ ticks: 3 });
    builder.push({ time: 10, price: 1 });
    builder.push({ time: 12, price: 3 });
    expect(builder.push({ time: 11, price: 2 })).toEqual({
      time: 10, open: 1, high: 3, low: 1, close: 3, startTime: 10, endTime: 12,
    });
    expect(builder.push({ time: 13, price: 4 })?.time).toBe(13);
  });
});

describe('volume bars', () => {
  it('closes a bar when its volume is reached exactly', () => {
    const bars = tradesToBars(
      [
        { time: 1, price: 10, size: 4 },
        { time: 2, price: 11, size: 6 },
        { time: 3, price: 12, size: 1 },
      ],
      { volume: 10 },
    );
    expect(bars).toEqual([
      { time: 1, open: 10, high: 11, low: 10, close: 11, volume: 10, startTime: 1, endTime: 2 },
      { time: 3, open: 12, high: 12, low: 12, close: 12, volume: 1, startTime: 3, endTime: 3 },
    ]);
  });

  it('splits a trade that would overfill a bar across the next bars', () => {
    const builder = createBarBuilder({ volume: 10, minGap: 0.5 });
    builder.push({ time: 1, price: 10, size: 7, side: 'buy' });
    const changed = builder.apply({ time: 2, price: 12, size: 26, side: 'buy' });
    expect(changed).toEqual([
      { time: 1, open: 10, high: 12, low: 10, close: 12, volume: 10, buyVolume: 10, startTime: 1, endTime: 2 },
      { time: 2, open: 12, high: 12, low: 12, close: 12, volume: 10, buyVolume: 10, startTime: 2, endTime: 2 },
      { time: 2.5, open: 12, high: 12, low: 12, close: 12, volume: 10, buyVolume: 10, startTime: 2, endTime: 2 },
      { time: 3, open: 12, high: 12, low: 12, close: 12, volume: 3, buyVolume: 3, startTime: 2, endTime: 2 },
    ]);
    // `push` returns the newest bar; the next trade continues the partial one.
    expect(builder.push({ time: 3, price: 9, size: 2, side: 'sell' })).toEqual({
      time: 3, open: 12, high: 12, low: 9, close: 9, volume: 5, buyVolume: 3, startTime: 2, endTime: 3,
    });
  });

  it('counts sell-side volume of a split trade only in volume', () => {
    const bars = tradesToBars([{ time: 1, price: 1, size: 15, side: 'sell' }], { volume: 10 });
    expect(bars.map((b) => [b.volume, b.buyVolume])).toEqual([[10, 0], [5, 0]]);
  });

  it('adds trades without a size to the price but not the volume', () => {
    const bars = tradesToBars([{ time: 1, price: 5 }, { time: 2, price: 9 }, { time: 3, price: 7, size: 10 }], { volume: 10 });
    expect(bars).toEqual([{ time: 1, open: 5, high: 9, low: 5, close: 7, volume: 10, startTime: 1, endTime: 3 }]);
  });

  it('conserves total volume and buy volume, including split and nearly exact trades', () => {
    let seed = 442;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trades: TradeTick[] = Array.from({ length: 2000 }, (_, i) => ({
      time: 1000 + i * 0.5,
      price: 50 + rand(),
      // Mostly small fractional sizes, some trades many bars large, some just past a whole bar.
      size: i % 97 === 0 ? 10 + 1e-12 : i % 41 === 0 ? 250 * rand() : rand() * 3,
      side: rand() < 0.5 ? 'buy' : 'sell',
    }));
    const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
    const inVolume = sum(trades.map((t) => t.size!));
    const inBuy = sum(trades.filter((t) => t.side === 'buy').map((t) => t.size!));
    for (const volume of [10, 0.7, 33.3]) {
      const bars = tradesToBars(trades, { volume });
      expect(sum(bars.map((b) => b.volume!))).toBeCloseTo(inVolume, 6);
      expect(sum(bars.map((b) => b.buyVolume!))).toBeCloseTo(inBuy, 6);
      for (const b of bars.slice(0, -1)) expect(b.volume).toBeCloseTo(volume, 9);
      expect(bars[bars.length - 1]!.volume).toBeLessThanOrEqual(volume * (1 + 1e-9));
    }
  });

  it('keeps a remainder within rounding error in the bar instead of dropping it', () => {
    const bars = tradesToBars([{ time: 1, price: 1, size: 10 + 1e-10 }], { volume: 10 });
    expect(bars).toHaveLength(1);
    expect(bars[0]!.volume).toBe(10 + 1e-10);
  });

  it('caps the bars one trade can fill', () => {
    const bars = tradesToBars([{ time: 1, price: 1, size: 1e9 }], { volume: 1 });
    expect(bars).toHaveLength(10000);
    expect(bars[bars.length - 1]!.volume).toBeCloseTo(1e9 - 9999);
  });
});

describe('activity bars', () => {
  it('build the same bars live as in a batch', () => {
    const trades = stream(500);
    for (const options of [{ ticks: 7 }, { volume: 25 }, { volume: 3.3 }]) {
      const batch = tradesToBars(trades, options);
      expect(batch.length).toBeGreaterThan(10);
      expect(live(trades, options)).toEqual(batch);
      // Every bar but the last is complete.
      if ('volume' in options) {
        for (const b of batch.slice(0, -1)) expect(b.volume).toBeCloseTo(options.volume!, 9);
      }
      for (let i = 1; i < batch.length; i++) expect(batch[i]!.time).toBeGreaterThan(batch[i - 1]!.time);
    }
  });

  it('drops invalid trades, returns copies and resets', () => {
    const builder = createBarBuilder({ ticks: 2 });
    expect(builder.push({ time: NaN, price: 1 })).toBeNull();
    expect(builder.apply({ time: 1, price: Infinity })).toEqual([]);
    const first = builder.push({ time: 1, price: 1 })!;
    builder.push({ time: 2, price: 5 });
    expect(first.close).toBe(1);
    expect(builder.bar?.close).toBe(5);
    builder.reset();
    expect(builder.bar).toBeNull();
    expect(builder.push({ time: 3, price: 2 })?.startTime).toBe(3);
  });

  it('reject options that are not one positive count', () => {
    expect(() => createBarBuilder({})).toThrow(RangeError);
    expect(() => createBarBuilder({ ticks: 2, volume: 5 })).toThrow(RangeError);
    expect(() => createBarBuilder({ ticks: 1.5 })).toThrow(RangeError);
    expect(() => createBarBuilder({ ticks: 0 })).toThrow(RangeError);
    expect(() => createBarBuilder({ volume: -1 })).toThrow(RangeError);
    expect(() => createBarBuilder({ volume: 1, minGap: 0 })).toThrow(RangeError);
  });
});

describe('second bars', () => {
  it.each([
    ['1s', 1],
    ['5s', 5],
    ['15s', 15],
    ['30s', 30],
  ] as const)('buckets %s bars on multiples of their length', (interval, length) => {
    const trades = stream(400);
    const bars = tradesToBars(trades, { interval });
    expect(bars.length).toBeGreaterThan(1);
    for (const b of bars) expect(b.time % length).toBe(0);
    expect(bars.reduce((sum, b) => sum + b.volume!, 0)).toBeCloseTo(trades.reduce((sum, t) => sum + t.size!, 0), 6);
    expect(live(trades, { interval })).toEqual(bars);
  });

  it('starts a 5s bar on its edge and keeps a partial last bar', () => {
    const bars = tradesToBars(
      [
        { time: 100.2, price: 1 },
        { time: 104.9, price: 2 },
        { time: 105, price: 3 },
      ],
      { interval: '5s' },
    );
    expect(bars).toEqual([
      { time: 100, open: 1, high: 2, low: 1, close: 2 },
      { time: 105, open: 3, high: 3, low: 3, close: 3 },
    ]);
  });
});
