import type { ChartTheme } from '../theme';
import { fillText, fontCss, resolveFont } from '../typography';
import type { Pane } from '../pane';
import { CandleSeries, HistogramSeries, LineSeries, type Series } from '../series';
import type { Primitive } from '../primitives';
import type { Point } from '../types';
import { contrastText, withAlpha } from '../util/color';
import { clampLow } from '../util/math';
import { AlertLine, DraftLine, TradeLine, crossDirection, defaultTickSize, dragPrice, hLine, partPatch, partPrice, type LineOwner } from './lines';
import { BLOCK_INSET, HIT, beyond, pointerEvent, type AlertCrossing, type AnnotationLayer, type AnnotationLayerHost, type Target, type TradeSync } from './manager';
import type {
  AlertLineOptions,
  BracketPart,
  ClusterClickEvent,
  DraftEditEvent,
  DraftLineOptions,
  DraftSegment,
  LineInteractionOptions,
  LineLabelOptions,
  OrderCreateEvent,
  TradeAction,
  TradeLineOptions,
  TradeLinePart,
} from './types';

// Order, position, alert and draft lines as an annotation layer: the `trading()` plugin adds it
// to the annotation manager, so a chart with `annotations()` alone leaves them out of the bundle.

/** Name of the trading lines layer in the annotation manager. */
export const LINES = 'trading/lines';

/** A line users can drag or press: an order, a position, a draft or an alert. Alerts only have an `entry` part. */
type ActiveLine = TradeLine | AlertLine | DraftLine;
/** A line with brackets that a handle can add. */
type BracketLine = TradeLine | DraftLine;

/**
 * A button in a label block: a trade action, removing an alert, or confirming
 * or discarding a pending change (placing or discarding a draft).
 */
type Button = TradeAction | 'remove' | 'confirm' | 'discard';

interface Segment {
  x: number;
  width: number;
  text: string;
  color: string;
  fill: string | null;
  button: Button | null;
  /** The bracket handle. */
  grip?: boolean;
  /** A draft field the user edits by clicking it. */
  edit?: DraftSegment;
}

/** A released drag that waits for confirm or discard (`confirmChanges`). */
interface Pending {
  part: TradeLinePart;
  price: number;
  /** Committed price when the change started. */
  from: number;
}

/** A visible order/position line part or alert line with its label block, in chart-space css px. */
interface PartView {
  line: ActiveLine;
  part: TradeLinePart;
  price: number;
  y: number;
  color: string;
  target: Target;
  top: number;
  height: number;
  segments: Segment[];
  /** Folded into a cluster: the block is not drawn. `keepLabel` marks the member whose axis label stays. */
  clustered?: boolean;
  keepLabel?: boolean;
  /** A cluster's summary block, standing for these lines. */
  cluster?: TradeLine[];
}

interface Hit {
  line: ActiveLine;
  part: TradeLinePart;
  button: Button | null;
  y: number;
  cluster?: TradeLine[];
  grip?: boolean;
  edit?: DraftSegment;
}

type Gesture =
  /** `from` is the committed price, `grabbed` the price shown when pressed (a pending one, if any). */
  | {
      kind: 'drag';
      line: ActiveLine;
      part: TradeLinePart;
      from: number;
      grabbed: number;
      price: number;
      offset: number;
      start: Point;
      slop: number;
    }
  /** Dragging a bracket handle; `part` and `price` are null while the pointer proposes nothing. */
  | { kind: 'bracket'; line: BracketLine; part: BracketPart | null; price: number | null; start: Point; slop: number }
  | { kind: 'edit'; line: DraftLine; segment: DraftSegment; anchor: Point; start: Point; slop: number }
  | { kind: 'press'; line: ActiveLine; part: TradeLinePart; button: Button }
  | { kind: 'click'; line: ActiveLine; part: TradeLinePart; start: Point; slop: number }
  /** A press on a summary label: a click, or a drag of `member` (a draggable line under it) once it moves. */
  | { kind: 'cluster'; lines: TradeLine[]; anchor: Point; start: Point; slop: number; member: Hit | null };

/** An alert's plot primitive and the series it was attached for. */
interface AlertAttachment {
  series: Series | null;
  detach: () => void;
}

/** Horizontal text padding inside a block segment. */
const PAD = 6;
/** Gap between a label block and the pane buttons above it. */
const BUTTONS_GAP = 4;
const PARTS: readonly TradeLinePart[] = ['takeProfit', 'stopLoss', 'entry'];
const BRACKETS: readonly BracketPart[] = ['takeProfit', 'stopLoss'];
/** Opacity of a draft's line, so it reads as not placed yet. */
const DRAFT_ALPHA = 0.7;

/**
 * Draggable order and position lines, order drafts and alert lines: their
 * label blocks, buttons, bracket handles, pending changes and clusters.
 *
 * Alert lines draw through the plot primitive API (one primitive per line, on
 * the top layer), while this layer owns their hit testing, dragging and
 * remove button, so primitives themselves need no pointer handling.
 */
export class TradingLines implements AnnotationLayer {
  readonly above = true;
  private trades: TradeLine[] = [];
  #alerts: AlertLine[] = [];
  #drafts: DraftLine[] = [];
  /** Released drags waiting for confirmation, per line. */
  #pending = new Map<TradeLine, Pending>();
  /** Brackets proposed with a handle, shown until the app answers with `applyOptions`. */
  #proposed = new Map<TradeLine, Partial<Record<BracketPart, number>>>();
  #attachments = new Map<AlertLine, AlertAttachment>();
  #gesture: Gesture | null = null;
  #hover: Hit | null = null;
  /** Pointer position of the last hover, for line tooltips. */
  #hoverPoint: Point | null = null;
  /** Cluster each folded line was in at the last layout, so clusters split with hysteresis. */
  private clusterOf = new Map<TradeLine, number>();
  readonly #owner: LineOwner = {
    changed: (line, patch) => {
      if (line instanceof TradeLine) this.#answered(line, patch ?? {});
      this.#h.host.requestOverlay();
    },
    remove: (line) => this.#detach(line),
    // A removed line stays detached.
    prepareAlert: (line, next) => {
      if (this.#alerts.includes(line)) this.#attachAlert(line, next.series);
    },
    commitDraft: (line) => this.#commitDraft(line),
  };
  readonly #h: AnnotationLayerHost;

  constructor(h: AnnotationLayerHost) {
    this.#h = h;
  }

  /** Add an order (default) or position line; defaults depend on `kind`. */
  addTradeLine(options: Partial<TradeLineOptions> & Pick<TradeLineOptions, 'price' | 'side'>): TradeLine {
    const line = this.#makeTradeLine(options);
    this.trades.push(line);
    this.#h.host.requestOverlay();
    return line;
  }

