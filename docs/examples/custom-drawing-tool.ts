import { createChart, drawings, type DrawingToolDef } from '@charton/core';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

const priceBand: DrawingToolDef = {
  type: 'price-band',
  label: 'Price band',
  points: 2,
  render(ctx, d, env) {
    const [a, b] = d.points; // pane-local css px
    if (!a || !b) return;
    ctx.fillStyle = d.drawing.style.fill ?? env.theme.drawingFill;
    ctx.fillRect(0, Math.min(a.y, b.y), env.width, Math.abs(b.y - a.y));
  },
  hitTest(d, p) {
    const [a, b] = d.points;
    return !!a && !!b && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  },
};

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  // `drawings()` gives the chart drawings with only your own tools.
  const chart = createChart(el, { theme, plugins: [drawings()] });
  const bars = sampleBars();
  chart.addCandles({ title: 'SAMPLE' }).setData(bars);

  chart.drawings.register(priceBand);
  // One band from code; click twice on the chart to place another.
  chart.drawings.add({
    type: 'price-band',
    pane: 0,
    points: [
      { time: bars[120]!.time, price: bars[120]!.low },
      { time: bars[160]!.time, price: bars[160]!.high },
    ],
    style: {},
  });
  chart.drawings.setTool('price-band');
  chart.fitContent();
  return () => chart.destroy();
}
