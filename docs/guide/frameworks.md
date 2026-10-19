---
description: "Use the chart without a framework (bundler or script tag), import it in server-rendered apps, and the lifecycle contract every framework wrapper follows."
---

# Frameworks and plain pages

`@chart-on/core` and `@chart-on/ui` are plain TypeScript with no framework dependency. This page covers three things:

- [Plain pages](#plain-pages): a bundler, or a single script tag with no build step.
- [Server rendering](#server-rendering): what is safe to import and call on a server.
- [The wrapper contract](#the-wrapper-contract): the rules every framework wrapper follows, so components behave the same whichever framework you use. Follow them too when you write your own wrapper.

Ready-made wrappers ship as `@chart-on/react`, see [Component wrapper](./component-wrapper), `@chart-on/vue`, see [Template component wrapper](./template-wrapper), and `@chart-on/svelte`, see [Compiled component wrapper](./compiled-wrapper).

## Plain pages

### With a bundler

Import the packages as ES modules. Any bundler that understands `package.json` `exports` works, with no plugin or configuration.

```ts
import { createChart, createMockDataSource, dataSource } from '@chart-on/core';

const chart = createChart(document.getElementById('chart')!, { plugins: [dataSource()] });
chart.setDataSource(createMockDataSource());
await chart.setSymbol('DEMO', '1h');
```

With the shell, also import its stylesheet once:

```ts
import { createChartShell } from '@chart-on/ui';
import '@chart-on/ui/style.css';

const shell = createChartShell(document.getElementById('chart')!, { theme: 'system' });
```

### With a script tag

The script-tag build bundles the engine, the shell and its icons into a single file. `pnpm build` writes it to `packages/ui/dist/browser/`:

| File | Use |
| --- | --- |
| `charton.iife.js` | A classic script that defines the global `charton`. Works from any page, also opened straight from disk. |
| `charton.js` | The same as one ES module, for `<script type="module">` and `import`. |
| `style.css` | The shell's stylesheet. The engine alone does not need it. |

Each comes with a source map. Both scripts are production builds, without the [development warnings](./errors#development-warnings); import the packages through a bundler to get them. Copy the files you use next to your page:

```html
<link rel="stylesheet" href="./style.css" />
<div id="chart" style="height: 480px"></div>

<script src="./charton.iife.js"></script>
<script>
  const { createChartShell, createMockDataSource } = charton;
  const shell = createChartShell(document.getElementById('chart'), { theme: 'dark' });
  shell.chart.setDataSource(createMockDataSource());
  shell.chart.setSymbol('DEMO', '1h');
</script>
```

Or as a module:

```html
<script type="module">
  import { createChart, createMockDataSource } from './charton.js';
  const chart = createChart(document.getElementById('chart'));
</script>
```

`charton` holds every export of `@chart-on/core` and `@chart-on/ui`, so the rest of this guide applies unchanged: `createChart(...)` becomes `charton.createChart(...)`. A complete page is in [`examples/script-tag/index.html`](https://github.com/chart-on/chart-on/blob/main/examples/script-tag/index.html).

Browsers load module scripts only over `http(s)`, so `charton.js` needs a local server, while `charton.iife.js` also works from `file://`.

Use the packages instead of this build when you have a bundler: they share one copy of the engine with `@chart-on/indicators` and plugins, and your bundler leaves out what you do not use.

## Server rendering

Frameworks that render on a server import your components there, so importing charton must not need a browser. It doesn't:

- Importing `@chart-on/core`, `@chart-on/core/testing`, `@chart-on/core/internal`, `@chart-on/ui`, `@chart-on/indicators` and `@chart-on/ta` reads no `window`, `document`, `navigator`, storage or WebGL. A test checks this for every entry.
- Pure helpers (formatting, intervals, indicator math, `parseCsv`, layout migration) work on a server.
- `isWebGL2Supported()` returns `false` on a server instead of throwing.
- `createChart` and `createChartShell` need a DOM. Call them only in the browser, after the element exists: in the framework's mount hook, never during rendering.

Importing `@chart-on/ui/style.css` is a stylesheet import; let your framework's CSS handling take care of it, as for any other package stylesheet.

## The wrapper contract

A framework wrapper is a thin component around `createChart` (or `createChartShell`). Every wrapper follows these rules, so apps can move between frameworks and get the same behaviour.

### 1. Create on mount, destroy on unmount

- Create the chart or shell when the component's element is in the page: the mount hook, never the render function, and never on a server.
- Call `destroy()` when the component unmounts. It stops the frame loop, timers, observers and listeners, releases the WebGL context and removes the chart's element.
- `destroy()` is idempotent on both `Chart` and `ChartShell`. Development modes that mount, unmount and mount again leave nothing behind: tests mount and destroy a chart and a shell 100 times each and check that no WebGL context, observer, global listener, timer or animation frame is left.
- Do not keep a destroyed chart around for a later mount. Create a new one.

```ts
// The shape of any wrapper, written without a framework.
function mountChart(el: HTMLElement, props: ChartProps) {
  const chart = createChart(el, props.options);
  return {
    chart,
    update: (next: ChartProps) => updateChart(chart, props, next),
    unmount: () => chart.destroy(),
  };
}
```

### 2. Update options in place

Changing a prop never re-creates the chart. Re-creating would lose the view, drawings, indicators and data, and costs a new WebGL context.

- Chart options go through `chart.applyOptions(patch)`. It is a deep-partial update, so pass only what changed. Passing the whole options object again is also fine.
- Shell settings go through the shell's runtime methods: `setTheme`, `setPalette`, `applyFeatures`.
- Symbol and interval go through `chart.setSymbol(symbol, interval)`; a data source through `chart.setDataSource(source)`.
- A few choices are fixed when the chart is created, for example `gl: 'own' | 'shared'`. A wrapper reads them only at mount. If an app needs to change one, it remounts the component on purpose, for example by changing a key.

### 3. Update data through the series

Data never travels through a remount.

- Data you hold yourself: keep the series handle from `chart.addCandles()` (or `addLine`, `addHistogram`, …) and call `series.setData(bars)` for a new data set, or `series.update(bar)` for a live tick.
- Data from a [data source](./data-sources): the chart loads, pages and streams it; the wrapper only passes the source and the symbol.

### 4. Expose the instance

The component gives the app the `Chart` (or `ChartShell`) it created, through the framework's usual way of reaching a component instance. The wrapper never hides part of the imperative API: anything the app can do with a chart it created itself, it can do through a wrapper. The instance exists only between mount and unmount, so it is empty during server rendering and before mount.

### 5. Forward events as framework callbacks

- Each event the app listens to is subscribed with `chart.on(name, listener)` (or `shell.on`), which returns an unsubscribe function. Call every unsubscribe on unmount; `destroy()` also drops the chart's listeners.
- Expose events in the framework's own style (callback props or component events), named after the chart's `noun:verb` event names. The payload is passed on unchanged.
- Subscribe only to events the app actually listens to: some, like `crosshair:move` and `frame:render`, fire on every pointer move or frame.
- When the app passes a new callback for the same event, call the newest one without re-subscribing, for example by keeping the latest callback in a variable the listener reads.

```ts
// Events, written without a framework: the listener always calls the newest handler.
function forwardEvents(chart: Chart, handlers: () => Partial<Record<keyof ChartEvents, (payload: never) => void>>) {
  const names = Object.keys(handlers()) as (keyof ChartEvents)[];
  const offs = names.map((name) => chart.on(name, (payload) => handlers()[name]?.(payload as never)));
  return () => offs.forEach((off) => off());
}
```

### 6. Keep the engine framework-free

A wrapper depends on `@chart-on/core` (and `@chart-on/ui` for the shell) as peer dependencies. The engine and the shell never depend on a framework, so they stay usable from plain pages and from every wrapper at once.

### Checklist for wrapper authors

- [ ] The chart is created in the mount hook and destroyed in the unmount hook.
- [ ] Mounting, unmounting and mounting again (development double mounting) leaves one chart and one WebGL context.
- [ ] Changing any prop except the creation-only ones keeps the same `Chart` instance.
- [ ] Data changes call `setData` / `update` on the series, not a remount.
- [ ] The instance is reachable by the app.
- [ ] Event props subscribe through `on` and unsubscribe on unmount; a new callback is used without re-subscribing.
- [ ] The component renders on a server without errors (it outputs only its container element).
