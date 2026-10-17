import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, colorSafeUpDown, contrastText, darkTheme, type Drawing, type DrawingToolDef, FIB_LEVELS, lightTheme, withAlpha } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { chooseOption } from './listbox';
import { changedStyle, createDrawingSettings, drawingSettingsForm, drawingVisibilityForm, openDrawingSettings } from '../src/drawing-settings';
import { createDrawingToolbar } from '../src/drawing-toolbar';
import { fontSizes, styleFieldControl } from '../src/drawing-style-controls';
import type { FormDialog } from '../src/form-dialog';
import { createChartShell, type ChartShell } from '../src/shell';

type El = HTMLElement & { children: El[]; tagName: string; value: string; checked: boolean; selectedIndex: number };

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const row = (root: El, id: string) => find(root, (el) => el.getAttribute('data-field') === id)!;
const control = (root: El, id: string) => find(row(root, id), (el) => ['input', 'select', 'button'].includes(el.tagName))!;
const byLabel = (root: El, label: string) => find(root, (el) => el.getAttribute('aria-label') === label);
const panelOf = (dialog: FormDialog) => dialog.el.children[0] as unknown as El;
const choose = (select: El, index: number) => chooseOption(select, index);
const check = (box: El, on: boolean) => {
  box.checked = on;
  dispatch(box, 'change');
};
/** Type `from` and `to` into the range row `id`. */
const span = (root: El, id: string, from: number, to: number) => {
  const [a, b] = all(row(root, id)).filter((el) => el.tagName === 'input');
  a!.value = String(from);
  dispatch(a!, 'input');
  b!.value = String(to);
  dispatch(b!, 'input');
};
const action = (dialog: FormDialog, id: string) =>
  dispatch(find(panelOf(dialog), (el) => el.getAttribute('data-action') === id)!, 'click');

/** A custom tool with one setting of each type. */
const gauge: DrawingToolDef = {
  type: 'gauge',
  label: 'Gauge',
  points: 2,
  defaultStyle: { color: '#112233', ...({ tone: 'warm', ticks: 5 } as object) },
  settings: [
    { key: 'needle', label: 'Needle', type: 'color' },
    { key: 'ticks', label: 'Ticks', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'tone', label: 'Tone', type: 'select', options: [{ value: 'warm', label: 'Warm' }, { value: 'cool', label: 'Cool' }] },
    { key: 'arc', label: 'Arc', type: 'boolean' },
    { key: 'caption', label: 'Caption', type: 'text' },
  ],
  render() {},
  hitTest: () => false,
};

const inputIds = (form: ReturnType<typeof drawingSettingsForm>) =>
  form!.schema.sections.map((s) => [s.id, s.groups.map((g) => [g.id, g.inputs.map((i) => i.id)])]);

