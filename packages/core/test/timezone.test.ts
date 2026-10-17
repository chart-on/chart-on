import { describe, expect, it, vi } from 'vitest';
import { UTC, Zone, zoneOf } from '../src/util/timezone';
import { ALWAYS_OPEN, compileSession, inSession, tradingDay } from '../src/util/session';
import { TickWeight, computeTickWeights, formatCrosshairTime, formatTickLabel, tickWeight } from '../src/util/format';
import { Timeline } from '../src/timeline';
import { hours, WEEKDAYS } from './sessions';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const HOUR = 3600;

const newYork = zoneOf('America/New_York');
const london = zoneOf('Europe/London');
const sydney = zoneOf('Australia/Sydney');

describe('Zone', () => {
  it('follows DST transitions in both hemispheres', () => {
    // New York: 2024-03-10 07:00 UTC springs forward, 2024-11-03 06:00 UTC falls back.
    expect(newYork.offset(utc(2024, 3, 10, 6, 59))).toBe(-5 * HOUR);
    expect(newYork.offset(utc(2024, 3, 10, 7))).toBe(-4 * HOUR);
    expect(newYork.offset(utc(2024, 11, 3, 5, 59))).toBe(-4 * HOUR);
    expect(newYork.offset(utc(2024, 11, 3, 6))).toBe(-5 * HOUR);
    // London: 2024-03-31 01:00 UTC and 2024-10-27 01:00 UTC.
    expect(london.offset(utc(2024, 3, 31, 0, 59))).toBe(0);
    expect(london.offset(utc(2024, 3, 31, 1))).toBe(HOUR);
    expect(london.offset(utc(2024, 10, 27, 1))).toBe(0);
    // Sydney: summer time ends 2024-04-06 16:00 UTC and starts 2024-10-05 16:00 UTC.
    expect(sydney.offset(utc(2024, 4, 6, 15, 59))).toBe(11 * HOUR);
    expect(sydney.offset(utc(2024, 4, 6, 16))).toBe(10 * HOUR);
    expect(sydney.offset(utc(2024, 10, 5, 16))).toBe(11 * HOUR);
  });

  it('is exact for transitions that are not on a whole UTC hour', () => {
    // St. John's switches at 05:30 UTC in March and 04:30 UTC in November.
    // A fresh zone, with the start of the hour looked up first, so a per-hour
    // cache would be primed with the offset from before the switch.
    const stJohns = new Zone('America/St_Johns');
    expect(stJohns.offset(utc(2024, 3, 10, 5))).toBe(-3.5 * HOUR);
    expect(stJohns.offset(utc(2024, 3, 10, 5, 29))).toBe(-3.5 * HOUR);
    expect(stJohns.offset(utc(2024, 3, 10, 5, 45))).toBe(-2.5 * HOUR);
    expect(stJohns.offset(utc(2024, 3, 10, 5, 30))).toBe(-2.5 * HOUR);
    expect(stJohns.offset(utc(2024, 11, 3, 4))).toBe(-2.5 * HOUR);
    expect(stJohns.offset(utc(2024, 11, 3, 4, 45))).toBe(-3.5 * HOUR);
    expect(stJohns.offset(utc(2024, 11, 3, 4, 30) - 1)).toBe(-2.5 * HOUR);
    // Conversions in the switching hour follow the exact offset too.
    const t = utc(2024, 3, 10, 5, 45);
    expect(stJohns.date(t).getUTCHours()).toBe(3);
    expect(stJohns.date(t).getUTCMinutes()).toBe(15);
    expect(stJohns.fromWall(stJohns.wall(t))).toBe(t);
  });

  it('keeps whole-hour transitions exact on both sides of the switch', () => {
    // Fresh zone so the hours around the switch are looked up in this test.
    const ny = new Zone('America/New_York');
    expect(ny.offset(utc(2024, 3, 10, 6))).toBe(-5 * HOUR);
    expect(ny.offset(utc(2024, 3, 10, 6, 59, 59))).toBe(-5 * HOUR);
    expect(ny.offset(utc(2024, 3, 10, 7))).toBe(-4 * HOUR);
    expect(ny.offset(utc(2024, 3, 10, 7, 30))).toBe(-4 * HOUR);
    expect(ny.offset(utc(2024, 11, 3, 5, 30))).toBe(-4 * HOUR);
    expect(ny.offset(utc(2024, 11, 3, 6))).toBe(-5 * HOUR);
    expect(ny.offset(utc(2024, 11, 3, 6, 30))).toBe(-5 * HOUR);
  });

  it('treats UTC as a zero offset and rejects unknown names', () => {
    expect(UTC.isUtc).toBe(true);
    expect(UTC.wall(1234)).toBe(1234);
    expect(zoneOf('Etc/UTC').offset(utc(2024, 7, 1))).toBe(0);
    expect(() => new Zone('Mars/Olympus')).toThrow(RangeError);
    expect(zoneOf('Asia/Tokyo')).toBe(zoneOf('Asia/Tokyo'));
  });

  it('converts wall-clock time back, including skipped and repeated hours', () => {
    const t = utc(2024, 7, 4, 15, 30);
    expect(newYork.fromWall(newYork.wall(t))).toBe(t);
    expect(sydney.fromWall(sydney.wall(t))).toBe(t);
    // 02:30 on 2024-03-10 does not exist in New York: it moves forward to 03:30 EDT.
    expect(newYork.fromWall(utc(2024, 3, 10, 2, 30))).toBe(utc(2024, 3, 10, 7, 30));
    // 01:30 on 2024-11-03 happens twice: the first (EDT) wins.
    expect(newYork.fromWall(utc(2024, 11, 3, 1, 30))).toBe(utc(2024, 11, 3, 5, 30));
  });
});

