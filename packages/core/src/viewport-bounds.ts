import type { Chart, ViewportBounds } from './chart';
import type { PriceScale } from './scales';
import type { Timeline } from './timeline';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

// `chart.setViewportBounds`: the bounds a chart keeps, the price bound on its scale and the time
// bounds as bar indices. The `viewportBounds()` plugin gives the chart this, so a chart without it
// leaves it out. The time and price scales enforce the bounds; the chart redraws after each change.

/** @internal What the `viewportBounds()` plugin gives a chart. */
export interface ViewportBoundsFeature {
  /** A copy of the bounds, or null. */
  get(): ViewportBounds | null;
  /** Check and keep `bounds` (null removes them), putting the price bound on its scale. Throws on bad bounds. */
  set(bounds: ViewportBounds | null): void;
  /** The time bounds as bar indices of `timeline`, or null when there are none. */
  time(timeline: Timeline): { from: number; to: number } | null;
  /** The symbol or interval changed: clear the bounds unless they are kept. */
  contextChanged(): void;
}

/** @internal The `viewportBounds()` plugin's part for `chart`. */
export function viewportBoundsFeature(chart: Chart): ViewportBoundsFeature {
  let bounds: ViewportBounds | null = null;
  /** The scale the price bound applies to. */
  let scale: PriceScale | null = null;
  return {
    get: () => bounds && structuredClone(bounds),
    set(b) {
      const price = b?.price;
      const pane = price ? chart.panes[price.pane ?? 0] : undefined;
      checkViewportBounds(b, !price || !!pane);
      if (scale) {
        scale.bounds = null;
        scale.autoScale = true;
        scale = null;
      }
      bounds = b && structuredClone(b);
      if (price && pane) {
        scale = pane.scale(price.scale ?? 'right');
        scale.bounds = { low: price.low, high: price.high };
        scale.autoScale = false;
        scale.keepInBounds();
      }
    },
    time(tl) {
      const t = bounds?.time;
      if (!t || tl.length === 0) return null;
      // The first bar at or after `from` and the last at or before `to`.
      const from = t.from === undefined ? -Infinity : Math.ceil(tl.indexFromTime(t.from) - 1e-9);
      const to = t.to === undefined ? Infinity : Math.floor(tl.indexFromTime(t.to) + 1e-9);
      return { from, to: Math.max(from, to) };
    },
    contextChanged() {
      if (bounds && !bounds.keepOnContextChange) chart.setViewportBounds(null);
    },
  };
}

/** Throw on viewport bounds that are not finite numbers, are out of order, or name a missing pane. */
function checkViewportBounds(b: ViewportBounds | null, paneExists: boolean): void {
  if (!b) return;
  const finite = (v: number | undefined) => v === undefined || Number.isFinite(v);
  const t = b.time;
  if (t && (!finite(t.from) || !finite(t.to) || (t.from !== undefined && t.to !== undefined && t.from > t.to))) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Viewport time bounds need finite times with from <= to' : '');
  }
  const p = b.price;
  if (p && (!finite(p.low) || !finite(p.high) || (p.low !== undefined && p.high !== undefined && p.low >= p.high))) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Viewport price bounds need finite prices with low < high' : '');
  }
  if (!paneExists) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Viewport price bounds name pane ${b.price?.pane}, which does not exist` : '');
}
