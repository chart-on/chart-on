import type { Chart } from './chart';
import type { Bar, Time } from './types';

/** A bar the user picked with `pickBar`. */
export interface PickedBar {
  /** The bar's time (unix seconds). */
  time: Time;
  /** Timeline index of the bar. */
  index: number;
  /** The main series' bar. */
  bar: Bar;
}

/** Ends the pick in progress on a chart with null. */
const picks = new WeakMap<Chart, () => void>();

/**
 * Let the user pick a bar: the next click on a bar of the main series
 * resolves with it, showing a crosshair cursor meanwhile. Escape, another
 * `pickBar`, `cancelPickBar` or destroying the chart resolve with null.
 * Clicks beyond the bars are ignored.
 */
export function pickBar(chart: Chart): Promise<PickedBar | null> {
  cancelPickBar(chart);
  // A destroyed chart sends no more events, so nothing would end the pick.
  if (chart.internals().destroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { root } = chart;
    const cursor = root.style.cursor;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
    };
    const offClick = chart.on('plot:click', (e) => {
      const bar = chart.mainBars[e.index];
      if (bar) finish({ time: bar.time, index: e.index, bar });
    });
    const offDestroy = chart.on('chart:destroy', () => finish(null));
    const finish = (picked: PickedBar | null) => {
      offClick();
      offDestroy();
      root.removeEventListener('keydown', onKey);
      root.style.cursor = cursor;
      picks.delete(chart);
      resolve(picked);
    };
    root.addEventListener('keydown', onKey);
    root.style.cursor = 'crosshair';
    picks.set(chart, () => finish(null));
  });
}

/** End a `pickBar` in progress on `chart`; it resolves with null. */
export function cancelPickBar(chart: Chart): void {
  picks.get(chart)?.();
}
