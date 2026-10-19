---
description: "Install the packages, create a chart, load data, and the WebGL2 requirements and failure modes."
---

# Getting started

charton ships as eight packages:

| Package | Use it for |
| --- | --- |
| `@chart-on/core` | The chart engine. Canvases only, no UI chrome. Bring your own controls. |
| `@chart-on/ui` | Optional shell: top toolbar, drawing-tool rail and styles around a core chart. |
| `@chart-on/indicators` | Optional [built-in indicators](./indicators#built-in-indicators). |
| `@chart-on/ta` | Optional [technical-analysis helpers](./technical-analysis) for writing indicators. |
| `@chart-on/locales` | Optional [translations](./localization#locale-packs) of the built-in text, one entry per language, applied through the `localization()` plugin. |
| `@chart-on/react` | Optional [components and hooks](./component-wrapper) for apps built with a component-based UI framework. |
| `@chart-on/vue` | Optional [components and composables](./template-wrapper) for apps built with a template-based component framework. |
| `@chart-on/svelte` | Optional [components and an action](./compiled-wrapper) for apps built with a compiler-based component framework. |

## Install

The packages are not published to npm yet. Until the first release, build them from the [repository](https://github.com/chart-on/charton). Once they are published, install them with:

```bash
pnpm add @chart-on/core
# optional UI shell
pnpm add @chart-on/ui
```

Requires a browser with WebGL2. No bundler? Use the [script-tag build](./frameworks#with-a-script-tag).

## Core only

The container needs a size. The chart fills it and follows resizes automatically.

```html
<div id="chart" style="height: 480px"></div>
```

Every example in these docs is a module whose `mount(el)` draws into an element and returns a clean-up function; in your app, `el` is that `#chart` element. The chart below runs exactly the code under it. `sampleBars` makes up [sample data](https://github.com/chart-on/charton/blob/main/docs/examples/sample-data.ts) in the same shape as yours:

<!-- example: first-chart -->

## With the UI shell

The shell adds a small toolbar (interval, chart style, indicators, price scale, settings and fullscreen) and the drawing-tool rail by default; a bottom bar is opt-in (`bottomBar: true`). `theme` picks the `'dark'`, `'light'` or `'system'` scheme (default `'system'`). See [Shell, toolbar and rail](./ui-shell).

<!-- example: shell -->

## Live updates

```ts
candles.update({ time: 1767229200, open: 103, high: 106, low: 101, close: 105 }); // same time: replace
candles.update({ time: 1767232800, open: 105, high: 107, low: 104, close: 106 }); // newer: append
```

## Clean up

```ts
chart.destroy(); // or shell.destroy() when using the UI shell
```

`destroy()` is safe to call twice. Code that still holds the chart afterwards (a live `update`, a late data response) does no harm: nothing is drawn; view changes (`scrollToRealtime`, `fitContent`, `setVisibleTimeRange`, `resetView`), `applyOptions` and removing series do nothing; `chart.data` is `null`; `captureImage` resolves to `null`. Calls that load data fail loudly instead: `setSymbol` rejects and `compare` throws a `ChartError` with code `'destroyed'`, and a `setSymbol` still loading when the chart is destroyed rejects the same way.

## Requirements and failure modes

The chart draws its series with WebGL2, which every current desktop and mobile browser supports. There is no fallback renderer.

Supported browsers: Chrome and Edge 111+, Firefox 114+, Safari 16.4+ (macOS and iOS). WebGL2 alone needs less (Safari has it from 15), but the packages are compiled for this set, so older browsers fail on the JavaScript before they reach WebGL. The list is the `browserslist` field of each package's `package.json`, so tools that read it (autoprefixers, transpilers) pick it up. Node.js 22+ is needed only for tooling and tests, for example `@chart-on/core/testing`.

Check before creating a chart if you want to show your own message:

```ts
import { createChart, isWebGL2Supported, ChartError } from '@chart-on/core';

if (!isWebGL2Supported()) showMessage('This chart needs WebGL2.');

try {
  createChart(el);
} catch (error) {
  if (error instanceof ChartError) console.warn(error.code); // 'webgl2-unavailable' or 'webgl-shader'
}
```

- Without WebGL2, `createChart` throws a `ChartError` with code `'webgl2-unavailable'` and leaves the container untouched. A shader that fails to compile or link (usually a driver bug) throws code `'webgl-shader'`, also leaving the container untouched. `createChartShell` removes its markup and rethrows the same error, so wrap it the same way and render your own fallback.
- The browser can take the GPU context away, for example after a driver reset or when a page opens too many contexts. The chart emits `context:lost`. The frame loop keeps running: axes, labels, the crosshair and drawings keep drawing and responding, and only the GPU-drawn series are skipped, so they disappear until the browser restores the context. On `context:restored` the chart re-creates its GPU buffers and textures from the series data and redraws. Nothing you set is lost. Both events carry `reason`: `'browser'` here, `'budget'` when the chart gave the context up itself (next point).
- Browsers cap live WebGL contexts per page (commonly 16 on desktop and 8 on mobile) and drop the oldest past that, so a page with many charts would blank its first ones. Each chart holds one context, and the charts share a page budget: 12 contexts, or 6 with a coarse pointer. Past it, the chart that has been out of view the longest gives its context up (`context:lost` with `reason: 'budget'`), or the least recently used one when every chart is in view. It takes a context back, evicting another, when it scrolls into view or gets a pointer, wheel or focus event. Set the budget with `setContextBudget(n)`, read it with `getContextBudget()`; lowering it evicts at once. Leave room for other WebGL content on the page, such as maps or 3D views.
- If the restored context cannot be set up again, `context:restore-failed` fires with a `ChartError` (code `'webgl-restore-failed'`, the original error in `cause`) and the series stay blank. Destroy the chart and create a new one to recover.
- While the context is lost, `captureImage()` resolves to `null`; other methods keep working.

## Using the docs with coding assistants

Besides these pages, the docs site publishes plain-text copies that coding assistants read more reliably than HTML:

- `/llms.txt`: an index of every guide page, with its URL and a one-line description.
- `/llms-full.txt`: every guide page in one Markdown file, in sidebar order. Live examples appear as their source code.
- Each page as Markdown at the same path with `.md`, such as `/guide/series.md`. The link sits at the bottom of each page.

Point your assistant at the index, or at the full text when it can read a long file.

## Next

- [Embedding the chart](./embedding): container size, lifecycle, resizing, several charts, focus and memory.
- [Security and strict pages](./security): content security policy, Trusted Types and offline use.
- [Core concepts](./concepts): time, panes, the main series.
- [Series and data](./series): candles, lines, histograms, heatmaps.
- [Events](./events): crosshair, visible range, loading older history.
