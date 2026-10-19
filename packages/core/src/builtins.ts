import { annotationHost } from './annotations/chart-host';
import { FILLS, TradeFills } from './annotations/fills';
import { LINES, TradingLines } from './annotations/trading-lines';
import { AnnotationManager } from './annotations/manager';
import type { Chart } from './chart';
import { createDepthLane, drawLanes, measureLanes } from './depth-lane';
import { installDrawings } from './drawing/feature';
import { builtinTools } from './drawing/tools';
import type { DrawingToolDef } from './drawing/types';
import { primeHeatmap } from './gl/heatmap-program';
import { shared } from './gl/shared';
import { Grouping } from './grouping';
import { installIndicators } from './indicators/feature';
import { installComparisons } from './data/comparisons';
import { adjustBar, adjustBars, adjustmentMarkers, priceFactor, sameAdjustmentsAfter } from './data/adjust';
import { connectSource } from './data/wiring';
import { MarkersLoader, toBarMarkers } from './data/marks';
import { inspectHeatmap, type HeatmapInspector } from './inspector';
import { loadLayout, serializeLayout } from './layout';
import type { ChartPlugin } from './plugins';
import { PriceStyles } from './price-styles';
import { compositeImage } from './capture';
import { barCountdown } from './countdown';
import { marketStatusFeature } from './market-status';
import { PulseClock } from './pulse';
import { createLocalizer } from './util/locale';
import { VolumeProfileSeries } from './profile/series';
import { ReferenceLines } from './reference-lines';
import { Replay } from './replay';
import { notInstalled, SHARED_CONTEXT, type ChartInternals, type OptInFeatures } from './registry';
import { HeatmapSeries, defaultFormat } from './series';
import { PointSeries } from './points';
import { FrameStats } from './stats-overlay';
import { viewportBoundsFeature } from './viewport-bounds';
import { CORE_VERSION } from './version';
import { createWatermark, symbolWatermarkLines } from './watermark';

// Opt-in features, as plugins for one chart: `createChart(el, { plugins: builtins() })`
// or `chart.install(heatmap())`. A chart without them leaves their code out of the bundle.

/** The chart's internal hooks the opt-in feature plugins fill in. */
type FeatureHost = {
  provideFeature<K extends keyof OptInFeatures>(key: K, feature: OptInFeatures[K]): () => void;
  internals(): ChartInternals;
};
const host = (chart: Chart) => chart as unknown as FeatureHost;
/** Name of both drawings plugins: a chart has one. */
const DRAWINGS = '@chart-on/core/drawings';

/** Plugin that adds `chart.addHeatmap`: the heatmap series, its GPU program and hover inspector. */
export function heatmap(): ChartPlugin {
  return {
    name: '@chart-on/core/heatmap',
    version: CORE_VERSION,
    install: (ctx) => {
      let inspector: HeatmapInspector | null = null;
      return host(ctx.chart).provideFeature('heatmap', {
        series: (h, pane, options) =>
          new HeatmapSeries(h, pane, {
            title: 'Heatmap',
            lowPercentile: 40,
            highPercentile: 98,
            gap: 1,
            opacity: 0.95,
            inspector: true,
            format: (v) => ctx.chart.localization.number(v, 2),
            ...options,
          }),
        prime: primeHeatmap,
        inspect: (chart, index) => (inspector = inspectHeatmap(chart, index, inspector)) !== null,
      });
    },
  };
}

/** Plugin that adds `chart.addVolumeProfile`. */
export function volumeProfile(): ChartPlugin {
  return {
    name: '@chart-on/core/volume-profile',
    version: CORE_VERSION,
    install: (ctx) =>
      host(ctx.chart).provideFeature('volumeProfile', {
        series: (h, pane, options) => new VolumeProfileSeries(h, pane, options, () => ctx.chart.main),
      }),
  };
}

/**
 * Plugin that adds `chart.addPoints`: markers at exact times and prices drawn
 * on the GPU, such as large trades sized by quantity.
 */
export function points(): ChartPlugin {
  return {
    name: '@chart-on/core/points',
    version: CORE_VERSION,
    install: ({ chart }) =>
      host(chart).provideFeature('points', {
        series: (h, pane, options) =>
          new PointSeries(h, pane, { title: '', shape: 'circle', size: 6, opacity: 0.8, format: defaultFormat, lastValueLabel: false, ...options }),
      }),
  };
}

/**
 * Plugin that adds `chart.setViewportBounds`: a time window and a price band
 * the view stays inside.
 */
