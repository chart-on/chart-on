import type { Pane } from './pane';
import type { AttachedPrimitive, Primitive, PrimitiveEnv, PrimitiveHost, PrimitiveLane, PrimitiveRegistry } from './primitives';
import { Emitter } from './util/emitter';
import { fillText, fontCss, resolveFont } from './typography';
import { formatCompact } from './util/format';
import { clampLow } from './util/math';

/**
 * Depth lane: horizontal bars beside the price axis showing how much size the
 * app's order book holds at each price. The app supplies the levels (from any
 * feed); the lane only lays them out against the price scale. It is an
 * ordinary primitive that reserves a lane between the plot and the axis.
 * The `depthLane()` plugin also brings the lane host below, which lays out
 * the lanes of every primitive (`Primitive.lane`); a chart without it has none.
 */

/** Size resting at one price. */
export interface DepthLevel {
  price: number;
  size: number;
}

/** Both sides of a book. Order does not matter; the lane sorts them. */
export interface DepthBook {
  bids: readonly DepthLevel[];
  asks: readonly DepthLevel[];
}

/** Incremental changes: a level with size 0 is removed, any other size replaces the level. */
export interface DepthChanges {
  bids?: readonly DepthLevel[];
  asks?: readonly DepthLevel[];
}

/** Options for a depth lane: the axis side and width, levels shown per side, labels, colours and how often it repaints. */
export interface DepthLaneOptions {
  /** A hidden lane takes no width. */
  visible: boolean;
  /** Which price axis the lane sits beside. */
  side: 'left' | 'right';
  /** Lane width in css px. */
  width: number;
  /** Levels shown per side, nearest the best price first. */
  maxLevels: number;
  /** Write each bar's size, where rows leave room for text. */
  labels: boolean;
  /** Draw the best bid and ask in the theme's solid `bid` and `ask` colours. */
  highlightBest: boolean;
  /** Bar colours; default to the theme's `depthBid` and `depthAsk` tokens. */
  bidColor: string | null;
  askColor: string | null;
  /** Least time between repaints caused by level changes, in ms. */
  repaintInterval: number;
}

/** Default values for `DepthLaneOptions`: an 80 px lane beside the right axis showing up to 200 levels per side. */
export const defaultDepthLaneOptions: DepthLaneOptions = {
  visible: true,
  side: 'right',
  width: 80,
  maxLevels: 200,
  labels: false,
  highlightBest: true,
  bidColor: null,
  askColor: null,
  repaintInterval: 100,
};

/** Events emitted by a depth lane, by name: currently a change of the levels it shows. */
export interface DepthLaneEvents {
  /** The shown levels changed: sorted best first and cut to `maxLevels`. */
  'levels:change': DepthBook;
}

/** A depth lane primitive. Attach it with `chart.attachPrimitive`, or create one with `chart.addDepthLane`. */
export interface DepthLane extends Primitive {
  readonly options: Readonly<DepthLaneOptions>;
  /** Merge new options; width, side and visibility changes relay the chart out. */
  applyOptions(options: Partial<DepthLaneOptions>): void;
  /** Replace every level. Levels with size 0 or invalid numbers are left out. */
  setLevels(book: Partial<DepthBook>): void;
  /** Apply changes to single levels: size 0 removes a level, any other size sets it. */
  update(changes: DepthChanges): void;
  /** Remove every level. */
  clear(): void;
  /** Shown levels: bids from the highest price down, asks from the lowest up, at most `maxLevels` each. */
  readonly levels: DepthBook;
  readonly bestBid: DepthLevel | null;
  readonly bestAsk: DepthLevel | null;
  /** Subscribe to lane events; returns an unsubscribe function. */
  on<K extends keyof DepthLaneEvents>(event: K, listener: (payload: DepthLaneEvents[K]) => void): () => void;
}

/** One bar of the lane, in lane-local css px. */
export interface DepthRow {
  side: 'bid' | 'ask';
  price: number;
  size: number;
  /** Vertical centre of the bar. */
  y: number;
  /** Bar height. */
  thickness: number;
  /** Bar length, scaled so the largest visible size fills the lane. */
  length: number;
  /** The best bid or the best ask. */
  best: boolean;
}

/** Thickest bar, in css px, however far apart levels are. */
const MAX_THICKNESS = 14;
/** Bar height when a side has a single level, so there is no neighbour to measure against. */
const LONE_THICKNESS = 6;
/** Gap between the bars and the lane edges for labels, in css px. */
const LABEL_INSET = 3;

/**
 * Lay out the rows of `book` in an area `width` × `height`, using the price
 * scale's `priceToY` (which already applies log, percent and inverted modes).
 * Rows off the area or at prices the scale cannot place are left out. Each
 * bar is as thick as the distance to its nearest neighbour on the same side
 * allows (minus a pixel of gap), and as long as its size relative to the
 * largest visible size.
 */
