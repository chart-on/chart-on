---
description: "Horizontal histograms of traded volume by price, built from the main series and drawn on the GPU."
---

# Volume profile

A volume profile is a horizontal histogram of traded volume by price. It shows where trading concentrated, rather than when. charton builds it from the bars of the main candle series and draws the rows on the GPU.

Volume profiles are [opt-in](./features#opt-in-features): create the chart with the `volumeProfile()` plugin (or `builtins()`), as the examples below do. The UI shell adds it for you.

<!-- example: volume-profile -->

Each profile marks three levels:

- **Point of control (POC):** the row with the most volume. Drawn as a solid line.
- **Value area high and low (VAH, VAL):** the edges of the price range around the POC that holds 70% of the volume (`valueArea`). Drawn as dashed lines. Rows inside the value area are drawn stronger than rows outside it.

The legend shows the three prices: for the visible profile, and for the session under the crosshair.

## Visible range and sessions

`range: 'visible'` (the default) profiles the bars currently on screen. It recomputes when you pan or zoom, at most every `throttleMs` (50 ms by default). It always catches up with the last change. The rows are anchored to the plot edge and grow inwards.

`range: 'session'` builds one profile per session. Each profile spans its session's bars and grows from the session's left edge. Sessions are computed once. Live updates of the forming bar only recompute the last session.

<!-- example: volume-profile-sessions -->

### Session boundaries

`sessionOf(time)` decides which session a bar belongs to. Consecutive bars with the same id share a profile. The default, `utcDaySession`, uses the UTC calendar day. Pass your own function for other splits:

```ts
// Weeks starting on Monday (1970-01-01 was a Thursday).
chart.addVolumeProfile({ range: 'session', sessionOf: (t) => Math.floor((t / 86400 + 3) / 7) });

// A trading day that starts at 22:00 UTC.
chart.addVolumeProfile({ range: 'session', sessionOf: (t) => Math.floor((t + 2 * 3600) / 86400) });
```

## Buy and sell volume

When bars carry `buyVolume` (the part of `volume` from buy-side trades), each row is split into buy volume in `theme.up` and sell volume in `theme.down`. Buy volume sits nearest the edge the rows grow from. Sell volume is `volume - buyVolume`. A bar without `buyVolume` adds to the row length in the neutral colour.

```ts
candles.setData([{ time, open, high, low, close, volume: 1200, buyVolume: 700 }]);
```

Without any `buyVolume`, rows use a single colour (`theme.line` by default).

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `title` | `'Volume profile'` | Legend label |
| `legend` | `true` | `false` leaves the profile out of the legend |
| `range` | `'visible'` | `'visible'` or `'session'` |
| `rows` | auto | Rows across each profile's price range; must be a positive finite number. Unset, the visible-range profile has one row per 10 px of its height (the default bar spacing, so rows have the candles' pitch and stay readable at any zoom); session profiles, computed once, use the Rice rule from their bar count, `ceil(2 * n^(1/3))` |
| `rowSize` | none | Fixed row height in price units, aligned to multiples of it; overrides `rows`; must be a positive finite number |
| `width` | `0.5` | Longest row as a fraction of the plot width (visible) or session width (session): the longest row ends at the middle, so the bars stay readable on the other half |
| `placement` | `'right'` / `'left'` | Edge the rows grow from: plot edge (visible) or session edge (session) |
| `valueArea` | `70` | Share of volume inside the value area, in percent |
| `sessionOf` | `utcDaySession` | `(time) => id`, see [session boundaries](#session-boundaries) |
| `throttleMs` | `50` | Minimum time between recomputes while the view or the live bar changes |
| `opacity` | `0.5` | Row opacity inside the value area; rows outside get 45% of it |
| `pocLine`, `valueAreaLines` | `true` | Show the POC and value-area lines |
| `color` | `theme.line` | Rows without a buy/sell split |
| `upColor`, `downColor` | `theme.up`, `theme.down` | Buy and sell volume |
| `pocColor` | `theme.text` | |
| `valueAreaColor` | `theme.textMuted` | |

Change options later with `profile.applyOptions({ ... })`, hide with `profile.setVisible(false)`. Colours follow theme changes unless you set them.

## How volume is binned

- **Rows.** With `rows`, the profile's low–high range is split evenly. `computeVolumeProfile` without `rows` or `rowSize` uses the Rice rule from the bar count. With `rowSize`, rows start at a multiple of the size, so they stay put while you pan. A profile has at most 4096 rows (`MAX_PROFILE_ROWS`); a smaller `rowSize` is scaled up.
- **Spreading a bar.** A bar's volume is spread evenly over its high–low range, and each row gets the share of the range it overlaps. A bar whose high equals its low puts all of its volume in one row. Bars without positive volume are skipped. Total volume is always preserved.
- **Point of control.** The row with the most volume. On a tie, the row nearest the middle of the profile wins, then the lower one.
- **Value area.** Starting at the POC, the neighbouring row (above or below) with more volume is added until the area holds `valueArea` percent of the total. When both neighbours have the same volume, both are added.

## Using the math directly

The binning is exported as plain functions, for custom tools or for analysis outside the chart. Pass `out` to reuse its typed arrays, so repeated calls do not allocate.

```ts
import { VolumeProfile, computeVolumeProfile } from '@chart-on/core';

const p = computeVolumeProfile(bars, from, to, { rows: 30, valueArea: 70 }); // bars [from, to)
p.rowPrice(p.poc);                  // POC price (row middle); p.poc is -1 without volume
p.rowHigh(p.valueAreaHigh);         // VAH
p.rowLow(p.valueAreaLow);           // VAL
// p.volume, p.buy, p.sell: Float64Array per row, first p.rows entries

// Reuse one profile's arrays across calls, e.g. on every new bar:
const out = new VolumeProfile();
computeVolumeProfile(bars, from, to, { rowSize: 5 }, out);
```

`pointOfControl(volume, rows)` and `valueArea(volume, rows, poc, percent)` work on any array of row volumes.

## Per-bar order flow data

Volume by price inside each bar, and time-price opportunity (TPO) profiles, have their own helpers. Both also have a chart type, `footprintSeries` and `tpoSeries` (below).

```ts
import { createFootprintBuilder, footprintFromRows, footprintImbalances, computeTpoProfiles, tpoLetter } from '@chart-on/core';

// Footprint: sided trades into price rows per bar, live.
const footprint = createFootprintBuilder({ interval: '1m', rowSize: 0.25 });
const bar = footprint.push({ time, price, size, side: 'buy' }); // the forming bar, or null if dropped
bar?.rows;   // [{ index, price, buy, sell, volume }], lowest price first; only prices that traded
bar?.delta;  // buy - sell; bar.poc indexes bar.rows
const coarse = footprintFromRows(bar!.time, bar!.rows, 1); // regroup, or build from a data source's levels
footprintImbalances(coarse, { ratio: 3 }); // { buy: boolean[], sell: boolean[] } per row

// TPO: one period per bar (e.g. 30-minute bars), one profile per trading day.
const profiles = computeTpoProfiles(bars30m, { rowSize: 0.5, timezone, session });
profiles[0].rowPeriods[row].map(tpoLetter).join(''); // 'ABDF'
```

Footprint bars use the same bucketing as `createBarBuilder`, so they line up with price bars built from the same trades. Imbalances are diagonal: buying at a row is compared with selling one row lower, and selling with buying one row higher. TPO rows align to multiples of `rowSize`; the point of control and value area follow the rules above, counted in TPOs instead of volume.

### Footprint chart type

`footprintSeries` draws `FootprintBar`s as a custom series. Pass it to `chart.addCustomSeries`, next to the candles built from the same trades:

```ts
import { footprintSeries } from '@chart-on/core';

const fp = chart.addCustomSeries(footprintSeries, { title: 'Footprint', values: 'split' });
fp.setData(history);         // FootprintBar[], oldest first
const live = footprint.push(trade); // the forming bar, or null
if (live) fp.update(live);
```

Each row is a cell shaded by its volume, in the up colour where buying leads and the down colour where selling leads; the point of control is outlined. When rows and bars are large enough, each row shows its volume as text: `values: 'split'` (default) the sell and buy volume side by side, `'delta'` buy minus sell, `'volume'` the total. Imbalanced sides are written in the up or down colour (`imbalance`, the options of `footprintImbalances`, or `false`). As bars get narrower or rows thinner, the text goes first, then the cells, and each bar becomes a single range bar coloured by its delta. `upColor`, `downColor` and `pocColor` override the theme. The legend shows volume and delta; when the chart groups bars, a group's rows are summed.

### TPO chart type

`tpoSeries` draws TPO profiles as a custom series. `tpoColumns(bars, options)` takes the same bars and options as `computeTpoProfiles` and gives one item per bar inside a session: the session's profile and the column of it that bar draws. Each session's profile then grows right from its first bar, one TPO per bar slot, and only the columns on screen are drawn. Show it over the same period bars (hide their candles for a profile-only chart):

```ts
import { tpoColumns, tpoSeries } from '@chart-on/core';

const options = { rowSize: 0.5, timezone, session };
const tpo = chart.addCustomSeries(tpoSeries, { title: 'TPO' });
tpo.setData(tpoColumns(bars30m, options)); // again on each live bar: it changes its whole session
```

When cells are large enough, each TPO is its period's letter (`tpoLetter`); otherwise it is a block, and as bars narrow the blocks merge into a profile histogram. `letters: false` always draws blocks. TPOs inside the value area use `color` (default the theme's line colour), those outside it a faded tint, and the point-of-control row `pocColor` (default the text colour). Autoscale covers a bar's whole session profile, and the legend shows the session's point of control, value-area high and value-area low. While the chart groups bars, each group shows the column of its last bar.

The demo's `order-flow.html` page shows both chart types on three days of synthetic trades, updating live. `packages/core/test/order-flow.bench.ts` (`pnpm build && pnpm bench`) times frames of each with thousands of rows or TPOs on screen.

## Performance

The visible profile only reads the bars on screen. On a development laptop with 100k one-minute bars, a full profile of all of them takes about 2 ms, a screen of bars (a few thousand) under 0.1 ms, and building all 70 daily session profiles about 3 ms. Rows are GPU instances, so panning between recomputes costs nothing extra.
