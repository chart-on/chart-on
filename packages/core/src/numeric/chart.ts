import type { LineStyle } from '../annotations/types';
import { ChartError } from '../errors';
import { budgetEntry, contextBudget, type ContextHolder } from '../gl/context-budget';
import { LineBatch } from '../gl/line-batch';
import { RectBatch } from '../gl/rect-batch';
import type { RenderBackend } from '../gl/backend';
import { GLRenderer, type FillGradient } from '../gl/renderer';
import { lineDash } from '../line-path';
import { crispLine, PrimitiveGuard, type PriceAxisLabel, type PrimitiveLayer } from '../primitives';
import { addLayer, createRoot, measureRoot, pixelRatioWatch, setRootBackground, sizeCanvas, watchInView } from '../root-style';
import { PriceScale } from '../scales';
import { resolveTheme, type ChartTheme } from '../theme';
import { fillNumerals, fillText, fontCss, measureNumerals, mergeTypography, resolveFont, type ResolvedFont } from '../typography';
import { contrastText, parseColor, unitColor, withAlpha } from '../util/color';
import { Emitter } from '../util/emitter';
import { priceTicks, type PriceTicks } from '../util/format';
import { createPriceFormat, decimalPriceFormat, type PriceFormat, type PriceFormatModel } from '../util/price-format';
import { NumericScale } from './scale';
import type { NumericItem, NumericPoint, NumericPointerEvent, NumericPrimitive, NumericPrimitiveEnv } from './types';
import { bisect } from '../util/search';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The horizontal axis of a `NumericChart`. */
export interface NumericHorizontalScaleOptions {
  /** How x values are labelled; default: decimals from the tick step. */
  format?: PriceFormat;
  /** Larger values on the left. Default false. */
  invert: boolean;
  /** Free room left and right of the data after `fitContent`, as a fraction of the plot width. Default 0.02. */
  margin: number;
}

/** The vertical (price) axis of a `NumericChart`. It always fits the visible data. */
export interface NumericPriceScaleOptions {
  /** How prices are labelled; default: decimals from the tick step. */
  format?: PriceFormat;
  /** Larger prices lower down. Default false. */
  invert: boolean;
  /** Free room above and below the data, as a fraction of the plot height. Defaults 0.1 and 0.05. */
  marginTop: number;
  marginBottom: number;
}

/** Options of `createNumericChart`; see `defaultNumericChartOptions`. */
export interface NumericChartOptions {
  /** Theme tokens over the dark default, as for `createChart`. */
  theme?: Partial<ChartTheme>;
  horizontalScale: NumericHorizontalScaleOptions;
  priceScale: NumericPriceScaleOptions;
  /** Grid lines at the axis ticks. Default true. */
  grid: boolean;
  /** Crosshair with axis labels under the pointer. Default true. */
  crosshair: boolean;
  /** Series titles in the top-left corner, with their values under the crosshair. Default true. */
  legend: boolean;
  /** Pan, zoom and the crosshair follow the pointer and keyboard. Default true. */
  interactive: boolean;
}

/** A partial `NumericChartOptions` for `createNumericChart` and `applyOptions`; the scale objects merge field by field. */
export type NumericChartOptionsPatch = Omit<Partial<NumericChartOptions>, 'horizontalScale' | 'priceScale'> & {
  horizontalScale?: Partial<NumericHorizontalScaleOptions>;
  priceScale?: Partial<NumericPriceScaleOptions>;
};

/** The options a `NumericChart` starts from. */
export const defaultNumericChartOptions: NumericChartOptions = {
  horizontalScale: { invert: false, margin: 0.02 },
  priceScale: { invert: false, marginTop: 0.1, marginBottom: 0.05 },
  grid: true,
  crosshair: true,
  legend: true,
  interactive: true,
};

/** Options of a line series on a `NumericChart` (`addLine`). */
export interface NumericLineOptions {
  title: string;
  /** Default: the theme's `line`. */
  color?: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /**
   * `'simple'` joins points straight; `'step'` holds each value until the
   * next item's x, then jumps (depth curves). Default `'simple'`.
   */
  lineType: 'simple' | 'step';
  /** Fill under the line with a vertical gradient of its colour. Default false. */
  area: boolean;
  /** `false` leaves the series out of the legend. Default true. */
  legend: boolean;
}

/** Options of a histogram series on a `NumericChart` (`addHistogram`). */
export interface NumericHistogramOptions {
  title: string;
  /** Default: the theme's `line`. An item's own `color` wins. */
  color?: string;
  /** Value the columns grow from. Default 0. */
  base: number;
  /** Column width in x units; default 80% of the smallest gap between items. */
  columnWidth?: number;
  /** `false` leaves the series out of the legend. Default true. */
  legend: boolean;
}

/** Options of a price line on a `NumericChart` (`addPriceLine`). */
export interface NumericPriceLineOptions {
  price: number;
  /** Default: the theme's `referenceLine`. */
  color?: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** Text above the line at the right edge of the plot. */
  title: string;
  /** Show the price on the price axis. Default true. */
  axisLabel: boolean;
}

/** Handle from `NumericChart.addPriceLine`. */
export interface NumericPriceLine {
  readonly options: Readonly<NumericPriceLineOptions>;
  applyOptions(patch: Partial<NumericPriceLineOptions>): void;
  remove(): void;
}

/** Events of a `NumericChart`, by name, with their payloads (`chart.on`). */
export interface NumericChartEvents {
  /** The crosshair moved, or left the plot (null). */
  'crosshair:move': NumericPointerEvent | null;
  /** The visible x range changed (`from < to`, also when inverted). */
  'range:change': { from: number; to: number };
  /** `setData` left out an item without a finite `x` and `value`. */
  'item:dropped': { series: NumericSeries; item: unknown; reason: 'invalid' };
  /** Press and release in the plot without dragging. */
  'plot:click': NumericPointerEvent;
  /** The chart's size changed (css px). */
  'chart:resize': { width: number; height: number };
  /** `applyOptions({ theme })` changed the resolved theme. */
  'theme:change': { theme: ChartTheme };
  /** `destroy()` was called; the chart is still intact while listeners run. */
  'chart:destroy': Record<string, never>;
  /** An event listener threw (a `ChartError` with code `listener-failed`), or the GPU context could not be restored. */
  'chart:error': { error: ChartError };
}

/** What a series needs from its chart. */
interface SeriesHost {
  theme(): ChartTheme;
  dataChanged(series: NumericSeries): void;
  dropped(series: NumericSeries, item: unknown): void;
  invalidate(): void;
  removeSeries(series: NumericSeries): void;
}

