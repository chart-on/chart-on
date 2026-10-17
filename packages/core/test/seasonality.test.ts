import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { DataSource } from '../src/data/types';
import { computeSeasonality, seasonalPosition, seasonalSlots, summarize, type SeasonalPath } from '../src/seasonality/math';
import { createSeasonality } from '../src/seasonality/view';
import type { Bar } from '../src/types';
import { zoneOf } from '../src/util/timezone';

const DAY = 86400;
const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;
const bar = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close });

/** Every calendar day from `from` to `to` (inclusive), closing at `close(time)`. */
function daily(from: number, to: number, close: (time: number, i: number) => number = (_, i) => 100 + i): Bar[] {
  const out: Bar[] = [];
  for (let time = from, i = 0; time <= to; time += DAY, i++) out.push(bar(time, close(time, i)));
  return out;
}

describe('seasonalPosition', () => {
  it('puts the same date at the same position in leap and common years', () => {
    expect(seasonalPosition(t(2023, 1, 1), 'year').position).toBe(0);
    expect(seasonalPosition(t(2023, 2, 28), 'year').position).toBe(58);
    expect(seasonalPosition(t(2024, 2, 28), 'year').position).toBe(58);
    expect(seasonalPosition(t(2024, 2, 29), 'year').position).toBe(59);
    expect(seasonalPosition(t(2023, 3, 1), 'year').position).toBe(60);
    expect(seasonalPosition(t(2024, 3, 1), 'year').position).toBe(60);
    expect(seasonalPosition(t(2023, 12, 31), 'year')).toEqual({ year: 2023, period: 1, position: 365 });
    expect(seasonalPosition(t(2024, 12, 31), 'year')).toEqual({ year: 2024, period: 1, position: 365 });
  });

  it('counts from the start of the quarter or month', () => {
    expect(seasonalPosition(t(2023, 3, 31), 'quarter')).toEqual({ year: 2023, period: 1, position: 90 });
    expect(seasonalPosition(t(2024, 3, 31), 'quarter')).toEqual({ year: 2024, period: 1, position: 90 });
    expect(seasonalPosition(t(2021, 8, 15), 'quarter')).toEqual({ year: 2021, period: 3, position: 45 });
    expect(seasonalPosition(t(2021, 8, 15), 'month')).toEqual({ year: 2021, period: 8, position: 14 });
    expect(seasonalPosition(t(2024, 2, 29), 'month')).toEqual({ year: 2024, period: 2, position: 28 });
  });

  it('reads the date in the given timezone', () => {
    // 23:00 UTC on 31 Dec is already 1 January in Tokyo.
    const time = t(2022, 12, 31) + 23 * 3600;
    expect(seasonalPosition(time, 'year').year).toBe(2022);
    expect(seasonalPosition(time, 'year', zoneOf('Asia/Tokyo'))).toEqual({ year: 2023, period: 1, position: 0 });
  });

  it('sizes windows on the leap-year calendar', () => {
    expect(seasonalSlots('year', 1)).toBe(366);
    expect(seasonalSlots('quarter', 1)).toBe(91);
    expect(seasonalSlots('quarter', 3)).toBe(92);
    expect(seasonalSlots('month', 2)).toBe(29);
    expect(seasonalSlots('month', 4)).toBe(30);
  });
});

