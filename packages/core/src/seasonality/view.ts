import type { Chart, ChartOptions } from '../chart';
import { ComparedLoader } from '../data/compare';
import type { DataSource } from '../data/types';
import type { ChartError } from '../errors';
import { defaultFormat, type CandleSeries, type CandleSeriesOptions, type CustomSeries, type CustomSeriesDef, type LineSeries } from '../series';
import type { Bar, Time } from '../types';
import { MONTHS, TickWeight } from '../util/format';
import { createPriceFormat, type PriceFormat } from '../util/price-format';
import { withAlpha } from '../util/color';
import { computeSeasonality, defaultSeasonalOptions, type SeasonalData, type SeasonalOptions } from './math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

const DAY = 86400;

/** Line colours of the years, oldest first; the newest year is drawn thicker. */
const YEAR_COLORS = ['#f59e0b', '#22d3ee', '#e879f9', '#a3e635', '#fb7185', '#60a5fa', '#fb923c', '#2dd4bf'];

/** Options for `createSeasonality`: the seasonal comparison settings, where the daily bars come from, and the line colours. */
export interface SeasonalityOptions extends Partial<SeasonalOptions> {
  /** Symbol to load daily bars for, through `source`. */
  symbol?: string;
  /** Where `symbol` loads from. Defaults to the chart's data source (`chart.setDataSource`). */
  source?: DataSource;
  /** Daily bars to use instead of loading a symbol; `setBars` replaces them. */
  bars?: readonly Bar[];
  /** Year line colours, oldest year first; they repeat when there are more years. */
  colors?: readonly string[];
  /** Colour of the average path and its range. Defaults to the theme's `line`. */
  averageColor?: string;
  /** Shade the min/max range of the years around the average path (default true when `average` is set). */
  range?: boolean;
}

/** A seasonality view on a chart, from `createSeasonality`. */
export interface Seasonality {
  /** Settles once the first load finishes; rejects with the `ChartError` when it fails. */
  readonly ready: Promise<void>;
  /** The computed paths, or null before any bars arrived. */
  readonly data: SeasonalData | null;
  /** The years shown, oldest first. */
  readonly years: readonly number[];
  /** The line series of `year`, or null when it is not shown. */
  yearSeries(year: number): LineSeries | null;
  /** The average path's line series, or null without `average`. */
  readonly averageSeries: LineSeries | null;
  /** Show or hide one year. Only that line changes: the others and the average stay as they are. */
  setYearVisible(year: number, visible: boolean): void;
  isYearVisible(year: number): boolean;
  /** Replace the daily bars (for views made with `bars`). */
  setBars(bars: readonly Bar[]): void;
  /** Change options and recompute every path. */
  applyOptions(options: Partial<SeasonalOptions> & Pick<SeasonalityOptions, 'colors' | 'averageColor' | 'range'>): void;
  /** Remove the view's series and restore the chart's time labels. */
  dispose(): void;
}

/** One position of the years' range around the average path. */
interface RangePoint {
  time: Time;
  low: number;
  high: number;
}

/** The shaded min/max range of the years around the average path. */
const rangeSeries: CustomSeriesDef<RangePoint, { color?: string }> = {
  type: 'seasonalRange',
  priceRange: (p) => [p.low, p.high],
  draw(ctx, view) {
    const { items } = view;
    if (items.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < items.length; i++) {
      const { item, x } = items[i]!;
      if (i === 0) ctx.moveTo(x, view.priceToY(item.high));
      else ctx.lineTo(x, view.priceToY(item.high));
    }
    for (let i = items.length - 1; i >= 0; i--) ctx.lineTo(items[i]!.x, view.priceToY(items[i]!.item.low));
    ctx.closePath();
    ctx.fillStyle = withAlpha(view.options.color ?? view.theme.line, 0.12);
    ctx.fill();
  },
  legend: (p, o) => (p ? [{ label: 'L', text: o.format(p.low) }, { label: 'H', text: o.format(p.high) }] : []),
  lastValue: () => null,
};

