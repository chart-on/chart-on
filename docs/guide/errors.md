---
description: "Every error code and development warning with its cause and fix."
---

# Errors and warnings

Every error the chart raises and every warning it logs has a stable code. This page lists them all with their cause and fix. Errors are `ChartError`s (see [Errors](./events#errors) for how they reach you); warnings are `console.warn` lines in development builds only, in the form:

```text
charton [option-unknown]: applyOptions: unknown option "crossHair" is ignored; did you mean "crosshair"? (…/errors.md#option-unknown)
```

The part before the message names the call that took the value. Each warning is logged once per call and key. Both lists are exported, `CHART_ERROR_CODES` and `DEV_WARNING_CODES`, for apps that map codes to their own messages.

## Development warnings

Development builds check the options passed to `createChart`, `applyOptions`, `addPane`, every `add*` series call and `series.applyOptions`, drawing styles in `drawings.add` and `drawings.update`, and `createChartShell` and `shell.applyFeatures` in `@charton/ui`. Production builds skip the checks and leave them out of the bundle: any bundler that replaces `process.env.NODE_ENV` with `'production'` drops them (most do in a production build). Code loaded without a bundler has no `process` and stays quiet. The script-tag build is a production build: it leaves the checks out, also when a bundler imports it.

The checks never change what the chart does: an unknown key is still ignored and a wrong value is still used as given, as in production.

Using a deprecated API logs `charton [deprecated]: ...` once per page load, also in development builds only, with the replacement and a link to its entry on the [upgrading page](../upgrading/).

### option-unknown

An options object has a key the chart does not know, often a typo such as `crossHair` or `bodyColour`. The warning names the closest known key when there is one. Fix the key, or remove it. Drawing styles are open to fields of plugin tools, so they only report keys that look like a misspelt known one.

### option-type

A value has the wrong type, such as a string for `barSpacing` or a boolean where an object is expected. The warning says what the option takes. Pass that type; `undefined` and `null` are always accepted.

### option-range

A number outside its documented range (a negative `columnRatio`, a `bodyRatio` above 1), a fraction where a whole number is needed, `NaN`, or a string that is not one of the values the option takes (`legend.mode: 'tiny'`). Pass a value from the range or list in the warning.

Loading a layout logs it too when the layout's chart style is one this version does not draw, such as `hlcArea`, which was renamed `rangeBand`. The main series then draws `candles`, and the layout's `errors` list `mainSeries.style`; nothing throws. Save the layout again to store the style shown now. A chart style starred in the shell's favourites under such a name shows as candles in the favourites strip and logs it as well; the stored reference is kept.

### option-color

A colour string the chart cannot read, such as `'#12'`. Use a hex, `rgb()`/`rgba()` or other CSS colour; colours that depend on where they are used (`currentColor`, `light-dark()`) cannot be drawn either. Without a DOM (tests, server rendering) only hex and `rgb()` strings are checked.

### time-milliseconds

The newest time in `setData` is above 10^11, which looks like milliseconds. Times are unix **seconds**: divide by 1000.

### time-fraction

A time in `setData` is not a whole second. Intervals are whole seconds, so fractional times are usually a conversion slip; round them.

### search-route-failed

A route of `createDataSourceRouter` failed to search symbols; its error is in the message. It is logged once per route. The other routes' results are still shown, and the search fails only when every route does. Fix the route's source, or pass the router's `onError` option to handle the failure yourself, which also silences the warning.

### marker-icon

A bar marker's `icon.image` is a Blob the browser could not decode, for example not an image or a format it does not support. The marker draws without its icon (its text still shows). Pass an image the browser can decode, or decode it yourself and pass the `ImageBitmap`.

### adjustments-missing

The data source reports corporate actions (`adjustments`) and the `adjustment` option or `adjustmentMarkers` asks for them, but the chart has no `adjustments()` plugin, so the bars show as sent and no action is marked. Logged once per page load. Create the chart with `adjustments()` (or `builtins()`) in its `plugins`, or call `chart.install(adjustments())`; the loaded bars are then adjusted without fetching again.

### annotations-missing

Something that draws through [annotations](./annotations) arrived on a chart without the `annotations()` plugin: marks or time marks from the data source, corporate action markers, or an indicator's shape plots. Nothing shows until the plugin is added. Logged once per page load. Create the chart with `annotations()` (or `builtins()`) in its `plugins`, or call `chart.install(annotations())`; what arrived before shows once it is there.

### watermark-missing

The chart was given `features: { watermark: true }`, but it has no `watermark()` plugin, so no watermark shows, and reading `chart.watermark` throws `not-registered`. Logged once per page load. Create the chart with `watermark()` (or `builtins()`) in its `plugins`, or call `chart.install(watermark())`; it then shows the symbol and interval loaded. A watermark made with `createWatermark` and attached with `chart.attachPrimitive` needs no plugin.

### reference-lines-missing

The chart was given a `referenceLines` option that turns a line on, but it has no `referenceLines()` plugin, so no line shows, and reading `chart.referenceLines` throws `not-registered`. Logged once per page load. Create the chart with `referenceLines()` (or `builtins()`) in its `plugins`, or call `chart.install(referenceLines())`; it then applies the option kept so far.
### price-styles-missing

A candle series was drawn in the `kagi` or `pointFigure` style on a chart without the `priceStyles()` plugin, so it draws nothing. This is a warning, not an error: nothing throws, and the series keeps its style, so layouts and settings that use it still load. Logged once per page load. Create the chart with `priceStyles()` (or `builtins()`) in its `plugins`, or call `chart.install(priceStyles())`; the series then draws on the next frame.
### grouping-missing

The chart was given a `grouping` option, but it has no `grouping()` plugin, so bars draw singly, zooming stops at `minBarSpacing`, and `chart.grouping` stays null. Logged once per page load. Create the chart with `grouping()` (or `builtins()`) in its `plugins`, or call `chart.install(grouping())`; the view then groups bars on the next frame.

### pulse-missing

A series has a `lastPointPulse` option that rings, but the chart has no `lastPointPulse()` plugin, so no ring or dot draws. Logged once per page load. Create the chart with `lastPointPulse()` (or `builtins()`) in its `plugins`, or call `chart.install(lastPointPulse())`; an `'on-update'` pulse then rings on the next live update, and a `'continuous'` one on the next frame. Nothing throws, and the option is kept as given.
### countdown-missing

The chart was given `features: { countdown: true }`, but it has no `countdown()` plugin, so no time left in the newest bar shows under the last price label. Logged once per page load. The flag is on by default, so only an explicit `true` warns. Create the chart with `countdown()` (or `builtins()`) in its `plugins`, or call `chart.install(countdown())`; the countdown then shows on the next frame. Nothing throws, and the flag is kept as given.

### market-status-missing

The chart was given `marketStatus: true`, but it has no `marketStatus()` plugin, so the legend shows no market phase or data delay badge. Logged once per page load. The option is on by default, so only an explicit `true` warns. Create the chart with `marketStatus()` (or `builtins()`) in its `plugins`, or call `chart.install(marketStatus())`; the badge then shows at once. Nothing throws, and the option is kept as given. `chart.marketStatus()` needs the plugin too: without it, it throws [`not-registered`](#not-registered).

### localization-missing

The chart was given a `localization` option, but it has no `localization()` plugin, so numbers, dates and the built-in text stay in the built-in English (`chart.localization` is `englishLocalizer`). Logged once per page load. Create the chart with `localization()` (or `builtins()`) in its `plugins`, or call `chart.install(localization())`; it then applies the option kept so far and fires `localization:change`. The option is still checked: an invalid locale tag, decimal separator, hour cycle or date format throws at the call.

### stats-overlay-missing

The `renderStats` or `renderStatsOverlay` option is on, but the chart has no `statsOverlay()` plugin, so nothing is measured or shown: `chart.frameStats` stays `null` and `frame:render` never fires. Logged once per page load. Create the chart with `statsOverlay()` (or `builtins()`) in its `plugins`, or call `chart.install(statsOverlay())`.

### source-markers-missing

The data source has `markers`, but the chart has no `sourceMarkers()` plugin, so it never asks for them: `chart.sourceMarkers` stays empty. Logged once per page load. Create the chart with `sourceMarkers()` (or `builtins()`) in its `plugins`, or call `chart.install(sourceMarkers())`; the markers of the shown symbol are then fetched.

### lanes-missing

A primitive with `lane()` was attached, but the chart has no `depthLane()` plugin, which lays out [lanes](./primitives#lanes), so the primitive gets no space beside the price axis and its `drawLane` is not called. Logged once per page load. Create the chart with `depthLane()` (or `builtins()`) in its `plugins`, or call `chart.install(depthLane())`; the lanes already attached are then laid out.

### shared-context-missing

The chart was created with `gl: 'shared'`, but without the `sharedContext()` plugin in its `plugins`, so it draws through its own WebGL context and `chart.options.gl` reads `'own'`. Logged once per page load. Create the chart with `sharedContext()` (or `builtins()`) in its `plugins`; installing it later changes nothing, since the context is chosen at creation.

### data-source-missing

A React, Vue or Svelte `Chart` component got a `dataSource` prop, but its chart has no `dataSource()` plugin, so the source is not attached and nothing loads. The component does not throw (calling `chart.setDataSource` yourself does, with [`not-registered`](#not-registered)). Logged once per page load. Pass `plugins: [dataSource()]` (or `builtins()`) in the component's `options`, created once at module scope; plugins are read when the chart is created.

## Error codes

Errors are thrown, passed to a rejected promise, or delivered through an event, as each entry says. `cause` holds the original error when there is one.

Development builds give each error an English message that names the call and the value at fault. Production builds leave the messages out, like the warnings: a `ChartError`'s message is then its code (`not-registered`), with the same `code`, `context` and `cause`, and the plain `Error`, `TypeError` and `RangeError` thrown for invalid arguments have an empty message. Code loaded without a bundler counts as production here too. Branch on `code`, not on the message, and look the code up below. Two messages stay in production because the shell's compare button shows them: a symbol that is already compared, and `compare` on a chart without a data source.

### webgl2-unavailable

`createChart` throws: the browser or device has no WebGL2, which the chart needs. Check `isWebGL2Supported()` first and show a fallback.

### webgl-shader

`createChart` throws: a shader failed to compile or link, usually a GPU driver bug. Show a fallback; report it with the browser and GPU when it repeats.

### webgl-restore-failed

`context:restore-failed`: the GPU context came back after a loss but could not be set up again. `cause` is the setup error. Destroy the chart and create a new one.

### unknown-symbol

`data:error`, `compare:error`, or a rejected `setSymbol`: the data source's `symbol` threw, for any reason. That is an unknown symbol, but also a network or server failure; check `cause`, the source's error.

### load-failed

`data:error`, `compare:error`, or a rejected `setSymbol`: the data source failed to load a symbol's first bars. `cause` is the source's error. Offer a retry (`chart.reload()`).

### history-failed

`data:error` with `kind: 'history'`: a page of older bars failed to load. `cause` is the source's error. Scrolling back asks again.

### reset-failed

`data:error` with `kind: 'reset'`: reloading bars after a source reset (`onReset`), a reconnect or `chart.reload()` failed. `cause` is the source's error.

### adjustments-failed

`data:warning`: the data source's `adjustments` failed for a load (`kind`). The bars load anyway, unadjusted for that batch, and the chart notifies the user while the `adjustment` option is on. `cause` is the source's error. The next load of the symbol and interval asks again; `chart.reload()` retries at once.

### markers-failed

`sourcemarkers:error`: the data source's `markers` failed. The bars are not affected. The chart asks again after `retryIn` ms (1 to 16 seconds, doubling); after five failures in a row `retryIn` is `null` and it waits for a reset of the shown bars (`onReset`), the `marks` or `timeMarks` option turned back on, or the next symbol or interval change. `cause` is the source's error.

### invalid-interval

`intervalSeconds` and the built-in adapters throw: an interval string the chart cannot parse, such as `'1x'`. Use a number and a unit, such as `'5m'`, `'4h'` or `'1D'`.

`createOhlcvDataSource` also throws it for an interval the exchange has no timeframe for. The chart avoids that by showing the nearest interval the symbol lists; check the symbol's `intervals` before asking for one directly.

### invalid-drawings

`drawings.load` and `parseSerialized`: a payload that is not `{ version, drawings: [] }`, or a version nothing can upgrade.

### invalid-layout

`loadLayout`: a saved layout that is not an object with a version, or has a version nothing can upgrade.

### listener-failed

The `chart:error` event: one of your event listeners threw. `cause` is what it threw. The other listeners and the frame still run.

### primitive-failed

The `chart:error` event: a member of an attached [primitive](./primitives) threw, on a time chart or a [numeric chart](./numeric-axis#primitives). `cause` is what it threw, and `context.member` names the member, such as `drawPlot` or `priceRange`. The call counts as returning nothing. Other primitives, the series and the frame still draw, and a throwing `detached` does not stop detaching or `destroy()`. Only the first failure of each primitive is reported, so one that throws on every frame does not flood the listener. Without a `chart:error` listener, the error is logged to the console. An `attached` that throws is not caught: `attachPrimitive` rethrows it and the primitive is not attached.

### destroyed

`setSymbol` rejects and `compare` and `install` throw after `destroy()`: the chart cannot load data any more. A numeric chart's `attachPrimitive` throws it too after `destroy()`.

### plugin-incompatible

`chart.install(plugin)` threw: the plugin's `requires` range does not include this core version (`CORE_VERSION`), or the range cannot be read. `context` holds `plugin`, `version`, `requires` and `coreVersion`. Upgrade core or install a plugin version made for it. See [Plugins](./plugins).

### not-registered

Thrown at once by the call that needs the feature:

- `chart.setDataSource(source)` on a chart without the `dataSource()` plugin, with `context` `{ call: 'setDataSource', plugin: 'dataSource()' }`. Detaching with `setDataSource(null)` never throws.
- `chart.serializeLayout()` or `chart.loadLayout()` on a chart without the `layouts()` plugin, with `context` `{ call: 'serializeLayout', plugin: 'layouts()' }` or `{ call: 'loadLayout', plugin: 'layouts()' }`. `autosave` reports the save's error through its `onError`, and `loadLastLayout` rejects with it when a saved layout exists.
- `chart.referenceLines` on a chart without the `referenceLines()` plugin, with `context` `{ call: 'referenceLines', plugin: 'referenceLines()' }`. The `referenceLines` option never throws `not-registered`: without the plugin it is kept for a later install, and an unknown line or line style in it throws at the call, as with the plugin.
- `chart.marketStatus()` on a chart without the `marketStatus()` plugin, with `context` `{ call: 'marketStatus', plugin: 'marketStatus()' }`.
- `chart.captureImage()` on a chart without the `imageCapture()` plugin, with `context` `{ call: 'captureImage', plugin: 'imageCapture()' }`. A destroyed chart resolves to `null` instead.
- `addHeatmap`, `addVolumeProfile` or `addDepthLane` on a chart without the `heatmap()`, `volumeProfile()` or `depthLane()` plugin. `context` holds the `call` and the `plugin` to add: create the chart with it in `plugins` (or `builtins()`), or `chart.install(heatmap())` later.
- `chart.indicators` on a chart without `indicators()`, with `context` `{ call: 'indicators', plugin: 'indicators()' }`, and so do a plugin's `ctx.registerIndicator` and the saved indicators of a layout, which `loadLayout` reports in its `errors` instead of throwing. `chart.compare()` on a chart without `comparisons()`, with `context` `{ call: 'compare', plugin: 'comparisons()' }`. `chart.replay` on a chart without `replay()`, with `context` `{ call: 'replay', plugin: 'replay()' }`.
- `chart.drawings` on a chart without drawings (`drawingTools()` or `drawings()`), and `chart.annotations` on one without `annotations()`. `context` is `{ call: 'drawings', plugin: 'drawingTools()' }` or `{ call: 'annotations', plugin: 'annotations()' }`. Trade fills and trading lines (`annotations.setTrades`, `annotations.addTradeLine` and the other fill and line calls) on a chart without `trading()`, with `context` such as `{ call: 'annotations.setTrades', plugin: 'trading()' }`, and `trading()` installed on a chart without annotations, with `{ call: 'trading()', plugin: 'annotations()' }`. The same goes for what needs them: a plugin's `ctx.registerDrawingTool`, `perSymbolDrawings`, and the saved drawings of a layout, which `loadLayout` reports in its `errors` instead of throwing.
- `drawings.setTool` or `drawings.add` with a tool type the chart does not have. `context` holds the `call`, the `tool` asked for and the `available` types, which the message lists too, so a misspelt type is easy to spot. A chart with no tools at all was created without the `drawingTools()` plugin; a single tool can also be added with `chart.drawings.register(tool)`.

See [Opt-in features](./features#opt-in-features).
