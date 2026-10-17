import type { CustomSeriesDef } from '../series';
import { withAlpha } from '../util/color';
import { tpoLetter, type TpoColumn, type TpoProfile } from './tpo';

/** Options of `tpoSeries`, next to the custom series base options. */
export interface TpoSeriesOptions {
  /** `false` draws blocks only; otherwise letters show when cells are big enough. Default true. */
  letters?: boolean;
  /** TPOs inside the value area; those outside it are a faded tint. Defaults to theme.line. */
  color?: string;
  /** TPOs on the point-of-control row. Defaults to theme.text. */
  pocColor?: string;
}

/** Letters need rows at least this tall (css px). */
const TEXT_ROW = 9;

/** 0 inside the value area, 1 outside it, 2 on the point of control. */
function kind(p: TpoProfile, row: number): number {
  return row === p.poc ? 2 : row >= p.valueAreaLow && row <= p.valueAreaHigh ? 0 : 1;
}

/**
 * TPO (market profile) chart type for `chart.addCustomSeries`, fed by
 * `tpoColumns`: each bar draws one column of its session's profile in its
 * own slot, so a session's profile grows right from its first bar. Cells show
 * period letters (`tpoLetter`) when they are big enough, otherwise blocks,
 * which merge into a profile histogram as bars narrow. The value area is in
 * `color`, rows outside it faded, and the point-of-control row in `pocColor`.
 * Autoscale covers the whole session's profile.
 */
export const tpoSeries: CustomSeriesDef<TpoColumn, TpoSeriesOptions> = {
  type: 'tpo',
  priceRange: ({ profile: p }) => (p.rows ? [p.start, p.start + p.rows * p.rowSize] : null),
  draw(ctx, view) {
    const { options: o, theme } = view;
    const color = o.color ?? theme.line;
    const colors = [color, withAlpha(color, 0.4), o.pocColor ?? theme.text];
    const w = view.barSpacing;
    const fontSize = Math.min(theme.fontSize - 1, 11);
    const y = (price: number) => view.priceToY(price);
    const rows = (p: TpoProfile, column: number, fn: (row: number, ya: number, yb: number) => void) => {
      for (let r = 0; r < p.rows; r++) {
        if (p.counts[r]! > column) fn(r, y(p.start + (r + 1) * p.rowSize), y(p.start + r * p.rowSize));
      }
    };
    const fits = (p: TpoProfile) =>
      o.letters !== false && w >= fontSize * 0.8 && Math.abs(y(p.start + p.rowSize) - y(p.start)) >= TEXT_ROW;
    // Blocks: one path per colour for the whole frame.
    const cell = w > 3 ? w - 1 : Math.max(1, w);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (const { item, x } of view.items) {
        if (fits(item.profile)) continue;
        rows(item.profile, item.column, (r, ya, yb) => {
          if (kind(item.profile, r) !== k) return;
          const h = Math.abs(yb - ya);
          ctx.rect(x - w / 2, Math.min(ya, yb), cell, h > 3 ? h - 1 : h);
        });
      }
      ctx.fillStyle = colors[k]!;
      ctx.fill();
    }
    ctx.font = `${fontSize}px ${theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { item, x } of view.items) {
      const p = item.profile;
      if (!fits(p)) continue;
      rows(p, item.column, (r, ya, yb) => {
        ctx.fillStyle = colors[kind(p, r)]!;
        ctx.fillText(tpoLetter(p.rowPeriods[r]![item.column]!), x, (ya + yb) / 2);
      });
    }
  },
  legend(item, o) {
    const p = item?.profile;
    if (!p || p.poc < 0) return [];
    // Point of control at its row's middle, value-area high and low at their rows' outer edges.
    const price = (row: number) => o.format(p.start + row * p.rowSize);
    return [
      { label: 'POC', text: price(p.poc + 0.5) },
      { label: 'VAH', text: price(p.valueAreaHigh + 1) },
      { label: 'VAL', text: price(p.valueAreaLow) },
    ];
  },
};
