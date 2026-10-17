import { describe, expect, it } from 'vitest';
import { createMockDataSource, type MockDataSourceOptions } from '../src/data/adapters';
import type { BarsRequest, Interval } from '../src/data/types';
import type { Bar } from '../src/types';

// A Tuesday afternoon, so the current week, day and hour are all partly gone.
const NOW = Date.UTC(2026, 9, 13, 14, 37, 21);
const SYMBOL = { symbol: 'DEMO', name: 'DEMO' };

const req = (limit: number): BarsRequest => ({
  kind: 'initial',
  limit,
  signal: new AbortController().signal,
});

async function bars(interval: Interval, limit: number, options: MockDataSourceOptions = {}): Promise<Bar[]> {
  const source = createMockDataSource({ now: () => NOW, ...options });
  return (await source.history(SYMBOL, interval, req(limit))).bars;
}

/** The aggregate of consecutive bars, as an exchange would build a coarser bar. */
function aggregate(list: Bar[]) {
  return {
    open: list[0]!.open,
    high: Math.max(...list.map((b) => b.high)),
    low: Math.min(...list.map((b) => b.low)),
    close: list[list.length - 1]!.close,
    volume: list.reduce((sum, b) => sum + b.volume!, 0),
    buyVolume: list.reduce((sum, b) => sum + b.buyVolume!, 0),
  };
}

/** Check that `coarse` (one bar) is exactly the aggregate of the `fine` bars inside it. */
function expectAggregate(coarse: Bar, fine: Bar[], length: number) {
  const inside = fine.filter((b) => b.time >= coarse.time && b.time < coarse.time + length);
  expect(inside.length).toBeGreaterThan(0);
  expect(inside[0]!.time).toBe(coarse.time);
  const agg = aggregate(inside);
  expect({ open: coarse.open, high: coarse.high, low: coarse.low, close: coarse.close }).toEqual({
    open: agg.open,
    high: agg.high,
    low: agg.low,
    close: agg.close,
  });
  expect(coarse.volume!).toBeCloseTo(agg.volume, 3);
  expect(coarse.buyVolume!).toBeCloseTo(agg.buyVolume, 3);
}

