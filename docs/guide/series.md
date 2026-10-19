---
description: "Candles, lines, histograms, heatmaps and point markers: creating series, their data and options, and price formats."
---

# Series and data

Built-in series types plus [custom series](./custom-series), all created from the chart. Each `add*` call takes options and an optional [pane](./panes).

| Method | Data | Typical use |
| --- | --- | --- |
| `addCandles` | `Bar[]` | Price, in [14 chart types](#chart-types) |
| `addLine` | `ValuePoint[]` | Moving averages, cumulative delta, any line |
| `addHistogram` | `ValuePoint[]` | Volume, liquidations, oscillators |
| `addHeatmap` | `HeatmapData` | Order-book or liquidation heatmaps |
| `addPoints` | `PointItem[]` | Large trades, liquidations, sampled ticks as dots or bubbles; see [Points](#points) |
| `addVolumeProfile` | main series bars | Volume by price, see [Volume profile](./volume-profile) |
| `addCustomSeries` | your own `{ time, ... }` items | Chart types you define; see [Custom series](./custom-series) |

```ts
interface Bar {
  time: number; open: number; high: number; low: number; close: number; volume?: number; buyVolume?: number;
  color?: string; wickColor?: string; borderColor?: string; // this bar's colours, see below
}
interface ValuePoint { time: number; value: number; color?: string; areaColor?: string }
```

Every series supports:

```ts
series.setData(data);           // replace all data; times must be ascending
series.setData(data, { normalize: true }); // sort, keep the last of equal times, drop invalid candles
series.setData(data, { keepVisibleRange: true }); // main series: keep the times in view (see View and scale)
series.update(point);           // replace last (same time) or append (newer); older is dropped
series.applyOptions({ ... });   // change options later
series.setVisible(false);       // hide without removing
chart.removeSeries(series);   // also frees its GPU buffers and textures
series.zIndex = 1;              // draw above the pane's other series (default 0)
chart.moveSeriesToFront(series); // or chart.sendToBack(series)
```

Within a pane, z-order applies among series drawn by the same renderer: a higher `zIndex` draws on top. GPU series (candles, histograms, heatmaps, and lines, areas and line-drawn candle styles on the default [GPU renderer](#gpu-lines)) always draw below 2D series (curved lines, lines with per-point colours, custom series, and anything with `renderer: 'canvas'`), so a canvas line stays above candles whatever their `zIndex`; candles in the `columns` style always draw in 2D. Equal values keep the usual order: heatmaps at the bottom, then overlays and volume profiles, then the rest, each in the order added. `moveSeriesToFront` and `sendToBack` set `zIndex` past the pane's other series. Hovering picks the topmost series in the same order. Changing the order only redraws; nothing is uploaded to the GPU again.

What `normalize` and an older `update` leave out is reported through the `data:dropped` event. A time that is not a finite number always throws, and a non-finite line or histogram value is a gap. See [bad values](./concepts#bad-values) for the full rules.

Candle, line and histogram series also accept `overlay` (see [Overlay scale](#overlay-scale)) and `priceScale`, the id of the price scale they use (default `'right'`; see [several price scales](./view-and-scale#several-price-scales)).

## Candles

```ts
const candles = chart.addCandles({
  title: 'BTC',
  style: 'candles',   // see chart types below
  upColor: '#3cc4a0', // defaults to theme.up
  downColor: '#e8574a',
  precision: 2,       // auto-detected from data when omitted
});
candles.setData(bars);
candles.update(lastBar);
```

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `''` | Legend label |
| `legend` | `true` | `false` leaves the series out of the legend (every series type takes it, as do volume profiles and `indicators.add(def, inputs, { legend: false })`) |
| `style` | `'candles'` | See [chart types](#chart-types) |
| `upColor`, `downColor` | theme | |
| `upWickColor`, `downWickColor` | body colours | Wick colours of the candle styles |
| `upBorderColor`, `downBorderColor` | none | Body outline colours of the candle styles |
| `wicks` | `true` | Draw wicks; `false` leaves candle bodies only |
| `borders` | `true` | Draw the outlines the border colours set; hollow candles keep theirs |
| `colorByPreviousClose` | `false` | Colour bars by change from the previous close instead of from the open |
| `hollowDown` | `false` | Draw falling bodies as outlines (`candles`, `heikinAshi`, `volumeCandles`), so up and down differ in shape too |
| `precision` | auto | Fixed price decimals |
| `priceFormat` | none | Decimals, tick size, fractions and unit; wins over `precision`. See [Price formats](#price-formats) |
| `bodyRatio` | `0.7` | Candle body width relative to bar spacing |
| `thinBars` | `true` | One-pixel `bars` / `hlcBars` at any zoom; `false` thickens them as bars widen |
| `lineWidth` | `2` | For line-based styles |
| `lineStyle` | `'solid'` | `'solid'`, `'dashed'` or `'dotted'`, for `line`, `lineMarkers`, `step`, `area`, `baseline` and the close line of `rangeBand` |
| `renderer` | `'gpu'` | `'gpu'` draws the lines and fills of the line-drawn styles with WebGL2; `'canvas'` draws them in 2D. See [GPU lines](#gpu-lines) |
| `lastValueLabel` | `true` | Price label on the axis |
| `priceLine` | main series only, unless its `lastValueLabel` is `false` | Price line across the plot, see [Price line](#price-line) |
| `offscreenLastPrice` | unset | `'hollow'` or `'hidden'`: the axis label while the newest bar is panned off screen |
| `autoscale` | `true` | `false` leaves the series out of its price scale's fit; a function adjusts the range it adds. See [Per-series autoscale](./view-and-scale#per-series-autoscale) |
| `axisTitle` | `false` | Tag with the title (or the symbol name) beside the axis label |
| `animate` | `true` | Tween live updates of the forming bar |
| `overlay` | none | Own price scale, see [Overlay scale](#overlay-scale) |
| `baseLevel` | middle of the pane | Where the `baseline` style splits its fills, see [Baseline base level](#baseline-base-level) |
| `lastPointPulse` | `'off'` | A pulse on the newest close of the `line`, `area`, `step` and `baseline` styles (with the `lastPointPulse()` plugin), see [Last-point pulse](#last-point-pulse) |

### Price line

The dotted line across the plot at the newest price is the series' price line. It is separate from the axis label, so either can be on without the other, and every series type (candles, lines, histograms, custom series) can have one. It is on by default only for the main candle series.

```ts
candles.applyOptions({ priceLine: { color: '#f0a73a', lineStyle: 'dashed', lineWidth: 1 } });
line.applyOptions({ priceLine: true });            // default style: dotted, 1 px, label colour
candles.applyOptions({ priceLine: false, lastValueLabel: true }); // label only
candles.applyOptions({ priceLine: { source: 'lastVisible' } });   // follow the view while panning
```

| Field | Default | Notes |
| --- | --- | --- |
| `color` | label colour | |
| `lineWidth` | `1` | |
| `lineStyle` | `'dotted'` | `'solid'`, `'dashed'` or `'dotted'` |
| `source` | `'last'` | `'last'`: the newest value. `'lastVisible'`: the newest value on screen |

`features.lastValueLabels` turns price lines and labels off together. While the newest bar is panned off screen, `offscreenLastPrice: 'hollow'` draws the axis label as an outline and `'hidden'` leaves it out.

### Per-bar colours

A bar's `color`, `wickColor` and `borderColor` override the series colours for that bar alone, e.g. to highlight signal bars or volume spikes from your own logic:

```ts
candles.setData(bars.map((b) => (isSpike(b) ? { ...b, color: '#f59e0b', wickColor: '#f59e0b' } : b)));
```

`color` is the body (and the lines of `bars` and `hlcBars`, and the `highLow` bar). `wickColor` is the wick and `borderColor` the body outline, in the candle styles that have them (`candles`, `hollow`, `heikinAshi`, `volumeCandles`; not `bars`, `hlcBars` or `highLow`). They only recolour: with `wicks: false` or `borders: false` the wick or outline stays hidden. The colours stay with the live bar while it eases, and the last-value label and price line take the last bar's `color`. An `update` replaces the bar, so send the colours again with it to keep them. The line, area, baseline and column styles ignore them, a colour the browser cannot parse falls back to the series colour, and `getDataTable` leaves them out.

An indicator's `barColor` plot recolours the main series' bars the same way, body, wick and outline, over these colours (see [plot types](./indicators.md)).

### Chart types

Switch any time with `candles.applyOptions({ style })`.

| Style | Draws |
| --- | --- |
| `candles` | Filled candles |
| `hollow` | Hollow candles for up bars |
| `volumeCandles` | Candles whose body width follows volume, see [Volume-width candles](#volume-width-candles) |
| `bars` | OHLC bars |
| `heikinAshi` | Heikin-Ashi candles, computed from your bars |
| `hlcBars` | Bars with high, low and a close tick (no open) |
| `rangeBand` | Close line with a band to the high and the low: the part above the close tinted with the up colour, below with the down colour |
| `highLow` | High-low range bars |
| `baseline` | Close colored above/below a base level (the middle of the pane by default) |
| `columns` | Close as columns, colored up/down |
| `area` | Close as a line with gradient fill |
| `line` | Close as a line |
| `lineMarkers` | Line with a dot per bar |
| `step` | Close as a step line |
| `kagi` | Kagi line for bars from `PriceBarBuilder` with `type: 'kagi'`, see [Price-based bars](#price-based-bars). Needs the `priceStyles()` plugin |
| `pointFigure` | Columns of X and O boxes for bars from `PriceBarBuilder` with `type: 'pointFigure'`, see [Price-based bars](#price-based-bars). Needs the `priceStyles()` plugin |

The table lists the styles in the order of the shell's style menu (`chartStyles` in `@chart-on/ui`): grouped by what they draw, all four prices, the range or the close, and within a group the style that shows the most values of a bar first. `rangeBand` was called `hlcArea` before; a saved layout with that name draws `candles` (see [upgrading](../upgrading/)).
`heikinAshi(bars)` and `heikinAshiBar(bar, prevHa)` are exported if you need the values yourself.

Switching style eases the price scale to the new range (with the chart's `smoothScale` option, on by default), so moving between close-only styles (`line`, `area`, ...) and high-low styles (`candles`, `rangeBand`, ...) animates. `rangeBand` autoscales on high and low like candles.

`hollow` always colours by change from the previous close; `colorByPreviousClose` applies the same rule to the other bar and candle styles. Wick and border colours apply to `candles`, `hollow`, `heikinAshi` and `volumeCandles`.

The first candle series is the main series and defines the time axis. See [Core concepts](./concepts#the-main-series-defines-the-time-axis).

#### Baseline base level

The `baseline` style colours and fills the close line with the up colour above a base level and the down colour below it. `baseLevel` sets that level:

```ts
candles.applyOptions({ style: 'baseline', baseLevel: { kind: 'price', price: 64000 } });
```

| `baseLevel` | Base |
| --- | --- |
| `{ kind: 'height', percent: 50 }` | A height in the pane, in percent from the bottom. The default; the price under it changes as you scroll and zoom |
| `{ kind: 'price', price }` | A fixed price. Autoscale keeps it in view. On a log scale a price of zero or below falls back to the middle of the pane |
| `{ kind: 'firstVisible' }` | The close of the first visible bar. When this series is the base of a percent scale, this is the 0% line |

The fills split exactly at the base price on normal, log and percent scales. `candles.basePrice` is the price the last frame used (null for other styles).

While the pointer is over the series, the base price is labelled on the price axis, also with `lastValueLabel: false` (that option hides only the last price label). Drag that level on the price axis to move it: a height level stays a height, a fixed or first-visible level becomes a fixed price (rounded to the tick size). Dragging is an axis drag, so it is off with the `axisDragScale` feature. Each move emits `baseline:change` with `{ series, baseLevel, price }`; store `baseLevel` to restore it later.

#### Volume-width candles

The body width is the normal body width (`bodyRatio` × bar spacing) scaled by the bar's `volume` relative to the largest volume currently on screen, so the widest body marks the busiest visible bar. Widths are re-measured as you pan and zoom. Bodies never get narrower than a quarter of a normal body, or than three wick widths when there is room, so low-volume bars stay readable. Bars without `volume` keep the normal width.

### Price-based bars

Renko, line break, range, kagi and point & figure bars are made from price movement, not from the passage of time, so they have a timeline of their own. `PriceBarBuilder` turns your time bars into them, and an ordinary candle series draws the result:

```ts
import { PriceBarBuilder } from '@chart-on/core';

const builder = new PriceBarBuilder({ type: 'renko', size: { kind: 'fixed', size: 5 } });
const candles = chart.addCandles({ title: 'Renko' });
candles.setData(builder.setData(bars));

// Live: send every new or changed source bar, then apply what changed.
const change = builder.update(bar);
if (change.reset) candles.setData(builder.bars, { keepVisibleRange: true });
else for (const b of change.bars) candles.update(b);
```

| `type` | Draws |
| --- | --- |
| `renko` | A brick each time price moves `size` past the last brick. A reversal needs `reversal` bricks (default 2) counted from the last brick's close, and starts at the last brick's open. Bricks have no wicks. |
| `lineBreak` | A line from the last line's close to each close beyond it. A close beyond the extreme of the last `lines` lines (default 3) the other way draws a reversal line from the last line's open. The first line runs from the first close to the first close that differs. |
| `range` | Bars whose high minus low stays within `size`. When price goes past it, the bar closes at its low plus `size` (or its high minus `size`) and the next bar opens there. The newest bar is still forming. |
| `kagi` | One bar per vertical stretch of a kagi line, from `open` (where the line turned) to `close` (how far it ran). The line runs on while price keeps its direction, and turns when price moves back `size` from its end. The first stretch starts once price has moved `size` from the first price. Draw it with `style: 'kagi'`. |
| `pointFigure` | One bar per column of boxes `size` high, on a grid of multiples of `size`: X boxes from `open` up to `close` while price rises, O boxes from `open` down to `close` while it falls. A move of `reversal` boxes (default 3) back from the last box starts a new column one box beyond it. Prices are box middles. Draw it with `style: 'pointFigure'`. |

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | `{ kind: 'atr', length: 14 }` | Brick size, bar range, kagi reversal amount or point & figure box size: `{ kind: 'fixed', size }`, `{ kind: 'atr', length }` (average true range of the loaded bars) or `{ kind: 'percent', percent }` (of the newest loaded close). ATR and percent sizes are worked out by `setData` and kept for live updates; `builder.size` reads the result. A size that comes out zero (flat or zero prices) is worked out again from each new source bar, and no bars form until it is positive. |
| `reversal` | `2` (`renko`), `3` (`pointFigure`) | `renko`: bricks against the trend that draw a reversal brick (at least 2). `pointFigure`: boxes back from the last box that start a new column (at least 1). |
| `source` | `'close'` (`renko`, `kagi`, `pointFigure`), `'highLow'` (`range`) | `'close'` follows each close. `'highLow'` follows the high and low, reading a rising bar as touching its low first and a falling bar its high first; range bars also follow the open and close. `lineBreak` always uses closes. |
| `lines` | `3` | `lineBreak`: how many lines a reversal must break |
| `slotSeconds` | the source interval | Spacing of the bars' `time` (see below) |

Each `PriceBar` is a `Bar` with `startTime` and `endTime`: the source bars it covers, from where the previous one ended. Volume of the source bars goes to the bar they complete (renko) or the newest bar (line break, range, kagi, point & figure; source bars before the first kagi stretch or point & figure column count towards it). One source bar can make several price bars, so their `time` is only a slot: the first source time plus `slotSeconds` per bar. When the main series' bars carry `startTime` and `endTime`, the chart shows that span instead of the slot: the crosshair time label and `valuesAt().timeText` (the data window and pointer tooltip) read `start – end` through `formatTime`, and `valuesAt().source` gives it as `{ time, endTime }`. Label the time axis with `builder.barAt(time)`:

```ts
const chart = createChart(el, {
  formatTimeTick: (time) => fmt(builder.barAt(time)?.endTime ?? time),
});
```

Kagi and point & figure bars are not candles, so the candle series has a style for each, drawn on the GPU by its own renderer. Both come with the `priceStyles()` [plugin](./features#opt-in-features), which `builtins()` includes. Without it a series in either style draws nothing, and development builds warn once ([`price-styles-missing`](./errors#price-styles-missing)):

```ts
import { PriceBarBuilder, createChart, priceStyles } from '@chart-on/core';

const chart = createChart(el, { plugins: [priceStyles()] });
const builder = new PriceBarBuilder({ type: 'pointFigure', size: { kind: 'percent', percent: 1 }, reversal: 3 });
const columns = chart.addCandles({ style: 'pointFigure' });
columns.setData(builder.setData(source));
```

- `kagi` draws one line through the bars: each bar a vertical stretch from its open to its close, joined to the next by a horizontal step. The line is thick (yang, in the up colour) from where it rises above the last shoulder and thin (yin, in the down colour) from where it falls below the last waist; it starts thick when the first stretch rises. Every turn makes a shoulder (the top of a rising stretch) or a waist (the bottom of a falling one), whatever the thickness, and the most recent one is the level to break: a thin rally that fails below the old shoulder sets a lower shoulder, so the next rally above it turns the line thick. The thick line is `lineWidth` × 1.5 wide and the thin one `lineWidth` × 0.5 (at least 1 px).
- `pointFigure` draws an X for every box of a rising column and an O for every box of a falling one, in the up and down colours (a bar's own `color` wins), each box `bodyRatio` of the bar spacing wide. A one-box column (open equal to close) turns from the column before it. The box height is the `boxSize` each bar from `PriceBarBuilder` carries; the `boxSize` option overrides it, and for bars made elsewhere, without the option, the series reads it from the bars as the step from one column's last box to the next column's first. Autoscale keeps whole boxes in view. Only the boxes in view are drawn, so a very small box size costs no more than the screen holds, and a column whose boxes or width are under 3 px is drawn as one filled span.

Both styles draw every bar even when the view groups bars (`grouping`). The legend, crosshair, snapping and price labels read the bars' open, high, low and close as for candles.

A live update can take bars back: a forming source bar that retreats removes the bricks it had drawn. `update` reports that as `reset`. One source bar adds at most 10,000 price bars, so a size far too small for the data cannot hang the page. `priceBars(bars, options)` builds the bars in one go when you do not need live updates. Indicators and other series on the same chart line up with the price bars' slots, not with the source times, so compute anything you overlay from the price bars.

## Line

```ts
const cvd = chart.addLine({ title: 'CVD', area: true, baseline: 0 });
cvd.setData(points);
```

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `''` | |
| `color` | `theme.line` | |
| `lineWidth` | `1.5` | |
| `area` | `false` | Gradient fill under the line |
| `colorMode` | `'segment'` | How points' own colours join: `'segment'` or `'gradient'`. See [Per-point colours](#per-point-colours) |
| `baseline` | none | Switch colors above/below this value |
| `aboveColor`, `belowColor` | `theme.line` | Line colors above/below `baseline` |
| `format` | pane format | `(value) => string` for legend and axis label. By default a series on the pane's scale uses that scale's [price format](#price-formats); overlays and panes without one use compact numbers |
| `breakGaps` | `false` | Break the line over bars where the series has no point, instead of joining across them |
| `lineStyle` | `'solid'` | `'solid'`, `'dashed'` or `'dotted'`; dashes grow with `lineWidth` |
| `lineType` | `'simple'` | `'simple'` (straight segments), `'step'` (level until the next point, then a vertical jump) or `'curved'` (a smooth curve that never overshoots a point) |
| `renderer` | `'gpu'` | `'gpu'` strokes the line with WebGL2; `'canvas'` strokes it in 2D. See [GPU lines](#gpu-lines) |
| `pointMarkers` | `false` | `true` or `{ radius }`: a dot on every point, shown while bars are wide enough for the dots not to merge |
| `crosshairMarker` | `false` | `true` or `{ radius, color }`: a dot where the crosshair meets the line, in the line colour by default |
| `lastPointPulse` | `'off'` | `'on-update'`, `'continuous'` or `{ mode, color, radius, durationMs }`: a pulse on the last point (with the `lastPointPulse()` plugin), see [Last-point pulse](#last-point-pulse) |
| `priceFormat` | none | Wins over `format`; also sets the pane's tick size and axis unit when no candle series is on it. See [Price formats](#price-formats) |
| `lastValueLabel` | `true` | |
| `priceLine`, `offscreenLastPrice` | off, unset | As for [candles](#price-line) |
| `autoscale` | `true` | As for [candles](./view-and-scale#per-series-autoscale) |
| `axisTitle` | `false` | Title tag beside the axis label |
| `overlay` | none | Own price scale |

Lines are decimated to first/min/max/last per pixel column, so long histories stay fast. Steps and curves are built from the decimated points, so every `lineType` keeps the extremes of each column. Points without a finite value leave a gap, as do missing bars with `breakGaps`. The same `lineStyle`, `lineType` and `breakGaps` apply in baseline mode.

```ts
const signal = chart.addLine({ title: 'Signal', lineStyle: 'dashed', lineType: 'curved', crosshairMarker: true });
```

### Last-point pulse

On a live chart the newest point is easy to lose. `lastPointPulse` draws a ring that grows out of the last point and fades. It needs the `lastPointPulse()` [plugin](./features#opt-in-features), which `builtins()` includes; without it the option is kept but draws nothing, and development builds warn once ([`pulse-missing`](./errors#pulse-missing)):

```ts
import { createChart, lastPointPulse } from '@chart-on/core';

const chart = createChart(el, { plugins: [lastPointPulse()] });
const price = chart.addLine({ title: 'Price', lastPointPulse: 'on-update' });
price.update({ time, value }); // rings once

candles.applyOptions({ style: 'area', lastPointPulse: { mode: 'continuous', radius: 14, durationMs: 1200 } });
```

| Field | Default | Notes |
| --- | --- | --- |
| `mode` | `'on-update'` | `'on-update'` rings once each time `update` changes or adds the last point; `'continuous'` keeps ringing; `'off'` draws nothing. The string form sets only the mode |
| `color` | line colour | Ring and dot colour. By default the colour of the line at the last point (above or below colour in baseline mode) |
| `radius` | `10` | Size the ring grows to, in css px |
| `durationMs` | `900` | Time one ring takes to grow and fade |

The pulse draws on the overlay layer, so it never redraws the series themselves. It asks for frames only while a ring is running: an `'on-update'` ring stops after `durationMs`, and no mode animates while the last point is scrolled off screen, the series is hidden or the chart has no size. With `prefers-reduced-motion` set, and on static charts (`interactive: false`), the last point shows a still dot instead and no frames are requested. Candle series take the same option; it applies to the `line`, `area`, `step` and `baseline` styles.

### GPU lines

By default (`renderer: 'gpu'`) the line (and its `area` fill) is drawn on the GPU, like candles: its points upload once, panning and zooming only change uniforms, and appending or updating the last point uploads only the new vertices. It pays off with long lines, many lines, or charts that redraw often: on a pane with ten 3,000-point lines the CPU time per frame drops from about 3 ms to 0.5 ms; dashed lines still measure their length on screen every frame, so they gain less.

To stroke a line on the 2D canvas instead, for example so `zIndex` puts it above or below another canvas series, opt out:

```ts
const line = chart.addLine({ title: 'Signal', renderer: 'canvas' });
```

- GPU lines draw below every series drawn on the canvas, like candles, so `zIndex` orders them among GPU series only.
- `area` fills and baseline mode (with or without `area`) draw on the GPU too. Curved lines, and lines with [per-point colours](#per-point-colours), always draw on the canvas.
- The GPU draws every point on screen rather than decimating per pixel column, so where bars are less than a css pixel apart a GPU line has slightly less colour (about 4%) and its dashes fall elsewhere. With [grouping](./view-and-scale#group-bars-when-zoomed-out) on, zoomed-out views draw the grouped points instead, in the same pixel columns as the canvas.
- Joins are round for simple lines and mitred for steps (bevelled where the line turns back on itself), run ends are flat, and dashes carry on through joins, as on the canvas.

Candles take the same option, also `'gpu'` by default, for their line-drawn styles (`line`, `lineMarkers`, `step`, `area`, `baseline` and `rangeBand`): the close line, the area and baseline fills, and the range band and its edges draw on the GPU. The dots of `lineMarkers` and the dotted base level of `baseline` stay on the canvas, and the other styles ignore the option (the candle and bar styles always draw on the GPU, `columns` on the canvas).

```ts
const main = chart.addCandles({ style: 'area', renderer: 'canvas' }); // opt out
```

Where many bars share a pixel column, the canvas draws a range band from the highest high to the lowest low in it; the GPU draws one bar per column there, so a zoomed-out range band can look slightly thinner. With [grouping](./view-and-scale#group-bars-when-zoomed-out) on, both draw the grouped bars.

### Per-point colours

A point's `color` colours the line from that point to the next one, and `areaColor` the fill under that stretch when `area` is on. Use them to colour a line by state, such as green while a trend filter is up and red while it is down, without splitting it into several series:

```ts
const trend = chart.addLine({ title: 'Trend', area: true });
trend.setData(points.map((p) => ({ ...p, color: p.up ? '#22c55e' : '#ef4444' })));

// Blend from one point's colour to the next one's instead.
trend.applyOptions({ colorMode: 'gradient' });
```

- With `colorMode: 'segment'` (the default) each segment takes the colour of the point it starts at. With `'gradient'` a segment between two different colours blends from one to the other.
- Points without a `color` use the series colour; in baseline mode they keep switching between `aboveColor` and `belowColor`, while a point's own colour wins over both.
- The fill under a segment uses the point's `areaColor`, fading downwards; without one it is the line colour faded, as for a plain area. A colour the browser cannot parse falls back to the series colour.
- Steps keep the colour of the point they level out from up to the vertical jump. Curves, `lineStyle` and `breakGaps` work as without colours, and dashes run on across colour changes. When several points share a pixel column, the column takes its last point's colour; with grouping on, a bucket takes the colour of its last point.
- The legend, the last-value label, point markers and the crosshair marker use the colour at their point.
- A line where some point has a colour draws on the canvas, whatever its `renderer`. A line with no colours draws exactly as before, at no extra cost. The series checks for colours on `setData` and on each `update` it keeps (not on one it drops), so once an update brings a colour the line stays on the colour path until the next `setData`.

## Histogram

```ts
const volume = chart.addHistogram({ title: 'Volume' }, pane);
volume.setData(bars.map((b) => ({
  time: b.time,
  value: b.volume ?? 0,
  color: b.close >= b.open ? '#3cc4a080' : '#e8574a80',
})));

// Or let it follow the candles: no setData or update calls needed.
chart.addHistogram({ title: 'Volume', follow: volumeOf }, pane);
```

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `''` | |
| `follow` | none | `(bar, prev, theme) => point \| null`: derive the series from the main bars, see [Series derived from the bars](#series-derived-from-the-bars). Lines and custom series take it too |
| `color` | `theme.line` | Color for all columns |
| `positiveColor`, `negativeColor` | none | Color by sign relative to `base`; wins over `color` |
| `base` | `0` | Columns grow from this value |
| `columnRatio` | `0.8` | Column width relative to bar spacing |
| `groupBy` | `'sum'` | What a column shows for several points when the chart [groups bars](./view-and-scale#group-bars-when-zoomed-out): `'sum'`, `'max'` or `'last'` |
| `format` | compact | |
| `priceFormat` | none | As for lines |
| `lastValueLabel` | `true` | |
| `priceLine`, `offscreenLastPrice` | off, unset | As for [candles](#price-line) |
| `autoscale` | `true` | As for [candles](./view-and-scale#per-series-autoscale) |
| `axisTitle` | `false` | Title tag beside the axis label |
| `overlay` | none | Own price scale |

A per-point `color` wins over everything else.

## Series derived from the bars

`follow` takes a mapper `(bar, prev, theme) => point | null` on line, histogram and custom series, and the chart keeps the series in step with the main bars: on `setData`, `update`, data source loads, history pages, symbol switches and theme changes. Return `null` to leave a bar out. `volumeOf` is the built-in volume mapper: it colours each bar by whether it closed above the previous close.

<!-- example: derived-series -->

A new bar is mapped once, and a live update of the forming bar maps only that bar and replaces its point in place. A mapper that needs more than the previous bar (running totals, moving averages) is better written as an [indicator](./indicators).

Each point must have its bar's `time`. On a full load (`setData`, attaching the series, setting `follow` with `applyOptions`) a point at another time throws. On a live update the error goes to the `series:error` event with `hook: 'follow'` instead, that series skips the bar and the others carry on. Setting `follow` later maps the current bars; removing it clears the series, and removing the main series empties every follower.

## Price formats

`priceFormat` sets how a series' prices are shown, parsed and snapped. The axis, crosshair, legend, last-value labels, indicators on the price pane, drawings, primitives and the line, histogram and custom series on that scale that have no format of their own all use the format of the pane's scale: its first candle series, else the first series with a `priceFormat`. An invalid `priceFormat` throws when the series is created or `applyOptions` is called.

```ts
chart.addCandles({ priceFormat: { type: 'decimal', tickSize: 0.25 } });   // 4512.25
chart.addCandles({ priceFormat: { type: 'fraction', denominator: 32 } }); // 101'16 = 101 16/32
chart.addCandles({
  priceFormat: { type: 'fraction', denominator: 32, subDenominator: 4 },   // 101'162 = 101 16.25/32
});
chart.addCandles({
  priceFormat: {
    type: 'decimal',
    unit: 'USD',
    tickSize: [
      { from: 0, tickSize: 0.0001 }, // below 1
      { from: 1, tickSize: 0.01 },
      { from: 1000, tickSize: 1 },
    ],
  },
});
```

| Type | Options | Shows |
| --- | --- | --- |
| `decimal` | `tickSize` (a number, or bands by price; the first band also covers lower prices), `precision`, `zeroFold` | Fixed decimals. Prices round to the tick, and the tick sets the decimals unless `precision` is given (2 without either) |
| `fraction` | `denominator`, `subDenominator` (1 to 9), `separator` (default `'`) | Whole units and a numerator padded to the denominator's width. A sub-fraction adds one digit: tenths of a fraction step, rounded down (quarters read 0, 2, 5, 7) |
| `volume` | | Compact amounts such as `1.25M` |
| `percent` | `precision` | `12.30%` |
| `custom` | `format`, `parse`, `tickSize` | Your own formatter |

Every type also takes `unit`, shown at the top of the price axis.

With a tick size, price-axis labels land on whole ticks and drawing points snap to the nearest tick. `createPriceFormat(format)` returns the resolved formatter (`format`, `parse`, `tickSize`, `round`) for your own UI, such as a price input. `chart.formatPrice(pane, price)` and `chart.roundPrice(pane, price)` apply a pane's format.

A data source sets the format per symbol with `priceFormat`, `tickSize` or `precision` in its symbol info.

### Very small prices

Prices such as 0.00000412 show long runs of zeros that widen the axis and are hard to count. `zeroFold` on a `decimal` format folds them into a count after the first zero: `0.0₅412` is 0.00000412, with five zeros after the decimal point.

```ts
chart.addCandles({ priceFormat: { type: 'decimal', precision: 10, zeroFold: {} } }); // 0.0₅41200
chart.addCandles({
  priceFormat: { type: 'decimal', tickSize: 0.00000001, zeroFold: { minZeros: 5, style: 'brace' } },
}); // 0.0{5}412
```

| Option | Default | Meaning |
| --- | --- | --- |
| `minZeros` | `4` | Fold only with at least this many zeros after the decimal point; fewer stay as digits |
| `style` | `'subscript'` | `'subscript'` writes the count in subscript digits; `'brace'` writes `{5}`, for fonts without subscript digits |

Prices round to the tick and precision first, then fold, so the folded text keeps the decimals the format asks for. Zero and prices of 1 or more never fold. Every label that goes through the format folds: axis, crosshair, legend, last-value labels, drawings and annotations. `parse` reads both folded forms (in any decimal format), so price inputs round-trip. `getDataTable()` returns numbers, so exports keep every digit.

## Overlay scale

By default a series shares its pane's price scale. With `overlay` it gets its own scale, squeezed between top and bottom margins (fractions of pane height). Typical use: volume along the bottom of the price pane.

```ts
const volume = chart.addHistogram({
  title: 'Volume',
  overlay: { top: 0.8, bottom: 0 }, // bottom 20% of the pane
});
```

## Heatmap

A time × price grid, one column per main-series bar.

Heatmaps are [opt-in](./features#opt-in-features): create the chart with the `heatmap()` plugin (or `builtins()`). The UI shell adds it for you. `addHeatmap` builds the heatmap's GPU program, so a shader failure throws from that call ([`webgl-shader`](./errors#webgl-shader)).

```ts
const heat = chart.addHeatmap({ title: 'Liquidations' });
heat.setData({
  times,              // one per column, must match consecutive main bars
  priceStart: 60000,  // price of row 0 (lowest bucket)
  priceStep: 10,      // price height of each row
  rows: 400,
  values,             // Float32Array, column-major: values[col * rows + row]
});
heat.updateColumn(time, column); // replace last column (same time) or append next
```

`setData` throws when `times` are not finite and strictly ascending. `updateColumn` follows the `update` rules: the same time as the last column replaces it, a newer time appends, an older one is dropped and reported through `data:dropped` (`bar` is `{ time, column }`), and a time that is not a finite number throws. Non-finite values in a column are empty cells.

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `'Heatmap'` | |
| `colors` | `theme.heatmap` | Color ramp, low to high |
| `range` | auto | Fixed `{ min, max }`; otherwise percentiles of positive values, recomputed after `setData` or an option change and at most every 250 ms while `updateColumn` changes columns |
| `lowPercentile`, `highPercentile` | `40`, `98` | Auto range bounds |
| `gap` | `1` | Gap between cells in px, hidden when cells get small |
| `opacity` | `0.95` | |
| `cellReduce` | `'max'` | Where several cells fall into one device pixel (zoomed out, or many rows in a short pane): `'max'` shows the largest, so a thin level stays visible however the view pans; `'sum'` their total; `'nearest'` only the cell at the pixel centre. Rows are exact at any depth, read from reduction levels (copies of each column with 4, 16, 64… rows combined per value); columns are exact up to 8 per pixel, and past that evenly spaced columns are read and a sum is scaled up for the ones skipped |
| `inspector` | `true` | Hover grid showing neighbouring cell values. It shows the cells under the pointer, not the reduced value a pixel is drawn with |
| `format` | `v.toFixed(2)` | |
| `maxColumns` | none | Most columns kept |
| `memoryBudget` | 256 MiB | Bytes the grid may use, at 8 per cell (GPU texture plus CPU copy), plus about a third more for the reduction levels unless `cellReduce` is `'nearest'` |

Heatmaps always render beneath other series in their pane.

Limits: `rows` is capped by the GPU max texture size. The number of columns kept is the smallest of the GPU max texture size, `maxColumns` and `memoryBudget / ((rows + level values) × 8)`, where the levels add about `rows / 3` values a column with `cellReduce` `'max'` or `'sum'` and none with `'nearest'`; a 2,000-row grid keeps up to about 12,500 columns (16,384 with `'nearest'`), a 16,384-row grid about 1,500 (2,048). Changing `cellReduce` rebuilds the levels and can drop the oldest columns. `setData` keeps the newest columns that fit, an `updateColumn` that appends at the cap drops the oldest eighth, and lowering either option drops the oldest columns over it at once. These trims are silent: they are not bad input, so they do not emit `data:dropped`. An `updateColumn` whose column does not have `rows` values throws and leaves the grid unchanged.

## Points

Markers at an exact time and price, drawn on the GPU in one call however many there are: large trades or liquidations as bubbles sized by quantity, sampled ticks, signal clouds. Unlike bar markers they are not tied to a bar: several items may share a time, and each sits at its own time between bars or after the last one.

Point series are [opt-in](./features#opt-in-features): create the chart with the `points()` plugin (or `builtins()`). The UI shell adds it for you. Without it, `addPoints` throws [`not-registered`](./errors#not-registered).

```ts
const trades = chart.addPoints({
  title: 'Large trades',
  sizeBy: { min: 3, max: 26 }, // marker area grows with `size`
  opacity: 0.5,
});
trades.setData([
  { time: 1717200030, value: 67210, size: 12.5, color: '#3cc4a0' },
  { time: 1717200030, value: 67190, size: 3.1, color: '#e8574a' }, // same time: kept in order
  { time: 1717200095, value: 67250, size: 40 },
]);
trades.update({ time: 1717200120, value: 67300, size: 8 }); // appends; never replaces
```

```ts
interface PointItem {
  time: number;   // exact time; x is interpolated between bars
  value: number;  // price; items without a finite value are left out
  size?: number;  // css px diameter, or with `sizeBy` a quantity
  color?: string; // fill; default the series `color`
}
```

Times must be ascending but may repeat, and items with equal times keep their order (later ones draw on top). `setData` throws on a descending time; with `{ normalize: true }` it sorts instead, stably, and drops nothing. `update` always appends: an item older than the newest one is dropped and reported through `data:dropped`.

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `''` | |
| `shape` | `'circle'` | `'circle'`, `'square'` or `'diamond'` |
| `color` | `theme.line` | Fill of items without their own `color` |
| `size` | `6` | Diameter in css px of items without a usable `size` (missing, negative or not finite) |
| `sizeBy` | none | `{ min, max, domain?, scale? }`: read item sizes as quantities and map them to diameters from `min` to `max` px. `domain` defaults to the smallest and largest size in the data; quantities outside it clamp. `scale: 'sqrt'` (default) makes the area grow with the quantity, `'linear'` the diameter. Without `sizeBy`, an item's `size` is its diameter in px |
| `opacity` | `0.8` | Fill opacity |
| `stroke`, `strokeWidth` | none, `1` | Outline colour and width in px |
| `format`, `priceFormat` | compact, none | As for lines |
| `lastValueLabel` | `false` | Label the newest item's value on the axis |
| `priceLine`, `offscreenLastPrice` | off, unset | As for [candles](#price-line) |
| `axisTitle`, `overlay`, `priceScale` | | As for lines |

Points take part in autoscale (the items whose centres are in view), work on log, percent and overlay scales, and show in the legend as the newest value in the bar under the crosshair with the number of items in that bar (`N`). `chart.valuesAt` gives `{ value, count }` for the same bar. `series:hover` hit-tests the markers themselves, within their radius plus 3 px, and carries the item under the pointer as `item`; it fires again when the pointer moves to another item of the same series.

Data is uploaded to the GPU when it changes: `setData` writes every item, `update` one, and a new main bar rewrites only the items from the bar before it on (they were placed by extrapolation). Panning and zooming only change what is drawn, and a widening size domain is a shader uniform, so no data moves.
