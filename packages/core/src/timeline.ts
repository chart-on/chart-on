import type { Time } from './types';
import { computeTickWeights, tickWeight } from './util/format';
import { UTC, type Zone } from './util/timezone';
import { isTradingDay, nextSessionOpen, tradingDay, type CompiledSession } from './util/session';
import { replaceFront } from './util/array';
import { bisect } from './util/search';

const DAY = 86400;
/** Bars projected past the last one at most; further out the fixed interval takes over. */
const MAX_PROJECTED = 20000;

/**
 * Maps bar times to logical indices. Before the first bar it extrapolates by
 * the bar interval; after the last it follows the projected bar calendar
 * (see `projectNext`).
 */
export class Timeline {
  times: Time[] = [];
  /** Bar interval in seconds (smallest recent gap). */
  interval = 60;
  /** Tick weight per bar (a view of `weightBuf`, which has room to grow at both ends). */
  weights: Uint8Array = new Uint8Array(0);
  #weightBuf: Uint8Array = new Uint8Array(0);
  /** Position of `weights[0]` in `weightBuf`. */
  #weightHead = 0;
  /**
   * Bars added at the front by `prepend` since the last `set`: an index taken
   * when this was `s` is `index + (shift - s)` now. Lets caches keyed on the
   * `times` array (which `append` and `prepend` keep) tell the two apart.
   */
  shift = 0;
  /** Timezone and session that tick weights (day, month, year boundaries) follow. */
  zone: Zone = UTC;
  session: CompiledSession | null = null;

  /** Replace every time; the timeline takes ownership of the array. O(n). */
  set(times: Time[]): void {
    this.times = times;
    this.interval = detectInterval(times);
    this.shift = 0;
    this.#setWeights(computeTickWeights(times, this.zone, this.session));
  }

  /**
   * Add a bar newer than the last one. Only the new bar's tick weight is
   * computed and storage grows geometrically, so streaming stays O(1) per bar.
   */
  append(time: Time): void {
    const n = this.times.length;
    this.times.push(time);
    if (this.#weightHead + n + 1 > this.#weightBuf.length) {
      this.#moveWeights(this.#weightHead, Math.max(this.#weightHead + n + 1, Math.ceil(this.#weightBuf.length * 1.5), 256));
    }
    this.#weightBuf[this.#weightHead + n] = n > 0 ? tickWeight(this.times[n - 1]!, time, this.zone, this.session) : 0;
    this.weights = this.#weightBuf.subarray(this.#weightHead, this.#weightHead + n + 1);
    this.interval = detectInterval(this.times);
  }

  /**
   * Add bars older than the first one; `times` ascending. Tick weights are
   * computed for the new bars and the old first bar only (it now has a bar
   * before it), and weight storage keeps headroom in front, so a page costs
   * O(page) apart from moving the `times` array once.
   */
  prepend(times: readonly Time[]): void {
    const k = times.length;
    if (k === 0) return;
    const n = this.times.length;
    replaceFront(this.times, 0, times);
    if (k > this.#weightHead) {
      const room = k + Math.max(Math.ceil(n * 0.5), 256);
      this.#moveWeights(room, room + n + Math.max(this.#weightBuf.length - this.#weightHead - n, 0));
    }
    this.#weightHead -= k;
    const w = this.#weightBuf;
    const h = this.#weightHead;
    w[h] = 0;
    const last = Math.min(k, n + k - 1);
    for (let i = 1; i <= last; i++) w[h + i] = tickWeight(this.times[i - 1]!, this.times[i]!, this.zone, this.session);
    this.weights = w.subarray(h, h + n + k);
    this.interval = detectInterval(this.times);
    this.shift += k;
  }

  setZone(zone: Zone, session: CompiledSession | null): void {
    this.zone = zone;
    this.session = session;
    this.#setWeights(computeTickWeights(this.times, zone, session));
  }

