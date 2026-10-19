import { withAlpha, type Bar, type CustomSeriesDef } from '@chart-on/core';

/** One point of a price channel. */
export interface BandPoint {
  time: number;
  upper: number;
  lower: number;
}

/**
 * A filled price channel, written only against the public custom series API:
 * the area between `upper` and `lower` with both edges stroked.
 */
export const bandSeries: CustomSeriesDef<BandPoint, { color?: string }> = {
  type: 'band',
  priceRange: (p) => [p.lower, p.upper],
  draw(ctx, view) {
    const { items } = view;
    if (items.length < 2) return;
    const color = view.options.color ?? view.theme.line;
    ctx.beginPath();
    items.forEach(({ item, x }, i) => (i ? ctx.lineTo(x, view.priceToY(item.upper)) : ctx.moveTo(x, view.priceToY(item.upper))));
    for (let i = items.length - 1; i >= 0; i--) ctx.lineTo(items[i]!.x, view.priceToY(items[i]!.item.lower));
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.1);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (const key of ['upper', 'lower'] as const) {
      ctx.beginPath();
      items.forEach(({ item, x }, i) => (i ? ctx.lineTo(x, view.priceToY(item[key])) : ctx.moveTo(x, view.priceToY(item[key]))));
      ctx.stroke();
    }
  },
  legend: (p, o) => (p ? [{ label: 'U', text: o.format(p.upper) }, { label: 'L', text: o.format(p.lower) }] : []),
  lastValue: () => null,
};

/** Highest high and lowest low of the last `length` bars, at bar `i`. */
export function channelAt(bars: readonly Bar[], i: number, length = 20): BandPoint {
  let upper = -Infinity;
  let lower = Infinity;
  for (let j = Math.max(0, i - length + 1); j <= i; j++) {
    upper = Math.max(upper, bars[j]!.high);
    lower = Math.min(lower, bars[j]!.low);
  }
  return { time: bars[i]!.time, upper, lower };
}
