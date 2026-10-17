import { prefersReducedMotion } from './pulse';
import type { CandleSeries } from './series';
import type { Bar, Time } from './types';
import { boundByTime } from './util/search';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Where a replay stands; see `chart.replay`. */
export interface ReplayState {
  /** A replay is running: bars after `time` are hidden. */
  active: boolean;
  /** Bars are revealed on a timer. */
  playing: boolean;
  /** Time of the newest bar shown, or null when no replay is active. */
  time: Time | null;
  /** Bars revealed per second while playing. */
  speed: number;
  /** Bars still hidden. */
  remaining: number;
}

/** Options for `chart.replay.startRandom`. */
export interface ReplayRandomOptions {
  /** Bars that must show before the start bar, for indicator warm-up. Default 100. */
  minBefore?: number;
  /** Bars that must stay hidden after the start bar, to replay. Default 50. */
  minAfter?: number;
  /** Random number in [0, 1); default `Math.random`. Inject one for repeatable starts. */
  random?: () => number;
}

/** What a replay needs from its chart. */
export interface ReplayHost {
  /** The main candle series, or null. */
  main(): CandleSeries | null;
  /** The replay changed state (`replay:change`). */
  changed(state: ReplayState): void;
  /** Bring the newest shown bar into view after a start. */
  follow(): void;
  /** The chart shows animations (not static, not low power). */
  animated(): boolean;
  /** A bar was revealed: slide the view onto it over `ms` (until the next bar) if it follows the newest bar. */
  glide(ms: number): void;
}

/** Shortest wait between two ticks of a growing bar (ms); above 5 bars per second (under 4 ticks) bars appear whole. */
const TICK_MS = 50;
/** Most ticks a bar grows in. */
const MAX_TICKS = 12;

/**
 * Bar replay of the main series: from a chosen bar, later bars are hidden and
 * revealed one at a time, by `step` or on a timer, so indicators, followers,
 * the legend and the scales only ever see bars up to the replay time. Bars
 * the data source delivers meanwhile (live bars, history pages, corrections)
 * are kept, hidden, and shown when the replay reaches them or stops.
 *
 * While playing with `smooth` on, each bar grows from its open through a
 * made-up path inside its range to its close, like a live bar, and the view
 * glides onto it. The bar always ends on its real values.
 */
export class Replay {
  /** Every bar, shown or not; null when no replay is active. */
  private all: Bar[] | null = null;
  /** Bars shown: `all[0..shown)`. */
  private shown = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the newest shown bar started showing (`Date.now()` ms): ticks are timed from it, so rounded waits do not add up. */
  #slot = 0;
  #rate = 1;
  /** The newest shown bar is still growing: its tick, of `ticks`; null when it shows its real values. */
  #forming: { tick: number; ticks: number } | null = null;
  /**
   * Grow bars and glide the view while playing (default true). Off, or with
   * low power, a static chart or reduced motion asked for, bars appear whole.
   */
  smooth = true;

  readonly #host: ReplayHost;

  constructor(host: ReplayHost) {
    this.#host = host;
  }

  get state(): ReplayState {
    const all = this.all;
    return {
      active: all !== null,
      playing: this.timer !== null,
      time: all && this.shown > 0 ? all[this.shown - 1]!.time : null,
      speed: this.#rate,
      remaining: all ? all.length - this.shown : 0,
    };
  }

  get active(): boolean {
    return this.all !== null;
  }

