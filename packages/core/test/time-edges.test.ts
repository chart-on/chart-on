import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, defaultChartOptions, type ChartOptions } from '../src/chart';
import { TimeScale, type TimeScaleLimits } from '../src/scales';

function timeScale(limits: Partial<TimeScaleLimits> = {}, barCount = 500) {
  const t = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 6, ...limits });
  t.width = 1000;
  t.barCount = barCount;
  t.clamp();
  return t;
}

/** Index at the plot's left edge. */
const leftEdge = (t: TimeScale) => t.xToIndex(0);

describe('TimeScale.clamp', () => {
  it('keeps bars over minBarCoverage of the plot at either end', () => {
    const t = timeScale();
    t.pan(1e9);
    // 100 bars fit at spacing 10; half of them stay.
    expect(t.rightEdge).toBeCloseTo(50);
    t.pan(-1e9);
    expect(leftEdge(t)).toBeCloseTo(449);

    const most = timeScale({ minBarCoverage: 0.9 });
    most.pan(1e9);
    expect(most.rightEdge).toBeCloseTo(90);
    most.pan(-1e9);
    expect(leftEdge(most)).toBeCloseTo(409);
  });

  it.each([
    ['minimum', 0.5],
    ['default', 10],
    ['maximum', 63],
  ])('covers the same share of the plot at the %s bar spacing', (_, spacing) => {
    const o = defaultChartOptions;
    expect([o.minBarSpacing, o.barSpacing, o.maxBarSpacing]).toContain(spacing);
    const t = new TimeScale({ ...o, barSpacing: spacing });
    t.width = 1000;
    t.barCount = 5000;
    t.clamp();
    expect(t.barSpacing).toBe(spacing);
    // Panned past either end, the end bar sits mid-plot: bars still cover half of the 1000 px plot.
    t.pan(1e9);
    expect(t.indexToX(0)).toBeCloseTo(500);
    t.pan(-1e9);
    expect(t.indexToX(t.barCount - 1)).toBeCloseTo(500);
  });

  it('fixLeftEdge stops the first bar at the left edge', () => {
    const t = timeScale({ fixLeftEdge: true });
    t.pan(1e9);
    expect(leftEdge(t)).toBeCloseTo(-0.5);
    expect(t.visibleRange().from).toBe(0);
    // The right side is unaffected.
    t.pan(-1e9);
    expect(leftEdge(t)).toBeCloseTo(449);
  });

  it('fixRightEdge stops at the newest bar plus the configured rightOffset', () => {
    const t = timeScale({ fixRightEdge: true });
    t.pan(-1e9);
    expect(t.rightOffset).toBeCloseTo(6);
    t.pan(100);
    expect(t.rightOffset).toBeCloseTo(-4);
  });

  it('maxRightOffset limits the empty space, the tighter limit wins with fixRightEdge', () => {
    const t = timeScale({ maxRightOffset: 3 });
    t.pan(-1e9);
    expect(t.rightOffset).toBeCloseTo(3);
    const both = timeScale({ maxRightOffset: 10, fixRightEdge: true });
    both.pan(-1e9);
    expect(both.rightOffset).toBeCloseTo(6);
  });

  it('pan reports when an edge stopped it', () => {
    const t = timeScale({ fixRightEdge: true });
    expect(t.pan(-10)).toBe(false);
    expect(t.pan(10)).toBe(true);
  });

  it('zooming out at an anchor near a fixed left edge keeps the edge', () => {
    const t = timeScale({ fixLeftEdge: true });
    t.pan(1e9);
    t.zoom(0.5, 50);
    expect(t.barSpacing).toBe(5);
    expect(leftEdge(t)).toBeCloseTo(-0.5);
  });

  it('zooming in at an anchor near a fixed left edge keeps the anchored bar', () => {
    const t = timeScale({ fixLeftEdge: true });
    t.pan(1e9);
    const anchored = t.xToIndex(50);
    t.zoom(2, 50);
    expect(t.barSpacing).toBe(20);
    expect(t.xToIndex(50)).toBeCloseTo(anchored);
    expect(leftEdge(t)).toBeGreaterThan(-0.5);
  });

  it('with both edges fixed, zooming out stops once every bar fits', () => {
    const t = timeScale({ fixLeftEdge: true, fixRightEdge: true });
    t.zoom(0.0001, 500);
    expect(t.barSpacing).toBeCloseTo(1000 / (499 + 6 + 0.5));
    expect(leftEdge(t)).toBeCloseTo(-0.5);
    expect(t.rightOffset).toBeCloseTo(6);
    expect(t.visibleRange()).toEqual({ from: 0, to: 499 });
  });

  it('a fixed left edge wins when too few bars fill the plot', () => {
    const t = timeScale({ fixLeftEdge: true, fixRightEdge: true }, 10);
    t.pan(-1e9);
    expect(leftEdge(t)).toBeCloseTo(-0.5);
    // Zoom still works: the spacing is not frozen at its maximum.
    t.zoom(2, 500);
    expect(t.barSpacing).toBe(20);
    t.zoom(0.5, 500);
    expect(t.barSpacing).toBe(10);
    expect(leftEdge(t)).toBeCloseTo(-0.5);
  });

  it('setLimits rejects limits that are not finite and non-negative', () => {
    const t = timeScale();
    const base = { minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 6 };
    for (const key of ['minBarSpacing', 'maxBarSpacing', 'maxRightOffset', 'minBarCoverage'] as const) {
      for (const bad of [NaN, -1, Infinity]) {
        expect(() => t.setLimits({ ...base, [key]: bad })).toThrow(key);
      }
    }
    // A negative right offset is a view ending before the newest bar; it only has to be finite.
    for (const bad of [NaN, Infinity]) expect(() => t.setLimits({ ...base, rightOffset: bad })).toThrow('rightOffset');
    expect(() => t.setLimits({ ...base, rightOffset: -5 })).not.toThrow();
    // A rejected call leaves the limits as they were.
    // Bars cannot cover more than the plot: above 1 every pan would be out of bounds.
    expect(() => t.setLimits({ ...base, minBarCoverage: 1.5 })).toThrow('minBarCoverage');
    expect(() => t.setLimits({ ...base, minBarCoverage: 1 })).not.toThrow();
    expect(() => t.setLimits({ ...base, maxBarSpacing: 80, minBarCoverage: -1 })).toThrow();
    expect(t.maxBarSpacing).toBe(50);
    expect(() => t.setLimits({ ...base, maxRightOffset: undefined, minBarCoverage: 0 })).not.toThrow();
  });

  it('animateTo eases to the clamped target and never crosses the limit', () => {
    const t = timeScale({ fixRightEdge: true });
    t.pan(200);
    t.animateTo({ rightOffset: 100 }, 400);
    for (let i = 0; i < 10; i++) {
      t.step(40);
      expect(t.rightOffset).toBeLessThanOrEqual(6 + 1e-9);
    }
    expect(t.animating).toBe(false);
    expect(t.rightOffset).toBeCloseTo(6);
  });

  it('setWidth with keepRange keeps the visible bars', () => {
    const t = timeScale();
    t.pan(300);
    const before = t.visibleRange();
    t.setWidth(1500, true);
    expect(t.barSpacing).toBeCloseTo(15);
    expect(t.visibleRange()).toEqual(before);
    t.setWidth(1200);
    expect(t.barSpacing).toBeCloseTo(15);
  });

  it('setWidth with keepRange keeps the visible bars across a hide and show', () => {
    const t = timeScale();
    t.pan(300);
    const before = t.visibleRange();
    t.setWidth(0, true);
    t.setWidth(1500, true);
    expect(t.barSpacing).toBeCloseTo(15);
    expect(t.visibleRange()).toEqual(before);
  });
});

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bar = (i: number) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 });

