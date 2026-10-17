import { devCheck, type OptionRuleName } from './options-schema';
import type { Bar, HeatmapData, PriceFormatter, Time, ValuePoint } from './types';
import type { ChartTheme } from './theme';
import type { Pane } from './pane';
import type { DrawnBar } from './pointer';
import { PriceScale, RangeBuilder, type PriceScaleMode, type TimeScale } from './scales';
import type { Timeline } from './timeline';
import type { RenderBackend } from './gl/backend';
import type { FillGradient, GpuOwner, RectUniforms } from './gl/renderer';
import { RectBatch, RectKind } from './gl/rect-batch';
import { LineBatch, type LineBuildShape } from './gl/line-batch';
import { HeatmapGrid, heatmapColumnLimit, percentileRange } from './gl/heatmap-grid';
import type { CellReduce } from './gl/heatmap-reduce';
// For bundle order only: the heatmap shader then sits next to the renderer's shaders, which gzips about 0.4 KiB smaller.
import './gl/heatmap-program';
import { buildLut, isColor, parseColor, unitColor, withAlpha, type Rgba } from './util/color';
import { autoPrecision, formatCompact } from './util/format';
import { createPriceFormat, decimalPriceFormat, type PriceFormat, type PriceFormatModel } from './util/price-format';
import { englishLocalizer, type Localizer } from './util/locale';
import type { BarMarker, LineStyle } from './annotations/types';
import {
  ColorPalette,
  buildLinePath,
  lineDash,
  scratchPath,
  traceRun,
  traceSpan,
  type LinePath,
  type LineShape,
  type LineType,
  type PathColors,
} from './line-path';
import { barProblem, dedupeByTime, normalizeBars, type DropReason } from './data/util';
import { devWarnOnce, isDev, warnTimes } from './util/dev';
import { replaceFront } from './util/array';
import { LINE_MERGES, bucketCenter, bucketRange, type Buckets, type GroupedLine, type LineField, type Merge, type Pyramid, type PyramidSource } from './lod';
import { onScreen, pulseOn, type LastPointPulse, type PulseClock } from './pulse';
import { bisect } from './util/search';
import { clampLow, clampNum, sharp } from './util/math';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The kind of a series, as `series.kind` reports it. */
export type SeriesKind = 'candles' | 'histogram' | 'line' | 'heatmap' | 'indicator' | 'custom' | 'volumeProfile' | 'points';

/** What a series needs from its chart. */
export interface SeriesHost {
  readonly timeline: Timeline;
  readonly theme: ChartTheme;
  readonly maxTextureSize: number;
  /** Main candle series data changed: rebuild the timeline and realign everyone. */
  mainDataChanged(appended: boolean, keepVisibleRange?: boolean): void;
  /** The main series gained `count` older bars in front of its first one (a history page). */
  mainDataPrepended?(count: number): void;
  /** The main series' last bar was replaced in place (live tick). */
  mainLastBarChanged(): void;
  /** The main series' bars, for series that follow them; empty without a main series. */
  readonly mainBars?: readonly Bar[];
  requestRender(): void;
  /** Free the GPU objects mirroring a batch or grid of a disposed series. */
  releaseGpu?(owner: GpuOwner): void;
  /** A user-supplied series hook threw; the series already recovered. */
  seriesError?(event: SeriesErrorEvent): void;
  /** The series left out a bar or point: older than its last one, or a duplicate when normalizing. */
  seriesDropped?(series: Series, bar: unknown, reason: DropReason): void;
  /** `applyOptions` changed the series' options. */
  seriesOptionsChanged?(series: Series, patch: object): void;
  /** `setVisible` showed or hid the series. */
  seriesVisibilityChanged?(series: Series): void;
  /**
   * How the view groups bars into buckets (the `grouping` option, zoomed
   * out); null or unset draws single bars.
   */
  readonly buckets?: Buckets | null;
  /** Makes the coarser levels and grouped lines that grouped bars draw from; set whenever `buckets` is (the `grouping()` plugin). */
  readonly groupLevels?: SeriesLevels | null;
  /** Numbers in the chart's language (the `localization` option); unset means the built-in English formats. */
  readonly localization?: Localizer;
  /** The chart shows no animations (a static chart, or low-power mode); series draw their end states. */
  readonly animationsOff?: boolean;
  /** The chart's `lowPower` option: no tweens, and the cheapest GPU sampling. */
  readonly lowPower?: boolean;
  /** An indicator's shape plots changed: draw `markers` (oldest first, the caller's array) as bar markers. */
  setPlotMarkers?(series: Series, markers: BarMarker[]): void;
  /** An indicator's bar colour plots changed from data index `from` on: recolour the main series' bars with `at` (null stops). */
  setBarColors?(series: Series, at: ((i: number) => string | undefined) | null, from: number): void;
  /** Makes the drawer of a candle series' `kagi` and `pointFigure` styles (the `priceStyles()` plugin); unset draws neither. */
  readonly priceStyles?: ((series: CandleSeries, release: (owner: GpuOwner) => void) => PriceStyleDrawer) | null;
  /** Makes a series' last-point pulse clock (the `lastPointPulse()` plugin); `still` says whether the chart shows no animations. Unset draws no pulse. */
  readonly pulse?: ((still: () => boolean) => PulseClock) | null;
}

/** @internal Makes what a series draws grouped bars from: coarser levels of its items, and a grouped line's vertices. */
export interface SeriesLevels {
  pyramid<F extends string>(merges: Readonly<Record<F, Merge>>, source: PyramidSource<F>): Pyramid<F>;
  line(): GroupedLine;
}

/** Options for `setData`. */
export interface SetDataOptions {
  /**
   * Sort by time and keep the last of equal times instead of throwing on
   * unsorted or duplicate times; candles also drop invalid bars. Each item
   * left out is reported through `data:dropped`. A time that is not a finite
   * number still throws.
   */
  normalize?: boolean;
  /**
   * On the main series (the one that sets the time axis): keep the visible
   * start and end times when the new bars cover them. Otherwise the view
   * keeps its distance from the newest bar, so a longer or shorter series
   * shifts the times in view. Ignored on other series.
   */
  keepVisibleRange?: boolean;
}

/** User-supplied series hooks the chart calls: a custom series' hooks, and the `follow` mapper of any series. */
export type CustomSeriesHook = 'draw' | 'priceRange' | 'legend' | 'lastValue' | 'step' | 'format' | 'follow' | 'autoscale' | 'group';

/** Payload of the `series:error` event. */
export interface SeriesErrorEvent {
  series: Series;
  hook: CustomSeriesHook;
  error: unknown;
}

/**
 * Hand a hook failure to `emit` (the chart's `series:error` listeners), or log it
 * when nobody listens. A throwing listener is logged too: it runs mid-frame, so
 * letting it escape would abort the frame with drawing state half applied.
 */
export function reportSeriesError(event: SeriesErrorEvent, emit: ((event: SeriesErrorEvent) => void) | null): void {
  if (!emit) {
    console.error(`Series ${event.series.id} ${event.hook} hook threw`, event.error);
    return;
  }
  try {
    emit(event);
  } catch (error) {
    console.error('A series:error listener threw', error);
  }
}

/** Everything needed to draw one pane. Sizes in css px. */
export interface PaneEnv {
  time: TimeScale;
  pane: Pane;
  width: number;
  height: number;
  from: number;
  to: number;
  dpr: number;
  theme: ChartTheme;
  /** Timeline index under the crosshair; set only for `drawCrosshair2D`, on the crosshair layer. */
  crosshair?: number;
}

/** One value in a legend row: its text, an optional colour and an optional muted label. */
export interface LegendPart {
  text: string;
  color?: string;
  /** Muted prefix such as "O" / "H" (compact value labels). */
  label?: string;
}

/** A series' legend row: its title and the values shown after it. */
export interface LegendEntry {
  title: string;
  parts: LegendPart[];
}

/** How much a legend row shows: everything, the close (or value) only, or the title only. */
export type LegendMode = 'full' | 'compact' | 'title';

/** Legend settings a series' row depends on. */
export interface LegendView {
  mode: LegendMode;
  /** Candles: show the change and percent change from the previous close. */
  showChange: boolean;
  /** Candles: put an up or down arrow before the change. */
  changeArrows?: boolean;
}

const FULL_VIEW: LegendView = { mode: 'full', showChange: true };

/**
 * Candle change from the previous close as legend text, e.g. "+1.20 (+0.85%)";
 * with `arrows`, "▲ +1.20 (+0.85%)" or "▼ -1.20 (-0.85%)", nothing when unchanged.
 * The percentage uses `locale`'s decimal mark, digits and percent sign (default English).
 */
export function changeText(
  close: number,
  prevClose: number,
  format: (v: number) => string,
  arrows = false,
  locale: Pick<Localizer, 'number'> & Partial<Pick<Localizer, 'percent'>> = englishLocalizer,
): string {
  const change = close - prevClose;
  const pct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const sign = change >= 0 ? '+' : '';
  const arrow = arrows && change !== 0 ? (change > 0 ? '▲ ' : '▼ ') : '';
  const percent = locale.percent ? locale.percent(pct, 2) : `${locale.number(pct, 2)}%`;
  return `${arrow}${sign}${format(change)} (${sign}${percent})`;
}

/** A price axis label for a series' newest value: the value, its text and its colour. */
export interface LastValue {
  value: number;
  text: string;
  color: string;
  /** Tag shown beside the label (the series title with `axisTitle`). */
  title?: string;
}

/** How a series price line is drawn: solid, dashed or dotted. */
export type SeriesPriceLineStyle = 'solid' | 'dashed' | 'dotted';

/** The horizontal line across the plot at a series' newest (or newest visible) value. */
export interface SeriesPriceLineOptions {
  /** Defaults to the value's label color. */
  color?: string;
  /** Default 1. */
  lineWidth?: number;
  /** Default `'dotted'`. */
  lineStyle?: SeriesPriceLineStyle;
  /** `'last'` (default): the newest value. `'lastVisible'`: the newest value on screen, following the view while panning. */
  source?: 'last' | 'lastVisible';
}

/** A resolved price line for one frame. */
export interface SeriesPriceLine {
  value: number;
  color: string;
  lineWidth: number;
  lineStyle: SeriesPriceLineStyle;
  source: 'last' | 'lastVisible';
}

/** A price range: `low` at or below `high`. */
export interface AutoscaleRange {
  low: number;
  high: number;
}

/** What an `autoscale` function gets besides the range. */
export interface AutoscaleContext {
  series: Series;
  /** Visible logical indices (fractional at the edges). */
  from: number;
  to: number;
  /** Mode of the series' price scale. Ranges are prices in every mode. */
  mode: PriceScaleMode;
}

/**
 * Adjusts or replaces the price range a series adds to its scale's autoscale:
 * gets the visible range of its values (null when none are visible) and
 * returns the range to fit, or null to add nothing this frame. On a log
 * scale, values at or below zero are left out.
 */
export type AutoscaleProvider = (range: AutoscaleRange | null, context: AutoscaleContext) => AutoscaleRange | null;

/** Options shared by the candle, line, histogram and custom series: price line, off-screen label and autoscale. */
export interface PriceLineSeriesOptions {
  /**
   * How the series takes part in its price scale's autoscale. `true` (the
   * default) fits its visible values, `false` leaves it out (it still draws,
   * possibly off the pane), and a function adjusts the range it adds. Primitives
   * attached to the series still add their own ranges.
   */
  autoscale?: boolean | AutoscaleProvider;
  /**
   * Price line across the plot: `true` for the default style, an object to
   * style it, `false` for none. Separate from `lastValueLabel`. Default: on for
   * the main candle series, off for the others.
   */
  priceLine?: boolean | SeriesPriceLineOptions;
  /**
   * The last-value label when the newest bar is panned off screen: `'hollow'`
   * draws it as an outline, `'hidden'` leaves it out. Unset keeps it as is.
   */
  offscreenLastPrice?: 'hollow' | 'hidden';
}

/**
 * Give a series its own price scale overlaid on the pane (e.g. volume at the
 * bottom of the main pane). Fractions of pane height kept empty top/bottom.
 */
export interface OverlayMargins {
  top: number;
  bottom: number;
}

/** The options rule for each series kind; indicator series take options from their indicator. */
const OPTION_RULES: Partial<Record<SeriesKind, OptionRuleName>> = {
  candles: 'candles',
  histogram: 'histogram',
  line: 'line',
  heatmap: 'heatmap',
  volumeProfile: 'volumeProfile',
  custom: 'custom',
  points: 'points',
};

let nextId = 1;

/**
 * Base class of every series: its pane, options, visibility, draw order and
 * price scale. Create series through chart methods such as `addCandles` and
 * `addLine`, not directly.
 */
export abstract class Series<O extends object = object> {
  readonly id = `s${nextId++}`;
  abstract readonly kind: SeriesKind;
  visible = true;
  options: O;
  #z = 0;
  /** Own price scale when the series is an overlay; otherwise the pane scale is used. */
  overlayScale: PriceScale | null = null;
  /** Reused by `priceRange` so autoscale makes no RangeBuilder per frame. */
  protected readonly rangeBuilder = new RangeBuilder();
  /** How the latest history page changed the front of the data, for `prependAligned`. */
  protected front: FrontChange = NO_FRONT_CHANGE;
  /** The `autoscale` function threw and was reported; cleared once it returns again. */
  #autoscaleFailed = false;
  /** The last-point pulse's clock from the `lastPointPulse()` plugin, made when first needed. */
  #pulse: PulseClock | null = null;

  constructor(
    protected readonly host: SeriesHost,
    /** The pane the series draws in; change it with `chart.moveSeries`. */
    public pane: Pane,
    options: O,
  ) {
    this.options = options;
    this.#syncOverlay();
    void this.priceFormat; // throws now on an invalid format, not inside a frame
  }

  /**
   * Draw order within the pane among series drawn by the same renderer: a
   * higher value draws on top. GPU series (candles, histograms, heatmaps,
   * lines and areas) always draw below 2D series (curved lines, custom
   * series, anything with `renderer: 'canvas'`). Equal values keep the usual
   * order (heatmaps, then overlays and volume profiles, then the rest, each
   * in the order added). Changing it only redraws. Default 0.
   */
  get zIndex(): number {
    return this.#z;
  }

  set zIndex(value: number) {
    if (!Number.isFinite(value)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Series zIndex must be a finite number' : '');
    if (value === this.#z) return;
    this.#z = value;
    this.host.requestRender();
  }

  applyOptions(partial: Partial<O>): void {
    if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      const rule = OPTION_RULES[this.kind];
      if (rule) devCheck('series.applyOptions', partial, rule);
    }
    const spec = (partial as { priceFormat?: PriceFormat }).priceFormat;
    if (spec) createPriceFormat(spec); // validate before changing anything
    const prev = this.options;
    this.options = { ...this.options, ...partial };
    const follow = (o: object) => (o as { follow?: unknown }).follow;
    if (follow(this.options) !== follow(prev)) {
      try {
        this.refollow();
      } catch (error) {
        // A bad mapper changes nothing: back to the old one and its points.
        this.options = prev;
        this.refollow();
        this.rebuild();
        throw error;
      }
    }
    this.#syncOverlay();
    this.rebuild();
    this.host.requestRender();
    if (Object.keys(partial).length > 0) this.host.seriesOptionsChanged?.(this, { ...partial });
  }

  #formatCache: { spec: PriceFormat; locale: Localizer; model: PriceFormatModel } | null = null;

  /** @internal The last-point pulse's clock; null on a chart without the `lastPointPulse()` plugin. */
  protected get pulse(): PulseClock | null {
    const make = this.host.pulse;
    return make ? (this.#pulse ??= make(() => this.host.animationsOff === true)) : (this.#pulse = null);
  }

  /** @internal The clock to draw pulse `option` with; null without the plugin, which development builds say once. */
  protected pulseFor(option: LastPointPulse | undefined): PulseClock | null {
    const clock = this.pulse;
    if (!clock && pulseOn(option) && /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
      devWarnOnce('lastPointPulse draws nothing without the lastPointPulse() plugin: add it (or builtins()) to the chart', 'pulse-missing');
    }
    return clock;
  }

  /** The chart's number language (the `localization` option). */
  protected get locale(): Localizer {
    return this.host.localization ?? englishLocalizer;
  }

  /** The `priceFormat` option resolved in the chart's number language, or null when the series has none. */
  get priceFormat(): PriceFormatModel | null {
    const spec = (this.options as { priceFormat?: PriceFormat }).priceFormat;
    if (!spec) return null;
    const locale = this.locale;
    if (this.#formatCache?.spec !== spec || this.#formatCache.locale !== locale) {
      const model = createPriceFormat(spec);
      // Volumes in the locale's compact words, like every other compact amount.
      const localized =
        spec.type === 'volume'
          ? { ...model, format: locale.compact, parse: locale.parseCompact }
          : locale.priceFormat(model, spec.type === 'custom');
      this.#formatCache = { spec, locale, model: localized };
    }
    return this.#formatCache.model;
  }

  /**
   * Label text for a value: `priceFormat` when set, else a `format` option you
   * passed, else the pane scale's format (see `scaleFormat`) for a series on
   * that scale, else compact.
   */
  formatValue(value: number): string {
    const model = this.priceFormat;
    if (model) return model.format(value);
    const format = (this.options as { format?: (value: number) => string }).format;
    if (format && format !== defaultFormat) return format(value);
    const pane = this.overlayScale ? null : scaleFormat(this.pane.series, this.scale);
    return pane ? pane.format(value) : this.locale.compact(value);
  }

  /** The price scale this series is drawn against. */
  get scale(): PriceScale {
    return this.overlayScale ?? this.pane.scale((this.options as { priceScale?: string }).priceScale ?? 'right');
  }

  /** Advance per-series animations by dt ms; true while still animating. */
  step(_dt: number): boolean {
    return false;
  }

  /**
   * Advance animations drawn only on the overlay (such as the last-point
   * pulse) by dt ms, after the frame drew; true when the overlay needs
   * another frame.
   */
  stepOverlay(_dt: number): boolean {
    return false;
  }

  #syncOverlay(): void {
    const margins = (this.options as { overlay?: OverlayMargins }).overlay;
    if (!margins) {
      this.overlayScale = null;
      return;
    }
    const scale = this.overlayScale ?? new PriceScale({ marginTop: margins.top, marginBottom: margins.bottom });
    scale.marginTop = margins.top;
    scale.marginBottom = margins.bottom;
    this.overlayScale = scale;
  }

  /**
   * Release timers, subscriptions and other resources. The chart calls it once
   * when the series leaves it: `removeSeries`, removing its pane, or `destroy`.
   */
  dispose(): void {}

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.host.requestRender();
    this.host.seriesVisibilityChanged?.(this);
  }

  /**
   * Re-derive the data from the main bars when the series has a `follow`
   * option. On `'prepend'`, `added` is the number of bars that now lead `bars`.
   */
  followMain(_bars: readonly Bar[], _kind: FollowKind, _added?: number): void {}

  /** The `follow` option changed: map the main bars again, or drop the derived points when it was removed. */
  protected refollow(): void {}

  /** Recompute timeline indices after main data changes. */
  realign(): void {
    this.rebuild();
  }

  /**
   * The main series gained a bar at the end of the timeline. Series with an
   * incremental path align only their new items; others realign fully.
   */
  appendAligned(): void {
    this.realign();
  }

  /**
   * The main series gained `bars` older bars at the front of the timeline (a
   * history page), so every timeline index grew by `bars`. Series with an
   * incremental path shift their alignment and align and write only the new
   * items; others realign fully.
   */
  prependAligned(_bars: number): void {
    this.realign();
  }

  /** Rebuild GPU/CPU caches from data, options and theme. */
  abstract rebuild(): void;

  /**
   * First value at or after logical `index`: the base of percent and indexed
   * scales. `field` asks for the bar's open; series without one give their value.
   */
  firstValueFrom(_index: number, _field?: 'open' | 'close'): number | undefined {
    return undefined;
  }

  /**
   * Min/max over visible logical indices for autoscale, or null. With
   * `positiveOnly` (the default on a log scale) values at or below zero are left out.
   */
  priceRange(_from: number, _to: number, _positiveOnly?: boolean): [number, number] | null {
    return null;
  }

  /** False while the `autoscale` option leaves this series out of the fit. */
  get inAutoscale(): boolean {
    return (this.options as { autoscale?: unknown }).autoscale !== false;
  }