export function layoutDepthRows(
  book: DepthBook,
  area: Pick<PrimitiveEnv, 'width' | 'height' | 'priceToY'>,
): DepthRow[] {
  const rows: DepthRow[] = [];
  let maxSize = 0;
  const place = (levels: readonly DepthLevel[], side: DepthRow['side']) => {
    const ys = levels.map((l) => area.priceToY(l.price));
    for (let i = 0; i < levels.length; i++) {
      const y = ys[i]!;
      if (!Number.isFinite(y)) continue;
      const gap = Math.min(neighbourGap(y, ys[i - 1]), neighbourGap(y, ys[i + 1]));
      const thickness = gap === Infinity ? LONE_THICKNESS : clampLow(gap > 2 ? gap - 1 : gap, 1, MAX_THICKNESS);
      // Keep rows whose bar reaches into the area.
      if (y + thickness / 2 < 0 || y - thickness / 2 > area.height) continue;
      const level = levels[i]!;
      maxSize = Math.max(maxSize, level.size);
      rows.push({ side, price: level.price, size: level.size, y, thickness, length: 0, best: i === 0 });
    }
  };
  place(book.bids, 'bid');
  place(book.asks, 'ask');
  for (const row of rows) row.length = maxSize > 0 ? (row.size / maxSize) * area.width : 0;
  return rows;
}

function neighbourGap(y: number, other: number | undefined): number {
  return other === undefined || !Number.isFinite(other) ? Infinity : Math.abs(other - y);
}

/** A level the lane can show: finite price, finite positive size. */
function validLevel(level: DepthLevel | null | undefined): level is DepthLevel {
  return !!level && Number.isFinite(level.price) && Number.isFinite(level.size) && level.size > 0;
}

