import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, lightTheme, type IndicatorDef } from '@chart-on/core';
import { builtinIndicators, macdIndicator, rsiIndicator } from '@chart-on/indicators';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { chooseOption, chosenLabel, listOptions } from './listbox';
import type { FormDialog } from '../src/form-dialog';
import type { FormInputDef } from '../src/form-model';
import { createIndicatorSettings, indicatorSettingsForm, openIndicatorSettings, type IndicatorSettingsContext } from '../src/indicator-settings';
import { createChartShell, type ChartShell } from '../src/shell';

type El = HTMLElement & { children: El[]; tagName: string; value: string; checked: boolean; selectedIndex: number; textContent: string };

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const row = (root: El, id: string) => find(root, (el) => el.getAttribute('data-field') === id)!;
const control = (root: El, id: string) => find(row(root, id), (el) => ['input', 'select', 'button'].includes(el.tagName))!;
const errorOf = (root: El, id: string) => find(row(root, id), (el) => el.className === 'pc-form-error')!;
const byLabel = (root: El, label: string) => find(root, (el) => el.getAttribute('aria-label') === label);
const panelOf = (dialog: FormDialog) => dialog.el.children[0] as unknown as El;
const action = (dialog: FormDialog, id: string) => dispatch(find(panelOf(dialog), (el) => el.getAttribute('data-action') === id)!, 'click');
const type = (input: El, text: string) => {
  input.value = text;
  dispatch(input, 'input');
};
const choose = (select: El, index: number) => chooseOption(select, index);
const tick = (box: El, checked: boolean) => {
  box.checked = checked;
  dispatch(box, 'change');
};

/** Two moving averages with a source, a mode, a conditional input, a check and colours, two of them a pair. */
const bands: IndicatorDef = {
  id: 'test/bands',
  name: 'Bands',
  placement: 'overlay',
  inputs: [
    { id: 'fast', label: 'Fast', type: 'number', default: 5, min: 1, max: 50 },
    { id: 'slow', label: 'Slow', type: 'number', default: 20, min: 1, validate: (v, all) => (Number(v) > Number(all.fast) ? null : 'Slow must be above fast') },
    { id: 'source', label: 'Source', type: 'source', default: 'close' },
    { id: 'mode', label: 'Mode', type: 'select', default: 'simple', options: [{ value: 'simple', label: 'Simple' }, { value: 'weighted' }] },
    { id: 'smooth', label: 'Smooth', type: 'boolean', default: false, group: 'Smoothing' },
    { id: 'smoothing', label: 'Smoothing', type: 'number', default: 3, group: 'Smoothing', visible: (all) => all.smooth === true },
    { id: 'line', label: 'Line', type: 'color', default: '#2f6bff' },
    { id: 'up', label: 'Up', type: 'color', default: '#00aa00', role: 'up', group: 'Histogram' },
    { id: 'down', label: 'Down', type: 'color', default: '#aa0000', role: 'down', group: 'Histogram' },
  ],
  plots: [{ id: 'v', type: 'line', colorInput: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};
const osc: IndicatorDef = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14 }],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

const ids = (form: ReturnType<typeof indicatorSettingsForm>) =>
  form.schema.sections.map((s) => [s.id, s.groups.map((g) => [g.label ?? '', g.inputs.map((i) => i.id)])]);

