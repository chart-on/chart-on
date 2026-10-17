---
description: "Charts whose horizontal axis is a number instead of time: order-book depth curves, yield curves and option strikes."
---

# Numeric axis charts

Some trading charts have no time on the horizontal axis: a cumulative order-book depth curve puts price there, a yield curve puts maturity there, and an option chain puts the strike there. `createNumericChart` makes a chart for this kind of data. It uses the same WebGL2 renderer, theme tokens, fonts and price formats as `createChart`, so it looks the same as your time charts next to them.

```ts
import { createNumericChart, darkTheme } from '@charton/core';

const chart = createNumericChart(container, {
  theme: darkTheme,
  priceScale: { format: { type: 'percent', precision: 2 } },
});

const curve = chart.addLine({ title: 'Today', lineWidth: 2 });
curve.setData([
  { x: 0.25, value: 5.41 }, // maturity in years, yield in percent
  { x: 2, value: 4.63 },
  { x: 10, value: 4.31 },
  { x: 30, value: 4.49 },
]);
chart.addPriceLine({ price: 5.33, title: 'Policy rate' });
```

Items carry `x` instead of `time`. The horizontal axis is linear in `x`, so the gap between 10 and 30 years is twice as wide as the gap between 0 and 10. On a time chart, every bar takes the same width.

## What a numeric chart has

