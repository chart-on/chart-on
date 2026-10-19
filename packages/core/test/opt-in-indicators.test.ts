import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import type { AccessItem } from '../src/access';
import type { ChartOptionsPatch } from '../src/chart';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

// Indicators and compared symbols are opt-in plugins. The test setup gives every chart the
// built-in plugins, so these tests load fresh copies of the modules and see `createChart` as an
// app does: without plugins unless it passes them.

type Core = typeof import('../src/index');

/** An allow list written as a predicate: indicators only `test/half`, every drawing tool. */
const onlyHalf = (item: AccessItem) => item.kind !== 'indicator' || item.id === 'test/half';

let core: Core;
const charts: { destroy(): void }[] = [];

beforeEach(async () => {
  vi.resetModules();
  core = await import('../src/index');
});

afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

function chart(options?: ChartOptionsPatch) {
  const c = core.createChart(fakeContainer(), options);
  charts.push(c);
  return c;
}

/** The error `fn` throws. */
function thrown(fn: () => unknown): { code?: string; message: string; context?: Record<string, unknown> } {
  try {
    fn();
  } catch (error) {
    return error as { code?: string; message: string; context?: Record<string, unknown> };
  }
  throw new Error('did not throw');
}

const bar = (time: number, close: number): Bar => ({ time, open: close, high: close, low: close, close });
const bars = Array.from({ length: 50 }, (_, i) => bar(i * 60, 100 + i));

const half: IndicatorDef = {
  id: 'test/half',
  name: 'Half',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: src.close.map((v) => v / 2) }),
};

/** A plugin that registers `half`. */
const halfPlugin = () => ({ name: 'test-half', version: '1.0.0', install: (ctx: { registerIndicator(def: IndicatorDef): void }) => ctx.registerIndicator(half) });

/** A source with the same bars for every symbol. */
function source(): DataSource {
  return {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
    search: async () => [],
    history: async (_symbol, _interval, req) => {
      const page = bars.filter((b) => req.to === undefined || b.time < req.to).slice(-req.limit);
      return { bars: page, atStart: page.length < req.limit };
    },
    stream: () => () => {},
  };
}

