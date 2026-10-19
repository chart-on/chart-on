import { createChart, indicators, sourceAt, sourceOf, type IndicatorDef, type SourceKey } from '@chart-on/core';
import { sma, smaAt, smaLookback } from '@chart-on/ta';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

type Inputs = { length: number; source: SourceKey; color: string };

export const smaDef: IndicatorDef<Inputs> = {
  id: 'sma',
  name: 'SMA',
  placement: 'overlay', // or 'pane' for a pane of its own
  inputs: [
    { id: 'length', type: 'number', default: 20, min: 1 },
    { id: 'source', type: 'source', default: 'close' },
    { id: 'color', type: 'color', default: '#f59e0b' },
  ],
  plots: [{ id: 'sma', type: 'line', colorInput: 'color' }],
  compute(src, { length, source }) {
    const values = sourceOf(src, source);
    return { sma: sma(values, length), source: values }; // NaN = no value
  },
  update(src, { length, source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    out.sma![i] = smaAt(out.source!, i, length);
  },
  lookback: ({ length }) => smaLookback(length), // bars before the first value
};

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme, plugins: [indicators()] });
  chart.addCandles({ title: 'SAMPLE' }).setData(sampleBars());
  chart.indicators.register(smaDef);
  chart.indicators.add('sma', { length: 20 });
  chart.indicators.add(smaDef, { length: 50, color: '#38bdf8' });
  chart.fitContent();
  return () => chart.destroy();
}
