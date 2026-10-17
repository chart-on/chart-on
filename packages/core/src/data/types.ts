import type { ChartError } from '../errors';
import type { Bar, Time } from '../types';
import type { PriceFormat } from '../util/price-format';
import type { Quote } from '../reference-lines';
import type { Adjustment } from './adjust';
import type { MarkerPosition, MarkerSeverity, MarkerShape } from '../annotations/types';

/**
 * Interval units: seconds, minutes, hours, days, weeks, and the calendar
 * units months (`M`), quarters (`Q`) and years (`y`).
 */
export type IntervalUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'Q' | 'y';

/**
 * Bar interval: a count and a unit, such as '1m', '15m', '4h', '1d', '1w',
 * '1M' or '1y', or, for a data source that builds bars from trades, an
 * activity interval such as '100T' (trades) or '5000V' (volume); a bare
 * unit counts one. The type catches typos in literals;
 * an app's own string becomes one through `isInterval`, and the chart still
 * checks it at runtime (see `parseInterval`).
 */
export type Interval = `${number}${IntervalUnit}` | IntervalUnit | `${number}${ActivityUnit}` | ActivityUnit;

/**
 * Activity units: a bar every `count` trades (`T`, as in '100T') or every
 * `count` units of traded volume (`V`, as in '5000V'). These bars have no
 * fixed length, so `intervalSeconds` throws for them (see `isActivityInterval`).
 * Only a data source that builds bars from trades offers them; the built-in
 * mock and exchange sources make time bars and reject them.
 */
export type ActivityUnit = 'T' | 'V';

/**
 * Bar intervals from `from` to `to`, both included, compared by nominal
 * length: `{ from: '1m', to: '59m' }` covers every minute interval. Calendar
 * units use an average length (a month is 30 days).
 */
export interface IntervalRange {
  from: Interval;
  to: Interval;
}

/** A symbol as a data source describes it: its key and names, price format, data delay, timezone and supported intervals. */
export interface SymbolInfo {
  /** Key passed back to the data source and used for caching. */
  symbol: string;
  name: string;
  description?: string;
  /** Free-form kind, e.g. 'crypto', 'stock', 'index'. */
  type?: string;
  exchange?: string;
  /** Price decimals; the chart auto-detects them when omitted. */
  precision?: number;
  /** Smallest price increment; sets the decimals unless `precision` is given. */
  tickSize?: number;
  /** Full price format (fractions, tick bands, a unit...); wins over `precision` and `tickSize`. */
  priceFormat?: PriceFormat;
  /** Minutes the data lags realtime, or `'eod'` for end-of-day data; 0 or unset is realtime. */
  delay?: number | 'eod';
  /** A contract that no longer trades, e.g. an expired future. */
  expired?: boolean;
  /**
   * IANA timezone of the exchange, e.g. 'America/New_York'. Calendar bars
   * (months, quarters, years) start in it, UTC when unset; with the chart
   * option `applySymbolTimezone` the chart also displays it.
   */
  timezone?: string;
  /**
   * Intervals this symbol supports; any when omitted or empty. Entries the
   * chart cannot parse are ignored. `setSymbol` with another interval shows
   * the nearest supported one and emits `interval:change`.
   */
  intervals?: string[];
}

/**
 * Why the chart asks for bars, which also fixes the request's shape:
 * - `'initial'`: the first load of a symbol and interval, `{ limit }`; a
 *   live subscription starts right after.
 * - `'history'`: an older page, `{ to, limit }`; with a `from` too when an
 *   indicator reads another symbol's bars over a range.
 * - `'refresh'`: bars from the last cached one on, `{ from, limit }`, when
 *   a cached symbol is shown again; also each poll of
 *   `createPollingDataSource`, whose first poll has no `from`.
 * - `'reset'`: a reload after the source reported a reset (see
 *   `DataSource.onReset`): `{ from, to?, limit }` for a range, `{ limit }`
 *   for everything.
 */
export type BarsRequestKind = 'initial' | 'history' | 'refresh' | 'reset';

