import type { Bar, Time } from '../types';
import { UTC, type Zone } from '../util/timezone';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The calendar span each year's path covers. */
export type SeasonalWindow = 'year' | 'quarter' | 'month';
/** How each year's closes are scaled before they are overlaid. */
export type SeasonalNormalize = 'percent' | 'indexed' | 'none';
/** How the paths are combined into one average path. */
export type SeasonalAverage = 'mean' | 'median';
/** `calendar` lines up the same date every year; `trading` lines up the nth bar of the window. */
export type SeasonalAlign = 'calendar' | 'trading';
/** Calendar days without a bar: `carry` repeats the last close over them, `skip` leaves a gap. */
export type SeasonalGaps = 'carry' | 'skip';

/**
 * How `computeSeasonality` compares years of daily bars: which years, the
 * window and period, normalisation, alignment, gap handling and an optional
 * average path.
 */
export interface SeasonalOptions {
  /** The newest `n` years with data, or the listed years (default 5). */
  years: number | readonly number[];
  /** Default `'year'`. */
  window: SeasonalWindow;
  /**
   * The quarter (1-4) or month (1-12) to compare for those windows. Defaults to
   * the one holding the newest bar. Ignored for `'year'`.
   */
  period?: number;
  /** Default `'percent'`: change since the first bar of the window, in percent. `'indexed'` starts each year at 100. */
  normalize: SeasonalNormalize;
  /** Add an average path and the min/max range of the years around it. Default none. */
  average?: SeasonalAverage | null;
  /** Default `'calendar'`. */
  align: SeasonalAlign;
  /** Default `'carry'`. Only calendar alignment has gaps. */
  gaps: SeasonalGaps;
}

/** Default values for `SeasonalOptions`: the newest five years over a calendar-aligned year, as percent change, without an average. */
export const defaultSeasonalOptions: SeasonalOptions = {
  years: 5,
  window: 'year',
  normalize: 'percent',
  average: null,
  align: 'calendar',
  gaps: 'carry',
};

/** One year's path: a value per window position, NaN where it has none. */
export interface SeasonalPath {
  year: number;
  values: Float64Array;
  /** The close the path is normalised against (the window's first close that year). */
  base: number;
  /** Number of bars the year has in the window. */
  bars: number;
}

/** The average path and the range of the years at each position, NaN where no year has a value. */
export interface SeasonalSummary {
  kind: SeasonalAverage;
  values: Float64Array;
  min: Float64Array;
  max: Float64Array;
}

/** The result of `computeSeasonality`: the compared window and its layout, each year's path over it and the optional average path. */
export interface SeasonalData {
  window: SeasonalWindow;
  /** The quarter or month compared (1 for a year window). */
  period: number;
  align: SeasonalAlign;
  normalize: SeasonalNormalize;
  /** Positions in the window: calendar days on a leap-year calendar, or the most trading days any year has. */
  slots: number;
  /** Midnight UTC of the window's first day in `SEASONAL_REFERENCE_YEAR`. */
  start: Time;
  /** Oldest year first. */
  paths: SeasonalPath[];
  average: SeasonalSummary | null;
}

/** Where a date falls in its window. */
export interface SeasonalPosition {
  year: number;
  /** Quarter (1-4) or month (1-12) of the date; 1 for a year window. */
  period: number;
  /** Days since the window's first day, counted on a leap-year calendar: 1 March is the same position every year. */
  position: number;
}

const DAY = 86400;
const MS_DAY = DAY * 1000;
/** The leap year every window is laid out on, so 29 February has a position of its own. */
export const SEASONAL_REFERENCE_YEAR = 2000;

const MONTHS_IN: Record<SeasonalWindow, number> = { year: 12, quarter: 3, month: 1 };
const PERIODS_IN: Record<SeasonalWindow, number> = { year: 1, quarter: 4, month: 12 };

function startMonth(window: SeasonalWindow, period: number): number {
  return (period - 1) * MONTHS_IN[window];
}

function refDay(month: number, day: number): number {
  return Date.UTC(SEASONAL_REFERENCE_YEAR, month, day) / MS_DAY;
}

/** Midnight UTC of the window's first day in the reference year. */
export function seasonalStart(window: SeasonalWindow, period: number): Time {
  return refDay(startMonth(window, period), 1) * DAY;
}

/** Calendar days in the window on the leap-year calendar (366 for a year, 29 for February). */
export function seasonalSlots(window: SeasonalWindow, period: number): number {
  const m = startMonth(window, period);
  return refDay(m + MONTHS_IN[window], 1) - refDay(m, 1);
}

/** The window period `time` falls in and its calendar position there, by its wall date in `zone`. */
export function seasonalPosition(time: Time, window: SeasonalWindow, zone: Zone = UTC): SeasonalPosition {
  const d = new Date(Math.floor(zone.wall(time) / DAY) * MS_DAY);
  const month = d.getUTCMonth();
  const period = Math.floor(month / MONTHS_IN[window]) + 1;
  return {
    year: d.getUTCFullYear(),
    period,
    position: refDay(month, d.getUTCDate()) - refDay(startMonth(window, period), 1),
  };
}

