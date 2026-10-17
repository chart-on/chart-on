import type { Bar, Time } from './types';
import { isValidBar, sameFields } from './data/util';
import { detectInterval } from './timeline';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Price-based bars: bars made from price movement instead of the passage of
 * time. `renko` draws a brick each time price moves a box size, `lineBreak`
 * a line each time the close breaks the last line (or the extreme of the
 * last few lines, to reverse), and `range` a bar each time the range of the
 * forming bar exceeds a fixed size. `kagi` draws a line that runs on while
 * price keeps its direction and turns when price reverses by a set amount;
 * `pointFigure` a column of X boxes while price rises and of O boxes while it
 * falls, turning when it reverses by a number of boxes. Draw kagi lines with
 * the candle style `'kagi'` and point & figure columns with `'pointFigure'`,
 * which need the `priceStyles()` plugin (or `builtins()`); the other types
 * draw as candles with no plugin.
 */
export type PriceBarType = 'renko' | 'lineBreak' | 'range' | 'kagi' | 'pointFigure';

/** How big a renko brick, range bar, kagi reversal or point & figure box is. */
export type BoxSize =
  /** A fixed price step. */
  | { kind: 'fixed'; size: number }
  /** The average true range over `length` bars, as of the newest bar loaded with `setData`. */
  | { kind: 'atr'; length: number }
  /** A percentage of the newest close loaded with `setData`. */
  | { kind: 'percent'; percent: number };

/**
 * Which prices drive the transform: `'close'` uses each bar's close,
 * `'highLow'` its high and low (a rising bar is read as touching its low
 * before its high, a falling bar the other way round).
 */
export type PriceSource = 'close' | 'highLow';

/**
 * How to build price-based bars with `priceBars` or `PriceBarBuilder`: the bar
 * type, box size, reversal and line counts, the prices used and the time slot
 * between bars.
 */
export interface PriceBarOptions {
  type: PriceBarType;
  /**
   * Brick size (`renko`), bar range (`range`), the move that turns a kagi line
   * (`kagi`) or the box size (`pointFigure`). Default: the 14-bar average true range.
   */
  size?: BoxSize;
  /**
   * `renko`: the move against the trend, in bricks counted from the last
   * brick's close, that draws a reversal brick. A whole number, at least 2. Default 2.
   * `pointFigure`: the move against the column, in boxes counted from its last
   * box, that starts a new column. A whole number, at least 1. Default 3.
   */
  reversal?: number;
  /**
   * Prices used by `renko`, `kagi` and `pointFigure` (default `'close'`) and
   * `range` (default `'highLow'`). `lineBreak` always uses closes.
   */
  source?: PriceSource;
  /** `lineBreak` only: how many lines a reversal must break. A whole number, at least 1. Default 3. */
  lines?: number;
  /**
   * Seconds between the times given to consecutive price bars. Default: the
   * interval of the source bars. See `PriceBar.time`.
   */
  slotSeconds?: number;
}

/**
 * A bar built by `priceBars` or `PriceBarBuilder`: an ordinary bar on an
 * evenly spaced time slot, plus the source bar times it spans. Renko, line
 * break and range bars are drawn as candles. A kagi bar is one vertical
 * stretch of the kagi line, from `open` (where the line turned) to `close`
 * (how far it ran). A point & figure bar is one column: rising columns are X
 * boxes from `open` up to `close`, falling ones O boxes from `open` down to
 * `close`, each price the middle of a box.
 */
export interface PriceBar extends Bar {
  /**
   * A slot on an evenly spaced time axis: the first source bar's time plus
   * `slotSeconds` per price bar. Price bars have no time of their own, and
   * several can form within one source bar, so this only orders them. The
   * time they cover is `startTime` to `endTime`.
   */
  time: Time;
  /** Time of the source bar the price bar starts in (where the previous one ended; the first source bar for the first one). */
  startTime: Time;
  /** Time of the source bar that completed the price bar, or of the newest source bar while it is still forming. */
  endTime: Time;
  /**
   * `pointFigure` only: the box size the column was built with. The
   * `'pointFigure'` candle style reads it, so the boxes match the builder.
   */
  boxSize?: number;
}

/** What `PriceBarBuilder.update` changed. */
export interface PriceBarUpdate {
  /**
   * Price bars to pass to a series' `update`, oldest first: the last bar when
   * it changed, then any new ones. Empty when nothing changed or on `reset`.
   */
  bars: PriceBar[];
  /**
   * Bars other than the last changed or disappeared (a live tick took back a
   * brick, say). Replace the series data with `builder.bars` then.
   */
  reset: boolean;
}

