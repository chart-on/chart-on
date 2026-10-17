import { annotations, createChart } from '@charton/core';
import type { ExampleContext } from './types';
import { HOUR, sampleBars } from './sample-data';

export default function mount(el: HTMLElement, { dark, theme }: ExampleContext) {
  const chart = createChart(el, { theme, plugins: [annotations()] });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);

  // An event window: shades every bar from `from` to `to`, below the candles.
  const event = bars[200]!.time;
  chart.annotations.addTimeBand({ from: event, to: event + 6 * HOUR, label: 'Earnings' });

  // A zone found by an algorithm: the range of a quiet stretch, carried to the right edge.
  const base = bars.slice(140, 170);
  const high = Math.max(...base.map((b) => b.high));
  const low = Math.min(...base.map((b) => b.low));
  chart.annotations.addPriceZone({
    from: low,
    to: high,
    fromTime: base[0]!.time,
    color: dark ? 'rgba(60, 196, 160, 0.14)' : 'rgba(15, 130, 104, 0.12)',
    label: 'Base',
    axisLabel: true,
  });

  // A note pinned above a bar's high, with a pointer down to it.
  const peak = bars.slice(220).reduce((a, b) => (b.high > a.high ? b : a));
  chart.annotations.addTextLabel({ time: peak.time, price: peak.high, text: 'Local high', pointerLength: 24 });

  chart.fitContent();
  return () => chart.destroy();
}
