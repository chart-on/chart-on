import { ChartError } from './errors';
import type { RenderBackend } from './gl/backend';
import type { DepthLane, DepthLaneOptions, drawLanes, measureLanes } from './depth-lane';
import type { DrawingManager, SelectionAxisMarks } from './drawing/manager';
import type { DrawingToolDef } from './drawing/types';
import type { Pane } from './pane';
import type { Chart, ChartSelection, ComparedSymbol, ScreenshotOptions, StateChangeReason } from './chart';
import type { AnnotationManager } from './annotations/manager';
import type { CaptureHost } from './capture';
import type { Grouping } from './grouping';
import type { LayoutsFeature } from './layout';
import type { MarketStatusFeature } from './market-status';
import type { ReferenceLines } from './reference-lines';
import type { Replay, ReplayHost } from './replay';
import type { Watermark } from './watermark';
import type { CompareMode, ComparePair, CompareStyle } from './data/compare';
import type { Adjustment, AdjustmentMode } from './data/adjust';
import type { LocalizationOptions, Localizer } from './util/locale';
import type { DataEvents, DataLoadKind, DataSource, SourceMarker } from './data/types';
import type { DataController, DataControllerOptions, DataTarget } from './data/controller';
import type { SourceWiring } from './data/wiring';
import type { MarkersLoader, MarkersSource } from './data/marks';
import type { BarMarker } from './annotations/types';
import type { Indicator } from './indicators/indicator';
import type { IndicatorManager } from './indicators/manager';
import type { IndicatorSet } from './indicators/sets';
import type { PrimitiveRegistry } from './primitives';
import type { VolumeProfileOptions, VolumeProfileSeries } from './profile/series';
import type { PointSeries, PointSeriesOptions } from './points';
import type { HeatmapSeries, HeatmapSeriesOptions, Series, SeriesHost } from './series';
import type { PriceScale } from './scales';
import type { RenderStats } from './render-stats';
import type { SharedClient, SharedSession } from './gl/shared';
import type { Bar, Time } from './types';
import type { PaneButtonsSpace } from './pane-controls';
import type { ViewportBoundsFeature } from './viewport-bounds';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

// The opt-in series and lanes a chart creates through what a plugin gave it (`heatmap()`,
// `volumeProfile()`, `points()`, `depthLane()` in `builtins.ts`) instead of importing them, so a bundle
// without those plugins leaves their code out. Types only, plus the error.

/** @internal What the `heatmap()` plugin gives a chart: the series (with its default options), its GPU program and its hover inspector. */
export interface HeatmapFeature {
  series(host: SeriesHost, pane: Pane, options: Partial<HeatmapSeriesOptions>): HeatmapSeries;
  /** Build the GPU program now, so a shader failure throws from `addHeatmap`. */
  prime(renderer: RenderBackend): void;
  /**
   * Show the hover grid for the heatmap cell under the crosshair of `chart` at
   * bar `index`, made when first needed, or hide it. True once it was made.
   */
  inspect(chart: Chart, index: number): boolean;
}

/** @internal What the `volumeProfile()` plugin gives a chart: the series, profiling the chart's main series. */
export interface VolumeProfileFeature {
  series(host: SeriesHost, pane: Pane, options: Partial<VolumeProfileOptions>): VolumeProfileSeries;
}

/** @internal What the `points()` plugin gives a chart: the point series, with its default options. */
export interface PointsFeature {
  series(host: SeriesHost, pane: Pane, options: Partial<PointSeriesOptions>): PointSeries;
}

/** @internal What the `depthLane()` plugin gives a chart: the depth lane primitive, and the host that lays out every primitive's lane. */
export interface DepthLaneFeature {
  create(options: Partial<DepthLaneOptions>): DepthLane;
  measure: typeof measureLanes;
  draw: typeof drawLanes;
}

/** @internal What the `statsOverlay()` plugin gives a chart: `chart.frameStats`. */
export interface StatsOverlayFeature {
  /** The last frame's statistics; null while they are off. */
  last(): RenderStats | null;
}

/**
 * @internal What the drawings plugin gives a chart: the drawing manager, the
 * copy and paste keys of its system clipboard, a hook for tool changes, the
 * axis marks of a selected drawing, repricing, and what ends it.
 */
export interface DrawingsFeature {
  readonly manager: DrawingManager;
  /** Take a copy or paste shortcut through the clipboard events; true when taken. */
  key(e: KeyboardEvent): boolean;
  /** The chart's tools changed (`DrawingHost.toolsChange`). */
  toolsChange(): void;
  /** Highlight the price and time range a selected drawing spans, under the axis labels. */
  ranges(ctx: CanvasRenderingContext2D, marks: SelectionAxisMarks): void;
  /** Label a selected drawing's prices and times on the axes. */
  labels(ctx: CanvasRenderingContext2D, marks: SelectionAxisMarks): void;
  /** Drawings go: end what is under way. */
  end(): void;
  /** Move main-pane drawings priced under `adjustments` and `mode` onto the same bars as adjusted now. */
  rebase(adjustments: readonly Adjustment[], mode: AdjustmentMode): void;
}

