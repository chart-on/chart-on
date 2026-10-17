import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import { opaque } from '../src/series';
import { darkTheme } from '../src/theme';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));

/** Columns alternating 2 and -2, based at the `level` input (declared base 1). */
const def = (plot: Partial<PlotDef> = {}): IndicatorDef => ({
  id: 'test/histogram-base',
  name: 'Histogram base',
  placement: 'pane',
  inputs: [
    { id: 'level', type: 'number', default: 0 },
    { id: 'tint', type: 'color', default: '' },
  ],
  plots: [{ id: 'h', type: 'histogram', base: 1, baseInput: 'level', ...plot } as PlotDef],
  compute: (src) => ({ h: Float64Array.from({ length: src.length }, (_, i) => (i % 2 ? -2 : 2)) }),
});

function setup(d: IndicatorDef = def()) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(d);
  return { c, indicator, series: indicator.series! };
}

const batchBase = (series: unknown) => (series as { batches: Map<string, { base: number }> }).batches.get('h')!.base;
const legendColor = (series: { legend(i: number): { parts: { color?: string }[] } }, i: number) => series.legend(i).parts[0]!.color;

describe('histogram base input', () => {
  it('columns, colours and autoscale use the input instead of base', () => {
    const { series } = setup();
    expect(batchBase(series)).toBe(0);
    expect(legendColor(series, 0)).toBe(opaque(darkTheme.up));
    expect(legendColor(series, 1)).toBe(opaque(darkTheme.down));
    expect(series.priceRange(0, 19)).toEqual([-2, 2]);
  });

  it('follows the input when it changes', () => {
    const { indicator, series } = setup();
    indicator.applyInputs({ level: 5 });
    expect(batchBase(series)).toBe(5);
    // Both values are now below the base.
    expect(legendColor(series, 0)).toBe(opaque(darkTheme.down));
    expect(series.priceRange(0, 19)).toEqual([-2, 5]);
    // A column spans from the base to its value.
    const y = series.scale.priceToY(4);
    expect(series.hits(0, y)).toBe(true);
    indicator.applyInputs({ level: -3 });
    expect(batchBase(series)).toBe(-3);
    expect(legendColor(series, 1)).toBe(opaque(darkTheme.up));
  });

  it('without an input the declared base applies', () => {
    const { series } = setup(def({ baseInput: undefined }));
    expect(batchBase(series)).toBe(1);
    expect(series.priceRange(0, 19)).toEqual([-2, 2]);
  });

  it('rejects an unknown or non-number input', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(() => c.indicators.add(def({ baseInput: 'missing' }))).toThrow(/plot "h" names unknown number input "missing"/);
    expect(() => c.indicators.add(def({ baseInput: 'tint' }))).toThrow(/unknown number input "tint"/);
  });
});
