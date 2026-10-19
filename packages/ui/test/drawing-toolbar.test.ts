import { afterEach, describe, expect, it } from 'vitest';
import { Chart, DrawingManager, FIB_LEVELS, TimeScale, darkTheme, levelColor, type Drawing, type Rect } from '@chart-on/core';
import { Pane, Timeline } from '@chart-on/core/internal';
import { fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { levelsEditor, patchLevel, styleFieldControl, type StyleFieldContext } from '../src/drawing-style-controls';
import { settingsFieldValue } from '../src/drawing-settings';
import { createDrawingToolbar, isChartNavKey, placeToolbar } from '../src/drawing-toolbar';
import { createReplayControls } from '../src/replay';
import { withBuiltinTools } from '../../core/test/builtin-tools';

const size = { width: 200, height: 34 };
const area = { width: 800, height: 400 };

/** Whether two boxes overlap; touching edges do not count. */
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('placeToolbar', () => {
  it('centers above the selection', () => {
    expect(placeToolbar({ x: 300, y: 200, width: 100, height: 50 }, size, area)).toEqual({ x: 250, y: 156 });
  });

  it('goes below when there is no room above', () => {
    expect(placeToolbar({ x: 300, y: 20, width: 100, height: 50 }, size, area)).toEqual({ x: 250, y: 80 });
  });

  it('stays inside the chart horizontally', () => {
    expect(placeToolbar({ x: 0, y: 200, width: 10, height: 10 }, size, area).x).toBe(4);
    expect(placeToolbar({ x: 790, y: 200, width: 10, height: 10 }, size, area).x).toBe(596);
  });

  it('goes beside a selection with no room above or below, clear of its anchors', () => {
    // Trendline (400,20)-(450,390) in an 800x400 plot.
    const rect = { x: 400, y: 20, width: 50, height: 370 };
    const at = placeToolbar(rect, size, area);
    expect(at).toEqual({ x: 460, y: 188 });
    expect(overlaps({ ...at, ...size }, rect)).toBe(false);
  });

  it('goes left when the right side has no room', () => {
    const rect = { x: 650, y: 20, width: 50, height: 370 };
    const at = placeToolbar(rect, size, area);
    expect(at).toEqual({ x: 440, y: 188 });
    expect(overlaps({ ...at, ...size }, rect)).toBe(false);
  });

  it('keeps clear of a reserved band at the top', () => {
    // Room above the selection, but only inside the band.
    const rect = { x: 300, y: 60, width: 100, height: 50 };
    expect(placeToolbar(rect, size, area).y).toBe(16);
    expect(placeToolbar(rect, size, { ...area, top: 40 })).toEqual({ x: 250, y: 120 });
    // A tall selection reaching into the band: beside it, below the band.
    const tall = { x: 400, y: 0, width: 50, height: 400 };
    expect(placeToolbar(tall, size, { ...area, top: 200 }).y).toBeGreaterThanOrEqual(204);
  });

  it('overlaps the band rather than leave the area when it does not fit below it', () => {
    const tall = { width: 200, height: 120 };
    const short = { width: 800, height: 150 };
    const at = placeToolbar({ x: 0, y: 0, width: 800, height: 150 }, tall, { ...short, top: 60 });
    expect(at.y + tall.height).toBeLessThanOrEqual(short.height - 4);
    expect(at.y).toBe(26);
    // Taller than the whole area: pinned to the top inset.
    expect(placeToolbar({ x: 0, y: 0, width: 800, height: 150 }, { width: 200, height: 400 }, { ...short, top: 60 }).y).toBe(4);
  });

  it('falls back to a clamped spot below when no side has room', () => {
    expect(placeToolbar({ x: 100, y: 20, width: 600, height: 370 }, size, area)).toEqual({ x: 300, y: 362 });
  });
});

describe('isChartNavKey', () => {
  it('keeps pan and zoom keys in the toolbar', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '=']) {
      expect(isChartNavKey(key)).toBe(true);
    }
  });

  it('lets Escape, Delete and undo/redo shortcuts reach the chart', () => {
    for (const key of ['Escape', 'Delete', 'Backspace', 'z', 'Z', 'y', 'Enter', 'Tab']) {
      expect(isChartNavKey(key)).toBe(false);
    }
  });
});

