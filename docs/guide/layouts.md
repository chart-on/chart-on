---
description: "Save what the user arranged as plain JSON and load it back on the same or another chart."
---

# Save and restore layouts

A layout is what the user arranged on a chart, as plain JSON: the symbol and interval, the chart type, the panes with their heights and price scales, the indicators and where they sit, and the drawings. Bars are never part of it. Store it wherever you like and load it back later or on another chart.

Saving and loading come with the `layouts()` [plugin](./features#opt-in-features). `builtins()` includes it and the [UI shell](./ui-shell) adds it; a chart without it throws a [`not-registered`](./errors#not-registered) error from `serializeLayout` and `loadLayout`.

```ts
import { createChart, layouts } from '@chart-on/core';

const chart = createChart(el, { plugins: [layouts()] });

const layout = chart.serializeLayout();
localStorage.setItem('my-app:layout', JSON.stringify(layout));

// later
const saved = JSON.parse(localStorage.getItem('my-app:layout') ?? 'null');
if (saved) {
  const { errors, ready } = chart.loadLayout(saved);
  if (errors.length) console.warn('Parts of the layout were skipped', errors);
  await ready; // the saved symbol has loaded (null when nothing was loaded)
}
```

To save after every change, keep several layouts, or store them on your server, see [Storage and autosave](./storage).

## What a layout holds

```ts
interface ChartLayout {
  version: 1;
  meta?: { name?: string; createdAt?: number; updatedAt?: number };
  symbol?: string;       // symbol id from the data source, not its display name
  interval?: string;     // e.g. '15m'
  mainSeries?: {...};    // chart type (`style`), colours, wicks, borders, line width...
  panes?: {
    height: number;      // weight, as getPaneHeights() reports it
    collapsed?: boolean;
    scales: Record<string, PriceScaleSettings & { range?: { min, max } }>; // see getPriceScaleOptions
  }[];
  maximizedPane?: number;
  indicators?: IndicatorState[];   // chart.indicators.serialize(); `pane` indexes `panes`
  drawings?: SerializedDrawings;   // chart.drawings.serialize(); only on a chart with drawings
  toolDefaults?: Record<string, DrawingStyle>; // chart.drawings.serializeToolDefaults(), saved even with drawings: false
  visibleRange?: { from: number; to: number };
}
```

Each price scale saves what `getPriceScaleOptions` reports (side, mode, invert, autoscale, margins, fixed range, price-to-bar ratio lock). A scale with autoscale off also saves the price `range` it showed (`getPriceRange`), so a manually scaled pane comes back the same.

## Options when saving

```ts
chart.serializeLayout({
  drawings: false,       // leave drawings out, e.g. when you keep them per symbol
  visibleRange: true,    // include the visible time range (off by default)
  meta: { name: 'Swing setup', createdAt },
});
```

`meta` is yours: any fields are kept. `updatedAt` is set to the time of saving (unix seconds) unless you pass one, and `createdAt` defaults to it.

Indicators and drawings your app adds itself, rather than the user, can stay out of saved state: add them with `persist: false`.

```ts
chart.indicators.add('sma', { length: 200 }, { persist: false });
chart.drawings.add({ type: 'hline', pane: 0, points: [...], persist: false });
```

A layout that has indicators or drawings replaces all of them, these included, so add them after loading the layout.

## Loading

`loadLayout` is tolerant. It throws, changing nothing, only when the payload is not a layout at all (not an object with a `version`) or has a version nothing can upgrade (see below). Otherwise:

- **Missing parts stay as they are.** A layout without `drawings` leaves the chart's drawings alone, one with only `mainSeries` only changes the chart type.
- **Invalid parts are skipped** and listed in `errors` as `{ part, reason }`, for example `{ part: 'panes[1].scales.right.mode', reason: '...' }`. Everything else loads. Invalid indicator inputs take their defaults (the indicator stays), as with [`indicators.load`](./indicators#saving-and-restoring).
- **Unknown top-level fields** are listed in `unknown` and kept: the next `serializeLayout()` writes them back, so a layout saved by a newer version of your app survives a round trip through an older one.
- `meta` is returned as saved.

### Panes

Indicators go back to the pane they were saved in, in the saved pane order, with the saved heights, collapsed state, maximized pane and price scale settings. Saved panes that hold no indicators are matched, in order, with panes your app created itself, such as a volume pane added before loading. Panes the chart has that the layout doesn't mention stay, after the restored ones. Drawings follow their panes; a drawing whose pane cannot be restored is dropped and reported.

An indicator whose definition isn't registered yet is kept as a pending placeholder and draws nothing; when it is registered later it opens in a new pane like a newly added one.

A chart without the [opt-in](./features#opt-in-features) `indicators()` plugin keeps a layout's valid `indicators`, and an empty pane at each saved indicator pane, so the order and heights survive. It reports them in `errors` (an empty list passes quietly; invalid entries are reported as on any chart), and writes them back with its next save; installing `indicators()` later loads them into those panes. Parts kept for a missing plugin (`indicators`, `drawings`, `toolDefaults`) are not listed in `unknown`. Drawings work the same way without a drawings plugin. Compared symbols are not part of a layout.

### Symbol and visible range

With a data source set, a saved `symbol` (and `interval`, or the current one) loads through `setSymbol`, and `ready` settles once it has loaded and the saved view is applied. It rejects when loading fails, which `data:error` also reports. Pass `{ symbol: false }` to load the symbol yourself; read it from the layout.

The saved `visibleRange` is applied to the bars on the chart, or once the symbol loads. When you push bars with `setData` yourself, load the layout after the bars.

## Versions and migration

`serializeLayout` writes `version: LAYOUT_VERSION` (currently `1`). When the format changes, `loadLayout` upgrades older layouts step by step. For anything else, such as your app's own earlier format, pass a `migrate` hook. It gets the raw payload and its `version`, and returns a layout of the current version (or an older one the built-in steps continue from). It runs at most once per load.

```ts
chart.loadLayout(saved, {
  migrate: (data, fromVersion) =>
    fromVersion === undefined ? { version: 1, mainSeries: { style: data.chartType } } : data,
});
```

`migrateLayout(data, current?, steps?, hook?)` is exported for upgrading stored layouts without a chart, e.g. in a storage migration.

The drawings and indicators inside a layout carry their own versions and upgrade on their own: see [drawing migrations](./drawings#versions-and-migration) and [indicator versioning](./indicators#versioning).
