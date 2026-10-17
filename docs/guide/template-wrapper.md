---
description: "Mount the chart or the shell as components with @charton/vue: props watched and applied in place, a template ref or composable for the instance, events as callbacks, and server rendering."
---

# Template component wrapper

`@charton/vue` wraps the engine and the shell as components and composables for apps built with a template-based component framework (version 3.5 or later), including apps that render every page on the server first. It follows the [wrapper contract](./frameworks#the-wrapper-contract): the chart is created when the component mounts and destroyed when it unmounts, and changing a prop updates the chart in place instead of creating a new one.

| Export | From | What it is |
| --- | --- | --- |
| `<Chart>` | `@charton/vue` | The engine alone, in a `div`. |
| `useChart()` | `@charton/vue` | A ref holding the `Chart` of the nearest `<Chart>` or `<ChartShell>`. |
| `<ChartShell>` | `@charton/vue/shell` | The widget: toolbar, drawing rail, bottom bar and the chart. |
| `useChartShell()` | `@charton/vue/shell` | A ref holding the `ChartShell` of the nearest `<ChartShell>`. |

## Install

```bash
pnpm add @charton/vue @charton/core
# Only for <ChartShell>:
pnpm add @charton/ui
```

The framework (version 3.5 or later), `@charton/core` and `@charton/ui` are peer dependencies: the app installs them once and the wrapper uses the app's copies. `@charton/ui` is optional, because `<ChartShell>` lives in its own entry, `@charton/vue/shell`. An app that only imports `@charton/vue` never loads it.

The components are plain component objects, so they need no compiler plugin. Import them where you use them, or register them globally with `app.component('Chart', Chart)`.

## The engine

Give the component a height; the chart fills its container. `class`, `style` and other attributes go to the container `div`.

```vue
<script setup lang="ts">
import { createMockDataSource, dataSource as dataSourcePlugin } from '@charton/core';
import { Chart } from '@charton/vue';

defineProps<{ symbol: string }>();
// Created once per component instance: a new source reloads the data.
const dataSource = createMockDataSource();
const options = { barSpacing: 8, plugins: [dataSourcePlugin()] };
</script>

<template>
  <Chart style="height: 480px" :options="options" :data-source="dataSource" :symbol="symbol" interval="1h" />
</template>
```

| Prop | Applied with | Notes |
| --- | --- | --- |
| `options` | `createChart` at mount, then `chart.applyOptions` | Watched deeply. Plain data in it is compared by value, so an object literal in the template does not apply again on every render, and a change inside a reactive object applies. Functions, dates and class instances inside it are compared by identity: a formatter written inline in the template is new on every render and applies the options again each time, so define callbacks once in the script. The chart gets a plain copy, never a reactive proxy. Leaving out a key does not reset it; pass the value you want. |
| `dataSource` | `chart.setDataSource` | Changing it attaches the new source and loads `symbol` again. Keep it in a plain variable, a `shallowRef` or `markRaw`: the wrapper unwraps a reactive one, but a deeply reactive source makes its own work slower. Removing the prop keeps the current source; pass `null` to detach it. The chart needs the `dataSource()` plugin in `options.plugins` (or `builtins()`); without it the source is not attached and development builds warn once ([`data-source-missing`](./errors#data-source-missing)). |
| `symbol`, `interval` | `chart.setSymbol` | Loads once both are set and a `dataSource` is given; loads again when either changes. A failed load emits `data:error`. |
| `on` | `chart.on` | Event callbacks, see [Events](#events). |

A prop left out, or set to `undefined` after having a value, leaves the chart as it is: the wrapper stops controlling it but does not reset it. To detach the data source, pass `null`.

A few options are fixed when the chart is created, for example `gl`. Changing them in `options` later has no effect; remount the component on purpose with a new `key` instead.

One of them is `plugins`, which gives the chart [opt-in features](./features#opt-in-features) such as annotations, drawings and heatmaps: put `plugins: chartPlugins` in `options`, with `const chartPlugins = builtins()` at module scope. Create the list once, since the functions in it are compared by identity.

## Reaching the chart

The component gives the app the `Chart` it created, with the whole imperative API. It exists only while the component is mounted: it is null during server rendering and before the first mount. The wrapper keeps it out of deep reactivity (`shallowRef` and `markRaw`), so calling into it never goes through a proxy. Do the same if you store it yourself: `shallowRef`, not `ref` or `reactive`.

With a template ref, which reaches the component's exposed `chart`:

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { Chart, type ChartExposed } from '@charton/vue';

const view = useTemplateRef<ChartExposed>('view');
</script>

<template>
  <button @click="view?.chart?.fitContent()">Fit</button>
  <Chart ref="view" style="height: 400px" />
</template>
```

With `useChart()` in a component inside the default slot. It returns a ref that holds null until the chart exists, so a `watch` on it runs at the right time, and its clean-up runs before the chart is destroyed:

```vue
<!-- Candles.vue -->
<script setup lang="ts">
import { onWatcherCleanup, watch } from 'vue';
import type { Bar } from '@charton/core';
import { useChart } from '@charton/vue';

const props = defineProps<{ bars: Bar[] }>();
const chart = useChart();

watch(
  [chart, () => props.bars],
  ([current, bars]) => {
    if (!current) return;
    const series = current.addCandles();
    series.setData(bars);
    onWatcherCleanup(() => current.removeSeries(series));
  },
  { immediate: true },
);
</script>
```

```vue
<template>
  <Chart style="height: 400px">
    <Candles :bars="bars" />
  </Chart>
</template>
```

For live ticks, keep the series handle and call `series.update(bar)`: data never travels through a remount.

## Events

The `on` prop takes one callback per event, keyed by the chart's own event names. Only the events listed are subscribed, so leave out the busy ones (`crosshair:move`, `frame:render`) unless you use them. The payload is passed on unchanged.

```vue
<Chart
  style="height: 400px"
  :on="{
    'crosshair:move': (e) => (hover = e?.time ?? null),
    'data:error': (e) => console.warn(e.symbol, e.error),
  }"
/>
```

A new callback for the same event is used straight away without subscribing again, so inline functions are fine. Removing a key unsubscribes it, and unmounting unsubscribes everything.

Events come through a prop rather than `@event` listeners because the chart and the shell share some event names (`theme:change`): `on` and `shellOn` say which one you mean.

## The widget

`<ChartShell>` mounts the full shell. Import its stylesheet once in the app.

```vue
<script setup lang="ts">
import { ChartShell } from '@charton/vue/shell';
import '@charton/ui/style.css';

defineProps<{ dark: boolean }>();
</script>

<template>
  <ChartShell
    style="height: 600px"
    :theme="dark ? 'dark' : 'light'"
    :features="{ tooltip: true }"
    :shell-options="{ navigator: true }"
    :shell-on="{ 'theme:change': (e) => console.log(e.resolved) }"
  />
</template>
```

It takes the same `options`, `dataSource`, `symbol`, `interval` and `on` props and container attributes as `<Chart>`, plus:

| Prop | Applied with | Notes |
| --- | --- | --- |
| `theme` | `shell.setTheme` | `dark`, `light` or `system`. |
| `palette` | `shell.setPalette` | |
| `features` | `shell.applyFeatures` | Compared by value. |
| `shellOptions` | `createChartShell` at mount | Toolbar, rail, dialogs and the rest of the set-up. Read once; remount with a new `key` to change them. |
| `shellOn` | `shell.on` | Shell event callbacks, like `on`. |

As with `<Chart>`, setting `theme`, `palette` or `features` to `undefined` leaves the shell as it is, including a theme the user picked in the shell.

A template ref reaches `shell` and its `chart` (type `ChartShellExposed`). Inside the shell, `useChart()` holds that chart and `useChartShell()` the shell.

## Kept-alive components

Inside `<KeepAlive>`, a hidden component is not unmounted: the chart, its data and its view stay. While hidden the chart has no size, so it draws nothing; when shown again it measures its container and draws at the right size straight away.

## Server rendering

Both entries import on a server without touching a browser global, and both components render on a server as their container `div` with the slot content inside. The chart is created in the mount hook, which runs only in the browser, after the page has hydrated. Nothing is needed to opt in: meta-frameworks that render every page on the server and then hydrate it can use the components like any other, and `useChart()` holds null until the browser mounts the chart.

To skip server rendering for a page section altogether, for example a section that only makes sense with a chart, wrap it in the framework's client-only component (often `<ClientOnly>`). The wrapper does not need it.

## Tests

Tests mount each component, change every prop and check that the same instance received the matching method call, check that events the first load emits while mounting reach the callbacks, hide and show a kept-alive chart, unmount it and check that no WebGL context or animation frame is left (also over 100 mount and unmount cycles), render both components on a server, and hydrate server HTML without mismatches.
