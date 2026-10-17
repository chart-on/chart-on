import { describe, expect, it } from 'vitest';
import { NumericScale } from '../src/numeric/scale';
import { createPriceFormat } from '../src/util/price-format';

function scale(min: number, max: number, width = 500, invert = false): NumericScale {
  const s = new NumericScale({ invert });
  s.width = width;
  s.setRange(min, max);
  return s;
}

describe('NumericScale', () => {
  it('maps x linearly to pixels and back', () => {
    const s = scale(100, 200);
    expect(s.toPixel(100)).toBe(0);
    expect(s.toPixel(150)).toBe(250);
    expect(s.toPixel(200)).toBe(500);
    expect(s.fromPixel(125)).toBeCloseTo(125);
    // Gaps keep their true width: not index based.
    expect(s.toPixel(110) - s.toPixel(100)).toBeCloseTo(s.toPixel(190) - s.toPixel(180));
  });

  it('puts larger values on the left when inverted', () => {
    const s = scale(0, 10, 500, true);
    expect(s.toPixel(10)).toBe(0);
    expect(s.toPixel(0)).toBe(500);
    expect(s.fromPixel(100)).toBeCloseTo(8);
    const [k, o] = s.transform();
    for (const x of [0, 2.5, 7, 10]) expect(x * k + o).toBeCloseTo(s.toPixel(x));
  });

  it('agrees with its affine transform', () => {
    const s = scale(-3, 42, 731);
    const [k, o] = s.transform();
    for (const x of [-3, 0, 17.25, 42]) expect(x * k + o).toBeCloseTo(s.toPixel(x));
  });

  it('keeps the value under the pointer in place while zooming', () => {
    for (const invert of [false, true]) {
      const s = scale(0, 100, 400, invert);
      const anchorPx = 300;
      const before = s.fromPixel(anchorPx);
      s.zoom(0.5, anchorPx);
      expect(s.span).toBeCloseTo(50);
      expect(s.fromPixel(anchorPx)).toBeCloseTo(before);
      s.zoom(3, anchorPx);
      expect(s.span).toBeCloseTo(150);
      expect(s.fromPixel(anchorPx)).toBeCloseTo(before);
    }
  });

  it('stops zooming in before the span loses float precision', () => {
    const s = scale(1000, 1001);
    for (let i = 0; i < 200; i++) s.zoom(0.1, 250);
    expect(s.span).toBeGreaterThan(0);
    expect(s.max).toBeGreaterThan(s.min);
  });

  it('ignores invalid zoom factors', () => {
    const s = scale(0, 10);
    for (const f of [0, -1, NaN, Infinity]) s.zoom(f, 100);
    expect([s.min, s.max]).toEqual([0, 10]);
  });

  it('pans with the pointer, either way round', () => {
    const s = scale(0, 100, 500);
    s.pan(50); // drag right: content follows, smaller values come in from the left
    expect(s.min).toBeCloseTo(-10);
    expect(s.max).toBeCloseTo(90);
    const inv = scale(0, 100, 500, true);
    inv.pan(50);
    expect(inv.min).toBeCloseTo(10);
    expect(inv.max).toBeCloseTo(110);
  });

  it('fits a range with a margin on both sides', () => {
    const s = new NumericScale();
    s.width = 1000;
    s.fit(0, 90, 0.05);
    expect(s.toPixel(0)).toBeCloseTo(50);
    expect(s.toPixel(90)).toBeCloseTo(950);
    s.fit(5, 5);
    expect(s.min).toBeLessThan(5);
    expect(s.max).toBeGreaterThan(5);
    s.fit(NaN, 1);
    expect(s.min).toBeLessThan(5);
  });

  it('labels round values at least the minimum spacing apart', () => {
    const s = scale(0.3, 9.7, 500);
    const ticks = s.ticks(80);
    expect(ticks.values.length).toBeGreaterThan(2);
    for (const v of ticks.values) {
      expect(v).toBeGreaterThanOrEqual(0.3);
      expect(v).toBeLessThanOrEqual(9.7);
      expect(Math.abs(v / ticks.step - Math.round(v / ticks.step))).toBeLessThan(1e-9);
    }
    const px = ticks.values.map((v) => s.toPixel(v));
    for (let i = 1; i < px.length; i++) expect(px[i]! - px[i - 1]!).toBeGreaterThanOrEqual(80 - 1e-9);
  });

  it('lands ticks on a price format’s tick size', () => {
    const s = scale(100, 101, 1000);
    const ticks = s.ticks(40, createPriceFormat({ type: 'decimal', tickSize: 0.25 }));
    for (const v of ticks.values) expect((v * 4) % 1).toBeCloseTo(0);
  });

  it('labels distinct values when zoomed in to its floor on tiny values', () => {
    const s = scale(1e-6, 2e-6, 500);
    for (let i = 0; i < 100; i++) s.zoom(0.1, 250);
    const ticks = s.ticks(80);
    expect(ticks.values.length).toBeGreaterThan(0);
    expect(new Set(ticks.values).size).toBe(ticks.values.length);
  });

  it('fits ranges near the float limit without overflowing', () => {
    const s = new NumericScale();
    s.width = 500;
    s.fit(-Number.MAX_VALUE, Number.MAX_VALUE, 0.1);
    expect(Number.isFinite(s.min)).toBe(true);
    expect(Number.isFinite(s.max)).toBe(true);
    expect(Number.isFinite(s.span)).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
    s.fit(Infinity, Infinity);
    s.fit(-Infinity, 0);
    expect(Number.isFinite(s.span)).toBe(true);
  });

  it('rejects ranges whose span overflows', () => {
    const s = scale(0, 1);
    s.setRange(-Number.MAX_VALUE, Number.MAX_VALUE);
    expect([s.min, s.max]).toEqual([0, 1]);
  });

  it('zooms out no further than ten times the data', () => {
    const s = scale(0, 100);
    for (let i = 0; i < 50; i++) s.zoom(2, 250, [0, 100]);
    expect(s.span).toBeCloseTo(1000);
    s.zoom(NaN, 250, [0, 100]);
    s.zoom(2, NaN, [0, 100]);
    expect(s.span).toBeCloseTo(1000);
  });

  it('keeps part of the data in view', () => {
    const s = scale(0, 100);
    s.setRange(500, 600);
    s.keepInView([0, 100]);
    // A fifth of the view stays on the data.
    expect(s.min).toBeCloseTo(80);
    s.setRange(-600, -500);
    s.keepInView([0, 100]);
    expect(s.max).toBeCloseTo(20);
    // A view wider than the data keeps all of it.
    s.setRange(-2000, -1000);
    s.keepInView([0, 100]);
    expect(s.max).toBeCloseTo(100);
    s.setRange(10, 20);
    s.keepInView([0, 100]);
    expect([s.min, s.max]).toEqual([10, 20]);
    s.keepInView(null);
    expect([s.min, s.max]).toEqual([10, 20]);
  });

  it('has no ticks without a width', () => {
    expect(scale(0, 1, 0).ticks().values).toEqual([]);
  });
});
