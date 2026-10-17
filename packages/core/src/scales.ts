import type { IndexRange } from './types';
import { lowerBound, type Timeline } from './timeline';
import { TickWeight } from './util/format';
import { clampLow, clampNum } from './util/math';
import { isNumber } from './util/records';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Where the view may go; the chart keeps these in step with its options. */
export interface TimeScaleLimits {
  minBarSpacing: number;
  maxBarSpacing: number;
  /** Empty bars between the last bar and the right edge, as configured. */
  rightOffset: number;
  /** The plot's left edge cannot go before the first bar. Default `false`. */
  fixLeftEdge?: boolean;
  /** The view cannot go past the last bar plus `rightOffset`. Default `false`. */
  fixRightEdge?: boolean;
  /** Most empty bars allowed right of the last bar; unset for no limit. */
  maxRightOffset?: number;
  /** Share of the plot width (0 to 1) bars keep covering when panning towards either end. Default `0.5`. */
  minBarCoverage?: number;
  /**
   * The chart groups bars when zoomed out (`grouping`), so zooming may go
   * below `minBarSpacing`, down to half the spacing that fits every bar.
   */
  grouped?: boolean;
}

/** Settings a `TimeScale` starts with: its view limits plus the initial bar spacing. */
export interface TimeScaleOptions extends TimeScaleLimits {
  barSpacing: number;
}

/** Index rounding slack in `visibleRange`. */
const INDEX_EPSILON = 1e-6;
/** With `fixLeftEdge` the left edge stops half a bar before the first bar's center, so it shows whole. */
const LEFT_EDGE = -0.5;

/**
 * Horizontal logical-index scale shared by all panes.
 * x(i) = width - (rightEdge - i) * barSpacing, where rightEdge = lastIndex + rightOffset.
 */
