import type { Bar, Time } from '../types';
import type { DataSource, Interval, SymbolInfo } from '../data/types';
import { safeIntervalSeconds } from '../data/interval';
import { normalizeBars } from '../data/util';
import { lowerBound } from '../timeline';
import type { ExternalSource } from './runner';
import type {
  IndicatorContext,
  IndicatorDef,
  IndicatorFetchRequest,
  IndicatorOutputs,
  IndicatorRow,
  IndicatorStatus,
  InputValue,
} from './types';
import { errorText } from '../errors';
import { isNumber, isText } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The chart's symbol and interval, once its data source has loaded them. */
export interface FeedContext {
  symbol: SymbolInfo;
  interval: Interval;
}

/** What an external feed needs from its indicator and chart. */
export interface FeedHost {
  /** Current symbol and interval, or null without a loaded data source. */
  context(): FeedContext | null;
  /** The chart's data source, for `barsOf`. */
  source(): DataSource | null;
  /** Main bar times, ascending. */
  times(): ArrayLike<Time>;
  inputs(): Record<string, InputValue>;
  /** Rows changed at or after `time`, or anywhere when null. */
  changed(time: Time | null): void;
  status(status: IndicatorStatus, message: string | null): void;
  error(error: unknown): void;
}

/**
 * Rows by time. Each row holds one value per field (NaN when missing); setting
 * a time again replaces its row.
 */
export class RowStore {
  readonly #rows = new Map<Time, Float64Array>();
  #sorted: Time[] | null = [];

  get size(): number {
    return this.#rows.size;
  }

  get(time: Time): Float64Array | undefined {
    return this.#rows.get(time);
  }

  set(time: Time, values: Float64Array): void {
    const sorted = this.#sorted;
    if (!this.#rows.has(time)) {
      // Live rows usually arrive in order: keep the cache when appending.
      if (sorted && (sorted.length === 0 || time > sorted[sorted.length - 1]!)) sorted.push(time);
      else this.#sorted = null;
    }
    this.#rows.set(time, values);
  }

  clear(): void {
    this.#rows.clear();
    this.#sorted = [];
  }

  /** Row times, ascending. */
  times(): readonly Time[] {
    return (this.#sorted ??= [...this.#rows.keys()].sort((a, b) => a - b));
  }
}

/**
 * A row as `[time, values]`, or null when it has no finite time. Values beyond
 * `width` are ignored; missing and non-finite ones are NaN.
 */
export function parseRow(raw: unknown, width: number): [Time, Float64Array] | null {
  if (!Array.isArray(raw)) return null;
  const time = raw[0];
  if (!isNumber(time)) return null;
  const values = new Float64Array(width);
  for (let i = 0; i < width; i++) {
    const v = raw[i + 1];
    values[i] = isNumber(v) ? v : NaN;
  }
  return [time, values];
}


/** A fetch range [from, to) split into requests of at most `chunk` bars. */
export function chunkRange(times: ArrayLike<Time>, from: Time, to: Time, chunk: number): { from: Time; to: Time; barCount: number }[] {
  const start = lowerBound(times, from);
  const end = lowerBound(times, to);
  if (end <= start) return [];
  const size = Math.max(1, Math.floor(chunk));
  const out: { from: Time; to: Time; barCount: number }[] = [];
  for (let s = start; s < end; s += size) {
    const e = Math.min(s + size, end);
    out.push({ from: s === start ? from : times[s]!, to: e === end ? to : times[e]!, barCount: e - s });
  }
  return out;
}

/**
 * Owns one indicator's external data: fetches rows for the loaded range and
 * for older history as it pages in, streams live rows, and starts over when
 * the context the rows depend on changes. Every restart bumps a generation
 * and aborts in-flight requests, so late answers are ignored.
 */
export class ExternalFeed implements ExternalSource {
  readonly fields: readonly string[];
  readonly #store = new RowStore();
  /** What the rows depend on (see `refetchOn`); null when nothing is fetched. */
  #key: string | null = null;
  /** Symbol and interval the live subscription streams; null without one. */
  #subscribed: string | null = null;
  /** Identifies the current subscription; rows from an older one are ignored. */
  #subscription: object | null = null;
  private interval: Interval | null = null;
  /** Time range [from, to) fetched or being fetched. */
  #covered: { from: Time; to: Time } | null = null;
  #abort = new AbortController();
  #generation = 0;
  #inFlight = 0;
  #unsubscribe: (() => void) | null = null;
  /** `subscribe` threw; kept until it subscribes again. */
  #streamFailure: string | null = null;
  /** A fetch of `range` failed; kept until a fetch covers the range. */
  #fetchFailure: { message: string; range: { from: Time; to: Time } } | null = null;
  /** Bumped by every live row; `liveAt` holds the count when each time was last written live. */
  #liveCount = 0;
  readonly #liveAt = new Map<Time, number>();
  /** Reason the context is unsupported. */
  #unsupported: string | null = null;
  #disposed = false;

