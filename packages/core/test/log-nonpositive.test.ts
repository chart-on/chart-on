import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { PrimitiveRegistry, type AttachedPrimitive } from '../src/primitives';
import { PriceScale, RangeBuilder } from '../src/scales';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart(): Chart {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const N = 50;
const bars = Array.from({ length: N }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }));
const points = (f: (i: number) => number) => Array.from({ length: N }, (_, i) => ({ time: i * 60, value: f(i) }));

/** Record every fit on a log scale, so tests can check no non-positive bound reaches it. */
function spyLogFits(): [number, number][] {
  const fits: [number, number][] = [];
  const fit = PriceScale.prototype.fit;
  vi.spyOn(PriceScale.prototype, 'fit').mockImplementation(function (this: PriceScale, lo: number, hi: number) {
    if (this.isLog) fits.push([lo, hi]);
    fit.call(this, lo, hi);
  });
  return fits;
}

describe('RangeBuilder', () => {
  it('skips values at or below zero when positive only', () => {
    const r = new RangeBuilder(true);
    [-5, 0, Number.NaN, 3, 7].forEach((v) => r.add(v));
    expect(r.range).toEqual([3, 7]);
    const all = new RangeBuilder(false);
    [-5, 0, Number.NaN, 3].forEach((v) => all.add(v));
    expect(all.range).toEqual([-5, 3]);
    expect(new RangeBuilder(true).range).toBeNull();
  });

  it('starts over on reset, so one builder can be reused', () => {
    const r = new RangeBuilder(false);
    r.add(-5);
    expect(r.reset(true).range).toBeNull();
    r.add(-1);
    r.add(2);
    expect(r.range).toEqual([2, 2]);
  });

  it('leaves non-positive primitive bounds out of a log merge', () => {
    const entries = [{ primitive: { priceRange: () => [-10, 40] } }] as unknown as AttachedPrimitive[];
    expect(new PrimitiveRegistry(() => {}).mergeRange(entries, 0, 1, [20, 30], true)).toEqual([20, 40]);
    expect(new PrimitiveRegistry(() => {}).mergeRange(entries, 0, 1, null, false)).toEqual([-10, 40]);
  });
});

describe('PriceScale log mode with non-positive bounds', () => {
  function logScale(): PriceScale {
    const p = new PriceScale({ marginTop: 0, marginBottom: 0 });
    p.height = 300;
    p.setMode('log');
    return p;
  }

  it('never fits down to the log floor', () => {
    const p = logScale();
    p.fit(0, 1000);
    expect(p.min).toBeGreaterThan(2);
    expect(p.maxPrice).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the current range when nothing is above zero', () => {
    const p = logScale();
    p.fit(10, 1000);
    p.fit(-50, -1);
    expect(p.minPrice).toBeCloseTo(10);
    expect(p.maxPrice).toBeCloseTo(1000);
  });

  it('switches an all-negative window to a finite default range', () => {
    const p = new PriceScale({ marginTop: 0, marginBottom: 0 });
    p.height = 300;
    p.fit(-100, -10);
    p.setMode('log');
    expect([p.min, p.max]).toEqual([0, 1]);
    expect(Number.isFinite(p.priceToY(5))).toBe(true);
  });
});

describe('chart autoscale on a log scale', () => {
  it('keeps candles in a sensible range next to a zero-based histogram', () => {
    const fits = spyLogFits();
    const c = chart();
    c.addCandles().setData(bars);
    c.addHistogram().setData(points((i) => 60 + i));
    c.setPriceScaleMode('log');
    frame(c);
    const scale = c.panes[0]!.price;
    expect(scale.isLog).toBe(true);
    expect(scale.minPrice).toBeGreaterThan(50);
    expect(scale.maxPrice).toBeLessThan(200);
    expect(fits.length).toBeGreaterThan(0);
    for (const [lo] of fits) expect(lo).toBeGreaterThan(0);
  });

  it('fits a line that crosses zero to its positive values', () => {
    const fits = spyLogFits();
    const c = chart();
    c.addCandles().setData(bars);
    c.addLine({ priceScale: 'left' }).setData(points((i) => (i - 25) * 4)); // -100 … 96, including 0
    c.setPriceScaleMode('log', 0, 'left');
    frame(c);
    const scale = c.panes[0]!.scale('left');
    expect(scale.min).toBeGreaterThan(0); // above log10(1), nowhere near -12
    expect(scale.maxPrice).toBeGreaterThanOrEqual(96);
    for (const [lo] of fits) expect(lo).toBeGreaterThanOrEqual(4);
  });

  it('reports all-negative data and keeps a finite range', () => {
    const fits = spyLogFits();
    const c = chart();
    c.addCandles().setData(bars);
    c.addLine({ priceScale: 'left' }).setData(points((i) => -10 - i));
    frame(c);
    const events = vi.fn();
    c.on('scale:change', events);
    c.setPriceScaleMode('log', 0, 'left');
    frame(c);
    const scale = c.panes[0]!.scale('left');
    expect(fits).toEqual([]);
    expect(scale.noPositiveData).toBe(true);
    expect([scale.min, scale.max]).toEqual([0, 1]);
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ pane: 0, scale: 'left', mode: 'log', noPositiveData: true }));
    c.setPriceScaleMode('normal', 0, 'left');
    frame(c);
    expect(scale.noPositiveData).toBe(false);
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'normal', noPositiveData: false }));
  });

  it('does not flag an empty log scale', () => {
    const c = chart();
    c.setPriceScaleMode('log');
    frame(c);
    expect(c.panes[0]!.price.noPositiveData).toBe(false);
  });
});
