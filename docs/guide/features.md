---
description: "Turn built-in parts of the chart on or off with one features object."
---

# Feature flags

Turn built-in parts of the chart on or off with one `features` object. Flags you leave out keep their current value, so an update only names what changes. Changes apply on the next frame; the chart is not recreated.

```ts
import { createChart } from '@chart-on/core';

const chart = createChart(el, {
  features: { legend: false, keyboard: false },
});

chart.applyOptions({ features: { zoom: false } });
chart.features.zoom; // false
```

The defaults keep the full built-in behaviour. `defaultChartFeatures` is exported if you want to read them in code. Unknown flags are ignored; development builds warn about them, naming the closest flag ([`option-unknown`](./errors#option-unknown)).

`chart.features` is a read-only copy, and `chart.options.features` and `chart.options.legend` only mirror the current values. Writing to any of them has no effect; always change flags through `applyOptions`.

## Display

| Flag | Default | Controls |
| --- | --- | --- |
| `legend` | `true` | Series values in a corner of each pane (top start by default) |
| `legendButtons` | `true` | Show/hide, settings and remove buttons on each legend row, and a collapse toggle for long legends. Needs `legend` |
| `lastValueLabels` | `true` | Last-value labels on the price axis and the dotted last-price line |
| `countdown` | `true` | Time left in the current bar, under the last price label. Needs `lastValueLabels` and the [`countdown()`](#opt-in-features) plugin |
| `contextMenu` | `true` | Right click emits the `chart:contextmenu` event and suppresses the browser menu while something listens (the UI shell's menu does) |
| `watermark` | `false` | The symbol and interval behind the series ([Watermark](./watermark)) |
| `plusButton` | `true` | The "+" button by the crosshair price label, shown while something listens for `plus:click` ([Annotations](./annotations#plus-button)) |
| `attributionLogo` | `true` | The project mark in the centre of the main pane, behind the series, in the theme's `watermark` colour. While the [watermark](./watermark#project-mark) shows, it sits above the watermark's lines. It is drawn on the chart, not a link |

To hide the logo, turn the flag off when creating the chart, or later:

```ts
const chart = createChart(el, { features: { attributionLogo: false } });
chart.applyOptions({ features: { attributionLogo: false } });
```

The crosshair is not a feature flag. Its visibility and axis labels are crosshair options.

### Legend buttons

Hovering a legend row, or tabbing to it, reveals its buttons:

- **Hide / show** toggles the series and fires `series:visibility`. A hidden series keeps its row, dimmed, so it can be shown again; with the legend option `hiddenSeries: 'omit'` its row leaves the legend instead (see [legend options](./options#legend)).
- **Settings** fires `series:settings` with the series and its indicator (or `null`). The button only appears on rows something opens settings for, so the chart never offers a dead button. By default that is every row while something listens:

  ```ts
  chart.on('series:settings', ({ series, indicator }) => openSettings(indicator ?? series));
  ```

  When your listener handles only some rows, declare which with `chart.provideSeriesSettings`. Once any provider is declared, only the rows one of them covers get the button; `chart.hasSeriesSettings(series)` tells whether a row has one. A provider that throws covers nothing and is reported as `chart:error`. Each call returns a function that withdraws its provider:

  ```ts
  const off = chart.provideSeriesSettings((series, indicator) => indicator !== null);
  ```
- **More** opens the row's menu: it fires `chart:contextmenu` with target `'legend'` and the row's `series`, as does a right click or a touch long press on the row. The button only appears while something listens and the `contextMenu` feature is on; the [UI shell's menu](./ui-shell#context-menu) fills it with the indicator actions. Code can ask for settings with `chart.openSeriesSettings(series)` and fold a row to its title with `chart.setLegendFolded(series, true)`.
- **Remove** removes the series, or the whole indicator (and its pane) when the series belongs to one. The main series has no remove button. `series:remove` fires for every removal, from the legend or from code.

A pane with three or more rows also gets a collapse toggle that folds it to its first row. Pressing a row still pans the chart, and wheel zoom works over it; only the buttons take the press. With `legendButtons` off the legend is fully click-through and lists only visible series.

## Input

| Flag | Default | Controls |
| --- | --- | --- |
| `scroll` | `true` | Dragging the plot, horizontal wheel or trackpad scroll, momentum, `←` / `→`, double-clicking the time axis |
| `zoom` | `true` | Mouse wheel, trackpad pinch, touch pinch, `+` / `-` |
| `axisDragScale` | `true` | Dragging the price or time axis (including a `baseline` series' base level), and double-clicking the price axis to reset it |
| `keyboard` | `true` | Every keyboard shortcut, including the drawing ones (`Escape`, `Delete`, copy, paste, undo, redo) |
| `touchScroll` | `true` | One-finger drag on touch screens. Needs `scroll` |
| `touchZoom` | `true` | Two-finger pinch on touch screens. Needs `zoom` |
| `sketch` | `false` | Holding the plot still for half a second (the `sketch.holdMs` option) with a mouse or pen (or a touch long-press held a little longer), then drawing a stroke that becomes a drawing, or erases the drawings it scribbles over ([Drawings](./drawings#sketch-a-drawing)) |

`Alt` + `R` (reset view) needs both `scroll` and `zoom`. To lock the view completely, turn off `scroll`, `zoom` and `axisDragScale`.

Flags only gate user input. `scrollToRealtime()`, `fitContent()`, `setVisibleTimeRange()` and the other [view methods](./view-and-scale) keep working, so a locked chart can still be moved from code or by the shell's range buttons. The floating scroll-to-newest button has its own `scrollButton` [option](./options).

The `plot:click` and `plot:dblclick` [events](./events#click-on-the-chart) fire whatever the flags, so a locked chart still reports clicks.

Input the chart does not use goes to the page:

- With `zoom` off, the vertical wheel scrolls the page and `Ctrl` + wheel zooms it. With `scroll` off, the horizontal wheel goes to the page too.
- While one-finger drags do not pan the chart (`scroll` or `touchScroll` off), vertical swipes scroll the page. Horizontal drags still move the crosshair. If pinches do not zoom the chart either (`zoom` or `touchZoom` also off), they zoom the page. An active drawing tool or a selected drawing takes touch input back, so drawing still works.

Turning a flag off during a gesture ends that gesture: a drag or pinch stops, and so do momentum and eased zoom.

## Access rules

Restrict which drawing tools and indicators users get, for example to gate paid features, and cap how many indicators a chart holds. The app decides per item: `allow` is one function that gets `{ kind, id }` for each drawing tool (`kind: 'drawing'`) and indicator (`kind: 'indicator'`) and returns whether users may add it. An allow list, a deny list, a plan check or a feature flag are each a line in it. The `access` option sits next to `features` and changes at runtime the same way: fields you leave out keep their value.

```ts
const paidTools = new Set(['fib-retracement', 'pitchfork']);
const freeIndicators = new Set(['sma', 'ema', 'rsi']);

const chart = createChart(el, {
  access: {
    allow: ({ kind, id }) =>
      user.paid || (kind === 'drawing' ? !paidTools.has(id) : freeIndicators.has(id)),
    limits: { indicators: 3 },
    refused: 'disable',
  },
});

chart.on('tool:refuse', ({ tool }) => showUpgrade(tool));
chart.on('indicator:refuse', ({ type, reason }) => {
  if (reason === 'limit') showNotice('Remove an indicator to add another');
  else showUpgrade(type);
});

chart.applyOptions({ access: { limits: {} } }); // lift the cap
chart.applyOptions({ access: { allow: null } }); // allow everything again
```

| Field | Default | Controls |
| --- | --- | --- |
| `allow` | `null` | `(item: { kind: 'drawing' \| 'indicator'; id: string }) => boolean`: whether users may add the tool or indicator. `null` allows everything. Keep it fast: the rail and the picker ask it for every item they list |
| `limits` | `{}` | Caps per kind. `indicators` is the most indicators the chart holds, pending placeholders included. A patch replaces the whole object, so `{}` lifts every cap |
| `refused` | `'hide'` | How built-in UI shows refused items: left out (`'hide'`), or dimmed with `aria-disabled` and still pressable (`'disable'`), so a press fires the refusal event for the app to handle. Hidden by default, because an item the user cannot use should take no room unless the app wants to advertise it |

The rules are enforced by the chart, not only hidden in the UI:

- `drawings.setTool()` throws for a refused tool, after firing `tool:refuse` `{ tool }`. Drawings added from code with `drawings.add()` and loaded with `drawings.load()` are not restricted.
- `indicators.add()` and `indicators.duplicate()` throw for a refused indicator, after firing `indicator:refuse` `{ type, reason }`, where `reason` is `'blocked'` (the access rule said no; `refused` is only how built-in UI shows it) or `'limit'` (the chart is full). `indicators.refusal(id)` tells you in advance why an add would be refused, or `null`.
- For indicators the app adds itself, `add(id, inputs, { restricted: false })` skips both rules. Such indicators still count towards the limit.
- Saved layouts (`indicators.load()`, `loadLayout()`) are not restricted, so a saved chart never loses indicators. Filter the saved states first if a downgraded user should lose gated ones.
- Indicators already on the chart stay when a rule tightens; an active drawing tool that becomes refused is dropped.

The tool rail and the favourites bar of `@chart-on/ui` follow `allow` and `refused`. The legend menu's **Duplicate** item follows `allow` and `limits`. An indicator picker reads `indicators.refusal(id)` for each entry.

`chart.options.access` holds what `createChart` and `applyOptions` set. The rule is a function, so it is never saved with a layout. The lower-level calls `drawings.setAccess(allow)` and `indicators.setAccess(allow)` take the same `AccessRule` (`({ kind, id }) => boolean`, or `null`) for their own kind, and `indicators.setLimit(n)` sets the cap; they override the option until the next `applyOptions` that sets `allow` or `limits`. `drawings.access` and `indicators.access` return the rule each manager uses. They fire `access:change` and `indicators:access-change`. Built-in UI asks the rule again when these events fire, so when something the rule reads changes, for example after an upgrade, pass it again with `applyOptions({ access: { allow } })`. Changing only `refused` fires both events again with the managers' rules unchanged, so built-in UI redraws. An invalid `access` patch throws and changes nothing.

## Shell flags

`@chart-on/ui` has its own flags for the parts around the chart. Chart flags still go through `chart`.

```ts
import { createChartShell } from '@chart-on/ui';

const shell = createChartShell(el, {
  features: { bottomBar: false },
  chart: { features: { legend: false } },
});

shell.applyFeatures({ rail: false }); // hide the rail, keep its state
shell.features.rail;                  // false
shell.chart.applyOptions({ features: { legend: false } });
```

| Flag | Default | Controls |
| --- | --- | --- |
| `toolbar` | `true` | Top toolbar |
| `rail` | `true` | Left drawing-tool rail |
| `bottomBar` | `true` | Bottom bar |
| `tooltip` | `false` | Floating [pointer tooltip](./ui-shell#pointer-tooltip) with the hovered bar's values |
| `railSheet` | `false` | [Compact layout](./ui-shell#narrow-screens) below `railBreakpoint`: the rail opens as a bottom sheet, range presets (when the bottom bar has any) collapse into a menu |
| `commandPalette` | `true` | The [command palette](./ui-shell#command-palette) and its shortcut (Mod+K by default). Needs the shell's `commandPalette` option |

A hidden part keeps its element, state and listeners, and the chart grows into the space. The `toolbar`, `rail` and `bottomBar` [shell options](./ui-shell) still decide whether a part exists at all, so a flag cannot show a part the shell was created without.

The `toolbar` and `rail` flags share state with `shell.toolbar.setVisible()` and `shell.rail.setVisible()`: changing either one updates the other and emits `toolbar:change` or `rail:change`.

## Opt-in features

Some features are not part of a plain `createChart`, so apps that do not use them do not ship their code. Each is a [plugin](./plugins) the chart gets when it is created, or later with `chart.install`. Each chart has only the ones it was given.

| Plugin | Adds |
| --- | --- |
| `dataSource()` | `chart.setDataSource` and `chart.data` ([Data sources](./data-sources)): loading bars by symbol and interval, history paging on scroll-back, live bars and the snapshot cache. `comparisons()`, `sourceMarkers()`, `adjustments()` and `watermark()` work on what it loads. Without it, bars come through `setData` |
| `indicators()` | `chart.indicators` ([Indicators](./indicators)): indicator definitions, the indicators on the chart, their series, sets and undo steps (in `chart.history`, shared with drawings), and saved indicators in layouts. The definitions come from the app or other plugins |
| `comparisons()` | `chart.compare` ([compared symbols](./data-sources#compare-symbols)): other symbols or pairs from the data source, plotted next to the main one |
| `annotations()` | `chart.annotations` ([Annotations](./annotations)): bar markers, price, trade, alert and draft lines, zones, bands and text labels. The data source's [marks](./data-sources#marks) and time marks, corporate action markers and indicator shape plots draw through it too |
| `trading()` | Trade fills and trading lines on `chart.annotations` ([account fills](./annotations#account-fills), [trade lines](./annotations#trade-lines), [order drafts](./annotations#order-drafts), [alert lines](./annotations#alert-lines)): `setTrades`, `addTradeLine`, `addAlertLine`, `startOrderDraft`, `syncTrades` and the other fill calls. Needs annotations: list it after `annotations()` |
| `drawingTools(tools?)` | `chart.drawings` ([Drawing tools](./drawings)) with drawing tools and their undo steps (in `chart.history`, shared with indicators). Default: all of `builtinTools` |
| `drawings(tools?)` | `chart.drawings` with only the tools you pass, none by default, so the built-in tools stay out of the bundle. A chart takes this or `drawingTools`, not both |
| `heatmap()` | `chart.addHeatmap`, with its GPU program and hover inspector |
| `volumeProfile()` | `chart.addVolumeProfile` ([Volume profile](./volume-profile)) |
| `points()` | `chart.addPoints` ([Points](./series#points)) |
| `viewportBounds()` | `chart.setViewportBounds` ([Viewport bounds](./view-and-scale#viewport-bounds)) |
| `replay()` | `chart.replay` ([Bar replay](./replay#bar-replay)): hides the main series' bars after a chosen one and reveals them by step or on a timer |
| `depthLane()` | `chart.addDepthLane` ([Depth lane](./depth-lane)), and the space of every primitive's [lane](./primitives#lanes) |
| `sourceMarkers()` | Fetching the data source's [markers](./data-sources#markers), on bars and on the time axis: `chart.sourceMarkers` and the `sourcemarkers:*` events. They draw through `annotations()` |
| `adjustments()` | Corporate actions from the data source ([splits and dividends](./data-sources#splits-and-dividends)): back-adjusting bars under the `adjustment` option and their markers (`adjustmentMarkers`, drawn through `annotations()`) |
| `watermark()` | `chart.watermark` and the `watermark` feature flag ([Watermark](./watermark#built-in-watermark)): the symbol and interval behind the series. A watermark made with `createWatermark` needs no plugin |
| `layouts()` | `chart.serializeLayout` and `chart.loadLayout` ([Save and restore layouts](./layouts)), which `autosave` and `loadLastLayout` use. `state:change` and `layoutLoading` need no plugin |
| `referenceLines()` | `chart.referenceLines` and the `referenceLines` option ([Reference lines](./reference-lines)): previous close, visible high, low and average, bid, ask and extended hours. Without it the option is kept but draws nothing |
| `priceStyles()` | The `kagi` and `pointFigure` candle styles for [price-based bars](./series#price-based-bars). Without it a series in either style draws nothing; `priceBars` and `PriceBarBuilder` need no plugin |
| `grouping()` | The `grouping` option ([Group bars when zoomed out](./view-and-scale#group-bars-when-zoomed-out)): pixel and calendar buckets, `chart.grouping` and `grouping:change`. Without it the option draws single bars |
| `lastPointPulse()` | The `lastPointPulse` series option ([Last-point pulse](./series#last-point-pulse)): a ring on the newest point of a line, area, step or baseline. Without it the option is kept but draws nothing |
| `localization()` | The `localization` option ([Localization](./localization)): numbers, dates and built-in text through `Intl`, message overrides and `translate`. Without it the chart keeps `englishLocalizer` and only checks the option |
| `imageCapture()` | `chart.captureImage` ([Screenshot](./events#screenshot-and-data-export)): every layer drawn into one image, with an optional caption, padding, background and theme. Without it `captureImage` throws |
| `marketStatus()` | `chart.marketStatus()` and the legend badge of the `marketStatus` option ([market status](./data-sources#market-and-data-status)): the market phase from the session options, and the data delay. Without it `marketStatus()` throws and the option shows nothing. `marketPhase` needs no plugin |
| `countdown()` | The `countdown` feature flag: the time left in the newest bar, under the main series' last price label. Without it the flag is kept but shows nothing |
| `sharedContext()` | `gl: 'shared'` ([one context for many charts](./embedding#one-context-for-many-charts)). Pass it at creation: the context is chosen then. Without it a `gl: 'shared'` chart gets its own context |
| `statsOverlay()` | The [render statistics](./performance#debugging-and-profiling): `renderStats`, `chart.frameStats`, the `frame:render` event and the `renderStatsOverlay` panel. Without it the options are kept but measure nothing. `chart.gpuMemory()` needs no plugin |
| `higherIntervalBars()` | The `higher-interval-bars` overlay indicator ([Indicators](./indicators#higher-interval-bars-as-boxes)). Not in `builtins()`. Needs indicators: list it after `indicators()` (or `builtins()`) |
| `builtins()` | `dataSource()`, `indicators()`, `comparisons()`, `annotations()`, `trading()`, `heatmap()`, `volumeProfile()`, `points()`, `viewportBounds()`, `depthLane()`, `replay()`, `drawingTools()`, `statsOverlay()`, `sourceMarkers()`, `adjustments()`, `watermark()`, `layouts()`, `referenceLines()`, `priceStyles()`, `grouping()`, `lastPointPulse()`, `localization()`, `countdown()`, `imageCapture()`, `marketStatus()` and `sharedContext()` |

```ts
import { annotations, builtinTools, builtins, createChart, drawingTools, heatmap, indicators } from '@chart-on/core';

// Everything a chart had before these became opt-in:
const full = createChart(el, { plugins: builtins() });

// Indicators, markers and lines, a heatmap and three drawing tools:
const picked = createChart(otherEl, {
  plugins: [indicators(), annotations(), heatmap(), drawingTools(builtinTools.filter((t) => ['trendline', 'hline', 'rectangle'].includes(t.type)))],
});

// Series and panes, with bars pushed through `setData`: the smallest bundle.
const plain = createChart(thirdEl);
```

`@chart-on/ui` keeps its add-ons in entries of their own in the same way, such as `@chart-on/ui/templates` ([drawing templates](./ui-shell#drawing-templates)).

`plugins` is read at creation; `applyOptions` ignores it. Picking a subset of `builtinTools` limits what the chart offers, not the bundle: `builtinTools` holds every built-in tool. Each tool the chart has, from a plugin or `chart.drawings.register`, gets a `draw-<type>` action, removed again with the tool. The drawing commands (`undo`, `redo`, `delete-drawings`, `copy-drawings`, `cut-drawings`, `paste-drawings`, `lock-drawings`, `hide-drawings`, `group-drawings`, `ungroup-drawings`) come with drawings too.

Using a feature the chart was not given throws a [`not-registered`](./errors#not-registered) `ChartError`: `chart.indicators`, `chart.annotations` and `chart.drawings` themselves throw on a chart without them, as do `chart.setDataSource()` with a source and without `dataSource()`, `serializeLayout()` and `loadLayout()` without `layouts()`, `chart.compare()` without `comparisons()`, `chart.referenceLines` without `referenceLines()`, `chart.replay` without `replay()`, `chart.captureImage()` without `imageCapture()`, `chart.marketStatus()` without `marketStatus()` and a plugin's `registerIndicator` without indicators. `chart.compared` stays readable, and is empty. A chart without indicators keeps the `access` options for an indicators plugin added later; a chart without drawings saves layouts without drawings or tool defaults; one without annotations does not show marks, corporate action markers or indicator shape plots, and development builds say so once ([`annotations-missing`](./errors#annotations-missing)). Added later with `chart.install`, annotations show what arrived before, indicators load the indicators of a layout loaded without them (such a chart keeps the valid ones, and an empty pane where each sat, and writes both back with its next save) along with the definitions other installed plugins registered, and drawings load the drawings and tool defaults of a layout loaded without them (such a chart keeps them as saved and writes them back with its next save), along with the tools other installed plugins registered.

Reading `chart.compared` never throws: an empty list is a true answer for a chart that cannot compare, and parts that list rows read it for every row. To check for a plugin without catching the error, test the plugin names: `chart.installedPlugins.includes('@chart-on/core/annotations')`, `'@chart-on/core/indicators'`, `'@chart-on/core/comparisons'`, `'@chart-on/core/replay'`, or `'@chart-on/core/drawings'` for either drawings plugin. A reference to `chart.drawings`, `chart.annotations` or `chart.referenceLines` taken before its plugin is uninstalled goes stale: the chart no longer draws it or sends it input, so read the property again after installing. Uninstalling drawings ends the active tool, the selection, any gesture and text edit; uninstalling annotations removes them all; uninstalling comparisons removes the compared symbols; uninstalling replay ends a replay in progress and shows every bar; uninstalling grouping draws single bars again at once: zooming stops at `minBarSpacing` again, a view zoomed out further comes back to it, `chart.grouping` is null and `grouping:change` fires with null; uninstalling the pulse stops a ring in progress; uninstalling localization goes back to `englishLocalizer` and fires `localization:change`; uninstalling the countdown takes it off the last price label on the next frame; after uninstalling image capture the next `captureImage` throws `not-registered`, and a destroyed chart still resolves to `null`; uninstalling the market status takes the legend badge away. `chart.history` is one stack for both drawings and indicators, whichever was installed first: steps of the one installed later join it, in the order they are made. Uninstalling drawings drops the drawing steps, and uninstalling indicators drops the indicator steps, `moveSeries` of an indicator included; the other plugin's steps stay. Without either, the history stays empty. Uninstalling indicators takes their series off the chart and clears their undo steps, but keeps their saved state and their panes, empty: the next save writes them back, and indicators installed again bring them back to those panes. A pending indicator (its definition not registered yet) gives its pane up and opens in a new one once registered. The UI shell gives its chart `builtins()` unless `chart.plugins` says otherwise, adds `dataSource()`, `indicators()`, `comparisons()`, `drawings()`, `annotations()`, `replay()`, `sourceMarkers()`, `adjustments()`, `watermark()`, `layouts()` and `imageCapture()` when that list leaves them out (its data loading, menus, panels, replay controls, data source marks, adjusted prices, appearance panel, the chart grid's saved layouts and the screenshot buttons use them), before the app's plugins so those can register indicators and drawing tools, and `trading()` after them, and its rail offers the chart's tools. It does not add `localization()`: the shell never sets the `localization` option, it only reads `chart.localization`, so the app that localizes adds the plugin to a list of its own (`builtins()` has it). Nor does it add `countdown()` or `marketStatus()`: with a list of its own that leaves them out, the chart shows no countdown or market badge, and the settings dialog leaves out their switches. The React and Vue `Chart` components take the same option through their `options` prop.