  /**
   * The range this series adds to its scale's autoscale: `priceRange` passed
   * through the `autoscale` option. A throwing function is reported once and
   * the series fits its values meanwhile; a non-finite result adds nothing.
   */
  fitRange(from: number, to: number): [number, number] | null {
    const autoscale = (this.options as { autoscale?: boolean | AutoscaleProvider }).autoscale;
    if (autoscale === false) return null;
    const range = this.priceRange(from, to);
    if (typeof autoscale !== 'function') return range;
    let out: AutoscaleRange | null;
    try {
      out = autoscale(range && { low: range[0], high: range[1] }, { series: this, from, to, mode: this.scale.mode });
      this.#autoscaleFailed = false;
    } catch (error) {
      if (!this.#autoscaleFailed) {
        this.#autoscaleFailed = true;
        const event: SeriesErrorEvent = { series: this, hook: 'autoscale', error };
        if (this.host.seriesError) this.host.seriesError(event);
        else console.error(`Series ${this.id} autoscale function threw`, error);
      }
      return range;
    }
    if (!out || !Number.isFinite(out.low) || !Number.isFinite(out.high)) return null;
    return [Math.min(out.low, out.high), Math.max(out.low, out.high)];
  }

  /** @internal Record this series' GPU draws for the pane. */
  drawGL(_r: RenderBackend, _env: PaneEnv): void {}

  /** @internal Paint this series' canvas part for the pane. */
  draw2D(_ctx: CanvasRenderingContext2D, _env: PaneEnv): void {}

  /** @internal Paint behind every series and the GPU layer, clipped to the pane, e.g. background shading. */
  drawBelow(_ctx: CanvasRenderingContext2D, _env: PaneEnv): void {}

  /**
   * Whether `drawCrosshair2D` draws anything.
   * @internal
   */
  get hasCrosshairMarker(): boolean {
    return false;
  }

  /**
   * A marker at the crosshair (`env.crosshair`), on the crosshair layer: it
   * redraws on every crosshair move, `draw2D` does not.
   * @internal
   */
  drawCrosshair2D(_ctx: CanvasRenderingContext2D, _env: PaneEnv): void {}

  /**
   * Drawn on the GPU canvas, which sits below every series drawn in 2D.
   * @internal
   */
  get drawsOnGpu(): boolean {
    return false;
  }

  /** Legend row at logical `index`; `view` is the chart's legend mode (candles also read `showChange`). */
  legend(_index: number, _view?: LegendView): LegendEntry | null {
    return null;
  }

  /** The newest value's price-axis label while `lastValueLabel` is on. */
  lastValue(): LastValue | null {
    return (this.options as { lastValueLabel?: boolean }).lastValueLabel ? this.labelValueAt(this.lastIndexAtOrBefore(Infinity)) : null;
  }

  /** Price-axis labels for the newest values; series with several outputs return several. */
  lastValues(): LastValue[] {
    const last = this.lastValue();
    if (!last) return [];
    const o = this.options as { axisTitle?: boolean; title?: string };
    if (o.axisTitle) last.title = o.title ?? '';
    return [last];
  }

  /** The label value of data item `i`, ignoring `lastValueLabel`; for the price line. */
  protected labelValueAt(_i: number): LastValue | null {
    return null;
  }

  /**
   * Data index of the newest item at or before logical `index` on the time
   * axis (`Infinity`: the newest item), or -1.
   * @internal
   */
  lastIndexAtOrBefore(_index: number): number {
    return -1;
  }

  /** Whether the price line is on when the option is unset. */
  protected get priceLineByDefault(): boolean {
    return false;
  }

  /** Where this series' price line sits, given the newest visible logical index; null when it is off. */
  priceLine(visibleTo: number): SeriesPriceLine | null {
    if (!this.visible) return null;
    return resolvePriceLine((this.options as PriceLineSeriesOptions).priceLine ?? this.priceLineByDefault, visibleTo, (limit) => {
      const i = this.lastIndexAtOrBefore(limit);
      return i >= 0 ? this.labelValueAt(i) : null;
    });
  }

  /** @internal The price lines drawn this frame: the series' own, or one per plot for an indicator. */
  priceLines(visibleTo: number): SeriesPriceLine[] {
    const line = this.priceLine(visibleTo);
    return line ? [line] : [];
  }
}

/**
 * @internal A price line from its option, given the newest visible logical
 * index; `valueAt(limit)` gives the newest value at or before logical index
 * `limit` (`Infinity`: the newest) with its colour. Null when off or no value.
 */
export function resolvePriceLine(
  raw: boolean | SeriesPriceLineOptions | undefined,
  visibleTo: number,
  valueAt: (limit: number) => { value: number; color: string } | null,
): SeriesPriceLine | null {
  if (!raw) return null;
  const o = raw === true ? {} : raw;
  const source = o.source ?? 'last';
  const v = valueAt(source === 'lastVisible' ? Math.floor(visibleTo) : Infinity);
  if (!v || !Number.isFinite(v.value)) return null;
  return { value: v.value, color: o.color ?? v.color, lineWidth: o.lineWidth ?? 1, lineStyle: o.lineStyle ?? 'dotted', source };
}

/**
 * Data points mapped onto timeline indices (points off the timeline are
 * skipped). Points after the last bar take the projected bar at their time,
 * if there is one (`Timeline.slotOf`).
 */
export class Alignment {
  index = new Int32Array(0);
  source = new Int32Array(0);
  count = 0;
  /** Bars on the timeline when the points were last aligned; points at or past it sit on projected bars. */
  #bars = 0;

  build(times: ArrayLike<Time>, timeline: Timeline, identity = false): void {
    this.#bars = timeline.length;
    const n = times.length;
    if (this.index.length < n) {
      this.index = new Int32Array(Math.ceil(n * 1.25) + 16);
      this.source = new Int32Array(this.index.length);
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
      const idx = identity ? i : timeline.slotOf(times[i]!);
      if (idx < 0) continue;
      this.index[k] = idx;
      this.source[k] = i;
      k++;
    }
    this.count = k;
  }

  /**
   * Align the items after the last aligned one (newer items, or ones whose
   * bar has just appeared on the timeline). Earlier positions are untouched.
   * Returns the first new aligned position.
   */
  extend(length: number, timeAt: (i: number) => Time, timeline: Timeline, identity = false): number {
    if (timeline.length !== this.#bars) {
      // Points on projected bars may sit elsewhere now that real bars arrived: place them again.
      while (this.count > 0 && this.index[this.count - 1]! >= this.#bars) this.count--;
      this.#bars = timeline.length;
    }
    const start = this.count;
    const from = start > 0 ? this.source[start - 1]! + 1 : 0;
    for (let i = from; i < length; i++) {
      const idx = identity ? i : timeline.slotOf(timeAt(i));
      if (idx < 0) continue;
      if (this.count >= this.index.length) {
        const index = new Int32Array(Math.ceil(this.count * 1.5) + 16);
        const source = new Int32Array(index.length);
        index.set(this.index);
        source.set(this.source);
        this.index = index;
        this.source = source;
      }
      this.index[this.count] = idx;
      this.source[this.count] = i;
      this.count++;
    }
    return start;
  }

  /**
   * The timeline gained `bars` bars at the front, and the first `removed`
   * data items were replaced by `inserted` new ones (`front`; `length` items now).
   * Positions of the removed items are dropped and those of the other items
   * shift; then the items in front of them that sit on a bar are aligned.
   * Returns how many positions were dropped from the front and how many
   * were added there, so `[0, added)` are the new positions. O(new items),
   * plus one pass moving the existing positions.
   */
  spliceFront(
    bars: number,
    { removed, inserted }: FrontChange,
    length: number,
    timeAt: (i: number) => Time,
    timeline: Timeline,
    identity = false,
  ): { dropped: number; added: number } {
    let dropped = 0;
    while (dropped < this.count && this.source[dropped]! < removed) dropped++;
    const kept = this.count - dropped;
    const delta = inserted - removed;
    const upTo = kept > 0 ? this.source[dropped]! + delta : length;
    // Items before the first kept one are few (a page), so their indices fit a small scratch array.
    const fresh: number[] = [];
    for (let i = 0; i < upTo; i++) {
      // `slotOf`, like `build`: with no kept item this reaches items on projected bars too.
      const idx = identity ? i : timeline.slotOf(timeAt(i));
      if (idx >= 0) fresh.push(idx, i);
    }
    const added = fresh.length / 2;
    const count = added + kept;
    if (count > this.index.length) {
      const index = new Int32Array(Math.ceil(count * 1.25) + 16);
      const source = new Int32Array(index.length);
      index.set(this.index.subarray(dropped, this.count), added);
      source.set(this.source.subarray(dropped, this.count), added);
      this.index = index;
      this.source = source;
    } else if (added !== dropped) {
      this.index.copyWithin(added, dropped, this.count);
      this.source.copyWithin(added, dropped, this.count);
    }
    if (bars !== 0 || delta !== 0) {
      for (let k = added; k < count; k++) {
        this.index[k] = this.index[k]! + bars;
        this.source[k] = this.source[k]! + delta;
      }
    }
    for (let k = 0; k < added; k++) {
      this.index[k] = fresh[2 * k]!;
      this.source[k] = fresh[2 * k + 1]!;
    }
    this.count = count;
    // Projected bars start `bars` later too; otherwise the next `extend` would realign real bars as projected.
    this.#bars += bars;
    return { dropped, added };
  }

  /** Forget the last aligned point when it is data index `source` (that point was removed). */
  dropSource(source: number): void {
    if (this.count > 0 && this.source[this.count - 1] === source) this.count--;
  }

  /** Aligned positions [a, b) whose index lies in [from, to]. */
  range(from: number, to: number): [number, number] {
    return [this.#lowerBound(from), this.#lowerBound(to + 1)];
  }

  /** Data index of the newest aligned item at or before `index` (`Infinity`: the newest), or -1. */
  sourceAtOrBefore(index: number): number {
    const k = (index === Infinity ? this.count : this.#lowerBound(index + 1)) - 1;
    return k >= 0 ? this.source[k]! : -1;
  }

  /** Data index of the newest item at or before `index` among `length` items (`Infinity`: the newest item, aligned or not), or -1. */
  newestAtOrBefore(index: number, length: number): number {
    return index === Infinity ? length - 1 : this.sourceAtOrBefore(index);
  }

  /** Data index of the first aligned item at or after `index`, or -1. */
  sourceFrom(index: number): number {
    const k = this.#lowerBound(index);
    return k < this.count ? this.source[k]! : -1;
  }

  /** Data index at exactly `index`, or -1. */
  sourceAt(index: number): number {
    const k = this.positionAt(index);
    return k < 0 ? -1 : this.source[k]!;
  }

  /** Aligned position at exactly `index`, or -1. */
  positionAt(index: number): number {
    const k = this.#lowerBound(index);
    return k < this.count && this.index[k] === index ? k : -1;
  }

  #lowerBound(value: number): number {
    return bisect(this.count, (i) => this.index[i]! < value);
  }
}

function assertAscending(times: ArrayLike<Time>, what: string): void {
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${what} time at index ${i} is not a finite number` : '');
    if (i > 0 && !(times[i]! > times[i - 1]!)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${what} times must be strictly ascending (index ${i}); pass { normalize: true } to sort and dedupe` : '');
    }
  }
  warnTimes(times, what);
}

/** A time must be a finite number; checked on every update. */
/** A `Pyramid` source over the items aligned by `align`; `value(k, field)` reads aligned item `k`. */
function alignedSource<F extends string>(align: Alignment, value: (k: number, field: F) => number): PyramidSource<F> {
  return { count: () => align.count, index: (k) => align.index[k]!, itemAt: (index) => align.positionAt(index), value };
}

function assertTime(time: Time, what: string): void {
  if (!Number.isFinite(time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${what} time is not a finite number` : '');
}

/** Times must be finite before sorting; `normalize` never drops a bad time. */
function assertFiniteTimes(items: ArrayLike<{ time: Time }>, what: string): void {
  for (let i = 0; i < items.length; i++) {
    if (!Number.isFinite(items[i]!.time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${what} time at index ${i} is not a finite number` : '');
  }
}

/** Throw for an invalid bar (see `barProblem`); `at()` names it, called only when throwing. */
function assertBar(bar: Bar, at: () => string): void {
  const problem = barProblem(bar);
  if (problem === null) return;
  throw new Error(
    /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? problem === 'range'
      ? `Candle ${at()} has high below low (${bar.high} < ${bar.low})`
      : `Candle ${at()} has a non-finite ${problem}: ${String(bar[problem])}` : '',
  );
}

/** A point with no finite value is a gap: no point is drawn there. */
const hasValue = (p: ValuePoint) => Number.isFinite(p.value);

/**
 * Line and histogram data: times validated (or sorted and deduped with
 * `normalize`), then points without a finite value left out as gaps.
 */
function preparePoints(
  points: ValuePoint[],
  options: SetDataOptions,
  what: string,
  onDrop: (point: ValuePoint, reason: DropReason) => void,
): ValuePoint[] {
  if (options.normalize) {
    assertFiniteTimes(points, what);
    points = dedupeByTime(points, (p) => onDrop(p, 'duplicate'));
  }
  assertAscending(points.map((p) => p.time), what);
  return points.filter(hasValue);
}

/** How the main bars changed: all of them, one appended, or the newest replaced. */
export type FollowKind = 'reset' | 'append' | 'tick' | 'prepend';

/** How a history page changed the front of a series' data: its first `removed` items became `inserted` new ones. */
interface FrontChange {
  removed: number;
  inserted: number;
}

const NO_FRONT_CHANGE: FrontChange = { removed: 0, inserted: 0 };

/** Maps a main-series bar (and the one before it) to a point of a following series; null leaves none. */
export type FollowMapper<P> = (bar: Bar, prev: Bar | undefined, theme: ChartTheme) => P | null;

/**
 * Bring followed `data` in step with the main `bars`. 'reset' maps every bar
 * and 'append' maps the new one; the chart realigns every series right after
 * both. 'prepend' maps the `added` bars that now lead `bars`, plus the bar
 * after them, which has a previous bar now; it returns how the front of
 * `data` changed, for the series' `prependAligned`. 'tick' maps only the
 * newest bar and hands it to `replace`, which updates it in place, or calls
 * `removeLast` when the forming point is gone; neither touches the rest of
 * the data.
 *
 * A point must sit at its bar's time. A bad one throws before `data` changes
 * on 'append', 'prepend' and 'tick'; on 'reset' the data is left empty.
 */
