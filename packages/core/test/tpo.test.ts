import { describe, expect, it } from 'vitest';
import { MAX_PROFILE_ROWS } from '../src/profile/math';
import { computeTpoProfile, computeTpoProfiles, tpoColumns, tpoLetter } from '../src/profile/tpo';

import type { Bar } from '../src/types';
import { hours } from './sessions';

const bar = (time: number, low: number, high: number): Bar => ({ time, open: low, high, low, close: high });

describe('tpoLetter', () => {
  it('runs A to Z, a to z, then wraps', () => {
    expect([0, 1, 25, 26, 51, 52].map(tpoLetter)).toEqual(['A', 'B', 'Z', 'a', 'z', 'A']);
  });
});

describe('computeTpoProfile', () => {
  const bars = [bar(0, 10, 12), bar(1800, 11, 13), bar(3600, 11.5, 11.9), bar(5400, 9, 10.5)];

  it('stacks one period per bar on every row its range touches', () => {
    const p = computeTpoProfile(bars, 0, bars.length, { rowSize: 1 });
    expect(p.time).toBe(0);
    expect(p.start).toBe(9);
    expect(p.rowSize).toBe(1);
    expect(p.rows).toBe(5);
    expect(p.periods).toBe(4);
    // Rows 9, 10, 11, 12, 13.
    expect(p.counts).toEqual([1, 2, 3, 2, 1]);
    expect(p.rowPeriods).toEqual([[3], [0, 3], [0, 1, 2], [0, 1], [1]]);
    expect(p.poc).toBe(2);
    expect([p.valueAreaLow, p.valueAreaHigh]).toEqual([1, 3]);
  });

  it('honours the bar range and value area share', () => {
    const p = computeTpoProfile(bars, 1, 3, { rowSize: 1, valueArea: 100 });
    expect(p.time).toBe(1800);
    expect(p.start).toBe(11);
    expect(p.counts).toEqual([2, 1, 1]);
    expect(p.rowPeriods).toEqual([[0, 1], [0], [0]]);
    expect([p.valueAreaLow, p.valueAreaHigh]).toEqual([0, 2]);
  });

  it('keeps period numbers for bars with an invalid range', () => {
    const p = computeTpoProfile([bar(0, 5, 5), bar(1, NaN, 6), bar(2, 6, 6)], 0, 3, { rowSize: 1 });
    expect(p.periods).toBe(3);
    expect(p.rowPeriods).toEqual([[0], [2]]);
  });

  it('is empty without valid bars', () => {
    const p = computeTpoProfile([bar(0, 2, 1)], 0, 1, { rowSize: 1 });
    expect(p.rows).toBe(0);
    expect(p.poc).toBe(-1);
    expect(computeTpoProfile([], 0, 0, { rowSize: 1 }).periods).toBe(0);
  });

  it('aligns rows to the row size despite float noise', () => {
    const p = computeTpoProfile([bar(0, 0.3, 0.5)], 0, 1, { rowSize: 0.1 });
    expect(p.rows).toBe(3);
    expect(p.start).toBeCloseTo(0.3);
  });

  it('caps the number of rows', () => {
    const p = computeTpoProfile([bar(0, 0, 100000)], 0, 1, { rowSize: 1 });
    expect(p.rows).toBeLessThanOrEqual(MAX_PROFILE_ROWS);
    expect(p.rowSize).toBeGreaterThan(1);
    expect(p.counts.every((c) => c === 1)).toBe(true);
  });

  it('rejects a bad row size', () => {
    expect(() => computeTpoProfile(bars, 0, 1, { rowSize: -1 })).toThrow(RangeError);
    expect(() => computeTpoProfiles([], { rowSize: 0 })).toThrow(RangeError);
  });
});

describe('computeTpoProfiles', () => {
  const DAY = 86400;

  it('splits bars into one profile per day', () => {
    const bars = [bar(0, 1, 2), bar(1800, 2, 3), bar(DAY, 5, 5), bar(DAY + 1800, 5, 6)];
    const profiles = computeTpoProfiles(bars, { rowSize: 1 });
    expect(profiles.map((p) => [p.time, p.start, p.periods, p.counts])).toEqual([
      [0, 1, 2, [1, 2, 1]],
      [DAY, 5, 2, [2, 1]],
    ]);
  });

  it('follows the session and leaves out bars outside it', () => {
    const bars = [bar(9 * 3600, 1, 1), bar(10 * 3600, 2, 2), bar(17 * 3600, 3, 3)];
    const profiles = computeTpoProfiles(bars, { rowSize: 1, session: hours([['09:30', '16:00']]) });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.periods).toBe(1);
    expect(profiles[0]!.start).toBe(2);
  });

  it('takes other profile lengths', () => {
    const bars = [bar(0, 1, 1), bar(1800, 1, 1), bar(3600, 1, 1)];
    expect(computeTpoProfiles(bars, { rowSize: 1, interval: '1h' }).map((p) => p.periods)).toEqual([2, 1]);
  });
});

describe('tpoColumns', () => {
  const DAY = 86400;

  it('gives every session bar its column of the shared session profile', () => {
    const bars = [bar(0, 1, 2), bar(1800, 2, 3), bar(DAY, 5, 5)];
    const columns = tpoColumns(bars, { rowSize: 1 });
    expect(columns.map((c) => [c.time, c.column])).toEqual([
      [0, 0],
      [1800, 1],
      [DAY, 0],
    ]);
    expect(columns[0]!.profile).toBe(columns[1]!.profile);
    const [first, second] = computeTpoProfiles(bars, { rowSize: 1 });
    expect(columns.map((c) => c.profile)).toEqual([first, first, second]);
  });

  it('leaves out bars outside the session', () => {
    const bars = [bar(9 * 3600, 1, 1), bar(10 * 3600, 2, 2)];
    expect(tpoColumns(bars, { rowSize: 1, session: hours([['09:30', '16:00']]) }).map((c) => c.time)).toEqual([10 * 3600]);
  });
});
