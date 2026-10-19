# Data source: OHLCV history and WebSocket realtime

## Today

Push model only:

```ts
candles.setData(bars);      // Bar { time (unix s), open, high, low, close, volume? }
candles.update(bar);        // same time = replace last, newer = append
chart.on('requestHistory', ({ before }) => ...);  // app prepends older bars and calls setData again
```

No symbol or interval concept, no subscription lifecycle, no reconnect handling. Every app rewrites the same glue.

## Design goals

- The app implements one small, promise-based `DataSource`. The chart owns the lifecycle: initial load, paging older history, live updates, caching, cancellation and resets.
- Conventions follow [design-principles.md](./design-principles.md): unix seconds, readable interval strings, structured sessions, tick size plus format, `AbortSignal`, returned unsubscribe functions, and capability detection by method presence.
- Generic adapters ship in this repo (REST, WebSocket, polling, static/CSV, mock). Exchange-specific adapters are community packages.

The implemented API is documented in `docs/guide/data-sources.md` (#22). This page keeps the wider plan.

## Proposed design

Promise based, seconds everywhere, unsubscribe by returned function.

```ts
type Interval = `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'M' | 'Q' | 'y'}`; // '30s', '15m', '1h', '1d', '1w', '3M', '1y'

interface DataSourceConfig {
  intervals: Interval[];       // offered in the UI; optional methods below signal other capabilities
}

interface SymbolInfo {
  symbol: string;              // key used everywhere (drawings storage, subscriptions)
  name: string;
  description?: string;
  exchange?: string;
  timezone: string;            // IANA, e.g. 'Asia/Jakarta'
  session?: SessionSchedule;   // structured weekly ranges, holidays, overrides (#24)
  tickSize: number;            // drives price precision and magnet snapping
  format?: PriceFormat;        // decimal or fractional display (price format model issue)
  volumePrecision?: number;
  intervals?: Interval[];      // overrides config
  hasIntraday?: boolean;
}

interface BarsRequest {
  from: Time;                  // inclusive
  to: Time;                    // exclusive
  limit: number;               // at most this many bars, the newest within the range
  signal: AbortSignal;         // aborted when user switches symbol/interval
}

interface BarsResult {
  bars: Bar[];                 // ascending, unix seconds
  atStart?: boolean;           // the bars reach the start of the history
}

interface DataSource {
  getConfig?(): Promise<DataSourceConfig>;
  search?(query: string, signal: AbortSignal): Promise<SymbolInfo[]>;
  symbol(symbol: string): Promise<SymbolInfo>;
  history(symbol: SymbolInfo, interval: Interval, req: BarsRequest): Promise<BarsResult>;
  stream?(symbol: SymbolInfo, interval: Interval, onBar: (bar: Bar) => void): () => void;
  // Corrections, for every source, streaming or not: { symbol, interval?, range? }.
  onReset?(listener: (reset: BarsReset) => void): () => void;
  // Events on bars and on the time axis, one item type: { id, time, position?, text?, tooltip?, ... }.
  markers?(symbol: SymbolInfo, interval: Interval, req: RangeRequest): Promise<SourceMarker[]>;
  now?(): Promise<Time>;
}
```

### Chart integration

```ts
const chart = createChart(el, { plugins: [dataSource()] }); // or builtins()
chart.setDataSource(source);
await chart.setSymbol('BTCUSD', '1h'); // resolve -> history(first) -> setData -> subscribe
await chart.setSymbol('BTCUSD', '1d'); // same symbol, new interval: unsubscribe -> history -> subscribe
chart.data?.symbol / chart.data?.interval

chart.on('symbol:change', ({ symbol }) => ...)
chart.on('interval:change', ({ interval }) => ...)
chart.on('data:loading' | 'data:loaded' | 'data:error', ...)
```

