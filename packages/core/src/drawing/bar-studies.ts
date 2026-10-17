import { binVolume, profileLayout, VolumeProfile, type ProfileLayout } from '../profile/math';
import type { Bar } from '../types';
import type { BarSpan } from './types';
import { clampLow } from '../util/math';

/*
 * Calculations behind the data-aware drawing tools. Each keeps its sums for the
 * "settled" bars of its span, every bar but the newest one of the series, and
 * adds the newest bar on top when asked. A live bar that updates or appends
 * then costs one bar of work, not a pass over the whole span.
 */

/** How the bars of a span changed since a `SpanTracker` last looked. */
export type SpanChange = 'none' | 'tail' | 'reset';

/**
 * Follows a span of the main series bars between looks. `'tail'` means only
 * the newest bar changed or bars were appended: bars before `settled` are as
 * they were. Anything else (new data, history prepended, other anchors or
 * options) is a `'reset'`.
 */
export class SpanTracker {
  private data: readonly Bar[] | null = null;
  private length = 0;
  private last: Bar | undefined;
  /** The newest bar's values when last looked, for a bar updated in place. */
  #lastValues = '';
  #key = '';
  start = 0;
  end = 0;
  /** End of the bars that are final: the span's bars before the series' newest bar. */
  settled = 0;
  /** `settled` before the last `'tail'` change, where the newly settled bars start. */
  previous = 0;

  check(span: BarSpan, key: string): SpanChange {
    const { bars } = span;
    const last = bars[bars.length - 1];
    const same = bars === this.data && key === this.#key && span.start === this.start;
    if (same && bars.length >= this.length && span.end >= this.end) {
      if (bars.length === this.length && last === this.last && valuesOf(last) === this.#lastValues && span.end === this.end) {
        return 'none';
      }
      this.previous = this.settled;
      this.#take(span, last);
      return 'tail';
    }
    this.data = bars;
    this.#key = key;
    this.#take(span, last);
    this.previous = this.start;
    return 'reset';
  }

  #take(span: BarSpan, last: Bar | undefined): void {
    this.start = span.start;
    this.end = Math.max(span.start, span.end);
    this.length = span.bars.length;
    this.last = last;
    this.#lastValues = valuesOf(last);
    this.settled = clampLow(this.length - 1, this.start, this.end);
  }
}

/**
 * The fields of a bar the tools read, so a newest bar changed in place and
 * passed to `update` again still counts as changed.
 */
const valuesOf = (bar: Bar | undefined): string =>
  bar ? `${bar.high}|${bar.low}|${bar.close}|${bar.volume}|${bar.buyVolume}` : '';

/** Least-squares line through the closes of a run of bars, with x the bar offset from its first bar. */
export interface RegressionChannel {
  /** Bars fitted. */
  count: number;
  /** Fitted price at the first bar. */
  intercept: number;
  /** Price change per bar. */
  slope: number;
  /** Standard deviation of the closes around the line (population form). */
  deviation: number;
  /** Correlation of the closes with the bar offset, -1 to 1; 0 when either is flat. */
  r: number;
}

/** Running sums of a least-squares fit, prices taken relative to `origin` for precision. */
class RegressionSums {
  origin = 0;
  n = 0;
  sx = 0;
  sy = 0;
  sxx = 0;
  sxy = 0;
  syy = 0;

  reset(origin: number): this {
    this.origin = origin;
    this.n = this.sx = this.sy = this.sxx = this.sxy = this.syy = 0;
    return this;
  }

  copy(from: RegressionSums): this {
    this.origin = from.origin;
    this.n = from.n;
    this.sx = from.sx;
    this.sy = from.sy;
    this.sxx = from.sxx;
    this.sxy = from.sxy;
    this.syy = from.syy;
    return this;
  }

  add(x: number, price: number): void {
    if (!Number.isFinite(price)) return;
    const y = price - this.origin;
    this.n++;
    this.sx += x;
    this.sy += y;
    this.sxx += x * x;
    this.sxy += x * y;
    this.syy += y * y;
  }

