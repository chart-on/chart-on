import { describe, expect, it } from 'vitest';
import { marketPhase } from '../src/util/market';
import { ALWAYS_OPEN, compileSession, sessionIntervals, type SessionSchedule } from '../src/util/session';
import { UTC, zoneOf } from '../src/util/timezone';
import { hours, WEEKDAYS } from './sessions';

const regular = compileSession(hours([['09:30', '16:00']], WEEKDAYS));
const extended = compileSession(hours([['04:00', '20:00']], WEEKDAYS));
/** Unix seconds of a UTC wall-clock time. */
const utc = (iso: string) => Date.parse(`${iso}Z`) / 1000;

describe('marketPhase', () => {
  it('is always open without a session', () => {
    expect(marketPhase(null, null, UTC, utc('2024-03-06T03:00:00'))).toEqual({ phase: 'open', next: null });
  });

  it('walks a weekday through pre-market, regular hours, after hours and closed', () => {
    // 2024-03-06 is a Wednesday.
    expect(marketPhase(regular, extended, UTC, utc('2024-03-06T03:00:00'))).toEqual({
      phase: 'closed',
      next: { phase: 'pre', time: utc('2024-03-06T04:00:00') },
    });
    expect(marketPhase(regular, extended, UTC, utc('2024-03-06T08:00:00'))).toEqual({
      phase: 'pre',
      next: { phase: 'open', time: utc('2024-03-06T09:30:00') },
    });
    expect(marketPhase(regular, extended, UTC, utc('2024-03-06T10:00:00'))).toEqual({
      phase: 'open',
      next: { phase: 'post', time: utc('2024-03-06T16:00:00') },
    });
    expect(marketPhase(regular, extended, UTC, utc('2024-03-06T17:00:00'))).toEqual({
      phase: 'post',
      next: { phase: 'closed', time: utc('2024-03-06T20:00:00') },
    });
  });

  it('works with separate pre- and post-market ranges', () => {
    const split = compileSession(hours([['04:00', '09:30'], ['16:00', '20:00']], WEEKDAYS));
    expect(marketPhase(regular, split, UTC, utc('2024-03-06T08:00:00')).phase).toBe('pre');
    expect(marketPhase(regular, split, UTC, utc('2024-03-06T10:00:00')).next).toEqual({ phase: 'post', time: utc('2024-03-06T16:00:00') });
    expect(marketPhase(regular, split, UTC, utc('2024-03-06T17:00:00')).phase).toBe('post');
  });

  it('closes over the weekend without extended hours', () => {
    // Friday after the close: next open is Monday.
    expect(marketPhase(regular, null, UTC, utc('2024-03-08T17:00:00'))).toEqual({
      phase: 'closed',
      next: { phase: 'open', time: utc('2024-03-11T09:30:00') },
    });
    expect(marketPhase(regular, null, UTC, utc('2024-03-08T15:00:00')).next).toEqual({ phase: 'closed', time: utc('2024-03-08T16:00:00') });
  });

  it('skips holidays and follows one-day overrides', () => {
    const schedule: SessionSchedule = {
      ...hours([['09:30', '16:00']], WEEKDAYS),
      holidays: ['2024-03-07'],
      overrides: { '2024-03-08': [{ start: '09:30', end: '13:00' }] },
    };
    const s = compileSession(schedule);
    expect(marketPhase(s, null, UTC, utc('2024-03-06T17:00:00')).next).toEqual({ phase: 'open', time: utc('2024-03-08T09:30:00') });
    expect(marketPhase(s, null, UTC, utc('2024-03-08T10:00:00')).next).toEqual({ phase: 'closed', time: utc('2024-03-08T13:00:00') });
  });

  it('handles overnight sessions', () => {
    // Trading days Monday to Friday, each starting at 18:00 the evening before.
    const s = compileSession(hours([['18:00', '17:00']], WEEKDAYS));
    // Sunday 19:00 is inside Monday's session.
    expect(marketPhase(s, null, UTC, utc('2024-03-10T19:00:00'))).toEqual({
      phase: 'open',
      next: { phase: 'closed', time: utc('2024-03-11T17:00:00') },
    });
    // The daily break.
    expect(marketPhase(s, null, UTC, utc('2024-03-11T17:30:00')).next).toEqual({ phase: 'open', time: utc('2024-03-11T18:00:00') });
  });

  it('reports after hours once regular hours closed inside a 24x5 extended stretch', () => {
    const allWeek = compileSession(hours([['00:00', '24:00']], WEEKDAYS));
    // Wednesday evening: the stretch began Monday, but regular hours closed at 16:00.
    expect(marketPhase(regular, allWeek, UTC, utc('2024-03-06T17:00:00'))).toEqual({
      phase: 'post',
      next: { phase: 'open', time: utc('2024-03-07T09:30:00') },
    });
    // Monday morning, before the week's first close: pre-market.
    expect(marketPhase(regular, allWeek, UTC, utc('2024-03-11T08:00:00'))).toEqual({
      phase: 'pre',
      next: { phase: 'open', time: utc('2024-03-11T09:30:00') },
    });
    // Friday evening: the stretch ends at midnight, before Monday's open.
    expect(marketPhase(regular, allWeek, UTC, utc('2024-03-08T17:00:00'))).toEqual({
      phase: 'post',
      next: { phase: 'closed', time: utc('2024-03-09T00:00:00') },
    });
  });

  it('takes schedules and treats an always-open extended schedule as extended hours all day', () => {
    const always = ALWAYS_OPEN;
    expect(marketPhase(hours([['09:30', '16:00']], WEEKDAYS), always, UTC, utc('2024-03-06T17:00:00'))).toEqual({
      phase: 'post',
      next: { phase: 'open', time: utc('2024-03-07T09:30:00') },
    });
    // Saturday: still extended hours; the next change is Monday's open.
    expect(marketPhase(regular, always, UTC, utc('2024-03-09T12:00:00'))).toEqual({
      phase: 'post',
      next: { phase: 'open', time: utc('2024-03-11T09:30:00') },
    });
    expect(marketPhase(always, null, UTC, utc('2024-03-09T12:00:00'))).toEqual({ phase: 'open', next: null });
  });

  it('keeps wall-clock hours across a DST change', () => {
    const ny = zoneOf('America/New_York');
    // 2024-03-10 is the US spring-forward Sunday. Friday's close is 16:00 EST (21:00 UTC),
    // Monday's open 09:30 EDT (13:30 UTC).
    expect(marketPhase(regular, null, ny, utc('2024-03-08T22:00:00'))).toEqual({
      phase: 'closed',
      next: { phase: 'open', time: utc('2024-03-11T13:30:00') },
    });
    expect(marketPhase(regular, null, ny, utc('2024-03-08T20:00:00')).next).toEqual({ phase: 'closed', time: utc('2024-03-08T21:00:00') });
  });
});

describe('sessionIntervals', () => {
  it('merges ranges that touch across midnight', () => {
    const allWeek = compileSession(hours([['00:00', '24:00']], WEEKDAYS));
    // Monday 2024-03-11 to Friday: one stretch from Monday 00:00 to Saturday 00:00.
    const monday = utc('2024-03-11T00:00:00') / 86400;
    expect(sessionIntervals(allWeek!, monday, monday + 6)).toEqual([[monday * 86400, (monday + 5) * 86400]]);
  });
});
