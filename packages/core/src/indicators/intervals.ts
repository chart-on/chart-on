import type { Bar, Time } from '../types';
import type { DataSource, Interval, SymbolInfo } from '../data/types';
import { intervalStart, isCalendarInterval, isTimeInterval, intervalSeconds, nextIntervalStart, safeIntervalSeconds, symbolZone } from '../data/interval';
import { isValidBar, normalizeBars } from '../data/util';
import { lowerBound } from '../timeline';
import { boundByTime } from '../util/search';
import type { Zone } from '../util/timezone';
import type { FeedContext } from './external';
import type { IntervalSource } from './runner';
import type { BarArrays, IndicatorContext, IndicatorDef, IndicatorStatus, InputValue, IntervalBars } from './types';
import { errorText } from '../errors';
import { isText } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What an interval feed needs from its indicator and chart. */
export interface IntervalFeedHost {
  /** Current symbol and interval, or null without a loaded data source. */
  context(): FeedContext | null;
  source(): DataSource | null;
  /** The chart's bars as columns. */
  lower(): BarArrays;
  /** A bar replay hides the chart's newer bars, so loaded bars may hold data after its last bar. */
  replaying(): boolean;
  inputs(): Record<string, InputValue>;
  /** Loaded bars changed: compute again. */
  changed(): void;
  status(status: IndicatorStatus, message: string | null): void;
  error(error: unknown): void;
}

/** One interval's bars for one symbol, as loaded from the data source. */
interface Entry {
  symbol: string;
  /** Resolved through the data source; set up front for the chart's own symbol. */
  info: SymbolInfo | null;
  /** Named by the definition: kept apart from the chart's own symbol, even when they match. */
  other: boolean;
  /** Following the source's live bars and resets (another symbol's only). */
  live: boolean;
  interval: Interval;
  /** Ascending, unique times. */
  bars: Bar[];
  /** Bumped whenever `bars` changes, so built columns know to rewrite. */
  version: number;
  /** A first load answered. */
  loaded: boolean;
  /** No older bars exist. */
  exhausted: boolean;
  loading: boolean;
  failure: string | null;
  abort: AbortController;
}

/** An interval wanted by the definition, checked. */
interface Wanted {
  interval: Interval;
  lookback: number;
  /** Another symbol, or null for the chart's. */
  symbol: string | null;
  /** Key of its bars in `IntervalBars`. */
  key: string;
}

const EMPTY: BarArrays = (() => {
  const e = new Float64Array(0);
  return { length: 0, time: e, open: e, high: e, low: e, close: e, volume: e };
})();

/**
 * Loads the bars of the intervals an indicator declares in `intervals` for the
 * chart's symbol (or the one an entry names), caches them per symbol and
 * interval, loads older bars as history pages in, and hands `compute` those
 * bars with the newest ones built from the chart's own bars (or, for another
 * symbol, followed through the source's live bars).
 */
export class IntervalFeed implements IntervalSource {
  readonly #entries = new Map<string, Entry>();
  readonly #columns = new Map<string, Columns>();
  /** The reason the indicator draws nothing, as last reported; null when it works. */
  #unsupported: string | null = null;
  #disposed = false;

  constructor(
    private readonly def: IndicatorDef,
    private readonly host: IntervalFeedHost,
  ) {}