export function viewportBounds(): ChartPlugin {
  return {
    name: '@chart-on/core/viewport-bounds',
    version: CORE_VERSION,
    install: ({ chart }) => {
      const feature = viewportBoundsFeature(chart);
      const off = host(chart).provideFeature('viewportBounds', feature);
      // The bounds go with the plugin.
      return () => {
        feature.set(null);
        chart.time.bounds = null;
        off();
        chart.invalidate();
      };
    },
  };
}

/**
 * Plugin that lets charts created with `gl: 'shared'` draw through one WebGL
 * context for the whole page. Pass it in the chart's creation `plugins`: the
 * context is chosen then. Without it, `gl: 'shared'` charts get their own.
 */
export function sharedContext(): ChartPlugin {
  return {
    name: SHARED_CONTEXT,
    version: CORE_VERSION,
    install: ({ chart }) => host(chart).provideFeature('sharedContext', shared),
  };
}

/**
 * Plugin that adds `chart.addDepthLane`: bars beside the price axis for the
 * bid and ask sizes of the app's order book. It also lays out the lanes other
 * primitives reserve (`Primitive.lane`).
 */
export function depthLane(): ChartPlugin {
  return {
    name: '@chart-on/core/depth-lane',
    version: CORE_VERSION,
    install: (ctx) => host(ctx.chart).provideFeature('depthLane', { create: createDepthLane, measure: measureLanes, draw: drawLanes }),
  };
}

/**
 * Plugin that measures frames while the `renderStats` or `renderStatsOverlay`
 * option is on (`chart.frameStats`, the `frame:render` event, GPU time
 * included), and shows them on the chart with the latter. Without it both
 * options collect nothing.
 */
export function statsOverlay(): ChartPlugin {
  return {
    name: '@chart-on/core/stats-overlay',
    version: CORE_VERSION,
    install: (ctx) => {
      const stats = new FrameStats(ctx.chart);
      ctx.onFrame(stats);
      ctx.onDispose(() => stats.stop());
      return host(ctx.chart).provideFeature('statsOverlay', stats);
    },
  };
}

/**
 * Plugin that lets the chart load bars through a data source
 * (`chart.setDataSource`, then `chart.data`): symbols, intervals, history
 * paging on scroll-back, live updates and the snapshot cache. Without it
 * `setDataSource` throws and bars come only through `setData`.
 */
export function dataSource(): ChartPlugin {
  return {
    name: '@chart-on/core/data-source',
    version: CORE_VERSION,
    install: (ctx) =>
      host(ctx.chart).provideFeature('dataSource', { connect: connectSource }),
  };
}

/**
 * Plugin that fetches the data source's markers (`DataSource.markers`) for
 * the visible range: `chart.sourceMarkers` and the `sourcemarkers:*` events,
 * named after them. They draw through `annotations()`. Without it the chart
 * never asks for them.
 */
export function sourceMarkers(): ChartPlugin {
  return {
    name: '@chart-on/core/source-markers',
    version: CORE_VERSION,
    install: (ctx) =>
      host(ctx.chart).provideFeature('sourceMarkers', {
        loader: (source, show, emit) => new MarkersLoader(source, show, emit),
        toMarkers: toBarMarkers,
      }),
  };
}

/**
 * Plugin that applies the corporate actions the data source reports
 * (`DataSource.adjustments`): back-adjusts bars under the `adjustment`
 * option and marks the actions per `adjustmentMarkers`. Without it bars show
 * as sent and no action is marked.
 */
export function adjustments(): ChartPlugin {
  return {
    name: '@chart-on/core/adjustments',
    version: CORE_VERSION,
    install: (ctx) =>
      host(ctx.chart).provideFeature('adjustments', {
        bars: adjustBars,
        bar: adjustBar,
        sameAfter: sameAdjustmentsAfter,
        factor: priceFactor,
        markers: adjustmentMarkers,
      }),
  };
}

/**
 * Plugin that adds drawings: the drawing manager (`chart.drawings`), its
 * commands (delete, copy, paste, undo, redo, lock, hide, group) and the
 * system clipboard, with the drawing tools in `tools` (none by default).
 * For drawings with only your own tools; `drawingTools()` brings the
 * built-in ones. A chart takes one of the two.
 */
export function drawings(tools: readonly DrawingToolDef[] = []): ChartPlugin {
  return { name: DRAWINGS, version: CORE_VERSION, install: (ctx) => installDrawings(ctx, tools) };
}

/**
 * Plugin that adds drawings (as `drawings()` does) with drawing tools, each
 * with a `draw-<type>` action: by default every built-in tool
 * (`builtinTools`). Pass a subset to offer only some; the bundle still holds
 * every built-in tool, since they are picked from `builtinTools`.
 */
