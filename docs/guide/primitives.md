---
description: "Plugins that draw on a pane or a series, such as shading, alert lines and markers: members, coordinates and redrawing."
---

# Primitives

A primitive is a plugin that draws on the chart: background shading, alert lines, markers, volume profiles, watermarks. It is a plain object attached to a pane or a series; every member is optional.

```ts
import { crispLine, type Primitive } from '@chart-on/core';

/** A horizontal alert line with a price-axis label. */
function alertLine(price: number, color = '#f59e0b'): Primitive {
  return {
    layer: 'top',
    drawPlot(ctx, env) {
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      crispLine(ctx, 0, env.priceToY(price), env.width, env.priceToY(price), 1, env.pixelRatio);
    },
    priceAxisLabels: (env) => [{ price, text: env.formatPrice(price), color }],
    priceRange: () => [price, price], // keep it in view
    hitTest: (p, env) => (Math.abs(p.y - env.priceToY(price)) < 5 ? { cursor: 'ns-resize', part: 'line' } : null),
  };
}

const detach = chart.attachPrimitive(alertLine(70000));          // main pane
chart.attachPrimitive(alertLine(1200), { series: volume });      // on the volume series' scale
chart.attachPrimitive(alertLine(30), { pane: 1 });               // second pane
detach();
```

With no target the primitive goes on the main pane. A pane index or pane object that isn't in the chart (for example a pane that was removed) throws instead of falling back to the main pane, and so does a series that was removed. The returned `detach` removes only that attachment: calling it again, or after the primitive was attached anew, does nothing. If `attached()` throws, the primitive is not attached and the error propagates.

The demo's off-hours shading (`apps/demo/src/off-hours.ts`) is a complete example. The built-in [watermark](./watermark) (`packages/core/src/watermark.ts`) is a larger one, with options, redraw requests and image loading.

## Members

| Member | Notes |
| --- | --- |
| `layer` | `'below'` (under all series, including the GPU-drawn ones), `'normal'` (default, with the 2D series) or `'top'` (above drawings and price lines) |
| `attached(host)` / `detached()` | Lifecycle. `host` has `pane`, `series`, `requestRedraw()` and `requestOverlayRedraw()` |
| `drawPlot(ctx, env)` | Draw in the pane's plot area; clipped to it |
| `drawPriceAxis(ctx, env)` | Draw in the pane's price-axis area; `env.width` is the axis width |
| `drawTimeAxis(ctx, env)` | Draw in the time-axis area |
| `lane()` | `{ side, width }` to reserve a lane between the plot and the price axis, or null for none (see [Lanes](#lanes)) |
| `drawLane(ctx, env)` | Draw in the reserved lane; clipped to it, `env.width` is the lane width |
| `priceAxisLabels(env)` | `{ price, text, color, textColor? }[]` drawn like last-value labels |
| `priceRange(from, to)` | `[min, max]` to keep in view for visible indices `from`…`to` |
| `hitTest(p, env)` | `{ cursor?, part? }` when pane-local point `p` is on the primitive; the cursor is shown on hover |

`chart.primitiveAt(point)` returns the topmost primitive hit at a point in plot-relative css px (x from the plot's left edge, which left price axes move right) and what it reported. Like drawing and autoscale, hit testing and the hover cursor skip primitives attached to a hidden series.

## Coordinates

`env` is area-local css px: `width`, `height`, `pixelRatio`, `theme`, the visible index range `from` / `to`, `barSpacing`, `times` (bar times of the main series), `indexToX`, `xToIndex`, `timeToX`, `priceToY`, `yToPrice` and `formatPrice`. Price mapping uses the scale of the series the primitive is attached to (its overlay scale if it has one), otherwise the pane's, in every scale mode.

## Redrawing

The chart draws primitives whenever it redraws, which happens on data changes, panning, zooming and resizing. Call `host.requestRedraw()` when the primitive's own state changes. Nothing runs while the chart is idle.

`host.requestOverlayRedraw()` redraws only the overlay layer, which is cheaper. Use it for frequent changes that only affect what a primitive draws on the `'normal'` or `'top'` layer, on the axes or in a lane. Use `requestRedraw()` when the change affects the price range, the `'below'` layer or the lane width.

## Lanes

A primitive can reserve space between the plot and a price axis by returning `{ side: 'left' | 'right', width }` from `lane()`, and draw there in `drawLane(ctx, env)`. The plot narrows by the lane width, and the axis keeps its place and its width. A primitive that returns null, or is attached to a hidden series, takes no width. Lanes of one pane and side sit side by side in attach order, with the first next to the plot. The space on each side is the widest stack of lanes over all panes, so the plot edge lines up across panes.

The chart reads `lane()` on every full redraw. After the answer changes, call `requestRedraw()`. Pointer input over a lane does nothing, like an empty axis column. The [depth lane](./depth-lane) is built this way.

Lanes are laid out by the `depthLane()` plugin, so a chart that never shows one leaves the layout code out. Create the chart with `depthLane()` (or `builtins()`) in its `plugins`, or call `chart.install(depthLane())`; the UI shell includes it by default. Without it, no primitive gets lane space: `lane()` and `drawLane()` are not called, and development builds warn once when such a primitive is attached ([`lanes-missing`](./errors#lanes-missing)). Installing the plugin later lays out the lanes already attached.

## Crisp lines

`crisp(value, lineWidth, pixelRatio)` returns a coordinate on whole device pixels, and `crispLine(ctx, x0, y0, x1, y1, lineWidth, pixelRatio)` strokes a horizontal or vertical line with it, so thin lines stay sharp at any pixel ratio.

Primitives attached to a series are detached when the series or its pane is removed, and `chart.destroy()` detaches every primitive (calling `detached()`) before tearing the chart down; `requestRedraw()` does nothing after that.

## Errors

A member that throws (other than `attached`) does not break the chart. The call counts as returning nothing, everything else keeps drawing, and the first failure of each primitive is reported as a `chart:error` with code [`primitive-failed`](./errors#primitive-failed). A throwing `detached()` does not stop the other primitives from detaching, or `destroy()` from finishing.
