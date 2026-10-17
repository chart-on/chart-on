import type { Bar, Time } from '../types';
import { compileSession, inSession, sessionIntervals, tradingDay, type CompiledSession, type SessionSchedule } from '../util/session';
import { UTC, type Zone } from '../util/timezone';
import { intervalSeconds, intervalStart, parseInterval, symbolZone } from './interval';
import type { Interval } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

const DAY = 86400;

/** One trade from a trade stream: when, at what price, and optionally how much and which side was the aggressor. */
export interface TradeTick {
  /** Unix seconds; fractions are fine. */
  time: Time;
  price: number;
  /** Traded quantity; added to the bar's `volume`. */
  size?: number;
  /** Aggressor side; buy-side sizes also add to the bar's `buyVolume`. */
  side?: 'buy' | 'sell';
}

/** How time is grouped into bars: the bar interval, the timezone of daily and longer bars, and optional trading hours. */
export interface BarBucketOptions {
  /** The interval of the bars built. */
  interval: Interval;
  /** IANA timezone that daily and longer bars follow (usually the symbol's `timezone`); UTC when unset or unknown. */
  timezone?: string;
  /**
   * Trading hours, in `timezone`. Intraday bars then start at each session
   * range's open (a 1h bar of a 09:30 open runs 09:30 to 10:30), daily and
   * longer bars group by trading day (an overnight session's evening belongs
   * to the next day), and anything outside the session is dropped.
   */
  session?: SessionSchedule;
}

/**
 * Finds the bar a time belongs to. Returns the bar's start time, or null when
 * the time is outside the session.
 */
export type BarBucket = (time: Time) => Time | null;

/**
 * The bucketing rule used by `createBarBuilder` and `resampleBars`, for apps
 * that group data themselves. Intraday bars (seconds, minutes, hours) are
 * multiples of their length since the unix epoch, or since the session range's
 * open with a session. Daily and longer bars start at midnight, in `timezone`,
 * of their first trading day: `Nd` counts days since 1970-01-01, weeks start
 * on Monday, and months, quarters and years follow the calendar.
 */
export function barBucket(options: BarBucketOptions): BarBucket {
  const { interval } = options;
  const { count, unit } = parseInterval(interval);
  // Activity intervals ('100T') have no time buckets: this throws for them.
  intervalSeconds(interval);
  const zone: Zone = options.timezone ? symbolZone(options.timezone) : UTC;
  const session = options.session ? compileSession(options.session) : null;
  if (unit === 's' || unit === 'm' || unit === 'h') {
    const length = intervalSeconds(interval);
    if (!session) return (time) => Math.floor(time / length) * length;
    return (time) => sessionBucket(time, length, zone, session);
  }
  return (time) => {
    const wall = zone.wall(time);
    if (!inSession(session, wall)) return null;
    const day = tradingDay(session, wall);
    let startDay: number;
    if (unit === 'd') startDay = Math.floor(day / count) * count;
    // Day 0 (1970-01-01) is a Thursday, so Monday-based week k starts on day 7k - 3.
    else if (unit === 'w') startDay = Math.floor((day + 3) / (7 * count)) * 7 * count - 3;
    // Calendar units: wall seconds through the UTC zone are the identity.
    else return zone.fromWall(intervalStart(day * DAY, interval));
    return zone.fromWall(startDay * DAY);
  };
}

/** Intraday bucket counted from the open of the session range holding `time`. */
function sessionBucket(time: Time, length: number, zone: Zone, session: CompiledSession): Time | null {
  const wall = zone.wall(time);
  if (!inSession(session, wall)) return null;
  const day = Math.floor(wall / DAY);
  // Two days either side cover overnight ranges and the merging of touching ones.
  const range = sessionIntervals(session, day - 1, day + 2).find(([a, b]) => wall >= a && wall < b);
  if (!range) return null;
  const open = range[0];
  return zone.fromWall(open + Math.floor((wall - open) / length) * length);
}

