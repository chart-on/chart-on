import { ChartError } from '../errors';
import type { Time } from '../types';
import { UTC, zoneOf, type Zone } from '../util/timezone';
import type { ActivityUnit, Interval, IntervalRange, IntervalUnit } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Nominal unit lengths in seconds. Calendar units use an average: months 30 days, quarters 90, years 365. */
const UNIT_SECONDS: Record<IntervalUnit, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  M: 2592000,
  Q: 7776000,
  y: 31536000,
};

/** Months per calendar unit; the other units have a fixed length. */
const UNIT_MONTHS: Partial<Record<IntervalUnit, number>> = { M: 1, Q: 3, y: 12 };

const PATTERN = /^(\d*)([smhdwMQyTV])$/;

/** An interval split into its count and unit: '15m' → `{ count: 15, unit: 'm' }`, '100T' → `{ count: 100, unit: 'T' }`. */
export interface ParsedInterval {
  count: number;
  unit: IntervalUnit | ActivityUnit;
}

/**
 * Split an interval into count and unit. A missing count means 1 ('d' is
 * '1d'). Throws a `ChartError` with code `'invalid-interval'` for anything
 * else, such as '1x', '0m' or '1.5h'.
 */
export function parseInterval(interval: string): ParsedInterval {
  const m = PATTERN.exec(interval);
  const count = m ? Number(m[1] || 1) : NaN;
  if (!m || !(count > 0) || !Number.isSafeInteger(count)) {
    throw new ChartError('invalid-interval', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown interval "${interval}"` : '', { context: { interval } });
  }
  return { count, unit: m[2] as IntervalUnit | ActivityUnit };
}

/**
 * Whether `interval` counts trades ('100T') or volume ('5000V') rather than
 * time. Such bars have no fixed length: `intervalSeconds` throws for them,
 * `safeIntervalSeconds` returns null, and the chart shows no countdown.
 */
export function isActivityInterval(interval: string): boolean {
  return isInterval(interval) && /[TV]$/.test(interval);
}

/** Whether `value` is a time-based interval: one with a length in seconds. */
export function isTimeInterval(value: unknown): value is Interval {
  return isInterval(value) && !isActivityInterval(value);
}

/** Whether `value` is an interval the chart can parse; narrows an app's string to `Interval`. */
export function isInterval(value: unknown): value is Interval {
  if (typeof value !== 'string') return false;
  try {
    parseInterval(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nominal length of an interval in seconds: '15m' → 900. Calendar units use
 * an average length (months 30 days, quarters 90, years 365); their real bars
 * follow the calendar (see `intervalStart`). Throws an `'invalid-interval'`
 * `ChartError` for an activity interval such as '100T', which has no length.
 */
export function intervalSeconds(interval: string): number {
  const { count, unit } = parseInterval(interval);
  const seconds = UNIT_SECONDS[unit as IntervalUnit];
  if (seconds === undefined) {
    throw new ChartError('invalid-interval', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Interval "${interval}" has no length in seconds` : '', { context: { interval } });
  }
  return count * seconds;
}

/** `intervalSeconds`, or null for an interval name the chart cannot parse (such as a custom one) or an activity interval. */
export function safeIntervalSeconds(interval: string): number | null {
  try {
    return intervalSeconds(interval);
  } catch {
    return null;
  }
}

/** A copy of `value` when it is a valid interval range (`from` no longer than `to`), else null. */
export function intervalRangeOf(value: unknown): IntervalRange | null {
  if (typeof value !== 'object' || value === null) return null;
  const { from, to } = value as Record<string, unknown>;
  if (!isTimeInterval(from) || !isTimeInterval(to) || intervalSeconds(from) > intervalSeconds(to)) return null;
  return { from, to };
}

/** Whether an interval of `seconds` lies in one of `ranges`; no ranges means every interval. */
export function inIntervalRanges(ranges: readonly IntervalRange[] | undefined, seconds: number): boolean {
  if (!ranges || ranges.length === 0) return true;
  return ranges.some((r) => seconds >= intervalSeconds(r.from) && seconds <= intervalSeconds(r.to));
}

/** Months in one bar of a calendar interval ('1M', '1Q', '1y'...), or null for a fixed-length one. */
export function calendarMonths(interval: string): number | null {
  const { count, unit } = parseInterval(interval);
  const months = UNIT_MONTHS[unit as IntervalUnit];
  return months === undefined ? null : count * months;
}