  /**
   * Show bars up to `time` (the newest at or before it) and hide the rest.
   * False when there is no main series or no bar at or before `time`. While a
   * replay runs, this moves it to `time`, forward or back.
   */
  start(time: Time): boolean {
    if (!Number.isFinite(time)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Replay start needs a finite time' : '');
    const main = this.#host.main();
    if (!main) return false;
    const all = this.all ?? main.data.slice();
    const shown = countThrough(all, time);
    if (shown === 0) return false;
    this.all = all;
    this.shown = shown;
    this.#forming = null;
    main.setData(all.slice(0, shown));
    this.#host.follow();
    this.#report();
    return true;
  }

  /**
   * Start at a random loaded bar with at least `minBefore` bars before it and
   * `minAfter` after it, never the bar a running replay stands on when another
   * fits. False, changing nothing, when the bars are too few for both margins.
   */
  startRandom({ minBefore = 100, minAfter = 50, random = Math.random }: ReplayRandomOptions = {}): boolean {
    const bars = this.all ?? this.#host.main()?.data;
    if (!bars) return false;
    const lo = Math.max(0, Math.floor(minBefore));
    const hi = bars.length - 1 - Math.max(0, Math.floor(minAfter));
    if (hi < lo) return false;
    // Leave out the current bar so a restart always moves.
    const at = this.all ? this.shown - 1 : -1;
    const skip = hi > lo && at >= lo && at <= hi ? 1 : 0;
    const slots = hi - lo + 1 - skip;
    let i = lo + Math.min(slots - 1, Math.floor(random() * slots));
    if (skip && i >= at) i++;
    return this.start(bars[i]!.time);
  }

  /** Reveal the next `count` bars (default 1); false when none was hidden. */
  step(count = 1): boolean {
    const main = this.#host.main();
    const all = this.all;
    if (!main || !all) return false;
    this.#settle();
    if (this.shown >= all.length) return false;
    const end = Math.min(all.length, this.shown + Math.max(1, Math.floor(count)));
    for (let i = this.shown; i < end; i++) main.update(all[i]!);
    this.shown = end;
    if (this.shown >= all.length) this.pause(false);
    this.#report();
    return true;
  }

  /** Reveal bars on a timer at `speed` bars per second (default: the current speed) until the end or `pause`. */
  play(speed?: number): void {
    if (speed !== undefined) this.speed = speed;
    if (!this.all || this.timer !== null || this.state.remaining === 0) return;
    this.#slot = Date.now();
    this.#schedule();
    this.#report();
  }

  /** Stop playing; a bar still growing shows its real values. */
  pause(report = true): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.#settle();
    if (report) this.#report();
  }

  /** Bars revealed per second while playing, more than 0 and at most 100. */
  get speed(): number {
    return this.#rate;
  }

