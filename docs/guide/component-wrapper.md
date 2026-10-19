---
description: "Mount the chart or the shell as components with @chart-on/react: props updated in place, a ref or hook for the instance, events as callbacks, and server rendering."
---

# Component wrapper

`@chart-on/react` wraps the engine and the shell as components for apps built with a component-based UI framework, including apps that render on a server first. It follows the [wrapper contract](./frameworks#the-wrapper-contract): the chart is created when the component mounts and destroyed when it unmounts, and changing a prop updates the chart in place instead of creating a new one.

| Export | From | What it is |
| --- | --- | --- |
| `<Chart>` | `@chart-on/react` | The engine alone, in a `div`. |
| `useChart()` | `@chart-on/react` | The `Chart` of the nearest `<Chart>` or `<ChartShell>`. |
| `<ChartShell>` | `@chart-on/react/shell` | The widget: toolbar, drawing rail, bottom bar and the chart. |
| `useChartShell()` | `@chart-on/react/shell` | The `ChartShell` of the nearest `<ChartShell>`. |

## Install

```bash
pnpm add @chart-on/react @chart-on/core
# Only for <ChartShell>:
pnpm add @chart-on/ui
```

The framework (version 18 or later), `@chart-on/core` and `@chart-on/ui` are peer dependencies: the app installs them once and the wrapper uses the app's copies. `@chart-on/ui` is optional, because `<ChartShell>` lives in its own entry, `@chart-on/react/shell`. An app that only imports `@chart-on/react` never loads it.

## The engine

Give the component a height; the chart fills its container.

```tsx
import { useMemo } from 'react';
import { createMockDataSource, dataSource } from '@chart-on/core';
import { Chart } from '@chart-on/react';

// Plugins are read once, at creation: create the list once.
const plugins = [dataSource()];

export function PriceChart({ symbol }: { symbol: string }) {
  // Keep the same source across renders: a new one reloads the data.
  const dataSource = useMemo(() => createMockDataSource(), []);
  return (
    <Chart
      style={{ height: 480 }}
      options={{ barSpacing: 8, plugins }}
      dataSource={dataSource}
      symbol={symbol}
      interval="1h"
    />
  );
}
```

| Prop | Applied with | Notes |
| --- | --- | --- |
| `options` | `createChart` at mount, then `chart.applyOptions` | Compared by value, so an inline object does not apply again on every render. Functions inside it, such as formatters, are compared by identity: create them once (module scope, `useMemo`) or every render applies the options again. Leaving out a key does not reset it; pass the value you want. |
| `dataSource` | `chart.setDataSource` | Changing it attaches the new source and loads `symbol` again. Keep it stable (`useMemo`, module scope). Removing the prop keeps the current source; pass `null` to detach it. The chart needs the `dataSource()` plugin in `options.plugins` (or `builtins()`); without it the source is not attached and development builds warn once ([`data-source-missing`](./errors#data-source-missing)). |
| `symbol`, `interval` | `chart.setSymbol` | Loads once both are set and a `dataSource` is given; loads again when either changes. A failed load emits `data:error`. |
| `on` | `chart.on` | Event callbacks, see [Events](#events). |
| `id`, `className`, `style` | | Attributes of the container `div`. |
| `children` | | Rendered inside the container. |

A few options are fixed when the chart is created, for example `gl`. Changing them in `options` later has no effect; remount the component on purpose with a new `key` instead.

One of them is `plugins`, which gives the chart [opt-in features](./features#opt-in-features) such as annotations, drawings and heatmaps: put `plugins: chartPlugins` in `options`, with `const chartPlugins = builtins()` at module scope. Create the list once, since the functions in it are compared by identity.

## Reaching the chart

The component gives the app the `Chart` it created, with the whole imperative API. It exists only while the component is mounted: it is null during server rendering and before the first mount.

With a ref:

```tsx
import { useRef } from 'react';
import type { Chart as ChartInstance } from '@chart-on/core';
import { Chart } from '@chart-on/react';

export function ChartWithButton() {
  const chart = useRef<ChartInstance | null>(null);
  return (
    <>
      <button onClick={() => chart.current?.fitContent()}>Fit</button>
      <Chart ref={chart} style={{ height: 400 }} />
    </>
  );
}
```

With `useChart()` in a child. The child renders once with null, then again with the chart once it exists, so effects that depend on it run at the right time:

```tsx
import { useEffect } from 'react';
import type { Bar } from '@chart-on/core';
import { Chart, useChart } from '@chart-on/react';

function Candles({ bars }: { bars: Bar[] }) {
  const chart = useChart();
  useEffect(() => {
    if (!chart) return;
    const series = chart.addCandles();
    series.setData(bars);
    return () => chart.removeSeries(series);
  }, [chart, bars]);
  return null;
}

export function OwnData({ bars }: { bars: Bar[] }) {
  return (
    <Chart style={{ height: 400 }}>
      <Candles bars={bars} />
    </Chart>
  );
}
```

For live ticks, keep the series handle and call `series.update(bar)`: data never travels through a remount.

## Events

The `on` prop takes one callback per event, keyed by the chart's own event names. Only the events listed are subscribed, so leave out the busy ones (`crosshair:move`, `frame:render`) unless you use them. The payload is passed on unchanged.

```tsx
<Chart
  style={{ height: 400 }}
  on={{
    'crosshair:move': (e) => setHover(e?.time ?? null),
    'data:error': (e) => console.warn(e.symbol, e.error),
  }}
/>
```

A new callback for the same event is used straight away without subscribing again, so inline functions are fine. Removing a key unsubscribes it, and unmounting unsubscribes everything.

## The widget

`<ChartShell>` mounts the full shell. Import its stylesheet once in the app.

```tsx
import { ChartShell } from '@chart-on/react/shell';
import '@chart-on/ui/style.css';

export function Terminal({ dark }: { dark: boolean }) {
  return (
    <ChartShell
      style={{ height: 600 }}
      theme={dark ? 'dark' : 'light'}
      features={{ tooltip: true }}
      shellOptions={{ navigator: true }}
      shellOn={{ 'theme:change': (e) => console.log(e.resolved) }}
    />
  );
}
```

It takes the same `options`, `dataSource`, `symbol`, `interval`, `on` and container props as `<Chart>`, plus:

| Prop | Applied with | Notes |
| --- | --- | --- |
| `theme` | `shell.setTheme` | `dark`, `light` or `system`. |
| `palette` | `shell.setPalette` | |
| `features` | `shell.applyFeatures` | Compared by value. |
| `shellOptions` | `createChartShell` at mount | Toolbar, rail, dialogs and the rest of the set-up. Read once; remount with a new `key` to change them. |
| `shellOn` | `shell.on` | Shell event callbacks, like `on`. |

The ref receives the `ChartShell`; its chart is `shell.chart`. Inside the shell, `useChart()` returns that chart and `useChartShell()` the shell.

## Server rendering

Both entries import on a server without touching a browser global, and both components render on a server as their empty container `div`. The chart is created only in the browser, after the page has loaded and the component has mounted. Nothing is needed to opt in.

### Frameworks with server components

The built files start with the `'use client'` marker, so frameworks that split server and client components treat `<Chart>` and `<ChartShell>` as client components: they render to HTML on the server and hydrate in the browser. You can use them from a server component, but props crossing that boundary must be serializable. A data source, a ref or an event callback is not, so put those in a small component of your own marked as a client component:

```tsx
'use client';
import { useMemo } from 'react';
import { createMockDataSource } from '@chart-on/core';
import { Chart } from '@chart-on/react';

export function LiveChart({ symbol }: { symbol: string }) {
  const dataSource = useMemo(() => createMockDataSource(), []);
  return <Chart style={{ height: 480 }} dataSource={dataSource} symbol={symbol} interval="1h" />;
}
```

A server component can then render `<LiveChart symbol="DEMO" />` and pass it plain values.

### Frameworks that render every page on the server

In frameworks without server components, where each page renders on the server and then hydrates, use the components like any other. The server outputs the container; the chart appears once the page hydrates. To skip server rendering for a page section altogether, use the framework's own client-only or lazy-loading helper; the wrapper does not need it.

## Example apps

Two small apps in the repository show the components in use:

- [`examples/react-bundler`](https://github.com/chart-on/chart-on/tree/main/examples/react-bundler): the widget in a client-rendered app, with a theme switch and a crosshair readout through `on`.
- [`examples/react-ssr`](https://github.com/chart-on/chart-on/tree/main/examples/react-ssr): `<Chart>` rendered to HTML on the server and hydrated in the browser, served by a small Node server.

CI builds both and renders the server example in Node with `node scripts/check-examples.mjs`.

## Development double mounting

Development modes that mount, unmount and mount again leave one chart and one WebGL context: the first chart is destroyed before the second is created. Tests check this, along with 100 mount and unmount cycles that leave no context or animation frame behind.
