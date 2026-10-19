import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, volumeOf, type DataSource, type IndicatorDef, type LineSeries, type SymbolInfo } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { chooseOption } from './listbox';
import type { FormDialog } from '../src/form-dialog';
import { legendMenuItems } from '../src/legend-menu';
import { createIndicatorSettings } from '../src/indicator-settings';
import { createSeriesSettings, hasSeriesStyleSettings, openSeriesStyleSettings, seriesSettingsForm } from '../src/series-settings';
import { createChartShell, type ChartShell } from '../src/shell';

type El = HTMLElement & { children: El[]; tagName: string; value: string; checked: boolean; selectedIndex: number; textContent: string };

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const panelOf = (dialog: FormDialog) => dialog.el.children[0] as unknown as El;
const control = (dialog: FormDialog, id: string) =>
  find(find(panelOf(dialog), (el) => el.getAttribute('data-field') === id)!, (el) => ['input', 'select', 'button'].includes(el.tagName))!;
const action = (dialog: FormDialog, id: string) => dispatch(find(panelOf(dialog), (el) => el.getAttribute('data-action') === id)!, 'click');
const choose = (select: El, label: string) => chooseOption(select, label);
const inputIds = (form: ReturnType<typeof seriesSettingsForm>) => form.schema.sections.flatMap((s) => s.groups.flatMap((g) => g.inputs.map((i) => i.id)));

const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 + i, volume: 100 }));
const values = bars.map((b) => ({ time: b.time, value: b.close }));

/** A data source serving the same bars for every symbol. */
const source: DataSource = {
  symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
  search: async () => [],
  history: async () => ({ bars, atStart: true }),
};

const osc: IndicatorDef = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function setup() {
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  chart.addCandles().setData(bars);
  const host = fakeContainer() as unknown as El;
  return { chart, host };
}

async function comparing() {
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  chart.setDataSource(source);
  await chart.setSymbol('A', '1m');
  const host = fakeContainer() as unknown as El;
  return { chart, host };
}

describe('series style settings', () => {
  it('offers the colours, line and visibility each series type has', () => {
    const { chart } = setup();
    const line = chart.addLine({ title: 'Avg', color: '#123456' });
    line.setData(values);
    expect(inputIds(seriesSettingsForm(line, chart))).toEqual(['color', 'lineWidth', 'lineStyle', 'visible']);
    expect(seriesSettingsForm(line, chart).values).toEqual({ color: '#123456', lineWidth: 1.5, lineStyle: 'solid', visible: true });
    const delta = chart.addLine({ title: 'Delta', baseline: 0 });
    expect(inputIds(seriesSettingsForm(delta, chart))).toEqual(['aboveColor', 'belowColor', 'lineWidth', 'lineStyle', 'visible']);
    const signed = chart.addHistogram({ title: 'Flow', positiveColor: '#00ff00', negativeColor: '#ff0000' });
    expect(inputIds(seriesSettingsForm(signed, chart))).toEqual(['positiveColor', 'negativeColor', 'visible']);
    const plain = chart.addHistogram({ title: 'Plain' });
    expect(inputIds(seriesSettingsForm(plain, chart))).toEqual(['color', 'visible']);
    const candles = chart.addCandles({ title: 'Other' });
    expect(inputIds(seriesSettingsForm(candles, chart))).toEqual(['upColor', 'downColor', 'visible']);
    expect(seriesSettingsForm(candles, chart).schema.title).toBe('Other');
  });

  it('has nothing for the main series, indicators, or columns coloured point by point', () => {
    const { chart } = setup();
    const main = chart.main!;
    const ind = chart.indicators.add(osc);
    const volume = chart.addHistogram({ title: 'Vol', follow: volumeOf });
    const line = chart.addLine({ title: 'Avg' });
    expect(hasSeriesStyleSettings(chart, main)).toBe(false);
    expect(hasSeriesStyleSettings(chart, ind.series!)).toBe(false);
    expect(hasSeriesStyleSettings(chart, volume)).toBe(false);
    expect(hasSeriesStyleSettings(chart, line)).toBe(true);
  });

  it('applies edits live, and Cancel puts the series back', () => {
    const { chart, host } = setup();
    const line = chart.addLine({ title: 'Avg' });
    line.setData(values);
    const dialog = openSeriesStyleSettings(chart, host, line)!;
    expect(host.children).toContain(dialog.el);
    choose(control(dialog, 'lineWidth'), '4px');
    choose(control(dialog, 'lineStyle'), 'Dashed');
    expect(line.options.lineWidth).toBe(4);
    expect(line.options.lineStyle).toBe('dashed');
    const visible = control(dialog, 'visible');
    visible.checked = false;
    dispatch(visible, 'change');
    expect(line.visible).toBe(false);
    action(dialog, 'cancel');
    expect(dialog.isOpen).toBe(false);
    expect(line.options.lineWidth).toBe(1.5);
    expect(line.options.lineStyle).toBe('solid');
    expect(line.options.color).toBeUndefined();
    expect(line.visible).toBe(true);
  });

  it('closes when the series is removed', () => {
    const { chart, host } = setup();
    const line = chart.addLine({ title: 'Avg' });
    const dialog = openSeriesStyleSettings(chart, host, line)!;
    chart.removeSeries(line);
    expect(dialog.isOpen).toBe(false);
  });
});

