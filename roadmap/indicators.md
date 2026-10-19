# Indicators: built-in and custom

## Goals

- **Built-in indicators**: a maintained set of technical indicators (MA, RSI, MACD, Bollinger, VWAP...) shipped by the project, fast and tested.
- **Custom indicators**: app developers write their own, and share them as packages, against the same contract the built-ins use.
- One runtime format for both, so custom indicators run as fast as built-in ones.

## Today

The `IndicatorDef` contract, the runner and the indicator manager (`chart.indicators`: registry, placeholders, versioning, lookback) are in `@chart-on/core`. `@chart-on/ta` and `@chart-on/indicators` (the T1 and T2 sets) exist; the Ichimoku lagging line waits for plot offsets. Line and histogram plots and fills are supported; the other plot kinds below are not yet. Indicators backed by external data (`fields`, `fetch`, `subscribe`, `chunkBars`, `refetchOn`, `supports`, plus `status` and `indicator:status`) are in core (#210): the chart owns fetching, paging, chunking, cancellation and re-subscribing, and `compute` gets the fetched values aligned with the bars.

## Requirements

An indicator is a definition plus a compute function:
- The definition declares inputs, plots, styles, defaults, placement (overlay or its own pane) and number format.
- The compute function turns input series into one output series per plot. It is backed by a standard library of TA functions.
- It updates incrementally when only the last bar changes.

Plot kinds traders expect:
- **Lines and columns:** line, histogram, area, columns, circles, crosses, step line, and line with breaks.
- **Colouring:** bar colour, background colour, and per-plot colour by palette index.
- **Shapes:** arrow, circle, cross, diamond, flag, square, label and triangle, placed above or below a bar or at a price. Also text characters.
- **Fills and bands:** filled areas between two plots or two bands, and horizontal bands (e.g. RSI 30/70).
- **OHLC plots:** indicators that draw candles.

## Language: TypeScript only

Every indicator is a TypeScript `IndicatorDef`: a pure function with declared inputs and outputs. There is no scripting language (see [Deferred](#deferred-script-language-for-untrusted-indicators)).

| Tier | Who writes it | Distributed as | Trust | Runs where |
| --- | --- | --- | --- | --- |
| Built-in | project | `@chart-on/indicators` | full | main thread (small) or Worker (large) |
| Custom | app developer or community package author | the app's own code, or an npm package that exports definitions | full | same |

- **Full trust.** An indicator runs in the page like any other dependency the app installs. The library does not sandbox it; the app developer decides which packages to trust.
- **Workers are for speed, not safety.** `compute` may return a promise, so heavy indicators can run in a Web Worker. That keeps the main thread free; it is not an isolation boundary.
- **Community indicators are packages,** the same model as exchange-specific data adapters: they live outside this repository and depend on the public contract and `@chart-on/ta`.

## Built-in indicators

Separate package so core stays small and indicators are tree-shakeable: `@chart-on/indicators` (defs) + `@chart-on/ta` (pure math). Core only knows the `IndicatorDef` contract.

```ts
interface IndicatorDef<I extends Record<string, InputValue>> {
  id: string;                     // 'ema', 'rsi', 'bbands'
  name: string;
  overlay: boolean;               // true = main pane, false = new pane
  inputs: InputDef[];             // int | float | bool | color | source | select | text | time
  plots: PlotDef[];
  bands?: { value: number; color?: string; lineStyle?: 'dashed' }[];
  fills?: { between: [string, string]; color: string }[];   // plot ids or band ids
  format?: { type: 'price' | 'volume' | 'percent'; precision?: number };
  /** Full compute. One Float64Array per plot id, NaN = gap. */
  compute(src: BarArrays, inputs: I): Record<string, Float64Array>;
  /** Optional incremental update for the last bar; falls back to compute on a window. */
  update?(src: BarArrays, inputs: I, state: unknown): Record<string, number>;
  /** Bars needed before the first valid value. */
  lookback?(inputs: I): number;
}

interface BarArrays {
  time: Float64Array; open: Float64Array; high: Float64Array;
  low: Float64Array; close: Float64Array; volume: Float64Array;
  length: number;
}

type PlotDef =
  | { id: string; type: 'line' | 'step' | 'area' | 'histogram' | 'columns' | 'circles'; color?: string; lineWidth?: number }
  | { id: string; type: 'shape'; shape: 'arrow-up' | 'arrow-down' | 'circle' | 'cross' | 'diamond' | 'flag' | 'square' | 'triangle-up' | 'triangle-down' | 'label-up' | 'label-down'; location: 'above' | 'below' | 'absolute' }
  | { id: string; type: 'bar-color' | 'bg-color'; palette: string[] }          // value = palette index
  | { id: string; type: 'ohlc'; parts: [string, string, string, string] };    // open/high/low/close plot ids
```

Why vectorized instead of per-bar callbacks: per-bar callbacks with series objects allocate and call through closures on every bar; for 100k bars × several indicators that dominates frame time. Array loops over typed arrays are JIT friendly and allocation free.

### Std library (`@chart-on/ta`)

Pure functions on `Float64Array`, NaN for warmup, tested against known reference values. Written in-house: common JS TA packages use arrays of objects and per-bar classes, which are larger and slower than typed-array loops.

- Averages: `sma`, `ema`, `wma`, `rma`, `vwma`, `hma`, `alma`, `vwap` (session aware).
- Volatility: `tr`, `atr`, `stdev`, `bbands`, `keltner`, `donchian`.
- Momentum: `rsi`, `stoch`, `stochRsi`, `macd`, `roc`, `cci`, `williamsR`, `mfi`.
- Trend: `dmi`/`adx`, `supertrend`, `psar`, `ichimoku`, `linreg`.
- Volume: `obv`, `accDist`, `cvd`.
- Helpers: `highest`, `lowest`, `change`, `cross`, `crossOver`, `crossUnder`, `sum`, `cum`, `nz`.

### Built-in set

- T1: Volume, SMA, EMA, Bollinger Bands, RSI, MACD, VWAP, ATR.
- T2: Stochastic, Stoch RSI, Ichimoku, Supertrend, ADX/DMI, OBV, Keltner, Donchian.
- T3: Volume profile (fixed/visible range, GPU), anchored VWAP, pivot points, ZigZag.

## Custom indicators (TypeScript packages)

- A package exports one or more `IndicatorDef`s and leaves registration to the app: `chart.indicators.register(def)`.
- Ids are namespaced by the package (`my-lib/vwap-bands`) so packages don't clash with each other or with built-ins. Registering a taken id throws, unless it is the same definition object.
- Definitions carry a `version`. When inputs change, an optional `migrate(inputs, fromVersion)` upgrades saved state.
- Authors build on `@chart-on/ta`, so a custom indicator is a few lines and matches the built-ins' results.
- A saved layout that names an unregistered id keeps the entry as a placeholder, so nothing is lost when the app registers the package later.

## Chart integration

`chart.indicators` is an indicator manager, named like the drawing manager (`chart.drawings`) so both plugin systems read the same:

```ts
chart.indicators.register(rsiDef);                     // built-in or custom TS indicator
chart.indicators.unregister('rsi');                    // live instances become pending placeholders
chart.indicators.getDefinitions();                     // registered defs, for the picker

const rsi = chart.indicators.add('rsi', { length: 14 });   // by id or by def; creates pane + series, follows main data
rsi.applyInputs({ length: 21 });
rsi.setVisible(false);
chart.indicators.remove(rsi);                          // rsi.remove() works too
chart.indicators.getAll();                             // includes placeholders (`pending: true`)
chart.indicators.serialize();                          // IndicatorState[]
chart.indicators.load(states);                         // validates, migrates, keeps unknown ids as placeholders
chart.on('indicator:add' | 'indicator:remove' | 'indicator:change' | 'indicator:error', ...)

// Planned:
rsi.applyStyle({ plots: { rsi: { color: '#a78bfa' } } });
rsi.setExternal('liquidations', points);                // extra series the indicator declares; the app supplies it
```

Implementation notes:
- Plots map onto existing series (`line`, `histogram`) plus small `markers` and `band` series; no renderer per indicator.
- Full recompute on `setData` / history prepend, incremental on realtime `update`. At most one full recompute per frame.
- Indicators that need more history than loaded raise the history request size (`lookback`): the initial data-source request adds the largest lookback, and older history is requested that many bars earlier.
- Saved state = `{ type, version, inputs, pane, visible }` (see persistence.md); style joins it once `applyStyle` exists.
- Restore is lenient: an older `version` goes through `migrate`, then inputs are validated; invalid ones take their defaults and `indicator:error` reports it, but the indicator is kept.

## UI

- Indicator picker (`createIndicatorPicker`, shipped): the registered indicators, built-in and custom, with ranked search, categories, favourites, recents, add in place and placement for `either` definitions. Still to come: a command palette entry and the shortcut registry.
- Legend row per indicator: name + inputs, values at crosshair, eye / settings / remove buttons (feature-flagged). Eye uses the same visibility event as the toolbar `toggleVisibility` preset.
- Settings dialog generated from `inputs` and `plots`.

## Tests

- `@chart-on/ta`: each function against known values, warmup NaNs, empty and length-1 input.
- Incremental `update` equals full `compute` on the last bar.

## Deferred: script language for untrusted indicators

**Not planned.** Indicators are TypeScript only, and adding a scripting language needs an issue that agrees to it first (see `AGENTS.md`). This section keeps the earlier analysis for that discussion. Do not build any of it without such an issue.

The idea: let end users paste or import indicators that the app developer never vetted, in a small language that can't express network, storage or DOM access. It would compile to the same `IndicatorDef` the TypeScript indicators use and run in a time-limited Worker.

### Options considered

| Option | Speed | Safety | Author experience | Size cost |
| --- | --- | --- | --- | --- |
| Plain JS in a Worker | fast (JIT) | weak: hard to fully block network/storage access, prototype tricks, `importScripts`, etc. | familiar | none |
| Small script language compiled to JS | fast (same JIT path as TypeScript indicators, vectorized loops) | strong: only whitelisted functions exist, no I/O can be expressed | short | compiler ~1-2k lines |
| WebAssembly (AssemblyScript/Rust) | fast, but copy cost across the boundary; TA loops gain little over JIT | strong | needs a compiler toolchain, binary not reviewable | per-indicator binaries |
| Embedded Lua/Python interpreter in WASM | slow interpreter, slow startup | strong | familiar to some | 0.5-10 MB runtime |

### Sketch

Working name: **charton script** (`.cfs`). Expression based, every value is a series (one value per bar), operators apply bar by bar.

```
indicator "RSI with signals" pane=new format=percent

input length: int = 14 min=1 max=200
input src: source = close
input upper: float = 70
input lower: float = 30

r = rsi(src, length)

plot r "RSI" color=#a78bfa
band upper dashed
band lower dashed
fill upper lower color=#a78bfa22
shape crossover(r, lower) arrow-up below color=up
shape crossunder(r, upper) arrow-down above color=down
```

```
indicator "EMA ribbon" overlay

input fast: int = 9
input slow: int = 21

f = ema(close, fast)
s = ema(close, slow)
plot f "Fast" color=#38bdf8
plot s "Slow" color=#f59e0b
fill f s color = f > s ? #10b98122 : #f43f5e22
barcolor close > s ? up : down
```

#### Language rules (v1)

- Types: `series<number>`, `series<bool>`, `number`, `bool`, `color`, `string` (labels only). Inferred, checked at compile time.
- `x[n]` = value `n` bars ago (`n` must be a constant or input).
- Operators: arithmetic, comparison, `and`/`or`/`not`, ternary `a ? b : c`.
- Variables are immutable series definitions. Stateful recurrences use built-ins (`ema`, `cum`, `valuewhen`, `barssince`) or a `state` block: `state x = 0 then x[1] + volume` (compiled to a single loop).
- No user loops in v1. Optional later: `for i in 0..N` with `N` a constant ≤ 500.
- Built-ins = the `@chart-on/ta` function list plus `open high low close volume time hl2 hlc3 ohlc4`.
- Declarations: `indicator`, `input`, `plot`, `band`, `fill`, `shape`, `barcolor`, `bgcolor`.
- External data series (liquidations, broker flow) referenced as `ext("name")`; the app supplies them. Scripts cannot fetch anything.

#### Compiler pipeline

```
source text → tokenize → parse (AST) → resolve names/types → compute lookback
           → emit JS function over Float64Array (calls into @chart-on/ta) → IndicatorDef
```

- Errors carry line/column for an editor.
- Emitted code is generated by us from a validated AST, never the user's raw text.
- Compiled output is cached by source hash.

#### Sandbox

- Compile on main thread (cheap, pure); run compiled code in a dedicated Worker.
- Before loading code, the Worker deletes or stubs `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`; generated code only references whitelisted identifiers anyway.
- Hard limits: compute time per run (terminate and restart Worker on timeout), max plots, max series length, max source size.
- Validate output: array lengths match bars, values finite or NaN, palette indices in range.
- Data passed to the Worker as transferable `Float64Array`s; results come back the same way.

#### Sharing and installing

- Package = JSON manifest: `{ id, name, version, author, description, source, hash }`.
- Install by paste, file, or URL the user chooses. The library ships no central server; apps may run their own registry.
- Installed scripts saved through the `StorageAdapter` (`listTemplates('indicator')` family or a dedicated `scripts` key).
- Before first run, show name, author, inputs and plots; scripts never get more than chart data.

#### Tests it would need

- Compiler: parse errors with positions, type errors, lookback calculation, emitted code matches hand-written equivalents.
- Sandbox: timeout terminates, forbidden globals unavailable, invalid output rejected.