describe('indicator settings form', () => {
  it('generates Inputs, Style and Visibility tabs from the definition', () => {
    const form = indicatorSettingsForm(bands, { inputs: { fast: 8 }, visible: true });
    expect(form.schema.title).toBe('Bands');
    expect(ids(form)).toEqual([
      [
        'inputs',
        [
          ['', ['input.fast', 'input.slow', 'input.source', 'input.mode']],
          ['Smoothing', ['input.smooth', 'input.smoothing']],
        ],
      ],
      [
        'style',
        [
          ['Colors', ['input.line']],
          ['Histogram', ['input.up', 'input.down']],
          ['Plot', ['plot.v.visible', 'plot.v.lineWidth', 'plot.v.lineStyle']],
          ['Display', ['visible']],
        ],
      ],
      ['visibility', [['Show on', ['show.seconds', 'show.minutes', 'show.hours', 'show.days', 'show.weeks', 'show.months']]]],
    ]);
    expect(form.values).toMatchObject({ 'input.fast': 8, 'input.slow': 20, 'input.source': 'close', visible: true, 'show.minutes': true });
    const inputs = form.schema.sections.flatMap((s) => s.groups.flatMap((g) => g.inputs));
    const input = (id: string) => inputs.find((i) => i.id === id) as FormInputDef & { options?: { value: unknown; label: string }[] };
    expect(input('input.fast')).toMatchObject({ kind: 'number', min: 1, max: 50, default: 5, label: 'Fast' });
    expect(input('input.source').options!.map((o) => o.value)).toEqual(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4']);
    expect(input('input.mode').options).toEqual([
      { value: 'simple', label: 'Simple' },
      { value: 'weighted', label: 'weighted' },
    ]);
    expect(input('input.up')).toMatchObject({ kind: 'color', default: '#00aa00' });
  });

  it('leaves out the Inputs tab when every input is a colour, and maps interval ranges to groups', () => {
    const plain: IndicatorDef = { ...osc, inputs: [{ id: 'c', type: 'color', default: '#ffffff' }] };
    const form = indicatorSettingsForm(plain, { inputs: {}, visible: false, visibleOn: [{ from: '1m', to: '59m' }, { from: '1m', to: '15m' }] });
    expect(form.schema.sections.map((s) => s.title)).toEqual(['Style', 'Visibility']);
    expect(form.values).toMatchObject({ visible: false, 'show.minutes': true, 'show.hours': false, 'show.seconds': false });
  });
});

/** A titled line with a declared width and style, an untitled line and a histogram. */
const styled: IndicatorDef = {
  id: 'test/styled',
  name: 'Styled',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14 }],
  plots: [
    { id: 'main', title: 'Main', type: 'line', lineWidth: 2.5, lineStyle: 'dotted' },
    { id: 'signal', type: 'line' },
    { id: 'hist', type: 'histogram' },
  ],
  compute: (src) => ({ main: Float64Array.from(src.close), signal: Float64Array.from(src.close), hist: src.close.map(() => 1) }),
};