describe('computeSeasonality', () => {
  const bars = daily(t(2020, 1, 1), t(2024, 6, 30));

  it('keeps the newest years, oldest first, one path per year', () => {
    const data = computeSeasonality(bars, { years: 3, normalize: 'none' });
    expect(data.paths.map((p) => p.year)).toEqual([2022, 2023, 2024]);
    expect(data.slots).toBe(366);
    expect(data.start).toBe(t(2000, 1, 1));
  });

  it('lists explicit years that have data', () => {
    const data = computeSeasonality(bars, { years: [2023, 2019, 2021, 2021], normalize: 'none' });
    expect(data.paths.map((p) => p.year)).toEqual([2021, 2023]);
  });

  it('carries 28 February over the leap day in common years, or leaves a gap', () => {
    const carry = computeSeasonality(bars, { years: [2023, 2024], normalize: 'none' });
    const [y2023, y2024] = carry.paths as [SeasonalPath, SeasonalPath];
    expect(y2023.values[59]).toBe(y2023.values[58]);
    expect(y2024.values[59]).toBe(bars.find((b) => b.time === t(2024, 2, 29))!.close);
    // 1 March lines up in both years.
    expect(y2023.values[60]).toBe(bars.find((b) => b.time === t(2023, 3, 1))!.close);
    expect(y2024.values[60]).toBe(bars.find((b) => b.time === t(2024, 3, 1))!.close);

    const skip = computeSeasonality(bars, { years: [2023], normalize: 'none', gaps: 'skip' });
    expect(skip.paths[0]!.values[59]).toBeNaN();
  });

  it('carries closes over missing trading days but not past the newest bar', () => {
    // Weekdays only.
    const weekdays = bars.filter((b) => {
      const day = new Date(b.time * 1000).getUTCDay();
      return day !== 0 && day !== 6;
    });
    const data = computeSeasonality(weekdays, { years: [2024], normalize: 'none' });
    const path = data.paths[0]!;
    // Sat 6 and Sun 7 January 2024 repeat Friday's close.
    expect(path.values[5]).toBe(path.values[4]);
    expect(path.values[6]).toBe(path.values[4]);
    // The year ends at its newest bar (Fri 28 June).
    expect(path.values[seasonalPosition(t(2024, 6, 28), 'year').position]).not.toBeNaN();
    expect(path.values[seasonalPosition(t(2024, 6, 29), 'year').position]).toBeNaN();
  });

  it('normalises to percent change or an index of 100 from the first close', () => {
    const series = [bar(t(2023, 1, 2), 50), bar(t(2023, 1, 3), 55), bar(t(2023, 1, 4), 45)];
    const percent = computeSeasonality(series, { normalize: 'percent' }).paths[0]!;
    expect(percent.values[0]).toBeNaN(); // 1 January has no bar
    expect([...percent.values.slice(1, 4)].map((v) => +v.toFixed(9))).toEqual([0, 10, -10]);
    expect(percent.base).toBe(50);
    const indexed = computeSeasonality(series, { normalize: 'indexed' }).paths[0]!;
    expect([...indexed.values.slice(1, 4)].map((v) => +v.toFixed(9))).toEqual([100, 110, 90]);
  });

  it('aligns by trading day: the nth bar of each window', () => {
    const series = [bar(t(2022, 1, 3), 1), bar(t(2022, 1, 4), 2), bar(t(2023, 1, 2), 3), bar(t(2023, 1, 5), 4), bar(t(2023, 1, 6), 5)];
    const data = computeSeasonality(series, { normalize: 'none', align: 'trading' });
    expect(data.slots).toBe(3);
    expect([...data.paths[0]!.values]).toEqual([1, 2, NaN]);
    expect([...data.paths[1]!.values]).toEqual([3, 4, 5]);
  });

  it('compares one quarter or month, by default the newest bar’s', () => {
    const q = computeSeasonality(bars, { window: 'quarter', normalize: 'none' });
    expect(q.period).toBe(2);
    expect(q.slots).toBe(91);
    expect(q.start).toBe(t(2000, 4, 1));
    expect(q.paths[0]!.values[0]).toBe(bars.find((b) => b.time === t(2020, 4, 1))!.close);
    const feb = computeSeasonality(bars, { window: 'month', period: 2, normalize: 'none', years: 5 });
    expect(feb.slots).toBe(29);
    expect(feb.paths.map((p) => p.year)).toEqual([2020, 2021, 2022, 2023, 2024]);
  });

  it('rejects unknown options and out of range periods', () => {
    expect(() => computeSeasonality(bars, { window: 'week' as never })).toThrow(/window/);
    expect(() => computeSeasonality(bars, { window: 'month', period: 13 })).toThrow(/period/);
    expect(() => computeSeasonality(bars, { years: 0 })).toThrow(/years/);
    expect(() => computeSeasonality(bars, { average: 'mode' as never })).toThrow(/average/);
  });
});

describe('average paths', () => {
  const path = (year: number, values: number[]): SeasonalPath => ({ year, values: Float64Array.from(values), base: 1, bars: values.length });
  const paths = [path(2021, [1, 2, NaN, 4]), path(2022, [3, 8, NaN, NaN]), path(2023, [2, 5, NaN, 10]), path(2024, [10, NaN, NaN, 1])];

  it('takes the mean of the years with a value at each position', () => {
    const s = summarize(paths, 4, 'mean');
    expect([...s.values]).toEqual([4, 5, NaN, 5]);
    expect([...s.min]).toEqual([1, 2, NaN, 1]);
    expect([...s.max]).toEqual([10, 8, NaN, 10]);
  });

  it('takes the median, averaging the middle pair for an even count', () => {
    const s = summarize(paths, 4, 'median');
    expect([...s.values]).toEqual([2.5, 5, NaN, 4]);
  });

  it('comes with the seasonality when asked for', () => {
    const bars = daily(t(2021, 1, 1), t(2023, 12, 31));
    expect(computeSeasonality(bars, { normalize: 'none' }).average).toBeNull();
    const data = computeSeasonality(bars, { normalize: 'none', average: 'median' });
    expect(data.average!.kind).toBe('median');
    // Three years: the median of each position is 2022's close.
    expect(data.average!.values[10]).toBe(data.paths[1]!.values[10]);
  });
});

