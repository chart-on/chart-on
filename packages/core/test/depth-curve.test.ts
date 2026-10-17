import { describe, expect, it } from 'vitest';
import { depthCurve } from '../src/numeric/depth';
import type { NumericItem } from '../src/numeric/types';

/** The value a forward step line shows at `x`: the last item at or before it. */
function stepValue(items: readonly NumericItem[], x: number): number | null {
  let v: number | null = null;
  for (const item of items) if (item.x <= x) v = item.value;
  return v;
}

describe('depthCurve', () => {
  const bids = [
    { price: 99, size: 2 },
    { price: 98, size: 3 },
    { price: 97, size: 5 },
  ];
  const asks = [
    { price: 101, size: 1 },
    { price: 102, size: 4 },
    { price: 103, size: 2 },
  ];

  it('sorts each side by price', () => {
    const { bids: b, asks: a } = depthCurve([...bids].reverse(), [...asks].reverse());
    for (const side of [b, a]) for (let i = 1; i < side.length; i++) expect(side[i]!.x).toBeGreaterThanOrEqual(side[i - 1]!.x);
  });

  it('shows the size at or better than each price on a step line', () => {
    const curve = depthCurve(bids, asks);
    // Bids: everything at the price or above (between levels; the line is vertical at a level's own price).
    expect(stepValue(curve.bids, 96.5)).toBeNull();
    expect(stepValue(curve.bids, 97.5)).toBe(5);
    expect(stepValue(curve.bids, 98.5)).toBe(2);
    expect(stepValue(curve.bids, 99.5)).toBe(0);
    // Asks: everything at the price or below.
    expect(stepValue(curve.asks, 101)).toBe(1);
    expect(stepValue(curve.asks, 101.5)).toBe(1);
    expect(stepValue(curve.asks, 102)).toBe(5);
    expect(stepValue(curve.asks, 103)).toBe(7);
  });

  it('drops to zero at the best prices, so the spread is a gap', () => {
    const curve = depthCurve(bids, asks);
    expect(curve.bids[curve.bids.length - 1]).toEqual({ x: 99, value: 0 });
    expect(curve.asks[0]).toEqual({ x: 101, value: 0 });
    // The deepest bid starts at the whole side's size.
    expect(curve.bids[0]).toEqual({ x: 97, value: 10 });
  });

  it('adds up levels at the same price and skips invalid ones', () => {
    const curve = depthCurve(
      [
        { price: 50, size: 1 },
        { price: 50, size: 2 },
        { price: NaN, size: 1 },
        { price: 49, size: 0 },
        { price: 48, size: -1 },
        { price: 47, size: Infinity },
        null as unknown as { price: number; size: number },
      ],
      [],
    );
    expect(curve.bids).toEqual([
      { x: 50, value: 3 },
      { x: 50, value: 0 },
    ]);
    expect(curve.asks).toEqual([]);
  });

  it('returns empty sides for an empty book', () => {
    expect(depthCurve([], [])).toEqual({ bids: [], asks: [], crossed: false });
  });

  it('reports a crossed or locked book without changing it', () => {
    expect(depthCurve(bids, asks).crossed).toBe(false);
    const crossed = depthCurve([...bids, { price: 101.5, size: 1 }], asks);
    expect(crossed.crossed).toBe(true);
    expect(crossed.bids.at(-1)).toEqual({ x: 101.5, value: 0 });
    expect(depthCurve([{ price: 101, size: 1 }], asks).crossed).toBe(true);
    expect(depthCurve(bids, []).crossed).toBe(false);
  });
});
