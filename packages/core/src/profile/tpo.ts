import type { Bar, Time } from '../types';
import { barBucket, type BarBucketOptions } from '../data/aggregate';
import type { Interval } from '../data/types';
import { priceRow } from './footprint';
import { MAX_PROFILE_ROWS, pointOfControl, valueArea } from './math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Options for `computeTpoProfile`. */
export interface TpoOptions {
  /**
   * Row height in price units, usually a multiple of the tick size. Scaled up
   * when the range would need more than `MAX_PROFILE_ROWS` rows.
   */
  rowSize: number;
  /** Share of all TPOs inside the value area, in percent. Default 70. */
  valueArea?: number;
}

/** Options for `computeTpoProfiles`: row options plus how bars group into sessions. */
export interface TpoSessionOptions extends TpoOptions, Omit<BarBucketOptions, 'interval'> {
  /** Length of one profile. Default `'1d'`: one per trading day of `session`. */
  interval?: Interval;
}

/**
 * A time-price opportunity profile: every period (one bar) marks each price
 * row its range touches, and rows stack the periods that reached them.
 */
export interface TpoProfile {
  /** Time of the first period: its bar's time, or the session start from `computeTpoProfiles`. */
  time: Time;
  /** Lowest price of row 0; row `r` covers [start + r * rowSize, start + (r + 1) * rowSize). */
  start: number;
  /** Row height in price units. */
  rowSize: number;
  /** Number of rows, from the lowest low to the highest high. */
  rows: number;
  /** Periods in the profile, including skipped bars, so period numbers stay tied to time. */
  periods: number;
  /** TPOs per row: how many periods reached it. */
  counts: number[];
  /** Period numbers (0 for the first bar) that reached each row, in time order. */
  rowPeriods: number[][];
  /** Row with the most TPOs (point of control), or -1 when empty. */
  poc: number;
  /** Lowest value-area row, or -1. */
  valueAreaLow: number;
  /** Highest value-area row, or -1. */
  valueAreaHigh: number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Letter of a period in a letter-style profile: A to Z, then a to z, then A again. */
export function tpoLetter(period: number): string {
  const n = LETTERS.length;
  return LETTERS[((Math.floor(period) % n) + n) % n]!;
}

function checkRowSize(rowSize: number): number {
  if (!(Number.isFinite(rowSize) && rowSize > 0)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `TPO rowSize must be a positive finite number, got ${rowSize}` : '');
  }
  return rowSize;
}

function validBar(bar: Bar): boolean {
  return Number.isFinite(bar.low) && Number.isFinite(bar.high) && bar.high >= bar.low;
}

/**
 * TPO profile of bars [from, to), one period per bar (pass bars of the period
 * length, often 30 minutes). Rows align to multiples of `rowSize`, and a bar
 * marks every row from the one holding its low to the one holding its high.
 * Bars with an invalid range mark nothing but still count as a period. The
 * point of control and value area come from the TPO counts, with the same
 * rules as the volume profile.
 */
export function computeTpoProfile(bars: readonly Bar[], from: number, to: number, options: TpoOptions): TpoProfile {
  const { valueArea: percent = 70 } = options;
  const requested = checkRowSize(options.rowSize);
  const first = Math.max(0, from);
  const end = Math.min(to, bars.length);
  let low = Infinity;
  let high = -Infinity;
  for (let i = first; i < end; i++) {
    const bar = bars[i]!;
    if (!validBar(bar)) continue;
    low = Math.min(low, bar.low);
    high = Math.max(high, bar.high);
  }
  const time = first < end ? bars[first]!.time : 0;
  const periods = Math.max(0, end - first);
  if (!(low <= high)) {
    return { time, start: 0, rowSize: requested, rows: 0, periods, counts: [], rowPeriods: [], poc: -1, valueAreaLow: -1, valueAreaHigh: -1 };
  }
  let rowSize = requested;
  let span = priceRow(high, rowSize) - priceRow(low, rowSize) + 1;
  if (span > MAX_PROFILE_ROWS) {
    rowSize *= Math.ceil(span / MAX_PROFILE_ROWS);
    span = priceRow(high, rowSize) - priceRow(low, rowSize) + 1;
  }
  const base = priceRow(low, rowSize);
  const counts = new Array<number>(span).fill(0);
  const rowPeriods: number[][] = Array.from({ length: span }, () => []);
  for (let i = first; i < end; i++) {
    const bar = bars[i]!;
    if (!validBar(bar)) continue;
    const top = priceRow(bar.high, rowSize) - base;
    for (let r = priceRow(bar.low, rowSize) - base; r <= top; r++) {
      counts[r]!++;
      rowPeriods[r]!.push(i - first);
    }
  }
  const poc = pointOfControl(counts);
  const va = valueArea(counts, span, poc, percent);
  return {
    time,
    start: base * rowSize,
    rowSize,
    rows: span,
    periods,
    counts,
    rowPeriods,
    poc,
    valueAreaLow: va.low,
    valueAreaHigh: va.high,
  };
}

/** Call `each` with the bars of every session (see `computeTpoProfiles`) and its start time. */
function eachSession(bars: readonly Bar[], options: TpoSessionOptions, each: (group: Bar[], start: Time) => void): void {
  checkRowSize(options.rowSize);
  const bucket = barBucket({ ...options, interval: options.interval ?? '1d' });
  let group: Bar[] = [];
  let start: Time | null = null;
  for (const bar of bars) {
    const at = bucket(bar.time);
    if (at === null) continue;
    if (at !== start) {
      if (start !== null) each(group, start);
      group = [];
      start = at;
    }
    group.push(bar);
  }
  if (start !== null) each(group, start);
}

/**
 * One TPO profile per session: bars are grouped by the period of `interval`
 * (a trading day by default) that their time falls in, following `timezone`
 * and `session` like `barBucket`, and bars outside the session are left out.
 * Bars must be in time order. Each profile's `time` is its session start.
 */
export function computeTpoProfiles(bars: readonly Bar[], options: TpoSessionOptions): TpoProfile[] {
  const profiles: TpoProfile[] = [];
  eachSession(bars, options, (group, start) => {
    const profile = computeTpoProfile(group, 0, group.length, options);
    profile.time = start;
    profiles.push(profile);
  });
  return profiles;
}

/** One bar of a TPO session: draws column `column` of its session's profile (see `tpoColumns`). */
export interface TpoColumn {
  /** The bar's time. */
  time: Time;
  /** Profile of the bar's session, shared by all its bars. */
  profile: TpoProfile;
  /** Column of the profile this bar draws: its place in the session, 0 for the first bar. */
  column: number;
}

/**
 * Data for `tpoSeries`: one item per bar inside a session, grouped like
 * `computeTpoProfiles`. Column `c` of a profile holds the `c`-th TPO of each
 * row that has more than `c`, so a session's profile spans its own bars and
 * every bar draws one column. On a live bar, call again (or for the last
 * session's bars only) and `setData` the result.
 */
export function tpoColumns(bars: readonly Bar[], options: TpoSessionOptions): TpoColumn[] {
  const columns: TpoColumn[] = [];
  eachSession(bars, options, (group, start) => {
    const profile = computeTpoProfile(group, 0, group.length, options);
    profile.time = start;
    group.forEach((bar, column) => columns.push({ time: bar.time, profile, column }));
  });
  return columns;
}
