import { getContext, hasContext, setContext } from 'svelte';
import type { Chart } from '@chart-on/core';

/** A value that a component provides and that can change; reading `current` in an effect tracks it. */
export interface Current<T> {
  readonly current: T;
}

const chartKey = Symbol('charton-chart');
const empty: Current<null> = { current: null };

/** Make `read()` the chart that `useChart()` returns in this component's children. */
export function provideChart(read: () => Chart | null): void {
  setContext<Current<Chart | null>>(chartKey, {
    get current() {
      return read();
    },
  });
}

/**
 * The chart of the nearest enclosing `<Chart>` or `<ChartShell>`. Its `current`
 * is null during server rendering and until the component has mounted, then
 * the chart, so an `$effect` that reads it runs again once the chart exists,
 * and its clean-up runs before the chart is destroyed. Outside a chart
 * component `current` is always null. Call it while the component is being set
 * up, like `getContext`.
 */
export function useChart(): Current<Chart | null> {
  return hasContext(chartKey) ? getContext<Current<Chart | null>>(chartKey) : empty;
}