/** First descendant matching `match`, depth first. */
function find(root: unknown, match: (n: Element) => boolean): Element | null {
  for (const child of (root as Element).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
const byLabel = (root: unknown, label: string) => find(root, (n) => n.getAttribute('aria-label') === label);
/** The fake DOM has no `parentElement`; its elements keep their parent in `parent`. */
const wrapOf = (el: Element | null) => (el as unknown as { parent: HTMLElement }).parent;
const fire = (el: Element | null, type: string) => (el as unknown as { dispatch(t: string): void }).dispatch(type);

function manager() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const changes: unknown[] = [];
  const drawings = withBuiltinTools(new DrawingManager({
    theme: darkTheme,
    timeline,
    time: new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 }),
    panes: [new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 })],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => String(price),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => {
      if (name === 'drawings:change') changes.push(payload);
    },
  }));
  // Load (not add) so history starts empty and only the edits are counted.
  drawings.load({
    version: 1,
    drawings: [
      { id: 'a', type: 'trendline', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style: { color: '#ff0000' } },
      { id: 'f', type: 'fib-retracement', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style: {} },
    ],
  });
  changes.length = 0;
  const context = (id: string): StyleFieldContext => ({
    tool: drawings.getTools().find((t) => t.type === drawings.getAll().find((d) => d.id === id)!.type),
    theme: darkTheme,
    edit: {
      preview: (style) => drawings.preview(id, { style }),
      commit: (style) => drawings.update(id, { style }),
    },
  });
  const get = (id: string) => drawings.getAll().find((d) => d.id === id)!;
  return { drawings, changes, context, get };
}

describe('style field controls', () => {
  it('turn a color drag into one undo step and one drawings:change', () => {
    installFakeDom();
    const { drawings, changes, context, get } = manager();
    const control = styleFieldControl('color', context('a'))!;
    control.sync(get('a'));
    fire(find(control.el, (n) => n.className === 'pc-color-trigger'), 'click');
    const input = find(control.el, (n) => n.className === 'pc-color-input') as HTMLInputElement;
    for (const value of ['#ee1100', '#cc3300', '#aa5500', '#887700', '#669900']) {
      input.value = value;
      fire(input, 'input');
    }
    expect(get('a').style.color).toBe('#669900');
    expect(changes).toHaveLength(0);
    expect(drawings.canUndo).toBe(false);

    // Closing the picker commits.
    control.destroy();
    expect(changes).toHaveLength(1);
    expect(get('a').style.color).toBe('#669900');

    expect(drawings.undo()).toBe(true);
    expect(drawings.canUndo).toBe(false);
    expect(get('a').style.color).toBe('#ff0000');
  });

  it('toggle bold and italic as single undo steps', () => {
    installFakeDom();
    const { drawings, context, get } = manager();
    const bold = styleFieldControl('bold', context('a'))!;
    bold.sync(get('a'));
    expect(bold.el.getAttribute('aria-pressed')).toBe('false');
    fire(bold.el, 'click');
    expect(get('a').style.bold).toBe(true);
    bold.sync(get('a'));
    expect(bold.el.getAttribute('aria-pressed')).toBe('true');
    fire(bold.el, 'click');
    expect(get('a').style.bold).toBe(false);
    drawings.undo();
    expect(get('a').style.bold).toBe(true);
  });

  it('show a toggle that defaults to on as pressed', () => {
    installFakeDom();
    const { context, get } = manager();
    const label = styleFieldControl('showLabel', context('f'))!;
    label.sync(get('f'));
    expect(label.el.getAttribute('aria-pressed')).toBe('true');
  });

  it('commit a fill picked with opacity once, when the picker closes', () => {
    installFakeDom();
    const { drawings, changes, context, get } = manager();
    const fill = styleFieldControl('fill', context('f'))!;
    fill.sync(get('f'));
    fire(find(fill.el, (n) => n.className === 'pc-color-trigger'), 'click');
    fire(find(fill.el, (n) => n.className === 'pc-swatch'), 'click');
    const opacity = find(fill.el, (n) => n.className === 'pc-opacity') as HTMLInputElement;
    opacity.value = '40';
    fire(opacity, 'input');
    expect(get('f').style.fill).toBe('rgba(255, 255, 255, 0.4)');
    expect(changes).toHaveLength(0);
    fill.destroy();
    expect(changes).toHaveLength(1);
    expect(drawings.undo()).toBe(true);
    expect(get('f').style.fill).toBeUndefined();
  });

  it('show a font size outside the menu sizes on the trigger', () => {
    installFakeDom();
    const { drawings, context, get } = manager();
    drawings.update('a', { style: { fontSize: 15 } });
    const size = styleFieldControl('fontSize', context('a'))!;
    size.sync(get('a'));
    const face = find(size.el, (n) => n.className === 'pc-menu-face')!;
    expect(face.children[0]?.textContent).toBe('15px');
  });

  it('show the line width the settings dialog shows, the default 1.5px included', () => {
    installFakeDom();
    const { drawings, context, get } = manager();
    const width = styleFieldControl('lineWidth', context('a'))!;
    const face = () => find(width.el, (n) => n.className === 'pc-menu-face')!.children[0]?.textContent;
    width.sync(get('a'));
    expect(face()).toBe(`${settingsFieldValue('lineWidth', get('a').style, context('a').tool, darkTheme)}px`);
    expect(face()).toBe('1.5px');
    drawings.update('a', { style: { lineWidth: 3 } });
    width.sync(get('a'));
    expect(face()).toBe('3px');
  });

  it('have no control for levels or unknown fields', () => {
    installFakeDom();
    const { context } = manager();
    expect(styleFieldControl('levels', context('f'))).toBeNull();
    expect(styleFieldControl('risk', context('f'))).toBeNull();
  });
});

