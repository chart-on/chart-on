# Custom chart types, custom series and indicators

## Today

| Kind | Renderer | Notes |
| --- | --- | --- |
| `candles` | WebGL instanced rects | `style: 'candles' \| 'line' \| 'area'`, first one defines the timeline |
| `histogram` | WebGL | sign colors, per-point color |
| `line` | Canvas2D, decimated | area gradient, baseline mode |
| `heatmap` | WebGL R32F texture | time × price grid, inspector |

`Series` is an abstract class in core (`packages/core/src/series.ts`); there is no public way to add a new series kind and no indicator system. Apps compute indicators themselves and push them into `line`/`histogram` series.

## 1. Main chart styles

Chart styles a professional chart needs, and our plan:

| Style | Type | Priority | How |
| --- | --- | --- | --- |
| Candles | time | ✅ | |
| Line | time | ✅ | |
| Area | time | ✅ | |
| Bars (OHLC ticks) | time | T1 | rect batch: 1 vertical + 2 horizontal ticks per bar |
| Hollow candles | time | T1 | body outline when close > open |
| Heikin Ashi | time | T1 | data transform before upload |
| Baseline | time | T1 | reuse `line` baseline mode on close |
| Columns | time | T1 | reuse histogram with close values |
| High-low | time | T2 | rect from low to high + labels |
| Step line | time | T2 | line renderer option `step: true` |
| Line with markers | time | T2 | line renderer option `markers: true` |
| HLC area | time | T2 | filled band between high and low + close line |
| Volume candles | time | T3 | body width scaled by volume |
| Renko, Kagi, Point & figure, Line break | non-time | T3 | need a derived timeline (bricks/columns not bars). Build on a "derived series" that owns its own index → time mapping. Indicators/drawings over these are restricted. |

API: extend `CandleSeriesOptions.style` union, plus per-style options:

```ts
candles.applyOptions({ style: 'hollow' });
candles.applyOptions({ style: 'heikin-ashi' });
candles.applyOptions({ style: 'bars', thinBars: true });
candles.applyOptions({ upWickColor, downWickColor, upBorderColor, downBorderColor, colorByPreviousClose: true });
```

Transforms (Heikin Ashi, later Renko) live in `packages/core/src/transforms/` as pure functions `(bars) => bars` with tests; incremental `update` recomputes only the last element.

## 2. Custom series plugin

Same idea as drawing tools: a plain object, registered once, added like built-ins.

```ts
interface CustomSeriesDef<D, O> {
  type: string;                                   // 'footprint', 'vol-profile'...
  defaultOptions: O;
  /** Index data by main-series time; return [min, max] for autoscale over visible index range. */
  priceRange(data: D[], from: number, to: number, options: O): [number, number] | null;
  /** Canvas2D path (simple). */
  draw2D?(ctx: CanvasRenderingContext2D, view: SeriesView<D, O>): void;
  /** WebGL path (fast). Gets the shared renderer with rect batch / texture helpers. */
  drawGL?(gl: GLRenderer, view: SeriesView<D, O>): void;
  legend?(item: D | undefined, options: O): LegendEntry | null;
  lastValue?(data: D[], options: O): LastValue | null;
  hitTest?(view: SeriesView<D, O>, p: Point): boolean;
}

interface SeriesView<D, O> {
  data: D[];
  options: O;
  from: number; to: number;          // visible index range
  indexToX(i: number): number;
  priceToY(p: number): number;
  barWidth: number;
  theme: ChartTheme;
  width: number; height: number;
}

chart.registerSeries(footprintDef);
const fp = chart.addSeries('footprint', { title: 'Footprint' }, pane);
fp.setData(rows); fp.update(row);
```

Built-in series should be refactored to implement the same contract internally so there is one code path. GL helpers (`RectBatch`, heatmap texture, color LUT) get exported for plugin authors.

## 3. Indicators

Moved to [indicators.md](indicators.md): built-in and custom indicators, plot types and the std library.
