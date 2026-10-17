import type { Time } from '../types';
import { UTC, type Zone } from './timezone';
import { tradingDay, type CompiledSession } from './session';
import type { Localizer } from './locale';
import { clampNum } from './math';

/** Round a raw step up to 1/2/2.5/5 × 10^n. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

export function decimalsForStep(step: number): number {
  if (!(step > 0) || step >= 1) return Number.isInteger(step) || !(step > 0) ? 0 : 1;
  // 2.5 × 10^-n needs one extra digit.
  const digits = Math.ceil(-Math.log10(step) - 1e-9);
  const scaled = step * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) > 1e-6 ? digits + 1 : digits;
}

/** Axis prices from `priceTicks`: the step between them, the decimals to show and the values. */
export interface PriceTicks {
  step: number;
  decimals: number;
  values: number[];
}

/**
 * Evenly spaced axis prices in `[min, max]`, at least `minSpacingPx` apart.
 * `alignStep` can widen the step, e.g. to land on a price format's ticks.
 */
export function priceTicks(
  min: number,
  max: number,
  heightPx: number,
  minSpacingPx = 40,
  alignStep?: (step: number) => number,
): PriceTicks {
  const span = max - min;
  if (!(span > 0) || !(heightPx > 0)) return { step: 1, decimals: 0, values: [] };
  const nice = niceStep((span * minSpacingPx) / heightPx);
  const step = alignStep ? alignStep(nice) : nice;
  const decimals = decimalsForStep(step);
  // Round away float noise (0.30000000000000004) a few digits past the step's
  // decimals (aligned steps such as 1/16 need more than `decimals`), and never
  // at fewer digits than the step has: a fixed 12 merged the ticks of finer steps.
  const digits = clampNum(decimals + 3, 12, 100);
  const values: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let v = first, i = 0; v <= max + step * 1e-9 && i < 1000; i++, v = first + i * step) {
    const value = Number(v.toFixed(digits));
    // A step below the values' float resolution repeats a value: label it once.
    if (values.length === 0 || value !== values[values.length - 1]) values.push(value);
  }
  return { step, decimals, values };
}

/**
 * Ticks for a log10 price scale: walk the axis in screen space and snap each
 * position to a round number for the local price step.
 */
export function logPriceTicks(min: number, max: number, heightPx: number, minSpacingPx = 40): number[] {
  if (!(min > 0) || !(max > min) || !(heightPx > 0)) return [];
  const lmin = Math.log10(min);
  const span = Math.log10(max) - lmin;
  const yOf = (p: number) => heightPx * (1 - (Math.log10(p) - lmin) / span);
  // Price ratio covered by one minimum spacing.
  const ratio = 10 ** ((span * minSpacingPx) / heightPx) - 1;
  const steps = Math.ceil((heightPx / minSpacingPx) * 3);
  const out: number[] = [];
  let lastY = Infinity;
  for (let i = 0; i <= steps; i++) {
    const price = 10 ** (lmin + (span * i) / steps);
    const step = niceStep(price * ratio);
    const v = Number((Math.round(price / step) * step).toPrecision(12));
    if (v < min || v > max || (out.length > 0 && v <= out[out.length - 1]!)) continue;
    const y = yOf(v);
    if (lastY - y < minSpacingPx) continue;
    out.push(v);
    lastY = y;
  }
  return out;
}

/** A number shortened with a K, M, B or T suffix and at most two decimals, e.g. `1.5M`, for volumes and sizes. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${sign}${trimZeros((abs / size).toFixed(2))}${suffix}`;
  }
  return `${sign}${trimZeros(abs.toFixed(abs >= 100 ? 0 : 2))}`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Decimal places that faithfully render typical prices of this magnitude. */
