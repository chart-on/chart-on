import type { IndicatorDef } from '@chart-on/core';

/**
 * A sample bar colour plot: recolours the bars whose volume is at least
 * `factor` times the average of the `length` bars before them. The output is
 * a palette index per bar, NaN for bars that keep their colour.
 */
export const volumeSpikesIndicator: IndicatorDef<{ length: number; factor: number }> = {
  id: 'demo/volume-spikes',
  name: 'Volume spikes',
  placement: 'overlay',
  inputs: [
    { id: 'length', type: 'number', default: 20, min: 2, max: 500, step: 1 },
    { id: 'factor', type: 'number', default: 2, min: 1, max: 10, step: 0.5 },
  ],
  plots: [{ id: 'spike', type: 'barColor', palette: ['#f5a524'] }],
  lookback: ({ length }) => length,
  compute(src, { length, factor }) {
    const n = src.length;
    const spike = new Float64Array(n).fill(NaN);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // A missing volume (NaN) never counts as a spike.
      if (i >= length && sum > 0 && src.volume[i]! >= (factor * sum) / length) spike[i] = 0;
      sum += src.volume[i]! || 0;
      if (i >= length) sum -= src.volume[i - length]! || 0;
    }
    return { spike };
  },
};
