import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import { opaque } from '../src/series';
import { darkTheme } from '../src/theme';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));

/** A line `l` at i (NaN on the last bar) and a histogram `h` alternating 2 and -2. */
const def = (line: Partial<PlotDef> = {}, histogram: Partial<PlotDef> = {}): IndicatorDef => ({
  id: 'test/plot-price-line',
  name: 'Plot price line',
  placement: 'pane',
  inputs: [],
  plots: [
    { id: 'l', type: 'line', color: '#3a7bd5', ...line } as PlotDef,
    { id: 'h', type: 'histogram', ...histogram } as PlotDef,
  ],
  compute: (src) => ({
    l: Float64Array.from({ length: src.length }, (_, i) => (i === src.length - 1 ? NaN : i)),
    h: Float64Array.from({ length: src.length }, (_, i) => (i % 2 ? -2 : 2)),
  }),
});

function setup(d: IndicatorDef) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(d);
  return { c, indicator, series: indicator.series! };
}

describe('indicator plot price line', () => {
  it('is off by default', () => {
    const { series } = setup(def());
    expect(series.priceLines(19)).toEqual([]);
  });

  it('draws one line per plot at its newest value, in the plot colour', () => {
    const { series } = setup(def({ priceLine: true }, { priceLine: { lineStyle: 'dashed', lineWidth: 2 } }));
    expect(series.priceLines(19)).toEqual([
      // The line's last output is NaN: the newest value before it.
      { value: 18, color: opaque('#3a7bd5'), lineWidth: 1, lineStyle: 'dotted', source: 'last' },
      { value: -2, color: opaque(darkTheme.down), lineWidth: 2, lineStyle: 'dashed', source: 'last' },
    ]);
  });

  it('follows the view with lastVisible and takes its own colour', () => {
    const { series } = setup(def({ priceLine: { source: 'lastVisible', color: '#ff0000' } }));
    expect(series.priceLines(10.6)).toEqual([{ value: 10, color: '#ff0000', lineWidth: 1, lineStyle: 'dotted', source: 'lastVisible' }]);
    expect(series.priceLines(-1)).toEqual([]);
  });

  it('goes with the plot or the indicator hidden', () => {
    const { indicator, series } = setup(def({ priceLine: true }, { priceLine: true }));
    indicator.setPlotStyle('l', { visible: false });
    expect(series.priceLines(19).map((l) => l.value)).toEqual([-2]);
    indicator.setVisible(false);
    expect(series.priceLines(19)).toEqual([]);
  });

  it('is drawn by the chart in its price-line pass', () => {
    const { c, series } = setup(def({ priceLine: true }));
    const lines = vi.spyOn(series, 'priceLines');
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(lines).toHaveBeenCalled();
    expect(lines.mock.results[0]!.value).toHaveLength(1);
  });
});