describe('compared symbol settings', () => {
  it('opens from the legend, applies the colour and line live, and Cancel restores them', async () => {
    const { chart, host } = await comparing();
    const settings = createSeriesSettings(chart, host);
    const b = chart.compare('B', { color: '#f59e0b' });
    await b.ready;
    expect(chart.hasSeriesSettings(b.series)).toBe(true);
    expect(chart.openSeriesSettings(b.series)).toBe(true);
    const dialog = settings.dialog!;
    expect(dialog.isOpen).toBe(true);
    expect(dialog.values).toMatchObject({ placement: 'percent', color: '#f59e0b', lineWidth: 1.5, lineStyle: 'solid', visible: true });
    choose(control(dialog, 'lineWidth'), '3px');
    expect((b.series as LineSeries).options.lineWidth).toBe(3);
    dialog.setValues({ color: '#22d3ee' });
    choose(control(dialog, 'lineStyle'), 'Dotted');
    expect((b.series as LineSeries).options.color).toBe('#22d3ee');
    expect(b.serialize().color).toBe('#22d3ee');
    action(dialog, 'cancel');
    expect((b.series as LineSeries).options).toMatchObject({ color: '#f59e0b', lineWidth: 1.5, lineStyle: 'solid' });
    settings.destroy();
    expect(chart.hasSeriesSettings(b.series)).toBe(false);
  });

  it('withdraws its provider when destroyed, and so does the indicator panel', async () => {
    const { chart, host } = await comparing();
    const ind = chart.indicators.add(osc);
    const b = chart.compare('B');
    const indicators = createIndicatorSettings(chart, host);
    expect([chart.hasSeriesSettings(ind.series!), chart.hasSeriesSettings(b.series)]).toEqual([true, false]);
    const series = createSeriesSettings(chart, host);
    expect(chart.hasSeriesSettings(b.series)).toBe(true);
    series.destroy();
    expect([chart.hasSeriesSettings(ind.series!), chart.hasSeriesSettings(b.series)]).toEqual([true, false]);
    indicators.destroy();
    // No provider and no listener left: no row has settings.
    expect(chart.listens('series:settings')).toBe(false);
    expect(chart.hasSeriesSettings(ind.series!)).toBe(false);
    chart.on('series:settings', () => {});
    // A listener alone covers every row again, so nothing was left declared.
    expect(chart.hasSeriesSettings(b.series)).toBe(true);
  });

  it('moves it to its own pane keeping its bars and handle, and Cancel puts it back in its place', async () => {
    const { chart, host } = await comparing();
    const b = chart.compare('B', { color: '#e879f9', title: 'Bee' });
    const other = chart.addLine({ title: 'After' });
    await b.ready;
    const series = b.series as LineSeries;
    const points = series.data.length;
    expect(points).toBeGreaterThan(0);
    const rowsBefore = chart.panes[0]!.series.slice();
    const events: string[] = [];
    chart.on('series:remove', () => events.push('remove'));
    chart.on('series:add', () => events.push('add'));
    const dialog = openSeriesStyleSettings(chart, host, series)!;
    choose(control(dialog, 'placement'), 'Own pane');
    // The same handle and series, with its bars, in a pane of its own.
    expect(chart.compared).toEqual([b]);
    expect(b.mode).toBe('pane');
    expect(b.series).toBe(series);
    expect(series.data.length).toBe(points);
    expect(chart.panes).toHaveLength(2);
    expect(series.pane).toBe(chart.panes[1]);
    expect(b.serialize()).toMatchObject({ mode: 'pane', color: '#e879f9' });
    expect(dialog.isOpen).toBe(true);
    choose(control(dialog, 'lineWidth'), '4px');
    expect(series.options.lineWidth).toBe(4);
    action(dialog, 'cancel');
    expect(b.mode).toBe('percent');
    expect(chart.panes).toHaveLength(1);
    expect(chart.panes[0]!.series).toEqual(rowsBefore);
    expect(chart.panes[0]!.price.mode).toBe('percent');
    expect(series.options.lineWidth).toBe(1.5);
    expect(series.data.length).toBe(points);
    expect(events).toEqual([]);
    // The handle stays live.
    b.remove();
    expect(chart.compared).toEqual([]);
    expect(chart.panes[0]!.series).toEqual([chart.main, other]);
  });

  it('puts an own-pane comparison back in its pane slot on Cancel', async () => {
    const { chart, host } = await comparing();
    const b = chart.compare('B', { mode: 'pane' });
    const below = chart.addLine({ title: 'Below' }, chart.addPane());
    await b.ready;
    const ownPane = b.series.pane;
    ownPane.stretch = 0.4;
    const dialog = openSeriesStyleSettings(chart, host, b.series)!;
    choose(control(dialog, 'placement'), 'Own scale');
    expect(b.series.pane).toBe(chart.panes[0]);
    expect(chart.panes).toHaveLength(2);
    action(dialog, 'cancel');
    expect(b.mode).toBe('pane');
    expect(chart.panes.map((p) => p.series[0])).toEqual([chart.main, b.series, below]);
    expect(b.series.pane.stretch).toBe(0.4);
  });

  it('survives the chart being destroyed while open after a placement change', async () => {
    const { chart, host } = await comparing();
    const b = chart.compare('B');
    await b.ready;
    const dialog = openSeriesStyleSettings(chart, host, b.series)!;
    choose(control(dialog, 'placement'), 'Own pane');
    chart.destroy();
    expect(dialog.isOpen).toBe(false);
    expect(() => dialog.close()).not.toThrow();
    expect(() => dialog.cancel()).not.toThrow();
  });

  it('offers only own scale or pane for candles', async () => {
    const { chart } = await comparing();
    const b = chart.compare('B', { mode: 'scale', style: 'candles' });
    const form = seriesSettingsForm(b.series, chart);
    expect(inputIds(form)).toEqual(['placement', 'visible']);
    const placement = form.schema.sections[0]!.groups[0]!.inputs[0]!;
    expect(placement.kind === 'select' && placement.options.map((o) => o.value)).toEqual(['scale', 'pane']);
  });
});

