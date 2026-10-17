import { highest, highestAt, lowest, lowestAt } from './helpers';
import { checkLength, commonLength, expAverage, expAverageAt, output, previous, type Series } from './internal';
import { atr, atrAt, trAt } from './volatility';

/** Output of {@link dmi}: the two directional indicators and the ADX. */
export interface Dmi {
  /** +DI: Wilder-smoothed upward movement as a percentage of the smoothed true range. */
  plus: Float64Array;
  /** -DI: the same for downward movement. */
  minus: Float64Array;
  /** ADX: Wilder's average of `100 * |+DI - -DI| / (+DI + -DI)` over `adxLength` bars. */
  adx: Float64Array;
}

/** The Wilder averages behind {@link dmi}, kept so {@link dmiAt} can continue them. */
export interface DmiState {
  /** Smoothed upward movement. */
  plusDm: Float64Array;
  /** Smoothed downward movement. */
  minusDm: Float64Array;
  /** Smoothed true range. */
  tr: Float64Array;
}

/**
 * Directional movement index with its average (ADX). Each bar's upward move
 * is `high - prevHigh` and its downward move `prevLow - low`; only the larger
 * one counts, and only when it is positive. Both moves and the true range are
 * averaged with Wilder's smoothing over `length` bars. A zero true range reads
 * 0 for both DIs, and DIs that are both 0 give a DX of 0. The first bar has no
 * previous bar and no value.
 * Lookback `length` for the DIs and `length + adxLength - 1` for the ADX.
 *
 * Pass `state` to keep the averages for {@link dmiAt}.
 */
export function dmi(
  high: Series,
  low: Series,
  close: Series,
  length: number,
  adxLength: number,
  out?: Dmi,
  state?: DmiState,
): Dmi {
  checkLength(length);
  checkLength(adxLength, 'adxLength');
  const n = commonLength(high, low, close);
  const alpha = 1 / length;
  const column = (f: (i: number) => number) => {
    const res = new Float64Array(n);
    for (let i = 0; i < n; i++) res[i] = f(i);
    return res;
  };
  const up = expAverage(column((i) => moveAt(high, low, i, 1)), length, alpha, output(n, state?.plusDm, high, low, close));
  const down = expAverage(column((i) => moveAt(high, low, i, -1)), length, alpha, output(n, state?.minusDm, high, low, close));
  const range = expAverage(column((i) => rangeAt(high, low, close, i)), length, alpha, output(n, state?.tr, high, low, close));
  const plus = output(n, out?.plus, high, low, close);
  const minus = output(n, out?.minus, high, low, close);
  const dx = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    plus[i] = share(up[i]!, range[i]!);
    minus[i] = share(down[i]!, range[i]!);
    dx[i] = spread(plus[i]!, minus[i]!);
  }
  const adx = expAverage(dx, adxLength, 1 / adxLength, output(n, out?.adx, high, low, close));
  return { plus, minus, adx };
}

/** Single-bar form of {@link dmi}: reads bar `i - 1` and writes bar `i` of `out` and `state`. */
export function dmiAt(
  high: Series,
  low: Series,
  close: Series,
  i: number,
  length: number,
  adxLength: number,
  out: Dmi,
  state: DmiState,
): void {
  checkLength(length);
  checkLength(adxLength, 'adxLength');
  const alpha = 1 / length;
  const up = expAverageAt((j) => moveAt(high, low, j, 1), i, length, alpha, state.plusDm);
  const down = expAverageAt((j) => moveAt(high, low, j, -1), i, length, alpha, state.minusDm);
  const range = expAverageAt((j) => rangeAt(high, low, close, j), i, length, alpha, state.tr);
  out.plus[i] = share(up, range);
  out.minus[i] = share(down, range);
  expAverageAt((j) => spread(out.plus[j]!, out.minus[j]!), i, adxLength, 1 / adxLength, out.adx);
}

