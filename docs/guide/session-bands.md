---
description: "Show when other regional markets are open, as thin bands or shaded columns, with open and close countdowns."
---

# Session bands

The chart's `session` option describes the hours of the symbol you are charting (see [View and price scale](./view-and-scale)). Session bands show something else: when *other* markets are open, such as the Asian, European and American cash sessions. That is most useful on markets that trade around the clock.

Each band is a **lane** with a name, an IANA timezone, opening hours in that timezone and a colour. Hours follow the lane's own daylight saving changes, whatever the chart's `timezone` is.

## Adding session bands

Session bands are a [primitive](./primitives). Create them and attach them to a chart:

```ts
import { createChart, createSessionBands } from '@chart-on/core';

const chart = createChart(el);
const bands = createSessionBands(); // Asia, Europe and Americas
chart.attachPrimitive(bands);
```

Without `lanes`, `createSessionBands` starts with `DEFAULT_SESSION_LANES`: weekday cash hours in Tokyo (09:00–15:00), London (08:00–16:30) and New York (09:30–16:00), named `Asia`, `Europe` and `Americas`. They have no holidays. Pass your own lanes to replace them:

```ts
const bands = createSessionBands({
  lanes: [
    {
      id: 'sydney',
      name: 'Pacific',
      timezone: 'Australia/Sydney',
      hours: { weekly: { mon: [{ start: '10:00', end: '16:00' }], tue: [{ start: '10:00', end: '16:00' }] } },
      color: '#2bb3a3',
    },
  ],
});
```

`hours` is the same `SessionSchedule` the chart's `session` option takes: a weekday map of `HH:MM` ranges, with overnight ranges, holidays and one-day overrides. The times are wall-clock times in the lane's `timezone`.

Bands only draw on intraday bars. On daily and longer bars, or when more than about 400 days are visible, they are hidden.

## Changing lanes at runtime

```ts
bands.addLane({ id: 'frankfurt', name: 'Frankfurt', timezone: 'Europe/Berlin', hours, color: '#f2c94c' });
bands.updateLane('europe', { color: '#7aa2ff' }); // recolour, rename, or change the timezone or hours
bands.removeLane('asia');
bands.setLanes([...]); // replace them all
```

Every change redraws the chart and fires `lanes:change`:

```ts
const off = bands.on('lanes:change', ({ lanes }) => renderLegend(lanes));
off(); // unsubscribe
```

Lanes are validated when you add or change them. A duplicate `id`, an unknown timezone or malformed hours throw, and the lanes stay as they were. `setLanes` checks the whole list before it replaces anything.

## Display options

```ts
bands.applyOptions({ mode: 'columns' });
```

| Option | Default | Notes |
| --- | --- | --- |
| `visible` | `true` | Hide without detaching |
| `mode` | `'bands'` | `'bands'`: one thin strip per lane along the bottom of the plot, the first lane on top. `'columns'`: shaded full-height columns behind the series |
| `bandHeight` | `3` | Height of each strip, css px |
| `bandGap` | `1` | Space between strips, css px |
| `opacity` | `0.9` | Multiplies the lane colours' alpha |
| `columnOpacity` | `0.12` | Extra opacity for columns, so they stay faint behind the series |

The bands draw in the pane they are attached to. Attach them to the bottom pane, for example a volume pane, to keep them next to the time axis:

```ts
chart.attachPrimitive(bands, { pane: chart.panes.length - 1 });
```

## Open, closed and countdowns

`bands.states(now?)` returns one entry per lane, in lane order:

```ts
for (const { lane, open, next, remaining } of bands.states()) {
  console.log(lane.name, open ? 'open' : 'closed', remaining); // seconds until it opens or closes
}
```

`next` is the unix time of the next open (while closed) or close (while open), and `remaining` the seconds until then. Both are `null` for a lane that is always open, or when the next change is more than three weeks away. `now` defaults to the current time.

Two standalone helpers work on a single lane without a primitive:

- `sessionLaneState(lane, now)` gives the same state as `states`.
- `sessionLaneIntervals(lane, from, to)` lists the `[start, end)` unix times the lane is open within a span.

## In the UI shell

Pass the bands to the bottom bar (which turns it on) to get a chip with a dot per lane. A dot is solid while its lane is open. Clicking the chip lists the lanes with countdowns, updated every second:

```ts
import { createChartShell } from '@chart-on/ui';

const bands = createSessionBands();
const shell = createChartShell(el, { bottomBar: { sessionBands: bands } });
shell.chart.attachPrimitive(bands);
```

The chip follows lanes added, removed or recoloured at runtime, and hides itself when there are no lanes. Without the shell, `createSessionChip(bands)` returns the same chip as an element to place yourself.
