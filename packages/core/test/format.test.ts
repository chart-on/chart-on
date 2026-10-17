import { describe, expect, it } from 'vitest';
import {
  TickWeight,
  computeTickWeights,
  decimalsForStep,
  formatCompact,
  niceStep,
  priceTicks,
  selectTimeTicks,
} from '../src/util/format';

describe('price ticks', () => {
  it('rounds steps to 1/2/2.5/5', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3.1)).toBe(5);
    expect(niceStep(730)).toBe(1000);
  });

  it('chooses decimals for steps', () => {
    expect(decimalsForStep(1000)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
    expect(decimalsForStep(0.0025)).toBe(4);
  });

  it('generates ticks inside range', () => {
    const t = priceTicks(81_234, 89_900, 400);
    expect(t.values[0]).toBeGreaterThanOrEqual(81_234);
    expect(t.values.at(-1)).toBeLessThanOrEqual(89_900);
    expect(t.step).toBe(1000);
  });

  it('keeps steps finer than 1e-12 apart instead of merging them', () => {
    // The time chart's price axis (tiny prices) and the numeric chart's x axis (zoomed in) both get here.
    const t = priceTicks(3e-14, 9.7e-13, 400);
    expect(t.values.length).toBeGreaterThan(3);
    expect(new Set(t.values).size).toBe(t.values.length);
    expect(t.decimals).toBeGreaterThan(12);
    for (let i = 1; i < t.values.length; i++) expect(t.values[i]! - t.values[i - 1]!).toBeCloseTo(t.step, 20);
  });

  it('labels a step below the values’ float resolution once per value', () => {
    const t = priceTicks(1, 1 + 4e-16, 400);
    expect(new Set(t.values).size).toBe(t.values.length);
  });

  it('still rounds away float noise', () => {
    expect(priceTicks(0, 1, 400).values).toContain(0.3);
  });
});

describe('formatCompact', () => {
  it('formats with suffixes', () => {
    expect(formatCompact(834_415.85)).toBe('834.42K');
    expect(formatCompact(-6_670_000_000)).toBe('-6.67B');
    expect(formatCompact(12)).toBe('12');
    expect(formatCompact(0.5)).toBe('0.5');
  });
});

describe('time ticks', () => {
  const day = 86400;
  // 2026-01-01 .. 2026-04-10 daily.
  const start = Date.UTC(2026, 0, 1) / 1000;
  const times = Array.from({ length: 100 }, (_, i) => start + i * day);
  const weights = computeTickWeights(times);

  it('marks month boundaries heavier than days', () => {
    const feb1 = times.findIndex((t) => new Date(t * 1000).getUTCMonth() === 1);
    expect(weights[feb1]).toBe(TickWeight.Month);
    expect(weights[feb1 + 1]).toBe(TickWeight.Day);
    expect(weights[0]).toBe(0);
  });

  it('prefers months and keeps minimum spacing', () => {
    const ticks = selectTimeTicks(weights, 0, 99, 4, 72);
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i]!.index - ticks[i - 1]!.index) * 4).toBeGreaterThanOrEqual(72);
    }
    expect(ticks.filter((t) => t.weight === TickWeight.Month).length).toBe(3);
  });
});
