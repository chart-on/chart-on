import { toChartError } from '../errors';
import type { Bar, Time } from '../types';
import { isValidBar, lowerBound, normalizeBars, type DropReason } from './util';
import { isCalendarInterval, isInterval, nearestInterval, nextIntervalStart, parseInterval, symbolZone } from './interval';
import type { DataEvents, DataLoadKind, DataSource, FeedStatus, Interval, ResetRange, SymbolInfo } from './types';
import type { Quote } from '../reference-lines';
import { mergeAdjustments, type Adjustment } from './adjust';
import { symbolPriceFormat, type PriceFormat } from '../util/price-format';
import { makeSnapshot, readSnapshot, sameAdjustments, sameBars, type CacheAdapter, type Snapshot } from './cache';
import { replaceFront } from '../util/array';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Where loaded bars go (the chart's main candle series). Must copy what it keeps. */
export interface DataTarget {
  setData(bars: Bar[], kind: DataLoadKind): void;
  update(bar: Bar): void;
  /** Extra bars to load first, so indicator warm-up (their `lookback`) stays off screen. */
  lookback?(): number;
  /** The symbol's price format (`symbolPriceFormat`), or undefined to detect decimals from the data. */
  setPriceFormat(format: PriceFormat | undefined): void;
  /** The corporate actions known for the bars `setData` is about to pass (see `DataSource.adjustments`). */
  setAdjustments?(adjustments: readonly Adjustment[]): void;
  /** A bar from the source was left out: invalid, older than the last bar, or a duplicate time. */
  dropped?(bar: Bar, reason: DropReason): void;
  /**
   * A page of history: `older` bars, all before the first bar passed so far,
   * now lead `bars`. Without it the page arrives as `setData(bars, 'history')`.
   */
  prepend?(older: Bar[], bars: Bar[]): void;
}

/** Options for loading data: bars per first load and per history page, in-memory cache size, gap refetch limit and persistent cache. */
export interface DataControllerOptions {
  /** Bars requested on the first load of a symbol and interval, plus the target's `lookback`. */
  initialBars: number;
  /** Bars requested per page of older history. */
  pageBars: number;
  /** Symbol and interval combinations kept in memory. */
  cacheSize: number;
  /**
   * Longest outage, in seconds, whose missed bars are refetched when the
   * source reconnects. A longer one emits `data:stale` instead.
   */
  maxGapFillSeconds: number;
  /**
   * Persistent snapshot store (`createIndexedDbCache`, `createMemoryCache` or
   * your own): the last window of each symbol and interval paints at once on
   * the next load while the source is asked as usual. Default none.
   */
  cache: CacheAdapter | null;
}

/** Default values for `DataControllerOptions`: 1000 bars first, pages of 500, eight cached series, gaps refetched up to an hour, no persistent cache. */
export const defaultDataControllerOptions: DataControllerOptions = {
  initialBars: 1000,
  pageBars: 500,
  cacheSize: 8,
  maxGapFillSeconds: 3600,
  cache: null,
};

/** Unix seconds now. */
const nowSeconds = (): Time => Date.now() / 1000;

interface CacheEntry {
  info: SymbolInfo;
  bars: Bar[];
  /** The source said the bars reach the start of the history: no older pages. */
  atStart: boolean;
  /** Corporate actions over the span of `bars`, oldest first. */
  adjustments: Adjustment[];
  /** `adjustments` failed for part of `bars`: the next load of this symbol and interval fetches everything again. */
  adjustmentsMissing?: boolean;
}

type Emit = <K extends keyof DataEvents>(event: K, payload: DataEvents[K]) => void;

/**
 * Loads a data source into the chart: initial bars, older pages on demand,
 * live bars, and a small per symbol + interval cache. Every switch bumps a
 * generation counter and aborts in-flight requests, so late answers are ignored.
 */
export class DataController {
  /** Symbol and interval currently shown; null until the first load completes. */
  symbol: SymbolInfo | null = null;
  interval: Interval | null = null;
  /**
   * Symbol and interval of the last `setSymbol` call, which may still be
   * loading; the interval is the one actually loaded once the symbol turned
   * out not to support the requested one. Null before the first call.
   */
  get requested(): Readonly<{ symbol: string; interval: Interval }> | null {
    return this.#lastRequest;
  }
  /** Live bars dropped as invalid or older than the last bar. */
  dropped = 0;
  readonly options: DataControllerOptions;
  readonly #cache = new Map<string, CacheEntry>();
  #entry: CacheEntry | null = null;
  #key: string | null = null;
  #generation = 0;
  #abort = new AbortController();
  /** Ends the live subscriptions of the current load: bars, resets and quotes. */
  #unsubscribe: (() => void) | null = null;
  #quote: Quote | null = null;
  #initial: Promise<void> | null = null;
  #history: Promise<boolean> | null = null;
  /** Live bars that arrived before the initial load or a reset finished. */
  #buffer: Bar[] | null = null;
  /** Resets in flight that hold live bars in `buffer`. */
  #holds = 0;
  /** The last `setSymbol` request, for `reload`. */
  #lastRequest: { symbol: string; interval: Interval } | null = null;
  /** The initial load of this generation has shown its bars. */
  #ready = false;
  /** Bumped by a full reset, so history pages and range resets begun before it are dropped. */
  #epoch = 0;
  #fullReset: Promise<void> | null = null;
  #resets = 0;
  /** A reset that arrived during the initial load; applied once it lands. */
  #deferred: { range?: ResetRange } | null = null;
  /** The longest outage that ended during the initial load; filled once it lands. */
  #deferredGap: number | null = null;
  /** Numbers resets in the order they were requested. */
  #resetSeq = 0;
  /**
   * Range resets applied while others were in flight. An older response
   * landing later is applied first and these are replayed over it, so it
   * never overwrites newer bars.
   */
  #applied: { seq: number; range: ResetRange; bars: Bar[]; merge: boolean }[] = [];
  /** When the source's stream dropped; null while connected. */
  #downSince: Time | null = null;
  #isStale = false;
  #feedStatus: FeedStatus | null = null;
  readonly #unsubscribeStatus: (() => void) | null;
  /** A cached snapshot is on screen in place of loaded bars (painted, and its load has not landed). */
  #snapshotOnScreen = false;

  readonly #target: DataTarget;
  readonly #emit: Emit;

  constructor(
    readonly source: DataSource,
    target: DataTarget,
    emit: Emit,
    options: Partial<DataControllerOptions> = {},
  ) {
    this.#target = target;
    this.#emit = emit;
    this.options = { ...defaultDataControllerOptions, ...options };
    this.#unsubscribeStatus = source.onStatus?.((status) => this.#onStatus(status)) ?? null;
  }

  /** The latest bid and ask the source's `quotes` sent for the current symbol; null before the first one and once another symbol starts loading. */
  get quote(): Quote | null {
    return this.#quote;
  }

  /** Whether the bars on screen are a cached snapshot whose load has not landed, or failed. */
  get showingSnapshot(): boolean {
    return this.#snapshotOnScreen;
  }

  get loading(): boolean {
    return this.#initial !== null || this.#history !== null || this.#resets > 0;
  }

  /** True after an outage longer than `maxGapFillSeconds`, until a reload or full reset. */
  get stale(): boolean {
    return this.#isStale;
  }

  /** The source's last reported connection state; null if it never reported one. */
  get connection(): FeedStatus | null {
    return this.#feedStatus;
  }

  /** The `setSymbol` load in flight (the promise it returned), or null. */
  get initialLoad(): Promise<void> | null {
    return this.#initial;
  }

  /** False once the source reported that no older bars exist. */
  get hasMoreHistory(): boolean {
    return this.#entry !== null && !this.#entry.atStart;
  }

  /**
   * Intervals the current symbol supports: the entries of its `intervals`
   * the chart can parse, or null when it lists none (any interval).
   */
  get supportedIntervals(): readonly Interval[] | null {
    const list = this.symbol?.intervals?.filter(isInterval) ?? [];
    return list.length > 0 ? list : null;
  }

  /**
   * Show `symbol` at `interval`, or at the nearest interval the symbol
   * supports. Rejects when loading fails, and with an `'invalid-interval'`
   * `ChartError` before asking the source anything when the interval cannot
   * be parsed; resolves early if superseded.
   */
  setSymbol(symbol: string, interval: Interval): Promise<void> {
    try {
      parseInterval(interval);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = cacheKey(symbol, interval);
    if (key === this.#key) return this.#initial ?? Promise.resolve();
    // The symbol being left keeps its live bars for the next time.
    this.#persist();
    this.#stop();
    this.#key = key;
    this.#lastRequest = { symbol, interval };
    const generation = this.#generation;
    const load = this.#load(generation, symbol, interval, this.#abort.signal).finally(() => {
      if (this.#initial === load) this.#initial = null;
    });
    this.#initial = load;
    return load;
  }

  /**
   * Load the last requested symbol and interval again without the cache,
   * aborting requests in flight like a switch. Rejects when loading fails.
   */
  reload(): Promise<void> {
    const requested = this.#lastRequest;
    if (!requested) return Promise.reject(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Nothing to reload; call setSymbol first' : ''));
    this.#cache.delete(cacheKey(requested.symbol, requested.interval));
    this.#key = null;
    return this.setSymbol(requested.symbol, requested.interval);
  }

  /**
   * Forget cached bars: all of them, or those of one symbol and/or interval.
   * The series on screen stays; switching back to it loads it afresh.
   */
  clearCache(symbol?: string, interval?: Interval): void {
    for (const key of this.#cache.keys()) {
      const [s, i] = key.split('\u0000');
      if ((symbol === undefined || s === symbol) && (interval === undefined || i === interval)) this.#cache.delete(key);
    }
    // The persistent store cannot list its keys: one entry, or all of them.
    const store = this.options.cache;
    if (!store) return;
    const done = symbol !== undefined && interval !== undefined ? attempt(() => store.delete(cacheKey(symbol, interval))) : attempt(() => store.clear());
    void done;
  }

  /**
   * Prepend the next page of older bars; no-op once a page said `atStart`. Resolves to
   * false when no page was loaded but asking again later may help: the
   * request failed or was aborted, or the initial load was still running.
   */
  loadMore(): Promise<boolean> {
    if (this.#history) return this.#history;
    if (this.#initial || this.#fullReset) return Promise.resolve(false);
    const { symbol, interval } = this;
    const entry = this.#entry;
    const first = entry?.bars[0];
    if (!entry || entry.atStart || !symbol || !interval || !first) return Promise.resolve(true);
    const generation = this.#generation;
    const epoch = this.#epoch;
    const page = (async () => {
      this.#emit('data:loading', { symbol: symbol.symbol, interval, kind: 'history' });
      try {
        const result = await this.source.history(symbol, interval, {
          kind: 'history',
          to: first.time,
          limit: this.options.pageBars,
          signal: this.#abort.signal,
        });
        // A full reset meanwhile replaced the bars this page was meant to extend.
        if (generation !== this.#generation || epoch !== this.#epoch) return false;
        const older = normalizeBars(result.bars, this.#onDrop).filter((b) => b.time < first.time);
        if (result.atStart || older.length === 0) entry.atStart = true;
        if (older.length > 0) {
          const adjustments = await this.#adjustmentsFor(symbol, interval, 'history', older[0]!.time, first.time, this.#abort.signal);
          if (generation !== this.#generation || epoch !== this.#epoch) return false;
          if (!adjustments) entry.adjustmentsMissing = true;
          entry.adjustments = mergeAdjustments(entry.adjustments, adjustments ?? []);
          // In place: the page costs O(page), not a copy of everything loaded so far.
          replaceFront(entry.bars, 0, older);
          this.#target.setAdjustments?.(entry.adjustments);
          if (this.#target.prepend) this.#target.prepend(older, entry.bars);
          else this.#target.setData(entry.bars, 'history');
        }
        this.#emit('data:loaded', { symbol, interval, kind: 'history', bars: entry.bars });
        return true;
      } catch (error) {
        if (generation !== this.#generation) return false;
        const context = { symbol: symbol.symbol, interval };
        const failure = toChartError(error, 'history-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not load older bars of "${symbol.symbol}"` : '', context);
        this.#emit('data:error', { ...context, kind: 'history', error: failure });
        return false;
      }
    })().finally(() => {
      if (this.#history === page) this.#history = null;
    });
    this.#history = page;
    return page;
  }

  /** Stop live updates and in-flight requests. */
  dispose(): void {
    this.#persist();
    this.#stop();
    this.#unsubscribeStatus?.();
    this.#key = null;
    this.#entry = null;
  }

  #stop(): void {
    this.#snapshotOnScreen = false;
    this.#ready = false;
    this.#holds = 0;
    this.#resets = 0;
    this.#fullReset = null;
    this.#deferred = null;
    this.#deferredGap = null;
    this.#applied = [];
    this.#isStale = false;
    this.#generation++;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#initial = null;
    this.#history = null;
    this.#buffer = null;
  }

  async #load(generation: number, symbol: string, requested: Interval, signal: AbortSignal): Promise<void> {
    const current = () => generation === this.#generation;
    this.#quote = null;
    this.#emit('data:loading', { symbol, interval: requested, kind: 'initial' });
    let resolved = false;
    let interval = requested;
    // A cached snapshot paints while the source is asked; whichever lands later loses to the load.
    let landed = false;
    let painted = null as Snapshot | null;
    const store = this.options.cache;
    if (store) {
      void attempt(() => store.get(cacheKey(symbol, requested))).then((value) => {
        const snapshot = readSnapshot(value, requested, nowSeconds());
        if (!snapshot || landed || !current()) return;
        painted = snapshot;
        this.#snapshotOnScreen = true;
        this.#target.setPriceFormat(symbolPriceFormat(snapshot.info));
        this.#target.setAdjustments?.(snapshot.adjustments);
        this.#target.setData(snapshot.bars.slice(), 'initial');
        this.#emit('data:snapshot', { symbol: snapshot.info, interval: requested, bars: snapshot.bars, savedAt: snapshot.savedAt });
      });
    }
    try {
      const info = await this.source.symbol(symbol);
      resolved = true;
      if (!current()) return;
      // An interval the symbol does not support becomes the nearest one it does.
      interval = nearestInterval(requested, info.intervals);
      if (interval !== requested) {
        this.#key = cacheKey(symbol, interval);
        this.#lastRequest = { symbol, interval };
      }
      // Subscribe first so nothing is missed between the history snapshot and live data.
      this.#buffer = [];
      // Each one is kept as soon as it starts, so a later one throwing still ends it.
      const offs: ((() => void) | undefined)[] = [];
      this.#unsubscribe = () => {
        for (const off of offs) off?.();
      };
      offs.push(this.source.stream?.(info, interval, (bar) => this.#onLive(generation, bar)));
      offs.push(
        this.source.onReset?.((reset) => {
          // Resets of other symbols and intervals are not for this load.
          if (reset.symbol === info.symbol && (reset.interval ?? interval) === interval) this.#onReset(generation, reset.range);
        }),
      );
      offs.push(
        this.source.quotes?.(info, (quote) => {
          if (!current()) return;
          this.#quote = quote;
          this.#emit('data:quote', { symbol: info.symbol, quote });
        }),
      );
      const key = cacheKey(symbol, interval);
      let entry = this.#cache.get(key);
      if (entry?.adjustmentsMissing) entry = undefined;
      if (entry && !(await this.#refreshTail(entry, info, interval, signal))) entry = undefined;
      if (!entry) {
        const result = await this.source.history(info, interval, {
          kind: 'initial',
          limit: this.options.initialBars + (this.#target.lookback?.() ?? 0),
          signal,
        });
        const bars = normalizeBars(result.bars, this.#onDrop);
        const last = bars[bars.length - 1];
        const adjustments = last ? await this.#adjustmentsFor(info, interval, 'initial', bars[0]!.time, last.time + 1, signal) : [];
        entry = { info, bars, atStart: !!result.atStart || bars.length === 0, adjustments: adjustments ?? [] };
        if (!adjustments) entry.adjustmentsMissing = true;
      }
      if (!current()) return;
      landed = true;
      this.#snapshotOnScreen = false;
      entry.info = info;
      this.#remember(key, entry);
      this.#entry = entry;
      this.symbol = info;
      const previous = this.interval;
      this.interval = interval;
      this.#target.setPriceFormat(symbolPriceFormat(info));
      this.#target.setAdjustments?.(entry.adjustments);
      // The same bars and adjustments as the snapshot on screen: nothing to repaint.
      const unchanged =
        painted && interval === requested && sameBars(painted.bars, entry.bars) && sameAdjustments(painted.adjustments, entry.adjustments);
      if (!unchanged) this.#target.setData(entry.bars, 'initial');
      this.#emit('data:loaded', { symbol: info, interval, kind: 'initial', bars: entry.bars });
      if (interval !== previous || interval !== requested) {
        const reason = interval === requested ? 'request' : 'unsupported';
        this.#emit('interval:change', { interval, previous, requested, reason });
      }
      // Buffered live bars follow as `data:bar`, after listeners saw the history.
      const buffered = this.#buffer ?? [];
      this.#buffer = null;
      for (const bar of buffered) this.#merge(bar);
      this.#ready = true;
      this.#persist();
      const deferred = this.#deferred;
      const gap = this.#deferredGap;
      this.#deferred = null;
      this.#deferredGap = null;
      if (deferred) void this.#reset(deferred.range);
      // A full reset already refetches everything a gap fill would.
      if (gap !== null && !(deferred && !deferred.range)) this.#fillGap(gap);
    } catch (error) {
      if (!current()) return;
      landed = true;
      this.#deferred = null;
      this.#deferredGap = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#buffer = null;
      this.#key = null;
      const failure = resolved
        ? toChartError(error, 'load-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not load "${symbol}" at ${interval}` : '', { symbol, interval })
        : toChartError(error, 'unknown-symbol', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not resolve symbol "${symbol}"` : '', { symbol, interval });
      this.#emit('data:error', { symbol, interval, kind: 'initial', error: failure });
      // The snapshot stays on screen, marked as possibly out of date.
      if (painted) this.#emit('data:stale', { gap: Math.max(0, nowSeconds() - painted.savedAt), reason: 'reconcile' });
      throw failure;
    }
  }

  /**
   * Corporate actions from `from` to `to` (exclusive), sorted; none when the
   * source has no `adjustments`. Null when it failed: the bars still load,
   * unadjusted, and `data:warning` reports it.
   */
  async #adjustmentsFor(
    symbol: SymbolInfo,
    interval: Interval,
    kind: DataLoadKind,
    from: Time,
    to: Time,
    signal: AbortSignal,
  ): Promise<Adjustment[] | null> {
    if (!this.source.adjustments || !(to > from)) return [];
    try {
      return mergeAdjustments([], await this.source.adjustments(symbol, { from, to, signal }));
    } catch (error) {
      // An aborted load is dropped by its caller; nothing to report.
      if (signal.aborted) return [];
      const context = { symbol: symbol.symbol, interval };
      const failure = toChartError(error, 'adjustments-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not load the adjustments of "${symbol.symbol}"` : '', context);
      this.#emit('data:warning', { ...context, kind, error: failure });
      return null;
    }
  }

  /** Fetch bars newer than a cached series; false when the gap is too big to patch. */
  async #refreshTail(entry: CacheEntry, info: SymbolInfo, interval: Interval, signal: AbortSignal): Promise<boolean> {
    const last = entry.bars[entry.bars.length - 1];
    if (!last) return false;
    const limit = this.options.pageBars;
    const result = await this.source.history(info, interval, { kind: 'refresh', from: last.time, limit, signal });
    // Report drops only when these bars are used, not when a full reload replaces them.
    const drops: [Bar, DropReason][] = [];
    const fresh = normalizeBars(result.bars, (bar, reason) => drops.push([bar, reason])).filter((b) => b.time >= last.time);
    if (fresh.length >= limit) return false;
    for (const [bar, reason] of drops) this.#onDrop(bar, reason);
    for (const bar of fresh) mergeInto(entry.bars, bar);
    return true;
  }

  #onLive(generation: number, bar: Bar): void {
    if (generation !== this.#generation) return;
    if (this.#buffer) this.#buffer.push(bar);
    else this.#merge(bar);
  }

  /** The source changed bars it sent: refetch them, or wait for the initial load. */
  #onReset(generation: number, range?: ResetRange): void {
    if (generation !== this.#generation) return;
    // A malformed range from the source (not finite, or empty or inverted) falls back to refetching everything.
    if (range && !(Number.isFinite(range.from) && (range.to === undefined || (Number.isFinite(range.to) && range.to > range.from)))) {
      range = undefined;
    }
    if (this.#ready) void this.#reset(range);
    else this.#defer(range);
  }

  /** Remember a reset for after the initial load; several merge into one covering them all. */
  #defer(range?: ResetRange): void {
    const prev = this.#deferred;
    if (!prev) this.#deferred = { range };
    else if (!prev.range || !range) this.#deferred = {};
    else {
      const to = prev.range.to === undefined || range.to === undefined ? undefined : Math.max(prev.range.to, range.to);
      this.#deferred = { range: { from: Math.min(prev.range.from, range.from), to } };
    }
  }

  #onStatus(status: FeedStatus): void {
    this.#feedStatus = status;
    if (status.state === 'disconnected') {
      // Closed on purpose (nothing subscribed): the next load fetches fresh bars.
      this.#downSince = null;
      return;
    }
    if (status.state === 'reconnecting') {
      if (this.#downSince !== null) return;
      this.#downSince = status.since;
      this.#emit('data:reconnecting', { since: status.since });
      return;
    }
    const down = this.#downSince;
    this.#downSince = null;
    if (down === null) return;
    const gap = Math.max(0, status.since - down);
    this.#emit('data:reconnect', { gap });
    if (this.#ready) this.#fillGap(gap);
    // The initial load in flight may have fetched its bars before the outage: fill the gap once it lands.
    else if (this.#initial) this.#deferredGap = Math.max(this.#deferredGap ?? 0, gap);
  }

  /** Refetch the bars missed during an outage of `gap` seconds, or mark the series stale when it is too long. */
  #fillGap(gap: number): void {
    const last = this.#entry?.bars[this.#entry.bars.length - 1];
    if (!last) return;
    if (gap > this.options.maxGapFillSeconds) {
      this.#isStale = true;
      this.#emit('data:stale', { gap, reason: 'outage' });
      return;
    }
    void this.#reset({ from: last.time }, true);
  }

  /**
   * Refetch the whole series (no range) or one range. A range replaces the
   * bars inside it, or with `merge` only those the source sent again; one that
   * holds a full page or more falls back to a full reset. Live bars arriving
   * meanwhile are held back and merged after, so the forming bar keeps its
   * live value. Range resets applied after this one was requested are
   * replayed over its response, so a slow older response never overwrites them.
   */
  #reset(range: ResetRange | undefined, merge = false): Promise<void> {
    const { symbol, interval } = this;
    const entry = this.#entry;
    if (!entry || !symbol || !interval) return Promise.resolve();
    const generation = this.#generation;
    const epoch = range ? this.#epoch : ++this.#epoch;
    const seq = ++this.#resetSeq;
    const current = () => generation === this.#generation && epoch === this.#epoch;
    const limit = this.options.pageBars;
    const wanted = range
      ? limit
      : Math.max(this.options.initialBars + (this.#target.lookback?.() ?? 0), entry.bars.length);
    this.#resets++;
    this.#hold();
    const task: Promise<void> = (async () => {
      this.#emit('data:loading', { symbol: symbol.symbol, interval, kind: 'reset' });
      try {
        const result = await this.source.history(symbol, interval, {
          kind: 'reset',
          from: range?.from,
          to: range?.to,
          limit: wanted,
          signal: this.#abort.signal,
        });
        if (!current()) return;
        const bars = normalizeBars(result.bars, this.#onDrop);
        if (range) {
          // Older bars than those loaded are left to history paging.
          const oldest = entry.bars[0]?.time ?? -Infinity;
          const inside = bars.filter(
            (b) => b.time >= range.from && b.time >= oldest && (range.to === undefined || b.time < range.to),
          );
          if (inside.length >= limit) return void (await this.#reset(undefined));
          entry.bars = applyRange(entry.bars, inside, range, merge);
          this.#applied.push({ seq, range, bars: inside, merge });
          this.#applied.sort((a, b) => a.seq - b.seq);
        } else {
          entry.bars = bars;
          entry.atStart = !!result.atStart || bars.length === 0;
          this.#isStale = false;
        }
        for (const later of this.#applied) {
          if (later.seq > seq) entry.bars = applyRange(entry.bars, later.bars, later.range, later.merge);
        }
        this.#target.setData(entry.bars, 'reset');
        this.#emit('data:loaded', { symbol, interval, kind: 'reset', bars: entry.bars });
        if (!merge) this.#emit('data:reset', { symbol, interval, range });
      } catch (error) {
        if (!current()) return;
        const context = { symbol: symbol.symbol, interval };
        const failure = toChartError(error, 'reset-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not reload bars of "${symbol.symbol}"` : '', context);
        this.#emit('data:error', { ...context, kind: 'reset', error: failure });
      }
    })().finally(() => {
      if (generation !== this.#generation) return;
      this.#resets--;
      if (this.#resets === 0) this.#applied = [];
      if (this.#fullReset === task) this.#fullReset = null;
      this.#release();
    });
    if (!range) this.#fullReset = task;
    return task;
  }

  /** Hold live bars back until `release`. */
  #hold(): void {
    this.#holds++;
    this.#buffer ??= [];
  }

  /** Merge the held live bars once no reset needs them held. */
  #release(): void {
    if (--this.#holds > 0) return;
    const buffered = this.#buffer ?? [];
    this.#buffer = null;
    for (const bar of buffered) this.#merge(bar);
  }

  /** Fetched bars already reported, so a source serving the same bar again (a static source paging) reports it once. */
  readonly #reported = new WeakSet<Bar>();

  /** A fetched bar was left out. */
  readonly #onDrop = (bar: Bar, reason: DropReason) => {
    if (this.#reported.has(bar)) return;
    this.#reported.add(bar);
    this.#target.dropped?.(bar, reason);
  };

  #merge(bar: Bar): void {
    if (!this.#entry) {
      this.dropped++;
      return;
    }
    if (!isValidBar(bar)) {
      this.dropped++;
      this.#target.dropped?.(bar, 'invalid');
      return;
    }
    bar = this.#snapToOpenBar(bar);
    const appended = mergeInto(this.#entry.bars, bar);
    if (appended === null) {
      this.dropped++;
      this.#target.dropped?.(bar, 'older');
      return;
    }
    this.#target.update(bar);
    this.#emit('data:bar', { bar, appended });
  }

  /**
   * A live bar of a calendar interval timed inside the open bar (a source
   * that stamps the trade time, or a month bar opening at another hour) moves
   * to the open bar's time, so it updates that bar instead of adding one.
   */
  #snapToOpenBar(bar: Bar): Bar {
    const { interval, symbol } = this;
    const entry = this.#entry;
    const last = entry?.bars[entry.bars.length - 1];
    if (!last || !interval || bar.time <= last.time || !isCalendarInterval(interval)) return bar;
    const next = nextIntervalStart(last.time, interval, symbolZone(symbol?.timezone));
    return bar.time < next ? { ...bar, time: last.time } : bar;
  }

  /** Store the newest window of the loaded bars in the persistent cache, if there is one. */
  #persist(): void {
    const store = this.options.cache;
    const { symbol } = this;
    const entry = this.#entry;
    const key = this.#key;
    if (!store || !this.#ready || !entry || !symbol || key === null || entry.bars.length === 0) return;
    const keep = this.options.initialBars + (this.#target.lookback?.() ?? 0);
    const snapshot = makeSnapshot(symbol, entry.bars.slice(-keep), entry.adjustments, nowSeconds());
    // Under the key `setSymbol` is asked with, which may differ from the name the source resolves it to.
    void attempt(() => store.set(key, snapshot));
  }

  #remember(key: string, entry: CacheEntry): void {
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    while (this.#cache.size > this.options.cacheSize) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }
  }
}

/** Replace the last bar (same time) or append; null when older than the last bar. */
function mergeInto(bars: Bar[], bar: Bar): boolean | null {
  const last = bars[bars.length - 1];
  if (last && bar.time < last.time) return null;
  if (last && bar.time === last.time) {
    bars[bars.length - 1] = bar;
    return false;
  }
  bars.push(bar);
  return true;
}

/** `bars` with `fresh` (ascending, all inside `range`) merged in, or replacing the bars inside `range`. */
function applyRange(bars: Bar[], fresh: Bar[], range: ResetRange, merge: boolean): Bar[] {
  return merge ? mergeRange(bars, fresh) : replaceRange(bars, fresh, range);
}

/** `bars` with those inside `range` swapped for `fresh` (ascending, all inside it). */
function replaceRange(bars: Bar[], fresh: Bar[], range: ResetRange): Bar[] {
  const start = lowerBound(bars, range.from);
  const end = range.to === undefined ? bars.length : lowerBound(bars, range.to);
  return bars.slice(0, start).concat(fresh, bars.slice(end));
}

/** `bars` with `fresh` (ascending) merged in; `fresh` wins on equal times. */
function mergeRange(bars: Bar[], fresh: Bar[]): Bar[] {
  if (fresh.length === 0) return bars;
  const start = lowerBound(bars, fresh[0]!.time);
  return bars.slice(0, start).concat(normalizeBars(bars.slice(start).concat(fresh)));
}

/** Run a storage call; a throw or rejection reads as nothing stored, so loading goes on as without a cache. */
async function attempt<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    return undefined;
  }
}

function cacheKey(symbol: string, interval: Interval): string {
  return `${symbol}\u0000${interval}`;
}
