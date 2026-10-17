---
description: "Add your own chart type from a plain definition object, with alignment, autoscale and legend handled by the chart."
---

# Custom series

Add your own chart type without forking the engine. A custom series definition is a plain object; the chart handles data, time alignment, autoscale, the legend, the last-value label and overlay scales.

<!-- example: custom-series -->

Feed it live with `update`: an item with the same time replaces the last one, a newer one is appended.

```ts
channel.update(point);
```

The demo's price channel (`apps/demo/src/band.ts`) is a complete example.

## Definition

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | Id for debugging and saved layouts |
| `defaultOptions` | no | Your own options; merged under the ones passed to `addCustomSeries` |
| `priceRange(item, options)` | yes | `[min, max]` of one item, or `null` to leave it out of autoscale |
| `draw(ctx, view)` | yes | Canvas2D drawing, pane-local css px; the context is saved and restored around it |
| `legend(item, options)` | no | Legend parts for the item under the crosshair (`undefined` when there is none) |
| `lastValue(item, options)` | no | `{ value, color? }` for the price-axis label of the newest item |
| `step(dt, data, options)` | no | Advance animations by `dt` ms each frame; return `true` while animating |
| `group(items, options)` | no | One item standing for several consecutive items while the chart [groups bars](./view-and-scale#group-bars-when-zoomed-out); give it the first item's `time`. Called once per bucket as it comes into view, and again only when the bucket's items change. Without it a bucket shows its last item |

`view` holds:

- `items`: visible items (plus one either side) as `{ item, index, x }`. While the chart groups bars, one item per bucket at the bucket's centre, and `barSpacing` is the bucket's width.
- `options`: your options plus `title`, `lastValueLabel`, `format` and `overlay`.
- `width`, `height`, `barSpacing`, `pixelRatio`, `theme`.
- `priceToY(price)`, `yToPrice(y)` on the series' scale (pane scale or its overlay scale; log and percent modes included), and `indexToX(index)`.

## Options

Every custom series accepts `title`, `lastValueLabel` (default `true`), `axisTitle` (default `false`, a title tag beside the label), `format` (value formatter for the axis label), `priceFormat` (a [price format](./series#price-formats) that wins over `format` for the axis label) and `overlay` (its own scale, like volume) next to its own options. `applyOptions`, `setVisible` and `chart.removeSeries` work as for built-in series.

Items whose time is not a bar of the main series are skipped, like line and histogram points. Drawing is Canvas2D; a GPU hook may come later.

## Errors

A hook that throws never stops the chart. The series is skipped for that frame: `draw` draws nothing (any `save()` it left open is restored), `priceRange` leaves the series out of autoscale, `legend` shows no values, `lastValue` and `format` show no axis label, `step` stops animating, and a failing `group` shows the bucket's last item. Other series, panes and the axes keep drawing.

The chart reports the error through the `series:error` event, once per hook until that hook succeeds again. Without a listener it goes to `console.error`.

```ts
chart.on('series:error', ({ series, hook, error }) => {
  console.warn(`${series.id}: ${hook} failed`, error);
});
```