/** Whether bars of `interval` follow the calendar (months, quarters, years) rather than a fixed length. */
export function isCalendarInterval(interval: string): boolean {
  return calendarMonths(interval) !== null;
}

/**
 * Start of the bar of `interval` that holds `time`. Calendar bars start on
 * the first day of their month, quarter (January, April, July, October) or
 * year in `zone`, `open` seconds after midnight wall-clock time (the session
 * open; negative for a session that opens the evening before). Bars of
 * several months are counted from January of year 0, so '6M' starts in
 * January and July. Fixed-length bars are multiples of their length since
 * the unix epoch, whatever `zone`.
 */
export function intervalStart(time: Time, interval: Interval, zone: Zone = UTC, open = 0): Time {
  const months = calendarMonths(interval);
  if (months === null) {
    const length = intervalSeconds(interval);
    return Math.floor(time / length) * length;
  }
  const wall = new Date((zone.wall(time) - open) * 1000);
  const index = Math.floor((wall.getUTCFullYear() * 12 + wall.getUTCMonth()) / months) * months;
  const year = Math.floor(index / 12);
  return zone.fromWall(Date.UTC(year, index - year * 12, 1) / 1000 + open);
}

/**
 * Start of the bar after the one that starts at `start`. A calendar bar
 * moves on by its months in `zone` and keeps its wall-clock time of day, so
 * DST and month lengths are respected; a day past the end of a shorter month
 * becomes its last day. A fixed-length bar adds its length.
 */
export function nextIntervalStart(start: Time, interval: Interval, zone: Zone = UTC): Time {
  const months = calendarMonths(interval);
  if (months === null) return start + intervalSeconds(interval);
  const wall = new Date(zone.wall(start) * 1000);
  const year = wall.getUTCFullYear();
  const month = wall.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(wall.getUTCDate(), lastDay);
  const next = Date.UTC(year, month, day, wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds()) / 1000;
  return zone.fromWall(next);
}

/**
 * The supported interval to show when `requested` may not be supported:
 * `requested` itself when `supported` lists it or lists no interval the
 * chart can parse (any interval then), else the one nearest by nominal
 * length, compared as a ratio so 1h is as far from 30m as from 2h. A tie
 * goes to the shorter interval. Activity intervals ('100T', '5000V') have
 * no length: an unlisted one becomes the listed one of the same unit nearest
 * in count, else the shortest listed time interval. When `supported` lists
 * no time interval and nothing of the same unit, the first listed one wins.
 * The result is always listed.
 */
export function nearestInterval(requested: Interval, supported: readonly string[] | undefined): Interval {
  const listed = (supported ?? []).filter(isInterval);
  if (listed.length === 0 || listed.includes(requested)) return requested;
  const valid = listed.filter(isTimeInterval);
  if (valid.length === 0 || isActivityInterval(requested)) {
    const { count, unit } = parseInterval(requested);
    const off = (interval: string) => Math.abs(Math.log(parseInterval(interval).count / count));
    let near: Interval | undefined;
    for (const interval of listed) {
      if (parseInterval(interval).unit === unit && (!near || off(interval) < off(near))) near = interval;
    }
    if (near) return near;
    if (valid.length === 0) return listed[0]!;
  }
  // An activity interval has no length: aim at 1 second (log 0), so the shortest wins.
  const target = isActivityInterval(requested) ? 0 : Math.log(intervalSeconds(requested));
  let best = valid[0]!;
  let bestDistance = Infinity;
  for (const interval of valid) {
    const length = Math.log(intervalSeconds(interval));
    const distance = Math.abs(length - target);
    const closer = distance < bestDistance - 1e-9;
    const tieShorter = Math.abs(distance - bestDistance) <= 1e-9 && length < Math.log(intervalSeconds(best));
    if (closer || tieShorter) {
      best = interval;
      bestDistance = distance;
    }
  }
  return best;
}

/** The zone for a symbol's calendar bars: its `timezone`, or UTC when it has none or an unknown one. */
export function symbolZone(timezone: string | undefined): Zone {
  if (!timezone) return UTC;
  try {
    return zoneOf(timezone);
  } catch {
    return UTC;
  }
}
