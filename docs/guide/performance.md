---
description: "Why the chart stays smooth, tips for live data, and the limits to know about."
---

# Performance and limits

## Why it stays smooth

- Candles, histograms and heatmaps upload to the GPU once (instanced rects, float heatmap texture). Pan and zoom only change two uniforms per axis.
- Only visible bars are drawn.
- Prices are stored relative to a per-series base to keep float32 precision.
- A large load does not upload in one long task. Each animation frame spends at most 2 MB on GPU uploads, shared by all series and by every chart on a shared context (`gl: 'shared'`). Data that does not fit (a `setData` of tens of thousands of bars or more, or many series loading at once) uploads the bars on screen at once and follows in pieces over the next frames, nearest the view first. With 1M candles (69 MB) this took the longest frame from about 20 ms to about 3 ms on a desktop machine, spread over about 35 frames. A hidden or out-of-view chart continues when it is shown again, and its waiting data never keeps other charts drawing.
- Bars on screen are never missing, so a frame always uploads the bars it shows, even past the 2 MB. Panning onto bars that have not arrived yet uploads them in that frame. Without `grouping` at most `plotWidth / minBarSpacing` bars are on screen (2,560 for a 1280 px plot at the default 0.5 px): about 180 KB of candles. Only an app that lowers `minBarSpacing` far enough to show a large load in full sends it in one frame. With `grouping` the chart draws buckets instead of bars, a few per pixel column at most, so the same bound holds when zoomed out.
- Log scale is applied in the shaders, so switching scale modes does not re-upload data.
- Crosshair and drawing moves repaint only the 2D overlay. Scene repaints coalesce into one `requestAnimationFrame`.
- Charts scrolled out of view or in a hidden tab request no frames; they stay current and draw once when shown (`renderWhenHidden` turns this off, see [embedding](./embedding#several-charts-on-one-page)).
- Lines, line-drawn candle styles and indicator lines upload once, like candles; with `renderer: 'canvas'` they decimate to first/min/max/last per pixel column instead (see [GPU lines](./series#gpu-lines) and [indicators](./indicators#drawing-on-the-gpu)).
- The visible-range volume profile only bins the bars on screen and recomputes at most every `throttleMs`. Session profiles are built once, and live bars redo only the last session.
- The WebGL layer caps device pixel ratio (`maxGlDpr`, default `2`) to limit fill-rate on hi-dpi screens.
- Autoscale eases toward its target, the forming bar tweens between ticks, and view changes animate. All of it respects `prefers-reduced-motion` and can be turned off (`smoothScale`, `animateViewChanges`, series `animate`), or all at once with [`lowPower`](#low-power-mode).

## Tips

- Use `update()` for live data, not `setData()`. Replacing the forming bar touches a single GPU slot. Appending a newer bar is O(1) for candle, histogram, line and custom series and for indicators that define `update`: the time axis grows by one bar, each of those series aligns only its new items, and only the new instances upload to the GPU. Heatmap series still rerun their rebuild on each appended bar (send columns with `updateColumn()`), and indicators without `update` rerun `compute` over every bar. `setData()`, option and theme changes and symbol switches rebuild everything in O(n).
- History pages from a data source cost about the size of the page, not of everything loaded: the time axis grows at the front, candle, histogram, line and custom series align and write only the new bars, and only their GPU instances upload. Moving the existing bars along their arrays is the only work that grows with the history. Heikin Ashi main series, heatmaps and volume profiles still rebuild, and indicators recompute over every bar.
- Send a heatmap column with `updateColumn()` instead of rebuilding the grid.
- Hide series with `setVisible(false)` rather than removing and re-adding them.

## Low-power mode

On laptops without a dedicated GPU, or on battery, turn on `lowPower`. It can be switched at any time with `applyOptions`:

- Decorative animations stop: the forming-bar tween, eased wheel zoom, price-scale easing, eased view changes (scroll to the newest bar, fit, ranges, pane resizes) and the last-point pulse ring, which shows as a still dot. Momentum after a drag pan stays, since it follows the user's gesture.
- The WebGL layer renders at pixel ratio 1 at most (or `maxGlDpr` when lower). On a 2× screen that fills a quarter of the pixels. The 2D layers (axes, labels, drawings, crosshair) stay sharp.
- Heatmaps read one cell per pixel instead of combining every cell under it (`cellReduce` acts as `'nearest'`). At normal zoom, where a cell is wider than a pixel, the picture is the same; zoomed far out, thin levels may flicker as the view pans.
- While there is no pointer, wheel or keyboard input on the chart for a second, frames come at most 20 times a second, so a fast live feed redraws less often. Input lifts the cap at once.

The options themselves (`smoothScale`, `animateViewChanges`, `smoothZoom`, `maxGlDpr`, series `animate` and `cellReduce`) keep their values, so turning `lowPower` off restores everything. It is separate from `prefers-reduced-motion`: the chart follows that system setting as before whether `lowPower` is on or off, and the setting does not turn `lowPower` on.

To offer the switch, read `chart.frameTime` or listen for `frame:slow`:

```ts
chart.on('frame:slow', ({ frameTime }) => {
  showHint(`The chart draws a frame every ${frameTime.toFixed(0)} ms. Try low-power mode.`);
});
// later, when the user agrees
chart.applyOptions({ lowPower: true });
```

`chart.frameTime` is the smoothed time in ms between animation frames that ran back to back (during pans, zooms, easing or live updates), or `null` before any did. It comes from the timestamps the browser gives each frame, so it costs nothing and works with `renderStats` off. A frame that follows a rest, or one the idle cap held back, is not counted. `frame:slow` fires when that average stays above 35 ms (under about 29 frames a second) for 45 frames, so a 30 Hz screen does not trigger it. It fires once per slow spell and not while `lowPower` is on. To see what the switch saves on a given machine, compare `gpuTime` in the [render statistics](#debugging-and-profiling) with it off and on.

## Debugging and profiling

Turn on `renderStats` to measure every frame. Counting work is steadier than timing it, so benchmarks can assert on counts. While the option is off, frames make no timing calls and allocate nothing for statistics.

The statistics are [opt-in](./features#opt-in-features): create the chart with the `statsOverlay()` plugin (or `builtins()`), or call `chart.install(statsOverlay())` later. Without it the options measure nothing, and development builds warn once ([`stats-overlay-missing`](./errors#stats-overlay-missing)). `chart.gpuMemory()` and `chart.frameTime` need no plugin.

```ts
chart.applyOptions({ renderStats: true });
chart.on('frame:render', (stats) => {
  console.log(stats.kind, stats.drawCalls, stats.times.total.toFixed(2));
});

const last = chart.frameStats; // null while renderStats is off
const memory = chart.gpuMemory(); // works with renderStats off too
```

Each `RenderStats` snapshot has these fields:

| Field | Meaning |
| --- | --- |
| `kind` | `'scene'` when the frame redrew every layer, `'overlay'` when it redrew only the drawings, labels and crosshair (for example while hovering a drawing), `'cursor'` when it redrew only the crosshair layer (a crosshair move) |
| `drawCalls` | GPU draw calls issued |
| `instances` | Instances drawn, summed over draw calls; a heatmap draw counts as one |
| `bufferUploads`, `bufferBytes` | Instance buffer uploads (whole buffers and partial updates) and the bytes they sent. Updating the last candle sends one partial upload; a large load counts each piece in the frame that sent it |
| `textureUploads`, `textureBytes` | Heatmap texture uploads (whole textures, new columns and colour ramps) and the bytes they sent |
| `times.autoscale` | CPU milliseconds fitting price scales to the visible data |
| `times.drawBottom` | CPU milliseconds drawing the grid, axes and Canvas2D series under the GPU layer |
| `times.drawGL` | CPU milliseconds recording GPU draws. The GPU may finish the work later, so this is not GPU time |
| `times.drawTop` | CPU milliseconds drawing the drawings, labels and other overlay content |
| `times.drawCursor` | CPU milliseconds drawing the crosshair layer: the crosshair, its axis labels, series crosshair markers, and updating the legend |
| `times.total` | CPU milliseconds for the whole frame, including the phases above |
| `reasons` | What asked for the frame since the previous one (see below). Empty when nothing did, as for the first frame or a screenshot |
| `gpuTime` | GPU milliseconds spent on the GPU-rendered series, from the newest frame whose measurement has come back. The chart never waits for the GPU, so this is usually two or three frames old. `null` on a chart without the `statsOverlay()` plugin, when the browser lacks the disjoint timer query extension (common outside desktop browsers) or before the first result. Results spoilt by a GPU clock change are dropped. Charts on a shared context (`gl: 'shared'`) share one measurement |
| `memory` | GPU memory held after the frame, as `chart.gpuMemory()` reports it |

`reasons` lists each kind of request once, in this order:

| Reason | Asked by |
| --- | --- |
| `'host'` | The app, through `chart.invalidate()` or `chart.invalidateOverlay()` |
| `'series'` | Series data or options, indicators, adding or removing a series |
| `'view'` | Panning, zooming, scrolling and price-scale changes, from input or the API |
| `'layout'` | A resize, panes added, removed, moved or resized, or a restored GPU context |
| `'options'` | Chart options, the legend, the status line, and listeners for events that change what is drawn |
| `'animation'` | Easing, inertia, series animations and the bar-close countdown |
| `'crosshair'` | The crosshair or the "+" button moving |
| `'drawings'`, `'annotations'`, `'primitives'` | Those layers; reference lines count as annotations |

### On-chart overlay

`renderStatsOverlay: true` shows the numbers on the chart, in a small panel in the bottom-left corner of the lowest pane, drawn in the theme's label colours: a sparkline of the last 60 frame times (bars over a 60 Hz frame use the theme's down colour, and a line marks 16.7 ms), then the last frame's kind, CPU and GPU time, draw calls, instances, uploads, GPU memory and reasons. `renderStatsOverlay: 'bounds'` also outlines the panes (solid) and the axis columns, lanes and time axis (dashed), and shades where the pointer would grab each drawing in the theme's drawing colour. The shading samples each tool's own hit test, plus the anchors and handles of selected drawings, on a 4 px grid, so it shows the regions the pointer actually uses; overlapping drawings shade darker. Sampling costs one hit test per cell per visible drawing, so it reruns only when a frame redraws the scene or overlay, and crosshair-only frames reuse it. The overlay measures frames while it is on, as `renderStats` does, and switches on and off at runtime. It draws after each frame's statistics are taken, so it never counts itself, and it is left out of screenshots.

The panel comes with the same `statsOverlay()` plugin; without it the option draws nothing.

```ts
import { createChart, statsOverlay } from '@charton/core';

const chart = createChart(el, { plugins: [statsOverlay()] });
chart.applyOptions({ renderStatsOverlay: 'bounds' });
```

`chart.gpuMemory()` returns bytes the series hold on the GPU: `buffers` (instance buffers at their allocated capacity), `textures` (heatmap value textures at their allocated capacity, plus colour ramps) and `total`. Shared shader programs are not counted. Removing a series frees its share. After a lost GPU context is restored, the counts restart from zero and grow again as series redraw.

## Limits

- WebGL2 is required.
- Each chart holds one WebGL context, unless created with `gl: 'shared'`, where all such charts share one (see [embedding](./embedding#one-context-for-many-charts)). Charts share a page budget of contexts (12, or 6 with a coarse pointer, see `setContextBudget`); past it, charts out of view give theirs up until they scroll back. See [failure modes](./getting-started#requirements-and-failure-modes).
- For many small charts (thumbnails, sparklines, dashboard tiles) create them with `interactive: false`. A static chart takes no input (pointer, wheel, touch, keyboard), shows no crosshair, does not animate, and holds a WebGL context only while it draws: once a drawing settles it copies the GPU layer into a 2D canvas and gives the context back, so it does not count against the budget. New data, options or a new size take a context back for one more drawing (`context:lost` and `context:restored` fire with `reason: 'budget'` each time); when more static charts want to draw than the budget allows, they take turns. Taking a context back costs far more than a frame of a chart that keeps one, so static charts suit data that changes now and then; for many small charts with live data, use a [shared context](./embedding#one-context-for-many-charts). `interactive` is set at creation. The demo's `sparklines.html` page shows 40 static charts next to an interactive one.
- Heatmap columns must line up with consecutive main-series bars.
- Heatmap rows are capped by the GPU max texture size (`chart.maxTextureSize`). Columns are also capped by `memoryBudget` (default 256 MiB) and `maxColumns`, so tall grids stay within memory on modest GPUs; extra columns drop the oldest. See [heatmap limits](./series#heatmap).
- Bars are never narrower than `minBarSpacing`, so at most `plotWidth / minBarSpacing` bars are on screen at once (a few thousand on a laptop). `fitContent()` and `setVisibleTimeRange()` return `false` when they had to show fewer bars than asked. To show more, turn on [grouping](./view-and-scale#group-bars-when-zoomed-out) with the `grouping()` plugin (any number of bars, drawn and autoscaled in time that follows the plot width rather than the bar count), or lower `minBarSpacing`.
