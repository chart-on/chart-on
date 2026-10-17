import { checkLength, commonLength, output, previous, reanchor, windowValid, type Series } from './internal';

/**
 * Highest value over the last `length` bars. Lookback `length - 1`.
 * NaN when any value in the window is NaN.
 */
export function highest(values: Series, length: number, out?: Float64Array): Float64Array {
  return extreme(values, length, output(values.length, out, values), 1);
}

/** Single-bar form of {@link highest}: the value at bar `i`. */
export function highestAt(values: Series, i: number, length: number): number {
  return extremeAt(values, i, length, 1);
}

/** Warmup of {@link highest}: how many leading bars are NaN. */
export const highestLookback = (length: number): number => length - 1;

/**
 * Lowest value over the last `length` bars. Lookback `length - 1`.
 * NaN when any value in the window is NaN.
 */
export function lowest(values: Series, length: number, out?: Float64Array): Float64Array {
  return extreme(values, length, output(values.length, out, values), -1);
}

/** Single-bar form of {@link lowest}: the value at bar `i`. */
export function lowestAt(values: Series, i: number, length: number): number {
  return extremeAt(values, i, length, -1);
}

/** Warmup of {@link lowest}: how many leading bars are NaN. */
export const lowestLookback = (length: number): number => length - 1;

/** Sliding max (`sign` 1) or min (`sign` -1) with a monotonic queue of bar indices. */
function extreme(values: Series, length: number, res: Float64Array, sign: 1 | -1): Float64Array {
  checkLength(length);
  const queue = new Int32Array(values.length);
  let head = 0;
  let tail = 0;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) {
      run = 0;
      head = tail = 0;
      res[i] = NaN;
      continue;
    }
    run++;
    while (tail > head && sign * values[queue[tail - 1]!]! <= sign * v) tail--;
    queue[tail++] = i;
    if (queue[head]! <= i - length) head++;
    res[i] = run >= length ? values[queue[head]!]! : NaN;
  }
  return res;
}

function extremeAt(values: Series, i: number, length: number, sign: 1 | -1): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i)) return NaN;
  let best = values[i]!;
  for (let j = i - length + 1; j < i; j++) if (sign * values[j]! > sign * best) best = values[j]!;
  return best;
}

/** Sum of the last `length` values. Lookback `length - 1`. NaN when the window holds a NaN. */
export function sum(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  let run = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) run = 0;
    else if (reanchor(++run, length)) {
      total = 0;
      for (let j = i - length + 1; j <= i; j++) total += values[j]!;
    } else if (run > length) total += v - values[i - length]!;
    res[i] = run >= length ? total : NaN;
  }
  return res;
}

/** Single-bar form of {@link sum}: the value at bar `i`. */
export function sumAt(values: Series, i: number, length: number): number {
  checkLength(length);
  if (!windowValid(values, i - length + 1, i)) return NaN;
  let total = 0;
  for (let j = i - length + 1; j <= i; j++) total += values[j]!;
  return total;
}

/** Warmup of {@link sum}: how many leading bars are NaN. */
export const sumLookback = (length: number): number => length - 1;

/** Difference to the value `length` bars back (default 1). Lookback `length`. */
export function change(values: Series, length = 1, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  for (let i = 0; i < values.length; i++) res[i] = changeAt(values, i, length);
  return res;
}

/** Single-bar form of {@link change}: the value at bar `i`. */
export function changeAt(values: Series, i: number, length = 1): number {
  checkLength(length);
  return i >= length ? values[i]! - values[i - length]! : NaN;
}

/** Warmup of {@link change}: how many leading bars are NaN. */
export const changeLookback = (length = 1): number => length;

/**
 * Running total. Lookback 0. A NaN input gives NaN and the total starts again
 * from the next value.
 */
export function cum(values: Series, out?: Float64Array): Float64Array {
  const res = output(values.length, out, values);
  for (let i = 0; i < values.length; i++) cumAt(values, i, res);
  return res;
}

/** Single-bar form of {@link cum}: reads `out[i - 1]`, writes and returns `out[i]`. */
export function cumAt(values: Series, i: number, out: Float64Array): number {
  const prev = previous(out, i);
  const v = values[i]!;
  return (out[i] = Number.isNaN(prev) ? v : prev + v);
}

/** Warmup of {@link cum}: how many leading bars are NaN. */
export const cumLookback = (): number => 0;

/**
 * 1 on bars where `a` crosses above `b` (`a > b` now, `a <= b` on the bar
 * before), else 0. `b` may be a constant level. Lookback 1; NaN when any of
 * the four values is NaN.
 */
export function crossOver(a: Series, b: Series | number, out?: Float64Array): Float64Array {
  return crossings(a, b, out, 1);
}

/** Single-bar form of {@link crossOver}: the value at bar `i`. */
export function crossOverAt(a: Series, b: Series | number, i: number): number {
  return crossAt(a, b, i, 1);
}

/** 1 on bars where `a` crosses below `b`, else 0. Mirror of {@link crossOver}. */
export function crossUnder(a: Series, b: Series | number, out?: Float64Array): Float64Array {
  return crossings(a, b, out, -1);
}

/** Single-bar form of {@link crossUnder}: the value at bar `i`. */
export function crossUnderAt(a: Series, b: Series | number, i: number): number {
  return crossAt(a, b, i, -1);
}

/** Warmup of {@link crossOver} and {@link crossUnder}: how many leading bars are NaN. */
export const crossLookback = (): number => 1;

function crossings(a: Series, b: Series | number, out: Float64Array | undefined, sign: 1 | -1): Float64Array {
  const n = typeof b === 'number' ? a.length : commonLength(a, b);
  const res = typeof b === 'number' ? output(n, out, a) : output(n, out, a, b);
  for (let i = 0; i < n; i++) res[i] = crossAt(a, b, i, sign);
  return res;
}

function crossAt(a: Series, b: Series | number, i: number, sign: 1 | -1): number {
  if (i < 1) return NaN;
  const diff = sign * (a[i]! - (typeof b === 'number' ? b : b[i]!));
  const before = sign * (a[i - 1]! - (typeof b === 'number' ? b : b[i - 1]!));
  if (Number.isNaN(diff) || Number.isNaN(before)) return NaN;
  return diff > 0 && before <= 0 ? 1 : 0;
}