/** Chart time of a window position: noon UTC of that day in the reference year, so any timezone keeps the date. */
function slotTime(start: Time, position: number): Time {
  return start + position * DAY + DAY / 2;
}

function slotOf(data: SeasonalData, time: Time): number {
  return Math.round((time - DAY / 2 - data.start) / DAY);
}

function percentText(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/**
 * Overlay each year's path through the same calendar window on `chart`: one
 * line per year, mapped onto the position in the window, and optionally the
 * average path with the range of the years. The time axis shows the window's
 * calendar (or trading-day numbers with `align: 'trading'`), and the crosshair
 * and legend show each year's value at that position.
 *
 * The view owns the chart's time axis, so give it a chart of its own: one
 * without a loaded symbol or main series data. Daily bars come from `symbol`
 * through the chart's data source (or `source`), paging back far enough for
 * the years asked for, or from `bars`.
 *
 * @example
 * ```ts
 * const chart = createChart(el, { plugins: [dataSource()] });
 * chart.setDataSource(source);
 * const view = createSeasonality(chart, { symbol: 'ABC', years: 5, normalize: 'percent', average: 'mean' });
 * await view.ready;
 * ```
 */
export function createSeasonality(chart: Chart, options: SeasonalityOptions = {}): Seasonality {
  return new SeasonalityView(chart, options);
}

class SeasonalityView implements Seasonality {
  readonly ready: Promise<void>;
  data: SeasonalData | null = null;
  private options: SeasonalityOptions;
  private bars: Bar[] = [];
  /** Price format the symbol came with, for `normalize: 'none'`. */
  #symbolFormat: PriceFormat | undefined;
  private readonly lines = new Map<number, LineSeries>();
  private readonly hidden = new Set<number>();
  #average: LineSeries | null = null;
  #range: CustomSeries<RangePoint, { color?: string }> | null = null;
  readonly #main: CandleSeries;
  readonly #ownMain: boolean;
  readonly #mainBefore: Partial<CandleSeriesOptions>;
  readonly #labelsBefore: Pick<ChartOptions, 'formatTime' | 'formatTimeTick'>;
  readonly #loader: ComparedLoader | null = null;
  readonly #unsubscribe: (() => void)[] = [];
  #disposed = false;

  constructor(
    private readonly chart: Chart,
    options: SeasonalityOptions,
  ) {
    this.options = { ...options };
    // Validate before touching the chart.
    computeSeasonality([], this.options);
    const controller = chart.data;
    if (controller && (controller.symbol || controller.loading)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'createSeasonality needs a chart without a loaded symbol: the view owns its time axis' : '');
    }
    if (chart.mainBars.length > 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'createSeasonality needs a chart whose main series has no data' : '');
    const source = options.source ?? controller?.source;
    if (options.symbol !== undefined && !source) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'createSeasonality: no data source to load the symbol from' : '');

    this.#ownMain = !chart.main;
    this.#main = chart.main ?? chart.addCandles();
    const { title, legend, lastValueLabel, animate, priceFormat } = this.#main.options;
    this.#mainBefore = { title, legend, lastValueLabel, animate, priceFormat };
    // The main series only carries the window's positions on the time axis.
    this.#main.applyOptions({ title: '', legend: false, lastValueLabel: false, animate: false });
    this.#main.setVisible(false);
    this.#labelsBefore = { formatTime: chart.options.formatTime, formatTimeTick: chart.options.formatTimeTick };
    chart.applyOptions({
      formatTime: (time) => this.#timeText(time),
      formatTimeTick: (time, weight) => this.#tickText(time, weight),
    });
    this.#unsubscribe.push(
      chart.on('series:visibility', ({ series, visible }) => {
        for (const [year, line] of this.lines) {
          if (line === series) {
            if (visible) this.hidden.delete(year);
            else this.hidden.add(year);
          }
        }
      }),
      chart.on('series:remove', ({ series }) => {
        for (const [year, line] of this.lines) if (line === series) this.lines.delete(year);
        if (series === this.#average) this.#average = null;
        if (series === this.#range) this.#range = null;
      }),
    );

    if (options.symbol !== undefined && source) {
      let failure: ChartError | null = null;
      const loader = new ComparedLoader(
        source,
        options.symbol,
        {
          setData: (bars) => this.setBars(bars),
          update: (bar) => this.#liveBar(bar),
          setPriceFormat: (format) => {
            this.#symbolFormat = format;
            if (this.data) this.render();
          },
        },
        (error) => (failure = error),
      );
      this.#loader = loader;
      this.ready = loader.load('1d', this.#oldestWanted()).then(() => {
        if (failure) throw failure;
      });
      // Callers may ignore `ready`; a failure then is not an unhandled rejection.
      this.ready.catch(() => {});
    } else {
      this.ready = Promise.resolve();
      if (options.bars) this.setBars(options.bars);
    }
  }

  get years(): readonly number[] {
    return this.data?.paths.map((p) => p.year) ?? [];
  }

  get averageSeries(): LineSeries | null {
    return this.#average;
  }

  yearSeries(year: number): LineSeries | null {
    return this.lines.get(year) ?? null;
  }

  setYearVisible(year: number, visible: boolean): void {
    if (visible) this.hidden.delete(year);
    else this.hidden.add(year);
    this.lines.get(year)?.setVisible(visible);
  }

  isYearVisible(year: number): boolean {
    return this.lines.has(year) && !this.hidden.has(year);
  }

  setBars(bars: readonly Bar[]): void {
    if (this.#disposed) return;
    this.bars = bars.slice();
    this.render();
  }

  applyOptions(options: Partial<SeasonalOptions> & Pick<SeasonalityOptions, 'colors' | 'averageColor' | 'range'>): void {
    const next = { ...this.options, ...options };
    computeSeasonality([], next); // throws on bad options before changing anything
    this.options = next;
    if (this.data) this.render();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#loader?.dispose();
    for (const off of this.#unsubscribe.splice(0)) off();
    for (const line of this.lines.values()) this.chart.removeSeries(line);
    this.lines.clear();
    if (this.#average) this.chart.removeSeries(this.#average);
    if (this.#range) this.chart.removeSeries(this.#range);
    this.#average = this.#range = null;
    this.chart.applyOptions(this.#labelsBefore);
    if (this.#ownMain) this.chart.removeSeries(this.#main);
    else {
      this.#main.setData([]);
      this.#main.applyOptions(this.#mainBefore);
      this.#main.setVisible(true);
    }
  }

  /** Oldest time the loader should page back to: 1 January of the oldest year wanted. */
  #oldestWanted(): Time {
    const years = this.options.years ?? defaultSeasonalOptions.years;
    const oldest = typeof years === 'number' ? new Date().getUTCFullYear() - years + 1 : Math.min(...years);
    return Date.UTC(oldest, 0, 1) / 1000 - 2 * DAY;
  }

  #liveBar(bar: Bar): void {
    const last = this.bars[this.bars.length - 1];
    if (last && bar.time < last.time) return;
    if (last && bar.time === last.time) this.bars[this.bars.length - 1] = bar;
    else this.bars.push(bar);
    this.render();
  }

  #priceFormat(): PriceFormat | undefined {
    const normalize = this.options.normalize ?? defaultSeasonalOptions.normalize;
    if (normalize === 'percent') return { type: 'custom', format: percentText, tickSize: 0.01 };
    if (normalize === 'indexed') return { type: 'decimal', precision: 2 };
    return this.#symbolFormat;
  }

  private render(): void {
    if (this.#disposed) return;
    const chart = this.chart;
    const data = computeSeasonality(this.bars, this.options, chart.zone);
    const firstData = this.data === null;
    const resized = !this.data || this.data.slots !== data.slots || this.data.start !== data.start;
    this.data = data;
    const priceFormat = this.#priceFormat();

    this.#main.applyOptions({ priceFormat });
    if (resized) {
      const slots: Bar[] = [];
      for (let i = 0; i < data.slots; i++) slots.push({ time: slotTime(data.start, i), open: 0, high: 0, low: 0, close: 0 });
      this.#main.setData(slots);
    }

    const colors = this.options.colors?.length ? this.options.colors : YEAR_COLORS;
    const shown = new Set(data.paths.map((p) => p.year));
    for (const [year, line] of [...this.lines]) {
      if (shown.has(year)) continue;
      this.lines.delete(year);
      chart.removeSeries(line);
    }
    data.paths.forEach((path, k) => {
      const newest = k === data.paths.length - 1;
      const style = {
        title: String(path.year),
        color: colors[k % colors.length]!,
        lineWidth: newest ? 2.5 : 1.5,
        lastValueLabel: newest,
        priceFormat,
      };
      let line = this.lines.get(path.year);
      if (line) line.applyOptions(style);
      else {
        line = chart.addLine(style);
        this.lines.set(path.year, line);
      }
      line.setData(points(data, path.values));
      line.setVisible(!this.hidden.has(path.year));
    });

    this.#renderAverage(data, priceFormat);
    if (firstData || resized) chart.fitContent(false);
  }

  #renderAverage(data: SeasonalData, priceFormat: PriceFormat | undefined): void {
    const chart = this.chart;
    const avg = data.average;
    const showRange = avg !== null && this.options.range !== false;
    if (this.#range && !showRange) {
      chart.removeSeries(this.#range);
      this.#range = null;
    }
    if (this.#average && !avg) {
      chart.removeSeries(this.#average);
      this.#average = null;
    }
    if (!avg) return;
    const color = this.options.averageColor;
    if (showRange) {
      // The legend hook formats with `format`, so give it the paths' format.
      const model = priceFormat ? createPriceFormat(priceFormat) : null;
      const format = model ? (v: number) => model.format(v) : defaultFormat;
      const style = { title: 'Range', color, lastValueLabel: false, priceFormat, format };
      if (this.#range) this.#range.applyOptions(style);
      else this.#range = chart.addCustomSeries(rangeSeries, style);
      const items: RangePoint[] = [];
      for (let i = 0; i < data.slots; i++) {
        if (!Number.isNaN(avg.min[i]!)) items.push({ time: slotTime(data.start, i), low: avg.min[i]!, high: avg.max[i]! });
      }
      this.#range.setData(items);
      // Behind the year lines.
      chart.sendToBack(this.#range);
    }
    const style = {
      title: avg.kind === 'mean' ? 'Mean' : 'Median',
      color,
      lineWidth: 2,
      lineStyle: 'dashed' as const,
      lastValueLabel: false,
      priceFormat,
    };
    if (this.#average) this.#average.applyOptions(style);
    else this.#average = chart.addLine(style);
    this.#average.setData(points(data, avg.values));
  }

  /** Crosshair label: the calendar date in the window, or the trading day number. */
  #timeText(time: Time): string {
    const data = this.data;
    if (!data) return '';
    if (data.align === 'trading') return `Day ${slotOf(data, time) + 1}`;
    const d = new Date((time - DAY / 2) * 1000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }

  /** Time-axis label: months and days of the window, or trading day numbers. */
  #tickText(time: Time, weight: number): string {
    const data = this.data;
    if (!data) return '';
    if (data.align === 'trading') return String(slotOf(data, time) + 1);
    const d = new Date((time - DAY / 2) * 1000);
    // A month boundary names the month; anything finer names the day.
    return weight >= TickWeight.Month ? MONTHS[d.getUTCMonth()]! : String(d.getUTCDate());
  }
}

function points(data: SeasonalData, values: Float64Array): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i]!)) out.push({ time: slotTime(data.start, i), value: values[i]! });
  return out;
}
