import type { ChartTheme } from '../theme';
import { fillText, resolveFont } from '../typography';
import { lowerBound, type Timeline } from '../timeline';
import type { Point, Time } from '../types';
import { contrastText } from '../util/color';
import type { OrderSide } from './types';
import { bisect } from '../util/search';
import { isText } from '../util/records';
import { clampNum } from '../util/math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** One fill of the account, e.g. from an execution report. */
export interface Trade {
  /** Unique within its source; `addTrade` with a known id replaces that fill. */
  id: string;
  time: Time;
  side: OrderSide;
  /** The traded price; under the chart's `adjustment` option it draws at its bar's adjusted price. */
  price: number;
  quantity: number;
  /** Shown in badges and tooltips instead of Buy / Sell. */
  label?: string;
  /** Default: the theme's up colour for buys, down for sells. */
  color?: string;
  /** Tooltip rows for this fill. Default: side, quantity and price. */
  tooltip?: string | string[];
}

/** Shape of a trade marker: a chevron, a plain dot, a dot with the fill count, or a text badge. */
export type TradeMarkerVariant = 'chevron' | 'dot' | 'count' | 'badge';

/** Options for trade markers: shape, size, how many draw per bar, and what counted markers and badges show. */
export interface TradeMarkerOptions {
  /** `chevron` (default) points up for buys and down for sells; `dot`; `count` is a dot with the count; `badge` a pill with text. */
  variant: TradeMarkerVariant;
  /** Size multiplier. Default 1. */
  markerScale: number;
  /** Most markers drawn on one bar; extra ones are left out. Default 4. */
  maxPerColumn: number;
  /** What badges and counted markers show. Default `count`. */
  countDisplay: 'count' | 'quantity' | 'both';
  formatQuantity?: (quantity: number) => string;
  /** Text of a badge or count marker; wins over `countDisplay`. */
  labelFormatter?: (group: TradeGroup) => string;
}

/** The fills of one side on one bar, drawn as one marker. */
export interface TradeGroup {
  /** Bar index on the time axis. */
  index: number;
  /** Time of that bar. */
  time: Time;
  side: OrderSide;
  /** Volume-weighted average price. */
  price: number;
  /** Total quantity. */
  quantity: number;
  count: number;
  trades: readonly Trade[];
}

/** The pointer over or on a trade marker: the fills it stands for and where the pointer is. */
export interface TradePointerEvent {
  /** The fills under the pointer, oldest first. */
  trades: Trade[];
  group: TradeGroup;
  /** Pointer position, chart-space css px. */
  point: Point;
}

/** Default values for `TradeMarkerOptions`: chevrons at normal size, at most four per bar, showing counts. */
export const defaultTradeMarkerOptions: Readonly<TradeMarkerOptions> = {
  variant: 'chevron',
  markerScale: 1,
  maxPerColumn: 4,
  countDisplay: 'count',
};

/** Source name fills belong to when `setTrades` or `addTrade` is given none. */
export const DEFAULT_TRADE_SOURCE = 'default';

/** What the layer needs to place markers, in chart-space css px. */
export interface TradeLayoutEnv {
  timeline: Timeline;
  priceToY(price: number): number;
  /** What fill prices on the bar at `time` draw multiplied by (an adjustment mode); default 1. */
  priceFactor?(time: Time): number;
  indexToX(index: number): number;
  barSpacing: number;
  /** Visible bar indices. */
  from: number;
  to: number;
  theme: ChartTheme;
  measureText(text: string): number;
  /** Bar interval of the data source in seconds, when known; bounds fills on a one-bar timeline. */
  sourceInterval?: number | null;
}

/** A laid-out marker; boxes are pooled and reused between frames. */
interface Box {
  group: TradeGroup;
  x: number;
  y: number;
  /** Half width and half height of the hit area. */
  hw: number;
  hh: number;
  text: string;
}

const GAP = 2;