  /** Bring the loaded bars in line with the chart's symbol, interval, bars and inputs. */
  sync(): void {
    if (this.#disposed) return;
    const ctx = this.host.context();
    const wanted = this.#wanted();
    const verdict = ctx ? this.#verdict(ctx, wanted) : null;
    const flipped = verdict !== this.#unsupported;
    this.#unsupported = verdict;
    let dropped = false;
    if (!ctx) {
      // Detached from the data source: the bars belong to its old symbol.
      if (!this.host.source()) dropped = this.#drop(() => true);
    } else {
      const keep = new Set(wanted.map((w) => key(w.symbol ?? ctx.symbol.symbol, w.interval, w.symbol !== null)));
      dropped = this.#drop((k) => !keep.has(k));
      if (verdict === null) for (const w of wanted) this.#ensure(ctx, w);
    }
    if (flipped || dropped) this.host.changed();
    this.#report();
  }

  /** Drop every loaded bar and load again, e.g. after the source corrected its data. */
  refetch(): void {
    if (this.#drop(() => true)) this.host.changed();
    this.sync();
  }

  bars(lower: BarArrays): IntervalBars {
    const out: Record<string, BarArrays> = {};
    const wanted = this.#wanted(false);
    const ctx = this.host.context();
    const works = ctx !== null && this.#verdict(ctx, wanted, false) === null;
    for (const w of wanted) {
      const entry = works ? this.#entries.get(key(w.symbol ?? ctx!.symbol.symbol, w.interval, w.symbol !== null)) : undefined;
      out[w.key] = entry && lower.length > 0 ? this.#build(entry, lower, ctx!) : EMPTY;
    }
    return out;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#drop(() => true);
    this.#disposed = true;
  }

  /** The intervals the definition wants for the current inputs; invalid entries are left out (and reported when `report`). */
  #wanted(report = true): Wanted[] {
    let raw: unknown;
    try {
      raw = this.def.intervals?.(this.host.inputs());
    } catch (err) {
      if (report) this.host.error(err);
      return [];
    }
    const out: Wanted[] = [];
    for (const item of Array.isArray(raw) ? (raw as unknown[]) : []) {
      const { interval, lookback = 0, symbol = null } = (item ?? {}) as { interval?: unknown; lookback?: unknown; symbol?: unknown };
      if (
        !isTimeInterval(interval) ||
        typeof lookback !== 'number' ||
        !(lookback >= 0) ||
        !Number.isFinite(lookback) ||
        !(symbol === null || isText(symbol))
      ) {
        if (report) this.host.error(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${this.def.id}" intervals returned an invalid entry: ${JSON.stringify(item)}` : ''));
        continue;
      }
      const k = symbol === null ? interval : `${symbol}@${interval}`;
      if (!out.some((w) => w.key === k)) out.push({ interval, lookback: Math.ceil(lookback), symbol, key: k });
    }
    return out;
  }

  /** Why the indicator draws nothing in `ctx`, or null when it works. */
  #verdict(ctx: FeedContext, wanted: readonly Wanted[], report = true): string | null {
    const chart = safeIntervalSeconds(ctx.interval);
    const low = wanted.find((w) => chart === null || intervalSeconds(w.interval) <= chart);
    if (low) return `Needs a chart interval below ${low.interval}`;
    if (!this.def.supports) return null;
    const context: IndicatorContext = { symbol: ctx.symbol, interval: ctx.interval, inputs: this.host.inputs() };
    try {
      const verdict: unknown = this.def.supports(context);
      return verdict === true ? null : isText(verdict) ? verdict : 'Not available here';
    } catch (err) {
      if (report) this.host.error(err);
      return errorText(err);
    }
  }

  /** Remove the entries whose key matches, aborting their loads; true when any went. */
  #drop(match: (key: string) => boolean): boolean {
    let any = false;
    for (const [k, entry] of [...this.#entries]) {
      if (!match(k)) continue;
      entry.abort.abort();
      this.#entries.delete(k);
      this.#columns.delete(k);
      any = true;
    }
    return any;
  }

  /** Load what `w` still lacks: the first page, or older bars for the warm-up before the chart's first bar. */
  #ensure(ctx: FeedContext, w: Wanted): void {
    const symbol = w.symbol ?? ctx.symbol.symbol;
    const other = w.symbol !== null;
    const k = key(symbol, w.interval, other);
    let entry = this.#entries.get(k);
    if (!entry) {
      entry = {
        symbol,
        info: other ? null : ctx.symbol,
        other,
        live: false,
        interval: w.interval,
        bars: [],
        version: 0,
        loaded: false,
        exhausted: false,
        loading: false,
        failure: null,
        abort: new AbortController(),
      };
      this.#entries.set(k, entry);
    }
    const lower = this.host.lower();
    const n = lower.length;
    if (entry.loading || n === 0) return;
    const first = lower.time[0]!;
    const seconds = intervalSeconds(w.interval);
    if (!entry.loaded || entry.bars.length === 0) {
      if (entry.loaded && entry.failure === null) return; // the source has no bars at this interval
      const end = lower.time[n - 1]! + (safeIntervalSeconds(ctx.interval) ?? 1);
      this.#load(ctx, entry, end, Math.ceil((end - first) / seconds) + w.lookback + 1);
      return;
    }
    if (entry.exhausted) return;
    // The higher bar holding the chart's first bar, and `lookback` before it.
    const holding = boundByTime(entry.bars, first, false) - 1;
    const oldest = entry.bars[0]!.time;
    if (holding < 0) this.#load(ctx, entry, oldest, Math.ceil((oldest - first) / seconds) + w.lookback + 1);
    else if (holding < w.lookback) this.#load(ctx, entry, oldest, w.lookback - holding);
  }

