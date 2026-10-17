import {
  GroupBatch,
  Series,
  drawColoredLine,
  drawPolyline,
  fillGpu,
  narrowestBucket,
  opaque,
  resolvePriceLine,
  setOhlcRects,
  snapGroupedLine,
  strokeGpu,
  wholeBuckets,
  rectUniforms,
  yUniforms,
  type GpuStroke,
  type LastValue,
  type LegendEntry,
  type PaneEnv,
  type SeriesPriceLine,
} from '../series';
import { LINE_MERGES, bucketCenter, bucketRange, type Buckets, type GroupedLine, type LineField, type Pyramid } from '../lod';
import type { RenderBackend } from '../gl/backend';
import { RectBatch, RectKind } from '../gl/rect-batch';
import { LineBatch } from '../gl/line-batch';
import { parseColor, type Rgba } from '../util/color';
import { fillText, fontCss, resolveFont } from '../typography';
import { hitsValue } from '../pointer';
import { DEFAULT_PLOT_LINE_WIDTH } from './plot-style';
import type { IndicatorRunner } from './runner';
import { lowerBound } from '../timeline';
import { ColorPalette, buildLinePath, scratchPath } from '../line-path';
import type { BarMarker } from '../annotations/types';
import type { FillDef, PlotDef, PlotStyle } from './types';
import type { Bar } from '../types';
import type { PriceScale } from '../scales';
import { isText } from '../util/records';

/** The options of an `IndicatorSeries`, set from its indicator's definition and inputs. */
export interface IndicatorSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  format: (value: number) => string;
  /** Price scale id in the pane (default `'right'`). */
  priceScale?: string;
  /** Last-value labels on the price axis (default true); plots with `lastValueLabel: false` never show one. */
  lastValueLabel?: boolean;
  /** Tag each label with the indicator title, or the plot title when there are several plots. */
  axisTitle?: boolean;
  /** Where line plots and fills are drawn (default `'gpu'`); see `IndicatorAddOptions.renderer`. */
  renderer?: 'canvas' | 'gpu';
}

type HistogramPlot = Extract<PlotDef, { type: 'histogram' }>;
type LinePlot = Extract<PlotDef, { type: 'line' }>;
type ShapePlot = Extract<PlotDef, { type: 'shape' }>;
type BarColorPlot = Extract<PlotDef, { type: 'barColor' }>;
type OhlcPlot = Extract<PlotDef, { type: 'ohlc' }>;
/** Plots whose outputs are prices: drawn as lines, columns or bars. */
type ValuePlot = LinePlot | HistogramPlot | OhlcPlot;
type Ohlc = Pick<Bar, 'open' | 'high' | 'low' | 'close'>;

/** What a bucket of an OHLC plot's bars shows. */
const OHLC_MERGES = { open: 'first', high: 'max', low: 'min', close: 'last' } as const;
/** Body width of OHLC plot candles, in bars: the main series' default. */
const OHLC_BODY = 0.7;
/** `bar`, or null when one of its values is not finite: nothing is drawn there. */
const drawn = (bar: Ohlc): Ohlc | null => (Number.isFinite(bar.open + bar.high + bar.low + bar.close) ? bar : null);

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** Indicator outputs are one per bar, so their lines join from bar to bar: straight, or as steps. */
const SIMPLE = { step: false, breakGaps: false };
const STEP = { step: true, breakGaps: false };
const shapeOf = (plot: LinePlot) => (plot.lineType === 'step' ? STEP : SIMPLE);

/** Vertices of an indicator's lines and fills for the GPU, kept while it draws there. */
class GpuPlots {
  /** Line plots by id. */
  readonly lines = new Map<string, LineBatch>();
  /** Fills by position in the definition's `fills`, as bands between their two plots. */
  readonly fills: LineBatch[] = [];
  /** The same while the view groups bars, written each frame for the buckets on screen. */
  readonly groupedLines = new Map<string, LineBatch>();
  readonly groupedFills: LineBatch[] = [];
  /** First output whose vertices are out of date; Infinity when current. */
  stale = 0;

  line(id: string, grouped: boolean): LineBatch {
    const map = grouped ? this.groupedLines : this.lines;
    let batch = map.get(id);
    if (!batch) {
      batch = new LineBatch();
      map.set(id, batch);
    }
    return batch;
  }

  fill(i: number, grouped: boolean): LineBatch {
    const list = grouped ? this.groupedFills : this.fills;
    return (list[i] ??= new LineBatch());
  }

  all(): LineBatch[] {
    return [...this.lines.values(), ...this.fills, ...this.groupedLines.values(), ...this.groupedFills];
  }
}

/**
 * Draws every plot of one indicator. Outputs are aligned with the main series,
 * so output position `k` is timeline index `k`.
 */
export class IndicatorSeries extends Series<IndicatorSeriesOptions> {
  readonly kind = 'indicator';
  private readonly batches = new Map<string, RectBatch>();
  /** Coarser levels of each plot's values, made the first time the view groups bars. */
  readonly #levels = new Map<string, Pyramid<LineField>>();
  /** The same for OHLC plots' bars. */
  readonly #bars = new Map<string, Pyramid<keyof Ohlc>>();
  /** Grouped histogram columns per plot. */
  readonly #groups = new Map<string, GroupBatch>();
  /** Vertices of a grouped line, reused for every plot and frame; made the first time the view groups bars. */
  #grouped: GroupedLine | null = null;
  /** Line plots and fills as GPU vertices, unless `renderer: 'canvas'`. */
  readonly #gpu = new GpuPlots();
  /** External data is loading: the legend says so. */
  #loading = false;
  /** Shown in the middle of the pane, e.g. why the indicator is unavailable. */
  #message: string | null = null;
  /** Plot styles set over the definition's, by plot id (see `Indicator.plotStyles`). */
  #styles: Readonly<Record<string, PlotStyle>> = {};
  /** Markers of the shown shape plots, oldest first, and the output position of each. */
  readonly #shapes: BarMarker[] = [];
  readonly #shapeAt: number[] = [];
  /** The main series' bars are recoloured by this series' bar colour plots. */
  #recoloring = false;
  /** Colour ids of line plots' point colours, for the canvas path. */
  readonly #palette = new ColorPalette();

