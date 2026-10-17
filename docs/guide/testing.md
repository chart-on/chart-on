---
description: "Unit-test the code around the chart under Node: a fake browser environment, sample bars, frame control and scene snapshots."
---

# Testing your integration

`@charton/core/testing` lets you test the code you write around the chart, such as toolbar wiring, data mapping and saved layouts, in a Node test runner, without a browser or a GPU. It is a separate entry: nothing in the main bundle imports it, so it costs your app nothing.

```ts
import { afterEach, expect, it } from 'vitest';
import { createChart, volumeOf } from '@charton/core';
import { describeScene, flushFrames, installTestEnvironment, sampleBars } from '@charton/core/testing';

const env = installTestEnvironment({ width: 960, height: 540 });
afterEach(() => env.uninstall());

it('lays out candles with a volume overlay', () => {
  const chart = createChart(env.container());
  chart.addCandles({ title: 'Sample', animate: false }).setData(sampleBars({ count: 300, seed: 42 }));
  chart.addHistogram({ title: 'Volume', follow: volumeOf, overlay: { top: 0.8, bottom: 0 } });
  flushFrames();
  expect(describeScene(chart)).toMatchSnapshot();
  chart.destroy();
});
```

## The environment

`installTestEnvironment({ width, height, devicePixelRatio })` puts just enough DOM, Canvas2D and WebGL2 on `globalThis` for a chart to run: layout, data, scales, events and the frame loop behave as in a browser, and drawing calls do nothing. Every element reports the given size (default 800 × 600). `container()` makes an element to create a chart in, and `uninstall()` puts back the globals it replaced.

Run these tests in the runner's Node environment (in Vitest, `environment: 'node'`, the default). The environment replaces `document` and `window` outright, so it does not mix with a DOM environment such as jsdom or happy-dom.

## Frames

Nothing draws until a frame runs, and in tests frames run only when you ask:

| Helper | Does |
| --- | --- |
| `driveFrames({ count, step })` | Runs up to `count` frames (default 1), `step` ms apart (default 16), stopping early when none is pending. Timestamps keep increasing across calls, so eased animations advance. Returns how many ran |
| `flushFrames(max)` | Runs frames until none is pending: the chart has drawn and animations have settled. Throws after `max` frames (default 1000) |
| `waitForData(chart)` | Waits for the data source loads in flight, then flushes frames |

Autoscale and the visible range are worked out during a frame, so flush before reading them.

## Pointer input

`emitPointer(chart, { type, time, price, pane })` sends a mouse event at a time and price, through the chart's own input handling, so the crosshair, `plot:click`, drawing tools and hover events react as in a browser. `type` is `'move'`, `'click'` (a press and release in place), `'dblclick'` or `'leave'`. It returns `false` when the point has no position on the chart.

```ts
const seen: number[] = [];
chart.on('plot:click', (e) => seen.push(e.time));
emitPointer(chart, { type: 'click', time: bars[80].time, price: bars[80].close });
expect(seen).toEqual([bars[80].time]);
```

## Data

`sampleBars({ count, seed, interval, start, price })` returns deterministic OHLCV bars: a seeded random walk with prices rounded to cents. The same options give the same bars on every machine, so snapshots stay stable. To test a data source itself, use [`testDataSource`](./data-sources#check-your-adapter).

## Scene snapshots

`describeScene(chart)` returns a JSON-serialisable summary of what the chart shows:

- the chart size, bar spacing and visible time range
- per pane: its height, its price scales with their mode and visible price range, and its series with their kind, title, scale, visible point count, raw values at the newest bar (or the crosshair's) and legend text
- the drawings with their points
- app-owned annotations: markers, fills, price/trade/alert/draft lines, time bands, price zones and text labels

`visiblePointCount` counts raw time-aligned data items before grouping, including line gaps. Hidden series and collapsed panes report zero. For indicators it counts finite outputs of shown plots; for heatmaps it counts finite cells across the visible columns, including rows outside the price range. Computed series without time-indexed data, such as volume profiles, report zero.

Each annotation has its `kind`, target `pane` and `series` indices, handle visibility and scalar `options`. These indices stay stable across repeated chart creation; generated series ids, callbacks, images and structured options are omitted. App marker/fill ids stay in the summary. Data-source and indicator-owned markers are not included. Times retain six decimal places, while other numeric options use six significant digits; non-finite numeric options become `null`. Annotation order follows marker series, then fills, then the line, band, zone and label collections, preserving insertion order within each collection.

Numbers are rounded to 6 significant digits, so tiny floating-point differences between machines do not change a snapshot. Assert on parts of it, or snapshot the whole thing.
