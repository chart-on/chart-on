import { createChart, volumeOf } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });

  // Its own scale in the bottom fifth of the price pane.
  chart.addHistogram({ title: 'Volume', follow: volumeOf, overlay: { top: 0.8, bottom: 0 } });

  candles.setData(sampleBars());
  chart.fitContent();

  return () => chart.destroy();
}
