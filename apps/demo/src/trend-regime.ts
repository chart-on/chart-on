import type { IndicatorDef } from '@charton/core';

/**
 * A sample of three plot types: the highest high and lowest low of the last
 * `length` bars as step lines, a background shaded by where the close sits
 * against their midpoint (a palette index per bar), and arrow shapes where
 * the close breaks out of the previous bar's range.
 */
export const trendRegimeIndicator: IndicatorDef<{ length: number }> = {
  id: 'demo/trend-regime',
  name: 'Trend regime',
  placement: 'overlay',
  inputs: [{ id: 'length', type: 'number', default: 20, min: 2, max: 500, step: 1 }],
  plots: [
    { id: 'upper', title: 'High', type: 'line', lineType: 'step', color: '#22a06b' },
    { id: 'lower', title: 'Low', type: 'line', lineType: 'step', color: '#e5484d' },
    { id: 'regime', type: 'background', palette: ['rgba(34, 160, 107, 0.08)', 'rgba(229, 72, 77, 0.08)'] },
    { id: 'breakUp', title: 'Breakout up', type: 'shape', shape: 'arrow-up', color: '#22a06b' },
    { id: 'breakDown', title: 'Breakout down', type: 'shape', shape: 'arrow-down', color: '#e5484d' },
  ],
  lookback: ({ length }) => length - 1,
  compute(src, { length }) {
    const n = src.length;
    const upper = new Float64Array(n).fill(NaN);
    const lower = new Float64Array(n).fill(NaN);
    const regime = new Float64Array(n).fill(NaN);
    // NaN draws no shape; any number draws one on that bar.
    const breakUp = new Float64Array(n).fill(NaN);
    const breakDown = new Float64Array(n).fill(NaN);
    for (let i = length - 1; i < n; i++) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = i - length + 1; k <= i; k++) {
        hi = Math.max(hi, src.high[k]!);
        lo = Math.min(lo, src.low[k]!);
      }
      upper[i] = hi;
      lower[i] = lo;
      regime[i] = src.close[i]! >= (hi + lo) / 2 ? 0 : 1;
      if (i > length - 1 && src.close[i]! > upper[i - 1]!) breakUp[i] = 1;
      if (i > length - 1 && src.close[i]! < lower[i - 1]!) breakDown[i] = 1;
    }
    return { upper, lower, regime, breakUp, breakDown };
  },
};
