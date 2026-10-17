import { ema, emaAt, sma, smaAt } from './average';
import { highest, highestAt, lowest, lowestAt } from './helpers';
import { checkLength, commonLength, expAverage, expAverageAt, output, reanchor, windowValid, type Series } from './internal';

/**
 * True range: the largest of `high - low`, `|high - prevClose|` and
 * `|low - prevClose|`. The first bar has no previous close and uses
 * `high - low`. Lookback 0.
 */
export function tr(high: Series, low: Series, close: Series, out?: Float64Array): Float64Array {
  const n = commonLength(high, low, close);
  const res = output(n, out, high, low, close);
  for (let i = 0; i < n; i++) res[i] = trAt(high, low, close, i);
  return res;
}

/** Single-bar form of {@link tr}: the value at bar `i`. */
export function trAt(high: Series, low: Series, close: Series, i: number): number {
  const h = high[i]!;
  const l = low[i]!;
  if (i === 0) return h - l;
  const c = close[i - 1]!;
  return Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
}

/** Warmup of {@link tr}: how many leading bars are NaN. */
export const trLookback = (): number => 0;

/** Average true range: {@link rma} of {@link tr}. Lookback `length - 1`. */
export function atr(high: Series, low: Series, close: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const n = commonLength(high, low, close);
  const res = output(n, out, high, low, close);
  return expAverage(tr(high, low, close), length, 1 / length, res);
}

/** Single-bar form of {@link atr}: reads `out[i - 1]`, writes and returns `out[i]`. */
export function atrAt(high: Series, low: Series, close: Series, i: number, length: number, out: Float64Array): number {
  checkLength(length);
  return expAverageAt((j) => trAt(high, low, close, j), i, length, 1 / length, out);
}

/** Warmup of {@link atr}: how many leading bars are NaN. */
export const atrLookback = (length: number): number => length - 1;

/**
 * Population standard deviation over the last `length` values.
 * Lookback `length - 1`. NaN when any value in the window is NaN.
 */
export function stdev(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  // Running sums of (x - shift). The shift keeps them small, so the variance
  // does not cancel away on large prices; it moves with each re-anchor.
  let run = 0;
  let shift = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) run = 0;
    else if (reanchor(++run, length)) {
      shift = values[i - length + 1]!;
      s1 = 0;
      s2 = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const d = values[j]! - shift;
        s1 += d;
        s2 += d * d;
      }
    } else if (run > length) {
      const d = v - shift;
      const old = values[i - length]! - shift;
      s1 += d - old;
      s2 += d * d - old * old;
    }
    res[i] = run >= length ? Math.sqrt(Math.max(0, (s2 - (s1 * s1) / length) / length)) : NaN;
  }
  return res;
}

/** Single-bar form of {@link stdev}: the value at bar `i`. */
export function stdevAt(values: Series, i: number, length: number): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i)) return NaN;
  const mean = smaAt(values, i, length);
  let s2 = 0;
  for (let j = i - length + 1; j <= i; j++) s2 += (values[j]! - mean) ** 2;
  return Math.sqrt(s2 / length);
}

/** Warmup of {@link stdev}: how many leading bars are NaN. */
export const stdevLookback = (length: number): number => length - 1;

/** Output of {@link bbands}: one column per band. */
export interface BBands {
  /** {@link sma} of the values. */
  middle: Float64Array;
  /** `middle + mult * stdev`. */
  upper: Float64Array;
  /** `middle - mult * stdev`. */
  lower: Float64Array;
}

/** Bollinger Bands: an {@link sma} with bands `mult` standard deviations away. Lookback `length - 1`. */
export function bbands(values: Series, length: number, mult: number, out?: BBands): BBands {
  const n = values.length;
  const middle = sma(values, length, output(n, out?.middle, values));
  const upper = stdev(values, length, output(n, out?.upper, values));
  const lower = output(n, out?.lower, values);
  for (let i = 0; i < n; i++) {
    const dev = mult * upper[i]!;
    upper[i] = middle[i]! + dev;
    lower[i] = middle[i]! - dev;
  }
  return { middle, upper, lower };
}

