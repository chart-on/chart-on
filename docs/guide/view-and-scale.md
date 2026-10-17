---
description: "Move the view from code, limit where it can go, and control price scale modes, autoscale and ranges."
---

# View and price scale

## Move the view from code

```ts
chart.scrollToRealtime();               // newest bar in view
chart.fitContent();                     // all bars in view, panes autoscaled
chart.setVisibleTimeRange(from, to);    // unix seconds
chart.resetView();                      // default zoom, newest bar, autoscale (also Shift+End)
chart.getVisibleRange();                // { from, to } or null
chart.scrollToTime(time);               // centre a time, keep the zoom
```

These animate by default. Pass `false` as the last argument to jump instead:

```ts
chart.scrollToRealtime(false);
chart.setVisibleTimeRange(from, to, false);
```

Animations are skipped when `animateViewChanges` is off or the user prefers reduced motion, and any user input cancels them.

`fitContent()` and `setVisibleTimeRange()` return `false` when the range holds more bars than fit at `minBarSpacing`; the view then shows the newest part of it. See [limits](./performance#limits), and [grouping](#group-bars-when-zoomed-out) to fit any number of bars.

`getVisibleRange()` returns what `setVisibleTimeRange(from, to)` was given when both times are bar times. A view call made while a `setSymbol` load is pending is applied again once the new bars arrive, so switching the interval and then setting a range works in one go.

## Limit where the view can go

By default the user can pan until bars cover only half the plot (`minBarCoverage: 0.5`) at either end. A share of the plot width behaves the same at every zoom, where a bar count would leave a sliver of data when zoomed out and a wide block when zoomed in. Tighten that with options:

```ts
createChart(el, {
  fixLeftEdge: true,     // no further left than the first bar
  fixRightEdge: true,    // no further right than the newest bar plus rightOffset
  maxRightOffset: 20,    // at most 20 empty bars right of the newest bar
  minBarCoverage: 0.8,   // bars keep covering 80% of the plot when panning to either end
});
```

- The limits apply everywhere the view moves: dragging, inertia (which stops at an edge), wheel and pinch zoom, the keyboard, and `scrollToRealtime`, `fitContent`, `setVisibleTimeRange` and `resetView`, whose animations ease to the nearest allowed view.
- Zooming keeps the bar under the pointer in place unless that would cross a fixed edge; then the edge stays put.
- With `fixLeftEdge` and a right limit (`fixRightEdge` or `maxRightOffset`), zooming out stops once every bar fits. When there are too few bars to fill the plot even at `maxBarSpacing`, the first bar stays at the left edge and zoom keeps its full range.
- When `maxRightOffset` is smaller than `rightOffset`, `fitContent`, `setVisibleTimeRange` and a range kept across an interval switch use `maxRightOffset` as the margin after the newest bar, so `getVisibleRange()` still returns the requested range.
- `applyOptions` applies new limits to the current view straight away. `minBarSpacing`, `maxBarSpacing` and `maxRightOffset` must be finite and non-negative, `minBarCoverage` between 0 and 1, and `rightOffset` finite; an invalid value throws and leaves the options unchanged.

### Viewport bounds

To keep the user inside a time window or a price band, for a replay that hides the future, a backtest viewer or an embedded lesson, set viewport bounds:

```ts
chart.setViewportBounds({
  time: { from: start, to: replayTime },        // unix seconds; either end may be left out
  price: { low: 90, high: 140 },                 // optional; also `pane` and `scale`
});
chart.viewportBounds;            // a copy of what was set, or null
chart.setViewportBounds(null);   // remove them
```

- The plot shows only bars from the first one at or after `from` to the last one at or before `to`. Panning slides along those edges without changing the zoom, and zooming out stops once the whole window fills the plot (it never goes below `minBarSpacing`). The bounds take precedence over `fixLeftEdge`, `fixRightEdge`, `maxRightOffset` and `minBarCoverage`, and follow the bars when history is prepended.
- Every path obeys: dragging, inertia, wheel, pinch, the keyboard, and `scrollToRealtime`, `fitContent`, `setVisibleTimeRange` and `resetView`. When one of those four asks for more than the bounds allow, the chart shows what it can and emits `viewport:clamp` `{ axis: 'time', requested, applied }` with both ranges in unix seconds.
- A price bound keeps one price scale (the main pane's right one unless `pane` and `scale` say otherwise) inside `low`..`high` through axis drags, zoom, pan, autoscale, `setPriceRange` and a locked price-to-bar ratio. Setting it turns that scale's autoscale off; clearing the bounds turns it back on. A `setPriceRange` the band narrows emits `viewport:clamp` `{ axis: 'price', pane, scale, requested, applied }` with both ranges in prices.
- `setSymbol` with another symbol or interval clears the bounds, unless `keepOnContextChange: true` was set with them.
- Bounds that are not finite, have `from` after `to` or `low` not below `high`, or name a missing pane throw at the call.

Viewport bounds are [opt-in](./features#opt-in-features): create the chart with the `viewportBounds()` plugin (or `builtins()`). The UI shell adds it for you. Without it, `setViewportBounds` throws [`not-registered`](./errors#not-registered) and `viewportBounds` is null.

## Group bars when zoomed out

Grouping comes with the `grouping()` [plugin](./features#opt-in-features), which `builtins()` includes. Without it the `grouping` option is kept but bars draw singly, zooming stops at `minBarSpacing`, `chart.grouping` is null, and development builds warn once ([`grouping-missing`](./errors#grouping-missing)).

```ts
import { createChart, grouping } from '@charton/core';

const chart = createChart(el, { plugins: [grouping()], grouping: { mode: 'pixel' } });
chart.fitContent(); // true for any number of bars
chart.on('grouping:change', (g) => console.log(g ? `${g.bars} bars per bucket` : 'single bars'));
```

With `grouping`, zooming out can go past `minBarSpacing`, down to half the spacing that fits every bar. Once single bars get narrower than about two device pixels, the chart draws buckets of `2 ** level` bars instead, choosing the level that keeps each bucket at least two device pixels wide, so the work per frame follows the plot width, not the number of bars:

- A candle bucket is one bar: the first open, highest high, lowest low and last close (and summed volume for volume candles). Per-bar colours are not used for buckets. Line-like candle styles draw one point per bucket.
- A histogram column shows the bucket's `groupBy`: `'sum'` (the default, for volume), `'max'` or `'last'`; its colour is the last point's.
- Line series and indicator line plots draw each bucket's first, lowest, highest and last value at its centre, so spikes stay visible; autoscale reads them in time that grows with the logarithm of the point count. Indicator histogram plots show each bucket's last value, and fills run between the plots' bucket values. Custom series show one item per bucket: what their `group` hook makes of the bucket's items, else its last item (see [custom series](./custom-series#definition)).
- Buckets sit on fixed bar indices (bucket `j` holds bars `j * 2 ** level` to `(j + 1) * 2 ** level - 1`), so panning never changes what a bucket holds. They are built the first time they are needed and kept up to date as bars arrive or the newest bar ticks.
- Autoscale reads candle buckets in time that grows with the logarithm of the bar count.
- The crosshair sits on the bucket's centre and its time label shows the bucket's first and last bar time. The legend shows the bucket's values, and `valuesAt` adds `group: { time, endTime, count }`.
- `chart.grouping` is `{ level, bars }` while the view groups bars and null otherwise; `grouping:change` fires when that changes. Indicators compute, and drawings and annotations work, on the real bars and times.

`grouping: null` (the default) leaves everything as without it.

### Group by calendar period

`{ mode: 'calendar' }` groups by calendar periods instead of powers of two, so a zoomed-out chart of minute bars shows the hourly, daily or weekly bars the same data has at that interval:

```ts
chart.applyOptions({ grouping: { mode: 'calendar' } });                  // 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M
chart.applyOptions({ grouping: { mode: 'calendar', steps: ['1h', '1d', '1w'] } });
chart.grouping; // { level: 0, bars: 390, step: '1d' }
```

- The chart picks the finest step longer than the bar interval whose buckets average at least about two device pixels, counting the bars the data really has per period (sessions and short days included). Past the coarsest step it keeps that one.
- Periods follow the chart's `timezone` and `session`: days and longer are trading days (an overnight session's evening bars belong to the next day), weeks start on Monday, and shorter steps follow the local clock, so buckets stay on local boundaries across daylight-saving changes. Closed time has no bars, so it has no buckets either.
- A bucket holds the bars of one period, so buckets hold different numbers of bars. Bodies and columns are drawn as wide as the narrowest bucket in view, so they never overlap; the crosshair, legend and `valuesAt` give the period's own first and last bar time and bar count.
- Everything else works as in pixel mode. Buckets are worked out once per step and extended as bars arrive, so a live bar updates only the last bucket.

## Resizing and new bars

A resize keeps the bar spacing by default, so a wider chart shows more bars. With `lockVisibleRangeOnResize: true` the bar spacing scales with the plot width instead and `getVisibleRange()` stays the same (within `minBarSpacing` and `maxBarSpacing`). This applies to any change of the plot width, including a price axis appearing or hiding, and to a chart that was hidden (zero width) and shown again.

`followNewBars` decides what happens when bars are appended:

| Value | Behaviour |
| --- | --- |
| `'whenAtEnd'` (default) | While the newest bar is on screen the view scrolls with new bars; otherwise it stays on the bars the user is looking at |
| `'always'` | Like `'whenAtEnd'`, and a new bar also scrolls back from older bars to the newest one, with the configured `rightOffset`, stopping any inertia or eased zoom |
| `'never'` | The view never moves; new bars fill the empty space on the right and then go off screen |

## When data changes

What the view does when new bars arrive:

| Change | Zoom (bar spacing) | Position |
| --- | --- | --- |
| First load of a symbol | `barSpacing` option | Newest bars, with `rightOffset` |
| `setSymbol` to another symbol | Kept (`keepZoomOnSymbolChange`, default `true`); off, back to `barSpacing` and every pane autoscaled | Newest bars, with `rightOffset`. A view wider than the first load pages in older history until it is filled |
| `setSymbol` to another interval of the same symbol | Kept | Newest bars; with `keepRangeOnIntervalChange`, the same start and end times (the newest bar when the view reached it) after paging in the history they need |
| `setData` on the main series | Kept | Same distance from the newest bar, so a longer or shorter series shifts the times in view. With `{ keepVisibleRange: true }`, the same start and end times when the new bars cover them |
| Older history page | Kept | Unchanged: the bars in view stay put |
| New bar (`update`, live data) | Kept | See `followNewBars` above |

A view change made while a `setSymbol` load is pending (`setVisibleTimeRange`, `fitContent`, `scrollToRealtime`, `resetView`) wins over the rows above. Otherwise new data never resets the price scale: a scale you dragged keeps its range until you call `resetView` or turn autoscale back on, also on a symbol with a different price level.

## Bar spacing and logical indices

Every bar has a logical index: 0 is the oldest loaded bar, and the count goes on past the newest bar into the empty space on the right (and below 0 to the left). Bar `i` is centred on index `i`, and fractional indices fall between bars.

```ts
chart.barSpacing;                        // px per bar
chart.setBarSpacing(12);                 // zoom, keeping the right edge in place
chart.setBarSpacing(12, x);              // zoom around chart-root x, like the mouse wheel
chart.getVisibleIndexRange();            // { from, to } fractional indices at the plot edges, or null
chart.setVisibleIndexRange(100.5, 180);  // show exactly that span (animates; pass false to jump)
```

Like `setVisibleTimeRange`, `setVisibleIndexRange` turns the main pane's autoscale back on, except on a scale with a [locked price-to-bar ratio](#lock-the-price-to-bar-ratio).

These go through the same limits as panning and zooming with the mouse: `minBarSpacing` and `maxBarSpacing`, and the rule that keeps some bars on screen. Near the ends of the data the view you get can therefore differ from the one you asked for; read it back with `getVisibleIndexRange()`. They throw a `RangeError` for non-finite values, a spacing of 0 or less, or `from >= to`.

### Time after the last bar

The space right of the newest bar has times too: drawings placed there, `timeToX` for a future time, the crosshair time label, and the time-axis labels and vertical grid lines, which continue into it. They follow a projected bar calendar rather than a fixed step, so a point placed "next Monday" from Friday's last daily bar lands on the next bar slot, not two weekend slots later:

| Bars | Next bar |
| --- | --- |
| Intraday, with a `session` | The interval while inside the session, then the next session open (holidays, one-day overrides and overnight sessions included) |
| Daily, with a `session` | The next day the session trades |
| Daily, without one | The next day on a weekday the recent bars fall on, so stock data skips weekends on its own |
| Intraday without a session, weekly and longer | The fixed bar interval |

The projection follows the chart's `timezone`, and it moves as soon as a bar arrives or the session changes. Far ahead (past 20,000 projected bars) it continues with the fixed interval. Before the oldest bar, times are still extrapolated by the bar interval.

Series points can sit on the projected bars too, for a forecast or a known future schedule. A point after the newest bar is drawn when its time is a projected bar time; `chart.timeline.projected(n)` gives the next `n`:

```ts
const last = bars[bars.length - 1];
const forecast = chart.addLine({ title: 'Forecast', lineStyle: 'dashed' });
forecast.setData([
  { time: last.time, value: last.close },
  ...chart.timeline.projected(20).map((time, k) => ({ time, value: last.close + drift * (k + 1) })),
]);
```

These points count in autoscale and show in the legend like any other while in view. When a bar arrives where the projection had none (an unexpected session), they move with the projection to keep their times. A point between projected bars (a closed day, say) is not drawn, as for a point between real bars.

## Position HTML over the chart

To put your own HTML on the chart (a callout, a badge, an order ticket), convert data positions to pixels. All of these use **chart-root css px**: offsets from the top-left corner of `chart.root`, the same frame `pointAt` and the pointer events use.

| Method | Returns |
| --- | --- |
| `coordinateFor(time, price?, pane = 0)` | `{ x, y }` for a bar centre, with `y: null` without a price. `pointAt` snaps x to the nearest bar, so this is its inverse at bar centres |
| `timeToX(time)` / `xToTime(x)` | x of a time (extrapolated past the data) / the time of the nearest bar |
| `indexToX(index)` / `xToIndex(x)` | x of a fractional logical index, and back |
| `priceToY(price, pane = 0, scale?)` / `yToPrice(y, pane?, scale?)` | y of a price on a pane's scale, and back. `yToPrice` without a pane uses the pane under `y` |
| `paneBounds()` | `{ pane, top, height }[]`; a pane hidden because another is maximized has height 0 |
| `plotRect` | `{ x, y, width, height }` of the plot area, without the axes |
| `priceAxisSpace('left' \| 'right')` | Space all of that side's price axis columns take (one `priceAxisWidth` column per scale, or the measured width in auto mode) |

`priceToY` and `yToPrice` use the pane's primary scale (the one `pointAt` reads) unless you pass a scale id such as `'left'`. They work in prices in every mode: in `percent` or `indexed` mode pass the price, not the percentage. Looking up a scale id that does not exist returns `null` and does not create the scale.

The conversions return `null` instead of throwing before the chart has a size, without data (for the x conversions), for a pane that does not exist or is hidden, for an unknown scale id, for non-finite input, and for a price at or below zero on a log scale (it has no position there). A position outside the visible area still converts; check it against `plotRect` and `paneBounds()` if you only want to show what is in view.

Positions change with every pan, zoom, resize, pane change and autoscale step. The conversions read the scales as the last frame drew them, so right after a call that moves the view (such as `setBarSpacing` or `setPriceScaleMode`) a price position is only valid after the next frame. `view:change` fires after that frame, at most once per frame, whenever anything a position depends on moved, so re-place your elements there rather than right after the call. Its payload is `{ barSpacing, fromIndex, toIndex }`, the fractional logical indices at the plot edges. Here is a callout that follows a bar's high:

```ts
const callout = document.createElement('div');
callout.className = 'callout';
callout.textContent = 'Earnings';
Object.assign(callout.style, { position: 'absolute', pointerEvents: 'none', transform: 'translate(-50%, -100%)' });
chart.root.appendChild(callout);

const bar = { time: 1_700_000_000, high: 182.4 };

function place(): void {
  const at = chart.coordinateFor(bar.time, bar.high);
  const y = at?.y ?? null;
  const plot = chart.plotRect;
  const pane = chart.paneBounds()[0];
  const visible =
    at !== null && y !== null && pane !== undefined &&
    at.x >= plot.x && at.x <= plot.x + plot.width &&
    y >= pane.top && y <= pane.top + pane.height;
  callout.style.display = visible ? '' : 'none';
  if (visible) {
    callout.style.left = `${at.x}px`;
    callout.style.top = `${y - 6}px`;
  }
}

const off = chart.on('view:change', place);
place();
// later: off(); callout.remove();
```

`chart.root` is positioned, so absolutely positioned children line up with chart-root px. Keep `pointer-events: none` on decorations so the chart still gets the pointer; leave it on for elements people click, such as a ticket's buttons.

## Price scale mode

Each price scale has one of four modes:

| Mode | Shows |
| --- | --- |
| `normal` | Linear prices |
| `log` | Logarithmic prices, for long histories or big moves |
| `percent` | Change relative to a base value, by default the first visible one |
| `indexed` | Prices indexed to 100 at the base value |

```ts
chart.setPriceScaleMode('log');              // main pane, right scale
chart.setPriceScaleMode('percent', 1);       // second pane
chart.setPriceScaleMode('indexed', 0, 'left'); // left scale of the main pane
chart.getPriceScaleMode();                   // 'normal' | 'log' | 'percent' | 'indexed'
```

Log mode is applied on the GPU, so switching modes does not re-upload data.

### Percent base

Percent and indexed modes measure from the first visible value unless a scale's `percentBase` says otherwise:

| `percentBase` | Measures from |
| --- | --- |
| `'firstVisible'` (default) | The close of the first visible bar, which moves as you pan |
| `'sessionOpen'` | The open of the trading day that holds the newest visible bar |
| `'previousClose'` | The close of the bar before that trading day |
| `{ time }` | The close of the first bar at or after `time`, marked with a small triangle on the time axis |

```ts
chart.setPriceScaleOptions({ mode: 'percent', percentBase: 'previousClose' });
chart.setPriceScaleOptions({ percentBase: { time: Date.UTC(2024, 0, 2) / 1000 } }); // performance since 2 January
```

Trading days follow the time axis day boundaries, so the chart's timezone and session schedule apply: an overnight session's evening bars belong to the next day, and Monday's previous close is Friday's last bar. On daily and longer bars every bar is its own session. Series without an open (lines, histograms) use their value at the base bar.

Every series on the scale measures from the same bar, and so do compared symbols linked to it, so their lines stay comparable. The setting is saved in layouts and returned by `getPriceScaleOptions`.

A log scale needs data above zero. Autoscale fits only the positive values, so a line that crosses zero or a histogram based at 0 keeps a sensible range. Values at or below zero are drawn clipped at the bottom of the pane: histogram columns run off the bottom edge. A histogram's `base` stays in view only when it is above zero. When nothing visible on the scale is above zero, the scale keeps its last range and the `scale:change` event reports `noPositiveData: true` (see [Stay in sync](#stay-in-sync)); switching to log mode in that state shows prices 1 to 10.

## Several price scales

A pane can hold more than one price scale, so series in different units share it. Every series and indicator takes a `priceScale` id (default `'right'`):

```ts
chart.addCandles({ title: 'Price' });                            // right scale
chart.addLine({ title: 'Open interest', priceScale: 'left' });   // left scale
const flows = chart.addLine({ title: 'Flows', priceScale: 'flows' }); // overlay, no axis
chart.setPriceScaleOptions({ side: 'right' }, 0, 'flows');      // now a second right axis
chart.indicators.add(rsiDef, {}, { priceScale: 'left' });
```

An indicator definition can name its scale too; see [Indicators](./indicators#price-scale).

- `'right'` is the pane's default scale (its axis is on the right, or on the left when the chart's `direction` is right to left) and `'left'` gets a left axis. Any other id is created on first use as an overlay with no axis, until `setPriceScaleOptions` gives it a side.
- A scale's axis shows while a visible series is on it, and hides when everything on it is hidden. The right axis stays when nothing else on the pane has one.
- Each side gets as many axis columns as the busiest pane needs, each `priceAxisWidth` wide.
- With `priceAxisWidth: 'auto'` (the default), each side's columns fit the widest label they show: tick labels, the scale's top and bottom prices (which bound the crosshair label), and last-value labels with the countdown. The width is the label inset (8 px), the text and `priceAxis.padding`, kept between `priceAxis.minWidth` and `priceAxis.maxWidth`. A side grows at once but shrinks only when it would lose more than one font size, so prices that gain or lose a digit do not make the plot jump. A width change takes effect in the same frame; after `fitContent`, `setVisibleTimeRange` or `setVisibleIndexRange` the chart keeps that range in view until the user pans or zooms, otherwise it keeps the bar spacing. Pass a number, such as `priceAxisWidth: 76`, for a fixed width. Read the laid-out space with `priceAxisSpace(side)` to align your own elements.
- Last-value labels on one axis move apart instead of covering each other. The crosshair shows a price label on every axis of its pane.
- Drag an axis to zoom that scale; double-click it to autoscale again.
- Series with the `overlay` option keep their own private scale, as before.
- Drawings, pointer events and the `crosshair:move` event read prices on the pane's primary scale (`pane.primary`): the right scale while it shows, else the first scale with an axis. Drawings store prices, so when the primary scale changes (for example, the only right series is hidden and a left one takes over) they are drawn against the new scale and move with it. `chart.formatPrice(pane, price)` uses its format. Price and trade lines sit on their series' scale and label its axis.
- `setPriceScaleOptions({ side: 'none' })` on the right scale hides its axis even when nothing else on the pane has one.

`setPriceScaleOptions(options, pane = 0, scale = 'right')` sets `side` (`'left'`, `'right'` or `'none'`), `mode`, `invert` (higher prices lower down), `autoScale`, `marginTop`, `marginBottom`, `fixedRange`, `autoscaleRule`, `lockPriceToBarRatio` and `priceToBarRatio` (see below). `getPriceScaleOptions(pane, scale)` reads them back.

```ts
chart.setPriceScaleOptions({ invert: true }); // flip the main pane's right scale
```

## Axis lines, labels and the time axis

`priceAxis` and `timeAxis` style the axes; `applyOptions` merges a partial object into each.

```ts
chart.applyOptions({
  priceAxis: { ticks: true, fontSize: 11, labelMode: 'content', labelPointer: true },
  timeAxis: { ticks: true, border: false, showSeconds: true },
});
chart.applyOptions({ timeAxis: { visible: false } }); // a sparkline without a time axis
```

| `priceAxis` field | Default | What it does |
| --- | --- | --- |
| `ticks` | `false` | A 4 px mark at each tick label, on the plot edge of its column |
| `border` | `true` | The line between the plot and the price axes |
| `fontSize` | theme | Font size (px) of the price axis text and its filled labels; unset follows `theme.typography.axis` |
| `labelMode` | `'fill'` | Filled labels (last value, crosshair, selected drawing) span the column (`'fill'`) or fit their text (`'content'`) |
| `labelPointer` | `false` | Filled labels get a point on their plot side, its tip at the exact price |
| `labelPaddingY` | `4` | Space (px) above and below a filled label's text; labels on one axis keep this much further apart |

`padding`, `minWidth` and `maxWidth` size auto-width axes, above. In auto mode the column also makes room for the label point and measures in `fontSize`.

| `timeAxis` field | Default | What it does |
| --- | --- | --- |
| `visible` | `true` | Hidden, the time axis takes no space: the plot reaches the bottom edge, and its tick labels, the crosshair's bottom time label and drawing time labels go with it. A crosshair time label at the top of the plot (`crosshair.timeLabelPosition: 'top'`) stays |
| `height` | `28` | Height in px |
| `ticks` | `false` | A 4 px mark under each time label |
| `border` | `true` | The line between the plot and the time axis |
| `showTime` | `true` | The built-in crosshair and drawing time labels show the time of day for intraday bars; off, the date only |
| `showSeconds` | `false` | Built-in times of day show seconds: tick labels, the crosshair and drawing labels. Useful for bars shorter than a minute |
| `fontSize` | theme | Font size (px) of the time axis text and its labels |

`formatTime` and `formatTimeTick` replace the built-in labels, so `showTime` and `showSeconds` do not apply to them. The chart settings schema (`chartSettingsSchema`) has an **Axes** group with these switches.

## Autoscale

Autoscale fits the price range to the visible data and eases toward it (`smoothScale`). Dragging the price axis turns it off for that pane; double-clicking the axis turns it back on.

```ts
chart.setAutoScale(false);   // main pane
chart.isAutoScale(1);        // second pane
chart.setAutoScale(true, 0, 'left');
```

### Per-series autoscale

By default every visible series fits on its scale. The `autoscale` option on candle, line, histogram and custom series changes that:

```ts
// Shown, but never stretches the price range (it may run off the pane).
chart.addLine({ autoscale: false }).setData(longAverage);

// Adjust the range the series adds: here 5 above and below its values.
chart.addLine({
  autoscale: (range, { mode, from, to }) => range && { low: range.low - 5, high: range.high + 5 },
});

series.applyOptions({ autoscale: true }); // fit its values again
```

The function gets `{ low, high }` for the series' visible values (null when none are visible) and returns the range to fit, or null to add nothing this frame. The second argument holds the series, the visible logical indices `from` and `to`, and the scale `mode`. Ranges are prices in every mode. On a log scale, values at or below zero are left out. A non-finite result adds nothing. If the function throws, the chart reports it once through `series:error` (hook `'autoscale'`) and fits the series' values meanwhile. Primitives attached to a series still add their own ranges. If every series on a scale is left out, the scale keeps its last range.

### Autoscale rule

`autoscaleRule` on a price scale adjusts the range fitted to its data before the margins are added:

```ts
chart.setPriceScaleOptions({ autoscaleRule: { centerOn: 0 } }, 1); // a histogram around zero
chart.setPriceScaleOptions({ autoscaleRule: { include: [100], minSpan: 2 } });
chart.setPriceScaleOptions({ autoscaleRule: null }); // fit the data as it is
```

| Field | Effect |
| --- | --- |
| `include` | Prices the range always reaches, e.g. a target level |
| `minSpan` | Smallest price span to fit, so flat data does not zoom into noise. The range widens around its middle |
| `centerOn` | A price kept in the middle, so positive and negative values compare honestly |

They apply in that order (`include`, then `minSpan`, then `centerOn`), and only while there is visible data to fit. Values are prices in every mode, like `fixedRange`, which wins over the rule. On a log scale, `include` and `centerOn` skip values at or below zero, `centerOn` centres on a ratio (10 below 40 means 160 above it), and a `minSpan` that would reach zero widens upwards instead. `setPriceScaleOptions` throws a `RangeError` for a rule that is not finite, a `minSpan` that is not positive or an unknown field. Layouts save and restore the rule. A pane indicator can declare one in its definition (see [Fixed pane range](./indicators#fixed-pane-range)).

## Set and read a price range

`setPriceRange` shows exactly a price range and turns autoscale off; `getPriceRange` reads what a scale shows. Both use prices in every mode (log, percent and indexed included), with `from` the lower price and `to` the higher, also on an inverted scale (where `from` is at the top). Use them to restore a saved view or to give two charts the same price range.

```ts
chart.setPriceRange({ from: 60000, to: 68000 });         // main pane, eased with `true` as 4th argument
chart.setPriceRange({ from: 0, to: 50 }, 1, 'right', true);
const { from, to } = chart.getPriceRange()!;              // null for a pane or scale that does not exist
other.setPriceRange(chart.getPriceRange()!);
```

A log scale needs prices above zero; equal, non-finite or (on a log scale) non-positive prices throw a `RangeError`. Double-click the axis or call `setAutoScale(true)` to fit the data again.

## Fixed range

`fixedRange` gives a scale a range that autoscale always shows, whatever the data, with no margins. It suits oscillators bounded to 0–100:

```ts
chart.setPriceScaleOptions({ fixedRange: { min: 0, max: 100 } }, 1);
chart.setPriceScaleOptions({ fixedRange: null }, 1); // fit the data again
```

Like `setPriceRange`, `min` and `max` are prices in every mode, percent and indexed included. Setting a fixed range at or below zero on a scale that is already log throws a `RangeError`. Switching a scale with such a range (say 0–100) to log does not throw: while in log mode the scale ignores the fixed range and fits the data above zero as usual, and the fixed range applies again once the scale leaves log mode.

Zooming the axis by hand still turns autoscale off, and turning it back on returns to the fixed range.

A pane indicator can declare a fixed range in its definition (see [Fixed pane range](./indicators#fixed-pane-range)); the built-in RSI pane opens on 0–100.

On a percent or indexed scale, compared symbols keep sharing the axis while it shows a fixed, manual or locked range: their lines are placed on the same percent range the axis shows.

## Lock the price-to-bar ratio

With `lockPriceToBarRatio`, zooming the time axis scales prices by the same factor, so the angle of a trend line or a drawing stays the same as you zoom. Locking turns autoscale off, and turning autoscale on (`setAutoScale(true)`, double-clicking the axis, `resetView` or `setPriceScaleMode`) unlocks it. `fitContent`, `setVisibleTimeRange` and `setVisibleIndexRange` keep the lock, so the angles stay put through them too. Changing the mode with `setPriceScaleOptions({ mode })` keeps the lock and takes the ratio again in the new mode's units, and so does dragging the price axis or calling `setPriceRange` while locked. The UI shell's [chart settings](./ui-shell#chart-settings) have it for the main pane, as **Keep line angles when zooming** (the `priceScale.lockPriceToBarRatio` setting).

`priceToBarRatio` is the locked ratio, in price-scale coordinate units per bar width (log10 units in log mode). Save it and pass it back to restore the same view later. It reads `null` while unlocked, or while locked before the chart is laid out; passing `null` (or leaving it out) with `lockPriceToBarRatio: true` locks at the current ratio, so options read back can always be passed back:

```ts
chart.setPriceScaleOptions({ lockPriceToBarRatio: true });
const saved = chart.getPriceScaleOptions()!.priceToBarRatio;
// later
chart.setPriceScaleOptions({ lockPriceToBarRatio: true, priceToBarRatio: saved });
```

## Stay in sync

`scale:change` fires whenever a scale's mode, inversion, autoscale, fixed range or ratio lock changes, from code or from the user. Use it to keep your own buttons in sync.

```ts
chart.on('scale:change', ({ pane, scale, mode, autoScale, invert }) => {
  if (pane === 0 && scale === 'right') renderScaleButtons(mode, autoScale);
});
```

It also fires when `noPositiveData` changes: `true` while a log scale has visible data but none of it above zero, for example to offer switching back to `normal`.

The UI's [price scale menu](./ui-shell#bottom-bar) (`scaleMode()`, in the default toolbar) and the inline `scaleModeInline()` controls are wired this way: linear, log or percent (an indexed scale shows as percent) and `auto`.
