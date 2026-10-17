import { ChartError } from './errors';
import type { Pane } from './pane';
import { RangeBuilder } from './scales';
import type { Series } from './series';
import type { ChartTheme } from './theme';
import type { Point, Time } from './types';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Where plot drawing happens relative to the series. */
export type PrimitiveLayer = 'below' | 'normal' | 'top';

/** Mapping and context for one drawing area. Sizes in css px, area-local. */
export interface PrimitiveEnv {
  width: number;
  height: number;
  pixelRatio: number;
  theme: ChartTheme;
  /** Visible logical index range (fractional). */
  from: number;
  to: number;
  barSpacing: number;
  /** Bar times of the main series; index `i` is bar `i`. */
  times: readonly Time[];
  indexToX(index: number): number;
  xToIndex(x: number): number;
  /** Times between bars are interpolated, times past the data extrapolated. */
  timeToX(time: Time): number;
  /** The scale of the series the primitive is attached to, or of its pane. */
  priceToY(price: number): number;
  yToPrice(y: number): number;
  formatPrice(price: number): string;
}

/** A label a primitive adds to the price axis. */
export interface PriceAxisLabel {
  price: number;
  text: string;
  color: string;
  /** Defaults to black or white, whichever reads better on `color`. */
  textColor?: string;
}

/** Space a primitive reserves between the plot and a price axis (see `Primitive.lane`). */
export interface PrimitiveLane {
  side: 'left' | 'right';
  /** Width in css px. */
  width: number;
}

/** What a primitive's `hitTest` returns for a point on it: the cursor to show and which part was hit. */
export interface PrimitiveHit {
  /** CSS cursor to show while hovering. */
  cursor?: string;
  /** Which part was hit, for the primitive's own use (e.g. 'line', 'label'). */
  part?: string;
}

/** Handed to `attached`: what the primitive is attached to, and a redraw trigger. */
export interface PrimitiveHost {
  readonly pane: Pane;
  readonly series: Series | null;
  /** Redraw the chart on the next frame. Primitives are not redrawn otherwise. */
  requestRedraw(): void;
  /**
   * Redraw only the overlay layer on the next frame: cheaper, and enough when
   * just the drawing of the 'normal' or 'top' layer, the axes or a lane
   * changed, not the price range or the lane width.
   */
  requestOverlayRedraw(): void;
}

/**
 * Plugin that draws on the chart. Every member is optional. Attach with
 * `chart.attachPrimitive`.
 */
export interface Primitive {
  /** Plot layer (default 'normal'): under the series, with them, or above drawings. */
  layer?: PrimitiveLayer;
  attached?(host: PrimitiveHost): void;
  detached?(): void;
  /** Draw in the pane's plot area (clipped to it). */
  drawPlot?(ctx: CanvasRenderingContext2D, env: PrimitiveEnv): void;
  /** Draw in the pane's price-axis area; `env.width` is the axis width. */
  drawPriceAxis?(ctx: CanvasRenderingContext2D, env: PrimitiveEnv): void;
  /** Draw in the time-axis area; `env.height` is the axis height. */
  drawTimeAxis?(ctx: CanvasRenderingContext2D, env: PrimitiveEnv): void;
  /**
   * Reserve a lane of this width between the plot and the price axis on one
   * side; null (or no method) takes no width. The plot narrows to make room,
   * so the axis keeps its place and width. Lanes of one pane and side sit
   * side by side in attach order, the first next to the plot. Read on every
   * full redraw: call `requestRedraw` after the answer changes.
   */
  lane?(): PrimitiveLane | null;
  /** Draw in the reserved lane (clipped to it); `env.width` is the lane width. */
  drawLane?(ctx: CanvasRenderingContext2D, env: PrimitiveEnv): void;
  /** Labels drawn on the price axis like last-value labels. */
  priceAxisLabels?(env: PrimitiveEnv): PriceAxisLabel[];
  /** Price span to keep in view over visible indices [from, to]. */
  priceRange?(from: number, to: number): [number, number] | null;
  /** Hit test a plot-local point (pane-local css px). */
  hitTest?(p: Point, env: PrimitiveEnv): PrimitiveHit | null;
}

export interface AttachedPrimitive {
  primitive: Primitive;
  pane: Pane;
  series: Series | null;
}

