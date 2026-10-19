# charton plugin starter

A template for a charton plugin: one drawing tool (`Price tag`) and one indicator (`Midpoint`), bundled as a `ChartPlugin` that installs and uninstalls in one step.

```ts
import { starterPlugin } from 'charton-plugin-starter';

chart.install(starterPlugin);   // registers the tool and the indicator
chart.indicators.add('charton-plugin-starter/midpoint');
chart.uninstall('charton-plugin-starter'); // removes both again
```

The tool needs drawings on the chart and the indicator needs indicators: create it with the `drawings()` or `drawingTools()` plugin and `indicators()` (or `builtins()`, as the UI shell does), or registering them throws a `not-registered` error.

## Make it yours

1. Copy this folder out of the repository and rename the package (`charton-plugin-<what-it-does>`). Keep the `charton-plugin` keyword so people can find it.
2. Change `ID` in `src/index.ts` to the package name: every tool type and indicator id starts with it.
3. Replace the tool and the indicator with your own, and register them in `install`. Add toolbar items with `shellOf(ctx)` from `@chart-on/ui` if your plugin has a button.
4. Set `requires` to the core versions you test against, and keep `@chart-on/core` a peer dependency so the app's copy is used.
5. `pnpm build` writes `dist/`; `pnpm test` runs the tests in `test/` against a fake browser from `@chart-on/core/testing`.

See [Plugins](https://github.com/chart-on/chart-on/blob/main/docs/guide/plugins.md) for the context `install` gets, and for publishing.

Licensed under Apache-2.0, like charton. You may license your own plugin as you choose.