  #setWeights(weights: Uint8Array): void {
    this.#weightBuf = this.weights = weights;
    this.#weightHead = 0;
  }

  /** Copy the weights into a new buffer of `size` bytes, starting at `head`. */
  #moveWeights(head: number, size: number): void {
    const next = new Uint8Array(size);
    next.set(this.weights, head);
    this.#weightBuf = next;
    this.#weightHead = head;
    this.weights = next.subarray(head, head + this.weights.length);
  }

  /** Projected bar times after the last bar, made on demand; `futureKey` says what they were made from. */
  #future: Time[] = [];
  #futureKey: unknown[] = [];
  /** Weekdays (0 = Sunday, of the wall date) daily bars fall on, learned from the newest bars. */
  #barDays: Set<number> | null = null;

  /**
   * Projected times of the `count` bars after the last one, oldest first (fewer
   * when the projection is capped). The array is cached; do not change it.
   */
  projected(count: number): readonly Time[] {
    const n = this.times.length;
    const key = [n, this.times[n - 1], this.interval, this.zone, this.session];
    if (key.some((v, i) => v !== this.#futureKey[i])) {
      this.#future = [];
      this.#futureKey = key;
      this.#barDays = null;
    }
    const f = this.#future;
    const want = Math.min(count, MAX_PROJECTED);
    let t = f.length > 0 ? f[f.length - 1]! : this.times[n - 1];
    if (t === undefined) return f;
    while (f.length < want) {
      t = this.#projectNext(t);
      f.push(t);
    }
    return f;
  }

  /** Tick weights of the `count` projected bars, the first measured from the last real bar. */
  projectedWeights(count: number): Uint8Array {
    const f = this.projected(count);
    const out = new Uint8Array(f.length);
    let prev = this.times[this.times.length - 1];
    for (let k = 0; k < f.length; k++) {
      out[k] = prev === undefined ? 0 : tickWeight(prev, f[k]!, this.zone, this.session);
      prev = f[k];
    }
    return out;
  }

  /**
   * The bar after one at `time`. Intraday bars with a session step by the
   * interval while in session, then jump to the next session open. Daily
   * bars step by whole days, skipping days the session closes or, without
   * one, weekdays the recent bars never fall on. Otherwise: the fixed interval.
   */
  #projectNext(time: Time): Time {
    const step = this.interval;
    const session = this.session;
    if (step < DAY && session) {
      const zone = this.zone;
      const open = nextSessionOpen(session, zone.wall(time + step));
      return open === null ? time + step : Math.max(time + step, zone.fromWall(open));
    }
    if (step < DAY || step >= 7 * DAY) return time + step;
    const days = Math.round(step / DAY);
    for (let k = days, tries = 0; tries < 14; k += days, tries++) {
      const next = time + k * DAY;
      if (this.#tradesOn(next)) return next;
    }
    return time + step;
  }

  /** Whether a daily bar can fall at `time`. */
  #tradesOn(time: Time): boolean {
    const wall = this.zone.wall(time);
    if (this.session) return isTradingDay(this.session, tradingDay(this.session, wall));
    if (!this.#barDays) {
      const recent = this.times.slice(-40);
      const days = new Set(recent.map((t) => new Date(this.zone.wall(t) * 1000).getUTCDay()));
      // Too few bars to tell, or every weekday seen: no day is skipped.
      this.#barDays = recent.length < 10 || days.size === 7 ? new Set([0, 1, 2, 3, 4, 5, 6]) : days;
    }
    return this.#barDays.has(new Date(wall * 1000).getUTCDay());
  }

  get length(): number {
    return this.times.length;
  }

  get lastIndex(): number {
    return this.times.length - 1;
  }

  /** Exact index of `time`, or -1. */
  indexOf(time: Time): number {
    const i = lowerBound(this.times, time);
    return this.times[i] === time ? i : -1;
  }

  /**
   * Exact index of `time` among the bars, or past the last bar among the
   * projected ones (see `projected`), so items placed on future bar times
   * (a forecast) have a slot. -1 when `time` is on neither.
   */
  slotOf(time: Time): number {
    const n = this.times.length;
    const last = this.times[n - 1];
    if (last === undefined || !(time > last)) return this.indexOf(time);
    let f = this.projected(Math.min(64, MAX_PROJECTED));
    while (f.length > 0 && f[f.length - 1]! < time && f.length < MAX_PROJECTED) f = this.projected(f.length * 2);
    const k = lowerBound(f, time);
    return f[k] === time ? n + k : -1;
  }

  /** Fractional index for any time, extrapolated outside the data range. */
  indexFromTime(time: Time): number {
    const t = this.times;
    if (t.length === 0) return 0;
    const first = t[0]!;
    const last = t[t.length - 1]!;
    if (time <= first) return (time - first) / this.interval;
    if (time >= last) return this.#futureIndex(time);
    const i = lowerBound(t, time);
    const hi = t[i]!;
    if (hi === time) return i;
    const lo = t[i - 1]!;
    return i - 1 + (time - lo) / (hi - lo);
  }

  /** Time at a (rounded) index, extrapolated outside the data range. */
  timeFromIndex(index: number): Time {
    const t = this.times;
    if (t.length === 0) return 0;
    const i = Math.round(index);
    if (i < 0) return t[0]! + i * this.interval;
    if (i >= t.length) {
      const k = i - t.length + 1;
      const f = this.projected(k);
      return k <= f.length ? f[k - 1]! : (f[f.length - 1] ?? t[t.length - 1]!) + (k - f.length) * this.interval;
    }
    return t[i]!;
  }

  /** Fractional index of a time at or after the last bar, on the projected calendar. */
  #futureIndex(time: Time): number {
    const t = this.times;
    const n = t.length;
    let prev = t[n - 1]!;
    if (time === prev) return n - 1;
    // Grow the projection until it passes `time` (doubling, so lookups stay cheap).
    let f = this.projected(Math.min(64, MAX_PROJECTED));
    while (f.length > 0 && f[f.length - 1]! < time && f.length < MAX_PROJECTED) f = this.projected(f.length * 2);
    const k = lowerBound(f, time);
    if (k >= f.length) {
      const end = f[f.length - 1] ?? prev;
      return n - 1 + f.length + (time - end) / this.interval;
    }
    if (k > 0) prev = f[k - 1]!;
    const next = f[k]!;
    return n - 1 + k + (time - prev) / (next - prev);
  }
}

/** Index of the first of ascending `sorted` at or above `value`. */
export function lowerBound(sorted: ArrayLike<number>, value: number): number {
  return bisect(sorted.length, (i) => sorted[i]! < value);
}

export function detectInterval(times: readonly Time[]): number {
  let best = Infinity;
  const start = Math.max(1, times.length - 50);
  for (let i = start; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    if (gap > 0 && gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : 60;
}
