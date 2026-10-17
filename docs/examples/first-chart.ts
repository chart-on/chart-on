import { createChart } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });

  // Bars are { time (unix seconds), open, high, low, close, volume? }.
  candles.setData(sampleBars());
  chart.fitContent();

  return () => chart.destroy();
}
