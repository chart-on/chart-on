import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const W = 76; // a fixed priceAxisWidth

function chart() {
  const c = new Chart(fakeContainer(), { priceAxisWidth: W });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i })));
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const values = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, value: 1000 + i * 10 }));

describe('chart with several price scales', () => {
  it('makes room for a left axis and gives it back when the series hides', () => {
    const c = chart();
    frame(c);
    expect(c.plotLeft).toBe(0);
    const left = c.addLine({ priceScale: 'left' });
    left.setData(values);
    frame(c);
    expect(c.plotLeft).toBe(W);
    expect(c.plotWidth).toBe(800 - 2 * W);
    left.setVisible(false);
    frame(c);
    expect(c.plotLeft).toBe(0);
    expect(c.plotWidth).toBe(800 - W);
  });

  it('finds the scale under the pointer in each axis column', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    const pane = c.addPane();
    c.addLine({}, pane).setData(values);
    frame(c);
    const main = c.panes[0]!;
    const y0 = main.top + main.height / 2;
    expect(c.regionAt(-10, y0)).toEqual({ kind: 'priceAxis', pane: 0, scale: main.scale('left') });
    expect(c.regionAt(c.plotWidth + 10, y0)).toEqual({ kind: 'priceAxis', pane: 0, scale: main.price });
    expect(c.regionAt(10, y0)).toEqual({ kind: 'plot', pane: 0 });
    // The second pane has no left axis: its left column is empty.
    expect(c.regionAt(-10, pane.top + pane.height / 2)).toEqual({ kind: 'priceAxis', pane: 1, scale: null });
  });

  it('keeps pointAt chart-root-relative', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    frame(c);
    const pane = c.panes[0]!;
    const x = c.plotLeft + c.time.indexToX(20);
    expect(c.pointAt(x, pane.top + pane.height / 2)?.index).toBe(20);
    expect(c.pointAt(c.plotLeft - 5, pane.top + 10)).toBeNull();
  });

  it('fits each scale to its own series', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    frame(c);
    const pane = c.panes[0]!;
    expect(pane.price.maxPrice).toBeLessThan(200);
    expect(pane.scale('left').minPrice).toBeGreaterThan(900);
  });

  it('reads prices on the primary scale when only a left series shows', () => {
    const c = chart();
    c.main!.setVisible(false);
    c.addLine({ priceScale: 'left' }).setData(values);
    frame(c);
    const pane = c.panes[0]!;
    expect(pane.primary).toBe(pane.scale('left'));
    const at = c.pointAt(c.plotLeft + 10, pane.top + pane.height / 2);
    expect(at!.price).toBeGreaterThan(900);
  });

  it('validates scale options and reports changes per scale', () => {
    const c = chart();
    const events = vi.fn();
    c.on('scale:change', events);
    c.setPriceScaleMode('indexed', 0, 'left');
    expect(events).toHaveBeenCalledWith({ pane: 0, scale: 'left', mode: 'indexed', autoScale: true, invert: false, noPositiveData: false, fixedRange: null, lockPriceToBarRatio: false });
    expect(c.getPriceScaleOptions(0, 'left')).toMatchObject({ side: 'left', mode: 'indexed' });
    expect(() => c.setPriceScaleOptions({ side: 'top' as never })).toThrow();
    expect(() => c.setPriceScaleOptions({ marginTop: Number.NaN })).toThrow();
    expect(() => c.setPriceScaleOptions({ marginTop: 0.6, marginBottom: 0.5 })).toThrow();
    c.setPriceScaleOptions({ invert: true }, 0, 'right');
    expect(c.getPriceScaleOptions()!.invert).toBe(true);
  });

  it('labels a series on an indexed scale with its indexed value', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    c.setPriceScaleMode('indexed', 0, 'left');
    const pills = vi.spyOn(c as unknown as { axisPill(ctx: unknown, text: string): void }, 'axisPill');
    frame(c);
    const texts = pills.mock.calls.map((call) => call[1]);
    // The first visible value is the base, so the last value (1490 vs. 1000) reads 149.00, not the price.
    const first = c.panes[0]!.scale('left').percentBase;
    expect(texts).toContain(((1490 / first) * 100).toFixed(2));
    expect(texts).not.toContain('1490');
  });

  it('keeps named scales sized with their pane', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    frame(c);
    const pane = c.panes[0]!;
    expect(pane.scale('left').height).toBe(pane.height);
    c.addPane();
    expect(pane.scale('left').height).toBe(pane.height);
  });

  it('resets autoscale on every scale', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(values);
    c.setAutoScale(false, 0, 'left');
    c.setAutoScale(false);
    c.resetView();
    expect(c.isAutoScale(0, 'left')).toBe(true);
    expect(c.isAutoScale()).toBe(true);
  });
});

