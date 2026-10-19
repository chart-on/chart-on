---
description: "The @chart-on/ta helpers for writing indicators: averages, volatility, momentum and volume functions."
---

# Technical-analysis helpers

`@chart-on/ta` is a small library of technical-analysis functions for indicator authors. Custom indicators combine a few helpers instead of hand-written loops, and the built-in indicators use the same helpers, so both run at the same speed and give the same values.

```bash
pnpm add @chart-on/ta
```

It has no dependencies, does not import `@chart-on/core`, and is tree-shakeable: importing `sma` alone adds about 1 kB.

## Conventions

Every helper follows the same rules:

- **Columns in, columns out.** Inputs are columns of numbers, one per bar (`Float64Array` is the fast path; plain arrays work too). Outputs are `Float64Array`s of the same length.
- **Warmup is NaN.** Bars before the first value are `NaN`. `<name>Lookback(...)` returns how many bars that is, e.g. `smaLookback(20)` is 19. Helpers with several outputs report their slowest output.
- **NaN breaks the series.** A window function reads `NaN` while a `NaN` input is inside its window. Recursive helpers (exponential averages, running totals, RSI, OBV, VWAP) read `NaN` on that bar and warm up again after it. Chained helpers therefore work on each other's output, warmup included: `ema(macdLine, 9)` starts where the MACD line does.
- **Inputs are never mutated.** Pass an `out` array (or an object of arrays for multi-output helpers) to reuse buffers instead of allocating. It must not be one of the inputs.
- **Single-bar forms.** `<name>At(...)` computes bar `i` from earlier bars, for an indicator's live `update`. It gives the same values as the array form, up to floating-point rounding: rolling window sums are rebuilt every `length` bars so the difference stays tiny. Recursive ones read bar `i - 1` of their `out` (and `state`) arrays and write bar `i`.
- **Lengths are validated.** A length that is not an integer of at least 1 throws a `RangeError`, in the array and single-bar forms alike, as do inputs of different lengths.

```ts
import { ema, emaAt, rsi, rsiAt } from '@chart-on/ta';

const out = ema(close, 20);   // full series
close[close.length - 1] = 105; // the last bar ticks
emaAt(close, close.length - 1, 20, out); // update it in place
```

Helpers whose running state is more than their output take an optional `state` argument (`rsi`, `macd`, `vwap`). Fill it in the array form and pass it to the single-bar form:

```ts
const n = close.length;
const state = { avgGain: new Float64Array(n), avgLoss: new Float64Array(n) };
const values = rsi(close, 14, undefined, state);
// later, for the last bar:
rsiAt(close, n - 1, 14, values, state);
```

## Helpers

### Averages

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `sma(values, length)` | `smaAt(values, i, length)` | `length - 1` | Mean of the last `length` values. |
| `ema(values, length)` | `emaAt(values, i, length, out)` | `length - 1` | Smoothing `2 / (length + 1)`, seeded by the SMA of the first `length` values. |
| `rma(values, length)` | `rmaAt(values, i, length, out)` | `length - 1` | Wilder's average, smoothing `1 / length`, seeded like `ema`. |
| `wma(values, length)` | `wmaAt(values, i, length)` | `length - 1` | Linear weights: newest `length`, oldest 1. |
| `vwma(values, volume, length)` | `vwmaAt(values, volume, i, length)` | `length - 1` | `sum(value × volume) / sum(volume)`; NaN when the window has no volume. |

### Volatility

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `tr(high, low, close)` | `trAt(high, low, close, i)` | 0 | True range; the first bar uses `high - low`. |
| `atr(high, low, close, length)` | `atrAt(high, low, close, i, length, out)` | `length - 1` | `rma` of `tr`. |
| `stdev(values, length)` | `stdevAt(values, i, length)` | `length - 1` | Population standard deviation. |
| `bbands(values, length, mult)` | `bbandsAt(values, i, length, mult, out)` | `length - 1` | Returns `{ middle, upper, lower }`. |
| `keltner(high, low, close, length, mult, atrLength, out?, state?)` | `keltnerAt(high, low, close, i, length, mult, atrLength, out, state)` | `max(length, atrLength) - 1` | `ema` of the close ± `mult` × `atr`. Returns `{ middle, upper, lower }`; `state` is `{ atr }`. |
| `donchian(high, low, length)` | `donchianAt(high, low, i, length, out)` | `length - 1` | Returns `{ upper, lower, middle }`: highest high, lowest low, midpoint. |

