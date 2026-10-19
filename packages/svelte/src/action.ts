import type { ActionReturn } from 'svelte/action';
import { createChart, type Chart } from '@chart-on/core';
import { readInputs, startEngine, stopEngine, syncEvents, updateEngine, type ChartInputs } from './sync.js';

/** What `use:chart` takes: the engine inputs, plus a callback that receives the chart. */
export interface ChartActionParameters extends ChartInputs {
  /**
   * Called with the chart right after it is created, and with null when it is
   * destroyed. When a new callback replaces it, the old one gets null and the
   * new one the chart.
   */
  ref?: (chart: Chart | null) => void;
}

/**
 * Mount the chart engine in an existing element, for setups that need no
 * component: `<div use:chart={{ options, dataSource, symbol, interval }}>`.
 * Actions run only in the browser, so this is safe in server-rendered pages.
 * The chart is created when the element is added and destroyed when it is
 * removed; a change of the parameters updates it in place, with the same
 * comparisons as `<Chart>`. There is no `useChart()` inside: use `ref`.
 */
export function chart(node: HTMLElement, parameters: ChartActionParameters = {}): ActionReturn<ChartActionParameters> {
  let latest = parameters;
  const first = readInputs(latest);
  const engine = startEngine(createChart(node, first.options), first, () => latest.on);
  // The callback that last received the chart, so the one told about it is the one told it is gone.
  let ref = latest.ref;
  ref?.(engine.chart);
  return {
    update(next = {}) {
      latest = next;
      updateEngine(engine, readInputs(next));
      syncEvents(engine.chart, engine.events, () => latest.on);
      if (next.ref === ref) return;
      ref?.(null);
      ref = next.ref;
      ref?.(engine.chart);
    },
    destroy() {
      stopEngine(engine);
      ref?.(null);
    },
  };
}
