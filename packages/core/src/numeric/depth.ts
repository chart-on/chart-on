import type { NumericItem } from './types';
import { isNumber } from '../util/records';

/** One order-book level: a price and the size resting there. */
export interface BookLevel {
  price: number;
  size: number;
}

/** The two sides of a depth curve, each sorted by price, ready for `setData` on a step line. */
export interface DepthCurve {
  bids: NumericItem[];
  asks: NumericItem[];
  /**
   * The best bid is at or above the best ask: a crossed or locked book, which
   * a live book only shows for a moment (or when its feed is out of step).
   * The curves are still built as given, so they overlap on the chart; check
   * this to warn, or to wait for the next update.
   */
  crossed: boolean;
}

/**
 * Turn order-book levels into the two cumulative step series of a depth
 * curve, for line series with `lineType: 'step'` on a `NumericChart`.
 *
 * At a bid price `p` the bid curve shows the size of every bid at `p` or
 * above (what a market sell down to `p` would fill); at an ask price, the
 * ask curve shows every ask at `p` or below. Both curves drop to zero at
 * their best price, so the spread shows as the gap between them.
 *
 * Levels may come in any order. Levels with a non-finite price, or a size
 * that is not a positive finite number, are skipped; levels at the same
 * price are added together. A crossed book (best bid at or above the best
 * ask) is not corrected: `crossed` reports it.
 */
export function depthCurve(bids: readonly BookLevel[], asks: readonly BookLevel[]): DepthCurve {
  const b = merge(bids);
  const a = merge(asks);
  const bestBid = b[b.length - 1];
  const bestAsk = a[0];
  const crossed = bestBid !== undefined && bestAsk !== undefined && bestBid.price >= bestAsk.price;
  return { bids: bidSide(b), asks: askSide(a), crossed };
}

/** Valid levels summed per price, ascending by price. */
function merge(levels: readonly BookLevel[]): BookLevel[] {
  const byPrice = new Map<number, number>();
  for (const level of levels) {
    const { price, size } = level ?? {};
    if (!isNumber(price) || !isNumber(size) || !(size > 0)) {
      continue;
    }
    byPrice.set(price, (byPrice.get(price) ?? 0) + size);
  }
  return [...byPrice].map(([price, size]) => ({ price, size })).sort((a, b) => a.price - b.price);
}

/**
 * Bids, ascending: a step line holds each value until the next item's x, so
 * the size of the levels above a price starts at the level below it. Each
 * level gets the total above it from the next lower price on, and the curve
 * starts at the deepest level's full total and ends with a drop at the best bid.
 */
function bidSide(levels: BookLevel[]): NumericItem[] {
  const n = levels.length;
  if (n === 0) return [];
  // above[i]: total size at levels i..n-1, i.e. at the price of level i or higher.
  const above = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) above[i] = above[i + 1]! + levels[i]!.size;
  const out: NumericItem[] = [{ x: levels[0]!.price, value: above[0]! }];
  // Strictly above level i and up to level i + 1: the levels from i + 1 up.
  for (let i = 0; i < n - 1; i++) out.push({ x: levels[i]!.price, value: above[i + 1]! });
  out.push({ x: levels[n - 1]!.price, value: 0 });
  return out;
}

/** Asks, ascending: a rise from zero at the best ask, then each level's running total until the next price. */
function askSide(levels: BookLevel[]): NumericItem[] {
  if (levels.length === 0) return [];
  const out: NumericItem[] = [{ x: levels[0]!.price, value: 0 }];
  let total = 0;
  for (const level of levels) {
    total += level.size;
    out.push({ x: level.price, value: total });
  }
  return out;
}
