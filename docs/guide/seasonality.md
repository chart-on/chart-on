---
description: "Overlay each year's path through the same calendar window, with the average path and the range of the years."
---

# Seasonality

A seasonality view lays the same calendar window (a year, a quarter or a month) of several years on top of each other. Each year is one line, normalised to a common start, so you can see whether a market tends to rise or fall at certain times of year. An optional average path, with the range of the years shaded around it, sums them up.

```ts
import { createChart, createSeasonality, dataSource } from '@charton/core';

const chart = createChart(container, { plugins: [dataSource()] });
chart.setDataSource(source);

const view = createSeasonality(chart, {
  symbol: 'WHEAT',      // daily bars, loaded through the chart's data source
  years: 5,             // the newest five years with data
  window: 'year',       // or 'quarter' / 'month'
  normalize: 'percent', // or 'indexed' (each year starts at 100) / 'none' (prices)
  average: 'mean',      // or 'median'; leave out for no average
});
await view.ready;
```

The time axis shows the window's calendar: month names and days, not real dates. The crosshair label shows the date in the window (`30 Apr`), and the legend shows each year's value at that position.

The view owns the chart's time axis, so give it a chart of its own: one without a loaded symbol (`setSymbol`) or main series data. `createSeasonality` throws otherwise.

## Data

`symbol` loads daily bars (`1d`) through the chart's data source, or through `source` when you pass one. The view pages back until history reaches 1 January of the oldest year it needs, and live bars update the newest year. `ready` settles once the first load finishes, and rejects with the `ChartError` when it fails.

Bars you already have go in `bars` instead, and `setBars` replaces them later:

```ts
const view = createSeasonality(chart, { bars: dailyBars, years: [2019, 2021, 2023] });
```

`years` is either a count (the newest years with data in the window) or a list of years. Years without data are left out.

## Windows

`window: 'year'` compares whole calendar years. `'quarter'` and `'month'` compare one quarter or month each year: `period` picks it (1-4 or 1-12) and defaults to the one holding the newest bar.

```ts
// Every July, by trading day.
createSeasonality(chart, { symbol: 'IND50', window: 'month', period: 7, align: 'trading' });
```

## Alignment, leap days and gaps

`align: 'calendar'` (the default) puts the same date at the same position every year. Positions follow a leap-year calendar, so a year window has 366 of them and 1 March is position 60 in every year. 29 February only has a value in leap years.

Days without a bar (weekends, holidays) are handled by `gaps`:

- `'carry'` (default): repeat the last close over them, from the year's first bar to its last. Common years carry 28 February over the leap day. Every year then has a value at every position it spans, so the average path is not skewed by weekends falling on different dates.
- `'skip'`: leave them empty. Lines join across the gap, and the average at that position uses only the years with a bar there.

`align: 'trading'` lines up the nth bar of the window instead. Positions are trading days, the axis and crosshair show their numbers (`Day 42`), and there are no gaps. A year with fewer trading days ends earlier.

Neither mode fills before a year's first bar in the window or after its last, so the current year ends at the newest bar.

## Average and range

`average: 'mean'` or `'median'` adds the average path of the years (dashed), and shades the min/max range of the years behind the lines. At each position the average uses the years with a value there. `range: false` keeps the average without the shading, and `averageColor` sets their colour (the theme's `line` by default).

## Showing and hiding years

Each year is a line series titled with the year, so the legend's eye button hides it. `setYearVisible(year, visible)` does the same from code. Hiding a year only changes that line: the other years and the average are not recomputed, and the average still includes the hidden year. A hidden year stays hidden when the view recomputes for new bars or options.

```ts
view.setYearVisible(2020, false);
view.isYearVisible(2020); // false
view.yearSeries(2024)?.applyOptions({ lineWidth: 3 });
```

The newest year is drawn thicker and has the last-value label. `colors` sets the year colours, oldest year first.

## Changing and removing the view

`applyOptions` changes any option except the data and recomputes every path. `dispose` removes the view's series and restores the chart's time labels.

```ts
view.applyOptions({ window: 'quarter', normalize: 'indexed' });
view.dispose();
```

## Without a chart

`computeSeasonality(bars, options, zone?)` is the pure computation behind the view: the normalised path per year as a `Float64Array` per position (`NaN` where a year has no value), and the average with its min and max. `seasonalPosition(time, window, zone?)` gives a date's year, period and calendar position, and `seasonalSlots(window, period)` the number of calendar positions in a window. Dates are read in `zone` (UTC by default; the view passes the chart's timezone).
