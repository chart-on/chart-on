import { inIntervalRanges, intervalRangeOf } from '../data/interval';
import type { Pane } from '../pane';
import { checkMarker } from '../annotations/markers';
import { autoscaleRuleError } from '../scales';
import { validateInputDefs } from './inputs';
import { copyPlotStyles, fitPlotStyles, plotOverride, plotStyleError, resolvePlotStyle } from './plot-style';
import { resolveInputs, type IndicatorRunner } from './runner';
import type { IndicatorSeries } from './series';
import type { IndicatorDef, IndicatorState, IndicatorStatus, InputDef, InputValue, IntervalRange, PlotStyle } from './types';
import { isNumber, isText } from '../util/records';
import type { Localizer } from '../util/locale';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Price-axis label switches of one indicator. */
export interface IndicatorLabelOptions {
  /** Last-value labels of its plots on the price axis. */
  lastValueLabel: boolean;
  /** Tag each label with the indicator (or plot) title. */
  axisTitle: boolean;
}

/** What an indicator handle needs from its manager. */
export interface IndicatorOwner {
  remove(indicator: Indicator): void;
  paneIndex(pane: Pane): number;
  /** Inputs or visibility changed. */
  changed(indicator: Indicator): void;
  /** Something undo can take back changed without a `changed` (the label switches). */
  edited(indicator: Indicator): void;
  /** `status` or `message` changed. */
  statusChanged(indicator: Indicator): void;
  /** Nominal length of the chart's bar interval in seconds, or null while unknown. */
  intervalSeconds(): number | null;
  /** Move a live indicator's series onto price scale `id` of its pane. */
  setPriceScale(series: IndicatorSeries, def: IndicatorDef, id: string): void;
  /** Legend title in the chart's language (see `indicatorTitle`). */
  title(def: IndicatorDef, inputs: Record<string, InputValue>): string;
}

/** @internal What undo puts back after an edit: inputs, plot styles, intervals, price scale and label switches. */
export interface IndicatorEdits {
  inputs: Record<string, InputValue>;
  styles: Record<string, PlotStyle>;
  visibleOn: readonly IntervalRange[] | null;
  priceScale?: string;
  labels: IndicatorLabelOptions;
}

/** Loads an indicator's own data: fetched rows, or other intervals' bars. */
export interface IndicatorFeed {
  /** Follow the chart's symbol, interval, bars and the inputs. */
  sync(): void;
  /** Drop what was loaded and load it again. */
  refetch(): void;
}

/** The parts of an indicator whose definition is registered. */
export interface LiveIndicator {
  def: IndicatorDef;
  runner: IndicatorRunner;
  series: IndicatorSeries;
  /** Loads the external data, for definitions with `fetch`, `subscribe` or `intervals`. */
  feed: IndicatorFeed | null;
}

/**
 * Handle returned by `chart.indicators.add`. While its definition is not
 * registered (e.g. restored from saved state before the app registered it),
 * the indicator is `pending`: it keeps its saved state and draws nothing.
 */
export class Indicator<I extends Record<string, InputValue> = Record<string, InputValue>> {
  /** @internal Set while the definition is registered. */
  live: LiveIndicator | null = null;
  /** @internal Set once the indicator is no longer on the chart. */
  removed = false;
  private labels: IndicatorLabelOptions = { lastValueLabel: true, axisTitle: false };
  /** What the external data feed reports. */
  #feedStatus: { status: IndicatorStatus; message: string | null } = { status: 'idle', message: null };
  /** Set by `setError`; wins over the feed's status. */
  #appError: string | null = null;
  private shown: { status: IndicatorStatus; message: string | null } = { status: 'idle', message: null };
  /** The series `visibleOn` hides on the chart's interval, whatever `visible` says; null when none. */
  #hiddenSeries: IndicatorSeries | null = null;
  /** The user's visibility while `hiddenSeries` is hidden. */
  #keptVisible = true;
  /** Plot styles set over the definition's, by plot id; only what differs from it once live. */
  #styles: Record<string, PlotStyle>;