  constructor(
    host: ConstructorParameters<typeof Series>[0],
    pane: ConstructorParameters<typeof Series>[1],
    options: IndicatorSeriesOptions,
    private readonly runner: IndicatorRunner,
  ) {
    super(host, pane, options);
  }

  /**
   * Stop the runner, so a pending async compute cannot redraw a removed series
   * or destroyed chart, and free the histogram, line and fill batches' GPU objects.
   */
  override dispose(): void {
    this.runner.dispose();
    for (const batch of this.batches.values()) this.host.releaseGpu?.(batch);
    for (const group of this.#groups.values()) this.host.releaseGpu?.(group.batch);
    this.#releaseLines();
    this.batches.clear();
    this.#groups.clear();
    if (this.#shapes.length > 0) this.host.setPlotMarkers?.(this, []);
    if (this.#recoloring) this.host.setBarColors?.(this, null, 0);
  }

  /**
   * Single bars: free the grouped columns' GPU objects. Without the
   * `grouping()` plugin the grouped levels and columns go too; with it they
   * stay, so zooming back out does not rebuild them.
   */
  #ungrouped(): void {
    for (const group of this.#groups.values()) if (group.batch.gpu) this.host.releaseGpu?.(group.batch);
    if (this.host.groupLevels) return;
    this.#levels.clear();
    this.#bars.clear();
    this.#groups.clear();
    this.#grouped = null;
  }

  /** Free the line and fill vertices' GPU objects; they are rebuilt if drawn there again. */
  #releaseLines(): void {
    for (const batch of this.#gpu.all()) if (batch.gpu) this.host.releaseGpu?.(batch);
    this.#gpu.stale = 0;
  }

  get #linesOnGpu(): boolean {
    return this.options.renderer !== 'canvas';
  }

  /** @internal Loading marker for the legend and a message for the pane (null for none). */
  setStatus(loading: boolean, message: string | null): void {
    if (loading === this.#loading && message === this.#message) return;
    this.#loading = loading;
    this.#message = message;
    this.host.requestRender();
  }

  /** @internal The plot styles set over the definition's; the indicator keeps `styles` up to date. */
  setPlotStyles(styles: Readonly<Record<string, PlotStyle>>): void {
    this.#styles = styles;
    // A shape or bar colour plot shown or hidden.
    this.#refreshShapes(0);
    this.#refreshBarColors(0);
    this.host.requestRender();
  }

  get #plots(): PlotDef[] {
    return this.runner.def.plots;
  }

  /** Whether plot `plot` is drawn: not hidden through its style. */
  private shown(plot: PlotDef): boolean {
    return this.#styles[plot.id]?.visible !== false;
  }

  /**
   * Whether plot `plot` is shown and its outputs are prices (for autoscale,
   * legend, axis and hits): background and bar colour plots hold palette
   * indices, shape plots draw as bar markers.
   */
  #valued(plot: PlotDef): plot is ValuePlot {
    return plot.type !== 'background' && plot.type !== 'barColor' && plot.type !== 'shape' && this.shown(plot);
  }

  /** Shown or hidden, the bars' colours follow. */
  override setVisible(visible: boolean): void {
    super.setVisible(visible);
    this.#refreshBarColors(0);
  }

  /** Fills draw only while both of their plots do. */
  #fillShown(fill: FillDef): boolean {
    return fill.between.every((id) => this.#styles[id]?.visible !== false);
  }

  rebuild(): void {
    this.refresh(0);
  }

  /** Outputs follow the main series bar for bar; the runner reports changes. */
  override realign(): void {}

  /** Re-upload histogram columns for bars [from, length), and mark the line vertices from there stale. */
  refresh(from: number): void {
    const n = this.runner.length;
    this.#gpu.stale = Math.min(this.#gpu.stale, Math.max(0, from));
    // Outputs from `from` on changed: the grouped levels follow.
    for (const levels of [...this.#levels.values(), ...this.#bars.values()]) {
      if (from <= 0) levels.reset();
      else levels.update(from);
    }
    for (const group of this.#groups.values()) {
      if (from <= 0) group.reset();
      else group.changed(from);
    }
    for (const plot of this.#plots) {
      if (plot.type === 'ohlc') this.#refreshBars(plot, from, n);
      if (plot.type !== 'histogram') continue;
      const batch = this.#batch(plot.id);
      const base = this.#base(plot);
      const shift = this.#offset(plot.id);
      const values = this.#values(plot.id);
      batch.base = base;
      batch.resize(n);
      for (let k = Math.max(0, from); k < n; k++) {
        const v = values[k]!;
        // NaN columns stay in place (indices line up) but draw nothing.
        if (Number.isNaN(v)) batch.set(k, k + shift, base, base, RectKind.Column, TRANSPARENT);
        else batch.set(k, k + shift, base, v, RectKind.Column, parseColor(this.#colorAt(plot, k, v)));
      }
      if (from <= 0) batch.markAllDirty();
    }
    this.#refreshShapes(from);
    this.#refreshBarColors(from);
  }

  #batch(id: string): RectBatch {
    let batch = this.batches.get(id);
    if (!batch) {
      batch = new RectBatch();
      this.batches.set(id, batch);
    }
    return batch;
  }

  /** Rewrite OHLC plot `plot`'s bars from output `from` on; bars not drawn stay in place, clear. */
  #refreshBars(plot: OhlcPlot, from: number, n: number): void {
    const batch = this.#batch(plot.id);
    const per = plot.style === 'bars' ? 3 : 2;
    if (from <= 0) batch.base = this.#values(plot.id).find(Number.isFinite) ?? 0;
    batch.resize(n * per);
    for (let k = Math.max(0, from); k < n; k++) this.#writeBar(batch, plot, k * per, k, this.#bar(plot, k), k);
    if (from <= 0) batch.markAllDirty();
  }

  /** Bar `bar` of OHLC plot `plot` (null: none) at timeline `index` from instance `o`, coloured as output `k`. */
  #writeBar(batch: RectBatch, plot: OhlcPlot, o: number, index: number, bar: Ohlc | null, k: number): void {
    const ticks = plot.style === 'bars';
    if (bar) return setOhlcRects(batch, o, index, bar, ticks, parseColor(this.#barColor(plot, k, bar)));
    for (let m = ticks ? 2 : 1; m >= 0; m--) batch.set(o + m, index, batch.base, batch.base, RectKind.Body, TRANSPARENT);
  }

  /** OHLC plot `plot` at output `k`, or null where one of its four values is not finite (nothing drawn). */
  #bar(plot: OhlcPlot, k: number): Ohlc | null {
    return drawn({ open: this.#values(plot.open)[k]!, high: this.#values(plot.high)[k]!, low: this.#values(plot.low)[k]!, close: this.#values(plot.id)[k]! });
  }

  /** The grouped levels of OHLC plot `plot`, made on first use; bars not drawn count as NaN. */
  #barsOf(plot: OhlcPlot): Pyramid<keyof Ohlc> {
    let levels = this.#bars.get(plot.id);
    if (!levels) {
      levels = this.host.groupLevels!.pyramid(OHLC_MERGES, {
        count: () => this.runner.length,
        index: (k) => k,
        itemAt: (index) => (index >= 0 && index < this.runner.length ? index : -1),
        value: (k, field) => this.#bar(plot, k)?.[field] ?? NaN,
      });
      this.#bars.set(plot.id, levels);
    }
    return levels;
  }

  /** Bucket `j` of `g` of OHLC plot `plot` as one bar, or null when it draws nothing. */
  #groupedBar(plot: OhlcPlot, j: number, g: Buckets): Ohlc | null {
    // An empty bucket's open is NaN.
    const levels = this.#barsOf(plot);
    return drawn({ open: levels.get(g, j, 'open'), high: levels.get(g, j, 'high'), low: levels.get(g, j, 'low'), close: levels.get(g, j, 'close') });
  }

  /** OHLC plot `plot`'s bar at timeline `index` as drawn: grouped, its bucket's. */
  #barAt(plot: OhlcPlot, index: number): Ohlc | null {
    const g = this.host.buckets;
    return g ? this.#groupedBar(plot, g.of(index), g) : this.#bar(plot, index);
  }

  /** The colour of `bar`, drawn for output `k`: its point colour, else up or down. */
  #barColor(plot: OhlcPlot, k: number, bar: Ohlc): string {
    return this.#pointColor(plot, k) ?? this.#upDown(plot, bar.close >= bar.open);
  }