describe('levels editor', () => {
  it('starts from the tool default levels and edits color, visibility and value', () => {
    installFakeDom();
    const { drawings, changes, context, get } = manager();
    const editor = levelsEditor(context('f'));
    editor.sync(get('f'));
    const rows = editor.el.children;
    expect(rows).toHaveLength(FIB_LEVELS.length);
    // Default levels take the shared level rule; the swatch shows its color, the theme's accent for 0.618.
    expect((byLabel(editor.el, 'Level 0.618 color') as HTMLInputElement).value).toBe(darkTheme.drawing);

    const visible = byLabel(editor.el, 'Show level 0.5') as HTMLInputElement;
    expect(visible.checked).toBe(true);
    visible.checked = false;
    fire(visible, 'change');
    expect(get('f').style.levels![3]).toEqual({ value: 0.5, color: 'auto', visible: false });
    editor.sync(get('f'));

    const value = byLabel(editor.el, 'Level 0.618 value') as HTMLInputElement;
    value.value = '0.65';
    fire(value, 'change');
    expect(get('f').style.levels![4]!.value).toBe(0.65);
    editor.sync(get('f'));
    // A rule color follows the new value.
    expect((byLabel(editor.el, 'Level 0.65 color') as HTMLInputElement).value).toBe(levelColor(0.65, darkTheme));

    const color = byLabel(editor.el, 'Level 0.65 color') as HTMLInputElement;
    color.value = '#00ff00';
    fire(color, 'input');
    expect(changes).toHaveLength(2);
    fire(color, 'change');
    expect(get('f').style.levels![4]).toEqual({ value: 0.65, color: '#00ff00' });
    expect(changes).toHaveLength(3);
    // The other levels are untouched.
    expect(get('f').style.levels!.map((l) => l.value)).toEqual([0, 0.236, 0.382, 0.5, 0.65, 0.786, 1]);

    drawings.undo();
    expect(get('f').style.levels![4]).toEqual({ value: 0.65, color: 'auto' });
  });

  it('ignores a value that is not a number', () => {
    installFakeDom();
    const { changes, context, get } = manager();
    const editor = levelsEditor(context('f'));
    editor.sync(get('f'));
    const value = byLabel(editor.el, 'Level 1 value') as HTMLInputElement;
    value.value = '';
    fire(value, 'change');
    expect(changes).toHaveLength(0);
    expect(value.value).toBe('1');
  });

  it('patches one level and copies the rest', () => {
    const levels = [{ value: 0 }, { value: 1, color: '#fff' }];
    const next = patchLevel(levels, 1, { visible: false });
    expect(next).toEqual([{ value: 0 }, { value: 1, color: '#fff', visible: false }]);
    expect(next[0]).not.toBe(levels[0]);
  });
});