function followBars<P extends { time: Time }>(
  what: string,
  data: P[],
  map: FollowMapper<P>,
  bars: readonly Bar[],
  kind: FollowKind,
  theme: ChartTheme,
  valid: (p: P) => boolean,
  replace: (p: P) => void,
  removeLast: () => void,
  added = 0,
): FrontChange | null {
  const mapAt = (i: number): P | null => {
    const bar = bars[i]!;
    const p = map(bar, bars[i - 1], theme);
    if (p === null) return null;
    if (p.time !== bar.time) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${what} follow: point time ${p.time} differs from bar time ${bar.time} (bar ${i})` : '');
    }
    return valid(p) ? p : null;
  };
  if (kind === 'reset') {
    data.length = 0;
    const next: P[] = [];
    for (let i = 0; i < bars.length; i++) {
      const p = mapAt(i);
      if (p) next.push(p);
    }
    assertAscending(next.map((p) => p.time), `${what} follow`);
    for (const p of next) data.push(p);
    return null;
  }
  if (kind === 'prepend') {
    const front: P[] = [];
    const last = Math.min(added, bars.length - 1);
    for (let i = 0; i <= last; i++) {
      const p = mapAt(i);
      if (p) front.push(p);
    }
    assertAscending(front.map((p) => p.time), `${what} follow`);
    // The first old point belongs to bar `added`, whose previous bar is new: map it again.
    const removed = added < bars.length && data[0]?.time === bars[added]!.time ? 1 : 0;
    replaceFront(data, removed, front);
    return { removed, inserted: front.length };
  }
  const i = bars.length - 1;
  if (i < 0) return null;
  const p = mapAt(i);
  if (kind === 'append') {
    if (p) data.push(p);
  } else if (p) {
    replace(p);
  } else if (data[data.length - 1]?.time === bars[i]!.time) {
    removeLast();
  }
  return null;
}

const finiteValue = (p: ValuePoint) => Number.isFinite(p.value);

/** Volume histogram point for `follow`: the bar's volume, colored by whether it closed up or down. */
export function volumeOf(bar: Bar, prev: Bar | undefined, theme: ChartTheme): ValuePoint {
  const rising = bar.close >= (prev?.close ?? bar.open);
  return { time: bar.time, value: bar.volume ?? 0, color: withAlpha(rising ? theme.up : theme.down, 0.5) };
}

/** Vertical uniforms for rects whose prices are stored relative to `base`. */
export function yUniforms(scale: PriceScale, base: number): { y: [number, number]; log: [number, number] } {
  const [ys, yo] = scale.yTransform();
  return scale.isLog ? { y: [ys, yo], log: [1, base] } : { y: [ys, yo + base * ys], log: [0, 0] };
}

/** @internal Uniforms to draw `batch` of `series` in `env` with the given body and column ratios. */
export function rectUniforms(series: Series, env: PaneEnv, batch: RectBatch, bodyRatio: number, columnRatio: number): RectUniforms {
  return { x: env.time.xTransform(), ...yUniforms(series.scale, batch.base), bodyRatio, columnRatio };
}

/* ------------------------------------------------------------------ */
/* Candles                                                             */
/* ------------------------------------------------------------------ */

/** How a candle series draws its bars: candles, bars, lines, areas, Heikin-Ashi and other styles. */
export type CandleStyle =
  | 'candles'
  | 'hollow'
  | 'volumeCandles'
  | 'bars'
  | 'hlcBars'
  | 'heikinAshi'
  | 'highLow'
  | 'columns'
  | 'line'
  | 'lineMarkers'
  | 'step'
  | 'area'
  | 'rangeBand'
  | 'baseline'
  | 'kagi'
  | 'pointFigure';

/** Rect instances written per bar for each GL-rendered style (0 = drawn in 2D). */
const RECTS_PER_BAR: Partial<Record<CandleStyle, number>> = {
  candles: 3,
  heikinAshi: 3,
  volumeCandles: 3,
  hollow: 4,
  bars: 3,
  hlcBars: 2,
  highLow: 1,
};

/** Narrowest volume candle body, as a fraction of a normal body. */
export const VOLUME_MIN_WIDTH = 0.25;

/** Bar stroke thickness as a fraction of bar spacing when `thinBars` is off. */
const BAR_STROKE_RATIO = 0.125;

/** Fully transparent: the rect is laid out but paints nothing. */
const CLEAR: Rgba = [0, 0, 0, 0];

/** Per-bar colours already checked, valid or not; starts over past `BAR_COLOR_LIMIT` entries. */
const barColors = new Map<string, Rgba | null>();
const BAR_COLOR_LIMIT = 1024;

/** The colours a bar may carry over its style's. */
type BarColors = Pick<Bar, 'color' | 'wickColor' | 'borderColor'>;

/** @internal A per-bar colour as RGBA, or null when it is unset or invalid (the series colour applies then). */
export function barRgba(color: string | undefined): Rgba | null {
  if (typeof color !== 'string') return null;
  let rgba = barColors.get(color);
  if (rgba === undefined) {
    // `parseColor` alone reads an invalid colour as black in browsers; `isColor` asks CSS first.
    rgba = isColor(color) ? parseColor(color) : null;
    if (barColors.size >= BAR_COLOR_LIMIT) barColors.clear();
    barColors.set(color, rgba);
  }
  return rgba;
}

/** Where the `baseline` style splits its above and below fills. */
export type BaseLevel =
  /** A fixed price. */
  | { kind: 'price'; price: number }
  /**
   * The close of the first visible bar, so the base follows scrolling. When
   * this series is its percent scale's base, that is the scale's 0% line.
   */
  | { kind: 'firstVisible' }
  /** A height in the pane, in percent from the bottom: 50 is the middle. */
  | { kind: 'height'; percent: number };

/** The middle of the pane. */
export const DEFAULT_BASE_LEVEL: BaseLevel = { kind: 'height', percent: 50 };

/** A fixed base `price` `scale` can show: finite, and above zero on a log scale. */
function usablePrice(price: number, scale: PriceScale): boolean {
  return Number.isFinite(price) && !(scale.isLog && price <= 0);
}

/**
 * The price `level` stands for on `scale` in a pane `height` css px tall.
 * `firstVisible` is the close of the first visible bar. Invalid levels, a
 * price a log scale cannot show (zero or below), and `firstVisible` with no
 * bar in view fall back to the middle of the pane.
 */
export function resolveBaseLevel(
  level: BaseLevel,
  scale: PriceScale,
  height: number,
  firstVisible: number | undefined,
): number {
  const middle = () => scale.yToPrice(height / 2);
  switch (level.kind) {
    case 'price':
      return usablePrice(level.price, scale) ? level.price : middle();
    case 'firstVisible':
      return firstVisible !== undefined && Number.isFinite(firstVisible) ? firstVisible : middle();
    case 'height':
      return Number.isFinite(level.percent) ? scale.yToPrice(height * (1 - level.percent / 100)) : middle();
    default:
      return middle();
  }
}

/**
 * Options for a candle series (`chart.addCandles`): its style, the up and down
 * colours of bodies, wicks and borders, labels and price scale placement.
 */
export interface CandleSeriesOptions extends PriceLineSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  style: CandleStyle;
  upColor?: string;
  downColor?: string;
  /** Wick colours of the candle styles; default to the theme's `upWick` / `downWick`, then the body colours. */
  upWickColor?: string;
  downWickColor?: string;
  /** Body outline colours of the candle styles; default to the theme's `upBorder` / `downBorder`, else no separate outline. */
  upBorderColor?: string;
  downBorderColor?: string;
  /** Draw wicks (candle styles). Default true. */
  wicks?: boolean;
  /** Draw the body outlines set by the border colours. Default true; hollow candles keep their outline. */
  borders?: boolean;
  /** Colour bars by change from the previous close instead of from the open. */
  colorByPreviousClose?: boolean;
  /**
   * Draw falling bodies as outlines in the `candles`, `heikinAshi` and
   * `volumeCandles` styles, so rising and falling bars differ in shape, not
   * only in colour. Default false.
   */
  hollowDown?: boolean;
  /** Fixed price decimals; auto-detected from data when omitted. Ignored when `priceFormat` is set. */
  precision?: number;
  /** How prices are shown, parsed and snapped (decimals, tick size, fractions...). */
  priceFormat?: PriceFormat;
  bodyRatio: number;
  /** One-pixel strokes for `bars` / `hlcBars` at any zoom (default); false thickens them as bars widen. */
  thinBars?: boolean;
  lineWidth: number;
  /**
   * Dash of the line-drawn styles (`line`, `lineMarkers`, `step`, `area`,
   * `baseline` and the close line of `rangeBand`). Default `'solid'`.
   */
  lineStyle?: LineStyle;
  /**
   * Where the line-drawn styles (`line`, `lineMarkers`, `step`, `area`,
   * `baseline` and `rangeBand`) are drawn (default `'gpu'`). `'gpu'` draws
   * their lines and fills with WebGL2, like the candle styles, so long
   * histories and frequent redraws cost the CPU far less; they then draw
   * below every series drawn on the canvas. `'canvas'` strokes them with the
   * 2D canvas, so `zIndex` orders them among other canvas series. The dots
   * of `lineMarkers` and the base level of `baseline` stay on the canvas.
   */
  renderer?: 'canvas' | 'gpu';
  lastValueLabel: boolean;
  /** Show the series title (e.g. the symbol) in a tag beside the last-value label. */
  axisTitle?: boolean;
  /** Tween live updates of the forming bar instead of jumping. Ignored on static charts and while the chart's `lowPower` is on. */
  animate: boolean;
  overlay?: OverlayMargins;
  /**
   * Price scale id in the pane (default `'right'`). `'left'` shows a left axis;
   * other ids are overlays until given a side. Ignored with `overlay`.
   */
  priceScale?: string;
  /** Where the `baseline` style splits its fills (default: the middle of the pane). */
  baseLevel?: BaseLevel;
  /**
   * `pointFigure` style: the price height of one box, overriding the box size
   * the bars carry (`PriceBar.boxSize`, set by `PriceBarBuilder`). Bars made
   * elsewhere carry none; without this option the series then reads it from
   * them, as the step from one column's last box to the next column's first.
   */
  boxSize?: number;
  /**
   * A pulse on the last point of the `line`, `area`, `step` and `baseline`
   * styles (default `'off'`): `'on-update'` rings once per live update,
   * `'continuous'` keeps ringing. See `LastPointPulseOptions`. Needs the
   * `lastPointPulse()` plugin; without it the option draws nothing.
   */
  lastPointPulse?: LastPointPulse;
}

/** Candle styles that draw the last-point pulse. */
const PULSE_STYLES: ReadonlySet<CandleStyle> = new Set<CandleStyle>(['line', 'area', 'step', 'baseline']);

/** Live-bar tween time constant (ms). */
const BAR_EASE_MS = 90;

/** The instances of the grouped level a series last drew, and what changed since. */
export class GroupBatch {
  readonly batch = new RectBatch();
  /** Key of the bucketing the batch holds; null when it holds nothing yet. */
  #key: string | null = null;
  /** Lowest timeline index whose items changed since the batch was written. */
  #dirty = Infinity;

  /** Items at timeline index `index` and later changed. */
  changed(index: number): void {
    this.#dirty = Math.min(this.#dirty, index);
  }

  /** Everything changed: rewrite the batch on its next use. */
  reset(): void {
    this.#key = null;
  }

  /** Start writing the buckets of `g` with prices relative to `base`; returns the first bucket to rewrite. */
  begin(g: Buckets, base: number): number {
    const dirty = this.#dirty;
    this.#dirty = Infinity;
    if (this.#key === g.key) return dirty === Infinity ? Infinity : Math.max(0, g.of(dirty));
    this.#key = g.key;
    this.batch.base = base;
    this.batch.markAllDirty();
    return 0;
  }
}

/**
 * One bar in `color` from instance `o` of `batch`: a low-high wick with open
 * and close ticks (3 instances) when `ticks`, else with a body (2 instances).
 */
export function setOhlcRects(batch: RectBatch, o: number, index: number, bar: Pick<Bar, 'open' | 'high' | 'low' | 'close'>, ticks: boolean, color: Rgba): void {
  batch.set(o, index, bar.low, bar.high, RectKind.Wick, color);
  if (!ticks) return batch.set(o + 1, index, bar.open, bar.close, RectKind.Body, color);
  batch.set(o + 1, index, bar.open, bar.open, RectKind.TickLeft, color);
  batch.set(o + 2, index, bar.close, bar.close, RectKind.TickRight, color);
}

/** What a bucket of bars keeps: OHLC, the range of closes (close-only styles) and the summed volume. */
type OhlcField = 'open' | 'high' | 'low' | 'close' | 'cmin' | 'cmax' | 'volume';

const OHLC_MERGES = { open: 'first', high: 'max', low: 'min', close: 'last', cmin: 'min', cmax: 'max', volume: 'sum' } as const;

/** What a bucket of points keeps: the sum and largest value, and its last item (its colour and `'last'` value). */
type ValueField = 'sum' | 'max' | 'item';

const VALUE_MERGES = { sum: 'sum', max: 'max', item: 'last' } as const;

/**
 * Timeline indices from `from` to `to` widened to whole buckets of `g`, for
 * autoscale: buckets at the edges are drawn whole.
 */
export function wholeBuckets(g: Buckets, from: number, to: number): [number, number] {
  return [g.start(Math.max(0, g.of(Math.floor(from)))), g.end(g.of(Math.floor(to))) - 1];
}

/** Bars bucket `j` of `g` spans (at least 1). */
export const bucketWidth = (g: Buckets, j: number): number => Math.max(1, g.end(j) - g.start(j));

/** The narrowest bucket of `g` from `ja` to `jb`, in bars: grouped bodies and columns are drawn this wide so they never overlap. */
export function narrowestBucket(g: Buckets, ja: number, jb: number): number {
  if (g.level > 0) return 2 ** g.level;
  let w = Infinity;
  // The first and last bucket may be cut off by the data's ends; skip them unless nothing else is in view.
  for (let j = ja + 1; j < jb; j++) w = Math.min(w, bucketWidth(g, j));
  if (w === Infinity) for (let j = ja; j <= jb; j++) w = Math.min(w, bucketWidth(g, j));
  return w === Infinity ? 1 : w;
}

/** Non-empty buckets of `g` on screen plus one either side, written into `out`. */
export function visibleBuckets(p: Pyramid<string>, env: PaneEnv, g: Buckets, out: number[]): number[] {
  const size = p.size(g);
  const [ja, jb] = bucketRange(env.from, env.to, g, size);
  out.length = 0;
  for (let j = Math.max(0, ja - 1); j <= Math.min(size - 1, jb + 1); j++) if (p.count(g, j) > 0) out.push(j);
  return out;
}

/**
 * Styles for price-based bars (see `priceBars`), each drawn on the GPU by the
 * `priceStyles()` plugin: `kagi` as a line, `pointFigure` as columns of X and O boxes.
 */
const PRICE_STYLES: ReadonlySet<CandleStyle> = new Set<CandleStyle>(['kagi', 'pointFigure']);

/** @internal Draws a candle series in the `kagi` or `pointFigure` style; the `priceStyles()` plugin makes it. */
export interface PriceStyleDrawer {
  /** Draw `style`, rebuilding from aligned bar `from` on (Infinity: none changed), and free what the other style holds. */
  draw(r: RenderBackend, env: PaneEnv, style: CandleStyle, from: number, align: Alignment, display: readonly Bar[]): void;
  /** Half the point & figure box: how far its boxes reach past the bars' prices. */
  pad(): number;
  /** Free the GPU objects of every style but `style` (null: all). */
  keep(style: CandleStyle | null): void;
}


/** The line-drawn candle styles, which `renderer: 'gpu'` draws on the GPU. */
const GPU_LINE_STYLES: ReadonlySet<CandleStyle> = new Set<CandleStyle>(['line', 'lineMarkers', 'step', 'area', 'baseline', 'rangeBand']);

/** @internal A line through every vertex, with no steps and no breaks at gaps. */
export const SIMPLE_LINE: LineBuildShape = { step: false, breakGaps: false };
const STEP_LINE: LineBuildShape = { step: true, breakGaps: false };

/**
 * GPU vertices of a line-drawn candle style: the close line, and for
 * `rangeBand` the bands from the high and from the low to the close, whose own
 * lines are the band's edges.
 */
class StyleLines {
  readonly close = new LineBatch();
  readonly high = new LineBatch();
  readonly low = new LineBatch();

  get all(): LineBatch[] {
    return [this.close, this.high, this.low];
  }
}

/** An OHLC series drawn in one of the `CandleStyle` styles; the chart's main series is one. Create it with `chart.addCandles`. */
export class CandleSeries extends Series<CandleSeriesOptions> {
  readonly kind = 'candles';
  data: Bar[] = [];
  /** True when this series defines the chart timeline. */
  isMain = false;
  readonly batch = new RectBatch();
  /** Instances of the grouped buckets last drawn (see `SeriesHost.buckets`). */
  readonly #group = new GroupBatch();
  private align = new Alignment();
  #times: Time[] = [];
  /** Bars as drawn: Heikin Ashi transform applied, last bar tweened. */
  private display: Bar[] = [];
  /** Coarser levels of `display`, made the first time the view groups bars. */
  #pyramid: Pyramid<OhlcField> | null = null;
  /** Reused by `visibleBuckets`. */
  readonly #bucketScratch: number[] = [];
  /** On-screen state of the last bar while it eases towards `data[last]`. */
  private shown: Bar | null = null;
  /** Resolved colours, [rising, falling]; a null border means no outline. */
  #bodyRgba: [Rgba, Rgba] = [CLEAR, CLEAR];
  private wickRgba: [Rgba, Rgba] = [CLEAR, CLEAR];
  private borderRgba: [Rgba | null, Rgba | null] = [null, null];
  #lineRgba: Rgba = [0, 0, 0, 0];
  /** Vertices of a line-drawn style with `renderer: 'gpu'`. */
  private readonly lines = new StyleLines();
  /** The same for the buckets on screen while the view groups bars, written each frame. */
  readonly #groupedLines = new StyleLines();
  /** First aligned position whose line vertices are out of date; Infinity when current. */
  #linesStale = 0;
  /** Draws the `kagi` and `pointFigure` styles once one of them is shown (`#priceStyles`). */
  private priceStyle: PriceStyleDrawer | null = null;
  /** Colours over the bars' own (indicators' bar colour plots) by owner, each by data index; undefined keeps the bar's. */
  readonly #recolors = new Map<object, (i: number) => string | undefined>();
  /** The colours of the bar being written, reused. */
  readonly #given: BarColors = {};
  /**
   * The price the `baseline` style split at in the last frame, or null for
   * other styles and before the first frame.
   */
  basePrice: number | null = null;
  /**
   * Label the base level on the price axis. The chart sets it while the series
   * is hovered or its base handle is in use.
   * @internal
   */
  showBaseLevel = false;

  get upColor(): string {
    return this.options.upColor ?? this.host.theme.up;
  }

  get downColor(): string {
    return this.options.downColor ?? this.host.theme.down;
  }

  /** The format in effect: `priceFormat`, else `precision` decimals, else decimals detected from the data. */
  get formatModel(): PriceFormatModel {
    return (
      this.priceFormat ??
      this.locale.priceFormat(decimalPriceFormat(this.options.precision ?? autoPrecision(this.data[this.data.length - 1]?.close ?? 0)))
    );
  }

  get format(): PriceFormatter {
    const model = this.formatModel;
    return (v) => model.format(v);
  }

  private get perBar(): number {
    // `hollowDown` splits the wick around the body, as `hollow` does: one more instance.
    return (RECTS_PER_BAR[this.options.style] ?? 0) + (this.#splitsWick ? 1 : 0);
  }

  /** Whether `hollowDown` applies to the style. */
  get #splitsWick(): boolean {
    const style = this.options.style;
    return this.options.hollowDown === true && (style === 'candles' || style === 'heikinAshi' || style === 'volumeCandles');
  }

  setData(bars: Bar[], options: SetDataOptions = {}): void {
    if (options.normalize) {
      assertFiniteTimes(bars, 'Candle');
      bars = normalizeBars(bars, (bar, reason) => this.host.seriesDropped?.(this, bar, reason));
    } else {
      for (let i = 0; i < bars.length; i++) assertBar(bars[i]!, () => `bar at index ${i}`);
    }
    const times = bars.map((b) => b.time);
    assertAscending(times, 'Candle');
    this.data = bars.slice();
    this.#times = times;
    this.shown = null;
    if (this.isMain) this.host.mainDataChanged(false, options.keepVisibleRange);
    else this.rebuild();
    this.host.requestRender();
  }

  /** Replace the last bar (same time) or append a newer one. */
  update(bar: Bar): void {
    assertBar(bar, () => 'update');
    const last = this.data[this.data.length - 1];
    if (!last) {
      this.setData([bar]);
      return;
    }
    if (bar.time < last.time) {
      this.host.seriesDropped?.(this, bar, 'older');
      return;
    }
    if (PULSE_STYLES.has(this.options.style)) this.pulse?.trigger(this.options.lastPointPulse);
    if (bar.time === last.time) {
      const tween = this.options.animate && !this.host.animationsOff;
      if (tween && !this.shown) this.shown = { ...last };
      this.data[this.data.length - 1] = bar;
      if (!tween) this.#refreshLast();
      if (this.isMain) this.host.mainLastBarChanged();
    } else {
      // Settle a still-easing last bar at its target before it stops being the last one;
      // appends never revisit earlier bars, and Heikin Ashi chains from it.
      if (this.shown) {
        this.shown = null;
        this.#refreshLast();
      }
      this.data.push(bar);
      this.#times.push(bar.time);
      // The main series extends the timeline first, which calls appendAligned on every series.
      if (this.isMain) this.host.mainDataChanged(true);
      else this.#appendTail();
    }
    this.host.requestRender();
  }

  override appendAligned(): void {
    this.#appendTail();
  }

  /**
   * Put `bars`, all older than the first bar, in front of it. The main series
   * then extends the timeline at the front, which calls `prependAligned` on
   * every series. Returns false, changing nothing, when there is no first bar
   * or the bars do not all sit before it: `setData` then.
   * @internal
   */
  prependBars(bars: readonly Bar[]): boolean {
    const last = bars[bars.length - 1];
    if (!last) return true;
    const first = this.data[0];
    if (!first || !(last.time < first.time)) return false;
    for (let i = 0; i < bars.length; i++) assertBar(bars[i]!, () => `bar at index ${i}`);
    const times = bars.map((b) => b.time);
    assertAscending(times, 'Candle');
    replaceFront(this.data, 0, bars);
    replaceFront(this.#times, 0, times);
    this.front = { removed: 0, inserted: bars.length };
    if (!this.isMain) this.prependAligned(0);
    else if (this.host.mainDataPrepended) this.host.mainDataPrepended(bars.length);
    else this.host.mainDataChanged(false);
    this.host.requestRender();
    return true;
  }

  override prependAligned(bars: number): void {
    const change = this.front;
    const { removed, inserted } = change;
    this.front = NO_FRONT_CHANGE;
    if (removed > 0 || inserted > 0) {
      // Heikin Ashi chains every bar from the one before it, so older bars change them all.
      if (this.options.style === 'heikinAshi') {
        this.realign();
        return;
      }
      const front = new Array<Bar>(inserted);
      for (let i = 0; i < inserted; i++) front[i] = this.data[i]!;
      replaceFront(this.display, removed, front);
    }
    const times = this.#times;
    const { dropped, added } = this.align.spliceFront(bars, change, times.length, (i) => times[i]!, this.host.timeline, this.isMain);
    // Grouped levels bucket by timeline index, and line vertices hold indices: every index moved.
    this.#pyramid?.reset();
    this.#group.reset();
    this.#linesStale = 0;
    // Stored instances keep their bytes: they hold indices relative to `indexBase`.
    this.batch.indexBase += bars;
    const per = this.perBar;
    if (per === 0) return;
    this.batch.growFront((added - dropped) * per);
    // The new bars, and the first old one: its previous close is new.
    const end = Math.min(added + 1, this.align.count);
    for (let k = 0; k < end; k++) this.#writeBar(k);
  }

  /** Display, align and write only the bars after the last aligned one; O(new bars). */
  #appendTail(): void {
    const heikin = this.options.style === 'heikinAshi';
    for (let i = this.display.length; i < this.data.length; i++) {
      this.display.push(heikin ? heikinAshiBar(this.data[i]!, this.display[i - 1]) : this.data[i]!);
    }
    const start = this.align.extend(this.#times.length, (i) => this.#times[i]!, this.host.timeline, this.isMain);
    const n = this.align.count;
    const per = this.perBar;
    this.#groupChanged(start);
    if (start === n || per === 0) return;
    this.batch.resize(n * per);
    // `set` lowers the batch's dirty mark to the first new instance, so only the tail uploads.
    for (let k = start; k < n; k++) this.#writeBar(k);
  }

  override stepOverlay(dt: number): boolean {
    const o = this.options;
    return this.pulse?.step(PULSE_STYLES.has(o.style) ? o.lastPointPulse : undefined, dt, this.visible) ?? false;
  }

  override step(dt: number): boolean {
    const shown = this.shown;
    const target = this.data[this.data.length - 1];
    if (!shown || !target) return false;
    if (this.host.animationsOff) {
      // Low power came on mid-tween: settle on the bar as it is.
      this.shown = null;
      this.#refreshLast();
      return false;
    }
    const k = 1 - Math.exp(-dt / BAR_EASE_MS);
    const eps = Math.abs(target.close) * 1e-7;
    let moving = false;
    // A convex blend of two valid bars is valid, so low <= open/close <= high holds.
    for (const key of ['open', 'high', 'low', 'close'] as const) {
      const d = target[key] - shown[key];
      if (Math.abs(d) <= eps) shown[key] = target[key];
      else {
        shown[key] += d * k;
        moving = true;
      }
    }
    // Volume eases too, so volume candle widths grow smoothly on live ticks.
    const v = target.volume;
    // The absolute floor lets a fall to zero volume settle instead of decaying forever.
    if (v === undefined || shown.volume === undefined || Math.abs(v - shown.volume) <= Math.max(Math.abs(v) * 1e-7, 1e-6)) {
      shown.volume = v;
    } else {
      shown.volume += (v - shown.volume) * k;
      moving = true;
    }
    this.#refreshLast();
    if (!moving) this.shown = null;
    return moving;
  }

  rebuild(): void {
    const o = this.options;
    this.#bodyRgba = [parseColor(this.upColor), parseColor(this.downColor)];
    const t = this.host.theme;
    this.wickRgba =
      o.wicks === false
        ? [CLEAR, CLEAR]
        : [parseColor(o.upWickColor ?? t.upWick ?? this.upColor), parseColor(o.downWickColor ?? t.downWick ?? this.downColor)];
    // Without `borders`, no separate outline: hollow candles fall back to their body outline.
    const borders = o.borders !== false;
    const upBorder = borders ? (o.upBorderColor ?? t.upBorder) : undefined;
    const downBorder = borders ? (o.downBorderColor ?? t.downBorder) : undefined;
    this.borderRgba = [upBorder ? parseColor(upBorder) : null, downBorder ? parseColor(downBorder) : null];
    this.#lineRgba = parseColor(this.host.theme.line);
    if (o.style !== 'baseline') this.basePrice = null;
    // A full rebuild covers any history page still waiting for `prependAligned`.
    this.front = NO_FRONT_CHANGE;
    this.align.build(this.#times, this.host.timeline, this.isMain);
    this.display = this.options.style === 'heikinAshi' ? heikinAshi(this.data) : this.data.slice();
    if (this.shown) this.display[this.display.length - 1] = this.#displayBarAt(this.data.length - 1);
    const n = this.align.count;
    const per = this.perBar;
    this.batch.base = this.data[0]?.close ?? 0;
    this.batch.indexBase = 0;
    this.batch.resize(n * per);
    if (per > 0) for (let k = 0; k < n; k++) this.#writeBar(k);
    this.batch.markAllDirty();
    this.#pyramid?.reset();
    this.#group.reset();
    this.#linesStale = 0;
  }

  /** Aligned bars from position `k` on were appended or changed: keep the grouped levels and line vertices in step. */
  #groupChanged(k: number): void {
    if (k >= this.align.count) return;
    this.#pyramid?.update(k);
    this.#group.changed(this.align.index[k]!);
    this.#linesStale = Math.min(this.#linesStale, k);
  }

  /** The grouped levels, made on first use. */
  #ohlc(): Pyramid<OhlcField> {
    return (this.#pyramid ??= this.host.groupLevels!.pyramid(
      OHLC_MERGES,
      alignedSource(this.align, (k, field) => {
        const bar = this.display[this.align.source[k]!]!;
        if (field === 'cmin' || field === 'cmax') return bar.close;
        return field === 'volume' ? (bar.volume ?? 0) : bar[field];
      }),
    ));
  }

  /** Recompute and upload just the last bar. */
  #refreshLast(): void {
    const i = this.data.length - 1;
    if (i < 0) return;
    this.display[i] = this.#displayBarAt(i);
    const k = this.align.count - 1;
    if (k < 0 || this.align.source[k] !== i) return;
    this.#groupChanged(k);
    if (this.perBar > 0) this.#writeBar(k);
  }

  #displayBarAt(i: number): Bar {
    const bar = i === this.data.length - 1 && this.shown ? this.shown : this.data[i]!;
    if (this.options.style !== 'heikinAshi') return { ...bar };
    return heikinAshiBar(bar, this.display[i - 1]);
  }

  #writeBar(k: number): void {
    const src = this.align.source[k]!;
    const bar = this.display[src]!;
    this.#writeRects(this.batch, k * this.perBar, this.align.index[k]!, bar, this.display[src - 1]?.close ?? bar.open, this.#colorsAt(src));
  }

  /**
   * The colours of bar `src`: the bar's as given (Heikin Ashi and the live
   * tween make new objects), or the last recolouring with one for the whole bar.
   */
  #colorsAt(src: number): BarColors {
    let color: string | undefined;
    for (const at of this.#recolors.values()) color = at(src) ?? color;
    if (color === undefined) return this.data[src]!;
    const given = this.#given;
    given.color = given.wickColor = given.borderColor = color;
    return given;
  }

  /**
   * @internal Recolour the bars with `at` for `owner` (null stops it) and
   * rewrite them from data index `from` on.
   */
  setBarColors(owner: object, at: ((i: number) => string | undefined) | null, from = 0): void {
    if (at) this.#recolors.set(owner, at);
    else if (!this.#recolors.delete(owner)) return;
    if (this.perBar === 0) return;
    for (let k = this.align.count - 1; k >= 0 && this.align.source[k]! >= from; k--) this.#writeBar(k);
    this.host.requestRender();
  }

  /** The instances of one bar (or bucket) at logical `index`, from instance `o` of `batch`. */
  #writeRects(batch: RectBatch, o: number, index: number, bar: Bar, prevClose: number, given: BarColors): void {
    const side = this.#isUp(bar, prevClose) ? 0 : 1;
    const color = barRgba(given.color) ?? this.#bodyRgba[side];
    // The options decide whether wicks and outlines are drawn; a bar only recolours them.
    const wick = this.options.wicks !== false ? barRgba(given.wickColor) : null;
    const border = this.options.borders !== false ? barRgba(given.borderColor) : null;
    switch (this.options.style) {
      case 'hollow': {
        // Coloured by change vs previous close; rising bodies are outlines and
        // the wick is split so it does not cross the hollow body.
        const s = bar.close >= prevClose ? 0 : 1;
        const hollow = bar.close >= bar.open;
        const body = barRgba(given.color) ?? this.#bodyRgba[s];
        const top = Math.max(bar.open, bar.close);
        const bottom = Math.min(bar.open, bar.close);
        batch.set(o, index, bar.low, bottom, RectKind.Wick, wick ?? this.wickRgba[s]);
        batch.set(o + 1, index, top, bar.high, RectKind.Wick, wick ?? this.wickRgba[s]);
        batch.set(o + 2, index, bar.open, bar.close, RectKind.Body, hollow ? CLEAR : body);
        const outline = border ?? this.borderRgba[s] ?? (hollow ? body : CLEAR);
        batch.set(o + 3, index, bar.open, bar.close, RectKind.HollowBody, outline);
        break;
      }
      case 'bars':
        setOhlcRects(batch, o, index, bar, true, color);
        break;
      case 'hlcBars':
        batch.set(o, index, bar.low, bar.high, RectKind.Wick, color);
        batch.set(o + 1, index, bar.close, bar.close, RectKind.TickRight, color);
        break;
      case 'highLow':
        batch.set(o, index, bar.low, bar.high, RectKind.Body, barRgba(given.color) ?? this.#lineRgba);
        break;
      default: {
        // Volume candles carry the volume as the body width weight (see drawGL).
        const weight = this.options.style === 'volumeCandles' ? volumeWeight(bar.volume) : 1;
        // `hollowDown`: a falling body keeps only its outline (in the body colour unless a border
        // is set), and its wick is split so it does not cross the empty body.
        const split = this.#splitsWick;
        const outlined = split && side === 1;
        const wickColor = wick ?? this.wickRgba[side];
        const top = Math.max(bar.open, bar.close);
        batch.set(o, index, bar.low, outlined ? Math.min(bar.open, bar.close) : bar.high, RectKind.Wick, wickColor);
        batch.set(o + 1, index, bar.open, bar.close, RectKind.Body, outlined ? CLEAR : color, weight);
        const outline = border ?? this.borderRgba[side] ?? (outlined ? color : CLEAR);
        batch.set(o + 2, index, bar.open, bar.close, RectKind.HollowBody, outline, weight);
        if (split) batch.set(o + 3, index, top, bar.high, RectKind.Wick, outlined ? wickColor : CLEAR);
      }
    }
  }

  /** The bar as drawn at logical `index` (Heikin Ashi applied, live bar tweened), or undefined. */
  displayedBarAt(index: number): Bar | undefined {
    const src = this.align.sourceAt(index);
    return src < 0 ? undefined : this.display[src];
  }

  /**
   * The prices the style draws at logical `index`, for hit-testing and snapping:
   * all four for candles and bars, no open for HLC styles, high and low for
   * high-low bars, and only the close for line-like styles.
   */
  drawnBarAt(index: number): DrawnBar | undefined {
    const group = this.groupAt(index);
    const bar = group ? (group.bar ?? undefined) : this.displayedBarAt(index);
    if (!bar) return undefined;
    const { open, high, low, close } = bar;
    switch (this.options.style) {
      case 'hlcBars':
      case 'rangeBand':
      case 'highLow':
        return { high, low, close };
      default:
        return this.#closeOnly ? { close } : { open, high, low, close };
    }
  }

  /** Rising bar for colouring: close vs open, or vs the previous close when configured. */
  #isUp(bar: Bar, prevClose: number): boolean {
    return bar.close >= (this.options.colorByPreviousClose ? prevClose : bar.open);
  }

  /** Largest volume among aligned positions [a, b); 0 when none has one. */
  #maxVolume(a: number, b: number): number {
    let max = 0;
    for (let k = a; k < b; k++) {
      const v = volumeWeight(this.display[this.align.source[k]!]!.volume);
      if (v > max) max = v;
    }
    return max;
  }

  /** Close of the first bar at or after logical `index` (percent-scale base). */
  closeFrom(index: number): number | undefined {
    return this.display[this.align.sourceFrom(index)]?.close;
  }

  override firstValueFrom(index: number, field: 'open' | 'close' = 'close'): number | undefined {
    if (field === 'close') return this.closeFrom(index);
    return this.display[this.align.sourceFrom(index)]?.open;
  }

  /** Close-only styles autoscale on closes (range band is 2D but spans high to low). */
  get #closeOnly(): boolean {
    return this.perBar === 0 && this.options.style !== 'rangeBand' && !PRICE_STYLES.has(this.options.style);
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    const g = this.host.buckets;
    if (g) {
      // Whole buckets are drawn at the edges, so the range covers them.
      const grouped = this.#groupedRange(...wholeBuckets(g, from, to), positiveOnly);
      if (grouped !== undefined) return grouped;
    }
    const [a, b] = this.align.range(from, to);
    if (a >= b) return null;
    const range = this.rangeBuilder.reset(positiveOnly);
    const useClose = this.#closeOnly;
    // Point & figure prices are box middles: the boxes reach half a box further.
    const pad = this.options.style === 'pointFigure' ? (this.#priceStyles()?.pad() ?? 0) : 0;
    for (let k = a; k < b; k++) {
      const bar = this.display[this.align.source[k]!]!;
      range.add(useClose ? bar.close : bar.low - pad);
      range.add(useClose ? bar.close : bar.high + pad);
    }
    this.#addBaseLevel(range);
    return range.range;
  }

  /**
   * The price range over timeline indices `from` to `to` from the grouped
   * levels, in O(log n) buckets; undefined when a log scale needs the
   * positive values the levels do not keep apart (then scan the bars).
   */
  #groupedRange(from: number, to: number, positiveOnly: boolean): [number, number] | null | undefined {
    const p = this.#ohlc();
    const useClose = this.#closeOnly;
    const lo = p.extreme(useClose ? 'cmin' : 'low', 'min', from, to);
    if (lo === Infinity) return null;
    if (positiveOnly && !(lo > 0)) return undefined;
    const range = this.rangeBuilder.reset(positiveOnly);
    range.add(lo);
    range.add(p.extreme(useClose ? 'cmax' : 'high', 'max', from, to));
    this.#addBaseLevel(range);
    return range.range;
  }

  /** Autoscale keeps a fixed base level in view, so its handle stays reachable. */
  #addBaseLevel(range: RangeBuilder): void {
    const level = this.options.baseLevel;
    if (this.options.style === 'baseline' && level?.kind === 'price' && usablePrice(level.price, this.scale)) {
      range.add(level.price);
    }
  }

  /** Free this series' GPU objects; it is leaving the chart. */
  override dispose(): void {
    this.host.releaseGpu?.(this.batch);
    this.host.releaseGpu?.(this.#group.batch);
    this.#releaseLines([...this.lines.all, ...this.#groupedLines.all]);
    this.priceStyle?.keep(null);
  }

  /**
   * Single bars: free the GPU objects grouped bars drew with. Without the
   * `grouping()` plugin the grouped levels go too; with it they stay, so
   * zooming back out does not rebuild them.
   */
  #ungrouped(): void {
    if (this.#group.batch.gpu) this.host.releaseGpu?.(this.#group.batch);
    this.#releaseLines(this.#groupedLines.all);
    if (!this.host.groupLevels) this.#pyramid = null;
  }

  /** Whether the GPU draws the style's lines and fills: not opted out, and a line-drawn style. */
  get #linesOnGpu(): boolean {
    return this.options.renderer !== 'canvas' && GPU_LINE_STYLES.has(this.options.style);
  }

  /** Free the GPU objects of `batches`; their vertices are written again before they are next drawn. */
  #releaseLines(batches: LineBatch[]): void {
    for (const batch of batches) if (batch.gpu) this.host.releaseGpu?.(batch);
  }

  override get drawsOnGpu(): boolean {
    return this.perBar > 0 || this.#linesOnGpu || PRICE_STYLES.has(this.options.style);
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    const style = this.options.style;
    if (!this.host.buckets) this.#ungrouped();
    if (PRICE_STYLES.has(style)) {
      this.#releaseLines([...this.lines.all, ...this.#groupedLines.all]);
      const prices = this.#priceStyles();
      if (!prices) {
        // The plugin went: free what its drawer held.
        this.priceStyle?.keep(null);
        this.priceStyle = null;
        if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
          devWarnOnce(`The ${style} style draws nothing without the priceStyles() plugin: add it (or builtins()) to the chart`, 'price-styles-missing');
        }
        return;
      }
      const from = this.#linesStale;
      this.#linesStale = Infinity;
      prices.draw(r, env, style, from, this.align, this.display);
      return;
    }
    this.priceStyle?.keep(null);
    if (this.#linesOnGpu) {
      this.#drawLinesGpu(r, env);
      return;
    }
    // On the canvas, or a style drawn with rects: let the line vertices go.
    this.#releaseLines([...this.lines.all, ...this.#groupedLines.all]);
    this.#linesStale = 0;
    const per = this.perBar;
    if (per === 0) return;
    const g = this.host.buckets;
    if (g) {
      this.#drawGrouped(r, env, g);
      return;
    }
    const [a, b] = this.align.range(env.from, env.to);
    // Volume candle widths are relative to the largest volume on screen.
    const maxVolume = style === 'volumeCandles' ? this.#maxVolume(a, b) : 0;
    const thick = (style === 'bars' || style === 'hlcBars') && this.options.thinBars === false;
    r.drawRects(this.batch, a * per, (b - a) * per, {
      ...rectUniforms(this, env, this.batch, style === 'highLow' ? this.options.bodyRatio * 0.6 : this.options.bodyRatio, 1),
      weight: maxVolume > 0 ? [1 / maxVolume, VOLUME_MIN_WIDTH] : undefined,
      stroke: thick ? BAR_STROKE_RATIO : 0,
    });
  }

  /** Draw the buckets of `g` on screen, each as wide as the narrowest of them. */
  #drawGrouped(r: RenderBackend, env: PaneEnv, g: Buckets): void {
    const per = this.perBar;
    const size = this.#writeGroup(g);
    const [ja, jb] = bucketRange(env.from, env.to, g, size);
    if (jb < ja) return;
    const p = this.#ohlc();
    const style = this.options.style;
    let maxVolume = 0;
    if (style === 'volumeCandles') for (let j = ja; j <= jb; j++) maxVolume = Math.max(maxVolume, p.get(g, j, 'volume'));
    const thick = (style === 'bars' || style === 'hlcBars') && this.options.thinBars === false;
    const w = narrowestBucket(g, ja, jb);
    r.drawRects(this.#group.batch, ja * per, (jb - ja + 1) * per, {
      ...rectUniforms(this, env, this.#group.batch, (style === 'highLow' ? this.options.bodyRatio * 0.6 : this.options.bodyRatio) * w, w),
      weight: maxVolume > 0 ? [1 / maxVolume, VOLUME_MIN_WIDTH] : undefined,
      stroke: thick ? BAR_STROKE_RATIO * w : 0,
    });
  }

  /**
   * A line-drawn style on the GPU: its fills, then its lines, as the canvas
   * draws them. The bars' vertices are written once and from the first
   * changed bar on; while the view groups bars, the buckets on screen are
   * written each frame, one point per bucket as on the canvas.
   */
  #drawLinesGpu(r: RenderBackend, env: PaneEnv): void {
    const o = this.options;
    const style = o.style;
    const g = this.host.buckets;
    const set = g ? this.#groupedLines : this.lines;
    if (style !== 'rangeBand') this.#releaseLines([set.high, set.low]);
    let a: number;
    let b: number;
    if (g) {
      const buckets = this.#visibleBuckets(env, g);
      this.#buildLines(set, buckets.length, (k) => bucketCenter(g, buckets[k]!), (k) => this.#groupedBar(g, buckets[k]!)!, 0);
      [a, b] = [0, buckets.length];
    } else {
      const from = this.#linesStale;
      this.#linesStale = Infinity;
      if (from < Infinity || set.close.shape === null) {
        const align = this.align;
        this.#buildLines(set, align.count, (k) => align.index[k]!, (k) => this.display[align.source[k]!]!, from);
      }
      [a, b] = this.align.range(env.from - 1, env.to + 1);
    }
    const scale = this.scale;
    const close = set.close;
    const [first, end] = close.vertexRange(a, b);
    // Dashes start where the canvas path does: the last vertex of the first bar drawn.
    const origin = close.vertexOf(a + 1) - 1;
    const color = this.host.theme.line;
    const stroke: GpuStroke = { color, lineWidth: o.lineWidth, lineStyle: o.lineStyle, step: style === 'step' };
    if (style === 'baseline') {
      // On an inverted scale the prices above the base are the lower half.
      const [top, bottom] = scale.invert ? [this.downColor, this.upColor] : [this.upColor, this.downColor];
      const y = scale.priceToY(this.#baseFor(env));
      const [upper, lower] = baselineGradients(top, bottom);
      fillGpu(r, env, scale, close, first, end, y, upper, { y, below: lower });
      strokeGpu(r, env, scale, close, first, end, origin, { ...stroke, color: top, split: { y, below: bottom } });
      return;
    }
    if (style === 'area') fillGpu(r, env, scale, close, first, end, env.height, areaGradient(color));
    if (style === 'rangeBand') {
      const [bandFirst, bandEnd] = set.high.vertexRange(a, b);
      const tint = (c: string): [string, string] => [withAlpha(c, 0.2), withAlpha(c, 0.2)];
      fillGpu(r, env, scale, set.high, bandFirst, bandEnd, 'band', tint(this.upColor));
      fillGpu(r, env, scale, set.low, bandFirst, bandEnd, 'band', tint(this.downColor));
      // A band's own line is its edge; solid, so the close values in its arc slot are not read.
      const edge = (batch: LineBatch, c: string) =>
        strokeGpu(r, env, scale, batch, bandFirst, bandEnd, bandFirst, { color: withAlpha(c, 0.55), lineWidth: 1 });
      edge(set.high, this.upColor);
      edge(set.low, this.downColor);
    }
    strokeGpu(r, env, scale, close, first, end, origin, stroke);
  }

  /** The drawer of the `kagi` and `pointFigure` styles, made on first use; null on a chart without the `priceStyles()` plugin. */
  #priceStyles(): PriceStyleDrawer | null {
    const make = this.host.priceStyles;
    return make ? (this.priceStyle ??= make(this, (owner) => this.host.releaseGpu?.(owner))) : null;
  }

  /** Write the vertices of the style's lines for `n` bars at `indexAt`, from bar `from` on. */
  #buildLines(set: StyleLines, n: number, indexAt: (k: number) => number, barAt: (k: number) => Bar, from: number): void {
    const close = (k: number) => barAt(Math.min(k, n - 1)).close;
    if (this.options.style === 'step') {
      // The canvas holds each close from half a bar before its bar to half a bar before the next one,
      // and the last one half a bar past its bar: the bars moved half a bar back, and one more point.
      const index = (k: number) => (k < n ? indexAt(k) - 0.5 : indexAt(n - 1) + 0.5);
      set.close.build(n > 0 ? n + 1 : 0, index, close, STEP_LINE, from);
    } else {
      set.close.build(n, indexAt, close, SIMPLE_LINE, from);
    }
    if (this.options.style !== 'rangeBand') return;
    set.high.buildBand(n, indexAt, (k) => barAt(k).high, close, from);
    set.low.buildBand(n, indexAt, (k) => barAt(k).low, close, from);
  }

  /** The base price of the `baseline` style this frame, kept in `basePrice`. */
  #baseFor(env: PaneEnv): number {
    // When this series is its percent scale's base, a first-visible base is the 0% line.
    const level = this.options.baseLevel ?? DEFAULT_BASE_LEVEL;
    const first = level.kind === 'firstVisible' ? this.closeFrom(env.from) : undefined;
    return (this.basePrice = resolveBaseLevel(level, this.scale, env.height, first));
  }

  /** Bring the group batch up to date for `g`; returns its bucket count. */
  #writeGroup(g: Buckets): number {
    const p = this.#ohlc();
    const size = p.size(g);
    const per = this.perBar;
    const from = this.#group.begin(g, this.batch.base);
    const batch = this.#group.batch;
    batch.resize(size * per);
    for (let j = from; j < size; j++) {
      const bar = this.#groupedBar(g, j);
      const o = j * per;
      if (!bar) {
        for (let m = 0; m < per; m++) batch.set(o + m, bucketCenter(g, j), batch.base, batch.base, RectKind.Body, CLEAR);
        continue;
      }
      const prev = j > 0 && p.count(g, j - 1) > 0 ? p.get(g, j - 1, 'close') : bar.open;
      this.#writeRects(batch, o, bucketCenter(g, j), bar, prev, bar);
    }
    return size;
  }

  /** Bucket `j` of `g` as one bar (time: its first bar's), or null when it is empty. */
  #groupedBar(g: Buckets, j: number): Bar | null {
    const p = this.#ohlc();
    if (p.count(g, j) === 0) return null;
    return {
      time: this.host.timeline.timeFromIndex(g.start(j)),
      open: p.get(g, j, 'open'),
      high: p.get(g, j, 'high'),
      low: p.get(g, j, 'low'),
      close: p.get(g, j, 'close'),
      volume: p.get(g, j, 'volume'),
    };
  }

  /**
   * The bucket holding logical `index` while the view groups bars: its bar,
   * the close before it, and its first and last bar time and bar count.
   * Undefined when the view is not grouped.
   */
  groupAt(index: number): { bar: Bar | null; prevClose: number; time: Time; endTime: Time; count: number } | undefined {
    const g = this.host.buckets;
    if (!g || this.align.count === 0) return undefined;
    const p = this.#ohlc();
    const j = g.of(Math.floor(index));
    const bar = j >= 0 && j < p.size(g) ? this.#groupedBar(g, j) : null;
    const prev = j > 0 && j - 1 < p.size(g) && p.count(g, j - 1) > 0 ? p.get(g, j - 1, 'close') : (bar?.open ?? NaN);
    const tl = this.host.timeline;
    const last = Math.min(tl.lastIndex, g.end(j) - 1);
    return { bar, prevClose: prev, time: tl.timeFromIndex(g.start(j)), endTime: tl.timeFromIndex(last), count: bar ? p.count(g, j) : 0 };
  }

  /** Non-empty buckets of `g` on screen plus one either side, for the 2D styles. */
  #visibleBuckets(env: PaneEnv, g: Buckets): number[] {
    return visibleBuckets(this.#ohlc(), env, g, this.#bucketScratch);
  }

  override draw2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    if (this.perBar > 0 || PRICE_STYLES.has(this.options.style)) return;
    this.#drawStyle2D(ctx, env);
    // After the style, and also when the GPU drew the line.
    this.#drawPulse(ctx, env);
  }

  /** The 2D part of the style; the GPU may have drawn the rest. */
  #drawStyle2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const style = this.options.style;
    const gpu = this.#linesOnGpu;
    if (gpu && style === 'baseline') {
      drawBaseLevel(ctx, env, this.scale.priceToY(this.#baseFor(env)));
      return;
    }
    // The GPU drew the lines and fills; only the dots of `lineMarkers` are left.
    if (gpu && style !== 'lineMarkers') return;
    const g = this.host.buckets ?? null;
    // Grouped: one point per non-empty bucket on screen, at its centre.
    const buckets = g ? this.#visibleBuckets(env, g) : null;
    const [a, b] = buckets ? [0, buckets.length] : this.align.range(env.from - 1, env.to + 1);
    if (b - a < 1) return;
    const scale = this.scale;
    const color = this.host.theme.line;
    const p = buckets ? this.#ohlc() : null;
    const index = buckets && g ? (k: number) => bucketCenter(g, buckets[k]!) : (k: number) => this.align.index[k]!;
    const close = p && buckets && g ? (k: number) => p.get(g, buckets[k]!, 'close') : (k: number) => this.display[this.align.source[k]!]!.close;
    const lineStyle = this.options.lineStyle;
    switch (style) {
      case 'columns':
        drawColumns(ctx, env, scale, a, b, index, close, this.upColor, this.downColor);
        return;
      case 'step':
        drawStepLine(ctx, env, scale, a, b, index, close, color, this.options.lineWidth, lineStyle);
        break;
      case 'rangeBand': {
        const bar = buckets && g ? (k: number) => this.#groupedBar(g, buckets[k]!)! : (k: number) => this.display[this.align.source[k]!]!;
        drawRangeBand(ctx, env, scale, a, b, index, bar, this.upColor, this.downColor, color, this.options.lineWidth, lineStyle);
        return;
      }
      case 'baseline': {
        const base = this.#baseFor(env);
        drawBaseline(ctx, env, scale, a, b, index, close, base, this.upColor, this.downColor, this.options.lineWidth, true, {
          lineStyle,
        });
        break;
      }
      default:
        if (!gpu) {
          drawPolyline(ctx, env, a, b, index, close, {
            color,
            lineWidth: this.options.lineWidth,
            lineStyle,
            fill: style === 'area' ? areaGradient(color) : undefined,
            scale,
          });
        }
        if (style === 'lineMarkers' && env.time.barSpacing >= 4) {
          const r = Math.min(3.5, env.time.barSpacing / 4 + 1);
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let k = a; k < b; k++) {
            const x = env.time.indexToX(index(k));
            const y = scale.priceToY(close(k));
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
    }
  }

  /** The last-point pulse on the newest close (the last bucket's when grouped), when it is in view. */
  #drawPulse(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const style = this.options.style;
    const pulse = this.options.lastPointPulse;
    if (!PULSE_STYLES.has(style) || !pulseOn(pulse)) return;
    const clock = this.pulseFor(pulse);
    if (!clock) return;
    const g = this.host.buckets ?? null;
    let value: number;
    let index: number;
    if (g) {
      const p = this.#ohlc();
      const j = p.size(g) - 1;
      if (j < 0 || p.count(g, j) === 0) return;
      value = p.get(g, j, 'close');
      index = bucketCenter(g, j);
    } else {
      const n = this.align.count;
      if (n === 0) return;
      value = this.display[this.align.source[n - 1]!]!.close;
      index = this.align.index[n - 1]!;
    }
    const x = env.time.indexToX(index);
    const y = this.scale.priceToY(value);
    if (!onScreen(x, y, env.width, env.height)) return;
    const base = this.basePrice ?? value;
    const tint = style === 'baseline' ? (value >= base ? this.upColor : this.downColor) : this.host.theme.line;
    clock.draw(ctx, pulse, x, y, tint, this.options.lineWidth);
  }

  override legend(index: number, view: LegendView = FULL_VIEW): LegendEntry | null {
    const group = this.groupAt(index);
    const i = this.align.sourceAt(index);
    const source = this.options.style === 'heikinAshi' ? this.display : this.data;
    // Grouped: the bucket's open, high, low and close.
    const bar = group ? group.bar : source[i];
    if (!bar) return { title: this.options.title, parts: [] };
    const prev = group ? group.prevClose : (source[i - 1]?.close ?? bar.open);
    const fmt = this.format;
    const color = this.#isUp(bar, prev) ? this.upColor : this.downColor;
    const parts: LegendPart[] =
      view.mode === 'full'
        ? [
            { label: this.locale.text('legendOpen'), text: fmt(bar.open), color },
            { label: this.locale.text('legendHigh'), text: fmt(bar.high), color },
            { label: this.locale.text('legendLow'), text: fmt(bar.low), color },
            { label: this.locale.text('legendClose'), text: fmt(bar.close), color },
          ]
        : [{ text: fmt(bar.close), color }];
    if (view.showChange) parts.push({ text: changeText(bar.close, prev, fmt, view.changeArrows, this.locale), color });
    return { title: this.options.title, parts };
  }

  protected override labelValueAt(i: number): LastValue | null {
    const bar = this.display[i];
    if (!bar) return null;
    const prev = this.display[i - 1]?.close ?? bar.open;
    // The bar's own colour where the style draws it, so the label matches the bar.
    const own = this.perBar > 0 ? this.#colorsAt(i).color : undefined;
    return {
      value: bar.close,
      text: this.format(bar.close),
      color: own !== undefined && barRgba(own) ? own : bar.close >= prev ? this.upColor : this.downColor,
    };
  }

  override lastIndexAtOrBefore(index: number): number {
    return this.align.newestAtOrBefore(index, this.data.length);
  }

  protected override get priceLineByDefault(): boolean {
    // As before: the main candles show the line unless their last-value label is off.
    return this.isMain && this.options.lastValueLabel !== false;
  }

  /** The last value, then the base level while it is shown (see `showBaseLevel`). */
  override lastValues(): LastValue[] {
    const out = super.lastValues();
    const base = this.basePrice;
    if (this.showBaseLevel && this.options.style === 'baseline' && base !== null) {
      out.push({ value: base, text: this.format(base), color: this.host.theme.labelBackground });
    }
    return out;
  }
}

