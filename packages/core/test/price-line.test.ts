import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ time: i * 60, open: i, high: i + 2, low: i - 1, close: i + 1 }));

describe('series price line', () => {
  it('is on for the main candle series and off for others by default', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(50));
    const line = c.addLine();
    line.setData(bars(50).map((b) => ({ time: b.time, value: b.close })));
    const to = c.time.visibleRange().to;
    expect(main.priceLine(to)).toMatchObject({ value: 50, lineWidth: 1, lineStyle: 'dotted', source: 'last' });
    expect(line.priceLine(to)).toBeNull();
    line.applyOptions({ priceLine: { color: '#ff0000', lineStyle: 'dashed', lineWidth: 2 } });
    expect(line.priceLine(to)).toEqual({ value: 50, color: '#ff0000', lineWidth: 2, lineStyle: 'dashed', source: 'last' });
    main.applyOptions({ priceLine: false });
    expect(main.priceLine(to)).toBeNull();
  });

  it('is independent of the last-value label when set explicitly', () => {
    const c = chart();
    const main = c.addCandles({ lastValueLabel: false, priceLine: true });
    main.setData(bars(10));
    expect(main.lastValue()).toBeNull();
    expect(main.priceLine(9)?.value).toBe(10);
  });

  it('keeps the default line off when the main last-value label is off', () => {
    const c = chart();
    const main = c.addCandles({ lastValueLabel: false });
    main.setData(bars(10));
    expect(main.priceLine(9)).toBeNull();
  });

  it("follows the view while panning with source 'lastVisible'", () => {
    const c = chart();
    const main = c.addCandles({ priceLine: { source: 'lastVisible' } });
    main.setData(bars(500));
    const at = () => main.priceLine(c.time.visibleRange().to)?.value;
    expect(at()).toBe(500);
    c.time.pan(c.time.barSpacing * 100); // drag content right: older bars come into view
    const visibleTo = c.time.visibleRange().to;
    expect(visibleTo).toBeLessThan(499);
    expect(at()).toBe(bars(500)[visibleTo]!.close);
    c.time.pan(c.time.barSpacing * 50);
    expect(at()).toBe(bars(500)[c.time.visibleRange().to]!.close);
  });

  it("uses the newest point at or before the view's edge for other series", () => {
    const c = chart();
    c.addCandles().setData(bars(100));
    const sparse = c.addHistogram({ priceLine: { source: 'lastVisible' } });
    sparse.setData(bars(100).filter((_, i) => i % 10 === 0).map((b) => ({ time: b.time, value: b.close })));
    expect(sparse.priceLine(55)?.value).toBe(51);
    expect(sparse.priceLine(-1)).toBeNull();
  });
});

describe('candle wicks and borders', () => {
  const rgba = (series: unknown, key: string) => (series as Record<string, unknown>)[key];

  it('hides wicks and borders without touching the colours', () => {
    const c = chart();
    const candles = c.addCandles({ upBorderColor: '#ffffff', downBorderColor: '#000000' });
    expect(rgba(candles, 'borderRgba')).toEqual([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]);
    candles.applyOptions({ wicks: false, borders: false });
    expect(rgba(candles, 'wickRgba')).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(rgba(candles, 'borderRgba')).toEqual([null, null]);
    candles.applyOptions({ wicks: true, borders: true });
    expect((rgba(candles, 'wickRgba') as number[][])[0]![3]).toBe(255);
  });
});

describe('offscreenLastPrice', () => {
  function pills(mode: 'hollow' | 'hidden' | undefined) {
    const c = chart();
    const main = c.addCandles(mode ? { offscreenLastPrice: mode } : {});
    // Flat prices keep the newest close inside the autoscaled range after panning.
    main.setData(bars(500).map((b) => ({ ...b, open: 10, high: 12, low: 8, close: 11 })));
    const calls: unknown[][] = [];
    const internals = c as unknown as { axisPill(...args: unknown[]): void; render(t: number): void };
    const original = internals.axisPill.bind(c);
    internals.axisPill = (...args: unknown[]) => {
      calls.push(args);
      original(...args);
    };
    c.time.pan(c.time.barSpacing * 100);
    c.invalidate();
    internals.render(0);
    return calls.filter((args) => String(args[1]).startsWith('11'));
  }

  it('keeps the label as is by default, outlines it with hollow and leaves it out with hidden', () => {
    expect(pills(undefined)).toHaveLength(1);
    const hollow = pills('hollow');
    expect(hollow).toHaveLength(1);
    expect(hollow[0]![8]).toBeTruthy();
    expect(pills('hidden')).toHaveLength(0);
  });
});