describe('drawing settings form', () => {
  const tools = new Chart(fakeContainer()).drawings.getTools();
  const tool = (type: string) => tools.find((t) => t.type === type);

  it("holds the tool's style fields, grouped, with levels on their own tab", () => {
    const trend = drawingSettingsForm({ color: '#ff0000' }, tool('trendline'), ['color', 'lineWidth', 'lineStyle'], darkTheme)!;
    expect(inputIds(trend)).toEqual([['style', [['line', ['color', 'lineWidth', 'lineStyle']]]]]);
    expect(trend.values).toEqual({ color: '#ff0000', lineWidth: 1.5, lineStyle: 'solid' });
    expect(trend.schema.title).toBe('Trend line');

    const fibTool = tool('fib-retracement')!;
    const fib = drawingSettingsForm({}, fibTool, fibTool.styleFields!, darkTheme)!;
    expect(fib.schema.sections.map((s) => s.title)).toEqual(['Style', 'Levels']);
    expect((fib.values.levels as { value: number }[]).map((l) => l.value)).toEqual([...FIB_LEVELS]);
    expect(fib.schema.sections[0]!.groups.map((g) => g.label)).toEqual(['Line', 'Text']);
    expect(fib.schema.sections[0]!.groups[1]!.inputs.find((i) => i.id === 'labelSide')).toMatchObject({
      label: 'Label side',
      kind: 'select',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      default: 'left',
    });
    expect(fib.values.labelSide).toBe('left');
  });

  it('defaults the text color to the drawing color only for tools with required text', () => {
    const textColor = (type: string) => drawingSettingsForm({ color: '#ff0000' }, tool(type), ['textColor'], darkTheme)!.values.textColor;
    expect(textColor('text')).toBe('#ff0000');
    // Optional text sits on a sign or cloth of the drawing color, in black or white, whichever contrasts more.
    expect(textColor('signpost')).toBe('#000000');
    expect(textColor('flag')).toBe('#000000');
    expect(drawingSettingsForm({ color: '#1d3a6b' }, tool('flag'), ['textColor'], darkTheme)!.values.textColor).toBe('#ffffff');
  });

  it("shows the theme color a tool draws in when the style sets none", () => {
    const color = (type: string) => drawingSettingsForm({}, tool(type), ['color'], darkTheme)!.values.color;
    expect([color('arrow-up'), color('arrow-down'), color('arrow-left')]).toEqual([darkTheme.up, darkTheme.down, darkTheme.drawing]);
  });

  it("shows the measure's text color over the direction color it draws on", () => {
    // In the color-safe light palette, up takes white text and down black.
    const theme = { ...lightTheme, ...colorSafeUpDown.light };
    const textColor = (from: number, to: number) => {
      const drawing = { id: 'm', type: 'measure', pane: 0, points: [{ time: 0, price: from }, { time: 60, price: to }], style: {} } as Drawing;
      return drawingSettingsForm({}, tool('measure'), ['textColor'], theme, { drawing })!.values.textColor;
    };
    expect([textColor(100, 110), textColor(110, 100)]).toEqual([contrastText(theme.up!), contrastText(theme.down!)]);
    expect(contrastText(theme.up!)).not.toBe(contrastText(theme.down!));
  });

  it("offers the drawing's own line width and font size even when off the usual list", () => {
    const form = drawingSettingsForm({ lineWidth: 7, fontSize: 17 }, tool('text'), ['lineWidth', 'fontSize'], darkTheme)!;
    const options = (id: string) =>
      form.schema.sections[0]!.groups.flatMap((g) => g.inputs).find((i) => i.id === id) as { options: { value: number }[] };
    expect(options('lineWidth').options.map((o) => o.value)).toEqual([1, 1.5, 2, 3, 4, 7]);
    // The theme's 12 px times 2^(k/3), plus the text tool's default 14 and the drawing's own 17.
    expect(options('fontSize').options.map((o) => o.value)).toEqual([10, 12, 14, 15, 17, 19, 24, 30, 38, 48]);
  });

  it('generates the font sizes from the base size, every third step doubling it', () => {
    expect(fontSizes(12)).toEqual([10, 12, 15, 19, 24, 30, 38, 48]);
    const sizes = fontSizes(16);
    expect(sizes.slice(1)).toEqual([16, 20, 25, 32, 40, 51, 64]);
    // A tiny base stays at whole, distinct sizes of at least 1 px.
    expect(fontSizes(1)).toEqual([1, 2, 3, 4]);
    expect(fontSizes(0)).toEqual([1]);
    for (let k = 1; k + 3 < sizes.length; k++) expect(Math.abs(sizes[k + 3]! - 2 * sizes[k]!)).toBeLessThanOrEqual(1);
  });

  it("renders a custom tool's settings, resetting to its defaultStyle", () => {
    const form = drawingSettingsForm({ ...({ ticks: 9 } as object) }, gauge, ['color', 'needle'], darkTheme)!;
    expect(inputIds(form)).toEqual([
      ['style', [['line', ['color']], ['options', ['needle', 'ticks', 'tone', 'arc', 'caption']]]],
    ]);
    expect(form.values).toEqual({ color: '#112233', needle: darkTheme.drawing, ticks: 9, tone: 'warm', arc: false, caption: '' });
    const inputs = form.schema.sections[0]!.groups.flatMap((g) => g.inputs);
    expect(inputs.find((i) => i.id === 'ticks')).toMatchObject({ kind: 'number', min: 1, max: 20, default: 5 });
    expect(inputs.find((i) => i.id === 'tone')).toMatchObject({ kind: 'select', default: 'warm' });
  });

  it('is null when there is nothing to edit', () => {
    expect(drawingSettingsForm({}, { ...gauge, settings: [] }, [], darkTheme)).toBeNull();
  });

  it('patches only the fields that changed', () => {
    const levels = [{ value: 0.5 }];
    expect(changedStyle({ color: '#000000', levels, bold: true }, { color: '#000000', levels: [{ value: 0.5 }], bold: false })).toEqual({
      bold: true,
    });
  });

  it('offers extend left and right in the Line group of lines, channels and rectangles', () => {
    for (const type of ['trendline', 'arrow', 'info-line', 'rectangle', 'parallel-channel', 'regression-trend', 'fib-extension']) {
      const t = tool(type)!;
      const form = drawingSettingsForm({ extendRight: true }, t, t.styleFields!, darkTheme)!;
      const line = form.schema.sections[0]!.groups.find((g) => g.id === 'line')!;
      expect(line.inputs.filter((i) => i.id.startsWith('extend')).map((i) => [i.id, i.label, i.kind]), type).toEqual([
        ['extendLeft', 'Extend left', 'boolean'],
        ['extendRight', 'Extend right', 'boolean'],
      ]);
      expect([form.values.extendLeft, form.values.extendRight], type).toEqual([false, true]);
    }
  });
});