/** Heikin Ashi transform of a bar given the previous transformed bar. */
export function heikinAshiBar(bar: Bar, prevHa: Bar | undefined): Bar {
  const close = (bar.open + bar.high + bar.low + bar.close) / 4;
  const open = prevHa ? (prevHa.open + prevHa.close) / 2 : (bar.open + bar.close) / 2;
  return {
    time: bar.time,
    open,
    close,
    high: Math.max(bar.high, open, close),
    low: Math.min(bar.low, open, close),
    volume: bar.volume,
  };
}

/**
 * Heikin-Ashi transform of `bars`: each bar averaged with the transformed bar
 * before it, smoothing out noise. Returns new bars and leaves the input
 * unchanged.
 */
export function heikinAshi(bars: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const bar of bars) out.push(heikinAshiBar(bar, out[out.length - 1]));
  return out;
}

/** A bar's volume as a rect width weight; -1 (normal width) when missing or invalid. */
function volumeWeight(volume: number | undefined): number {
  return volume !== undefined && Number.isFinite(volume) && volume >= 0 ? volume : -1;
}

/**
 * Body width of a volume candle as a fraction of a normal candle body: its
 * volume over `maxVolume` (the largest volume on screen), clamped to
 * [VOLUME_MIN_WIDTH, 1]. Bars without volume keep the normal width. This is
 * the factor the rect shader computes from the body width weight.
 */
