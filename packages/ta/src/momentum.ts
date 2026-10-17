import { ema, emaAt, sma, smaAt } from './average';
import { highest, highestAt, lowest, lowestAt } from './helpers';
import { checkLength, commonLength, output, previous, windowValid, type Series } from './internal';

/** Running averages behind {@link rsi}, kept so {@link rsiAt} can continue them. */
export interface RsiState {
  avgGain: Float64Array;
  avgLoss: Float64Array;
}

/**
 * Wilder's relative strength index, 0 to 100. Gains and losses are the
 * bar-to-bar changes, averaged with {@link rma}. Lookback `length`. A bar with
 * no losses reads 100, and 50 when it has no gains either.
 *
 * Pass `state` to keep the running averages for {@link rsiAt}.
 */
export function rsi(values: Series, length: number, out?: Float64Array, state?: RsiState): Float64Array {
  checkLength(length);
  const n = values.length;
  const res = output(n, out, values);
  let gain = NaN;
  let loss = NaN;
  let run = 0;
  let seedGain = 0;
  let seedLoss = 0;
  for (let i = 0; i < n; i++) {
    const d = i > 0 ? values[i]! - values[i - 1]! : NaN;
    if (Number.isNaN(d)) {
      gain = loss = NaN;
      run = 0;
      seedGain = seedLoss = 0;
    } else if (!Number.isNaN(gain)) {
      gain = (gain * (length - 1) + Math.max(d, 0)) / length;
      loss = (loss * (length - 1) + Math.max(-d, 0)) / length;
    } else {
      seedGain += Math.max(d, 0);
      seedLoss += Math.max(-d, 0);
      if (++run === length) {
        gain = seedGain / length;
        loss = seedLoss / length;
      }
    }
    if (state) {
      state.avgGain[i] = gain;
      state.avgLoss[i] = loss;
    }
    res[i] = strength(gain, loss);
  }
  return res;
}

/**
 * Single-bar form of {@link rsi}: reads bar `i - 1` of `state`, writes bar `i`
 * of `state` and `out`, and returns the RSI.
 */
export function rsiAt(values: Series, i: number, length: number, out: Float64Array, state: RsiState): number {
  checkLength(length);
  const d = i > 0 ? values[i]! - values[i - 1]! : NaN;
  const prevGain = previous(state.avgGain, i);
  let gain = NaN;
  let loss = NaN;
  if (Number.isNaN(d)) {
    // The run is broken; leave both averages NaN.
  } else if (!Number.isNaN(prevGain)) {
    const prevLoss = state.avgLoss[i - 1]!;
    gain = (prevGain * (length - 1) + Math.max(d, 0)) / length;
    loss = (prevLoss * (length - 1) + Math.max(-d, 0)) / length;
  } else if (windowValid(values, i - length, i)) {
    gain = 0;
    loss = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const dj = values[j]! - values[j - 1]!;
      gain += Math.max(dj, 0);
      loss += Math.max(-dj, 0);
    }
    gain /= length;
    loss /= length;
  }
  state.avgGain[i] = gain;
  state.avgLoss[i] = loss;
  return (out[i] = strength(gain, loss));
}

/** Warmup of {@link rsi}: how many leading bars are NaN. */
export const rsiLookback = (length: number): number => length;

