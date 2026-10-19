import { createChart } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });

  // Each bar's range as a line on its own pane; return null to leave a bar out.
  chart.addLine({ title: 'Range', follow: (bar) => ({ time: bar.time, value: bar.high - bar.low }) }, chart.addPane());

  candles.setData(sampleBars());
  chart.fitContent();

  return () => chart.destroy();
}
