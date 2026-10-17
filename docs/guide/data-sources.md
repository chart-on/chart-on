---
description: "Load bars through a data source: initial load, history paging, live bars, caching and the built-in adapters."
---

# Data sources

Instead of pushing bars with `setData` and `update`, give the chart a data source. The chart then loads the initial bars, pages in older history as the user scrolls back, merges live bars and caches what it loaded per symbol and interval.

Loading through a source needs the `dataSource()` plugin, or `builtins()`; the UI shell adds it. Without it `setDataSource` throws a [`not-registered`](./errors#not-registered) `ChartError`, so a chart that only gets bars through `setData` leaves the loading code out of its bundle.

```ts
import { createChart, dataSource } from '@charton/core';

const chart = createChart(el, { plugins: [dataSource()] });
```

<!-- example: data-source -->

Call `setSymbol` again to switch interval or symbol: the request in flight is cancelled and live updates move to the new stream. `setSymbol` rejects when loading fails. Without a candle series the chart adds one. The push API keeps working when no data source is set.

## Intervals

An interval is a count and a unit: `s`, `m`, `h`, `d`, `w`, or the calendar units `M` (month), `Q` (quarter) and `y` (year). A bare unit counts one, so `'d'` is `'1d'`. The `Interval` type spells this out, so a typo in a literal such as `'1x'` does not compile; turn an app's own string into one with `isInterval`:

```ts
import { isInterval, intervalSeconds, parseInterval } from '@charton/core';

if (isInterval(picked)) await chart.setSymbol('ABC', picked);
intervalSeconds('15m');   // 900, the nominal length
parseInterval('4h');      // { count: 4, unit: 'h' }
```

`setSymbol` checks the interval before it asks the data source anything: one it cannot parse rejects with a [`ChartError`](./events#errors) whose code is `'invalid-interval'`, and the chart keeps showing what it showed.

### Intervals a symbol supports

When `symbol` returns `intervals`, the chart only loads one of them. Asked for another, it loads the supported interval nearest in length (compared as a ratio, so `1h` is as far from `30m` as from `2h`; a tie goes to the shorter one) and says so with `interval:change`:

```ts
chart.on('interval:change', ({ interval, previous, requested, reason }) => {
  // reason 'unsupported': `requested` is not supported, `interval` is shown instead.
  picker.value = interval;
});
chart.data?.supportedIntervals; // the symbol's intervals the chart can parse, or null for any
```

`interval:change` follows `data:loaded` whenever a load lands at another interval than before (`previous` is null on the first load), and whenever the requested interval was replaced, even by the one already shown. An empty `intervals` list, or one without a single valid entry, means any interval.

### Calendar intervals

Bars of `M`, `Q` and `y` follow the calendar in the symbol's `timezone` (UTC when it has none): a month bar starts at midnight on the 1st, a quarter in January, April, July or October, and several months (`'6M'`) or years (`'2y'`) are counted from January of year 0. So months are 28 to 31 days long, and DST can make one an hour shorter or longer. Their nominal length, used for comparisons only, is 30, 90 and 365 days.

The chart relies on this in two places. A live bar whose time falls inside the open calendar bar updates that bar, instead of adding a new one, so a source that stamps live bars with the trade time still works. And the countdown runs to the next calendar boundary. History requests never derive a time range from the interval's length: older pages ask for at most `limit` bars before `to`.

`intervalStart(time, interval, zone, open)` and `nextIntervalStart(start, interval, zone)` do the same calendar math for a data source that builds its own bars. `open` is the session open in seconds after midnight, so a bar opening at 09:30 starts at 09:30 on its first day; the next bar keeps the time of day of the one before.

### Trade and volume intervals

Two more units count activity instead of time: `T` makes a bar every `count` trades (`'100T'`) and `V` every `count` units of traded volume (`'5000V'`). They describe the same bars as `createBarBuilder({ ticks: 100 })` and `{ volume: 5000 }` (see [Bars from trades](#bars-from-trades-and-from-shorter-intervals)), so a data source that builds bars from trades can offer them in its symbol's `intervals`. `isActivityInterval` tells them apart:

```ts
import { intervalSeconds, isActivityInterval, parseInterval } from '@charton/core';

parseInterval('100T');      // { count: 100, unit: 'T' }
isActivityInterval('100T'); // true
intervalSeconds('100T');    // throws a ChartError 'invalid-interval': no length
```

These bars have no length in seconds, so:

- `intervalSeconds` throws for them; anything that tolerates them gets `null` from the chart instead (drawings and indicators asking for the bar length, for example).
- The countdown under the last price is hidden: the bar closes on activity, not on time.
- The time axis already places bars by index and labels each with its `time` (its first trade), so uneven spacing needs nothing.
- They are never part of an interval range (`{ from: '1m', to: '59m' }`), a higher-interval series or grouping steps, and they do not bucket through `barBucket`. An indicator set fits them only when it has no `appliesOn` scope.
- When a symbol's `intervals` do not list the activity interval asked for, the chart loads the listed one of the same unit nearest in count, else the shortest listed time interval; looking for the nearest time interval never picks an activity one. It always loads a listed interval.
- The built-in mock and exchange data sources make time bars only: asked for an activity interval, they reject with an `invalid-interval` `ChartError`.
- A persistent cache keeps their snapshot for 10 minutes.
- The `intervals` toolbar preset of `@charton/ui` shows them as "100 trades" and "5K volume" under their own headings, and only while the current symbol lists them ([toolbar presets](./ui-shell#presets)).

### The symbol's timezone

With `applySymbolTimezone: true` the chart shows each symbol in its `timezone`, and in the chart's own `timezone` when the symbol has none. Setting `timezone` with `applyOptions` while it is on keeps that timezone for later symbols too, until `applySymbolTimezone: true` is set again:

```ts
const chart = new Chart(el, { timezone: 'UTC', applySymbolTimezone: true });
await chart.setSymbol('ABC', '1d');           // shown in America/New_York
chart.applyOptions({ timezone: 'Asia/Tokyo' }); // the user picked Tokyo: it stays
chart.applyOptions({ applySymbolTimezone: true }); // follow the symbol again
```

## Loading state and events

```ts
chart.data?.loading;         // true while a load, history page or reset is in flight
chart.data?.initialLoad;     // the setSymbol load in flight, or null
chart.data?.symbol;          // SymbolInfo now shown
chart.data?.interval;
chart.data?.requested;       // { symbol, interval } of the last setSymbol, even while it loads
chart.data?.supportedIntervals; // the symbol's intervals, or null for any
chart.data?.hasMoreHistory;  // false once the source reported atStart

chart.on('data:loading', ({ symbol, interval, kind }) => showSpinner(kind));
chart.on('data:loaded', ({ symbol, interval, kind, bars }) => hideSpinner());
chart.on('data:error', ({ kind, error }) => console.error(error));
chart.on('data:bar', ({ bar, appended }) => updateHeader(bar));
```

`kind` is `'initial'`, `'history'` or `'reset'` (bars refetched after a [correction or reconnect](#corrections-and-reconnects)). `data:loaded` carries the whole series now on the chart. Series that are a per-bar mapping of the main bars, such as volume, need no event code: give them a [`follow`](./series#series-derived-from-the-bars) mapper and the chart keeps them in step. Rebuild anything else derived from the bars here.

## Compare symbols

Plot other symbols next to the main one. Each compared symbol loads and streams through the same data source, follows the main symbol's interval, and pages in history to match the main series. `chart.compare` is [opt-in](./features#opt-in-features): it needs the `comparisons()` plugin (or `builtins()`), and throws a [`not-registered`](./errors#not-registered) `ChartError` without it. The UI shell adds it for you.

```ts
const gold = chart.compare('XAUUSD');                     // percent overlay on the main pane
const index = chart.compare('IND50', { mode: 'scale' });  // its own left price axis
const fx = chart.compare('USDJPY', { mode: 'pane', color: '#22d3ee' });
const oil = chart.compare('OIL', { mode: 'pane', style: 'candles' }); // candles instead of a line

await gold.ready;          // settles after its first load (which waits for the main symbol)
gold.series.applyOptions({ lineWidth: 2 });
gold.serialize();          // { symbol: 'XAUUSD', mode: 'percent', style: 'line', color: '#f59e0b' }
gold.setMode('pane');      // moves it to a pane of its own, keeping its bars and this handle
gold.remove();             // removes the line and unsubscribes
chart.compared;            // every compared symbol
```

| Mode | Shows |
| --- | --- |
| `percent` (default) | A line on the main pane. The main price scale switches to percent mode, and both lines are measured from their first visible bar on one shared percent axis. |
| `scale` | A line on the main pane with its own left price axis, in its own units. |
| `pane` | A line in a new pane. |

- A compared symbol is a line of closes with its own symbol info, price format, colour and legend row.
- `style: 'candles'` or `'bars'` draws it as candles or OHLC bars instead (`series` is then a candle series), in `scale` and `pane` modes; `percent` mode takes lines only. In a new pane they use the theme's rising and falling colours. On the main pane, beside the main candles, both directions take the compare `color`, with falling bodies faded, so the two symbols read apart.
- It is aligned on the main timeline. A bar whose time falls between main bars moves into the main bar it falls in (the last one wins for a line; candles merge: first open, highest high, lowest low, last close), and main bars it has no data for leave gaps in its line (the `breakGaps` line option).
- In `percent` mode the comparison needs the main scale in percent or indexed mode. If you switch the main scale back to normal or log, the compared line takes that mode too and fits its own range, so it only shows its shape. Removing the last percent comparison restores the mode the main scale had before.
- A synthetic pair plots two symbols combined bar by bar: `compare({ ratio: ['GOLD', 'SILVER'] })` shows gold in silver, `compare({ spread: ['A', 'B'], weights: [2, 1] })` shows `2 × A − B`. Open and close come from the legs' opens and closes; high and low from their highs and lows, widened to include open and close (an approximation, since the legs' extremes need not happen together). A time where either leg has no bar, or a ratio would divide by zero, is a gap. Both legs load, page and stream like a single compared symbol, and `remove()` unsubscribes both. The handle's `symbol` is the pair's name (`'GOLD/SILVER'`, `'2*A-B'`), `pair` the pair, `info` the first symbol's info, and `serialize()` includes `pair`.
- `setMode(mode)` moves a compared symbol between modes without reloading it: the series, its bars, its legend row and the handle stay the same. It fires `panes:change` (a pane is added or removed as needed), never `series:remove` or `series:add`. Leaving the main pane remembers the row's place there, and going back to `pane` mode puts the pane back where it was, at its height. Candles and bars take only `scale` and `pane`. After `remove()` it does nothing.
- Load failures emit `compare:error` with the symbol and the error (for a pair, the leg that failed).
- Changing the data source removes compared symbols.

## Market and data status

With the `marketStatus()` plugin (in `builtins()`), the chart works out the market phase from its `session` option (regular hours) and an optional `extendedSession` (pre- and post-market around them), in the chart's `timezone`. Without the plugin `chart.marketStatus()` throws a [`not-registered`](./errors#not-registered) error and the legend shows no badge; `marketPhase` works without it:

```ts
import type { SessionSchedule } from '@charton/core';

// The same hours Monday to Friday.
const weekdays = (start: string, end: string): SessionSchedule => {
  const day = [{ start, end }];
  return { weekly: { mon: day, tue: day, wed: day, thu: day, fri: day } };
};

chart.applyOptions({
  timezone: 'America/New_York',
  session: weekdays('09:30', '16:00'),
  extendedSession: weekdays('04:00', '20:00'),
});
// Without an argument it uses the current time. At 08:30 in New York on Wednesday 2024-03-06:
chart.marketStatus(Date.parse('2024-03-06T13:30:00Z') / 1000);
// → { phase: 'pre', next: { phase: 'open', time: 1709735400 }, delay: 0 } (09:30 New York)
```

- `phase` is `pre`, `open`, `post` or `closed`; `next` is the next change within three weeks. Holidays, one-day overrides, overnight sessions and DST changes are taken into account. Without a session the market is always open.
- Extended hours are pre-market until regular hours open in the same stretch, and after hours once they have closed in it, so one extended range can cover both (e.g. `weekdays('00:00', '24:00')`). An always-open `extendedSession` (`ALWAYS_OPEN`) means extended hours around the clock.
- `delay` comes from the symbol info: `delay: 15` for data 15 minutes behind, `'eod'` for end-of-day data.
- The main pane's legend shows both as a badge, e.g. "Pre-market · 15 min delayed" (turn it off with the `marketStatus` option). `marketPhase(regular, extended, zone, now)` is exported for your own UI; `regular` and `extended` take a `SessionSchedule` or a `CompiledSession`.

The chart also shows the project mark assembling itself in the centre of the plot area while the first bars load, and a centred message when a symbol has no data, when loading fails, and for an expired contract (`expired: true` in the symbol info). A failed load shows "Could not load data"; the data source's error message is kept in `chart.getStatus().detail` rather than shown. While the live stream is down it shows "Reconnecting…", and after an outage too long to patch "Data may be out of date" (see [Corrections and reconnects](#corrections-and-reconnects)). Apps can set the message themselves with `chart.setStatus({ kind: 'loading' | 'no-data' | 'error' | 'unknown-symbol' | 'expired' | 'reconnecting' | 'stale', message?, detail? })` and clear it with `chart.setStatus(null)`. Every change fires `status:change`; a listener that calls `preventDefault()` hides the chart's text so you can show your own view (the UI shell's [`loading` and `empty` slots](./ui-shell#slots) do this). The chart never sets `unknown-symbol`, since a data source reports every failure the same way: set it from your app when your source knows a symbol does not exist, e.g. on `data:error`. The mark's three steps wipe in, its square grows into place, and it fades out, every 3 seconds (it stays still and complete with reduced motion). It keeps "Loading…" (`statusLoading`) as the status's accessible name, and the watermark and the mark it may carry are left out while it shows; a `loading` status with a `message` of its own shows that text instead.

## Options

```ts
chart.setDataSource(source, {
  initialBars: 1000, // bars requested on the first load
  pageBars: 500,     // bars per page of older history
  cacheSize: 8,      // symbol + interval combinations kept in memory
  maxGapFillSeconds: 3600, // longest outage patched on reconnect
  cache: null,       // persistent snapshot store, see below
});
```

Switching back to a cached symbol and interval shows the cached bars and fetches only the bars that are newer. If more than a page is missing it reloads.

### Paint ahead from a persistent cache

The memory cache dies with the page. With a `cache` adapter, the chart also keeps a snapshot of the newest window of each symbol and interval (the bars of an initial load, live bars included) in persistent storage. The next load of that symbol and interval, after a reload too, paints the snapshot at once while the source is asked as usual:

```ts
import { createIndexedDbCache } from '@charton/core';

chart.setDataSource(source, { cache: createIndexedDbCache({ namespace: `user-${userId}` }) });
chart.on('data:snapshot', ({ savedAt }) => showBadge(`cached ${ago(savedAt)}`));
chart.on('data:loaded', hideBadge);
```

- The snapshot is never authoritative. The load always runs; its bars replace the snapshot's, and if they are the same nothing is repainted. `data:snapshot` fires when a snapshot is painted, and the loading indicator is left out meanwhile.
- If the load fails while a snapshot shows, the snapshot stays: `setSymbol` rejects and `data:error` fires as usual, followed by `data:stale` with `reason: 'reconcile'` and the snapshot's age as `gap`. The chart shows "Data may be out of date" instead of the error.
- Snapshots are written after each successful first load and when switching to another symbol or interval, under the symbol and interval `setSymbol` was given. They expire after about 200 bars' worth of time (at least 10 minutes, at most 30 days); expired entries and entries from another storage format version are ignored.
- Storage errors (quota, private mode, no IndexedDB) are swallowed: the chart loads as if nothing was cached.
- `chart.data.clearCache()` clears the adapter's namespace too, e.g. on logout or a user switch; `clearCache(symbol, interval)` removes that one entry. Use a per-user `namespace` for data that depends on the user's entitlements.
- Only data loaded through a data source is cached; series filled with `setData` never are.

`createMemoryCache()` keeps snapshots in memory instead (useful in tests), and any object with async `get`, `set`, `delete` and `clear` works as an adapter.

A snapshot only helps when the source returns the same bars for the same request. A custom source should be deterministic: the same symbol, interval and range give the same bars, so an unchanged snapshot is not repainted and a changed one really is newer data.

## Corrections and reconnects

A live feed is not append-only. Servers republish corrected bars, a socket loses the bars sent while it was down, and a symbol can be relisted with new history. The chart handles all three by refetching through `history`.

**Corrections.** Report bars you already sent that changed through the optional `onReset(listener)`. The chart subscribes once, like `onStatus`, and the listener gets a `BarsReset`: `{ symbol, interval?, range? }`. `symbol` is the `SymbolInfo.symbol` of the changed bars, `interval` is omitted when every interval changed (a split, say), and `range` is omitted when the whole series did:

```ts
const resets = new Set<(reset: BarsReset) => void>();
const feed = openFeed();
feed.on('corrected', ({ symbol, interval, from, to }) => {
  for (const listener of resets) listener({ symbol, interval, range: { from, to } }); // just those bars
});
feed.on('relisted', ({ symbol }) => {
  for (const listener of resets) listener({ symbol }); // everything, at every interval
});

const source: DataSource = {
  // symbol, search, history, stream...
  onReset(listener) {
    resets.add(listener);
    return () => resets.delete(listener);
  },
};
```

The subscription belongs to the source rather than to `stream` for three reasons: sources without a stream (REST, polling, static) can report corrections too; everything that reads bars (the main series, other symbols' bars in indicators) refetches through one path; and it works like `onStatus`.

- The chart refetches only the symbol and interval it shows (or is loading), and an indicator only the other symbols' bars it reads; resets of anything else are ignored.
- Without a range, the chart drops its cached series and loads it again: as many bars as it had, and at least the initial count. History paging starts again from the new first bar.
- With a range (`from` inclusive, `to` exclusive, `to` omitted for "up to the newest bar"), it asks for one page in that range and replaces only the bars inside it. A range that holds a page or more is treated as a full reset, and so is a malformed one (not finite, or `to` at or before `from`).
- The view keeps its right edge. Live bars that arrive during the refetch are merged after it, so the forming bar keeps its live value.
- Several resets can be in flight at once. Their responses apply in the order the resets were requested: a slow older response never overwrites bars from a newer reset that landed first.
- A reset during the first load runs once that load lands. A reset of a symbol or interval the chart no longer shows (after a switch) is ignored. A full reset drops a history page in flight; scrolling back loads it again. A range reset does not: the page still lands, since it only adds bars older than any the chart has.
- Each reset emits `data:loading` and `data:loaded` with `kind: 'reset'`, then `data:reset { symbol, interval, range }`.

**Reconnects.** A source with a live stream can report its connection with the optional `onStatus(listener)`. The listener gets `{ state, since }`, where `state` is `'connected'`, `'reconnecting'` or `'disconnected'` and `since` is when that state began, in unix seconds. Use `disconnected` only for a stream closed on purpose, e.g. nothing left to subscribe. The WebSocket and mock adapters implement it.

- On `reconnecting` the chart emits `data:reconnecting { since }` and shows "Reconnecting…". A reset that lands while the stream is still down keeps the message. A drop during the first load does not cover the loading indicator; the message appears once the bars land if the stream is still down (a "no data", error or expired message stays instead).
- On `connected` it emits `data:reconnect { gap }` with the outage in seconds. It then fetches the bars from the last one it has up to now and merges them. The source wins on equal times; the forming bar keeps any live value that arrived meanwhile. A reconnect during the first load fills its gap once that load lands.
- If the outage was longer than `maxGapFillSeconds` (one hour by default), it fetches nothing and emits `data:stale { gap }`. `chart.data.stale` turns true, and the pane shows "Data may be out of date" until a reload, a full reset or a switch loads fresh bars.
- The outage is measured in wall-clock time from the `since` of `reconnecting` to that of `connected`, without regard to trading sessions. An outage spanning a closed session (overnight, a weekend) can exceed the limit and show stale although no bars were missed; raise `maxGapFillSeconds` or reload if that matters for your market.

**Reloading.** Force a fresh load yourself:

```ts
await chart.reload();                   // the current symbol and interval, without the cache
await chart.reload({ keepView: true }); // ...and keep the visible time range
chart.data?.clearCache();               // forget every cached series
chart.data?.clearCache('ABC');          // ...or one symbol's, or one symbol and interval's
chart.data?.connection;                 // the source's last { state, since }, or null
```

`reload()` aborts requests in flight like a symbol switch and emits a single `data:loaded` (`kind: 'initial'`). Without `keepView` it shows the newest bars. Compared symbols reload too, without their cache. `clearCache` leaves the series on screen alone; switching back to a cleared series loads it afresh.

## Splits and dividends

A stock's history has jumps that are not price moves: after a 4-for-1 split every price is a quarter of what it was, and an ex-dividend day drops by the dividend. To compare old prices with new ones, charts usually back-adjust the history. Send the bars unadjusted, and add `adjustments` to your data source:

```ts
const source: DataSource = {
  // ...symbol, search, history as usual
  async adjustments(symbol, { from, to, signal }) {
    const res = await fetch(`${baseUrl}/actions?symbol=${symbol.symbol}&from=${from}&to=${to}`, { signal });
    return (await res.json()) as Adjustment[];
  },
};

chart.applyOptions({ adjustment: 'splits' }); // or 'all', or 'none' (default)
```

Each adjustment is `{ time, kind: 'split' | 'dividend' | 'other', factor, label? }`. `factor` multiplies the prices of every bar before `time`: `0.25` for a 4-for-1 split, `(close - dividend) / close` of the day before for a dividend. A split also divides earlier volumes by its factor. The chart asks for the adjustments taking effect within each batch of bars it loads (`from` inclusive, `to` exclusive), after the first load and after each history page.

| `adjustment` | Applies |
| --- | --- |
| `'none'` (default) | Nothing: the bars as sent |
| `'splits'` | Splits only |
| `'all'` | Splits, dividends and other actions |

Adjusting and marking need the `adjustments()` plugin (or `builtins()`); without it the bars show as sent. Switching `adjustment` re-scales the loaded bars without fetching anything and keeps the view; indicators recompute on the adjusted bars. A source without `adjustments` is shown as sent whatever the option. For bars you push yourself, `adjustBars(bars, adjustments, mode)` and `adjustBar(bar, adjustments, mode)` from `@charton/core` do the same arithmetic.

Drawings on the main pane stay on the bars they were drawn on: when the option changes, or loading reveals another adjustment (an older split a history page brings), their points are re-priced with the bars, undo history included. `chart.drawings` reports the prices on screen, while `drawings.serialize()` writes the prices as your source sent them and `drawings.load()` reads them that way, so a saved layout lands on the same bars under any option. Save with `serialize()` rather than from `drawings:change` payloads. Charts in a link group that mirrors drawings put each copy on the same bars, even when their `adjustment` options differ.

Annotations pinned to a bar follow it the same way, without changing what you passed: their prices are read as your source sends them, and they draw at the adjusted price of their bar on the main pane. That covers `atPrice` bar markers (at the marker's `time`), trade fills (at their bar), text labels (at their `time`) and price zones that end at a bar (`toTime`). `getMarkers()`, `getTrades()` and the handles' options keep returning your prices, trade events and tooltips keep the traded price, and nothing needs re-sending when the option changes or a split loads. Shape plots of indicators already sit on the adjusted bars and are left alone. Lines without a time stay at their price: alert, price, order and position lines, and price zones that reach the latest bar, are levels of the live price, which no adjustment changes (the bars after the newest action are shown as sent).

The adjustments are marked on the main series, in the bottom lane of its pane, whatever `adjustment` applies: a lettered label (`S` split, `D` dividend, `C` other) whose tooltip shows the action's `label` (or its kind) and its factor. Their `kind` is the action's, so `chart.annotations.setMarkerFilter({ kinds: ['split'] })` keeps only the splits, and `marker:hover` and `marker:click` report them with ids `adjustment:<kind>:<time>`. They are the chart's own markers: `annotations.getMarkers()`, `setMarkers()` and `clear()` leave them alone. Set `adjustmentMarkers: false` to hide them. The text is localizable (message keys `adjustmentSplitShort`, `adjustmentSplit`, `adjustmentDividendShort`, `adjustmentDividend`, `adjustmentOtherShort`, `adjustmentOther` and `adjustmentFactor`).

If `adjustments` throws or rejects, the bars still load, unadjusted for that batch: the chart emits `data:warning` with a `ChartError` of code `adjustments-failed` (your error as `cause`) and `kind` telling which load it was, and notifies the user (`ui:notify`, message key `adjustmentsFailed`) while `adjustment` is not `'none'`. The next load of that symbol and interval asks again rather than reusing the cached bars.

## Markers

Markers are events the data source sends for a time, rather than ones the app sets: earnings, dividends, news, a contract roll, a session note, a scheduled release. The chart fetches them with the `sourceMarkers()` plugin and draws them through [annotations](./annotations), so it needs both `sourceMarkers()` and `annotations()` (or `builtins()`) to show them; the corporate action markers above need `annotations()` too. Add `markers` to your source. Like `history`, it takes a request object:

```ts
const source: DataSource = {
  // ...symbol, search, history as usual
  async markers(symbol, interval, { from, to, signal }) {
    const res = await fetch(`${baseUrl}/events?symbol=${symbol.symbol}&from=${from}&to=${to}`, { signal });
    const events = (await res.json()) as { id: string; time: number; title: string; detail: string; kind: string }[];
    return events.map((e) => ({
      id: e.id,
      time: e.time,
      // Calendar entries go on the time axis; the rest on their bar.
      position: e.kind === 'calendar' ? 'timeAxis' : 'bottom',
      text: e.kind[0]!.toUpperCase(),
      tooltip: `${e.title}\n${e.detail}`,
      kind: e.kind,
    }));
  },
};
```

A marker is `{ id, time, position?, text?, color?, tooltip?, shape?, size?, kind?, severity? }`, with the field names of a [bar marker](./annotations#bar-markers), which is what draws it. `position` says where it goes:

- On its bar: a `'circle'` in the `'bottom'` lane unless `shape` and `position` (`'above'`, `'below'`, `'top'` or `'bottom'`) say otherwise. Several markers on one bar stack, and `annotations.setMarkerFilter` and marker folding apply to them as to the app's own markers (so filter by `kind` to hide them). They live in a set of their own: `annotations.setMarkers` and `annotations.clear()` leave them alone.
- `'timeAxis'`: a small round badge in a band under the time labels instead of in the pane, for anything that belongs to a moment rather than to a bar's prices. `text` is shown in the badge (one or two characters fit) and `color` fills it (default the theme's `timeMark`, else its `line` colour); `shape`, `size`, `kind` and `severity` are ignored. A badge lands on the bar that contains its time; one after the last bar sits at its time on the projected axis to the right of the bars (visible with a `rightOffset`), and one before the first loaded bar is not drawn. Badges that would overlap fold into one showing their count; its tooltip lists every folded marker, and a click reports them all. Once the source has sent a `timeAxis` marker (and while the time axis is shown), the time axis is 24 css px taller than `timeAxis.height` to hold the band, so the badges never cover a label; the labels keep `timeAxis.height`. The band stays until another data source is set, so the layout does not jump as you pan or switch symbols.

Hovering a marker shows its `tooltip` as plain text, never markup; `\n` breaks it into lines, as in the chart's other text fields. A `color` the canvas cannot read is ignored, so the default colour draws the marker.

When the chart asks:

- After each symbol or interval load lands, for the visible range padded by its width on each side (`from` inclusive, `to` exclusive, unix seconds). The previous markers go as soon as the load starts, and stay gone if it fails.
- As the user pans or zooms, for the part of the padded view not fetched yet. One request runs at a time, started after the frame that moved the view; small pans ask for nothing. A request never spans much more than a few view widths: after a far jump the chart asks around the new view only, not for the gap.
- After the source reports a [reset](#corrections-and-reconnects) of the shown bars (`onReset`), for the visible range again; the answer replaces the known markers. This is the way to refetch them: a source whose events changed reports a reset of the symbol (and interval, or every interval), the same path as corrected bars.
- Never while the `marks` and `timeMarks` options are both off. Turning both off drops the markers; turning one back on asks for the view.
- `signal` aborts when the answer is no longer wanted (another load, a reset, both options turned off, `chart.destroy()`).

A marker fetched again with the same `id` replaces the old one, so ids must be unique across both placements. Markers outside the range asked for are ignored. Markers with a missing or empty `id`, a time that is not a finite number, or a field of the wrong type (a `tooltip` array included) are dropped; `sourcemarkers:loaded` counts them in `dropped`. The chart keeps the markers within three view widths of the view on each side and lets the others go, so memory stays bounded; scrolling back asks for them again.

```ts
chart.on('sourcemarkers:loaded', ({ from, to, markers, dropped }) => console.log(markers.length, 'markers', dropped, 'dropped'));
chart.on('sourcemarkers:click', ({ markers, point }) => openEvent(markers[0]!.id, point));
chart.on('sourcemarkers:change', ({ markers }) => renderEventList(markers));

chart.sourceMarkers; // every marker known for the shown symbol and interval, by time, both placements (frozen)
chart.applyOptions({ marks: false }); // hide the ones on bars; timeMarks: false hides the badges and their band
```

`sourcemarkers:click` carries copies of the clicked marker, or of every marker folded into it or into its badge, and the pointer in chart-root css px. While it has listeners, a press on a marker never pans the chart, and a press released on a badge without moving is a click (one that travels past the click slop drags the time axis as usual); without them, markers only show their tooltips. Each badge takes the pointer within 12 css px of its centre (a 24 px target). Badges are not reachable from the keyboard yet. Source markers emit no `marker:*` events.

`chart.sourceMarkers` is a frozen array of frozen markers, and so are the `markers` of `sourcemarkers:loaded` and `sourcemarkers:change`. `sourcemarkers:change` fires whenever `chart.sourceMarkers` changes: a batch landed, markers far from the view were let go, or they were dropped (a new load, another data source, both options turned off). With only one option off the markers are still fetched, so the getter and its events keep working.

If `markers` throws or rejects, the chart emits `sourcemarkers:error` with a `ChartError` of code `markers-failed` (your error as `cause`) and `retryIn`, the milliseconds until it asks again: 1, 2, 4, 8, then 16 seconds. After five failures in a row `retryIn` is `null` and it asks again only after a reset of the shown bars, turning an option back on, or the next symbol or interval change. A success resets the count. The bars are not affected.

## Built-in adapters

| Adapter | For |
| --- | --- |
| `createMockDataSource(options)` | Demos and tests: a deterministic simulated market with live ticks. Each symbol has one price path, so every interval agrees (a 1h bar is the aggregate of its 1m bars) and prices stay around `startPrice` |
| `createStaticDataSource({ symbols, bars })` | Bars already in memory, e.g. from `parseCsv(text)` |
| `createRestDataSource({ url, map, symbols })` | History over HTTP |
| `createWebSocketDataSource({ url, history, subscribeMessage, parse })` | Live bars over one shared socket, with history from another source |
| `createPollingDataSource({ history, pollMs })` | Live bars for HTTP-only sources, by polling the newest bars |
| `createOhlcvDataSource(exchange, options)` | An exchange object from a unified exchange library: history, symbols and live bars (see [Exchange libraries](./exchange-libraries)) |
| `createDataSourceRouter(routes, options)` | Several feeds behind one source, chosen by a symbol prefix such as `FEED-A:` (see [Several feeds in one chart](#several-feeds-in-one-chart)) |

```ts
type RawBar = [time: number, open: number, high: number, low: number, close: number, volume: number];

const rest = createRestDataSource({
  url: (symbol, interval, req) =>
    `https://api.example.com/bars?symbol=${symbol.symbol}&interval=${interval}` +
    `&limit=${req.limit}${req.to ? `&end=${req.to}` : ''}`,
  map: (json) => (json as RawBar[]).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume })),
  symbols: [{ symbol: 'ABC', name: 'ABC', precision: 2 }],
});

const live = createWebSocketDataSource({
  url: 'wss://stream.example.com',
  history: rest,
  subscribeMessage: (symbol, interval) => ({ op: 'subscribe', channel: `bars.${interval}.${symbol.symbol}` }),
  unsubscribeMessage: (symbol, interval) => ({ op: 'unsubscribe', channel: `bars.${interval}.${symbol.symbol}` }),
  key: (symbol, interval) => `bars.${interval}.${symbol.symbol}`,
  parse: (msg) => {
    const m = msg as { channel?: string; bar?: Bar };
    return m.channel && m.bar ? { key: m.channel, bar: m.bar } : null;
  },
});
```

The WebSocket adapter opens the socket on the first subscription and closes it after the last one. When the connection drops it reconnects with exponential backoff (1 to 30 seconds by default) and resubscribes. The backoff starts over only once a connection has stayed open for the shortest delay, so a server that accepts and drops the connection at once is retried less and less often. It reports the connection through `onStatus`, so the chart fills the gap. The mock adapter's `setConnected(false)` and `setConnected(true)` simulate an outage. Messages are parsed as JSON when possible; bars that fail validation are dropped by the chart and reported through `data:dropped`.

`parseCsv` reads `time,open,high,low,close[,volume]` rows. A header row may name the columns in any order (`date` or `timestamp` work for the time), and times may be unix seconds, milliseconds or ISO dates. Rows come back sorted by time. Invalid rows are skipped and of rows sharing a time the last one is kept; pass `onDrop(bar, reason)` in the options to hear about both. `createStaticDataSource` only sorts its bars, so the chart reports anything it leaves out through `data:dropped`.

### Polling an HTTP API

When a source has no stream, `createPollingDataSource` turns its history into live bars. Each poll asks the `history` source's `history` method for the newest bars (`kind: 'refresh'`, `from` the bar sent last, `limit` 2 unless you pass more) and sends what changed to the chart. The next poll starts `pollMs` after the previous one finished, so slow responses never pile up.

```ts
const polled = createPollingDataSource({ history: rest, pollMs: 5000 });
```

The rule follows from the chart's streaming contract, where a bar with the last time replaces it and a newer one appends:

- Each poll sends, oldest first, every bar that is new or differs from the version sent last. A late trade in the previous bar so arrives before the next bar opens, and a bar that did not change is not sent again.
- If the bar sent last is missing from the response (more bars opened than `limit` covers, say after the tab slept), the bars in between were missed: the adapter reports a reset from that bar through `onReset`, and the chart refetches the gap. The bars of the response are still sent; the chart holds them until the refetch lands.

 
A failed poll reports `reconnecting` through `onStatus` and the next good one `connected`, so the chart fills the outage like it does for a socket.

### Several feeds in one chart

`createDataSourceRouter` puts several data sources behind one, so the chart can switch between symbols from different feeds, say two exchanges, without a routing source of your own. Each route has a prefix and a source; the chart's symbols are the prefix, a separator and the feed's symbol:

```ts
const source = createDataSourceRouter({
  'FEED-A': { source: createOhlcvDataSource(exchangeA), name: 'Exchange A' },
  'FEED-B': { source: createOhlcvDataSource(exchangeB), name: 'Exchange B' },
});
chart.setDataSource(source);
await chart.setSymbol('FEED-A:BTC/USD', '1h');
```

- **Symbols** split at the first separator only, so feed symbols that contain it work: `'FEED-B:BTC/USD:USD'` is `'BTC/USD:USD'` on the second feed. The separator is `':'` unless you pass `separator`.
- **Resolved and searched symbols** come back with the prefixed `symbol` and `exchange` set to the route's `name` (the prefix when there is none). The feed gets its own symbol info back in `history`, `stream` and the other calls.
- **An unknown prefix** fails to resolve with a `ChartError` coded [`unknown-symbol`](./errors#unknown-symbol). With `defaultRoute: 'FEED-A'`, symbols without a known prefix go to that route instead, and resolve to their prefixed form.
- **Search** asks every route and merges the results in route order. A query that starts with a prefix (`'feed-b:btc'`, in any case) asks only that route. A route whose search fails is left out and reported to `onError(error, { prefix, name })`, or without it as a [`search-route-failed`](./errors#search-route-failed) warning in development builds; the search rejects only when every route failed.
- **Connection status** of a route is passed on while it has live bars open, or while no route has, so a feed the chart is not showing never reports an outage. **Resets** are passed on with the prefixed symbol.
- **Optional members** (`stream`, `onStatus`, `onReset`, `quotes`, `adjustments`, `markers`, `now`) exist on the router when at least one route has them, and go to the routed source. A route without one streams nothing, or has no adjustments or markers; server time comes from the default route, or the first route that has it.

The router also has `searchFilters`, one exchange option per route, and takes the dialog's selected exchange as `search(query, { exchange })`, asking only that route. So it is a ready-made source for the [symbol search](./symbol-search) dialog:

```ts
createSymbolSearch(shell.el, {
  source,
  // Keep the interval on screen.
  onSelect: (result) => chart.setSymbol(result.symbol, chart.data?.interval ?? '1d'),
});
```

## Bars from trades and from shorter intervals

Some sources stream trades, or serve only a few intervals. Three helpers build bars from what they have, all taking `{ interval, timezone?, session? }` (the trade helpers also take `{ ticks }` or `{ volume }`, see below):

| Helper | Does |
| --- | --- |
| `createBarBuilder(options)` | Live bars from a trade stream: `push({ time, price, size?, side? })` returns the bar it changed, for `onBar` |
| `tradesToBars(trades, options)` | Bars from a batch of trades, e.g. for `history` |
| `resampleBars(bars, options)` | Longer bars from shorter ones: 5m from 1m, or daily from intraday |

```ts
const builder = createBarBuilder({ interval: '1m', timezone: info.timezone, session });
socket.onmessage = (ev) => {
  const t = JSON.parse(ev.data);
  const bar = builder.push({ time: t.ts, price: t.price, size: t.qty, side: t.side });
  if (bar) onBar(bar);
};
```

How trades and bars fall into buckets:

- **Intraday** (`s`, `m`, `h`): bars are multiples of their length since the unix epoch. With a `session`, they count from each session range's open instead, so a 1h bar of a 09:30 open runs 09:30 to 10:30, and anything outside the session is dropped.
- **Daily and longer:** bars start at midnight in `timezone` (UTC when unset) of their first trading day. With an overnight `session`, the evening belongs to the next trading day, as on the time axis. Weeks start on Monday; months, quarters and years follow the calendar.
- A trade on a bucket edge belongs to the bar that starts there. The open and close are the earliest and latest trades by time, so a trade that arrives a little late keeps the right open and close; trades for a bar already finished are dropped. Sizes add up to `volume`, buy-side sizes to `buyVolume`.

Pass the symbol's own session when you build daily bars from intraday ones; without it every trade or bar counts, extended hours included. `barBucket(options)` returns the bucketing function itself, for apps that group other data the same way.

### Second, tick and volume bars

Second bars are ordinary intervals: pass `interval: '1s'`, `'5s'`, `'15s'` or `'30s'` and trades bucket on multiples of the length, like minutes.

Active markets are often charted by activity instead of time. Pass `ticks` or `volume` instead of `interval` to start a new bar every N trades or every N units traded:

```ts
const ticks = createBarBuilder({ ticks: 100 }); // a bar per 100 trades
const vol = createBarBuilder({ volume: 5000 }); // a bar per 5,000 units

socket.onmessage = (ev) => {
  const t = JSON.parse(ev.data);
  // A large trade can fill several volume bars: send them all, oldest first.
  for (const bar of vol.apply({ time: t.ts, price: t.price, size: t.qty, side: t.side })) onBar(bar);
};

// History: the same trades in a batch give the same bars.
const bars = tradesToBars(trades, { volume: 5000 });
```

- Trades fill bars in the order they arrive (`tradesToBars` sorts by time first, keeping the order of trades with the same time). The open and close within a bar still follow trade times.
- A trade larger than the room left in a volume bar is split: the part that fits completes the bar and the rest fills the next ones, so every finished bar holds exactly `volume`. `buyVolume` is split the same way. `push` returns only the newest bar, so use `apply`, which returns every bar a trade changed. One trade fills at most 10,000 bars; the last takes whatever is left.
- Trades without a `size` move the price of a volume bar but do not fill it.
- The newest bar is partial until its trades or volume are reached.

These bars come back as `ActivityBar`: a `Bar` with `startTime` and `endTime`, the times of its earliest and latest trades. Its `time` is the first trade's time, nudged forward by `minGap` (default 0.001 seconds) past the previous bar when several bars start within the same instant, so bar times always increase. They are unevenly spaced in time; the chart spaces bars by index and labels the axis with their real times, so no slot grid is needed.

## Writing an adapter

A data source is a plain object implementing `DataSource`. Adapters for a specific exchange or vendor belong in their own package; this one wraps an imaginary HTTP API and maps its fields to `Bar` explicitly. The API answers `GET {base}/series/{symbol}/{interval}?count=&start=&end=` with `{ points: [{ when, first, max, min, last, qty }] }`, the newest `count` points with `start <= when < end`, and streams the same points as JSON over a socket.

```ts
import type { Bar, BarsRequest, DataSource, Interval, SymbolInfo } from '@charton/core';

/** One point as the API sends it: its own field names, not the chart's. */
interface Point { when: number; first: number; max: number; min: number; last: number; qty: number }

/** The API's point as a chart bar. */
const toBar = (p: Point): Bar => ({
  time: p.when,  // unix seconds
  open: p.first,
  high: p.max,
  low: p.min,
  close: p.last,
  volume: p.qty,
});

export function createExampleDataSource(baseUrl: string, wsUrl: string): DataSource {
  const symbols: SymbolInfo[] = [
    { symbol: 'ABC', name: 'ABC Corp', type: 'stock', precision: 2, timezone: 'America/New_York' },
    { symbol: 'XYZ', name: 'XYZ Inc', type: 'stock', precision: 2, timezone: 'America/New_York' },
    // Prices in 32nds and halves of a 32nd (see Price formats in the series guide).
    { symbol: 'NOTE', name: '10Y note', type: 'future', priceFormat: { type: 'fraction', denominator: 32, subDenominator: 2 } },
  ];

  return {
    async symbol(symbol) {
      const info = symbols.find((s) => s.symbol === symbol);
      if (!info) throw new Error(`Unknown symbol ${symbol}`);
      return info;
    },

    async search(query) {
      const q = query.toLowerCase();
      return symbols.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    },

    // Return at most `limit` bars, the newest ones older than `to`
    // (and not older than `from`). `req.kind` says why (see below).
    // Pass the signal on so switches cancel.
    async history(symbol: SymbolInfo, interval: Interval, req: BarsRequest) {
      const params = new URLSearchParams({ count: String(req.limit) });
      if (req.from !== undefined) params.set('start', String(req.from));
      if (req.to !== undefined) params.set('end', String(req.to));
      const url = `${baseUrl}/series/${encodeURIComponent(symbol.symbol)}/${interval}?${params}`;
      const res = await fetch(url, { signal: req.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { points } = (await res.json()) as { points: Point[] };
      const bars = points.map(toBar);
      // Fewer bars than asked for when paging back: they reach the start of the history.
      return { bars, atStart: req.to !== undefined && bars.length < req.limit };
    },

    // Same time as the last bar replaces it, a newer time appends.
    stream(symbol, interval, onBar) {
      const ws = new WebSocket(`${wsUrl}/series/${encodeURIComponent(symbol.symbol)}/${interval}`);
      ws.onmessage = (ev) => onBar(toBar(JSON.parse(ev.data) as Point));
      return () => ws.close();
    },
  };
}
```

The same shape runs below, with an array of bars standing in for the server and a timer for the stream. Scroll back to page in older bars:

<!-- example: custom-data-source -->

### What the chart asks for

`history` receives a `BarsRequest`. Its `kind` says what the request is for, and each kind has a fixed shape. `from` is inclusive, `to` exclusive; return at most `limit` bars, ascending, the newest ones in the range. `limit` is an upper bound, so returning fewer is fine.

| `kind` | When | Fields | `atStart` |
| --- | --- | --- | --- |
| `'initial'` | First load of a symbol and interval. A live subscription starts right after, if the source has one | `limit` | No older history: paging back never starts |
| `'history'` | The user scrolled back to the oldest loaded bar | `to` (the oldest loaded bar's time), `limit` | History is exhausted: paging stops |
| `'history'` | An indicator reads another symbol's bars over a range | `from`, `to`, `limit` | Ignored |
| `'refresh'` | A cached symbol and interval is shown again: bars from the last cached one on | `from` (the last cached bar's time), `limit` | Ignored. A full page of bars means the gap is too big to patch, and the chart reloads everything |
| `'reset'` | After a reset with a range (see `onReset`), and on reconnects to fill the gap | `from`, optional `to`, `limit` | Ignored. A full page falls back to a full reload |
| `'reset'` | After a reset without a range | `limit` (at least the bars already loaded) | As for `'initial'` |

A source that ignores `from` returns the wrong window for `'refresh'` and `'reset'`, and the chart falls back to full reloads. An empty page also stops paging, like `atStart`. `atStart` says what it means: the bars reach the start of the symbol's history.

### Check your adapter

`testDataSource` from `@charton/core/testing` sends your source each of these request shapes, plus a few pages back and an aborted request, and returns what it found wrong. Run it in your own test suite with a symbol that has at least three times `limit` bars of history:

```ts
import { testDataSource } from '@charton/core/testing';

it('answers the requests the chart sends', async () => {
  const source = createExampleDataSource(baseUrl, wsUrl);
  expect(await testDataSource(source, { symbol: 'ABC', interval: '1h' })).toEqual([]);
});
```

It checks that bars ascend without repeats and are valid, that no response holds more than `limit` bars, that `'initial'` returns the newest bars, that `to` and `from` select the newest bars in range with the right bounds, that no older bars exist after a page says `atStart`, and that a request whose signal is already aborted settles (resolving or rejecting). Options: `limit` (default 50), `maxPages` (pages walked towards the start of history, default 20) and `timeout` per request in ms (default 5000). The `testing` entry is separate from the main one, so none of it ends up in your app's bundle.

Rules the chart relies on:

- Times are unix **seconds**, bars ascending. The chart sorts, removes duplicate times and drops [invalid bars](./concepts#bad-values) (a non-finite time, price or volume, or `high` below `low`), but correct data is cheaper. Each bar left out is reported once through the [`data:dropped`](./events) event.
- Set `atStart: true` once there is nothing older. An empty page also stops paging.
- `stream` may deliver bars before the first history request finishes; the chart buffers them and merges after.
- The optional `quotes(symbol, onQuote)` streams `{ bid, ask }` quotes for the bid and ask [reference lines](./reference-lines#bid-and-ask). It returns an unsubscribe function, like `stream`. `chart.data.quote` holds the latest one for the current symbol (null before the first and once another symbol starts loading).
- Live bars older than the last bar, or invalid, are ignored: each emits [`data:dropped`](./events), and `chart.data.dropped` counts them. To change bars already sent, report a reset through `onReset` (see [Corrections and reconnects](#corrections-and-reconnects)).
- Throwing from `history` emits `data:error` with a `ChartError` (`load-failed` or `history-failed`) whose `cause` is your error; throwing from `symbol` reports `unknown-symbol` whatever the reason, so a network failure there reads as `unknown-symbol` too (its `cause` is your error). A failed refetch after a reset reports `reset-failed`. Throwing from `adjustments` does not fail the load: it emits `data:warning` with `adjustments-failed` (see [splits and dividends](#splits-and-dividends)). Aborted requests are ignored.
