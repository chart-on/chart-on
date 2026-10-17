import { commonLength, output, previous, type Series } from './internal';

/** Returns true when bar `index` opens a new session, which restarts {@link vwap}. */
export type SessionStart = (index: number) => boolean;

/** Running sums behind {@link vwap}, kept so {@link vwapAt} can continue them. */
export interface VwapState {
  /** Sum of `price * volume` since the session start. */
  priceVolume: Float64Array;
  /** Sum of `volume` since the session start. */
  volume: Float64Array;
}

/**
 * Volume-weighted average price: `sum(price * volume) / sum(volume)` since the
 * session start. Without `newSession` it runs over the whole series.
 * `price` is usually `(high + low + close) / 3`. Lookback 0; NaN while the
 * session has no volume. A NaN input gives NaN and starts a new session.
 *
 * Pass `state` to keep the running sums for {@link vwapAt}.
 */
export function vwap(
  price: Series,
  volume: Series,
  newSession?: SessionStart,
  out?: Float64Array,
  state?: VwapState,
): Float64Array {
  const n = commonLength(price, volume);
  const res = output(n, out, price, volume);
  let pv = NaN;
  let vol = NaN;
  for (let i = 0; i < n; i++) {
    const p = price[i]!;
    const v = volume[i]!;
    if (Number.isNaN(pv) || newSession?.(i)) pv = vol = 0;
    pv += p * v;
    vol += v;
    if (state) {
      state.priceVolume[i] = pv;
      state.volume[i] = vol;
    }
    res[i] = vol !== 0 ? pv / vol : NaN;
  }
  return res;
}

/**
 * Single-bar form of {@link vwap}: reads bar `i - 1` of `state`, writes bar `i`
 * of `state` and `out`, and returns the VWAP.
 */
export function vwapAt(
  price: Series,
  volume: Series,
  i: number,
  out: Float64Array,
  state: VwapState,
  newSession?: SessionStart,
): number {
  const prev = previous(state.priceVolume, i);
  const fresh = Number.isNaN(prev) || newSession?.(i);
  const pv = (fresh ? 0 : prev) + price[i]! * volume[i]!;
  const vol = (fresh ? 0 : state.volume[i - 1]!) + volume[i]!;
  state.priceVolume[i] = pv;
  state.volume[i] = vol;
  return (out[i] = vol !== 0 ? pv / vol : NaN);
}

/** Warmup of {@link vwap}: how many leading bars are NaN. */
export const vwapLookback = (): number => 0;

/**
 * On-balance volume: a running total that adds the bar's volume when the close
 * rises and subtracts it when the close falls. Starts at 0 on the first bar.
 * Lookback 0. A NaN input gives NaN and the total starts again from 0.
 */
export function obv(close: Series, volume: Series, out?: Float64Array): Float64Array {
  const n = commonLength(close, volume);
  const res = output(n, out, close, volume);
  for (let i = 0; i < n; i++) obvAt(close, volume, i, res);
  return res;
}

/** Single-bar form of {@link obv}: reads `out[i - 1]`, writes and returns `out[i]`. */
export function obvAt(close: Series, volume: Series, i: number, out: Float64Array): number {
  const c = close[i]!;
  const v = volume[i]!;
  const prev = previous(out, i);
  let value: number;
  if (Number.isNaN(c) || Number.isNaN(v)) value = NaN;
  else if (Number.isNaN(prev)) value = 0;
  else value = prev + Math.sign(c - close[i - 1]!) * v;
  return (out[i] = value);
}

/** Warmup of {@link obv}: how many leading bars are NaN. */
export const obvLookback = (): number => 0;
