---
description: "Every chart event, its payload and when it fires, plus how errors reach your code."
---

# Events

Subscribe with `chart.on(event, listener)`. It returns an unsubscribe function. Event names follow a `noun:verb` scheme.

```ts
const off = chart.on('view:change', ({ from, to }) => console.log(from, to));
off();

// The next emission only; the returned function cancels it.
chart.once('data:loaded', ({ bars }) => console.log(bars.length));
```

| Event | Payload | When |
| --- | --- | --- |
| `crosshair:move` | `{ time, index, price, pane, locked } \| null` | Pointer moves over a pane; `null` when it leaves. `price` follows `crosshair.mode` snapping; `locked` is true while [`lockCrosshair`](./options#locking-the-crosshair) holds it |
| `plot:click` | `{ time, index, price, pane, x, y }` | Press and release in a plot without dragging, unless a drawing took the press |
| `plot:dblclick` | `{ time, index, price, pane, x, y }` | Double-click in a plot, unless a drawing handled it (text editing) |
| `chart:contextmenu` | `{ target, x, y, clientX, clientY, pane, time, index, price, scale, drawing, series? }` | Right click or the keyboard menu key on a plot, axis or drawing, or a touch long press on a plot with `touchInspect: 'off'`. `x`, `y` are chart-root css px, like `pointAt`. `target` is `'plot'`, `'priceAxis'`, `'timeAxis'`, `'drawing'` or `'legend'`; a drawing under the pointer is selected. `'legend'` comes from a legend row's "More" button, a right click on the row or a touch long press on it, with the row's `series` and its `pane`, and null `time`, `price` and `scale`. While the `contextMenu` feature is on and this has a listener, the browser's menu is suppressed |
| `baseline:change` | `{ series, baseLevel, price }` | The user dragged a `baseline` series' base level on the price axis. `baseLevel` is the series' new option, `price` where the base now sits. See [Baseline base level](./series#baseline-base-level) |
| `plus:click` | `{ price, pane, scale, x, y }` | The price-axis "+" button was pressed; it shows only while this has a listener. See [plus button](./annotations#plus-button) |
| `series:hover` | `{ series, point, item? }` | The pointer moves onto a different candle, line, histogram, point or indicator series, or off all of them (`series: null`); on a point series also onto another item, given as `item`. `point` is `null` when no point is available: the pointer left, or the hovered series was removed. Mouse and pen hover only; touch does not emit it |
| `selection:change` | `{ selection }` | What is selected changed: `{ kind: 'drawings', ids }`, `{ kind: 'indicator', indicator }` or `null`. One selection covers drawings and indicators; see [Selecting indicators](./indicators#selecting) |
| `trade:hover` | `{ trades, group, point }` | The pointer entered a fill marker, or tapped it. See [account fills](./annotations#account-fills) |
| `trade:hover-end` | `{}` | The pointer left the fill marker |
| `trade:click` | `{ trades, group, point }` | A fill marker was clicked or tapped; markers take presses only while this has listeners |
| `marker:hover` | `{ marker, series, point, members? }` | The pointer entered a bar marker, or tapped it. See [bar markers](./annotations#bar-markers) |
| `marker:hover-end` | `{ marker, series }` | The pointer left the bar marker |
| `marker:click` | `{ marker, series, point, members? }` | A bar marker was clicked or tapped; markers take presses only while this has listeners. `members` lists a folded marker's markers |
| `sourcemarkers:click` | `{ markers, point }` | A data source [marker](./data-sources#markers) was clicked or tapped, on its bar or as a time-axis badge: copies of the marker, or of the markers folded into it or its badge. They take presses only while this has listeners |
| `annotations:cluster` | `{ lines, anchor, defaultPrevented }` | A folded cluster of order labels was clicked, after `onClusterClick`; the UI shell's `clusterList()` part lists the orders unless prevented. See [label clustering](./annotations#label-clustering) |
| `draft:edit` | `{ draft, segment, anchor, defaultPrevented }` | An order draft's `quantity` or `type` was clicked; the UI shell's `draftEditor()` part opens a keypad or a type menu unless prevented. See [order drafts](./annotations#order-drafts) |
| `status:change` | `{ status, defaultPrevented }` | `chart.setStatus` set or cleared the [in-pane status](./data-sources) (the data source sets it while loading, for no data and for errors); `status` is `null` when cleared. Calling `preventDefault()` hides the chart's own text for that status; the UI shell does this for its [`loading` and `empty` slots](./ui-shell#slots) |
| `ui:notify` | `{ message, kind, durationMs, defaultPrevented }` | `chart.notify()` was called; the UI shell shows a toast unless prevented. See [notifications](./ui-shell#notifications) |
| `order:create` | `{ side, type, price, quantity?, takeProfit?, stopLoss? }` | An order draft was placed (its place button or `commit()`). Send the order, then show it with `addTradeLine` |
| `data:dropped` | `{ reason, bar, series }` | A bar or point was left out: `'older'` than the series' last one, `'invalid'` from a data source or a normalized `setData`, or a `'duplicate'` time. See [bad values](./concepts#bad-values) |
| `context:lost` | `{ reason }` | The GPU context was lost; the series stop drawing until it is restored, while axes, labels and drawings keep drawing. `reason` is `'budget'` when the chart gave it up for the page's context budget, `'browser'` otherwise. See [failure modes](./getting-started#requirements-and-failure-modes) |
| `context:restored` | `{ reason }` | The GPU context is back; the chart redraws |
| `context:restore-failed` | `{ error }` | The restored context could not be set up (`ChartError` code `'webgl-restore-failed'`); recreate the chart |
| `frame:render` | `RenderStats` | A frame was drawn, with what it cost. Fires only while the `renderStats` or `renderStatsOverlay` option is on, with the `statsOverlay()` plugin; see [Debugging and profiling](./performance#debugging-and-profiling) |
| `state:change` | `{ reason }` | Something worth saving changed: `drawings`, `indicators`, `series` (main series style), `panes` (panes and price scales), `symbol`, `options` (theme or grid) or `viewport`. Loads never fire it. See [Storage and autosave](./storage#state-change) |
| `frame:slow` | `{ frameTime }` | Frames kept coming slower than about 29 a second for a while; `frameTime` is the smoothed gap in ms. Offer `lowPower` here. Fires once per slow spell, never while `lowPower` is on. See [low-power mode](./performance#low-power-mode) |
| `appearance:change` | `{ theme, grid }` | `applyOptions` changed the theme or the grid; same as `chart.appearance()`. Persist on this |
| `theme:change` | `{ theme }` | `applyOptions({ theme })` changed the resolved theme; setting the same values again is silent |
| `timezone:change` | `{ timezone, previous }` | The time axis timezone changed: the `timezone` option, or the symbol's own with `applySymbolTimezone` |
| `localization:change` | `{ locale }` | `chart.localization` was replaced: by `applyOptions({ localization })`, or by installing or uninstalling the `localization()` plugin; `locale` is undefined for the built-in English formats |
| `chart:resize` | `{ width, height }` | The chart's size changed (css px) |
| `chart:destroy` | `{}` | `destroy()` was called; the chart is still intact while listeners run |
| `grouping:change` | `{ level, bars }` or `null` | The view started or stopped [grouping bars](./view-and-scale#group-bars-when-zoomed-out) (with the `grouping()` plugin), or changed bars per bucket |
| `viewport:clamp` | `{ axis, requested, applied }` (plus `pane`, `scale` for `price`) | `setVisibleTimeRange`, `fitContent`, `scrollToRealtime`, `resetView` (`axis: 'time'`, ranges in unix seconds) or `setPriceRange` (`axis: 'price'`, ranges in prices) asked for a view outside the [viewport bounds](./view-and-scale#viewport-bounds); both ranges are `{ from, to }` |
| `view:change` | `{ barSpacing, fromIndex, toIndex, rightOffset, from, to }` | Anything chart coordinates depend on changed: pan, zoom, resize, pane layout, a price scale's range or mode, or the bars. At most once per frame, after the frame is drawn; `fromIndex`/`toIndex` are the fractional logical indices at the plot edges, `rightOffset` the space after the last bar in bars, `from`/`to` the times of the first and last visible bar (null without bars). Use it to re-place [HTML over the chart](./view-and-scale#position-html-over-the-chart) |
| `compare:error` | `{ symbol, error }` | A [compared symbol](./data-sources#compare-symbols) failed to load; `error` is a `ChartError` as in `data:error` |
| `scale:change` | `{ pane, scale, mode, autoScale, invert, noPositiveData, fixedRange, lockPriceToBarRatio }` | A [price scale](./view-and-scale)'s mode, inversion, autoscale, fixed range or ratio lock changes, or a log scale gains or loses data above zero (`noPositiveData`) |
| `history:request` | `{ before }` | Viewport nears the oldest bar |
| `panes:change` | `{ heights, maximized, collapsed, hidden }` | Panes added, removed, reordered, resized, maximized, collapsed or hidden. `heights` are normalized stretch weights for `setPaneHeights` |
| `indicator:add` | `{ indicator }` | An [indicator](./indicators) was added or restored (pending placeholders too) |
| `indicator:remove` | `{ indicator }` | An indicator was removed, directly or with its series or pane |
| `indicator:change` | `{ indicator }` | An indicator's inputs or visibility changed through its handle, or it went live or pending as its definition was registered or unregistered |
| `indicator:error` | `{ indicator, error }` | An indicator's `compute` or `update` failed, or restored inputs did not fit and defaults were used |
| `indicator:status` | `{ indicator, status, message }` | The load state of an indicator's [own data](./indicators#indicators-with-their-own-data) changed, or its message did (an unsupported context, a fetch error, `setError`) |
| `indicator:refuse` | `{ type, reason }` | `indicators.add()` or `duplicate()` refused an indicator: the access rule said no (`'blocked'`) or the chart is at its limit (`'limit'`); see [access rules](./features#access-rules) |
| `indicators:access-change` | `{ allow: AccessRule \| null, limit: number \| null }` | `indicators.setAccess()` or `setLimit()` was called, also through the `access` option |
| `symbol:change` | `{ symbol, previous }` | `setSymbol` (or a layout load) switched to another symbol, once per switch and before its load starts (`previous` is `null` on the first). A switch overtaken by another one is aborted and never emits `data:loaded` |
| `data:loading` | `{ symbol, interval, kind }` | A [data source](./data-sources) load starts (`initial`, `history` or `reset`) |
| `data:loaded` | `{ symbol, interval, kind, bars }` | A data source load finished; `bars` is the full series |
| `data:error` | `{ symbol, interval, kind, error }` | A data source load failed: `kind` is `initial`, `history` or `reset` (refetching after a source reset, a reconnect or `chart.reload()`). `error` is a `ChartError` (see [errors](#errors)) with the source's error as `cause` |
| `data:warning` | `{ symbol, interval, kind, error }` | A data source load landed with something missing: `adjustments` failed (code `adjustments-failed`), so those bars show unadjusted (see [splits and dividends](./data-sources#splits-and-dividends)) |
| `chart:error` | `{ error }` | An event listener threw (`ChartError` code `'listener-failed'`); see [errors](#errors) |
| `interval:change` | `{ interval, previous, requested, reason }` | A load landed at another interval than before, or the symbol did not support the requested one (`reason: 'unsupported'`) and the nearest supported interval is shown |
| `data:bar` | `{ bar, appended }` | A live bar from the data source was merged |
| `data:quote` | `{ symbol, quote }` | The data source sent a bid/ask quote (see [reference lines](./reference-lines#bid-and-ask)) |
| `data:reset` | `{ symbol, interval, range }` | Bars were refetched after the source reported a reset through `onReset`; `range` is undefined for the whole series (see [corrections and reconnects](./data-sources#corrections-and-reconnects)) |
| `data:reconnecting` | `{ since }` | The source's live stream dropped and is reconnecting |
| `data:reconnect` | `{ gap }` | The live stream is back after `gap` seconds |
| `data:stale` | `{ gap, reason }` | Bars on screen may be out of date: an outage longer than `maxGapFillSeconds` (`reason: 'outage'`, `gap` its length), or a failed load kept a [cached snapshot](./data-sources#paint-ahead-from-a-persistent-cache) on screen (`'reconcile'`, `gap` its age); seconds |
| `sourcemarkers:loaded` | `{ symbol, interval, from, to, markers, dropped }` | The data source's `markers` answered for `from` to `to`; `dropped` counts invalid markers left out. See [markers](./data-sources#markers) |
| `sourcemarkers:error` | `{ symbol, interval, error, retryIn }` | `markers` failed (code `markers-failed`); it is asked again after `retryIn` ms, or, when `retryIn` is `null` after five failures in a row, only after a reset of the shown bars, an option turned back on, or the next symbol or interval |
| `sourcemarkers:change` | `{ markers }` | `chart.sourceMarkers` changed: a batch landed, markers far from the view were let go, or they were dropped; `markers` is the new frozen list |
| `data:snapshot` | `{ symbol, interval, bars, savedAt }` | A [cached snapshot](./data-sources#paint-ahead-from-a-persistent-cache) was painted while its load runs; `data:loaded` follows |
| `tool:change` | `{ tool, kept }` | Active drawing tool changes (`null` = cursor); `kept` when set with `setTool(type, { keep: true })` |
| `magnet:change` | `{ mode }` | `drawings.setMagnetMode()` or `setMagnet()` changed the magnet (`'off'`, `'weak'` or `'strong'`) |
| `drawing:select` | `{ id, ids }` | The drawing selection changed; `ids` in the order they were selected, `id` the last (`null` when nothing is) |
| `drawing:bounds` | `{ id, rect }` | The selected drawing's on-screen box changed; `rect` is `null` when it is out of view |
| `drawings:change` | `{ drawings }` | Any drawing is created, updated or removed |
| `drawings:invalid` | `{ errors }` | `drawings.load()` skipped malformed drawings or dropped ill-typed fields; each error has its `index`, a `reason`, and the `field` when only that field was dropped |
| `drawings:visibility` | `{ hidden }` | `drawings.setHidden()` hid or showed every drawing (the rail's hide-all button calls it) |
| `drawing:create` | `{ drawing }` | One drawing was added (user, code, undo or redo) |
| `drawing:update` | `{ drawing, change, changes }` | One drawing changed; `changes` lists the kinds (`points`, `style`, `text`, `lock`, `visibility`, `order`, `pane`, `flags`) |
| `drawing:update-progress` | `{ id }` | A drawing changes on screen but is not committed yet: the user drags it, an anchor or a handle, or `drawings.preview()` was called. Fires on every step; the `drawing:update` at the end commits |
| `drawing:remove` | `{ id }` | One drawing was removed. `drawings.load()` fires none of these three; re-sync from `drawings:change` |
| `drawing:click` | `{ id }` | Press and release on a drawing without dragging |
| `drawing:dblclick` | `{ id }` | Double click on a drawing |
| `access:change` | `{ allow: AccessRule \| null }` | `drawings.setAccess()` changed the allowed tools, also through the `access` option |
| `tool:refuse` | `{ tool }` | `drawings.setTool()` refused a denied tool, e.g. a press on a disabled rail button |
| `tool:defaults-change` | `{ tool, defaults }` | The style new drawings of `tool` start with changed: `drawings.setToolDefaults()`, `loadToolDefaults()` or a remembered style edit. `defaults` is `drawings.toolDefaults(tool)` |
| `history:change` | `{ canUndo, canRedo }` | Undo/redo availability of `chart.history` (drawings and indicators) changes |
| `series:error` | `{ series, hook, error }` | A [custom series](./custom-series#errors) hook threw, once per hook until it succeeds again; or a [`follow`](./series#series-derived-from-the-bars) mapper failed on a live bar (`hook: 'follow'`) |
| `series:add` | `{ series, indicator }` | A series joined the chart: an `add*` call, a [compared symbol](./data-sources#compare-symbols), or an indicator's series (`indicator` set, before `indicator:add`) |
| `series:options` | `{ series, patch }` | `series.applyOptions(patch)` changed a series on the chart; an empty patch is silent |
| `series:visibility` | `{ series, visible }` | A series was shown or hidden: `setVisible` with a new value, or a legend row's hide/show button |
| `series:settings` | `{ series, indicator }` | A legend row's settings button was pressed, or `chart.openSeriesSettings(series)` was called; the button shows only while this has a listener and, once providers are declared with `chart.provideSeriesSettings`, on the rows they cover. `indicator` is `null` for plain series |
| `replay:change` | `{ active, playing, time, speed, remaining }` | A [bar replay](./replay) started, moved, stepped, played, paused, changed speed or stopped |
| `series:remove` | `{ series, indicator }` | A series left the chart: `removeSeries`, `indicator.remove()`, removing its pane, or a legend remove button |

## Errors

Errors the chart raises are `ChartError`s with a stable `code` to branch on, a `context` object with details such as the symbol, and, when the error came from somewhere else, that original error as `cause`.

```ts
import { ChartError } from '@chart-on/core';

chart.on('data:error', ({ error }) => {
  if (error.code === 'unknown-symbol') showNotFound(error.context.symbol);
  else console.warn(error.message, error.cause);
});
```

[Errors and warnings](./errors) lists every code with its cause and fix.

Mistakes in arguments (an unknown pane, a negative margin) still throw plain `Error`s at the call.

**Listeners cannot break the chart.** A listener that throws does not stop the other listeners of that event, nor the frame that emitted it. Its error is reported through the `chart:error` event, or logged with `console.error` when nothing listens there (and when a `chart:error` listener itself throws).

**Promise or event, not both.** A failed `setSymbol` emits `data:error` and rejects its promise. When a `data:error` listener exists at the time of the failure, the rejection is marked handled, so an app that reacts to the event can ignore the promise without unhandled-rejection warnings. Code that awaits `setSymbol` still sees the rejection. Without a `data:error` listener, handle the promise.

## Load older history on scroll

`history:request` fires when the user pans within `historyThreshold` bars (default `20`) of the oldest bar. Fetch older bars and prepend them with `setData`. With a [data source](./data-sources) the chart does this for you.

```ts
chart.on('history:request', async ({ before }) => {
  const older = await fetchBars({ end: before });
  candles.setData([...older, ...candles.data]);
});
```

## Sync a custom legend

```ts
chart.on('crosshair:move', (e) => {
  if (!e) return legend.reset();
  legend.show(e.time, e.price);
});
```

Set `features: { legend: false }` to hide the built-in legend (see [Feature flags](./features)).

## Click on the chart

`time` and `index` are the nearest bar (past either end of the data, `time` is extrapolated by the bar interval), `price` is the price under the pointer in that pane, and `x`/`y` are css px from the chart's top-left corner. A double-click also fires two `plot:click` events first, as in the DOM.

```ts
chart.on('plot:click', ({ time, price }) => placeAlert(time, price));
```

To convert any position yourself, `chart.pointAt(x, y)` returns the same payload, or `null` outside the plot areas. The reverse direction, `chart.coordinateFor(time, price, pane)`, is described in [Position HTML over the chart](./view-and-scale#position-html-over-the-chart). Unlike `crosshair:move`, these report the price under the pointer, without `crosshair.mode` snapping.

## Values at a bar and custom tooltips

`chart.valuesAt(time?)` returns every series' value at the bar nearest `time`, or at the crosshair's bar (else the newest bar) when called without one:

```ts
const at = chart.valuesAt();
// { time, timeText, index, series: [{ series, pane, values, legend }, …] }
// values: { open, high, low, close, volume } for candles (raw bars, whatever the style), { value } for lines and histograms
// legend: the title and formatted parts the legend shows
```

`timeText` uses the chart's `timezone`, like the crosshair label. While a pane is maximized, the series of the panes it hides are left out, as in the legend.

`series:hover` fires only when the series under the pointer changes. Combine it with `crosshair:move` for a tooltip that follows the pointer:

```ts
let hovered: Series | null = null;
chart.on('series:hover', ({ series }) => (hovered = series));
chart.on('crosshair:move', (e) => {
  const row = e && hovered && chart.valuesAt(e.time)?.series.find((s) => s.series === hovered);
  tooltip.show(row?.legend ?? null);
});
```

`chart.seriesAt(x, y)` answers the same question for any position. Candles count from high to low of the bar as drawn (Heikin Ashi bars for that style, without the open for HLC styles), close-only styles such as line and area count within a few px of the close, histograms from base to value, and lines within a few px of the value at the nearest bar. Indicators count the same way through their shown plots. A collapsed pane has no series under the pointer.

Trade lines, alert lines, drawings and price lines with pointer callbacks or a `tooltip` are drawn above the series and take the pointer first: while the pointer is over one, `series:hover` reports `series: null`. Plain price lines do not. `seriesAt` ignores them all.

## Sync the crosshair of two charts

`setCrosshairAt(time, price?, pane?)` shows the crosshair without a pointer and keeps it on that time while the view pans, zooms or gets new data. It does not emit `crosshair:move`, so two charts can mirror each other without looping. Without a price only the vertical line is drawn; a `null` time hides it. The next pointer move over the chart takes over.

```ts
a.on('crosshair:move', (e) => b.setCrosshairAt(e?.time ?? null));
b.on('crosshair:move', (e) => a.setCrosshairAt(e?.time ?? null));
```

To keep the visible range, symbol, interval or timezone in step too, put the charts in a [link group](./link-groups).

## Screenshot and data export

```ts
import { toCSV } from '@chart-on/core';

// A PNG Blob at device pixel ratio: background, watermark, series, drawings, axes and legend.
// null when the chart has no size, the GPU context is lost or encoding fails.
const blob = await chart.captureImage();    // { legend: false } to leave the legend out, { crosshair: true } to include it
if (blob) download(blob, 'chart.png');

// Other formats go through the browser's encoder.
const jpeg = await chart.captureImage({ type: 'image/jpeg', quality: 0.9 });

// Twice the CSS size whatever the display, on a white card with a margin, without drawings.
const share = await chart.captureImage({ scale: 2, background: '#ffffff', padding: 16, drawings: false });

// A light image of a dark chart, with a header naming the symbol, interval, values and time.
const report = await chart.captureImage({ theme: 'light', caption: true });

// Rows for the visible range, or pass { from, to } (unix seconds, inclusive).
const data = chart.getDataTable();
// data.columns: ['time', 'open', 'high', 'low', 'close', 'volume', 'RSI', …]
download(new Blob([toCSV(data)], { type: 'text/csv' }), 'chart.csv');

// Dates and times a spreadsheet reads, on the chart's wall clock.
const csv = toCSV(data, { time: 'iso', timezone: chart.zone.name });
// time,open,…  then  2024-01-02 10:00:00,…
```

`captureImage` needs the `imageCapture()` plugin (in `builtins()`, and added by the [UI shell](./ui-shell)); without it the call throws a [`not-registered`](./errors#not-registered) error. Create the chart with `createChart(el, { plugins: [imageCapture()] })` or call `chart.install(imageCapture())`. Data export (`getDataTable`, `toCSV`) needs no plugin.

The image is composited when you call `captureImage`, so it shows the chart at that moment even though the `Blob` arrives later. It leaves the crosshair out, with the legend on the newest bar, unless you pass `crosshair: true`. Where it goes (a download, the clipboard, an upload) is up to the app.

| Option | Default | Effect |
| --- | --- | --- |
| `legend` | the `legend` feature | Paint the series legend onto the image |
| `crosshair` | `false` | Include the crosshair and its labels |
| `scale` | device pixel ratio | Image pixels per CSS pixel. Above the device pixel ratio the chart is redrawn at that ratio for the capture (the GPU series too, past `maxGlDpr`) and the screen is restored before the browser paints. The longest side is kept within 8192 pixels |
| `watermark` | `true` | Include the [watermark](./watermark) when the chart shows one |
| `drawings` | `true` | Include drawings |
| `annotations` | `true` | Include markers, price lines, trade lines and their axis labels |
| `background` | theme background | A CSS color, or `'transparent'` for an image with an alpha channel (PNG or WebP; JPEG shows black). A color the chart cannot read falls back to the theme background |
| `padding` | `0` | Margin around the chart in CSS pixels, filled with the background |
| `theme` | the chart's theme | Draw the image in another theme: a whole `ChartTheme`, or `'light'` / `'dark'` for the built-in themes with the chart's own fonts. The screen keeps its theme and pixel ratio: the capture switches the theme and back in the same task, before the browser paints, also when drawing fails, and emits no `theme:change` |
| `caption` | `false` | A header line above the chart. `true`: the symbol, the interval (with a data source), the newest bar's values and the export time in the chart timezone, e.g. `DEMO · 1h · O 101 H 112 L 90 C 104 · 2024-01-15 21:00 Asia/Tokyo`. A string: that text. Drawn in the image's theme over its background |
| `type`, `quality` | `image/png` | Passed to the browser's encoder |

Without `background`, `padding` or `caption` the image matches the screen, dark or light theme alike. With any of them, the background is painted once under the whole image, so a translucent one is not doubled where the chart is.

To copy the image, `@chart-on/ui` has `copyChartImage(chart, options?)`. It takes the same options except `type` and `quality` (clipboards take PNG) and returns a promise that rejects when the browser cannot copy images, the user denies it, or the chart cannot be captured. Like `captureImage`, it needs the `imageCapture()` plugin (the UI shell adds it); without it the promise rejects with the `not-registered` `ChartError`. Call it from a click or key press, since browsers only allow clipboard writes that start from one. `canCopyImage()` says whether the browser supports it, for example to hide the button.

To print, `@chart-on/ui` has `printChart(chart, options?)`. It captures the chart (the same options as `copyChartImage`, defaulting to `theme: 'light'`, `caption: true` and `scale: 2`), adds a print-only view of the image to the page and opens the browser's print dialog. The page looks the same on screen; while printing, its stylesheet hides everything else and fits the image to the page. The view is removed when the dialog closes, and the promise resolves then; it rejects when the chart cannot be captured or the browser refuses to print. Outside the UI shell it needs the `imageCapture()` plugin: without it the promise rejects with the `not-registered` `ChartError`. It needs `@chart-on/ui/style.css`, which holds the print rules.

```ts
import { printChart } from '@chart-on/ui';

printButton.onclick = () => printChart(chart).catch((e) => showToast(String(e)));
```

```ts
import { canCopyImage, copyChartImage } from '@chart-on/ui';

copyButton.hidden = !canCopyImage();
copyButton.onclick = () => copyChartImage(chart, { scale: 2 }).catch((e) => showToast(String(e)));
```

`getDataTable` includes the main OHLCV, other candle series (columns prefixed with their title), and line and histogram series (one column each, named by title). Hidden series are included; heatmaps are skipped. Candles export their raw bars whatever the display style. Missing and non-finite values are `null`, written as empty CSV cells. `toCSV` prefixes text cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return with `'`, so a series title cannot run as a spreadsheet formula; numbers, including negative ones, are written unchanged.

`toCSV(data, options?)` writes the `time` column as unix seconds by default. `time: 'iso'` writes `YYYY-MM-DD HH:mm:ss`, the wall-clock date and time in `timezone` (an IANA name or `'local'`; default `'UTC'`), which spreadsheets open as dates. The text carries no offset, so name the timezone wherever the file goes; `chart.zone.name` is the chart's. `time` may also be a function `(time) => string`; its text is escaped like any other text cell. An unknown timezone throws a `RangeError`.

## Trade lines

Order and position lines report drags and button presses through callbacks on each line (`onDrag`, `onChange`, `onAction`), not through `chart.on`. See [Annotations](./annotations#trade-lines).
