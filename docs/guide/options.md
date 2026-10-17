---
description: "Every chart option with its default, set at creation or changed later with applyOptions."
---

# Options

Pass options at creation or change them later. Every option is optional.

Development builds warn about unknown keys (with the closest valid one), wrong types, out-of-range numbers and unreadable colours, in chart, pane, series, drawing style and shell options; see [Errors and warnings](./errors#development-warnings).

```ts
const chart = createChart(el, { barSpacing: 10, inertia: false });
chart.applyOptions({ features: { legend: false } });
```

| Option | Default | Notes |
| --- | --- | --- |
| `theme` | `{}` | Partial [`ChartTheme`](./theming#chart-colors) |
| `grid` | both directions visible, solid | `{ horizontal, vertical }`, each `{ visible, color?, lineStyle }`; partial at any depth. See [Grid](./theming#grid) |
| `features` | all on | Built-in UI and input switches; see [Feature flags](./features) |
| `access` | no rules | Which drawing tools and indicators users may add, the indicator limit, and how built-in UI shows refused items; see [Access rules](./features#access-rules) |
| `barSpacing` | `10` | Initial px per bar: the narrowest whole spacing where a candle body (`bodyRatio` 0.7) loses nothing to rounding at 1x and 2x pixel ratio and keeps the wick's parity, so body, wick and gap all fit (7 + 3 px at 1x) |
| `minBarSpacing` | `0.5` | Zoom-out limit, unless `grouping` is on (with the `grouping()` plugin): one device pixel per bar at 2x, below which bars overlap |
| `maxBarSpacing` | `63` | Zoom-in limit: the narrowest spacing at which a candle body (`bodyRatio` 0.7) is a 44 px pointer target (the WCAG target size), `ceil(44 / 0.7)`. Wider bars add no detail, only fewer bars on screen |
| `rightOffset` | `5` | Empty bars right of the newest bar: the forming bar's right half plus a 44 px pointer target (the WCAG target size) for drawings just ahead of it, at the default spacing, `ceil(0.5 + 44 / 10)` |
| `fixLeftEdge` | `false` | The view cannot go before the first bar; see [Limit where the view can go](./view-and-scale#limit-where-the-view-can-go) |
| `fixRightEdge` | `false` | The view cannot go past the newest bar plus `rightOffset` |
| `maxRightOffset` | none | Most empty bars allowed right of the newest bar |
| `minBarCoverage` | `0.5` | Share of the plot width (0 to 1) bars keep covering when panning towards either end. Half, so the data stays the larger part of the view at every zoom |
| `lockVisibleRangeOnResize` | `false` | When the plot width changes, rescale the bar spacing so the same bars stay visible |
| `followNewBars` | `'whenAtEnd'` | When bars are appended: `'whenAtEnd'` scrolls with them while the newest bar is on screen, `'always'` also scrolls back to the newest bar from older bars, `'never'` keeps the view where it is |
| `priceAxisWidth` | `'auto'` | Width of one price axis column in px, or `'auto'` to fit each side to its widest label (pass `76` for the old fixed width); see [Several price scales](./view-and-scale#several-price-scales) |
| `priceAxis` | `{ padding: 8, minWidth: 48, ticks: false, border: true, labelMode: 'fill', labelPointer: false, labelPaddingY: 4 }` | Auto width sizing (`padding` after the widest label, `minWidth`, an optional `maxWidth`, in px), tick marks, the border line, an optional `fontSize` and the filled labels; see [Axis lines, labels and the time axis](./view-and-scale#axis-lines-labels-and-the-time-axis). `applyOptions` merges a partial one |
| `timeAxis` | `{ visible: true, height: 28, ticks: false, border: true, showTime: true, showSeconds: false }` | Hide the time axis, its height, tick marks, the border line, an optional `fontSize`, and whether built-in time labels show the time of day and seconds. `applyOptions` merges a partial one |
| `legend` | see [Legend](#legend) | Legend settings |
| `paneButtons` | `true` | Move, maximize, collapse and remove buttons when hovering a pane |
| `paneDoubleClickMaximize` | `true` | Double-clicking a pane's plot maximizes it, or restores the others; see [Panes](./panes) |
| `direction` | `'auto'` | `'ltr'`, `'rtl'` or `'auto'` (the container's computed `direction`, read on creation and on each `applyOptions`). In `'rtl'` the main price axis defaults to the left, the legend's `start` corners are on the right, and the pane buttons and the scroll-to-newest button sit on the left. Time still runs left to right; see [Localization](./localization.md) |
| `crosshair` | see [Crosshair](#crosshair) | Mode, line styles, labels and the time label's position |
| `scrollButton` | `true` | Floating button that scrolls back to the newest bar |
| `inertia` | `true` | Momentum after drag-panning |
| `smoothZoom` | `true` | Animate mouse-wheel zoom and scroll steps |
| `zoomAnchor` | `{ plot: 'pointer', timeAxis: 'right-edge' }` | What a time zoom keeps fixed: `'pointer'`, `'newest'` (the newest bar while it is on screen) or `'right-edge'`. `plot` covers the wheel, pinch and `+` / `-` keys, `timeAxis` the time-axis drag. One string sets both; `applyOptions` merges a partial object. See [zoom anchor](./interaction#zoom-anchor) |
| `smoothScale` | `true` | Ease price-scale changes instead of jumping |
| `animateViewChanges` | `true` | Animate `scrollToRealtime`, `fitContent`, range changes |
| `renderWhenHidden` | `false` | Keep drawing while the chart is scrolled out of view or its tab is hidden. Off, a hidden chart stays current but draws only when shown again. See [several charts](./embedding#several-charts-on-one-page) |
| `historyThreshold` | `20` | Bars from the left edge that fire `history:request` |
| `keepZoomOnSymbolChange` | `true` | When `setSymbol` loads another symbol, keep the bar spacing: the new symbol opens at its newest bars with the same number of bars in view, and pages in older history while the view is wider than its first load. Off, it opens at the default zoom with every pane autoscaled, like `resetView`. See [when data changes](./view-and-scale#when-data-changes) |
| `adjustment` | `'none'` | Back-adjust a data source's bars for splits (`'splits'`) or every corporate action (`'all'`). See [splits and dividends](./data-sources#splits-and-dividends) |
| `adjustmentMarkers` | `true` | Mark the data source's splits and dividends on the main series, in the bottom lane. See [splits and dividends](./data-sources#splits-and-dividends) |
| `marks` | `true` | Draw the data source's [markers](./data-sources#markers) placed on bars, on the main series. With `timeMarks` also off, none are fetched |
| `timeMarks` | `true` | Draw the data source's `timeAxis` [markers](./data-sources#markers) and the band under the time labels that holds them. With `marks` also off, none are fetched |
| `keepRangeOnIntervalChange` | `false` | When `setSymbol` changes only the interval, keep the visible start and end times; a view reaching the newest bar keeps the newest bar at its right edge. Older history pages in until the range is covered, one page per task so a fast source never blocks the page, then the view fits it once. A range too long for `minBarSpacing` keeps its right edge, and only the history that fits beside it is paged in. A view change made while the new interval loads (`setVisibleTimeRange`, `scrollToRealtime`, `fitContent`, `resetView`) wins: it is applied again to the new bars, a time range after paging in the history it needs. Panning or zooming while the history pages in stops it; live bars and the edge limits adjusting the view do not |
| `touchInspect` | `'release'` | Touch long-press inspection; see [Interaction](./interaction#pointer). `'tap'` keeps the crosshair until the next tap, `'off'` disables it |
| `sketch` | `{ holdMs: 500 }` | How long (ms) a still mouse or pen press waits before it starts a sketch, and on touch the extra hold after the long-press, with the `sketch` feature flag; see [Sketch a drawing](./drawings#sketch-a-drawing). `applyOptions` merges a partial one, and a change applies from the next press |
| `timezone` | `'local'` | IANA timezone for axis labels, the crosshair, the countdown and the bottom-bar clock; `'local'` is the machine's timezone |
| `localization` | `{}` | Language of numbers, dates and built-in text: `locale`, `decimalSeparator`, `grouping`, `hourCycle`, `dateFormat`, `messages`, `translate`; needs the `localization()` plugin; see [Localization](./localization) |
| `applySymbolTimezone` | `false` | Show each symbol loaded through the data source in its `SymbolInfo.timezone`, or in `timezone` when it has none. Setting `timezone` with `applyOptions` while this is on keeps that timezone for later symbols, until this is set to `true` again |
| `session` | `ALWAYS_OPEN` | Trading hours in `timezone` as a `SessionSchedule`; see [Timezones and sessions](#timezones-and-sessions) |
| `sessionBreaks` | `true` | Trading day dividers: a dashed line where each trading day starts (intraday, with a session) |
| `sessionShading` | `false` | Shade bars outside the session |
| `extendedSession` | none | Pre- and post-market hours around `session`, for the [market phase](./data-sources#market-and-data-status) |
| `marketStatus` | `true` | Market phase and data delay badge in the main pane's legend. Needs the [`marketStatus()`](./features#opt-in-features) plugin |
| `formatTime` | built in | `(time, intervalSec) => string` for the crosshair time label |
| `formatTimeTick` | built in | `(time, weight) => string` for time-axis labels; `weight` is a `TickWeight` (`Minute` up to `Year`) |
| `accessibility` | `{ summary: true, crosshairReadout: false, throttleMs: 1000, announceBars: false, announceIntervalMs: 5000 }` | Screen reader summary, crosshair readout and announcements; merged by `applyOptions`. See [screen readers](./interaction#screen-readers) |
| `maxGlDpr` | `2` | Device pixel ratio cap for the WebGL layer. See [pixel ratio](./embedding#pixel-ratio) |
| `focusable` | `true` | In the page's Tab order; `false` leaves it out while a click still focuses it. See [keyboard and focus](./embedding#keyboard-and-focus) |
| `lowPower` | `false` | Spend less GPU and battery: no decorative animations, the WebGL layer at pixel ratio 1, heatmaps sampled once per pixel, at most 20 frames a second while idle. See [low-power mode](./performance#low-power-mode) |
| `renderStats` | `false` | Measure each frame (GPU work, CPU time, GPU memory) for `chart.frameStats` and the `frame:render` event. Needs the `statsOverlay()` plugin; see [Debugging and profiling](./performance#debugging-and-profiling) |
| `renderStatsOverlay` | `false` | Show those numbers on the chart: `true` draws a small panel with a frame-time sparkline and the last frame's counters, `'bounds'` also outlines the panes and axis areas and shades drawing hit regions. Measures frames while on. Needs the `statsOverlay()` plugin; see [On-chart overlay](./performance#on-chart-overlay) |
| `interactive` | `true` | `false` makes a static chart: no input, crosshair or animations, and a WebGL context held only while it draws. Set at creation. See [limits](./performance#limits) |
| `grouping` | `null` | `{ mode: 'pixel' }` draws several bars as one when zoomed out far, so any number of bars fits; needs the `grouping()` plugin; see [Group bars when zoomed out](./view-and-scale#group-bars-when-zoomed-out) |
| `referenceLines` | all off | Previous close, visible high/low/average, bid/ask and extended-hours lines, per line; needs the `referenceLines()` plugin; see [Reference lines](./reference-lines) |

All animations also respect `prefers-reduced-motion`.

`defaultChartOptions` is exported if you want to read the defaults in code.

## Timezones and sessions

```ts
import type { SessionSchedule } from '@charton/core';

const regularHours: SessionSchedule = {
  weekly: {
    mon: [{ start: '09:30', end: '16:00' }],
    tue: [{ start: '09:30', end: '16:00' }],
    wed: [{ start: '09:30', end: '16:00' }],
    thu: [{ start: '09:30', end: '16:00' }],
    fri: [{ start: '09:30', end: '16:00' }],
  },
  holidays: ['2024-12-25'],
  overrides: { '2024-12-24': [{ start: '09:30', end: '13:00' }] },
};

chart.applyOptions({ timezone: 'America/New_York', session: regularHours });
```

Bar times stay unix seconds; only the display changes. Labels are DST-correct (through `Intl`), and daily or longer bars count down to the next local midnight.

By default the chart shows times in the viewer's own timezone (`'local'`, read from `Intl`, falling back to `'UTC'` when the machine reports none). Set `timezone: 'UTC'` to keep UTC, and `'local'` switches back at runtime. `chart.zone.name` is the resolved IANA name. `'local'` is resolved when the option is applied, so if the machine's timezone changes while a chart is open, call `applyOptions({ timezone: 'local' })` to pick it up. Session hours (`session`, `extendedSession`) are read in this zone too, so a chart that sets a session without a `timezone` now reads those hours in local time.

`session` hours are read in the chart's timezone, so a chart showing exchange trading hours should set `timezone` explicitly, for example from the symbol's `SymbolInfo.timezone`, rather than rely on the viewer's zone:

```ts
const info = await source.symbol('ABC');
chart.applyOptions({ timezone: info.timezone ?? 'UTC', session: regularHours });
```

`session` is a `SessionSchedule`, in the chart's `timezone`:

| Field | Type | Notes |
| --- | --- | --- |
| `weekly` | `{ mon?, tue?, wed?, thu?, fri?, sat?, sun?: SessionRange[] }` | Ranges per weekday of the trading day. A missing or empty day is closed. |
| `holidays` | `string[]` | ISO dates (`'YYYY-MM-DD'`) of trading days with no session |
| `overrides` | `Record<string, SessionRange[]>` | One-day hours keyed by ISO date; they win over `holidays`, and `[]` closes the day |

A `SessionRange` is `{ start: 'HH:MM', end: 'HH:MM' }`. Use `'24:00'` as `end` to run to midnight. When `end` is at or before `start` the range is overnight: it starts the evening before the trading day. With `{ start: '18:00', end: '17:00' }` under `mon`, trading opens on Sunday at 18:00 and those bars belong to Monday, so day, month and year boundaries on the axis move to 18:00. A day can have several ranges (`'04:00'`–`'09:30'` and `'09:30'`–`'20:00'`) but at most one overnight range, and ranges must not overlap. Invalid schedules throw.

The default is `ALWAYS_OPEN` (every day, `00:00`–`24:00`), which draws no session breaks or shading. Gaps such as nights and weekends take no space, because the axis is indexed by bar.

Schedules are plain objects, so a schedule that repeats the same hours is built with ordinary code:

```ts
import { ALWAYS_OPEN, type SessionSchedule } from '@charton/core';

// The same hours Monday to Friday.
const weekdays = (start: string, end: string): SessionSchedule => {
  const day = [{ start, end }];
  return { weekly: { mon: day, tue: day, wed: day, thu: day, fri: day } };
};

chart.applyOptions({ session: weekdays('18:00', '17:00') }); // Sunday 18:00 opens Monday
chart.applyOptions({ session: ALWAYS_OPEN }); // around the clock
```

`chart.zone` exposes the active `Zone` (`offset(time)`, `wall(time)`, `fromWall(wall)`, `date(time)`). `zoneOf(name)` (which accepts `'local'`), `localTimeZone()`, `compileSession(schedule)`, `inSession(session, wall)` and `tradingDay(session, wall)` are exported too.

## Legend

```ts
chart.applyOptions({
  legend: {
    position: 'top-end',    // 'top-start' (default), 'top-end', 'bottom-start', 'bottom-end', or 'top-left' and the other physical corners
    mode: 'compact',        // 'full' (default), 'compact' (close or value only), 'title'
    showChange: true,       // candles: change and % from the previous close (default true)
    changeArrows: false,    // ▲ / ▼ before the change, so it does not rest on colour alone (default false)
    whenIdle: 'last',       // no crosshair: 'last' shows the newest bar (default), 'hidden' titles only
    background: 'auto',     // backdrop behind the rows: 'auto' on panes showing a heatmap (default), true on every pane, false on none
    hiddenSeries: 'dimmed', // hidden series: 'dimmed' rows with an eye button (default), 'omit' leaves them out
    formatter: (entry, series) => (series.kind === 'histogram' ? { ...entry, title: `${entry.title} (lots)` } : entry),
  },
});
chart.legendSettings; // the resolved settings
```

Fields left out keep their value. `formatter` gets each row (`{ title, parts }`) after the mode is applied and returns the row to show; pass `formatter: undefined` to remove it. A formatter that throws is logged once and its rows are shown unformatted. Give a series `legend: false` to leave its row out. Screenshots and `chart.valuesAt()` use the same settings, so their legend text matches the chart. `legend: { visible: false }` is the same as `features.legend: false`, and `chart.options.legend` mirrors the resolved settings with `visible`.

- `whenIdle: 'hidden'` applies to `chart.valuesAt()` too: without a crosshair (and without a `time` argument) its `legend` rows carry titles only. The raw `values` are unaffected.
- `hiddenSeries: 'omit'` leaves hidden series out of the legend, its height, the `legend` rows of `chart.valuesAt()` (`null`, the raw `values` stay) and screenshots. Visible rows keep their buttons; a series hidden this way comes back through `series.setVisible(true)` or the app's own UI.
- While the pointer is over a legend row, every row keeps the values it showed when the pointer arrived, so the row and its buttons (show or hide, settings, more, remove) stay put under the pointer; moving off the rows follows the crosshair again. Screenshots and `chart.valuesAt()` are unaffected.
- `background` puts a translucent panel of the chart background behind each pane's rows, so they stay legible over dense content such as heatmap cells. Screenshots draw it too.
- `showChange` applies to every candle series row, compared symbols included, not only the main series.
- With the Heikin-Ashi style, the change is measured against the previous Heikin-Ashi close, the candle you see, not the previous raw close.
- `start` and `end` follow the chart's `direction`: `'top-start'` is the top left in a left-to-right chart and the top right in a right-to-left one. `'top-left'`, `'top-right'`, `'bottom-left'` and `'bottom-right'` stay in that corner whatever the direction.
- In the end corners the legend moves clear of the buttons sharing them: below the pane buttons at the top (when there are several panes and `paneButtons` is on), and above the scroll-to-newest button at the bottom of the lowest pane (when `scrollButton` is on). Screenshots use the same placement.

## Crosshair

`crosshair` groups everything about the crosshair. `applyOptions` merges a partial one, so you can change a single field:

```ts
chart.applyOptions({
  crosshair: {
    mode: 'close',
    vertical: { lineStyle: 'dotted' },
    horizontal: { color: '#f59e0b', width: 1, lineStyle: 'solid' },
    horizontalInAllPanes: true,
    labels: { time: false },
    timeLabelPosition: 'top',
  },
});
```

| Field | Default | Notes |
| --- | --- | --- |
| `mode` | `'free'` | `'free'` follows the pointer, `'close'` snaps to the bar's close, `'ohlc'` to the visually nearest of open/high/low/close, `'hidden'` draws no crosshair. Snapping uses the main series' bars as drawn (Heikin Ashi bars for that style) in its pane, and is skipped while it is hidden, collapsed or on an overlay scale |
| `vertical`, `horizontal` | `{ visible: true, width: 1, lineStyle: 'dashed' }` | Each line's `visible`, `color` (default `theme.crosshair`), `width` (css px) and `lineStyle` (`'solid'`, `'dashed'`, `'dotted'`). Hiding the horizontal line also hides its price labels |
| `horizontalInAllPanes` | `false` | Also draw the horizontal line and its price labels at the same price in every other pane whose main scale shows it, to compare levels across panes |
| `labels` | `{ price: true, time: true }` | The price labels on the price axes and the time label |
| `timeLabelPosition` | `'bottom'` | `'bottom'` on the time axis, `'top'` at the top of the plot |
| `cursor` | `'cross'` | Whether crosshair lines follow the pointer over the plot: `'cross'` draws them, `'pointer'` leaves the platform's own pointer without lines. `'pointer'` keeps the axis labels, snapping and crosshair events; while a drawing tool is armed the lines show. The lines are the only thing the choice changes, so there are two; the pointer stays the platform's, so the user's pointer size and contrast settings keep working. The UI rail's cursor button picks it. A stored `'arrow'` loads as `'pointer'` and `'dot'` as `'cross'` |

The crosshair's price label is drawn over the axis, on top of the series' last-value labels; when the crosshair sits near the last price, it covers that label.

### Locking the crosshair

`chart.lockCrosshair(true)` holds the crosshair at its current time and price, so the legend and the data window keep showing that bar while the pointer moves away. Pan and zoom keep it on its bar. `chart.lockCrosshair(false)` releases it and hides it until the next pointer move, with a `null` `crosshair:move` event; `chart.crosshairLocked` tells which. Users lock and release it with Alt+click on the plot, and release it with Escape (with the chart hovered or focused, whatever the keyboard scope) or a touch tap on the plot. While locked, `setCrosshair` and `setCrosshairAt` are ignored, Ctrl+arrow keys do not step it (they are left to the page), a touch hold pans rather than inspects, and `crosshair:move` events carry `locked: true`.

A locked crosshair looks the same as a free one; show the lock in your own UI, from `crosshairLocked` or the event's `locked` field, if users need to see it.