  constructor(
    /** @internal Saved state, used while pending. */
    public state: IndicatorState,
    /** @internal Options the indicator was added with. */
    readonly options: { priceScale?: string; legend?: boolean; persist?: boolean; renderer?: 'canvas' | 'gpu'; placement?: 'overlay' | 'pane' },
    private readonly owner: IndicatorOwner,
  ) {
    this.#styles = copyPlotStyles(state.plotStyles ?? {});
  }

  /**
   * The indicator's id, unique on its chart, e.g. `'ind-3'`: drawings tie to
   * it through `Drawing.indicator`. Saved with the indicator and kept by
   * `load`; copies and indicators added from a set get a new one.
   */
  get id(): string {
    return this.state.id ?? '';
  }

  /** Definition id. */
  get type(): string {
    return this.state.type;
  }

  /** True while the definition is not registered: nothing is drawn. False once removed. */
  get pending(): boolean {
    return this.live === null && !this.removed;
  }

  /** The definition, or null while pending. */
  get def(): IndicatorDef<I> | null {
    return (this.live?.def as unknown as IndicatorDef<I> | undefined) ?? null;
  }

  /** The series drawing the plots, or null while pending. */
  get series(): IndicatorSeries | null {
    return this.live?.series ?? null;
  }

  /**
   * Where the indicator draws: on the price pane (`'overlay'`) or in a pane of
   * its own (`'pane'`). Null while pending, since the definition decides.
   */
  get placement(): 'overlay' | 'pane' | null {
    return this.live ? (this.options.placement ?? null) : null;
  }

  /** The pane the plots are in, or null while pending. */
  get pane(): Pane | null {
    return this.live?.series.pane ?? null;
  }

  get inputs(): Readonly<I> {
    return (this.live?.runner.inputs ?? this.state.inputs) as I;
  }

  /** Whether the user shows the indicator; it may still be hidden on this interval (see `hiddenByInterval`). */
  get visible(): boolean {
    if (!this.live) return this.state.visible;
    return this.#offInterval ? this.#keptVisible : this.live.series.visible;
  }

  /**
   * Price scale id the plots draw on: the one given to `add`, else the
   * definition's `priceScale`, else `'right'`.
   */
  get priceScale(): string {
    return this.options.priceScale ?? this.live?.def.priceScale ?? 'right';
  }

  /**
   * Draw the plots on price scale `id` of their pane: `'right'` (the pane's
   * main scale), `'left'` (shows a left axis while the indicator is visible)
   * or any other id (a scale of its own, with no axis). Throws on an empty id.
   * Kept while pending and saved with the indicator.
   */
  setPriceScale(id: string): void {
    if (!isText(id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator priceScale must be a non-empty string, got ${String(id)}` : '');
    const live = this.live;
    // While pending the definition's scale is unknown, so only an equal override is a no-op.
    if (id === (live ? this.priceScale : this.options.priceScale)) return;
    this.options.priceScale = id;
    if (live) this.owner.setPriceScale(live.series, live.def, id);
    else this.state = { ...this.state, priceScale: id };
    if (!this.removed) this.owner.changed(this);
  }

  /** Latest output arrays (one value per bar, NaN = none), keyed by plot id. Empty while pending. */
  get values(): Readonly<Record<string, Float64Array>> {
    return this.live?.runner.out ?? {};
  }

  /** Bars needed before the first valid value (the definition's `lookback`); 0 while pending. */
  get lookback(): number {
    return this.live ? indicatorLookback(this.live.def, this.live.runner.inputs) : 0;
  }

  /**
   * Merge new input values and recompute. Throws on unknown or invalid inputs.
   * While pending, only values no input type accepts throw; the rest are kept
   * and checked once the definition is registered.
   */
  applyInputs(inputs: Partial<I>): void {
    const merged = { ...this.inputs, ...(inputs as Record<string, InputValue>) };
    const live = this.live;
    if (live) {
      const resolved = resolveInputs(live.def.inputs, merged);
      live.series.applyOptions({ title: this.owner.title(live.def, resolved) });
      live.runner.setInputs(resolved);
      // Refetches only when an input listed in `refetchOn` changed.
      live.feed?.sync();
    } else {
      for (const [id, value] of Object.entries(inputs as Record<string, unknown>)) {
        if (!isInputValue(value)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid value for indicator input "${id}": ${String(value)}` : '');
      }
      this.state = { ...this.state, inputs: merged };
    }
    if (!this.removed) this.owner.changed(this);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    if (!this.live) this.state = { ...this.state, visible };
    else if (this.#offInterval) this.#keptVisible = visible;
    else this.live.series.setVisible(visible);
    if (!this.removed) this.owner.changed(this);
  }