describe('indicator settings plot styles', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function setup(options: ConstructorParameters<typeof Chart>[1] = {}) {
    const chart = new Chart(fakeContainer(), options);
    charts.push(chart);
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const host = fakeContainer() as unknown as El;
    return { chart, host };
  }

  it('adds a group per plot to the Style tab, with the declared styles as defaults', () => {
    const form = indicatorSettingsForm(styled, { inputs: {}, visible: true, plotStyles: { main: { lineWidth: 5 }, hist: { visible: false } } });
    const style = form.schema.sections.find((s) => s.id === 'style')!;
    expect(style.groups.map((g) => [g.label, g.inputs.map((i) => i.id)])).toEqual([
      ['Main', ['plot.main.visible', 'plot.main.lineWidth', 'plot.main.lineStyle']],
      ['signal', ['plot.signal.visible', 'plot.signal.lineWidth', 'plot.signal.lineStyle']],
      ['hist', ['plot.hist.visible']],
      ['Display', ['visible']],
    ]);
    expect(form.values).toMatchObject({
      'plot.main.visible': true,
      'plot.main.lineWidth': 5,
      'plot.main.lineStyle': 'dotted',
      'plot.signal.lineWidth': 1.5,
      'plot.signal.lineStyle': 'solid',
      'plot.hist.visible': false,
    });
    const width = style.groups[0]!.inputs[1] as FormInputDef & { options: { value: number; label: string }[]; default: number };
    // The usual widths plus the declared and the current one.
    expect(width.options.map((o) => o.value)).toEqual([1, 2, 2.5, 3, 4, 5]);
    expect(width.options[2]!.label).toBe('2.5px');
    expect(width.default).toBe(2.5);
    const disabled = width.disabled as (values: Record<string, unknown>) => boolean;
    expect(disabled({ 'plot.main.visible': false })).toBe(true);
    expect(disabled({ 'plot.main.visible': true })).toBe(false);
  });

  it.each(builtinIndicators.map((def) => [def.id, def] as const))('names every plot group of %s by its display name, not its id', (_, def) => {
    const style = indicatorSettingsForm(def, { inputs: {}, visible: true }).schema.sections.find((s) => s.id === 'style')!;
    const labels = style.groups.filter((g) => g.id.startsWith('plot-')).map((g) => g.label);
    expect(labels).toEqual(def.plots.map((p) => p.title ?? 'Plot'));
    for (const plot of def.plots) expect(labels, plot.id).not.toContain(plot.id);
  });

  it('labels the plot style controls in the chart language', () => {
    const { chart } = setup({ localization: { messages: { indicatorPlotLineWidth: 'Linienbreite', lineStyleDashed: 'Gestrichelt', indicatorPlot: 'Kurve' } } });
    const form = indicatorSettingsForm(osc, { inputs: {}, visible: true }, chart);
    const group = form.schema.sections.find((s) => s.id === 'style')!.groups[0]!;
    expect(group.label).toBe('Kurve');
    expect(group.inputs.map((i) => i.label)).toEqual(['Visible', 'Linienbreite', 'Line style']);
    expect((group.inputs[2] as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(['Solid', 'Gestrichelt', 'Dotted']);
  });

  it('applies plot styles live, puts them back on Cancel and clears them on Reset to defaults', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(styled);
    ind.setPlotStyle('signal', { lineStyle: 'dashed' });
    let dialog = openIndicatorSettings(chart, host, ind)!;
    let panel = panelOf(dialog);
    choose(control(panel, 'plot.main.lineWidth'), 4);
    choose(control(panel, 'plot.main.lineStyle'), 0);
    tick(control(panel, 'plot.hist.visible'), false);
    expect(ind.plotStyles).toEqual({ main: { lineWidth: 4, lineStyle: 'solid' }, signal: { lineStyle: 'dashed' }, hist: { visible: false } });
    action(dialog, 'cancel');
    expect(ind.plotStyles).toEqual({ signal: { lineStyle: 'dashed' } });

    dialog = openIndicatorSettings(chart, host, ind)!;
    panel = panelOf(dialog);
    tick(control(panel, 'plot.main.visible'), false);
    action(dialog, 'ok');
    expect(ind.plotStyles).toEqual({ main: { visible: false }, signal: { lineStyle: 'dashed' } });
    expect(ind.serialize().plotStyles).toEqual({ main: { visible: false }, signal: { lineStyle: 'dashed' } });

    dialog = openIndicatorSettings(chart, host, ind)!;
    action(dialog, 'reset');
    expect(ind.plotStyles).toEqual({});
    dialog.close();
    expect(ind.plotStyles).toEqual({ main: { visible: false }, signal: { lineStyle: 'dashed' } });
  });

  it('opens on a double-click on an indicator plot, not elsewhere', () => {
    const { chart, host } = setup();
    const settings = createIndicatorSettings(chart, host);
    const ind = chart.indicators.add(osc);
    chart.invalidate();
    (chart as unknown as { render(t: number): void }).render(0);
    const pane = ind.pane!;
    const x = chart.plotLeft + chart.time.indexToX(30);
    const at = (y: number) => ({ ...chart.pointAt(x, y)!, x, y });
    chart.emit('plot:dblclick', at(pane.top + ind.series!.scale.priceToY(10) + 15));
    expect(settings.dialog).toBeNull();
    chart.emit('plot:dblclick', at(pane.top + ind.series!.scale.priceToY(10)));
    expect(settings.dialog?.values).toMatchObject({ 'input.length': 14 });
    settings.destroy();
  });
});