/** The view a series draws into: the scales and the plot height, css px. */
interface DrawView {
  x: NumericScale;
  y: PriceScale;
  height: number;
}

let nextSeriesId = 1;

/** A line or histogram series on a `NumericChart`. */
export type NumericSeries = NumericLineSeries | NumericHistogramSeries;

/** What the line and histogram series of a `NumericChart` share: id, data, options and visibility. */
abstract class NumericSeriesBase<O extends { title: string; legend: boolean; color?: string }> {
  readonly id = `numeric-${nextSeriesId++}`;
  protected items: NumericItem[] = [];
  protected dirty = true;
  /** Stored x values are `(x - xBase) / xUnit`: small numbers, so float32 on the GPU keeps them exact enough. */
  protected xBase = 0;
  protected xUnit = 1;
  private shown = true;

  constructor(
    protected readonly host: SeriesHost,
    public options: O,
  ) {}

  /** The items, sorted by x. */
  get data(): readonly NumericItem[] {
    return this.items;
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * Replace the items. They are sorted by x (a stable sort, so items with
   * the same x keep their order and draw a vertical jump). Items without a
   * finite `x` and `value` are left out and reported as `data:dropped`.
   */
  setData(items: readonly NumericItem[]): void {
    const kept: NumericItem[] = [];
    for (const item of items) {
      const ok = item !== null && typeof item === 'object' && Number.isFinite(item.x) && Number.isFinite(item.value);
      if (ok) kept.push(item.color === undefined ? { x: item.x, value: item.value } : { x: item.x, value: item.value, color: item.color });
      else this.host.dropped(this as unknown as NumericSeries, item);
    }
    kept.sort((a, b) => a.x - b.x);
    this.items = kept;
    const first = kept[0]?.x ?? 0;
    const last = kept[kept.length - 1]?.x ?? 0;
    const span = last - first;
    if (Number.isFinite(span)) {
      this.xBase = first;
      this.xUnit = storageUnit(span);
    } else {
      // Items spread over more than the float range: store x unshifted (x - base would overflow), scaled by their size.
      this.xBase = 0;
      this.xUnit = storageUnit(Math.max(Math.abs(first), Math.abs(last)));
    }
    this.dirty = true;
    this.changed();
    this.host.dataChanged(this as unknown as NumericSeries);
  }

  applyOptions(patch: Partial<O>): void {
    this.options = { ...this.options, ...patch };
    this.dirty = true;
    this.changed();
    this.host.invalidate();
  }

  /** Items or options changed: drop what was derived from them. */
  protected changed(): void {}

  setVisible(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.host.dataChanged(this as unknown as NumericSeries);
  }

  remove(): void {
    this.host.removeSeries(this as unknown as NumericSeries);
  }

  /** The series colour, resolved against the theme. */
  color(): string {
    return this.options.color ?? this.host.theme().line;
  }

  /** [lowest, highest] x of the items, or null without items. */
  extent(): [number, number] | null {
    const n = this.items.length;
    return n === 0 ? null : [this.items[0]!.x, this.items[n - 1]!.x];
  }

  /** Item range [a, b) with x in [lo, hi]. */
  protected span(lo: number, hi: number): [number, number] {
    return [firstAtOrAbove(this.items, lo), firstAbove(this.items, hi)];
  }

  /** The x transform for the stored values, from the scale's. */
  protected xUniform(x: NumericScale): [number, number] {
    const [s, o] = x.transform();
    return [s * this.xUnit, o + s * this.xBase];
  }

  /** The value shown for `x`: the legend value under the crosshair. */
  abstract valueAt(x: number): number | null;
  /** [min, max] of the values drawn over x in [lo, hi], or null when nothing is drawn there. */
  abstract valueRange(lo: number, hi: number): [number, number] | null;
  /** @internal */
  abstract draw(r: RenderBackend, view: DrawView): void;
  /** @internal Free GPU buffers. */
  abstract release(r: RenderBackend): void;
}

/** A line, step line or area on a `NumericChart`, from `addLine`. */
export class NumericLineSeries extends NumericSeriesBase<NumericLineOptions> {
  readonly type = 'line';
  private readonly batch = new LineBatch();

  valueAt(x: number): number | null {
    const items = this.items;
    const i = firstAbove(items, x) - 1;
    if (i < 0) return null;
    const a = items[i]!;
    if (a.x === x || this.options.lineType === 'step') return i === items.length - 1 && a.x !== x ? null : a.value;
    const b = items[i + 1];
    if (!b) return null;
    return a.value + ((b.value - a.value) * (x - a.x)) / (b.x - a.x);
  }

  valueRange(lo: number, hi: number): [number, number] | null {
    const [a, b] = this.span(lo, hi);
    // The neighbours outside the view: the line runs towards them.
    const from = Math.max(0, a - 1);
    const to = Math.min(this.items.length, b + 1);
    if (to - from < 1) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i < to; i++) {
      const v = this.items[i]!.value;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  }

  draw(r: RenderBackend, view: DrawView): void {
    const items = this.items;
    const batch = this.batch;
    if (this.dirty) {
      const { xBase, xUnit } = this;
      batch.build(
        items.length,
        (k) => (items[k]!.x - xBase) / xUnit,
        (k) => items[k]!.value,
        { step: this.options.lineType === 'step', breakGaps: false },
      );
      this.dirty = false;
    }
    if (items.length < 2) return;
    const [a, b] = this.span(Math.min(view.x.min, view.x.max), Math.max(view.x.min, view.x.max));
    const [first, end] = batch.vertexRange(a, b);
    const x = this.xUniform(view.x);
    const y = yUniform(view.y, batch.base);
    const color = this.color();
    if (this.options.area) {
      const gradient: FillGradient = [unitColor(withAlpha(color, 0.28)), unitColor(withAlpha(color, 0))];
      r.drawFill(batch, first, end, { x, y, log: [0, 0], to: view.height, gradient });
    }
    const { lineWidth, lineStyle } = this.options;
    const [on = 0, off = 0] = lineDash(lineStyle, lineWidth);
    if (on > 0) {
      batch.measure(
        first - 1,
        first,
        end + 1,
        (u) => u * x[0] + x[1],
        (v) => view.y.priceToY(v),
        on + off,
      );
    }
    r.drawLine(batch, first, end, { x, y, log: [0, 0], color: unitColor(color), width: lineWidth, dash: [on, off], join: this.options.lineType === 'step' ? 'miter' : 'round' });
  }

