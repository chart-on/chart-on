import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError } from '../src/errors';
import { DataController, type DataTarget } from '../src/data/controller';
import { createMockDataSource } from '../src/data/adapters';
import {
  calendarMonths,
  intervalSeconds,
  intervalStart,
  isCalendarInterval,
  isInterval,
  nearestInterval,
  nextIntervalStart,
  parseInterval,
} from '../src/data/interval';
import type { BarsRequest, DataEvents, DataSource, Interval, SymbolInfo } from '../src/data/types';
import { zoneOf } from '../src/util/timezone';
import type { Bar } from '../src/types';

const DAY = 86400;
const utc = (y: number, m: number, d = 1, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;
const bar = (time: number, close = 10): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('interval parsing', () => {
  it('parses counts and units, a bare unit counting one', () => {
    expect(parseInterval('15m')).toEqual({ count: 15, unit: 'm' });
    expect(parseInterval('d')).toEqual({ count: 1, unit: 'd' });
    expect(parseInterval('2Q')).toEqual({ count: 2, unit: 'Q' });
    expect(intervalSeconds('1Q')).toBe(90 * DAY);
    expect(intervalSeconds('y')).toBe(365 * DAY);
    expect(intervalSeconds('1M')).toBe(30 * DAY);
  });

  it('rejects anything else with an invalid-interval ChartError', () => {
    for (const bad of ['1x', '0m', '1.5h', '-1m', '', 'm1', '1 m', '1Y']) {
      expect(isInterval(bad)).toBe(false);
      try {
        parseInterval(bad);
        expect.unreachable(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(ChartError);
        expect((error as ChartError).code).toBe('invalid-interval');
      }
    }
    expect(isInterval(5)).toBe(false);
    expect(isInterval('4h')).toBe(true);
  });

  it('tells calendar intervals from fixed ones', () => {
    expect(isCalendarInterval('1M')).toBe(true);
    expect(isCalendarInterval('1Q')).toBe(true);
    expect(isCalendarInterval('2y')).toBe(true);
    expect(isCalendarInterval('1w')).toBe(false);
    expect(calendarMonths('2Q')).toBe(6);
    expect(calendarMonths('1d')).toBeNull();
  });
});

describe('nearestInterval', () => {
  it('keeps a supported interval, or any interval without a usable list', () => {
    expect(nearestInterval('1h', ['1m', '1h'])).toBe('1h');
    expect(nearestInterval('1h', undefined)).toBe('1h');
    expect(nearestInterval('1h', [])).toBe('1h');
    expect(nearestInterval('1h', ['bogus'])).toBe('1h');
  });

  it('picks the nearest supported interval by ratio of nominal length, ignoring entries it cannot parse', () => {
    expect(nearestInterval('1m', ['bogus', '5m', '1h', '1d'])).toBe('5m');
    expect(nearestInterval('1h', ['1m', '1d'])).toBe('1d'); // 24x away beats 60x
    expect(nearestInterval('1w', ['1d', '1M'])).toBe('1M');
    expect(nearestInterval('1y', ['1d', '1w', '1M'])).toBe('1M');
  });

  it('breaks a tie towards the shorter interval', () => {
    expect(nearestInterval('2h', ['4h', '1h'])).toBe('1h');
  });
});

describe('calendar bars', () => {
  const ny = zoneOf('America/New_York');

  it('start monthly bars at midnight on the 1st in the zone, across DST', () => {
    // March 2024: EST on the 1st (UTC-5), EDT from the 10th (UTC-4).
    const march = intervalStart(utc(2024, 3, 20, 15), '1M', ny);
    expect(march).toBe(utc(2024, 3, 1, 5));
    const april = nextIntervalStart(march, '1M', ny);
    expect(april).toBe(utc(2024, 4, 1, 4));
    // 31 days less the hour DST took.
    expect(april - march).toBe(31 * DAY - 3600);
    expect(intervalStart(april, '1M', ny)).toBe(april);
    expect(intervalStart(april - 1, '1M', ny)).toBe(march);
    // November gives the hour back.
    const november = intervalStart(utc(2024, 11, 15), '1M', ny);
    expect(november).toBe(utc(2024, 11, 1, 4));
    expect(nextIntervalStart(november, '1M', ny) - november).toBe(30 * DAY + 3600);
  });

  it('follow 28 and 31 day months', () => {
    const february = intervalStart(utc(2023, 2, 14), '1M');
    expect(february).toBe(utc(2023, 2, 1));
    expect(nextIntervalStart(february, '1M') - february).toBe(28 * DAY);
    const leap = intervalStart(utc(2024, 2, 29, 23, 59), '1M');
    expect(nextIntervalStart(leap, '1M') - leap).toBe(29 * DAY);
    const january = intervalStart(utc(2023, 1, 31, 23, 59), '1M');
    expect(january).toBe(utc(2023, 1, 1));
    expect(nextIntervalStart(january, '1M') - january).toBe(31 * DAY);
    // A bar on the 31st moves to the last day of a shorter month.
    expect(nextIntervalStart(utc(2024, 1, 31), '1M')).toBe(utc(2024, 2, 29));
  });

  it('start at the session open, a time before it belonging to the bar before', () => {
    const open = 9.5 * 3600;
    expect(intervalStart(utc(2024, 3, 1, 15), '1M', ny, open)).toBe(utc(2024, 3, 1, 14, 30));
    // 08:00 in New York on 1 March is before the open: still February's bar.
    expect(intervalStart(utc(2024, 3, 1, 13), '1M', ny, open)).toBe(utc(2024, 2, 1, 14, 30));
    // The next bar keeps the open, now in summer time.
    expect(nextIntervalStart(utc(2024, 3, 1, 14, 30), '1M', ny)).toBe(utc(2024, 4, 1, 13, 30));
  });

  it('align quarters, multi-month bars and years to the calendar', () => {
    expect(intervalStart(utc(2024, 5, 10), '1Q')).toBe(utc(2024, 4, 1));
    expect(nextIntervalStart(utc(2024, 10, 1), '1Q')).toBe(utc(2025, 1, 1));
    expect(intervalStart(utc(2024, 9, 10), '6M')).toBe(utc(2024, 7, 1));
    expect(intervalStart(utc(2024, 9, 10), '1y')).toBe(utc(2024, 1, 1));
    expect(intervalStart(utc(2025, 9, 10), '2y')).toBe(utc(2024, 1, 1));
    expect(nextIntervalStart(utc(2024, 1, 1), '1y')).toBe(utc(2025, 1, 1));
  });

  it('leave fixed intervals on their epoch grid', () => {
    expect(intervalStart(utc(2024, 3, 1, 15, 7), '15m', ny)).toBe(utc(2024, 3, 1, 15));
    expect(nextIntervalStart(utc(2024, 3, 1, 15), '1h')).toBe(utc(2024, 3, 1, 16));
  });
});

/* -------------------------------- controller ------------------------------- */

interface Call {
  symbol: string;
  interval: string;
  request: BarsRequest;
}

function setup(symbols: Record<string, Partial<SymbolInfo>> = {}, history: (interval: string) => Bar[] = () => [bar(60)]) {
  const resolved: string[] = [];
  const calls: Call[] = [];
  const live: ((bar: Bar) => void)[] = [];
  const source: DataSource = {
    symbol: async (symbol) => {
      resolved.push(symbol);
      return { symbol, name: symbol, ...symbols[symbol] };
    },
    search: async () => [],
    history: async (symbol, interval, request) => {
      calls.push({ symbol: symbol.symbol, interval, request });
      return { bars: request.kind === 'initial' ? history(interval) : [], atStart: request.kind !== 'initial' };
    },
    stream: (_symbol, _interval, onBar) => {
      live.push(onBar);
      return () => {};
    },
  };
  const shown: Bar[][] = [];
  const updates: Bar[] = [];
  const events: { name: keyof DataEvents; payload: unknown }[] = [];
  const target: DataTarget = {
    setData: (bars) => shown.push(bars.slice()),
    update: (b) => updates.push(b),
    setPriceFormat: () => {},
  };
  const controller = new DataController(source, target, (name, payload) => events.push({ name, payload }), {
    initialBars: 100,
    pageBars: 50,
  });
  const named = (name: keyof DataEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { controller, resolved, calls, live, shown, updates, events, named };
}

describe('DataController intervals', () => {
  it('rejects an invalid interval before any source call and keeps what it shows', async () => {
    const t = setup();
    await t.controller.setSymbol('A', '1m');
    const before = t.calls.length;
    const error = await t.controller.setSymbol('B', '1x' as Interval).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe('invalid-interval');
    expect(t.resolved).toEqual(['A']);
    expect(t.calls).toHaveLength(before);
    expect(t.controller.symbol?.symbol).toBe('A');
    expect(t.controller.interval).toBe('1m');
    expect(t.named('data:error')).toEqual([]);
    expect(t.controller.loading).toBe(false);
  });

  it('clamps an unsupported interval on a symbol switch and says so', async () => {
    const t = setup({ B: { intervals: ['5m', '1h', 'nonsense'] } });
    await t.controller.setSymbol('A', '1m');
    expect(t.named('interval:change')).toEqual([{ interval: '1m', previous: null, requested: '1m', reason: 'request' }]);
    expect(t.controller.supportedIntervals).toBeNull();

    await t.controller.setSymbol('B', '1m');
    expect(t.calls.at(-1)).toMatchObject({ symbol: 'B', interval: '5m' });
    expect(t.controller.interval).toBe('5m');
    expect(t.controller.supportedIntervals).toEqual(['5m', '1h']);
    expect(t.named('interval:change').at(-1)).toEqual({ interval: '5m', previous: '1m', requested: '1m', reason: 'unsupported' });
    // The change follows the loaded bars.
    const names = t.events.map((e) => e.name);
    expect(names.lastIndexOf('interval:change')).toBeGreaterThan(names.lastIndexOf('data:loaded'));

    // A reload asks for the interval shown, not the one requested.
    await t.controller.reload();
    expect(t.calls.at(-1)).toMatchObject({ symbol: 'B', interval: '5m' });

    // Asking for the interval shown is not a change.
    const changes = t.named('interval:change').length;
    await t.controller.setSymbol('B', '5m');
    expect(t.named('interval:change')).toHaveLength(changes);

    // Clamped even when the clamped interval is the one shown already: the picker must snap back.
    await t.controller.setSymbol('B', '1d');
    expect(t.controller.interval).toBe('1h');
    await t.controller.setSymbol('B', '15m');
    expect(t.controller.interval).toBe('5m');
    expect(t.named('interval:change').at(-1)).toEqual({ interval: '5m', previous: '1h', requested: '15m', reason: 'unsupported' });
  });

  it('reports an unsupported interval with the same interval shown as unsupported', async () => {
    const t = setup({ B: { intervals: ['1h'] } });
    await t.controller.setSymbol('B', '1h');
    await t.controller.setSymbol('B', '1m');
    expect(t.controller.interval).toBe('1h');
    expect(t.named('interval:change').at(-1)).toEqual({ interval: '1h', previous: '1h', requested: '1m', reason: 'unsupported' });
  });

  it('pages calendar history by `to` and `limit` only', async () => {
    const t = setup({}, () => [bar(utc(2024, 1, 1)), bar(utc(2024, 2, 1))]);
    await t.controller.setSymbol('A', '1M');
    await t.controller.loadMore();
    const page = t.calls.at(-1)!.request;
    expect(page.to).toBe(utc(2024, 1, 1));
    expect(page.from).toBeUndefined();
    expect(page.limit).toBe(50);
  });

  it('snaps live bars of a calendar interval into the open bar, in the symbol timezone', async () => {
    const march = utc(2024, 3, 1, 5); // midnight in New York
    const t = setup({ A: { timezone: 'America/New_York' } }, () => [bar(utc(2024, 2, 1, 5)), bar(march)]);
    await t.controller.setSymbol('A', '1M');
    const onBar = t.live[0]!;
    onBar(bar(utc(2024, 3, 20, 14), 12));
    expect(t.updates.at(-1)).toMatchObject({ time: march, close: 12 });
    // 23:59 on 31 March in New York is still March, though already April in UTC.
    onBar(bar(utc(2024, 4, 1, 3, 59), 13));
    expect(t.updates.at(-1)).toMatchObject({ time: march, close: 13 });
    // April opens at 04:00 UTC in summer time: a new bar.
    onBar(bar(utc(2024, 4, 1, 4), 14));
    expect(t.updates.at(-1)).toMatchObject({ time: utc(2024, 4, 1, 4), close: 14 });
    expect(t.named('data:bar').map((e) => (e as { appended: boolean }).appended)).toEqual([false, false, true]);
  });

  it('leaves live bars of fixed intervals as they are', async () => {
    const t = setup({}, () => [bar(60)]);
    await t.controller.setSymbol('A', '1m');
    t.live[0]!(bar(90));
    expect(t.updates.at(-1)!.time).toBe(90);
  });
});

describe('mock data source calendar bars', () => {
  it('builds monthly bars on calendar boundaries in the symbol timezone', async () => {
    const now = utc(2024, 4, 15) * 1000;
    const source = createMockDataSource({
      symbols: [{ symbol: 'F', name: 'F', timezone: 'America/New_York' }],
      historyBars: 14,
      now: () => now,
    });
    const info = await source.symbol('F');
    const { bars } = await source.history(info, '1M', { kind: 'initial', limit: 14, signal: new AbortController().signal });
    expect(bars).toHaveLength(14);
    expect(bars.at(-1)!.time).toBe(utc(2024, 4, 1, 4));
    expect(bars.at(-2)!.time).toBe(utc(2024, 3, 1, 5));
    expect(bars[0]!.time).toBe(utc(2023, 3, 1, 5));
    for (const b of bars) expect(intervalStart(b.time, '1M', zoneOf('America/New_York'))).toBe(b.time);
  });
});

/* ---------------------------------- chart --------------------------------- */

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const zoned: DataSource = {
  symbol: async (symbol) => ({
    symbol,
    name: symbol,
    timezone: { NY: 'America/New_York', TK: 'Asia/Tokyo', BAD: 'Not/AZone' }[symbol],
  }),
  search: async () => [],
  history: async (_info, _interval, request) => ({ bars: request.kind === 'initial' ? [bar(3600), bar(7200)] : [], atStart: true }),
};

function chart(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  c.setDataSource(zoned);
  return c;
}

describe('applySymbolTimezone', () => {
  it('is off by default: the symbol timezone is not shown', async () => {
    const c = chart();
    await c.setSymbol('NY', '1h');
    expect(c.zone.name).toBe('UTC');
  });

  it('shows each symbol in its timezone, else the app timezone', async () => {
    const c = chart({ applySymbolTimezone: true });
    await c.setSymbol('NY', '1h');
    expect(c.zone.name).toBe('America/New_York');
    await c.setSymbol('TK', '1h');
    expect(c.zone.name).toBe('Asia/Tokyo');
    await c.setSymbol('PLAIN', '1h');
    expect(c.zone.name).toBe('UTC');
    // An unknown name from the source neither breaks the load nor is shown.
    await c.setSymbol('BAD', '1h');
    expect(c.zone.name).toBe('UTC');
  });

  it('does not override a later explicit timezone, until switched on again', async () => {
    const c = chart({ applySymbolTimezone: true });
    await c.setSymbol('NY', '1h');
    c.applyOptions({ timezone: 'Europe/London' });
    expect(c.zone.name).toBe('Europe/London');
    // Neither a reload, an interval switch nor another symbol takes it back.
    await c.reload();
    await c.setSymbol('NY', '4h');
    await c.setSymbol('TK', '1h');
    expect(c.zone.name).toBe('Europe/London');
    // Switching it on again follows the symbol shown, with London as the fallback.
    c.applyOptions({ applySymbolTimezone: true });
    expect(c.zone.name).toBe('Asia/Tokyo');
    await c.setSymbol('PLAIN', '1h');
    expect(c.zone.name).toBe('Europe/London');
  });

  it('turned on later applies the current symbol; turned off restores the app timezone', async () => {
    const c = chart();
    await c.setSymbol('TK', '1h');
    c.applyOptions({ applySymbolTimezone: true });
    expect(c.zone.name).toBe('Asia/Tokyo');
    c.applyOptions({ applySymbolTimezone: false });
    expect(c.zone.name).toBe('UTC');
  });

  it('with a timezone in the same call, takes it as the fallback', async () => {
    const c = chart();
    await c.setSymbol('PLAIN', '1h');
    c.applyOptions({ applySymbolTimezone: true, timezone: 'Europe/Paris' });
    expect(c.zone.name).toBe('Europe/Paris');
    await c.setSymbol('NY', '1h');
    expect(c.zone.name).toBe('America/New_York');
  });
});

describe('chart.setSymbol intervals', () => {
  it('rejects an invalid interval without calling the source', async () => {
    let resolves = 0;
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(c);
    c.setDataSource({ ...zoned, symbol: async (s) => (resolves++, { symbol: s, name: s }) });
    await expect(c.setSymbol('A', 'oops' as Interval)).rejects.toMatchObject({ code: 'invalid-interval' });
    await flush();
    expect(resolves).toBe(0);
  });
});
