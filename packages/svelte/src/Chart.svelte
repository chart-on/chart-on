<!--
  The chart engine alone, in a `div`. The chart is created when the component
  mounts and destroyed when it unmounts; prop changes update it in place.
  `class`, `style` and other attributes go to the `div`: give it a height, the
  chart fills it. `bind:chart` reaches the `Chart`, and children render inside
  the `div`, where `useChart()` returns it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { createChart } from '@charton/core';
  import { provideChart } from './context.js';
  import { readInputs, startEngine, stopEngine, type Engine } from './sync.js';
  import { watchEngine } from './watch.svelte.js';
  import type { ChartProps } from './types.js';

  let { options, dataSource, symbol, interval, on, chart = $bindable(null), children, ...attributes }: ChartProps = $props();

  // Getters, so the engine reads the props as they are now and each effect tracks only its own.
  const inputs = {
    get options() {
      return options;
    },
    get dataSource() {
      return dataSource;
    },
    get symbol() {
      return symbol;
    },
    get interval() {
      return interval;
    },
    get on() {
      return on;
    },
  };
  let element: HTMLDivElement;
  let engine: Engine | null = null;
  provideChart(() => chart);

  // Mount: runs only in the browser, never during server rendering. The clean-up runs after
  // the children's, so their effects still see a live chart when they tear down.
  onMount(() => {
    const first = readInputs(inputs);
    const started = startEngine(createChart(element, first.options), first, () => on);
    engine = started;
    chart = started.chart;
    return () => {
      stopEngine(started);
      engine = null;
      chart = null;
    };
  });

  // Updates: apply what changed since the last time, never through a new chart.
  watchEngine(inputs, () => engine);
</script>

<div bind:this={element} {...attributes}>{@render children?.()}</div>