  #upDown(plot: OhlcPlot, up: boolean): string {
    const theme = this.host.theme;
    return up
      ? (this.#inputColor(plot.upColorInput) ?? plot.upColor ?? theme.up)
      : (this.#inputColor(plot.downColorInput) ?? plot.downColor ?? theme.down);
  }

  /** Plot `plot`'s value at output `k` (an OHLC plot's close where its bar draws), NaN for none. */
  #valueAt(plot: ValuePlot, k: number): number {
    return plot.type === 'ohlc' ? (this.#bar(plot, k)?.close ?? NaN) : (this.#values(plot.id)[k] ?? NaN);
  }

  /** Recolour the main series' bars from output `from` on with the shown bar colour plots, or give them their colours back. */
  #refreshBarColors(from: number): void {
    const plots = this.visible ? this.#plots.filter((plot): plot is BarColorPlot => plot.type === 'barColor' && this.shown(plot)) : [];
    if (plots.length === 0 && !this.#recoloring) return;
    this.#recoloring = plots.length > 0;
    const at = (i: number) => {
      let color: string | undefined;
      // An index outside the palette (or NaN) is no entry.
      for (const plot of plots) color = plot.palette[this.runner.out[plot.id]?.[i] ?? NaN] ?? color;
      return color;
    };
    this.host.setBarColors?.(this, this.#recoloring ? at : null, Math.max(0, from));
  }

  /** Rebuild the shape plots' markers from output `from` on, keeping those before it. */
  #refreshShapes(from: number): void {
    const plots = this.#plots.filter((plot): plot is ShapePlot => plot.type === 'shape' && this.shown(plot));
    if (plots.length === 0 && this.#shapes.length === 0) return;
    const keep = lowerBound(this.#shapeAt, Math.max(0, from));
    this.#shapes.length = keep;
    this.#shapeAt.length = keep;
    const times = this.runner.src.time;
    const n = Math.min(this.runner.length, times.length);
    // Bar by bar, plots in definition order: the stacking order on a bar.
    for (let k = Math.max(0, from); k < n; k++) {
      for (const plot of plots) {
        const v = this.#values(plot.id)[k]!;
        if (!Number.isFinite(v)) continue;
        this.#shapes.push(this.#shapeMarker(plot, times[k]!, v));
        this.#shapeAt.push(k);
      }
    }
    this.host.setPlotMarkers?.(this, this.#shapes);
  }

  #shapeMarker(plot: ShapePlot, time: number, value: number): BarMarker {
    const m: BarMarker = { time, shape: plot.shape };
    const color = this.#inputColor(plot.colorInput) ?? plot.color;
    if (color !== undefined) m.color = color;
    if (plot.position !== undefined) m.position = plot.position;
    if (plot.position === 'atPrice') m.price = value;
    if (plot.text !== undefined) m.text = plot.text;
    if (plot.size !== undefined) m.size = plot.size;
    if (plot.icon !== undefined) m.icon = plot.icon;
    if (plot.kind !== undefined) m.kind = plot.kind;
    return m;
  }

  #values(id: string): Float64Array {
    return this.runner.out[id] ?? new Float64Array(this.runner.length).fill(NaN);
  }

  private color(plot: PlotDef): string {
    return this.#inputColor(plot.colorInput) ?? plot.color ?? this.host.theme.line;
  }

  /** The colour input's value; undefined without one or when empty, which means the default. */
  #inputColor(id: string | undefined): string | undefined {
    const input = id ? this.runner.inputs[id] : undefined;
    return isText(input) ? input : undefined;
  }

  /** Number input `id`'s value, else `fallback`. */
  #number(id: string | undefined, fallback: number): number {
    const input = id ? this.runner.inputs[id] : undefined;
    return typeof input === 'number' ? input : fallback;
  }

