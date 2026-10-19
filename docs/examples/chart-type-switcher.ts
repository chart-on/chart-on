import type { CandleStyle } from '@chart-on/core';
import { createChartShell } from '@chart-on/ui';
import '@chart-on/ui/style.css';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

const styles: { value: CandleStyle; label: string }[] = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow', label: 'Hollow candles' },
  { value: 'bars', label: 'Bars' },
  { value: 'heikinAshi', label: 'Heikin-Ashi' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'baseline', label: 'Baseline' },
];

export default function mount(el: HTMLElement, { dark }: ExampleContext) {
  const shell = createChartShell(el, {
    theme: dark ? 'dark' : 'light',
    rail: false,
    toolbar: [
      {
        type: 'menu',
        id: 'style',
        label: 'Chart type',
        text: 'Candles',
        value: 'candles',
        options: styles,
        onSelect: (value) => candles.applyOptions({ style: value as CandleStyle }),
      },
    ],
  });
  const candles = shell.chart.addCandles({ title: 'SAMPLE' });
  candles.setData(sampleBars());
  shell.chart.fitContent();

  return () => shell.destroy();
}
