import type { CustomSeriesDef } from '../series';
import { formatCompact } from '../util/format';
import { withAlpha } from '../util/color';
import { footprintFromRows, footprintImbalances, type FootprintBar, type FootprintImbalanceOptions } from './footprint';

/** Options of `footprintSeries`, next to the custom series base options. */
export interface FootprintSeriesOptions {
  /** Row text: `'split'` sell and buy volume side by side, `'delta'` buy minus sell, `'volume'` the total. Default `'split'`. */
  values?: 'split' | 'delta' | 'volume';
  /** Imbalance rule for coloured row text (see `footprintImbalances`), or `false` for none. Default `{ ratio: 3 }`. */
  imbalance?: FootprintImbalanceOptions | false;
  /** Rows where buying leads, and buy imbalances. Defaults to theme.up. */
  upColor?: string;
  /** Rows where selling leads, and sell imbalances. Defaults to theme.down. */
  downColor?: string;
  /** Outline of the point-of-control row. Defaults to theme.text. */
  pocColor?: string;
}

/** Opacity steps of a row cell, from its share of the bar's largest row volume. */
const SHADES = 4;
/** Text needs rows at least this tall (css px). */
const TEXT_ROW = 9;
/** Below this bar width or row height (css px) a bar is one range bar coloured by its delta. */
const MIN_CELL = 2;

/**
 * Footprint bars for `chart.addCustomSeries`: each `FootprintBar` (from
 * `createFootprintBuilder` or `footprintFromRows`) draws its price rows as
 * cells shaded by volume, coloured by the side that leads, with the point of
 * control outlined. When rows and bars are large enough each row shows its
 * volume (`values`), imbalanced sides in the up or down colour. Narrower bars
 * drop the text, then the cells, and become one range bar coloured by delta.
 * While the chart groups bars, a group's rows are summed.
 */
export const footprintSeries: CustomSeriesDef<FootprintBar, FootprintSeriesOptions> = {
  type: 'footprint',
  priceRange: (bar) => (bar.rows.length ? [bar.rows[0]!.price, bar.rows[bar.rows.length - 1]!.price + bar.rowSize] : null),
  draw(ctx, view) {
    const { options: o, theme } = view;
    const up = o.upColor ?? theme.up;
    const down = o.downColor ?? theme.down;
    const width = view.barSpacing * 0.9;
    const fontSize = Math.min(theme.fontSize - 1, 11);
    for (const { item: bar, x } of view.items) {
      const rows = bar.rows;
      if (!rows.length) continue;
      const left = x - width / 2;
      const y = (price: number) => view.priceToY(price);
      // Rows top and bottom on screen, either way up (the scale may be inverted).
      const a = y(rows[rows.length - 1]!.price + bar.rowSize);
      const b = y(rows[0]!.price);
      const top = Math.min(a, b);
      const span = Math.abs(b - a);
      if (width < MIN_CELL || span / rows.length < MIN_CELL) {
        const w = Math.max(1, width / 3);
        ctx.fillStyle = bar.delta < 0 ? down : up;
        ctx.fillRect(x - w / 2, top, w, Math.max(1, span));
        continue;
      }
      let max = 0;
      for (const r of rows) max = Math.max(max, r.volume);
      // One path per colour and shade, so a bar costs a few fills, not one per row.
      for (let s = 0; s < SHADES * 2; s++) {
        ctx.beginPath();
        for (const r of rows) {
          const shade = Math.min(SHADES - 1, Math.floor((r.volume / (max || 1)) * SHADES)) + (r.sell > r.buy ? SHADES : 0);
          if (shade !== s) continue;
          const ya = y(r.price + bar.rowSize);
          const yb = y(r.price);
          const h = Math.abs(yb - ya);
          ctx.rect(left, Math.min(ya, yb), width, h > 3 ? h - 1 : h);
        }
        ctx.fillStyle = withAlpha(s < SHADES ? up : down, 0.15 + 0.15 * (s % SHADES));
        ctx.fill();
      }
      const poc = rows[bar.poc];
      if (poc) {
        const pa = y(poc.price + bar.rowSize);
        const pb = y(poc.price);
        ctx.strokeStyle = o.pocColor ?? theme.text;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, Math.min(pa, pb) + 0.5, width - 1, Math.abs(pb - pa) - 1);
      }
      if (span < rows.length * TEXT_ROW) continue;
      const split = (o.values ?? 'split') === 'split';
      const texts = rows.map((r) =>
        split ? [formatCompact(r.sell), formatCompact(r.buy)] : [formatCompact(o.values === 'delta' ? r.buy - r.sell : r.volume)],
      );
      // Rough fit check: digits are about 0.6 em wide.
      let chars = 0;
      for (const t of texts) chars = Math.max(chars, ...t.map((s) => s.length));
      if (chars * fontSize * 0.6 * (split ? 2 : 1) + 8 > width) continue;
      const flags = o.imbalance === false ? null : footprintImbalances(bar, o.imbalance ?? {});
      ctx.font = `${fontSize}px ${theme.fontFamily}`;
      ctx.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const mid = (y(r.price) + y(r.price + bar.rowSize)) / 2;
        const [first, second] = texts[i]!;
        if (second === undefined) {
          ctx.textAlign = 'center';
          ctx.fillStyle = theme.text;
          ctx.fillText(first!, x, mid);
          return;
        }
        ctx.textAlign = 'right';
        ctx.fillStyle = flags?.sell[i] ? down : theme.text;
        ctx.fillText(first!, x - 3, mid);
        ctx.textAlign = 'left';
        ctx.fillStyle = flags?.buy[i] ? up : theme.text;
        ctx.fillText(second, x + 3, mid);
      });
    }
  },
  legend: (bar) =>
    bar
      ? [
          { label: 'V', text: formatCompact(bar.volume) },
          { label: 'Δ', text: formatCompact(bar.delta) },
        ]
      : [],
  group: (bars) => footprintFromRows(bars[0]!.time, bars.flatMap((b) => b.rows), bars[0]!.rowSize),
};
