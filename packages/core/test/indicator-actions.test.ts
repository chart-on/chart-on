import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartContextMenuEvent } from '../src/chart';
import type { IndicatorDef, IntervalRange } from '../src/indicators/types';
import type { CandleSeries } from '../src/series';
import type { DataSource, SymbolInfo } from '../src/data/types';

/** The parts of the fake DOM element the tests read. */
interface El {
  className: string;
  children: El[];
  style: Record<string, string>;
  getAttribute(name: string): string | null;
  dispatch(type: string, event?: Record<string, unknown>): void;
}

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const minuteBars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 + i }));
const hourBars = minuteBars.map((b, i) => ({ ...b, time: i * 3600 }));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles({ title: 'ABC' }).setData(minuteBars);
  return c;
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

const root = (c: Chart) => c.root as unknown as El;
const blocks = (c: Chart) => root(c).children.filter((e) => e.className === 'pc-legend');
const rows = (c: Chart, pane = 0) => blocks(c)[pane]!.children.filter((e) => e.className === 'pc-legend-row');
const buttons = (row: El) => row.children[1]!.children.filter((b) => b.style.display !== 'none');
const labels = (row: El) => buttons(row).map((b) => b.getAttribute('aria-label'));
const press = (row: El, label: RegExp) => buttons(row).find((b) => label.test(b.getAttribute('aria-label') ?? ''))!.dispatch('click');
/** Title and value spans of a row's text. */
const parts = (row: El) => row.children[0]!.children.map((e) => (e as unknown as { textContent: string }).textContent);

const paneDef: IndicatorDef = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [
    { id: 'length', type: 'number', default: 14 },
    { id: 'color', type: 'color', default: '#123456' },
  ],
  plots: [{ id: 'v', type: 'line', colorInput: 'color' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

const overlayDef: IndicatorDef = { ...paneDef, id: 'test/avg', name: 'Avg', placement: 'overlay' };

describe('indicators.duplicate', () => {
  it('copies inputs, visibility, label switches and intervals', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef, { length: 30, color: '#ff0000' }, { legend: true });
    ind.setVisible(false);
    ind.applyLabelOptions({ axisTitle: true });
    ind.setVisibleOn([{ from: '1m', to: '59m' }]);
    const added: unknown[] = [];
    c.on('indicator:add', ({ indicator }) => added.push(indicator));
    const copy = c.indicators.duplicate(ind);
    expect(copy).not.toBe(ind);
    expect(added).toEqual([copy]);
    expect(copy.inputs).toEqual({ length: 30, color: '#ff0000' });
    expect(copy.visible).toBe(false);
    expect(copy.labelOptions).toEqual({ lastValueLabel: true, axisTitle: true });
    expect(copy.visibleOn).toEqual([{ from: '1m', to: '59m' }]);
    expect(copy.series!.options.title).toBe(ind.series!.options.title);
    // Changing the copy leaves the original alone.
    copy.applyInputs({ length: 5 });
    expect(ind.inputs.length).toBe(30);
  });

  it('copies the price scale given to add', () => {
    const c = chart();
    const copy = c.indicators.duplicate(c.indicators.add(overlayDef, {}, { priceScale: 'left' }));
    expect(copy.priceScale).toBe('left');
    expect(copy.series!.options.priceScale).toBe('left');
    expect(copy.serialize().priceScale).toBe('left');
  });

  it("puts a pane indicator's copy in a new pane right below the original's", () => {
    const c = chart();
    const first = c.indicators.add(paneDef);
    const second = c.indicators.add({ ...paneDef, id: 'test/osc2' });
    const copy = c.indicators.duplicate(first);
    expect(c.panes).toHaveLength(4);
    expect(c.panes.indexOf(first.pane!)).toBe(1);
    expect(c.panes.indexOf(copy.pane!)).toBe(2);
    expect(c.panes.indexOf(second.pane!)).toBe(3);
  });

  it("puts an overlay's copy in the original's pane, also after a move", () => {
    const c = chart();
    const avg = c.indicators.add(overlayDef);
    expect(c.indicators.duplicate(avg).pane).toBe(c.panes[0]);
    const moved = c.moveSeries(avg.series!, 'new');
    const copy = c.indicators.duplicate(avg);
    expect(copy.pane).toBe(moved);
    expect(c.panes).toHaveLength(2);
  });

  it('copies a pending indicator as a pending placeholder', () => {
    const c = chart();
    c.indicators.load([{ type: 'test/unknown', inputs: { a: 1 }, pane: 0, visible: true }]);
    const [pending] = c.indicators.getAll();
    const copy = c.indicators.duplicate(pending!);
    expect(copy.pending).toBe(true);
    expect(copy.inputs).toEqual({ a: 1 });
    expect(c.indicators.serialize()).toHaveLength(2);
  });

  it('throws for an indicator not on the chart', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    ind.remove();
    expect(() => c.indicators.duplicate(ind)).toThrow(/not on this chart/);
  });
});

