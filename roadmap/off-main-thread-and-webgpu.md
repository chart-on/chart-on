# Off-main-thread rendering and a WebGPU backend

Investigation for #303: can the GPU layer move into a worker (`OffscreenCanvas`), and can a WebGPU backend sit next to WebGL2, without breaking the public API? This note records what the code does today, what a throwaway prototype measured, what each option would cost, and a recommendation.

**Recommendation in short**

- **Worker renderer: no-go for now.** The GPU layer is 3–7% of the main thread's frame time. Moving it into a worker saves about 0.05 ms per frame and adds a synchronisation problem between the GPU layer and the 2D layers. The only sizeable GPU cost on the main thread is the one-off upload after a large `setData` (55–67 ms for 1M candles), and that has a cheaper fix. Revisit only on the triggers listed under [Go/no-go](#go-no-go-criteria).
- **WebGPU backend: not now, but keep the door open.** It brings real wins (compute for the heatmap level pyramid and autoscale scans, one device for any number of canvases, a base-instance draw). It also costs a second shader set, a second test matrix and an async start-up. The preparation it needs, an internal backend interface in `gl/`, is small and useful on its own, so do that first.
- **Public API changes needed: none** for either option. Both would be additive and opt-in. One typing leak should be closed first: `Series.drawGL` is visible in the published types (see [Public API impact](#public-api-impact)).

## What runs where today

A chart stacks four canvases in its root: `bottom` (2D), `glCanvas` (WebGL2), `top` (2D) and, when interactive, `cursorLayer` (2D). Everything runs on the main thread inside one `requestAnimationFrame` callback (`Chart.frame` → `Chart.render`):

| Phase (`RenderStats.times`) | Module | Touches |
| --- | --- | --- |
| input | `interaction.ts`, `pointer.ts` | DOM events; updates `TimeScale` / `PriceScale` |
| `autoscale` | `chart.ts` `fitScene`, `scales.ts`, series `priceRange` | pure data; may run indicator and custom-series hooks |
| `drawBottom` | `chart.ts` | 2D: background, grid, `drawBelow`, primitives |
| `drawGL` | `gl/`, series `drawGL` | WebGL2: uniforms, draw calls, uploads of dirty batch ranges |
| `drawTop` | `chart.ts`, series `draw2D`, `drawing/`, `annotations/`, `primitives.ts` | 2D: canvas-drawn series, custom series, drawings, labels, axes, text |
| `drawCursor` | `chart.ts`, `legend.ts` | 2D crosshair layer; legend and pane controls are DOM |

Points that decide the design:

- **The GPU seam is already narrow.** Series reach the GPU only through `GLRenderer` methods (`beginFrame`, `setPane`, `drawRects`, `drawSpans`, `drawPoints`, `drawBoxes`, `drawLine`, `drawFill`, `endFrame`, `release`). The only code that touches the raw `WebGL2RenderingContext` outside `renderer.ts` is `gl/heatmap-program.ts`, through `GLRenderer.extension`.
- **Data lives on the GPU; frames send transforms.** `RectBatch` and `LineBatch` hold every bar once. A pan or zoom changes only uniforms (an x and a y transform per draw), plus the visible instance range. Batches upload only their dirty range: one updated bar is 48–72 bytes.
- **Exceptions that write per frame:** grouped views (`grouping`) rewrite the visible buckets when the bucket layout changes, and GPU lines rewrite grouped vertices. That is at most a few thousand instances (tens of KB) per frame.
- **Nothing reads back from the GPU.** Hit-testing (drawings, annotations, series under the crosshair) is CPU math on scales and data. There is no `readPixels` or `getImageData` in core. Hit-testing stays on the main thread in every option.
- **All text is Canvas2D or DOM** (axes, labels, drawings, legend), on the main thread.
- **Every public extension hook is synchronous and main-thread:** primitives (`drawPlot`, `drawPriceAxis`, `drawTimeAxis`, `drawLane`), custom series `draw`, drawing tool `render` / `hitTest`, `autoscale` providers and custom-series `step`. They get a `CanvasRenderingContext2D` or plain values, never the GPU context. The per-chart plugins from #549 install these hooks; none of them reach `gl/`.
- **Contracts that assume one thread:** `createChart` throws `webgl2-unavailable` synchronously before touching the container. `resize()` redraws synchronously so the browser never paints a cleared canvas. `captureImage` redraws and copies the GPU canvas in the same task (`preserveDrawingBuffer: false`). `gl: 'shared'` copies a shared canvas into each chart's 2D canvas in the same task. Static charts (`interactive: false`) snapshot the GPU layer into a 2D canvas and give the context back.

## Prototype and measurements

The prototype was a throwaway page and is not committed. It used the real `GLRenderer` and `RectBatch` from `packages/core/src/gl/` with 1,000,000 candles (2 instances per bar, 48 MB of instance data) at 1280×720, DPR 1. `GLRenderer` ran unchanged in a dedicated worker on an `OffscreenCanvas`; only its constructor's parameter type needed a cast. Two presentation modes were tried:

- **direct**: `canvas.transferControlToOffscreen()`. The worker's frames are committed by the worker, independently of the main thread.
- **bitmap**: the worker draws into its own `OffscreenCanvas`, posts `transferToImageBitmap()` back, and the main thread shows it with an `ImageBitmapRenderingContext`.

Separately, the real demo was measured with `renderStats: true`, driving 200 frames of programmatic panning through the frame loop.

Environment: Windows 11, 12 logical cores, one desktop browser, page not cross-origin isolated (timers coarsened to 0.1 ms, so per-frame figures are means over 200–300 frames). The pane was not visible, so there was no vsync or compositor: the figures below are CPU-side costs and message latency, **not input-to-photon latency**. GPU execution was not timed (`gl.finish()` returned in under 0.1 ms throughout).

### Where the main thread spends a frame (real chart, panning)

| Scenario | total | autoscale | drawBottom | **drawGL** | drawTop | drawCursor |
| --- | --- | --- | --- | --- | --- | --- |
| Demo, 3 panes, 1,519 bars, 6 px/bar | 0.77 ms | 0.10 | 0.11 | **0.056 (7%)** | 0.34 | 0.16 |
| Demo, 1 px/bar | 1.04 ms | 0.25 | 0.10 | **0.048 (5%)** | 0.53 | 0.10 |
| Demo with 1M bars, 6 px/bar | 0.67 ms | 0.11 | 0.10 | **0.046 (7%)** | 0.28 | 0.13 |
| Demo with 1M bars, 0.5 px/bar (9,222 instances) | 1.25 ms | 0.35 | 0.10 | **0.042 (3%)** | 0.62 | 0.12 |
| Demo with 1M bars, 0.2 px/bar, pixel grouping | 0.90 ms | 0.31 | 0.07 | **0.041 (5%)** | 0.39 | 0.08 |

The 2D layers take 60–80% of the frame and autoscale most of the rest. Recording the GPU layer costs about 0.05 ms however many bars are on screen, because it is a handful of instanced draw calls.

### Loading data (real chart)

| Scenario | `setData` | first frame | of which `drawGL` | uploaded |
| --- | --- | --- | --- | --- |
| Plain chart, 1M candles (3 runs) | 173–181 ms | — | **55–67 ms**, almost all in `bufferData` calls | 72 MB |
| Demo (8 more series and indicators), 1M bars | 1.4–1.6 s | 2.26 s | 42–44 ms | 15 MB |

The GPU upload after a large load is the one GPU cost that shows on the main thread, as a single long task. In the demo it is dwarfed by `setData` and by the first autoscale (2.2 s), which runs the demo's indicators. That is data work, which `roadmap/indicators.md` already plans to move to workers. It is not renderer work.

### Prototype: renderer in a worker (1M candles)

| Measure | main thread only | worker, direct | worker, bitmap |
| --- | --- | --- | --- |
| Main-thread time per pan frame (visible range + autoscale + GL or `postMessage`) | 0.089 ms | 0.005 ms | 0.005 ms + 0.006 ms to present |
| Worker time per frame | — | 0.071 ms | 0.062 ms |
| Round trip main → worker draws → main | — | 0.11 ms mean | 0.11 ms mean |
| Worker start-up and first upload (48 MB) | — | 115 ms (47 ms in the worker) | 116 ms |

Moving a whole batch to the worker:

| 48 MB batch | main thread blocked | until the worker has it |
| --- | --- | --- |
| structured clone | 37 ms | 44 ms |
| transfer (`postMessage(m, [buffer])`) | 0.08 ms | 2.8 ms (including the copy into the batch) |
| one-bar update (48 B, transferred) | 0.002 ms | — |

Main thread busy for 30 ms out of every 33 ms (a stand-in for a host app re-rendering), 2 s of panning animation:

| Animation driven by | frame gap p50 | frame gap p95 | frames |
| --- | --- | --- | --- |
| main thread | 30.0 ms | 30.2 ms | 72 |
| worker (its own loop) | 14.3 ms | 14.4 ms | 140 |

The worker keeps animating while the main thread is blocked. A real chart cannot use that, though. The time scale, autoscale, axes, labels, crosshair and every plugin hook live on the main thread, so a worker that animated alone would move the candles while the axes and drawings stood still.

### What the numbers say

1. Moving the GPU layer off the main thread saves about 0.05–0.08 ms per frame, under 10% of a 1 ms frame. The 2D layers, which are 60–80% of the frame, cannot move without breaking the public hooks.
2. Per-frame traffic is tiny (a few hundred bytes of transforms), and transferables carry bulk data at almost no cost. Neither `SharedArrayBuffer` nor cross-origin isolation is needed.
3. The visible risk is synchronisation. In direct mode the GPU layer and the 2D layers are committed separately and can land in different compositor frames: candles one frame off their axes, drawings and crosshair while panning. Bitmap mode keeps them in step, because the main thread presents both, but then a blocked main thread blocks the GPU layer too, and the benefit is gone.
4. The large-load upload (55–67 ms per 1M candles) would leave the main thread, but chunking the upload (visible range first, the rest over the next frames) removes the long task without a worker.

## Design if we ever build the worker renderer

Kept here so the work can start from it.

- **Boundary:** only the backend crosses: the GPU context, programs and GPU mirrors of batches. Scales, autoscale, layout, input, hit-testing, text, the 2D layers and all plugin hooks stay on the main thread.
- **Protocol:** per frame, one message with the recorded command list (`setPane`, `drawRects(batchId, first, count, uniforms)` and so on, as numbers in a small `Float64Array`), the frame size and DPR, and dirty batch ranges as transferred `ArrayBuffer` slices. Batches get ids; `release` becomes a message. The theme needs no transfer, because colours are already baked into instance bytes and uniforms.
- **Presentation:** bitmap mode (worker returns an `ImageBitmap`; the main thread presents it in the same task as the 2D layers). This is the only mode that keeps the layers in step and keeps the synchronous `resize()` promise. A transferred canvas cannot be resized from the main thread, so in direct mode the GPU layer would show stretched for a frame after every resize.
- **Context loss and budget:** `webglcontextlost` / `restored` work on `OffscreenCanvas` in a worker; forward them as messages to the existing `context:*` events. The context budget stays on the main thread and sends suspend and resume messages. Worker contexts still count against the browser's limit.
- **Start-up:** keep the synchronous `webgl2-unavailable` throw by probing `new OffscreenCanvas(1, 1).getContext('webgl2')` on the main thread, then releasing it. Report shader failures in the worker through a new event (additive).
- **Not supported in a first version:** `gl: 'shared'` and static charts (`interactive: false`), because both copy the GPU canvas into a 2D canvas in the same task. Reject those combinations at creation with a `ChartError`.
- **Packaging:** a separate entry point, for example `@chart-on/core/render-worker`. The app creates the worker itself and passes it in, for example `createChart(el, { renderer: workerRenderer(new Worker(new URL('@chart-on/core/render-worker', import.meta.url), { type: 'module' })) })`. The library never starts a worker or loads code itself, so the built-file CSP check (`scripts/csp-rules.ts` flags `new Worker`) and the security guide's "no workers" statement stay true for apps that do not opt in. An app that opts in needs `worker-src 'self'` (or the `script-src` fallback). Blob-URL workers would need `worker-src blob:` and should not be offered. The design principle "no separately hosted static files" is kept because the app's bundler emits the worker file as part of the app.
- **Bundle size:** a worker entry with the renderer and batches is about 11 KiB gzip (the prototype's worker, minified: 11.0 KiB), plus about 4 KiB for the heatmap program. The main-thread proxy would be 2–3 KiB, and only apps that import `workerRenderer` pay for it. The default bundle does not grow.
- **Browser support:** dedicated workers with WebGL2 on `OffscreenCanvas` are available in current releases of all three major engines. The oldest version of one engine in our `browserslist` (16.4) has `OffscreenCanvas` for 2D only; WebGL on it arrived one major version later. `requestAnimationFrame` inside workers is not available everywhere, which matters little because frames would be driven by main-thread messages.

## WebGPU backend

### How it would coexist with WebGL2

WebGL2 stays the required baseline: a chart must always be able to run on WebGL2, and `webgl2-unavailable` keeps its meaning. A WebGPU backend would be an opt-in extra that the app imports and passes in, like a plugin (for example a `webgpu()` factory). Apps that do not import it pay nothing.

`navigator.gpu.requestAdapter()` and `requestDevice()` are asynchronous, but `createChart` is synchronous. So a chart starts on WebGL2 and switches when the device is ready. If the adapter is missing or fails, the chart stays on WebGL2. The existing context-restore machinery already does what a switch needs: it bumps `generation` and every batch and grid rebuilds its GPU mirror lazily on its next draw. A switch is a restore onto a different backend. Device loss (`device.lost`) maps to the existing `context:lost` / `context:restored` events with reason `'browser'`, or falls back to WebGL2.

### Renderer interface (internal)

The seam to cut, shaped after what `GLRenderer` already exposes. All of it stays `@internal`:

```ts
/** @internal What series draw through: the WebGL2 renderer today, later a WebGPU one or a worker proxy. */
interface RenderBackend {
  readonly kind: 'webgl2' | 'webgpu';
  readonly maxTextureSize: number;
  readonly isLost: boolean;
  readonly holdsContext: boolean;
  beginFrame(dpr: number): void;
  setPane(rect: DeviceRect): void;
  drawRects(batch: RectBatch, first: number, count: number, u: RectUniforms): void;
  drawSpans(batch: RectBatch, first: number, count: number, u: SpanUniforms): void;
  drawPoints(batch: RectBatch, first: number, count: number, u: PointUniforms): void;
  drawBoxes(batch: RectBatch, first: number, count: number, u: BoxUniforms): void;
  drawLine(batch: LineBatch, first: number, end: number, u: LineUniforms): void;
  drawFill(batch: LineBatch, first: number, end: number, u: FillUniforms): void;
  drawHeatmap(grid: HeatmapGrid, u: HeatmapUniforms): void;
  endFrame(): void;
  release(owner: GpuOwner): void;
  suspend(): void;
  resume(): void;
  gpuMemory(): GpuMemory;
  gpuTime(): number | null;
  stopTiming(): void;
  destroy(): void;
}
```

Changes this needs in `gl/`:

- Move the heatmap program behind `drawHeatmap`, so nothing outside a backend uses the raw context, and drop `extension(create)` from the shared surface (or keep it as a WebGL2-only detail).
- Make `Series.drawGL` take `RenderBackend`.
- Keep `RectBatch` and `LineBatch` as backend-neutral CPU buffers. Their byte layouts (24 bytes per rect instance, `LINE_STRIDE` per line vertex) work as WebGPU vertex buffers or storage buffers as they are.
- A worker proxy would implement the same interface by recording commands, which is why this is step one for both options.

### What WebGPU would change

- **Instance data in storage buffers, and `firstInstance`.** WebGL2 has no base-instance draw, so `drawRects` re-points the instanced attributes for every draw. WebGPU's `draw(…, firstInstance)` removes that.
- **Compute.**
  - The heatmap's level pyramid (`heatmap-grid.ts` / `heatmap-reduce.ts`, built on the CPU today) and its max/sum reductions per pixel fit compute shaders.
  - So would min/max scans over the visible range for autoscale on very large series, and percentile colour scaling.
  - These are the only places where a measurable win is likely. The rect and line draws already cost about 0.05 ms per frame.
- **One device for many canvases.** A `GPUDevice` can render to any number of canvas contexts, with no small per-page context limit. On pages with many charts (#297), `gl: 'shared'` and its copy into a 2D canvas, and the context budget's evictions, would not be needed under WebGPU.
- **Shaders.** Seven programs (rect, span, point, box, line, fill, heatmap) need porting from GLSL ES 3.0 to WGSL. They are small and use nothing without a direct WGSL equivalent: `flat` varyings, `gl_FragCoord`, `discard`, and `texelFetch` on the heatmap's `R32F` texture (`textureLoad`, which WebGPU allows on unfilterable float textures). Expect a 1:1 port, kept side by side with the GLSL.
- **Compositing.** Configure the canvas with `alphaMode: 'premultiplied'` to match today's blending. Screenshots keep working as now: draw and copy in the same task, since the current texture is only valid until the task ends.
- **Workers.** `navigator.gpu` is available in workers, so a later worker renderer could host either backend.

### Testing

- Today, `recordingWebgl2()` in `test/fake-dom.ts` records GL calls. Add a recording `RenderBackend` fake one level up, so series and chart tests assert backend commands and become backend-independent.
- Each backend then gets thin tests of its own translation: the existing GL fake for WebGL2, and a small recording fake of `GPUDevice` / `GPUQueue` for WebGPU.
- Pixel parity between the backends goes through the visual-regression suite (#29), run once per backend in a real browser, where the CI browser offers a WebGPU adapter. Where none is available, the WebGPU job is skipped, not failed.

### Cost

- **Code:** a second backend of roughly the size of `renderer.ts` and `heatmap-program.ts` (about 1,700 lines), plus WGSL.
- **Bundle:** about 12–16 KiB gzip, only for apps that import it (today's WebGL2 renderer is 10.3 KiB gzip minified, and the heatmap program 4.0 KiB).
- **Maintenance:** every new GPU series style needs two implementations and two test runs.
- **Support:** WebGPU ships by default in current releases of all three major engines on most desktop platforms, with gaps on some operating systems, GPUs and mobile devices. Check coverage again before starting.

## Public API impact

Target: no changes. Findings:

| API | Worker renderer | WebGPU backend |
| --- | --- | --- |
| `createChart` / `new Chart` | unchanged; new creation-only option (additive); sync `webgl2-unavailable` kept through a main-thread probe | unchanged; new creation-only option (additive) |
| `resize()` synchronous redraw | kept only in bitmap mode | unchanged |
| `captureImage()` | already returns a `Promise`; the worker renders a bitmap | unchanged |
| `gl: 'shared'`, `interactive: false` | not combinable in a first version (creation error, additive code) | unchanged; less needed |
| `context:lost` / `context:restored` / `context:restore-failed` | unchanged; arrive after a message hop | unchanged; device loss mapped onto them |
| `getContextBudget` / `setContextBudget` | unchanged (worker contexts still count) | unchanged (not needed for WebGPU charts) |
| `gpuMemory()`, `renderStats()` `gpuTime` / `memory` | unchanged shape; values one frame old | unchanged |
| `RenderStats.times.drawGL` | measures recording and posting | measures command encoding |
| `maxGlDpr` | unchanged | applies to the GPU layer whatever the backend (name kept) |
| Plugin hooks (primitives, custom series, drawing tools, autoscale) | unchanged, stay on the main thread | unchanged |
| `isWebGL2Supported()` | unchanged | unchanged |

One leak to close first: `Series.drawGL(r: GLRenderer, env)` and `Series.draw2D` are not tagged `@internal`. `Series` is exported, so `GLRenderer` reaches the published typings through them. Neither is documented or meant to be called by apps. Tagging them `@internal` and switching `drawGL` to the internal `RenderBackend` is a typings change only, and it should be listed under API notes when done.

## Go/no-go criteria

| Phase | What | Start when | Go if | No-go if |
| --- | --- | --- | --- | --- |
| 0 (#558) | Internal `RenderBackend` interface; heatmap behind it; recording backend fake; `Series.drawGL` / `draw2D` `@internal` | now (small, no behaviour change) | tests pass unchanged; core bundle grows < 0.5 KiB gzip | — |
| 0b (#559) | Chunked first upload of large batches (visible range first) | now, low priority | the longest main-thread task after a 1M-candle `setData` drops by the upload time (55–67 ms here) with no blank frames | first frame shows missing bars |
| W1 | Worker renderer (bitmap mode), opt-in | `drawGL` plus uploads exceed 25% of main-thread frame time, or 2 ms p95, in a real app on target hardware; or streaming heatmap uploads cause long tasks over 50 ms | main-thread frame time drops by at least that share; GPU and 2D layers never drift apart; input-to-photon p95 grows by less than one frame | layers drift, or the saving stays under 1 ms per frame |
| G1 | WebGPU backend spike, opt-in | a feature needs GPU compute (large heatmaps, autoscale scans over millions of points), or many-chart pages hit the context budget in practice | pixel parity on the visual-regression set; frame time not worse; a measured win of at least 3× on the targeted workload; bundle cost only for importers | parity needs per-backend hacks in series code, or the win does not materialise |

Phase 0 helps both later phases and is worth doing on its own. W1 and G1 wait for their triggers; no issues are open for them until a trigger is met.
