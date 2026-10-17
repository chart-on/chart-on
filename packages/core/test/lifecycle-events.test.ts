import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartEvents } from '../src/chart';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(container = fakeContainer()) {
  const c = new Chart(container);
  charts.push(c);
  return c;
}

/** Every payload of `event`, in order. */
function record<K extends keyof ChartEvents>(c: Chart, event: K): ChartEvents[K][] {
  const out: ChartEvents[K][] = [];
  c.on(event, (payload) => out.push(payload));
  return out;
}

const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));

const source: DataSource = {
  symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
  search: async () => [],
  history: async () => ({ bars, atStart: true }),
};

describe('symbol:change', () => {
  it('fires once per switch, before the load, and an aborted switch never loads', async () => {
    const c = chart();
    c.setDataSource(source);
    const order: string[] = [];
    c.on('symbol:change', ({ symbol, previous }) => order.push(`change ${previous} -> ${symbol}`));
    c.on('data:loading', ({ symbol }) => order.push(`loading ${symbol}`));
    c.on('data:loaded', ({ symbol }) => order.push(`loaded ${symbol.symbol}`));
    await c.setSymbol('A', '1m');
    expect(order).toEqual(['change null -> A', 'loading A', 'loaded A']);
    order.length = 0;
    // Rapid A -> B -> C: two changes in order; B's load is aborted and never lands.
    const b = c.setSymbol('B', '1m').catch(() => {});
    const done = c.setSymbol('C', '1m');
    await Promise.all([b, done]);
    expect(order.filter((e) => e.startsWith('change'))).toEqual(['change A -> B', 'change B -> C']);
    expect(order).not.toContain('loaded B');
    expect(order.at(-1)).toBe('loaded C');
  });

  it('stays silent for the same symbol and for an invalid interval', async () => {
    const c = chart();
    c.setDataSource(source);
    const changes = record(c, 'symbol:change');
    await c.setSymbol('A', '1m');
    await c.setSymbol('A', '5m');
    await expect(c.setSymbol('B', 'nope' as never)).rejects.toThrow();
    expect(changes).toEqual([{ symbol: 'A', previous: null }]);
  });
});

describe('series lifecycle events', () => {
  const osc: IndicatorDef<{ length: number }> = {
    id: 'test/osc',
    name: 'Osc',
    placement: 'pane',
    inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
    plots: [{ id: 'value', type: 'line' }],
    compute: (src) => ({ value: src.close.map((v) => v / 2) }),
  };

  it('announces added series, with the indicator for an indicator series', () => {
    const c = chart();
    const added = record(c, 'series:add');
    const line = c.addLine();
    c.indicators.register(osc);
    const indicator = c.indicators.add('test/osc');
    expect(added).toEqual([
      { series: line, indicator: null },
      { series: indicator.series, indicator },
    ]);
  });

  it('reports option patches, and visibility changes once', () => {
    const c = chart();
    const line = c.addLine();
    const options = record(c, 'series:options');
    const visibility = record(c, 'series:visibility');
    line.applyOptions({ color: '#ff0000' });
    line.applyOptions({});
    expect(options).toEqual([{ series: line, patch: { color: '#ff0000' } }]);
    line.setVisible(false);
    line.setVisible(false);
    line.setVisible(true);
    expect(visibility).toEqual([
      { series: line, visible: false },
      { series: line, visible: true },
    ]);
  });

  it('says nothing for a series that is not on the chart', () => {
    const c = chart();
    const line = c.addLine();
    c.removeSeries(line);
    const visibility = record(c, 'series:visibility');
    line.setVisible(false);
    expect(visibility).toEqual([]);
  });
});

describe('chart lifecycle events', () => {
  it('reports timezone changes once', () => {
    const c = chart();
    c.applyOptions({ timezone: 'UTC' });
    const zones = record(c, 'timezone:change');
    c.applyOptions({ timezone: 'America/New_York' });
    c.applyOptions({ timezone: 'America/New_York' });
    expect(zones).toEqual([{ timezone: 'America/New_York', previous: 'UTC' }]);
  });

  it('reports a theme change, not a theme set to the same values', () => {
    const c = chart();
    const themes = record(c, 'theme:change');
    c.applyOptions({ theme: { up: '#123456' } });
    c.applyOptions({ theme: { up: '#123456' } });
    expect(themes).toHaveLength(1);
    expect(themes[0]!.theme.up).toBe('#123456');
  });

  it('reports size changes', () => {
    const c = chart();
    const sizes = record(c, 'chart:resize');
    c.resize();
    expect(sizes).toEqual([]);
    // The chart measures its own root element.
    (c as unknown as { root: { getBoundingClientRect(): object } }).root.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 640,
      height: 400,
      right: 640,
      bottom: 400,
    });
    c.resize();
    expect(sizes).toEqual([{ width: 640, height: 400 }]);
  });

  it('once listens for the next emission only, and can be cancelled', () => {
    const c = chart();
    const first = vi.fn();
    const cancelled = vi.fn();
    c.once('series:add', first);
    c.once('series:add', cancelled)();
    c.addLine();
    c.addLine();
    expect(first).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe('drawings:visibility', () => {
  it('fires once per change of drawings.hidden', () => {
    const c = chart();
    const seen = record(c, 'drawings:visibility');
    c.drawings.setHidden(false); // already shown
    c.drawings.setHidden(true);
    c.drawings.setHidden(true);
    c.drawings.setHidden(false);
    expect(seen).toEqual([{ hidden: true }, { hidden: false }]);
    expect(c.drawings.hidden).toBe(false);
  });
});
