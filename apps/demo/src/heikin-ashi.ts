import type { IndicatorDef } from '@chart-on/core';

/**
 * A sample of an OHLC plot: Heikin-Ashi candles computed from the chart's
 * bars, in their own pane. Each candle closes at the bar's average price and
 * opens halfway through the previous candle's body. Empty colours follow the
 * theme's up and down colours.
 */
export const heikinAshiIndicator: IndicatorDef<{ up: string; down: string }> = {
  id: 'demo/heikin-ashi',
  name: 'Heikin-Ashi',
  placement: 'pane',
  inputs: [
    { id: 'up', label: 'Up', type: 'color', default: '', role: 'up' },
    { id: 'down', label: 'Down', type: 'color', default: '', role: 'down' },
  ],
  plots: [{ id: 'close', type: 'ohlc', open: 'open', high: 'high', low: 'low', upColorInput: 'up', downColorInput: 'down', priceLine: true }],
  compute(src) {
    const n = src.length;
    const open = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = (src.open[i]! + src.high[i]! + src.low[i]! + src.close[i]!) / 4;
      const o = i > 0 ? (open[i - 1]! + close[i - 1]!) / 2 : (src.open[i]! + src.close[i]!) / 2;
      open[i] = o;
      close[i] = c;
      high[i] = Math.max(src.high[i]!, o, c);
      low[i] = Math.min(src.low[i]!, o, c);
    }
    return { open, high, low, close };
  },
};