  /** A checked trade line with the defaults of its kind, not yet listed. */
  #makeTradeLine(options: Partial<TradeLineOptions> & Pick<TradeLineOptions, 'price' | 'side'>): TradeLine {
    const position = options.kind === 'position';
    return new TradeLine(
      {
        kind: 'order',
        lineWidth: 1,
        lineStyle: position ? 'solid' : 'dashed',
        pnl: true,
        actions: position ? ['reverse', 'close'] : ['cancel'],
        bracketActions: ['cancel'],
        ...options,
      },
      this.#owner,
    );
  }

  /** Checked order and position lines of `sync`, for `commitSync`; throws on an invalid one. */
  prepareSync(sync: TradeSync): { orders: TradeLine[]; positions: TradeLine[] } {
    return {
      orders: sync.orders?.map((o) => this.#makeTradeLine({ ...o, kind: 'order' })) ?? [],
      positions: sync.positions?.map((o) => this.#makeTradeLine({ ...o, kind: 'position' })) ?? [],
    };
  }

  /** Replace the order lines, the position lines, or both, as `sync` says. */
  commitSync(sync: TradeSync, lines: { orders: TradeLine[]; positions: TradeLine[] }): void {
    const replaced = (['order', 'position'] as const).filter((kind) => (kind === 'order' ? sync.orders : sync.positions));
    for (const line of this.trades.filter((l) => replaced.includes(l.options.kind))) line.remove();
    this.trades.push(...lines.orders, ...lines.positions);
  }

  /** Add a price alert; dragging and the remove button are opt-in through its callbacks. */
  addAlertLine(options: Partial<AlertLineOptions> & Pick<AlertLineOptions, 'price'>): AlertLine {
    const line = new AlertLine({ label: 'Alert', lineWidth: 1, lineStyle: 'dotted', ...options }, this.#owner);
    // Attach first: a series not on the chart throws before the line is listed.
    this.#attachAlert(line, line.options.series);
    this.#alerts.push(line);
    this.#h.host.requestOverlay();
    return line;
  }

  startOrderDraft(options: Partial<DraftLineOptions> & Pick<DraftLineOptions, 'price' | 'side'>): DraftLine {
    const line = new DraftLine({ type: 'limit', lineWidth: 1, lineStyle: 'dashed', ...options }, this.#owner);
    this.#drafts.push(line);
    this.#h.host.requestOverlay();
    return line;
  }

  get tradeLines(): readonly TradeLine[] {
    return this.trades;
  }

  get alertLines(): readonly AlertLine[] {
    return this.#alerts;
  }

  get draftLines(): readonly DraftLine[] {
    return this.#drafts;
  }

  alertsCrossed(from: number, to: number, series?: Series): AlertCrossing[] {
    const main = this.#h.host.main;
    const key = (s: Series | undefined) => (s && s !== main ? s : null);
    const out: AlertCrossing[] = [];
    for (const line of this.#alerts) {
      if (key(line.options.series) !== key(series)) continue;
      const direction = crossDirection(line.options.price, from, to);
      if (direction) out.push({ line, direction });
    }
    return out;
  }

  clusterChanged(): void {
    this.clusterOf.clear();
  }

  /** Alerts without a series follow the main series to its pane. */
  mainChanged(): void {
    for (const line of this.#alerts) this.#attachAlert(line, line.options.series);
  }

  clear(): void {
    for (const a of this.#attachments.values()) a.detach();
    this.#attachments.clear();
    this.trades = [];
    this.#alerts = [];
    this.#drafts = [];
    this.#pending.clear();
    this.#proposed.clear();
    this.#gesture = null;
    this.#endHover();
    this.clusterOf.clear();
    this.#h.host.requestOverlay();
  }

  /* --------------------------- pointer input --------------------------- */

  pointerDown(p: Point, slop: number): boolean {
    const hit = this.hitTest(p);
    if (!hit) return false;
    const line = hit.line;
    if (hit.cluster) {
      const anchor = this.#clusterAnchor(hit.cluster) ?? this.#rootPoint(p);
      this.#gesture = { kind: 'cluster', lines: hit.cluster, anchor, start: p, slop, member: this.#clusterMember(hit.cluster, p) };
    } else if (hit.button) {
      this.#gesture = { kind: 'press', line, part: hit.part, button: hit.button };
    } else if (hit.grip && (line instanceof TradeLine || line instanceof DraftLine)) {
      this.#gesture = { kind: 'bracket', line, part: null, price: null, start: p, slop };
    } else if (hit.edit && line instanceof DraftLine) {
      const anchor = this.#segmentAnchor(line, hit.edit) ?? this.#rootPoint(p);
      this.#gesture = { kind: 'edit', line, segment: hit.edit, anchor, start: p, slop };
    } else if (draggable(line, hit.part)) {
      const from = committedPrice(line, hit.part);
      const grabbed = this.#priceOf(line, hit.part);
      if (from === null || grabbed === null) return false;
      // Keep the grab offset so the line does not jump to the pointer.
      this.#gesture = { kind: 'drag', line, part: hit.part, from, grabbed, price: grabbed, offset: p.y - hit.y, start: p, slop };
    } else if (handlers(line).onClick) {
      this.#gesture = { kind: 'click', line, part: hit.part, start: p, slop };
    } else {
      return false;
    }
    this.#setHover(hit, p);
    this.#h.host.requestOverlay();
    return true;
  }

  hover(p: Point | null, over: boolean): void {
    this.#setHover(p && over ? this.hitTest(p) : null, p);
  }

  get hovering(): boolean {
    return this.#hover !== null;
  }

  get busy(): boolean {
    return this.#gesture !== null;
  }

  /** Drag during a press. */
  move(p: Point): boolean {
    let g = this.#gesture;
    if (!g) return false;
    if (g.kind === 'cluster' && g.member && beyond(g.start, p, g.slop)) {
      g = this.#dragMember(g.member, g.start, g.slop);
      if (!g) return true;
    }
    if (g.kind === 'cluster' || g.kind === 'click' || g.kind === 'edit') {
      this.#setHover(this.hitTest(p), p);
      return true;
    }
    if (g.kind === 'bracket') {
      this.#moveBracket(g, p);
      return true;
    }
    // A line removed or a part cleared mid-gesture ends it.
    if (!this.#owns(g.line) || committedPrice(g.line, g.part) === null) {
      this.#gesture = null;
      return true;
    }
    if (g.kind === 'press') {
      this.#setHover(this.hitTest(p), p);
      return true;
    }
    const t = this.#h.target(g.line.options.series);
    if (!t) return true;
    const tick = g.line.options.tickSize ?? defaultTickSize(t.series, g.from);
    const price = dragPrice(t.scale, p.y - g.offset - t.pane.top, tick);
    if (price === g.price) return true;
    g.price = price;
    this.#h.host.requestOverlay();
    emitDrag(g.line, g.part, price);
    return true;
  }

  pointerUp(p: Point): boolean {
    const g = this.#gesture;
    if (!g) return false;
    this.#gesture = null;
    this.#h.host.requestOverlay();
    const still = 'start' in g && !beyond(g.start, p, g.slop);
    if (g.kind === 'cluster') {
      if (still) this.#clickCluster(g.lines, g.anchor);
      return true;
    }
    if (g.kind === 'edit') {
      if (still && this.#drafts.includes(g.line)) this.#editDraft(g.line, g.segment, g.anchor);
      return true;
    }
    if (g.kind === 'bracket') {
      if (g.part !== null && g.price !== null && this.#owns(g.line)) this.#proposeBracket(g.line, g.part, g.price);
      return true;
    }
    if (g.kind === 'click') {
      const price = this.#priceOf(g.line, g.part);
      if (still && this.#owns(g.line) && price !== null) handlers(g.line).onClick?.(pointerEvent(g.line, g.part, price, this.#rootPoint(p)));
      return true;
    }
    if (!this.#owns(g.line) || committedPrice(g.line, g.part) === null) return true;
    if (g.kind === 'press') {
      const hit = this.hitTest(p);
      if (hit?.line === g.line && hit.part === g.part && hit.button === g.button) this.#press(g.line, g.part, g.button);
      return true;
    }
    // A draggable line released where it was grabbed is a click; a moved one never is.
    if (g.price === g.grabbed && still) {
      if (!(g.line instanceof DraftLine)) handlers(g.line).onClick?.(pointerEvent(g.line, g.part, g.grabbed, this.#rootPoint(p)));
      return true;
    }
    if (g.price !== g.grabbed) this.#release(g.line, g.part, g.price, g.from);
    return true;
  }

  /** Abort the press; a dragged line returns to its original price. */
  cancel(): boolean {
    const g = this.#gesture;
    if (!g) return false;
    this.#gesture = null;
    this.#h.host.requestOverlay();
    if (g.kind === 'drag' && g.price !== g.grabbed) emitDrag(g.line, g.part, g.grabbed);
    return true;
  }

  /** Escape discards every pending change. */
  keyDown(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape') return false;
    const lines = [...this.#pending.keys()];
    for (const line of lines) this.#discard(line);
    return lines.length > 0;
  }

  cursor(p: Point): string | null | undefined {
    const g = this.#gesture;
    if (g) return g.kind === 'drag' || g.kind === 'bracket' ? 'ns-resize' : 'pointer';
    const hit = this.hitTest(p);
    if (!hit) return undefined;
    if (hit.grip) return 'ns-resize';
    if (hit.button || hit.cluster || hit.edit) return 'pointer';
    if (draggable(hit.line, hit.part)) return 'ns-resize';
    return handlers(hit.line).onClick ? 'pointer' : null;
  }

  /** A drag released at a new price: wait for confirmation, or commit it. */
  #release(line: ActiveLine, part: TradeLinePart, price: number, from: number): void {
    if (line instanceof TradeLine && confirms(line)) {
      if (price === from) this.#pending.delete(line);
      else this.#pending.set(line, { part, price, from });
      this.#h.host.requestOverlay();
      return;
    }
    if (line instanceof AlertLine) {
      line.applyOptions({ price });
      line.options.onChange?.({ price, from });
    } else if (line instanceof DraftLine) {
      line.applyOptions(partPatch(part, price));
    } else {
      line.applyOptions(partPatch(part, price));
      line.options.onChange?.({ part, price, from });
    }
  }

  /**
   * Apply a pending change and report it. The line commits before `onChange`
   * runs, so it shows the confirmed price at once; an app that rejects the
   * change puts it back with `applyOptions`.
   */
  #confirm(line: TradeLine): void {
    const p = this.#pending.get(line);
    if (!p) return;
    this.#pending.delete(line);
    line.applyOptions(partPatch(p.part, p.price));
    line.options.onChange?.({ part: p.part, price: p.price, from: p.from });
  }

  /** Drop a pending change; the part returns to its committed price, reported like Escape during a drag. */
  #discard(line: TradeLine): void {
    const p = this.#pending.get(line);
    if (!p) return;
    this.#pending.delete(line);
    this.#h.host.requestOverlay();
    line.options.onDrag?.({ part: p.part, price: p.from });
  }

  /** A button of a line's block was pressed and released on it. */
  #press(line: ActiveLine, part: TradeLinePart, button: Button): void {
    if (line instanceof AlertLine) line.options.onRemove?.();
    else if (line instanceof DraftLine) {
      if (button === 'confirm') line.commit();
      else if (part === 'entry') line.discard();
      else line.applyOptions(part === 'takeProfit' ? { takeProfit: null } : { stopLoss: null });
    } else if (button === 'confirm' || button === 'discard') {
      if (dragLocked(line)) return;
      if (button === 'confirm') this.#confirm(line);
      else this.#discard(line);
    }
    else if (button !== 'remove') line.options.onAction?.({ action: button, part });
  }

  /** Follow the pointer with the bracket a handle proposes: which side of the entry decides the part. */
  #moveBracket(g: Extract<Gesture, { kind: 'bracket' }>, p: Point): void {
    const t = this.#h.target(g.line.options.series);
    // A pending entry move is where the user sees the entry.
    const entry = this.#priceOf(g.line, 'entry') ?? g.line.options.price;
    let part: BracketPart | null = null;
    let price: number | null = null;
    if (t && beyond(g.start, p, g.slop)) {
      const tick = g.line.options.tickSize ?? defaultTickSize(t.series, entry);
      price = dragPrice(t.scale, p.y - t.pane.top, tick);
      const above = price > entry;
      if (price !== entry) part = above === (g.line.options.side === 'buy') ? 'takeProfit' : 'stopLoss';
      if (part && !this.#missingBrackets(g.line).includes(part)) part = null;
      if (!part) price = null;
    }
    if (part === g.part && price === g.price) return;
    g.part = part;
    g.price = price;
    this.#h.host.requestOverlay();
  }

  /** A handle released at a bracket price: a draft takes it, a trade line proposes it to the app. */
  #proposeBracket(line: BracketLine, part: BracketPart, price: number): void {
    if (line instanceof DraftLine) {
      line.applyOptions(part === 'takeProfit' ? { takeProfit: price } : { stopLoss: price });
      return;
    }
    this.#proposed.set(line, { ...this.#proposed.get(line), [part]: price });
    this.#h.host.requestOverlay();
    line.options.onBracketCreate?.({ part, price });
  }

  /**
   * The app changed a line's options: setting a proposed bracket (to a price,
   * or to null to reject it) answers that proposal, and a moved part drops its
   * pending change.
   */
  #answered(line: TradeLine, patch: Partial<TradeLineOptions>): void {
    const proposed = this.#proposed.get(line);
    if (proposed) {
      const rest = { ...proposed };
      for (const part of BRACKETS) if (part in patch) delete rest[part];
      if (rest.takeProfit === undefined && rest.stopLoss === undefined) this.#proposed.delete(line);
      else this.#proposed.set(line, rest);
    }
    const p = this.#pending.get(line);
    if (p && committedPrice(line, p.part) !== p.from) this.#pending.delete(line);
  }

  /** Brackets a handle can still add: those neither set nor proposed. */
  #missingBrackets(line: BracketLine): BracketPart[] {
    const proposed = line instanceof TradeLine ? this.#proposed.get(line) : undefined;
    return BRACKETS.filter((part) => partPrice(line.options, part) === null && proposed?.[part] === undefined);
  }

  #editDraft(draft: DraftLine, segment: DraftSegment, anchor: Point): void {
    let prevented = false;
    const e: DraftEditEvent = {
      draft,
      segment,
      anchor,
      preventDefault: () => (prevented = true),
      get defaultPrevented() {
        return prevented;
      },
    };
    this.#h.host.draftEdit?.(e);
  }

  #commitDraft(draft: DraftLine): void {
    if (!this.#drafts.includes(draft)) return;
    const o = draft.options;
    const e: OrderCreateEvent = { side: o.side, type: o.type, price: o.price };
    if (o.quantity !== undefined) e.quantity = o.quantity;
    if (typeof o.takeProfit === 'number') e.takeProfit = o.takeProfit;
    if (typeof o.stopLoss === 'number') e.stopLoss = o.stopLoss;
    this.#detach(draft);
    this.#h.host.orderCreate?.(e);
  }

  /** Bottom centre of a draft segment in chart-root css px, or null when it is not laid out. */
  #segmentAnchor(draft: DraftLine, segment: DraftSegment): Point | null {
    const v = this.partViews().find((x) => x.line === draft && x.part === 'entry');
    const seg = v?.segments.find((s) => s.edit === segment);
    return v && seg ? this.#rootPoint({ x: seg.x + seg.width / 2, y: v.top + v.height }) : null;
  }

  /** The cluster's summary click: the option, then the chart event the UI package shows a list for. */
  #clickCluster(lines: TradeLine[], anchor: Point): void {
    const live = lines.filter((l) => this.trades.includes(l));
    if (live.length === 0) return;
    let prevented = false;
    const e: ClusterClickEvent = {
      lines: live,
      anchor,
      preventDefault: () => (prevented = true),
      get defaultPrevented() {
        return prevented;
      },
    };
    this.#h.options().onClusterClick?.(e);
    this.#h.host.clusterClick?.(e);
  }

  /** Centre of a cluster's summary block, or null when it is not laid out. */
  #clusterAnchor(lines: TradeLine[]): Point | null {
    const v = this.partViews().find((x) => x.cluster && x.cluster[0] === lines[0]);
    if (!v) return null;
    const first = v.segments[0]!;
    const last = v.segments[v.segments.length - 1]!;
    return this.#rootPoint({ x: (first.x + last.x + last.width) / 2, y: v.top + v.height / 2 });
  }

  /** Plot-space point to chart-root css px, the space of pointer events (like `chart.pointAt`). */
  #rootPoint(p: Point): Point {
    return { x: p.x + this.#h.host.plotLeft, y: p.y };
  }

  /** The draggable cluster member line nearest `p`, within grabbing distance. */
  #clusterMember(lines: TradeLine[], p: Point): Hit | null {
    let best: Hit | null = null;
    let bestDist = HIT;
    for (const v of this.partViews()) {
      if (!v.clustered || !lines.includes(v.line as TradeLine) || !draggable(v.line, v.part)) continue;
      const d = Math.abs(p.y - v.y);
      if (d <= bestDist) {
        best = { line: v.line, part: v.part, button: null, y: v.y };
        bestDist = d;
      }
    }
    return best;
  }

  /** Turn a summary-label press into a drag of the member line under it. */
  #dragMember(member: Hit, start: Point, slop: number): Gesture | null {
    const line = member.line;
    const price = this.#owns(line) ? committedPrice(line, member.part) : null;
    if (price === null) {
      this.#gesture = null;
      return null;
    }
    const g: Gesture = { kind: 'drag', line, part: member.part, from: price, grabbed: price, price, offset: start.y - member.y, start, slop };
    this.#gesture = g;
    this.#setHover(member, start);
    return g;
  }

  /* ------------------------------- render ------------------------------ */

  render(ctx: CanvasRenderingContext2D, pane: Pane): void {
    const width = this.#h.host.time.width;
    this.#renderLineOnly(ctx, pane, width);
    // Alert lines are drawn by their primitives.
    const own = this.partViews().filter((v) => v.target.pane === pane && !(v.line instanceof AlertLine));
    for (const v of own) if (!v.cluster) this.#drawPartLine(ctx, v, width);
    for (const v of own) if (!v.clustered) this.#drawBlock(ctx, v);
  }

  /** Price-axis labels and the hovered button's or line's tooltip. */
  renderLabels(ctx: CanvasRenderingContext2D): void {
    this.#lineOnlyLabels(ctx);
    const views = this.partViews();
    // The dragged line's label goes on top.
    const g = this.#gesture;
    views.sort((a, b) => Number(isDragged(g, a)) - Number(isDragged(g, b)));
    for (const v of views) {
      // A cluster keeps one axis label: its lowest line's.
      if (v.cluster || (v.clustered && !v.keepLabel) || (v.line.options as LineLabelOptions).priceAxisLabel === false) continue;
      this.#axisLabel(ctx, v.target, v.price, v.y, v.color);
    }
    this.#drawTooltip(ctx, views);
  }

  #axisLabel(ctx: CanvasRenderingContext2D, t: Target, price: number, y: number, color: string): void {
    this.#h.host.axisLabel(ctx, this.#h.axisText(t, price), y, color, contrastText(color), t);
  }

  /* ----------------------------- internals ----------------------------- */

  #detach(line: object): void {
    const count = () => this.trades.length + this.#alerts.length + this.#drafts.length;
    const before = count();
    this.trades = this.trades.filter((l) => l !== line);
    this.#alerts = this.#alerts.filter((l) => l !== line);
    this.#drafts = this.#drafts.filter((l) => l !== line);
    if (count() === before) return;
    if (line instanceof TradeLine) {
      this.#pending.delete(line);
      this.#proposed.delete(line);
    }
    if (line instanceof AlertLine) {
      this.#attachments.get(line)?.detach();
      this.#attachments.delete(line);
    }
    const g = this.#gesture;
    if (g && 'line' in g && g.line === line) this.#gesture = null;
    if (this.#hover?.line === line) this.#endHover();
    this.#h.host.requestOverlay();
  }

  /** Drop the hover, ending a line's hover like the pointer leaving it. */
  #endHover(): void {
    const h = this.#hover;
    this.#hover = null;
    if (h && !h.cluster) handlers(h.line).onHoverEnd?.();
  }

  #owns(line: ActiveLine): boolean {
    if (line instanceof AlertLine) return this.#alerts.includes(line);
    if (line instanceof DraftLine) return this.#drafts.includes(line);
    return this.trades.includes(line);
  }

  /**
   * Attach the alert's plot primitive for `series` (default: the main series,
   * so it lands in the pane it is drawn and hit-tested in), or move it when
   * that changed. Throws, keeping the current attachment, when the series is
   * not on the chart. It draws only the line and its block; the axis label
   * is drawn with the trade lines' so a dragged label stays on top.
   */
  #attachAlert(line: AlertLine, series: Series | undefined): void {
    const host = this.#h.host;
    const target = series ?? host.main ?? null;
    const current = this.#attachments.get(line);
    if (current?.series === target) return;
    const primitive: Primitive = {
      layer: 'top',
      drawPlot: (ctx) => this.#drawAlert(ctx, line),
    };
    const detach = host.attachPrimitive(primitive, target);
    current?.detach();
    this.#attachments.set(line, { series: target, detach });
  }

  /** Primitive draw of one alert, in the pane-local space primitives get. */
  #drawAlert(ctx: CanvasRenderingContext2D, line: AlertLine): void {
    const t = this.#h.target(line.options.series);
    if (!t || !line.visible) return;
    const price = this.#priceOf(line, 'entry');
    if (price === null) return;
    const y = t.pane.top + t.scale.priceToY(price);
    if (!(y >= t.pane.top && y <= t.pane.top + t.pane.height)) return;
    const host = this.#h.host;
    ctx.save();
    ctx.translate(0, -t.pane.top);
    if (line.options.lineOnly) {
      const o = line.options;
      hLine(ctx, y, host.time.width, o.color ?? host.theme.alert, o.lineWidth, o.lineStyle);
      ctx.restore();
      return;
    }
    const v = this.#layoutPart(line, 'entry', price, y, t);
    ctx.font = fontCss(resolveFont(host.theme, 'labels'));
    this.#drawPartLine(ctx, v, host.time.width);
    this.#drawBlock(ctx, v);
    ctx.restore();
  }

  /**
   * Price a part shows: while dragged, the pointer's; a pending change; a
   * bracket a handle proposes (being dragged, or waiting for the app); else
   * the committed price.
   */
  #priceOf(line: ActiveLine, part: TradeLinePart): number | null {
    const g = this.#gesture;
    if (g?.kind === 'drag' && g.line === line && g.part === part) return g.price;
    if (g?.kind === 'bracket' && g.line === line && g.part === part) return g.price;
    const committed = committedPrice(line, part);
    if (!(line instanceof TradeLine)) return committed;
    const pending = this.#pending.get(line);
    if (pending?.part === part && committed !== null) return pending.price;
    if (committed === null && part !== 'entry') return this.#proposed.get(line)?.[part] ?? null;
    return committed;
  }

  /**
   * Visible line parts in draw order: alerts (drawn below on the primitive
   * layer), then per trade line take-profit, stop-loss and the entry on top.
   */
  private partViews(): PartView[] {
    const out: PartView[] = [];
    for (const line of [...this.#alerts, ...this.trades, ...this.#drafts]) {
      const t = this.#h.target(line.options.series);
      // Line-only lines have no block and no hit testing; they are drawn on their own.
      if (!t || !line.visible || ('lineOnly' in line.options && line.options.lineOnly)) continue;
      for (const part of PARTS) {
        const price = this.#priceOf(line, part);
        if (price === null) continue;
        const y = t.pane.top + t.scale.priceToY(price);
        if (!(y >= t.pane.top && y <= t.pane.top + t.pane.height)) continue;
        out.push(this.#layoutPart(line, part, price, y, t));
      }
    }
    return this.#h.options().overlap === 'cluster' ? this.#foldClusters(out) : out;
  }

  /**
   * Fold overlapping order and position labels (entry blocks) of each pane
   * into one summary block per run. Blocks closer than `mergeGapPx` join; a
   * cluster splits only once its blocks are `splitGapPx` apart. Blocks must
   * also overlap across the plot, so labels at different anchors stay apart.
   */
  #foldClusters(views: PartView[]): PartView[] {
    const { mergeGapPx, splitGapPx, minLines } = this.#h.options().cluster;
    const previous = this.clusterOf;
    const next = new Map<TradeLine, number>();
    const summaries: PartView[] = [];
    const candidates = views.filter((v) => v.line instanceof TradeLine && v.part === 'entry');
    const byPane = new Map<Pane, PartView[]>();
    for (const v of candidates) byPane.set(v.target.pane, [...(byPane.get(v.target.pane) ?? []), v]);
    let id = 0;
    const maxGap = Math.max(mergeGapPx, splitGapPx);
    for (const list of byPane.values()) {
      list.sort((a, b) => a.y - b.y);
      const runs: PartView[][] = [];
      // Runs whose last block a lower block could still join.
      let open: PartView[][] = [];
      for (const v of list) {
        open = open.filter((run) => v.top - bottom(run[run.length - 1]!) < maxGap);
        const run = open.find((r) => {
          const prev = r[r.length - 1]!;
          if (!overlapsX(prev, v)) return false;
          const was = previous.get(prev.line as TradeLine);
          const together = was !== undefined && was === previous.get(v.line as TradeLine);
          return v.top - bottom(prev) < (together ? splitGapPx : mergeGapPx);
        });
        if (run) run.push(v);
        else {
          const fresh = [v];
          runs.push(fresh);
          open.push(fresh);
        }
      }
      for (const run of runs) {
        if (run.length >= Math.max(2, minLines)) {
          id++;
          for (const v of run) {
            v.clustered = true;
            next.set(v.line as TradeLine, id);
          }
          // The lowest line keeps its axis label and anchors the summary.
          const lowest = run[run.length - 1]!;
          lowest.keepLabel = true;
          summaries.push(this.#summaryView(run, lowest));
        }
      }
    }
    this.clusterOf = next;
    return [...views, ...summaries];
  }

  /** A cluster's summary block: how many orders, at the lowest line's level and anchor. */
  #summaryView(members: PartView[], lowest: PartView): PartView {
    const theme = this.#h.host.theme;
    const lines = members.map((v) => v.line as TradeLine);
    const orders = lines.every((l) => l.options.kind === 'order');
    const text = `${lines.length} ${orders ? 'orders' : 'lines'}`;
    const color = theme.labelBackground;
    const view = this.#layoutBlock(lowest.line, 'entry', lowest.price, lowest.y, lowest.target, color, [
      { text, color: theme.labelText, fill: color, button: null },
    ]);
    return { ...view, cluster: lines };
  }

  #layoutPart(line: ActiveLine, part: TradeLinePart, price: number, y: number, t: Target): PartView {
    const theme = this.#h.host.theme;
    const color = partColor(line, part, theme);
    const format = this.#h.format(t);
    const draft = line instanceof DraftLine;
    // A draft's label is outlined rather than filled: it is not an order yet.
    const specs: Omit<Segment, 'x' | 'width'>[] = [
      draft && part === 'entry'
        ? { text: partLabel(line, part), color, fill: withAlpha(color, 0.2), button: null }
        : { text: partLabel(line, part), color: contrastText(color), fill: color, button: null },
    ];
    const plain = (text: string, textColor = theme.text) => specs.push({ text, color: textColor, fill: null, button: null });
    if (line instanceof AlertLine) {
      if (line.options.title) plain(line.options.title);
      plain(format(price));
    } else if (line instanceof DraftLine) {
      const o = line.options;
      if (part === 'entry') {
        specs.push({ text: o.quantity === undefined ? 'Qty' : String(o.quantity), color: theme.text, fill: null, button: null, edit: 'quantity' });
        specs.push({ text: ORDER_TYPE_NAMES[o.type], color: theme.text, fill: null, button: null, edit: 'type' });
      }
      plain(format(price));
    } else {
      const o = line.options;
      if (part === 'entry' && o.quantity !== undefined && o.quantity !== '') plain(String(o.quantity));
      plain(format(price));
      if (o.kind === 'position' && part === 'entry' && o.pnl) {
        const pnl = positionPnl(o, t.series);
        if (pnl !== null) {
          const text = o.formatPnl?.(pnl) ?? `${pnl < 0 ? '-' : '+'}${format(Math.abs(pnl))}`;
          plain(text, pnl < 0 ? theme.down : theme.up);
        }
      }
    }
    if (part === 'entry' && this.#hasGrip(line)) specs.push({ text: '', color: theme.text, fill: null, button: null, grip: true });
    // A proposed bracket has nothing to press until the app answers.
    if (committedPrice(line, part) !== null) {
      for (const button of this.#buttons(line, part)) specs.push({ text: '', color: theme.text, fill: null, button });
    }
    return this.#layoutBlock(line, part, price, y, t, color, specs);
  }

  /** Whether a line's entry block shows the bracket handle. */
  #hasGrip(line: ActiveLine): line is BracketLine {
    if (line instanceof AlertLine) return false;
    if (line instanceof TradeLine) {
      const o = line.options;
      if (!o.onBracketCreate || o.readOnly || o.bracketReadOnly) return false;
    }
    return this.#missingBrackets(line).length > 0;
  }

  /** Buttons of a part: confirm and discard while a change is pending, else the line's own. */
  #buttons(line: ActiveLine, part: TradeLinePart): readonly Button[] {
    if (line instanceof AlertLine) return line.options.onRemove ? ['remove'] : [];
    if (line instanceof DraftLine) return part === 'entry' ? ['confirm', 'discard'] : ['discard'];
    if (this.#pending.get(line)?.part === part && !dragLocked(line)) return ['confirm', 'discard'];
    const o = line.options;
    if (!o.onAction || o.readOnly || o.actionsReadOnly) return [];
    return part === 'entry' ? o.actions : o.bracketActions;
  }

  /** Place a label block's segments, right-aligned next to the price axis unless anchored elsewhere. */
  #layoutBlock(
    line: ActiveLine,
    part: TradeLinePart,
    price: number,
    y: number,
    t: Target,
    color: string,
    specs: Omit<Segment, 'x' | 'width'>[],
  ): PartView {
    const host = this.#h.host;
    const height = resolveFont(host.theme, 'labels').fontSize + 8;
    const widths = specs.map((s) => (s.button || s.grip ? height : Math.ceil(host.measureText(s.text)) + PAD * 2));
    const total = widths.reduce((a, b) => a + b, 0);
    const width = host.time.width;
    const anchor = line.options.labelAnchor ?? 'right';
    let x = Math.round(anchor === 'left' ? BLOCK_INSET : anchor === 'center' ? (width - total) / 2 : width - BLOCK_INSET - total);
    const segments = specs.map((s, i) => {
      const seg = { ...s, x, width: widths[i]! };
      x += widths[i]!;
      return seg;
    });
    // Keep the whole block inside the pane while its line is visible, below the pane buttons in their corner.
    const pane = t.pane;
    const lowest = pane.top + pane.height - height;
    const buttons = anchor === 'center' ? null : host.paneButtons?.();
    const first = buttons?.side === anchor ? Math.max(pane.top, Math.min(pane.top + buttons.height + BUTTONS_GAP, lowest)) : pane.top;
    const top = Math.round(clampLow(y - height / 2, first, lowest));
    return { line, part, price, y, color, target: t, top, height, segments };
  }

  private hitTest(p: Point): Hit | null {
    if (p.x < 0 || p.x > this.#h.host.time.width) return null;
    const views = this.partViews();
    // Blocks are drawn above every line, so they win; folded ones are not drawn.
    for (let i = views.length - 1; i >= 0; i--) {
      const v = views[i]!;
      if (v.clustered) continue;
      const first = v.segments[0]!;
      const last = v.segments[v.segments.length - 1]!;
      if (p.y < v.top || p.y > v.top + v.height || p.x < first.x || p.x > last.x + last.width) continue;
      if (v.cluster) return { line: v.line, part: v.part, button: null, y: v.y, cluster: v.cluster };
      const seg = v.segments.find((s) => (s.button || s.grip || s.edit) && p.x >= s.x && p.x <= s.x + s.width);
      const hit: Hit = { line: v.line, part: v.part, button: seg?.button ?? null, y: v.y };
      if (seg?.grip) hit.grip = true;
      if (seg?.edit) hit.edit = seg.edit;
      return hit;
    }
    let best: Hit | null = null;
    let bestDist = HIT;
    for (let i = views.length - 1; i >= 0; i--) {
      const v = views[i]!;
      if (v.cluster) continue;
      const d = Math.abs(p.y - v.y);
      if (d <= bestDist) {
        best = { line: v.line, part: v.part, button: null, y: v.y };
        bestDist = d - 1e-9;
      }
    }
    return best;
  }

  /** Track the hovered line; enter and leave fire once per line part, not per button. */
  #setHover(hit: Hit | null, p: Point | null): void {
    const h = this.#hover;
    const moved = this.#hoverPoint?.x !== p?.x || this.#hoverPoint?.y !== p?.y;
    this.#hoverPoint = p;
    const sameTarget = h?.line === hit?.line && h?.part === hit?.part && !h?.cluster === !hit?.cluster;
    if (sameTarget && h?.button === hit?.button) {
      // A line tooltip follows the pointer.
      if (moved && hit && !hit.button && handlers(hit.line).tooltip) this.#h.host.requestOverlay();
      return;
    }
    this.#hover = hit;
    this.#h.host.requestOverlay();
    if (sameTarget) return;
    if (h && !h.cluster) handlers(h.line).onHoverEnd?.();
    if (hit && !hit.cluster && p) {
      const price = this.#priceOf(hit.line, hit.part);
      if (price !== null) handlers(hit.line).onHover?.(pointerEvent(hit.line, hit.part, price, this.#rootPoint(p)));
    }
  }

  /** Lines drawn without a label block (`lineOnly`): trade lines here, alerts in their primitive. */
  #renderLineOnly(ctx: CanvasRenderingContext2D, pane: Pane, width: number): void {
    for (const line of this.trades) {
      const o = line.options;
      if (!o.lineOnly || !line.visible) continue;
      const t = this.#h.target(o.series);
      if (!t || t.pane !== pane) continue;
      for (const part of PARTS) {
        const price = partPrice(o, part);
        if (price === null) continue;
        const y = pane.top + t.scale.priceToY(price);
        if (y < pane.top || y > pane.top + pane.height) continue;
        hLine(ctx, y, width, partColor(line, part, this.#h.host.theme), o.lineWidth, part === 'entry' ? o.lineStyle : 'dashed');
      }
    }
  }

  /** Axis labels of line-only lines, unless `priceAxisLabel` is off. */
  #lineOnlyLabels(ctx: CanvasRenderingContext2D): void {
    for (const line of [...this.#alerts, ...this.trades]) {
      const o = line.options;
      if (!o.lineOnly || !line.visible || o.priceAxisLabel === false) continue;
      const t = this.#h.target(o.series);
      if (!t) continue;
      for (const part of PARTS) {
        const price = committedPrice(line, part);
        if (price === null) continue;
        const y = t.pane.top + t.scale.priceToY(price);
        if (y < t.pane.top || y > t.pane.top + t.pane.height) continue;
        this.#axisLabel(ctx, t, price, y, partColor(line, part, this.#h.host.theme));
      }
    }
  }

  #drawPartLine(ctx: CanvasRenderingContext2D, v: PartView, width: number): void {
    const o = v.line.options;
    const dragged = isDragged(this.#gesture, v);
    const pending = v.line instanceof TradeLine && this.#pending.get(v.line)?.part === v.part;
    if (dragged || pending) {
      // Faint line at the committed price.
      const from = committedPrice(v.line, v.part);
      if (from !== null) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        hLine(ctx, v.target.pane.top + v.target.scale.priceToY(from), width, v.color, 1, 'dotted');
        ctx.restore();
      }
    }
    const hovered = this.#hover?.line === v.line && this.#hover.part === v.part && draggable(v.line, v.part);
    const style = v.part === 'entry' ? o.lineStyle : 'dashed';
    ctx.save();
    if (v.line instanceof DraftLine) ctx.globalAlpha = DRAFT_ALPHA;
    hLine(ctx, v.y, width, v.color, o.lineWidth + (dragged || hovered ? 1 : 0), style);
    ctx.restore();
  }

  #drawBlock(ctx: CanvasRenderingContext2D, v: PartView): void {
    const theme = this.#h.host.theme;
    const first = v.segments[0]!;
    const last = v.segments[v.segments.length - 1]!;
    const x = first.x;
    const w = last.x + last.width - first.x;
    const h = v.height;
    const hot = this.#hover?.line === v.line && this.#hover.part === v.part ? this.#hover.button : null;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(x + 0.5, v.top + 0.5, w - 1, h - 1, 2);
    ctx.fillStyle = theme.background;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (const s of v.segments) {
      const fill = s.fill ?? (s.button && s.button === hot ? withAlpha(v.color, 0.25) : null);
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(s.x, v.top, s.width, h);
    }
    ctx.restore();
    ctx.strokeStyle = v.color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    for (const s of v.segments.slice(1)) {
      ctx.moveTo(s.x + 0.5, v.top);
      ctx.lineTo(s.x + 0.5, v.top + h);
    }
    ctx.stroke();
    const cy = v.top + h / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of v.segments) {
      if (s.button || s.grip) drawGlyph(ctx, s.button ?? 'grip', s.x + s.width / 2, cy, theme.text);
      else {
        ctx.fillStyle = s.color;
        fillText(ctx, s.text, s.x + s.width / 2, cy + 0.5);
      }
    }
    ctx.restore();
  }

  #drawTooltip(ctx: CanvasRenderingContext2D, views: PartView[]): void {
    const h = this.#hover;
    const g = this.#gesture;
    if (!h || g?.kind === 'drag' || g?.kind === 'bracket') return;
    if (!h.button && !h.grip) {
      // A hovered line's own `tooltip` text, above the pointer (below it near the top).
      const raw = h.cluster ? undefined : handlers(h.line).tooltip;
      const p = this.#hoverPoint;
      const rows = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]).filter((t) => t !== '');
      if (p && rows.length > 0) this.#h.tooltip(ctx, rows, p);
      return;
    }
    const v = views.find((x) => x.line === h.line && x.part === h.part && !x.cluster);
    const seg = v?.segments.find((s) => (h.grip ? s.grip : s.button === h.button));
    if (!v || !seg) return;
    const host = this.#h.host;
    const theme = host.theme;
    const text = h.button ? tooltip(v.line, v.part, h.button) : 'Drag to add take profit or stop loss';
    const font = resolveFont(theme, 'labels');
    const w = Math.ceil(host.measureText(text)) + 12;
    const th = font.fontSize + 8;
    const x = clampLow(seg.x + seg.width / 2 - w / 2, 2, host.time.width - w - 2);
    let y = v.top - th - 4;
    if (y < v.target.pane.top) y = v.top + v.height + 4;
    ctx.save();
    ctx.font = fontCss(font);
    ctx.fillStyle = theme.labelBackground;
    ctx.beginPath();
    ctx.roundRect(x, y, w, th, 3);
    ctx.fill();
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillText(ctx, text, x + w / 2, y + th / 2 + 0.5);
    ctx.restore();
  }
}

