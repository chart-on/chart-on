import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { validateIndicatorDef } from '../src/indicators/indicator';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

/** Closes 1000..1299, far outside the oscillator's declared range. */
function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 1000 + i, high: 1001 + i, low: 999 + i, close: 1000 + i })));
  return c;
}

function frame(c: Chart, t = 0): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(t);
}

/** A pane oscillator that plots the close as is, so its values ignore the declared range. */
function oscillator(overrides: Partial<IndicatorDef> = {}): IndicatorDef {
  return {
    id: 'test/osc',
    name: 'Osc',
    placement: 'pane',
    fixedRange: { min: 0, max: 100 },
    inputs: [],
    plots: [{ id: 'value', type: 'line' }],
    compute: (src) => ({ value: Float64Array.from(src.close) }),
    ...overrides,
  };
}

describe('IndicatorDef.fixedRange', () => {
  it('validates the range and the placement', () => {
    expect(() => validateIndicatorDef(oscillator())).not.toThrow();
    expect(() => validateIndicatorDef(oscillator({ fixedRange: undefined }))).not.toThrow();
    expect(() => validateIndicatorDef(oscillator({ fixedRange: { min: 100, max: 0 } }))).toThrow(/fixedRange/);
    expect(() => validateIndicatorDef(oscillator({ fixedRange: { min: 5, max: 5 } }))).toThrow(/fixedRange/);
    expect(() => validateIndicatorDef(oscillator({ fixedRange: { min: 0, max: Infinity } }))).toThrow(/fixedRange/);
    expect(() => validateIndicatorDef(oscillator({ fixedRange: null as never }))).toThrow(/fixedRange/);
    expect(() => validateIndicatorDef(oscillator({ placement: 'overlay' }))).toThrow(/placement 'pane'/);
    expect(() => chart().indicators.register(oscillator({ fixedRange: { min: 1, max: 0 } }))).toThrow(/fixedRange/);
  });

  it("shows the declared range on the indicator's pane whatever the data", () => {
    const c = chart();
    c.indicators.add(oscillator());
    frame(c);
    expect(c.getPriceScaleOptions(1)!.fixedRange).toEqual({ min: 0, max: 100 });
    expect(c.getPriceRange(1)).toEqual({ from: 0, to: 100 });
    // The main pane still fits its own data.
    expect(c.getPriceScaleOptions(0)!.fixedRange).toBeNull();
  });

  it('applies the range to the scale the indicator is added on', () => {
    const c = chart();
    c.indicators.add(oscillator(), {}, { priceScale: 'left' });
    frame(c);
    expect(c.getPriceScaleOptions(1, 'left')!.fixedRange).toEqual({ min: 0, max: 100 });
  });

  it('can still be changed through the price range API', () => {
    const c = chart();
    c.indicators.add(oscillator());
    frame(c);
    c.setPriceRange({ from: 20, to: 80 }, 1);
    frame(c);
    expect(c.getPriceRange(1)).toEqual({ from: 20, to: 80 });
    // Autoscale returns to the declared range.
    c.setAutoScale(true, 1);
    frame(c);
    expect(c.getPriceRange(1)).toEqual({ from: 0, to: 100 });
    // Clearing it fits the data again (autoscale eases there).
    c.setPriceScaleOptions({ fixedRange: null }, 1);
    for (let i = 1; i <= 200; i++) frame(c, i * 16);
    expect(c.getPriceRange(1)!.from).toBeGreaterThan(900);
  });

  it('leaves panes without a declared range to fit their data', () => {
    const c = chart();
    c.indicators.add(oscillator({ id: 'test/free', fixedRange: undefined }));
    frame(c);
    expect(c.getPriceScaleOptions(1)!.fixedRange).toBeNull();
    expect(c.getPriceRange(1)!.from).toBeGreaterThan(900);
  });
});