  set speed(value: number) {
    if (!(value > 0 && value <= 100)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Replay speed must be above 0 and at most 100 bars per second' : '');
    this.#rate = value;
    // A running timer keeps its current wait; the next one uses the new speed.
    if (!this.all) return;
    this.#report();
  }

  /** End the replay and show every bar, including those delivered meanwhile. */
  stop(): void {
    const all = this.all;
    if (!all) return;
    // Every bar shows next, so a growing one needs no settling.
    this.#forming = null;
    this.pause(false);
    this.all = null;
    this.shown = 0;
    this.#host.main()?.setData(all);
    this.#report();
  }

  /** End the replay without touching the series (a new symbol replaced its bars). */
  cancel(): void {
    if (!this.all) return;
    // The series holds other bars now: leave them alone.
    this.#forming = null;
    this.pause(false);
    this.all = null;
    this.shown = 0;
    this.#report();
  }

  /**
   * New full bars for the main series (a history page or a refetch) while
   * replaying: they replace the kept bars, and the bars up to the replay time
   * are shown.
   */
  replaceAll(bars: readonly Bar[]): void {
    const time = this.state.time;
    this.all = bars.slice();
    this.#forming = null;
    const main = this.#host.main();
    if (time === null || !main) return;
    this.shown = Math.max(1, countThrough(this.all, time));
    main.setData(this.all.slice(0, this.shown));
    this.#report();
  }

  /** A live bar while replaying: kept hidden at the end (replacing the last bar of the same time). */
  absorb(bar: Bar): void {
    const all = this.all;
    if (!all) return;
    const last = all[all.length - 1];
    if (last && bar.time < last.time) return;
    if (last && bar.time === last.time) {
      all[all.length - 1] = bar;
      // The newest bar is already shown: it updates in place, growing or not.
      if (this.shown === all.length) {
        this.#forming = null;
        this.#host.main()?.update(bar);
      }
    } else {
      all.push(bar);
    }
    this.#report();
  }

  #schedule(): void {
    const f = this.#forming;
    const ms = 1000 / this.#rate;
    const now = Date.now();
    // Far behind (a hidden tab): go on from now instead of catching up in a burst.
    if (this.#slot + ms < now) this.#slot = now;
    const due = this.#slot + (f ? (ms * (f.tick + 1)) / f.ticks : ms);
    this.timer = setTimeout(() => this.#advance(), due - now);
  }

  /** One timer tick while playing: grow the forming bar, or reveal the next one. */
  #advance(): void {
    // The handle stays set meanwhile, so reports still say playing.
    const all = this.all!;
    const main = this.#host.main();
    if (!main) {
      this.pause();
      return;
    }
    const f = this.#forming;
    if (f) {
      f.tick++;
      const bar = all[this.shown - 1]!;
      if (f.tick < f.ticks - 1) main.update(intrabar(bar, f.tick / (f.ticks - 1)));
      else this.#settle();
    } else if (this.shown < all.length) {
      const bar = all[this.shown++]!;
      this.#slot += 1000 / this.#rate;
      const ticks = this.#ticks();
      if (ticks > 1) this.#forming = { tick: 0, ticks };
      main.update(ticks > 1 ? intrabar(bar, 0) : bar);
      if (this.smooth && this.#host.animated()) this.#host.glide(1000 / this.#rate);
      this.#report();
    }
    if (this.#forming || this.shown < all.length) this.#schedule();
    else this.pause();
  }

  /** Ticks the next bar grows in at the current speed; 1 shows it whole. */
  #ticks(): number {
    if (!this.smooth || !this.#host.animated() || prefersReducedMotion()) return 1;
    const n = Math.min(MAX_TICKS, Math.floor(1000 / this.#rate / TICK_MS));
    return n >= 4 ? n : 1;
  }

  /** Show the growing bar's real values at once. */
  #settle(): void {
    if (!this.#forming) return;
    this.#forming = null;
    this.#host.main()?.update(this.all![this.shown - 1]!);
  }

  #report(): void {
    this.#host.changed(this.state);
  }
}

/**
 * `bar` as it stands a fraction `f` (0 to 1) of the way through a made-up
 * path inside its range: open, then the extreme against the bar's direction,
 * then the other extreme, then close. High and low cover the path so far, and
 * volume grows with `f`; at 1 it is `bar` itself.
 */
export function intrabar(bar: Bar, f: number): Bar {
  if (f >= 1) return bar;
  const { open, high, low, close } = bar;
  const path = close >= open ? [open, low, high, close] : [open, high, low, close];
  let left = f * (Math.abs(path[1]! - open) + Math.abs(path[2]! - path[1]!) + Math.abs(close - path[2]!));
  let price = open;
  let hi = open;
  let lo = open;
  for (let i = 1; i < 4; i++) {
    const to = path[i]!;
    const leg = Math.abs(to - price);
    if (left >= leg) {
      left -= leg;
      price = to;
    } else {
      price += Math.sign(to - price) * left;
      left = 0;
    }
    hi = Math.max(hi, price);
    lo = Math.min(lo, price);
    if (left === 0) break;
  }
  const grown: Bar = { ...bar, high: hi, low: lo, close: price };
  if (bar.volume !== undefined) grown.volume = bar.volume * f;
  if (bar.buyVolume !== undefined) grown.buyVolume = bar.buyVolume * f;
  return grown;
}

/**
 * How many of the time-sorted `bars` are at or before `time`: the first index
 * after them. An exact comparison, since a small epsilon added to a Unix time
 * in seconds is lost to rounding and would leave out the bar at `time`.
 */
function countThrough(bars: readonly Bar[], time: Time): number {
  return boundByTime(bars, time, false);
}
