import { describe, expect, it } from 'vitest';
import { PriceScale, TimeScale } from '../src/scales';

function timeScale() {
  const t = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  t.width = 1000;
  t.barCount = 500;
  return t;
}

describe('TimeScale', () => {
  it('places the last bar at the right edge with zero offset', () => {
    const t = timeScale();
    expect(t.indexToX(499)).toBe(1000);
    expect(t.xToIndex(t.indexToX(123.5))).toBeCloseTo(123.5);
  });

  it('eases the right offset in whole steps of a quantum, ending on the target', () => {
    const t = timeScale();
    t.rightOffset = 5;
    const quantum = 1 / 20; // one device pixel at 10 px bars and a pixel ratio of 2
    t.animateTo({ rightOffset: 4 }, 500, quantum);
    const seen = new Set<number>();
    while (t.step(16)) {
      const steps = (t.rightOffset - 4) / quantum;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
      seen.add(t.rightOffset);
    }
    expect(t.rightOffset).toBe(4);
    // Moving, not jumping straight to the end.
    expect(seen.size).toBeGreaterThan(5);
  });

  it('xTransform matches indexToX', () => {
    const t = timeScale();
    t.rightOffset = 7.25;
    const [scale, offset] = t.xTransform();
    expect(42 * scale + offset).toBeCloseTo(t.indexToX(42));
  });

  it('zoom keeps the anchored bar fixed on screen', () => {
    const t = timeScale();
    const before = t.xToIndex(400);
    t.zoom(2, 400);
    expect(t.barSpacing).toBe(20);
    expect(t.xToIndex(400)).toBeCloseTo(before);
  });

  it('clamps bar spacing', () => {
    const t = timeScale();
    t.zoom(100, 500);
    expect(t.barSpacing).toBe(50);
    t.zoom(0.0001, 500);
    expect(t.barSpacing).toBe(1);
  });

  it('pan right reveals older bars and is clamped at the data start', () => {
    const t = timeScale();
    t.pan(100);
    expect(t.rightOffset).toBeCloseTo(-10);
    t.pan(1e9);
    expect(t.rightEdge).toBeGreaterThanOrEqual(2);
  });

  it('visibleRange is clamped to data', () => {
    const t = timeScale();
    const r = t.visibleRange();
    expect(r.to).toBe(499);
    expect(r.from).toBe(399);
  });
});

describe('PriceScale', () => {
  it('maps prices to y and back', () => {
    const p = new PriceScale({ marginTop: 0, marginBottom: 0 });
    p.height = 200;
    p.fit(100, 200);
    expect(p.priceToY(200)).toBeCloseTo(0);
    expect(p.priceToY(100)).toBeCloseTo(200);
    expect(p.yToPrice(100)).toBeCloseTo(150);
    const [s, o] = p.yTransform();
    expect(150 * s + o).toBeCloseTo(100);
  });

  it('applies margins and handles flat ranges', () => {
    const p = new PriceScale({ marginTop: 0.1, marginBottom: 0.1 });
    p.height = 100;
    p.fit(0, 80);
    expect(p.min).toBeCloseTo(-10);
    expect(p.max).toBeCloseTo(90);
    p.fit(50, 50);
    expect(p.max).toBeGreaterThan(p.min);
  });

  it('manual zoom and pan disable autoscale', () => {
    const p = new PriceScale({ marginTop: 0, marginBottom: 0 });
    p.height = 100;
    p.fit(0, 100);
    p.zoom(2, 50);
    expect(p.autoScale).toBe(false);
    expect(p.min).toBeCloseTo(-50);
    expect(p.max).toBeCloseTo(150);
    p.fit(0, 10);
    expect(p.max).toBeCloseTo(150);
    p.pan(10);
    expect(p.min).toBeCloseTo(-30);
  });
});
