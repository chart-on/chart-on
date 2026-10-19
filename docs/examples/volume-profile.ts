import { createChart, volumeProfile } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  // Volume profiles are opt-in: the chart gets them through its plugins.
  const chart = createChart(el, { theme, plugins: [volumeProfile()] });
  chart.addCandles({ title: 'SAMPLE' }).setData(sampleBars()); // bars need `volume`

  // The bars on screen, at the right edge; it follows pan and zoom.
  chart.addVolumeProfile();

  chart.fitContent();
  return () => chart.destroy();
}
