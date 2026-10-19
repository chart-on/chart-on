import type { IndicatorDef } from '@chart-on/core';

/**
 * A sample of point colours: momentum (the close against the close `length`
 * bars before) as columns in four colours, strong or fading on either side of
 * zero, and its `smooth`-bar average as a line coloured by its slope. Output
 * `shade` and `slope` hold the palette index of each bar.
 */
export const momentumColorsIndicator: IndicatorDef<{ length: number; smooth: number }> = {
  id: 'demo/momentum-colors',
  name: 'Momentum colours',
  placement: 'pane',
  inputs: [
    { id: 'length', type: 'number', default: 10, min: 1, max: 500, step: 1 },
    { id: 'smooth', type: 'number', default: 5, min: 1, max: 100, step: 1 },
  ],
  plots: [
    {
      id: 'momentum',
      title: 'Momentum',
      type: 'histogram',
      palette: ['#22a06b', 'rgba(34, 160, 107, 0.45)', '#e5484d', 'rgba(229, 72, 77, 0.45)'],
      colorOutput: 'shade',
    },
    { id: 'average', title: 'Average', type: 'line', lineWidth: 2, palette: ['#22a06b', '#e5484d'], colorOutput: 'slope' },
  ],
  lookback: ({ length, smooth }) => length + smooth - 1,
  compute(src, { length, smooth }) {
    const n = src.length;
    const momentum = new Float64Array(n).fill(NaN);
    const shade = new Float64Array(n).fill(NaN);
    const average = new Float64Array(n).fill(NaN);
    const slope = new Float64Array(n).fill(NaN);
    let sum = 0;
    for (let i = length; i < n; i++) {
      const m = src.close[i]! - src.close[i - length]!;
      momentum[i] = m;
      // Strong while momentum grows away from zero, fading while it shrinks back.
      const prev = momentum[i - 1]!;
      const fading = !Number.isNaN(prev) && Math.abs(m) < Math.abs(prev);
      shade[i] = (m >= 0 ? 0 : 2) + (fading ? 1 : 0);
      sum += m;
      if (i - smooth >= length) sum -= momentum[i - smooth]!;
      if (i - length + 1 < smooth) continue;
      average[i] = sum / smooth;
      slope[i] = Number.isNaN(average[i - 1]!) || average[i]! >= average[i - 1]! ? 0 : 1;
    }
    return { momentum, shade, average, slope };
  },
};
