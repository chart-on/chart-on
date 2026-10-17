import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError } from '../src/errors';
import { barBucket } from '../src/data/aggregate';
import { snapshotTtl } from '../src/data/cache';
import { createMockDataSource } from '../src/data/adapters';
import { indicatorSetFits } from '../src/indicators/sets';
import {
  calendarMonths,
  intervalRangeOf,
  intervalSeconds,
  isActivityInterval,
  isInterval,
  isTimeInterval,
  nearestInterval,
  parseInterval,
  safeIntervalSeconds,
} from '../src/data/interval';
import type { Interval } from '../src/data/types';

const charts: Chart[] = [];
afterEach(() => {
  for (const c of charts.splice(0)) c.destroy();
});

const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof ChartError ? error.code : 'other';
  }
  return undefined;
};

describe('activity intervals', () => {
  it('parses trade and volume counts, a bare unit counting one', () => {
    expect(parseInterval('100T')).toEqual({ count: 100, unit: 'T' });
    expect(parseInterval('5000V')).toEqual({ count: 5000, unit: 'V' });
    expect(parseInterval('T')).toEqual({ count: 1, unit: 'T' });
    for (const bad of ['0T', '1.5V', 't', 'v', '100 T', 'TV']) expect(isInterval(bad)).toBe(false);
  });

  it('tells activity intervals from time intervals', () => {
    expect(isActivityInterval('100T')).toBe(true);
    expect(isActivityInterval('5000V')).toBe(true);
    expect(isActivityInterval('5s')).toBe(false);
    expect(isActivityInterval('1M')).toBe(false);
    expect(isActivityInterval('nope')).toBe(false);
    expect(isTimeInterval('15m')).toBe(true);
    expect(isTimeInterval('100T')).toBe(false);
    expect(calendarMonths('100T')).toBeNull();
  });

  it('have no length: intervalSeconds throws, safeIntervalSeconds returns null', () => {
    expect(code(() => intervalSeconds('100T'))).toBe('invalid-interval');
    expect(code(() => intervalSeconds('V'))).toBe('invalid-interval');
    expect(safeIntervalSeconds('100T')).toBeNull();
    expect(safeIntervalSeconds('5s')).toBe(5);
  });

  it('never form an interval range or a time bucket', () => {
    expect(intervalRangeOf({ from: '100T', to: '1h' })).toBeNull();
    expect(intervalRangeOf({ from: '1m', to: '5000V' })).toBeNull();
    expect(code(() => barBucket({ interval: '100T' }))).toBe('invalid-interval');
  });

  it('resolve to a listed interval, and are skipped when looking for the nearest time interval', () => {
    expect(nearestInterval('100T', ['1m', '100T'])).toBe('100T');
    expect(nearestInterval('100T', ['1h', '5m'])).toBe('5m');
    expect(nearestInterval('100T', ['5000V'])).toBe('5000V');
    expect(nearestInterval('100T', ['5000V', '50T', '1000T'])).toBe('50T');
    expect(nearestInterval('100T', ['1m', '500T'])).toBe('500T');
    expect(nearestInterval('3m', ['100T', '1m', '5m'])).toBe('5m');
    expect(nearestInterval('1h', ['100T', '5000V'])).toBe('100T');
  });

  it('fit only indicator sets without an interval scope', () => {
    expect(indicatorSetFits({}, '100T')).toBe(true);
    expect(indicatorSetFits({ appliesOn: [{ from: '1m', to: '1d' }] }, '100T')).toBe(false);
    expect(indicatorSetFits({ appliesOn: [{ from: '1m', to: '1d' }] }, '1h')).toBe(true);
    expect(code(() => indicatorSetFits({}, '1x'))).toBe('invalid-interval');
  });

  it('are rejected by the mock data source, which makes time bars', async () => {
    const source = createMockDataSource({ symbols: [{ symbol: 'A', name: 'A' }] });
    const info = await source.symbol('A');
    const request = { kind: 'initial' as const, limit: 5, signal: new AbortController().signal };
    await expect(source.history(info, '100T', request)).rejects.toMatchObject({ code: 'invalid-interval' });
  });

  it('keep a cache snapshot for a fixed window', () => {
    expect(snapshotTtl('100T')).toBe(600);
  });

  it('show no countdown to the bar close', () => {
    const now = Math.floor(Date.now() / 1000);
    const c = new Chart(fakeContainer(), { timezone: 'UTC', features: { countdown: true } });
    charts.push(c);
    c.addCandles({ animate: false }).setData(Array.from({ length: 20 }, (_, i) => ({ time: now - 60 - (19 - i) * 3600, open: 1, high: 1, low: 1, close: 1 })));
    const host = c as unknown as { countdownText(): string | undefined; dataController: unknown };
    expect(host.countdownText()).toBeDefined();
    const interval: Interval = '100T';
    host.dataController = { interval, dispose() {} };
    expect(host.countdownText()).toBeUndefined();
    host.dataController = null;
  });
});
