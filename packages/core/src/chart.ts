import { svgIcon, type IconShape } from './util/svg-icon';
import { ActionRegistry, actionLabelKey } from './actions';
import type { History, UndoSteps } from './history';
import type { Buckets } from './lod';
import { devCheck } from './options-schema';
import { resolveTheme, type ChartTheme } from './theme';
import { Timeline } from './timeline';
import {
  TimeScale,
  autoscaleRuleError,
  copyPercentBase,
  easeOutCubic,
  isPercentBase,
  linkedRanges,
  percentBaseBar,
  type AutoscaleRule,
  type PercentBase,
  type PriceScale,
  type PriceScaleMode,
  type PriceScaleSide,
} from './scales';
import { Pane, axisColumns, layoutPanes, removalMap, reorder, visibleAxes, type PaneOptions } from './pane';
import { PaneControls, PANE_BUTTONS_BOTTOM, type PaneAction } from './pane-controls';
import { ATTRIBUTION_SIZE, createAttributionLoader, drawAttributionMark } from './attribution';
import { defaultChartFeatures, resolveFeatures, type ChartFeatures } from './features';
import { checkAccess, defaultAccessOptions, type AccessOptions } from './access';
import type { Watermark } from './watermark';
import type { DepthLane, DepthLaneOptions } from './depth-lane';
import type { RenderBackend } from './gl/backend';
import { GLRenderer, type ContextLossReason, type GpuOwner, type RendererEvents } from './gl/renderer';
import { devWarnOnce, isDev } from './util/dev';
import { budgetEntry, contextBudget, type ContextHolder } from './gl/context-budget';
import type { SharedSession } from './gl/shared';
import type { FramePhase, GpuMemory, RedrawReason, RenderStats } from './render-stats';
import { FramePacer } from './frame-pacing';
import {
  CandleSeries,
  changeText,
  CustomSeries,
  defaultFormat,
  HistogramSeries,
  LineSeries,
  reportSeriesError,
  scaleFormat,
  type CandleSeriesOptions,
  type CustomSeriesBaseOptions,
  type CustomSeriesDef,
  type HeatmapSeries,
  type HeatmapSeriesOptions,
  type HistogramSeriesOptions,
  type LineSeriesOptions,
  type LegendEntry,
  type PaneEnv,
  type Series,
  type SeriesErrorEvent,
  type FollowKind,
  type SeriesHost,
  type SeriesLevels,
  type PriceLineSeriesOptions,
  type SeriesPriceLineStyle,
} from './series';
import type { DrawingEvents, DrawingManager } from './drawing/manager';
import type { VolumeProfileOptions, VolumeProfileSeries } from './profile/series';
import {
  notInstalled,
  SHARED_CONTEXT,
  type ChartInternals,
  type HeatmapFeature,
  type OptInFeatures,
  type SelectionFeature,
} from './registry';
import type { PointItem, PointSeries, PointSeriesOptions } from './points';
import type { IndicatorEvents, IndicatorManager } from './indicators/manager';
import type { IndicatorSeries } from './indicators/series';
import type { Indicator } from './indicators/indicator';
import type { DataController, DataControllerOptions } from './data/controller';
import type { MarkersLoader, MarkersSource } from './data/marks';
import { HistoryGate } from './data/history-gate';
import type { Replay, ReplayState } from './replay';
import { prefersReducedMotion } from './pulse';
import { addLayer, createRoot, measureRoot, pixelRatioWatch, setRootBackground, sizeCanvas, watchInView } from './root-style';
import { PluginRegistry, type ChartPlugin, type FrameObserver } from './plugins';
import type { CompareMode, CompareState, CompareStyle, ComparePair } from './data/compare';
import type { DataEvents, DataSource, Interval, SourceMarker, SymbolInfo } from './data/types';
import { Emitter } from './util/emitter';
import { intervalSeconds, type DropReason } from './data/util';
import { isInterval, isTimeInterval, safeIntervalSeconds } from './data/interval';
import { ChartError } from './errors';
import {
  LAYOUT_STYLE_KEYS,
  type AppliedLayout,
  type ChartLayout,
  type LayoutLoadOptions,
  type LayoutLoadResult,
  type LayoutSerializeOptions,
} from './layout';
import {
  formatCrosshairTime,
  formatTickLabel,
  logPriceTicks,
  priceTicks,
  selectTimeTicks,
  TickWeight,
  type TimeTick,
} from './util/format';
import { Interaction } from './interaction';
import type { BaselineEvents } from './baseline-handle';
import {
  PrimitiveGuard,
  PrimitiveRegistry,
  resolvePrimitivePane,
  type AttachedPrimitive,
  type Primitive,
  type PrimitiveEnv,
  type PrimitiveHit,
  type PrimitiveLayer,
  type PrimitiveTarget,
} from './primitives';
import {
  Legend,
  defaultLegendSettings,
  legendEntryFor,
  legendHeight,
  resolveLegendSettings,
  type LegendAction,
  type LegendFrame,
  type LegendOptions,
  type LegendSettings,
} from './legend';
import { spreadLabels } from './util/labels';
import {
  chartPointAt,
  hitsValue,
  pointFor,
  snapPrice,
  type ChartPoint,
  type ChartPointerEvent,
  type CrosshairMode,
} from './pointer';
import { atTime, boundByTime } from './util/search';
import type { PriceBar } from './price-bars';
import { ChartDescription, defaultAccessibilityOptions, type AccessibilityOptions } from './a11y';
import type { Adjustment, AdjustmentMode } from './data/adjust';
import type { CaptureHost } from './capture';
import { buildExport, exportWithColumns, type DataTable, type ExportSource } from './export';
import type { AnnotationManager } from './annotations/manager';
import { defaultTickSize, snapToTick } from './annotations/lines';
import type { TradePointerEvent } from './annotations/trades';
import {
  SET_SOURCE_MARKS,
  SET_TIME_MARKS,
  type BarMarker,
  type ClusterClickEvent,
  type DraftEditEvent,
  type MarkerLeaveEvent,
  type MarkerPointerEvent,
  type OrderCreateEvent,
} from './annotations/types';
import { checkReferenceLines, type ReferenceLines, type ReferenceLinesUpdate } from './reference-lines';
import type { Bar, IndexRange, Point, Rect, Time } from './types';
import { parseColor, withAlpha } from './util/color';
import { zoneOf, type Zone } from './util/timezone';
import { ALWAYS_OPEN, compileSession, inSession, type CompiledSession, type SessionSchedule } from './util/session';
import type { MarketStatus } from './util/market';
import type { PriceFormatModel } from './util/price-format';
import { checkLocalization, englishLocalizer, type CoreMessageKey, type LocalizationOptions, type Localizer } from './util/locale';
import { fillNumerals, fillText, fontCss, measureNumerals, mergeTypography, resolveFont, type ResolvedFont, type TypographySurface } from './typography';
import { isNumber } from './util/records';
import { clampLow, clampNum, sharp } from './util/math';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** How grid lines are drawn: solid, dashed or dotted. */
export type GridLineStyle = 'solid' | 'dashed' | 'dotted';

/** One direction of the grid: vertical lines follow the time axis, horizontal ones the price axis. */
export interface GridLineOptions {
  visible: boolean;
  /** Defaults to the theme's `gridVertical` / `gridHorizontal`, then `grid`. */
  color?: string;
  lineStyle: GridLineStyle;
}

/** The `grid` chart option: horizontal and vertical lines, each set on its own. */
export interface GridOptions {
  horizontal: GridLineOptions;
  vertical: GridLineOptions;
}

/** Grid changes for `applyOptions`: each direction and field is optional. */
export interface GridOptionsPatch {
  horizontal?: Partial<GridLineOptions>;
  vertical?: Partial<GridLineOptions>;
}