describe('drawing toolbar', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function setup() {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const toolbar = createDrawingToolbar(chart);
    const add = (type: string, extra: Partial<Drawing> = {}) =>
      chart.drawings.add({ type, pane: 0, points: [{ time: 600, price: 10 }, { time: 1200, price: 10.5 }], style: {}, ...extra });
    return { chart, toolbar, add };
  }

  it('moves clear of the replay strip when a replay starts and back when it stops', async () => {
    const { chart, toolbar, add } = setup();
    // Mounted in the shell's order: the toolbar listens to replay:change before the strip.
    const strip = createReplayControls(chart);
    Object.defineProperties(strip.el, { offsetTop: { value: 16 }, offsetHeight: { value: 38 } });
    let measured = 0;
    Object.defineProperties(toolbar.el, {
      offsetWidth: { get: () => (measured++, 200) },
      offsetHeight: { value: 34 },
    });
    const d = add('trendline');
    chart.drawings.select(d.id);
    const emit = (chart as unknown as { emit(event: string, payload: unknown): void }).emit.bind(chart);
    emit('drawing:bounds', { id: d.id, rect: { x: 300, y: 60, width: 100, height: 20 } });
    const y = () => Number(/, (-?[\d.]+)px\)/.exec(toolbar.el.style.transform)![1]);
    expect(y()).toBe(16);
    chart.replay.start(1200);
    await Promise.resolve();
    // Above the line would be inside the strip's band (16 + 38): below the line instead.
    expect(y()).toBe(90);
    const count = measured;
    chart.replay.step();
    chart.replay.speed = 2;
    await Promise.resolve();
    expect(measured).toBe(count);
    chart.replay.stop();
    await Promise.resolve();
    expect(y()).toBe(16);
    strip.destroy();
  });

  const fieldLabels = (el: HTMLElement) =>
    [...(el.querySelector('.pc-drawing-fields')!.children as unknown as Element[])].map(
      (c) => c.getAttribute('aria-label') ?? c.children[0]?.getAttribute('aria-label'),
    );

  it("shows the selected drawing's quick fields and only the controls its tool supports", () => {
    const { chart, toolbar, add } = setup();
    const line = add('trendline');
    chart.drawings.select(line.id);
    expect(fieldLabels(toolbar.el)).toEqual(['Color', 'Line width', 'Line style']);
    // The extend flags wait in the popover.
    expect(wrapOf(byLabel(toolbar.el, 'More style')!).hidden).toBe(false);
    expect(wrapOf(byLabel(toolbar.el, 'Levels')!).hidden).toBe(true);

    const text = chart.drawings.add({ type: 'text', pane: 0, points: [{ time: 600, price: 10 }], text: 'Hi', style: {} });
    chart.drawings.select(text.id);
    expect(fieldLabels(toolbar.el)).toEqual(['Text color', 'Font size', 'Bold', 'Italic']);
    fire(byLabel(toolbar.el, 'Bold'), 'click');
    expect(chart.drawings.getAll().find((d) => d.id === text.id)!.style.bold).toBe(true);
    expect(byLabel(toolbar.el, 'Bold')!.getAttribute('aria-pressed')).toBe('true');
    toolbar.destroy();
  });

  it('puts the other fields in the More style popover and a levels editor for Fibonacci tools', () => {
    const { chart, toolbar, add } = setup();
    const fib = add('fib-retracement');
    chart.drawings.select(fib.id);
    expect(fieldLabels(toolbar.el)).toEqual(['Color', 'Fill', 'Line width', 'Line style']);
    const more = byLabel(toolbar.el, 'More style')!;
    expect(wrapOf(more).hidden).toBe(false);
    fire(more, 'click');
    const panel = toolbar.el.querySelector('.pc-drawing-style-popover')!;
    for (const label of ['Extend right', 'Label', 'Text color', 'Font size', 'Bold', 'Italic']) {
      expect(byLabel(panel, label), label).not.toBeNull();
    }
    const levels = byLabel(toolbar.el, 'Levels')!;
    expect(wrapOf(levels).hidden).toBe(false);
    fire(levels, 'click');
    expect(toolbar.el.querySelector('.pc-levels')!.children).toHaveLength(FIB_LEVELS.length);
    toolbar.destroy();
  });

  it('edits every selected drawing whose tool honors the field, as one undo step', () => {
    const { chart, toolbar, add } = setup();
    const line = add('trendline');
    const text = (price: number) => chart.drawings.add({ type: 'text', pane: 0, points: [{ time: 600, price }], text: 'Hi', style: {} });
    const t1 = text(10);
    const t2 = text(10.2);
    chart.drawings.setSelection([line.id, t1.id, t2.id]);
    // The fields of the drawing selected last.
    expect(fieldLabels(toolbar.el)).toEqual(['Text color', 'Font size', 'Bold', 'Italic']);
    const changes: unknown[] = [];
    chart.on('drawings:change', (e) => changes.push(e));
    fire(byLabel(toolbar.el, 'Bold'), 'click');
    const style = (id: string) => chart.drawings.getById(id)!.style;
    expect([style(t1.id).bold, style(t2.id).bold, style(line.id).bold]).toEqual([true, true, undefined]);
    expect(changes).toHaveLength(1);
    chart.drawings.undo();
    expect([style(t1.id).bold, style(t2.id).bold]).toEqual([undefined, undefined]);

    fire(byLabel(toolbar.el, 'Lock'), 'click');
    expect(chart.drawings.getAll().map((d) => d.locked)).toEqual([true, true, true]);
    fire(byLabel(toolbar.el, 'Unlock'), 'click');
    fire(byLabel(toolbar.el, 'Clone'), 'click');
    expect(chart.drawings.getAll()).toHaveLength(6);
    expect(chart.drawings.selection).toHaveLength(3);
    fire(byLabel(toolbar.el, 'Delete'), 'click');
    expect(chart.drawings.getAll().map((d) => d.id)).toEqual([line.id, t1.id, t2.id]);
    toolbar.destroy();
  });

  it('groups and ungroups the selection', () => {
    const { chart, toolbar, add } = setup();
    const a = add('trendline');
    const b = add('rectangle');
    const group = byLabel(toolbar.el, 'Group') as HTMLElement;
    const ungroup = byLabel(toolbar.el, 'Ungroup') as HTMLElement;
    chart.drawings.select(a.id);
    expect([group.hidden, ungroup.hidden]).toEqual([true, true]);
    chart.drawings.setSelection([a.id, b.id]);
    expect([group.hidden, ungroup.hidden]).toEqual([false, true]);
    fire(group, 'click');
    expect(chart.drawings.groups).toEqual([{ name: 'Group 1', ids: [a.id, b.id] }]);
    expect([group.hidden, ungroup.hidden]).toEqual([true, false]);
    fire(ungroup, 'click');
    expect(chart.drawings.groups).toEqual([]);
    expect([group.hidden, ungroup.hidden]).toEqual([false, true]);
    toolbar.destroy();
  });

  it('relabels its buttons and style controls when the language changes', () => {
    const { chart, toolbar, add } = setup();
    const line = add('trendline');
    chart.drawings.select(line.id);
    expect(fieldLabels(toolbar.el)).toEqual(['Color', 'Line width', 'Line style']);
    expect(byLabel(toolbar.el, 'Clone')).not.toBeNull();
    chart.applyOptions({
      localization: {
        messages: {
          drawingClone: 'Klonen',
          drawingLock: 'Sperren',
          drawingUnlock: 'Entsperren',
          drawingSelected: 'Ausgewählte Zeichnung',
          seriesColor: 'Farbe',
          indicatorPlotLineWidth: 'Linienstärke',
        },
      },
    });
    expect(toolbar.el.getAttribute('aria-label')).toBe('Ausgewählte Zeichnung');
    expect(byLabel(toolbar.el, 'Klonen')).not.toBeNull();
    expect(fieldLabels(toolbar.el)).toEqual(['Farbe', 'Linienstärke', 'Line style']);
    const lock = byLabel(toolbar.el, 'Sperren')!;
    fire(lock, 'click');
    expect(lock.getAttribute('aria-label')).toBe('Entsperren');
    expect(lock.getAttribute('data-tip')).toBe('Entsperren');
    toolbar.destroy();
  });
});