/** Single-bar form of {@link bbands}: writes bar `i` of each band in `out`. */
export function bbandsAt(values: Series, i: number, length: number, mult: number, out: BBands): void {
  const middle = smaAt(values, i, length);
  const dev = mult * stdevAt(values, i, length);
  out.middle[i] = middle;
  out.upper[i] = middle + dev;
  out.lower[i] = middle - dev;
}

/** Warmup of {@link bbands}: how many leading bars are NaN before every output has a value. */
export const bbandsLookback = (length: number): number => length - 1;

/** Output of {@link keltner}: one column per channel line. */
export interface Keltner {
  /** {@link ema} of the close. */
  middle: Float64Array;
  /** `middle + mult * atr`. */
  upper: Float64Array;
  /** `middle - mult * atr`. */
  lower: Float64Array;
}

/** The average true range behind {@link keltner}, kept so {@link keltnerAt} can continue it. */
export interface KeltnerState {
  atr: Float64Array;
}

/**
 * Keltner channels: an {@link ema} of the close with bands `mult` average true
 * ranges ({@link atr} over `atrLength`) away. Lookback `max(length, atrLength) - 1`.
 *
 * Pass `state` to keep the average true range for {@link keltnerAt}.
 */
export function keltner(
  high: Series,
  low: Series,
  close: Series,
  length: number,
  mult: number,
  atrLength: number,
  out?: Keltner,
  state?: KeltnerState,
): Keltner {
  checkLength(length);
  checkLength(atrLength, 'atrLength');
  const n = commonLength(high, low, close);
  const middle = ema(close, length, output(n, out?.middle, high, low, close));
  const range = atr(high, low, close, atrLength, state?.atr);
  const upper = output(n, out?.upper, high, low, close);
  const lower = output(n, out?.lower, high, low, close);
  for (let i = 0; i < n; i++) {
    const dev = mult * range[i]!;
    upper[i] = middle[i]! + dev;
    lower[i] = middle[i]! - dev;
  }
  return { middle, upper, lower };
}

/** Single-bar form of {@link keltner}: reads bar `i - 1` and writes bar `i` of `out` and `state`. */
export function keltnerAt(
  high: Series,
  low: Series,
  close: Series,
  i: number,
  length: number,
  mult: number,
  atrLength: number,
  out: Keltner,
  state: KeltnerState,
): void {
  const middle = emaAt(close, i, length, out.middle);
  const dev = mult * atrAt(high, low, close, i, atrLength, state.atr);
  out.upper[i] = middle + dev;
  out.lower[i] = middle - dev;
}

/** Warmup of {@link keltner}: how many leading bars are NaN before every output has a value. */
export const keltnerLookback = (length: number, atrLength: number): number => Math.max(length, atrLength) - 1;

/** Output of {@link donchian}: one column per channel line. */
export interface Donchian {
  /** {@link highest} high. */
  upper: Float64Array;
  /** {@link lowest} low. */
  lower: Float64Array;
  /** Halfway between `upper` and `lower`. */
  middle: Float64Array;
}

/**
 * Donchian channels: the highest high and lowest low of the last `length`
 * bars, and the midpoint between them. Lookback `length - 1`.
 */
export function donchian(high: Series, low: Series, length: number, out?: Donchian): Donchian {
  checkLength(length);
  const n = commonLength(high, low);
  const upper = highest(high, length, output(n, out?.upper, high, low));
  const lower = lowest(low, length, output(n, out?.lower, high, low));
  const middle = output(n, out?.middle, high, low);
  for (let i = 0; i < n; i++) middle[i] = (upper[i]! + lower[i]!) / 2;
  return { upper, lower, middle };
}

/** Single-bar form of {@link donchian}: writes bar `i` of each line in `out`. */
export function donchianAt(high: Series, low: Series, i: number, length: number, out: Donchian): void {
  const upper = highestAt(high, i, length);
  const lower = lowestAt(low, i, length);
  out.upper[i] = upper;
  out.lower[i] = lower;
  out.middle[i] = (upper + lower) / 2;
}

/** Warmup of {@link donchian}: how many leading bars are NaN before every output has a value. */
export const donchianLookback = (length: number): number => length - 1;