function strength(gain: number, loss: number): number {
  if (Number.isNaN(gain) || Number.isNaN(loss)) return NaN;
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Output of {@link macd}: one column per line. */
export interface Macd {
  /** Fast {@link ema} minus slow {@link ema}. */
  macd: Float64Array;
  /** {@link ema} of the MACD line over `signal` bars. */
  signal: Float64Array;
  /** `macd - signal`. */
  histogram: Float64Array;
}

/** The two averages behind {@link macd}, kept so {@link macdAt} can continue them. */
export interface MacdState {
  fast: Float64Array;
  slow: Float64Array;
}

/**
 * Moving average convergence divergence. Lookback
 * `max(fast, slow) + signal - 2` (the MACD line itself starts `signal - 1` bars earlier).
 *
 * Pass `state` to keep the two averages for {@link macdAt}.
 */
export function macd(values: Series, fast: number, slow: number, signal: number, out?: Macd, state?: MacdState): Macd {
  checkLength(fast, 'fast');
  checkLength(slow, 'slow');
  checkLength(signal, 'signal');
  const n = values.length;
  const fastEma = ema(values, fast, state?.fast);
  const slowEma = ema(values, slow, state?.slow);
  const line = output(n, out?.macd, values);
  for (let i = 0; i < n; i++) line[i] = fastEma[i]! - slowEma[i]!;
  const sig = ema(line, signal, output(n, out?.signal, values));
  const histogram = output(n, out?.histogram, values);
  for (let i = 0; i < n; i++) histogram[i] = line[i]! - sig[i]!;
  return { macd: line, signal: sig, histogram };
}

/** Single-bar form of {@link macd}: reads bar `i - 1` and writes bar `i` of `out` and `state`. */
export function macdAt(
  values: Series,
  i: number,
  fast: number,
  slow: number,
  signal: number,
  out: Macd,
  state: MacdState,
): void {
  out.macd[i] = emaAt(values, i, fast, state.fast) - emaAt(values, i, slow, state.slow);
  out.histogram[i] = out.macd[i]! - emaAt(out.macd, i, signal, out.signal);
}

/** Warmup of {@link macd}: how many leading bars are NaN before every output has a value. */
export const macdLookback = (fast: number, slow: number, signal: number): number => Math.max(fast, slow) + signal - 2;

/** Output of {@link stoch} and {@link stochRsi}: the %K and %D lines. */
export interface Stoch {
  /** %K: where the close sits in the `kLength`-bar range, 0 to 100, smoothed by an {@link sma} of `kSmooth`. */
  k: Float64Array;
  /** %D: {@link sma} of %K over `dLength` bars. */
  d: Float64Array;
}

/**
 * Stochastic oscillator. A bar whose range is zero reads 50.
 * Lookback `kLength + kSmooth + dLength - 3` (%K starts `dLength - 1` bars earlier).
 */
export function stoch(
  high: Series,
  low: Series,
  close: Series,
  kLength: number,
  kSmooth: number,
  dLength: number,
  out?: Stoch,
): Stoch {
  checkLength(kLength, 'kLength');
  checkLength(kSmooth, 'kSmooth');
  checkLength(dLength, 'dLength');
  const n = commonLength(high, low, close);
  const raw = highest(high, kLength);
  const floor = lowest(low, kLength);
  for (let i = 0; i < n; i++) raw[i] = position(close[i]!, floor[i]!, raw[i]!);
  const k = sma(raw, kSmooth, output(n, out?.k, high, low, close));
  const d = sma(k, dLength, output(n, out?.d, high, low, close));
  return { k, d };
}

/** Single-bar form of {@link stoch}: reads earlier bars of `out.k` and writes bar `i` of `out`. */
export function stochAt(
  high: Series,
  low: Series,
  close: Series,
  i: number,
  kLength: number,
  kSmooth: number,
  dLength: number,
  out: Stoch,
): void {
  checkLength(kSmooth, 'kSmooth');
  let k = i >= kSmooth - 1 ? 0 : NaN;
  for (let j = i - kSmooth + 1; j <= i && !Number.isNaN(k); j++) {
    k += position(close[j]!, lowestAt(low, j, kLength), highestAt(high, j, kLength));
  }
  out.k[i] = k / kSmooth;
  out.d[i] = smaAt(out.k, i, dLength);
}

/** Warmup of {@link stoch}: how many leading bars are NaN before every output has a value. */
export const stochLookback = (kLength: number, kSmooth: number, dLength: number): number =>
  kLength + kSmooth + dLength - 3;

/** The RSI behind {@link stochRsi} and its running averages, kept so {@link stochRsiAt} can continue them. */
export interface StochRsiState extends RsiState {
  rsi: Float64Array;
}

/**
 * Stochastic RSI: the {@link stoch} formula applied to an {@link rsi} of
 * `rsiLength`. %K is where the RSI sits in its `stochLength`-bar range, 0 to
 * 100, smoothed by an {@link sma} of `kSmooth`; %D is an {@link sma} of %K over
 * `dLength`. A zero range reads 50.
 * Lookback `rsiLength + stochLength + kSmooth + dLength - 3`.
 *
 * Pass `state` to keep the RSI for {@link stochRsiAt}.
 */
export function stochRsi(
  values: Series,
  rsiLength: number,
  stochLength: number,
  kSmooth: number,
  dLength: number,
  out?: Stoch,
  state?: StochRsiState,
): Stoch {
  checkLength(rsiLength, 'rsiLength');
  checkLength(stochLength, 'stochLength');
  checkLength(kSmooth, 'kSmooth');
  checkLength(dLength, 'dLength');
  const n = values.length;
  const strengths = rsi(values, rsiLength, state?.rsi, state);
  const raw = highest(strengths, stochLength);
  const floor = lowest(strengths, stochLength);
  for (let i = 0; i < n; i++) raw[i] = position(strengths[i]!, floor[i]!, raw[i]!);
  const k = sma(raw, kSmooth, output(n, out?.k, values));
  const d = sma(k, dLength, output(n, out?.d, values));
  return { k, d };
}

/**
 * Single-bar form of {@link stochRsi}: reads earlier bars of `out.k` and
 * `state`, and writes bar `i` of both.
 */
export function stochRsiAt(
  values: Series,
  i: number,
  rsiLength: number,
  stochLength: number,
  kSmooth: number,
  dLength: number,
  out: Stoch,
  state: StochRsiState,
): void {
  checkLength(kSmooth, 'kSmooth');
  const strengths = state.rsi;
  rsiAt(values, i, rsiLength, strengths, state);
  let k = i >= kSmooth - 1 ? 0 : NaN;
  for (let j = i - kSmooth + 1; j <= i && !Number.isNaN(k); j++) {
    k += position(strengths[j]!, lowestAt(strengths, j, stochLength), highestAt(strengths, j, stochLength));
  }
  out.k[i] = k / kSmooth;
  out.d[i] = smaAt(out.k, i, dLength);
}

/** Warmup of {@link stochRsi}: how many leading bars are NaN before every output has a value. */
export const stochRsiLookback = (rsiLength: number, stochLength: number, kSmooth: number, dLength: number): number =>
  rsiLength + stochLength + kSmooth + dLength - 3;

function position(close: number, floor: number, ceiling: number): number {
  const range = ceiling - floor;
  return range === 0 ? 50 : (100 * (close - floor)) / range;
}

/** Rate of change in percent against the value `length` bars back. Lookback `length`; NaN when that value is 0. */
export function roc(values: Series, length: number, out?: Float64Array): Float64Array {
  checkLength(length);
  const res = output(values.length, out, values);
  for (let i = 0; i < values.length; i++) res[i] = rocAt(values, i, length);
  return res;
}

/** Single-bar form of {@link roc}: the value at bar `i`. */
export function rocAt(values: Series, i: number, length: number): number {
  checkLength(length);
  if (i < length) return NaN;
  const base = values[i - length]!;
  return base === 0 ? NaN : (100 * (values[i]! - base)) / base;
}

/** Warmup of {@link roc}: how many leading bars are NaN. */
export const rocLookback = (length: number): number => length;
