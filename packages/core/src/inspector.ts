import type { Chart } from './chart';
import type { ChartTheme } from './theme';
import { fontCss, numeralsCss, resolveFont } from './typography';
import type { HeatmapCell, HeatmapSeries } from './series';
import type { Point } from './types';
import { clampLow } from './util/math';

const HALF_COLS = 1;
const HALF_ROWS = 3;

/** Hover grid of neighbouring heatmap values around the cell under the cursor. */
export class HeatmapInspector {
  readonly #el: HTMLDivElement;
  readonly #cells: HTMLDivElement[] = [];
  readonly #cols = HALF_COLS * 2 + 2;

  constructor(root: HTMLElement) {
    this.#el = document.createElement('div');
    this.#el.className = 'pc-inspector';
    Object.assign(this.#el.style, {
      position: 'absolute',
      zIndex: '2',
      display: 'none',
      pointerEvents: 'none',
      gridTemplateColumns: `repeat(${this.#cols - 1}, minmax(52px, auto)) minmax(72px, auto)`,
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    });
    for (let i = 0; i < this.#cols * (HALF_ROWS * 2 + 1); i++) {
      const cell = document.createElement('div');
      Object.assign(cell.style, { padding: '5px 10px', textAlign: 'center' });
      this.#cells.push(cell);
      this.#el.appendChild(cell);
    }
    root.appendChild(this.#el);
  }

  show(
    series: HeatmapSeries,
    cell: HeatmapCell,
    at: Point,
    plotWidth: number,
    plotHeight: number,
    theme: ChartTheme,
    formatPrice: (price: number) => string,
  ): void {
    const s = this.#el.style;
    s.display = 'grid';
    const font = resolveFont(theme, 'legend');
    s.font = fontCss(font);
    s.fontVariantNumeric = numeralsCss(font.numerals);
    s.background = theme.background;
    s.border = `1px solid ${theme.separator}`;
    let i = 0;
    for (let dr = HALF_ROWS; dr >= -HALF_ROWS; dr--) {
      const row = cell.row + dr;
      for (let dc = -HALF_COLS; dc <= HALF_COLS; dc++) {
        const v = series.valueAt(cell.col + dc, row);
        const el = this.#cells[i++]!;
        const center = dr === 0 && dc === 0;
        el.textContent = v === undefined || v === 0 ? '' : series.options.format(v);
        el.style.color = center ? theme.labelText : theme.text;
        el.style.fontWeight = center ? '700' : '400';
        el.style.outline = center ? `1.5px solid ${theme.labelText}` : 'none';
        el.style.outlineOffset = '-3px';
        el.style.borderRadius = center ? '6px' : '0';
      }
      const priceEl = this.#cells[i++]!;
      priceEl.textContent = formatPrice(series.priceOfRow(row));
      priceEl.style.background = theme.labelBackground;
      priceEl.style.color = theme.labelText;
    }
    const w = this.#el.offsetWidth;
    const h = this.#el.offsetHeight;
    const x = at.x + 18 + w > plotWidth ? at.x - 18 - w : at.x + 18;
    const y = clampLow(at.y - h / 2, 4, plotHeight - h - 4);
    s.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    s.left = '0';
    s.top = '0';
  }

  hide(): void {
    this.#el.style.display = 'none';
  }
}

/**
 * Show `inspector` (made now when there is none) for the heatmap cell under
 * the crosshair of `chart` at bar `index`, or hide it. Returns the inspector.
 */
export function inspectHeatmap(chart: Chart, index: number, inspector: HeatmapInspector | null): HeatmapInspector | null {
  const c = chart.crosshair;
  const pane = c ? chart.panes[c.pane] : undefined;
  const heatmap = pane?.series.find((s): s is HeatmapSeries => s.kind === 'heatmap' && s.visible && (s as HeatmapSeries).options.inspector);
  // A mirrored crosshair without a price (NaN y) has no cell to inspect.
  if (!c || !pane || !heatmap || c.x >= chart.plotWidth || Number.isNaN(c.y)) {
    inspector?.hide();
    return inspector;
  }
  const cell = heatmap.cellAt(index, heatmap.scale.yToPrice(c.y - pane.top));
  if (!cell || !(cell.value > heatmap.range.min)) {
    inspector?.hide();
    return inspector;
  }
  inspector ??= new HeatmapInspector(chart.root);
  inspector.show(heatmap, cell, { x: c.x + chart.plotLeft, y: c.y }, chart.plotLeft + chart.plotWidth, chart.plotHeight, chart.theme, (p) =>
    chart.formatPrice(c.pane, p),
  );
  return inspector;
}