describe('drawing toolbar pickers', () => {
  it('commit a pending fill to the drawing it was picked for when the selection moves on', () => {
    const chart = new Chart(fakeContainer());
    chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    const toolbar = createDrawingToolbar(chart);
    const points = [{ time: 600, price: 10 }, { time: 1200, price: 10.5 }];
    const a = chart.drawings.add({ type: 'rectangle', pane: 0, points, style: {} });
    const b = chart.drawings.add({ type: 'rectangle', pane: 0, points, style: {} });
    chart.drawings.select(a.id);
    const fill = byLabel(toolbar.el, 'Fill')!;
    fire(fill, 'click');
    fire(find(toolbar.el, (n) => n.className === 'pc-swatch'), 'click');
    chart.drawings.select(b.id);
    const style = (id: string) => chart.drawings.getAll().find((d) => d.id === id)!.style;
    expect(style(a.id).fill).toMatch(/^rgba\(255, 255, 255/);
    expect(style(b.id).fill).toBeUndefined();
    // The controls now edit b.
    fire(byLabel(toolbar.el, 'Fill'), 'click');
    fire(find(toolbar.el, (n) => n.className === 'pc-swatch'), 'click');
    chart.drawings.select(null);
    expect(style(b.id).fill).toMatch(/^rgba\(255, 255, 255/);
    toolbar.destroy();
    chart.destroy();
  });
});
