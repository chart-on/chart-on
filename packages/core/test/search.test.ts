import { describe, expect, it } from 'vitest';
import { atTime, boundByTime } from '../src/util/search';

const data = [10, 20, 20, 30].map((time, i) => ({ time, i }));

describe('boundByTime', () => {
  it('finds the first point at or past a time', () => {
    expect(boundByTime(data, 20, true)).toBe(1);
    expect(boundByTime(data, 20, false)).toBe(3);
    expect(boundByTime(data, 15, true)).toBe(1);
    expect(boundByTime(data, 5, true)).toBe(0);
    expect(boundByTime(data, 40, false)).toBe(4);
    expect(boundByTime([], 1, true)).toBe(0);
  });
});

describe('atTime', () => {
  it('returns the point at exactly a time', () => {
    expect(atTime(data, 30)).toEqual({ time: 30, i: 3 });
    expect(atTime(data, 20)).toEqual({ time: 20, i: 1 });
    expect(atTime(data, 25)).toBeUndefined();
    expect(atTime(data, 99)).toBeUndefined();
  });
});