/** One crosshair line. */
export interface CrosshairLineOptions {
  visible: boolean;
  /** Default: the theme's crosshair colour. */
  color?: string;
  /** Css px. Default 1. */
  width: number;
  /** Default `'dashed'`. */
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

/** Look and behaviour of the crosshair; see the `crosshair` chart option. */
export interface CrosshairOptions {
  /** How the crosshair follows the pointer; snapping applies in the main series' pane. */
  mode: CrosshairMode;
  vertical: CrosshairLineOptions;
  horizontal: CrosshairLineOptions;
  /** Draw the horizontal line, and its price labels, at the same price in every pane that shows it. */
  horizontalInAllPanes: boolean;
  /** The price labels on the price axes and the time label. */
  labels: { price: boolean; time: boolean };
  /** Time label on the time axis (`'bottom'`) or at the top of the plot. */
  timeLabelPosition: 'top' | 'bottom';
  /**
   * Whether the crosshair lines follow the pointer over the plot: `'cross'`
   * draws them, `'pointer'` leaves the platform's own pointer with no lines
   * but keeps the axis labels. These are the two choices because the lines
   * are the only thing that changes what the user sees; the pointer's shape
   * stays the platform's, so its size and contrast settings keep working.
   * While a drawing tool is armed the lines show. Default `'cross'`.
   */
  cursor: 'cross' | 'pointer';
}

/** Crosshair changes for `applyOptions`: every field is optional, including those of each line and of the labels. */
export type CrosshairOptionsPatch = Partial<Omit<CrosshairOptions, 'vertical' | 'horizontal' | 'labels'>> & {
  vertical?: Partial<CrosshairLineOptions>;
  horizontal?: Partial<CrosshairLineOptions>;
  labels?: Partial<CrosshairOptions['labels']>;
};

/**
 * The point a time zoom keeps fixed on screen: `'pointer'` the bar under the
 * pointer, `'newest'` the newest bar while it is on screen (the pointer
 * otherwise), `'right-edge'` the plot's right edge.
 */
export type ZoomAnchor = 'pointer' | 'newest' | 'right-edge';

/** Zoom anchors per input: `plot` for the wheel, pinch and `+` / `-` keys, `timeAxis` for dragging the time axis. */
export interface ZoomAnchorOptions {
  plot: ZoomAnchor;
  timeAxis: ZoomAnchor;
}

/** Options for `createChart` and `applyOptions`; `grid` and `crosshair` may be partial at any depth. */
export type ChartOptionsPatch = Omit<Partial<ChartOptions>, 'grid' | 'crosshair' | 'priceAxis' | 'timeAxis' | 'accessibility' | 'zoomAnchor' | 'access' | 'sketch'> & {
  /** Fields left out keep their current value; `null` lifts a rule. */
  access?: Partial<AccessOptions>;
  grid?: GridOptionsPatch;
  priceAxis?: Partial<PriceAxisOptions>;
  timeAxis?: Partial<TimeAxisOptions>;
  crosshair?: CrosshairOptionsPatch;
  sketch?: Partial<SketchGestureOptions>;
  accessibility?: Partial<AccessibilityOptions>;
  /** One anchor for every zoom input, or a partial per-input object. */
  zoomAnchor?: ZoomAnchor | Partial<ZoomAnchorOptions>;
  /**
   * Plugins installed when the chart is created, in order, such as the
   * opt-in features: `builtins()`, or some of `heatmap()`,
   * `volumeProfile()` and `drawingTools()`. Set at creation; `applyOptions`
   * ignores it (use `install` later).
   */
  plugins?: readonly ChartPlugin[];
};

/** The chart's resolved colors, as `chart.appearance()` reports them. */
export interface ChartAppearance {
  theme: ChartTheme;
  /** Grid with both colors resolved. */
  grid: { horizontal: Required<GridLineOptions>; vertical: Required<GridLineOptions> };
}

/** The `sketch` chart option: how the sketch gesture of `features.sketch` starts. */
export interface SketchGestureOptions {
  /**
   * How long (ms) a mouse or pen press must stay still before it starts a
   * sketch. On touch, the extra hold after the long-press shows the crosshair.
   * Applies from the next press. Default 500.
   */
  holdMs: number;
}

/** Price axis layout: auto-width sizing (`priceAxisWidth: 'auto'`), lines, font and label pills. */
export interface PriceAxisOptions {
  /** Space (css px) between the widest label and the outer edge of its column. Default 8. */
  padding: number;
  /** Narrowest column (css px). Default 48. */
  minWidth: number;
  /** Widest column (css px); unset for no limit. Labels wider than this are clipped. */
  maxWidth?: number;
  /** Short marks at each tick label, on the plot edge of its column. Default false. */
  ticks: boolean;
  /** The line between the plot and the price axes. Default true. */
  border: boolean;
  /** Font size (css px) of the price axis text and labels; unset for the theme's axis font. */
  fontSize?: number;
  /**
   * Width of the filled labels (last value, crosshair, drawings): `'fill'`
   * spans the axis column, `'content'` fits the text. Default `'fill'`.
   */
  labelMode: 'fill' | 'content';
  /** Give each filled label a point on its plot side, at its exact price. Default false. */
  labelPointer: boolean;
  /** Space (css px) above and below the text of a filled label. Default 4. */
  labelPaddingY: number;
}

/** Time axis layout and labels; `applyOptions` merges a partial one. */
export interface TimeAxisOptions {
  /** Show the time axis; hidden, its height goes to the plot. Default true. */
  visible: boolean;
  /** Height (css px). Default 28. */
  height: number;
  /** Short marks at each time label, under the plot edge. Default false. */
  ticks: boolean;
  /** The line between the plot and the time axis. Default true. */
  border: boolean;
  /** Time of day in the built-in crosshair and drawing time labels of intraday bars. Default true. */
  showTime: boolean;
  /** Seconds in the built-in time-of-day labels: axis ticks, the crosshair and drawings. Default false. */
  showSeconds: boolean;
  /** Font size (css px) of the time axis text and labels; unset for the theme's axis font. */
  fontSize?: number;
}

/**
 * Every chart option: theme, grid, axes, bar spacing and scroll limits,
 * built-in features, access rules and more. `createChart` and `applyOptions`
 * take them in part (`ChartOptionsPatch`); `defaultChartOptions` fills the
 * rest.
 */
export interface ChartOptions {
  theme: Partial<ChartTheme>;
  /**
   * What screen readers get: a summary of the chart (on by default) and an
   * optional live readout of the crosshair values. `applyOptions` merges a
   * partial object into the current one. See `chart.describe()`.
   */
  accessibility: AccessibilityOptions;
  /** Grid lines per direction; `applyOptions` merges a partial grid into the current one. */
  grid: GridOptions;
  /** Built-in UI and input switches; flags left out keep their current value (see `defaultChartFeatures`). */
  features: Partial<ChartFeatures>;
  /**
   * Which drawing tools and indicators users may add, and the indicator
   * limit, as `createChart` and `applyOptions` last set them.
   * `drawings.setAccess()` and `indicators.setAccess()` override the rule
   * for their kind until the next `applyOptions({ access: { allow } })`.
   */
  access: AccessOptions;
  /**
   * Width (css px) of one price axis column, or `'auto'` to fit each side's
   * columns to their widest label (see `priceAxis`). Default `'auto'`.
   */
  priceAxisWidth: number | 'auto';
  /**
   * How `priceAxisWidth: 'auto'` sizes the axis columns, the axis lines and
   * font, and the filled labels; `applyOptions` merges a partial one.
   */
  priceAxis: PriceAxisOptions;
  /** Time axis visibility, height, lines, font and time labels; `applyOptions` merges a partial one. */
  timeAxis: TimeAxisOptions;
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  rightOffset: number;
  /** The plot's left edge cannot go before the first bar; zooming out stops there too. */
  fixLeftEdge: boolean;
  /** The view cannot go further right than the newest bar plus `rightOffset`. */
  fixRightEdge: boolean;
  /** Most empty bars allowed right of the newest bar; unset for no limit. */
  maxRightOffset?: number;
  /** Share of the plot width (0 to 1) bars keep covering when panning towards either end, the same at every zoom. */
  minBarCoverage: number;
  /**
   * When the plot width changes, rescale the bar spacing so the same bars stay
   * visible, instead of keeping the spacing and showing more or fewer bars.
   */
  lockVisibleRangeOnResize: boolean;
  /**
   * When bars are appended: `'whenAtEnd'` scrolls with them while the newest
   * bar is on screen, `'always'` also scrolls back to it from older bars,
   * `'never'` keeps the same bars on screen.
   */
  followNewBars: 'always' | 'whenAtEnd' | 'never';
  /** Device-pixel-ratio cap for the WebGL layer (fill-rate on hi-dpi screens). */
  maxGlDpr: number;
  /**
   * `false` makes a static chart, for thumbnails and sparklines: no pointer,
   * wheel, touch or keyboard input, no crosshair, no animations, and it holds
   * a WebGL context only while it draws. After each drawing settles, the GPU
   * layer is copied into a 2D canvas and the context is given back (the
   * `context:lost` / `context:restored` events say `'budget'`), so many static
   * charts fit within the browser's context limit. New data, options or a new
   * size take a context back for one more drawing. Set at creation; default true.
   */
  interactive: boolean;
  /**
   * `'shared'` draws through one WebGL context shared by every chart created
   * with it, instead of one context per chart (`'own'`, the default), so a page
   * can have any number of charts within the browser's context limit. Each
   * chart draws into a hidden shared canvas and copies the result into its
   * own 2D canvas. Needs the `sharedContext()` plugin in the creation
   * `plugins` (`builtins()` has it); without it the chart gets its own
   * context and `gl` reads `'own'`. Set at creation.
   */
  gl: 'own' | 'shared';
  /**
   * Whether the chart is in the page's Tab order (`tabIndex` 0). `false`
   * leaves it out (`tabIndex` -1); a click still focuses it, so keyboard
   * shortcuts keep working for a chart the user clicked. Default true.
   */
  focusable: boolean;
  /** Momentum after drag-panning. */
  inertia: boolean;
  /** Animate mouse-wheel zoom and scroll steps. */
  smoothZoom: boolean;
  /**
   * What the plain mouse wheel does: `'zoom'` zooms time, `'pan'` scrolls it,
   * `'page'` leaves it to the page (for charts in a scrolling page).
   * Ctrl/⌘+wheel zooms and Shift+wheel pans in every mode. Default `'zoom'`.
   */
  wheel: 'zoom' | 'pan' | 'page';
  /**
   * What a time zoom keeps fixed: `plot` for the wheel, pinch and `+` / `-`
   * keys, `timeAxis` for dragging the time axis. `'pointer'` keeps the bar
   * under the pointer (the press point for a time-axis drag; the keys, which
   * have no pointer, use the right edge), `'newest'` the newest bar while it
   * is on screen and the pointer otherwise, `'right-edge'` the plot's right
   * edge. `applyOptions` takes one anchor for both or a partial object.
   * Default `{ plot: 'pointer', timeAxis: 'right-edge' }`.
   */
  zoomAnchor: ZoomAnchorOptions;
  /**
   * Where keyboard shortcuts work: `'focus'` (default) while the chart has
   * focus, `'hover'` also while the pointer is over it, `'global'` anywhere on
   * the page. Keys typed into an input or editable element, or inside a
   * dialog, are left alone.
   */
  keyboard: { scope: 'hover' | 'focus' | 'global' };
  /**
   * The vertical part of a plot drag rescales the pane's main price scale and
   * turns its autoscale off, like dragging the axis. Needs the
   * `axisDragScale` feature. Default false.
   */
  plotDragScale: boolean;
  /** Ease price-scale range changes instead of jumping. */
  smoothScale: boolean;
  /** Animate programmatic view changes (scroll to latest, fit, ranges). */
  animateViewChanges: boolean;
  /**
   * Keep drawing while the chart is scrolled out of view or its page is in a
   * background tab. Off by default: a hidden chart keeps its data, view and
   * events current but draws nothing, and draws once, with animations at their
   * end, when it is shown again. `captureImage` and `resize` draw either way.
   */
  renderWhenHidden: boolean;
  /** Floating button that scrolls back to the newest bar. */
  scrollButton: boolean;
  /**
   * Legend settings: position, mode, change, idle values and a formatter (see
   * `LegendOptions`). `chart.options.legend` mirrors the resolved settings,
   * with `visible` from `features.legend`.
   */
  legend: LegendOptions;
  /** Per-pane buttons (move, maximize, collapse, remove) on hover. */
  paneButtons: boolean;
  /**
   * Double-clicking a pane's plot maximizes it, or restores the others,
   * like its maximize button. Default true: every double-click on a chart
   * region resets that region's prominent state (the time axis scrolls to
   * the newest bar, a price axis turns autoscale back on), so the plot's
   * toggles its pane. Single-pane charts and double-clicks a drawing
   * handles are left alone; `plot:dblclick` still fires.
   */
  paneDoubleClickMaximize: boolean;
  /**
   * Reading direction the defaults follow. In `'rtl'` the main price scale's
   * axis is on the left (unless `setPriceScaleOptions` picks a `side`), the
   * legend's `start` corners are on the right, and the pane buttons and the
   * scroll-to-newest button on the left. Time still runs left to right.
   * `'auto'` (the default) reads the container's computed `direction` when the
   * chart is created and on each `applyOptions`.
   */
  direction: ChartDirection;
  /** Bars from the left edge that trigger a `history:request` event. */
  historyThreshold: number;
  /**
   * IANA timezone for axis labels, the crosshair and the countdown, e.g.
   * 'America/New_York', or `'local'` (the default) for the machine's timezone.
   */
  timezone: string;
  /**
   * Show each symbol loaded through the data source in its own timezone
   * (`SymbolInfo.timezone`), or in `timezone` when it has none. Setting
   * `timezone` with `applyOptions` while this is on keeps that timezone for
   * later symbols too, until this option is set to true again. Default false.
   */
  applySymbolTimezone: boolean;
  /**
   * Trading hours in `timezone`: weekly ranges, holidays and one-day overrides.
   * Day, month and year boundaries follow its trading days. Default `ALWAYS_OPEN`.
   */
  session: SessionSchedule;
  /** Dashed line where each trading day starts on intraday charts with a session. */
  sessionBreaks: boolean;
  /** Shade bars outside the session. */
  sessionShading: boolean;
  /**
   * Keep the visible start and end times when `setSymbol` changes only the
   * interval (a view reaching the newest bar keeps the newest bar): older
   * history pages in, one page per task, until the range is covered, then the
   * view fits it. Too long a range for the minimum bar spacing keeps its right
   * edge, and pages in only the bars that fit.
   */
  keepRangeOnIntervalChange: boolean;
  /**
   * Keep the zoom (the bar spacing) when `setSymbol` loads another symbol: it
   * opens at its newest bars with the same number of bars in view, and pages
   * in older history when the view is wider than the first load. Off, the new
   * symbol opens at the default zoom with every pane autoscaled, like
   * `resetView`.
   */
  keepZoomOnSymbolChange: boolean;
  /**
   * Back-adjust the data source's bars for corporate actions from its
   * `adjustments`: `'splits'` for splits only, `'all'` for dividends and
   * other actions too. Older bars are scaled so they compare with newer ones;
   * switching refetches nothing and keeps the view. Default `'none'`.
   */
  adjustment: AdjustmentMode;
  /**
   * Mark the corporate actions the data source reports (`adjustments`) on
   * the main series, in the bottom lane of its pane, whatever `adjustment`
   * applies. The markers' `kind` is the action's, so `setMarkerFilter` can
   * select them. Default true.
   */
  adjustmentMarkers: boolean;
  /**
   * Draw the data source's markers placed on bars (`DataSource.markers`) on
   * the main series. With `timeMarks` also off, none are fetched and
   * `sourceMarkers` is empty. Default true.
   */
  marks: boolean;
  /**
   * Draw the data source's `timeAxis` markers in their band under the time
   * labels; off, the band goes too. With `marks` also off, none are fetched.
   * Default true.
   */
  timeMarks: boolean;
  /**
   * Extended trading hours (pre- and post-market) around the regular `session`,
   * in `timezone`. Only used for the market phase; unset means none.
   */
  extendedSession?: SessionSchedule;
  /** Badge in the main pane's legend with the market phase and the data delay. Needs the `marketStatus()` plugin. */
  marketStatus: boolean;
  /**
   * Touch long-press: the crosshair follows the finger and the chart does not
   * pan. `'release'` ends it when the finger lifts, `'tap'` keeps the
   * crosshair until the next tap, `'off'` turns the long-press off.
   */
  touchInspect: 'release' | 'tap' | 'off';
  /** Crosshair mode, lines, labels and placement; `applyOptions` merges a partial one. */
  crosshair: CrosshairOptions;
  /** The sketch gesture's hold time; `applyOptions` merges a partial one. */
  sketch: SketchGestureOptions;
  /**
   * Language of numbers, dates and built-in text: a `locale` for `Intl`, a
   * decimal mark and hour cycle of your own, and message overrides or a
   * `translate` hook. `applyOptions` merges a partial object into the current
   * one; a `messages` object there replaces the previous one. Default `{}`: the built-in English
   * formats. See `chart.localization` and `localization:change`. Takes effect
   * with the `localization()` plugin; without it the option is only checked
   * and the chart keeps the built-in English.
   */
  localization: LocalizationOptions;
  /**
   * Crosshair time label; `intervalSec` is the bar interval. Defaults to the
   * date for daily and longer bars, else date and time, in `timezone`.
   */
  formatTime?: (time: Time, intervalSec: number) => string;
  /**
   * Time-axis label at a boundary of `weight` (`TickWeight`: minute up to year).
   * Defaults to the year, month, day or `hh:mm`, in `timezone`.
   */
  formatTimeTick?: (time: Time, weight: number) => string;
  /**
   * Draw several bars as one when zoomed out far, so any number of bars fits
   * the plot: zooming can go past `minBarSpacing` and bars group so no
   * bucket is narrower than about two device pixels. `{ mode: 'pixel' }`
   * groups `2^level` bars at a time; `{ mode: 'calendar', steps? }` groups by
   * the finest calendar period that fits (1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M, or
   * `steps`), following the timezone and session, so a grouped bar looks like
   * the bar of that interval. Candles merge into one bar (first open, highest
   * high, lowest low, last close), histograms by their `groupBy`. Null (the
   * default) draws every bar. See `chart.grouping`. Needs the `grouping()`
   * plugin; without it the option is kept and checked, but bars draw singly.
   */
  grouping: GroupingOptions | null;
  /**
   * Previous close, visible high/low/average, bid/ask and extended-hours lines,
   * merged per line; all are off by default. They need the `referenceLines()`
   * plugin: with it, `chart.options.referenceLines` is the resolved
   * `chart.referenceLines.options`, not the last patch; without it, the patches
   * merged per line, kept for a later install. An unknown line or line style
   * throws either way.
   */
  referenceLines?: ReferenceLinesUpdate;
  /**
   * Measure every frame: GPU draw calls, instances and uploads, CPU time per
   * phase and GPU memory, reported by `chart.frameStats` and the `frame:render`
   * event. Needs the `statsOverlay()` plugin (or `builtins()`). Off by default;
   * while off, frames make no timing calls.
   */
  renderStats: boolean;
  /**
   * Show the render statistics on the chart: a small panel in the bottom-left
   * corner of the lowest pane with a sparkline of recent frame times and the
   * last frame's counters, GPU time and memory. `'bounds'` also outlines the
   * panes, axis columns, lanes and time axis, and shades where the pointer
   * would grab each drawing. Measures frames while on, as
   * `renderStats` does. Needs the `statsOverlay()` plugin (or `builtins()`).
   * Off (`false`) by default.
   */
  renderStatsOverlay: boolean | 'bounds';
  /**
   * Spend less GPU and battery, for machines without a dedicated GPU: no
   * decorative animations (forming-bar tween, eased zoom, price-scale and view
   * easing, the last-point pulse ring), the WebGL layer at most at pixel ratio
   * 1, heatmaps sampled at one cell per pixel, and at most 20 frames a second
   * while there is no input. Data and drawings show as before. Independent of
   * `prefers-reduced-motion`, which still applies when this is off. See
   * `chart.frameTime` and the `frame:slow` event for offering it. Default false.
   */
  lowPower: boolean;
}

/** The `direction` chart option: left to right, right to left, or the container's. */
export type ChartDirection = 'ltr' | 'rtl' | 'auto';

/** Default values for `ChartOptions`, used for every option `createChart` is not given. */
export const defaultChartOptions: ChartOptions = {
  theme: {},
  grid: { horizontal: { visible: true, lineStyle: 'solid' }, vertical: { visible: true, lineStyle: 'solid' } },
  features: {},
  access: defaultAccessOptions,
  priceAxisWidth: 'auto',
  priceAxis: { padding: 8, minWidth: 48, ticks: false, border: true, labelMode: 'fill', labelPointer: false, labelPaddingY: 4 },
  timeAxis: { visible: true, height: 28, ticks: false, border: true, showTime: true, showSeconds: false },
  // The narrowest whole spacing at which a body (`bodyRatio` 0.7) loses nothing to rounding at 1x and 2x
  // pixel ratio and keeps the wick's parity: body 7 + gap 3 px at 1x, 14 + 6 at 2x.
  barSpacing: 10,
  // One device pixel per bar at 2x pixel ratio; any narrower and bars overlap (grouping goes further).
  minBarSpacing: 0.5,
  // The narrowest spacing at which a body (`bodyRatio` 0.7) is a 44 css px pointer target (WCAG target
  // size), ceil(44 / 0.7): wider bars add no detail, only fewer bars on screen.
  maxBarSpacing: 63,
  // The forming bar's right half plus a 44 css px pointer target (WCAG target size) for drawings
  // anchored just ahead of it, at the default spacing: ceil(0.5 + 44 / 10).
  rightOffset: 5,
  fixLeftEdge: false,
  fixRightEdge: false,
  // Bars cover at least half the plot, so the data stays the larger part of the view and its end
  // never passes the middle; a share keeps that the same at every zoom.
  minBarCoverage: 0.5,
  lockVisibleRangeOnResize: false,
  followNewBars: 'whenAtEnd',
  maxGlDpr: 2,
  interactive: true,
  gl: 'own',
  accessibility: defaultAccessibilityOptions,
  focusable: true,
  inertia: true,
  smoothZoom: true,
  wheel: 'zoom',
  zoomAnchor: { plot: 'pointer', timeAxis: 'right-edge' },
  keyboard: { scope: 'focus' },
  plotDragScale: false,
  smoothScale: true,
  animateViewChanges: true,
  renderWhenHidden: false,
  scrollButton: true,
  legend: { visible: true, ...defaultLegendSettings },
  paneButtons: true,
  paneDoubleClickMaximize: true,
  direction: 'auto',
  historyThreshold: 20,
  timezone: 'local',
  localization: {},
  applySymbolTimezone: false,
  session: ALWAYS_OPEN,
  sessionBreaks: true,
  sessionShading: false,
  keepRangeOnIntervalChange: false,
  keepZoomOnSymbolChange: true,
  adjustment: 'none',
  adjustmentMarkers: true,
  marks: true,
  timeMarks: true,
  marketStatus: true,
  touchInspect: 'release',
  renderStats: false,
  renderStatsOverlay: false,
  lowPower: false,
  crosshair: {
    mode: 'free',
    vertical: { visible: true, width: 1, lineStyle: 'dashed' },
    horizontal: { visible: true, width: 1, lineStyle: 'dashed' },
    horizontalInAllPanes: false,
    labels: { price: true, time: true },
    timeLabelPosition: 'bottom',
    cursor: 'cross',
  },
  sketch: { holdMs: 500 },
  grouping: null,
  referenceLines: {},
};

/** The `grouping` chart option. */
export interface GroupingOptions {
  /**
   * `'pixel'`: group by powers of two so a bucket is about two device pixels
   * wide. `'calendar'`: group by calendar periods (see `steps`).
   */
  mode: 'pixel' | 'calendar';
  /** Calendar mode: the periods to pick from, finest that fits wins. Default 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M. */
  steps?: Interval[];
}

/** How the view groups bars right now; see `chart.grouping`. */
export interface GroupingState {
  /** Pixel mode: bars per bucket is `2 ** level`. 0 in calendar mode. */
  level: number;
  /** Bars per bucket: exact in pixel mode, the average over the data in calendar mode. */
  bars: number;
  /** Calendar mode: the period each bucket covers. */
  step?: Interval;
}

/** The crosshair's point; `locked` while `lockCrosshair` holds it. */
export type CrosshairEvent = ChartPoint & { locked: boolean };

/**
 * What `chart.captureImage` captures and how: the layers to include, image
 * type and scale, background, padding, theme and an optional caption.
 */
export interface ScreenshotOptions {
  /** Paint the series legend onto the image. Default: follows the `legend` feature flag. */
  legend?: boolean;
  /** Include the crosshair and its labels. Default false. */
  crosshair?: boolean;
  /** Image MIME type passed to `canvas.toBlob`. Default: `image/png`. */
  type?: string;
  /** Encoder quality from 0 to 1 for lossy types such as `image/jpeg` or `image/webp`. */
  quality?: number;
  /**
   * Image pixels per CSS pixel. Default: the device pixel ratio. Above it the chart is redrawn at
   * this ratio for the capture and the screen is restored afterwards, so `scale: 2` gives a sharp
   * image from a standard display. Lowered so that no side exceeds 8192 pixels.
   */
  scale?: number;
  /** Include the watermark. Default true (it shows when the chart shows it). */
  watermark?: boolean;
  /** Include drawings. Default true. */
  drawings?: boolean;
  /** Include annotations: markers, price lines, trade lines and their axis labels. Default true. */
  annotations?: boolean;
  /**
   * What fills the image behind the chart: a CSS color, or `'transparent'` for an image with an
   * alpha channel (PNG or WebP; JPEG has none and shows black). Default: the theme background.
   * A color the chart cannot read falls back to the theme background.
   */
  background?: string;
  /** Empty margin around the chart in CSS pixels, filled with the background. Default 0. */
  padding?: number;
  /**
   * Draw the image in another theme: a whole `ChartTheme`, or `'light'` / `'dark'` for the built-in
   * light and dark themes with the chart's own fonts. The screen keeps its theme: the capture swaps
   * it and puts it back in the same task, before the browser paints, also when drawing fails.
   * No `theme:change` event is emitted. Default: the chart's theme.
   */
  theme?: ChartTheme | 'light' | 'dark';
  /**
   * A header line above the chart. `true`: the symbol, the interval, the newest bar's values and
   * the export time in the chart timezone. A string: that text instead. Default false.
   */
  caption?: boolean | string;
}

/** What a screenshot in progress draws; see `ScreenshotOptions`. */
interface Capture {
  watermark: boolean;
  drawings: boolean;
  annotations: boolean;
  /** The layers' own background: the theme's, or `'transparent'` when the image paints it once. */
  background: string;
  /** The screen's pixel ratio, which pixel grouping keeps while the layers are redrawn larger. */
  dpr: number;
}

/** Where the view may go; see `chart.setViewportBounds`. Times are unix seconds. */
export interface ViewportBounds {
  /** The plot shows only bars from `from` to `to`; either end may be left open. */
  time?: { from?: Time; to?: Time };
  /** One price scale (default: the main pane's right one) shows only prices from `low` to `high`. */
  price?: { low?: number; high?: number; pane?: number; scale?: string };
  /** Keep the bounds when `setSymbol` changes the symbol or interval. Default false. */
  keepOnContextChange?: boolean;
}

/** A view change from code that the viewport bounds narrowed: times for `time`, prices for `price`. */
export type ViewportClampEvent =
  | { axis: 'time'; requested: { from: Time; to: Time }; applied: { from: Time; to: Time } }
  | { axis: 'price'; pane: number; scale: string; requested: { from: number; to: number }; applied: { from: number; to: number } };

/** Payload of `plus:click`: where the user asked to act. */
export interface PlusButtonEvent {
  /** The price at the button, snapped to the tick size (as dragged trade lines are). */
  price: number;
  pane: number;
  /** Id of the price scale the price was read from (the pane's main scale). */
  scale: string;
  /** The button's centre in chart-root css px, e.g. to anchor a menu. */
  x: number;
  y: number;
}

/** A symbol plotted next to the main one; see `chart.compare`. */
export interface ComparedSymbol {
  /** The symbol, or a pair's name (`'A/B'`, `'A-B'`). */
  readonly symbol: string;
  /** The ratio or spread it shows, or null for a plain symbol. */
  readonly pair: ComparePair | null;
  /** Where it is drawn; change it with `setMode`. */
  readonly mode: CompareMode;
  readonly style: CompareStyle;
  /** The line of closes, or with `style` candles or bars a candle series; restyle it with `applyOptions`. */
  readonly series: LineSeries | CandleSeries;
  /** Symbol info once loaded (for a pair, its first symbol's), else null. */
  readonly info: SymbolInfo | null;
  /** Settles when the first load finishes; failures are reported as `compare:error`. */
  readonly ready: Promise<void>;
  serialize(): CompareState;
  /**
   * Move it to another mode, keeping its series, bars, legend row and this
   * handle: `percent` (lines only) overlays the main pane in percent, `scale`
   * gives it its own left axis there, `pane` its own pane. Leaving the main
   * pane remembers its row's place, and coming back to `pane` mode puts the
   * pane back where it was, at its height. Fires `panes:change`, never
   * `series:remove` or `series:add`; percent mode switches the main scale
   * as `compare` does, and the last percent comparison to leave gives it
   * its mode back. Does nothing once removed.
   */
  setMode(mode: CompareMode): void;
  /** Remove the line (and its pane) and unsubscribe from the data source. */
  remove(): void;
}

/**
 * A message in the main pane: see `setStatus`. `message` replaces the default
 * text; `detail` is not shown, e.g. the raw error message of a failed load.
 */
export interface ChartStatus {
  kind: 'loading' | 'no-data' | 'error' | 'unknown-symbol' | 'expired' | 'reconnecting' | 'stale';
  message?: string;
  detail?: string;
}

/** `status:change`: the in-pane status was set or cleared. */
export interface StatusChangeEvent {
  /** The new status; null when it was cleared. */
  status: ChartStatus | null;
  /** Hide the chart's own text for this status, e.g. to show your own loading or empty view instead. */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

/** How a notification reads: neutral, a finished action, or a failure. */
export type NotificationKind = 'info' | 'success' | 'error';

/** A short message for the user: see `chart.notify`. */
export interface ChartNotification {
  message: string;
  /** Default `'info'`. */
  kind?: NotificationKind;
  /** How long the message stays, in ms; 0 keeps it until dismissed. Default 5000. */
  durationMs?: number;
}

/** The `ui:notify` payload: the notification with its defaults filled in. */
export interface NotifyEvent {
  message: string;
  kind: NotificationKind;
  durationMs: number;
  /** Stop the UI package's toast, e.g. to show the message your own way. */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

const NOTIFY_DURATION = 5000;

/** Events that count as input for the idle frame cap of `lowPower`. */
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;

const STATUS_TEXT: Record<ChartStatus['kind'], CoreMessageKey> = {
  loading: 'statusLoading',
  'no-data': 'statusNoData',
  error: 'statusError',
  'unknown-symbol': 'statusUnknownSymbol',
  expired: 'statusExpired',
  reconnecting: 'statusReconnecting',
  stale: 'statusStale',
};

/** A price scale's mode and autoscale state, as reported by the `scale:change` event. */
export interface PriceScaleState {
  pane: number;
  /** Scale id in the pane (`'right'`, `'left'` or your own). */
  scale: string;
  mode: PriceScaleMode;
  autoScale: boolean;
  invert: boolean;
  /**
   * The scale is in log mode and its visible data has no values above zero,
   * so it cannot fit them and keeps its last range.
   */
  noPositiveData: boolean;
  /** The range autoscale shows instead of fitting the data, or null. */
  fixedRange: { min: number; max: number } | null;
  /** Zooming time scales prices too, keeping angles. */
  lockPriceToBarRatio: boolean;
}

/** Settings of one price scale; see `setPriceScaleOptions`. */
export interface PriceScaleSettings {
  /** Axis side; `'none'` overlays the pane with no visible axis. */
  side: PriceScaleSide;
  mode: PriceScaleMode;
  /** Higher prices lower down. */
  invert: boolean;
  autoScale: boolean;
  /**
   * Fractions of the pane height kept empty above and below the data. A side
   * the chart sizes itself (see `addPane`) is left out when read; set `null`
   * to give a side back to the chart.
   */
  marginTop?: number | null;
  marginBottom?: number | null;
  /**
   * While autoscale is on, show exactly this price range instead of fitting
   * the data, e.g. `{ min: 0, max: 100 }` for an oscillator pane. Null fits the data.
   * Prices in every mode (percent and indexed too). Setting one at or below
   * zero on a log scale throws; switching to log keeps it but ignores it
   * (the data is fitted) until the scale leaves log mode.
   */
  fixedRange: { min: number; max: number } | null;
  /**
   * What percent and indexed modes measure from (default `'firstVisible'`):
   * `'sessionOpen'`, the open of the trading day holding the newest visible
   * bar; `'previousClose'`, the close before that day; `{ time }`, the close of
   * the first bar at or after `time`, marked on the time axis. Every series on
   * the scale, and compared symbols linked to it, measure from the same bar.
   */
  percentBase: PercentBase;
  /**
   * Adjust the range fitted to the data: keep a price centred (`centerOn`),
   * always reach some prices (`include`) and fit at least a span (`minSpan`).
   * Prices in every mode; `fixedRange` wins. Null fits the data as it is.
   */
  autoscaleRule: AutoscaleRule | null;
  /**
   * Zooming the time axis scales prices by the same factor, so angles of
   * lines and drawings stay put, also through `fitContent` and the visible
   * range setters. Turns autoscale off; turning autoscale on (including
   * `setPriceScaleMode` and `resetView`) unlocks it.
   */
  lockPriceToBarRatio: boolean;
  /**
   * The locked ratio: price-scale coordinate units per bar width (log10
   * units in log mode). Read it to save it, pass it back to restore it.
   * Null while unlocked, or locked but not laid out yet; with
   * `lockPriceToBarRatio: true`, null locks at the current ratio.
   */
  priceToBarRatio: number | null;
}

/**
 * What a `state:change` is about: the parts of a saved layout
 * (`serializeLayout`), plus the theme and grid (`'options'`) and the visible
 * range (`'viewport'`, which changes on every pan and zoom).
 */
export type StateChangeReason = 'drawings' | 'indicators' | 'series' | 'panes' | 'symbol' | 'options' | 'viewport';

/** Reasons a `state:change` can still have while a loaded layout's symbol loads: they can only come from the user or the app. */
const EDIT_REASONS: ReadonlySet<StateChangeReason> = new Set(['drawings', 'indicators', 'series']);

/**
 * Events emitted by the chart, by name, with their payloads: pointer and
 * crosshair input, view and scale changes, data loading, drawings, indicators,
 * errors and more. Subscribe with `chart.on`.
 */
export interface ChartEvents extends DrawingEvents, DataEvents, IndicatorEvents, BaselineEvents {
  /**
   * Something worth saving changed: drawings, indicators, the main series
   * style, panes or price scales, the symbol or interval (once loaded), the
   * theme or grid, or the visible range. Loading never fires it:
   * `loadLayout` (until its `ready` settles), `drawings.load` and
   * `indicators.load` are quiet. Edits made while a layout's symbol loads are
   * reported once it has. Fires once per change; debounce before saving, or
   * use `autosave`.
   */
  'state:change': { reason: StateChangeReason };
  'crosshair:move': CrosshairEvent | null;
  /** A price scale's mode, inversion or autoscale flag changed. */
  'scale:change': PriceScaleState;
  /**
   * Something that moves chart coordinates changed: pan, zoom, resize, pane
   * layout, a price scale's range or mode, or the bars. Fires at most once
   * per frame, after it is drawn; re-place HTML positioned with
   * `coordinateFor` and friends. `fromIndex`/`toIndex` are the fractional
   * logical indices at the plot edges; `rightOffset` is the space after the
   * last bar, in bars; `from`/`to` the times of the first and last visible
   * bar, as `getVisibleRange` gives them (null without bars).
   */
  'view:change': { barSpacing: number; fromIndex: number; toIndex: number; rightOffset: number; from: Time | null; to: Time | null };
  /**
   * `setSymbol` (or a layout load) switched to another symbol. Fires once per
   * accepted switch, before its load starts; `data:*` events follow the load.
   * `previous` is null on the first symbol.
   */
  'symbol:change': { symbol: string; previous: string | null };
  /** The time axis timezone changed: the `timezone` option, or the symbol's own with `applySymbolTimezone`. */
  'timezone:change': { timezone: string; previous: string };
  /** `chart.localization` was replaced: by `applyOptions({ localization })`, or by installing or uninstalling the `localization()` plugin; `locale` is its `locale` option. */
  'localization:change': { locale: string | undefined };
  /**
   * A series joined the chart: any `add*` call, a compared symbol, or an
   * indicator's series (with its `indicator`).
   */
  'series:add': { series: Series; indicator: Indicator | null };
  /** `series.applyOptions` changed a series; `patch` is what was passed. */
  'series:options': { series: Series; patch: object };
  /** The chart's size changed (css px). */
  'chart:resize': { width: number; height: number };
  /** `destroy()` was called; the chart is still intact while listeners run. */
  'chart:destroy': Record<string, never>;
  /** `applyOptions({ theme })` changed the resolved theme. */
  'theme:change': { theme: ChartTheme };
  /** `setVisibleTimeRange`, `fitContent`, `scrollToRealtime` or `resetView` asked for more than the viewport bounds allow. */
  'viewport:clamp': ViewportClampEvent;
  /** The view started or stopped grouping bars, or changed how many per bucket; see `chart.grouping`. */
  'grouping:change': GroupingState | null;
  /** Viewport neared the oldest bar: prepend older data to the main series. */
  'history:request': { before: Time };
  /**
   * Panes were added, removed, reordered, resized, maximized, collapsed or hidden.
   * `heights` are normalized stretch weights (see `getPaneHeights`).
   */
  'panes:change': { heights: number[]; maximized: number; collapsed: boolean[]; hidden: boolean[] };
  /** A custom series hook threw. The series is skipped for that frame; reported once until the hook succeeds again. */
  'series:error': SeriesErrorEvent;
  /** Press and release in a plot without dragging, unless a drawing took the press. */
  'plot:click': ChartPointerEvent;
  /**
   * Right click (or the keyboard menu key) on a plot, an axis or a drawing, or
   * a touch long press on a plot with `touchInspect: 'off'`. While the
   * `contextMenu` feature is on and this event has a listener, the browser's
   * own menu is suppressed.
   */
  'chart:contextmenu': ChartContextMenuEvent;
  /** Double-click in a plot, unless a drawing handled it (e.g. text editing). */
  'plot:dblclick': ChartPointerEvent;
  /** A compared symbol failed to load; `error` is as in `data:error`. */
  'compare:error': { symbol: string; error: ChartError };
  /**
   * An event listener threw (code `'listener-failed'`, the thrown error as
   * `cause`, the event name in `context.event`). The other listeners and the
   * frame still ran. Without a listener here the error is logged instead.
   */
  'chart:error': { error: ChartError };
  /** The pointer moved onto a different series (or off all of them). */
  'series:hover': SeriesHoverEvent;
  /** What is selected changed: drawings, an indicator or nothing (see `getSelection`). */
  'selection:change': { selection: ChartSelection };
  /** The pointer entered a fill marker (`annotations.setTrades`), or tapped it on touch. */
  'trade:hover': TradePointerEvent;
  /** The pointer left the fill marker. */
  'trade:hover-end': Record<string, never>;
  /** A fill marker was clicked or tapped. While this has listeners, markers take presses instead of panning. */
  'trade:click': TradePointerEvent;
  /** The pointer entered a bar marker (`annotations.setMarkers`), or tapped it on touch. */
  'marker:hover': MarkerPointerEvent;
  /** The pointer left the bar marker. */
  'marker:hover-end': MarkerLeaveEvent;
  /** A bar marker was clicked or tapped. While this has listeners, markers take presses instead of panning. */
  'marker:click': MarkerPointerEvent;
  /**
   * A data source marker (`DataSource.markers`) was clicked or tapped, on
   * its bar or on the time axis: copies of the marker, or of the markers
   * folded into it or its badge, and the pointer in chart-root css px. In the
   * `sourcemarkers:*` family with the getter's other events. While this has
   * listeners, markers take presses instead of panning and badges instead of
   * the axis drag.
   */
  'sourcemarkers:click': { markers: SourceMarker[]; point: Point };
  /**
   * A cluster of folded order labels was clicked (see `annotations.applyOptions({ overlap: 'cluster' })`),
   * after its `onClusterClick`. The UI package lists the orders unless `defaultPrevented`.
   */
  'annotations:cluster': ClusterClickEvent;
  /**
   * A draft's quantity or type was clicked (see `annotations.startOrderDraft`).
   * The UI package opens a keypad or a type menu unless `defaultPrevented`.
   */
  'draft:edit': DraftEditEvent;
  /** A draft was committed: place this order, then show it with `addTradeLine`. */
  'order:create': OrderCreateEvent;
  /**
   * `setStatus` set or cleared the in-pane status (the data source sets it
   * while loading, for no data and for errors). A listener that calls
   * `preventDefault()` hides the chart's own text for that status.
   */
  'status:change': StatusChangeEvent;
  /** `chart.notify` was called. The UI package shows a toast unless `defaultPrevented`. */
  'ui:notify': NotifyEvent;
  /**
   * A bar or point was left out: older than the series' last one in `update`
   * or from a live feed, invalid data from a data source, or a duplicate time
   * removed by `setData(..., { normalize: true })` or a source load.
   */
  'data:dropped': DataDroppedEvent;
  /**
   * The GPU context was lost; the series stop drawing until it is restored.
   * `reason` is `'budget'` when the chart gave it up for the page's context
   * budget (see `setContextBudget`), `'browser'` for a driver reset or the
   * browser's own context limit.
   */
  'context:lost': { reason: ContextLossReason };
  /** The GPU context is back and the chart redraws. */
  'context:restored': { reason: ContextLossReason };
  /** The GPU context came back but could not be set up; the series stay blank. Recreate the chart to recover. */
  'context:restore-failed': { error: ChartError };
  /** A frame was drawn, with what it cost. Only fires while the `renderStats` or `renderStatsOverlay` option is on, with the `statsOverlay()` plugin. */
  'frame:render': RenderStats;
  /**
   * Frames have kept coming slower than about 29 a second for a while
   * (`frameTime` is the smoothed gap in ms), so the app may offer the
   * `lowPower` option. Fires once per slow spell, and not while `lowPower` is on.
   */
  'frame:slow': { frameTime: number };
  /** `applyOptions` changed the theme or the grid; the payload is `chart.appearance()`. Persist on this. */
  'appearance:change': ChartAppearance;
  /** A series was shown or hidden: `setVisible` with a new value, or a legend row's eye button. */
  'series:visibility': { series: Series; visible: boolean };
  /**
   * A legend row's settings button was pressed; open your settings UI. The
   * button only shows while something listens for this event.
   */
  'series:settings': { series: Series; indicator: Indicator | null };
  /**
   * The "+" button by the crosshair price label was pressed. The button only
   * shows while this has a listener (and `features.plusButton` is on).
   */
  'plus:click': PlusButtonEvent;
  /** A series left the chart: `removeSeries`, its indicator or pane removed, or a legend remove button. */
  'series:remove': { series: Series; indicator: Indicator | null };
  /** A bar replay started, stepped, played, paused, changed speed or stopped; see `chart.replay`. */
  'replay:change': ReplayState;
}

/** Payload of `data:dropped`: a bar or point left out of a series, and why (older than the last one, invalid or a duplicate time). */
export interface DataDroppedEvent {
  reason: DropReason;
  /** The bar, point or custom item that was left out; `{ time, column }` for a heatmap column. */
  bar: unknown;
  /** The series it was meant for; null when no main series exists yet. */
  series: Series | null;
}

/** What a `chart:contextmenu` event was opened on; `'legend'` is a legend row (its "More" button, right click or long-press). */
export type ContextMenuTarget = 'plot' | 'priceAxis' | 'timeAxis' | 'drawing' | 'legend';

/** Where a context menu was asked for, and what is there. */
export interface ChartContextMenuEvent {
  target: ContextMenuTarget;
  /** Chart-root css px. */
  x: number;
  y: number;
  /** Viewport px, for placing a popup. */
  clientX: number;
  clientY: number;
  /** Pane under the pointer; -1 on the time axis. */
  pane: number;
  /** Bar under the pointer; null on a price axis or without data. */
  time: Time | null;
  index: number | null;
  /** Price at the pointer on the pane's main scale or the axis' scale; null on the time axis. */
  price: number | null;
  /** Id of that price scale, e.g. `'right'`; null on the time axis or an empty axis column. */
  scale: string | null;
  /** Id of the drawing under the pointer (target `'drawing'`), which is also selected. */
  drawing: string | null;
  /** The legend row's series (target `'legend'`). */
  series?: Series;
}

/**
 * What is selected on the chart: one or more drawings by id, one indicator,
 * or nothing. Only one kind is selected at a time.
 */
export type ChartSelection = { kind: 'drawings'; ids: string[] } | { kind: 'indicator'; indicator: Indicator } | null;

/** Payload of `series:hover`: the series under the pointer, if any, as the pointer moves over the plot. */
export interface SeriesHoverEvent {
  /** Topmost visible candle, line, histogram or point series under the pointer, or null. */
  series: Series | null;
  /** On a point series: the item under the pointer (the nearest when markers overlap). */
  item?: PointItem;
  /** Where the pointer is; null when no point is available (the pointer left, or the series was removed). */
  point: ChartPointerEvent | null;
}

/** One series' values at a bar, in `ValuesAt`: its raw numbers and its legend row. */
export interface SeriesValue {
  series: Series;
  pane: number;
  /**
   * Raw numbers at the bar: `open`, `high`, `low`, `close` (and `volume`) for
   * candles, `value` for lines and histograms. Null when the series has no
   * point there, and for heatmaps.
   */
  values: Record<string, number> | null;
  /** Title and formatted parts, as shown in the legend. */
  legend: LegendEntry | null;
}

/** Every series' value at one bar, as `chart.valuesAt` returns it: the bar's time and index, the formatted time and a row per series. */
export interface ValuesAt {
  /** Time of the bar the values belong to. */
  time: Time;
  /** `time` formatted like the crosshair time label. */
  timeText: string;
  index: number;
  series: SeriesValue[];
  /**
   * While the view groups bars (`grouping`): the bucket holding the bar, from
   * its first bar's `time` to its last bar's `endTime`, `count` bars. The
   * legend values are the bucket's. Absent otherwise.
   */
  group?: { time: Time; endTime: Time; count: number };
  /**
   * When the main series' bar carries `startTime` and `endTime` (a `PriceBar`):
   * the source bars it covers, from `time` to `endTime`. `timeText` shows the
   * span. Absent otherwise, and while grouping.
   */
  source?: { time: Time; endTime: Time };
}

/** The part of the chart at a point, from `chart.regionAt`: a pane's plot or price axis, the time axis, or a separator between panes. */
export type Region =
  | { kind: 'plot'; pane: number }
  /** `scale` is null over an axis column this pane leaves empty. */
  | { kind: 'priceAxis'; pane: number; scale: PriceScale | null }
  | { kind: 'timeAxis' }
  | { kind: 'separator'; pane: number };

const SEPARATOR_HIT = 4;
const PRICE_LINE_DASH: Readonly<Record<SeriesPriceLineStyle, number[]>> = { solid: [], dashed: [4, 4], dotted: [1, 2] };
type PendingRange = { from: Time; to: Time; load: Promise<void> };
/** History pages loaded at most to cover a kept range, so a source that never reaches back cannot loop. */
const MAX_RANGE_PAGES = 50;
/**
 * Resolve on a later task. History pages wait for it, so a source that answers
 * at once cannot chain every page (and the listeners each one runs) into one
 * long task that blocks the page.
 */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What `method` throws or rejects with once the chart is destroyed. */
const destroyedError = (method: string) => new ChartError('destroyed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${method}() called after destroy()` : '');
const VIEW_ANIMATION_MS = 520;
const PANE_ANIMATION_MS = 180;
/** A frame time long enough for every animation to reach its end; used to finish them at once. */
const SETTLE_MS = 60_000;

interface PaneSlot {
  top: number;
  height: number;
}

/** Axis tick prices and their labels for one pane. */
interface PaneTicks {
  values: number[];
  labels: string[];
}

/** Scroll-to-newest button: its size, and its distance from the plot's bottom-right corner. */
const SCROLL_BUTTON_SIZE = 28;
const SCROLL_BUTTON_MARGIN = 12;
/** Space (css px) between a price axis label and the plot side of its column. */
const AXIS_LABEL_INSET = 8;
/** Height (css px) of the band under the time labels that time-axis marks draw in. */
const TIME_MARK_BAND = 24;

/** Length (css px) of the `ticks` marks on the axes. */
const AXIS_TICK_LENGTH = 4;
/** Width (css px) of a filled label's point (`priceAxis.labelPointer`). */
const LABEL_POINTER = 5;
/** Measured label widths kept for auto axes before the cache starts over. */
const TEXT_WIDTH_CACHE = 2000;

const CHEVRONS_RIGHT: readonly IconShape[] = [['path', { d: 'm6 17 5-5-5-5' }], ['path', { d: 'm13 17 5-5-5-5' }]];
/** Side of the loading indicator, css px. */
const LOADER_SIZE = 40;

/**
 * A chart in a container element: panes, series, scales, axes, crosshair,
 * drawings, indicators and data loading. Create one with `createChart`; the
 * chart owns its canvases, so call `destroy()` when the container goes away.
 */
export class Chart implements SeriesHost {
  readonly root: HTMLDivElement;
  readonly timeline = new Timeline();
  /** Built-in and app commands by id, and the keyboard shortcuts that run them. */
  readonly actions = new ActionRegistry();
  /**
   * The undo history of drawings and indicators: `undo()`, `redo()`,
   * `canUndo`, `canRedo` and `clear()`. `history:change` reports changes.
   * Only the drawings and indicators plugins make steps: without them
   * there is nothing to undo.
   */
  readonly history: History = (() => {
    const steps = () => this.#undoSteps;
    return {
      get canUndo() {
        return steps()?.canUndo ?? false;
      },
      get canRedo() {
        return steps()?.canRedo ?? false;
      },
      undo: () => steps()?.undo() ?? false,
      redo: () => steps()?.redo() ?? false,
      clear: () => steps()?.clear(),
    };
  })();
  /** The steps behind `history`, once a plugin that makes steps asked for them (`undoSteps`). */
  #undoSteps: UndoSteps | null = null;
  readonly time: TimeScale;
  readonly panes: Pane[] = [];
  options: ChartOptions;
  theme: ChartTheme;

  /** Plot area size (css px), excludes axes. */
  plotWidth = 0;
  /** Width of the left axis columns and lanes: the plot's left edge in chart-root css px. */
  plotLeft = 0;
  plotHeight = 0;
  width = 0;
  height = 0;
  dpr = 1;
  crosshair: (Point & { pane: number }) | null = null;
  /** Set by `setCrosshairAt`: kept in data terms and re-projected on every draw, so it follows pan, zoom and new data. */
  private mirror: { time: Time; price: number | null; pane: number } | null = null;
  /** The pointer is on the "+" button: show its tooltip. */
  #plusHover = false;
  /** `lockCrosshair` holds the crosshair at `mirror`. */
  #locked = false;
  /** Leave the crosshair out of the next render (screenshots). */
  private hideCrosshair = false;
  /** A screenshot is rendering: what it includes. On-chart controls such as the "+" button are always left out. */
  private capture: Capture | null = null;
  readonly #plugins = new PluginRegistry(this);
  /** Series under the pointer, for `series:hover`. */
  #hovered: Series | null = null;
  /** Point item under the pointer, for `series:hover`. */
  #hoveredItem: PointItem | undefined = undefined;
  /** Bucketing key at the last `grouping:change`; null while drawing single bars. */
  #lastGroupKey: string | null = null;

  readonly #emitter = new Emitter<ChartEvents>((error, event) => this.#listenerFailed(error, event));
  private readonly bottom: HTMLCanvasElement;
  private readonly top: HTMLCanvasElement;
  /**
   * Interactive charts: the crosshair, its axis labels, series crosshair
   * markers and the "+" button, above `top`, so a pointer move redraws only
   * this layer. Static charts draw them on `top` and save the canvas.
   */
  private readonly cursorLayer: HTMLCanvasElement | null = null;
  private readonly glCanvas: HTMLCanvasElement;
  /** Static charts (`interactive: false`): the 2D copy of the GPU layer, shown in its place. */
  private readonly snapshot: HTMLCanvasElement | null = null;
  private readonly renderer: RenderBackend;
  /** This chart as the context budget sees it (the shared context's entry in shared mode). */
  readonly #contextHolder: ContextHolder;
  /** In shared mode: this chart's place in the shared context; null with its own context. */
  readonly #shared: SharedSession | null = null;
  /** Options fixed at creation. */
  readonly #created: Pick<ChartOptions, 'interactive' | 'gl'>;
  /** Watches whether the chart is in view, for the context budget and `paused`; absent outside browsers. */
  private readonly visibility: IntersectionObserver | null = null;
  /** The root intersects the viewport, as last reported; assumed until the first report. */
  #inView = true;
  /** Drawing waits because the chart is out of view or its page is hidden; see `syncPaused`. */
  private paused = false;
  /** A microtask is queued to settle the view while paused; see `queueSettle`. */
  #settleQueued = false;
  /** The scene changed while paused and was settled without drawing; it draws when shown. */
  #hiddenScene = false;
  private readonly interaction: Interaction;
  readonly #legend: Legend;
  /** Accessible name, summary and crosshair readout. */
  readonly #description: ChartDescription;
  #legendConfig: LegendSettings = { ...defaultLegendSettings };
  /** The opt-in series kinds the chart's plugins provide (`provideFeature`). */
  readonly #optIn: { [K in keyof OptInFeatures]?: OptInFeatures[K] | null } = {};
  /**
   * What the chart redoes when an opt-in feature comes or goes (`provideFeature`),
   * except while it is destroyed; `was` is the feature it replaces. One that
   * throws while the feature comes fails the install, and the chart keeps `was`.
   */
  readonly #featureChanged: { [K in keyof OptInFeatures]?: (feature: OptInFeatures[K] | null | undefined, was: OptInFeatures[K] | null | undefined) => void } = {
    // Drawings on the main pane were priced as the bars showed before: adjusted only with the plugin.
    adjustments: (_, was) => {
      this.#showAdjusted();
      if (this.#adjustments.length > 0) this.#optIn.drawings?.rebase(was ? this.#adjustments : [], this.options.adjustment);
      this.#syncAdjustmentMarkers();
    },
    // Markers of a source set before the plugin came (or went) are fetched (or dropped) now.
    sourceMarkers: () => {
      if (!this.dataController) return;
      this.#makeMarkersLoader();
      this.#markersContext();
      this.invalidate();
    },
    // The lane host comes or goes: lay the lanes out again.
    depthLane: () => this.invalidate(),
    // The source goes with the plugin; the bars it loaded stay.
    dataSource: (feature) => {
      if (!feature && this.dataController) this.setDataSource(null);
    },
    // The lines take the option set so far; going, they leave it as it was.
    referenceLines: (lines) => {
      if (!lines) return this.redrawOverlay('annotations');
      lines.applyOptions(this.options.referenceLines ?? {});
      this.options.referenceLines = lines.options;
    },
    pulse: () => this.redrawOverlay('animation'),
    priceStyles: () => this.invalidate(),
    countdown: () => this.redraw('options'),
    watermark: () => this.#syncWatermark(),
    // Without it zooming stops at `minBarSpacing` again; a view zoomed out further comes back to it now.
    grouping: (grouping) => {
      this.time.grouped = Boolean(this.options.grouping && grouping);
      this.time.clamp();
      this.invalidate();
    },
    localizer: (make) => {
      // An empty option localizes nothing: the built-in English stays, and so does `chart.localization`.
      const localizer = make && Object.keys(this.options.localization).length > 0 ? make(this.options.localization) : englishLocalizer;
      if (localizer === this.#localizer) return;
      const previous = this.#localizer;
      try {
        this.#setLocalizer(localizer);
        this.indicatorLayer?.relabel(previous);
      } catch (error) {
        this.#setLocalizer(previous);
        throw error;
      }
      this.redraw('options');
      this.emit('localization:change', { locale: localizer.locale });
    },
    drawings: (feature) => feature || this.redrawOverlay('drawings'),
    // What came before it: the data source's marks, corporate actions and indicator shape plots.
    annotations: (manager) => {
      if (manager) {
        this.#syncMarks();
        for (const [series, markers] of this.#plotMarkers) manager.setPlotMarkers(series, markers);
        this.#syncAdjustmentMarkers();
      }
      this.redraw('annotations');
    },
    // The rules the options kept, and the definitions other plugins registered before indicators went away.
    indicators: (feature) => {
      const manager = feature?.manager;
      if (!manager) return;
      manager.setAccess(this.options.access.allow);
      manager.setLimit(this.options.access.limits.indicators ?? null);
      for (const def of this.#plugins.indicators) manager.register(def);
    },
    marketStatus: () => this.#refreshBadge(),
    imageCapture: (capture) => (this.imageCapture = capture ?? null),
  };
  /** What an opt-in feature that goes ends first, while it is still the chart's, also on destroy. */
  readonly #featureGone: { [K in keyof OptInFeatures]?: (feature: OptInFeatures[K]) => void } = {
    referenceLines: (lines) => (this.options.referenceLines = mergeLines({}, lines.options)),
    watermark: () => this.#syncWatermark(false),
    replay: (replay) => (this.#destroying ? replay.pause(false) : replay.stop()),
    comparisons: (comparisons) => comparisons.clear(this.#destroying),
    // End what is under way.
    drawings: (feature) => feature.end(),
    // Detaches what it attached (zones, alerts) and ends any gesture.
    annotations: (manager) => manager.clear(),
  };
  /** Set while `destroy` uninstalls the plugins: they leave the chart as it is. */
  #destroying = false;
  /** Indicator shape plots' markers by series, for an annotations plugin installed after them. */
  readonly #plotMarkers = new Map<Series, BarMarker[]>();
  /** The heatmap inspector's update once it made its hover grid, kept should the `heatmap()` plugin go. */
  #inspect: HeatmapFeature['inspect'] | null = null;
  readonly #resizeObserver: ResizeObserver;
  /** Ratio the DPR media query watches, and how to stop watching; see `watchDpr`. */
  /** Resizes when the device pixel ratio changes without the container resizing. */
  readonly #dprWatch = pixelRatioWatch(() => this.dpr, () => this.resize());
  private destroyed = false;
  #mainSeries: CandleSeries | null = null;
  #maximized: Pane | null = null;
  /** Pane layout easing from `from` to `to`; `t` runs 0 → 1. */
  #paneAnim: { from: PaneSlot[]; to: PaneSlot[]; t: number } | null = null;
  readonly #paneControls: PaneControls;
  private readonly primitives = new PrimitiveRegistry(
    () => this.redraw('primitives'),
    () => this.redrawOverlay('primitives'),
    new PrimitiveGuard((error) => (this.listens('chart:error') ? this.emit('chart:error', { error }) : console.error(error))),
  );
  private dataController: DataController | null = null;
  /** Fetches the data source's markers; null when the source has no `markers`. */
  #markersLoader: MarkersLoader | null = null;
  private raf = 0;
  private sceneDirty = true;
  private overlayDirty = true;
  /** Only the crosshair layer needs drawing; never set without a `cursorLayer`. */
  #cursorDirty = false;
  private paneTicks = new Map<PriceScale, PaneTicks>();
  #timeTicks: TimeTick[] = [];
  #lastFrame = 0;
  /** What watches the frames (`PluginContext.onFrame`). */
  readonly #frames = new Set<FrameObserver>();
  /** Measured frame pacing, and the idle frame cap of `lowPower`. */
  readonly #pacer = new FramePacer();
  /** A frame held back by the idle cap of `lowPower`, waiting to be requested. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The running frame was held back by the idle cap, so its gap measures the cap, not the machine. */
  #paced = false;
  /** The main series' first and last bar times at the last scene, to tell appended bars apart. */
  #seenBars: { series: CandleSeries; first: Time; last: Time } | null = null;
  /** Visible time range at the last check, and its key for the history gate. */
  #lastRangeFrom = NaN;
  #lastRangeTo = NaN;
  #lastRange = '';
  /**
   * Scratch collections for `autoscale`, reused so a scene draw does not
   * rebuild them. `panePrimitives` holds each pane's attached primitives,
   * partitioned once per autoscale; `fitPrimitives` is one series' share.
   */
  readonly #fitRanges = new Map<PriceScale, [number, number]>();
  readonly #fitScales = new Set<PriceScale>();
  private readonly panePrimitives = new Map<Pane, AttachedPrimitive[]>();
  readonly #fitPrimitives: AttachedPrimitive[] = [];
  /** Each attached primitive's coordinate functions, made once (see `primitiveEnv`). */
  readonly #primitiveFns = new WeakMap<
    AttachedPrimitive,
    Pick<PrimitiveEnv, 'indexToX' | 'xToIndex' | 'timeToX' | 'priceToY' | 'yToPrice' | 'formatPrice'>
  >();
  /** Inputs to every coordinate as of the last scene draw; compared in place, so an unchanged frame builds no key string. */
  readonly #viewKey: (number | string | boolean)[] = [];
  #viewSlot = 0;
  #viewMoved = false;
  readonly #historyGate = new HistoryGate();
  /** Series whose legend row is folded to its title. */
  readonly #foldedRows = new WeakSet<Series>();
  /** Which rows the app opens settings for, declared with `provideSeriesSettings`. */
  readonly #settingsProviders = new Set<(series: Series, indicator: Indicator | null) => boolean>();
  /** Something animated last frame; redraw the scene next frame. */
  private animating = false;
  /** Batch data was still waiting for the GPU after the last scene; it uploads over the next frames. */
  private uploading = false;
  /** The animation frame being drawn (its timestamp), NaN outside one: charts sharing a context share its upload budget. */
  #frameNow = NaN;
  readonly #scrollButton: HTMLButtonElement;
  /** Numbers, dates and text in the `localization` option's language. */
  #localizer: Localizer;
  /** `extendedSession`, compiled unless it is always open; null when unset. */
  #extended: SessionSchedule | CompiledSession | null = null;
  /** Data delay of the symbol shown; reset when a switch starts or fails. */
  #delay: number | 'eod' = 0;
  /** Legend badge text: market phase and data delay. */
  private badge = '';
  private status: ChartStatus | null = null;
  /** A `status:change` listener prevented the built-in text for the current status. */
  #statusHidden = false;
  private statusEl: HTMLDivElement | null = null;
  #scrollButtonShown = false;
  readonly #clock: ReturnType<typeof setInterval>;
  #scaleStateKeys = new WeakMap<Pane, Map<string, string>>();
  /** Price-axis columns on each side; the right side always keeps one. */
  #axisCols = { left: 0, right: 1 };
  /** The resolved `direction` is right to left. */
  #rtl = false;
  /** Main price scales given a `side` by the app, which the direction no longer moves. */
  readonly #pinnedSides = new WeakSet<PriceScale>();
  /** Width (css px) of one axis column on each side: `priceAxisWidth`, or measured in auto mode. */
  private axisWidths = { left: 76, right: 76 };
  /** Width (css px) primitives' lanes take between the plot and the axes on each side, as laid out. */
  private laneSpace = { left: 0, right: 0 };
  /** Auto mode has measured since `priceAxisWidth` or `priceAxis` last changed, so hysteresis applies. */
  private axisMeasured = false;
  /** `time.moves` when a fit or range call last set the view, else -1; see `#fitScene`. */
  #rangeHold = -1;
  /** Measured label widths for auto axes, for `textWidthFont`. */
  #textWidths = new Map<string, number>();
  private textWidthFont = '';
  #flags: ChartFeatures = { ...defaultChartFeatures };
  /**
   * The `imageCapture()` plugin's compositor of `captureImage`, kept from
   * `provideFeature` outside the ES private members so `captureImage` runs on a
   * chart made without its constructor (the screenshot tests).
   */
  private imageCapture: ((chart: Chart, host: CaptureHost, options: ScreenshotOptions) => HTMLCanvasElement | null) | null = null;
  /** The main series' price format came from the data source's symbol info. */
  #sourceFormat = false;
  /** The data source's bars as sent (unadjusted), and its corporate actions; see the `adjustment` option. */
  #sourceBars: Bar[] | null = null;
  #adjustments: readonly Adjustment[] = [];
  /** The adjustments before the latest `setAdjustments`, to tell whether a history page rescales the loaded bars. */
  #prependAdjustments: readonly Adjustment[] = [];
  /** The timezone the app set, shown when no symbol timezone applies. */
  #appTimezone: string;
  /** `applyOptions({ timezone })` while `applySymbolTimezone` was on: later symbols keep that timezone. */
  #timezonePinned = false;
  /** The timezone the time axis uses, for `timezone:change`; null before the first is applied. */
  #appliedTimezone: string | null = null;
  /** The symbol last asked for with `setSymbol`, for `symbol:change`. */
  #requestedSymbol: string | null = null;
  /**
   * Range to show once `load` (a `setSymbol` load) lands: the range kept across
   * an interval switch, or one requested while the load was pending.
   */
  private pendingRange: PendingRange | null = null;
  /** The `setSymbol` load in flight, with a view change requested meanwhile. */
  #pendingLoad: { load: Promise<void>; view: (() => void) | null; resetView: boolean } | null = null;
  /** Top-level fields of the last loaded layout this version does not know, written back on save. */
  #layoutExtra: Record<string, unknown> = {};
  /** Above zero while a layout is applied synchronously: `state:change` stays quiet. */
  #stateQuiet = 0;
  /** A loaded layout whose `ready` is pending, with the edits made meanwhile. */
  #layoutLoad: { edits: Set<StateChangeReason> } | null = null;

  constructor(
    container: HTMLElement,
    { plugins, ...options }: ChartOptionsPatch = {},
  ) {
    devCheck('createChart', options, 'chart');
    // Built-in English until the `localization()` plugin builds the option's localizer; the option is checked either way.
    if (options.localization) checkLocalization(options.localization);
    this.#localizer = englishLocalizer;
    if (options.access) checkAccess(options.access);
    this.options = {
      ...defaultChartOptions,
      ...options,
      access: { ...defaultAccessOptions },
      ...checkCrosshair(mergeGroups(defaultChartOptions, options)),
      localization: { ...options.localization },
    };
    // A static chart draws once and settles: nothing eases over several frames.
    if (options.interactive === false) Object.assign(this.options, { animateViewChanges: false, smoothScale: false, smoothZoom: false });
    this.#syncAxisWidths();
    this.#syncFeatures(options);
    this.theme = resolveTheme(this.options.theme);
    this.#applyZone();
    this.#appTimezone = this.options.timezone;
    checkGrouping(this.options.grouping);
    // Grouped once the `grouping()` plugin is installed.
    this.time = new TimeScale(this.options);

    this.root = createRoot(container, 'pc-chart');
    this.root.tabIndex = this.options.focusable ? 0 : -1;
    this.#styleRoot();
    this.bottom = addLayer(this.root);
    // Shared mode: a 2D canvas the shared context's drawing is copied into.
    this.glCanvas = addLayer(this.root);
    // `gl: 'shared'` draws through the context of the `sharedContext()` plugin, installed ahead of the others to join it now.
    const early = this.options.gl === 'shared' ? plugins?.find((p) => p.name === SHARED_CONTEXT) : undefined;
    if (early) this.install(early);
    else if (this.options.gl === 'shared' && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce("gl: 'shared' needs the sharedContext() plugin: add it (or builtins()) to the chart's plugins. The chart has its own context", 'shared-context-missing');
    }
    const sharedGl = early !== undefined;
    this.#created = { interactive: this.options.interactive, gl: (this.options.gl = sharedGl ? 'shared' : 'own') };
    if (!this.options.interactive && !sharedGl) {
      // Static: the GPU layer is shown from a 2D copy, so the context can go between drawings.
      this.snapshot = addLayer(this.root);
      this.glCanvas.style.visibility = 'hidden';
    }
    this.top = addLayer(this.root);
    if (this.options.interactive) this.cursorLayer = addLayer(this.root);
    const events: RendererEvents = {
      lost: (reason) => this.emit('context:lost', { reason }),
      restored: (reason) => {
        if (!sharedGl) contextBudget.restored(this.#contextHolder);
        this.redraw('layout');
        this.emit('context:restored', { reason });
      },
      restoreFailed: (error) => this.emit('context:restore-failed', { error }),
      gaveUp: () => contextBudget.release(this.#contextHolder),
    };
    if (sharedGl) {
      // Joining makes the shared context if this is the first shared chart, and throws like an own one would.
      this.#shared = this.#optIn.sharedContext!.join(this.glCanvas, events);
      this.renderer = this.#shared.renderer;
      this.#contextHolder = this.#shared.holder;
    } else {
      // Set up WebGL before touching the container, so a browser without it gets
      // a ChartError and an untouched container. Make room first, so the browser
      // never sees more contexts than the budget and picks one to drop itself.
      contextBudget.reserve(this.snapshot !== null);
      const renderer = new GLRenderer(this.glCanvas, events);
      this.renderer = renderer;
      this.#contextHolder = budgetEntry(renderer, this.snapshot !== null);
    }
    for (const type of ['pointerdown', 'wheel', 'focusin']) {
      this.root.addEventListener(type, this.#useContext, { capture: true, passive: true });
    }
    for (const type of INPUT_EVENTS) this.root.addEventListener(type, this.#noteInput, { capture: true, passive: true });
    this.visibility = watchInView(this.root, (inView) => {
      if (this.#shared) this.#shared.setVisible(inView);
      else contextBudget.setVisible(this.#contextHolder, inView);
      this.#inView = inView;
      this.#syncPaused();
    });
    if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', this.#onPageVisibility);
    container.appendChild(this.root);
    // Read once in the page, before the main pane takes its side from it.
    this.#rtl = this.#readRtl();

    if (options.access) this.#applyAccess(options.access);
    // Like `features`, an explicit undefined means no change. Kept per line for the `referenceLines()` plugin.
    this.options.referenceLines = mergeLines({}, options.referenceLines);
    this.#description = new ChartDescription(this.root, this.options.accessibility);
    this.#description.setLabel(null, this.#localizer.text('chartLabel'));
    this.#legend = new Legend(
      this.root,
      (series, action, button) => this.#legendAction(series, action, button),
      () => this.redrawOverlay('options'),
    );
    this.interaction = new Interaction(this);
    if (!this.options.interactive) {
      // Static: no input at all, and nothing to tab to.
      this.interaction.destroy();
      this.root.tabIndex = -1;
    }
    this.#registerActions();
    this.#scrollButton = this.#createScrollButton();
    this.#paneControls = new PaneControls(this.root, (pane, action) => this.#paneAction(pane, action));
    this.addPane({ stretch: 1 });
    // Repaint the bar-close countdown once a second.
    this.#clock = setInterval(() => {
      if (this.options.marketStatus) this.#refreshBadge();
      const { countdown, lastValueLabels } = this.#flags;
      if (countdown && lastValueLabels && this.#optIn.countdown && this.#mainSeries?.visible) this.redrawOverlay('animation');
    }, 1000);

    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(this.root);
    // The plugins go in before the first frame, so it already shows what they provide, e.g. numbers in the `localization` option's language.
    this.installCreationPlugins(early ? plugins!.filter((p) => p !== early) : plugins);
    this.resize();
    // A chart made in a background tab draws that first frame, then waits until the tab is shown.
    this.#syncPaused();
    if (process.env.NODE_ENV !== 'production') {
      this.#statsOverlayNeeded();
      this.#watermarkNeeded(options);
      this.#countdownNeeded(options);
      this.#marketStatusNeeded(options);
      this.#localizationNeeded(options);
      this.#referenceLinesNeeded(options);
      this.#groupingNeeded(options);
    }
  }

  /* ------------------------------ public API ------------------------------ */

  /** Like `on`, for the next emission only; returns a function that cancels it. */
  once<K extends keyof ChartEvents>(event: K, listener: (payload: ChartEvents[K]) => void): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  on<K extends keyof ChartEvents>(event: K, listener: (payload: ChartEvents[K]) => void): () => void {
    const off = this.#emitter.on(event, listener);
    if (!OVERLAY_EVENTS.has(event)) return off;
    // The legend's settings and "More" buttons and the "+" button show only while someone listens.
    this.redrawOverlay('options');
    return () => {
      const listened = this.listens(event);
      off();
      // Not after destroy, which already dropped every listener.
      if (listened && !this.listens(event)) this.redrawOverlay('options');
    };
  }

  /**
   * The layout the user arranged, to store and restore with `loadLayout`:
   * symbol and interval, chart type, panes with their heights and price
   * scales, indicators, drawings and, with `visibleRange: true`, the visible
   * time range. Bars are never included. Indicators and drawings added with
   * `persist: false` are left out. Needs the `layouts()` plugin (or
   * `builtins()`); throws a `not-registered` `ChartError` without it.
   */
  serializeLayout(options: LayoutSerializeOptions = {}): ChartLayout {
    return (this.#optIn.layouts ?? notInstalled('serializeLayout', 'layouts()')).serialize(this, this.#layoutExtra, options);
  }

  /**
   * Restore a layout from `serializeLayout`, e.g. one read from storage.
   * Parts the layout leaves out stay as they are. Older versions are upgraded
   * (see `options.migrate`). Invalid parts are skipped and listed in
   * `errors`; the rest loads. Throws, changing nothing, only when `data` is
   * not a layout or has a version nothing can upgrade. With a data source,
   * the saved symbol loads through it; `ready` settles once it has. Needs the
   * `layouts()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  loadLayout(data: unknown, options: LayoutLoadOptions = {}): LayoutLoadResult {
    if (this.destroyed) throw destroyedError('loadLayout');
    const layouts = this.#optIn.layouts ?? notInstalled('loadLayout', 'layouts()');
    this.#stateQuiet++;
    let applied: AppliedLayout;
    try {
      applied = layouts.load(this, data, options);
      // Report scale changes now, quietly, rather than from the next frame.
      this.#emitScaleState(true);
    } finally {
      this.#stateQuiet--;
    }
    const { result, extra } = applied;
    this.#layoutExtra = extra;
    const ready = result.ready;
    if (ready) {
      // Edits pending from an earlier load still waiting for its symbol carry over.
      const load = { edits: new Set<StateChangeReason>(this.#layoutLoad?.edits) };
      this.#layoutLoad = load;
      const settled = () => this.#layoutSettled(load);
      ready.then(settled, settled);
    }
    return result;
  }

  /**
   * True from `loadLayout` until its `ready` settles. Saving meanwhile would
   * store the layout half-applied (e.g. the old visible range), so
   * `state:change` waits for it.
   */
  get layoutLoading(): boolean {
    return this.#layoutLoad !== null;
  }

  /** A loaded layout's symbol is in: report the edits made while it loaded. */
  #layoutSettled(load: { edits: Set<StateChangeReason> }): void {
    if (this.#layoutLoad !== load || this.destroyed) return;
    this.#stateQuiet++;
    try {
      this.#emitScaleState(true);
    } finally {
      this.#stateQuiet--;
    }
    this.#layoutLoad = null;
    for (const reason of load.edits) this.#stateChanged(reason);
  }

  /** Report a `state:change`, unless something is loading. */
  #stateChanged(reason: StateChangeReason): void {
    if (this.#stateQuiet > 0 || this.drawingLayer?.loading || this.indicatorLayer?.loading) return;
    if (this.#layoutLoad) {
      if (EDIT_REASONS.has(reason)) this.#layoutLoad.edits.add(reason);
      return;
    }
    if (this.listens('state:change')) this.emit('state:change', { reason });
  }

  /** The `state:change` reason an event implies, if any. */
  #stateReason<K extends keyof ChartEvents>(event: K, payload: ChartEvents[K]): StateChangeReason | null {
    switch (event) {
      case 'drawings:change':
        return 'drawings';
      case 'indicator:add':
      case 'indicator:remove':
      case 'indicator:change':
        return 'indicators';
      case 'panes:change':
      case 'scale:change':
        return 'panes';
      case 'series:options': {
        // Only the main series' style is saved, in the layout's `mainSeries`.
        const { series, patch } = payload as ChartEvents['series:options'];
        return series === this.#mainSeries && Object.keys(patch).some((key) => LAYOUT_STYLE_KEYS.has(key)) ? 'series' : null;
      }
      case 'data:loaded':
        return (payload as DataEvents['data:loaded']).kind === 'initial' ? 'symbol' : null;
      case 'appearance:change':
        return 'options';
      default:
        return null;
    }
  }

  /**
   * What the last frame cost, while the `renderStats` or `renderStatsOverlay`
   * option is on; null while both are off, before the first frame, or without
   * the `statsOverlay()` plugin. See also the `frame:render` event.
   */
  get frameStats(): RenderStats | null {
    return this.#optIn.statsOverlay?.last() ?? null;
  }

  /**
   * Smoothed time in ms between animation frames that ran back to back
   * (during pans, zooms, easing or live updates), or null before any did.
   * Measured from the frame timestamps the browser hands the chart, so it
   * costs no clock reads and works with `renderStats` off. A value well above
   * the screen's refresh interval means the machine cannot keep up; see
   * `lowPower` and the `frame:slow` event.
   */
  get frameTime(): number | null {
    return this.#pacer.frameTime;
  }

  /** GPU memory the series hold now, in bytes. Available whether or not `renderStats` is on. */
  gpuMemory(): GpuMemory {
    return this.renderer.gpuMemory();
  }

  /** Current feature flags; change them with `applyOptions({ features })`. */
  get features(): Readonly<ChartFeatures> {
    return { ...this.#flags };
  }

  addPane(options: Partial<PaneOptions> = {}): Pane {
    devCheck('addPane', options, 'pane');
    const pane = new Pane(this.panes.length, { stretch: 0.25, ...options });
    pane.price.side = this.#mainSide;
    this.panes.push(pane);
    this.#panesChanged();
    return pane;
  }

  /** Remove a pane with its series and drawings. The main pane cannot be removed. */
  removePane(pane: Pane): void {
    const i = this.panes.indexOf(pane);
    if (i <= 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Cannot remove the main pane' : '');
    for (const s of [...pane.series]) this.removeSeries(s);
    this.primitives.detachWhere((e) => e.pane === pane);
    this.panes.splice(i, 1);
    if (this.#maximized === pane) this.#maximized = null;
    // Drawings store pane indices: drop the removed pane's, shift the ones below.
    this.drawingLayer?.remapPanes(removalMap(this.panes.length + 1, i));
    this.#panesChanged();
  }

  /** Move a pane to `index`. The main pane stays first, so `index` is at least 1. */
  movePane(pane: Pane, index: number): void {
    const from = this.panes.indexOf(pane);
    if (from <= 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'The main pane cannot be moved' : '');
    if (!Number.isFinite(index)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'movePane: index must be a finite number' : '');
    const to = clampLow(Math.round(index), 1, this.panes.length - 1);
    if (to === from) return;
    // Reorder first: a chart without drawings has nothing to remap, but its panes still move.
    const map = reorder(this.panes, from, to);
    this.drawingLayer?.remapPanes(map);
    this.#panesChanged(true);
  }

  /** Give one pane all the height (null restores the others). A hidden pane cannot be maximized. */
  maximizePane(pane: Pane | null): void {
    if (pane && (!this.panes.includes(pane) || pane.hidden)) return;
    this.#maximized = pane;
    this.#panesChanged(true);
  }

  get maximizedPane(): Pane | null {
    return this.#maximized;
  }

  /** Shrink a pane to a thin header (its legend), or expand it again. */
  setPaneCollapsed(pane: Pane, collapsed: boolean): void {
    if (!this.panes.includes(pane) || pane.collapsed === collapsed) return;
    pane.collapsed = collapsed;
    this.#panesChanged(true);
  }

  /**
   * Hide a pane, giving its height to the others, or show it again. Its
   * series, indicators and drawings stay. The main pane cannot be hidden;
   * hiding the maximized pane restores the others.
   */
  setPaneHidden(pane: Pane, hidden: boolean): void {
    if (this.panes.indexOf(pane) <= 0 || pane.hidden === hidden) return;
    pane.setHidden(hidden);
    if (hidden && this.#maximized === pane) this.#maximized = null;
    this.#panesChanged(true);
  }

  /** Draw `series` above every other series of its pane (sets its `zIndex`). Uploads nothing. */
  moveSeriesToFront(series: Series): void {
    const others = series.pane.series.filter((s) => s !== series);
    if (others.length === 0) return;
    const top = Math.max(...others.map((s) => s.zIndex));
    if (series.zIndex <= top) series.zIndex = top + 1;
  }

  /** Draw `series` below every other series of its pane (sets its `zIndex`). Uploads nothing. */
  sendToBack(series: Series): void {
    const others = series.pane.series.filter((s) => s !== series);
    if (others.length === 0) return;
    const bottom = Math.min(...others.map((s) => s.zIndex));
    if (series.zIndex >= bottom) series.zIndex = bottom - 1;
  }

  /**
   * Move a series to the pane above or below its own, into a new pane after
   * it, or into a given pane. A pane left empty is removed unless it still
   * holds drawings (or is the main pane). The main series stays in the main
   * pane. Moving an indicator's series is an undo step.
   */
  moveSeries(series: Series, target: 'above' | 'below' | 'new' | Pane): Pane {
    const from = series.pane;
    const index = this.panes.indexOf(from);
    const dest = this.#moveSeriesTo(series, target);
    const indicator = this.#indicatorOf(series);
    if (!indicator || dest === from) return dest;
    // Each end is the pane, or its index to make a pane again at once the move left it empty and removed.
    const ends: [Pane, number][] = [
      [from, index],
      [dest, this.panes.indexOf(dest)],
    ];
    const go = (end: [Pane, number]) => () => {
      const moved = indicator.series;
      if (!moved) return;
      if (!this.panes.includes(end[0])) end[0] = this.#insertPane(end[1], { stretch: end[0].stretch });
      this.#moveSeriesTo(moved, end[0]);
    };
    this.#undoSteps?.record({ owner: this.indicatorLayer!, undo: go(ends[0]!), redo: go(ends[1]!) });
    return dest;
  }

  #moveSeriesTo(series: Series, target: 'above' | 'below' | 'new' | Pane): Pane {
    if (series === this.#mainSeries) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'The main series cannot leave the main pane' : '');
    const source = series.pane;
    const i = this.panes.indexOf(source);
    if (i < 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'moveSeries: series is not on this chart' : '');
    let dest: Pane;
    if (target === 'above') dest = this.panes[Math.max(0, i - 1)]!;
    else if (target === 'below') dest = this.panes[i + 1] ?? this.#insertPane(i + 1);
    else if (target === 'new') dest = this.#insertPane(i + 1);
    else if (this.panes.includes(target)) dest = target;
    else throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'moveSeries: unknown pane' : '');
    if (dest === source) return dest;
    // A scale made for this series moves with it; the old pane drops it once unused.
    const scaleId = series.overlayScale ? null : series.scale.id;
    if (scaleId !== null && source.isClaimed(scaleId)) dest.claimScale(scaleId);
    source.series.splice(source.series.indexOf(series), 1);
    dest.series.push(series);
    series.pane = dest;
    source.pruneScales();
    this.primitives.followSeries(series);
    // Drawings tied to the series' indicator move along, so they don't keep the old pane.
    if (this.#indicatorOf(series)) this.drawingLayer?.intervalChanged();
    if (!this.#removeIfEmpty(source)) this.#panesChanged();
    return dest;
  }

  /** Remove `pane` once it has no series and no drawings, unless it is the main pane. Returns whether it went. */
  #removeIfEmpty(pane: Pane): boolean {
    const i = this.panes.indexOf(pane);
    const empty = i > 0 && pane.series.length === 0 && !this.#paneHasDrawings(i);
    if (empty) this.removePane(pane);
    return empty;
  }

  /**
   * Pane stretch weights normalized to sum to 1. Collapsed panes keep the
   * weight they expand back to, so these are not on-screen fractions; pass
   * them to `setPaneHeights` to restore the layout.
   */
  getPaneHeights(): number[] {
    const total = this.panes.reduce((sum, p) => sum + p.stretch, 0) || 1;
    return this.panes.map((p) => p.stretch / total);
  }

  /** Set pane heights from weights (any positive numbers, e.g. saved fractions). */
  setPaneHeights(weights: readonly number[]): void {
    this.panes.forEach((p, i) => {
      const w = weights[i];
      if (w !== undefined && w > 0 && Number.isFinite(w)) p.stretch = w;
    });
    this.#panesChanged(true);
  }

  addCandles(options: Partial<CandleSeriesOptions> = {}, pane = this.panes[0]!): CandleSeries {
    devCheck('addCandles', options, 'candles');
    const series = new CandleSeries(this, pane, {
      title: '',
      style: 'candles',
      bodyRatio: 0.7,
      lineWidth: 2,
      lastValueLabel: true,
      animate: true,
      ...options,
    });
    if (this.#mainSeries) return this.#attach(series);
    series.isMain = true;
    this.#mainSeries = series;
    this.#attach(series);
    this.annotationLayer?.mainChanged();
    return series;
  }

  addHistogram(options: Partial<HistogramSeriesOptions> = {}, pane = this.panes[0]!): HistogramSeries {
    devCheck('addHistogram', options, 'histogram');
    return this.#attach(
      new HistogramSeries(this, pane, {
        title: '',
        base: 0,
        columnRatio: 0.8,
        format: defaultFormat,
        lastValueLabel: true,
        ...options,
      }),
    );
  }

  addLine(options: Partial<LineSeriesOptions> = {}, pane = this.panes[0]!): LineSeries {
    devCheck('addLine', options, 'line');
    return this.#attach(
      new LineSeries(this, pane, {
        title: '',
        lineWidth: 1.5,
        area: false,
        format: defaultFormat,
        lastValueLabel: true,
        ...options,
      }),
    );
  }

  /** Add a series of a user-defined chart type (see `CustomSeriesDef`). */
  addCustomSeries<D extends { time: Time }, O extends object>(
    def: CustomSeriesDef<D, O>,
    options: Partial<O & CustomSeriesBaseOptions<D>> = {},
    pane = this.panes[0]!,
  ): CustomSeries<D, O> {
    devCheck('addCustomSeries', options, 'custom');
    const merged = {
      title: '',
      lastValueLabel: true,
      format: defaultFormat,
      ...def.defaultOptions,
      ...options,
    } as O & CustomSeriesBaseOptions<D>;
    return this.#attach(new CustomSeries(this, pane, merged, def));
  }

  /**
   * Add a heatmap series. Needs the `heatmap()` plugin (or `builtins()`);
   * throws a `not-registered` `ChartError` without it, and a `webgl-shader`
   * one when the heatmap program fails to build.
   */
  addHeatmap(options: Partial<HeatmapSeriesOptions> = {}, pane = this.panes[0]!): HeatmapSeries {
    devCheck('addHeatmap', options, 'heatmap');
    const feature = this.#optIn.heatmap ?? notInstalled('addHeatmap', 'heatmap()');
    feature.prime(this.renderer);
    const series = this.#attach(feature.series(this, pane, options));
    // Heatmaps render beneath other series in their pane.
    pane.series.splice(pane.series.indexOf(series), 1);
    pane.series.unshift(series);
    return series;
  }

  /**
   * Volume-by-price profile of the main candle series: visible range or per
   * session. Needs the `volumeProfile()` plugin (or `builtins()`); throws a
   * `not-registered` `ChartError` without it.
   */
  addVolumeProfile(options: Partial<VolumeProfileOptions> = {}, pane = this.panes[0]!): VolumeProfileSeries {
    devCheck('addVolumeProfile', options, 'volumeProfile');
    const feature = this.#optIn.volumeProfile ?? notInstalled('addVolumeProfile', 'volumeProfile()');
    return this.#attach(feature.series(this, pane, options));
  }

  /**
   * Markers at exact times and prices drawn on the GPU, e.g. large trades as
   * bubbles sized by quantity (see `PointSeriesOptions.sizeBy`). Needs the
   * `points()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  addPoints(options: Partial<PointSeriesOptions> = {}, pane = this.panes[0]!): PointSeries {
    devCheck('addPoints', options, 'points');
    const feature = this.#optIn.points ?? notInstalled('addPoints', 'points()');
    return this.#attach(feature.series(this, pane, options));
  }

  removeSeries(series: Series): void {
    this.#detachSeries(series, this.#indicatorOf(series));
  }

  /** Take `series` off the chart; `indicator` is the one that drew it, for `series:remove`. */
  #detachSeries(series: Series, indicator: Indicator | null): void {
    // destroy() disposed every series already.
    if (this.destroyed) return;
    const list = series.pane.series;
    const i = list.indexOf(series);
    // Only a series still on the chart is disposed, so a second removal does nothing twice.
    if (i >= 0) {
      list.splice(i, 1);
      series.dispose();
      series.pane.pruneScales();
    }
    this.indicatorLayer?.seriesRemoved(series);
    this.primitives.detachWhere((e) => e.series === series);
    if (series === this.#mainSeries) {
      this.#optIn.replay?.cancel();
      this.#mainSeries = null;
      this.timeline.set([]);
      this.time.barCount = 0;
      this.indicatorLayer?.syncBars([], 'reset');
      // Followers drop the old bars' points, and every series its old timeline positions.
      this.#followAll([], 'reset');
      this.#forEachSeries((s) => s.realign());
      this.annotationLayer?.mainChanged();
    }
    if (series === this.#hovered) {
      this.#hovered = null;
      this.#hoveredItem = undefined;
      this.emit('series:hover', { series: null, point: null });
    }
    if (i >= 0) this.emit('series:remove', { series, indicator });
    this.redraw('series');
  }

  /**
   * Ask the app to show `series`' settings: emits `series:settings`, as the
   * legend's settings button does. Returns false, emitting nothing, when the
   * series has no settings (see `hasSeriesSettings`).
   */
  openSeriesSettings(series: Series): boolean {
    if (!this.hasSeriesSettings(series)) return false;
    this.emit('series:settings', { series, indicator: this.#indicatorOf(series) });
    return true;
  }

  /**
   * Whether `series` is on the chart and has settings to open: something
   * listens to `series:settings` and, once any provider is declared with
   * `provideSeriesSettings`, one of them covers it. The legend shows a row's
   * settings button, and the row's menu its Settings… item, only then.
   */
  hasSeriesSettings(series: Series): boolean {
    return this.#isOnChart(series) && this.#rowHasSettings(series);
  }

  /**
   * Declare which rows the app provides settings for: `covers` gets each
   * series and its indicator (or null) and returns whether a
   * `series:settings` listener shows something for it. While any provider is
   * declared, only the rows one of them covers get a settings button; with
   * none, every row does while something listens to `series:settings`. A
   * `covers` that throws covers nothing, and its error is reported like a
   * listener's (`chart:error`). Returns a function that withdraws the provider.
   */
  provideSeriesSettings(covers: (series: Series, indicator: Indicator | null) => boolean): () => void {
    // Each call is its own provider, even with the same function.
    const provider = (series: Series, indicator: Indicator | null) => covers(series, indicator);
    this.#settingsProviders.add(provider);
    this.redrawOverlay('options');
    return () => {
      if (!this.#settingsProviders.delete(provider) || this.destroyed) return;
      this.redrawOverlay('options');
    };
  }

  /** `hasSeriesSettings` for a series known to be on the chart. */
  #rowHasSettings(series: Series): boolean {
    if (!this.listens('series:settings')) return false;
    if (this.#settingsProviders.size === 0) return true;
    const indicator = this.#indicatorOf(series);
    for (const covers of this.#settingsProviders) {
      // A provider that throws covers nothing; its error goes where a listener's would.
      try {
        if (covers(series, indicator)) return true;
      } catch (error) {
        this.#listenerFailed(error, 'series:settings');
      }
    }
    return false;
  }

  /**
   * Fold a series' legend row to its title, or unfold it. An indicator's row
   * fires `indicator:change` and is saved with the indicator (`IndicatorState.folded`).
   */
  setLegendFolded(series: Series, folded: boolean): void {
    if (folded === this.isLegendFolded(series)) return;
    const indicator = this.#indicatorOf(series);
    if (indicator) indicator.setLegendFolded(folded);
    else if (folded) this.#foldedRows.add(series);
    else this.#foldedRows.delete(series);
    this.redrawOverlay('options');
  }

  /** Whether a series' legend row is folded to its title (see `setLegendFolded`). */
  isLegendFolded(series: Series): boolean {
    return this.#indicatorOf(series)?.legendFolded ?? this.#foldedRows.has(series);
  }

  /** @internal The series whose legend row holds `target`, e.g. a pointer event's target. */
  legendSeriesAt(target: EventTarget | null): Series | null {
    return this.#flags.legend && this.#flags.legendButtons ? this.#legend.seriesAt(target) : null;
  }

  /**
   * @internal Emit `chart:contextmenu` for a legend row at viewport px, when
   * the `contextMenu` feature is on and something listens. Returns whether it did.
   */
  openLegendMenu(series: Series, clientX: number, clientY: number): boolean {
    if (!this.#flags.contextMenu || !this.listens('chart:contextmenu') || !this.#isOnChart(series)) return false;
    const r = this.root.getBoundingClientRect();
    this.emit('chart:contextmenu', {
      target: 'legend',
      x: clientX - r.left,
      y: clientY - r.top,
      clientX,
      clientY,
      pane: this.panes.indexOf(series.pane),
      time: null,
      index: null,
      price: null,
      scale: null,
      drawing: null,
      series,
    });
    return true;
  }

  /** A legend row button was pressed. */
  #legendAction(series: Series, action: LegendAction, button?: HTMLElement): void {
    const indicator = this.#indicatorOf(series);
    if (action === 'visibility') {
      // An indicator's own toggle, which an interval it is hidden on does not change.
      if (indicator) indicator.setVisible(!indicator.visible);
      else series.setVisible(!series.visible);
      this.redraw('series');
    } else if (action === 'settings') {
      this.openSeriesSettings(series);
    } else if (action === 'more') {
      const r = button?.getBoundingClientRect();
      if (r) this.openLegendMenu(series, r.left, r.bottom);
    } else if (indicator) {
      indicator.remove();
    } else {
      // A compared symbol's handle also drops its loader, pane or scale, and the percent mode it set.
      const compared = this.compared.find((c) => c.series === series);
      if (compared) compared.remove();
      else if (series !== this.#mainSeries) {
        // Its pane goes too once empty, as an indicator's does; removeSeries alone keeps it.
        const pane = series.pane;
        this.removeSeries(series);
        this.#removeIfEmpty(pane);
      }
    }
  }

  /** The live indicator drawing `series`, if any. */
  #indicatorOf(series: Series): Indicator | null {
    return this.indicatorLayer?.getAll().find((ind) => ind.series === series) ?? null;
  }

  /** The selection the drawings and indicators plugins made (`selector`); null without them. */
  #selection: SelectionFeature | null = null;

  /** What is selected: drawings, one indicator, or null for nothing (always without the drawings and indicators plugins). */
  getSelection(): ChartSelection {
    return this.#selection?.get() ?? null;
  }

  /**
   * Select drawings (as `drawings.setSelection` does) or an indicator on this
   * chart, which clears the other kind; null clears both. An indicator no
   * longer on the chart selects nothing. Emits `selection:change` when the
   * selection changed. Does nothing without the drawings and indicators plugins.
   */
  setSelection(selection: ChartSelection): void {
    this.#selection?.set(selection);
  }

  /**
   * @internal A click on plot point `p`, or on the legend row of `row`:
   * select the indicator there, or drop the indicator selection.
   */
  clickSelect(p: Point, row: Series | null): void {
    this.#selection?.click(row ?? this.#hitAt(p.x + this.plotLeft, p.y)?.series ?? null);
  }

  /**
   * @internal The selection, made with `make` the first time a plugin asks:
   * the drawings and indicators plugins, which bring the code, so a chart
   * without them selects nothing. It stays for the chart's life.
   */
  selector(make: (internals: ChartInternals) => SelectionFeature): void {
    this.#selection ??= make(this.internals());
  }

  /**
   * Install a plugin: its `install` registers drawing tools, indicators,
   * custom series and primitives through the context it gets. Throws a
   * `ChartError` `'plugin-incompatible'` when its `requires` range excludes
   * `CORE_VERSION`; an `install` that throws leaves nothing behind. Returns a
   * function that uninstalls it.
   */
  install(plugin: ChartPlugin): () => void {
    if (this.destroyed) throw destroyedError('install');
    return this.#plugins.install(plugin);
  }

  /**
   * Offer `host` to plugins under `name` (`ctx.host(name)` in `install`), or
   * withdraw it with null. A layer built on the chart, like the UI shell,
   * uses it to let plugins add to it. Plugins installed afterwards see it.
   */
  setPluginHost(name: string, host: unknown): void {
    this.#plugins.setHost(name, host);
  }

  /** Uninstall a plugin by name, removing everything it added; false when none has that name. */
  uninstall(name: string): boolean {
    return this.#plugins.uninstall(name);
  }

  /** Names of the installed plugins, in install order. */
  get installedPlugins(): string[] {
    return this.#plugins.names;
  }

  /**
   * Attach a drawing plugin to a series (it uses the series' scale and is
   * detached with it) or to a pane (default, when neither is given: the main
   * pane). Throws if the pane is not in this chart. Returns a detach function.
   */
  attachPrimitive(primitive: Primitive, target: PrimitiveTarget = {}): () => void {
    const pane = resolvePrimitivePane(this.panes, target);
    if (primitive.lane && !this.#optIn.depthLane && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('Primitive lanes are laid out by the depthLane() plugin: add it (or builtins()) to the chart', 'lanes-missing');
    }
    return this.primitives.attach(primitive, pane, target.series ?? null);
  }

  detachPrimitive(primitive: Primitive): void {
    this.primitives.detach(primitive);
  }

  /**
   * Add a depth lane: bars beside the price axis for bid and ask sizes the
   * app supplies with `setLevels` and `update`. It goes on the main pane
   * unless `pane` is given. `remove()` on the result detaches it. Needs the
   * `depthLane()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  addDepthLane(options: Partial<DepthLaneOptions> & { pane?: number | Pane } = {}): DepthLane & { remove(): void } {
    const { pane, ...rest } = options;
    const lane = (this.#optIn.depthLane ?? notInstalled('addDepthLane', 'depthLane()')).create(rest);
    const detach = this.attachPrimitive(lane, { pane });
    return Object.assign(lane, { remove: detach });
  }

  /**
   * Topmost primitive under a plot point (plot-relative css px: x from the
   * plot's left edge, which left price axes move right) that reports a hit.
   * Primitives on hidden series are ignored. Also drives the hover cursor.
   */
  primitiveAt(p: Point): { primitive: Primitive; hit: PrimitiveHit } | null {
    if (p.x < 0 || p.x > this.plotWidth || p.y < 0 || p.y > this.plotHeight) return null;
    const pane = this.panes[this.paneIndexAt(p.y)]!;
    const local = { x: p.x, y: p.y - pane.top };
    return this.primitives.hitTest(pane, local, (e) => this.#primitiveEnv(e, this.plotWidth, pane.height));
  }

  /**
   * Load data through `source` instead of pushing it with `setData`. Older
   * history then pages in automatically on scroll-back. Pass null to detach.
   * Needs the `dataSource()` plugin (or `builtins()`); throws a
   * `not-registered` `ChartError` for a source without it.
   */
  setDataSource(source: DataSource | null, options: Partial<DataControllerOptions> = {}): void {
    if (this.destroyed) return;
    // Checked before anything is torn down, so a chart without the plugin keeps what it shows.
    // `feature` is set exactly when `source` is.
    const feature = source ? (this.#optIn.dataSource ?? notInstalled('setDataSource', 'dataSource()')) : null;
    // Disposing drops an in-flight load and the feed without an event; their messages must not linger.
    const kind = this.status?.kind;
    if (kind === 'loading' || kind === 'reconnecting' || kind === 'stale') this.setStatus(null);
    this.#sourceBars = null;
    this.#setAdjustments([]);
    this.#delay = 0;
    this.#refreshBadge();
    this.dataController?.dispose();
    // Markers of the old source go, announced by `sourcemarkers:change`.
    this.#markersLoader?.reset();
    this.#markersLoader?.dispose();
    this.annotationLayer?.[SET_SOURCE_MARKS]([]);
    this.annotationLayer?.[SET_TIME_MARKS]([]);
    this.#optIn.referenceLines?.setQuote(null);
    this.#pendingLoad = null;
    this.pendingRange = null;
    // Compared symbols load through the old source; drop them with it.
    this.#optIn.comparisons?.clear(false);
    this.dataController = source && feature
      ? feature.connect(
          this,
          {
            setDelay: (delay) => {
              this.#delay = delay;
              this.#refreshBadge();
            },
            markers: () => this.#markersLoader,
            markersContext: () => this.#markersContext(),
          },
          source,
          {
            setData: (bars, kind) => {
              if (kind === 'initial') this.#followSymbolTimezone();
              this.#sourceBars = bars;
              // Another symbol or interval: a replay of the old bars ends.
              if (kind === 'initial') this.#optIn.replay?.cancel();
              this.#showMainData(this.#adjust(bars));
              this.#optIn.comparisons?.sync(kind);
              // Refetched bars may start elsewhere; the view keeps its right edge.
              if (kind === 'reset') this.#historyGate.reset();
              if (kind !== 'initial') return;
              // A new series may share its first bar time with the old one.
              this.#historyGate.reset();
              this.#positionInitial();
            },
            prepend: (older, bars) => {
              const main = this.#mainCandles();
              const first = main.data[0]?.time;
              // Older bars go in front on their own, unless a replay holds the bars back or an
              // adjustment newly known for the loaded bars rescales them too; then all are set again.
              const page =
                !this.#optIn.replay?.active &&
                first !== undefined &&
                (this.#optIn.adjustments?.sameAfter(this.#prependAdjustments, this.#adjustments, first, this.options.adjustment) ?? true);
              this.#sourceBars = bars;
              if (!page || !main.prependBars(this.#adjust(older))) this.#showMainData(this.#adjust(bars));
              this.#optIn.comparisons?.sync('history');
            },
            update: (bar) => {
              const adjusted = this.#adjustLive(bar);
              // While replaying, a live bar waits hidden until the replay reaches it.
              if (this.#optIn.replay?.active) this.#optIn.replay.absorb(adjusted);
              else this.#mainCandles().update(adjusted);
            },
            setAdjustments: (adjustments) => this.#setAdjustments(adjustments),
            dropped: (bar, reason) => this.emit('data:dropped', { reason, bar, series: this.#mainSeries }),
            lookback: () => this.indicatorLayer?.lookback ?? 0,
            setPriceFormat: (priceFormat) => {
              // Leave a format the app set alone; clear only one an earlier symbol brought.
              if (!priceFormat && !this.#sourceFormat) return;
              this.#sourceFormat = !!priceFormat;
              this.#mainCandles().applyOptions({ priceFormat });
            },
          },
          options,
        )
      : null;
    this.#makeMarkersLoader();
    // External indicator data stops with the old source.
    this.indicatorLayer?.dataLoaded();
  }

  /**
   * Plot `symbol` next to the main one, loaded and streamed through the data
   * source on the main symbol's interval and history. `percent` (default)
   * overlays the main pane and switches it to percent mode, so both lines
   * start at 0% at the left edge; `scale` gives the symbol its own left axis;
   * `pane` puts it in a new pane. Bars it lacks leave gaps in its line.
   * `style` draws it as `'candles'` or OHLC `'bars'` instead of a line, in
   * `scale` and `pane` modes; on the main pane they take `color`.
   * Instead of a symbol, a pair `{ ratio: [a, b] }` or `{ spread: [a, b],
   * weights? }` plots the two symbols combined bar by bar, with gaps where
   * either has no bar; both are loaded and removed together. Needs the
   * `comparisons()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  compare(
    what: string | ComparePair,
    options: { mode?: CompareMode; style?: CompareStyle; color?: string; title?: string } = {},
  ): ComparedSymbol {
    if (this.destroyed) throw destroyedError('compare');
    return (this.#optIn.comparisons ?? notInstalled('compare', 'comparisons()')).add(what, options);
  }

  /** Compared symbols, in the order they were added; empty without the `comparisons()` plugin. */
  get compared(): readonly ComparedSymbol[] {
    return this.#optIn.comparisons?.list ?? [];
  }

  /**
   * Bar replay of the main series: `start(time)` hides the bars after `time`,
   * `step`, `play` and `pause` reveal them, `stop` shows everything again.
   * Bars from the data source that arrive meanwhile wait hidden. Emits
   * `replay:change`. Needs the `replay()` plugin (or `builtins()`); throws a
   * `not-registered` `ChartError` without it.
   */
  get replay(): Replay {
    return this.#optIn.replay ?? notInstalled('replay', 'replay()');
  }

  /**
   * Optional price lines of the main series: previous close, the visible
   * high, low and average close, bid, ask and extended hours. Needs the
   * `referenceLines()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it. The `referenceLines` option is kept for it.
   */
  get referenceLines(): ReferenceLines {
    return this.#optIn.referenceLines ?? notInstalled('referenceLines', 'referenceLines()');
  }

  /**
   * The watermark `features.watermark` shows: the symbol and interval loaded
   * through the data source. Restyle or retext it with `applyOptions`. Needs
   * the `watermark()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  get watermark(): Watermark {
    return this.#optIn.watermark ?? notInstalled('watermark', 'watermark()');
  }

  /** @internal Makes the series' last-point pulse clocks (`SeriesHost.pulse`); null without the `lastPointPulse()` plugin. */
  get pulse(): SeriesHost['pulse'] {
    return this.#optIn.pulse;
  }

  /** @internal Makes the drawers of the `kagi` and `pointFigure` styles (`SeriesHost.priceStyles`); null without the `priceStyles()` plugin. */
  get priceStyles(): SeriesHost['priceStyles'] {
    return this.#optIn.priceStyles;
  }

  /** The data source controller: current symbol, interval and loading state. Null without a source (see `setDataSource`). */
  get data(): DataController | null {
    return this.dataController;
  }

  /**
   * The data source's markers known for the shown symbol and interval, by
   * time, on bars and on the time axis alike (see `DataSource.markers`);
   * empty when it has none, or while the `marks` and `timeMarks` options are
   * both off. Named "source" to set them apart from the app's markers
   * (`annotations.getMarkers`). The array and its markers are frozen.
   * `sourcemarkers:change` reports every change.
   */
  get sourceMarkers(): readonly SourceMarker[] {
    return this.#markersLoader?.markers ?? [];
  }

  /** The loader of the data source's markers, made by the `sourceMarkers()` plugin; none without it. */
  #makeMarkersLoader(): void {
    this.#markersLoader?.reset();
    this.#markersLoader?.dispose();
    const source = this.dataController?.source;
    const feature = this.#optIn.sourceMarkers;
    const emit = <K extends keyof DataEvents>(event: K, payload: DataEvents[K]) => this.emit(event, payload as ChartEvents[K]);
    // The annotations redraw the markers; only the band of the time-axis badges appearing changes the layout.
    const show = (_: unknown, band: boolean) => (this.#syncMarks(), band && this.invalidate());
    this.#markersLoader = source?.markers && feature ? feature.loader(source as MarkersSource, show, emit) : null;
    if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' && !feature && source?.markers) {
      devWarnOnce('The data source serves markers, but they are not fetched without the sourceMarkers() plugin: add it (or builtins()) to the chart', 'source-markers-missing');
    }
  }

  /** A new symbol or interval landed: its markers are fetched for the view, unless the `marks` and `timeMarks` options are both off. */
  #markersContext(): void {
    const { symbol, interval } = this.dataController ?? {};
    const loader = this.#markersLoader;
    if (!symbol || !interval || !loader) return;
    loader.setWanted(this.options.marks || this.options.timeMarks);
    loader.setContext(symbol, interval);
    const range = this.getVisibleRange();
    if (range) loader.setView(range.from, range.to);
  }

  /** Load `symbol` at `interval` from the data source. Rejects when loading fails. */
  setSymbol(symbol: string, interval: Interval): Promise<void> {
    if (this.destroyed) return Promise.reject(destroyedError('setSymbol'));
    const data = this.dataController;
    if (!data) return Promise.reject(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'setSymbol needs a data source: install dataSource() and call setDataSource first' : ''));
    // Bounds belong to the symbol and interval they were set for.
    const changed = data.symbol?.symbol !== symbol || data.interval !== interval;
    if (changed) this.#optIn.viewportBounds?.contextChanged();
    const sameSymbol = data.symbol?.symbol === symbol && data.interval !== null && data.interval !== interval;
    const kept = this.options.keepRangeOnIntervalChange && sameSymbol ? this.#keptRange() : null;
    const resetView = !this.options.keepZoomOnSymbolChange && data.symbol !== null && data.symbol.symbol !== symbol;
    // Announced before the load starts; an invalid interval is rejected by the load without a change.
    if (isInterval(interval)) this.#announceSymbol(symbol);
    return this.#trackLoad(data, data.setSymbol(symbol, interval), kept, resetView);
  }

  /**
   * The visible time range an interval switch keeps. A view that reaches the
   * newest bar keeps the newest bar: the old bar's open time would cut off the
   * shorter bars that follow it, and page in history to fill the plot behind it.
   */
  #keptRange(): { from: Time; to: Time } | null {
    const range = this.getVisibleRange();
    const last = this.timeline.times[this.timeline.length - 1];
    return range && last !== undefined && range.to >= last ? { from: range.from, to: Infinity } : range;
  }

  /** Emit `symbol:change` when `symbol` differs from the one the last `setSymbol` asked for. */
  #announceSymbol(symbol: string): void {
    const previous = this.#requestedSymbol;
    this.#requestedSymbol = symbol;
    if (symbol !== previous) this.emit('symbol:change', { symbol, previous });
  }

  /**
   * Load the current symbol and interval again, bypassing the cache and
   * aborting requests in flight. Shows the newest bars, or with `keepView`
   * the visible time range. Rejects when loading fails.
   */
  reload(options: { keepView?: boolean } = {}): Promise<void> {
    const data = this.dataController;
    if (!data) return Promise.reject(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'reload needs a data source: install dataSource() and call setDataSource first' : ''));
    const kept = options.keepView ? this.getVisibleRange() : null;
    const load = this.#trackLoad(data, data.reload(), kept);
    // Compared symbols reload too; failures are reported as `compare:error`.
    this.#optIn.comparisons?.reload();
    return load;
  }

  /** Position the view once `load` lands, on `kept` if given. */
  #trackLoad(
    data: DataController,
    load: Promise<void>,
    kept: { from: Time; to: Time } | null,
    resetView = false,
  ): Promise<void> {
    // Only a load that brings new bars positions the view; a repeated call joins the one in flight.
    if (load !== data.initialLoad) return load;
    if (this.#pendingLoad?.load !== load) {
      this.#pendingLoad = { load, view: null, resetView };
      this.pendingRange = kept && { ...kept, load };
    }
    const done = load.then(() => {
      // Disposing the controller settles its load early; the caller must not take that for success.
      if (this.destroyed) throw destroyedError('setSymbol');
      // History can only page in once the initial load has finished.
      const range = this.pendingRange;
      if (range?.load === load) return this.#restoreRange(range);
    });
    load.catch(() => {
      this.#dropPending(load);
      // `data:error` already reported it: an app that listens there need not also catch.
      if (this.#emitter.has('data:error')) done.catch(() => {});
    });
    return done;
  }

  /** Forget what was pending for `load`: it failed. */
  #dropPending(load: Promise<void>): void {
    if (this.#pendingLoad?.load === load) this.#pendingLoad = null;
    if (this.pendingRange?.load === load) this.pendingRange = null;
  }

  /**
   * An explicit view change wins over a range kept across an interval switch.
   * While a `setSymbol` load is pending it is replayed on the new bars, a time
   * range after paging in the history it needs.
   */
  #viewChange(replay: () => void, range?: { from: Time; to: Time }): void {
    this.#rangeHold = -1;
    const pending = this.#pendingLoad;
    this.pendingRange = pending && range ? { ...range, load: pending.load } : null;
    if (pending) pending.view = range ? null : replay;
  }

  /**
   * Position the view on a newly loaded symbol or interval: replay a view
   * change made while it loaded, hold a pending range's right edge (it fits
   * once `setSymbol` settles), or show the newest bars, at the default zoom
   * for a new symbol with `keepZoomOnSymbolChange` off.
   */
  #positionInitial(): void {
    const pending = this.#pendingLoad;
    this.#pendingLoad = null;
    // A load started on the controller directly is not the one recorded.
    if (!pending || pending.load !== this.dataController?.initialLoad) this.pendingRange = null;
    else if (pending.view) return pending.view();
    if (this.pendingRange) this.#keepRightEdge(this.pendingRange.to);
    else if (pending?.resetView) this.resetView(false);
    else this.scrollToRealtime(false);
  }

  /** Scroll so `time` sits at the right edge (with the usual margin when it is the newest bar). */
  #keepRightEdge(time: Time): void {
    const tl = this.timeline;
    if (tl.length === 0) return;
    const right = this.#endIndex(time);
    const pad = right >= tl.lastIndex ? this.#rightPad() : 0;
    this.time.animateTo({ rightOffset: right - tl.lastIndex + pad }, 0);
    this.redraw('view');
  }

  /** Fractional index a range ending at `time` ends on, at most the newest bar's (any loaded bars). */
  #endIndex(time: Time): number {
    const tl = this.timeline;
    // At or past the newest bar (Infinity included) without projecting the future calendar.
    return time >= tl.times[tl.length - 1]! ? tl.lastIndex : tl.indexFromTime(time);
  }

  /**
   * Show `range` on freshly loaded bars (its right edge is already kept): page
   * history in, one page per task, until its start is loaded or the bars
   * before its end fill the plot at the narrowest spacing, then fit it once.
   * A newer load, or the user moving the view meanwhile, cancels it.
   */
  async #restoreRange(range: PendingRange): Promise<void> {
    const data = this.dataController;
    const tl = this.timeline;
    const current = () =>
      !this.destroyed && this.pendingRange === range && this.dataController === data && data?.initialLoad === null;
    if (!data || !current()) return;
    // Only a pan or zoom means the user moved the view. Paged history changes the
    // limits clamp applies, and a live bar shifts the offset; neither counts.
    const moves = this.time.moves;
    const moved = () => this.time.moves !== moves;
    for (let page = 0; page < MAX_RANGE_PAGES && !moved(); page++) {
      const first = tl.times[0];
      if (first === undefined || first <= range.from || !data.hasMoreHistory || this.#fillsPlot(range.to)) break;
      await nextTask();
      if (!current()) return;
      if (moved() || !(await data.loadMore())) break;
      if (!current()) return;
    }
    this.pendingRange = null;
    if (tl.length === 0 || moved()) return;
    this.setVisibleTimeRange(range.from, range.to, false);
  }

  /**
   * Whether the loaded bars up to `to` fill the plot at the narrowest bar
   * spacing. A range fitted there keeps its right edge, so older bars would
   * not show: paging them in for it is wasted work.
   */
  #fillsPlot(to: Time): boolean {
    const tl = this.timeline;
    if (this.plotWidth <= 0 || tl.length === 0) return false;
    const right = this.#endIndex(to);
    const pad = right >= tl.lastIndex ? this.#rightPad() : 0;
    return (right + pad) * this.time.floorSpacing >= this.plotWidth;
  }

  applyOptions({ plugins: _plugins, ...options }: ChartOptionsPatch): void {
    if (this.destroyed) return;
    devCheck('applyOptions', options, 'chart');
    const adjustment = this.options.adjustment;
    // First, so invalid options throw before anything changes; `layout` below clamps the view to the limits.
    const groups = checkCrosshair(mergeGroups(this.options, options));
    const grouping = options.grouping === undefined ? this.options.grouping : options.grouping;
    checkGrouping(grouping);
    const localization = options.localization ? { ...this.options.localization, ...options.localization } : null;
    if (localization) checkLocalization(localization);
    const localizer = localization && this.#optIn.localizer ? this.#optIn.localizer(localization) : null;
    if (options.access) checkAccess(options.access);
    if (options.referenceLines) checkReferenceLines(options.referenceLines);
    this.time.setLimits({ ...this.options, ...options, grouped: Boolean(grouping && this.#optIn.grouping) });
    const lines = this.#optIn.referenceLines;
    if (options.referenceLines) lines?.applyOptions(options.referenceLines);
    // Keep the resolved reference line options, not the patch; without the plugin, the patches merged per line.
    this.options = {
      ...this.options,
      ...options,
      access: this.options.access,
      referenceLines: lines ? lines.options : mergeLines(this.options.referenceLines, options.referenceLines),
      ...groups,
      localization: localization ?? this.options.localization,
    };
    const previousLocalizer = this.#localizer;
    if (localizer) this.#setLocalizer(localizer);
    // `interactive` and `gl` are fixed at creation; a static chart keeps its settled drawing.
    this.options.interactive = this.#created.interactive;
    this.options.gl = this.#created.gl;
    if (!this.#created.interactive) Object.assign(this.options, { animateViewChanges: false, smoothScale: false, smoothZoom: false });
    if (options.priceAxisWidth !== undefined || options.priceAxis !== undefined) this.#syncAxisWidths();
    if (options.accessibility) this.#description.setOptions(this.options.accessibility);
    if (options.timezone !== undefined) {
      this.#appTimezone = options.timezone;
      // An explicit timezone wins over the symbol's, unless following it is switched on in the same call.
      this.#timezonePinned = this.options.applySymbolTimezone && options.applySymbolTimezone !== true;
    }
    if (options.applySymbolTimezone === true) this.#timezonePinned = false;
    const zoneChanged = options.applySymbolTimezone !== undefined && this.#followSymbolTimezone(false);
    if (zoneChanged || options.timezone !== undefined || options.session !== undefined || 'extendedSession' in options) {
      this.#applyZone();
    }
    this.#refreshBadge();
    // Re-emit so listeners see the price under the new snapping mode.
    if (options.crosshair?.mode && this.crosshair && !this.mirror) this.setCrosshair(this.crosshair);
    const themeBefore = options.theme ? this.theme : null;
    if (options.theme) {
      // Typography merges per surface, so a patch to one block keeps the others.
      const typography = mergeTypography(this.theme.typography, options.theme.typography);
      this.theme = resolveTheme({ ...this.theme, ...options.theme, ...(typography && { typography }) });
      // Followers may color by theme (e.g. volumeOf), so map them again.
      const failure = this.#followAll(this.mainBars, 'reset');
      this.#styleRoot();
      this.#styleScrollButton();
      this.#forEachSeries((s) => s.rebuild());
      if (failure) throw failure.error;
    }
    this.#syncFeatures(options);
    if (options.access) this.#applyAccess(options.access);
    if (options.focusable !== undefined) this.root.tabIndex = options.focusable ? 0 : -1;
    // Resize the GL canvas for the new cap; the size check would skip an unchanged container.
    if (options.maxGlDpr !== undefined || options.lowPower !== undefined) this.#measure(true);
    if (options.lowPower !== undefined) this.#lowPowerChanged();
    // Re-adjust the bars already loaded; nothing is fetched again.
    if (options.adjustment !== undefined) this.#showAdjusted();
    if (this.options.adjustment !== adjustment) this.#rebaseDrawings(this.#adjustments, adjustment);
    if (options.adjustmentMarkers !== undefined) this.#syncAdjustmentMarkers();
    if (options.adjustment !== undefined || options.adjustmentMarkers !== undefined) this.#adjustmentsNeeded();
    if (options.marks !== undefined || options.timeMarks !== undefined) {
      // Both off fetches nothing and drops the markers; one back on fetches them for the view.
      this.#markersLoader?.setWanted(this.options.marks || this.options.timeMarks);
      this.#syncMarks();
    }
    // Only when the flag is set, so a watermark attached by hand survives other options.
    if (options.features?.watermark !== undefined) this.#syncWatermark();
    if (options.features?.attributionLogo !== undefined) {
      this.#optIn.watermark?.applyOptions({ logo: this.#flags.attributionLogo });
      this.invalidate();
    }
    if (process.env.NODE_ENV !== 'production') {
      this.#watermarkNeeded(options);
      this.#countdownNeeded(options);
      this.#marketStatusNeeded(options);
      this.#localizationNeeded(options);
      this.#referenceLinesNeeded(options);
      this.#groupingNeeded(options);
    }
    if (process.env.NODE_ENV !== 'production' && (options.renderStats || options.renderStatsOverlay)) this.#statsOverlayNeeded();
    if (this.options.interactive) this.interaction.featuresChanged();
    this.#syncDirection();
    this.#layout();
    this.redraw('options');
    if (options.renderWhenHidden !== undefined) this.#syncPaused();
    if (options.theme || options.grid) this.emit('appearance:change', this.appearance());
    if (themeBefore && !sameTheme(themeBefore, this.theme)) this.emit('theme:change', { theme: this.appearance().theme });
    if (localizer) {
      this.indicatorLayer?.relabel(previousLocalizer);
      this.emit('localization:change', { locale: localizer.locale });
    }
  }

  /**
   * Numbers, dates and built-in text in the language of the `localization`
   * option, e.g. `chart.localization.number(1234.5, 2)` or
   * `chart.localization.text('statusLoading')`. Replaced by a new object when
   * the option changes (`localization:change`). Without the `localization()`
   * plugin, always `englishLocalizer`.
   */
  get localization(): Localizer {
    return this.#localizer;
  }

  #setLocalizer(localizer: Localizer): void {
    this.#localizer = localizer;
    const label = localizer.text('scrollToLatest');
    this.#scrollButton.title = label;
    this.#scrollButton.setAttribute('aria-label', label);
    this.#description.setLabel(this.dataController?.symbol?.name ?? null, this.#accessibleName());
    // Labels change width with the language: re-measure the axes.
    this.#syncAxisWidths();
    this.#forEachSeries((s) => s.rebuild());
    this.#syncAdjustmentMarkers();
  }

  /** The chart's accessible name when the `accessibility.label` option leaves it out. */
  #accessibleName(): string {
    const symbol = this.dataController?.symbol?.name;
    return symbol ? this.#localizer.text('chartLabelSymbol', { symbol }) : this.#localizer.text('chartLabel');
  }

  /** The resolved theme and grid colors, e.g. to show the current values in a settings UI. */
  appearance(): ChartAppearance {
    return {
      theme: { ...this.theme, heatmap: [...this.theme.heatmap] },
      grid: resolveGrid(this.options.grid, this.theme),
    };
  }

  /**
   * The root shows the background before the first frame. A translucent
   * background is left to the canvas alone, so it is not painted twice and
   * the page shows through as much as the color says.
   */
  #styleRoot(): void {
    setRootBackground(this.root, this.theme.background);
  }

  /**
   * A bar was appended that the view followed (the newest bar is on screen):
   * slide over to it at constant speed for `ms`, the time until the next bar,
   * instead of jumping a bar. While a replay plays, one slide ends as the next
   * bar comes, so the chart scrolls continuously.
   */
  #glideToNewest(ms: number): void {
    const t = this.time;
    if (this.#viewMs(true) <= 0 || t.visibleRange().to < t.barCount - 1) return;
    // The right offset counts empty bars after the newest one, which took one of them:
    // one fewer keeps every bar where it was, and the slide moves them left by a bar.
    const { rightOffset } = t.target();
    t.rightOffset -= 1;
    // A bar is a few pixels: the slide is mostly under a pixel per frame. Bars snap to device
    // pixels one by one, so moving freely they would step at different frames and ripple.
    t.animateTo({ rightOffset }, ms, 1 / this.#deviceBarSpacing, (p) => p);
    this.redraw('view');
  }

  /** Scroll to the newest bar keeping the configured right offset. */
  scrollToRealtime(animate = true): void {
    if (this.destroyed) return;
    this.#viewChange(() => this.scrollToRealtime(false));
    this.time.animateTo({ rightOffset: this.options.rightOffset }, this.#viewMs(animate));
    this.#reportClamp(this.time.barSpacing, this.options.rightOffset);
    this.redraw('view');
  }

  /**
   * Keep the view inside a time window and a price band, through every
   * pointer, keyboard and programmatic path; null removes the bounds. Panning
   * slides along the edges without zooming, zooming out stops once the window
   * fills the plot, and a price bound turns that scale's autoscale off (back
   * on when cleared). Bounds clear on a symbol or interval change unless
   * `keepOnContextChange` is set. Throws on bounds that are not finite or out
   * of order. Needs the `viewportBounds()` plugin (or `builtins()`); throws a
   * `not-registered` `ChartError` without it.
   */
  setViewportBounds(bounds: ViewportBounds | null): void {
    if (this.destroyed) return;
    (this.#optIn.viewportBounds ?? notInstalled('setViewportBounds', 'viewportBounds()')).set(bounds);
    this.#syncTimeBounds();
    this.time.clamp();
    this.redraw('view');
    this.#emitScaleState(true);
  }

  /** The bounds set with `setViewportBounds`, or null. */
  get viewportBounds(): ViewportBounds | null {
    return this.#optIn.viewportBounds?.get() ?? null;
  }

  /** Turn the time bounds into bar indices for the time scale; call whenever the timeline changes. */
  #syncTimeBounds(): void {
    this.time.bounds = this.#optIn.viewportBounds?.time(this.timeline) ?? null;
  }

  /** Emit `viewport:clamp` when the view the time scale is heading to differs from the one asked for. */
  #reportClamp(spacing: number, rightOffset: number): void {
    if (!this.time.bounds || this.timeline.length === 0 || !(spacing > 0)) return;
    const target = this.time.target();
    const requested = this.#timeRangeAt(spacing, rightOffset);
    const applied = this.#timeRangeAt(target.barSpacing, target.rightOffset);
    if (requested.from !== applied.from || requested.to !== applied.to) this.emit('viewport:clamp', { axis: 'time', requested, applied });
  }

  /** Times of the first and last whole bar a view with this spacing and offset shows. */
  #timeRangeAt(spacing: number, rightOffset: number): { from: Time; to: Time } {
    const right = this.time.barCount - 1 + rightOffset;
    const left = right - this.time.width / spacing;
    return { from: this.timeline.timeFromIndex(Math.ceil(left - 1e-6)), to: this.timeline.timeFromIndex(Math.floor(right + 1e-6)) };
  }

  /**
   * Pixel grouping: bars per bucket as `2 ** groupLevel`; 0 without pixel
   * grouping or while single bars are at least two device pixels wide.
   * @internal
   */
  get groupLevel(): number {
    return this.#optIn.grouping?.level(this.#deviceBarSpacing) ?? 0;
  }

  /** Pixel ratio cap of the GPU layer: `maxGlDpr`, and at most 1 in low-power mode. */
  private get glDprCap(): number {
    return this.options.lowPower ? Math.min(1, this.options.maxGlDpr) : this.options.maxGlDpr;
  }

  /** Bar spacing in device pixels of the GPU layer on screen (also during a larger screenshot, so it groups alike). */
  get #deviceBarSpacing(): number {
    return this.time.barSpacing * Math.min(this.capture?.dpr ?? this.dpr, this.glDprCap);
  }

  /**
   * How the view groups bars into buckets now, or null when it draws single
   * bars (always without the `grouping()` plugin).
   * @internal Read by the series every frame.
   */
  get buckets(): Buckets | null {
    return this.#optIn.grouping?.buckets(this.#deviceBarSpacing) ?? null;
  }

  /** @internal What series group bars with (`SeriesHost.groupLevels`); null without the `grouping()` plugin. */
  get groupLevels(): SeriesLevels | null {
    return this.#optIn.grouping?.levels ?? null;
  }

  /** First and last timeline index of the bucket holding `index` while grouping, or null. */
  #bucketSpan(index: number): { from: number; to: number } | null {
    const g = this.buckets;
    if (!g || this.timeline.length === 0) return null;
    const j = g.of(Math.round(index));
    return { from: g.start(j), to: Math.min(this.timeline.lastIndex, g.end(j) - 1) };
  }

  /** The source span of the main series' price bar at `time` (its `startTime` and `endTime`), or null. */
  #sourceSpan(time: Time): { time: Time; endTime: Time } | null {
    const b = this.#mainSeries && (atTime(this.#mainSeries.data, time) as Partial<PriceBar> | undefined);
    return typeof b?.startTime === 'number' && typeof b.endTime === 'number' ? { time: b.startTime, endTime: b.endTime } : null;
  }

  /** The time label of the bar at `index`: its bucket's or price bar's first and last time, else its own. */
  #spanText(index: number): string {
    const tl = this.timeline;
    const span = this.#bucketSpan(index);
    const at = tl.timeFromIndex(index);
    const { time, endTime } = span ? { time: tl.timeFromIndex(span.from), endTime: tl.timeFromIndex(span.to) } : (this.#sourceSpan(at) ?? { time: at, endTime: at });
    const from = this.formatTime(time);
    return endTime > time ? `${from} – ${this.formatTime(endTime)}` : from;
  }

  /** How the view groups bars now, or null when it draws single bars (always without the `grouping()` plugin). */
  get grouping(): GroupingState | null {
    return this.#optIn.grouping?.state(this.#deviceBarSpacing) ?? null;
  }

  /** Emit `grouping:change` when the bucketing differs from the last frame's. */
  #emitGrouping(): void {
    const key = this.#optIn.grouping?.key(this.#deviceBarSpacing) ?? null;
    if (key === this.#lastGroupKey) return;
    this.#lastGroupKey = key;
    this.emit('grouping:change', this.grouping);
  }

  /**
   * Fit every bar in view. Bars never get narrower than `minBarSpacing`
   * (unless `grouping` is on, which needs the `grouping()` plugin), so at most
   * `plotWidth / minBarSpacing` fit: returns false when the view had to be cut
   * short (lower `minBarSpacing` or turn on `grouping` to fit more), or there
   * are no bars.
   * Turns autoscale back on, except on scales with a locked price-to-bar ratio.
   */
  fitContent(animate = true): boolean {
    if (this.destroyed) return false;
    this.#viewChange(() => this.fitContent(false));
    if (this.time.barCount === 0) return false;
    const pad = this.#rightPad();
    const spacing = this.plotWidth / (this.time.barCount + pad);
    this.time.animateTo({ barSpacing: spacing, rightOffset: pad }, this.#viewMs(animate));
    this.#rangeHold = this.time.moves;
    this.#reportClamp(spacing, pad);
    this.#resetAutoScale(undefined, true);
    this.redraw('view');
    return spacing >= this.time.floorSpacing;
  }

  /**
   * Show the time span [from, to] (unix seconds) across the plot. Returns
   * false when it holds more bars than fit at `minBarSpacing` (any number fit
   * with `grouping` on; the view then
   * shows the newest part of it), or nothing could be shown yet. Turns the
   * main pane's autoscale back on, except on scales with a locked price-to-bar ratio.
   */
  setVisibleTimeRange(from: Time, to: Time, animate = true): boolean {
    if (this.destroyed) return false;
    this.#viewChange(() => this.setVisibleTimeRange(from, to, false), { from, to });
    if (this.timeline.length === 0 || this.plotWidth <= 0) return false;
    const { wanted, rightOffset } = this.#showTimeRange(from, to, this.#viewMs(animate));
    this.#rangeHold = this.time.moves;
    this.#reportClamp(wanted, rightOffset);
    this.#resetAutoScale(0, true);
    this.redraw('view');
    return wanted >= this.time.floorSpacing;
  }

  /** Move the time scale so `from` and `to` bound the view; returns the spacing that needs, before clamping. */
  #showTimeRange(from: Time, to: Time, ms: number): { wanted: number; rightOffset: number } {
    const tl = this.timeline;
    const a = tl.indexFromTime(from);
    const b = this.#endIndex(to);
    // Keep the usual right margin when the range reaches the newest bar.
    const pad = b >= tl.lastIndex ? this.#rightPad() : 0;
    // Bar a sits on the left edge and b (plus the margin) on the right, so getVisibleRange returns [from, to].
    const wanted = this.plotWidth / Math.max(1, b - a + pad);
    const rightOffset = b - tl.lastIndex + pad;
    this.time.animateTo({ barSpacing: clampNum(wanted, this.time.floorSpacing, this.time.maxBarSpacing), rightOffset }, ms);
    return { wanted, rightOffset };
  }

  /** The configured right offset, cut to the most the limits allow, so a fitted range is not clamped off. */
  #rightPad(): number {
    return Math.min(this.options.rightOffset, this.time.maxOffset());
  }

  /** Default zoom, newest bar in view, all panes autoscaled. */
  resetView(animate = true): void {
    if (this.destroyed) return;
    this.#viewChange(() => this.resetView(false));
    this.time.animateTo(
      { barSpacing: this.options.barSpacing, rightOffset: this.options.rightOffset },
      this.#viewMs(animate),
    );
    this.#reportClamp(this.options.barSpacing, this.options.rightOffset);
    this.#resetAutoScale();
    this.redraw('view');
  }

  getPriceScaleMode(pane = 0, scale = 'right'): PriceScaleMode {
    return this.panes[pane]?.scale(scale).mode ?? 'normal';
  }

  setPriceScaleMode(mode: PriceScaleMode, pane = 0, scale = 'right'): void {
    this.setPriceScaleOptions({ mode, autoScale: true }, pane, scale);
  }

  isAutoScale(pane = 0, scale = 'right'): boolean {
    return this.panes[pane]?.scale(scale).autoScale ?? true;
  }

  setAutoScale(on: boolean, pane = 0, scale = 'right'): void {
    this.setPriceScaleOptions({ autoScale: on }, pane, scale);
  }

  /**
   * Change a price scale of a pane (default the right one). Scales are created
   * on first use: give a series `priceScale: 'my-scale'`, then
   * `setPriceScaleOptions({ side: 'left' }, 0, 'my-scale')` to show its axis.
   */
  setPriceScaleOptions(options: Partial<PriceScaleSettings>, pane = 0, scale = 'right'): void {
    const p = this.panes[pane];
    if (!p) return;
    const fixed = options.fixedRange;
    if (fixed !== undefined && fixed !== null && !(Number.isFinite(fixed.min) && Number.isFinite(fixed.max) && fixed.min < fixed.max)) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale fixedRange needs finite min < max' : '');
    }
    const rule = options.autoscaleRule;
    const ruleError = rule === undefined || rule === null ? null : autoscaleRuleError(rule);
    if (ruleError) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Price scale autoscaleRule ${ruleError}` : '');
    const ratio = options.priceToBarRatio;
    if (ratio !== undefined && ratio !== null && !(Number.isFinite(ratio) && ratio > 0)) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale priceToBarRatio must be a positive number' : '');
    }
    if (options.side !== undefined && !['left', 'right', 'none'].includes(options.side)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown price scale side "${options.side}"` : '');
    }
    if (options.mode !== undefined && !['normal', 'log', 'percent', 'indexed'].includes(options.mode)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown price scale mode "${options.mode}"` : '');
    }
    const margin = (v: number | null | undefined) => v == null || (Number.isFinite(v) && v >= 0 && v < 1);
    if (!margin(options.marginTop) || !margin(options.marginBottom)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale margins must be in [0, 1)' : '');
    if (options.invert !== undefined && typeof options.invert !== 'boolean') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale invert must be a boolean' : '');
    if (options.percentBase !== undefined && !isPercentBase(options.percentBase)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? "Price scale percentBase must be 'firstVisible', 'sessionOpen', 'previousClose' or { time }" : '');
    }
    const s = p.scale(scale);
    if ((options.marginTop ?? s.marginTop ?? 0) + (options.marginBottom ?? s.marginBottom ?? 0) >= 1) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale margins must add up to less than 1' : '');
    }
    // fixedRange is in prices in every mode, and a log scale has none at or below zero. Switching a
    // scale with such a range to log does not throw: log mode ignores the range until the scale leaves it.
    if (fixed && (options.mode ?? s.mode) === 'log' && !(fixed.min > 0)) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price scale fixedRange on a log scale must be above zero' : '');
    }
    if (options.mode !== undefined) s.setMode(options.mode);
    if (options.side !== undefined) {
      s.side = options.side;
      if (s === p.price) this.#pinnedSides.add(s);
    }
    if (options.invert !== undefined) s.invert = options.invert;
    if (options.percentBase !== undefined) s.percentFrom = copyPercentBase(options.percentBase);
    // Null hands a side back to the chart, which sizes it on the next frame.
    if (options.marginTop !== undefined) s.marginTop = options.marginTop;
    if (options.marginBottom !== undefined) s.marginBottom = options.marginBottom;
    if (fixed !== undefined) s.fixedRange = fixed && { min: fixed.min, max: fixed.max };
    if (rule !== undefined) s.autoscaleRule = rule && copyRule(rule);
    if (options.autoScale !== undefined) s.autoScale = options.autoScale;
    // Autoscale and a locked ratio exclude each other: the last one asked for wins.
    if (options.autoScale === true && options.lockPriceToBarRatio !== true) s.lockRatio(null);
    // A missing or null ratio locks at the current one (NaN: captured on the next frame).
    if (options.lockPriceToBarRatio !== undefined) s.lockRatio(options.lockPriceToBarRatio ? (ratio ?? NaN) : null);
    else if (ratio !== undefined && s.barRatio !== null) s.lockRatio(ratio ?? NaN);
    // A side change can add or drop an axis column; the next frame relays out only if it does.
    this.redraw('view');
    this.#emitScaleState(true);
  }

  /**
   * Show exactly `from` to `to` (prices in every mode, in any order) on a
   * price scale of a pane (default the right one) and turn its autoscale off;
   * `animate` eases there. Throws a RangeError for equal or non-finite prices,
   * or prices at or below zero on a log scale.
   */
  setPriceRange(range: { from: number; to: number }, pane = 0, scale = 'right', animate = false): void {
    if (this.destroyed) return;
    const p = this.panes[pane];
    if (!p) return;
    const lo = Math.min(range.from, range.to);
    const hi = Math.max(range.from, range.to);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price range needs two different finite prices' : '');
    const s = p.scale(scale);
    if (s.isLog && !(lo > 0)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price range on a log scale must be above zero' : '');
    s.setRange(lo, hi, this.#viewMs(animate) > 0);
    if (s.bounds) {
      const [ca, cb] = [s.toCoord(lo), s.toCoord(hi)];
      const [a, b] = s.inBounds(ca, cb);
      if (a !== ca || b !== cb) {
        const applied = { from: s.fromCoord(a), to: s.fromCoord(b) };
        this.emit('viewport:clamp', { axis: 'price', pane, scale, requested: { from: lo, to: hi }, applied });
      }
    }
    this.redraw('view');
    this.#emitScaleState(true);
  }

  /**
   * The lowest and highest price a price scale shows (`from` below `to`, also
   * on an inverted scale, where `from` is at the top), in every mode; null
   * when there is no such pane or scale.
   */
  getPriceRange(pane = 0, scale = 'right'): { from: number; to: number } | null {
    const s = this.panes[pane]?.scales.find((x) => x.id === scale);
    return s ? { from: s.minPrice, to: s.maxPrice } : null;
  }

  /**
   * Turn autoscale back on for every scale of a pane, or of every pane.
   * `keepLocked` leaves scales with a locked price-to-bar ratio alone: a time
   * range change keeps their angles.
   */
  #resetAutoScale(pane?: number, keepLocked = false): void {
    this.panes.forEach((p, i) => {
      if (pane !== undefined && i !== pane) return;
      for (const s of p.scales) {
        if (keepLocked && s.barRatio !== null) continue;
        s.autoScale = true;
        s.lockRatio(null);
      }
    });
    this.redraw('view');
    this.#emitScaleState(true);
  }

  getPriceScaleOptions(pane = 0, scale = 'right'): PriceScaleSettings | null {
    const s = this.panes[pane]?.scale(scale);
    if (!s) return null;
    // A lock not captured yet reports the current ratio, or null before layout (passing null back locks at the current one).
    let ratio = s.barRatio;
    if (ratio !== null && Number.isNaN(ratio)) ratio = s.height > 0 ? ((s.max - s.min) / s.height) * this.time.barSpacing : null;
    return {
      side: s.side,
      mode: s.mode,
      invert: s.invert,
      autoScale: s.autoScale,
      marginTop: s.marginTop ?? undefined,
      marginBottom: s.marginBottom ?? undefined,
      fixedRange: s.fixedRange && { ...s.fixedRange },
      percentBase: copyPercentBase(s.percentFrom),
      autoscaleRule: s.autoscaleRule && copyRule(s.autoscaleRule),
      lockPriceToBarRatio: s.barRatio !== null,
      priceToBarRatio: ratio,
    };
  }

  getVisibleRange(): { from: Time; to: Time } | null {
    if (this.timeline.length === 0) return null;
    const r = this.time.visibleRange();
    return { from: this.timeline.timeFromIndex(r.from), to: this.timeline.timeFromIndex(r.to) };
  }

  /** Pixel width of one bar slot (css px). */
  get barSpacing(): number {
    return this.time.barSpacing;
  }

  /**
   * Zoom to `px` per bar, keeping the bar under chart-root `anchorX` (default:
   * the plot's right edge) in place. Clamped like a wheel zoom.
   */
  setBarSpacing(px: number, anchorX?: number): void {
    if (!Number.isFinite(px) || px <= 0) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Bar spacing must be a positive number' : '');
    if (anchorX !== undefined && !Number.isFinite(anchorX)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Bar spacing anchor must be a finite number' : '');
    this.#viewChange(() => this.setBarSpacing(px, anchorX));
    this.time.cancelAnimation();
    this.time.setBarSpacing(px, anchorX === undefined ? this.plotWidth : anchorX - this.plotLeft);
    this.redraw('view');
  }

  /**
   * Fractional logical indices at the plot's left and right edges (bar `i` is
   * centred on index `i`; past the newest bar they keep counting). Null before
   * layout or without data.
   */
  getVisibleIndexRange(): IndexRange | null {
    if (!this.#laidOut()) return null;
    return { from: this.time.xToIndex(0), to: this.time.xToIndex(this.plotWidth) };
  }

  /**
   * Show logical indices [from, to] at once, like a pan: no animation, and
   * autoscale is left as it is. Returns the range shown after clamping, or
   * null when nothing was moved.
   * @internal Used by link groups.
   */
  followIndexRange(from: number, to: number): IndexRange | null {
    if (this.destroyed || !this.#laidOut() || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    this.time.animateTo({ barSpacing: this.plotWidth / (to - from), rightOffset: to - this.timeline.lastIndex }, 0);
    this.redraw('view');
    return this.getVisibleIndexRange();
  }

  /**
   * Show logical indices [from, to] edge to edge; fractional values are kept.
   * Clamped like user panning and zooming, so the result can differ near the
   * ends of the data. Turns the main pane's autoscale back on, like
   * `setVisibleTimeRange`, except on scales with a locked price-to-bar ratio.
   */
  setVisibleIndexRange(from: number, to: number, animate = true): void {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Visible index range needs finite numbers with from < to' : '');
    }
    this.#viewChange(() => this.setVisibleIndexRange(from, to, false));
    if (!this.#laidOut()) return;
    const spacing = this.plotWidth / (to - from);
    this.time.animateTo({ barSpacing: spacing, rightOffset: to - this.timeline.lastIndex }, this.#viewMs(animate));
    this.#rangeHold = this.time.moves;
    this.#resetAutoScale(0, true);
    this.redraw('view');
  }

  /**
   * Scroll to `time`, first paging older history in through the data source
   * until it is loaded (or the source has no more, or 50 pages were fetched),
   * one page per task. Resolves once scrolling has started.
   */
  async goToTime(time: Time, animate = true): Promise<void> {
    if (!Number.isFinite(time)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'goToTime needs a finite time' : '');
    const data = this.dataController;
    if (data?.initialLoad) await data.initialLoad.catch(() => {});
    for (let page = 0; data && page < 50 && !this.destroyed; page++) {
      const first = this.timeline.times[0];
      if (first === undefined || first <= time || !data.hasMoreHistory) break;
      await nextTask();
      // False: the page failed or could not load now; stop rather than spin.
      if (this.destroyed || !(await data.loadMore())) break;
    }
    if (!this.destroyed) this.scrollToTime(time, animate);
  }

  /** Centre `time` (unix seconds) in the plot at the current bar spacing. */
  scrollToTime(time: Time, animate = true): void {
    if (!Number.isFinite(time)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'scrollToTime needs a finite time' : '');
    this.#viewChange(() => this.scrollToTime(time, false));
    if (!this.#laidOut()) return;
    const center = this.timeline.indexFromTime(time);
    const rightEdge = center + this.plotWidth / 2 / this.time.barSpacing;
    this.time.animateTo({ rightOffset: rightEdge - this.timeline.lastIndex }, this.#viewMs(animate));
    this.redraw('view');
  }

  /** Chart-root x (css px) of a time, extrapolated past the data; null before layout or without data. */
  timeToX(time: Time): number | null {
    return this.#laidOut() && Number.isFinite(time) ? this.indexToX(this.timeline.indexFromTime(time)) : null;
  }

  /** Chart-root x (css px) of a fractional logical index; null before layout or without data. */
  indexToX(index: number): number | null {
    return this.#laidOut() && Number.isFinite(index) ? this.plotLeft + this.time.indexToX(index) : null;
  }

  /** Fractional logical index at chart-root `x`, the inverse of `indexToX`. */
  xToIndex(x: number): number | null {
    return this.#laidOut() && Number.isFinite(x) ? this.time.xToIndex(x - this.plotLeft) : null;
  }

  /** Time of the bar nearest chart-root `x` (as `pointAt` reports it), extrapolated past the data. */
  xToTime(x: number): Time | null {
    const index = this.xToIndex(x);
    return index === null ? null : this.timeline.timeFromIndex(Math.round(index));
  }

  /**
   * Chart-root y (css px) of `price` on a pane's scale, by default the
   * primary one that `pointAt` reads. Null before layout, for a missing or
   * hidden pane or an unknown scale id, and for a price at or below zero on a
   * log scale.
   */
  priceToY(price: number, pane = 0, scale?: string): number | null {
    const at = this.#scaleFor(pane, scale);
    return at && placeable(price, at.scale) ? at.pane.top + at.scale.priceToY(price) : null;
  }

  /**
   * Price at chart-root `y`, the inverse of `priceToY`. Without `pane`, the
   * pane under `y` is used.
   */
  yToPrice(y: number, pane?: number, scale?: string): number | null {
    if (!Number.isFinite(y)) return null;
    const at = this.#scaleFor(pane ?? this.paneIndexAt(y), scale);
    return at ? at.scale.yToPrice(y - at.pane.top) : null;
  }

  /**
   * Chart-root css px of a time and price on a pane's primary scale, the
   * position of a bar centre (`pointAt` snaps x to the nearest bar). `y` is
   * null without a price. Null before layout, without data, for a missing or
   * hidden pane, and for a price at or below zero on a log scale.
   */
  coordinateFor(time: Time, price: number | null = null, pane = 0): { x: number; y: number | null } | null {
    const p = this.panes[pane];
    if (!p || p.height <= 0 || !this.#laidOut() || !Number.isFinite(time)) return null;
    if (price !== null && !placeable(price, p.primary)) return null;
    const at = pointFor(time, price, p, this.time, this.timeline);
    return { x: this.plotLeft + at.x, y: price === null ? null : at.y };
  }

  /** Pane tops and heights in chart-root css px; a hidden pane (another one maximized) has height 0. */
  paneBounds(): { pane: number; top: number; height: number }[] {
    if (this.plotWidth <= 0 || this.plotHeight <= 0) return [];
    return this.panes.map((p, pane) => ({ pane, top: p.top, height: p.height }));
  }

  /** The plot area (all panes, without the axes) in chart-root css px; empty before layout. */
  get plotRect(): Rect {
    return { x: this.plotLeft, y: 0, width: this.plotWidth, height: this.plotHeight };
  }

  /**
   * Space (css px) all price axis columns on one side take as laid out; 0 for
   * a side without axes. `options.priceAxisWidth` is the width of one column.
   */
  priceAxisSpace(side: 'left' | 'right'): number {
    const lanes = this.laneSpace;
    return side === 'left'
      ? this.plotLeft - lanes.left
      : Math.max(0, this.width - this.plotLeft - this.plotWidth - lanes.right);
  }

  /** The plot has a size and there are bars to place. */
  #laidOut(): boolean {
    return this.plotWidth > 0 && this.plotHeight > 0 && this.timeline.length > 0;
  }

  /** A shown pane and one of its existing scales (default primary); never creates a scale. */
  #scaleFor(index: number, id?: string): { pane: Pane; scale: PriceScale } | null {
    const pane = this.panes[index];
    if (!pane || pane.height <= 0 || this.plotWidth <= 0) return null;
    const scale = id === undefined ? pane.primary : pane.scales.find((s) => s.id === id);
    return scale ? { pane, scale } : null;
  }

  /**
   * Re-measure the container and redraw at once. The chart calls it itself when
   * the container's size or the device pixel ratio changes; call it after
   * changes it cannot see, such as a CSS transform or a container shown again
   * while its size stayed the same.
   */
  resize(): void {
    this.#measure(false);
  }

  /** `resize`, also when nothing changed with `force` (the GL pixel ratio cap did). */
  #measure(force: boolean): void {
    if (this.destroyed) return;
    const sized = measureRoot(this, this.#dprWatch, force);
    if (sized === null) return;
    const { width, height, dpr } = this;
    if (sized) this.emit('chart:resize', { width, height });
    this.#sizeCanvases(dpr, Math.min(dpr, this.glDprCap));
    this.#layout();
    // Canvases are already cleared; draw now (ResizeObserver runs before paint) instead of
    // waiting a frame, otherwise every resize step flashes blank.
    this.#noteRedraw('layout');
    this.sceneDirty = true;
    if (this.render(0)) {
      // Autoscale is still easing towards the new layout; let the frame loop finish it.
      this.animating = true;
      this.#schedule();
    } else {
      this.#releaseStatic();
    }
  }

  /** Size every canvas's backing store for `dpr` (the GPU layer for `glDpr`). This clears them. */
  #sizeCanvases(dpr: number, glDpr: number): void {
    this.dpr = dpr;
    for (const [canvas, ratio] of [
      [this.bottom, dpr],
      [this.top, dpr],
      ...(this.cursorLayer ? [[this.cursorLayer, dpr] as const] : []),
      [this.glCanvas, glDpr],
      ...(this.snapshot ? [[this.snapshot, glDpr] as const] : []),
    ] as const) {
      sizeCanvas(canvas, this.width, this.height, ratio);
    }
  }

  /**
   * Release the GPU context, listeners, data subscriptions and DOM. Safe to
   * call twice. Afterwards the chart draws nothing: redraw requests, view
   * changes (`scrollToRealtime`, `fitContent`, `setVisibleTimeRange`,
   * `resetView`), `applyOptions` and series removal do nothing, `data` is null,
   * and calls that load data (`setSymbol`, `compare`) reject or throw a
   * `ChartError` with code `'destroyed'`, as does a `setSymbol` still loading.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.emit('chart:destroy', {});
    // While everything they registered is still there to remove.
    this.#destroying = true;
    this.#plugins.dispose();
    this.destroyed = true;
    // Detach first: primitives may stop timers or subscriptions in `detached`.
    this.primitives.dispose();
    this.dataController?.dispose();
    // A disposed controller still loads when asked, and nothing would unsubscribe it.
    this.dataController = null;
    this.#markersLoader?.dispose();
    this.#markersLoader = null;
    this.#pendingLoad = null;
    this.pendingRange = null;
    this.#forEachSeries((s) => s.dispose());
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    clearInterval(this.#clock);
    this.#resizeObserver.disconnect();
    this.#dprWatch.stop();
    this.interaction.destroy();
    this.#description.dispose();
    this.visibility?.disconnect();
    if (typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', this.#onPageVisibility);
    for (const type of ['pointerdown', 'wheel', 'focusin']) {
      this.root.removeEventListener(type, this.#useContext, { capture: true });
    }
    for (const type of INPUT_EVENTS) this.root.removeEventListener(type, this.#noteInput, { capture: true });
    if (this.#shared) {
      // The shared context stays for the other charts; this chart's GPU objects went with its series.
      this.#shared.leave();
    } else {
      contextBudget.remove(this.#contextHolder);
      this.renderer.destroy();
      this.renderer.loseContext();
    }
    this.#emitter.clear();
    this.actions.clear();
    this.root.remove();
  }

  /** The scale commands on `chart.actions`; `Interaction` adds the view commands, the drawings and indicators plugins the selection, undo and drawing ones. */
  #registerActions(): void {
    const list = [
      { id: 'fit-content', run: () => this.fitContent() },
      {
        id: 'auto-scale',
        checked: () => this.isAutoScale(),
        run: () => this.setAutoScale(!this.isAutoScale()),
      },
    ];
    // Labels are the `action<Id>` messages (see `actionLabelKey`).
    for (const action of list) this.actions.register({ ...action, label: () => this.#localizer.text(actionLabelKey(action.id)) });
  }

  /** Install the `plugins` option; a plugin that throws destroys the chart and the error propagates. */
  private installCreationPlugins(plugins: readonly ChartPlugin[] | undefined): void {
    try {
      for (const plugin of plugins ?? []) this.install(plugin);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  /**
   * @internal Give the chart the opt-in feature `key` (see `OptInFeatures`):
   * a series kind or lane, the data source, drawings, annotations, indicators
   * and the other parts their plugins bring. The plugins in `builtins.ts` call
   * it; new opt-in parts use it too. Returns a function that takes it back,
   * restoring the feature it replaced.
   */
  provideFeature<K extends keyof OptInFeatures>(key: K, feature: OptInFeatures[K]): () => void {
    const previous = this.#optIn[key];
    const set = (value: OptInFeatures[K] | null | undefined, was: OptInFeatures[K] | null | undefined) => {
      this.#optIn[key] = value;
      if (!this.#destroying) this.#featureChanged[key]?.(value, was);
    };
    try {
      set(feature, previous);
    } catch (error) {
      this.#optIn[key] = previous;
      throw error;
    }
    return () => {
      if (this.#optIn[key] !== feature) return;
      this.#featureGone[key]?.(feature);
      set(previous, feature);
    };
  }

  /**
   * @internal The steps behind `history`, made with `make` the first time a
   * plugin asks: the drawings and indicators plugins, which bring the class,
   * so a chart without them leaves it out. They stay for the chart's life.
   */
  undoSteps(make: (changed: () => void) => UndoSteps): UndoSteps {
    return (this.#undoSteps ??= make(() => this.emit('history:change', { canUndo: this.history.canUndo, canRedo: this.history.canRedo })));
  }

  /**
   * Drawings: the drawing manager, with the tools, selection, undo history
   * and saved drawings. Needs the `drawingTools()` plugin (or `drawings()`,
   * or `builtins()`); throws a `not-registered` `ChartError` without one.
   */
  get drawings(): DrawingManager {
    return this.#optIn.drawings?.manager ?? notInstalled('drawings', 'drawingTools()');
  }

  /** @internal The drawing manager, or null on a chart without a drawings plugin. */
  get drawingLayer(): DrawingManager | null {
    return this.#optIn.drawings?.manager ?? null;
  }

  /** @internal Take a copy, cut or paste shortcut through the drawings plugin's clipboard; false without one. */
  drawingClipboardKey(e: KeyboardEvent): boolean {
    return this.#optIn.drawings?.key(e) ?? false;
  }

  /**
   * Annotations: bar markers, price, trade, alert and draft lines, trade
   * fills (with `trading()`), zones, bands and labels, and where the data source's marks and
   * indicator shape plots draw. Needs the `annotations()` plugin (or
   * `builtins()`); throws a `not-registered` `ChartError` without one.
   */
  get annotations(): AnnotationManager {
    return this.#optIn.annotations ?? notInstalled('annotations', 'annotations()');
  }

  /** @internal The annotation manager, or null on a chart without the annotations plugin. */
  get annotationLayer(): AnnotationManager | null {
    return this.#optIn.annotations ?? null;
  }

  /**
   * Indicator definitions and the indicators on the chart. Needs the
   * `indicators()` plugin (or `builtins()`); throws a `not-registered`
   * `ChartError` without it.
   */
  get indicators(): IndicatorManager {
    return this.#optIn.indicators?.manager ?? notInstalled('indicators', 'indicators()');
  }

  /** @internal The indicator manager, or null on a chart without the indicators plugin. */
  get indicatorLayer(): IndicatorManager | null {
    return this.#optIn.indicators?.manager ?? null;
  }

  /**
   * @internal What the opt-in feature plugins reach of the chart's own members:
   * a new object on each call, for the feature built with it.
   */
  internals(): ChartInternals {
    return {
      main: () => this.#mainSeries,
      changed: (state) => this.emit('replay:change', state),
      follow: () => this.scrollToRealtime(),
      animated: () => !this.animationsOff,
      glide: (ms) => this.#glideToNewest(ms),
      attach: (series, announce) => this.#attach(series, announce),
      detach: (series, indicator) => this.#detachSeries(series, indicator),
      moveSeries: (series, pane) => this.#moveSeriesTo(series, pane),
      panesChanged: () => this.#panesChanged(),
      paneHasDrawings: (index) => this.#paneHasDrawings(index),
      intervalSeconds: () => this.#barIntervalSeconds(),
      stateChanged: (reason) => this.#stateChanged(reason),
      primitives: this.primitives,
      destroyed: () => this.destroyed,
      destroying: () => this.#destroying,
      takeLayout: (key) => {
        const { [key]: value, ...rest } = this.#layoutExtra;
        if (value !== undefined) this.#layoutExtra = rest;
        return value;
      },
      keepLayout: (key, value) => (this.#layoutExtra = { ...this.#layoutExtra, [key]: value }),
      priceFactor: (pane, time) => this.#paneFactor(pane, time),
      formatOnScale: (pane, scale, price) => this.#formatOnScale(pane, scale, price),
      axisBox: (pane, scale) => [this.#axisLeft(pane, scale), this.axisWidths[scale.side === 'left' ? 'left' : 'right']],
      axisPill: (ctx, text, y, background, color, pane, scale) =>
        this.axisPill(ctx, text, y, background, color, undefined, this.#axisLeft(pane, scale), scale.side),
      timePill: (ctx, text, x, top, background, color) => this.#timePill(ctx, text, x, top, background, color),
      timeAxisSize: () => this.#timeAxisSize(),
      timeMarkBand: () =>
        this.#markersLoader?.band && this.options.timeMarks && this.#timeAxisSize() > 0
          ? { top: this.plotHeight + this.options.timeAxis.height, height: TIME_MARK_BAND }
          : null,
      paneButtons: () => {
        const height = this.#paneButtonsHeight();
        return height > 0 ? { height, side: this.#rtl ? 'left' : 'right' } : null;
      },
      toolsChange: () => this.#optIn.drawings?.toolsChange(),
      indicators: () => this.#optIn.indicators ?? null,
      replaying: () => !!this.#optIn.replay?.active,
      pluginDrawingTools: () => this.#plugins.drawingTools,
      textEditor: null,
    };
  }

  /** Whether drawings sit on pane `index`. */
  #paneHasDrawings(index: number): boolean {
    return this.drawingLayer?.getAll().some((d) => d.pane === index) ?? false;
  }

  /* ----------------------- SeriesHost / internal API ---------------------- */

  /** Input on the chart: it ranks as recently used, and takes back a context the budget took. */
  #useContext = () => contextBudget.use(this.#contextHolder);
  /** Put data source bars on the main series, or behind the replay time while replaying. */
  #showMainData(bars: Bar[]): void {
    if (this.#optIn.replay?.active) this.#optIn.replay.replaceAll(bars);
    else this.#mainCandles().setData(bars);
  }

  /** Take the data source's corporate actions; drawings follow the bars they were drawn on. */
  #setAdjustments(adjustments: readonly Adjustment[]): void {
    const previous = this.#adjustments;
    this.#prependAdjustments = previous;
    this.#adjustments = adjustments;
    this.#rebaseDrawings(previous, this.options.adjustment);
    this.#syncAdjustmentMarkers();
    this.#adjustmentsNeeded();
  }

  /** Mark the corporate actions on the main series, per the `adjustmentMarkers` option. */
  #syncAdjustmentMarkers(): void {
    const show = this.options.adjustmentMarkers && this.#adjustments.length > 0;
    if (show && process.env.NODE_ENV !== 'production') annotationsNeeded(this.#optIn.annotations, 'Corporate action markers');
    this.annotationLayer?.setEventMarkers((show && this.#optIn.adjustments?.markers(this.#adjustments, this.#localizer)) || []);
  }

  /** Hand the data source's markers to the annotations, on bars and on the time axis, per the `marks` and `timeMarks` options. */
  #syncMarks(): void {
    const markers = this.sourceMarkers;
    const marks = (this.options.marks && this.#optIn.sourceMarkers?.toMarkers(markers)) || [];
    // Guarded here, so production builds keep neither the call nor its text.
    if (process.env.NODE_ENV !== 'production' && markers.length > 0) annotationsNeeded(this.#optIn.annotations, 'Data source markers');
    this.annotationLayer?.[SET_SOURCE_MARKS](marks);
    // The annotations keep the `timeAxis` ones.
    this.annotationLayer?.[SET_TIME_MARKS](this.options.timeMarks ? markers : []);
  }

  /** What prices of the main pane at `time` show multiplied by under the `adjustment` option; 1 on other panes. */
  #paneFactor(pane: Pane | undefined, time: Time): number {
    if (this.#adjustments.length === 0 || !this.#mainSeries || pane !== this.#mainSeries.pane) return 1;
    return this.#optIn.adjustments?.factor(time, this.#adjustments, this.options.adjustment) ?? 1;
  }

  /** Move main-pane drawings priced under `adjustments` and `mode` onto the same bars as adjusted now. */
  #rebaseDrawings(adjustments: readonly Adjustment[], mode: AdjustmentMode): void {
    if (this.#optIn.adjustments && (adjustments.length > 0 || this.#adjustments.length > 0)) this.#optIn.drawings?.rebase(adjustments, mode);
  }

  /** A live bar scaled like the loaded ones; bars after the newest adjustment are as sent. */
  #adjustLive(bar: Bar): Bar {
    return this.#optIn.adjustments?.bar(bar, this.#adjustments, this.options.adjustment) ?? bar;
  }

  /** The data source's `bars` back-adjusted under the `adjustment` option, through the `adjustments()` plugin; as sent without it. */
  #adjust(bars: Bar[]): Bar[] {
    return this.#optIn.adjustments?.bars(bars, this.#adjustments, this.options.adjustment) ?? bars;
  }

  /** Show the loaded bars adjusted anew; nothing is fetched again. */
  #showAdjusted(): void {
    if (this.#sourceBars && this.#mainSeries) this.#showMainData(this.#adjust(this.#sourceBars));
  }

  /** Development builds: say once that corporate actions are neither applied nor marked without the `adjustments()` plugin. */
  #adjustmentsNeeded(): void {
    const { adjustment, adjustmentMarkers } = this.options;
    if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' && !this.#optIn.adjustments && this.#adjustments.length > 0 && (adjustment !== 'none' || adjustmentMarkers)) {
      devWarnOnce('The data source reports corporate actions, but they are neither applied nor marked without the adjustments() plugin: add it (or builtins()) to the chart', 'adjustments-missing');
    }
  }

  get maxTextureSize(): number {
    return this.renderer.maxTextureSize;
  }

  releaseGpu(owner: GpuOwner): void {
    this.renderer.release(owner);
  }

  get main(): CandleSeries | null {
    return this.#mainSeries;
  }

  get mainBars(): readonly Bar[] {
    return this.#mainSeries?.data ?? [];
  }

  /** @internal Static charts (`interactive: false`) and low-power mode show no animations; read by series. */
  get animationsOff(): boolean {
    return !this.#created.interactive || this.options.lowPower;
  }

  /** @internal Low-power mode is on; series drop tweens and costly sampling. */
  get lowPower(): boolean {
    return this.options.lowPower;
  }

  mainDataChanged(appended: boolean, keepVisibleRange = false): void {
    const main = this.#mainSeries;
    if (!main) return;
    const kept = keepVisibleRange && !appended ? this.getVisibleRange() : null;
    const wasAtEnd = this.time.barCount === 0 || this.time.visibleRange().to >= this.time.barCount - 1;
    const prevCount = this.time.barCount;
    // An appended bar extends the timeline in O(1); anything else rebuilds it.
    const append = appended && this.timeline.length === main.data.length - 1;
    if (append) this.timeline.append(main.data[main.data.length - 1]!.time);
    else this.timeline.set(main.data.map((b) => b.time));
    this.time.barCount = this.timeline.length;
    if (appended) this.#followAppended(this.time.barCount - prevCount, wasAtEnd);
    if (prevCount === 0) this.time.rightOffset = this.options.rightOffset;
    this.#syncTimeBounds();
    this.time.clamp();
    const times = this.timeline.times;
    if (kept && this.plotWidth > 0 && times.length > 0 && times[0]! <= kept.from && times[times.length - 1]! >= kept.to) {
      this.#showTimeRange(kept.from, kept.to, 0);
    }
    this.indicatorLayer?.syncBars(main.data, appended ? 'append' : 'reset');
    // A new symbol or interval: indicators and drawings limited to some intervals show or hide.
    if (!appended) {
      this.indicatorLayer?.intervalChanged();
      this.drawingLayer?.intervalChanged();
    }
    // Following series take their new points first. On append existing bars keep their indices,
    // so series only align their new items; anything else realigns (and rebuilds) them once.
    const failure = this.#followAll(main.data, appended ? 'append' : 'reset');
    this.#forEachSeries((s) => (append ? s.appendAligned() : s.realign()));
    this.redraw('series');
    if (failure) throw failure.error;
  }

  /**
   * The main series gained `count` older bars in front (a history page).
   * Every timeline index grows by `count`, which the view needs no change
   * for: its right offset counts from the newest bar. The timeline, series
   * and GPU buffers take just the new bars (and the bar after them); see
   * `prependAligned`.
   */
  mainDataPrepended(count: number): void {
    const main = this.#mainSeries;
    if (!main) return;
    if (count <= 0 || this.timeline.length !== main.data.length - count) {
      this.mainDataChanged(false);
      return;
    }
    const times: Time[] = new Array<Time>(count);
    for (let i = 0; i < count; i++) times[i] = main.data[i]!.time;
    this.timeline.prepend(times);
    this.time.barCount = this.timeline.length;
    this.#syncTimeBounds();
    this.time.clamp();
    this.indicatorLayer?.syncBars(main.data, 'prepend', count);
    // Following series map the new bars first, then every series shifts and aligns its new items.
    const failure = this.#followAll(main.data, 'prepend', count);
    this.#forEachSeries((s) => s.prependAligned(count));
    this.redraw('series');
    if (failure) throw failure.error;
  }

  /**
   * Move the view for `added` appended bars by `followNewBars`. The right
   * offset counts from the newest bar, so leaving it scrolls with them.
   */
  #followAppended(added: number, wasAtEnd: boolean): void {
    const follow = this.options.followNewBars;
    if (follow === 'always') {
      if (wasAtEnd) return;
      // Inertia or an eased zoom would carry the view off the newest bar again.
      this.interaction.stopMotion();
      this.time.rightOffset = this.options.rightOffset;
    } else if (follow === 'never' || !wasAtEnd) {
      this.time.rightOffset -= added;
    }
  }

  mainLastBarChanged(): void {
    const data = this.#mainSeries?.data;
    if (!data?.length) return;
    this.indicatorLayer?.syncBars(data, 'tick');
    this.#followAll(data, 'tick');
  }

  /**
   * Hand the main bars to every following series. A failing mapper never stops
   * the others: on 'append' and 'tick' (live data) it is reported through
   * `series:error` and that series skips the bar; on 'reset' and 'prepend'
   * the first failure is returned for the caller to throw once the chart is
   * consistent again (a failed page leaves that series' data as it was).
   */
  #followAll(bars: readonly Bar[], kind: FollowKind, added = 0): { error: unknown } | null {
    let failure: { error: unknown } | null = null;
    this.#forEachSeries((series) => {
      try {
        series.followMain(bars, kind, added);
      } catch (error) {
        if (kind === 'append' || kind === 'tick') this.seriesError({ series, hook: 'follow', error });
        else failure ??= { error };
      }
    });
    return failure;
  }

  requestRender(): void {
    this.redraw('series');
  }

  /** A series left out a bar or point in `update` or `setData(..., { normalize: true })`. */
  seriesDropped(series: Series, bar: unknown, reason: DropReason): void {
    this.emit('data:dropped', { reason, bar, series });
  }

  /** @internal */
  seriesOptionsChanged(series: Series, patch: object): void {
    if (this.#isOnChart(series)) this.emit('series:options', { series, patch });
  }

  /** @internal */
  seriesVisibilityChanged(series: Series): void {
    if (this.#isOnChart(series)) this.emit('series:visibility', { series, visible: series.visible });
  }

  /** @internal An indicator's shape plots changed: draw `markers` on the bar marker layer. */
  setPlotMarkers(series: Series, markers: BarMarker[]): void {
    // Kept for an annotations plugin installed later.
    if (markers.length > 0) {
      this.#plotMarkers.set(series, markers);
      if (process.env.NODE_ENV !== 'production') annotationsNeeded(this.#optIn.annotations, 'Indicator shape plots');
    } else this.#plotMarkers.delete(series);
    this.annotationLayer?.setPlotMarkers(series, markers);
  }

  /** @internal An indicator's bar colour plots changed: recolour the main series' bars. */
  setBarColors(series: Series, at: ((i: number) => string | undefined) | null, from: number): void {
    this.#mainSeries?.setBarColors(series, at, from);
  }

  #isOnChart(series: Series): boolean {
    return series.pane.series.includes(series);
  }

  seriesError(event: SeriesErrorEvent): void {
    const emit = this.#emitter.has('series:error') ? (e: SeriesErrorEvent) => this.emit('series:error', e) : null;
    reportSeriesError(event, emit);
  }

  /** Redraw everything next frame. */
  invalidate(): void {
    this.redraw('host');
  }

  /**
   * Redraw everything next frame, noting `reason` for the render statistics.
   * @internal The chart's own requests; apps call `invalidate`.
   */
  redraw(reason: RedrawReason): void {
    this.#noteRedraw(reason);
    this.sceneDirty = true;
    // While paused, it waits until the chart is shown.
    if (!this.paused) this.#reacquireStatic();
    this.#schedule();
  }

  /** A static chart gave its context up after its last drawing: take one back (the restore redraws). */
  #reacquireStatic(): void {
    // (The holder is undefined while the constructor runs.)
    if (this.snapshot && this.#contextHolder?.holding === false && !this.destroyed) contextBudget.use(this.#contextHolder);
  }

  /** Static charts: copy the GPU layer just drawn into the 2D canvas shown in its place. */
  #copyStatic(): void {
    const snapshot = this.snapshot;
    if (!snapshot || this.renderer.isLost) return;
    const ctx = snapshot.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, snapshot.width, snapshot.height);
    // Same task as the GL draw, so the drawing buffer still holds the frame.
    ctx.drawImage(this.glCanvas, 0, 0);
  }

  /** Static charts: the drawing settled, so give the context back until the next one. */
  #releaseStatic(): void {
    if (this.snapshot && !this.destroyed) contextBudget.release(this.#contextHolder);
  }

  /** Redraw only the overlay (crosshair, drawings, labels) next frame. */
  invalidateOverlay(): void {
    this.redrawOverlay('host');
  }

  /**
   * Redraw only the overlay next frame, noting `reason` for the render statistics.
   * @internal The chart's own requests; apps call `invalidateOverlay`.
   */
  redrawOverlay(reason: RedrawReason): void {
    this.#noteRedraw(reason);
    this.overlayDirty = true;
    this.#schedule();
  }

  /** Redraw only the crosshair layer next frame; on a static chart, which has none, the overlay. */
  #invalidateCursor(): void {
    this.#noteRedraw('crosshair');
    if (this.cursorLayer) this.#cursorDirty = true;
    else this.overlayDirty = true;
    this.#schedule();
  }

  emit<K extends keyof ChartEvents>(event: K, payload: ChartEvents[K]): void {
    this.#emitter.emit(event, payload);
    // Another symbol or interval picked while a layout's symbol loads; the layout's own load starts inside `loadLayout`.
    if (event === 'data:loading' && this.#layoutLoad && this.#stateQuiet === 0) {
      if ((payload as DataEvents['data:loading']).kind === 'initial') this.#layoutLoad.edits.add('symbol');
    }
    const reason = this.#stateReason(event, payload);
    if (reason) this.#stateChanged(reason);
    // Drawings tied to an indicator show, hide and move with it.
    if (event === 'indicator:add' || event === 'indicator:remove' || event === 'indicator:change') this.drawingLayer?.intervalChanged();
    if (event === 'drawing:select' || event === 'indicator:remove') this.#selection?.changed(payload as { ids?: string[]; indicator?: Indicator });
  }

  /**
   * Whether anyone listens to `event`, e.g. so a menu offers "Settings…" only
   * while an app handles `series:settings`.
   */
  listens(event: keyof ChartEvents): boolean {
    return this.#emitter.has(event);
  }

  /** A listener threw: hand it to the `chart:error` listeners, or log it (also when one of those threw). */
  #listenerFailed(error: unknown, event: keyof ChartEvents): void {
    const name = String(event);
    const failure = new ChartError('listener-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `A "${name}" listener threw` : '', { cause: error, context: { event: name } });
    if (event !== 'chart:error' && this.listens('chart:error')) this.emit('chart:error', { error: failure });
    else console.error(failure);
  }

  regionAt(x: number, y: number): Region | null {
    if (x < -this.plotLeft || y < 0 || x > this.width - this.plotLeft || y > this.height) return null;
    if (y >= this.plotHeight && this.#timeAxisSize() > 0) return { kind: 'timeAxis' };
    for (let i = 1; i < this.panes.length; i++) {
      const p = this.panes[i]!;
      if (this.#maximized || p.hidden || p.collapsed || this.#paneAbove(i)?.collapsed !== false) continue;
      if (Math.abs(y - p.top) <= SEPARATOR_HIT) return { kind: 'separator', pane: i };
    }
    const pane = this.paneIndexAt(y);
    if (x >= 0 && x < this.plotWidth) return { kind: 'plot', pane };
    return { kind: 'priceAxis', pane, scale: this.#axisScaleAt(this.panes[pane]!, x) };
  }

  /**
   * The scale whose axis column holds plot-relative `x`, or null when the pane
   * leaves that column empty or `x` is in a lane.
   */
  #axisScaleAt(pane: Pane, x: number): PriceScale | null {
    const left = x < 0;
    const side = this.axisScales(pane).filter((s) => (s.side === 'left') === left);
    const into = left ? -x - this.laneSpace.left : x - this.plotWidth - this.laneSpace.right;
    if (into < 0) return null;
    const col = Math.floor(into / this.axisWidths[left ? 'left' : 'right']);
    return side[col] ?? null;
  }

  /** The nearest pane above `panes[index]` that is not hidden. */
  #paneAbove(index: number): Pane | undefined {
    for (let i = index - 1; i >= 0; i--) if (!this.panes[i]!.hidden) return this.panes[i];
    return undefined;
  }

  paneIndexAt(y: number): number {
    for (let i = this.panes.length - 1; i >= 0; i--) {
      const p = this.panes[i]!;
      if (p.height > 0 && y >= p.top) return i;
    }
    return 0;
  }

  /** Move the crosshair to a plot point, or hide it; ignored while it is locked. */
  setCrosshair(point: (Point & { pane: number }) | null): void {
    if (this.#locked) return;
    this.mirror = null;
    this.crosshair = point;
    const at = point && chartPointAt(point.x, this.#crosshairY(point), point.pane, this.panes, this.time, this.timeline);
    this.emit('crosshair:move', at ? { ...at, locked: false } : null);
    if (at) this.#description.readoutChanged(() => this.#readoutText(at.time));
    this.#invalidateCursor();
  }

  /**
   * What the chart shows, in a sentence or two: symbol and interval, the bars
   * in view, the first and last close there with the change, and the high and
   * low. Screen readers get it as the chart's description (see the
   * `accessibility` option).
   */
  describe(): string {
    const main = this.#mainSeries;
    const text = this.#localizer;
    const name = this.dataController?.symbol?.name ?? (main?.options.title || text.text('chartLabel'));
    const interval = this.dataController?.interval;
    const head = interval ? text.text('describeHead', { name, interval }) : text.text('describeHeadNoInterval', { name });
    const bars = main?.data ?? [];
    const range = this.getVisibleRange();
    const a = range ? boundByTime(bars, range.from, true) : 0;
    const b = range ? boundByTime(bars, range.to, false) - 1 : -1;
    if (!main || b < a) return `${head} ${text.text('describeEmpty')}`;
    let high = -Infinity;
    let low = Infinity;
    for (let i = a; i <= b; i++) {
      high = Math.max(high, bars[i]!.high);
      low = Math.min(low, bars[i]!.low);
    }
    const first = bars[a]!.close;
    const last = bars[b]!.close;
    const change = last - first;
    const price = (p: number) => this.formatPrice(0, p);
    const percent = first !== 0 ? ` (${text.percent(Math.abs((change / first) * 100), 2)})` : '';
    const move =
      change === 0
        ? text.text('describeUnchanged')
        : text.text(change > 0 ? 'describeUp' : 'describeDown', { change: `${price(Math.abs(change))}${percent}` });
    const from = this.formatTime(bars[a]!.time);
    const to = this.formatTime(bars[b]!.time);
    return [
      head,
      text.text('describeBars', { count: b - a + 1, from, to }),
      text.text('describeClose', { first: price(first), last: price(last), move }),
      text.text('describeHighLow', { high: price(high), low: price(low) }),
    ].join(' ');
  }

  /**
   * Read `text` out to screen readers in a polite live region, e.g. when the
   * app finds an alert crossed (see `annotations.alertsCrossed`). Messages
   * take turns with new-bar announcements, at most one per
   * `accessibility.announceIntervalMs`; the newest few wait their turn and
   * older ones are dropped.
   */
  announce(text: string): void {
    if (this.destroyed) return;
    this.#description.announce(String(text));
  }

  /** Announce a bar appended to the main series since the last scene (see `accessibility.announceBars`). */
  #noteNewBar(): void {
    const main = this.#mainSeries;
    const bars = main?.data ?? [];
    const seen = this.#seenBars;
    const first = bars[0]?.time;
    const last = bars[bars.length - 1]?.time;
    this.#seenBars = main && first !== undefined && last !== undefined ? { series: main, first, last } : null;
    // Appends only: a new symbol or interval moves the first bar, a history page keeps the last.
    if (!main || !seen || last === undefined || seen.series !== main || seen.first !== first || last <= seen.last) return;
    this.#description.newBar(() => this.#newBarText(main));
  }

  /** The newest bar's time, and the close and change of the bar before it, which it completed. */
  #newBarText(series: CandleSeries): string {
    const bars = series.data;
    const bar = bars[bars.length - 1];
    if (!bar) return '';
    const text = this.#localizer;
    const head = text.text('newBar', { time: this.formatTime(bar.time) });
    const done = bars[bars.length - 2];
    if (!done) return head;
    const before = bars[bars.length - 3]?.close ?? done.open;
    const change = changeText(done.close, before, series.format, false, text);
    return `${head} ${text.text('newBarPrevious', { close: series.format(done.close), change })}`;
  }

  /** The crosshair values at `time` as one line of text: the time, then each series' legend. */
  #readoutText(time: Time): string {
    const at = this.valuesAt(time);
    if (!at) return '';
    const rows = at.series.flatMap(({ legend }) =>
      legend ? [[legend.title, ...legend.parts.map((p) => (p.label ? `${p.label} ${p.text}` : p.text))].filter(Boolean).join(' ')] : [],
    );
    return [at.timeText, ...rows].join('. ');
  }

  /**
   * Whether a touch long-press drives the crosshair (see `touchInspect`),
   * including the crosshair it keeps after the finger lifts with `'tap'`. A
   * plain touch also moves the crosshair while it pans; this tells the two
   * apart, e.g. to show a pointer tooltip only while inspecting.
   */
  get inspecting(): boolean {
    return this.interaction.inspecting;
  }

  /** Whether `lockCrosshair` holds the crosshair. */
  get crosshairLocked(): boolean {
    return this.#locked;
  }

  /**
   * Hold the crosshair at its current time and price, so the legend and data
   * window keep showing that bar while the pointer moves on; pan and zoom
   * keep it on its bar. `false` releases and hides it until the next pointer
   * move. Locking without a visible crosshair does nothing. Alt+click on the
   * plot toggles it, Escape or a touch tap on the plot releases it.
   */
  lockCrosshair(locked: boolean): void {
    if (locked === this.#locked) return;
    const c = this.crosshair;
    if (locked) {
      const at = c && chartPointAt(c.x, this.#crosshairY(c), c.pane, this.panes, this.time, this.timeline);
      if (!c || !at) return;
      this.mirror = { time: at.time, price: Number.isNaN(c.y) ? null : at.price, pane: c.pane };
      this.#locked = true;
      this.emit('crosshair:move', { ...at, locked: true });
    } else {
      this.#locked = false;
      this.mirror = null;
      this.crosshair = null;
      this.emit('crosshair:move', null);
    }
    this.#invalidateCursor();
  }

  /**
   * The `crosshair.cursor` in effect: the crosshair lines while a drawing tool is armed.
   * @internal Read by Interaction for the pointer.
   */
  get crosshairCursor(): CrosshairOptions['cursor'] {
    return this.drawingLayer?.tool ? 'cross' : this.options.crosshair.cursor;
  }

  /** Crosshair y in root css px after `crosshair.mode` snapping. NaN (no price) stays NaN. */
  #crosshairY(c: Point & { pane: number }): number {
    const mode = this.options.crosshair.mode;
    const main = this.#mainSeries;
    const pane = this.panes[c.pane];
    if (mode !== 'close' && mode !== 'ohlc') return c.y;
    // Snap only when the main series is on the pane's primary scale, so the drawn line, axis label and event price agree.
    if (Number.isNaN(c.y) || !main?.visible || main.overlayScale || !pane || main.pane !== pane || main.scale !== pane.primary) return c.y;
    // A collapsed pane draws no bars to snap to.
    if (pane.collapsed || pane.height <= 0) return c.y;
    // The bar as drawn, so Heikin Ashi, HLC and close-only styles snap onto what is on screen.
    const bar = main.drawnBarAt(Math.round(this.time.xToIndex(c.x)));
    if (!bar) return c.y;
    // The main series' own scale, which may be the left one.
    const scale = main.scale;
    const toY = (price: number) => scale.priceToY(price);
    return pane.top + toY(snapPrice(mode, scale.yToPrice(c.y - pane.top), bar, toY));
  }

  /**
   * Every series' value at the bar nearest `time` (default: the crosshair's
   * bar, else the newest), with raw numbers and legend text. Null without data.
   * Hidden panes and panes behind a maximized one are left out, like in the legend.
   */
  valuesAt(time?: Time): ValuesAt | null {
    const tl = this.timeline;
    if (tl.length === 0) return null;
    const index = time === undefined ? this.#legendIndex() : Math.round(tl.indexFromTime(time));
    if (!Number.isFinite(index)) return null;
    const clamped = clampNum(index, 0, tl.lastIndex);
    const at = tl.timeFromIndex(clamped);
    const series: SeriesValue[] = [];
    this.panes.forEach((pane, p) => {
      if (pane.hidden || (this.#maximized && pane !== this.#maximized)) return;
      const idle = time === undefined && !this.crosshair;
      for (const s of pane.series) {
        series.push({ series: s, pane: p, values: rawValues(s, at), legend: legendEntryFor(s, clamped, this.#legendConfig, idle) });
      }
    });
    const values: ValuesAt = { time: at, timeText: this.#spanText(clamped), index: clamped, series };
    const span = this.#bucketSpan(clamped);
    const source = !span && this.#sourceSpan(at);
    if (span) values.group = { time: tl.timeFromIndex(span.from), endTime: tl.timeFromIndex(span.to), count: span.to - span.from + 1 };
    else if (source) values.source = source;
    return values;
  }

  /** Topmost visible candle, line, histogram, point or indicator series under root-relative css px, or null. */
  seriesAt(rootX: number, y: number): Series | null {
    return this.#hitAt(rootX, y)?.series ?? null;
  }

  /** The series under root-relative css px, and on a point series the item hit. */
  #hitAt(rootX: number, y: number): { series: Series; item?: PointItem } | null {
    const x = rootX - this.plotLeft;
    const region = this.regionAt(x, y);
    if (region?.kind !== 'plot' || this.timeline.length === 0) return null;
    const pane = this.panes[region.pane]!;
    // A collapsed pane is only its legend row; no series is drawn there.
    if (pane.collapsed || pane.height <= 0) return null;
    const index = Math.round(this.time.xToIndex(x));
    // Past either end no bar is drawn, even if a series has a point at the extrapolated time.
    // Point markers keep their exact time, so they can sit there.
    const onBars = index >= 0 && index <= this.timeline.lastIndex;
    const time = this.timeline.timeFromIndex(index);
    // As drawn: the 2D canvas is above the GPU canvas, whatever the zIndex.
    const ordered = drawOrder(pane);
    const order = [...ordered.filter((s) => s.drawsOnGpu), ...ordered.filter((s) => !s.drawsOnGpu)];
    const yIn = y - pane.top;
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i]!;
      if (!s.visible) continue;
      const toY = (price: number) => s.scale.priceToY(price);
      if (s.kind === 'points') {
        const p = s as PointSeries;
        const time = this.time;
        const k = p.itemAt(x, yIn, { indexToX: (j) => time.indexToX(j), xToIndex: (px) => time.xToIndex(px), priceToY: toY });
        if (k >= 0) return { series: s, item: p.data[k]! };
      } else if (!onBars) {
        continue;
      } else if (s instanceof CandleSeries) {
        const bar = s.drawnBarAt(index);
        if (bar && hitsValue({ kind: 'candles', bar }, yIn, toY)) return { series: s };
      } else if (s instanceof HistogramSeries) {
        const p = atTime(s.data, time);
        if (p && hitsValue({ kind: 'histogram', value: p.value, base: s.options.base }, yIn, toY)) return { series: s };
      } else if (s instanceof LineSeries) {
        const p = atTime(s.data, time);
        if (p && hitsValue({ kind: 'line', value: p.value }, yIn, toY)) return { series: s };
      } else if (s.kind === 'indicator') {
        if ((s as unknown as IndicatorSeries).hits(index, yIn)) return { series: s };
      }
    }
    return null;
  }

  /**
   * Track the series under the pointer (plot coordinates) and emit `series:hover` when it changes.
   * @internal Called by Interaction.
   */
  updateHover(p: Point | null): void {
    // Trade lines and drawings sit above the series and take the pointer first.
    const covered = this.annotationLayer?.isHovering || this.drawingLayer?.isHovering;
    const rootX = p ? p.x + this.plotLeft : 0;
    const hit = p && !covered ? this.#hitAt(rootX, p.y) : null;
    const series = hit?.series ?? null;
    if (series === this.#hovered && hit?.item === this.#hoveredItem) return;
    this.#hovered = series;
    this.#hoveredItem = hit?.item;
    const event: SeriesHoverEvent = { series, point: p && this.pointAt(rootX, p.y) };
    if (hit?.item) event.item = hit.item;
    this.emit('series:hover', event);
  }

  /**
   * Show the crosshair at a time, e.g. to mirror another chart's `crosshair:move` event.
   * A null price draws only the vertical line; a null time hides it. Does not emit
   * `crosshair:move`, so two charts mirroring each other cannot loop. The next pointer
   * move over this chart takes over.
   */
  setCrosshairAt(time: Time | null, price: number | null = null, pane = 0): void {
    if (this.#locked) return;
    this.mirror = time === null ? null : { time, price, pane };
    if (this.mirror) this.#projectMirror();
    else this.crosshair = null;
    this.#invalidateCursor();
  }

  #projectMirror(): void {
    const m = this.mirror;
    if (!m) return;
    const p = this.panes[m.pane];
    this.crosshair =
      p && this.timeline.length > 0 ? { ...pointFor(m.time, m.price, p, this.time, this.timeline), pane: m.pane } : null;
  }

  /**
   * Emit `chart:contextmenu` for chart-root css px (like `pointAt`) when the
   * `contextMenu` feature is on and something listens. Returns whether it did,
   * so the caller suppresses the browser menu only then.
   */
  openContextMenu(x: number, y: number, clientX: number, clientY: number): boolean {
    if (!this.#flags.contextMenu || !this.listens('chart:contextmenu')) return false;
    const event = this.#contextMenuAt(x, y, clientX, clientY);
    if (!event) return false;
    if (event.drawing) this.drawingLayer?.select(event.drawing);
    this.emit('chart:contextmenu', event);
    return true;
  }

  #contextMenuAt(rootX: number, y: number, clientX: number, clientY: number): ChartContextMenuEvent | null {
    const x = rootX - this.plotLeft;
    const region = this.regionAt(x, y);
    if (!region || region.kind === 'separator') return null;
    const base = { x: rootX, y, clientX, clientY, drawing: null };
    const at = (pane: number) => chartPointAt(x, y, pane, this.panes, this.time, this.timeline);
    if (region.kind === 'timeAxis') {
      const point = x >= 0 && x < this.plotWidth ? at(0) : null;
      return { ...base, target: 'timeAxis', pane: -1, time: point?.time ?? null, index: point?.index ?? null, price: null, scale: null };
    }
    const pane = this.panes[region.pane]!;
    if (region.kind === 'priceAxis') {
      const scale = region.scale;
      const price = scale ? scale.yToPrice(y - pane.top) : null;
      return { ...base, target: 'priceAxis', pane: region.pane, time: null, index: null, price, scale: scale?.id ?? null };
    }
    const point = at(region.pane);
    const drawing = this.drawingLayer?.drawingAt({ x, y }) ?? null;
    return {
      ...base,
      target: drawing ? 'drawing' : 'plot',
      pane: region.pane,
      time: point?.time ?? null,
      index: point?.index ?? null,
      price: pane.primary.yToPrice(y - pane.top),
      scale: pane.primary.id,
      drawing,
    };
  }

  /** Data position under root-relative css px, or null outside the plot areas or without data. */
  pointAt(x: number, y: number): ChartPointerEvent | null {
    const px = x - this.plotLeft;
    const region = this.regionAt(px, y);
    if (region?.kind !== 'plot') return null;
    const at = chartPointAt(px, y, region.pane, this.panes, this.time, this.timeline);
    return at && { ...at, x, y };
  }

  /**
   * Rows of time, main OHLCV and every line/histogram/candle series value for
   * `[from, to]` (inclusive), defaulting to the visible range. Heatmaps are
   * skipped. Candles export their raw bars, whatever the display style.
   * Pass the result to `toCSV` for a CSV string.
   */
  getDataTable(range?: { from: Time; to: Time }): DataTable {
    const r = range ?? this.getVisibleRange();
    if (!r) return { columns: ['time'], rows: [] };
    return buildExport(this.#exportSources().map((e) => e.source), r.from, r.to);
  }

  /** What `getDataTable` reads, each with the format its values are shown in. */
  #exportSources(): { source: ExportSource; format: (value: number) => string }[] {
    const main = this.#mainSeries;
    const out: { source: ExportSource; format: (value: number) => string }[] = [];
    if (main) out.push({ source: { label: '', kind: 'ohlcv', data: main.data }, format: main.format });
    this.panes.forEach((pane) =>
      pane.series.forEach((s, i) => {
        if (s === main) return;
        if (s instanceof CandleSeries) {
          out.push({ source: { label: s.options.title || `candles ${i + 1}`, kind: 'ohlcv', data: s.data }, format: s.format });
        } else if (s instanceof LineSeries || s instanceof HistogramSeries) {
          out.push({
            source: { label: s.options.title || `${s.kind} ${i + 1}`, kind: 'value', data: s.data },
            format: (v) => s.formatValue(v),
          });
        }
      }),
    );
    return out;
  }

  /**
   * The rows of `getDataTable` as a semantic `<table>` for assistive technology
   * or a "view as table" panel: a caption, column headers, one row per time
   * with the time (in the chart's timezone and time format) as its row header,
   * and values in each series' own format; empty cells for gaps. Defaults to
   * the visible range. With `maxRows`, only the newest rows are kept and the
   * caption says so. The table is not attached; the app places and styles it.
   */
  describeTable(options: { from?: Time; to?: Time; maxRows?: number } = {}): HTMLTableElement {
    const view = this.getVisibleRange();
    const from = options.from ?? view?.from;
    const to = options.to ?? view?.to;
    const sources = this.#exportSources();
    const { data, fields } =
      from !== undefined && to !== undefined
        ? exportWithColumns(
            sources.map((e) => e.source),
            from,
            to,
          )
        : { data: { columns: ['time'], rows: [] }, fields: [] };
    const max = options.maxRows;
    const rows = max !== undefined && max >= 0 && data.rows.length > max ? data.rows.slice(data.rows.length - Math.floor(max)) : data.rows;

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const table = el('table');
    const text = this.#localizer;
    const name = this.dataController?.symbol?.name ?? (this.#mainSeries?.options.title || text.text('chartLabel'));
    const shown = rows.length < data.rows.length ? `, ${text.text('tableNewest', { shown: rows.length, total: data.rows.length })}` : '';
    const all = data.rows;
    const span = all.length
      ? `, ${text.text('tableSpan', { from: this.formatTime((rows[0] ?? all[all.length - 1]!)[0]!), to: this.formatTime(all[all.length - 1]![0]!) })}`
      : `, ${text.text('tableNoData')}`;
    table.append(el('caption', `${name}${span}${shown}`));

    const head = el('tr');
    data.columns.forEach((label) => {
      const th = el('th', label);
      th.setAttribute('scope', 'col');
      head.append(th);
    });
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
      const time = el('th', this.formatTime(row[0]!));
      time.setAttribute('scope', 'row');
      tr.append(time);
      fields.forEach(({ source, field }, c) => {
        const value = row[c + 1];
        const format = field === 'volume' ? text.compact : sources[source]!.format;
        tr.append(el('td', value === null || value === undefined ? '' : format(value)));
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return table;
  }

  /**
   * The chart as one image: background, GPU series, overlays (drawings, axes,
   * crosshair) and, by default, the legend. At device pixel ratio unless
   * `scale` asks for another; see `ScreenshotOptions` for what to include.
   * The app decides where the `Blob` goes (download, clipboard, upload).
   * Resolves to null when the chart is destroyed or has no size (hidden container), or the GPU
   * context is lost, since the image would be incomplete, or when the browser
   * cannot encode it. Needs the `imageCapture()` plugin: without it this
   * throws a `not-registered` `ChartError`.
   */
  captureImage(options: ScreenshotOptions = {}): Promise<Blob | null> {
    // Not async: the layers must be composited synchronously, before this call returns.
    const out = this.composite(options);
    if (!out) return Promise.resolve(null);
    return new Promise((resolve) => out.toBlob(resolve, options.type ?? 'image/png', options.quality));
  }

  /** All layers drawn into one fresh canvas, in the current task, by the `imageCapture()` plugin. */
  private composite(options: ScreenshotOptions): HTMLCanvasElement | null {
    // A destroyed chart has given its plugins up, and has nothing to draw.
    if (this.destroyed) return null;
    const capture = this.imageCapture ?? notInstalled('captureImage', 'imageCapture()');
    return capture(this, {
      useTheme: (theme) => this.#useTheme(theme),
      sizeCanvases: (dpr, glDpr) => this.#sizeCanvases(dpr, glDpr),
      legendFrame: (index) => this.#legendFrame(index),
      layout: () => this.#layout(),
      cursorDirty: () => (this.#cursorDirty = true),
    }, options);
  }

  /**
   * Switch the theme the layers draw with, without the side effects of `applyOptions`: no
   * events, no root or button restyling. Series map their colors again, as on a theme change.
   */
  #useTheme(theme: ChartTheme): void {
    this.theme = theme;
    // A follower that throws on this theme keeps its points empty for the capture; it was mapped
    // without error on the live theme, so switching back restores it.
    this.#followAll(this.mainBars, 'reset');
    this.#forEachSeries((s) => s.rebuild());
  }

  /** Resize two neighbouring panes by moving the separator above `paneIndex` (hidden panes between them are skipped). */
  moveSeparator(paneIndex: number, dy: number): void {
    const upper = this.#paneAbove(paneIndex);
    const lower = this.panes[paneIndex];
    if (!upper || !lower || this.#maximized || lower.hidden || upper.collapsed || lower.collapsed) return;
    const min = 32;
    const delta = clampLow(dy, min - upper.height, lower.height - min);
    // Weights become pixel heights; collapsed and hidden panes are rescaled by
    // the same factor so they come back at their previous share.
    const shut = (p: Pane) => p.collapsed || p.hidden;
    const open = this.panes.filter((p) => !shut(p));
    const pxPerWeight = open.reduce((sum, p) => sum + p.height, 0) / (open.reduce((sum, p) => sum + p.stretch, 0) || 1);
    for (const p of this.panes) p.stretch = shut(p) ? p.stretch * pxPerWeight : p.height;
    upper.stretch += delta;
    lower.stretch -= delta;
    this.#panesChanged();
  }

  /**
   * A price on a pane's primary scale (see `Pane.primary`) as text, in its price format: the first
   * candle series on the scale, else the first series with a `priceFormat`.
   * Without either, `decimals` places (compact from 10,000).
   */
  formatPrice(paneIndex: number, price: number, decimals = 2): string {
    const pane = this.panes[paneIndex];
    return pane ? this.#formatOnScale(paneIndex, pane.primary, price, decimals) : this.#localizer.price(price, decimals);
  }

  /** `price` in the format of `scale` on a pane (see `formatPrice`). */
  #formatOnScale(paneIndex: number, scale: PriceScale, price: number, decimals = 2): string {
    const format = this.#scaleFormatOf(paneIndex, scale);
    if (format) return format.format(price);
    if (Math.abs(price) >= 1e4) return this.#localizer.compact(price);
    return this.#localizer.price(price, decimals);
  }

  #scaleFormatOf(paneIndex: number, scale: PriceScale): PriceFormatModel | null {
    return scaleFormat(this.panes[paneIndex]?.series ?? [], scale);
  }

  /** `price` rounded to the tick size of the pane's price format. */
  roundPrice(paneIndex: number, price: number): number {
    return this.paneFormat(paneIndex)?.round(price) ?? price;
  }

  /** The price format of a pane's scale (see `formatPrice`), or null. */
  paneFormat(paneIndex: number): PriceFormatModel | null {
    const pane = this.panes[paneIndex];
    return pane ? this.#scaleFormatOf(paneIndex, pane.primary) : null;
  }

  /**
   * Crosshair time label: the `formatTime` option, else the built-in label in
   * the chart's timezone, following `timeAxis.showTime` and `showSeconds`.
   */
  formatTime(time: Time): string {
    const interval = this.timeline.interval;
    const { showTime, showSeconds } = this.options.timeAxis;
    return (
      this.options.formatTime?.(time, interval) ??
      formatCrosshairTime(time, interval, this.timeline.zone, this.#localizer, { time: showTime, seconds: showSeconds })
    );
  }

  /**
   * Axis label for a price on a pane scale (default the right one): percent
   * change in percent mode, the indexed value in indexed mode, else the price.
   */
  formatAxis(paneIndex: number, price: number, scaleId = 'right'): string {
    const pane = this.panes[paneIndex];
    const text = this.#localizer;
    if (!pane) return text.number(price, 2);
    const scale = pane.scale(scaleId);
    if (scale.mode === 'percent') return text.percent(scale.toPercent(price), 2, true);
    if (scale.mode === 'indexed') return text.number(scale.toIndexed(price), 2);
    return this.#formatOnScale(paneIndex, scale, price);
  }

  /**
   * Market phase at `now` (unix seconds, default the current time) from the
   * `session` and `extendedSession` options, and the data delay the current
   * symbol reports (0 for realtime). Needs the `marketStatus()` plugin:
   * without it this throws a `not-registered` `ChartError`.
   */
  marketStatus(now = Date.now() / 1000): MarketStatus & { delay: number | 'eod' } {
    const market = this.#optIn.marketStatus ?? notInstalled('marketStatus', 'marketStatus()');
    return { ...market.phase(this.timeline.session, this.#extended, this.timeline.zone, now), delay: this.#delay };
  }

  /**
   * Show a message in the middle of the plot area, or clear it with null. The
   * data source sets it while loading, for no data, errors and expired
   * contracts. A failed load shows generic text; the data source's error
   * message is in `getStatus().detail`. The chart never sets `unknown-symbol`
   * (data sources report every failure the same way): set it from your app,
   * e.g. when your source knows a symbol does not exist.
   */
  setStatus(status: ChartStatus | null): void {
    const spinning = this.#spinning();
    this.status = status;
    let prevented = false;
    this.emit('status:change', {
      status,
      preventDefault: () => (prevented = status !== null),
      get defaultPrevented() {
        return prevented;
      },
    });
    this.#statusHidden = prevented;
    // The watermark and the mark sit out the loading indicator; they are part of the scene.
    if (this.#spinning() !== spinning) this.invalidate();
    this.redrawOverlay('options');
  }

  /** The loading indicator shows: the `loading` status with no message of its own, not hidden by the app. */
  #spinning(): boolean {
    return this.status?.kind === 'loading' && this.status.message === undefined && !this.#statusHidden;
  }

  /**
   * Tell the user something: emits `ui:notify`, which the UI package shows as
   * a toast unless a listener calls `preventDefault()`. Without the UI package
   * nothing is shown; listen to the event to show it yourself. An empty
   * message is ignored.
   */
  notify(notification: ChartNotification): void {
    const message = typeof notification?.message === 'string' ? notification.message : '';
    if (!message) return;
    const kind: NotificationKind =
      notification.kind === 'success' || notification.kind === 'error' ? notification.kind : 'info';
    const ms = notification.durationMs;
    const durationMs = isNumber(ms) && ms >= 0 ? ms : NOTIFY_DURATION;
    let prevented = false;
    this.emit('ui:notify', {
      message,
      kind,
      durationMs,
      preventDefault: () => (prevented = true),
      get defaultPrevented() {
        return prevented;
      },
    });
  }

  /** The current in-pane status, if any. */
  getStatus(): ChartStatus | null {
    return this.status;
  }

  private placeStatus(): void {
    const status = this.status;
    if (!status || this.#statusHidden) {
      if (this.statusEl) this.statusEl.style.display = 'none';
      return;
    }
    const el = (this.statusEl ??= this.#createStatusEl());
    const text = status.message ?? this.#localizer.text(STATUS_TEXT[status.kind]);
    if (this.#spinning()) {
      // The mark assembling itself instead of the text, which stays the status's accessible name.
      if (!el.dataset.spinner) {
        el.dataset.spinner = 'on';
        el.replaceChildren(createAttributionLoader(LOADER_SIZE, prefersReducedMotion()));
      }
      el.setAttribute('aria-label', text);
    } else {
      delete el.dataset.spinner;
      el.removeAttribute('aria-label');
      el.textContent = text;
    }
    Object.assign(el.style, {
      display: '',
      left: `${this.plotLeft + this.plotWidth / 2}px`,
      // The plot area, not the main pane: it may be collapsed, or hidden by a maximized pane.
      top: `${this.plotHeight / 2}px`,
      color: this.theme.textMuted,
      font: fontCss(this.#font(), this.#font().fontSize + 2),
    });
  }

  #createStatusEl(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pc-status';
    el.setAttribute('role', 'status');
    Object.assign(el.style, { position: 'absolute', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: '2' });
    this.root.appendChild(el);
    return el;
  }

  /** The chart's timezone (from the `timezone` option); `zone.name` is the resolved IANA name. */
  get zone(): Zone {
    return this.timeline.zone;
  }

  /* --------------------------------- internals ----------------------------- */

  /**
   * The timezone to show: the current symbol's under `applySymbolTimezone`
   * (unless an explicit one pinned it), else the one the app set.
   */
  #wantedTimezone(): string {
    const name = this.dataController?.symbol?.timezone;
    if (!this.options.applySymbolTimezone || this.#timezonePinned || !name) return this.#appTimezone;
    try {
      zoneOf(name);
      return name;
    } catch {
      // An unknown name from the data source must not break the load.
      return this.#appTimezone;
    }
  }

  /** Switch to `wantedTimezone`; true when it changed. `apply` false leaves `applyZone` to the caller. */
  #followSymbolTimezone(apply = true): boolean {
    const name = this.#wantedTimezone();
    if (name === this.options.timezone) return false;
    this.options.timezone = name;
    if (apply) {
      this.#applyZone();
      this.#refreshBadge();
      this.redraw('options');
    }
    return true;
  }

  /** Validate and apply the `timezone` and `session` options; throws on unknown values. */
  #applyZone(): void {
    this.timeline.setZone(zoneOf(this.options.timezone), compileSession(this.options.session));
    const previous = this.#appliedTimezone;
    this.#appliedTimezone = this.options.timezone;
    if (previous !== null && previous !== this.options.timezone) this.emit('timezone:change', { timezone: this.options.timezone, previous });
    const extended = this.options.extendedSession;
    // An always-open schedule compiles to null, which reads as "no extended
    // hours"; keep the schedule itself so `marketPhase` sees extended hours all day.
    this.#extended = extended ? (compileSession(extended) ?? extended) : null;
  }

  /** Recompute the legend badge; redraw when it changed. */
  #refreshBadge(): void {
    const market = this.#optIn.marketStatus;
    const badge = market ? market.badge(this.marketStatus(), this.#localizer, !!this.timeline.session) : '';
    if (badge === this.badge) return;
    this.badge = badge;
    this.redrawOverlay('options');
  }

  #mainCandles(): CandleSeries {
    return this.#mainSeries ?? this.addCandles();
  }

  /** Add `series` to its pane; `announce` false leaves `series:add` to the caller (indicators name theirs). */
  #attach<S extends Series>(series: S, announce = true): S {
    // Map before joining, so a bad mapper leaves the chart without the series.
    series.followMain(this.mainBars, 'reset');
    series.pane.series.push(series);
    series.rebuild();
    this.redraw('series');
    if (announce) this.emit('series:add', { series, indicator: null });
    return series;
  }

  #forEachSeries(fn: (s: Series) => void): void {
    for (const pane of this.panes) for (const s of pane.series) fn(s);
  }

  /**
   * Hand an `access` patch (already checked) to the managers, and keep it in
   * the options for managers a plugin adds later. A change of `refused` alone
   * announces both managers' rules again, unchanged (one an app set through
   * `setAccess()` included), so built-in UI redraws its refused items.
   */
  #applyAccess({ allow, limits, refused }: Partial<AccessOptions>): void {
    const old = this.options.access;
    const access = (this.options.access = {
      allow: allow === undefined ? old.allow : allow,
      limits: limits ? { ...limits } : old.limits,
      refused: refused ?? old.refused,
    });
    const redraw = access.refused !== old.refused;
    const indicators = this.indicatorLayer;
    const drawings = this.drawingLayer;
    if (limits) indicators?.setLimit(access.limits.indicators ?? null);
    if (allow !== undefined) {
      indicators?.setAccess(access.allow);
      drawings?.setAccess(access.allow);
    } else if (redraw) {
      if (!limits) indicators?.setAccess(indicators.access);
      drawings?.setAccess(drawings.access);
    }
  }

  /** Merge flag and legend changes from `options`; `options.features` and `options.legend` mirror the result. */
  #syncFeatures(options: ChartOptionsPatch): void {
    this.#flags = resolveFeatures(this.#flags, options);
    if (options.legend) this.#legendConfig = resolveLegendSettings(this.#legendConfig, options.legend);
    Object.assign(this.options, { features: { ...this.#flags }, legend: { visible: this.#flags.legend, ...this.#legendConfig } });
  }

  /** Attach or detach the plugin's watermark to match `features.watermark` (`on` false: detach it). */
  #syncWatermark(on = this.#flags.watermark): void {
    const watermark = this.#optIn.watermark;
    if (!watermark) return;
    // The plugin's watermark draws the mark above its lines while it shows.
    if (watermark.options.logo !== this.#flags.attributionLogo) watermark.applyOptions({ logo: this.#flags.attributionLogo });
    // Read the registry: the watermark may have been attached or detached by hand.
    const attached = this.primitives.all.some((e) => e.primitive === watermark);
    if (on === attached) return;
    if (attached) this.primitives.detach(watermark);
    else this.attachPrimitive(watermark);
  }

  /** Development builds: say once that reference lines turned on show nothing without the `referenceLines()` plugin. */
  #referenceLinesNeeded(options: ChartOptionsPatch): void {
    if (
      !this.#optIn.referenceLines &&
      Object.values(options.referenceLines ?? {}).some((line) => line?.visible) &&
      /* @__PURE__ */ isDev() &&
      process.env.NODE_ENV !== 'production'
    ) {
      devWarnOnce('referenceLines show nothing without the referenceLines() plugin: add it (or builtins()) to the chart', 'reference-lines-missing');
    }
  }

  /** Development builds: say once that the `grouping` option draws single bars without the `grouping()` plugin. */
  #groupingNeeded(options: ChartOptionsPatch): void {
    if (options.grouping && !this.#optIn.grouping && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('grouping draws single bars without the grouping() plugin: add it (or builtins()) to the chart', 'grouping-missing');
    }
  }

  /** Development builds: say once that the `localization` option changes nothing without the `localization()` plugin. */
  #localizationNeeded(options: ChartOptionsPatch): void {
    const asked = options.localization && Object.keys(options.localization).length > 0;
    if (asked && !this.#optIn.localizer && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('localization changes nothing without the localization() plugin: add it (or builtins()) to the chart', 'localization-missing');
    }
  }

  /** Development builds: say once that the `marketStatus` option shows nothing without the `marketStatus()` plugin. */
  #marketStatusNeeded(options: ChartOptionsPatch): void {
    if (options.marketStatus === true && !this.#optIn.marketStatus && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('marketStatus shows nothing without the marketStatus() plugin: add it (or builtins()) to the chart', 'market-status-missing');
    }
  }

  /** Development builds: say once that `features.countdown` shows nothing without the `countdown()` plugin. */
  #countdownNeeded(options: ChartOptionsPatch): void {
    if (options.features?.countdown === true && !this.#optIn.countdown && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('features.countdown shows nothing without the countdown() plugin: add it (or builtins()) to the chart', 'countdown-missing');
    }
  }

  /** Development builds: say once that `features.watermark` shows nothing without the `watermark()` plugin. */
  #watermarkNeeded(options: ChartOptionsPatch): void {
    if (options.features?.watermark === true && !this.#optIn.watermark && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('features.watermark shows nothing without the watermark() plugin: add it (or builtins()) to the chart', 'watermark-missing');
    }
  }

  #layout(animate = false, keepRange = this.options.lockVisibleRangeOnResize): void {
    const cols = this.#axisColumns();
    const widths = this.axisWidths;
    const lanes = (this.laneSpace = this.#measureLanes());
    this.#axisCols = cols;
    this.plotLeft = cols.left * widths.left + lanes.left;
    this.plotWidth = Math.max(0, this.width - cols.left * widths.left - cols.right * widths.right - lanes.left - lanes.right);
    this.plotHeight = Math.max(0, this.height - this.#timeAxisSize());
    this.time.setWidth(this.plotWidth, keepRange);
    // On the end side, beside the main axis.
    const end = this.#mainSide;
    this.#scrollButton.style.left = end === 'left' ? `${cols.left * widths.left + lanes.left + SCROLL_BUTTON_MARGIN}px` : '';
    this.#scrollButton.style.right = end === 'right' ? `${cols.right * widths.right + lanes.right + SCROLL_BUTTON_MARGIN}px` : '';
    this.#scrollButton.style.bottom = `${this.#timeAxisSize() + SCROLL_BUTTON_MARGIN}px`;
    const slots = layoutPanes(this.panes, this.plotHeight, this.#maximized ? this.panes.indexOf(this.#maximized) : -1);
    const from = this.panes.map((p) => ({ top: p.top, height: p.height }));
    // Ease when only the split changed (not on resize or the first layout).
    if (animate && this.#viewMs(true) > 0 && from.some((s) => s.height > 0)) {
      this.#paneAnim = { from, to: slots, t: 0 };
    } else {
      this.#paneAnim = null;
      this.#applySlots(slots);
    }
    this.time.clamp();
  }

  #applySlots(slots: readonly PaneSlot[]): void {
    this.panes.forEach((pane, i) => {
      const slot = slots[i] ?? { top: 0, height: 0 };
      pane.top = slot.top;
      pane.height = slot.height;
      for (const scale of pane.scales) scale.height = slot.height;
      for (const s of pane.series) if (s.overlayScale) s.overlayScale.height = slot.height;
    });
  }

  /** Advance the pane layout easing; true while it runs. */
  private stepPanes(dt: number): boolean {
    const a = this.#paneAnim;
    if (!a) return false;
    a.t = Math.min(1, a.t + dt / PANE_ANIMATION_MS);
    const k = easeOutCubic(a.t);
    this.#applySlots(
      a.to.map((to, i) => {
        const f = a.from[i] ?? to;
        return { top: Math.round(f.top + (to.top - f.top) * k), height: Math.round(f.height + (to.height - f.height) * k) };
      }),
    );
    if (a.t >= 1) this.#paneAnim = null;
    return true;
  }

  /** Nominal length of the bar interval in seconds: the data source's interval, else the bars' spacing; null without either. */
  #barIntervalSeconds(): number | null {
    const interval = this.dataController?.interval;
    if (interval && isInterval(interval)) return safeIntervalSeconds(interval);
    return this.timeline.length > 1 ? this.timeline.interval : null;
  }

  #insertPane(index: number, options?: Partial<PaneOptions>): Pane {
    const pane = this.addPane(options);
    this.movePane(pane, index);
    return pane;
  }

  #panesChanged(animate = false): void {
    this.#layout(animate);
    this.redraw('layout');
    this.emit('panes:change', {
      heights: this.getPaneHeights(),
      maximized: this.#maximized ? this.panes.indexOf(this.#maximized) : -1,
      collapsed: this.panes.map((p) => p.collapsed),
      hidden: this.panes.map((p) => p.hidden),
    });
  }

  #paneAction(index: number, action: PaneAction): void {
    const pane = this.panes[index];
    if (!pane) return;
    if (action === 'up') this.movePane(pane, index - 1);
    else if (action === 'down') this.movePane(pane, index + 1);
    else if (action === 'maximize') this.maximizePane(this.#maximized === pane ? null : pane);
    else if (action === 'collapse') this.setPaneCollapsed(pane, !pane.collapsed);
    else this.removePane(pane);
  }

  #schedule(): void {
    if (this.destroyed) return;
    if (this.paused) {
      this.#queueSettle();
      return;
    }
    if (this.raf || this.idleTimer !== null) return;
    // The clock is read only in low-power mode, to hold back frames while idle.
    const wait = this.options.lowPower ? this.#pacer.idleDelay(performance.now()) : 0;
    if (wait > 0) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.#paced = true;
        this.raf = requestAnimationFrame(this.frame);
      }, wait);
    } else {
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** Request a frame held back by the idle cap right away (input arrived, or low power was turned off). */
  #releaseIdleFrame(): void {
    if (this.idleTimer === null) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.#schedule();
  }

  /** Input on the chart ends the idle frame cap of `lowPower` for a while. */
  #noteInput = () => {
    if (!this.options.lowPower) return;
    this.#pacer.inputAt = performance.now();
    this.#releaseIdleFrame();
  };