/**
 * Activity bars: a new bar every `ticks` trades or every `volume` units
 * traded, whatever the time. Give exactly one of the two.
 */
export interface ActivityBarOptions {
  /** Trades per bar: a whole number, at least 1. */
  ticks?: number;
  /** Volume per bar: a positive number. A trade larger than the room left in a bar is split across bars. */
  volume?: number;
  /**
   * Smallest step, in seconds, between the times of consecutive bars. A bar's
   * time is its first trade's time, moved forward by this much past the
   * previous bar when trades come faster than bars can have distinct times.
   * Default 0.001.
   */
  minGap?: number;
}

/** A bar built by activity rather than time; see `ActivityBarOptions`. */
export interface ActivityBar extends Bar {
  /**
   * The first trade's time, or the previous bar's time plus `minGap` when
   * that is later, so bar times always increase. Bars are unevenly spaced in
   * time; the time axis spaces them by index and labels their real times.
   */
  time: Time;
  /** Time of the bar's earliest trade. */
  startTime: Time;
  /** Time of the bar's latest trade so far. */
  endTime: Time;
}

/** Options for `createBarBuilder` and `tradesToBars`: time bars or activity bars. */
export type BarBuilderOptions = BarBucketOptions | ActivityBarOptions;

/** Builds live bars from a trade stream; see `createBarBuilder`. */
export interface BarBuilder<B extends Bar = Bar> {
  /**
   * Add a trade. Returns the bar it changed (a copy, to pass to a data
   * source's `onBar`), or null when the trade is dropped: outside the session,
   * older than the bar being built, or with an invalid time or price. A
   * volume bar trade that fills several bars returns the newest; `apply`
   * returns them all.
   */
  push(trade: TradeTick): B | null;
  /**
   * Add a trade and return every bar it changed, oldest first (copies). Empty
   * when the trade is dropped. Only a large trade into volume bars changes
   * more than one: it completes the bar being built and fills new ones.
   */
  apply(trade: TradeTick): B[];
  /** The bar being built, or null before the first trade. */
  readonly bar: B | null;
  /** Forget the bar being built, e.g. after a reconnect. */
  reset(): void;
}

/** Most bars one trade may fill, so a huge trade against a tiny volume cannot hang the page. */
const MAX_BARS_PER_TRADE = 10000;

/** Volume comparisons allow this fraction of the bar volume for floating point error. */
const VOLUME_EPS = 1e-9;

/**
 * Turn a trade stream into bars, for sources that stream trades rather than
 * bars. With `{ interval }`, each trade updates the bar of its period or
 * starts the next one; the open and close are the prices of the earliest and
 * latest trades by time, so trades arriving slightly out of order within a
 * bar keep the right open and close. Bars with no trades are skipped, not
 * filled. With `{ ticks }` or `{ volume }`, trades fill bars in the order
 * they arrive (see `ActivityBarOptions`).
 */
export function createBarBuilder(options: ActivityBarOptions): BarBuilder<ActivityBar>;
export function createBarBuilder(options: BarBucketOptions): BarBuilder;
export function createBarBuilder(options: BarBuilderOptions): BarBuilder | BarBuilder<ActivityBar>;
export function createBarBuilder(options: BarBuilderOptions): BarBuilder | BarBuilder<ActivityBar> {
  return isActivity(options) ? activityBuilder(options) : timeBuilder(options);
}

function isActivity(options: BarBuilderOptions): options is ActivityBarOptions {
  return !('interval' in options) || options.interval === undefined;
}

