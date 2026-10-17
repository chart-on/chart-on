import type { Rgba } from '../util/color';
import { Slots } from './slots';

/** Rect width mode, interpreted by the vertex shader. */
export const RectKind = {
  /** Candle body: barSpacing × bodyRatio. */
  Body: 0,
  /** Candle wick: 1 device pixel (or floor(dpr)). */
  Wick: 1,
  /** Histogram column: barSpacing × columnRatio. */
  Column: 2,
  /** OHLC open tick: left of the wick at p0, one wick thick. */
  TickLeft: 3,
  /** OHLC close tick: right of the wick at p0. */
  TickRight: 4,
  /** Candle body drawn as an outline (hollow candles). */
  HollowBody: 5,
} as const;

/** Bytes per instance: index, p0, p1, kind, weight (f32 × 5) + RGBA8. */
export const RECT_STRIDE = 24;

/**
 * Largest bar index float32 holds exactly (2^24). The shaders rebase x onto an
 * integer origin near the view, and `index - origin` is only exact while both
 * are integers below this; past it neighbouring indices round together. Bar
 * counts that large (16.7M bars in one series) are out of scope.
 */
export const MAX_EXACT_INDEX = 2 ** 24;

/**
 * CPU-side instance buffer for instanced rects. Prices are stored relative to
 * `base` so large prices keep float32 precision on the GPU, and x indices
 * relative to `indexBase`, so shifting every index (older bars prepended)
 * leaves the stored instances unchanged.
 */
export class RectBatch extends Slots {
  base = 0;
  /** Timeline index stored as 0: instances hold `index - indexBase`. */
  indexBase = 0;

  constructor() {
    super(RECT_STRIDE);
  }

  /**
   * Write instance `i`. `weight` scales body widths when the draw call enables
   * it (volume candles); negative means "no weight", i.e. the normal width.
   * `index` is stored as float32, exact for integers up to `MAX_EXACT_INDEX`.
   */
  set(i: number, index: number, p0: number, p1: number, kind: number, color: Rgba, weight = 1): void {
    const slot = this.head + i;
    const f = (slot * RECT_STRIDE) / 4;
    this.f32[f] = index - this.indexBase;
    this.f32[f + 1] = p0 - this.base;
    this.f32[f + 2] = p1 - this.base;
    this.f32[f + 3] = kind;
    this.f32[f + 4] = weight;
    const b = slot * RECT_STRIDE + 20;
    this.u8[b] = color[0];
    this.u8[b + 1] = color[1];
    this.u8[b + 2] = color[2];
    this.u8[b + 3] = color[3];
    if (i < this.dirtyFrom) this.dirtyFrom = i;
    if (i >= this.dirtyTo) this.dirtyTo = i + 1;
  }

  /**
   * Horizontal span for `GLRenderer.drawSpans`: x0..x1 (in the x units the
   * draw call maps) by p0..p1 in price. The ends are stored relative to the
   * integer `base`, which goes in the weight slot, and the kind slot holds x1.
   * Absolute ends near bar 1M would keep only 1/16 of a bar in float32; relative
   * to a base close by (such as the profile's session edge) they stay exact
   * enough, and the shader adds `base - origin`, which is exact for integers
   * below `MAX_EXACT_INDEX`.
   */
  setSpan(i: number, x0: number, x1: number, p0: number, p1: number, color: Rgba, base = 0): void {
    this.set(i, x0 - base, p0, p1, x1 - base, color, base);
  }

  /**
   * Point marker for `GLRenderer.drawPoints`: fractional index `x`, price `p`,
   * and `size` stored as is (not relative to `base`) in the p1 slot.
   */
  setPoint(i: number, x: number, p: number, size: number, color: Rgba): void {
    this.set(i, x, p, 0, 0, color);
    this.f32[((this.head + i) * RECT_STRIDE) / 4 + 2] = size;
  }
}