/** A history request to a data source: why it is made, the time range, how many bars at most, and an abort signal. */
export interface BarsRequest {
  /** What the request is for; see `BarsRequestKind`. */
  kind: BarsRequestKind;
  /** Oldest bar time wanted (inclusive); omitted = no lower bound. */
  from?: Time;
  /** Bars strictly older than this; omitted = up to the newest bar. */
  to?: Time;
  /**
   * Return at most this many bars, the newest within the range. Named for
   * what it is, an upper bound: a source may return fewer.
   */
  limit: number;
  /** Aborted when the request is no longer needed (symbol or interval switch). */
  signal: AbortSignal;
}

/** A data source's answer to a `BarsRequest`: bars in ascending time, and whether older history exists. */
export interface BarsResult {
  /** Ascending by time, unix seconds. */
  bars: Bar[];
  /**
   * The bars reach the start of the symbol's history: nothing older exists,
   * so the chart stops asking for older pages. Named for that fact rather
   * than for an empty answer, since a page can hold bars and still be the last.
   */
  atStart?: boolean;
}

/**
 * Bars a data source corrected: `from` inclusive, `to` exclusive (like
 * `BarsRequest`); an omitted `to` means up to the newest bar.
 */
export interface ResetRange {
  from: Time;
  to?: Time;
}

/**
 * Bars a data source changed after sending them (see `DataSource.onReset`):
 * a correction, a backfilled gap, a relisting. The chart refetches the bars
 * named here if it shows them; resets of anything else are ignored.
 */
export interface BarsReset {
  /** `SymbolInfo.symbol` of the changed bars. */
  symbol: string;
  /** Interval whose bars changed; omitted for every interval of the symbol (a split changes them all). */
  interval?: Interval;
  /** The changed bars; omitted for the whole series. */
  range?: ResetRange;
}

/**
 * Connection state of a streaming source. `reconnecting`: the stream dropped
 * and the source is trying again; `disconnected`: closed on purpose (e.g. no
 * subscriptions left). `since` is when this state began, unix seconds.
 */
export interface FeedStatus {
  state: 'connected' | 'reconnecting' | 'disconnected';
  since: Time;
}

/**
 * A time range the chart asks a data source about, other than bars: `from`
 * inclusive, `to` exclusive, like `BarsRequest`, and a signal. A request
 * object rather than positional arguments, so lookups read like `history`
 * and can gain fields without breaking sources.
 */
export interface RangeRequest {
  /** Earliest time wanted (inclusive). */
  from: Time;
  /** Times strictly before this. */
  to: Time;
  /** Aborted when the answer is no longer needed (symbol or interval switch, the chart destroyed). */
  signal: AbortSignal;
}

/**
 * Where a data source marker goes. The bar positions are those of
 * `MarkerPosition` that need no price, so a source marker reads like an
 * annotation marker: next to its bar (`above`, `below`) or in a lane along
 * the pane's edge (`top`, `bottom`). `timeAxis` is the one placement markers
 * lack, a badge in a band under the time labels, named in the camel case of
 * `atPrice`.
 */
export type SourceMarkerPosition = Extract<MarkerPosition, 'above' | 'below' | 'top' | 'bottom'> | 'timeAxis';

/**
 * An event the data source sends for a time, such as earnings, a dividend, a
 * news item or a session note. Named for what draws it, an annotation marker
 * (`BarMarker`), with the same field names; "source" tells it apart from the
 * markers the app sets, so `annotations.setMarkers` never replaces it. A
 * `timeAxis` marker draws as a badge under the time labels; badges that would
 * overlap fold into one showing their count.
 */
