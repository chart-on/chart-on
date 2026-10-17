/**
 * Indicator contract. An indicator is a pure function over the main series'
 * bars (and optionally over data it fetches) with declared inputs and
 * outputs; the chart owns loading, syncing and rendering.
 */
import type { Bar, Time } from '../types';
import type { Interval, IntervalRange, SymbolInfo } from '../data/types';

import type { LineStyle, MarkerIcon, MarkerPosition, MarkerShape } from '../annotations/types';
import type { AutoscaleRule } from '../scales';
import type { SeriesPriceLineOptions } from '../series';

/** Price field (or a derived average) an indicator reads. */
export type SourceKey = 'open' | 'high' | 'low' | 'close' | 'volume' | 'hl2' | 'hlc3' | 'ohlc4';

/** The value of an indicator input: a number, a flag, or a string such as a source, colour or option. */
export type InputValue = number | boolean | string;

/**
 * Members every input has. `visible`, `disabled` and `validate` receive all of
 * the indicator's current input values; a settings form calls them on every
 * change (see `inputFields`).
 */
export interface InputBase {
  /** Unique within the indicator; no `.`, as it is part of the message key `input.<id>.<input>`. */
  id: string;
  label?: string;
  /**
   * Section the input belongs to in a settings form, e.g. `'Bands'`. Inputs
   * without one come first; groups follow in the order of their first input.
   */
  group?: string;
  /** False hides the input, e.g. "show this only when that one is on". Default shown. */
  visible?(inputs: Record<string, InputValue>): boolean;
  /** True shows the input but makes it read-only. Default enabled. */
  disabled?(inputs: Record<string, InputValue>): boolean;
  /**
   * The input changes what `fetch` / `subscribe` load: changing it drops the
   * fetched rows and fetches again, like listing it in `refetchOn.inputs`.
   */
  affectsData?: boolean;
  /**
   * Check a value that has the right type, e.g. against other inputs
   * (`fast < slow`). Return an error message, or null when it is fine.
   * Not called while the input is hidden.
   */
  validate?(value: InputValue, inputs: Record<string, InputValue>): string | null;
}

/** One choice of a `select` input; the form shows `label`, else the value. */
export interface SelectOption {
  value: string | number;
  label?: string;
}

/** An indicator input, by `type`: number, source, colour, flag, dropdown or free text, each with its default. */
export type InputDef =
  | (InputBase & { type: 'number'; default: number; min?: number; max?: number; step?: number })
  | (InputBase & { type: 'source'; default: SourceKey })
  | (InputBase & {
      type: 'color';
      default: string;
      /**
       * Which colour of a two-colour plot this is: `'up'` for values at or
       * above the base, `'down'` below. A form shows such inputs as a pair.
       */
      role?: 'up' | 'down';
    })
  | (InputBase & { type: 'boolean'; default: boolean })
  /** A dropdown: the value is one of the options' values. */
  | (InputBase & { type: 'select'; default: string | number; options: SelectOption[] })
  /** Free text, at most `maxLength` characters. */
  | (InputBase & { type: 'text'; default: string; maxLength?: number });

/** Bars as parallel columns; NaN marks a missing volume. */
export interface BarArrays {
  readonly length: number;
  readonly time: Float64Array;
  readonly open: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly close: Float64Array;
  readonly volume: Float64Array;
}

/** The fields every plot type of `PlotDef` has: its output id, title, colour and labels. */
export interface PlotBase {
  /** Key of the output array in `compute` results. */
  id: string;
  /** Legend label; omitted plots show only their value. */
  title?: string;
  color?: string;
  /** Id of a `color` input that overrides `color`. */
  colorInput?: string;
  /** Price-axis label for the last value (default true). */
  lastValueLabel?: boolean;
  /**
   * Price line across the pane at the plot's newest value, as the series
   * `priceLine` option: `true` for the default style (dotted, 1 px, the plot's
   * colour), an object to style it. Default off. Line, histogram and OHLC
   * plots only (OHLC at the close).
   */
  priceLine?: boolean | SeriesPriceLineOptions;
}

/**
 * A colour per bar for line, histogram and OHLC plots: `colorOutput` names an
 * output (which `compute` must return) holding, per bar, an index into
 * `palette`. That bar's column, or the line segment from it to the next bar,
 * takes the colour; NaN or an index outside the palette keeps the plot's own.
 * Set both or neither.
 */
