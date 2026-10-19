---
description: "Large faint text or an image behind the series, such as the symbol and interval."
---

# Watermark

A watermark is large, faint text or an image behind the series, typically the symbol and interval. It is drawn above the grid and below every series.

## Built-in watermark

Install the `watermark()` plugin (or `builtins()`), turn on the `watermark` [feature flag](./features) and the chart shows the symbol and interval it loads through its [data source](./data-sources). It updates on every symbol or interval switch.

```ts
import { createChart, dataSource, watermark } from '@chart-on/core';

const chart = createChart(el, { plugins: [dataSource(), watermark()], features: { watermark: true } });
chart.setDataSource(source);
await chart.setSymbol('BTCUSD', '1h'); // shows "BTCUSD" and "1h · <symbol name>"

chart.applyOptions({ features: { watermark: false } }); // hide it
```

`chart.watermark` is that watermark; without the plugin, reading it throws a `not-registered` [`ChartError`](./errors). Restyle it with `applyOptions`:

```ts
chart.watermark.applyOptions({ anchor: 'bottom-left', opacity: 0.6 });
```

Without a data source (data set with `setData`), set the text yourself:

```ts
chart.watermark.applyOptions({ lines: ['EURUSD', '15m'] });
```

The next symbol or interval loaded through the data source replaces `lines` again.

### Your name on the watermark

`author` adds a line above the others, for example the user's name or handle, so screenshots and shared charts show who made them. It is a separate option, so it stays while the symbol and interval lines change:

```ts
chart.watermark.applyOptions({ author: 'Jane Doe' });
chart.watermark.applyOptions({ author: '' }); // remove the line
```

The text is drawn as plain text at half the `fontSize`, trimmed, and cut to 40 characters (the last one becomes `…`). Empty or whitespace-only text adds no line. The line is part of the watermark, so it is in or out of screenshots together with the rest.

In the [UI shell](./ui-shell), the Watermark section of the appearance panel has a **Name** field next to the colour. Typing updates the watermark live; the text is saved with the other appearance choices (`watermarkText` in the saved overrides) and cleared by the section's **Reset**. Its label is the `appearanceWatermarkText` message.

### Line sizes

`authorSize` sets the size of the name line and `lineSizes` the size of each line by position. They outlast the data source replacing `lines`, so with the default lines `lineSizes: [symbol, interval]` sizes the symbol and the interval line:

```ts
chart.watermark.applyOptions({ authorSize: 20, lineSizes: [40, 16] });
chart.watermark.applyOptions({ authorSize: null, lineSizes: [] }); // back to the defaults
```

In the UI shell, the same section has **Name size**, **Symbol size** and **Interval size** fields (whole css px from 8 to 200; empty goes back to the default). They are saved as `watermarkSizes` with the other appearance choices and cleared by the section's **Reset**. Their labels are the `appearanceNameSize`, `appearanceSymbolSize` and `appearanceIntervalSize` messages.

### Project mark

The chart draws the project mark in the centre of the main pane while the `attributionLogo` [feature flag](./features) is on, which it is by default. While the built-in watermark shows, the chart sets its `logo` option from the flag, and the watermark draws the mark above its image and lines in the text colour, so the two never overlap. Turn it off with `features: { attributionLogo: false }`; in the UI shell, the appearance panel's Watermark section has a **Logo** switch (label `appearanceLogo`), saved as `logo` and cleared by **Reset**, which goes back to what your app set. A watermark you make with `createWatermark` draws the mark only when you set `logo: true` on it.

The built-in watermark draws in the main pane only, so it is hidden while that pane is collapsed or another pane is maximized. It is part of the chart image, so [screenshots](./events#screenshot-and-data-export) include it.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `visible` | `true` | Hide without detaching |
| `lines` | `[]` | Text lines, top to bottom: strings or `{ text, size?, weight? }` |
| `author` | `''` | A line above `lines`, e.g. the user's name: plain text, trimmed, at most 40 characters; empty adds none |
| `authorSize` | `null` | Size of the `author` line in css px; half of `fontSize` when `null` |
| `lineSizes` | `[]` | Sizes of `lines` by position in css px, over each line's own size; a missing or `null` entry keeps it |
| `logo` | `false` | Draw the project mark above the image and text, in the text colour. The chart keeps it in step with `features.attributionLogo` on the built-in watermark |
| `image` | `null` | Any `CanvasImageSource`, drawn above the text. An `<img>` that is still loading is drawn once it loads |
| `imageSize` | `null` | `{ width, height }` in css px; the image's natural size when `null` |
| `anchor` | `'center'` | `'center'`, `'top'`, `'bottom'`, `'left'`, `'right'`, `'top-left'`, `'top-right'`, `'bottom-left'` or `'bottom-right'`. Text aligns to the anchor's side |
| `margin` | `16` | Distance from the plot edges in css px |
| `color` | `null` | Text color; the theme's `watermark` token when `null` |
| `opacity` | `1` | Multiplies the color's alpha. Images are drawn at `opacity` times the color's alpha |
| `fontSize` | `48` | Size of string lines in css px. Object lines can set their own `size` |
| `fontFamily` | `null` | The theme's watermark font ([`typography.watermark`](./theming#typography)) when `null` |

When the plot is too small for the watermark, it scales down as a whole to fit inside the margins, and a line of text that would end up smaller than 4 px is dropped; the remaining lines and image are refitted without it. Text and image edges are snapped to whole device pixels of the canvas, so the watermark stays sharp at any pixel ratio.

## Theme

The color comes from the `watermark` theme key (CSS token `--pc-chart-watermark`, see [Theming](./theming)). The dark and light themes and the UI shell's stylesheet each set a faint value that suits their background, so a theme switch restyles the watermark too. Set `color` to override it for one watermark.

## Your own watermark

The watermark is an ordinary [primitive](./primitives), built only on the public API, so you can attach more of them: for example a logo in the corner of a pane. A primitive draws in the one pane it is attached to, so attach a watermark per pane to mark them all.

```ts
import { createWatermark } from '@chart-on/core';

const logo = new Image();
logo.src = '/logo.svg';
const mark = createWatermark({ image: logo, imageSize: { width: 96, height: 24 }, anchor: 'bottom-right', opacity: 0.5 });
const detach = chart.attachPrimitive(mark, { pane: 1 });
```

`watermark.follow(chart, format?)` keeps a watermark's lines in step with the chart's `data:loaded` events and returns an unsubscribe function. `format(symbol, interval)` returns the lines; the default is `symbolWatermarkLines`, which puts the symbol large and the interval and symbol name below it.

```ts
const stop = mark.follow(chart, (symbol, interval) => [symbol.exchange ?? '', `${symbol.symbol} ${interval}`]);
```

`layoutWatermark(ctx, env, options, origin?)` returns where the text and image would be drawn, for tests or for a primitive that draws its own watermark-like overlay. `origin` is where the area starts on the canvas in css px (default `{ x: 0, y: 0 }`), so the snapping lands on whole device pixels of the canvas.

The source, `packages/core/src/watermark.ts`, is meant as a reference for writing primitives: it keeps its options in a closure, requests redraws through the host it is attached to, redraws when an image finishes loading, and reads its colors from `env.theme` at draw time so it follows theme changes without any listener.