/** Levels of one side, best first: highest price first for bids, lowest first for asks. */
function sortedSide(sizes: ReadonlyMap<number, number>, descending: boolean, max: number): DepthLevel[] {
  const prices = [...sizes.keys()].sort(descending ? (a, b) => b - a : (a, b) => a - b);
  const count = clampLow(Math.floor(max), 0, prices.length);
  const out: DepthLevel[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = { price: prices[i]!, size: sizes.get(prices[i]!)! };
  return out;
}

/**
 * Create a depth lane that shows order book sizes beside the price axis. Attach
 * it with `chart.attachPrimitive` (or use `chart.addDepthLane`, which does
 * both), then feed it levels with `setLevels` and `update`.
 */
export function createDepthLane(options: Partial<DepthLaneOptions> = {}): DepthLane {
  let opts: DepthLaneOptions = { ...defaultDepthLaneOptions, ...options };
  let host: PrimitiveHost | null = null;
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  let shown: DepthBook | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPaint = -Infinity;
  const emitter = new Emitter<DepthLaneEvents>((error) => console.error(error));

  const levels = (): DepthBook =>
    (shown ??= { bids: sortedSide(bids, true, opts.maxLevels), asks: sortedSide(asks, false, opts.maxLevels) });

  /** Repaint the overlay, at most once per `repaintInterval`; later changes wait for a timer. */
  const repaint = () => {
    if (!host || timer) return;
    const wait = lastPaint + opts.repaintInterval - Date.now();
    if (wait <= 0) {
      lastPaint = Date.now();
      host.requestOverlayRedraw();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      lastPaint = Date.now();
      host?.requestOverlayRedraw();
    }, wait);
  };

  const changed = () => {
    shown = null;
    repaint();
    if (emitter.has('levels:change')) emitter.emit('levels:change', levels());
  };

  const apply = (sizes: Map<number, number>, list: readonly DepthLevel[] | undefined) => {
    for (const level of list ?? []) {
      if (level?.size === 0) sizes.delete(level.price);
      else if (validLevel(level)) sizes.set(level.price, level.size);
    }
  };

  const lane: DepthLane = {
    layer: 'top',
    get options() {
      return opts;
    },
    get levels() {
      return levels();
    },
    get bestBid() {
      return levels().bids[0] ?? null;
    },
    get bestAsk() {
      return levels().asks[0] ?? null;
    },
    attached(h) {
      host = h;
    },
    detached() {
      host = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    applyOptions(next) {
      const before = opts;
      opts = { ...opts, ...next };
      if (opts.maxLevels !== before.maxLevels) changed();
      // Width, side and visibility move the plot edge: a full redraw relays out.
      host?.requestRedraw();
    },
    setLevels(book) {
      bids.clear();
      asks.clear();
      apply(bids, book.bids);
      apply(asks, book.asks);
      changed();
    },
    update(changes) {
      apply(bids, changes.bids);
      apply(asks, changes.asks);
      changed();
    },
    clear() {
      bids.clear();
      asks.clear();
      changed();
    },
    on(event, listener) {
      return emitter.on(event, listener);
    },
    lane(): PrimitiveLane | null {
      return opts.visible && opts.width > 0 ? { side: opts.side, width: opts.width } : null;
    },
    drawLane(ctx, env) {
      if (opts.visible) drawDepthLane(ctx, env, layoutDepthRows(levels(), env), opts);
    },
  };
  return lane;
}

function drawDepthLane(ctx: CanvasRenderingContext2D, env: PrimitiveEnv, rows: readonly DepthRow[], opts: DepthLaneOptions): void {
  if (rows.length === 0) return;
  const t = env.theme;
  const pr = env.pixelRatio;
  const snap = (v: number) => Math.round(v * pr) / pr;
  const right = opts.side === 'right';
  const colorOf = (row: DepthRow) =>
    opts.highlightBest && row.best
      ? row.side === 'bid'
        ? t.bid
        : t.ask
      : row.side === 'bid'
        ? (opts.bidColor ?? t.depthBid ?? t.bid)
        : (opts.askColor ?? t.depthAsk ?? t.ask);
  // Bars grow from the axis side toward the plot.
  for (const row of rows) {
    const length = snap(row.length);
    if (length <= 0) continue;
    const top = snap(row.y - row.thickness / 2);
    const height = Math.max(1 / pr, snap(row.y + row.thickness / 2) - top);
    ctx.fillStyle = colorOf(row);
    ctx.fillRect(right ? env.width - length : 0, top, length, height);
  }
  if (!opts.labels) return;
  // The axis font of the theme's typography, a little smaller.
  const font = resolveFont(t, 'axis');
  const size = Math.max(8, font.fontSize - 2);
  ctx.font = fontCss(font, size);
  ctx.fillStyle = t.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = right ? 'left' : 'right';
  const x = right ? LABEL_INSET : env.width - LABEL_INSET;
  // Labels go on rows tall enough for text, skipping any that would overlap the previous one.
  let lastY = -Infinity;
  for (const row of [...rows].sort((a, b) => a.y - b.y)) {
    if (row.thickness < size * 0.75 && !row.best) continue;
    if (row.y - lastY < size + 1) continue;
    lastY = row.y;
    fillText(ctx, formatCompact(row.size), x, snap(row.y));
  }
}

type Side = 'left' | 'right';

/**
 * Lanes primitives reserve on `side` of `pane`, in attach order (the first
 * next to the plot). Primitives on hidden series take none.
 */
function paneLanes(primitives: PrimitiveRegistry, pane: Pane, side: Side): { entry: AttachedPrimitive; width: number }[] {
  const out: { entry: AttachedPrimitive; width: number }[] = [];
  for (const entry of primitives.all) {
    if (entry.pane !== pane || !entry.primitive.lane || (entry.series && !entry.series.visible)) continue;
    const lane = primitives.guard.call(entry.primitive, 'lane', () => entry.primitive.lane!(), null);
    if (!lane || lane.side !== side || !(lane.width > 0)) continue;
    out.push({ entry, width: Math.ceil(lane.width) });
  }
  return out;
}

/** @internal Lane space each side needs: the widest stack of lanes over the panes shown. */
export function measureLanes(panes: readonly Pane[], primitives: PrimitiveRegistry): Record<Side, number> {
  const space = { left: 0, right: 0 };
  for (const pane of panes) {
    if (pane.collapsed) continue;
    for (const side of ['left', 'right'] as const) {
      const total = paneLanes(primitives, pane, side).reduce((sum, l) => sum + l.width, 0);
      space[side] = Math.max(space[side], total);
    }
  }
  return space;
}

/**
 * @internal Primitive drawing in the lanes laid out (`space`) between the
 * plot, `plotWidth` wide from the context's origin, and the axes, clipped to
 * each lane. `env` gives a primitive its environment for a lane of that size.
 */
export function drawLanes(
  ctx: CanvasRenderingContext2D,
  panes: readonly Pane[],
  primitives: PrimitiveRegistry,
  space: Readonly<Record<Side, number>>,
  plotWidth: number,
  env: (entry: AttachedPrimitive, width: number, height: number) => PrimitiveEnv,
): void {
  if (space.left === 0 && space.right === 0) return;
  for (const pane of panes) {
    if (pane.height <= 0 || pane.collapsed) continue;
    for (const side of ['left', 'right'] as const) {
      let offset = 0;
      for (const { entry, width } of paneLanes(primitives, pane, side)) {
        // A lane wider than laid out (changed since the last full redraw) is clipped to the space.
        const shown = Math.min(width, space[side] - offset);
        const x = side === 'right' ? plotWidth + offset : -offset - shown;
        offset += width;
        if (shown <= 0 || !entry.primitive.drawLane) continue;
        ctx.save();
        ctx.translate(x, pane.top);
        ctx.beginPath();
        ctx.rect(0, 0, shown, pane.height);
        ctx.clip();
        primitives.guard.call(entry.primitive, 'drawLane', () => entry.primitive.drawLane!(ctx, env(entry, shown, pane.height)), undefined);
        ctx.restore();
      }
    }
  }
}