  release(r: RenderBackend): void {
    r.release(this.batch);
  }
}

/** Columns on a `NumericChart`, from `addHistogram`. */
export class NumericHistogramSeries extends NumericSeriesBase<NumericHistogramOptions> {
  readonly type = 'histogram';
  private readonly batch = new RectBatch();
  /** `columnWidth()`, kept until the items or options change; NaN when not worked out yet. */
  private width = NaN;

  /** Column width in x units. */
  columnWidth(): number {
    if (Number.isNaN(this.width)) this.width = this.#computeWidth();
    return this.width;
  }

  protected override changed(): void {
    this.width = NaN;
  }

  #computeWidth(): number {
    const set = this.options.columnWidth;
    if (set !== undefined && set > 0 && Number.isFinite(set)) return set;
    let gap = Infinity;
    for (let i = 1; i < this.items.length; i++) {
      const d = this.items[i]!.x - this.items[i - 1]!.x;
      if (d > 0 && d < gap) gap = d;
    }
    return Number.isFinite(gap) ? gap * 0.8 : 1;
  }

  valueAt(x: number): number | null {
    const items = this.items;
    if (items.length === 0) return null;
    const half = this.columnWidth() / 2;
    const i = firstAtOrAbove(items, x);
    // The nearest column whose width covers x.
    let best: NumericItem | null = null;
    for (const k of [i - 1, i]) {
      const item = items[k];
      if (item && Math.abs(item.x - x) <= half && (!best || Math.abs(item.x - x) < Math.abs(best.x - x))) best = item;
    }
    return best ? best.value : null;
  }

  valueRange(lo: number, hi: number): [number, number] | null {
    const half = this.columnWidth() / 2;
    const [a, b] = this.span(lo - half, hi + half);
    if (b <= a) return null;
    let min = this.options.base;
    let max = this.options.base;
    for (let i = a; i < b; i++) {
      const v = this.items[i]!.value;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  }

  draw(r: RenderBackend, view: DrawView): void {
    const items = this.items;
    const batch = this.batch;
    if (this.dirty) {
      const half = this.columnWidth() / 2;
      const { xBase, xUnit } = this;
      const { base } = this.options;
      const fallback = parseColor(this.color());
      batch.base = base;
      batch.resize(items.length);
      items.forEach((item, i) => {
        const color = item.color !== undefined ? parseColor(item.color) : fallback;
        batch.setSpan(i, (item.x - half - xBase) / xUnit, (item.x + half - xBase) / xUnit, base, item.value, color);
      });
      this.dirty = false;
    }
    if (items.length === 0) return;
    r.drawSpans(batch, 0, items.length, { x: this.xUniform(view.x), y: yUniform(view.y, batch.base), log: [0, 0], gap: 0 });
  }

  release(r: RenderBackend): void {
    r.release(this.batch);
  }
}

class PriceLineHandle implements NumericPriceLine {
  constructor(
    public options: NumericPriceLineOptions,
    private readonly chart: NumericChart,
    private readonly drop: (line: PriceLineHandle) => void,
  ) {}

  applyOptions(patch: Partial<NumericPriceLineOptions>): void {
    this.options = { ...this.options, ...patch };
    this.chart.invalidate();
  }

  remove(): void {
    this.drop(this);
  }
}

/** Space between an axis label and the plot, css px. */
const LABEL_INSET = 8;
/** Narrowest price axis, css px. */
const MIN_AXIS_WIDTH = 48;
/** Most decimals a default label shows; price formats accept up to 100. */
const MAX_DECIMALS = 20;
/** Wheel delta (px) that zooms by a factor of e. */
const WHEEL_ZOOM = 500;

/**
 * A chart whose horizontal axis is a plain number instead of time: order-book
 * depth (price on x), yield curves (maturity on x), option chains (strike on
 * x). It shares the time chart's WebGL2 renderer, theme tokens, fonts and
 * price formats, so both look alike side by side, but has none of its
 * time-based machinery: no candles, indicators, sessions, data source or
 * drawings. Make one with `createNumericChart`.
 */
export class NumericChart {
  readonly root: HTMLDivElement;
  options: NumericChartOptions;
  theme: ChartTheme;
  /** Plot area, css px: the chart minus the price axis (right) and the x axis (bottom). */
  plotWidth = 0;
  plotHeight = 0;
  width = 0;
  height = 0;
  dpr = 1;

  /** The scales are private: changing them must go through methods that redraw. */
  readonly #xScale: NumericScale;
  private readonly priceScale: PriceScale;
  private readonly series: NumericSeries[] = [];
  private readonly lines: PriceLineHandle[] = [];
  /** Attached primitives in attach order; replaced, not changed in place, so drawing can detach safely. */
  #primitives: { primitive: NumericPrimitive }[] = [];
  /** Runs primitive members, so one that throws cannot break a frame or `destroy()`. */
  readonly #guard = new PrimitiveGuard((error) => (this.#emitter.has('chart:error') ? this.#emitter.emit('chart:error', { error }) : console.error(error)));
  /** Crosshair label formats from the last render, for `NumericPrimitiveEnv`. */
  #xLabel: PriceFormatModel = decimalPriceFormat(2);
  #yLabel: PriceFormatModel = decimalPriceFormat(2);
  readonly #emitter = new Emitter<NumericChartEvents>((error, event) => this.#listenerFailed(error, event));
  private readonly renderer: RenderBackend;
  readonly #holder: ContextHolder;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly bottom: HTMLCanvasElement;
  private readonly top: HTMLCanvasElement;
  readonly #resizeObserver: ResizeObserver | null;
  private readonly visibility: IntersectionObserver | null = null;
  #xFormat: PriceFormatModel | null = null;
  #yFormat: PriceFormatModel | null = null;
  #axisWidth = MIN_AXIS_WIDTH;
  /** Crosshair in plot-relative css px, or null. */
  private crosshair: { x: number; y: number } | null = null;
  /** Set by `setCrosshairAt`: the crosshair in data terms, projected again on every render. */
  private mirror: NumericPoint | null = null;
  /** The view follows the data (no pan or zoom since the last fit). */
  #following = true;
  private frame = 0;
  #drag: { pointerId: number; lastX: number; moved: number } | null = null;
  #lastView: { from: number; to: number } | null = null;
  #destroyed = false;
  /** Resizes when the device pixel ratio changes without the container resizing. */
  readonly #dprWatch = pixelRatioWatch(() => this.dpr, () => this.resize());