/** A line's pointer callbacks, typed for any line: each line's callbacks only ever receive that line. */
function handlers(line: ActiveLine): LineInteractionOptions<ActiveLine> {
  return line.options as unknown as LineInteractionOptions<ActiveLine>;
}

function bottom(v: PartView): number {
  return v.top + v.height;
}

/** Whether two label blocks share any horizontal extent. */
function overlapsX(a: PartView, b: PartView): boolean {
  const left = (v: PartView) => v.segments[0]!.x;
  const right = (v: PartView) => {
    const last = v.segments[v.segments.length - 1]!;
    return last.x + last.width;
  };
  return left(a) < right(b) && left(b) < right(a);
}

/** Committed price of a part; alerts only have an entry. */
function committedPrice(line: ActiveLine, part: TradeLinePart): number | null {
  if (line instanceof AlertLine) return part === 'entry' ? line.options.price : null;
  return partPrice(line.options, part);
}

function draggable(line: ActiveLine, part: TradeLinePart): boolean {
  if (line instanceof DraftLine) return true;
  if (line instanceof AlertLine) return Boolean(line.options.onChange || line.options.onDrag);
  const o = line.options;
  if ((o.kind === 'position' && part === 'entry') || dragLocked(line)) return false;
  return Boolean(o.onChange || o.onDrag);
}

