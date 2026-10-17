import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 200 }, (_, i) => ({
  time: 1_000 + i * 60,
  open: 100 + i,
  high: 102 + i,
  low: 98 + i,
  close: 101 + i,
}));

function chart(): Chart {
  const c = new Chart(fakeContainer(), { animateViewChanges: false });
  charts.push(c);
  c.addCandles().setData(bars);
  frame(c);
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** Chart-root points at bar centres across the main pane, so a nearest-bar time maps back exactly. */
function samplePoints(c: Chart, index = 0): { x: number; y: number }[] {
  const pane = c.paneBounds()[index]!;
  const range = c.getVisibleIndexRange()!;
  const points: { x: number; y: number }[] = [];
  for (let i = Math.ceil(range.from) + 1; i < Math.floor(range.to); i += 7) {
    for (const f of [0.1, 0.5, 0.9]) points.push({ x: c.indexToX(i)!, y: pane.top + pane.height * f });
  }
  return points;
}

/** Run real frames (pane animations, easing) for about `ms` of chart time. */
function run(c: Chart, ms = 1000): void {
  const step = (c as unknown as { frame(now: number): void }).frame;
  for (let t = 16; t <= ms; t += 16) step(t);
}

function expectRoundTrip(c: Chart, pane = 0): void {
  const points = samplePoints(c, pane);
  expect(points.length).toBeGreaterThan(5);
  for (const { x, y } of points) {
    const at = c.pointAt(x, y)!;
    expect(at.pane).toBe(pane);
    const back = c.coordinateFor(at.time, at.price, at.pane)!;
    expect(Math.abs(back.x - x)).toBeLessThan(0.5);
    expect(Math.abs(back.y! - y)).toBeLessThan(0.5);
  }
}

describe('coordinate conversion', () => {
  it('round-trips pointAt on a linear scale', () => {
    expectRoundTrip(chart());
  });

  it('round-trips pointAt on a log scale', () => {
    const c = chart();
    c.setPriceScaleMode('log');
    frame(c);
    expectRoundTrip(c);
  });

  it('round-trips pointAt with a left axis', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(bars.map((b) => ({ time: b.time, value: b.close * 10 })));
    frame(c);
    expect(c.plotRect.x).toBeGreaterThan(0);
    expect(c.priceAxisSpace('left')).toBe(c.plotRect.x);
    expectRoundTrip(c);
  });

  it('round-trips pointAt on an inverted scale', () => {
    const c = chart();
    c.setPriceScaleOptions({ invert: true });
    frame(c);
    expect(c.priceToY(150)!).toBeGreaterThan(c.priceToY(140)!);
    expectRoundTrip(c);
  });

  it('round-trips pointAt in indexed mode', () => {
    const c = chart();
    c.setPriceScaleMode('indexed');
    frame(c);
    expectRoundTrip(c);
  });

  it('round-trips pointAt in a second pane', () => {
    const c = chart();
    const pane = c.addPane();
    c.addLine({}, pane).setData(bars.map((b) => ({ time: b.time, value: b.close / 100 })));
    frame(c);
    expect(c.paneBounds()[1]!.top).toBeGreaterThan(0);
    expectRoundTrip(c, 1);
  });

  it('gives null for prices at or below zero on a log scale', () => {
    const c = chart();
    c.setPriceScaleMode('log');
    frame(c);
    expect(c.priceToY(0)).toBeNull();
    expect(c.priceToY(-5)).toBeNull();
    expect(c.coordinateFor(bars[10]!.time, 0)).toBeNull();
    expect(c.coordinateFor(bars[10]!.time, -1)).toBeNull();
    expect(c.priceToY(150)).not.toBeNull();
    expect(c.coordinateFor(bars[10]!.time)).not.toBeNull();
  });

  it('round-trips fractional indices and times', () => {
    const c = chart();
    for (const i of [-3.25, 0, 17.5, 150.75, 230]) expect(c.xToIndex(c.indexToX(i)!)).toBeCloseTo(i, 9);
    expect(c.timeToX(bars[40]!.time)).toBeCloseTo(c.indexToX(40)!, 9);
    expect(c.xToTime(c.indexToX(40)! + c.barSpacing * 0.4)).toBe(bars[40]!.time);
    // Past the newest bar times are extrapolated by the bar interval.
    expect(c.timeToX(bars[199]!.time + 120)).toBeCloseTo(c.indexToX(201)!, 9);
  });

  it('honours percent mode and pane offsets in priceToY', () => {
    const c = chart();
    const pane = c.addPane();
    c.addLine({}, pane).setData(bars.map((b) => ({ time: b.time, value: b.close / 100 })));
    c.setPriceScaleMode('percent', 1);
    frame(c);
    const bounds = c.paneBounds();
    expect(bounds[1]!.top).toBeGreaterThan(0);
    const scale = c.panes[1]!.price;
    expect(scale.mode).toBe('percent');
    const price = 2.5;
    const y = c.priceToY(price, 1)!;
    expect(y).toBeCloseTo(bounds[1]!.top + scale.priceToY(price), 9);
    expect(y).toBeGreaterThan(bounds[1]!.top);
    expect(c.yToPrice(y)).toBeCloseTo(price, 9);
    expect(c.yToPrice(y, 1)).toBeCloseTo(price, 9);
    expect(c.pointAt(c.indexToX(150)!, y)!.price).toBeCloseTo(price, 9);
    // The percent label at that height is the price's change against the base.
    expect(scale.toPercent(c.yToPrice(y, 1)!)).toBeCloseTo(scale.toPercent(price), 9);
  });

  it('reads a named scale without creating one', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(bars.map((b) => ({ time: b.time, value: b.close * 10 })));
    frame(c);
    const left = c.panes[0]!.scale('left');
    const y = c.priceToY(1500, 0, 'left')!;
    expect(y).toBeCloseTo(left.priceToY(1500), 9);
    expect(c.yToPrice(y, 0, 'left')).toBeCloseTo(1500, 9);
    expect(c.priceToY(1500, 0, 'nope')).toBeNull();
    expect(c.panes[0]!.scales.some((s) => s.id === 'nope')).toBe(false);
  });

  it('returns null for a missing pane, a missing scale, bad input or no data, never throwing', () => {
    const c = chart();
    expect(c.priceToY(100, 5)).toBeNull();
    expect(c.yToPrice(100, 5)).toBeNull();
    expect(c.coordinateFor(bars[0]!.time, 100, 5)).toBeNull();
    expect(c.priceToY(Number.NaN)).toBeNull();
    expect(c.timeToX(Number.NaN)).toBeNull();
    expect(c.coordinateFor(bars[0]!.time)).toEqual({ x: c.indexToX(0), y: null });

    const empty = new Chart(fakeContainer());
    charts.push(empty);
    frame(empty);
    expect(empty.timeToX(1_000)).toBeNull();
    expect(empty.indexToX(0)).toBeNull();
    expect(empty.xToTime(10)).toBeNull();
    expect(empty.coordinateFor(1_000, 1)).toBeNull();
    expect(empty.getVisibleIndexRange()).toBeNull();
  });

  it('returns null before layout', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
    c.resize();
    c.addCandles().setData(bars);
    expect(c.timeToX(bars[0]!.time)).toBeNull();
    expect(c.priceToY(100)).toBeNull();
    expect(c.yToPrice(10)).toBeNull();
    expect(c.coordinateFor(bars[0]!.time, 100)).toBeNull();
    expect(c.paneBounds()).toEqual([]);
    expect(c.getVisibleIndexRange()).toBeNull();
    expect(() => c.setVisibleIndexRange(0, 10)).not.toThrow();
    expect(() => c.scrollToTime(bars[0]!.time)).not.toThrow();
  });

  it('gives null for a pane hidden by another one being maximized', () => {
    const c = chart();
    const pane = c.addPane();
    c.addLine({}, pane).setData(bars.map((b) => ({ time: b.time, value: 1 })));
    c.maximizePane(c.panes[0]!);
    frame(c);
    expect(c.paneBounds()[1]!.height).toBe(0);
    expect(c.priceToY(1, 1)).toBeNull();
    expect(c.coordinateFor(bars[0]!.time, 1, 1)).toBeNull();
  });
});

