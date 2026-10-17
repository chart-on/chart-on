import type { Time } from './types';
import type { RenderBackend } from './gl/backend';
import { PointShapeCode } from './gl/renderer';
import { RectBatch } from './gl/rect-batch';
import { parseColor, type Rgba } from './util/color';
import type { PriceFormat } from './util/price-format';
import {
  Series,
  opaque,
  yUniforms,
  type LastValue,
  type LegendEntry,
  type OverlayMargins,
  type PaneEnv,
  type PriceLineSeriesOptions,
  type SetDataOptions,
} from './series';
import { bisect } from './util/search';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** One marker of a point series. */
export interface PointItem {
  time: Time;
  value: number;
  /**
   * Marker diameter in css px, or with `sizeBy` the quantity mapped to a
   * diameter. Missing, negative or not a finite number: the series `size`.
   */
  size?: number;
  /** Fill colour of this marker; default the series `color`. */
  color?: string;
}

/** Marker shape of a point series. */
export type PointShape = 'circle' | 'square' | 'diamond';

/** Map item sizes (quantities such as trade sizes) to marker diameters. */
export interface PointSizeBy {
  /** Diameter of the smallest quantity, css px. */
  min: number;
  /** Diameter of the largest quantity, css px. */
  max: number;
  /** Quantities mapped to `min`..`max`, clamped outside. Default: the smallest and largest size in the data. */
  domain?: [number, number];
  /** `'sqrt'` (default): marker area grows with the quantity. `'linear'`: the diameter does. */
  scale?: 'linear' | 'sqrt';
}

/**
 * Options for a point series (`chart.addPoints`): marker shape, size and
 * colours, an optional mapping from quantities to sizes, labels and price scale
 * placement.
 */
export interface PointSeriesOptions extends PriceLineSeriesOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  /** Default `'circle'`. */
  shape: PointShape;
  /** Fill colour of markers without their own. Default the theme's line colour. */
  color?: string;
  /** Diameter of markers with no usable `size`, css px. Default 6. */
  size: number;
  /** Size markers by the item `size` as a quantity; without it, item sizes are diameters in css px. */
  sizeBy?: PointSizeBy;
  /** Fill opacity, 0 to 1. Default 0.8. */
  opacity: number;
  /** Outline colour; no outline when unset. */
  stroke?: string;
  /** Outline width, css px. Default 1. */
  strokeWidth?: number;
  format: (value: number) => string;
  /** Overrides `format` for labels, and gives the pane its tick size and axis unit. */
  priceFormat?: PriceFormat;
  /** Label the newest point's value on the price axis. Default false. */
  lastValueLabel: boolean;
  /** Show the series title in a tag beside the last-value label. */
  axisTitle?: boolean;
  overlay?: OverlayMargins;
  /** Price scale id in the pane (default `'right'`). Ignored with `overlay`. */
  priceScale?: string;
}

/** A size with no meaning: the marker takes the series `size`. */
const NO_SIZE = -1;

/** The stored size of an item: its `size`, or `NO_SIZE`. */
function rawSize(item: PointItem): number {
  const s = item.size;
  return s !== undefined && Number.isFinite(s) && s >= 0 ? s : NO_SIZE;
}

/**
 * Diameter in css px of a marker with stored size `size` (see `rawSize`),
 * given the auto `domain` of the data. Mirrors `diameter` in the point shader.
 */
export function pointDiameter(size: number, o: Pick<PointSeriesOptions, 'size' | 'sizeBy'>, domain: readonly [number, number]): number {
  if (size < 0) return o.size;
  const by = o.sizeBy;
  if (!by) return size;
  const [lo, hi] = by.domain ?? domain;
  let t = hi > lo ? Math.min(Math.max((size - lo) / (hi - lo), 0), 1) : 1;
  if ((by.scale ?? 'sqrt') === 'sqrt') t = Math.sqrt(t);
  return by.min + (by.max - by.min) * t;
}

/** First position in `a[0..n)` whose value is at least `v` (or above it with `after`). */
function search(a: Float64Array, n: number, v: number, after = false): number {
  return bisect(n, (i) => a[i]! < v || (after && a[i] === v));
}

/**
 * Markers at exact times and prices, drawn as GPU instances in one call:
 * large trades, liquidations, sampled ticks, signal clouds. Items may share a
 * time and keep the order given.
 */
export class PointSeries extends Series<PointSeriesOptions> {
  readonly kind = 'points';
  data: PointItem[] = [];
  readonly batch = new RectBatch();
  /** Fractional timeline index of each item; ascending, like the times. */
  private index = new Float64Array(0);
  /** Smallest and largest usable item size, the default `sizeBy` domain. */
  #domain: [number, number] = [Infinity, -Infinity];
  /** Bar interval the positions were computed with; points outside the bars extrapolate by it. */
  private interval = 0;
  /** Autoscale of the last visible span, reused while neither data nor span change. */
  #rangeCache: { a: number; b: number; positiveOnly: boolean; range: [number, number] | null } | null = null;

