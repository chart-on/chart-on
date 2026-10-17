import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { PriceScale } from '../src/scales';

const charts: Chart[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  charts.splice(0).forEach((c) => c.destroy());
});

/** Prices 100..200 over 300 bars. */
function chart(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  frame(c);
  return c;
}

function frame(c: Chart, t = 0): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(t);
}

/** Run `fn` with reduced motion off, so view changes animate. */
function withMotion(fn: () => void): void {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = (query: string) => {
    const mq = original(query);
    return query.includes('reduced-motion') ? Object.assign(Object.create(mq) as MediaQueryList, { matches: false }) : mq;
  };
  try {
    fn();
  } finally {
    globalThis.matchMedia = original;
  }
}

/** Let every ease settle. */
function settle(c: Chart): void {
  for (let i = 1; i <= 200; i++) frame(c, i * 16);
}

const span = (c: Chart) => {
  const r = c.getPriceRange()!;
  return r.to - r.from;
};

describe('setPriceRange / getPriceRange', () => {
  it('shows exactly the range on a linear scale and keeps it', () => {
    const c = chart();
    c.setPriceRange({ from: 120, to: 80 });
    frame(c);
    expect(c.getPriceRange()).toEqual({ from: 80, to: 120 });
    expect(c.isAutoScale()).toBe(false);
    const pane = c.panes[0]!;
    expect(pane.price.priceToY(120)).toBeCloseTo(0);
  });

  it('works in log mode, in prices', () => {
    const c = chart();
    c.setPriceScaleMode('log');
    c.setPriceRange({ from: 10, to: 1000 });
    frame(c);
    const r = c.getPriceRange()!;
    expect(r.from).toBeCloseTo(10);
    expect(r.to).toBeCloseTo(1000);
    const scale = c.panes[0]!.price;
    expect(scale.priceToY(100)).toBeCloseTo(scale.height / 2);
    expect(() => c.setPriceRange({ from: 0, to: 10 })).toThrow(/above zero/);
  });

  it('puts the lowest price at the top of an inverted scale', () => {
    const c = chart();
    c.setPriceScaleOptions({ invert: true });
    c.setPriceRange({ from: 50, to: 250 });
    frame(c);
    const scale = c.panes[0]!.price;
    expect(scale.priceToY(50)).toBeCloseTo(0);
    expect(scale.priceToY(250)).toBeCloseTo(scale.height);
    expect(c.getPriceRange()).toEqual({ from: 50, to: 250 });
  });

  it('rejects empty or non-finite ranges and answers null for a missing pane', () => {
    const c = chart();
    expect(() => c.setPriceRange({ from: 5, to: 5 })).toThrow();
    expect(() => c.setPriceRange({ from: Number.NaN, to: 5 })).toThrow();
    expect(c.getPriceRange(3)).toBeNull();
    expect(c.getPriceRange(0, 'nope')).toBeNull();
  });

  it('eases to an animated range, and user input wins', () => {
    const s = new PriceScale({ marginTop: 0, marginBottom: 0 });
    s.height = 100;
    s.min = 0;
    s.max = 100;
    s.setRange(200, 300, true);
    expect(s.step(16)).toBe(true);
    expect(s.min).toBeGreaterThan(0);
    expect(s.min).toBeLessThan(200);
    for (let i = 0; i < 200 && s.step(16); i++);
    expect([s.min, s.max]).toEqual([200, 300]);
    s.setRange(0, 10, true);
    s.zoom(2);
    expect(s.step(16)).toBe(false);
  });
});

describe('fixedRange', () => {
  it('autoscale shows the fixed range instead of the data', () => {
    const c = chart();
    c.setPriceScaleOptions({ fixedRange: { min: 0, max: 1000 } });
    frame(c);
    expect(c.getPriceRange()).toEqual({ from: 0, to: 1000 });
    expect(c.getPriceScaleOptions()!.fixedRange).toEqual({ min: 0, max: 1000 });
    // A manual zoom leaves it; autoscale brings it back.
    c.panes[0]!.price.zoom(0.5);
    frame(c);
    expect(span(c)).toBeCloseTo(500);
    c.setAutoScale(true);
    frame(c);
    expect(c.getPriceRange()).toEqual({ from: 0, to: 1000 });
    c.setPriceScaleOptions({ fixedRange: null });
    // Back to fitting the data, eased.
    frame(c);
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(1000);
    expect(c.getPriceRange()!.to).toBeLessThan(1000);
  });

  it('rejects an empty fixed range and reports it in the scale event', () => {
    const c = chart();
    expect(() => c.setPriceScaleOptions({ fixedRange: { min: 5, max: 5 } })).toThrow(/fixedRange/);
    const events = vi.fn();
    c.on('scale:change', events);
    c.setPriceScaleOptions({ fixedRange: { min: 0, max: 100 } });
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ fixedRange: { min: 0, max: 100 }, lockPriceToBarRatio: false }));
  });
});