describe('view geometry', () => {
  it('reports pane bounds, the plot rect and axis widths in chart-root px', () => {
    const c = chart();
    c.addPane();
    frame(c);
    const bounds = c.paneBounds();
    expect(bounds.map((b) => b.pane)).toEqual([0, 1]);
    expect(bounds[0]!.top).toBe(0);
    expect(bounds[1]!.top).toBe(bounds[0]!.height);
    expect(bounds[1]!.top + bounds[1]!.height).toBe(c.plotRect.height);
    expect(c.plotRect).toEqual({ x: 0, y: 0, width: c.plotWidth, height: c.plotHeight });
    expect(c.priceAxisSpace('left')).toBe(0);
    expect(c.priceAxisSpace('right')).toBe(800 - c.plotWidth);
  });

  it('sets the bar spacing around an anchor and clamps it', () => {
    const c = chart();
    const anchorX = c.indexToX(150)!;
    c.setBarSpacing(20, anchorX);
    expect(c.barSpacing).toBe(20);
    expect(c.indexToX(150)).toBeCloseTo(anchorX, 6);
    c.setBarSpacing(1e6);
    expect(c.barSpacing).toBe(c.options.maxBarSpacing);
    expect(() => c.setBarSpacing(0)).toThrow(RangeError);
  });

  it('round-trips a fractional visible index range', () => {
    const c = chart();
    c.setVisibleIndexRange(40.5, 120.25, false);
    const r = c.getVisibleIndexRange()!;
    expect(r.from).toBeCloseTo(40.5, 9);
    expect(r.to).toBeCloseTo(120.25, 9);
    expect(c.barSpacing).toBeCloseTo(c.plotWidth / 79.75, 9);
    expect(() => c.setVisibleIndexRange(10, 10)).toThrow(RangeError);
  });

  it('turns autoscale back on like setVisibleTimeRange', () => {
    const c = chart();
    c.setAutoScale(false);
    c.setVisibleIndexRange(40, 120, false);
    expect(c.isAutoScale()).toBe(true);
  });

  it('clamps index ranges through the time scale rules', () => {
    const c = chart();
    // Far past the data: the time scale keeps a couple of bars on screen.
    c.setVisibleIndexRange(1000, 1100, false);
    const r = c.getVisibleIndexRange()!;
    expect(r.from).toBeLessThan(199);
  });

  it('centres a time with scrollToTime', () => {
    const c = chart();
    c.scrollToTime(bars[100]!.time, false);
    expect(c.timeToX(bars[100]!.time)).toBeCloseTo(c.plotRect.x + c.plotWidth / 2, 6);
  });

  it('fires view:change once per change in anything coordinates depend on', () => {
    const c = chart();
    const listener = vi.fn();
    c.on('view:change', listener);
    frame(c);
    frame(c);
    expect(listener).toHaveBeenCalledTimes(0);
    c.setBarSpacing(12);
    frame(c);
    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0]![0];
    const range = c.getVisibleIndexRange()!;
    expect(payload).toEqual({ barSpacing: 12, fromIndex: range.from, toIndex: range.to, rightOffset: c.time.rightOffset, ...c.getVisibleRange()! });
    c.setPriceScaleMode('log');
    frame(c);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('redraws a change made by a view:change listener', () => {
    const c = chart();
    const spacings: number[] = [];
    c.on('view:change', ({ barSpacing }) => {
      spacings.push(barSpacing);
      if (spacings.length === 1) c.setBarSpacing(20);
    });
    c.setBarSpacing(12);
    frame(c);
    // A later frame, without anyone invalidating, picks up the listener's change.
    (c as unknown as { render(dt: number): boolean }).render(0);
    expect(spacings).toEqual([12, 20]);
  });

  it('fires view:change on resize', () => {
    const c = chart();
    const listener = vi.fn();
    c.on('view:change', listener);
    c.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }) as DOMRect;
    c.resize();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires view:change when a pane collapses', () => {
    const c = chart();
    const pane = c.addPane();
    c.addLine({}, pane).setData(bars.map((b) => ({ time: b.time, value: 1 })));
    run(c);
    const listener = vi.fn();
    c.on('view:change', listener);
    const before = c.paneBounds()[1]!.height;
    c.setPaneCollapsed(pane, true);
    run(c);
    expect(c.paneBounds()[1]!.height).toBeLessThan(before);
    expect(listener).toHaveBeenCalled();
  });

  it('fires view:change when a pane is removed', () => {
    const c = chart();
    const pane = c.addPane();
    run(c);
    const listener = vi.fn();
    c.on('view:change', listener);
    frame(c);
    expect(listener).not.toHaveBeenCalled();
    c.removePane(pane);
    run(c);
    expect(listener).toHaveBeenCalled();
  });

  it('reports a viewport state change once per change of the visible times', () => {
    const c = chart();
    const listener = vi.fn();
    c.on('state:change', ({ reason }) => reason === 'viewport' && listener());
    frame(c);
    expect(listener).not.toHaveBeenCalled();
    c.setVisibleIndexRange(40, 120, false);
    frame(c);
    frame(c);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires view:change when only the newest bar time moves', () => {
    const c = new Chart(fakeContainer(), { animateViewChanges: false });
    charts.push(c);
    const candles = c.addCandles();
    candles.setData(bars);
    frame(c);
    const listener = vi.fn();
    c.on('view:change', listener);
    const shifted = bars.map((b, i) => (i === bars.length - 1 ? { ...b, time: b.time + 600 } : b));
    candles.setData(shifted);
    frame(c);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('view calls and the edge limits', () => {
  const last = bars.length - 1;

  function limited(options: Partial<ChartOptions>): Chart {
    const c = new Chart(fakeContainer(), { animateViewChanges: false, ...options });
    charts.push(c);
    c.addCandles().setData(bars);
    frame(c);
    return c;
  }

  /** Each view call pushed as far past the ends as it goes, with the range it left. */
  function pushed(c: Chart): Record<string, { from: number; to: number }> {
    const out: Record<string, { from: number; to: number }> = {};
    const record = (name: string) => {
      frame(c);
      out[name] = c.getVisibleIndexRange()!;
    };
    c.setVisibleIndexRange(-150, 20, false);
    record('index range past the start');
    c.setVisibleIndexRange(last - 20, last + 150, false);
    record('index range past the end');
    c.scrollToTime(bars[0]!.time - 100 * 60, false);
    record('scroll before the start');
    c.scrollToTime(bars[last]!.time + 100 * 60, false);
    record('scroll after the end');
    c.scrollToTime(bars[0]!.time, false);
    c.setBarSpacing(0.01, c.plotWidth);
    record('zoom out at the right');
    c.scrollToTime(bars[last]!.time, false);
    c.setBarSpacing(0.01, 0);
    record('zoom out at the left');
    return out;
  }

  it('keeps the first bar in view with fixLeftEdge', () => {
    for (const [name, r] of Object.entries(pushed(limited({ fixLeftEdge: true })))) {
      expect(r.from, name).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    }
  });

  it('stops at the right offset with fixRightEdge', () => {
    const c = limited({ fixRightEdge: true, rightOffset: 4 });
    for (const [name, r] of Object.entries(pushed(c))) expect(r.to, name).toBeLessThanOrEqual(last + 4 + 1e-6);
  });

  it('stops at maxRightOffset', () => {
    const c = limited({ maxRightOffset: 2 });
    for (const [name, r] of Object.entries(pushed(c))) expect(r.to, name).toBeLessThanOrEqual(last + 2 + 1e-6);
  });

  it('fits every bar but no more when both edges are fixed', () => {
    const c = limited({ fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 });
    for (const [name, r] of Object.entries(pushed(c))) {
      expect(r.from, name).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(r.to, name).toBeLessThanOrEqual(last + 1e-6);
    }
    // Zoomed all the way out, the whole history fills the plot.
    c.setBarSpacing(0.01);
    frame(c);
    const r = c.getVisibleIndexRange()!;
    expect(r.from).toBeCloseTo(-0.5, 6);
    expect(r.to).toBeCloseTo(last, 6);
  });
});