function timeBuilder(options: BarBucketOptions): BarBuilder {
  const bucket = barBucket(options);
  let bar: Bar | null = null;
  let firstTradeTime = Infinity;
  let lastTradeTime = -Infinity;
  const push = (trade: TradeTick): Bar | null => {
    if (!Number.isFinite(trade.time) || !Number.isFinite(trade.price)) return null;
    const start = bucket(trade.time);
    if (start === null || (bar && start < bar.time)) return null;
    const size = Number.isFinite(trade.size) ? trade.size! : 0;
    if (!bar || start > bar.time) {
      bar = { time: start, open: trade.price, high: trade.price, low: trade.price, close: trade.price };
      firstTradeTime = lastTradeTime = trade.time;
      if (trade.size !== undefined) bar.volume = 0;
      if (trade.side !== undefined) bar.buyVolume = 0;
    } else {
      bar.high = Math.max(bar.high, trade.price);
      bar.low = Math.min(bar.low, trade.price);
      if (trade.time < firstTradeTime) {
        bar.open = trade.price;
        firstTradeTime = trade.time;
      }
      if (trade.time >= lastTradeTime) {
        bar.close = trade.price;
        lastTradeTime = trade.time;
      }
    }
    if (trade.size !== undefined) bar.volume = (bar.volume ?? 0) + size;
    if (trade.side !== undefined) bar.buyVolume = (bar.buyVolume ?? 0) + (trade.side === 'buy' ? size : 0);
    return { ...bar };
  };
  return {
    push,
    apply(trade) {
      const bar = push(trade);
      return bar ? [bar] : [];
    },
    get bar() {
      return bar ? { ...bar } : null;
    },
    reset() {
      bar = null;
      firstTradeTime = Infinity;
      lastTradeTime = -Infinity;
    },
  };
}

function checkActivity(options: ActivityBarOptions): { ticks: number; volume: number; minGap: number } {
  const { ticks, volume, minGap = 0.001 } = options;
  if ((ticks === undefined) === (volume === undefined)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Activity bars need exactly one of ticks and volume' : '');
  }
  if (ticks !== undefined && !(Number.isSafeInteger(ticks) && ticks >= 1)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Activity bar ticks must be a whole number, at least 1' : '');
  }
  if (volume !== undefined && !(volume > 0 && Number.isFinite(volume))) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Activity bar volume must be a positive number' : '');
  }
  if (!(minGap > 0 && Number.isFinite(minGap))) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Activity bar minGap must be a positive number' : '');
  return { ticks: ticks ?? Infinity, volume: volume ?? Infinity, minGap };
}

function activityBuilder(options: ActivityBarOptions): BarBuilder<ActivityBar> {
  const { ticks, volume, minGap } = checkActivity(options);
  const byVolume = Number.isFinite(volume);
  let bar: ActivityBar | null = null;
  /** Trades in the bar being built. */
  let count = 0;
  /** Whether the bar being built has its trades or volume, so the next trade starts a new one. */
  let full = false;

  const open = (trade: TradeTick, price: number): ActivityBar => {
    const time = bar ? Math.max(trade.time, bar.time + minGap) : trade.time;
    const next: ActivityBar = { time, open: price, high: price, low: price, close: price, startTime: trade.time, endTime: trade.time };
    if (byVolume || trade.size !== undefined) next.volume = 0;
    if (trade.side !== undefined) next.buyVolume = 0;
    count = 0;
    full = false;
    return next;
  };

  /** Add `size` of `trade` to the bar being built. */
  const add = (b: ActivityBar, trade: TradeTick, size: number, withSize: boolean): void => {
    const p = trade.price;
    b.high = Math.max(b.high, p);
    b.low = Math.min(b.low, p);
    if (trade.time < b.startTime) {
      b.open = p;
      b.startTime = trade.time;
    }
    if (trade.time >= b.endTime) {
      b.close = p;
      b.endTime = trade.time;
    }
    if (withSize) b.volume = (b.volume ?? 0) + size;
    if (trade.side !== undefined) b.buyVolume = (b.buyVolume ?? 0) + (trade.side === 'buy' ? size : 0);
  };

  const apply = (trade: TradeTick): ActivityBar[] => {
    if (!Number.isFinite(trade.time) || !Number.isFinite(trade.price)) return [];
    const withSize = trade.size !== undefined;
    let left = Number.isFinite(trade.size) && trade.size! > 0 ? trade.size! : 0;
    const changed: ActivityBar[] = [];
    for (let i = 0; ; i++) {
      if (!bar || full) bar = open(trade, trade.price);
      count++;
      if (!byVolume) {
        add(bar, trade, left, withSize);
        full = count >= ticks;
        changed.push({ ...bar });
        return changed;
      }
      const room = volume - (bar.volume ?? 0);
      // The last bar a trade may fill takes the rest, so it can end up larger than `volume`.
      // A rest within rounding error of the room joins this bar rather than being lost.
      const take = left - room > volume * VOLUME_EPS && i < MAX_BARS_PER_TRADE - 1 ? room : left;
      add(bar, trade, take, true);
      left -= take;
      full = (bar.volume ?? 0) >= volume * (1 - VOLUME_EPS);
      if (full) bar.volume = Math.max(bar.volume ?? 0, volume);
      changed.push({ ...bar });
      if (left <= 0) return changed;
    }
  };

  return {
    push(trade) {
      const changed = apply(trade);
      return changed.length > 0 ? changed[changed.length - 1]! : null;
    },
    apply,
    get bar() {
      return bar ? { ...bar } : null;
    },
    reset() {
      bar = null;
      count = 0;
      full = false;
    },
  };
}

