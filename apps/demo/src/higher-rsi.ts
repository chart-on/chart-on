import { alignSteps, formingSteps, type BarArrays, type IndicatorDef, type Interval } from '@charton/core';

/**
 * An RSI computed on another, longer interval's bars (daily by default) and
 * shown on the chart's bars, e.g. daily RSI on a 5-minute chart. Each chart bar
 * shows the RSI as it stood at that bar, with the daily bar formed so far, so
 * nothing on screen uses data from later bars. "Closed bars only" shows the
 * last finished daily bar's RSI instead, which never changes once drawn.
 *
 * The demo's mock feed makes each interval's prices independently, so the
 * finished daily bars don't match the intraday ones; with a real feed they do.
 */
type Inputs = { interval: string; length: number; closedOnly: boolean; color: string };

const GUIDE = 'rgba(139, 139, 153, 0.6)';

/** Wilder's averages of gains and losses over `length` closes, per bar (NaN while warming up). */
function averages(close: Float64Array, length: number): { gain: Float64Array; loss: Float64Array } {
  const n = close.length;
  const gain = new Float64Array(n).fill(NaN);
  const loss = new Float64Array(n).fill(NaN);
  let up = 0;
  let down = 0;
  for (let i = 1; i < n; i++) {
    const d = close[i]! - close[i - 1]!;
    if (i <= length) {
      up += Math.max(d, 0);
      down += Math.max(-d, 0);
      if (i === length) {
        gain[i] = up / length;
        loss[i] = down / length;
      }
    } else {
      gain[i] = (gain[i - 1]! * (length - 1) + Math.max(d, 0)) / length;
      loss[i] = (loss[i - 1]! * (length - 1) + Math.max(-d, 0)) / length;
    }
  }
  return { gain, loss };
}

function strength(gain: number, loss: number): number {
  if (Number.isNaN(gain) || Number.isNaN(loss)) return NaN;
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** RSI of every higher bar. */
function rsiOf(bars: BarArrays, length: number): Float64Array {
  const { gain, loss } = averages(bars.close, length);
  return Float64Array.from(gain, (g, i) => strength(g, loss[i]!));
}

export const higherRsiIndicator: IndicatorDef<Inputs> = {
  id: 'demo/higher-rsi',
  name: 'RSI on a higher interval',
  title: ({ interval, length, closedOnly }) => `RSI ${length} ${interval}${closedOnly ? ' closed' : ''}`,
  placement: 'pane',
  fixedRange: { min: 0, max: 100 },
  precision: 2,
  inputs: [
    {
      id: 'interval',
      type: 'select',
      label: 'Interval',
      default: '1d',
      options: ['15m', '1h', '4h', '1d', '1w'].map((value) => ({ value })),
    },
    { id: 'length', type: 'number', label: 'Length', default: 14, min: 1, max: 500, step: 1 },
    { id: 'closedOnly', type: 'boolean', label: 'Closed bars only', default: false },
    { id: 'color', type: 'color', label: 'Color', default: '' },
  ],
  plots: [
    { id: 'upper', type: 'line', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'lower', type: 'line', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'rsi', type: 'line', colorInput: 'color' },
  ],
  // One more bar than the length: the first change needs a previous close.
  intervals: ({ interval, length }) => [{ interval: interval as Interval, lookback: length + 1 }],
  compute(src, { interval, length, closedOnly }, _data, bars) {
    const higher = bars[interval]!;
    const n = src.length;
    let rsi: Float64Array;
    if (closedOnly) {
      rsi = alignSteps(src.time, higher.time, rsiOf(higher, length), { closedOnly: true });
    } else {
      // Averages up to the previous higher bar are final; the forming one only moves the last step.
      const { gain, loss } = averages(higher.close, length);
      rsi = formingSteps(src, higher, (b, j) => {
        if (j < length || (j > length && Number.isNaN(gain[j - 1]!))) return NaN;
        const d = b.close[j]! - b.close[j - 1]!;
        if (j === length) {
          // The seed average: the first `length` changes, the last one as formed so far.
          let up = Math.max(d, 0);
          let down = Math.max(-d, 0);
          for (let i = 1; i < j; i++) {
            const e = b.close[i]! - b.close[i - 1]!;
            up += Math.max(e, 0);
            down += Math.max(-e, 0);
          }
          return strength(up / length, down / length);
        }
        const g = (gain[j - 1]! * (length - 1) + Math.max(d, 0)) / length;
        const l = (loss[j - 1]! * (length - 1) + Math.max(-d, 0)) / length;
        return strength(g, l);
      });
    }
    return { rsi, upper: new Float64Array(n).fill(70), lower: new Float64Array(n).fill(30) };
  },
};
