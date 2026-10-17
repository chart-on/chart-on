import { createChart, type Bar } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);
  chart.addLine({ title: 'SMA 20', color: '#f59e0b' }).setData(sma(bars, 20));
  chart.fitContent();
  return () => chart.destroy();
}

/** Simple moving average of the closes over `length` bars. */
function sma(bars: Bar[], length: number) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.close;
    if (i >= length) sum -= bars[i - length]!.close;
    if (i >= length - 1) out.push({ time: bars[i]!.time, value: sum / length });
  }
  return out;
}
