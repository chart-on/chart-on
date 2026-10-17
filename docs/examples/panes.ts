import { createChart, volumeOf, type Bar } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);

  const volumePane = chart.addPane({ stretch: 0.25 });
  chart.addHistogram({ title: 'Volume', follow: volumeOf }, volumePane);

  const deltaPane = chart.addPane({ stretch: 0.25 });
  chart.addLine({ title: 'Cumulative delta', baseline: 0 }, deltaPane).setData(cumulativeDelta(bars));

  chart.fitContent();
  return () => chart.destroy();
}

/** Running total of buy volume minus sell volume. */
function cumulativeDelta(bars: Bar[]) {
  let total = 0;
  return bars.map((bar) => {
    const buy = bar.buyVolume ?? 0;
    total += buy - ((bar.volume ?? 0) - buy);
    return { time: bar.time, value: total };
  });
}
