import { describe, expect, it } from 'vitest';
import { Timeline, detectInterval, lowerBound } from '../src/timeline';

const day = 86400;

describe('Timeline', () => {
  const tl = new Timeline();
  tl.set([0, day, 2 * day, 5 * day, 6 * day]);

  it('detects the smallest recent interval', () => {
    expect(tl.interval).toBe(day);
    expect(detectInterval([])).toBe(60);
  });

  it('finds exact indices', () => {
    expect(tl.indexOf(5 * day)).toBe(3);
    expect(tl.indexOf(4 * day)).toBe(-1);
  });

  it('interpolates inside gaps and extrapolates outside', () => {
    expect(tl.indexFromTime(3.5 * day)).toBeCloseTo(2.5);
    expect(tl.indexFromTime(8 * day)).toBeCloseTo(6);
    expect(tl.indexFromTime(-2 * day)).toBeCloseTo(-2);
  });

  it('round-trips times beyond the data', () => {
    expect(tl.timeFromIndex(6)).toBe(8 * day);
    expect(tl.timeFromIndex(-1)).toBe(-day);
    expect(tl.indexFromTime(tl.timeFromIndex(9))).toBe(9);
  });

  it('lowerBound', () => {
    expect(lowerBound([1, 3, 5], 4)).toBe(2);
    expect(lowerBound([1, 3, 5], 0)).toBe(0);
    expect(lowerBound([1, 3, 5], 9)).toBe(3);
  });
});
