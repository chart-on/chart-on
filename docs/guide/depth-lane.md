---
description: "Show an order book beside the price axis: one bar per price level for bid and ask sizes your app supplies, with an optional ladder panel."
---

# Depth lane

A depth lane shows an order book beside the price axis: one horizontal bar per price level, as long as the size resting there, lined up with the candles' prices. Bids and asks get their own colours, and the best bid and ask stand out.

The chart ships no exchange connections. Your app reads the book from whatever feed it uses and hands the levels to the lane.

Depth lanes are [opt-in](./features#opt-in-features): create the chart with the `depthLane()` plugin (or `builtins()`), or call `chart.install(depthLane())` later. Without it, `chart.addDepthLane` throws a [`not-registered`](./errors#not-registered) `ChartError`. The UI shell includes it unless you pick the chart's plugins yourself.

```ts
import { createChart, depthLane } from '@charton/core';

const chart = createChart(el, { plugins: [depthLane()] });
const lane = chart.addDepthLane({ side: 'right', width: 80 });

// A full snapshot: every level of both sides.
lane.setLevels({
  bids: [{ price: 99.5, size: 120 }, { price: 99.4, size: 80 }],
  asks: [{ price: 99.6, size: 95 }, { price: 99.7, size: 200 }],
});

// Then changes as they arrive: size 0 removes a level, any other size sets it.
lane.update({ bids: [{ price: 99.5, size: 0 }], asks: [{ price: 99.6, size: 110 }] });
```

The lane sits between the plot and the price axis. The plot narrows to make room, so the axis keeps its place and its width, and the price range stays the same. A hidden lane takes no width.

## Options

`chart.addDepthLane(options)` takes these, plus `pane` (an index or a pane object; the main pane by default). `lane.applyOptions(patch)` changes them later.

| Option | Default | Notes |
| --- | --- | --- |
| `visible` | `true` | A hidden lane takes no width |
| `side` | `'right'` | Which price axis the lane sits beside |
| `width` | `80` | Lane width in css px |
| `maxLevels` | `200` | Levels shown per side, nearest the best price first |
| `labels` | `false` | Write each bar's size where rows leave room for text |
| `highlightBest` | `true` | Draw the best bid and ask in the solid `bid` and `ask` theme colours |
| `bidColor`, `askColor` | `null` | Bar colours; default to the `depthBid` and `depthAsk` theme tokens |
| `repaintInterval` | `100` | Least time between repaints caused by level changes, in ms |

## Levels

Each level is `{ price, size }`. Levels with a size of 0 or below, or a price or size that isn't a finite number, are left out. The lane keeps every level you send and shows the `maxLevels` nearest the spread on each side.

| Member | Notes |
| --- | --- |
| `setLevels({ bids, asks })` | Replace every level. A side left out is emptied |
| `update({ bids?, asks? })` | Change single levels: size 0 removes one, any other size sets it |
| `clear()` | Remove every level |
| `levels` | The shown levels: bids from the highest price down, asks from the lowest up |
| `bestBid`, `bestAsk` | The first shown level of each side, or null |
| `on('levels:change', listener)` | Fires after every change with the shown levels; returns an unsubscribe function |
| `remove()` | Detach the lane; the plot takes its width back |

## Drawing

Bars grow from the axis side toward the plot. Each one is scaled to the largest size in view, so the longest visible bar fills the lane. A bar is as thick as the gap to its neighbouring level allows, up to 14 px. Rows follow the price scale in every mode (log, percent, inverted), and rows outside the pane are skipped.

Level changes repaint only the overlay layer, at most once per `repaintInterval`, however often your feed calls `update`. Ten updates a second of 200 levels a side cost well under a millisecond each.

## Colours

The bars use the `depthBid` and `depthAsk` theme tokens (CSS `--pc-depth-bid` and `--pc-depth-ask`, see [Theming](./theming)). The dark, light and high-contrast themes set translucent versions of their bid and ask colours, so the candles' grid still shows through. The colour-safe palette changes `depthAsk` along with `ask`.

## Ladder panel

`@charton/ui` has a panel that lists the same levels as a price ladder, asks above bids. It reads only the lane's public handle, so it works with any lane:

```ts
import { createDepthLadder } from '@charton/ui';

const ladder = createDepthLadder(panelElement, lane, {
  depth: 10,                               // levels per side
  formatPrice: (p) => chart.formatPrice(0, p),
});
ladder.el.hidden = true; // it skips updates while hidden
ladder.destroy();
```

The panel isn't positioned, so place it with your own layout. It updates at most once per animation frame.

## Writing your own lane

The depth lane is an ordinary [primitive](./primitives#lanes). Any primitive can reserve a lane with `lane()` and draw in it with `drawLane()`.