export interface PointColors {
  palette?: string[];
  colorOutput?: string;
}

/**
 * Shifts a line or histogram plot `offset` whole bars along the time axis:
 * positive later (past the last bar too), negative earlier. Each value draws,
 * and reads in the legend, autoscale and hit tests, that many bars from the
 * bar it was computed for. A fill shifts with its first plot.
 */
export interface PlotOffset {
  offset?: number;
  /** Id of a `number` input that overrides `offset`, so it can change in settings. */
  offsetInput?: string;
}

/** An indicator plot, by `type`: how one of its outputs is drawn, as a line, a histogram, bars or candles, a background shade, bar colours or a shape. */
export type PlotDef =
  | (PlotBase & PointColors & PlotOffset & {
      type: 'line';
      lineWidth?: number;
      /** Solid, dashed or dotted stroke (default `'solid'`). */
      lineStyle?: LineStyle;
      /**
       * `'step'` holds each value until the next bar, then jumps; default
       * `'simple'` joins values straight. Either way a NaN value breaks the line.
       */
      lineType?: 'simple' | 'step';
    })
  | (PlotBase & PointColors & PlotOffset & {
      type: 'histogram';
      /** Colors by sign relative to `base` (default 0). */
      positiveColor?: string;
      negativeColor?: string;
      /** Ids of `color` inputs (usually with `role` `'up'` / `'down'`) that override `positiveColor` / `negativeColor`. */
      positiveColorInput?: string;
      negativeColorInput?: string;
      base?: number;
      /** Id of a `number` input that overrides `base`, so the base can change in settings. */
      baseInput?: string;
    })
  /**
   * Candles or bars from four outputs: the plot's own output (`id`) is the
   * close, and `open`, `high` and `low` name the other three, which `compute`
   * must return too. A bar draws only where all four are finite. Bars closing
   * at or above their open take `upColor`, the others `downColor`; wick and
   * outline follow the body, and a point colour (`palette` with
   * `colorOutput`) recolours the whole bar. `color` and `colorInput` are not
   * used. Autoscale reads high and low, the legend shows all four, and the
   * last-value label and `priceLine` the close. Zoomed out, a bucket shows its
   * first open, highest high, lowest low and last close.
   */
  | (PlotBase & PointColors & {
      type: 'ohlc';
      open: string;
      high: string;
      low: string;
      /** `'candles'` (default): bodies with wicks; `'bars'`: a high-low range with open and close ticks. */
      style?: 'candles' | 'bars';
      /** Default the theme's up and down colours. */
      upColor?: string;
      downColor?: string;
      /** Ids of `color` inputs (usually with `role` `'up'` / `'down'`) that override `upColor` / `downColor`. */
      upColorInput?: string;
      downColorInput?: string;
    })
  /**
   * Shades the full height of the indicator's pane behind each bar. The output
   * is an index into `palette` per bar; NaN, or an index outside it, leaves
   * the bar unshaded. Not in autoscale, the legend or the price axis.
   */
  | (PlotBase & {
      type: 'background';
      /** Colours the output picks from; use translucent ones, the series draw over them. */
      palette: string[];
    })
  /**
   * Recolours the main series' bars (body, wick and outline) over their own
   * colours. The output is an index into `palette` per bar; NaN, or an index
   * outside it, keeps the bar's colour. With several bar colour plots, the
   * last with a colour for a bar wins. Bars grouped while zoomed out keep
   * their default colours. Not in autoscale, the legend or the price axis.
   */
  | (PlotBase & {
      type: 'barColor';
      palette: string[];
    })
  /**
   * A bar marker on each bar whose output is a finite number; NaN (or
   * another non-finite value) draws nothing. Shapes share the bar marker
   * layer: its filter, zoom-out folding and `marker:hover` / `marker:click`
   * events (reported with the indicator's series), but are not part of
   * `annotations.getMarkers`. `color` and `colorInput` set the colour; without
   * either it is the marker default. Not in autoscale, the legend or the
   * price axis.
   */
  | (PlotBase & {
      type: 'shape';
      shape: MarkerShape;
      /**
       * Default as for a bar marker: `below` for `arrow-up` and `triangle-up`,
       * `above` otherwise. `above` and `below` sit next to the main series'
       * bar when the indicator is on its price scale, else next to the
       * indicator's other plots at that bar (and nowhere without one). With
       * `atPrice` the output is the price.
       */
      position?: MarkerPosition;
      /** Short text next to the shape; the content of a `label`, e.g. a character. */
      text?: string;
      /** Size multiplier (default 1). */
      size?: number;
      /** Drawn instead of the shape; kept by reference. */
      icon?: MarkerIcon;
      /** Event category for the marker filter and folding. */
      kind?: string;
    });

