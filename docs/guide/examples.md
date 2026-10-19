---
description: "Runnable examples, each a small file whose live chart and source code appear together."
---

# Examples

Every example below is a file in [`docs/examples`](https://github.com/chart-on/chart-on/tree/main/docs/examples): the chart runs that file, and the code under it is that file, so the two always match. Each exports a `mount(el, { dark, theme })` that draws into `el` and returns a clean-up function. `dark` is the page's colour scheme and `theme` the chart theme that matches the site; in your app, pass `darkTheme`, `lightTheme` or your own theme instead. `sampleBars` and the other helpers in [`sample-data.ts`](https://github.com/chart-on/chart-on/blob/main/docs/examples/sample-data.ts) stand in for your data and your server.

**Open in playground** under a chart opens its code in the [playground](/playground). Press **Run** there (code from a link never runs by itself), edit it, then copy a link that reproduces your version.

The full demo app lives in `apps/demo` (`pnpm dev`): synthetic data, liquidation heatmap, CVD pane and live ticks.

<!-- example-gallery -->
