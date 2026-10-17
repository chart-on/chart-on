import { createChart, withAlpha, type Bar, type CustomSeriesDef } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

interface BandPoint { time: number; upper: number; lower: number }

const band: CustomSeriesDef<BandPoint, { color?: string }> = {
  type: 'band',
  // Price span of one item, for autoscale.
  priceRange: (p) => [p.lower, p.upper],
  draw(ctx, view) {
    const { items } = view;
    if (items.length < 2) return;
    const color = view.options.color ?? view.theme.line;
    ctx.beginPath();
    items.forEach(({ item, x }) => ctx.lineTo(x, view.priceToY(item.upper)));
    for (let i = items.length - 1; i >= 0; i--) ctx.lineTo(items[i]!.x, view.priceToY(items[i]!.item.lower));
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.15);
    ctx.fill();
  },
  legend: (p, o) => (p ? [{ label: 'U', text: o.format(p.upper) }, { label: 'L', text: o.format(p.lower) }] : []),
  lastValue: (p) => ({ value: p.upper }),
};

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);
  const channel = chart.addCustomSeries(band, { title: 'Channel', color: '#38bdf8' });
  channel.setData(bars.map((_, i) => channelAt(bars, i, 20))); // ascending by time, unix seconds
  chart.fitContent();
  return () => chart.destroy();
}

/** Highest high and lowest low of the `length` bars up to bar `i`. */
function channelAt(bars: Bar[], i: number, length: number): BandPoint {
  const span = bars.slice(Math.max(0, i - length + 1), i + 1);
  return {
    time: bars[i]!.time,
    upper: Math.max(...span.map((b) => b.high)),
    lower: Math.min(...span.map((b) => b.low)),
  };
}
