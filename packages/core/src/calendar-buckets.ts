import type { Interval } from './data/types';
import { calendarMonths, intervalSeconds } from './data/interval';
import { CalendarBuckets, MIN_BUCKET_PX } from './lod';
import type { Timeline } from './timeline';
import type { Time } from './types';
import { tradingDay, type CompiledSession } from './util/session';
import type { Zone } from './util/timezone';

const DAY = 86400;

/** The steps calendar grouping picks from, finest first. */
export const DEFAULT_CALENDAR_STEPS: readonly Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

/** Length of `step` in seconds; months count as 30 days, for ordering and estimates only. */
export function approxSeconds(step: Interval): number {
  const months = calendarMonths(step);
  return months !== null ? months * 30 * DAY : intervalSeconds(step);
}

/**
 * A number that is the same for every bar in one period of `step` and changes
 * at its boundaries. Days, weeks and months are trading days in `zone` (an
 * overnight session's evening bars belong to the next day), weeks start on
 * Monday; shorter steps follow the wall clock in `zone`.
 */
export function periodOf(time: Time, step: Interval, zone: Zone, session: CompiledSession | null): number {
  const wall = zone.wall(time);
  const months = calendarMonths(step);
  if (months !== null) {
    const date = new Date(tradingDay(session, wall) * DAY * 1000);
    return Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth()) / months);
  }
  const seconds = intervalSeconds(step);
  if (seconds < DAY) return Math.floor(wall / seconds);
  const day = tradingDay(session, wall);
  // Day 0 (1970-01-01) was a Thursday: shifting by 3 puts week boundaries on Mondays.
  return seconds % (7 * DAY) === 0 ? Math.floor((day + 3) / (seconds / DAY)) : Math.floor(day / (seconds / DAY));
}

interface StepCache {
  starts: Int32Array;
  count: number;
  /** Bars covered; later bars extend the cache. */
  length: number;
  lastTime: Time;
  lastPeriod: number;
  buckets: CalendarBuckets;
}

/**
 * Calendar buckets of the main timeline per step, made on first use and
 * extended as bars are appended, so a live bar costs O(1). Anything else
 * (another timezone or session, prepended history) starts over with a new key.
 */
export class CalendarBucketing {
  readonly #steps = new Map<Interval, StepCache>();
  #zone: Zone | null = null;
  #session: CompiledSession | null = null;
  private firstTime: Time | undefined = undefined;
  /** Bumped on every start-over, so bucket keys never repeat across boundaries. */
  #generation = 0;

  /** The buckets of `step` over `timeline`. */
  buckets(timeline: Timeline, step: Interval): CalendarBuckets {
    const times = timeline.times;
    const n = times.length;
    if (timeline.zone !== this.#zone || timeline.session !== this.#session || times[0] !== this.firstTime) {
      this.#steps.clear();
      this.#zone = timeline.zone;
      this.#session = timeline.session;
      this.firstTime = times[0];
      this.#generation++;
    }
    let cache = this.#steps.get(step);
    // Fewer bars, or a different bar where the cache ends: not an append.
    if (cache && (n < cache.length || (cache.length > 0 && times[cache.length - 1] !== cache.lastTime))) cache = undefined;
    if (!cache) {
      cache = { starts: new Int32Array(64), count: 0, length: 0, lastTime: NaN, lastPeriod: NaN, buckets: null! };
      this.#steps.set(step, cache);
    }
    if (cache.length === n && cache.buckets) return cache.buckets;
    for (let i = cache.length; i < n; i++) {
      const period = periodOf(times[i]!, step, timeline.zone, timeline.session);
      if (i === 0 || period !== cache.lastPeriod) {
        if (cache.count === cache.starts.length) {
          const grown = new Int32Array(cache.starts.length * 2);
          grown.set(cache.starts);
          cache.starts = grown;
        }
        cache.starts[cache.count++] = i;
        cache.lastPeriod = period;
      }
    }
    cache.length = n;
    cache.lastTime = times[n - 1] ?? NaN;
    cache.buckets = new CalendarBuckets(`c${this.#generation}:${step}`, cache.starts, cache.count, n);
    return cache.buckets;
  }

  /**
   * The finest of `steps` longer than the bar interval whose buckets average
   * at least `MIN_BUCKET_PX` device px at `spacing` device px per bar, else
   * the coarsest such step; null when bars are already that wide or no step
   * is longer than the interval.
   */
  pick(timeline: Timeline, steps: readonly Interval[], spacing: number): Interval | null {
    const n = timeline.length;
    if (n === 0 || !(spacing > 0) || spacing >= MIN_BUCKET_PX) return null;
    const coarser = [...steps].filter((s) => approxSeconds(s) > timeline.interval).sort((a, b) => approxSeconds(a) - approxSeconds(b));
    for (const step of coarser) {
      // Bars per bucket as the data has them, so session gaps and short days count.
      if ((n / this.buckets(timeline, step).count) * spacing >= MIN_BUCKET_PX) return step;
    }
    return coarser[coarser.length - 1] ?? null;
  }
}
