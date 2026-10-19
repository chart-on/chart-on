import { createChart } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars, sampleTicks } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const candles = chart.addCandles({ title: 'SAMPLE' });
  const history = sampleBars(200);
  candles.setData(history);
  chart.fitContent();

  // `sampleTicks` stands in for a WebSocket; in an app, call `update` from its
  // message handler. The same time replaces the forming bar, a newer one appends.
  const stop = sampleTicks(history.at(-1)!, (bar) => candles.update(bar));

  return () => {
    stop();
    chart.destroy();
  };
}
