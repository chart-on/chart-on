import { describe, expect, it } from 'vitest';
import { heikinAshi } from '../src/series';
import { formatCountdown, logPriceTicks } from '../src/util/format';

describe('heikinAshi', () => {
  it('averages OHLC and chains the open from the previous bar', () => {
    const [a, b] = heikinAshi([
      { time: 1, open: 10, high: 14, low: 8, close: 12 },
      { time: 2, open: 12, high: 16, low: 11, close: 15 },
    ]);
    expect(a!.close).toBeCloseTo(11);
    expect(a!.open).toBeCloseTo(11);
    expect(b!.open).toBeCloseTo((a!.open + a!.close) / 2);
    expect(b!.close).toBeCloseTo(13.5);
    expect(b!.high).toBe(16);
    expect(b!.low).toBe(11);
  });
});

describe('logPriceTicks', () => {
  it('returns ascending round values inside the range with minimum spacing', () => {
    const height = 400;
    const ticks = logPriceTicks(100, 100000, height);
    expect(ticks.length).toBeGreaterThan(3);
    const span = Math.log10(100000) - Math.log10(100);
    const y = (p: number) => height * (1 - (Math.log10(p) - 2) / span);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(100);
      expect(ticks[i]).toBeLessThanOrEqual(100000);
      if (i > 0) {
        expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
        expect(y(ticks[i - 1]!) - y(ticks[i]!)).toBeGreaterThanOrEqual(40);
      }
      // Two significant digits at most.
      expect(Number(ticks[i]!.toPrecision(2))).toBe(ticks[i]);
    }
  });

  it('handles invalid input', () => {
    expect(logPriceTicks(0, 10, 100)).toEqual([]);
    expect(logPriceTicks(10, 5, 100)).toEqual([]);
  });
});

describe('formatCountdown', () => {
  it('formats by magnitude', () => {
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(3 * 3600 + 61)).toBe('03:01:01');
    expect(formatCountdown(2 * 86400 + 5 * 3600)).toBe('2d 5h');
    expect(formatCountdown(-3)).toBe('00:00');
  });
});