function chart(options: Partial<ChartOptions> = {}, count = 300) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  const series = c.addCandles();
  series.setData(Array.from({ length: count }, (_, i) => bar(i)));
  return { c, series };
}

/** Pretend the container is now `width` px wide and let the chart measure it. */
function resizeTo(c: Chart, width: number): void {
  const root = (c as unknown as { root: { getBoundingClientRect(): unknown } }).root;
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 600, right: width, bottom: 600 });
  c.resize();
}

describe('chart time-scale edge rules', () => {
  it('lockVisibleRangeOnResize leaves getVisibleRange unchanged', () => {
    const { c } = chart({ lockVisibleRangeOnResize: true });
    c.setVisibleTimeRange(100 * 60, 200 * 60, false);
    const before = c.getVisibleRange();
    resizeTo(c, 1200);
    expect(c.getVisibleRange()).toEqual(before);
    resizeTo(c, 500);
    expect(c.getVisibleRange()).toEqual(before);
  });

  it('without the lock a resize keeps the bar spacing', () => {
    // A fixed axis width, so only the container changes the plot width.
    const { c } = chart({ priceAxisWidth: 76 });
    c.setVisibleTimeRange(100 * 60, 200 * 60, false);
    const before = c.getVisibleRange()!;
    const spacing = c.time.barSpacing;
    resizeTo(c, 1200);
    expect(c.time.barSpacing).toBe(spacing);
    expect(c.getVisibleRange()!.from).toBeLessThan(before.from);
  });

  it('applyOptions rejects an invalid limit without changing the options', () => {
    const { c } = chart();
    expect(() => c.applyOptions({ maxRightOffset: -1 })).toThrow('maxRightOffset');
    expect(c.options.maxRightOffset).toBeUndefined();
    expect(c.time.maxOffset()).toBe(Infinity);
  });

  it('applyOptions clamps the current view to new limits', () => {
    const { c } = chart();
    c.time.pan(1e9);
    expect(c.time.xToIndex(0)).toBeLessThan(-0.5);
    c.applyOptions({ fixLeftEdge: true });
    expect(c.time.xToIndex(0)).toBeCloseTo(-0.5);
    c.applyOptions({ fixLeftEdge: false, minBarCoverage: 0.2 });
    c.time.pan(1e9);
    expect(c.time.rightEdge).toBeCloseTo((0.2 * c.time.width) / c.time.barSpacing);
  });

  it("followNewBars 'whenAtEnd' scrolls with new bars only while the newest is on screen", () => {
    const { c, series } = chart();
    series.update(bar(300));
    expect(c.time.rightOffset).toBe(5);
    c.setVisibleTimeRange(100 * 60, 200 * 60, false);
    const before = c.getVisibleRange();
    series.update(bar(301));
    expect(c.getVisibleRange()).toEqual(before);
  });

  it("followNewBars 'never' does not scroll at the end", () => {
    const { c, series } = chart({ followNewBars: 'never' });
    const before = c.getVisibleRange()!;
    series.update(bar(300));
    // The new bar lands in the empty space on the right; nothing moves.
    expect(c.getVisibleRange()).toEqual({ from: before.from, to: 300 * 60 });
    expect(c.time.rightOffset).toBe(4);
  });

  it("followNewBars 'always' scrolls back to the newest bar", () => {
    const { c, series } = chart({ followNewBars: 'always' });
    c.setVisibleTimeRange(100 * 60, 200 * 60, false);
    series.update(bar(300));
    expect(c.time.rightOffset).toBe(5);
    expect(c.getVisibleRange()!.to).toBe(300 * 60);
  });

  it('setVisibleTimeRange shows the requested range when maxRightOffset is below rightOffset', () => {
    const { c } = chart({ maxRightOffset: 0 });
    c.setVisibleTimeRange(200 * 60, 299 * 60, false);
    expect(c.getVisibleRange()).toEqual({ from: 200 * 60, to: 299 * 60 });
    expect(c.time.rightOffset).toBe(0);
  });

  it('fitContent leaves no empty bars on the left when maxRightOffset is below rightOffset', () => {
    const { c } = chart({ maxRightOffset: 0 });
    c.fitContent(false);
    expect(c.time.rightOffset).toBe(0);
    // The same left margin as without a limit: half a bar before the first bar's left side.
    expect(c.time.xToIndex(0)).toBeCloseTo(-1);
  });

  it("followNewBars 'always' also stops inertia and eased zoom", () => {
    const { c, series } = chart({ followNewBars: 'always' });
    c.setVisibleTimeRange(100 * 60, 200 * 60, false);
    const spacing = c.time.barSpacing;
    const motion = c as unknown as { interaction: { velocity: number; zoomTarget: number | null; step(dt: number): boolean } };
    motion.interaction.velocity = 1;
    motion.interaction.zoomTarget = Math.log(spacing * 2);
    series.update(bar(300));
    expect(motion.interaction.step(16)).toBe(false);
    expect(c.time.rightOffset).toBe(5);
    expect(c.time.barSpacing).toBe(spacing);
    expect(c.getVisibleRange()!.to).toBe(300 * 60);
  });

  it('eased zoom stops when a fixed edge holds the spacing', () => {
    const { c } = chart({ fixLeftEdge: true, fixRightEdge: true });
    c.time.zoom(1e-6, 0);
    const spacing = c.time.barSpacing;
    expect(spacing).toBeGreaterThan(c.time.minBarSpacing);
    const motion = c as unknown as { interaction: { zoomTarget: number | null; zoomAnchor: number; step(dt: number): boolean } };
    motion.interaction.zoomTarget = Math.log(c.time.minBarSpacing);
    motion.interaction.zoomAnchor = 100;
    expect(motion.interaction.step(16)).toBe(false);
    expect(motion.interaction.zoomTarget).toBeNull();
    expect(c.time.barSpacing).toBe(spacing);
  });

  it('inertia stops at a fixed edge', () => {
    const { c } = chart({ fixRightEdge: true });
    const interaction = (c as unknown as { interaction: { velocity: number; step(dt: number): boolean } }).interaction;
    interaction.velocity = -1;
    expect(interaction.step(16)).toBe(false);
    expect(interaction.velocity).toBe(0);
    expect(c.time.rightOffset).toBe(5);
  });
});
