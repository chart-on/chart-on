import type { ChartTheme } from '../theme';
import { fillLine, fillText, fontCss, resolveFont, type ResolvedFont } from '../typography';
import type { Pane } from '../pane';
import type { PriceScale, TimeScale } from '../scales';
import { CandleSeries, HistogramSeries, LineSeries, type Series } from '../series';
import { lowerBound, type Timeline } from '../timeline';
import type { Primitive } from '../primitives';
import type { Point, Time } from '../types';
import type { SourceMarker } from '../data/types';
import { contrastText } from '../util/color';
import { MarkerPool, barIndexOf, checkMarker, drawMarker, foldMarkers, markerAt, markerColor, placeMarkers, type MarkerBox, type MarkerLayoutEnv } from './markers';
import type { Trade, TradeGroup, TradeMarkerOptions, TradePointerEvent } from './trades';
import type { TradeFills } from './fills';
import type { TradingLines } from './trading-lines';
import { notInstalled } from '../registry';
import { PriceLine, hLine, type AlertLine, type DraftLine, type LineOwner, type TradeLine } from './lines';
import {
  ZoneLayer,
  type PriceZone,
  type PriceZoneOptions,
  type TextLabel,
  type TextLabelOptions,
  type TimeBand,
  type TimeBandOptions,
  zoneFactor,
} from './zones';
import type {
  AlertLineOptions,
  AnnotationOptions,
  BarMarker,
  ClusterClickEvent,
  CrossDirection,
  DraftEditEvent,
  DraftLineOptions,
  LineInteractionOptions,
  MarkerClusterOptions,
  MarkerFilter,
  MarkerLeaveEvent,
  MarkerPointerEvent,
  OrderCreateEvent,
  PriceLineOptions,
  TradeLineOptions,
  TradeLinePart,
} from './types';
import { SET_SOURCE_MARKS, SET_TIME_MARKS } from './types';
import { clampLow } from '../util/math';
import type { PaneButtonsSpace } from '../pane-controls';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What the annotation layer needs from its chart. */
export interface AnnotationHost {
  readonly theme: ChartTheme;
  readonly timeline: Timeline;
  readonly time: TimeScale;
  readonly panes: readonly Pane[];
  /** Left edge of the plot in chart-root css px; pointer events report root-relative points. */
  readonly plotLeft: number;
  /** The main candle series: default target of markers and lines. */
  readonly main: Series | null;
  formatPrice(pane: number, price: number): string;
  /** Axis text for a price on a pane scale (percent change in percent mode); default the right scale. */
  formatAxis(pane: number, price: number, scaleId?: string): string;
  /** Width of `text` in `font`, default the labels font. */
  measureText(text: string, font?: ResolvedFont): number;
  /** Label on the axis of `scale` (in `pane`), centred on chart-space `y`. */
  axisLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    y: number,
    background: string,
    color: string,
    at: { pane: Pane; scale: PriceScale },
  ): void;
  requestOverlay(): void;
  /** Redraw every layer, for time bands and price zones drawn below the series. Default: `requestOverlay`. */
  requestRedraw?(): void;
  /**
   * Attach a plot primitive to `series` (its pane and scale), or to the main
   * pane when null. Returns the detach function.
   */
  attachPrimitive(primitive: Primitive, series: Series | null): () => void;
  /** The pointer entered a trade marker, or tapped it on touch. */
  tradeHover?(e: TradePointerEvent): void;
  tradeHoverEnd?(): void;
  /** A trade marker was clicked or tapped. Markers take presses only while this has listeners. */
  tradeClick?(e: TradePointerEvent): void;
  listensToTradeClicks?(): boolean;
  /** The pointer entered a bar marker, or tapped it on touch. */
  markerHover?(e: MarkerPointerEvent): void;
  markerHoverEnd?(e: MarkerLeaveEvent): void;
  /** A bar marker was clicked or tapped. Markers take presses only while this has listeners. */
  markerClick?(e: MarkerPointerEvent): void;
  listensToMarkerClicks?(): boolean;
  /**
   * A data source marker (`SET_SOURCE_MARKS`, `SET_TIME_MARKS`) was clicked
   * or tapped: the ids of the marker, or of the markers folded into it or its
   * badge, at chart-root `point`. They take presses only while this has
   * listeners; they emit no marker events.
   */
  markClick?(ids: string[], point: Point): void;
  listensToMarkClicks?(): boolean;
  /** Top and height (chart space) of the band under the time labels that time-axis markers draw in; null when there is none. */
  timeMarkBand?(): { top: number; height: number } | null;
  /** Height the pane buttons take at the top of each pane, and their side; null when there are none. */
  paneButtons?(): PaneButtonsSpace | null;
  /** Bar interval of the data source in seconds, when known. */
  barInterval?(): number | null;
  /**
   * What prices the app placed at `time` in `pane` draw multiplied by under
   * the chart's adjustment mode (1 by default). Applied to annotations pinned
   * to a bar: `atPrice` markers, fills, text labels and zones ending at a bar.
   */
  priceFactor?(pane: Pane, time: Time): number;
  /** A cluster's summary label was clicked, after `onClusterClick`; the chart re-emits it for the UI. */
  clusterClick?(e: ClusterClickEvent): void;
  /** A draft's quantity or type segment was clicked; the chart re-emits it for the UI. */
  draftEdit?(e: DraftEditEvent): void;
  /** A draft was committed. */
  orderCreate?(e: OrderCreateEvent): void;
}

/** Fills, order lines and position lines to apply together with `syncTrades`. */
export interface TradeSync {
  /** Fills that replace those of `source`. */
  trades?: readonly Trade[];
  source?: string;
  /** Replace every order line with these (each `kind: 'order'`). */
  orders?: readonly (Partial<TradeLineOptions> & Pick<TradeLineOptions, 'price' | 'side'>)[];
  /** Replace every position line with these (each `kind: 'position'`). */
  positions?: readonly (Partial<TradeLineOptions> & Pick<TradeLineOptions, 'price' | 'side'>)[];
}

/** An alert line the price passed, from `alertsCrossed`. */
export interface AlertCrossing {
  line: AlertLine;
  direction: CrossDirection;
}

/** Where a line is drawn: its series' scale, or the main pane's when it has no series. */
export interface Target {
  series: Series | null;
  pane: Pane;
  paneIndex: number;
  scale: PriceScale;
}

/** A price line under the pointer, or pressed at `start`. */
interface Hit {
  line: PriceLine;
  start: Point;
  slop: number;
}

/** Smallest hit radius (css px) of a time-axis badge: a 24 px target. */
const TIME_MARK_HIT = 12;
/** Smallest font size (css px) of a badge's text; below it the text is left out. */
const TIME_MARK_MIN_FONT = 9;

/** A time-axis badge as last drawn, in plot space: the marks folded into it, by time. */
interface TimeBadge {
  x: number;
  y: number;
  r: number;
  marks: SourceMarker[];
}

/** Key of the data source's marks, drawn on the main series in a set apps cannot replace. */
const MARKS: unique symbol = Symbol('marks');

/** Tags of the sets apart from the app's: indicators' shape plots and the chart's event markers. */
const PLOTS: unique symbol = Symbol('plots');
const EVENTS: unique symbol = Symbol('events');

/** The set a marker is in: the app's set of a series (null for the main one), or one of the chart's own. */
type MarkerKey = Series | null | typeof MARKS | typeof PLOTS | typeof EVENTS;