describe('shell legend settings', () => {
  const shells: ChartShell[] = [];
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => {
    shells.splice(0).forEach((s) => s.destroy());
    vi.unstubAllGlobals();
  });

  it('gives settings to every row that opens something, and none to the others', async () => {
    const shell = createChartShell(fakeContainer(), { toolbar: [] });
    shells.push(shell);
    const { chart } = shell;
    chart.setDataSource(source);
    await chart.setSymbol('A', '1m');
    const main = chart.main!;
    const ind = chart.indicators.add(osc);
    const volume = chart.addHistogram({ title: 'Vol', follow: volumeOf });
    const line = chart.addLine({ title: 'Avg' });
    const b = chart.compare('B');
    await b.ready;
    const has = (s: Parameters<Chart['hasSeriesSettings']>[0]) => chart.hasSeriesSettings(s);
    const menuHas = (s: Parameters<Chart['hasSeriesSettings']>[0]) => legendMenuItems(chart, s).some((i) => i.type === 'action' && i.id === 'series-settings');
    expect([main, ind.series!, line, b.series].map(has)).toEqual([true, true, true, true]);
    expect(has(volume)).toBe(false);
    expect([main, ind.series!, line, b.series, volume].map(menuHas)).toEqual([true, true, true, true, false]);
    expect(chart.openSeriesSettings(volume)).toBe(false);

    chart.openSeriesSettings(b.series);
    expect(shell.seriesSettings!.dialog?.isOpen).toBe(true);
    shell.seriesSettings!.dialog!.close();
    // Indicators and the main series keep their own panels.
    chart.openSeriesSettings(ind.series!);
    expect(shell.indicatorSettings!.dialog?.isOpen).toBe(true);
    expect(shell.seriesSettings!.dialog).toBeNull();
    shell.indicatorSettings!.dialog!.close();
    chart.openSeriesSettings(main);
    expect(shell.settings!.isOpen).toBe(true);
  });
});
