import { ChartError } from '../errors';
import type { Bar, Time } from '../types';
import { calendarMonths, intervalSeconds, intervalStart, isCalendarInterval, isTimeInterval, nextIntervalStart } from './interval';
import { dedupeByTime, listenerSet, liveReads, symbolLookup } from './util';
import type { BarsRequest, BarsReset, BarsResult, DataSource, FeedStatus, Interval, SymbolInfo } from './types';
import { isNumber } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * One OHLCV row as exchange libraries return it:
 * `[timeMs, open, high, low, close, volume]`, the time in milliseconds.
 * Missing values may be null or undefined; the chart drops such bars.
 */
export type OhlcvRow = readonly (number | null | undefined)[];

/** The parts of an exchange's market description the adapter reads. */
export interface OhlcvMarket {
  /** Unified symbol, such as 'BTC/USD'; also the chart's symbol key. */
  symbol: string;
  base?: string;
  quote?: string;
  /** Market kind, such as 'spot', 'swap' (perpetual), 'future' or 'option'. */
  type?: string;
  /** False for a market that no longer trades; it is left out of search. */
  active?: boolean | null;
  /** `price` is either a count of decimals or a tick size (see `pricePrecision`). */
  precision?: { price?: number | null };
}

/**
 * The exchange object the adapter calls: the market data methods that unified
 * exchange libraries share. Any object with these members works; the adapter
 * imports no library.
 */
export interface OhlcvExchange {
  /** Display name, used as `SymbolInfo.exchange`. */
  name?: string;
  /**
   * Supported timeframes, as an array or as the keys of an object ('1m',
   * '1h', '1d', '1w', '1M'...). Without it every interval is passed through.
   */
  timeframes?: Readonly<Record<string, unknown>> | readonly string[];
  /** Capability flags; `watchOHLCV: false` means the exchange has no stream, so it is polled. */
  has?: Readonly<Record<string, unknown>>;
  /**
   * Markets by symbol, or as a list. Called once; a failure is retried on the
   * next lookup. Empty entries are skipped: libraries type their market map as
   * possibly holding `undefined`.
   */
  loadMarkets(): Promise<Readonly<Record<string, OhlcvMarket | undefined>> | readonly (OhlcvMarket | undefined)[]>;
  /** Up to `limit` rows from `since` (ms, inclusive) on, oldest first; the newest rows without `since`. */
  fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number): Promise<readonly OhlcvRow[]>;
  /** Resolves with the latest rows each time the forming bar changes. */
  watchOHLCV?(symbol: string, timeframe: string): Promise<readonly OhlcvRow[]>;
  /** Ends the stream `watchOHLCV` started. */
  unWatchOHLCV?(symbol: string, timeframe: string): Promise<unknown>;
}

/** Options for `createOhlcvDataSource`: request size, poll period, reconnect backoff, how to read price precision, and a hook to adjust symbols. */
export interface OhlcvDataSourceOptions {
  /** Most rows to ask for in one history request (default 500). Venues capping lower are paged anyway. */
  maxBarsPerRequest?: number;
  /** Poll period in ms when the exchange has no stream (default 5000). */
  pollMs?: number;
  /** Backoff bounds in ms after a failed stream read or poll (default 1000 to 30000). */
  reconnect?: { minMs: number; maxMs: number };
  /**
   * What `market.precision.price` holds: a count of `'decimals'`, or a
   * `'tickSize'`. When unset, a fraction is taken as a tick size and a whole
   * number as decimals; set it for a venue that quotes whole tick sizes.
   */
  pricePrecision?: 'decimals' | 'tickSize';
  /** Adjust the symbol built from a market, e.g. to add a timezone or another label. */
  symbolInfo?(market: OhlcvMarket, info: SymbolInfo): SymbolInfo;
}

type SymbolLookup = ReturnType<typeof symbolLookup>;

/** Market types renamed for display; others are passed through. */
const MARKET_TYPES: Record<string, string> = { swap: 'perpetual' };

/**
 * A data source over an exchange object from a unified exchange library (see
 * `OhlcvExchange`). History is paged forward from a computed start time, at
 * most `maxBarsPerRequest` rows per request; symbols come from the exchange's
 * markets, with the intervals its timeframes list; live bars come from the
 * stream when the exchange has one, otherwise from polling the newest rows.
 *
 * @example
 * ```ts
 * // `exchange` is an instance from the exchange library the app installs.
 * chart.setDataSource(createOhlcvDataSource(exchange, { maxBarsPerRequest: 1000 }));
 * await chart.setSymbol('BTC/USD', '1h');
 * ```
 */