/** Warmup of {@link dmi}: how many leading bars are NaN before every output has a value. */
export const dmiLookback = (length: number, adxLength: number): number => length + adxLength - 1;

/** Upward (`sign` 1) or downward (-1) directional movement at bar `i`; NaN on the first bar. */
function moveAt(high: Series, low: Series, i: number, sign: 1 | -1): number {
  if (i < 1) return NaN;
  const up = high[i]! - high[i - 1]!;
  const down = low[i - 1]! - low[i]!;
  if (Number.isNaN(up) || Number.isNaN(down)) return NaN;
  const move = sign === 1 ? up : down;
  const other = sign === 1 ? down : up;
  return move > other && move > 0 ? move : 0;
}

/** True range from the second bar on, so it averages over the same bars as the moves. */
function rangeAt(high: Series, low: Series, close: Series, i: number): number {
  return i < 1 ? NaN : trAt(high, low, close, i);
}

function share(move: number, range: number): number {
  return range === 0 ? 0 : (100 * move) / range;
}

function spread(plus: number, minus: number): number {
  const total = plus + minus;
  return total === 0 ? 0 : (100 * Math.abs(plus - minus)) / total;
}

/** Output of {@link supertrend}: the line and the trend direction. */
export interface Supertrend {
  /** The trailing stop: the lower band in an uptrend, the upper band in a downtrend. */
  line: Float64Array;
  /** 1 in an uptrend, -1 in a downtrend. */
  direction: Float64Array;
}

/** The average true range and bands behind {@link supertrend}, kept so {@link supertrendAt} can continue them. */
export interface SupertrendState {
  atr: Float64Array;
  upper: Float64Array;
  lower: Float64Array;
}

/**
 * Supertrend: bands `mult` average true ranges ({@link atr} over `length`)
 * above and below the bar's midpoint `(high + low) / 2`. The upper band only
 * moves down and the lower band only moves up, unless the previous close
 * crossed them. The trend flips up when the close rises above the upper band
 * and down when it falls below the lower band. The first bar of a run starts
 * up when its close is at or above the midpoint. Lookback `length - 1`.
 *
 * Pass `state` to keep the average true range and bands for {@link supertrendAt}.
 */
export function supertrend(
  high: Series,
  low: Series,
  close: Series,
  length: number,
  mult: number,
  out?: Supertrend,
  state?: SupertrendState,
): Supertrend {
  checkLength(length);
  const n = commonLength(high, low, close);
  const range = atr(high, low, close, length, state?.atr);
  const bands = {
    atr: range,
    upper: output(n, state?.upper, high, low, close),
    lower: output(n, state?.lower, high, low, close),
  };
  const res = {
    line: output(n, out?.line, high, low, close),
    direction: output(n, out?.direction, high, low, close),
  };
  for (let i = 0; i < n; i++) trendStep(high, low, close, i, mult, range[i]!, res, bands);
  return res;
}

/** Single-bar form of {@link supertrend}: reads bar `i - 1` and writes bar `i` of `out` and `state`. */
export function supertrendAt(
  high: Series,
  low: Series,
  close: Series,
  i: number,
  length: number,
  mult: number,
  out: Supertrend,
  state: SupertrendState,
): void {
  trendStep(high, low, close, i, mult, atrAt(high, low, close, i, length, state.atr), out, state);
}

/** Warmup of {@link supertrend}: how many leading bars are NaN. */
export const supertrendLookback = (length: number): number => length - 1;