/**
 * A plot's style as the user set it, over what the definition declares. Each
 * member is optional: a missing one keeps the definition's value.
 */
export interface PlotStyle {
  /** Stroke width in css px, for line plots; positive. */
  lineWidth?: number;
  /** Solid, dashed or dotted stroke, for line plots. */
  lineStyle?: LineStyle;
  /**
   * False hides the plot: it draws nothing, leaves the legend, the price-axis
   * labels and autoscale, and fills next to it are hidden too. Default true.
   */
  visible?: boolean;
}

/** Area filled between two line plots. */
export interface FillDef {
  between: [string, string];
  color: string;
}

/** Values an indicator computes: one array per plot id, one value per bar, NaN where there is none. */
export type IndicatorOutputs = Record<string, Float64Array>;

/**
 * Fetched values aligned with the main bars, keyed by the definition's
 * `fields`: one array of `src.length` per field. A bar holds the last row
 * whose time falls inside it; NaN where no row does. Empty without `fields`.
 */
export type IndicatorData = Readonly<Record<string, Float64Array>>;

/** Another interval's bars an indicator reads (see `IndicatorDef.intervals`). */
export interface IndicatorInterval {
  /** Bar interval to load, longer than the chart's, e.g. `'1d'` on an intraday chart. */
  interval: Interval;
  /**
   * Bars of that interval needed before the chart's first bar, e.g. the length
   * of an RSI computed on them. The chart loads that many more, so the warm-up
   * stays off screen. Default 0.
   */
  lookback?: number;
  /**
   * Another symbol to load the bars of, e.g. an index to compare against.
   * Default the chart's symbol. Its bars are cached per symbol and interval,
   * so a switch of the chart's symbol keeps them, and its newest bar follows
   * the data source's `stream` when there is one (otherwise it stays as
   * loaded). They are read as `bars['<symbol>@<interval>']`.
   */
  symbol?: string;
}

/**
 * Bars of the intervals an indicator declares in `intervals`, oldest first,
 * keyed by interval (`'1d'`), or by symbol and interval (`'XYZ@1d'`) for an
 * entry with a `symbol`. Every declared entry is present: empty until it
 * loads, and while the chart interval is not shorter than it. For the
 * chart's symbol the newest bars are built from the chart's own bars, so they
 * follow every tick. A higher bar holds the chart bars from its time up to
 * the next higher bar's time.
 */
export type IntervalBars = Readonly<Record<string, BarArrays>>;

/**
 * One row of external data: its time in unix seconds, then one value per
 * entry of the definition's `fields`, in that order. Missing or non-finite
 * values read as NaN.
 */
export type IndicatorRow = readonly [time: Time, ...values: number[]];

/** Where an indicator with external data runs: the chart's symbol and interval, and its inputs. */
export interface IndicatorContext<I extends Record<string, InputValue> = Record<string, InputValue>> {
  symbol: SymbolInfo;
  interval: Interval;
  inputs: I;
}

/** One `fetch` call: the rows for bars in [from, to). */
export interface IndicatorFetchRequest<I extends Record<string, InputValue> = Record<string, InputValue>>
  extends IndicatorContext<I> {
  /** Time of the oldest bar wanted (inclusive), unix seconds. */
  from: Time;
  /** End of the range (exclusive), unix seconds. */
  to: Time;
  /**
   * Main bars in the range: about how many rows are expected. A size, not a
   * cap (rows may be missing or extra), hence not `limit` as in `BarsRequest`.
   */
  barCount: number;
  /** Aborted when the answer is no longer needed (symbol or interval switch, removal). */
  signal: AbortSignal;
  /**
   * Another symbol's bars for the same interval and range, loaded through the
   * chart's data source. Rejects when the chart has no data source. Named for
   * what it returns, without a `get` prefix, like the chart's other readers.
   */
  barsOf(symbol: string): Promise<Bar[]>;
}

