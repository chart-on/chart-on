import { createChartShell } from '@charton/ui';
import '@charton/ui/style.css';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { dark }: ExampleContext) {
  // Toolbar, drawing-tool rail and bottom bar around the chart.
  const shell = createChartShell(el, { theme: dark ? 'dark' : 'light' });
  shell.chart.addCandles({ title: 'SAMPLE' }).setData(sampleBars());
  shell.chart.fitContent();

  return () => shell.destroy();
}
