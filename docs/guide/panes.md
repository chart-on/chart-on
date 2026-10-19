---
description: "Stack panes that share the time axis, each with its own price scale, and size, move or collapse them."
---

# Panes

Panes stack vertically and share the time axis. Each has its own price scale.

<!-- example: panes -->

| Option | Default | Notes |
| --- | --- | --- |
| `stretch` | `0.25` | Relative height weight. The main pane starts at `1`. |
| `marginTop` | auto | Empty space above the data, as a fraction of pane height |
| `marginBottom` | auto | Empty space below the data |

Left out, a margin is sized every frame to fit what sits at that edge, by one rule for every pane: the highest high and lowest low never touch the pane edge or sit under the legend, and the price labels at the ends of the scale are not clipped. So the edge with the legend keeps the legend block's height (one row per series with a legend row, hidden series included, since the legend lists them), and the other edge keeps half a price label. The rows are counted, not measured, so the margins never wait for the browser's layout; a row that wraps in a narrow plot takes a second line the margin does not count. A scale centred on a price (`autoscaleRule.centerOn`) gets the larger of the two on both sides, so the price stays mid-pane. The data keeps at least half the pane: the legend's edge takes up to half of it and the other edge what is left. A legend taller than half the pane (many series in a short pane) therefore overlaps the top of the data; make the pane taller or fold the legend. A margin given here or with `setPriceScaleOptions` is kept as given, and `null` gives it back to the chart. `getPriceScaleOptions` and saved layouts leave automatic margins out, and a layout that leaves a margin out loads it as automatic.

Users can drag the separator between panes to resize them.

## Remove a pane

```ts
chart.removePane(volumePane); // also removes its series, indicators, drawings and primitives
```

The main pane (`chart.panes[0]`) cannot be removed.

## Manage panes

```ts
chart.movePane(rsiPane, 1);              // reorder; the main pane always stays first
chart.maximizePane(rsiPane);             // all the height to one pane; null restores
chart.setPaneCollapsed(cvdPane, true);   // shrink to a thin header with its legend
chart.setPaneHidden(cvdPane, true);      // hide; the others take its height; pane.hidden reads it
chart.moveSeries(line, 'above');         // or 'below', 'new', or a Pane
chart.getPaneHeights();                  // normalized weights, e.g. [0.7, 0.15, 0.15]
chart.setPaneHeights([3, 1, 1]);         // weights; restores a saved layout
```

`moveSeries` removes the pane it leaves when that pane ends up with no series and no drawings (never the main pane), and the main series cannot leave the main pane. Drawings keep their pane through reorders; a removed pane takes its drawings with it. [Primitives](./primitives) attached to a series move with it.

Hovering a pane shows small buttons for the same actions (move up or down, maximize, collapse, remove); turn them off with `paneButtons: false`. Double-clicking a pane's plot toggles the same maximize (unless a drawing handles the double-click, or the chart has one pane); turn that off with `paneDoubleClickMaximize: false`. Height changes ease unless the user prefers reduced motion.

`getPaneHeights` returns the panes' stretch weights normalized to sum to 1, not on-screen fractions: a collapsed or hidden pane (also one behind a maximized pane) keeps the weight it returns to. They round-trip through `setPaneHeights`.

A hidden pane keeps its series, indicators and drawings, so showing it again restores it as it was. The main pane cannot be hidden, a hidden pane cannot be maximized, and hiding the maximized pane restores the others. The `toggleVisibility` toolbar preset in `@chart-on/ui` accepts a pane.

Every change fires `panes:change` with `{ heights, maximized, collapsed, hidden }`, where `heights` are those same normalized weights. Together they are what a saved layout needs.
