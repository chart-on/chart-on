import { checkLength, commonLength, expAverage, expAverageAt, output, reanchor, windowValid, type Series } from './internal';

/**
 * Simple moving average: the mean of the last `length` values.
 * Lookback `length - 1`. NaN when any value in the window is NaN.
 */
export function sma(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  let run = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) run = 0;
    else if (reanchor(++run, length)) {
      sum = 0;
      for (let j = i - length + 1; j <= i; j++) sum += values[j]!;
    } else if (run > length) sum += v - values[i - length]!;
    res[i] = run >= length ? sum / length : NaN;
  }
  return res;
}

/** Single-bar form of {@link sma}: the value at bar `i`. */
export function smaAt(values: Series, i: number, length: number): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i)) return NaN;
  let sum = 0;
  for (let j = i - length + 1; j <= i; j++) sum += values[j]!;
  return sum / length;
}

/** Warmup of {@link sma}: how many leading bars are NaN. */
export const smaLookback = (length: number): number => length - 1;

/**
 * Exponential moving average with smoothing `2 / (length + 1)`, seeded by the
 * simple average of the first `length` values. Lookback `length - 1`.
 * A NaN input gives NaN and the average warms up again after it.
 */
export function ema(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  return expAverage(values, length, 2 / (length + 1), output(values.length, out, values));
}

/**
 * Single-bar form of {@link ema}: reads `out[i - 1]`, writes and returns `out[i]`.
 * `out` holds the values of earlier bars, e.g. from {@link ema}.
 */
export function emaAt(values: Series, i: number, length: number, out: Float64Array): number {
  checkLength(length);
  return expAverageAt((j) => values[j]!, i, length, 2 / (length + 1), out);
}

/** Warmup of {@link ema}: how many leading bars are NaN. */
export const emaLookback = (length: number): number => length - 1;

/**
 * Wilder's moving average (smoothing `1 / length`), as used by RSI and ATR.
 * Seeded and warmed up like {@link ema}. Lookback `length - 1`.
 */
export function rma(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  return expAverage(values, length, 1 / length, output(values.length, out, values));
}

/** Single-bar form of {@link rma}: reads `out[i - 1]`, writes and returns `out[i]`. */
export function rmaAt(values: Series, i: number, length: number, out: Float64Array): number {
  checkLength(length);
  return expAverageAt((j) => values[j]!, i, length, 1 / length, out);
}

/** Warmup of {@link rma}: how many leading bars are NaN. */
export const rmaLookback = (length: number): number => length - 1;

/**
 * Linearly weighted moving average: the newest value weighs `length`, the
 * oldest 1. Lookback `length - 1`. NaN when any value in the window is NaN.
 */
export function wma(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  const weights = (length * (length + 1)) / 2;
  let run = 0;
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) run = 0;
    else if (reanchor(++run, length)) {
      sum = 0;
      weighted = 0;
      for (let k = 1; k <= length; k++) {
        const x = values[i - length + k]!;
        sum += x;
        weighted += k * x;
      }
    } else if (run > length) {
      // Every value in the window drops one weight step; the oldest leaves.
      weighted += length * v - sum;
      sum += v - values[i - length]!;
    }
    res[i] = run >= length ? weighted / weights : NaN;
  }
  return res;
}

/** Single-bar form of {@link wma}: the value at bar `i`. */
export function wmaAt(values: Series, i: number, length: number): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i)) return NaN;
  let weighted = 0;
  for (let k = 1; k <= length; k++) weighted += k * values[i - length + k]!;
  return weighted / ((length * (length + 1)) / 2);
}

/** Warmup of {@link wma}: how many leading bars are NaN. */
export const wmaLookback = (length: number): number => length - 1;

/**
 * Volume-weighted moving average: `sum(value * volume) / sum(volume)` over the
 * last `length` bars. Lookback `length - 1`. NaN when the window holds a NaN
 * or no volume.
 */
export function vwma(values: Series, volume: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const n = commonLength(values, volume);
  const res = output(n, out, values, volume);
  let run = 0;
  let pv = 0;
  let vol = 0;
  // Zero-volume bars in the window, counted exactly: the rolling `vol` can keep
  // rounding residue when every bar's volume is 0.
  let zeros = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const w = volume[i]!;
    if (Number.isNaN(v) || Number.isNaN(w)) run = 0;
    else if (reanchor(++run, length)) {
      pv = 0;
      vol = 0;
      zeros = 0;
      for (let j = i - length + 1; j <= i; j++) {
        pv += values[j]! * volume[j]!;
        vol += volume[j]!;
        if (volume[j] === 0) zeros++;
      }
    } else if (run > length) {
      const k = i - length;
      pv += v * w - values[k]! * volume[k]!;
      vol += w - volume[k]!;
      zeros += (w === 0 ? 1 : 0) - (volume[k] === 0 ? 1 : 0);
    }
    res[i] = run >= length && zeros < length && vol !== 0 ? pv / vol : NaN;
  }
  return res;
}

/** Single-bar form of {@link vwma}: the value at bar `i`. */
export function vwmaAt(values: Series, volume: Series, i: number, length: number): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i) || !windowValid(volume, i - length + 1, i)) return NaN;
  let pv = 0;
  let vol = 0;
  for (let j = i - length + 1; j <= i; j++) {
    pv += values[j]! * volume[j]!;
    vol += volume[j]!;
  }
  return vol !== 0 ? pv / vol : NaN;
}

/** Warmup of {@link vwma}: how many leading bars are NaN. */
export const vwmaLookback = (length: number): number => length - 1;