  constructor(container: HTMLElement, options: NumericChartOptionsPatch = {}) {
    this.options = mergeOptions(defaultNumericChartOptions, options);
    this.theme = resolveTheme(this.options.theme);
    this.#syncFormats();
    this.#xScale = new NumericScale({ invert: this.options.horizontalScale.invert });
    this.priceScale = new PriceScale({ marginTop: this.options.priceScale.marginTop, marginBottom: this.options.priceScale.marginBottom });
    this.priceScale.invert = this.options.priceScale.invert;

    this.root = createRoot(container, 'pc-chart pc-numeric-chart');
    this.bottom = addLayer(this.root);
    this.glCanvas = addLayer(this.root);
    this.top = addLayer(this.root);
    // Set up WebGL before touching the container, so a browser without it gets a ChartError and an untouched container.
    contextBudget.reserve();
    const renderer = new GLRenderer(this.glCanvas, {
      lost: () => {},
      restored: () => {
        contextBudget.restored(this.#holder);
        this.invalidate();
      },
      restoreFailed: (error) => this.#emitter.emit('chart:error', { error }),
    });
    this.renderer = renderer;
    this.#holder = budgetEntry(renderer);
    this.visibility = watchInView(this.root, (inView) => contextBudget.setVisible(this.#holder, inView));
    this.#syncInteractive();
    this.#syncBackground();
    container.appendChild(this.root);
    this.#resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.#resizeObserver?.observe(this.root);
    this.resize();
  }

  /* ------------------------------ public API ------------------------------ */

  /** Subscribe to an event; returns the function that unsubscribes. */
  on<K extends keyof NumericChartEvents>(event: K, listener: (payload: NumericChartEvents[K]) => void): () => void {
    return this.#emitter.on(event, listener);
  }

  /** A line, step line (`lineType: 'step'`) or area (`area: true`). */
  addLine(options: Partial<NumericLineOptions> = {}): NumericLineSeries {
    const series = new NumericLineSeries(this.#seriesHost, {
      title: '',
      lineWidth: 2,
      lineStyle: 'solid',
      lineType: 'simple',
      area: false,
      legend: true,
      ...options,
    });
    this.series.push(series);
    this.invalidate();
    return series;
  }

  /** Columns from `base` to each item's value, centred on its x. */
  addHistogram(options: Partial<NumericHistogramOptions> = {}): NumericHistogramSeries {
    const series = new NumericHistogramSeries(this.#seriesHost, { title: '', base: 0, legend: true, ...options });
    this.series.push(series);
    this.invalidate();
    return series;
  }

  removeSeries(series: NumericSeries): void {
    const i = this.series.indexOf(series);
    if (i < 0) return;
    this.series.splice(i, 1);
    series.release(this.renderer);
    this.#dataChanged();
  }

  /** The series in drawing order (first drawn first). */
  getSeries(): readonly NumericSeries[] {
    return this.series;
  }

  /** A horizontal line at `price`, with an optional title and axis label. */
  addPriceLine(options: Partial<NumericPriceLineOptions> & Pick<NumericPriceLineOptions, 'price'>): NumericPriceLine {
    const line = new PriceLineHandle({ lineWidth: 1, lineStyle: 'dashed', title: '', axisLabel: true, ...options }, this, (l) => {
      const i = this.lines.indexOf(l);
      if (i >= 0) this.lines.splice(i, 1);
      this.invalidate();
    });
    this.lines.push(line);
    this.invalidate();
    return line;
  }

  /**
   * Draw `primitive` on the chart. Returns a function that detaches this
   * attachment only. Throws when it is attached already, and a `ChartError`
   * (`destroyed`) after `destroy()`; when its `attached` throws, it is not
   * attached and the error propagates.
   */
  attachPrimitive(primitive: NumericPrimitive): () => void {
    if (this.#destroyed) throw new ChartError('destroyed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'attachPrimitive() called after destroy()' : '');
    if (this.#primitives.some((e) => e.primitive === primitive)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Primitive is already attached' : '');
    const entry = { primitive };
    this.#primitives = [...this.#primitives, entry];
    try {
      const redraw = (): void => this.invalidate();
      primitive.attached?.({ requestRedraw: redraw, requestOverlayRedraw: redraw });
    } catch (err) {
      this.#primitives = this.#primitives.filter((e) => e !== entry);
      throw err;
    }
    this.invalidate();
    return () => this.#detachWhere((e) => e === entry);
  }

  detachPrimitive(primitive: NumericPrimitive): void {
    this.#detachWhere((e) => e.primitive === primitive);
  }

  /** Change options with a partial patch; `horizontalScale` and `priceScale` merge field by field. */
  applyOptions(patch: NumericChartOptionsPatch): void {
    const themePatch = patch.theme;
    this.options = mergeOptions(this.options, patch);
    if (themePatch) {
      // A theme patch changes only the tokens it names, like the time chart's.
      const typography = mergeTypography(this.theme.typography, themePatch.typography);
      const merged = { ...this.theme, ...themePatch, ...(typography && { typography }) };
      this.options.theme = merged;
      this.theme = resolveTheme(merged);
      this.#syncBackground();
      // Colours that follow the theme are baked into the histogram batches.
      for (const s of this.series) s.applyOptions({});
    }
    // Fonts may have changed the axis height.
    this.#layout();
    this.#syncFormats();
    this.#xScale.invert = this.options.horizontalScale.invert;
    this.priceScale.invert = this.options.priceScale.invert;
    this.priceScale.marginTop = this.options.priceScale.marginTop;
    this.priceScale.marginBottom = this.options.priceScale.marginBottom;
    if (patch.interactive !== undefined) this.#syncInteractive();
    if (!this.options.crosshair) this.setCrosshairAt(null);
    if (patch.horizontalScale?.margin !== undefined && this.#following) this.#fitX();
    this.invalidate();
    if (themePatch) this.#emitter.emit('theme:change', { theme: this.theme });
  }

  /** Show every series' items, with the horizontal margin; the view follows new data again until the next pan or zoom. */
  fitContent(): void {
    this.#following = true;
    this.#fitX();
    this.invalidate();
  }

  /** The visible x range, left to right in value (`from < to`, also when inverted). */
  getVisibleRange(): { from: number; to: number } {
    return { from: this.#xScale.min, to: this.#xScale.max };
  }

  /** Show `from` to `to` on the horizontal axis. The view then stays there when data changes. */
  setVisibleRange(range: { from: number; to: number }): void {
    const lo = Math.min(range.from, range.to);
    const hi = Math.max(range.from, range.to);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return;
    this.#following = false;
    this.#xScale.setRange(lo, hi);
    this.invalidate();
  }

  /** The price range the vertical axis shows, low to high. */
  getPriceRange(): { from: number; to: number } {
    const s = this.priceScale;
    return { from: Math.min(s.minPrice, s.maxPrice), to: Math.max(s.minPrice, s.maxPrice) };
  }

  /** The data position at chart-root css px, or null outside the plot. */
  pointAt(x: number, y: number): NumericPointerEvent | null {
    if (!(x >= 0 && x <= this.plotWidth && y >= 0 && y <= this.plotHeight) || this.plotWidth <= 0 || this.plotHeight <= 0) return null;
    return { x: this.#xScale.fromPixel(x), price: this.priceScale.yToPrice(y), point: { x, y } };
  }

  /** Chart-root css px of a data position; `y` is null without a price. Null before the chart has a size. */
  coordinateFor(x: number, price: number | null = null): { x: number; y: number | null } | null {
    if (this.plotWidth <= 0 || this.plotHeight <= 0 || !Number.isFinite(x)) return null;
    return { x: this.#xScale.toPixel(x), y: price === null || !Number.isFinite(price) ? null : this.priceScale.priceToY(price) };
  }

  /**
   * Put the crosshair at a data position, or remove it with null. It stays
   * at that position through pans, zooms and new data until the pointer moves.
   */
  setCrosshairAt(point: NumericPoint | null): void {
    this.mirror = point && Number.isFinite(point.x) && Number.isFinite(point.price) ? { x: point.x, price: point.price } : null;
    this.#setCrosshair(this.mirror ? this.#projectMirror() : null);
  }

  /** Re-read the container size; the chart also does this itself when the container resizes. */
  resize(): void {
    if (this.#destroyed) return;
    const sized = measureRoot(this, this.#dprWatch);
    if (sized === null) return;
    const { width, height } = this;
    for (const c of [this.bottom, this.glCanvas, this.top]) sizeCanvas(c, width, height, this.dpr);
    this.#layout();
    this.render();
    if (sized) this.#emitter.emit('chart:resize', { width, height });
  }

  /** Redraw on the next animation frame. */
  invalidate(): void {
    if (this.#destroyed || this.frame !== 0 || typeof requestAnimationFrame !== 'function') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#emitter.emit('chart:destroy', {});
    // Detach first: primitives may stop timers or subscriptions in `detached`.
    this.#detachWhere(() => true);
    this.#destroyed = true;
    this.#dprWatch.stop();
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.#resizeObserver?.disconnect();
    this.visibility?.disconnect();
    this.#listen(false);
    for (const s of this.series) s.release(this.renderer);
    this.series.length = 0;
    this.lines.length = 0;
    contextBudget.remove(this.#holder);
    this.renderer.destroy();
    this.renderer.loseContext();
    this.root.remove();
    this.#emitter.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  readonly #seriesHost: SeriesHost = {
    theme: () => this.theme,
    dataChanged: () => this.#dataChanged(),
    dropped: (series, item) => this.#emitter.emit('item:dropped', { series, item, reason: 'invalid' }),
    invalidate: () => this.invalidate(),
    removeSeries: (series) => this.removeSeries(series),
  };

  #detachWhere(test: (e: { primitive: NumericPrimitive }) => boolean): void {
    const gone = this.#primitives.filter(test);
    if (gone.length === 0) return;
    this.#primitives = this.#primitives.filter((e) => !test(e));
    for (const e of gone) this.#guard.call(e.primitive, 'detached', () => e.primitive.detached?.(), undefined);
    this.invalidate();
  }

  /** Coordinate functions for primitives, made once and read live. */
  readonly #envFns = {
    xToPixel: (x: number) => this.#xScale.toPixel(x),
    pixelToX: (px: number) => this.#xScale.fromPixel(px),
    priceToY: (price: number) => this.priceScale.priceToY(price),
    yToPrice: (y: number) => this.priceScale.yToPrice(y),
    formatX: (x: number) => this.#xLabel.format(x),
    formatPrice: (price: number) => this.#yLabel.format(price),
  };

  #primitiveEnv(): NumericPrimitiveEnv {
    const { plotWidth: width, plotHeight: height, dpr: pixelRatio, theme } = this;
    return { width, height, pixelRatio, theme, from: this.#xScale.min, to: this.#xScale.max, ...this.#envFns };
  }

  /** The `layer` primitives' plot drawing, in attach order, each clipped to the plot. */
  #drawPrimitives(ctx: CanvasRenderingContext2D, layer: PrimitiveLayer, env: NumericPrimitiveEnv): void {
    for (const { primitive } of this.#primitives) {
      if (!primitive.drawPlot || (primitive.layer ?? 'normal') !== layer) continue;
      this.#guard.draw(primitive, 'drawPlot', ctx, () => {
        ctx.beginPath();
        ctx.rect(0, 0, env.width, env.height);
        ctx.clip();
        primitive.drawPlot!(ctx, env);
      });
    }
  }

  #dataChanged(): void {
    if (this.#following) this.#fitX();
    this.invalidate();
  }

  #syncFormats(): void {
    const { horizontalScale, priceScale } = this.options;
    this.#xFormat = horizontalScale.format ? createPriceFormat(horizontalScale.format) : null;
    this.#yFormat = priceScale.format ? createPriceFormat(priceScale.format) : null;
  }

  #syncBackground(): void {
    setRootBackground(this.root, this.theme.background);
  }

  #syncInteractive(): void {
    this.#listen(this.options.interactive);
    this.root.tabIndex = this.options.interactive ? 0 : -1;
    if (!this.options.interactive) {
      this.#drag = null;
      this.setCrosshairAt(null);
    }
  }

  #listen(on: boolean): void {
    const handlers: [string, EventListener, AddEventListenerOptions?][] = [
      ['pointerdown', this.#onPointerDown as EventListener],
      ['pointermove', this.#onPointerMove as EventListener],
      ['pointerup', this.#onPointerUp as EventListener],
      ['pointercancel', this.#onPointerUp as EventListener],
      ['pointerleave', this.#onPointerLeave as EventListener],
      ['wheel', this.#onWheel as EventListener, { passive: false }],
      ['dblclick', this.#onDoubleClick as EventListener],
      ['keydown', this.#onKeyDown as EventListener],
    ];
    for (const [type, fn, opts] of handlers) {
      this.root.removeEventListener(type, fn);
      if (on) this.root.addEventListener(type, fn, opts);
    }
  }

  /** Fit the horizontal scale to the visible series' items. */
  #fitX(): void {
    const extent = this.#dataExtent();
    if (extent) this.#xScale.fit(extent[0], extent[1], this.options.horizontalScale.margin);
  }

  /** Plot size from the chart size and the price axis width. */
  #layout(): void {
    const font = resolveFont(this.theme, 'axis');
    const axisHeight = Math.round(font.fontSize + 2 * LABEL_INSET + 4);
    this.plotHeight = Math.max(0, this.height - axisHeight);
    this.plotWidth = Math.max(0, this.width - this.#axisWidth);
    this.#xScale.width = this.plotWidth;
    this.priceScale.height = this.plotHeight;
  }

  /** Fit the price scale to what is visible between the x scale's edges, primitives' ranges included. */
  #fitPrices(): void {
    const lo = this.#xScale.min;
    const hi = this.#xScale.max;
    let min = Infinity;
    let max = -Infinity;
    const add = (r: [number, number] | null | undefined): void => {
      if (!r || !(Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] <= r[1])) return;
      min = Math.min(min, r[0]);
      max = Math.max(max, r[1]);
    };
    for (const s of this.series) if (s.visible) add(s.valueRange(lo, hi));
    for (const { primitive } of this.#primitives) add(this.#guard.call(primitive, 'priceRange', () => primitive.priceRange?.(lo, hi), null));
    if (min <= max) this.priceScale.fit(min, max);
  }

  #priceTicks(): PriceTicks {
    const s = this.priceScale;
    const format = this.#yFormat;
    const align = format ? (step: number) => Math.max(step, format.axisStep(step, (s.minPrice + s.maxPrice) / 2)) : undefined;
    return priceTicks(Math.min(s.minPrice, s.maxPrice), Math.max(s.minPrice, s.maxPrice), this.plotHeight, 40, align);
  }

  /** The crosshair and legend format: the set format, else one decimal finer than the ticks. */
  #labelFormat(set: PriceFormatModel | null, ticks: PriceTicks): PriceFormatModel {
    return set ?? decimalPriceFormat(Math.min(MAX_DECIMALS, ticks.decimals + 1));
  }

  private render(): void {
    if (this.#destroyed) return;
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const font = resolveFont(this.theme, 'axis');
    this.#fitPrices();
    // The axis width follows its widest label; a change resizes the plot, which can change the fit.
    let yTicks = this.#priceTicks();
    this.#yLabel = this.#labelFormat(this.#yFormat, yTicks);
    const before = this.#primitiveEnv();
    // Labels off the visible prices take no axis width.
    const labels = this.#primitives
      .flatMap(({ primitive }) => this.#guard.call(primitive, 'priceAxisLabels', () => primitive.priceAxisLabels?.(before) ?? [], []))
      .filter((l) => {
        const y = this.priceScale.priceToY(l.price);
        return Number.isFinite(l.price) && y >= 0 && y <= this.plotHeight;
      });
    const width = this.#measureAxis(yTicks, font, labels);
    if (width !== this.#axisWidth) {
      this.#axisWidth = width;
      this.#layout();
      this.#fitPrices();
      yTicks = this.#priceTicks();
      this.#yLabel = this.#labelFormat(this.#yFormat, yTicks);
    }
    if (this.mirror) this.crosshair = this.#projectMirror();
    const xTicks = this.#xScale.ticks(Math.max(80, measureWidth(this.top, font, '0'.repeat(10))), this.#xFormat ?? undefined);
    this.#xLabel = this.#labelFormat(this.#xFormat, xTicks);
    const env = this.#primitiveEnv();
    this.#drawBottom(xTicks, yTicks, env);
    this.#drawSeries();
    this.#drawTop(xTicks, yTicks, font, env, labels);
    this.#emitView();
  }

  #measureAxis(ticks: PriceTicks, font: ResolvedFont, labels: readonly PriceAxisLabel[]): number {
    const format = this.#yFormat ?? decimalPriceFormat(Math.min(MAX_DECIMALS, ticks.decimals));
    let widest = 0;
    const fit = (text: string) => (widest = Math.max(widest, measureWidth(this.top, font, text)));
    for (const v of ticks.values) fit(format.format(v));
    for (const l of this.lines) if (l.options.axisLabel) fit(format.format(l.options.price));
    for (const l of labels) fit(l.text);
    return Math.max(MIN_AXIS_WIDTH, Math.ceil(widest + 2 * LABEL_INSET));
  }

  #drawBottom(xTicks: PriceTicks, yTicks: PriceTicks, env: NumericPrimitiveEnv): void {
    const ctx = context2d(this.bottom, this.dpr);
    if (!ctx) return;
    if (this.options.grid) {
      ctx.strokeStyle = this.theme.gridVertical ?? this.theme.grid;
      for (const v of xTicks.values) {
        const x = this.#xScale.toPixel(v);
        if (x >= 0 && x <= this.plotWidth) crispLine(ctx, x, 0, x, this.plotHeight, 1, this.dpr);
      }
      ctx.strokeStyle = this.theme.gridHorizontal ?? this.theme.grid;
      for (const v of yTicks.values) {
        const y = this.priceScale.priceToY(v);
        if (y >= 0 && y <= this.plotHeight) crispLine(ctx, 0, y, this.plotWidth, y, 1, this.dpr);
      }
    }
    this.#drawPrimitives(ctx, 'below', env);
  }

  #drawSeries(): void {
    const r = this.renderer;
    if (r.isLost || this.plotWidth <= 0 || this.plotHeight <= 0) return;
    r.beginFrame(this.dpr);
    const dpr = this.dpr;
    r.setPane({ x: 0, y: 0, width: Math.round(this.plotWidth * dpr), height: Math.round(this.plotHeight * dpr) });
    const view: DrawView = { x: this.#xScale, y: this.priceScale, height: this.plotHeight };
    for (const s of this.series) if (s.visible) s.draw(r, view);
    r.endFrame();
  }

  #drawTop(xTicks: PriceTicks, yTicks: PriceTicks, font: ResolvedFont, env: NumericPrimitiveEnv, labels: readonly PriceAxisLabel[]): void {
    const ctx = context2d(this.top, this.dpr);
    if (!ctx) return;
    const t = this.theme;
    const { plotWidth: w, plotHeight: h } = this;
    ctx.font = fontCss(font);
    ctx.textBaseline = 'middle';
    this.#drawPrimitives(ctx, 'normal', env);

    // Price lines, under the axes' labels.
    const yLabel = this.#yLabel;
    for (const line of this.lines) {
      const o = line.options;
      const y = this.priceScale.priceToY(o.price);
      if (!(y >= 0 && y <= h)) continue;
      const color = o.color ?? t.referenceLine;
      ctx.strokeStyle = color;
      ctx.setLineDash(lineDash(o.lineStyle, o.lineWidth));
      crispLine(ctx, 0, y, w, y, o.lineWidth, this.dpr);
      ctx.setLineDash([]);
      if (o.title) {
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        fillText(ctx, o.title, w - 4, y - font.fontSize / 2 - 2);
      }
    }

    // Axes.
    ctx.strokeStyle = t.separator;
    crispLine(ctx, w, 0, w, h, 1, this.dpr);
    crispLine(ctx, 0, h, w, h, 1, this.dpr);
    ctx.fillStyle = t.textMuted;
    ctx.textAlign = 'left';
    const yAxis = this.#yFormat ?? decimalPriceFormat(Math.min(MAX_DECIMALS, yTicks.decimals));
    for (const v of yTicks.values) {
      const y = this.priceScale.priceToY(v);
      if (y < font.fontSize / 2 || y > h - font.fontSize / 2) continue;
      fillNumerals(ctx, yAxis.format(v), w + LABEL_INSET, y, font.numerals);
    }
    ctx.textAlign = 'center';
    const xAxis = this.#xFormat ?? decimalPriceFormat(Math.min(MAX_DECIMALS, xTicks.decimals));
    const axisMid = h + (this.height - h) / 2;
    for (const v of xTicks.values) {
      const x = this.#xScale.toPixel(v);
      const text = xAxis.format(v);
      // Whole labels only: one that would run off the chart's left edge is left out.
      if (x < 0 || x > w || x < measureNumerals(ctx, text, font.numerals) / 2) continue;
      fillNumerals(ctx, text, x, axisMid, font.numerals);
    }
    for (const line of this.lines) {
      const o = line.options;
      const y = this.priceScale.priceToY(o.price);
      if (o.axisLabel && y >= 0 && y <= h) this.#pill(ctx, yLabel.format(o.price), w, y, o.color ?? t.referenceLine, font, 'price');
    }
    for (const l of labels) {
      const y = this.priceScale.priceToY(l.price);
      if (y >= 0 && y <= h) this.#pill(ctx, l.text, w, y, l.color, font, 'price', l.textColor ?? contrastText(l.color));
    }

    const cross = this.crosshair;
    if (cross && this.options.crosshair) {
      ctx.strokeStyle = t.crosshair;
      ctx.setLineDash([5, 4]);
      crispLine(ctx, cross.x, 0, cross.x, h, 1, this.dpr);
      crispLine(ctx, 0, cross.y, w, cross.y, 1, this.dpr);
      ctx.setLineDash([]);
    }
    this.#drawPrimitives(ctx, 'top', env);
    if (cross && this.options.crosshair) {
      this.#pill(ctx, yLabel.format(this.priceScale.yToPrice(cross.y)), w, cross.y, t.labelBackground, font, 'price');
      this.#pill(ctx, this.#xLabel.format(this.#xScale.fromPixel(cross.x)), cross.x, axisMid, t.labelBackground, font, 'x');
    }

    if (this.options.legend) this.#drawLegend(ctx, yLabel);
  }

  /** A label on an axis: on the price axis at `y`, or centred on `x` on the x axis. */
  #pill(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    background: string,
    font: ResolvedFont,
    axis: 'price' | 'x',
    color = this.theme.labelText,
  ): void {
    const tw = measureNumerals(ctx, text, font.numerals);
    const ph = font.fontSize + 8;
    const pw = axis === 'price' ? this.#axisWidth : tw + 2 * LABEL_INSET;
    const left = axis === 'price' ? x : Math.min(Math.max(x - pw / 2, 0), this.width - pw);
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.roundRect(left, y - ph / 2, pw, ph, 3);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    fillNumerals(ctx, text, left + (axis === 'price' ? LABEL_INSET : (pw - tw) / 2), y, font.numerals);
  }

  /** Titles, and each series' value under the crosshair while there is one. */
  #drawLegend(ctx: CanvasRenderingContext2D, format: PriceFormatModel): void {
    const font = resolveFont(this.theme, 'legend');
    ctx.font = fontCss(font);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const at = this.crosshair ? this.#xScale.fromPixel(this.crosshair.x) : null;
    let y = LABEL_INSET + font.fontSize / 2;
    for (const s of this.series) {
      if (!s.visible || !s.options.legend) continue;
      let x = LABEL_INSET;
      // A swatch in the series colour, then the title.
      ctx.fillStyle = s.color();
      ctx.fillRect(x, y - 1, 8, 2);
      x += 12;
      if (s.options.title) {
        ctx.fillStyle = this.theme.text;
        fillText(ctx, s.options.title, x, y);
        x += ctx.measureText(s.options.title).width + 6;
      }
      if (at !== null) {
        const value = s.valueAt(at);
        ctx.fillStyle = s.color();
        fillNumerals(ctx, value === null ? '–' : format.format(value), x, y, font.numerals);
      }
      y += font.fontSize + 6;
    }
  }

  #emitView(): void {
    const from = this.#xScale.min;
    const to = this.#xScale.max;
    if (this.#lastView && this.#lastView.from === from && this.#lastView.to === to) return;
    this.#lastView = { from, to };
    this.#emitter.emit('range:change', { from, to });
  }

  /** Where `mirror` is on the plot now, or null when it is off the plot. */
  #projectMirror(): { x: number; y: number } | null {
    const m = this.mirror;
    const at = m && this.coordinateFor(m.x, m.price);
    return at && at.y !== null && this.pointAt(at.x, at.y) ? { x: at.x, y: at.y } : null;
  }

  #setCrosshair(p: { x: number; y: number } | null): void {
    const same = p === this.crosshair || (p && this.crosshair && p.x === this.crosshair.x && p.y === this.crosshair.y);
    if (same) return;
    this.crosshair = p;
    this.#emitter.emit('crosshair:move', p ? this.pointAt(p.x, p.y) : null);
    this.invalidate();
  }

  #localPoint(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** The user moved the view: it stops following new data. */
  #moved(): void {
    this.#following = false;
    this.invalidate();
  }

  /** The x range of the visible series, histogram columns included, or null without items. */
  #dataExtent(): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.series) {
      if (!s.visible) continue;
      const e = s.extent();
      if (!e) continue;
      // Histogram columns reach half a column past their centres.
      const half = s.type === 'histogram' ? s.columnWidth() / 2 : 0;
      lo = Math.min(lo, e[0] - half);
      hi = Math.max(hi, e[1] + half);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** Pan by `dx` css px, keeping some data in view. */
  #panBy(dx: number): void {
    this.#xScale.pan(dx);
    this.#xScale.keepInView(this.#dataExtent());
    this.#moved();
  }

  /** Zoom by `factor` around `anchorPx`, keeping some data in view. */
  #zoomBy(factor: number, anchorPx?: number): void {
    const extent = this.#dataExtent();
    this.#xScale.zoom(factor, anchorPx, extent);
    this.#xScale.keepInView(extent);
    this.#moved();
  }

