import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { CalendarBucketing, periodOf } from '../src/calendar-buckets';
import { Timeline } from '../src/timeline';
import { compileSession } from '../src/util/session';
import { UTC, zoneOf } from '../src/util/timezone';
import type { Bar } from '../src/types';
import { hours, WEEKDAYS } from './sessions';

const HOUR = 3600;
const DAY = 86400;
/** 2024-01-01, a Monday. */
const MON = Date.UTC(2024, 0, 1) / 1000;
const regular = hours([['09:30', '16:00']], WEEKDAYS);

/** Minute bars 09:30-15:59 UTC on weekdays for `days` weekdays from MON. */
function sessionMinutes(days: number): number[] {
  const out: number[] = [];
  for (let d = 0, done = 0; done < days; d++) {
    if (d % 7 >= 5) continue;
    for (let m = 0; m < 390; m++) out.push(MON + d * DAY + 9.5 * HOUR + m * 60);
    done++;
  }
  return out;
}

function timeline(times: number[], zone = UTC, schedule = regular): Timeline {
  const t = new Timeline();
  t.setZone(zone, compileSession(schedule));
  t.set(times);
  return t;
}

/** Start index of each bucket. */
function starts(tl: Timeline, step: Parameters<CalendarBucketing['buckets']>[1]): number[] {
  const g = new CalendarBucketing().buckets(tl, step);
  return Array.from({ length: g.count }, (_, j) => g.start(j));
}

describe('calendar buckets', () => {
  it('make one bucket per trading day across session gaps, and weeks start on Monday', () => {
    const tl = timeline(sessionMinutes(7)); // Monday to Friday, then Monday and Tuesday
    expect(starts(tl, '1d')).toEqual([0, 390, 780, 1170, 1560, 1950, 2340]);
    expect(starts(tl, '1w')).toEqual([0, 1950]);
    // Hours follow the clock: 09:30 to 10:00 is the first, short hour.
    expect(starts(tl, '1h').slice(0, 3)).toEqual([0, 30, 90]);
  });

  it('follow the local day across a DST change', () => {
    const ny = zoneOf('America/New_York');
    // Hourly bars around the start of US daylight time, 2024-03-10.
    const from = Date.UTC(2024, 2, 9, 5) / 1000; // 00:00 New York on the 9th
    const times = Array.from({ length: 72 }, (_, i) => from + i * HOUR);
    const tl = timeline(times, ny, { weekly: { mon: [{ start: '00:00', end: '24:00' }], tue: [{ start: '00:00', end: '24:00' }], wed: [{ start: '00:00', end: '24:00' }], thu: [{ start: '00:00', end: '24:00' }], fri: [{ start: '00:00', end: '24:00' }], sat: [{ start: '00:00', end: '24:00' }], sun: [{ start: '00:00', end: '24:00' }] } });
    const days = starts(tl, '1d');
    // The 10th has 23 hours, so the 11th starts at hour 24 + 23 and the 12th 24 hours later.
    expect(days).toEqual([0, 24, 47, 71]);
    for (const i of days) expect(ny.wall(times[i]!) % DAY).toBe(0);
  });

  it('put an overnight session in the day it trades for', () => {
    const overnight = hours([['18:00', '17:00']], WEEKDAYS);
    // Hourly: Monday 16:00 to Tuesday 16:00; from 18:00 Monday the bars are Tuesday's.
    const times = Array.from({ length: 25 }, (_, i) => MON + 16 * HOUR + i * HOUR);
    const tl = timeline(times, UTC, overnight);
    expect(starts(tl, '1d')).toEqual([0, 2]);
    expect(periodOf(times[2]!, '1d', UTC, compileSession(overnight))).toBe(periodOf(times[20]!, '1d', UTC, compileSession(overnight)));
  });

  it('extend on appended bars with the same key, and start over on new history', () => {
    const times = sessionMinutes(2);
    const tl = timeline(times.slice());
    const bucketing = new CalendarBucketing();
    const a = bucketing.buckets(tl, '1d');
    tl.append(times[times.length - 1]! + DAY);
    const b = bucketing.buckets(tl, '1d');
    expect(b.key).toBe(a.key);
    expect(b.count).toBe(a.count + 1);
    tl.set([MON - DAY, ...tl.times]);
    expect(bucketing.buckets(tl, '1d').key).not.toBe(a.key);
  });

  it('pick the finest step whose average bucket is wide enough, coarser than the bars', () => {
    const tl = timeline(sessionMinutes(20));
    const bucketing = new CalendarBucketing();
    expect(bucketing.pick(tl, ['1m', '5m', '1d'], 3)).toBeNull(); // bars are wide enough
    expect(bucketing.pick(tl, ['1m', '5m', '1d'], 0.5)).toBe('5m'); // 5 bars × 0.5 px
    expect(bucketing.pick(tl, ['1m', '5m', '1h', '1d'], 0.02)).toBe('1d'); // an hour averages 55 bars: 1.1 px
    expect(bucketing.pick(tl, ['1m', '5m'], 0.01)).toBe('5m'); // the coarsest there is
    expect(bucketing.pick(tl, ['1m'], 0.01)).toBeNull(); // nothing coarser than the bars
  });
});