/** When the chart drops fetched rows and fetches again. */
export interface IndicatorRefetchOn {
  /** On a symbol switch (default true). False keeps the rows: the data does not depend on the symbol. */
  symbol?: boolean;
  /** On an interval switch (default true). False keeps the rows and re-aligns them to the new bars. */
  interval?: boolean;
  /** Input ids whose change refetches (default none). Other inputs only recompute. */
  inputs?: string[];
}

/**
 * Load state of an indicator's external data: `idle` (nothing to fetch, e.g.
 * no `fetch`/`subscribe`, no data source yet, or an unsupported context),
 * `loading`, `loaded`, `empty` (no rows) or `error`.
 */
export type IndicatorStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

/**
 * Definition of an indicator type: its id and name, inputs, plots and fills,
 * where it draws, and the `compute` (and optional `update`) that produce its
 * values. Once registered, the indicator can be added by its id.
 *
 * @example
 * ```ts
 * const range: IndicatorDef<{ color: string }> = {
 *   id: 'range',
 *   name: 'Bar range',
 *   placement: 'pane',
 *   inputs: [{ id: 'color', type: 'color', default: '#2a9d8f' }],
 *   plots: [{ id: 'range', type: 'line', colorInput: 'color' }],
 *   compute: (src) => ({ range: src.high.map((h, i) => h - src.low[i]!) }),
 * };
 * chart.indicators.register(range);
 * chart.indicators.add('range');
 * ```
 */
export interface IndicatorDef<I extends Record<string, InputValue> = Record<string, InputValue>> {
  /**
   * Stable type id used when saving and restoring (e.g. 'sma'). Indicators
   * shipped in a third-party package prefix it with the package name:
   * 'my-lib/vwap-bands'. The first-party built-ins use bare ids. No `.`: it
   * is part of message keys such as `indicator.<id>`.
   */
  id: string;
  /**
   * Version of the inputs, a positive integer (default 1). Raise it when inputs
   * are renamed or change meaning, and add `migrate` for older saved state.
   */
  version?: number;
  /**
   * Upgrade inputs saved at `fromVersion` (lower than `version`) to the current
   * ones. The result is validated; values that still don't fit take their defaults.
   */
  migrate?(inputs: Record<string, InputValue>, fromVersion: number): Record<string, InputValue>;
  /** Indicator name, e.g. for a picker; the legend title starts with it by default. */
  name: string;
  /** One-sentence description shown in an indicator picker. */
  description?: string;
  /**
   * Picker category. The well-known ids are `'trend'`, `'momentum'`,
   * `'volatility'`, `'volume'` and `'profiles'`; any other string is a custom
   * category. Indicators without one are listed under "Other".
   */
  category?: string;
  /** Other names search matches, e.g. `['Bollinger Bands']` for "BB". */
  aliases?: string[];
  /**
   * Legend title built from the inputs, e.g. "RSI 14" for an RSI with guide levels.
   * Defaults to `name` followed by every number and source input ("SMA 20 close").
   */
  title?(inputs: I): string;
  /**
   * `overlay` draws on the price pane; `pane` gets its own pane. `either`
   * lets whoever adds it choose (the `placement` add option), and draws on the
   * price pane by default.
   */
  placement: 'overlay' | 'pane' | 'either';
  /**
   * Price scale id the plots draw on, in the indicator's pane (default
   * `'right'`, the main series' scale). `'left'` shows a left axis while the
   * indicator is visible; any other id is a scale of its own with no axis,
   * e.g. for an overlay in other units than price. `chart.indicators.add`
   * can override it per indicator.
   */
  priceScale?: string;
  inputs: InputDef[];
  plots: PlotDef[];
  fills?: FillDef[];
  /**
   * Range the indicator's own pane shows whatever the values, e.g.
   * `{ min: 0, max: 100 }` for an oscillator. The chart sets it as the pane
   * scale's `fixedRange` when it adds the indicator, so the price range API can
   * still change it. Only for `placement: 'pane'`.
   */
  fixedRange?: { min: number; max: number };
  /**
   * How the indicator's own pane fits its values, e.g. `{ centerOn: 0 }` for
   * a histogram around zero. The chart sets it as the pane scale's
   * `autoscaleRule` when it adds the indicator. Only for `placement: 'pane'`.
   */
  autoscaleRule?: AutoscaleRule;
  /** Fixed value decimals; defaults to the main series' format on overlays, else 2. */
  precision?: number;
  /**
   * Full compute over every bar. Return one array of `src.length` per plot id
   * (NaN = no value). Extra arrays, also `src.length` long, are kept and may
   * hold state for `update`.
   * May return a promise, e.g. when the work runs in a Web Worker.
   * `data` holds the fetched `fields`, aligned with the bars; `bars` holds the
   * bars of the declared `intervals` (see `alignSteps` and `formingSteps`).
   */
  compute(src: BarArrays, inputs: I, data: IndicatorData, bars: IntervalBars): IndicatorOutputs | Promise<IndicatorOutputs>;
  /**
   * Optional incremental path for live data: write the values for bar `index`
   * (always the last bar) into `out`, reading only `out[...][< index]`. Called
   * repeatedly while the last bar forms, and when a live row lands in it.
   * Without it every tick, appended bar and live row reruns `compute` over
   * all bars.
   */
  update?(src: BarArrays, inputs: I, index: number, out: IndicatorOutputs, data: IndicatorData, bars: IntervalBars): void;
  /**
   * Bars needed before the first valid value, e.g. `length - 1` for an SMA.
   * The chart loads that much more history, so the warm-up stays off screen.
   */
  lookback?(inputs: I): number;