interface MarkerSet {
  markers: BarMarker[];
  /** The markers as laid out (filtered, crowded bars folded) and their times; null when stale. */
  shown: BarMarker[] | null;
  times: number[];
  /** Timeline state the folding was bucketed against: its times, length and interval. */
  bucket: [readonly number[], number, number] | null;
}

/** @internal Pointer distance (css px) that still grabs a line. */
export const HIT = 6;
/** @internal Gap between a line's label and the price axis. */
export const BLOCK_INSET = 8;
/** Pointer travel (css px) after which a press is a drag, not a click: mouse and pen, then touch. */
const CLICK_SLOP = 4;
const CLICK_SLOP_TOUCH = 8;

/**
 * @internal A kind of annotation a plugin adds to the manager (`addLayer`),
 * e.g. the `trading()` plugin's order lines and fill markers. Layers marked
 * `above` take the pointer first, then price lines, then the other layers
 * in the order they were added, then bar markers.
 */
export interface AnnotationLayer {
  /** Takes the pointer before price lines and draws over them. */
  readonly above?: boolean;
  /** Plot-area drawing on `pane`, clipped to it: over bar markers, and over price lines when `above`. */
  render?(ctx: CanvasRenderingContext2D, pane: Pane): void;
  /** Unclipped drawing after the axes, e.g. axis labels and a tooltip. */
  renderLabels?(ctx: CanvasRenderingContext2D): void;
  /** A press no earlier layer or line took; true when the layer takes it. */
  pointerDown?(p: Point, slop: number): boolean;
  /** The pointer moved; true while the layer has a press, which then takes the move (a drag). */
  move?(p: Point): boolean;
  /** Pointer moved with no press; `over` is false when something before it is under the pointer. */
  hover?(p: Point | null, over: boolean): void;
  /** True when the layer had the press. */
  pointerUp?(p: Point): boolean;
  /** Drop a press; true when there was one. */
  cancel?(): boolean;
  /** A key no press took (Escape with no press); true when handled. */
  keyDown?(e: KeyboardEvent): boolean;
  /** The cursor over the layer, or undefined when `p` is not over it. */
  cursor?(p: Point): string | null | undefined;
  readonly hovering?: boolean;
  /** True while the layer has a press. */
  readonly busy?: boolean;
  /** Label clustering (`overlap`, `cluster`) changed: restart cluster hysteresis. */
  clusterChanged?(): void;
  /** The chart's main series changed. */
  mainChanged?(): void;
  /** Remove everything (`annotations.clear()`). */
  clear?(): void;
}

/** @internal What the manager gives a layer. */
export interface AnnotationLayerHost {
  readonly host: AnnotationHost;
  /** Where the main series draws, or null without one. */
  main(): Target | null;
  /** Where `series` draws (default the main series), or null when it is gone or hidden. */
  target(series: Series | undefined | null): Target | null;
  options(): Readonly<AnnotationOptions>;
  priceFactor(pane: Pane, time: Time): number;
  format(t: Target): (price: number) => string;
  /** Price-axis text for `price` on `t`'s scale. */
  axisText(t: Target, price: number): string;
  /** Draw `rows` in a tooltip box next to `p`. */
  tooltip(ctx: CanvasRenderingContext2D, rows: readonly string[], p: Point): void;
}

/** Default values for `AnnotationOptions`: overlapping order labels are not clustered, and neither are bar markers. */
export const defaultAnnotationOptions: Readonly<AnnotationOptions> = {
  overlap: 'none',
  cluster: { mergeGapPx: 0, splitGapPx: 6, minLines: 2 },
  markerCluster: { enabled: false, maxPerBar: 1 },
};

/**
 * Programmatic annotations: bar markers, price lines, time bands, price zones
 * and text labels. Order, position, alert and draft lines and trade fills come
 * from the `trading()` plugin's layers. Separate from user drawings: never
 * serialized, never on the drawing undo stack. Coordinates are chart-space
 * css px (plot-relative x); points handed to callbacks are chart-root css px.
 */