export interface SourceMarker {
  /** Unique among the source's markers for the symbol and interval: one fetched again with the same id replaces the old one. */
  id: string;
  /** Unix seconds. A time between two bars lands on the bar that contains it. */
  time: Time;
  /** Default `'bottom'`: the lane along the pane's bottom edge, where markers stack upwards, as data source events have no price. */
  position?: SourceMarkerPosition;
  /** Short text next to the shape or in the badge (one or two characters read best); the content of a `label`. */
  text?: string;
  /** Default: the theme's line colour; for `timeAxis`, its `timeMark` colour first. */
  color?: string;
  /** Plain text shown while hovering, never read as markup; `\n` breaks lines, as in the chart's other text fields. */
  tooltip?: string;
  /** Default `'circle'`. Ignored on the time axis, like `size`, `kind` and `severity`. */
  shape?: MarkerShape;
  /** Size multiplier (default 1). */
  size?: number;
  /** Event category, e.g. `'earnings'`, for `annotations.setMarkerFilter` and folding. */
  kind?: string;
  /** For `annotations.setMarkerFilter`'s `minSeverity`. */
  severity?: MarkerSeverity;
}

/** Plug-in market data: history, live bars and symbol lookup. */
export interface DataSource {
  /** The symbol's description; throw (or reject) when the source does not know it. */
  symbol(symbol: string): Promise<SymbolInfo>;
  /** Symbols matching a search query, for symbol search. */
  search(query: string): Promise<SymbolInfo[]>;
  /** Bars for `request`, ascending by time. */
  history(symbol: SymbolInfo, interval: Interval, request: BarsRequest): Promise<BarsResult>;
  /**
   * Stream live bars. A bar with the current last time replaces it, a newer
   * one appends, older ones are ignored. Bars sent earlier that changed are
   * reported through `onReset`, not here. Returns an unsubscribe function.
   */
  stream?(symbol: SymbolInfo, interval: Interval, onBar: (bar: Bar) => void): () => void;
  /**
   * Report bars that changed after they were sent; the chart refetches them
   * through `history`. A subscription on the source, not an argument of
   * `stream`, so that sources without a stream (REST, polling, static) can
   * report corrections too, everything that reads the source's bars (the
   * main series, other symbols' bars in indicators) refetches through one
   * path, and it works like `onStatus`. Returns an unsubscribe function.
   */
  onReset?(listener: (reset: BarsReset) => void): () => void;
  /**
   * Report connection changes. After `reconnecting` then `connected`, the
   * chart refetches the bars missed meanwhile. Returns an unsubscribe function.
   */
  onStatus?(listener: (status: FeedStatus) => void): () => void;
  /**
   * Stream the best bid and ask for the bid and ask reference lines. Each
   * quote replaces the previous one. Returns an unsubscribe function.
   */
  quotes?(symbol: SymbolInfo, onQuote: (quote: Quote) => void): () => void;
  /** The source's current time, unix seconds. */
  now?(): Promise<Time>;
  /**
   * Splits, dividends and other corporate actions taking effect in
   * `request`'s range, so the chart can back-adjust older bars (see the
   * `adjustment` chart option). Asked for after each batch of bars, over that
   * batch's span. Bars must come unadjusted when this is present. Without it
   * the bars are shown as sent. A noun, like the other lookups.
   */
  adjustments?(symbol: SymbolInfo, request: RangeRequest): Promise<Adjustment[]>;
  /**
   * Markers (see `SourceMarker`) at times in `request`'s range, for bars and
   * the time axis alike. Asked for around the visible range as the view
   * moves, afresh after every symbol or interval change and after a reset
   * (`onReset`) of the shown bars; never while the `marks` and `timeMarks`
   * options are both off. Invalid markers are dropped. Named for what draws
   * them, annotation markers.
   */
  markers?(symbol: SymbolInfo, interval: Interval, request: RangeRequest): Promise<SourceMarker[]>;
}

/** `reset`: bars refetched after the source reported a reset (`onReset`) or reconnected. */
export type DataLoadKind = 'initial' | 'history' | 'reset';

/**
 * Why the interval shown changed: `'request'`, the interval `setSymbol` asked
 * for; `'unsupported'`, the symbol does not support it and the nearest
 * supported one is shown instead.
 */
export type IntervalChangeReason = 'request' | 'unsupported';