describe('createSeasonality', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));
  const chart = () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    return c;
  };
  const bars = daily(t(2020, 1, 1), t(2024, 6, 30), (time) => 100 + Math.sin(time / 1e6) * 10);

  it('draws a line per year on a calendar time axis', () => {
    const c = chart();
    const view = createSeasonality(c, { bars, average: 'mean' });
    expect(view.years).toEqual([2020, 2021, 2022, 2023, 2024]);
    expect(c.mainBars).toHaveLength(366);
    expect(c.main!.visible).toBe(false);
    const line = view.yearSeries(2023)!;
    expect(line.options.title).toBe('2023');
    // 365 days plus 28 February carried over the leap day.
    expect(line.data).toHaveLength(366);
    expect(view.averageSeries!.options.title).toBe('Mean');
    const march1 = c.mainBars[60]!.time;
    expect(c.formatTime(march1)).toBe('1 Mar');
    expect(c.options.formatTimeTick!(march1, 5)).toBe('Mar');
  });

  it('hides a year without recomputing the others', () => {
    const c = chart();
    const view = createSeasonality(c, { bars, average: 'mean' });
    const others = [2020, 2021, 2023, 2024].map((y) => view.yearSeries(y)!);
    const spies = [...others, view.averageSeries!].map((s) => vi.spyOn(s, 'setData'));
    const before = others.map((s) => s.data);
    view.setYearVisible(2022, false);
    expect(view.yearSeries(2022)!.visible).toBe(false);
    expect(view.isYearVisible(2022)).toBe(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(others.map((s) => s.data)).toEqual(before);
    others.forEach((s, k) => expect(s.data).toBe(before[k]));
  });

  it('keeps a year hidden from the legend through recomputes', () => {
    const c = chart();
    const view = createSeasonality(c, { bars });
    view.yearSeries(2021)!.setVisible(false); // what the legend's eye button does
    expect(view.isYearVisible(2021)).toBe(false);
    view.applyOptions({ normalize: 'indexed' });
    expect(view.yearSeries(2021)!.visible).toBe(false);
    expect(view.yearSeries(2022)!.visible).toBe(true);
  });

  it('labels trading days by number', () => {
    const c = chart();
    createSeasonality(c, { bars, align: 'trading' });
    expect(c.formatTime(c.mainBars[41]!.time)).toBe('Day 42');
  });

  it('loads daily bars through the chart data source and pages back to the oldest year', async () => {
    const now = Math.floor(Date.now() / 1000 / DAY) * DAY;
    const all = daily(now - 6 * 366 * DAY, now);
    const history = vi.fn(async (_s: unknown, interval: string, req: { to?: number; limit: number }) => {
      expect(interval).toBe('1d');
      const older = all.filter((b) => req.to === undefined || b.time < req.to);
      const page = older.slice(-req.limit);
      return { bars: page, atStart: page.length < req.limit };
    });
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }),
      search: async () => [],
      history,
    };
    const c = chart();
    c.setDataSource(source);
    const view = createSeasonality(c, { symbol: 'X', years: 5 });
    await view.ready;
    expect(view.years).toHaveLength(5);
    expect(history.mock.calls.length).toBeGreaterThan(1);
  });

  it('rejects ready when the load fails', async () => {
    const source: DataSource = {
      symbol: async () => {
        throw new Error('unknown symbol');
      },
      search: async () => [],
      history: async () => ({ bars: [] }),
    };
    const c = chart();
    const view = createSeasonality(c, { symbol: 'X', source });
    await expect(view.ready).rejects.toBeTruthy();
  });

  it('needs a chart of its own', () => {
    const c = chart();
    c.addCandles().setData(bars.slice(0, 10));
    expect(() => createSeasonality(c, { bars })).toThrow(/main series/);
  });

  it('removes its series and restores the time labels on dispose', () => {
    const c = chart();
    const formatTime = () => 'x';
    c.applyOptions({ formatTime });
    const view = createSeasonality(c, { bars, average: 'median' });
    view.dispose();
    expect(c.panes[0]!.series).toHaveLength(0);
    expect(c.main).toBeNull();
    expect(c.options.formatTime).toBe(formatTime);
  });
});