export function drawingTools(tools: readonly DrawingToolDef[] = builtinTools): ChartPlugin {
  return { name: DRAWINGS, version: CORE_VERSION, install: (ctx) => installDrawings(ctx, tools, builtinTools) };
}

/**
 * Plugin that adds annotations (`chart.annotations`): bar markers, price,
 * trade, alert and draft lines, zones, bands and text labels. The data
 * source's marks and time marks, corporate action markers and indicator
 * shape plots draw through it too. Trade fills come with `trading()`.
 */
export function annotations(): ChartPlugin {
  return {
    name: '@chart-on/core/annotations',
    version: CORE_VERSION,
    install: ({ chart }) => host(chart).provideFeature('annotations', new AnnotationManager(annotationHost(chart, host(chart).internals()))),
  };
}

/**
 * Plugin that adds trading annotations to `annotations()`: order, position,
 * alert and draft lines (`chart.annotations.addTradeLine` and the other line
 * calls) with their dragging, buttons, bracket handles and clusters, and
 * trade fill markers (`setTrades` and the other fill calls). Install it after
 * `annotations()`.
 */
export function trading(): ChartPlugin {
  return {
    name: '@chart-on/core/trading',
    version: CORE_VERSION,
    install: ({ chart }) => {
      const layer = chart.annotationLayer ?? notInstalled('trading()', 'annotations()');
      const lines = layer.addLayer(LINES, (h) => new TradingLines(h));
      const fills = layer.addLayer(FILLS, (h) => new TradeFills(h));
      return () => {
        fills();
        lines();
      };
    },
  };
}

/**
 * Plugin that adds indicators (`chart.indicators`): definitions, the
 * indicators on the chart, their series, sets and undo steps, and saved
 * indicators in layouts. Indicator definitions themselves come from the app
 * or other plugins, e.g. `@chart-on/indicators`.
 */
export function indicators(): ChartPlugin {
  return { name: '@chart-on/core/indicators', version: CORE_VERSION, install: (ctx) => installIndicators(ctx.chart) };
}

/**
 * Plugin that adds compared symbols: `chart.compare`, which plots other
 * symbols (or pairs of them) from the data source next to the main one.
 */
export function comparisons(): ChartPlugin {
  return { name: '@chart-on/core/comparisons', version: CORE_VERSION, install: (ctx) => installComparisons(ctx.chart) };
}

/**
 * Plugin that gives the chart its watermark (`chart.watermark`): the symbol
 * and interval it loads, large and faint behind the series, while
 * `features.watermark` is on. Without it the flag draws nothing; a watermark
 * made with `createWatermark` can still be attached by hand.
 */
export function watermark(): ChartPlugin {
  return {
    name: '@chart-on/core/watermark',
    version: CORE_VERSION,
    install: ({ chart, onDispose }) => {
      const mark = createWatermark();
      // Installed after a load: show what is loaded now, then follow the next loads.
      const data = chart.data;
      if (data?.symbol && data.interval) mark.applyOptions({ lines: symbolWatermarkLines(data.symbol, data.interval) });
      onDispose(mark.follow(chart));
      return host(chart).provideFeature('watermark', mark);
    },
  };
}

/**
 * Plugin that saves and restores what the user arranged:
 * `chart.serializeLayout` and `chart.loadLayout` (symbol and interval, chart
 * type, panes and price scales, indicators, drawings and the visible range).
 * Without it both throw; `state:change` and `layoutLoading` need no plugin.
 */
export function layouts(): ChartPlugin {
  return {
    name: '@chart-on/core/layouts',
    version: CORE_VERSION,
    install: ({ chart }) => host(chart).provideFeature('layouts', { serialize: serializeLayout, load: loadLayout }),
  };
}

/**
 * Plugin that draws the main series' reference lines (`chart.referenceLines`
 * and the `referenceLines` option): previous close, the visible high, low and
 * average close, bid and ask from the data source's quotes, and the newest
 * extended-hours price. Without it the option draws nothing.
 */
export function referenceLines(): ChartPlugin {
  return {
    name: '@chart-on/core/reference-lines',
    version: CORE_VERSION,
    install: ({ chart, onDispose }) => {
      const lines = new ReferenceLines({
        get theme() {
          return chart.theme;
        },
        get main() {
          return chart.main;
        },
        timeline: chart.timeline,
        time: chart.time,
        panes: chart.panes,
        formatAxis: (pane, price, scaleId) => chart.formatAxis(pane, price, scaleId),
        requestOverlay: () => chart.redrawOverlay('annotations'),
      });
      // Installed after a quote came: show it now, then follow the next ones.
      lines.setQuote(chart.data?.quote ?? null);
      // Through onDispose, so an install that throws below leaves no listeners.
      onDispose(chart.on('data:quote', ({ quote }) => lines.setQuote(quote)));
      onDispose(
        chart.on('data:loading', ({ kind }) => {
          if (kind === 'initial') lines.setQuote(null);
        }),
      );
      return host(chart).provideFeature('referenceLines', lines);
    },
  };
}

