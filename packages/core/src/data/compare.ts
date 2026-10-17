import type { Bar, Time, ValuePoint } from '../types';
import type { PriceFormat } from '../util/price-format';
import { DataController } from './controller';
import type { ChartError } from '../errors';
import type { DataEvents, DataSource, Interval, SymbolInfo } from './types';
import { bisect } from '../util/search';
import { isText } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Where a compared symbol's bars go. */
export interface CompareTarget {
  setData(bars: Bar[]): void;
  update(bar: Bar): void;
  setPriceFormat(format: PriceFormat | undefined): void;
}

/**
 * How a compared symbol is shown. `percent` (default) overlays the main pane
 * with both on one percent axis; `scale` gives it its own left price axis;
 * `pane` puts it in a new pane.
 */
export type CompareMode = 'percent' | 'scale' | 'pane';

/** How a compared symbol is drawn: a line of closes (default), candles or OHLC bars. */
export type CompareStyle = 'line' | 'candles' | 'bars';

/**
 * A synthetic symbol built from two others bar by bar: their `ratio` (a / b)
 * or their `spread` (a × wa − b × wb, weights default 1).
 */
export type ComparePair = { ratio: [string, string] } | { spread: [string, string]; weights?: [number, number] };

/** Saved form of a compared symbol, e.g. for a layout. */
export interface CompareState {
  /** The symbol, or the pair's name (`'A/B'`, `'A-B'`). */
  symbol: string;
  mode: CompareMode;
  style: CompareStyle;
  color: string;
  /** Set for a synthetic pair. */
  pair?: ComparePair;
}

/** The two symbols of a pair. */
export function pairSymbols(pair: ComparePair): [string, string] {
  return 'ratio' in pair ? pair.ratio : pair.spread;
}

/** A pair's display name: `'A/B'` for a ratio, `'A-B'` for a spread (with weights other than 1, `'2*A-B'`). */
export function pairName(pair: ComparePair): string {
  if ('ratio' in pair) return `${pair.ratio[0]}/${pair.ratio[1]}`;
  const [wa, wb] = pair.weights ?? [1, 1];
  const term = (w: number, s: string) => (w === 1 ? s : `${w}*${s}`);
  return `${term(wa, pair.spread[0])}-${term(wb, pair.spread[1])}`;
}

/** Throw on a pair the chart cannot build. */
export function checkPair(pair: ComparePair): void {
  const symbols = 'ratio' in pair ? pair.ratio : 'spread' in pair ? pair.spread : undefined;
  if (!Array.isArray(symbols) || symbols.length !== 2 || !symbols.every(isText)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'A compare pair needs { ratio: [a, b] } or { spread: [a, b] } with two symbols' : '');
  }
  const weights = 'spread' in pair ? pair.weights : undefined;
  if (weights !== undefined && !(Array.isArray(weights) && weights.length === 2 && weights.every(Number.isFinite))) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Spread weights must be two finite numbers' : '');
  }
}

/**
 * Bars `a` and `b` (the same time) as one bar of `pair`. Open and close come
 * from the legs' opens and closes; high and low from the legs' highs and lows
 * where that makes sense, widened to include open and close. Null when a ratio
 * would divide by zero.
 */
export function pairBar(a: Bar, b: Bar, pair: ComparePair): Bar | null {
  let f: (x: number, y: number) => number;
  if ('ratio' in pair) {
    if (b.open === 0 || b.close === 0 || b.high === 0 || b.low === 0) return null;
    f = (x, y) => x / y;
  } else {
    const [wa, wb] = pair.weights ?? [1, 1];
    f = (x, y) => x * wa - y * wb;
  }
  const open = f(a.open, b.open);
  const close = f(a.close, b.close);
  const x = f(a.high, b.high);
  const y = f(a.low, b.low);
  return { time: a.time, open, high: Math.max(open, close, x, y), low: Math.min(open, close, x, y), close };
}

/** `pair` bars at the times both `a` and `b` (ascending) have a bar; the other times are gaps. */
export function combinePair(a: readonly Bar[], b: readonly Bar[], pair: ComparePair): Bar[] {
  const out: Bar[] = [];
  let j = 0;
  for (const bar of a) {
    while (j < b.length && b[j]!.time < bar.time) j++;
    const other = b[j];
    if (other?.time !== bar.time) continue;
    const combined = pairBar(bar, other, pair);
    if (combined) out.push(combined);
  }
  return out;
}

/**
 * Feeds a compare target with a pair's bars from its two legs, each loaded
 * by its own `ComparedLoader` through `leg(i)`.
 */
export class PairFeed {
  private readonly bars: [Bar[] | null, Bar[] | null] = [null, null];

  constructor(
    private readonly pair: ComparePair,
    private readonly target: CompareTarget,
  ) {}

  /** The target leg `i` (0 or 1) loads into. */
  leg(i: 0 | 1): CompareTarget {
    return {
      setData: (bars) => {
        this.bars[i] = bars.slice();
        const [a, b] = this.bars;
        if (a && b) this.target.setData(combinePair(a, b, this.pair));
      },
      update: (bar) => {
        const own = this.bars[i];
        if (!own) return;
        const last = own[own.length - 1];
        if (last && last.time === bar.time) own[own.length - 1] = bar;
        else if (!last || bar.time > last.time) own.push(bar);
        else return;
        const other = this.bars[i === 0 ? 1 : 0];
        const match = other ? findBar(other, bar.time) : undefined;
        if (!match) return;
        const combined = i === 0 ? pairBar(bar, match, this.pair) : pairBar(match, bar, this.pair);
        if (combined) this.target.update(combined);
      },
      // A ratio or spread has its own scale of values: let the chart pick decimals.
      setPriceFormat: () => this.target.setPriceFormat(undefined),
    };
  }
}

