import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { dataSource, marketStatus, sourceMarkers } from '../src/builtins';
import { Chart } from '../src/chart';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { ChartPlugin } from '../src/plugins';

// `data/wiring.ts` handles a data source's events for the `dataSource()` plugin: the in-pane
// status, the market badge's delay, and the source markers that follow each load.

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A source whose symbols are 15 minutes delayed; `fail` makes the next history request fail. */
function delayedSource(markers: boolean) {
  const state = { fail: false, markerRequests: 0 };
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, delay: 15 }) as SymbolInfo,
    search: async () => [],
    history: async () => (state.fail ? Promise.reject(new Error('down')) : { bars }),
    ...(markers
      ? {
          markers: async () => {
            state.markerRequests++;
            return [];
          },
        }
      : {}),
  };
  return { source, state };
}

const badge = (c: Chart) => (c as unknown as { badge: string }).badge;

describe.each([
  ['without sourceMarkers()', [dataSource(), marketStatus()]],
  ['with sourceMarkers()', [dataSource(), marketStatus(), sourceMarkers()]],
] as [string, ChartPlugin[]][])('the data source wiring %s', (_name, plugins) => {
  it('sets the status and the badge delay on a load, and resets both on an error', async () => {
    const c = new Chart(fakeContainer(), { plugins });
    charts.push(c);
    const { source, state } = delayedSource(true);
    c.setDataSource(source);
    const loading = c.setSymbol('A', '1m');
    expect(c.getStatus()).toEqual({ kind: 'loading' });
    await loading;
    expect(c.getStatus()).toBeNull();
    expect(c.marketStatus().delay).toBe(15);
    expect(badge(c)).toBe('15 min delayed');
    await tick();
    // Markers are only fetched with the plugin.
    const withMarkers = plugins.some((p) => p.name === '@charton/core/source-markers');
    expect(state.markerRequests > 0).toBe(withMarkers);

    state.fail = true;
    await c.setSymbol('B', '1m').catch(() => {});
    expect(c.getStatus()).toMatchObject({ kind: 'error', detail: 'down' });
    expect(c.marketStatus().delay).toBe(0);
    expect(badge(c)).toBe('');
  });
});