  setData(items: PointItem[], options: SetDataOptions = {}): void {
    for (let i = 0; i < items.length; i++) {
      if (!Number.isFinite(items[i]!.time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Points time at index ${i} is not a finite number` : '');
    }
    let data = items;
    if (options.normalize) {
      // Stable: items sharing a time keep their order. Equal times are allowed, so nothing is dropped.
      data = [...items].sort((a, b) => a.time - b.time);
    } else {
      for (let i = 1; i < items.length; i++) {
        if (items[i]!.time < items[i - 1]!.time) {
          throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Points times must be ascending (index ${i}); pass { normalize: true } to sort` : '');
        }
      }
    }
    this.data = data.filter((p) => Number.isFinite(p.value));
    this.rebuild();
    this.host.requestRender();
  }

  /** Add a point at or after the newest one's time; an older one is dropped (`data:dropped`). */
  update(item: PointItem): void {
    if (!Number.isFinite(item.time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Points update time is not a finite number' : '');
    const last = this.data[this.data.length - 1];
    if (last && item.time < last.time) {
      this.host.seriesDropped?.(this, item, 'older');
      return;
    }
    if (!Number.isFinite(item.value)) return;
    this.data.push(item);
    const n = this.data.length;
    this.#growIndex(n);
    this.batch.resize(n);
    this.#write(n - 1);
    this.#widenDomain(item);
    this.#rangeCache = null;
    this.host.requestRender();
  }

  rebuild(): void {
    const n = this.data.length;
    this.#growIndex(n);
    this.batch.base = n > 0 ? this.data[0]!.value : 0;
    this.batch.resize(n);
    this.#domain = [Infinity, -Infinity];
    this.#colorCache = null;
    for (let i = 0; i < n; i++) {
      this.#write(i);
      this.#widenDomain(this.data[i]!);
    }
    this.batch.markAllDirty();
    this.interval = this.host.timeline.interval;
    this.#rangeCache = null;
  }

  /** A bar was appended: only points from the bar before it on can move, unless the interval changed. */
  override appendAligned(): void {
    const tl = this.host.timeline;
    if (tl.interval !== this.interval) {
      this.rebuild();
      return;
    }
    const prev = tl.times[tl.length - 2];
    const n = this.data.length;
    let from = n;
    if (prev === undefined) from = 0;
    else while (from > 0 && this.data[from - 1]!.time >= prev) from--;
    for (let i = from; i < n; i++) this.#write(i);
    if (from < n) this.#rangeCache = null;
  }

  #growIndex(n: number): void {
    if (n <= this.index.length) return;
    const next = new Float64Array(Math.max(n, Math.ceil(this.index.length * 1.5), 256));
    next.set(this.index);
    this.index = next;
  }

  /** Parsed series colour, kept while the option and theme stay the same. */
  #colorCache: { source: string; rgba: Rgba } | null = null;

  #seriesColor(): string {
    return this.options.color ?? this.host.theme.line;
  }

  #colorOf(item: PointItem): Rgba {
    if (item.color) return parseColor(item.color);
    const source = this.#seriesColor();
    if (this.#colorCache?.source !== source) this.#colorCache = { source, rgba: parseColor(source) };
    return this.#colorCache.rgba;
  }

  #write(i: number): void {
    const item = this.data[i]!;
    const x = this.host.timeline.indexFromTime(item.time);
    this.index[i] = x;
    this.batch.setPoint(i, x, item.value, rawSize(item), this.#colorOf(item));
  }

  #widenDomain(item: PointItem): void {
    const s = rawSize(item);
    if (s < 0) return;
    if (s < this.#domain[0]) this.#domain[0] = s;
    if (s > this.#domain[1]) this.#domain[1] = s;
  }

  /** The default `sizeBy` domain: the data's size range, or [0, 0] without sizes. */
  get sizeDomain(): [number, number] {
    return this.#domain[0] <= this.#domain[1] ? [this.#domain[0], this.#domain[1]] : [0, 0];
  }

  /** Diameter of item `i`, css px. */
  diameterOf(i: number): number {
    return pointDiameter(rawSize(this.data[i]!), this.options, this.sizeDomain);
  }

  /** The widest marker any item can have, css px. */
  #maxDiameter(): number {
    const o = this.options;
    if (o.sizeBy) return Math.max(o.size, o.sizeBy.min, o.sizeBy.max);
    return Math.max(o.size, this.sizeDomain[1]);
  }

  /** Items [a, b) whose positions lie in [from, to]. */
  span(from: number, to: number): [number, number] {
    const n = this.data.length;
    return [search(this.index, n, from), search(this.index, n, to, true)];
  }

  /** Timeline index of item `i` (fractional: items keep their exact time). */
  positionOf(i: number): number {
    return this.index[i]!;
  }

  /**
   * Data index of the marker under css point (x, y), the nearest when several
   * are, or -1. A marker counts within its radius plus `slop` px; on a tie the
   * later item, drawn on top, wins.
   */
  itemAt(
    x: number,
    y: number,
    view: { indexToX(i: number): number; xToIndex(x: number): number; priceToY(price: number): number },
    slop = 3,
  ): number {
    const reach = this.#maxDiameter() / 2 + slop;
    const a0 = view.xToIndex(x - reach);
    const b0 = view.xToIndex(x + reach);
    const [a, b] = this.span(Math.min(a0, b0), Math.max(a0, b0));
    let best = -1;
    let bestDist = Infinity;
    for (let i = a; i < b; i++) {
      const py = view.priceToY(this.data[i]!.value);
      if (!Number.isFinite(py)) continue;
      const dist = Math.hypot(view.indexToX(this.index[i]!) - x, py - y);
      if (dist <= this.diameterOf(i) / 2 + slop && dist <= bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  }

  override firstValueFrom(index: number): number | undefined {
    const [a] = this.span(index - 0.5, Infinity);
    return this.data[a]?.value;
  }

  override priceRange(from: number, to: number, positiveOnly = this.scale.isLog): [number, number] | null {
    const [a, b] = this.span(from, to);
    const c = this.#rangeCache;
    if (c && c.a === a && c.b === b && c.positiveOnly === positiveOnly) return c.range;
    let range: [number, number] | null = null;
    if (a < b) {
      const builder = this.rangeBuilder.reset(positiveOnly);
      for (let i = a; i < b; i++) builder.add(this.data[i]!.value);
      range = builder.range;
    }
    this.#rangeCache = { a, b, positiveOnly, range };
    return range;
  }

  override dispose(): void {
    this.host.releaseGpu?.(this.batch);
  }

  override get drawsOnGpu(): boolean {
    return true;
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    const o = this.options;
    // Markers centred just off screen still show their edge.
    const pad = (this.#maxDiameter() / 2 + 1) / Math.max(env.time.barSpacing, 1e-9);
    const [a, b] = this.span(env.from - pad, env.to + pad);
    const by = o.sizeBy;
    const stroke = o.stroke ? parseColor(o.stroke) : null;
    r.drawPoints(this.batch, a, b - a, {
      x: env.time.xTransform(),
      ...yUniforms(this.scale, this.batch.base),
      shape: PointShapeCode[o.shape] ?? 0,
      size: [o.size, by?.min ?? 0, by?.max ?? 0, by ? ((by.scale ?? 'sqrt') === 'sqrt' ? 2 : 1) : 0],
      domain: by?.domain ?? this.sizeDomain,
      opacity: o.opacity,
      stroke: stroke ? [stroke[0] / 255, stroke[1] / 255, stroke[2] / 255, stroke[3] / 255] : [0, 0, 0, 0],
      strokeWidth: stroke ? (o.strokeWidth ?? 1) : 0,
    });
  }

  /** Items drawn in bar `index`: positions within half a bar of it. */
  barSpan(index: number): [number, number] {
    const [a] = this.span(index - 0.5, Infinity);
    const b = search(this.index, this.data.length, index + 0.5);
    return [a, Math.max(a, b)];
  }

  /** Raw values of the bar at `time`: its newest point's value and its point count; null without points. */
  valuesInBar(time: Time): { value: number; count: number } | null {
    const [a, b] = this.barSpan(Math.round(this.host.timeline.indexFromTime(time)));
    return b > a ? { value: this.data[b - 1]!.value, count: b - a } : null;
  }

  /** The newest point in the bar under the crosshair, and the bar's point count. */
  override legend(index: number): LegendEntry {
    const [a, b] = this.barSpan(index);
    const last = this.data[b - 1];
    return {
      title: this.options.title,
      parts:
        b > a && last
          ? [
              { text: this.formatValue(last.value), color: opaque(last.color ?? this.#seriesColor()) },
              { label: this.locale.text('legendCount'), text: String(b - a) },
            ]
          : [],
    };
  }

  protected override labelValueAt(i: number): LastValue | null {
    const p = this.data[i];
    return p ? { value: p.value, text: this.formatValue(p.value), color: opaque(p.color ?? this.#seriesColor()) } : null;
  }

  override lastIndexAtOrBefore(index: number): number {
    if (index === Infinity) return this.data.length - 1;
    return search(this.index, this.data.length, index + 0.5) - 1;
  }
}
