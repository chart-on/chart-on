import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/timeline';
import { compileSession, type SessionSchedule } from '../src/util/session';
import { UTC, zoneOf } from '../src/util/timezone';
import { TickWeight, selectTimeTicks } from '../src/util/format';
import { hours, WEEKDAYS } from './sessions';

const HOUR = 3600;
const DAY = 86400;
/** 2024-01-01, a Monday. */
const MON = Date.UTC(2024, 0, 1) / 1000;
const weekday = (t: number) => new Date(t * 1000).getUTCDay();

function timeline(times: number[], schedule?: SessionSchedule): Timeline {
  const t = new Timeline();
  if (schedule) t.setZone(UTC, compileSession(schedule));
  t.set(times);
  return t;
}

/** Daily bars on weekdays for `weeks` weeks from MON. */
function weekdayDays(weeks: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < weeks * 7; d++) if (d % 7 < 5) out.push(MON + d * DAY);
  return out;
}

/** Hourly bars 09:30-15:30 on weekdays for `weeks` weeks from MON. */
function hourlyBars(weeks: number): number[] {
  const out: number[] = [];
  for (const day of weekdayDays(weeks)) for (let h = 0; h < 7; h++) out.push(day + 9.5 * HOUR + h * HOUR);
  return out;
}

const weekdays: SessionSchedule = hours([['09:30', '16:00']], WEEKDAYS);

describe('projected bars after the last one', () => {
  it('skips weekends daily bars never fall on, without a session', () => {
    const tl = timeline(weekdayDays(4)); // ends on a Friday
    const last = tl.times[tl.length - 1]!;
    expect(weekday(last)).toBe(5);
    const next = tl.projected(6);
    expect(next.map(weekday)).toEqual([1, 2, 3, 4, 5, 1]);
    expect(next[0]).toBe(last + 3 * DAY);
  });

  it('keeps every day for data that trades every day', () => {
    const tl = timeline(Array.from({ length: 30 }, (_, i) => MON + i * DAY));
    const last = tl.times[tl.length - 1]!;
    expect(tl.projected(3)).toEqual([last + DAY, last + 2 * DAY, last + 3 * DAY]);
  });

  it('skips session holidays on daily bars', () => {
    const lastDay = weekdayDays(4).at(-1)!; // Friday 2024-01-26
    const holiday = new Date((lastDay + 3 * DAY) * 1000).toISOString().slice(0, 10); // the next Monday
    const tl = timeline(weekdayDays(4), { ...weekdays, holidays: [holiday] });
    expect(tl.projected(2)).toEqual([lastDay + 4 * DAY, lastDay + 5 * DAY]);
  });

  it('steps intraday bars through the session and jumps to the next open', () => {
    const tl = timeline(hourlyBars(1), weekdays); // last bar Friday 15:30
    const friday = MON + 4 * DAY;
    const nextMonday = MON + 7 * DAY;
    expect(tl.times.at(-1)).toBe(friday + 15.5 * HOUR);
    expect(tl.projected(8)).toEqual([
      nextMonday + 9.5 * HOUR,
      nextMonday + 10.5 * HOUR,
      nextMonday + 11.5 * HOUR,
      nextMonday + 12.5 * HOUR,
      nextMonday + 13.5 * HOUR,
      nextMonday + 14.5 * HOUR,
      nextMonday + 15.5 * HOUR,
      nextMonday + DAY + 9.5 * HOUR,
    ]);
  });

  it('skips an intraday holiday', () => {
    const holiday = new Date((MON + 7 * DAY) * 1000).toISOString().slice(0, 10);
    const tl = timeline(hourlyBars(1), { ...weekdays, holidays: [holiday] });
    expect(tl.projected(1)).toEqual([MON + 8 * DAY + 9.5 * HOUR]);
  });

  it('opens an overnight session the evening before', () => {
    // Trading days Monday to Friday, 18:00 the evening before to 17:00.
    const schedule = hours([['18:00', '17:00']], WEEKDAYS);
    const friday = MON + 4 * DAY;
    const tl = timeline([friday + 15 * HOUR, friday + 16 * HOUR], schedule);
    // Friday's session ends at 17:00; Monday's opens Sunday 18:00.
    expect(tl.projected(2)).toEqual([MON + 6 * DAY + 18 * HOUR, MON + 6 * DAY + 19 * HOUR]);
  });

  it('keeps the fixed interval without a session on intraday bars', () => {
    const tl = timeline(Array.from({ length: 10 }, (_, i) => i * 60));
    expect(tl.projected(2)).toEqual([600, 660]);
    expect(tl.indexFromTime(900)).toBe(15);
  });

  it('maps future times to indices and back', () => {
    const tl = timeline(hourlyBars(2), weekdays);
    const n = tl.length;
    for (let i = n; i < n + 30; i++) expect(tl.indexFromTime(tl.timeFromIndex(i))).toBe(i);
    // A Saturday lies between Friday's last bar and Monday's first: fractional, in order.
    const saturday = MON + 12 * DAY + 12 * HOUR;
    const index = tl.indexFromTime(saturday);
    expect(index).toBeGreaterThan(n - 1);
    expect(index).toBeLessThan(n);
  });

  it('starts over when a bar is appended or the session changes', () => {
    const tl = timeline(hourlyBars(1), weekdays);
    const first = tl.projected(1)[0]!;
    tl.append(first);
    expect(tl.projected(1)[0]).toBe(first + HOUR);
    tl.setZone(UTC, null);
    expect(tl.projected(1)[0]).toBe(first + HOUR);
    tl.setZone(zoneOf('America/New_York'), compileSession(weekdays));
    expect(tl.projected(1)[0]).not.toBe(first + HOUR);
  });

  it('goes back to the fixed interval past the projection cap', () => {
    const tl = timeline(weekdayDays(2));
    const far = tl.timeFromIndex(tl.lastIndex + 50000);
    const capped = tl.timeFromIndex(tl.lastIndex + 20000);
    expect(far - capped).toBe(30000 * DAY);
  });
});

describe('time axis ticks past the last bar', () => {
  it('places labels on the projected bars', () => {
    const tl = timeline(hourlyBars(1), weekdays);
    const n = tl.length;
    const future = tl.projectedWeights(20);
    // The first projected bar (Monday's open) starts a new day.
    expect(future[0]).toBe(TickWeight.Day);
    const ticks = selectTimeTicks(tl.weights, 0, n + 19, 20, 72, future);
    expect(ticks.some((t) => t.index === n && t.weight === TickWeight.Day)).toBe(true);
    expect(selectTimeTicks(tl.weights, 0, n + 19, 20, 72).every((t) => t.index < n)).toBe(true);
  });
});
