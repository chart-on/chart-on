import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILE_ROWS,
  VolumeProfile,
  binVolume,
  computeVolumeProfile,
  pointOfControl,
  profileLayout,
  valueArea,
} from '../src/profile/math';
import type { Bar } from '../src/types';

const bar = (low: number, high: number, volume?: number, extra: Partial<Bar> = {}): Bar => ({
  time: 0,
  open: low,
  high,
  low,
  close: high,
  volume,
  ...extra,
});

function profileOf(start: number, rowSize: number, rows: number): VolumeProfile {
  return new VolumeProfile().reset({ start, rowSize, rows });
}

const sum = (a: ArrayLike<number>, n: number) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]!;
  return s;
};

describe('profileLayout', () => {
  it('splits the range into a row count', () => {
    expect(profileLayout(100, 110, { rows: 10 })).toEqual({ start: 100, rowSize: 1, rows: 10 });
    expect(profileLayout(110, 100, { rows: 4 })).toEqual({ start: 100, rowSize: 2.5, rows: 4 });
  });

  it('aligns fixed row sizes to multiples of the size', () => {
    expect(profileLayout(101.3, 104.9, { rowSize: 0.5 })).toEqual({ start: 101, rowSize: 0.5, rows: 8 });
    // A high on a row boundary belongs to the row below (top row is open-ended).
    expect(profileLayout(100, 110, { rowSize: 5 })).toEqual({ start: 100, rowSize: 5, rows: 2 });
    expect(profileLayout(0.1, 0.3, { rowSize: 0.1 }).rows).toBe(2);
  });

  it('caps the row count', () => {
    const l = profileLayout(0, 100, { rowSize: 1e-6 });
    expect(l.rows).toBeLessThanOrEqual(MAX_PROFILE_ROWS);
    expect(l.start + l.rows * l.rowSize).toBeGreaterThanOrEqual(100 - 1e-9);
    expect(profileLayout(0, 1, { rows: 1e9 }).rows).toBe(MAX_PROFILE_ROWS);
  });

  it('handles flat and empty ranges', () => {
    const flat = profileLayout(50, 50, { rows: 10 });
    expect(flat.rows).toBe(1);
    expect(flat.start).toBeLessThan(50);
    expect(flat.start + flat.rowSize).toBeGreaterThan(50);
    expect(profileLayout(Infinity, -Infinity).rows).toBe(0);
  });

  it('rejects rows and row sizes that are not positive finite numbers', () => {
    for (const rowSize of [Infinity, -Infinity, NaN, 0, -1]) {
      expect(() => profileLayout(0, 10, { rowSize })).toThrow(/rowSize/);
    }
    for (const rows of [Infinity, NaN, 0, -5]) {
      expect(() => profileLayout(0, 10, { rows })).toThrow(/rows/);
    }
  });
});

