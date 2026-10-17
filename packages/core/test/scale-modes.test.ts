import { describe, expect, it } from 'vitest';
import { PriceScale, TimeScale } from '../src/scales';

function priceScale() {
  const p = new PriceScale({ marginTop: 0, marginBottom: 0 });
  p.height = 300;
  return p;
}

describe('PriceScale log mode', () => {
  it('spaces equal ratios equally', () => {
    const p = priceScale();
    p.setMode('log');
    p.fit(10, 1000);
    expect(p.priceToY(1000)).toBeCloseTo(0);
    expect(p.priceToY(100)).toBeCloseTo(150);
    expect(p.priceToY(10)).toBeCloseTo(300);
    expect(p.yToPrice(150)).toBeCloseTo(100);
    expect(p.minPrice).toBeCloseTo(10);
    expect(p.maxPrice).toBeCloseTo(1000);
  });

  it('yTransform maps log10(price)', () => {
    const p = priceScale();
    p.setMode('log');
    p.fit(10, 1000);
    const [s, o] = p.yTransform();
    expect(Math.log10(100) * s + o).toBeCloseTo(150);
  });

  it('keeps the visible price window when switching modes', () => {
    const p = priceScale();
    p.fit(50, 150);
    p.setMode('log');
    expect(p.minPrice).toBeCloseTo(50);
    expect(p.maxPrice).toBeCloseTo(150);
    p.setMode('normal');
    expect(p.min).toBeCloseTo(50);
  });
});

describe('PriceScale percent mode', () => {
  it('converts against the base price', () => {
    const p = priceScale();
    p.setMode('percent');
    p.percentBase = 200;
    expect(p.toPercent(250)).toBeCloseTo(25);
    expect(p.fromPercent(-10)).toBeCloseTo(180);
  });
});

describe('PriceScale smoothing', () => {
  it('snaps on the first fit, then eases towards new targets', () => {
    const p = priceScale();
    p.smooth = true;
    p.fit(0, 100);
    expect(p.max).toBeCloseTo(100);
    p.fit(0, 200);
    expect(p.max).toBeCloseTo(100);
    expect(p.step(16)).toBe(true);
    expect(p.max).toBeGreaterThan(100);
    expect(p.max).toBeLessThan(200);
    for (let i = 0; i < 200 && p.step(16); i++);
    expect(p.max).toBeCloseTo(200);
    expect(p.step(16)).toBe(false);
  });

  it('does not ease in manual mode', () => {
    const p = priceScale();
    p.smooth = true;
    p.fit(0, 100);
    p.pan(10);
    expect(p.step(16)).toBe(false);
  });
});

describe('TimeScale.animateTo', () => {
  function timeScale() {
    const t = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    t.width = 1000;
    t.barCount = 500;
    return t;
  }

  it('reaches the target after the duration and reports completion', () => {
    const t = timeScale();
    t.animateTo({ barSpacing: 20, rightOffset: 5 }, 400);
    expect(t.animating).toBe(true);
    expect(t.step(200)).toBe(true);
    expect(t.barSpacing).toBeGreaterThan(10);
    expect(t.barSpacing).toBeLessThan(20);
    expect(t.step(250)).toBe(false);
    expect(t.barSpacing).toBeCloseTo(20);
    expect(t.rightOffset).toBeCloseTo(5);
  });

  it('applies immediately with zero duration and clamps spacing', () => {
    const t = timeScale();
    t.animateTo({ barSpacing: 500 }, 0);
    expect(t.animating).toBe(false);
    expect(t.barSpacing).toBe(50);
  });

  it('can be cancelled mid-way', () => {
    const t = timeScale();
    t.animateTo({ barSpacing: 40 }, 400);
    t.step(100);
    const mid = t.barSpacing;
    t.cancelAnimation();
    expect(t.step(100)).toBe(false);
    expect(t.barSpacing).toBe(mid);
  });
});
