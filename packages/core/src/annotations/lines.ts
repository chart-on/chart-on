import type { PriceScale } from '../scales';
import { CandleSeries, type Series } from '../series';
import { autoPrecision, decimalsForStep } from '../util/format';
import type {
  AlertLineOptions,
  CrossDirection,
  DraftLineOptions,
  LineStyle,
  OrderType,
  PriceLineOptions,
  TradeAction,
  TradeLineOptions,
  TradeLinePart,
} from './types';
import { isNumber } from '../util/records';
import { clampLow, sharp } from '../util/math';
import { dash } from '../drawing/draw';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What a line handle needs from the annotation layer. */
export interface LineOwner {
  /** Options changed (`patch`, from `applyOptions`) or visibility did (no patch). */
  changed(line: object, patch?: object): void;
  remove(line: object): void;
  /** Takes an alert's checked options before they replace its own; throwing rejects them. */
  prepareAlert?(line: AlertLine, next: AlertLineOptions): void;
  /** Report a draft as an order to place, and remove it. */
  commitDraft?(line: DraftLine): void;
}

/** What a handle needs from its layer. */
interface HandleOwner {
  /** Options changed (`patch`, from `applyOptions`) or visibility did (no patch). */
  changed(item: object, patch?: object): void;
  remove(item: object): void;
}

/** Handle shared by price and trade lines, time bands, price zones and text labels. */
export abstract class OptionsHandle<O extends object, W extends HandleOwner> {
  #opts: O;
  private shown = true;

  constructor(
    options: O,
    protected readonly owner: W,
  ) {
    this.check(options);
    this.#opts = options;
  }