  #lowPowerChanged(): void {
    if (this.options.lowPower) return;
    this.#pacer.restart();
    this.#releaseIdleFrame();
  }

  readonly #onPageVisibility = () => this.#syncPaused();

  /**
   * Pause drawing while the root is out of the viewport or the page is hidden,
   * unless `renderWhenHidden`. Data, indicators and view events keep running;
   * only drawing waits. When shown again, animations jump to their end and the
   * chart draws once now, like `resize()`, before the next paint.
   */
  #syncPaused(): void {
    if (this.destroyed) return;
    const hidden = !this.#inView || document.visibilityState === 'hidden';
    const paused = hidden && !this.options.renderWhenHidden;
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      // A frame already requested (or held back by the low-power idle cap) would still draw:
      // settle its work without drawing instead.
      if (this.raf || this.idleTimer !== null) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (this.idleTimer !== null) clearTimeout(this.idleTimer);
        this.idleTimer = null;
        this.#queueSettle();
      }
      // The time hidden is not frame time.
      this.#lastFrame = 0;
      return;
    }
    if (this.#hiddenScene) this.sceneDirty = true;
    this.settle();
    if (!this.sceneDirty && !this.overlayDirty && !this.#cursorDirty) return;
    // A static chart draws its GPU layer once the context is back (the restore redraws).
    this.#reacquireStatic();
    // Like `resize`, a scale still easing (settle could not land it) finishes in the frame loop.
    const easing = this.render(0);
    if (easing) this.animating = true;
    // Overlay animations (a pulse) carry on from here.
    let overlay = false;
    this.#forEachSeries((s) => {
      if (s.stepOverlay(0)) overlay = true;
    });
    if (overlay) this.#noteAnimation('overlay');
    if (easing || overlay) {
      this.#schedule();
    } else {
      this.#releaseStatic();
    }
  }

  /**
   * While paused, once per task: settle the view without drawing, so
   * `view:change`, price scale events and history requests
   * still fire. The scene stays dirty for the draw when the chart is shown.
   */
  #queueSettle(): void {
    if (this.#settleQueued) return;
    this.#settleQueued = true;
    queueMicrotask(() => {
      this.#settleQueued = false;
      if (this.destroyed || !this.paused) return;
      this.settle();
      if (!this.sceneDirty || this.width === 0 || this.height === 0) return;
      // Like `render`, flags first, so a listener that changes the view queues its own settle.
      this.sceneDirty = false;
      this.#hiddenScene = true;
      this.#sceneSettled();
    });
  }

  /**
   * Jump every animation (inertia, eased zoom and view changes, pane layout,
   * forming-bar tweens, price-scale easing) to its end, as nobody watched it
   * run. Leaves the scene dirty when anything moved.
   */
  private settle(): void {
    this.interaction.finish();
    let moved = this.animating;
    // A step that lands still reports motion; bounded for custom series that never settle.
    for (let i = 0; i < 3; i++) {
      let moving = this.time.step(SETTLE_MS);
      if (this.stepPanes(SETTLE_MS)) moving = true;
      this.#forEachSeries((s) => {
        if (s.step(SETTLE_MS)) moving = true;
      });
      if (!moving) break;
      moved = true;
    }
    this.animating = false;
    if (moved) this.sceneDirty = true;
    if (!this.sceneDirty || this.width === 0 || this.height === 0) return;
    for (let i = 0; i < 3 && this.#fitScene(SETTLE_MS, false); i++);
  }

  private frame = (now: number) => {
    this.raf = 0;
    this.#frameNow = now;
    try {
      this.#runFrame(now);
    } finally {
      this.#frameNow = NaN;
    }
  };

  #runFrame(now: number): void {
    // Back-to-back frames measure the machine; frames the idle cap spaced out do not.
    if (this.#lastFrame && !this.#paced && this.#pacer.sample(now - this.#lastFrame) && !this.options.lowPower) {
      this.emit('frame:slow', { frameTime: this.#pacer.frameTime! });
    }
    this.#paced = false;
    this.#pacer.frameAt = now;
    // Clamp so a stalled tab or out-of-order timestamp cannot overshoot easing.
    const dt = this.#lastFrame ? clampLow(now - this.#lastFrame, 0, 64) : 16;
    this.#lastFrame = now;
    let animating = this.interaction.step(dt);
    if (this.time.step(dt)) animating = true;
    if (this.stepPanes(dt)) animating = true;
    this.#forEachSeries((s) => {
      if (s.step(dt)) animating = true;
    });
    if (animating || this.animating) this.#noteAnimation('scene');
    if (this.render(dt)) animating = true;
    // Overlay-only animations step after the draw, so they know whether they were on screen.
    let overlay = false;
    this.#forEachSeries((s) => {
      if (s.stepOverlay(dt)) overlay = true;
    });
    if (overlay) this.#noteAnimation('overlay');
    this.animating = animating;
    if (animating || overlay) this.#schedule();
    else {
      this.#lastFrame = 0;
      this.#releaseStatic();
    }
  }

  /** An animation needs another frame of `layer`; noted for the render statistics. */
  #noteAnimation(layer: 'scene' | 'overlay'): void {
    this.#noteRedraw('animation');
    if (layer === 'scene') this.sceneDirty = true;
    else this.overlayDirty = true;
  }

  /** Tell the frame observers what asked for the next frame. */
  #noteRedraw(reason: RedrawReason): void {
    for (const o of this.#frames) o.request?.(reason);
  }

  /** Tell the frame observers the frame finished `phase` (null: work between phases). */
  #lap(phase: FramePhase | null): void {
    for (const o of this.#frames) o.lap?.(phase);
  }

  /** @internal Watch frames with `observer` (`PluginContext.onFrame`). Returns a function that stops. */
  observeFrames(observer: FrameObserver): () => void {
    this.#frames.add(observer);
    return () => this.#frames.delete(observer);
  }

  /** Draw dirty layers now; returns true while price scales are still easing. */
  private render(dt: number): boolean {
    if (this.width === 0 || this.height === 0) return false;
    let easing = false;
    const scene = this.sceneDirty;
    const overlay = scene || this.overlayDirty;
    const drawn = overlay || this.#cursorDirty;
    if (drawn) for (const o of this.#frames) o.start?.();
    if (scene) {
      easing = this.#fitScene(dt);
      this.#lap('autoscale');
      this.#drawBottom();
      this.#lap('drawBottom');
      this.drawGL();
      this.#lap('drawGL');
      this.#shared?.copy();
      this.#copyStatic();
      this.#updateScrollButton();
      this.#lap(null);
    }
    if (overlay) {
      this.#drawTop();
      this.#lap('drawTop');
    }
    if (drawn) {
      this.#drawCursor();
      this.#lap('drawCursor');
    }
    this.sceneDirty = false;
    this.overlayDirty = false;
    this.#cursorDirty = false;
    if (scene) this.#hiddenScene = false;
    // After the flags reset, so a listener that changes the view schedules its own redraw.
    if (scene) this.#sceneSettled();
    if (drawn) for (const o of this.#frames) o.end?.(scene ? 'scene' : overlay ? 'overlay' : 'cursor');
    // Off-screen bars of a large load reach the GPU a piece per frame (see GLRenderer.flushUploads).
    // A static chart gives its context up after drawing, so it uploads only what it draws.
    if (scene && this.uploading && !this.snapshot) this.redraw('series');
    return easing;
  }

  /**
   * Lay out again when the axis columns or primitive lanes changed, then fit
   * the price scales and the auto axis widths; true while the scales ease.
   * In a frame (`framed`), the layout check is reported as work between phases.
   */
  #fitScene(dt: number, framed = true): boolean {
    const cols = this.#axisColumns();
    const lanes = this.#measureLanes();
    if (
      cols.left !== this.#axisCols.left ||
      cols.right !== this.#axisCols.right ||
      lanes.left !== this.laneSpace.left ||
      lanes.right !== this.laneSpace.right ||
      // The time-mark band came or went with the data source.
      Math.max(0, this.height - this.#timeAxisSize()) !== this.plotHeight
    ) {
      this.#layout();
    }
    if (framed) this.#lap(null);
    let easing = this.autoscale(dt);
    // New label widths relay out now, so the frame never draws with the old width.
    // A range set by a fit or range call stays in view until the user pans or zooms.
    if (this.#fitAxisWidths()) {
      this.#layout(false, this.#rangeHold === this.time.moves || this.options.lockVisibleRangeOnResize);
      if (this.autoscale(0)) easing = true;
    }
    return easing;
  }

  /** After a scene is drawn (or settled while paused): the description and the view events. */
  #sceneSettled(): void {
    this.#description.setLabel(this.dataController?.symbol?.name ?? null, this.#accessibleName());
    this.#description.summaryChanged(() => this.describe());
    this.#noteNewBar();
    this.emitRangeEvents();
    this.#emitViewChange();
    this.#emitGrouping();
  }

  #viewMs(animate: boolean): number {
    if (!animate || !this.options.animateViewChanges || this.options.lowPower) return 0;
    return prefersReducedMotion() ? 0 : VIEW_ANIMATION_MS;
  }

  private env(pane: Pane): PaneEnv {
    const range = this.time.visibleRange();
    return {
      time: this.time,
      pane,
      width: this.plotWidth,
      height: pane.height,
      from: range.from,
      to: range.to,
      dpr: this.dpr,
      theme: this.theme,
    };
  }

  /** Fit price scales to the visible data and advance their easing; true while easing. */
  private autoscale(dt: number): boolean {
    const { from, to } = this.time.visibleRange();
    const smooth = this.options.smoothScale && !this.options.lowPower;
    let easing = false;
    this.paneTicks.clear();
    // Scratch collections reused across panes and frames; with the series'
    // own builders, a scene draw makes no RangeBuilder.
    const ranges = this.#fitRanges;
    const scales = this.#fitScales;
    this.#partitionPrimitives();
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i]!;
      ranges.clear();
      scales.clear();
      for (const scale of pane.scales) scales.add(scale);
      for (const s of pane.series) scales.add(s.scale);
      // Linked scales take their mode first, so ranges below are collected for the right (log or not) mode.
      for (const scale of scales) if (scale.link && scale.mode !== scale.link.mode) scale.setMode(scale.link.mode);
      for (const s of pane.series) {
        if (!s.visible) continue;
        // Primitives attached to a series share its scale.
        this.#addFitRange(s.scale, this.primitives.mergeRange(this.#primitivesOf(pane, s), from, to, s.fitRange(from, to), s.scale.isLog));
      }
      // Pane-level primitives use the default right scale.
      this.#addFitRange(pane.price, this.primitives.mergeRange(this.#primitivesOf(pane, null), from, to, null, pane.price.isLog));
      // Drawings with `autoscale` on, on the scale they are drawn against.
      const drawings = this.drawingLayer;
      if (drawings && from <= to) {
        const t0 = this.timeline.timeFromIndex(from);
        const t1 = this.timeline.timeFromIndex(to);
        for (const scale of scales) this.#addFitRange(scale, drawings.fitRange(i, t0, t1, scale.isLog, scale));
      }
      for (const scale of scales) {
        if (scale.mode === 'percent' || scale.mode === 'indexed') {
          // One bar for every scale in a link group, so compared lines measure from the same time.
          const at = percentBaseBar((scale.link ?? scale).percentFrom, this.timeline, from, to);
          // The candles when they are on this scale, else the first series with a value.
          let first: Series | undefined;
          for (const s of pane.series) {
            if (!s.visible || s.scale !== scale || s.firstValueFrom(at.index) === undefined) continue;
            if (s instanceof CandleSeries) {
              first = s;
              break;
            }
            first ??= s;
          }
          const base = first?.firstValueFrom(at.index, at.field);
          if (base !== undefined) scale.percentBase = base;
        }
      }
      // Linked percent scales (compared symbols) share one percent range.
      for (const root of scales) {
        if (root.mode !== 'percent' && root.mode !== 'indexed') continue;
        const group = [root, ...[...scales].filter((s) => s.link === root)].filter((s) => ranges.has(s));
        if (group.length < 2) continue;
        const widened = linkedRanges(group.map((scale) => ({ scale, range: ranges.get(scale)! })));
        group.forEach((scale, k) => ranges.set(scale, widened[k]!));
      }
      const margins = this.#autoMargins(pane);
      for (const scale of scales) {
        scale.height = pane.height;
        // A scale centred on a price gets the larger margin on both sides, so the price stays mid-pane.
        const even = Math.max(...margins);
        scale.autoMargins = scale.autoscaleRule?.centerOn !== undefined ? [even, even] : margins;
        scale.smooth = smooth;
        scale.applyBarRatio(this.time.barSpacing);
        const r = ranges.get(scale);
        if (r) scale.applyRule(r);
        if (r || scale.fixedRange) scale.fit(r ? r[0] : NaN, r ? r[1] : NaN);
        // A log scale with data but nothing above zero keeps its last range and says so.
        scale.noPositiveData =
          scale.isLog &&
          !r &&
          pane.series.some((s) => s.visible && s.inAutoscale && s.scale === scale && s.priceRange(from, to, false) !== null);
        if (scale.step(dt)) easing = true;
      }
      // A linked scale whose root is not fitting the data (manual, fixed or locked) shows the root's percent range.
      for (const scale of scales) {
        const root = scale.link;
        if (!root || !scale.autoScale || (root.mode !== 'percent' && root.mode !== 'indexed')) continue;
        if (!root.autoScale || root.fixedRange) scale.follow(root);
      }
      for (const scale of this.axisScales(pane)) this.paneTicks.set(scale, this.#ticksFor(pane, scale, i));
    }
    // Past the last bar (the visible range stops there), ticks follow the projected bar calendar.
    const tickTo = Math.max(to, Math.ceil(this.time.xToIndex(this.plotWidth)));
    const ahead = this.timeline.length > 0 ? tickTo - this.timeline.lastIndex : 0;
    const future = ahead > 0 ? this.timeline.projectedWeights(ahead) : undefined;
    this.#timeTicks = selectTimeTicks(this.timeline.weights, from, tickTo, this.time.barSpacing, undefined, future);
    return easing;
  }

  /** Widen the autoscale range collected for `scale` by `r`. */
  #addFitRange(scale: PriceScale, r: [number, number] | null): void {
    if (!r) return;
    const cur = this.#fitRanges.get(scale);
    if (!cur) this.#fitRanges.set(scale, r);
    else {
      if (r[0] < cur[0]) cur[0] = r[0];
      if (r[1] > cur[1]) cur[1] = r[1];
    }
  }

  /**
   * Group the attached primitives by pane into `panePrimitives`, in attach
   * order, so each series scans only its own pane's primitives. Lists left
   * empty are dropped, so a removed pane is not kept alive.
   */
  #partitionPrimitives(): void {
    const byPane = this.panePrimitives;
    for (const list of byPane.values()) list.length = 0;
    for (const e of this.primitives.all) {
      let list = byPane.get(e.pane);
      if (!list) byPane.set(e.pane, (list = []));
      list.push(e);
    }
    for (const [pane, list] of byPane) if (list.length === 0) byPane.delete(pane);
  }

  /** Primitives attached to `pane` and `series` (null = pane-level), in a reused array. */
  #primitivesOf(pane: Pane, series: Series | null): readonly AttachedPrimitive[] {
    const out = this.#fitPrimitives;
    out.length = 0;
    const attached = this.panePrimitives.get(pane);
    if (attached) for (const e of attached) if ((e.series ?? null) === series) out.push(e);
    return out;
  }

  #ticksFor(pane: Pane, scale: PriceScale, index: number): PaneTicks {
    const lo = Math.min(scale.minPrice, scale.maxPrice);
    const hi = Math.max(scale.minPrice, scale.maxPrice);
    if (scale.mode === 'percent' || scale.mode === 'indexed') {
      const percent = scale.mode === 'percent';
      const to = (v: number) => (percent ? scale.toPercent(v) : scale.toIndexed(v));
      const t = priceTicks(to(lo), to(hi), pane.height);
      return {
        values: t.values.map((v) => (percent ? scale.fromPercent(v) : scale.fromIndexed(v))),
        labels: t.values.map((v) => (percent ? this.#localizer.percent(v, t.decimals, true) : this.#localizer.number(v, t.decimals))),
      };
    }
    if (scale.mode === 'log') {
      const values = logPriceTicks(lo, hi, pane.height);
      const labels = values.map((v) => this.#formatOnScale(index, scale, v, v >= 100 ? 0 : 2));
      // A coarse format can round neighbouring ticks to the same label; keep the first.
      const keep = labels.map((l, k) => k === 0 || l !== labels[k - 1]);
      return { values: values.filter((_, k) => keep[k]), labels: labels.filter((_, k) => keep[k]) };
    }
    const format = this.#scaleFormatOf(index, scale);
    const t = priceTicks(lo, hi, pane.height, 40, format ? (step) => format.axisStep(step, (lo + hi) / 2) : undefined);
    return { values: t.values, labels: t.values.map((v) => this.#formatOnScale(index, scale, v, t.decimals)) };
  }

  /** Scales of a pane whose axis shows (see `visibleAxes`). */
  axisScales(pane: Pane): PriceScale[] {
    return visibleAxes(pane);
  }

  /** The scale whose ticks draw the pane's grid: its primary scale, when that has an axis. */
  #gridScale(pane: Pane): PriceScale | undefined {
    return this.axisScales(pane).includes(pane.primary) ? pane.primary : undefined;
  }

  private emitRangeEvents(): void {
    this.#emitScaleState(true);
    if (this.timeline.length === 0) return;
    // Compared as numbers, so an unchanged frame builds no range object or key string.
    const r = this.time.visibleRange();
    const from = this.timeline.timeFromIndex(r.from);
    const to = this.timeline.timeFromIndex(r.to);
    if (from !== this.#lastRangeFrom || to !== this.#lastRangeTo) {
      this.#lastRangeFrom = from;
      this.#lastRangeTo = to;
      this.#lastRange = `${from}:${to}`;
      this.#stateChanged('viewport');
      this.#markersLoader?.setView(from, to);
    }
    const key = this.#lastRange;
    const first = this.timeline.times[0];
    // Indicator warm-up bars draw nothing, so ask for older bars before they scroll into view.
    if (first !== undefined && this.time.xToIndex(0) < this.options.historyThreshold + (this.indicatorLayer?.lookback ?? 0)) {
      this.#historyGate.request(first, key, () => {
        this.emit('history:request', { before: first });
        return this.dataController?.loadMore();
      });
    }
  }

  /** Emit `view:change` when anything a coordinate depends on moved since the last scene draw. */
  #emitViewChange(): void {
    const t = this.time;
    const times = this.timeline.times;
    const put = this.#putView;
    this.#viewSlot = 0;
    this.#viewMoved = false;
    put(t.barSpacing);
    put(t.rightOffset);
    put(t.barCount);
    put(times[0] ?? 0);
    put(times[times.length - 1] ?? 0);
    put(this.width);
    put(this.height);
    put(this.plotLeft);
    put(this.plotWidth);
    put(this.plotHeight);
    for (const p of this.panes) {
      put(p.top);
      put(p.height);
      put(p.primary.id);
      for (const s of p.scales) {
        put(s.id);
        put(s.min);
        put(s.max);
        put(s.mode);
        put(s.invert);
      }
    }
    // Fewer slots than last time: a pane or scale went away.
    if (this.#viewKey.length !== this.#viewSlot) {
      this.#viewKey.length = this.#viewSlot;
      this.#viewMoved = true;
    }
    if (!this.#viewMoved) return;
    if (this.listens('view:change')) {
      this.emit('view:change', {
        barSpacing: t.barSpacing,
        fromIndex: t.xToIndex(0),
        toIndex: t.xToIndex(this.plotWidth),
        rightOffset: t.rightOffset,
        ...(this.getVisibleRange() ?? { from: null, to: null }),
      });
    }
  }

  /** Compare one `viewKey` slot in place; a bound field, so no closure is made per frame. */
  readonly #putView = (v: number | string | boolean): void => {
    const old = this.#viewKey[this.#viewSlot];
    // NaN equals NaN here, as it did when the key was a joined string.
    if (old !== v && !(Number.isNaN(old) && Number.isNaN(v))) {
      this.#viewKey[this.#viewSlot] = v;
      this.#viewMoved = true;
    }
    this.#viewSlot++;
  };

  /** Emit `scale:change` for panes whose mode/autoscale changed (e.g. by dragging the axis). */
  #emitScaleState(onlyChanged = false): void {
    this.panes.forEach((pane, i) => {
      let keys = this.#scaleStateKeys.get(pane);
      if (!keys) this.#scaleStateKeys.set(pane, (keys = new Map()));
      for (const s of pane.scales) {
        const fixedRange = s.fixedRange && { ...s.fixedRange };
        const lockPriceToBarRatio = s.barRatio !== null;
        const key = `${i}:${s.mode}:${s.autoScale}:${s.invert}:${s.noPositiveData}:${JSON.stringify(fixedRange)}:${lockPriceToBarRatio}`;
        if (onlyChanged && keys.get(s.id) === key) continue;
        keys.set(s.id, key);
        const { mode, autoScale, invert, noPositiveData } = s;
        this.emit('scale:change', { pane: i, scale: s.id, mode, autoScale, invert, noPositiveData, fixedRange, lockPriceToBarRatio });
      }
    });
  }

  #createScrollButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pc-scroll-realtime';
    b.title = this.#localizer.text('scrollToLatest');
    b.setAttribute('aria-label', b.title);
    b.replaceChildren(svgIcon(CHEVRONS_RIGHT, 16));
    Object.assign(b.style, {
      position: 'absolute',
      zIndex: '3',
      display: 'grid',
      placeItems: 'center',
      width: `${SCROLL_BUTTON_SIZE}px`,
      height: `${SCROLL_BUTTON_SIZE}px`,
      padding: '0',
      border: '0',
      borderRadius: '6px',
      cursor: 'pointer',
      opacity: '0',
      transform: 'translateX(6px) scale(0.9)',
      pointerEvents: 'none',
      transition: 'opacity 160ms ease, transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    });
    b.tabIndex = -1;
    // Faded out, it is neither a Tab stop nor in the accessibility tree.
    b.inert = true;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => this.scrollToRealtime());
    this.root.appendChild(b);
    this.#styleScrollButtonFor(b);
    return b;
  }

  #styleScrollButton(): void {
    this.#styleScrollButtonFor(this.#scrollButton);
  }

  #styleScrollButtonFor(b: HTMLButtonElement): void {
    b.style.background = this.theme.labelBackground;
    b.style.color = this.theme.labelText;
    b.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
  }

  #updateScrollButton(): void {
    const t = this.time;
    const show = this.options.scrollButton && t.barCount > 0 && t.xToIndex(this.plotWidth) < t.barCount - 1.5;
    if (show === this.#scrollButtonShown) return;
    this.#scrollButtonShown = show;
    const s = this.#scrollButton.style;
    s.opacity = show ? '1' : '0';
    s.transform = show ? 'none' : 'translateX(6px) scale(0.9)';
    s.pointerEvents = show ? 'auto' : 'none';
    this.#scrollButton.tabIndex = show ? 0 : -1;
    this.#scrollButton.inert = !show;
    // Pressed from the keyboard, it fades out under the focus: hand focus to the chart.
    if (!show && this.root.ownerDocument.activeElement === this.#scrollButton) this.root.focus();
  }

  private ctx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? '2D canvas context unavailable' : '');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = fontCss(this.#font('axis'));
    return ctx;
  }

  /** The theme font of a text surface, or the baseline without one. */
  #font(surface?: TypographySurface): ResolvedFont {
    return resolveFont(this.theme, surface);
  }

  /** The axis font with the `priceAxis` or `timeAxis` font size applied. */
  #axisFont(axis: 'price' | 'time'): ResolvedFont {
    const font = this.#font('axis');
    const size = (axis === 'price' ? this.options.priceAxis : this.options.timeAxis).fontSize;
    return size === undefined ? font : { ...font, fontSize: size };
  }

  /**
   * Height (css px) the time axis takes: 0 while it is hidden. Once the data
   * source sent a `timeAxis` marker, a band for them is added under the
   * labels, so the badges never cover a label.
   */
  #timeAxisSize(): number {
    const { visible, height } = this.options.timeAxis;
    return visible ? height + (this.#markersLoader?.band && this.options.timeMarks ? TIME_MARK_BAND : 0) : 0;
  }

  #drawBottom(): void {
    const ctx = this.ctx(this.bottom);
    const t = this.theme;
    // Cleared first: a translucent background would otherwise build up over frames.
    ctx.clearRect(0, 0, this.width, this.height);
    const background = this.capture?.background ?? t.background;
    if (background !== 'transparent') {
      ctx.fillStyle = backgroundFill(ctx, background, t, this.height);
      ctx.fillRect(0, 0, this.width, this.height);
    }
    // Everything below is in plot coordinates, kept off the axis strips (they may show through a translucent background).
    ctx.save();
    ctx.translate(this.plotLeft, 0);
    clipBox(ctx, this.plotWidth, this.plotHeight);
    ctx.lineWidth = 1;
    const { vertical, horizontal } = resolveGrid(this.options.grid, t);
    if (vertical.visible) {
      ctx.strokeStyle = vertical.color;
      ctx.setLineDash(GRID_DASH[vertical.lineStyle]);
      ctx.beginPath();
      for (const tick of this.#timeTicks) {
        const x = sharp(this.time.indexToX(tick.index));
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.plotHeight);
      }
      ctx.stroke();
    }
    if (horizontal.visible) {
      ctx.strokeStyle = horizontal.color;
      ctx.setLineDash(GRID_DASH[horizontal.lineStyle]);
      ctx.beginPath();
      for (const pane of this.panes) {
        const grid = this.#gridScale(pane);
        if (pane.collapsed || !grid) continue;
        for (const v of this.paneTicks.get(grid)?.values ?? []) {
          const y = sharp(pane.top + grid.priceToY(v));
          if (y <= pane.top || y >= pane.top + pane.height) continue;
          ctx.moveTo(0, y);
          ctx.lineTo(this.plotWidth, y);
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    this.#drawSession(ctx);
    this.panes.forEach((pane, i) => {
      if (pane.height <= 0 || pane.collapsed) return;
      const env = this.env(pane);
      ctx.save();
      ctx.translate(0, pane.top);
      clipBox(ctx, this.plotWidth, pane.height);
      for (const s of drawOrder(pane)) if (s.visible) s.drawBelow(ctx, env);
      if (this.capture?.drawings !== false && this.drawingLayer?.below) this.drawingLayer.render(ctx, i, this.plotWidth, pane.height, true);
      ctx.restore();
    });
    this.#drawAttribution(ctx);
    this.#drawPrimitiveLayer(ctx, 'below');
    ctx.restore();
  }

  /**
   * The project mark in the centre of the main pane while `features.attributionLogo`
   * is on, in the watermark colour. The `watermark()` plugin's watermark draws
   * it above its lines instead while it is attached; screenshots that leave
   * the watermark out leave the mark out too, and so does the loading indicator.
   */
  #drawAttribution(ctx: CanvasRenderingContext2D): void {
    const pane = this.panes[0];
    if (!this.#flags.attributionLogo || this.capture?.watermark === false || this.#spinning() || !pane || pane.height <= 0 || pane.collapsed) return;
    const watermark = this.#optIn.watermark;
    if (watermark && this.primitives.all.some((e) => e.primitive === watermark)) return;
    const size = Math.min(ATTRIBUTION_SIZE, this.plotWidth / 3, pane.height / 3);
    if (size < 4) return;
    const snap = (v: number) => Math.round(v * this.dpr) / this.dpr;
    drawAttributionMark(ctx, snap((this.plotWidth - size) / 2), snap(pane.top + (pane.height - size) / 2), size, this.theme.watermark);
  }

  /** Out-of-session shading and trading-day breaks behind the series. */
  #drawSession(ctx: CanvasRenderingContext2D): void {
    const tl = this.timeline;
    const session = tl.session;
    if (!session || tl.length === 0) return;
    const { from, to } = this.time.visibleRange();
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(tl.lastIndex, Math.ceil(to));
    const half = this.time.barSpacing / 2;
    if (this.options.sessionShading) {
      ctx.fillStyle = withAlpha(this.theme.textMuted, 0.08);
      let start = -1;
      for (let i = a; i <= b + 1; i++) {
        const out = i <= b && !inSession(session, tl.zone.wall(tl.times[i]!));
        if (out && start < 0) start = i;
        if (!out && start >= 0) {
          const x0 = this.time.indexToX(start) - half;
          ctx.fillRect(x0, 0, this.time.indexToX(i - 1) + half - x0, this.plotHeight);
          start = -1;
        }
      }
    }
    if (this.options.sessionBreaks && tl.interval < 86400) {
      ctx.save();
      ctx.strokeStyle = withAlpha(this.theme.textMuted, 0.5);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = Math.max(1, a); i <= b; i++) {
        if (tl.weights[i]! < TickWeight.Day) continue;
        const x = sharp(this.time.indexToX(i) - half);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.plotHeight);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Plot-area drawing of one primitive layer: in the pane already set up, or each pane, clipped. */
  #drawPrimitiveLayer(ctx: CanvasRenderingContext2D, layer: PrimitiveLayer, pane?: Pane): void {
    if (pane) this.#drawPanePrimitives(ctx, layer, pane, false);
    else for (const p of this.panes) this.#drawPanePrimitives(ctx, layer, p, true);
  }

  /**
   * One pane's primitives on `layer`, in attach order; `clip` moves to the
   * pane and clips to it first. Reads the per-pane lists the last scene
   * partitioned (attaching or detaching always redraws the scene), so an
   * overlay frame filters nothing into new arrays.
   */
  #drawPanePrimitives(ctx: CanvasRenderingContext2D, layer: PrimitiveLayer, p: Pane, clip: boolean): void {
    const attached = this.panePrimitives.get(p);
    if (!attached || p.height <= 0 || p.collapsed) return;
    let open = false;
    for (const e of attached) {
      const primitive = e.primitive;
      if (!primitive.drawPlot || (primitive.layer ?? 'normal') !== layer || (e.series && !e.series.visible) || !this.#captures(e)) continue;
      if (!open) {
        open = true;
        ctx.save();
        if (clip) {
          ctx.translate(0, p.top);
          clipBox(ctx, this.plotWidth, p.height);
        }
      }
      this.primitives.guard.draw(primitive, 'drawPlot', ctx, () => primitive.drawPlot!(ctx, this.#primitiveEnv(e, this.plotWidth, p.height)));
    }
    if (open) ctx.restore();
  }

  /** False for the watermark while a screenshot leaves it out or the loading indicator shows. */
  #captures(e: AttachedPrimitive): boolean {
    return e.primitive !== this.#optIn.watermark || (this.capture?.watermark !== false && !this.#spinning());
  }

  /** Coordinates for a primitive: its series' scale, or its pane's. */
  #primitiveEnv(e: AttachedPrimitive, width: number, height: number): PrimitiveEnv {
    const range = this.time.visibleRange();
    let fns = this.#primitiveFns.get(e);
    if (!fns) {
      // Made once per attachment and read live, so drawing many primitives makes no closures.
      const scale = () => e.series?.scale ?? e.pane.price;
      fns = {
        indexToX: (i) => this.time.indexToX(i),
        xToIndex: (x) => this.time.xToIndex(x),
        timeToX: (t) => this.time.indexToX(this.timeline.indexFromTime(t)),
        priceToY: (price) => scale().priceToY(price),
        yToPrice: (y) => scale().yToPrice(y),
        formatPrice: (price) => this.formatPrice(this.panes.indexOf(e.pane), price),
      };
      this.#primitiveFns.set(e, fns);
    }
    return {
      width,
      height,
      pixelRatio: this.dpr,
      theme: this.theme,
      from: range.from,
      to: range.to,
      barSpacing: this.time.barSpacing,
      times: this.timeline.times,
      indexToX: fns.indexToX,
      xToIndex: fns.xToIndex,
      timeToX: fns.timeToX,
      priceToY: fns.priceToY,
      yToPrice: fns.yToPrice,
      formatPrice: fns.formatPrice,
    };
  }

  private drawGL(): void {
    const r = this.renderer;
    this.uploading = false;
    if (r.isLost) return;
    const glDpr = this.glCanvas.width / Math.max(1, this.width);
    // Shared: draw into the top-left of the shared canvas, sized to fit, then copy (`SharedSession.copy`).
    this.#shared?.fit();
    r.beginFrame(glDpr, this, this.#frameNow);
    for (const pane of this.panes) {
      if (pane.height <= 0 || pane.collapsed) continue;
      const y0 = Math.round(pane.top * glDpr);
      r.setPane({
        x: Math.round(this.plotLeft * glDpr),
        y: y0,
        width: Math.round(this.plotWidth * glDpr),
        height: Math.round((pane.top + pane.height) * glDpr) - y0,
      });
      const env = { ...this.env(pane), dpr: glDpr };
      for (const s of drawOrder(pane)) if (s.visible) s.drawGL(r, env);
    }
    this.uploading = r.flushUploads();
    r.endFrame();
  }

  #drawTop(): void {
    const ctx = this.ctx(this.top);
    const t = this.theme;
    ctx.clearRect(0, 0, this.width, this.height);
    // Everything below is in plot coordinates; left axes sit at negative x.
    ctx.translate(this.plotLeft, 0);

    this.panes.forEach((pane, i) => {
      if (pane.height <= 0 || pane.collapsed) return;
      const env = this.env(pane);
      ctx.save();
      ctx.translate(0, pane.top);
      clipBox(ctx, this.plotWidth, pane.height);
      for (const s of drawOrder(pane)) if (s.visible) s.draw2D(ctx, env);
      this.#drawPrimitiveLayer(ctx, 'normal', pane);
      if (this.#flags.lastValueLabels) this.#drawLastValueLines(ctx, pane);
      this.#optIn.referenceLines?.drawLines(ctx, pane, this.plotWidth);
      if (this.capture?.drawings !== false) this.drawingLayer?.render(ctx, i, this.plotWidth, pane.height);
      this.#drawPrimitiveLayer(ctx, 'top', pane);
      ctx.restore();
    });
    if (this.capture?.annotations !== false) this.annotationLayer?.render(ctx);

    // Axes.
    const rightEdge = this.width - this.plotLeft;
    // Cover overflow into the axis strips. A translucent background is already on the bottom
    // layer, so painting it again would double it; clear instead.
    const background = this.capture?.background ?? t.background;
    const fill = backgroundFill(ctx, background, t, this.height);
    const opaque =
      background !== 'transparent' && parseColor(background)[3] === 255 && (fill === background || parseColor(t.backgroundBottom!)[3] === 255);
    ctx.fillStyle = fill;
    const cover = (x: number, y: number, w: number, h: number) => (opaque ? ctx.fillRect(x, y, w, h) : ctx.clearRect(x, y, w, h));
    cover(this.plotWidth, 0, rightEdge - this.plotWidth, this.height);
    if (this.plotLeft > 0) cover(-this.plotLeft, 0, this.plotLeft, this.height);
    cover(-this.plotLeft, this.plotHeight, this.width, this.height - this.plotHeight);
    this.#optIn.depthLane?.draw(ctx, this.panes, this.primitives, this.laneSpace, this.plotWidth, (e, w, h) => this.#primitiveEnv(e, w, h));
    ctx.strokeStyle = t.separator;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const timeAxis = this.#timeAxisSize() > 0;
    if (this.options.priceAxis.border) {
      ctx.moveTo(sharp(this.plotWidth), 0);
      ctx.lineTo(sharp(this.plotWidth), this.height);
      if (this.plotLeft > 0) {
        ctx.moveTo(sharp(0), 0);
        ctx.lineTo(sharp(0), this.height);
      }
    }
    if (timeAxis && this.options.timeAxis.border) {
      ctx.moveTo(-this.plotLeft, sharp(this.plotHeight));
      ctx.lineTo(rightEdge, sharp(this.plotHeight));
    }
    // Lanes are set off from the axes too.
    if (this.options.priceAxis.border && this.laneSpace.right > 0) {
      ctx.moveTo(sharp(this.plotWidth + this.laneSpace.right), 0);
      ctx.lineTo(sharp(this.plotWidth + this.laneSpace.right), this.plotHeight);
    }
    if (this.options.priceAxis.border && this.laneSpace.left > 0) {
      ctx.moveTo(sharp(-this.laneSpace.left), 0);
      ctx.lineTo(sharp(-this.laneSpace.left), this.plotHeight);
    }
    for (let i = 1; i < this.panes.length; i++) {
      if (this.panes[i]!.hidden) continue;
      const y = sharp(this.panes[i]!.top);
      ctx.moveTo(-this.plotLeft, y);
      ctx.lineTo(rightEdge, y);
    }
    ctx.stroke();
    const drawings = this.capture?.drawings === false ? null : this.#optIn.drawings;
    const marks = drawings?.manager.axisMarks();
    if (marks) drawings!.ranges(ctx, marks);

    ctx.fillStyle = t.text;
    ctx.textBaseline = 'middle';
    const baseFont = ctx.font;
    const priceFont = this.#axisFont('price');
    const priceTicks = this.options.priceAxis.ticks;
    ctx.font = fontCss(priceFont);
    // Tick marks go into one path, stroked after the labels.
    ctx.beginPath();
    this.panes.forEach((pane, i) => {
      if (pane.collapsed || pane.height <= 0) return;
      for (const scale of this.axisScales(pane)) {
        const ticks = this.paneTicks.get(scale);
        if (!ticks) continue;
        const left = scale.side === 'left';
        const x0 = this.#axisLeft(pane, scale);
        const tx = left ? x0 + this.axisWidths.left - AXIS_LABEL_INSET : x0 + AXIS_LABEL_INSET;
        // The mark starts at the column's plot edge.
        const mx = left ? x0 + this.axisWidths.left : x0;
        ctx.textAlign = left ? 'right' : 'left';
        // The unit sits at the top of the axis; tick labels keep clear of it.
        const unit = this.#scaleFormatOf(i, scale)?.unit;
        const top = pane.top + (unit ? 8 + priceFont.fontSize + 6 : 8);
        if (unit) fillText(ctx, unit, tx, pane.top + 8 + priceFont.fontSize / 2);
        ticks.values.forEach((v, k) => {
          const y = pane.top + scale.priceToY(v);
          if (y < top || y > pane.top + pane.height - 8) return;
          fillNumerals(ctx, ticks.labels[k]!, tx, y, priceFont.numerals);
          if (!priceTicks) return;
          ctx.moveTo(mx, sharp(y));
          ctx.lineTo(left ? mx - AXIS_TICK_LENGTH : mx + AXIS_TICK_LENGTH, sharp(y));
        });
      }
    });
    if (timeAxis) {
      const timeFont = this.#axisFont('time');
      const timeTicks = this.options.timeAxis.ticks;
      const seconds = this.options.timeAxis.showSeconds;
      ctx.font = fontCss(timeFont);
      ctx.textAlign = 'center';
      // Centred in the label row: a time-mark band may sit below it.
      const labelY = this.plotHeight + this.options.timeAxis.height / 2;
      for (const tick of this.#timeTicks) {
        if (tick.index < 0) continue;
        const time = this.timeline.timeFromIndex(tick.index);
        const label = this.options.formatTimeTick
          ? this.options.formatTimeTick(time, tick.weight)
          : formatTickLabel(time, tick.weight, this.timeline.zone, this.timeline.session, this.#localizer, seconds);
        const x = this.time.indexToX(tick.index);
        // A label the plot edge would cut is left out rather than shown in part.
        const half = measureNumerals(ctx, label, timeFont.numerals) / 2;
        if (x >= half && x <= this.plotWidth - half) fillNumerals(ctx, label, x, labelY, timeFont.numerals);
        if (!timeTicks || x < 0 || x > this.plotWidth) continue;
        ctx.moveTo(sharp(x), this.plotHeight);
        ctx.lineTo(sharp(x), this.plotHeight + AXIS_TICK_LENGTH);
      }
    }
    ctx.stroke();
    ctx.font = baseFont;
    if (timeAxis) this.#drawPercentBaseMarks(ctx);

    this.#drawPrimitiveAxes(ctx);
    this.panes.forEach((pane, i) => this.drawLastValueLabels(ctx, pane, i));
    if (this.capture?.annotations !== false) this.annotationLayer?.renderLabels(ctx);
    if (marks) drawings!.labels(ctx, marks);
  }

  /**
   * The crosshair layer: series crosshair markers, the crosshair and its axis
   * labels, and the "+" button, drawn after the overlay; then the legend and
   * heatmap inspector, which follow the crosshair. Static charts draw it over
   * the overlay on the same canvas, which the overlay has just redrawn.
   */
  #drawCursor(): void {
    this.#projectMirror();
    const own = this.cursorLayer;
    const ctx = this.ctx(own ?? this.top);
    if (own) ctx.clearRect(0, 0, this.width, this.height);
    // Plot coordinates, as on the overlay.
    ctx.translate(this.plotLeft, 0);
    this.#drawCrosshairMarkers(ctx);
    this.drawCrosshair(ctx);
    this.#drawPlusButton(ctx);
    this.#updateLegendAndInspector();
  }

  /** Development builds: say once that the render statistics need the `statsOverlay()` plugin. */
  #statsOverlayNeeded(): void {
    const { renderStats, renderStatsOverlay } = this.options;
    if ((renderStats || renderStatsOverlay) && !this.#optIn.statsOverlay && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('renderStats and renderStatsOverlay collect nothing without the statsOverlay() plugin: add it (or builtins()) to the chart', 'stats-overlay-missing');
    }
  }

  /** Series' own crosshair markers (e.g. a dot on a line), clipped to their pane. */
  #drawCrosshairMarkers(ctx: CanvasRenderingContext2D): void {
    // Screenshots leave them out along with the crosshair.
    const c = this.hideCrosshair ? null : this.crosshair;
    if (!c || this.timeline.length === 0 || this.options.crosshair.mode === 'hidden') return;
    const crosshair = Math.round(this.time.xToIndex(c.x));
    for (const pane of this.panes) {
      if (pane.height <= 0 || pane.collapsed) continue;
      let env: PaneEnv | null = null;
      for (const s of drawOrder(pane)) {
        if (!s.visible || !s.hasCrosshairMarker) continue;
        if (!env) {
          env = { ...this.env(pane), crosshair };
          ctx.save();
          ctx.translate(0, pane.top);
          clipBox(ctx, this.plotWidth, pane.height);
        }
        s.drawCrosshair2D(ctx, env);
      }
      if (env) ctx.restore();
    }
  }

  /** A small mark on the time axis under each bar a percent or indexed scale measures from by `{ time }`. */
  #drawPercentBaseMarks(ctx: CanvasRenderingContext2D): void {
    const tl = this.timeline;
    if (tl.length === 0) return;
    const marked = new Set<number>();
    for (const pane of this.panes) {
      if (pane.collapsed || pane.height <= 0) continue;
      for (const scale of pane.scales) {
        const base = scale.percentFrom;
        if (scale.link || typeof base !== 'object' || (scale.mode !== 'percent' && scale.mode !== 'indexed')) continue;
        marked.add(percentBaseBar(base, tl, 0, 0).index);
      }
    }
    if (marked.size === 0) return;
    const size = 4;
    ctx.fillStyle = this.theme.text;
    for (const index of marked) {
      const x = this.time.indexToX(index);
      if (x < -size || x > this.plotWidth + size) continue;
      ctx.beginPath();
      ctx.moveTo(x, this.plotHeight);
      ctx.lineTo(x - size, this.plotHeight + size * 1.5);
      ctx.lineTo(x + size, this.plotHeight + size * 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Where the "+" button is (plot coordinates), or null while it is hidden. */
  #plusButtonRect(): Rect | null {
    const c = this.crosshair;
    if (!c || this.mirror || !this.#flags.plusButton || !this.listens('plus:click')) return null;
    if (this.options.crosshair.mode === 'hidden' || Number.isNaN(c.y) || this.timeline.length === 0) return null;
    const pane = this.panes[c.pane];
    if (!pane || pane.collapsed || pane.height <= 0) return null;
    const y = clampNum(this.#crosshairY(c), pane.top, pane.top + pane.height);
    // Next to the axis of the pane's main scale, inside the plot.
    const x = pane.primary.side === 'left' ? PLUS_GAP : this.plotWidth - PLUS_SIZE - PLUS_GAP;
    return { x, y: y - PLUS_SIZE / 2, width: PLUS_SIZE, height: PLUS_SIZE };
  }

  /**
   * Whether plot point `p` is on the "+" button.
   * @internal Called by Interaction.
   */
  plusButtonAt(p: Point): boolean {
    const r = this.#plusButtonRect();
    return !!r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  }

  /**
   * Track whether the pointer is on the "+" button, for its tooltip; returns whether it is.
   * @internal Called by Interaction.
   */
  hoverPlusButton(p: Point | null): boolean {
    const on = p !== null && this.plusButtonAt(p);
    if (on !== this.#plusHover) {
      this.#plusHover = on;
      this.#invalidateCursor();
    }
    return on;
  }

  /**
   * The `plus:click` payload for the button as it is now, or null when hidden.
   * @internal Called by Interaction on press.
   */
  plusButtonEvent(): PlusButtonEvent | null {
    const r = this.#plusButtonRect();
    const c = this.crosshair;
    if (!r || !c) return null;
    const pane = this.panes[c.pane]!;
    const cy = r.y + r.height / 2;
    // Snapped like a dragged trade line: the price format's tick, else one unit of the series precision.
    const raw = pane.primary.yToPrice(cy - pane.top);
    const series = pane.series.find((x) => x === this.#mainSeries) ?? pane.series.find((x) => x.scale === pane.primary) ?? null;
    const price = snapToTick(raw, defaultTickSize(series, raw));
    return { price, pane: c.pane, scale: pane.primary.id, x: r.x + r.width / 2 + this.plotLeft, y: cy };
  }

  #drawPlusButton(ctx: CanvasRenderingContext2D): void {
    const r = this.capture ? null : this.#plusButtonRect();
    if (!r) return;
    const t = this.theme;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = t.labelBackground;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, 3);
    ctx.fill();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    ctx.strokeStyle = t.labelText;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 4.5, cy);
    ctx.lineTo(cx + 4.5, cy);
    ctx.moveTo(cx, cy - 4.5);
    ctx.lineTo(cx, cy + 4.5);
    ctx.stroke();
    if (this.#plusHover) {
      const e = this.plusButtonEvent();
      const text = e ? `Add at ${this.formatPrice(e.pane, e.price)}` : '';
      const font = this.#font('labels');
      ctx.font = fontCss(font);
      const w = ctx.measureText(text).width + 12;
      const h = font.fontSize + 8;
      const left = r.x > this.plotWidth / 2 ? r.x - w - 4 : r.x + r.width + 4;
      ctx.fillStyle = t.labelBackground;
      ctx.beginPath();
      ctx.roundRect(left, cy - h / 2, w, h, 3);
      ctx.fill();
      ctx.fillStyle = t.labelText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fillText(ctx, text, left + w / 2, cy + 0.5);
    }
    ctx.restore();
  }

  /** Each series' price line (see the `priceLine` series and indicator plot option). */
  #drawLastValueLines(ctx: CanvasRenderingContext2D, pane: Pane): void {
    const visibleTo = this.time.visibleRange().to;
    for (const s of pane.series) for (const line of s.priceLines(visibleTo)) {
      let { value, color } = line;
      if (s === this.#mainSeries && line.source === 'last' && this.#optIn.referenceLines) {
        // Outside the session the main line can sit at the regular-session close.
        const last = this.#optIn.referenceLines.mainLast({ value, text: '', color });
        value = last.value;
        const own = (s.options as PriceLineSeriesOptions).priceLine;
        if (typeof own !== 'object' || own.color === undefined) color = last.color;
      }
      const y = sharp(s.scale.priceToY(value));
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = line.lineWidth;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash(PRICE_LINE_DASH[line.lineStyle]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotWidth, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Lane space each side needs, from the `depthLane()` plugin's lane host: none without it. */
  #measureLanes(): { left: number; right: number } {
    return this.#optIn.depthLane?.measure(this.panes, this.primitives) ?? { left: 0, right: 0 };
  }

  /** Primitive drawing in the price-axis and time-axis areas, clipped to them. */
  #drawPrimitiveAxes(ctx: CanvasRenderingContext2D): void {
    for (const e of this.primitives.all) {
      const { primitive, pane } = e;
      if ((e.series && !e.series.visible) || !this.#captures(e)) continue;
      if (primitive.drawPriceAxis && pane.height > 0 && !pane.collapsed) {
        const scale = this.labelScale(pane, e.series?.scale ?? pane.price);
        const axisWidth = this.axisWidths[scale.side === 'left' ? 'left' : 'right'];
        ctx.save();
        ctx.translate(this.#axisLeft(pane, scale), pane.top);
        clipBox(ctx, axisWidth, pane.height);
        this.primitives.guard.call(primitive, 'drawPriceAxis', () => primitive.drawPriceAxis!(ctx, this.#primitiveEnv(e, axisWidth, pane.height)), undefined);
        ctx.restore();
      }
      if (primitive.drawTimeAxis && this.#timeAxisSize() > 0) {
        ctx.save();
        ctx.translate(0, this.plotHeight);
        clipBox(ctx, this.plotWidth, this.#timeAxisSize());
        this.primitives.guard.call(primitive, 'drawTimeAxis', () => primitive.drawTimeAxis!(ctx, this.#primitiveEnv(e, this.plotWidth, this.#timeAxisSize())), undefined);
        ctx.restore();
      }
    }
  }

  private drawLastValueLabels(ctx: CanvasRenderingContext2D, pane: Pane, index: number): void {
    if (pane.collapsed || pane.height <= 0) return;
    type Item = { y: number; text: string; bg: string; fg: string; sub?: string; title?: string; outline?: string };
    const columns = new Map<PriceScale, Item[]>();
    const push = (scale: PriceScale, item: Item) => {
      if (item.y < pane.top || item.y > pane.top + pane.height) return;
      const column = this.labelScale(pane, scale);
      const list = columns.get(column);
      if (list) list.push(item);
      else columns.set(column, [item]);
    };
    // Reference lines have their own switches; the rest follow `features.lastValueLabels`.
    this.#optIn.referenceLines?.labels(pane, push);
    const lastValues = this.#flags.lastValueLabels;
    for (const e of this.primitives.all) {
      if (!lastValues) break;
      if (e.pane !== pane || !e.primitive.priceAxisLabels || (e.series && !e.series.visible)) continue;
      const env = this.#primitiveEnv(e, this.plotWidth, pane.height);
      for (const label of this.primitives.guard.call(e.primitive, 'priceAxisLabels', () => e.primitive.priceAxisLabels!(env), [])) {
        const bg = label.color;
        push(e.series?.scale ?? pane.price, { y: pane.top + env.priceToY(label.price), text: label.text, bg, fg: label.textColor ?? labelTextColor(bg) });
      }
    }
    // The newest bar is panned off the right edge: labels may go hollow or hide (`offscreenLastPrice`).
    const newestOff = this.timeline.lastIndex > this.time.visibleRange().to;
    for (const s of pane.series) {
      if (!lastValues || !s.visible) continue;
      const offscreen = newestOff ? (s.options as PriceLineSeriesOptions).offscreenLastPrice : undefined;
      if (offscreen === 'hidden') continue;
      // The countdown goes on the newest value only; without one (lastValueLabel off) the labels are base levels.
      const newest = s === this.#mainSeries && s.lastValue() !== null;
      for (const [k, value] of s.lastValues().entries()) {
        // Outside the session the main label can show the regular-session close.
        const last = newest && k === 0 ? (this.#optIn.referenceLines?.mainLast(value) ?? value) : value;
        const onAxis = !s.overlayScale && this.axisScales(pane).includes(s.scale);
        // Percent and indexed scales label every series in their mode; the main series uses its scale's format too.
        const relative = !s.overlayScale && (s.scale.mode === 'percent' || s.scale.mode === 'indexed');
        const text = relative || (s === this.#mainSeries && onAxis) ? this.formatAxis(index, last.value, s.scale.id) : last.text;
        const item: Item =
          offscreen === 'hollow'
            ? { y: pane.top + s.scale.priceToY(last.value), text, bg: this.theme.background, fg: last.color, outline: last.color }
            : { y: pane.top + s.scale.priceToY(last.value), text, bg: last.color, fg: labelTextColor(last.color) };
        const sub = newest && k === 0 ? this.countdownText() : undefined;
        if (sub) item.sub = sub;
        // The main series falls back to its symbol's name.
        const title = value.title === '' && s === this.#mainSeries ? this.dataController?.symbol?.name : value.title;
        if (title) item.title = title;
        push(s.scale, item);
      }
    }
    // Labels on one axis move apart instead of covering each other.
    const fs = this.#axisFont('price').fontSize;
    const line = this.#labelLine(fs);
    for (const [scale, items] of columns) {
      // A pill with a countdown is taller; the next label keeps clear of all of it.
      const gaps = items.map((it) => (it.sub ? line + fs + 2 : line) + 1);
      const ys = spreadLabels(items.map((it) => it.y), gaps, pane.top + line / 2, pane.top + pane.height - line / 2);
      items.forEach((it, k) => {
        const x0 = this.#axisLeft(pane, scale);
        this.axisPill(ctx, it.text, ys[k]!, it.bg, it.fg, it.sub, x0, scale.side, it.outline);
        if (it.title) this.#axisTag(ctx, it.title, ys[k]!, it.bg, it.fg, scale.side);
      });
    }
  }

  /** A title tag inside the plot, next to the price axis on `side`, centred on `y`. */
  #axisTag(ctx: CanvasRenderingContext2D, text: string, y: number, bg: string, fg: string, side: PriceScaleSide): void {
    const font = this.#axisFont('price');
    const line = this.#labelLine(font.fontSize);
    const prevFont = ctx.font;
    ctx.font = fontCss(font);
    const w = Math.ceil(ctx.measureText(text).width) + 12;
    const left = side === 'left';
    const x = left ? 2 : this.plotWidth - w - 2;
    const top = Math.round(y - line / 2);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, top, w, line, 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillText(ctx, text, x + w / 2, top + line / 2 + 0.5);
    ctx.font = prevFont;
  }

  /**
   * Margins of `pane` (fractions) for the scale sides not set explicitly. Each
   * edge keeps room for what sits on it, so the highest high and lowest low
   * never touch the edge or sit under the legend: the legend block at the
   * legend's edge, else half a price label (the end labels are centred on the
   * extremes). The data keeps at least half the pane: the legend's edge takes
   * up to half, and the other edge what is left of the other half.
   */
  #autoMargins(pane: Pane): [number, number] {
    const h = pane.height;
    if (!(h > 0)) return [0, 0];
    const half = this.#labelLine(this.#font('axis').fontSize) / 2;
    const edge = Math.min(Math.max(half, this.#flags.legend ? legendHeight(pane, this.theme, this.#legendConfig) : 0), h / 2);
    const other = Math.min(half, h / 2 - edge);
    return this.#legendConfig.position.startsWith('bottom') ? [other / h, edge / h] : [edge / h, other / h];
  }

  /** Height (css px) of a one-line filled price label in a `fontSize` font: the text and `priceAxis.labelPaddingY` twice. */
  #labelLine(fontSize: number): number {
    return fontSize + 2 * this.options.priceAxis.labelPaddingY;
  }

  /**
   * The axis column a label for `scale` goes on: its own axis, else the pane's first axis on the main side.
   * @internal
   */
  labelScale(pane: Pane, scale: PriceScale): PriceScale {
    const axes = this.axisScales(pane);
    if (axes.includes(scale)) return scale;
    return axes.find((s) => s.side === this.#mainSide) ?? axes[0] ?? pane.price;
  }

  /** Left edge of `scale`'s axis column in plot coordinates (left columns are at negative x). */
  #axisLeft(pane: Pane, scale: PriceScale): number {
    const side = scale.side === 'left' ? 'left' : 'right';
    const slot = Math.max(0, this.axisScales(pane).filter((s) => s.side === side).indexOf(scale));
    const w = this.axisWidths[side];
    return side === 'left' ? -(slot + 1) * w - this.laneSpace.left : this.plotWidth + this.laneSpace.right + slot * w;
  }

  #axisColumns(): { left: number; right: number } {
    return axisColumns(this.panes, this.#mainSide);
  }

  /** Side the main price scale's axis defaults to, and the pane and scroll buttons sit on: the end side. */
  get #mainSide(): 'left' | 'right' {
    return this.#rtl ? 'left' : 'right';
  }

  /** Whether `direction` resolves to right to left; `'auto'` reads the root's computed direction. */
  #readRtl(): boolean {
    const { direction } = this.options;
    if (direction !== 'auto') return direction === 'rtl';
    return typeof getComputedStyle === 'function' && getComputedStyle(this.root).direction === 'rtl';
  }

  /** Follow a direction change: main scales the app gave no side move to the new main side. */
  #syncDirection(): void {
    const rtl = this.#readRtl();
    if (rtl === this.#rtl) return;
    this.#rtl = rtl;
    for (const pane of this.panes) if (!this.#pinnedSides.has(pane.price)) pane.price.side = this.#mainSide;
    this.redraw('layout');
  }

  /** Take a fixed `priceAxisWidth`, or let auto mode measure afresh on the next frame. */
  #syncAxisWidths(): void {
    const width = this.options.priceAxisWidth;
    this.axisMeasured = false;
    if (width !== 'auto') this.axisWidths = { left: width, right: width };
  }

  /**
   * In auto mode, size each side's axis columns to the widest label they show:
   * tick labels and units, the scale's top and bottom prices (which bound the
   * crosshair label) and last-value labels with the countdown. A side grows at
   * once but shrinks only by more than a font size, so labels that change by a
   * digit do not make it jitter. True when a width changed.
   */
  #fitAxisWidths(): boolean {
    if (this.options.priceAxisWidth !== 'auto') return false;
    const ctx = this.ctx(this.top);
    const font = this.#axisFont('price');
    ctx.font = fontCss(font);
    const numerals = font.numerals;
    const widthKey = `${ctx.font} ${numerals}`;
    if (widthKey !== this.textWidthFont || this.#textWidths.size > TEXT_WIDTH_CACHE) {
      this.#textWidths.clear();
      this.textWidthFont = widthKey;
    }
    const need = { left: 0, right: 0 };
    const fit = (side: 'left' | 'right', text: string | undefined) => {
      if (text) need[side] = Math.max(need[side], this.#textWidth(ctx, text, numerals));
    };
    const sideOf = (scale: PriceScale) => (scale.side === 'left' ? 'left' : 'right');
    this.panes.forEach((pane, i) => {
      if (pane.collapsed || pane.height <= 0) return;
      for (const scale of this.axisScales(pane)) {
        const side = sideOf(scale);
        for (const label of this.paneTicks.get(scale)?.labels ?? []) fit(side, label);
        fit(side, this.#scaleFormatOf(i, scale)?.unit);
        fit(side, this.formatAxis(i, scale.minPrice, scale.id));
        fit(side, this.formatAxis(i, scale.maxPrice, scale.id));
      }
      if (!this.#flags.lastValueLabels) return;
      for (const s of pane.series) {
        if (!s.visible) continue;
        const side = sideOf(this.labelScale(pane, s.scale));
        for (const last of s.lastValues()) {
          fit(side, last.text);
          if (!s.overlayScale) fit(side, this.formatAxis(i, last.value, s.scale.id));
        }
        if (s === this.#mainSeries) fit(side, this.countdownText());
      }
    });
    const { padding, minWidth, maxWidth = Infinity, labelPointer } = this.options.priceAxis;
    const shrinkBy = font.fontSize;
    // A label's point takes room beside its text.
    const point = labelPointer ? LABEL_POINTER : 0;
    let changed = false;
    for (const side of ['left', 'right'] as const) {
      if (need[side] === 0) continue;
      const target = clampNum(Math.ceil(AXIS_LABEL_INSET + point + need[side] + padding), minWidth, Math.max(minWidth, maxWidth));
      const current = this.axisWidths[side];
      if (this.axisMeasured && target <= current && target >= current - shrinkBy) continue;
      if (target !== current) {
        this.axisWidths[side] = target;
        changed = true;
      }
    }
    this.axisMeasured = true;
    return changed;
  }

  /** Width (css px) of `text` in the axis font and numerals, cached. */
  #textWidth(ctx: CanvasRenderingContext2D, text: string, numerals: ResolvedFont['numerals']): number {
    let w = this.#textWidths.get(text);
    if (w === undefined) {
      w = measureNumerals(ctx, text, numerals);
      this.#textWidths.set(text, w);
    }
    return w;
  }

  /** Time left in the newest bar, or undefined when it is not forming now. */
  private countdownText(): string | undefined {
    return this.#flags.countdown ? this.#optIn.countdown?.(this) : undefined;
  }

  /** A filled label in one axis column (`x0` is its left edge in plot coordinates; default the first right column). */
  private axisPill(
    ctx: CanvasRenderingContext2D,
    text: string,
    y: number,
    bg: string,
    fg: string,
    sub?: string,
    x0 = this.plotWidth,
    side: PriceScaleSide = 'right',
    outline?: string,
  ): void {
    const font = this.#axisFont('price');
    const fs = font.fontSize;
    const { labelMode, labelPointer } = this.options.priceAxis;
    const line = this.#labelLine(fs);
    const h = sub ? line + fs + 2 : line;
    const left = side === 'left';
    const column = this.axisWidths[left ? 'left' : 'right'];
    const point = labelPointer ? LABEL_POINTER : 0;
    const prevFont = ctx.font;
    ctx.font = fontCss(font);
    const full = column - 2 - point;
    const fit = () => Math.max(measureNumerals(ctx, text, font.numerals), sub ? measureNumerals(ctx, sub, font.numerals) : 0);
    const w = Math.max(0, labelMode === 'content' ? Math.min(full, Math.ceil(fit()) + 2 * (AXIS_LABEL_INSET - 1)) : full);
    // The body sits against the plot side of the column, after the point.
    const x = left ? x0 + column - 1 - point - w : x0 + 1 + point;
    const top = Math.round(y - line / 2);
    const tip = point ? (left ? x0 + column - 1 : x0 + 1) : null;
    ctx.fillStyle = bg;
    labelPath(ctx, x, top, w, h, line, tip, !!sub);
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      labelPath(ctx, x + 0.5, top + 0.5, w - 1, h - 1, line - 1, tip === null ? null : tip + (left ? -0.5 : 0.5), !!sub);
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    const tx = left ? x + w - (AXIS_LABEL_INSET - 1) : x + AXIS_LABEL_INSET - 1;
    fillNumerals(ctx, text, tx, top + line / 2 + 0.5, font.numerals);
    if (sub) {
      ctx.globalAlpha = 0.85;
      fillNumerals(ctx, sub, tx, top + line + fs / 2 - 1, font.numerals);
      ctx.globalAlpha = 1;
    }
    ctx.font = prevFont;
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D): void {
    const c = this.crosshair;
    const o = this.options.crosshair;
    if (!c || this.timeline.length === 0 || o.mode === 'hidden' || this.hideCrosshair) return;
    const t = this.theme;
    // x < 0 happens when a mirrored crosshair's time is scrolled out of view.
    const inPlot = c.x >= 0 && c.x < this.plotWidth;
    // NaN y: a mirrored crosshair without a price draws only the vertical line.
    const hasPrice = !Number.isNaN(c.y);
    const index = Math.round(this.time.xToIndex(c.x));
    const pane = this.panes[c.pane]!;
    const cy = clampLow(this.#crosshairY(c), pane.top, pane.top + pane.height);
    // Grouped: on the bucket's centre, labelled with its time span.
    const span = this.#bucketSpan(index);
    const x = this.time.indexToX(span ? (span.from + span.to) / 2 : index);
    // `pointer` keeps the labels but draws no lines.
    const lines = this.crosshairCursor === 'cross';
    if (inPlot && lines && o.vertical.visible) crosshairLine(ctx, o.vertical, t.crosshair, x, 0, x, this.plotHeight, true);
    // The horizontal line and price labels: in the crosshair's pane, and with `horizontalInAllPanes` at that price elsewhere.
    const rows: { pane: Pane; index: number; y: number }[] = hasPrice ? [{ pane, index: c.pane, y: cy }] : [];
    if (hasPrice && o.horizontalInAllPanes) {
      const price = pane.primary.yToPrice(cy - pane.top);
      this.panes.forEach((p, i) => {
        if (p === pane || p.collapsed || p.height <= 0 || (this.#maximized && p !== this.#maximized)) return;
        const y = p.top + p.primary.priceToY(price);
        if (y >= p.top && y <= p.top + p.height) rows.push({ pane: p, index: i, y });
      });
    }
    for (const row of rows) {
      // The price labels belong to the horizontal line and hide with it.
      if (!o.horizontal.visible) continue;
      if (lines) crosshairLine(ctx, o.horizontal, t.crosshair, 0, row.y, this.plotWidth, row.y, false);
      if (!o.labels.price) continue;
      const y = sharp(row.y);
      for (const scale of this.axisScales(row.pane)) {
        const label = this.formatAxis(row.index, scale.yToPrice(y - row.pane.top), scale.id);
        this.axisPill(ctx, label, y, t.labelBackground, t.labelText, undefined, this.#axisLeft(row.pane, scale), scale.side);
      }
    }
    // A hidden time axis takes its labels with it; one at the top of the plot stays.
    if (!inPlot || !o.labels.time || (o.timeLabelPosition === 'bottom' && this.#timeAxisSize() === 0)) return;
    const label = this.#spanText(index);
    const top = o.timeLabelPosition === 'top' ? 3 : this.plotHeight + 3;
    this.#timePill(ctx, label, x, top, t.labelBackground, t.labelText);
  }

  /** A filled time label centred on `x` and kept inside the plot; `top` is its top edge. */
  #timePill(ctx: CanvasRenderingContext2D, text: string, x: number, top: number, bg: string, fg: string): void {
    const font = this.#axisFont('time');
    const prevFont = ctx.font;
    ctx.font = fontCss(font);
    const w = measureNumerals(ctx, text, font.numerals) + 14;
    // The axis height even while it is hidden, for a label at the top of the plot.
    const h = this.options.timeAxis.height - 6;
    const lx = clampLow(sharp(x) - w / 2, 0, this.plotWidth - w);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(lx, top, w, h, 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillNumerals(ctx, text, lx + w / 2, top + h / 2, font.numerals);
    ctx.font = prevFont;
  }

  /** The resolved legend settings (the object form of the `legend` option). */
  get legendSettings(): LegendSettings {
    return { ...this.#legendConfig };
  }

  #legendFrame(index = this.#legendIndex()): LegendFrame {
    return {
      panes: this.panes,
      index,
      idle: !this.crosshair,
      theme: this.theme,
      plotLeft: this.plotLeft,
      plotRight: this.plotLeft + this.plotWidth,
      width: this.width,
      height: this.height,
      settings: this.#legendConfig,
      rtl: this.#rtl,
      // Buttons sharing an end corner with the legend.
      paneButtons: this.#paneButtonsHeight(),
      scrollButton: this.options.scrollButton ? SCROLL_BUTTON_MARGIN + SCROLL_BUTTON_SIZE : 0,
    };
  }

  /** Height the pane buttons take at the top end of each pane: 0 without them (panes have buttons only when there are several). */
  #paneButtonsHeight(): number {
    return this.options.paneButtons && this.panes.length > 1 ? PANE_BUTTONS_BOTTOM : 0;
  }

  /** Bar the legend describes: under the crosshair, else the newest. */
  #legendIndex(): number {
    return this.crosshair ? Math.round(this.time.xToIndex(this.crosshair.x)) : this.timeline.lastIndex;
  }

  #updateLegendAndInspector(): void {
    const index = this.#legendIndex();
    if (this.#flags.legend) {
      this.#legend.update({
        ...this.#legendFrame(index),
        badge: this.options.marketStatus ? this.badge : '',
        text: this.#localizer,
        controls: {
          enabled: this.#flags.legendButtons,
          settings: (s) => this.#rowHasSettings(s),
          menu: this.#flags.contextMenu && this.listens('chart:contextmenu'),
          removable: (s) => s !== this.#mainSeries,
          shown: (s) => this.#indicatorOf(s)?.visible ?? s.visible,
          folded: (s) => this.isLegendFolded(s),
          selected: (s) => s === this.#selection?.indicator?.series,
        },
      });
    } else {
      this.#legend.hide();
    }
    this.placeStatus();
    this.#paneControls.update(this.panes, {
      hover: this.crosshair?.pane ?? -1,
      maximized: this.#maximized ? this.panes.indexOf(this.#maximized) : -1,
      axisWidth: this.#rtl ? this.plotLeft : this.width - this.plotLeft - this.plotWidth,
      side: this.#mainSide,
      theme: this.theme,
      enabled: this.options.paneButtons,
      text: this.#localizer,
    });
    // The heatmap cell under the crosshair, through the `heatmap()` plugin, or the one whose inspector was made.
    const inspect = this.#inspect ?? this.#optIn.heatmap?.inspect;
    if (inspect?.(this, index)) this.#inspect = inspect;
  }

}

/** `patch` merged per line into `lines`: the `referenceLines` option of a chart without the `referenceLines()` plugin. */
function mergeLines(lines: ReferenceLinesUpdate = {}, patch: ReferenceLinesUpdate = {}): ReferenceLinesUpdate {
  checkReferenceLines(patch);
  const out: Record<string, object> = { ...lines };
  for (const [kind, line] of Object.entries(patch)) out[kind] = { ...out[kind], ...line };
  return out;
}

/** Development builds: say once that `what` has nowhere to draw on a chart without the annotations plugin (`feature`). */
function annotationsNeeded(feature: AnnotationManager | null | undefined, what: string): void {
  if (!feature && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
    devWarnOnce(`${what} draw through annotations: add the annotations() plugin (or builtins()) to show them`, 'annotations-missing');
  }
}

/** Clip `ctx` to the box from its origin to `(width, height)`. */
function clipBox(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
}

/**
 * Series of a pane bottom to top: by `zIndex`, then heatmaps, overlay-scale
 * series (volume) and volume profiles, then the rest; ties in the order added.
 * Each canvas draws its own series in this order, the GPU canvas below the 2D one.
 * @internal Exported for tests.
 */
export function drawOrder(pane: Pane): readonly Series[] {
  const cached = drawOrders.get(pane);
  if (cached && orderHolds(cached, pane.series)) return cached.order;
  const order = [...pane.series].sort((a, b) => a.zIndex - b.zIndex || orderRank(a) - orderRank(b));
  drawOrders.set(pane, {
    added: [...pane.series],
    z: pane.series.map((s) => s.zIndex),
    rank: pane.series.map(orderRank),
    order,
  });
  return order;
}

/**
 * A pane's draw order and what it was sorted from. Every layer of every frame
 * asks for it, so it is sorted again only when the pane's series, a `zIndex`
 * or a rank changed, which a check without allocating finds.
 */
interface CachedOrder {
  added: Series[];
  z: number[];
  rank: number[];
  order: Series[];
}

const drawOrders = new WeakMap<Pane, CachedOrder>();

function orderRank(s: Series): number {
  return isHeatmap(s) ? 0 : s.overlayScale || s.kind === 'volumeProfile' ? 1 : 2;
}

/** By `kind`, so the chart needs no runtime reference to the opt-in heatmap code. */
function isHeatmap(s: Series): s is HeatmapSeries {
  return s.kind === 'heatmap';
}

function orderHolds(c: CachedOrder, series: readonly Series[]): boolean {
  if (c.added.length !== series.length) return false;
  for (let i = 0; i < series.length; i++) {
    const s = series[i]!;
    if (c.added[i] !== s || c.z[i] !== s.zIndex || c.rank[i] !== orderRank(s)) return false;
  }
  return true;
}

/** A finite price that has a position on `scale`: a log scale has none at or below zero. */
function placeable(price: number, scale: PriceScale): boolean {
  return Number.isFinite(price) && (scale.mode !== 'log' || price > 0);
}

/** Side of the "+" button, and its gap from the axis (css px). */
const PLUS_SIZE = 18;
const PLUS_GAP = 2;

/**
 * The path of a filled axis label: a box at (`x`, `top`) with rounded corners,
 * and with `tipX` a point out of the side facing it, its tip level with the
 * middle of the first `line` px. The corners next to the point are square; the
 * lower one stays round on a `tall` (two-line) box.
 */
function labelPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  h: number,
  line: number,
  tipX: number | null,
  tall: boolean,
): void {
  const r = 2;
  ctx.beginPath();
  if (tipX === null) {
    ctx.roundRect(x, top, w, h, r);
    return;
  }
  const right = x + w;
  const bottom = top + h;
  const mid = top + line / 2;
  if (tipX < x) {
    ctx.moveTo(x, top);
    ctx.arcTo(right, top, right, bottom, r);
    ctx.arcTo(right, bottom, x, bottom, r);
    if (tall) ctx.arcTo(x, bottom, x, top, r);
    else ctx.lineTo(x, bottom);
    ctx.lineTo(x, top + line);
    ctx.lineTo(tipX, mid);
  } else {
    ctx.moveTo(right, top);
    ctx.lineTo(tipX, mid);
    ctx.lineTo(right, top + line);
    if (tall) ctx.arcTo(right, bottom, x, bottom, r);
    else ctx.lineTo(right, bottom);
    ctx.arcTo(x, bottom, x, top, r);
    ctx.arcTo(x, top, right, top, r);
  }
  ctx.closePath();
}

/** The nested option groups, each with the objects inside it that also merge field by field. */
const OPTION_GROUPS = {
  grid: ['horizontal', 'vertical'],
  crosshair: ['vertical', 'horizontal', 'labels'],
  priceAxis: [],
  timeAxis: [],
  sketch: [],
  accessibility: [],
  zoomAnchor: [],
} as const;

type OptionGroups = Pick<ChartOptions, keyof typeof OPTION_GROUPS>;

/** Each option group of `base` with its part of `patch` applied; one `zoomAnchor` string sets both inputs. */
function mergeGroups(base: OptionGroups, patch: ChartOptionsPatch): OptionGroups {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(OPTION_GROUPS)) {
    const p = patch[key as keyof OptionGroups];
    out[key] = mergeGroup(base[key as keyof OptionGroups], typeof p === 'string' ? { plot: p, timeAxis: p } : p, inner);
  }
  return out as unknown as OptionGroups;
}

/**
 * `base` with `patch` applied, and the `inner` objects merged field by field.
 * In those an explicit `undefined` keeps the value, except a `color`, which
 * it clears back to the theme's.
 */
function mergeGroup<T extends object>(base: T, patch: object | undefined, inner: readonly string[]): T {
  const out = { ...base, ...patch } as Record<string, unknown>;
  for (const key of inner) {
    const line = { ...(base as Record<string, object>)[key] } as Record<string, unknown>;
    for (const [k, v] of Object.entries((patch as Record<string, object> | undefined)?.[key] ?? {})) {
      if (v !== undefined || k === 'color') line[k] = v;
    }
    out[key] = line;
  }
  return out as T;
}

/** `groups` with a valid crosshair, or a throw before anything changes. Settings saved before #862 keep loading. */
function checkCrosshair(groups: OptionGroups): OptionGroups {
  const { crosshair } = groups;
  for (const line of [crosshair.vertical, crosshair.horizontal]) {
    if (!['solid', 'dashed', 'dotted'].includes(line.lineStyle)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown crosshair lineStyle "${line.lineStyle}"` : '');
    if (!(Number.isFinite(line.width) && line.width > 0)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Crosshair line width must be a positive number' : '');
  }
  if (crosshair.timeLabelPosition !== 'top' && crosshair.timeLabelPosition !== 'bottom') {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown crosshair timeLabelPosition "${String(crosshair.timeLabelPosition)}"` : '');
  }
  // The plain arrow is the pointer, and the dot (no lines) becomes the crosshair it stood in for.
  // Development builds report the old value through the option check (`option-range`).
  const cursor = crosshair.cursor as string;
  if (cursor === 'arrow' || cursor === 'dot') crosshair.cursor = cursor === 'arrow' ? 'pointer' : 'cross';
  if (crosshair.cursor !== 'cross' && crosshair.cursor !== 'pointer') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown crosshair cursor "${String(crosshair.cursor)}"` : '');
  return groups;
}

const CROSSHAIR_DASH = { solid: [], dashed: [5, 4], dotted: [1, 3] } as const;

/** One crosshair line from (x1, y1) to (x2, y2), on whole pixels for odd widths. */
function crosshairLine(
  ctx: CanvasRenderingContext2D,
  line: CrosshairLineOptions,
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  vertical: boolean,
): void {
  const snap = (v: number) => (line.width % 2 === 1 ? sharp(v) : Math.round(v));
  ctx.save();
  ctx.strokeStyle = line.color ?? color;
  ctx.lineWidth = line.width;
  ctx.setLineDash(CROSSHAIR_DASH[line.lineStyle]);
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(snap(x1), y1);
    ctx.lineTo(snap(x2), y2);
  } else {
    ctx.moveTo(x1, snap(y1));
    ctx.lineTo(x2, snap(y2));
  }
  ctx.stroke();
  ctx.restore();
}

/** @internal Black or white text, whichever reads better on `color`. */
export function labelTextColor(color: string): string {
  const [r, g, b] = parseColor(color);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000' : '#fff';
}

/**
 * Create a chart that fills `container`. `options` is merged over
 * `defaultChartOptions`; change it later with `chart.applyOptions`. Needs WebGL2
 * (see `isWebGL2Supported`).
 *
 * @example
 * ```ts
 * const chart = createChart(el, { barSpacing: 10 });
 * const candles = chart.addCandles({ title: 'Price' });
 * candles.setData(bars); // { time (unix seconds), open, high, low, close, volume? }
 * chart.on('history:request', ({ before }) => loadOlder(before));
 * ```
 */
export function createChart(container: HTMLElement, options?: ChartOptionsPatch): Chart {
  return new Chart(container, options);
}

/** Raw numbers a series has at exactly `time`; see `SeriesValue.values`. */
function rawValues(s: Series, time: Time): Record<string, number> | null {
  if (s instanceof CandleSeries) {
    const b = atTime(s.data, time);
    if (!b) return null;
    const values: Record<string, number> = { open: b.open, high: b.high, low: b.low, close: b.close };
    if (b.volume !== undefined) values.volume = b.volume;
    return values;
  }
  if (s instanceof LineSeries || s instanceof HistogramSeries) {
    const p = atTime(s.data, time);
    return p ? { value: p.value } : null;
  }
  if (s.kind === 'points') {
    return (s as PointSeries).valuesInBar(time);
  }
  return null;
}

const GRID_DASH: Readonly<Record<GridLineStyle, number[]>> = { solid: [], dashed: [4, 4], dotted: [1, 3] };

/** `patch` merged into `grid` per direction; an `undefined` color clears it, other `undefined` values are ignored. */
export function mergeGrid(grid: GridOptions, patch: GridOptionsPatch | undefined): GridOptions {
  return patch ? mergeGroup(grid, patch, OPTION_GROUPS.grid) : grid;
}

/** Grid with each direction's color resolved: its own, the theme's per-direction color, then `theme.grid`. */
export function resolveGrid(grid: GridOptions, theme: ChartTheme): ChartAppearance['grid'] {
  return {
    horizontal: { ...grid.horizontal, color: grid.horizontal.color ?? theme.gridHorizontal ?? theme.grid },
    vertical: { ...grid.vertical, color: grid.vertical.color ?? theme.gridVertical ?? theme.grid },
  };
}

/** A copy of an autoscale rule with only the fields it sets, so callers never share its `include` array. */
function copyRule(rule: AutoscaleRule): AutoscaleRule {
  const copy: AutoscaleRule = {};
  if (rule.centerOn !== undefined) copy.centerOn = rule.centerOn;
  if (rule.include !== undefined) copy.include = [...rule.include];
  if (rule.minSpan !== undefined) copy.minSpan = rule.minSpan;
  return copy;
}

/** Throw on a `grouping` option the chart cannot use. */
function checkGrouping(grouping: GroupingOptions | null): void {
  if (!grouping) return;
  if (grouping.mode !== 'pixel' && grouping.mode !== 'calendar') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown grouping mode "${String(grouping.mode)}"` : '');
  const steps = grouping.steps;
  if (steps !== undefined && (!Array.isArray(steps) || steps.length === 0 || !steps.every(isTimeInterval))) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Grouping steps must be a non-empty list of intervals such as "1h" or "1d"' : '');
  }
}

/**
 * What to fill the background with: `color`, or a vertical gradient over `height` to the
 * theme's `backgroundBottom` when `color` is the theme background and the bottom color is set.
 * @internal
 */
export function backgroundFill(ctx: CanvasRenderingContext2D, color: string, theme: ChartTheme, height: number): string | CanvasGradient {
  const bottom = theme.backgroundBottom;
  if (color !== theme.background || !bottom) return color;
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  try {
    fill.addColorStop(0, color);
    fill.addColorStop(1, bottom);
  } catch {
    // A color the canvas cannot read: `addColorStop` throws where `fillStyle` would ignore it.
    return color;
  }
  return fill;
}

/** Whether two resolved themes have the same values. */
function sameTheme(a: ChartTheme, b: ChartTheme): boolean {
  for (const key of Object.keys(a) as (keyof ChartTheme)[]) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y) ? x.join() !== y.join() : x !== y) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}

/** Events whose listeners show legend or pane buttons, so adding or removing one redraws the overlay. */
const OVERLAY_EVENTS = new Set<keyof ChartEvents>(['series:settings', 'plus:click', 'chart:contextmenu']);