### Momentum

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `rsi(values, length, out?, state?)` | `rsiAt(values, i, length, out, state)` | `length` | Wilder's RSI. 100 with no losses, 50 on a flat run. |
| `macd(values, fast, slow, signal, out?, state?)` | `macdAt(values, i, fast, slow, signal, out, state)` | `max(fast, slow) + signal - 2` | Returns `{ macd, signal, histogram }`; `state` is `{ fast, slow }`. |
| `stoch(high, low, close, kLength, kSmooth, dLength)` | `stochAt(high, low, close, i, kLength, kSmooth, dLength, out)` | `kLength + kSmooth + dLength - 3` | Returns `{ k, d }`. A zero range reads 50. |
| `stochRsi(values, rsiLength, stochLength, kSmooth, dLength, out?, state?)` | `stochRsiAt(values, i, rsiLength, stochLength, kSmooth, dLength, out, state)` | `rsiLength + stochLength + kSmooth + dLength - 3` | `stoch` applied to an `rsi`. Returns `{ k, d }`; `state` is `{ rsi, avgGain, avgLoss }`. A zero range reads 50. |
| `roc(values, length)` | `rocAt(values, i, length)` | `length` | Percent change; NaN on a zero base. |

### Trend

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `dmi(high, low, close, length, adxLength, out?, state?)` | `dmiAt(high, low, close, i, length, adxLength, out, state)` | `length + adxLength - 1` | Returns `{ plus, minus, adx }` (the DIs start at `length`); `state` is `{ plusDm, minusDm, tr }`. Wilder's smoothing throughout. |
| `supertrend(high, low, close, length, mult, out?, state?)` | `supertrendAt(high, low, close, i, length, mult, out, state)` | `length - 1` | Returns `{ line, direction }`, direction 1 up and -1 down; `state` is `{ atr, upper, lower }`. A run starts up when the close is at or above the bar's midpoint. |
| `ichimoku(high, low, conversionLength, baseLength, spanBLength)` | `ichimokuAt(high, low, i, conversionLength, baseLength, spanBLength, out)` | `max(...lengths) - 1` | Returns `{ conversion, base, spanA, spanB }`, each at the bar it is computed on; shift the spans forward yourself. |

### Volume

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `vwap(price, volume, newSession?, out?, state?)` | `vwapAt(price, volume, i, out, state, newSession?)` | 0 | Restarts where `newSession(i)` is true; `state` is `{ priceVolume, volume }`. |
| `obv(close, volume)` | `obvAt(close, volume, i, out)` | 0 | Starts at 0. |

### Cycles

`moonPhase(time)` takes one time in unix seconds and returns `{ age, illumination }`: days since the last new moon (0 up to `SYNODIC_MONTH`, about 29.53, with the full moon at half of that) and the lit fraction of the disc from 0 to 1. It uses the mean lunar cycle, so true new and full moons fall within about 15 hours of where it puts them.

`newSession` decides where VWAP restarts. For daily sessions in UTC, with `time` in Unix seconds:

```ts
const day = (t: number) => Math.floor(t / 86400);
const daily = (i: number) => i > 0 && day(time[i]!) !== day(time[i - 1]!);
const values = vwap(hlc3, volume, daily);
```

### Helpers

| Function | Single bar | Lookback | Notes |
| --- | --- | --- | --- |
| `highest(values, length)` | `highestAt(values, i, length)` | `length - 1` | |
| `lowest(values, length)` | `lowestAt(values, i, length)` | `length - 1` | |
| `change(values, length = 1)` | `changeAt(values, i, length)` | `length` | `value - value[length bars back]`. |
| `sum(values, length)` | `sumAt(values, i, length)` | `length - 1` | |
| `cum(values)` | `cumAt(values, i, out)` | 0 | Running total. |
| `crossOver(a, b)` | `crossOverAt(a, b, i)` | 1 | 1 where `a` crosses above `b`, else 0. `b` may be a number. |
| `crossUnder(a, b)` | `crossUnderAt(a, b, i)` | 1 | 1 where `a` crosses below `b`, else 0. |
