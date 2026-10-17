import type { Point } from '../types';
import type { Pane } from '../pane';
import type { AnnotationLayer, AnnotationLayerHost } from './manager';
import { DEFAULT_TRADE_SOURCE, TradeLayer, copyGroup, findGroup, type Trade, type TradeGroup, type TradeLayoutEnv, type TradeMarkerOptions, type TradePointerEvent } from './trades';

// Trade fills as an annotation layer: the `trading()` plugin adds it to the annotation manager,
// so a chart with `annotations()` alone leaves the fill markers out of the bundle.

/** Name of the fills layer in the annotation manager. */
export const FILLS = 'trading/fills';

/** Fill markers on the main pane: their fills, hover, clicks and tooltip. */
export class TradeFills implements AnnotationLayer {
  private readonly layer = new TradeLayer();
  readonly #h: AnnotationLayerHost;
  #hover: TradeGroup | null = null;
  #point: Point | null = null;
  #press: { group: TradeGroup; start: Point; slop: number } | null = null;

  constructor(h: AnnotationLayerHost) {
    this.#h = h;
  }

  set(trades: readonly Trade[], source = DEFAULT_TRADE_SOURCE): void {
    this.layer.set(trades, source);
    this.#changed();
  }

  add(trade: Trade, source = DEFAULT_TRADE_SOURCE): void {
    this.layer.add(trade, source, this.#h.host.timeline, this.#interval());
    this.#changed();
  }

  remove(source?: string): void {
    this.layer.clear(source);
    this.#changed();
  }

  trades(source?: string): Trade[] {
    return this.layer.trades(source);
  }

  get groups(): readonly TradeGroup[] {
    return this.layer.grouped(this.#h.host.timeline, this.#interval()).map(copyGroup);
  }

  applyOptions(patch: Partial<TradeMarkerOptions>): void {
    this.layer.applyOptions(patch);
    this.#h.host.requestOverlay();
  }

  get options(): Readonly<TradeMarkerOptions> {
    return this.layer.options;
  }

  /** Checks `trades` without applying them, for `commit`; throws on an invalid one. */
  prepare(trades: readonly Trade[]): Map<string, Trade> {
    return this.layer.prepare(trades);
  }

  commit(map: Map<string, Trade>, source = DEFAULT_TRADE_SOURCE): void {
    this.layer.commit(map, source);
    this.#changed();
  }

  get hovering(): boolean {
    return this.#hover !== null;
  }

  clear(): void {
    this.layer.clear();
    this.#press = null;
    this.#setHover(null, null);
  }

  render(ctx: CanvasRenderingContext2D, pane: Pane): void {
    const at = this.env();
    if (at && at.pane === pane) this.layer.render(ctx, at.env);
  }

  /** The hovered marker's fills, next to the pointer. */
  renderLabels(ctx: CanvasRenderingContext2D): void {
    const group = this.#hover;
    const p = this.#point;
    const t = this.#h.main();
    if (group && p && t) this.#h.tooltip(ctx, this.layer.tooltipRows(group, this.#h.format(t)), p);
  }

  /** A press on a fill marker: on touch it is also the hover. Taken only for click listeners. */
  pointerDown(p: Point, slop: number): boolean {
    const group = this.#hit(p);
    this.#setHover(group, p);
    if (!group || !this.#h.host.listensToTradeClicks?.()) return false;
    this.#press = { group, start: p, slop };
    return true;
  }

  hover(p: Point | null, over: boolean): void {
    if (!this.#press) this.#setHover(p && over ? this.#hit(p) : null, p);
  }

  pointerUp(p: Point): boolean {
    const press = this.#press;
    if (!press) return false;
    this.#press = null;
    if (Math.hypot(p.x - press.start.x, p.y - press.start.y) <= press.slop) this.#h.host.tradeClick?.(this.#event(press.group, p));
    return true;
  }

  cancel(): boolean {
    const pressed = this.#press !== null;
    this.#press = null;
    return pressed;
  }

  cursor(p: Point): string | null | undefined {
    if (!this.#hit(p)) return undefined;
    return this.#h.host.listensToTradeClicks?.() ? 'pointer' : null;
  }

  /** Layout input for fill markers on the main series' pane and scale. */
  private env(): { pane: Pane; env: TradeLayoutEnv } | null {
    const t = this.#h.main();
    if (!t) return null;
    const host = this.#h.host;
    const time = host.time;
    const range = time.visibleRange();
    return {
      pane: t.pane,
      env: {
        timeline: host.timeline,
        priceToY: (price) => t.pane.top + t.scale.priceToY(price),
        priceFactor: (at) => this.#h.priceFactor(t.pane, at),
        indexToX: (index) => time.indexToX(index),
        barSpacing: time.barSpacing,
        from: range.from,
        to: range.to,
        theme: host.theme,
        measureText: (text) => host.measureText(text),
        sourceInterval: this.#interval(),
      },
    };
  }

  #interval(): number | null {
    return this.#h.host.barInterval?.() ?? null;
  }

  /** Markers are clipped to the main pane, so only points inside it hit them. */
  #hit(p: Point): TradeGroup | null {
    const t = this.#h.main();
    const at = this.env();
    if (!t || !at || p.x < 0 || p.x > this.#h.host.time.width) return null;
    if (p.y < t.pane.top || p.y > t.pane.top + t.pane.height) return null;
    return this.layer.hitTest(p, at.env);
  }

  #event(group: TradeGroup, point: Point): TradePointerEvent {
    const copy = copyGroup(group);
    return { trades: [...copy.trades], group: copy, point: { ...point } };
  }

  /** Hover enter and leave fire once per marker. */
  #setHover(group: TradeGroup | null, p: Point | null): void {
    const before = this.#hover;
    this.#point = p;
    if (sameGroup(before, group)) {
      if (group) this.#h.host.requestOverlay();
      return;
    }
    this.#hover = group;
    this.#h.host.requestOverlay();
    if (before) this.#h.host.tradeHoverEnd?.();
    if (group && p) this.#h.host.tradeHover?.(this.#event(group, p));
  }

  /**
   * Fills changed: keep the hover and press on a marker whose bar and side
   * still have fills, now showing the new group; drop them otherwise.
   */
  #changed(): void {
    const hover = this.#hover;
    const press = this.#press;
    if (hover || press) {
      const groups = this.layer.grouped(this.#h.host.timeline, this.#interval());
      if (press) {
        const group = findGroup(groups, press.group.index, press.group.side);
        if (group) press.group = group;
        else this.#press = null;
      }
      if (hover) {
        const group = findGroup(groups, hover.index, hover.side);
        if (group) this.#hover = group;
        else this.#setHover(null, null);
      }
    }
    this.#h.host.requestOverlay();
  }
}

/** The same marker: one bar and side (groups are rebuilt, so compare by place). */
function sameGroup(a: TradeGroup | null, b: TradeGroup | null): boolean {
  return a === b || (a !== null && b !== null && a.index === b.index && a.side === b.side && a.count === b.count);
}
