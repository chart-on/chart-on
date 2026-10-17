---
description: "Feed the chart from a unified exchange library: history paging, timeframes, markets and live bars through createOhlcvDataSource."
---

# Exchange libraries

Unified exchange libraries put many exchanges, centralized and decentralized, behind one API. Their market data methods share a shape: rows of `[timeMs, open, high, low, close, volume]` from a fetch method, the latest rows from an optional streaming method, a list of markets and the timeframes the exchange supports. `createOhlcvDataSource` turns such an exchange object into a chart data source, so history paging, symbol search and live bars work without writing an adapter.

`@charton/core` does not depend on any library. The adapter declares the few members it calls (`OhlcvExchange`) and accepts any object that has them. The library, and which exchange to use, stay in your app.

## Wiring an exchange

```ts
import { createChart, createOhlcvDataSource, dataSource } from '@charton/core';
// The exchange class comes from the library your app installs.
import { SomeExchange } from 'your-exchange-library';

const exchange = new SomeExchange();

const chart = createChart(el, { plugins: [dataSource()] });
chart.addCandles();
chart.setDataSource(createOhlcvDataSource(exchange));
await chart.setSymbol('BTC/USD', '1h');
```

The adapter calls these members:

| Member | Used for |
| --- | --- |
| `fetchOHLCV(symbol, timeframe, since?, limit?)` | History pages, and the newest rows when polling |
| `watchOHLCV(symbol, timeframe)` (optional) | Live bars: resolves with the latest rows each time the forming bar changes |
| `unWatchOHLCV(symbol, timeframe)` (optional) | Ends a stream when the chart unsubscribes |
| `loadMarkets()` | Symbols for `symbol` and `search`, loaded once |
| `timeframes` (optional) | The intervals each symbol supports |
| `has` (optional) | `has.watchOHLCV === false` means the exchange has no stream, so it is polled |
| `name` (optional) | Shown as the symbol's exchange |

Row times are milliseconds; the adapter converts them to the unix seconds the chart uses everywhere.

To switch between symbols of several exchanges in one chart, put one adapter per exchange behind [`createDataSourceRouter`](./data-sources#several-feeds-in-one-chart), which picks the exchange by a symbol prefix such as `FEED-A:BTC/USD`.

## History

The chart asks for bars newest first: at most `limit` bars before `to`. Exchanges page the other way, forward from a `since` time. The adapter computes `since` as `limit` bars before `to` (or `from`, when that is later), then fetches pages forward until it reaches `to` or the newest bar. It drops rows at or after `to` and returns the newest `limit`.

Each request asks for at most `maxBarsPerRequest` rows (500 by default). An exchange that returns fewer per request is paged anyway, so set the option to the exchange's documented maximum to use fewer requests:

```ts
createOhlcvDataSource(exchange, { maxBarsPerRequest: 1000 });
```

When a page before the oldest loaded bar holds no rows at all, the adapter reports `atStart` and the chart stops asking for older bars.

## Intervals

Symbols list the exchange's timeframes as their `intervals`, so the chart shows the nearest supported interval when another one is asked for (see [Intervals a symbol supports](./data-sources#intervals-a-symbol-supports)). Timeframes the chart cannot parse are left out.

An interval with the same length as a listed timeframe is mapped onto it: `'60m'` uses `'1h'` and `'7d'` uses `'1w'`. Calendar units keep their meaning, so `'1M'` is a month and is never matched with `'30d'`. Without a `timeframes` list, intervals are passed to the exchange as they are.

## Symbols

Each market becomes a symbol:

- `symbol` and `name`: the market's unified symbol, such as `'BTC/USD'`.
- `description`: base and quote, plus the market type, such as `'ETH/USD perpetual'`.
- `type`: the market type. Perpetual swaps (`'swap'`) show as `'perpetual'`; other types (`'spot'`, `'future'`, `'option'`) are kept.
- `tickSize` or `precision`: from the market's price precision. Exchanges give either a tick size (`0.01`) or a count of decimals (`2`). By default a fraction is read as a tick size and a whole number as decimals. Set `pricePrecision: 'tickSize'` for an exchange that quotes whole tick sizes such as `5`, or `'decimals'` to always read decimals.

Markets marked inactive are left out of search but still resolve. To add a timezone, rename a type or change anything else, pass `symbolInfo`:

```ts
createOhlcvDataSource(exchange, {
  symbolInfo: (market, info) => ({ ...info, description: `${market.base} perpetual future` }),
});
```

If `loadMarkets` fails, the next lookup tries again.

## Live bars

When the exchange has `watchOHLCV`, the adapter reads it in a loop: each read resolves when the forming bar changes. Otherwise it polls `fetchOHLCV` for the newest two rows every `pollMs` (5000 ms by default).

Either way the rule is the one [`createPollingDataSource`](./data-sources#polling-an-http-api) follows: each read sends, oldest first, every bar that is new or differs from the version sent last, so a late trade in the previous bar arrives before the next bar opens and an unchanged bar is not sent again. If a read no longer holds the bar sent last (for example, the tab slept through several bars), the adapter reports a reset from that bar through `onReset` and the chart refetches the gap.

## Errors and rate limits

Errors from `fetchOHLCV` reach the chart through the usual path: a `data:error` event with code `'load-failed'` or `'history-failed'` and the exchange's error as `cause`. The adapter does not retry history requests itself; the chart asks again when the user pages back.

A failed stream read or poll reports `reconnecting` through `onStatus` and waits before trying again, with exponential backoff from 1 to 30 seconds (set `reconnect: { minMs, maxMs }` to change it). The next good read reports `connected`, and the chart refetches the bars missed meanwhile. Each request checks `request.signal`, so switching symbol or interval stops paging after the page in flight.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `maxBarsPerRequest` | `500` | Most rows asked for in one history request |
| `pollMs` | `5000` | Poll period when the exchange has no stream |
| `reconnect` | `{ minMs: 1000, maxMs: 30000 }` | Backoff after a failed stream read or poll |
| `pricePrecision` | guessed | `'decimals'` or `'tickSize'`: what the market's price precision holds |
| `symbolInfo(market, info)` | none | Adjust the symbol built from a market |

## Testing your setup

`testDataSource` from `@charton/core/testing` checks a data source against the requests the chart sends. Run it with a fake exchange object in your tests, so they do not depend on the network:

```ts
import { createOhlcvDataSource, type OhlcvExchange } from '@charton/core';
import { testDataSource } from '@charton/core/testing';

const start = Math.floor(Date.now() / 60_000) * 60_000 - 399 * 60_000;
const rows = Array.from({ length: 400 }, (_, i) => [start + i * 60_000, 10, 11, 9, 10, 1]);

const fake: OhlcvExchange = {
  timeframes: ['1m', '1h'],
  loadMarkets: async () => [{ symbol: 'ABC/USD', base: 'ABC', quote: 'USD', type: 'spot' }],
  fetchOHLCV: async (_symbol, _timeframe, since, limit = 100) =>
    since === undefined ? rows.slice(-limit) : rows.filter((r) => r[0]! >= since).slice(0, limit),
};

expect(await testDataSource(createOhlcvDataSource(fake), { symbol: 'ABC/USD', interval: '1m' })).toEqual([]);
```