export function createOhlcvDataSource(exchange: OhlcvExchange, options: OhlcvDataSourceOptions = {}): DataSource {
  const maxRows = Math.max(1, Math.floor(options.maxBarsPerRequest ?? 500));
  const pollMs = options.pollMs ?? 5000;
  const { minMs, maxMs } = options.reconnect ?? { minMs: 1000, maxMs: 30000 };
  const timeframes = timeframeList(exchange.timeframes);
  const intervals = timeframes?.filter(isTimeInterval);
  const streams = typeof exchange.watchOHLCV === 'function' && exchange.has?.['watchOHLCV'] !== false;

  let symbols: Promise<{ lookup: SymbolLookup; search: SymbolLookup }> | null = null;
  const markets = () => {
    symbols ??= exchange.loadMarkets().then(
      (loaded) => {
        const entries: readonly (OhlcvMarket | undefined)[] = Array.isArray(loaded) ? loaded : Object.values(loaded);
        const list = entries.filter((market): market is OhlcvMarket => market != null);
        const all = list.map((market) => {
          const info = marketInfo(market, exchange.name, intervals, options.pricePrecision);
          return options.symbolInfo ? options.symbolInfo(market, info) : info;
        });
        const tradable = all.filter((_, i) => list[i]!.active !== false);
        return { lookup: symbolLookup(all), search: symbolLookup(tradable) };
      },
      (error: unknown) => {
        symbols = null;
        throw error;
      },
    );
    return symbols;
  };

  const timeframeOf = (interval: Interval): string => {
    const time = isTimeInterval(interval);
    if (time && (!timeframes || timeframes.includes(interval))) return interval;
    const match = time ? intervals!.find((tf) => sameLength(tf, interval)) : undefined;
    if (match === undefined) {
      const why = time ? 'The exchange has no timeframe for' : 'The exchange source loads time bars only, not';
      throw new ChartError('invalid-interval', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${why} "${interval}"` : '', {
        context: { interval, timeframes },
      });
    }
    return match;
  };

  const status = listenerSet<FeedStatus>();
  const resets = listenerSet<BarsReset>();
  let state: FeedStatus['state'] = 'disconnected';
  let live = 0;
  const report = (next: FeedStatus['state']) => {
    if (next === state) return;
    state = next;
    status.emit({ state, since: Date.now() / 1000 });
  };

  return {
    symbol: async (symbol) => (await markets()).lookup.symbol(symbol),
    search: async (query) => (await markets()).search.search(query),

    async history(symbol, interval, request) {
      return fetchHistory(exchange, symbol.symbol, timeframeOf(interval), interval, request, maxRows);
    },

    stream(symbol, interval, onBar) {
      const timeframe = timeframeOf(interval);
      const read = streams
        ? () => exchange.watchOHLCV!(symbol.symbol, timeframe)
        : () => exchange.fetchOHLCV(symbol.symbol, timeframe, undefined, 2);
      // A stream read can return a long tail of bars the chart has: the first read sends the newest only.
      // No copies needed: each read builds new bars from the rows' numbers, so a library that
      // reuses its rows changes no bar the chart holds or the bar kept to compare the next read.
      const merge = liveReads(onBar, (from) => resets.emit({ symbol: symbol.symbol, interval, range: { from } }), true);
      let stopped = false;
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const step = async () => {
        timer = null;
        let bars: Bar[];
        try {
          bars = rowsToBars(await read());
        } catch {
          if (stopped) return;
          report('reconnecting');
          const delay = Math.min(maxMs, minMs * 2 ** failures++);
          timer = setTimeout(step, delay * (0.8 + Math.random() * 0.4));
          return;
        }
        if (stopped) return;
        failures = 0;
        report('connected');
        merge(dedupeByTime(bars));
        // A stream read waits for the next change itself; a poll waits its period.
        timer = setTimeout(step, streams ? 0 : pollMs);
      };

      live++;
      void step();
      return () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        if (streams && exchange.unWatchOHLCV) {
          try {
            exchange.unWatchOHLCV(symbol.symbol, timeframe).catch(() => {});
          } catch {
            // The exchange cannot end the stream; its reads are ignored from now on.
          }
        }
        if (--live === 0) report('disconnected');
      };
    },

    onStatus: status.add,
    onReset: resets.add,
  };
}

/**
 * Answer a bars request by paging forward from a start time: `limit` bars
 * (plus one, for venues that align bars differently) before `to`, or `from`
 * when that is later. Rows at or after `to` are dropped and the newest
 * `limit` are kept. Pages continue while the venue returns newer rows,
 * so a venue that caps rows below `maxRows` is paged too. `atStart` is set
 * when the window, not bounded by `from`, held no bars at all.
 */
async function fetchHistory(
  exchange: OhlcvExchange,
  symbol: string,
  timeframe: string,
  interval: Interval,
  request: BarsRequest,
  maxRows: number,
): Promise<BarsResult> {
  const { signal, limit } = request;
  signal.throwIfAborted();
  const length = intervalSeconds(interval);
  const now = Math.floor(Date.now() / 1000);
  const end = request.to ?? Infinity;
  const start = windowStart(request.to ?? now + length, interval, limit + 1);
  const bounded = request.from !== undefined && request.from >= start;
  let cursor = bounded ? request.from! : start;
  const bars: Bar[] = [];
  while (cursor < end) {
    const wanted = end === Infinity ? maxRows : Math.min(maxRows, Math.ceil((end - cursor) / length));
    const page = rowsToBars(await exchange.fetchOHLCV(symbol, timeframe, cursor * 1000, wanted));
    signal.throwIfAborted();
    let newest = -Infinity;
    for (const bar of page) {
      if (bar.time >= cursor && bar.time < end) bars.push(bar);
      if (bar.time > newest) newest = bar.time;
    }
    // Stop when the venue has nothing newer (an empty page, or only rows older
    // than asked for), or the next bar would start at `to` or in the future.
    if (!(newest >= cursor)) break;
    const next = nextIntervalStart(newest, interval);
    if (next >= end || next > now) break;
    cursor = newest + 1;
  }
  const sorted = dedupeByTime(bars);
  return { bars: sorted.slice(Math.max(0, sorted.length - limit)), atStart: sorted.length === 0 && !bounded };
}

/** Start of the bar `count` bars before `end`; calendar bars step through the calendar (UTC). */
function windowStart(end: Time, interval: Interval, count: number): Time {
  if (!isCalendarInterval(interval)) return end - count * intervalSeconds(interval);
  let time = end;
  for (let i = 0; i < count; i++) time = intervalStart(time - 1, interval);
  return time;
}

/** Bars from a response, skipping entries that are not rows; anything but a list is an error. */
function rowsToBars(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'The exchange did not return a list of OHLCV rows' : '');
  return rows.filter((row): row is OhlcvRow => Array.isArray(row)).map(rowToBar);
}

function rowToBar(row: OhlcvRow): Bar {
  const value = (i: number) => row[i] ?? NaN;
  const bar: Bar = { time: Math.floor(value(0) / 1000), open: value(1), high: value(2), low: value(3), close: value(4) };
  const volume = row[5];
  if (volume !== null && volume !== undefined) bar.volume = volume;
  return bar;
}

function timeframeList(timeframes: OhlcvExchange['timeframes']): string[] | undefined {
  if (!timeframes) return undefined;
  return Array.isArray(timeframes) ? [...(timeframes as readonly string[])] : Object.keys(timeframes);
}

/** Whether a timeframe means the same bars as an interval: equal months for calendar units, equal length otherwise. */
function sameLength(timeframe: string, interval: Interval): boolean {
  const months = calendarMonths(timeframe);
  if (months !== null || isCalendarInterval(interval)) return months === calendarMonths(interval);
  return intervalSeconds(timeframe) === intervalSeconds(interval);
}

function marketInfo(
  market: OhlcvMarket,
  exchange: string | undefined,
  intervals: string[] | undefined,
  pricePrecision: OhlcvDataSourceOptions['pricePrecision'],
): SymbolInfo {
  const type = market.type ? (MARKET_TYPES[market.type] ?? market.type) : undefined;
  const pair = market.base && market.quote ? `${market.base}/${market.quote}` : undefined;
  const info: SymbolInfo = { symbol: market.symbol, name: market.symbol };
  if (pair) info.description = type ? `${pair} ${type}` : pair;
  if (type) info.type = type;
  if (exchange) info.exchange = exchange;
  if (intervals) info.intervals = [...intervals];
  const price = market.precision?.price;
  if (isNumber(price) && price >= 0) {
    const tick = pricePrecision ? pricePrecision === 'tickSize' : !Number.isInteger(price);
    if (tick && price > 0) info.tickSize = price;
    else if (!tick) info.precision = price;
  }
  return info;
}