describe('drawing visibility form', () => {
  const EVERY = { 'show.s': true, 'show.m': true, 'show.h': true, 'show.d': true, 'show.w': true, 'show.M': true };

  it('opens with every unit on in full for a drawing shown on every interval', () => {
    const form = drawingVisibilityForm(undefined);
    expect(form.values).toMatchObject({ ...EVERY, 'span.s': [1, 59], 'span.h': [1, 23], 'span.d': [1, 6], 'span.w': [1, 4], 'span.M': [1, 12] });
    expect(form.section.title).toBe('Visibility');
    expect(form.rangesOf(form.values)).toBeUndefined();
    expect(drawingVisibilityForm([]).values).toEqual(form.values);
  });

  it('maps the rows to ranges: null when every unit is on in full, the top month reaching the longest intervals', () => {
    const form = drawingVisibilityForm(null);
    expect(form.rangesOf({ ...form.values, 'show.s': false })).toEqual([
      { from: '1m', to: '59m' },
      { from: '1h', to: '23h' },
      { from: '1d', to: '6d' },
      { from: '1w', to: '4w' },
      { from: '1M', to: '100y' },
    ]);
    const some = { ...form.values, 'show.s': false, 'show.h': false, 'show.d': false, 'show.w': false, 'span.m': [5, 30], 'span.M': [1, 3] };
    expect(form.rangesOf(some)).toEqual([
      { from: '5m', to: '30m' },
      { from: '1M', to: '3M' },
    ]);
    const edited = drawingVisibilityForm([{ from: '1h', to: '4h' }]);
    expect(edited.rangesOf({ ...edited.values, ...EVERY, 'span.h': [1, 23] })).toBeNull();
  });

  it('shows ranges set from code on the rows they cover', () => {
    const form = drawingVisibilityForm([{ from: '90s', to: '4h' }, { from: '1y', to: '2y' }]);
    expect(form.values).toMatchObject({
      'show.s': false,
      'show.m': true,
      'span.m': [2, 59],
      'show.h': true,
      'span.h': [1, 4],
      'show.d': false,
      'span.d': [1, 6],
      'show.w': false,
      'show.M': true,
      'span.M': [12, 12],
    });
  });

  it('wants one unit on and whole counts, but accepts an unedited tab', () => {
    const form = drawingVisibilityForm(null);
    const inputs = form.section.groups[0]!.inputs;
    const error = (id: string, values: Record<string, unknown>) => {
      const input = inputs.find((i) => i.id === id)! as { validate(v: unknown, all: unknown): string | null };
      return input.validate(values[id], values);
    };
    const none = { ...form.values, ...Object.fromEntries(Object.keys(EVERY).map((k) => [k, false])) };
    expect(error('show.m', none)).toBe('Show it on at least one kind of interval.');
    expect(error('span.m', { ...form.values, 'span.m': [1.5, 3] })).toBe('Enter whole numbers.');
    // Saved ranges that cover none of the rows: every unit off, still valid until edited.
    const odd = drawingVisibilityForm([{ from: '90s', to: '100s' }]);
    expect(odd.values).toMatchObject(Object.fromEntries(Object.keys(EVERY).map((k) => [k, false])));
    const oddShow = odd.section.groups[0]!.inputs[0]! as { validate(v: unknown, all: unknown): string | null };
    expect(oddShow.validate(false, odd.values)).toBeNull();
  });
});