export class AnnotationManager {
  #markerSets = new Map<Series | null, MarkerSet>();
  /** Indicator shape plots' markers, by the indicator's series; kept apart from the app's sets. */
  #plotSets = new Map<Series, MarkerSet>();
  /** The chart's own event markers on the main series (corporate actions); kept apart from the app's sets. */
  #eventSet: MarkerSet | null = null;
  /** The data source's marks on the main series; kept apart from the app's sets. */
  #sourceSet: MarkerSet | null = null;
  /** The data source's time-axis marks, by time; their badges as last drawn; the hovered one and a press on one. */
  #timeMarks: readonly SourceMarker[] = [];
  private timeBadges: TimeBadge[] = [];
  private timeHover: TimeBadge | null = null;
  #timePoint: Point | null = null;
  #timePress: { ids: string[]; start: Point; slop: number } | null = null;
  #prices: PriceLine[] = [];
  /** A press on a price line with `onClick`. */
  #gesture: Hit | null = null;
  #hover: Hit | null = null;
  /** Layers plugins added, by name, in the order they were added. */
  private readonly layers = new Map<string, AnnotationLayer>();
  /** Pointer position of the last hover, for line tooltips. */
  #hoverPoint: Point | null = null;
  /** Bar marker boxes of the last layout, reused between frames. */
  private readonly markerPool = new MarkerPool();
  /** Series and pane of the marker set being laid out, read by `markerEnv`. */
  #layoutSeries: Series | null = null;
  /** Series whose bar range `above` and `below` markers of that set sit against. */
  #rangeSeries: Series | null = null;
  #layoutPane: Pane | null = null;
  /** The set being laid out is the app's: its `atPrice` prices are the data source's, so they follow an adjustment mode. */
  #layoutAdjusted = false;
  readonly #markerEnv: MarkerLayoutEnv;
  /** Text widths of marker texts, in the font `textFont` (CSS) as of the last layout. */
  #textWidths = new Map<string, number>();
  #textFont = '';
  #markerFont: ResolvedFont | null = null;
  /** The hovered bar marker (the stored object) and the series of its set. */
  #markerHover: BarMarker | null = null;
  #markerHoverSeries: Series | null = null;
  /** The set holding the hovered marker. */
  #markerHoverKey: MarkerKey | undefined = undefined;
  #markerPoint: Point | null = null;
  #markerPress: { marker: BarMarker; series: Series; key: MarkerKey; start: Point; slop: number } | null = null;
  #filter: MarkerFilter = {};
  /** Members of each folded marker. */
  readonly #members = new WeakMap<BarMarker, BarMarker[]>();
  readonly #iconReady = () => this.#host.requestOverlay();
  #opts: AnnotationOptions = {
    ...defaultAnnotationOptions,
    cluster: { ...defaultAnnotationOptions.cluster },
    markerCluster: { ...defaultAnnotationOptions.markerCluster },
  };
  readonly #owner: LineOwner = {
    changed: () => this.#host.requestOverlay(),
    remove: (line) => this.#detach(line),
  };

  readonly #zoneLayer: ZoneLayer;

  readonly #host: AnnotationHost;

  constructor(host: AnnotationHost) {
    this.#host = host;
    this.#zoneLayer = new ZoneLayer({
      get theme() {
        return host.theme;
      },
      get timeline() {
        return host.timeline;
      },
      get main() {
        return host.main;
      },
      attachPrimitive: (primitive, series) => host.attachPrimitive(primitive, series),
      requestRedraw: () => (host.requestRedraw ? host.requestRedraw() : host.requestOverlay()),
      priceFactor: (series, time) => {
        const t = this.target(series);
        return t ? this.priceFactor(t.pane, time) : 1;
      },
    });
    // One env for every frame; the set being laid out is read from fields, so layout allocates no closures.
    this.#markerEnv = {
      timeline: host.timeline,
      rangeAt: (index) => this.#rangeSeries!.priceRange(index, index),
      priceToY: (price) => this.#layoutPane!.top + this.#layoutSeries!.scale.priceToY(price),
      priceFactor: (time) => (this.#layoutAdjusted ? this.priceFactor(this.#layoutPane!, time) : 1),
      top: 0,
      bottom: 0,
      indexToX: (index) => host.time.indexToX(index),
      barSpacing: 0,
      fontSize: 0,
      measureText: (text) => this.#markerTextWidth(text),
    };
  }

  /** Layer options: label and marker clustering. Fields left out keep their value. */
  applyOptions(
    patch: Partial<Omit<AnnotationOptions, 'cluster' | 'markerCluster'>> & {
      cluster?: Partial<AnnotationOptions['cluster']>;
      markerCluster?: Partial<MarkerClusterOptions>;
    },
  ): void {
    const before = this.#opts;
    const cluster = { ...before.cluster, ...patch.cluster };
    const markerCluster = { ...before.markerCluster, ...patch.markerCluster };
    this.#opts = { ...before, ...patch, cluster, markerCluster };
    if (markerCluster.enabled !== before.markerCluster.enabled || markerCluster.maxPerBar !== before.markerCluster.maxPerBar) this.#refold();
    // Restart cluster hysteresis only when the folding itself changed, not e.g. `onClusterClick`.
    const keys = Object.keys(cluster) as (keyof typeof cluster)[];
    if (this.#opts.overlap !== before.overlap || keys.some((k) => cluster[k] !== before.cluster[k])) {
      for (const layer of this.layers.values()) layer.clusterChanged?.();
    }
    this.#host.requestOverlay();
  }

  get options(): Readonly<AnnotationOptions> {
    return this.#opts;
  }

  /* ------------------------------ markers ------------------------------ */

  /**
   * Replace the markers of `series` (default: the main series). Throws,
   * changing nothing, on an invalid marker or an id that appears twice.
   */
  setMarkers(markers: readonly BarMarker[], series?: Series): void {
    const ids = new Set<string>();
    for (const m of markers) {
      checkMarker(m);
      if (m.id === undefined) continue;
      if (ids.has(m.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Duplicate marker id "${m.id}"` : '');
      ids.add(m.id);
    }
    // Stable sort keeps the caller's order within a bar, which is the stacking order.
    const sorted = markers.map(copyMarker).sort((a, b) => a.time - b.time);
    const key = this.#markerKey(series);
    if (sorted.length === 0) this.#markerSets.delete(key);
    else this.#markerSets.set(key, { markers: sorted, shown: null, times: [], bucket: null });
    this.#rebindMarkers(key, sorted);
    this.#host.requestOverlay();
  }

  getMarkers(series?: Series): BarMarker[] {
    return (this.#markerSets.get(this.#markerKey(series))?.markers ?? []).map(copyMarker);
  }

  /**
   * Change the marker with `id` in the set of `series` (default: the main
   * series), keeping the rest. Returns false when there is no such marker.
   * Throws, changing nothing, when the result is invalid.
   */
  updateMarker(id: string, patch: Partial<Omit<BarMarker, 'id'>>, series?: Series): boolean {
    const set = this.#markerSets.get(this.#markerKey(series));
    const m = set?.markers.find((x) => x.id === id);
    if (!set || !m) return false;
    const next = copyMarker({ ...m, ...patch, id });
    // A field patched to undefined is cleared.
    for (const k of Object.keys(next) as (keyof BarMarker)[]) if (next[k] === undefined) delete next[k];
    checkMarker(next);
    // Change the stored object in place, so a hover or press on it carries on.
    for (const k of Object.keys(m) as (keyof BarMarker)[]) if (!(k in next)) delete m[k];
    Object.assign(m, next);
    if (patch.time !== undefined) set.markers.sort((a, b) => a.time - b.time);
    set.shown = null;
    this.#host.requestOverlay();
    return true;
  }

  /** Remove the marker with `id` from the set of `series` (default: the main series). Returns false when there is none. */
  removeMarker(id: string, series?: Series): boolean {
    const key = this.#markerKey(series);
    const set = this.#markerSets.get(key);
    const i = set?.markers.findIndex((x) => x.id === id) ?? -1;
    if (!set || i < 0) return false;
    set.markers.splice(i, 1);
    set.shown = null;
    if (set.markers.length === 0) this.#markerSets.delete(key);
    this.#rebindMarkers(key, set.markers);
    this.#host.requestOverlay();
    return true;
  }

  /**
   * @internal The markers of an indicator's shape plots, oldest first; empty
   * removes them. They are laid out, filtered and folded like the app's sets
   * but stay out of `getMarkers`. `markers` is the caller's: it passes it
   * again after every change.
   */
  setPlotMarkers(series: Series, markers: BarMarker[]): void {
    if (markers.length === 0) this.#plotSets.delete(series);
    else this.#plotSets.set(series, { markers, shown: null, times: [], bucket: null });
    // A hover or press on a marker that is gone ends.
    if (this.#markerPress?.series === series && !markers.includes(this.#markerPress.marker)) this.#markerPress = null;
    if (this.#markerHoverSeries === series && !markers.includes(this.#markerHover!)) this.#setMarkerHover(null, null);
    this.#host.requestOverlay();
  }

  /**
   * @internal The chart's own event markers on the main series, oldest first;
   * empty removes them. Laid out, filtered and folded like the app's sets,
   * but they stay out of `getMarkers`, `setMarkers` and `clear`.
   */
  setEventMarkers(markers: BarMarker[]): void {
    this.#eventSet = markers.length === 0 ? null : { markers, shown: null, times: [], bucket: null };
    // A hover or press on a marker that is gone ends.
    if (this.#markerPress && !this.#hasMarker(this.#markerPress.marker)) this.#markerPress = null;
    if (this.#markerHover && !this.#hasMarker(this.#markerHover)) this.#setMarkerHover(null, null);
    this.#host.requestOverlay();
  }

  /**
   * Replace the data source's marks, drawn on the main series in a set of
   * their own: `setMarkers`, `getMarkers` and `clear()` leave them alone,
   * while `setMarkerFilter` and marker folding apply to them as to every
   * set. Invalid markers are skipped. Keyed by a symbol the package does not
   * export, so only the chart calls it; apps hide them with the `marks`
   * option.
   */
  [SET_SOURCE_MARKS](markers: readonly BarMarker[]): void {
    const valid = markers.filter((m) => {
      try {
        checkMarker(m);
        return true;
      } catch {
        return false;
      }
    });
    const sorted = valid.map(copyMarker).sort((a, b) => a.time - b.time);
    this.#sourceSet = sorted.length === 0 ? null : { markers: sorted, shown: null, times: [], bucket: null };
    this.#rebindMarkers(MARKS, sorted);
    this.#host.requestOverlay();
  }

  /** Replace the data source's time-axis markers: the `timeAxis` ones of `markers` (sorted by time). Keyed like `SET_SOURCE_MARKS`. */
  [SET_TIME_MARKS](markers: readonly SourceMarker[]): void {
    this.#timeMarks = markers.filter((m) => m.position === 'timeAxis');
    this.#host.requestOverlay();
  }

  /** Hover over the time axis (plot space), null when the pointer is elsewhere. True over a badge that takes clicks. */
  timeMarkMove(p: Point | null): boolean {
    const b = p && this.#timeBadgeAt(p);
    if (b || this.timeHover) this.#host.requestOverlay();
    this.timeHover = b;
    this.#timePoint = p;
    return !!b && !!this.#host.listensToMarkClicks?.();
  }

  /** A press on the time axis (plot space): taken over a badge while `markClick` has listeners. */
  timeMarkDown(p: Point, touch = false): boolean {
    const b = this.#host.listensToMarkClicks?.() ? this.#timeBadgeAt(p) : null;
    if (!b) return false;
    // On touch the press is also the hover, so the tooltip shows.
    this.timeMarkMove(p);
    this.#timePress = { ids: b.marks.map((m) => m.id), start: p, slop: touch ? CLICK_SLOP_TOUCH : CLICK_SLOP };
    return true;
  }

  /** The badge nearest `p` within its hit radius: at least `TIME_MARK_HIT` px, so the target is 24 px across. */
  #timeBadgeAt(p: Point): TimeBadge | null {
    let best: TimeBadge | null = null;
    let bestDistance = Infinity;
    for (const b of this.timeBadges) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d <= Math.max(b.r + 2, TIME_MARK_HIT) && d < bestDistance) [best, bestDistance] = [b, d];
    }
    return best;
  }

  /**
   * Time-axis marks as badges in their band under the time labels, with the
   * hovered one's tooltip. A badge that would overlap the one before folds into it
   * and shows the count.
   */
  #drawTimeMarks(ctx: CanvasRenderingContext2D): void {
    const band = this.#host.timeMarkBand?.();
    const badges: TimeBadge[] = (this.timeBadges = []);
    const { timeline, time, theme } = this.#host;
    const marks = this.#timeMarks;
    const last = timeline.times[timeline.length - 1];
    const r = band ? clampLow(band.height / 2 - 2, 4, 8) : 0;
    // Only the marks from one bar left of the view on: sorted by time, so a binary search finds the first.
    let k = 0;
    if (band && last !== undefined) {
      const from = timeline.timeFromIndex(Math.floor(time.xToIndex(-r)) - 1);
      for (let hi = marks.length; k < hi; ) {
        const mid = (k + hi) >> 1;
        if (marks[mid]!.time < from) k = mid + 1;
        else hi = mid;
      }
    } else k = marks.length;
    for (; k < marks.length; k++) {
      const m = marks[k]!;
      let i = barIndexOf(timeline, m.time);
      // Past the last bar a mark sits on the projected time axis, where the view shows future bars.
      if (i < 0 && m.time > last!) i = Math.floor(timeline.indexFromTime(m.time));
      const x = time.indexToX(i);
      if (i < 0 || x < -r) continue;
      if (x > time.width + r) break;
      const prev = badges[badges.length - 1];
      if (prev && x - prev.x < 2 * r + 2) prev.marks.push(m);
      else badges.push({ x, y: band!.top + band!.height / 2, r, marks: [m] });
    }
    // The hover is whatever badge is under the pointer in the new layout, also after a pan or regrouping.
    this.timeHover = this.#timePoint && this.#timeBadgeAt(this.#timePoint);
    if (badges.length === 0) return;
    const fontSize = Math.round(r * 1.25);
    ctx.save();
    ctx.font = fontCss({ ...resolveFont(theme, 'labels'), fontSize });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of badges) {
      const fill = b.marks[0]!.color ?? theme.timeMark ?? theme.line;
      const text = timeBadgeText(b.marks, fontSize);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b === this.timeHover ? r + 1 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = contrastText(fill);
      if (text) fillText(ctx, text, b.x, b.y + 0.5);
    }
    ctx.restore();
    const p = this.#timePoint;
    const rows = this.timeHover?.marks.flatMap((m) => m.tooltip?.split('\n') ?? m.text ?? []).filter((t) => t !== '') ?? [];
    if (p && rows.length > 0) this.#drawTooltipBox(ctx, rows.slice(0, 12), p);
  }

  /**
   * Draw only the markers of `filter.kinds` at `filter.minSeverity` or above,
   * in every set, the data source's marks included; the sets stay as they
   * are. `null` or `{}` draws all.
   */
  setMarkerFilter(filter: MarkerFilter | null): void {
    this.#filter = { ...filter, kinds: filter?.kinds && [...filter.kinds] };
    this.#refold();
  }

  get markerFilter(): Readonly<MarkerFilter> {
    return this.#filter;
  }

  /* ------------------------------- trades ------------------------------ */

  /**
   * Replace the account fills of `source` (default `'default'`). Fills on one
   * bar and side draw as one marker at their volume-weighted price. Sources
   * let separate parts of an app own their fills.
   */
  setTrades(trades: readonly Trade[], options: { source?: string } = {}): void {
    this.#fills('setTrades').set(trades, options.source);
  }

  /** Add one fill, or replace the fill with its id; only its bar is regrouped. */
  addTrade(trade: Trade, options: { source?: string } = {}): void {
    this.#fills('addTrade').add(trade, options.source);
  }

  /** Remove the fills of `source`, or all fills. */
  clearTrades(source?: string): void {
    this.#fills('clearTrades').remove(source);
  }

  /** Copies of the fills of `source`, or of every source. */
  getTrades(source?: string): Trade[] {
    return this.#fills('getTrades').trades(source);
  }

  /** Copies of the fills grouped per bar and side, as drawn. */
  get tradeGroups(): readonly TradeGroup[] {
    return this.#fills('tradeGroups').groups;
  }

  /** Marker variant, size, count text and more for fills. Fields left out keep their value. */
  applyTradeOptions(patch: Partial<TradeMarkerOptions>): void {
    this.#fills('applyTradeOptions').applyOptions(patch);
  }

  get tradeOptions(): Readonly<TradeMarkerOptions> {
    return this.#fills('tradeOptions').options;
  }

  /**
   * Apply fills, order lines and position lines from one snapshot in one go,
   * e.g. after a socket reconnect, so the chart never shows half of it.
   * Everything is checked first: an invalid entry throws and changes nothing.
   * Returns the new order and position lines.
   */
  syncTrades(sync: TradeSync): { orders: TradeLine[]; positions: TradeLine[] } {
    const layer = sync.trades ? this.#fills('syncTrades') : null;
    const lines = sync.orders || sync.positions ? this.#need('syncTrades') : null;
    const fills = sync.trades ? layer!.prepare(sync.trades) : null;
    const made = lines?.prepareSync(sync) ?? { orders: [], positions: [] };
    lines?.commitSync(sync, made);
    if (fills) layer!.commit(fills, sync.source);
    this.#host.requestOverlay();
    return made;
  }

  /** The fills layer of the `trading()` plugin; throws a `not-registered` `ChartError` without it. */
  #fills(call: string): TradeFills {
    return (this.layers.get('trading/fills') as TradeFills | undefined) ?? notInstalled(`annotations.${call}`, 'trading()');
  }

  /** The order, position, alert and draft lines layer of the `trading()` plugin, if installed. */
  #lines(): TradingLines | undefined {
    return this.layers.get('trading/lines') as TradingLines | undefined;
  }

  /** `#lines`, throwing a `not-registered` `ChartError` without it. */
  #need(call: string): TradingLines {
    return this.#lines() ?? notInstalled(`annotations.${call}`, 'trading()');
  }

  /**
   * @internal Add a layer under `name`, made with what the manager gives it;
   * one with the same name is replaced. Returns a function that removes it.
   */
  addLayer(name: string, create: (h: AnnotationLayerHost) => AnnotationLayer): () => void {
    this.layers.get(name)?.clear?.();
    const layer = create({
      host: this.#host,
      main: () => this.target(undefined),
      target: (series) => this.target(series),
      options: () => this.#opts,
      priceFactor: (pane, time) => this.priceFactor(pane, time),
      format: (t) => this.format(t),
      axisText: (t, price) => this.#axisText(t, price),
      tooltip: (ctx, rows, p) => this.#drawTooltipBox(ctx, rows, p),
    });
    this.layers.set(name, layer);
    this.#host.requestOverlay();
    return () => {
      if (this.layers.get(name) !== layer) return;
      layer.clear?.();
      this.layers.delete(name);
      this.#host.requestOverlay();
    };
  }

  /* ------------------------------- lines ------------------------------- */

  addPriceLine(options: Partial<PriceLineOptions> & Pick<PriceLineOptions, 'price'>): PriceLine {
    const line = new PriceLine({ lineWidth: 1, lineStyle: 'dashed', title: '', axisLabel: true, ...options }, this.#owner);
    this.#prices.push(line);
    this.#host.requestOverlay();
    return line;
  }

  /** Add an order (default) or position line; defaults depend on `kind`. */
  addTradeLine(options: Partial<TradeLineOptions> & Pick<TradeLineOptions, 'price' | 'side'>): TradeLine {
    return this.#need('addTradeLine').addTradeLine(options);
  }

  /** Add a price alert; dragging and the remove button are opt-in through its callbacks. */
  addAlertLine(options: Partial<AlertLineOptions> & Pick<AlertLineOptions, 'price'>): AlertLine {
    return this.#need('addAlertLine').addAlertLine(options);
  }

  /**
   * Start composing an order on the chart. The draft's price, take-profit and
   * stop-loss drag freely, clicks on its quantity and type emit `draft:edit`,
   * and its place button (or `commit()`) emits `order:create`.
   */
  startOrderDraft(options: Partial<DraftLineOptions> & Pick<DraftLineOptions, 'price' | 'side'>): DraftLine {
    return this.#need('startOrderDraft').startOrderDraft(options);
  }

  /* ----------------------- bands, zones and labels ----------------------- */

  /**
   * Shade the full pane height from the bar of `from` to the bar of `to`
   * (one bar when `to` is left out), below the series.
   */
  addTimeBand(options: TimeBandOptions): TimeBand {
    return this.#zoneLayer.addBand(options);
  }

  /** Shade the band between two prices, below the series; `fromTime` / `toTime` limit it to bars. */
  addPriceZone(options: Partial<PriceZoneOptions> & Pick<PriceZoneOptions, 'from' | 'to'>): PriceZone {
    return this.#zoneLayer.addZone(options);
  }

  /** Pin a text box to a time and price, above the series and drawings. */
  addTextLabel(options: Partial<TextLabelOptions> & Pick<TextLabelOptions, 'time' | 'price' | 'text'>): TextLabel {
    return this.#zoneLayer.addLabel(options);
  }

  get timeBands(): readonly TimeBand[] {
    return this.#zoneLayer.bands;
  }

  get priceZones(): readonly PriceZone[] {
    return this.#zoneLayer.zones;
  }

  get textLabels(): readonly TextLabel[] {
    return this.#zoneLayer.labels;
  }

  get priceLines(): readonly PriceLine[] {
    return this.#prices;
  }

  /** Order and position lines; none without `trading()`. */
  get tradeLines(): readonly TradeLine[] {
    return this.#lines()?.tradeLines ?? [];
  }

  /** Alert lines; none without `trading()`. */
  get alertLines(): readonly AlertLine[] {
    return this.#lines()?.alertLines ?? [];
  }

  /** Order drafts; none without `trading()`. */
  get draftLines(): readonly DraftLine[] {
    return this.#lines()?.draftLines ?? [];
  }

  /**
   * Alert lines of `series` (default: the main series) that a price moving
   * from `from` to `to` crossed, e.g. the previous and the new last price of a
   * live update. Hidden lines count too: visibility is display only. The
   * chart never calls this itself; triggering alerts is up to the app.
   */
  alertsCrossed(from: number, to: number, series?: Series): AlertCrossing[] {
    return this.#lines()?.alertsCrossed(from, to, series) ?? [];
  }

  /**
   * @internal Called by the chart when its main series changes: alerts
   * without a series follow it to its pane.
   */
  mainChanged(): void {
    for (const layer of this.layers.values()) layer.mainChanged?.();
    this.#zoneLayer.mainChanged();
  }

  /** Remove all markers, lines, bands, zones and labels. Shape plots, event markers and the data source's marks stay. */
  clear(): void {
    this.#zoneLayer.clear();
    this.#markerSets.clear();
    this.#prices = [];
    this.#gesture = null;
    this.#endHover();
    for (const layer of this.layers.values()) layer.clear?.();
    this.#markerPress = null;
    this.#setMarkerHover(null, null);
    this.#host.requestOverlay();
  }

  /* --------------------------- pointer input --------------------------- */

  /**
   * Returns true when a line or button took the press (no panning, no drawing).
   * `touch` widens the travel that still counts as a click.
   */
  pointerDown(p: Point, touch = false): boolean {
    const slop = touch ? CLICK_SLOP_TOUCH : CLICK_SLOP;
    // Layers above (order lines) win over price lines, price lines over other layers (e.g. fill markers), and those over bar markers.
    if (this.#layerDown(p, slop, true)) {
      this.#setMarkerHover(null, null);
      return true;
    }
    const hit = this.hitTest(p);
    if (!hit) return this.#layerDown(p, slop, false) || (!this.#layerHovered() && this.#markerDown(p, slop));
    if (!handlers(hit.line).onClick) return false;
    this.#gesture = { line: hit.line, start: p, slop };
    this.#setHover(hit, p);
    this.#setMarkerHover(null, null);
    return true;
  }

  /** Drag, or update hover state; null when the pointer left the plot. */
  pointerMove(p: Point | null): void {
    if (p) for (const layer of this.layers.values()) if (layer.move?.(p)) return;
    if (this.#gesture && p) {
      this.#setHover(this.hitTest(p), p);
      return;
    }
    let over = true;
    for (const layer of this.#layers(true)) {
      layer.hover?.(p, over);
      if (layer.hovering) over = false;
    }
    const hit = p && over ? this.hitTest(p) : null;
    this.#setHover(hit, p);
    if (hit) over = false;
    for (const layer of this.#layers(false)) {
      layer.hover?.(p, over);
      if (layer.hovering) over = false;
    }
    if (!this.#markerPress) this.#setMarkerHover(p && over ? this.#markerHit(p) : null, p);
  }

  pointerUp(p: Point): void {
    const press = this.#timePress;
    if (press) {
      this.#timePress = null;
      if (!beyond(press.start, p, press.slop)) this.#host.markClick?.(press.ids, this.#rootPoint(p));
      return;
    }
    const mp = this.#markerPress;
    if (mp) {
      this.#markerPress = null;
      if (beyond(mp.start, p, mp.slop) || !this.#hasMarker(mp.marker)) return;
      if (mp.key === MARKS) {
        const ids = (this.#members.get(mp.marker) ?? [mp.marker]).map((m) => m.id).filter((id): id is string => id !== undefined);
        this.#host.markClick?.(ids, this.#rootPoint(p));
      } else this.#host.markerClick?.(this.#markerEvent(mp.marker, mp.series, p));
      return;
    }
    for (const layer of this.layers.values()) if (layer.pointerUp?.(p)) return;
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    this.#host.requestOverlay();
    if (!beyond(g.start, p, g.slop) && this.#prices.includes(g.line)) {
      handlers(g.line).onClick?.(pointerEvent(g.line, 'entry', g.line.options.price, this.#rootPoint(p)));
    }
  }

  /** Abort the current gesture; a dragged line returns to its original price. */
  cancelGesture(): boolean {
    let pressed = this.#markerPress !== null || this.#timePress !== null || this.#gesture !== null;
    for (const layer of this.layers.values()) pressed = (layer.cancel?.() ?? false) || pressed;
    this.#markerPress = null;
    this.#timePress = null;
    if (this.#gesture) this.#host.requestOverlay();
    this.#gesture = null;
    return pressed;
  }

  /** Escape restores the price during a drag, else discards pending changes. Returns true when handled. */
  keyDown(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape') return false;
    if (this.cancelGesture()) return true;
    for (const layer of this.layers.values()) if (layer.keyDown?.(e)) return true;
    return false;
  }

  cursor(p: Point): string | null {
    if (this.#gesture) return 'pointer';
    for (const layer of this.#layers(true)) {
      const cursor = layer.cursor?.(p);
      if (cursor !== undefined) return cursor;
    }
    const hit = this.hitTest(p);
    if (hit) return handlers(hit.line).onClick ? 'pointer' : null;
    for (const layer of this.#layers(false)) {
      const cursor = layer.cursor?.(p);
      if (cursor !== undefined) return cursor;
    }
    const box = this.#markerHit(p);
    return box && this.#takesClicks(box.marker) ? 'pointer' : null;
  }

  /** Whether the pointer is over a line, a layer's annotation or a bar marker (as of the last move). */
  get isHovering(): boolean {
    return this.#hover !== null || this.#layerHovered() || this.#markerHover !== null;
  }

  get isBusy(): boolean {
    if (this.#gesture) return true;
    for (const layer of this.layers.values()) if (layer.busy) return true;
    return false;
  }

  /* ------------------------------- render ------------------------------ */

  /** Plot-area drawing for every pane, clipped to each pane. */
  render(ctx: CanvasRenderingContext2D): void {
    const width = this.#host.time.width;
    const theme = this.#host.theme;
    this.#layoutMarkers();
    this.#host.panes.forEach((pane) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, pane.top, width, pane.height);
      ctx.clip();
      ctx.font = fontCss(resolveFont(theme, 'labels'));
      this.#renderMarkers(ctx, pane);
      for (const layer of this.#layers(false)) layer.render?.(ctx, pane);
      this.#renderPriceLines(ctx, pane, width);
      for (const layer of this.#layers(true)) layer.render?.(ctx, pane);
      ctx.restore();
    });
  }

  /** Price-axis labels and tooltips; drawn unclipped after the axes. */
  renderLabels(ctx: CanvasRenderingContext2D): void {
    for (const zone of this.#zoneLayer.zones) {
      const o = zone.options;
      const t = zone.visible && o.axisLabel ? this.target(o.series) : null;
      if (!t) continue;
      const color = this.#zoneLayer.axisColor(zone);
      const factor = zoneFactor(o, (time) => this.priceFactor(t.pane, time));
      this.#zoneAxisLabel(ctx, t, o.from * factor, color);
      this.#zoneAxisLabel(ctx, t, o.to * factor, color);
    }
    for (const line of this.#prices) {
      const o = line.options;
      const t = this.target(o.series);
      if (!t || !line.visible || !o.axisLabel) continue;
      const y = t.pane.top + t.scale.priceToY(o.price);
      if (y < t.pane.top || y > t.pane.top + t.pane.height) continue;
      const color = o.color ?? this.#host.theme.line;
      this.#host.axisLabel(ctx, this.#axisText(t, o.price), y, color, contrastText(color), t);
    }
    for (const layer of this.#layers(true)) layer.renderLabels?.(ctx);
    this.#drawLineTooltip(ctx);
    for (const layer of this.#layers(false)) layer.renderLabels?.(ctx);
    this.#drawMarkerTooltip(ctx);
    this.#drawTimeMarks(ctx);
  }

  /* --------------------------- marker internals -------------------------- */

  /**
   * Lay out the markers of every set near the visible bars into the pool,
   * each box tagged with its series and pane. Allocates nothing once the
   * pool and the text widths are warm.
   */
  #layoutMarkers(): void {
    const pool = this.markerPool;
    pool.reset();
    const tl = this.#host.timeline;
    const time = this.#host.time;
    if (tl.length === 0 || !this.#hasMarkerSets()) return;
    // Whole bars only, one extra each side, so stacks are never cut.
    const a = Math.max(0, Math.floor(time.xToIndex(0)) - 1);
    const b = Math.min(tl.lastIndex, Math.ceil(time.xToIndex(time.width)) + 1);
    if (a > b) return;
    const start = tl.times[a]!;
    const end = b < tl.lastIndex ? tl.times[b + 1]! : tl.times[b]! + tl.interval;
    const env = this.#markerEnv;
    env.timeline = tl;
    env.barSpacing = time.barSpacing;
    const font = resolveFont(this.#host.theme, 'markers');
    const css = fontCss(font);
    if (css !== this.#textFont) {
      this.#textWidths.clear();
      this.#textFont = css;
    }
    this.#markerFont = font;
    env.fontSize = font.fontSize;
    for (const [key, set] of this.#markerSets) this.#layoutSet(set, this.target(key), start, end, false);
    for (const [series, set] of this.#plotSets) this.#layoutSet(set, this.target(series), start, end, true);
    if (this.#eventSet) this.#layoutSet(this.#eventSet, this.target(null), start, end, false);
    if (this.#sourceSet) this.#layoutSet(this.#sourceSet, this.target(null), start, end, false);
    this.#layoutSeries = null;
    this.#rangeSeries = null;
    this.#layoutPane = null;
  }

  /**
   * Lay out the markers of one set between bar times `start` and `end` on
   * target `t`. A plot set on the main series' scale sits against the main
   * bars; every other set against its own series.
   */
  #layoutSet(set: MarkerSet, t: Target | null, start: number, end: number, plot: boolean): void {
    if (!t?.series) return;
    const pool = this.markerPool;
    const env = this.#markerEnv;
    const shown = this.#shownMarkers(set);
    const from = lowerBound(set.times, start);
    const to = lowerBound(set.times, end);
    if (from >= to) return;
    const main = this.#host.main;
    this.#layoutSeries = t.series;
    this.#rangeSeries = plot && main?.visible && main.scale === t.series.scale ? main : t.series;
    this.#layoutPane = t.pane;
    // Shape plots already sit on adjusted values; the chart's own sets have no `atPrice` markers.
    this.#layoutAdjusted = !plot;
    env.top = t.pane.top;
    env.bottom = t.pane.top + t.pane.height;
    const first = pool.used;
    placeMarkers(shown, from, to, env, pool);
    for (let i = first; i < pool.used; i++) {
      const box = pool.boxes[i]!;
      box.series = t.series;
      box.pane = t.pane;
    }
  }

  /** The app's marker sets, then the shape plots', the chart's events and the data source's marks. */
  #allMarkerSets(): MarkerSet[] {
    const sets = [...this.#markerSets.values(), ...this.#plotSets.values()];
    if (this.#eventSet) sets.push(this.#eventSet);
    if (this.#sourceSet) sets.push(this.#sourceSet);
    return sets;
  }

  #hasMarkerSets(): boolean {
    return this.#markerSets.size + this.#plotSets.size > 0 || this.#eventSet !== null || this.#sourceSet !== null;
  }

  /**
   * The set's markers as laid out, refolded when it, the filter, the cluster
   * options or (while folding) the bars changed.
   */
  #shownMarkers(set: MarkerSet): BarMarker[] {
    const tl = this.#host.timeline;
    const cluster = this.#opts.markerCluster;
    const b = set.bucket;
    if (set.shown && (!cluster.enabled || (b && b[0] === tl.times && b[1] === tl.length && b[2] === tl.interval))) return set.shown;
    const shown = foldMarkers(set.markers, tl, this.#filter, cluster, this.#members);
    set.shown = shown;
    set.times = shown.map((m) => m.time);
    set.bucket = [tl.times, tl.length, tl.interval];
    return shown;
  }

  /** The filter or folding changed: every set is laid out afresh, ending a hover or press on a marker. */
  #refold(): void {
    for (const set of this.#allMarkerSets()) set.shown = null;
    this.#markerPress = null;
    this.#setMarkerHover(null, null);
    this.#host.requestOverlay();
  }

  /** Width of a marker text in the markers font, measured once per text and font. */
  #markerTextWidth(text: string): number {
    let w = this.#textWidths.get(text);
    if (w === undefined) {
      w = this.#host.measureText(text, this.#markerFont ?? undefined);
      this.#textWidths.set(text, w);
    }
    return w;
  }

  /** The bar marker under `p` (plot space), clipped to its pane and the plot. */
  #markerHit(p: Point): MarkerBox | null {
    if (!this.#hasMarkerSets() || p.x < 0 || p.x > this.#host.time.width) return null;
    this.#layoutMarkers();
    return markerAt(this.markerPool, p);
  }

  /** A press on a bar marker: on touch it is also the hover. Taken only for click listeners. */
  #markerDown(p: Point, slop: number): boolean {
    const box = this.#markerHit(p);
    this.#setMarkerHover(box, p);
    if (!box?.series) return false;
    const key = this.#markerSetOf(box.marker);
    if (key === undefined) return false;
    if (!this.#takesClicks(box.marker)) return false;
    this.#markerPress = { marker: box.marker, series: box.series, key, start: p, slop };
    return true;
  }

  /** Whether a press on `m` is taken: `sourcemarkers:click` listeners for the data source's markers, `marker:click` for the rest. */
  #takesClicks(m: BarMarker): boolean {
    const key = this.#markerSetOf(m);
    if (key === undefined) return false;
    return (key === MARKS ? this.#host.listensToMarkClicks?.() : this.#host.listensToMarkerClicks?.()) ?? false;
  }

  /** Hover enter and leave fire once per marker; the data source's marks only show their tooltip. */
  #setMarkerHover(box: MarkerBox | null, p: Point | null): void {
    const before = this.#markerHover;
    const beforeSeries = this.#markerHoverSeries;
    const beforeKey = this.#markerHoverKey;
    const next = box?.series ? box.marker : null;
    this.#markerPoint = p;
    if (before === next) {
      // A tooltip follows the pointer.
      if (next?.tooltip !== undefined) this.#host.requestOverlay();
      return;
    }
    this.#markerHover = next;
    this.#markerHoverSeries = next ? box!.series : null;
    this.#markerHoverKey = next ? this.#markerSetOf(next) : undefined;
    this.#host.requestOverlay();
    if (before && beforeSeries && beforeKey !== MARKS) this.#host.markerHoverEnd?.({ marker: copyMarker(before), series: beforeSeries });
    if (next && p && this.#markerHoverKey !== MARKS) this.#host.markerHover?.(this.#markerEvent(next, this.#markerHoverSeries!, p));
  }

  /**
   * The set of `key` changed: a hover or press on one of its markers moves to
   * the marker with the same id in `markers`, or ends when there is none.
   */
  #rebindMarkers(key: MarkerKey, markers: readonly BarMarker[]): void {
    const same = (m: BarMarker) => markers.find((x) => x === m || (m.id !== undefined && x.id === m.id)) ?? null;
    const press = this.#markerPress;
    if (press && press.key === key) {
      const m = same(press.marker);
      if (m) press.marker = m;
      else this.#markerPress = null;
    }
    const hover = this.#markerHover;
    if (hover && this.#markerHoverSeries && this.#markerHoverKey === key) {
      const m = same(hover);
      if (m) this.#markerHover = m;
      else this.#setMarkerHover(null, null);
    }
  }

  #hasMarker(m: BarMarker): boolean {
    return this.#markerSetOf(m) !== undefined;
  }

  /** Key of the set whose laid-out markers hold `m`; undefined when none does. */
  #markerSetOf(m: BarMarker): MarkerKey | undefined {
    for (const [key, set] of this.#markerSets) if (this.#shownMarkers(set).includes(m)) return key;
    for (const set of this.#plotSets.values()) if (this.#shownMarkers(set).includes(m)) return PLOTS;
    if (this.#eventSet && this.#shownMarkers(this.#eventSet).includes(m)) return EVENTS;
    if (this.#sourceSet && this.#shownMarkers(this.#sourceSet).includes(m)) return MARKS;
    return undefined;
  }

  #markerEvent(marker: BarMarker, series: Series, p: Point): MarkerPointerEvent {
    const members = this.#members.get(marker);
    const e: MarkerPointerEvent = { marker: copyMarker(marker), series, point: this.#rootPoint(p) };
    if (members) e.members = members.map(copyMarker);
    return e;
  }

  /** The hovered marker's `tooltip`, next to the pointer. */
  #drawMarkerTooltip(ctx: CanvasRenderingContext2D): void {
    const raw = this.#markerHover?.tooltip;
    const p = this.#markerPoint;
    if (raw === undefined || !p) return;
    const rows = (Array.isArray(raw) ? raw : [raw]).filter((t) => t !== '');
    if (rows.length > 0) this.#drawTooltipBox(ctx, rows, p);
  }

  /** One edge of a price zone on the axis, when it is inside the pane; `price` as drawn. */
  #zoneAxisLabel(ctx: CanvasRenderingContext2D, t: Target, price: number, color: string): void {
    const y = t.pane.top + t.scale.priceToY(price);
    if (y < t.pane.top || y > t.pane.top + t.pane.height) return;
    this.#host.axisLabel(ctx, this.#axisText(t, price), y, color, contrastText(color), t);
  }

  /* --------------------------- layer internals --------------------------- */

  /** Layers that take the pointer before price lines (`above`), or after them. */
  #layers(above: boolean): AnnotationLayer[] {
    return [...this.layers.values()].filter((l) => !l.above === !above);
  }

  /** A press, offered to each layer in turn. */
  #layerDown(p: Point, slop: number, above: boolean): boolean {
    for (const layer of this.#layers(above)) if (layer.pointerDown?.(p, slop)) return true;
    return false;
  }

  #layerHovered(): boolean {
    for (const layer of this.layers.values()) if (layer.hovering) return true;
    return false;
  }

  /* ----------------------------- internals ----------------------------- */

  #markerKey(series: Series | undefined): Series | null {
    return series && series !== this.#host.main ? series : null;
  }

  #detach(line: object): void {
    const before = this.#prices.length;
    this.#prices = this.#prices.filter((l) => l !== line);
    if (this.#prices.length === before) return;
    if (this.#gesture?.line === line) this.#gesture = null;
    if (this.#hover?.line === line) this.#endHover();
    this.#host.requestOverlay();
  }

  /** Drop the hover, ending a line's hover like the pointer leaving it. */
  #endHover(): void {
    const h = this.#hover;
    this.#hover = null;
    if (h) handlers(h.line).onHoverEnd?.();
  }

  /** Plot-space point to chart-root css px, the space of pointer events (like `chart.pointAt`). */
  #rootPoint(p: Point): Point {
    return { x: p.x + this.#host.plotLeft, y: p.y };
  }

  /** What the app's prices at `time` in `pane` draw multiplied by: the host's adjustment factor, 1 without one. */
  private priceFactor(pane: Pane, time: Time): number {
    return this.#host.priceFactor?.(pane, time) ?? 1;
  }

  /** Scale and pane for a line or marker set; null when its series is gone or hidden. */
  private target(series: Series | undefined | null): Target | null {
    const s = series ?? this.#host.main;
    const panes = this.#host.panes;
    if (!s) {
      const pane = panes[0];
      return pane ? { series: null, pane, paneIndex: 0, scale: pane.price } : null;
    }
    const paneIndex = panes.indexOf(s.pane);
    if (paneIndex < 0 || !s.pane.series.includes(s) || !s.visible) return null;
    return { series: s, pane: s.pane, paneIndex, scale: s.scale };
  }

  private format(t: Target): (price: number) => string {
    const s = t.series;
    if (s instanceof CandleSeries) return s.format;
    if (s instanceof LineSeries || s instanceof HistogramSeries) return (price) => s.formatValue(price);
    return (price) => this.#host.formatPrice(t.paneIndex, price);
  }

  #axisText(t: Target, price: number): string {
    return t.series?.overlayScale ? this.format(t)(price) : this.#host.formatAxis(t.paneIndex, price, t.scale.id);
  }

  /** The interactive price line under `p`. */
  private hitTest(p: Point): Hit | null {
    if (p.x < 0 || p.x > this.#host.time.width) return null;
    // Price lines take the pointer only when they have pointer callbacks or a tooltip.
    for (let i = this.#prices.length - 1; i >= 0; i--) {
      const line = this.#prices[i]!;
      const o = line.options;
      if (!line.visible || o.lineOnly || !interactive(o)) continue;
      const t = this.target(o.series);
      if (!t) continue;
      const y = t.pane.top + t.scale.priceToY(o.price);
      if (y < t.pane.top || y > t.pane.top + t.pane.height) continue;
      if (Math.abs(p.y - y) <= HIT) return { line, start: p, slop: 0 };
    }
    return null;
  }

  /** Track the hovered price line. */
  #setHover(hit: Hit | null, p: Point | null): void {
    const h = this.#hover;
    const moved = this.#hoverPoint?.x !== p?.x || this.#hoverPoint?.y !== p?.y;
    this.#hoverPoint = p;
    if (h?.line === hit?.line) {
      // A line tooltip follows the pointer.
      if (moved && hit && handlers(hit.line).tooltip) this.#host.requestOverlay();
      return;
    }
    this.#hover = hit;
    this.#host.requestOverlay();
    if (h) handlers(h.line).onHoverEnd?.();
    if (hit && p) handlers(hit.line).onHover?.(pointerEvent(hit.line, 'entry', hit.line.options.price, this.#rootPoint(p)));
  }

  /** Draw the boxes of the last `layoutMarkers` that belong to `pane`. */
  #renderMarkers(ctx: CanvasRenderingContext2D, pane: Pane): void {
    const pool = this.markerPool;
    if (pool.used === 0) return;
    const theme = this.#host.theme;
    ctx.save();
    ctx.font = this.#textFont;
    for (let i = 0; i < pool.used; i++) {
      const box = pool.boxes[i]!;
      if (box.pane === pane) drawMarker(ctx, box, markerColor(box.marker, theme), this.#iconReady);
    }
    ctx.restore();
  }

  #renderPriceLines(ctx: CanvasRenderingContext2D, pane: Pane, width: number): void {
    for (const line of this.#prices) {
      const o = line.options;
      const t = this.target(o.series);
      if (!t || t.pane !== pane || !line.visible) continue;
      const y = pane.top + t.scale.priceToY(o.price);
      if (y < pane.top || y > pane.top + pane.height) continue;
      const color = o.color ?? this.#host.theme.line;
      hLine(ctx, y, width, color, o.lineWidth, o.lineStyle);
      if (!o.title || o.lineOnly) continue;
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      fillText(ctx, o.title, width - BLOCK_INSET, y - 3);
    }
  }

  /** A hovered price line's own `tooltip` text, above the pointer (below it near the top). */
  #drawLineTooltip(ctx: CanvasRenderingContext2D): void {
    const raw = this.#hover?.line.options.tooltip;
    const p = this.#hoverPoint;
    if (raw === undefined || !p) return;
    const rows = (Array.isArray(raw) ? raw : [raw]).filter((t) => t !== '');
    if (rows.length > 0) this.#drawTooltipBox(ctx, rows, p);
  }

  /** Rows of text in a label box above the pointer `p` (below it near the top). */
  #drawTooltipBox(ctx: CanvasRenderingContext2D, rows: readonly string[], p: Point): void {
    const theme = this.#host.theme;
    const font = resolveFont(theme, 'labels');
    const lh = font.fontSize + 4;
    const w = Math.ceil(Math.max(...rows.map((t) => this.#host.measureText(t)))) + 12;
    const h = rows.length * lh + 6;
    const x = clampLow(p.x + 12, 2, this.#host.time.width - w - 2);
    const y = p.y - h - 10 >= 0 ? p.y - h - 10 : p.y + 16;
    ctx.save();
    ctx.font = fontCss(font);
    ctx.fillStyle = theme.labelBackground;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.fillStyle = theme.labelText;
    ctx.textBaseline = 'middle';
    rows.forEach((t, i) => fillLine(ctx, t, x + 6, x + w - 6, y + 3 + lh * i + lh / 2 + 0.5));
    ctx.restore();
  }
}

/**
 * Text in a time-axis badge: the count of a folded badge (`9+` above nine),
 * else the mark's text (two characters at most). None when `fontSize` is too
 * small to read; the tooltip still names the marks.
 */
export function timeBadgeText(marks: readonly SourceMarker[], fontSize: number): string {
  if (fontSize < TIME_MARK_MIN_FONT) return '';
  const n = marks.length;
  return n > 1 ? (n > 9 ? '9+' : String(n)) : (marks[0]?.text ?? '').slice(0, 2);
}

/** A copy of a marker, safe to keep or hand to app code. */
function copyMarker(m: BarMarker): BarMarker {
  const copy = { ...m };
  if (Array.isArray(m.tooltip)) copy.tooltip = [...m.tooltip];
  return copy;
}

/** Whether a line wants the pointer for its own callbacks or tooltip. */
function interactive<L>(o: LineInteractionOptions<L>): boolean {
  return Boolean(o.onHover || o.onHoverEnd || o.onClick || o.tooltip);
}

/** A price line's pointer callbacks. */
function handlers(line: PriceLine): LineInteractionOptions<PriceLine> {
  return line.options;
}

/** @internal A line pointer event. */
export function pointerEvent<L>(line: L, part: TradeLinePart, price: number, point: Point) {
  return { line, part, price, point };
}

/** @internal Whether the pointer moved from `from` to `to` by more than `slop` css px. */
export function beyond(from: Point, to: Point, slop: number): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > slop;
}