  fit(): RegressionChannel | null {
    const { n } = this;
    if (n === 0) return null;
    const mx = this.sx / n;
    const my = this.sy / n;
    const vxx = this.sxx - this.sx * mx;
    const vxy = this.sxy - this.sx * my;
    const vyy = Math.max(0, this.syy - this.sy * my);
    const slope = vxx > 0 ? vxy / vxx : 0;
    const residual = Math.max(0, vyy - slope * vxy);
    return {
      count: n,
      intercept: my - slope * mx + this.origin,
      slope,
      deviation: Math.sqrt(residual / n),
      r: vxx > 0 && vyy > 0 ? clampLow(vxy / Math.sqrt(vxx * vyy), -1, 1) : 0,
    };
  }
}

/** A bar's close, or 0 when it has none, as the origin prices of a fit are taken from. */
const originOf = (bar: Bar | undefined): number => (bar && Number.isFinite(bar.close) ? bar.close : 0);

/**
 * Linear regression of the closes of bars `[start, end)` against their offset
 * from bar `start`. Null when no bar there has a finite close.
 */
export function regressionChannel(bars: readonly Bar[], start = 0, end = bars.length): RegressionChannel | null {
  const sums = new RegressionSums().reset(originOf(bars[start]));
  for (let i = Math.max(0, start); i < Math.min(end, bars.length); i++) sums.add(i - start, bars[i]!.close);
  return sums.fit();
}

/** `regressionChannel` of a span, kept up to date one bar at a time while live bars arrive. */
export class RegressionCache {
  readonly #tracker = new SpanTracker();
  readonly #settled = new RegressionSums();
  private readonly live = new RegressionSums();
  #result: RegressionChannel | null = null;

