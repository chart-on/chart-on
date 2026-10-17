import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

// The fake canvas measures every character as 6 px; the chart is 800 px wide.
const CHAR = 6;
const INSET = 8;

const series = (price: (i: number) => number): Bar[] =>
  Array.from({ length: 50 }, (_, i) => {
    const p = price(i);
    return { time: i * 60, open: p, high: p * 1.01, low: p * 0.99, close: p };
  });

function chart(options: ChartOptionsPatch = {}, price: (i: number) => number = (i) => 100 + i): Chart {
  const c = new Chart(fakeContainer(), { priceAxisWidth: 'auto', timezone: 'UTC', ...options });
  charts.push(c);
  c.addCandles({ animate: false }).setData(series(price));
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** The widest label the right axis column shows now, in characters. */
function widestRightLabel(c: Chart): number {
  const internals = c as unknown as { paneTicks: Map<unknown, { labels: string[] }> };
  const ticks = [...internals.paneTicks.values()].flatMap((t) => t.labels);
  const scale = c.panes[0]!.price;
  const edges = [c.formatAxis(0, scale.minPrice), c.formatAxis(0, scale.maxPrice)];
  const last = c.main!.lastValues().map((v) => v.text);
  return Math.max(...[...ticks, ...edges, ...last].map((t) => t.length));
}

describe('auto price axis width', () => {
  it('fits the widest label: inset, text and padding', () => {
    const c = chart({}, (i) => 12_345_678 + i);
    frame(c);
    const width = c.priceAxisSpace('right');
    expect(width).toBe(Math.ceil(INSET + widestRightLabel(c) * CHAR + 8));
    expect(c.plotWidth).toBe(800 - width);
  });

  it('is narrower for low prices than for long ones, and never below minWidth', () => {
    const small = chart({}, () => 1);
    const big = chart({}, (i) => 98_765_432 + i);
    frame(small);
    frame(big);
    expect(small.priceAxisSpace('right')).toBe(Math.max(48, Math.ceil(INSET + widestRightLabel(small) * CHAR + 8)));
    expect(big.priceAxisSpace('right')).toBeGreaterThan(small.priceAxisSpace('right'));
  });

  it('follows padding, minWidth and maxWidth, merged by applyOptions', () => {
    const c = chart({}, (i) => 12_345_678 + i);
    frame(c);
    const fitted = c.priceAxisSpace('right');
    c.applyOptions({ priceAxis: { padding: 20 } });
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(fitted + 12);
    c.applyOptions({ priceAxis: { maxWidth: 60 } });
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(60);
    expect(c.options.priceAxis).toMatchObject({ padding: 20, minWidth: 48, maxWidth: 60 });
    c.applyOptions({ priceAxis: { maxWidth: undefined, minWidth: 300 } });
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(300);
  });

  it('grows at once but shrinks only by more than a font size', () => {
    const c = chart({}, () => 1234);
    frame(c);
    const start = c.priceAxisSpace('right');
    c.main!.setData(series(() => 1_234_567_890));
    frame(c);
    const grown = c.priceAxisSpace('right');
    expect(grown).toBeGreaterThan(start);
    // One character narrower (6 px) is within the 12 px font size: no change.
    c.main!.setData(series(() => 123_456_789));
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(grown);
    // Back to short prices: shrinks.
    c.main!.setData(series(() => 1234));
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(start);
  });

  it('relays out in the same frame, so the time scale never lags the new width', () => {
    const c = chart({}, () => 10);
    frame(c);
    c.main!.setData(series(() => 9_876_543_210));
    frame(c);
    const time = (c as unknown as { time: { width: number } }).time;
    expect(time.width).toBe(c.plotWidth);
    expect(c.plotWidth).toBe(800 - c.priceAxisSpace('right'));
  });

  it('sizes each side on its own', () => {
    const c = new Chart(fakeContainer(), { priceAxisWidth: 'auto', timezone: 'UTC' });
    charts.push(c);
    c.addCandles({ animate: false, priceScale: 'left' }).setData(series((i) => 12_345_678 + i));
    c.addLine().setData(series(() => 5).map((b) => ({ time: b.time, value: b.close })));
    frame(c);
    const left = c.priceAxisSpace('left');
    const right = c.priceAxisSpace('right');
    expect(left).toBeGreaterThan(right);
    expect(c.plotLeft).toBe(left);
    expect(c.plotWidth).toBe(800 - left - right);
    // Hit testing uses the side's width: the whole left column is that scale's axis.
    const region = c.regionAt(-left + 1, 50);
    expect(region).toMatchObject({ kind: 'priceAxis', scale: c.panes[0]!.scale('left') });
  });

  it('counts the countdown under the last price', () => {
    const now = Math.floor(Date.now() / 1000);
    const c = new Chart(fakeContainer(), { priceAxisWidth: 'auto', timezone: 'UTC', features: { countdown: true } });
    charts.push(c);
    // An hourly bar that opened a minute ago is still forming.
    c.addCandles({ animate: false }).setData(Array.from({ length: 20 }, (_, i) => ({ time: now - 60 - (19 - i) * 3600, open: 1, high: 1, low: 1, close: 1 })));
    frame(c);
    const countdown = (c as unknown as { countdownText(): string | undefined }).countdownText();
    expect(countdown).toBeDefined();
    expect(c.priceAxisSpace('right')).toBeGreaterThanOrEqual(Math.ceil(INSET + countdown!.length * CHAR + 8));
  });

  it('measures fractional price formats by their labels', () => {
    const c = chart({}, (i) => 101 + i / 32);
    c.main!.applyOptions({ priceFormat: { type: 'fraction', denominator: 32 } });
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(Math.max(48, Math.ceil(INSET + widestRightLabel(c) * CHAR + 8)));
  });
});

describe('fixed price axis width', () => {
  it('keeps the number, and switching to auto and back works at runtime', () => {
    const c = chart({ priceAxisWidth: 90 }, (i) => 12_345_678 + i);
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(90);
    c.applyOptions({ priceAxisWidth: 'auto' });
    frame(c);
    expect(c.priceAxisSpace('right')).not.toBe(90);
    c.applyOptions({ priceAxisWidth: 70 });
    frame(c);
    expect(c.priceAxisSpace('right')).toBe(70);
  });

  it('is auto by default', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(series((i) => 12_345_678 + i));
    frame(c);
    expect(c.options.priceAxisWidth).toBe('auto');
    expect(c.priceAxisSpace('right')).toBe(Math.max(48, Math.ceil(INSET + widestRightLabel(c) * CHAR + 8)));
  });
});

describe('auto width and the view', () => {
  const view = (c: Chart) => (c as unknown as { time: { barSpacing: number; rightOffset: number } }).time;

  it('keeps the bar spacing when the first frame sizes the axis', () => {
    const c = chart({ barSpacing: 8 });
    frame(c);
    expect(c.priceAxisSpace('right')).not.toBe(76);
    expect(view(c).barSpacing).toBe(8);
  });

  it('keeps a fit made before the first frame', () => {
    const c = chart({}, (i) => 12_345_678 + i);
    c.fitContent(false);
    const before = c.plotWidth;
    frame(c);
    const t = view(c);
    expect(c.plotWidth).not.toBe(before);
    expect(t.barSpacing * (c.main!.data.length + t.rightOffset)).toBeCloseTo(c.plotWidth, 6);
  });
});