describe('indicators as a plugin', () => {
  it('a chart without indicators() throws for them, and works without them', () => {
    const c = chart({ plugins: [core.layouts()], access: { allow: onlyHalf, limits: { indicators: 2 } } });
    const error = thrown(() => c.indicators);
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('indicators()');
    expect(error.context).toEqual({ call: 'indicators', plugin: 'indicators()' });
    // A plugin's indicator needs them too, and the failed install leaves nothing behind.
    expect(thrown(() => c.install(halfPlugin())).code).toBe('not-registered');
    expect(c.installedPlugins).toEqual(['@chart-on/core/layouts']);
    // The access options are kept for an indicators plugin installed later.
    expect(c.options.access.allow).toBe(onlyHalf);
    expect(c.options.access.limits).toEqual({ indicators: 2 });
    c.addCandles().setData(bars);
    (c as unknown as { frame(now: number): void }).frame(16);
    expect(c.getSelection()).toBeNull();
    expect(c.serializeLayout().indicators).toBeUndefined();
    // No selection and no edit commands: Delete and the copy, paste and undo keys stay the page's.
    for (const id of ['remove-selected', 'copy', 'cut', 'paste', 'undo', 'redo']) expect(c.actions.has(id)).toBe(false);
  });

  it('installs later with the access options and plugin definitions, and uninstalling keeps the indicators for later', () => {
    const c = chart({ plugins: [core.layouts()], access: { limits: { indicators: 1 } } });
    c.addCandles().setData(bars);
    c.install(core.indicators());
    expect(c.indicators.limit).toBe(1);
    // The plugin brings the selection and its commands.
    expect(c.actions.has('remove-selected') && c.actions.has('undo')).toBe(true);
    c.install(halfPlugin());
    const added = c.indicators.add('test/half');
    const own = c.addPane();
    expect(c.panes).toHaveLength(3);
    expect(Array.from(added.values.value!).slice(0, 2)).toEqual([50, 50.5]);

    c.uninstall('@chart-on/core/indicators');
    expect(thrown(() => c.indicators).code).toBe('not-registered');
    // Its series goes and its pane stays, empty, in its place; the saved state stays for a later install and for layouts.
    expect(c.panes).toHaveLength(3);
    expect(c.panes[2]).toBe(own);
    expect(c.panes.map((p) => p.series.map((s) => s.kind))).toEqual([['candles'], [], []]);
    expect(c.serializeLayout().indicators).toEqual([expect.objectContaining({ type: 'test/half', id: added.id, pane: 1 })]);
    expect(c.serializeLayout().panes).toHaveLength(3);
    expect(c.history.canUndo).toBe(false);

    // Installed again: the plugin's definition and the indicator come back, in the same place.
    c.install(core.indicators());
    expect(c.indicators.getAll().map((i) => [i.type, i.id, i.pending])).toEqual([['test/half', added.id, false]]);
    expect(c.panes).toHaveLength(3);
    expect(c.indicators.getAll()[0]!.series!.pane).toBe(c.panes[1]);
    expect(c.panes[2]).toBe(own);
    expect(c.indicators.limit).toBe(1);

    // The definition plugin and indicators can go in either order.
    c.uninstall('@chart-on/core/indicators');
    expect(c.uninstall('test-half')).toBe(true);
    c.install(core.indicators());
    expect(c.indicators.getDefinitions()).toEqual([]);
    expect(c.indicators.getAll().map((i) => i.pending)).toEqual([true]);
    // A pending indicator draws nothing, so its kept pane goes; it opens in a new one once registered.
    expect(c.panes).toHaveLength(2);
    expect(c.panes[1]).toBe(own);
    // The options reach a reinstalled manager.
    c.applyOptions({ access: { allow: onlyHalf, limits: { indicators: 3 } } });
    expect(c.indicators.isAllowed('test/half')).toBe(true);
    expect(c.indicators.isAllowed('test/other')).toBe(false);
    expect(c.indicators.limit).toBe(3);
  });

  it('keeps a layout\'s indicators on a chart without indicators, and saves them back untouched', () => {
    const full = chart({ plugins: [core.layouts(), core.indicators(), halfPlugin()] });
    full.addCandles().setData(bars);
    full.indicators.add('test/half');
    const saved = full.serializeLayout();
    expect(saved.indicators).toHaveLength(1);

    const plain = chart({ plugins: [core.layouts()] });
    plain.addCandles().setData(bars);
    const result = plain.loadLayout(saved);
    expect(result.errors.map((e) => e.part)).toEqual(['indicators']);
    expect(result.errors[0]!.reason).toContain('indicators()');
    // Kept for the missing plugin, not unknown.
    expect(result.unknown).toEqual([]);
    // Its pane stays, empty, in place.
    expect(plain.panes).toHaveLength(2);
    const again = plain.serializeLayout();
    expect(again.indicators).toEqual(saved.indicators);
    expect(again.panes).toEqual(saved.panes);

    // An empty list, as every layout of a chart with indicators has, loads quietly.
    const empty = chart({ plugins: [core.layouts()] });
    empty.addCandles().setData(bars);
    expect(empty.loadLayout({ ...saved, indicators: [] }).errors).toEqual([]);
    expect(empty.serializeLayout().indicators).toEqual([]);

    // Once the plain chart gets indicators, they are there.
    plain.install(core.indicators());
    plain.install(halfPlugin());
    expect(plain.indicators.getAll().map((i) => [i.type, i.pending])).toEqual([['test/half', false]]);
    expect(plain.serializeLayout().indicators).toEqual(saved.indicators);
  });

  it('installs later over a layout whose saved indicators do not parse, loading the ones that do', () => {
    const full = chart({ plugins: [core.layouts(), core.indicators(), halfPlugin()] });
    full.addCandles().setData(bars);
    full.indicators.add('test/half');
    const saved = full.serializeLayout();

    for (const indicators of ['not a list', [42, ...(saved.indicators as unknown[])]]) {
      const plain = chart({ plugins: [core.layouts()] });
      plain.addCandles().setData(bars);
      plain.loadLayout({ ...saved, indicators });
      plain.install(core.indicators());
      plain.install(halfPlugin());
      expect(plain.installedPlugins).toEqual(['@chart-on/core/layouts', '@chart-on/core/indicators', 'test-half']);
      expect(plain.indicators.getAll().map((i) => i.type)).toEqual(typeof indicators === 'string' ? [] : ['test/half']);
    }
  });
});

