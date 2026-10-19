---
description: "Keep the crosshair, visible range, symbol, interval, timezone and drawings of several charts in step with a link group."
---

# Link charts

A link group keeps several charts in step: move the crosshair, pan or zoom on one and the others follow. It works with any charts on the page, in whatever layout the app gives them; the UI package's [chart grid](./chart-grid) links its charts this way.

```ts
import { createChart, createLinkGroup } from '@chart-on/core';

const left = createChart(leftHost);
const right = createChart(rightHost);
const group = createLinkGroup([left, right]);

// Later: change what is linked, add or remove charts.
group.applyOptions({ symbol: true });
group.add(third);
group.remove(right);
group.destroy();
```

## What is linked

| Option | Default | What follows |
| --- | --- | --- |
| `crosshair` | `true` | The crosshair's time, drawn as a vertical line on the other charts (see [`setCrosshairAt`](./events#sync-the-crosshair-of-two-charts)) |
| `visibleRange` | `true` | Pan and zoom: every chart shows the same time span |
| `symbol` | `false` | `setSymbol` on one chart loads that symbol on every chart with a data source, each at its own interval |
| `interval` | `false` | A new interval on one chart loads it on the others, each keeping its own symbol |
| `timezone` | `true` | The `timezone` option |
| `drawings` | `false` | Drawings on the main pane, on charts showing the same symbol (see [below](#draw-on-all-linked-charts)) |

Turn both `symbol` and `interval` on to show exactly the same thing everywhere, or only `interval` to watch several symbols at one interval. The current links are in `group.options`, and the defaults in `defaultLinkGroupOptions`.

## Joining a group

A chart that joins a group takes the linked state of the group's first chart: its visible range, symbol, interval and timezone, as far as each is linked. The same happens when a link is switched on with `applyOptions`. A chart that has no bars yet takes the group's range once its first bars arrive, instead of moving the others to its own.

## How charts follow

- **Ranges map by time,** so charts with different intervals or trading hours still line up: an hour on a one-minute chart is twelve bars on a five-minute chart. A chart that cannot show the whole span (too few bars, or its zoom limits) shows what it can and does not push its clamped range back.
- **A followed range moves the chart like a pan:** no animation, and its price scale keeps its autoscale setting and any range the user set. When the chart being followed animates (a kinetic scroll, `scrollToRealtime`), the others follow it frame by frame.
- **No feedback loops:** each link compares the new state with what a chart already shows, and only a real change on one chart is passed on. A chart can be in more than one group.
- **Load failures** of a followed symbol or interval reach the app through that chart's own `data:error` event.
- **Destroyed charts** leave the group by themselves. `remove` and `destroy` leave the charts as they are, except the mirrored crosshair, which is cleared.

## Draw on all linked charts

With `drawings: true`, a drawing made on one chart appears on every other chart in the group that shows the same symbol, at the same times and prices, whatever its interval. Moving, restyling, locking, hiding or removing it, on any of the charts, changes every copy; undo and redo on one chart are passed on like any other change.

```ts
const group = createLinkGroup([daily, hourly], { symbol: true, drawings: true });
```

- **Same symbol only:** a chart showing another symbol keeps its own drawings. Charts without a data source count as one symbol.
- **Main pane only:** drawings on indicator panes stay where they are, since the other charts may have different panes.
- **Copies keep the drawing's id,** so the app can find a drawing on each chart. Each chart records the change in its own undo history.
- **Only finished changes** are passed on: a drag shows on the other charts when it ends. Selection is not linked, and neither are bring to front, send to back and the other reorders within a layer; `zIndex` is.
- **Existing drawings are not copied** when the link is switched on, a chart joins or `drawings.load()` runs; a drawing missing on a chart is added there the next time it changes. Drawings with `persist: false` (the app's own) stay on their chart, and so do drawings of a tool another chart has not registered.

## Performance

Each chart still draws in its own frame loop; a follower draws once in the frame after the chart it follows. Linked charts count against the page's GPU context budget like any others; for many charts, [share one context](./embedding#one-context-for-many-charts).