describe('lockPriceToBarRatio', () => {
  it('scales prices with a time zoom so angles stay put', () => {
    const c = chart();
    c.setPriceScaleOptions({ lockPriceToBarRatio: true });
    frame(c);
    const ratio = c.getPriceScaleOptions()!.priceToBarRatio!;
    expect(ratio).toBeGreaterThan(0);
    expect(c.isAutoScale()).toBe(false);
    const before = span(c);
    const centre = (c.getPriceRange()!.from + c.getPriceRange()!.to) / 2;
    c.time.zoom(2, c.time.width / 2);
    frame(c);
    expect(span(c)).toBeCloseTo(before / 2);
    expect((c.getPriceRange()!.from + c.getPriceRange()!.to) / 2).toBeCloseTo(centre);
    expect(c.getPriceScaleOptions()!.priceToBarRatio).toBeCloseTo(ratio);
  });

  it('restores a saved ratio, follows a price-axis zoom, and unlocks with autoscale', () => {
    const c = chart();
    c.setPriceScaleOptions({ lockPriceToBarRatio: true, priceToBarRatio: 2 });
    frame(c);
    const scale = c.panes[0]!.price;
    expect(span(c)).toBeCloseTo((2 * scale.height) / c.time.barSpacing);
    // Scaling the axis by hand sets a new ratio rather than fighting it.
    scale.zoom(2);
    frame(c);
    expect(c.getPriceScaleOptions()!.priceToBarRatio).toBeCloseTo(4);
    c.setAutoScale(true);
    expect(c.getPriceScaleOptions()).toMatchObject({ lockPriceToBarRatio: false, priceToBarRatio: null, autoScale: true });
    expect(() => c.setPriceScaleOptions({ priceToBarRatio: -1 })).toThrow(/priceToBarRatio/);
  });
});