  /** Intervals the indicator shows on, or null for every interval. */
  get visibleOn(): readonly IntervalRange[] | null {
    const ranges = this.state.visibleOn;
    return ranges ? ranges.map((r) => ({ ...r })) : null;
  }

  /**
   * Show the indicator only on bar intervals inside `ranges` (null or `[]`:
   * every interval). Elsewhere it stays on the chart and in the legend, but
   * draws nothing. Throws on an invalid interval or a range whose `from` is
   * longer than its `to`. Kept while pending and saved with the indicator.
   */
  setVisibleOn(ranges: readonly IntervalRange[] | null): void {
    const next = ranges && ranges.length > 0 ? ranges.map(checkRange) : undefined;
    const { visibleOn: _old, ...rest } = this.state;
    this.state = next ? { ...rest, visibleOn: next } : rest;
    this.syncInterval();
    if (!this.removed) this.owner.changed(this);
  }

  /** @internal Whether the legend row shows only the title (see `chart.setLegendFolded`); saved with the indicator. */
  get legendFolded(): boolean {
    return this.state.folded === true;
  }

  /** @internal Fold or unfold the legend row; `chart.setLegendFolded` calls this for an indicator's series. */
  setLegendFolded(folded: boolean): void {
    if (folded === this.legendFolded) return;
    const { folded: _old, ...rest } = this.state;
    this.state = folded ? { ...rest, folded: true } : rest;
    if (!this.removed) this.owner.changed(this);
  }

  /** True while `visibleOn` excludes the chart's current interval, so nothing is drawn. */
  get hiddenByInterval(): boolean {
    return this.#offInterval;
  }