/** Default `size`. */
export const DEFAULT_BOX_SIZE: BoxSize = { kind: 'atr', length: 14 };

/** Most price bars one source bar may add, so a huge gap against a tiny size cannot hang the page. */
const MAX_PER_SOURCE_BAR = 10000;

/** Price comparisons allow this fraction of the size for floating point error. */
const EPS = 1e-9;

/**
 * Turns time bars into price-based bars and keeps them current as live bars
 * arrive. Load history with `setData`, then send each new or changed source
 * bar to `update`, and apply what it returns to a candle series:
 *
 * ```ts
 * const builder = new PriceBarBuilder({ type: 'renko', size: { kind: 'fixed', size: 5 } });
 * candles.setData(builder.setData(bars));
 * const change = builder.update(bar);
 * if (change.reset) candles.setData(builder.bars, { keepVisibleRange: true });
 * else for (const b of change.bars) candles.update(b);
 * ```
 */
export class PriceBarBuilder {
  readonly options: Readonly<PriceBarOptions>;
  #engine: Engine;
  /** The box size in effect (resolved from `options.size` by `setData`), or NaN before any data. */
  #boxSize = NaN;
  #origin: Time | undefined;
  #slot: number;
  #lastTime: Time | undefined;
  /** Engine state from before the newest source bar, which live updates replace. */
  #saved: Saved | null = null;

  constructor(options: PriceBarOptions) {
    this.options = checkOptions(options);
    // Until `setData` detects the source interval; `update` without it keeps this.
    this.#slot = this.options.slotSeconds ?? 60;
    this.#engine = this.#makeEngine();
  }

  /**
   * The box size in effect: a price step, resolved from `options.size` when
   * data is loaded. NaN before that. An ATR or percent size that comes out
   * zero (flat or zero prices) is worked out again from each new source bar,
   * and no price bars form until it is positive.
   */
  get size(): number {
    return this.#boxSize;
  }

  /** Every price bar, oldest first (copies). */
  get bars(): PriceBar[] {
    return this.#engine.out.map(copyBar);
  }

  /**
   * Replace the source bars and rebuild. Invalid bars, and bars not newer than
   * the one before, are skipped. Returns the price bars, as `bars` does.
   */
  setData(source: readonly Bar[]): PriceBar[] {
    const valid: Bar[] = [];
    for (const bar of source) {
      if (isValidBar(bar) && (valid.length === 0 || bar.time > valid[valid.length - 1]!.time)) valid.push(bar);
    }
    this.#origin = valid[0]?.time;
    this.#slot = this.options.slotSeconds ?? detectInterval(valid.map((b) => b.time));
    this.#boxSize = valid.length > 0 ? resolveSize(this.options, valid) : NaN;
    this.#engine = this.#makeEngine();
    this.#lastTime = undefined;
    this.#saved = null;
    for (let i = 0; i < valid.length; i++) {
      if (i === valid.length - 1) this.#saved = this.#engine.save();
      this.#feed(valid[i]!);
    }
    return this.bars;
  }