describe('drawing settings dialog', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function setup() {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const host = fakeContainer() as unknown as El;
    const points = [{ time: 600, price: 10 }, { time: 1200, price: 10.5 }];
    const add = (type: string, extra: Partial<Drawing> = {}) => chart.drawings.add({ type, pane: 0, points, style: {}, ...extra });
    const changes = vi.fn();
    chart.on('drawings:change', changes);
    const style = (id: string) => chart.drawings.getById(id)!.style;
    return { chart, host, add, changes, style };
  }

  it('previews edits live and commits the changed fields as one undo step, remembered as defaults', () => {
    const { chart, host, add, changes, style } = setup();
    const line = add('trendline', { style: { color: '#ff0000' } });
    changes.mockClear();
    const dialog = openDrawingSettings(chart, host, line.id)!;
    expect(host.children).toContain(dialog.el);
    const panel = panelOf(dialog);
    choose(control(panel, 'lineWidth'), 4); // 4px
    choose(control(panel, 'lineStyle'), 1); // dashed
    expect(style(line.id)).toEqual({ color: '#ff0000', lineWidth: 4, lineStyle: 'dashed' });
    expect(changes).not.toHaveBeenCalled();

    // Changed back: drops out of the preview.
    choose(control(panel, 'lineStyle'), 0);
    expect(style(line.id)).toEqual({ color: '#ff0000', lineWidth: 4 });

    action(dialog, 'ok');
    expect(dialog.isOpen).toBe(false);
    expect(host.children).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(style(line.id)).toEqual({ color: '#ff0000', lineWidth: 4 });
    expect(chart.drawings.toolDefaults('trendline')).toMatchObject({ lineWidth: 4 });
    expect(chart.drawings.toolDefaults('trendline').lineStyle).toBeUndefined();

    chart.drawings.undo();
    expect(style(line.id)).toEqual({ color: '#ff0000' });
  });

  it('puts the drawing back on cancel without spending an undo step', () => {
    const { chart, host, add, changes, style } = setup();
    const line = add('trendline', { style: { color: '#ff0000' } });
    changes.mockClear();
    const dialog = openDrawingSettings(chart, host, line.id)!;
    choose(control(panelOf(dialog), 'lineWidth'), 2);
    expect(style(line.id).lineWidth).toBe(2);
    dialog.cancel();
    expect(style(line.id)).toEqual({ color: '#ff0000' });
    expect(changes).not.toHaveBeenCalled();
    expect(chart.drawings.toolDefaults('trendline').lineWidth).toBeUndefined();
    // The next undo still removes the drawing.
    chart.drawings.undo();
    expect(chart.drawings.getById(line.id)).toBeUndefined();
  });

  it('drops the preview when closed from code, and closes when the drawing goes', () => {
    const { chart, host, add, style } = setup();
    const line = add('trendline');
    const dialog = openDrawingSettings(chart, host, line.id)!;
    choose(control(panelOf(dialog), 'lineWidth'), 3);
    dialog.close();
    expect(style(line.id).lineWidth).toBeUndefined();

    const again = openDrawingSettings(chart, host, line.id)!;
    chart.drawings.remove(line.id);
    expect(again.isOpen).toBe(false);
    expect(openDrawingSettings(chart, host, line.id)).toBeNull();
  });

  it('resets to the tool defaults and edits levels', () => {
    const { chart, host, add, style } = setup();
    const fib = add('fib-retracement', { style: { color: '#00ff00', showLabel: false } });
    const dialog = openDrawingSettings(chart, host, fib.id)!;
    action(dialog, 'reset');
    expect(style(fib.id).showLabel).toBe(true);
    dialog.showSection('levels');
    const levels = byLabel(panelOf(dialog), 'Levels')!;
    // A level with the rule's color shows that color, not black: the theme's accent for 0.618.
    expect(byLabel(levels, 'Level 0.618 color')!.value).toBe(chart.theme.drawing);
    const visible = find(levels, (el) => el.className === 'pc-levels-visible')!;
    visible.checked = false;
    dispatch(visible, 'change');
    expect(style(fib.id).levels?.[0]?.visible).toBe(false);
    dialog.submit();
    expect(style(fib.id).showLabel).toBe(true);
    expect(style(fib.id).levels).toHaveLength(FIB_LEVELS.length);
    expect(style(fib.id).levels?.[0]?.visible).toBe(false);
  });

  it('moves fib retracement labels to the right as one undo step', () => {
    const { chart, host, add, style } = setup();
    const fib = add('fib-retracement');
    const dialog = openDrawingSettings(chart, host, fib.id)!;
    const side = control(panelOf(dialog), 'labelSide');
    choose(side, 1);
    expect(style(fib.id).labelSide).toBe('right');
    dialog.submit();
    expect(style(fib.id).labelSide).toBe('right');
    chart.drawings.undo();
    expect(style(fib.id).labelSide).toBeUndefined();
  });

  it('commits custom tool settings', () => {
    const { chart, host, add, style } = setup();
    chart.drawings.register(gauge);
    const d = add('gauge');
    const dialog = openDrawingSettings(chart, host, d.id)!;
    choose(control(panelOf(dialog), 'tone'), 1);
    const arc = control(panelOf(dialog), 'arc');
    arc.checked = true;
    dispatch(arc, 'change');
    dialog.submit();
    expect(style(d.id)).toMatchObject({ tone: 'cool', arc: true });
  });

  it('commits style and visibility edits as one undo step', () => {
    const { chart, host, add, changes, style } = setup();
    const line = add('trendline');
    changes.mockClear();
    const dialog = openDrawingSettings(chart, host, line.id)!;
    choose(control(panelOf(dialog), 'lineWidth'), 3);
    dialog.showSection('visibility');
    expect(dialog.section).toBe('visibility');
    const panel = panelOf(dialog);
    check(control(panel, 'show.s'), false);
    span(panel, 'span.m', 5, 30);
    // Bars are a minute apart, so a 1 minute chart: off the 5–30 minute range.
    expect(chart.drawings.hiddenByInterval(line.id)).toBe(false);
    expect(dialog.submit()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(style(line.id).lineWidth).toBe(3);
    expect(chart.drawings.getById(line.id)!.visibleOn).toEqual([
      { from: '5m', to: '30m' },
      { from: '1h', to: '23h' },
      { from: '1d', to: '6d' },
      { from: '1w', to: '4w' },
      { from: '1M', to: '100y' },
    ]);
    expect(chart.drawings.hiddenByInterval(line.id)).toBe(true);

    chart.drawings.undo();
    expect(style(line.id).lineWidth).toBeUndefined();
    expect(chart.drawings.getById(line.id)!.visibleOn).toBeUndefined();
  });

  it('leaves unedited ranges alone, refuses every unit off, and clears visibleOn on reset', () => {
    const { chart, host, add, changes } = setup();
    const ranges = [{ from: '90s' as const, to: '100s' as const }];
    const odd = add('trendline', { visibleOn: ranges });
    changes.mockClear();
    // Nothing edited: no update, and the ranges the rows cannot show stay.
    expect(openDrawingSettings(chart, host, odd.id)!.submit()).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(chart.drawings.getById(odd.id)!.visibleOn).toEqual(ranges);

    const line = add('trendline', { visibleOn: [{ from: '1h', to: '4h' }] });
    const dialog = openDrawingSettings(chart, host, line.id)!;
    dialog.showSection('visibility');
    check(control(panelOf(dialog), 'show.h'), false);
    expect(dialog.submit()).toBe(false);
    expect(dialog.errors['show.h']).toBe('Show it on at least one kind of interval.');
    action(dialog, 'reset');
    expect(dialog.submit()).toBe(true);
    expect(chart.drawings.getById(line.id)!.visibleOn).toBeUndefined();
  });

  it('opens with only the Visibility tab for a tool with nothing else to edit', () => {
    const { chart, host, add } = setup();
    chart.drawings.register({ ...gauge, type: 'bare', settings: [], styleFields: [] });
    const d = add('bare');
    const dialog = openDrawingSettings(chart, host, d.id)!;
    expect(dialog.section).toBe('visibility');
    check(control(panelOf(dialog), 'show.m'), false);
    dialog.submit();
    expect(chart.drawings.hiddenByInterval(d.id)).toBe(true);
  });

  it('opens on double click, except for text tools and while drawings are locked', () => {
    const { chart, host, add } = setup();
    const settings = createDrawingSettings(chart, host);
    const line = add('trendline');
    const text = add('text', { text: 'Hi' });
    chart.emit('drawing:dblclick', { id: text.id });
    expect(settings.dialog).toBeNull();
    chart.drawings.setLocked(true);
    chart.emit('drawing:dblclick', { id: line.id });
    expect(settings.dialog).toBeNull();
    chart.drawings.setLocked(false);
    chart.emit('drawing:dblclick', { id: line.id });
    expect(settings.dialog?.isOpen).toBe(true);
    // Opening another one cancels the first.
    const first = settings.dialog!;
    settings.open(text.id);
    expect(first.isOpen).toBe(false);
    settings.destroy();
    expect(settings.dialog).toBeNull();
    chart.emit('drawing:dblclick', { id: line.id });
    expect(settings.dialog).toBeNull();
  });
});

