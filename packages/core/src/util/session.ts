import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
const DAY = 86400;
const DAY_MINUTES = 1440;

/** Day of the week, as used for the keys of `SessionSchedule.weekly`. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** ISO weekday order: index 0 is Monday. */
const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Trading hours within one trading day, as `'HH:MM'` wall-clock times in the
 * session's timezone. When `end` is at or before `start` the range is
 * overnight: it starts the evening before the trading day and ends on it.
 * Use `'24:00'` as `end` for a range that runs to midnight on the same day.
 */
export interface SessionRange {
  start: string;
  end: string;
}

/**
 * When a market trades, in the chart's timezone.
 *
 * Days are trading days: an overnight range listed under `mon` starts on
 * Sunday evening, and its bars belong to Monday.
 */
export interface SessionSchedule {
  /** Ranges per weekday of the trading day. A missing or empty day is closed. */
  weekly: Partial<Record<Weekday, SessionRange[]>>;
  /** ISO dates (`'2024-12-25'`) of trading days with no session. */
  holidays?: string[];
  /**
   * One-day replacements for `weekly`, keyed by the ISO date of the trading
   * day. They win over `holidays`; an empty list closes the day.
   */
  overrides?: Record<string, SessionRange[]>;
}

const allDay = (): SessionRange[] => [{ start: '00:00', end: '24:00' }];

/** Trades around the clock, every day (the default `session`). */
export const ALWAYS_OPEN: SessionSchedule = Object.freeze({
  weekly: Object.freeze(Object.fromEntries(WEEKDAYS.map((d) => [d, allDay()]))),
});

/** One trading day's hours, in minutes of the wall-clock day. */
export interface DayHours {
  /** Ranges on the trading day's own calendar date, sorted, as [start, end). */
  ranges: [number, number][];
  /** Range that starts at `[0]` the evening before and ends at `[1]` on the trading day. */
  overnight: [number, number] | null;
}

/** A `SessionSchedule` validated and prepared for fast lookups; build it with `compileSession`. */
export interface CompiledSession {
  /** Hours per weekday, index 0 = Monday; null when closed. */
  readonly weekly: readonly (DayHours | null)[];
  /** Day numbers (days since 1970-01-01) of holidays. */
  readonly holidays: ReadonlySet<number>;
  /** Day number to the hours that replace that day's weekly hours. */
  readonly overrides: ReadonlyMap<number, DayHours | null>;
  /** Some day has an overnight range, so trading days can start the evening before. */
  readonly hasOvernight: boolean;
}

/**
 * Validate a schedule and prepare it for `tradingDay` and `inSession`.
 * Returns null when the schedule is always open. Throws on malformed times
 * or dates, overlapping ranges, or more than one overnight range in a day.
 */
export function compileSession(schedule: SessionSchedule): CompiledSession | null {
  const weekly = WEEKDAYS.map((d) => dayHours(schedule.weekly[d], d));
  const holidays = new Set((schedule.holidays ?? []).map(isoDay));
  const overrides = new Map<number, DayHours | null>();
  for (const [date, ranges] of Object.entries(schedule.overrides ?? {})) overrides.set(isoDay(date), dayHours(ranges, date));
  const allDayOpen = (h: DayHours | null) =>
    h !== null && !h.overnight && h.ranges.length === 1 && h.ranges[0]![0] === 0 && h.ranges[0]![1] === DAY_MINUTES;
  if (holidays.size === 0 && overrides.size === 0 && weekly.every(allDayOpen)) return null;
  const hasOvernight = [...weekly, ...overrides.values()].some((h) => h?.overnight);
  return { weekly, holidays, overrides, hasOvernight };
}

/** Day number (days since 1970-01-01) of the trading day a wall-clock time belongs to. */
export function tradingDay(session: CompiledSession | null, wall: number): number {
  const day = Math.floor(wall / DAY);
  if (!session?.hasOvernight) return day;
  // Evening bars belong to tomorrow when tomorrow's overnight range has started.
  const next = hoursOf(session, day + 1)?.overnight;
  return next && minuteOf(wall, day) >= next[0] ? day + 1 : day;
}