describe('automatic pane margins', () => {
  /** A pane's main scale margins in css px, after a frame. */
  const px = (c: Chart, pane = 0): [number, number] => {
    frame(c);
    const p = c.panes[pane]!;
    const { marginTop, marginBottom, autoMargins } = p.price;
    return [(marginTop ?? autoMargins[0]) * p.height, (marginBottom ?? autoMargins[1]) * p.height];
  };
  // One legend row: the 6 px edge gap and the 13 px legend font at 1.25 line height (16) plus the 2 px row gap.
  const row = 18;
  // Half a one-line price label: the 12 px axis font and 4 px padding twice.
  const halfLabel = (12 + 8) / 2;

  it('keep the legend block above the data and half a price label below it', () => {
    const c = chart();
    const [top, bottom] = px(c);
    expect(top).toBeCloseTo(6 + row, 9);
    expect(bottom).toBeCloseTo(halfLabel, 9);
    // Automatic margins are left out when read, so copying the settings does not freeze them.
    expect(c.getPriceScaleOptions()).toMatchObject({ marginTop: undefined, marginBottom: undefined });
    // A second legend row adds its height; a bottom legend moves the block down.
    c.addLine().setData(values);
    expect(px(c)[0]).toBeCloseTo(6 + 2 * row, 9);
    c.applyOptions({ legend: { position: 'bottom-start' } });
    const [t, b] = px(c);
    expect(t).toBeCloseTo(halfLabel, 9);
    expect(b).toBeCloseTo(6 + 2 * row, 9);
  });

  it('give the legend up to half the pane and the other edge what is left', () => {
    const c = chart();
    const pane = c.addPane({ stretch: 1 });
    for (let i = 0; i < 40; i++) c.addLine({}, pane).setData(values);
    const [top, bottom] = px(c, 1);
    expect(top).toBeCloseTo(pane.height / 2, 9);
    expect(bottom).toBe(0);
  });

  it('keep margins that were set, and take them back with null', () => {
    const c = chart();
    c.setPriceScaleOptions({ marginTop: 0.3 });
    expect(px(c)[0]).toBeCloseTo(0.3 * c.panes[0]!.height, 9);
    expect(c.getPriceScaleOptions()).toMatchObject({ marginTop: 0.3, marginBottom: undefined });
    expect([c.panes[0]!.price.marginTop, c.panes[0]!.price.marginBottom]).toEqual([0.3, null]);
    c.setPriceScaleOptions({ marginTop: null });
    expect(px(c)[0]).toBeCloseTo(6 + row, 9);
    expect(c.getPriceScaleOptions()!.marginTop).toBeUndefined();
  });

  it('give a scale centred on a price the larger margin on both sides', () => {
    const c = chart();
    c.setPriceScaleOptions({ autoscaleRule: { centerOn: 100 } });
    const [top, bottom] = px(c);
    expect(top).toBeCloseTo(6 + row, 9);
    expect(bottom).toBeCloseTo(top, 9);
  });
});
