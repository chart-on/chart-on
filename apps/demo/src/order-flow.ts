import {
  createBarBuilder,
  createChart,
  createFootprintBuilder,
  footprintSeries,
  tpoColumns,
  tpoSeries,
  type Bar,
  type FootprintBar,
  type FootprintSeriesOptions,
  type Interval,
  type TradeTick,
} from '@chart-on/core';
import { light, theme } from './page-theme';
import { rng } from './data';
import { expose } from './expose';

/** Footprint: 5-minute bars, rows of five price ticks. */
const FOOTPRINT = { interval: '5m' as Interval, rowSize: 0.05 };
/** TPO: one period per 30-minute bar, rows of fifty ticks, one profile per UTC day (the `tpoColumns` default). */
const PERIOD: Interval = '30m';
const TPO = { rowSize: 0.5 };
/** Days of trades before now. */
const HISTORY_DAYS = 3;

/**
 * Made-up trades from `start` on: a trade every 2 seconds on average, sized
 * with a heavy tail. Order flow drifts between buying and selling pressure,
 * buys lift the price and sells hit it, so trends, imbalances and busy
 * prices show up. Each call returns the trades up to `until`. Seeded, so
 * reloads show the same history.
 */
function tradeFeed(start: number, price: number, seed = 5): (until: number) => TradeTick[] {
  const random = rng(seed);
  let time = start;
  let last = price;
  let flow = 0;
  const step = () => (time += -Math.log(1 - random()) * 2);
  step();
  return (until) => {
    const out: TradeTick[] = [];
    for (; time <= until; step()) {
      flow = flow * 0.995 + (random() - 0.5) * 0.03;
      const buy = random() < 0.5 + flow;
      last = Math.max(1, last + (buy ? 0.01 : -0.01) * Math.floor(random() * 3));
      out.push({ time, price: Math.round(last * 100) / 100, size: Math.round(1 / (1 - random() * 0.99) ** 0.8), side: buy ? 'buy' : 'sell' });
    }
    return out;
  };
}

/** Replace the newest item when `item` is its newer version, or append it. */
function upsert<T extends { time: number }>(list: T[], item: T): void {
  if (list.length && list[list.length - 1]!.time === item.time) list[list.length - 1] = item;
  else list.push(item);
}

/** Pass the items from `from` on (the forming one and any started since) to a series. */
function updateFrom<T>(series: { update(item: T): void }, list: readonly T[], from: number): void {
  for (let i = Math.max(0, from); i < list.length; i++) series.update(list[i]!);
}

const now = () => Date.now() / 1000;
const feed = tradeFeed(Math.floor(now() / 86400 - HISTORY_DAYS) * 86400, 100);

// Footprint: 5-minute bars, rows of 0.05. The candles set the time axis and are hidden; the footprint shows the range.
const footprintChart = createChart(document.getElementById('footprint')!, { theme: theme(), timezone: 'UTC' });
const prices = footprintChart.addCandles({ title: 'Price 5m' });
prices.setVisible(false);
const footprint = footprintChart.addCustomSeries(footprintSeries, { title: 'Footprint 5m' });
const footprintBuilder = createFootprintBuilder(FOOTPRINT);
const priceBuilder = createBarBuilder({ interval: FOOTPRINT.interval });

// TPO: 30-minute periods in daily UTC sessions, rows of 0.5, over hidden 30-minute candles.
const tpoChart = createChart(document.getElementById('tpo')!, { theme: theme(), timezone: 'UTC' });
const periods = tpoChart.addCandles({ title: 'Price 30m' });
periods.setVisible(false);
const tpo = tpoChart.addCustomSeries(tpoSeries, { title: 'TPO 30m' });
const periodBuilder = createBarBuilder({ interval: PERIOD });

const footprintBars: FootprintBar[] = [];
const priceBars: Bar[] = [];
const periodBars: Bar[] = [];

/** Feed trades to the three builders; returns whether a 30-minute bar changed. */
function add(trades: readonly TradeTick[]): boolean {
  let period = false;
  for (const trade of trades) {
    const bar = footprintBuilder.push(trade);
    if (bar) upsert(footprintBars, bar);
    const price = priceBuilder.push(trade);
    if (price) upsert(priceBars, price);
    const p = periodBuilder.push(trade);
    if (p) {
      upsert(periodBars, p);
      period = true;
    }
  }
  return period;
}

add(feed(now()));
prices.setData(priceBars);
footprint.setData(footprintBars);
periods.setData(periodBars);
tpo.setData(tpoColumns(periodBars, TPO));
// Close enough for row text in the footprint and letters in the TPO profiles.
footprintChart.setBarSpacing(64);
tpoChart.setBarSpacing(12);

// Live: the forming bars update every second (several bars after a throttled background tab).
// A TPO period changes its whole session's profile, so the TPO data is rebuilt.
setInterval(() => {
  const trades = feed(now());
  const from = [footprintBars.length - 1, priceBars.length - 1, periodBars.length - 1] as const;
  if (!trades.length) return;
  const periodChanged = add(trades);
  updateFrom(footprint, footprintBars, from[0]);
  updateFrom(prices, priceBars, from[1]);
  if (!periodChanged) return;
  updateFrom(periods, periodBars, from[2]);
  tpo.setData(tpoColumns(periodBars, TPO));
}, 1000);

light.addEventListener('change', () => {
  footprintChart.applyOptions({ theme: theme() });
  tpoChart.applyOptions({ theme: theme() });
});

const values = document.getElementById('values') as HTMLSelectElement;
values.addEventListener('change', () => footprint.applyOptions({ values: values.value as FootprintSeriesOptions['values'] }));
const letters = document.getElementById('letters') as HTMLInputElement;
letters.addEventListener('change', () => tpo.applyOptions({ letters: letters.checked }));

expose({ footprintChart, tpoChart });