/** Where `chart.attachPrimitive` puts a primitive. */
export interface PrimitiveTarget {
  series?: Series;
  pane?: number | Pane;
}

/**
 * The pane a primitive attaches to: its series' pane, else the given pane
 * (an index into `panes` or a pane object), else the main pane when no target
 * is given at all. Throws when the target is not one of `panes`, rather than
 * silently landing on the main pane and rescaling it, and when the series is
 * no longer in its pane (it was removed).
 */
export function resolvePrimitivePane(panes: readonly Pane[], target: PrimitiveTarget): Pane {
  const { series, pane } = target;
  const resolved = series ? series.pane : pane === undefined ? panes[0] : typeof pane === 'number' ? panes[pane] : pane;
  if (!resolved || !panes.includes(resolved)) {
    throw new Error(
      /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? typeof pane === 'number' && !series
        ? `attachPrimitive: no pane at index ${pane}`
        : 'attachPrimitive: unknown pane' : '',
    );
  }
  if (series && !resolved.series.includes(series)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'attachPrimitive: unknown series' : '');
  return resolved;
}

const LAYERS: readonly PrimitiveLayer[] = ['below', 'normal', 'top'];
/** Scratch builder for `mergeRange`, reused so autoscale makes no RangeBuilder per frame. */
const mergeBuilder = new RangeBuilder();

/**
 * Calls into primitives, so one that throws cannot break the frame or a
 * teardown: the call gives a fallback instead, and the first failure of each
 * primitive is reported as a `ChartError` with code `primitive-failed`.
 */
export class PrimitiveGuard {
  readonly #failed = new WeakSet<object>();

  constructor(private readonly report: (error: ChartError) => void = console.error) {}