/** Offset at `time` straight from `Intl`, independent of `Zone`'s own lookup. */
function intlOffset(name: string): (time: number) => number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: name,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  return (time) => {
    const p: Record<string, number> = {};
    for (const x of fmt.formatToParts(new Date(time * 1000))) p[x.type] = Number(x.value);
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) / 1000 - time;
  };
}

/** Times in [from, to) where `zone`'s offset changes, scanning with its own `offset`. */
function changesOf(zone: Zone, from: number, to: number): number[] {
  const out: number[] = [];
  let prev = zone.offset(from);
  for (let t = from; t < to; t += 60) {
    const o = zone.offset(t);
    if (o === prev) continue;
    // Narrow the minute down to the second.
    let s = t - 59;
    while (zone.offset(s) === prev) s++;
    out.push(s);
    prev = o;
  }
  return out;
}

describe('Zone offsets against Intl', () => {
  // Windows with DST changes, half-hour and 45-minute offsets, half-hour DST
  // and historic changes of the base offset.
  const cases: [string, number, number][] = [
    ['America/New_York', utc(2023, 12, 1), utc(2025, 1, 1)],
    ['Europe/London', utc(1967, 6, 1), utc(1970, 6, 1)], // British Standard Time
    ['Australia/Lord_Howe', utc(2024, 1, 1), utc(2025, 1, 1)], // 30-minute DST
    ['Asia/Kolkata', utc(1941, 6, 1), utc(1945, 12, 1)], // wartime offsets
    ['Asia/Kathmandu', utc(1985, 6, 1), utc(1986, 6, 1)], // +05:30 to +05:45
    ['Europe/Moscow', utc(2010, 6, 1), utc(2014, 12, 1)], // permanent DST, then back
    ['Pacific/Apia', utc(2011, 6, 1), utc(2012, 6, 1)], // skipped a whole day
    ['Africa/Casablanca', utc(2019, 1, 1), utc(2020, 1, 1)], // Ramadan changes
    ['America/Sao_Paulo', utc(2018, 6, 1), utc(2020, 6, 1)], // DST abolished
    ['America/Recife', utc(2000, 9, 1), utc(2000, 12, 1)], // summer time for a single week
  ];

  it.each(cases)('matches Intl in %s', (name, from, to) => {
    const zone = new Zone(name);
    const intl = intlOffset(name);
    // An odd step lands on many different minutes and seconds.
    const step = 7 * HOUR + 13 * 60 + 17;
    // Mismatches are collected rather than asserted one by one, which is slow.
    const wrong: number[] = [];
    for (let t = from; t < to; t += step) if (zone.offset(t) !== intl(t)) wrong.push(t);
    // Every change is at the exact second Intl reports, with the right offsets.
    const changes = changesOf(zone, from, to);
    expect(changes.length).toBeGreaterThan(0);
    for (const at of changes) {
      const before = intl(at - 1);
      const after = intl(at);
      if (zone.offset(at - 1) !== before || zone.offset(at) !== after || before === after) wrong.push(at);
    }
    expect(wrong).toEqual([]);
  });

  it('resolves skipped and repeated wall times like a search over Intl', () => {
    const wrong: string[] = [];
    for (const [name, day] of [
      ['America/New_York', utc(2024, 3, 10)],
      ['America/New_York', utc(2024, 11, 3)],
      ['Australia/Lord_Howe', utc(2024, 4, 7)],
      ['Australia/Lord_Howe', utc(2024, 10, 6)],
      ['Asia/Kathmandu', utc(1986, 1, 1)],
      ['Pacific/Apia', utc(2011, 12, 30)],
    ] as const) {
      const zone = new Zone(name);
      const intl = intlOffset(name);
      for (let wall = day - 6 * HOUR; wall < day + 30 * HOUR; wall += 15 * 60) {
        // Every UTC time showing this wall time, from the offsets a day either side.
        const candidates = [wall - intl(wall - 86400), wall - intl(wall + 86400)];
        const valid = candidates.filter((t) => t + intl(t) === wall);
        const expected = valid.length > 0 ? Math.min(...valid) : Math.max(...candidates);
        if (zone.fromWall(wall) !== expected) wrong.push(`${name} ${wall}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('needs few Intl calls for long hourly histories', () => {
    const proto = Intl.DateTimeFormat.prototype;
    // `format` is a getter on the prototype, though TypeScript types it as a method.
    const format = vi.spyOn(proto as unknown as { format: object }, 'format', 'get');
    const formatToParts = vi.spyOn(proto, 'formatToParts');
    try {
      for (const name of ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu']) {
        const zone = new Zone(name);
        format.mockClear();
        formatToParts.mockClear();
        // 100k hourly bars, about 11 years. A lookup per hour would be 100k calls or more,
        // and sampling once a day about 4,500; sampling every three days needs about 2,000.
        const start = utc(2015, 1, 1);
        for (let i = 0; i < 100_000; i++) zone.wall(start + i * HOUR);
        const calls = format.mock.calls.length + formatToParts.mock.calls.length;
        expect(calls, name).toBeLessThan(3_000);
        // A second pass, and the conversions back, are answered from the cache.
        for (let i = 0; i < 100_000; i++) zone.fromWall(zone.wall(start + i * HOUR));
        expect(format.mock.calls.length + formatToParts.mock.calls.length, name).toBe(calls);
      }
    } finally {
      format.mockRestore();
      formatToParts.mockRestore();
    }
  });
});

describe('zone-aware time axis', () => {
  it('puts day boundaries at local midnight', () => {
    // 23:00 and 00:00 New York time on 2024-03-09/10.
    expect(tickWeight(utc(2024, 3, 10, 4), utc(2024, 3, 10, 5), newYork)).toBe(TickWeight.Day);
    expect(tickWeight(utc(2024, 3, 10, 4), utc(2024, 3, 10, 5), UTC)).toBe(TickWeight.Hour);
    expect(tickWeight(utc(2024, 3, 9, 23), utc(2024, 3, 10, 0), newYork)).toBe(TickWeight.Hour);
  });

  it('labels hours in local time across a DST jump', () => {
    // 01:00 EST is followed by 03:00 EDT.
    expect(formatTickLabel(utc(2024, 3, 10, 6), TickWeight.Hour, newYork)).toBe('01:00');
    expect(formatTickLabel(utc(2024, 3, 10, 7), TickWeight.Hour, newYork)).toBe('03:00');
    expect(formatTickLabel(utc(2024, 4, 1, 8), TickWeight.Hour, london)).toBe('09:00');
    expect(formatCrosshairTime(utc(2024, 4, 6, 15), 3600, sydney)).toBe('2024-04-07 02:00');
    expect(formatCrosshairTime(utc(2024, 4, 6, 15), 86400, sydney)).toBe('2024-04-07');
  });

  it('keeps daily bars on local days through a 23-hour day', () => {
    // London local midnights 2024-03-29 … 2024-04-02; 31 March has 23 hours.
    const times = [29, 30, 31].map((d) => utc(2024, 3, d)).concat([utc(2024, 3, 31, 23), utc(2024, 4, 1, 23)]);
    const weights = computeTickWeights(times, london);
    expect(Array.from(weights.slice(1))).toEqual([TickWeight.Day, TickWeight.Day, TickWeight.Month, TickWeight.Day]);
    expect(formatTickLabel(times[3]!, TickWeight.Month, london)).toBe('Apr');
    expect(formatTickLabel(times[4]!, TickWeight.Day, london)).toBe('2');
  });

  it('recomputes weights when the timeline zone changes', () => {
    const tl = new Timeline();
    tl.set([utc(2024, 3, 10, 4), utc(2024, 3, 10, 5)]);
    expect(tl.weights[1]).toBe(TickWeight.Hour);
    tl.setZone(newYork, null);
    expect(tl.weights[1]).toBe(TickWeight.Day);
  });

  it('collapses weekend gaps because the timeline is index based', () => {
    const tl = new Timeline();
    tl.setZone(newYork, compileSession(hours([['09:30', '16:00']], WEEKDAYS)));
    // Friday 15:30 and Monday 09:30 New York time.
    const friday = utc(2024, 3, 8, 20, 30);
    const monday = utc(2024, 3, 11, 13, 30);
    tl.set([friday - 1800, friday, monday, monday + 900]);
    expect(tl.indexFromTime(monday) - tl.indexFromTime(friday)).toBe(1);
    expect(tl.weights[2]).toBe(TickWeight.Day);
    expect(tl.weights[3]).toBe(TickWeight.QuarterHour);
  });
});

describe('session schedules', () => {
  const weekdays = (start: string, end: string) =>
    Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [{ start, end }]]));
  const regular = compileSession({ weekly: weekdays('09:30', '16:00') });
  const overnight = compileSession({ weekly: weekdays('18:00', '17:00') });
  const dayOf = (y: number, mo: number, d: number) => Math.floor(utc(y, mo, d) / 86400);

  it('treats an always-open schedule as no session', () => {
    expect(compileSession(ALWAYS_OPEN)).toBeNull();
    expect(compileSession({ ...ALWAYS_OPEN, holidays: ['2024-12-25'] })).not.toBeNull();
    expect(inSession(null, 0)).toBe(true);
  });

  it('applies weekday ranges, with closed days for missing weekdays', () => {
    // Wall times, read with UTC fields. 2024-03-11 is a Monday.
    expect(inSession(regular, utc(2024, 3, 11, 9, 30))).toBe(true);
    expect(inSession(regular, utc(2024, 3, 11, 15, 59))).toBe(true);
    expect(inSession(regular, utc(2024, 3, 11, 16))).toBe(false);
    expect(inSession(regular, utc(2024, 3, 9, 12))).toBe(false); // Saturday
    // A short Friday on its own.
    const s = compileSession({ weekly: { ...weekdays('09:30', '16:00'), fri: [{ start: '09:30', end: '13:00' }] } });
    expect(inSession(s, utc(2024, 3, 15, 14))).toBe(false);
    expect(inSession(s, utc(2024, 3, 14, 14))).toBe(true);
  });

  it('assigns overnight ranges to the next trading day', () => {
    const sunday1830 = utc(2024, 3, 10, 18, 30);
    const monday = dayOf(2024, 3, 11);
    expect(tradingDay(overnight, sunday1830)).toBe(monday);
    expect(tradingDay(overnight, utc(2024, 3, 11, 16, 59))).toBe(monday);
    expect(inSession(overnight, sunday1830)).toBe(true);
    expect(inSession(overnight, utc(2024, 3, 11, 17, 30))).toBe(false); // daily break
    expect(inSession(overnight, utc(2024, 3, 9, 12))).toBe(false); // Saturday
    // Friday evening opens no Saturday session, so it stays on Friday.
    expect(tradingDay(overnight, utc(2024, 3, 15, 18, 30))).toBe(dayOf(2024, 3, 15));
    expect(inSession(overnight, utc(2024, 3, 15, 18, 30))).toBe(false);
  });

  it('opens the trading day at the overnight range, whatever the range order', () => {
    const s = compileSession({
      weekly: {
        tue: [
          { start: '09:30', end: '16:00' },
          { start: '18:00', end: '02:00' },
        ],
        wed: [{ start: '18:00', end: '02:00' }],
      },
    });
    const tuesday = dayOf(2024, 3, 12);
    const at = (h: number, m = 0) => utc(2024, 3, 12, h, m);
    expect(tradingDay(s, utc(2024, 3, 11, 18))).toBe(tuesday); // Monday evening
    expect(tradingDay(s, at(1))).toBe(tuesday);
    expect(tradingDay(s, at(10))).toBe(tuesday);
    expect(tradingDay(s, at(15, 59))).toBe(tuesday);
    expect(tradingDay(s, at(18))).toBe(tuesday + 1);
    expect(inSession(s, at(1))).toBe(true);
    expect(inSession(s, at(3))).toBe(false);
    expect(inSession(s, at(10))).toBe(true);
    expect(inSession(s, at(17))).toBe(false);
    expect(inSession(s, at(23))).toBe(true);
    // On a New York axis the day boundary sits at 18:00, not between the 09:30 bars.
    const ny = (h: number, m = 0) => newYork.fromWall(at(h, m));
    expect(tickWeight(ny(9, 30), ny(10), newYork, s)).toBe(TickWeight.Hour);
    expect(tickWeight(ny(15, 30), ny(18), newYork, s)).toBe(TickWeight.Day);
    expect(formatTickLabel(ny(10), TickWeight.Day, newYork, s)).toBe('12');
  });

  it('closes holidays, and lets overrides win over them', () => {
    const s = compileSession({
      weekly: weekdays('18:00', '17:00'),
      holidays: ['2024-03-12', '2024-03-13'],
      overrides: { '2024-03-13': [{ start: '18:00', end: '12:00' }], '2024-03-14': [] },
    });
    // Tuesday 12th is a holiday: Monday evening stays on Monday and is closed.
    expect(tradingDay(s, utc(2024, 3, 11, 18, 30))).toBe(dayOf(2024, 3, 11));
    expect(inSession(s, utc(2024, 3, 11, 18, 30))).toBe(false);
    expect(inSession(s, utc(2024, 3, 12, 10))).toBe(false);
    // Wednesday 13th is a holiday with an override: a half day ending at noon.
    expect(tradingDay(s, utc(2024, 3, 12, 18, 30))).toBe(dayOf(2024, 3, 13));
    expect(inSession(s, utc(2024, 3, 13, 11))).toBe(true);
    expect(inSession(s, utc(2024, 3, 13, 13))).toBe(false);
    // Thursday 14th is closed by an empty override.
    expect(inSession(s, utc(2024, 3, 14, 10))).toBe(false);
    expect(inSession(s, utc(2024, 3, 15, 10))).toBe(true);
  });

  it('rejects malformed schedules', () => {
    const one = (start: string, end: string) => ({ weekly: { mon: [{ start, end }] } });
    expect(() => compileSession(one('9:30', '16:00'))).toThrow();
    expect(() => compileSession(one('24:00', '01:00'))).toThrow();
    expect(() => compileSession(one('09:30', '24:30'))).toThrow();
    expect(compileSession(one('18:00', '24:00'))).not.toBeNull();
    const two = (a: [string, string], b: [string, string]) => ({
      weekly: { mon: [a, b].map(([start, end]) => ({ start, end })) },
    });
    expect(() => compileSession(two(['18:00', '02:00'], ['22:00', '01:00']))).toThrow(/past midnight/);
    expect(() => compileSession(two(['09:30', '16:00'], ['15:00', '17:00']))).toThrow(/overlap/);
    expect(() => compileSession(two(['01:00', '16:00'], ['18:00', '02:00']))).toThrow(/overlap/);
    expect(() => compileSession({ weekly: {}, holidays: ['2024-02-30'] })).toThrow(/date/);
    expect(() => compileSession({ weekly: {}, overrides: { '24-01-01': [] } })).toThrow(/date/);
  });

  it('starts the trading day at the session open on the axis', () => {
    const s = compileSession(hours([['18:00', '17:00']]));
    // Wall times in UTC: 16:00 → 18:00 crosses the open, 23:00 → 00:00 does not.
    expect(tickWeight(utc(2024, 3, 11, 16), utc(2024, 3, 11, 18), UTC, s)).toBe(TickWeight.Day);
    expect(tickWeight(utc(2024, 3, 11, 23), utc(2024, 3, 12, 0), UTC, s)).toBe(TickWeight.Hour);
    // The day label names the trading day.
    expect(formatTickLabel(utc(2024, 3, 11, 18), TickWeight.Day, UTC, s)).toBe('12');
  });
});