describe('review fixes', () => {
  it('drops an eased range when autoscale comes back on', () => {
    const fitted = chart({ smoothScale: false }).getPriceRange()!;
    const c = chart({ smoothScale: false });
    withMotion(() => c.setPriceRange({ from: 1000, to: 2000 }, 0, 'right', true));
    frame(c, 16);
    expect(c.getPriceRange()!.to).toBeLessThan(2000);
    c.setAutoScale(true);
    frame(c);
    expect(c.getPriceRange()!.from).toBeCloseTo(fitted.from);
    expect(c.getPriceRange()!.to).toBeCloseTo(fitted.to);
    expect(c.panes[0]!.price.step(16)).toBe(false);
  });

  it('setPriceScaleMode with the same mode during an ease fits the data again', () => {
    const fitted = chart({ smoothScale: false }).getPriceRange()!;
    const c = chart({ smoothScale: false });
    withMotion(() => c.setPriceRange({ from: 1000, to: 2000 }, 0, 'right', true));
    frame(c, 16);
    c.setPriceScaleMode('normal');
    settle(c);
    expect(c.isAutoScale()).toBe(true);
    expect(c.getPriceRange()!.from).toBeCloseTo(fitted.from);
    expect(c.getPriceRange()!.to).toBeCloseTo(fitted.to);
  });

  it('throws RangeError for a bad price range', () => {
    const c = chart();
    expect(() => c.setPriceRange({ from: 5, to: 5 })).toThrow(RangeError);
    c.setPriceScaleMode('log');
    expect(() => c.setPriceRange({ from: -1, to: 5 })).toThrow(RangeError);
  });

  it('locks at the current ratio when priceToBarRatio is null', () => {
    const c = chart();
    c.setPriceScaleOptions({ lockPriceToBarRatio: true, priceToBarRatio: null });
    frame(c);
    expect(c.getPriceScaleOptions()).toMatchObject({ lockPriceToBarRatio: true, autoScale: false });
    expect(c.getPriceScaleOptions()!.priceToBarRatio).toBeGreaterThan(0);
  });

  it('round-trips the options before the first frame', () => {
    // Not laid out yet: the container has no size.
    const container = fakeContainer();
    const rect = vi
      .spyOn(Object.getPrototypeOf(container) as { getBoundingClientRect(): unknown }, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
    const c = new Chart(container);
    charts.push(c);
    c.setPriceScaleOptions({ lockPriceToBarRatio: true });
    const opts = c.getPriceScaleOptions()!;
    expect(opts.priceToBarRatio).toBeNull();
    c.setPriceScaleOptions(opts);
    rect.mockRestore();
    c.resize();
    c.addCandles().setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
    frame(c);
    expect(c.getPriceScaleOptions()!.lockPriceToBarRatio).toBe(true);
    expect(c.getPriceScaleOptions()!.priceToBarRatio).toBeGreaterThan(0);
  });

  it('rejects a fixed range at or below zero on a log scale', () => {
    const c = chart();
    c.setPriceScaleMode('log');
    expect(() => c.setPriceScaleOptions({ fixedRange: { min: 0, max: 100 } })).toThrow(RangeError);
    expect(() => c.setPriceScaleOptions({ fixedRange: { min: 1, max: 100 } })).not.toThrow();
    const d = chart();
    d.setPriceScaleOptions({ fixedRange: { min: 0, max: 100 } });
    expect(() => d.setPriceScaleOptions({ mode: 'log', fixedRange: { min: 0, max: 100 } })).toThrow(RangeError);
    expect(d.getPriceScaleMode()).toBe('normal');
    // Prices in percent mode too.
    d.setPriceScaleOptions({ mode: 'percent', fixedRange: { min: 120, max: 180 } });
    frame(d);
    expect(d.getPriceRange()).toEqual({ from: 120, to: 180 });
  });

  it('ignores a non-positive fixed range while log, and restores it after', () => {
    const fitted = chart({ smoothScale: false });
    fitted.setPriceScaleMode('log');
    frame(fitted);
    const c = chart({ smoothScale: false });
    c.setPriceScaleOptions({ fixedRange: { min: 0, max: 100 } });
    frame(c);
    expect(() => c.setPriceScaleMode('log')).not.toThrow();
    frame(c);
    expect(c.getPriceScaleMode()).toBe('log');
    expect(c.getPriceRange()!.from).toBeCloseTo(fitted.getPriceRange()!.from);
    expect(c.getPriceRange()!.to).toBeCloseTo(fitted.getPriceRange()!.to);
    expect(c.getPriceScaleOptions()!.fixedRange).toEqual({ min: 0, max: 100 });
    c.setPriceScaleMode('normal');
    frame(c);
    expect(c.getPriceRange()).toEqual({ from: 0, to: 100 });
  });

  it('keeps compare lines on the axis of a manual percent scale', () => {
    const c = chart({ smoothScale: false });
    const pane = c.panes[0]!;
    c.addLine({ priceScale: 'cmp' }).setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, value: 10 + (i % 7) })));
    const cmp = pane.scale('cmp');
    cmp.side = 'none';
    cmp.link = pane.price;
    c.setPriceScaleMode('percent');
    frame(c);
    c.setPriceRange({ from: 120, to: 180 });
    frame(c);
    const root = pane.price;
    // +10% and +30% sit at the same height on both scales.
    expect(cmp.priceToY(cmp.fromPercent(10))).toBeCloseTo(root.priceToY(root.fromPercent(10)));
    expect(cmp.priceToY(cmp.fromPercent(30))).toBeCloseTo(root.priceToY(root.fromPercent(30)));
  });

  it('keeps a ratio lock through time-range setters; resetView unlocks', () => {
    const c = chart();
    c.setPriceScaleOptions({ lockPriceToBarRatio: true });
    frame(c);
    const ratio = c.getPriceScaleOptions()!.priceToBarRatio!;
    c.setVisibleTimeRange(0, 100 * 60, false);
    frame(c);
    c.setVisibleIndexRange(10, 200, false);
    frame(c);
    c.fitContent(false);
    frame(c);
    expect(c.getPriceScaleOptions()).toMatchObject({ lockPriceToBarRatio: true, autoScale: false });
    expect(c.getPriceScaleOptions()!.priceToBarRatio).toBeCloseTo(ratio);
    expect(span(c)).toBeCloseTo((ratio * c.panes[0]!.price.height) / c.time.barSpacing);
    c.resetView(false);
    expect(c.getPriceScaleOptions()).toMatchObject({ lockPriceToBarRatio: false, autoScale: true });
  });
});