describe('moving indicators between panes', () => {
  it('moves up, down, to the price pane, to a new pane and into a pane', () => {
    const c = chart();
    const a = c.indicators.add(paneDef);
    const b = c.indicators.add({ ...paneDef, id: 'test/osc2' });
    const series = b.series!;
    // Into the pane above: b's own pane is left empty and goes.
    c.moveSeries(series, 'above');
    expect(b.pane).toBe(a.pane);
    expect(c.panes).toHaveLength(2);
    // Out again into a new pane below.
    c.moveSeries(series, 'new');
    expect(c.panes).toHaveLength(3);
    expect(c.panes.indexOf(b.pane!)).toBe(2);
    // Merged into the price pane, then into a's pane.
    c.moveSeries(series, c.panes[0]!);
    expect(b.pane).toBe(c.panes[0]);
    expect(c.panes).toHaveLength(2);
    c.moveSeries(series, a.pane!);
    expect(b.pane).toBe(a.pane);
    expect(c.indicators.serialize().map((s) => s.pane)).toEqual([1, 1]);
  });

  it('removes the pane an overlay was moved into once the overlay goes', () => {
    for (const def of [overlayDef, { ...paneDef, id: 'test/either', placement: 'either' } as IndicatorDef]) {
      const c = chart();
      const ind = c.indicators.add(def);
      expect(ind.pane).toBe(c.panes[0]);
      c.moveSeries(ind.series!, 'new');
      expect(c.panes).toHaveLength(2);
      ind.remove();
      expect(c.panes).toHaveLength(1);
    }
  });

  it('keeps the pane a moved overlay leaves while it holds drawings', () => {
    const c = chart();
    const ind = c.indicators.add(overlayDef);
    c.moveSeries(ind.series!, 'new');
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 60, price: 2 }], style: {} });
    ind.remove();
    expect(c.panes).toHaveLength(2);
    c.history.undo();
    expect(ind.pane).toBe(c.panes[1]);
    expect(c.panes).toHaveLength(2);
  });
});

describe('interval visibility', () => {
  it('hides the series off the chosen intervals and keeps the user toggle', () => {
    const c = chart();
    const ind = c.indicators.add(overlayDef);
    const changes: unknown[] = [];
    c.on('indicator:change', ({ indicator }) => changes.push(indicator));
    ind.setVisibleOn([{ from: '1h', to: '4h' }]);
    expect(changes).toEqual([ind]);
    expect(ind.hiddenByInterval).toBe(true);
    expect(ind.series!.visible).toBe(false);
    expect(ind.visible).toBe(true);
    // Hiding it by hand while off-interval sticks once the interval fits.
    ind.setVisible(false);
    (c.panes[0]!.series[0] as CandleSeries).setData(hourBars);
    expect(ind.hiddenByInterval).toBe(false);
    expect(ind.series!.visible).toBe(false);
    ind.setVisible(true);
    expect(ind.series!.visible).toBe(true);
    // Back to minutes: hidden again; every interval again: shown.
    (c.panes[0]!.series[0] as CandleSeries).setData(minuteBars);
    expect(ind.series!.visible).toBe(false);
    ind.setVisibleOn(null);
    expect(ind.visibleOn).toBeNull();
    expect(ind.series!.visible).toBe(true);
  });

  it('keeps an off-interval indicator listed, dimmed, with the eye showing the user toggle', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    ind.setVisibleOn([{ from: '1d', to: '1w' }]);
    frame(c);
    const row = rows(c, 1)[0]!;
    expect(row.style.opacity).toBe('0.5');
    expect(labels(row)[0]).toMatch(/^Hide/);
    press(row, /^Hide/);
    expect(ind.visible).toBe(false);
    expect(ind.series!.visible).toBe(false);
  });

  it('follows the interval the data source loads', async () => {
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
      search: async () => [],
      history: async () => ({ bars: minuteBars, atStart: true }),
    };
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    const ind = c.indicators.add(overlayDef);
    ind.setVisibleOn([{ from: '1h', to: '1d' }]);
    expect(ind.hiddenByInterval).toBe(true);
    // The declared interval counts, not the bars' spacing.
    await c.setSymbol('A', '4h');
    expect(ind.hiddenByInterval).toBe(false);
    await c.setSymbol('A', '1w');
    expect(ind.hiddenByInterval).toBe(true);
  });

  it('survives serialization and layouts, and drops invalid saved ranges', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    ind.setVisibleOn([{ from: '1h', to: '4h' }]);
    const state = c.indicators.serialize();
    expect(state[0]!.visibleOn).toEqual([{ from: '1h', to: '4h' }]);
    const layout = JSON.parse(JSON.stringify(c.serializeLayout()));

    const d = chart();
    d.indicators.register(paneDef);
    d.loadLayout(layout);
    const [restored] = d.indicators.getAll();
    expect(restored!.visibleOn).toEqual([{ from: '1h', to: '4h' }]);
    expect(restored!.hiddenByInterval).toBe(true);

    d.indicators.load([{ ...state[0], visibleOn: [{ from: '4h', to: '1h' }, { from: 'x', to: '1h' }, 3] }]);
    expect(d.indicators.getAll()[0]!.visibleOn).toBeNull();
  });

  it('keeps ranges while pending and applies them once registered', () => {
    const c = chart();
    c.indicators.load([{ type: 'test/osc', inputs: {}, pane: 1, visible: true, visibleOn: [{ from: '1d', to: '1d' }] }]);
    const [ind] = c.indicators.getAll();
    expect(ind!.pending).toBe(true);
    expect(ind!.hiddenByInterval).toBe(false);
    c.indicators.register(paneDef);
    expect(ind!.hiddenByInterval).toBe(true);
    expect(ind!.series!.visible).toBe(false);
  });

  it('rejects invalid ranges', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    expect(() => ind.setVisibleOn([{ from: '1h', to: '1m' }])).toThrow(/Invalid interval range/);
    expect(() => ind.setVisibleOn([{ from: '1x', to: '1m' } as unknown as IntervalRange])).toThrow(/Invalid interval range/);
    expect(ind.visibleOn).toBeNull();
  });
});