function checkOptions(o: SeasonalOptions, period: number): void {
  if (!(o.window in MONTHS_IN)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown seasonality window "${String(o.window)}"` : '');
  if (!Number.isInteger(period) || period < 1 || period > PERIODS_IN[o.window]) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Seasonality period ${String(period)} is out of range for a ${o.window} window` : '');
  }
  if (!['percent', 'indexed', 'none'].includes(o.normalize)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown seasonality normalize "${String(o.normalize)}"` : '');
  if (!['calendar', 'trading'].includes(o.align)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown seasonality align "${String(o.align)}"` : '');
  if (!['carry', 'skip'].includes(o.gaps)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown seasonality gaps "${String(o.gaps)}"` : '');
  if (o.average != null && o.average !== 'mean' && o.average !== 'median') {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown seasonality average "${String(o.average)}"` : '');
  }
  if (typeof o.years === 'number' ? !(Number.isInteger(o.years) && o.years > 0) : !Array.isArray(o.years)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Seasonality years must be a positive whole number or a list of years' : '');
  }
}

/** Closes of one year in the window, as positions and values in time order. */
interface YearBars {
  positions: number[];
  closes: number[];
}

/**
 * Lay each year's closes over a shared window: the path per year, normalised,
 * and optionally the mean or median path with the range of the years. Bars
 * are daily and in time order; their date is read in `zone`. O(bars + years × slots).
 *
 * Calendar alignment puts every date at the same position each year, on a
 * leap-year calendar: 29 February only has a value in leap years (with
 * `gaps: 'carry'` other years repeat 28 February's close there), and later
 * dates line up across leap and common years. Trading alignment counts the
 * window's bars instead, so the nth trading day of each year lines up.
 */
export function computeSeasonality(bars: readonly Bar[], options: Partial<SeasonalOptions> = {}, zone: Zone = UTC): SeasonalData {
  const o: SeasonalOptions = { ...defaultSeasonalOptions, ...options };
  const newest = bars.length > 0 ? seasonalPosition(bars[bars.length - 1]!.time, o.window, zone) : null;
  const period = o.window === 'year' ? 1 : (o.period ?? newest?.period ?? 1);
  checkOptions(o, period);

  const byYear = new Map<number, YearBars>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.close)) continue;
    const at = seasonalPosition(bar.time, o.window, zone);
    if (at.period !== period) continue;
    let year = byYear.get(at.year);
    if (!year) byYear.set(at.year, (year = { positions: [], closes: [] }));
    // A second bar on the same day replaces the first.
    if (year.positions[year.positions.length - 1] === at.position) year.closes[year.closes.length - 1] = bar.close;
    else {
      year.positions.push(at.position);
      year.closes.push(bar.close);
    }
  }

  const available = [...byYear.keys()].sort((a, b) => a - b);
  const years =
    typeof o.years === 'number'
      ? available.slice(-o.years)
      : [...new Set(o.years)].filter((y) => byYear.has(y)).sort((a, b) => a - b);

  const calendar = o.align === 'calendar';
  const slots = calendar ? seasonalSlots(o.window, period) : Math.max(0, ...years.map((y) => byYear.get(y)!.closes.length));
  const paths: SeasonalPath[] = [];
  for (const year of years) {
    const path = yearPath(year, byYear.get(year)!, slots, calendar, o);
    if (path) paths.push(path);
  }
  return {
    window: o.window,
    period,
    align: o.align,
    normalize: o.normalize,
    slots,
    start: seasonalStart(o.window, period),
    paths,
    average: o.average ? summarize(paths, slots, o.average) : null,
  };
}

function yearPath(year: number, bars: YearBars, slots: number, calendar: boolean, o: SeasonalOptions): SeasonalPath | null {
  const base = bars.closes[0]!;
  if (o.normalize !== 'none' && !(base !== 0 && Number.isFinite(base))) return null;
  const scale = (v: number) => (o.normalize === 'percent' ? (v / base - 1) * 100 : o.normalize === 'indexed' ? (v / base) * 100 : v);
  const values = new Float64Array(slots).fill(NaN);
  for (let k = 0; k < bars.closes.length; k++) values[calendar ? bars.positions[k]! : k] = scale(bars.closes[k]!);
  if (calendar && o.gaps === 'carry') {
    // Fill between the year's first and last bar only: nothing before the window opens or after the newest bar.
    const last = bars.positions[bars.positions.length - 1]!;
    for (let i = bars.positions[0]! + 1; i <= last; i++) if (Number.isNaN(values[i]!)) values[i] = values[i - 1]!;
  }
  return { year, values, base, bars: bars.closes.length };
}

/** Mean or median of the paths with a value at each position, and their min and max. */
export function summarize(paths: readonly SeasonalPath[], slots: number, kind: SeasonalAverage): SeasonalSummary {
  const values = new Float64Array(slots).fill(NaN);
  const min = new Float64Array(slots).fill(NaN);
  const max = new Float64Array(slots).fill(NaN);
  const column: number[] = [];
  for (let i = 0; i < slots; i++) {
    column.length = 0;
    for (const p of paths) {
      const v = p.values[i]!;
      if (!Number.isNaN(v)) column.push(v);
    }
    const n = column.length;
    if (n === 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (const v of column) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    min[i] = lo;
    max[i] = hi;
    if (kind === 'mean') values[i] = sum / n;
    else {
      column.sort((a, b) => a - b);
      const mid = n >> 1;
      values[i] = n % 2 ? column[mid]! : (column[mid - 1]! + column[mid]!) / 2;
    }
  }
  return { kind, values, min, max };
}