/** The bar at `time` in ascending `bars`, searching from the end (live bars are near it). */
function findBar(bars: readonly Bar[], time: Time): Bar | undefined {
  for (let k = bars.length - 1; k >= 0; k--) {
    const t = bars[k]!.time;
    if (t === time) return bars[k];
    if (t < time) return undefined;
  }
  return undefined;
}

/** History pages fetched at most per sync, so a source that never reaches back cannot loop. */
const MAX_PAGES = 20;

/**
 * Move each point onto the main bar it falls in: the latest of `times` at or
 * before it. Several points in one bar keep the last (its close); points
 * before the first main bar are dropped. Points after the last main bar keep
 * their time, so they line up once the main series reaches them.
 */
export function snapToGrid(points: readonly ValuePoint[], times: readonly Time[]): ValuePoint[] {
  const last = times[times.length - 1];
  if (last === undefined) return points.slice();
  const out: ValuePoint[] = [];
  for (const p of points) {
    const t = p.time > last ? p.time : floorTime(times, p.time);
    if (t === null) continue;
    if (out.length > 0 && out[out.length - 1]!.time === t) out[out.length - 1] = { ...p, time: t };
    else out.push({ ...p, time: t });
  }
  return out;
}

/**
 * Move each bar onto the main bar it falls in, like `snapToGrid`. Several bars
 * in one main bar merge: the first open, the highest high, the lowest low,
 * the last close and the summed volume.
 */
export function snapBarsToGrid(bars: readonly Bar[], times: readonly Time[]): Bar[] {
  const last = times[times.length - 1];
  if (last === undefined) return bars.slice();
  const out: Bar[] = [];
  for (const b of bars) {
    const t = b.time > last ? b.time : floorTime(times, b.time);
    if (t === null) continue;
    const prev = out[out.length - 1];
    out.push(prev?.time === t ? mergeBars(out.pop()!, b) : { ...b, time: t });
  }
  return out;
}

/** `a` and the later `b` as one bar at `a`'s time. */
export function mergeBars(a: Bar, b: Bar): Bar {
  const merged: Bar = { time: a.time, open: a.open, high: Math.max(a.high, b.high), low: Math.min(a.low, b.low), close: b.close };
  if (a.volume !== undefined || b.volume !== undefined) merged.volume = (a.volume ?? 0) + (b.volume ?? 0);
  return merged;
}

/** The latest of ascending `times` at or before `time`, or null when all are later. */
export function floorTime(times: readonly Time[], time: Time): Time | null {
  const n = bisect(times.length, (i) => times[i]! <= time);
  return n > 0 ? times[n - 1]! : null;
}

/**
 * Loads one compared symbol through the chart's data source and keeps it on
 * the main symbol's interval and history range. Live bars stream in through
 * the source's subscription; `dispose` unsubscribes.
 */
export class ComparedLoader {
  /** Settles once the first load finishes, whether it worked or not. */
  readonly ready: Promise<void>;
  #settle!: () => void;
  readonly #controller: DataController;
  #first: Time | null = null;
  #syncing: Promise<void> | null = null;
  /** Oldest time history should reach. */
  #want: Time | null = null;
  #disposed = false;

  constructor(
    source: DataSource,
    readonly symbol: string,
    target: CompareTarget,
    onError: (error: ChartError) => void,
  ) {
    this.ready = new Promise((resolve) => (this.#settle = resolve));
    this.#controller = new DataController(
      source,
      {
        setData: (bars) => {
          this.#first = bars[0]?.time ?? null;
          target.setData(bars);
        },
        update: (bar) => target.update(bar),
        setPriceFormat: (format) => target.setPriceFormat(format),
      },
      (event, payload) => {
        if (event === 'data:error') onError((payload as DataEvents['data:error']).error);
      },
    );
  }

  /** Symbol info once loaded. */
  get info(): SymbolInfo | null {
    return this.#controller.symbol;
  }

  /** Load at `interval` (the main symbol's), then page back until history reaches `from`. */
  async load(interval: Interval, from: Time | null): Promise<void> {
    this.#want = null;
    try {
      await this.#controller.setSymbol(this.symbol, interval);
      if (from !== null) await this.cover(from);
    } finally {
      this.#settle();
    }
  }

  /**
   * Load the symbol again without the cache. History reaches back as before
   * once the main symbol's reload lands and calls `load` again. No-op before
   * the first load.
   */
  async reload(): Promise<void> {
    if (!this.#controller.symbol && !this.#controller.initialLoad) return;
    this.#want = null;
    await this.#controller.reload();
  }

  /** Page older history in until the first bar is at or before `from`, or the source runs out. */
  cover(from: Time): Promise<void> {
    this.#want = this.#want === null ? from : Math.min(this.#want, from);
    // Each call queues one more pass, which returns at once when history already reaches back far enough.
    const pass = (this.#syncing ?? Promise.resolve()).then(() => this.#pageBack());
    this.#syncing = pass;
    return pass;
  }

  async #pageBack(): Promise<void> {
    for (let i = 0; i < MAX_PAGES && !this.#disposed; i++) {
      const want = this.#want;
      if (want === null || this.#first === null || this.#first <= want || !this.#controller.hasMoreHistory) return;
      if (!(await this.#controller.loadMore())) return;
    }
  }

  /** Stop live updates and in-flight requests. */
  dispose(): void {
    this.#disposed = true;
    this.#controller.dispose();
  }
}
