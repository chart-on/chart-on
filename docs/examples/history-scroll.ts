import { createChart } from '@charton/core';
import type { ExampleContext } from './types';
import { fetchOlderBars, sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });
  candles.setData(sampleBars(150));

  // Pan towards the oldest bar: older pages load and are prepended.
  let loading = false;
  chart.on('history:request', async ({ before }) => {
    if (loading) return;
    loading = true;
    const older = await fetchOlderBars(before);
    if (older.length) candles.setData([...older, ...candles.data]);
    loading = false;
  });

  return () => chart.destroy();
}