/**
 * Bars built from a batch of trades, ascending by time; see
 * `createBarBuilder`. Trades may come in any order: they are sorted by time
 * first (trades with the same time keep their order), so feeding the same
 * trades one by one to a builder in time order gives the same bars.
 */
export function tradesToBars(trades: readonly TradeTick[], options: ActivityBarOptions): ActivityBar[];
export function tradesToBars(trades: readonly TradeTick[], options: BarBucketOptions): Bar[];
export function tradesToBars(trades: readonly TradeTick[], options: BarBuilderOptions): Bar[];
export function tradesToBars(trades: readonly TradeTick[], options: BarBuilderOptions): Bar[] {
  const builder = createBarBuilder(options);
  const out: Bar[] = [];
  for (const trade of [...trades].sort((a, b) => a.time - b.time)) {
    for (const bar of builder.apply(trade)) {
      if (out.length > 0 && out[out.length - 1]!.time === bar.time) out[out.length - 1] = bar;
      else out.push(bar);
    }
  }
  return out;
}

/**
 * Build bars of a longer interval from shorter ones, e.g. 5m from 1m, or
 * daily bars from intraday ones when the session is given. `bars` must be
 * ascending; each output bar opens with its first bar, closes with its last,
 * and sums `volume` and `buyVolume` when the bars have them. Bars outside the
 * session are dropped. The source interval should divide the target one,
 * and line up with its session, or bars straddle two buckets and land in the
 * one they start in.
 */
export function resampleBars(bars: readonly Bar[], options: BarBucketOptions): Bar[] {
  const bucket = barBucket(options);
  const out: Bar[] = [];
  let current: Bar | null = null;
  for (const b of bars) {
    const start = bucket(b.time);
    if (start === null) continue;
    if (current && start === current.time) {
      current.high = Math.max(current.high, b.high);
      current.low = Math.min(current.low, b.low);
      current.close = b.close;
      if (b.volume !== undefined) current.volume = (current.volume ?? 0) + b.volume;
      if (b.buyVolume !== undefined) current.buyVolume = (current.buyVolume ?? 0) + b.buyVolume;
      continue;
    }
    if (current && start < current.time) continue;
    current = { time: start, open: b.open, high: b.high, low: b.low, close: b.close };
    if (b.volume !== undefined) current.volume = b.volume;
    if (b.buyVolume !== undefined) current.buyVolume = b.buyVolume;
    out.push(current);
  }
  return out;
}