/** Whether users may not move a trade line's prices, which also locks a pending change's confirm and discard. */
function dragLocked(line: TradeLine): boolean {
  return Boolean(line.options.readOnly || line.options.dragReadOnly);
}

/** Whether a released drag of this line waits for confirmation. */
function confirms(line: TradeLine): boolean {
  return line.options.confirmChanges ?? line.options.kind === 'order';
}

function emitDrag(line: ActiveLine, part: TradeLinePart, price: number): void {
  if (line instanceof AlertLine) line.options.onDrag?.({ price });
  else if (line instanceof TradeLine) line.options.onDrag?.({ part, price });
}

const PART_NAMES: Record<TradeLinePart, string> = { entry: '', takeProfit: ' take profit', stopLoss: ' stop loss' };
const ACTION_NAMES: Record<TradeAction, string> = { cancel: 'Cancel', close: 'Close', reverse: 'Reverse' };
const ORDER_TYPE_NAMES: Record<DraftLineOptions['type'], string> = { limit: 'Limit', stop: 'Stop', market: 'Market' };

/**
 * Button tooltip, e.g. "Cancel order", "Close position", "Cancel stop loss",
 * "Remove alert", "Confirm move" or "Place order".
 */
function tooltip(line: ActiveLine, part: TradeLinePart, button: Button): string {
  if (line instanceof AlertLine || button === 'remove') return 'Remove alert';
  if (line instanceof DraftLine) {
    if (button === 'confirm') return 'Place order';
    return part === 'entry' ? 'Discard order' : `Remove${PART_NAMES[part]}`;
  }
  if (button === 'confirm') return 'Confirm move';
  if (button === 'discard') return 'Discard move';
  const name = ACTION_NAMES[button];
  if (part !== 'entry') return name + PART_NAMES[part];
  return `${name} ${line.options.kind}`;
}