  get options(): Readonly<O> {
    return this.#opts;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Merge new options and redraw. Throws on invalid options, leaving the current ones. */
  applyOptions(patch: Partial<O>): void {
    const next = { ...this.#opts, ...patch };
    this.check(next);
    this.prepare(next);
    this.#opts = next;
    this.optionsChanged();
    this.owner.changed(this, patch);
  }

  /** Hide or show it; its options are kept. */
  setVisible(visible: boolean): void {
    this.shown = visible;
    this.owner.changed(this);
  }

  remove(): void {
    this.owner.remove(this);
  }

  protected abstract check(options: O): void;

  /** Hook between checking and committing new options; may throw to reject them. */
  protected prepare(_options: O): void {}

  /** Drop caches derived from the options. */
  protected optionsChanged(): void {}
}

/** Handle shared by price and trade lines. */
abstract class AnnotationLine<O extends object> extends OptionsHandle<O, LineOwner> {}

/** Handle returned by `chart.annotations.addPriceLine`. */
export class PriceLine extends AnnotationLine<PriceLineOptions> {
  protected check(o: PriceLineOptions): void {
    if (!Number.isFinite(o.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price line price must be a finite number' : '');
  }
}

const TRADE_ACTIONS: readonly TradeAction[] = ['cancel', 'close', 'reverse'];

/** Handle returned by `chart.annotations.addTradeLine`: an order or a position. */
export class TradeLine extends AnnotationLine<TradeLineOptions> {
  protected check(o: TradeLineOptions): void {
    if (o.kind !== 'order' && o.kind !== 'position') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown trade line kind "${String(o.kind)}"` : '');
    if (!Number.isFinite(o.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Trade line price must be a finite number' : '');
    if (o.side !== 'buy' && o.side !== 'sell') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown order side "${String(o.side)}"` : '');
    for (const key of ['takeProfit', 'stopLoss'] as const) {
      const v = o[key];
      if (v !== undefined && v !== null && !Number.isFinite(v)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Trade line ${key} must be a finite number` : '');
    }
    if (o.tickSize !== undefined && !(o.tickSize > 0)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Trade line tickSize must be positive' : '');
    for (const a of [...o.actions, ...o.bracketActions]) {
      if (!TRADE_ACTIONS.includes(a)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown trade action "${String(a)}"` : '');
    }
  }
}

const ORDER_TYPES: readonly OrderType[] = ['limit', 'stop', 'market'];

/** Handle returned by `chart.annotations.startOrderDraft`: an order the user is still composing. */
export class DraftLine extends AnnotationLine<DraftLineOptions> {
  /** Place it: emits `order:create` with the draft's fields and removes the draft. */
  commit(): void {
    this.owner.commitDraft?.(this);
  }

  /** Throw it away without placing it. */
  discard(): void {
    this.remove();
  }

  protected check(o: DraftLineOptions): void {
    if (!Number.isFinite(o.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Draft price must be a finite number' : '');
    if (o.side !== 'buy' && o.side !== 'sell') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown order side "${String(o.side)}"` : '');
    if (!ORDER_TYPES.includes(o.type)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown order type "${String(o.type)}"` : '');
    if (o.quantity !== undefined && !(Number.isFinite(o.quantity) && o.quantity > 0)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Draft quantity must be a positive number' : '');
    }
    for (const key of ['takeProfit', 'stopLoss'] as const) {
      const v = o[key];
      if (v !== undefined && v !== null && !Number.isFinite(v)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Draft ${key} must be a finite number` : '');
    }
    if (o.tickSize !== undefined && !(o.tickSize > 0)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Draft tickSize must be positive' : '');
  }
}

/** Handle returned by `chart.annotations.addAlertLine`. */
export class AlertLine extends AnnotationLine<AlertLineOptions> {
  protected check(o: AlertLineOptions): void {
    if (!Number.isFinite(o.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Alert line price must be a finite number' : '');
    if (o.tickSize !== undefined && !(o.tickSize > 0)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Alert line tickSize must be positive' : '');
  }

  /** Its primitive moves to the new series first, so a series not on the chart is rejected. */
  protected override prepare(o: AlertLineOptions): void {
    this.owner.prepareAlert?.(this, o);
  }
}

/**
 * Direction in which a price moving from `from` to `to` crossed `level`, or
 * null when it did not. Reaching the level counts and starting on it does not,
 * so a price that touches a level and stays there is reported once.
 */
export function crossDirection(level: number, from: number, to: number): CrossDirection | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from < level && to >= level) return 'up';
  if (from > level && to <= level) return 'down';
  return null;
}

/** Committed price of a part, or null when the part is not set. */
export function partPrice(o: Pick<TradeLineOptions, 'price' | 'takeProfit' | 'stopLoss'>, part: TradeLinePart): number | null {
  const v = part === 'entry' ? o.price : part === 'takeProfit' ? o.takeProfit : o.stopLoss;
  return isNumber(v) ? v : null;
}

/** Options patch that moves `part` to `price`. */
export function partPatch(part: TradeLinePart, price: number): Partial<Pick<TradeLineOptions, 'price' | 'takeProfit' | 'stopLoss'>> {
  if (part === 'takeProfit') return { takeProfit: price };
  if (part === 'stopLoss') return { stopLoss: price };
  return { price };
}

/** Round to the nearest multiple of `tick`, without float noise (0.1 + 0.2 stays 0.3). */
export function snapToTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  return Number((Math.round(price / tick) * tick).toFixed(Math.min(20, decimalsForStep(tick))));
}

/** The tick size of the series' price format, else one unit of its price precision. */
export function defaultTickSize(series: Series | null, price: number): number {
  const format = series instanceof CandleSeries ? series.formatModel : series?.priceFormat;
  const tick = format?.tickSize(price) ?? 0;
  if (tick > 0) return tick;
  const last = series instanceof CandleSeries ? series.data[series.data.length - 1]?.close : undefined;
  const digits = series instanceof CandleSeries ? (series.options.precision ?? autoPrecision(last ?? price)) : autoPrecision(price);
  return 10 ** -digits;
}

/**
 * Price of a line dragged to pane-local `y`: read through the scale, so it is
 * correct in log mode, kept inside the pane, and snapped to `tick`.
 */
export function dragPrice(scale: PriceScale, y: number, tick: number): number {
  const price = snapToTick(scale.yToPrice(clampLow(y, 0, scale.height)), tick);
  // Snapping must not reach zero on a log scale.
  return scale.isLog && price <= 0 ? tick : price;
}

/** A horizontal line across the plot at chart-space `y`. */
export function hLine(ctx: CanvasRenderingContext2D, y: number, width: number, color: string, lineWidth: number, style: LineStyle): void {
  // Odd widths sit on half pixels to stay crisp.
  const cy = lineWidth % 2 === 1 ? sharp(y) : Math.round(y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash({ lineStyle: style }));
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(width, cy);
  ctx.stroke();
  ctx.restore();
}

export type { AnnotationLine };