export function volumeWidthFactor(volume: number | undefined, maxVolume: number): number {
  const weight = volumeWeight(volume);
  if (weight < 0 || !(maxVolume > 0)) return 1;
  return clampNum(weight / maxVolume, VOLUME_MIN_WIDTH, 1);
}

/**
 * Volume candle body width in device px, mirroring the rect shader: the normal
 * body width scaled by `factor` (see volumeWidthFactor), kept at least three
 * wicks wide when the normal body has room (else one wick), then matched to
 * the wick's parity so the wick sits in the body center.
 */
export function volumeBodyWidth(normalWidth: number, wickWidth: number, factor: number): number {
  const scaled = Math.floor(normalWidth * factor);
  const w = Math.max(scaled, normalWidth >= wickWidth * 3 ? wickWidth * 3 : wickWidth);
  return w % 2 !== wickWidth % 2 ? Math.max(wickWidth, w - 1) : w;
}

/** Screen-space outline of an HLC band: one entry per pixel column, y in css px. */
export interface BandColumns {
  x: number[];
  high: number[];
  close: number[];
  low: number[];
}

/**
 * Outline of an HLC band over aligned positions [a, b). Bars that share a
 * pixel column merge into one entry (topmost high, lowest low, last close), so
 * the cost of drawing stays proportional to the pane width.
 */