function partColor(line: ActiveLine, part: TradeLinePart, theme: ChartTheme): string {
  if (line instanceof AlertLine) return line.options.color ?? theme.alert;
  if (part === 'takeProfit') return theme.up;
  if (part === 'stopLoss') return theme.down;
  return line.options.color ?? (line.options.side === 'buy' ? theme.up : theme.down);
}

function partLabel(line: ActiveLine, part: TradeLinePart): string {
  if (line instanceof AlertLine) return line.options.label;
  if (part === 'takeProfit') return 'TP';
  if (part === 'stopLoss') return 'SL';
  const buy = line.options.side === 'buy';
  if (line instanceof DraftLine) return buy ? 'Buy' : 'Sell';
  if (line.options.label) return line.options.label;
  if (line.options.kind === 'position') return buy ? 'Long' : 'Short';
  return buy ? 'Buy' : 'Sell';
}

/** Profit or loss of a position at the series' last price; quantity 1 unless numeric. */
function positionPnl(o: TradeLineOptions, series: Series | null): number | null {
  const last = lastPrice(series);
  if (last === undefined) return null;
  const qty = typeof o.quantity === 'number' ? o.quantity : 1;
  return (last - o.price) * (o.side === 'buy' ? 1 : -1) * qty;
}

function lastPrice(series: Series | null): number | undefined {
  if (series instanceof CandleSeries) return series.data[series.data.length - 1]?.close;
  if (series instanceof LineSeries || series instanceof HistogramSeries) return series.data[series.data.length - 1]?.value;
  return undefined;
}

