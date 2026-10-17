/**
 * Pure helpers that put values computed on a higher interval's bars onto the
 * chart's lower-interval bars. A higher bar holds the lower bars from its time
 * up to the next higher bar's time (not `time + interval`, so session gaps,
 * DST days and calendar months need no special care); the newest higher bar
 * holds every later lower bar.
 */
import type { Time } from '../types';
import type { BarArrays } from './types';

/** Options for `alignSteps`: whether a higher-interval value shows only once its bar has closed. */
export interface AlignStepsOptions {
  /**
   * Show a higher bar's value only once the bar has closed, i.e. from the
   * next higher bar's time on. Plotted values then never change in hindsight,
   * and the forming higher bar shows nothing yet. Default false: each lower
   * bar shows the value of the higher bar it falls in, which on past bars is
   * that bar's final value (see `formingSteps` for values as they were).
   */
  closedOnly?: boolean;
}

/**
 * Index of the higher bar that holds `time`: the last one whose time is at or
 * before it, or -1 before the first.
 */
function holder(higherTimes: ArrayLike<Time>, time: Time, from: number): number {
  let j = from;
  while (j + 1 < higherTimes.length && higherTimes[j + 1]! <= time) j++;
  return j;
}

/**
 * Values of the higher bars at `higherTimes` (ascending), one per lower bar at
 * `lowerTimes` (ascending), as steps: a higher bar's value holds until the
 * next higher bar starts. NaN before the first higher bar (and, with
 * `closedOnly`, until the first one closes).
 */
export function alignSteps(
  lowerTimes: ArrayLike<Time>,
  higherTimes: ArrayLike<Time>,
  values: ArrayLike<number>,
  options: AlignStepsOptions = {},
): Float64Array {
  const n = lowerTimes.length;
  const out = new Float64Array(n).fill(NaN);
  const shift = options.closedOnly ? 1 : 0;
  let j = -1;
  for (let k = 0; k < n; k++) {
    j = holder(higherTimes, lowerTimes[k]!, j);
    const i = j - shift;
    if (i >= 0) out[k] = values[i]!;
  }
  return out;
}

/**
 * Value of a higher-interval calculation at higher bar `index` of `bars`. It
 * may read and keep state for earlier bars, like an indicator's `update`.
 */
export type HigherStep = (bars: BarArrays, index: number) => number;

/**
 * Values of a higher-interval calculation as they stood at each lower bar,
 * with no hindsight: for a lower bar inside higher bar `j`, `step` sees bar
 * `j` as it was then, built from the lower bars so far (the higher bar's
 * open, the highest high and lowest low so far, that lower bar's close and
 * the volume so far), and the earlier higher bars complete.
 *
 * `step` is called with ascending indexes. Every higher bar before `index` has
 * been passed complete before the first call for `index`, which may then be
 * repeated with each newer partial bar, so `step` must only read state for
 * bars before `index`. NaN before the first higher bar.
 */
export function formingSteps(lower: BarArrays, higher: BarArrays, step: HigherStep): Float64Array {
  const n = lower.length;
  const out = new Float64Array(n).fill(NaN);
  const work = copyBars(higher);
  /** Higher bars before `done` were passed to `step` complete. */
  let done = 0;
  let j = -1;
  let high = -Infinity;
  let low = Infinity;
  let volume = NaN;
  for (let k = 0; k < n; k++) {
    const next = holder(higher.time, lower.time[k]!, j);
    if (next < 0) continue;
    if (next !== j) {
      if (j >= 0) restore(work, higher, j);
      for (let i = done; i < next; i++) step(work, i);
      done = next;
      j = next;
      high = -Infinity;
      low = Infinity;
      volume = NaN;
    }
    high = Math.max(high, lower.high[k]!);
    low = Math.min(low, lower.low[k]!);
    const v = lower.volume[k]!;
    if (Number.isFinite(v)) volume = Number.isNaN(volume) ? v : volume + v;
    work.high[j] = high;
    work.low[j] = low;
    work.close[j] = lower.close[k]!;
    work.volume[j] = volume;
    out[k] = step(work, j);
  }
  return out;
}

interface MutableBars {
  length: number;
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

function copyBars(bars: BarArrays): MutableBars {
  return {
    length: bars.length,
    time: Float64Array.from(bars.time),
    open: Float64Array.from(bars.open),
    high: Float64Array.from(bars.high),
    low: Float64Array.from(bars.low),
    close: Float64Array.from(bars.close),
    volume: Float64Array.from(bars.volume),
  };
}

/** Put higher bar `i`'s own values back after it was written as a partial bar. */
function restore(work: MutableBars, bars: BarArrays, i: number): void {
  work.high[i] = bars.high[i]!;
  work.low[i] = bars.low[i]!;
  work.close[i] = bars.close[i]!;
  work.volume[i] = bars.volume[i]!;
}