export class TimeScale {
  width = 0;
  barCount = 0;
  barSpacing: number;
  rightOffset: number;
  minBarSpacing!: number;
  maxBarSpacing!: number;
  /** The configured right offset: the right limit under `fixRightEdge`. */
  defaultRightOffset!: number;
  fixLeftEdge!: boolean;
  fixRightEdge!: boolean;
  maxRightOffset!: number | undefined;
  minBarCoverage!: number;
  grouped!: boolean;
  /**
   * Viewport bounds as bar indices: the plot edges stay within half a bar of
   * `from` and `to` (either may be infinite). Null when unbounded.
   */
  bounds: { from: number; to: number } | null = null;
  /**
   * Direct pans and zooms so far, to tell the user moving the view from
   * clamping, resizing or an eased transition, which do not count.
   */
  moves = 0;
  /** Last non-zero width: a resize locked to the visible range scales from it, so hiding the plot keeps the lock. */
  #lockWidth = 0;
  #animation: {
    elapsed: number;
    duration: number;
    fromSpacing: number;
    toSpacing: number;
    fromOffset: number;
    toOffset: number;
    /** Right offset steps (bars) the transition moves by, relative to its target; 0 moves freely. */
    quantum: number;
    /** Maps progress from 0 to 1 to eased progress. */
    ease: (t: number) => number;
  } | null = null;

  constructor(options: TimeScaleOptions) {
    this.barSpacing = options.barSpacing;
    this.rightOffset = options.rightOffset;
    this.setLimits(options);
  }

  /** Replace the limits; call `clamp()` afterwards to apply them to the view. Throws on an invalid limit. */
  setLimits(limits: TimeScaleLimits): void {
    checkTimeScaleLimits(limits);
    this.minBarSpacing = limits.minBarSpacing;
    this.maxBarSpacing = limits.maxBarSpacing;
    this.defaultRightOffset = limits.rightOffset;
    this.fixLeftEdge = limits.fixLeftEdge ?? false;
    this.fixRightEdge = limits.fixRightEdge ?? false;
    this.maxRightOffset = limits.maxRightOffset;
    this.minBarCoverage = limits.minBarCoverage ?? 0.5;
    this.grouped = limits.grouped ?? false;
  }

  /**
   * Narrowest bar spacing zooming reaches: `minBarSpacing`, or while bars are
   * grouped, low enough to fit every bar twice over.
   */
  get floorSpacing(): number {
    if (!this.grouped || this.barCount === 0 || this.width <= 0) return this.minBarSpacing;
    return Math.min(this.minBarSpacing, this.width / (2 * this.barCount));
  }

  get rightEdge(): number {
    return this.barCount - 1 + this.rightOffset;
  }

  indexToX(index: number): number {
    return this.width - (this.rightEdge - index) * this.barSpacing;
  }

  xToIndex(x: number): number {
    return this.rightEdge - (this.width - x) / this.barSpacing;
  }

  /** Affine coefficients so that x = index * scale + offset. */
  xTransform(): [scale: number, offset: number] {
    return [this.barSpacing, this.width - this.rightEdge * this.barSpacing];
  }

  /** Bars at least partly on screen; one centered on an edge counts, floating-point noise does not add a neighbor. */
  visibleRange(): IndexRange {
    return {
      from: Math.max(0, Math.floor(this.xToIndex(0) + INDEX_EPSILON)),
      to: Math.min(this.barCount - 1, Math.ceil(this.xToIndex(this.width) - INDEX_EPSILON)),
    };
  }

  /**
   * Set the plot width. With `keepRange` the same bars stay on screen: the bar
   * spacing scales with the width (within its limits) and the right edge stays.
   */
  setWidth(width: number, keepRange = false): void {
    if (this.width > 0) this.#lockWidth = this.width;
    const ratio = width / this.#lockWidth;
    this.width = width;
    if (!keepRange || !(ratio > 0) || !Number.isFinite(ratio) || ratio === 1) return;
    this.barSpacing = clampNum(this.barSpacing * ratio, this.floorSpacing, this.maxBarSpacing);
    // A running transition ends on the same bars too.
    const a = this.#animation;
    if (a) {
      a.fromSpacing += Math.log(ratio);
      a.toSpacing = Math.log(clampNum(Math.exp(a.toSpacing) * ratio, this.floorSpacing, this.maxBarSpacing));
    }
  }

  /** Positive dx drags content right (towards older bars). False when an edge stopped it. */
  pan(dx: number): boolean {
    const before = this.rightOffset;
    this.moves++;
    this.rightOffset -= dx / this.barSpacing;
    this.clamp();
    return this.rightOffset !== before;
  }

  /** Zoom keeping the bar under `anchorX` fixed on screen, unless that would cross a fixed edge. */
  zoom(factor: number, anchorX: number): void {
    const anchorIndex = this.xToIndex(anchorX);
    this.moves++;
    this.barSpacing = clampNum(this.barSpacing * factor, this.minSpacing(), this.maxBarSpacing);
    const rightEdge = anchorIndex + (this.width - anchorX) / this.barSpacing;
    this.rightOffset = rightEdge - (this.barCount - 1);
    this.clamp();
  }

  setBarSpacing(spacing: number, anchorX = this.width): void {
    this.zoom(spacing / this.barSpacing, anchorX);
  }

  /**
   * Ease to a bar spacing / right offset, clamped to the limits. Spacing
   * interpolates in log space so zooming feels uniform; any direct pan/zoom
   * should `cancelAnimation()` first. A `quantum` (in bars, e.g. one device
   * pixel) makes the right offset move in whole steps towards its target, so
   * a slow pan shifts every bar by the same pixel at once. `ease` maps
   * progress (default: cubic ease-out).
   */
  animateTo(
    target: { barSpacing?: number; rightOffset?: number },
    durationMs = 450,
    quantum = 0,
    ease: (t: number) => number = easeOutCubic,
  ): void {
    const [toSpacing, toOffset] = this.#clamped(target.barSpacing ?? this.barSpacing, target.rightOffset ?? this.rightOffset);
    if (durationMs <= 0) {
      this.barSpacing = toSpacing;
      this.rightOffset = toOffset;
      this.#animation = null;
      return;
    }
    this.#animation = {
      elapsed: 0,
      duration: durationMs,
      fromSpacing: Math.log(this.barSpacing),
      toSpacing: Math.log(toSpacing),
      fromOffset: this.rightOffset,
      toOffset,
      quantum,
      ease,
    };
  }

  get animating(): boolean {
    return this.#animation !== null;
  }

  /** Where the view ends up: the eased transition's target, or the current view. */
  target(): { barSpacing: number; rightOffset: number } {
    const a = this.#animation;
    return a ? { barSpacing: Math.exp(a.toSpacing), rightOffset: a.toOffset } : { barSpacing: this.barSpacing, rightOffset: this.rightOffset };
  }

  cancelAnimation(): void {
    this.#animation = null;
  }

  /** Advance the eased transition by dt ms; true while still running. */
  step(dt: number): boolean {
    const a = this.#animation;
    if (!a) return false;
    a.elapsed += dt;
    const t = Math.min(1, a.elapsed / a.duration);
    const e = a.ease(t);
    this.barSpacing = Math.exp(a.fromSpacing + (a.toSpacing - a.fromSpacing) * e);
    const offset = a.fromOffset + (a.toOffset - a.fromOffset) * e;
    this.rightOffset = a.quantum > 0 ? a.toOffset + Math.round((offset - a.toOffset) / a.quantum) * a.quantum : offset;
    this.clamp();
    if (t >= 1) this.#animation = null;
    return this.#animation !== null;
  }

  /** Most empty bars the limits allow right of the last bar. */
  maxOffset(): number {
    const fixed = this.fixRightEdge ? this.defaultRightOffset : Infinity;
    return Math.min(fixed, this.maxRightOffset ?? Infinity);
  }

  /**
   * Smallest bar spacing: `minBarSpacing`, raised when both ends are bounded
   * (left edge fixed, right limited) so zooming out stops once every bar fits.
   * When too few bars fill the plot even at `maxBarSpacing`, the left edge
   * wins and zoom keeps its full range.
   */
  minSpacing(): number {
    const window = this.#boundsWindow();
    if (window !== null) {
      // Zooming out stops once the bounded window fills the plot.
      const fit = window > 0 ? this.width / window : Infinity;
      return clampNum(fit, this.floorSpacing, this.maxBarSpacing);
    }
    const floor = this.floorSpacing;
    const maxOffset = this.maxOffset();
    if (!this.fixLeftEdge || maxOffset === Infinity || this.barCount === 0 || this.width <= 0) return floor;
    const span = this.barCount - 1 + maxOffset - LEFT_EDGE;
    const fit = span > 0 ? this.width / span : Infinity;
    return fit > this.maxBarSpacing ? floor : Math.max(fit, floor);
  }

  /** Width in bars of a time window bounded on both sides, or null. */
  #boundsWindow(): number | null {
    const b = this.bounds;
    if (!b || !Number.isFinite(b.from) || !Number.isFinite(b.to) || this.width <= 0) return null;
    return b.to - b.from + 1;
  }

  /**
   * Apply the limits: bar spacing within its range, bars over at least
   * `minBarCoverage` of the plot, and the fixed edges and `maxRightOffset`. When too few bars
   * fill the plot for both edges, the left edge wins.
   */
  clamp(): void {
    if (this.barCount === 0 || this.width <= 0) return;
    this.barSpacing = clampNum(this.barSpacing, this.minSpacing(), this.maxBarSpacing);
    const visibleBars = this.width / this.barSpacing;
    const lastIndex = this.barCount - 1;
    const keep = Math.min(this.minBarCoverage * visibleBars, lastIndex);
    let minEdge = keep;
    let maxEdge = lastIndex - keep + visibleBars;
    if (this.fixLeftEdge) minEdge = Math.max(minEdge, visibleBars + LEFT_EDGE);
    maxEdge = Math.min(maxEdge, lastIndex + this.maxOffset());
    const b = this.bounds;
    if (b) {
      // The bounds win over the other limits: they define the window outright.
      minEdge = Math.max(b.from === -Infinity ? minEdge : -Infinity, b.from + LEFT_EDGE + visibleBars);
      maxEdge = Math.min(b.to === Infinity ? maxEdge : Infinity, b.to - LEFT_EDGE);
    }
    const edge = clampNum(this.rightEdge, minEdge, Math.max(minEdge, maxEdge));
    this.rightOffset = edge - lastIndex;
  }

  /** The view `clamp` makes of this spacing and offset, leaving the current one as it is. */
  #clamped(spacing: number, offset: number): [spacing: number, offset: number] {
    const { barSpacing, rightOffset } = this;
    this.barSpacing = clampNum(spacing, this.floorSpacing, this.maxBarSpacing);
    this.rightOffset = offset;
    this.clamp();
    const out: [number, number] = [this.barSpacing, this.rightOffset];
    this.barSpacing = barSpacing;
    this.rightOffset = rightOffset;
    return out;
  }
}

