import { createChartGrid } from '@chart-on/ui';
import '@chart-on/ui/style.css';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { dark }: ExampleContext) {
  // Four linked charts: pan, zoom or move the crosshair on one and the others follow.
  // Drag the bars between the cells, or focus one and use the arrow keys, to resize.
  const grid = createChartGrid(el, {
    layout: '2x2',
    theme: dark ? 'dark' : 'light',
    cell: { rail: false, bottomBar: false },
    setup(shell, index) {
      shell.chart.addCandles({ title: `SAMPLE ${index + 1}` }).setData(sampleBars(300, { seed: index + 1 }));
      shell.chart.fitContent();
    },
  });

  return () => grid.destroy();
}
