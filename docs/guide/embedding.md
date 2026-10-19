---
description: "Put the chart in a page: container size, lifecycle, resizing, several charts, keyboard focus, pixel ratio and memory."
---

# Embedding the chart

How the core chart fits into a page without a framework. The [UI shell](./ui-shell) and framework wrappers build on the same rules; [Frameworks and plain pages](./frameworks) covers the script-tag build, server rendering and the contract wrappers follow.

## The container

`createChart(el)` adds one element, `chart.root`, inside `el`. It fills `el` (`width: 100%; height: 100%`) and holds the canvases and overlays. `el` must have a size of its own:

```html
<div id="chart" style="height: 480px"></div>
```

- A percentage height needs every ancestor up to a sized one to have a height too (`html, body { height: 100% }` and so on), or it resolves to 0.
- A flex or grid child needs `min-width: 0` and `min-height: 0`, or the canvases keep it from shrinking.
- At 0 × 0 (`display: none`, a collapsed panel, a hidden tab) the chart draws nothing and keeps its state. It draws again as soon as the container has a size.

The chart leaves `el` itself alone, apart from appending `chart.root`, so you can style and position `el` as you like.

`chart.root` carries the class `pc-chart`. Its size, background, `touch-action`, `user-select` and focus outline come from a `:where(.pc-chart)` rule the chart adds to the page (to the shadow root, when the container is in one), not from inline styles. That rule has no specificity, so any rule of yours that targets the root wins, without `!important`:

```css
#chart .pc-chart {
  background: transparent; /* let the page show through before the first frame */
}
```

Only `position: relative` and `overflow: hidden` stay inline, since the canvases are laid out against them. `touch-action` follows the chart's touch options (it lets vertical swipes scroll the page when touch panning is off); override it only if you handle touch yourself. Browsers that cannot add the rule (no constructed stylesheets), and containers in another document than the one the library loaded in (an iframe or a popup window), get the same styles inline. A container that is not yet in the page when the chart is created gets the rule on the page's document, so create the chart after attaching a container that lives in a shadow root.

## Lifecycle

```ts
import { createChart, createMockDataSource, dataSource } from '@chart-on/core';

const el = document.getElementById('chart')!;
// 1. Create: options can be set now or later. `dataSource()` lets it load through a source.
const chart = createChart(el, { timezone: 'UTC', plugins: [dataSource()] });

// 2. Data: push bars yourself (`addCandles().setData(...)`), or attach a data source.
chart.setDataSource(createMockDataSource());
await chart.setSymbol('DEMO', '1h');

// 3. Change options at any time; only the fields you pass change.
chart.applyOptions({ crosshair: { mode: 'free' } });

// 4. Destroy when the element goes away.
chart.destroy();
```

