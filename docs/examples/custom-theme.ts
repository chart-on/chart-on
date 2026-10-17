import { createChart, type Bar } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  // Keys left out fall back to `darkTheme`, so spread a full base theme first:
  // here the page's `theme`, in an app `darkTheme` or `lightTheme`. Blue and
  // orange stay apart for red-green color blindness.
  const chart = createChart(el, {
    theme: { ...theme, up: '#3d8bd9', down: '#e07b39' },
  });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);
  // No `color`: the line takes the theme's `line` color.
  chart.addLine({ title: 'SMA 20' }).setData(sma(bars, 20));
  chart.fitContent();

  // Change colors later: only the keys you pass change, and every series
  // that uses them redraws.
  chart.applyOptions({ theme: { line: '#a35fd0' } });

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