export function hlcBandColumns(
  a: number,
  b: number,
  xAt: (k: number) => number,
  highY: (k: number) => number,
  closeY: (k: number) => number,
  lowY: (k: number) => number,
): BandColumns {
  const out: BandColumns = { x: [], high: [], close: [], low: [] };
  let column = NaN;
  for (let k = a; k < b; k++) {
    const x = xAt(k);
    const col = Math.round(x);
    const h = highY(k);
    const l = lowY(k);
    const c = closeY(k);
    if (col !== column) {
      column = col;
      out.x.push(x);
      out.high.push(Math.min(h, l));
      out.low.push(Math.max(h, l));
      out.close.push(c);
      continue;
    }
    const i = out.x.length - 1;
    out.high[i] = Math.min(out.high[i]!, h, l);
    out.low[i] = Math.max(out.low[i]!, h, l);
    out.close[i] = c;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

/**
 * Options for a histogram series (`chart.addHistogram`): column colours and
 * base value, an optional mapping from the main series (such as volume),
 * grouping, labels and price scale placement.
 */
export interface HistogramSeriesOptions extends PriceLineSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  /**
   * Derive the series from the main series: called with each main bar, the one
   * before it and the theme; return a point, or null for none. The chart keeps
   * it in step on loads, history pages, symbol switches, live bars and theme
   * changes. See `volumeOf`.
   */
  follow?: FollowMapper<ValuePoint>;
  color?: string;
  /** Colors by sign relative to `base`; per-point `color` wins. */
  positiveColor?: string;
  negativeColor?: string;
  base: number;
  columnRatio: number;
  /**
   * How a column stands for several points when the chart groups bars
   * (`grouping` option): their `'sum'` (default, for volume-like data), the
   * `'max'` or the `'last'`. Its colour is the last point's.
   */
  groupBy?: 'sum' | 'max' | 'last';
  format: (value: number) => string;
  /** Overrides `format` for labels, and gives the pane its tick size and axis unit. */
  priceFormat?: PriceFormat;
  lastValueLabel: boolean;
  /** Show the series title (e.g. the symbol) in a tag beside the last-value label. */
  axisTitle?: boolean;
  overlay?: OverlayMargins;
  /**
   * Price scale id in the pane (default `'right'`). `'left'` shows a left axis;
   * other ids are overlays until given a side. Ignored with `overlay`.
   */
  priceScale?: string;
}

/** A series of vertical columns, one per point, such as volume. Create it with `chart.addHistogram`. */
export class HistogramSeries extends Series<HistogramSeriesOptions> {
  readonly kind = 'histogram';
  data: ValuePoint[] = [];
  readonly batch = new RectBatch();
  private align = new Alignment();
  /** Coarser levels of the points, made the first time the view groups bars. */
  #pyramid: Pyramid<ValueField> | null = null;
  /** Instances of the grouped level last drawn. */
  readonly #group = new GroupBatch();

  /** The grouped levels, made on first use. */
  private levels(): Pyramid<ValueField> {
    return (this.#pyramid ??= this.host.groupLevels!.pyramid(
      VALUE_MERGES,
      alignedSource(this.align, (k, field) => (field === 'item' ? k : this.data[this.align.source[k]!]!.value)),
    ));
  }

  /** Aligned points from position `k` on were appended or changed. */
  #groupChanged(k: number): void {
    if (k >= this.align.count) return;
    this.#pyramid?.update(k);
    this.#group.changed(this.align.index[k]!);
  }

  /** The value bucket `j` of `g` stands for under `groupBy`, and the point that colours it; null when empty. */
  #bucket(g: Buckets, j: number): { value: number; point: ValuePoint } | null {
    const p = this.levels();
    if (j < 0 || j >= p.size(g) || p.count(g, j) === 0) return null;
    const point = this.data[this.align.source[p.get(g, j, 'item')]!]!;
    const by = this.options.groupBy ?? 'sum';
    return { value: by === 'last' ? point.value : p.get(g, j, by), point };
  }

  override firstValueFrom(index: number): number | undefined {
    return this.data[this.align.sourceFrom(index)]?.value;
  }

  setData(points: ValuePoint[], options: SetDataOptions = {}): void {
    this.data = preparePoints(points, options, 'Histogram', (p, reason) => this.host.seriesDropped?.(this, p, reason));
    this.rebuild();
    this.host.requestRender();
  }

  update(point: ValuePoint): void {
    assertTime(point.time, 'Histogram update');
    const last = this.data[this.data.length - 1];
    if (last && point.time < last.time) {
      this.host.seriesDropped?.(this, point, 'older');
      return;
    }
    if (!hasValue(point)) {
      // No value is a gap; one for the last point's time removes that point.
      if (last?.time === point.time) {
        this.data.pop();
        this.rebuild();
        this.host.requestRender();
      }
      return;
    }
    if (last && point.time === last.time) {
      this.data[this.data.length - 1] = point;
      const k = this.align.count - 1;
      if (k >= 0 && this.align.source[k] === this.data.length - 1) {
        this.#writePoint(k, point, this.align.index[k]!);
        this.#groupChanged(k);
      }
    } else {
      this.data.push(point);
      this.#appendTail();
    }
    this.host.requestRender();
  }

  override appendAligned(): void {
    this.#appendTail();
  }

  override prependAligned(bars: number): void {
    const front = this.front;
    this.front = NO_FRONT_CHANGE;
    const data = this.data;
    const { dropped, added } = this.align.spliceFront(bars, front, data.length, (i) => data[i]!.time, this.host.timeline);
    this.#pyramid?.reset();
    this.#group.reset();
    this.batch.indexBase += bars;
    this.batch.growFront(added - dropped);
    for (let k = 0; k < added; k++) this.#writePoint(k, data[this.align.source[k]!]!, this.align.index[k]!);
  }

  /** Align and write only the points after the last aligned one; O(new points). */
  #appendTail(): void {
    const start = this.align.extend(this.data.length, (i) => this.data[i]!.time, this.host.timeline);
    const n = this.align.count;
    if (start === n) return;
    this.#groupChanged(start);
    this.batch.resize(n);
    for (let k = start; k < n; k++) this.#writePoint(k, this.data[this.align.source[k]!]!, this.align.index[k]!);
  }

  override followMain(bars: readonly Bar[], kind: FollowKind, added = 0): void {
    const map = this.options.follow;
    if (!map) return;
    const front = followBars('Histogram', this.data, map, bars, kind, this.host.theme, finiteValue, (p) => this.update(p), () => {
      this.data.pop();
      this.align.dropSource(this.data.length);
      this.batch.resize(this.align.count);
      // A removed point is a change that `update` cannot express: rebuild the levels.
      this.#pyramid?.reset();
      this.#group.reset();
      this.host.requestRender();
    }, added);
    if (front) this.front = front;
  }

  protected override refollow(): void {
    if (this.options.follow) this.followMain(this.host.mainBars ?? [], 'reset');
    else this.data = [];
  }

  rebuild(): void {
    this.front = NO_FRONT_CHANGE;
    this.align.build(this.data.map((p) => p.time), this.host.timeline);
    const n = this.align.count;
    this.batch.base = this.options.base;
    this.batch.indexBase = 0;
    this.batch.resize(n);
    for (let k = 0; k < n; k++) this.#writePoint(k, this.data[this.align.source[k]!]!, this.align.index[k]!);
    this.batch.markAllDirty();
    this.#pyramid?.reset();
    this.#group.reset();
  }

  #colorOf(p: ValuePoint): string {
    if (p.color) return p.color;
    const o = this.options;
    if (p.value >= o.base && o.positiveColor) return o.positiveColor;
    if (p.value < o.base && o.negativeColor) return o.negativeColor;
    return o.color ?? this.host.theme.line;
  }

  #writePoint(k: number, p: ValuePoint, index: number): void {
    this.batch.set(k, index, this.options.base, p.value, RectKind.Column, parseColor(this.#colorOf(p)));
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    const g = this.host.buckets;
    if (g) return this.#groupedRange(from, to, g, positiveOnly);
    const [a, b] = this.align.range(from, to);
    if (a >= b) return null;
    // The base stays in view, unless it is zero or below on a log scale: the columns then run off the bottom.
    const range = this.rangeBuilder.reset(positiveOnly);
    range.add(this.options.base);
    for (let k = a; k < b; k++) range.add(this.data[this.align.source[k]!]!.value);
    return range.range;
  }

  /** The base and the grouped columns on screen: O(buckets), about the plot width. */
  #groupedRange(from: number, to: number, g: Buckets, positiveOnly: boolean): [number, number] | null {
    const [ja, jb] = bucketRange(from, to, g, this.levels().size(g));
    const range = this.rangeBuilder.reset(positiveOnly);
    let any = false;
    for (let j = ja; j <= jb; j++) {
      const b = this.#bucket(g, j);
      if (!b) continue;
      range.add(b.value);
      any = true;
    }
    if (!any) return null;
    range.add(this.options.base);
    return range.range;
  }

  /** Free this series' GPU objects; it is leaving the chart. */
  override dispose(): void {
    this.host.releaseGpu?.(this.batch);
    this.host.releaseGpu?.(this.#group.batch);
  }

  override get drawsOnGpu(): boolean {
    return true;
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    const g = this.host.buckets;
    if (g) {
      this.#drawGrouped(r, env, g);
      return;
    }
    // Single bars: free the grouped columns, and the grouped levels without the `grouping()` plugin.
    if (this.#group.batch.gpu) this.host.releaseGpu?.(this.#group.batch);
    if (!this.host.groupLevels) this.#pyramid = null;
    const [a, b] = this.align.range(env.from, env.to);
    r.drawRects(this.batch, a, b - a, rectUniforms(this, env, this.batch, 1, this.options.columnRatio));
  }

  /** Draw the buckets of `g` on screen, each as wide as the narrowest of them. */
  #drawGrouped(r: RenderBackend, env: PaneEnv, g: Buckets): void {
    const size = this.levels().size(g);
    const batch = this.#group.batch;
    const from = this.#group.begin(g, this.options.base);
    batch.resize(size);
    for (let j = from; j < size; j++) {
      const b = this.#bucket(g, j);
      if (b) batch.set(j, bucketCenter(g, j), this.options.base, b.value, RectKind.Column, parseColor(this.#colorOf({ ...b.point, value: b.value })));
      else batch.set(j, bucketCenter(g, j), this.options.base, this.options.base, RectKind.Column, CLEAR);
    }
    const [ja, jb] = bucketRange(env.from, env.to, g, size);
    if (jb < ja) return;
    r.drawRects(batch, ja, jb - ja + 1, rectUniforms(this, env, batch, 1, this.options.columnRatio * narrowestBucket(g, ja, jb)));
  }

  override legend(index: number): LegendEntry {
    const g = this.host.buckets;
    const grouped = g ? this.#bucket(g, g.of(Math.floor(index))) : undefined;
    const p = grouped ? { ...grouped.point, value: grouped.value } : grouped === null ? undefined : this.data[this.align.sourceAt(index)];
    return {
      title: this.options.title,
      parts: p ? [{ text: this.formatValue(p.value), color: opaque(this.#colorOf(p)) }] : [],
    };
  }

  protected override labelValueAt(i: number): LastValue | null {
    const p = this.data[i];
    return p ? { value: p.value, text: this.formatValue(p.value), color: opaque(this.#colorOf(p)) } : null;
  }

  override lastIndexAtOrBefore(index: number): number {
    return this.align.newestAtOrBefore(index, this.data.length);
  }
}

/* ------------------------------------------------------------------ */
/* Line / area                                                         */
/* ------------------------------------------------------------------ */

/**
 * Options for a line series (`chart.addLine`): colour, width and line style, an
 * optional area fill, an optional mapping from the main series, markers, labels
 * and price scale placement.
 */
export interface LineSeriesOptions extends PriceLineSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  /**
   * Derive the series from the main series: called with each main bar, the one
   * before it and the theme; return a point, or null for none. The chart keeps
   * it in step on loads, history pages, symbol switches, live bars and theme
   * changes. See `volumeOf`.
   */
  follow?: FollowMapper<ValuePoint>;
  color?: string;
  lineWidth: number;
  /** Fill under the line with a vertical gradient. */
  area: boolean;
  /**
   * How points' own `color`s join (default `'segment'`): each segment in the
   * colour of the point it starts at, or `'gradient'`, blended from one point's
   * colour to the next one's.
   */
  colorMode?: 'segment' | 'gradient';
  /**
   * Baseline mode: line and fill switch between `aboveColor` and
   * `belowColor` at this value (e.g. 0 for cumulative delta).
   */
  baseline?: number;
  aboveColor?: string;
  belowColor?: string;
  /** Break the line over timeline bars where the series has no point, instead of joining across them. */
  breakGaps?: boolean;
  /** Solid, dashed or dotted stroke (default `'solid'`). */
  lineStyle?: LineStyle;
  /**
   * Where the line is stroked (default `'gpu'`). `'gpu'` strokes it with
   * WebGL2, which costs the CPU far less on long lines, many lines or frequent
   * redraws. GPU lines (and their `area` fill) draw below every series drawn
   * on the canvas, like candles do; `'canvas'` strokes them with the 2D
   * canvas, so `zIndex` orders them among other canvas series. Curved lines
   * and lines with per-point colours always draw on the canvas.
   */
  renderer?: 'canvas' | 'gpu';
  /**
   * How points are joined (default `'simple'`): straight segments, `'step'`
   * (level until the next point, then a vertical jump) or `'curved'` (a smooth
   * curve through every point that never overshoots it).
   */
  lineType?: LineType;
  /**
   * A dot on every point (default off). Drawn only while bars are wide enough
   * for the dots not to merge. `radius` in css px.
   */
  pointMarkers?: boolean | { radius?: number };
  /**
   * A dot where the crosshair meets the line (default off). `radius` in css px;
   * `color` defaults to the line colour at that point.
   */
  crosshairMarker?: boolean | { radius?: number; color?: string };
  /**
   * A pulse on the last point (default `'off'`): `'on-update'` rings once per
   * live update, `'continuous'` keeps ringing while the point is on screen.
   * Reduced motion shows a still dot instead. See `LastPointPulseOptions`.
   * Needs the `lastPointPulse()` plugin; without it the option draws nothing.
   */
  lastPointPulse?: LastPointPulse;
  format: (value: number) => string;
  /** Overrides `format` for labels, and gives the pane its tick size and axis unit. */
  priceFormat?: PriceFormat;
  lastValueLabel: boolean;
  /** Show the series title (e.g. the symbol) in a tag beside the last-value label. */
  axisTitle?: boolean;
  overlay?: OverlayMargins;
  /**
   * Price scale id in the pane (default `'right'`). `'left'` shows a left axis;
   * other ids are overlays until given a side. Ignored with `overlay`.
   */
  priceScale?: string;
}

/** A series of values drawn as a line, optionally with an area fill below it. Create it with `chart.addLine`. */
export class LineSeries extends Series<LineSeriesOptions> {
  readonly kind = 'line';
  data: ValuePoint[] = [];
  private align = new Alignment();
  /** Coarser levels of the points, made the first time the view groups bars. */
  #pyramid: Pyramid<LineField> | null = null;
  /** Ids of the points' own colours. */
  readonly #palette = new ColorPalette();
  /**
   * Whether a point has its own `color` or `areaColor` (stays set until the
   * next full rebuild). While false the line draws in one colour, as before.
   */
  #colored = false;
  /** Vertices of the grouped line, reused between frames; made the first time the view groups bars. */
  #grouped: GroupedLine | null = null;
  /** The points as GPU vertices, kept while the line is drawn there. */
  readonly #lineBatch = new LineBatch();
  /** First aligned position whose vertices are out of date; Infinity when current. */
  #lineStale = 0;
  /** Vertices of the grouped line on screen, written each frame while the view groups bars. */
  private readonly groupBatch = new LineBatch();
  /** Single bars: free the grouped line's GPU vertices, and without the `grouping()` plugin the grouped levels and line too. */
  #ungrouped(): void {
    if (this.groupBatch.gpu) this.host.releaseGpu?.(this.groupBatch);
    if (this.host.groupLevels) return;
    this.#pyramid = null;
    this.#grouped = null;
  }

  /** The grouped line's vertices, made on first use. */
  #groupedLine(): GroupedLine {
    return (this.#grouped ??= this.host.groupLevels!.line());
  }

  /** The grouped levels, made on first use. */
  private levels(): Pyramid<LineField> {
    return (this.#pyramid ??= this.host.groupLevels!.pyramid(LINE_MERGES, alignedSource(this.align, (k) => this.data[this.align.source[k]!]!.value)));
  }

  override firstValueFrom(index: number): number | undefined {
    return this.data[this.align.sourceFrom(index)]?.value;
  }

  setData(points: ValuePoint[], options: SetDataOptions = {}): void {
    this.data = preparePoints(points, options, 'Line', (p, reason) => this.host.seriesDropped?.(this, p, reason));
    this.rebuild();
    this.host.requestRender();
  }

  update(point: ValuePoint): void {
    assertTime(point.time, 'Line update');
    const last = this.data[this.data.length - 1];
    if (last && point.time < last.time) {
      this.host.seriesDropped?.(this, point, 'older');
      return;
    }
    if (!hasValue(point)) {
      // No value is a gap; one for the last point's time removes that point.
      if (last?.time === point.time) {
        this.data.pop();
        this.rebuild();
        this.host.requestRender();
      }
      return;
    }
    if (hasPointColor(point)) this.#colored = true;
    this.pulse?.trigger(this.options.lastPointPulse);
    if (last && point.time === last.time) {
      this.data[this.data.length - 1] = point;
      this.#pyramid?.update(this.align.count - 1);
      this.#staleFrom(this.align.count - 1);
    } else {
      this.data.push(point);
      this.appendAligned();
    }
    this.host.requestRender();
  }

  /** Lines draw from the aligned data each frame, so appending only extends the alignment (and the grouped levels and GPU vertices). */
  override appendAligned(): void {
    const from = this.align.extend(this.data.length, (i) => this.data[i]!.time, this.host.timeline);
    this.#pyramid?.update(from);
    this.#staleFrom(from);
  }

  #staleFrom(k: number): void {
    this.#lineStale = Math.min(this.#lineStale, k);
  }

  override prependAligned(bars: number): void {
    const front = this.front;
    this.front = NO_FRONT_CHANGE;
    const data = this.data;
    const align = this.align;
    const { dropped, added } = align.spliceFront(bars, front, data.length, (i) => data[i]!.time, this.host.timeline);
    for (let i = 0; i < front.inserted && !this.#colored; i++) this.#colored = hasPointColor(data[i]!);
    this.#pyramid?.reset();
    // GPU vertices hold timeline indices, which all moved: shift them, and write the points new at the front; else rewrite them all.
    const batch = this.#lineBatch;
    batch.indexShift += bars;
    if (this.#lineStale > 0 && batch.prepend(added, dropped, (k) => align.index[k]!, (k) => data[align.source[k]!]!.value)) {
      this.#lineStale += added - dropped;
    } else this.#staleFrom(0);
  }

  override followMain(bars: readonly Bar[], kind: FollowKind, added = 0): void {
    const map = this.options.follow;
    if (!map) return;
    const front = followBars('Line', this.data, map, bars, kind, this.host.theme, finiteValue, (p) => this.update(p), () => {
      this.data.pop();
      this.align.dropSource(this.data.length);
      this.#pyramid?.reset();
      this.#staleFrom(0);
      this.host.requestRender();
    }, added);
    if (front) this.front = front;
  }

  protected override refollow(): void {
    if (this.options.follow) this.followMain(this.host.mainBars ?? [], 'reset');
    else this.data = [];
  }

  rebuild(): void {
    this.front = NO_FRONT_CHANGE;
    this.#colored = this.data.some(hasPointColor);
    this.align.build(this.data.map((p) => p.time), this.host.timeline);
    this.#pyramid?.reset();
    this.#staleFrom(0);
  }

  /** The line colour at data point `i`: its own `color`, else the series colour for `value`. */
  #colorAt(i: number, value: number): string {
    const id = this.#colored ? this.#palette.id(this.data[i]?.color) : 0;
    return id > 0 ? this.#palette.colors[id]! : this.#colorFor(value);
  }

  #colorFor(value: number): string {
    const o = this.options;
    if (o.baseline !== undefined) {
      return (value >= o.baseline ? o.aboveColor : o.belowColor) ?? this.host.theme.line;
    }
    return o.color ?? this.host.theme.line;
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    const g = this.host.buckets;
    if (g) {
      // Buckets on screen are drawn whole, so the range covers them.
      const grouped = this.#groupedRange(...wholeBuckets(g, from, to), positiveOnly);
      if (grouped !== undefined) return grouped;
    }
    const [a, b] = this.align.range(from, to);
    if (a >= b) return null;
    const range = this.rangeBuilder.reset(positiveOnly);
    if (this.options.baseline != null) range.add(this.options.baseline);
    for (let k = a; k < b; k++) range.add(this.data[this.align.source[k]!]!.value);
    return range.range;
  }

  /**
   * The range over timeline indices `from` to `to` from the grouped levels, in
   * O(log n) buckets; undefined when a log scale needs the positive values the
   * levels do not keep apart (then scan the points).
   */
  #groupedRange(from: number, to: number, positiveOnly: boolean): [number, number] | null | undefined {
    const p = this.levels();
    const lo = p.extreme('low', 'min', from, to);
    if (lo === Infinity) return null;
    if (positiveOnly && !(lo > 0)) return undefined;
    const range = this.rangeBuilder.reset(positiveOnly);
    if (this.options.baseline != null) range.add(this.options.baseline);
    range.add(lo);
    range.add(p.extreme('high', 'max', from, to));
    return range.range;
  }

  /** Whether the line is stroked on the GPU: not opted out, and a shape the GPU path draws. */
  get #onGpu(): boolean {
    const o = this.options;
    return o.renderer !== 'canvas' && o.lineType !== 'curved' && !this.#colored;
  }

  override get drawsOnGpu(): boolean {
    return this.#onGpu;
  }

  /**
   * The positions on screen and how to read them: the points, or while the
   * view groups bars, each bucket's first, lowest, highest and last value at
   * its centre (gaps are NaN vertices).
   */
  #onScreen(env: PaneEnv) {
    const buckets = this.host.buckets;
    const o = this.options;
    const g = buckets ? this.#groupedLine().fill(this.levels(), buckets, env.from, env.to, o.breakGaps === true) : null;
    const [a, b] = g ? [0, g.length] : this.align.range(env.from - 1, env.to + 1);
    const index = g ? (k: number) => g.index[k]! : (k: number) => this.align.index[k]!;
    const value = g ? (k: number) => g.value[k]! : (k: number) => this.data[this.align.source[k]!]!.value;
    const shape: LineShape = { lineStyle: o.lineStyle, lineType: o.lineType, breakGaps: g ? false : o.breakGaps };
    return { a, b, index, value, shape, grouped: g !== null };
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    if (!this.host.buckets) this.#ungrouped();
    if (!this.#onGpu) {
      // Back on the canvas: let the vertex buffers go, and rebuild if the GPU path returns.
      if (this.#lineBatch.gpu || this.groupBatch.gpu) {
        this.host.releaseGpu?.(this.#lineBatch);
        this.host.releaseGpu?.(this.groupBatch);
      }
      this.#staleFrom(0);
      return;
    }
    const o = this.options;
    const scale = this.scale;
    const buckets = this.host.buckets;
    const shape: LineBuildShape = { step: o.lineType === 'step', breakGaps: o.breakGaps === true };
    let batch: LineBatch;
    let first: number;
    let end: number;
    /** Where the dash pattern starts: the last vertex of the first point on screen. */
    let origin: number;
    if (buckets) {
      // Grouped: each bucket's first, lowest, highest and last value at its centre, for the buckets on screen.
      const g = snapGroupedLine(this.#groupedLine().fill(this.levels(), buckets, env.from, env.to, shape.breakGaps), env, scale, o.area);
      batch = this.groupBatch;
      batch.build(g.length, (k) => g.index[k]!, (k) => g.value[k]!, { step: shape.step, breakGaps: false });
      [first, end] = batch.vertexRange(0, g.length);
      origin = batch.vertexOf(1) - 1;
    } else {
      batch = this.#lineBatch;
      const built = batch.shape;
      if (!built || built.step !== shape.step || built.breakGaps !== shape.breakGaps) this.#staleFrom(0);
      if (this.#lineStale < Infinity) {
        const align = this.align;
        batch.build(align.count, (k) => align.index[k]!, (k) => this.data[align.source[k]!]!.value, shape, this.#lineStale);
        this.#lineStale = Infinity;
      }
      const [a, b] = this.align.range(env.from - 1, env.to + 1);
      [first, end] = batch.vertexRange(a, b);
      origin = batch.vertexOf(a + 1) - 1;
    }
    const stroke = { lineWidth: o.lineWidth, lineStyle: o.lineStyle, step: shape.step };
    if (o.baseline === undefined) {
      const color = this.#colorFor(0);
      if (o.area) fillGpu(r, env, scale, batch, first, end, env.height, areaGradient(color));
      strokeGpu(r, env, scale, batch, first, end, origin, { ...stroke, color });
      return;
    }
    // On an inverted scale the prices above the base are the lower half.
    const above = o.aboveColor ?? this.host.theme.up;
    const below = o.belowColor ?? this.host.theme.down;
    const [top, bottom] = scale.invert ? [below, above] : [above, below];
    const y = scale.priceToY(o.baseline);
    if (o.area) {
      const [upper, lower] = baselineGradients(top, bottom);
      fillGpu(r, env, scale, batch, first, end, y, upper, { y, below: lower });
    }
    strokeGpu(r, env, scale, batch, first, end, origin, { ...stroke, color: top, split: { y, below: bottom } });
  }

  override draw2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const o = this.options;
    const gpu = this.#onGpu;
    if (gpu && o.baseline !== undefined) drawBaseLevel(ctx, env, this.scale.priceToY(o.baseline));
    if (!gpu || o.pointMarkers) this.#drawLine2D(ctx, env, gpu);
    if (pulseOn(o.lastPointPulse)) this.#drawPulse(ctx, env);
  }

  /** @internal */
  override get hasCrosshairMarker(): boolean {
    return !!this.options.crosshairMarker;
  }

  /** @internal */
  override drawCrosshair2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    if (this.options.crosshairMarker && env.crosshair !== undefined) this.drawCrosshairMarker(ctx, env, env.crosshair);
  }

  override stepOverlay(dt: number): boolean {
    return this.pulse?.step(this.options.lastPointPulse, dt, this.visible) ?? false;
  }

  /** The last-point pulse, when the newest point is in view. */
  #drawPulse(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const clock = this.pulseFor(this.options.lastPointPulse);
    const n = this.align.count;
    if (!clock || n === 0) return;
    const p = this.#pointAt(this.align.index[n - 1]!);
    if (!p) return;
    const x = env.time.indexToX(p.index);
    const y = this.scale.priceToY(p.value);
    if (!onScreen(x, y, env.width, env.height)) return;
    clock.draw(ctx, this.options.lastPointPulse, x, y, this.#colorAt(p.source, p.value), this.options.lineWidth);
  }

  /** The line on the canvas (unless `gpu` drew it), and its point markers. */
  #drawLine2D(ctx: CanvasRenderingContext2D, env: PaneEnv, gpu: boolean): void {
    const o = this.options;
    const { a, b, index, value, shape, grouped } = this.#onScreen(env);
    const scale = this.scale;
    if (!gpu && this.#colored) {
      this.#drawColored(ctx, env, a, b, index, value, shape, grouped);
    } else if (!gpu && o.baseline === undefined) {
      const color = this.#colorFor(0);
      const fill = o.area ? areaGradient(color) : undefined;
      drawPolyline(ctx, env, a, b, index, value, { ...shape, color, lineWidth: o.lineWidth, fill, scale });
    } else if (!gpu && o.baseline !== undefined) {
      drawBaseline(
        ctx, env, scale, a, b, index, value, o.baseline,
        o.aboveColor ?? this.host.theme.up, o.belowColor ?? this.host.theme.down, o.lineWidth, o.area, shape,
      );
    }
    if (o.pointMarkers && !grouped) this.#drawPointMarkers(ctx, env, a, b);
  }

  /** The line with its points' own colours, on the canvas. */
  #drawColored(
    ctx: CanvasRenderingContext2D,
    env: PaneEnv,
    a: number,
    b: number,
    index: (k: number) => number,
    value: (k: number) => number,
    shape: LineShape,
    grouped: boolean,
  ): void {
    const o = this.options;
    const scale = this.scale;
    const palette = this.#palette;
    palette.trim();
    const buckets = this.host.buckets;
    // A grouped vertex takes the colours of the last point in its bucket.
    const source =
      grouped && buckets
        ? (k: number) => this.align.sourceAtOrBefore(buckets.end(buckets.of(Math.floor(index(k)))) - 1)
        : (k: number) => this.align.source[k]!;
    const colors: PathColors = {
      line: (k) => palette.id(this.data[source(k)]?.color),
      fill: (k) => palette.id(this.data[source(k)]?.areaColor),
    };
    const time = env.time;
    const path = buildLinePath(scratchPath, a, b, index, value, (i) => time.indexToX(i), (v) => scale.priceToY(v), shape, colors);
    let split: ColoredLineStyle['split'];
    if (o.baseline !== undefined) {
      const above = o.aboveColor ?? this.host.theme.up;
      const below = o.belowColor ?? this.host.theme.down;
      // On an inverted scale the prices above the base are the lower half.
      const [top, bottom] = scale.invert ? [below, above] : [above, below];
      split = { y: scale.priceToY(o.baseline), top, bottom };
    }
    drawColoredLine(ctx, env, path, {
      palette: palette.colors,
      color: this.#colorFor(0),
      lineWidth: o.lineWidth,
      lineStyle: o.lineStyle,
      lineType: o.lineType,
      gradient: o.colorMode === 'gradient',
      area: o.area,
      split,
    });
    if (split) drawBaseLevel(ctx, env, split.y);
  }

  override dispose(): void {
    this.host.releaseGpu?.(this.#lineBatch);
    this.host.releaseGpu?.(this.groupBatch);
  }

  /** A dot per point, batched by colour, while bars are at least 2 radii plus a gap apart. */
  #drawPointMarkers(ctx: CanvasRenderingContext2D, env: PaneEnv, a: number, b: number): void {
    const o = this.options;
    const own = typeof o.pointMarkers === 'object' ? o.pointMarkers.radius : undefined;
    const r = markerRadius(own, clampLow(o.lineWidth + 1, 2, 4));
    if (env.time.barSpacing < 2 * r + 2) return;
    const scale = this.scale;
    let color = '';
    ctx.beginPath();
    for (let k = a; k < b; k++) {
      const v = this.data[this.align.source[k]!]!.value;
      const y = scale.priceToY(v);
      if (!Number.isFinite(y)) continue;
      const c = this.#colorAt(this.align.source[k]!, v);
      if (c !== color) {
        if (color) ctx.fill();
        ctx.fillStyle = color = c;
        ctx.beginPath();
      }
      const x = env.time.indexToX(this.align.index[k]!);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    if (color) ctx.fill();
  }

  /** A dot on the line at timeline `index`, ringed in the background colour so it stands out. */
  private drawCrosshairMarker(ctx: CanvasRenderingContext2D, env: PaneEnv, index: number): void {
    const p = this.#pointAt(index);
    if (!p) return;
    const y = this.scale.priceToY(p.value);
    if (!Number.isFinite(y)) return;
    const own = typeof this.options.crosshairMarker === 'object' ? this.options.crosshairMarker : {};
    const r = markerRadius(own.radius, 4);
    ctx.beginPath();
    ctx.arc(env.time.indexToX(p.index), y, r, 0, Math.PI * 2);
    ctx.fillStyle = own.color ?? this.#colorAt(p.source, p.value);
    ctx.fill();
    ctx.strokeStyle = env.theme.background;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * The point shown at timeline `index`: the series' own point, or while the
   * view groups bars, the last value of the bucket holding it, at its centre.
   */
  #pointAt(index: number): { index: number; value: number; source: number } | undefined {
    const g = this.host.buckets;
    if (!g) {
      const source = this.align.sourceAt(index);
      const p = this.data[source];
      return p && { index, value: p.value, source };
    }
    const levels = this.levels();
    const j = g.of(Math.floor(index));
    if (j < 0 || j >= levels.size(g) || levels.count(g, j) === 0) return undefined;
    const value = levels.get(g, j, 'last');
    const source = this.align.sourceAtOrBefore(g.end(j) - 1);
    return Number.isNaN(value) ? undefined : { index: bucketCenter(g, j), value, source };
  }

  override legend(index: number): LegendEntry {
    const p = this.#pointAt(index);
    return {
      title: this.options.title,
      parts: p ? [{ text: this.formatValue(p.value), color: this.#colorAt(p.source, p.value) }] : [],
    };
  }

  protected override labelValueAt(i: number): LastValue | null {
    const p = this.data[i];
    return p ? { value: p.value, text: this.formatValue(p.value), color: this.#colorAt(i, p.value) } : null;
  }

  override lastIndexAtOrBefore(index: number): number {
    return this.align.newestAtOrBefore(index, this.data.length);
  }
}

interface PolylineStyle extends LineShape {
  color: string;
  lineWidth: number;
  /** Gradient fill [top, bottom] under the line. */
  fill?: [string, string] | undefined;
  /** Fill down/up to this y (css px); defaults to pane bottom. */
  fillToY?: number;
  /** Price scale to project with; defaults to the pane scale. */
  scale?: PriceScale;
}

/**
 * Stroke a line over aligned positions [a, b), optionally filled below it.
 * When several points share a pixel column, only first/min/max/last are
 * emitted, so cost stays O(width). NaN values leave gaps, and the style's
 * `lineType`, `lineStyle` and `breakGaps` shape it (see `buildLinePath`).
 */
export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  valueAt: (k: number) => number,
  style: PolylineStyle,
): void {
  if (b - a < 1) return;
  const price = style.scale ?? env.pane.price;
  const time = env.time;
  const path = buildLinePath(scratchPath, a, b, indexAt, valueAt, (i) => time.indexToX(i), (v) => price.priceToY(v), style);
  if (path.length === 0) return;
  const curved = style.lineType === 'curved';
  if (style.fill) {
    const bottom = style.fillToY ?? env.height;
    ctx.save();
    ctx.beginPath();
    for (let r = 0; r < path.runCount; r++) {
      traceRun(ctx, path, r, curved);
      ctx.lineTo(path.x[path.end(r) - 1]!, bottom);
      ctx.lineTo(path.x[path.start(r)]!, bottom);
      ctx.closePath();
    }
    fillDown(ctx, env, ...style.fill);
    ctx.restore();
  }
  ctx.beginPath();
  for (let r = 0; r < path.runCount; r++) traceRun(ctx, path, r, curved);
  strokeLine(ctx, style.color, style.lineWidth, style.lineStyle, style.lineType === 'step' ? 'miter' : 'round');
}

/** Whether a point has its own line or fill colour. */
function hasPointColor(p: ValuePoint): boolean {
  return p.color !== undefined || p.areaColor !== undefined;
}

/** How `drawColoredLine` draws a path built with colour ids. */
export interface ColoredLineStyle {
  /** The colour of each id (index 0 unused). */
  palette: readonly string[];
  /** Colour of segments whose point has none. */
  color: string;
  lineWidth: number;
  lineStyle?: LineStyle | undefined;
  lineType?: LineType | undefined;
  /** Blend from one vertex's colour to the next one's, instead of a colour per segment. */
  gradient: boolean;
  /** Fill under the line. */
  area: boolean;
  /**
   * Baseline mode: segments without a colour switch from `top` to `bottom` at
   * `y` (css px), and fills reach to `y` instead of the pane bottom.
   */
  split?: { y: number; top: string; bottom: string } | undefined;
}

/**
 * Fill and stroke a path built with colour ids (see `buildLinePath`). Each
 * segment takes the colours of the vertex it starts at; neighbouring segments
 * of one colour are drawn together, so a line with few colour changes costs
 * about as much as a plain one. Dashes run on across colour changes.
 */
export function drawColoredLine(ctx: CanvasRenderingContext2D, env: PaneEnv, path: LinePath, style: ColoredLineStyle): void {
  if (!path.colored || path.length < 2) return;
  const line = path.color!;
  const fill = path.fill!;
  const { x, y } = path;
  const { palette, split } = style;
  const curved = style.lineType === 'curved';
  ctx.save();
  if (style.area) {
    const bottom = split ? split.y : env.height;
    // A fill key: its own fill colour (> 0), its line colour (< 0) or the series' (0).
    const key = (i: number) => (fill[i]! > 0 ? fill[i]! : -line[i]!);
    for (let r = 0; r < path.runCount; r++) {
      const end = path.end(r) - 1;
      for (let i = path.start(r); i < end; ) {
        const k = key(i);
        let j = i + 1;
        while (j < end && key(j) === k) j++;
        const from = i;
        const to = j;
        const trace = () => {
          traceSpan(ctx, path, from, to + 1, curved);
          ctx.lineTo(x[to]!, bottom);
          ctx.lineTo(x[from]!, bottom);
          ctx.closePath();
        };
        ctx.beginPath();
        trace();
        if (k > 0) fillDown(ctx, env, palette[k]!, withAlpha(palette[k]!, 0));
        else if (k < 0) fillDown(ctx, env, withAlpha(palette[-k]!, 0.28), withAlpha(palette[-k]!, 0));
        else if (!split) fillDown(ctx, env, withAlpha(style.color, 0.28), withAlpha(style.color, 0));
        else {
          // The halves of the baseline fill, as `drawBaseline` draws them.
          inHalf(ctx, env, 0, split.y, trace, () => fillDown(ctx, env, withAlpha(split.top, 0.28), withAlpha(split.top, 0.05)));
          inHalf(ctx, env, split.y, env.height, trace, () =>
            fillDown(ctx, env, withAlpha(split.bottom, 0.05), withAlpha(split.bottom, 0.28)),
          );
        }
        i = j;
      }
    }
  }
  const dash = lineDash(style.lineStyle, style.lineWidth);
  ctx.lineWidth = style.lineWidth;
  ctx.lineJoin = style.lineType === 'step' ? 'miter' : 'round';
  // Separate strokes meet at a vertex: round caps close the gap at a bend.
  ctx.lineCap = dash.length > 0 ? 'butt' : 'round';
  if (dash.length > 0) ctx.setLineDash(dash);
  // The colour of vertex `i` for blending; one without its own takes the series colour on its side of the base.
  const vertexColor = (i: number) =>
    line[i]! > 0 ? palette[line[i]!]! : split ? (y[i]! <= split.y ? split.top : split.bottom) : style.color;
  const blends = (i: number) => style.gradient && line[i] !== line[i + 1];
  for (let r = 0; r < path.runCount; r++) {
    const end = path.end(r) - 1;
    // Distance along the run, so the dash pattern runs on from stroke to stroke.
    let along = 0;
    for (let i = path.start(r); i < end; ) {
      let j = i + 1;
      if (!blends(i)) while (j < end && line[j] === line[i] && !blends(j)) j++;
      ctx.lineDashOffset = along;
      ctx.beginPath();
      traceSpan(ctx, path, i, j + 1, curved);
      if (blends(i)) {
        const c0 = vertexColor(i);
        const c1 = vertexColor(j);
        if (x[i] === x[j] && y[i] === y[j]) ctx.strokeStyle = c1;
        else {
          const grad = ctx.createLinearGradient(x[i]!, y[i]!, x[j]!, y[j]!);
          grad.addColorStop(0, c0);
          grad.addColorStop(1, c1);
          ctx.strokeStyle = grad;
        }
        ctx.stroke();
      } else if (line[i]! > 0) {
        ctx.strokeStyle = palette[line[i]!]!;
        ctx.stroke();
      } else if (!split) {
        ctx.strokeStyle = style.color;
        ctx.stroke();
      } else {
        const from = i;
        const to = j;
        const trace = () => traceSpan(ctx, path, from, to + 1, curved);
        inHalf(ctx, env, 0, split.y, trace, () => {
          ctx.strokeStyle = split.top;
          ctx.stroke();
        });
        inHalf(ctx, env, split.y, env.height, trace, () => {
          ctx.strokeStyle = split.bottom;
          ctx.stroke();
        });
      }
      for (let v = i; v < j; v++) along += Math.hypot(x[v + 1]! - x[v]!, y[v + 1]! - y[v]!);
      i = j;
    }
  }
  ctx.restore();
}

/** Fill the current path with a vertical gradient from `top` (pane top) to `bottom` (pane bottom). */
function fillDown(ctx: CanvasRenderingContext2D, env: PaneEnv, top: string, bottom: string): void {
  const grad = ctx.createLinearGradient(0, 0, 0, env.height);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fill();
}

/** Clip to the pane's rows from `y0` to `y1`, then `trace` a path and `draw` it (or let `trace` draw). */
function inHalf(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  y0: number,
  y1: number,
  trace: () => void,
  draw?: () => void,
): void {
  if (y1 <= y0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, env.width, y1 - y0);
  ctx.clip();
  ctx.beginPath();
  trace();
  draw?.();
  ctx.restore();
}

/** Stroke the current path in `color` with the dash of `lineStyle`, then reset the dash. */
function strokeLine(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  lineStyle: LineStyle | undefined,
  join: CanvasLineJoin,
): void {
  const dash = lineDash(lineStyle, lineWidth);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = join;
  if (dash.length > 0) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash.length > 0) ctx.setLineDash(NO_DASH);
}

const NO_DASH: number[] = [];

/** A marker radius option, or `fallback` when it is missing or not a positive number. */
function markerRadius(radius: number | undefined, fallback: number): number {
  return radius !== undefined && Number.isFinite(radius) && radius > 0 ? radius : fallback;
}

/** Line coloured/filled above and below a base price ("Baseline" style). */
export function drawBaseline(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  scale: PriceScale,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  valueAt: (k: number) => number,
  base: number,
  above: string,
  below: string,
  lineWidth: number,
  fill = true,
  shape: LineShape = {},
): void {
  const baseY = scale.priceToY(base);
  // On an inverted scale the prices above the base are the lower half.
  const [top, bottom] = scale.invert ? [below, above] : [above, below];
  const [upper, lower] = baselineGradients(top, bottom);
  const halves: [string, number, number, [string, string]][] = [
    [top, 0, baseY, upper],
    [bottom, baseY, env.height, lower],
  ];
  for (const [color, y0, y1, grad] of halves) {
    inHalf(ctx, env, y0, y1, () =>
      drawPolyline(ctx, env, a, b, indexAt, valueAt, { ...shape, color, lineWidth, fill: fill ? grad : undefined, fillToY: baseY, scale }),
    );
  }
  drawBaseLevel(ctx, env, baseY);
}

/** The dotted level a baseline line switches colour at, `y` css px down the pane. */
function drawBaseLevel(ctx: CanvasRenderingContext2D, env: PaneEnv, y: number): void {
  ctx.save();
  ctx.strokeStyle = withAlpha(env.theme.textMuted, 0.6);
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, sharp(y));
  ctx.lineTo(env.width, sharp(y));
  ctx.stroke();
  ctx.restore();
}

/** The fill under an area line, from the pane's top to its bottom. */
function areaGradient(color: string): [string, string] {
  return [withAlpha(color, 0.28), withAlpha(color, 0)];
}

/** A baseline's fills from the pane's top to its bottom: where the line is above the base, and below it. */
function baselineGradients(top: string, bottom: string): [upper: [string, string], lower: [string, string]] {
  return [
    [withAlpha(top, 0.28), withAlpha(top, 0.05)],
    [withAlpha(bottom, 0.05), withAlpha(bottom, 0.28)],
  ];
}

/** How `strokeGpu` strokes a line. */
export interface GpuStroke {
  color: string;
  lineWidth: number;
  lineStyle?: LineStyle | undefined;
  /** Mitred joins for step lines; round otherwise. */
  step?: boolean | undefined;
  /** Below this y (css px), stroke in `below` instead: baseline lines. */
  split?: { y: number; below: string } | undefined;
}

/**
 * Stroke vertices [first, end) of `batch` (see `LineBatch.vertexRange`) on the
 * GPU. Dashes follow the line's length on screen, which changes with the view,
 * so a dashed line is measured here, counting from vertex `origin`: the last
 * vertex of the first point the canvas path would start at, as a canvas dash
 * does.
 * @internal
 */
export function strokeGpu(
  r: RenderBackend,
  env: PaneEnv,
  scale: PriceScale,
  batch: LineBatch,
  first: number,
  end: number,
  origin: number,
  s: GpuStroke,
): void {
  const [on = 0, off = 0] = lineDash(s.lineStyle, s.lineWidth);
  if (on > 0) batch.measure(first - 1, origin, end + 1, (i) => env.time.indexToX(i), (v) => scale.priceToY(v), on + off);
  r.drawLine(batch, first, end, {
    ...yUniforms(scale, batch.base),
    x: batchX(env, batch),
    width: s.lineWidth,
    dash: [on, off],
    join: s.step ? 'miter' : 'round',
    color: unitColor(s.color),
    split: s.split && { y: s.split.y, below: unitColor(s.split.below) },
  });
}

/** The view's x transform for the indices stored in `batch`, which lag the timeline by its `indexShift`. */
function batchX(env: PaneEnv, batch: LineBatch): [number, number] {
  const [scale, offset] = env.time.xTransform();
  return [scale, offset + batch.indexShift * scale];
}

/**
 * Fill vertices [first, end) of `batch` on the GPU from the line to `to` (a y
 * in css px, or `'band'` for a batch built with `buildBand`), shaded down the
 * pane by `gradient`, and by `split.below` where the line is below `split.y`.
 * @internal
 */
export function fillGpu(
  r: RenderBackend,
  env: PaneEnv,
  scale: PriceScale,
  batch: LineBatch,
  first: number,
  end: number,
  to: number | 'band',
  gradient: [string, string],
  split?: { y: number; below: [string, string] },
): void {
  const unit = ([top, bottom]: [string, string]): FillGradient => [unitColor(top), unitColor(bottom)];
  r.drawFill(batch, first, end, {
    ...yUniforms(scale, batch.base),
    x: batchX(env, batch),
    to,
    gradient: unit(gradient),
    split: split && { y: split.y, below: unit(split.below) },
  });
}

/**
 * Put a grouped line's vertices where the canvas path draws them (see
 * `GroupedLine.snapColumns`): each bucket's range at its centre's css pixel
 * column, top first. Drawn at the centre instead, the GPU line's column
 * edges are soft where the canvas's are sharp. `filled` keeps the line
 * running left to right for a fill under it.
 * @internal
 */
export function snapGroupedLine(line: GroupedLine, env: PaneEnv, scale: PriceScale, filled = false): GroupedLine {
  line.snapColumns(env.time.xTransform(), !scale.invert, filled);
  return line;
}

/** Step line: horizontal to each bar, then vertical to its value. */
function drawStepLine(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  scale: PriceScale,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  valueAt: (k: number) => number,
  color: string,
  lineWidth: number,
  lineStyle: LineStyle | undefined,
): void {
  const half = env.time.barSpacing / 2;
  ctx.beginPath();
  let lastY = 0;
  for (let k = a; k < b; k++) {
    const x = env.time.indexToX(indexAt(k));
    const y = scale.priceToY(valueAt(k));
    if (k === a) ctx.moveTo(x - half, y);
    else {
      ctx.lineTo(x - half, lastY);
      ctx.lineTo(x - half, y);
    }
    lastY = y;
  }
  ctx.lineTo(env.time.indexToX(indexAt(b - 1)) + half, lastY);
  strokeLine(ctx, color, lineWidth, lineStyle, 'miter');
}

/**
 * Range band: a band from high to low split at the close, the upper part tinted
 * with `up` and the lower with `down`, edged by thin high/low lines, with the
 * close line on top.
 */
function drawRangeBand(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  scale: PriceScale,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  barAt: (k: number) => Bar,
  up: string,
  down: string,
  line: string,
  lineWidth: number,
  lineStyle: LineStyle | undefined,
): void {
  const band = hlcBandColumns(
    a,
    b,
    (k) => env.time.indexToX(indexAt(k)),
    (k) => scale.priceToY(barAt(k).high),
    (k) => scale.priceToY(barAt(k).close),
    (k) => scale.priceToY(barAt(k).low),
  );
  const { x } = band;
  // Polygon along `upper` left to right, then back along `lower`.
  const fill = (upper: number[], lower: number[], color: string) => {
    ctx.beginPath();
    ctx.moveTo(x[0]!, upper[0]!);
    for (let i = 1; i < x.length; i++) ctx.lineTo(x[i]!, upper[i]!);
    for (let i = x.length - 1; i >= 0; i--) ctx.lineTo(x[i]!, lower[i]!);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const edge = (ys: number[], color: string) => {
    ctx.beginPath();
    ctx.moveTo(x[0]!, ys[0]!);
    for (let i = 1; i < x.length; i++) ctx.lineTo(x[i]!, ys[i]!);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  fill(band.high, band.close, withAlpha(up, 0.2));
  fill(band.close, band.low, withAlpha(down, 0.2));
  edge(band.high, withAlpha(up, 0.55));
  edge(band.low, withAlpha(down, 0.55));
  drawPolyline(ctx, env, a, b, indexAt, (k) => barAt(k).close, { color: line, lineWidth, lineStyle, scale });
}

/** Columns from the pane bottom to each close, coloured by change vs previous close. */
function drawColumns(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  scale: PriceScale,
  a: number,
  b: number,
  indexAt: (k: number) => number,
  valueAt: (k: number) => number,
  up: string,
  down: string,
): void {
  const w = Math.max(1, Math.floor(env.time.barSpacing * 0.7));
  for (const rising of [true, false]) {
    ctx.fillStyle = withAlpha(rising ? up : down, 0.7);
    ctx.beginPath();
    for (let k = a; k < b; k++) {
      const v = valueAt(k);
      const prev = k > a ? valueAt(k - 1) : v;
      if (v >= prev !== rising) continue;
      const x = Math.round(env.time.indexToX(indexAt(k)) - w / 2);
      const y = Math.round(scale.priceToY(v));
      ctx.rect(x, y, w, env.height - y);
    }
    ctx.fill();
  }
}

/** Drop alpha so value labels stay readable when the series colour is translucent. */
export function opaque(color: string): string {
  const [r, g, b] = parseColor(color);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ------------------------------------------------------------------ */
/* Custom                                                              */
/* ------------------------------------------------------------------ */

/** A visible data item of a custom series and where it sits on the time axis. */
export interface CustomItem<D> {
  item: D;
  /** Timeline index (bar position). */
  index: number;
  /** Pane-local x in css px. */
  x: number;
}

/** What a custom series' `draw` hook gets. Sizes in css px, pane-local. */
export interface CustomSeriesView<D, O> {
  /** Visible items, plus one either side so shapes can run off the edges. */
  items: CustomItem<D>[];
  options: O;
  width: number;
  height: number;
  barSpacing: number;
  pixelRatio: number;
  theme: ChartTheme;
  priceToY(price: number): number;
  yToPrice(y: number): number;
  indexToX(index: number): number;
}

/** Options every custom series has, next to its own. */
export interface CustomSeriesBaseOptions<D extends { time: Time } = { time: Time }> extends PriceLineSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  /**
   * Derive the series from the main series: called with each main bar, the one
   * before it and the theme; return a point, or null for none. The chart keeps
   * it in step on loads, history pages, symbol switches, live bars and theme
   * changes. See `volumeOf`.
   */
  follow?: FollowMapper<D>;
  lastValueLabel: boolean;
  /** Show the series title (e.g. the symbol) in a tag beside the last-value label. */
  axisTitle?: boolean;
  format: (value: number) => string;
  /** Overrides `format`, and gives the pane its tick size and axis unit when no candle series is on it. */
  priceFormat?: PriceFormat;
  overlay?: OverlayMargins;
  /**
   * Price scale id in the pane (default `'right'`). `'left'` shows a left axis;
   * other ids are overlays until given a side. Ignored with `overlay`.
   */
  priceScale?: string;
}

/** Plugin contract for a user-defined chart type. Use with `chart.addCustomSeries`. */
export interface CustomSeriesDef<D extends { time: Time }, O extends object = object> {
  /** Id for debugging and saved layouts. */
  type: string;
  defaultOptions?: O;
  /** Price span of one item for autoscale, or null to ignore it. */
  priceRange(item: D, options: O): [number, number] | null;
  draw(ctx: CanvasRenderingContext2D, view: CustomSeriesView<D, O & CustomSeriesBaseOptions>): void;
  /** Legend values for the item under the crosshair (undefined when there is none). */
  legend?(item: D | undefined, options: O & CustomSeriesBaseOptions): LegendPart[];
  /** Value and color of the price-axis label for the newest item. */
  lastValue?(item: D, options: O & CustomSeriesBaseOptions): { value: number; color?: string } | null;
  /** Advance animations by `dt` ms; return true while still animating. */
  step?(dt: number, data: readonly D[], options: O & CustomSeriesBaseOptions): boolean;
  /**
   * One item standing for `items` (consecutive, oldest first) while the chart
   * groups bars (the `grouping` option); give it the first item's `time`.
   * Without it a group shows its last item.
   */
  group?(items: readonly D[], options: O & CustomSeriesBaseOptions): D;
}

/** A series drawn by a `CustomSeriesDef` plugin, with data of its own shape. Create it with `chart.addCustomSeries`. */
export class CustomSeries<D extends { time: Time }, O extends object = object> extends Series<O & CustomSeriesBaseOptions<D>> {
  readonly kind = 'custom';
  data: D[] = [];
  private align = new Alignment();
  /** Hooks whose last call threw; each is reported once until it succeeds again. */
  readonly #failing = new Set<CustomSeriesHook>();
  /** Grouped items of one level by bucket, made as buckets come into view: undefined not made yet, null empty. */
  #groupCache: { buckets: Buckets | null; items: (D | null | undefined)[] } = { buckets: null, items: [] };

  constructor(
    host: SeriesHost,
    pane: Pane,
    options: O & CustomSeriesBaseOptions<D>,
    readonly def: CustomSeriesDef<D, O>,
  ) {
    super(host, pane, options);
  }

  setData(items: D[], options: SetDataOptions = {}): void {
    if (options.normalize) {
      assertFiniteTimes(items, 'Custom series');
      items = dedupeByTime(items, (item) => this.host.seriesDropped?.(this, item, 'duplicate'));
    }
    assertAscending(items.map((d) => d.time), 'Custom series');
    this.data = items.slice();
    this.rebuild();
    this.host.requestRender();
  }

  /** Replace the last item (same time) or append a newer one. */
  update(item: D): void {
    assertTime(item.time, 'Custom series update');
    const last = this.data[this.data.length - 1];
    if (last && item.time < last.time) {
      this.host.seriesDropped?.(this, item, 'older');
      return;
    }
    if (last && item.time === last.time) {
      this.data[this.data.length - 1] = item;
      const k = this.align.count - 1;
      if (k >= 0 && this.align.source[k] === this.data.length - 1) this.#groupChanged(this.align.index[k]!);
    } else {
      this.data.push(item);
      this.appendAligned();
    }
    this.host.requestRender();
  }

  /** Custom series draw from the aligned data each frame, so appending only extends the alignment. */
  override appendAligned(): void {
    const start = this.align.extend(this.data.length, (i) => this.data[i]!.time, this.host.timeline);
    if (start < this.align.count) this.#groupChanged(this.align.index[start]!);
  }

  override prependAligned(bars: number): void {
    const front = this.front;
    this.front = NO_FRONT_CHANGE;
    const data = this.data;
    this.align.spliceFront(bars, front, data.length, (i) => data[i]!.time, this.host.timeline);
    this.#groupCache = { buckets: null, items: [] };
  }

  /** Items at timeline `index` and later changed: forget the grouped items from its bucket on. */
  #groupChanged(index: number): void {
    const cache = this.#groupCache;
    if (cache.buckets) cache.items.length = clampNum(cache.buckets.of(index), 0, cache.items.length);
  }

  /** The item standing for bucket `j` of `g` (see `group`), or null when the bucket is empty. */
  #groupedItem(g: Buckets, j: number): D | null {
    if (j < 0) return null;
    const cache = this.#groupCache;
    if (cache.buckets?.key !== g.key) this.#groupCache = { buckets: g, items: [] };
    const known = this.#groupCache.items[j];
    if (known !== undefined) return known;
    const [a, b] = this.align.range(g.start(j), g.end(j) - 1);
    let item: D | null = null;
    if (a < b) {
      const last = this.data[this.align.source[b - 1]!]!;
      const group = this.def.group;
      if (group && b - a > 1) {
        const items: D[] = [];
        for (let k = a; k < b; k++) items.push(this.data[this.align.source[k]!]!);
        item = this.#guard('group', last, () => group(items, this.options));
      } else {
        item = last;
      }
    }
    this.#groupCache.items[j] = item;
    return item;
  }

  override followMain(bars: readonly Bar[], kind: FollowKind, added = 0): void {
    const map = this.options.follow;
    if (!map) return;
    const what = `Custom series "${this.def.type}"`;
    const front = followBars(what, this.data, map, bars, kind, this.host.theme, () => true, (p) => this.update(p), () => {
      this.data.pop();
      this.align.dropSource(this.data.length);
      this.#groupCache = { buckets: null, items: [] };
      this.host.requestRender();
    }, added);
    if (front) this.front = front;
  }

  protected override refollow(): void {
    if (this.options.follow) this.followMain(this.host.mainBars ?? [], 'reset');
    else this.data = [];
  }

  rebuild(): void {
    this.front = NO_FRONT_CHANGE;
    this.align.build(this.data.map((d) => d.time), this.host.timeline);
    this.#groupCache = { buckets: null, items: [] };
  }

  override step(dt: number): boolean {
    const step = this.def.step;
    if (!step) return false;
    return this.#guard('step', false, () => step(dt, this.data, this.options));
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    // A throw leaves this series out of autoscale for the frame.
    return this.#guard('priceRange', null, () => {
      const range = this.rangeBuilder.reset(positiveOnly);
      const add = (item: D) => {
        const r = this.def.priceRange(item, this.options);
        if (!r) return;
        range.add(r[0]);
        range.add(r[1]);
      };
      const g = this.host.buckets;
      if (g) {
        // The grouped items drawn: O(buckets on screen).
        for (let j = Math.max(0, g.of(Math.floor(from))); j <= g.of(Math.floor(to)); j++) {
          const item = this.#groupedItem(g, j);
          if (item) add(item);
        }
        return range.range;
      }
      const [a, b] = this.align.range(from, to);
      for (let k = a; k < b; k++) add(this.data[this.align.source[k]!]!);
      return range.range;
    });
  }

  override draw2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const g = this.host.buckets;
    const items: CustomItem<D>[] = [];
    let w = 1;
    if (g) {
      // One item per bucket (see `group`), at the bucket's centre.
      const ja = Math.max(0, g.of(Math.floor(env.from)) - 1);
      const jb = g.of(Math.floor(env.to)) + 1;
      w = narrowestBucket(g, ja, jb);
      for (let j = ja; j <= jb; j++) {
        const item = this.#groupedItem(g, j);
        const index = bucketCenter(g, j);
        if (item) items.push({ item, index, x: env.time.indexToX(index) });
      }
    } else {
      const [a, b] = this.align.range(env.from - 1, env.to + 1);
      for (let k = a; k < b; k++) {
        const index = this.align.index[k]!;
        items.push({ item: this.data[this.align.source[k]!]!, index, x: env.time.indexToX(index) });
      }
    }
    const scale = this.scale;
    const view: CustomSeriesView<D, O & CustomSeriesBaseOptions> = {
      items,
      options: this.options,
      width: env.width,
      height: env.height,
      // Grouped: a bucket is as wide as its bars together.
      barSpacing: env.time.barSpacing * w,
      pixelRatio: env.dpr,
      theme: env.theme,
      priceToY: (price) => scale.priceToY(price),
      yToPrice: (y) => scale.yToPrice(y),
      indexToX: (index) => env.time.indexToX(index),
    };
    // A throw skips the series for this frame; the canvas state is unwound either way.
    this.#guard('draw', undefined, () => withBalancedState(ctx, () => this.def.draw(ctx, view)));
  }

  override legend(index: number): LegendEntry {
    const g = this.host.buckets;
    const item = g ? (this.#groupedItem(g, g.of(Math.floor(index))) ?? undefined) : this.data[this.align.sourceAt(index)];
    const legend = this.def.legend;
    const parts = legend ? this.#guard('legend', [], () => legend(item, this.options)) : [];
    return { title: this.options.title, parts };
  }

  override lastIndexAtOrBefore(index: number): number {
    return this.align.newestAtOrBefore(index, this.data.length);
  }

  protected override labelValueAt(i: number): LastValue | null {
    const item = this.data[i];
    const lastValue = this.def.lastValue;
    if (!item || !lastValue) return null;
    const last = this.#guard('lastValue', null, () => lastValue(item, this.options));
    if (!last) return null;
    const text = this.#guard('format', null, () => this.formatValue(last.value));
    if (text === null) return null;
    return { value: last.value, text, color: last.color ?? this.host.theme.line };
  }

  /** Call a user hook; on a throw, report it and return `fallback` so the frame carries on. */
  #guard<T>(hook: CustomSeriesHook, fallback: T, fn: () => T): T {
    try {
      const result = fn();
      this.#failing.delete(hook);
      return result;
    } catch (error) {
      if (!this.#failing.has(hook)) {
        this.#failing.add(hook);
        const event: SeriesErrorEvent = { series: this, hook, error };
        if (this.host.seriesError) this.host.seriesError(event);
        else console.error(`Custom series "${this.def.type}" ${hook} hook threw`, error);
      }
      return fallback;
    }
  }
}