/** @internal What the indicators plugin gives a chart: the indicator manager and the indicator copied in memory. */
export interface IndicatorsFeature {
  readonly manager: IndicatorManager;
  /** The indicator the last copy or cut took, as a one-entry set; null when it took drawings. */
  readonly copied: IndicatorSet | null;
  /** Copy `indicator` in memory. */
  copy(indicator: Indicator): void;
  /** Add a copied indicator `set` and select it. One it cannot add is reported through `notify`, not thrown. */
  paste(set: unknown): boolean;
  /** Forget the copied indicator: copied drawings replace it. */
  drop(): void;
}

/** @internal What the drawings and indicators plugins give a chart: its selection, which `getSelection` and `setSelection` reach. */
export interface SelectionFeature {
  /** The selected indicator, or null. */
  readonly indicator: Indicator | null;
  get(): ChartSelection;
  set(selection: ChartSelection): void;
  /** A click on `series`, or on no series: select its indicator, or drop the indicator selection. */
  click(series: Series | null): void;
  /** Drawings were selected (`drawing:select`) or an indicator removed (`indicator:remove`). */
  changed(event: { ids?: string[]; indicator?: Indicator }): void;
}

/**
 * @internal The chart's own members the drawings, annotations, indicators,
 * comparisons and replay plugins use (`Chart.internals`), so their glue lives
 * with them instead of in the chart.
 */
export interface ChartInternals extends ReplayHost {
  /** Put `series` on its pane; `announce` false leaves `series:add` to the caller. */
  attach<S extends Series>(series: S, announce?: boolean): S;
  /** Take `series` off the chart; `indicator` is the one that drew it, for `series:remove`. */
  detach(series: Series, indicator: Indicator | null): void;
  /** Move `series` to `pane`, removing the pane it leaves empty. */
  moveSeries(series: Series, pane: Pane): Pane;
  /** Lay out the panes again and report `panes:change`. */
  panesChanged(): void;
  paneHasDrawings(index: number): boolean;
  /** Nominal length of the bar interval in seconds, or null while unknown. */
  intervalSeconds(): number | null;
  /** Report a `state:change`, unless something is loading. */
  stateChanged(reason: StateChangeReason): void;
  readonly primitives: PrimitiveRegistry;
  /** Whether `destroy` ran. */
  destroyed(): boolean;
  /** Whether `destroy` is under way or ran. */
  destroying(): boolean;
  /** Take what a loaded layout kept under `key` for a plugin not installed then; undefined when nothing. */
  takeLayout(key: string): unknown;
  /** Keep `value` under `key` in what layouts save, for a plugin that goes away. */
  keepLayout(key: string, value: unknown): void;
  /** What prices on `pane` at `time` show multiplied by under the `adjustment` option. */
  priceFactor(pane: Pane | undefined, time: Time): number;
  /** `price` in the format of `scale` on pane `pane`. */
  formatOnScale(pane: number, scale: PriceScale, price: number): string;
  /** Left edge (chart space) and width of the axis of `scale` on `pane`. */
  axisBox(pane: Pane, scale: PriceScale): [left: number, width: number];
  /** Label `text` on the axis of `scale` on `pane`, centred on chart-space `y`, in the context's font. */
  axisPill(ctx: CanvasRenderingContext2D, text: string, y: number, background: string, color: string, pane: Pane, scale: PriceScale): void;
  /** Label `text` on the time axis, centred on plot `x`, from chart-space `top`. */
  timePill(ctx: CanvasRenderingContext2D, text: string, x: number, top: number, background: string, color: string): void;
  /** Height the time axis takes: 0 while it is hidden. */
  timeAxisSize(): number;
  /** Top and height (chart space) of the band time-axis marks draw in; null when there is none. */
  timeMarkBand(): { top: number; height: number } | null;
  /** Height the pane buttons take at the top of each pane, and their side; null when there are none. */
  paneButtons(): PaneButtonsSpace | null;
  /** The drawing tools changed (`DrawingHost.toolsChange`). */
  toolsChange(): void;
  /** The indicators plugin's side, or null without it. */
  indicators(): IndicatorsFeature | null;
  /** Whether a bar replay runs (the `replay()` plugin). */
  replaying(): boolean;
  /** Drawing tools the installed plugins registered, also those from before drawings went away. */
  pluginDrawingTools(): readonly DrawingToolDef[];
  /** The drawings plugin's open text editor, which the chart closes when drawings go. */
  textEditor: HTMLInputElement | null;
}