  constructor(
    private readonly def: IndicatorDef,
    private readonly host: FeedHost,
  ) {
    this.fields = [...(def.fields ?? [])];
  }

  /**
   * Bring the rows in line with the chart: start over when the context the
   * rows depend on changed, else fetch only ranges not yet covered (older
   * history that paged in). Called when the indicator goes live, after main
   * data loads, and when inputs change.
   */
  sync(): void {
    if (this.#disposed) return;
    const ctx = this.host.context();
    if (!ctx) {
      this.#stop();
      this.#key = null;
      this.#unsupported = null;
      // Detached from the data source: the rows belong to its old symbol. While
      // a source loads, keep what is drawn; its context fetches from scratch.
      if (!this.host.source()) {
        this.#clearFailures();
        this.#clearRows();
      }
      this.#report();
      return;
    }
    const inputs = this.host.inputs();
    const context: IndicatorContext = { symbol: ctx.symbol, interval: ctx.interval, inputs };
    const verdict = this.#supports(context);
    if (verdict !== true) {
      this.#stop();
      this.#key = null;
      this.#unsupported = verdict;
      this.#clearFailures();
      this.#clearRows();
      this.#report();
      return;
    }
    this.#unsupported = null;
    const key = this.#cacheKey(ctx, inputs);
    const newInterval = ctx.interval !== this.interval;
    this.interval = ctx.interval;
    if (key !== this.#key) this.#restart(key, context);
    else {
      // Kept rows (`refetchOn.interval` false) re-align to the new bars.
      if (newInterval && this.#store.size > 0) this.host.changed(null);
      // Kept rows still stream for the chart's current symbol and interval.
      if (subscriptionKey(context) !== this.#subscribed) this.#subscribe(context);
    }
    this.#fillGaps(context);
    this.#report();
  }

  /**
   * Bars were appended live. Without a subscription nothing keeps the newest
   * bars current, so fetch the rows for them.
   */
  appended(): void {
    if (this.#disposed || this.def.subscribe || !this.def.fetch || this.#key === null) return;
    const ctx = this.host.context();
    if (!ctx) return;
    this.#fillGaps({ symbol: ctx.symbol, interval: ctx.interval, inputs: this.host.inputs() });
    this.#report();
  }

  /** Drop every row and fetch again, e.g. after the source corrected its data. */
  refetch(): void {
    this.#key = null;
    this.sync();
  }

  align(time: Float64Array, from: number, n: number, out: IndicatorOutputs): void {
    const times = this.#store.times();
    const columns = this.fields.map((field) => out[field]!);
    const step = (this.interval !== null ? safeIntervalSeconds(this.interval) : null) ?? Infinity;
    let j = from < n ? lowerBound(times, time[from]!) : times.length;
    for (let k = from; k < n; k++) {
      // The last bar takes rows up to one interval past its start.
      const end = k + 1 < n ? time[k + 1]! : time[k]! + step;
      let row: Float64Array | undefined;
      while (j < times.length && times[j]! < end) row = this.#store.get(times[j++]!);
      for (let c = 0; c < columns.length; c++) columns[c]![k] = row ? row[c]! : NaN;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#stop();
    this.#disposed = true;
  }

  #supports(context: IndicatorContext): true | string {
    if (!this.def.supports) return true;
    try {
      const verdict: unknown = this.def.supports(context);
      return verdict === true ? true : isText(verdict) ? verdict : 'Not available here';
    } catch (err) {
      this.host.error(err);
      return errorText(err);
    }
  }

  #cacheKey(ctx: FeedContext, inputs: Record<string, InputValue>): string {
    const on = this.def.refetchOn ?? {};
    return JSON.stringify([
      on.symbol === false ? null : ctx.symbol.symbol,
      on.interval === false ? null : ctx.interval,
      ...dataInputs(this.def).map((id) => inputs[id] ?? null),
    ]);
  }

  /** Abort requests and the subscription, and ignore anything still on its way. */
  #stop(): void {
    this.#generation++;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#inFlight = 0;
    this.#unsubscribeLive();
  }

  #unsubscribeLive(): void {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    this.#subscription = null;
    this.#subscribed = null;
    try {
      unsubscribe?.();
    } catch (err) {
      this.host.error(err);
    }
  }

  #clearRows(): void {
    this.#covered = null;
    this.#liveAt.clear();
    if (this.#store.size === 0) return;
    this.#store.clear();
    this.host.changed(null);
  }

  #restart(key: string, context: IndicatorContext): void {
    this.#stop();
    this.#key = key;
    this.#clearFailures();
    this.#clearRows();
    this.#subscribe(context);
  }

  /** (Re)start the live subscription for `context`, keeping the rows. */
  #subscribe(context: IndicatorContext): void {
    this.#unsubscribeLive();
    const subscribe = this.def.subscribe;
    if (!subscribe) return;
    this.#streamFailure = null;
    const token = {};
    this.#subscription = token;
    this.#subscribed = subscriptionKey(context);
    try {
      const unsubscribe: unknown = subscribe(context, (row) => {
        if (token === this.#subscription && !this.#disposed) this.#live(row);
      });
      if (typeof unsubscribe === 'function') this.#unsubscribe = unsubscribe as () => void;
    } catch (err) {
      this.#streamFailure = errorText(err);
      this.#fail(err);
    }
  }

  #live(raw: unknown): void {
    const row = parseRow(raw, this.fields.length);
    if (!row) return;
    const wasEmpty = this.#store.size === 0;
    this.#store.set(row[0], row[1]);
    this.#liveAt.set(row[0], ++this.#liveCount);
    this.host.changed(row[0]);
    if (wasEmpty) this.#report();
  }

