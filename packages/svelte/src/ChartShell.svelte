<!--
  The batteries-included widget: toolbar, drawing rail, bottom bar and the
  chart, in a `div`. Import `@chart-on/ui/style.css` once in the app. The shell
  is created when the component mounts and destroyed when it unmounts; prop
  changes update it in place. `class`, `style` and other attributes go to the
  `div`. `bind:shell` and `bind:chart` reach the shell and its chart, and
  children render inside the `div`, where `useChart()` and `useChartShell()`
  return them.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createChartShell, type ChartShell, type ChartShellOptions, type ShellEvents, type ShellFeatures, type ShellPalette, type ShellTheme } from '@chart-on/ui';
  import { provideChart } from './context.js';
  import { provideShell } from './shell-context.js';
  import type { ChartShellProps } from './shell-types.js';
  import { clearEvents, handledNames, plainCopy, readInputs, sameValue, startEngine, syncEvents, type Engine } from './sync.js';
  import { watchEngine } from './watch.svelte.js';

  let {
    options,
    dataSource,
    symbol,
    interval,
    on,
    theme,
    palette,
    features,
    shellOptions,
    shellOn,
    shell = $bindable(null),
    chart = $bindable(null),
    children,
    ...attributes
  }: ChartShellProps = $props();

  interface Mounted {
    shell: ChartShell;
    engine: Engine;
    shellEvents: Map<keyof ShellEvents, () => void>;
    /** What the shell was last brought in line with, so equal values apply nothing. */
    theme?: ShellTheme;
    palette?: ShellPalette;
    features?: Partial<ShellFeatures>;
  }

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
  let mounted: Mounted | null = null;
  provideShell(() => shell);
  provideChart(() => chart);

  // Mount: runs only in the browser, never during server rendering. The clean-up runs after
  // the children's, so their effects still see a live shell when they tear down.
  onMount(() => {
    const first = readInputs(inputs);
    const set: ChartShellOptions = { ...plainCopy(shellOptions) };
    const firstFeatures = plainCopy(features);
    if (first.options) set.chart = first.options;
    if (theme) set.theme = theme;
    if (palette) set.palette = palette;
    if (firstFeatures) set.features = firstFeatures;
    const created = createChartShell(element, set);
    const shellEvents = new Map<keyof ShellEvents, () => void>();
    syncEvents(created, shellEvents, () => shellOn);
    const state: Mounted = { shell: created, engine: startEngine(created.chart, first, () => on), shellEvents, theme, palette, features: firstFeatures };
    mounted = state;
    shell = created;
    chart = created.chart;
    return () => {
      clearEvents(state.engine.events);
      clearEvents(state.shellEvents);
      state.shell.destroy();
      mounted = null;
      shell = null;
      chart = null;
    };
  });

  // Updates: apply what changed since the last time, never through a new shell. Like every
  // prop, a theme, palette or features left out or set to `undefined` leaves the shell as it is,
  // and setting it again applies it again, over what the user may have picked in the meantime.
  watchEngine(inputs, () => mounted?.engine ?? null);
  $effect(() => {
    const next = theme;
    untrack(() => {
      if (!mounted || next === mounted.theme) return;
      mounted.theme = next;
      if (next) mounted.shell.setTheme(next);
    });
  });
  $effect(() => {
    const next = palette;
    untrack(() => {
      if (!mounted || next === mounted.palette) return;
      mounted.palette = next;
      if (next) mounted.shell.setPalette(next);
    });
  });
  $effect(() => {
    const next = plainCopy(features);
    untrack(() => {
      if (!mounted || sameValue(next, mounted.features)) return;
      mounted.features = next;
      if (next) mounted.shell.applyFeatures(next);
    });
  });
  $effect(() => {
    handledNames(shellOn);
    untrack(() => mounted && syncEvents(mounted.shell, mounted.shellEvents, () => shellOn));
  });
</script>

<div bind:this={element} {...attributes}>{@render children?.()}</div>