/** @internal What the comparisons plugin gives a chart: `chart.compare` and the compared symbols. */
export interface ComparisonsFeature {
  readonly list: readonly ComparedSymbol[];
  add(what: string | ComparePair, options: { mode?: CompareMode; style?: CompareStyle; color?: string; title?: string }): ComparedSymbol;
  /** The main symbol loaded (`kind`): keep the compared symbols on its interval and history. */
  sync(kind: DataLoadKind): void;
  /** Load every compared symbol again; failures are reported as `compare:error`. */
  reload(): void;
  /** Remove every compared symbol; while the chart is destroyed, only release their loaders. */
  clear(destroying: boolean): void;
}

/** @internal What the `sourceMarkers()` plugin gives a chart: a loader of the data source's markers, and the bar markers that draw those on bars. */
export interface SourceMarkersFeature {
  loader(source: MarkersSource, show: (markers: readonly SourceMarker[], band: boolean) => void, emit: <K extends keyof DataEvents>(event: K, payload: DataEvents[K]) => void): MarkersLoader;
  toMarkers(markers: readonly SourceMarker[]): BarMarker[];
}

/** @internal What the `adjustments()` plugin gives a chart: back-adjusting bars and prices for corporate actions, and their markers. */
export interface AdjustmentsFeature {
  bars(bars: Bar[], adjustments: readonly Adjustment[], mode: AdjustmentMode): Bar[];
  bar(bar: Bar, adjustments: readonly Adjustment[], mode: AdjustmentMode): Bar;
  sameAfter(a: readonly Adjustment[], b: readonly Adjustment[], time: Time, mode: AdjustmentMode): boolean;
  factor(time: Time, adjustments: readonly Adjustment[], mode: AdjustmentMode): number;
  markers(adjustments: readonly Adjustment[], localizer: Localizer): BarMarker[];
}

/** @internal What the `dataSource()` plugin gives a chart: the controller that loads `source` into `target`, with its events handled (`connectSource`). */
export interface DataSourceFeature {
  connect(chart: Chart, wiring: SourceWiring, source: DataSource, target: DataTarget, options: Partial<DataControllerOptions>): DataController;
}

/** @internal Name of the `sharedContext()` plugin: a chart created with `gl: 'shared'` installs it first, to join the context. */
export const SHARED_CONTEXT = '@chart-on/core/shared-context';

/** @internal What the `sharedContext()` plugin gives a chart created with `gl: 'shared'`: the page's shared WebGL context to join. */
export interface SharedContextFeature {
  join(target: HTMLCanvasElement, client: SharedClient): SharedSession;
}

/** @internal The opt-in features (`Chart.provideFeature`), by key, and what the plugin of each gives the chart. */
export interface OptInFeatures {
  heatmap: HeatmapFeature;
  volumeProfile: VolumeProfileFeature;
  points: PointsFeature;
  viewportBounds: ViewportBoundsFeature;
  depthLane: DepthLaneFeature;
  statsOverlay: StatsOverlayFeature;
  sourceMarkers: SourceMarkersFeature;
  adjustments: AdjustmentsFeature;
  dataSource: DataSourceFeature;
  /** `serializeLayout` and `loadLayout`. */
  layouts: LayoutsFeature;
  /** The main series' reference lines, which take the `referenceLines` option. */
  referenceLines: ReferenceLines;
  /** Makes each series' last-point pulse clock (`SeriesHost.pulse`). */
  pulse: NonNullable<SeriesHost['pulse']>;
  /** Makes the drawers of the `kagi` and `pointFigure` styles (`SeriesHost.priceStyles`). */
  priceStyles: NonNullable<SeriesHost['priceStyles']>;
  /** The watermark `features.watermark` shows. */
  watermark: Watermark;
  /** Builds localizers from the `localization` option (`createLocalizer`). */
  localizer: (options: LocalizationOptions) => Localizer;
  /** Bucketing for the `grouping` option. */
  grouping: Grouping;
  /** Bar replay of the main series, made with `Chart.internals`. */
  replay: Replay;
  /** Compared symbols, made with `Chart.internals`. */
  comparisons: ComparisonsFeature;
  /** The drawing manager and clipboard keys, made with `Chart.internals`. */
  drawings: DrawingsFeature;
  /** The annotation manager, made with `Chart.internals`. */
  annotations: AnnotationManager;
  /** The indicator manager and copied indicator, made with `Chart.internals`. */
  indicators: IndicatorsFeature;
  /** The bar-close countdown text. */
  countdown: (chart: Chart) => string | undefined;
  /** `marketStatus()` and the legend badge of the `marketStatus` option. */
  marketStatus: MarketStatusFeature;
  /** Draws every layer into one canvas for `captureImage`. */
  imageCapture: (chart: Chart, host: CaptureHost, options: ScreenshotOptions) => HTMLCanvasElement | null;
  sharedContext: SharedContextFeature;
}

/** @internal Throw for `call` on a chart created without the plugin `plugin`. */
export function notInstalled(call: string, plugin: string): never {
  throw new ChartError(
    'not-registered',
    /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${call} needs the ${plugin} plugin: create the chart with createChart(el, { plugins: [${plugin}] }) (or builtins()), or call chart.install(${plugin})` : '',
    { context: { call, plugin } },
  );
}