/** Whether a wall-clock time falls inside the session (always true without one). */
export function inSession(session: CompiledSession | null, wall: number): boolean {
  if (!session) return true;
  const day = Math.floor(wall / DAY);
  // Assigned to tomorrow means inside tomorrow's overnight range, which runs to midnight.
  if (tradingDay(session, wall) !== day) return true;
  const hours = hoursOf(session, day);
  if (!hours) return false;
  const minute = minuteOf(wall, day);
  if (hours.overnight && minute < hours.overnight[1]) return true;
  return hours.ranges.some(([a, b]) => minute >= a && minute < b);
}

/**
 * Trading intervals as wall-clock seconds `[start, end)`, sorted and merged
 * where they touch, for the trading days `fromDay` to `toDay` (day numbers).
 * An overnight range starts the evening before its trading day.
 */
export function sessionIntervals(session: CompiledSession, fromDay: number, toDay: number): [number, number][] {
  const out: [number, number][] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const hours = hoursOf(session, day);
    if (!hours) continue;
    const base = day * DAY;
    if (hours.overnight) out.push([base - DAY + hours.overnight[0] * 60, base + hours.overnight[1] * 60]);
    for (const [a, b] of hours.ranges) out.push([base + a * 60, base + b * 60]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Whether trading day `day` (day number) has any session hours. */
export function isTradingDay(session: CompiledSession, day: number): boolean {
  return hoursOf(session, day) !== null;
}

/**
 * Wall-clock second the session is next open at or after `wall`: `wall` itself
 * when it is in session, else the next range's start. Null when nothing opens
 * within a year.
 */
export function nextSessionOpen(session: CompiledSession, wall: number): number | null {
  if (inSession(session, wall)) return wall;
  const day = Math.floor(wall / DAY);
  // A week at a time: overnight ranges of a trading day start the evening before it.
  for (let from = day; from <= day + 366; from += 7) {
    for (const [start] of sessionIntervals(session, from, from + 7)) if (start >= wall) return start;
  }
  return null;
}

/* ------------------------------- internals ------------------------------- */

function hoursOf(session: CompiledSession, day: number): DayHours | null {
  const override = session.overrides.size > 0 ? session.overrides.get(day) : undefined;
  if (override !== undefined) return override;
  if (session.holidays.has(day)) return null;
  return session.weekly[(((day + 3) % 7) + 7) % 7] ?? null; // 1970-01-01 was a Thursday (index 3).
}

function minuteOf(wall: number, day: number): number {
  return Math.floor((wall - day * DAY) / 60);
}

/** Minutes of the day for `'HH:MM'`; `'24:00'` only where `allowEnd`. */
function parseClock(text: string, allowEnd: boolean, where: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  const valid = h < 24 ? min <= 59 : allowEnd && h === 24 && min === 0;
  if (!valid) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid session time "${text}" (${where}), expected HH:MM` : '');
  return h * 60 + min;
}

function dayHours(list: SessionRange[] | undefined, where: string): DayHours | null {
  if (!list || list.length === 0) return null;
  const ranges: [number, number][] = [];
  let overnight: [number, number] | null = null;
  for (const r of list) {
    const start = parseClock(r.start, false, where);
    const end = parseClock(r.end, true, where);
    if (end > start) {
      ranges.push([start, end]);
    } else if (overnight) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid session (${where}): only one range may run past midnight` : '');
    } else {
      overnight = [start, end];
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  // Laid on one clock face, no two ranges may overlap: the overnight range's
  // evening part shares the clock with the previous day's ranges.
  const face: [number, number][] = overnight ? [[0, overnight[1]], ...ranges, [overnight[0], DAY_MINUTES]] : ranges;
  for (let i = 1; i < face.length; i++) {
    if (face[i]![0] < face[i - 1]![1]) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid session (${where}): ranges overlap` : '');
  }
  return { ranges, overnight };
}

function isoDay(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!m || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid session date "${date}", expected YYYY-MM-DD` : '');
  return ms / 86400000;
}