  /** Ask for up to `limit` bars older than `to` and merge them in. */
  #load(ctx: FeedContext, entry: Entry, to: Time, limit: number): void {
    const source = this.host.source();
    if (!source) return;
    entry.loading = true;
    const signal = entry.abort.signal;
    const current = () => !this.#disposed && this.#entries.get(key(entry.symbol, entry.interval, entry.other)) === entry;
    (entry.info ? Promise.resolve(entry.info) : source.symbol(entry.symbol))
      .then((info) => {
        if (!current()) return null;
        entry.info = info;
        return source.history(info, entry.interval, { kind: 'history', to, limit, signal });
      })
      .then((result) => {
        if (!current()) return;
        entry.loading = false;
        entry.failure = null;
        const bars = normalizeBars(Array.isArray(result?.bars) ? result.bars : []).filter((b) => b.time < to);
        const oldest = entry.bars[0]?.time ?? Infinity;
        const older = bars.filter((b) => b.time < oldest);
        entry.exhausted = !!result?.atStart || bars.length < limit;
        entry.loaded = true;
        if (older.length > 0) {
          entry.bars = older.concat(entry.bars);
          entry.version++;
        }
        // Another symbol's newest bars cannot be built from the chart's: follow its live bars and resets.
        if (!entry.live && entry.other) {
          entry.live = true;
          const info = entry.info!;
          const offs = [
            source.stream?.(info, entry.interval, (bar) => {
              if (current()) this.#stream(entry, bar);
            }),
            // Bars already sent changed: load them again.
            source.onReset?.((reset) => {
              if (current() && reset.symbol === info.symbol && (reset.interval ?? entry.interval) === entry.interval) this.refetch();
            }),
          ];
          signal.addEventListener('abort', () => {
            for (const off of offs) off?.();
          });
        }
        this.host.changed();
        this.#report();
      })
      .catch((err: unknown) => {
        if (!current()) return;
        entry.loading = false;
        entry.failure = errorText(err);
        this.host.error(err);
        this.#report();
      });
    this.#report();
  }

  /** A live bar of another symbol: replaces the newest bar with its time, or follows it; older ones are ignored. */
  #stream(entry: Entry, bar: Bar): void {
    const last = entry.bars[entry.bars.length - 1];
    if (!isValidBar(bar) || (last && bar.time < last.time)) return;
    if (last?.time === bar.time) entry.bars[entry.bars.length - 1] = { ...bar };
    else entry.bars.push({ ...bar });
    entry.version++;
    this.host.changed();
  }

  /** The entry's bars up to the chart's last bar, with the newest built from the chart's bars. */
  #build(entry: Entry, lower: BarArrays, ctx: FeedContext): BarArrays {
    const k = key(entry.symbol, entry.interval, entry.other);
    let columns = this.#columns.get(k);
    if (!columns) this.#columns.set(k, (columns = new Columns()));
    const n = lower.length;
    const end = lower.time[n - 1]! + (safeIntervalSeconds(ctx.interval) ?? 1);
    // Bars the source sent that start after the chart's last bar would be hindsight.
    const m = boundByTime(entry.bars, end, true);
    // Another symbol's bars are as the source sent them, newest included.
    if (entry.other) return columns.fill(entry.bars, m, entry.version, []);
    const base = Math.max(0, m - 1);
    const anchor = m > 0 ? entry.bars[m - 1]! : null;
    // The loaded anchor holds data up to when it loaded. That is hindsight when the chart
    // stops earlier: in a replay, or when the source already has newer higher bars.
    const current = m === entry.bars.length && !this.host.replaying();
    const tail = buildTail(anchor, lower, entry.interval, symbolZone(ctx.symbol.timezone), current);
    return columns.fill(entry.bars, base, entry.version, tail);
  }

  #report(): void {
    if (this.#disposed) return;
    const entries = [...this.#entries.values()];
    const failure = entries.find((e) => e.failure !== null)?.failure ?? null;
    if (this.#unsupported !== null) this.host.status('idle', this.#unsupported);
    else if (entries.some((e) => e.loading)) this.host.status('loading', null);
    else if (failure !== null) this.host.status('error', failure);
    else if (entries.length === 0 || !entries.some((e) => e.loaded)) this.host.status('idle', null);
    else this.host.status(entries.some((e) => e.bars.length > 0) ? 'loaded' : 'empty', null);
  }
}

/**
 * The newest higher bars, built from the chart's `lower` bars from `anchor`
 * (the newest loaded higher bar at or before the chart's last bar) on. The
 * anchor's own bar is rebuilt from the lower bars when they reach back before
 * its start; otherwise (the chart starts inside it) the lower bars only widen
 * its range and move its close. Later higher bars are cut from the lower bars,
 * keeping the anchor's phase (e.g. daily bars stamped at a session open).
 * Without an anchor, higher bars start where `intervalStart` puts them.
 * When the anchor is not `current` (it may hold data after the chart's last
 * bar), the chart starting inside it keeps only its open; the rest comes from
 * the lower bars.
 */
export function buildTail(anchor: Bar | null, lower: BarArrays, interval: Interval, zone: Zone, current = true): Bar[] {
  const out: Bar[] = [];
  const n = lower.length;
  let k = anchor ? lowerBound(lower.time, anchor.time) : 0;
  const reachesBack = k > 0;
  let start = anchor ? anchor.time : -Infinity;
  let next = anchor ? nextIntervalStart(anchor.time, interval, zone) : -Infinity;
  let bar: Bar | null = anchor ? { ...anchor } : null;
  /** The bar is still the anchor as loaded: the first lower bar in it decides how it changes. */
  let pristine = anchor !== null;
  /** The bar widens the loaded anchor rather than being cut from lower bars. */
  let merging = false;
  /** Volume of the lower bars in the anchor while merging. */
  let merged = 0;
  for (; k < n; k++) {
    const t = lower.time[k]!;
    const v = lower.volume[k]!;
    if (t >= next) {
      if (bar) out.push(bar);
      start = anchor || out.length > 0 ? advance(start, t, interval, zone) : intervalStart(t, interval, zone);
      next = nextIntervalStart(start, interval, zone);
      bar = fromLower(start, lower, k);
      pristine = merging = false;
      continue;
    }
    if (pristine) {
      pristine = false;
      if (reachesBack) {
        bar = fromLower(start, lower, k);
        continue;
      }
      if (!current) {
        const open = anchor!.open;
        bar = fromLower(start, lower, k);
        bar.open = open;
        bar.high = Math.max(bar.high, open);
        bar.low = Math.min(bar.low, open);
        continue;
      }
      merging = true;
    }
    const b = bar!;
    b.high = Math.max(b.high, lower.high[k]!);
    b.low = Math.min(b.low, lower.low[k]!);
    b.close = lower.close[k]!;
    if (!Number.isFinite(v)) continue;
    if (!merging) b.volume = (b.volume ?? 0) + v;
    else {
      // The loaded volume may already count these lower bars: never add them twice.
      merged += v;
      b.volume = Math.max(anchor!.volume ?? 0, merged);
    }
  }
  if (bar) out.push(bar);
  return out;
}

function fromLower(start: Time, lower: BarArrays, k: number): Bar {
  const v = lower.volume[k]!;
  const bar: Bar = { time: start, open: lower.open[k]!, high: lower.high[k]!, low: lower.low[k]!, close: lower.close[k]! };
  if (Number.isFinite(v)) bar.volume = v;
  return bar;
}

/** Start of the higher bar holding `time`, counted on from the bar starting at `start`. */
function advance(start: Time, time: Time, interval: Interval, zone: Zone): Time {
  if (!isCalendarInterval(interval)) {
    const length = intervalSeconds(interval);
    return start + Math.floor((time - start) / length) * length;
  }
  let s = start;
  for (let next = nextIntervalStart(s, interval, zone); next <= time; next = nextIntervalStart(s, interval, zone)) s = next;
  return s;
}

/**
 * Growable bar columns for one interval: rewritten up to `base` only when the
 * loaded bars changed, and from there on with the tail on every call.
 */
class Columns {
  #buf: Record<'time' | 'open' | 'high' | 'low' | 'close' | 'volume', Float64Array> | null = null;
  #capacity = 0;
  private version = -1;
  private base = -1;

  fill(loaded: readonly Bar[], base: number, version: number, tail: readonly Bar[]): BarArrays {
    const length = base + tail.length;
    if (!this.#buf || length > this.#capacity) {
      this.#capacity = Math.ceil(length * 1.25) + 16;
      const make = () => new Float64Array(this.#capacity);
      this.#buf = { time: make(), open: make(), high: make(), low: make(), close: make(), volume: make() };
      this.version = -1;
    }
    if (version !== this.version || base !== this.base) {
      for (let i = 0; i < base; i++) this.#write(i, loaded[i]!);
      this.version = version;
      this.base = base;
    }
    for (let i = 0; i < tail.length; i++) this.#write(base + i, tail[i]!);
    const b = this.#buf;
    return {
      length,
      time: b.time.subarray(0, length),
      open: b.open.subarray(0, length),
      high: b.high.subarray(0, length),
      low: b.low.subarray(0, length),
      close: b.close.subarray(0, length),
      volume: b.volume.subarray(0, length),
    };
  }

  #write(i: number, bar: Bar): void {
    const b = this.#buf!;
    b.time[i] = bar.time;
    b.open[i] = bar.open;
    b.high[i] = bar.high;
    b.low[i] = bar.low;
    b.close[i] = bar.close;
    b.volume[i] = bar.volume ?? NaN;
  }
}

function key(symbol: string, interval: Interval, other = false): string {
  return `${symbol}\u0000${interval}${other ? '\u0000' : ''}`;
}