describe('drawing toolbar settings', () => {
  it('shows a Settings button in place of the More style popover', () => {
    const chart = new Chart(fakeContainer());
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const onSettings = vi.fn();
    const toolbar = createDrawingToolbar(chart, { onSettings });
    const el = toolbar.el as unknown as El;
    const fib = chart.drawings.add({ type: 'fib-retracement', pane: 0, points: [{ time: 600, price: 10 }, { time: 1200, price: 11 }], style: {} });
    chart.drawings.select(fib.id);
    expect((byLabel(el, 'More style') as unknown as { parent: HTMLElement }).parent.hidden).toBe(true);
    dispatch(byLabel(el, 'Settings')!, 'click');
    expect(onSettings).toHaveBeenCalledWith(fib.id);
    toolbar.destroy();
    chart.destroy();
  });

  it("shows a custom tool's color and select settings inline", () => {
    const chart = new Chart(fakeContainer());
    chart.drawings.register(gauge);
    const toolbar = createDrawingToolbar(chart);
    const d = chart.drawings.add({ type: 'gauge', pane: 0, points: [{ time: 0, price: 1 }, { time: 60, price: 2 }], style: {} });
    chart.drawings.select(d.id);
    const el = toolbar.el as unknown as El;
    expect(byLabel(el, 'Needle')).toBeDefined();
    expect(byLabel(el, 'Tone')).toBeDefined();
    // The same swatch picker as the fill: open it, pick a custom color, close it.
    const needle = byLabel(el, 'Needle')!;
    dispatch(needle, 'click');
    const custom = find(el, (n) => n.className === 'pc-color-input')!;
    custom.value = '#abcdef';
    dispatch(custom, 'input');
    dispatch(needle, 'click');
    expect((chart.drawings.getById(d.id)!.style as Record<string, unknown>).needle).toBe('#abcdef');
    toolbar.destroy();
    chart.destroy();
  });
});

