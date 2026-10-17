import { PriceBarBuilder, createChart, priceStyles, type Bar, type CandleStyle, type Chart, type PriceBarOptions } from '@charton/core';

export interface PriceChart {
  chart: Chart;
  /** Rebuild from the main chart's bars. */
  load(bars: readonly Bar[]): void;
  /** A live bar from the main chart: the forming one changed, or a new one started. */
  update(bar: Bar): void;
  destroy(): void;
}

const TYPES: { label: string; options: PriceBarOptions; style?: CandleStyle }[] = [
  { label: 'Renko (ATR 14)', options: { type: 'renko', size: { kind: 'atr', length: 14 } } },
  { label: 'Renko (0.5%, high-low)', options: { type: 'renko', size: { kind: 'percent', percent: 0.5 }, source: 'highLow' } },
  { label: 'Line break (3 lines)', options: { type: 'lineBreak' } },
  { label: 'Range bars (ATR 14)', options: { type: 'range', size: { kind: 'atr', length: 14 } } },
  { label: 'Kagi (ATR 14)', options: { type: 'kagi', size: { kind: 'atr', length: 14 } }, style: 'kagi' },
  { label: 'Kagi (1%, high-low)', options: { type: 'kagi', size: { kind: 'percent', percent: 1 }, source: 'highLow' }, style: 'kagi' },
  { label: 'Point & figure (ATR 14, 3-box)', options: { type: 'pointFigure', size: { kind: 'atr', length: 14 } }, style: 'pointFigure' },
  {
    label: 'Point & figure (0.5%, 1-box, high-low)',
    options: { type: 'pointFigure', size: { kind: 'percent', percent: 0.5 }, reversal: 1, source: 'highLow' },
    style: 'pointFigure',
  },
];

/**
 * A chart under the shell drawing the main chart's bars as price-based bars.
 * The bars sit on evenly spaced slots. The crosshair and legend show the
 * source time span each bar carries; the axis labels look up its end.
 */
export function createPriceChart(host: HTMLElement, peer: Chart): PriceChart {
  let builder = new PriceBarBuilder(TYPES[0]!.options);
  let source: readonly Bar[] = [];
  const chart = createChart(host, {
    theme: peer.theme,
    // The kagi and point & figure entries draw with their own styles.
    plugins: [priceStyles()],
    formatTimeTick: (time) => {
      const bar = builder.barAt(time);
      return bar ? new Date(bar.endTime * 1000).toISOString().slice(5, 10) : '';
    },
  });
  const candles = chart.addCandles({ title: TYPES[0]!.label });

  const select = document.createElement('select');
  select.className = 'demo-price-type';
  select.setAttribute('aria-label', 'Price-based chart type');
  TYPES.forEach((t, i) => select.append(new Option(t.label, String(i))));
  select.addEventListener('change', () => {
    const type = TYPES[Number(select.value)]!;
    builder = new PriceBarBuilder(type.options);
    candles.applyOptions({ title: type.label, style: type.style ?? 'candles' });
    load(source);
  });
  host.append(select);

  function load(bars: readonly Bar[]): void {
    source = bars;
    candles.setData(builder.setData(bars));
    chart.scrollToRealtime(false);
  }

  return {
    chart,
    load,
    update(bar) {
      const change = builder.update(bar);
      if (change.reset) candles.setData(builder.bars, { keepVisibleRange: true });
      else for (const b of change.bars) candles.update(b);
    },
    destroy() {
      select.remove();
      chart.destroy();
    },
  };
}
