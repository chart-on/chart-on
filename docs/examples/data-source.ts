import { createChart, createMockDataSource, dataSource } from '@chart-on/core';
import type { ExampleContext } from './types';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  // `dataSource()` lets the chart load through a source; it is opt-in so charts fed by `setData` stay small.
  const chart = createChart(el, { theme, plugins: [dataSource()] });
  chart.addCandles();

  // The chart loads the first bars, pages in history as you scroll back and
  // merges live bars. The mock source makes up a market; use your own adapter.
  chart.setDataSource(createMockDataSource({ seed: 3 }));
  void chart.setSymbol('DEMO', '1m');

  return () => chart.destroy();
}
