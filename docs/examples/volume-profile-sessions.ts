import { createChart, volumeProfile } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  // Volume profiles are opt-in: the chart gets them through its plugins.
  const chart = createChart(el, { theme, plugins: [volumeProfile()] });
  chart.addCandles({ title: 'SAMPLE' }).setData(sampleBars()); // bars need `volume`

  // One profile per UTC day, growing from the day's first bar.
  chart.addVolumeProfile({ range: 'session' });

  chart.fitContent();
  return () => chart.destroy();
}