  readonly #onPointerDown = (e: PointerEvent): void => {
    contextBudget.use(this.#holder);
    if (e.button !== 0) return;
    const p = this.#localPoint(e);
    if (!this.pointAt(p.x, p.y)) return;
    this.#drag = { pointerId: e.pointerId, lastX: p.x, moved: 0 };
    this.root.setPointerCapture?.(e.pointerId);
  };

  readonly #onPointerMove = (e: PointerEvent): void => {
    const p = this.#localPoint(e);
    const drag = this.#drag;
    if (drag && drag.pointerId === e.pointerId) {
      const dx = p.x - drag.lastX;
      drag.lastX = p.x;
      drag.moved += Math.abs(dx);
      if (dx !== 0) this.#panBy(dx);
    }
    this.mirror = null;
    this.#setCrosshair(this.options.crosshair && this.pointAt(p.x, p.y) ? p : null);
  };

  readonly #onPointerUp = (e: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    this.#drag = null;
    if (e.type === 'pointerup' && drag.moved < 3) {
      const p = this.#localPoint(e);
      const at = this.pointAt(p.x, p.y);
      if (at) this.#emitter.emit('plot:click', at);
    }
  };

  readonly #onPointerLeave = (): void => {
    if (this.#drag) return;
    this.mirror = null;
    this.#setCrosshair(null);
  };

  readonly #onWheel = (e: WheelEvent): void => {
    contextBudget.use(this.#holder);
    const p = this.#localPoint(e);
    if (!this.pointAt(p.x, p.y)) return;
    e.preventDefault();
    // Lines (1) and pages (2) are much larger than pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.plotWidth : 1;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.#panBy(-e.deltaX * unit);
    else this.#zoomBy(Math.exp((e.deltaY * unit) / WHEEL_ZOOM), p.x);
  };

  readonly #onDoubleClick = (e: MouseEvent): void => {
    const p = this.#localPoint(e);
    if (this.pointAt(p.x, p.y)) this.fitContent();
  };

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    // Leave shortcuts with modifiers (browser zoom, app commands) alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = this.plotWidth * 0.1;
    switch (e.key) {
      case 'ArrowLeft':
        this.#panBy(step);
        break;
      case 'ArrowRight':
        this.#panBy(-step);
        break;
      case '+':
      case '=':
        this.#zoomBy(0.8);
        break;
      case '-':
        this.#zoomBy(1.25);
        break;
      case 'Home':
        this.fitContent();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  #listenerFailed(error: unknown, event: keyof NumericChartEvents): void {
    if (event === 'chart:error') {
      console.error(error);
      return;
    }
    this.#emitter.emit('chart:error', {
      error: new ChartError('listener-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `A "${String(event)}" listener threw` : '', { cause: error, context: { event } }),
    });
  }
}