`destroy()` stops the frame loop, timers, observers and the data source subscription, releases the WebGL context and removes `chart.root`. Call it once, before or after removing `el`; it is safe to call twice. Afterwards the chart draws nothing and calls that load data reject (see [failure modes](./getting-started#requirements-and-failure-modes)).

## Resizing

A `ResizeObserver` on `chart.root` resizes the canvases and redraws in the same frame, so the chart follows its container through window resizes, layout changes and panels opening. It also follows changes of the device pixel ratio (moving to another screen, browser zoom).

Call `chart.resize()` yourself only for changes the observer cannot see:

- a CSS `transform: scale(...)` on an ancestor (the layout size does not change);
- printing, if your print styles give the container another size.

`resize()` measures and draws at once, so it is cheap to call when unsure. To keep the same time range on screen when the width changes, instead of the same bar spacing, set `lockVisibleRangeOnResize: true` (see [view and scale](./view-and-scale#resizing-and-new-bars)).

## Several charts on one page

Each chart is independent: its own canvases, WebGL context, data and options. Create as many as you need and destroy each one. To keep their crosshair, view, symbol or interval in step, put them in a [link group](./link-groups).

```ts
import { createChart, createMockDataSource, dataSource } from '@chart-on/core';

const source = createMockDataSource();
const charts = (['1h', '4h', '1d'] as const).map((interval, i) => {
  const chart = createChart(document.getElementById(`chart-${i}`)!, { plugins: [dataSource()] });
  chart.setDataSource(source);
  void chart.setSymbol('DEMO', interval);
  return chart;
});

// Later:
for (const chart of charts) chart.destroy();
```

- A chart scrolled out of view (seen through an `IntersectionObserver`), or on a page in a background tab (`document.visibilityState`), draws nothing. Its data, indicators and view keep updating and its events (`view:change`, history requests) keep firing; when it is shown again it draws once, before the browser paints, with any animation at its end rather than replayed. So a page with many streaming charts spends drawing time only on the ones in view. `captureImage()` and `resize()` still draw a hidden chart. Set `renderWhenHidden: true` to keep drawing anyway, e.g. for a host that captures the canvases of hidden charts itself. Where `IntersectionObserver` is missing the chart counts as in view.
- Browsers limit the number of live WebGL contexts per page (commonly 16 on desktop and 8 on mobile) and take the oldest away past that; the chart then emits `context:lost`. Destroy charts you no longer show rather than hiding them. For more charts than that, use a shared context (below), or static charts (`interactive: false`) for thumbnails.

### One context for many charts

`createChart(el, { gl: 'shared' })` draws through one WebGL context shared by every chart created that way, so a dashboard or a multi-chart layout can hold any number of interactive charts:

```ts
import { createChart, sharedContext } from '@chart-on/core';

const charts = cells.map((cell) => createChart(cell, { gl: 'shared', plugins: [sharedContext()] }));
```

- The shared context comes with the [opt-in](./features#opt-in-features) `sharedContext()` plugin, which `builtins()` includes and `createChartGrid` adds to each cell. It is read when the chart is created, so pass it in `plugins` then. Without it a `gl: 'shared'` chart gets its own context (`chart.options.gl` reads `'own'`), and development builds warn once ([`shared-context-missing`](./errors#shared-context-missing)).

- Each chart draws its series into a hidden shared canvas, then copies its part into its own canvas in the same frame. The copy costs little: eight charts panning together took about 1.1 ms per frame shared against 0.9 ms with their own contexts in our measurements.
- The shared context is made by the first shared chart and released with the last one. It counts as one context in the [context budget](./performance), and stays while any shared chart is in view or used.
- A lost context is restored for every shared chart: each emits `context:lost` and `context:restored`. Destroying one chart frees only its own GPU objects.
- `gpuMemory()` reports the whole shared context, not one chart's part.
- `gl` is fixed at creation; the default is `'own'`, one context per chart.
- Keyboard shortcuts go to the chart that has focus by default, so charts do not fight over keys (see below).
- A data source can be shared; each chart loads and caches its own bars.

## Keyboard and focus

`chart.root` is focusable (`tabIndex = 0`), so it takes part in the page's Tab order, and clicking the chart focuses it. With the default `keyboard: { scope: 'focus' }` the chart handles its [shortcuts](./interaction#keyboard) (arrows and `PageUp` / `PageDown` to pan, `+` and `-` to zoom, `Escape`, `Delete`, copy, paste, undo and redo for drawings) only while it has focus.

| You want | Set |
| --- | --- |
| No keyboard shortcuts at all | `features: { keyboard: false }`. The chart stays in the Tab order |
| The chart out of the Tab order (a static or decorative chart) | `focusable: false`. A click still focuses it, so its shortcuts still work once clicked |
| Shortcuts also while the pointer is over the chart, without a click | `keyboard: { scope: 'hover' }` |
| Shortcuts anywhere on the page (one chart per page). Drawing keys still need the chart focused or hovered | `keyboard: { scope: 'global' }` |

Keys typed into inputs, text areas, selects and editable elements, or used inside dialogs and other interactive widgets, never reach the chart.

## Pixel ratio

The 2D layers (axes, labels, crosshair, drawings) render at the full device pixel ratio. The WebGL layer is capped at `maxGlDpr` (default 2): on a 3× screen it renders 2× and is scaled up, which fills 4 instead of 9 device pixels per css pixel, with no visible change for candles and lines. Lower it to 1 on weak GPUs with large charts; raise it for pixel-exact heatmap cells on very dense screens. It can be changed with `applyOptions` at any time.

## Memory

- A data source keeps the bars of the last `cacheSize` symbol and interval combinations (default 8), so switching back is instant. Lower it with `setDataSource(source, { cacheSize: 2 })` for long histories, or drop entries with `chart.data?.clearCache(symbol?, interval?)`.
- Each series keeps a copy of the data you pass to `setData`, plus its GPU form.
- A heatmap's grid is capped by its `memoryBudget` (default 256 MiB).
- `destroy()` releases everything above; a chart that is only hidden keeps it.

## Production checklist

- The container has a size before or right after `createChart`, and the chart is destroyed when the container goes away (route changes, closed panels, removed dashboard tiles).
- Check `isWebGL2Supported()` first, or catch the `ChartError` from `createChart`, and show your own fallback (see [failure modes](./getting-started#requirements-and-failure-modes)).
- Listen for `data:error` and `context:restore-failed` to show a message instead of a blank chart.
- Fewer live charts than the browser's WebGL context limit; destroy rather than hide.
- `focusable: false` for charts that are not meant to be used with the keyboard, so Tab does not stop on them.
- Pass a `timezone` if your users should see exchange time rather than their own.
- On a page with a content security policy or Trusted Types, allow the directives in [Security and strict pages](./security); the chart needs no `unsafe-eval`, no `unsafe-inline` and no network access of its own.