A `DataController`, which the opt-in `dataSource()` plugin gives the chart, owns the lifecycle:
- `requestHistory` handled internally: calls `history({ to: firstBar.time, limit: 300 })` and prepends; stops after `atStart`.
- One in-flight history request at a time; `AbortController` cancels on symbol/interval change; stale responses are ignored by a request generation counter.
- Realtime bars that arrive before history finishes are buffered, then merged.
- Without `setDataSource`, the push API (`setData`, `update`) keeps working unchanged. A chart without the `dataSource()` plugin leaves the controller out of its bundle, and `setDataSource(source)` throws `not-registered`.

### Realtime merge rules

Applied in `CandleSeries.update` (some already are):

| Incoming `bar.time` vs last | Action |
| --- | --- |
| equal | replace last bar |
| greater | append; if gap > 1 interval and session expects bars, request missing range or report a reset through `onReset` |
| less | drop, count in a debug counter (out of order) |

A reset without a range → clear series cache, refetch visible range with `limit`, keep viewport anchored to the right edge.

Indicators and dependent panes (volume, CVD) must update from the same merged bar (see custom-series.md).

### WebSocket adapter (helper in core or a separate `@chart-on/feeds` package)

```ts
const source = createWebSocketDataSource({
  url: 'wss://example.com/stream',
  history: (symbol, interval, req) => fetchJson(`/api/bars?...`, req.signal), // REST for history
  subscribeMessage: (symbol, interval) => ({ op: 'subscribe', channel: `bars.${interval}.${symbol}` }),
  unsubscribeMessage: (symbol, interval) => ({ op: 'unsubscribe', channel: `bars.${interval}.${symbol}` }),
  parse: (msg) => ({ key: msg.channel, bar: toBar(msg.data) }),   // or null to ignore
  heartbeat: { intervalMs: 15000, message: { op: 'ping' } },
});
```

Behaviour:
- One socket shared by all subscriptions; subscription map `key -> listeners`.
- Reconnect with exponential backoff (1s → 30s, jitter); resend all subscriptions on open. The adapter reports `onStatus` changes and the controller refetches the missed bars, or emits `data:stale` past `maxGapFillSeconds` (done in #168).
- Stall watchdog: no message for 2× heartbeat → close and reconnect.
- Pause on `document.hidden` optional; resume with reset.
- Validate every message (finite numbers, `high >= max(open, close)`, `low <= min(open, close)`, time aligned to the interval). Drop invalid ones.
- Cap message size; never `eval`; JSON parse in try/catch.

Trade-stream variant: if the server sends trades instead of klines, `createBarBuilder({ interval, timezone, session })` builds bars (shipped; `aggregateTrades` was already taken by the trade-marker helper): bucket `floor(ts / interval) * interval`, open = first, high/low running, close = last, volume sum. Daily/weekly buckets respect `SymbolInfo.timezone` and session. `tradesToBars` and `resampleBars` cover batches and building longer intervals from shorter ones.

### Polling adapter

`createPollingDataSource({ history, pollMs })` (shipped; `pollMs` rather than `intervalMs`, so it is not confused with the bar interval) for HTTP-only sources: every tick fetch `limit: 2`; send, oldest first, every bar that is new or differs from the version sent last; if the bar sent last is missing, report a reset from it.

### Markers

Shipped as `markers(symbol, interval, { from, to, signal })` (#859): `SourceMarker { id, time, position?, text?, color?, tooltip?, shape?, size?, kind?, severity? }`, drawn as annotation markers on the bar, or as a badge on the time axis with `position: 'timeAxis'`; `chart.sourceMarkers`, `sourcemarkers:*` events. Refetched through `onReset`. Use for insider trades, news, dividends.

## Tests to add

- Merge rules (equal/greater/less, gap).
- Symbol switch aborts in-flight `history`; stale response ignored.
- History stops after `atStart`.
- WebSocket adapter with a fake socket: reconnect resubscribes, reset called, invalid message dropped.
- Trade aggregation bucket edges and timezone daily boundary.