  /** `run()`, or `fallback` when it throws. */
  call<T>(primitive: object, member: string, run: () => T, fallback: T): T {
    try {
      return run();
    } catch (error) {
      if (!this.#failed.has(primitive)) {
        this.#failed.add(primitive);
        this.report(new ChartError('primitive-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `A primitive's ${member}() threw` : '', { cause: error, context: { member } }));
      }
      return fallback;
    }
  }

  /** Draw with `ctx` saved first and always restored, so a throw leaves no transform or clip behind. */
  draw(primitive: object, member: string, ctx: CanvasRenderingContext2D, run: () => void): void {
    ctx.save();
    this.call(primitive, member, run, undefined);
    ctx.restore();
  }
}

/** Attached primitives in attach order, with lifecycle and lookups. */
export class PrimitiveRegistry {
  #entries: AttachedPrimitive[] = [];
  #disposed = false;

  constructor(
    private readonly onRedraw: () => void,
    private readonly onOverlayRedraw: () => void = onRedraw,
    /** Guards the calls the registry makes, and the chart's own. */
    readonly guard = new PrimitiveGuard(),
  ) {}

  /** Handed to primitives as `requestRedraw`; a no-op once disposed. */
  readonly #redraw = (): void => {
    if (!this.#disposed) this.onRedraw();
  };

  /** Handed to primitives as `requestOverlayRedraw`; a no-op once disposed. */
  readonly #overlayRedraw = (): void => {
    if (!this.#disposed) this.onOverlayRedraw();
  };

  get all(): readonly AttachedPrimitive[] {
    return this.#entries;
  }

  attach(primitive: Primitive, pane: Pane, series: Series | null): () => void {
    if (this.#entries.some((e) => e.primitive === primitive)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Primitive is already attached' : '');
    const entry: AttachedPrimitive = { primitive, pane, series };
    this.#entries.push(entry);
    try {
      // `pane` reads through, so it stays current when the series moves pane.
      primitive.attached?.({
        get pane() {
          return entry.pane;
        },
        series,
        requestRedraw: this.#redraw,
        requestOverlayRedraw: this.#overlayRedraw,
      });
    } catch (err) {
      // Not attached after all: drop the entry without calling `detached`.
      this.#entries = this.#entries.filter((e) => e !== entry);
      throw err;
    }
    this.#redraw();
    // Removes only this attachment, so a stale handle cannot detach a later one.
    return () => this.detachWhere((e) => e === entry);
  }

  detach(primitive: Primitive): void {
    this.detachWhere((e) => e.primitive === primitive);
  }

  /** Move the primitives attached to `series` into the series' current pane. */
  followSeries(series: Series): void {
    for (const e of this.#entries) if (e.series === series) e.pane = series.pane;
    this.#redraw();
  }

  /** Detach every primitive matching `test` (e.g. those of a removed series). */
  detachWhere(test: (e: AttachedPrimitive) => boolean): void {
    const gone = this.#entries.filter(test);
    if (gone.length === 0) return;
    this.#entries = this.#entries.filter((e) => !test(e));
    // A throwing `detached` must not keep the others attached or stop a teardown.
    for (const e of gone) this.guard.call(e.primitive, 'detached', () => e.primitive.detached?.(), undefined);
    this.#redraw();
  }

  /**
   * Detach every primitive for good (the chart is being destroyed). Later
   * `requestRedraw` calls, e.g. from a primitive's leftover timer, do nothing.
   */
  dispose(): void {
    this.#disposed = true;
    this.detachWhere(() => true);
  }

  /** Primitives of `pane` drawing on `layer`, in attach order. */
  layer(pane: Pane, layer: PrimitiveLayer): AttachedPrimitive[] {
    return this.#entries.filter((e) => e.pane === pane && (e.primitive.layer ?? 'normal') === layer);
  }

  /** Primitives of `pane` from the top layer down, latest first: the hit-test order. */
  topDown(pane: Pane): AttachedPrimitive[] {
    return [...LAYERS].reverse().flatMap((layer) => this.layer(pane, layer).reverse());
  }

  /**
   * Topmost primitive of `pane` reporting a hit at pane-local point `p`.
   * Primitives on hidden series are skipped, as they are when drawing.
   */
  hitTest(
    pane: Pane,
    p: Point,
    env: (e: AttachedPrimitive) => PrimitiveEnv,
  ): { primitive: Primitive; hit: PrimitiveHit } | null {
    for (const e of this.topDown(pane)) {
      if (!e.primitive.hitTest || (e.series && !e.series.visible)) continue;
      const hit = this.guard.call(e.primitive, 'hitTest', () => e.primitive.hitTest!(p, env(e)), null);
      if (hit) return { primitive: e.primitive, hit };
    }
    return null;
  }

  /**
   * Merge the price ranges of `entries` into `range` (null = nothing yet).
   * With `positiveOnly` (log scales) bounds at or below zero are left out.
   * Returns the merged range.
   */
  mergeRange(
    entries: readonly AttachedPrimitive[],
    from: number,
    to: number,
    range: [number, number] | null,
    positiveOnly = false,
  ): [number, number] | null {
    const out = mergeBuilder.reset(positiveOnly);
    if (range) {
      out.add(range[0]);
      out.add(range[1]);
    }
    for (const e of entries) {
      const r = this.guard.call(e.primitive, 'priceRange', () => e.primitive.priceRange?.(from, to), null);
      if (!r || !(r[0] <= r[1])) continue;
      out.add(r[0]);
      out.add(r[1]);
    }
    return out.range;
  }
}

/**
 * Coordinate of a line `lineWidth` css px wide that lands on whole device
 * pixels at `pixelRatio`, so it renders sharp instead of blurred.
 */
export function crisp(value: number, lineWidth = 1, pixelRatio = 1): number {
  const device = Math.max(1, Math.round(lineWidth * pixelRatio));
  const offset = device % 2 === 1 ? 0.5 : 0;
  return (Math.round(value * pixelRatio - offset) + offset) / pixelRatio;
}

/** Stroke a horizontal or vertical line snapped to device pixels. */
export function crispLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lineWidth: number,
  pixelRatio: number,
): void {
  const width = Math.max(1, Math.round(lineWidth * pixelRatio)) / pixelRatio;
  const vertical = x0 === x1;
  const horizontal = y0 === y1;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(vertical ? crisp(x0, lineWidth, pixelRatio) : x0, horizontal ? crisp(y0, lineWidth, pixelRatio) : y0);
  ctx.lineTo(vertical ? crisp(x1, lineWidth, pixelRatio) : x1, horizontal ? crisp(y1, lineWidth, pixelRatio) : y1);
  ctx.stroke();
}
