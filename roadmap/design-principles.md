# API design principles

Conventions every new public API in charton follows. They keep the library consistent, typed and pleasant to embed. When an existing product does something differently, we still design our own API from these principles rather than mirroring theirs.

## Scope

charton is an embeddable charting library first and an app-like widget second. Features beyond that are welcome as **optional add-ons**. Every open issue except the meta epics is labelled `scope: core` or `scope: add-on`.

These lists describe the target. Some add-on code still ships in the default core and UI bundles; moving it out is tracked in the follow-ups to #694, so that code is not out of policy in the meantime.

Two terms are used below:

- **Core** is the feature set this project treats as the library itself. It lives in `@charton/core` and `@charton/ui`.
- **Minimal chart** is what `createChart` with no plugins ships. It is a subset of core. It has no fixed size target: its `createChart` budget in `scripts/size-budget.json` (production mode, gzip) only goes down as parts move out, and [shrinking it further](#future-work-a-smaller-minimal-chart) is future work.

**Core, in the minimal chart:**

- Rendering engine, panes, pane layout and the frame loop
- Series: candles and bar styles, line, area, histogram, baseline
- Time and price scales (linear, log, percent) and timezones
- Interaction: pan, zoom, crosshair, keyboard, touch
- Theming, legend and accessibility
- The plugin contracts for indicators, drawings, annotations and custom series

**Core, as opt-in exports of `@charton/core`:**

- The data source API with generic adapters (REST, WebSocket, CSV, mock)
- Saved layouts: `serializeLayout`, `loadLayout`, `autosave` and `loadLastLayout` (`layouts()`)
- Bar grouping when zoomed out: the `grouping` option (`grouping()`)
- Built-in plugins: indicators with a small built-in set, drawings and their tools, compare, and annotations for markers, price lines, zones, bands and text labels. Data source marks, time marks, corporate action markers and indicator shape plots draw through these annotations.

**Core, in `@charton/ui`:** a thin, replaceable toolbar, drawing rail, indicator picker and settings dialog.

**Add-ons.** Everything else, for example:

- Trading: order, position, trade and draft order lines, trade fills, order editing, the Trade button. These split out of the annotations plugin.
- Market depth: depth ladder, depth lane, footprint and TPO profiles
- Bar replay, sonification, seasonality
- App chrome: symbol search, command palette, favourites, toolbar customization, shortcut editor, toasts
- Extra series and scales: heatmap, volume profile, the numeric x scale, and others beyond the core set
- Indicators and drawing tools beyond the built-in set
- Framework wrappers

Rules for add-ons:

- Build on the public plugin contracts. If an add-on needs a hook core lacks, add a general one to the contract rather than special-casing the feature.
- Ship as a tree-shakeable plugin export from a package entry (as `heatmap()` is today), a subpath entry, or a separate package. Never register an add-on from a module's top level.
- An add-on adds none of its modules to a minimal chart. `packages/core/test/tree-shaking.test.ts` checks this. Only a small, general hook in the plugin contract may stay in the chart.
- Compare gap analyses against this scope, not against a complete trading product. A missing add-on is not a core gap.

### Future work: a smaller minimal chart

A 60 KiB gzip target for the minimal chart was dropped on 2026-10-17 (#807). The measured design in #869 found that every optional part and code-size cut agreed so far stops at about 74 to 78 KiB; the rest is the minimal list itself. Going lower needs one of these, each its own issue:

- Narrow the minimal list above.
- A sustained code-size pass on `chart.ts`, `series.ts` and `interaction.ts`. Earlier passes found tens of bytes per change.
- Measure only the initial chunk and load rarely used paths through `import()`. `pnpm size` counts every chunk today.

Until then, size work is ordinary work: a change that moves a part out of the minimal chart lowers the `createChart` budget by what it saves.

## Independent implementation

- Every implementation is written from scratch for this repository. Do not copy or adapt code from other projects, whatever their license.
- Learning concepts from public documentation, papers and observed behaviour is fine. Describe what you learned in your own words, then design and implement it independently.
- Indicator formulas and other domain math are general knowledge. Implement them from their definitions.
- Defaults and orderings are designed too. Default values and level sets, menu and catalogue orders, group names, labels, keyboard shortcuts, settings structure and example payloads each follow a stated requirement or rule written next to them. Replaced defaults are guarded by hash (`packages/core/test/retired-palette.ts`).

## Data and time

- **Times are unix seconds** everywhere: bars, events, ranges, drawings. Never mix in milliseconds.
- **Intervals are readable strings:** a count plus a unit, `s`, `m`, `h`, `d`, `w` or `M` (month). For example `30s`, `15m`, `1h`, `1d`, `1w`, `3M`. Helpers convert them (`intervalSeconds('15m') === 900`). Never encode intervals as bare minute counts like `'60'`.
- **Sessions are structured data,** not a mini-language:
  - A weekday map of time ranges, with overnight ranges allowed.
  - ISO-date holidays, plus one-day overrides that win over holidays.
  - An optional history of schedule changes.
- **Prices use a tick size plus a format:** `tickSize` and `format: 'decimal' | { fraction: denominator, sub? }`, with optional price bands. Never use integer scale encodings.

## Async and lifecycle

- **Promises** for one-shot async work, and an **`AbortSignal`** for anything the chart may cancel (symbol or interval switches, closing dialogs).
- **Subscriptions return an unsubscribe function.** No listener ids, no separate unsubscribe calls.
- **One reset path:** a data source signals corrections through its source-level `onReset(listener)` subscription, naming the symbol, interval and range that changed, and the chart refetches. It is a subscription on the source, like `onStatus`, rather than an argument of `stream`, so sources without a stream can report corrections and everything that reads bars from the source (the main series, other symbols' bars in indicators) refetches through one path. There's no separate clear-and-reload dance.
- **Capability detection by presence:** an optional method that exists is supported. No config objects full of capability booleans.

## Options and state

- **Typed option objects with deep-partial updates:** `chart.applyOptions({ crosshair: { mode: 'snap' } })`. Never use dotted string paths.
- **Feature flags are a typed object** (`features: { contextMenu: false }`), not lists of magic strings.
- **Observable state is a getter plus a change event,** e.g. `chart.drawings.magnet` and `magnet:change`. No wrapper objects that hold a value.
- **Theme with semantic tokens** (`up`, `down`, `grid`, `labelBackground`) and CSS custom properties. Never use numbered palette slots.

## Events

- **One naming scheme:** `noun:verb` in lower case (`drawings:change`, `data:loaded`, `history:change`). `chart.on(name, listener)` returns an unsubscribe function.
- Payloads are plain objects with the same field names the rest of the API uses (`symbol`, `interval`, `time`).

## Embedding

- **Render into the host page:** no iframes, no separately hosted static files, no injected stylesheet URLs. Ship ES modules with types.
- **Explicit handles:** every chart is an object the app holds. No global singleton and no hidden "active chart".
- **Adapters, not fixed protocols:** storage, data and screenshots go through small interfaces the app implements. The library never assumes a server API. Screenshots return a `Blob`; the app decides where it goes.
- **Headless first:** `@charton/core` works with any UI. `@charton/ui` is an optional layer built only on the public core API.

## Errors and validation

- Validate untrusted input (saved layouts, drawings, data-source responses) and drop or report what's invalid. Never throw inside the frame loop.
- Report load failures through events and rejected promises, with the context needed to debug them (`symbol`, `interval`, `kind`).