describe('indicator settings panel', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function setup() {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const host = fakeContainer() as unknown as El;
    return { chart, host };
  }

  it('docks as a non-modal panel with Reset to defaults at the footer start, out of the narrow header (#954)', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    expect(host.children).toContain(dialog.el);
    expect(dialog.el.className).toContain('pc-dialog-backdrop--panel');
    const panel = panelOf(dialog);
    expect(panel.className).toContain('pc-dialog--panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    const header = find(panel, (el) => el.className === 'pc-dialog-header')!;
    expect(find(header, (el) => el.getAttribute('data-action') === 'reset')).toBeUndefined();
    const footerStart = find(panel, (el) => el.className.split(/\s+/).includes('pc-dialog-actions--start'))!;
    expect(find(footerStart, (el) => el.getAttribute('data-action') === 'reset')).toBeDefined();
    expect(byLabel(header, 'Close')).toBeDefined();
    // One indicator: no switcher, and the title shows.
    expect(byLabel(header, 'Indicator')).toBeUndefined();
    expect(header.children[0]!.className.split(/\s+/)).not.toContain('pc-sr-only');
    dialog.close();
  });

  it('lets the switcher take the title’s place, keeping the title as the dialog’s name (#954)', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    chart.indicators.add(osc);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    const panel = panelOf(dialog);
    const header = find(panel, (el) => el.className === 'pc-dialog-header')!;
    const title = header.children[0]!;
    expect(title.className.split(/\s+/)).toEqual(['pc-dialog-title', 'pc-sr-only']);
    expect(panel.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
    expect(byLabel(header, 'Indicator')).toBeDefined();
    dialog.close();
  });

  it('previews edits live, keeps them on Ok and round-trips through the serialized state', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    chart.history.clear();
    const dialog = openIndicatorSettings(chart, host, ind)!;
    const panel = panelOf(dialog);
    type(control(panel, 'input.fast'), '7');
    expect(ind.inputs.fast).toBe(7);
    choose(control(panel, 'input.source'), 4);
    expect(ind.inputs.source).toBe('volume');
    choose(control(panel, 'input.mode'), 1);
    tick(control(panel, 'visible'), false);
    expect(ind.visible).toBe(false);
    tick(control(panel, 'show.seconds'), false);
    expect(ind.visibleOn?.map((r) => r.from)).toEqual(['1m', '1h', '1d', '1w', '1M']);
    action(dialog, 'ok');
    expect(dialog.isOpen).toBe(false);
    expect(host.children).toEqual([]);
    // The panel's edits are one undo step; the visibility toggle is not undone.
    chart.history.undo();
    expect(chart.history.canUndo).toBe(false);
    expect(ind.inputs).toMatchObject({ fast: 5, source: 'close', mode: 'simple' });
    expect(ind.visibleOn).toBeNull();
    chart.history.redo();

    const saved = chart.indicators.serialize();
    expect(saved[0]!.inputs).toMatchObject({ fast: 7, source: 'volume', mode: 'weighted' });
    const other = setup().chart;
    other.indicators.register(bands);
    other.indicators.load(saved);
    const restored = other.indicators.getAll()[0]!;
    const again = indicatorSettingsForm(bands, restored.serialize());
    expect(again.values).toEqual(indicatorSettingsForm(bands, ind.serialize()).values);
    expect(again.values).toMatchObject({ 'input.fast': 7, visible: false, 'show.seconds': false, 'show.minutes': true });
  });

  it('puts everything back on Cancel, Escape and close()', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands, { fast: 9 });
    chart.history.clear();
    const before = ind.serialize();
    const edit = (dialog: FormDialog) => {
      const panel = panelOf(dialog);
      type(control(panel, 'input.fast'), '3');
      tick(control(panel, 'visible'), false);
      tick(control(panel, 'show.days'), false);
      expect(ind.serialize()).not.toEqual(before);
      return panel;
    };
    const first = openIndicatorSettings(chart, host, ind)!;
    edit(first);
    action(first, 'cancel');
    expect(ind.serialize()).toEqual(before);

    const second = openIndicatorSettings(chart, host, ind)!;
    const panel = edit(second);
    dispatch(control(panel, 'input.fast'), 'keydown', { key: 'Escape' });
    expect(second.isOpen).toBe(false);
    expect(ind.serialize()).toEqual(before);

    const third = openIndicatorSettings(chart, host, ind)!;
    edit(third);
    third.close();
    expect(third.isOpen).toBe(false);
    expect(ind.serialize()).toEqual(before);
    // Cancelled edits leave no undo step.
    expect(chart.history.canUndo).toBe(false);
  });

  it('applies nothing while a field is invalid, using the definition’s own checks', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    const panel = panelOf(dialog);
    type(control(panel, 'input.slow'), '4');
    expect(errorOf(panel, 'input.slow').textContent).toBe('Slow must be above fast');
    expect(ind.inputs.slow).toBe(20);
    type(control(panel, 'input.fast'), '60');
    expect(errorOf(panel, 'input.fast').textContent).not.toBe('');
    expect(dialog.submit()).toBe(false);
    type(control(panel, 'input.fast'), '2');
    expect(ind.inputs).toMatchObject({ fast: 2, slow: 4 });
    dialog.close();
  });

  it('shows conditional inputs, and keeps at least one interval group', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    const panel = panelOf(dialog);
    expect(row(panel, 'input.smoothing').hidden).toBe(true);
    tick(control(panel, 'input.smooth'), true);
    expect(row(panel, 'input.smoothing').hidden).toBe(false);

    for (const g of ['seconds', 'minutes', 'hours', 'days', 'weeks']) tick(control(panel, `show.${g}`), false);
    expect(ind.visibleOn).toEqual([{ from: '1M', to: '100y' }]);
    tick(control(panel, 'show.months'), false);
    expect(errorOf(panel, 'show.months').textContent).toBe('Show it on at least one kind of interval.');
    expect(ind.visibleOn).toEqual([{ from: '1M', to: '100y' }]);
    dialog.close();
  });

  it('keeps interval ranges the groups cannot show until the groups change', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    ind.setVisibleOn([{ from: '1m', to: '15m' }]);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    type(control(panelOf(dialog), 'input.fast'), '6');
    expect(ind.visibleOn).toEqual([{ from: '1m', to: '15m' }]);
    tick(control(panelOf(dialog), 'show.hours'), true);
    expect(ind.visibleOn).toEqual([{ from: '1h', to: '23h' }]);
    action(dialog, 'cancel');
    expect(ind.visibleOn).toEqual([{ from: '1m', to: '15m' }]);
  });

  it('resets to the definition defaults', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands, { fast: 11, mode: 'weighted' });
    ind.setVisible(false);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    action(dialog, 'reset');
    expect(ind.inputs).toMatchObject({ fast: 5, mode: 'simple' });
    expect(ind.visible).toBe(true);
    expect(control(panelOf(dialog), 'input.fast').value).toBe('5');
    dialog.close();
  });

  it('closes when the indicator is removed, and is null for a pending one', () => {
    const { chart, host } = setup();
    const ind = chart.indicators.add(bands);
    const dialog = openIndicatorSettings(chart, host, ind)!;
    ind.remove();
    expect(dialog.isOpen).toBe(false);
    expect(openIndicatorSettings(chart, host, ind)).toBeNull();

    chart.indicators.load([{ type: 'test/unknown', inputs: {}, pane: 0, visible: true }]);
    expect(openIndicatorSettings(chart, host, chart.indicators.getAll()[0]!)).toBeNull();
  });

  it('opens from series:settings and switches between indicators, keeping the edits', () => {
    const { chart, host } = setup();
    const settings = createIndicatorSettings(chart, host);
    const a = chart.indicators.add(bands);
    const b = chart.indicators.add(osc);
    chart.openSeriesSettings(a.series!);
    const first = settings.dialog!;
    expect(first.isOpen).toBe(true);
    const switcher = byLabel(panelOf(first), 'Indicator')!;
    dispatch(switcher, 'click');
    expect(listOptions(switcher).map((o) => o.getAttribute('title'))).toEqual(['Bands 5 20 close 3', 'Osc 14']);
    dispatch(switcher, 'click');
    type(control(panelOf(first), 'input.fast'), '4');
    expect(chosenLabel(switcher)).toBe('Bands 5 20 close 3');
    choose(switcher, 1);
    expect(first.isOpen).toBe(false);
    expect(a.inputs.fast).toBe(4);
    expect(settings.dialog?.isOpen).toBe(true);
    expect(settings.dialog!.values).toMatchObject({ 'input.length': 14 });

    // The main series has no indicator settings.
    chart.openSeriesSettings(chart.panes[0]!.series[0]!);
    expect(settings.dialog?.values).toMatchObject({ 'input.length': 14 });

    // Opening another one cancels the open one.
    const second = settings.dialog!;
    type(control(panelOf(second), 'input.length'), '30');
    settings.open(a);
    expect(second.isOpen).toBe(false);
    expect(b.inputs.length).toBe(14);

    settings.destroy();
    expect(settings.dialog).toBeNull();
    chart.openSeriesSettings(b.series!);
    expect(settings.dialog).toBeNull();
  });

  it('stays open on an invalid field instead of switching', () => {
    const { chart, host } = setup();
    const settings = createIndicatorSettings(chart, host);
    const a = chart.indicators.add(bands);
    chart.indicators.add(osc);
    const dialog = settings.open(a)!;
    type(control(panelOf(dialog), 'input.slow'), '1');
    const switcher = byLabel(panelOf(dialog), 'Indicator')!;
    choose(switcher, 1);
    expect(dialog.isOpen).toBe(true);
    expect(chosenLabel(switcher)).toBe('Bands 5 20 close 3');
    expect(settings.dialog).toBe(dialog);
    settings.destroy();
  });

  it('opens for every built-in indicator, and Cancel leaves its inputs as they were', () => {
    const { chart, host } = setup();
    const settings = createIndicatorSettings(chart, host);
    for (const def of builtinIndicators) {
      const ind = chart.indicators.add(def);
      const before = ind.serialize().inputs;
      chart.openSeriesSettings(ind.series!);
      const dialog = settings.dialog;
      expect(dialog?.isOpen, def.id).toBe(true);
      action(dialog!, 'cancel');
      expect(ind.serialize().inputs, def.id).toEqual(before);
      chart.indicators.remove(ind);
    }
    settings.destroy();
  });

  it('shows the drawn colour for an empty colour input and keeps it empty until one is picked', () => {
    const { chart, host } = setup();
    const chip = (dialog: FormDialog, label: string) =>
      find(byLabel(panelOf(dialog), label)!, (el) => el.className === 'pc-color-chip')!.style.background;
    const rsi = chart.indicators.add(rsiIndicator);
    let dialog = openIndicatorSettings(chart, host, rsi)!;
    expect(dialog.values['input.color']).toBe('');
    expect(chip(dialog, 'Color')).toBe(chart.theme.line);
    action(dialog, 'ok');
    expect(dialog.isOpen).toBe(false);
    expect(rsi.inputs.color).toBe('');

    // A two-colour histogram without colours of its own shows the theme's up and down colours.
    const macd = chart.indicators.add(macdIndicator);
    dialog = openIndicatorSettings(chart, host, macd)!;
    expect(chip(dialog, 'Positive')).toBe(chart.theme.up);
    expect(chip(dialog, 'Negative')).toBe(chart.theme.down);
    dialog.close();

    // An OHLC plot's up and down colour inputs show its own colours, else the theme's.
    const bars = chart.indicators.add({
      id: 'test/ohlc-colors',
      name: 'Bars',
      placement: 'pane',
      inputs: [
        { id: 'up', label: 'Up', type: 'color', default: '', role: 'up' },
        { id: 'down', label: 'Down', type: 'color', default: '', role: 'down' },
      ],
      plots: [{ id: 'c', type: 'ohlc', open: 'o', high: 'h', low: 'l', downColor: '#654321', upColorInput: 'up', downColorInput: 'down' }],
      compute: (src) => ({ o: src.open, h: src.high, l: src.low, c: src.close }),
    });
    dialog = openIndicatorSettings(chart, host, bars)!;
    expect(chip(dialog, 'Up')).toBe(chart.theme.up);
    expect(chip(dialog, 'Down')).toBe('#654321');
    dialog.close();

    // Still empty after a theme change, so the panel shows the new theme's colour.
    chart.applyOptions({ theme: lightTheme });
    dialog = openIndicatorSettings(chart, host, rsi)!;
    expect(chip(dialog, 'Color')).toBe(lightTheme.line);

    // Picking a colour sets it; Reset to defaults goes back to following the theme.
    dispatch(control(panelOf(dialog), 'input.color'), 'click');
    type(byLabel(panelOf(dialog), 'Custom color')!, '#123456');
    expect(rsi.inputs.color).toBe('#123456');
    expect(chip(dialog, 'Color')).toBe('#123456');
    action(dialog, 'reset');
    expect(rsi.inputs.color).toBe('');
    expect(chip(dialog, 'Color')).toBe(lightTheme.line);
    dialog.close();
  });
});

