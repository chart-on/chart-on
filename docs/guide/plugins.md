---
description: "Bundle drawing tools, indicators, custom series and primitives into a plugin that installs and uninstalls in one step."
---

# Plugins

A plugin bundles extensions, such as drawing tools, indicators, custom series and primitives, behind one install step. Everything a plugin adds is removed again when it is uninstalled, so an app can switch a feature pack on and off, and a package on npm can say which core versions it works with.

```ts
import type { ChartPlugin } from '@chart-on/core';

export const measureKit: ChartPlugin = {
  name: 'acme-measure-kit',
  version: '1.2.0',
  requires: '^0.1.0', // core versions it works with
  install(ctx) {
    ctx.registerDrawingTool(rulerTool);
    ctx.registerIndicator(rangeIndicator);
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer); // anything else it set up
  },
};

const uninstall = chart.install(measureKit);
chart.installedPlugins; // ['acme-measure-kit']
uninstall();            // or chart.uninstall('acme-measure-kit')
```

## The context

`install(ctx)` adds the plugin's contributions through `ctx`. Each call is the chart's usual one, and the chart remembers it so uninstalling can undo it:

| Method | Does | Undone by uninstall |
| --- | --- | --- |
| `registerDrawingTool(def)` | `chart.drawings.register` (see [Custom drawing tools](./custom-drawing-tools)). Needs drawings on the chart (`drawings()`, `drawingTools()` or `builtins()`); without them it throws [`not-registered`](./errors#not-registered) | The tool is removed, or the tool of that type it replaced comes back. Drawings of the type stay in the data, undrawn, until a tool of that type is registered again |
| `registerIndicator(def)` | `chart.indicators.register` (see [Indicators](./indicators)). Needs indicators on the chart (`indicators()` or `builtins()`); without them it throws [`not-registered`](./errors#not-registered) | The definition is unregistered and its indicators become pending placeholders. A definition the app had registered itself stays. Indicators installed again while the plugin is installed get the definition back |
| `addCustomSeries(def, options, pane)` | `chart.addCustomSeries` (see [Custom series](./custom-series)) | The series is removed |
| `attachPrimitive(primitive, target)` | `chart.attachPrimitive` (see [Primitives](./primitives)) | The primitive is detached |
| `onFrame(observer)` | Watches the chart's frames: see [Frame observers](#frame-observers) | The observer stops being called |
| `onDispose(fn)` | Runs `fn` on uninstall | |

`ctx.chart` is the chart and `ctx.coreVersion` its version. `ctx.host(name)` returns what a layer above the chart offers plugins: the [UI shell](./ui-shell) offers `'shell'`, which `shellOf(ctx)` from `@chart-on/ui` wraps so the toolbar items a plugin adds are removed with it:

```ts
import { shellOf } from '@chart-on/ui';

install(ctx) {
  ctx.registerDrawingTool(rulerTool);
  shellOf(ctx)?.addToolbarItem({ type: 'button', id: 'acme-ruler', group: 'analysis', label: 'Ruler', icon: Ruler, onClick: (chart) => chart.drawings.setTool('acme-ruler') });
}
```

`shellOf` is null when the chart has no shell, so the same plugin works with and without it. A layer of your own can offer plugins something with `chart.setPluginHost(name, host)`; plugins installed afterwards see it. A function returned from `install` runs first on uninstall, then the contributions are undone, newest first.

## Frame observers

`ctx.onFrame(observer)` lets a plugin watch the frame loop, e.g. to time frames or count them. The built-in `statsOverlay()` plugin is one: the [render statistics](./performance#debugging-and-profiling) are built on it. Every member of the observer is optional and called synchronously:

| Member | Called |
| --- | --- |
| `request(reason)` | When something asks for a frame; `reason` is a `RedrawReason` such as `'series'`, `'view'` or `'host'` |
| `start()` | When a frame starts drawing |
| `lap(phase)` | When the frame finishes a phase: `'autoscale'`, `'drawBottom'`, `'drawGL'`, `'drawTop'` or `'drawCursor'` (see `FrameTimes`), or `null` for work between phases. Only the phases the frame draws are reported |
| `end(kind)` | When the frame is drawn: `'scene'`, `'overlay'` or `'cursor'`, the layers it redrew |

`request` runs on every redraw request, crosshair moves included, and the others on every drawn frame, so keep them cheap.

```ts
import type { ChartPlugin } from '@chart-on/core';

const frameCounter: ChartPlugin = {
  name: 'acme-frame-counter',
  version: '1.0.0',
  install(ctx) {
    let frames = 0;
    ctx.onFrame({ end: () => frames++ });
  },
};
```

## Rules

- `name` must be unique per chart: installing a second plugin of the same name throws.
- `requires` is a semantic-version range checked against `CORE_VERSION`: exact versions, `>=`, `>`, `<=`, `<`, `^`, `~`, `x` ranges (`0.x`, `1.2.*`), sets separated by spaces (all must match) and alternatives with `||`. Pre-release tags are ignored. A version outside the range, or a range that cannot be read, throws a `ChartError` with code [`plugin-incompatible`](./errors#plugin-incompatible) before `install` runs.
- If `install` throws, everything it added so far is undone and the error is rethrown: a failed install leaves nothing behind.
- `chart.destroy()` uninstalls every plugin, newest first. `install` after `destroy()` throws.

## Writing and publishing a plugin

The repository has a starter package, [`examples/plugin-starter`](https://github.com/chart-on/charton/tree/main/examples/plugin-starter): one drawing tool and one indicator, its own build, and tests that use [`@chart-on/core/testing`](./testing). The repository builds and tests it on every change, so a change to the plugin contract shows up there first. Copy it to start a plugin of your own.

- **Name** the package `charton-plugin-<what-it-does>` (or `@scope/charton-plugin-<…>`) and add the `charton-plugin` keyword, so people can find it.
- **Prefix ids** with the package name: drawing tool types and indicator ids such as `acme-measure-kit/ruler`, so they never clash with the built-ins or with other plugins.
- **Depend on core as a peer**: `"peerDependencies": { "@chart-on/core": "^0.1.0" }`, and keep it external in your build, so the app's copy of the chart is the one your plugin registers with. `@chart-on/ui` is an optional peer if you use `shellOf`.
- **Version** with semantic versioning, and keep `requires` to the core versions you test against; a minor core release can add to the contract, a major one can change it.
- **License** your plugin as you choose. charton is Apache-2.0; a plugin that copies code from this repository keeps its notices.

To have your plugin listed, see [Community plugins](./community-plugins).
