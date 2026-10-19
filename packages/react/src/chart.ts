import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createChart, type Chart as CoreChart, type ChartEvents } from '@chart-on/core';
import { ChartContext } from './context';
import { clearEvents, keepUnset, syncChart, syncEvents, type ChartEventHandlers, type ChartInputs } from './sync';

/** The props of `<Chart>`: chart options and data, plus event handlers and container attributes. */
export interface ChartProps extends ChartInputs {
  /**
   * Chart events to listen to, keyed by event name, e.g.
   * `{ 'crosshair:move': (e) => … }`. Only the events listed here are
   * subscribed. A new callback for the same event is used without subscribing
   * again.
   */
  on?: ChartEventHandlers;
  /** Attributes of the container element. Give it a height: the chart fills it. */
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Rendered inside the container; `useChart()` in them returns this chart. */
  children?: ReactNode;
}

/** What a mounted component keeps between renders. */
interface Mounted {
  chart: CoreChart;
  /** The props the chart was last brought in line with. */
  inputs: ChartInputs;
  events: Map<keyof ChartEvents, () => void>;
}

/**
 * The chart engine alone, in a `div`. The chart is created when the component
 * mounts and destroyed when it unmounts; prop changes update it in place.
 * The `ref` receives the `Chart` while the component is mounted, and null
 * otherwise (always null on a server).
 */
export const Chart = forwardRef<CoreChart | null, ChartProps>(function Chart(props, ref) {
  const element = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const handlers = useRef(props.on);
  const [chart, setChart] = useState<CoreChart | null>(null);

  // Mount: runs only in the browser, once per mount (twice in development double mounting).
  useEffect(() => {
    const created = createChart(element.current!, props.options);
    const state: Mounted = { chart: created, inputs: props, events: new Map() };
    // Listen first: loading the symbol below emits events straight away.
    syncEvents(created, state.events, props.on, () => handlers.current);
    syncChart(created, null, props);
    mounted.current = state;
    setChart(created);
    return () => {
      clearEvents(state.events);
      created.destroy();
      mounted.current = null;
      setChart(null);
    };
    // No dependencies on purpose: later prop changes go through the update effect below,
    // never through a new chart.
  }, []);

  // Update: after every commit, apply what changed since the last one.
  useEffect(() => {
    handlers.current = props.on;
    const state = mounted.current;
    if (!state) return;
    const next = keepUnset(state.inputs, props);
    syncChart(state.chart, state.inputs, next);
    syncEvents(state.chart, state.events, props.on, () => handlers.current);
    state.inputs = next;
  });

  useImperativeHandle<CoreChart | null, CoreChart | null>(ref, () => chart, [chart]);

  return createElement(
    ChartContext.Provider,
    { value: chart },
    createElement('div', { ref: element, id: props.id, className: props.className, style: props.style }, props.children),
  );
});