  /**
   * Add a source bar newer than the last one, or replace the last one (same
   * time) as it forms. Older and invalid bars are ignored.
   */
  update(bar: Bar): PriceBarUpdate {
    if (!isValidBar(bar) || (this.#lastTime !== undefined && bar.time < this.#lastTime)) return { bars: [], reset: false };
    if (this.#lastTime === undefined) {
      // No data yet: the first bar sets the origin and, unless fixed, the size.
      const before = this.#engine.out.length;
      if (this.#origin === undefined) {
        this.#origin = bar.time;
        if (Number.isNaN(this.#boxSize)) this.#boxSize = resolveSize(this.options, [bar]);
      }
      this.#saved = this.#engine.save();
      this.#feed(bar);
      return { bars: this.#engine.out.slice(before).map(copyBar), reset: false };
    }
    const out = this.#engine.out;
    const prevLength = out.length;
    // A replaced bar redoes the newest source bar from the saved state; a new one keeps it.
    const keep = bar.time === this.#lastTime ? this.#saved!.length : out.length;
    const old = out.slice(Math.max(0, keep - 1)).map(copyBar);
    if (bar.time === this.#lastTime) this.#engine.restore(this.#saved!);
    else this.#saved = this.#engine.save();
    this.#feed(bar);
    const first = Math.max(0, keep - 1);
    let from = first;
    while (from < out.length && from - first < old.length && sameBar(out[from]!, old[from - first]!)) from++;
    if (out.length < prevLength || from < prevLength - 1) return { bars: [], reset: true };
    return { bars: out.slice(from).map(copyBar), reset: false };
  }

  /** The price bar whose slot `time` is (see `PriceBar.time`), or undefined. */
  barAt(time: Time): PriceBar | undefined {
    if (this.#origin === undefined) return undefined;
    const bar = this.#engine.out[Math.round((time - this.#origin) / this.#slot)];
    return bar ? copyBar(bar) : undefined;
  }

  #feed(bar: Bar): void {
    this.#lastTime = bar.time;
    // A zero size (flat or zero prices so far) waits for a source bar that gives a positive one.
    if (!usableSize(this.#boxSize) && this.options.type !== 'lineBreak') this.#boxSize = resolveSize(this.options, [bar]);
    if (usableSize(this.#boxSize)) this.#engine.feed(bar);
  }

  #makeEngine(): Engine {
    const at = (i: number) => (this.#origin ?? 0) + i * this.#slot;
    const o = this.options;
    switch (o.type) {
      case 'renko':
        return new RenkoEngine(at, () => this.#boxSize, o.reversal ?? 2, o.source ?? 'close');
      case 'lineBreak':
        return new LineBreakEngine(at, o.lines ?? 3);
      case 'range':
        return new RangeEngine(at, () => this.#boxSize, o.source ?? 'highLow');
      case 'kagi':
        return new KagiEngine(at, () => this.#boxSize, o.source ?? 'close');
      case 'pointFigure':
        return new PointFigureEngine(at, () => this.#boxSize, o.reversal ?? 3, o.source ?? 'close');
    }
  }
}

/** Price-based bars of `source` in one go; see `PriceBarBuilder` to keep them current. */
export function priceBars(source: readonly Bar[], options: PriceBarOptions): PriceBar[] {
  return new PriceBarBuilder(options).setData(source);
}

/** Average true range over `length` bars as of the last of `bars` (Wilder smoothing); the plain mean when there are fewer bars. */
export function averageTrueRange(bars: readonly Bar[], length: number): number {
  let atr = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const prev = bars[i - 1]?.close;
    const tr = prev === undefined ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
    // The first `length` true ranges average plainly; later ones smooth.
    atr = i < length ? atr + (tr - atr) / (i + 1) : atr + (tr - atr) / length;
  }
  return atr;
}

const usableSize = (size: number): boolean => size > 0 && Number.isFinite(size);

function resolveSize(o: PriceBarOptions, bars: readonly Bar[]): number {
  if (o.type === 'lineBreak') return 1;
  const size = o.size ?? DEFAULT_BOX_SIZE;
  switch (size.kind) {
    case 'fixed':
      return size.size;
    case 'atr':
      return averageTrueRange(bars, size.length);
    case 'percent':
      return (Math.abs(bars[bars.length - 1]!.close) * size.percent) / 100;
  }
}

const PRICE_BAR_TYPES: readonly PriceBarType[] = ['renko', 'lineBreak', 'range', 'kagi', 'pointFigure'];

const isWhole = (v: unknown, min: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min;

function checkOptions(o: PriceBarOptions): Readonly<PriceBarOptions> {
  if (!PRICE_BAR_TYPES.includes(o.type)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown price bar type "${String(o.type)}"` : '');
  }
  const size = o.size;
  if (size !== undefined) {
    const ok =
      (size.kind === 'fixed' && size.size > 0 && Number.isFinite(size.size)) ||
      (size.kind === 'atr' && isWhole(size.length, 1)) ||
      (size.kind === 'percent' && size.percent > 0 && Number.isFinite(size.percent));
    if (!ok) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid price bar size ${JSON.stringify(size)}` : '');
  }
  const least = o.type === 'pointFigure' ? 1 : 2;
  if (o.reversal !== undefined && !isWhole(o.reversal, least)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Price bar reversal must be a whole number of at least ${least}` : '');
  }
  if (o.lines !== undefined && !isWhole(o.lines, 1)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price bar lines must be a whole number of at least 1' : '');
  if (o.source !== undefined && o.source !== 'close' && o.source !== 'highLow') {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown price bar source "${String(o.source)}"` : '');
  }
  if (o.slotSeconds !== undefined && !(o.slotSeconds > 0 && Number.isFinite(o.slotSeconds))) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price bar slotSeconds must be a positive number' : '');
  }
  return { ...o };
}

function copyBar(b: PriceBar): PriceBar {
  const c: PriceBar = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, startTime: b.startTime, endTime: b.endTime };
  if (b.volume !== undefined) c.volume = b.volume;
  if (b.boxSize !== undefined) c.boxSize = b.boxSize;
  return c;
}

const PRICE_BAR_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume', 'boxSize', 'startTime', 'endTime'] as const;

function sameBar(a: PriceBar, b: PriceBar): boolean {
  return sameFields(a, b, PRICE_BAR_FIELDS);
}

/** The prices a source bar is read as, in order. */
function pricesOf(bar: Bar, source: PriceSource): number[] {
  if (source === 'close') return [bar.close];
  return bar.close >= bar.open ? [bar.low, bar.high] : [bar.high, bar.low];
}

/** Engine state to go back to: the number of bars, a copy of the last one (it may still be forming) and the engine's own fields. */
interface Saved {
  length: number;
  last: PriceBar | null;
  state: Record<string, unknown>;
}

/** One transform's state and output. Only the last output bar may change after it is added. */
abstract class Engine {
  readonly out: PriceBar[] = [];
  /** Where the next price bar starts. */
  protected start: Time | undefined;
  /** Bars added by the source bar being fed. */
  protected added = 0;
  /** Volume of source bars from before the first price bar, waiting for it (see `holdVolume`). */
  protected held = 0;

  constructor(protected readonly timeAt: (index: number) => Time) {}

  feed(bar: Bar): void {
    this.start ??= bar.time;
    this.added = 0;
    this.step(bar);
  }

  protected abstract step(bar: Bar): void;
  protected abstract fields(): Record<string, unknown>;

  save(): Saved {
    const last = this.out[this.out.length - 1];
    return { length: this.out.length, last: last ? copyBar(last) : null, state: { ...this.fields(), start: this.start, held: this.held } };
  }

  restore(s: Saved): void {
    this.out.length = s.length;
    if (s.last) this.out[s.length - 1] = copyBar(s.last);
    // Writes the saved fields back by name, so the fields `fields()` lists, `start` and `held`
    // must stay plain or TypeScript `private`: an ES `#name` field would keep its stale value
    // while this adds a new public property beside it.
    Object.assign(this, s.state);
  }

  /** Add a price bar ending at `end`; returns it, or null past the per-source-bar cap. */
  protected emit(open: number, close: number, end: Time, high = Math.max(open, close), low = Math.min(open, close)): PriceBar | null {
    if (this.added >= MAX_PER_SOURCE_BAR) return null;
    this.added++;
    const bar: PriceBar = { time: this.timeAt(this.out.length), open, high, low, close, startTime: this.start!, endTime: end };
    this.out.push(bar);
    this.start = end;
    return bar;
  }

  /** Add the source bar's volume to the newest price bar. */
  protected addVolume(bar: Bar): void {
    const last = this.out[this.out.length - 1];
    if (last && bar.volume !== undefined) last.volume = (last.volume ?? 0) + bar.volume;
  }

  /** Like `addVolume`, but volume from before the first price bar goes to it once it forms. */
  protected holdVolume(bar: Bar): void {
    if (bar.volume === undefined) return;
    const first = this.out[0];
    if (!first) {
      this.held += bar.volume;
      return;
    }
    if (this.held > 0) {
      first.volume = (first.volume ?? 0) + this.held;
      this.held = 0;
    }
    this.addVolume(bar);
  }
}

/**
 * Renko: a brick each time price moves a box size past the last brick. A
 * reversal needs `reversal` boxes counted from the last brick's close, and
 * its first brick starts at the last brick's open. Bricks have no wicks.
 * Source volume goes to the last brick it completes, or waits for the next.
 */
class RenkoEngine extends Engine {
  /** Top and bottom of the last brick (both the first price before any brick). */
  hi = NaN;
  lo = NaN;
  /** Direction of the last brick: 1 up, -1 down, 0 none yet. */
  dir = 0;
  /** Volume of source bars that completed no brick yet. */
  pending = 0;

  constructor(
    timeAt: (index: number) => Time,
    private readonly box: () => number,
    private readonly reversal: number,
    private readonly source: PriceSource,
  ) {
    super(timeAt);
  }

  protected fields(): Record<string, unknown> {
    return { hi: this.hi, lo: this.lo, dir: this.dir, pending: this.pending };
  }

  protected step(bar: Bar): void {
    if (Number.isNaN(this.hi)) this.hi = this.lo = this.source === 'close' ? bar.close : bar.open;
    for (const p of pricesOf(bar, this.source)) this.#move(p, bar.time);
    this.pending += bar.volume ?? 0;
    if (this.added > 0 && this.pending > 0) {
      const last = this.out[this.out.length - 1]!;
      last.volume = (last.volume ?? 0) + this.pending;
      this.pending = 0;
    }
  }

  #move(p: number, t: Time): void {
    const b = this.box();
    const steps = (d: number) => Math.floor(d / b + EPS);
    if (this.dir >= 0 && steps(p - this.hi) >= 1) this.#up(steps(p - this.hi), t);
    else if (this.dir <= 0 && steps(this.lo - p) >= 1) this.#down(steps(this.lo - p), t);
    else if (this.dir === 1 && steps(this.hi - p) >= this.reversal) this.#down(steps(this.hi - p) - 1, t);
    else if (this.dir === -1 && steps(p - this.lo) >= this.reversal) this.#up(steps(p - this.lo) - 1, t);
  }

  /** `n` rising bricks on top of the last one. */
  #up(n: number, t: Time): void {
    const b = this.box();
    for (let k = 0; k < n; k++) {
      const bottom = this.hi;
      if (!this.emit(bottom, bottom + b, t)) return;
      this.lo = bottom;
      this.hi = bottom + b;
      this.dir = 1;
    }
  }

  /** `n` falling bricks under the last one. */
  #down(n: number, t: Time): void {
    const b = this.box();
    for (let k = 0; k < n; k++) {
      const top = this.lo;
      if (!this.emit(top, top - b, t)) return;
      this.hi = top;
      this.lo = top - b;
      this.dir = -1;
    }
  }
}

/**
 * Line break: a line from the last line's close to each close beyond it, in
 * the same direction. A close beyond the extreme of the last `lines` lines
 * the other way draws a reversal line from the last line's open. The first
 * line runs from the first close to the first close that differs.
 */
class LineBreakEngine extends Engine {
  /** The first close, before any line. */
  base = NaN;

  constructor(
    timeAt: (index: number) => Time,
    private readonly lines: number,
  ) {
    super(timeAt);
  }

  protected fields(): Record<string, unknown> {
    return { base: this.base };
  }

  protected step(bar: Bar): void {
    const c = bar.close;
    const out = this.out;
    const last = out[out.length - 1];
    if (!last) {
      if (Number.isNaN(this.base)) this.base = c;
      else if (c !== this.base) this.emit(this.base, c, bar.time);
    } else {
      const recent = out.slice(-this.lines);
      if (last.close > last.open) {
        if (c > last.close) this.emit(last.close, c, bar.time);
        else if (c < Math.min(...recent.map((l) => l.low))) this.emit(last.open, c, bar.time);
      } else if (c < last.close) this.emit(last.close, c, bar.time);
      else if (c > Math.max(...recent.map((l) => l.high))) this.emit(last.open, c, bar.time);
    }
    // Volume goes to the newest line, so closes that draw nothing count towards the line before them.
    this.addVolume(bar);
  }
}

/**
 * Range bars: each bar's high minus low stays within the size. When price
 * goes beyond it, the bar closes at its low plus the size (or high minus the
 * size) and the next bar opens there. The newest bar is still forming.
 */
class RangeEngine extends Engine {
  constructor(
    timeAt: (index: number) => Time,
    private readonly box: () => number,
    private readonly source: PriceSource,
  ) {
    super(timeAt);
  }

  protected fields(): Record<string, unknown> {
    return {};
  }

  protected step(bar: Bar): void {
    const path = this.source === 'close' ? [bar.close] : [bar.open, ...pricesOf(bar, 'highLow'), bar.close];
    for (const p of path) this.#move(p, bar.time);
    this.addVolume(bar);
  }

  #move(p: number, t: Time): void {
    const r = this.box();
    let cur = this.out[this.out.length - 1];
    if (!cur) {
      this.emit(p, p, t);
      return;
    }
    for (;;) {
      if (p > cur.low + r * (1 + EPS)) {
        const top = cur.low + r;
        cur.high = cur.close = top;
        cur.endTime = t;
        this.start = t;
        const next = this.emit(top, top, t);
        if (!next) return;
        cur = next;
      } else if (p < cur.high - r * (1 + EPS)) {
        const bottom = cur.high - r;
        cur.low = cur.close = bottom;
        cur.endTime = t;
        this.start = t;
        const next = this.emit(bottom, bottom, t);
        if (!next) return;
        cur = next;
      } else {
        cur.high = Math.max(cur.high, p);
        cur.low = Math.min(cur.low, p);
        cur.close = p;
        cur.endTime = t;
        return;
      }
    }
  }
}

/**
 * Kagi: one line that runs on while price keeps its direction. When price
 * moves back from the line's end by the reversal amount, the line turns:
 * a new stretch starts at the old end and follows price the other way. The
 * first stretch starts once price has moved the reversal amount from the
 * first price. The newest stretch is still forming.
 */
class KagiEngine extends Engine {
  /** The first price, before any stretch. */
  base = NaN;

  constructor(
    timeAt: (index: number) => Time,
    private readonly amount: () => number,
    private readonly source: PriceSource,
  ) {
    super(timeAt);
  }

  protected fields(): Record<string, unknown> {
    return { base: this.base };
  }

  protected step(bar: Bar): void {
    if (Number.isNaN(this.base)) this.base = this.source === 'close' ? bar.close : bar.open;
    for (const p of pricesOf(bar, this.source)) this.#move(p, bar.time);
    this.holdVolume(bar);
  }

  #move(p: number, t: Time): void {
    const r = this.amount();
    const cur = this.out[this.out.length - 1];
    // A move counts once it reaches the amount, allowing for floating point error.
    const reaches = (d: number) => d / r + EPS >= 1;
    if (!cur) {
      if (reaches(Math.abs(p - this.base))) this.emit(this.base, p, t);
      return;
    }
    const rising = cur.close > cur.open;
    if (rising ? p > cur.close : p < cur.close) {
      cur.close = p;
      if (rising) cur.high = p;
      else cur.low = p;
      cur.endTime = t;
      this.start = t;
    } else if (reaches(rising ? cur.close - p : p - cur.close)) {
      this.emit(cur.close, p, t);
    }
  }
}

/**
 * Point & figure: prices are read in boxes of the box size, on a grid of its
 * multiples. A rising column of X boxes grows each time price reaches the
 * next box up; a falling column of O boxes each time it reaches the next box
 * down. When price moves `reversal` boxes back from a column's last box, a
 * new column starts one box beyond it the other way. The first column starts
 * once price reaches the box next to the first price's box. Bar prices are
 * box middles: grid levels. The newest column is still forming.
 */
class PointFigureEngine extends Engine {
  /** Grid level (in boxes) of the first price, before any column. */
  base = NaN;
  /** Direction of the newest column: 1 X boxes, -1 O boxes. A one-box column has no direction of its own. */
  dir = 0;

  constructor(
    timeAt: (index: number) => Time,
    private readonly box: () => number,
    private readonly reversal: number,
    private readonly source: PriceSource,
  ) {
    super(timeAt);
  }

  protected fields(): Record<string, unknown> {
    return { base: this.base, dir: this.dir };
  }

  protected step(bar: Bar): void {
    const b = this.box();
    if (Number.isNaN(this.base)) this.base = Math.round((this.source === 'close' ? bar.close : bar.open) / b);
    for (const p of pricesOf(bar, this.source)) this.#move(p, bar.time);
    this.holdVolume(bar);
  }

  #move(p: number, t: Time): void {
    const b = this.box();
    // The highest box price has reached, and the lowest, in grid levels.
    const up = Math.floor(p / b + EPS);
    const down = Math.ceil(p / b - EPS);
    const cur = this.out[this.out.length - 1];
    if (!cur) {
      if (up > this.base) this.#column(this.base, up, 1, t);
      else if (down < this.base) this.#column(this.base, down, -1, t);
      return;
    }
    const last = Math.round(cur.close / b);
    const rising = this.dir === 1;
    if (rising ? up > last : down < last) {
      cur.close = (rising ? up : down) * b;
      if (rising) cur.high = cur.close;
      else cur.low = cur.close;
      cur.endTime = t;
      this.start = t;
    } else if (rising && last - down >= this.reversal) {
      this.#column(last - 1, down, -1, t);
    } else if (!rising && up - last >= this.reversal) {
      this.#column(last + 1, up, 1, t);
    }
  }

  /** A new column from grid level `from` to `to`. */
  #column(from: number, to: number, dir: 1 | -1, t: Time): void {
    const b = this.box();
    const bar = this.emit(from * b, to * b, t);
    if (!bar) return;
    bar.boxSize = b;
    this.dir = dir;
  }
}
