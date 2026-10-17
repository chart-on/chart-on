import type { BarMarker } from '../annotations/types';
import type { Bar, Time } from '../types';
import type { Localizer } from '../util/locale';

/**
 * A corporate action that changes how earlier prices compare with later ones.
 * `factor` multiplies the prices of every bar before `time`: 0.25 for a
 * 4-for-1 split, about 0.98 for a dividend worth 2% of the price. A split
 * also divides earlier volumes by its factor, so traded value stays the same.
 */
export interface Adjustment {
  /** When it takes effect: bars before this time are adjusted. Unix seconds. */
  time: Time;
  kind: 'split' | 'dividend' | 'other';
  factor: number;
  /** Short text for markers and tooltips, e.g. "4:1 split". */
  label?: string;
}

/**
 * Which adjustments the chart applies to the bars it shows: none (the bars as
 * the data source sent them), splits only, or every kind.
 */
export type AdjustmentMode = 'none' | 'splits' | 'all';

/** Whether `a` is usable: a finite time and a finite, positive factor. */
export function isAdjustment(a: Adjustment): boolean {
  return Number.isFinite(a.time) && Number.isFinite(a.factor) && a.factor > 0;
}

/** The adjustments `mode` applies, newest first. */
function applied(adjustments: readonly Adjustment[], mode: AdjustmentMode): Adjustment[] {
  if (mode === 'none') return [];
  return adjustments
    .filter((a) => isAdjustment(a) && (mode === 'all' || a.kind === 'split'))
    .sort((a, b) => b.time - a.time);
}

/**
 * `bars` back-adjusted for `adjustments` under `mode`: each bar's prices are
 * multiplied by the product of the factors of the adjustments after it, and
 * its volume divided by the product of the split factors after it. Returns
 * `bars` itself when nothing applies, so a source without adjustments costs
 * nothing.
 */
export function adjustBars(bars: Bar[], adjustments: readonly Adjustment[], mode: AdjustmentMode): Bar[] {
  const list = applied(adjustments, mode);
  // Nothing to do when no bar is older than the newest adjustment.
  if (list.length === 0 || bars.length === 0 || list[0]!.time <= bars[0]!.time) return bars;
  const out = new Array<Bar>(bars.length);
  let price = 1;
  let volume = 1;
  let next = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i]!;
    // Every adjustment after this bar's time applies to it and to all older bars.
    while (next < list.length && list[next]!.time > bar.time) {
      const a = list[next++]!;
      price *= a.factor;
      if (a.kind === 'split') volume *= a.factor;
    }
    out[i] = price === 1 && volume === 1 ? bar : scaleBar(bar, price, volume);
  }
  return out;
}

/**
 * Whether `a` and `b` adjust bars at or after `time` alike under `mode`, so
 * bars adjusted under `a` need no change under `b`.
 */
export function sameAdjustmentsAfter(a: readonly Adjustment[], b: readonly Adjustment[], time: Time, mode: AdjustmentMode): boolean {
  const after = (list: readonly Adjustment[]) => applied(list, mode).filter((x) => x.time > time);
  const x = after(a);
  const y = after(b);
  return x.length === y.length && x.every((e, i) => e.time === y[i]!.time && e.kind === y[i]!.kind && e.factor === y[i]!.factor);
}

/** `bar` adjusted like `adjustBars` would adjust it at its time; the bar itself after every adjustment. */
export function adjustBar(bar: Bar, adjustments: readonly Adjustment[], mode: AdjustmentMode): Bar {
  let price = 1;
  let volume = 1;
  for (const a of applied(adjustments, mode)) {
    if (a.time <= bar.time) continue;
    price *= a.factor;
    if (a.kind === 'split') volume *= a.factor;
  }
  return price === 1 && volume === 1 ? bar : scaleBar(bar, price, volume);
}

/** What `adjustBars` multiplies the prices of a bar at `time` by under `mode`: 1 after every adjustment. */
export function priceFactor(time: Time, adjustments: readonly Adjustment[], mode: AdjustmentMode): number {
  let factor = 1;
  // Newest first, in the same order as `adjustBars`, so both round alike.
  for (const a of applied(adjustments, mode)) {
    if (a.time <= time) break;
    factor *= a.factor;
  }
  return factor;
}

function scaleBar(bar: Bar, price: number, volume: number): Bar {
  const out: Bar = {
    ...bar,
    open: bar.open * price,
    high: bar.high * price,
    low: bar.low * price,
    close: bar.close * price,
  };
  if (bar.volume !== undefined) out.volume = bar.volume / volume;
  return out;
}

/** `list` and `more` merged, sorted by time, without repeats of the same time and kind. */
export function mergeAdjustments(list: readonly Adjustment[], more: readonly Adjustment[]): Adjustment[] {
  const seen = new Set<string>();
  return [...list, ...more]
    .filter((a) => {
      const key = `${a.time}:${a.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

const KIND_TEXT = {
  split: ['adjustmentSplitShort', 'adjustmentSplit'],
  dividend: ['adjustmentDividendShort', 'adjustmentDividend'],
  other: ['adjustmentOtherShort', 'adjustmentOther'],
} as const;

/**
 * Bar markers for `adjustments`, oldest first: a lettered label in the bottom
 * lane, with the action's label (or its kind) and price factor as the
 * tooltip. Unusable adjustments are left out.
 */
export function adjustmentMarkers(adjustments: readonly Adjustment[], localizer: Localizer): BarMarker[] {
  const out: BarMarker[] = [];
  for (const a of adjustments) {
    if (!isAdjustment(a)) continue;
    const [short, long] = KIND_TEXT[a.kind] ?? KIND_TEXT.other;
    const factor = localizer.localize(String(Number(a.factor.toPrecision(4))));
    out.push({
      id: `adjustment:${a.kind}:${a.time}`,
      time: a.time,
      shape: 'label',
      position: 'bottom',
      text: localizer.text(short),
      tooltip: [a.label ?? localizer.text(long), localizer.text('adjustmentFactor', { factor })],
      kind: a.kind,
    });
  }
  return out.sort((x, y) => x.time - y.time);
}