  /** Fetch the parts of the loaded bars' range that no rows cover yet. */
  #fillGaps(context: IndicatorContext): void {
    if (!this.def.fetch) return;
    const times = this.host.times();
    const n = times.length;
    if (n === 0) return;
    const from = times[0]!;
    const to = times[n - 1]! + (safeIntervalSeconds(context.interval) ?? 1);
    const covered = this.#covered;
    if (!covered) {
      this.#load(context, from, to);
      return;
    }
    if (from < covered.from) this.#load(context, from, covered.from);
    // Live rows keep the newest bars current; without them, fetch what is new.
    if (!this.def.subscribe && to > covered.to) this.#load(context, covered.to, to);
  }

  #load(context: IndicatorContext, from: Time, to: Time): void {
    const fetch = this.def.fetch!;
    const times = this.host.times();
    const chunks = chunkRange(times, from, to, this.def.chunkBars ?? Infinity);
    // Marked up front, so a page loading meanwhile does not fetch the same range again.
    this.#cover(from, to);
    if (chunks.length === 0) return;
    const generation = this.#generation;
    const signal = this.#abort.signal;
    // Rows streamed live after this point are newer than the fetched snapshot.
    const startedAt = this.#liveCount;
    this.#inFlight++;
    const requests = chunks.map(async (chunk): Promise<unknown> => {
      const request: IndicatorFetchRequest = {
        ...context,
        ...chunk,
        signal,
        barsOf: (symbol) => this.#otherBars(symbol, context.interval, chunk, signal),
      };
      const rows: unknown = await fetch(request);
      if (!Array.isArray(rows)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${this.def.id}" fetch must resolve to an array of rows` : '');
      return rows.filter((row: unknown) => {
        const time = Array.isArray(row) ? (row[0] as unknown) : undefined;
        return typeof time === 'number' && time >= chunk.from && time < chunk.to;
      });
    });
    Promise.all(requests).then(
      (results) => {
        if (generation !== this.#generation || this.#disposed) return;
        this.#inFlight--;
        const failed = this.#fetchFailure?.range;
        if (failed && from <= failed.from && to >= failed.to) this.#fetchFailure = null;
        let earliest = Infinity;
        for (const rows of results) {
          for (const raw of rows as unknown[]) {
            const row = parseRow(raw, this.fields.length);
            if (!row || (this.#liveAt.get(row[0]) ?? -1) > startedAt) continue;
            this.#store.set(row[0], row[1]);
            earliest = Math.min(earliest, row[0]);
          }
        }
        if (earliest !== Infinity) this.host.changed(earliest);
        this.#report();
      },
      (err: unknown) => {
        if (generation !== this.#generation || this.#disposed) return;
        this.#inFlight--;
        // Fetch everything again on the next sync; rows already held are merged.
        this.#covered = null;
        const failed = this.#fetchFailure?.range;
        const range = failed ? { from: Math.min(failed.from, from), to: Math.max(failed.to, to) } : { from, to };
        this.#fetchFailure = { message: errorText(err), range };
        this.#fail(err);
      },
    );
  }

  #cover(from: Time, to: Time): void {
    const c = this.#covered;
    this.#covered = c ? { from: Math.min(c.from, from), to: Math.max(c.to, to) } : { from, to };
  }

  async #otherBars(
    symbol: string,
    interval: Interval,
    range: { from: Time; to: Time; barCount: number },
    signal: AbortSignal,
  ): Promise<Bar[]> {
    const source = this.host.source();
    if (!source) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'barsOf needs a data source' : '');
    const info = await source.symbol(symbol);
    // Past bars of another symbol, with no subscription to follow: a history request with a lower bound.
    const result = await source.history(info, interval, { kind: 'history', from: range.from, to: range.to, limit: range.barCount, signal });
    return normalizeBars(result.bars).filter((b) => b.time >= range.from && b.time < range.to);
  }

  #fail(err: unknown): void {
    this.host.error(err);
    this.#report();
  }

  #clearFailures(): void {
    this.#streamFailure = null;
    this.#fetchFailure = null;
  }

  #report(): void {
    if (this.#disposed) return;
    if (this.#unsupported !== null) this.host.status('idle', this.#unsupported);
    else if (this.#inFlight > 0) this.host.status('loading', null);
    else if (this.#fetchFailure !== null) this.host.status('error', this.#fetchFailure.message);
    else if (this.#streamFailure !== null) this.host.status('error', this.#streamFailure);
    else if (this.#key === null && this.#store.size === 0) this.host.status('idle', null);
    else this.host.status(this.#store.size > 0 ? 'loaded' : 'empty', null);
  }
}

/** What a live subscription streams for: the symbol and interval. */
function subscriptionKey(context: IndicatorContext): string {
  return JSON.stringify([context.symbol.symbol, context.interval]);
}

/** Interval length in seconds, or null for an interval the helpers don't know. */


/** Ids of the inputs whose change refetches: those in `refetchOn.inputs` and those marked `affectsData`. */
function dataInputs(def: IndicatorDef): string[] {
  const ids = new Set(def.refetchOn?.inputs ?? []);
  for (const d of def.inputs) if (d.affectsData) ids.add(d.id);
  return [...ids];
}