/**
 * Run `fn` between a save and a restore of `ctx`, also undoing any `save()` it
 * leaves open (it threw halfway, or forgot) and ignoring `restore()` calls that
 * would pop state it did not save. Keeps the chart's own clip and transform intact.
 */
function withBalancedState(ctx: CanvasRenderingContext2D, fn: () => void): void {
  const save = ctx.save;
  const restore = ctx.restore;
  let depth = 0;
  ctx.save = () => {
    depth++;
    save.call(ctx);
  };
  ctx.restore = () => {
    if (depth === 0) return;
    depth--;
    restore.call(ctx);
  };
  save.call(ctx);
  try {
    fn();
  } finally {
    ctx.save = save;
    ctx.restore = restore;
    for (; depth > 0; depth--) restore.call(ctx);
    restore.call(ctx);
  }
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

/**
 * Options for a heatmap series (`chart.addHeatmap`): the colour ramp and value
 * range, cell gap and opacity, how cells combine when zoomed out, the hover
 * inspector and memory limits.
 */
export interface HeatmapSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  /** Color ramp low → high; defaults to theme.heatmap. */
  colors?: string[];
  /** Fixed value range; otherwise derived from percentiles of positive values. */
  range?: { min: number; max: number };
  lowPercentile: number;
  highPercentile: number;
  /** Gap between cells in css px (hidden when cells get too small). */
  gap: number;
  opacity: number;
  /**
   * How cells combine where several fall into one device pixel (zoomed out,
   * or many rows in a short pane): `'max'` (default) shows the largest, so a
   * thin level never vanishes as the view pans; `'sum'` their total;
   * `'nearest'` only the cell at the pixel centre. Rows are exact at any
   * depth (read from reduction levels, which `memoryBudget` pays for), columns
   * up to 8 per pixel; past that, evenly spaced columns are read (a sum is
   * scaled up to stand for the ones skipped).
   */
  cellReduce?: CellReduce;
  /** Show the hover inspector grid with neighbouring cell values. */
  inspector: boolean;
  format: (value: number) => string;
  /** Most columns kept; older ones are dropped. Default: as many as the budget and the GPU allow. */
  maxColumns?: number;
  /**
   * Bytes the grid may use, counting 8 per cell (GPU texture plus CPU copy),
   * plus about a third more for the reduction levels unless `cellReduce` is
   * `'nearest'`. Lowers the column cap for tall grids. Default 256 MiB.
   */
  memoryBudget?: number;
}

