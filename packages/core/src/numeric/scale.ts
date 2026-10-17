import { priceTicks, type PriceTicks } from '../util/format';
import type { PriceFormatModel } from '../util/price-format';

/** Smallest span the scale zooms in to, relative to the size of its values: keeps float64 maths meaningful. */
const MIN_RELATIVE_SPAN = 1e-9;
/** Widest view `zoom` goes to, in multiples of the data's span. */
const MAX_ZOOM_OUT = 10;
/** Part of the view (a fraction of its span) that `keepInView` keeps on the data. */
const KEEP_IN_VIEW = 0.2;
/** Largest finite half range: a span up to twice this still fits in a float. */
const HALF_MAX = Number.MAX_VALUE / 2;

/**
 * A linear horizontal scale over numbers (prices, maturities, strikes), for
 * `NumericChart`. Unlike `TimeScale`, positions are not bar indices: `x` maps
 * straight to pixels, so gaps between items keep their true width.
 *
 * Pixels are plot-relative css px, 0 at the plot's left edge. With `invert`,
 * larger values sit further left.
 */
export class NumericScale {
  /** Plot width, css px. */
  width = 0;
  /** Value at the left edge (right edge when inverted). */
  min = 0;
  /** Value at the right edge (left edge when inverted). */
  max = 1;
  invert = false;

  constructor(options: { invert?: boolean } = {}) {
    this.invert = options.invert ?? false;
  }

  /** Visible span in x units. */
  get span(): number {
    return this.max - this.min;
  }

  /** Plot-relative css px of `x`. */
  toPixel(x: number): number {
    const t = (x - this.min) / (this.max - this.min);
    return (this.invert ? 1 - t : t) * this.width;
  }

  /** The value at plot-relative css px `px`. */
  fromPixel(px: number): number {
    const t = this.width > 0 ? px / this.width : 0;
    return this.min + (this.invert ? 1 - t : t) * (this.max - this.min);
  }

  /** Affine coefficients so that px = x * scale + offset. */
  transform(): [scale: number, offset: number] {
    const scale = ((this.invert ? -1 : 1) * this.width) / (this.max - this.min);
    return [scale, (this.invert ? this.width : 0) - this.min * scale];
  }

  /** Show `lo` to `hi` exactly. Ignored unless both and the span between them are finite and `hi > lo`. */
  setRange(lo: number, hi: number): void {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo) || !Number.isFinite(hi - lo)) return;
    this.min = lo;
    this.max = hi;
  }

  /**
   * Fit `lo` to `hi` with `margin` (a fraction of the plot width) kept free on
   * both sides. A single value gets a small span around it.
   */
  fit(lo: number, hi: number, margin = 0): void {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return;
    // Work in halves, so values near the float range neither overflow nor lose the fit.
    let mid = lo / 2 + hi / 2;
    let half = hi / 2 - lo / 2;
    if (half <= Math.abs(mid) * 1e-12) half = Math.abs(mid) * 0.01 || 1;
    const m = Math.min(Math.max(margin, 0), 0.45);
    half = Math.min(half / (1 - 2 * m), HALF_MAX);
    mid = Math.min(Math.max(mid, -HALF_MAX + half), HALF_MAX - half);
    this.setRange(mid - half, mid + half);
  }

  /**
   * Scale the visible span by `factor` (above 1 zooms out) around the value
   * at `anchorPx`, which stays at the same pixel. With `extent` (the data's
   * x range), the view gets no wider than ten times the data.
   */
  zoom(factor: number, anchorPx = this.width / 2, extent: readonly [number, number] | null = null): void {
    if (!(factor > 0) || !Number.isFinite(factor) || !Number.isFinite(anchorPx)) return;
    const anchor = this.fromPixel(anchorPx);
    const floor = Math.max(Math.abs(anchor), Math.abs(this.min), Math.abs(this.max), 1e-300) * MIN_RELATIVE_SPAN;
    let next = Math.max((this.max - this.min) * factor, floor);
    const dataSpan = extent ? extent[1] - extent[0] : 0;
    if (dataSpan > 0) next = Math.min(next, Math.max(dataSpan * MAX_ZOOM_OUT, this.max - this.min));
    const k = next / (this.max - this.min);
    this.setRange(anchor - (anchor - this.min) * k, anchor + (this.max - anchor) * k);
  }

  /**
   * Slide the view back so it keeps some of `extent` (the data's x range) in
   * view: a fifth of the view, or all of the data when that is narrower. The
   * user can then never pan or zoom the data entirely off screen.
   */
  keepInView(extent: readonly [number, number] | null): void {
    if (!extent) return;
    const [lo, hi] = extent;
    const need = Math.min((this.max - this.min) * KEEP_IN_VIEW, hi - lo);
    let shift = 0;
    if (this.max < lo + need) shift = lo + need - this.max;
    else if (this.min > hi - need) shift = hi - need - this.min;
    if (shift !== 0 && Number.isFinite(shift)) this.setRange(this.min + shift, this.max + shift);
  }

  /** Move the view by `dx` css px; positive drags the content right, as a pointer drag does. */
  pan(dx: number): void {
    if (!(this.width > 0) || !Number.isFinite(dx)) return;
    const delta = ((this.invert ? dx : -dx) / this.width) * (this.max - this.min);
    this.min += delta;
    this.max += delta;
  }

  /**
   * Round label values at least `minSpacingPx` apart. With `format`, steps are
   * widened to land on its ticks, as the value axis does.
   */
  ticks(minSpacingPx = 80, format?: PriceFormatModel): PriceTicks {
    const align = format ? (step: number) => Math.max(step, format.axisStep(step, (this.min + this.max) / 2)) : undefined;
    return priceTicks(this.min, this.max, this.width, minSpacingPx, align);
  }
}
