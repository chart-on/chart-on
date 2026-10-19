import { createChart, dataSource, type Bar, type DataSource, type SymbolInfo } from '@chart-on/core';
import type { ExampleContext } from './types';
import { sampleBars, sampleTicks } from './sample-data';

export default function mount(el: HTMLElement, { theme }: ExampleContext) {
  const chart = createChart(el, { theme, plugins: [dataSource()] });
  chart.addCandles();
  chart.setDataSource(createSampleSource());
  void chart.setSymbol('SAMPLE', '1h');

  // `destroy` cancels requests in flight and calls the unsubscribe function.
  return () => chart.destroy();
}

/**
 * A data source written by hand. An array of bars stands in for your
 * server and `sampleTicks` for its live stream; swap in your API calls.
 */
function createSampleSource(): DataSource {
  const info: SymbolInfo = { symbol: 'SAMPLE', name: 'Sample market', precision: 2, intervals: ['1h'] };
  const stored = sampleBars(2000);
  /** Index of the first stored bar at or after `time`. */
  const indexOf = (time: number) => {
    const i = stored.findIndex((bar) => bar.time >= time);
    return i < 0 ? stored.length : i;
  };

  return {
    async symbol(symbol) {
      if (symbol !== info.symbol) throw new Error(`Unknown symbol ${symbol}`);
      return info;
    },

    async search(query) {
      return info.symbol.includes(query.toUpperCase()) ? [info] : [];
    },

    // At most `limit` bars, the newest ones in [from, to).
    async history(_symbol, _interval, req) {
      await latency(200, req.signal);
      const end = req.to === undefined ? stored.length : indexOf(req.to);
      const start = Math.max(end - req.limit, req.from === undefined ? 0 : indexOf(req.from));
      // Nothing older than the first stored bar: paging back stops there.
      return { bars: stored.slice(start, end), atStart: start === 0 };
    },

    // Keep live bars too, so later requests (a refresh, a reset) include them.
    stream(_symbol, _interval, onBar) {
      return sampleTicks(stored.at(-1)!, (bar: Bar) => {
        if (bar.time === stored.at(-1)!.time) stored[stored.length - 1] = bar;
        else stored.push(bar);
        onBar(bar);
      });
    },
  };
}

/** Waits like a network round trip, and gives up when the chart aborts the request. */
function latency(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
