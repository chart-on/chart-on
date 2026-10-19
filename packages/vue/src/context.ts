import { inject, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import type { Chart } from '@chart-on/core';

/** The chart of the nearest `<Chart>` or `<ChartShell>`; null before mount and on a server. */
export const chartKey: InjectionKey<Readonly<ShallowRef<Chart | null>>> = Symbol('charton-chart');

/**
 * The chart of the nearest enclosing `<Chart>` or `<ChartShell>`, as a ref. It
 * holds null during server rendering and until the component has mounted,
 * then the chart, so a `watch` on it runs once the chart exists. Outside a
 * chart component it always holds null.
 */
export function useChart(): Readonly<ShallowRef<Chart | null>> {
  return inject(chartKey, () => shallowRef(null), true);
}
