/**
 * A starter charton plugin: one drawing tool and one indicator, installed
 * and uninstalled together. Copy this folder, rename the package and the
 * ids, and replace the two contributions with your own.
 */
import type { ChartPlugin, DrawingToolDef, IndicatorDef } from '@chart-on/core';

/** Prefix every id with the package name, so it cannot clash with the built-ins or other plugins. */
const ID = 'charton-plugin-starter';

/** A one-click marker that labels the price it was placed at. */
export const priceTag: DrawingToolDef = {
  type: `${ID}/price-tag`,
  label: 'Price tag',
  group: 'annotate',
  points: 1,
  render(ctx, d, env) {
    const p = d.points[0]!;
    const color = d.drawing.style.color ?? env.theme.drawing;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${env.theme.fontSize}px ${env.theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(env.formatPrice(d.drawing.points[0]!.price), p.x + 6, p.y);
  },
  hitTest: (d, p) => Math.hypot(p.x - d.points[0]!.x, p.y - d.points[0]!.y) <= 6,
};

/** The middle of each bar's range, (high + low) / 2, drawn over the price. */
export const midpoint: IndicatorDef<Record<string, never>> = {
  id: `${ID}/midpoint`,
  name: 'Midpoint',
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'mid', type: 'line', title: 'Mid' }],
  compute(src) {
    const mid = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) mid[i] = (src.high[i]! + src.low[i]!) / 2;
    return { mid };
  },
};

/** Install with `chart.install(starterPlugin)`; `chart.uninstall('charton-plugin-starter')` removes everything again. */
export const starterPlugin: ChartPlugin = {
  name: ID,
  version: '0.1.0',
  // The core versions this plugin was built and tested against.
  requires: '^0.1.0',
  install(ctx) {
    ctx.registerDrawingTool(priceTag);
    ctx.registerIndicator(midpoint);
  },
};