describe('mock data source prices', () => {
  it('builds a 1h bar from exactly its 1m bars', async () => {
    const minutes = await bars('1m', 600);
    const hours = await bars('1h', 8);
    // Finished hours, and the forming one up to the current second.
    for (const hour of hours.slice(-6)) expectAggregate(hour, minutes, 3600);
  });

  it('agrees across days, weeks and other intervals', async () => {
    const hours = await bars('1h', 24 * 30);
    const days = await bars('1d', 30);
    for (const day of days.slice(-20)) expectAggregate(day, hours, 86400);
    const weeks = await bars('1w', 4);
    for (const week of weeks.slice(-3)) expectAggregate(week, days, 604800);
    const fourHours = await bars('4h', 60);
    for (const bar of fourHours.slice(-30)) expectAggregate(bar, hours, 4 * 3600);
    const fifteen = await bars('15m', 40);
    const minutes = await bars('1m', 600);
    for (const bar of fifteen.slice(-30)) expectAggregate(bar, minutes, 900);
  });

  it('builds calendar bars from the same path, in the symbol timezone', async () => {
    const symbol = { symbol: 'NY', name: 'NY', timezone: 'America/New_York' };
    const source = createMockDataSource({ now: () => NOW, symbols: [symbol] });
    const get = async (interval: Interval, limit: number) => (await source.history(symbol, interval, req(limit))).bars;
    // New York months start at 04:00 or 05:00 UTC, so compare with hours.
    const hours = await get('1h', 24 * 120);
    const months = await get('1M', 4);
    expect(months.at(-1)!.time).toBe(Date.UTC(2026, 9, 1, 4) / 1000);
    for (const month of months.slice(-3)) {
      const next = months.find((m) => m.time > month.time)?.time ?? Infinity;
      expectAggregate(month, hours, Math.min(next, NOW / 1000 + 1) - month.time);
    }
    const quarters = await get('1Q', 8);
    const allMonths = await get('1M', 24);
    for (const quarter of quarters.slice(-6)) {
      const next = quarters.find((q) => q.time > quarter.time)?.time ?? Infinity;
      expectAggregate(quarter, allMonths, Math.min(next, NOW / 1000 + 1) - quarter.time);
    }
    const years = await get('1y', 3);
    const allQuarters = await get('1Q', 12);
    for (const year of years.slice(-2)) {
      const next = years.find((y) => y.time > year.time)?.time ?? Infinity;
      expectAggregate(year, allQuarters, Math.min(next, NOW / 1000 + 1) - year.time);
    }
  });

  it('closes the newest bar at the same price on every interval', async () => {
    const source = createMockDataSource({ now: () => NOW, startPrice: 250 });
    const closes = await Promise.all(
      (['1s', '1m', '5m', '1h', '4h', '1d', '1w', '1M'] as Interval[]).map(
        async (interval) => (await source.history(SYMBOL, interval, req(50))).bars.at(-1)!.close,
      ),
    );
    // The forming bar of every interval ends at the current second of one path.
    expect(new Set(closes).size).toBe(1);
    // startPrice is the price around now, not at the oldest bar.
    expect(closes[0]! / 250).toBeGreaterThan(0.7);
    expect(closes[0]! / 250).toBeLessThan(1.4);
  });

  it('keeps long histories near the start price instead of drifting to zero', async () => {
    const startPrice = 0.008;
    for (const interval of ['1w', '1M', '1y'] as Interval[]) {
      const list = await bars(interval, 12000, { historyBars: 12000, startPrice });
      // Calendar history stops at 1900; 12000 weeks go back about 230 years.
      if (interval === '1w') expect(list).toHaveLength(12000);
      else expect(list[0]!.time).toBe(Date.UTC(1900, 0, 1) / 1000);
      expect(Math.min(...list.map((b) => b.low))).toBeGreaterThan(startPrice / 100);
      expect(Math.max(...list.map((b) => b.high))).toBeLessThan(startPrice * 100);
      for (const b of list) {
        expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
        expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      }
    }
  });

  it('gives the same bars for the same seed, symbol and clock', async () => {
    const a = await bars('1h', 200, { seed: 3 });
    expect(await bars('1h', 200, { seed: 3 })).toEqual(a);
    expect(await bars('1h', 200, { seed: 4 })).not.toEqual(a);
    // The order of requests does not matter: weeks first, then minutes.
    const source = createMockDataSource({ now: () => NOW, seed: 3 });
    await source.history(SYMBOL, '1w', req(500));
    expect((await source.history(SYMBOL, '1h', req(200))).bars).toEqual(a);
  });

  it('gives each symbol its own market', async () => {
    const symbols = [SYMBOL, { symbol: 'OTHER', name: 'OTHER' }];
    const source = createMockDataSource({ now: () => NOW, symbols });
    const a = await source.history(SYMBOL, '1h', req(10));
    const b = await source.history(symbols[1]!, '1h', req(10));
    expect(a.bars.map((x) => x.close)).not.toEqual(b.bars.map((x) => x.close));
  });

  it('moves the forming bar along the path and finishes it when the next opens', async () => {
    let now = NOW;
    const source = createMockDataSource({ now: () => now });
    const first = (await source.history(SYMBOL, '1m', req(5))).bars;
    now += 90_000;
    const later = (await source.history(SYMBOL, '1m', req(5))).bars;
    expect(later.at(-1)!.time).toBe(first.at(-1)!.time + 60);
    // The bar that was forming is now the whole minute, as a fresh source sees it.
    const fresh = (await createMockDataSource({ now: () => now }).history(SYMBOL, '1m', req(5))).bars;
    expect(later).toEqual(fresh);
  });
});
