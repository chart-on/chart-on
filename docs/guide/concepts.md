---
description: "The rules behind everything else: unix-second times, panes, the main series and how bad values are handled."
---

# Core concepts

A few rules explain almost everything the chart does.

## Time is unix seconds

Every `time` in the API (bars, points, drawing anchors, events) is a unix timestamp in **seconds**. Never milliseconds. In development builds the chart warns when times look like milliseconds or are not whole seconds (see [Errors and warnings](./errors)).

## The main series defines the time axis

The first candle series you add becomes the **main series**. Its bars define the time axis: one slot per bar, evenly spaced, so gaps such as weekends do not leave empty space.

Other series align to those bar times. A point whose time has no matching main bar is not drawn; after the newest bar, the projected bar times count as matches (see [Time after the last bar](./view-and-scale#time-after-the-last-bar)).

```ts
const candles = chart.addCandles({ title: 'BTC' }); // main series
const ema = chart.addLine({ title: 'EMA 21' });     // aligns to candle times
```

Past the newest bar the time axis keeps going on a projected calendar, so times in the future have slots too (see [Time after the last bar](./view-and-scale#time-after-the-last-bar)).

Removing the main series clears the time axis.

## Data is ascending, updates only move forward

- `setData` requires ascending times and throws otherwise. `setData(data, { normalize: true })` sorts slightly dirty data instead and keeps the last of equal times.
- `update` with the **same** time as the last point replaces it.
- `update` with a **newer** time appends.
- `update` with an **older** time is dropped, and `data:dropped` reports it. Live bars from a data source follow the same rule.

## Bad values

One rule for every way data comes in:

- A **time** that is not a finite number throws, on every series, in `setData` (also with `normalize`), `update` and a heatmap's `updateColumn`.
- An **invalid candle** throws in `setData` and `update`, with the index and field in the message. Fix the data, or pass `{ normalize: true }` to drop such bars. A candle is invalid when:
  - its time, open, high, low or close is not a finite number,
  - it has a `volume` that is not a finite number (leave `volume` out for none), or
  - its high is below its low.

  Anything else is drawn as given: an open or close outside low..high, and a negative volume, which volume candles draw at the normal width, like a bar without volume. Data sources and `isValidBar` use the same definition.
- A line, histogram or heatmap **value** that is not finite (`NaN`, `Infinity`, `undefined`) is a **gap**: nothing is drawn there, a line with `breakGaps` breaks, and autoscale ignores it. This matches indicators, where `NaN` means no value. An `update` with no value for the last point's time removes that point.
- A heatmap `updateColumn` older than the last column is dropped, like an older `update`.
- A data source's bars are filtered instead: invalid bars, duplicates and live bars older than the last one are left out.

Everything left out is reported once through the `data:dropped` event:

```ts
chart.on('data:dropped', ({ reason, bar, series }) => {
  // reason: 'older' | 'invalid' | 'duplicate'
});
```

## Panes stack vertically

The chart starts with one pane (the main pane). `addPane()` adds another below it. Each pane has its own price scale. Series go into the main pane unless you pass a pane. See [Panes](./panes).

## Listeners return unsubscribe functions

```ts
const off = chart.on('crosshair:move', (e) => console.log(e));
off(); // stop listening
```

There is no separate `off` method.

## No hidden state

The chart never reads or writes storage on its own. To persist drawings, serialize them and save them yourself. See [Drawing tools](./drawings#save-and-restore).