- **Series:** `addLine(options)` for lines, step lines (`lineType: 'step'`) and areas (`area: true`), and `addHistogram(options)` for columns centred on each `x`. A column's width is `columnWidth` in x units, and by default 80% of the smallest gap between items.
- **Price lines:** `addPriceLine({ price, title?, color?, lineStyle?, lineWidth?, axisLabel? })` returns a handle with `applyOptions` and `remove`.
- **Crosshair and legend:** the crosshair shows `x` and the price on the axes. The legend shows each series' title, and its value under the crosshair: interpolated on a line, held on a step line, and the covering column on a histogram.
- **View:** `fitContent()`, `getVisibleRange()` and `setVisibleRange({ from, to })` work on `x`. The view follows new data until the user pans or zooms. After that it stays where the user left it, until `fitContent()` is called. Panning and zooming always keep part of the data on screen, and the view gets no wider than ten times the data. The price axis always fits what is visible; `getPriceRange()` reads it.
- **Input:** drag to pan, the wheel zooms at the pointer (a horizontal wheel pans), and a double-click fits the content. With focus, the arrow keys pan, `+` and `-` zoom, and Home fits. Keys pressed with Ctrl, Cmd or Alt are left to the page. Pass `interactive: false` for a static chart.
- **Conversions:** `pointAt(x, y)` takes chart-root css px and returns `{ x, price, point }`. `coordinateFor(x, price?)` goes the other way. `setCrosshairAt({ x, price })` places the crosshair from code.
- **Primitives:** `attachPrimitive(primitive)` draws your own shapes and axis labels; see [Primitives](#primitives).
- **Events:** `chart.on(name, listener)` returns an unsubscribe function. The events are:
  - `crosshair:move`: a `NumericPointerEvent`, or null.
  - `range:change`: the visible x range, `{ from, to }`.
  - `plot:click`: a `NumericPointerEvent`.
  - `item:dropped`: `setData` left out an item without a finite `x` and `value`.
  - `chart:resize`, `theme:change` and `chart:destroy`, as on the time chart.
  - `chart:error`: a listener threw (a `ChartError` with code `listener-failed`), or the GPU context could not be restored.

  The time chart's `view:change` and `data:dropped` carry time and bars, so a numeric chart uses its own names for them.

Items may come in any order: `setData` sorts them by `x`. Items with the same `x` keep their order and draw a vertical jump.

## What it does not have

Candles, indicators, sessions, the data source, replay and the drawing tools all work in time, so a `NumericChart` does not have them. They are not methods on it, so TypeScript reports a call to one as an error at compile time. Use `createChart` for time series.

## Primitives

A numeric chart takes its own kind of [primitive](./primitives): a plain object whose members are all optional. It works like a time chart's primitive, but its coordinates are in `x` instead of bar indices and times.

```ts
import { crispLine, type NumericPrimitive } from '@charton/core';

/** A vertical line at the mid price, with its price as a label. */
function midLine(mid: number, color = '#f59e0b'): NumericPrimitive {
  return {
    layer: 'top',
    drawPlot(ctx, env) {
      const x = env.xToPixel(mid);
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      crispLine(ctx, x, 0, x, env.height, 1, env.pixelRatio);
      ctx.fillStyle = color;
      ctx.fillText(env.formatX(mid), x + 4, 12);
    },
  };
}

const detach = chart.attachPrimitive(midLine(100));
detach();
```

| Member | Notes |
| --- | --- |
| `layer` | `'below'` (under the series), `'normal'` (default, over the series and under price lines) or `'top'` (over price lines and the crosshair) |
| `attached(host)` / `detached()` | Lifecycle. `host.requestRedraw()` redraws the chart on the next frame; `host.requestOverlayRedraw()` does the same, so a primitive written for both chart types can call it |
| `drawPlot(ctx, env)` | Draw in the plot area; clipped to it |
| `priceAxisLabels(env)` | `{ price, text, color, textColor? }[]` drawn on the price axis like price line labels; the axis widens to fit those within the visible prices |
| `priceRange(from, to)` | `[min, max]` to keep in view while x from `from` to `to` is visible |

`env` is in plot-local css px: `width`, `height`, `pixelRatio`, `theme`, the visible x range `from` / `to` (low to high, also on an inverted axis), `xToPixel`, `pixelToX`, `priceToY`, `yToPrice`, and `formatX` and `formatPrice`, which label values the way the crosshair does.

`attachPrimitive` returns a function that removes only that attachment, and `detachPrimitive(primitive)` removes it however it was attached. Attaching a primitive twice throws, attaching one after `destroy()` throws a `ChartError` with code `destroyed`, and if `attached()` throws, the primitive is not attached and the error propagates. `destroy()` detaches every primitive first, so `detached()` can stop timers. Any other member that throws is reported as a `chart:error` with code [`primitive-failed`](./errors#primitive-failed), once per primitive, while the rest of the chart keeps drawing. The chart draws primitives whenever it redraws; call `host.requestRedraw()` when a primitive's own state changes.

A time chart's `Primitive` does not fit a numeric chart, because its `env` maps bar indices and times. Panes, series targets, lanes, axis drawing and hit tests are not part of a numeric primitive.

## Options

```ts
createNumericChart(container, {
  theme: lightTheme,                 // any ChartTheme tokens, as for createChart
  horizontalScale: {
    format: { type: 'decimal', tickSize: 0.01 }, // labels for x; default: decimals from the tick step
    invert: false,                   // true puts larger x on the left
    margin: 0.02,                    // free room left and right after fitContent, as a fraction of the width
  },
  priceScale: { format: { type: 'volume' }, invert: false, marginTop: 0.1, marginBottom: 0.05 },
  grid: true,
  crosshair: true,
  legend: true,
  interactive: true,
});
```

`chart.applyOptions(patch)` changes any of them later. `horizontalScale` and `priceScale` merge field by field. A `theme` patch changes only the tokens it names, as on the time chart, and recolours series that take their colour from it.

## Depth curves

`depthCurve(bids, asks)` turns order-book levels (`{ price, size }`, in any order) into the two cumulative series of a depth curve, for step lines:

```ts
import { createNumericChart, depthCurve, darkTheme, type BookLevel } from '@charton/core';

const chart = createNumericChart(container, { theme: darkTheme, priceScale: { marginBottom: 0 } });
const bidLine = chart.addLine({ title: 'Bids', color: darkTheme.bid, lineType: 'step', area: true });
const askLine = chart.addLine({ title: 'Asks', color: darkTheme.ask, lineType: 'step', area: true });

function showBook(bids: BookLevel[], asks: BookLevel[]) {
  const curve = depthCurve(bids, asks);
  bidLine.setData(curve.bids);
  askLine.setData(curve.asks);
}
```

Between levels, the bid curve shows the total size of every bid at that price or above, which is what a market sell down to that price would fill. The ask curve shows the total of every ask at that price or below. Both drop to zero at their best price, so the spread is the gap between them. Levels at the same price are added together, and levels without a finite price or a positive size are skipped.

A crossed or locked book (the best bid at or above the best ask) is drawn as given, so the two curves overlap. `depthCurve` does not fix it but sets `crossed: true` on its result. A live book usually shows this only for a moment, or when its feed is out of step, so check the flag to warn or to wait for the next update.

The demo's `numeric.html` page shows a depth curve, a yield curve and open interest by strike, in the dark and light themes.