describe('shell drawing settings', () => {
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

  it('is on by default and opens from the drawing toolbar; drawingSettings: false leaves it out', () => {
    const shell = createChartShell(fakeContainer(), { toolbar: [] });
    shells.push(shell);
    expect(shell.drawingSettings).not.toBeNull();
    const line = shell.chart.drawings.add({ type: 'trendline', pane: 0, points: [{ time: 0, price: 1 }, { time: 60, price: 2 }], style: {} });
    shell.chart.drawings.select(line.id);
    dispatch(byLabel(shell.drawingToolbar!.el as unknown as El, 'Settings')!, 'click');
    expect(shell.drawingSettings!.dialog?.isOpen).toBe(true);
    expect((shell.el as unknown as El).children).toContain(shell.drawingSettings!.dialog!.el);

    const off = createChartShell(fakeContainer(), { toolbar: [], drawingSettings: false });
    shells.push(off);
    expect(off.drawingSettings).toBeNull();
    expect(byLabel(off.drawingToolbar!.el as unknown as El, 'Settings')).toBeUndefined();

    // Options turn it on with them.
    const withOptions = createChartShell(fakeContainer(), { toolbar: [], drawingSettings: { headerControl: () => null } });
    shells.push(withOptions);
    expect(withOptions.drawingSettings).not.toBeNull();
  });
});

