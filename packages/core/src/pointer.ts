import type { Pane } from './pane';
import type { TimeScale } from './scales';
import type { Timeline } from './timeline';
import type { Point, Time } from './types';

/** A chart position in data terms: nearest bar and the price under the point. */
export interface ChartPoint {
  time: Time;
  /** Timeline index of the nearest bar. */
  index: number;
  price: number;
  pane: number;
}

/** `click` / `dblclick` payload: the data position plus the pointer in chart-root css px. */
export interface ChartPointerEvent extends ChartPoint {
  x: number;
  y: number;
}

/** Data position for plot-relative css px inside `pane`, or null when there is no data or pane. */
export function chartPointAt(
  x: number,
  y: number,
  pane: number,
  panes: readonly Pane[],
  time: TimeScale,
  timeline: Timeline,
): ChartPoint | null {
  const p = panes[pane];
  if (!p || timeline.length === 0) return null;
  const index = Math.round(time.xToIndex(x));
  return { index, time: timeline.timeFromIndex(index), price: p.primary.yToPrice(y - p.top), pane };
}

/**
 * Plot-relative css px for a time and price, the inverse of `chartPointAt`.
 * A null price gives `y = NaN` (no horizontal position).
 */
export function pointFor(t: Time, price: number | null, p: Pane, time: TimeScale, timeline: Timeline): Point {
  return {
    x: time.indexToX(timeline.indexFromTime(t)),
    y: price === null ? NaN : p.top + p.primary.priceToY(price),
  };
}

/**
 * `free` follows the pointer, `close` snaps to the bar's close, `ohlc` to the
 * nearest of open/high/low/close, and `hidden` draws no crosshair.
 */
export type CrosshairMode = 'free' | 'close' | 'ohlc' | 'hidden';

/**
 * The prices a candle style draws for one bar: open is missing for HLC styles,
 * and only the close remains for line-like styles. The close is always kept so
 * `close` snapping works in every style.
 */
export interface DrawnBar {
  open?: number;
  high?: number;
  low?: number;
  close: number;
}

/**
 * Price the crosshair shows for `mode`; unchanged without a bar or in `free`/`hidden`.
 * `project` maps prices to the space "nearest" is measured in, e.g. screen px so
 * a log scale picks the visually nearest value. Default: price units.
 */
export function snapPrice(
  mode: CrosshairMode,
  price: number,
  bar: DrawnBar | undefined,
  project: (price: number) => number = (p) => p,
): number {
  if (!bar || mode === 'free' || mode === 'hidden') return price;
  if (mode === 'close') return bar.close;
  const at = project(price);
  let best = bar.close;
  for (const v of [bar.open, bar.high, bar.low]) {
    if (v !== undefined && Math.abs(project(v) - at) < Math.abs(project(best) - at)) best = v;
  }
  return best;
}

/** Pointer distance (css px) that still counts as over a line or a thin bar. */
export const HOVER_TOLERANCE = 4;

/**
 * Whether pane-relative `y` is over a series value at one bar. `toY` maps a
 * price to pane-relative px. Candles cover high to low (a band around the
 * close for line-like styles), histograms base to value, and lines a band
 * around the value.
 */
export function hitsValue(
  target: { kind: 'candles'; bar: DrawnBar } | { kind: 'histogram'; value: number; base: number } | { kind: 'line'; value: number },
  y: number,
  toY: (price: number) => number,
): boolean {
  const within = (a: number, b: number) => y >= Math.min(a, b) - HOVER_TOLERANCE && y <= Math.max(a, b) + HOVER_TOLERANCE;
  switch (target.kind) {
    case 'candles':
      return within(toY(target.bar.high ?? target.bar.close), toY(target.bar.low ?? target.bar.close));
    case 'histogram':
      return within(toY(target.base), toY(target.value));
    case 'line':
      return within(toY(target.value), toY(target.value));
  }
}