/** Volume-weighted price, total quantity and count of `trades` (all one side). */
export function aggregate(trades: readonly Trade[]): { price: number; quantity: number; count: number } {
  let quantity = 0;
  let notional = 0;
  for (const t of trades) {
    quantity += t.quantity;
    notional += t.price * t.quantity;
  }
  return { price: quantity > 0 ? notional / quantity : (trades[0]?.price ?? NaN), quantity, count: trades.length };
}

/** A copy of `group` and its fills, safe to hand to app code. */
export function copyGroup(group: TradeGroup): TradeGroup {
  return { ...group, trades: group.trades.map((t) => ({ ...t })) };
}

/**
 * Interval that bounds a fill to its bar. The timeline's own interval is a
 * guess below two bars, so then only a known source interval bounds it.
 */
export function fillInterval(timeline: Timeline, sourceInterval?: number | null): number {
  if (timeline.length >= 2) return timeline.interval;
  return sourceInterval != null && sourceInterval > 0 ? sourceInterval : Infinity;
}

/**
 * Bar a fill at `time` belongs to, or -1: the bar at or before it, if the
 * fill is within `interval` of that bar's time. The same rule holds in gaps
 * between bars and after the last bar.
 */
export function fillBarIndex(timeline: Timeline, time: Time, interval: number): number {
  const times = timeline.times;
  const i = lowerBound(times, time);
  if (times[i] === time) return i;
  if (i === 0) return -1;
  return time < times[i - 1]! + interval ? i - 1 : -1;
}