/** Events emitted by the chart's data loading, by name: loads and failures, live bars and quotes, connection changes and resets. */
export interface DataEvents {
  'data:loading': { symbol: string; interval: Interval; kind: DataLoadKind };
  /** Bars changed after a load; `bars` is the full series now on the chart. */
  'data:loaded': { symbol: SymbolInfo; interval: Interval; kind: DataLoadKind; bars: readonly Bar[] };
  /**
   * A load failed. `error.code` is `'unknown-symbol'`, `'load-failed'`,
   * `'history-failed'` or `'reset-failed'`, with the data source's own error as `cause`; a
   * `ChartError` the source threw itself (e.g. `'invalid-interval'`) is kept.
   * `'unknown-symbol'` means the source's `symbol` threw, whatever the reason. `kind`
   * says which load failed: `'initial'`, `'history'`, or `'reset'` (a refetch
   * after a source reset, a reconnect or `chart.reload()`).
   */
  'data:error': { symbol: string; interval: Interval; kind: DataLoadKind; error: ChartError };
  /**
   * A load landed with something missing. `error.code` is
   * `'adjustments-failed'` when `adjustments` failed for the bars of that
   * load (`kind`): they show unadjusted, and the next load of the symbol and
   * interval asks again. `cause` is the data source's error.
   */
  'data:warning': { symbol: string; interval: Interval; kind: DataLoadKind; error: ChartError };
  /**
   * A load landed at another interval than the one shown before (`previous`
   * is null on the first load), or at another one than `requested`. Emitted
   * after `data:loaded`.
   */
  'interval:change': { interval: Interval; previous: Interval | null; requested: Interval; reason: IntervalChangeReason };
  /** A live bar was merged (replaced the last bar or appended). */
  'data:bar': { bar: Bar; appended: boolean };
  /** The data source sent a bid/ask quote for the current symbol. */
  'data:quote': { symbol: string; quote: Quote };
  /** The source's live stream dropped and is reconnecting; `since` is when it went down. */
  'data:reconnecting': { since: Time };
  /** The live stream is back after `gap` seconds; missed bars are refetched unless the gap is too long. */
  'data:reconnect': { gap: number };
  /**
   * Bars on screen may be out of date: an outage outlasted `maxGapFillSeconds`
   * (`reason: 'outage'`, `gap` its length), or a load failed while a cached
   * snapshot was shown and the snapshot stays (`'reconcile'`, `gap` its age).
   * Both in seconds.
   */
  'data:stale': { gap: number; reason: 'outage' | 'reconcile' };
  /**
   * A cached snapshot of the requested symbol and interval was painted while
   * its load runs (see the `cache` option). `data:loaded` follows when the
   * load lands; its bars replace the snapshot's unless they are the same.
   */
  'data:snapshot': { symbol: SymbolInfo; interval: Interval; bars: readonly Bar[]; savedAt: Time };
  /** Bars were refetched after the source reported a reset (`onReset`); `range` is undefined for the whole series. */
  'data:reset': { symbol: SymbolInfo; interval: Interval; range: ResetRange | undefined };
  /**
   * The data source's `markers` answered for `from` (inclusive) to `to`
   * (exclusive). `markers` are the valid ones it sent within that range
   * (frozen), `dropped` counts the invalid ones left out.
   */
  'sourcemarkers:loaded': { symbol: SymbolInfo; interval: Interval; from: Time; to: Time; markers: readonly SourceMarker[]; dropped: number };
  /**
   * `markers` failed: `error.code` is `'markers-failed'`, with the source's
   * error as `cause`. The chart asks again after `retryIn` ms (1, 2, 4, 8,
   * then 16 seconds); after five failures in a row `retryIn` is null and it
   * asks again only after a reset of the shown bars, turning the `marks` or
   * `timeMarks` option back on, or the next symbol or interval.
   */
  'sourcemarkers:error': { symbol: string; interval: Interval; error: ChartError; retryIn: number | null };
  /**
   * `chart.sourceMarkers` changed: a batch landed, markers far from the view
   * were let go, or they were dropped (a new load, another source, both
   * options turned off). `markers` is the new, frozen list.
   */
  'sourcemarkers:change': { markers: readonly SourceMarker[] };
}
