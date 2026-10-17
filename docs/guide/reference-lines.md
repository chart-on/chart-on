---
description: "Optional horizontal lines on the main series, such as the previous close, each with an axis label."
---

# Reference lines

Reference lines are optional horizontal lines on the main series, each with its own price-axis label. All of them are off by default. They come with the `referenceLines()` [plugin](./features#opt-in-features), which `builtins()` includes, so the [UI shell](./ui-shell) has them unless its `chart.plugins` list leaves the plugin out.

| Line | Price |
| --- | --- |
| `previousClose` | Close of the previous trading day on intraday bars, or of the previous bar on daily and longer bars. With a [session](./options#timezones-and-sessions) it is the last regular-session close |
| `high` | Highest high of the visible bars |
| `low` | Lowest low of the visible bars |
| `average` | Average close of the visible bars |
| `bid` | Best bid of the latest quote |
| `ask` | Best ask of the latest quote |
| `extendedHours` | The newest price while the newest bar is outside the session (pre or post session) |

```ts
import { createChart, referenceLines } from '@charton/core';

const chart = createChart(el, {
  plugins: [referenceLines()],
  referenceLines: {
    previousClose: { visible: true },
    high: { visible: true },
    low: { visible: true },
  },
});

// Later: per line, deep-partial.
chart.applyOptions({ referenceLines: { average: { visible: true, color: '#d97706', lineStyle: 'solid' } } });
// Or on the handle.
chart.referenceLines.applyOptions({ high: { visible: false } });
```

Each line takes these options:

| Option | Default | Notes |
| --- | --- | --- |
| `visible` | `false` | Draw the line and its label |
| `color` | theme token | Line and label colour; `undefined` goes back to the theme |
| `lineStyle` | `'dashed'` (`'dotted'` for high, low and average) | `'solid'`, `'dashed'` or `'dotted'` |
| `lineWidth` | `1` | |
| `axisLabel` | `true` | Price label on the axis |
| `title` | `'Prev'`, `'High'`, `'Low'`, `'Avg'`, `'Bid'`, `'Ask'`, `'Pre'` | Tag beside the axis label; `''` hides it |
| `postTitle` | `'Post'` | `extendedHours` only: the tag after the session closes, while `title` tags prices before it opens |

`chart.referenceLines.options` holds the resolved options, and `chart.options.referenceLines` is the same object rather than the last patch. Unknown lines or line styles throw.

Without the plugin, no line draws and reading `chart.referenceLines` throws a [`not-registered`](./errors#not-registered) `ChartError`. The `referenceLines` option is kept, merged per line, in `chart.options.referenceLines`, and the plugin applies it when installed later; an unknown line or line style still throws at the call. Development builds warn once ([`reference-lines-missing`](./errors#reference-lines-missing)) when a line is turned on.

Reference labels and last-value labels on one axis move apart instead of covering each other. Axis labels of [annotation](./annotations) lines are drawn on top at their exact price and are not moved.

The visible high, low and average follow panning and zooming, and every line follows live bars. Values are cached and recomputed only when the bars, the visible range, the timezone or the session change, so drawing the lines allocates nothing per frame.

```ts
chart.referenceLines.value('high');   // number, or null when the line has no price
chart.referenceLines.sessionPhase;    // newest bar: 'open' | 'pre' | 'post'
```

## Bid and ask

Feed quotes from the app:

```ts
chart.applyOptions({ referenceLines: { bid: { visible: true }, ask: { visible: true } } });
chart.referenceLines.setQuote({ bid: 101.25, ask: 101.5 });
chart.referenceLines.setQuote(null); // clear
```

A missing or non-finite side hides its line. A [data source](./data-sources) can stream quotes instead by implementing the optional `quotes(symbol, onQuote)`; the chart then updates the lines and emits `data:quote`. Quotes clear when the symbol changes. The latest one is `chart.data.quote`, so the plugin installed (or installed again) after it came shows it at once.

## Extended hours

With a `session` set and intraday bars, the newest bar can fall outside the regular session. While the `extendedHours` line is on, the chart then shows:

- a separate label at the newest price, tagged `Pre` before the trading day's regular hours open and `Post` once they have closed (decided from the session times, so it works even when no regular bar of that day is loaded), in the `extendedHours` theme colour;
- the main last-price label at the close of the last regular-session bar, as displayed (Heikin Ashi applied). After hours it uses only a regular bar of the same trading day, and stays as it is when none is loaded.

Inside the session, without a session, or on daily bars, nothing changes.

## Labels per series

Every series has `lastValueLabel` to show or hide its last-value label. `axisTitle: true` adds a tag with the series title beside the label, which helps when several symbols share an axis. The main series falls back to the symbol name from its data source when it has no title.

```ts
const other = chart.compare('XYZ');
other.series.applyOptions({ axisTitle: true });
chart.main?.applyOptions({ axisTitle: true });
```

Indicators switch the same labels at runtime:

```ts
const macd = chart.indicators.add('macd');
macd.applyLabelOptions({ axisTitle: true });     // tag each plot with its title
macd.applyLabelOptions({ lastValueLabel: false }); // hide all its labels
macd.labelOptions;                               // { lastValueLabel, axisTitle }
```

## Theme

| Key | CSS token | Used for |
| --- | --- | --- |
| `referenceLine` | `--pc-chart-reference-line` | Previous close, high, low and average |
| `bid` | `--pc-bid` | Bid line |
| `ask` | `--pc-ask` | Ask line |
| `extendedHours` | `--pc-extended-hours` | Pre and post session label |