  get(span: BarSpan, key = ''): RegressionChannel | null {
    const t = this.#tracker;
    const change = t.check(span, key);
    if (change === 'none') return this.#result;
    const { bars } = span;
    if (change === 'reset') this.#settled.reset(originOf(bars[t.start]));
    for (let i = t.previous; i < t.settled; i++) this.#settled.add(i - t.start, bars[i]!.close);
    this.live.copy(this.#settled);
    for (let i = t.settled; i < t.end; i++) this.live.add(i - t.start, bars[i]!.close);
    return (this.#result = this.live.fit());
  }

  /** Index of the first bar of the fit, valid after `get`. */
  get start(): number {
    return this.#tracker.start;
  }

  /** End (exclusive) of the bars of the fit, valid after `get`. */
  get end(): number {
    return this.#tracker.end;
  }
}

/** Typical price of a bar: the mean of its high, low and close. */
export const typicalPrice = (bar: Bar): number => (bar.high + bar.low + bar.close) / 3;

/**
 * Volume-weighted average price from bar `start` on, one value per bar of
 * `[start, end)`: the average of the typical prices so far, weighted by their
 * volume, with the volume-weighted standard deviation around it. A value is
 * NaN until a bar with volume arrives. Kept up to date one bar at a time.
 */
export class AnchoredVwap {
  readonly #tracker = new SpanTracker();
  #origin = 0;
  /** Sums over the settled bars: volume, volume × (price - origin) and volume × (price - origin)². */
  #v = 0;
  #pv = 0;
  #ppv = 0;
  /** VWAP at bar `start + k`. */
  values: number[] = [];
  /** Standard deviation around the VWAP at bar `start + k`. */
  deviations: number[] = [];

  /** Bring the values up to date with `span`; returns this. */
  update(span: BarSpan, key = ''): this {
    const t = this.#tracker;
    const change = t.check(span, key);
    if (change === 'none') return this;
    const { bars } = span;
    if (change === 'reset') {
      const first = bars[t.start] ? typicalPrice(bars[t.start]!) : 0;
      this.#origin = Number.isFinite(first) ? first : 0;
      this.#v = this.#pv = this.#ppv = 0;
      this.values = [];
      this.deviations = [];
    }
    // Settled values stay; recompute from where the old newest bar was.
    this.values.length = this.deviations.length = t.previous - t.start;
    for (let i = t.previous; i < t.settled; i++) this.step(bars[i]!, true);
    let sums: [number, number, number] = [this.#v, this.#pv, this.#ppv];
    for (let i = t.settled; i < t.end; i++) sums = this.step(bars[i]!, false, ...sums);
    return this;
  }

  /** Index of the anchor bar, valid after `update`. */
  get start(): number {
    return this.#tracker.start;
  }

  /** End (exclusive) of the bars with values, valid after `update`. */
  get end(): number {
    return this.#tracker.end;
  }

  /** Add `bar`, to the settled sums when `settle`, and push its value. Returns the sums after it. */
  private step(bar: Bar, settle: boolean, v = this.#v, pv = this.#pv, ppv = this.#ppv): [number, number, number] {
    const volume = bar.volume;
    const p = typicalPrice(bar) - this.#origin;
    if (volume !== undefined && volume > 0 && Number.isFinite(p)) {
      v += volume;
      pv += volume * p;
      ppv += volume * p * p;
    }
    if (settle) {
      this.#v = v;
      this.#pv = pv;
      this.#ppv = ppv;
    }
    const mean = v > 0 ? pv / v : NaN;
    this.values.push(mean + this.#origin);
    this.deviations.push(v > 0 ? Math.sqrt(Math.max(0, ppv / v - mean * mean)) : NaN);
    return [v, pv, ppv];
  }
}

/**
 * Volume profile of a span, `computeVolumeProfile` over its bars, kept up to
 * date while live bars arrive: the settled bars stay binned, and a live bar is
 * binned on a copy of them. Only a bar that moves the span's high or low,
 * which changes every row, re-bins the whole span.
 */
export class RangeProfileCache {
  readonly #tracker = new SpanTracker();
  readonly #settled = new VolumeProfile();
  readonly profile = new VolumeProfile();
  /** Low and high the rows were laid out over. */
  private low = Infinity;
  private high = -Infinity;
  /** Low and high of the settled bars. */
  #settledLow = Infinity;
  #settledHigh = -Infinity;

  /** The profile of `span` with `rows` rows and a `valueArea` percent value area. */
  get(span: BarSpan, rows: number, valueArea: number, key = ''): VolumeProfile {
    const t = this.#tracker;
    const change = t.check(span, `${key}|${rows}|${valueArea}`);
    if (change === 'none') return this.profile;
    const { bars } = span;
    if (change === 'reset') {
      this.#settledLow = Infinity;
      this.#settledHigh = -Infinity;
    }
    let low = this.#settledLow;
    let high = this.#settledHigh;
    for (let i = t.previous; i < t.end; i++) {
      const bar = bars[i]!;
      if (bar.low < low) low = bar.low;
      if (bar.high > high) high = bar.high;
      if (i === t.settled - 1) {
        this.#settledLow = low;
        this.#settledHigh = high;
      }
    }
    if (change === 'reset' || low !== this.low || high !== this.high) {
      this.low = low;
      this.high = high;
      this.#settled.reset(profileLayout(low, high, { rows }));
      binVolume(bars, t.start, t.settled, this.#settled);
    } else {
      binVolume(bars, t.previous, t.settled, this.#settled);
    }
    copyProfile(this.#settled, this.profile);
    binVolume(bars, t.settled, t.end, this.profile);
    return this.profile.updateStats(valueArea);
  }
}

/** Copy the rows and totals of `from` into `to`. */
function copyProfile(from: VolumeProfile, to: VolumeProfile): void {
  const layout: ProfileLayout = { start: from.start, rowSize: from.rowSize, rows: from.rows };
  to.reset(layout);
  to.volume.set(from.volume.subarray(0, from.rows));
  to.buy.set(from.buy.subarray(0, from.rows));
  to.sell.set(from.sell.subarray(0, from.rows));
  to.hasBuySell = from.hasBuySell;
  to.total = from.total;
}