describe('indicator layouts on a chart without indicators', () => {
  it('keeps the panes of saved indicators, in order and at their heights, through a round trip', () => {
    const full = chart({ plugins: [core.layouts(), core.indicators(), halfPlugin()] });
    full.addCandles().setData(bars);
    full.indicators.add('test/half');
    const own = full.addPane();
    full.addLine({ title: 'Own' }, own);
    full.indicators.add('test/half');
    full.setPaneHeights([4, 1, 2, 3]);
    const saved = full.serializeLayout();
    expect(saved.indicators!.map((s) => s.pane)).toEqual([1, 3]);

    const plain = chart({ plugins: [core.layouts()] });
    plain.addCandles().setData(bars);
    plain.addLine({ title: 'Own' }, plain.addPane());
    plain.loadLayout(saved);
    const again = plain.serializeLayout();
    expect(again.panes!.map((p) => p.height)).toEqual(saved.panes!.map((p) => p.height));
    expect(again.indicators).toEqual(saved.indicators);

    // Back on a chart with indicators, everything is where it was.
    const other = chart({ plugins: [core.layouts(), core.indicators(), halfPlugin()] });
    other.addCandles().setData(bars);
    other.addLine({ title: 'Own' }, other.addPane());
    expect(other.loadLayout(again).errors).toEqual([]);
    expect(other.serializeLayout().panes).toEqual(saved.panes);
    expect(other.serializeLayout().indicators).toEqual(saved.indicators);
    expect(other.panes.map((p) => p.series.map((s) => s.kind))).toEqual([['candles'], ['indicator'], ['line'], ['indicator']]);
  });

  it('reports invalid saved indicators and keeps only the valid ones', () => {
    const plain = chart({ plugins: [core.layouts()] });
    plain.addCandles().setData(bars);
    const layout = { version: 1, indicators: [{ type: 'test/half', pane: 0 }, { nope: true }, 'x'] };
    const parts = plain.loadLayout(layout).errors.map((e) => e.part);
    expect(parts).toEqual(['indicators[1]', 'indicators[2]', 'indicators']);
    expect(plain.serializeLayout().indicators).toEqual([expect.objectContaining({ type: 'test/half', pane: 0 })]);
    // Installed later, it loads them.
    plain.install(core.indicators());
    expect(plain.indicators.getAll().map((i) => i.type)).toEqual(['test/half']);
    expect(plain.serializeLayout().indicators).toHaveLength(1);
  });

  it('moves panes on a chart without drawings', () => {
    const c = chart();
    c.addCandles().setData(bars);
    const a = c.addPane();
    const b = c.addPane();
    c.movePane(b, 1);
    expect(c.panes.slice(1)).toEqual([b, a]);
  });

  it('lets the drawing manager override the option rule for its kind', () => {
    const allow = (item: AccessItem) => item.id === 'trendline';
    const c = chart({ plugins: [core.drawings()], access: { allow } });
    expect(c.drawings.isToolAllowed('ray')).toBe(false);
    c.drawings.setAccess(null);
    expect(c.drawings.isToolAllowed('ray')).toBe(true);
    // The options keep what the app set.
    expect(c.options.access.allow).toBe(allow);
  });
});

describe('compared symbols as a plugin', () => {
  it('a chart without comparisons() throws for compare, and lists none', async () => {
    const c = chart({ plugins: [core.dataSource()] });
    c.setDataSource(source());
    await c.setSymbol('A', '1m');
    const error = thrown(() => c.compare('B'));
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('comparisons()');
    expect(error.context).toEqual({ call: 'compare', plugin: 'comparisons()' });
    expect(c.compared).toEqual([]);
    await c.reload();
  });

  it('installs later, and uninstalling removes the compared symbols', async () => {
    const c = chart({ plugins: [core.dataSource()] });
    c.setDataSource(source());
    await c.setSymbol('A', '1m');
    c.install(core.comparisons());
    const b = c.compare('B');
    await b.ready;
    const p = c.compare('P', { mode: 'pane' });
    await p.ready;
    expect(c.compared).toEqual([b, p]);
    expect(c.getPriceScaleMode()).toBe('percent');
    expect(c.panes).toHaveLength(2);

    c.uninstall('@chart-on/core/comparisons');
    expect(c.compared).toEqual([]);
    expect(c.panes).toHaveLength(1);
    expect(c.panes[0]!.series.map((s) => s.kind)).toEqual(['candles']);
    // The last percent comparison to go gives the main scale its mode back.
    expect(c.getPriceScaleMode()).toBe('normal');
    expect(thrown(() => c.compare('B')).code).toBe('not-registered');
  });

  it('comes with builtins(), and a destroyed chart refuses compare as before', async () => {
    const c = chart({ plugins: core.builtins() });
    c.setDataSource(source());
    await c.setSymbol('A', '1m');
    await c.compare('B').ready;
    c.destroy();
    expect(thrown(() => c.compare('C')).code).toBe('destroyed');
  });
});
