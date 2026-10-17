import { intervalSeconds, type IndicatorDef, type IndicatorRow } from '@charton/core';

/**
 * A mock "open interest" feed: an indicator whose values are not a function
 * of the bars but come from elsewhere. The chart fetches rows for the loaded
 * range (in chunks, as history pages in) and streams live rows; the compute
 * step stays a pure function over the fetched data.
 */

/** Deterministic noise in [-1, 1) from a time and a symbol. */
function noise(time: number, symbol: string): number {
  let h = 2166136261;
  for (const ch of `${symbol}:${time}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/** Open interest at `time`: slow swings plus noise, scaled per symbol. */
function openInterest(time: number, symbol: string): number {
  const level = 40_000 + (symbol.charCodeAt(0) % 7) * 9_000;
  const week = 7 * 86_400;
  return level * (1 + 0.25 * Math.sin((2 * Math.PI * time) / week) + 0.03 * noise(time, symbol));
}

/** Resolve after `ms`, or reject when `signal` aborts first. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

type Inputs = { color: string };

export const openInterestIndicator: IndicatorDef<Inputs> = {
  id: 'demo/open-interest',
  name: 'Open interest (mock)',
  placement: 'pane',
  inputs: [{ id: 'color', type: 'color', label: 'Color', default: '' }],
  plots: [{ id: 'oi', type: 'histogram', title: 'OI', color: '#38bdf8', colorInput: 'color' }],
  title: () => 'Open interest (mock)',
  fields: ['oi'],
  chunkBars: 500,
  compute: (_src, _inputs, data) => ({ oi: data.oi!.slice() }),
  update: (_src, _inputs, index, out, data) => {
    out.oi![index] = data.oi![index]!;
  },
  supports: ({ symbol }) => (symbol.type === 'index' ? 'No open interest for an index' : true),
  async fetch({ symbol, interval, from, to, signal }) {
    // A pretend network round trip.
    await delay(250 + Math.random() * 250, signal);
    const step = intervalSeconds(interval);
    const rows: IndicatorRow[] = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) rows.push([t, openInterest(t, symbol.symbol)]);
    return rows;
  },
  subscribe({ symbol, interval }, onRow) {
    const step = intervalSeconds(interval);
    const timer = setInterval(() => {
      const t = Math.floor(Date.now() / 1000 / step) * step;
      onRow([t, openInterest(t, symbol.symbol) * (1 + 0.01 * noise(Date.now(), symbol.symbol))]);
    }, 1000);
    return () => clearInterval(timer);
  },
};