describe('legend row menu', () => {
  it('shows a More button while the app listens for chart:contextmenu, and opens the row menu', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    frame(c);
    expect(labels(rows(c, 1)[0]!)).not.toContain('More actions for Osc 14');
    const events: ChartContextMenuEvent[] = [];
    const off = c.on('chart:contextmenu', (e) => events.push(e));
    frame(c);
    const row = rows(c, 1)[0]!;
    expect(labels(row)).toContain('More actions for Osc 14');
    press(row, /^More/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ target: 'legend', series: ind.series, pane: 1, time: null, price: null, scale: null });
    off();
    frame(c);
    expect(labels(rows(c, 1)[0]!)).not.toContain('More actions for Osc 14');
  });

  it('finds the series of a row element, and opens nothing with the menu feature off', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    const events: unknown[] = [];
    c.on('chart:contextmenu', (e) => events.push(e));
    frame(c);
    const row = rows(c, 1)[0]!;
    expect(c.legendSeriesAt(row.children[0] as unknown as EventTarget)).toBe(ind.series);
    expect(c.legendSeriesAt(root(c) as unknown as EventTarget)).toBeNull();
    c.applyOptions({ features: { contextMenu: false } });
    expect(c.openLegendMenu(ind.series!, 0, 0)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('folds a row to its title', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    frame(c);
    const full = parts(rows(c, 1)[0]!);
    expect(full.length).toBeGreaterThan(1);
    c.setLegendFolded(ind.series!, true);
    expect(c.isLegendFolded(ind.series!)).toBe(true);
    frame(c);
    expect(parts(rows(c, 1)[0]!)).toEqual(['Osc 14']);
    c.setLegendFolded(ind.series!, false);
    frame(c);
    expect(parts(rows(c, 1)[0]!)).toEqual(full);
  });

  it("saves an indicator row's fold and tells listeners", () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    const changes: unknown[] = [];
    c.on('indicator:change', (e) => changes.push(e.indicator));
    c.setLegendFolded(ind.series!, true);
    c.setLegendFolded(ind.series!, true);
    expect(changes).toEqual([ind]);
    expect(ind.serialize().folded).toBe(true);

    const other = chart();
    other.indicators.register(paneDef);
    other.indicators.load(c.indicators.serialize());
    const restored = other.indicators.getAll()[0]!;
    expect(other.isLegendFolded(restored.series!)).toBe(true);
    frame(other);
    expect(parts(rows(other, 1)[0]!)).toEqual(['Osc 14']);

    c.setLegendFolded(ind.series!, false);
    expect(changes).toHaveLength(2);
    expect(ind.serialize()).not.toHaveProperty('folded');
    // A copy keeps the fold, like the rest of the state.
    c.setLegendFolded(ind.series!, true);
    expect(c.isLegendFolded(c.indicators.duplicate(ind).series!)).toBe(true);
  });

  it('keeps a folded row of a pending indicator and reads a saved fold strictly', () => {
    const c = chart();
    c.indicators.load([
      { type: 'test/unknown', inputs: {}, pane: 0, visible: true, folded: true },
      { type: 'test/unknown', inputs: {}, pane: 0, visible: true, folded: 'yes' as unknown as boolean },
    ]);
    const [folded, plain] = c.indicators.getAll();
    expect(folded!.serialize().folded).toBe(true);
    expect(plain!.serialize()).not.toHaveProperty('folded');
  });

  it('folds other series without saving or events', () => {
    const c = chart();
    const line = c.addLine();
    const changes: unknown[] = [];
    c.on('indicator:change', (e) => changes.push(e));
    c.setLegendFolded(line, true);
    expect(c.isLegendFolded(line)).toBe(true);
    expect(changes).toHaveLength(0);
  });

  it('asks for settings through openSeriesSettings only while someone listens', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    expect(c.openSeriesSettings(ind.series!)).toBe(false);
    const seen: unknown[] = [];
    c.on('series:settings', (e) => seen.push(e));
    expect(c.openSeriesSettings(ind.series!)).toBe(true);
    expect(seen).toEqual([{ series: ind.series, indicator: ind }]);
  });
});