function isDragged(g: Gesture | null, v: { line: ActiveLine; part: TradeLinePart }): boolean {
  return g?.kind === 'drag' && g.line === v.line && g.part === v.part;
}

function drawGlyph(ctx: CanvasRenderingContext2D, button: Button | 'grip', x: number, y: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (button === 'confirm') {
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 1, y + 3);
    ctx.lineTo(x + 4, y - 3.5);
  } else if (button === 'grip') {
    // A vertical double arrow: drag up or down.
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    for (const dir of [-1, 1]) {
      ctx.moveTo(x - 2.5, y + 2.5 * dir);
      ctx.lineTo(x, y + 5 * dir);
      ctx.lineTo(x + 2.5, y + 2.5 * dir);
    }
  } else if (button === 'reverse') {
    // Up arrow on the left, down arrow on the right.
    for (const [dx, dir] of [[-3, -1], [3, 1]] as const) {
      ctx.moveTo(x + dx, y - 4 * dir);
      ctx.lineTo(x + dx, y + 4 * dir);
      ctx.moveTo(x + dx - 2.5, y + 1.5 * dir);
      ctx.lineTo(x + dx, y + 4 * dir);
      ctx.lineTo(x + dx + 2.5, y + 1.5 * dir);
    }
  } else {
    const r = 3.5;
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
  }
  ctx.stroke();
  ctx.restore();
}