  /** A live series is hidden by `visibleOn`; a series the indicator had before (re-registered) is not its concern. */
  get #offInterval(): boolean {
    return this.#hiddenSeries !== null && this.#hiddenSeries === this.live?.series;
  }

  /** @internal Hide or show the series for the chart's current interval. */
  syncInterval(): void {
    const series = this.live?.series ?? null;
    const seconds = this.owner.intervalSeconds();
    const off = series !== null && seconds !== null && !inIntervalRanges(this.state.visibleOn, seconds);
    if (off === this.#offInterval) return;
    if (off) {
      this.#keptVisible = series!.visible;
      this.#hiddenSeries = series;
      series!.setVisible(false);
    } else {
      this.#hiddenSeries = null;
      series?.setVisible(this.#keptVisible);
    }
  }

  /**
   * Plot styles set over the definition's, by plot id: only the members that
   * differ from it. Empty when every plot draws as declared.
   */
  get plotStyles(): Readonly<Record<string, Readonly<PlotStyle>>> {
    return copyPlotStyles(this.#styles);
  }

  /**
   * The style plot `id` draws with: line width and style (line plots only) and
   * visibility, the definition's with `plotStyles` over it. Null for an
   * unknown plot, and while pending.
   */
  getPlotStyle(id: string): PlotStyle | null {
    const plot = this.live?.def.plots.find((p) => p.id === id);
    return plot ? resolvePlotStyle(plot, this.#styles[id]) : null;
  }

  /**
   * Set plot `id`'s line width, line style or visibility over the
   * definition's; members left out keep their current value, and a value
   * equal to the definition's stops overriding it. `null` puts the plot back
   * as declared. Throws on an unknown plot, an invalid value, or a line width
   * or style for a histogram. While pending the plot is not known yet: the
   * style is kept and checked once the definition is registered.
   * Saved with the indicator; input changes keep it.
   */
  setPlotStyle(id: string, style: PlotStyle | null): void {
    const live = this.live;
    const plot = live ? live.def.plots.find((p) => p.id === id) : null;
    if (live && !plot) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${live.def.id}" has no plot "${id}"` : '');
    const merged = style === null ? {} : { ...this.#styles[id], ...style };
    if (style !== null) {
      const error = plotStyleError(style, plot ?? null);
      if (error) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid style for indicator plot "${id}": ${error}` : '');
    }
    const next = plotOverride(merged, plot ?? null);
    const changed = JSON.stringify(next) !== JSON.stringify(this.#styles[id] ?? {});
    if (Object.keys(next).length > 0) this.#styles[id] = next;
    else delete this.#styles[id];
    if (!changed) return;
    live?.series.setPlotStyles(this.#styles);
    if (!this.removed) this.owner.changed(this);
  }

  /** @internal Going live with `def`: keep the plot styles that fit it, and return them for the series. */
  adoptPlotStyles(def: IndicatorDef): Readonly<Record<string, PlotStyle>> {
    this.#styles = fitPlotStyles(def, this.#styles);
    return this.#styles;
  }

  /** Price-axis label switches: `lastValueLabel` (default true) and `axisTitle` (default false). */
  get labelOptions(): Readonly<IndicatorLabelOptions> {
    return { ...this.labels };
  }

  /** Turn the indicator's last-value labels, or the title tag beside them, on or off. Kept while pending. */
  applyLabelOptions(options: Partial<IndicatorLabelOptions>): void {
    if (options.lastValueLabel !== undefined) this.labels.lastValueLabel = !!options.lastValueLabel;
    if (options.axisTitle !== undefined) this.labels.axisTitle = !!options.axisTitle;
    this.live?.series.applyOptions({ ...this.labels });
    if (!this.removed) this.owner.edited(this);
  }

  /** @internal The part of the state undo steps of edits keep. */
  get edits(): IndicatorEdits {
    const { priceScale } = this.options;
    const edits = { inputs: { ...this.inputs }, styles: copyPlotStyles(this.#styles), visibleOn: this.visibleOn, labels: this.labelOptions };
    return priceScale === undefined ? edits : { ...edits, priceScale };
  }

  /** @internal Put back `edits` taken earlier. */
  restoreEdits(edits: IndicatorEdits): void {
    this.#styles = copyPlotStyles(edits.styles);
    this.live?.series.setPlotStyles(this.#styles);
    this.applyLabelOptions(edits.labels);
    this.setVisibleOn(edits.visibleOn);
    const scale = edits.priceScale;
    if (scale !== this.options.priceScale) {
      this.setPriceScale(scale ?? this.live?.def.priceScale ?? 'right');
      // Back to no override: the definition's scale, as before.
      if (scale === undefined) {
        delete this.options.priceScale;
        const { priceScale: _scale, ...state } = this.state;
        this.state = state;
      }
    }
    this.applyInputs(edits.inputs as Partial<I>);
  }

  /**
   * Load state of the indicator's external data (`fetch` / `subscribe`):
   * `idle`, `loading`, `loaded`, `empty` or `error`. Indicators without
   * external data stay `idle` unless the app calls `setError`.
   */
  get status(): IndicatorStatus {
    return this.shown.status;
  }

  /**
   * Text shown in the indicator's pane, or null: the reason from `supports`,
   * a fetch error, or the message given to `setError`.
   */
  get message(): string | null {
    return this.shown.message;
  }

  /** Show an error from the app (e.g. its own data feed failed): status `error` and `message` in the pane. */
  setError(message: string): void {
    this.#appError = String(message);
    this.refreshStatus();
  }

  /** Clear an error set with `setError`; the status goes back to what the data feed reports. */
  clearError(): void {
    if (this.#appError === null) return;
    this.#appError = null;
    this.refreshStatus();
  }

  /** Drop the fetched rows (or other intervals' bars) and load them again; does nothing without `fetch`, `subscribe` or `intervals`. */
  refetch(): void {
    this.live?.feed?.refetch();
  }

  /** @internal The external data feed's state changed. */
  setFeedStatus(status: IndicatorStatus, message: string | null): void {
    this.#feedStatus = { status, message };
    this.refreshStatus();
  }

  /** @internal Push the current status to the series and tell listeners when it changed. */
  refreshStatus(): void {
    const next = this.#appError !== null ? { status: 'error' as const, message: this.#appError } : this.#feedStatus;
    this.live?.series.setStatus(next.status === 'loading', next.message);
    if (next.status === this.shown.status && next.message === this.shown.message) return;
    this.shown = { ...next };
    if (!this.removed) this.owner.statusChanged(this);
  }

  /** Remove the indicator, and its pane when it owns one. */
  remove(): void {
    this.owner.remove(this);
  }

  /** Current state; a pending indicator returns its saved state unchanged. */
  serialize(): IndicatorState {
    const live = this.live;
    const visibleOn = this.visibleOn;
    const ranges = visibleOn ? { visibleOn: [...visibleOn] } : {};
    const { plotStyles: _saved, ...state } = this.state;
    const styles = Object.keys(this.#styles).length > 0 ? { plotStyles: copyPlotStyles(this.#styles) } : {};
    if (!live) return { ...state, inputs: { ...state.inputs }, ...ranges, ...styles };
    return {
      id: this.id,
      type: live.def.id,
      version: live.def.version ?? 1,
      inputs: { ...live.runner.inputs },
      pane: this.owner.paneIndex(live.series.pane),
      visible: this.visible,
      ...ranges,
      ...(this.options.priceScale !== undefined ? { priceScale: this.options.priceScale } : {}),
      ...styles,
      ...(this.legendFolded ? { folded: true } : {}),
    };
  }
}

/** A copy of `range`; throws when it is not a valid interval range. */
function checkRange(range: IntervalRange): IntervalRange {
  const valid = intervalRangeOf(range);
  if (!valid) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid interval range ${JSON.stringify(range)}: needs intervals from <= to` : '');
  return valid;
}

/** A value some input type could accept: a finite number, a string or a boolean. */
function isInputValue(value: unknown): value is InputValue {
  return typeof value === 'string' || typeof value === 'boolean' || isNumber(value);
}

/**
 * Legend title: name followed by number and source inputs, e.g. "SMA 20 close".
 * The name is the message `indicator.<id>` in `localization`'s language, else `name`.
 */
export function indicatorTitle(
  def: IndicatorDef,
  inputs: Record<string, InputValue>,
  localization?: Pick<Localizer, 'text'>,
): string {
  if (def.title) return def.title(inputs);
  const shown = def.inputs.filter((d) => d.type === 'number' || d.type === 'source').map((d) => String(inputs[d.id]));
  return [localization?.text(`indicator.${def.id}`, undefined, def.name) ?? def.name, ...shown].join(' ');
}

/** The definition's lookback as a whole number of bars; 0 when missing, invalid or throwing. */
export function indicatorLookback(def: IndicatorDef, inputs: Record<string, InputValue>): number {
  let bars: unknown;
  try {
    bars = def.lookback?.(inputs);
  } catch {
    return 0;
  }
  return typeof bars === 'number' && bars > 0 && Number.isFinite(bars) ? Math.ceil(bars) : 0;
}

/** Throw early on definitions that cannot render. */
export function validateIndicatorDef(def: IndicatorDef): void {
  if (!isText(def.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Indicator definitions need a non-empty string id' : '');
  // Message keys are made from the id (`indicator.<id>.description`, `input.<id>.<input>`), so it has no dot.
  if (def.id.includes('.')) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator id "${def.id}" cannot contain "."` : '');
  const version = def.version ?? 1;
  if (!(Number.isInteger(version) && version >= 1)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" version must be a positive integer` : '');
  }
  validateInputDefs(def.id, def.inputs);
  const ids = new Set<string>();
  for (const plot of def.plots) {
    if (ids.has(plot.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" declares plot "${plot.id}" twice` : '');
    ids.add(plot.id);
    const named = (id: string | undefined, type: InputDef['type']) => {
      if (id && !def.inputs.some((d) => d.id === id && d.type === type)) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" plot "${plot.id}" names unknown ${type} input "${id}"` : '');
      }
    };
    const linked = [plot.colorInput];
    if (plot.type === 'histogram') {
      linked.push(plot.positiveColorInput, plot.negativeColorInput);
      named(plot.baseInput, 'number');
    }
    if (plot.type === 'ohlc') {
      linked.push(plot.upColorInput, plot.downColorInput);
      const ids = [plot.id, plot.open, plot.high, plot.low];
      if (!ids.every(isText) || new Set(ids).size < 4) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" ohlc plot "${plot.id}" needs open, high and low outputs other than its own and each other` : '');
      }
    }
    const offset = plot.type === 'line' || plot.type === 'histogram';
    const colored = offset || plot.type === 'ohlc';
    if (offset) {
      named(plot.offsetInput, 'number');
      if (plot.offset !== undefined && !Number.isInteger(plot.offset)) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" plot "${plot.id}" offset must be a whole number of bars` : '');
      }
    }
    if (colored && (plot.colorOutput !== undefined || plot.palette !== undefined) && !isText(plot.colorOutput)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" ${plot.type} plot "${plot.id}" needs a colorOutput with its palette` : '');
    }
    if ((plot.type === 'background' || plot.type === 'barColor' || (colored && plot.colorOutput)) && !(Array.isArray(plot.palette) && plot.palette.length > 0 && plot.palette.every((c) => typeof c === 'string'))) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" ${plot.type} plot "${plot.id}" needs a palette of colour strings` : '');
    }
    if (plot.type === 'shape') {
      if (typeof plot.shape !== 'string') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" shape plot "${plot.id}" needs a shape` : '');
      // The checks a bar marker gets, e.g. on its icon.
      try {
        checkMarker({ time: 0, price: 0, shape: plot.shape, ...(plot.icon ? { icon: plot.icon } : {}) });
      } catch (e) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" shape plot "${plot.id}": ${(e as Error).message}` : '');
      }
    }
    for (const id of linked) named(id, 'color');
  }
  if (def.priceScale !== undefined && !isText(def.priceScale)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" priceScale must be a non-empty string` : '');
  }
  const range = def.fixedRange;
  if (range !== undefined) {
    if (!(Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min < range.max)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" fixedRange needs finite min < max` : '');
    }
    // Overlays share the main price scale, where a range would be silently ignored.
    if (def.placement !== 'pane') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" fixedRange needs placement 'pane'` : '');
  }
  if (def.autoscaleRule !== undefined) {
    const error = autoscaleRuleError(def.autoscaleRule);
    if (error) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" autoscaleRule ${error}` : '');
    if (def.placement !== 'pane') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" autoscaleRule needs placement 'pane'` : '');
  }
  validateExternal(def);
  for (const fill of def.fills ?? []) {
    for (const id of fill.between) {
      if (!def.plots.some((p) => p.id === id && p.type === 'line')) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" fill references unknown line plot "${id}"` : '');
      }
    }
  }
}

/** Throw early on inconsistent external-data members. */
function validateExternal(def: IndicatorDef): void {
  const fields = def.fields;
  if (fields !== undefined) {
    if (!Array.isArray(fields) || fields.some((f) => !isText(f)) || new Set(fields).size !== fields.length) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" fields must be unique non-empty strings` : '');
    }
  }
  if ((def.fetch || def.subscribe) && !(fields && fields.length > 0)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" needs fields to name the values of its fetched rows` : '');
  }
  if (fields !== undefined && !def.fetch && !def.subscribe) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" fields need fetch or subscribe to load their rows` : '');
  }
  const chunk = def.chunkBars;
  if (chunk !== undefined && !(Number.isInteger(chunk) && chunk >= 1)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" chunkBars must be a positive integer` : '');
  }
  if (def.intervals !== undefined && typeof def.intervals !== 'function') {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" intervals must be a function` : '');
  }
  for (const id of def.refetchOn?.inputs ?? []) {
    if (!def.inputs.some((d) => d.id === id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${def.id}" refetchOn names unknown input "${id}"` : '');
  }
}