describe('shell indicator settings', () => {
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

  it('opens in the chart stage from the legend; the main series opens the chart settings; indicatorSettings: false leaves it out', () => {
    const shell = createChartShell(fakeContainer(), { toolbar: [] });
    shells.push(shell);
    const { chart } = shell;
    expect(shell.indicatorSettings).not.toBeNull();
    expect(chart.listens('series:settings')).toBe(true);
    const ind = chart.indicators.add(osc);
    chart.openSeriesSettings(ind.series!);
    const dialog = shell.indicatorSettings!.dialog!;
    expect(dialog.isOpen).toBe(true);
    const stage = find(shell.el as unknown as El, (el) => el.className === 'pc-stage')!;
    expect(stage.children).toContain(dialog.el);

    const main = chart.addCandles();
    expect((main as { isMain?: boolean }).isMain).toBe(true);
    chart.openSeriesSettings(main);
    expect(shell.settings!.isOpen).toBe(true);

    const off = createChartShell(fakeContainer(), { toolbar: [], indicatorSettings: false });
    shells.push(off);
    expect(off.indicatorSettings).toBeNull();
    expect(off.chart.listens('series:settings')).toBe(false);
  });

  it('takes a header control in the object form: made when a panel opens, destroyed when it closes', () => {
    const destroy = vi.fn();
    const headerControl = vi.fn((_context: IndicatorSettingsContext) => ({ el: fakeContainer(), destroy }));
    const shell = createChartShell(fakeContainer(), { toolbar: [], indicatorSettings: { headerControl } });
    shells.push(shell);
    const ind = shell.chart.indicators.add(osc);
    const dialog = shell.indicatorSettings!.open(ind)!;
    expect(headerControl).toHaveBeenCalledWith(expect.objectContaining({ indicator: ind, type: 'test/osc' }));
    expect(headerControl.mock.calls[0]![0].style()).toEqual({ 'input.length': 14, 'plot.v.visible': true, 'plot.v.lineWidth': 1.5, 'plot.v.lineStyle': 'solid' });
    dialog.cancel();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
