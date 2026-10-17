import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { DataSource, SymbolInfo } from '../src/data/types';

/** The parts of the fake DOM element the tests read. */
interface El {
  className: string;
  title: string;
  children: El[];
  parent: El | null;
  style: Record<string, string>;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: () => void): void;
  dispatch(type: string, event?: Record<string, unknown>): void;
}

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 + i }));

function chart(options: Partial<ChartOptions> = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ title: 'ABC' }).setData(bars);
  return c;
}

/** Run one frame loop step, drawing only what the chart marked dirty. */
function step(c: Chart): void {
  (c as unknown as { render(t: number): void }).render(0);
}

function frame(c: Chart): void {
  c.invalidate();
  step(c);
}

const root = (c: Chart) => c.root as unknown as El;
const blocks = (c: Chart) => root(c).children.filter((e) => e.className === 'pc-legend');
const rows = (c: Chart, pane = 0) => blocks(c)[pane]!.children.filter((e) => e.className === 'pc-legend-row');
const buttons = (row: El) => row.children[1]!.children.filter((b) => b.style.display !== 'none');
const labels = (row: El) => buttons(row).map((b) => b.getAttribute('aria-label'));
const press = (row: El, label: RegExp) => buttons(row).find((b) => label.test(b.getAttribute('aria-label') ?? ''))!.dispatch('click');
/** Dispatch on `el` and then its ancestors, as the DOM bubbles, until a listener stops it. */
function bubble(el: El, type: string, event: Record<string, unknown> = {}): void {
  let stopped = false;
  const e = { ...event, stopPropagation: () => (stopped = true) };
  for (let at: El | null = el; at && !stopped; at = at.parent) at.dispatch(type, e);
}
const toggle = (c: Chart, pane = 0) => blocks(c)[pane]!.children.find((e) => e.className === 'pc-legend-toggle');