describe('fill settings', () => {
  const tools = new Chart(fakeContainer()).drawings.getTools();
  const tool = (type: string) => tools.find((t) => t.type === type)!;

  it('shows the fill the tool draws: its own tint of the line color', () => {
    for (const [type, alpha] of [['rectangle', 0.14], ['fib-retracement', 0.12], ['pitchfork', 0.1]] as const) {
      const form = drawingSettingsForm({ color: '#ff0000' }, tool(type), tool(type).styleFields!, darkTheme)!;
      expect(form.values.fill, type).toBe(withAlpha('#ff0000', alpha));
    }
  });

  it('offers the background switch next to the fill, on by default', () => {
    const t = tool('fib-retracement');
    const form = drawingSettingsForm({}, t, t.styleFields!, darkTheme)!;
    const line = form.schema.sections[0]!.groups.find((g) => g.id === 'line')!;
    expect(line.inputs.find((i) => i.id === 'showFill')).toMatchObject({ label: 'Background', kind: 'boolean', default: true });
    expect(drawingSettingsForm({ showFill: false }, t, t.styleFields!, darkTheme)!.values.showFill).toBe(false);
  });

  it('greys the fill out while the background is off', () => {
    const t = tool('rectangle');
    const fill = drawingSettingsForm({}, t, t.styleFields!, darkTheme)!.schema.sections[0]!.groups[0]!.inputs.find((i) => i.id === 'fill')!;
    const disabled = fill.disabled as (values: Record<string, unknown>) => boolean;
    expect(disabled({ showFill: false })).toBe(true);
    expect(disabled({ showFill: true })).toBe(false);
  });

  it("shows no fill on the toolbar's swatch while the background is off, and a pick turns it back on", () => {
    const edits: { preview: unknown[]; commit: unknown[] } = { preview: [], commit: [] };
    const control = styleFieldControl('fill', {
      tool: tool('rectangle'),
      theme: darkTheme,
      edit: { preview: (s) => edits.preview.push(s), commit: (s) => edits.commit.push(s) },
    })!;
    type Node = { className?: string; children: Node[]; getAttribute(k: string): string | null; dispatch(t: string): void };
    const find = (root: Node, cls: string): Node | null => {
      for (const c of root.children) {
        if (c.className === cls) return c;
        const f = find(c, cls);
        if (f) return f;
      }
      return null;
    };
    const el = control.el as unknown as Node;
    const drawing = (style: Drawing['style']): Drawing => ({ id: 'r', type: 'rectangle', pane: 0, points: [], style });
    control.sync(drawing({ color: '#ff0000', showFill: false }));
    expect(find(el, 'pc-color-trigger')!.getAttribute('data-tip')).toBe('Fill: rgba(0, 0, 0, 0)');
    find(el, 'pc-color-trigger')!.dispatch('click');
    find(el, 'pc-swatch')!.dispatch('click');
    expect(edits.preview.at(-1)).toEqual({ fill: '#ffffff', showFill: true });
    control.sync(drawing({ color: '#ff0000' }));
    expect(find(el, 'pc-color-trigger')!.getAttribute('data-tip')).toBe('Fill: rgba(255, 0, 0, 0.14)');
    control.destroy();
  });
});