/**
 * Create a chart whose horizontal axis is a number (a price, maturity or
 * strike) instead of time. Throws a `ChartError` (`webgl2-unavailable`)
 * without WebGL2, leaving `container` untouched.
 *
 * @example
 * ```ts
 * const chart = createNumericChart(el, { priceScale: { format: { type: 'percent', precision: 2 } } });
 * chart.addLine({ title: 'Yield' }).setData([
 *   { x: 0.25, value: 5.41 }, // maturity in years, yield in percent
 *   { x: 10, value: 4.31 },
 * ]);
 * ```
 */
export function createNumericChart(container: HTMLElement, options?: NumericChartOptionsPatch): NumericChart {
  return new NumericChart(container, options);
}

function mergeOptions(base: NumericChartOptions, patch: NumericChartOptionsPatch): NumericChartOptions {
  const { horizontalScale, priceScale, ...rest } = patch;
  const next: NumericChartOptions = {
    ...base,
    ...stripUndefined(rest),
    horizontalScale: { ...base.horizontalScale, ...stripUndefined(horizontalScale ?? {}) },
    priceScale: { ...base.priceScale, ...stripUndefined(priceScale ?? {}) },
  };
  // A `format: undefined` in a patch clears the format.
  if (horizontalScale && 'format' in horizontalScale && horizontalScale.format === undefined) delete next.horizontalScale.format;
  if (priceScale && 'format' in priceScale && priceScale.format === undefined) delete next.priceScale.format;
  return next;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A power of ten about a thousandth of `size`, to divide stored x by; 1 for a size that gives none. */
function storageUnit(size: number): number {
  const unit = 10 ** (Math.floor(Math.log10(size)) - 3);
  return Number.isFinite(unit) && unit > 0 ? unit : 1;
}

/** The y uniforms for values stored relative to `base` on a linear price scale. */
function yUniform(scale: PriceScale, base: number): [number, number] {
  const [ys, yo] = scale.yTransform();
  return [ys, yo + base * ys];
}

/** The canvas's 2D context, cleared and scaled to css px; null where there is none. */
function context2d(canvas: HTMLCanvasElement, dpr: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function measureWidth(canvas: HTMLCanvasElement, font: ResolvedFont, text: string): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * font.fontSize * 0.6;
  ctx.font = fontCss(font);
  return measureNumerals(ctx, text, font.numerals);
}

/** First index whose x is at least `x` (items sorted by x). */
function firstAtOrAbove(items: readonly NumericItem[], x: number): number {
  return bisect(items.length, (i) => items[i]!.x < x);
}

/** First index whose x is above `x`. */
function firstAbove(items: readonly NumericItem[], x: number): number {
  return bisect(items.length, (i) => items[i]!.x <= x);
}

export type { NumericSeriesBase };