describe('binVolume', () => {
  it('spreads a bar evenly over the rows its range covers', () => {
    const p = binVolume([bar(100, 110, 100)], 0, 1, profileOf(100, 1, 10));
    expect(Array.from(p.volume.subarray(0, 10))).toEqual(new Array(10).fill(10));
    expect(p.total).toBe(100);
  });

  it('gives partially covered rows their share of the overlap', () => {
    const p = binVolume([bar(100.5, 102.5, 40)], 0, 1, profileOf(100, 1, 4));
    expect(Array.from(p.volume.subarray(0, 4))).toEqual([10, 20, 10, 0]);
  });

  it('puts a bar with no range in a single row', () => {
    const p = binVolume([bar(102.5, 102.5, 7)], 0, 1, profileOf(100, 1, 4));
    expect(Array.from(p.volume.subarray(0, 4))).toEqual([0, 0, 7, 0]);
  });

  it('skips zero, missing and invalid volume', () => {
    const p = binVolume(
      [bar(100, 101, 0), bar(100, 101), bar(100, 101, -5), bar(101, 100, 3), bar(100, 101, NaN)],
      0,
      5,
      profileOf(100, 1, 2),
    );
    expect(p.total).toBe(0);
    expect(sum(p.volume, 2)).toBe(0);
  });

  it('keeps volume outside the layout in the edge rows', () => {
    const p = binVolume([bar(90, 95, 5), bar(104, 108, 8), bar(98, 102, 4)], 0, 3, profileOf(100, 1, 2));
    expect(p.volume[0]).toBeCloseTo(5 + 3);
    expect(p.volume[1]).toBeCloseTo(8 + 1);
  });

  it('only bins bars in [from, to)', () => {
    const bars = [bar(100, 101, 1), bar(100, 101, 2), bar(100, 101, 4)];
    expect(binVolume(bars, 1, 2, profileOf(100, 1, 1)).total).toBe(2);
    expect(binVolume(bars, -3, 99, profileOf(100, 1, 1)).total).toBe(7);
  });

  it('splits rows into buy and sell volume when bars carry it', () => {
    const p = binVolume(
      [bar(100, 102, 100, { buyVolume: 30 }), bar(100, 102, 50), bar(100, 101, 10, { buyVolume: 20 })],
      0,
      3,
      profileOf(100, 1, 2),
    );
    expect(p.hasBuySell).toBe(true);
    expect(p.buy[0]).toBeCloseTo(15 + 10);
    expect(p.sell[0]).toBeCloseTo(35);
    expect(p.buy[1]).toBeCloseTo(15);
    expect(p.sell[1]).toBeCloseTo(35);
    // The bar without a split adds volume but neither buy nor sell.
    expect(p.volume[1]).toBeCloseTo(50 + 25);
  });

  it('preserves the total volume', () => {
    const bars: Bar[] = [];
    let price = 100;
    for (let i = 0; i < 500; i++) {
      price += Math.sin(i * 1.7) * 2;
      bars.push(bar(price - Math.abs(Math.cos(i)) * 3, price + Math.abs(Math.sin(i * 0.3)) * 3, 1 + (i % 17)));
    }
    const p = computeVolumeProfile(bars, 0, bars.length, { rows: 33 });
    const expected = bars.reduce((s, b) => s + b.volume!, 0);
    expect(p.total).toBe(expected);
    expect(sum(p.volume, p.rows)).toBeCloseTo(expected, 6);
  });
});

describe('pointOfControl', () => {
  it('finds the row with the most volume', () => {
    expect(pointOfControl([1, 4, 9, 2])).toBe(2);
    expect(pointOfControl([3])).toBe(0);
  });

  it('returns -1 without volume', () => {
    expect(pointOfControl([0, 0, 0])).toBe(-1);
    expect(pointOfControl([])).toBe(-1);
    expect(pointOfControl([5, 5], 0)).toBe(-1);
  });

  it('breaks ties towards the middle, then the lower row', () => {
    expect(pointOfControl([5, 0, 0, 5, 0])).toBe(3);
    expect(pointOfControl([5, 1, 5])).toBe(0);
    expect(pointOfControl([0, 5, 0, 0, 5, 0])).toBe(1);
    expect(pointOfControl([2, 2, 2, 2, 2])).toBe(2);
  });

  it('ignores storage past the row count', () => {
    expect(pointOfControl(new Float64Array([1, 2, 99]), 2)).toBe(1);
  });
});