describe('measure tool settings', () => {
  const tools = new Chart(fakeContainer()).drawings.getTools();
  const tool = (type: string) => tools.find((t) => t.type === type)!;

  it('offers the figures switch in the Text group of every measuring tool', () => {
    for (const type of ['price-range', 'date-range', 'date-price-range', 'forecast', 'long-position', 'measure']) {
      const form = drawingSettingsForm({}, tool(type), tool(type).styleFields!, darkTheme)!;
      const text = form.schema.sections[0]!.groups.find((g) => g.id === 'text')!;
      expect(text.inputs.find((i) => i.id === 'showStats'), type).toMatchObject({ label: 'Stats', kind: 'boolean', default: true });
      expect(form.values.showStats, type).toBe(true);
    }
  });

  it("offers a position's profit and loss colors in the Line group, defaulting to the theme's up and down", () => {
    const t = tool('short-position');
    const form = drawingSettingsForm({ lossColor: '#ff00ff' }, t, t.styleFields!, darkTheme)!;
    const line = form.schema.sections[0]!.groups.find((g) => g.id === 'line')!;
    expect(line.inputs.filter((i) => i.id.endsWith('Color')).map((i) => [i.id, i.label, i.kind, i.default])).toEqual([
      ['profitColor', 'Profit color', 'color', darkTheme.up],
      ['lossColor', 'Loss color', 'color', darkTheme.down],
    ]);
    expect([form.values.profitColor, form.values.lossColor]).toEqual([darkTheme.up, '#ff00ff']);
  });
});

describe('label settings of the level tools', () => {
  const tools = new Chart(fakeContainer()).drawings.getTools();
  const tool = (type: string) => tools.find((t) => t.type === type)!;

  it('offers the label side, starting where each tool draws its labels', () => {
    for (const [type, side] of [['fib-channel', 'left'], ['gann-box', 'right'], ['fib-speed-fan', 'right'], ['fib-time-zone', 'right']] as const) {
      const form = drawingSettingsForm({}, tool(type), tool(type).styleFields!, darkTheme)!;
      const text = form.schema.sections[0]!.groups.find((g) => g.id === 'text')!;
      expect(text.inputs.find((i) => i.id === 'labelSide'), type).toMatchObject({ label: 'Label side', kind: 'select', default: side });
      expect(form.values.labelSide, type).toBe(side);
    }
  });

  it('offers the label content, starting with what each tool drew before the option', () => {
    for (const [type, content] of [['fib-retracement', 'both'], ['fib-extension', 'both'], ['fib-channel', 'level'], ['gann-box', 'level'], ['fib-time', 'level'], ['pitchfork', 'level']] as const) {
      const form = drawingSettingsForm({}, tool(type), tool(type).styleFields!, darkTheme)!;
      const text = form.schema.sections[0]!.groups.find((g) => g.id === 'text')!;
      expect(text.inputs.find((i) => i.id === 'labelContent'), type).toMatchObject({
        label: 'Label content',
        kind: 'select',
        options: [
          { value: 'level', label: 'Level' },
          { value: 'price', label: 'Price' },
          { value: 'both', label: 'Level and price' },
          { value: 'percent', label: 'Percent' },
        ],
        default: content,
      });
      expect(form.values.labelContent, type).toBe(content);
      expect(drawingSettingsForm({ labelContent: 'percent' }, tool(type), tool(type).styleFields!, darkTheme)!.values.labelContent, type).toBe('percent');
    }
  });

  it('shows the tool default for a field set to undefined, as the drawing draws', () => {
    expect(drawingSettingsForm({ labelContent: undefined }, tool('fib-retracement'), tool('fib-retracement').styleFields!, darkTheme)!.values.labelContent).toBe('both');
  });

  it('shows the side a saved backward drawing without labelSide draws on: right', () => {
    const chart = new Chart(fakeContainer());
    const points = [{ time: 1800, price: 2 }, { time: 600, price: 1 }];
    for (const type of ['gann-box', 'gann-square', 'gann-square-fixed', 'fib-speed-fan']) {
      chart.drawings.clear();
      expect(chart.drawings.load({ version: 1, drawings: [{ id: type, type, pane: 0, points, style: {} }] }).errors, type).toEqual([]);
      const d = chart.drawings.getById(type)!;
      expect(d.style.labelSide, type).toBeUndefined();
      const form = drawingSettingsForm(d.style, tool(type), chart.drawings.styleFields(d.id), darkTheme)!;
      expect(form.values.labelSide, type).toBe('right');
    }
    chart.destroy();
  });

  it('offers pitchfork labels, off by default', () => {
    const form = drawingSettingsForm({}, tool('pitchfork'), tool('pitchfork').styleFields!, darkTheme)!;
    expect(form.values.showLabel).toBe(false);
    expect(Object.keys(form.values)).toEqual(expect.arrayContaining(['textColor', 'fontSize', 'bold', 'italic']));
  });
});