function trendStep(
  high: Series,
  low: Series,
  close: Series,
  i: number,
  mult: number,
  range: number,
  out: Supertrend,
  state: SupertrendState,
): void {
  const mid = (high[i]! + low[i]!) / 2;
  const c = close[i]!;
  if (Number.isNaN(range) || Number.isNaN(mid) || Number.isNaN(c)) {
    state.upper[i] = state.lower[i] = out.line[i] = out.direction[i] = NaN;
    return;
  }
  let upper = mid + mult * range;
  let lower = mid - mult * range;
  const before = previous(out.direction, i);
  let direction: number;
  if (Number.isNaN(before)) {
    direction = c >= mid ? 1 : -1;
  } else {
    const prevUpper = state.upper[i - 1]!;
    const prevLower = state.lower[i - 1]!;
    const prevClose = close[i - 1]!;
    // A band keeps its tighter previous level while the close stayed inside it.
    if (upper > prevUpper && prevClose <= prevUpper) upper = prevUpper;
    if (lower < prevLower && prevClose >= prevLower) lower = prevLower;
    if (before === 1) direction = c < lower ? -1 : 1;
    else direction = c > upper ? 1 : -1;
  }
  state.upper[i] = upper;
  state.lower[i] = lower;
  out.direction[i] = direction;
  out.line[i] = direction === 1 ? lower : upper;
}

/** Output of {@link ichimoku}: one column per line. */
export interface Ichimoku {
  /** Conversion line: midpoint of the highest high and lowest low over `conversionLength`. */
  conversion: Float64Array;
  /** Base line: the same midpoint over `baseLength`. */
  base: Float64Array;
  /** Leading span A: halfway between the conversion and base lines. */
  spanA: Float64Array;
  /** Leading span B: the midpoint over `spanBLength`. */
  spanB: Float64Array;
}

/**
 * Ichimoku lines, each at the bar it is computed on. Charts usually draw the
 * two leading spans (the cloud) a number of bars ahead, often `baseLength`,
 * and the close as a lagging line that many bars behind; shifting is left to
 * the caller. Lookback `max(conversionLength, baseLength, spanBLength) - 1`
 * (the conversion and base lines start earlier with shorter lengths).
 */
export function ichimoku(
  high: Series,
  low: Series,
  conversionLength: number,
  baseLength: number,
  spanBLength: number,
  out?: Ichimoku,
): Ichimoku {
  checkLength(conversionLength, 'conversionLength');
  checkLength(baseLength, 'baseLength');
  checkLength(spanBLength, 'spanBLength');
  const n = commonLength(high, low);
  const conversion = midpoint(high, low, conversionLength, output(n, out?.conversion, high, low));
  const base = midpoint(high, low, baseLength, output(n, out?.base, high, low));
  const spanB = midpoint(high, low, spanBLength, output(n, out?.spanB, high, low));
  const spanA = output(n, out?.spanA, high, low);
  for (let i = 0; i < n; i++) spanA[i] = (conversion[i]! + base[i]!) / 2;
  return { conversion, base, spanA, spanB };
}

/** Single-bar form of {@link ichimoku}: writes bar `i` of each line in `out`. */
export function ichimokuAt(
  high: Series,
  low: Series,
  i: number,
  conversionLength: number,
  baseLength: number,
  spanBLength: number,
  out: Ichimoku,
): void {
  const conversion = midpointAt(high, low, i, conversionLength);
  const base = midpointAt(high, low, i, baseLength);
  out.conversion[i] = conversion;
  out.base[i] = base;
  out.spanA[i] = (conversion + base) / 2;
  out.spanB[i] = midpointAt(high, low, i, spanBLength);
}

/** Warmup of {@link ichimoku}: how many leading bars are NaN before every output has a value. */
export const ichimokuLookback = (conversionLength: number, baseLength: number, spanBLength: number): number =>
  Math.max(conversionLength, baseLength, spanBLength) - 1;

/** Halfway between the highest high and the lowest low of the last `length` bars. */
function midpoint(high: Series, low: Series, length: number, res: Float64Array): Float64Array {
  highest(high, length, res);
  const floor = lowest(low, length);
  for (let i = 0; i < res.length; i++) res[i] = (res[i]! + floor[i]!) / 2;
  return res;
}

function midpointAt(high: Series, low: Series, i: number, length: number): number {
  return (highestAt(high, i, length) + lowestAt(low, i, length)) / 2;
}