describe('calendar grouping on the chart', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  const times = sessionMinutes(40);
  const bars: Bar[] = times.map((time, i) => ({ time, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1 }));

  function chart(options: ChartOptionsPatch) {
    const c = new Chart(fakeContainer(), { timezone: 'UTC', session: regular, ...options });
    charts.push(c);
    c.addCandles({ animate: false }).setData(bars);
    return c;
  }

  function frame(c: Chart): void {
    c.invalidate();
    (c as unknown as { render(dt: number): boolean }).render(0);
  }

  it('groups the visible bars into trading days with their OHLC', () => {
    const c = chart({ grouping: { mode: 'calendar', steps: ['1d'] } });
    expect(c.fitContent(false)).toBe(true);
    frame(c);
    expect(c.grouping).toEqual({ level: 0, bars: 390, step: '1d' });
    // The second day: bars 390 to 779.
    const values = c.valuesAt(times[500]!)!;
    expect(values.group).toEqual({ time: times[390], endTime: times[779], count: 390 });
    const candles = values.series[0]!;
    expect(candles.legend?.parts.map((p) => p.text).slice(0, 4)).toEqual(
      [490, 880, 489, 879.5].map((v) => c.main!.formatValue(v)),
    );
  });

  it('keeps the view where it was when grouping starts or stops', () => {
    const grouped = chart({ grouping: { mode: 'calendar' } });
    const plain = chart({ grouping: null, minBarSpacing: 0.1 });
    for (const c of [grouped, plain]) {
      c.setBarSpacing(0.5);
      frame(c);
    }
    expect(grouped.grouping?.step).toBe('5m');
    expect(grouped.getVisibleIndexRange()).toEqual(plain.getVisibleIndexRange());
    grouped.setBarSpacing(6);
    plain.setBarSpacing(6);
    frame(grouped);
    expect(grouped.grouping).toBeNull();
    expect(grouped.getVisibleIndexRange()).toEqual(plain.getVisibleIndexRange());
  });

  it('rejects steps that are not intervals', () => {
    expect(() => chart({ grouping: { mode: 'calendar', steps: ['daily' as never] } })).toThrow(/steps/);
    const c = chart({ grouping: null });
    expect(() => c.applyOptions({ grouping: { mode: 'calendar', steps: [] } })).toThrow(/steps/);
  });
});

describe('calendar levels in the pyramid', () => {
  it('rebuild only the last bucket when an item is appended to it', async () => {
    const { Pyramid } = await import('../src/lod');
    const tl = timeline(sessionMinutes(10));
    const values = Array.from({ length: tl.length }, (_, i) => i);
    let reads = 0;
    const p = new Pyramid({ v: 'sum' } as const, {
      count: () => values.length,
      index: (k) => k,
      itemAt: (i) => (i >= 0 && i < values.length ? i : -1),
      value: (k) => (reads++, values[k]!),
    });
    const bucketing = new CalendarBucketing();
    const days = bucketing.buckets(tl, '1d');
    expect(p.size(days)).toBe(10);
    expect(p.get(days, 1, 'v')).toBe((390 + 779) * 195);
    // One more bar on the last day.
    tl.append(tl.times[tl.length - 1]! + 60);
    values.push(values.length);
    reads = 0;
    p.update(values.length - 1);
    expect(p.get(bucketing.buckets(tl, '1d'), 9, 'v')).toBe(values.slice(9 * 390).reduce((a, b) => a + b, 0));
    expect(reads).toBeLessThanOrEqual(391);
  });
});