const paneDef: IndicatorDef = {
  id: 'test/close',
  name: 'Close',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

describe('legend row buttons', () => {
  it('shows hide and remove buttons, but no remove for the main series', () => {
    const c = chart();
    c.addLine({ title: 'Avg' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    frame(c);
    const [main, line] = rows(c);
    expect(labels(main!)).toEqual(['Hide ABC']);
    expect(labels(line!)).toEqual(['Hide Avg', 'Remove Avg']);
  });

  it('shows a settings button only while the app listens for it', () => {
    const c = chart();
    frame(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC']);
    const seen: string[] = [];
    const off = c.on('series:settings', ({ series, indicator }) => seen.push(`${series.kind}:${indicator === null}`));
    step(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC', 'Settings for ABC']);
    press(rows(c)[0]!, /^Settings/);
    expect(seen).toEqual(['candles:true']);
    off();
    step(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC']);
  });

  it('shows a settings button only on rows a declared handler covers', () => {
    const c = chart();
    const line = c.addLine({ title: 'Avg' });
    const main = c.panes[0]!.series[0]!;
    const seen: string[] = [];
    c.on('series:settings', ({ series }) => seen.push(series === line ? 'Avg' : 'other'));
    frame(c);
    expect(labels(rows(c)[0]!)).toContain('Settings for ABC');
    const off = c.provideSeriesSettings((series) => series === line);
    step(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC']);
    expect(labels(rows(c)[1]!)).toEqual(['Hide Avg', 'Settings for Avg', 'Remove Avg']);
    expect(c.hasSeriesSettings(main)).toBe(false);
    expect(c.hasSeriesSettings(line)).toBe(true);
    expect(c.openSeriesSettings(main)).toBe(false);
    press(rows(c)[1]!, /^Settings/);
    expect(seen).toEqual(['Avg']);
    // A handler covering indicators adds their rows, and the indicator reaches it.
    const ind = c.indicators.add(paneDef);
    const offIndicators = c.provideSeriesSettings((_series, indicator) => indicator === ind);
    step(c);
    expect(c.hasSeriesSettings(ind.series!)).toBe(true);
    expect(labels(rows(c, 1)[0]!)).toContain('Settings for Close');
    offIndicators();
    // With no handler left, every row has the button again.
    off();
    step(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC', 'Settings for ABC']);
    expect(c.hasSeriesSettings(main)).toBe(true);
  });

  it('treats a provider that throws as covering nothing, and reports it', () => {
    const c = chart();
    const line = c.addLine({ title: 'Avg' });
    const errors: unknown[] = [];
    c.on('chart:error', ({ error }) => errors.push(error));
    c.on('series:settings', () => {});
    c.provideSeriesSettings(() => {
      throw new Error('broken');
    });
    c.provideSeriesSettings((series) => series === line);
    frame(c);
    expect(labels(rows(c)[0]!)).toEqual(['Hide ABC']);
    expect(labels(rows(c)[1]!)).toContain('Settings for Avg');
    expect(c.hasSeriesSettings(c.main!)).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as Error).message).toMatch(/series:settings/);
  });

  it('hides a series and keeps its row listed, dimmed', () => {
    const c = chart();
    const line = c.addLine({ title: 'Avg' });
    line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    const events: boolean[] = [];
    c.on('series:visibility', ({ visible }) => events.push(visible));
    frame(c);
    press(rows(c)[1]!, /^Hide/);
    frame(c);
    expect(line.visible).toBe(false);
    expect(events).toEqual([false]);
    const row = rows(c)[1]!;
    expect(row.style.opacity).toBe('0.5');
    expect(labels(row)[0]).toBe('Show Avg');
    press(row, /^Show/);
    frame(c);
    expect(line.visible).toBe(true);
    expect(rows(c)[1]!.style.opacity).toBe('');
  });

  it('removes a series and reports it', () => {
    const c = chart();
    const line = c.addLine({ title: 'Avg' });
    const removed: unknown[] = [];
    c.on('series:remove', (e) => removed.push(e));
    frame(c);
    press(rows(c)[1]!, /^Remove/);
    expect(c.panes[0]!.series).not.toContain(line);
    expect(removed).toEqual([{ series: line, indicator: null }]);
    frame(c);
    expect(rows(c)).toHaveLength(1);
  });

  it('removes an indicator with its pane', () => {
    const c = chart();
    const ind = c.indicators.add(paneDef);
    const series = ind.series;
    const removed: unknown[] = [];
    c.on('series:remove', (e) => removed.push(e));
    frame(c);
    expect(c.panes).toHaveLength(2);
    press(rows(c, 1)[0]!, /^Remove/);
    expect(c.indicators.getAll()).toHaveLength(0);
    expect(c.panes).toHaveLength(1);
    expect(removed).toEqual([{ series, indicator: ind }]);
  });

  it("removes a plain series' pane once empty, keeping one with other series or drawings", () => {
    const c = chart();
    const lone = c.addLine({ title: 'Lone' }, c.addPane());
    const shared = c.addPane();
    const a = c.addLine({ title: 'A' }, shared);
    c.addLine({ title: 'B' }, shared);
    const drawn = c.addPane();
    c.addLine({ title: 'Drawn' }, drawn);
    c.drawings.add({ type: 'hline', pane: 3, points: [{ time: 60, price: 1 }], style: {} });
    frame(c);
    press(rows(c, 1)[0]!, /^Remove/);
    expect(c.panes).toEqual([c.panes[0], shared, drawn]);
    expect(lone.pane).not.toBe(c.panes[1]);
    frame(c);
    press(rows(c, 1)[0]!, /^Remove/);
    expect(c.panes).toHaveLength(3);
    expect(a.pane.series).toHaveLength(1);
    frame(c);
    press(rows(c, 2)[0]!, /^Remove/);
    expect(c.panes).toHaveLength(3);
    expect(drawn.series).toHaveLength(0);
  });

  it('keeps the pane when removeSeries is called directly', () => {
    const c = chart();
    const pane = c.addPane();
    c.removeSeries(c.addLine({}, pane));
    expect(c.panes).toEqual([c.panes[0], pane]);
  });

  it('gives histogram, heatmap and indicator series rows with buttons', () => {
    const c = chart();
    c.addHistogram();
    c.addHeatmap();
    c.indicators.add({ ...paneDef, id: 'test/close-overlay', placement: 'overlay' });
    frame(c);
    const all = rows(c).map(labels);
    expect(all).toHaveLength(4);
    expect(all.slice(1).every((l) => l.length === 2)).toBe(true);
    expect(all.some((l) => l[0] === 'Hide Heatmap')).toBe(true);
  });

  it('keeps row elements while values change, so hover and focus survive', () => {
    const c = chart();
    frame(c);
    const row = rows(c)[0]!;
    row.dispatch('mouseenter');
    const actions = row.children[1]!;
    expect(actions.style.opacity).toBe('1');
    c.setCrosshairAt(bars[3]!.time);
    frame(c);
    expect(rows(c)[0]).toBe(row);
    expect(actions.style.opacity).toBe('1');
    row.dispatch('mouseleave');
    expect(actions.style.opacity).toBe('0');
    row.dispatch('focusin');
    expect(actions.style.opacity).toBe('1');
  });

  it('keeps the pressed button in place, so keyboard focus stays on it', () => {
    const c = chart();
    c.addLine({ title: 'Avg' });
    frame(c);
    const row = rows(c)[1]!;
    const actions = row.children[1]!;
    const before = actions.children;
    const hide = buttons(row)[0]!;
    hide.dispatch('click');
    frame(c);
    c.on('series:settings', () => {});
    step(c);
    // Detaching a focused element blurs it, so the buttons are never taken out and put back.
    expect(actions.children).toBe(before);
    expect(buttons(row)[0]).toBe(hide);
    expect(labels(row)).toEqual(['Show Avg', 'Settings for Avg', 'Remove Avg']);
    expect(hide.title).toBe('Show Avg');
  });

  it('names each row button group', () => {
    const c = chart();
    frame(c);
    const actions = rows(c)[0]!.children[1]!;
    expect(actions.getAttribute('role')).toBe('group');
    expect(actions.getAttribute('aria-label')).toBe('ABC');
  });

  it('keeps double clicks on buttons from reaching the chart', () => {
    const c = chart();
    frame(c);
    let stopped = false;
    buttons(rows(c)[0]!)[0]!.dispatch('dblclick', { stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(true);
  });

  it('hides and removes histogram and indicator rows', () => {
    const c = chart();
    const histogram = c.addHistogram({ title: 'Vol' });
    const indicator = c.indicators.add({ ...paneDef, id: 'test/close-overlay', name: 'Mid', placement: 'overlay' });
    const series = indicator.series!;
    const removed: unknown[] = [];
    c.on('series:remove', (e) => removed.push(e));
    frame(c);
    const row = (title: RegExp) => rows(c).find((r) => labels(r).some((l) => title.test(l ?? '')))!;
    press(row(/^Hide Vol/), /^Hide/);
    press(row(/^Hide Mid/), /^Hide/);
    frame(c);
    expect(histogram.visible).toBe(false);
    expect(indicator.visible).toBe(false);
    press(row(/^Show Vol/), /^Remove/);
    press(row(/^Show Mid/), /^Remove/);
    expect(c.panes[0]!.series).not.toContain(histogram);
    expect(c.panes[0]!.series).not.toContain(series);
    expect(c.indicators.getAll()).toEqual([]);
    expect(removed).toEqual([
      { series: histogram, indicator: null },
      { series, indicator },
    ]);
    frame(c);
    expect(rows(c)).toHaveLength(1);
  });

  it('lets presses on rows reach the chart and pan, and keeps them off the buttons', () => {
    const c = chart();
    // Enough bars that the view starts after the first one, so a pan shows in the visible range.
    c.main!.setData(Array.from({ length: 500 }, (_, i) => ({ ...bars[0]!, time: i * 60 })));
    frame(c);
    const row = rows(c)[0]!;
    expect(row.style.pointerEvents).toBe('auto');
    const before = c.getVisibleRange()!;
    const at = (x: number, timeStamp: number) => ({ clientX: x, clientY: 200, pointerId: 1, button: 0, pointerType: 'mouse', timeStamp });
    bubble(row.children[0]!, 'pointerdown', at(300, 0));
    root(c).dispatch('pointermove', at(200, 10));
    root(c).dispatch('pointerup', at(200, 15));
    expect(c.getVisibleRange()!.from).toBeGreaterThan(before.from);

    let reached = false;
    root(c).addEventListener('pointerdown', () => (reached = true));
    bubble(buttons(row)[0]!, 'pointerdown', at(300, 20));
    expect(reached).toBe(false);
  });

  it('stays click-through without buttons and drops hidden series', () => {
    const c = chart({ features: { legendButtons: false } });
    const line = c.addLine({ title: 'Avg' });
    line.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    line.setVisible(false);
    frame(c);
    expect(rows(c)).toHaveLength(1);
    expect(rows(c)[0]!.style.pointerEvents).toBe('none');
    expect(buttons(rows(c)[0]!)).toHaveLength(0);
  });
});

/** A data source serving the same bars for every symbol. */
const source: DataSource = {
  symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
  search: async () => [],
  history: async () => ({ bars, atStart: true }),
};

async function comparing() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.setDataSource(source);
  await c.setSymbol('A', '1m');
  return c;
}

describe('legend remove on a compared symbol', () => {
  it('removes it with its pane, so it can be compared again', async () => {
    const c = await comparing();
    const p = c.compare('P', { mode: 'pane' });
    await p.ready;
    frame(c);
    expect(c.panes).toHaveLength(2);
    press(rows(c, 1)[0]!, /^Remove/);
    expect(c.compared).toEqual([]);
    expect(c.panes).toHaveLength(1);
    expect(() => c.compare('P', { mode: 'pane' })).not.toThrow();
  });

  it('gives the main scale its mode back', async () => {
    const c = await comparing();
    const b = c.compare('B');
    await b.ready;
    expect(c.getPriceScaleMode()).toBe('percent');
    frame(c);
    const row = rows(c).find((r) => labels(r).includes('Remove B'))!;
    press(row, /^Remove/);
    expect(c.compared).toEqual([]);
    expect(c.getPriceScaleMode()).toBe('normal');
    expect(c.panes[0]!.scales.map((s) => s.id)).toEqual(['right']);
  });
});

describe('legend collapse', () => {
  it('offers a toggle from three rows and collapses to the first row', () => {
    const c = chart();
    c.addLine({ title: 'A' });
    frame(c);
    expect(toggle(c)).toBeUndefined();
    c.addLine({ title: 'B' });
    frame(c);
    const t = toggle(c)!;
    expect(t.getAttribute('aria-expanded')).toBe('true');
    t.dispatch('click');
    frame(c);
    expect(rows(c)).toHaveLength(1);
    expect(toggle(c)!.getAttribute('aria-label')).toBe('Show 2 more');
    expect(toggle(c)!.getAttribute('aria-expanded')).toBe('false');
    toggle(c)!.dispatch('click');
    frame(c);
    expect(rows(c)).toHaveLength(3);
  });

  it('relabels the toggle when the language changes', () => {
    const c = chart();
    c.addLine({ title: 'A' });
    c.addLine({ title: 'B' });
    frame(c);
    toggle(c)!.dispatch('click');
    frame(c);
    c.applyOptions({ localization: { messages: { legendShowMore: '{count} weitere' } } });
    frame(c);
    expect(toggle(c)!.getAttribute('aria-label')).toBe('2 weitere');
  });
});

describe('legend default titles', () => {
  it('name an untitled series by its kind in the chart language', () => {
    const c = chart();
    c.addLine().setData(bars.map((b) => ({ time: b.time, value: b.close })));
    frame(c);
    expect(labels(rows(c)[1]!)).toEqual(['Hide Line', 'Remove Line']);
    c.applyOptions({ localization: { messages: { legendTitleLine: 'Linie', legendHide: '{title} ausblenden' } } });
    frame(c);
    expect(labels(rows(c)[1]!)).toEqual(['Linie ausblenden', 'Remove Linie']);
  });
});

describe('legend rows under the pointer', () => {
  /** The row's value spans: rebuilt, as new elements, only when its text changes. */
  const valueSpans = (c: Chart) => rows(c)[0]!.children[0]!.children;

  it('keep their values while hovered, so the buttons stay put, and follow the crosshair again after', () => {
    const c = chart();
    c.setCrosshairAt(60);
    frame(c);
    const before = valueSpans(c);
    rows(c)[0]!.dispatch('mouseenter');
    // The pointer moving over the row moves the crosshair; the row keeps its values.
    c.setCrosshairAt(300);
    frame(c);
    expect(valueSpans(c)).toBe(before);
    rows(c)[0]!.dispatch('mouseleave');
    frame(c);
    expect(valueSpans(c)).not.toBe(before);
  });

  it('let go when the hovered row goes away', () => {
    const c = chart();
    const line = c.addLine({ title: 'Extra' });
    line.setData([{ time: 60, value: 1 }]);
    c.setCrosshairAt(60);
    frame(c);
    const extra = rows(c)[1]!;
    extra.dispatch('mouseenter');
    c.removeSeries(line);
    c.setCrosshairAt(300);
    frame(c);
    const before = valueSpans(c);
    c.setCrosshairAt(120);
    frame(c);
    expect(valueSpans(c)).not.toBe(before);
  });
});