/** Throws for a fill the layer cannot place. */
export function checkTrade(t: Trade): void {
  if (!isText(t.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Trade id must be a non-empty string' : '');
  if (!Number.isFinite(t.time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Trade ${t.id}: time must be a finite number` : '');
  if (!Number.isFinite(t.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Trade ${t.id}: price must be a finite number` : '');
  if (!(t.quantity > 0) || !Number.isFinite(t.quantity)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Trade ${t.id}: quantity must be positive` : '');
  if (t.side !== 'buy' && t.side !== 'sell') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Trade ${t.id}: unknown side "${String(t.side)}"` : '');
}

/**
 * Account fills, aggregated per bar and side. Groups stay sorted by bar so a
 * frame walks only the visible ones; `addTrade` regroups only its bar, and a
 * bar appended to the timeline regroups only the old last bar and the new
 * ones. Any other timeline change (new data, interval) regroups every fill:
 * O(n log n) in the number of fills.
 */
export class TradeLayer {
  #sources = new Map<string, Map<string, Trade>>();
  /** Groups sorted by bar index, buys before sells. */
  #groups: TradeGroup[] = [];
  /** Bar index of each fill as of the last grouping. */
  #barOf = new Map<Trade, number>();
  #byBar = new Map<number, Set<Trade>>();
  /** Fills on no bar as of the last grouping; an appended bar may take them. */
  #unplaced = new Set<Trade>();
  /** The timeline and fill interval the groups were made for. */
  #seen: { times: readonly Time[] | null; length: number; shift: number; interval: number } = {
    times: null,
    length: -1,
    shift: 0,
    interval: 0,
  };
  #dirty = true;
  #opts: TradeMarkerOptions = { ...defaultTradeMarkerOptions };
  private pool: Box[] = [];
  private used = 0;

  get options(): Readonly<TradeMarkerOptions> {
    return this.#opts;
  }

  applyOptions(patch: Partial<TradeMarkerOptions>): void {
    this.#opts = { ...this.#opts, ...patch };
  }

  /** Replace the fills of `source`. Throws, changing nothing, on an invalid fill or a repeated id. */
  set(trades: readonly Trade[], source = DEFAULT_TRADE_SOURCE): void {
    this.commit(this.prepare(trades), source);
  }

  /** Check `trades` and copy them into a map by id, without changing the layer. */
  prepare(trades: readonly Trade[]): Map<string, Trade> {
    const map = new Map<string, Trade>();
    for (const t of trades) {
      checkTrade(t);
      if (map.has(t.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Duplicate trade id "${t.id}"` : '');
      map.set(t.id, { ...t });
    }
    return map;
  }

  /** Replace the fills of `source` with a map from `prepare`. */
  commit(map: Map<string, Trade>, source = DEFAULT_TRADE_SOURCE): void {
    if (map.size === 0) this.#sources.delete(source);
    else this.#sources.set(source, map);
    this.#dirty = true;
  }

  /** Add or replace one fill; only its bar (and its old bar) are regrouped. */
  add(trade: Trade, source = DEFAULT_TRADE_SOURCE, timeline?: Timeline, sourceInterval?: number | null): void {
    checkTrade(trade);
    let map = this.#sources.get(source);
    if (!map) {
      map = new Map();
      this.#sources.set(source, map);
    }
    const old = map.get(trade.id);
    const copy = { ...trade };
    map.set(trade.id, copy);
    const interval = timeline ? fillInterval(timeline, sourceInterval) : 0;
    if (this.#dirty || !timeline || this.#timelineChanged(timeline, interval)) {
      this.#dirty = true;
      return;
    }
    const bars = new Set<number>();
    if (old) {
      const was = this.#barOf.get(old);
      this.#unindex(old);
      if (was !== undefined && was >= 0) bars.add(was);
    }
    const index = this.index(copy, timeline, interval);
    if (index >= 0) bars.add(index);
    for (const bar of bars) this.#regroup(bar, timeline);
  }

  /** Remove the fills of `source`, or of every source. */
  clear(source?: string): void {
    if (source === undefined) this.#sources.clear();
    else this.#sources.delete(source);
    this.#dirty = true;
  }

  /** The fills of `source`, or of every source. */
  trades(source?: string): Trade[] {
    const maps = source === undefined ? [...this.#sources.values()] : [this.#sources.get(source) ?? new Map<string, Trade>()];
    return maps.flatMap((m) => [...m.values()].map((t) => ({ ...t })));
  }

  /**
   * Groups for `timeline`, regrouping when fills or bars changed. The live
   * internal list: copy groups (`copyGroup`) before handing them out.
   */
  grouped(timeline: Timeline, sourceInterval?: number | null): readonly TradeGroup[] {
    const interval = fillInterval(timeline, sourceInterval);
    if (this.#dirty || this.#timelineChanged(timeline, interval)) {
      if (!this.#dirty && this.#appended(timeline, interval)) this.#extend(timeline, interval);
      else this.rebuild(timeline, interval);
    }
    return this.#groups;
  }

  /** Lay out and draw the visible markers. */
  render(ctx: CanvasRenderingContext2D, env: TradeLayoutEnv): void {
    this.#layout(env);
    for (let i = 0; i < this.used; i++) this.#draw(ctx, this.pool[i]!, env);
  }

  /** The group whose marker is under `p`, from the last layout. */
  hitTest(p: Point, env: TradeLayoutEnv): TradeGroup | null {
    this.#layout(env);
    for (let i = this.used - 1; i >= 0; i--) {
      const b = this.pool[i]!;
      if (Math.abs(p.x - b.x) <= b.hw + GAP && Math.abs(p.y - b.y) <= b.hh + GAP) return b.group;
    }
    return null;
  }

  /** Tooltip rows of a group: each fill's own rows, or side, quantity and price. */
  tooltipRows(group: TradeGroup, format: (price: number) => string): string[] {
    const rows: string[] = [];
    if (group.count > 1) rows.push(`${group.count} ${sideName(group.side, true)} · ${this.#quantityText(group.quantity)} @ ${format(group.price)} avg`);
    for (const t of group.trades) {
      if (t.tooltip !== undefined) rows.push(...(Array.isArray(t.tooltip) ? t.tooltip : [t.tooltip]));
      else rows.push(`${t.label ?? sideName(t.side, false)} ${this.#quantityText(t.quantity)} @ ${format(t.price)}`);
    }
    return rows;
  }

  /* ----------------------------- internals ----------------------------- */

  #timelineChanged(timeline: Timeline, interval: number): boolean {
    const s = this.#seen;
    return s.times !== timeline.times || s.length !== timeline.length || s.shift !== timeline.shift || s.interval !== interval;
  }

  /** Bars were only added after the last one (`Timeline.append` keeps the array; `prepend` does too, but moves `shift`). */
  #appended(timeline: Timeline, interval: number): boolean {
    const s = this.#seen;
    return (
      s.times === timeline.times && s.shift === timeline.shift && s.length > 0 && timeline.length > s.length && s.interval === interval
    );
  }

  private rebuild(timeline: Timeline, interval: number): void {
    this.#barOf.clear();
    this.#byBar.clear();
    this.#unplaced.clear();
    for (const map of this.#sources.values()) for (const t of map.values()) this.index(t, timeline, interval);
    const groups: TradeGroup[] = [];
    for (const index of [...this.#byBar.keys()].sort((a, b) => a - b)) groups.push(...this.#groupsOf(index, timeline));
    this.#groups = groups;
    this.#seen = { times: timeline.times, length: timeline.length, shift: timeline.shift, interval };
    this.#dirty = false;
  }

  /**
   * New bars after the last one: only fills on the old last bar and unplaced
   * fills after it can move, and only onto the old last bar or the new ones.
   */
  #extend(timeline: Timeline, interval: number): void {
    const last = this.#seen.length - 1;
    const lastTime = timeline.times[last]!;
    const moving = [...(this.#byBar.get(last) ?? [])];
    for (const t of this.#unplaced) if (t.time > lastTime) moving.push(t);
    const bars = new Set<number>([last]);
    for (const t of moving) {
      this.#unindex(t);
      const index = this.index(t, timeline, interval);
      if (index >= 0) bars.add(index);
    }
    for (const bar of [...bars].sort((a, b) => a - b)) this.#regroup(bar, timeline);
    this.#seen = { times: timeline.times, length: timeline.length, shift: timeline.shift, interval };
  }

  private index(t: Trade, timeline: Timeline, interval: number): number {
    const index = fillBarIndex(timeline, t.time, interval);
    this.#barOf.set(t, index);
    if (index >= 0) {
      let set = this.#byBar.get(index);
      if (!set) this.#byBar.set(index, (set = new Set()));
      set.add(t);
    } else {
      this.#unplaced.add(t);
    }
    return index;
  }

  #unindex(t: Trade): void {
    const index = this.#barOf.get(t);
    this.#barOf.delete(t);
    this.#unplaced.delete(t);
    if (index === undefined) return;
    const set = this.#byBar.get(index);
    set?.delete(t);
    if (set?.size === 0) this.#byBar.delete(index);
  }

  /** Buy and sell groups of one bar, fills oldest first. */
  #groupsOf(index: number, timeline: Timeline): TradeGroup[] {
    const fills = [...(this.#byBar.get(index) ?? [])].sort((a, b) => a.time - b.time);
    const out: TradeGroup[] = [];
    for (const side of ['buy', 'sell'] as const) {
      const trades = fills.filter((t) => t.side === side);
      if (trades.length === 0) continue;
      out.push({ index, time: timeline.times[index]!, side, ...aggregate(trades), trades });
    }
    return out;
  }

  /** Replace one bar's groups in the sorted list. */
  #regroup(index: number, timeline: Timeline): void {
    const start = lowerGroup(this.#groups, index);
    let end = start;
    while (end < this.#groups.length && this.#groups[end]!.index === index) end++;
    this.#groups.splice(start, end - start, ...this.#groupsOf(index, timeline));
  }

  #quantityText(q: number): string {
    return this.#opts.formatQuantity?.(q) ?? String(Number(q.toPrecision(12)));
  }

  private label(group: TradeGroup): string {
    if (this.#opts.labelFormatter) return this.#opts.labelFormatter(group);
    const count = String(group.count);
    const qty = this.#quantityText(group.quantity);
    const mode = this.#opts.countDisplay;
    return mode === 'count' ? count : mode === 'quantity' ? qty : `${count} · ${qty}`;
  }

  /**
   * Place the visible groups into the box pool. Groups of one bar stack away
   * from each other instead of overlapping; at most `maxPerColumn` per bar.
   */
  #layout(env: TradeLayoutEnv): void {
    this.used = 0;
    const groups = this.grouped(env.timeline, env.sourceInterval);
    const size = clampNum(env.barSpacing * 0.8, 8, 14) * this.#opts.markerScale;
    const variant = this.#opts.variant;
    // Trade badges are labels: they are measured and drawn in the labels font.
    const fs = resolveFont(env.theme, 'labels').fontSize;
    let i = lowerGroup(groups, Math.floor(env.from) - 1);
    let lastIndex = -1;
    let inColumn = 0;
    let bottom = -Infinity;
    for (; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.index > env.to + 1) break;
      if (g.index !== lastIndex) {
        lastIndex = g.index;
        inColumn = 0;
        bottom = -Infinity;
      }
      if (inColumn >= this.#opts.maxPerColumn) continue;
      inColumn++;
      const text = variant === 'badge' || variant === 'count' || g.count > 1 ? this.label(g) : '';
      const badge = variant === 'badge';
      const hh = badge ? (fs + 6) / 2 : size / 2;
      const hw = badge ? (env.measureText(text) + 10) / 2 : size / 2;
      let y = env.priceToY(g.price * (env.priceFactor?.(g.time) ?? 1));
      // Keep clear of the previous marker on this bar.
      if (y - hh < bottom + GAP) y = bottom + GAP + hh;
      bottom = y + hh;
      const b = this.pool[this.used] ?? (this.pool[this.used] = { group: g, x: 0, y: 0, hw: 0, hh: 0, text: '' });
      b.group = g;
      b.x = env.indexToX(g.index);
      b.y = y;
      b.hw = hw;
      b.hh = hh;
      b.text = text;
      this.used++;
    }
  }

  #draw(ctx: CanvasRenderingContext2D, b: Box, env: TradeLayoutEnv): void {
    const g = b.group;
    const theme = env.theme;
    const color = g.trades[0]?.color ?? (g.side === 'buy' ? theme.up : theme.down);
    ctx.fillStyle = color;
    ctx.beginPath();
    switch (this.#opts.variant) {
      case 'chevron': {
        // Apex at the price: up for buys, down for sells.
        const dir = g.side === 'buy' ? 1 : -1;
        ctx.moveTo(b.x, b.y - b.hh * dir);
        ctx.lineTo(b.x + b.hw, b.y + b.hh * dir);
        ctx.lineTo(b.x - b.hw, b.y + b.hh * dir);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'dot':
      case 'count':
        ctx.arc(b.x, b.y, b.hw, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'badge':
        ctx.roundRect(b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 2, 3);
        ctx.fill();
        break;
    }
    if (!b.text) return;
    ctx.textBaseline = 'middle';
    if (this.#opts.variant === 'badge' || this.#opts.variant === 'count') {
      ctx.fillStyle = contrastText(color);
      ctx.textAlign = 'center';
      fillText(ctx, b.text, b.x, b.y + 0.5);
    } else {
      // Small markers carry their count beside them.
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      fillText(ctx, b.text, b.x + b.hw + GAP, b.y + 0.5);
    }
  }
}

/** The group of `side` on bar `index` in a list from `grouped`, or null. */
export function findGroup(groups: readonly TradeGroup[], index: number, side: OrderSide): TradeGroup | null {
  for (let i = lowerGroup(groups, index); i < groups.length && groups[i]!.index === index; i++) {
    if (groups[i]!.side === side) return groups[i]!;
  }
  return null;
}

/** First position whose bar index is at least `index`. */
function lowerGroup(groups: readonly TradeGroup[], index: number): number {
  return bisect(groups.length, (i) => groups[i]!.index < index);
}

function sideName(side: OrderSide, plural: boolean): string {
  return (side === 'buy' ? 'Buy' : 'Sell') + (plural ? 's' : '');
}