describe('valueArea', () => {
  it('grows from the POC towards the heavier neighbour', () => {
    // Total 21, 70% = 14.7: POC 10, then 8 below beats 2 above.
    expect(valueArea([0, 1, 8, 10, 2, 0], 6, 3)).toEqual({ low: 2, high: 3 });
  });

  it('adds both neighbours on a tie', () => {
    expect(valueArea([1, 2, 3, 10, 3, 2, 1], 7, 3)).toEqual({ low: 2, high: 4 });
  });

  it('keeps growing on one side once the other is exhausted', () => {
    expect(valueArea([4, 3, 3], 3, 0)).toEqual({ low: 0, high: 1 });
    expect(valueArea([1, 1, 1, 6], 4, 3, 100)).toEqual({ low: 0, high: 3 });
  });

  it('handles single rows, zero volume and extreme percentages', () => {
    expect(valueArea([5], 1, 0)).toEqual({ low: 0, high: 0 });
    expect(valueArea([0, 0], 2, -1)).toEqual({ low: -1, high: -1 });
    expect(valueArea([1, 5, 1], 3, 1, 0)).toEqual({ low: 1, high: 1 });
    expect(valueArea([0, 5, 5, 0], 4, 1, 100)).toEqual({ low: 1, high: 2 });
    expect(valueArea([1, 5, 1], 3, 1, 250)).toEqual({ low: 0, high: 2 });
  });

  it('reaches at least the requested share', () => {
    const volume = [3, 8, 1, 4, 12, 7, 7, 2, 9, 0, 5];
    const total = volume.reduce((a, b) => a + b, 0);
    const poc = pointOfControl(volume);
    for (const pct of [10, 50, 70, 90]) {
      const { low, high } = valueArea(volume, volume.length, poc, pct);
      expect(low).toBeLessThanOrEqual(poc);
      expect(high).toBeGreaterThanOrEqual(poc);
      expect(sum(volume.slice(low), high - low + 1)).toBeGreaterThanOrEqual((total * pct) / 100);
    }
  });
});

describe('computeVolumeProfile', () => {
  it('bins, finds the POC and the value area', () => {
    const bars = [bar(100, 110, 10), bar(104, 106, 60), bar(105, 105, 30)];
    const p = computeVolumeProfile(bars, 0, 3, { rows: 10, valueArea: 70 });
    expect(p.rows).toBe(10);
    expect(p.poc).toBe(5);
    expect(p.rowPrice(p.poc)).toBe(105.5);
    expect(p.maxVolume).toBeCloseTo(1 + 30 + 30);
    expect(p.valueAreaLow).toBe(4);
    expect(p.valueAreaHigh).toBe(5);
    expect(p.rowLow(p.valueAreaLow)).toBe(104);
    expect(p.rowHigh(p.valueAreaHigh)).toBe(106);
  });

  it('without rows or rowSize, takes the row count from the bar count by the Rice rule', () => {
    const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(100 + i, 101 + i, 1));
    // ceil(2 * n^(1/3)): 27 bars give 6 rows, 1000 bars 20, one bar 2.
    expect(computeVolumeProfile(bars(27), 0, 27).rows).toBe(6);
    expect(computeVolumeProfile(bars(1000), 0, 1000).rows).toBe(20);
    expect(computeVolumeProfile(bars(1), 0, 1).rows).toBe(2);
  });

  it('reports empty and zero-volume ranges', () => {
    const empty = computeVolumeProfile([], 0, 0);
    expect(empty.rows).toBe(0);
    expect(empty.poc).toBe(-1);
    const silent = computeVolumeProfile([bar(1, 2, 0), bar(2, 3)], 0, 2, { rows: 5 });
    expect(silent.rows).toBe(5);
    expect(silent.total).toBe(0);
    expect([silent.poc, silent.valueAreaLow, silent.valueAreaHigh]).toEqual([-1, -1, -1]);
  });

  it('reuses storage between computations', () => {
    const out = new VolumeProfile();
    computeVolumeProfile([bar(0, 10, 5)], 0, 1, { rows: 20 }, out);
    const storage = out.volume;
    computeVolumeProfile([bar(50, 60, 1)], 0, 1, { rows: 10 }, out);
    expect(out.volume).toBe(storage);
    expect(sum(out.volume, out.rows)).toBeCloseTo(1);
    expect(out.start).toBe(50);
  });

  it('handles 100k bars', () => {
    const bars: Bar[] = [];
    let price = 50_000;
    for (let i = 0; i < 100_000; i++) {
      price *= 1 + Math.sin(i * 12.9898) * 0.002;
      bars.push(bar(price * 0.998, price * 1.002, 100 + (i % 50)));
    }
    const p = computeVolumeProfile(bars, 0, bars.length, { rows: 200 });
    expect(p.total).toBe(bars.reduce((s, b) => s + b.volume!, 0));
    expect(sum(p.volume, p.rows) / p.total).toBeCloseTo(1, 9);
    expect(p.poc).toBeGreaterThanOrEqual(0);
  });
});
