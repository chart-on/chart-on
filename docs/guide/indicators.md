---
description: "Write indicators as pure TypeScript functions with declared inputs and outputs, and add the built-in ones."
---

# Indicators

An indicator is a plain object: declared inputs and outputs plus a pure `compute` function over the main series' bars. The chart loads it, keeps it in sync with new data and live ticks, and draws its plots. `chart.indicators` holds the registered definitions and the indicators on the chart.

Indicators are [opt-in](./features#opt-in-features): `chart.indicators` needs the `indicators()` plugin (or `builtins()`), and throws a [`not-registered`](./errors#not-registered) `ChartError` without it. The UI shell adds it for you.

```ts
import { createChart, indicators } from '@chart-on/core';

const chart = createChart(el, { plugins: [indicators()] });
```

```ts
chart.indicators.register(smaDef);                       // make it available by id
const sma = chart.indicators.add('sma', { length: 50 }); // or add(smaDef, ...)
sma.applyInputs({ length: 100 }); // recompute with new inputs
sma.setVisible(false);
sma.serialize();                   // { id: 'ind-1', type: 'sma', version: 1, inputs: { length: 100, ... }, pane: 0, visible: false }
sma.remove();                      // also removes the pane when the indicator owns one
chart.indicators.getAll();         // every indicator on the chart
```

## Search

`chart.indicators.search(query)` returns registered definitions ranked by exact name, alias or id, name prefixes, alias and id prefixes, acronyms (`bb` finds "Bollinger Bands"), word prefixes, substrings, all query words, a one-character typo (`rsl` finds RSI, from three characters on), the description and finally the category (`momentum` finds RSI). Search ignores case and extra whitespace. An empty query returns every definition; equal ranks keep registration order. Results are fresh arrays of the registered definition objects, and search never adds an indicator.

Search includes definitions denied by the access rules, as `getDefinitions()` does. A picker decides whether to hide or disable them before using `add()`, which enforces access. Unregistered definitions leave the results immediately.

`searchIndicators(defs, query, { nameOf })` ranks any list of definitions the same way, by the names `nameOf` gives (for example in the chart's language; the definition's own name still matches), and `matchRank(def, query, { name })` scores one (lower is better, `null` for no match, tiers in `matchTiers`). Both are exported by `@chart-on/core` and re-exported by `@chart-on/ui`, whose [indicator picker](./indicator-picker#search) and its command palette source rank with them. `matchScore(item, query, { typos })` is the same matcher for any `{ id, label, keywords, description }` item; it is the [picker dialog's](./dialogs#picker-dialog) ranking.

## Copies and intervals

```ts
const copy = chart.indicators.duplicate(sma);         // same inputs, visibility, intervals, plot styles and label switches
sma.setVisibleOn([{ from: '1m', to: '59m' }, { from: '1h', to: '4h' }]);
sma.hiddenByInterval;                                 // true while the chart's interval is outside them
sma.setVisibleOn(null);                               // every interval again
```

- `duplicate` adds the copy next to the original: an overlay's copy in the original's pane, a pane indicator's copy in a new pane right below the original's. A pending indicator gets a pending copy. `indicator:add` fires for it.
- `setVisibleOn(ranges)` limits an indicator to bar intervals. Each range includes both ends and compares intervals by length, so `{ from: '1m', to: '59m' }` covers every minute interval; months, quarters and years count as 30, 90 and 365 days. `null` or `[]` means every interval. An invalid interval, or a range whose `from` is longer than its `to`, throws.
- On other intervals the indicator stays on the chart and in the legend, dimmed, but draws nothing. `visible` keeps reporting your own show/hide choice, and `setVisible` still changes it, so the indicator comes back as you left it once the interval fits again. The interval is the data source's (`setSymbol`), or the spacing of the bars when the app sets them itself.
- The ranges are saved in `IndicatorState.visibleOn` and in [layouts](./layouts); `indicator:change` fires when they change.

## Built-in indicators

`@chart-on/indicators` ships common indicators as ready-made definitions, built on the [technical-analysis helpers](./technical-analysis):

```bash
pnpm add @chart-on/indicators
```

```ts
import { bollingerIndicator, builtinIndicators, rsiIndicator } from '@chart-on/indicators';

for (const def of builtinIndicators) chart.indicators.register(def); // e.g. for a picker
chart.indicators.add('bbands');
chart.indicators.add(rsiIndicator, { length: 21 });
```

| Definition | Id | Placement | Inputs (defaults) |
| --- | --- | --- | --- |
| `smaIndicator` | `sma` | either (overlay by default) | `length` 20, `source` close, `color` |
| `emaIndicator` | `ema` | either (overlay by default) | `length` 20, `source` close, `color` |
| `bollingerIndicator` | `bbands` | overlay | `length` 20, `mult` 2, `source` close, `color`; filled between the bands |
| `vwapIndicator` | `vwap` | overlay | `source` hlc3, `color`; restarts each UTC day; a bar without volume has no value and does not affect the average |
| `rsiIndicator` | `rsi` | pane | `length` 14, `source` close, `upper` 70, `lower` 30, `color`; shaded guides; pane fixed to 0–100 |
| `macdIndicator` | `macd` | pane | `fast` 12, `slow` 26, `signal` 9, `source` close, `color`, `signalColor`, `upColor`, `downColor` |
| `volumeMaIndicator` | `volume-ma` | pane | `length` 20, `color`; volume columns with their moving average |
| `cumulativeVolumeIndicator` | `cumulative-volume` | overlay, left scale | `signed` false, `color`; running total of volume since the first loaded bar. `signed` adds up bars' volume and subtracts down bars' (close against open); a bar without volume leaves the total as it was |
| `keltnerIndicator` | `keltner` | overlay | `length` 20, `mult` 2, `atrLength` 10, `color`; EMA of the close with bands `mult` ATRs away, filled between |
| `donchianIndicator` | `donchian` | overlay | `length` 20, `color`; highest high, lowest low and their midpoint, filled between |
| `supertrendIndicator` | `supertrend` | overlay | `length` 10 (ATR), `mult` 3, `upColor`, `downColor`; a trailing line below price in an uptrend (`up` plot) and above it in a downtrend (`down` plot) |
| `ichimokuIndicator` | `ichimoku` | overlay | `conversionLength` 9, `baseLength` 26, `spanBLength` 52, `displacement` 26, a colour per line; the leading spans are drawn `displacement` bars later with the cloud between them. The cloud ends at the last bar and there is no lagging line, because plots cannot be offset beyond the loaded bars yet |
| `atrIndicator` | `atr` | pane | `length` 14, `color`; Wilder's average true range |
| `stochIndicator` | `stoch` | pane | `kLength` 14, `kSmooth` 3, `dLength` 3, `upper` 80, `lower` 20, `color` (%K), `signalColor` (%D); shaded guides; pane fixed to 0–100 |
| `stochRsiIndicator` | `stoch-rsi` | pane | `rsiLength` 14, `stochLength` 14, `kSmooth` 3, `dLength` 3, `source` close, `upper` 80, `lower` 20, `color`, `signalColor`; shaded guides; pane fixed to 0–100 |
| `dmiIndicator` | `dmi` | pane | `length` 14 (DI), `adxLength` 14, `color` (ADX), `plusColor`, `minusColor`; +DI, -DI and ADX |
| `obvIndicator` | `obv` | pane | `color`; on-balance volume. A bar without volume leaves the total as it was |
| `moonPhaseIndicator` | `moon-phase` | overlay | `showNew` true, `showFull` true, `newColor`, `fullColor`; a ring above the first bar at or after each new moon and a disc above the first at or after each full moon, from the bar times alone (the mean lunar cycle, so within about 15 hours of the true event). An event in a gap, such as a weekend, marks the next bar. Picker category `cycles` |

The main line of each indicator follows the theme's line colour until you set its `color` input, and the MACD histogram uses the theme's up and down colours until you set `upColor` / `downColor`. Lines that have a meaning of their own (Supertrend's trends, the DMI's +DI and -DI, the Ichimoku lines) start with fixed colours. All of them update incrementally on live ticks and declare their `lookback`.

## Writing one

Build `compute` and `update` from the [technical-analysis helpers](./technical-analysis) in `@chart-on/ta` rather than hand-written loops:

<!-- example: custom-indicator -->

`src` holds the bars as parallel `Float64Array` columns: `time`, `open`, `high`, `low`, `close` and `volume` (NaN when a bar has none). `compute` returns one array of `src.length` per plot id.

`lookback(inputs)` is optional: the number of bars before the first valid value (the warm-up). Every helper in `@chart-on/ta` has a matching `<name>Lookback`. With a [data source](./data-sources), the chart adds the largest lookback of its indicators to the bars it requests on the first load, and asks for older history that many bars earlier while scrolling back, so the warm-up stays off screen. `indicator.lookback` and `chart.indicators.lookback` report the current values.

The legend title defaults to `name` followed by every number and source input ("SMA 20 close"). Set `title(inputs)` to show only what matters, e.g. `` title: ({ length }) => `RSI ${length}` ``.

### Inputs

| Type | Value | Notes |
| --- | --- | --- |
| `number` | `number` | Optional `min`, `max`, `step` |
| `source` | `'open' \| 'high' \| 'low' \| 'close' \| 'volume' \| 'hl2' \| 'hlc3' \| 'ohlc4'` | Read with `sourceOf` (whole array) or `sourceAt` (one bar) |
| `color` | CSS color | Link it to a plot with `colorInput`. Optional `role: 'up' \| 'down'` for the two colours of a histogram |
| `boolean` | `boolean` | |
| `select` | one of the `options`' values | `options: { value, label? }[]`, values strings or numbers, e.g. a moving average type |
| `text` | `string` | Optional `maxLength` |

Every input also takes these optional members, for the settings form and the chart:

- `label`: the form's label (default the id).
- `group`: the form section the input goes in, e.g. `'Bands'`. Inputs without one come first, then each group in the order of its first input.
- `visible(inputs)`: return `false` to hide the input, e.g. a text field shown only while a switch is on.
- `disabled(inputs)`: return `true` to show it read-only.
- `validate(value, inputs)`: return an error message, or `null` when the value is fine. Use it for rules the type can't express, such as `fast` below `slow`. It is not called while the input is hidden.
- `affectsData: true`: the input changes what `fetch` loads, so changing it fetches again (same as listing it in [`refetchOn.inputs`](#indicators-with-their-own-data)).

```ts
inputs: [
  { id: 'kind', type: 'select', default: 'sma', options: [{ value: 'sma', label: 'Simple' }, { value: 'ema', label: 'Exponential' }] },
  { id: 'fast', type: 'number', group: 'Crossover', default: 12, min: 1,
    validate: (fast, { slow }) => ((fast as number) < (slow as number) ? null : 'Must be below Slow') },
  { id: 'slow', type: 'number', group: 'Crossover', default: 26, min: 1 },
  { id: 'showLabel', type: 'boolean', group: 'Label', default: false },
  { id: 'label', type: 'text', group: 'Label', default: 'MA', maxLength: 12, visible: ({ showLabel }) => showLabel === true },
],
```

`inputFields(def.inputs, values)` evaluates all of this for a set of values: it returns the groups in order, each with its fields' `value`, `visible`, `disabled` and `error` (the type or range problem, else the `validate` message). A settings form renders from it, so it follows the same rules as the chart. Callbacks that throw count as shown, enabled and invalid with the thrown message.

Definitions are checked when they register: input ids must be unique, a `select` needs at least one option and no repeated values, and every default must fit its input.

`chart.indicators.add` and `applyInputs` fill in defaults and throw on unknown inputs, invalid values and values `validate` rejects. Restoring saved state is lenient instead (see [Saving and restoring](#saving-and-restoring)), and so is `applyInputs` on a pending placeholder: without the definition it only rejects values no input type accepts (anything but a finite number, a string or a boolean), and the rest are validated when the definition registers.

### Plots

- `line`: `color`, `lineWidth`, `lineStyle` (`'solid'`, `'dashed'` or `'dotted'`) and `lineType` (`'simple'`, or `'step'` to hold each value until the next bar and then jump). NaN values break the line, so a line with gaps needs no plot type of its own.
- `histogram`: columns from `base` (default `0`, or the `number` input named in `baseInput`, so users can move it in settings), coloured by `positiveColor` / `negativeColor`, or by the `color` inputs named in `positiveColorInput` / `negativeColorInput` (give those inputs `role: 'up'` and `'down'` so a form shows them as a pair). A histogram with no colours at all uses the theme's up and down colours.
- `ohlc`: candles or bars from four outputs. The plot's own output (`id`) is the close; `open`, `high` and `low` name the other three, which `compute` must return too, e.g. `{ id: 'haClose', type: 'ohlc', open: 'haOpen', high: 'haHigh', low: 'haLow' }`. `style` is `'candles'` (default) or `'bars'` (a high-low range with open and close ticks). A bar draws only where all four values are finite. Bars closing at or above their open take `upColor`, the others `downColor` (default the theme's up and down colours), or the `color` inputs named in `upColorInput` / `downColorInput`; wick and outline follow the body. Autoscale and hit tests use high and low, the legend shows O, H, L and C, and the last-value label and `priceLine` the close. While zoomed out, a bucket shows its first open, highest high, lowest low and last close. Missing, empty or repeated `open`, `high` and `low` ids make `register` and `add` throw. OHLC plots have no `offset`.
- Line, histogram and OHLC plots can take a colour per bar (an OHLC plot's whole bar takes it): `colorOutput` names another output (which `compute` must return) holding, per bar, an index into `palette`, e.g. `{ id: 'avg', type: 'line', palette: ['#22a06b', '#e5484d'], colorOutput: 'slope' }`. A column, or the line segment from a bar to the next, takes its bar's colour; NaN or an index outside the palette keeps the plot's colour (by sign for a histogram). While zoomed out, a bucket takes the colour of its last bar. The legend, the last-value label and the plot's price line use the colour at their bar. Set both members or neither, or `register` and `add` throw. Lines with point colours are drawn on the canvas, also with `renderer: 'gpu'`.
- Line and histogram plots can be shifted along the time axis by whole bars: `offset: 26` draws each value 26 bars after the bar it was computed for (past the last bar too), `-26` that many bars before; `offsetInput` names a `number` input that overrides it, so users can change it in settings. The legend, autoscale and hit tests read the value drawn at a bar; the last-value label stays the newest value. A fill shifts with its first plot and reads the second at the same bars. A fractional offset, or an unknown or non-number input, makes `register` and `add` throw.
- Without a colour, a plot uses the theme's line colour. A `color` input whose value is `''` does the same, so an input can default to the theme.
- `background`: shades the full height of the indicator's pane behind each bar. The output is an index into `palette` per bar, e.g. `{ id: 'regime', type: 'background', palette: ['rgba(34, 160, 107, 0.08)', 'rgba(229, 72, 77, 0.08)'] }`; NaN or an index outside the palette leaves the bar unshaded. Its outputs are not prices: it stays out of the legend, the price axis, autoscale and hit-testing. Use translucent colours, the series draw over it. A background plot without a non-empty `palette` makes `register` and `add` throw.
- `barColor`: recolours the main series' bars, body, wick and outline, over their own colours (see [per-bar colours](./series.md#per-bar-colours)). The output is an index into `palette` per bar, e.g. `{ id: 'spike', type: 'barColor', palette: ['#f5a524'] }`; NaN or an index outside the palette keeps the bar's colour. With several bar colour plots (from one indicator or several), the last with a colour for a bar wins. Hiding the plot through its style, hiding the indicator or removing it gives the bars their colours back. Bars grouped while zoomed out keep their default colours, and line-like styles have no bars to recolour. Like `background`, it stays out of the legend, the price axis, autoscale and hit-testing, and needs a non-empty `palette`.
- `shape`: a bar marker on each bar whose output is a finite number; NaN draws nothing. It takes the bar marker fields `shape`, `position`, `text` (e.g. a single character, or the content of a `label`), `size`, `icon` and `kind`, e.g. `{ id: 'buy', type: 'shape', shape: 'arrow-up', color: '#22a06b' }`. `above` and `below` sit next to the main series' bar when the indicator is on its price scale, otherwise next to the indicator's other plots at that bar (and nowhere without one; use the `top` and `bottom` lanes there). With `position: 'atPrice'` the output is the price. Shapes share the bar marker layer: `setMarkerFilter`, marker folding and the `marker:hover` and `marker:click` events, which report the indicator's series. They are not in `annotations.getMarkers`, the legend, the price axis or autoscale. `color` or `colorInput` sets the colour; without either it is the marker default. A shape plot without a `shape`, or with an invalid `icon`, makes `register` and `add` throw.
- `fills`: shade between two line plots, e.g. `{ between: ['upper', 'lower'], color: 'rgba(56, 189, 248, 0.1)' }`.

Every plot shows its value in the legend and a last-value label on the price axis (`lastValueLabel: false` turns the label off). Line, histogram and OHLC plots can also draw a price line across the pane at their newest value (an OHLC plot's close): `priceLine: true` for the default style (dotted, 1 px, the plot's colour), or an object as for the [series price line](./series#price-line), e.g. `{ id: 'ma', type: 'line', priceLine: { lineStyle: 'dashed', source: 'lastVisible' } }`. It is off by default and goes with the plot or the indicator when hidden. Add the indicator with `{ legend: false }` as its third argument to leave it out of the legend. At runtime, `indicator.applyLabelOptions({ lastValueLabel, axisTitle })` hides all of the indicator's labels or tags them with its title (see [Reference lines](./reference-lines#labels-per-series)). Values use the main series' precision on overlays on its scale, and two decimals elsewhere (compact from 10,000); set `precision` on the definition to fix it.

### Plot styles

Users can restyle each plot over what the definition declares, e.g. from a settings panel. The style is saved with the indicator and kept when its inputs change.

```ts
const bands = chart.indicators.add(bbandsDef); // plots 'upper', 'middle' and 'lower'
bands.setPlotStyle('upper', { lineWidth: 2, lineStyle: 'dashed' });
bands.setPlotStyle('middle', { visible: false });
bands.getPlotStyle('upper'); // { lineWidth: 2, lineStyle: 'dashed', visible: true }
bands.plotStyles;            // { upper: { lineWidth: 2, lineStyle: 'dashed' }, middle: { visible: false } }
bands.setPlotStyle('upper', null); // back to the definition's
```

- `setPlotStyle(id, style)` merges `lineWidth` (positive css px), `lineStyle` (`'solid'`, `'dashed'` or `'dotted'`) and `visible` into the plot's current style, and fires `indicator:change` when something changed. Line width and style apply to line plots only. An unknown plot, an invalid value, or a line width or style for a histogram, background or shape plot throws.
- `plotStyles` holds only what differs from the definition: setting a value back to the definition's removes it. `getPlotStyle(id)` gives the style the plot draws with (null for an unknown plot, and while pending). `resolvePlotStyle(plot, style)` computes the same from a plot definition, e.g. for a form of your own.
- A hidden plot draws nothing on either renderer, and leaves the legend, its price-axis label, autoscale and hit-testing. A fill draws only while both of its plots are shown.
- While the indicator is pending the plots are not known: styles are kept as given and checked once the definition registers, when those that do not fit are dropped.

### Price scale

By default an overlay draws on the main series' price scale, `'right'`. That suits values in price units, such as a moving average. Values in other units would squash the candles, so a definition can name another scale with `priceScale`, the same ids [series use](./view-and-scale#several-price-scales):

```ts
const cumulativeDelta: IndicatorDef = {
  id: 'my-lib/cumulative-delta',
  name: 'Cumulative delta',
  placement: 'overlay',
  priceScale: 'left', // its own left axis, beside the candles' right one
  // ...
};
```

- `'right'` (default): the main series' scale.
- `'left'`: the left scale. Its axis shows while a visible indicator or series is on it, and hides again when the last one is hidden or removed.
- Any other id, e.g. `'my-lib/cumulative-delta'`: a scale of its own with no axis, fitted to the indicator's values. Indicators naming the same id share it.

`chart.indicators.add(def, inputs, { priceScale })` overrides the definition for one indicator; an empty or non-string id throws. The override is saved with the indicator's state and layout, and `indicator.priceScale` reports the scale in use. A `pane` indicator's `priceScale` names the scale in its own pane.

`indicator.setPriceScale(id)` moves an indicator to another scale at runtime, with the same ids, and fires `indicator:change`. The new scale is saved like an override, also while the indicator is pending. A `pane` indicator alone in its pane takes its [fixed range](#fixed-pane-range) or autoscale rule to the new scale; in a pane it shares, the scales keep their settings. A scale made for an indicator (an id the pane did not have yet, other than `right` and `left`) is dropped, with its settings, once no series uses it: after the indicator moves to another scale or pane, or is removed. Scales the pane had before stay, such as one the app set up with `setPriceScaleOptions` first.

### Picker metadata

Optional fields describe a definition for the [indicator picker](./indicator-picker) and other catalogues:

- `description`: one sentence, shown under the name.
- `category`: `'trend'`, `'momentum'`, `'volatility'`, `'volume'` or `'profiles'`, or any other string for a custom category. Definitions without one are listed under Other.
- `aliases`: other names search should find, e.g. `['Bollinger Bands']` for "BB".

The built-ins carry all three.

### Placement

`placement: 'overlay'` draws on the price pane and `'pane'` in a new pane the indicator owns. `'either'` leaves the choice to whoever adds it: `chart.indicators.add(def, inputs, { placement: 'pane' })`, on the price pane by default. The option is ignored for fixed placements. Saved state keeps the pane index, so an `either` indicator restores where it was. `indicator.placement` reports `'overlay'` or `'pane'` (null while pending).

### Fixed pane range

A pane indicator whose values have known bounds can declare them, so its pane keeps the same scale whatever the data in view:

```ts
const stochastic: IndicatorDef = {
  id: 'my-lib/stochastic',
  placement: 'pane',
  fixedRange: { min: 0, max: 100 },
  // ...
};
```

When the indicator is added, the chart sets this as the [fixed range](./view-and-scale#fixed-range) of the new pane's price scale (the one named by `priceScale` in the add options or the definition, else `right`). It is only a starting point: the user can still zoom the axis, and the app can call `setPriceRange` or clear it with `setPriceScaleOptions({ fixedRange: null }, pane)`. `min` must be below `max`, both finite, and only `placement: 'pane'` may declare it, since overlays share the main price scale; `register` and `add` throw otherwise. The built-in RSI declares 0–100.

An indicator whose values swing around a level rather than between bounds can declare an `autoscaleRule` instead, e.g. `autoscaleRule: { centerOn: 0 }` for a momentum histogram. The chart sets it as the pane scale's [autoscale rule](./view-and-scale#autoscale-rule) when the indicator is added. The same checks apply: an invalid rule, or one on an overlay, makes `register` and `add` throw.

## Registering and ids

```ts
chart.indicators.register(vwapBandsDef);   // throws if another definition has the id
chart.indicators.getDefinitions();         // registered definitions, e.g. for a picker
chart.indicators.add('my-lib/vwap-bands', { length: 20 });
chart.indicators.unregister('my-lib/vwap-bands');
```

- The `id` is what saved state refers to, so keep it stable. Indicators shipped in a package prefix it with the package name, `my-lib/vwap-bands`, so they don't clash with other packages or with the built-ins (`sma`, `rsi`...). The built-ins in `@chart-on/indicators` are the one exception: as first-party definitions they keep short, bare ids, and no other package should use a bare id.
- Registering an id that another definition already has throws. Registering the same object again does nothing, so a hot reload or a second `register` call is harmless.
- `add` takes an id or a definition. A definition that isn't registered yet is registered on the way, so a one-off indicator is a single call.
- `unregister` doesn't remove the indicators using that definition. They become pending placeholders (below) and come back when it is registered again.

## Saving and restoring

```ts
const saved = chart.indicators.serialize(); // IndicatorState[], plain JSON
// later, or on another chart
chart.indicators.load(saved);               // replaces the indicators on the chart
```

`IndicatorState` is `{ id, type, version, inputs, pane, visible, visibleOn? }`, where `id` is the indicator's id on the chart (`ind-1`, `ind-2`, …, unique per chart, also `indicator.id`, and `chart.indicators.getById(id)` finds it), `type` is the definition id, plus `priceScale` when `add` or `setPriceScale` set one, `plotStyles` when [plot styles](#plot-styles) are set, and `folded: true` while its legend row is folded (`chart.setLegendFolded`, which then fires `indicator:change`). Saved plot styles are lenient: invalid values, unknown plots and line styles of histograms are dropped. `load` validates the payload first: one that isn't a list of states throws and changes nothing. Then for every state:

- **Registered id:** the inputs are migrated if needed (see below) and validated. Unknown inputs are dropped, and invalid values and values `validate` rejects take their defaults; the indicator is still added, and `indicator:error` reports what was replaced.
- **Unknown id:** the indicator is kept as a pending placeholder. It is listed in `getAll()` with `pending: true`, draws nothing, has no `def`, `series` or `pane`, and `serialize()` returns its saved state unchanged. You can still remove it, hide it or change its inputs. When the definition is registered, the placeholder goes live in place (the same handle), its inputs are validated like any restored state (invalid ones take their defaults and `indicator:error` reports them), and `indicator:change` fires. So restoring a layout before the app has registered a package loses nothing.

`load` keeps the saved ids, so [drawings tied](./drawings#tie-to-an-indicator) to an indicator find it again; a state without an id (saved before ids) or with one already taken gets a new one. Copies (`duplicate`, paste) and indicators added from a set get new ids.

Indicators that need their own pane get a new one when restored, in the order they were saved. To bring back the pane each one was in, with the pane heights and price scales, save and load the whole [layout](./layouts) instead.

Indicators your app adds itself can stay out of saved state: `chart.indicators.add(def, inputs, { persist: false })` leaves them out of `serialize()` and of saved layouts.

## Indicator sets

An indicator set is a group of indicators with their panes, for users who keep a setup (say, two moving averages on price with an oscillator and its signal line below) and apply it to any chart in one step. It is plain JSON, so save it as a [template](./storage#storage-adapter) of kind `'indicator-set'`:

```ts
const set = chart.indicators.serializeSet(); // IndicatorSet
await storage.saveTemplate('indicator-set', 'Momentum', set);

// later, on any chart
const result = chart.indicators.applySet(await storage.loadTemplate('indicator-set', 'Momentum'));
for (const { type, reason } of result.skipped) console.warn(`Left out ${type}: ${reason}`);
```

The UI package has a ready-made dialog for these templates: see [Indicator templates](./indicator-picker#indicator-templates).

`IndicatorSet` is `{ version, indicators, paneHeights?, appliesOn? }`:

- `indicators` are the saved [states](#saving-and-restoring) of the indicators `serialize()` returns, without their `id`, with `pane` counted within the set: 0 is the price pane, 1 the set's first pane below it, and so on. Panes without saved indicators (an app's volume pane, say) are not part of the set.
- `paneHeights[i]` is the height of the set's pane `i + 1` relative to the price pane, so a set keeps its proportions on a chart of any size.
- `appliesOn` is an optional interval scope, in the same range form as an indicator's `visibleOn`: `serializeSet({ appliesOn: [{ from: '1m', to: '1h' }] })`. Unlike `visibleOn` it hides nothing: `indicatorSetFits(set, interval)` says whether a set is meant for an interval, so an app can apply a set when the user switches to a matching one. A scope that is not a non-empty list of valid ranges never widens to every interval: `serializeSet` and `applySet` throw on it, and `indicatorSetFits` returns false.

`applySet(set, { replace })` validates the set when it applies it, never when it is saved. It throws and changes nothing for a payload that is not an indicator set, a format `version` other than `INDICATOR_SET_VERSION` (1), an invalid scope, or more than `MAX_INDICATOR_SET_ENTRIES` (100) indicators. Otherwise:

- By default the set **replaces** the saved indicators (those added with `persist: false` stay). Panes they leave empty go with them, unless they still hold drawings or primitives. With `replace: false` its indicators are added to the ones on the chart.
- Each of the set's panes becomes **one** new pane below the existing ones, in the set's order and with its saved height, so indicators that shared a pane share one again and applying a set never duplicates panes. Pane numbers are taken in order, so a set numbering its panes 2 and 7 gets two panes. Overlays saved in pane 0 go on the price pane. Height ratios that are not finite positive numbers are ignored.
- It is all or nothing: if adding an indicator throws, the ones already added are removed and the chart keeps its indicators. The whole set fires one `state:change`.
- Entries saved at an older definition version go through its `migrate`, as for layouts; inputs that still don't fit take their defaults and `indicator:error` reports them.
- An entry is **skipped**, not thrown, when its id is not registered (`'unknown'`), it is malformed (`'invalid'`), the [access rule or limit](#access-rules-and-the-indicator-limit) refuses it (`'blocked'`, `'limit'`, after `indicator:refuse`), or, with `replace: false`, the chart already has that indicator with the same inputs (`'exists'`, so applying a set twice adds nothing the second time). `result.skipped` lists them with their index in `set.indicators`; `result.added` holds the new handles.

## Drawing on the GPU

By default (`renderer: 'gpu'`), an indicator's line plots and the fills between them are drawn on the GPU, like [GPU lines](./series#gpu-lines): their values upload once, panning and zooming upload nothing, and a live update uploads only the last values. It pays off with many indicators, long histories or frequent redraws: two indicators of five lines and two fills each over 3,000 bars took about 3 ms of CPU time per frame on the canvas and 0.4 ms on the GPU. They then draw below every series drawn on the canvas, and dashed plots still measure their length on screen each frame. Pass `renderer: 'canvas'` to draw an indicator in 2D instead. `duplicate` keeps the option, but saved state does not: after `load`, switch restored indicators back with `indicator.series?.applyOptions({ renderer: 'canvas' })`.

```ts
chart.indicators.add('bbands', {}, { renderer: 'canvas' }); // opt out of the GPU
```

## Versioning

When a new release of an indicator renames inputs or changes their meaning, raise its `version` (a positive integer, default 1) and upgrade older saved inputs in `migrate`:

```ts
export const bandsDef: IndicatorDef<{ period: number; width: number }> = {
  id: 'my-lib/bands',
  version: 2,
  migrate(inputs, fromVersion) {
    // Version 1 called `period` `length`.
    if (fromVersion < 2) {
      const { length, ...rest } = inputs;
      return { ...rest, period: length };
    }
    return inputs;
  },
  // ...
};
```

`serialize()` writes the definition's version. On restore, state from an older version goes through `migrate` and the result is validated like any other saved inputs. A `migrate` that throws, or state saved by a newer version than the registered one, is reported through `indicator:error`, and the inputs that still fit are kept.

## Events

```ts
chart.on('indicator:add', ({ indicator }) => {});    // added or restored, placeholders too
chart.on('indicator:remove', ({ indicator }) => {}); // removed, also with its series or pane
chart.on('indicator:change', ({ indicator }) => {}); // inputs or visibility changed, or it went live or pending
chart.on('indicator:error', ({ indicator, error }) => {});
chart.on('indicator:status', ({ indicator, status, message }) => {}); // own data, see below
chart.on('indicator:refuse', ({ type, reason }) => {}); // add() refused it: 'blocked' or 'limit'
```

Each returns an unsubscribe function.

## Selecting

An indicator is selected like a drawing, and the chart holds one selection for both: selecting an indicator clears the selected drawings, and selecting a drawing clears the indicator. A click on an indicator's plot or on its legend row selects it; a click on empty plot space or `Escape` clears it. In the [object tree](./ui-shell#object-tree), focusing an indicator row selects it too. The selected indicator's legend row is outlined in the theme's `drawingSelected` color, and screen readers hear its title followed by "selected", e.g. "RSI selected" (message `indicatorSelected`).

`Delete` or `Backspace` runs the `remove-selected` [action](./interaction#actions-and-shortcuts), which removes the selected indicator (or the selected drawings). Like every action, its keys can be rebound.

```ts
chart.setSelection({ kind: 'indicator', indicator });
chart.getSelection(); // { kind: 'indicator', indicator }, { kind: 'drawings', ids } or null
chart.on('selection:change', ({ selection }) => {});
chart.setSelection(null); // clear
```

### Copy and paste

`Mod+C` copies the selected indicator, `Mod+X` cuts it (copies it and removes it) and `Mod+V` pastes it: the copy has the same inputs, plot styles, visibility and intervals, and goes on the price pane or into a new pane of its own, as the original was, with the original pane's height. The pasted indicator is selected. These are the `copy`, `cut` and `paste` [actions](./interaction#actions-and-shortcuts), shared with drawings: they act on what is selected, and `paste` adds what was copied last, drawings or an indicator. Add options such as `legend` or `renderer` are not copied.

With a drawings plugin installed, the keys also use the system clipboard, like [copied drawings](./drawings#copy-and-paste), so an indicator copied on one chart pastes on another one, in another tab or after a reload. On the clipboard it is JSON text, `{ kind: 'charton-indicator', set }`, where `set` is an [indicator set](#indicator-sets) with one entry. An indicator the pasting chart does not have registered, or that its access rule or limit refuses, is not added; the chart reports it through [`chart.notify`](./ui-shell#notifications) (message `indicatorPasteFailed`), which the UI shell shows as a toast. Without a drawings plugin, copy and paste work within the chart only.

## Undo and redo

Indicators share the chart's undo history with drawings, `chart.history`, so `Mod+Z` takes back the last change of either kind, in the order they were made. Adding (also duplicating and pasting), removing (also cutting), editing inputs, plot styles, label switches, intervals or the price scale, moving an indicator to another pane with `chart.moveSeries` and applying a set are each one step. Undoing a removal brings back the same `Indicator` handle with its inputs, styles and pane. Showing or hiding an indicator, folding its legend row and `load()` are not steps; `load()` drops the indicators' steps. The steps come with the indicators and drawings plugins: on a chart without either, `chart.history` has nothing to undo, `undo()` and `redo()` return false and `history:change` never fires.

```ts
chart.history.undo();   // false when there is nothing to undo
chart.history.redo();
chart.history.canUndo;  // also canRedo
chart.history.clear();
chart.on('history:change', ({ canUndo, canRedo }) => updateButtons(canUndo, canRedo));
```

The UI shell's indicator settings panel records its edits as one step when it closes with Ok; Cancel leaves none.

## Access rules and the indicator limit

Apps can restrict which indicators users add and how many a chart holds, through the chart's [`access` option](./features#access-rules) or directly:

```ts
const allowed = new Set(['sma', 'ema', 'rsi']);
chart.indicators.setAccess(({ id }) => allowed.has(id)); // the access.allow rule shape; null allows every indicator
chart.indicators.setLimit(3);       // null for no cap
chart.indicators.refusal('macd');   // 'blocked' (the rule said no), 'limit' or null
```

`add()` and `duplicate()` throw when an indicator is refused, after firing `indicator:refuse`. Pass `{ restricted: false }` to `add()` for indicators the app adds itself. Saved layouts (`load()`) are not restricted. `indicators:access-change` `{ allow, limit }` fires on every `setAccess()` and `setLimit()` call.

A removed indicator's handle keeps the inputs, visibility and `serialize()` result it had when it was removed, reads `pending: false`, and fires no more events.

## Live data

On `setData` (including history prepends and interval reloads) the chart runs `compute` over every bar. On a live tick or a newly appended bar it calls `update` for the last bar only. `update` writes into `out` at `index` and may read earlier values, so recurrences such as an EMA continue from `out.ema[index - 1]`. Extra arrays returned by `compute` are kept and passed back to `update`, which is the place for running state like the average gain and loss of an RSI. The SMA above keeps its source this way, so a derived source such as `hlc3` is not rebuilt on every tick.

Each helper in `@chart-on/ta` has a single-bar form that matches this contract. Helpers with running state take a `state` object; return its arrays from `compute` and pass them back to the single-bar form:

```ts
import { rsi, rsiAt } from '@chart-on/ta';

compute(src, { length }) {
  const n = src.length;
  const state = { avgGain: new Float64Array(n), avgLoss: new Float64Array(n) };
  return { rsi: rsi(src.close, length, undefined, state), ...state };
},
update(src, { length }, i, out) {
  rsiAt(src.close, i, length, out.rsi!, { avgGain: out.avgGain!, avgLoss: out.avgLoss! });
},
```

Without `update`, every tick and every appended bar reruns `compute` over all bars, which is O(n) per bar. The chart cannot extend the outputs of a full compute on its own, since any value may depend on every bar; define `update` for indicators that run on live data.

## Async compute

`compute` may return a promise, for example when the work runs in a Web Worker. Results that arrive after newer data or inputs are discarded, and ticks that came in while computing are applied once the result lands. Copy the arrays you send to a worker; the chart keeps updating its own.

If `compute` or `update` throws, or `compute` returns no result or an array that is not a `Float64Array` of `src.length` values (state arrays included), the plots show no values and the chart emits `indicator:error` once. Live ticks and appended bars don't retry; the indicator recovers only when `setData` or `applyInputs` runs a full compute that succeeds.

## Indicators with their own data

Some indicators are not a function of the main bars: open interest, funding rates, on-chain metrics, sentiment. Give the definition a `fetch` (history) and optionally a `subscribe` (live rows), and name the values of each row with `fields`. The chart owns the data lifecycle. `compute` stays a pure function and receives the fetched values as its third argument, aligned with the bars.

```ts
import type { IndicatorDef } from '@chart-on/core';

// `api` stands for your own client.
const openInterest: IndicatorDef<{ venue: number }> = {
  id: 'my-lib/open-interest',
  name: 'Open interest',
  placement: 'pane',
  inputs: [{ id: 'venue', type: 'number', default: 0 }],
  plots: [{ id: 'oi', type: 'histogram' }],
  fields: ['oi'],                       // rows are [time, oi]
  chunkBars: 500,                       // at most 500 bars per request
  refetchOn: { inputs: ['venue'] },     // a venue change fetches again
  supports: ({ symbol }) => (symbol.type === 'index' ? 'No open interest for an index' : true),
  fetch: ({ symbol, interval, from, to, inputs, signal }) =>
    api.openInterest({ symbol: symbol.symbol, interval, from, to, venue: inputs.venue, signal }),
  subscribe: ({ symbol, inputs }, onRow) =>
    api.streamOpenInterest(symbol.symbol, inputs.venue, (time, value) => onRow([time, value])),
  compute: (_src, _inputs, data) => ({ oi: data.oi!.slice() }),
  update: (_src, _inputs, i, out, data) => {
    out.oi![i] = data.oi![i]!;
  },
};
```

Rows are `[time, ...values]`, time in unix seconds, one value per entry of `fields`. Each bar shows the last row whose time falls inside it; bars without a row read `NaN`. Rows with no finite time are dropped, and missing or non-finite values read as `NaN`.

What the chart does:

- **Initial fetch.** Once the data source has loaded a symbol, the chart calls `fetch` for the loaded bars: `from` is the first bar's time, `to` the end of the last bar (exclusive), and `barCount` the number of bars in between: about how many rows to expect, not a cap, hence not the `limit` of a data source request.
- **Paging.** When older history pages in, it fetches just the new range, so the indicator scrolls back with the main series.
- **New bars.** Without `subscribe`, a bar appended live fetches the rows for it: the range from the end of what was fetched to the end of the new bar. With `subscribe`, live rows keep the newest bars current instead.
- **Corrections.** When the data source resets its bars (it reported a reset through `onReset`, or reconnected), the rows are dropped and fetched again, like `refetch()`.
- **Chunks.** With `chunkBars`, a range is split into requests of at most that many bars. They run in parallel, and the rows are merged once all have answered. Rows outside a request's range are dropped, and a later row with the same time wins.
- **Cancellation.** Each request gets an `AbortSignal`. A symbol or interval switch, a `refetchOn` input change, `refetch()` or removing the indicator aborts it, and an answer that still arrives is ignored.
- **Live rows.** `subscribe` is called with the symbol, interval and inputs. The chart calls the returned function to unsubscribe when the symbol, interval or a `refetchOn` input changes, when the indicator is removed and when the chart is destroyed, then subscribes again for the new context. A live row in the last bar updates it through `update`, or a full `compute` without one. A row past the last bar's interval waits for the next bar; when that bar opens after a gap (a session break, say), the row goes to the bar before the gap, and `update` runs again for that bar as well. A fetch answered after a live row arrived does not overwrite that row.
- **Another symbol.** `request.barsOf(symbol)` loads another symbol's bars for the same interval and range through the chart's data source, for indicators such as a spread or a ratio.

`refetchOn` decides what drops the fetched rows. By default a symbol or interval switch does, and inputs never do unless they are listed or marked `affectsData`. Set `symbol: false` for data that does not depend on the symbol, such as a market-wide sentiment index: its rows are kept across switches and only missing ranges are fetched. The subscription still follows the chart: it is renewed for the new symbol, keeping the rows. With `interval: false` the rows are kept and re-aligned to the new bars. Inputs that are not listed only recompute.

`supports(context)` returns `true` or a reason. While it returns a reason, the indicator fetches nothing, draws no values, and shows the reason in the middle of its pane. The next supported symbol or interval fetches again.

External data needs a [data source](./data-sources). With bars pushed through `setData` there is no symbol or interval to fetch for, so such indicators stay `idle`. Detaching the source (`setDataSource(null)`) drops the rows, since they belong to its symbol.

`fields` without `fetch` or `subscribe` is rejected when the definition is registered: nothing would load the rows.

## Indicators on another interval

An indicator can read the bars of a longer interval than the chart's, for example an RSI on daily bars while the chart shows 5-minute bars. List the intervals in `intervals`; `compute` and `update` get their bars as a fourth (sixth) argument, keyed by interval. Two pure helpers put values computed on those bars back onto the chart's bars.

```ts
import { alignSteps, formingSteps, type IndicatorDef, type Interval } from '@chart-on/core';

const dailyClose: IndicatorDef<{ interval: string; closedOnly: boolean }> = {
  id: 'my-lib/higher-close',
  name: 'Higher close',
  placement: 'overlay',
  inputs: [
    { id: 'interval', type: 'select', default: '1d', options: [{ value: '1h' }, { value: '1d' }] },
    { id: 'closedOnly', type: 'boolean', default: false },
  ],
  plots: [{ id: 'close', type: 'line' }],
  intervals: ({ interval }) => [{ interval: interval as Interval, lookback: 0 }],
  compute(src, { interval, closedOnly }, _data, bars) {
    const higher = bars[interval]!;
    const close = closedOnly
      ? alignSteps(src.time, higher.time, higher.close, { closedOnly: true })
      : formingSteps(src, higher, (b, j) => b.close[j]!);
    return { close };
  },
};
```

What the chart does:

- **Loading.** Once the data source has loaded a symbol, the chart asks it for each listed interval's bars up to the end of its own last bar, plus `lookback` higher bars before its first bar for the warm-up. Bars are cached per symbol and interval, so an interval switch of the chart keeps them; a symbol switch, an `intervals` change, a data correction or `refetch()` loads them again, aborting what was in flight.
- **Paging.** When older history pages in, it loads the older higher bars the new range and its warm-up need.
- **Live.** The newest higher bars are built from the chart's own bars, so the forming higher bar follows every tick and a new one starts when a chart bar falls past it, without asking the data source again. When the chart's bars reach back before the newest loaded higher bar, that bar is rebuilt from them too; when the chart starts inside it, the chart's bars only widen its range and move its close. During a bar replay, or when the data source already has newer higher bars than the chart's last bar, that loaded bar keeps only its open, so nothing after the chart's last bar leaks in. New higher bars keep the loaded bars' start times (a daily bar stamped at a session open, say); with no loaded bars they start where `intervalStart` puts them.
- **Shorter only.** While the chart interval is equal to or longer than a listed interval (by nominal length), the indicator loads nothing, every listed interval's bars are empty, and its pane says why. `supports` applies as well.

Every listed interval is present in `bars`, empty until it loads.

**Another symbol.** An entry with a `symbol` reads that symbol's bars instead of the chart's, for example daily bars of an index while the chart shows a stock's 5-minute bars. They are keyed `'<symbol>@<interval>'` in `bars`:

```ts
intervals: () => [{ interval: '1d', symbol: 'INDEX', lookback: 14 }],
compute(src, _inputs, _data, bars) {
  const index = bars['INDEX@1d']!;
  return { close: alignSteps(src.time, index.time, index.close, { closedOnly: true }) };
},
```

The chart resolves the symbol through its data source and loads, caches and pages its bars as above, with two differences. The chart's own bars say nothing about another symbol, so its newest bar is the one the data source sent: when the source has `stream`, the chart follows that symbol's live bars at the listed interval (a bar with the newest time replaces it, a newer one starts the next bar, older ones are ignored, and a reset of that stream loads the bars again); without it, the bars stay as loaded until the next load. And since they do not depend on the chart's symbol, a symbol switch of the chart keeps them, even a switch to the symbol the entry names. The "shorter only" rule applies to them too. The source's newest bar may hold data from after the chart's last bar during a bar replay, so prefer `closedOnly` for values that must never change in hindsight.

**With fetched rows.** `intervals` combines with `fetch` and `subscribe` (see below): `compute` and `update` get both the rows in `data` and the bars in `bars`. Each loads on its own rules, `refetch()` reloads both, and the indicator's status shows the more telling of the two: a reason it draws nothing, then an error, then loading.

A higher bar holds the chart bars from its time up to the next higher bar's time, not `time + interval`, so session gaps, DST days and calendar months need no special handling. The helpers differ in what a chart bar sees:

- **`alignSteps(lowerTimes, higherTimes, values)`** gives each chart bar the value of the higher bar it falls in. On past bars that is the higher bar's final value, which was not known yet at that chart bar.
- **`alignSteps(..., { closedOnly: true })`** gives each chart bar the value of the last higher bar that had closed by then, so plotted values never change in hindsight; the forming higher bar shows nothing yet.
- **`formingSteps(lower, higher, step)`** gives each chart bar the value as it stood then. `step(bars, j)` sees higher bar `j` built from the chart bars so far (its open, the highest high and lowest low so far, that chart bar's close, the volume so far) and every earlier higher bar complete. It is called with ascending indexes, possibly several times for the same `j`, so it must only keep state for bars before `j`, like `update`.

For values that never use later data, use `formingSteps` or `closedOnly`. The demo's "RSI on a higher interval" does both.

### Higher-interval bars as boxes

The opt-in `higherIntervalBars()` plugin adds an overlay indicator, `higher-interval-bars`, that draws each bar of a longer interval behind the chart's bars: a range box from its high to its low and a body box from its open to its close, both spanning the chart bars it holds, coloured by direction. It reads its bars through `intervals`, so the boxes load, page and update live as described above, and the forming box follows every tick.

```ts
import { createChart, higherIntervalBars } from '@chart-on/core';

const chart = createChart(el, { plugins: [higherIntervalBars()] }); // or chart.install(higherIntervalBars())
chart.indicators.add('higher-interval-bars', { interval: '1h' });   // hourly boxes on a 5-minute chart
```

| Input | Default | Meaning |
| --- | --- | --- |
| `interval` | `'auto'` | Interval of the boxes: `'5m'`, `'15m'`, `'1h'`, `'4h'`, `'1d'`, `'1w'`, `'1M'`, or `'auto'` for the first of those longer than the chart's interval. On the longest chart interval, `auto` draws nothing and says so. |
| `style` | `'filled'` | `'filled'` (translucent range, stronger body) or `'outline'` (dashed range, solid body). |
| `count` | `0` | How many of the newest higher bars to draw, the forming one included; `0` draws all. |
| `upColor`, `downColor` | theme | Colours of rising and falling higher bars; empty uses the theme's `up` and `down`. |

The boxes draw under the series, in the indicator's pane and on its price scale (`priceScale`), and that scale's autoscale keeps them in view. A higher bar covers the chart bars from its time up to the next higher bar or its own end, whichever comes first, so a higher bar missing from the data source leaves a gap rather than stretching the box before it. Bars of a day or longer end on the next wall-clock day in the symbol's timezone, so DST days are whole. While the chart interval is equal to or longer than the chosen one, nothing draws and the legend says why.

The indicator has no plots, so its legend row shows only its title, without the higher bar's values, and the boxes take no hover. Uninstalling the plugin removes the chart's `higher-interval-bars` indicators. The demo shows hourly boxes from **View > Display > Hourly bars as boxes**.

### Status

```ts
indicator.status;   // 'idle' | 'loading' | 'loaded' | 'empty' | 'error'
indicator.message;  // the supports reason, a fetch error or the setError text; null otherwise
chart.on('indicator:status', ({ indicator, status, message }) => {});

indicator.setError('Quota exceeded'); // an error from the app: status 'error', message in the pane
indicator.clearError();
indicator.refetch();                  // drop the rows and fetch again, e.g. after the source corrected them
```

While a fetch runs, the legend row shows the text "Loading…" before the indicator's values (text, not a spinner). A failed fetch sets `error`, shows its message in the pane and emits `indicator:error`. The next history page, context change or (without `subscribe`) new bar tries again; the error stays until a fetch covering the failed range succeeds, so another range loading fine does not hide it. A `subscribe` that throws keeps `error` until the indicator subscribes again. Indicators on another interval report their loads the same way. Indicators without `fetch`, `subscribe` or `intervals` stay `idle` unless the app calls `setError`.