/**
 * Throw when a limit is not a finite, non-negative number, or `minBarCoverage`
 * is above 1 (bars cannot cover more than the plot). `rightOffset` only has to
 * be finite: a negative one is a view that ends before the newest bar.
 */
function checkTimeScaleLimits(limits: TimeScaleLimits): void {
  if (!Number.isFinite(limits.rightOffset)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Time scale rightOffset must be a finite number' : '');
  for (const key of ['minBarSpacing', 'maxBarSpacing', 'maxRightOffset', 'minBarCoverage'] as const) {
    const v = limits[key];
    if (v === undefined && key !== 'minBarSpacing' && key !== 'maxBarSpacing') continue;
    if (!(isNumber(v) && v >= 0 && (key !== 'minBarCoverage' || v <= 1))) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Time scale ${key} must be a finite, non-negative number${key === 'minBarCoverage' ? ' up to 1' : ''}` : '');
    }
  }
}

/** The options a `PriceScale` is created with. */
export interface PriceScaleOptions {
  /**
   * Fraction of pane height left empty above/below the data. A side left out
   * or null is sized by the chart each frame (`autoMargins`).
   */
  marginTop?: number | null;
  marginBottom?: number | null;
  /** Scale id within its pane (default `'right'`). */
  id?: string;
  /** Where its axis shows; `'none'` overlays the pane without an axis. */
  side?: PriceScaleSide;
}

/** Axis side of a price scale; `'none'` is an overlay scale with no visible axis. */
export type PriceScaleSide = 'left' | 'right' | 'none';

/**
 * `normal`: linear in price. `log`: linear in log10(price).
 * `percent`: linear in price, labelled as % change from `percentBase`.
 * `indexed`: linear in price, labelled as `price / percentBase × 100`.
 */
export type PriceScaleMode = 'normal' | 'log' | 'percent' | 'indexed';

/**
 * What percent and indexed modes measure from: the first visible value, the
 * open of the trading day holding the newest visible bar, the close before
 * that day, or the close of the first bar at or after a time.
 */
export type PercentBase = 'firstVisible' | 'sessionOpen' | 'previousClose' | { time: number };

/** A copy of `base`, so callers cannot change a scale's setting through it. */
export function copyPercentBase(base: PercentBase): PercentBase {
  return typeof base === 'object' ? { time: base.time } : base;
}

/**
 * The bar a percent base is read from, for visible bars `from`..`to` (logical
 * indices), and whether to read its open or its close. Trading days follow the
 * timeline's day boundaries, so its timezone and session schedule apply.
 */
export function percentBaseBar(
  base: PercentBase,
  timeline: Pick<Timeline, 'times' | 'weights'>,
  from: number,
  to: number,
): { index: number; field: 'open' | 'close' } {
  const last = timeline.times.length - 1;
  if (base === 'firstVisible' || last < 0) return { index: from, field: 'close' };
  if (typeof base === 'object') {
    const i = lowerBound(timeline.times, base.time);
    return { index: Math.min(i, last), field: 'close' };
  }
  let start = clampLow(Math.floor(to), 0, last);
  while (start > 0 && timeline.weights[start]! < TickWeight.Day) start--;
  if (base === 'previousClose' && start > 0) return { index: start - 1, field: 'close' };
  return { index: start, field: 'open' };
}

/** Whether `v` is a valid `PercentBase`. */
export function isPercentBase(v: unknown): v is PercentBase {
  if (v === 'firstVisible' || v === 'sessionOpen' || v === 'previousClose') return true;
  return typeof v === 'object' && v !== null && Number.isFinite((v as { time?: unknown }).time);
}

/**
 * How a scale adjusts the range it fits to the data, before margins. Prices in
 * every mode, like `fixedRange`. Applied in this order: `include`, `minSpan`,
 * `centerOn`. Only while there is visible data to fit.
 */
export interface AutoscaleRule {
  /** Keep this price in the middle, e.g. 0 for an oscillator around zero. Log scales center on a ratio, and skip values at or below zero. */
  centerOn?: number;
  /** Prices the range always reaches, e.g. a target level. Log scales skip values at or below zero. */
  include?: number[];
  /** Smallest price span to fit, so flat data does not zoom into noise. The range widens around its middle. */
  minSpan?: number;
}

/** Whether `rule` is a valid `AutoscaleRule`; the reason why not, else null. */
export function autoscaleRuleError(rule: unknown): string | null {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return 'must be an object';
  const r = rule as Record<string, unknown>;
  for (const key of Object.keys(r)) if (key !== 'centerOn' && key !== 'include' && key !== 'minSpan') return `has unknown field "${key}"`;
  if (r.centerOn !== undefined && !Number.isFinite(r.centerOn)) return 'centerOn must be a finite number';
  if (r.minSpan !== undefined && !(Number.isFinite(r.minSpan) && (r.minSpan as number) > 0)) return 'minSpan must be a positive number';
  if (r.include !== undefined && !(Array.isArray(r.include) && r.include.every((v) => Number.isFinite(v)))) {
    return 'include must be an array of finite numbers';
  }
  return null;
}

/** Autoscale easing time constant (ms). */
const SCALE_EASE_MS = 55;
/**
 * Smallest price the log scale maps. Lower values are drawn at this floor,
 * far below any fitted range, so they are clipped at the pane's bottom edge.
 */
const LOG_FLOOR = 1e-12;

/**
 * Running min/max of prices for autoscale. With `positiveOnly` (log scales),
 * values at or below zero are skipped: a log scale cannot show them, and
 * fitting them would stretch the range down to the log floor. Owners keep one
 * and `reset` it per call, so autoscale makes no RangeBuilder per frame.
 */
export class RangeBuilder {
  lo = Infinity;
  hi = -Infinity;

  constructor(public positiveOnly = false) {}

  /** Start over, for a scale that is (`positiveOnly`) or is not log. */
  reset(positiveOnly: boolean): this {
    this.positiveOnly = positiveOnly;
    this.lo = Infinity;
    this.hi = -Infinity;
    return this;
  }

  add(value: number): void {
    if (this.positiveOnly && !(value > 0)) return;
    if (value < this.lo) this.lo = value;
    if (value > this.hi) this.hi = value;
  }

  /** The range so far, or null when nothing was added. */
  get range(): [number, number] | null {
    return this.lo <= this.hi ? [this.lo, this.hi] : null;
  }
}

/**
 * Vertical scale. `min`/`max` live in *coordinate* space: price for
 * normal/percent, log10(price) for log. Use `minPrice`/`maxPrice` for prices.
 */
export class PriceScale {
  height = 0;
  min = 0;
  max = 1;
  autoScale = true;
  /** Fractions of the height left empty above/below the data; null for a side the chart sizes. */
  marginTop: number | null;
  marginBottom: number | null;
  /** The margins (top, bottom) the chart sizes each frame, used for the null sides. */
  autoMargins: [top: number, bottom: number] = [0, 0];
  mode: PriceScaleMode = 'normal';
  /** Higher prices lower down. */
  invert = false;
  readonly id: string;
  side: PriceScaleSide;
  /** Reference price for percent and indexed modes, resolved each frame from `percentFrom`. */
  percentBase = 1;
  /** Where `percentBase` comes from (the `percentBase` setting); a linked scale follows its root's. */
  percentFrom: PercentBase = 'firstVisible';
  /**
   * Scale this one follows (e.g. a compared symbol's scale linked to the main
   * one): it takes the same mode, and in percent and indexed modes both fit
   * one shared percent range, so their lines compare directly.
   */
  link: PriceScale | null = null;
  /** Ease autoscale changes instead of jumping (set by the chart). */
  smooth = false;
  /**
   * Log mode with visible data but none of it above zero (set by the chart).
   * Autoscale then keeps the last range.
   */
  noPositiveData = false;
  /** Prices the visible range must stay within (viewport bounds); either end may be missing. */
  bounds: { low?: number; high?: number } | null = null;
  /** While autoscale is on, show exactly this price range instead of fitting the data. */
  fixedRange: { min: number; max: number } | null = null;
  /** Adjustments to the fitted data range; see `AutoscaleRule`. */
  autoscaleRule: AutoscaleRule | null = null;
  /**
   * Coordinate units per bar width while the price-to-bar ratio is locked
   * (`NaN`: lock at the current ratio on the next `applyBarRatio`); null when unlocked.
   */
  barRatio: number | null = null;
  #targetMin = 0;
  #targetMax = 1;
  #fitted = false;
  /** A range `setRange` eases towards in manual mode. */
  #manualTarget: [number, number] | null = null;

  constructor(options: PriceScaleOptions) {
    this.marginTop = options.marginTop ?? null;
    this.marginBottom = options.marginBottom ?? null;
    this.id = options.id ?? 'right';
    this.side = options.side ?? 'right';
  }

  get isLog(): boolean {
    return this.mode === 'log';
  }

  /** Price → coordinate space. */
  toCoord(price: number): number {
    return this.mode === 'log' ? Math.log10(Math.max(price, LOG_FLOOR)) : price;
  }

  /** Coordinate space → price. */
  fromCoord(coord: number): number {
    return this.mode === 'log' ? 10 ** coord : coord;
  }

  get minPrice(): number {
    return this.fromCoord(this.min);
  }

  get maxPrice(): number {
    return this.fromCoord(this.max);
  }

  setMode(mode: PriceScaleMode): void {
    if (mode === this.mode) return;
    this.#manualTarget = null;
    // A locked ratio is in coordinate units, which the mode changes.
    if (this.barRatio !== null) this.barRatio = NaN;
    const lo = this.minPrice;
    const hi = this.maxPrice;
    this.mode = mode;
    this.#fitted = false;
    if (mode === 'log' && !(hi > 0)) {
      // Nothing positive to keep: show prices 1 to 10 until data above zero arrives.
      this.min = 0;
      this.max = 1;
      return;
    }
    // Re-express the current window in the new coordinate space; next fit snaps.
    this.min = this.toCoord(mode === 'log' ? Math.max(lo, hi * 1e-6) : lo);
    this.max = this.toCoord(hi);
  }

  priceToY(price: number): number {
    const f = (this.toCoord(price) - this.min) / (this.max - this.min);
    return this.height * (this.invert ? f : 1 - f);
  }

  yToPrice(y: number): number {
    return this.fromCoord(this.#coordAtY(y));
  }

  /** Coordinate-space value at pane-local `y`. */
  #coordAtY(y: number): number {
    const f = this.invert ? y / this.height : 1 - y / this.height;
    return this.min + f * (this.max - this.min);
  }

  /** Affine coefficients so that y = coord(price) * scale + offset. */
  yTransform(): [scale: number, offset: number] {
    const scale = ((this.invert ? 1 : -1) * this.height) / (this.max - this.min);
    return [scale, (this.invert ? 0 : this.height) - this.min * scale];
  }

  /** Percent change of `price` against `percentBase`. */
  toPercent(price: number): number {
    return this.percentBase !== 0 ? ((price - this.percentBase) / Math.abs(this.percentBase)) * 100 : 0;
  }

  fromPercent(pct: number): number {
    return this.percentBase + (pct / 100) * Math.abs(this.percentBase);
  }

  /** `price` indexed to 100 at `percentBase`. */
  toIndexed(price: number): number {
    return this.percentBase !== 0 ? (price / this.percentBase) * 100 : 0;
  }

  fromIndexed(value: number): number {
    return (value / 100) * this.percentBase;
  }

  /**
   * Fit [lo, hi] (prices) including margins; no-op in manual mode. In log mode
   * bounds at or below zero cannot be shown: a non-positive `hi` keeps the
   * current range, and a non-positive `lo` fits around `hi` alone.
   */
  fit(lo: number, hi: number): void {
    if (!this.autoScale) return;
    // A fixed range reaching zero or below is ignored in log mode (and used again after it).
    if (this.fixedRange && !(this.isLog && !(this.fixedRange.min > 0))) {
      // Exact and steady: no margins, no easing.
      this.#targetMin = this.min = this.toCoord(this.fixedRange.min);
      this.#targetMax = this.max = this.toCoord(this.fixedRange.max);
      this.#fitted = true;
      return;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (this.mode === 'log') {
      if (!(hi > 0)) return;
      if (!(lo > 0)) lo = hi;
    }
    let a = this.toCoord(lo);
    let b = this.toCoord(hi);
    if (b - a <= Math.abs(b) * 1e-12) {
      const pad = this.mode === 'log' ? 0.005 : Math.abs(b) * 0.01 || 1;
      a -= pad;
      b += pad;
    }
    const top = this.marginTop ?? this.autoMargins[0];
    const bottom = this.marginBottom ?? this.autoMargins[1];
    const usable = 1 - top - bottom;
    const span = (b - a) / Math.max(usable, 0.05);
    // Margins are on screen: inverted, the lowest price sits at the top.
    this.target(a - span * (this.invert ? top : bottom), b + span * (this.invert ? bottom : top));
  }

  /**
   * Apply `autoscaleRule` to a price range fitted from the data, in place.
   * Without a rule, or for a fixed range (which wins), `r` is left as it is.
   */
  applyRule(r: [number, number]): void {
    const rule = this.autoscaleRule;
    if (!rule || this.fixedRange) return;
    const log = this.isLog;
    for (const v of rule.include ?? []) {
      if (log && !(v > 0)) continue;
      if (v < r[0]) r[0] = v;
      if (v > r[1]) r[1] = v;
    }
    const span = rule.minSpan;
    if (span !== undefined && r[1] - r[0] < span) {
      const mid = (r[0] + r[1]) / 2;
      // A log scale cannot reach zero: keep the low end there and widen upwards.
      if (log && !(mid - span / 2 > 0)) r[1] = r[0] + span;
      else [r[0], r[1]] = [mid - span / 2, mid + span / 2];
    }
    const c = rule.centerOn;
    if (c === undefined || (log && !(c > 0))) return;
    // Symmetric in coordinates: a price distance, or a ratio on a log scale.
    const cc = this.toCoord(c);
    const d = Math.max(cc - this.toCoord(r[0]), this.toCoord(r[1]) - cc);
    r[0] = this.fromCoord(cc - d);
    r[1] = this.fromCoord(cc + d);
  }

  /** Aim autoscale at a coordinate range: jump there, or ease with `smooth` once fitted. */
  private target(min: number, max: number): void {
    [this.#targetMin, this.#targetMax] = this.inBounds(min, max);
    if (!this.smooth || !this.#fitted) {
      this.min = this.#targetMin;
      this.max = this.#targetMax;
      this.#fitted = true;
    }
  }

  /**
   * The range `min` to `max` (coordinates) moved inside `bounds`: slid in
   * without changing its span, or the whole band when the span is wider.
   */
  inBounds(min: number, max: number): [number, number] {
    const b = this.bounds;
    if (!b) return [min, max];
    const lo = b.low === undefined || (this.isLog && !(b.low > 0)) ? -Infinity : this.toCoord(b.low);
    const hi = b.high === undefined || (this.isLog && !(b.high > 0)) ? Infinity : this.toCoord(b.high);
    if (max - min >= hi - lo) return [lo, hi];
    if (min < lo) return [lo, max + (lo - min)];
    if (max > hi) return [min - (max - hi), hi];
    return [min, max];
  }

  /** Keep the visible range inside `bounds`. */
  keepInBounds(): void {
    [this.min, this.max] = this.inBounds(this.min, this.max);
  }

  /**
   * Show prices `lo` to `hi` exactly and switch to manual mode, easing there
   * with `animate`. A locked price-to-bar ratio is taken again from the new range.
   */
  setRange(lo: number, hi: number, animate = false): void {
    const [a, b] = this.inBounds(this.toCoord(lo), this.toCoord(hi));
    this.autoScale = false;
    if (this.barRatio !== null) {
      animate = false;
      this.barRatio = NaN;
    }
    this.#manualTarget = animate ? [a, b] : null;
    if (!animate) {
      this.min = a;
      this.max = b;
    }
  }

  /** Lock the price-to-bar ratio at `ratio`, or at the current one with `NaN`; null unlocks. */
  lockRatio(ratio: number | null): void {
    this.barRatio = ratio;
    if (ratio !== null) this.autoScale = false;
  }

  /**
   * Show the same percent range as `root` shows, exactly (a linked scale
   * whose root is not fitting the data: manual, fixed or ratio-locked).
   */
  follow(root: PriceScale): void {
    this.#targetMin = this.min = this.fromPercent(root.toPercent(root.min));
    this.#targetMax = this.max = this.fromPercent(root.toPercent(root.max));
    this.#fitted = true;
  }

  /**
   * With a locked ratio, set the span for `barSpacing` around the current
   * centre, so zooming time scales prices too and angles stay put.
   */
  applyBarRatio(barSpacing: number): void {
    if (this.barRatio === null || !(this.height > 0) || !(barSpacing > 0)) return;
    if (Number.isNaN(this.barRatio)) {
      this.barRatio = ((this.max - this.min) / this.height) * barSpacing;
      return;
    }
    const centre = (this.min + this.max) / 2;
    const half = (this.barRatio * this.height) / barSpacing / 2;
    this.min = centre - half;
    this.max = centre + half;
    this.autoScale = false;
    this.#manualTarget = null;
    this.keepInBounds();
  }

  /** Ease towards the last fit target, or a `setRange` target; true while still moving. */
  step(dt: number): boolean {
    // Autoscale back on drops a `setRange` ease.
    if (this.autoScale) this.#manualTarget = null;
    const manual = this.#manualTarget;
    if (!manual && (!this.autoScale || !this.smooth || !this.#fitted)) return false;
    const [toMin, toMax] = manual ?? [this.#targetMin, this.#targetMax];
    const span = Math.abs(toMax - toMin) || 1;
    const eps = span * 2e-4;
    if (Math.abs(toMin - this.min) < eps && Math.abs(toMax - this.max) < eps) {
      this.min = toMin;
      this.max = toMax;
      this.#manualTarget = null;
      return false;
    }
    const k = 1 - Math.exp(-dt / SCALE_EASE_MS);
    this.min += (toMin - this.min) * k;
    this.max += (toMax - this.max) * k;
    return true;
  }

  /** Scale around the price at `anchorY`; switches to manual mode, and a locked ratio follows. */
  zoom(factor: number, anchorY = this.height / 2): void {
    const anchor = this.#coordAtY(anchorY);
    this.min = anchor - (anchor - this.min) * factor;
    this.max = anchor + (this.max - anchor) * factor;
    this.autoScale = false;
    this.keepInBounds();
    this.#manualTarget = null;
    if (this.barRatio !== null) this.barRatio = NaN;
  }

  /** Positive dy drags content down; switches to manual mode. */
  pan(dy: number): void {
    const delta = ((this.invert ? -dy : dy) / this.height) * (this.max - this.min);
    this.min += delta;
    this.max += delta;
    this.autoScale = false;
    this.keepInBounds();
    if (this.#manualTarget) this.#manualTarget = [this.#manualTarget[0] + delta, this.#manualTarget[1] + delta];
  }
}

/**
 * Price ranges that put linked scales on one percent axis: each scale's
 * `[lo, hi]`, measured against its own `percentBase`, widens to the union of
 * the group's percent ranges. Returned in input order.
 */
export function linkedRanges(entries: readonly { scale: PriceScale; range: [number, number] }[]): [number, number][] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { scale, range } of entries) {
    lo = Math.min(lo, scale.toPercent(range[0]));
    hi = Math.max(hi, scale.toPercent(range[1]));
  }
  return entries.map(({ scale }) => [scale.fromPercent(lo), scale.fromPercent(hi)]);
}

/** Cubic ease-out: maps progress `t` from 0 to 1 to an eased value that starts fast and slows into 1. Used by view animations. */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