  /** A histogram's base: its number input's value, else `base`, else 0. */
  #base(plot: HistogramPlot): number {
    return this.#number(plot.baseInput, plot.base ?? 0);
  }

  /** Bars plot `id` is shifted by: output position `k` draws at timeline index `k` plus this. */
  #offset(id: string): number {
    const plot = this.#plots.find((p) => p.id === id);
    return plot?.type === 'line' || plot?.type === 'histogram' ? Math.round(this.#number(plot.offsetInput, plot.offset ?? 0)) : 0;
  }

  /** A fill's shift (its first plot's) and how many bars further on its second plot's values are read. */
  #fillShift(fill: FillDef): [shift: number, d: number] {
    const shift = this.#offset(fill.between[0]);
    return [shift, shift - this.#offset(fill.between[1])];
  }

  /** Output positions [a, b) of a plot shifted by `shift` on screen, `pad` bars either side; a later shift reaches past the last bar. */
  #onScreen(env: PaneEnv, shift: number, pad = 0): [number, number] {
    return this.#indexRange(env.from - pad - shift, screenEnd(env, shift) + pad - shift);
  }

  /** Buckets [ja, jb] of `g` holding a plot shifted by `shift` on screen, and a neighbour either side. */
  #bucketsOnScreen(env: PaneEnv, g: Buckets, shift: number): [number, number] {
    const size = this.runner.length > 0 ? g.of(this.runner.length - 1) + 1 : 0;
    const [a, b] = bucketRange(env.from - shift, screenEnd(env, shift) - shift, g, size);
    return [Math.max(0, a - 1), Math.min(size - 1, b + 1)];
  }

  /** Line plot `id` grouped by `g` over the buckets on screen, moved by its shift. */
  #groupedLine(id: string, env: PaneEnv, g: Buckets): GroupedLine {
    const shift = this.#offset(id);
    const line = (this.#grouped ??= this.host.groupLevels!.line()).fill(this.#levelsOf(id), g, env.from - shift, screenEnd(env, shift) - shift);
    for (let k = 0; shift !== 0 && k < line.length; k++) line.index[k]! += shift;
    return line;
  }

  #histogramColor(plot: HistogramPlot, value: number): string {
    const up = value >= this.#base(plot);
    const own = up
      ? (this.#inputColor(plot.positiveColorInput) ?? plot.positiveColor)
      : (this.#inputColor(plot.negativeColorInput) ?? plot.negativeColor);
    if (own) return own;
    // A histogram with no colours at all follows the theme's up and down colours.
    if (!plot.color && !plot.colorInput) return up ? this.host.theme.up : this.host.theme.down;
    return this.color(plot);
  }

  /** Plot `plot`'s colour at output position `k`, whose value is `v`: its point colour, else as without one. */
  #colorAt(plot: ValuePlot, k: number, v: number): string {
    return (
      this.#pointColor(plot, k) ??
      (plot.type === 'ohlc' ? this.#upDown(plot, v >= this.#values(plot.open)[k]!) : plot.type === 'histogram' ? this.#histogramColor(plot, v) : this.color(plot))
    );
  }

  /** The palette colour `colorOutput` picks at output position `k`; undefined for none. */
  #pointColor(plot: ValuePlot, k: number): string | undefined {
    // An index outside the palette (or NaN) is no entry.
    return plot.colorOutput ? plot.palette?.[this.runner.out[plot.colorOutput]?.[k] ?? NaN] : undefined;
  }

  /** The output position of the last bar in bucket `j` of `g`, whose colour the bucket shows. */
  #lastOf(g: Buckets, j: number): number {
    return Math.min(g.end(j), this.runner.length) - 1;
  }

  /** The grouped levels of plot `id`, made on first use. */
  #levelsOf(id: string): Pyramid<LineField> {
    let levels = this.#levels.get(id);
    if (!levels) {
      levels = this.host.groupLevels!.pyramid(LINE_MERGES, {
        count: () => this.runner.length,
        index: (k) => k,
        itemAt: (index) => (index >= 0 && index < this.runner.length ? index : -1),
        value: (k) => this.#values(id)[k]!,
      });
      this.#levels.set(id, levels);
    }
    return levels;
  }

  /** While the view groups bars: the value plot `id` shows for bucket `j` of `g` (its last). */
  #groupedValue(id: string, j: number, g: Buckets): number {
    const levels = this.#levelsOf(id);
    return j >= 0 && j < levels.size(g) && levels.count(g, j) > 0 ? levels.get(g, j, 'last') : NaN;
  }

  #indexRange(from: number, to: number): [number, number] {
    return [Math.max(0, Math.floor(from)), Math.min(this.runner.length, Math.ceil(to) + 1)];
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    const g = this.host.buckets;
    if (g) return this.#groupedRange(from, to, g, positiveOnly);
    const range = this.rangeBuilder.reset(positiveOnly);
    for (const plot of this.#plots) {
      if (!this.#valued(plot)) continue;
      const shift = this.#offset(plot.id);
      const [a, b] = this.#indexRange(from - shift, to - shift);
      const values = this.#values(plot.id);
      let any = false;
      for (let k = a; k < b; k++) {
        if (plot.type === 'ohlc') {
          const bar = this.#bar(plot, k);
          if (!bar) continue;
          range.add(bar.high);
          range.add(bar.low);
          continue;
        }
        const v = values[k]!;
        if (Number.isNaN(v)) continue;
        any = true;
        range.add(v);
      }
      // Histograms keep their base in view (unless a log scale cannot show it).
      if (any && plot.type === 'histogram') range.add(this.#base(plot));
    }
    return range.range;
  }

  /**
   * The range of the grouped plots over the buckets on screen: lines from the
   * levels in O(log n) buckets, histograms from the bucket columns drawn.
   */
  #groupedRange(from: number, to: number, g: Buckets, positiveOnly: boolean): [number, number] | null {
    const range = this.rangeBuilder.reset(positiveOnly);
    for (const plot of this.#plots) {
      if (!this.#valued(plot)) continue;
      const shift = this.#offset(plot.id);
      const [lo, hi] = wholeBuckets(g, from - shift, to - shift);
      if (plot.type !== 'histogram') {
        const extreme = (field: 'low' | 'high', op: 'min' | 'max') =>
          plot.type === 'ohlc' ? this.#barsOf(plot).extreme(field, op, lo, hi) : this.#levelsOf(plot.id).extreme(field, op, lo, hi);
        // Lowest and highest skip NaN; a log scale keeps only what it can show.
        const min = extreme('low', 'min');
        if (min !== Infinity) {
          range.add(min);
          range.add(extreme('high', 'max'));
        }
        continue;
      }
      const levels = this.#levelsOf(plot.id);
      const [ja, jb] = bucketRange(lo, hi, g, levels.size(g));
      let any = false;
      for (let j = ja; j <= jb; j++) {
        const v = levels.count(g, j) > 0 ? levels.get(g, j, 'last') : NaN;
        if (Number.isNaN(v)) continue;
        any = true;
        range.add(v);
      }
      if (any) range.add(this.#base(plot));
    }
    return range.range;
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    const g = this.host.buckets;
    const lines = this.#linesOnGpu;
    // Back on the canvas: let the line vertices go.
    if (!lines) this.#releaseLines();
    if (g) {
      this.#drawGroupedColumns(r, env, g);
      if (lines) this.#drawGroupedLinesGpu(r, env, g);
      return;
    }
    this.#ungrouped();
    this.#drawColumns(r, env);
    if (lines) this.#drawLinesGpu(r, env);
  }

  #drawColumns(r: RenderBackend, env: PaneEnv): void {
    for (const plot of this.#plots) {
      const batch = this.batches.get(plot.id);
      if ((plot.type !== 'histogram' && plot.type !== 'ohlc') || !batch || !this.shown(plot)) continue;
      const [a, b] = this.#onScreen(env, this.#offset(plot.id));
      const per = plot.type === 'ohlc' ? (plot.style === 'bars' ? 3 : 2) : 1;
      r.drawRects(batch, a * per, (b - a) * per, rectUniforms(this, env, batch, per > 1 ? OHLC_BODY : 1, per > 1 ? 1 : 0.8));
    }
  }

  /** Fills, then line plots, on the GPU; the vertices are built once and updated from the first changed output. */
  #drawLinesGpu(r: RenderBackend, env: PaneEnv): void {
    const gpu = this.#gpu;
    const n = this.runner.length;
    const from = gpu.stale;
    gpu.stale = Infinity;
    // Vertices hold output positions and draw `indexShift` (the offset) later. The batch stores
    // index - indexShift, so pass k + indexShift: a full build resets it to 0 first, a partial one keeps it.
    const at = (batch: LineBatch) => (k: number) => k + batch.indexShift;
    // Hidden plots and fills keep their vertices current, so they show again as they are.
    (this.runner.def.fills ?? []).forEach((fill, i) => {
      const batch = gpu.fill(i, false);
      const [shift, d] = this.#fillShift(fill);
      const top = this.#values(fill.between[0]);
      const bottom = this.#values(fill.between[1]);
      // A point reads the second plot `d` bars on, so a change there reaches back `d` points.
      if (from < Infinity || batch.shape === null) batch.buildBand(n, at(batch), (k) => top[k]!, (k) => bottom[k + d]!, Math.max(0, from - Math.max(0, d)));
      batch.indexShift = shift;
      if (!this.#fillShown(fill)) return;
      const [first, end] = batch.vertexRange(...this.#onScreen(env, shift, 1));
      fillGpu(r, env, this.scale, batch, first, end, 'band', [fill.color, fill.color]);
    });
    for (const plot of this.#plots) {
      // Lines with point colours stay on the canvas.
      if (plot.type !== 'line' || plot.colorOutput) continue;
      const batch = gpu.line(plot.id, false);
      const values = this.#values(plot.id);
      if (from < Infinity || batch.shape === null) batch.build(n, at(batch), (k) => values[k]!, shapeOf(plot), from);
      batch.indexShift = this.#offset(plot.id);
      if (!this.shown(plot)) continue;
      const [a, b] = this.#onScreen(env, batch.indexShift, 1);
      const [first, end] = batch.vertexRange(a, b);
      strokeGpu(r, env, this.scale, batch, first, end, batch.vertexOf(a + 1) - 1, this.stroke(plot));
    }
  }

  /** Fills and line plots grouped by `g` on the GPU, written each frame for the buckets on screen. */
  #drawGroupedLinesGpu(r: RenderBackend, env: PaneEnv, g: Buckets): void {
    (this.runner.def.fills ?? []).forEach((fill, i) => {
      if (!this.#fillShown(fill)) return;
      const batch = this.#gpu.fill(i, true);
      const [shift, top, bottom] = this.#groupedFill(fill, g);
      const [ja, jb] = this.#bucketsOnScreen(env, g, shift);
      const n = Math.max(0, jb - ja + 1);
      batch.buildBand(n, (k) => bucketCenter(g, ja + k) + shift, (k) => top(ja + k), (k) => bottom(ja + k));
      const [first, end] = batch.vertexRange(0, n);
      fillGpu(r, env, this.scale, batch, first, end, 'band', [fill.color, fill.color]);
    });
    for (const plot of this.#plots) {
      if (plot.type !== 'line' || plot.colorOutput || !this.shown(plot)) continue;
      const line = snapGroupedLine(this.#groupedLine(plot.id, env, g), env, this.scale);
      const batch = this.#gpu.line(plot.id, true);
      batch.build(line.length, (k) => line.index[k]!, (k) => line.value[k]!, shapeOf(plot));
      const [first, end] = batch.vertexRange(0, line.length);
      strokeGpu(r, env, this.scale, batch, first, end, batch.vertexOf(1) - 1, this.stroke(plot));
    }
  }

  /** How line plot `plot` is stroked, on either renderer. */
  private stroke(plot: LinePlot): GpuStroke & { lineType: 'simple' | 'step' } {
    const style = this.#styles[plot.id];
    const lineType = plot.lineType ?? 'simple';
    return {
      color: this.color(plot),
      lineWidth: style?.lineWidth ?? plot.lineWidth ?? DEFAULT_PLOT_LINE_WIDTH,
      lineStyle: style?.lineStyle ?? plot.lineStyle,
      lineType,
      step: lineType === 'step',
    };
  }

  /** Background plots: each bar's (or bucket's) palette colour over the pane's full height, a run of one colour as one rect. */
  override drawBelow(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const g = this.host.buckets;
    const time = env.time;
    for (const plot of this.#plots) {
      if (plot.type !== 'background' || !this.shown(plot)) continue;
      const values = this.#values(plot.id);
      let a: number;
      let b: number;
      if (g) {
        const size = this.runner.length > 0 ? g.of(this.runner.length - 1) + 1 : 0;
        const [ja, jb] = bucketRange(env.from, env.to, g, size);
        a = ja;
        b = jb + 1;
      } else [a, b] = this.#indexRange(env.from, env.to);
      // Bars span half a bar either side of their index; buckets span their indices.
      const left = (p: number) => time.indexToX((g ? g.start(p) : p) - 0.5);
      const right = (p: number) => time.indexToX((g ? g.end(p) : p + 1) - 0.5);
      let start = a;
      let color: string | undefined;
      for (let p = a; p <= b; p++) {
        const c = p < b ? plot.palette[g ? this.#groupedValue(plot.id, p, g) : values[p]!] : undefined;
        if (c === color) continue;
        if (color !== undefined) {
          ctx.fillStyle = color;
          ctx.fillRect(left(start), 0, right(p - 1) - left(start), env.height);
        }
        start = p;
        color = c;
      }
    }
  }

  /** Histogram plots grouped by `g`: one column per bucket, its last value, as wide as the narrowest bucket. */
  #drawGroupedColumns(r: RenderBackend, env: PaneEnv, g: Buckets): void {
    for (const plot of this.#plots) {
      if (plot.type === 'ohlc' && this.shown(plot)) this.#drawGroupedBars(r, env, g, plot);
      if (plot.type !== 'histogram' || !this.shown(plot)) continue;
      const levels = this.#levelsOf(plot.id);
      const size = levels.size(g);
      const group = this.#group(plot.id);
      const base = this.#base(plot);
      const shift = this.#offset(plot.id);
      const batch = group.batch;
      const from = group.begin(g, base);
      batch.resize(size);
      for (let j = from; j < size; j++) {
        const v = levels.count(g, j) > 0 ? levels.get(g, j, 'last') : NaN;
        if (Number.isNaN(v)) batch.set(j, bucketCenter(g, j) + shift, base, base, RectKind.Column, TRANSPARENT);
        else batch.set(j, bucketCenter(g, j) + shift, base, v, RectKind.Column, parseColor(this.#colorAt(plot, this.#lastOf(g, j), v)));
      }
      const [ja, jb] = bucketRange(env.from - shift, screenEnd(env, shift) - shift, g, size);
      if (jb < ja) continue;
      r.drawRects(batch, ja, jb - ja + 1, rectUniforms(this, env, batch, 1, 0.8 * narrowestBucket(g, ja, jb)));
    }
  }

  #group(id: string): GroupBatch {
    let group = this.#groups.get(id);
    if (!group) {
      group = new GroupBatch();
      this.#groups.set(id, group);
    }
    return group;
  }

  /** OHLC plot `plot` grouped by `g`: one bar per bucket, as wide as the narrowest bucket, coloured as its last bar. */
  #drawGroupedBars(r: RenderBackend, env: PaneEnv, g: Buckets, plot: OhlcPlot): void {
    const size = this.#barsOf(plot).size(g);
    const per = plot.style === 'bars' ? 3 : 2;
    const group = this.#group(plot.id);
    const batch = group.batch;
    const from = group.begin(g, this.batches.get(plot.id)?.base ?? 0);
    batch.resize(size * per);
    for (let j = from; j < size; j++) {
      this.#writeBar(batch, plot, j * per, bucketCenter(g, j), this.#groupedBar(plot, j, g), this.#lastOf(g, j));
    }
    const [ja, jb] = bucketRange(env.from, env.to, g, size);
    if (jb < ja) return;
    const w = narrowestBucket(g, ja, jb);
    r.drawRects(batch, ja * per, (jb - ja + 1) * per, rectUniforms(this, env, batch, OHLC_BODY * w, w));
  }

  override draw2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const g = this.host.buckets;
    // With `renderer: 'gpu'` fills and lines went there, except lines with point colours.
    const gpu = this.#linesOnGpu;
    if (g) this.#drawGroupedLines(ctx, env, g, gpu);
    else {
      for (const fill of gpu ? [] : (this.runner.def.fills ?? [])) {
        if (!this.#fillShown(fill)) continue;
        const [shift, d] = this.#fillShift(fill);
        const top = this.#values(fill.between[0]);
        const bottom = this.#values(fill.between[1]);
        const [a, b] = this.#onScreen(env, shift, 1);
        fillRuns(ctx, env, this.scale, fill, a, b, (k) => k + shift, (k) => top[k]!, (k) => bottom[k + d] ?? NaN);
      }
      for (const plot of this.#plots) {
        if (plot.type !== 'line' || (gpu && !plot.colorOutput) || !this.shown(plot)) continue;
        const values = this.#values(plot.id);
        const shift = this.#offset(plot.id);
        const [a, b] = this.#onScreen(env, shift, 1);
        // NaN values leave gaps in the line.
        this.#drawLine(ctx, env, plot, a, b, (k) => k + shift, (k) => values[k]!);
      }
    }
    if (this.#message) this.#drawMessage(ctx, env, this.#message);
  }

  /**
   * Line plot `plot` through positions [a, b) on the canvas. With point
   * colours each segment takes the colour of the bar it starts at (grouped,
   * of its bucket's last bar).
   */
  #drawLine(
    ctx: CanvasRenderingContext2D,
    env: PaneEnv,
    plot: LinePlot,
    a: number,
    b: number,
    index: (k: number) => number,
    value: (k: number) => number,
  ): void {
    const style = { ...this.stroke(plot), scale: this.scale };
    if (!plot.colorOutput) return drawPolyline(ctx, env, a, b, index, value, style);
    const palette = this.#palette;
    palette.trim();
    const g = this.host.buckets;
    // The output position a point was computed for, before its shift.
    const shift = this.#offset(plot.id);
    const at = (k: number) => (g ? this.#lastOf(g, g.of(Math.floor(index(k) - shift))) : index(k) - shift);
    const time = env.time;
    const path = buildLinePath(scratchPath, a, b, index, value, (i) => time.indexToX(i), (v) => style.scale.priceToY(v), style, {
      line: (k) => palette.id(this.#pointColor(plot, at(k))),
      fill: () => 0,
    });
    const { color, lineWidth, lineStyle, lineType } = style;
    drawColoredLine(ctx, env, path, { palette: palette.colors, color, lineWidth, lineStyle, lineType, gradient: false, area: false });
  }

  /**
   * Fill `fill` grouped by `g`: its shift and the edges' values per bucket.
   * The second plot is read at the bucket holding the bar `d` bars on.
   */
  #groupedFill(fill: FillDef, g: Buckets): [shift: number, top: (j: number) => number, bottom: (j: number) => number] {
    const [shift, d] = this.#fillShift(fill);
    return [
      shift,
      (j) => this.#groupedValue(fill.between[0], j, g),
      (j) => this.#groupedValue(fill.between[1], d ? g.of(g.start(j) + d) : j, g),
    ];
  }

  /** Fills and line plots grouped by `g`: fills between the plots' bucket values, lines through each bucket's range. */
  #drawGroupedLines(ctx: CanvasRenderingContext2D, env: PaneEnv, g: Buckets, gpu: boolean): void {
    for (const fill of gpu ? [] : (this.runner.def.fills ?? [])) {
      if (!this.#fillShown(fill)) continue;
      const [shift, top, bottom] = this.#groupedFill(fill, g);
      const [ja, jb] = this.#bucketsOnScreen(env, g, shift);
      fillRuns(ctx, env, this.scale, fill, ja, jb + 1, (j) => bucketCenter(g, j) + shift, top, bottom);
    }
    for (const plot of this.#plots) {
      if (plot.type !== 'line' || (gpu && !plot.colorOutput) || !this.shown(plot)) continue;
      const line = this.#groupedLine(plot.id, env, g);
      this.#drawLine(ctx, env, plot, 0, line.length, (k) => line.index[k]!, (k) => line.value[k]!);
    }
  }

  /**
   * @internal Whether a shown plot is drawn at timeline `index` within a few
   * px of pane-relative `y`: a line near its value (while grouped, anywhere in
   * its bucket's range), a histogram column from its base to its value.
   */
  hits(index: number, y: number): boolean {
    const toY = (price: number) => this.scale.priceToY(price);
    const g = this.host.buckets;
    for (const plot of this.#plots) {
      if (!this.#valued(plot)) continue;
      if (plot.type === 'ohlc') {
        const bar = this.#barAt(plot, index);
        if (bar && hitsValue({ kind: 'histogram', value: bar.high, base: bar.low }, y, toY)) return true;
        continue;
      }
      const base = plot.type === 'histogram' ? this.#base(plot) : null;
      // The output drawn at `index`.
      const k = index - this.#offset(plot.id);
      if (g) {
        const j = g.of(k);
        const levels = this.#levelsOf(plot.id);
        if (j < 0 || j >= levels.size(g) || levels.count(g, j) === 0) continue;
        // A span from one value to another: the column, or the bucket's low to high.
        const span =
          base === null
            ? { kind: 'histogram' as const, value: levels.get(g, j, 'high'), base: levels.get(g, j, 'low') }
            : { kind: 'histogram' as const, value: levels.get(g, j, 'last'), base };
        if (hitsValue(span, y, toY)) return true;
        continue;
      }
      const v = this.#values(plot.id)[k];
      if (v === undefined || Number.isNaN(v)) continue;
      if (hitsValue(base === null ? { kind: 'line', value: v } : { kind: 'histogram', value: v, base }, y, toY)) return true;
    }
    return false;
  }

  #drawMessage(ctx: CanvasRenderingContext2D, env: PaneEnv, message: string): void {
    const theme = env.theme;
    ctx.save();
    ctx.fillStyle = theme.textMuted;
    ctx.font = fontCss(resolveFont(theme, 'labels'));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillText(ctx, message, env.width / 2, env.height / 2, Math.max(0, env.width - 16));
    ctx.restore();
  }

  override legend(index: number): LegendEntry {
    const status: LegendEntry['parts'] = this.#loading ? [{ text: 'Loading…', color: this.host.theme.textMuted }] : [];
    return {
      title: this.options.title,
      parts: status.concat(this.#plots.filter((plot) => this.#valued(plot)).flatMap((plot) => {
        const g = this.host.buckets;
        // The output drawn at bar `index`.
        const k = Math.round(index) - this.#offset(plot.id);
        if (plot.type === 'ohlc') {
          const bar = this.#barAt(plot, k);
          const color = opaque(bar ? this.#barColor(plot, g ? this.#lastOf(g, g.of(k)) : k, bar) : this.#upDown(plot, true));
          return (['Open', 'High', 'Low', 'Close'] as const).map((field, i) => {
            const name = this.locale.text(`legend${field}`);
            return { label: i === 0 && plot.title ? `${plot.title} ${name}` : name, text: bar ? this.options.format(bar[field.toLowerCase() as keyof Ohlc]) : '—', color };
          });
        }
        // Grouped: the value and colour the bucket shows.
        const v = g ? this.#groupedValue(plot.id, g.of(k), g) : this.#values(plot.id)[k];
        const valid = v !== undefined && !Number.isNaN(v);
        const color = valid ? this.#colorAt(plot, g ? this.#lastOf(g, g.of(k)) : k, v) : this.color(plot);
        return {
          ...(plot.title ? { label: plot.title } : {}),
          text: valid ? this.options.format(v) : '—',
          color: opaque(color),
        };
      })),
    };
  }

  /** @internal One price line per shown line, histogram or OHLC plot with `priceLine` on. */
  override priceLines(visibleTo: number): SeriesPriceLine[] {
    const lines: SeriesPriceLine[] = [];
    if (!this.visible) return lines;
    for (const plot of this.#plots) {
      if (!this.#valued(plot)) continue;
      const shift = this.#offset(plot.id);
      const line = resolvePriceLine(plot.priceLine, visibleTo, (limit) => {
        // The newest value drawn at or before `limit`; outputs can end in NaN.
        for (let k = Math.min(limit - shift, this.runner.length - 1); k >= 0; k--) {
          const v = this.#valueAt(plot, k);
          if (!Number.isNaN(v)) return { value: v, color: opaque(this.#colorAt(plot, k, v)) };
        }
        return null;
      });
      if (line) lines.push(line);
    }
    return lines;
  }

  override lastValues(): LastValue[] {
    const k = this.runner.length - 1;
    const labels: LastValue[] = [];
    if (this.options.lastValueLabel === false) return labels;
    const several = this.#plots.length > 1;
    for (const plot of this.#plots) {
      if (plot.lastValueLabel === false || !this.#valued(plot)) continue;
      const v = this.#valueAt(plot, k);
      if (Number.isNaN(v)) continue;
      const label: LastValue = { value: v, text: this.options.format(v), color: opaque(this.#colorAt(plot, k, v)) };
      if (this.options.axisTitle) label.title = (several && plot.title) || this.options.title;
      labels.push(label);
    }
    return labels;
  }
}

/** Timeline index of the screen's last bar for a plot shifted by `shift`: past the last bar for a later shift. */
const screenEnd = (env: PaneEnv, shift: number) => (shift > 0 ? env.time.xToIndex(env.width) : env.to);

/** Fill `fill` between `top` and `bottom` over positions [a, b), drawn at timeline index `index`, one run of values at a time. */
function fillRuns(
  ctx: CanvasRenderingContext2D,
  env: PaneEnv,
  scale: PriceScale,
  fill: FillDef,
  a: number,
  b: number,
  index: (p: number) => number,
  top: (p: number) => number,
  bottom: (p: number) => number,
): void {
  const x = (p: number) => env.time.indexToX(index(p));
  ctx.fillStyle = fill.color;
  forEachRun(a, b, (p) => !Number.isNaN(top(p)) && !Number.isNaN(bottom(p)), (s, e) => {
    ctx.beginPath();
    for (let p = s; p < e; p++) ctx.lineTo(x(p), scale.priceToY(top(p)));
    for (let p = e - 1; p >= s; p--) ctx.lineTo(x(p), scale.priceToY(bottom(p)));
    ctx.closePath();
    ctx.fill();
  });
}

/** Call `draw` for each maximal run of positions in [a, b) where `ok` holds. */
function forEachRun(a: number, b: number, ok: (k: number) => boolean, draw: (start: number, end: number) => void): void {
  let start = -1;
  for (let k = a; k <= b; k++) {
    if (k < b && ok(k)) {
      if (start < 0) start = k;
    } else if (start >= 0) {
      draw(start, k);
      start = -1;
    }
  }
}
