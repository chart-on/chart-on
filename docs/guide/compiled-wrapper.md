---
description: "Mount the chart or the shell with @chart-on/svelte: components and an action whose props apply in place, bindings or context helpers for the instance, events as callbacks, and server rendering."
---

# Compiled component wrapper

`@chart-on/svelte` wraps the engine and the shell as components, an action and context helpers for apps built with a compiler-based component framework (version 5.18 or later, with runes), including apps whose app framework renders every page on the server first. It follows the [wrapper contract](./frameworks#the-wrapper-contract): the chart is created when the component mounts and destroyed when it unmounts, and changing a prop updates the chart in place instead of creating a new one.

| Export | From | What it is |
| --- | --- | --- |
| `<Chart>` | `@chart-on/svelte` | The engine alone, in a `div`. |
| `use:chart` | `@chart-on/svelte` | The engine in an element of your own, for minimal set-ups. |
| `useChart()` | `@chart-on/svelte` | The `Chart` of the nearest `<Chart>` or `<ChartShell>`, as `.current`. |
| `<ChartShell>` | `@chart-on/svelte/shell` | The widget: toolbar, drawing rail, bottom bar and the chart. |
| `useChartShell()` | `@chart-on/svelte/shell` | The `ChartShell` of the nearest `<ChartShell>`, as `.current`. |

## Install

```bash
pnpm add @chart-on/svelte @chart-on/core
# Only for <ChartShell>:
pnpm add @chart-on/ui
```

The framework (version 5.18 or later), `@chart-on/core` and `@chart-on/ui` are peer dependencies: the app installs them once and the wrapper uses the app's copies. `@chart-on/ui` is optional, because `<ChartShell>` lives in its own entry, `@chart-on/svelte/shell`. An app that only imports `@chart-on/svelte` never loads it.

The package ships its components as source, with the types already taken out, as the framework's packages usually do: the app's own compiler builds them, for the browser and for the server, with the same version and settings as the rest of the app. The framework's bundler plugin picks them up through the `svelte` export condition; nothing needs configuring.

## The engine

Give the component a height; the chart fills its container. `class`, `style` and other attributes go to the container `div`.

```svelte
<script lang="ts">
  import { createMockDataSource, dataSource as dataSourcePlugin } from '@chart-on/core';
  import { Chart } from '@chart-on/svelte';

  let { symbol }: { symbol: string } = $props();
  // Created once per component instance: a new source reloads the data.
  const dataSource = createMockDataSource();
  const plugins = [dataSourcePlugin()];
</script>

<Chart style="height: 480px" options={{ barSpacing: 8, plugins }} {dataSource} {symbol} interval="1h" />
```

| Prop | Applied with | Notes |
| --- | --- | --- |
| `options` | `createChart` at mount, then `chart.applyOptions` | Plain data in it is compared by value, so an object literal in the markup does not apply again when it is rebuilt, and a change inside a `$state` object applies. Functions, dates and class instances inside it are compared by identity: a formatter written inline in the markup is new each time and applies the options again, so define callbacks once in the script. The chart gets a plain copy, never a state proxy. Leaving out a key does not reset it; pass the value you want. |
| `dataSource` | `chart.setDataSource` | Changing it attaches the new source and loads `symbol` again. Keep it in a `const` or in `$state.raw`. Deep `$state` wraps a source made of plain objects in a proxy, and the wrapper cannot tell a proxy from the object, so the chart gets the proxy and calls through it: it still works, but every call the chart makes on it goes through the state system. Removing the prop keeps the current source, and a new `symbol` or `interval` still loads from it; pass `null` to detach it. The chart needs the `dataSource()` plugin in `options.plugins` (or `builtins()`); without it the source is not attached and development builds warn once ([`data-source-missing`](./errors#data-source-missing)). |
| `symbol`, `interval` | `chart.setSymbol` | Loads once both are set and a `dataSource` is given; loads again when either changes. A failed load emits `data:error`. |
| `on` | `chart.on` | Event callbacks, see [Events](#events). |

A prop left out, or set to `undefined` after having a value, leaves the chart as it is: the wrapper stops controlling it but does not reset it, and keeps using its last value when another prop changes. Setting it back to that same value applies nothing. To detach the data source, pass `null`.

A few options are fixed when the chart is created, for example `gl`. Changing them in `options` later has no effect; remount the component on purpose instead, for example inside a `{#key}` block.

## Reaching the chart

The component gives the app the `Chart` it created, with the whole imperative API. It exists only while the component is mounted: it is null during server rendering and before the first mount. The chart is a class instance, so `$state` keeps it as it is, without a proxy; `$state.raw` makes that explicit.

With `bind:chart`:

```svelte
<script lang="ts">
  import type { Chart as ChartInstance } from '@chart-on/core';
  import { Chart } from '@chart-on/svelte';

  let chart: ChartInstance | null = $state.raw(null);
</script>

<button onclick={() => chart?.fitContent()}>Fit</button>
<Chart bind:chart style="height: 400px" />
```

The component sets the binding; the app only reads it.

With `useChart()` in a component rendered inside `<Chart>`. Its `current` is null until the chart exists, so an `$effect` that reads it runs again at the right time, and the effect's clean-up runs before the chart is destroyed:

```svelte
<!-- Candles.svelte -->
<script lang="ts">
  import type { Bar } from '@chart-on/core';
  import { useChart } from '@chart-on/svelte';

  let { bars }: { bars: Bar[] } = $props();
  const chart = useChart();

  $effect(() => {
    const current = chart.current;
    if (!current) return;
    const series = current.addCandles();
    series.setData(bars);
    return () => current.removeSeries(series);
  });
</script>
```

```svelte
<Chart style="height: 400px">
  <Candles {bars} />
</Chart>
```

Call `useChart()` while the component is being set up, as with `getContext`. Outside a chart component its `current` is always null.

For live ticks, keep the series handle and call `series.update(bar)`: data never travels through a remount.

## Events

The `on` prop takes one callback per event, keyed by the chart's own event names. Only the events listed are subscribed, so leave out the busy ones (`crosshair:move`, `frame:render`) unless you use them. The payload is passed on unchanged.

```svelte
<Chart
  style="height: 400px"
  on={{
    'crosshair:move': (e) => (hover = e?.time ?? null),
    'data:error': (e) => console.warn(e.symbol, e.error),
  }}
/>
```

A new callback for the same event is used straight away without subscribing again, so inline functions are fine. Removing a key unsubscribes it, and unmounting unsubscribes everything. The events the first load emits while the component mounts, such as `symbol:change`, already reach the callbacks.

Events come through one prop rather than one `on…` prop per event because the chart and the shell share some event names (`theme:change`): `on` and `shellOn` say which one you mean.

## The action

For a page that needs only the engine and no children, `use:chart` mounts it in an element you already have. It takes the same `options`, `dataSource`, `symbol`, `interval` and `on` as `<Chart>`, compared the same way, plus `ref`, a callback that receives the chart after it is created and null after it is destroyed. When the parameters bring a different `ref`, the old one receives null and the new one the chart, so an inline arrow function is called again on every update; define it once in the script to avoid that.

```svelte
<script lang="ts">
  import { createMockDataSource, type Chart as ChartInstance } from '@chart-on/core';
  import { chart } from '@chart-on/svelte';

  let { symbol }: { symbol: string } = $props();
  const dataSource = createMockDataSource();
  let instance: ChartInstance | null = $state.raw(null);
  const keep = (created: ChartInstance | null) => (instance = created);
</script>

<div style="height: 400px" use:chart={{ dataSource, symbol, interval: '1h', ref: keep }}></div>
```

Actions run only in the browser, so the action is as safe in server-rendered pages as the components. There is no `useChart()` inside the element: use `ref`.

## The widget

`<ChartShell>` mounts the full shell. Import its stylesheet once in the app.

```svelte
<script lang="ts">
  import { ChartShell } from '@chart-on/svelte/shell';
  import '@chart-on/ui/style.css';

  let { dark }: { dark: boolean } = $props();
</script>

<ChartShell
  style="height: 600px"
  theme={dark ? 'dark' : 'light'}
  features={{ tooltip: true }}
  shellOptions={{ navigator: true }}
  shellOn={{ 'theme:change': (e) => console.log(e.resolved) }}
/>
```

It takes the same `options`, `dataSource`, `symbol`, `interval` and `on` props and container attributes as `<Chart>`, plus:

| Prop | Applied with | Notes |
| --- | --- | --- |
| `theme` | `shell.setTheme` | `dark`, `light` or `system`. |
| `palette` | `shell.setPalette` | |
| `features` | `shell.applyFeatures` | Compared by value. |
| `shellOptions` | `createChartShell` at mount | Toolbar, rail, dialogs and the rest of the set-up. Read once; remount, for example inside a `{#key}` block, to change them. |
| `shellOn` | `shell.on` | Shell event callbacks, like `on`. |

As with `<Chart>`, setting `theme`, `palette` or `features` to `undefined` leaves the shell as it is, including a theme the user picked in the shell. Setting the prop again applies it again.

`bind:shell` reaches the shell and `bind:chart` its chart. Inside the shell, `useChart()` holds that chart and `useChartShell()` the shell.

## Server rendering

Both entries import on a server without touching a browser global, and both components render on a server as their container `div` with their children inside. The chart is created in `onMount`, which runs only in the browser, after the page has hydrated. Nothing is needed to opt in: an app framework that renders every page on the server and then hydrates it can use the components like any other, and `useChart()` holds null until the browser mounts the chart.

To skip server rendering for a page altogether, for example a page that only makes sense with a chart, turn it off for that route in the app framework. The wrapper does not need it.

## Example apps

Two small apps in the repository show the components in use:

- [`examples/svelte-bundler`](https://github.com/chart-on/charton/tree/main/examples/svelte-bundler): the widget in a client-rendered app, with a theme switch, `fitContent()` through `bind:shell` and a crosshair readout through `on`.
- [`examples/svelte-ssr`](https://github.com/chart-on/charton/tree/main/examples/svelte-ssr): `<Chart>` rendered to HTML on the server and hydrated in the browser, served by a small Node server.

CI builds both and renders the server example in Node with `node scripts/check-examples.mjs`.

## Tests

Tests mount each component and the action, change every prop and check that the same instance received the matching method call, check that events the first load emits while mounting reach the callbacks, check that children's effects clean up before the chart is destroyed, unmount and check that no WebGL context or animation frame is left (also over 100 mount and unmount cycles), render both components on a server, and import both entries on a server without touching a browser global.