export function autoPrecision(sample: number): number {
  const abs = Math.abs(sample);
  if (!(abs > 0)) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return Math.min(10, Math.ceil(-Math.log10(abs)) + 4);
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Time axis boundary weights; higher wins label placement. */
export const TickWeight = {
  Minute: 1,
  QuarterHour: 2,
  Hour: 3,
  Day: 4,
  Month: 5,
  Year: 6,
} as const;

/**
 * Boundary between two bar times in `zone`. Day, month and year follow the
 * trading day, so an overnight session's evening bars start the next day.
 */
export function tickWeight(prev: Time, curr: Time, zone: Zone = UTC, session: CompiledSession | null = null): number {
  return wallTickWeight(zone.wall(prev), zone.wall(curr), session);
}

/** Which `count`-sized slot of a `period` (both in seconds) a wall time falls in, e.g. its hour of the day. */
function slotOf(wall: number, count: number, period: number): number {
  const slot = Math.floor(wall / count) % (period / count);
  return slot < 0 ? slot + period / count : slot;
}

/**
 * `tickWeight` for two wall-clock times. Runs once per bar on `setData`, so
 * hours and quarter hours are compared with arithmetic rather than `Date`s;
 * only a change of day, about one bar in 24 for hourly data, builds any.
 */
function wallTickWeight(wa: number, wb: number, session: CompiledSession | null): number {
  const da = tradingDay(session, wa);
  const db = tradingDay(session, wb);
  if (da !== db) {
    const ya = new Date(da * 86400000);
    const yb = new Date(db * 86400000);
    if (ya.getUTCFullYear() !== yb.getUTCFullYear()) return TickWeight.Year;
    if (ya.getUTCMonth() !== yb.getUTCMonth()) return TickWeight.Month;
    return TickWeight.Day;
  }
  if (slotOf(wa, 3600, 86400) !== slotOf(wb, 3600, 86400)) return TickWeight.Hour;
  if (slotOf(wa, 900, 3600) !== slotOf(wb, 900, 3600)) return TickWeight.QuarterHour;
  return TickWeight.Minute;
}

/**
 * Axis label for a boundary of `weight` (see `tickWeight`) at `time`. With a
 * `locale` that formats dates through `Intl`, month names, times and digits
 * follow it; `seconds` adds seconds to times of day.
 */
export function formatTickLabel(
  time: Time,
  weight: number,
  zone: Zone = UTC,
  session: CompiledSession | null = null,
  locale?: Localizer,
  seconds = false,
): string {
  const intl = locale?.intlDates ? locale : null;
  const d = zone.date(time);
  // Date boundaries name the trading day, which may be the next calendar day.
  const day = weight >= TickWeight.Day ? new Date(tradingDay(session, zone.wall(time)) * 86400000) : d;
  switch (weight) {
    case TickWeight.Year:
      return locale ? locale.localize(String(day.getUTCFullYear())) : String(day.getUTCFullYear());
    case TickWeight.Month:
      return intl ? intl.monthShort(day) : MONTHS[day.getUTCMonth()]!;
    case TickWeight.Day:
      return locale ? locale.localize(String(day.getUTCDate())) : String(day.getUTCDate());
    default:
      return intl ? intl.time(d, seconds) : clockText(d, seconds);
  }
}

/** `hh:mm`, or `hh:mm:ss` with `seconds`, of a wall-clock date. */
function clockText(d: Date, seconds: boolean): string {
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
}

export interface TimeTick {
  index: number;
  weight: number;
}

/** Boundary weight per bar (index 0 has no predecessor and never labels). */
export function computeTickWeights(times: readonly Time[], zone: Zone = UTC, session: CompiledSession | null = null): Uint8Array {
  const weights = new Uint8Array(times.length);
  // Each bar's wall time is worked out once and reused as the next bar's predecessor.
  let prev = times.length > 0 ? zone.wall(times[0]!) : 0;
  for (let i = 1; i < times.length; i++) {
    const wall = zone.wall(times[i]!);
    weights[i] = wallTickWeight(prev, wall, session);
    prev = wall;
  }
  return weights;
}

/**
 * Pick time-axis labels: heaviest calendar boundaries first, each placed only
 * if no accepted label lies within the minimum spacing. O(visible × levels).
 * `future` holds the tick weights of projected bars after the last one, so
 * labels continue into the space right of the data.
 */
export function selectTimeTicks(
  weights: Uint8Array,
  from: number,
  to: number,
  barSpacing: number,
  minSpacingPx = 72,
  future?: Uint8Array,
): TimeTick[] {
  const n = weights.length;
  const start = Math.max(1, Math.floor(from));
  const end = Math.min(n - 1 + (future?.length ?? 0), Math.ceil(to));
  const weightAt = (i: number) => (i < n ? weights[i] : future![i - n]);
  const minBars = Math.max(1, minSpacingPx / Math.max(barSpacing, 1e-6));
  const buckets = new Map<number, number[]>();
  const placed: TimeTick[] = [];
  const isFree = (index: number) => {
    const b = Math.floor(index / minBars);
    for (let k = b - 1; k <= b + 1; k++) {
      const list = buckets.get(k);
      if (list?.some((p) => Math.abs(p - index) < minBars)) return false;
    }
    return true;
  };
  for (let level: number = TickWeight.Year; level >= TickWeight.Minute; level--) {
    for (let i = start; i <= end; i++) {
      if (weightAt(i) !== level || !isFree(i)) continue;
      const b = Math.floor(i / minBars);
      const list = buckets.get(b);
      if (list) list.push(i);
      else buckets.set(b, [i]);
      placed.push({ index: i, weight: level });
    }
  }
  return placed.sort((a, b) => a.index - b.index);
}

/**
 * Crosshair label in `zone`: date only for daily+ bars, otherwise date and
 * time. `parts.time: false` leaves the time out; `parts.seconds` adds seconds.
 * Through `locale`'s `dateTime` when given, else as `isoDateTime` writes it.
 */
export function formatCrosshairTime(
  time: Time,
  intervalSec: number,
  zone: Zone = UTC,
  locale?: Localizer,
  parts: { time?: boolean; seconds?: boolean } = {},
): string {
  const d = zone.date(time);
  const dateOnly = intervalSec >= 86400 || parts.time === false;
  return locale ? locale.dateTime(d, dateOnly, parts.seconds === true) : isoDateTime(d, dateOnly, parts.seconds === true);
}

/**
 * A wall-clock date as ISO 8601 (`2026-10-16`, plus ` 14:30` or ` 14:30:05`
 * unless `dateOnly`): the built-in date when dates do not go through `Intl`.
 * Read the same in every locale, never with a two-digit year, and needing no
 * day or month names (#863).
 */
export function isoDateTime(d: Date, dateOnly: boolean, seconds = false): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return dateOnly ? date : `${date} ${clockText(d, seconds)}`;
}

/** Time left in a bar: "mm:ss", "hh:mm:ss" or "Nd Nh". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}