/** One heatmap cell, as `cellAt` returns it: its column and row in the grid, its value and its price. */
export interface HeatmapCell {
  col: number;
  row: number;
  value: number;
  price: number;
}

/** Shortest time between automatic colour range recomputations while live columns arrive. */
const RANGE_THROTTLE_MS = 250;

/** A time × price grid of values coloured along a ramp, such as order book depth over time. Create it with `chart.addHeatmap`. */
export class HeatmapSeries extends Series<HeatmapSeriesOptions> {
  readonly kind = 'heatmap';
  readonly grid = new HeatmapGrid();
  private firstTime: Time | null = null;
  #lastTime: Time | null = null;
  private firstIndex = -1;
  #autoRange = { min: 0, max: 1 };
  /** Data or options were replaced: the automatic colour range is recomputed when next read. */
  #rangeDirty = true;
  /** Live columns changed: the range is recomputed when read, at most once per `RANGE_THROTTLE_MS`. */
  #rangeStale = false;
  /** `Date.now()` of the last range computation. */
  #rangeAt = 0;
  /** Pending frame request that shows a range held back by the throttle. */
  #rangeTimer: ReturnType<typeof setTimeout> | null = null;
  private lut: Uint8Array = new Uint8Array(4);
  /** Colour stops `lut` was built from, so it is rebuilt (and re-uploaded) only when they change. */
  #lutKey: string | null = null;

  constructor(host: SeriesHost, pane: Pane, options: HeatmapSeriesOptions) {
    checkHeatmapOptions(options);
    super(host, pane, options);
  }

  override applyOptions(partial: Partial<HeatmapSeriesOptions>): void {
    checkHeatmapOptions({ ...this.options, ...partial });
    this.#rangeDirty = true;
    super.applyOptions(partial);
  }

  setData(data: HeatmapData): void {
    if (data.rows > this.host.maxTextureSize) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Heatmap rows (${data.rows}) exceed GPU texture limit ${this.host.maxTextureSize}` : '');
    }
    assertAscending(data.times, 'Heatmap');
    // The newest columns that fit are kept.
    this.grid.maxColumns = this.#columnLimit(data.rows);
    let { times, values } = data;
    const overflow = times.length - this.grid.maxColumns;
    if (overflow > 0) {
      times = times.slice(overflow);
      values = values.subarray(overflow * data.rows);
    }
    this.grid.reduce = this.#cellReduce;
    this.grid.reset(data.rows, data.priceStart, data.priceStep, times.length, values);
    this.firstTime = times[0] ?? null;
    this.#lastTime = times[times.length - 1] ?? null;
    this.#rangeDirty = true;
    this.rebuild();
    this.host.requestRender();
  }

  /** Replace the last column (same time) or append the next bar's column; an older column is dropped and reported. */
  updateColumn(time: Time, column: Float32Array): void {
    assertTime(time, 'Heatmap update');
    if (this.#lastTime === null) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap updateColumn before setData' : '');
    if (time < this.#lastTime) {
      this.host.seriesDropped?.(this, { time, column }, 'older');
      return;
    }
    // Checked before a cap trim, so a bad column leaves the grid untouched.
    if (column.length !== this.grid.rows) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Heatmap column must have ${this.grid.rows} rows` : '');
    if (time === this.#lastTime) {
      this.grid.setColumn(this.grid.cols - 1, column);
      this.#rangeStale = true;
    } else {
      if (this.grid.cols >= this.grid.maxColumns) {
        const drop = Math.max(1, Math.floor(this.grid.maxColumns / 8));
        this.grid.dropFront(drop);
        this.#droppedFront(drop);
      }
      this.grid.setColumn(this.grid.cols, column);
      this.#lastTime = time;
      this.#rangeStale = true;
    }
    this.rebuild();
    this.host.requestRender();
  }

  rebuild(): void {
    // A lowered `maxColumns` or `memoryBudget` trims the oldest columns at once.
    if (this.grid.rows > 0) {
      const limit = this.#columnLimit(this.grid.rows);
      if (limit !== this.grid.maxColumns) this.#droppedFront(this.grid.setMaxColumns(limit));
    }
    this.grid.setReduce(this.#cellReduce);
    const stops = this.options.colors ?? this.host.theme.heatmap;
    const key = stops.join('|');
    if (key !== this.#lutKey) {
      this.lut = buildLut(stops);
      this.#lutKey = key;
    }
    this.firstIndex = this.firstTime === null ? -1 : this.host.timeline.indexOf(this.firstTime);
  }

  get #cellReduce(): CellReduce {
    return this.options.cellReduce ?? 'max';
  }

  /** Columns a grid of `rows` may keep under the GPU limit, `maxColumns` and `memoryBudget`. */
  #columnLimit(rows: number): number {
    const o = this.options;
    return heatmapColumnLimit(rows, this.host.maxTextureSize, o.maxColumns, o.memoryBudget, this.#cellReduce);
  }

  /** The grid dropped its `count` oldest columns: the first column moves on. */
  #droppedFront(count: number): void {
    if (count <= 0 || this.firstTime === null) return;
    this.firstTime = this.host.timeline.timeFromIndex(this.host.timeline.indexFromTime(this.firstTime) + count);
    this.#rangeStale = true;
  }

  private refreshRange(): void {
    const g = this.grid;
    this.#autoRange = percentileRange(g.values, g.cols * g.rows, this.options.lowPercentile, this.options.highPercentile);
    this.#rangeDirty = false;
    this.#rangeStale = false;
    this.#rangeAt = Date.now();
    this.#cancelRangeFrame();
  }

  /**
   * The colour range: the `range` option, else percentiles of the values,
   * recomputed only when read after a change. Live column changes recompute it
   * at most once per `RANGE_THROTTLE_MS`; a frame is requested when the wait ends.
   */
  get range(): { min: number; max: number } {
    if (this.options.range) return this.options.range;
    if (this.#rangeDirty) {
      this.refreshRange();
    } else if (this.#rangeStale) {
      const wait = this.#rangeAt + RANGE_THROTTLE_MS - Date.now();
      // A clock that went backwards recomputes rather than waiting.
      if (wait <= 0 || wait > RANGE_THROTTLE_MS) {
        this.refreshRange();
      } else {
        this.#rangeTimer ??= setTimeout(() => {
          this.#rangeTimer = null;
          this.host.requestRender();
        }, wait);
      }
    }
    return this.#autoRange;
  }

  #cancelRangeFrame(): void {
    if (this.#rangeTimer === null) return;
    clearTimeout(this.#rangeTimer);
    this.#rangeTimer = null;
  }

  /** Free this series' GPU objects; it is leaving the chart. */
  override dispose(): void {
    this.#cancelRangeFrame();
    this.host.releaseGpu?.(this.grid);
  }

  override get drawsOnGpu(): boolean {
    return true;
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    if (this.firstIndex < 0) return;
    const { min, max } = this.range;
    r.drawHeatmap(this.grid, {
      x: env.time.xTransform(),
      ...yUniforms(this.scale, this.grid.priceStart),
      firstIndex: this.firstIndex,
      min,
      max,
      gap: this.options.gap * env.dpr,
      opacity: this.options.opacity,
      // One read per pixel in low-power mode, instead of up to 64 for a zoomed-out grid.
      reduce: this.host.lowPower ? 'nearest' : this.#cellReduce,
      lut: this.lut,
    });
  }

  /** Cell under a logical index / price, or null. */
  cellAt(index: number, price: number): HeatmapCell | null {
    if (this.firstIndex < 0) return null;
    const col = Math.round(index) - this.firstIndex;
    const row = this.grid.rowOfPrice(price);
    const value = this.grid.valueAt(col, row);
    if (value === undefined) return null;
    return { col, row, value, price: this.priceOfRow(row) };
  }

  priceOfRow(row: number): number {
    return this.grid.priceStart + row * this.grid.priceStep;
  }

  valueAt(col: number, row: number): number | undefined {
    return this.grid.valueAt(col, row);
  }

  override legend(): LegendEntry {
    return { title: this.options.title, parts: [] };
  }
}

/** Throw on a `maxColumns` that is not a positive integer or a `memoryBudget` that is not a positive number. */
function checkHeatmapOptions(o: HeatmapSeriesOptions): void {
  if (o.maxColumns !== undefined && !(Number.isInteger(o.maxColumns) && o.maxColumns > 0)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap maxColumns must be a positive integer' : '');
  }
  if (o.memoryBudget !== undefined && !(Number.isFinite(o.memoryBudget) && o.memoryBudget > 0)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Heatmap memoryBudget must be a positive number of bytes' : '');
  }
}

/** The default `format` of line, histogram and custom series: follow the pane scale (see `formatValue`). */
export const defaultFormat = (value: number): string => formatCompact(value);

/**
 * The price format of a scale (default: the pane's right scale): the first
 * candle series on it, else the first series on it with a `priceFormat`.
 * Overlay series have their own scale and are skipped. Null when none applies.
 */
export function scaleFormat(series: readonly Series[], scale?: PriceScale): PriceFormatModel | null {
  const onScale = series.filter((s) => !s.overlayScale && s.scale === (scale ?? s.pane.price));
  const candles = onScale.find((s): s is CandleSeries => s instanceof CandleSeries);
  if (candles) return candles.formatModel;
  for (const s of onScale) if (s.priceFormat) return s.priceFormat;
  return null;
}