  /* ----------------------- external data (all optional) ---------------------- */

  /**
   * Other intervals whose bars `compute` and `update` read as `bars[interval]`,
   * e.g. `[{ interval: '1d', lookback: 14 }]` for an RSI on daily bars. The
   * chart loads them for its symbol (or an entry's `symbol`) through its data
   * source, caches them per symbol and interval, loads older ones as history
   * pages in, and builds the newest higher bar of its own symbol from its own
   * bars, so it updates live without refetching. While the chart interval is
   * equal to or longer than one of them, the indicator draws nothing and says
   * why in its pane. May be combined with `fetch` or `subscribe`: `compute`
   * then gets both the rows and the bars.
   */
  intervals?(inputs: I): IndicatorInterval[];

  /**
   * Names of the values in each external row, in row order: `['oi']` reads
   * rows `[time, oi]` and gives `compute` `data.oi`. Required with `fetch`
   * or `subscribe`, and only allowed with one of them.
   */
  fields?: string[];
  /**
   * Load rows for bars in [`from`, `to`). The chart calls it for the loaded
   * range, again as older history pages in, for bars appended live when
   * there is no `subscribe`, and after a refetch or a data reset; it aborts
   * calls whose answer is no longer needed and ignores late answers. Rows
   * outside the range are dropped; a later row with the same time wins.
   */
  fetch?(request: IndicatorFetchRequest<I>): Promise<IndicatorRow[]>;
  /**
   * Stream live rows. A row replaces the one with the same time or adds a new
   * one. The chart re-subscribes when the symbol or interval changes, even
   * when `refetchOn` keeps the rows, and calls the returned function to
   * unsubscribe.
   */
  subscribe?(request: IndicatorContext<I>, onRow: (row: IndicatorRow) => void): () => void;
  /**
   * Most bars one `fetch` covers. Longer ranges are split into chunks that are
   * fetched in parallel and merged. Default: one call per range.
   */
  chunkBars?: number;
  /** Which context changes drop the fetched rows and fetch again (default symbol and interval). */
  refetchOn?: IndicatorRefetchOn;
  /**
   * Whether the indicator works in this context: true, or a reason shown in
   * its pane instead of fetching (e.g. "Funding rates are for perpetuals only").
   */
  supports?(context: IndicatorContext<I>): true | string;
}

/** Serializable indicator state. */
export interface IndicatorState {
  /**
   * The indicator's id on its chart (see `Indicator.id`); missing in sets
   * made by `serializeSet` and in layouts saved before ids, where loading
   * gives a new one.
   */
  id?: string;
  /** Definition id. */
  type: string;
  /** The definition's `version` when saved; missing means 1. */
  version?: number;
  inputs: Record<string, InputValue>;
  /** Pane index at the time of saving. */
  pane: number;
  visible: boolean;
  /** Price scale id given to `add`, when it overrode the definition's `priceScale`. */
  priceScale?: string;
  /** Intervals it shows on (see `Indicator.visibleOn`); missing means every interval. */
  visibleOn?: IntervalRange[];
  /** Plot styles set over the definition's, by plot id (see `Indicator.plotStyles`); missing means none. */
  plotStyles?: Record<string, PlotStyle>;
  /** The legend row shows only the title (see `chart.setLegendFolded`); missing means unfolded. */
  folded?: boolean;
}

export type { IntervalRange } from '../data/types';