/**
 * Plugin that draws the candle styles for price-based bars (see `priceBars`):
 * `kagi` as a thick and thin line, `pointFigure` as columns of X and O boxes.
 * Without it a candle series in either style draws nothing.
 */
export function priceStyles(): ChartPlugin {
  return {
    name: '@chart-on/core/price-styles',
    version: CORE_VERSION,
    install: ({ chart }) => host(chart).provideFeature('priceStyles', (series, release) => new PriceStyles(series, release)),
  };
}

/**
 * Plugin that groups bars while the view is zoomed out, under the `grouping`
 * option: by powers of two (`'pixel'`) or by calendar period (`'calendar'`),
 * for `chart.grouping` and `grouping:change`. Without it the option draws
 * single bars.
 */
export function grouping(): ChartPlugin {
  return { name: '@chart-on/core/grouping', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('grouping', new Grouping(chart)) };
}

/**
 * Plugin that draws the series option `lastPointPulse`: a ring that grows out
 * of the newest point of a line, area, step or baseline and fades, on each
 * live update or for as long as it is on screen. Without it the option is
 * kept but draws nothing.
 */
export function lastPointPulse(): ChartPlugin {
  return { name: '@chart-on/core/last-point-pulse', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('pulse', (still) => new PulseClock(still)) };
}

/**
 * Plugin that gives the chart `captureImage`: every layer drawn into one
 * image, with an optional caption, padding, background and theme. Without
 * it `captureImage` throws a `not-registered` error.
 */
export function imageCapture(): ChartPlugin {
  return { name: '@chart-on/core/image-capture', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('imageCapture', compositeImage) };
}

/**
 * Plugin that gives the chart `marketStatus()` (the market phase from the
 * session options, and the data delay) and the legend badge of the
 * `marketStatus` option. Without it `marketStatus()` throws a
 * `not-registered` error and the option shows nothing.
 */
export function marketStatus(): ChartPlugin {
  return { name: '@chart-on/core/market-status', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('marketStatus', marketStatusFeature) };
}

/**
 * Plugin that draws the `countdown` feature flag: the time left in the newest
 * bar, under the main series' last price label. Without it the flag is kept
 * but shows nothing.
 */
export function countdown(): ChartPlugin {
  return { name: '@chart-on/core/countdown', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('countdown', barCountdown) };
}

/**
 * Plugin that applies the `localization` option (`createLocalizer`): numbers,
 * dates and built-in text in a locale through `Intl`, a decimal separator,
 * digit grouping, an hour cycle, a date format and your own messages or
 * `translate`. Without it the chart keeps the built-in English
 * (`englishLocalizer`), and the option is only checked.
 */
export function localization(): ChartPlugin {
  return { name: '@chart-on/core/localization', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('localizer', createLocalizer) };
}

/**
 * Plugin that adds bar replay of the main series (`chart.replay`): hide the
 * bars after a chosen one, then reveal them by step or on a timer.
 */
export function replay(): ChartPlugin {
  return { name: '@chart-on/core/replay', version: CORE_VERSION, install: ({ chart }) => host(chart).provideFeature('replay', new Replay(host(chart).internals())) };
}

/**
 * Every opt-in feature, for `createChart(el, { plugins: builtins() })`: data
 * sources, indicators, compared symbols, annotations with trading, heatmaps,
 * volume profiles, point series, viewport bounds, depth lanes, bar replay, drawings with all built-in tools,
 * the render statistics overlay, the data source's marks, corporate action
 * adjustments, the watermark, saved layouts, reference lines, the kagi and
 * point & figure styles, bar grouping, the last-point pulse, localization and
 * the shared WebGL context.
 *
 * @example
 * ```ts
 * import { builtins, createChart, drawingTools } from '@chart-on/core';
 *
 * const chart = createChart(el, { plugins: builtins() });
 * // Or only what the app uses:
 * const lean = createChart(el, { plugins: [drawingTools()] });
 * ```
 */
export function builtins(): ChartPlugin[] {
  return [dataSource(), indicators(), comparisons(), annotations(), trading(), heatmap(), volumeProfile(), points(), viewportBounds(), depthLane(), replay(), drawingTools(), statsOverlay(), sourceMarkers(), adjustments(), watermark(), layouts(), referenceLines(), priceStyles(), grouping(), lastPointPulse(), localization(), countdown(), imageCapture(), marketStatus(), sharedContext()];
}
