import { createChart, volumeOf } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });

  // `follow` keeps the volume histogram in step with the candles.
  chart.addHistogram({ title: 'Volume', follow: volumeOf }, chart.addPane({ stretch: 0.25 }));

  candles.setData(sampleBars());
  chart.fitContent();

  return () => chart.destroy();
}
